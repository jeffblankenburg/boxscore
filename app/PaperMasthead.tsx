import { prettyDate } from "@/lib/dates";

function romanize(n: number): string {
  if (n <= 0 || n > 3999) return String(n);
  const map: Array<[number, string]> = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  for (const [v, s] of map) {
    while (n >= v) { out += s; n -= v; }
  }
  return out;
}

function dayOfYear(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  const start = new Date(Date.UTC(y, 0, 1));
  return Math.floor((dt.getTime() - start.getTime()) / 86_400_000) + 1;
}

const ESTABLISHED = 2026;

export function PaperMasthead({ date }: { date: string }) {
  const year = Number(date.slice(0, 4));
  const volume = romanize(Math.max(1, year - ESTABLISHED + 1));
  const issueNo = dayOfYear(date);
  return (
    <div className="paper-masthead">
      <div className="paper-masthead-section">Sports</div>
      <div className="paper-masthead-edition">
        Vol. {volume} · No. {issueNo} · {prettyDate(date)}
      </div>
    </div>
  );
}
