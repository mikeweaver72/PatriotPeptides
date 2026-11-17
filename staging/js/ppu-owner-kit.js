/* Patriot Peptides USA · owner app: Build-A-Kit savings (Nov 10 2026). More → Build-A-Kit savings.
   Jeff sets the kit tiers (any N research vials in the bag = X% off), the BAC water deal, or switches kit savings off.
   Saved to ppu_store_settings.kit_rules (owners write, anyone reads). The bag, checkout, the Build-A-Kit page and the
   homepage line read it (pst-core kitCfg / kitInfo / kitText), so a change shows on the site right away. */
(() => {
  const P = window.PST, esc = P.esc, money = P.money;
  const DEF = { on: true, tiers: [{ vials: 3, pct: 5 }, { vials: 5, pct: 10 }], bac: { on: true, vials: 5, pct: 20 } };
  let rules = null, host = null;

  // the same rounding checkout uses: the kit total rounds DOWN to the whole dollar
  const kitTotal = (base, pct) => Math.floor(Math.round(base * (1 - pct / 100) * 100) / 100 + 1e-9);

  async function pane(el) {
    host = el; el.innerHTML = `<p class="muted">Loading…</p>`;
    const { data, error } = await P.client().from("ppu_store_settings").select("kit_rules").eq("id", 1).maybeSingle();
    if (error) { el.innerHTML = `<p class="notice err">Couldn't load the kit settings: ${esc(error.message)}</p>`; return; }
    rules = JSON.parse(JSON.stringify(data?.kit_rules || DEF));
    rules.tiers = (rules.tiers || []).slice().sort((a, b) => a.vials - b.vials); rules.bac = rules.bac || { on: false, vials: 5, pct: 20 };
    draw();
  }

  function example() {
    const price = 35, t = rules.tiers.filter(x => x.vials >= 2 && x.pct > 0);
    if (!rules.on || !t.length) return `<p class="muted small">Kit savings are off. Shoppers pay the regular price for every vial, and the Build-A-Kit page says savings are paused.</p>`;
    return `<ul class="kitex">${t.map(x => { const base = x.vials * price, tot = kitTotal(base, x.pct); return `<li><b>${x.vials} × ${money(price)} vial</b> = ${money(base)} → <b>${money(tot)}</b> <span class="muted">(saves ${money(base - tot)})</span></li>`; }).join("")}</ul>`;
  }

  function draw() {
    const t = rules.tiers, b = rules.bac;
    host.innerHTML = `<div class="osheet kitset">
<p class="muted small">Savings apply by themselves in the bag and at checkout when a shopper has enough research vials, any mix. 10-vial wholesale kits, supplies and merch never count. Changes show on the site right away.</p>
<label class="kitsw"><input type="checkbox" data-kon ${rules.on ? "checked" : ""}> <b>Kit savings on</b></label>
<div data-ktiers ${rules.on ? "" : "hidden"}>
<h3 class="emhd">Kit sizes</h3>
${t.map((x, i) => `<div class="kitrow" data-i="${i}"><label>Vials<input type="number" inputmode="numeric" min="2" max="50" step="1" value="${esc(x.vials)}" data-kv></label><label>% off<input type="number" inputmode="decimal" min="1" max="50" step="0.5" value="${esc(x.pct)}" data-kp></label><button type="button" class="btn ghost sm" data-kdel aria-label="Remove the ${esc(x.vials)}-vial kit">Remove</button></div>`).join("") || `<p class="muted small">No kit sizes yet.</p>`}
${t.length < 4 ? `<button type="button" class="btn ghost sm" data-kadd>+ Add a kit size</button>` : ""}
</div>
<h3 class="emhd">Example with a $35 vial</h3><div data-kex>${example()}</div>
<h3 class="emhd">BAC water deal</h3>
<label class="kitsw"><input type="checkbox" data-bon ${b.on ? "checked" : ""}> <b>BAC water deal on</b></label>
<div class="kitrow" data-bac ${b.on ? "" : "hidden"}><label>Bottles (or more)<input type="number" inputmode="numeric" min="1" max="50" value="${esc(b.vials)}" data-bv></label><label>% off<input type="number" inputmode="decimal" min="1" max="50" step="0.5" value="${esc(b.pct)}" data-bp></label></div>
<p class="notice err" data-kerr hidden></p>
<div class="kbtns"><button type="button" class="btn primary" data-ksave>Save kit settings</button><button type="button" class="btn ghost" data-kreset>Back to 3 = 5%, 5 = 10%</button></div>
</div>`;
    wire();
  }

  function read() {
    rules.on = host.querySelector("[data-kon]").checked;
    rules.tiers = [...host.querySelectorAll("[data-ktiers] .kitrow")].map(r => ({ vials: Math.round(Number(r.querySelector("[data-kv]").value)), pct: Number(r.querySelector("[data-kp]").value) }));
    rules.bac = { on: host.querySelector("[data-bon]").checked, vials: Math.round(Number(host.querySelector("[data-bv]").value)), pct: Number(host.querySelector("[data-bp]").value) };
  }
  function problem() {
    if (rules.on) {
      if (!rules.tiers.length) return "Add at least one kit size, or switch kit savings off.";
      for (const x of rules.tiers) { if (!(x.vials >= 2 && x.vials <= 50)) return "Each kit needs 2 to 50 vials."; if (!(x.pct > 0 && x.pct <= 50)) return "Each kit's % off must be between 1 and 50."; }
      const v = rules.tiers.map(x => x.vials); if (new Set(v).size !== v.length) return "Two kit sizes have the same number of vials.";
      const s = rules.tiers.slice().sort((a, b) => a.vials - b.vials); if (s.some((x, i) => i && x.pct <= s[i - 1].pct)) return "Bigger kits should save more: each larger kit needs a higher % off.";
    }
    if (rules.bac.on && !(rules.bac.vials >= 1 && rules.bac.pct > 0 && rules.bac.pct <= 50)) return "The BAC water deal needs a bottle count and a % off between 1 and 50.";
    return "";
  }
  function wire() {
    const ex = () => { read(); host.querySelector("[data-kex]").innerHTML = example(); };
    host.querySelector("[data-kon]").onchange = e => { host.querySelector("[data-ktiers]").hidden = !e.target.checked; ex(); };
    host.querySelector("[data-bon]").onchange = e => { host.querySelector("[data-bac]").hidden = !e.target.checked; };
    host.querySelectorAll("[data-kv],[data-kp]").forEach(i => i.oninput = ex);
    host.querySelectorAll("[data-kdel]").forEach(b => b.onclick = () => { read(); rules.tiers.splice(Number(b.closest(".kitrow").dataset.i), 1); draw(); });
    const add = host.querySelector("[data-kadd]"); if (add) add.onclick = () => { read(); const last = rules.tiers[rules.tiers.length - 1]; rules.tiers.push({ vials: last ? last.vials + 2 : 3, pct: last ? last.pct + 5 : 5 }); draw(); };
    host.querySelector("[data-kreset]").onclick = () => { rules = JSON.parse(JSON.stringify(DEF)); draw(); };
    host.querySelector("[data-ksave]").onclick = async e => {
      read(); const err = host.querySelector("[data-kerr]"), msg = problem();
      if (msg) { err.textContent = msg; err.hidden = false; return; } err.hidden = true;
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = "Saving…";
      const clean = { on: rules.on, tiers: rules.tiers.slice().sort((a, b) => a.vials - b.vials), bac: rules.bac };
      const { error } = await P.client().from("ppu_store_settings").update({ kit_rules: clean, updated_at: new Date().toISOString() }).eq("id", 1);
      btn.disabled = false; btn.textContent = "Save kit settings";
      if (error) { err.textContent = `Couldn't save: ${error.message}`; err.hidden = false; return; }
      try { localStorage.setItem("ppu_kit_rules", JSON.stringify(clean)); } catch {}
      P.kitCfg?.(true); P.toast?.("Kit settings saved. The site uses them now.");
      rules = clean; draw();
    };
  }
  window.PPUKitOwner = { pane };
})();
