"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, ChevronDown, CloudCheck, Loader2, TriangleAlert } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

type ButtonVariant = "default" | "brand" | "secondary" | "outline" | "ghost" | "destructive";
type ButtonSize = "default" | "sm" | "lg";

/**
 * A submit button that cannot be double clicked. With `confirm`, it asks first in a
 * dialog, which is how every one-way step (approve, release, sign off) is guarded.
 */
export function SubmitButton({
  children,
  variant = "default",
  size = "default",
  pendingLabel,
  confirm,
  confirmTitle,
  confirmLabel,
  name,
  value,
  disabled,
  formAction,
  className,
}: {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  pendingLabel?: string;
  /** the body of a confirmation dialog shown before submitting */
  confirm?: string;
  confirmTitle?: string;
  confirmLabel?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
  /** overrides the form's own action, so one form can offer save and submit */
  formAction?: (formData: FormData) => void | Promise<void>;
  className?: string;
}) {
  const { pending, data } = useFormStatus();
  const ref = React.useRef<HTMLButtonElement>(null);
  const confirmed = React.useRef(false);
  const [asking, setAsking] = React.useState(false);
  // only the button that submitted shows the spinner
  const mine = pending && (!name || data?.get(name) === (value ?? "")) ;

  return (
    <>
      <Button
        ref={ref}
        type="submit"
        name={name}
        value={value}
        formAction={formAction}
        variant={variant}
        size={size}
        loading={mine}
        disabled={disabled || pending}
        className={className}
        onClick={(event) => {
          if (confirm && !confirmed.current) {
            event.preventDefault();
            setAsking(true);
          }
          confirmed.current = false;
        }}
      >
        {mine && pendingLabel ? pendingLabel : children}
      </Button>
      {confirm && (
        <AlertDialog open={asking} onOpenChange={setAsking}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirmTitle ?? "Are you sure?"}</AlertDialogTitle>
              <AlertDialogDescription>{confirm}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Go back</AlertDialogCancel>
              <AlertDialogAction
                className={variant === "destructive" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
                onClick={() => {
                  confirmed.current = true;
                  setAsking(false);
                  // wait for the dialog to release focus, then press the real button
                  requestAnimationFrame(() => ref.current?.click());
                }}
              >
                {confirmLabel ?? (typeof children === "string" ? children : "Continue")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Fields: labelled native controls, so FormData and server actions just work  */
/* -------------------------------------------------------------------------- */

type FieldShell = {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string;
  className?: string;
  optional?: boolean;
};

function Shell({ id, label, hint, error, className, optional, children }: FieldShell & { id: string; children: React.ReactNode }) {
  return (
    <Field data-invalid={error ? true : undefined} className={className}>
      <FieldLabel htmlFor={id}>
        {label}
        {optional && <span className="font-normal text-muted-foreground">Optional</span>}
      </FieldLabel>
      {children}
      {hint && !error && <FieldDescription>{hint}</FieldDescription>}
      <FieldError>{error}</FieldError>
    </Field>
  );
}

export function TextField({
  label,
  hint,
  error,
  className,
  optional,
  id,
  ...props
}: FieldShell & Omit<React.ComponentProps<"input">, "className">) {
  const auto = React.useId();
  const fieldId = id ?? props.name ?? auto;
  return (
    <Shell id={fieldId} label={label} hint={hint} error={error} className={className} optional={optional}>
      <Input id={fieldId} aria-invalid={error ? true : undefined} {...props} />
    </Shell>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  className,
  optional,
  id,
  rows = 4,
  ...props
}: FieldShell & Omit<React.ComponentProps<"textarea">, "className">) {
  const auto = React.useId();
  const fieldId = id ?? props.name ?? auto;
  return (
    <Shell id={fieldId} label={label} hint={hint} error={error} className={className} optional={optional}>
      <Textarea id={fieldId} rows={rows} aria-invalid={error ? true : undefined} {...props} />
    </Shell>
  );
}

export function SelectField({
  label,
  hint,
  error,
  className,
  optional,
  id,
  options,
  placeholder,
  ...props
}: FieldShell &
  Omit<React.ComponentProps<"select">, "className" | "size"> & {
    options: { value: string; label: string }[];
    placeholder?: string;
  }) {
  const auto = React.useId();
  const fieldId = id ?? props.name ?? auto;
  return (
    <Shell id={fieldId} label={label} hint={hint} error={error} className={className} optional={optional}>
      <NativeSelect id={fieldId} aria-invalid={error ? true : undefined} {...props}>
        {placeholder !== undefined && <NativeSelectOption value="">{placeholder}</NativeSelectOption>}
        {options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Shell>
  );
}

/** A checkbox that posts "yes" when ticked, matching the server actions' checkbox(). */
export function CheckField({
  name,
  label,
  hint,
  defaultChecked,
  required,
  className,
  value = "yes",
}: {
  name: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  defaultChecked?: boolean;
  required?: boolean;
  className?: string;
  value?: string;
}) {
  const id = React.useId();
  return (
    <Field orientation="horizontal" className={className}>
      <Checkbox id={id} name={name} value={value} defaultChecked={defaultChecked} required={required} />
      <FieldContent>
        <FieldLabel htmlFor={id} className="leading-snug">
          {label}
        </FieldLabel>
        {hint && <FieldDescription>{hint}</FieldDescription>}
      </FieldContent>
    </Field>
  );
}

/** A two-step confirmation for an action that cannot be undone. */
export function ConfirmCheckbox({ name, label, help }: { name: string; label: string; help?: string }) {
  return (
    <div className="rounded-2xl bg-warning/10 px-4 py-3.5">
      <CheckField name={name} label={label} hint={help} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Autosave                                                                    */
/* -------------------------------------------------------------------------- */

/** Autosave every 10 seconds and on field blur, so no work is ever lost (FR-CB-05). */
export function AutosaveForm({
  action,
  children,
  intervalMs = 10000,
  className,
  id,
}: {
  action: (formData: FormData) => Promise<void> | void;
  children: React.ReactNode;
  intervalMs?: number;
  className?: string;
  id?: string;
}) {
  const formRef = React.useRef<HTMLFormElement>(null);
  const dirtyRef = React.useRef(false);
  const savingRef = React.useRef(false);
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const save = React.useCallback(async () => {
    const form = formRef.current;
    if (!form || !dirtyRef.current || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await action(new FormData(form));
      dirtyRef.current = false;
      setSavedAt(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));
    } catch {
      // a failed autosave is not fatal: the officer can still submit the form
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [action]);

  React.useEffect(() => {
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
  }, [intervalMs, save]);

  return (
    <form
      id={id}
      ref={formRef}
      action={action}
      className={className}
      onChange={() => {
        dirtyRef.current = true;
      }}
      onBlur={() => void save()}
    >
      {children}
      <SaveStatus saving={saving} savedAt={savedAt} />
    </form>
  );
}

function SaveStatus({ saving, savedAt }: { saving: boolean; savedAt: string | null }) {
  return (
    <p aria-live="polite" className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
      {saving ? <Loader2 className="size-3.5 animate-spin" /> : <CloudCheck className="size-3.5" />}
      {saving ? "Saving your draft" : savedAt ? `Draft saved at ${savedAt}` : "Drafts save automatically"}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Jobs                                                                        */
/* -------------------------------------------------------------------------- */

/** Poll a queued job until it finishes, then reload the page (PRD 7.5). */
export function JobWatcher({ jobId, label }: { jobId: string; label: string }) {
  const [status, setStatus] = React.useState("Queued");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
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
          if (job.status === "Succeeded") window.location.reload();
          else setError(job.error ?? "The job did not complete. You can continue with the form.");
        }
      } catch {
        // transient network trouble: the next tick tries again
      }
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [jobId]);

  if (error) {
    return (
      <div role="status" className="flex gap-3 rounded-2xl bg-warning/10 px-4 py-3.5 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
        <div>
          <p className="font-medium text-foreground">{label} did not complete</p>
          <p className="mt-0.5 text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div aria-live="polite" className="relative flex gap-3 overflow-hidden rounded-2xl bg-info/8 px-4 py-3.5 text-sm">
      <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-info" />
      <div>
        <p className="font-medium text-foreground">{label} is running</p>
        <p className="mt-0.5 text-muted-foreground">Status: {status}. This page refreshes by itself when the result is ready.</p>
      </div>
      <span className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
        <span className="block h-full w-1/3 animate-[job-sweep_1.6s_ease-in-out_infinite] rounded-full bg-info/60" />
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Disclosure                                                                  */
/* -------------------------------------------------------------------------- */

export function Disclosure({ summary, children, defaultOpen = false, className }: { summary: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const reduced = useReducedMotion();
  return (
    <div className={cn("rounded-2xl bg-surface/70", className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {summary}
        <ChevronDown className={cn("size-4 text-glyph transition-transform duration-300 ease-ios", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduced ? { duration: 0 } : { duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A small success tick for inline confirmations. */
export function Done({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-success-ink">
      <CheckCircle2 className="size-3.5" />
      {children}
    </span>
  );
}
