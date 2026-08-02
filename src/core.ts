// Power Bases: pure view logic. No Obsidian imports — everything here is
// unit-tested with Node (npm test).
//
// Bases hands views rendered property Values; the only portable way to a raw
// number or date is the rendered string, so all parsing lives here where it
// can be pinned down by tests instead of scattered through view code.

/** Extract a usable number from a rendered property value.
 *  Tolerates thousands separators, currency prefixes, and unit suffixes;
 *  refuses anything that is not one number ("2026-07-11" is a date, not 2026). */
export function parseNumber(raw: string): number | null {
	const s = raw.trim();
	if (!s) return null;
	if (/\d{4}-\d{2}-\d{2}/.test(s)) return null; // dates are not numbers
	const compact = s.replace(/[,\s]/g, "").replace(/^[^0-9+\-.]+/, "");
	const m = compact.match(/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/);
	if (!m) return null;
	const n = Number(m[0]);
	return Number.isFinite(n) ? n : null;
}

export type AggOp = "none" | "sum" | "avg" | "min" | "max" | "filled" | "empty";

/** Column aggregate over rendered values; numeric ops ignore non-numbers. */
export function aggregate(values: string[], op: AggOp): number | null {
	if (op === "none") return null;
	if (op === "filled") return values.filter((v) => v.trim() !== "").length;
	if (op === "empty") return values.filter((v) => v.trim() === "").length;
	const nums = values.map(parseNumber).filter((n): n is number => n != null);
	if (!nums.length) return null;
	if (op === "sum") return nums.reduce((a, b) => a + b, 0);
	if (op === "avg") return nums.reduce((a, b) => a + b, 0) / nums.length;
	if (op === "min") return Math.min(...nums);
	return Math.max(...nums);
}

/** Compact number formatting: up to two decimals, trailing zeros trimmed. */
export function formatNum(n: number): string {
	const r = Math.round(n * 100) / 100;
	if (Number.isInteger(r)) return String(r);
	return String(r.toFixed(2)).replace(/0$/, "");
}

/** Stable palette pick for a category value: same value, same hue, any order. */
export function colorIndex(key: string, paletteSize: number): number {
	let h = 5381;
	for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
	return paletteSize > 0 ? h % paletteSize : 0;
}

/** First YYYY-MM-DD in a rendered value; time suffixes are fine, junk is not. */
export function dateKeyOf(raw: string): string | null {
	const m = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
	if (!m) return null;
	const mo = +m[2];
	const d = +m[3];
	if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
	return `${m[1]}-${m[2]}-${m[3]}`;
}

export interface DayCell {
	/** YYYY-MM-DD */
	key: string;
	day: number;
	inMonth: boolean;
}

/** A fixed 6x7 month grid (42 cells) starting on the configured weekday. */
export function monthGrid(year: number, month0: number, weekStartsMonday: boolean): DayCell[] {
	const first = new Date(year, month0, 1);
	let lead = first.getDay() - (weekStartsMonday ? 1 : 0);
	if (lead < 0) lead += 7;
	const cells: DayCell[] = [];
	for (let i = 0; i < 42; i++) {
		const d = new Date(year, month0, 1 - lead + i);
		const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
		cells.push({ key, day: d.getDate(), inMonth: d.getMonth() === month0 });
	}
	return cells;
}

/** Board lanes: the saved order first (only values that still exist), then
 *  any new values in first-seen order. Null/empty group values are the
 *  caller's "no value" lane and never appear here. */
export function boardColumns(values: (string | null)[], saved: string[]): string[] {
	const live: string[] = [];
	const seen = new Set<string>();
	for (const v of values) {
		if (v == null || v === "") continue;
		if (!seen.has(v)) {
			seen.add(v);
			live.push(v);
		}
	}
	const out: string[] = [];
	for (const s of saved) if (seen.has(s) && !out.includes(s)) out.push(s);
	for (const v of live) if (!out.includes(v)) out.push(v);
	return out;
}

/** Position of n within [min, max] as 0..1; null when the range is flat. */
export function scalePos(n: number, min: number, max: number): number | null {
	if (!(max > min)) return null;
	return (n - min) / (max - min);
}

/** What kind of editor a raw frontmatter value wants. */
export type CellKind = "text" | "number" | "date" | "datetime" | "checkbox" | "list";

/** Infer the editor kind from the RAW frontmatter value (not the rendered string). */
export function inferKind(raw: unknown): CellKind {
	if (typeof raw === "boolean") return "checkbox";
	if (typeof raw === "number") return "number";
	if (Array.isArray(raw)) return "list";
	if (typeof raw === "string") {
		if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) return "datetime";
		if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "date";
	}
	return "text";
}

/** List property to a single editable line. */
export function listToText(raw: unknown): string {
	return Array.isArray(raw) ? raw.map((v) => String(v)).join(", ") : raw == null ? "" : String(raw);
}

/** Editable line back to a list property (empty entries drop). */
export function textToList(s: string): string[] {
	return s
		.split(",")
		.map((p) => p.trim())
		.filter((p) => p !== "");
}

/** The frontmatter value an editor's text commits as; undefined means delete
 *  the property. Numbers stay numbers, lists stay lists, dates stay strings. */
export function coerceForKind(kind: CellKind, s: string): unknown {
	const t = s.trim();
	if (t === "") return undefined;
	if (kind === "number") {
		const n = Number(t);
		return Number.isFinite(n) ? n : t;
	}
	if (kind === "list") {
		const arr = textToList(t);
		return arr.length ? arr : undefined;
	}
	return t;
}

/** A manual rank between two neighbors (fractional insert). Null means the
 *  gap is exhausted and the caller should renumber the lane. */
export function rankBetween(prev: number | null, next: number | null): number | null {
	if (prev == null && next == null) return 1000;
	if (prev == null) return (next as number) - 100;
	if (next == null) return prev + 100;
	if (!(next > prev) || next - prev < 1e-6) return null;
	return prev + (next - prev) / 2;
}

/** Fresh gapped ranks for a lane: 100, 200, 300, ... */
export function renumber(count: number): number[] {
	return Array.from({ length: count }, (_, i) => (i + 1) * 100);
}

/** Ranked items ascending, then unranked in their incoming (base sort) order. */
export function orderByRank<T>(items: T[], rankOf: (t: T) => number | null): T[] {
	const ranked = items.filter((t) => rankOf(t) != null);
	ranked.sort((a, b) => (rankOf(a) as number) - (rankOf(b) as number));
	return [...ranked, ...items.filter((t) => rankOf(t) == null)];
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Lane-rule value tokens: {today} and {now} become dates at apply time. */
export function expandToken(v: string, now: Date): string {
	const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
	if (v === "{today}") return date;
	if (v === "{now}") return `${date}T${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
	return v;
}

/** A lane-rule value as it should land in frontmatter: empty deletes,
 *  booleans and numbers keep their type, everything else stays text. */
export function parseRuleValue(v: string): unknown {
	const t = v.trim();
	if (t === "") return undefined;
	if (t === "true") return true;
	if (t === "false") return false;
	if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
	return t;
}

/* ---------- timeline day math (UTC-based, so DST can never skew a bar) ---------- */

/** YYYY-MM-DD to whole days since the epoch. */
export function dayNum(key: string): number {
	const y = +key.slice(0, 4);
	const m = +key.slice(5, 7) - 1;
	const d = +key.slice(8, 10);
	return Math.round(Date.UTC(y, m, d) / 86400000);
}

/** Whole days since the epoch back to YYYY-MM-DD. */
export function keyOfDayNum(n: number): string {
	const d = new Date(n * 86400000);
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function addDays(key: string, days: number): string {
	return keyOfDayNum(dayNum(key) + days);
}

/** Days from a to b (positive when b is later). */
export function dayDiff(a: string, b: string): number {
	return dayNum(b) - dayNum(a);
}

/** 0 = Sunday ... 6 = Saturday. */
export function dayOfWeek(key: string): number {
	return (dayNum(key) + 4) % 7;
}

/** The seven day-keys of the week containing `key`, starting Monday or Sunday. */
export function weekDays(key: string, mondayStart: boolean): string[] {
	const dow = dayOfWeek(key); // 0 = Sunday
	const offset = mondayStart ? (dow + 6) % 7 : dow;
	const first = addDays(key, -offset);
	return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}

/** Minutes since midnight from a datetime value's THH:MM part; null if none. */
export function timeMinutes(raw: string): number | null {
	const m = raw.match(/T(\d{2}):(\d{2})/);
	if (!m) return null;
	const h = +m[1];
	const min = +m[2];
	if (h > 23 || min > 59) return null;
	return h * 60 + min;
}

/** Calendar months covered by [from, to], with the day count of each that
 *  falls inside the range; drives the timeline's month header. */
export function monthSpans(from: string, to: string): { y: number; m0: number; days: number }[] {
	const out: { y: number; m0: number; days: number }[] = [];
	if (dayDiff(from, to) < 0) return out;
	let y = +from.slice(0, 4);
	let m0 = +from.slice(5, 7) - 1;
	const endY = +to.slice(0, 4);
	const endM = +to.slice(5, 7) - 1;
	for (;;) {
		const first = `${y}-${String(m0 + 1).padStart(2, "0")}-01`;
		const daysInMonth = Math.round((Date.UTC(y, m0 + 1, 1) - Date.UTC(y, m0, 1)) / 86400000);
		const last = addDays(first, daysInMonth - 1);
		const clipStart = dayDiff(from, first) < 0 ? from : first;
		const clipEnd = dayDiff(last, to) > 0 ? last : to;
		out.push({ y, m0, days: dayDiff(clipStart, clipEnd) + 1 });
		if (y === endY && m0 === endM) break;
		m0++;
		if (m0 > 11) {
			m0 = 0;
			y++;
		}
	}
	return out;
}

/** The visible timeline range: the data span padded, always covering today,
 *  and clamped to about three years so one stray 1999 date cannot explode
 *  the axis. Empty data centers on today. */
export function timelineRange(keys: string[], today: string, pad = 7): { from: string; to: string } {
	if (!keys.length) return { from: addDays(today, -30), to: addDays(today, 60) };
	let min = keys[0];
	let max = keys[0];
	for (const k of keys) {
		if (dayDiff(min, k) < 0) min = k;
		if (dayDiff(max, k) > 0) max = k;
	}
	if (dayDiff(min, today) < 0) min = today;
	if (dayDiff(max, today) > 0) max = today;
	let from = addDays(min, -pad);
	let to = addDays(max, pad);
	if (dayDiff(from, to) > 1100) {
		from = addDays(today, -365);
		to = addDays(today, 735);
	}
	return { from, to };
}

/** Swap the date part of a rendered date value, keeping any time suffix. */
export function replaceDateKey(raw: string, newKey: string): string {
	const old = dateKeyOf(raw);
	return old ? raw.replace(old, newKey) : newKey;
}

/* ---------- rollups ---------- */

/** Link-property values ("[[Page]]", "[[Page|alias]]", plain names, or lists
 *  of them) down to bare linktexts for resolution. */
export function linkTargets(raw: unknown): string[] {
	const items = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
	const out: string[] = [];
	for (const it of items) {
		const s = String(it).trim();
		if (!s) continue;
		const m = s.match(/^\[\[([^\]]+)\]\]$/);
		const inner = (m ? m[1] : s).split(/[|#]/)[0].trim();
		if (inner) out.push(inner);
	}
	return out;
}

/** What a frontmatter object held for each key an assignment will touch;
 *  undefined marks "property was absent" so undo knows to delete it. */
export function capturePrev(fm: Record<string, unknown>, keys: string[]): Record<string, unknown> {
	const prev: Record<string, unknown> = {};
	for (const k of keys) {
		const v = fm[k];
		prev[k] = Array.isArray(v) ? [...v] : v;
	}
	return prev;
}

/** The ready-made .base for a folder: all four Power views, scoped to the
 *  folder, markdown only, with the property names the docs teach. */
export function starterBaseYaml(folderPath: string): string {
	const esc = folderPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
	return [
		"filters:",
		"  and:",
		`    - file.inFolder("${esc}")`,
		'    - file.ext == "md"',
		"views:",
		"  - type: powerbases-board",
		"    name: Board",
		"    pbGroup: note.status",
		"    rankProp: note.pb-order",
		"  - type: powerbases-table",
		"    name: Table",
		"  - type: powerbases-calendar",
		"    name: Calendar",
		"    dateProp: note.start",
		"  - type: powerbases-timeline",
		"    name: Timeline",
		"    startProp: note.start",
		"    endProp: note.end",
		"    colorProp: note.status",
		"",
	].join("\n");
}

/** A blank base: one Power Table scoped to a folder, ready to build from
 *  scratch with + Column. With the name column it is one column; without
 *  (the embed flavor) it starts at zero, the pbHideName flag baked in so
 *  the render does not prepend the name back. */
export function blankBaseYaml(folderPath: string, withName = true): string {
	const esc = folderPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
	return [
		"filters:",
		"  and:",
		`    - file.inFolder("${esc}")`,
		'    - file.ext == "md"',
		"views:",
		"  - type: powerbases-table",
		"    name: Table",
		...(withName ? ["    order:", "      - file.name"] : ["    pbHideName: true", "    order: []"]),
		"",
	].join("\n");
}

export type RollupOp = "count" | "sum" | "avg" | "min" | "max" | "filled" | "list";

/** Type-to-filter: every whitespace-separated token of the query must appear
 *  somewhere in the row's text (case-insensitive). Empty query matches all. */
export function matchesQuery(parts: string[], query: string): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	const hay = parts.join("  ").toLowerCase();
	return q.split(/\s+/).every((tok) => hay.includes(tok));
}

/* ---------- charts ---------- */

export type ChartAgg = "count" | "sum" | "avg" | "min" | "max";

/** Group rows by a category label and reduce each group to one number. For
 *  "count" the value column is ignored; the others aggregate it, dropping
 *  non-numbers. Groups keep first-seen order; a null/empty label becomes the
 *  given emptyLabel. Groups that reduce to no number are dropped (except
 *  count, which is always the row tally). */
export function groupAggregate(
	labels: (string | null)[],
	values: string[],
	op: ChartAgg,
	emptyLabel = "(empty)"
): { label: string; value: number }[] {
	const order: string[] = [];
	const buckets = new Map<string, string[]>();
	const counts = new Map<string, number>();
	for (let i = 0; i < labels.length; i++) {
		const key = labels[i] == null || labels[i] === "" ? emptyLabel : (labels[i] as string);
		if (!buckets.has(key)) {
			buckets.set(key, []);
			counts.set(key, 0);
			order.push(key);
		}
		buckets.get(key)!.push(values[i] ?? "");
		counts.set(key, counts.get(key)! + 1);
	}
	const out: { label: string; value: number }[] = [];
	for (const key of order) {
		if (op === "count") {
			out.push({ label: key, value: counts.get(key)! });
			continue;
		}
		const n = aggregate(buckets.get(key)!, op);
		if (n != null) out.push({ label: key, value: n });
	}
	return out;
}

/** A round ceiling at or above max: 1, 2, 2.5, 5, 10 times a power of ten.
 *  Zero and negatives collapse to a friendly default so an axis always draws. */
export function niceCeil(max: number): number {
	if (!(max > 0)) return 1;
	const pow = Math.pow(10, Math.floor(Math.log10(max)));
	for (const m of [1, 2, 2.5, 5, 10]) {
		if (m * pow >= max - 1e-9) return m * pow;
	}
	return 10 * pow;
}

/** Evenly spaced axis ticks from 0 to niceCeil(max), about `target` of them. */
export function axisTicks(max: number, target = 4): number[] {
	const ceil = niceCeil(max);
	const step = niceCeil(ceil / Math.max(1, target));
	const out: number[] = [];
	for (let v = 0; v <= ceil + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
	return out;
}

/** Cumulative donut segments: each value's fraction of the total and the
 *  fraction offset where its arc begins. All-zero input yields no segments. */
export function donutSegments(values: number[]): { frac: number; offset: number }[] {
	const total = values.reduce((a, b) => a + (b > 0 ? b : 0), 0);
	if (total <= 0) return [];
	const out: { frac: number; offset: number }[] = [];
	let acc = 0;
	for (const v of values) {
		const frac = (v > 0 ? v : 0) / total;
		out.push({ frac, offset: acc });
		acc += frac;
	}
	return out;
}

/** A point on a circle for SVG arcs. Angle 0 is 12 o'clock, clockwise; the
 *  fraction (0..1) walks the whole circle. */
export function arcPoint(cx: number, cy: number, r: number, frac: number): [number, number] {
	const a = frac * 2 * Math.PI - Math.PI / 2;
	return [Math.round((cx + r * Math.cos(a)) * 100) / 100, Math.round((cy + r * Math.sin(a)) * 100) / 100];
}

/** A progress property as 0..100. Fractions up to 1 read as percentages of
 *  one (0.4 is 40), anything else clamps into 0..100; null when unusable. */
export function progressPct(raw: unknown): number | null {
	const n = typeof raw === "number" ? raw : raw == null ? null : parseNumber(String(raw));
	if (n == null || !Number.isFinite(n)) return null;
	const pct = n > 0 && n <= 1 ? n * 100 : n;
	return Math.max(0, Math.min(100, pct));
}

/** A rollup cell's display text over the linked notes' raw values. */
export function rollup(op: RollupOp, targetCount: number, values: unknown[]): string {
	if (op === "count") return String(targetCount);
	const strs = values.filter((v) => v != null).map((v) => String(v));
	if (op === "filled") return String(strs.filter((s) => s.trim() !== "").length);
	if (op === "list") {
		const distinct = [...new Set(strs.filter((s) => s.trim() !== ""))];
		const shown = distinct.slice(0, 6).join(", ");
		return distinct.length > 6 ? `${shown} +${distinct.length - 6}` : shown;
	}
	const n = aggregate(strs, op);
	return n == null ? "" : formatNum(n);
}

/* ---------- Power-Base field types ---------- */

// Types Power Bases layers on plain frontmatter, beyond Obsidian's own six.
// A column stays its inferred kind until one of these is assigned to it.
export type PBFieldType = "url" | "email" | "phone" | "person" | "place" | "id" | "button" | "verification" | "image" | "files";

export const PB_FIELD_TYPES: PBFieldType[] = ["url", "email", "phone", "person", "place", "id", "button", "verification", "image", "files"];

/** Normalize a value into an external href: add https:// when no scheme is given. */
export function externalHref(raw: string): string {
	const s = raw.trim();
	if (!s) return "";
	if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s; // already has a scheme (http:, mailto:, obsidian:, ...)
	return "https://" + s;
}

/** mailto: link for an email value (already-prefixed values pass through). */
export function mailtoHref(raw: string): string {
	const s = raw.trim();
	return s ? (/^mailto:/i.test(s) ? s : "mailto:" + s) : "";
}

/** tel: link for a phone value; keeps a leading +, drops spacing and punctuation. */
export function telHref(raw: string): string {
	const s = raw.trim();
	if (!s) return "";
	const plus = s.startsWith("+") ? "+" : "";
	const digits = s.replace(/[^\d]/g, "");
	return digits ? "tel:" + plus + digits : "";
}

/** Google Maps search link for a place or address string. */
export function mapsUrl(raw: string): string {
	const s = raw.trim();
	return s ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(s) : "";
}

/**
 * Place and URL values are stored like a Markdown link so one property can hold
 * both the real address (which the link opens) and optional display text shown
 * in the cell: `[Head office](123 Main St, Springfield)` or
 * `[Docs](https://example.com/a/very/long/path)`. A bare string with no
 * brackets is an address with no display text. The address capture is greedy so
 * URLs containing parentheses survive.
 */
export function parseLinkValue(raw: string): { caption: string; address: string } {
	const s = (raw ?? "").trim();
	const m = s.match(/^\[([^\]]*)\]\((.+)\)$/s);
	if (m) return { caption: m[1].trim(), address: m[2].trim() };
	return { caption: "", address: s };
}

/** Compose a Place or URL value from an address and optional display text
 *  (inverse of parseLinkValue). Square brackets are dropped from the text since
 *  they would break the `[text](address)` shape. */
export function formatLinkValue(address: string, caption: string): string {
	const a = (address ?? "").trim();
	const c = (caption ?? "").trim().replace(/[[\]]/g, "");
	if (!a) return "";
	return c ? `[${c}](${a})` : a;
}

/** The first file.inFolder("...") folder in a base's parsed filters, however
 *  nested (and/or groups); null when the base has no folder scope. */
export function scopeFolder(filters: unknown): string | null {
	if (typeof filters === "string") {
		const m = filters.match(/file\.inFolder\("(.*?)"\)/);
		return m ? m[1] : null;
	}
	if (Array.isArray(filters)) {
		for (const f of filters) {
			const r = scopeFolder(f);
			if (r != null) return r;
		}
		return null;
	}
	if (filters && typeof filters === "object") {
		for (const v of Object.values(filters)) {
			const r = scopeFolder(v);
			if (r != null) return r;
		}
	}
	return null;
}

/** Parse a hand-typed date: ISO (YYYY-MM-DD, optional time) passes through,
 *  slashed or dotted dates read per the column's display style ("us" M/D/Y,
 *  "eu" D/M/Y, an impossible month flips them), optional trailing HH:MM time
 *  with am/pm. Returns the ISO string, or null when it does not read as a
 *  date. */
export function parseDateInput(s: string, style: "us" | "eu" = "us"): string | null {
	const t = (s ?? "").trim();
	if (!t) return null;
	let y: number, mo: number, d: number;
	let hh: string | undefined, mm: string | undefined, ap: string | undefined;
	let m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})\s*([ap]m)?)?$/i);
	if (m) {
		y = +m[1];
		mo = +m[2];
		d = +m[3];
		hh = m[4];
		mm = m[5];
		ap = m[6];
	} else {
		m = t.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([ap]m)?)?$/i);
		if (!m) return null;
		const a = +m[1];
		const b = +m[2];
		y = +m[3];
		mo = style === "eu" ? b : a;
		d = style === "eu" ? a : b;
		if (mo > 12 && d <= 12) {
			const swap = mo;
			mo = d;
			d = swap;
		}
		hh = m[4];
		mm = m[5];
		ap = m[6];
	}
	if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
	const key = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
	if (hh == null || mm == null) return key;
	let h = +hh;
	if (ap) {
		const pm = ap.toLowerCase() === "pm";
		if (h === 12) h = pm ? 12 : 0;
		else if (pm) h += 12;
	}
	if (h > 23 || +mm > 59) return null;
	return `${key}T${String(h).padStart(2, "0")}:${mm}`;
}

/** The link target and display name inside an image or files cell value:
 *  `[[path|alias]]`, `[[path]]`, a bare vault path, or a URL. The alias wins as
 *  the name; otherwise the last path segment. */
export function fileLinkParts(value: string): { link: string; name: string } {
	const s = (value ?? "").trim();
	const m = s.match(/^\[\[(.+?)\]\]$/);
	const inner = m ? m[1] : s;
	const link = inner.split("|")[0].trim();
	const alias = m ? inner.split("|")[1]?.trim() : undefined;
	const name = alias || link.split(/[\\/]/).pop() || link;
	return { link, name };
}

/** How a Phone cell is displayed. "raw" leaves it exactly as typed (for
 *  hand-formatted international numbers); the others regroup a North-American
 *  10-digit number. */
export type PhoneStyle = "raw" | "hyphens" | "parens" | "spaces" | "dots";
export interface PhoneFormat {
	style: PhoneStyle;
}

export function hasPhoneFormat(fmt: PhoneFormat | null | undefined): boolean {
	return !!fmt && fmt.style !== "raw";
}

/**
 * Display a phone number in a chosen style. The four grouped styles apply only
 * to North American Numbering Plan numbers: exactly 10 digits, or 11 with a
 * leading country code 1 (with or without a `+`). Anything else, including any
 * number carrying a non-`+1` country code, is returned exactly as typed, so a
 * column mixing US and international numbers is never mangled and hand-formatted
 * values (e.g. `+63 917 123 4567`) survive untouched.
 */
export function formatPhoneValue(raw: string, fmt: PhoneFormat | null | undefined): string {
	const s = (raw ?? "").trim();
	if (!s || !hasPhoneFormat(fmt)) return s;
	const hasPlus = s.startsWith("+");
	const digits = s.replace(/\D/g, "");
	let national = "";
	let cc = "";
	if (digits.length === 10 && !hasPlus) {
		national = digits;
	} else if (digits.length === 11 && digits.startsWith("1")) {
		cc = "1";
		national = digits.slice(1);
	} else {
		return s; // international or an unexpected length: leave as typed
	}
	const a = national.slice(0, 3);
	const b = national.slice(3, 6);
	const c = national.slice(6, 10);
	let body: string;
	switch (fmt!.style) {
		case "hyphens":
			body = `${a}-${b}-${c}`;
			break;
		case "spaces":
			body = `${a} ${b} ${c}`;
			break;
		case "dots":
			body = `${a}.${b}.${c}`;
			break;
		case "parens":
			body = `(${a}) ${b}-${c}`;
			break;
		default:
			return s;
	}
	if (!cc) return body;
	const prefix = hasPlus ? "+1" : "1";
	const sep = fmt!.style === "hyphens" ? "-" : fmt!.style === "dots" ? "." : " ";
	return prefix + sep + body;
}

/** Loose email shape check, for CSV auto-typing and gentle hints. */
export function looksLikeEmail(s: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

/** Loose URL shape check (http(s):// or a bare www. host). */
export function looksLikeUrl(s: string): boolean {
	return /^(https?:\/\/|www\.)\S+$/i.test(s.trim());
}

/** Person value (single string or list) down to trimmed names, links unwrapped. */
export function personNames(raw: unknown): string[] {
	const items = Array.isArray(raw) ? raw : raw == null || raw === "" ? [] : [raw];
	const out: string[] = [];
	for (const it of items) {
		const s = String(it).trim();
		if (!s) continue;
		const m = s.match(/^\[\[([^\]]+)\]\]$/);
		const inner = m ? m[1] : s;
		const [target, alias] = inner.split("|");
		// show the alias when given, else the bare link's basename (People/Carol -> Carol)
		let name = (alias ?? target).split("#")[0].trim();
		if (alias == null) name = name.split("/").pop()!.trim();
		if (name) out.push(name);
	}
	return out;
}

/** The next sequential ID for a column: prefix + (highest existing number + 1).
 *  Padding follows the widest existing number, so PB-007 begets PB-008 while a
 *  bare "1" begets "2". A fresh column starts at prefix + "1". */
export function nextId(existing: string[], prefix: string): string {
	let max = 0;
	let pad = 0;
	for (const raw of existing) {
		const s = String(raw).trim();
		if (!s) continue;
		if (prefix && !s.startsWith(prefix)) continue;
		const m = s.slice(prefix.length).match(/(\d+)\s*$/);
		if (!m) continue;
		const n = parseInt(m[1], 10);
		if (n > max) max = n;
		if (m[1].length > pad) pad = m[1].length;
	}
	const body = String(max + 1);
	return prefix + (pad > body.length ? body.padStart(pad, "0") : body);
}

export type VerifyState = "unverified" | "verified" | "expired";

/** Verification badge state. A stored "verified"/"expired" wins, but a verified
 *  field whose expiry date is already in the past reads as "expired". */
export function verifyState(value: unknown, expiry: string | null, today: string): VerifyState {
	const v = String(value ?? "").trim().toLowerCase();
	let state: VerifyState = v === "verified" || v === "true" ? "verified" : v === "expired" ? "expired" : "unverified";
	if (state === "verified" && expiry) {
		const k = dateKeyOf(expiry);
		if (k && dayDiff(today, k) < 0) state = "expired";
	}
	return state;
}

/* ---------- CSV import ---------- */

/** Parse CSV text into rows of string cells. Handles quoted fields with
 *  embedded commas, newlines, and doubled "" quotes; tolerates CRLF and a
 *  trailing newline. Fully blank lines are dropped. */
export function parseCsv(text: string, delim = ","): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					cell += '"';
					i++;
				} else quoted = false;
			} else cell += c;
		} else if (c === '"') {
			quoted = true;
		} else if (c === delim) {
			row.push(cell);
			cell = "";
		} else if (c === "\n" || c === "\r") {
			if (c === "\r" && text[i + 1] === "\n") i++;
			row.push(cell);
			cell = "";
			rows.push(row);
			row = [];
		} else cell += c;
	}
	if (cell !== "" || row.length) {
		row.push(cell);
		rows.push(row);
	}
	return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

/** RFC-4180 CSV text: fields holding the delimiter, quotes, or line breaks
 *  are quoted with inner quotes doubled; rows join with CRLF, which
 *  spreadsheets expect. The inverse of parseCsv. */
export function toCsv(rows: string[][]): string {
	const field = (s: string) => (/[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
	return rows.map((r) => r.map(field).join(",")).join("\r\n") + "\r\n";
}

/** Coerce a CSV cell string to a typed frontmatter value for its inferred
 *  kind; blank becomes undefined (the property is left off the note). */
export function csvValue(kind: CellKind, s: string): unknown {
	const t = s.trim();
	if (t === "") return undefined;
	if (kind === "checkbox") return /^(true|yes)$/i.test(t);
	if (kind === "number") {
		const n = Number(t.replace(/,/g, ""));
		return Number.isFinite(n) ? n : t;
	}
	return t; // date, datetime, and text stay strings
}

/** Infer a column's editor kind from sample cell strings (CSV import). */
export function inferColumnKind(samples: string[]): CellKind {
	const vals = samples.map((s) => s.trim()).filter((s) => s !== "");
	if (!vals.length) return "text";
	const all = (re: RegExp) => vals.every((v) => re.test(v));
	if (all(/^(true|false|yes|no)$/i)) return "checkbox";
	if (all(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)) return "datetime";
	if (all(/^\d{4}-\d{2}-\d{2}$/)) return "date";
	if (all(/^-?\d{1,3}(,\d{3})+(\.\d+)?$|^-?\d+(\.\d+)?$/)) return "number";
	return "text";
}

/** Guess a Power-Base field type from a column's header and samples; null when
 *  nothing special stands out and a plain kind should stay. */
export function inferFieldType(header: string, samples: string[]): PBFieldType | null {
	const h = header.toLowerCase();
	const vals = samples.map((s) => s.trim()).filter(Boolean);
	const most = (pred: (v: string) => boolean) => vals.length > 0 && vals.filter(pred).length >= Math.ceil(vals.length * 0.7);
	if (/\bemail\b|e-mail/.test(h) || most(looksLikeEmail)) return "email";
	if (/\burl\b|website|homepage|link/.test(h) || most(looksLikeUrl)) return "url";
	if (/\bphone\b|mobile|telephone|\bfax\b|\btel\b/.test(h)) return "phone";
	if (/address|location|\bcity\b|\bplace\b/.test(h)) return "place";
	if (/assignee|\bowner\b|person|contact|manager|reporter/.test(h)) return "person";
	return null;
}

/** A frontmatter-safe key from a CSV header: trimmed, YAML-hostile characters
 *  dropped, inner spacing collapsed; empty falls back to colN. */
export function sanitizeKey(header: string, n: number): string {
	const s = header
		.replace(/[\r\n]+/g, " ")
		.replace(/[:#[\]{}",]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	return s || "col" + n;
}

/** A vault-safe file or folder base name (illegal characters stripped). */
export function safeName(name: string, fallback = "Untitled"): string {
	const s = name
		.replace(/[\\/:*?"<>|#^[\]]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	return s || fallback;
}

/** A safe Bases formula key from a user-typed name: only word characters, no
 *  leading digit (so it can be referenced as formula.<name>). */
export function safeFormulaName(name: string): string {
	const s = name.trim().replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
	if (!s) return "";
	return /^[0-9]/.test(s) ? "f_" + s : s;
}

/* ---------- number formatting ---------- */

/** How a numeric cell renders. "plain" and "percent" are text; the rest draw a
 *  visual (bar/ring fills, stars/dots count out of a max, traffic-light dot). */
export type NumberDisplay = "plain" | "bar" | "ring" | "stars" | "dots" | "percent" | "traffic";

/** Main worldwide currencies for the number-format picker; the symbol is used
 *  as the number's prefix (a trailing space keeps multi-letter marks readable). */
export const CURRENCIES: { code: string; symbol: string; name: string }[] = [
	{ code: "USD", symbol: "$", name: "US Dollar" },
	{ code: "EUR", symbol: "€", name: "Euro" },
	{ code: "GBP", symbol: "£", name: "British Pound" },
	{ code: "JPY", symbol: "¥", name: "Japanese Yen" },
	{ code: "CNY", symbol: "CN¥", name: "Chinese Yuan" },
	{ code: "PHP", symbol: "₱", name: "Philippine Peso" },
	{ code: "INR", symbol: "₹", name: "Indian Rupee" },
	{ code: "AUD", symbol: "A$", name: "Australian Dollar" },
	{ code: "CAD", symbol: "C$", name: "Canadian Dollar" },
	{ code: "CHF", symbol: "CHF ", name: "Swiss Franc" },
	{ code: "HKD", symbol: "HK$", name: "Hong Kong Dollar" },
	{ code: "SGD", symbol: "S$", name: "Singapore Dollar" },
	{ code: "KRW", symbol: "₩", name: "South Korean Won" },
	{ code: "NZD", symbol: "NZ$", name: "New Zealand Dollar" },
	{ code: "BRL", symbol: "R$", name: "Brazilian Real" },
	{ code: "MXN", symbol: "Mex$", name: "Mexican Peso" },
	{ code: "ZAR", symbol: "R", name: "South African Rand" },
	{ code: "SEK", symbol: "kr ", name: "Swedish Krona" },
	{ code: "NOK", symbol: "kr ", name: "Norwegian Krone" },
	{ code: "DKK", symbol: "kr ", name: "Danish Krone" },
	{ code: "PLN", symbol: "zł ", name: "Polish Zloty" },
	{ code: "RUB", symbol: "₽", name: "Russian Ruble" },
	{ code: "TRY", symbol: "₺", name: "Turkish Lira" },
	{ code: "THB", symbol: "฿", name: "Thai Baht" },
	{ code: "IDR", symbol: "Rp", name: "Indonesian Rupiah" },
	{ code: "MYR", symbol: "RM", name: "Malaysian Ringgit" },
	{ code: "TWD", symbol: "NT$", name: "Taiwan Dollar" },
	{ code: "VND", symbol: "₫", name: "Vietnamese Dong" },
	{ code: "AED", symbol: "AED ", name: "UAE Dirham" },
	{ code: "SAR", symbol: "SAR ", name: "Saudi Riyal" },
	{ code: "ILS", symbol: "₪", name: "Israeli Shekel" },
];

/** The symbol (prefix) for a currency code, or "" if unknown. */
export function currencySymbol(code: string | undefined | null): string {
	if (!code) return "";
	return CURRENCIES.find((c) => c.code === code)?.symbol ?? "";
}

/** Per-column display formatting for numeric cells (Power Table). */
export interface NumberFormat {
	/** Fixed decimal places; null/undefined leaves the number as-is. */
	decimals?: number | null;
	/** Group the integer part with thousands separators. */
	thousands?: boolean;
	/** Text before the number, e.g. a unit or symbol (wins over currency). */
	prefix?: string;
	/** Text after the number, e.g. a unit. */
	suffix?: string;
	/** Currency code; its symbol becomes the prefix when no prefix is set. */
	currency?: string;
	/** How the cell renders (plain number, bar, ring, stars, dots, percent, traffic). */
	display?: NumberDisplay;
	/** Hue (hex) for a bar/ring/stars/dots; default is the accent color. */
	color?: string;
	/** Show the number beside a visual; default true. */
	showNumber?: boolean;
	/** For bar/ring/percent, the fill denominator; for stars/dots, the icon
	 *  count. Null/undefined means the column's max (bar/ring/percent) or 5. */
	max?: number | null;
	/** Traffic light: below this reads red. Default a third of the column max. */
	low?: number | null;
	/** Traffic light: below this reads amber, at/above reads green. Default two
	 *  thirds of the column max. */
	high?: number | null;
}

/** True when a format would actually change how a number shows or renders. */
export function hasNumberFormat(fmt: NumberFormat | null | undefined): boolean {
	if (!fmt) return false;
	return (
		fmt.decimals != null ||
		!!fmt.thousands ||
		!!fmt.prefix ||
		!!fmt.suffix ||
		!!fmt.currency ||
		(fmt.display != null && fmt.display !== "plain")
	);
}

/** True when the format draws a visual (bar/ring/stars/dots/traffic) rather
 *  than text. "percent" is text, so it is not a meter. */
export function isMeter(fmt: NumberFormat | null | undefined): boolean {
	if (!fmt) return false;
	return fmt.display === "bar" || fmt.display === "ring" || fmt.display === "stars" || fmt.display === "dots" || fmt.display === "traffic";
}

/** The 0..1 fill for a bar/ring: value over its max (fmt.max or the column's),
 *  clamped; a non-positive max yields 0. */
export function meterFraction(n: number, max: number): number {
	if (!(max > 0)) return 0;
	return Math.max(0, Math.min(1, n / max));
}

/** Filled icon count for stars/dots: value rounded, clamped into 0..count. */
export function starCount(n: number, count: number): number {
	return Math.max(0, Math.min(count, Math.round(n)));
}

/** A value as a percent of its max, e.g. 30 out of 60 -> "50%". */
export function formatPercent(n: number, max: number, decimals = 0): string {
	const pct = max > 0 ? (n / max) * 100 : 0;
	return pct.toFixed(decimals) + "%";
}

export type TrafficState = "red" | "amber" | "green";

/** Traffic-light state: below low is red, below high is amber, else green. */
export function trafficState(n: number, low: number, high: number): TrafficState {
	if (n < low) return "red";
	if (n < high) return "amber";
	return "green";
}

/** Apply a NumberFormat to a value: fixed decimals, thousands grouping, and a
 *  prefix/suffix (currency symbol when no explicit prefix). The sign leads the
 *  prefix so it reads -$5, not $-5. */
export function formatNumberValue(n: number, fmt: NumberFormat): string {
	const neg = n < 0;
	const abs = Math.abs(n);
	let body = fmt.decimals != null ? abs.toFixed(fmt.decimals) : String(abs);
	if (fmt.thousands) {
		const dot = body.indexOf(".");
		const int = dot < 0 ? body : body.slice(0, dot);
		const frac = dot < 0 ? "" : body.slice(dot);
		body = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + frac;
	}
	const prefix = fmt.prefix ?? currencySymbol(fmt.currency);
	return (neg ? "-" : "") + prefix + body + (fmt.suffix ?? "");
}

/* ---------- date/time formatting ---------- */

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type DatePreset = "iso" | "us" | "eu" | "medium" | "long" | "relative";

/** Per-column display formatting for date/datetime cells (Power Table). */
export interface DateFormat {
	/** Date style; default "iso". */
	preset?: DatePreset;
	/** Whether and how to show the time part; default "none". */
	time?: "none" | "24h" | "12h";
}

function relativeDay(diff: number): string {
	if (diff === 0) return "today";
	if (diff === 1) return "tomorrow";
	if (diff === -1) return "yesterday";
	return diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
}

function formatTime(mins: number, mode: "24h" | "12h"): string {
	const h = Math.floor(mins / 60);
	const m = mins % 60;
	if (mode === "24h") return `${pad2(h)}:${pad2(m)}`;
	const ampm = h < 12 ? "AM" : "PM";
	const h12 = h % 12 || 12;
	return `${h12}:${pad2(m)} ${ampm}`;
}

/** Apply a DateFormat to a rendered date value. Pulls the date (and any time)
 *  out of the string; returns the input unchanged when there is no date to
 *  format. `todayKey` (YYYY-MM-DD) anchors the "relative" preset. */
export function formatDateValue(raw: string, fmt: DateFormat, todayKey?: string): string {
	const key = dateKeyOf(raw);
	if (!key) return raw;
	const y = +key.slice(0, 4);
	const mo = +key.slice(5, 7);
	const d = +key.slice(8, 10);
	const preset = fmt.preset ?? "iso";
	let out: string;
	if (preset === "relative" && todayKey) out = relativeDay(dayDiff(todayKey, key));
	else if (preset === "us") out = `${pad2(mo)}/${pad2(d)}/${y}`;
	else if (preset === "eu") out = `${pad2(d)}/${pad2(mo)}/${y}`;
	else if (preset === "medium") out = `${MONTHS_SHORT[mo - 1]} ${d}, ${y}`;
	else if (preset === "long") out = `${MONTHS_LONG[mo - 1]} ${d}, ${y}`;
	else out = key; // iso, and relative without a today anchor
	const mins = timeMinutes(raw);
	if (fmt.time && fmt.time !== "none" && mins != null) out += " " + formatTime(mins, fmt.time);
	return out;
}

/** True when a date format is actively set (any chosen preset, including iso,
 *  since that still overrides how Bases renders file dates). */
export function hasDateFormat(fmt: DateFormat | null | undefined): boolean {
	return !!fmt && (fmt.preset != null || (fmt.time != null && fmt.time !== "none"));
}

/* ---------- formula preview evaluator ----------
 * A small, bounded evaluator for the formula editor's live preview ONLY. Bases
 * computes the real saved column; this just mirrors the common cases (arithmetic
 * and the everyday functions) so typing shows a value. Anything it does not
 * understand throws, and the caller shows "preview unavailable" rather than a
 * wrong number, so it can never mislead. */

export type FormulaValue = number | string | boolean | null;
export type EvalResult = { ok: true; value: FormulaValue } | { ok: false; error: string };

export interface FormulaFileCtx {
	name?: string;
	ext?: string;
	path?: string;
}

class EvalError extends Error {}

type Tok = { t: "num" | "str" | "id" | "op"; v: string };

function tokenizeFormula(src: string): Tok[] {
	const out: Tok[] = [];
	const ops2 = ["<=", ">=", "==", "!=", "&&", "||"];
	const ops1 = "()[],.+-*/%<>!";
	let i = 0;
	while (i < src.length) {
		const c = src[i];
		if (/\s/.test(c)) {
			i++;
			continue;
		}
		if (c === '"' || c === "'") {
			let s = "";
			i++;
			while (i < src.length && src[i] !== c) {
				if (src[i] === "\\" && i + 1 < src.length) {
					s += src[i + 1];
					i += 2;
				} else s += src[i++];
			}
			if (i >= src.length) throw new EvalError("unterminated string");
			i++;
			out.push({ t: "str", v: s });
			continue;
		}
		if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
			let n = "";
			while (i < src.length && /[0-9.]/.test(src[i])) n += src[i++];
			out.push({ t: "num", v: n });
			continue;
		}
		if (/[A-Za-z_]/.test(c)) {
			let id = "";
			while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) id += src[i++];
			out.push({ t: "id", v: id });
			continue;
		}
		const two = src.slice(i, i + 2);
		if (ops2.includes(two)) {
			out.push({ t: "op", v: two });
			i += 2;
			continue;
		}
		if (ops1.includes(c)) {
			out.push({ t: "op", v: c });
			i++;
			continue;
		}
		throw new EvalError(`unexpected "${c}"`);
	}
	return out;
}

type Node =
	| { k: "num"; v: number }
	| { k: "str"; v: string }
	| { k: "bool"; v: boolean }
	| { k: "id"; name: string }
	| { k: "member"; obj: Node; name: string }
	| { k: "index"; obj: Node; index: Node }
	| { k: "call"; name: string; args: Node[] }
	| { k: "method"; obj: Node; name: string; args: Node[] }
	| { k: "un"; op: string; operand: Node }
	| { k: "bin"; op: string; left: Node; right: Node };

const BIN_BP: Record<string, number> = { "||": 1, "&&": 2, "==": 3, "!=": 3, "<": 4, "<=": 4, ">": 4, ">=": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6 };

class FormulaParser {
	private i = 0;
	constructor(private toks: Tok[]) {}
	private peek(): Tok | undefined {
		return this.toks[this.i];
	}
	private next(): Tok {
		const t = this.toks[this.i++];
		if (!t) throw new EvalError("unexpected end of formula");
		return t;
	}
	private eatOp(v: string) {
		const t = this.next();
		if (t.t !== "op" || t.v !== v) throw new EvalError(`expected "${v}"`);
	}
	parse(): Node {
		const n = this.expr(0);
		if (this.peek()) throw new EvalError("unexpected trailing input");
		return n;
	}
	private expr(bp: number): Node {
		let left = this.prefix();
		for (;;) {
			const t = this.peek();
			if (!t || t.t !== "op") break;
			const lbp = BIN_BP[t.v];
			if (!lbp || lbp <= bp) break;
			this.next();
			left = { k: "bin", op: t.v, left, right: this.expr(lbp) };
		}
		return left;
	}
	private prefix(): Node {
		const t = this.peek();
		if (t && t.t === "op" && (t.v === "-" || t.v === "!")) {
			this.next();
			return { k: "un", op: t.v, operand: this.prefix() };
		}
		return this.postfix(this.primary());
	}
	private postfix(node: Node): Node {
		for (;;) {
			const t = this.peek();
			if (!t || t.t !== "op") break;
			if (t.v === ".") {
				this.next();
				const id = this.next();
				if (id.t !== "id") throw new EvalError("expected a name after .");
				if (this.peek()?.v === "(") node = { k: "method", obj: node, name: id.v, args: this.args() };
				else node = { k: "member", obj: node, name: id.v };
			} else if (t.v === "[") {
				this.next();
				const index = this.expr(0);
				this.eatOp("]");
				node = { k: "index", obj: node, index };
			} else break;
		}
		return node;
	}
	private primary(): Node {
		const t = this.next();
		if (t.t === "num") return { k: "num", v: Number(t.v) };
		if (t.t === "str") return { k: "str", v: t.v };
		if (t.t === "id") {
			if (t.v === "true") return { k: "bool", v: true };
			if (t.v === "false") return { k: "bool", v: false };
			if (this.peek()?.v === "(") return { k: "call", name: t.v, args: this.args() };
			return { k: "id", name: t.v };
		}
		if (t.t === "op" && t.v === "(") {
			const e = this.expr(0);
			this.eatOp(")");
			return e;
		}
		throw new EvalError(`unexpected "${t.v}"`);
	}
	private args(): Node[] {
		this.eatOp("(");
		const args: Node[] = [];
		if (this.peek()?.v !== ")") {
			args.push(this.expr(0));
			while (this.peek()?.v === ",") {
				this.next();
				args.push(this.expr(0));
			}
		}
		this.eatOp(")");
		return args;
	}
}

const isNum = (v: FormulaValue): v is number => typeof v === "number" && !Number.isNaN(v);
function toNum(v: FormulaValue): number {
	if (typeof v === "number") return v;
	if (typeof v === "boolean") return v ? 1 : 0;
	if (typeof v === "string" && v.trim() !== "") {
		const n = Number(v.replace(/,/g, ""));
		if (!Number.isNaN(n)) return n;
	}
	throw new EvalError("expected a number");
}
const truthy = (v: FormulaValue): boolean => !(v === null || v === false || v === 0 || v === "" || (typeof v === "number" && Number.isNaN(v)));

interface EvalCtx {
	row: Record<string, unknown>;
	formulas: Record<string, string>;
	fileCtx?: FormulaFileCtx;
	depth: number;
}

/** Coerce a raw frontmatter value into a formula value (lists join to a string). */
function rawToValue(raw: unknown): FormulaValue {
	if (raw == null) return null;
	if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "string") return raw;
	if (Array.isArray(raw)) return raw.map((x) => String(x)).join(", ");
	return String(raw);
}

const FN1: Record<string, (n: number, d?: number) => FormulaValue> = {
	abs: (n) => Math.abs(n),
	ceil: (n) => Math.ceil(n),
	floor: (n) => Math.floor(n),
	round: (n, d = 0) => {
		const f = Math.pow(10, d);
		return Math.round(n * f) / f;
	},
	toFixed: (n, d = 0) => n.toFixed(d),
	number: (n) => n,
};

function callFn(name: string, args: FormulaValue[]): FormulaValue {
	if (name in FN1) {
		if (!args.length) throw new EvalError(`${name}() needs a value`);
		const d = args.length > 1 ? toNum(args[1]) : undefined;
		return FN1[name](toNum(args[0]), d);
	}
	if (name === "min" || name === "max") {
		if (!args.length) throw new EvalError(`${name}() needs values`);
		const ns = args.map(toNum);
		return name === "min" ? Math.min(...ns) : Math.max(...ns);
	}
	if (name === "concat") return args.map((a) => (a == null ? "" : String(a))).join("");
	if (name === "length") {
		const a = args[0];
		return typeof a === "string" ? a.length : a == null ? 0 : String(a).length;
	}
	if (name === "lower") return String(args[0] ?? "").toLowerCase();
	if (name === "upper") return String(args[0] ?? "").toUpperCase();
	if (name === "trim") return String(args[0] ?? "").trim();
	if (name === "contains") return String(args[0] ?? "").includes(String(args[1] ?? ""));
	throw new EvalError(`unknown function "${name}"`);
}

function ev(node: Node, ctx: EvalCtx): FormulaValue {
	switch (node.k) {
		case "num":
			return node.v;
		case "str":
			return node.v;
		case "bool":
			return node.v;
		case "id":
			// a bare identifier is a note property (namespaces resolve via member)
			if (node.name === "note" || node.name === "formula" || node.name === "file") return null;
			return rawToValue(ctx.row[node.name]);
		case "member": {
			if (node.obj.k === "id") {
				if (node.obj.name === "note") return rawToValue(ctx.row[node.name]);
				if (node.obj.name === "formula") return evalFormulaRef(node.name, ctx);
				if (node.obj.name === "file") return ctx.fileCtx?.[node.name as keyof FormulaFileCtx] ?? null;
			}
			return null;
		}
		case "index": {
			const key = ev(node.index, ctx);
			if (node.obj.k === "id" && node.obj.name === "note") return rawToValue(ctx.row[String(key)]);
			if (node.obj.k === "id" && node.obj.name === "formula") return evalFormulaRef(String(key), ctx);
			return null;
		}
		case "call": {
			if (node.name === "if") {
				if (node.args.length < 2) throw new EvalError("if() needs a condition and a value");
				return truthy(ev(node.args[0], ctx)) ? ev(node.args[1], ctx) : node.args[2] ? ev(node.args[2], ctx) : null;
			}
			return callFn(node.name, node.args.map((a) => ev(a, ctx)));
		}
		case "method":
			return callFn(node.name, [ev(node.obj, ctx), ...node.args.map((a) => ev(a, ctx))]);
		case "un": {
			if (node.op === "!") return !truthy(ev(node.operand, ctx));
			return -toNum(ev(node.operand, ctx));
		}
		case "bin":
			return evBin(node, ctx);
	}
}

function evBin(node: { op: string; left: Node; right: Node }, ctx: EvalCtx): FormulaValue {
	const op = node.op;
	if (op === "&&") return truthy(ev(node.left, ctx)) && truthy(ev(node.right, ctx));
	if (op === "||") return truthy(ev(node.left, ctx)) || truthy(ev(node.right, ctx));
	const l = ev(node.left, ctx);
	const r = ev(node.right, ctx);
	if (op === "+") return isNum(l) && isNum(r) ? l + r : (l == null ? "" : String(l)) + (r == null ? "" : String(r));
	if (op === "-") return toNum(l) - toNum(r);
	if (op === "*") return toNum(l) * toNum(r);
	if (op === "/") return toNum(l) / toNum(r);
	if (op === "%") return toNum(l) % toNum(r);
	if (op === "==") return isNum(l) && isNum(r) ? l === r : String(l) === String(r);
	if (op === "!=") return isNum(l) && isNum(r) ? l !== r : String(l) !== String(r);
	const cmp = isNum(l) && isNum(r) ? l - r : String(l).localeCompare(String(r));
	if (op === "<") return cmp < 0;
	if (op === "<=") return cmp <= 0;
	if (op === ">") return cmp > 0;
	return cmp >= 0;
}

function evalFormulaRef(name: string, ctx: EvalCtx): FormulaValue {
	const expr = ctx.formulas[name];
	if (expr == null) throw new EvalError(`unknown formula "${name}"`);
	if (ctx.depth > 20) throw new EvalError("formula references are too deep");
	const ast = new FormulaParser(tokenizeFormula(expr)).parse();
	return ev(ast, { ...ctx, depth: ctx.depth + 1 });
}

/** Evaluate a formula expression against one row for the editor's live preview.
 *  `row` maps frontmatter keys to raw values; `formulas` lets `formula.x` refs
 *  resolve. Returns {ok:false} for anything unsupported so the UI can say so. */
export function evalFormula(
	expr: string,
	row: Record<string, unknown>,
	formulas: Record<string, string> = {},
	fileCtx?: FormulaFileCtx
): EvalResult {
	if (!expr.trim()) return { ok: false, error: "empty formula" };
	try {
		const ast = new FormulaParser(tokenizeFormula(expr)).parse();
		return { ok: true, value: ev(ast, { row, formulas, fileCtx, depth: 0 }) };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : "invalid formula" };
	}
}

/* ---------- base file builder ---------- */

export interface BaseViewSpec {
	/** e.g. "powerbases-table" */
	type: string;
	name: string;
	/** extra view-config lines, value written verbatim as a YAML scalar. */
	options?: Record<string, string>;
	/** visible-column order (property ids like note.status) for table views. */
	order?: string[];
}

/** Build a .base file: a folder filter plus the given views. Property names in
 *  options and order are written verbatim (already note.-qualified). */
export function buildBaseYaml(folderPath: string, views: BaseViewSpec[]): string {
	const esc = folderPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
	const lines: string[] = ["filters:", "  and:", `    - file.inFolder("${esc}")`, '    - file.ext == "md"', "views:"];
	for (const v of views) {
		lines.push(`  - type: ${v.type}`, `    name: ${v.name}`);
		for (const [k, val] of Object.entries(v.options ?? {})) lines.push(`    ${k}: ${val}`);
		if (v.order && v.order.length) {
			lines.push("    order:");
			for (const o of v.order) lines.push(`      - ${o}`);
		}
	}
	lines.push("");
	return lines.join("\n");
}

/**
 * Merge our settings over what is on disk RIGHT NOW, for a save.
 *
 * data.json is synced. Other devices write it, and a device that has been idle
 * still holds whatever it read when its plugin loaded, so writing that whole
 * object back reverts every change made anywhere else since. Settings that are
 * set once and never touched again are the casualty: nothing rewrites them
 * afterwards, so a single revert loses them for good and without a sound.
 *
 * A save may only carry the keys we changed. `baseline` is the state we last
 * read from or wrote to disk, so anything differing from it is ours: those
 * overwrite. Every untouched key takes the disk's value. A key absent from disk
 * was written by a version that did not know it, and keeps ours rather than
 * resetting to a default.
 */
export function mergeForSave<T extends object>(ours: T, baseline: T, disk: Partial<T> | null): T {
	const out = { ...ours };
	if (!disk) return out;
	for (const k of Object.keys(ours) as (keyof T)[]) {
		if (!(k in disk)) continue; // disk has never heard of this key; ours stands
		const o = ours[k];
		const b = baseline[k];
		const d = disk[k];
		if (isRecord(o) && isRecord(b) && isRecord(d)) {
			out[k] = mergeEntries(o, b, d) as T[keyof T];
			continue;
		}
		const changedByUs = JSON.stringify(o) !== JSON.stringify(b);
		if (!changedByUs) out[k] = d as T[keyof T];
	}
	return out;
}

/** A per-item map, as opposed to a value that means something whole. Arrays are
 *  values here: a list's order and membership are the thing itself. */
function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The same three-way rule, entry by entry.
 *
 * A key holding one value per item — per folder, per field, per speaker — is a
 * whole vault's worth of settings behind a single name, and merging it whole
 * meant changing ONE of them published all of them. Every item another device
 * configured since this one last read was erased by a device that had never
 * seen it.
 *
 * Start from the disk, so anything another device set survives; drop only what
 * we deliberately removed (present in the baseline, gone from ours); then lay
 * our own changed entries over the top. Two devices editing the SAME item still
 * settles last-writer-wins, but that is one item losing a race rather than
 * everything losing it.
 */
function mergeEntries(
	ours: Record<string, unknown>,
	baseline: Record<string, unknown>,
	disk: Record<string, unknown>
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const k of Object.keys(disk)) {
		const removedByUs = k in baseline && !(k in ours);
		if (!removedByUs) out[k] = disk[k];
	}
	for (const k of Object.keys(ours)) {
		const changedByUs = JSON.stringify(ours[k]) !== JSON.stringify(baseline[k]);
		if (changedByUs || !(k in disk)) out[k] = ours[k];
	}
	return out;
}
