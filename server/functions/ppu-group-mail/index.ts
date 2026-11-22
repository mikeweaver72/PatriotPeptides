// ppu-group-mail (Nov 19 2026; v3 same day: items sold each (pack = 1) read "2 × $14.00 each"): emails for partner group orders (server/sql/99i_group_orders.sql).
//   announce {group_id}  owner signed in    -> every active Runner + Vendor: "Group order <date>: add your kits by <cutoff>" (no prices)
//   confirm  {group_id}  partner signed in  -> that partner: what they added, priced from their own tier only
//   remind   {}          x-hook-key (cron) or owner -> once per group, about a day before the cutoff, to every Runner + Vendor
//   placed   {group_id}  owner signed in    -> each member: "Your group order is placed" with their order #, total and how to pay (+ their linked orders)
//   linked   {group_id}  owner signed in    -> partners with linked orders: "Your order is in the group order" (no payment ask)
// Each partner gets their own email (never a shared To/CC), so nobody sees another partner. Deploy with verify_jwt off.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const SB = Deno.env.get("SUPABASE_URL") || "", SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const RESEND = Deno.env.get("RESEND_API_KEY") || "", FROM = Deno.env.get("FROM_EMAIL") || "Patriot Peptides USA <onboarding@resend.dev>";
const REPLY = Deno.env.get("REPLY_TO_EMAIL") || "info@patriotpeptides-usa.com", SITE = Deno.env.get("SITE_URL") || "https://www.patriotpeptides-usa.com";
const ASSET = (Deno.env.get("ASSET_URL") || "https://mikeweaver72.github.io/PatriotPeptides").replace(/\/$/, "");
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hook-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
type Rec = Record<string, any>;
const json = (b: Rec, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const H = { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" };
async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const d = await r.json().catch(() => null); if (!r.ok) throw new Error(d?.message || `Database error (${r.status})`); return d;
}
const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n: unknown) => `$${Number(n || 0).toFixed(2)}`;
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const when = (t: string) => new Date(t).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles", timeZoneName: "short" });
const first = (n: unknown) => String(n || "").trim().split(/\s+/)[0] || "there";
const isUuid = (s: unknown) => /^[0-9a-f-]{36}$/i.test(String(s || ""));

async function signedIn(req: Request) {
  const a = req.headers.get("Authorization") || ""; if (!a.startsWith("Bearer ")) return null;
  const r = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: ANON || SR, Authorization: a } }); const u = await r.json().catch(() => null);
  return r.ok && isUuid(u?.id) ? u : null;
}
const isOwner = async (uid: string) => (await rest(`admin_users?select=user_id&is_active=eq.true&user_id=eq.${uid}&limit=1`)).length > 0;
const hookOk = async (req: Request) => { const k = req.headers.get("x-hook-key") || ""; if (!k) return false; const r = await rest("pst_app_secrets?select=value&key=eq.hook_key"); return !!r?.[0]?.value && r[0].value === k; };

function shell(inner: string, pre: string) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"></head><body style="margin:0;padding:0;background:#eef1f5">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(pre)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef1f5"><tr><td align="center" style="padding:18px 10px 28px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#fff;border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#24303b">
<tr><td bgcolor="#0A1020" style="background:#0A1020;padding:18px 20px" align="center"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding-right:10px"><img src="${ASSET}/img/email/emblem-96.png" alt="" width="40" height="40" style="display:block;border:0"></td><td style="font-size:19px;font-weight:800;letter-spacing:.08em;color:#fff;white-space:nowrap">PATRIOT PEPTIDES</td></tr></table></td></tr>
<tr><td style="padding:0;font-size:0;line-height:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="33%" height="4" bgcolor="#C8102E"></td><td width="34%" height="4" bgcolor="#ffffff"></td><td width="33%" height="4" bgcolor="#12266E"></td></tr></table></td></tr>
<tr><td style="padding:26px 22px 12px">${inner}</td></tr>
<tr><td bgcolor="#0A1020" style="background:#0A1020;padding:18px;text-align:center"><p style="margin:0;font-size:12px;line-height:1.55;color:#a9b3c7">Partner email from Patriot Peptides USA. Questions? Just reply.<br>For research use only. Not for human consumption.</p></td></tr>
</table></td></tr></table></body></html>`;
}
const pill = (t: string, c = "#12266E") => `<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${c}1a;color:${c};font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase">${esc(t)}</span>`;
const h1 = (t: string) => `<h1 style="margin:12px 0 0;font-size:25px;line-height:1.2;font-weight:800;color:#0A1020">${esc(t)}</h1>`;
const p = (t: string) => `<p style="margin:10px 0 0;font-size:16px;line-height:1.55;color:#3a4356">${t}</p>`;
const btn = (href: string, label: string, bg = "#C8102E") => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:20px auto 6px"><tr><td style="border-radius:10px;background:${bg}" bgcolor="${bg}"><a href="${esc(href)}" style="display:inline-block;padding:14px 30px;color:#fff;font-weight:700;font-size:15px;text-decoration:none;border-radius:10px">${esc(label)}</a></td></tr></table>`;
const box = (inner: string) => `<div style="margin:18px 0 0;padding:16px;border-radius:12px;background:#f6f8fb;border:1px solid #e3e8ef">${inner}</div>`;
const dates = (g: Rec) => box(`<p style="margin:0;font-size:14px;line-height:1.7;color:#24303b"><b>Order date:</b> ${esc(day(g.order_date))}<br><b>Add or change kits until:</b> ${esc(when(g.cutoff_at))}</p>${g.note ? `<p style="margin:8px 0 0;font-size:14px;color:#4a5563;white-space:pre-line">${esc(g.note)}</p>` : ""}`);
const link = (g: Rec) => `${SITE}/vendor.html?group=${g.id}`;
const name = (g: Rec) => g.title ? `${g.title} (${day(g.order_date)})` : `the ${day(g.order_date)} group order`;

async function send(to: string, subject: string, html: string, text: string) {
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY, subject, html, text }) });
  const d = await r.json().catch(() => ({})); return { ok: r.ok, id: d?.id || null, error: r.ok ? null : (d?.message || r.status) };
}
const partners = async () => (await rest("ppu_partners?select=id,name,email,tier,user_id&status=eq.active&tier=in.(2,3)&email=not.is.null")) as Rec[];
const group = async (id: string) => { if (!isUuid(id)) throw new Error("Unknown group order."); const g = (await rest(`ppu_group_orders?id=eq.${id}&select=*`))?.[0]; if (!g) throw new Error("Group order not found."); return g; };
// one partner's own lines, priced from their own tier (never another tier's sheet)
async function linesFor(g: Rec, pt: Rec) {
  const ls = await rest(`ppu_group_lines?group_id=eq.${g.id}&partner_id=eq.${pt.id}&select=qty,price_id`) as Rec[];
  if (!ls.length) return [];
  const pr = await rest(`ppu_partner_prices?tier=eq.${pt.tier}&id=in.(${ls.map(l => l.price_id).join(",")})&select=id,name,amount,price,sort,pack`) as Rec[];
  return ls.map(l => ({ ...l, x: pr.find(p => p.id === l.price_id) })).filter(l => l.x).sort((a, b) => (a.x.sort ?? 0) - (b.x.sort ?? 0) || String(a.x.name).localeCompare(b.x.name));
}
const linesHtml = (ls: Rec[]) => { const sub = ls.reduce((s, l) => s + Number(l.x.price) * l.qty, 0), kits = ls.reduce((s, l) => s + l.qty, 0);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 0;border-top:1px solid #e8e3da">${ls.map(l => `<tr><td style="padding:9px 0;border-bottom:1px solid #e8e3da;font-size:15px"><b>${esc(l.x.name)}</b> ${esc(l.x.amount || "")}<br><span style="font-size:13px;color:#6b7385">${Number(l.x.pack ?? 10) <= 1 ? `${l.qty} × ${money(l.x.price)} each` : `${l.qty} kit${l.qty === 1 ? "" : "s"} × ${money(l.x.price)}`}</span></td><td align="right" style="padding:9px 0;border-bottom:1px solid #e8e3da;font-size:15px;font-weight:600">${money(Number(l.x.price) * l.qty)}</td></tr>`).join("")}
<tr><td style="padding:10px 0 0;font-size:17px;font-weight:800;color:#0A1020">${ls.every(l => Number(l.x.pack ?? 10) > 1) ? `${kits} kit${kits === 1 ? "" : "s"}` : `${kits} item${kits === 1 ? "" : "s"}`}</td><td align="right" style="padding:10px 0 0;font-size:17px;font-weight:800;color:#0A1020">${money(sub)}</td></tr></table>`; };
const linesText = (ls: Rec[]) => ls.map(l => `${l.qty} × ${l.x.name} ${l.x.amount || ""} · ${money(Number(l.x.price) * l.qty)}`).join("\n") + `\nTotal: ${money(ls.reduce((s, l) => s + Number(l.x.price) * l.qty, 0))}`;

async function announce(g: Rec) {
  if (g.status !== "open") throw new Error("This group order isn't open.");
  const out = [];
  for (const pt of await partners()) {
    const html = shell(`${pill("Group order")}${h1(`Group order: ${day(g.order_date)}`)}${p(`Hi ${esc(first(pt.name))}, Jeff is placing a group order on <b>${esc(day(g.order_date))}</b>. Add the kits you want from your price sheet. Nothing is charged now: you'll get a payment email once the order is placed.`)}${dates(g)}${btn(link(g), "Add to this order")}<p style="margin:4px 0 0;font-size:13px;color:#6b7385;text-align:center">Sign in with this email address. You can change your kits until the cutoff.</p>`, `Add your kits by ${when(g.cutoff_at)}.`);
    const text = `Hi ${first(pt.name)}, Jeff is placing a group order on ${day(g.order_date)}. Add your kits by ${when(g.cutoff_at)}. Nothing is charged now.\n${g.note ? g.note + "\n" : ""}\nAdd to this order: ${link(g)}`;
    out.push({ partner: pt.id, ...(await send(pt.email, `Group order ${day(g.order_date)}: add your kits by ${when(g.cutoff_at)}`, html, text)) });
  }
  await rest(`ppu_group_orders?id=eq.${g.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ announced_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
  return out;
}
async function confirm(g: Rec, pt: Rec) {
  const ls = await linesFor(g, pt);
  if (!ls.length) return send(pt.email, `You're out of ${name(g)}`, shell(`${pill("Group order")}${h1("You're not on this one")}${p(`Hi ${esc(first(pt.name))}, you removed all your kits from ${esc(name(g))}. You can still add some until ${esc(when(g.cutoff_at))}.`)}${btn(link(g), "Add kits")}`, "No kits on this group order."), `You removed all your kits from ${name(g)}. Add some until ${when(g.cutoff_at)}: ${link(g)}`);
  const html = shell(`${pill("Added to the group order", "#0f8a3b")}${h1("You're in")}${p(`Hi ${esc(first(pt.name))}, here's what you added to ${esc(name(g))}. <b>Nothing is charged now.</b> Once Jeff places the order, you'll get an email with your total and how to pay.`)}${linesHtml(ls)}<p style="margin:8px 0 0;font-size:13px;color:#6b7385">Supplier shipping is split across the group and billed after the block ships.</p>${dates(g)}${btn(link(g), "Change my kits", "#0A1020")}`, `${ls.reduce((s, l) => s + l.qty, 0)} items on the ${day(g.order_date)} group order. Nothing charged yet.`);
  return send(pt.email, `Your kits for ${name(g)}`, html, `Here's what you added to ${name(g)}. Nothing is charged now.\n\n${linesText(ls)}\n\nChange until ${when(g.cutoff_at)}: ${link(g)}`);
}
async function remind(only = "") { // only = a group id Jeff chose to remind now (skips the "about a day before" timing)
  const now = Date.now(), gs = (await rest(only ? `ppu_group_orders?id=eq.${only}&status=eq.open&select=*` : "ppu_group_orders?status=eq.open&reminded_at=is.null&select=*")) as Rec[], out = [];
  for (const g of gs) {
    const left = new Date(g.cutoff_at).getTime() - now; if (left <= 0 || (!only && left > 26 * 36e5)) continue; // automatic: about a day before the cutoff
    for (const pt of await partners()) {
      const ls = await linesFor(g, pt);
      const html = ls.length
        ? shell(`${pill("Reminder")}${h1("Changes close soon")}${p(`Hi ${esc(first(pt.name))}, you're in on ${esc(name(g))}. Kits can be changed until <b>${esc(when(g.cutoff_at))}</b>.`)}${linesHtml(ls)}${btn(link(g), "Review my kits", "#0A1020")}`, `Changes close ${when(g.cutoff_at)}.`)
        : shell(`${pill("Reminder")}${h1("Last call for the group order")}${p(`Hi ${esc(first(pt.name))}, Jeff places ${esc(name(g))} soon. Add your kits by <b>${esc(when(g.cutoff_at))}</b>. Nothing is charged until the order is placed.`)}${dates(g)}${btn(link(g), "Add to this order")}`, `Add your kits by ${when(g.cutoff_at)}.`);
      out.push({ group: g.id, partner: pt.id, ...(await send(pt.email, ls.length ? `Changes close ${when(g.cutoff_at)}` : `Last call: group order ${day(g.order_date)}`, html, `${ls.length ? "Your kits:\n" + linesText(ls) : "Add your kits"} by ${when(g.cutoff_at)}: ${link(g)}`)) });
    }
    await rest(`ppu_group_orders?id=eq.${g.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ reminded_at: new Date().toISOString() }) });
  }
  return out;
}

// placed: after Jeff submits, each member's order gets "Your group order is placed" with their total and how to pay (their chosen method).
async function payMethods() { const r = await rest("site_payment_options?select=payment_methods&id=eq.1&limit=1"); let v = r?.[0]?.payment_methods; if (typeof v === "string") v = JSON.parse(v); return (Array.isArray(v) ? v : []).filter((m: Rec) => m.enabled === true || String(m.enabled).toLowerCase() === "true"); }
// v4 (Nov 21 2026): orders a partner placed on their own and Jeff linked to the group (ppu_group_linked) are named in the
// "placed" email ("Also riding with this group order"), and partners who only have linked orders get a short note of their own.
async function linkedByPartner(g: Rec) {
  const ln = await rest(`ppu_group_linked?group_id=eq.${g.id}&select=order_id`) as Rec[]; if (!ln.length) return new Map<string, Rec[]>();
  const ids = ln.map(x => x.order_id).join(",");
  const os = await rest(`orders?id=in.(${ids})&select=id,order_number,total,payment_status,customer_id`) as Rec[];
  const its = await rest(`order_items?order_id=in.(${ids})&select=order_id,product_name,product_strength,quantity`) as Rec[];
  const pts = await rest(`ppu_partners?status=eq.active&user_id=in.(${[...new Set(os.map(o => o.customer_id).filter(Boolean))].join(",") || "00000000-0000-0000-0000-000000000000"})&select=id,name,email,user_id`) as Rec[];
  const out = new Map<string, Rec[]>();
  for (const o of os) { const pt = pts.find(x => x.user_id === o.customer_id); if (!pt) continue;
    const l = out.get(pt.id) || []; l.push({ ...o, pt, items: its.filter(i => i.order_id === o.id) }); out.set(pt.id, l); }
  return out;
}
const isPaid = (o: Rec) => String(o.payment_status || "").toLowerCase() === "paid";
const linkedHtml = (list: Rec[], title = "Also riding with this group order") => box(`<p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#0f8a3b">${esc(title)}</p>${list.map(o => `<p style="margin:6px 0 0;font-size:14px;line-height:1.5;color:#24303b"><b>${esc(o.order_number)}</b> · ${money(o.total)} · ${isPaid(o) ? "<span style=\"color:#0f8a3b;font-weight:700\">already paid</span>" : "awaiting payment"}<br><span style="color:#6b7385">${o.items.map((i: Rec) => `${i.quantity} × ${esc(i.product_name)}${i.product_strength ? ` (${esc(String(i.product_strength).split(" · ")[0])})` : ""}`).join(", ")}</span></p>`).join("")}<p style="margin:8px 0 0;font-size:13px;color:#6b7385">${list.every(isPaid) ? "Nothing more to pay on these." : "Pay any order marked awaiting payment the same way as before."} They ship with the group.</p>`);
const linkedText = (list: Rec[]) => list.map(o => `${o.order_number} · ${money(o.total)} · ${isPaid(o) ? "already paid" : "awaiting payment"} · ${o.items.map((i: Rec) => `${i.quantity} x ${i.product_name}`).join(", ")}`).join("\n");
async function linkedOnly(g: Rec, byP: Map<string, Rec[]>, skip: Set<string>) {
  const out = [];
  for (const [pid, list] of byP) {
    if (skip.has(pid)) continue; const pt = list[0].pt; if (!pt?.email) continue;
    const html = shell(`${pill("Group order placed", "#0f8a3b")}${h1("Your order is in the group order")}${p(`Hi ${esc(first(pt.name))}, Jeff placed ${esc(name(g))}. ${list.length === 1 ? "Your order below is" : "Your orders below are"} part of it.`)}${linkedHtml(list, list.length === 1 ? "Your order" : "Your orders")}${btn(`${SITE}/account.html#orders`, "View my orders", "#0A1020")}`, `${list.map(o => o.order_number).join(", ")} ships with the group.`);
    out.push({ partner: pid, linked: list.map(o => o.order_number), ...(await send(pt.email, `Group order placed · ${list.map(o => o.order_number).join(", ")} is included`, html, `Jeff placed ${name(g)}. Included:\n${linkedText(list)}\n\n${SITE}/account.html#orders`)) });
  }
  return out;
}
async function placed(g: Rec) {
  if (g.status !== "submitted") throw new Error("Submit the group order first.");
  const ms = await rest(`ppu_group_members?group_id=eq.${g.id}&order_id=not.is.null&select=partner_id,order_id,payment_method`) as Rec[];
  const methods = await payMethods(), out = [], byP = await linkedByPartner(g).catch(() => new Map<string, Rec[]>());
  for (const m of ms) {
    const pt = (await rest(`ppu_partners?id=eq.${m.partner_id}&select=id,name,email,tier`))?.[0]; if (!pt?.email) continue;
    const o = (await rest(`orders?id=eq.${m.order_id}&select=order_number,total`))?.[0]; if (!o) continue;
    const its = await rest(`order_items?order_id=eq.${m.order_id}&select=product_name,product_strength,quantity,unit_price,line_total`) as Rec[];
    const pm = methods.find((x: Rec) => [String(x.label).toLowerCase(), String(x.id).toLowerCase()].includes(String(m.payment_method || "").toLowerCase())) || {};
    const acct = pm.account || pm.handle || pm.wallet || "", qr = pm.qrUrl || pm.qr_url || "", label = pm.label || m.payment_method || "your payment app";
    const rows = its.map(i => `<tr><td style="padding:8px 0;border-bottom:1px solid #e8e3da;font-size:15px"><b>${esc(i.product_name)}</b><br><span style="font-size:13px;color:#6b7385">${esc(i.product_strength || "")}${i.product_strength ? " · " : ""}Qty ${i.quantity}</span></td><td align="right" style="padding:8px 0;border-bottom:1px solid #e8e3da;font-size:15px;font-weight:600">${money(i.line_total ?? Number(i.unit_price) * i.quantity)}</td></tr>`).join("");
    const pay = `<div style="margin:18px 0 0;padding:18px;border-radius:12px;background:#fff7f8;border:1px solid #f6d3d9"><p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#C8102E">How to pay</p><p style="margin:0 0 4px;font-size:15px">Send <b>${money(o.total)}</b> by <b>${esc(label)}</b>${acct ? " to" : "."}</p>${acct ? `<p style="margin:0 0 12px;font-size:22px;font-weight:800;color:#0A1020;word-break:break-all">${esc(acct)}</p>` : ""}<p style="margin:0;font-size:14px;line-height:1.5;color:#4a5563">In the payment note, put only <b>${esc(o.order_number)}</b>. Please don't list any product names.</p>${pm.instructions ? `<p style="margin:8px 0 0;font-size:13px;color:#6b7385;white-space:pre-line">${esc(pm.instructions)}</p>` : ""}${/^https:/.test(qr) ? `<p style="margin:14px 0 0;text-align:center"><img src="${esc(qr)}" alt="Scan to pay" width="160" style="width:160px;max-width:60%;border-radius:8px;border:1px solid #e8e3da;background:#fff;padding:6px"></p>` : ""}</div>`;
    const html = shell(`${pill("Order placed", "#0f8a3b")}${h1("Your group order is placed")}${p(`Hi ${esc(first(pt.name))}, Jeff placed ${esc(name(g))}. Your part is order <b>${esc(o.order_number)}</b>. Please send payment now so it can ship with the group.`)}${pay}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 0;border-top:1px solid #e8e3da">${rows}<tr><td style="padding:10px 0 0;font-size:17px;font-weight:800;color:#0A1020">Total</td><td align="right" style="padding:10px 0 0;font-size:17px;font-weight:800;color:#0A1020">${money(o.total)}</td></tr></table><p style="margin:8px 0 0;font-size:13px;color:#6b7385">Supplier shipping is split across the group and billed after the block ships.</p>${byP.get(pt.id)?.length ? linkedHtml(byP.get(pt.id)!) : ""}${btn(`${SITE}/account.html#orders`, "View my order", "#0A1020")}`, `Send ${money(o.total)} by ${label} for ${o.order_number}.`);
    const text = `Your group order is placed. Order ${o.order_number}, total ${money(o.total)}.\nSend ${money(o.total)} by ${label}${acct ? " to " + acct : ""}. In the payment note put only ${o.order_number}.\n\n${its.map(i => `${i.quantity} x ${i.product_name}`).join("\n")}${byP.get(pt.id)?.length ? `\n\nAlso riding with this group order:\n${linkedText(byP.get(pt.id)!)}` : ""}\n\nView: ${SITE}/account.html#orders`;
    out.push({ partner: pt.id, order: o.order_number, ...(await send(pt.email, `Group order placed · ${o.order_number} · please pay ${money(o.total)}`, html, text)) });
  }
  return out.concat(await linkedOnly(g, byP, new Set(ms.map(m => m.partner_id))));
}

serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json().catch(() => ({})), u = await signedIn(req);
    if (b.action === "remind") {
      const owner = !!(u && await isOwner(u.id));
      if (!(await hookOk(req)) && !owner) return json({ ok: false, error: "forbidden" }, 403);
      return json({ ok: true, sent: await remind(owner && isUuid(b.group_id) ? b.group_id : "") });
    }
    if (!u) return json({ ok: false, error: "Sign in first." }, 401);
    if (b.action === "announce") { if (!(await isOwner(u.id))) return json({ ok: false, error: "Owners only." }, 403); return json({ ok: true, sent: await announce(await group(b.group_id)) }); }
    if (b.action === "linked") { if (!(await isOwner(u.id))) return json({ ok: false, error: "Owners only." }, 403); const g = await group(b.group_id); return json({ ok: true, sent: await linkedOnly(g, await linkedByPartner(g), new Set()) }); }
    if (b.action === "placed") { if (!(await isOwner(u.id))) return json({ ok: false, error: "Owners only." }, 403); return json({ ok: true, sent: await placed(await group(b.group_id)) }); }
    if (b.action === "confirm") {
      const pt = (await rest(`ppu_partners?select=id,name,email,tier&user_id=eq.${u.id}&status=eq.active&limit=1`))?.[0];
      if (!pt) return json({ ok: false, error: "Partners only." }, 403);
      return json({ ok: true, sent: await confirm(await group(b.group_id), pt) });
    }
    return json({ ok: false, error: "Unknown action." }, 400);
  } catch (e) { return json({ ok: false, error: (e as Error).message }, 400); }
});
