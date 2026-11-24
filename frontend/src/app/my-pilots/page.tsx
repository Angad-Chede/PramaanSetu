import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "My pilots" };

/**
 * A startup sees the same pilot list as a department: the API scopes it to the pilots the
 * caller is actually running, so one page serves both and there is no second list to keep
 * in step.
 */
export default function MyPilotsPage() {
  redirect("/pilots");
}
