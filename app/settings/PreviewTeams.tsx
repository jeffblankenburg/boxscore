"use client";

// Display-only preview team lists in a sport tab (Jeff's notes). Small sports
// (NFL/NBA/WNBA/NHL) render as one flat alphabetical list — no conference
// headers. NCAAF is large (138 FBS teams), so it keeps its conferences as
// collapsible accordions with a search box; searching filters across all
// conferences and auto-expands the ones with matches.

import { useMemo, useState } from "react";

type Group = { name: string; teams: string[] };

export function PreviewTeams({ groups, grouped }: { groups: Group[]; grouped: boolean }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const q = query.trim().toLowerCase();

  const flatTeams = useMemo(
    () => groups.flatMap((g) => g.teams).sort((a, b) => a.localeCompare(b)),
    [groups],
  );
  const filteredGroups = useMemo(() => {
    if (!q) return groups;
    return groups
      .map((g) => ({ name: g.name, teams: g.teams.filter((t) => t.toLowerCase().includes(q)) }))
      .filter((g) => g.teams.length > 0);
  }, [q, groups]);

  // Small sports: flat list, no headers, no search.
  if (!grouped) {
    return (
      <ul className="settings-team-preview">
        {flatTeams.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    );
  }

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
      {filteredGroups.length === 0 ? (
        <p className="subscribe-fine">No teams match “{query}”.</p>
      ) : (
        filteredGroups.map((g) => {
          const isOpen = q.length > 0 || open.has(g.name); // auto-expand while searching
          return (
            <div key={g.name} className="settings-team-group">
              <button
                type="button"
                className="settings-acc-h"
                aria-expanded={isOpen}
                onClick={() => toggle(g.name)}
              >
                <span>{g.name}</span>
                <span className="settings-acc-caret" aria-hidden>{isOpen ? "–" : "+"}</span>
              </button>
              {isOpen && (
                <ul className="settings-team-preview">
                  {g.teams.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
