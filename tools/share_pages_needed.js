// Quick check for the hourly job: does any active product lack a share page (new, renamed or new strength)?
// Prints "yes" or "no". No browser needed, so the job stays cheap when nothing changed.
const fs = require("fs"), path = require("path");
const root = path.resolve(process.argv[2] || "."), core = fs.readFileSync(path.join(root, "js/pst-core.js"), "utf8");
const url = core.match(/url: "(https:\/\/[a-z0-9]+\.supabase\.co)"/)[1], key = core.match(/\n\s*key: "([^"]+)"/)[1];
let index = {}; try { index = JSON.parse(fs.readFileSync(path.join(root, "img/share/index.json"), "utf8")); } catch {}
const have = new Set(Object.values(index).map(v => v.sig));
fetch(`${url}/rest/v1/product_catalog?select=product_key,display_name,strength&is_active=eq.true`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  .then(r => r.json()).then(rows => {
    const missing = rows.filter(x => x.product_key && (!have.has(`${x.product_key}|${x.display_name || ""}|${x.strength || ""}`) || !fs.existsSync(path.join(root, "img/email/vials", x.product_key + ".png"))));
    if (missing.length) console.error("needs share pages:", missing.map(x => x.product_key).join(", "));
    console.log(missing.length ? "yes" : "no");
  }).catch(e => { console.error(e); console.log("no"); });
