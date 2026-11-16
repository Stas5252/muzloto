import { withSupabase } from "jsr:@supabase/server@^1";

const ownerLinkDigest = "826b3ed53d554746d166c2cea96ebf17e8f587f44b1c9702db19e8c46597d08a";
const signedUrlLifetime = 7200;
const headers = {
  "Access-Control-Allow-Origin": "https://stas5252.github.io",
  "Access-Control-Allow-Headers": "apikey, x-muzloto-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

async function isOwnerLink(value: string | null): Promise<boolean> {
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  let mismatch = 0;
  for (let i = 0; i < digest.length; i++) {
    mismatch |= digest[i] ^ parseInt(ownerLinkDigest.slice(i * 2, i * 2 + 2), 16);
  }
  return mismatch === 0;
}

function respond(body: unknown, status: number): Response {
  return Response.json(body, { status, headers });
}

const loadMusic = withSupabase({ auth: "publishable" }, async (request, context) => {
  if (!(await isOwnerLink(request.headers.get("x-muzloto-key")))) {
    return respond({ error: "Invalid host link" }, 403);
  }

  const bucket = context.supabaseAdmin.storage.from("muzloto-audio");
  const { data: files, error: listError } = await bucket.list("", { limit: 100 });
  if (listError) return respond({ error: "Music catalog unavailable" }, 502);

  const paths = files.filter(file => file.id && /^\d+\.mp3$/.test(file.name)).map(file => file.name);
  if (!paths.length) return respond({ tracks: [], expiresIn: signedUrlLifetime }, 200);

  const { data, error } = await bucket.createSignedUrls(paths, signedUrlLifetime);
  if (error) return respond({ error: "Music links unavailable" }, 502);

  return respond({
    expiresIn: signedUrlLifetime,
    tracks: data.filter(file => file.signedUrl && !file.error)
      .map(file => ({ id: file.path.slice(0, -4), url: file.signedUrl })),
  }, 200);
});

export default {
  fetch(request: Request) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return respond({ error: "Method not allowed" }, 405);
    return loadMusic(request);
  },
};
