// ppu-review-ask (Nov 17 2026): one-time "How did we do?" email asking past customers to rate a delivered order (rate.html).
// POST {key, orders:["PP-O…"], dry?:true}. key must match pst_app_secrets.review_ask_key. Only delivered orders are emailed.
const SB = Deno.env.get("SUPABASE_URL")!, SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND = Deno.env.get("RESEND_API_KEY") || "", FROM = Deno.env.get("FROM_EMAIL") || "Patriot Peptides USA <onboarding@resend.dev>", REPLY = Deno.env.get("REPLY_TO_EMAIL") || "info@patriotpeptides-usa.com";
const H = { apikey: SR, Authorization: `Bearer ${SR}` };
const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const mask = (e: string) => e.replace(/^(.).*(@.*)$/, "$1***$2");
function html(first: string, on: string) {
  const link = `https://www.patriotpeptides-usa.com/rate.html?order=${encodeURIComponent(on)}`;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"></head><body style="margin:0;padding:0;background:#eef1f5;-webkit-text-size-adjust:100%"><div style="display:none;max-height:0;overflow:hidden;opacity:0">4 quick star ratings, about 20 seconds.</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef1f5"><tr><td align="center" style="padding:12px 10px 28px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#24303b;box-shadow:0 1px 3px rgba(10,16,32,.08)">
<tr><td bgcolor="#0A1020" style="background:#0A1020;padding:18px 20px" align="center"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding-right:10px;vertical-align:middle"><img src="https://mikeweaver72.github.io/PatriotPeptides/img/email/emblem-96.png" alt="" width="40" height="40" style="display:block;width:40px;height:40px;border:0"></td><td style="vertical-align:middle;font-size:19px;font-weight:800;letter-spacing:.08em;color:#ffffff;white-space:nowrap">PATRIOT PEPTIDES</td></tr></table></td></tr>
<tr><td style="padding:0;font-size:0;line-height:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="33%" height="4" bgcolor="#C8102E"></td><td width="34%" height="4" bgcolor="#ffffff"></td><td width="33%" height="4" bgcolor="#12266E"></td></tr></table></td></tr>
<tr><td style="padding:26px 22px 8px">
<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:#12266E1a;color:#12266E;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase">Quick favor</span>
<h1 style="margin:12px 0 0;font-size:25px;line-height:1.2;font-weight:800;color:#0A1020">How did we do?</h1>
<p style="margin:10px 0 0;font-size:16px;line-height:1.55;color:#3a4356">Hi ${esc(first)}, thanks for ordering from Patriot Peptides USA. We've just started posting order ratings on our site, and yours would really help.</p>
<div style="margin:20px 0 0;padding:18px;border-radius:12px;background:#fffaf0;border:1px solid #f1e2bd;text-align:center">
<p style="margin:0;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#6b7385">Order ${esc(on)}</p>
<p style="margin:8px 0 2px;font-size:30px;line-height:1;letter-spacing:4px"><a href="${link}" style="color:#E8B23A;text-decoration:none">&#9733;&#9733;&#9733;&#9733;</a></p>
<p style="margin:8px 0 0;font-size:14px;line-height:1.5;color:#3a4356">Four quick star ratings: <b>order accuracy</b>, <b>shipping speed</b>, <b>packaging</b> and <b>communication</b>. No writing, about 20 seconds.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:16px auto 4px"><tr><td style="border-radius:10px;background:#0A1020" bgcolor="#0A1020"><a href="${link}" style="display:inline-block;padding:14px 30px;color:#ffffff;font-weight:700;font-size:15px;text-decoration:none;border-radius:10px">Rate my order</a></td></tr></table>
<p style="margin:10px 0 0;font-size:12px;line-height:1.45;color:#6b7385">You'll sign in with the email you ordered with.</p></div>
<p style="margin:18px 0 0;font-size:14px;line-height:1.55;color:#4a5563">Only your first name and last initial are shown with your stars, and every rating is reviewed before it's posted. Anything we could do better? Just reply to this email.</p>
<p style="margin:16px 0 0;font-size:15px;line-height:1.5;color:#24303b">Thank you,<br><b>Jeff</b><br><span style="color:#6b7385">Patriot Peptides USA</span></p>
<div style="height:16px;line-height:16px">&nbsp;</div></td></tr>
<tr><td bgcolor="#0A1020" style="background:#0A1020;padding:20px;text-align:center"><p style="margin:0 0 10px;font-size:13px"><a href="https://www.patriotpeptides-usa.com/catalog.html" style="color:#ffffff;text-decoration:none;font-weight:600">Shop</a><span style="color:#55607a">&nbsp;&nbsp;·&nbsp;&nbsp;</span><a href="https://www.patriotpeptides-usa.com/account.html#orders" style="color:#ffffff;text-decoration:none;font-weight:600">My orders</a><span style="color:#55607a">&nbsp;&nbsp;·&nbsp;&nbsp;</span><a href="https://www.patriotpeptides-usa.com/contact.html" style="color:#ffffff;text-decoration:none;font-weight:600">Contact</a></p><p style="margin:0;font-size:12px;line-height:1.55;color:#a9b3c7">You're getting this one-time note because you ordered from us. Reply "stop" and we won't ask again.<br>For research use only. Not for human consumption.</p></td></tr>
</table></td></tr></table></body></html>`;
}
function text(first: string, on: string) {
  return [`Hi ${first}, thanks for ordering from Patriot Peptides USA. We've just started posting order ratings on our site, and yours would really help.`, "",
    `Rate order ${on} (4 quick star ratings: order accuracy, shipping speed, packaging and communication; about 20 seconds):`, `https://www.patriotpeptides-usa.com/rate.html?order=${encodeURIComponent(on)}`,
    "You'll sign in with the email you ordered with.", "", "Only your first name and last initial are shown with your stars, and every rating is reviewed before it's posted. Anything we could do better? Just reply to this email.", "",
    "Thank you,", "Jeff", "Patriot Peptides USA", "", `You're getting this one-time note because you ordered from us. Reply "stop" and we won't ask again.`, "For research use only. Not for human consumption."].join("\n");
}
Deno.serve(async req => {
  const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
  try {
    const p = await req.json().catch(() => ({}));
    const k = await fetch(`${SB}/rest/v1/pst_app_secrets?select=value&key=eq.review_ask_key`, { headers: H }).then(r => r.json());
    if (!p.key || !k?.[0]?.value || p.key !== k[0].value) return j({ ok: false, error: "forbidden" }, 403);
    const list = (Array.isArray(p.orders) ? p.orders : []).map(String).filter((x: string) => /^PP-O\d+$/.test(x));
    if (!list.length) return j({ ok: false, error: "no orders" }, 400);
    const rows = await fetch(`${SB}/rest/v1/orders?select=order_number,status,customer_email,shipping_name&order_number=in.(${list.join(",")})`, { headers: H }).then(r => r.json());
    const out = [];
    for (const o of rows) {
      const email = String(o.customer_email || "").trim(), first = String(o.shipping_name || "").trim().split(/\s+/)[0] || "there";
      if (String(o.status).toLowerCase() !== "delivered" || !email.includes("@")) { out.push({ order: o.order_number, skipped: o.status }); continue; }
      if (p.dry) { out.push({ order: o.order_number, to: mask(email), first, dry: true }); continue; }
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM, to: [email], reply_to: REPLY, subject: `${first}, how did we do on your order?`, html: html(first, o.order_number), text: text(first, o.order_number) }) });
      const d = await r.json().catch(() => ({}));
      out.push({ order: o.order_number, to: mask(email), ok: r.ok, id: d.id || null, error: r.ok ? null : (d.message || d.error || r.status) });
    }
    return j({ ok: true, from: FROM.replace(/<.*>/, "").trim(), results: out });
  } catch (e) { return j({ ok: false, error: String((e as Error)?.message || e) }, 500); }
});
