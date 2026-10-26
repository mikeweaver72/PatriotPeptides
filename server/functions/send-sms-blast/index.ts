// send-sms-blast v1 · owner app 5.8 "Text blast". POST + owner JWT. Deploy with verify_jwt = false (it checks the caller itself).
// Sends through Twilio once these secrets exist: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_MESSAGING_SERVICE_SID (or TWILIO_FROM).
// Until then nothing is sent and the app says the text account isn't connected.
// On the staging project it is ALWAYS practice mode: it logs who would get the text and never calls Twilio.
// Rules: only customers who opted in themselves (customer_profiles.sms_opt_in), one text per number, "Reply STOP to opt out"
// added, no blasts outside 9am–8pm Pacific, at most 4 promo texts per number in 30 days, and no second blast while one is sending.
// actions: status | save_test_phone {phone} | test {body} | send {body, user_ids?}
const URL_BASE = Deno.env.get("SUPABASE_URL") || "", SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "", TOK = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const MSID = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID") || "", FROM = Deno.env.get("TWILIO_FROM") || "";
const PRACTICE = (Deno.env.get("STAGING") ?? "") === "1" || Deno.env.get("SMS_PRACTICE") === "1";
const CONNECTED = !!(SID && TOK && (MSID || FROM));
const BRAND = "Patriot Peptides USA: ", STOP = " Reply STOP to opt out.", MAX_BODY = 300, CAP_30D = 4;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const svc = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
async function rest(path: string, init: RequestInit = {}) { const r = await fetch(`${URL_BASE}/rest/v1/${path}`, { ...init, headers: { ...svc, ...(init.headers || {}) } }); const t = await r.text(); if (!r.ok) throw new Error(t || `db ${r.status}`); return t ? JSON.parse(t) : null; }
const usPhone = (p: unknown) => { const d = String(p ?? "").replace(/\D/g, ""); return /^[2-9]\d{9}$/.test(d) ? "+1" + d : /^1[2-9]\d{9}$/.test(d) ? "+" + d : ""; };
const mask = (p: string) => p ? `(•••) •••-${p.slice(-4)}` : "";
export function compose(body: string) { const b = String(body || "").replace(/\s+/g, " ").trim(); return BRAND + b + (/\bstop\b/i.test(b) ? "" : STOP); }
function centralHour() { return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hour12: false }).format(new Date())) % 24; }
const quietOk = () => { if (PRACTICE && Deno.env.get("SMS_QUIET_OFF") === "1") return true; const h = centralHour(); return h >= 9 && h < 20; }; // the override only works in practice mode (staging tests)
async function twilio(to: string, text: string): Promise<{ ok: boolean; id?: string; code?: number; error?: string }> {
  const form = new URLSearchParams({ To: to, Body: text, ...(MSID ? { MessagingServiceSid: MSID } : { From: FROM }) });
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, { method: "POST", headers: { Authorization: "Basic " + btoa(`${SID}:${TOK}`), "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  const j = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, id: j.sid } : { ok: false, code: j.code, error: j.message || `Twilio ${r.status}` };
}
async function eligible() {
  const rows = await rest(`customer_profiles?select=user_id,first_name,last_name,sms_phone,sms_opt_in_at&sms_opt_in=eq.true&sms_phone=not.is.null&limit=5000`) || [];
  const seen = new Set<string>(); return rows.filter((r: any) => { const p = usPhone(r.sms_phone); if (!p || seen.has(p)) return false; seen.add(p); r.sms_phone = p; return true; });
}
Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") || ""; if (!auth.startsWith("Bearer ")) return json(401, { error: "Sign in first." });
    const ur = await fetch(`${URL_BASE}/auth/v1/user`, { headers: { apikey: ANON || SRK, Authorization: auth } }); const u = await ur.json().catch(() => null);
    if (!ur.ok || !u?.id) return json(401, { error: "Your session expired. Sign in again." });
    const email = String(u.email || "").toLowerCase();
    const adm = await rest(`admin_users?select=user_id&is_active=eq.true&or=(user_id.eq.${u.id},email.ilike.${encodeURIComponent(email)})&limit=1`);
    if (!adm?.length) return json(403, { error: "Owners only." });
    const b = await req.json().catch(() => ({})), action = String(b.action || "status");
    const settings = (await rest(`pst_sms_settings?select=*&id=eq.1`))?.[0] || {};
    if (action === "status") {
      const list = await eligible(), since = new Date(Date.now() - 30 * 864e5).toISOString();
      const camps = await rest(`pst_sms_campaigns?select=id,body,is_test,status,recipients,sent,failed,skipped,created_by,created_at&order=created_at.desc&limit=15`) || [];
      return json(200, { ok: true, connected: CONNECTED, practice: PRACTICE, quiet_ok: quietOk(), test_phone: settings.test_phone || "", eligible: list.map((r: any) => ({ id: r.user_id, name: [r.first_name, r.last_name].filter(Boolean).join(" ") || "Customer", phone: mask(r.sms_phone), since: r.sms_opt_in_at })),
        campaigns: camps, sent_30d: camps.filter((c: any) => !c.is_test && c.created_at >= since).length, brand: BRAND, stop: STOP, max_body: MAX_BODY });
    }
    if (action === "save_test_phone") {
      const p = usPhone(b.phone); if (!p) return json(400, { error: "Enter a 10-digit US mobile number." });
      await rest(`pst_sms_settings?id=eq.1`, { method: "PATCH", body: JSON.stringify({ test_phone: p, updated_at: new Date().toISOString(), updated_by: email }) });
      return json(200, { ok: true, test_phone: p });
    }
    const body = String(b.body || "").replace(/\s+/g, " ").trim();
    if (!body) return json(400, { error: "Write the message first." });
    if (body.length > MAX_BODY) return json(400, { error: `Keep it under ${MAX_BODY} characters.` });
    const text = compose(body);
    if (!PRACTICE && !CONNECTED) return json(409, { error: "Your text account isn't connected yet, so nothing was sent." });
    if (action === "test") {
      const to = usPhone(settings.test_phone); if (!to) return json(400, { error: "Add your phone number first." });
      const camp = (await rest(`pst_sms_campaigns`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ body: text, is_test: true, status: PRACTICE ? "practice" : "sending", recipients: 1, created_by: email }) }))[0];
      const r = PRACTICE ? { ok: true, id: "practice" } : await twilio(to, text);
      await rest(`pst_sms_log`, { method: "POST", body: JSON.stringify({ campaign_id: camp.id, phone: to, status: PRACTICE ? "practice" : r.ok ? "sent" : "failed", provider_id: r.id || null, error: r.ok ? null : r.error }) });
      await rest(`pst_sms_campaigns?id=eq.${camp.id}`, { method: "PATCH", body: JSON.stringify({ status: PRACTICE ? "practice" : r.ok ? "done" : "failed", sent: r.ok ? 1 : 0, failed: r.ok ? 0 : 1, error: r.ok ? null : r.error, finished_at: new Date().toISOString() }) });
      if (!r.ok) return json(502, { error: `The text didn't go through: ${r.error}` });
      return json(200, { ok: true, practice: PRACTICE, to: mask(to), text });
    }
    if (action !== "send") return json(400, { error: "Unknown action." });
    if (!quietOk()) return json(409, { error: "Text blasts can only go out between 9am and 8pm Central. Try again then." });
    const busy = await rest(`pst_sms_campaigns?select=id&status=eq.sending&is_test=eq.false&created_at=gte.${new Date(Date.now() - 10 * 6e4).toISOString()}&limit=1`);
    if (busy?.length) return json(409, { error: "A text blast is already sending. Give it a minute." });
    let list = await eligible();
    if (Array.isArray(b.user_ids)) { const want = new Set(b.user_ids.map(String)); list = list.filter((r: any) => want.has(String(r.user_id))); }
    if (!list.length) return json(400, { error: "Nobody picked has said yes to texts." });
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const recent = await rest(`pst_sms_log?select=phone,pst_sms_campaigns!inner(is_test)&status=eq.sent&created_at=gte.${since}&pst_sms_campaigns.is_test=eq.false&limit=20000`) || [];
    const count = new Map<string, number>(); recent.forEach((r: any) => count.set(r.phone, (count.get(r.phone) || 0) + 1));
    const camp = (await rest(`pst_sms_campaigns`, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ body: text, is_test: false, status: "sending", recipients: list.length, created_by: email }) }))[0];
    let sent = 0, failed = 0, skipped = 0; const logs: unknown[] = [];
    const work = list.slice(); const one = async () => { for (let r = work.shift(); r; r = work.shift()) {
      const to = r.sms_phone as string;
      if ((count.get(to) || 0) >= CAP_30D) { skipped++; logs.push({ campaign_id: camp.id, user_id: r.user_id, phone: to, status: "skipped", error: `Already got ${CAP_30D} texts in 30 days` }); continue; }
      if (PRACTICE) { sent++; logs.push({ campaign_id: camp.id, user_id: r.user_id, phone: to, status: "practice" }); continue; }
      const x = await twilio(to, text);
      if (x.ok) { sent++; logs.push({ campaign_id: camp.id, user_id: r.user_id, phone: to, status: "sent", provider_id: x.id }); }
      else if (x.code === 21610) { skipped++; logs.push({ campaign_id: camp.id, user_id: r.user_id, phone: to, status: "opted_out", error: x.error });
        await rest(`customer_profiles?user_id=eq.${r.user_id}`, { method: "PATCH", body: JSON.stringify({ sms_opt_in: false, sms_opt_out_at: new Date().toISOString(), sms_source: "replied_stop" }) }).catch(() => {}); }
      else { failed++; logs.push({ campaign_id: camp.id, user_id: r.user_id, phone: to, status: "failed", error: x.error }); }
    } };
    await Promise.all([one(), one(), one(), one()]);
    for (let i = 0; i < logs.length; i += 500) await rest(`pst_sms_log`, { method: "POST", body: JSON.stringify(logs.slice(i, i + 500)) });
    await rest(`pst_sms_campaigns?id=eq.${camp.id}`, { method: "PATCH", body: JSON.stringify({ status: PRACTICE ? "practice" : failed && !sent ? "failed" : "done", sent, failed, skipped, finished_at: new Date().toISOString() }) });
    return json(200, { ok: true, practice: PRACTICE, sent, failed, skipped, text });
  } catch (e) { return json(500, { error: e instanceof Error ? e.message : String(e) }); }
});
