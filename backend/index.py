"""Entry point for the serverless demo deployment (Vercel).

A serverless instance has no persistent disk, so each one starts from the seed
data in /tmp, and changes last as long as the instance does. Before deploying,
build the snapshot the instances copy from:

    DATABASE_URL=sqlite+aiosqlite:///./demo/pramaansetu.db STORAGE_ROOT=./demo/files \
        python -m app.seed --reset --quiet

and drain its outbox (app.workers.runner.drain) so the seed's notifications are in
it. Without a snapshot an instance seeds itself on cold start. A deployment that
must keep data sets DATABASE_URL to PostgreSQL and runs the job runner and
scheduler as their own processes; the snapshot and seeding are skipped.
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
SNAPSHOT = HERE / "demo"


def _prepare_demo_database(database: Path, files: Path) -> None:
    # built under a private name and renamed into place, so a cold start that is
    # cut short never leaves a half-seeded database for the next one to trust
    partial = database.with_name(f"{database.name}.{os.getpid()}.partial")
    if (SNAPSHOT / "pramaansetu.db").exists():
        shutil.copyfile(SNAPSHOT / "pramaansetu.db", partial)
        if (SNAPSHOT / "files").exists():
            shutil.copytree(SNAPSHOT / "files", files, dirs_exist_ok=True)
    else:
        subprocess.run(
            [sys.executable, "-m", "app.seed", "--reset", "--quiet"],
            cwd=HERE,
            env={
                **os.environ,
                "DATABASE_URL": f"sqlite+aiosqlite:///{partial}",
                # the runtime adds the bundled packages to sys.path in-process only
                "PYTHONPATH": os.pathsep.join(filter(None, sys.path)),
            },
            check=True,
        )
    os.replace(partial, database)


if os.environ.get("VERCEL") and not os.environ.get("DATABASE_URL"):
    database = Path("/tmp/pramaansetu.db")
    files = Path("/tmp/files")
    os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{database}"
    os.environ.setdefault("STORAGE_ROOT", str(files))
    if not database.exists():
        _prepare_demo_database(database, files)

import asyncio  # noqa: E402

from app.main import app as api  # noqa: E402
from app.workers.runner import drain  # noqa: E402

# A serverless instance only runs while it answers a request, so the job runner and
# scheduler loops started in the lifespan never get to work. Instead, each request
# first runs whatever is queued: the redirect after a form post and the job watcher's
# polling then carry every job and outbox event through. One drain at a time; the
# others go straight on.
_draining = asyncio.Lock()


async def app(scope, receive, send):  # type: ignore[no-untyped-def]
    if scope["type"] == "http" and not _draining.locked():
        async with _draining:
            await drain(max_jobs=100)
    await api(scope, receive, send)


__all__ = ["app"]
