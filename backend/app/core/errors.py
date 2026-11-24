"""RFC 9457 problem details. Every error names the field, the problem and the fix (PRD 6.1)."""

from __future__ import annotations

from typing import Any

from fastapi import Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

PROBLEM_BASE = "https://pramaansetu.gov.in/problems"


class AppError(Exception):
    """Base application error rendered as an RFC 9457 problem document."""

    status_code: int = status.HTTP_400_BAD_REQUEST
    problem_type: str = "application-error"
    title: str = "Request could not be completed"

    def __init__(
        self,
        detail: str,
        *,
        errors: list[dict[str, Any]] | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(detail)
        self.detail = detail
        self.errors = errors or []
        self.extra = extra or {}

    def to_problem(self, instance: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {
            "type": f"{PROBLEM_BASE}/{self.problem_type}",
            "title": self.title,
            "status": self.status_code,
            "detail": self.detail,
        }
        if self.errors:
            body["errors"] = self.errors
        if instance:
            body["instance"] = instance
        body.update(self.extra)
        return body


class ValidationFailed(AppError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    problem_type = "validation-failed"
    title = "Some fields need correction"


class NotFound(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    problem_type = "not-found"
    title = "Record not found"


class Unauthenticated(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    problem_type = "unauthenticated"
    title = "Sign in to continue"


class Forbidden(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    problem_type = "forbidden"
    title = "You do not have permission for this action"


class Conflict(AppError):
    status_code = status.HTTP_409_CONFLICT
    problem_type = "conflict"
    title = "The record changed since you loaded it"


class PreconditionRequired(AppError):
    status_code = status.HTTP_428_PRECONDITION_REQUIRED
    problem_type = "precondition-required"
    title = "This update needs the record version"


class RateLimited(AppError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    problem_type = "rate-limited"
    title = "Too many requests"


class DependencyUnavailable(AppError):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    problem_type = "dependency-unavailable"
    title = "A dependency is temporarily unavailable"


class TransitionNotAllowed(AppError):
    status_code = status.HTTP_409_CONFLICT
    problem_type = "transition-not-allowed"
    title = "This step is not available from the current state"


def field_error(field: str, problem: str, fix: str) -> dict[str, str]:
    """Build one field error carrying the fix, as required by PRD 6.1."""
    return {"field": field, "detail": problem, "fix": fix}


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=exc.to_problem(instance=str(request.url.path)),
        media_type="application/problem+json",
    )


async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    errors = []
    for item in exc.errors():
        location = ".".join(str(part) for part in item["loc"] if part not in ("body", "query"))
        errors.append(
            {
                "field": location or "body",
                "detail": item["msg"],
                "fix": "Correct this field and submit again.",
            }
        )
    problem = ValidationFailed("One or more fields are invalid.", errors=errors)
    return JSONResponse(
        status_code=problem.status_code,
        content=problem.to_problem(instance=str(request.url.path)),
        media_type="application/problem+json",
    )


async def http_error_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    """Unmatched routes and rejected methods answer in the same shape as everything else.

    Without this, a mistyped path falls through to the framework default and returns a
    bare detail string, which no client-side error renderer knows how to read.
    """
    problem: AppError
    if exc.status_code == status.HTTP_404_NOT_FOUND:
        problem = NotFound(
            "There is nothing at " + str(request.url.path) + "."
        )
        problem.extra = {
            "fix": "Check the address. The API reference is at /docs and the machine-readable "
            "document is at /openapi.json."
        }
    elif exc.status_code == status.HTTP_405_METHOD_NOT_ALLOWED:
        problem = AppError(
            "This address does not accept " + request.method + " requests."
        )
        problem.status_code = status.HTTP_405_METHOD_NOT_ALLOWED
        problem.problem_type = "method-not-allowed"
        problem.title = "Method not allowed"
        allowed = (exc.headers or {}).get("Allow")
        problem.extra = {
            "fix": "Use one of the methods this address accepts"
            + (": " + allowed + "." if allowed else ". The API reference is at /docs.")
        }
    else:
        detail = exc.detail if isinstance(exc.detail, str) and exc.detail else "The request was refused."
        problem = AppError(detail)
        problem.status_code = exc.status_code
        problem.problem_type = "http-error"
        problem.title = "Request refused"

    return JSONResponse(
        status_code=problem.status_code,
        content=problem.to_problem(instance=str(request.url.path)),
        media_type="application/problem+json",
        headers=exc.headers or None,
    )

async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    problem = AppError("An unexpected error occurred. The team has been notified.")
    problem.status_code = status.HTTP_500_INTERNAL_SERVER_ERROR
    problem.problem_type = "internal-error"
    problem.title = "Something went wrong"
    return JSONResponse(
        status_code=500,
        content=problem.to_problem(instance=str(request.url.path)),
        media_type="application/problem+json",
    )
