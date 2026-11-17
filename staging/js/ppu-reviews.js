/* Patriot Peptides USA · order ratings (Nov 17 2026, test site first)
   Customers rate each shipped/delivered order on 4 things, 1–4 stars, plus an optional comment (rate.html?order=PP-O…,
   linked from My Account → Orders and from the Delivered email). Jeff approves ratings in the owner app (More → Reviews);
   only approved ones count toward the homepage section ([data-reviews] on index.html).
   Database: ppu_reviews + ppu_submit_review() + ppu_public_reviews() (server/sql/99e_reviews.sql).
   ?demo=1 on any page shows sample ratings so the experience can be previewed before real ones exist. */
(() => {
  const P = window.PST, esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const CATS = [
    ["accuracy", "Order accuracy", "Right products and strengths, nothing missing"],
    ["shipping", "Shipping speed", "How quickly it shipped and arrived"],
    ["packaging", "Packaging", "Arrived sealed, intact and well packed"],
    ["service", "Communication", "Updates, answers and help when you needed it"]];
  const WORDS = ["", "Poor", "Fair", "Good", "Excellent"];
  const MIN_SHOW = 3; // the homepage section appears once Jeff has approved this many ratings
  const DEMO = /[?&]demo=1\b/.test(location.search);
  const DEMO_DATA = { count: 27, accuracy: 3.93, shipping: 3.7, packaging: 3.85, service: 3.89, overall: 3.84, recent: [
    { name: "Derek M.", accuracy: 4, shipping: 4, packaging: 4, service: 4, comment: "Exactly what I ordered, labeled clearly, and tracking came the same day it shipped.", date: "2026-11-12" },
    { name: "Sarah K.", accuracy: 4, shipping: 3, packaging: 4, service: 4, comment: "Packed really well and Jeff answered my question about a backordered item within the hour.", date: "2026-11-09" },
    { name: "Chris L.", accuracy: 4, shipping: 4, packaging: 3, service: 4, comment: "Fast to the West Coast. Everything arrived sealed. Will order again.", date: "2026-11-04" }] };
  const avg = r => (Number(r.accuracy) + Number(r.shipping) + Number(r.packaging) + Number(r.service)) / 4;

  // stars: n out of 4, halves allowed (for averages)
  function stars(n, size = 16) {
    n = Math.max(0, Math.min(4, Number(n) || 0));
    const one = i => { const f = Math.max(0, Math.min(1, n - i)), id = `s${Math.random().toString(36).slice(2, 8)}`;
      return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="${id}"><stop offset="${f * 100}%" stop-color="var(--star,#E8B23A)"/><stop offset="${f * 100}%" stop-color="var(--starOff,rgba(150,160,180,.35))"/></linearGradient></defs><path fill="url(#${id})" d="M12 2.6l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.4l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/></svg>`; };
    return `<span class="rstars" role="img" aria-label="${n.toFixed(1)} out of 4 stars">${[0, 1, 2, 3].map(one).join("")}</span>`;
  }
  const fmt = n => (Math.round(Number(n) * 10) / 10).toFixed(1);

  /* ---------- homepage section ---------- */
  async function homepage(el) {
    let d = DEMO ? DEMO_DATA : null;
    if (!d) { try { const r = await P.client().rpc("ppu_public_reviews", { p_limit: 6 }); d = r.data; } catch { d = null; } }
    if (!d || Number(d.count) < MIN_SHOW) { el.hidden = true; return; }
    const rec = (d.recent || []).slice(0, 3);
    el.innerHTML = `<div class="rv">
<div class="rvtop"><div><span class="kick">Verified buyer ratings</span><h2 class="serif" id="rvh">How we're rated</h2>
<p class="muted small">From ${Number(d.count)} rated orders. Every rating comes from a real order and is reviewed before it's posted.</p></div>
<div class="rvall"><b>${fmt(d.overall)}</b><span>out of 4</span>${stars(d.overall, 20)}</div></div>
<div class="rvcats">${CATS.map(([k, t, s]) => `<div class="rvcat"><div><b>${esc(t)}</b><small>${esc(s)}</small></div><div class="rvbar"><i style="width:${(Number(d[k]) / 4 * 100).toFixed(0)}%"></i></div><span class="rvn">${fmt(d[k])}</span></div>`).join("")}</div>
${rec.length ? `<div class="rvlist">${rec.map(r => `<figure class="rvq"><div class="rvqh">${stars(avg(r), 14)}<span class="muted small">${esc(r.name || "Verified buyer")} · ${P.fmtDate ? esc(P.fmtDate(r.date)) : esc(r.date)}</span></div><blockquote>${esc(r.comment)}</blockquote></figure>`).join("")}</div>` : ""}
</div>`;
    el.hidden = false;
  }

  /* ---------- rate page ---------- */
  async function ratePage(root) {
    const on = (P.params.get("order") || "").trim();
    const user = DEMO ? { id: "demo" } : await P.getUser?.().catch(() => null);
    if (!user) { root.innerHTML = `<div class="empty"><h1 class="serif">Rate your order</h1><p>Sign in with the email you ordered with, and you'll come right back here.</p><a class="btn primary" href="login.html?redirect=${encodeURIComponent(location.pathname.split("/").pop() + location.search)}">Sign in</a></div>`; return; }
    let o = null, mine = null;
    if (DEMO) { o = { order_number: on || "PP-O100031", created_at: "2026-11-08", status: "delivered", total: 182 }; }
    else {
      const q = P.client().from("orders").select("id,order_number,created_at,status,total").eq("user_id", user.id);
      const { data } = on ? await q.eq("order_number", on).limit(1) : await q.in("status", ["shipped", "delivered", "complete", "completed"]).order("created_at", { ascending: false }).limit(1);
      o = (data || [])[0] || null;
      if (o) mine = (await P.client().from("ppu_reviews").select("accuracy,shipping,packaging,service,comment,status").eq("order_id", o.id).maybeSingle()).data;
    }
    if (!o) { root.innerHTML = `<div class="empty"><h1 class="serif">Rate your order</h1><p>We couldn't find ${on ? `order ${esc(on)}` : "a shipped order"} on this account. You may be signed in with a different email.</p><a class="btn ghost" href="account.html#orders">See my orders</a></div>`; return; }
    if (!["shipped", "delivered", "complete", "completed"].includes(String(o.status || "").toLowerCase())) { root.innerHTML = `<div class="empty"><h1 class="serif">Almost there</h1><p>You can rate ${esc(o.order_number)} once it ships.</p><a class="btn ghost" href="account.html#orders">See my orders</a></div>`; return; }
    const pick = { accuracy: mine?.accuracy || 0, shipping: mine?.shipping || 0, packaging: mine?.packaging || 0, service: mine?.service || 0 };
    root.innerHTML = `<div class="rate"><span class="kick">Order ${esc(o.order_number)}${o.created_at ? ` · ${esc(P.fmtDate ? P.fmtDate(o.created_at) : o.created_at)}` : ""}</span>
<h1 class="serif">How did we do?</h1>
<p class="muted">Rate each one from 1 to 4 stars. It takes about 20 seconds.${mine ? ` <b>You rated this order already; changes go back to Jeff for approval.</b>` : ""}</p>
<form data-rform novalidate>
${CATS.map(([k, t, s]) => `<fieldset class="rrow" data-k="${k}"><legend><b>${esc(t)}</b><small>${esc(s)}</small></legend>
<div class="rpick" role="radiogroup" aria-label="${esc(t)}">${[1, 2, 3, 4].map(n => `<button type="button" role="radio" aria-checked="${pick[k] === n}" aria-label="${n} star${n > 1 ? "s" : ""}, ${WORDS[n]}" data-n="${n}"><svg width="34" height="34" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.4l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/></svg></button>`).join("")}<span class="rword" aria-live="polite">${pick[k] ? WORDS[pick[k]] : ""}</span></div></fieldset>`).join("")}
<label class="rcom"><b>Anything to add? <span class="muted small">(optional)</span></b>
<textarea name="c" maxlength="500" rows="4" placeholder="How was ordering, shipping and the packaging?">${esc(mine?.comment || "")}</textarea>
<small class="muted">Please keep it to the ordering and shipping experience. Comments about personal use won't be posted. Your first name and last initial show with an approved comment.</small></label>
<p class="notice err" data-rerr hidden></p>
<button class="btn primary" type="submit">${mine ? "Update my rating" : "Send my rating"}</button>
</form></div>`;
    const draw = () => root.querySelectorAll(".rrow").forEach(fs => { const k = fs.dataset.k; fs.querySelectorAll("[data-n]").forEach(b => { const n = Number(b.dataset.n); b.setAttribute("aria-checked", String(pick[k] === n)); b.classList.toggle("on", n <= pick[k]); }); fs.querySelector(".rword").textContent = pick[k] ? WORDS[pick[k]] : ""; });
    root.querySelectorAll(".rrow").forEach(fs => fs.addEventListener("click", e => { const b = e.target.closest("[data-n]"); if (!b) return; pick[fs.dataset.k] = Number(b.dataset.n); fs.classList.remove("miss"); draw(); }));
    draw();
    root.querySelector("[data-rform]").addEventListener("submit", async e => {
      e.preventDefault(); const err = root.querySelector("[data-rerr]"), missing = CATS.filter(([k]) => !pick[k]);
      if (missing.length) { missing.forEach(([k]) => root.querySelector(`.rrow[data-k="${k}"]`).classList.add("miss")); err.textContent = `Pick stars for ${missing.map(m => m[1]).join(", ")}.`; err.hidden = false; return; }
      err.hidden = true; const btn = e.submitter || root.querySelector("[type=submit]"); btn.disabled = true; btn.textContent = "Sending…";
      const comment = root.querySelector("textarea").value.trim();
      let fail = "";
      if (!DEMO) { const { error } = await P.client().rpc("ppu_submit_review", { p_order: o.order_number, p_accuracy: pick.accuracy, p_shipping: pick.shipping, p_packaging: pick.packaging, p_service: pick.service, p_comment: comment || null }); if (error) fail = error.message; }
      if (fail) { btn.disabled = false; btn.textContent = "Send my rating"; err.textContent = fail; err.hidden = false; return; }
      root.innerHTML = `<div class="empty"><div class="rdone">${stars(avg(pick), 28)}</div><h1 class="serif">Thank you</h1><p>Your rating for ${esc(o.order_number)} is in. ${comment ? "Once it's approved, your comment may appear on our homepage with your first name and last initial." : ""}</p><div class="rbtns"><a class="btn primary" href="catalog.html">Shop the collection</a><a class="btn ghost" href="account.html#orders">My orders</a></div></div>`;
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  /* ---------- My Account → Orders: rate button per shipped order ---------- */
  let mineP = null;
  const myRatings = () => mineP || (mineP = DEMO ? Promise.resolve({}) : P.client().from("ppu_reviews").select("order_id,accuracy,shipping,packaging,service,status").then(({ data }) => Object.fromEntries((data || []).map(r => [r.order_id, r])), () => ({})));
  async function accountButtons(scope) {
    const got = await myRatings();
    scope.querySelectorAll("[data-rateslot]").forEach(s => { const r = got[s.dataset.rateslot];
      s.outerHTML = r ? `<a class="btn ghost sm rated" href="rate.html?order=${encodeURIComponent(s.dataset.on)}" title="Change your rating">${stars(avg(r), 13)} You rated ${fmt(avg(r))}</a>`
        : `<a class="btn ghost sm" href="rate.html?order=${encodeURIComponent(s.dataset.on)}">${stars(0, 13).replace("0.0 out of 4 stars", "Rate")} Rate this order</a>`; });
  }

  document.addEventListener("DOMContentLoaded", () => {
    const h = document.querySelector("[data-reviews]"); if (h) homepage(h);
    const r = document.querySelector("[data-rate]"); if (r) ratePage(r);
  });
  window.PPUReviews = { CATS, WORDS, stars, avg, fmt, accountButtons, DEMO, DEMO_DATA };
})();
