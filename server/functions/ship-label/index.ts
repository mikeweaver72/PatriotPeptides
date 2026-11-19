// ship-label (Nov 2026, Jeff; installed Nov 19 by Mike with two fixes: order fields that exist on Patriot, owner check by account ID only): owner-only. Gets live label rates from Shippo for an order, buys the label the owner picks,
// and voids unused labels. The Shippo key never leaves the server.
// v2 (Nov 19): from email defaults to the shop address (Shippo requires it to buy); overseas-carrier notes hidden from the rates list.
//
// Deploy with JWT verification OFF (it checks the caller itself, like the other functions).
// Secrets: SHIPPO_API_KEY (shippo_test_… while testing, shippo_live_… for real labels). Uses SUPABASE_URL,
// SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY, which Supabase provides.
//
// POST { action: "status" }                                   -> { ok, configured, test_mode, settings_ready }
// POST { action: "rates", order_id, package }                 -> { ok, shipment_id, rates: [...], messages }
//        package = { length, width, height, weight_oz }  (inches, ounces)
// POST { action: "buy", order_id, rate_id, shipment_id, package, allow_another? } -> { ok, label }
// POST { action: "void", label_id }                           -> { ok, status }
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SHIPPO_API_KEY = Deno.env.get("SHIPPO_API_KEY") || "";
const SHIPPO = "https://api.goshippo.com";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
type Rec = Record<string, any>;

const json = (body: Rec, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const serviceHeaders = () => ({ apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" });
async function rest(path: string, options: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...options, headers: { ...serviceHeaders(), ...(options.headers || {}) } });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.message || data?.error || `Database request failed (${r.status}).`);
  return data;
}
async function requireAdmin(req: Request) {
  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new Error("Owner sign-in required.");
  const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: authorization } });
  const user = await ur.json().catch(() => null);
  if (!ur.ok || !user?.id) throw new Error("Your sign-in expired. Sign in again.");
  // Nov 19 2026 (Mike): match the signed-in account ID only (a loose email pattern could match a look-alike address)
  if (!/^[0-9a-f-]{36}$/i.test(String(user.id))) throw new Error("Owner sign-in required.");
  const q = new URLSearchParams({ select: "user_id,is_active", is_active: "eq.true", user_id: `eq.${user.id}`, limit: "1" });
  const admins = await rest(`admin_users?${q.toString()}`);
  if (!Array.isArray(admins) || !admins.length) throw new Error("Only the shop owner can buy labels.");
  return user;
}
async function shippo(path: string, body?: Rec) {
  if (!SHIPPO_API_KEY) throw new Error("Shipping labels aren't set up yet: add the SHIPPO_API_KEY secret in Supabase.");
  const r = await fetch(`${SHIPPO}${path}`, { method: body ? "POST" : "GET", headers: { Authorization: `ShippoToken ${SHIPPO_API_KEY}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const detail = data && typeof data === "object" ? (data.detail || Object.entries(data).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(" ") : typeof v === "object" ? JSON.stringify(v) : v}`).join("; ")) : "";
    throw new Error(`Shippo said no${detail ? `: ${detail}` : ` (${r.status})`}.`);
  }
  return data;
}
const testMode = () => SHIPPO_API_KEY.startsWith("shippo_test_");
const num = (v: any, min: number, max: number, label: string) => { const n = Number(v); if (!isFinite(n) || n < min || n > max) throw new Error(`${label} must be between ${min} and ${max}.`); return Math.round(n * 100) / 100; };
function cleanPackage(p: Rec = {}) {
  return { length: num(p.length, 1, 108, "Length"), width: num(p.width, 1, 108, "Width"), height: num(p.height, 0.25, 108, "Height"), weight_oz: num(p.weight_oz, 0.5, 1120, "Weight"), name: String(p.name || "").slice(0, 60) };
}
async function settings() {
  const rows = await rest("ppu_ship_settings?id=eq.1&select=*");
  const s = Array.isArray(rows) ? rows[0] : null;
  if (!s || !s.from_street1 || !s.from_city || !s.from_state || !s.from_zip || !s.from_phone) throw new Error("Add your ship-from address and phone in Owner → Shipping labels → Settings first.");
  return s;
}
async function loadOrder(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) throw new Error("Unknown order.");
  const rows = await rest(`orders?id=eq.${id}&select=id,order_number,shipping_name,shipping_email,customer_email,shipping_phone,shipping_address_line1,shipping_address_line2,shipping_city,shipping_state,shipping_zip,shipping_service,order_status,status`);
  const o = Array.isArray(rows) ? rows[0] : null;
  if (!o) throw new Error("Order not found.");
  return o;
}
function toAddress(o: Rec) {
  const street1 = String(o.shipping_address_line1 || "").trim();
  const a = { name: String(o.shipping_name || "").trim(), street1, street2: String(o.shipping_address_line2 || "").trim(), city: String(o.shipping_city || "").trim(), state: String(o.shipping_state || "").trim(), zip: String(o.shipping_zip || "").trim(), country: "US", phone: String(o.shipping_phone || "").trim(), email: String(o.shipping_email || o.customer_email || "").trim() };
  const missing = [!a.name && "name", !a.street1 && "street", !a.city && "city", !a.state && "state", !a.zip && "ZIP"].filter(Boolean);
  if (missing.length) throw new Error(`This order's ship-to address is missing the ${missing.join(", ")}. Fix the address on the order, then try again.`);
  return a;
}
const fromAddress = (s: Rec) => ({ name: s.from_name || s.from_company || "Patriot Peptides USA", company: s.from_company || "", street1: s.from_street1, street2: s.from_street2 || "", city: s.from_city, state: s.from_state, zip: s.from_zip, country: "US", phone: s.from_phone, email: s.from_email || "info@patriotpeptides-usa.com" }); // Shippo requires a from email to buy

async function rates(payload: Rec) {
  const [s, o] = await Promise.all([settings(), loadOrder(payload.order_id)]);
  const pk = cleanPackage(payload.package);
  const shipment = await shippo("/shipments/", {
    address_from: fromAddress(s), address_to: toAddress(o),
    parcels: [{ length: String(pk.length), width: String(pk.width), height: String(pk.height), distance_unit: "in", weight: String(pk.weight_oz), mass_unit: "oz" }],
    metadata: `Order ${o.order_number || o.id}`.slice(0, 100), async: false
  });
  const express = o.shipping_service === "express";
  const list = (shipment.rates || []).map((r: Rec) => ({
    id: r.object_id, carrier: r.provider, service: r.servicelevel?.name || "", token: r.servicelevel?.token || "",
    amount: Number(r.amount), currency: r.currency || "USD", days: r.estimated_days ?? null, terms: r.duration_terms || "",
    tags: r.attributes || [], express_match: /priority_mail_express|express/i.test(r.servicelevel?.token || "") && /usps/i.test(r.provider || "")
  })).filter((r: Rec) => isFinite(r.amount)).sort((a: Rec, b: Rec) => a.amount - b.amount);
  // hide Shippo's notes about overseas carriers that never serve a US-to-US box; keep anything useful (address problems, UPS rate notes)
  const noise = /doesn't support one or more shipment options|doesn't support shipments to inside of the US|out of service area/i;
  const messages = (shipment.messages || []).map((m: Rec) => `${m.source || ""}: ${m.text || ""}`.trim()).filter((t: string) => t && !noise.test(t)).slice(0, 6);
  return json({ ok: true, shipment_id: shipment.object_id, express, test_mode: testMode(), rates: list, messages });
}

async function buy(payload: Rec, user: Rec) {
  const o = await loadOrder(payload.order_id);
  const rateId = String(payload.rate_id || "");
  if (!/^[0-9a-z]{16,64}$/i.test(rateId)) throw new Error("Pick a rate first.");
  const existing = await rest(`ppu_shipping_labels?order_id=eq.${o.id}&status=in.(purchased,void_pending)&select=id,tracking_number`);
  if (Array.isArray(existing) && existing.length && !payload.allow_another) return json({ ok: false, needs_confirm: true, error: `This order already has a label (${existing[0].tracking_number || "no tracking yet"}). Buy another one anyway?` }, 409);
  const s = await settings();
  const rate = await shippo(`/rates/${rateId}`);
  if (payload.shipment_id && rate.shipment && rate.shipment !== payload.shipment_id) throw new Error("That rate belongs to a different shipment. Get rates again.");
  const t = await shippo("/transactions/", { rate: rateId, label_file_type: s.label_format || "PDF_4x6", async: false, metadata: `Order ${o.order_number || o.id}`.slice(0, 100) });
  if (t.status !== "SUCCESS") {
    const why = (t.messages || []).map((m: Rec) => m.text).filter(Boolean).join(" ");
    throw new Error(`The label wasn't bought${why ? `: ${why}` : "."} You weren't charged.${/address_from|address_to/i.test(why) ? " Tap Get rates again, then buy." : ""}`);
  }
  const row = {
    order_id: o.id, shippo_shipment: rate.shipment || payload.shipment_id || null, shippo_rate: rateId, shippo_txn: t.object_id,
    carrier: rate.provider || "", service: rate.servicelevel?.name || "", service_token: rate.servicelevel?.token || "",
    amount: Number(rate.amount || 0), currency: rate.currency || "USD", tracking_number: t.tracking_number || "",
    tracking_url: t.tracking_url_provider || "", label_url: t.label_url || "", package: payload.package ? cleanPackage(payload.package) : null,
    test_mode: testMode(), status: "purchased", created_by: user.id
  };
  const saved = await rest("ppu_shipping_labels", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
  return json({ ok: true, label: Array.isArray(saved) ? saved[0] : row });
}

async function voidLabel(payload: Rec) {
  const id = String(payload.label_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Unknown label.");
  const rows = await rest(`ppu_shipping_labels?id=eq.${id}&select=*`);
  const l = Array.isArray(rows) ? rows[0] : null;
  if (!l) throw new Error("Label not found.");
  if (l.status !== "purchased") throw new Error("This label was already voided.");
  const r = await shippo("/refunds/", { transaction: l.shippo_txn, async: false });
  const st = String(r.status || "").toUpperCase();
  const status = st === "SUCCESS" ? "voided" : st === "ERROR" ? "void_rejected" : "void_pending";
  await rest(`ppu_shipping_labels?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status, voided_at: new Date().toISOString() }) });
  return json({ ok: true, status });
}

async function setupStatus() {
  const rows = await rest("ppu_shipping_labels?select=id&limit=1").then(() => rest("ppu_ship_settings?id=eq.1&select=from_street1,from_city,from_state,from_zip,from_phone")).catch(() => null);
  const s = Array.isArray(rows) ? rows[0] : null;
  return json({ ok: true, configured: !!SHIPPO_API_KEY, test_mode: testMode(), tables_ready: !!rows, settings_ready: !!(s && s.from_street1 && s.from_city && s.from_state && s.from_zip && s.from_phone) });
}

serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  try {
    const user = await requireAdmin(req);
    const payload = await req.json().catch(() => ({}));
    switch (payload.action) {
      case "status": return await setupStatus();
      case "rates": return await rates(payload);
      case "buy": return await buy(payload, user);
      case "void": return await voidLabel(payload);
      default: return json({ ok: false, error: "Unknown action." }, 400);
    }
  } catch (err) {
    return json({ ok: false, error: (err as Error)?.message || "Something went wrong." }, 400);
  }
});
