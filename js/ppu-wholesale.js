/* Patriot Peptides USA · Wholesale (v1.0): his 10-vial kits up top, then the bulk/lab-quantity request form. */
(() => {
  const P = window.PST, $ = s => document.querySelector(s), esc = P.esc, money = P.money;
  document.addEventListener("click", e => { const b = e.target.closest("[data-wadd]"); if (!b) return; P.addToCart(b.dataset.wadd, 1); P.toast?.("Added to your bag"); });
  document.addEventListener("DOMContentLoaded", async () => {
    const el = $("[data-wkits]"); if (!el) return;
    try {
      const kits = (await P.products()).filter(p => /wholesale/i.test(p.category || "") || /10-vial/i.test(p.strength || "")).filter(p => p.is_active !== false).sort(P.cmpProduct);
      el.innerHTML = kits.length ? kits.map(p => { const n = P.qty(p), name = P.titleParts(p).main, per = P.unitPrice(p) / 10;
        return `<article class="wkit"><a href="${P.productUrl(p)}" class="wkimg">${P.vial(p, 92)}<span class="wk10">×10</span></a>
<div class="wkbody"><span class="kick">10-vial kit</span><h3><a href="${P.productUrl(p)}">${esc(name)}</a></h3><p class="muted small">${esc(p.research_summary ? String(p.research_summary).split("\n")[0].slice(0, 90) : "Ten sealed vials from one lot, each with the same lab report.")}</p>
<div class="wkprice"><b>${money(P.unitPrice(p))}</b><small>${money(per)} a vial</small></div>
${n > 0 ? `<button type="button" class="btn primary sm" data-wadd="${esc(p.product_key)}">Add to bag</button>` : `<a class="btn ghost sm" href="${P.productUrl(p)}">Sold out · Request</a>`}</div></article>`; }).join("")
        : `<p class="empty">No wholesale kits listed right now. Use the bulk request below.</p>`;
    } catch (err) { el.innerHTML = `<p class="empty">Couldn't load wholesale kits. ${esc(err.message || "")}</p>`; }
  });
})();
