/* Patriot Peptides USA · owner app: buy and print shipping labels (Nov 2026)
   Order → "Buy & print label": pick a box preset (or type the size), choose what's in the box, get live USPS/UPS rates
   from Shippo, buy one, print the 4×6 PDF. The shipment is recorded the same way "Ship it" does (order_shipments +
   order_shipment_items, shipped / partially shipped), then the usual "Shipped" email preview opens.
   The Shippo key lives only in the ship-label edge function. Settings (ship-from address, box presets) live in
   ppu_ship_settings, editable from the label sheet. Every label is kept in ppu_shipping_labels (reprint, void). */
(function () {
  "use strict";
  const P = window.PST; if (!P) return;
  const { $, $$, esc, money } = P;

  const css = `.lbrates{display:grid;gap:8px;margin:8px 0}.osheet label.lbrate{display:flex;flex-direction:row;gap:10px;align-items:center;border:1px solid var(--line);padding:10px 12px;margin:0;cursor:pointer;border-radius:4px}
.osheet label.lbrate:has(input:checked){border-color:var(--gold);background:rgba(201,164,92,.08)}.osheet .lbrate input{width:18px;height:18px;min-height:0;flex:none;margin:0;accent-color:var(--gold)}
.lbrate span{flex:1;display:flex;flex-direction:column;min-width:0}.lbrate small{color:var(--muted);font-size:12.5px}.lbrate b.p{font-size:1.05rem;flex:none}
.lbtag{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.04em;padding:1px 6px;border-radius:3px;background:var(--gold);color:#111;margin-left:6px;vertical-align:1px}
.lbdims{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.lbdims label{font-size:12.5px}.lbdims input{width:100%}
.lbtest{border:1px dashed var(--gold);padding:8px 10px;font-size:13px;margin:8px 0}.lbdone{text-align:center}.lbdone .trk{font-size:1.1rem;font-weight:700;letter-spacing:.03em;word-break:break-all}
.lbbox{margin-top:12px}.lbrow{display:flex;gap:10px;align-items:center;justify-content:space-between;border-top:1px solid var(--line);padding:8px 0;font-size:14px}
.lbrow span{display:flex;flex-direction:column}.lbrow small{color:var(--muted)}.lbrow .acts{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.lbpk{display:grid;grid-template-columns:repeat(4,1fr) auto;gap:6px;align-items:end;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--line)}.lbpk label:first-child{grid-column:1/-1}.lbpk input{width:100%;min-width:0}
.opill.exp{background:#c3262c;color:#fff}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  /* ---------- server ---------- */
  async function call(action, body = {}) {
    const { data } = await P.client().auth.getSession();
    const r = await fetch(`${P.CFG.url}/functions/v1/${P.CFG.labelFn || "ship-label"}`, { method: "POST", headers: { "Content-Type": "application/json", apikey: P.CFG.key, Authorization: `Bearer ${data?.session?.access_token || P.CFG.key}` }, body: JSON.stringify({ action, ...body }) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.ok === false) { const e = new Error(j?.error || (r.status === 404 ? "The label service isn't installed yet (ship-label function)." : `Label service error (${r.status}).`)); e.needsConfirm = !!j?.needs_confirm; throw e; }
    return j;
  }
  // v116 (Mike/Jeff): Print label opens the print dialog on every browser. Printing a PDF inside a page is unreliable (Safari and the
  // PDF viewer refuse), so the label PDF (passed through the ship-label function) is drawn to a picture with pdf.js, placed on a plain
  // page sized to the label (4×6 by default) and that page prints. Works on desktop Chrome/Safari/Edge and iPhone (AirPrint).
  const isPhone = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  let pdfjsP = null;
  const loadPdfjs = () => pdfjsP || (pdfjsP = new Promise((res, rej) => { if (window.pdfjsLib) return res(window.pdfjsLib);
    const s = document.createElement("script"); s.src = PDFJS + "pdf.min.js"; s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js"; res(window.pdfjsLib); }; s.onerror = () => { pdfjsP = null; rej(new Error("pdf.js didn't load")); }; document.head.appendChild(s); }));
  async function labelPicture(l) {
    const { data } = await P.client().auth.getSession();
    const r = await fetch(`${P.CFG.url}/functions/v1/${P.CFG.labelFn || "ship-label"}`, { method: "POST", headers: { "Content-Type": "application/json", apikey: P.CFG.key, Authorization: `Bearer ${data?.session?.access_token || P.CFG.key}` }, body: JSON.stringify({ action: "file", label_id: l.id }) });
    if (!r.ok || !/pdf/i.test(r.headers.get("Content-Type") || "")) throw new Error("The label file didn't come through.");
    const lib = await loadPdfjs(), doc = await lib.getDocument({ data: await r.arrayBuffer() }).promise, pages = [];
    for (let n = 1; n <= Math.min(doc.numPages, 4); n++) {
      const pg = await doc.getPage(n), base = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: 300 / 72 }); // 300 dpi: crisp barcodes
      const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: g, viewport: vp }).promise;
      pages.push({ src: c.toDataURL("image/png"), w: base.width / 72, h: base.height / 72 }); // inches
    }
    return pages;
  }
  const printHtml = pages => { const { w, h } = pages[0];
    return `<!doctype html><html><head><meta charset="utf-8"><title>Shipping label</title><style>@page{size:${w}in ${h}in;margin:0}html,body{margin:0;padding:0;background:#fff}
img{display:block;width:${w}in;height:${h}in;page-break-after:always;break-after:page}img:last-child{page-break-after:auto;break-after:auto}
@media screen{body{background:#eee}img{margin:12px auto;box-shadow:0 1px 6px rgba(0,0,0,.25);max-width:96vw;height:auto}}</style></head>
<body>${pages.map(p => `<img src="${p.src}" alt="Shipping label">`).join("")}</body></html>`; };
  async function printLabel(l, btn) {
    const old = btn?.innerHTML; if (btn) { btn.textContent = "Opening printer…"; btn.setAttribute("aria-busy", "true"); btn.disabled = true; }
    try {
      const html = printHtml(await labelPicture(l));
      document.querySelectorAll("iframe[data-lbprint]").forEach(f => f.remove());
      const f = document.createElement("iframe"); f.dataset.lbprint = "1"; f.title = "Shipping label";
      f.style.cssText = "position:fixed;right:0;bottom:0;width:4in;height:6in;border:0;opacity:0;pointer-events:none;z-index:-1";
      document.body.appendChild(f);
      const d = f.contentWindow.document; d.open(); d.write(html); d.close();
      await Promise.all([...d.images].map(im => im.decode ? im.decode().catch(() => {}) : new Promise(r => im.complete ? r() : (im.onload = r))));
      setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch { const u = URL.createObjectURL(new Blob([html], { type: "text/html" })); window.open(u, "_blank"); } }, 150);
    } catch (e) { P.toast(`${e.message || "Couldn't open the printer"}. Opening the label file instead.`); window.open(l.label_url, "_blank", "noopener"); }
    finally { if (btn) { btn.innerHTML = old; btn.removeAttribute("aria-busy"); btn.disabled = false; } }
  }
  async function getSettings() {
    const { data, error } = await P.client().from("ppu_ship_settings").select("*").eq("id", 1).maybeSingle();
    if (error) throw new Error(/does not exist|schema cache/i.test(error.message || "") ? "Shipping labels aren't installed yet (run 99h_shipping_labels.sql)." : error.message);
    return data || { packages: [] };
  }
  const ready = s => !!(s && s.from_street1 && s.from_city && s.from_state && s.from_zip && s.from_phone);
  const isExpress = o => o.shipping_service === "express" || /Delivery method: Shipping · EXPRESS/i.test(o.customer_notes || "");

  /* ---------- settings: ship-from address + box presets ---------- */
  function settingsSheet(s, after) {
    const pk = (s.packages && s.packages.length ? s.packages : [{ name: "", length: "", width: "", height: "", weight_oz: "" }]);
    const pkRow = (p, i) => `<div class="lbpk" data-pk="${i}"><label>Name<input name="pn" value="${esc(p.name || "")}" placeholder="Padded mailer"></label><label>L in<input name="pl" inputmode="decimal" value="${esc(p.length ?? "")}"></label><label>W in<input name="pw" inputmode="decimal" value="${esc(p.width ?? "")}"></label><label>H in<input name="ph" inputmode="decimal" value="${esc(p.height ?? "")}"></label><label>oz<input name="po" inputmode="decimal" value="${esc(p.weight_oz ?? "")}"></label><button class="btn ghost sm" type="button" data-pkrm aria-label="Remove this box">✕</button></div>`;
    const w = P.sheet(`<form class="osheet" data-lbset><h2 class="serif">Shipping label settings</h2>
<p class="kick" style="margin:10px 0 6px">Ship from (printed as the return address)</p>
<label>Name<input name="from_name" value="${esc(s.from_name || "")}" placeholder="Your name"></label>
<label>Company<input name="from_company" value="${esc(s.from_company ?? "Patriot Peptides USA")}"></label>
<label>Street<input name="from_street1" value="${esc(s.from_street1 || "")}" autocomplete="address-line1" required></label>
<label>Apt, suite (optional)<input name="from_street2" value="${esc(s.from_street2 || "")}" autocomplete="address-line2"></label>
<div class="row" style="display:grid;grid-template-columns:2fr 1.2fr 1fr;gap:8px"><label>City<input name="from_city" value="${esc(s.from_city || "")}" required></label><label>State${P.stateSelect("from_state", s.from_state || "", "required")}</label><label>ZIP<input name="from_zip" value="${esc(s.from_zip || "")}" inputmode="numeric" required></label></div>
<label>Phone (carriers require it)<input name="from_phone" type="tel" value="${esc(s.from_phone || "")}" required></label>
<label>Email (optional)<input name="from_email" type="email" value="${esc(s.from_email || "")}"></label>
<p class="kick" style="margin:16px 0 6px">Your boxes</p><p class="muted small" style="margin:0 0 8px">Size in inches, packed weight in ounces. These show up as one-tap choices when you buy a label.</p>
<div data-pks>${pk.map(pkRow).join("")}</div><button class="btn ghost sm" type="button" data-pkadd>+ Add a box</button>
<label style="margin-top:14px">Label size<select name="label_format">${[["PDF_4x6", "4×6 (thermal label printer)"], ["PDF", "8.5×11 (regular printer)"]].map(([v, t]) => `<option value="${v}"${(s.label_format || "PDF_4x6") === v ? " selected" : ""}>${t}</option>`).join("")}</select></label>
<p class="status" data-lbss role="status"></p><button class="btn primary wide" type="submit">Save settings</button></form>`, { label: "Shipping label settings" });
    w.classList.add("full");
    const f = w.querySelector("form"), list = f.querySelector("[data-pks]");
    f.querySelector("[data-pkadd]").addEventListener("click", () => { list.insertAdjacentHTML("beforeend", pkRow({}, list.children.length)); });
    list.addEventListener("click", e => { if (e.target.closest("[data-pkrm]")) e.target.closest("[data-pk]").remove(); });
    f.addEventListener("submit", async e => {
      e.preventDefault(); const b = f.querySelector("[type=submit]"), out = f.querySelector("[data-lbss]");
      const packages = $$("[data-pk]", f).map(r => ({ name: r.querySelector("[name=pn]").value.trim(), length: Number(r.querySelector("[name=pl]").value), width: Number(r.querySelector("[name=pw]").value), height: Number(r.querySelector("[name=ph]").value), weight_oz: Number(r.querySelector("[name=po]").value) }))
        .filter(p => p.name || p.length || p.width || p.height || p.weight_oz);
      const bad = packages.find(p => !p.name || !(p.length > 0) || !(p.width > 0) || !(p.height > 0) || !(p.weight_oz > 0));
      if (bad) { out.textContent = "Each box needs a name, a size and a weight (numbers above 0)."; return; }
      const row = { from_name: f.from_name.value.trim(), from_company: f.from_company.value.trim(), from_street1: f.from_street1.value.trim(), from_street2: f.from_street2.value.trim(), from_city: f.from_city.value.trim(), from_state: f.from_state.value, from_zip: f.from_zip.value.trim(), from_phone: f.from_phone.value.trim(), from_email: f.from_email.value.trim(), packages, label_format: f.label_format.value, updated_at: new Date().toISOString() };
      b.disabled = true; b.textContent = "Saving…";
      const { error } = await P.client().from("ppu_ship_settings").update(row).eq("id", 1);
      if (error) { out.textContent = error.message || "Couldn't save."; b.disabled = false; b.textContent = "Save settings"; return; }
      P.toast("Label settings saved"); if (after) after({ ...s, ...row }); else P.closeSheet();
    });
  }

  /* ---------- buy a label ---------- */
  // api = { orders: ctx, recordShipment, sendEmail, shipHistory, shippedMap, done, reopen }
  async function open(o, api) {
    let s;
    try { s = await getSettings(); } catch (e) { P.toast(e.message); return; }
    if (!ready(s)) { P.toast("First, add your ship-from address"); return settingsSheet(s, ns => open(o, api)); }
    const hist = await api.shipHistory(o), m = api.shippedMap(hist);
    const its = (api.items(o) || []).map(i => ({ ...i, left: Math.max(0, Number(i.quantity || 1) - (m.get(String(i.id)) || 0) - Math.max(0, Number(i.backorder_quantity || 0))) })).filter(i => Number(i.quantity || 1) - (m.get(String(i.id)) || 0) > 0);
    if (!its.length) { P.toast("Everything on this order has already shipped."); return; }
    const pks = Array.isArray(s.packages) ? s.packages : [];
    const exp = isExpress(o);
    const w = P.sheet(`<form class="osheet" data-lbf><h2 class="serif">Label for ${esc(o.order_number || "")}</h2>
${exp ? `<p class="small"><span class="opill exp">EXPRESS</span> Customer paid for Express. Pick Priority Mail Express below.</p>` : ""}
<p class="muted small" style="margin:4px 0 0">To: ${esc([o.shipping_name || o.customer_name, o.shipping_address_line1 || o.shipping_address, o.shipping_city, o.shipping_state, o.shipping_zip].filter(Boolean).join(", "))}</p>
<p class="kick" style="margin:14px 0 6px">Box</p>
<div class="chips" data-pkchips>${pks.map((p, i) => `<label class="chip"><input type="radio" name="pkp" value="${i}"${i === 0 ? " checked" : ""}><span>${esc(p.name)}</span></label>`).join("")}<label class="chip"><input type="radio" name="pkp" value="custom"${pks.length ? "" : " checked"}><span>Other size</span></label></div>
<div class="lbdims" data-dims><label>Length in<input name="l" inputmode="decimal" required></label><label>Width in<input name="w" inputmode="decimal" required></label><label>Height in<input name="h" inputmode="decimal" required></label><label>Weight oz<input name="oz" inputmode="decimal" required></label></div>
<p class="kick" style="margin:14px 0 6px">What's in this box</p>${its.map(i => `<div class="shiprow"><span>${esc(i.product_name)} ${esc(i.product_strength || "")}${i.backorder_quantity ? ` <span class="bo">· ${i.backorder_quantity} waiting on stock</span>` : ""}</span><input type="number" min="0" max="${i.left}" value="${i.left}" inputmode="numeric" data-sq="${i.id}" aria-label="Quantity"><span class="muted small">of ${Number(i.quantity || 1) - (m.get(String(i.id)) || 0)}</span></div>`).join("")}
<div data-rates></div>
<p class="status" data-lbs role="status"></p>
<button class="btn primary wide" type="submit" data-go>Get rates</button>
<button class="btn ghost wide" type="button" data-lbsettings style="margin-top:8px">Label settings</button></form>`, { label: "Buy a label" });
    w.classList.add("full");
    const f = w.querySelector("form"), out = f.querySelector("[data-lbs]"), go = f.querySelector("[data-go]"), ratesEl = f.querySelector("[data-rates]");
    let quote = null; // { shipment_id, rates, package }
    const fill = () => { const v = f.pkp.value, p = v === "custom" ? null : pks[Number(v)]; if (p) { f.l.value = p.length; f.w.value = p.width; f.h.value = p.height; f.oz.value = p.weight_oz; } };
    const pkg = () => ({ name: f.pkp.value === "custom" ? "Other size" : (pks[Number(f.pkp.value)]?.name || ""), length: Number(f.l.value), width: Number(f.w.value), height: Number(f.h.value), weight_oz: Number(f.oz.value) });
    const lines = () => $$("[data-sq]", f).map(x => ({ id: x.dataset.sq, qty: Number(x.value || 0), max: Number(x.max) })).filter(x => x.qty !== 0);
    const reset = () => { if (quote) { quote = null; ratesEl.innerHTML = ""; go.textContent = "Get rates"; } };
    fill();
    f.addEventListener("change", e => { if (e.target.name === "pkp") { fill(); reset(); } });
    f.addEventListener("input", e => { if (["l", "w", "h", "oz"].includes(e.target.name)) reset(); });
    f.querySelector("[data-lbsettings]").addEventListener("click", () => settingsSheet(s, ns => open(o, api)));
    f.addEventListener("submit", async e => {
      e.preventDefault(); out.textContent = ""; out.className = "status";
      const p = pkg(), ls = lines();
      if (![p.length, p.width, p.height, p.weight_oz].every(n => n > 0)) { out.textContent = "Enter the box size and weight."; return; }
      if (!ls.length || ls.some(x => !Number.isInteger(x.qty) || x.qty < 1 || x.qty > x.max)) { out.textContent = "Choose a valid quantity for at least one item."; return; }
      if (!quote) { // step 1: rates
        go.disabled = true; go.textContent = "Getting rates…";
        try {
          const j = await call("rates", { order_id: o.id, package: p });
          if (!j.rates.length) { out.textContent = `No rates came back.${j.messages?.length ? " " + j.messages.join(" ") : " Check the address and box size."}`; go.disabled = false; go.textContent = "Get rates"; return; }
          quote = { ...j, package: p };
          const pick = (exp && j.rates.find(r => r.express_match)) || j.rates.find(r => /usps/i.test(r.carrier) && /ground/i.test(r.token)) || j.rates[0];
          ratesEl.innerHTML = `${j.test_mode ? `<p class="lbtest"><b>Test mode.</b> Labels are free samples and can't be mailed. Switch to your live Shippo key to buy real postage.</p>` : ""}<p class="kick" style="margin:14px 0 6px">Rates</p><div class="lbrates">${j.rates.map(r => `<label class="lbrate"><input type="radio" name="rate" value="${esc(r.id)}"${r === pick ? " checked" : ""}><span><b>${esc(r.carrier)} ${esc(r.service)}${r.express_match && exp ? '<i class="lbtag">EXPRESS</i>' : ""}${(r.tags || []).includes("CHEAPEST") ? '<i class="lbtag">Cheapest</i>' : ""}${(r.tags || []).includes("FASTEST") ? '<i class="lbtag">Fastest</i>' : ""}</b><small>${r.days ? `About ${r.days} day${r.days === 1 ? "" : "s"}` : esc(r.terms || "Delivery time not given")}</small></span><b class="p">${money(r.amount)}</b></label>`).join("")}</div>${j.messages?.length ? `<p class="muted small">${j.messages.map(esc).join("<br>")}</p>` : ""}`;
          const label = () => { const r = quote.rates.find(x => x.id === f.rate?.value); go.textContent = r ? `Buy label · ${money(r.amount)}` : "Pick a rate"; };
          ratesEl.addEventListener("change", label); label(); go.disabled = false;
        } catch (err) { out.textContent = err.message; go.disabled = false; go.textContent = "Get rates"; }
        return;
      }
      // step 2: buy
      const rate = quote.rates.find(x => x.id === f.rate?.value); if (!rate) { out.textContent = "Pick a rate."; return; }
      let detached = false; // a confirm sheet replaced this form: report problems as a toast and reopen
      const fail = msg => { if (detached) { P.toast(msg); return open(o, api); } out.textContent = msg; go.disabled = false; go.textContent = `Buy label · ${money(rate.amount)}`; };
      if (exp && !rate.express_match) { detached = true; if (!(await api.confirmSheet("Not Express?", `The customer paid ${money(P.CFG.expressRate)} for Express, and you picked ${esc(rate.carrier)} ${esc(rate.service)}.`, "Buy it anyway"))) return open(o, api); P.toast("Buying the label…"); }
      go.disabled = true; go.textContent = "Buying…";
      let label;
      const buy = async allow => (await call("buy", { order_id: o.id, rate_id: rate.id, shipment_id: quote.shipment_id, package: quote.package, allow_another: !!allow })).label;
      try { label = await buy(false); }
      catch (err) {
        if (!err.needsConfirm) return fail(err.message);
        detached = true;
        if (!(await api.confirmSheet("Buy a second label?", esc(err.message), "Buy another label"))) return open(o, api);
        P.toast("Buying the label…");
        try { label = await buy(true); } catch (e2) { return fail(e2.message); }
      }
      // step 3: record the shipment (same as "Ship it") and show print
      const carrier = /usps/i.test(label.carrier) ? "USPS" : /ups/i.test(label.carrier) ? "UPS" : /fedex/i.test(label.carrier) ? "FedEx" : label.carrier;
      let rec = null, recErr = "";
      // v117: a test label can't be mailed, so it never marks the order shipped (Jeff's test labels had put real orders on "shipped")
      if (label.test_mode) rec = { test: true };
      else try { rec = await api.recordShipment(o, carrier, label.tracking_number, ls, hist); } catch (e2) { recErr = e2.message || "unknown error"; }
      doneSheet(o, api, label, carrier, ls, rec, recErr);
    });
  }

  function doneSheet(o, api, label, carrier, ls, rec, recErr) {
    const w = P.sheet(`<div class="osheet lbdone"><div class="okc">${P.icon("check", 30)}</div><h2 class="serif">Label bought</h2>
<p class="muted">${esc(label.carrier)} ${esc(label.service)} · ${money(label.amount)}${label.test_mode ? " · TEST" : ""}</p><p class="trk">${esc(label.tracking_number || "")}</p>
<button class="btn primary wide" type="button" data-lbprint>${P.icon ? P.icon("truck", 16) : ""} Print label</button>
<a class="small muted" href="${esc(label.label_url)}" target="_blank" rel="noopener" style="display:inline-block;margin-top:6px">Or open the label file</a>
${rec?.test ? `<p class="lbtest" style="margin-top:10px"><b>Test label.</b> It can't be mailed, so the order was left as it was (not marked shipped, no email).</p>`
  : recErr ? `<p class="notice err" style="margin-top:10px">The label is bought, but the shipment didn't save on the order: ${esc(recErr)}. Use "Ship it (add tracking)" with the tracking number above.</p>` : `<p class="muted small" style="margin-top:10px">Saved on the order as ${rec?.complete ? "shipped" : "partly shipped"}.</p>`}
${recErr || rec?.test ? "" : `<button class="btn ghost wide" type="button" data-lbemail style="margin-top:8px">Next: ${rec?.complete ? "shipped" : "shipment update"} email</button>`}
<button class="btn ghost wide" type="button" data-lbclose style="margin-top:8px">Done</button></div>`, { label: "Label bought" });
    w.classList.add("full");
    w.querySelector("[data-lbprint]").addEventListener("click", e => printLabel(label, e.currentTarget));
    if (!isPhone()) printLabel(label, w.querySelector("[data-lbprint]")); // desktop: go straight to the print dialog once the label is bought
    w.querySelector("[data-lbclose]").addEventListener("click", () => api.done(o, rec?.test ? "Test label bought" : rec?.complete ? "Shipped" : "Label bought"));
    w.querySelector("[data-lbemail]")?.addEventListener("click", async () => {
      const items = api.items(o) || [];
      const sl = items.filter(i => ls.some(l => String(l.id) === String(i.id))).map(i => { const q = ls.find(l => String(l.id) === String(i.id)).qty; return { ...i, quantity: q, line_total: Math.round(Number(i.unit_price || 0) * q * 100) / 100 }; });
      const sent = await api.sendEmail(o, rec.complete ? "order_shipped" : "shipment_update", { carrier, tracking: label.tracking_number, trackingUrl: label.tracking_url || undefined, lines: sl, remaining: rec.remaining });
      api.done(o, (rec.complete ? "Shipped" : "Partial shipment recorded") + (sent ? " · email sent" : " · email not sent"));
    });
  }

  /* ---------- labels already bought for an order: reprint / void ---------- */
  async function mount(o, el, api) {
    if (!el) return;
    const { data, error } = await P.client().from("ppu_shipping_labels").select("*").eq("order_id", o.id).order("created_at", { ascending: false });
    if (error || !data?.length) { el.innerHTML = ""; return; }
    const stt = { purchased: "", void_pending: " · void requested", voided: " · voided (refund on its way)", void_rejected: " · void refused by the carrier" };
    el.innerHTML = `<div class="lbbox"><p class="kick" style="margin:0 0 4px">Shipping labels</p>${data.map(l => `<div class="lbrow"><span><b>${esc(l.carrier)} ${esc(l.service)} · ${money(l.amount)}${l.test_mode ? " · TEST" : ""}</b><small>${esc(l.tracking_number || "")}${stt[l.status] || ""} · ${esc(P.fmtDate(l.created_at))}</small></span><span class="acts">${l.label_url && l.status === "purchased" ? `<button class="btn ghost sm" type="button" data-lbreprint="${esc(l.id)}">Reprint</button><button class="btn ghost sm" type="button" data-lbvoid="${esc(l.id)}">Void</button>` : ""}</span></div>`).join("")}</div>`;
    el.addEventListener("click", async e => {
      const rp = e.target.closest("[data-lbreprint]"); if (rp) { e.stopPropagation(); return printLabel(data.find(x => x.id === rp.dataset.lbreprint), rp); }
      const b = e.target.closest("[data-lbvoid]"); if (!b) return; e.stopPropagation();
      const l = data.find(x => x.id === b.dataset.lbvoid);
      if (!(await api.confirmSheet("Void this label?", `${esc(l.carrier)} ${esc(l.service)} · ${esc(l.tracking_number || "")}<br><br>Only void a label that hasn't been mailed. ${l.test_mode ? "Test labels cost nothing." : `The ${money(l.amount)} is refunded to your Shippo account, usually within a few weeks.`} If this label's shipment is on the order, it comes off too, so you can buy a new label, ship it another way or mark it hand delivered.`, "Void label", true))) return api.reopen(o);
      let j = null;
      try { j = await call("void", { label_id: l.id }); } catch (err) { P.toast(err.message); return api.reopen(o); }
      if (j.status === "void_rejected") { P.toast("The carrier refused the void (it may already be scanned). The order wasn't changed."); return api.reopen(o); }
      // v117: take this label's shipment back off the order so the normal choices come back
      let undone = false; try { undone = await api.undoShipment?.(o, l.tracking_number, true); } catch (err) { P.toast(`Label voided, but the shipment is still on the order: ${err.message}`); return api.reopen(o); }
      P.toast(`${j.status === "voided" ? "Label voided" : "Void requested"}${undone ? " · shipment taken off the order" : ""}`);
      api.reopen(o);
    });
  }

  window.PPULabels = { open, mount, print: printLabel, settingsSheet: () => getSettings().then(s => settingsSheet(s)).catch(e => P.toast(e.message)), isExpress };
})();
