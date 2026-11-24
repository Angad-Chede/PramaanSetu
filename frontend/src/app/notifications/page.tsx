import type { Metadata } from "next";
import Link from "next/link";

import { markNotificationsRead } from "@/app/actions";
import { SubmitButton } from "@/components/forms";
import { Callout, EmptyState, PageHeader, Pill, Section, Timestamp } from "@/components/ui";
import { apiGet } from "@/lib/api";
import { readNotice } from "@/lib/forms";
import { requireSession } from "@/lib/session";
import type { Notification } from "@/lib/types";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireSession("/notifications");
  const body = await apiGet<{ items: Notification[]; unread_count: number }>(
    "/me/notifications?limit=100",
  );
  const notice = readNotice(searchParams);

  const actionRequired = body.items.filter((n) => n.action_required && !n.read);
  const rest = body.items.filter((n) => !(n.action_required && !n.read));

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle="Every message says what happened, what is needed, by whom and by when. Items needing action are listed first and are never folded into a digest."
        meta={
          <Pill tone={body.unread_count ? "warn" : "neutral"}>
            {body.unread_count} unread
          </Pill>
        }
        actions={
          body.unread_count ? (
            <form action={markNotificationsRead}>
              <SubmitButton variant="secondary">Mark all as read</SubmitButton>
            </form>
          ) : null
        }
      />

      {notice ? (
        <div className="mb-5">
          <Callout tone="good">{notice}</Callout>
        </div>
      ) : null}

      <Section
        title="Needs your action"
        description="These items are waiting on you. Each links straight to the action."
      >
        {actionRequired.length ? (
          <ul className="divide-y divide-line">
            {actionRequired.map((item) => (
              <NotificationRow key={item.id} item={item} />
            ))}
          </ul>
        ) : (
          <EmptyState message="Nothing is waiting on you." />
        )}
      </Section>

      <Section title="Everything else">
        {rest.length ? (
          <ul className="divide-y divide-line">
            {rest.map((item) => (
              <NotificationRow key={item.id} item={item} />
            ))}
          </ul>
        ) : (
          <EmptyState message="No other notifications yet." />
        )}
      </Section>
    </div>
  );
}

function NotificationRow({ item }: { item: Notification }) {
  return (
    <li className="py-4">
      <div className="flex flex-wrap items-center gap-2">
        {item.action_required ? <Pill tone="warn">Action needed</Pill> : null}
        {item.read ? null : <Pill tone="neutral">Unread</Pill>}
        <span className="text-sm text-ink-muted">
          <Timestamp value={item.created_at} />
        </span>
      </div>
      <p className="mt-1 font-medium text-ink">{item.title}</p>
      <p className="mt-0.5 max-w-prose whitespace-pre-line text-sm text-ink-soft">{item.body}</p>
      {item.link ? (
        <p className="mt-2 text-sm">
          <Link href={item.link}>Open this item</Link>
        </p>
      ) : null}
    </li>
  );
}
