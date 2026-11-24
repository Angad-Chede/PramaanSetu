"""Every error is an RFC 9457 problem document carrying a fix (PRD 6.1).

A user who hits an error should be told what went wrong and what to do about it, in a
shape the web app can render without special cases. That includes the errors nobody
writes a handler for: a mistyped address, a wrong method, a malformed body.
"""

from __future__ import annotations

from factories import make_department, make_user, sign_in
from httpx import AsyncClient

PROBLEM = "application/problem+json"


def _has_fix(problem: dict) -> bool:
    if problem.get("fix"):
        return True
    return bool(problem.get("errors")) and all(e.get("fix") for e in problem["errors"])


async def test_an_unmatched_address_returns_a_problem_document(client: AsyncClient):
    response = await client.get("/api/v1/challegnes")
    assert response.status_code == 404
    assert response.headers["content-type"].startswith(PROBLEM)

    problem = response.json()
    assert problem["type"].endswith("/not-found")
    assert problem["title"]
    assert problem["status"] == 404
    assert "/api/v1/challegnes" in problem["detail"]
    assert problem["instance"] == "/api/v1/challegnes"
    assert _has_fix(problem)
    assert "/docs" in problem["fix"]


async def test_a_rejected_method_names_the_methods_that_are_accepted(client: AsyncClient):
    response = await client.delete("/api/v1/healthz")
    assert response.status_code == 405
    assert response.headers["content-type"].startswith(PROBLEM)

    problem = response.json()
    assert problem["type"].endswith("/method-not-allowed")
    assert "DELETE" in problem["detail"]
    assert _has_fix(problem)


async def test_an_unauthenticated_request_returns_a_problem_document(client: AsyncClient):
    response = await client.get("/api/v1/me/tasks")
    assert response.status_code == 401
    assert response.headers["content-type"].startswith(PROBLEM)
    assert response.json()["status"] == 401


async def test_a_malformed_body_names_every_field_and_its_fix(client: AsyncClient, session):
    department = await make_department(session, code="ERRSHAPE")
    await make_user(
        session,
        email="errshape.officer@test.invalid",
        roles=[("DO", "department", department.id)],
        department_id=department.id,
    )
    await session.commit()

    headers = await sign_in(client, "errshape.officer@test.invalid")
    response = await client.post(
        "/api/v1/challenges",
        json={"department_id": department.id, "title": {"not": "a string"}, "problem_statement": 7},
        headers=headers,
    )
    assert response.status_code == 422
    assert response.headers["content-type"].startswith(PROBLEM)

    problem = response.json()
    assert problem["status"] == 422
    assert {e["field"] for e in problem["errors"]} == {"title", "problem_statement"}
    assert problem["instance"] == "/api/v1/challenges"
    assert _has_fix(problem)


async def test_a_record_that_does_not_exist_returns_a_problem_document(
    client: AsyncClient, session
):
    department = await make_department(session, code="ERRMISS")
    await make_user(
        session,
        email="errmiss.officer@test.invalid",
        roles=[("DO", "department", department.id)],
        department_id=department.id,
    )
    await session.commit()

    headers = await sign_in(client, "errmiss.officer@test.invalid")
    response = await client.get("/api/v1/challenges/00000000-0000-0000-0000-000000000000", headers=headers)
    assert response.status_code == 404
    assert response.headers["content-type"].startswith(PROBLEM)
    assert response.json()["type"].endswith("/not-found")


async def test_the_root_document_still_answers_plainly(client: AsyncClient):
    """The service banner is not an error and is not a problem document."""
    response = await client.get("/")
    assert response.status_code == 200
    assert response.json()["name"] == "PramaanSetu"
