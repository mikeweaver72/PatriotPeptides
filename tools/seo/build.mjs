// Patriot Peptides USA · SEO build (Nov 7 2026, ported from Pep Shop Texas tools/seo/build.mjs). Run: node tools/seo/build.mjs
// The GitHub Action (.github/workflows/seo-build.yml) runs it every night and whenever this folder changes.
// From the live product list (public read with the site's publishable key) it makes:
//   1. one indexable page per product family at the site root (e.g. /pp-bpc-157.html), built from product.html so it keeps the
//      site's header, footer, styles and script versions, with real HTML Google can read: title, description, canonical, H1,
//      strengths, prices, stock, lab report, shipping, research-use text, plus Product/Offer and Breadcrumb data.
//      The shop script loads on top (body data-key) and turns it into the normal product page.
//   2. js/pst-seo-map.js: product code -> page, so every shop link (P.productUrl) points at these pages.
//   3. /research-peptides-a-z.html: every promoted product A–Z, blends as their own section.
//   4. sitemap.xml: main pages, product pages, the A–Z page, Research Notes and every research article.
//   5. Share pages (link previews, e.g. /pp-2-tz-pp-2-tz-20mg.html): canonical and forward pointed at the product's own page.
// Products on the NOINDEX list (FDA 2026 warning letters / Lilly suits name these compounds; same list as Pep Shop) and lab
// supplies get pages (so links work) but are noindex and left out of the sitemap and A–Z. Merch is never built (sign-in only).
// Renamed products keep working: every address a product has had is kept in tools/seo/slugs.json and forwards to the new page.
import { writeFileSync, readFileSync, existsSync, readdirSync, unlinkSync, mkdirSync } from "node:fs";

const SITE = "https://www.patriotpeptides-usa.com", BRAND = "Patriot Peptides USA";
const ROOT = new URL("../../", import.meta.url).pathname;
const CORE = readFileSync(ROOT + "js/pst-core.js", "utf8");
const SB = (CORE.match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [])[0], KEY = (CORE.match(/sb_publishable_[A-Za-z0-9_-]+/) || [])[0];
if (!SB || !KEY) throw new Error("Couldn't find the Supabase address / publishable key in js/pst-core.js");
const MARK = "<!-- ppu-seo-page -->";
// Jeff's code names for the compounds kept out of search: PP-2-TZ tirzepatide, PP-3-RT retatrutide, PP-TESA tesamorelin,
// PP-PT-141, PP-SS-31 (+ the compound names, in case he renames). Pages exist, noindex. Add new codes here.
const NOINDEX = /^(pp-2-tz|pp-3-rt|pp-tesa|pp-pt-141|pp-ss-31|tirzepatide|retatrutide|semaglutide|cagrilintide|survodutide|tesamorelin|pt-141|ss-31|hcg|oxytocin)$/i;
const hiddenP = p => NOINDEX.test(String(p?.display_name || "").trim()) || /^supply$/i.test(String(p?.category || "").trim());
const AZ = "research-peptides-a-z.html";
const MAIN = ["", "catalog.html", "research-library.html", "testing.html", "about.html", "faq.html", "shipping.html", "contact.html", "rewards.html", "bulk-request.html", "terms.html", "privacy.html"];

const stripTags = s => String(s ?? "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = n => `$${Number(n || 0).toFixed(2).replace(/\.00$/, "")}`;
const slugOf = name => String(name || "").replace(/\([^)]*\)/g, "").toLowerCase().replace(/\+/g, "-plus").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "product";
const shortName = name => String(name || "").replace(/\s*\(.*\)\s*/, "").trim();
const tidyStr = s => String(s || "").trim().replace(/(\d)\s+(mg|mcg|ml|iu)\b/gi, "$1$2"); // "10 mg" -> "10mg", keeps "10-vial kit"
const strengthNum = s => { const m = String(s || "").match(/[\d.]+/); return m ? Number(m[0]) : 0; };
const kitOf = p => /10-?vial|kit/i.test(String(p.strength || "")) || /10VIAL$/i.test(p.product_key);
const unitPrice = p => (p.sale_enabled && Number(p.sale_price) > 0 ? Number(p.sale_price) : Number(p.price || 0));
const inStock = p => Number(p.current_inventory || 0) > 0;
const today = new Date().toISOString().slice(0, 10);

async function rest(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

// product.html is the template: its head and body are reused, so header, footer and ?v= numbers stay current
const TPL = readFileSync(ROOT + "product.html", "utf8");
function fromTemplate({ title, desc, canonical, robots, ogImage, jsonld, bodyAttrs, inner }) {
  let h = TPL;
  const set = (rx, val) => { if (!rx.test(h)) throw new Error(`product.html template changed: ${rx}`); h = h.replace(rx, val); };
  set(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  set(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">`);
  h = h.replace(/<link rel="canonical" href="[^"]*">\n?/, "");
  h = h.replace(/<meta name="robots" content="[^"]*">\n?/, "");
  h = h.replace(/<meta name="viewport"[^>]*>/, m => `${m}\n<link rel="canonical" href="${esc(canonical)}">${robots ? `\n<meta name="robots" content="${robots}">` : ""}`);
  h = h.replace(/(property="og:url" content=")[^"]*/, `$1${esc(canonical)}`).replace(/(property="og:title" content=")[^"]*/, `$1${esc(title)}`).replace(/(property="og:description" content=")[^"]*/, `$1${esc(desc)}`)
       .replace(/(name="twitter:title" content=")[^"]*/, `$1${esc(title)}`).replace(/(name="twitter:description" content=")[^"]*/, `$1${esc(desc)}`);
  if (ogImage) h = h.replace(/((?:property="og:image(?::secure_url)?"|name="twitter:image") content=")[^"]*/g, `$1${esc(ogImage)}`);
  h = h.replace(/<head>/, `<head>\n${MARK}`);
  h = h.replace(/<\/head>/, `<style>.seo{max-width:1100px;margin:0 auto;padding:28px 20px 40px}.seo h1{margin:6px 0 10px}.seo h2{margin:26px 0 8px}.seo p,.seo li{line-height:1.6}.seo .kick{letter-spacing:.18em;text-transform:uppercase;font-size:12px}.seo table{border-collapse:collapse;width:100%;max-width:560px}.seo td,.seo th{padding:8px 10px;border-bottom:1px solid var(--line,#1f2838);text-align:left}.seo .ruo{margin-top:26px;font-size:13px}</style>\n<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>\n</head>`);
  set(/<body data-page="product">/, `<body ${bodyAttrs}>`);
  set(/<div data-pdp>[\s\S]*?<\/main>/, `<div data-pdp>${inner}</div>\n</main>`);
  return h;
}

const SHIP = `Orders ship within the United States once paid, with tracking emailed when they go out. Free shipping on orders over $200.`;
const RUO = `For laboratory research use only. Not for human or veterinary use. Not a drug, food, cosmetic or supplement. ${BRAND} is not a compounding pharmacy and does not give dosing or preparation guidance.`;
const ORG = { "@type": "Organization", "@id": `${SITE}/#org`, name: BRAND, url: `${SITE}/`, logo: `${SITE}/android-chrome-512x512.png`, areaServed: "United States" };
const crumbs = (...xs) => ({ "@type": "BreadcrumbList", itemListElement: xs.map(([name, item], i) => ({ "@type": "ListItem", position: i + 1, name, item })) });

function productPage(group, slug, labKeys) {
  const g = [...group].sort((a, b) => (kitOf(a) - kitOf(b)) || strengthNum(a.strength) - strengthNum(b.strength));
  const p0 = g.find(p => inStock(p) && !kitOf(p)) || g.find(inStock) || g[0], name = shortName(p0.display_name), full = p0.display_name;
  const vials = g.filter(p => !kitOf(p)), kits = g.filter(kitOf);
  const strengths = [...new Set(vials.map(p => tidyStr(p.strength)).filter(Boolean))];
  const kitTxt = kits.length ? (strengths.length ? " and 10-vial kits" : "10-vial kits") : "";
  const anyStock = g.some(inStock), blend = p0.blend_stack || /multi-peptide|blend/i.test(p0.category || ""), supply = /^supply$/i.test(String(p0.category || "").trim());
  const gsa = (g.map(p => String(p.coa_url || "").match(/GSA-\d{4}-\d{6}/i)?.[0]).find(Boolean) || "").toUpperCase();
  const hasCoa = !!gsa || g.some(p => labKeys.has(p.product_key) || (p.coa_url && !/pending/i.test(p.coa_url)) || p.coa_file || p.coa_image);
  const noindex = g.some(hiddenP), canonical = `${SITE}/${slug}.html`;
  const kind = supply ? "Lab Supply" : blend ? "Research Blend" : "Research Peptide";
  const title = `${full} ${kind}${strengths.length ? ` ${strengths.slice(0, 4).join(" · ")}` : kitTxt ? " 10-Vial Kit" : ""} | ${BRAND}`;
  const desc = `${full} ${kind.toLowerCase()}${strengths.length || kitTxt ? ` in ${strengths.join(", ")}${kitTxt}` : ""}${hasCoa ? ", third-party lab tested" : ""}. ${anyStock ? "In stock" : "Restocking soon"}. Ships across the USA, free over $200. Research use only.`;
  const img = p0.bottle_url || `${SITE}/img/og/og-catalog.jpg`;
  const offers = g.map(p => ({ "@type": "Offer", sku: p.product_key, name: `${full} ${p.strength || ""}`.trim(), price: unitPrice(p).toFixed(2), priceCurrency: "USD", availability: inStock(p) ? "https://schema.org/InStock" : "https://schema.org/OutOfStock", url: `${canonical}?key=${encodeURIComponent(p.product_key)}`, seller: { "@id": `${SITE}/#org` }, areaServed: "US" }));
  const jsonld = { "@context": "https://schema.org", "@graph": [ORG,
    { "@type": "Product", name: full, sku: p0.product_key, category: supply ? "Lab supply" : blend ? "Research peptide blend" : "Research peptide", image: img, description: `${full} for laboratory research.${hasCoa ? " Third-party certificate of analysis on file." : ""} ${RUO}`, brand: { "@type": "Brand", name: BRAND }, offers },
    crumbs(["Home", `${SITE}/`], ["Collection", `${SITE}/catalog.html`], [name, canonical])] };
  const rows = g.map(p => `<tr><td>${esc(p.strength || "Standard")}</td><td>${money(unitPrice(p))}</td><td>${inStock(p) ? "In stock" : "Restocking"}</td></tr>`).join("");
  const summary = p0.research_summary ? `<p>${esc(p0.research_summary)}</p>` : "";
  const inner = `<div class="seo"><nav class="kick"><a href="./">Home</a> / <a href="catalog.html">Collection</a> / ${esc(name)}</nav>
<h1>${esc(full)}</h1>
<p>${supply ? `${esc(full)} is a lab supply item` : `${esc(full)} is supplied as a lyophilized (freeze-dried) ${blend ? "multi-peptide research blend" : "research peptide"} in sealed vials${strengths.length || kitTxt ? `: ${esc(strengths.join(", ") + kitTxt)}` : ""}`}. Sold by ${BRAND}, an American-owned research supplier.</p>${summary}
<h2>Strengths and price</h2><table><thead><tr><th>Option</th><th>Price</th><th>Stock</th></tr></thead><tbody>${rows}</tbody></table>
${supply ? "" : `<h2>Lab report</h2><p>${gsa ? `Verified by Gold Standard Analytics, an independent lab: certificate ${esc(gsa)}.` : hasCoa ? "A third-party certificate of analysis for the current batch is on file and opens from the product page." : "The certificate of analysis for the current batch is in progress at an independent lab."} <a href="testing.html">How we test</a>.</p>`}
<h2>Shipping</h2><p>${esc(SHIP)} <a href="shipping.html">Shipping and returns</a>.</p>
<p class="ruo">${esc(RUO)}</p>
<p><a href="catalog.html">Browse the full collection</a> · <a href="${AZ}">Research peptides A–Z</a> · <a href="research-library.html">Research notes</a></p></div>`;
  const html = fromTemplate({ title, desc, canonical, robots: noindex ? "noindex,follow" : "", ogImage: img, jsonld, bodyAttrs: `data-page="product" data-key="${esc(p0.product_key)}"`, inner });
  return { html, noindex, keys: g.map(p => p.product_key) };
}

function azIndex(groups, map) {
  const canonical = `${SITE}/${AZ}`, title = `Research Peptides A–Z: Every Peptide and Blend | ${BRAND}`;
  const shown = groups.filter(g => !g.some(hiddenP)).sort((a, b) => shortName(a[0].display_name).localeCompare(shortName(b[0].display_name), undefined, { numeric: true }));
  const isBlend = g => g.some(p => p.blend_stack || /multi-peptide|blend/i.test(p.category || ""));
  const singles = shown.filter(g => !isBlend(g)), blends = shown.filter(isBlend);
  const desc = `A–Z list of the ${singles.length} research peptides${blends.length ? ` and ${blends.length} multi-peptide blends` : ""} sold by ${BRAND}: strengths, stock and lab reports. Research use only.`;
  const item = g => { const g2 = [...g].sort((a, b) => strengthNum(a.strength) - strengthNum(b.strength));
    const strs = [...new Set(g2.filter(p => !kitOf(p)).map(p => tidyStr(p.strength)).filter(Boolean))].join(", ") + (g2.some(kitOf) ? (g2.some(p => !kitOf(p)) ? ", 10-vial kits" : "10-vial kits") : "");
    return `<li><a href="${map[g2[0].product_key]}"><b>${esc(g2[0].display_name)}</b></a>${strs ? ` · ${esc(strs)}` : ""} · ${g2.some(inStock) ? "in stock" : "restocking"}</li>`; };
  const jsonld = { "@context": "https://schema.org", "@graph": [ORG,
    { "@type": "CollectionPage", name: title, url: canonical, description: desc, publisher: { "@id": `${SITE}/#org` },
      mainEntity: { "@type": "ItemList", numberOfItems: shown.length, itemListElement: [...singles, ...blends].map((g, i) => ({ "@type": "ListItem", position: i + 1, name: g[0].display_name, url: `${SITE}/${map[g[0].product_key]}` })) } },
    crumbs(["Home", `${SITE}/`], ["Research peptides A–Z", canonical])] };
  const inner = `<div class="seo"><nav class="kick"><a href="./">Home</a> / Research peptides A–Z</nav>
<h1>Research peptides A–Z</h1>
<p>Every research peptide${blends.length ? " and multi-peptide blend" : ""} from ${BRAND}, in alphabetical order. Each links to its page with strengths, price, stock and lab report. See <a href="testing.html">how we test</a> and the <a href="research-library.html">research notes</a>.</p>
<h2>Research peptides (${singles.length})</h2><ul>${singles.map(item).join("")}</ul>
${blends.length ? `<h2 id="blends">Multi-peptide blends (${blends.length})</h2><ul>${blends.map(item).join("")}</ul>` : ""}
<p class="ruo">${esc(RUO)}</p>
<p><a href="catalog.html">Shop the full collection</a></p></div>`;
  // not a product page: the shop script must not take it over, so no data-key and a plain page type
  return fromTemplate({ title, desc, canonical, robots: "", ogImage: `${SITE}/img/og/og-catalog.jpg`, jsonld, bodyAttrs: `data-page="local"`, inner });
}

/* ---------- build ---------- */
const prods = (await rest("product_catalog?select=product_key,display_name,strength,category,price,sale_enabled,sale_price,current_inventory,is_active,coa_url,coa_file,coa_image,blend_stack,research_summary,bottle_url&is_active=eq.true&order=display_name"))
  .filter(p => p.product_key && p.display_name && !/^merch$/i.test(String(p.category || "").trim()));
if (prods.length < 5) throw new Error(`Only ${prods.length} products came back; not touching the site.`);
const labKeys = new Set((await rest("coa_records?select=product_key&is_published=eq.true&limit=1000").catch(e => { console.warn("coa_records:", e.message); return []; })).map(r => r.product_key).filter(Boolean));
const groups = Object.values(prods.reduce((m, p) => { const k = String(p.display_name || "").trim().toLowerCase(); (m[k] ||= []).push(p); return m; }, {}));
const RESERVED = new Set(readdirSync(ROOT).filter(f => f.endsWith(".html") && !readFileSync(ROOT + f, "utf8").includes(MARK)));
const map = {}, built = [], indexable = [], hidden = [];
const HIST = ROOT + "tools/seo/slugs.json", hist = existsSync(HIST) ? JSON.parse(readFileSync(HIST, "utf8")) : {};
for (const g of groups) {
  let slug = slugOf(g[0].display_name); if (RESERVED.has(`${slug}.html`)) slug = `${slug}-research-peptide`;
  if (RESERVED.has(`${slug}.html`)) { console.warn(`skipped ${g[0].display_name}: ${slug}.html is a hand-made page`); continue; }
  const { html, noindex, keys } = productPage(g, slug, labKeys);
  writeFileSync(ROOT + `${slug}.html`, html); built.push(`${slug}.html`); if (!noindex) indexable.push(`${slug}.html`); else hidden.push(...keys);
  keys.forEach(k => { map[k] = `${slug}.html`; (hist[k] ||= []).includes(slug) || hist[k].push(slug); });
}
// renamed products: the old address forwards to the new page
const forward = to => `<!doctype html>\n<html lang="en"><head>${MARK}<meta charset="utf-8"><title>Moved | ${BRAND}</title><meta name="robots" content="noindex,follow"><link rel="canonical" href="${SITE}/${to}"><meta http-equiv="refresh" content="0; url=${to}"><script>location.replace(${JSON.stringify(to)} + location.search + location.hash)</script></head><body><p>This product moved: <a href="${to}">${to}</a></p></body></html>\n`;
for (const [k, slugs] of Object.entries(hist)) { const cur = map[k]; if (!cur) continue;
  for (const old of slugs) { const f = `${old}.html`; if (f === cur || built.includes(f) || RESERVED.has(f)) continue; writeFileSync(ROOT + f, forward(cur)); built.push(f); } }
mkdirSync(ROOT + "tools/seo", { recursive: true }); writeFileSync(HIST, JSON.stringify(hist, null, 1) + "\n");
// share pages (link previews) name the product's own page as canonical and forward there
let shares = 0;
for (const f of readdirSync(ROOT)) { if (!f.endsWith(".html") || built.includes(f)) continue;
  const src = readFileSync(ROOT + f, "utf8"); if (src.includes(MARK) || !/<meta property="og:type" content="product">/.test(src)) continue;
  const k = (src.match(/<link rel="canonical" href="[^"]*\?key=([^"&]+)"/) || [])[1]; const key = k && decodeURIComponent(k), to = key && map[key]; if (!to) continue;
  const out = src.replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${SITE}/${to}">`)
    .replace(new RegExp(`(?:product|[a-z0-9-]+)\\.html\\?key=${encodeURIComponent(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g"), `${to}?key=${encodeURIComponent(key)}`);
  if (out !== src) { writeFileSync(ROOT + f, out); shares++; } }
if (!RESERVED.has(AZ)) { writeFileSync(ROOT + AZ, azIndex(groups, map)); built.push(AZ); }
// remove pages this build made before for products that are gone
for (const f of readdirSync(ROOT)) if (f.endsWith(".html") && !built.includes(f) && readFileSync(ROOT + f, "utf8").includes(MARK)) unlinkSync(ROOT + f);
writeFileSync(ROOT + "js/pst-seo-map.js", `/* generated by tools/seo/build.mjs on ${today}: product code -> product page */\nwindow.PST_SEO = ${JSON.stringify(map)};\n/* products kept out of search (NOINDEX list in build.mjs) */\nwindow.PST_NOINDEX = ${JSON.stringify(hidden)};\n`);
// research articles: every page in research/ that isn't noindex
const articles = existsSync(ROOT + "research") ? readdirSync(ROOT + "research").filter(f => f.endsWith(".html") && !/noindex/i.test(readFileSync(ROOT + "research/" + f, "utf8"))).sort() : [];
const urls = [...MAIN.map(u => `${SITE}/${u}`), ...indexable.map(f => `${SITE}/${f}`), `${SITE}/${AZ}`, ...articles.map(f => `${SITE}/research/${f}`)];
writeFileSync(ROOT + "sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join("\n")}\n</urlset>\n`);
console.log(`built ${built.length} pages (${indexable.length} product pages indexable, ${hidden.length} codes noindex), share pages pointed: ${shares}, ${articles.length} articles, ${urls.length} sitemap URLs`);
