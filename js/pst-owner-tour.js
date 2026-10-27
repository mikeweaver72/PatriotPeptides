/* Patriot Peptides USA · owner app tour (v1.0)
   A guided walkthrough over the real owner app: each step spotlights a real part of the screen, says what it does,
   and taps the app's own buttons to move between tabs. Starts once on the owner's first open; replay any time from
   More → "Take the tour". Nothing is saved or changed by the tour. */
(() => {
  const DONE = "ppu_tour_done_v1";
  const $ = s => document.querySelector(s);
  const tap = s => { const el = $(s); if (el) el.click(); return el; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await wait(80); } return null; };

  // each step: target selector (or null for a centred card), what to do first, title, text
  const STEPS = [
    { t: null, h: "Welcome to your owner app", p: "Two minutes and you'll know your way around. Tap Next to walk through it, or Skip any time. You can replay this from More → Take the tour." },
    { go: "today", t: "[data-stats]", h: "Today at a glance", p: "Sales, orders waiting on you and stock, the moment you open the app. Tap a tile to jump straight to those orders or products." },
    { go: "today", t: "[data-attn]", h: "Needs you", p: "Orders waiting on payment, packing or shipping land here, oldest first. Clear this list and you're done for the day." },
    { go: "today", t: ".oquick", h: "Take an order by phone or text", p: "New order builds one for a customer in a few taps. Add customer saves someone new. Kit savings and shipping work out on their own." },
    { t: "[data-q=lookup]", h: "Find anything", p: "Order number, PP-C customer number, name, phone, email, tracking or product. One search box for all of it." },
    { t: "[data-bell]", h: "Your alerts", p: "New orders, customers who say they've paid, Venmo payments matched to orders, sign-ups, requests and low stock. Turn on phone alerts under More → Notifications so they buzz your phone too." },
    { t: ".shopsw", h: "Flip to the shop", p: "See the site exactly the way customers do. While you're over there, the Owner app button in the corner brings you straight back." },
    { go: "orders", t: "[data-tabs]", h: "Orders", p: "Filter by where each order stands: waiting on payment, paid, packed, shipped, done. Search by name, number or email at the top." },
    { go: "orders", t: "[data-list]", h: "Running an order", p: "Tap an order, then move it along: Mark paid (Venmo or Cash App) → Packed → Ship it with the tracking number → Delivered. The customer gets an email and an alert at each step. Mistakes can be undone." },
    { go: "products", sub: "catalog", t: "[data-pm]", h: "Products", p: "Tap any product to change its price, put it on sale, upload a lab report, choose what's featured on the home page, or hide it from the shop. Changes are live the moment you save." },
    { go: "products", sub: "stock", t: "[data-stock]", h: "Stock", p: "Tap a product to correct its count (it asks for a reason, so there's a record). New PO orders from a vendor; when the box arrives, Receive adds it to the shelf." },
    { go: "products", sub: "reorder", t: "[data-reorder]", h: "Reorder", p: "What's selling, what's running low and how much to order, worked out from your own sales." },
    { go: "customers", t: "[data-custs]", h: "Customers", p: "Everyone who has bought or signed up. Tap one for their orders, address, notes and store credit. You can text or email them from here." },
    { go: "more", t: "[data-more=insights]", h: "Insights", p: "Your analytics: who's on the site right now, where visitors come from, what they look at, what they add to the bag and what sells." },
    { go: "more", t: "[data-more=reports]", h: "Reports", p: "Sales, profit, expenses and stock moves for any date range. Download any of them as a spreadsheet." },
    { go: "more", t: "[data-more=discounts]", h: "Codes, promotions and email", p: "Discount codes with limits, banner promotions and free-vial offers, and email blasts to your subscribers all live in this list." },
    { go: "more", t: "[data-more=help]", h: "Something not right?", p: "Report a problem with a screenshot right from the app. Fixes come back as updates; What's new at the top of this page shows what changed." },
    { go: "today", t: null, h: "Pull down to refresh", p: "On any screen, pull down from the top to load the latest orders and pick up app updates. That's the tour. Replay it any time from More → Take the tour." }
  ];

  let i = 0, ui = null, busy = false;
  function build() {
    if (ui) return ui;
    ui = document.createElement("div"); ui.className = "otour"; ui.setAttribute("role", "dialog"); ui.setAttribute("aria-modal", "true"); ui.setAttribute("aria-live", "polite");
    ui.innerHTML = `<div class="otour-spot" data-spot></div><div class="otour-card" data-card><small data-step></small><h3 data-h></h3><p data-p></p>
<div class="otour-btns"><button type="button" class="btn ghost sm" data-skip>Skip</button><span></span><button type="button" class="btn ghost sm" data-back>Back</button><button type="button" class="btn primary sm" data-next>Next</button></div></div>`;
    ui.addEventListener("click", e => {
      if (e.target.closest("[data-next]")) return step(i + 1);
      if (e.target.closest("[data-back]")) return step(i - 1);
      if (e.target.closest("[data-skip]")) return end();
      if (!e.target.closest("[data-card]")) e.stopPropagation(); // taps outside the card don't reach the app underneath
    });
    document.addEventListener("keydown", e => { if (!ui?.isConnected) return; if (e.key === "Escape") end(); if (e.key === "ArrowRight") step(i + 1); if (e.key === "ArrowLeft") step(i - 1); });
    addEventListener("resize", () => ui?.isConnected && place());
    return ui;
  }
  async function step(n) {
    if (busy) return; if (n < 0) return; if (n >= STEPS.length) return end();
    busy = true; i = n; const s = STEPS[i];
    try {
      if (s.go) { tap(`[data-go="${s.go}"]`); await wait(250); }
      if (s.sub) { tap(`[data-psub="${s.sub}"]`); await wait(200); }
      const el = s.t ? await until(() => { const e = $(s.t); return e && e.getClientRects().length ? e : null; }, 3000) : null;
      if (el) { el.scrollIntoView({ block: "center", behavior: "instant" in document.documentElement.style ? "instant" : "auto" }); await wait(120); }
      const u = build(); if (!u.isConnected) document.body.appendChild(u);
      u.querySelector("[data-step]").textContent = `${i + 1} of ${STEPS.length}`;
      u.querySelector("[data-h]").textContent = s.h; u.querySelector("[data-p]").textContent = s.p;
      u.querySelector("[data-back]").style.visibility = i === 0 ? "hidden" : "visible";
      u.querySelector("[data-next]").textContent = i === STEPS.length - 1 ? "Done" : i === 0 ? "Start" : "Next";
      u._el = el; place(); u.querySelector("[data-next]").focus({ preventScroll: true });
    } finally { busy = false; }
  }
  function place() {
    const spot = ui.querySelector("[data-spot]"), card = ui.querySelector("[data-card]"), el = ui._el, vh = innerHeight, pad = 8;
    if (!el) { spot.style.cssText = "top:50%;left:50%;width:0;height:0"; card.style.cssText = "top:50%;transform:translateY(-50%)"; return; }
    const r = el.getBoundingClientRect(), top = Math.max(6, r.top - pad), h = Math.min(vh * .55, r.height + pad * 2);
    spot.style.cssText = `top:${top}px;left:${Math.max(6, r.left - pad)}px;width:${Math.min(innerWidth - 12, r.width + pad * 2)}px;height:${h}px`;
    const below = top + h + 14, ch = card.offsetHeight || 200;
    card.style.cssText = below + ch < vh - 12 ? `top:${below}px` : `top:${Math.max(12, top - ch - 14)}px`;
  }
  function end() { try { localStorage.setItem(DONE, "1"); } catch { /* private mode */ } ui?.remove(); tap('[data-go="today"]'); window.scrollTo(0, 0); }
  async function start() {
    if (!(await until(() => $(".otabbar"), 15000))) return;
    document.getElementById("updnote")?.remove(); // the "Updated to…" banner sits over the header buttons the tour points at
    try { const u = await window.PST?.getUser?.(); const em = String(u?.email || "").toLowerCase();
      const name = /^(patriotpepps@gmail\.com|owner@patriotpeptides-usa\.com)$/.test(em) ? "Jeff" : "";
      STEPS[0].h = name ? `Welcome to your owner app, ${name}` : "Welcome to your owner app"; } catch { /* keep the plain welcome */ }
    i = 0; step(0);
  }
  window.PSTTour = { start };

  // More → Take the tour
  document.addEventListener("click", e => { const t = e.target.closest('[data-more="tour"]'); if (!t) return; e.preventDefault(); e.stopImmediatePropagation(); start(); }, true);
  // first open as an owner: start once, after the app has drawn
  document.addEventListener("DOMContentLoaded", async () => {
    if (document.body.dataset.page !== "owner") return;
    let seen = false; try { seen = localStorage.getItem(DONE) === "1"; } catch { /* private mode */ }
    if (seen) return;
    if (await until(() => $("[data-stats]"), 15000)) { await wait(1200); if (!ui?.isConnected) start(); }
  });
})();
