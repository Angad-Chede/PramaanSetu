"use client";

import * as React from "react";

/**
 * Wakes the API while the visitor is still reading, so the first click after a quiet
 * spell does not wait for a serverless instance to start. One cheap request per page view.
 */
export function WarmUp() {
  React.useEffect(() => {
    void fetch("/api/v1/healthz", { cache: "no-store", priority: "low" } as RequestInit).catch(() => {});
  }, []);
  return null;
}
