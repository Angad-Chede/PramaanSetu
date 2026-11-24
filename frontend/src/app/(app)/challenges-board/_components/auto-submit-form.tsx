"use client";

import * as React from "react";

/** A GET filter form that applies itself when a select or toggle changes. */
export function AutoSubmitForm({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = React.useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      method="get"
      role="search"
      className={className}
      onChange={(event) => {
        const target = event.target as HTMLElement;
        if (target.tagName === "SELECT" || (target as HTMLInputElement).type === "checkbox") ref.current?.requestSubmit();
      }}
    >
      {children}
    </form>
  );
}
