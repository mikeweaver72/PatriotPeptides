/* Patriot Peptides USA · owner app: arrange the More cards (v2.0, Nov 1 2026)
   No grip handles (they sat where a thumb scrolls and moved cards by accident).
   Press and hold a card for about half a second until it lifts, then drag it. A normal swipe just scrolls; a tap opens the card.
   "Reset order" sits at the top. The order is saved on this device right away and to the owner's account
   (auth user metadata), so phone and computer match. */
(() => {
  const P = window.PST, KEY = "ppu-more-order", META = "ppu_more_order", HOLD = 450, SLOP = 10;
  const keyOf = c => c.dataset.more || c.getAttribute("href") || c.textContent.trim();
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } };
  const write = a => { try { a ? localStorage.setItem(KEY, JSON.stringify(a)) : localStorage.removeItem(KEY); } catch {} };
  let box = null, defaults = [], syncT = 0;

  const current = () => [...box.querySelectorAll(":scope > .mrow")].map(r => r.dataset.mk);
  function apply(order) {
    if (!box || !Array.isArray(order)) return;
    const rows = Object.fromEntries([...box.querySelectorAll(":scope > .mrow")].map(r => [r.dataset.mk, r]));
    order.forEach(k => { if (rows[k]) { box.appendChild(rows[k]); delete rows[k]; } });
    defaults.forEach(k => { if (rows[k]) box.appendChild(rows[k]); }); // cards added in later updates go at the end
    topBar();
  }
  function save() {
    const a = current(), same = a.join("|") === defaults.join("|");
    write(same ? null : a); topBar();
    clearTimeout(syncT); syncT = setTimeout(() => { P.client()?.auth.updateUser({ data: { [META]: same ? null : a } }).catch(() => {}); }, 800);
  }
  function topBar() {
    if (!box) return; let bar = box.parentElement.querySelector(".mtopbar");
    if (!bar) {
      box.insertAdjacentHTML("beforebegin", `<div class="mtopbar"><span>Press and hold a card to move it</span><button type="button" class="btn ghost sm" data-mreset>Reset order</button></div>`);
      bar = box.previousElementSibling;
      bar.querySelector("[data-mreset]").addEventListener("click", () => { apply(defaults); save(); P.toast?.("Cards back in the original order"); });
    }
    const custom = current().join("|") !== defaults.join("|"), b = bar.querySelector("[data-mreset]");
    b.disabled = !custom; b.title = custom ? "Put the cards back in the original order" : "Cards are in the original order";
  }

  function setup(el) {
    if (el.dataset.mready) return; el.dataset.mready = "1"; box = el;
    [...el.children].forEach(c => {
      if (!c.classList.contains("mcard")) return;
      const row = document.createElement("div"); row.className = "mrow"; row.dataset.mk = keyOf(c);
      c.replaceWith(row); row.appendChild(c);
    });
    defaults = current();
    apply(read()); topBar();
    P.client()?.auth.getUser().then(({ data }) => { const a = data?.user?.user_metadata?.[META]; if (Array.isArray(a)) { apply(a); write(a); } }).catch(() => {});
    el.addEventListener("contextmenu", e => { if (press || drag) e.preventDefault(); }); // Android: no menu on the hold
  }

  /* ---------- press and hold, then drag ---------- */
  let press = null, drag = null, skipClick = 0;
  const se = () => document.scrollingElement || document.documentElement;
  function hold(row, x, y) { cancelPress(); press = { row, x, y, t: setTimeout(() => { const p = press; press = null; if (p) lift(p.row, p.y); }, HOLD) }; row.classList.add("pressing"); }
  function cancelPress() { if (!press) return; clearTimeout(press.t); press.row.classList.remove("pressing"); press = null; }
  function lift(row, y) {
    row.classList.remove("pressing");
    drag = { row, y0: y + se().scrollTop, lastY: y, moved: false, raf: 0 };
    row.classList.add("dragging"); box.classList.add("sorting");
    if (navigator.vibrate) try { navigator.vibrate(12); } catch {}
    const tick = () => { if (!drag) return; const h = innerHeight, edge = 70, v = drag.lastY < edge ? -Math.ceil((edge - drag.lastY) / 6) : drag.lastY > h - edge ? Math.ceil((drag.lastY - (h - edge)) / 6) : 0;
      if (v) { se().scrollTop += v; move(); } drag.raf = requestAnimationFrame(tick); };
    drag.raf = requestAnimationFrame(tick);
  }
  function move() {
    if (!drag) return; const { row } = drag, gap = parseFloat(getComputedStyle(box).rowGap) || 12;
    let dy = drag.lastY + se().scrollTop - drag.y0;
    for (let n = 0; n < 60; n++) { // swap with a neighbour once the card passes its middle
      const nx = row.nextElementSibling, pv = row.previousElementSibling;
      if (dy > 0 && nx && nx.classList.contains("mrow") && dy > (nx.offsetHeight + gap) / 2) { const s = nx.offsetHeight + gap; box.insertBefore(nx, row); drag.y0 += s; dy -= s; drag.moved = true; continue; }
      if (dy < 0 && pv && pv.classList.contains("mrow") && -dy > (pv.offsetHeight + gap) / 2) { const s = pv.offsetHeight + gap; box.insertBefore(row, pv); drag.y0 -= s; dy += s; drag.moved = true; continue; }
      break;
    }
    if (!row.nextElementSibling && dy > 0) dy = Math.min(dy, 24); if (!row.previousElementSibling && dy < 0) dy = Math.max(dy, -24);
    row.style.transform = `translateY(${dy}px)`;
  }
  function drop() {
    cancelPress(); if (!drag) return;
    const { row, raf, moved } = drag; cancelAnimationFrame(raf); drag = null; skipClick = Date.now() + 600; // the hold shouldn't also open the card
    row.style.transform = ""; row.classList.remove("dragging"); box.classList.remove("sorting"); if (moved) save();
  }
  const inBox = t => box && t && box.contains(t) && t.closest?.(".mrow");

  // finger (touch events, so the page can still scroll until the card lifts)
  document.addEventListener("touchstart", e => { const row = inBox(e.target); if (!row || e.touches.length > 1) { cancelPress(); return; } const t = e.touches[0]; hold(row, t.clientX, t.clientY); }, { passive: true });
  document.addEventListener("touchmove", e => {
    const t = e.touches[0]; if (!t) return;
    if (drag) { if (e.cancelable) e.preventDefault(); drag.lastY = t.clientY; move(); return; }
    if (press && Math.hypot(t.clientX - press.x, t.clientY - press.y) > SLOP) cancelPress(); // it's a scroll
  }, { passive: false });
  document.addEventListener("touchend", drop); document.addEventListener("touchcancel", drop);
  document.addEventListener("scroll", () => { if (press && !drag) cancelPress(); }, { passive: true });

  // mouse (computer)
  document.addEventListener("pointerdown", e => { if (e.pointerType !== "mouse" || e.button > 0) return; const row = inBox(e.target); if (row) hold(row, e.clientX, e.clientY); });
  document.addEventListener("pointermove", e => {
    if (e.pointerType !== "mouse") return;
    if (drag) { e.preventDefault(); drag.lastY = e.clientY; move(); return; }
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP) cancelPress();
  });
  document.addEventListener("pointerup", e => { if (e.pointerType === "mouse") drop(); });

  document.addEventListener("click", e => { if (Date.now() < skipClick && inBox(e.target)) { e.preventDefault(); e.stopPropagation(); } }, true);

  /* the More screen is drawn after sign-in, so watch for its card list */
  const look = () => { const el = document.querySelector("[data-morehome] .mcards"); if (el && !el.dataset.mready) setup(el); };
  new MutationObserver(look).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", look); look();
})();
