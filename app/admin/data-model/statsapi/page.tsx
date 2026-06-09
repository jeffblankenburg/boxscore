import { requireAdmin } from "../../require-admin";
import { MappingView } from "../_components/MappingView";
import { STATSAPI_MAPPING } from "../_data/mappings-statsapi";

export const dynamic = "force-dynamic";
export const metadata = { title: "MLB API mapping · admin · boxscore", robots: { index: false } };

export default async function StatsapiMappingPage() {
  await requireAdmin();
  return <MappingView mapping={STATSAPI_MAPPING} />;
}
