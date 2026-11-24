"""Integration adapters (PRD 7.3, 15.1).

Every external system sits behind a Python interface with a mock and a live
implementation, selected by configuration. The MVP ships the mocks; switching to live
is an environment variable, not a code change. A circuit breaker protects each one so a
slow dependency cannot block the workflow (PRD 10.6).
"""

from app.services.adapters.base import Adapter, CircuitBreaker, CircuitOpen  # noqa: F401
