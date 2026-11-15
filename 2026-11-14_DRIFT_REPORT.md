## README.md

- Legacy section `## Regenerate the dataset` (line 74) states `python3 tools/generate.py` writes `data/*.json`, whereas `[tools/generate.py:main]` (line 78) writes `data/{sid}_{body}.js` directly (`window.__LSP_DATA["{sid}_{body}"]=...`).
- Legacy section `## Run locally` (line 66) references `cd lunar-planner`, whereas the repository root is the current workspace directory.
- `[app.js:saveCompares]` and `[app.js:restoreCompares]` (lines 645–647) are no-op stubs (in-memory only), whereas `## Features` (line 27) describes scenario comparison as "save site+date combinations".

## tools/README.md

No drift detected.
