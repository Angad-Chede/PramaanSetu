"""Structured JSON logging to stdout (PRD 13.1).

Never logged: secrets, one-time codes, document contents, raw tokens. The user id is
hashed so an operator reading logs cannot trivially build a profile of one person.
"""

from __future__ import annotations

import json
import logging
import sys
import time
from typing import Any

from app.core.config import settings
from app.core.security import hash_ip

SENSITIVE_KEYS = {
    "password", "otp", "code", "token", "secret", "api_key", "authorization",
    "access_token", "refresh_token", "csrf", "code_hash", "password_hash",
}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created))
            + "." + str(int(record.msecs)).zfill(3) + "Z",
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "service": "pramaansetu-api",
            "env": settings.environment,
        }
        for key, value in getattr(record, "extra_fields", {}).items():
            if key.lower() in SENSITIVE_KEYS:
                continue
            payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, ensure_ascii=False)


def configure_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.DEBUG if settings.debug else logging.INFO)
    # Libraries that narrate their own internals drown out the application's own lines.
    # aiosqlite in particular logs every cursor, execute, fetch and close, which at DEBUG
    # buries real errors under thousands of lines: the bind failure that stops the server
    # scrolls past unread. Their warnings and errors still come through.
    for noisy in (
        "uvicorn.access",
        "sqlalchemy.engine",
        "sqlalchemy.pool",
        "asyncio",
        "aiosqlite",
        "httpcore",
        "httpx",
        "multipart",
    ):
        logging.getLogger(noisy).setLevel(logging.WARNING)


class ContextLogger:
    """Thin wrapper so call sites read as log.info(message, key=value)."""

    def __init__(self, name: str) -> None:
        self._logger = logging.getLogger(name)

    def _log(self, level: int, message: str, **fields: Any) -> None:
        self._logger.log(level, message, extra={"extra_fields": fields})

    def debug(self, message: str, **fields: Any) -> None:
        self._log(logging.DEBUG, message, **fields)

    def info(self, message: str, **fields: Any) -> None:
        self._log(logging.INFO, message, **fields)

    def warning(self, message: str, **fields: Any) -> None:
        self._log(logging.WARNING, message, **fields)

    def error(self, message: str, **fields: Any) -> None:
        self._log(logging.ERROR, message, **fields)

    def exception(self, message: str, **fields: Any) -> None:
        self._logger.exception(message, extra={"extra_fields": fields})


def get_logger(name: str) -> ContextLogger:
    return ContextLogger(name)


def scrub_ip(value: str | None) -> str | None:
    return hash_ip(value)
