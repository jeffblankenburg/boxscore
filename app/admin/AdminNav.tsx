import { LeagueSwitcher } from "./LeagueSwitcher";

// AdminNav renders two strips: the top-level universal links (dashboard,
// click tracking, sports, team email) and underneath, the LeagueSwitcher
// with one badge per visible sport. Per-sport tools (email preview, twitter
// compose, images, content preview, cron triggers) live on /admin/[sport]
// reached via the switcher — this nav stays focused on cross-sport surfaces.
export function AdminNav({ activeSport }: { activeSport?: string } = {}) {
  const items: Array<{ href: string; label: string }> = [
    { href: "/admin", label: "Dashboard" },
    { href: "/admin/clicks", label: "Click tracking" },
    { href: "/admin/team-email/cle", label: "Team email" },
    { href: "/admin/sports", label: "Sports" },
  ];
  return (
    <>
      <nav className="admin-nav">
        {items.map((it) => (
          <a key={it.href} href={it.href}>{it.label}</a>
        ))}
      </nav>
      <LeagueSwitcher active={activeSport} />
    </>
  );
}
