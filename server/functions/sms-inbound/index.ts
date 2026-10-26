// sms-inbound v1 · Twilio calls this when a customer replies to a Patriot Peptides USA text. Deploy with verify_jwt = false.
// STOP / STOPALL / UNSUBSCRIBE / CANCEL / END / QUIT  -> texts off for that number (Twilio also blocks the number on its side).
// START / UNSTOP / YES                                -> texts back on (they texted us to restart).
// The request must carry a valid X-Twilio-Signature made with TWILIO_AUTH_TOKEN, otherwise it is ignored.
// Set in Twilio: Messaging Service -> Integration -> "Send a webhook" -> https://<project>.supabase.co/functions/v1/sms-inbound
const URL_BASE = Deno.env.get("SUPABASE_URL") || "", SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", TOK = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const PUBLIC_URL = Deno.env.get("SMS_INBOUND_URL") || `${URL_BASE}/functions/v1/sms-inbound`;
const twiml = (s = 200) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response/>`, { status: s, headers: { "Content-Type": "text/xml" } });
const svc = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
export async function signature(url: string, params: URLSearchParams, token: string) {
  const data = url + [...params.keys()].sort().map(k => k + params.getAll(k).join("")).join("");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(token), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)))));
}
const usPhone = (p: unknown) => { const d = String(p ?? "").replace(/\D/g, ""); return /^1[2-9]\d{9}$/.test(d) ? "+" + d : /^[2-9]\d{9}$/.test(d) ? "+1" + d : ""; };
Deno.serve(async req => {
  if (req.method !== "POST") return twiml(405);
  try {
    const raw = await req.text(), params = new URLSearchParams(raw);
    if (!TOK) return twiml(503);
    const sent = req.headers.get("X-Twilio-Signature") || "", want = await signature(PUBLIC_URL, params, TOK);
    if (sent !== want) { console.log("sms-inbound: bad signature"); return twiml(403); }
    const from = usPhone(params.get("From")), word = String(params.get("Body") || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
    if (!from) return twiml();
    const now = new Date().toISOString();
    let patch: Record<string, unknown> | null = null;
    if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"].includes(word)) patch = { sms_opt_in: false, sms_opt_out_at: now, sms_source: "replied_stop" };
    else if (["START", "UNSTOP", "YES"].includes(word)) patch = { sms_opt_in: true, sms_opt_in_at: now, sms_opt_out_at: null, sms_source: "replied_start" };
    if (patch) await fetch(`${URL_BASE}/rest/v1/customer_profiles?sms_phone=eq.${encodeURIComponent(from)}${patch.sms_opt_in ? "&sms_opt_in_at=not.is.null" : ""}`, { method: "PATCH", headers: svc, body: JSON.stringify({ ...patch, updated_at: now }) });
    return twiml();
  } catch (e) { console.log("sms-inbound error", e instanceof Error ? e.message : e); return twiml(); }
});
