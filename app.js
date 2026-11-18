//#region 🧠 State

/** @typedef {{ x:number, y:number, w:number, h:number, xo:number, yo:number, xa:number }} Glyph */
/** @typedef {{ [code:number]: Glyph }} CharMap */
/** @typedef {{ l:number, t:number, r:number, b:number }} InkBox */
/** @typedef {{ face:string, size:number, scaleW:number, scaleH:number, pageFile:string }} Header */
/**
 * @typedef {{
 *   label: string,
 *   hint: string | (() => string),
 *   test: (g: Glyph, ch: string, code: number) => boolean,
 *   fix?: { label: string, title?: string, run: () => void }
 * }} Rule
 */

/** charCode -> { x, y, w, h, xo, yo, xa }  (atlas rect + offsets) */
/** @type {CharMap} */
let glyphs = {};

/** Font header fields from the "info", "common", and "page" lines. */
/** @type {Header} */
let header = { face: "", size: 0, scaleW: 0, scaleH: 0, pageFile: "" };

/** Baseline y and line height, in glyph space. */
let baseline = 0;
let lineHeight = 0;

/**
 * Top/bottom gaps baked into the metrics. On load they are inferred from the
 * file (min yoffset, lineHeight − lowest bottom) so the global checks compare
 * against the font's own spacing instead of an arbitrary zero. Auto-fix may
 * overwrite them with one-shot values from #top/#gap, which are cleared once
 * baked into yoffset/lineHeight.
 */
let appliedTopGap = 0;
let appliedBotGap = 0;

/** Currently selected char code (65 = 'A' by default). */
let selectedCode = 65;

/** The atlas PNG. */
let atlasImage = new Image();

/** Cached per-glyph ink bounds in atlas px: code -> {l,t,r,b}, or null if blank. */
/** @type {Record<number, InkBox|null> | null} */
let inkCache = null;

/** Set when the atlas canvas can't be read (e.g. file:// taint, no image). */
let inkReadFailed = false;

/** Char codes (numbers) that fail at least one check. */
/** @type {Set<number>} */
let badChars = new Set();

/** Raw lines preserved verbatim for round-trip export. */
/** @type {Record<string,string>} */ let extraInfoAttrs = {};
/** @type {Record<string,string>} */ let extraCommonAttrs = {};
/** @type {string[]} */ let pageLines = [];
/** @type {string[]} */ let kerningLines = [];

/**
 * Short for document.getElementById.
 * Throws early with a clear message if an id is missing or misspelled.
 * @param {string} id
 * @returns {HTMLElement}
 */
const $ = id => {
	const el = document.getElementById(id);
	if (!el) throw new Error(`Missing element #${id}`);
	return el;
};

/** @type {(id:string) => HTMLInputElement} */
const $input = id => /** @type {HTMLInputElement} */($(id));

/** @type {(id:string) => HTMLCanvasElement} */
const $canvas = id => /** @type {HTMLCanvasElement} */($(id));

/** @type {(id:string) => HTMLTextAreaElement} */
const $textarea = id => /** @type {HTMLTextAreaElement} */($(id));

/** Clear a stale Auto-fix log so it doesn't describe a previously loaded font. */
const clearFixLog = () => { $("fixlog").textContent = ""; };

const cssVar = name =>
	getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const charFromCode = code => String.fromCharCode(code);
const glyphLabel = code => code === 32 ? "\u2423" : charFromCode(code);
const hasGlyphs = () => Object.keys(glyphs).length > 0;

//#endregion

//#region 🎨 Rendering

/** Orchestrates a full redraw. Each step is in its own function below. */
function redrawAll() {
	if (!hasGlyphs()) {
		showEmptyState();
		return;
	}
	showOverlays();
	runChecks();
	renderGlyphGrid();
	syncFormFields();
	drawGlyphAnatomy();
	drawAtlasOverview();
}

function showEmptyState() {
	const summary = $("sum");
	summary.textContent = "No font loaded";
	summary.className = "pill";

	$("chk").innerHTML = "";
	$("grid").innerHTML = "";
	$("selinfo").textContent = "Load a .fnt + .png, or use a demo.";
	$("anaInfo").innerHTML = "";
	$("vb").textContent = "";
	$("vl").textContent = "";
	$("vgap").textContent = "";
	$("vbot").textContent = "";
	$("xa").textContent = "";
	$("vbd").textContent = "";

	document.querySelector(".overlay-top").style.display = "none";
	document.querySelector(".overlay-bottom").style.display = "none";

	const atlasCanvas = $canvas("atlas");
	const anatCanvas = $canvas("anat");
	atlasCanvas.getContext("2d").clearRect(0, 0, atlasCanvas.width, atlasCanvas.height);
	anatCanvas.getContext("2d").clearRect(0, 0, anatCanvas.width, anatCanvas.height);
}

function showOverlays() {
	document.querySelector(".overlay-top").style.display = "";
	document.querySelector(".overlay-bottom").style.display = "";
}

/** @param {HTMLCanvasElement} canvasEl @param {number} width @param {number} height */
function makeCanvasContext(canvasEl, width, height) {
	// Reassigning width/height clears and reallocates the backing store. When
	// the frame is unchanged, reuse it — every caller repaints the full canvas.
	if (canvasEl.width !== width || canvasEl.height !== height) {
		canvasEl.width = width;
		canvasEl.height = height;
	}
	const ctx = canvasEl.getContext("2d");
	ctx.imageSmoothingEnabled = false;
	return ctx;
}

/**
 * The anatomy preview's frame, computed from every glyph so it is identical
 * for every selection. Using only the selected glyph made the canvas aspect
 * ratio (and thus its displayed height) change as you switched characters,
 * which caused visible flicker. The frame covers the union of all glyph
 * offset boxes plus the fixed top/base/lineHeight guides.
 */
/** @returns {{ left:number, right:number, top:number, bottom:number, maxBottom:number }} */
function anatomyFrame() {
	const codes = Object.keys(glyphs).map(Number);
	let left = 0, right = 1, top = 0, bottom = Math.max(lineHeight, baseline);
	let maxBottom = 0;
	for (const code of codes) {
		const g = glyphs[code];
		left = Math.min(left, g.xo);
		right = Math.max(right, g.xa, g.xo + g.w);
		top = Math.min(top, g.yo);
		maxBottom = Math.max(maxBottom, g.yo + g.h);
		bottom = Math.max(bottom, maxBottom);
	}
	return { left, right, top, bottom, maxBottom };
}

function drawGlyphAnatomy() {
	const glyph = glyphs[selectedCode];
	const ZOOM = 28;
	const PAD_X = 2, PAD_Y = 1; // symmetric, in glyph-space units
	const MIN_W = 8;            // keeps tiny fonts from making a sliver canvas

	const frame = anatomyFrame();
	const contentLeft = frame.left;
	const contentRight = frame.right;
	const contentTop = frame.top;
	const contentBottom = frame.bottom;

	// Pad narrow content out to MIN_W and keep it centered.
	const contentW = contentRight - contentLeft;
	const span = Math.max(MIN_W, contentW);
	const extra = span - contentW;

	// Map glyph-space (0,0) to (originX, originY) inside the canvas.
	const originX = (PAD_X - contentLeft + extra / 2) * ZOOM;
	const originY = (PAD_Y - contentTop) * ZOOM;
	const W = Math.ceil((span + PAD_X * 2) * ZOOM);
	const H = Math.ceil((contentBottom - contentTop + PAD_Y * 2) * ZOOM);

	const ctx = makeCanvasContext($canvas("anat"), W, H);

	ctx.fillStyle = cssVar("--card");
	ctx.fillRect(0, 0, W, H);

	// faint advance x lineHeight box
	ctx.fillStyle = "rgba(120,120,200,.12)";
	ctx.fillRect(originX, originY, glyph.xa * ZOOM, lineHeight * ZOOM);

	// The red y=0 guide doubles as a two-axis anchor at the glyph origin:
	// this is its vertical half. Drawn behind the glyph so the bitmap stays
	// readable; the horizontal half is drawn with the other guides below.
	ctx.strokeStyle = cssVar("--r");
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.moveTo(originX, 0);
	ctx.lineTo(originX, H);
	ctx.stroke();

	// scaled-up glyph
	ctx.drawImage(
		atlasImage,
		glyph.x, glyph.y, glyph.w, glyph.h,
		originX + glyph.xo * ZOOM,
		originY + glyph.yo * ZOOM,
		glyph.w * ZOOM,
		glyph.h * ZOOM
	);

	// dashed bounding box, inset half a pixel so it sits on the glyph edge
	ctx.setLineDash([4, 3]);
	ctx.lineWidth = 1;
	ctx.strokeStyle = cssVar("--mut");
	ctx.strokeRect(
		originX + glyph.xo * ZOOM + 0.5,
		originY + glyph.yo * ZOOM + 0.5,
		glyph.w * ZOOM - 1,
		glyph.h * ZOOM - 1
	);
	ctx.setLineDash([]);

	const glyphBottom = glyph.yo + glyph.h;

	// Guide lines span the full canvas width. Drawn in this order so that
	// when several share a y, base (green) ends up on top.
	const guides = [
		{ y: glyphBottom, col: cssVar("--o") },
		{ y: lineHeight, col: cssVar("--b") },
		{ y: 0, col: cssVar("--r") },
		{ y: baseline, col: cssVar("--g") },
	];
	ctx.lineWidth = 2;
	for (const g of guides) {
		const gy = originY + g.y * ZOOM;
		ctx.strokeStyle = g.col;
		ctx.beginPath();
		ctx.moveTo(0, gy);
		ctx.lineTo(W, gy);
		ctx.stroke();
	}

	// vertical xadvance line
	ctx.strokeStyle = cssVar("--p");
	ctx.beginPath();
	ctx.moveTo(originX + glyph.xa * ZOOM, originY);
	ctx.lineTo(originX + glyph.xa * ZOOM, originY + lineHeight * ZOOM);
	ctx.stroke();

	// legend readouts (HTML overlay / row beneath the canvas)
	const descenderDepth = glyphBottom - baseline;
	$("vb").textContent = String(baseline);
	$("vl").textContent = String(lineHeight);
	const bottomSlack = lineHeight - frame.maxBottom;
	$("vgap").textContent = bottomSlack < 0 ? `(${bottomSlack})` : String(bottomSlack);
	$("vbot").textContent = String(glyphBottom);
	$("xa").textContent = String(glyph.xa);
	$("vbd").textContent = descenderDepth
		? (descenderDepth > 0 ? `+${descenderDepth}px ` : `${descenderDepth}px `)
		: "";
	$("vbd").className = descenderDepth ? "warn" : "good";
	$("anaInfo").innerHTML =
		`<b style="font-size:1.6em">\u201C${charFromCode(selectedCode)}\u201D</b> ` +
		`<span class="mut">id ${selectedCode}</span>`;
}

function drawAtlasOverview() {
	const ZOOM = 4;
	const ctx = makeCanvasContext($canvas("atlas"), header.scaleW * ZOOM, header.scaleH * ZOOM);

	ctx.fillStyle = cssVar("--card");
	ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
	ctx.drawImage(atlasImage, 0, 0, header.scaleW * ZOOM, header.scaleH * ZOOM);

	// yellow tint over failing glyphs
	ctx.fillStyle = "rgba(255,199,60,.32)";
	badChars.forEach(code => {
		const g = glyphs[code];
		if (g) ctx.fillRect(g.x * ZOOM, g.y * ZOOM, g.w * ZOOM, g.h * ZOOM);
	});

	// accent outline on selected
	const sel = glyphs[selectedCode];
	ctx.strokeStyle = cssVar("--acc");
	ctx.lineWidth = 2;
	ctx.strokeRect(sel.x * ZOOM, sel.y * ZOOM, sel.w * ZOOM, sel.h * ZOOM);
}

function renderGlyphGrid() {
	const container = $("grid");
	container.innerHTML = "";

	for (const codeStr of Object.keys(glyphs)) {
		const code = Number(codeStr);
		const btn = document.createElement("button");
		btn.textContent = glyphLabel(code);
		btn.className =
			(badChars.has(code) ? "bad " : "") +
			(code === selectedCode ? "on" : "");
		btn.title = `id ${code}`;
		btn.onclick = () => { selectedCode = code; redrawAll(); };
		container.appendChild(btn);
	}
}

function syncFormFields() {
	const glyph = glyphs[selectedCode];
	$input("iyo").value = String(glyph.yo);
	$input("ixo").value = String(glyph.xo);
	$input("ixa").value = String(glyph.xa);
	$input("ibase").value = String(baseline);
	$input("ilh").value = String(lineHeight);

	$("selinfo").textContent =
		`id ${selectedCode} \u201C${charFromCode(selectedCode)}\u201D ` +
		`${glyph.w}\u00D7${glyph.h} @ ${glyph.x},${glyph.y}`;
	$("fname").textContent = `${header.face} \u00B7 ${header.size}px`;
}

//#endregion

//#region 📐 Ink Box / Trim

/** Drop cached ink bounds (call whenever the atlas or a rect changes;
 *  nudging xoffset/yoffset does not affect them). */
const invalidateInkCache = () => { inkCache = null; };

/** Tight bounding box of non-transparent pixels inside a glyph's atlas
 *  rect. Returns null for a blank glyph, or when pixels can't be read.
 *  @param {number} code
 *  @returns {InkBox|null}
 */
function inkBox(code) {
	if (!inkCache) inkCache = {};
	if (code in inkCache) return inkCache[code];
	const g = glyphs[code];
	if (g.w <= 0 || g.h <= 0) return inkCache[code] = null; // no pixels to read
	const c = document.createElement("canvas");
	c.width = g.w;
	c.height = g.h;
	const cx = c.getContext("2d", { willReadFrequently: true });
	let d;
	try {
		cx.drawImage(atlasImage, g.x, g.y, g.w, g.h, 0, 0, g.w, g.h);
		d = cx.getImageData(0, 0, g.w, g.h).data;
	} catch {
		inkReadFailed = true;
		inkCache = null; // let a later redraw retry once an image is loaded
		return null;
	}
	let l = g.w, t = g.h, r = -1, b = -1;
	for (let y = 0; y < g.h; y++) {
		for (let x = 0; x < g.w; x++) {
			if (d[(y * g.w + x) * 4 + 3] > 0) {
				if (x < l) l = x;
				if (x > r) r = x;
				if (y < t) t = y;
				if (y > b) b = y;
			}
		}
	}
	return inkCache[code] = r < 0 ? null : { l, t, r: r + 1, b: b + 1 };
}

/** True when a glyph's rect has transparent padding on any edge.
 *  @param {number} code */
function hasBlankEdges(code) {
	const k = inkBox(code), g = glyphs[code];
	return !!k && (k.l > 0 || k.t > 0 || k.r < g.w || k.b < g.h);
}

/** Any glyph currently failing the blank-edge rule? */
function needsTrim() {
	return Object.keys(glyphs).map(Number).some(code => hasBlankEdges(code));
}

/** Crop every non-blank glyph's rect to its ink. Offsets move with it so
 *  the glyph renders identically; advances are left untouched. */
function trimGlyphs() {
	for (const code of Object.keys(glyphs).map(Number)) {
		const k = inkBox(code), g = glyphs[code];
		if (!k) continue; // blank glyph (e.g. space): leave alone
		g.x += k.l;
		g.y += k.t;
		g.xo += k.l;
		g.yo += k.t;
		g.w = k.r - k.l;
		g.h = k.b - k.t;
	}
	invalidateInkCache();
}

/** Trim-only shortcut. Auto-fix calls trimGlyphs() before its metric math. */
function trimAll() {
	trimGlyphs();
	redrawAll();
}

//#endregion

//#region ✅ Checks

function runChecks() {
	inkReadFailed = false;
	const descenderChars = $input("dset").value;
	const hangingChars = $input("hangset").value;
	const isDescender = ch => descenderChars.includes(ch);
	const mayHang = ch => isDescender(ch) || hangingChars.includes(ch);
	const isAlnum = ch => /[A-Za-z0-9]/.test(ch);
	const glyphBottom = g => g.yo + g.h;

	/** @type {Rule[]} */
	const rules = [
		{
			label: "Rect has blank edges",
			hint: () => inkReadFailed
				? "can't read pixels, use Open .fnt + .png"
				: "rect \u2260 ink bbox",
			test: (_g, _ch, code) => hasBlankEdges(code),
			fix: {
				label: "Trim",
				title: "Trim only (lossless) \u2014 Auto-fix trims too",
				run: trimAll,
			},
		},
		{
			label: "Above top",
			hint: "yoffset < 0",
			test: g => g.yo < 0,
		},
		{
			label: "Not on baseline",
			hint: "bottom \u2260 base",
			test: (g, ch) =>
				isAlnum(ch) && !mayHang(ch) && glyphBottom(g) !== baseline,
		},
		{
			label: "Descender too high",
			hint: "tail \u2264 base",
			test: (g, ch) => isDescender(ch) && glyphBottom(g) <= baseline,
		},
		{
			label: "Past lineHeight",
			hint: "overflows line box",
			test: g => glyphBottom(g) > lineHeight,
		},
		{
			label: "Outside atlas",
			hint: "leaves PNG",
			test: g =>
				g.x < 0 || g.y < 0 ||
				g.x + g.w > header.scaleW ||
				g.y + g.h > header.scaleH,
		},
		{
			label: "Advance too small",
			hint: "wider than advance \u00B7 trim, else real ink",
			test: g => g.xa < g.xo + g.w,
		},
	];

	const resultsEl = $("chk");
	resultsEl.innerHTML = "";
	badChars = new Set();
	let totalFailingRules = 0;

	/**
	 * @param {boolean} pass
	 * @param {string} label
	 * @param {string | (() => string)} hint
	 * @param {number} [count]
	 * @param {number[]} [failingCodes]
	 * @param {{ label:string, title?:string, run:() => void }} [fix]
	 */
	const renderRow = (pass, label, hint, count, failingCodes, fix) => {
		if (!pass) totalFailingRules++;
		const hintText = typeof hint === "function" ? hint() : hint;

		const row = document.createElement("div");
		row.className = "chk " + (pass ? "ok" : "no");
		row.innerHTML =
			`<p><span class="ic">${pass ? "\u2713" : "\u2717"}</span>` +
			`<span class="t">${label}</span>` +
			`<span class="mut">${hintText}</span>` +
			(count == null ? "" :
				`<span class="cnt" style="color:var(${pass ? "--g" : "--y"})">${count}</span>`) +
			`</p>`;

		if (failingCodes && failingCodes.length) {
			const chips = document.createElement("div");
			chips.className = "chips";
			for (const code of failingCodes) {
				const b = document.createElement("button");
				b.textContent = glyphLabel(code);
				b.className = code === selectedCode ? "on" : "";
				b.onclick = () => { selectedCode = code; redrawAll(); };
				chips.appendChild(b);
			}
			row.appendChild(chips);

			if (fix) {
				const btns = document.createElement("div");
				btns.className = "btns";
				btns.style.margin = "6px 0 0";
				const b = document.createElement("button");
				b.textContent = fix.label;
				if (fix.title) b.title = fix.title;
				b.onclick = fix.run;
				btns.appendChild(b);
				row.appendChild(btns);
			}
		}
		resultsEl.appendChild(row);
	};

	for (const rule of rules) {
		const failingCodes = Object.keys(glyphs)
			.map(Number)
			.filter(code => rule.test(glyphs[code], charFromCode(code), code));
		for (const code of failingCodes) badChars.add(code);
		renderRow(
			failingCodes.length === 0,
			rule.label,
			rule.hint,
			failingCodes.length,
			failingCodes,
			rule.fix
		);
	}

	// two global checks
	const allGlyphs = Object.values(glyphs);
	if (allGlyphs.length) {
		const desiredTopGap = appliedTopGap;
		const desiredBotGap = appliedBotGap;

		const highestY = Math.min(...allGlyphs.map(g => g.yo));
		const lowestBottom = Math.max(...allGlyphs.map(g => g.yo + g.h));

		renderRow(
			highestY === desiredTopGap,
			"Top edge aligned",
			highestY === desiredTopGap
				? "highest glyph at top gap"
				: `highest glyph at top gap \u00B7 expected ${desiredTopGap}, got ${highestY}`
		);

		renderRow(
			lineHeight === lowestBottom + desiredBotGap,
			"Line height fits",
			lineHeight === lowestBottom + desiredBotGap
				? "lowest glyph + bottom gap"
				: `lowest glyph + bottom gap \u00B7 expected ${lowestBottom + desiredBotGap}, got ${lineHeight}`
		);
	}

	const pill = $("sum");
	pill.textContent = badChars.size
		? `${badChars.size}/${Object.keys(glyphs).length} glyphs flagged`
		: (totalFailingRules ? "line box needs a fix" : "All checks pass");
	pill.className = "pill" + (totalFailingRules ? "" : " ok");
}

//#endregion

//#region 🔧 Auto-Fix

/** @param {number[]} values @returns {number|null} */
function mostCommonValue(values) {
	/** @type {Record<number, number>} */
	const counts = {};
	for (const v of values) counts[v] = (counts[v] || 0) + 1;
	const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
	return top ? Number(top[0]) : null;
}

function autoFix() {
	// Lossless; the math below assumes tight rects.
	if (needsTrim()) trimGlyphs();

	const descenderChars = $input("dset").value;
	const hangingChars = $input("hangset").value;
	// An empty command field means "no new gap" — reuse the applied target so
	// re-running Auto-fix is idempotent instead of undoing the last gap.
	const topGap = $input("top").value === "" ? appliedTopGap : Number($input("top").value);
	const bottomGap = $input("gap").value === "" ? appliedBotGap : Number($input("gap").value);
	const codes = Object.keys(glyphs).map(Number);
	/** @type {string[]} */
	const log = [];

	const AGREE = 0.6;      // share of flat glyphs that must agree to call it a uniform shift
	const SNAP_TOL = 1;     // per-glyph snap only for errors this small
	const XHEIGHT = "acemnorsuvwxz";
	const XDESC = "gpqy";   // descenders whose top is the x-height

	const bottomOf = c => glyphs[c].yo + glyphs[c].h;
	const isFlat = c => {
		const ch = charFromCode(c);
		return /[A-Za-z0-9]/.test(ch)
			&& !descenderChars.includes(ch)
			&& !hangingChars.includes(ch);
	};
	const flat = codes.filter(isFlat);
	if (!flat.length) return;

	// 0. Uniform offset? Move everything once instead of glyph by glyph.
	{
		const bottoms = flat.map(bottomOf);
		const modal = mostCommonValue(bottoms);
		if (modal == null) return; // unreachable: flat is non-empty
		const agree = bottoms.filter(b => b === modal).length / bottoms.length;
		if (agree >= AGREE && modal !== baseline) {
			const d = baseline - modal;
			const highest = Math.min(...codes.map(c => glyphs[c].yo));
			const pct = Math.round(agree * 100);
			if (highest + d === topGap) {
				codes.forEach(c => { glyphs[c].yo += d; });
				log.push(`Shifted all glyphs by ${d} (${pct}% of flat glyphs agreed on bottom ${modal}, base is ${baseline}).`);
			} else if (highest === topGap) {
				log.push(`Base ${baseline} \u2192 ${modal} (${pct}% of flat glyphs end at ${modal}, top already at gap).`);
				baseline = modal;
			} else {
				log.push(`Flat glyphs end at ${modal} but base is ${baseline}, and neither shift nor base change fixes the top edge. Left alone.`);
			}
		}
	}

	// 1. Snap near-misses to the common baseline; leave big deviations (f J Q Y) for review.
	const commonBottom = mostCommonValue(flat.map(bottomOf));
	if (commonBottom == null) return; // unreachable: flat is non-empty
	let snapped = 0, skipped = 0;
	flat.forEach(c => {
		const off = commonBottom - bottomOf(c);
		if (off === 0) return;
		if (Math.abs(off) <= SNAP_TOL) { glyphs[c].yo += off; snapped++; }
		else skipped++;
	});
	if (snapped) log.push(`Snapped ${snapped} glyph(s) to the baseline.`);
	if (skipped) log.push(`${skipped} flat glyph(s) are far off the baseline and were left for review.`);

	// 2. Descender tops: x-height descenders match x-height; j matches i.
	const letterTop = mostCommonValue(
		codes.filter(c => XHEIGHT.includes(charFromCode(c))).map(c => glyphs[c].yo)
	);
	if (letterTop != null) {
		codes.forEach(c => {
			const ch = charFromCode(c);
			if (!descenderChars.includes(ch)) return;
			if (ch === "j" && glyphs[105]) glyphs[c].yo = glyphs[105].yo;
			else if (XDESC.includes(ch)) glyphs[c].yo = letterTop;
		});
	}

	// 3. Highest glyph to the top gap.
	const highestY = Math.min(...codes.map(c => glyphs[c].yo));
	const shift = topGap - highestY;
	if (shift) {
		codes.forEach(c => { glyphs[c].yo += shift; });
		log.push(`Moved all glyphs by ${shift} to meet the top gap.`);
	}
	baseline = commonBottom + shift;

	// 4. Fit lineHeight.
	const oldLH = lineHeight;
	lineHeight = Math.max(...codes.map(bottomOf)) + bottomGap;
	if (lineHeight !== oldLH) log.push(`lineHeight ${oldLH} \u2192 ${lineHeight}.`);

	// The gap inputs are one-shot commands: their values are now baked into
	// yoffset/lineHeight, so clear them and keep the applied values for checks.
	appliedTopGap = topGap;
	appliedBotGap = bottomGap;
	$input("top").value = "";
	$input("gap").value = "";

	$("fixlog").textContent = log.join(" ") || "Nothing to fix.";
	redrawAll();
}

//#endregion

//#region 📤 Export

/**
 * @param {string} tag
 * @param {Record<string, any>} obj
 * @param {string[]} [preferredOrder]
 * @returns {string}
 */
function formatAttributes(tag, obj, preferredOrder) {
	const keys = preferredOrder
		? [...preferredOrder, ...Object.keys(obj).filter(k => !preferredOrder.includes(k))]
		: Object.keys(obj);

	return tag + keys.map(k => {
		const v = obj[k];
		if (v == null || v === "") return null;
		const needsQuotes = /[\s"]/.test(String(v));
		return " " + k + "=" +
			(needsQuotes ? `"${String(v).replace(/"/g, "")}"` : v);
	}).filter(Boolean).join("");
}

function buildFntText() {
	const info = { ...extraInfoAttrs, face: header.face, size: header.size };
	const pages = pageLines.length
		? pageLines
		: [`page id=0 file="${header.pageFile}"`];
	const common = {
		...extraCommonAttrs,
		lineHeight,
		base: baseline,
		scaleW: header.scaleW,
		scaleH: header.scaleH,
		pages: pages.length,
	};

	let out =
		formatAttributes("info", info, ["face", "size"]) + "\n" +
		formatAttributes("common", common, ["lineHeight", "base", "scaleW", "scaleH", "pages"]) + "\n";

	pages.forEach(p => { out += p + "\n"; });

	out += `chars count=${Object.keys(glyphs).length}\n`;
	Object.keys(glyphs)
		.map(Number)
		.sort((a, b) => a - b)
		.forEach(n => {
			const g = glyphs[n];
			const letter = n === 32 ? "space" : charFromCode(n);
			out +=
				`char id=${String(n).padEnd(3)} ` +
				`x=${String(g.x).padStart(3)} ` +
				`y=${String(g.y).padStart(3)} ` +
				`width=${String(g.w).padStart(2)} ` +
				`height=${String(g.h).padStart(2)} ` +
				`xoffset=${String(g.xo).padStart(2)} ` +
				`yoffset=${String(g.yo).padStart(2)} ` +
				`xadvance=${String(g.xa).padStart(2)} ` +
				`page=0 chnl=0 letter="${letter}"\n`;
		});

	if (kerningLines.length) {
		out += `kernings count=${kerningLines.length}\n`;
		kerningLines.forEach(k => { out += k + "\n"; });
	}
	return out;
}

//#endregion

//#region 🔍 Parser

/**
 * @param {string} text
 * @param {string|null} basePath
 * @param {boolean} [skipImageLoad]
 * @returns {boolean}
 */
function parseFnt(text, basePath, skipImageLoad) {
	clearFixLog();
	/** @type {CharMap} */
	const parsedGlyphs = {};
	const h = { ...header };
	let parsedLineHeight = lineHeight;
	let parsedBaseline = baseline;

	/** @param {string} line @param {string} key @returns {string|null} */
	const getAttr = (line, key) => {
		const m = line.match(new RegExp("\\b" + key + '="?([^"\\s]*)"?'));
		return m ? m[1] : null;
	};

	/** @param {string} line @returns {Record<string,string>} */
	const parseAllAttrs = line => {
		/** @type {Record<string,string>} */
		const o = {};
		line.replace(/(\w+)=("([^"]*)"|[^\s]+)/g, (_, k, _v, quoted) => {
			o[k] = quoted != null ? quoted : _v;
		});
		return o;
	};

	/** @type {Record<string,string>} */ const info = {};
	/** @type {Record<string,string>} */ const common = {};
	/** @type {string[]} */ const pages = [];
	/** @type {string[]} */ const kernings = [];

	text.split(/\r?\n/).forEach(rawLine => {
		const line = rawLine.trim();
		if (!line) return;

		if (/^char /.test(line)) {
			const id = Number(getAttr(line, "id"));
			parsedGlyphs[id] = {
				x: +getAttr(line, "x"),
				y: +getAttr(line, "y"),
				w: +getAttr(line, "width"),
				h: +getAttr(line, "height"),
				xo: +getAttr(line, "xoffset"),
				yo: +getAttr(line, "yoffset"),
				xa: +getAttr(line, "xadvance"),
			};
		} else if (/^common /.test(line)) {
			const a = parseAllAttrs(line);
			parsedLineHeight = +a.lineHeight;
			parsedBaseline = +a.base;
			h.scaleW = +a.scaleW;
			h.scaleH = +a.scaleH;
			Object.assign(common, a);
		} else if (/^info /.test(line)) {
			const a = parseAllAttrs(line);
			h.face = a.face || h.face;
			h.size = +a.size || h.size;
			Object.assign(info, a);
		} else if (/^page /.test(line)) {
			const a = parseAllAttrs(line);
			h.pageFile = a.file || h.pageFile;
			pages.push(line);
		} else if (/^kerning /.test(line)) {
			kernings.push(line);
		}
	});

	if (!Object.keys(parsedGlyphs).length) return false;

	glyphs = parsedGlyphs;
	lineHeight = parsedLineHeight;
	baseline = parsedBaseline;
	// The .fnt has no gap fields — the gaps are implicit in the metrics. Adopt
	// the loaded font's own spacing as the target so "Top edge aligned" and
	// "Line height fits" don't report false failures on load. Nudging a glyph
	// after load still breaks the corresponding check.
	{
		const codes = Object.keys(parsedGlyphs).map(Number);
		appliedTopGap = Math.min(...codes.map(c => parsedGlyphs[c].yo));
		appliedBotGap = parsedLineHeight -
			Math.max(...codes.map(c => parsedGlyphs[c].yo + parsedGlyphs[c].h));
	}
	header = h;
	extraInfoAttrs = info;
	extraCommonAttrs = common;
	pageLines = pages;
	kerningLines = kernings;

	selectedCode = glyphs[65] ? 65 : Number(Object.keys(glyphs)[0]);

	invalidateInkCache();
	if (header.pageFile && !skipImageLoad) {
		const dir = basePath ? basePath.replace(/[^/]*$/, "") : "";
		atlasImage.onload = () => { invalidateInkCache(); redrawAll(); };
		atlasImage.src = dir + header.pageFile;
	} else {
		redrawAll();
	}
	return true;
}

//#endregion

//#region ⚡ Event Handlers

/**
 * Editors that mutate a single glyph field or the baseline/lineHeight.
 * @param {string} id
 * @param {(v:number) => void} applyFn
 */
function bindNumericInput(id, applyFn) {
	$input(id).oninput = event => {
		if (!hasGlyphs()) return;
		const target = /** @type {HTMLInputElement} */ (event.target);
		applyFn(+target.value);
		redrawAll();
	};
}

bindNumericInput("iyo", v => { glyphs[selectedCode].yo = v; });
bindNumericInput("ixo", v => { glyphs[selectedCode].xo = v; });
bindNumericInput("ixa", v => { glyphs[selectedCode].xa = v; });
bindNumericInput("ibase", v => { baseline = v; });
bindNumericInput("ilh", v => { lineHeight = v; });

// Bulk-shift Δy over a glyph group. The `desc` / `nodesc` filters read
// the live #dset value, so they stay consistent with the checks.
/** @type {Record<string, (ch:string) => boolean>} */
const glyphGroups = {
	all: () => true,
	up: ch => /[A-Z]/.test(ch),
	low: ch => /[a-z]/.test(ch),
	desc: ch => $input("dset").value.includes(ch),
	nodesc: ch => /[a-z]/.test(ch) && !$input("dset").value.includes(ch),
	dig: ch => /[0-9]/.test(ch),
	pun: ch => /[^A-Za-z0-9 ]/.test(ch),
};

$("apply").onclick = () => {
	if (!hasGlyphs()) return;
	const filter = glyphGroups[$input("grp").value];
	const delta = Number($input("dy").value);
	for (const codeStr of Object.keys(glyphs)) {
		if (filter(charFromCode(Number(codeStr)))) {
			glyphs[Number(codeStr)].yo += delta;
		}
	}
	redrawAll();
};

$("fix").onclick = autoFix;
$input("dset").oninput = redrawAll;
$input("hangset").oninput = redrawAll;
$input("top").oninput = runChecks;
$input("gap").oninput = runChecks;

$("theme").onclick = () => {
	const root = document.documentElement;
	const dark = root.dataset.theme
		? root.dataset.theme === "dark"
		: matchMedia("(prefers-color-scheme:dark)").matches;
	const next = dark ? "light" : "dark";
	root.dataset.theme = next;
	try { localStorage.setItem("theme", next); } catch (e) { }
	redrawAll();
};

// Click on the atlas to pick a glyph.
const atlasCanvas = $canvas("atlas");
atlasCanvas.onclick = event => {
	if (!hasGlyphs()) return;
	const rect = atlasCanvas.getBoundingClientRect();
	const px = (event.clientX - rect.left) / rect.width * header.scaleW;
	const py = (event.clientY - rect.top) / rect.height * header.scaleH;

	const hitCode = Object.keys(glyphs).map(Number).find(code => {
		const g = glyphs[code];
		return px >= g.x && px < g.x + g.w
			&& py >= g.y && py < g.y + g.h;
	});
	if (hitCode != null) {
		selectedCode = hitCode;
		redrawAll();
	}
};

// Keyboard: plain arrows nudge the selected glyph (xoffset/yoffset),
// Mod (Ctrl/Cmd) + arrows select a glyph instead.
addEventListener("keydown", event => {
	const target = /** @type {HTMLElement} */ (event.target);
	const inField = /INPUT|TEXTAREA|SELECT/.test(target.tagName);
	if (inField || !hasGlyphs()) return;

	const codes = Object.keys(glyphs).map(Number);
	const idx = codes.indexOf(selectedCode);
	const mod = event.ctrlKey || event.metaKey;
	const step = event.shiftKey ? 10 : 1;
	const g = glyphs[selectedCode];

	if (mod) {
		// Selection / navigation.
		if (event.key === "ArrowRight") {
			selectedCode = codes[Math.min(codes.length - 1, idx + 1)];
		} else if (event.key === "ArrowLeft") {
			selectedCode = codes[Math.max(0, idx - 1)];
		} else if (event.key === "ArrowUp") {
			selectedCode = codes[0];
		} else if (event.key === "ArrowDown") {
			selectedCode = codes[codes.length - 1];
		} else {
			return;
		}
	} else {
		// Nudge in glyph space: up/left negative, down/right positive.
		if (event.key === "ArrowUp") {
			g.yo -= step;
		} else if (event.key === "ArrowDown") {
			g.yo += step;
		} else if (event.key === "ArrowLeft") {
			g.xo -= step;
		} else if (event.key === "ArrowRight") {
			g.xo += step;
		} else {
			return;
		}
	}
	event.preventDefault();
	redrawAll();
});

//#endregion

//#region 💾 File I/O

$("exp").onclick = () => { $textarea("fnt").value = buildFntText(); };

$("cp").onclick = () => {
	const fnt = $textarea("fnt");
	fnt.value = buildFntText();
	try { navigator.clipboard.writeText(fnt.value); }
	catch { fnt.select(); }
};

$("dl").onclick = () => {
	if (!hasGlyphs()) return;
	const fnt = $textarea("fnt");
	fnt.value = buildFntText();
	const a = document.createElement("a");
	a.href = URL.createObjectURL(new Blob([fnt.value], { type: "text/plain" }));
	a.download = ((header.face || "font").replace(/[^\w.-]+/g, "_") || "font") + ".fnt";
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

$("load").onclick = () => { clearFixLog(); parseFnt($textarea("fnt").value, null, false); };

// Drag-and-drop / open-both-together
/** @type {string|null} */ let pendingFnt = null;
/** @type {File|null} */ let pendingPng = null;

/** @param {File} file @returns {Promise<void>} */
const loadImage = file => new Promise(resolve => {
	atlasImage.onload = () => {
		invalidateInkCache();
		header.scaleW = atlasImage.width;
		header.scaleH = atlasImage.height;
		resolve();
	};
	atlasImage.src = URL.createObjectURL(file);
});

/** @param {FileList|File[]|null} list */
async function openFiles(list) {
	const files = [...(list || [])];
	const fnt = files.find(f => /\.(fnt|txt)$/i.test(f.name));
	const png = files.find(f => /\.png$/i.test(f.name) || f.type === "image/png");

	if (fnt) pendingFnt = await fnt.text();
	if (png) { pendingPng = png; await loadImage(png); }

	atlasImage.onload = () => { invalidateInkCache(); redrawAll(); };

	if (pendingFnt != null && pendingPng) {
		$textarea("fnt").value = pendingFnt;
		if (parseFnt(pendingFnt, null, true)) {
			header.scaleW = atlasImage.width;
			header.scaleH = atlasImage.height;
			redrawAll();
			$("hint").textContent = `Loaded ${fnt ? fnt.name : ".fnt"} + ${png.name}.`;
		} else {
			$("hint").textContent = "Could not parse .fnt.";
		}
	} else if (pendingFnt != null) {
		$textarea("fnt").value = pendingFnt;
		if (parseFnt(pendingFnt, null, true)) {
			$("hint").textContent = "Loaded .fnt. Now add the matching .png (or drop/open both together).";
		} else {
			$("hint").textContent = "Could not parse .fnt.";
		}
	} else if (pendingPng) {
		$("hint").textContent = `Loaded ${png.name}. Now add the matching .fnt.`;
	}
}

$("open").onclick = () => { clearFixLog(); $input("files").click(); };
$input("files").onchange = e => {
	const input = /** @type {HTMLInputElement} */ (e.currentTarget);
	openFiles(input.files);
	input.value = "";
};

addEventListener("dragover", e => {
	if (e.dataTransfer && [...e.dataTransfer.types || []].includes("Files")) e.preventDefault();
});
addEventListener("drop", e => {
	if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
		e.preventDefault();
		openFiles(e.dataTransfer.files);
	}
});

$textarea("fnt").addEventListener("paste", () => setTimeout(() => {
	parseFnt($textarea("fnt").value, null, false);
}));

//#endregion

//#region 🎮 Demos

/** @param {string} path @param {string} displayName */
async function loadDemo(path, displayName) {
	clearFixLog();
	try {
		const response = await fetch(path);
		if (!response.ok) throw response.status;
		const text = await response.text();
		$textarea("fnt").value = text;
		if (parseFnt(text, path, false)) {
			$("hint").textContent = `Loaded demo ${displayName}.`;
		} else {
			$("hint").textContent = `Could not parse demo ${displayName}.`;
		}
	} catch (err) {
		console.error("Failed to load demo", path, err);
		$("hint").textContent =
			`Could not load demo ${displayName}. If opened as a local file, ` +
			`use a local server or Open .fnt + .png\u2026.`;
	}
}

$("demo1").onclick = () => loadDemo("Font/Super12.fnt", "Super12");
$("demo2").onclick = () => loadDemo("Font/Super12Regen.fnt", "Super12Regen");
$("demo3").onclick = () => loadDemo("Font/Venice16.fnt", "Venice16");
$("demo4").onclick = () => loadDemo("Font/Venice16Regen16.fnt", "Venice16Regen");
$("demo5").onclick = () => loadDemo("Font/Alagard16.fnt", "Alagard16");
$("demo6").onclick = () => loadDemo("Font/Cairo16.fnt", "Cairo16");
$("demo7").onclick = () => loadDemo("Font/lsans-15.fnt", "lsans-15");

//#endregion

//#region 🚀 Boot

atlasImage.onload = () => { invalidateInkCache(); redrawAll(); };
redrawAll();

//#endregion