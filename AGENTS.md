# fntValid — agent notes

Static BMFont metric validator: plain HTML/CSS/classic JS, no framework, no `package.json`, no build or test runner. `index.html` is the only entrypoint; `app.js` is the app logic (~1162 lines), `guide.js` is an opt-in explainer overlay, `Font/` holds sample `.fnt` + `.png` pairs.

## Run / verify

- No npm scripts. To exercise demos or pasted fonts properly, serve the repo root: `python3 -m http.server 8000` → `http://localhost:8000/`. Demos use `fetch()`, so they fail on `file://` (the UI hint says to use a server or "Open .fnt + .png…").
- Optional JS check: `npx tsc --noEmit -p jsconfig.json` (no local `tsc`; npx fetches it). `jsconfig.json` sets `checkJs`/`noUnusedLocals`/`noUnusedParameters` and **includes only `app.js`** — `guide.js` is not typechecked.
- No automated tests exist; verify by loading a demo, nudging glyphs, and checking the Checks panel + Export output.

## Wiring that is easy to break

- `<script>` order in `index.html` is load-bearing: `app.js` **then** `guide.js`. `guide.js` is an IIFE that reads `app.js` globals (`glyphs`, `baseline`, `lineHeight`, `hasGlyphs()`), injects `#guideBtn` and `#guide` at runtime, and exposes `window.fntGuide`. Both are classic scripts sharing globals — don't convert to modules without preserving these.
- `app.js` does big state mutations then calls `redrawAll()` (`showOverlays → runChecks → renderGlyphGrid → syncFormFields → drawGlyphAnatomy → drawAtlasOverview`). Wire new mutations into `redrawAll()` rather than calling individual renderers.

## Domain invariants — don't "simplify" these

- Top/bottom gaps are **inferred from the loaded file**, not zero: on parse, `appliedTopGap = min(yoffset)` and `appliedBotGap = lineHeight − max(yoffset + height)`. The two global checks ("Top edge aligned", "Line height fits") compare against those targets. `#top`/`#gap` inputs are one-shot Auto-fix commands, baked into metrics and cleared afterward; editing them only reruns checks. Auto-fix clamps a negative bottom gap to 0 (so `lineHeight` ends at the lowest ink — Gofnt's TTF `ascent+descent` can declare a line box shorter than swash glyphs), appends far-off glyphs that hang *below* the baseline to `#hangset` instead of moving their ink, and re-derives `applied*Gap` from the final metrics so browser state always matches a reload/export.
- Descender classification is user-editable and shared: `#dset` (default `gjpqy`) and `#hangset` (default `QJ`) drive the Checks, Auto-fix, and the `desc`/`nodesc` group filter in Settings. The filters read the live input values.
- Pixel-based checks ("Rect has blank edges", Trim, part of Auto-fix) require a readable atlas canvas. Paste-only `.fnt` or `file://` image loads can taint/fail it (`inkReadFailed`), disabling those checks. Use "Open .fnt + .png…", drag/drop both files, or a local server.
- Export is a round-trip: unknown `info`/`common` attributes, `page` lines and `kerning` lines are preserved verbatim, while `char` lines are regenerated (sorted by code, normalized fields, always `page=0 chnl=0` and a `letter=` attribute). Char-line formatting changes on export by design.
- Guide colors come from CSS variables in `styles.css` (`--r` top, `--g` base, `--b` lineHeight, `--o` bottom, `--p` advance, `--y` warn). The canvas reads them via `cssVar()` and `guide.js` SVGs use `var(--…)`, so a single CSS change themes both. Theme choice is persisted in `localStorage.theme` and applied by an inline script in `<head>` before CSS loads.
- Keyboard model: arrows nudge the selected glyph's `xo`/`yo` (±1, Shift ×10); Ctrl/Cmd+arrows navigate glyphs; ignored while focus is in a form field. The Guide dialog stops `keydown` propagation so arrows don't nudge glyphs behind it.

## Demo paths

- All seven demo buttons (`demo1`–`demo7` in `index.html`) now map one-to-one to their `loadDemo("Font/…")` calls in `app.js`, and every target exists in `Font/`. An older mismatch (a "VeniceRegen20" button fetching a nonexistent `VeniceRegen19.fnt`, plus mislabeled SuperRegen demos) was fixed. Still verify labels and paths against `Font/` when adding or renaming demos.
