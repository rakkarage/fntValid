//#region 📖 Guide: explainer infographics (load after app.js)
// Adds a "Guide" button + dialog. Everything is generated here; colors come
// from the same CSS variables as the canvas guides, so themes just work.
(() => {
	const R = 22, T = 18; // px per row / top margin in the big vertical diagram
	/** @param {number} x @param {number} y @param {string} s
	 * @param {string} [v] @param {string} [a] */
	const tx = (x, y, s, v = "", a = "") =>
		`<text x="${x}" y="${y}" class="gt" ${a} style="${v ? "fill:var(" + v + ")" : ""}">${s}</text>`;
	/** @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
	 * @param {string} v @param {number} [w] @param {string} [d] */
	const ln = (x1, y1, x2, y2, v, w = 2, d = "") =>
		`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(${v})" stroke-width="${w}" ${d ? `stroke-dasharray="${d}"` : ""}/>`;

	//#region 📏 Vertical diagrams
	/** The big diagram: glyph rects as the file stores them (yoffset + height). */
	function vMain() {
		const LH = 16, B = 12, x0 = 104, W = 740, H = T + LH * R + 36;
		/** @param {number} r */
		const Y = r => T + r * R;
		// [char, yoffset, height, kind]  f = flat (ends on base)  t = tail  m = floats
		/** @type {Array<[string, number, number, string]>} */
		const bars = [["H", 2, 10, "f"], ["b", 1, 11, "f"], ["x", 5, 7, "f"], ["Å", 0, 12, "f"], [".", 11, 1, "f"],
		["g", 5, 10, "t"], [",", 11, 3, "t"], ["_", 14, 1, "t"], ["(", 1, 14, "t"], ["-", 7, 1, "m"], ["\u201C", 2, 3, "m"]];
		let s = `<svg viewBox="0 0 ${W} ${H}" class="gsvg" role="img" aria-label="Where glyph rects sit between top, base and lineHeight">`;
		s += `<rect x="${x0 - 8}" y="${Y(0)}" width="${W - x0 + 8}" height="${2 * R}" class="zA"/>`;
		s += `<rect x="${x0 - 8}" y="${Y(B)}" width="${W - x0 + 8}" height="${3 * R}" class="zD"/>`;
		/** @type {Array<[number, string, string]>} */
		const guides = [[0, "--r", "top 0"], [B, "--g", "base 12"], [15, "--o", "deepest bottom 15"], [16, "--b", "lineHeight 16"]];
		for (const [r, v, t] of guides) {
			s += ln(x0 - 8, Y(r), W, Y(r), v) + tx(2, Y(r) + (r === 15 ? -4 : 4), t, v);
		}
		bars.forEach(([ch, yo, h, k], i) => {
			const x = x0 + 10 + i * 44;
			s += `<rect x="${x}" y="${Y(yo)}" width="34" height="${h * R}" class="b${k}"><title>${ch}: yoffset ${yo} + height ${h} = bottom ${yo + h}</title></rect>`;
			if (h >= 3) s += tx(x + 17, Y(yo) + h * R / 2 - 2, `${yo}+${h}`, "", 'text-anchor="middle"') +
				tx(x + 17, Y(yo) + h * R / 2 + 11, `=${yo + h}`, "--mut", 'text-anchor="middle"');
			s += tx(x + 17, Y(LH) + 18, ch, "", 'text-anchor="middle"');
		});
		/** @param {number} a @param {number} b @param {number} x @param {string} t @param {string} v */
		const br = (a, b, x, t, v) => `<path d="M${x},${Y(a)} h6 V${Y(b)} h-6" fill="none" stroke="var(${v})" stroke-width="1.5"/>` +
			tx(x + 12, Y((a + b) / 2) + 4, t, v);
		s += br(0, 2, 610, "accent room 2", "--r") + br(2, 12, 610, "cap height 10", "--g") + br(5, 12, 662, "x-height 7", "--g") +
			br(12, 15, 610, "tail depth 3", "--o") + br(15, 16, 610, "gap 1", "--b");
		return s + `</svg>`;
	}

	/** Mini line box: one rect per entry [yoffset, height, ok?, blankPad?].
	 * @param {Array<[number, number, number, number?]>} bars */
	function mini(bars) {
		const r = 6, o = 4 * r;
		/** @param {number} n */
		const Y = n => o + n * r;
		let s = `<svg viewBox="0 0 96 ${o + 16 * r + 12}" class="gmini" aria-hidden="true" focusable="false">`;
		/** @type {Array<[number, string]>} */
		const guides = [[0, "--r"], [12, "--g"], [16, "--b"]];
		for (const [n, v] of guides) s += ln(0, Y(n), 96, Y(n), v, 1.5);
		for (const [yo, h, ok, pad] of bars) {
			if (pad) s += `<rect x="28" y="${Y(yo - 1)}" width="40" height="${(h + 2) * r}" class="bpad"/>`;
			s += `<rect x="34" y="${Y(yo)}" width="28" height="${h * r}" class="${ok ? "bf" : "bb"}"/>`;
		}
		return s + `</svg>`;
	}

	/** Horizontal mini: pen at 30, 8px per column.
	 * @param {number} xo @param {number} w @param {number} xa @param {number} ok */
	function hmini(xo, w, xa, ok) {
		const c = 8, p = 30;
		return `<svg viewBox="0 0 140 52" class="gmini h" aria-hidden="true" focusable="false">` +
			ln(p, 4, p, 40, "--p", 1.5) + ln(p + xa * c, 4, p + xa * c, 40, "--p", 1.5, "3 2") +
			`<rect x="${p + xo * c}" y="10" width="${w * c}" height="24" class="${ok ? "bf" : "bb"}"/>` +
			tx(p, 50, "pen", "--p", 'text-anchor="middle"') + tx(p + xa * c, 50, "pen + xadvance", "--p", 'text-anchor="middle"') + `</svg>`;
	}
	//#endregion

	//#region 🧾 Tabs
	function mine() {
		if (typeof hasGlyphs !== "function" || !hasGlyphs()) return `<p class="mut">Load a font to see its own numbers here.</p>`;
		/** @param {string} ch */
		const G = ch => glyphs[ch.charCodeAt(0)];
		/** @type {Glyph[]} */
		const real = Object.values(glyphs).filter(g => g.w && g.h);
		/** @param {string} ch @param {(g: Glyph) => number} f */
		const of = (ch, f) => (G(ch) ? f(G(ch)) : "\u2013");
		const items = [["base", baseline], ["lineHeight", lineHeight],
		["top gap", Math.min(...real.map(g => g.yo))],
		["cap height (H)", of("H", g => baseline - g.yo)], ["x-height (x)", of("x", g => baseline - g.yo)],
		["tail depth (g)", of("g", g => g.yo + g.h - baseline)],
		["bottom gap", lineHeight - Math.max(...real.map(g => g.yo + g.h))]];
		return `<div class="gd-mine"><b>Your font</b>${items.map(([k, v]) => `<span class="key">${k} <b>${v}</b></span>`).join("")}</div>`;
	}

	const vTab = () => mine() + `<div class="gd-split">${vMain()}<ul class="gd-list">
		<li><b>yoffset</b> counts down from the <i>top of the line</i> to the top of the glyph rect, not from the baseline. The rect should be the ink, with no blank rows (Trim handles padding).</li>
		<li><b>Flat letters</b> (A–Z, 0–9, a–z without tails): <code>yoffset + height = base</code>. This is the one hard rule; it makes text sit level.</li>
		<li><b>Tails</b> (g j p q y, sometimes Q J): bottom is below base but no deeper than lineHeight.</li>
		<li><b>Room above the caps</b> is for accents and tall glyphs. The highest glyph sits at 0 (or just under). ASCII-only? Shift everything up, then lower base and lineHeight by the same amount.</li>
		<li><b>lineHeight</b> = deepest bottom, plus an optional gap. It is the distance between baselines; nothing else is added.</li>
		<li><b>Punctuation</b> follows the same rules: the period ends on base, comma and underscore hang below, the hyphen floats at mid x-height.</li></ul></div>
		<p class="mut">Legend: <span class="sw bf"></span> ends on base <span class="sw bt"></span> hangs below <span class="sw bm"></span> floats.</p>`;

	const hTab = () => {
		const c = 22, p = 40;
		/** @param {number} x */
		const Z = x => p + x * c;
		let s = `<svg viewBox="0 0 640 176" class="gsvg" role="img" aria-label="Pen, xoffset, width and xadvance">`;
		s += `<rect x="${Z(1)}" y="20" width="${8 * c}" height="84" class="bf"/><rect x="${Z(10)}" y="20" width="${5 * c}" height="84" class="bm" opacity=".5"/>`;
		s += ln(Z(0), 8, Z(0), 112, "--p") + ln(Z(10), 8, Z(10), 112, "--p", 2, "4 3");
		s += tx(Z(0), 16, "pen", "--p", 'text-anchor="middle"') + tx(Z(10), 16, "next pen", "--p", 'text-anchor="middle"');
		s += tx(Z(12.5), 66, "next glyph", "--mut", 'text-anchor="middle"');
		/** @param {number} a @param {number} b @param {number} y @param {string} t @param {string} v */
		const dim = (a, b, y, t, v) => ln(Z(a), y, Z(b), y, v, 1.5) + ln(Z(a), y - 5, Z(a), y + 5, v, 1.5) + ln(Z(b), y - 5, Z(b), y + 5, v, 1.5) + tx((Z(a) + Z(b)) / 2, y + 16, t, v, 'text-anchor="middle"');
		s += dim(0, 1, 126, "xoffset 1", "--b") + dim(1, 9, 126, "width 8", "--g") + dim(9, 10, 126, "gap 1", "--o") + dim(0, 10, 156, "xadvance 10", "--p");
		s += `</svg>`;
		const ex = [[hmini(1, 8, 10, 1), "normal: right edge < xadvance, the gap is the letter spacing"],
		[hmini(0, 10, 10, 1), "flush: gap 0, neighbors touch (fine for outlined or intentionally tight fonts)"],
		[hmini(-2, 8, 6, 1), "negative xoffset: the glyph leans left of the pen (J, j, f) and is still inside its advance"],
		[hmini(0, 10, 8, 0), "too small: the rect passes the next pen and overlaps the next glyph; fails the check"]];
		return `<div class="gd-split">${s}<ul class="gd-list">
			<li><b>pen</b>: where this glyph starts. After drawing it, the pen moves right by <b>xadvance</b>.</li>
			<li><b>xoffset</b>: pen to the left edge of the rect. It can be negative.</li>
			<li><b>Right edge</b> = <code>xoffset + width</code>, and it should be ≤ xadvance. The remainder is the letter spacing.</li>
			<li><b>Overhang</b> (right edge past xadvance) is only right for deliberate cases such as f, j or accents over a narrow letter.</li>
			<li><b>Kerning</b> pairs shift the pen between two specific glyphs; they are separate from xadvance and are kept in export.</li>
			<li><b>Space</b> and other empty glyphs have width and height 0; only xadvance matters.</li></ul></div>
			<div class="gd-cards">${ex.map(([v, t]) => `<figure>${v}<figcaption>${t}</figcaption></figure>`).join("")}</div>`;
	};

	const cTab = () => {
		/** @type {Array<[string, string, Array<[number, number, number, number?]>, Array<[number, number, number, number?]>]>} */
		const rules = [
			["Rect has blank edges", "rect \u2260 ink: padding or empty rows", [[2, 10, 1]], [[2, 10, 0, 1]]],
			["Above top", "yoffset < 0", [[2, 10, 1]], [[-2, 14, 0]]],
			["Not on baseline", "flat letter bottom \u2260 base", [[5, 7, 1]], [[5, 8, 0]]],
			["Descender too high", "tail must end below base", [[5, 10, 1]], [[5, 7, 0]]],
			["Past lineHeight", "bottom > lineHeight", [[5, 10, 1]], [[5, 13, 0]]]];
		let s = rules.map(([t, h, ok, bad]) => `<figure class="gd-rule"><b>${t}</b><span class="mut">${h}</span>
			<div class="gd-pair"><span>${mini(ok)}<em class="good">ok</em></span><span>${mini(bad)}<em class="warn">fails</em></span></div></figure>`).join("");
		s += `<figure class="gd-rule"><b>Advance too small</b><span class="mut">xoffset + width > xadvance</span>
			<div class="gd-pair"><span>${hmini(1, 8, 10, 1)}<em class="good">ok</em></span><span>${hmini(0, 10, 8, 0)}<em class="warn">fails</em></span></div></figure>`;
		return `<p class="mut">Red = top, green = base, blue = lineHeight. Each pair shows a passing and a failing glyph.</p><div class="gd-cards">${s}</div>`;
	};
	//#endregion

	//#region 🪟 Dialog
	/** @type {Record<string, [string, () => string]>} */
	const TABS = { v: ["Vertical", vTab], h: ["Horizontal", hTab], c: ["Check examples", cTab] };
	/** @type {string} */
	let cur = "v";
	/** @type {HTMLDialogElement} */
	let dlg;
	/** @type {HTMLElement} */
	let body;

	function render(k = cur) {
		cur = k;
		body.innerHTML = TABS[k][1]();
		body.setAttribute("aria-labelledby", `gdTab-${k}`);
		dlg.querySelectorAll("[data-t]").forEach(b => {
			const tab = /** @type {HTMLElement} */ (b);
			const on = tab.dataset.t === k;
			tab.classList.toggle("on", on);
			tab.setAttribute("aria-selected", String(on));
			tab.tabIndex = on ? 0 : -1;
		});
	}

	function init() {
		const bar = document.querySelector(".topbar-actions");
		if (!bar) return;
		const btn = document.createElement("button");
		btn.id = "guideBtn";
		btn.textContent = "Guide";
		btn.title = "How a character should sit: infographics";
		btn.setAttribute("aria-haspopup", "dialog");
		bar.prepend(btn);

		dlg = document.createElement("dialog");
		dlg.id = "guide";
		dlg.setAttribute("aria-labelledby", "guideTitle");
		dlg.innerHTML = `<div class="card-head"><h2 id="guideTitle">How a character should sit</h2><span class="sp"></span>
			<button id="guideX" aria-label="Close guide">Close</button></div>
			<div class="gd-tabs" role="tablist" aria-label="Guide topics">${Object.entries(TABS).map(([k, [n]]) => `<button data-t="${k}" role="tab" aria-controls="gdBody">${n}</button>`).join("")}</div>
			<div id="gdBody" role="tabpanel" tabindex="0"></div>`;
		document.body.append(dlg);
		body = /** @type {HTMLElement} */ (dlg.querySelector("#gdBody"));

		dlg.querySelectorAll("[data-t]").forEach(b => {
			const tab = /** @type {HTMLElement} */ (b);
			tab.id = `gdTab-${tab.dataset.t}`;
			tab.tabIndex = -1;
			tab.onclick = () => render(/** @type {string} */(tab.dataset.t));
		});
		/** @type {HTMLButtonElement} */ (dlg.querySelector("#guideX")).onclick = () => dlg.close();
		dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });
		dlg.addEventListener("keydown", e => {
			// Keep arrow keys from nudging glyphs behind the dialog, and let
			// Left/Right/Home/End move between tabs as a tablist expects.
			e.stopPropagation();
			const target = e.target;
			if (!(target instanceof HTMLElement)) return;
			const tab = /** @type {HTMLElement|null} */ (target.closest("[data-t]"));
			if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
			e.preventDefault();
			const tabs = /** @type {HTMLElement[]} */ ([...dlg.querySelectorAll("[data-t]")]);
			const i = tabs.indexOf(tab);
			const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1
				: e.key === "ArrowRight" ? (i + 1) % tabs.length
					: (i - 1 + tabs.length) % tabs.length;
			render(/** @type {string} */ (tabs[next].dataset.t));
			tabs[next].focus();
		});
		btn.onclick = () => { render(); dlg.showModal(); };
	}

	/** @type {{ fntGuide: { render: (k: string) => string } }} */
	const w = /** @type {any} */ (window);
	w.fntGuide = { render: k => TABS[k][1]() };
	init();
	//#endregion
})();
//#endregion
