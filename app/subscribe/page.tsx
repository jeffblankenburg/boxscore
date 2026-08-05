import { subscribe } from "./actions";
import AttributionFields from "./AttributionFields";
import { SubscribeSportPanel } from "./SubscribeSportPanel";
import { SettingsTabs } from "@/app/settings/SettingsTabs";
import { getVisibleSports } from "@/lib/sports";
import { teamsBySport, type Sport } from "@/lib/teams";
import { NCAAF_CONFERENCES } from "@/lib/sports/football/conferences";
import "@/app/settings/predictions-settings.css";

// Sports that have a per-team digest pipeline + a team page for the "Preview →"
// link, so their tab shows a team picker.
const TEAM_PAGE_SPORTS = new Set<Sport>(["mlb", "nfl", "ncaaf", "nba", "wnba"]);

export const metadata = {
  title: "Subscribe — boxscore",
  description: "Daily sports digests in your inbox.",
};

export default async function SubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reason?: string }>;
}) {
  const { error, reason } = await searchParams;

  // Public sports only — admin_only sports stay hidden until their pipeline
  // is ready. Flip to includeAdminOnly: true when previewing upcoming
  // sports on the public picker again.
  const sports = await getVisibleSports({ includeAdminOnly: false });

  // One tab per public sport, same layout as /settings: league toggle, then
  // conferences (NCAAF) and teams. Plain form checkboxes submit with the form —
  // SettingsTabs keeps hidden panels mounted so every pick is included.
  const sportTabs = sports.map((s) => ({
    id: s.id,
    label: s.name,
    content: (
      <SubscribeSportPanel
        sportId={s.id}
        sportLabel={s.name}
        teams={
          TEAM_PAGE_SPORTS.has(s.id as Sport)
            ? teamsBySport(s.id as Sport)
                .slice()
                .sort((a, b) => a.city.localeCompare(b.city))
                .map((t) => ({ slug: t.slug, name: t.name }))
            : []
        }
        conferences={
          s.id === "ncaaf" ? NCAAF_CONFERENCES.map((c) => ({ slug: c.slug, name: c.short })) : []
        }
      />
    ),
  }));

  return (
    <section className="subscribe-card">
      <h1 className="subscribe-h1">Subscribe to boxscore</h1>
      <p className="subscribe-fine">
        Already subscribed? <a href="/settings">Manage your subscriptions →</a>
      </p>
      {reason === "unsubscribed" && (
        <p className="subscribe-welcome">
          That address previously unsubscribed. Pick what you want below and
          we&rsquo;ll send a fresh confirmation link to get you back on the
          list.
        </p>
      )}
      <p className="subscribe-lede">
        Like the sports pages we used to read every day. Standings, full box
        scores, league leaders — in your inbox early every morning.
      </p>

      <form action={subscribe} noValidate>
        <AttributionFields />
        <input
          type="email"
          name="email"
          required
          placeholder="you@yourdomain.com"
          autoComplete="email"
          className="subscribe-input subscribe-input-block"
          aria-label="Email address"
        />

        {/* One tab per sport — same layout as /settings. Hidden panels stay
            mounted (SettingsTabs), so checkboxes in inactive tabs still submit. */}
        <SettingsTabs tabs={sportTabs} />

        <button type="submit" className="subscribe-button subscribe-button-block">
          Subscribe →
        </button>
        <p className="subscribe-fine">
          We&rsquo;ll send one confirmation email. After you click the link,
          you&rsquo;re in. Unsubscribe in one click, any time.
        </p>
      </form>

      {error === "invalid_email" && (
        <p className="subscribe-error">Please enter a valid email address.</p>
      )}
      {error === "no_picks" && (
        <p className="subscribe-error">
          Pick at least one newsletter or team to subscribe to.
        </p>
      )}
      <p className="subscribe-fine">
        Prefer a feed reader? Subscribe via RSS: <a href="/rss/mlb"><code>boxscore.email/rss/mlb</code></a>
      </p>
    </section>
  );
}
