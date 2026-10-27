import { unstable_cache } from "next/cache";

// Wrap a read in the Next.js Data Cache, keyed by `keyParts` with a short TTL.
//
// The catch is the point: the same lib functions that back our pages (digest
// reads, daily_raw payload reads) are also called from plain Node contexts —
// tsx maintenance/backfill scripts — where there is no Next incremental cache
// in scope and `unstable_cache` throws an "incrementalCache missing" invariant.
// In that case we transparently fall back to a direct, uncached read so scripts
// keep working. Inside the Next server the cache is used normally.
//
// A read can also be too big to cache: the Next data cache rejects any value
// over 2MB, and some daily_raw payloads (basketball/hockey box scores run
// 8-11MB) blow past that. unstable_cache surfaces that as a "can not be cached"
// write error; left unhandled it floods the home page (which loads every
// sport's raw) with unhandledRejections. Treat it the same way — the cache is
// an optimization, so fall back to a direct read rather than fail the request.
export async function cachedRead<T>(
  read: () => Promise<T>,
  keyParts: string[],
  revalidateSeconds: number,
): Promise<T> {
  try {
    return await unstable_cache(read, keyParts, { revalidate: revalidateSeconds })();
  } catch (err) {
    if (err instanceof Error && /incrementalCache missing|can ?not be cached/i.test(err.message)) {
      return read();
    }
    throw err;
  }
}
