/* Patriot Peptides USA · Build-A-Kit (v1.0)
   Pick a 3-vial (5% off) or 5-vial (10% off) kit, then drag vials into the kit slots, or tap + to drop one in the next
   open slot. Tap or drag a filled slot back out to remove it. "Add kit to bag" puts the vials in the bag, where the same
   kit rule (kitInfo in pst-core.js) applies the discount at checkout. Works with a finger or a mouse (pointer events). */
(() => {
  const P = window.PST, $ = s => document.querySelector(s), esc = P.esc, money = P.money;
  const SIZES = [[3, .05, "3-Vial Kit"], [5, .10, "5-Vial Kit"]];
  let size = Number(P.params.get("size")) === 5 ? 5 : 3, slots = [], all = [], q = "", f = "";
  const eligible = p => p && p.is_active !== false && !/^suppl|wholesale/i.test(p.category || "") && !/10-vial/i.test(p.strength || "") && !String(p.admin_only || "").trim();
  const byKey = k => all.find(p => p.product_key === k);
  const used = k => slots.filter(x => x === k).length;
  const left = p => Math.max(0, P.qty(p) - used(p.product_key) - (P.readCart().find(i => i.key === p.product_key)?.quantity || 0));

  function render() {
    const root = $("[data-kit]"); if (!root) return;
    root.innerHTML = `<div class="kitsize" role="radiogroup" aria-label="Kit size">${SIZES.map(([n, pct, l]) => `<button type="button" role="radio" aria-checked="${size === n}" class="${size === n ? "on" : ""}" data-size="${n}"><b>${l}</b><span>${Math.round(pct * 100)}% off</span></button>`).join("")}</div>
<section class="kitbox" data-box aria-label="Your kit"><div class="kitslots" data-slots></div><div class="kitsum" data-sum></div></section>
<div class="kitfind"><input class="psearch" type="search" placeholder="Search peptides" aria-label="Search peptides" data-q value="${esc(q)}">
<div class="schips" role="tablist">${[["", "All"], ["performance", "Performance"], ["recovery", "Recovery"], ["longevity", "Longevity"], ["blend", "Blends"]].map(([k, l]) => `<button type="button" class="${f === k ? "on" : ""}" data-f="${k}">${l}</button>`).join("")}</div>
<p class="muted small kithint">Drag a vial into your kit, or tap <b>+</b>. Tap a vial in your kit to take it out.</p></div>
<div class="kitlist" data-list></div>`;
    drawSlots(); drawList();
  }
  function drawSlots() {
    slots = slots.slice(0, size); while (slots.length < size) slots.push(null);
    $("[data-slots]").style.setProperty("--n", size);
    $("[data-slots]").innerHTML = slots.map((k, i) => { const p = k && byKey(k);
      return p ? `<button type="button" class="kslot full" data-slot="${i}" aria-label="Remove ${esc(p.display_name)} ${esc(p.strength || "")} from your kit" title="${esc(P.titleParts(p).main)} ${esc(p.strength || "")}">${P.vial(p, 36)}<small>${esc(String(P.titleParts(p).main).replace(/^PP-/, ""))}<br>${esc(p.strength || "")}</small><i aria-hidden="true">×</i></button>`
        : `<div class="kslot" data-slot="${i}" aria-label="Empty slot ${i + 1}"><span class="kslot-n">${i + 1}</span></div>`; }).join("");
    const picked = slots.filter(Boolean).map(byKey), sub = picked.reduce((s, p) => s + P.unitPrice(p), 0), pct = SIZES.find(([n]) => n === size)[1], full = picked.length === size;
    const save = P.round(sub * pct), need = size - picked.length;
    $("[data-sum]").innerHTML = `<div class="kline"><span>${picked.length}/${size} vials${picked.length ? ` · ${money(sub)}` : ""}</span><b>${full ? `Save ${money(save)}` : `${Math.round(pct * 100)}% off when full`}</b></div>
<div class="kbtns"><button type="button" class="btn primary" data-add ${full ? "" : "disabled"}>${full ? `Add kit to bag · ${money(sub - save)}` : `Add ${need} more vial${need === 1 ? "" : "s"}`}</button>${picked.length ? `<button type="button" class="btn ghost kitclear" data-clear aria-label="Clear kit">Clear</button>` : ""}</div>`;
  }
  function drawList() {
    const term = q.trim().toLowerCase();
    const rows = all.filter(eligible).filter(p => !term || `${p.display_name} ${p.strength} ${p.label_line_1 || ""}`.toLowerCase().includes(term))
      .filter(p => !f || (f === "blend" ? P.isBlend(p) : P.focuses(p).includes(f))).sort(P.cmpProduct);
    $("[data-list]").innerHTML = rows.length ? rows.map(p => { const n = left(p), ok = n > 0;
      return `<div class="krow${ok ? "" : " out"}" data-key="${esc(p.product_key)}"><span class="kdrag" ${ok ? 'data-drag aria-hidden="true"' : ""}>${P.vial(p, 40)}</span>
<span class="kinfo"><b>${esc(P.titleParts(p).main)}</b><small>${esc(p.strength || "")} · ${money(P.unitPrice(p))}${ok ? (P.CFG.showStock && n <= 3 ? ` · ${n} left` : "") : " · Sold out"}</small></span>
<button type="button" class="kadd" data-addone="${esc(p.product_key)}" ${ok ? "" : "disabled"} aria-label="Add ${esc(p.display_name)} ${esc(p.strength || "")} to your kit">+</button></div>`; }).join("")
      : `<p class="empty">Nothing matches. Try another search.</p>`;
  }
  function put(key, at = -1) {
    const p = byKey(key); if (!p) return;
    if (left(p) <= 0) { P.toast?.("That one's out of stock right now"); return; }
    let i = at >= 0 && !slots[at] ? at : slots.indexOf(null);
    if (i < 0) { P.toast?.(`Your ${size}-vial kit is full. Tap a vial to swap it out.`); bump(); return; }
    slots[i] = key; drawSlots(); drawList(); pulse(i); P.track?.("kit_add", { key });
  }
  const pulse = i => { const el = document.querySelector(`[data-slot="${i}"]`); el?.classList.add("pop"); setTimeout(() => el?.classList.remove("pop"), 380); };
  const bump = () => { const b = $("[data-box]"); b?.classList.add("shake"); setTimeout(() => b?.classList.remove("shake"), 420); };
  function addToBag() {
    const ks = slots.filter(Boolean); if (ks.length !== size) return;
    ks.forEach(k => P.addToCart(k, 1)); slots = []; P.toast?.(`Kit added: ${size} vials, ${size === 5 ? "10" : "5"}% off at checkout`);
    setTimeout(() => { location.href = "cart.html"; }, 650);
  }

  /* ---- drag and drop with pointer events (touch + mouse). Only the vial thumbnail starts a drag, so the list still scrolls. ---- */
  let drag = null;
  function startDrag(e, key, fromSlot = -1) {
    const p = byKey(key); if (!p) return;
    const src = e.target.closest("[data-key], .kslot")?.querySelector("img.vial")?.src;
    const g = document.createElement("div"); g.className = "kghost"; document.body.appendChild(g);
    if (src && !src.startsWith("data:image/gif")) g.innerHTML = `<img class="vial" src="${src}" alt="">`;
    else { g.innerHTML = `<span class="kghost-ph"></span>`; P.vialCanvas(p, .8).then(c => { c.className = "vial"; if (g.isConnected) g.replaceChildren(c); }).catch(() => {}); } // bottle not drawn yet: draw one for the finger
    drag = { key, fromSlot, g, id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false };
    move(e); document.body.classList.add("kdragging");
  }
  function move(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) > 6) drag.moved = true;
    drag.g.style.transform = `translate3d(${e.clientX - 32}px,${e.clientY - 70}px,0) rotate(-4deg)`;
    document.querySelectorAll(".kslot.hover").forEach(s => s.classList.remove("hover"));
    const t = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-slot]"); if (t) t.classList.add("hover");
    const box = $("[data-box]"); box?.classList.toggle("target", !!document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-box]"));
    // keep the kit in reach on a phone: scroll toward the top while dragging near it
    if (e.clientY < 90) window.scrollBy(0, -12);
  }
  function drop(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null; d.g.remove(); document.body.classList.remove("kdragging");
    document.querySelectorAll(".kslot.hover").forEach(s => s.classList.remove("hover")); $("[data-box]")?.classList.remove("target");
    const under = document.elementFromPoint(e.clientX, e.clientY), slot = under?.closest("[data-slot]"), inBox = under?.closest("[data-box]");
    if (d.fromSlot >= 0) { // dragging out of the kit
      if (!d.moved) { slots[d.fromSlot] = null; drawSlots(); drawList(); return; } // a tap removes
      if (slot) { const to = Number(slot.dataset.slot); [slots[to], slots[d.fromSlot]] = [slots[d.fromSlot], slots[to]]; drawSlots(); return; }
      if (!inBox) { slots[d.fromSlot] = null; drawSlots(); drawList(); }
      return;
    }
    if (!d.moved) return;                           // a tap on the thumbnail does nothing; the + button adds
    if (slot) put(d.key, Number(slot.dataset.slot)); else if (inBox) put(d.key);
  }

  document.addEventListener("pointerdown", e => {
    const h = e.target.closest("[data-drag]"); if (h) { e.preventDefault(); startDrag(e, h.closest("[data-key]").dataset.key); return; }
    const s = e.target.closest(".kslot.full"); if (s) { e.preventDefault(); startDrag(e, slots[Number(s.dataset.slot)], Number(s.dataset.slot)); }
  });
  document.addEventListener("pointermove", move, { passive: true });
  document.addEventListener("pointerup", drop); document.addEventListener("pointercancel", e => { if (drag) { drag.g.remove(); drag = null; document.body.classList.remove("kdragging"); } });
  document.addEventListener("click", e => {
    const t = e.target;
    if (t.closest("[data-size]")) { size = Number(t.closest("[data-size]").dataset.size); history.replaceState(null, "", `kit.html?size=${size}`); render(); return; }
    if (t.closest("[data-addone]")) return put(t.closest("[data-addone]").dataset.addone);
    if (t.closest("[data-add]")) return addToBag();
    if (t.closest("[data-clear]")) { slots = []; drawSlots(); drawList(); return; }
    if (t.closest("[data-f]")) { f = t.closest("[data-f]").dataset.f; render(); return; }
  });
  document.addEventListener("input", e => { if (e.target.matches("[data-q]")) { q = e.target.value; drawList(); } });
  document.addEventListener("keydown", e => { const s = e.target.closest?.(".kslot.full"); if (s && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); slots[Number(s.dataset.slot)] = null; drawSlots(); drawList(); } });

  document.addEventListener("DOMContentLoaded", async () => {
    const root = $("[data-kit]"); if (!root) return;
    root.innerHTML = `<p class="muted small">Loading the collection…</p>`;
    try { all = await P.products(); render(); } catch (err) { root.innerHTML = `<p class="empty">Couldn't load the collection. ${esc(err.message || "")}</p>`; }
  });
})();
