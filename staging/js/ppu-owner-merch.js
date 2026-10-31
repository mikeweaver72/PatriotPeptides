/* Patriot Peptides USA · Owner app → Products → Merch (v1, Oct 31 2026).
   One merch item = one name with colors × sizes. Each color/size is its own product row (key PPM######) with its own stock,
   so the bag, checkout, orders and sold-out alerts work like everything else. Photos go to the merch-photos bucket. */
(() => {
  const P = window.PST, esc = P.esc, money = P.money;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const PRESET = ["XS", "S", "M", "L", "XL", "2XL", "3XL"];
  const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "2XL", "XXL", "3XL", "XXXL", "4XL", "5XL"];
  const sizeRank = s => { const i = SIZE_ORDER.indexOf(String(s || "").toUpperCase()); return i < 0 ? 50 : i; };
  const slug = s => String(s || "item").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "item";
  const uniq = a => [...new Set(a.filter(Boolean))];
  let rows = [], inv = {}, host = null;

  async function load() {
    const [c, i] = await Promise.all([P.client().from("product_catalog").select("*").ilike("category", "merch"),
      P.client().from("product_inventory").select("product_key,current_inventory,is_active").ilike("category", "merch")]);
    if (c.error) throw c.error;
    rows = c.data || []; inv = Object.fromEntries((i.data || []).map(x => [x.product_key, x]));
  }
  const stockOf = r => Number(inv[r.product_key]?.current_inventory ?? r.current_inventory ?? 0);
  const itemsOf = () => P.groups(rows).map(vs => ({ name: vs[0].display_name, vs, live: vs.filter(v => v.is_active !== false) }))
    .sort((a, b) => (b.live.length > 0) - (a.live.length > 0) || a.name.localeCompare(b.name));

  async function pane(el) {
    host = el; el.innerHTML = `<p class="muted small">Loading…</p>`;
    try { await load(); } catch (err) { el.innerHTML = `<p class="notice err">${esc(err.message)}</p>`; return; }
    const its = itemsOf();
    el.innerHTML = `<div class="pmtop"><p class="muted small" style="margin:0;flex:1">Shirts, hats and gear. Signed-in customers shop them on the Merch page.</p><button class="btn primary sm" type="button" data-mnew>+ New item</button></div>
${its.length ? `<div class="pmlist">${its.map(it => { const on = it.live.length > 0, vs = on ? it.live : it.vs.filter(v => !v.merch_retired), st = vs.reduce((s, v) => s + stockOf(v), 0), ph = (vs.find(v => v.photo_url) || {}).photo_url, v0 = vs[0], out = vs.filter(v => stockOf(v) <= 0).length;
  return `<div class="pmrow"><button type="button" class="pmmain" data-medit="${esc(it.name)}">${ph ? `<img class="mthumb" src="${esc(ph)}" alt="" width="40" height="40">` : `<span class="mthumb none">${P.icon("shop", 18)}</span>`}<span><b>${esc(it.name)}</b><small>${money(P.unitPrice(v0))}${P.onSale(v0) ? ` · on sale (was ${money(v0.price)})` : ""} · ${vs.length} option${vs.length === 1 ? "" : "s"} · ${st} in stock${out && on ? ` · ${out} sold out` : ""}</small></span></button>
<button type="button" class="pmlive" role="switch" aria-checked="${on}" data-mlive="${esc(it.name)}" aria-label="Live on the Merch page"><i></i><span>${on ? "Live" : "Hidden"}</span></button></div>`; }).join("")}</div>`
  : `<div class="nalbox"><h2 class="serif">No merch yet</h2><p class="muted small">Add your first shirt or hat: name, price, colors, sizes, a photo for each color, and how many you have of each.</p><button class="btn primary" type="button" data-mnew>+ New item</button></div>`}`;
    el.onclick = e => {
      const n = e.target.closest("[data-mnew]"), ed = e.target.closest("[data-medit]"), lv = e.target.closest("[data-mlive]");
      if (n) edit(null); else if (ed) edit(ed.dataset.medit); else if (lv) setLive(lv.dataset.mlive, lv.getAttribute("aria-checked") !== "true", lv);
    };
  }

  async function setLive(name, on, btn) {
    const it = itemsOf().find(i => i.name === name); if (!it) return;
    // turning an item back on brings back the options it last had (anything removed in the editor stays off)
    const keys = (on ? it.vs.filter(v => !v.merch_retired) : it.vs).map(v => v.product_key), now = new Date().toISOString();
    btn.disabled = true;
    const a = await P.client().from("product_catalog").update({ is_active: on, updated_at: now }).in("product_key", keys);
    const b = await P.client().from("product_inventory").update({ is_active: on, updated_at: now }).in("product_key", keys);
    btn.disabled = false;
    if (a.error || b.error) { P.toast("Couldn't change it: " + (a.error || b.error).message); return; }
    P.toast(on ? `${name} is live` : `${name} is hidden`); pane(host);
  }

  // photo → square-ish JPEG, longest side `max`
  function shrink(file, max) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); c.toBlob(b => b ? res(b) : rej(new Error("Couldn't read that photo")), "image/jpeg", 0.85); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Couldn't open that photo. Try a JPG or PNG.")); };
      img.src = url;
    });
  }
  // small square for order emails (email/<key>.jpg), center-cropped
  // ---- Remove background (Oct 31): U²-Net small, Apache-2.0, runs on Jeff's phone. No account, no per-photo cost. ----
  const ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/";
  let ortP = null, sessP = null;
  const loadOrt = () => ortP || (ortP = new Promise((res, rej) => { if (window.ort) return res(window.ort);
    const s = document.createElement("script"); s.src = ORT + "ort.min.js";
    s.onload = () => { window.ort.env.wasm.wasmPaths = ORT; window.ort.env.wasm.numThreads = 1; res(window.ort); };
    s.onerror = () => { ortP = null; rej(new Error("Couldn't load the background tool. Check the connection and try again.")); }; document.head.appendChild(s); }));
  const loadSess = () => sessP || (sessP = Promise.all([loadOrt(), fetch(new URL("img/models/u2netp.onnx", location.href)).then(r => { if (!r.ok) throw new Error("Couldn't load the background tool."); return r.arrayBuffer(); })])
    .then(([o, buf]) => o.InferenceSession.create(new Uint8Array(buf), { executionProviders: ["wasm"] })).catch(e => { sessP = null; throw e; }));
  const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = () => rej(new Error("Couldn't open that photo.")); i.src = src + (src.includes("?") ? "&" : "?") + "t=" + Date.now(); });
  async function cutout(src) {
    const [sess, img] = await Promise.all([loadSess(), loadImg(src)]), N = 320, W = img.naturalWidth, H = img.naturalHeight;
    const a = document.createElement("canvas"); a.width = a.height = N; const ga = a.getContext("2d"); ga.drawImage(img, 0, 0, N, N);
    const px = ga.getImageData(0, 0, N, N).data, inp = new Float32Array(3 * N * N), mean = [0.485, 0.456, 0.406], sd = [0.229, 0.224, 0.225];
    for (let i = 0; i < N * N; i++) for (let ch = 0; ch < 3; ch++) inp[ch * N * N + i] = (px[i * 4 + ch] / 255 - mean[ch]) / sd[ch];
    const out = await sess.run({ [sess.inputNames[0]]: new window.ort.Tensor("float32", inp, [1, 3, N, N]) }), m = out[sess.outputNames[0]].data;
    let lo = Infinity, hi = -Infinity; for (const v of m) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const mk = document.createElement("canvas"); mk.width = mk.height = N; const gm = mk.getContext("2d"), md = gm.createImageData(N, N);
    for (let i = 0; i < N * N; i++) { const v = (m[i] - lo) / (hi - lo + 1e-6), al = Math.max(0, Math.min(1, (v - 0.06) / 0.88)); md.data[i * 4 + 3] = Math.round(al * 255); }
    gm.putImageData(md, 0, 0);
    if (!md.data.some((v, i) => i % 4 === 3 && v > 128)) throw new Error("Couldn't find the item in that photo. Try one with the shirt or hat filling more of the frame.");
    const cut = document.createElement("canvas"); cut.width = W; cut.height = H; const gc = cut.getContext("2d");
    gc.drawImage(img, 0, 0); gc.globalCompositeOperation = "destination-in"; gc.imageSmoothingQuality = "high"; gc.drawImage(mk, 0, 0, W, H);
    const fin = document.createElement("canvas"); fin.width = W; fin.height = H; const gf = fin.getContext("2d"); gf.fillStyle = "#fff"; gf.fillRect(0, 0, W, H); gf.drawImage(cut, 0, 0);
    const blob = await new Promise((res, rej) => fin.toBlob(b => b ? res(b) : rej(new Error("Couldn't finish the photo.")), "image/jpeg", 0.9));
    return { blob, url: URL.createObjectURL(blob) };
  }
  function emailThumb(src) {
    return new Promise((res, rej) => {
      const img = new Image(); img.crossOrigin = "anonymous";
      img.onload = () => { const s = 120, c = document.createElement("canvas"); c.width = c.height = s; const g = c.getContext("2d"), m = Math.min(img.width, img.height);
        g.fillStyle = "#fff"; g.fillRect(0, 0, s, s); g.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, s, s); c.toBlob(b => b ? res(b) : rej(new Error("thumb")), "image/jpeg", 0.85); };
      img.onerror = () => rej(new Error("thumb")); img.src = src + (src.includes("?") ? "&" : "?") + "t=" + Date.now();
    });
  }
  async function upload(path, blob) {
    const s = P.client().storage.from("merch-photos");
    const { error } = await s.upload(path, blob, { upsert: true, contentType: "image/jpeg", cacheControl: "3600" });
    if (error) throw error;
    return s.getPublicUrl(path).data.publicUrl;
  }
  function nextKey() {
    const mx = rows.reduce((m, p) => { const x = String(p.product_key || "").match(/^PPM(\d+)$/i); return x ? Math.max(m, +x[1]) : m; }, 100000);
    return `PPM${String(mx + 1).padStart(6, "0")}`;
  }

  function edit(name) {
    const it = name ? itemsOf().find(i => i.name === name) : null, isNew = !it;
    const vs = it ? it.vs.filter(v => !v.merch_retired) : [], v0 = vs[0] || {};
    const S = {
      colors: it ? uniq(vs.map(v => v.merch_color || "")) : [""], sizes: it ? uniq(vs.map(v => v.merch_size || "")).sort((a, b) => sizeRank(a) - sizeRank(b)) : ["S", "M", "L", "XL", "2XL"],
      photos: {}, stock: {}, busy: false, cut: {}, cutting: ""
    };
    if (!S.colors.length) S.colors = [""]; if (!S.sizes.length) S.sizes = [""];
    vs.forEach(v => { if (v.photo_url && !S.photos[v.merch_color || ""]) S.photos[v.merch_color || ""] = v.photo_url; S.stock[`${v.merch_color || ""}|${v.merch_size || ""}`] = stockOf(v); });
    const salePct = v0.sale_enabled && v0.sale_price && v0.price ? Math.round((1 - v0.sale_price / v0.price) * 100) : "";
    const w = P.sheet(`<form class="pmform mform" data-mform novalidate><h2 class="serif">${isNew ? "New merch item" : esc(it.name)}</h2>
<label>Name<input name="name" required maxlength="60" value="${esc(it?.name || "")}" placeholder="e.g. Old Glory Tee"></label>
<label>Description <span class="muted small">(optional)</span><textarea name="desc" rows="2" maxlength="300" placeholder="Heavyweight cotton, flag on the chest">${esc(v0.merch_desc || "")}</textarea></label>
<div class="pm2"><label>Price<input name="price" type="number" step="0.01" min="0" inputmode="decimal" value="${v0.price != null ? Number(v0.price).toFixed(2) : ""}" placeholder="30.00"></label><label class="toggle" style="align-self:end"><input type="checkbox" name="live"${isNew || it.live.length ? " checked" : ""}> Live on the Merch page</label></div>
<div class="pm2"><label class="toggle"><input type="checkbox" name="sale"${v0.sale_enabled ? " checked" : ""}> On sale</label><span></span></div>
<div class="pm2" data-salebox${v0.sale_enabled ? "" : " hidden"}><label>Percent off<input name="pct" type="number" min="1" max="90" step="1" inputmode="numeric" value="${salePct}" placeholder="20"></label><label>Sale price<input name="sale_price" type="number" step="0.01" min="0" inputmode="decimal" value="${v0.sale_enabled && v0.sale_price ? Number(v0.sale_price).toFixed(2) : ""}"></label></div>
<p class="kick" style="margin:14px 0 6px">Colors</p><p class="muted small" style="margin:0 0 8px">Leave it at "One color" if it only comes in one.</p><div class="mchips" data-colors></div>
<div class="madd"><input data-newcolor maxlength="24" placeholder="Add a color, e.g. Navy" aria-label="New color"><button class="btn ghost sm" type="button" data-addcolor>Add</button></div>
<p class="kick" style="margin:14px 0 6px">Sizes</p><div class="mchips" data-sizes></div>
<div class="madd"><input data-newsize maxlength="12" placeholder="Other size, e.g. 4XL or S/M" aria-label="New size"><button class="btn ghost sm" type="button" data-addsize>Add</button></div>
<p class="kick" style="margin:14px 0 6px">Photos</p><p class="muted small" style="margin:0 0 8px">One per color. Plain background, good light. Front is enough; add the back in a second item later if you want.</p><div class="mphotos" data-photos></div>
<p class="kick" style="margin:14px 0 6px">How many you have</p><div data-grid></div>
<button class="btn primary wide" type="submit" style="margin-top:14px">${isNew ? "Create item" : "Save changes"}</button>
${isNew ? "" : `<button class="btn ghost wide" type="button" data-mremove style="margin-top:8px">Remove from the Merch page</button>`}
<p class="status" data-mst role="status"></p></form>`, { label: isNew ? "New merch item" : "Edit merch item" });
    w.classList.add("full");
    const f = $("form", w), st = $("[data-mst]", w);
    const colorLabel = c => c || "One color", sizeLabel = s => s || "One size";
    const realColors = () => S.colors.filter(c => c !== "" || S.colors.length === 1), realSizes = () => S.sizes.filter(s => s !== "" || S.sizes.length === 1);

    function draw() {
      const cols = realColors(), sizes = realSizes();
      $("[data-colors]", w).innerHTML = cols.map(c => `<span class="mchip">${esc(colorLabel(c))}${c ? `<button type="button" data-rmcolor="${esc(c)}" aria-label="Remove ${esc(c)}">×</button>` : ""}</span>`).join("");
      const pre = PRESET.map(s => `<button type="button" role="checkbox" aria-checked="${sizes.includes(s)}" data-tsize="${s}">${s}</button>`).join("");
      const extra = sizes.filter(s => s && !PRESET.includes(s)).map(s => `<button type="button" role="checkbox" aria-checked="true" data-tsize="${esc(s)}">${esc(s)}</button>`).join("");
      $("[data-sizes]", w).innerHTML = pre + extra + `<button type="button" role="checkbox" aria-checked="${sizes.length === 1 && sizes[0] === ""}" data-onesize>One size</button>`;
      $("[data-photos]", w).innerHTML = cols.map(c => { const cut = S.cut[c];
        if (cut) return `<div class="mphotow"><div class="mphoto mcutp"><img src="${esc(cut.url)}" alt="${esc(colorLabel(c))} with background removed"><small>${esc(colorLabel(c))} · new background</small></div><div class="mcutb"><button type="button" class="btn primary sm" data-cutok="${esc(c)}">Use it</button><button type="button" class="btn ghost sm" data-cutno="${esc(c)}">Keep original</button></div></div>`;
        return `<div class="mphotow"><label class="mphoto">${S.photos[c] ? `<img src="${esc(S.photos[c])}" alt="">` : `<span>${P.icon("plus", 20)}</span>`}<small>${esc(colorLabel(c))}${S.photos[c] ? " · change" : " · add photo"}</small><input type="file" accept="image/*" data-photo="${esc(c)}" hidden></label>${S.photos[c] ? `<button type="button" class="linkish small mcutgo" data-cut="${esc(c)}"${S.cutting ? " disabled" : ""}>${S.cutting === c ? "Working…" : "Remove background"}</button>` : ""}</div>`; }).join("");
      $("[data-grid]", w).innerHTML = `<div class="mgridin" style="grid-template-columns:minmax(70px,auto) repeat(${sizes.length},minmax(52px,1fr))"><span></span>${sizes.map(s => `<b>${esc(sizeLabel(s))}</b>`).join("")}
${cols.map(c => `<b class="mrowl">${esc(colorLabel(c))}</b>${sizes.map(s => `<input type="number" min="0" step="1" inputmode="numeric" aria-label="${esc(colorLabel(c))} ${esc(sizeLabel(s))} on hand" data-stk="${esc(c)}|${esc(s)}" value="${S.stock[`${c}|${s}`] ?? 0}">`).join("")}`).join("")}</div>`;
    }
    draw();

    const syncSale = src => { const pr = Number(f.price.value) || 0, pct = Number(f.pct.value) || 0, sp = Number(f.sale_price.value) || 0;
      if (src === "pct" && pr > 0 && pct > 0) f.sale_price.value = (Math.round(pr * (100 - pct)) / 100).toFixed(2);
      if (src === "sp" && pr > 0 && sp > 0) f.pct.value = Math.max(1, Math.round((1 - sp / pr) * 100)); };
    f.addEventListener("input", e => {
      if (e.target.name === "pct") syncSale("pct"); else if (e.target.name === "sale_price") syncSale("sp"); else if (e.target.name === "price" && f.sale.checked) syncSale("pct");
      if (e.target.matches("[data-stk]")) S.stock[e.target.dataset.stk] = Math.max(0, Math.floor(Number(e.target.value) || 0));
    });
    f.addEventListener("change", async e => {
      if (e.target.name === "sale") { $("[data-salebox]", w).hidden = !f.sale.checked; if (f.sale.checked && !f.pct.value && !f.sale_price.value) { f.pct.value = 20; syncSale("pct"); } }
      const ph = e.target.closest("[data-photo]"); if (!ph || !ph.files[0]) return;
      const c = ph.dataset.photo; st.textContent = "Uploading photo…"; st.className = "status";
      try { const blob = await shrink(ph.files[0], 1400); const url = await upload(`${slug(f.name.value || "item")}/${slug(c || "main")}-${Date.now()}.jpg`, blob); S.photos[c] = url; st.textContent = "Photo added"; st.className = "status good"; draw(); }
      catch (err) { st.textContent = err.message || "Couldn't upload that photo."; st.className = "status bad"; }
    });
    w.addEventListener("click", e => {
      const cg = e.target.closest("[data-cut]"), ck = e.target.closest("[data-cutok]"), cn = e.target.closest("[data-cutno]");
      if (cg && !S.cutting) { const c = cg.dataset.cut; S.cutting = c; draw(); st.textContent = sessP ? "Removing the background…" : "Removing the background… The first time takes a little longer while the tool loads."; st.className = "status";
        cutout(S.photos[c]).then(r => { S.cut[c] = r; st.textContent = "Here's the cleaned-up photo. Use it, or keep the original."; st.className = "status good"; })
          .catch(err => { st.textContent = err.message || "Couldn't remove the background on that one."; st.className = "status bad"; }).finally(() => { S.cutting = ""; draw(); }); return; }
      if (ck) { const c = ck.dataset.cutok, r = S.cut[c]; ck.disabled = true; st.textContent = "Saving the new photo…"; st.className = "status";
        upload(`${slug(f.name.value || "item")}/${slug(c || "main")}-clean-${Date.now()}.jpg`, r.blob).then(url => { S.photos[c] = url; URL.revokeObjectURL(r.url); delete S.cut[c]; st.textContent = "New photo set. Save the item to keep it."; st.className = "status good"; draw(); })
          .catch(err => { ck.disabled = false; st.textContent = err.message || "Couldn't save that photo."; st.className = "status bad"; }); return; }
      if (cn) { const c = cn.dataset.cutno; URL.revokeObjectURL(S.cut[c].url); delete S.cut[c]; st.textContent = ""; draw(); return; }
      const ac = e.target.closest("[data-addcolor]"), as = e.target.closest("[data-addsize]"), rc = e.target.closest("[data-rmcolor]"), ts = e.target.closest("[data-tsize]"), one = e.target.closest("[data-onesize]"), rm = e.target.closest("[data-mremove]");
      if (ac) { const v = $("[data-newcolor]", w).value.trim(); if (!v) return; if (!S.colors.some(c => c.toLowerCase() === v.toLowerCase())) { S.colors = [...S.colors.filter(Boolean), v]; if (S.photos[""] && !S.photos[v] && S.colors.length === 1) S.photos[v] = S.photos[""]; } $("[data-newcolor]", w).value = ""; draw(); }
      else if (as) { const v = $("[data-newsize]", w).value.trim().toUpperCase(); if (!v) return; if (!S.sizes.includes(v)) S.sizes = [...S.sizes.filter(Boolean), v].sort((a, b) => sizeRank(a) - sizeRank(b)); $("[data-newsize]", w).value = ""; draw(); }
      else if (rc) { S.colors = S.colors.filter(c => c !== rc.dataset.rmcolor); if (!S.colors.length) S.colors = [""]; draw(); }
      else if (ts) { const s = ts.dataset.tsize; S.sizes = S.sizes.includes(s) ? S.sizes.filter(x => x !== s) : [...S.sizes.filter(Boolean), s].sort((a, b) => sizeRank(a) - sizeRank(b)); if (!S.sizes.length) S.sizes = [""]; draw(); }
      else if (one) { S.sizes = [""]; draw(); }
      else if (rm) { if (!confirm(`Take ${it.name} off the Merch page? Past orders keep it, and you can turn it back on from the list.`)) return; P.closeSheet(); setLive(it.name, false, rm); }
    });
    w.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.matches("[data-newcolor],[data-newsize]")) { e.preventDefault(); $(e.target.matches("[data-newcolor]") ? "[data-addcolor]" : "[data-addsize]", w).click(); } });

    f.addEventListener("submit", async e => {
      e.preventDefault(); if (S.busy) return;
      const nm = f.name.value.trim(), price = Math.round((Number(f.price.value) || 0) * 100) / 100, sale = f.sale.checked, sp = Math.round((Number(f.sale_price.value) || 0) * 100) / 100, live = f.live.checked;
      const bad = m => { st.textContent = m; st.className = "status bad"; };
      if (!nm) return bad("Give it a name.");
      if (!(price > 0)) return bad("Set a price.");
      if (sale && !(sp > 0 && sp < price)) return bad("The sale price should be above $0 and below the regular price.");
      if (rows.some(r => r.display_name.trim().toLowerCase() === nm.toLowerCase() && (!it || r.display_name !== it.name))) return bad("Another merch item already has that name.");
      if (P.groups && (await P.products().catch(() => [])).some(p => p.display_name.trim().toLowerCase() === nm.toLowerCase())) return bad("A product in the shop already has that name. Pick another.");
      const cols = realColors(), sizes = realSizes();
      S.busy = true; const btn = $("[type=submit]", w); btn.disabled = true; st.textContent = "Saving…"; st.className = "status";
      try {
        const now = new Date().toISOString(), want = [];
        cols.forEach((c, ci) => sizes.forEach((s, si) => want.push({ c, s, sort: ci * 100 + si, n: S.stock[`${c}|${s}`] ?? 0 })));
        const existing = it ? it.vs : [], used = new Set();
        for (const x of want) {
          const strength = [x.c, x.s].filter(Boolean).join(" / ") || "One size";
          const fields = { display_name: nm, sort_name: nm, strength, category: "Merch", price, sale_enabled: sale, sale_price: sale ? sp : null, sale_label: sale ? "Sale" : null,
            merch_color: x.c || null, merch_size: x.s || null, merch_desc: f.desc.value.trim() || null, photo_url: S.photos[x.c] || S.photos[""] || null, merch_sort: x.sort, merch_retired: false, is_active: live, updated_at: now };
          let row = existing.find(v => (v.merch_color || "") === x.c && (v.merch_size || "") === x.s);
          const key = row ? row.product_key : nextKey();
          if (row) {
            const r1 = await P.client().from("product_catalog").update(fields).eq("product_key", key); if (r1.error) throw r1.error;
          } else {
            const r1 = await P.client().from("product_catalog").insert({ product_key: key, current_inventory: x.n, featured: false, hot_peptide: false, coming_soon: false, created_at: now, ...fields }).select("product_key").single();
            if (r1.error) throw r1.error; rows.push({ ...fields, product_key: key });
          }
          used.add(key);
          const before = row ? stockOf(row) : 0;
          const r2 = await P.client().from("product_inventory").upsert({ product_key: key, display_name: nm, category: "Merch", strength, price: sale ? price : price, current_inventory: x.n, low_stock_threshold: 2, limited_stock_threshold: 5, is_active: live, featured: false, blend_stack: false, updated_at: now }, { onConflict: "product_key" });
          if (r2.error) throw new Error(`Saved, but stock for ${strength} didn't: ${r2.error.message}`);
          if (x.n !== before) { const { data: iv } = await P.client().from("product_inventory").select("id").eq("product_key", key).maybeSingle();
            await P.client().from("inventory_movements").insert({ product_id: iv?.id || null, product_key: key, movement_type: "physical_count", quantity_change: x.n - before, previous_quantity: before, new_quantity: x.n, admin_note: `Merch count: ${nm} ${strength}` }).then(() => {}, () => {}); }
          // email picture for this option (order emails show it next to the line)
          const src = fields.photo_url; if (src && (!row || row.photo_url !== src)) { try { await upload(`email/${key}.jpg`, await emailThumb(src)); } catch {} }
        }
        // options he removed: hide them (orders that have them keep them)
        const gone = existing.filter(v => !used.has(v.product_key) && !v.merch_retired).map(v => v.product_key);
        if (gone.length) { await P.client().from("product_catalog").update({ is_active: false, merch_retired: true, updated_at: now }).in("product_key", gone); await P.client().from("product_inventory").update({ is_active: false, updated_at: now }).in("product_key", gone); }
        P.toast(isNew ? `${nm} created` : "Saved"); P.closeSheet(); pane(host);
      } catch (err) { st.textContent = err.message || "Couldn't save."; st.className = "status bad"; btn.disabled = false; S.busy = false; }
    });
  }

  window.PPUMerchOwner = { pane };
})();
