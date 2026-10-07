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

export const setIcon = (el: HTMLElement, icon: string): void => {
	el.setAttribute("data-icon", icon);
};

export const debounce = <A extends unknown[]>(fn: (...a: A) => void) => {
	const d = (...a: A) => fn(...a);
	d.cancel = () => d;
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
	press(key: string, modifiers: Modifier[] = []): boolean {
		const want = [...modifiers].sort().join(",");
		for (const k of this.keys)
			if (k.key === key && [...k.modifiers].sort().join(",") === want)
				if (k.func({ key, isComposing: false } as KeyboardEvent) === false) return true;
		return false;
	}
}

export class Modal {
	readonly modalEl = document.createElement("div");
	readonly contentEl = document.createElement("div");
	readonly scope = new Scope();
	isOpen = false;

	constructor(readonly app: App) {
		this.modalEl.appendChild(this.contentEl);
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
		return [];
	}

	readonly files = new Map<string, TFile>();

	getFileByPath(path: string): TFile | null {
		return this.files.get(path) ?? null;
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

	getLastOpenFiles(): string[] {
		return this.lastOpen;
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
	getFileCache(_f: TFile): { frontmatter?: Record<string, unknown> } | null {
		return null;
	}
}

export class App {
	readonly vault = new Vault();
	readonly workspace = new Workspace();
	readonly metadataCache = new MetadataCache();
}

export type PluginManifest = { id: string; name: string; version: string; dir?: string };

export type Command = { id: string; name: string; callback?: () => unknown };

export class Component {
	private cleanups: (() => void)[] = [];

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

export class PluginSettingTab {
	readonly containerEl = document.createElement("div");

	constructor(
		readonly app: App,
		readonly plugin: Plugin,
	) {}

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
