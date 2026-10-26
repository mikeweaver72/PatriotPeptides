// pst-push · Patriot Peptides USA web push (v8, Oct 26 2026: owners hear when an update is published; v7: problem reports alert Mike by push + email; v6: a "Hand Delivered" shipment means delivered). Deploy with verify_jwt = false (it checks callers itself).
//   GET                                   -> { publicKey }   (VAPID keys are created on first use, kept in pst_app_secrets)
//   POST {subscribe, role, ua} + user JWT -> saves this device (role "owner" only for active admin_users)
//   POST {unsubscribe}         + user JWT -> removes this device
//   POST {test:true}           + user JWT -> test alert to the caller's devices
//   POST {event:"new_order", order_id}  + x-hook-key -> owners: "New order · $175.50"
//   POST {event:"status",    order_id}  + x-hook-key -> customer: paid / ready for shipping / packed / shipped / delivered
//   POST {event:"reminders"}            + x-hook-key -> customers: "Running low on KLOW 80mg?" (daily cron)
//   POST {paid_notice: order_id} + user JWT        -> owners: "Jane says she paid · $175.50" (customer tapped "I've sent payment")
//   POST {event:"owner_event", kind, ref}   + x-hook-key -> owners: new account / availability or bulk request / sold out
//   POST {event:"ticket", kind:"new"|"followup", ref} + x-hook-key -> publishers (Mike): "Jeff reported a problem · #5" (push + email)
//   POST {event:"release", ref: release_id} + x-hook-key -> Jeff + report filers, not the publisher: "Update 5.10 is live · fixed your reports #2–#5"
//   POST {payments:[…]} + x-pay-key   -> Venmo payments reported by the Gmail helper script: match to the open order, alert owner
// v5: Venmo payment matching. Never marks an order paid; the owner confirms with one tap.
// v4: customer alerts open the exact order (account.html?o=…#orders); reminders open it with the item highlighted, plus an
//     "Add to bag" button on Android/computer. Owner alerts for every store event, each switchable.
// v4 (owner): alerts for every store event (cancellations incl. the 24h auto-cancel, sign-ups, requests, sold out), each switchable.
// v3: every alert is also saved to pst_inbox (the bell), each person's pst_notify_prefs are respected, and the daily run
//     also sends the owner one low-stock note. Test alerts land in the bell too.
// v2: reminders follow the latest purchase of each item; "Auto" reminders use the customer's own reorder rhythm once they have one.
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SITE = (Deno.env.get("SITE_URL") ?? "https://www.patriotpeptides-usa.com/").replace(/\/?$/, "/");
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hook-key", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const money = (n: unknown) => Number(n || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
type Row = Record<string, any>;

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

async function secret(key: string) { const { data } = await admin.from("pst_app_secrets").select("value").eq("key", key).maybeSingle(); return data?.value as string | undefined; }
async function vapid() {
  let pub = await secret("vapid_public"), priv = await secret("vapid_private");
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    await admin.from("pst_app_secrets").upsert([{ key: "vapid_public", value: k.publicKey }, { key: "vapid_private", value: k.privateKey }], { onConflict: "key", ignoreDuplicates: true });
    pub = await secret("vapid_public"); priv = await secret("vapid_private");
  }
  webpush.setVapidDetails("mailto:info@patriotpeptides-usa.com", pub!, priv!);
  return pub!;
}
async function send(subs: Row[], payload: Row) {
  let ok = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 86400, urgency: "high" });
      ok++; await admin.from("pst_push_subscriptions").update({ last_ok_at: new Date().toISOString(), fail_count: 0 }).eq("id", s.id);
    } catch (e: any) {
      const code = e?.statusCode;
      if (code === 404 || code === 410) await admin.from("pst_push_subscriptions").delete().eq("id", s.id);
      else await admin.from("pst_push_subscriptions").update({ fail_count: (s.fail_count || 0) + 1 }).eq("id", s.id);
      console.log("push fail", s.id, code, e?.body || e?.message);
    }
  }
  return ok;
}
// keep only devices whose person wants this kind of alert (no settings row = everything on)
async function wanted(subs: Row[], role: string, field: string) {
  const ids = [...new Set(subs.map(s => s.user_id).filter(Boolean))];
  if (!ids.length) return subs;
  const { data } = await admin.from("pst_notify_prefs").select("*").eq("role", role).in("user_id", ids);
  const off = new Set((data || []).filter((r: Row) => r[field] === false).map((r: Row) => r.user_id));
  return subs.filter(s => !off.has(s.user_id));
}
async function inbox(role: string, user_id: string | null, kind: string, p: Row) {
  const { error } = await admin.from("pst_inbox").insert({ role, user_id, kind, title: String(p.title || "").slice(0, 160), body: String(p.body || "").slice(0, 400) || null, url: String(p.url || "").slice(0, 300) || null });
  if (error) console.log("inbox", error.message);
}
async function prefOn(user_id: string, role: string, field: string) {
  const { data } = await admin.from("pst_notify_prefs").select("*").eq("user_id", user_id).eq("role", role).maybeSingle();
  return !data || data[field] !== false;
}
async function ownerSend(field: string, kind: string, p: Row) {
  await inbox("owner", null, kind, p);
  const { data: subs } = await admin.from("pst_push_subscriptions").select("*").eq("role", "owner");
  return await send(await wanted(subs || [], "owner", field), p);
}
async function customerSend(uid: string, field: string, kind: string, p: Row) {
  if (!(await prefOn(uid, "customer", field))) return 0;   // turned off: no bell entry, no ping
  await inbox("customer", uid, kind, p);
  const { data: subs } = await admin.from("pst_push_subscriptions").select("*").eq("user_id", uid).eq("role", "customer");
  return await send(subs || [], p);
}

async function once(kind: string, ref: string, user_id: string | null) {
  const { error } = await admin.from("pst_notify_log").insert({ kind, ref, user_id });
  return !error; // unique(kind, ref): false means it was already sent
}
async function isAdmin(u: Row) {
  const { data } = await admin.from("admin_users").select("*").or(`user_id.eq.${u.id},email.eq.${u.email}`);
  return (data || []).some((r: Row) => r.is_active === true || r.active === true || r.is_admin === true || r.email === u.email);
}
const lower = (v: unknown) => String(v ?? "").toLowerCase();
const isShipping = (o: Row) => /shipping/i.test(o.customer_notes || "");
const customerId = (o: Row) => o.customer_id || o.user_id || o.customer_uuid;

async function newOrder(id: string) {
  await sleep(5000); // the order lines are saved right after the order row
  const { data: o } = await admin.from("orders").select("*").eq("id", id).maybeSingle();
  if (!o || !(await once("new_order", id, null))) return { skipped: true };
  const { data: items } = await admin.from("order_items").select("product_name,product_strength,quantity").eq("order_id", id);
  const list = (items || []).map((i: Row) => `${i.product_name} ${i.product_strength || ""}${i.quantity > 1 ? ` ×${i.quantity}` : ""}`.trim()).join(", ");
  const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).neq("payment_status", "paid").not("status", "in", "(cancelled,rejected,refunded,failed,shipped,delivered)");
  const sent = await ownerSend("new_orders", "new_order", {
    title: `New order · ${money(o.total)}`,
    body: `${o.customer_name || "Customer"} · ${list || "items"} · ${o.payment_method || "payment pending"} · ${isShipping(o) ? "Shipping" : "Ship"}`,
    url: `owner.html#o=${id}`, tag: `order-${id}`, badge: count ?? undefined
  });
  return { sent };
}

async function status(id: string) {
  const { data: o } = await admin.from("orders").select("*").eq("id", id).maybeSingle();
  if (!o) return { skipped: "no order" };
  const st = lower(o.order_status || o.status), pay = lower(o.payment_status), pk = isShipping(o), no = o.order_number || "your order";
  let stage = "", title = "", body = "";
  if (["cancelled", "canceled", "rejected"].includes(st)) { stage = "cancelled"; title = "Order update"; body = `${no} was ${st}. Questions? Reply to your order email.`; }
  else if (st === "delivered" || st === "complete" || st === "completed") { stage = "delivered"; title = pk ? "Delivered" : "Delivered"; body = pk ? `${no} is complete. Reorder anytime in the app.` : `${no} was delivered.`; }
  else if (st === "shipped" && /hand\s*deliver/i.test(`${o.tracking_carrier || ""} ${o.tracking_number || ""}`)) { stage = "delivered"; title = pk ? "Delivered" : "Delivered"; body = pk ? `${no} is complete. Reorder anytime in the app.` : `${no} was hand delivered.`; } // owner's shipping hand-off
  else if (st === "shipped") { stage = pk ? "ready" : "shipped"; title = pk ? "Packed" : "Your order shipped"; body = pk ? `${no} is ready. Tracking is on its way.` : `${no} is on the way${o.tracking_number && !/no tracking/i.test(o.tracking_number) ? ` · ${o.tracking_carrier || "Tracking"} ${o.tracking_number}` : ""}.`; }
  else if (st === "packed") { stage = pk ? "ready" : "packed"; title = pk ? "Packed" : "Packed"; body = pk ? `${no} is ready. Tracking is on its way.` : `${no} is packed and waiting on the carrier.`; }
  else if (pay === "paid") { stage = "paid"; title = "Payment confirmed"; body = `${no} is confirmed. ${pk ? "We'll let you know when it's ready for shipping." : "We're getting it ready to ship."}`; }
  if (stage === "cancelled" && (await once("owner_cancel", id, null))) {
    const auto = /24-hour payment reservation expired/i.test(String(o.admin_notes || "") + String(o.admin_note || ""));
    await ownerSend("cancellations", "order_cancelled", { title: `${auto ? "Auto-cancelled" : "Cancelled"} · ${no} · ${money(o.total)}`, body: `${o.customer_name || "Customer"}${auto ? " · not paid within 24 hours, stock went back on the shelf" : ` · ${st}`}`, url: `owner.html#o=${id}`, tag: `order-${id}` });
  }
  if (!stage || (pk && stage === "packed")) return { skipped: "no customer-facing change" };
  const uid = customerId(o); if (!uid) return { skipped: "no customer" };
  if (!(await once(`status:${stage}`, id, uid))) return { skipped: "already sent" };
  return { sent: await customerSend(uid, "orders", `order_${stage}`, { title, body, url: `account.html?o=${id}#orders`, tag: `order-${id}` }) };
}

async function reminders() {
  const { data: rows, error } = await admin.from("order_items").select("*").not("reorder_reminder_days", "is", null).is("reorder_reminded_at", null).limit(500);
  if (error) return { error: error.message };
  const now = Date.now(); let sent = 0, checked = 0;
  const done = (id: string) => admin.from("order_items").update({ reorder_reminded_at: new Date().toISOString() }).eq("id", id);
  for (const i of rows || []) {
    const { data: o } = await admin.from("orders").select("*").eq("id", i.order_id).maybeSingle();
    if (!o || lower(o.payment_status) !== "paid" || ["cancelled", "canceled", "rejected", "refunded"].includes(lower(o.order_status || o.status))) continue;
    const uid = customerId(o); checked++;
    // every paid order this customer placed for the same item, oldest first
    const { data: mine } = await admin.from("orders").select("*").or(`customer_id.eq.${uid},user_id.eq.${uid}`).order("created_at", { ascending: true });
    const paid = (mine || []).filter((x: Row) => lower(x.payment_status) === "paid" && !["cancelled", "canceled", "rejected", "refunded"].includes(lower(x.order_status || x.status)));
    const { data: same } = paid.length ? await admin.from("order_items").select("order_id").in("order_id", paid.map((x: Row) => x.id)).eq("product_key", i.product_key) : { data: [] };
    const ids = new Set((same || []).map((x: Row) => x.order_id));
    const times = paid.filter((x: Row) => ids.has(x.id)).map((x: Row) => new Date(x.created_at).getTime());
    if (times.some(t => t > new Date(o.created_at).getTime())) { await done(i.id); continue; } // a newer order of this item replaces this reminder
    const gaps = times.slice(1).map((t, j) => (t - times[j]) / 864e5).filter(d => d >= 5 && d <= 200).sort((a, b) => a - b);
    const days = i.reorder_reminder_auto && gaps.length ? gaps[gaps.length >> 1] : Number(i.reorder_reminder_days);
    if (new Date(o.created_at).getTime() + (days - 2) * 864e5 > now) continue; // a couple of days before the estimate
    await done(i.id);
    if (!uid) continue;
    sent += await customerSend(uid, "reminders", "reminder", { title: `Running low on ${i.product_name} ${i.product_strength || ""}?`.replace(/\s+\?/, "?"), body: `It's been about ${Math.max(1, Math.round(days / 7))} week${Math.round(days / 7) === 1 ? "" : "s"}. Tap to add it to your bag.`, url: `account.html?o=${i.order_id}&item=${encodeURIComponent(i.product_key || "")}&source=reminder#orders`, addUrl: `account.html?o=${i.order_id}&item=${encodeURIComponent(i.product_key || "")}&add=1&source=reminder#orders`, actions: [{ action: "add", title: "Add to bag" }], tag: `remind-${i.product_key}` });
  }
  return { checked, sent };
}

// once a day (with the reminder run): one note to the owner if anything is low or out
async function lowStock() {
  const day = new Date().toISOString().slice(0, 10);
  const { data: inv } = await admin.from("product_inventory").select("product_key,display_name,strength,current_inventory,low_stock_threshold,is_active");
  const live = (inv || []).filter((r: Row) => r.is_active !== false);
  const out = live.filter((r: Row) => Number(r.current_inventory) <= 0);
  const low = live.filter((r: Row) => Number(r.current_inventory) > 0 && Number(r.current_inventory) <= Number(r.low_stock_threshold ?? 5)).sort((a: Row, b: Row) => a.current_inventory - b.current_inventory);
  if (!low.length && !out.length) return { low: 0, out: 0 };
  if (!(await once("low_stock", day, null))) return { skipped: "already sent today" };
  const name = (r: Row) => `${r.display_name} ${r.strength || ""}`.trim();
  const body = [low.length ? `Low: ${low.slice(0, 4).map((r: Row) => `${name(r)} (${r.current_inventory})`).join(", ")}${low.length > 4 ? ` +${low.length - 4} more` : ""}` : "", out.length ? `${out.length} out of stock` : ""].filter(Boolean).join(" · ");
  const sent = await ownerSend("low_stock", "low_stock", { title: `${low.length + out.length} item${low.length + out.length === 1 ? "" : "s"} need restocking`, body, url: "owner.html#stock", tag: "low-stock" });
  return { low: low.length, out: out.length, sent };
}

// owner-only events fired by database triggers (v10)
async function ownerEvent(kind: string, ref: string) {
  // sold out can happen again after a restock: clear this item's old sold-out marker (older than 6 hours) first
  if (kind === "sold_out") await admin.from("pst_notify_log").delete().eq("kind", "owner_sold_out").eq("ref", ref).lt("created_at", new Date(Date.now() - 6 * 3600e3).toISOString());
  if (!ref || !(await once(`owner_${kind}`, ref, null))) return { skipped: "already sent" };
  if (kind === "signup") {
    const { data: c } = await admin.from("customer_profiles").select("*").eq("user_id", ref).maybeSingle();
    if (!c) return { skipped: "no profile" };
    const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email;
    return { sent: await ownerSend("signups", "signup", { title: `New account · ${name}`, body: [c.email, [c.shipping_city, c.shipping_state].filter(Boolean).join(", "), c.marketing_opt_in ? "opted in to deals" : ""].filter(Boolean).join(" · "), url: "customers.html", tag: `signup-${ref}` }) };
  }
  if (kind === "request") {
    const { data: r } = await admin.from("product_availability_requests").select("*").eq("id", ref).maybeSingle();
    if (!r) return { skipped: "no request" };
    const { data: all } = await admin.from("product_availability_requests").select("requested_quantity").eq("product_key", r.product_key).eq("status", "pending");
    const total = (all || []).reduce((n: number, x: Row) => n + Number(x.requested_quantity || 0), 0);
    return { sent: await ownerSend("requests", "request", { title: `Request · ${r.product_name} ${r.product_strength || ""} ×${r.requested_quantity}`.replace(/\s+×/, " ×"), body: `${r.customer_name || r.customer_email}${(all || []).length > 1 ? ` · ${(all || []).length} people waiting, ${total} vials total` : ""}`, url: "owner.html#products", tag: `req-${r.product_key}` }) };
  }
  if (kind === "bulk") {
    const { data: b } = await admin.from("bulk_requests").select("*").eq("request_number", ref).maybeSingle();
    if (!b) return { skipped: "no bulk request" };
    return { sent: await ownerSend("requests", "bulk", { title: `Bulk request · ${b.product} ${b.strength || ""} · ${b.kits} kits`, body: `${b.name}${b.company ? ` (${b.company})` : ""} · ${b.email}`, url: "bulk-requests.html", tag: `bulk-${ref}` }) };
  }
  if (kind === "sold_out") {
    const { data: i } = await admin.from("product_inventory").select("display_name,strength,is_active").eq("product_key", ref).maybeSingle();
    if (!i || i.is_active === false) return { skipped: "hidden product" };
    return { sent: await ownerSend("sold_out", "sold_out", { title: `Sold out · ${i.display_name} ${i.strength || ""}`.trim(), body: "Shoppers can still request it. Restock in Inventory when it's on the way.", url: "owner.html#stock", tag: `soldout-${ref}` }) };
  }
  return { skipped: "unknown kind" };
}

// v7: problem reports (owner app → Report a problem). Alerts go to the publishers (PUBLISHERS env, default Mike) by push and
// email, never to the person who filed it, and not into the shared owner bell. Fired by the pst_ticket_hook database trigger.
const PUBLISHERS = (Deno.env.get("PUBLISHERS") ?? "mike.weaver2013@gmail.com").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
const STAGING = (Deno.env.get("STAGING") ?? "") === "1";
const escH = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
async function ticketEvent(kind: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { skipped: "bad ref" };
  await sleep(4000); // screenshots are saved right after the report
  const { data: t } = await admin.from("pst_support_tickets").select("*").eq("id", id).maybeSingle();
  if (!t) return { skipped: "no ticket" };
  const by = lower(t.created_by_email), fu = Array.isArray(t.followups) ? t.followups : [];
  if (!(await once(`ticket_${kind}`, kind === "new" ? id : `${id}:${fu.length}:${t.status}`, null))) return { skipped: "already sent" };
  const to = PUBLISHERS.filter(e => e !== by);
  if (!to.length) return { skipped: "filed by the publisher" };
  const who = /^owner@patriotpeptides-usa\.com$/.test(by) ? "Jeff" : (by.split("@")[0] || "Someone");
  const urg = ({ blocking: "Can't do my work", annoying: "Annoying", idea: "Idea / request" } as Row)[t.urgency] || t.urgency || "";
  const reopened = t.status === "reopened", last = fu[fu.length - 1];
  const title = kind === "new" ? `${who} reported a problem · #${t.ticket_no}` : reopened ? `${who} says #${t.ticket_no} is still happening` : `${who} added to report #${t.ticket_no}`;
  const text = String((kind === "new" ? t.what : last?.text || t.what) || "");
  const p = { title, body: `${kind === "new" && urg ? `${urg} · ` : ""}${text}`.slice(0, 200), url: "owner.html#help", tag: `ticket-${t.ticket_no}` };
  const { data: au } = await admin.from("admin_users").select("user_id,email").eq("is_active", true);
  const uids = (au || []).filter((r: Row) => to.includes(lower(r.email)) && r.user_id).map((r: Row) => r.user_id);
  let sent = 0;
  if (uids.length) { const { data: subs } = await admin.from("pst_push_subscriptions").select("*").eq("role", "owner").in("user_id", uids); sent = await send(subs || [], p); }
  let emailed: unknown = "skipped";
  const key = Deno.env.get("RESEND_API_KEY") ?? "";
  if (key && !STAGING) {
    const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, ""), shots = Array.from({ length: Number(t.shot_count || 0) }, (_, i) => `${base}/functions/v1/pst-support-shot?t=${t.id}&k=${t.view_key}&i=${i}`);
    const d = (t.diag || {}) as Row;
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#24303b;max-width:620px">
<p style="margin:0 0 6px;color:#C8102E;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Patriot Peptides USA · problem report</p>
<h1 style="margin:0 0 12px;font-family:Georgia,serif;font-weight:500;font-size:24px;color:#12266E">${escH(title)}</h1>
${kind === "new" ? `<p style="margin:0 0 6px"><b>How bad:</b> ${escH(urg)} · <b>Where:</b> ${escH(t.screen || "")}</p><p style="margin:0 0 12px;white-space:pre-wrap;font-size:15px;line-height:1.5">${escH(t.what)}</p>${t.expected ? `<p style="margin:0 0 12px"><b>Expected:</b> ${escH(t.expected)}</p>` : ""}`
  : `<p style="margin:0 0 12px;white-space:pre-wrap;font-size:15px;line-height:1.5">${escH(last?.text || "")}</p><p style="margin:0 0 12px;color:#66717d">Original report: ${escH(t.what)}</p>`}
${shots.length ? `<p style="margin:0 0 6px"><b>Screenshots:</b> ${shots.map((u, i) => `<a href="${u}" style="color:#12266E">#${i + 1}</a>`).join(" · ")}</p>` : ""}
<p style="margin:0 0 16px;color:#66717d;font-size:12px">App ${escH(d.app || "?")} · ${escH(d.viewport || "")} · ${escH(d.theme || "")} theme · ${d.standalone ? "installed app" : "browser"}${Array.isArray(d.log) && d.log.length ? ` · ${d.log.length} error${d.log.length === 1 ? "" : "s"} recorded` : ""}</p>
<p><a href="${SITE}owner.html#help" style="display:inline-block;background:#12266E;color:#fff;text-decoration:none;font-weight:700;padding:11px 16px;border-radius:4px">Open the report</a></p>
<p style="color:#66717d;font-size:12px">The hourly report watch picks this up too. Fixes land in Updates for you to publish.</p></div>`;
    try {
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: Deno.env.get("FROM_EMAIL") ?? "Patriot Peptides USA <onboarding@resend.dev>", to, subject: title, html, text: `${title}\n\n${text}\n\n${SITE}owner.html#help` }) });
      emailed = r.ok ? true : `resend ${r.status}`;
    } catch (e: any) { emailed = e?.message || "email failed"; }
  }
  return { sent, emailed };
}

// v8: an update was published (called by pst-release). Jeff (RELEASE_NOTIFY) and anyone whose report is in it hear about it,
// never the publisher: push to their owner devices and an email listing their reports, plus a note in the owner bell.
async function releaseEvent(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { skipped: "bad ref" };
  const { data: r } = await admin.from("pst_releases").select("*").eq("id", id).maybeSingle();
  if (!r || r.status !== "published") return { skipped: "not published" };
  if (!(await once("release_published", id, null))) return { skipped: "already sent" };
  const pub = lower(r.publish_by);
  const nums = (r.tickets || []).map(Number).filter((n: number) => n > 0);
  const { data: tix } = nums.length ? await admin.from("pst_support_tickets").select("ticket_no,what,reply,created_by_email").in("ticket_no", nums).order("ticket_no") : { data: [] };
  const list = (tix || []) as Row[];
  // who hears: RELEASE_NOTIFY (default Jeff) + whoever filed a report in this update; active owners only, never the publisher
  const want = new Set([...(Deno.env.get("RELEASE_NOTIFY") ?? "owner@patriotpeptides-usa.com").toLowerCase().split(","), ...list.map(t => lower(t.created_by_email))].map(e => e.trim()).filter(Boolean));
  const { data: au } = await admin.from("admin_users").select("user_id,email").eq("is_active", true);
  const team = (au || []).filter((x: Row) => x.email && want.has(lower(x.email)) && lower(x.email) !== pub);
  const range = nums.length ? (nums.length > 2 && nums.every((n: number, i: number) => !i || n === nums[i - 1] + 1) ? `#${nums[0]}–#${nums[nums.length - 1]}` : nums.map((n: number) => `#${n}`).join(", ")) : "";
  const title = `Update ${r.version} is live${range ? ` · fixed your report${nums.length === 1 ? "" : "s"} ${range}` : ` · ${r.title}`}`;
  const p = { title: title.slice(0, 160), body: `${range ? `${r.title}. ` : ""}Close and reopen the app to get it. Tap to see what changed.`, url: "owner.html#updates", tag: `release-${r.version}` };
  await inbox("owner", null, "release", p);
  const uids = team.map((x: Row) => x.user_id).filter(Boolean);
  let sent = 0;
  if (uids.length) { const { data: subs } = await admin.from("pst_push_subscriptions").select("*").eq("role", "owner").in("user_id", uids); sent = await send(subs || [], p); }
  let emailed: unknown = "skipped";
  const key = Deno.env.get("RESEND_API_KEY") ?? "", to = [...new Set(team.map((x: Row) => lower(x.email)))];
  if (key && !STAGING && to.length) {
    const rows = list.map(t => `<tr><td style="padding:8px 10px 8px 0;vertical-align:top;font-weight:700;color:#12266E">#${t.ticket_no}</td><td style="padding:8px 0;vertical-align:top"><div style="color:#66717d;font-size:13px">You said: ${escH(String(t.what || "").slice(0, 240))}</div></td></tr>`).join("");
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#24303b;max-width:620px">
<p style="margin:0 0 6px;color:#C8102E;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Patriot Peptides USA · app update</p>
<h1 style="margin:0 0 12px;font-family:Georgia,serif;font-weight:500;font-size:24px;color:#12266E">${escH(title)}</h1>
<p style="margin:0 0 12px;font-size:15px;line-height:1.5"><b>${escH(r.title)}</b></p>
${r.notes ? `<p style="margin:0 0 12px;white-space:pre-wrap;font-size:14px;line-height:1.5">${escH(r.notes)}</p>` : ""}
${rows ? `<p style="margin:12px 0 4px;font-weight:700">Your reports in this update</p><table style="border-collapse:collapse;font-size:14px">${rows}</table>` : ""}
<p style="margin:14px 0 12px">Close and reopen the app to get it. If something's still not right, open the report in the app and tap "Still happening".</p>
<p><a href="${SITE}owner.html#updates" style="display:inline-block;background:#12266E;color:#fff;text-decoration:none;font-weight:700;padding:11px 16px;border-radius:4px">See what changed</a></p></div>`;
    const text = `${title}\n\n${r.title}\n${r.notes || ""}\n\n${list.map(t => `#${t.ticket_no}: ${t.what}`).join("\n")}\n\nClose and reopen the app to get it.\n${SITE}owner.html#updates`;
    try {
      const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: Deno.env.get("FROM_EMAIL") ?? "Patriot Peptides USA <onboarding@resend.dev>", to, subject: title, html, text }) });
      emailed = res.ok ? true : `resend ${res.status}`;
    } catch (e: any) { emailed = e?.message || "email failed"; }
  }
  return { sent, emailed, to: to.length };
}

// v5: Venmo "paid you" emails, reported by the Google script in the owner's Gmail (DKIM-checked there and flagged here)
const short = (n: string) => { const p = String(n || "").trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : (p[0] || "Someone"); };
async function payments(list: Row[]) {
  const out: Row[] = [];
  for (const x of (Array.isArray(list) ? list : []).slice(0, 40)) {
    const msg_id = String(x.id || "").slice(0, 120), amount = Math.round(Number(x.amount) * 100) / 100;
    if (!msg_id || !(amount > 0)) continue;
    const payer = String(x.from_name || "").slice(0, 80), source = ["zelle", "cashapp"].includes(x.source) ? x.source : "venmo";
    const text = String(x.note || "").slice(0, 2000);
    const m = text.match(/PP[\s-]*O?\s*-?\s*(\d{6})/i) || text.match(/\b(1\d{5})\b/);
    const number = m ? `PP-O${m[1]}` : null;
    let order: Row | null = null, status = "no_order";
    if (x.dkim_ok !== true) status = "unverified";
    else {
      if (number) { const { data } = await admin.from("orders").select("*").eq("order_number", number).maybeSingle(); order = data; }
      if (!order) { // no number in the note: one open order with exactly this total in the last 3 days
        const { data } = await admin.from("orders").select("*").neq("payment_status", "paid").eq("total", amount).gte("created_at", new Date(Date.now() - 3 * 864e5).toISOString());
        const open = (data || []).filter((o: Row) => !["cancelled", "canceled", "rejected", "refunded"].includes(lower(o.order_status || o.status)));
        if (open.length === 1) { order = open[0]; status = "guessed"; }
      }
      if (order && status !== "guessed") status = lower(order.payment_status) === "paid" ? "already_paid" : Math.abs(Number(order.total) - amount) < 0.01 ? "matched" : "amount_mismatch";
    }
    const { error } = await admin.from("pst_payment_matches").insert({ msg_id, source, payer: short(payer), amount, order_id: order?.id || null, order_number: order?.order_number || number, order_total: order?.total ?? null, status, received_at: x.date || null });
    if (error) { out.push({ msg_id, skipped: "already handled" }); continue; } // same email twice
    if (status === "unverified" || status === "already_paid") { out.push({ msg_id, status }); continue; }
    const src = source === "venmo" ? "Venmo" : source === "zelle" ? "Zelle" : "Cash App", no = order?.order_number || number;
    const p = status === "matched" ? { title: `✓ ${src} ${money(amount)} · ${short(payer)} · ${no}`, body: `Matches the order total. Tap to check it and mark it paid.` }
      : status === "amount_mismatch" ? { title: `⚠ ${src} ${money(amount)} · ${short(payer)} · ${no}`, body: `Order total is ${money(order!.total)} (${amount < Number(order!.total) ? `${money(Number(order!.total) - amount)} short` : `${money(amount - Number(order!.total))} over`}).` }
      : status === "guessed" ? { title: `${src} ${money(amount)} · ${short(payer)}`, body: `No order number in the note. Looks like ${order!.order_number} (same total). Tap to check.` }
      : { title: `${src} ${money(amount)} · ${short(payer)}`, body: number ? `Note says ${number}, but there's no open order with that number.` : "Couldn't match it to an open order. Check the note in Venmo." };
    out.push({ msg_id, status, sent: await ownerSend("payments_in", "payment_in", { ...p, url: order ? `owner.html#o=${order.id}&pay=1` : "owner.html", tag: order ? `order-${order.id}` : `pay-${msg_id}` }) });
  }
  return { handled: out.length, results: out };
}

async function paidNotice(u: Row, id: string) {
  const { data: o } = await admin.from("orders").select("*").eq("id", id).maybeSingle();
  if (!o || customerId(o) !== u.id) return json(404, { error: "Order not found." });
  if (lower(o.payment_status) === "paid") return json(200, { ok: true, already: "paid" });
  if (!(await once("paid_notice", id, u.id))) return json(200, { ok: true, already: "sent" });
  const sent = await ownerSend("payments", "paid_notice", { title: `${o.customer_name || "A customer"} says they paid · ${money(o.total)}`, body: `${o.order_number || "Order"} via ${o.payment_method || "payment"}. Check it, then mark it paid in Admin.`, url: `owner.html#o=${id}`, tag: `order-${id}` });
  return json(200, { ok: true, sent });
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const pub = await vapid();
    if (req.method === "GET") return json(200, { publicKey: pub });
    const body = await req.json().catch(() => ({}));
    const payKey = req.headers.get("x-pay-key");
    if (payKey) { if (payKey !== (await secret("pay_key"))) return json(401, { error: "bad key" }); return json(200, await payments(body.payments)); }
    const hook = req.headers.get("x-hook-key");
    if (hook) {
      if (hook !== (await secret("hook_key"))) return json(401, { error: "bad hook key" });
      if (body.event === "new_order") return json(200, await newOrder(String(body.order_id)));
      if (body.event === "status") return json(200, await status(String(body.order_id)));
      if (body.event === "owner_event") return json(200, await ownerEvent(String(body.kind || ""), String(body.ref || "")));
      if (body.event === "release") return json(200, await releaseEvent(String(body.ref || "")));
      if (body.event === "ticket") return json(200, await ticketEvent(String(body.kind || "new"), String(body.ref || "")));
      if (body.event === "reminders") return json(200, { reminders: await reminders(), low_stock: await lowStock().catch((e: any) => ({ error: e?.message })) });
      return json(400, { error: "unknown event" });
    }
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: ud } = await admin.auth.getUser(token);
    const u = ud?.user; if (!u) return json(401, { error: "Sign in again to turn on alerts." });
    if (body.subscribe?.endpoint) {
      const role = body.role === "owner" ? "owner" : "customer";
      if (role === "owner" && !(await isAdmin(u))) return json(403, { error: "Owner alerts are for store staff." });
      const k = body.subscribe.keys || {};
      const { error } = await admin.from("pst_push_subscriptions").upsert({ user_id: u.id, role, endpoint: body.subscribe.endpoint, p256dh: k.p256dh, auth: k.auth, ua: String(body.ua || "").slice(0, 200), fail_count: 0 }, { onConflict: "endpoint,role" });
      if (error) return json(500, { error: error.message });
      const { data: subs } = await admin.from("pst_push_subscriptions").select("*").eq("endpoint", body.subscribe.endpoint).eq("role", role);
      await send(subs || [], { title: role === "owner" ? "New-order alerts are on" : "Order alerts are on", body: role === "owner" ? "You'll get a ping for every new order." : "We'll ping you when your order moves.", url: role === "owner" ? "owner.html" : "account.html#alerts" });
      return json(200, { ok: true });
    }
    if (body.paid_notice) return await paidNotice(u, String(body.paid_notice));
    if (body.unsubscribe) { await admin.from("pst_push_subscriptions").delete().eq("endpoint", String(body.unsubscribe)).eq("user_id", u.id); return json(200, { ok: true }); }
    if (body.test) {
      const role = body.role === "owner" && (await isAdmin(u)) ? "owner" : "customer";
      const p = { title: "Test alert", body: "Alerts are working. You'll see them here and on this device.", url: role === "owner" ? "owner.html" : "account.html#alerts", tag: "test" };
      await inbox(role, role === "owner" ? null : u.id, "test", p);
      const { data: subs } = await admin.from("pst_push_subscriptions").select("*").eq("user_id", u.id).eq("role", role);
      return json(200, { sent: await send(subs || [], p), devices: (subs || []).length });
    }
    return json(400, { error: "nothing to do" });
  } catch (e: any) {
    console.error(e); return json(500, { error: e?.message || "error" });
  }
});
