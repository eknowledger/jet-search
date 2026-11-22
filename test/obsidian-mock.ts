/**
 * A small stand-in for the `obsidian` module in unit tests. It records what the plugin
 * registers and counts every vault read, so tests can prove what happens at start.
 * Grow it only as far as a test needs.
 */

type Listener = (...args: unknown[]) => unknown;
export type EventRef = { off: () => void };

// Obsidian's DOM helpers, as the app adds them to every element.
type DomInfo = { cls?: string | string[]; text?: string; attr?: Record<string, string | number | boolean> };
const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
const make = function (this: HTMLElement, tag: string, o: DomInfo | string = {}): HTMLElement {
	const info = typeof o === "string" ? { cls: o } : o;
	const el = this.ownerDocument.createElement(tag);
	if (info.cls) el.className = Array.isArray(info.cls) ? info.cls.join(" ") : info.cls;
	if (info.text !== undefined) el.textContent = info.text;
	for (const [k, v] of Object.entries(info.attr ?? {})) el.setAttribute(k, String(v));
	this.appendChild(el);
	return el;
};
proto.createEl = make;
proto.createDiv = function (this: HTMLElement, o?: DomInfo | string) {
	return make.call(this, "div", o);
};
proto.createSpan = function (this: HTMLElement, o?: DomInfo | string) {
	return make.call(this, "span", o);
};
proto.empty = function (this: HTMLElement) {
	this.replaceChildren();
};
proto.setText = function (this: HTMLElement, t: string) {
	this.textContent = t;
};
proto.appendText = function (this: HTMLElement, t: string) {
	this.append(t);
};
proto.addClass = function (this: HTMLElement, ...c: string[]) {
	this.classList.add(...c);
};
proto.removeClass = function (this: HTMLElement, ...c: string[]) {
	this.classList.remove(...c);
};
proto.setAttr = function (this: HTMLElement, k: string, v: string | number | boolean) {
	this.setAttribute(k, String(v));
};
proto.toggleClass = function (this: HTMLElement, c: string, on: boolean) {
	this.classList.toggle(c, on);
};
proto.hasClass = function (this: HTMLElement, c: string) {
	return this.classList.contains(c);
};
Object.defineProperty(proto, "win", {
	get(this: HTMLElement) {
		return this.ownerDocument.defaultView;
	},
});
Object.defineProperty(proto, "doc", {
	get(this: HTMLElement) {
		return this.ownerDocument;
	},
});
proto.setCssProps = function (this: HTMLElement, props: Record<string, string>) {
	for (const [k, v] of Object.entries(props)) this.style.setProperty(k, v);
};
proto.setCssStyles = function (this: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
	Object.assign(this.style, styles);
};

// Obsidian's global createEl: an element not yet attached.
(globalThis as unknown as Record<string, unknown>).createEl = (tag: string, o: DomInfo | string = {}): HTMLElement => {
	const holder = document.createElement("div");
	const el = make.call(holder, tag, o);
	el.remove();
	return el;
};

(globalThis as unknown as Record<string, unknown>).createSpan = (o: DomInfo | string = {}): HTMLElement =>
	(globalThis as unknown as { createEl: (t: string, o: DomInfo | string) => HTMLElement }).createEl("span", o);

(globalThis as unknown as Record<string, unknown>).createDiv = (o: DomInfo | string = {}): HTMLElement =>
	(globalThis as unknown as { createEl: (t: string, o: DomInfo | string) => HTMLElement }).createEl("div", o);

export const setIcon = (el: HTMLElement, icon: string): void => {
	el.setAttribute("data-icon", icon);
};

export const debounce = <A extends unknown[]>(fn: (...a: A) => void) => {
	const d = (...a: A) => fn(...a);
	d.cancel = () => d;
	// Calls at once, so nothing is ever waiting to run.
	d.run = () => undefined;
	return d;
};

export type Modifier = "Mod" | "Ctrl" | "Meta" | "Shift" | "Alt";

/** Obsidian's key scope: handlers in registration order; one returning false stops the key. */
export class Scope {
	keys: Array<{ modifiers: Modifier[]; key: string | null; func: (e: KeyboardEvent) => unknown }> = [];

	register(modifiers: Modifier[], key: string | null, func: (e: KeyboardEvent) => unknown): unknown {
		const h = { modifiers, key, func };
		this.keys.push(h);
		return h;
	}

	unregister(h: unknown): void {
		this.keys = this.keys.filter((k) => k !== h);
	}

	/** Test helper: press a key with modifiers. */
	press(key: string, modifiers: Modifier[] = [], target?: unknown): boolean {
		const want = [...modifiers].sort().join(",");
		for (const k of this.keys)
			if (k.key === key && [...k.modifiers].sort().join(",") === want)
				if (k.func({ key, isComposing: false, target } as unknown as KeyboardEvent) === false) return true;
		return false;
	}
}

export const Platform = { isMacOS: true, isMobile: false, isDesktop: true, isDesktopApp: true };

export const MarkdownRenderer = {
	render: (_app: unknown, markdown: string, el: HTMLElement): Promise<void> => {
		el.createEl("p", { text: markdown });
		return Promise.resolve();
	},
};

export class Modal {
	readonly modalEl = document.createElement("div");
	readonly titleEl = document.createElement("div");
	readonly contentEl = document.createElement("div");
	readonly scope = new Scope();
	isOpen = false;

	constructor(readonly app: App) {
		this.titleEl.className = "modal-title";
		this.modalEl.append(this.titleEl, this.contentEl);
		this.scope.register([], "Escape", () => {
			this.close();
			return false;
		});
	}

	open(): void {
		this.isOpen = true;
		document.body.appendChild(this.modalEl);
		this.onOpen();
	}

	close(): void {
		if (!this.isOpen) return;
		this.isOpen = false;
		this.modalEl.remove();
		this.onClose();
	}

	onOpen(): void {}

	onClose(): void {}
}

/** Counts calls to every vault method that reads a file or lists files. */
/** A settings sub-page (Obsidian 1.13): the page draws itself into containerEl. */
export abstract class SettingPage {
	readonly rootEl = document.createElement("div");
	readonly titlebarEl = document.createElement("div");
	readonly containerEl = document.createElement("div");
	title = "";
	abstract display(): void;
	hide(): void {}
}

export const moment = Object.assign(() => ({}), { locale: () => "en" });

/** Obsidian's fuzzy picker: `choose(text)` picks the item whose text includes it (tests). */
export class FuzzySuggestModal<T> extends Modal {
	placeholder = "";
	setPlaceholder(p: string): void {
		this.placeholder = p;
	}
	getItems(): T[] {
		return [];
	}
	getItemText(_item: T): string {
		return "";
	}
	onChooseItem(_item: T): void {}
	choose(text: string): void {
		const item = this.getItems().find((x) => this.getItemText(x).includes(text));
		if (item !== undefined) this.onChooseItem(item);
	}
}

export class Vault {
	readonly calls: string[] = [];
	private listeners = new Map<string, Set<Listener>>();

	getName(): string {
		return "test vault";
	}

	getMarkdownFiles(): TFile[] {
		this.calls.push("getMarkdownFiles");
		return [...this.files.values()];
	}

	getFiles(): TFile[] {
		this.calls.push("getFiles");
		return [...this.files.values()];
	}

	readonly files = new Map<string, TFile>();
	readonly folders = new Set<string>();

	getFileByPath(path: string): TFile | null {
		return this.files.get(path) ?? null;
	}

	getFolderByPath(path: string): { path: string } | null {
		return this.folders.has(path) ? { path } : null;
	}

	async create(path: string, _data: string): Promise<TFile> {
		const f = new TFile(path);
		this.files.set(path, f);
		return f;
	}

	async read(_file: TFile): Promise<string> {
		this.calls.push("read");
		return "";
	}

	async cachedRead(_file: TFile): Promise<string> {
		this.calls.push("cachedRead");
		return "";
	}

	on(name: string, callback: Listener): EventRef {
		const set = this.listeners.get(name) ?? new Set<Listener>();
		set.add(callback);
		this.listeners.set(name, set);
		return { off: () => set.delete(callback) };
	}

	listenerCount(): number {
		let n = 0;
		for (const set of this.listeners.values()) n += set.size;
		return n;
	}
}

export class Workspace {
	readonly layoutReadyCallbacks: (() => void)[] = [];
	lastOpen: string[] = [];
	readonly opened: Array<{ path: string; how: unknown }> = [];
	readonly triggered: string[] = [];

	trigger(name: string): void {
		this.triggered.push(name);
	}

	getLastOpenFiles(): string[] {
		return this.lastOpen;
	}

	getActiveViewOfType(_t: unknown): null {
		return null;
	}

	getActiveFile(): TFile | null {
		return null;
	}

	getLeaf(how?: unknown): { openFile: (f: TFile) => Promise<void> } {
		return { openFile: (f: TFile) => (this.opened.push({ path: f.path, how }), Promise.resolve()) };
	}

	onLayoutReady(callback: () => void): void {
		this.layoutReadyCallbacks.push(callback);
	}

	on(_name: string, _callback: Listener): EventRef {
		return { off: () => {} };
	}
}

export class MetadataCache {
	readonly caches = new Map<string, Record<string, unknown>>();
	resolvedLinks: Record<string, Record<string, number>> = {};

	getFileCache(f: TFile): Record<string, unknown> | null {
		return this.caches.get(f.path) ?? null;
	}

	getFirstLinkpathDest(link: string, _from: string): TFile | null {
		const target = Object.keys(this.resolvedLinks)
			.concat(...Object.values(this.resolvedLinks).map((t) => Object.keys(t)))
			.find((p) => p.endsWith(`${link}.md`));
		return target ? new TFile(target) : null;
	}
}

export const getAllTags = (cache: { tags?: Array<{ tag: string }>; frontmatter?: { tags?: string[] } }): string[] => [
	...(cache.frontmatter?.tags ?? []).map((t) => `#${t}`),
	...(cache.tags ?? []).map((t) => t.tag),
];

export const parseFrontMatterAliases = (fm: { aliases?: string[] } | null | undefined): string[] | null =>
	fm?.aliases ?? null;

export class MarkdownView {}

export const normalizePath = (p: string): string => p.replace(/\/+/g, "/").replace(/^\/|\/$/g, "");

export class App {
	readonly vault = new Vault();
	readonly workspace = new Workspace();
	readonly metadataCache = new MetadataCache();
	/** Frontmatter written with processFrontMatter, by path. */
	readonly frontmatter = new Map<string, Record<string, unknown>>();
	readonly fileManager = {
		getNewFileParent: (_from: string) => ({ path: "Inbox" }),
		processFrontMatter: async (f: TFile, fn: (fm: Record<string, unknown>) => void): Promise<void> => {
			const fm = this.frontmatter.get(f.path) ?? {};
			fn(fm);
			this.frontmatter.set(f.path, fm);
		},
		generateMarkdownLink: (f: TFile) => `[[${f.basename}]]`,
	};
}

export type PluginManifest = { id: string; name: string; version: string; dir?: string };

export type Command = { id: string; name: string; callback?: () => unknown };

export class Component {
	private cleanups: (() => void)[] = [];

	load(): void {}

	register(cb: () => void): void {
		this.cleanups.push(cb);
	}

	registerEvent(ref: EventRef): void {
		this.cleanups.push(() => ref.off());
	}

	registerDomEvent(el: EventTarget, type: string, callback: EventListener): void {
		el.addEventListener(type, callback);
		this.cleanups.push(() => el.removeEventListener(type, callback));
	}

	registerInterval(id: number): number {
		this.cleanups.push(() => window.clearInterval(id));
		return id;
	}

	/** Runs every registered cleanup, as Obsidian does when a plugin unloads. */
	unload(): void {
		for (const cb of this.cleanups.splice(0).reverse()) cb();
		this.onunload();
	}

	onunload(): void {}

	/** How many cleanups are waiting (registrations not yet undone). */
	pendingCleanups(): number {
		return this.cleanups.length;
	}
}

export class Plugin extends Component {
	readonly commands: Command[] = [];
	readonly settingTabs: PluginSettingTab[] = [];
	private data: unknown = null;

	constructor(
		readonly app: App,
		readonly manifest: PluginManifest,
	) {
		super();
	}

	addCommand(command: Command): Command {
		this.commands.push(command);
		return command;
	}

	addSettingTab(tab: PluginSettingTab): void {
		this.settingTabs.push(tab);
	}

	async loadData(): Promise<unknown> {
		return this.data;
	}

	async saveData(data: unknown): Promise<void> {
		this.data = data;
	}
}

/** The app version the mock reports to `requireApiVersion` (tests may lower it). */
export const mockApi = { version: "1.14.4" };

const versionAtLeast = (have: string, want: string): boolean => {
	const h = have.split(".").map(Number);
	const w = want.split(".").map(Number);
	for (let i = 0; i < 3; i++) if ((h[i] ?? 0) !== (w[i] ?? 0)) return (h[i] ?? 0) > (w[i] ?? 0);
	return true;
};

/** Obsidian's `apiVersion`: the app's version (follows `mockApi`). */
export const apiVersion = mockApi.version;

export const requireApiVersion = (version: string): boolean => versionAtLeast(mockApi.version, version);

export class PluginSettingTab {
	readonly containerEl = document.createElement("div");
	/** How many times `update()` was called (1.13+: Obsidian redraws the tab from its definitions). */
	updates = 0;

	constructor(
		readonly app: App,
		readonly plugin: Plugin,
	) {}

	getSettingDefinitions(): unknown[] {
		return [];
	}

	update(): void {
		this.updates++;
	}

	display(): void {}

	hide(): void {}
}

export class Setting {
	readonly settingEl = document.createElement("div");
	readonly nameEl = document.createElement("div");
	readonly descEl = document.createElement("div");
	readonly controlEl = document.createElement("div");

	constructor(containerEl: HTMLElement) {
		this.settingEl.className = "setting-item";
		this.nameEl.className = "setting-item-name";
		this.descEl.className = "setting-item-description";
		this.controlEl.className = "setting-item-control";
		this.settingEl.append(this.nameEl, this.descEl, this.controlEl);
		containerEl.appendChild(this.settingEl);
	}

	setName(name: string): this {
		this.nameEl.textContent = name;
		return this;
	}

	setDesc(description: string): this {
		this.descEl.textContent = description;
		return this;
	}

	setHeading(): this {
		this.settingEl.classList.add("setting-item-heading");
		return this;
	}

	addToggle(f: (c: Control) => unknown): this {
		f(new Control(this.controlEl));
		return this;
	}

	addDropdown(f: (c: Control) => unknown): this {
		f(new Control(this.controlEl));
		return this;
	}

	addTextArea(f: (c: Control) => unknown): this {
		f(new Control(this.controlEl));
		return this;
	}

	addButton(f: (c: Control) => unknown): this {
		f(new Control(this.controlEl));
		return this;
	}
}

/** Any setting control: every setter chains, onChange/onClick keep the handler. */
export class Control {
	readonly buttonEl = document.createElement("button");
	handler: ((v: unknown) => unknown) | null = null;
	constructor(readonly el: HTMLElement) {
		el.appendChild(this.buttonEl);
	}
	setValue(): this {
		return this;
	}
	addOptions(): this {
		return this;
	}
	setDisabled(on: boolean): this {
		this.buttonEl.toggleAttribute("disabled", on);
		return this;
	}
	setCta(): this {
		this.buttonEl.classList.add("mod-cta");
		return this;
	}
	setWarning(): this {
		this.buttonEl.classList.add("mod-warning");
		return this;
	}
	setButtonText(t: string): this {
		this.buttonEl.textContent = t;
		return this;
	}
	onChange(h: (v: unknown) => unknown): this {
		this.handler = h;
		return this;
	}
	onClick(h: () => unknown): this {
		this.handler = h;
		this.buttonEl.addEventListener("click", () => void h());
		return this;
	}
}

export class Notice {
	static readonly shown: string[] = [];

	constructor(readonly message: string) {
		Notice.shown.push(message);
	}
}

export class TAbstractFile {
	constructor(readonly path: string) {}
}

export class TFolder extends TAbstractFile {
	isRoot(): boolean {
		return this.path === "/" || this.path === "";
	}
}

/** Obsidian's menu: items chain setTitle / setIcon / onClick; the test reads `items`. */
export class Menu {
	/** The last menu made (tests click its items). */
	static last: Menu | null = null;
	readonly items: Array<{ title: string; click: (() => void) | null }> = [];
	constructor() {
		Menu.last = this;
	}
	addSeparator(): this {
		return this;
	}
	showAtMouseEvent(): void {}
	addItem(
		f: (i: {
			setTitle(t: string): unknown;
			setIcon(i: string): unknown;
			onClick(c: () => void): unknown;
		}) => unknown,
	): this {
		const it = { title: "", click: null as (() => void) | null };
		const api = {
			setTitle: (t: string) => ((it.title = t), api),
			setIcon: () => api,
			setChecked: () => api,
			onClick: (c: () => void) => ((it.click = c), api),
		};
		f(api);
		this.items.push(it);
		return this;
	}
	showAtPosition(): void {}
}

export class TFile extends TAbstractFile {
	stat = { mtime: 0, ctime: 0, size: 0 };

	get basename(): string {
		const name = this.path.split("/").pop() ?? this.path;
		return name.replace(/\.md$/, "");
	}

	get extension(): string {
		return this.path.split(".").pop() ?? "";
	}
}
