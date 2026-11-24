import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  BellOff,
  CheckCheck,
  ClipboardCheck,
  FileStack,
  FlaskConical,
  Gauge,
  IndianRupee,
  ShieldCheck,
  Stamp,
  type LucideIcon,
} from "lucide-react";

import { markNotificationsRead } from "@/app/actions";
import { SubmitButton } from "@/components/app/forms";
import { Deadline, EmptyState, Flash, Page, PageHeader, Panel, ToneBadge } from "@/components/app/kit";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { requireSession } from "@/lib/session";
import type { Notification } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const AREA_ICONS: Record<string, LucideIcon> = {
  milestone: IndianRupee,
  challenge: FileStack,
  application: ClipboardCheck,
  evidence: BadgeCheck,
  pilot: FlaskConical,
  passport: ShieldCheck,
  scale: Stamp,
  evaluation: Gauge,
};

function iconFor(type: string): LucideIcon {
  return AREA_ICONS[type.split(".")[0]] ?? Bell;
}

function dayKey(value: string): string {
  const day = formatDate(value);
  const todayLabel = formatDate(new Date().toISOString());
  const yesterday = formatDate(new Date(Date.now() - 86400000).toISOString());
  if (day === todayLabel) return "Today";
  if (day === yesterday) return "Yesterday";
  return day;
}

export default async function NotificationsPage({ searchParams }: Props) {
  const params = await searchParams;
  await requireSession("/notifications");
  const body = await apiGet<{ items: Notification[]; unread_count: number }>("/me/notifications?limit=100");

  const actionRequired = body.items.filter((n) => n.action_required && !n.read);
  const rest = body.items.filter((n) => !(n.action_required && !n.read));

  const days: { day: string; items: Notification[] }[] = [];
  for (const item of rest) {
    const day = dayKey(item.created_at);
    const group = days.find((entry) => entry.day === day);
    if (group) group.items.push(item);
    else days.push({ day, items: [item] });
  }

  return (
    <Page width="narrow">
      <PageHeader
        title="Notifications"
        description="Every message says what happened, what is needed, by whom and by when. Items that need you come first and are never folded into a digest."
        meta={
          <ToneBadge tone={body.unread_count ? "brand" : "neutral"}>
            {body.unread_count ? `${body.unread_count} unread` : "All read"}
          </ToneBadge>
        }
        actions={
          body.unread_count ? (
            <form action={markNotificationsRead}>
              <SubmitButton variant="secondary" pendingLabel="Marking">
                <CheckCheck />
                Mark all as read
              </SubmitButton>
            </form>
          ) : null
        }
      />

      <Flash searchParams={params} />

      <Panel
        title={
          <span className="inline-flex items-center gap-2">
            Needs your action
            {actionRequired.length > 0 && (
              <span className="grid min-w-5 place-items-center rounded-full bg-brand px-1.5 text-[11px] leading-5 font-semibold text-brand-foreground tabular-nums">
                {actionRequired.length}
              </span>
            )}
          </span>
        }
        description="These are waiting on you. Each one links straight to the action."
        flush
      >
        {actionRequired.length ? (
          <ul className="border-t border-border/70">
            {actionRequired.map((item, index) => (
              <NotificationRow key={item.id} item={item} featured divided={index > 0} />
            ))}
          </ul>
        ) : (
          <div className="mx-5 mb-5 flex items-center gap-3 rounded-2xl bg-success/10 px-4 py-3.5 text-sm md:mx-6">
            <BadgeCheck className="size-4 shrink-0 text-success" />
            <span className="text-foreground">Nothing is waiting on you.</span>
          </div>
        )}
      </Panel>

      {days.length ? (
        <div className="flex flex-col gap-6">
          {days.map((group) => (
            <section key={group.day} className="flex flex-col gap-2">
              <h2 className="sticky top-14 z-10 -mx-1 bg-background/85 px-1 py-2 text-[12px] font-medium tracking-wide text-muted-foreground uppercase backdrop-blur">
                {group.day}
              </h2>
              <ul className="overflow-hidden rounded-3xl bg-card shadow-card">
                {group.items.map((item, index) => (
                  <NotificationRow key={item.id} item={item} divided={index > 0} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState icon={BellOff} title="No other notifications yet" description="Updates on the challenges, pilots and payments you are part of will collect here." />
      )}
    </Page>
  );
}

function NotificationRow({ item, featured = false, divided = false }: { item: Notification; featured?: boolean; divided?: boolean }) {
  const Icon = iconFor(item.type);
  return (
    <li className={cn("relative flex gap-4 px-5 py-4 md:px-6", divided && "border-t border-border/70")}>
      <span className="relative h-fit shrink-0">
        <span
          className={cn(
            "grid size-10 place-items-center rounded-2xl",
            featured ? "bg-brand/12 text-brand-ink" : item.read ? "bg-surface text-glyph" : "bg-foreground text-background",
          )}
        >
          <Icon className="size-4" />
        </span>
        {!item.read && <span aria-hidden className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-brand ring-2 ring-card" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className={cn("text-sm text-pretty", item.read ? "text-foreground/80" : "font-medium text-foreground")}>
          {item.title}
          {!item.read && <span className="sr-only"> (unread)</span>}
        </p>
        <p className="text-[13px] leading-relaxed whitespace-pre-line text-pretty text-muted-foreground">{item.body}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-muted-foreground">
          <time dateTime={item.created_at} className="tabular-nums">
            {formatDateTime(item.created_at)}
          </time>
          {item.action_required && !featured && <ToneBadge tone="warning">Action needed</ToneBadge>}
          {item.due_at && <Deadline value={item.due_at} />}
          {item.link && (
            <Link href={item.link} className="inline-flex min-h-8 items-center gap-1 font-medium text-foreground sm:hidden">
              Open <ArrowRight className="size-3" />
            </Link>
          )}
        </div>
      </div>
      {item.link && (
        <Button asChild variant={featured ? "secondary" : "ghost"} size="sm" className="hidden shrink-0 self-start sm:inline-flex">
          <Link href={item.link}>
            Open
            <ArrowRight />
          </Link>
        </Button>
      )}
    </li>
  );
}
