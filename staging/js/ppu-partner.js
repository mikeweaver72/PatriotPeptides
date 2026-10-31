/* Patriot Peptides USA · Partner portal (vendor.html) v1, Oct 31 2026.
   Only approved partners see anything here. Pricing comes from the server under row-level security
   (a partner can read only their own tier's sheet), and orders are priced again on the server. */
(() => {
  const P = window.PST, $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)], esc = P.esc, money = P.money;
  const BAGKEY = "ppu_partner_bag_v1", WEST = ["WA", "OR", "CA", "NV", "ID", "MT", "WY", "UT", "CO", "AZ", "NM", "AK", "HI"];
  let me = null, user = null, profile = null, sheet = [], bag = {}, q = "", methods = [], pay = "", notes = "", busy = false;
  const el = () => $("[data-portal]");
  const loadBag = () => { try { const b = JSON.parse(localStorage.getItem(BAGKEY) || "{}"); return b && typeof b === "object" ? b : {}; } catch { return {}; } };
  const saveBag = () => { try { localStorage.setItem(BAGKEY, JSON.stringify(bag)); } catch {} };
  const lines = () => sheet.filter(x => bag[x.id] > 0).map(x => ({ x, n: bag[x.id] }));
  const state = () => P.stateCode(profile?.shipping_state || profile?.state || "");
  const shipFor = st => WEST.includes(st) ? 20 : 30;
  const totals = () => { const sub = lines().reduce((s, l) => s + Number(l.x.price) * l.n, 0), ship = lines().length ? shipFor(state()) : 0; return { sub: P.round(sub), ship, total: P.round(sub + ship), n: lines().reduce((s, l) => s + l.n, 0) }; };

  function msg(icon, title, body, actions = "") { el().innerHTML = `<div class="mgate">${P.icon(icon, 28)}<h2 class="serif">${title}</h2><p class="muted">${body}</p>${actions}</div>`; }

  async function boot() {
    user = await P.getUser().catch(() => null);
    if (!user) return msg("lock", "Partner sign in", "Approved Patriot Peptides USA partners sign in here with the email Jeff has on file. We'll email you a sign-in code.", `<a class="btn primary" href="login.html?redirect=vendor.html">Sign in</a>`);
    const r = await P.client().rpc("ppu_my_partner");
    me = r.data;
    if (r.error || !me) return msg("lock", "Partners only", `This area is for approved Patriot Peptides USA partners. You're signed in as <b>${esc(user.email || "")}</b>. If Jeff invited you with a different email, sign out and sign in with that one.`, `<a class="btn ghost" href="index.html">Go to the shop</a> <a class="btn ghost" href="contact.html">Contact us</a>`);
    if (me.status !== "active") return msg("lock", "Account paused", "Your partner account is paused right now. Reach out and we'll get it sorted.", `<a class="btn primary" href="contact.html">Contact us</a>`);
    document.title = `${me.tier_name} portal | Patriot Peptides USA`;
    if (!me.has_prices) return promoter();
    profile = await P.getProfile(user).catch(() => null);
    const [s, m] = await Promise.all([P.client().from("ppu_partner_prices").select("id,sku,name,amount,price,sort").order("sort").order("name"), P.paymentMethods().catch(() => [])]);
    if (s.error) return msg("lock", "Couldn't load your pricing", esc(s.error.message));
    sheet = s.data || []; methods = (m || []).filter(x => !P.isOtherPay?.(x.label));
    bag = loadBag(); Object.keys(bag).forEach(k => { if (!sheet.some(x => x.id === k) || !(bag[k] > 0)) delete bag[k]; }); saveBag();
    pay = pay || (methods.find(x => /venmo/i.test(x.id + x.label)) || methods[0] || {}).label || "";
    draw(); recent();
  }

  function promoter() {
    const code = me.discount_code || "";
    const share = `Save 10% at Patriot Peptides USA with my code ${code}: https://www.patriotpeptides-usa.com`;
    el().innerHTML = `<div class="phead"><span class="ptier t1">1</span><div><span class="kick">Tier 1 · ${esc(me.tier_name)}</span><h1 class="serif">Welcome${me.name ? `, ${esc(String(me.name).split(/\s+/)[0])}` : ""}</h1></div></div>
<div class="pcode"><small>Your code</small><b>${esc(code || "Coming soon")}</b><p class="muted small">Shoppers get 10% off when they use it. You earn the same 10% back as cash or product.</p>
${code ? `<div class="pinvb"><button class="btn primary" type="button" data-pshare>Share my code</button><button class="btn ghost" type="button" data-pcopy>Copy</button></div>` : ""}</div>
<p class="muted small">Questions about your earnings? <a href="contact.html">Contact us</a>.</p>`;
    el().onclick = async e => {
      if (e.target.closest("[data-pshare]")) { try { if (navigator.share) await navigator.share({ text: share }); else { await navigator.clipboard.writeText(share); P.toast("Copied. Paste it anywhere."); } } catch {} }
      if (e.target.closest("[data-pcopy]")) { try { await navigator.clipboard.writeText(code); P.toast("Code copied"); } catch {} }
    };
  }

  function rowHtml(x) {
    const n = bag[x.id] || 0;
    return `<div class="vrow${n ? " in" : ""}" data-vname="${esc(`${x.name} ${x.amount || ""} ${x.sku || ""}`.toLowerCase())}"><span class="vtx"><b>${esc(x.name)}</b><small>${esc(x.amount || "")}</small></span><b class="vpr">${money(x.price)}</b>
<div class="qty sm"><button type="button" data-vq="${esc(x.id)}" data-d="-1" aria-label="Fewer ${esc(x.name)} ${esc(x.amount || "")}"${n ? "" : " disabled"}>−</button><input type="number" min="0" max="9999" inputmode="numeric" value="${n || ""}" placeholder="0" data-vn="${esc(x.id)}" aria-label="${esc(x.name)} ${esc(x.amount || "")} quantity"><button type="button" data-vq="${esc(x.id)}" data-d="1" aria-label="More ${esc(x.name)} ${esc(x.amount || "")}">+</button></div></div>`;
  }
  function barHtml() { const t = totals(); return t.n ? `<div class="vbar"><span><b>${t.n} item${t.n === 1 ? "" : "s"}</b><small>${money(t.sub)} + ${money(t.ship)} shipping</small></span><button class="btn primary" type="button" data-vreview>Review order · ${money(t.total)}</button></div>` : ""; }
  function draw() {
    el().innerHTML = `<div class="phead"><span class="ptier t${me.tier}">${me.tier}</span><div><span class="kick">Tier ${me.tier} · ${esc(me.tier_name)}${me.company ? ` · ${esc(me.company)}` : ""}</span><h1 class="serif">Your price sheet</h1></div></div>
<p class="muted small">These prices are for your account only. Orders ship ${state() ? `to ${esc(state())} for ${money(shipFor(state()))}` : "at $20 to West Coast and Mountain states, $30 everywhere else"} and go out with the next twice-monthly block.</p>
<input class="psearch" type="search" data-vsearch placeholder="Search ${sheet.length} products" aria-label="Search your price sheet" value="${esc(q)}">
<div class="vlist" data-vlist>${sheet.map(rowHtml).join("") || `<p class="muted">Your price sheet is being set up. Check back soon.</p>`}</div>
<div data-vrecent></div><div data-vbar>${barHtml()}</div>`;
    filter();
  }
  function filter() { $$("[data-vname]").forEach(r => r.hidden = !!q && !r.dataset.vname.includes(q)); }
  function setN(id, n) {
    n = Math.max(0, Math.min(9999, Math.floor(Number(n) || 0))); if (n) bag[id] = n; else delete bag[id]; saveBag();
    const x = sheet.find(s => s.id === id), row = $(`[data-vn="${CSS.escape(id)}"]`)?.closest(".vrow");
    if (row && x) { const tmp = document.createElement("div"); tmp.innerHTML = rowHtml(x); const nr = tmp.firstElementChild; nr.hidden = row.hidden; row.replaceWith(nr); }
    $("[data-vbar]").innerHTML = barHtml();
  }

  function review() {
    const t = totals(), st = state(), addr = [profile?.shipping_address, [profile?.shipping_city, st, profile?.shipping_zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    const w = P.sheet(`<div class="vrev"><h2 class="serif">Review your order</h2>
<div class="vrl">${lines().map(l => `<div class="r"><span>${esc(l.x.name)} ${esc(l.x.amount || "")} <small class="muted">× ${l.n}</small></span><b>${money(Number(l.x.price) * l.n)}</b></div>`).join("")}</div>
<div class="sum"><div class="r"><span>Subtotal</span><b>${money(t.sub)}</b></div><div class="r"><span>Shipping${st ? ` (${st})` : ""}</span><b>${money(t.ship)}</b></div><div class="r tot"><span>Total</span><b>${money(t.total)}</b></div></div>
<p class="addr small">${addr ? `Ships to: ${esc(addr)} · <a href="account.html#profile">Change</a>` : `<span style="color:var(--bad)">Add your shipping address first.</span> <a href="account.html#profile">Add it</a>`}</p>
<h3 class="kick" style="margin:14px 0 6px">Pay with</h3><div class="pm">${methods.map(m => `<label><input type="radio" name="vpm" value="${esc(m.label)}"${m.label === pay ? " checked" : ""}><span>${esc(P.payLabel ? P.payLabel(m) : m.label)}</span></label>`).join("") || `<p class="muted small">Payment options are loading. Close and try again.</p>`}</div>
<label class="form" style="display:block;margin-top:10px"><span class="sr">Order notes</span><textarea data-vnotes placeholder="Notes for Jeff (optional)" style="width:100%;min-height:56px">${esc(notes)}</textarea></label>
<button class="btn primary wide" type="button" data-vplace${addr && pay ? "" : " disabled"} style="margin-top:12px">Place order · ${money(t.total)}</button><p class="status" data-vst role="status"></p>
<p class="muted small" style="text-align:center">Nothing ships until payment is confirmed. Final pricing is checked on our end.</p></div>`, { label: "Review order" });
    w.addEventListener("change", e => { if (e.target.name === "vpm") { pay = e.target.value; $("[data-vplace]", w).disabled = !(addr && pay); } });
    w.addEventListener("input", e => { if (e.target.matches("[data-vnotes]")) notes = e.target.value; });
    w.addEventListener("click", async e => { if (!e.target.closest("[data-vplace]") || busy) return; place(w); });
  }

  async function place(w) {
    const st = $("[data-vst]", w), btn = $("[data-vplace]", w); busy = true; btn.disabled = true; st.textContent = "Placing your order…"; st.className = "status";
    try {
      const ls = lines(), { data, error } = await P.client().rpc("ppu_partner_place_order", { p_lines: ls.map(l => ({ id: l.x.id, qty: l.n })), p_payment: pay, p_notes: notes.trim() });
      if (error) throw error;
      const orderNo = data.order_number || data.id;
      // order email (same branded email as the shop; never blocks the order)
      try { await P.postEmail(P.emailPayload({ id: data.id, order_number: data.order_number, created_at: data.created_at }, { customerName: data.name || me.name || "", customerEmail: data.email, items: ls.map(l => ({ product_key: null, product_name: l.x.name, product_strength: l.x.amount || "", quantity: l.n, unit_price: Number(l.x.price), line_total: P.round(Number(l.x.price) * l.n) })), subtotal: data.subtotal, discount: 0, shipping: data.shipping, total: data.total, paymentMethod: pay, deliveryMethod: "Shipping" })); } catch {}
      bag = {}; saveBag(); notes = ""; P.closeSheet();
      const card = await P.payCard(pay, data.total, orderNo, data.id).catch(() => "");
      el().innerHTML = `<div class="vdone"><span class="kick">Order placed</span><h1 class="serif">Thanks${me.name ? `, ${esc(String(me.name).split(/\s+/)[0])}` : ""}</h1><p class="muted">Order <b>${esc(orderNo)}</b> · ${money(data.total)}. We emailed you a copy. Send payment below and we'll add it to the next block.</p>${card}
<div class="pinvb" style="margin-top:14px"><button class="btn ghost" type="button" data-vagain>Back to my price sheet</button><a class="btn ghost" href="account.html#orders">My orders</a></div></div>`;
      el().onclick = e => { if (e.target.closest("[data-vagain]")) { draw(); recent(); bindList(); } };
    } catch (err) { st.textContent = err.message || "Couldn't place the order. Try again."; st.className = "status bad"; btn.disabled = false; }
    busy = false;
  }

  async function recent() {
    const box = $("[data-vrecent]"); if (!box) return;
    const { data } = await P.client().from("orders").select("id,order_number,total,payment_status,order_status,status,created_at").eq("customer_id", user.id).eq("storefront", "partner_portal").order("created_at", { ascending: false }).limit(5);
    if (!data?.length) return;
    const s = o => { const os = String(o.order_status || o.status || "").toLowerCase(), ps = String(o.payment_status || "").toLowerCase(); return ["cancelled", "canceled", "rejected"].includes(os) ? "Cancelled" : ["shipped", "delivered", "complete", "completed"].includes(os) ? "Shipped" : ps === "paid" ? "Paid · in the next block" : "Waiting on payment"; };
    box.innerHTML = `<h2 class="serif osec" style="margin-top:24px">Recent partner orders</h2><div class="vord">${data.map(o => `<a href="account.html#orders" class="r"><span><b>${esc(o.order_number || "Order")}</b><small>${P.fmtDate(o.created_at)} · ${s(o)}</small></span><b>${money(o.total)}</b></a>`).join("")}</div>`;
  }

  function bindList() {
    el().onclick = e => { const b = e.target.closest("[data-vq]"); if (b) return setN(b.dataset.vq, (bag[b.dataset.vq] || 0) + Number(b.dataset.d)); if (e.target.closest("[data-vreview]")) review(); };
    el().oninput = e => { if (e.target.matches("[data-vsearch]")) { q = e.target.value.trim().toLowerCase(); filter(); } };
    el().onchange = e => { if (e.target.matches("[data-vn]")) setN(e.target.dataset.vn, e.target.value); };
  }

  document.addEventListener("DOMContentLoaded", async () => { if (!el()) return; try { await boot(); if (me?.has_prices && me.status === "active") bindList(); } catch (err) { msg("lock", "Something went wrong", esc(err.message || "Please refresh.")); } });
})();
