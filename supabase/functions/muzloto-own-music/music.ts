// Owner-managed music packs. Recordings and their catalogue (one JSON file) live in the private bucket
// under own/, so a new pack needs no code change: the host page reads the catalogue with signed links.

const packId = /^p[a-f0-9]{12}$/;
const trackId = /^u[a-f0-9]{16}$/;
const cover = /^https:\/\/[a-z0-9-]+\.mzstatic\.com\/[\w\-./%]{1,300}$/;
const formats = new Set(["mp3", "m4a"]);
const indexName = "index.json";
const indexPath = "own/" + indexName;
const lifetime = 7200;
const maxPacks = 30;
const maxTracks = 150;

export const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, content-type, x-muzloto-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Cache-Control": "no-store",
};

type Track = { id: string; artist: string; title: string; art: string; ext: string };
type Pack = { id: string; title: string; tracks: Track[] };

const respond = (body: unknown, status = 200) => Response.json(body, { status, headers });
const text = (value: unknown, limit: number) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
const folder = (id: string) => "own/" + id;
const file = (pack: string, track: Track) => `${folder(pack)}/${track.id}.${track.ext}`;

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

// The page sends the password percent-encoded, because a header cannot carry Cyrillic.
async function isOwner(header: string | null, password: string | undefined): Promise<boolean> {
  if (!password || password.length < 8 || !header || header.length > 1200) return false;
  let given: string;
  try {
    given = decodeURIComponent(header);
  } catch {
    return false;
  }
  const [a, b] = await Promise.all([digest(given), digest(password)]);
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}

// A missing catalogue is an empty one; a catalogue that cannot be read must never be overwritten.
async function readIndex(bucket: any): Promise<Pack[] | null> {
  const listed = await bucket.list("own", { limit: 100, search: indexName });
  if (listed.error) return null;
  if (!listed.data.some((item: any) => item.name === indexName)) return [];
  const stored = await bucket.download(indexPath);
  if (stored.error) return null;
  try {
    const packs = JSON.parse(await stored.data.text()).packs;
    return Array.isArray(packs) ? packs : null;
  } catch {
    return null;
  }
}

async function writeIndex(bucket: any, packs: Pack[]): Promise<boolean> {
  const body = new Blob([JSON.stringify({ packs })], { type: "application/json" });
  const { error } = await bucket.upload(indexPath, body, { contentType: "application/json", upsert: true });
  return !error;
}

async function stored(bucket: any, pack: string): Promise<string[] | null> {
  const { data, error } = await bucket.list(folder(pack), { limit: 1000 });
  return error ? null : data.filter((item: any) => item.id).map((item: any) => item.name);
}

function readPack(input: any): Pack | string {
  if (!packId.test(input?.id)) return "Bad pack id";
  const title = text(input.title, 60);
  if (!title) return "Pack needs a title";
  if (!Array.isArray(input.tracks) || !input.tracks.length || input.tracks.length > maxTracks) return "Bad track list";
  const tracks: Track[] = [];
  const seen = new Set<string>();
  for (const item of input.tracks) {
    const title = text(item?.title, 80);
    if (!trackId.test(item?.id) || seen.has(item.id) || !formats.has(item.ext) || !title) return "Bad track";
    if (item.art && !(typeof item.art === "string" && cover.test(item.art))) return "Bad cover";
    seen.add(item.id);
    tracks.push({ id: item.id, artist: text(item.artist, 80), title, art: item.art || "", ext: item.ext });
  }
  return { id: input.id, title, tracks };
}

async function catalogue(bucket: any): Promise<Response> {
  const packs = await readIndex(bucket);
  if (!packs) return respond({ error: "Music catalog unavailable" }, 502);
  const paths = new Map<string, string>();
  for (const pack of packs) for (const track of pack.tracks) paths.set(file(pack.id, track), track.id);
  let tracks: { id: string; url: string }[] = [];
  if (paths.size) {
    const { data, error } = await bucket.createSignedUrls([...paths.keys()], lifetime);
    if (error) return respond({ error: "Music links unavailable" }, 502);
    tracks = data.filter((item: any) => item.signedUrl && !item.error)
      .map((item: any) => ({ id: paths.get(item.path), url: item.signedUrl }));
  }
  return respond({
    expiresIn: lifetime,
    tracks,
    packs: packs.map(pack => ({
      id: pack.id,
      title: pack.title,
      tracks: pack.tracks.map(({ id, artist, title, art, ext }) => ({ id, artist, title, art, ext })),
    })),
  });
}

async function save(bucket: any, input: unknown): Promise<Response> {
  const pack = readPack(input);
  if (typeof pack === "string") return respond({ error: pack }, 400);
  const files = await stored(bucket, pack.id);
  if (!files) return respond({ error: "Music storage unavailable" }, 502);
  const present = new Set(files);
  const missing = pack.tracks.filter(track => !present.has(`${track.id}.${track.ext}`)).map(track => track.id);
  if (missing.length) return respond({ error: "Recording is not uploaded", missing }, 409);

  const packs = await readIndex(bucket);
  if (!packs) return respond({ error: "Music catalog unavailable" }, 502);
  const at = packs.findIndex(item => item.id === pack.id);
  if (at < 0 && packs.length >= maxPacks) return respond({ error: "Too many packs" }, 409);
  if (at < 0) packs.push(pack); else packs[at] = pack;
  if (!(await writeIndex(bucket, packs))) return respond({ error: "Pack was not saved" }, 502);

  const kept = new Set(pack.tracks.map(track => `${track.id}.${track.ext}`));
  const stale = files.filter(name => !kept.has(name)).map(name => `${folder(pack.id)}/${name}`);
  if (stale.length) await bucket.remove(stale);
  return respond({ ok: true });
}

async function remove(bucket: any, id: unknown): Promise<Response> {
  if (typeof id !== "string" || !packId.test(id)) return respond({ error: "Bad pack id" }, 400);
  const packs = await readIndex(bucket);
  if (!packs) return respond({ error: "Music catalog unavailable" }, 502);
  // Recordings go first: if that fails the pack stays listed and can be deleted again.
  const files = await stored(bucket, id);
  if (!files) return respond({ error: "Music storage unavailable" }, 502);
  if (files.length && (await bucket.remove(files.map(name => `${folder(id)}/${name}`))).error) {
    return respond({ error: "Pack was not deleted" }, 502);
  }
  if (!(await writeIndex(bucket, packs.filter(pack => pack.id !== id)))) {
    return respond({ error: "Pack was not deleted" }, 502);
  }
  return respond({ ok: true });
}

async function upload(bucket: any, body: any): Promise<Response> {
  if (!packId.test(body.pack) || !trackId.test(body.track) || !formats.has(body.ext)) {
    return respond({ error: "Bad recording" }, 400);
  }
  const { data, error } = await bucket.createSignedUploadUrl(
    `${folder(body.pack)}/${body.track}.${body.ext}`, { upsert: true });
  if (error) return respond({ error: "Upload link unavailable" }, 502);
  return respond({ url: data.signedUrl });
}

export async function handle(request: Request, bucket: any, password: string | undefined): Promise<Response> {
  if (request.method === "GET") return catalogue(bucket);
  if (request.method !== "POST") return respond({ error: "Method not allowed" }, 405);
  if (!(await isOwner(request.headers.get("x-muzloto-key"), password))) {
    await new Promise(resolve => setTimeout(resolve, 600));
    return respond({ error: "Wrong password" }, 403);
  }
  let body: any;
  try {
    body = await request.json();
  } catch {
    return respond({ error: "Bad request" }, 400);
  }
  if (body?.action === "check") return respond({ ok: true });
  if (body?.action === "upload") return upload(bucket, body);
  if (body?.action === "save") return save(bucket, body.pack);
  if (body?.action === "delete") return remove(bucket, body.id);
  return respond({ error: "Bad request" }, 400);
}
