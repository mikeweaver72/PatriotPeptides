// Builds a share page + 1200x630 picture for every product, so a texted or posted product link shows
// that vial, name and strength (the shop page itself is filled in by script, which link previews can't run).
// Usage: node tools/make_share_pages.js <site root to write into> [live site url] [--changed]
//   --changed: only products that are new or renamed since the last run (img/share/index.json); used by the
//   hourly GitHub job (.github/workflows/share-pages.yml), so Jeff's new products get share pages on their own.
// Reads the live catalog and draws each vial with the site's own renderer.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const args = process.argv.slice(2).filter(a => !a.startsWith("--")), ONLY_CHANGED = process.argv.includes("--changed");
const OUT = path.resolve(args[0] || "."), SITE = (args[1] || "https://www.patriotpeptides-usa.com").replace(/\/$/, "");
const IDX = path.join(OUT, "img/share/index.json"); let index = {}; try { index = JSON.parse(fs.readFileSync(IDX, "utf8")); } catch {}
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
(async () => {
  const b = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  const c = await b.newContext({ viewport: { width: 1200, height: 630 } });
  await c.addInitScript(() => { try { localStorage.setItem("ppu_gate_v1", "1"); } catch {} });
  const p = await c.newPage(); await p.goto(SITE + "/catalog.html", { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  const list = await p.evaluate(async (skip) => {
    const P = window.PST, all = (await P.products()).filter(x => x.product_key && !skip.includes(x.product_key + "|" + (x.display_name || "") + "|" + (x.strength || "")));
    const out = [];
    for (const x of all) {
      const t = P.titleParts(x), main = String(t.main || "");
      const slug = main.toLowerCase().replace(/\([^)]*\)/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "product";
      const cv = await P.vialCanvas(x, 3);
      const em = document.createElement("canvas"); em.width = 63; em.height = 144; const eg = em.getContext("2d"); eg.imageSmoothingQuality = "high";
      const r = Math.min(63 / cv.width, 144 / cv.height), w = cv.width * r, h = cv.height * r; eg.drawImage(cv, (63 - w) / 2, (144 - h) / 2, w, h);
      out.push({ sig: x.product_key + "|" + (x.display_name || "") + "|" + (x.strength || ""), key: x.product_key, slug: `${slug}-${String(x.product_key).toLowerCase()}`, name: main, strength: x.strength || t.sub || "", cat: x.category || "", vial: cv.toDataURL("image/png"), email: em.toDataURL("image/png") });
    }
    return out;
  }, ONLY_CHANGED ? Object.values(index).map(v => v.sig) : []);
  const emblem = SITE + "/img/pst-emblem-384.webp", flag = SITE + "/img/flag-texture.jpg";
  fs.mkdirSync(path.join(OUT, "img/share"), { recursive: true }); fs.mkdirSync(path.join(OUT, "img/email/vials"), { recursive: true });
  const card = await c.newPage();
  for (const x of list) {
    const ev = path.join(OUT, "img/email/vials", x.key + ".png"); if (!fs.existsSync(ev)) fs.writeFileSync(ev, Buffer.from(x.email.split(",")[1], "base64"));
    const bac = /bac/i.test(x.name);
    await card.setContent(`<!doctype html><html><head><style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@500;700;800;900&display=swap');
*{box-sizing:border-box}body{margin:0;width:1200px;height:630px;overflow:hidden;font-family:Inter,system-ui,sans-serif;background:#0A1020;color:#F3EDE1;position:relative}
.bg{position:absolute;inset:0;background:url(${flag}) right center/cover;opacity:.22;filter:blur(3px)}
.fade{position:absolute;inset:0;background:linear-gradient(90deg,#0A1020 38%,rgba(10,16,32,.55) 70%,rgba(10,16,32,.25))}
.bar{position:absolute;left:0;right:0;height:12px;display:flex}.bar i{flex:1}.top{top:0}.bot{bottom:0}
.r{background:#C8102E}.w{background:#F3EDE1}.n{background:#1D3FA6}
.txt{position:absolute;left:72px;top:118px;width:660px}
.kick{display:flex;align-items:center;gap:12px;color:#E0475F;font-weight:800;font-size:24px;letter-spacing:.06em;text-transform:uppercase}
.kick img{width:46px;height:46px}
h1{margin:26px 0 0;font-weight:900;font-size:${x.name.length <= 10 ? 92 : x.name.length <= 13 ? 70 : 56}px;line-height:1;white-space:nowrap;letter-spacing:-.01em;color:#fff}
.str{display:inline-block;margin-top:22px;padding:8px 18px;border-radius:999px;background:#C8102E;color:#fff;font-weight:800;font-size:30px}
.sub{margin-top:28px;font-size:27px;font-weight:700;color:#C9D1E0}.sub2{margin-top:10px;font-size:22px;font-weight:600;color:#93A0B8}
.url{position:absolute;left:72px;bottom:46px;font-size:22px;font-weight:700;color:#C9D1E0}
.vial{position:absolute;right:120px;top:50%;transform:translateY(-50%);height:520px;filter:drop-shadow(0 24px 36px rgba(0,0,0,.55))}
.glow{position:absolute;right:40px;top:50%;width:520px;height:520px;transform:translateY(-50%);background:radial-gradient(circle,rgba(29,63,166,.45),transparent 65%)}
</style></head><body><div class="bg"></div><div class="fade"></div><div class="glow"></div>
<div class="bar top"><i class="r"></i><i class="w"></i><i class="n"></i></div><div class="bar bot"><i class="r"></i><i class="w"></i><i class="n"></i></div>
<div class="txt"><div class="kick"><img src="${emblem}">Patriot Peptides USA</div><h1>${esc(x.name)}</h1>${x.strength ? `<span class="str">${esc(x.strength)}</span>` : ""}
<div class="sub">${bac ? "Bacteriostatic water for research" : "Research peptide · Third-party tested"}</div><div class="sub2">Kit savings · Free shipping over $200</div></div>
<div class="url">patriotpeptides-usa.com</div><img class="vial" src="${x.vial}"></body></html>`, { waitUntil: "networkidle" });
    await card.waitForTimeout(150);
    await card.screenshot({ path: path.join(OUT, "img/share", x.slug + ".jpg"), type: "jpeg", quality: 84 });
    const title = `${x.name}${x.strength ? " " + x.strength : ""} | Patriot Peptides USA`;
    const desc = `${x.name}${x.strength ? " " + x.strength : ""} ${bac ? "bacteriostatic water" : "research peptide"} from Patriot Peptides USA. Third-party lab report on file, kit savings, free shipping over $200 and one-tap Venmo checkout. For research use only.`;
    const img = `${SITE}/img/share/${x.slug}.jpg`, dest = `product.html?key=${encodeURIComponent(x.key)}`;
    fs.writeFileSync(path.join(OUT, x.slug + ".html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="noindex,follow">
<link rel="canonical" href="${SITE}/${dest}">
<meta property="og:type" content="product"><meta property="og:site_name" content="Patriot Peptides USA"><meta property="og:locale" content="en_US"><meta property="og:url" content="${SITE}/${x.slug}.html">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${img}"><meta property="og:image:secure_url" content="${img}"><meta property="og:image:type" content="image/jpeg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${esc(title)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${img}">
<meta http-equiv="refresh" content="0; url=${dest}">
<script>location.replace("${dest}" + (location.search ? "&" + location.search.slice(1) : "") + location.hash);</script>
<style>body{margin:0;background:#0A1020;color:#F3EDE1;font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}a{color:#fff}</style>
</head><body><p>Opening <a href="${dest}">${esc(x.name)} at Patriot Peptides USA</a>…</p></body></html>
`);
  }
  for (const x of list) index[x.key] = { sig: x.sig, slug: x.slug };
  fs.writeFileSync(IDX, JSON.stringify(index, null, 1));
  console.log(`made ${list.length} share pages`);
  await b.close();
})();
