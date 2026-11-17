/* Patriot Peptides USA · owner app: Reviews (Nov 17 2026, test site first). More → Reviews.
   New order ratings wait here until Jeff approves them; only approved ones count on the homepage (ppu-reviews.js).
   Approve / Hide update ppu_reviews.status (owner-only policy). owner.html?demo=1 shows sample ratings. */
(() => {
  const P = window.PST, esc = P.esc;
  const R = () => window.PPUReviews;
  const DEMO = /[?&]demo=1\b/.test(location.search);
  const SAMPLE = [
    { id: "d1", status: "pending", display_name: "Marcus T.", accuracy: 4, shipping: 3, packaging: 4, service: 4, created_at: "2026-11-16T15:10:00Z", order_number: "PP-O100041" },
    { id: "d2", status: "pending", display_name: "Amy R.", accuracy: 4, shipping: 4, packaging: 4, service: 4, created_at: "2026-11-15T21:40:00Z", order_number: "PP-O100038" },
    { id: "d3", status: "pending", display_name: "Kevin D.", accuracy: 3, shipping: 2, packaging: 3, service: 4, created_at: "2026-11-14T18:05:00Z", order_number: "PP-O100035" },
    { id: "d4", status: "approved", display_name: "Derek M.", accuracy: 4, shipping: 4, packaging: 4, service: 4, created_at: "2026-11-12T12:00:00Z", order_number: "PP-O100031" },
    { id: "d5", status: "hidden", display_name: "Verified buyer", accuracy: 4, shipping: 4, packaging: 4, service: 4, created_at: "2026-11-10T12:00:00Z", order_number: "PP-O100029" }];
  let rows = [], tab = "pending", host = null;

  async function load() {
    if (DEMO) return SAMPLE.map(r => ({ ...r }));
    const { data, error } = await P.client().from("ppu_reviews").select("id,order_id,status,display_name,accuracy,shipping,packaging,service,created_at,reviewed_at,orders(order_number)").order("created_at", { ascending: false }).limit(300);
    if (error) throw error;
    return (data || []).map(r => ({ ...r, order_number: r.orders?.order_number || "" }));
  }
  async function pane(el) {
    host = el; el.innerHTML = `<p class="muted">Loading…</p>`;
    try { rows = await load(); } catch (e) { el.innerHTML = `<p class="notice err">Couldn't load ratings: ${esc(e.message)}</p>`; return; }
    if (!rows.some(r => r.status === tab)) tab = rows.some(r => r.status === "pending") ? "pending" : "approved";
    draw();
  }
  function summary() {
    const ok = rows.filter(r => r.status === "approved"), RV = R();
    if (!ok.length) return `<p class="muted small">Nothing approved yet. Your homepage shows ratings once ${3} are approved.</p>`;
    const a = k => ok.reduce((s, r) => s + Number(r[k]), 0) / ok.length, all = ok.reduce((s, r) => s + RV.avg(r), 0) / ok.length;
    return `<div class="orvsum"><div class="orvall"><b>${RV.fmt(all)}</b>${RV.stars(all, 16)}<span class="muted small">${ok.length} approved${ok.length < 3 ? ` · shows on your homepage at 3` : " · on your homepage"}</span></div>
<div class="orvcats">${RV.CATS.map(([k, t]) => `<div><span>${esc(t)}</span>${RV.stars(a(k), 13)}<b>${RV.fmt(a(k))}</b></div>`).join("")}</div></div>`;
  }
  function card(r) {
    const RV = R(), when = P.fmtDate ? P.fmtDate(r.created_at) : String(r.created_at).slice(0, 10);
    return `<article class="orv" data-rid="${esc(r.id)}"><div class="orvh"><div><b>${esc(r.display_name || "Verified buyer")}</b><span class="muted small">${esc(r.order_number || "")} · ${esc(when)}</span></div><div class="orvavg">${RV.stars(RV.avg(r), 15)}<b>${RV.fmt(RV.avg(r))}</b></div></div>
<div class="orvrows">${RV.CATS.map(([k, t]) => `<div><span>${esc(t)}</span>${RV.stars(r[k], 13)}<small>${RV.WORDS[r[k]] || ""}</small></div>`).join("")}</div>
<div class="orvb">${r.status !== "approved" ? `<button type="button" class="btn primary sm" data-rv="approved">Approve</button>` : ""}${r.status !== "hidden" ? `<button type="button" class="btn ghost sm" data-rv="hidden">${r.status === "approved" ? "Take down" : "Don't post"}</button>` : ""}</div></article>`;
  }
  function draw() {
    const n = s => rows.filter(r => r.status === s).length, list = rows.filter(r => r.status === tab);
    host.innerHTML = `${DEMO ? `<p class="notice">Sample ratings (preview). Nothing here is saved.</p>` : ""}${summary()}
<div class="chips orvtabs" role="tablist">${[["pending", "Waiting"], ["approved", "Approved"], ["hidden", "Not posted"]].map(([k, t]) => `<button type="button" role="tab" class="chip${tab === k ? " on" : ""}" aria-selected="${tab === k}" data-tab="${k}">${t} (${n(k)})</button>`).join("")}</div>
<p class="muted small">${tab === "pending" ? "Approved ratings count toward your homepage scores. The homepage shows the customer's first name and last initial with their stars." : tab === "approved" ? "These count on your homepage. Take one down any time." : "These never show on your site. You can still approve one later."}</p>
<div class="orvlist">${list.map(card).join("") || `<p class="muted">${tab === "pending" ? "Nothing waiting. New ratings show up here and in your bell." : "None."}</p>`}</div>`;
    host.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { tab = b.dataset.tab; draw(); });
    host.querySelectorAll("[data-rv]").forEach(b => b.onclick = async () => {
      const id = b.closest("[data-rid]").dataset.rid, to = b.dataset.rv, r = rows.find(x => String(x.id) === id);
      b.disabled = true;
      if (!DEMO) {
        const me = await P.getUser?.().catch(() => null);
        const { error } = await P.client().from("ppu_reviews").update({ status: to, reviewed_at: new Date().toISOString(), reviewed_by: me?.id || null }).eq("id", id);
        if (error) { b.disabled = false; P.toast?.(`Couldn't save: ${error.message}`); return; }
      }
      r.status = to; P.toast?.(to === "approved" ? "Approved. It counts on your homepage now." : "Kept off your site."); draw();
    });
  }
  // pending count for the More card
  async function pendingCount() { if (DEMO) return SAMPLE.filter(r => r.status === "pending").length;
    const { count } = await P.client().from("ppu_reviews").select("id", { count: "exact", head: true }).eq("status", "pending"); return count || 0; }
  window.PPUReviewsOwner = { pane, pendingCount };
})();
