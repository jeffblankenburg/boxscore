import { redirect } from "next/navigation";

// Checkout now lives inline on /mlb/predictions (the storefront), so this
// standalone page just forwards there. The /subscribe/success child route is
// unaffected — it remains the Payment Element's return target.

export const dynamic = "force-dynamic";

export default async function SubscribeRedirect({ params }: { params: Promise<{ sport: string }> }) {
  const { sport } = await params;
  redirect(`/${sport}/predictions`);
}
