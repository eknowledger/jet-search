// A tiny declarative layer on top of rough.js.
//
// This file has no imports. It is used twice: in Node, to build the plain data
// that describes a diagram, and inside the headless browser page, where
// renderDiagram() draws that data with the rough.js global. render.mjs inlines
// this source into the page, so keep it self-contained.
//
// All positions are explicit pixel values, so layouts are deterministic.
// Each shape gets its own rough.js seed derived from the diagram seed and the
// shape id, so adding a shape does not change how the others are drawn.

// ---------------------------------------------------------------------------
// Builders (plain data)
// ---------------------------------------------------------------------------

/** A diagram: canvas size in px, a rough.js seed and a list of items. */
export function diagram(name, { width, height, seed = 1 }, items) {
	return { name, width, height, seed, items };
}

/**
 * A rectangle with a title and optional small subtitle lines.
 * opts: x, y, w, h, title, sub (string[]), rounded (bool), accent (bool)
 */
export function box(id, opts) {
	return { kind: "box", id, sub: [], rounded: false, accent: false, ...opts };
}

/** A cylinder for a store. Same options as box (rounded is ignored). */
export function cylinder(id, opts) {
	return { kind: "cylinder", id, sub: [], accent: false, ...opts };
}

/**
 * A labelled dashed frame. Give either an explicit x, y, w, h or
 * around: [ids] to fit the frame around those shapes (grown by pad px).
 * opts: label, around, pad (default 26), x, y, w, h
 */
export function group(id, opts) {
	return { kind: "group", id, pad: 26, ...opts };
}

/**
 * An arrow between two shapes, by id.
 * opts:
 *   fromSide, toSide  "l" | "r" | "t" | "b" (default: picked from the layout)
 *   fromAt, toAt      0..1 position along the side (default 0.5)
 *   elbow             route with right-angle bends instead of a straight line
 *   bendX, bendY      where the middle segment of an elbow sits (x for a left/right pair, y for a top/bottom pair)
 *   dashed            dashed line
 *   label             small text next to the longest segment
 *   labelDx, labelDy  nudge the label in px
 *   both              also draw an arrowhead at the start
 */
export function arrow(from, to, opts = {}) {
	return { kind: "arrow", id: `${from}->${to}`, from, to, ...opts };
}

/** Plain text. opts: x, y, text (use \n for lines), align ("start"|"middle"|"end"), size, muted */
export function note(id, opts) {
	return { kind: "note", id, align: "start", size: 16, muted: true, ...opts };
}

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

export const themes = {
	// Light strokes and text, for dark pages.
	dark: {
		accent: [139, 124, 248],
		stroke: "rgba(232, 234, 244, 0.88)",
		text: "#eceef6",
		muted: "rgba(232, 234, 244, 0.62)",
		fill: "rgba(255, 255, 255, 0.045)",
		frame: "rgba(232, 234, 244, 0.45)",
	},
	// Dark strokes and text, for light pages.
	light: {
		accent: [110, 92, 232],
		stroke: "rgba(32, 35, 50, 0.88)",
		text: "#1d2030",
		muted: "rgba(32, 35, 50, 0.62)",
		fill: "rgba(0, 0, 0, 0.035)",
		frame: "rgba(32, 35, 50, 0.45)",
	},
};

export const FONT = "Excalifont";

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const TITLE_SIZE = 22;
const SUB_SIZE = 15;
const LABEL_SIZE = 15;
const GROUP_LABEL_SIZE = 17;

function hash(str) {
	let h = 2166136261;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0) % 2147483647 || 1;
}

function anchor(s, side, at = 0.5) {
	switch (side) {
		case "l":
			return { x: s.x, y: s.y + s.h * at, dx: -1, dy: 0 };
		case "r":
			return { x: s.x + s.w, y: s.y + s.h * at, dx: 1, dy: 0 };
		case "t":
			return { x: s.x + s.w * at, y: s.y, dx: 0, dy: -1 };
		default:
			return { x: s.x + s.w * at, y: s.y + s.h, dx: 0, dy: 1 };
	}
}

function pickSides(a, b) {
	const ax = a.x + a.w / 2;
	const ay = a.y + a.h / 2;
	const bx = b.x + b.w / 2;
	const by = b.y + b.h / 2;
	if (Math.abs(bx - ax) >= Math.abs(by - ay)) return bx >= ax ? ["r", "l"] : ["l", "r"];
	return by >= ay ? ["b", "t"] : ["t", "b"];
}

/** Points of the arrow path, from the first anchor to the second. */
function routeArrow(a, b, elbow, bendX, bendY) {
	const p = { x: a.x, y: a.y };
	const q = { x: b.x, y: b.y };
	if (!elbow) return [p, q];
	const aHoriz = a.dx !== 0;
	const bHoriz = b.dx !== 0;
	const OUT = 34; // how far a same-side route leaves the shapes
	if (aHoriz && bHoriz) {
		// Same side on both ends (r to r, l to l): loop around outside.
		const mx =
			a.dx === b.dx ? (a.dx > 0 ? Math.max(p.x, q.x) + OUT : Math.min(p.x, q.x) - OUT) : (bendX ?? (p.x + q.x) / 2);
		return [p, { x: mx, y: p.y }, { x: mx, y: q.y }, q];
	}
	if (!aHoriz && !bHoriz) {
		const my =
			a.dy === b.dy ? (a.dy > 0 ? Math.max(p.y, q.y) + OUT : Math.min(p.y, q.y) - OUT) : (bendY ?? (p.y + q.y) / 2);
		return [p, { x: p.x, y: my }, { x: q.x, y: my }, q];
	}
	if (aHoriz) return [p, { x: q.x, y: p.y }, q];
	return [p, { x: p.x, y: q.y }, q];
}

function dedupe(points) {
	return points.filter((pt, i) => i === 0 || pt.x !== points[i - 1].x || pt.y !== points[i - 1].y);
}

// ---------------------------------------------------------------------------
// Renderer (runs in the browser page, with the rough.js global)
// ---------------------------------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Draw a diagram into an <svg> element.
 * Returns a list of warnings (text wider than its box, shapes off the canvas).
 */
export function renderDiagram(rough, svg, dia, themeName, doc = document) {
	const theme = themes[themeName];
	const [cr, cg, cb] = theme.accent;
	const accent = `rgb(${cr}, ${cg}, ${cb})`;
	const accentFill = `rgba(${cr}, ${cg}, ${cb}, 0.14)`;
	const warnings = [];

	svg.setAttribute("width", String(dia.width));
	svg.setAttribute("height", String(dia.height));
	svg.setAttribute("viewBox", `0 0 ${dia.width} ${dia.height}`);
	svg.setAttribute("xmlns", SVG_NS);
	const rc = rough.svg(svg);

	const byId = new Map();
	for (const it of dia.items) byId.set(it.id, it);

	const opts = (id, extra = {}) => ({
		seed: (dia.seed + hash(id)) % 2147483647 || 1,
		roughness: 1.3,
		bowing: 1,
		strokeWidth: 2,
		stroke: theme.stroke,
		...extra,
	});

	const add = (node) => {
		svg.appendChild(node);
		return node;
	};

	const text = (str, x, y, { size, fill, anchorAt = "middle", maxWidth, what }) => {
		const el = doc.createElementNS(SVG_NS, "text");
		el.setAttribute("x", String(x));
		el.setAttribute("y", String(y));
		el.setAttribute("text-anchor", anchorAt);
		el.setAttribute("dominant-baseline", "central");
		el.setAttribute("font-family", `${FONT}, sans-serif`);
		el.setAttribute("font-size", String(size));
		el.setAttribute("fill", fill);
		el.textContent = str;
		svg.appendChild(el);
		if (maxWidth && el.getComputedTextLength() > maxWidth) {
			warnings.push(`text too wide for ${what}: "${str}"`);
		}
		return el;
	};

	/** Resolve a shape's rectangle (groups can be fitted around other shapes). */
	const rectOf = (it) => {
		if (it.kind === "group" && it.around) {
			const rects = it.around.map((id) => {
				const t = byId.get(id);
				if (!t) throw new Error(`group ${it.id}: unknown shape ${id}`);
				return rectOf(t);
			});
			const x1 = Math.min(...rects.map((r) => r.x)) - it.pad;
			const y1 = Math.min(...rects.map((r) => r.y)) - it.pad - 18;
			const x2 = Math.max(...rects.map((r) => r.x + r.w)) + it.pad;
			const y2 = Math.max(...rects.map((r) => r.y + r.h)) + it.pad;
			return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
		}
		return { x: it.x, y: it.y, w: it.w, h: it.h };
	};

	const kinds = (k) => dia.items.filter((it) => it.kind === k);

	// 1. Group frames, behind everything.
	for (const g of kinds("group")) {
		const r = rectOf(g);
		add(
			rc.rectangle(r.x, r.y, r.w, r.h, opts(g.id, {
				stroke: theme.frame,
				strokeWidth: 1.6,
				strokeLineDash: [9, 8],
				roughness: 1.1,
			})),
		);
		if (g.label) {
			text(g.label, r.x + 16, r.y + 20, {
				size: GROUP_LABEL_SIZE,
				fill: theme.muted,
				anchorAt: "start",
				maxWidth: r.w - 32,
				what: `group ${g.id}`,
			});
		}
	}

	// 2. Boxes and cylinders.
	const labelLines = (it, cx, top, height, maxWidth) => {
		const lines = [
			{ s: it.title, size: TITLE_SIZE, fill: theme.text },
			...it.sub.map((s) => ({ s, size: SUB_SIZE, fill: theme.muted })),
		];
		const gap = 6;
		const heights = lines.map((l) => l.size * 1.15);
		const total = heights.reduce((a, b) => a + b, 0) + gap * (lines.length - 1);
		let y = top + (height - total) / 2;
		lines.forEach((l, i) => {
			text(l.s, cx, y + heights[i] / 2, {
				size: l.size,
				fill: l.fill,
				maxWidth,
				what: `${it.kind} ${it.id}`,
			});
			y += heights[i] + gap;
		});
		if (total > height - 8) warnings.push(`text too tall for ${it.kind} ${it.id}`);
	};

	for (const it of dia.items) {
		if (it.kind === "box") {
			const stroke = it.accent ? accent : theme.stroke;
			const fill = it.accent ? accentFill : theme.fill;
			const o = opts(it.id, { stroke, fill, fillStyle: "solid" });
			if (it.rounded) {
				const r = Math.min(16, it.h / 3, it.w / 3);
				const d =
					`M ${it.x + r} ${it.y} L ${it.x + it.w - r} ${it.y} Q ${it.x + it.w} ${it.y} ${it.x + it.w} ${it.y + r} ` +
					`L ${it.x + it.w} ${it.y + it.h - r} Q ${it.x + it.w} ${it.y + it.h} ${it.x + it.w - r} ${it.y + it.h} ` +
					`L ${it.x + r} ${it.y + it.h} Q ${it.x} ${it.y + it.h} ${it.x} ${it.y + it.h - r} ` +
					`L ${it.x} ${it.y + r} Q ${it.x} ${it.y} ${it.x + r} ${it.y} Z`;
				add(rc.path(d, o));
			} else {
				add(rc.rectangle(it.x, it.y, it.w, it.h, o));
			}
			labelLines(it, it.x + it.w / 2, it.y, it.h, it.w - 20);
		} else if (it.kind === "cylinder") {
			const stroke = it.accent ? accent : theme.stroke;
			const fill = it.accent ? accentFill : theme.fill;
			const o = opts(it.id, { stroke, fill, fillStyle: "solid" });
			const rx = it.w / 2;
			const ry = Math.min(16, it.h / 5);
			const top = it.y + ry;
			const bot = it.y + it.h - ry;
			const x2 = it.x + it.w;
			const body =
				`M ${it.x} ${top} L ${it.x} ${bot} A ${rx} ${ry} 0 0 0 ${x2} ${bot} ` +
				`L ${x2} ${top} A ${rx} ${ry} 0 0 0 ${it.x} ${top} Z`;
			add(rc.path(body, o));
			add(rc.ellipse(it.x + rx, top, it.w, ry * 2, opts(`${it.id}-lip`, { stroke })));
			// Text sits in the body, below the top lip.
			labelLines(it, it.x + rx, top + ry, bot - top - ry, it.w - 24);
		}
	}

	// Arrows and labels must not run through or over a shape.
	const solids = dia.items.filter((it) => it.kind === "box" || it.kind === "cylinder");
	const hitsRect = (x1, y1, x2, y2, r) => {
		const pad = 3;
		const L = r.x + pad, R = r.x + r.w - pad, T = r.y + pad, B = r.y + r.h - pad;
		let t0 = 0, t1 = 1;
		const dx = x2 - x1, dy = y2 - y1;
		for (const [pp, qq] of [[-dx, x1 - L], [dx, R - x1], [-dy, y1 - T], [dy, B - y1]]) {
			if (pp === 0) { if (qq < 0) return false; continue; }
			const t = qq / pp;
			if (pp < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
			else { if (t < t0) return false; if (t < t1) t1 = t; }
		}
		return t0 < t1;
	};
	const checkArrow = (ar, pts) => {
		for (let i = 0; i < pts.length - 1; i++)
			for (const r of solids)
				if (hitsRect(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, r))
					warnings.push(`arrow ${ar.id} runs through ${r.id}`);
	};
	const checkLabel = (ar, x, y, anchorAt) => {
		const w = ar.label.length * 8.6, h = 16;
		const x0 = anchorAt === "start" ? x : x - w / 2;
		for (const r of solids)
			if (x0 < r.x + r.w + 3 && x0 + w > r.x - 3 && y - h / 2 < r.y + r.h + 3 && y + h / 2 > r.y - 3)
				warnings.push(`label "${ar.label}" of ${ar.id} overlaps ${r.id}`);
	};

	// 3. Arrows.
	for (const ar of kinds("arrow")) {
		const a = byId.get(ar.from);
		const b = byId.get(ar.to);
		if (!a || !b) throw new Error(`arrow ${ar.id}: unknown shape`);
		const [fs, ts] = pickSides(a, b);
		const p = anchor(a, ar.fromSide ?? fs, ar.fromAt);
		const q = anchor(b, ar.toSide ?? ts, ar.toAt);
		const pts = dedupe(routeArrow(p, q, ar.elbow, ar.bendX, ar.bendY));
		checkArrow(ar, pts);
		const dash = ar.dashed ? { strokeLineDash: [9, 8] } : {};
		const stroke = ar.accent ? accent : theme.stroke;
		add(rc.linearPath(pts.map((pt) => [pt.x, pt.y]), opts(ar.id, { ...dash, stroke, roughness: 1.1 })));

		const head = (tip, from, tag) => {
			const ang = Math.atan2(tip.y - from.y, tip.x - from.x);
			const len = 13;
			const spread = (28 * Math.PI) / 180;
			for (const s of [-1, 1]) {
				const hx = tip.x - len * Math.cos(ang + s * spread);
				const hy = tip.y - len * Math.sin(ang + s * spread);
				add(rc.line(tip.x, tip.y, hx, hy, opts(`${ar.id}-${tag}${s}`, { stroke, roughness: 0.9 })));
			}
		};
		head(pts[pts.length - 1], pts[pts.length - 2], "end");
		if (ar.both) head(pts[0], pts[1], "start");

		if (ar.label) {
			// Put the label beside the longest segment.
			let best = 0;
			let bestLen = -1;
			for (let i = 0; i < pts.length - 1; i++) {
				const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
				if (len > bestLen) {
					bestLen = len;
					best = i;
				}
			}
			const s0 = pts[best];
			const s1 = pts[best + 1];
			const mx = (s0.x + s1.x) / 2;
			const my = (s0.y + s1.y) / 2;
			const horiz = Math.abs(s1.x - s0.x) >= Math.abs(s1.y - s0.y);
			const dx = ar.labelDx ?? 0;
			const dy = ar.labelDy ?? 0;
			if (horiz) checkLabel(ar, mx + dx, my - 14 + dy + 8, "middle");
			else checkLabel(ar, mx + 12 + dx, my + dy, "start");
			if (horiz) {
				text(ar.label, mx + dx, my - 14 + dy, { size: LABEL_SIZE, fill: theme.muted });
			} else {
				text(ar.label, mx + 12 + dx, my + dy, { size: LABEL_SIZE, fill: theme.muted, anchorAt: "start" });
			}
		}
	}

	// 4. Notes.
	for (const n of kinds("note")) {
		const lines = String(n.text).split("\n");
		lines.forEach((line, i) => {
			text(line, n.x, n.y + i * n.size * 1.3, {
				size: n.size,
				fill: n.muted ? theme.muted : theme.text,
				anchorAt: n.align,
			});
		});
	}

	// Anything drawn outside the canvas would be cropped in the PNG.
	const bb = svg.getBBox();
	if (bb.x < -1 || bb.y < -1 || bb.x + bb.width > dia.width + 1 || bb.y + bb.height > dia.height + 1) {
		warnings.push(
			`content leaves the canvas: x ${bb.x.toFixed(0)}..${(bb.x + bb.width).toFixed(0)}, ` +
				`y ${bb.y.toFixed(0)}..${(bb.y + bb.height).toFixed(0)} (canvas ${dia.width}x${dia.height})`,
		);
	}
	return warnings;
}
