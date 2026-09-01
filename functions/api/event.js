/**
 * POST /api/event — records non-form interactions (currently: Book a Call clicks).
 * Anonymous visitors can't be matched to a FUB person, so these go to the LEADS KV namespace (if bound)
 * as a daily counter you can read in the Cloudflare dashboard. The FUB Pixel (see launch guide) handles
 * returning-visitor tracking on the FUB side.
 */
export async function onRequestPost({ request, env }) {
  let body = {};
  try { body = await request.json(); } catch {}
  const type = String(body.type || "unknown").slice(0, 40);
  if (env.LEADS) {
    const day = new Date().toISOString().slice(0, 10);
    const key = `event:${day}:${type}`;
    try {
      const cur = parseInt((await env.LEADS.get(key)) || "0", 10);
      await env.LEADS.put(key, String(cur + 1), { expirationTtl: 60 * 60 * 24 * 400 });
    } catch {}
  }
  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
