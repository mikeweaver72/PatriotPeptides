// pst-release v2 (Oct 26 2026: tells the owner team the update is live, via pst-push) · the "Publish" button. An owner taps Publish on a release that's waiting; this merges its GitHub
// pull request into main (GitHub Pages then puts it live) and marks the reports it fixes as fixed.
// POST {release_id} + user JWT. Only publishers (PUBLISHERS secret, comma list; default Mike) can publish.
// Needs secret GITHUB_TOKEN: a fine-grained token for __PPU_GITHUB_REPO__ with Contents + Pull requests read/write.
// Deploy with verify_jwt = false (it checks the caller itself).
const URL_BASE = Deno.env.get("SUPABASE_URL") || "", SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const GH = Deno.env.get("GITHUB_TOKEN") || "", REPO = Deno.env.get("GITHUB_REPO") || "__PPU_GITHUB_REPO__";
const PUBLISHERS = (Deno.env.get("PUBLISHERS") || "mike.weaver2013@gmail.com").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const svc = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
async function rest(path: string, init: RequestInit = {}) { const r = await fetch(`${URL_BASE}/rest/v1/${path}`, { ...init, headers: { ...svc, ...(init.headers || {}) } }); const t = await r.text(); if (!r.ok) throw new Error(t || `db ${r.status}`); return t ? JSON.parse(t) : null; }
const gh = (path: string, init: RequestInit = {}) => fetch(`https://api.github.com/repos/${REPO}${path}`, { ...init, headers: { Authorization: `Bearer ${GH}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "pst-release", ...(init.headers || {}) } });
Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") || ""; if (!auth.startsWith("Bearer ")) return json(401, { error: "Sign in first." });
    const ur = await fetch(`${URL_BASE}/auth/v1/user`, { headers: { apikey: ANON || SRK, Authorization: auth } }); const u = await ur.json().catch(() => null);
    if (!ur.ok || !u?.id) return json(401, { error: "Your session expired. Sign in again." });
    const email = String(u.email || "").toLowerCase();
    const adm = await rest(`admin_users?select=user_id&is_active=eq.true&or=(user_id.eq.${u.id},email.ilike.${encodeURIComponent(email)})&limit=1`);
    if (!adm?.length) return json(403, { error: "Owners only." });
    if (!PUBLISHERS.includes(email)) return json(403, { error: "Only Mike can publish updates." });
    const body = await req.json().catch(() => ({})), id = String(body.release_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: "Missing release." });
    const rel = (await rest(`pst_releases?select=*&id=eq.${id}`))?.[0]; if (!rel) return json(404, { error: "Release not found." });
    if (rel.status === "published") return json(200, { ok: true, already: true });
    if (!["review", "approved", "failed"].includes(rel.status)) return json(409, { error: `This update is ${rel.status}.` });
    if (!GH) return json(500, { error: "The GitHub key isn't set up yet, so updates can't be published from the app." });
    await rest(`pst_releases?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ status: "publishing", publish_by: email, updated_at: new Date().toISOString(), error: null }) });
    const m = await gh(`/pulls/${rel.pr_number}/merge`, { method: "PUT", body: JSON.stringify({ merge_method: "squash", commit_title: `Publish v${rel.version}: ${rel.title}` }) });
    const mj = await m.json().catch(() => ({}));
    if (!m.ok) { const err = `GitHub said: ${mj.message || m.status}`; await rest(`pst_releases?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ status: "failed", error: err, updated_at: new Date().toISOString() }) }); return json(502, { error: err }); }
    const now = new Date().toISOString();
    await rest(`pst_releases?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ status: "published", publish_at: now, commit_sha: mj.sha || null, updated_at: now }) });
    const nums = (rel.tickets || []).map(Number).filter((n: number) => n > 0);
    if (nums.length) await rest(`pst_support_tickets?ticket_no=in.(${nums.join(",")})&status=neq.wont_fix`, { method: "PATCH", body: JSON.stringify({ status: "fixed", fixed_in: rel.version, reply: rel.fix_note || `Fixed in v${rel.version}. Your app updates itself; tell us if it's still happening.`, replied_at: now, updated_at: now }) });
    let told: unknown = null; // v2: push + email + bell to the rest of the owner team (Jeff). Never blocks the publish.
    try {
      const hk = (await rest(`pst_app_secrets?select=value&key=eq.hook_key`))?.[0]?.value || "";
      const pr = await fetch(`${URL_BASE}/functions/v1/pst-push`, { method: "POST", headers: { "Content-Type": "application/json", "x-hook-key": hk }, body: JSON.stringify({ event: "release", ref: id }) });
      told = await pr.json().catch(() => pr.status);
    } catch (e) { told = e instanceof Error ? e.message : String(e); }
    return json(200, { ok: true, sha: mj.sha || null, told });
  } catch (e) { return json(500, { error: e instanceof Error ? e.message : String(e) }); }
});
