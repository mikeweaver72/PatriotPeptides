// pst-support-shot v1: returns one screenshot from an in-app problem report as an image, so it can be viewed for diagnosis.
// GET ?t=<ticket id>&k=<ticket view_key>&i=<0-3>. Both the ticket id and its random view_key must match; nothing is listable.
// Deploy with verify_jwt = false (the view_key is the check). Read-only.
const URL_BASE = Deno.env.get("SUPABASE_URL") || "", SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
Deno.serve(async req => {
  const u = new URL(req.url), t = u.searchParams.get("t") || "", k = u.searchParams.get("k") || "", i = Number(u.searchParams.get("i") || 0);
  if (!UUID.test(t) || !UUID.test(k) || !(i >= 0 && i <= 3)) return new Response("bad request", { status: 400 });
  const h = { apikey: SRK, Authorization: `Bearer ${SRK}` };
  const tr = await fetch(`${URL_BASE}/rest/v1/pst_support_tickets?select=id&id=eq.${t}&view_key=eq.${k}`, { headers: h }); const tk = await tr.json().catch(() => []);
  if (!Array.isArray(tk) || !tk.length) return new Response("not found", { status: 404 });
  const sr = await fetch(`${URL_BASE}/rest/v1/pst_support_shots?select=mime,data&ticket_id=eq.${t}&idx=eq.${i}`, { headers: h }); const s = await sr.json().catch(() => []);
  if (!Array.isArray(s) || !s.length) return new Response("not found", { status: 404 });
  const bin = Uint8Array.from(atob(s[0].data), c => c.charCodeAt(0));
  return new Response(bin, { headers: { "Content-Type": s[0].mime || "image/jpeg", "Cache-Control": "private, no-store" } });
});
