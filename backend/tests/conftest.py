"""Test fixtures. Each test module runs against its own throwaway SQLite database."""

from __future__ import annotations

import os
import tempfile
from collections.abc import AsyncIterator
from pathlib import Path

# Configuration must be set before anything imports the settings object.
_TEST_DIR = Path(tempfile.gettempdir()) / "pramaansetu-tests"
_TEST_DIR.mkdir(parents=True, exist_ok=True)

os.environ.setdefault("ENVIRONMENT", "local")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///" + str(_TEST_DIR / "test.db").replace("\\", "/"))
os.environ.setdefault("JOB_RUNNER_ENABLED", "false")
os.environ.setdefault("SCHEDULER_ENABLED", "false")
os.environ.setdefault("STORAGE_ROOT", str(_TEST_DIR / "files").replace("\\", "/"))
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-used-anywhere-else")
os.environ.setdefault("COOKIE_SECURE", "false")
os.environ.setdefault("RATE_LIMIT_WRITES_PER_MINUTE", "100000")
os.environ.setdefault("RATE_LIMIT_READS_PER_MINUTE", "100000")

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from app.core.clock import reset_demo_offset  # noqa: E402
from app.core.db import SessionFactory, engine, session_scope  # noqa: E402
from app.models import Base  # noqa: E402
from app.services.templates import install_template_kit  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _clock() -> None:
    reset_demo_offset()


@pytest.fixture
async def database() -> AsyncIterator[None]:
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)
    async with session_scope() as session:
        await install_template_kit(session)
    yield
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def session(database: None) -> AsyncIterator:
    async with SessionFactory() as db:
        yield db
        await db.rollback()


@pytest.fixture
async def client(database: None) -> AsyncIterator[AsyncClient]:
    """An HTTP client bound directly to the ASGI app, with no network in between."""
    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as http:
        yield http
