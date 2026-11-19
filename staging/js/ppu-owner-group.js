/* Patriot Peptides USA · Owner app → More → Partner program → Group orders (v119, Nov 19 2026).
   Jeff opens a group order for a date with a cutoff (1/2/3/5/7 days before, or a set date and time). Runners and Vendors get an
   email (ppu-group-mail announce) and/or a WhatsApp link, add kits from their own price sheet until the cutoff (vendor.html?group=ID),
   get a reminder about a day before (hourly cron), and Jeff watches the totals here. Submit turns each partner's part into a normal
   partner order awaiting payment (ppu_group_submit) and emails each one their total and how to pay (ppu-group-mail placed).
   The combined supplier PO is saved as a group buy PO (ppu_group_pos, v3) apart from the store's POs, so partner kits never touch shelf stock, reorder suggestions or costs.
   Prices: owners see every tier here; partners only ever see their own lines at their own tier (server functions). */
(() => {
  const P = window.PST, esc = P.esc, money = P.money, $ = (s, r = document) => r.querySelector(s);
  const db = () => P.client(), TZ = "America/Los_Angeles";
  const LINK = id => new URL(`vendor.html?group=${id}`, location.href).href; // staging links to staging
  let host = null, groups = [], partners = [], vendors = [], cur = null, board = null, stats = {};

  const day = d => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const when = t => new Date(t).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: TZ });
  const gName = g => g.title ? `${g.title} · ${day(g.order_date)}` : `Group order · ${day(g.order_date)}`;
  const kits = n => `${n} kit${n === 1 ? "" : "s"}`;
  // Pacific wall-clock date + time → ISO, whatever time zone this phone is in
  function ptISO(date, time) {
    const [y, m, d] = date.split("-").map(Number), [h, mi] = (time || "17:00").split(":").map(Number), want = Date.UTC(y, m - 1, d, h, mi);
    let t = want; for (let i = 0; i < 3; i++) { const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(t)).map(x => [x.type, x.value]));
      const seen = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute); t += want - seen; }
    return new Date(t).toISOString();
  }
  const ptParts = iso => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(iso)).map(x => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }; };
  const addDays = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const waNum = ph => { let d = String(ph || "").replace(/\D/g, ""); if (d.length === 10) d = "1" + d; return d.length >= 11 ? d : ""; };
  const groupMsg = g => `Patriot Peptides group order for ${day(g.order_date)}${g.title ? ` (${g.title})` : ""}. Add your kits by ${when(g.cutoff_at)} Pacific. Nothing is charged until the order is placed.\n${LINK(g.id)}`;
  const callMail = async (action, group_id) => { const { data, error } = await db().functions.invoke("ppu-group-mail", { body: { action, group_id } }); if (error || data?.ok === false) throw new Error(data?.error || error?.message || "Email failed"); return data.sent || []; };

  async function pane(el) {
    host = el; el.innerHTML = `<p class="muted small">Loading…</p>`;
    try { await loadList(); } catch (err) { el.innerHTML = `<p class="notice err">${esc(err.message)}</p>`; return; }
    cur ? openBoard(cur) : drawList();
  }
  async function loadList() {
    const [g, p, v] = await Promise.all([db().from("ppu_group_orders").select("*").order("order_date", { ascending: false }).limit(30),
      db().from("ppu_partners").select("id,name,email,company,phone,tier,status,user_id").in("tier", [2, 3]).order("name"),
      db().from("vendors").select("id,company_name").order("company_name")]);
    const err = g.error || p.error; if (err) throw err;
    groups = g.data || []; partners = p.data || []; vendors = v.data || [];
    const st = await db().rpc("ppu_partner_stats"); stats = Object.fromEntries((st.data || []).map(x => [x.partner_id, x]));
  }
  const statusChip = g => g.status === "submitted" ? `<span class="gchip ok">Placed</span>` : g.status === "cancelled" ? `<span class="gchip">Cancelled</span>` : new Date(g.cutoff_at) <= new Date() ? `<span class="gchip warn">Cutoff passed · ready to place</span>` : `<span class="gchip pend">Open</span>`;
  function drawList() {
    cur = null;
    host.innerHTML = `<div class="pmtop"><p class="muted small" style="margin:0;flex:1">Open a group order for a date. Runners and Vendors add kits from their own price sheet until your cutoff; you place it once and everyone gets a payment email.</p><button class="btn primary sm" type="button" data-gnew>+ New group order</button></div>
${groups.length ? `<div class="gbox">${groups.map(g => `<button type="button" class="gcard${g.status === "submitted" ? " placed" : g.status === "cancelled" ? " closed" : ""}" data-gboard="${esc(g.id)}" style="text-align:left;width:100%;color:inherit;font:inherit"><div><span class="kick">${day(g.order_date)}</span><b>${esc(g.title || "Group order")}</b><small>Cutoff ${esc(when(g.cutoff_at))}</small></div>${statusChip(g)}</button>`).join("")}</div>`
  : `<div class="nalbox"><p class="muted small" style="margin:0">No group orders yet.</p></div>`}`;
  }

  /* ---------- create / edit ---------- */
  function edit(g) {
    const isNew = !g, next = (() => { const d = new Date(); d.setDate(d.getDate() + 3); d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7)); /* first Friday at least 3 days out */ return d.toLocaleDateString("en-CA", { timeZone: TZ }); })();
    const v = g || { order_date: next, title: "", note: "" }, c = g ? ptParts(g.cutoff_at) : { date: addDays(next, -1), time: "17:00" };
    const preset = g ? [1, 2, 3, 5, 7].find(n => addDays(v.order_date, -n) === c.date) || "custom" : 1;
    const w = P.sheet(`<form class="pmform" data-gform novalidate><h2 class="serif">${isNew ? "New group order" : "Edit group order"}</h2>
<div class="pm2"><label>Order date<input name="order_date" type="date" required value="${esc(v.order_date)}"></label><label>Name <span class="muted small">(optional)</span><input name="title" maxlength="60" value="${esc(v.title || "")}" placeholder="e.g. Late November block"></label></div>
<div class="pm2"><label>Cutoff<select name="preset">${[1, 2, 3, 5, 7].map(n => `<option value="${n}"${preset === n ? " selected" : ""}>${n} day${n === 1 ? "" : "s"} before</option>`).join("")}<option value="custom"${preset === "custom" ? " selected" : ""}>A specific date</option></select></label>
<label data-cdate${preset === "custom" ? "" : ` style="display:none"`}>Cutoff date<input name="cdate" type="date" value="${esc(c.date)}"></label><label>Time (Pacific)<input name="ctime" type="time" value="${esc(c.time)}"></label></div>
<p class="small muted" data-cprev></p>
<label>Note to partners <span class="muted small">(optional)</span><textarea name="note" maxlength="500" rows="3" placeholder="Shown in the email and on their order page">${esc(v.note || "")}</textarea></label>
${isNew ? `<label class="chk"><input type="checkbox" name="announce" checked> Email every Runner and Vendor now</label>` : ""}
<button class="btn primary wide" type="submit">${isNew ? "Open the group order" : "Save changes"}</button><p class="status" data-gst role="status"></p></form>`, { label: "Group order" });
    const f = $("[data-gform]", w);
    const cutoff = () => { const d = f.preset.value === "custom" ? f.cdate.value : f.order_date.value && addDays(f.order_date.value, -Number(f.preset.value)); return d ? ptISO(d, f.ctime.value || "17:00") : ""; };
    const prev = () => { $("[data-cdate]", w).style.display = f.preset.value === "custom" ? "" : "none"; const c2 = cutoff(); $("[data-cprev]", w).textContent = c2 ? `Partners can add or change kits until ${when(c2)} Pacific.` : ""; };
    f.addEventListener("input", prev); f.addEventListener("change", prev); prev();
    f.addEventListener("submit", async e => {
      e.preventDefault(); const st = $("[data-gst]", w), btn = f.querySelector("[type=submit]"), cut = cutoff();
      if (!f.order_date.value) { st.textContent = "Pick the order date."; st.className = "status bad"; return; }
      if (!cut || new Date(cut) <= new Date()) { st.textContent = "The cutoff has to be in the future."; st.className = "status bad"; return; }
      if (cut.slice(0, 10) > f.order_date.value) { st.textContent = "The cutoff should be on or before the order date."; st.className = "status bad"; return; }
      btn.disabled = true; st.textContent = "Saving…"; st.className = "status";
      const row = { order_date: f.order_date.value, title: f.title.value.trim() || null, note: f.note.value.trim() || null, cutoff_at: cut, updated_at: new Date().toISOString() };
      try {
        let id = g?.id;
        if (isNew) { const u = await P.getUser(); const { data, error } = await db().from("ppu_group_orders").insert({ ...row, created_by: u?.id || null }).select("id").single(); if (error) throw error; id = data.id; }
        else { if (new Date(cut) > new Date(g.cutoff_at)) row.reminded_at = null; const { error } = await db().from("ppu_group_orders").update(row).eq("id", id); if (error) throw error; }
        if (isNew && f.announce.checked) { st.textContent = "Emailing partners…"; try { const s = await callMail("announce", id); P.toast(`Opened · emailed ${s.filter(x => x.ok).length} partner${s.length === 1 ? "" : "s"}`); } catch (er) { P.toast(`Opened, but the email didn't go: ${er.message}`); } }
        else P.toast(isNew ? "Group order opened" : "Saved");
        P.closeSheet(); await loadList(); openBoard(id);
      } catch (err) { st.textContent = err.message; st.className = "status bad"; btn.disabled = false; }
    });
  }

  /* ---------- board ---------- */
  async function loadBoard(id) {
    const [m, l] = await Promise.all([db().from("ppu_group_members").select("*").eq("group_id", id),
      db().from("ppu_group_lines").select("partner_id,qty,price_id,ppu_partner_prices(sku,name,amount,price,tier)").eq("group_id", id)]);
    const err = m.error || l.error; if (err) throw err;
    const g = groups.find(x => x.id === id);
    const ord = (m.data || []).map(x => x.order_id).filter(Boolean);
    const o = ord.length ? (await db().from("orders").select("id,order_number,total,payment_status").in("id", ord)).data || [] : [];
    const po = (await db().from("ppu_group_pos").select("*").eq("group_id", id).maybeSingle()).data || null;
    board = { g, po, members: m.data || [], lines: (l.data || []).map(x => ({ ...x, pr: x.ppu_partner_prices || {} })), orders: o, costs: {} };
    await loadCosts(g.supplier_vendor_id);
  }
  async function loadCosts(vid) {
    board.costs = {}; if (!vid) return;
    const skus = [...new Set(board.lines.map(l => l.pr.sku).filter(Boolean))]; if (!skus.length) return;
    const { data } = await db().from("pst_vendor_catalog_items").select("vendor_item_number,kit_cost,kit_size").eq("vendor_id", vid).in("vendor_item_number", skus);
    (data || []).forEach(r => { if (r.kit_cost != null) board.costs[String(r.vendor_item_number).toUpperCase()] = Number(r.kit_cost); });
  }
  async function openBoard(id) {
    cur = id; host.innerHTML = `<p class="muted small">Loading…</p>`;
    try { await loadBoard(id); } catch (err) { host.innerHTML = `<p class="notice err">${esc(err.message)}</p>`; return; }
    drawBoard();
  }
  function byPartner() {
    return partners.filter(p => p.status === "active").map(p => {
      const ls = board.lines.filter(l => l.partner_id === p.id), m = board.members.find(x => x.partner_id === p.id);
      return { p, m, ls, n: ls.reduce((s, l) => s + l.qty, 0), sub: ls.reduce((s, l) => s + Number(l.pr.price || 0) * l.qty, 0), o: m?.order_id && board.orders.find(x => x.id === m.order_id) };
    }).sort((a, b) => b.sub - a.sub || String(a.p.name || a.p.email).localeCompare(b.p.name || b.p.email));
  }
  function minNote(r) {
    const s = stats[r.p.id] || {}, kit = r.p.tier === 2, need = kit ? 5 : 1000, have = kit ? Number(s.kits_month || 0) + r.n : Number(s.spend_month || 0) + r.sub;
    return have >= need ? "" : `<span class="short">Short of the monthly minimum: ${kit ? `${have} of 5 kits` : `${money(have)} of ${money(1000)}`} with this order</span>`;
  }
  function byProduct() {
    const map = {};
    board.lines.forEach(l => { const k = String(l.pr.sku || `${l.pr.name} ${l.pr.amount}`).toUpperCase(); const x = map[k] ||= { sku: l.pr.sku || "", name: l.pr.name, amount: l.pr.amount || "", kits: 0, sales: 0 }; x.kits += l.qty; x.sales += Number(l.pr.price || 0) * l.qty; });
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name) || a.amount.localeCompare(b.amount));
  }
  function drawBoard() {
    const g = board.g, open = g.status === "open", rows = byPartner(), inRows = rows.filter(r => r.n), prods = byProduct();
    const tKits = inRows.reduce((s, r) => s + r.n, 0), tSales = inRows.reduce((s, r) => s + r.sub, 0), costKnown = prods.every(x => board.costs[String(x.sku).toUpperCase()] != null);
    const cost = prods.reduce((s, x) => s + (board.costs[String(x.sku).toUpperCase()] || 0) * x.kits, 0), missing = prods.filter(x => board.costs[String(x.sku).toUpperCase()] == null);
    const past = new Date(g.cutoff_at) <= new Date();
    host.innerHTML = `<div class="gob"><button class="btn ghost sm" type="button" data-glist>← All group orders</button>
<div class="phead" style="margin-top:12px"><div><span class="kick">${day(g.order_date)} ${statusChip(g)}</span><h2 class="serif" style="margin:4px 0 0">${esc(g.title || "Group order")}</h2></div></div>
<div class="ginfo"><div class="r"><span>Cutoff</span><b>${esc(when(g.cutoff_at))}</b></div><div class="r"><span>Emailed</span><b>${g.announced_at ? esc(when(g.announced_at)) : "Not yet"}</b></div><div class="r"><span>Reminder</span><b>${g.reminded_at ? esc(when(g.reminded_at)) : open ? "About a day before the cutoff" : "—"}</b></div>${g.note ? `<p class="small">${esc(g.note)}</p>` : ""}</div>
<div class="pstats"><div><small>Partners in</small><b>${inRows.length}</b></div><div><small>Kits</small><b>${tKits}</b></div><div><small>Partner total</small><b>${money(tSales)}</b></div></div>
${open ? `<div class="pinvb" style="flex-wrap:wrap;margin:12px 0"><a class="btn wa sm" href="https://wa.me/?text=${encodeURIComponent(groupMsg(g))}" target="_blank" rel="noopener">Share to WhatsApp</a><button class="btn ghost sm" type="button" data-gcopy>Copy link</button><button class="btn ghost sm" type="button" data-gmail>${g.announced_at ? "Email everyone again" : "Email Runners & Vendors"}</button><button class="btn ghost sm" type="button" data-gremind>Send reminder now</button><button class="btn ghost sm" type="button" data-gedit>Edit</button></div>
<button class="btn primary wide" type="button" data-gsubmit${inRows.length ? "" : " disabled"}>Place the order · ${inRows.length} partner${inRows.length === 1 ? "" : "s"} · ${money(tSales)}</button><p class="muted small">${past ? "The cutoff has passed, so partners can't change their kits." : "Placing it now closes it for changes, even before the cutoff."} Each partner gets an order awaiting payment and an email with how to pay.</p>` : ""}
${g.status === "submitted" ? `<div class="pinvb" style="margin:12px 0"><button class="btn ghost sm" type="button" data-gplaced>Resend payment emails</button></div>
${board.po ? `<button type="button" class="gcard" data-popen="${esc(board.po.id)}" style="text-align:left;width:100%;color:inherit;font:inherit"><div><span class="kick">Group buy PO</span><b>${esc(board.po.po_number)} · ${esc(board.po.vendor_name || "Supplier not set")}</b><small>${poKits(board.po)} kits · ${money(poTotal(board.po))}${board.po.tracking ? ` · tracking ${esc(board.po.tracking)}` : ""}</small></div>${poChip(board.po)}</button>` : `<button class="btn ghost wide" type="button" data-gsavepo>Save the group buy PO</button>`}` : ""}
<h3 class="kick" style="margin:18px 0 6px">Partners</h3><div>${rows.map(r => {
  const wa = waNum(r.p.phone), msg = r.n ? `Hi ${String(r.p.name || "").split(/\s+/)[0] || "there"}, you're in on the ${day(g.order_date)} group order with ${kits(r.n)}. You can change them until ${when(g.cutoff_at)} Pacific: ${LINK(g.id)}` : `Hi ${String(r.p.name || "").split(/\s+/)[0] || "there"}, I'm placing a group order for ${day(g.order_date)}. Add your kits by ${when(g.cutoff_at)} Pacific: ${LINK(g.id)}`;
  return `<div class="r"><span><b>${esc(r.p.name || r.p.email)}</b> <span class="muted small">· Tier ${r.p.tier}</span><small>${r.n ? `${kits(r.n)} · ${money(r.sub)}${r.m?.payment_method ? ` · pays by ${esc(r.m.payment_method)}` : ""}${r.m?.saved_at ? ` · saved ${esc(when(r.m.saved_at))}` : ""}` : "Not in yet"}${r.o ? ` · order <b>${esc(r.o.order_number)}</b> · ${String(r.o.payment_status).toLowerCase() === "paid" ? "paid" : "awaiting payment"}` : ""}</small>${r.m?.notes ? `<small>“${esc(r.m.notes)}”</small>` : ""}${r.n && open ? minNote(r) : ""}${r.p.user_id ? "" : `<small>Hasn't signed in to the portal yet</small>`}</span>${open && wa ? `<a class="btn wa sm" href="https://wa.me/${wa}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener" aria-label="WhatsApp ${esc(r.p.name || "")}">WhatsApp</a>` : open ? `<small class="muted" style="flex:none">No phone saved</small>` : ""}</div>`; }).join("") || `<p class="muted small">No active Runners or Vendors yet.</p>`}</div>
<h3 class="kick" style="margin:18px 0 6px">By product</h3>
${prods.length ? `<label class="small" style="display:block;margin-bottom:6px">Supplier for the combined PO <select data-gvendor><option value="">Choose a supplier</option>${vendors.map(v => `<option value="${esc(v.id)}"${v.id === g.supplier_vendor_id ? " selected" : ""}>${esc(v.company_name)}</option>`).join("")}</select></label>
<div>${prods.map(x => { const c = board.costs[String(x.sku).toUpperCase()]; return `<div class="r"><span><b>${esc(x.name)} ${esc(x.amount)}</b><small>${esc(x.sku || "no SKU")}${g.supplier_vendor_id ? c != null ? ` · supplier ${money(c)}/kit` : ` · <span class="short">not on this supplier's list</span>` : ""}</small></span><b>${kits(x.kits)}</b></div>`; }).join("")}</div>
${g.supplier_vendor_id ? `<p class="small" style="margin:10px 0">Supplier cost ${costKnown ? "" : "(known items) "}<b>${money(cost)}</b> · partner total <b>${money(tSales)}</b>${costKnown ? ` · margin <b>${money(tSales - cost)}</b>` : ""}${missing.length ? `<br><span class="muted">${missing.length} item${missing.length === 1 ? "" : "s"} not on this supplier's price list: ${missing.map(x => esc(x.sku || x.name)).join(", ")}</span>` : ""}</p>${g.status === "open" ? `<button class="btn ghost wide" type="button" data-gpo>Print a draft supplier PO</button><p class="muted small">When you place the order, the combined PO is saved under Partner program → Group POs, apart from your store POs, so it never touches your stock, reorder suggestions or costs.</p>` : ""}` : ""}`
  : `<p class="muted small">Nothing added yet.</p>`}
${open ? `<button class="btn ghost sm" type="button" data-gcancel style="margin-top:18px;color:var(--bad)">Cancel this group order</button>` : ""}</div>`;
  }
  function printPO() {
    const g = board.g, v = vendors.find(x => x.id === g.supplier_vendor_id), at = new Date().toISOString(), skus = {};
    const rows = byProduct().map((x, i) => { const c = board.costs[String(x.sku).toUpperCase()] || 0, id = `g${i}`; skus[id] = x.sku || "—";
      return { id, product_name: `${x.name} ${x.amount}`.trim(), ordered_quantity: x.kits * 10, kit_vial_count: 10, kit_cost: c, shipping_cost: 0, total_cost: c * x.kits, status: "ordered", ordered_at: g.order_date ? `${g.order_date}T12:00:00Z` : at, vendor_name: v?.company_name || "" }; });
    if (!window.PSTOps3?.poPrint) return P.toast("The PO printer didn't load. Refresh and try again.");
    PSTOps3.poPrint(`GO-${String(g.order_date).replace(/-/g, "")}`, rows, skus);
  }

  /* ---------- group buy POs (ppu_group_pos): saved apart from the store's POs ---------- */
  const dDay = d => new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); // date-only, no time-zone shift
  const poKits = po => (po.lines || []).reduce((s, l) => s + Number(l.kits || 0), 0);
  const poSub = po => (po.lines || []).reduce((s, l) => s + Number(l.kits || 0) * Number(l.kit_cost || 0), 0);
  const poTotal = po => poSub(po) + Number(po.shipping || 0);
  const PO_ST = { ordered: ["Ordered", "pend"], shipped: ["Shipped", "warn"], arrived: ["Arrived", "ok"], cancelled: ["Cancelled", ""] };
  const poChip = po => { const [t, k] = PO_ST[po.status] || [po.status, ""]; return `<span class="gchip ${k}">${t}</span>`; };
  async function costsFor(vid, skus) {
    const out = {}; if (!vid || !skus.length) return out;
    const { data } = await db().from("pst_vendor_catalog_items").select("vendor_item_number,kit_cost").eq("vendor_id", vid).in("vendor_item_number", skus);
    (data || []).forEach(r => { if (r.kit_cost != null) out[String(r.vendor_item_number).toUpperCase()] = Number(r.kit_cost); }); return out;
  }
  async function savePO(g) {
    const v = vendors.find(x => x.id === g.supplier_vendor_id), base = `GB-${String(g.order_date).replace(/-/g, "")}`;
    const { data: taken } = await db().from("ppu_group_pos").select("po_number").like("po_number", `${base}%`);
    let no = base, i = 2; while ((taken || []).some(x => x.po_number === no)) no = `${base}-${i++}`;
    const lines = byProduct().map(x => ({ sku: x.sku, name: x.name, amount: x.amount, kits: x.kits, kit_cost: board.costs[String(x.sku).toUpperCase()] ?? null }));
    const u = await P.getUser().catch(() => null);
    const { data, error } = await db().from("ppu_group_pos").insert({ group_id: g.id, po_number: no, vendor_id: v?.id || null, vendor_name: v?.company_name || null, lines, ordered_at: new Date().toLocaleDateString("en-CA", { timeZone: TZ }), created_by: u?.id || null }).select("*").single();
    if (error) throw error; return data;
  }
  function printSavedPO(po) {
    if (!window.PSTOps3?.poPrint) return P.toast("The PO printer didn't load. Refresh and try again.");
    const skus = {}, rows = (po.lines || []).map((l, i) => { const id = `p${i}`, c = Number(l.kit_cost || 0); skus[id] = l.sku || "—";
      return { id, product_name: `${l.name} ${l.amount || ""}`.trim(), ordered_quantity: Number(l.kits) * 10, kit_vial_count: 10, kit_cost: c, shipping_cost: i ? 0 : Number(po.shipping || 0), total_cost: c * Number(l.kits) + (i ? 0 : Number(po.shipping || 0)), status: po.status === "arrived" ? "received" : po.status === "cancelled" ? "cancelled" : "ordered", ordered_at: `${po.ordered_at}T12:00:00Z`, vendor_name: po.vendor_name || "", tracking_number: i ? null : po.tracking }; });
    PSTOps3.poPrint(po.po_number, rows, skus);
  }
  let poHost = null, pos = [];
  async function poPane(el) {
    poHost = el; el.innerHTML = `<p class="muted small">Loading…</p>`;
    const [r, v] = await Promise.all([db().from("ppu_group_pos").select("*").order("created_at", { ascending: false }).limit(60), vendors.length ? { data: vendors } : db().from("vendors").select("id,company_name").order("company_name")]);
    if (r.error) { el.innerHTML = `<p class="notice err">${esc(r.error.message)}</p>`; return; }
    pos = r.data || []; vendors = v.data || vendors;
    el.innerHTML = `<p class="muted small">Supplier POs for group buys. Kept apart from your store POs, so they never change your stock, reorder suggestions or costs. One is saved each time you place a group order.</p>
${pos.length ? `<div class="gbox">${pos.map(po => `<button type="button" class="gcard${po.status === "arrived" ? " placed" : po.status === "cancelled" ? " closed" : ""}" data-popen="${esc(po.id)}" style="text-align:left;width:100%;color:inherit;font:inherit"><div><span class="kick">${esc(dDay(po.ordered_at))}</span><b>${esc(po.po_number)} · ${esc(po.vendor_name || "Supplier not set")}</b><small>${poKits(po)} kits · ${money(poTotal(po))}${po.tracking ? ` · ${esc(po.tracking)}` : ""}</small></div>${poChip(po)}</button>`).join("")}</div>` : `<div class="nalbox"><p class="muted small" style="margin:0">No group buy POs yet. Place a group order and its PO lands here.</p></div>`}`;
    if (!el.dataset.pobound) { el.dataset.pobound = "1"; el.addEventListener("click", e => { const o = e.target.closest("[data-popen]"); if (o) openPO(o.dataset.popen); }); }
  }
  async function openPO(id) {
    const { data: po, error } = await db().from("ppu_group_pos").select("*").eq("id", id).single(); if (error) return P.toast(error.message);
    if (!vendors.length) vendors = (await db().from("vendors").select("id,company_name").order("company_name")).data || [];
    let lines = (po.lines || []).map(l => ({ ...l }));
    const w = P.sheet(`<form class="pmform" data-poform novalidate><h2 class="serif">${esc(po.po_number)} ${poChip(po)}</h2><p class="muted small">Group buy PO · ordered ${esc(dDay(po.ordered_at))}${po.shipped_at ? ` · shipped ${esc(P.fmtDate(po.shipped_at))}` : ""}${po.arrived_at ? ` · arrived ${esc(P.fmtDate(po.arrived_at))}` : ""}</p>
<label>Supplier<select name="vendor"><option value="">Not set</option>${vendors.map(v => `<option value="${esc(v.id)}"${v.id === po.vendor_id ? " selected" : ""}>${esc(v.company_name)}</option>`).join("")}</select></label>
<div class="gob" data-polines></div>
<div class="pm2"><label>Shipping &amp; fees ($)<input name="shipping" type="number" min="0" step="0.01" inputmode="decimal" value="${Number(po.shipping || 0) ? Number(po.shipping).toFixed(2) : ""}"></label><label>Carrier<input name="carrier" maxlength="40" value="${esc(po.carrier || "")}" placeholder="e.g. DHL"></label></div>
<label>Tracking number<input name="tracking" maxlength="80" value="${esc(po.tracking || "")}" autocapitalize="characters"></label>
<label>Notes<textarea name="notes" rows="2" maxlength="500">${esc(po.notes || "")}</textarea></label>
<div class="pinvb" style="flex-wrap:wrap;margin:10px 0">${po.status === "ordered" ? `<button class="btn ghost sm" type="button" data-post="shipped">Mark shipped</button>` : ""}${["ordered", "shipped"].includes(po.status) ? `<button class="btn ghost sm" type="button" data-post="arrived">Mark arrived</button>` : ""}${po.status !== "cancelled" && po.status !== "arrived" ? `<button class="btn ghost sm" type="button" data-post="cancelled" style="color:var(--bad)">Cancel PO</button>` : `<button class="btn ghost sm" type="button" data-post="ordered">Reopen</button>`}</div>
<button class="btn primary wide" type="submit">Save</button><button class="btn ghost wide" type="button" data-poprint style="margin-top:8px">Print PO</button>${po.group_id ? `<button class="btn ghost wide" type="button" data-pogroup style="margin-top:8px">Open the group order</button>` : ""}<p class="status" data-post2 role="status"></p></form>`, { label: po.po_number });
    const f = $("[data-poform]", w), st = $("[data-post2]", w);
    const drawLines = () => { const tmp = { lines, shipping: Number(f.shipping.value || 0) };
      $("[data-polines]", w).innerHTML = `<div style="margin:10px 0">${lines.map((l, i) => `<div class="r"><span><b>${esc(l.name)} ${esc(l.amount || "")}</b><small>${esc(l.sku || "no SKU")} · ${l.kits} kit${l.kits == 1 ? "" : "s"}</small></span><label class="small" style="display:flex;align-items:center;gap:6px;flex:none">$/kit<input type="number" min="0" step="0.01" inputmode="decimal" data-pocost="${i}" value="${l.kit_cost != null ? Number(l.kit_cost).toFixed(2) : ""}" placeholder="—" style="width:84px"></label></div>`).join("")}<div class="r"><span>Total (${poKits(tmp)} kits)</span><b>${money(poTotal(tmp))}</b></div></div>`; };
    drawLines();
    f.addEventListener("input", e => { const c = e.target.closest("[data-pocost]"); if (c) { const v = c.value === "" ? null : Math.round(Number(c.value) * 100) / 100; lines[Number(c.dataset.pocost)].kit_cost = v; } if (c || e.target.name === "shipping") { const pos2 = e.target.selectionStart; const name = e.target.name, idx = c?.dataset.pocost; drawLines(); const back = idx != null ? $(`[data-pocost="${idx}"]`, w) : f[name]; back?.focus(); try { back?.setSelectionRange(pos2, pos2); } catch {} } });
    f.vendor.addEventListener("change", async () => { const c = await costsFor(f.vendor.value, lines.map(l => l.sku).filter(Boolean)); lines = lines.map(l => ({ ...l, kit_cost: c[String(l.sku).toUpperCase()] ?? null })); drawLines(); st.textContent = f.vendor.value ? "Costs filled from this supplier's price list. Save to keep them." : ""; st.className = "status"; });
    const row = () => { const v = vendors.find(x => x.id === f.vendor.value); return { vendor_id: v?.id || null, vendor_name: v?.company_name || null, lines, shipping: Math.round(Number(f.shipping.value || 0) * 100) / 100, carrier: f.carrier.value.trim() || null, tracking: f.tracking.value.trim() || null, notes: f.notes.value.trim() || null, updated_at: new Date().toISOString() }; };
    const save = async extra => { const { data, error } = await db().from("ppu_group_pos").update({ ...row(), ...extra }).eq("id", po.id).select("*").single(); if (error) throw error; return data; };
    f.addEventListener("submit", async e => { e.preventDefault(); try { await save({}); P.toast("PO saved"); P.closeSheet(); refreshPO(); } catch (err) { st.textContent = err.message; st.className = "status bad"; } });
    w.addEventListener("click", async e => {
      const s2 = e.target.closest("[data-post]"); if (s2) { const to = s2.dataset.post; if (to === "cancelled" && !confirm(`Cancel ${po.po_number}?`)) return; s2.disabled = true;
        try { await save({ status: to, ...(to === "shipped" ? { shipped_at: new Date().toISOString() } : {}), ...(to === "arrived" ? { arrived_at: new Date().toISOString() } : {}), ...(to === "ordered" ? { arrived_at: null } : {}) }); P.toast(`${po.po_number}: ${PO_ST[to][0]}`); P.closeSheet(); refreshPO(); } catch (err) { st.textContent = err.message; st.className = "status bad"; s2.disabled = false; } return; }
      if (e.target.closest("[data-poprint]")) return printSavedPO({ ...po, ...row() }); // prints what's on screen; Safari needs print() inside the tap
      if (e.target.closest("[data-pogroup]")) { P.closeSheet(); if (host && document.body.contains(host)) { await loadList().catch(() => {}); openBoard(po.group_id); } else P.toast("Open Partner program → Group orders to see it."); }
    });
  }
  function refreshPO() { if (poHost && document.body.contains(poHost)) poPane(poHost); if (board?.po && host && document.body.contains(host)) openBoard(board.g.id); }

  async function onClick(e) {
    const t = e.target, b = sel => t.closest(sel);
    if (b("[data-gnew]")) return edit(null);
    if (b("[data-gboard]")) return openBoard(b("[data-gboard]").dataset.gboard);
    if (b("[data-popen]")) return openPO(b("[data-popen]").dataset.popen);
    if (b("[data-glist]")) { cur = null; await loadList().catch(() => {}); return drawList(); }
    if (!board) return;
    const g = board.g, busy = async (el, fn) => { el.disabled = true; try { await fn(); } catch (err) { P.toast(err.message || "Something went wrong"); } el.disabled = false; };
    if (b("[data-gedit]")) return edit(g);
    if (b("[data-gcopy]")) { try { await navigator.clipboard.writeText(groupMsg(g)); P.toast("Copied. Paste it anywhere."); } catch { P.toast(LINK(g.id)); } return; }
    if (b("[data-gmail]")) return busy(b("[data-gmail]"), async () => { if (g.announced_at && !confirm("Email every Runner and Vendor about this group order again?")) return; const s = await callMail("announce", g.id); P.toast(`Emailed ${s.filter(x => x.ok).length} partner${s.length === 1 ? "" : "s"}`); await loadList(); openBoard(g.id); });
    if (b("[data-gremind]")) return busy(b("[data-gremind]"), async () => { if (!confirm("Send the reminder email to every Runner and Vendor now?")) return; const s = await callMail("remind", g.id); P.toast(`Reminder sent to ${s.filter(x => x.ok).length}`); await loadList(); openBoard(g.id); });
    if (b("[data-gplaced]")) return busy(b("[data-gplaced]"), async () => { if (!confirm("Send each partner their payment email again?")) return; const s = await callMail("placed", g.id); P.toast(`Sent ${s.filter(x => x.ok).length} payment email${s.length === 1 ? "" : "s"}`); });
    if (b("[data-gpo]")) return printPO();
    if (b("[data-gsavepo]")) return busy(b("[data-gsavepo]"), async () => { const po = await savePO(g); P.toast(`Saved ${po.po_number}`); openBoard(g.id); });
    if (b("[data-gcancel]")) return busy(b("[data-gcancel]"), async () => { if (!confirm("Cancel this group order? Partners won't be able to add to it. Nobody is emailed.")) return; const { error } = await db().from("ppu_group_orders").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", g.id); if (error) throw error; P.toast("Cancelled"); await loadList(); openBoard(g.id); });
    if (b("[data-gsubmit]")) return busy(b("[data-gsubmit]"), async () => {
      const n = byPartner().filter(r => r.n).length; if (!confirm(`Place the group order now?\n\n${n} partner order${n === 1 ? "" : "s"} will be created, awaiting payment, and each partner gets an email with their total and how to pay. Partners can't change their kits after this.`)) return;
      const { data, error } = await db().rpc("ppu_group_submit", { p_group: g.id }); if (error) throw error;
      let sent = 0; try { sent = (await callMail("placed", g.id)).filter(x => x.ok).length; } catch (er) { P.toast(`Placed, but the payment emails didn't go: ${er.message}. Use "Resend payment emails".`); }
      let po = null; try { po = await savePO(g); } catch (er) { P.toast(`Placed, but the group buy PO didn't save: ${er.message}. Use "Save the group buy PO".`); }
      if (sent) P.toast(`Placed: ${(data || []).length} order${(data || []).length === 1 ? "" : "s"} · ${sent} payment email${sent === 1 ? "" : "s"} sent${po ? ` · ${po.po_number} saved` : ""}`);
      await loadList(); openBoard(g.id);
    });
  }
  async function onChange(e) {
    if (!e.target.matches("[data-gvendor]") || !board) return;
    const vid = e.target.value || null; const { error } = await db().from("ppu_group_orders").update({ supplier_vendor_id: vid }).eq("id", board.g.id);
    if (error) return P.toast(error.message); board.g.supplier_vendor_id = vid; await loadCosts(vid); drawBoard();
  }
  function bind(el) { el.addEventListener("click", onClick); el.addEventListener("change", onChange); }
  window.PPUGroupOwner = { poPane, openPO, pane: el => { if (!el.dataset.gbound) { bind(el); el.dataset.gbound = "1"; } return pane(el); } };
})();
