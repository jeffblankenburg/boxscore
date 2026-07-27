"use client";

// Team list for a sport tab on /settings. Renders functional subscribe
// checkboxes when `canSubscribe` (the sport is available to this viewer — MLB
// for everyone, preview sports for admins), else a display-only list. NCAAF is
// large, so it's grouped into collapsible conference accordions with a search
// box; every other sport is one flat alphabetical list.

import { useMemo, useState } from "react";
import { SettingsToggleCheckbox } from "./SettingsToggleCheckbox";
import { setTeamSubscription } from "./actions";

type Team = { slug: string; name: string; conference?: string };

export function TeamPicker({
  sportId,
  teams,
  subs,
  grouped,
  canSubscribe,
  showPreview,
}: {
  sportId: string;
  teams: Team[];
  subs: Record<string, boolean>;
  grouped: boolean;
  canSubscribe: boolean;
  showPreview: boolean; // per-team "Preview →" link (only sports with team pages)
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const q = query.trim().toLowerCase();

  const flat = useMemo(
    () => [...teams].sort((a, b) => a.name.localeCompare(b.name)),
    [teams],
  );
  const groups = useMemo(() => {
    const byConf = new Map<string, Team[]>();
    for (const t of teams) {
      const c = t.conference ?? "Other";
      (byConf.get(c) ?? byConf.set(c, []).get(c)!).push(t);
    }
    return [...byConf.entries()]
      .map(([name, ts]) => ({ name, teams: ts.slice().sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [teams]);

  const teamNode = (t: Team) => {
    if (!canSubscribe) return <li key={t.slug}>{t.name}</li>;
    return (
      <li key={t.slug} className="settings-sport-row">
        <SettingsToggleCheckbox
          active={subs[t.slug] === true}
          action={setTeamSubscription}
          fields={{ sport: sportId, team: t.slug }}
          label={t.name}
        />
        {showPreview && (
          <a href={`/${sportId}/${t.slug}`} target="_blank" rel="noopener noreferrer" className="settings-preview-link">
            Preview →
          </a>
        )}
      </li>
    );
  };
  const listClass = canSubscribe ? "settings-sport-list" : "settings-team-preview";

  if (!grouped) {
    const list = q ? flat.filter((t) => t.name.toLowerCase().includes(q)) : flat;
    return <ul className={listClass}>{list.map(teamNode)}</ul>;
  }

  const filtered = q
    ? groups.map((g) => ({ name: g.name, teams: g.teams.filter((t) => t.name.toLowerCase().includes(q)) })).filter((g) => g.teams.length > 0)
    : groups;

  function toggle(name: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <div>
      <input
        type="search"
        className="settings-team-search"
        placeholder="Search teams…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search teams"
      />
      {filtered.length === 0 ? (
        <p className="subscribe-fine">No teams match “{query}”.</p>
      ) : (
        filtered.map((g) => {
          const isOpen = q.length > 0 || open.has(g.name);
          return (
            <div key={g.name} className="settings-team-group">
              <button type="button" className="settings-acc-h" aria-expanded={isOpen} onClick={() => toggle(g.name)}>
                <span>{g.name}</span>
                <span className="settings-acc-caret" aria-hidden>{isOpen ? "–" : "+"}</span>
              </button>
              {isOpen && <ul className={listClass}>{g.teams.map(teamNode)}</ul>}
            </div>
          );
        })
      )}
    </div>
  );
}
