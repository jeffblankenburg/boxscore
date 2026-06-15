// React renderers for the social-brand icons in the public-site
// header. Path data lives in lib/brand-icon-data.ts so the admin
// preview's HTML-string renderer (app/admin/preview/[sport]/frame/
// route.ts) can source the same paths and never drift from the live
// header.

import type { ReactElement } from "react";
import { SOCIAL_ICONS, type IconData } from "@/lib/brand-icon-data";

function PathIcon({ data }: { data: IconData }): ReactElement {
  return (
    <svg
      viewBox={data.viewBox}
      width="18"
      height="18"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={true}
      focusable={false}
    >
      <path d={data.path} />
    </svg>
  );
}

/** Resolve a social-entry slug to the icon component. */
export const SOCIAL_ICON_BY_SLUG: Record<string, () => ReactElement> =
  Object.fromEntries(
    SOCIAL_ICONS.map((i) => [i.slug, () => <PathIcon data={i} />]),
  );
