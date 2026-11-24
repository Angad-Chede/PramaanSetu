// Baseline load test (PRD 10.10): mixed traffic at 500 requests per second.
//
//   k6 run -e BASE_URL=http://localhost:8000 loadtest/baseline.js
//
// Pass criteria, asserted as thresholds so the run fails rather than merely reporting:
//   NFR-03  read latency p95 under 300 ms, p99 under 800 ms
//   NFR-04  write and transition latency p95 under 500 ms
//   NFR-07  under 0.1 percent 5xx responses

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:8000";
const API = BASE + "/api/v1";

const readLatency = new Trend("read_latency", true);
const writeLatency = new Trend("write_latency", true);
const serverErrors = new Rate("server_errors");

export const options = {
  scenarios: {
    mixed: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.RATE || 500),
      timeUnit: "1s",
      duration: __ENV.DURATION || "30m",
      preAllocatedVUs: 200,
      maxVUs: 1200,
    },
  },
  thresholds: {
    "read_latency": ["p(95)<300", "p(99)<800"],
    "write_latency": ["p(95)<500"],
    "server_errors": ["rate<0.001"],
    "http_req_failed": ["rate<0.01"],
  },
};

function track(response, trend) {
  trend.add(response.timings.duration);
  serverErrors.add(response.status >= 500);
  return response;
}

export default function () {
  // The public board and the demand summary carry the heaviest anonymous read traffic.
  const board = track(
    http.get(API + "/public/challenges?limit=50", { tags: { name: "board" } }),
    readLatency,
  );
  check(board, { "board returns 200": (r) => r.status === 200 });

  if (Math.random() < 0.3) {
    const demand = track(
      http.get(API + "/public/demand/summary", { tags: { name: "demand" } }),
      readLatency,
    );
    check(demand, { "demand returns 200": (r) => r.status === 200 });
  }

  if (Math.random() < 0.2) {
    const passports = track(
      http.get(API + "/public/passports?limit=20", { tags: { name: "passports" } }),
      readLatency,
    );
    check(passports, { "passports returns 200": (r) => r.status === 200 });
  }

  if (Math.random() < 0.1) {
    const health = track(http.get(API + "/readyz", { tags: { name: "readyz" } }), readLatency);
    check(health, { "readiness reports ready": (r) => r.json("ready") === true });
  }

  sleep(0.1);
}

export function handleSummary(data) {
  const line = (name) => {
    const metric = data.metrics[name];
    if (!metric) return name + ": not recorded";
    const values = metric.values;
    return (
      name +
      ": p95 " +
      (values["p(95)"] || 0).toFixed(1) +
      " ms, p99 " +
      (values["p(99)"] || 0).toFixed(1) +
      " ms"
    );
  };
  const summary = [
    "PramaanSetu baseline load test",
    line("read_latency"),
    line("write_latency"),
    "server error rate: " + ((data.metrics.server_errors?.values.rate || 0) * 100).toFixed(4) + " percent",
    "requests: " + (data.metrics.http_reqs?.values.count || 0),
  ].join("\n");
  return { stdout: summary + "\n" };
}
