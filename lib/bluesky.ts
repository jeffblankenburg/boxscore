import { AtpAgent, RichText } from "@atproto/api";

// BlueSky posting client. Session-based auth: we login fresh on each post
// (cheap, ~100ms; avoids storing a session). RichText auto-detects URLs and
// hashtags and converts them into clickable "facets" — required so they
// render as links/tags rather than gray text.

type Agent = InstanceType<typeof AtpAgent>;

async function loginAgent(): Promise<Agent> {
  const handle = process.env.BLUESKY_HANDLE;
  const password = process.env.BLUESKY_APP_PASSWORD;
  if (!handle || !password) {
    throw new Error(
      "BlueSky credentials missing: set BLUESKY_HANDLE and BLUESKY_APP_PASSWORD.",
    );
  }
  const agent = new AtpAgent({ service: "https://bsky.social" });
  await agent.login({ identifier: handle, password });
  return agent;
}

function postUrl(uri: string): string {
  const handle = process.env.BLUESKY_HANDLE ?? "boxscore.email";
  const rkey = uri.split("/").pop();
  return `https://bsky.app/profile/${handle}/post/${rkey}`;
}

export async function postToBluesky(text: string): Promise<{ uri: string; url: string }> {
  const agent = await loginAgent();
  const rt = new RichText({ text });
  await rt.detectFacets(agent);
  const result = await agent.post({
    text: rt.text,
    facets: rt.facets,
    createdAt: new Date().toISOString(),
  });
  return { uri: result.uri, url: postUrl(result.uri) };
}

export async function postToBlueskyWithImage(args: {
  text: string;
  imageBytes: Uint8Array;
  imageMime?: string;
  altText: string;
  aspectRatio?: { width: number; height: number };
}): Promise<{ uri: string; url: string }> {
  const agent = await loginAgent();
  const blob = await agent.uploadBlob(args.imageBytes, {
    encoding: args.imageMime ?? "image/png",
  });
  const rt = new RichText({ text: args.text });
  await rt.detectFacets(agent);
  const image: {
    image: typeof blob.data.blob;
    alt: string;
    aspectRatio?: { width: number; height: number };
  } = { image: blob.data.blob, alt: args.altText };
  if (args.aspectRatio) image.aspectRatio = args.aspectRatio;
  const result = await agent.post({
    text: rt.text,
    facets: rt.facets,
    embed: {
      $type: "app.bsky.embed.images",
      images: [image],
    },
    createdAt: new Date().toISOString(),
  });
  return { uri: result.uri, url: postUrl(result.uri) };
}

/**
 * Delete a post by its AT URI. Used by the cron route's ?reset=1 flow to
 * clean up prior posts before re-posting (helpful during testing).
 */
export async function deleteBlueskyPost(uri: string): Promise<void> {
  const agent = await loginAgent();
  await agent.deletePost(uri);
}
