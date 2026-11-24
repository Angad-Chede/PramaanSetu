"""FastAPI application: middleware, error handlers, lifespan and the OpenAPI document."""

from __future__ import annotations

import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1 import api_router
from app.core.config import settings
from app.core.db import engine, session_scope
from app.core.errors import (
    AppError,
    RateLimited,
    app_error_handler,
    http_error_handler,
    unhandled_error_handler,
    validation_error_handler,
)
from app.core.ids import uuid7str
from app.core.logging import configure_logging, get_logger
from app.core.ratelimit import limiter, read_limit, write_limit
from app.models import Base
from app.services.templates import install_template_kit
from app.workers.runner import JobRunner
from app.workers.scheduler import Scheduler

log = get_logger(__name__)

DESCRIPTION = """
PramaanSetu takes a government department from a plain-language operational problem to an
evidence-backed procurement decision on a startup solution, in one auditable workflow.

Conventions used throughout this API:

- State changes are explicit action endpoints, never a free-form update of a state field.
- Every mutable resource returns a version and an ETag; updates send If-Match and a stale
  version returns 409 with the current record.
- Every action endpoint accepts an Idempotency-Key; a repeat within 24 hours returns the
  original response.
- Errors are RFC 9457 problem documents, and every field error carries a fix.
- Times are ISO 8601 in UTC. Money is integer paise plus a currency code.
"""


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    log.info(
        "Starting PramaanSetu API",
        environment=settings.environment,
        database=settings.database_url.split("://")[0],
    )

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async with session_scope() as session:
        installed = await install_template_kit(session)
        if installed:
            log.info("Template Kit installed", templates=installed)

    runner: JobRunner | None = None
    scheduler: Scheduler | None = None
    if settings.job_runner_enabled:
        runner = JobRunner()
        await runner.start()
    if settings.scheduler_enabled:
        scheduler = Scheduler()
        await scheduler.start()

    app.state.job_runner = runner
    app.state.scheduler = scheduler

    try:
        yield
    finally:
        if scheduler is not None:
            await scheduler.stop()
        if runner is not None:
            await runner.stop()
        await engine.dispose()
        log.info("PramaanSetu API stopped")


app = FastAPI(
    title="PramaanSetu API",
    description=DESCRIPTION,
    version="1.0.0",
    openapi_version="3.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
    contact={"name": "Team CODE REAPERS"},
    license_info={"name": "For Smart India Hackathon 2026, problem statement SIH26136"},
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["ETag", "Location", "RateLimit-Limit", "RateLimit-Remaining", "Retry-After"],
)
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.middleware("http")
async def request_context(request: Request, call_next: Any) -> Any:
    """Request id, timing, security headers, body limit and rate limiting."""
    started = time.perf_counter()
    request_id = request.headers.get("X-Request-Id") or uuid7str()
    request.state.request_id = request_id

    content_length = request.headers.get("content-length")
    if (
        content_length
        and int(content_length) > settings.max_json_body_bytes
        and "multipart/form-data" not in request.headers.get("content-type", "")
        and not request.url.path.endswith("/content")
    ):
        problem = AppError("The request body is larger than the 1 MB limit for JSON requests.")
        problem.status_code = 413
        problem.problem_type = "payload-too-large"
        problem.title = "Request too large"
        return JSONResponse(
            status_code=413,
            content=problem.to_problem(instance=request.url.path),
            media_type="application/problem+json",
        )

    verdict = None
    if request.url.path.startswith(settings.api_prefix):
        identity = request.client.host if request.client else "unknown"
        cookie = request.cookies.get("ps_access")
        if cookie:
            identity = cookie[-24:]
        is_write = request.method in ("POST", "PUT", "DELETE", "PATCH")
        limit, window = write_limit() if is_write else read_limit()
        verdict = await limiter.check(
            ("w:" if is_write else "r:") + identity, limit, window
        )
        if not verdict.allowed:
            problem = RateLimited(
                "You have made too many requests. Wait "
                + str(verdict.reset_seconds)
                + " seconds and try again."
            )
            return JSONResponse(
                status_code=429,
                content=problem.to_problem(instance=request.url.path),
                media_type="application/problem+json",
                headers={
                    "Retry-After": str(verdict.reset_seconds),
                    "RateLimit-Limit": str(verdict.limit),
                    "RateLimit-Remaining": "0",
                },
            )

    try:
        response = await call_next(request)
    except Exception:
        log.exception("Unhandled error", request_id=request_id, path=request.url.path)
        raise

    duration_ms = (time.perf_counter() - started) * 1000
    response.headers["X-Request-Id"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Content-Security-Policy"] = (
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    )
    if settings.cookie_secure:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    if verdict is not None:
        response.headers["RateLimit-Limit"] = str(verdict.limit)
        response.headers["RateLimit-Remaining"] = str(verdict.remaining)

    log.info(
        "request",
        request_id=request_id,
        method=request.method,
        path=request.url.path,
        status=response.status_code,
        duration_ms=round(duration_ms, 2),
    )
    return response


# Starlette types a handler as taking a bare Exception, while each of these is written
# against the specific class it is registered for. The registration is correct at runtime
# because Starlette dispatches by that same class; only the declared signature disagrees.
app.add_exception_handler(AppError, app_error_handler)  # type: ignore[arg-type]
app.add_exception_handler(RequestValidationError, validation_error_handler)  # type: ignore[arg-type]
app.add_exception_handler(StarletteHTTPException, http_error_handler)  # type: ignore[arg-type]
app.add_exception_handler(Exception, unhandled_error_handler)

app.include_router(api_router, prefix=settings.api_prefix)


@app.get("/", include_in_schema=False)
async def root() -> dict[str, Any]:
    return {
        "name": "PramaanSetu",
        "description": "Bridge of Proof. From a plain-language problem to an evidence-backed "
        "procurement decision, in one auditable workflow.",
        "version": "1.0.0",
        "api": settings.api_prefix,
        "documentation": "/docs",
        "openapi": "/openapi.json",
        "health": "/api/v1/healthz",
    }
