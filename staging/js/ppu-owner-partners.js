/* Patriot Peptides USA · Owner app → More → Partner program (v1, Oct 31 2026).
   Partners are people Jeff sells to (not his suppliers): Tier 1 Promoter (10% code), Tier 2 Runner and Tier 3 Vendor (own price sheets).
   Changing a partner's tier switches their price sheet the next time their portal loads. Price sheets are locked on the server:
   only Jeff and active partners of that tier can read them. */
(() => {
  const P = window.PST, esc = P.esc, money = P.money;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const PORTAL = "https://www.patriotpeptides-usa.com/vendor.html";
  let host = null, tab = "people", tiers = [], people = [], prices = [], tierPick = 2, tierFilter = 0, q = "";
  const tierName = id => tiers.find(t => t.id === id)?.name || `Tier ${id}`;
  const db = () => P.client();

  async function load() {
    const [t, p, s] = await Promise.all([db().from("ppu_partner_tiers").select("*").order("id"), db().from("ppu_partners").select("*").order("created_at", { ascending: false }),
      db().from("ppu_partner_prices").select("*").order("sort").order("name")]);
    const err = t.error || p.error || s.error; if (err) throw err;
    tiers = t.data || []; people = p.data || []; prices = s.data || [];
    if (!tiers.some(x => x.id === tierPick && x.has_prices)) tierPick = (tiers.find(x => x.has_prices) || {}).id || 2;
  }

  async function pane(el) {
    host = el; el.innerHTML = `<p class="muted small">Loading…</p>`;
    try { await load(); } catch (err) { el.innerHTML = `<p class="notice err">${esc(/relation|does not exist/i.test(err.message) ? "The partner program isn't switched on yet (server update pending)." : err.message)}</p>`; return; }
    draw();
  }
  function draw() {
    host.innerHTML = `<div class="oseg two" role="tablist"><button type="button" role="tab" aria-selected="${tab === "people"}" class="${tab === "people" ? "on" : ""}" data-ptab="people">Partners</button><button type="button" role="tab" aria-selected="${tab === "sheets"}" class="${tab === "sheets" ? "on" : ""}" data-ptab="sheets">Price sheets</button></div><div data-pbody></div>`;
    tab === "people" ? drawPeople() : drawSheets();
    host.onclick = onClick; host.onchange = onChange; host.oninput = onInput;
  }

  /* ---------- partners ---------- */
  const statusOf = p => p.status === "paused" ? ["Paused", "warn"] : p.user_id ? ["Signed in", "ok"] : ["Invited", "pend"];
  function drawPeople() {
    const list = people.filter(p => !tierFilter || p.tier === tierFilter);
    $("[data-pbody]", host).innerHTML = `<div class="pmtop"><p class="muted small" style="margin:0;flex:1">${people.length} partner${people.length === 1 ? "" : "s"}. Their tier sets what they see when they sign in at the vendor portal.</p><button class="btn primary sm" type="button" data-padd>+ Add partner</button></div>
<div class="schips" role="tablist">${[[0, "All"], ...tiers.map(t => [t.id, t.name])].map(([id, n]) => `<button type="button" class="${tierFilter === id ? "on" : ""}" data-pfilter="${id}">${esc(n)} <small>${id ? people.filter(p => p.tier === id).length : people.length}</small></button>`).join("")}</div>
${list.length ? `<div class="pmlist">${list.map(p => { const [s, k] = statusOf(p); return `<div class="pmrow"><button type="button" class="pmmain" data-pedit="${esc(p.id)}"><span class="ptier t${p.tier}">${p.tier}</span><span><b>${esc(p.name || p.email)}${p.company ? ` <span class="muted">· ${esc(p.company)}</span>` : ""}</b><small>${esc(tierName(p.tier))} · ${esc(p.email)}${p.tier === 1 && p.discount_code ? ` · code ${esc(p.discount_code)}` : ""}</small></span></button><span class="opill ${k}">${s}</span></div>`; }).join("")}</div>`
  : `<div class="nalbox"><p class="muted small" style="margin:0">${people.length ? "No partners in this tier yet." : "No partners yet. Add one, then send them the invite: they sign in with the same email and their tier's pricing is waiting."}</p></div>`}`;
  }

  function invite(p) {
    const first = String(p.name || "").split(/\s+/)[0], t = tierName(p.tier);
    return p.tier === 1
      ? `Hi${first ? " " + first : ""}, you're set up as a Patriot Peptides USA ${t}. Your 10% code is ${p.discount_code || "(coming soon)"}. Sign in with ${p.email} at ${PORTAL} to see it any time.`
      : `Hi${first ? " " + first : ""}, you're set up as a Patriot Peptides USA ${t}. Sign in with ${p.email} at ${PORTAL} to see your pricing and place orders.`;
  }

  function editPerson(id) {
    const p = people.find(x => x.id === id), isNew = !p, v = p || { tier: 2, status: "active" };
    const w = P.sheet(`<form class="pmform" data-pform novalidate><h2 class="serif">${isNew ? "Add a partner" : esc(v.name || v.email)}</h2>
<div class="pm2"><label>Name<input name="name" maxlength="80" value="${esc(v.name || "")}" placeholder="First and last"></label><label>Business <span class="muted small">(optional)</span><input name="company" maxlength="80" value="${esc(v.company || "")}"></label></div>
<div class="pm2"><label>Email<input name="email" type="email" required autocomplete="off" autocapitalize="off" value="${esc(v.email || "")}" placeholder="They sign in with this"></label><label>Phone <span class="muted small">(optional)</span><input name="phone" type="tel" inputmode="tel" value="${esc(v.phone || "")}"></label></div>
<p class="kick" style="margin:12px 0 6px">Tier</p><div class="oseg three" role="radiogroup" aria-label="Tier" data-tierpick>${tiers.map(t => `<button type="button" role="radio" aria-checked="${t.id === v.tier}" class="${t.id === v.tier ? "on" : ""}" data-tier="${t.id}">${t.id} · ${esc(t.name)}</button>`).join("")}</div>
<div data-codebox${v.tier === 1 ? "" : " hidden"}><label>Their 10% discount code<input name="code" maxlength="30" autocapitalize="characters" value="${esc(v.discount_code || "")}" placeholder="e.g. MIKE10"></label><p class="muted small" style="margin:-4px 0 8px">If the code doesn't exist yet, it's created as 10% off for anyone who uses it.</p></div>
<label>Notes <span class="muted small">(only you see these)</span><textarea name="notes" rows="2">${esc(v.notes || "")}</textarea></label>
<label class="toggle"><input type="checkbox" name="active"${v.status !== "paused" ? " checked" : ""}> Active <span class="muted small">(off = paused: they can't see pricing or order)</span></label>
<button class="btn primary wide" type="submit">${isNew ? "Add partner" : "Save"}</button>
${isNew ? "" : `<div class="pinv"><p class="kick" style="margin:14px 0 6px">Invite</p><p class="small muted" data-invtext>${esc(invite(v))}</p><div class="pinvb">${v.phone ? `<a class="btn ghost sm" href="sms:${esc(String(v.phone).replace(/[^\d+]/g, ""))}${/iphone|ipad/i.test(navigator.userAgent) ? "&" : "?"}body=${encodeURIComponent(invite(v))}">Text it</a>` : ""}<a class="btn ghost sm" href="mailto:${esc(v.email)}?subject=${encodeURIComponent("Your Patriot Peptides USA partner account")}&body=${encodeURIComponent(invite(v))}">Email it</a><button class="btn ghost sm" type="button" data-pcopy>Copy</button></div></div>
<button class="btn ghost wide danger" type="button" data-pdel style="margin-top:16px">Remove partner</button>`}
<p class="status" data-pst role="status"></p></form>`, { label: isNew ? "Add a partner" : "Edit partner" });
    const f = $("form", w), st = $("[data-pst]", w); let tier = v.tier;
    w.addEventListener("click", async e => {
      const tb = e.target.closest("[data-tier]"), cp = e.target.closest("[data-pcopy]"), del = e.target.closest("[data-pdel]");
      if (tb) { tier = Number(tb.dataset.tier); $$("[data-tier]", w).forEach(b => { const on = Number(b.dataset.tier) === tier; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); }); $("[data-codebox]", w).hidden = tier !== 1; }
      if (cp) { try { await navigator.clipboard.writeText(invite({ ...v, tier })); P.toast("Invite copied"); } catch { P.toast("Couldn't copy. Press and hold the text instead."); } }
      if (del) { if (!confirm(`Remove ${v.name || v.email} from the partner program? Their past orders stay.`)) return;
        const { error } = await db().from("ppu_partners").delete().eq("id", v.id); if (error) { st.textContent = error.message; st.className = "status bad"; return; }
        P.toast("Partner removed"); P.closeSheet(); await load(); draw(); }
    });
    f.addEventListener("submit", async e => {
      e.preventDefault(); const bad = m => { st.textContent = m; st.className = "status bad"; };
      const email = f.email.value.trim().toLowerCase(), code = f.code.value.trim().toUpperCase().replace(/\s+/g, "");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad("Enter a valid email. It's how they sign in.");
      if (people.some(x => x.email.toLowerCase() === email && x.id !== v.id)) return bad("That email is already a partner.");
      if (tier === 1 && !code) return bad("Add their discount code.");
      if (code && !/^[A-Z0-9_-]{3,30}$/.test(code)) return bad("Codes are 3–30 letters or numbers.");
      const btn = $("[type=submit]", f); btn.disabled = true; st.textContent = "Saving…"; st.className = "status";
      try {
        if (tier === 1 && code) {
          const ex = await db().from("discount_codes").select("id,code,active").ilike("code", code).limit(1);
          if (!ex.data?.length) { const r = await db().from("discount_codes").insert({ code, discount_type: "percent", percent_off: 10, active: true, one_time_use: false, promotion_title: `Promoter: ${f.name.value.trim() || email}`, created_by: "partner program" }); if (r.error) throw new Error(`Saved partner info, but the code didn't save: ${r.error.message}`); }
        }
        const row = { email, name: f.name.value.trim() || null, company: f.company.value.trim() || null, phone: f.phone.value.trim() || null, tier, discount_code: tier === 1 ? code : (v.discount_code || null),
          notes: f.notes.value.trim() || null, status: f.active.checked ? "active" : "paused", updated_at: new Date().toISOString() };
        const r = isNew ? await db().from("ppu_partners").insert(row).select().single() : await db().from("ppu_partners").update(row).eq("id", v.id).select().single();
        if (r.error) throw r.error;
        P.toast(isNew ? "Partner added. Send them the invite." : v.tier !== tier ? `Moved to ${tierName(tier)}. Their pricing switches next time they open the portal.` : "Saved");
        P.closeSheet(); await load(); draw(); if (isNew) editPerson(r.data.id);
      } catch (err) { bad(err.message || "Couldn't save."); btn.disabled = false; }
    });
  }

  /* ---------- price sheets ---------- */
  function drawSheets() {
    const pt = tiers.filter(t => t.has_prices), list = prices.filter(x => x.tier === tierPick), shown = list.filter(x => !q || `${x.name} ${x.amount} ${x.sku}`.toLowerCase().includes(q));
    const on = list.filter(x => x.active).length;
    $("[data-pbody]", host).innerHTML = `<div class="oseg ${pt.length === 2 ? "two" : "three"}" role="tablist" aria-label="Which price sheet">${pt.map(t => `<button type="button" class="${t.id === tierPick ? "on" : ""}" data-psheet="${t.id}">Tier ${t.id} · ${esc(t.name)}</button>`).join("")}</div>
<div class="pmtop"><p class="muted small" style="margin:0;flex:1">${on} of ${list.length} items showing to ${esc(tierName(tierPick))}s. Changes save as you go.</p><button class="btn primary sm" type="button" data-pnew>+ Add item</button></div>
<div class="pmtop"><input class="psearch" type="search" data-psearch placeholder="Search this sheet" value="${esc(q)}" aria-label="Search price sheet"><button class="btn ghost sm" type="button" data-pbulk>Adjust all</button></div>
<div class="psheet">${shown.map(x => `<div class="prow${x.active ? "" : " off"}" data-prow="${esc(x.id)}"><span class="ptx"><b>${esc(x.name)}</b><small>${esc(x.amount || "")}${x.sku ? ` · ${esc(x.sku)}` : ""}</small></span>
<label class="pprice"><span class="sr">Price for ${esc(x.name)} ${esc(x.amount || "")}</span>$<input type="number" step="0.01" min="0" inputmode="decimal" value="${Number(x.price).toFixed(2)}" data-pprice="${esc(x.id)}"></label>
<button type="button" class="pmlive" role="switch" aria-checked="${x.active}" data-pon="${esc(x.id)}" aria-label="Show ${esc(x.name)} ${esc(x.amount || "")} on this sheet"><i></i><span>${x.active ? "On" : "Off"}</span></button>
<button type="button" class="prm" data-prm="${esc(x.id)}" aria-label="Remove ${esc(x.name)} ${esc(x.amount || "")}">${P.icon("x", 16)}</button></div>`).join("") || `<p class="muted small">${list.length ? "Nothing matches." : "This sheet is empty. Add items with + Add item."}</p>`}</div><p class="status" data-pst2 role="status"></p>`;
  }
  const say = (m, good) => { const s = $("[data-pst2]", host); if (s) { s.textContent = m; s.className = `status ${good ? "good" : "bad"}`; } };

  function addItem() {
    const other = tiers.filter(t => t.has_prices && t.id !== tierPick);
    const w = P.sheet(`<form class="pmform" novalidate><h2 class="serif">Add to the ${esc(tierName(tierPick))} sheet</h2>
<label>Product<input name="name" required maxlength="80" placeholder="e.g. BPC-157"></label>
<div class="pm2"><label>Amount<input name="amount" maxlength="20" placeholder="10mg"></label><label>SKU <span class="muted small">(optional)</span><input name="sku" maxlength="20" autocapitalize="characters" placeholder="BC10"></label></div>
<div class="pm2"><label>${esc(tierName(tierPick))} price<input name="price" type="number" step="0.01" min="0" inputmode="decimal" required></label>${other.map(t => `<label>${esc(t.name)} price <span class="muted small">(optional)</span><input name="p${t.id}" type="number" step="0.01" min="0" inputmode="decimal"></label>`).join("")}</div>
<button class="btn primary wide" type="submit">Add</button><p class="status" role="status" data-ast></p></form>`, { label: "Add item" });
    const f = $("form", w), st = $("[data-ast]", w);
    f.addEventListener("submit", async e => {
      e.preventDefault(); const name = f.name.value.trim(), price = Number(f.price.value);
      if (!name || !(price >= 0) || f.price.value === "") { st.textContent = "Add the product and its price."; st.className = "status bad"; return; }
      const sku = (f.sku.value.trim().toUpperCase() || `${name}-${f.amount.value}`.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 20)) || ("ITEM" + Date.now());
      const mk = (tier, pr) => ({ tier, sku, name, amount: f.amount.value.trim() || null, price: Math.round(pr * 100) / 100, active: true, sort: prices.filter(x => x.tier === tier).length });
      const rowsIn = [mk(tierPick, price), ...other.filter(t => f[`p${t.id}`].value !== "").map(t => mk(t.id, Number(f[`p${t.id}`].value)))];
      const { error } = await db().from("ppu_partner_prices").insert(rowsIn);
      if (error) { st.textContent = /duplicate|unique/i.test(error.message) ? "That SKU is already on this sheet." : error.message; st.className = "status bad"; return; }
      P.toast(`Added to ${rowsIn.length} sheet${rowsIn.length === 1 ? "" : "s"}`); P.closeSheet(); await load(); draw();
    });
  }

  function bulk() {
    const w = P.sheet(`<form class="pmform" novalidate><h2 class="serif">Adjust every ${esc(tierName(tierPick))} price</h2><p class="muted small">Adds or takes off the same dollar amount on every item on this sheet. Use a minus sign to lower prices.</p>
<label>Change each price by ($)<input name="d" type="number" step="0.01" inputmode="decimal" placeholder="e.g. 5 or -5" required></label><button class="btn primary wide" type="submit">Apply</button><p class="status" role="status" data-bst></p></form>`, { label: "Adjust prices" });
    const f = $("form", w), st = $("[data-bst]", w);
    f.addEventListener("submit", async e => {
      e.preventDefault(); const d = Number(f.d.value); if (!d) { st.textContent = "Enter an amount."; st.className = "status bad"; return; }
      const list = prices.filter(x => x.tier === tierPick); if (!confirm(`${d > 0 ? "Raise" : "Lower"} ${list.length} prices by ${money(Math.abs(d))}?`)) return;
      st.textContent = "Updating…"; st.className = "status"; const now = new Date().toISOString();
      for (const x of list) { const { error } = await db().from("ppu_partner_prices").update({ price: Math.max(0, Math.round((Number(x.price) + d) * 100) / 100), updated_at: now }).eq("id", x.id); if (error) { st.textContent = error.message; st.className = "status bad"; return; } }
      P.toast("Prices updated"); P.closeSheet(); await load(); draw();
    });
  }

  async function onClick(e) {
    const t = e.target.closest("[data-ptab]"), add = e.target.closest("[data-padd]"), ed = e.target.closest("[data-pedit]"), fl = e.target.closest("[data-pfilter]"),
      sh = e.target.closest("[data-psheet]"), nw = e.target.closest("[data-pnew]"), bk = e.target.closest("[data-pbulk]"), on = e.target.closest("[data-pon]"), rm = e.target.closest("[data-prm]");
    if (t) { tab = t.dataset.ptab; draw(); }
    else if (add) editPerson(null); else if (ed) editPerson(ed.dataset.pedit);
    else if (fl) { tierFilter = Number(fl.dataset.pfilter); drawPeople(); }
    else if (sh) { tierPick = Number(sh.dataset.psheet); drawSheets(); }
    else if (nw) addItem(); else if (bk) bulk();
    else if (on) { const x = prices.find(p => p.id === on.dataset.pon), want = !x.active; on.disabled = true;
      const { error } = await db().from("ppu_partner_prices").update({ active: want, updated_at: new Date().toISOString() }).eq("id", x.id); on.disabled = false;
      if (error) return say(error.message); x.active = want; drawSheets(); }
    else if (rm) { const x = prices.find(p => p.id === rm.dataset.prm); if (!confirm(`Remove ${x.name} ${x.amount || ""} from the ${tierName(x.tier)} sheet?`)) return;
      const { error } = await db().from("ppu_partner_prices").delete().eq("id", x.id); if (error) return say(error.message);
      prices = prices.filter(p => p.id !== x.id); drawSheets(); P.toast("Removed"); }
  }
  async function onChange(e) {
    const i = e.target.closest("[data-pprice]"); if (!i) return; const x = prices.find(p => p.id === i.dataset.pprice), v = Math.round(Number(i.value) * 100) / 100;
    if (!(v >= 0) || i.value === "") { i.value = Number(x.price).toFixed(2); return say("Prices can't be blank."); }
    if (v === Number(x.price)) return;
    const { error } = await db().from("ppu_partner_prices").update({ price: v, updated_at: new Date().toISOString() }).eq("id", x.id);
    if (error) { i.value = Number(x.price).toFixed(2); return say(error.message); }
    x.price = v; i.value = v.toFixed(2); say(`${x.name} ${x.amount || ""}: ${money(v)} saved`, true);
  }
  function onInput(e) { if (e.target.matches("[data-psearch]")) { q = e.target.value.trim().toLowerCase(); const pos = e.target.selectionStart; drawSheets(); const s = $("[data-psearch]", host); s.focus(); try { s.setSelectionRange(pos, pos); } catch {} } }

  window.PPUPartnersOwner = { pane };
})();
