/**
 * A small stand-in for the `obsidian` module in unit tests. It records what the plugin
 * registers and counts every vault read, so tests can prove what happens at start.
 * Grow it only as far as a test needs.
 */

type Listener = (...args: unknown[]) => unknown;
export type EventRef = { off: () => void };

/** Counts calls to every vault method that reads a file or lists files. */
export class Vault {
	readonly calls: string[] = [];
	private listeners = new Map<string, Set<Listener>>();

	getName(): string {
		return "test vault";
	}

	getMarkdownFiles(): TFile[] {
		this.calls.push("getMarkdownFiles");
		return [];
	}

	getFiles(): TFile[] {
		this.calls.push("getFiles");
		return [];
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

	onLayoutReady(callback: () => void): void {
		this.layoutReadyCallbacks.push(callback);
	}

	on(_name: string, _callback: Listener): EventRef {
		return { off: () => {} };
	}
}

export class App {
	readonly vault = new Vault();
	readonly workspace = new Workspace();
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
	get basename(): string {
		const name = this.path.split("/").pop() ?? this.path;
		return name.replace(/\.md$/, "");
	}

	get extension(): string {
		return this.path.split(".").pop() ?? "";
	}
}
