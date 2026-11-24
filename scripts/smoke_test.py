#!/usr/bin/env python3
"""Walk the core pages of a running stack and fail loudly if any of them break.

This is the cheapest possible end-to-end check: it signs in as each role, opens the
pages that role actually uses, and asserts the page carries the content it should. It
needs no browser, so it runs in CI in seconds and on a laptop before a demonstration.

    python scripts/smoke_test.py
    python scripts/smoke_test.py --web http://localhost:3000 --api http://localhost:8000
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from http.cookiejar import CookieJar
from typing import Any

DEFAULT_WEB = "http://127.0.0.1:3000"
DEFAULT_API = "http://127.0.0.1:8000"


class Client:
    """A tiny cookie-aware client, so a session survives across page loads."""

    def __init__(self, web: str, api: str) -> None:
        self.web = web.rstrip("/")
        self.api = api.rstrip("/")
        self.jar = CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf = ""

    def api_post(self, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        request = urllib.request.Request(
            self.api + "/api/v1" + path,
            data=json.dumps(body or {}).encode(),
            headers={"Content-Type": "application/json", "X-CSRF-Token": self.csrf},
            method="POST",
        )
        with self.opener.open(request, timeout=30) as response:
            return json.loads(response.read().decode() or "{}")

    def api_get(self, path: str) -> Any:
        request = urllib.request.Request(self.api + "/api/v1" + path)
        with self.opener.open(request, timeout=30) as response:
            return json.loads(response.read().decode() or "null")

    def page(self, path: str) -> str:
        request = urllib.request.Request(self.web + path)
        with self.opener.open(request, timeout=45) as response:
            return response.read().decode("utf-8", errors="replace")

    def sign_in(self, email: str) -> None:
        result = self.api_post("/auth/dev/impersonate", {"identifier": email})
        self.csrf = result.get("csrf_token", "")


class Report:
    def __init__(self) -> None:
        self.passed = 0
        self.failed: list[str] = []

    def check(self, name: str, condition: bool, detail: str = "") -> None:
        if condition:
            self.passed += 1
            print("  ok    " + name)
        else:
            self.failed.append(name + (" - " + detail if detail else ""))
            print("  FAIL  " + name + (" - " + detail if detail else ""))

    def page(self, client: Client, name: str, path: str, *must_contain: str) -> str:
        try:
            html = client.page(path)
        except urllib.error.HTTPError as error:
            self.check(name, False, "HTTP " + str(error.code) + " on " + path)
            return ""
        except Exception as error:  # noqa: BLE001
            self.check(name, False, str(error))
            return ""

        missing = [text for text in must_contain if text not in html]
        if "Application error" in html or "server-side exception" in html:
            self.check(name, False, "the page rendered an application error")
        else:
            self.check(name, not missing, "missing: " + ", ".join(missing) if missing else "")
        return html


def main() -> int:
    parser = argparse.ArgumentParser(description="Walk the core PramaanSetu pages")
    parser.add_argument("--web", default=DEFAULT_WEB)
    parser.add_argument("--api", default=DEFAULT_API)
    args = parser.parse_args()

    client = Client(args.web, args.api)
    report = Report()

    print("Public pages")
    report.page(client, "landing", "/", "PramaanSetu", "evidence")
    report.page(client, "challenge board", "/challenges-board", "Challenge board")
    report.page(client, "demand", "/demand", "demand")
    report.page(client, "transparency", "/transparency", "Transparency")
    report.page(client, "validated evidence", "/evidence", "Validated evidence")
    report.page(client, "sign in", "/signin", "Sign in to PramaanSetu")
    report.page(client, "missing record", "/challenges/does-not-exist", "was not found")

    try:
        health = client.api_get("/healthz")
        report.check("api healthy", health.get("status") == "ok")
        status = client.api_get("/status")
        report.check("scheduler healthy", bool(status["scheduler"]["healthy"]))
        report.check("no active alerts", not status["alerts"], str(status["alerts"]))
    except Exception as error:  # noqa: BLE001
        report.check("api reachable", False, str(error))
        return _finish(report)

    # Find the seeded records to open.
    board = client.api_get("/public/challenges?limit=50&include_closed=true")
    challenge_id = board["items"][0]["id"] if board["items"] else None
    passports = client.api_get("/public/passports?limit=1")

    print("")
    print("Department Officer")
    client.sign_in("anita.deshmukh@pmc.gov.in")
    report.page(client, "task inbox", "/home", "What needs you", "Items waiting for your action")
    report.page(client, "challenge list", "/challenges", "Challenges")
    report.page(client, "new challenge", "/challenges/new", "Write a new challenge")
    report.page(client, "pilot list", "/pilots", "Pilots")

    pilots = client.api_get("/pilots?limit=5")
    pilot_id = pilots["items"][0]["id"] if pilots["items"] else None
    scaled = [
        item
        for item in client.api_get("/challenges?mine=true&limit=50")["items"]
        if item["state"] == "Scaled"
    ]
    flagship_id = scaled[0]["id"] if scaled else challenge_id

    if flagship_id:
        report.page(client, "challenge record", "/challenges/" + flagship_id, "The record", "Measures")
        report.page(client, "challenge audit", "/challenges/" + flagship_id + "/audit", "Audit trail")
        report.page(
            client, "screening", "/challenges/" + flagship_id + "/screening", "eligibility"
        )
        report.page(client, "ranking", "/challenges/" + flagship_id + "/ranking", "Ranking")
        report.page(client, "panel", "/challenges/" + flagship_id + "/panel", "Evaluation panel")
    if pilot_id:
        report.page(client, "pilot record", "/pilots/" + pilot_id, "The pre-registered plan")
        report.page(client, "simulator", "/pilots/" + pilot_id + "/design", "Pilot Flight Simulator")
        report.page(client, "agreement", "/pilots/" + pilot_id + "/agreement", "Pilot agreement")
        report.page(client, "measurements", "/pilots/" + pilot_id + "/metrics", "Measurements")
        report.page(client, "milestones", "/pilots/" + pilot_id + "/milestones", "Milestones")
        report.page(
            client, "evidence report", "/pilots/" + pilot_id + "/evidence",
            "Evidence Confidence Score", "Reproducibility",
        )

    print("")
    print("Department Approver")
    client.sign_in("ramesh.kulkarni@pmc.gov.in")
    report.page(client, "approver inbox", "/home", "What needs you")
    if pilot_id:
        report.page(
            client, "pathway and decision", "/pilots/" + pilot_id + "/decision",
            "procurement",
        )

    print("")
    print("Finance Officer")
    client.sign_in("sunita.pawar@pmc.gov.in")
    report.page(client, "payment queue", "/finance", "Payment queue")

    print("")
    print("Expert Evaluator")
    client.sign_in("sanjay.rane@iitb.ac.in")
    report.page(client, "panel work", "/evaluation", "My panel work")

    print("")
    print("Independent Validator")
    client.sign_in("anjali.rao@nabl.gov.in")
    report.page(client, "validation queue", "/validation", "Validation queue")

    print("")
    print("Platform Admin")
    client.sign_in("admin@pramaansetu.gov.in")
    report.page(client, "administration", "/admin", "Administration", "Background work")
    report.page(client, "audit", "/admin/audit", "Audit trail", "How the chain works")
    report.page(client, "users", "/admin/users", "Users and roles")
    report.page(client, "templates", "/admin/templates", "Template Kit")
    report.page(client, "jobs", "/admin/jobs", "Background jobs")

    verification = client.api_post("/admin/audit/verify")
    report.check(
        "audit chain intact",
        bool(verification.get("verified")),
        str(verification.get("detail", "")),
    )

    if passports["items"]:
        print("")
        print("Reuse")
        client.sign_in("praveen.sharma@jmcg.gov.in")
        listing = client.api_get("/passports?limit=1")
        if listing["items"]:
            passport = listing["items"][0]
            report.page(
                client, "innovation passport", "/evidence/" + passport["id"],
                "What was measured", "Reuse this evidence",
            )
            report.page(
                client, "shared passport link",
                "/passports/shared/" + passport["share_token"],
                "read-only", "What was measured",
            )

    return _finish(report)


def _finish(report: Report) -> int:
    print("")
    if report.failed:
        print(str(len(report.failed)) + " check(s) failed:")
        for failure in report.failed:
            print("  " + failure)
        return 1
    print("All " + str(report.passed) + " checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
