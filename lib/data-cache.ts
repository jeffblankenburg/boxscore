import { unstable_cache } from "next/cache";

// Wrap a read in the Next.js Data Cache, keyed by `keyParts` with a short TTL.
//
// The catch is the point: the same lib functions that back our pages (digest
// reads, daily_raw payload reads) are also called from plain Node contexts —
// tsx maintenance/backfill scripts — where there is no Next incremental cache
// in scope and `unstable_cache` throws an "incrementalCache missing" invariant.
// In that case we transparently fall back to a direct, uncached read so scripts
// keep working. Inside the Next server the cache is used normally.
export async function cachedRead<T>(
  read: () => Promise<T>,
  keyParts: string[],
  revalidateSeconds: number,
): Promise<T> {
  try {
    return await unstable_cache(read, keyParts, { revalidate: revalidateSeconds })();
  } catch (err) {
    if (err instanceof Error && /incrementalCache missing/i.test(err.message)) {
      return read();
    }
    throw err;
  }
}
