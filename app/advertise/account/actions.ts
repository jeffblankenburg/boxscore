"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADVERTISER_SESSION_COOKIE, destroySession } from "@/lib/advertiser-auth";

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(ADVERTISER_SESSION_COOKIE)?.value;
  await destroySession(token);
  jar.delete(ADVERTISER_SESSION_COOKIE);
  redirect("/advertise");
}
