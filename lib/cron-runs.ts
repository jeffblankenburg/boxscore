import { supabaseAdmin } from "./supabase";

export type CronStatus = "running" | "ok" | "failed";
export type CronTrigger = "cron" | "manual";

export type CronRun = {
  id: string;
  route: string;
  sport: string | null;
  date: string | null;
  status: CronStatus;
  trigger: CronTrigger;
  error: string | null;
  result: unknown;
  started_at: string;
  finished_at: string | null;
};

// Insert a "running" row at the top of a cron route. Returns the run id so
// finishCronRun can update the same row.
export async function startCronRun(args: {
  route: string;
  sport?: string;
  date?: string;
  trigger: CronTrigger;
}): Promise<string> {
  const { data, error } = await supabaseAdmin()
    .from("cron_runs")
    .insert({
      route: args.route,
      sport: args.sport ?? null,
      date: args.date ?? null,
      status: "running" as CronStatus,
      trigger: args.trigger,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) throw new Error(`startCronRun: ${error?.message ?? "no id"}`);
  return data.id;
}

// Mark a run finished (ok or failed). Safe to call even if the original
// startCronRun didn't happen (e.g., the route crashed before it could insert)
// — in that case `id` is null and we no-op.
export async function finishCronRun(
  id: string | null,
  args: { status: "ok" | "failed"; error?: string | null; result?: unknown },
): Promise<void> {
  if (!id) return;
  const { error } = await supabaseAdmin()
    .from("cron_runs")
    .update({
      status: args.status,
      error: args.error ?? null,
      result: args.result ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) {
    console.error(`finishCronRun(${id}): ${error.message}`);
  }
}

// Most recent runs across all routes. Used to render the /admin status table.
export async function recentCronRuns(limit: number = 20): Promise<CronRun[]> {
  const { data, error } = await supabaseAdmin()
    .from("cron_runs")
    .select("id, route, sport, date, status, trigger, error, result, started_at, finished_at")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`recentCronRuns: ${error.message}`);
  return (data ?? []) as CronRun[];
}
