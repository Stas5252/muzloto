import { withSupabase } from "jsr:@supabase/server@^1";

const trackIds = [
  "6793556682", "1737216348", "1211733166", "1481988750", "1656019512",
  "1679628216", "1842815805", "1053096612", "1755780618", "1575451599",
  "1859998201", "1652565207", "1712677225", "1576535535", "1650600516",
  "6768974712", "1777112820", "1681131635", "1394107529", "1887250179",
  "1604345673", "1397019992", "1083906296", "1219351548", "6787018763",
  "1200810425", "1151472383", "1580751202", "1776659451", "1598596948",
  "1374155945", "1472166281", "1668418517", "893658841", "898372676",
  "1505607242", "978658542", "1856588835", "1482620047", "1559230681",
  "1112607132", "1103187227", "1440860312",
];
const paths = trackIds.map(id => id + ".mp3");
const expiresIn = 7200;
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "no-store",
};

const loadGameAudio = withSupabase({ auth: "publishable" }, async (_request, context) => {
  const { data, error } = await context.supabaseAdmin.storage
    .from("muzloto-audio").createSignedUrls(paths, expiresIn);
  if (error) {
    return Response.json({ error: "Music catalog unavailable" }, { status: 502, headers });
  }

  const tracks = data.filter(file => file.signedUrl && !file.error)
    .map(file => ({ id: file.path.slice(0, -4), url: file.signedUrl }));
  return Response.json({ tracks, expiresIn }, { headers });
});

export default {
  fetch(request: Request) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "GET") {
      return Response.json({ error: "Method not allowed" }, { status: 405, headers });
    }
    return loadGameAudio(request);
  },
};
