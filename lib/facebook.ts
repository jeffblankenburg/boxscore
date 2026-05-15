// Facebook Page posting via Graph API. We post a single multi-photo album
// per day (15 images attached to one feed post) rather than 15 individual
// posts — FB's algorithm prefers one rich post over a burst.
//
// Album flow:
//   1. For each image, POST /{page-id}/photos with `published=false&url=...`
//      → each call returns a media_fbid (the unpublished photo).
//   2. POST /{page-id}/feed with `message=...&attached_media=[{media_fbid},...]`
//      → publishes the album as one feed item.
//   3. Optional cleanup: DELETE /{post-id} via deleteFacebookPost.

const GRAPH = "https://graph.facebook.com/v21.0";

function creds(): { pageId: string; token: string } {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!pageId || !token) {
    throw new Error(
      "Facebook credentials missing: set FACEBOOK_PAGE_ID and FACEBOOK_PAGE_ACCESS_TOKEN.",
    );
  }
  return { pageId, token };
}

type GraphError = { error?: { message: string; type?: string; code?: number } };

async function graphPost(path: string, params: Record<string, string>): Promise<unknown> {
  const body = new URLSearchParams(params);
  const res = await fetch(`${GRAPH}${path}`, { method: "POST", body });
  const json = (await res.json()) as GraphError & Record<string, unknown>;
  if (!res.ok || json.error) {
    throw new Error(`FB ${path}: ${json.error?.message ?? res.statusText}`);
  }
  return json;
}

async function graphDelete(path: string): Promise<void> {
  const res = await fetch(`${GRAPH}${path}`, { method: "DELETE" });
  const json = (await res.json()) as GraphError;
  if (!res.ok || json.error) {
    throw new Error(`FB DELETE ${path}: ${json.error?.message ?? res.statusText}`);
  }
}

// Upload one image by public URL as an unpublished photo. Returns the
// media_fbid we'll attach to the album post.
export async function uploadUnpublishedPhoto(imageUrl: string): Promise<string> {
  const { pageId, token } = creds();
  const result = (await graphPost(`/${pageId}/photos`, {
    url: imageUrl,
    published: "false",
    access_token: token,
  })) as { id: string };
  return result.id;
}

// Publish a single album post that bundles every uploaded photo. message
// shows above the carousel.
export async function publishAlbum(args: {
  message: string;
  mediaFbids: string[];
}): Promise<{ postId: string; url: string }> {
  const { pageId, token } = creds();
  const attached = args.mediaFbids.map((id) => ({ media_fbid: id }));
  const result = (await graphPost(`/${pageId}/feed`, {
    message: args.message,
    attached_media: JSON.stringify(attached),
    access_token: token,
  })) as { id: string };
  return { postId: result.id, url: `https://www.facebook.com/${result.id}` };
}

// Used by the cron's ?reset=1 flow during testing.
export async function deleteFacebookPost(postId: string): Promise<void> {
  const { token } = creds();
  await graphDelete(`/${postId}?access_token=${encodeURIComponent(token)}`);
}
