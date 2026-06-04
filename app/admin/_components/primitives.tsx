// Shared UI primitives for the admin shell. Server components by default;
// keep client behavior in dedicated files (e.g. Sidebar.tsx, SubmitButton.tsx)
// so most pages stay server-rendered.
//
// Convention: every primitive class is `a-*` (see app/admin/admin.css).

import type { ReactNode } from "react";

// ─── Breadcrumbs + Page header ────────────────────────────────────────────

export type BreadcrumbItem = { label: string; href?: string };

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav className="a-breadcrumb" aria-label="breadcrumb">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={`${item.label}-${i}`}>
            {item.href && !isLast ? (
              <a href={item.href}>{item.label}</a>
            ) : (
              <span className={isLast ? "current" : undefined}>{item.label}</span>
            )}
            {!isLast && <span className="sep"> / </span>}
          </span>
        );
      })}
    </nav>
  );
}

export function PageHeader({
  title,
  subtitle,
  breadcrumbs,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  actions?: ReactNode;
}) {
  return (
    <div>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Breadcrumbs items={breadcrumbs} />
        </div>
      )}
      <div className="a-page-head">
        <div>
          <h1>{title}</h1>
          {subtitle && <div className="subtitle">{subtitle}</div>}
        </div>
        {actions && <div className="actions">{actions}</div>}
      </div>
    </div>
  );
}

// ─── Section block ────────────────────────────────────────────────────────

export function Section({
  title,
  actions,
  children,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="a-section">
      {(title || actions) && (
        <div className="a-section-head">
          {title ? <h2>{title}</h2> : <div />}
          {actions && <div className="actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

// ─── Info rows (label · value pairs for detail pages) ─────────────────────

export type InfoRow = { label: string; value: ReactNode };

export function InfoRows({ rows }: { rows: InfoRow[] }) {
  return (
    <dl className="a-info">
      {rows.map((r, i) => (
        <span key={`${r.label}-${i}`} style={{ display: "contents" }}>
          <dt>{r.label}</dt>
          <dd>{r.value}</dd>
        </span>
      ))}
    </dl>
  );
}

// ─── Data table ───────────────────────────────────────────────────────────

export type Column<T> = {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  width?: string;
};

export function DataTable<T>({
  rows,
  columns,
  rowHref,
  empty,
}: {
  rows: T[];
  columns: Column<T>[];
  // When provided, the whole row becomes clickable to this URL. Use for
  // master-detail navigation (list page → detail page).
  rowHref?: (row: T) => string;
  empty?: ReactNode;
}) {
  if (rows.length === 0) {
    return empty ? <>{empty}</> : <EmptyState message="No rows yet." />;
  }
  return (
    <table className="a-table">
      <colgroup>
        {columns.map((c, i) => (
          <col key={i} style={c.width ? { width: c.width } : undefined} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((c, i) => (
            <th key={i} className={c.className}>{c.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const href = rowHref?.(row);
          return (
            <tr key={i} className={href ? "linked" : undefined}>
              {columns.map((c, j) => (
                <td key={j} className={c.className}>
                  {/* Wrap the cell in <a> when row is linked so the whole
                      cell is keyboard-navigable and middle-clickable to open
                      in a new tab. Each cell links to the same destination. */}
                  {href ? <a href={href} style={{ display: "block" }}>{c.cell(row)}</a> : c.cell(row)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── Status badges ────────────────────────────────────────────────────────

export type BadgeVariant = "success" | "warning" | "danger" | "info" | "neutral";

export function StatusBadge({
  variant = "neutral",
  children,
}: {
  variant?: BadgeVariant;
  children: ReactNode;
}) {
  return <span className={`a-badge a-badge-${variant}`}>{children}</span>;
}

// ─── Empty state ──────────────────────────────────────────────────────────

export function EmptyState({
  message,
  action,
}: {
  message: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="a-empty">
      <div>{message}</div>
      {action && <div>{action}</div>}
    </div>
  );
}

// ─── Page-level alert (success / error) ───────────────────────────────────

export function Alert({
  variant,
  children,
}: {
  variant: "success" | "danger";
  children: ReactNode;
}) {
  return <div className={`a-alert a-alert-${variant}`}>{children}</div>;
}

// ─── Card ─────────────────────────────────────────────────────────────────

export function Card({
  title,
  actions,
  children,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="a-card">
      {(title || actions) && (
        <div className="a-card-head">
          {title && <div className="a-card-title">{title}</div>}
          {actions && <div>{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
