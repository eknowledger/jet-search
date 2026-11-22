/**
 * What the user sees of a trace: the line in the status bar while it records (desktop; a phone has no
 * status bar), and the box in the support info that starts and stops it. Both are made when a trace
 * starts or the window opens, and go when it ends: a trace that is off has no element anywhere.
 */
import { Notice, Platform } from "obsidian";
import type JetSearchPlugin from "../main";
import { TRACE_MINUTES, trace } from "./trace";

/** How long is left, in the words a person says. */
export const leftText = (ms: number): string => {
	if (ms < 60_000) return "under a minute";
	return `${Math.ceil(ms / 60_000)} min`;
};

/** The notice when a trace starts. */
export const startedNotice = (minutes: number): string =>
	`Jet is recording a trace. It stops by itself in ${minutes} minutes. Open the support info to stop it or to copy the report.`;

/** The notice when it ends (not when Jet is turned off: nobody is there to read it). */
export const stoppedNotice = (events: number): string =>
	`Jet stopped recording. The trace is in the support info, with ${events} events.`;

/** The line in the status bar while a trace records: its time left, and a click opens the support info. */
export class TraceIndicator {
	private item: HTMLElement | null = null;
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(private readonly plugin: JetSearchPlugin) {}

	show(): void {
		if (Platform.isMobile || this.item) return;
		this.item = this.plugin.addStatusBarItem();
		this.item.addClass("jet-trace-status");
		this.item.setAttr("aria-label", "Jet is recording a trace. Click to open the support info.");
		this.item.addEventListener("click", () => this.plugin.supportInfo());
		this.draw();
		this.timer = setInterval(() => this.draw(), 15_000);
	}

	hide(): void {
		if (this.timer !== null) clearInterval(this.timer);
		this.timer = null;
		this.item?.remove();
		this.item = null;
	}

	private draw(): void {
		const end = trace.state().endsAt;
		this.item?.setText(`Jet trace ${leftText(end === null ? 0 : end - Date.now())}`);
	}
}

/** Say that a trace began or ended. */
export const tell = (): void => {
	const s = trace.state();
	if (s.recording) new Notice(startedNotice(s.minutes));
	else if (s.stopped !== "unload") new Notice(stoppedNotice(s.events));
};

/**
 * The trace's controls in the support info: the length, a button that starts or stops it, and two ticks.
 * `changed` is told when a tick changes what the report says.
 */
export class TraceBox {
	readonly el: HTMLElement;
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(
		parent: HTMLElement,
		private readonly plugin: JetSearchPlugin,
		private readonly timeline: { get: () => boolean; set: (on: boolean) => void },
	) {
		this.el = parent.createDiv({ cls: "jet-trace-box" });
		this.update();
	}

	/** Draw again from the trace's state (it started, ended, or a minute went by). */
	update(): void {
		const s = trace.state();
		const settings = this.plugin.data.settings;
		this.el.empty();
		const head = this.el.createDiv({ cls: "jet-trace-head" });
		const title = head.createSpan({ cls: "jet-trace-title" });
		if (s.recording) title.createSpan({ cls: "jet-trace-dot" });
		title.appendText(s.recording ? "Recording" : "Trace");
		this.el.createDiv({
			cls: "jet-trace-state",
			text: s.recording
				? `${leftText((s.endsAt ?? Date.now()) - Date.now())} left. ${s.events} events so far.`
				: s.startedAt === null
					? "Off. Records timings and events, never a word of a search or a note name."
					: `Stopped. ${s.events} events are in the report.`,
		});
		const row = this.el.createDiv({ cls: "jet-trace-row" });
		if (s.recording) {
			row.createEl("button", { text: "Stop" }).addEventListener("click", () => trace.stop("user"));
		} else {
			const sel = row.createEl("select", { cls: "dropdown", attr: { "aria-label": "How long to record" } });
			for (const m of TRACE_MINUTES) sel.createEl("option", { text: `${m} minutes`, attr: { value: String(m) } });
			sel.value = String(settings.traceMinutes);
			sel.addEventListener("change", () => {
				settings.traceMinutes = Number(sel.value);
				this.plugin.save();
			});
			row.createEl("button", { cls: "mod-cta", text: "Record" }).addEventListener("click", () =>
				trace.start(settings.traceMinutes),
			);
		}
		this.tick("Also record the next start", settings.traceNextStart, (on) => {
			settings.traceNextStart = on;
			this.plugin.save();
		});
		if (s.startedAt !== null)
			this.tick("Include the full timeline", this.timeline.get(), (on) => this.timeline.set(on));
		// A countdown moves: draw again each half minute while it runs and the window is on screen.
		if (this.timer !== null) clearInterval(this.timer);
		this.timer = s.recording
			? setInterval(() => (this.el.isConnected ? this.update() : this.stop()), 30_000)
			: null;
	}

	private tick(label: string, on: boolean, set: (on: boolean) => void): void {
		const row = this.el.createEl("label", { cls: "jet-support-tick" });
		const box = row.createEl("input", { attr: { type: "checkbox" } });
		box.checked = on;
		row.createSpan({ text: label });
		box.addEventListener("change", () => set(box.checked));
	}

	/** The window closed: no more redrawing. */
	stop(): void {
		if (this.timer !== null) clearInterval(this.timer);
		this.timer = null;
	}
}
