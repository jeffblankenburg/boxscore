// Discord fan-out. For a given (sport, date):
//
//   1. The day's scoreboard image posts ONCE to the sport's league channel
//      (e.g. #mlb) — same publicly-stored PNG the og:image and Bluesky
//      posts use.
//   2. Each completed game's box-score image posts to BOTH team channels
//      (e.g. Diamondbacks @ Dodgers → #arizona-diamondbacks AND
//      #los-angeles-dodgers). Teams that didn't play stay quiet.
//
// Posts are deduped via the social_posts table (platform='discord',
// sub_id = entry.subId for league posts, `${entry.subId}:${team_slug}`
// for per-team posts so the same image to two channels doesn't collide).
//
// Failure policy (per project decision 2026-06-08): log + continue. A
// single broken webhook doesn't block the rest of the fan-out.

import { TEAMS, type Team } from "./teams";
import { type ManifestEntry, type RenderedImage } from "./render-images";
import { hasAlreadyPosted, recordPost } from "./social-posts";
import {
  loadLeagueWebhook, loadTeamWebhooks,
  postToWebhook, markWebhookSuccess, markWebhookFailure,
  type DiscordEmbed, type DiscordMessage, type DiscordWebhookRow,
} from "./discord";

export type DiscordPostOutcome = {
  subId: string;
  channel: string;          // descriptive: "league" or team slug
  url?: string;             // Discord doesn't return a stable message URL via webhook, so this stays empty
  error?: string;
  skipped?: string;         // reason if not posted
};

export type DiscordFanOutResult = {
  posted: number;
  skipped: number;
  failed: number;
  outcomes: DiscordPostOutcome[];
};

// Nickname → Team lookup. ManifestEntry.teams carries nicknames
// ("Diamondbacks", "Dodgers"); we need the slug ("ari", "lad") to find
// the team webhook. Built lazily and cached for the process lifetime.
let nicknameLookup: Map<string, Team> | null = null;
function getNicknameLookup(sport: string): Map<string, Team> {
  if (nicknameLookup) return nicknameLookup;
  const m = new Map<string, Team>();
  for (const t of TEAMS) {
    if (t.sport !== sport) continue;
    m.set(t.nickname, t);
    // Aliases observed in the share-image manifest's `teams` field —
    // e.g. "D-backs" vs "Diamondbacks". Keep this list in sync with
    // OFFICIAL_HASHTAG aliases in social-content.ts.
    if (t.nickname === "Diamondbacks") m.set("D-backs", t);
  }
  nicknameLookup = m;
  return m;
}

function teamColor(team: Team | undefined): number | undefined {
  if (!team?.primary) return undefined;
  const hex = team.primary.replace("#", "");
  const n = parseInt(hex, 16);
  return Number.isFinite(n) ? n : undefined;
}

// ─── Embed builders ─────────────────────────────────────────────────────

/** Entries that post to the sport's league channel (e.g. #mlb-general). */
export type LeagueChannelEntry = Extract<
  ManifestEntry,
  { type: "scoreboard" } | { type: "standings" } | { type: "leaders" }
>;

export function buildLeagueEntryEmbed(args: {
  sport: string;
  entry: LeagueChannelEntry;
  prettyGamesDate: string;       // games_date — for content-anchored entries (scoreboard)
  prettyEditionDate: string;     // edition_date — for morning-snapshot entries (standings/leaders)
  imageUrl: string;
  digestUrl: string;
}): DiscordEmbed {
  const sportLabel = args.sport.toUpperCase();
  let title: string;
  let description: string | undefined;
  if (args.entry.type === "scoreboard") {
    const gamesLabel = args.entry.gameCount === 1 ? "1 game" : `${args.entry.gameCount} games`;
    title = `${sportLabel} Scoreboard · ${args.prettyGamesDate}`;
    description = `Final scores from ${gamesLabel}.`;
  } else if (args.entry.type === "standings") {
    const leagueName = args.entry.league === "AL" ? "American League" : "National League";
    title = `${leagueName} Standings · ${args.prettyEditionDate}`;
  } else {
    const leagueName = args.entry.league === "AL" ? "American League" : "National League";
    title = `${leagueName} Leaders · ${args.prettyEditionDate}`;
  }
  return {
    title,
    url: args.digestUrl,
    description,
    image: { url: args.imageUrl },
    timestamp: new Date().toISOString(),
  };
}

export function buildTeamBoxscoreEmbed(args: {
  title: string;                 // entry.title (e.g. "Diamondbacks @ Dodgers")
  prettyGamesDate: string;
  imageUrl: string;
  digestUrl: string;
  teamColorHex?: string;
}): DiscordEmbed {
  const embed: DiscordEmbed = {
    title: `${args.title} · ${args.prettyGamesDate}`,
    url: args.digestUrl,
    image: { url: args.imageUrl },
    timestamp: new Date().toISOString(),
  };
  if (args.teamColorHex) {
    const n = parseInt(args.teamColorHex.replace("#", ""), 16);
    if (Number.isFinite(n)) embed.color = n;
  }
  return embed;
}

// ─── Fan-out ────────────────────────────────────────────────────────────

/** Post one league-channel image (scoreboard, standings, or leaders) to
 *  the sport's league channel. Caller iterates the manifest and calls this
 *  once per entry so each lands as its own message. Idempotent: skips if
 *  already posted for (sport, date, entry.subId). */
export async function postLeagueEntry(args: {
  sport: string;
  date: string;
  prettyGamesDate: string;
  prettyEditionDate: string;
  entry: LeagueChannelEntry;
  imageUrl: string;
  digestUrl: string;
}): Promise<DiscordPostOutcome> {
  const subId = args.entry.subId;
  if (await hasAlreadyPosted("discord", args.sport, args.date, subId)) {
    return { subId, channel: "league", skipped: "already posted" };
  }
  const webhook = await loadLeagueWebhook(args.sport);
  if (!webhook) {
    return { subId, channel: "league", skipped: "no league webhook configured" };
  }
  const embed = buildLeagueEntryEmbed(args);
  const message: DiscordMessage = { embeds: [embed] };
  return await sendWithLogging({
    webhook, message, subId, channel: "league",
    sport: args.sport, date: args.date,
  });
}

/** Post each completed game's box-score image to BOTH team channels.
 *  Per-team post is deduped via sub_id = `${entry.subId}:${team_slug}`. */
export async function postBoxscoresToTeams(args: {
  sport: string;
  date: string;
  prettyGamesDate: string;
  boxscores: Array<{ entry: Extract<ManifestEntry, { type: "boxscore" }>; imageUrl: string }>;
  digestUrl: string;
}): Promise<DiscordPostOutcome[]> {
  const teamWebhooks = await loadTeamWebhooks(args.sport);
  const nick = getNicknameLookup(args.sport);
  const outcomes: DiscordPostOutcome[] = [];
  for (const { entry, imageUrl } of args.boxscores) {
    for (const teamNickname of entry.teams) {
      const team = nick.get(teamNickname);
      if (!team) {
        outcomes.push({
          subId: entry.subId, channel: teamNickname,
          skipped: `nickname not in TEAMS lookup`,
        });
        continue;
      }
      const webhook = teamWebhooks.get(team.slug);
      if (!webhook) {
        outcomes.push({
          subId: entry.subId, channel: team.slug,
          skipped: "no team webhook configured",
        });
        continue;
      }
      const dedupeSubId = `${entry.subId}:${team.slug}`;
      if (await hasAlreadyPosted("discord", args.sport, args.date, dedupeSubId)) {
        outcomes.push({
          subId: dedupeSubId, channel: team.slug,
          skipped: "already posted",
        });
        continue;
      }
      const embed = buildTeamBoxscoreEmbed({
        title: entry.title,
        prettyGamesDate: args.prettyGamesDate,
        imageUrl,
        digestUrl: args.digestUrl,
        teamColorHex: team.primary ?? undefined,
      });
      const message: DiscordMessage = { embeds: [embed] };
      outcomes.push(
        await sendWithLogging({
          webhook, message, subId: dedupeSubId, channel: team.slug,
          sport: args.sport, date: args.date,
        }),
      );
    }
  }
  return outcomes;
}

// ─── Send + record + health update ──────────────────────────────────────

async function sendWithLogging(args: {
  webhook: DiscordWebhookRow;
  message: DiscordMessage;
  subId: string;
  channel: string;
  sport: string;
  date: string;
}): Promise<DiscordPostOutcome> {
  try {
    await postToWebhook(args.webhook.webhook_url, args.message);
    await recordPost({
      platform: "discord", sport: args.sport, date: args.date,
      subId: args.subId, remoteId: null, remoteUrl: null, error: null,
    });
    await markWebhookSuccess(args.webhook.id);
    return { subId: args.subId, channel: args.channel };
  } catch (err) {
    const msg = (err as Error).message;
    await recordPost({
      platform: "discord", sport: args.sport, date: args.date,
      subId: args.subId, remoteId: null, remoteUrl: null, error: msg,
    });
    await markWebhookFailure(args.webhook.id, msg).catch(() => {
      /* health-tracking failure shouldn't poison the cron */
    });
    return { subId: args.subId, channel: args.channel, error: msg };
  }
}

export function summarize(outcomes: DiscordPostOutcome[]): DiscordFanOutResult {
  let posted = 0, skipped = 0, failed = 0;
  for (const o of outcomes) {
    if (o.error) failed++;
    else if (o.skipped) skipped++;
    else posted++;
  }
  return { posted, skipped, failed, outcomes };
}
