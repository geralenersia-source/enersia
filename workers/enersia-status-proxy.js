export default {
  async fetch(request) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const resp = await fetch("http://65.21.53.147:9000/status?key=enersia2026", {
        signal: AbortSignal.timeout(5000)
      });
      const data = await resp.json();
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: corsHeaders
      });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), {
        status: 503,
        headers: corsHeaders
      });
    }
  }
};
