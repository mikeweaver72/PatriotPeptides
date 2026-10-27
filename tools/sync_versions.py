#!/usr/bin/env python3
"""Make every page load the newest version of each css/js file.
Finds the highest ?v= used for each local asset across all .html files (root + research/) and sw.js,
then rewrites every reference to that version. Run after bumping a version anywhere:
    python3 tools/sync_versions.py [--root DIR]"""
import pathlib, re, sys
root = pathlib.Path(sys.argv[sys.argv.index("--root") + 1] if "--root" in sys.argv else ".")
files = list(root.glob("*.html")) + list(root.glob("research/*.html")) + [root / "sw.js"]
pat = re.compile(r'((?:css|js)/[\w.-]+\.(?:css|js))\?v=(\d+)')
best = {}
for f in files:
    for a, v in pat.findall(f.read_text()): best[a] = max(best.get(a, 0), int(v))
changed = 0
for f in files:
    t = f.read_text(); t2 = pat.sub(lambda m: f"{m.group(1)}?v={best[m.group(1)]}", t)
    if t2 != t: f.write_text(t2); changed += 1
print(f"{len(best)} assets, {changed} files updated")
