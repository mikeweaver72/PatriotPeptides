#!/usr/bin/env python3
"""Fill the Patriot site's placeholders for one environment.
Usage: python3 tools/configure.py --ref <supabase_project_ref> --anon <anon_key> --repo <owner/repo> [--staging]
Writes in place (run on a fresh checkout or a build copy). Idempotent for the same values."""
import argparse, pathlib, re, sys
ap = argparse.ArgumentParser()
ap.add_argument("--ref", required=True); ap.add_argument("--anon", required=True); ap.add_argument("--repo", required=True)
ap.add_argument("--staging", action="store_true", help="adds noindex + staging banner")
ap.add_argument("--root", default=str(pathlib.Path(__file__).resolve().parents[1]))
a = ap.parse_args()
root = pathlib.Path(a.root); n = 0
for p in root.rglob("*"):
    if p.is_dir() or p.suffix.lower() not in {".html", ".js", ".json", ".webmanifest", ".ts", ".txt", ".md", ".xml", ".sql"}: continue
    if "node_modules" in p.parts or ".git" in p.parts: continue
    s = p.read_text(encoding="utf-8", errors="ignore"); o = s
    s = s.replace("__PPU_SUPABASE_REF__", a.ref).replace("__PPU_SUPABASE_ANON_KEY__", a.anon).replace("__PPU_GITHUB_REPO__", a.repo)
    if a.staging and p.suffix == ".html" and 'name="robots"' not in s:
        s = s.replace("<head>", '<head><meta name="robots" content="noindex,nofollow"><script>document.addEventListener("DOMContentLoaded",()=>{const b=document.createElement("div");b.textContent="STAGING · test orders only";b.style.cssText="position:fixed;top:4px;right:8px;background:#C8102E;color:#fff;font:700 10px Inter,sans-serif;padding:3px 8px;border-radius:999px;z-index:9999;letter-spacing:.08em;pointer-events:none;opacity:.9";document.body.appendChild(b)})</script>', 1)
    if s != o: p.write_text(s, encoding="utf-8"); n += 1
left = sum(1 for p in root.rglob("*.html") if "__PPU_" in p.read_text(encoding="utf-8", errors="ignore"))
print(f"configured {n} files for {a.ref}; placeholders left in html: {left}")
