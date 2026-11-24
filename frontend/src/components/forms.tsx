"use client";

import { useFormStatus } from "react-dom";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * Small client islands. The pages themselves render on the server; these handle the
 * three things that genuinely need the browser: a submit button that cannot be double
 * clicked, autosave, and a confirmation before a one-way step.
 */

export function SubmitButton({
  children,
  variant = "primary",
  pendingLabel,
  confirm,
  name,
  value,
  disabled,
  formAction,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger";
  pendingLabel?: string;
  confirm?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
  /** Overrides the form's own action, so one form can offer save and submit. */
  formAction?: (formData: FormData) => void | Promise<void>;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      formAction={formAction}
      className={"btn btn-" + variant}
      disabled={pending || disabled}
      aria-busy={pending}
      onClick={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
    >
      {pending ? pendingLabel ?? "Working..." : children}
    </button>
  );
}

/** Autosave every 10 seconds and on field blur, so no work is ever lost (FR-CB-05). */
export function AutosaveForm({
  action,
  children,
  intervalMs = 10000,
  className,
}: {
  action: (formData: FormData) => Promise<void> | void;
  children: ReactNode;
  intervalMs?: number;
  className?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const dirtyRef = useRef(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const form = formRef.current;
    if (!form || !dirtyRef.current || saving) return;
    setSaving(true);
    try {
      await action(new FormData(form));
      dirtyRef.current = false;
      setSavedAt(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));
    } catch {
      // A failed autosave is not fatal: the officer can still submit the form.
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    const timer = window.setInterval(save, intervalMs);
    const warn = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("beforeunload", warn);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs]);

  return (
    <form
      ref={formRef}
      className={className}
      onChange={() => {
        dirtyRef.current = true;
      }}
      onBlur={() => {
        void save();
      }}
    >
      {children}
      <p className="mt-3 text-sm text-ink-muted" aria-live="polite">
        {saving
          ? "Saving your draft..."
          : savedAt
            ? "Draft saved at " + savedAt + ". Your work is kept even if you close this page."
            : "Your draft saves automatically every few seconds."}
      </p>
    </form>
  );
}

/** A two-step confirmation for an action that cannot be undone. */
export function ConfirmCheckbox({
  name,
  label,
  help,
}: {
  name: string;
  label: string;
  help?: string;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <div className="rounded border border-warn bg-warn-light px-4 py-3">
      <div className="flex items-start gap-3">
        <input
          id={name}
          name={name}
          type="checkbox"
          value="yes"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
          className="mt-1 h-4 w-4 shrink-0"
        />
        <div>
          <label htmlFor={name} className="font-medium text-ink">
            {label}
          </label>
          {help ? <p className="mt-0.5 text-sm text-ink-soft">{help}</p> : null}
        </div>
      </div>
    </div>
  );
}

/** Poll a queued job until it finishes, then reload the page (PRD 7.5). */
export function JobWatcher({ jobId, label }: { jobId: string; label: string }) {
  const [status, setStatus] = useState("Queued");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch("/api/v1/jobs/" + jobId, { credentials: "same-origin" });
        if (!response.ok) return;
        const job = await response.json();
        if (cancelled) return;
        setStatus(job.status);
        if (job.done) {
          window.clearInterval(timer);
          if (job.status === "Succeeded") {
            window.location.reload();
          } else {
            setError(job.error ?? "The job did not complete. You can continue with the form.");
          }
        }
      } catch {
        // Transient network trouble: the next tick tries again.
      }
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [jobId]);

  if (error) {
    return (
      <div className="rounded border-l-4 border border-warn bg-warn-light px-4 py-3" role="status">
        <p className="font-semibold text-warn">{label} did not complete</p>
        <p className="mt-1 text-sm text-ink-soft">{error}</p>
      </div>
    );
  }

  return (
    <div className="rounded border-l-4 border border-line-strong bg-paper-soft px-4 py-3" aria-live="polite">
      <p className="font-medium text-ink">{label} is running</p>
      <p className="mt-1 text-sm text-ink-muted">
        Current status: {status}. This page reloads by itself when the result is ready. You can
        keep working in another tab.
      </p>
    </div>
  );
}

/** A disclosure that keeps long reference material out of the way without hiding it. */
export function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="rounded border border-line bg-paper-soft">
      <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-ink">{summary}</summary>
      <div className="border-t border-line px-4 py-3 text-sm text-ink-soft">{children}</div>
    </details>
  );
}
