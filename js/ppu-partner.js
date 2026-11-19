/* Patriot Peptides USA · Partner portal (vendor.html) v1, Oct 31 2026.
   Only approved partners see anything here. Pricing comes from the server under row-level security
   (a partner can read only their own tier's sheet), and orders are priced again on the server.
   v5 (Nov 19 2026): group orders. Jeff opens a group order for a date; partners add kits from their own sheet until the cutoff
   (ppu_group_mine / ppu_group_save, which only ever return or accept this partner's own lines at their own tier's prices),
   get a confirmation email (ppu-group-mail confirm), and pay only once Jeff places it. vendor.html?group=ID opens one directly. */
(() => {
  const P = window.PST, $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)], esc = P.esc, money = P.money;
  const BAGKEY = "ppu_partner_bag_v1";
  let me = null, user = null, profile = null, sheet = [], bag = {}, q = "", methods = [], pay = "", notes = "", busy = false, stats = null;
  let groups = [], grp = null, nbag = {}, gpay = "", gnotes = ""; // group order mode: bag holds the group lines, nbag the normal bag
  const el = () => $("[data-portal]");
  const loadBag = () => { try { const b = JSON.parse(localStorage.getItem(BAGKEY) || "{}"); return b && typeof b === "object" ? b : {}; } catch { return {}; } };
  const saveBag = () => { if (grp) return; try { localStorage.setItem(BAGKEY, JSON.stringify(bag)); } catch {} };
  const lines = () => sheet.filter(x => bag[x.id] > 0).map(x => ({ x, n: bag[x.id] }));
  const state = () => P.stateCode(profile?.shipping_state || profile?.state || "");
  const totals = () => { const sub = lines().reduce((s, l) => s + Number(l.x.price) * l.n, 0); return { sub: P.round(sub), total: P.round(sub), n: lines().reduce((s, l) => s + l.n, 0) }; };
  const kits = n => `${n} kit${n === 1 ? "" : "s"}`;
  const loadStats = async () => { const r = await P.client().rpc("ppu_partner_stats"); stats = (r.data || [])[0] || null; };

  function msg(icon, title, body, actions = "") { el().innerHTML = `<div class="mgate">${P.icon(icon, 28)}<h2 class="serif">${title}</h2><p class="muted">${body}</p>${actions}</div>`; }

  async function boot() {
    user = await P.getUser().catch(() => null);
    if (!user) return msg("lock", "Partner sign in", "Approved Patriot Peptides USA partners sign in here with the email Jeff has on file. We'll email you a sign-in code.", `<a class="btn primary" href="login.html?redirect=${encodeURIComponent("vendor.html" + location.search)}">Sign in</a>`);
    const r = await P.client().rpc("ppu_my_partner");
    me = r.data;
    if (r.error || !me) return msg("lock", "Partners only", `This area is for approved Patriot Peptides USA partners. You're signed in as <b>${esc(user.email || "")}</b>. If Jeff invited you with a different email, sign out and sign in with that one.`, `<a class="btn ghost" href="index.html">Go to the shop</a> <a class="btn ghost" href="contact.html">Contact us</a>`);
    if (me.status !== "active") return msg("lock", "Account paused", "Your partner account is paused right now. Reach out and we'll get it sorted.", `<a class="btn primary" href="contact.html">Contact us</a>`);
    document.title = `${me.tier_name} portal | Patriot Peptides USA`;
    await loadStats().catch(() => {});
    if (!me.has_prices) return promoter();
    profile = await P.getProfile(user).catch(() => null);
    const [s, m] = await Promise.all([P.client().from("ppu_partner_prices").select("id,sku,name,amount,price,sort").eq("tier", me.tier).eq("active", true).order("sort") /* v111: owners who are also partners can read every tier, so ask for theirs only */.order("name"), P.paymentMethods().catch(() => [])]);
    if (s.error) return msg("lock", "Couldn't load your pricing", esc(s.error.message));
    sheet = s.data || []; methods = (m || []).filter(x => !P.isOtherPay?.(x.label));
    bag = loadBag(); Object.keys(bag).forEach(k => { if (!sheet.some(x => x.id === k) || !(bag[k] > 0)) delete bag[k]; }); saveBag();
    pay = pay || (methods.find(x => /venmo/i.test(x.id + x.label)) || methods[0] || {}).label || "";
    await loadGroups();
    const want = new URLSearchParams(location.search).get("group"), g = want && groups.find(x => x.id === want);
    if (g) return enterGroup(g);
    draw(); recent();
    if (want) P.toast("That group order is closed or no longer available.");
  }

  // ---- group orders ----
  const day = d => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const when = t => new Date(t).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles", timeZoneName: "short" });
  const gName = g => g.title ? `${g.title} · ${day(g.order_date)}` : `Group order · ${day(g.order_date)}`;
  const gSum = g => (g.lines || []).reduce((s, l) => s + Number(l.price) * l.qty, 0), gKits = g => (g.lines || []).reduce((s, l) => s + l.qty, 0);
  async function loadGroups() { const r = await P.client().rpc("ppu_group_mine"); groups = Array.isArray(r.data) ? r.data : []; }
  function groupBanner() {
    if (!groups.length) return "";
    return `<div class="gbox">${groups.map(g => {
      const n = gKits(g), sub = gSum(g), placed = g.status === "submitted" && g.order_id;
      const line = placed ? `Placed · your order <b>${esc(g.order_number || "")}</b> · ${money(sub)}. Check your email for how to pay.`
        : g.open ? (n ? `You're in: ${kits(n)} · ${money(sub)}. Change until ${esc(when(g.cutoff_at))}.` : `Add your kits by ${esc(when(g.cutoff_at))}. Nothing is charged until Jeff places it.`)
        : (n ? `Changes closed. Your ${kits(n)} (${money(sub)}) go in when Jeff places it.` : `Changes closed ${esc(when(g.cutoff_at))}.`);
      const act = placed ? `<button class="btn primary sm" type="button" data-gpay="${esc(g.id)}">Pay ${money(sub)}</button>` : g.open ? `<button class="btn primary sm" type="button" data-gopen="${esc(g.id)}">${n ? "Change my kits" : "Add to this order"}</button>` : n ? `<button class="btn ghost sm" type="button" data-gopen="${esc(g.id)}">View</button>` : "";
      return `<div class="gcard${placed ? " placed" : g.open ? "" : " closed"}"><div><span class="kick">${placed ? "Group order placed" : "Group order"}</span><b>${esc(gName(g))}</b><small>${line}</small></div>${act}</div>`;
    }).join("")}</div>`;
  }
  function enterGroup(g) {
    if (!grp) nbag = bag;
    grp = g; q = ""; bag = {}; (g.lines || []).forEach(l => { if (sheet.some(x => x.id === l.price_id)) bag[l.price_id] = l.qty; });
    gpay = g.payment_method || pay; gnotes = g.notes || "";
    try { history.replaceState(null, "", `vendor.html?group=${g.id}`); } catch {}
    drawGroup(); window.scrollTo(0, 0);
  }
  function leaveGroup() { if (grp) bag = nbag; grp = null; q = ""; try { history.replaceState(null, "", "vendor.html"); } catch {} draw(); recent(); window.scrollTo(0, 0); }
  function drawGroup() {
    const g = grp, info = `<div class="ginfo"><div class="r"><span>Order date</span><b>${esc(day(g.order_date))}</b></div><div class="r"><span>${g.open ? "Add or change kits until" : "Changes closed"}</span><b>${esc(when(g.cutoff_at))}</b></div>${g.note ? `<p class="small">${esc(g.note)}</p>` : ""}</div>`;
    const head = `<button class="btn ghost sm" type="button" data-gback>← My price sheet</button><div class="phead" style="margin-top:12px"><span class="ptier t${me.tier}">${me.tier}</span><div><span class="kick">Group order · Tier ${me.tier}</span><h1 class="serif">${esc(g.title || day(g.order_date))}</h1></div></div>${info}`;
    if (!g.open) { el().innerHTML = `${head}<p class="muted">${gKits(g) ? "Your kits on this order:" : "You didn't add anything to this one."}</p><div class="vrl">${(g.lines || []).map(l => `<div class="r"><span>${esc(l.name)} ${esc(l.amount || "")} <small class="muted">× ${kits(l.qty)}</small></span><b>${money(Number(l.price) * l.qty)}</b></div>`).join("")}</div>`; return; }
    el().innerHTML = `${head}<p class="muted small">Add the kits you want from your price sheet. <b>Nothing is charged now.</b> When Jeff places the order you'll get an email with your total and how to pay. Supplier shipping is split across the group and billed after the block ships.</p>
<input class="psearch" type="search" data-vsearch placeholder="Search ${sheet.length} products" aria-label="Search your price sheet">
<div class="vlist" data-vlist>${sheet.map(rowHtml).join("")}</div><div data-vbar>${barHtml()}</div>`;
  }
  function reviewGroup() {
    const t = totals(), g = grp, out = !t.n;
    const w = P.sheet(`<div class="vrev"><h2 class="serif">${out ? "Take me off this order" : "Your part of the group order"}</h2><p class="muted small">${esc(gName(g))} · change until ${esc(when(g.cutoff_at))}</p>
${out ? `<p>Your kits will be removed from this group order. You can add some again until the cutoff.</p>` : `<div class="vrl">${lines().map(l => `<div class="r"><span>${esc(l.x.name)} ${esc(l.x.amount || "")} <small class="muted">× ${kits(l.n)}</small></span><b>${money(Number(l.x.price) * l.n)}</b></div>`).join("")}</div>
<div class="sum"><div class="r"><span>Shipping</span><b>Billed later</b></div><div class="r tot"><span>Your total</span><b>${money(t.total)}</b></div><div class="r"><span>Due now</span><b>$0.00</b></div></div>
<h3 class="kick" style="margin:14px 0 6px">How you'll pay when it's placed</h3><div class="pm">${methods.map(m => `<label><input type="radio" name="gpm" value="${esc(m.label)}"${m.label === gpay ? " checked" : ""}><span>${esc(P.payLabel ? P.payLabel(m) : m.label)}</span></label>`).join("")}</div>
<label class="form" style="display:block;margin-top:10px"><span class="sr">Notes</span><textarea data-gnotes placeholder="Notes for Jeff (optional)" style="width:100%;min-height:56px">${esc(gnotes)}</textarea></label>`}
<button class="btn primary wide" type="button" data-gsave${out || gpay ? "" : " disabled"} style="margin-top:12px">${out ? "Remove me" : "Save my part"}</button><p class="status" data-gst role="status"></p>
${out ? "" : `<p class="muted small" style="text-align:center">We'll email you a copy. Nothing is charged until Jeff places the order.</p>`}</div>`, { label: "Group order" });
    w.addEventListener("change", e => { if (e.target.name === "gpm") { gpay = e.target.value; $("[data-gsave]", w).disabled = false; } });
    w.addEventListener("input", e => { if (e.target.matches("[data-gnotes]")) gnotes = e.target.value; });
    w.addEventListener("click", e => { if (e.target.closest("[data-gsave]") && !busy) saveGroup(w); });
  }
  async function saveGroup(w) {
    const st = $("[data-gst]", w), btn = $("[data-gsave]", w), ls = lines(), id = grp.id; busy = true; btn.disabled = true; st.textContent = "Saving…"; st.className = "status";
    try {
      const { error } = await P.client().rpc("ppu_group_save", { p_group: id, p_lines: ls.map(l => ({ id: l.x.id, qty: l.n })), p_payment: gpay, p_notes: gnotes.trim() });
      if (error) throw error;
      P.client().functions.invoke("ppu-group-mail", { body: { action: "confirm", group_id: id } }).catch(() => {});
      P.closeSheet(); await loadGroups().catch(() => {});
      const g = groups.find(x => x.id === id) || grp; grp = g;
      el().innerHTML = `<div class="vdone"><span class="kick">${ls.length ? "Added to the group order" : "Removed"}</span><h1 class="serif">${ls.length ? "You're in" : "You're off this one"}</h1><p class="muted">${ls.length ? `${kits(gKits(g))} · ${money(gSum(g))} on ${esc(gName(g))}. We emailed you a copy. <b>Nothing is charged now.</b> When Jeff places the order you'll get an email with how to pay. You can change your kits until ${esc(when(g.cutoff_at))}.` : `Your kits were taken off ${esc(gName(g))}. You can add some again until ${esc(when(g.cutoff_at))}.`}</p>
<div class="pinvb" style="margin-top:14px"><button class="btn primary" type="button" data-gopen="${esc(id)}">${ls.length ? "Change my kits" : "Add kits"}</button><button class="btn ghost" type="button" data-gback>Back to my price sheet</button></div></div>`;
    } catch (err) { st.textContent = err.message || "Couldn't save. Try again."; st.className = "status bad"; btn.disabled = false; }
    busy = false;
  }
  async function payGroup(id) {
    const g = groups.find(x => x.id === id); if (!g?.order_id) return;
    const card = await P.payCard(g.payment_method || pay, gSum(g), g.order_number, g.order_id).catch(() => "");
    P.sheet(`<div class="vrev"><h2 class="serif">Pay for ${esc(g.order_number || "your order")}</h2><p class="muted small">${esc(gName(g))} · ${money(gSum(g))} for ${kits(gKits(g))}. Shipping is billed after the block ships.</p>${card || `<p>Check your email for payment instructions, or <a href="account.html#orders">open your orders</a>.</p>`}</div>`, { label: "Pay" });
  }

  function promoter() {
    const code = me.discount_code || "";
    const share = `Save 10% at Patriot Peptides USA with my code ${code}: https://www.patriotpeptides-usa.com`;
    el().innerHTML = `<div class="phead"><span class="ptier t1">1</span><div><span class="kick">Tier 1 · ${esc(me.tier_name)}</span><h1 class="serif">Welcome${me.name ? `, ${esc(String(me.name).split(/\s+/)[0])}` : ""}</h1></div></div>
<div class="pcode"><small>Your code</small><b>${esc(code || "Coming soon")}</b><p class="muted small">Shoppers get 10% off when they use it. You earn the same 10% back as cash or product.</p>
${code ? `<div class="pinvb"><button class="btn primary" type="button" data-pshare>Share my code</button><button class="btn ghost" type="button" data-pcopy>Copy</button></div>` : ""}</div>
${stats ? `<div class="pstats"><div><small>Earned</small><b>${money(stats.earned)}</b></div><div><small>Paid to you</small><b>${money(stats.paid_out)}</b></div><div><small>Balance</small><b>${money(stats.balance)}</b></div></div><p class="muted small">${stats.code_orders} paid order${stats.code_orders === 1 ? "" : "s"} used your code${Number(stats.earned_month) ? `, ${money(stats.earned_month)} earned this month` : ""}. Earnings count once an order is paid.</p>` : ""}
<p class="muted small">Questions about your earnings? <a href="contact.html">Contact us</a>.</p>`;
    el().onclick = async e => {
      if (e.target.closest("[data-pshare]")) { try { if (navigator.share) await navigator.share({ text: share }); else { await navigator.clipboard.writeText(share); P.toast("Copied. Paste it anywhere."); } } catch {} }
      if (e.target.closest("[data-pcopy]")) { try { await navigator.clipboard.writeText(code); P.toast("Code copied"); } catch {} }
    };
  }

  function rowHtml(x) {
    const n = bag[x.id] || 0;
    return `<div class="vrow${n ? " in" : ""}" data-vname="${esc(`${x.name} ${x.amount || ""} ${x.sku || ""}`.toLowerCase())}"><span class="vtx"><b>${esc(x.name)}</b><small>${esc(x.amount || "")} · kit of 10</small></span><b class="vpr">${money(x.price)}<small>/kit</small></b>
<div class="qty sm"><button type="button" data-vq="${esc(x.id)}" data-d="-1" aria-label="Fewer ${esc(x.name)} ${esc(x.amount || "")}"${n ? "" : " disabled"}>−</button><input type="number" min="0" max="9999" inputmode="numeric" value="${n || ""}" placeholder="0" data-vn="${esc(x.id)}" aria-label="${esc(x.name)} ${esc(x.amount || "")} quantity"><button type="button" data-vq="${esc(x.id)}" data-d="1" aria-label="More ${esc(x.name)} ${esc(x.amount || "")}">+</button></div></div>`;
  }
  function barHtml() { const t = totals();
    if (grp) return t.n ? `<div class="vbar"><span><b>${kits(t.n)}</b><small>${money(t.sub)} · nothing charged now</small></span><button class="btn primary" type="button" data-greview>Review my part</button></div>` : grp.saved_at ? `<div class="vbar"><span><b>No kits</b><small>You're on this order with nothing</small></span><button class="btn primary" type="button" data-greview>Take me off</button></div>` : "";
    return t.n ? `<div class="vbar"><span><b>${kits(t.n)}</b><small>${money(t.sub)} + shipping billed later</small></span><button class="btn primary" type="button" data-vreview>Review order · ${money(t.total)}</button></div>` : ""; }
  function draw() {
    el().innerHTML = `<div class="phead"><span class="ptier t${me.tier}">${me.tier}</span><div><span class="kick">Tier ${me.tier} · ${esc(me.tier_name)}${me.company ? ` · ${esc(me.company)}` : ""}</span><h1 class="serif">Your price sheet</h1></div></div>
${groupBanner()}${progress()}<p class="muted small">Prices are per 10-vial kit and for your account only. Orders go out with the next twice-monthly block. Supplier shipping is split across the group, so your share is billed after the block ships.</p>
<input class="psearch" type="search" data-vsearch placeholder="Search ${sheet.length} products" aria-label="Search your price sheet" value="${esc(q)}">
<div class="vlist" data-vlist>${sheet.map(rowHtml).join("") || `<p class="muted">Your price sheet is being set up. Check back soon.</p>`}</div>
<div data-vbar>${barHtml()}</div><div data-vrecent></div>`;
    filter();
  }
  function progress() {
    if (!stats || !(me.tier === 2 || me.tier === 3)) return "";
    const kit = me.tier === 2, have = kit ? Number(stats.kits_month) : Number(stats.spend_month), need = kit ? 5 : 1000, pct = Math.min(100, have / need * 100);
    const month = new Date().toLocaleString("en-US", { month: "long", timeZone: "America/Los_Angeles" });
    return `<div class="pmin${have >= need ? " met" : ""}"><div class="pmint"><b>${month}: ${kit ? `${have} of ${need} kits` : `${money(have)} of ${money(need)}`}</b><small>${have >= need ? "Monthly minimum met. Thank you!" : `${kit ? kits(need - have) : money(need - have)} to go for your monthly minimum${kit ? " (water doesn't count)" : ""}. Paid orders count.`}</small></div><div class="shipbar"><i style="width:${pct}%"></i></div></div>`;
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
<div class="vrl">${lines().map(l => `<div class="r"><span>${esc(l.x.name)} ${esc(l.x.amount || "")} <small class="muted">× ${kits(l.n)}</small></span><b>${money(Number(l.x.price) * l.n)}</b></div>`).join("")}</div>
<div class="sum"><div class="r"><span>Kits</span><b>${money(t.sub)}</b></div><div class="r"><span>Shipping</span><b>Billed later</b></div><div class="r tot"><span>Due now</span><b>${money(t.total)}</b></div></div><p class="muted small" style="margin:-4px 0 8px">Supplier shipping is split across everyone in the block. We'll send your share once it ships.</p>
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
      try { await P.postEmail(P.emailPayload({ id: data.id, order_number: data.order_number, created_at: data.created_at }, { customerName: data.name || me.name || "", customerEmail: data.email, items: ls.map(l => ({ product_key: null, product_name: l.x.name, product_strength: `${l.x.amount ? l.x.amount + " · " : ""}kit of 10`, quantity: l.n, unit_price: Number(l.x.price), line_total: P.round(Number(l.x.price) * l.n) })), subtotal: data.subtotal, discount: 0, shipping: 0, total: data.total, paymentMethod: pay, deliveryMethod: "Shipping" }, { shippingLabel: "Billed later" })); } catch {}
      bag = {}; saveBag(); notes = ""; P.closeSheet(); loadStats().catch(() => {});
      const card = await P.payCard(pay, data.total, orderNo, data.id).catch(() => "");
      el().innerHTML = `<div class="vdone"><span class="kick">Order placed</span><h1 class="serif">Thanks${me.name ? `, ${esc(String(me.name).split(/\s+/)[0])}` : ""}</h1><p class="muted">Order <b>${esc(orderNo)}</b> · ${money(data.total)} for ${kits(data.lines ? ls.reduce((s, l) => s + l.n, 0) : 0)}. We emailed you a copy. Send payment below and we'll add it to the next block. Your share of shipping is billed once it ships.</p>${card}
<div class="pinvb" style="margin-top:14px"><button class="btn ghost" type="button" data-gback>Back to my price sheet</button><a class="btn ghost" href="account.html#orders">My orders</a></div></div>`;
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
    el().onclick = e => { const b = e.target.closest("[data-vq]"); if (b) return setN(b.dataset.vq, (bag[b.dataset.vq] || 0) + Number(b.dataset.d)); if (e.target.closest("[data-vreview]")) review();
      if (e.target.closest("[data-greview]")) reviewGroup();
      const go = e.target.closest("[data-gopen]"); if (go) { const g = groups.find(x => x.id === go.dataset.gopen); if (g) enterGroup(g); }
      if (e.target.closest("[data-gback]")) leaveGroup();
      const gp = e.target.closest("[data-gpay]"); if (gp) payGroup(gp.dataset.gpay); };
    el().oninput = e => { if (e.target.matches("[data-vsearch]")) { q = e.target.value.trim().toLowerCase(); filter(); } };
    el().onchange = e => { if (e.target.matches("[data-vn]")) setN(e.target.dataset.vn, e.target.value); };
  }

  document.addEventListener("DOMContentLoaded", async () => { if (!el()) return; try { await boot(); if (me?.has_prices && me.status === "active") bindList(); } catch (err) { msg("lock", "Something went wrong", esc(err.message || "Please refresh.")); } });
})();
