import Link from "next/link";

import { PageHeader, Section } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="That record was not found"
        subtitle="The link may be out of date, the record may have been removed, or you may not have access to it."
      />
      <Section title="What to do next">
        <ul className="list-disc space-y-2 pl-5 text-ink-soft">
          <li>
            Check the address. Record links contain an identifier, so a truncated or edited link
            will not resolve.
          </li>
          <li>
            Go back to your task inbox, which lists everything currently waiting for you, and open
            the record from there.
          </li>
          <li>
            If you believe you should have access, ask the platform administrator to check your role
            assignment and its scope.
          </li>
        </ul>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/home" className="btn btn-primary">
            Go to my tasks
          </Link>
          <Link href="/challenges-board" className="btn btn-secondary">
            Open the challenge board
          </Link>
        </div>
      </Section>
    </div>
  );
}
