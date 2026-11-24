// Contention test (PRD 10.10): 50 concurrent approve calls on one milestone.
//
//   k6 run -e BASE_URL=http://localhost:8000 -e MILESTONE_ID=... -e EMAIL=... loadtest/contention.js
//
// Pass criteria: exactly one call succeeds, 49 receive 409, and the platform records one
// audit entry and one notification set. The audit and notification checks run in the
// Python concurrency tests; this script proves the behaviour over real HTTP.

import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";
import exec from "k6/execution";

const BASE = __ENV.BASE_URL || "http://localhost:8000";
const API = BASE + "/api/v1";
const MILESTONE_ID = __ENV.MILESTONE_ID;
const EMAIL = __ENV.EMAIL || "ramesh.kulkarni@pmc.gov.in";

const accepted = new Counter("approvals_accepted");
const conflicted = new Counter("approvals_conflicted");
const unexpected = new Counter("approvals_unexpected");

export const options = {
  scenarios: {
    stampede: {
      executor: "shared-iterations",
      vus: 50,
      iterations: 50,
      maxDuration: "1m",
    },
  },
  thresholds: {
    // Exactly one approval may succeed, whatever the concurrency.
    approvals_accepted: ["count==1"],
    approvals_conflicted: ["count==49"],
    approvals_unexpected: ["count==0"],
  },
};

export function setup() {
  if (!MILESTONE_ID) {
    throw new Error(
      "Set MILESTONE_ID to a milestone in the Accepted state. " +
        "The seed script prints the pilot reference; the milestone list endpoint gives the id.",
    );
  }
  const signIn = http.post(
    API + "/auth/dev/impersonate",
    JSON.stringify({ identifier: EMAIL }),
    { headers: { "Content-Type": "application/json" } },
  );
  check(signIn, { "signed in": (r) => r.status === 200 });
  return {
    cookies: signIn.cookies,
    csrf: signIn.json("csrf_token"),
  };
}

export default function (data) {
  const response = http.post(
    API + "/milestones/" + MILESTONE_ID + "/approve-payment",
    JSON.stringify({}),
    {
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": data.csrf,
        // A distinct idempotency key per virtual user, so this measures genuine
        // contention rather than idempotent replay.
        "Idempotency-Key": "contention-" + exec.vu.idInTest,
      },
      jar: http.cookieJar(),
    },
  );

  if (response.status === 200) {
    accepted.add(1);
  } else if (response.status === 409) {
    conflicted.add(1);
    check(response, {
      "conflict explains the current state": (r) =>
        String(r.body).includes("state") || String(r.body).includes("version"),
    });
  } else {
    unexpected.add(1);
    console.error("unexpected status " + response.status + ": " + response.body);
  }
}

export function handleSummary(data) {
  const count = (name) => data.metrics[name]?.values.count ?? 0;
  return {
    stdout:
      [
        "PramaanSetu contention test",
        "approvals accepted:   " + count("approvals_accepted") + " (must be 1)",
        "approvals conflicted: " + count("approvals_conflicted") + " (must be 49)",
        "unexpected responses: " + count("approvals_unexpected") + " (must be 0)",
      ].join("\n") + "\n",
  };
}
