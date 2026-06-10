import { getTodaysPuzzle } from "@/lib/games/mlbdle/content";
import { MlbdleGame } from "./MlbdleGame";
import "./mlbdle.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "MLBdle — boxscore games",
  robots: { index: false },     // unindex while in development
};

export default async function MlbdlePage() {
  const puzzle = getTodaysPuzzle();
  // Server passes the puzzle shape but never the canonical answer to
  // the page output — the client component receives the answer because
  // local guess-scoring needs it. Spoiler-safety relies on the answer
  // not appearing in any pre-reveal DOM text.
  return <MlbdleGame puzzle={puzzle} />;
}
