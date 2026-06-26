// AIDV-392: Structured JSON logging + request tracing for agent-heartbeat
// AIDV-420: verify_jwt: true — all requests (incl. GET) now require auth; remove GET bypass
// AIDV-428: export handler for testability; verify_jwt=true now enforced via config.toml
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { log, makeRequestId, timedQuery } from "./_shared/logger.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-agent-secret, x-request-id',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export async function handler(req: Request): Promise<Response> {
  const requestId = makeRequestId(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  log('info', 'request_received', { requestId, method: req.method, url: req.url });

  // Auth: require x-agent-secret (machine-to-machine) OR Authorization JWT header.
  // Supabase pre-validates the JWT before this function runs (verify_jwt: true).
  const agentSecret = req.headers.get('x-agent-secret');
  const expectedSecret = Deno.env.get('AGENT_SECRET') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const hasValidSecret = !!agentSecret && !!expectedSecret && agentSecret === expectedSecret;
  const hasAuth = !!req.headers.get('Authorization');

  if (!hasValidSecret && !hasAuth) {
    log('warn', 'auth_rejected', { requestId, reason: 'missing x-agent-secret and Authorization header' });
    return new Response(JSON.stringify({ error: 'Unauthorized: provide x-agent-secret or Authorization header' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const url = new URL(req.url);

  try {
    if (req.method === 'POST') {
      const body = await req.json();
      const { agent_id, capabilities, current_load, max_load, metadata } = body;

      if (!agent_id) {
        log('warn', 'validation_error', { requestId, missing: 'agent_id' });
        return new Response(JSON.stringify({ error: 'agent_id is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const load = current_load ?? 0;
      const maxLoad = max_load ?? 5;

      const { data, error } = await timedQuery(
        () => supabase
          .from('agent_capability_registry')
          .upsert({
            agent_id,
            capabilities: capabilities ?? [],
            current_load: load,
            max_load: maxLoad,
            status: load >= maxLoad ? 'busy' : 'idle',
            last_seen: new Date().toISOString(),
            metadata: metadata ?? {},
          }, { onConflict: 'agent_id' })
          .select()
          .single(),
        requestId,
        'upsert_heartbeat'
      );

      if (error) throw error;
      log('info', 'heartbeat_registered', { requestId, agent_id, load, maxLoad, status: load >= maxLoad ? 'busy' : 'idle' });
      return new Response(JSON.stringify({ ok: true, agent: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'GET') {
      const capability = url.searchParams.get('capability');
      const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();

      let query = supabase
        .from('agent_capability_registry')
        .select('agent_id, capabilities, current_load, max_load, status, last_seen')
        .gt('last_seen', cutoff)
        .order('current_load', { ascending: true });

      if (capability) {
        query = query.contains('capabilities', [capability]);
      }

      const { data, error } = await timedQuery(
        () => query,
        requestId,
        'list_active_agents'
      );
      if (error) throw error;
      log('info', 'agents_listed', { requestId, count: data?.length ?? 0, capability: capability ?? 'all' });
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log('error', 'unhandled_error', { requestId, error: message });
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

Deno.serve(handler);
