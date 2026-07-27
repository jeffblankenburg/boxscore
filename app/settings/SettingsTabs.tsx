"use client";

// Tabbed subscription surface on /settings (Jeff's note 3): one tab per sport
// (MLB default, then NFL/NBA/NCAAF/NHL) plus a Predictions tab. Panels are
// server-rendered (the toggle forms + predictions cards) and passed in as
// ReactNodes; this client shell only switches which panel is visible. Hidden
// panels stay mounted so their server-action <form>s keep working.

import { useState, type ReactNode } from "react";

export type SettingsTab = { id: string; label: string; content: ReactNode };

export function SettingsTabs({ tabs }: { tabs: SettingsTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");

  return (
    <div className="settings-tabs">
      <div className="settings-tabbar" role="tablist" aria-label="Subscriptions by sport">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === active}
            className={`settings-tab${t.id === active ? " settings-tab-on" : ""}`}
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" hidden={t.id !== active} className="settings-tabpanel">
          {t.content}
        </div>
      ))}
    </div>
  );
}
