import { redirect, notFound } from "next/navigation";
import { yesterdayInET } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function SportLatest({
  params,
}: {
  params: Promise<{ sport: string }>;
}) {
  const { sport } = await params;
  if (sport !== "mlb") notFound();
  redirect(`/${sport}/${yesterdayInET()}`);
}
