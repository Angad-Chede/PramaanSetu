"""Adapter base class and circuit breaker (PRD 10.6)."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

from app.core.logging import get_logger

log = get_logger(__name__)


class CircuitOpen(Exception):
    """Raised when the breaker is open, so the caller degrades instead of waiting."""


@dataclass
class CircuitBreaker:
    """Opens after `failures` consecutive errors and stays open for `reset_seconds`."""

    name: str
    failures: int = 3
    reset_seconds: int = 60
    _consecutive: int = 0
    _opened_at: float = 0.0

    @property
    def is_open(self) -> bool:
        if self._opened_at == 0.0:
            return False
        if time.monotonic() - self._opened_at >= self.reset_seconds:
            # Half-open: allow one probe through.
            self._opened_at = 0.0
            self._consecutive = self.failures - 1
            return False
        return True

    def guard(self) -> None:
        if self.is_open:
            raise CircuitOpen(
                self.name + " is temporarily unavailable. The action has been queued and will "
                "be retried automatically."
            )

    def record_success(self) -> None:
        self._consecutive = 0
        self._opened_at = 0.0

    def record_failure(self) -> None:
        self._consecutive += 1
        if self._consecutive >= self.failures:
            self._opened_at = time.monotonic()
            log.warning("Circuit breaker opened", adapter=self.name, failures=self._consecutive)

    def state(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "open": self.is_open,
            "consecutive_failures": self._consecutive,
            "reset_seconds": self.reset_seconds,
        }


class Adapter:
    """Common shape: a name, a mode and a health probe the admin console can read."""

    name: str = "adapter"

    def __init__(self, mode: str) -> None:
        self.mode = mode
        self.breaker = CircuitBreaker(name=self.name)

    @property
    def is_mock(self) -> bool:
        return self.mode == "mock"

    async def health(self) -> dict[str, Any]:
        return {"name": self.name, "mode": self.mode, "breaker": self.breaker.state()}
