"""Rate limiting (PRD 10.9).

Redis when it is configured, an in-process sliding window otherwise. Losing Redis
disables shared limiting but never fails a request: the fallback keeps a per-instance
limit, exactly as the degradation table in PRD 10.6 requires.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from dataclasses import dataclass

from app.core.config import settings

_windows: dict[str, deque[float]] = defaultdict(deque)


@dataclass
class LimitVerdict:
    allowed: bool
    limit: int
    remaining: int
    reset_seconds: int


def _local_check(key: str, limit: int, window_seconds: int) -> LimitVerdict:
    now = time.monotonic()
    bucket = _windows[key]
    cutoff = now - window_seconds
    while bucket and bucket[0] < cutoff:
        bucket.popleft()
    if len(bucket) >= limit:
        reset = int(window_seconds - (now - bucket[0])) + 1
        return LimitVerdict(False, limit, 0, max(1, reset))
    bucket.append(now)
    return LimitVerdict(True, limit, limit - len(bucket), window_seconds)


class RateLimiter:
    def __init__(self) -> None:
        self._redis = None
        if settings.redis_url:
            try:
                import redis.asyncio as redis_async

                self._redis = redis_async.from_url(settings.redis_url, decode_responses=True)
            except Exception:
                self._redis = None

    async def check(self, key: str, limit: int, window_seconds: int) -> LimitVerdict:
        if self._redis is None:
            return _local_check(key, limit, window_seconds)
        try:
            pipe = self._redis.pipeline()
            pipe.incr(key)
            pipe.ttl(key)
            count, ttl = await pipe.execute()
            if int(ttl) < 0:
                await self._redis.expire(key, window_seconds)
                ttl = window_seconds
            count = int(count)
            if count > limit:
                return LimitVerdict(False, limit, 0, int(ttl))
            return LimitVerdict(True, limit, max(0, limit - count), int(ttl))
        except Exception:
            # Redis unavailable: fall back to the per-instance limiter (PRD 10.6).
            return _local_check(key, limit, window_seconds)

    async def healthy(self) -> bool:
        if self._redis is None:
            return False
        try:
            await self._redis.ping()
            return True
        except Exception:
            return False


limiter = RateLimiter()


def write_limit() -> tuple[int, int]:
    return settings.rate_limit_writes_per_minute, 60


def read_limit() -> tuple[int, int]:
    return settings.rate_limit_reads_per_minute, 60


def otp_limit() -> tuple[int, int]:
    return settings.rate_limit_otp_per_hour, 3600
