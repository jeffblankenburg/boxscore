// One-off cleanup after the UTC→ET puzzle-date rollover change.
//
// Tonight (2026-06-10 ET / 2026-06-11 UTC) the page transitioned from
// computing today's date in UTC to computing it in America/New_York.
// During the transition, the picker wrote two puzzle_picks rows:
//
//   2026-06-11  line-661851    (old UTC code, picked at 20:45 ET — Jeff solved this)
//   2026-06-10  line-1564987   (new ET code, picked at 21:34 ET — orphan)
//
// And Jeff's attempt on line-661851 is keyed under puzzle_date=2026-06-11.
// Under the new ET system, that's "tomorrow," so today's page shows him
// a fresh line-1564987 instead of his solved line-661851.
//
// Fix: collapse the swap so today (2026-06-10) is line-661851 (what Jeff
// solved) and tomorrow's slot is open for a fresh pick.
//
//   1. Delete puzzle_picks(2026-06-10, line-1564987) — the orphan.
//   2. Move puzzle_picks(2026-06-11, line-661851) → puzzle_date=2026-06-10.
//   3. Move all puzzle_attempts(2026-06-11) → puzzle_date=2026-06-10
//      (only Jeff has one).
//
// Idempotent: re-running after success is a no-op (rows match the
// "fixed" state, no swaps remaining to do).

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SECRET_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });

const ORPHAN_DATE = "2026-06-10";
const ORPHAN_SUBJECT = "line-1564987";
const SOLVED_DATE = "2026-06-11";
const SOLVED_SUBJECT = "line-661851";

async function main() {
  // 1. Delete the orphan pick.
  const { error: delErr, count: delCount } = await sb
    .from("puzzle_picks")
    .delete({ count: "exact" })
    .eq("game", "linescordle")
    .eq("puzzle_date", ORPHAN_DATE)
    .eq("subject_ref", ORPHAN_SUBJECT);
  if (delErr) throw new Error(`delete orphan pick: ${delErr.message}`);
  console.log(`deleted orphan pick rows: ${delCount}`);

  // 2. Move the real pick to today.
  const { error: pickErr, count: pickCount } = await sb
    .from("puzzle_picks")
    .update({ puzzle_date: ORPHAN_DATE }, { count: "exact" })
    .eq("game", "linescordle")
    .eq("puzzle_date", SOLVED_DATE)
    .eq("subject_ref", SOLVED_SUBJECT);
  if (pickErr) throw new Error(`move solved pick: ${pickErr.message}`);
  console.log(`moved solved pick rows: ${pickCount}`);

  // 3. Move Jeff's (and anyone else's) attempt on the solved subject.
  const { error: atErr, count: atCount } = await sb
    .from("puzzle_attempts")
    .update({ puzzle_date: ORPHAN_DATE }, { count: "exact" })
    .eq("game", "linescordle")
    .eq("puzzle_date", SOLVED_DATE)
    .eq("puzzle_subject_id", SOLVED_SUBJECT);
  if (atErr) throw new Error(`move attempts: ${atErr.message}`);
  console.log(`moved attempt rows: ${atCount}`);

  // 4. Verify final state.
  const { data: picks } = await sb
    .from("puzzle_picks")
    .select("puzzle_date, subject_ref, picked_at")
    .eq("game", "linescordle")
    .in("puzzle_date", [ORPHAN_DATE, SOLVED_DATE])
    .order("puzzle_date");
  console.log("post-fix picks:", JSON.stringify(picks, null, 2));

  const { data: attempts } = await sb
    .from("puzzle_attempts")
    .select("subscriber_id, puzzle_date, puzzle_subject_id, solved")
    .eq("game", "linescordle")
    .in("puzzle_date", [ORPHAN_DATE, SOLVED_DATE])
    .order("puzzle_date");
  console.log("post-fix attempts:", JSON.stringify(attempts, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
