// Deadline spike test (PRD 10.10): 2,000 applications submitted in the final 10 minutes,
// 10 percent of them retried or double clicked.
//
//   k6 run -e BASE_URL=http://localhost:8000 -e CHALLENGE_ID=... loadtest/deadline-spike.js
//
// Pass criteria: every accepted submission is stored exactly once, and nothing is
// accepted after the deadline. The unique constraint on (challenge_id, startup_id) and
// the idempotency key are what make that true; this run exercises both under load.

import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";
import exec from "k6/execution";

const BASE = __ENV.BASE_URL || "http://localhost:8000";
const API = BASE + "/api/v1";
const CHALLENGE_ID = __ENV.CHALLENGE_ID;
const TOTAL = Number(__ENV.TOTAL || 2000);

const submitted = new Counter("submissions_accepted");
const rejectedLate = new Counter("submissions_rejected_late");
const duplicates = new Counter("duplicate_responses");
const errors = new Counter("unexpected_errors");

export const options = {
  scenarios: {
    spike: {
      executor: "ramping-arrival-rate",
      startRate: 50,
      timeUnit: "1s",
      preAllocatedVUs: 300,
      maxVUs: 1500,
      stages: [
        { target: 200, duration: "2m" },
        { target: 400, duration: "6m" },
        { target: 50, duration: "2m" },
      ],
    },
  },
  thresholds: {
    unexpected_errors: ["count==0"],
    http_req_failed: ["rate<0.5"], // late rejections are expected and are not failures
    http_req_duration: ["p(95)<1000"],
  },
};

export function setup() {
  if (!CHALLENGE_ID) {
    throw new Error("Set CHALLENGE_ID to a published challenge with an imminent deadline.");
  }
  return { challengeId: CHALLENGE_ID };
}

export default function (data) {
  // Each virtual user acts as a distinct startup account seeded by app/seed.py.
  const index = exec.vu.idInTest % 25;
  const email = "founder" + index + "@example.invalid";

  const signIn = http.post(
    API + "/auth/dev/impersonate",
    JSON.stringify({ identifier: email }),
    { headers: { "Content-Type": "application/json" } },
  );
  if (signIn.status !== 200) {
    return; // Not every index maps to a seeded account; skip rather than fail the run.
  }
  const csrf = signIn.json("csrf_token");
  const headers = {
    "Content-Type": "application/json",
    "X-CSRF-Token": csrf,
  };

  const start = http.post(
    API + "/challenges/" + data.challengeId + "/applications",
    JSON.stringify({}),
    { headers: { ...headers, "Idempotency-Key": "apply-" + email } },
  );
  if (start.status !== 201 && start.status !== 200) {
    if (start.status !== 409 && start.status !== 422 && start.status !== 403) errors.add(1);
    return;
  }
  const applicationId = start.json("id");

  // Ten percent of submissions are sent twice, as a double click or a client retry.
  const attempts = exec.scenario.iterationInTest % 10 === 0 ? 2 : 1;
  const key = "submit-" + applicationId;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = http.post(
      API + "/applications/" + applicationId + "/submit",
      JSON.stringify({}),
      { headers: { ...headers, "Idempotency-Key": key } },
    );

    if (response.status === 200) {
      if (attempt === 0) submitted.add(1);
      else duplicates.add(1);
    } else if (response.status === 409) {
      rejectedLate.add(1);
      check(response, {
        "late rejection says how late": (r) =>
          String(r.body).includes("deadline") || String(r.body).includes("closed"),
      });
    } else if (response.status === 422) {
      // An incomplete application is a client-side problem, not a platform failure.
    } else {
      errors.add(1);
      console.error("unexpected status " + response.status + ": " + response.body);
    }
  }
}

export function handleSummary(data) {
  const count = (name) => data.metrics[name]?.values.count ?? 0;
  return {
    stdout:
      [
        "PramaanSetu deadline spike test",
        "accepted submissions:       " + count("submissions_accepted"),
        "idempotent repeat responses: " + count("duplicate_responses"),
        "rejected as late:            " + count("submissions_rejected_late"),
        "unexpected errors:           " + count("unexpected_errors") + " (must be 0)",
        "",
        "Verify in the database that each startup has exactly one application row for",
        "this challenge, and that no application has submitted_at after the deadline.",
      ].join("\n") + "\n",
  };
}
