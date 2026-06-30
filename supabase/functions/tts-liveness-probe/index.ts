// AIDV-833 / AIDV-831 Finding 1: tts-liveness-probe
//
// Security fix: verify_jwt = true (enforced at gateway layer via config.toml).
// Supabase rejects unauthenticated requests before this code runs.
// Internal callers must supply: Authorization: Bearer <service_role_key>
//
// Purpose: returns live status of TTS agents from agent_capability_registry.
// Used by monitoring tooling; NOT a public endpoint.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: agents, error } = await supabase
    .from("agent_capability_registry")
    .select("agent_id, status, current_load, max_load, last_heartbeat_at, last_seen")
    .contains("capabilities", ["tts"])
    .order("last_seen", { ascending: false })
    .limit(10);

  if (error) {
    return new Response(
      JSON.stringify({ ok: false, error: error.message, checked_at: new Date().toISOString() }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const alive = (agents ?? []).filter(
    (a) => a.last_seen && new Date(a.last_seen) > new Date(Date.now() - 5 * 60 * 1000),
  );

  return new Response(
    JSON.stringify({
      ok: true,
      tts_agents_total: agents?.length ?? 0,
      tts_agents_alive: alive.length,
      agents: agents ?? [],
      checked_at: new Date().toISOString(),
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
