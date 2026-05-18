import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import JSZip from "jszip";
import { ADMIN_SESSION_COOKIE, validateSession } from "@/lib/admin-auth";
import { listStoredImages } from "@/lib/share-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  const sessionToken = jar.get(ADMIN_SESSION_COOKIE)?.value;
  if (sessionToken && (await validateSession(sessionToken))) return true;
  const legacy = jar.get("boxscore_admin")?.value;
  const secret = process.env.ADMIN_SECRET;
  return Boolean(secret && legacy === secret);
}

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { date, images } = await listStoredImages();
  if (images.length === 0) {
    return NextResponse.json({ error: "no images" }, { status: 404 });
  }

  const zip = new JSZip();
  await Promise.all(
    images.map(async (img) => {
      const res = await fetch(img.url);
      if (!res.ok) throw new Error(`fetch ${img.file}: ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      zip.file(img.file, bytes);
    }),
  );

  const buf = await zip.generateAsync({ type: "nodebuffer" });
  const filename = `boxscore-images-${date ?? "current"}.zip`;
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
