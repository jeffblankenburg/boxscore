import { redirect } from "next/navigation";

// Redirects "/" to the bookmarkable league page. Eventually this becomes a
// sport picker (mlb / nba / nfl / ...). For now there's only mlb.
export const dynamic = "force-dynamic";

export default function HomePage() {
  redirect("/mlb");
}
