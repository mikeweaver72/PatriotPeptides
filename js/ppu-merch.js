/* Patriot Peptides USA · Merch (v1, Oct 31 2026): shirts, hats and gear for signed-in customers.
   Each merch row in product_catalog is one color + size with its own stock. Same bag and checkout as everything else. */
(() => {
  const P = window.PST, $ = s => document.querySelector(s), esc = P.esc, money = P.money;
  const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "2XL", "XXL", "3XL", "XXXL", "4XL", "5XL", "ONE SIZE", "OS", "S/M", "M/L", "L/XL"];
  const sizeRank = s => { const i = SIZE_ORDER.indexOf(String(s || "").trim().toUpperCase()); return i < 0 ? 50 : i; };
  const uniq = a => [...new Set(a.filter(Boolean))];
  let items = [], cur = null, pick = { color: "", size: "", q: 1 };

  // one entry per item name; variants = its color/size rows
  function build(rows) {
    return P.groups(rows).map(vs => {
      vs = vs.slice().sort((a, b) => (Number(a.merch_sort) || 0) - (Number(b.merch_sort) || 0) || sizeRank(a.merch_size) - sizeRank(b.merch_size));
      const colors = uniq(vs.map(v => v.merch_color)), sizes = uniq(vs.map(v => v.merch_size)).sort((a, b) => sizeRank(a) - sizeRank(b));
      return { name: vs[0].display_name, desc: vs.find(v => v.merch_desc)?.merch_desc || "", vs, colors, sizes,
        inStock: vs.some(v => P.qty(v) > 0), photo: (vs.find(v => v.photo_url && P.qty(v) > 0) || vs.find(v => v.photo_url) || {}).photo_url || "",
        min: Math.min(...vs.map(P.unitPrice)), sale: vs.some(P.onSale), sort: Math.min(...vs.map(v => Number(v.merch_sort) || 0)) };
    }).sort((a, b) => (b.inStock - a.inStock) || a.sort - b.sort || a.name.localeCompare(b.name));
  }
  const variant = () => cur?.vs.find(v => (!cur.colors.length || v.merch_color === pick.color) && (!cur.sizes.length || v.merch_size === pick.size)) || null;
  const photoFor = color => (cur.vs.find(v => v.merch_color === color && v.photo_url) || cur.vs.find(v => v.photo_url) || {}).photo_url || "";
  const pic = (src, alt, cls = "") => src ? `<img class="${cls}" src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async">` : `<span class="${cls} none" aria-hidden="true">${P.icon("shop", 40)}</span>`;

  function card(it) {
    const was = it.sale ? Math.min(...it.vs.map(v => Number(v.price) || 0)) : 0;
    return `<button type="button" class="mcard2" data-mitem="${esc(it.name)}">${pic(it.photo, it.name, "mph")}${it.sale ? `<i class="mtag">Sale</i>` : ""}
<span class="mtx"><b>${esc(it.name)}</b><span>${it.vs.length > 1 && it.vs.some(v => P.unitPrice(v) !== it.min) ? "from " : ""}${money(it.min)}${it.sale && was > it.min ? ` <s>${money(was)}</s>` : ""}</span>${it.inStock ? "" : `<em>Sold out</em>`}</span></button>`;
  }

  function detail() {
    const v = variant(), n = v ? P.qty(v) : 0, price = v ? P.unitPrice(v) : cur.min, src = photoFor(pick.color);
    const sizeOk = s => cur.vs.some(x => x.merch_size === s && (!cur.colors.length || x.merch_color === pick.color) && P.qty(x) > 0);
    const colorOk = c => cur.vs.some(x => x.merch_color === c && P.qty(x) > 0);
    pick.q = Math.max(1, Math.min(pick.q, Math.max(1, n)));
    const ready = v && n > 0, need = cur.sizes.length && !pick.size ? "Pick a size" : cur.colors.length && !pick.color ? "Pick a color" : !v || n <= 0 ? "Sold out" : "";
    return `<div class="mdet"><div class="mbig">${pic(src, `${cur.name}${pick.color ? ` in ${pick.color}` : ""}`, "mph")}</div>
<div class="minfo"><h2 class="serif">${esc(cur.name)}</h2><p class="mprice"><b>${money(price)}</b>${(v ? P.onSale(v) : cur.sale) ? ` <s>${money(v ? v.price : Math.min(...cur.vs.map(x => Number(x.price) || 0)))}</s>` : ""}</p>
${cur.desc ? `<p class="muted">${esc(cur.desc)}</p>` : ""}
${cur.colors.length ? `<p class="kick">Color${pick.color ? `: <span>${esc(pick.color)}</span>` : ""}</p><div class="mchips" role="radiogroup" aria-label="Color">${cur.colors.map(c => `<button type="button" role="radio" aria-checked="${c === pick.color}" data-mcolor="${esc(c)}"${colorOk(c) ? "" : ' class="out"'}>${esc(c)}</button>`).join("")}</div>` : ""}
${cur.sizes.length ? `<p class="kick">Size${pick.size ? `: <span>${esc(pick.size)}</span>` : ""}</p><div class="mchips" role="radiogroup" aria-label="Size">${cur.sizes.map(s => { const ok = sizeOk(s); return `<button type="button" role="radio" aria-checked="${s === pick.size}" data-msize="${esc(s)}"${ok ? "" : ` disabled aria-disabled="true" title="Sold out"`}>${esc(s)}</button>`; }).join("")}</div>` : ""}
${ready && n <= 3 ? `<p class="mlow">Only ${n} left</p>` : ""}
<div class="mbuy"><div class="qty"><button type="button" data-mq="-1" aria-label="Fewer"${pick.q <= 1 ? " disabled" : ""}>−</button><span aria-live="polite">${pick.q}</span><button type="button" data-mq="1" aria-label="More"${!ready || pick.q >= n ? " disabled" : ""}>+</button></div>
<button type="button" class="btn primary" data-madd${ready ? "" : " disabled"}>${need || `Add to bag · ${money(price * pick.q)}`}</button></div>
<p class="muted small">Ships with your order. Counts toward free shipping at ${money(P.CFG.freeShip)}.</p></div></div>`;
  }

  function open(name) {
    cur = items.find(i => i.name === name); if (!cur) return;
    const firstIn = cur.vs.find(v => P.qty(v) > 0) || cur.vs[0];
    pick = { color: cur.colors.length ? firstIn.merch_color || cur.colors[0] : "", size: cur.sizes.length === 1 ? cur.sizes[0] : "", q: 1 };
    const w = P.sheet(`<div data-mdet>${detail()}</div>`, { label: cur.name }); w.classList.add("full", "msheet");
    history.replaceState(null, "", `merch.html?item=${encodeURIComponent(cur.name)}`);
    w.addEventListener("click", e => {
      const c = e.target.closest("[data-mcolor]"), s = e.target.closest("[data-msize]"), q = e.target.closest("[data-mq]"), add = e.target.closest("[data-madd]");
      if (c) { pick.color = c.dataset.mcolor; if (pick.size && !cur.vs.some(x => x.merch_size === pick.size && x.merch_color === pick.color && P.qty(x) > 0)) pick.size = ""; }
      else if (s && !s.disabled) pick.size = s.dataset.msize;
      else if (q) pick.q += Number(q.dataset.mq);
      else if (add) { const v = variant(); if (!v || P.qty(v) <= 0) return; const inBag = (P.readCart().find(i => i.key === v.product_key)?.quantity || 0);
        if (inBag + pick.q > P.qty(v)) { P.toast(`Only ${P.qty(v)} in stock${inBag ? `, and ${inBag} ${inBag === 1 ? "is" : "are"} in your bag` : ""}`); return; }
        P.closeSheet(); P.addAndShow(v.product_key, pick.q); history.replaceState(null, "", "merch.html"); return; }
      else return;
      w.querySelector("[data-mdet]").innerHTML = detail();
    });
  }

  document.addEventListener("click", e => { const b = e.target.closest("[data-mitem]"); if (b) open(b.dataset.mitem); });
  document.addEventListener("DOMContentLoaded", async () => {
    const el = $("[data-merch]"); if (!el) return;
    const user = await P.getUser().catch(() => null);
    if (!user) {
      el.innerHTML = `<div class="mgate">${P.icon("lock", 28)}<h2 class="serif">Members only</h2><p class="muted">Sign in to shop Patriot Peptides USA shirts, hats and gear.</p><a class="btn primary" href="login.html?redirect=${encodeURIComponent("merch.html" + location.search)}">Sign in</a> <a class="btn ghost" href="register.html">Create an account</a></div>`;
      return;
    }
    try {
      items = build((await P.merchProducts()).filter(p => p.is_active !== false));
      el.innerHTML = items.length ? `<div class="mgrid2">${items.map(card).join("")}</div>` : `<p class="empty">New gear is on the way. Check back soon.</p>`;
      const want = P.params.get("item"); if (want) open(want);
    } catch (err) { el.innerHTML = `<p class="empty">Couldn't load merch. ${esc(err.message || "")}</p>`; }
  });
})();
