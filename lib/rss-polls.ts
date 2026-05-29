import { supabaseAdmin } from "./supabase";

// Parse the aggregator name + subscriber count out of a feed-reader User-Agent.
// Common shapes:
//   "Feedly/1.0 (+http://www.feedly.com/fetcher.html; 5 subscribers)"
//   "feedbin/2.0 (https://feedbin.com/site/contact; 3 subscribers)"
//   "Inoreader/1.0 (10 subscribers; http://...)"
//   "NewsBlur Feed Fetcher - 2 subscribers (...)"
//   "Mozilla/5.0 (NetNewsWire/6.1; ...)"  -- individual reader, no count
//
// Returns `{ aggregator: "Feedly", subscribers: 5 }` for aggregators that
// advertise the count, `{ aggregator: <best-guess name>, subscribers: null }`
// for individual readers, and `{ aggregator: null, subscribers: null }` when
// the UA isn't recognizable (curl, no UA, etc.). Individual rows still count
// as one human reader downstream.
export function parseFeedUserAgent(ua: string | null | undefined): {
  aggregator: string | null;
  subscribers: number | null;
} {
  if (!ua) return { aggregator: null, subscribers: null };
  const subMatch = ua.match(/(\d+)\s+subscribers?/i);
  const subscribers = subMatch ? parseInt(subMatch[1]!, 10) : null;

  // Heuristic name extraction: the first token before a "/" or " " that looks
  // like an identifier. Covers the common Aggregator/Version pattern at the
  // start of the UA, plus the embedded form ("Mozilla/5.0 (NetNewsWire/...").
  let aggregator: string | null = null;
  const head = ua.match(/^([A-Za-z][\w.-]+)/);
  if (head && head[1] && !/^Mozilla$/i.test(head[1])) {
    aggregator = head[1];
  } else {
    // Look inside parens for a Name/Version token (NetNewsWire, Reeder, etc.)
    const inner = ua.match(/[(\s]([A-Za-z][\w.-]+)\/\d/);
    if (inner) aggregator = inner[1] ?? null;
  }

  return { aggregator, subscribers };
}

// Insert a poll row. Errors are logged but don't bubble — the RSS response
// must succeed regardless of whether the side-effect insert worked.
export async function logRssPoll(args: {
  sport: string;
  userAgent: string | null;
}): Promise<void> {
  const ua = (args.userAgent ?? "").slice(0, 500);
  const { aggregator, subscribers } = parseFeedUserAgent(ua);
  try {
    const { error } = await supabaseAdmin().from("rss_polls").insert({
      sport: args.sport,
      user_agent: ua || null,
      aggregator,
      subscribers,
    });
    if (error) console.error(`logRssPoll: ${error.message}`);
  } catch (e) {
    console.error(`logRssPoll exception: ${(e as Error).message}`);
  }
}
