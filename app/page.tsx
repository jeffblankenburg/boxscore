import { redirect } from "next/navigation";
import { yesterdayInET } from "@/lib/dates";

// Force per-request rendering — otherwise Next.js prerenders the homepage
// at build time and the redirect is frozen to whatever yesterday was when
// we last deployed.
export const dynamic = "force-dynamic";

export default function HomePage() {
  redirect(`/mlb/${yesterdayInET()}`);
}
