/**
 * What a trace says in the support info: a summary (counts, times, the slowest searches) and, when the
 * user asks, the timeline. Made when a report is asked for, never while the trace records. Every number
 * and word here comes from the events, which hold codes and numbers only.
 */
import type { Line } from "./report";
import { FLAG, SEARCH_CHARS } from "./recorder";
import { KIND, OPENED, type Event, type Stopped, type TraceState } from "./trace";
import { msText, num, plural } from "./format";

const HOW = Object.fromEntries(Object.entries(OPENED).map(([k, v]) => [v, k])) as Record<number, string>;

/** One search of the trace, as the slowest list shows it. */
export type SlowSearch = { total: number; ready: number; worker: number; hits: number; flags: number; at: number };

export type TraceSummary = {
	recording: boolean;
	/** The minutes it was asked to run. */
	minutes: number;
	/** How long it ran (ms). */
	ranMs: number;
	/** Recording: ms until it stops by itself. */
	leftMs: number | null;
	stopped: Stopped | null;
	/** Events made, and the ones still held (the newest). */
	events: number;
	kept: number;
	searches: { n: number; median: number; p95: number; slowest: SlowSearch[] };
	worker: { starts: number; stops: number; sleeps: number; crashes: number };
	opens: Array<{ how: string; ms: number }>;
	builds: Array<{ notes: number; ms: number }>;
	/** A build that began and had not ended when the trace did (its notes). */
	building: number | null;
	catchUp: { notes: number; removed: number; ms: number } | null;
	changes: { times: number; notes: number; removed: number; slowest: number };
	problems: Array<{ code: string; warn: boolean; at: number }>;
};

const MAX_SLOW = 3;
const MAX_PROBLEMS = 10;
export const MAX_TIMELINE = 300;

export const summarize = (events: Event[], state: TraceState, now: number): TraceSummary => {
	const totals: number[] = [];
	const slow: SlowSearch[] = [];
	const worker = { starts: 0, stops: 0, sleeps: 0, crashes: 0 };
	const opens: TraceSummary["opens"] = [];
	const builds: TraceSummary["builds"] = [];
	let building: number | null = null;
	let catchUp: TraceSummary["catchUp"] = null;
	const changes = { times: 0, notes: 0, removed: 0, slowest: 0 };
	const problems: TraceSummary["problems"] = [];
	let ended: number | null = null;
	for (const e of events) {
		switch (e.kind) {
			case KIND.workerStart:
				worker.starts++;
				break;
			case KIND.workerStop:
				worker.stops++;
				break;
			case KIND.workerSleep:
				worker.sleeps++;
				break;
			case KIND.workerCrash:
				worker.crashes++;
				break;
			case KIND.indexOpen:
				opens.push({ how: HOW[e.flags] ?? "unknown", ms: e.a });
				break;
			case KIND.buildStart:
				building = e.a;
				break;
			case KIND.buildEnd:
				building = null;
				builds.push({ notes: e.b, ms: e.a });
				break;
			case KIND.changes:
				if (e.flags & 1) catchUp = { notes: e.b, removed: e.c, ms: e.a };
				else {
					changes.times++;
					changes.notes += e.b;
					changes.removed += e.c;
					changes.slowest = Math.max(changes.slowest, e.a);
				}
				break;
			case KIND.search:
				totals.push(e.a);
				slow.push({ total: e.a, ready: e.b, worker: e.c, hits: e.d, flags: e.flags, at: e.t });
				break;
			case KIND.problem:
				problems.push({ code: e.label ?? "unknown", warn: e.flags === 1, at: e.t });
				break;
			case KIND.stop:
				ended = e.t;
				break;
			default:
		}
	}
	const sorted = [...totals].sort((a, b) => a - b);
	const median = sorted.length
		? sorted.length % 2
			? (sorted[sorted.length >> 1] ?? 0)
			: ((sorted[sorted.length / 2 - 1] ?? 0) + (sorted[sorted.length / 2] ?? 0)) / 2
		: 0;
	const p95 = sorted.length ? (sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))] ?? 0) : 0;
	return {
		recording: state.recording,
		minutes: state.minutes,
		ranMs: ended ?? (state.startedAt === null ? 0 : Math.max(0, now - state.startedAt)),
		leftMs: state.endsAt === null ? null : Math.max(0, state.endsAt - now),
		stopped: state.stopped,
		events: state.events,
		kept: state.kept,
		searches: { n: totals.length, median, p95, slowest: slow.sort((a, b) => b.total - a.total).slice(0, MAX_SLOW) },
		worker,
		opens,
		builds,
		building,
		catchUp,
		changes,
		problems: problems.slice(-MAX_PROBLEMS),
	};
};

/** Time into the trace as `m:ss.mmm` (`h:mm:ss.mmm` past an hour), so two events a hair apart can be told apart. */
const at = (ms: number): string => {
	const whole = Math.max(0, Math.round(ms));
	const milli = String(whole % 1000).padStart(3, "0");
	const s = Math.floor(whole / 1000);
	const sec = String(s % 60).padStart(2, "0");
	return s >= 3600
		? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${sec}.${milli}`
		: `${Math.floor(s / 60)}:${sec}.${milli}`;
};

const mins = (ms: number): string => {
	const m = Math.round(ms / 60_000);
	return m < 1 ? "under a minute" : `${m} min`;
};

const BY: Record<Stopped, string> = { user: "by you", time: "by itself", unload: "when Jet was turned off" };

const seconds = (ms: number): string => (ms < 1000 ? `${Math.round(ms)} ms` : `${Math.round(ms / 1000)} s`);

const flagsText = (flags: number): string =>
	[
		flags & FLAG.meaning ? "by meaning" : null,
		flags & FLAG.cold ? "worker had to start" : null,
		flags & FLAG.building ? "index was being built" : null,
		flags & FLAG.broken ? "saved index was damaged" : null,
	]
		.filter((x): x is string => x !== null)
		.join(", ");

const slowText = (s: SlowSearch): string =>
	[
		`${msText(s.total)} ms at ${at(s.at)} (index wait ${msText(s.ready)}, worker ${msText(s.worker)}, other ${msText(Math.max(0, s.total - s.ready - s.worker))})`,
		plural(s.hits, "hit"),
		flagsText(s.flags),
	]
		.filter(Boolean)
		.join(", ");

/** The summary as report lines. */
export const traceLines = (t: TraceSummary): Line[] => {
	const dropped = t.events > t.kept ? `, the last ${num(t.kept)} kept` : "";
	const head = t.recording
		? `recording, ${t.leftMs !== null && t.leftMs < 60_000 ? "under a minute" : mins(t.leftMs ?? 0)} left, ${plural(t.events, "event")} so far${dropped}`
		: `recorded ${mins(t.stopped === "user" ? t.ranMs : t.minutes * 60_000)}, stopped ${BY[t.stopped ?? "time"]}, ${plural(t.events, "event")}${dropped}`;
	const s = t.searches;
	const lines: Line[] = [
		{ text: head },
		{
			text: s.n
				? `searches ${num(s.n)}, median ${msText(s.median)} ms, 95% under ${msText(s.p95)} ms`
				: "no searches",
		},
		...s.slowest.map((x, i) => ({ text: `${i === 0 ? "slowest" : "next"}: ${slowText(x)}` })),
		{
			text: `worker started ${t.worker.starts}x, slept ${t.worker.sleeps}x, crashed ${t.worker.crashes}x`,
			...(t.worker.crashes ? { warn: true } : {}),
		},
	];
	for (const o of t.opens)
		lines.push({
			text: `index opened: ${o.how.replace("-", " ")}, ${msText(o.ms)} ms`,
			...(o.how === "error" ? { warn: true } : {}),
		});
	for (const b of t.builds) lines.push({ text: `index built: ${plural(b.notes, "note")} in ${seconds(b.ms)}` });
	if (t.building !== null) lines.push({ text: `index build of ${plural(t.building, "note")} had not finished` });
	if (t.catchUp)
		lines.push({
			text: `catch-up after the start: ${plural(t.catchUp.notes, "note")} changed, ${num(t.catchUp.removed)} removed, ${msText(t.catchUp.ms)} ms`,
		});
	if (t.changes.times)
		lines.push({
			text: `changes sent to the index: ${plural(t.changes.times, "time")}, ${plural(t.changes.notes, "note")}, slowest ${msText(t.changes.slowest)} ms`,
		});
	for (const p of t.problems)
		lines.push({
			text: `${p.warn ? "warning" : "problem"} ${p.code} at ${at(p.at)}`,
			...(p.warn ? {} : { warn: true }),
		});
	return lines;
};

const eventText = (e: Event): string => {
	switch (e.kind) {
		case KIND.start:
			return `trace started, for ${e.a} min`;
		case KIND.stop:
			return `trace stopped ${BY[(["user", "time", "unload"] as const)[e.a] ?? "time"]}`;
		case KIND.workerStart:
			return "worker started";
		case KIND.workerStop:
			return "worker stopped";
		case KIND.workerCrash:
			return "worker crashed";
		case KIND.workerSleep:
			return "worker slept";
		case KIND.indexOpen:
			return `index opened: ${(HOW[e.flags] ?? "unknown").replace("-", " ")}, ${msText(e.a)} ms`;
		case KIND.buildStart:
			return `index build began, ${plural(e.a, "note")}`;
		case KIND.buildEnd:
			return `index build ended, ${plural(e.b, "note")} in ${seconds(e.a)}`;
		case KIND.changes:
			return `${e.flags & 1 ? "catch-up" : "changes sent"}: ${plural(e.b, "note")} changed, ${num(e.c)} removed, ${msText(e.a)} ms`;
		case KIND.search:
			return [
				`search${e.flags >> SEARCH_CHARS ? ` of ${plural(e.flags >> SEARCH_CHARS, "character")}` : ""}, ${msText(e.a)} ms (index wait ${msText(e.b)}, worker ${msText(e.c)})`,
				plural(e.d, "hit"),
				flagsText(e.flags),
			]
				.filter(Boolean)
				.join(", ");
		case KIND.problem:
			return `${e.flags === 1 ? "warning" : "error"} ${e.label ?? "unknown"}`;
		case KIND.mark:
			return e.label ?? "step";
		default:
			return "event";
	}
};

/** The events as lines of time and words, the newest `max` of them. */
export const timelineLines = (events: Event[], max = MAX_TIMELINE): string[] =>
	events.slice(-max).map((e) => `${at(e.t)}  ${eventText(e)}`);
