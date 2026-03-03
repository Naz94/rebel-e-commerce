// ============================================================
// REBEL ENGINE — Platform Dispatcher (lib/post.js)
//
// Handles Facebook + Instagram posting.
// Accepts both static images (URL) and animated GIFs (buffer).
//
// Env vars required:
//   FACEBOOK_PAGE_ID  → your FB page ID
//   IG_USER_ID        → your IG business account ID
//   META_TOKEN        → long-lived page access token
//                       ⚠️ expires April 25 2026 — refresh before then
// ============================================================

const FB_API = "https://graph.facebook.com/v19.0";

export async function postToAllPlatforms(contentMap, visual) {
  const result = await deployMeta(contentMap.facebook, contentMap.instagram, visual);
  return [result];
}

async function deployMeta(fbCopy, igCopy, visual) {
  try {
    let fbResult, igResult;

    if (visual.type === "static") {
      // Create IG container first — DALL-E URL expires in ~60 mins
      const igContainerId = await createIGContainer(visual.imageUrl, igCopy);
      [fbResult, igResult] = await Promise.allSettled([
        postToFacebookStatic(visual.imageUrl, fbCopy),
        publishIGContainer(igContainerId),
      ]);
    } else {
      [fbResult, igResult] = await Promise.allSettled([
        postToFacebookGIF(visual.buffer, fbCopy),
        postToInstagramGIF(visual.buffer, igCopy),
      ]);
    }

    return {
      platform:   "Meta",
      status:     "SUCCESS",
      visualType: visual.type,
      data: {
        facebook:  fbResult.status === "fulfilled" ? fbResult.value  : { error: fbResult.reason?.message },
        instagram: igResult.status === "fulfilled" ? igResult.value  : { error: igResult.reason?.message },
      },
      error: null,
    };
  } catch (err) {
    return { platform: "Meta", status: "FAILED", data: null, error: err.message };
  }
}

// ── Facebook — Static ─────────────────────────────────────────

async function postToFacebookStatic(imageUrl, copy) {
  const res = await fetch(`${FB_API}/${process.env.FACEBOOK_PAGE_ID}/photos`, {
    method: "POST",
    body: new URLSearchParams({
      url:          imageUrl,
      caption:      copy,
      access_token: process.env.META_TOKEN,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Facebook static error: ${JSON.stringify(data)}`);
  return { platform: "facebook", postId: data.id };
}

// ── Facebook — GIF ────────────────────────────────────────────

async function postToFacebookGIF(buffer, copy) {
  const form = new FormData();
  form.append("source",       new Blob([buffer], { type: "image/gif" }), "post.gif");
  form.append("caption",      copy);
  form.append("access_token", process.env.META_TOKEN);

  const res = await fetch(`${FB_API}/${process.env.FACEBOOK_PAGE_ID}/photos`, {
    method: "POST",
    body:   form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Facebook GIF error: ${JSON.stringify(data)}`);
  return { platform: "facebook", postId: data.id };
}

// ── Instagram — Static (two-step) ────────────────────────────

async function createIGContainer(imageUrl, caption) {
  const res = await fetch(`${FB_API}/${process.env.IG_USER_ID}/media`, {
    method: "POST",
    body: new URLSearchParams({
      image_url:    imageUrl,
      caption,
      access_token: process.env.META_TOKEN,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`IG container error: ${JSON.stringify(data)}`);
  return data.id;
}

async function publishIGContainer(containerId) {
  const res = await fetch(`${FB_API}/${process.env.IG_USER_ID}/media_publish`, {
    method: "POST",
    body: new URLSearchParams({
      creation_id:  containerId,
      access_token: process.env.META_TOKEN,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`IG publish error: ${JSON.stringify(data)}`);
  return { platform: "instagram", postId: data.id };
}

// ── Instagram — GIF ───────────────────────────────────────────

async function postToInstagramGIF(buffer, caption) {
  const form = new FormData();
  form.append("video",        new Blob([buffer], { type: "image/gif" }), "post.gif");
  form.append("caption",      caption);
  form.append("media_type",   "IMAGE");
  form.append("access_token", process.env.META_TOKEN);

  const containerRes = await fetch(`${FB_API}/${process.env.IG_USER_ID}/media`, {
    method: "POST",
    body:   form,
  });
  const container = await containerRes.json();
  if (!containerRes.ok) throw new Error(`IG GIF container error: ${JSON.stringify(container)}`);

  const publishRes = await fetch(`${FB_API}/${process.env.IG_USER_ID}/media_publish`, {
    method: "POST",
    body: new URLSearchParams({
      creation_id:  container.id,
      access_token: process.env.META_TOKEN,
    }),
  });
  const published = await publishRes.json();
  if (!publishRes.ok) throw new Error(`IG GIF publish error: ${JSON.stringify(published)}`);
  return { platform: "instagram", postId: published.id };
}
