import { requireAdmin } from "../../require-admin";
import { MappingView } from "../_components/MappingView";
import { SPORTSDATAIO_MAPPING } from "../_data/mappings-sportsdataio";

export const dynamic = "force-dynamic";
export const metadata = { title: "SportsDataIO mapping · admin · boxscore", robots: { index: false } };

export default async function SportsDataIoMappingPage() {
  await requireAdmin();
  return <MappingView mapping={SPORTSDATAIO_MAPPING} />;
}
