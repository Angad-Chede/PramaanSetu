"""Version 1 of the API. Route order matters: specific paths before catch-all actions."""

from fastapi import APIRouter

from app.api.v1 import (
    admin,
    applications,
    auth,
    challenges,
    evaluation,
    evidence,
    files,
    health,
    jobs,
    me,
    milestones,
    pilots,
    public,
    scale,
    startups,
)

api_router = APIRouter()

api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(me.router)
api_router.include_router(public.router)
api_router.include_router(startups.router)
api_router.include_router(applications.router)
api_router.include_router(evaluation.router)
api_router.include_router(evidence.router)
api_router.include_router(scale.router)
api_router.include_router(scale.passports)
api_router.include_router(milestones.router)
api_router.include_router(files.router)
api_router.include_router(jobs.router)
api_router.include_router(admin.router)
# These two carry catch-all action routes, so they are registered last.
api_router.include_router(pilots.router)
api_router.include_router(challenges.router)

__all__ = ["api_router"]
