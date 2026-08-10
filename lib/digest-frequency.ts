// One source of truth for how often each sport's email digest goes out, shown
// on /subscribe and /settings so subscribers know what cadence they're opting
// into. MLB plays nearly every day, so it ships daily; the others recap the
// morning after any day a game was played — the cron is data-driven (see
// hasPlayedGames), not keyed to fixed weekdays, so it also covers off-pattern
// slates like preseason Fridays.

const DIGEST_FREQUENCY: Record<string, string> = {
  mlb: "Daily during the season",
  nfl: "After each game day",
  nba: "After each game day",
  wnba: "After each game day",
  ncaaf: "After each game day",
  nhl: "After each game day",
};

export function digestFrequency(sportId: string): string {
  return DIGEST_FREQUENCY[sportId] ?? "After each game day";
}
