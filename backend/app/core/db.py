"""Database engine, session factory and the locking primitives the workflow depends on.

The MVP runs on SQLite with no external service, and on PostgreSQL 16 for the full
topology described in PRD section 7.2. Every locking helper has a correct implementation
on both engines, so the concurrency guarantees in PRD 10.3 hold either way.
"""

from __future__ import annotations

import contextlib
from collections.abc import AsyncIterator
from typing import Any, TypeVar

from sqlalchemy import event, select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

T = TypeVar("T")


def _build_engine() -> AsyncEngine:
    kwargs: dict[str, Any] = {"echo": settings.database_echo, "future": True}
    if settings.is_sqlite:
        kwargs["connect_args"] = {"timeout": 30, "check_same_thread": False}
    else:
        kwargs["pool_size"] = settings.db_pool_size
        kwargs["max_overflow"] = settings.db_max_overflow
        kwargs["pool_pre_ping"] = True
    engine = create_async_engine(settings.database_url, **kwargs)

    if settings.is_sqlite:

        @event.listens_for(engine.sync_engine, "connect")
        def _sqlite_pragmas(dbapi_connection, _record):  # type: ignore[no-untyped-def]
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA busy_timeout=30000")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.close()

        @event.listens_for(engine.sync_engine, "begin")
        def _sqlite_begin_immediate(conn):  # type: ignore[no-untyped-def]
            # Take the write lock at BEGIN so two concurrent transitions serialise
            # instead of failing late with "database is locked" after work is done.
            conn.exec_driver_sql("BEGIN IMMEDIATE")

    return engine


engine: AsyncEngine = _build_engine()

SessionFactory = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False, autoflush=False
)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency. One session per request, committed by the route on success."""
    async with SessionFactory() as session:
        try:
            await _apply_timeouts(session)
            yield session
        except Exception:
            await session.rollback()
            raise


@contextlib.asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """Standalone unit of work for workers, the scheduler and the seed script."""
    async with SessionFactory() as session:
        try:
            await _apply_timeouts(session)
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def _apply_timeouts(session: AsyncSession) -> None:
    """A stuck lock must fail fast rather than pile up requests (PRD 10.3)."""
    if settings.is_sqlite:
        return
    await session.execute(text(f"SET LOCAL statement_timeout = {settings.statement_timeout_ms}"))
    await session.execute(text(f"SET LOCAL lock_timeout = {settings.lock_timeout_ms}"))


async def lock_row(session: AsyncSession, model: type[T], entity_id: str) -> T | None:
    """Pessimistic row lock for a state transition.

    PostgreSQL uses SELECT ... FOR UPDATE. SQLite holds a database-level write lock from
    BEGIN IMMEDIATE, which serialises writers just as strictly for the MVP's purposes.
    """
    stmt = select(model).where(model.id == entity_id)  # type: ignore[attr-defined]
    if not settings.is_sqlite:
        stmt = stmt.with_for_update()
    result = await session.execute(stmt)
    return result.scalar_one_or_none()


async def claim_rows(session: AsyncSession, stmt: Any, limit: int = 100) -> list[Any]:
    """Batch-claim work items without two schedulers picking the same row (PRD 10.3)."""
    stmt = stmt.limit(limit)
    if not settings.is_sqlite:
        stmt = stmt.with_for_update(skip_locked=True)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def advisory_lock(session: AsyncSession, key: int) -> None:
    """Serialise audit-chain inserts inside the business transaction (PRD 11.4)."""
    if settings.is_sqlite:
        return  # BEGIN IMMEDIATE already serialises writers on SQLite.
    await session.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": key})


async def db_healthy() -> bool:
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
