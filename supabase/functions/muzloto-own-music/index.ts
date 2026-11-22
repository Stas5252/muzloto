// Deploy: supabase secrets set MUZLOTO_OWNER_PASSWORD=<8+ characters>, then
// supabase functions deploy muzloto-own-music --no-verify-jwt
import { withSupabase } from "jsr:@supabase/server@^1";
import { handle, headers } from "./music.ts";

const serve = withSupabase({ auth: "publishable" }, (request, context) =>
  handle(request, context.supabaseAdmin.storage.from("muzloto-audio"), Deno.env.get("MUZLOTO_OWNER_PASSWORD")));

export default {
  fetch(request: Request) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    return serve(request);
  },
};
