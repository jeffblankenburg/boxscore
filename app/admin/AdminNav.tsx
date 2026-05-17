import { yesterdayInET } from "@/lib/dates";

export function AdminNav() {
  const yesterday = yesterdayInET();
  const items: Array<{ href: string; label: string }> = [
    { href: "/admin", label: "Dashboard" },
    { href: `/admin/email/${yesterday}`, label: "Email preview" },
    { href: "/admin/team-email/cle", label: "Team email" },
    { href: "/admin/twitter", label: "Twitter" },
    { href: "/admin/images", label: "Images" },
  ];
  return (
    <nav className="admin-nav">
      {items.map((it) => (
        <a key={it.href} href={it.href}>{it.label}</a>
      ))}
    </nav>
  );
}
