import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

// Serves files from out/share/ to the admin image gallery. Path is treated
// as relative segments under out/share/; a normalized-path check prevents
// any traversal outside that directory.

export const dynamic = "force-dynamic";

const ROOT = resolve("out/share");

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  if (!path || path.length === 0) {
    return new Response(null, { status: 404 });
  }

  const file = resolve(ROOT, ...path);
  if (!file.startsWith(ROOT + "/")) {
    return new Response(null, { status: 404 });
  }

  try {
    const info = await stat(file);
    if (!info.isFile()) return new Response(null, { status: 404 });
    const bytes = await readFile(file);
    const mime = file.endsWith(".png") ? "image/png" : "application/octet-stream";
    return new Response(bytes, {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
