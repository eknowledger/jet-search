import { type App, Component, MarkdownRenderer, setIcon, type TFile } from "obsidian";
import { answerSpans } from "../answers/answers";
import { findHits } from "../excerpt/excerpt";
import { crumb, titleOf } from "../modal/format";
import { sectionAround } from "./section";

export type PreviewAction = "link" | "split" | "open";

/** Properties shown under the title, in this order when present. */
const PROPS = ["type", "status", "project", "area", "created", "date", "tags"];

/**
 * The preview pane: the selected note's breadcrumb, title and
 * properties pinned, and the section around the hit rendered by Obsidian, every hit marked and ticked
 * on a rail; ⌘G / ⇧⌘G walk them. Each render has its own child Component, unloaded when the selection
 * changes. If rendering fails the pane shows the plain text instead.
 */
export class Preview {
	readonly el: HTMLElement;
	private readonly headEl: HTMLElement;
	private readonly bodyEl: HTMLElement;
	private readonly ticksEl: HTMLElement;
	private readonly countEl: HTMLElement;
	private comp: Component | null = null;
	private marks: HTMLElement[] = [];
	private cur = 0;
	private token = 0;
	path: string | null = null;

	constructor(
		private readonly app: App,
		parent: HTMLElement,
		private readonly act: (action: PreviewAction, path: string) => void,
		/** Your keys for its buttons, shown in their tooltips. */
		keys: { prev: string; next: string; link: string; split: string; open: string } = {
			prev: "⌘⇧G",
			next: "⌘G",
			link: "⌘C",
			split: "⌘⌥↵",
			open: "↵",
		},
	) {
		this.el = parent.createDiv({ cls: "jet-pv" });
		const card = this.el.createDiv({ cls: "jet-pc" });
		this.headEl = card.createDiv({ cls: "jet-phd" });
		const pa = this.headEl.createDiv({ cls: "jet-pa" });
		const nav = pa.createDiv({ cls: "jet-hitnav" });
		const hb = nav.createDiv({ cls: "jet-hb" });
		const up = hb.createSpan({ attr: { "aria-label": `Previous hit (${keys.prev})` } });
		setIcon(up, "chevron-up");
		const down = hb.createSpan({ attr: { "aria-label": `Next hit (${keys.next})` } });
		setIcon(down, "chevron-down");
		// A click keeps the focus in the search box.
		for (const b of [up, down]) b.addEventListener("mousedown", (e) => e.preventDefault());
		up.addEventListener("click", () => this.step(-1));
		down.addEventListener("click", () => this.step(1));
		this.countEl = nav.createSpan({ cls: "jet-hc" });
		pa.createDiv({ cls: "jet-sp" });
		const acts = pa.createDiv({ cls: "jet-pacts" });
		for (const [a, icon, label] of [
			["link", "link", `Copy link (${keys.link})`],
			["split", "columns-2", `Open to the side (${keys.split})`],
			["open", "arrow-up-right", `Open (${keys.open})`],
		] as const) {
			const b = acts.createSpan({ cls: "jet-pb", attr: { "aria-label": label } });
			setIcon(b, icon);
			b.addEventListener("mousedown", (e) => e.preventDefault());
			b.addEventListener("click", () => this.path && this.act(a, this.path));
		}
		this.headEl.createDiv({ cls: "jet-pcr" });
		this.headEl.createDiv({ cls: "jet-pti" });
		this.headEl.createDiv({ cls: "jet-ppr" });
		const wrap = card.createDiv({ cls: "jet-pbody" });
		this.bodyEl = wrap.createDiv({ cls: "jet-pin markdown-rendered" });
		this.ticksEl = wrap.createDiv({ cls: "jet-ticks" });
	}

	/**
	 * Show a note: around `offset` (the excerpt's hit), with `terms` marked. `answer` (experiment):
	 * the line that answers the question, outlined and labelled, and the preview at it.
	 */
	async show(
		file: TFile,
		terms: readonly string[],
		offset?: number,
		answer?: { line: string; question: string },
	): Promise<void> {
		const token = ++this.token;
		this.path = file.path;
		this.unload();
		const head = this.headEl;
		(head.querySelector(".jet-pcr") as HTMLElement).setText(crumb(file.path, 4) || "/");
		(head.querySelector(".jet-pti") as HTMLElement).setText(titleOf(file.path));
		this.props(file);
		const text = await this.app.vault.cachedRead(file);
		if (token !== this.token) return;
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatterPosition;
		const bodyStart = fm ? Math.min(text.length, fm.end.offset) : 0;
		const { from, to } = sectionAround(text, bodyStart, offset);
		this.bodyEl.empty();
		this.comp = new Component();
		this.comp.load();
		try {
			await MarkdownRenderer.render(this.app, text.slice(from, to), this.bodyEl, file.path, this.comp);
		} catch (e) {
			console.warn("Jet Search: preview could not render; showing the text", e);
			this.bodyEl.empty();
			this.bodyEl.createEl("pre", { cls: "jet-plain", text: text.slice(from, to) });
		}
		if (token !== this.token) return;
		this.mark(terms);
		if (answer) this.outline(answer.line, answer.question);
	}

	/**
	 * Answers (experiment): the rendered block that holds the answer line (its list item, table row or
	 * paragraph) outlined, labelled "Closest to your question", and scrolled to; the hit walk starts
	 * at its first mark.
	 */
	private outline(line: string, question: string): void {
		const words = (s: string): string =>
			s
				.replace(/!?\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
				.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
				// Letters, digits and % only: a table row's cells run together as rendered.
				.replace(/[^\p{L}\p{N}%]+/gu, "")
				.toLowerCase();
		const want = words(line).slice(0, 60);
		if (want.length < 6) return;
		let best: HTMLElement | null = null;
		for (const el of Array.from(
			this.bodyEl.querySelectorAll<HTMLElement>("li, tr, p, blockquote, td, h1, h2, h3, h4, h5, h6"),
		)) {
			if (!words(el.textContent ?? "").includes(want)) continue;
			// The smallest block holding it: a list item, not the list around it.
			if (!best || best.contains(el)) best = el;
		}
		if (!best) return;
		best.addClass("jet-answer");
		// The answer's figures coloured, as in the row.
		const doc = best.ownerDocument;
		const walker = doc.createTreeWalker(best, NodeFilter.SHOW_TEXT);
		const nodes: Text[] = [];
		for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
		for (const node of nodes) {
			let rest: Text = node;
			let done = 0;
			for (const [a, b] of answerSpans(question, node.data)) {
				const mid = rest.splitText(a - done);
				rest = mid.splitText(b - a);
				const span = createSpan({ cls: "jet-num" });
				mid.replaceWith(span);
				span.append(mid);
				done = b;
			}
		}
		const label = createSpan({ cls: "jet-alabel", text: "Closest to your question" });
		// In a table, the label goes in the row's first cell (a row holds cells only).
		const at = best.tagName === "TR" ? ((best.firstElementChild as HTMLElement | null) ?? best) : best;
		at.prepend(label);
		const first = this.marks.findIndex((m) => best?.contains(m));
		if (first >= 0) {
			this.marks[this.cur]?.removeClass("is-current");
			this.cur = first - 1;
			this.step(1);
		} else best.scrollIntoView({ block: "center" });
	}

	clear(): void {
		this.token++;
		this.path = null;
		this.unload();
		this.bodyEl.empty();
		this.ticksEl.empty();
		this.countEl.setText("");
		// The title, path and properties go too: nothing of the last note is left to act on.
		for (const c of [".jet-pcr", ".jet-pti", ".jet-ppr"]) this.headEl.querySelector<HTMLElement>(c)?.empty();
	}

	/** ⌘G / ⇧⌘G: the next or previous hit. */
	step(d: number): void {
		if (!this.marks.length) return;
		this.marks[this.cur]?.removeClass("is-current");
		this.cur = (this.cur + d + this.marks.length) % this.marks.length;
		const m = this.marks[this.cur];
		m?.addClass("is-current");
		m?.scrollIntoView({ block: "center" });
		this.countEl.setText(`${this.cur + 1} of ${this.marks.length}`);
	}

	/** ⌥↑ / ⌥↓: scroll the preview. */
	scroll(d: number): void {
		this.bodyEl.parentElement?.scrollBy({ top: d * 120 });
	}

	destroy(): void {
		this.clear();
		this.el.remove();
	}

	private unload(): void {
		this.comp?.unload();
		this.comp = null;
		this.marks = [];
		this.cur = 0;
	}

	private props(file: TFile): void {
		const el = this.headEl.querySelector(".jet-ppr") as HTMLElement;
		el.empty();
		const fm = (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
		const shown = PROPS.filter((k) => fm[k] !== undefined && fm[k] !== null && fm[k] !== "");
		for (const k of shown.slice(0, 6)) {
			const row = el.createDiv({ cls: k === "tags" ? "jet-pp is-wide" : "jet-pp" });
			row.createSpan({ cls: "jet-k", text: k });
			const v = fm[k];
			const s = Array.isArray(v)
				? v.map((x) => (k === "tags" ? `#${String(x)}` : String(x))).join(k === "tags" ? " " : ", ")
				: String(v);
			row.createSpan({ cls: "jet-v", text: s.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2") });
		}
		const edited = el.createDiv({ cls: "jet-pp" });
		edited.createSpan({ cls: "jet-k", text: "edited" });
		edited.createSpan({ cls: "jet-v", text: new Date(file.stat.mtime).toLocaleDateString() });
	}

	/** Wrap every hit of the terms in the rendered text, tick them on the rail, go to the first. */
	private mark(terms: readonly string[]): void {
		this.ticksEl.empty();
		this.countEl.setText("");
		if (!terms.length) return;
		const doc = this.bodyEl.ownerDocument;
		const walker = doc.createTreeWalker(this.bodyEl, NodeFilter.SHOW_TEXT);
		const nodes: Text[] = [];
		for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
		for (const node of nodes) {
			const t = node.data;
			const hits = findHits(t, terms, { limit: 50 });
			if (!hits.length) continue;
			let rest: Text = node;
			let done = 0;
			for (const [a, b] of hits) {
				const mid = rest.splitText(a - done);
				rest = mid.splitText(b - a);
				const m = createEl("mark", { cls: "jet-pmark" });
				mid.replaceWith(m);
				m.append(mid);
				this.marks.push(m);
				done = b;
			}
			if (this.marks.length > 300) break;
		}
		if (!this.marks.length) return;
		const total = this.bodyEl.scrollHeight || 1;
		for (const m of this.marks) {
			const tick = this.ticksEl.createDiv({ cls: "jet-tick" });
			tick.style.top = `${(100 * m.offsetTop) / total}%`;
		}
		this.cur = -1;
		this.step(1);
	}
}
