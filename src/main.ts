import { BasesView, ButtonComponent, Menu, Modal, Notice, NullValue, Plugin, PluginSettingTab, Setting, TFile, TFolder, getLinkpath, parseYaml, requestUrl, setIcon, stringifyYaml } from "obsidian";
import type { App, BasesAllOptions, BasesEntry, BasesPropertyId, BasesViewConfig, Editor, QueryController, SettingDefinitionItem, SettingDefinitionPage, SettingDefinitionRender, WorkspaceLeaf } from "obsidian";
import {
	AggOp,
	CellKind,
	ChartAgg,
	RollupOp,
	addDays,
	arcPoint,
	axisTicks,
	capturePrev,
	donutSegments,
	groupAggregate,
	matchesQuery,
	starterBaseYaml,
	blankBaseYaml,
	timeMinutes,
	weekDays,
	aggregate,
	boardColumns,
	coerceForKind,
	colorIndex,
	dateKeyOf,
	dayDiff,
	dayOfWeek,
	expandToken,
	formatNum,
	inferKind,
	linkTargets,
	monthGrid,
	monthSpans,
	orderByRank,
	parseNumber,
	parseRuleValue,
	progressPct,
	rankBetween,
	renumber,
	replaceDateKey,
	rollup,
	scalePos,
	timelineRange,
	PBFieldType,
	PB_FIELD_TYPES,
	VerifyState,
	BaseViewSpec,
	externalHref,
	mailtoHref,
	telHref,
	mapsUrl,
	parseLinkValue,
	formatLinkValue,
	fileLinkParts,
	parseDateInput,
	scopeFolder,
	toCsv,
	PhoneFormat,
	PhoneStyle,
	formatPhoneValue,
	hasPhoneFormat,
	personNames,
	nextId,
	verifyState,
	parseCsv,
	csvValue,
	evalFormula,
	safeFormulaName,
	NumberFormat,
	NumberDisplay,
	formatNumberValue,
	hasNumberFormat,
	isMeter,
	meterFraction,
	starCount,
	formatPercent,
	trafficState,
	CURRENCIES,
	DateFormat,
	DatePreset,
	formatDateValue,
	hasDateFormat,
	inferColumnKind,
	inferFieldType,
	sanitizeKey,
	safeName,
	buildBaseYaml,
	mergeForSave,
} from "./core";

/** Labels and icons for the Power-Base field types (the header type menu). */
const PB_TYPE_LABEL: Record<PBFieldType, string> = {
	url: "URL",
	email: "Email",
	phone: "Phone",
	person: "Person",
	place: "Place",
	id: "ID",
	button: "Button",
	verification: "Verification",
	image: "Image",
	files: "Files",
};
const PB_TYPE_ICON: Record<PBFieldType, string> = {
	url: "link",
	email: "at-sign",
	phone: "phone",
	person: "user",
	place: "map-pin",
	id: "hash",
	button: "mouse-pointer-click",
	verification: "badge-check",
	image: "image",
	files: "paperclip",
};
const VERIFY_ICON: Record<VerifyState, string> = { unverified: "circle-dashed", verified: "badge-check", expired: "badge-alert" };
const VERIFY_LABEL: Record<VerifyState, string> = { unverified: "Unverified", verified: "Verified", expired: "Expired" };

/** Extensions the Image picker offers (same set the gallery treats as covers). */
const IMG_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp"]);

/** Today as YYYY-MM-DD, for verification expiry checks and relative dates. */
const todayKey = () => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** A local YYYY-MM-DDTHH:MM string from an epoch (file mtime/ctime), so date
 *  formatting uses the file's real local time, not however Bases renders it. */
const localDateString = (ms: number): string => {
	const d = new Date(ms);
	const p2 = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

/** Per-column filter operators (label, and whether they need a value). */
const FILTER_OPS: { op: string; label: string; needsValue: boolean }[] = [
	{ op: "contains", label: "contains", needsValue: true },
	{ op: "notcontains", label: "does not contain", needsValue: true },
	{ op: "is", label: "is", needsValue: true },
	{ op: "isnot", label: "is not", needsValue: true },
	{ op: "gt", label: "greater than", needsValue: true },
	{ op: "lt", label: "less than", needsValue: true },
	{ op: "notempty", label: "is not empty", needsValue: false },
	{ op: "empty", label: "is empty", needsValue: false },
];

/** Parse a JSON-string config value, tolerating already-parsed objects and junk. */
function parseJson<T>(raw: unknown): T | null {
	if (raw == null) return null;
	if (typeof raw === "object") return raw as T;
	if (typeof raw === "string") {
		try {
			return JSON.parse(raw) as T;
		} catch {
			return null;
		}
	}
	return null;
}

/** A note's frontmatter, with `unknown` fields rather than `any` ones.
 *
 *  Obsidian types `CachedMetadata.frontmatter` as `any`, so every value read
 *  through it arrives untyped and quietly switches off checking for whatever it
 *  touches next. Reading it here, once, is what keeps that from spreading: the
 *  callers get `unknown` and have to say what they expect. */
function frontmatterOf(app: App, file: TFile): Record<string, unknown> | undefined {
	const fm: unknown = app.metadataCache.getFileCache(file)?.frontmatter;
	return fm as Record<string, unknown> | undefined;
}

/** Paint a button as destructive.
 *
 *  `setDestructive` arrived in 1.13 and this plugin's floor is 1.10.2, where
 *  calling it would throw, so the old `setWarning` has to stay reachable. The
 *  cast is the runtime check: the inline type carries no deprecation, which is
 *  also what keeps the fallback from being reported as one. */
function markDestructive(b: ButtonComponent): ButtonComponent {
	const btn = b as unknown as { setDestructive?: () => void; setWarning: () => void };
	if (btn.setDestructive) btn.setDestructive();
	else btn.setWarning();
	return b;
}

/** Attach a listener whose work is async.
 *
 *  addEventListener wants a void return and drops whatever it is handed, so an
 *  `async` listener's rejection goes nowhere: the button appears to do nothing
 *  and the reason is lost. Await inside, and say so when it fails. */
function onEventAsync(el: HTMLElement, event: string, run: () => Promise<void>) {
	el.addEventListener(event, () => {
		void run().catch((e: unknown) => {
			new Notice("Power Bases: " + (e instanceof Error ? e.message : String(e)), 8000);
		});
	});
}

/** Whether a rendered cell value passes a per-column filter condition. */
function matchesColumnFilter(s: string, op: string, value: string): boolean {
	const v = s.toLowerCase();
	const q = value.toLowerCase();
	switch (op) {
		case "contains":
			return v.includes(q);
		case "notcontains":
			return !v.includes(q);
		case "is":
			return v === q;
		case "isnot":
			return v !== q;
		case "empty":
			return s.trim() === "";
		case "notempty":
			return s.trim() !== "";
		case "gt": {
			const a = parseNumber(s);
			const b = parseNumber(value);
			return a != null && b != null && a > b;
		}
		case "lt": {
			const a = parseNumber(s);
			const b = parseNumber(value);
			return a != null && b != null && a < b;
		}
		default:
			return true;
	}
}

/** Render a number as its "Show as" visual (bar, ring, stars, dots, or a
 *  traffic-light dot) into `host`, optionally with the formatted number beside
 *  it. `colMax` is the column's max, used when the format sets no explicit max.
 *  Shared by the table cells and the format dialog's live preview. */
function renderMeter(host: HTMLElement, n: number, colMax: number, nf: NumberFormat) {
	const hue = nf.color || "var(--interactive-accent)";
	const wrap = host.createDiv({ cls: "pb-meter" });
	const d = nf.display;
	if (d === "bar" || d === "ring") {
		const frac = meterFraction(n, nf.max ?? colMax);
		if (d === "ring") {
			const ring = wrap.createDiv({ cls: "pb-ring" });
			ring.style.setProperty("--pb-c", hue);
			ring.style.setProperty("--pb-f", frac.toFixed(3));
		} else {
			const fill = wrap.createDiv({ cls: "pb-bar-track" }).createDiv({ cls: "pb-bar-fill" });
			fill.style.width = (frac * 100).toFixed(1) + "%";
			fill.style.background = hue;
		}
	} else if (d === "stars" || d === "dots") {
		const count = nf.max ?? 5;
		const on = starCount(n, count);
		const box = wrap.createSpan({ cls: d === "stars" ? "pb-stars" : "pb-dots" });
		for (let i = 0; i < count; i++) {
			const pip = box.createSpan({ cls: "pb-pip" });
			pip.setText(d === "stars" ? (i < on ? "★" : "☆") : i < on ? "●" : "○");
			if (i < on) pip.style.color = hue;
		}
	} else if (d === "traffic") {
		const low = nf.low ?? colMax / 3;
		const high = nf.high ?? (colMax * 2) / 3;
		wrap.createSpan({ cls: "pb-traffic pb-traffic-" + trafficState(n, low, high) });
	}
	if (nf.showNumber !== false) wrap.createSpan({ cls: "pb-meter-num", text: formatNumberValue(n, nf) });
}

/** One pointer gesture for mouse and touch, shared by the calendar chips and
 *  timeline bars (the board carries its own older copy of the same pattern).
 *  Mouse: 6px of travel starts. Touch: a still 400ms hold arms it, an early
 *  swipe cancels so scrolling wins, hold-and-release fires onHoldTap. */
let gestureLock = false;

function attachPointerGesture(
	el: HTMLElement,
	opts: {
		ghostText?: string;
		onStart?: () => void;
		onMove: (dx: number, dy: number, x: number, y: number) => void;
		onDrop: (dx: number, dy: number, x: number, y: number) => void;
		onCancel: () => void;
		onHoldTap?: (x: number, y: number) => void;
		onClick?: (ev: MouseEvent) => void;
	}
) {
	let suppressClick = false;
	el.addEventListener(
		"click",
		(ce) => {
			if (suppressClick) {
				suppressClick = false;
				ce.stopPropagation();
				ce.preventDefault();
				return;
			}
			opts.onClick?.(ce);
		},
		{ capture: true }
	);
	el.addEventListener("pointerdown", (e: PointerEvent) => {
		if (e.button !== 0 || gestureLock) return;
		gestureLock = true;
		const touch = e.pointerType === "touch";
		const sx = e.clientX;
		const sy = e.clientY;
		let armed = !touch;
		let started = false;
		let ghost: HTMLElement | null = null;
		const holdTimer = touch
			? window.setTimeout(() => {
					armed = true;
					el.addClass("pb-lift");
				}, 400)
			: null;
		const blockTouch = (te: TouchEvent) => te.preventDefault();
		const blockCtx = (ce: Event) => {
			ce.preventDefault();
			ce.stopPropagation();
		};
		const start = () => {
			started = true;
			suppressClick = true;
			document.body.addClass("pb-dragging");
			document.addEventListener("touchmove", blockTouch, { passive: false });
			document.addEventListener("contextmenu", blockCtx, { capture: true });
			if (opts.ghostText) ghost = document.body.createDiv({ cls: "pb-ghost", text: opts.ghostText });
			opts.onStart?.();
		};
		const teardown = (cancelled: boolean) => {
			gestureLock = false;
			if (holdTimer != null) window.clearTimeout(holdTimer);
			document.removeEventListener("pointermove", onMove);
			document.removeEventListener("pointerup", onUp);
			document.removeEventListener("pointercancel", onPointerCancel);
			document.removeEventListener("keydown", onKey);
			document.removeEventListener("touchmove", blockTouch);
			document.removeEventListener("contextmenu", blockCtx, { capture: true });
			window.removeEventListener("blur", onBlur);
			document.body.removeClass("pb-dragging");
			el.removeClass("pb-lift");
			ghost?.remove();
			if (cancelled && started) opts.onCancel();
		};
		const onBlur = () => teardown(true);
		const onMove = (ev: PointerEvent) => {
			const dist = Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy);
			if (!started) {
				if (!armed) {
					if (touch && dist > 8) teardown(false); // the scroll wins
					return;
				}
				if (dist > 6) start();
				if (!started) return;
			}
			ev.preventDefault();
			if (ghost) {
				ghost.style.left = ev.clientX + 12 + "px";
				ghost.style.top = ev.clientY + 10 + "px";
			}
			opts.onMove(ev.clientX - sx, ev.clientY - sy, ev.clientX, ev.clientY);
		};
		const onUp = (ev: PointerEvent) => {
			const wasStarted = started;
			const holdTap = !started && armed && touch;
			teardown(false);
			if (wasStarted) {
				suppressClick = true;
				opts.onDrop(ev.clientX - sx, ev.clientY - sy, ev.clientX, ev.clientY);
			} else if (holdTap && opts.onHoldTap) {
				suppressClick = true;
				opts.onHoldTap(ev.clientX, ev.clientY);
			}
		};
		const onPointerCancel = () => teardown(true);
		const onKey = (ev: KeyboardEvent) => {
			if (ev.key === "Escape") teardown(true);
		};
		document.addEventListener("pointermove", onMove);
		document.addEventListener("pointerup", onUp);
		document.addEventListener("pointercancel", onPointerCancel);
		document.addEventListener("keydown", onKey);
		window.addEventListener("blur", onBlur);
	});
}

/** The Power family palette: stable category hues shared across the suite. */
const NAMED_PALETTE: [string, string][] = [
	["Blue", "#0063B1"],
	["Blue Mist", "#2D7D9A"],
	["Cyan", "#00B7C3"],
	["Teal", "#038387"],
	["Green", "#107C10"],
	["Apple", "#498205"],
	["Lemon Lime", "#8CBD18"],
	["Yellow", "#FFB900"],
	["Orange", "#F7630C"],
	["Red Chalk", "#DA3B01"],
	["Red", "#E81123"],
	["Magenta", "#E3008C"],
	["Purple", "#744DA9"],
	["Purple Mist", "#8E8CD8"],
	["Tan", "#986F0B"],
	["Silver", "#7A7574"],
];
const PALETTE = NAMED_PALETTE.map(([, hex]) => hex);

/** note.status -> status: the frontmatter key a note property writes to. */
const frontmatterKey = (prop: BasesPropertyId) => prop.split(".").slice(1).join(".");

const AGG_SYMBOL: Record<string, string> = { sum: "Σ", avg: "Avg", min: "Min", max: "Max", filled: "✓" };

/** A Power-Base field type assigned to a frontmatter key, plus the per-type
 *  extras (an ID prefix, a button's action, a verification's expiry source). */
interface PBFieldConfig {
	type: PBFieldType;
	/** id: text before the number, e.g. "TASK-". */
	prefix?: string;
	/** button: text on the button. */
	buttonLabel?: string;
	/** button: frontmatter written on click (values may use {today}/{now}). */
	buttonSets?: Record<string, string>;
	/** button: a URL to open, or note.<prop> to open a row property's URL. */
	buttonLink?: string;
	/** verification: frontmatter key holding an expiry date. */
	verifyExpiryProp?: string;
}

interface PowerBasesSettings {
	/** Chosen hues per frontmatter key per value; unset values hash into the palette. */
	valueColors: Record<string, Record<string, string>>;
	/** Field-type assignments, global by frontmatter key (Obsidian's own model). */
	fields: Record<string, PBFieldConfig>;
	/** Number formats, global by property id (note.x or formula.y). */
	formats: Record<string, NumberFormat>;
	/** Date formats, global by property id (note.x, formula.y, file.mtime, ...). */
	dateFormats: Record<string, DateFormat>;
	/** Phone display styles, global by property id (note.x), for Phone columns. */
	phoneFormats: Record<string, PhoneFormat>;
	/** Editor kind chosen when a column was added, by frontmatter key, so a
	 *  fresh empty column (e.g. a checkbox) renders right before any value. */
	kinds: Record<string, CellKind>;
	/** Suggest addresses in Place cells via OpenStreetMap. Sends the typed text
	 *  to Nominatim as you type; off keeps Place fully offline (free text + map link). */
	placeAutocomplete: boolean;
	/** Where embed-created .base files land; "" = the attachment location. */
	basesFolder: string;
	/** Who this vault's edits belong to, for the created/edited stamps. */
	myName: string;
	/** Stamp edited/edited-by on rows Power views change, and created/created-by
	 *  on pages they create. Off by default; needs myName to do anything. */
	stampEdits: boolean;
}

const DEFAULT_SETTINGS: PowerBasesSettings = {
	valueColors: {},
	fields: {},
	formats: {},
	dateFormats: {},
	phoneFormats: {},
	kinds: {},
	placeAutocomplete: true,
	basesFolder: "",
	myName: "",
	stampEdits: false,
};

/** Settings tab: manage the hand-picked value colors (the only persisted
 *  state), so a base does not have to be open to reset one. */
/** One row of the settings tab. `build` is handed a Setting whose name and
 *  description are already set, so it only adds the controls. Rows are data
 *  rather than drawing code so the two renderers cannot disagree about what
 *  the tab holds. */
type Row = { name: string; desc?: string; help?: string; aliases?: string[]; build?: (st: Setting) => void | (() => void) };

/** A run of rows under one heading. A tab with more than one becomes a page
 *  of headed groups on 1.13, and one section div each in the fallback. */
type Group = { heading?: string; rows: Row[] };

/** One tab: a native settings page on Obsidian 1.13 and up, a tab button in
 *  the fallback renderer for older builds. */
type Page = { id: string; label: string; groups: Group[] };

class PowerBasesSettingTab extends PluginSettingTab {
	/** Both survive the re-render a color reset triggers, so the tab and search
	 *  box do not jump back to the top. */
	private activeTab = "general";
	private query = "";
	private helpEl: HTMLElement | null = null;
	private helpAnchor: HTMLElement | null = null;
	private helpPinned = false;
	private helpCleanup: (() => void) | null = null;

	constructor(private plugin: PowerBasesPlugin) {
		super(plugin.app, plugin);
	}

	hide() {
		this.closeHelp();
	}

	private closeHelp() {
		this.helpCleanup?.();
		this.helpCleanup = null;
		this.helpEl?.remove();
		this.helpEl = null;
		this.helpAnchor = null;
		this.helpPinned = false;
	}

	/** A soft theme-colored help card, not the native black tooltip: opens on
	 *  hover, a click pins it, Esc or a click away or a scroll closes it. */
	private openHelp(icon: HTMLElement, text: string, pin: boolean) {
		if (this.helpAnchor === icon && this.helpEl) {
			if (pin) this.helpPinned = true;
			return;
		}
		this.closeHelp();
		const el = document.body.createDiv({ cls: "pb-help-pop", text });
		this.helpEl = el;
		this.helpAnchor = icon;
		this.helpPinned = pin;
		const r = icon.getBoundingClientRect();
		el.style.left = Math.max(8, Math.min(r.left - 12, window.innerWidth - el.offsetWidth - 8)) + "px";
		const below = r.bottom + 8;
		el.style.top = (below + el.offsetHeight > window.innerHeight - 8 ? r.top - el.offsetHeight - 8 : below) + "px";
		const onDown = (e: MouseEvent) => {
			if (e.target instanceof Node && (el.contains(e.target) || icon.contains(e.target))) return;
			this.closeHelp();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") this.closeHelp();
		};
		const onScroll = () => this.closeHelp();
		document.addEventListener("pointerdown", onDown, true);
		document.addEventListener("keydown", onKey, true);
		document.addEventListener("scroll", onScroll, true);
		this.helpCleanup = () => {
			document.removeEventListener("pointerdown", onDown, true);
			document.removeEventListener("keydown", onKey, true);
			document.removeEventListener("scroll", onScroll, true);
		};
	}

	/** Redraw when the rows themselves change, which resetting a value color
	 *  does. Obsidian 1.13 rebuilds the tab from getSettingDefinitions(); older
	 *  builds have only the fallback renderer. */
	private refresh() {
		this.closeHelp(); // whatever the popover is anchored to is about to go
		// update() arrived with the declarative API in 1.13 and minAppVersion is
		// still 1.10.2, so it is reached through a cast rather than named
		// outright: an older build has no definitions to rebuild from.
		const tab = this as unknown as { update?: () => void };
		if (tab.update) tab.update();
		else this.renderFallback();
	}

	/** A small help icon after the name; no aria-label, or Obsidian's native
	 *  black tooltip doubles up with the popover. */
	private addHelp(st: Setting, text: string) {
		const ic = st.nameEl.createSpan({ cls: "pb-setting-help" });
		setIcon(ic, "help-circle");
		ic.addEventListener("mouseenter", () => this.openHelp(ic, text, false));
		ic.addEventListener("mouseleave", () => {
			if (!this.helpPinned && this.helpAnchor === ic) this.closeHelp();
		});
		ic.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (this.helpPinned && this.helpAnchor === ic) this.closeHelp();
			else this.openHelp(ic, text, true);
		});
	}

	/** Obsidian 1.13 and up builds the tab from these and never calls display():
	 *  one native page per tab, standing in for the tab bar the fallback draws
	 *  for older builds. A tab holding more than one section becomes a page of
	 *  headed groups, which is what the headings were doing by hand.
	 *
	 *  Every row renders itself rather than declaring a `control`. A declarative
	 *  control writes through Obsidian's generic setControlValue, which would
	 *  bypass persistSettings and overwrite whatever another device changed. */
	getSettingDefinitions(): SettingDefinitionItem[] {
		const pages = this.buildPages();
		const rowsOf = new Map(pages.map((p) => [p.label, p.groups.flatMap((g) => g.rows)] as const));
		return [
			{
				name: "",
				searchable: false, // it is a masthead, not a setting
				render: (st) => {
					st.settingEl.empty();
					this.renderAbout(st.settingEl);
				},
			},
			{
				type: "group",
				search: {
					placeholder: "Search settings...",
					// the entries here are whole tabs, so a tab stays up when anything
					// inside it matches. Obsidian's own search box, top left, reaches
					// the individual settings.
					match: (def, query) => {
						const q = query.trim().toLowerCase();
						if (!q) return true;
						const has = (v: string | undefined) => (v ?? "").toLowerCase().includes(q);
						return (rowsOf.get(def.name) ?? []).some(
							(r) => has(r.name) || has(r.desc) || (r.aliases ?? []).some(has)
						);
					},
				},
				items: pages.map(
					(p): SettingDefinitionPage => ({
						type: "page",
						name: p.label,
						// a lone unnamed section is the page itself, so it stays flat
						items:
							p.groups.length === 1 && !p.groups[0].heading
								? p.groups[0].rows.map((r) => this.toDefinition(r, p.label))
								: p.groups.map((g) => ({
										type: "group" as const,
										heading: g.heading,
										items: g.rows.map((r) => this.toDefinition(r, p.label)),
									})),
					})
				),
			},
		];
	}

	/** One row as a definition Obsidian can draw. The name and description are
	 *  its to render and it rebuilds both on a redraw, so a row only hands back
	 *  what it hung on the row element itself. */
	private toDefinition(r: Row, page: string): SettingDefinitionRender {
		return {
			name: r.name,
			desc: r.desc,
			// searching the tab name still finds its rows, the way a heading match
			// opened the whole section in the tab bar
			aliases: [...(r.aliases ?? []), page],
			render: (st) => {
				const teardown = r.build?.(st);
				if (r.help) this.addHelp(st, r.help);
				return teardown;
			},
		};
	}

	/** What this plugin is and which build is running, above the section list.
	 *  Read off the manifest so it cannot drift from the released version. */
	private renderAbout(el: HTMLElement) {
		el.addClass("pb-about");
		const head = el.createDiv({ cls: "pb-about-head" });
		head.createSpan({ cls: "pb-about-name", text: this.plugin.manifest.name });
		head.createSpan({ cls: "pb-about-version", text: "v" + this.plugin.manifest.version });
		el.createDiv({ cls: "pb-about-desc", text: this.plugin.manifest.description });
	}

	/** The pre-1.13 renderer: every section on one page, with a tab bar and a
	 *  search box of our own because there was no declarative API to hand the
	 *  work to. Obsidian 1.13 and up ignores this and renders the definitions
	 *  above instead, so the two only ever differ in how they draw, never in
	 *  what they draw. */
	display() {
		this.renderFallback();
	}

	private renderFallback() {
		const root = this.containerEl;
		root.empty();
		this.closeHelp(); // a re-render orphans any popover anchored to the old DOM

		const pages = this.buildPages();
		if (!pages.some((p) => p.id === this.activeTab)) this.activeTab = pages[0].id;

		// the same masthead the declarative tab shows, minus the setting-item
		// wrapper it gets there
		this.renderAbout(root.createDiv({ cls: "pb-about-standalone" }));

		const searchWrap = root.createDiv({ cls: "pb-settings-search" });
		const searchInput = searchWrap.createEl("input", { cls: "pb-settings-search-input" });
		searchInput.type = "search";
		searchInput.placeholder = "Search settings...";
		searchInput.value = this.query;

		const tabBar = root.createDiv({ cls: "pb-settings-tabs" });
		const body = root.createDiv({ cls: "pb-settings-body" });

		// one section div per group, tagged with its tab so the tab bar and the
		// search box below can show and hide whole sections at a time
		for (const p of pages) {
			for (const g of p.groups) {
				const sec = body.createDiv({ cls: "pb-settings-section" });
				sec.dataset.tab = p.id;
				sec.dataset.name = (g.heading ?? p.label).toLowerCase();
				new Setting(sec).setName(g.heading ?? p.label).setHeading();
				// name and description first, then the row's own content: the same
				// order Obsidian applies a definition in, so a row that appends to
				// either element lands in the same place under both renderers
				for (const r of g.rows) {
					const st = new Setting(sec).setName(r.name);
					if (r.desc) st.setDesc(r.desc);
					if (r.aliases?.length) st.settingEl.dataset.pbAlias = r.aliases.join(" ").toLowerCase();
					r.build?.(st);
					if (r.help) this.addHelp(st, r.help);
				}
			}
		}

		const setVisible = (el: HTMLElement, v: boolean) => (el.style.display = v ? "" : "none");
		const applyView = () => {
			const q = this.query.trim().toLowerCase();
			setVisible(tabBar, !q);
			for (const sec of Array.from(body.children) as HTMLElement[]) {
				const items = Array.from(sec.querySelectorAll<HTMLElement>(":scope > .setting-item:not(.setting-item-heading)"));
				if (!q) {
					for (const it of items) setVisible(it, true);
					setVisible(sec, sec.dataset.tab === this.activeTab);
					continue;
				}
				const nameHit = (sec.dataset.name ?? "").includes(q);
				let anyHit = false;
				for (const it of items) {
					const name = it.querySelector(".setting-item-name")?.textContent?.toLowerCase() ?? "";
					const desc = it.querySelector(".setting-item-description")?.textContent?.toLowerCase() ?? "";
					const hit = nameHit || name.includes(q) || desc.includes(q) || (it.dataset.pbAlias ?? "").includes(q);
					setVisible(it, hit);
					if (hit) anyHit = true;
				}
				setVisible(sec, anyHit);
			}
		};

		for (const p of pages) {
			const btn = tabBar.createEl("button", { text: p.label, cls: "pb-settings-tab" });
			btn.toggleClass("is-active", p.id === this.activeTab);
			btn.onclick = () => {
				if (this.activeTab === p.id) return;
				this.activeTab = p.id;
				for (const other of Array.from(tabBar.children) as HTMLElement[]) other.toggleClass("is-active", other === btn);
				applyView();
			};
		}
		searchInput.addEventListener("input", () => {
			this.query = searchInput.value;
			applyView();
		});
		applyView();
	}

	/** Every row of the settings tab, in order, as plain data: the one source
	 *  both renderers draw from, so they cannot drift apart. Built fresh on each
	 *  render because the color list is live state. */
	private buildPages(): Page[] {
		const s = this.plugin.settings;
		// through persistSettings, never saveData: a whole-object write reverts
		// whatever another device changed since this one loaded
		const save = () => void this.plugin.persistSettings();

		const newBases: Row[] = [
			{
				name: "Folder for embedded bases",
				desc: "Where /base drops the .base file inside a note.",
				help: "Empty uses your Obsidian attachment location. Point it at a folder like _resources/bases to keep embedded bases out of the way. Bases created from a folder's right-click menu ignore this and stay in the folder you clicked.",
				build: (st) => {
					st.addText((t) =>
						t.setPlaceholder("attachment location").setValue(s.basesFolder).onChange((v) => {
							s.basesFolder = v;
							save();
						})
					);
				},
			},
		];

		const identity: Row[] = [
			{
				name: "Your name",
				desc: "Who this vault's edits belong to.",
				help: "Written into created-by and edited-by when the stamp below is on. On a shared or synced vault, this is how a row records who touched it.",
				build: (st) => {
					st.addText((t) =>
						t.setPlaceholder("Your name or initials").setValue(s.myName).onChange((v) => {
							s.myName = v;
							save();
						})
					);
				},
			},
			{
				name: "Stamp changes with your name",
				desc: "Record created and edited, and by whom, on rows.",
				help: "Every change through a Power view writes edited and edited-by onto the row; rows Power Bases creates (a lane's + New page, calendar double-clicks, CSV rows, templates) also get created and created-by. Add those as columns for Notion's Created by and Last edited by. Edits made outside Power Bases are not tracked, and the stamps ride the same undo as the change.",
				build: (st) => {
					st.addToggle((t) =>
						t.setValue(s.stampEdits).onChange((v) => {
							s.stampEdits = v;
							save();
						})
					);
				},
			},
		];

		const placeFields: Row[] = [
			{
				name: "Address autocomplete",
				desc: "Suggest addresses in Place cells, using OpenStreetMap.",
				help: "As you type in a Place cell, this sends the text to OpenStreetMap (Nominatim) to suggest real addresses. Turn it off to keep Place fully offline: free text plus a Google Maps link. The address is stored as plain text either way.",
				build: (st) => {
					st.addToggle((t) =>
						t.setValue(s.placeAutocomplete).onChange((v) => {
							s.placeAutocomplete = v;
							save();
						})
					);
				},
			},
		];

		// One group per frontmatter key, so each key's values sit under its own
		// heading the way the hand-drawn h4 used to put them.
		// The whole colour list is one row that draws its own container, so it is
		// rebuilt every time the tab is rendered. As separate definitions it would
		// only be rebuilt by update(): reopening a tab renders from the cached
		// definitions, so a colour picked from a lane header while settings were
		// shut would not show up until something else refreshed the tab.
		const colorGroups: Group[] = [
			{
				rows: [
					{
						name: "",
						aliases: ["value colors", "clear all value colors"],
						build: (st) => {
							const host = st.settingEl;
							host.empty();
							host.addClass("pb-colors-host");
							const keys = Object.keys(s.valueColors);
							if (!keys.length) {
								host.createEl("p", {
									cls: "pb-modal-desc",
									text: "None yet. Right-click a board lane header or a colored table cell to pick a color; your choices are shared across every view and listed here.",
								});
								return;
							}
							for (const fmKey of keys.sort()) {
								new Setting(host).setName(fmKey).setHeading();
								for (const [value, hex] of Object.entries(s.valueColors[fmKey])) {
									const row = new Setting(host).setName(value);
									const dot = row.nameEl.createSpan({ cls: "pb-set-dot" });
									dot.style.background = hex;
									row.nameEl.prepend(dot);
									row.addButton((b) =>
										b
											.setIcon("rotate-ccw")
											.setTooltip("Reset to automatic")
											.onClick(async () => {
												await this.plugin.setValueColor(fmKey, value, null);
												this.plugin.repaintAll();
												this.refresh();
											})
									);
								}
							}
							const clear = new Setting(host).setName("Clear all value colors");
							this.addHelp(clear, "Forget every hand-picked value color across the whole vault; values fall back to their automatic hashed hues. Cannot be undone.");
							clear.addButton((b) =>
								markDestructive(b)
									.setButtonText("Clear all")
									.onClick(() => {
										s.valueColors = {};
										save();
										this.plugin.repaintAll();
										this.refresh();
									})
							);
						},
					},
				],
			},
		];
		return [
			{
				id: "general",
				label: "General",
				groups: [
					{ heading: "New bases", rows: newBases },
					{ heading: "Identity", rows: identity },
				],
			},
			{ id: "fields", label: "Fields", groups: [{ heading: "Place fields", rows: placeFields }] },
			{ id: "colors", label: "Colors", groups: colorGroups },
		];
	}
}

/** The 16 hues plus Automatic, for a lane header or a colored cell value. */
function fillValueColorMenu(menu: Menu, plugin: PowerBasesPlugin, fmKey: string, value: string, onDone: () => void) {
	const current = plugin.settings.valueColors[fmKey]?.[value] ?? null;
	for (const [name, hex] of NAMED_PALETTE) {
		menu.addItem((item) => {
			const title = createFragment((frag) => {
				const dot = frag.createSpan();
				dot.setText("● ");
				dot.style.color = hex;
				frag.appendText(name + (current === hex ? " ✓" : ""));
			});
			item.setTitle(title).onClick(async () => {
				await plugin.setValueColor(fmKey, value, hex);
				onDone();
			});
		});
	}
	menu.addItem((item) =>
		item
			.setTitle("Automatic" + (current == null ? " ✓" : ""))
			.setIcon("rotate-ccw")
			.onClick(async () => {
				await plugin.setValueColor(fmKey, value, null);
				onDone();
			})
	);
}

export default class PowerBasesPlugin extends Plugin {
	settings: PowerBasesSettings = DEFAULT_SETTINGS;
	/** The settings as they last stood on disk, read or written by us. Whatever
	 *  differs from this in memory is OUR change, and only those keys may
	 *  overwrite a synced data.json; see persistSettings(). */
	private baseline: PowerBasesSettings = DEFAULT_SETTINGS;
	/** Every mounted Power Bases view, so a settings change can repaint them. */
	readonly liveViews = new Set<PBView>();
	/** The last view the user touched, for copy/paste of view config. */
	lastActiveView: PBView | null = null;
	/** Copied view config, kept in memory across bases within the session. */
	private configClip: { type: string; values: Record<string, unknown> } | null = null;

	/** The option keys that define a view's look, per type. Table and board
	 *  include per-column keys derived from the visible order. */
	private viewConfigKeys(view: PBView): string[] {
		const order = view.config.getOrder();
		switch (view.type) {
			case "powerbases-board":
				return ["pbGroup", "pbRows", "rankProp", "showEmpty", "pbAggProp", "pbAggOp", "cardProps", "pb-colOrder", "pb-rules", "pb-wip", "pb-templates"];
			case "powerbases-table":
				return [
					"pbRankProp",
					"pbRank",
					...order.flatMap((p) => ["agg:" + p, "color:" + p]),
					...[1, 2, 3].flatMap((n) => [`ru${n}:link`, `ru${n}:target`, `ru${n}:op`, `ru${n}:dir`]),
				];
			case "powerbases-calendar":
				return ["dateProp", "calMode", "weekStart"];
			case "powerbases-timeline":
				return ["startProp", "endProp", "colorProp", "milestoneProp", "progressProp", "depProp", "zoom"];
			case "powerbases-chart":
				return ["chartType", "groupProp", "chartAgg", "valueProp", "sortValue"];
			case "powerbases-gallery":
				return ["imageProp", "cardSize", "fitCover"];
			default:
				return [];
		}
	}

	copyViewConfig() {
		const v = this.lastActiveView;
		if (!v || !this.liveViews.has(v)) {
			new Notice("Power Bases: click a Power view first, then copy its setup.");
			return;
		}
		const values: Record<string, unknown> = {};
		for (const k of this.viewConfigKeys(v)) {
			const val = v.config.get(k);
			if (val !== undefined && val !== null) values[k] = val;
		}
		this.configClip = { type: v.type, values };
		new Notice(`Power Bases: copied this ${v.config.name || "view"} setup. Open another and paste.`);
	}

	pasteViewConfig() {
		const v = this.lastActiveView;
		if (!v || !this.liveViews.has(v)) {
			new Notice("Power Bases: click the Power view to paste into first.");
			return;
		}
		if (!this.configClip) {
			new Notice("Power Bases: nothing copied yet.");
			return;
		}
		if (this.configClip.type !== v.type) {
			new Notice("Power Bases: that setup was copied from a different view type.");
			return;
		}
		const keys = new Set(this.viewConfigKeys(v));
		for (const k of keys) v.config.set(k, (this.configClip.values[k] as never) ?? null);
		v.onDataUpdated();
		new Notice("Power Bases: setup pasted.");
	}

	/** Repaint every open Power Bases view (after a value-color change). */
	repaintAll() {
		for (const v of this.liveViews) {
			try {
				v.onDataUpdated();
			} catch {
				/* a view mid-teardown is fine to skip */
			}
		}
	}

	/** The hue for a value: the user's chosen color when one is stored for
	 *  this frontmatter key, else a stable hash into the palette. */
	hueFor(fmKey: string | null, value: string): string {
		if (fmKey) {
			const chosen = this.settings.valueColors[fmKey]?.[value];
			if (chosen) return chosen;
		}
		return PALETTE[colorIndex(value, PALETTE.length)];
	}

	async setValueColor(fmKey: string, value: string, hex: string | null) {
		const m = this.settings.valueColors;
		if (hex) (m[fmKey] ??= {})[value] = hex;
		else if (m[fmKey]) {
			delete m[fmKey][value];
			if (!Object.keys(m[fmKey]).length) delete m[fmKey];
		}
		await this.persistSettings();
	}

	/* ----- Power-Base field types (global by frontmatter key) ----- */

	fieldType(fmKey: string): PBFieldType | null {
		return this.settings.fields[fmKey]?.type ?? null;
	}

	fieldConfig(fmKey: string): PBFieldConfig | null {
		return this.settings.fields[fmKey] ?? null;
	}

	async setFieldType(fmKey: string, type: PBFieldType | null) {
		if (type) {
			const cur = this.settings.fields[fmKey];
			this.settings.fields[fmKey] = cur ? { ...cur, type } : { type };
		} else {
			delete this.settings.fields[fmKey];
		}
		await this.persistSettings();
		this.refreshAll();
	}

	async saveFieldConfig(fmKey: string, cfg: PBFieldConfig) {
		this.settings.fields[fmKey] = cfg;
		await this.persistSettings();
		this.refreshAll();
	}

	/* ----- number + date formats (global by property id) ----- */

	numberFormat(propId: string): NumberFormat | null {
		return this.settings.formats[propId] ?? null;
	}

	dateFormat(propId: string): DateFormat | null {
		return this.settings.dateFormats[propId] ?? null;
	}

	phoneFormat(propId: string): PhoneFormat | null {
		return this.settings.phoneFormats[propId] ?? null;
	}

	/** Apply (or clear) one number format across a set of columns, as one save. */
	async applyNumberFormat(propIds: string[], fmt: NumberFormat | null) {
		for (const id of propIds) {
			if (fmt && hasNumberFormat(fmt)) this.settings.formats[id] = fmt;
			else delete this.settings.formats[id];
		}
		await this.persistSettings();
		this.refreshAll();
	}

	/** Apply (or clear) one date format across a set of columns, as one save. */
	async applyDateFormat(propIds: string[], fmt: DateFormat | null) {
		for (const id of propIds) {
			if (fmt && hasDateFormat(fmt)) this.settings.dateFormats[id] = fmt;
			else delete this.settings.dateFormats[id];
		}
		await this.persistSettings();
		this.refreshAll();
	}

	/** Apply (or clear) one phone display style across a set of columns, as one save. */
	async applyPhoneFormat(propIds: string[], fmt: PhoneFormat | null) {
		for (const id of propIds) {
			if (fmt && hasPhoneFormat(fmt)) this.settings.phoneFormats[id] = fmt;
			else delete this.settings.phoneFormats[id];
		}
		await this.persistSettings();
		this.refreshAll();
	}

	/** Carry a column's saved state (field type, formats, value colors) over to
	 *  its new name when a column is renamed. */
	async renameSettings(oldName: string, newName: string, oldId: string, newId: string) {
		const move = <T>(m: Record<string, T>, a: string, b: string) => {
			if (m[a] !== undefined) {
				m[b] = m[a];
				delete m[a];
			}
		};
		move(this.settings.fields, oldName, newName);
		move(this.settings.valueColors, oldName, newName);
		move(this.settings.kinds, oldName, newName);
		move(this.settings.formats, oldId, newId);
		move(this.settings.dateFormats, oldId, newId);
		move(this.settings.phoneFormats, oldId, newId);
		await this.persistSettings();
	}

	/** Repaint every open Power view (after a type or config change). */
	refreshAll() {
		for (const v of this.liveViews) v.onDataUpdated();
	}

	/** The editor kind chosen when a column was added (Power-Base's own record,
	 *  so it works even when Obsidian's undocumented type registry does not). */
	storedKind(fmKey: string): CellKind | null {
		return this.settings.kinds[fmKey] ?? null;
	}

	async setStoredKind(fmKey: string, kind: CellKind | null) {
		if (kind) this.settings.kinds[fmKey] = kind;
		else delete this.settings.kinds[fmKey];
		await this.persistSettings();
	}

	/** Obsidian's assigned property type, when the (undocumented) registry is
	 *  around; used only when a note lacks the property so raw inference fails. */
	assignedKind(fmKey: string): CellKind | null {
		const mtm = (this.app as unknown as { metadataTypeManager?: { getAssignedType?: (name: string) => string | null } })
			.metadataTypeManager;
		const t = mtm?.getAssignedType?.(fmKey);
		if (t === "number") return "number";
		if (t === "checkbox") return "checkbox";
		if (t === "date") return "date";
		if (t === "datetime") return "datetime";
		if (t === "multitext" || t === "tags" || t === "aliases") return "list";
		return t ? "text" : null;
	}

	async loadSettings() {
		const saved = (await this.loadData()) as Partial<PowerBasesSettings> | null;
		const next: PowerBasesSettings = Object.assign({}, DEFAULT_SETTINGS, saved);
		// merged in place, never swapped: the settings tab captures this object
		// once (`const s = plugin.settings`) and writes through that reference,
		// so adopting a synced write must not strand it on an orphan. The field
		// starts as DEFAULT_SETTINGS itself, which must never be mutated.
		if (this.settings && this.settings !== DEFAULT_SETTINGS) Object.assign(this.settings, next);
		else this.settings = next;
		this.baseline = structuredClone(this.settings);
	}

	/**
	 * The one write path, and it merges rather than overwrites.
	 *
	 * data.json is synced, so this file belongs to every device at once. Writing
	 * memory wholesale reverts whatever another device changed since this one last
	 * read it, and a setting nothing rewrites afterwards never comes back from
	 * that. Re-read, and carry only what WE changed.
	 *
	 * Every settings write goes through here. Eleven of them wrote the whole
	 * object straight out before, the most of any of these plugins, which is
	 * eleven chances to revert another device. Three outlived the first sweep
	 * (the settings tab, CSV import, and template generate), so if you are
	 * adding a write: grep saveData( before believing this line.
	 */
	async persistSettings() {
		const disk = (await this.loadData()) as Partial<PowerBasesSettings> | null;
		// in place, for the reason given in loadSettings
		Object.assign(this.settings, mergeForSave(this.settings, this.baseline, disk));
		await this.saveData(this.settings);
		this.baseline = structuredClone(this.settings);
	}

	/** Obsidian calls this when Sync lands another device's write. Adopting it
	 *  keeps this device from holding a stale snapshot it would later write back. */
	async onExternalSettingsChange() {
		await this.loadSettings();
	}

	async onload() {
		await this.loadSettings();
		// hover previews on cards, chips, and name cells (Page preview plugin)
		const ws = this.app.workspace as unknown as {
			registerHoverLinkSource?: (id: string, info: { display: string; defaultMod: boolean }) => void;
			unregisterHoverLinkSource?: (id: string) => void;
		};
		ws.registerHoverLinkSource?.("powerbases", { display: "Power Bases", defaultMod: true });
		this.register(() => ws.unregisterHoverLinkSource?.("powerbases"));
		// Bases views arrived in 1.10; on older builds the method is absent and
		// the plugin degrades to a notice instead of a load error.
		if (typeof (this as unknown as { registerBasesView?: unknown }).registerBasesView !== "function") {
			new Notice("Power Bases needs Obsidian 1.10 or newer (the Bases views API).", 10000);
			return;
		}
		const results = [
			this.registerBasesView("powerbases-board", {
				name: "Power Board",
				icon: "square-kanban",
				factory: (controller, containerEl) => new PowerBoardView(this, controller, containerEl),
				options: (): BasesAllOptions[] => [
					{
						// NOT "groupBy": that key is reserved in Bases view entries
						// (the built-in grouping object) and a string there makes
						// the whole .base file unparseable
						type: "property",
						key: "pbGroup",
						displayName: "Group by",
						filter: (p: BasesPropertyId) => p.startsWith("note."),
					},
					{
						type: "property",
						key: "pbRows",
						displayName: "Swimlane rows (optional)",
						filter: (p: BasesPropertyId) => p.startsWith("note."),
					},
					{
						type: "property",
						key: "rankProp",
						displayName: "Manual order property",
						filter: (p: BasesPropertyId) => p.startsWith("note."),
					},
					{ type: "toggle", key: "showEmpty", displayName: "Show a lane for missing values", default: true },
					{
						type: "property",
						key: "pbAggProp",
						displayName: "Lane totals property (optional)",
						filter: (p: BasesPropertyId) => p.startsWith("note."),
					},
					{
						type: "dropdown",
						key: "pbAggOp",
						displayName: "Lane totals aggregate",
						default: "sum",
						options: { sum: "Sum", avg: "Average", min: "Min", max: "Max", filled: "Filled" },
					},
					{
						type: "dropdown",
						key: "cardProps",
						displayName: "Properties per card",
						default: "3",
						options: { "0": "None", "1": "1", "2": "2", "3": "3", "4": "4", "6": "6" },
					},
				],
			}),
			this.registerBasesView("powerbases-calendar", {
				name: "Calendar",
				icon: "calendar-days",
				factory: (controller, containerEl) => new PowerCalendarView(this, controller, containerEl),
				options: (): BasesAllOptions[] => [
					{
						type: "property",
						key: "dateProp",
						displayName: "Date property",
						filter: (p: BasesPropertyId) => p.startsWith("note."),
					},
					{
						type: "dropdown",
						key: "calMode",
						displayName: "Show",
						default: "month",
						options: { month: "Month", week: "Week" },
					},
					{
						type: "dropdown",
						key: "weekStart",
						displayName: "Week starts on",
						default: "monday",
						options: { monday: "Monday", sunday: "Sunday" },
					},
				],
			}),
			this.registerBasesView("powerbases-table", {
				name: "Power Table",
				icon: "sigma",
				factory: (controller, containerEl) => new PowerTableView(this, controller, containerEl),
				options: (config: BasesViewConfig): BasesAllOptions[] => {
					const per = (prefix: string, opts: Record<string, string>) =>
						config.getOrder().map((p) => ({
							type: "dropdown" as const,
							key: prefix + p,
							displayName: config.getDisplayName(p),
							default: "none",
							options: opts,
						}));
					const rollupSlot = (n: number) => ({
						type: "group" as const,
						displayName: "Rollup " + n,
						items: [
							{
								type: "property" as const,
								key: `ru${n}:link`,
								displayName: "Link property",
								filter: (p: BasesPropertyId) => p.startsWith("note."),
							},
							{
								type: "property" as const,
								key: `ru${n}:target`,
								displayName: "Property on linked notes",
								filter: (p: BasesPropertyId) => p.startsWith("note."),
							},
							{
								type: "dropdown" as const,
								key: `ru${n}:op`,
								displayName: "Aggregate",
								default: "count",
								options: {
									count: "Count links",
									sum: "Sum",
									avg: "Average",
									min: "Min",
									max: "Max",
									filled: "Filled",
									list: "List values",
								} as Record<string, string>,
							},
							{
								type: "dropdown" as const,
								key: `ru${n}:dir`,
								displayName: "Direction",
								default: "from",
								options: { from: "Links on this page", to: "Pages linking here" } as Record<string, string>,
							},
						],
					});
					return [
						{
							type: "property" as const,
							key: "pbRankProp",
							displayName: "Manual order property",
							filter: (p: BasesPropertyId) => p.startsWith("note."),
						},
						{
							type: "group" as const,
							displayName: "Summary row",
							items: per("agg:", {
								none: "None",
								sum: "Sum",
								avg: "Average",
								min: "Min",
								max: "Max",
								filled: "Filled",
								empty: "Empty",
							}),
						},
						{
							type: "group" as const,
							displayName: "Column colors",
							items: per("color:", { none: "None", value: "By value", scale: "Number scale" }),
						},
						rollupSlot(1),
						rollupSlot(2),
						rollupSlot(3),
					];
				},
			}),
			this.registerBasesView("powerbases-timeline", {
				name: "Power Timeline",
				icon: "calendar-range",
				factory: (controller, containerEl) => new PowerTimelineView(this, controller, containerEl),
				options: (): BasesAllOptions[] => [
					{
						type: "property",
						key: "startProp",
						displayName: "Start date property",
						filter: (p: BasesPropertyId) => p.startsWith("note."),
					},
					{
						type: "property",
						key: "endProp",
						displayName: "End date property (optional)",
						filter: (p: BasesPropertyId) => p.startsWith("note."),
					},
					{
						type: "property",
						key: "colorProp",
						displayName: "Color bars by (optional)",
						filter: (p: BasesPropertyId) => p.startsWith("note."),
					},
					{
						type: "property",
						key: "milestoneProp",
						displayName: "Milestone property (optional)",
						filter: (p: BasesPropertyId) => p.startsWith("note."),
					},
					{
						type: "property",
						key: "progressProp",
						displayName: "Progress property (optional)",
						filter: (p: BasesPropertyId) => p.startsWith("note."),
					},
					{
						type: "property",
						key: "depProp",
						displayName: "Depends-on property (optional)",
						filter: (p: BasesPropertyId) => p.startsWith("note."),
					},
					{
						type: "dropdown",
						key: "zoom",
						displayName: "Zoom",
						default: "week",
						options: { day: "Days", week: "Weeks", month: "Months" },
					},
				],
			}),
			this.registerBasesView("powerbases-chart", {
				name: "Power Chart",
				icon: "chart-column",
				factory: (controller, containerEl) => new PowerChartView(this, controller, containerEl),
				options: (): BasesAllOptions[] => [
					{
						type: "dropdown",
						key: "chartType",
						displayName: "Chart",
						default: "bar",
						options: { bar: "Bar", line: "Line", donut: "Donut" },
					},
					{
						type: "property",
						key: "groupProp",
						displayName: "Group by",
						filter: (p: BasesPropertyId) => p.startsWith("note.") || p === "file.name",
					},
					{
						type: "dropdown",
						key: "chartAgg",
						displayName: "Measure",
						default: "count",
						options: { count: "Count", sum: "Sum", avg: "Average", min: "Min", max: "Max" },
					},
					{
						type: "property",
						key: "valueProp",
						displayName: "Measure property (for sum/avg/...)",
						filter: (p: BasesPropertyId) => p.startsWith("note."),
					},
					{ type: "toggle", key: "sortValue", displayName: "Sort bars by value", default: false },
				],
			}),
			this.registerBasesView("powerbases-gallery", {
				name: "Power Gallery",
				icon: "layout-grid",
				factory: (controller, containerEl) => new PowerGalleryView(this, controller, containerEl),
				options: (): BasesAllOptions[] => [
					{
						type: "property",
						key: "imageProp",
						displayName: "Image property (optional)",
						filter: (p: BasesPropertyId) => p.startsWith("note."),
					},
					{
						type: "dropdown",
						key: "cardSize",
						displayName: "Card size",
						default: "medium",
						options: { small: "Small", medium: "Medium", large: "Large" },
					},
					{ type: "toggle", key: "fitCover", displayName: "Crop covers to fill", default: true },
				],
			}),
		];
		if (results.some((ok) => !ok)) {
			new Notice("Power Bases: turn on the Bases core plugin to use the new views.", 10000);
		}

		this.addCommand({
			id: "undo-last-change", icon: "undo-2",
			name: "Undo last change",
			callback: () => void this.undoLast(),
		});
		this.addCommand({
			id: "new-base-here", icon: "database",
			name: "New Power base for the current note's folder",
			callback: () => {
				const f = this.app.workspace.getActiveFile();
				void this.createStarterBase(f?.parent ?? this.app.vault.getRoot());
			},
		});
		this.addCommand({
			id: "new-blank-base-here", icon: "database",
			name: "New blank base for the current note's folder",
			callback: () => {
				const f = this.app.workspace.getActiveFile();
				void this.createBlankBase(f?.parent ?? this.app.vault.getRoot());
			},
		});
		this.addCommand({
			id: "insert-base-embed", icon: "table",
			name: "Insert new base here (embed)",
			editorCallback: (editor) => void this.insertBaseEmbed(editor),
		});
		this.addCommand({
			id: "delete-this-base", icon: "trash-2",
			name: "Delete this base file (to trash)",
			callback: () => void this.deleteActiveBase(),
		});
		this.addCommand({
			id: "export-table-csv", icon: "download",
			name: "Export this table as CSV",
			callback: () => {
				const v = this.lastActiveView;
				if (v instanceof PowerTableView) void v.exportCsv();
				else new Notice("Power Bases: click into a Power Table first, then run this again.");
			},
		});
		this.addCommand({
			id: "new-base-from-template", icon: "file-plus-2",
			name: "New base from a template",
			callback: () => {
				const f = this.app.workspace.getActiveFile();
				new TemplateModal(this.app, this, f?.parent ?? this.app.vault.getRoot()).open();
			},
		});
		this.addCommand({
			id: "import-csv", icon: "upload",
			name: "Import a CSV as a new base",
			callback: () => {
				const f = this.app.workspace.getActiveFile();
				new CsvImportModal(this.app, this, f?.parent ?? this.app.vault.getRoot()).open();
			},
		});
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFolder)) return;
				menu.addItem((item) =>
					item
						.setTitle("New Power base here")
						.setIcon("layout-dashboard")
						.onClick(() => void this.createStarterBase(file))
				);
				menu.addItem((item) =>
					item
						.setTitle("New blank base here")
						.setIcon("table")
						.onClick(() => void this.createBlankBase(file))
				);
				menu.addItem((item) =>
					item
						.setTitle("New base from template here")
						.setIcon("layout-template")
						.onClick(() => new TemplateModal(this.app, this, file).open())
				);
				menu.addItem((item) =>
					item
						.setTitle("Import CSV here")
						.setIcon("download")
						.onClick(() => new CsvImportModal(this.app, this, file).open())
				);
			})
		);
		this.addCommand({ id: "copy-view-config", icon: "copy", name: "Copy this view's setup", callback: () => this.copyViewConfig() });
		this.addCommand({ id: "paste-view-config", icon: "clipboard-paste", name: "Paste view setup here", callback: () => this.pasteViewConfig() });
		this.addSettingTab(new PowerBasesSettingTab(this));
	}

	/* ----- one write path, one undo journal ----- */

	/** The edited/edited-by assignments when identity stamping is on, else null. */
	private editStamps(): Record<string, unknown> | null {
		const name = this.settings.myName.trim();
		if (!this.settings.stampEdits || !name) return null;
		return { "edited-by": name, edited: localDateString(Date.now()) };
	}

	/** Stamp created/created-by onto a page the plugin creates (values already
	 *  in the frontmatter win, e.g. a CSV column or template of the same name). */
	stampCreate(fm: Record<string, unknown>) {
		const s = this.editStamps();
		if (!s) return;
		if (fm["created-by"] === undefined) fm["created-by"] = s["edited-by"];
		if (fm["created"] === undefined) fm["created"] = s.edited;
	}

	/** Apply property assignments to a set of files as ONE undoable change.
	 *  Previous values are captured inside the same frontmatter transaction;
	 *  a toast offers Undo, and the command palette can undo the last 30.
	 *  With identity stamping on, every write also carries edited/edited-by
	 *  (an explicit assignment of those keys wins); undo restores the stamps'
	 *  prior values too, since they ride the same capture. */
	async writeBatch(label: string, writes: { file: TFile; assignments: Record<string, unknown> }[]) {
		const stamps = this.editStamps();
		const changes: { path: string; prev: Record<string, unknown> }[] = [];
		for (const w of writes) {
			if (!Object.keys(w.assignments).length) continue;
			const assignments = stamps ? { ...stamps, ...w.assignments } : w.assignments;
			await this.app.fileManager.processFrontMatter(w.file, (fm: Record<string, unknown>) => {
				changes.push({ path: w.file.path, prev: capturePrev(fm, Object.keys(assignments)) });
				for (const [k, v] of Object.entries(assignments)) {
					if (v === undefined) delete fm[k];
					else fm[k] = v;
				}
			});
		}
		if (!changes.length) return;
		this.journal.push({ label, changes });
		if (this.journal.length > 30) this.journal.shift();
		this.undoToast(label);
	}

	private journal: { label: string; changes: { path: string; prev: Record<string, unknown> }[] }[] = [];

	private undoToast(label: string) {
		let btn!: HTMLAnchorElement;
		const frag = createFragment((f) => {
			f.appendText(label + "  ");
			btn = f.createEl("a", { cls: "pb-undo-link", text: "Undo" });
		});
		const notice = new Notice(frag, 6000);
		btn.addEventListener("click", () => {
			notice.hide();
			void this.undoLast();
		});
	}

	async undoLast() {
		const entry = this.journal.pop();
		if (!entry) {
			new Notice("Power Bases: nothing to undo.");
			return;
		}
		for (const c of entry.changes) {
			const f = this.app.vault.getAbstractFileByPath(c.path);
			if (!(f instanceof TFile)) continue;
			await this.app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => {
				for (const [k, v] of Object.entries(c.prev)) {
					if (v === undefined) delete fm[k];
					else fm[k] = v;
				}
			});
		}
		new Notice("Undone: " + entry.label);
	}

	/**
	 * The main-area tab already showing this path, if there is one.
	 *
	 * Asked through `getViewState()` rather than `leaf.view.file`, because every
	 * tab you are not standing in is deferred since 1.7.2: its view is a stand-in
	 * that holds no file, and reaching for one to ask would load every tab in the
	 * window. The view state carries the path whether the view is real or not.
	 *
	 * Main-area leaves only. A note showing in a sidebar is not a tab, and a note
	 * deliberately popped out into a window of its own should not have a click in
	 * a base pulling focus to another window behind your back.
	 */
	private openLeafFor(path: string): WorkspaceLeaf | null {
		const hits: WorkspaceLeaf[] = [];
		this.app.workspace.iterateRootLeaves((leaf) => {
			const open = leaf.getViewState().state?.file;
			if (typeof open === "string" && open === path) hits.push(leaf);
		});
		return hits[0] ?? null;
	}

	/**
	 * Step to the tab already holding this path, if there is one.
	 *
	 * The open itself is left to the caller, so an `openLinkText` that follows
	 * lands in the tab this just made active. That is how a file-link cell keeps
	 * Obsidian's own subpath handling and still stops short of a second copy.
	 */
	async focusOpenTab(path: string): Promise<void> {
		const open = this.openLeafFor(path);
		if (!open) return;
		await this.app.workspace.revealLeaf(open);
		this.app.workspace.setActiveLeaf(open, { focus: true });
	}

	/**
	 * Show a note: step to the tab already holding it, or open it where you are.
	 *
	 * `getLeaf(false)` means "the tab I am standing in" and knows nothing about
	 * the tab the note is already open in, so opening a row from a base while
	 * standing anywhere else hands you a second copy of it: two scroll positions,
	 * two undo histories, and edits landing in whichever one you looked at last.
	 * A row should navigate to its note, not clone it. Ctrl/Cmd still asks for a
	 * new tab on purpose, and that request is honored.
	 */
	async showNote(f: TFile): Promise<WorkspaceLeaf> {
		const open = this.openLeafFor(f.path);
		if (open) {
			await this.app.workspace.revealLeaf(open);
			this.app.workspace.setActiveLeaf(open, { focus: true });
			return open;
		}
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(f);
		return leaf;
	}

	/** A ready-made base beside the folder's notes: the fixture, for real. */
	async createStarterBase(folder: TFolder) {
		const prefix = folder.path === "/" ? "" : folder.path + "/";
		let name = (folder.path === "/" ? this.app.vault.getName() : folder.name) + " Base";
		for (let i = 2; this.app.vault.getAbstractFileByPath(prefix + name + ".base"); i++) {
			name = folder.name + " Base " + i;
		}
		const f = await this.app.vault.create(prefix + name + ".base", starterBaseYaml(folder.path === "/" ? "" : folder.path));
		await this.app.workspace.getLeaf(false).openFile(f);
		new Notice("Power Bases: board, table, calendar, and timeline ready. Adjust the properties to your notes.");
	}

	/** Trash the base file behind a view: the X on an embedded base, the
	 *  command on the last Power view clicked, or the open .base tab. Only the
	 *  definition file goes; the rows are notes and stay. From an embed, the
	 *  note's embed line is removed too, so no dead placeholder is left. */
	async deleteActiveBase(view?: PBView) {
		const v = view ?? this.lastActiveView;
		const active = this.app.workspace.getActiveFile();
		const file = v?.baseFile() ?? (active?.extension === "base" ? active : null);
		if (!file) {
			new Notice("Power Bases: click into the base you want deleted, then run this again.");
			return;
		}
		const embed = v?.embedInfo() ?? null;
		new ConfirmModal(this.app, {
			title: `Delete "${file.name}"?`,
			body:
				"Only the base file goes to the trash: its views, filters, and formulas. The notes shown as rows are untouched." +
				(embed ? ` The embed line in "${embed.host.basename}" is removed too.` : ""),
			confirmText: "Delete",
			onConfirm: () => {
				void (async () => {
					if (embed) {
						const needle = `![[${embed.src}]]`;
						await this.app.vault.process(embed.host, (data) => {
							const out: string[] = [];
							for (const l of data.split("\n")) {
								if (!l.includes(needle)) {
									out.push(l);
									continue;
								}
								const rest = l.replace(needle, "");
								if (rest.trim()) out.push(rest); // the embed shared a line with text
							}
							return out.join("\n");
						});
					}
					await this.app.fileManager.trashFile(file);
					new Notice(`Power Bases: "${file.name}" moved to trash.`);
				})();
			},
		}).open();
	}

	/** A blank base beside the folder's notes: one Power Table with just the
	 *  name column, ready to build from scratch with + Column. */
	async createBlankBase(folder: TFolder, open = true): Promise<TFile> {
		const prefix = folder.path === "/" ? "" : folder.path + "/";
		const stem = folder.path === "/" ? this.app.vault.getName() : folder.name;
		let name = stem + " Base";
		for (let i = 2; this.app.vault.getAbstractFileByPath(prefix + name + ".base"); i++) {
			name = stem + " Base " + i;
		}
		const f = await this.app.vault.create(prefix + name + ".base", blankBaseYaml(folder.path === "/" ? "" : folder.path));
		if (open) {
			await this.app.workspace.getLeaf(false).openFile(f);
			new Notice("Power Bases: blank base ready. Use + Column to build it.");
		}
		return f;
	}

	/** From inside a note: create a blank base and embed it at the cursor, so
	 *  building a database never leaves the page. The .base file (a small YAML
	 *  definition, the rows stay in notes) is named after the note and stored
	 *  at the user's attachment location, like a pasted image; its SCOPE stays
	 *  the note's folder, where the rows live. Starts with zero columns.
	 *  Reachable from Power Editor's slash menu or the core Slash commands. */
	async insertBaseEmbed(editor: Editor) {
		const host = this.app.workspace.getActiveFile();
		const baseName = (host ? host.basename : "Untitled") + " Base";
		// a configured bases folder wins; empty falls back to the attachment location
		const cfgFolder = this.settings.basesFolder.trim().replace(/^\/+|\/+$/g, "");
		let path: string;
		if (cfgFolder) {
			await this.ensureFolder(cfgFolder);
			path = this.uniquePath(cfgFolder, baseName, ".base");
		} else {
			path = await this.app.fileManager.getAvailablePathForAttachment(baseName + ".base", host?.path ?? "");
			const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
			await this.ensureFolder(parent);
		}
		// rows live in the base's own folder, named after it, beside the .base
		// file: row pages never mingle with real notes, and hiding the bases
		// folder in the explorer hides them wholesale while search still sees
		// them (a Notion table, the honest way)
		const rowsFolder = path.slice(0, -".base".length);
		await this.ensureFolder(rowsFolder);
		const f = await this.app.vault.create(path, blankBaseYaml(rowsFolder, false));
		const link = this.app.metadataCache.fileToLinktext(f, host?.path ?? "");
		editor.replaceSelection(`![[${link}]]`);
		new Notice(`Power Bases: "${f.basename}" embedded. Use + Column to build it.`);
	}

	/* ----- shared creation helpers (CSV import, templates) ----- */

	/** Create a folder if it is missing (single level; parent must exist). */
	async ensureFolder(path: string) {
		if (path && !this.app.vault.getAbstractFileByPath(path)) {
			await this.app.vault.createFolder(path).catch(() => {});
		}
	}

	/** A non-colliding vault path for a new file. `folder` "" means the root. */
	uniquePath(folder: string, base: string, ext: string): string {
		const prefix = folder ? folder + "/" : "";
		let name = base;
		for (let i = 2; this.app.vault.getAbstractFileByPath(prefix + name + ext); i++) name = base + " " + i;
		return prefix + name + ext;
	}

	/** Create a note with frontmatter (and optional body). */
	async createNote(folder: string, base: string, fm: Record<string, unknown>, body = ""): Promise<TFile> {
		const f = await this.app.vault.create(this.uniquePath(folder, base, ".md"), body);
		if (Object.keys(fm).length || this.editStamps()) {
			await this.app.fileManager.processFrontMatter(f, (o: Record<string, unknown>) => {
				for (const [k, v] of Object.entries(fm)) o[k] = v;
				this.stampCreate(o);
			});
		}
		return f;
	}

	/** Create a .base file from YAML and open it. */
	async createBaseFile(folder: string, base: string, yaml: string): Promise<TFile> {
		const f = await this.app.vault.create(this.uniquePath(folder, base, ".base"), yaml);
		await this.app.workspace.getLeaf(false).openFile(f);
		return f;
	}
}

/** Shared scaffolding: one root element per view, cleaned up with the view. */
abstract class PBView extends BasesView {
	readonly rootEl: HTMLElement;
	/** Type-to-filter text, persisted across repaints within the view. */
	protected query = "";
	/** Live chunk observers; disconnected and rebuilt each paint. */
	private observers: IntersectionObserver[] = [];

	constructor(
		readonly plugin: PowerBasesPlugin,
		controller: QueryController,
		containerEl: HTMLElement
	) {
		super(controller);
		this.rootEl = containerEl.createDiv({ cls: "pb-root" });
		this.plugin.liveViews.add(this);
		this.plugin.lastActiveView = this;
		this.rootEl.addEventListener("pointerdown", () => (this.plugin.lastActiveView = this), { capture: true });
	}

	/** The .base file behind this view. Open in its own tab it is the active
	 *  file. Embedded in a note, the view's DOM sits inside the embed wrapper,
	 *  whose src attribute carries the base's link (with the right base even
	 *  when a note embeds several), resolved against the host note. The
	 *  controller's file is probed first in case a future API exposes it. An
	 *  inline ```base code block has no file of its own, so this returns null
	 *  there and file-backed editing stays off. */
	/** When this view lives inside a note's embed: the host note and the
	 *  embed's exact link text (for removing the line on delete). */
	embedInfo(): { host: TFile; src: string } | null {
		const src = this.rootEl.closest<HTMLElement>(".internal-embed")?.getAttribute("src");
		const host = this.app.workspace.getActiveFile();
		return src && host && host.extension === "md" ? { host, src } : null;
	}

	baseFile(): TFile | null {
		const probe = (this as unknown as { controller?: { file?: TFile } }).controller?.file;
		if (probe instanceof TFile && probe.extension === "base") return probe;
		const active = this.app.workspace.getActiveFile();
		if (active && active.extension === "base") return active;
		const src = this.rootEl.closest<HTMLElement>(".internal-embed")?.getAttribute("src");
		if (src) {
			const f = this.app.metadataCache.getFirstLinkpathDest(src.split("#")[0].trim(), active?.path ?? "");
			if (f instanceof TFile && f.extension === "base") return f;
		}
		return null;
	}

	/** Stop every chunk observer from the previous paint. Call at the top of
	 *  onDataUpdated before rebuilding. */
	protected resetChunkers() {
		for (const o of this.observers) o.disconnect();
		this.observers = [];
	}

	/** Render `items` into `host` in batches, extending as a sentinel nears
	 *  the bottom of `scrollEl`. Keeps a 5,000-row folder from building every
	 *  node up front, the Power-family promise at vault scale. */
	protected chunk<T>(
		host: HTMLElement,
		scrollEl: HTMLElement,
		items: T[],
		renderOne: (t: T, i: number) => void,
		size = 140,
		sentinelTag: "div" | "tr" = "div"
	) {
		let shown = 0;
		let sentinel: HTMLElement | null = null;
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) step();
			},
			{ root: scrollEl, rootMargin: "320px" }
		);
		this.observers.push(io);
		const mkSentinel = () =>
			sentinelTag === "tr"
				? host.createEl("tr", { cls: "pb-sentinel" }).createEl("td", { cls: "pb-sentinel" })
				: host.createDiv({ cls: "pb-sentinel" });
		const step = () => {
			if (sentinel) {
				io.unobserve(sentinel);
				// for a tr sentinel, remove the row (the td's parent), not just the cell
				(sentinelTag === "tr" ? (sentinel.parentElement ?? sentinel) : sentinel).remove();
				sentinel = null;
			}
			const end = Math.min(items.length, shown + size);
			for (; shown < end; shown++) renderOne(items[shown], shown);
			if (shown < items.length) {
				sentinel = mkSentinel();
				io.observe(sentinel);
			}
		};
		step();
	}

	/** A search box that drives this.query and repaints; returns the input so
	 *  callers can autofocus. Placed in a header row. */
	protected filterBox(host: HTMLElement, placeholder = "Filter…"): HTMLInputElement {
		const wrap = host.createDiv({ cls: "pb-filterbox" });
		setIcon(wrap.createSpan({ cls: "pb-filterbox-icon" }), "search");
		const input = wrap.createEl("input", { attr: { type: "text", placeholder, spellcheck: "false" } });
		input.value = this.query;
		let t: number | null = null;
		input.addEventListener("input", () => {
			if (t != null) window.clearTimeout(t);
			t = window.setTimeout(() => {
				this.query = input.value;
				this.onDataUpdated();
			}, 120);
		});
		input.addEventListener("keydown", (e) => {
			if (e.key === "Escape" && this.query) {
				this.query = "";
				this.onDataUpdated();
				e.preventDefault();
			}
		});
		if (this.query) {
			const clear = wrap.createSpan({ cls: "pb-filterbox-clear" });
			setIcon(clear, "x");
			clear.addEventListener("click", () => {
				this.query = "";
				this.onDataUpdated();
			});
		}
		return input;
	}

	/** The entries after applying the type-to-filter, matched over the name
	 *  plus every visible property's text. */
	protected filtered(entries: BasesEntry[]): BasesEntry[] {
		if (!this.query.trim()) return entries;
		const props = this.config.getOrder();
		return entries.filter((en) =>
			matchesQuery([en.file.basename, ...props.map((p) => this.text(en, p))], this.query)
		);
	}

	/** Make an element keyboard-openable: focusable, Enter/Space opens the file. */
	protected openable(el: HTMLElement, file: TFile) {
		el.setAttribute("tabindex", "0");
		el.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				if (e.ctrlKey || e.metaKey) void this.app.workspace.getLeaf(true).openFile(file);
				else void this.plugin.showNote(file);
			}
		});
	}

	/** Native page preview on hover (Ctrl by default, per Page preview settings). */
	protected hoverable(el: HTMLElement, file: TFile) {
		el.addEventListener("mouseover", (ev) => {
			this.app.workspace.trigger("hover-link", {
				event: ev,
				source: "powerbases",
				hoverParent: this,
				targetEl: el,
				linktext: file.path,
				sourcePath: file.path,
			});
		});
	}

	onunload() {
		this.plugin.liveViews.delete(this);
		this.resetChunkers();
		this.rootEl.remove();
	}

	/** Ctrl/Cmd asks for a new tab and gets one. A plain open goes to the note
	 *  wherever it already is, rather than making a second copy of it here. */
	protected open(file: TFile, ev: MouseEvent) {
		if (ev.ctrlKey || ev.metaKey) void this.app.workspace.getLeaf(true).openFile(file);
		else void this.plugin.showNote(file);
	}

	/** The rendered text of a property for an entry ("" when absent). Missing
	 *  properties arrive as NullValue, whose toString is the STRING "null"; a
	 *  typed-but-empty property (e.g. a fresh checkbox/list column) can render as
	 *  a null-ish Value that slips past the instanceof check, so blank "null" too. */
	protected text(en: BasesEntry, prop: BasesPropertyId): string {
		if (prop === "file.name") return en.file.basename;
		const v = en.getValue(prop);
		if (v == null || v instanceof NullValue) return "";
		const s = v.toString();
		return s === "null" ? "" : s;
	}

	protected hint(msg: string) {
		this.rootEl.createDiv({ cls: "pb-hint", text: msg });
	}
}

/** Kanban lanes from a chosen note property; dropping a card writes the
 *  property (plus the lane's rules), and a manual order property turns
 *  drops between cards into persistent ranks. Lane order is first-seen. */
class PowerBoardView extends PBView {
	type = "powerbases-board";
	/** Render context the drop and menu handlers read (refreshed each paint). */
	private ctx: {
		fmKey: string;
		rankKey: string | null;
		rowKey: string | null;
		lanes: { key: string | null; label: string }[];
		rules: Record<string, Record<string, string>>;
		wip: Record<string, number>;
	} | null = null;
	/** Visual cell contents from the last paint, keyed by cellKey(row, lane);
	 *  the flat board uses row = undefined. */
	private laneLists = new Map<string, BasesEntry[]>();
	private laneOf = new Map<string, string | null>();
	private rowOf = new Map<string, string | null>();
	/** Alt+click selection for bulk moves; pruned to live entries each paint. */
	private selected = new Set<string>();
	/** Batch writes (lane renumbers) defer repaints so lanes do not flicker. */
	private writing = false;
	private pendingUpdate = false;

	onDataUpdated(): void {
		if (this.writing) {
			this.pendingUpdate = true;
			return;
		}
		this.resetChunkers();
		const root = this.rootEl;
		root.empty();
		root.className = "pb-root pb-board";
		const groupBy = this.config.getAsPropertyId("pbGroup");
		if (!groupBy) {
			this.hint("Pick a Group by property in the view options to lay out the board.");
			return;
		}
		const fmKey = frontmatterKey(groupBy);
		const head = root.createDiv({ cls: "pb-view-head pb-board-head" });
		this.filterBox(head, "Filter cards…");
		const entries = this.filtered(this.data.data);
		const values = entries.map((en) => {
			const s = this.text(en, groupBy);
			return s === "" ? null : s;
		});
		const savedRaw = this.config.get("pb-colOrder");
		const cols = boardColumns(values, Array.isArray(savedRaw) ? (savedRaw as string[]) : []);
		const showEmpty = this.config.get("showEmpty") !== false;
		const rowBy = this.config.getAsPropertyId("pbRows");
		const rowByProp = rowBy && rowBy !== groupBy ? rowBy : null;
		const rowKey = rowByProp ? frontmatterKey(rowByProp) : null;
		const cardProps = parseInt(String(this.config.get("cardProps") ?? "3"), 10) || 0;
		const shown = this.config
			.getOrder()
			.filter((p) => p !== groupBy && p !== "file.name" && p !== rowByProp)
			.slice(0, cardProps);
		const lanes: { key: string | null; label: string }[] = cols.map((c) => ({ key: c, label: c }));
		if (showEmpty) lanes.push({ key: null, label: "No " + this.config.getDisplayName(groupBy) });
		const rankProp = this.config.getAsPropertyId("rankProp");
		const rankKey = rankProp && rankProp !== groupBy ? frontmatterKey(rankProp) : null;
		this.ctx = {
			fmKey,
			rankKey,
			rowKey,
			lanes,
			rules: this.asRules(this.config.get("pb-rules")),
			wip: this.asWip(this.config.get("pb-wip")),
		};
		this.laneLists.clear();
		this.laneOf.clear();
		this.rowOf.clear();
		if (this.selected.size) {
			const live = new Set(entries.map((en) => en.file.path));
			this.selected = new Set([...this.selected].filter((p) => live.has(p)));
		}
		const aggPropId = this.config.getAsPropertyId("pbAggProp");
		const aggOpRaw = String(this.config.get("pbAggOp") ?? "sum");
		const laneAgg = aggPropId
			? { prop: aggPropId, op: (["sum", "avg", "min", "max", "filled"].includes(aggOpRaw) ? aggOpRaw : "sum") as AggOp }
			: null;
		const laneHue = (key: string | null) =>
			key == null ? "var(--background-modifier-border)" : this.plugin.hueFor(fmKey, key);
		const laneAggChip = (host: HTMLElement, laneEntries: BasesEntry[]) => {
			if (!laneAgg) return;
			const n = aggregate(
				laneEntries.map((en) => this.text(en, laneAgg.prop)),
				laneAgg.op
			);
			if (n != null) host.createSpan({ cls: "pb-lane-agg", text: (AGG_SYMBOL[laneAgg.op] ?? "") + " " + formatNum(n) });
		};
		if (rowByProp && rowKey) {
			this.renderSwim(root, { entries, values, lanes, rowByProp, rowKey, rankKey, shown, laneAggChip, laneHue, showEmpty });
			return;
		}
		const folded = this.foldedSet();
		const board = root.createDiv({ cls: "pb-lanes" });
		for (const lane of lanes) {
			const laneId = lane.key ?? "\u0000";
			const laneEl = board.createDiv({ cls: "pb-lane", attr: { "data-lane": lane.key ?? "" } });
			if (lane.key == null) laneEl.setAttr("data-noval", "1");
			let laneEntries = entries.filter((_, i) => values[i] === lane.key);
			if (rankKey) laneEntries = orderByRank(laneEntries, (en) => this.rawRank(en, rankKey));
			this.laneLists.set(this.cellKey(undefined, lane.key), laneEntries);
			for (const en of laneEntries) this.laneOf.set(en.file.path, lane.key);
			const wip = lane.key != null ? this.ctx.wip[lane.key] : undefined;
			const hue = laneHue(lane.key);
			if (folded.has(laneId)) {
				// a folded lane is a slim strip: name, count, still a drop target
				laneEl.addClass("pb-lane-folded");
				const fh = laneEl.createDiv({ cls: "pb-lane-foldhead" });
				const dot = fh.createSpan({ cls: "pb-dot" });
				dot.style.background = hue;
				fh.createSpan({ cls: "pb-lane-foldname", text: `${lane.label}  ·  ${laneEntries.length}` });
				laneEl.setAttr("aria-label", "Expand " + lane.label);
				laneEl.addEventListener("click", () => this.toggleFold(laneId));
				continue;
			}
			const head = laneEl.createDiv({ cls: "pb-lane-head" });
			const dot = head.createSpan({ cls: "pb-dot" });
			dot.style.background = hue;
			head.createSpan({ cls: "pb-lane-name", text: lane.label });
			const count = head.createSpan({
				cls: "pb-lane-count",
				text: wip ? `${laneEntries.length} / ${wip}` : String(laneEntries.length),
			});
			if (wip && laneEntries.length > wip) count.addClass("pb-over");
			laneAggChip(head, laneEntries);
			const foldBtn = head.createEl("button", { cls: "pb-lane-fold", attr: { "aria-label": "Collapse lane" } });
			setIcon(foldBtn, "chevrons-left");
			foldBtn.addEventListener("click", (ev) => {
				ev.stopPropagation();
				this.toggleFold(laneId);
			});
			if (lane.key != null) {
				head.addEventListener("contextmenu", (ev) => {
					ev.preventDefault();
					this.openLaneMenu(lane.key!, ev.clientX, ev.clientY);
				});
				this.attachLaneDrag(head, lane.key);
			}
			const body = laneEl.createDiv({ cls: "pb-lane-body" });
			// each lane scrolls independently; chunk within the lane body
			this.chunk(body, body, laneEntries, (en) => this.buildCard(body, en, shown, lane.key), 80);
			const add = laneEl.createDiv({ cls: "pb-lane-add", text: "+ New page" });
			add.addEventListener("click", () => void this.newPageInLane(lane.key));
		}
	}

	private cellKey(row: string | null | undefined, lane: string | null): string {
		return (row === undefined ? "*" : (row ?? "\u0007")) + "\u0007" + (lane ?? "\u0007");
	}

	/** One card, identical in flat lanes and swim cells. */
	private buildCard(body: HTMLElement, en: BasesEntry, shown: BasesPropertyId[], lane: string | null) {
		const card = body.createDiv({ cls: "pb-card", attr: { "data-path": en.file.path } });
		if (this.selected.has(en.file.path)) card.addClass("pb-selected");
		card.createDiv({ cls: "pb-card-title", text: en.file.basename });
		for (const p of shown) {
			const s = this.text(en, p);
			if (!s) continue;
			const row = card.createDiv({ cls: "pb-card-prop" });
			row.createSpan({ cls: "pb-card-key", text: this.config.getDisplayName(p) });
			row.createSpan({ cls: "pb-card-val", text: s });
		}
		this.hoverable(card, en.file);
		card.addEventListener("contextmenu", (ev) => {
			ev.preventDefault();
			this.openCardMenu(en, lane, ev.clientX, ev.clientY);
		});
		this.attachCardDrag(card, en, lane);
	}

	/** Two-axis board: columns from the group property, swimlane rows from a
	 *  second one. A sticky header carries the lane heads once; each row is a
	 *  band plus one cell per column, and drops write BOTH properties. Lane
	 *  folding stays a flat-board feature. */
	private renderSwim(
		root: HTMLElement,
		o: {
			entries: BasesEntry[];
			values: (string | null)[];
			lanes: { key: string | null; label: string }[];
			rowByProp: BasesPropertyId;
			rowKey: string;
			rankKey: string | null;
			shown: BasesPropertyId[];
			laneAggChip: (host: HTMLElement, laneEntries: BasesEntry[]) => void;
			laneHue: (key: string | null) => string;
			showEmpty: boolean;
		}
	) {
		const rowVals = o.entries.map((en) => {
			const s = this.text(en, o.rowByProp);
			return s === "" ? null : s;
		});
		const rows: { key: string | null; label: string }[] = boardColumns(rowVals, []).map((r) => ({ key: r, label: r }));
		if (o.showEmpty || rowVals.some((v) => v == null)) {
			rows.push({ key: null, label: "No " + this.config.getDisplayName(o.rowByProp) });
		}
		const wrap = root.createDiv({ cls: "pb-lanes pb-swim" });
		const heads = wrap.createDiv({ cls: "pb-swim-heads" });
		for (const lane of o.lanes) {
			const hc = heads.createDiv({ cls: "pb-swim-headcell", attr: { "data-lane": lane.key ?? "" } });
			if (lane.key == null) hc.setAttr("data-noval", "1");
			const dot = hc.createSpan({ cls: "pb-dot" });
			dot.style.background = o.laneHue(lane.key);
			hc.createSpan({ cls: "pb-lane-name", text: lane.label });
			const colEntries = o.entries.filter((_, i) => o.values[i] === lane.key);
			const wip = lane.key != null ? this.ctx!.wip[lane.key] : undefined;
			const count = hc.createSpan({
				cls: "pb-lane-count",
				text: wip ? `${colEntries.length} / ${wip}` : String(colEntries.length),
			});
			if (wip && colEntries.length > wip) count.addClass("pb-over");
			o.laneAggChip(hc, colEntries);
			if (lane.key != null) {
				hc.addEventListener("contextmenu", (ev) => {
					ev.preventDefault();
					this.openLaneMenu(lane.key!, ev.clientX, ev.clientY);
				});
				this.attachLaneDrag(hc, lane.key);
			}
		}
		for (const row of rows) {
			const idxs = o.entries.map((_, i) => i).filter((i) => rowVals[i] === row.key);
			const band = wrap.createDiv({ cls: "pb-swim-band" });
			band.createSpan({ cls: "pb-swim-bandname", text: row.label });
			band.createSpan({ cls: "pb-lane-count", text: String(idxs.length) });
			const rowEl = wrap.createDiv({ cls: "pb-swim-row" });
			for (const lane of o.lanes) {
				const cell = rowEl.createDiv({
					cls: "pb-lane pb-swim-cell",
					attr: { "data-lane": lane.key ?? "", "data-row": row.key ?? "" },
				});
				if (lane.key == null) cell.setAttr("data-noval", "1");
				if (row.key == null) cell.setAttr("data-norow", "1");
				let cellEntries = idxs.filter((i) => o.values[i] === lane.key).map((i) => o.entries[i]);
				if (o.rankKey) cellEntries = orderByRank(cellEntries, (en) => this.rawRank(en, o.rankKey!));
				this.laneLists.set(this.cellKey(row.key, lane.key), cellEntries);
				for (const en of cellEntries) {
					this.laneOf.set(en.file.path, lane.key);
					this.rowOf.set(en.file.path, row.key);
				}
				const body = cell.createDiv({ cls: "pb-lane-body" });
				for (const en of cellEntries) this.buildCard(body, en, o.shown, lane.key);
				const add = cell.createDiv({
					cls: "pb-lane-add pb-swim-add",
					text: "+",
					attr: { "aria-label": "New page here" },
				});
				add.addEventListener("click", () => void this.newPageInLane(lane.key, o.rowKey, row.key));
			}
		}
	}

	/* ----- lane config (rules, WIP) ----- */

	private asRules(raw: unknown): Record<string, Record<string, string>> {
		return raw && typeof raw === "object" ? (raw as Record<string, Record<string, string>>) : {};
	}

	private asWip(raw: unknown): Record<string, number> {
		return raw && typeof raw === "object" ? (raw as Record<string, number>) : {};
	}

	getRules(lane: string): Record<string, string> {
		return { ...(this.asRules(this.config.get("pb-rules"))[lane] ?? {}) };
	}

	getWip(lane: string): number | null {
		const n = this.asWip(this.config.get("pb-wip"))[lane];
		return typeof n === "number" && n > 0 ? n : null;
	}

	getTemplates(): Record<string, string> {
		const raw = this.config.get("pb-templates");
		return raw && typeof raw === "object" ? (raw as Record<string, string>) : {};
	}

	saveLaneSettings(lane: string, wip: number | null, rules: Record<string, string>, template: string | null) {
		const allRules = this.asRules(this.config.get("pb-rules"));
		if (Object.keys(rules).length) allRules[lane] = rules;
		else delete allRules[lane];
		this.config.set("pb-rules", Object.keys(allRules).length ? allRules : null);
		const allWip = this.asWip(this.config.get("pb-wip"));
		if (wip) allWip[lane] = wip;
		else delete allWip[lane];
		this.config.set("pb-wip", Object.keys(allWip).length ? allWip : null);
		const allTpl = { ...this.getTemplates() };
		if (template) allTpl[lane] = template;
		else delete allTpl[lane];
		this.config.set("pb-templates", Object.keys(allTpl).length ? allTpl : null);
		this.onDataUpdated();
	}

	/** Where template-created pages land: the base file's folder when the
	 *  controller exposes it, else the active file's folder. */
	private targetFolder(): TFolder {
		const probe = (this as unknown as { controller?: { file?: TFile } }).controller?.file;
		if (probe instanceof TFile && probe.parent) return probe.parent;
		return this.app.workspace.getActiveFile()?.parent ?? this.app.vault.getRoot();
	}

	/** New page for a lane: with a lane template the page starts as a copy of
	 *  the template note (frontmatter merged after), else the standard Bases
	 *  create; either way the lane value and rules are pre-filled. */
	async newPageInLane(lane: string | null, rowKey?: string, rowVal?: string | null) {
		const assignments = this.laneAssignments(lane, null);
		if (rowKey && rowVal != null) assignments[rowKey] = rowVal;
		const apply = (fm: Record<string, unknown>) => {
			for (const [k, v] of Object.entries(assignments)) {
				if (v === undefined) delete fm[k];
				else fm[k] = v;
			}
			this.plugin.stampCreate(fm);
		};
		const tplPath = lane != null ? this.getTemplates()[lane] : undefined;
		const tpl = tplPath ? this.app.vault.getAbstractFileByPath(tplPath) : null;
		if (!(tpl instanceof TFile)) {
			if (tplPath) new Notice("Power Bases: template note not found: " + tplPath);
			await this.createFileForView(undefined, apply);
			return;
		}
		const content = await this.app.vault.read(tpl);
		const folder = this.targetFolder();
		const prefix = folder.path === "/" ? "" : folder.path + "/";
		let name = "Untitled";
		for (let i = 1; this.app.vault.getAbstractFileByPath(prefix + name + ".md"); i++) name = `Untitled ${i}`;
		const nf = await this.app.vault.create(prefix + name + ".md", content);
		await this.app.fileManager.processFrontMatter(nf, apply);
		await this.app.workspace.getLeaf(false).openFile(nf);
	}

	/** Note-property names available for rule rows. */
	notePropNames(): string[] {
		return this.allProperties.filter((p) => p.startsWith("note.")).map((p) => frontmatterKey(p));
	}

	/** Everything entering `lane` should get: the group value plus the lane's
	 *  rules (tokens expanded, typed). `fromLane` skips rules on reorders. */
	private laneAssignments(lane: string | null, fromLane: string | null): Record<string, unknown> {
		const ctx = this.ctx!;
		const out: Record<string, unknown> = {};
		if (lane === fromLane) return out;
		out[ctx.fmKey] = lane ?? undefined;
		if (lane != null) {
			const now = new Date();
			for (const [k, v] of Object.entries(ctx.rules[lane] ?? {})) {
				if (k === ctx.fmKey || k === ctx.rankKey) continue;
				out[k] = parseRuleValue(expandToken(String(v), now));
			}
		}
		return out;
	}

	/* ----- drops, ranks, menus ----- */

	private rawRank(en: BasesEntry, rankKey: string): number | null {
		const r = frontmatterOf(this.app, en.file)?.[rankKey];
		return typeof r === "number" ? r : null;
	}

	/** Apply a drop or Move-to: lane value, swimlane row value, lane rules,
	 *  and (when a manual order property is set) a fractional rank; an
	 *  exhausted or missing gap renumbers the cell in its new visual order.
	 *  Everything lands as ONE undoable batch. */
	async applyCardDrop(path: string, lane: string | null, beforePath: string | null, row?: string | null) {
		const ctx = this.ctx;
		if (!ctx) return;
		const f = this.app.vault.getAbstractFileByPath(path);
		if (!(f instanceof TFile)) return;
		const fromLane = this.laneOf.get(path) ?? null;
		const assignments = this.laneAssignments(lane, fromLane);
		if (ctx.rowKey && row !== undefined && row !== (this.rowOf.get(path) ?? null)) {
			assignments[ctx.rowKey] = row ?? undefined;
		}
		const laneChanged = lane !== fromLane;
		const label = laneChanged
			? `Moved "${f.basename}" to ${lane ?? "No value"}`
			: Object.keys(assignments).length
				? `Updated "${f.basename}"`
				: `Reordered "${f.basename}"`;
		const list = (this.laneLists.get(this.cellKey(row, lane)) ?? []).filter((en) => en.file.path !== path);
		let at = beforePath == null ? list.length : list.findIndex((en) => en.file.path === beforePath);
		if (at < 0) at = list.length;
		this.writing = true;
		try {
			if (ctx.rankKey) {
				const prevEn = at > 0 ? list[at - 1] : null;
				const nextEn = at < list.length ? list[at] : null;
				const prevRank = prevEn ? this.rawRank(prevEn, ctx.rankKey) : null;
				const nextRank = nextEn ? this.rawRank(nextEn, ctx.rankKey) : null;
				const gapKnown = !(prevEn && prevRank == null) && !(nextEn && nextRank == null);
				const r = gapKnown ? rankBetween(prevRank, nextRank) : null;
				if (r != null) {
					assignments[ctx.rankKey] = r;
					await this.plugin.writeBatch(label, [{ file: f, assignments }]);
				} else {
					const files = [...list.slice(0, at).map((en) => en.file), f, ...list.slice(at).map((en) => en.file)];
					const ranks = renumber(files.length);
					await this.plugin.writeBatch(
						label,
						files.map((file, i) => ({
							file,
							assignments: file.path === path ? { ...assignments, [ctx.rankKey!]: ranks[i] } : { [ctx.rankKey!]: ranks[i] },
						}))
					);
				}
			} else if (Object.keys(assignments).length) {
				await this.plugin.writeBatch(label, [{ file: f, assignments }]);
			}
		} finally {
			this.writing = false;
			if (this.pendingUpdate) {
				this.pendingUpdate = false;
				this.onDataUpdated();
			}
		}
	}

	openCardMenu(en: BasesEntry, lane: string | null, x: number, y: number) {
		const ctx = this.ctx;
		if (!ctx) return;
		const menu = new Menu();
		const bulk = this.selected.size > 1 && this.selected.has(en.file.path);
		for (const other of ctx.lanes) {
			if (other.key === lane) continue;
			menu.addItem((i) =>
				i
					.setTitle((bulk ? `Move ${this.selected.size} selected to ` : "Move to ") + other.label)
					.setIcon("arrow-right")
					.onClick(() =>
						bulk
							? void this.applyCardDropMulti([...this.selected], other.key)
							: void this.applyCardDrop(en.file.path, other.key, null)
					)
			);
		}
		if (this.selected.size) {
			menu.addItem((i) =>
				i
					.setTitle("Clear selection")
					.setIcon("x")
					.onClick(() => {
						this.selected.clear();
						this.onDataUpdated();
					})
			);
		}
		menu.addSeparator();
		this.app.workspace.trigger("file-menu", menu, en.file, "powerbases-board");
		menu.showAtPosition({ x, y });
	}

	/** Cards ride the shared pointer engine: drag between or within lanes,
	 *  hold-and-release for the menu on touch, plain click to open. */
	private attachCardDrag(card: HTMLElement, en: BasesEntry, lane: string | null) {
		let line: HTMLElement | null = null;
		let hoverLane: HTMLElement | null = null;
		let target: { lane: string | null; row: string | null | undefined; before: string | null } | null = null;
		const cleanup = () => {
			card.removeClass("pb-drag-src");
			line?.remove();
			line = null;
			hoverLane?.removeClass("pb-drop");
			hoverLane = null;
		};
		attachPointerGesture(card, {
			ghostText: en.file.basename,
			onStart: () => {
				target = null;
				card.addClass("pb-drag-src");
				line = document.body.createDiv({ cls: "pb-dropline" });
			},
			onMove: (_dx, _dy, x, y) => {
				target = null;
				line?.removeClass("is-shown");
				hoverLane?.removeClass("pb-drop");
				hoverLane = null;
				const el = document.elementFromPoint(x, y) as HTMLElement | null;
				if (!el?.closest) return;
				const laneEl = el.closest<HTMLElement>(".pb-lane");
				if (!laneEl || !this.rootEl.contains(laneEl)) return;
				const laneKey = laneEl.getAttribute("data-noval") === "1" ? null : laneEl.getAttribute("data-lane");
				// swim cells carry a row; flat lanes leave the row untouched
				const rowKey = !laneEl.hasAttribute("data-row")
					? undefined
					: laneEl.getAttribute("data-norow") === "1"
						? null
						: laneEl.getAttribute("data-row");
				hoverLane = laneEl;
				laneEl.addClass("pb-drop");
				if (laneEl.hasClass("pb-lane-folded")) {
					target = { lane: laneKey, row: rowKey, before: null }; // folded lanes take appends
					return;
				}
				const overCard = el.closest<HTMLElement>(".pb-card");
				const show = (rect: DOMRect, atTop: boolean) => {
					if (!line) return;
					line.addClass("is-shown");
					line.style.left = rect.left + "px";
					line.style.width = rect.width + "px";
					line.style.top = (atTop ? rect.top : rect.bottom) - 1 + "px";
				};
				if (overCard && overCard !== card) {
					const rect = overCard.getBoundingClientRect();
					const before = y - rect.top < rect.height / 2;
					const beforePath = before
						? overCard.getAttribute("data-path")
						: ((overCard.nextElementSibling as HTMLElement | null)?.getAttribute?.("data-path") ?? null);
					target = { lane: laneKey, row: rowKey, before: beforePath };
					show(rect, before);
					return;
				}
				if (overCard === card) return; // over itself: nothing to do
				target = { lane: laneKey, row: rowKey, before: null };
				const cards = laneEl.querySelectorAll(".pb-card");
				const last = cards[cards.length - 1] as HTMLElement | undefined;
				if (last && last !== card) show(last.getBoundingClientRect(), false);
			},
			onDrop: () => {
				const drop = target;
				cleanup();
				if (!drop) return;
				if (this.selected.size > 1 && this.selected.has(en.file.path)) {
					void this.applyCardDropMulti([...this.selected], drop.lane, drop.row);
				} else {
					void this.applyCardDrop(en.file.path, drop.lane, drop.before, drop.row);
				}
			},
			onCancel: () => cleanup(),
			onHoldTap: (x, y) => this.openCardMenu(en, lane, x, y),
			onClick: (ev) => {
				if (ev.altKey) {
					// Alt+click gathers a bulk selection; Ctrl+click stays "new tab"
					if (this.selected.has(en.file.path)) this.selected.delete(en.file.path);
					else this.selected.add(en.file.path);
					card.toggleClass("pb-selected", this.selected.has(en.file.path));
					return;
				}
				this.open(en.file, ev);
			},
		});
	}

	/** Bulk drop or Move-to: every selected page gets the lane (and row) with
	 *  its rules, appended in selection order, as ONE undoable batch. */
	async applyCardDropMulti(paths: string[], lane: string | null, row?: string | null) {
		const ctx = this.ctx;
		if (!ctx) return;
		const writes: { file: TFile; assignments: Record<string, unknown> }[] = [];
		const list = this.laneLists.get(this.cellKey(row, lane)) ?? [];
		let lastRank = 0;
		if (ctx.rankKey) {
			for (const en of list) {
				const r = this.rawRank(en, ctx.rankKey);
				if (r != null && r > lastRank) lastRank = r;
			}
		}
		let i = 0;
		for (const p of paths) {
			const f = this.app.vault.getAbstractFileByPath(p);
			if (!(f instanceof TFile)) continue;
			const assignments = this.laneAssignments(lane, this.laneOf.get(p) ?? null);
			if (ctx.rowKey && row !== undefined && row !== (this.rowOf.get(p) ?? null)) {
				assignments[ctx.rowKey] = row ?? undefined;
			}
			if (ctx.rankKey) assignments[ctx.rankKey] = lastRank + 100 * ++i;
			if (Object.keys(assignments).length) writes.push({ file: f, assignments });
		}
		this.selected.clear();
		if (!writes.length) return;
		this.writing = true;
		try {
			await this.plugin.writeBatch(`Moved ${writes.length} pages to ${lane ?? "No value"}`, writes);
		} finally {
			this.writing = false;
			if (this.pendingUpdate) {
				this.pendingUpdate = false;
				this.onDataUpdated();
			}
		}
	}

	/** Lane headers drag horizontally to reorder the board; the saved order
	 *  lives in pb-colOrder, which boardColumns has honored since 0.1.0. */
	private attachLaneDrag(head: HTMLElement, key: string) {
		let vline: HTMLElement | null = null;
		let targetBefore: string | null | undefined;
		const cleanup = () => {
			vline?.remove();
			vline = null;
		};
		attachPointerGesture(head, {
			ghostText: key,
			onStart: () => {
				targetBefore = undefined;
				vline = document.body.createDiv({ cls: "pb-droplane" });
			},
			onMove: (_dx, _dy, x, y) => {
				targetBefore = undefined;
				vline?.removeClass("is-shown");
				const el = document.elementFromPoint(x, y) as HTMLElement | null;
				const overLane = el?.closest?.(".pb-lane, .pb-swim-headcell") as HTMLElement | null;
				if (!overLane || !this.rootEl.contains(overLane)) return;
				if (overLane.getAttribute("data-noval") === "1") return; // No-value stays last
				const overKey = overLane.getAttribute("data-lane");
				if (overKey === key || overKey == null) return;
				const rect = overLane.getBoundingClientRect();
				const before = x - rect.left < rect.width / 2;
				if (before) targetBefore = overKey;
				else {
					const next = overLane.nextElementSibling as HTMLElement | null;
					targetBefore = next && next.getAttribute("data-noval") !== "1" ? next.getAttribute("data-lane") : null;
				}
				if (vline) {
					vline.addClass("is-shown");
					vline.style.left = (before ? rect.left : rect.right) - 1 + "px";
					vline.style.top = rect.top + "px";
					vline.style.height = rect.height + "px";
				}
			},
			onDrop: () => {
				const t = targetBefore;
				cleanup();
				if (t === undefined) return;
				const cols = (this.ctx?.lanes ?? []).map((l) => l.key).filter((k): k is string => k != null);
				const rest = cols.filter((c) => c !== key);
				let idx = t == null ? rest.length : rest.indexOf(t);
				if (idx < 0) idx = rest.length;
				this.config.set("pb-colOrder", [...rest.slice(0, idx), key, ...rest.slice(idx)]);
				this.onDataUpdated();
			},
			onCancel: () => cleanup(),
			onHoldTap: (x, y) => this.openLaneMenu(key, x, y),
		});
	}

	openLaneMenu(key: string, x: number, y: number) {
		const ctx = this.ctx;
		if (!ctx) return;
		const menu = new Menu();
		fillValueColorMenu(menu, this.plugin, ctx.fmKey, key, () => this.onDataUpdated());
		menu.addSeparator();
		menu.addItem((i) =>
			i
				.setTitle("Lane settings…")
				.setIcon("settings-2")
				.onClick(() => new LaneSettingsModal(this.app, this, key).open())
		);
		menu.showAtPosition({ x, y });
	}

	private foldedSet(): Set<string> {
		const raw = this.config.get("pb-folded");
		return new Set(Array.isArray(raw) ? (raw as string[]) : []);
	}

	private toggleFold(id: string) {
		const s = this.foldedSet();
		if (s.has(id)) s.delete(id);
		else s.add(id);
		this.config.set("pb-folded", s.size ? [...s] : null);
		this.onDataUpdated();
	}
}

/** Per-lane rules and WIP limit, edited from the lane header menu. */
class LaneSettingsModal extends Modal {
	private rows: { prop: HTMLInputElement; val: HTMLInputElement }[] = [];
	private wipInput!: HTMLInputElement;
	private tplInput!: HTMLInputElement;

	constructor(
		app: App,
		private view: PowerBoardView,
		private lane: string
	) {
		super(app);
	}

	onOpen() {
		this.titleEl.setText(`Lane settings: ${this.lane}`);
		const c = this.contentEl;
		c.createEl("p", {
			cls: "pb-modal-desc",
			text: "Rules run when a page enters this lane. Values may use {today} or {now}; an empty value removes the property.",
		});
		const wipRow = c.createDiv({ cls: "pb-rule-row" });
		wipRow.createSpan({ cls: "pb-rule-label", text: "WIP limit" });
		this.wipInput = wipRow.createEl("input", { attr: { type: "number", min: "0", placeholder: "none" } });
		const wip = this.view.getWip(this.lane);
		if (wip) this.wipInput.value = String(wip);

		const tplRow = c.createDiv({ cls: "pb-rule-row" });
		tplRow.createSpan({ cls: "pb-rule-label", text: "Template" });
		const tplId = "pb-tpl-" + Math.floor(Math.random() * 1e9);
		const tplList = c.createEl("datalist", { attr: { id: tplId } });
		for (const f of this.view.app.vault.getMarkdownFiles()) {
			if (f.path.toLowerCase().includes("template")) tplList.createEl("option", { attr: { value: f.path } });
		}
		this.tplInput = tplRow.createEl("input", {
			attr: { type: "text", placeholder: "Templates/Task.md (for + New page)", list: tplId },
		});
		this.tplInput.value = this.view.getTemplates()[this.lane] ?? "";

		c.createEl("p", { cls: "pb-rule-head", text: "Set properties on entry" });
		const rowsEl = c.createDiv();
		const dlId = "pb-props-" + Math.floor(Math.random() * 1e9);
		const dl = c.createEl("datalist", { attr: { id: dlId } });
		for (const name of this.view.notePropNames()) dl.createEl("option", { attr: { value: name } });
		const addRow = (prop = "", val = "") => {
			const row = rowsEl.createDiv({ cls: "pb-rule-row" });
			const p = row.createEl("input", { attr: { type: "text", placeholder: "property", list: dlId } });
			p.value = prop;
			const v = row.createEl("input", { cls: "pb-rule-val", attr: { type: "text", placeholder: "value, {today}, {now}" } });
			v.value = val;
			const x = row.createEl("button", { cls: "pb-rule-x", attr: { "aria-label": "Remove rule" } });
			setIcon(x, "x");
			const entry = { prop: p, val: v };
			this.rows.push(entry);
			x.addEventListener("click", () => {
				this.rows.remove(entry);
				row.remove();
			});
		};
		for (const [k, v] of Object.entries(this.view.getRules(this.lane))) addRow(k, v);
		if (!this.rows.length) addRow();
		const add = c.createEl("button", { cls: "pb-rule-add", text: "+ Add rule" });
		add.addEventListener("click", () => addRow());

		const btns = c.createDiv({ cls: "pb-modal-btns" });
		btns.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		const save = btns.createEl("button", { text: "Save", cls: "mod-cta" });
		save.addEventListener("click", () => {
			const rules: Record<string, string> = {};
			for (const r of this.rows) {
				const k = r.prop.value.trim();
				if (k) rules[k] = r.val.value;
			}
			const w = parseInt(this.wipInput.value, 10);
			const tpl = this.tplInput.value.trim();
			this.view.saveLaneSettings(this.lane, Number.isFinite(w) && w > 0 ? w : null, rules, tpl || null);
			this.close();
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** Configure an ID, Button, or Verification field (the extras a bare type
 *  assignment cannot hold). Opened from the header type menu. */
class FieldConfigModal extends Modal {
	private rows: { prop: HTMLInputElement; val: HTMLInputElement }[] = [];
	private prefixInput?: HTMLInputElement;
	private labelInput?: HTMLInputElement;
	private linkInput?: HTMLInputElement;
	private expiryInput?: HTMLInputElement;

	constructor(
		app: App,
		private plugin: PowerBasesPlugin,
		private fmKey: string,
		private type: PBFieldType,
		private propKeys: string[]
	) {
		super(app);
	}

	onOpen() {
		const cfg = this.plugin.fieldConfig(this.fmKey) ?? { type: this.type };
		this.titleEl.setText(`${PB_TYPE_LABEL[this.type]} field: ${this.fmKey}`);
		const c = this.contentEl;
		const propsId = "pb-fc-props-" + Math.floor(Math.random() * 1e9);
		const dl = c.createEl("datalist", { attr: { id: propsId } });
		for (const k of this.propKeys) dl.createEl("option", { attr: { value: k } });

		if (this.type === "id") {
			c.createEl("p", {
				cls: "pb-modal-desc",
				text: "IDs are assigned in order: the prefix followed by the next number. Click Generate in an empty cell to fill one.",
			});
			const row = c.createDiv({ cls: "pb-rule-row" });
			row.createSpan({ cls: "pb-rule-label", text: "Prefix" });
			this.prefixInput = row.createEl("input", { attr: { type: "text", placeholder: "e.g. TASK-" } });
			this.prefixInput.value = cfg.prefix ?? "";
		} else if (this.type === "verification") {
			c.createEl("p", {
				cls: "pb-modal-desc",
				text: "Click a cell's badge to set Verified, Unverified, or Expired. Optionally name a date property, and a verified row past that date reads as Expired.",
			});
			const row = c.createDiv({ cls: "pb-rule-row" });
			row.createSpan({ cls: "pb-rule-label", text: "Expiry date property" });
			this.expiryInput = row.createEl("input", { attr: { type: "text", placeholder: "(optional) e.g. reviewBy", list: propsId } });
			this.expiryInput.value = cfg.verifyExpiryProp ?? "";
		} else if (this.type === "button") {
			c.createEl("p", {
				cls: "pb-modal-desc",
				text: "A button writes properties to its row and can open a link. Values may use {today} or {now}; an empty value removes the property.",
			});
			const labelRow = c.createDiv({ cls: "pb-rule-row" });
			labelRow.createSpan({ cls: "pb-rule-label", text: "Label" });
			this.labelInput = labelRow.createEl("input", { attr: { type: "text", placeholder: "Button text" } });
			this.labelInput.value = cfg.buttonLabel ?? "";

			c.createEl("p", { cls: "pb-rule-head", text: "Set properties on click" });
			const rowsEl = c.createDiv();
			const addRow = (prop = "", val = "") => {
				const row = rowsEl.createDiv({ cls: "pb-rule-row" });
				const p = row.createEl("input", { attr: { type: "text", placeholder: "property", list: propsId } });
				p.value = prop;
				const v = row.createEl("input", { cls: "pb-rule-val", attr: { type: "text", placeholder: "value, {today}, {now}" } });
				v.value = val;
				const x = row.createEl("button", { cls: "pb-rule-x", attr: { "aria-label": "Remove" } });
				setIcon(x, "x");
				const entry = { prop: p, val: v };
				this.rows.push(entry);
				x.addEventListener("click", () => {
					this.rows.remove(entry);
					row.remove();
				});
			};
			for (const [k, v] of Object.entries(cfg.buttonSets ?? {})) addRow(k, v);
			if (!this.rows.length) addRow();
			c.createEl("button", { cls: "pb-rule-add", text: "+ Add property" }).addEventListener("click", () => addRow());

			const linkRow = c.createDiv({ cls: "pb-rule-row" });
			linkRow.createSpan({ cls: "pb-rule-label", text: "Open link" });
			this.linkInput = linkRow.createEl("input", { attr: { type: "text", placeholder: "(optional) URL or note.property", list: propsId } });
			this.linkInput.value = cfg.buttonLink ?? "";
		}

		const btns = c.createDiv({ cls: "pb-modal-btns" });
		btns.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		btns.createEl("button", { text: "Save", cls: "mod-cta" }).addEventListener("click", () => void this.save());
	}

	private async save() {
		const cfg: PBFieldConfig = { type: this.type };
		if (this.type === "id") {
			cfg.prefix = this.prefixInput!.value.trim() || undefined;
		} else if (this.type === "verification") {
			cfg.verifyExpiryProp = this.expiryInput!.value.trim() || undefined;
		} else if (this.type === "button") {
			cfg.buttonLabel = this.labelInput!.value.trim() || undefined;
			const sets: Record<string, string> = {};
			for (const r of this.rows) {
				const k = r.prop.value.trim();
				if (k) sets[k] = r.val.value;
			}
			cfg.buttonSets = Object.keys(sets).length ? sets : undefined;
			cfg.buttonLink = this.linkInput!.value.trim() || undefined;
		}
		await this.plugin.saveFieldConfig(this.fmKey, cfg);
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** Import a CSV into a folder of notes plus a ready base. Each row is a note,
 *  the header row names the columns, and detected link/contact columns get
 *  their Power-Base field type set automatically. */
class CsvImportModal extends Modal {
	private parsed: string[][] | null = null;
	private fileName = "Imported";
	private folderInput!: HTMLInputElement;
	private previewEl!: HTMLElement;
	private importBtn!: HTMLButtonElement;

	constructor(
		app: App,
		private plugin: PowerBasesPlugin,
		private folder: TFolder
	) {
		super(app);
	}

	onOpen() {
		this.titleEl.setText("Import CSV as a base");
		const c = this.contentEl;
		c.createEl("p", {
			cls: "pb-modal-desc",
			text: "Each row becomes a note and the first row names the columns. A ready-made base opens when the import finishes.",
		});

		const fileRow = c.createDiv({ cls: "pb-rule-row" });
		fileRow.createSpan({ cls: "pb-rule-label", text: "CSV file" });
		const file = fileRow.createEl("input", { attr: { type: "file", accept: ".csv,text/csv" } });
		file.addEventListener("change", () => {
			const f = file.files?.[0];
			if (!f) return;
			this.fileName = f.name.replace(/\.csv$/i, "");
			const reader = new FileReader();
			reader.onload = () => this.onText(String(reader.result ?? ""));
			reader.readAsText(f);
		});

		const folderRow = c.createDiv({ cls: "pb-rule-row" });
		folderRow.createSpan({ cls: "pb-rule-label", text: "Into folder" });
		this.folderInput = folderRow.createEl("input", { attr: { type: "text", placeholder: "vault root" } });
		this.folderInput.value = this.folder.path === "/" ? "" : this.folder.path;

		this.previewEl = c.createDiv({ cls: "pb-csv-preview" });

		const btns = c.createDiv({ cls: "pb-modal-btns" });
		btns.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		this.importBtn = btns.createEl("button", { text: "Import", cls: "mod-cta" });
		this.importBtn.disabled = true;
		this.importBtn.addEventListener("click", () => void this.run());
	}

	private onText(text: string) {
		const rows = parseCsv(text);
		if (rows.length < 2) {
			this.previewEl.setText("That file has a header but no data rows.");
			this.parsed = null;
			this.importBtn.disabled = true;
			return;
		}
		this.parsed = rows;
		const headers = rows[0];
		const body = rows.slice(1);
		this.previewEl.empty();
		this.previewEl.createEl("p", { cls: "pb-modal-desc", text: `${body.length} rows, ${headers.length} columns:` });
		const list = this.previewEl.createEl("ul", { cls: "pb-csv-cols" });
		headers.forEach((h, i) => {
			const samples = body.slice(0, 30).map((r) => r[i] ?? "");
			const ft = inferFieldType(h, samples);
			const li = list.createEl("li");
			li.createSpan({ cls: "pb-csv-col", text: sanitizeKey(h, i + 1) });
			li.createSpan({ cls: "pb-csv-kind", text: ft ? PB_TYPE_LABEL[ft] : inferColumnKind(samples) });
		});
		this.importBtn.disabled = false;
	}

	private async run() {
		if (!this.parsed) return;
		this.importBtn.disabled = true;
		this.importBtn.setText("Importing…");
		try {
			const rows = this.parsed;
			const rawHeaders = rows[0];
			const headers = rawHeaders.map((h, i) => sanitizeKey(h, i + 1));
			const body = rows.slice(1);
			const kinds = headers.map((_, i) => inferColumnKind(body.slice(0, 50).map((r) => r[i] ?? "")));
			const fieldTypes = rawHeaders.map((h, i) => inferFieldType(h, body.slice(0, 50).map((r) => r[i] ?? "")));
			let titleIdx = headers.findIndex((h) => /^(name|title|subject|task)$/i.test(h));
			if (titleIdx < 0) titleIdx = 0;

			const parent = this.folderInput.value.trim();
			const folderPath = parent ? parent + "/" + safeName(this.fileName) : safeName(this.fileName);
			await this.plugin.ensureFolder(folderPath);

			let made = 0;
			for (const r of body) {
				const fm: Record<string, unknown> = {};
				headers.forEach((key, i) => {
					if (i === titleIdx) return;
					const v = csvValue(kinds[i], r[i] ?? "");
					if (v !== undefined) fm[key] = v;
				});
				await this.plugin.createNote(folderPath, safeName(r[titleIdx] ?? "", "Row " + (made + 1)), fm);
				made++;
			}

			// carry Power-Base field types the columns hint at
			let typed = false;
			headers.forEach((key, i) => {
				if (i === titleIdx || !fieldTypes[i]) return;
				const cur = this.plugin.settings.fields[key];
				this.plugin.settings.fields[key] = cur ? { ...cur, type: fieldTypes[i] } : { type: fieldTypes[i] };
				typed = true;
			});
			if (typed) await this.plugin.persistSettings();

			const order = ["file.name", ...headers.filter((_, i) => i !== titleIdx).map((k) => "note." + k)];
			const views: BaseViewSpec[] = [{ type: "powerbases-table", name: "Table", order }];
			const dateIdx = kinds.findIndex((k) => k === "date" || k === "datetime");
			if (dateIdx >= 0) views.push({ type: "powerbases-calendar", name: "Calendar", options: { dateProp: "note." + headers[dateIdx] } });
			const groupIdx = headers.findIndex((_, i) => i !== titleIdx && kinds[i] === "text" && !fieldTypes[i]);
			if (groupIdx >= 0) views.push({ type: "powerbases-board", name: "Board", options: { pbGroup: "note." + headers[groupIdx] } });

			const yaml = buildBaseYaml(folderPath, views);
			// close before opening the base so the picker never strands on top of it
			this.close();
			await this.plugin.createBaseFile(folderPath, safeName(this.fileName) + " Base", yaml);
			this.plugin.refreshAll();
			new Notice(`Power Bases: imported ${made} notes into ${folderPath}.`);
		} catch (e) {
			new Notice("Power Bases: CSV import failed. " + (e as Error).message);
			this.importBtn.disabled = false;
			this.importBtn.setText("Import");
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}

interface PBTemplate {
	id: string;
	name: string;
	icon: string;
	desc: string;
	folder: string;
	/** field types to set (global by frontmatter key) when this template lands. */
	fields: Record<string, PBFieldType>;
	views: BaseViewSpec[];
	seeds: { name: string; fm: Record<string, unknown> }[];
}

/** Built-in starter databases. Dates are relative to today so a fresh template
 *  always lands with a sensible calendar and timeline. */
function pbTemplates(): PBTemplate[] {
	const t = todayKey();
	const d = (n: number) => addDays(t, n);
	return [
		{
			id: "tasks",
			name: "Tasks Tracker",
			icon: "check-circle",
			desc: "Status, priority, due date, and an assignee. Board, Table, and Calendar.",
			folder: "Tasks",
			fields: { assignee: "person", ticket: "id" },
			views: [
				{ type: "powerbases-board", name: "Board", options: { pbGroup: "note.status", rankProp: "note.pb-order" } },
				{ type: "powerbases-table", name: "Table", order: ["file.name", "note.ticket", "note.status", "note.priority", "note.assignee", "note.due"] },
				{ type: "powerbases-calendar", name: "Calendar", options: { dateProp: "note.due" } },
			],
			seeds: [
				{ name: "Draft the Q3 brief", fm: { status: "In progress", priority: "High", assignee: "Alex", due: d(3), ticket: "TASK-1" } },
				{ name: "Review vendor quotes", fm: { status: "Backlog", priority: "Medium", assignee: "Sam", due: d(9), ticket: "TASK-2" } },
				{ name: "Publish release notes", fm: { status: "Done", priority: "Low", assignee: "Alex", due: d(-2), ticket: "TASK-3" } },
			],
		},
		{
			id: "roadmap",
			name: "Project Roadmap",
			icon: "milestone",
			desc: "Phases on a timeline with owner and progress. Timeline, Board, and Table.",
			folder: "Roadmap",
			fields: { owner: "person" },
			views: [
				{
					type: "powerbases-timeline",
					name: "Timeline",
					options: { startProp: "note.start", endProp: "note.end", colorProp: "note.status", progressProp: "note.progress", milestoneProp: "note.milestone" },
				},
				{ type: "powerbases-board", name: "Board", options: { pbGroup: "note.status" } },
				{ type: "powerbases-table", name: "Table", order: ["file.name", "note.status", "note.owner", "note.start", "note.end", "note.progress"] },
			],
			seeds: [
				{ name: "Discovery", fm: { status: "Done", owner: "Priya", start: d(-20), end: d(-6), progress: 100 } },
				{ name: "Build", fm: { status: "In progress", owner: "Jordan", start: d(-5), end: d(20), progress: 40 } },
				{ name: "Launch", fm: { status: "Planned", owner: "Priya", start: d(21), end: d(28), progress: 0, milestone: true } },
			],
		},
		{
			id: "features",
			name: "Feature Requests",
			icon: "lightbulb",
			desc: "Votes, requester, status, and a link. Board, Table, and a Chart.",
			folder: "Feature Requests",
			fields: { requester: "person", link: "url" },
			views: [
				{ type: "powerbases-board", name: "Board", options: { pbGroup: "note.status" } },
				{ type: "powerbases-table", name: "Table", order: ["file.name", "note.status", "note.votes", "note.requester", "note.link"] },
				{ type: "powerbases-chart", name: "Chart", options: { chartType: "bar", groupProp: "note.status", chartAgg: "count" } },
			],
			seeds: [
				{ name: "Dark mode for exports", fm: { status: "Under review", votes: 42, requester: "Robin", link: "https://example.com/req/1" } },
				{ name: "Bulk edit rows", fm: { status: "Planned", votes: 88, requester: "Casey", link: "https://example.com/req/2" } },
				{ name: "Mobile widgets", fm: { status: "Shipped", votes: 17, requester: "Robin", link: "https://example.com/req/3" } },
			],
		},
		{
			id: "contacts",
			name: "Contacts",
			icon: "contact",
			desc: "An address book showing off Email, Phone, URL, Person, and Place.",
			folder: "Contacts",
			fields: { email: "email", phone: "phone", website: "url", owner: "person", address: "place" },
			views: [
				{ type: "powerbases-table", name: "Table", order: ["file.name", "note.company", "note.email", "note.phone", "note.website", "note.owner", "note.address"] },
				{ type: "powerbases-board", name: "By company", options: { pbGroup: "note.company" } },
			],
			seeds: [
				{ name: "Dana Reyes", fm: { company: "Acme Co", email: "dana@acme.com", phone: "+1 555 0100", website: "acme.com", owner: "Sam", address: "1 Market St, San Francisco" } },
				{ name: "Lee Park", fm: { company: "Globex", email: "lee@globex.io", phone: "+1 555 0142", website: "globex.io", owner: "Alex", address: "500 5th Ave, New York" } },
			],
		},
	];
}

/** Pick a starter database; it lands as a folder of example notes plus a base. */
class TemplateModal extends Modal {
	constructor(
		app: App,
		private plugin: PowerBasesPlugin,
		private folder: TFolder
	) {
		super(app);
	}

	onOpen() {
		this.titleEl.setText("New base from a template");
		const c = this.contentEl;
		c.createEl("p", {
			cls: "pb-modal-desc",
			text: "Each template creates a folder with a few example notes and a ready base. The field types are set for you.",
		});
		const list = c.createDiv({ cls: "pb-tpl-list" });
		for (const tpl of pbTemplates()) {
			const card = list.createDiv({ cls: "pb-tpl-card" });
			setIcon(card.createSpan({ cls: "pb-tpl-ic" }), tpl.icon);
			const body = card.createDiv({ cls: "pb-tpl-body" });
			body.createDiv({ cls: "pb-tpl-name", text: tpl.name });
			body.createDiv({ cls: "pb-tpl-desc", text: tpl.desc });
			card.setAttribute("tabindex", "0");
			card.addEventListener("click", () => void this.generate(tpl));
			card.addEventListener("keydown", (e) => {
				if (e.key === "Enter") void this.generate(tpl);
			});
		}
		c.createDiv({ cls: "pb-modal-btns" })
			.createEl("button", { text: "Cancel" })
			.addEventListener("click", () => this.close());
	}

	private async generate(tpl: PBTemplate) {
		const parent = this.folder.path === "/" ? "" : this.folder.path;
		const folderPath = parent ? parent + "/" + tpl.folder : tpl.folder;
		try {
			await this.plugin.ensureFolder(folderPath);
			for (const seed of tpl.seeds) await this.plugin.createNote(folderPath, seed.name, seed.fm);
			for (const [k, ft] of Object.entries(tpl.fields)) {
				const cur = this.plugin.settings.fields[k];
				this.plugin.settings.fields[k] = cur ? { ...cur, type: ft } : { type: ft };
			}
			await this.plugin.persistSettings();
			const yaml = buildBaseYaml(folderPath, tpl.views);
			// close the picker BEFORE opening the base, so the new view takes focus
			// cleanly and nothing after this can leave the modal stranded on top
			this.close();
			await this.plugin.createBaseFile(folderPath, tpl.name, yaml);
			this.plugin.refreshAll();
			new Notice(`Power Bases: ${tpl.name} ready in ${folderPath}.`);
		} catch (e) {
			new Notice("Power Bases: template failed. " + (e as Error).message);
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** The base config's parsed YAML (formulas live at the top level, not in view
 *  config, so these round-trip the whole .base file). */
async function readBaseConfig(app: App, file: TFile): Promise<Record<string, unknown>> {
	const parsed: unknown = parseYaml(await app.vault.read(file));
	return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

/** Read, change, and write the base config in one pass. The read happens inside
 *  process(), so an edit landing between the two (a sync, another view writing
 *  its own order) is folded in rather than overwritten. */
async function updateBaseConfig(app: App, file: TFile, change: (cfg: Record<string, unknown>) => void): Promise<void> {
	await app.vault.process(file, (data) => {
		const parsed: unknown = parseYaml(data);
		const cfg = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
		change(cfg);
		return stringifyYaml(cfg);
	});
}

/** Write a formula into the base's native `formulas:` map and add its column to
 *  the given view's order, so it shows up the moment Bases reloads the file. */
async function writeFormula(
	app: App,
	file: TFile,
	name: string,
	expr: string,
	viewName: string,
	viewType: string,
	currentOrder: string[]
) {
	await updateBaseConfig(app, file, (cfg) => {
		const formulas = (cfg.formulas as Record<string, string>) ?? {};
		formulas[name] = expr;
		cfg.formulas = formulas;
		const id = "formula." + name;
		if (Array.isArray(cfg.views)) {
			const v = (cfg.views as Record<string, unknown>[]).find((x) => x?.type === viewType && x?.name === viewName);
			if (v) {
				const order: string[] = Array.isArray(v.order) ? (v.order as string[]).slice() : currentOrder.slice();
				if (!order.includes(id)) order.push(id);
				v.order = order;
			}
		}
	});
}

/** Remove a formula from the base and drop its column from every view's order. */
async function removeFormula(app: App, file: TFile, name: string) {
	await updateBaseConfig(app, file, (cfg) => {
		if (cfg.formulas && typeof cfg.formulas === "object") delete (cfg.formulas as Record<string, string>)[name];
		const id = "formula." + name;
		if (Array.isArray(cfg.views)) {
			for (const v of cfg.views as Record<string, unknown>[]) {
				if (Array.isArray(v.order)) v.order = (v.order as string[]).filter((o) => o !== id);
			}
		}
	});
}

/** A new property column added to a view's order in the base file. The property
 *  needs no note to exist yet: Power Table renders an empty, editable column. */
async function addViewColumn(
	app: App,
	file: TFile,
	propId: string,
	viewName: string,
	viewType: string,
	currentOrder: string[],
	viewOpts?: Record<string, unknown>,
	at?: number
) {
	await updateBaseConfig(app, file, (cfg) => {
		if (Array.isArray(cfg.views)) {
			const v = (cfg.views as Record<string, unknown>[]).find((x) => x?.type === viewType && x?.name === viewName);
			if (v) {
				const order: string[] = Array.isArray(v.order) ? (v.order as string[]).slice() : currentOrder.slice();
				if (!order.includes(propId)) {
					if (typeof at === "number") order.splice(Math.max(0, Math.min(order.length, at)), 0, propId);
					else order.push(propId);
				}
				v.order = order;
				if (viewOpts) for (const [k, val] of Object.entries(viewOpts)) v[k] = val;
			}
		}
	});
}

/** Rename a column in the base file: swap its id in every view's order and in
 *  any view keys tied to it (color:, agg:), and rename the formula if it is one. */
async function renamePropertyInBase(app: App, file: TFile, oldId: string, newId: string, isFormula: boolean, oldName: string, newName: string) {
	await updateBaseConfig(app, file, (cfg) => {
		if (isFormula && cfg.formulas && typeof cfg.formulas === "object") {
			const f = cfg.formulas as Record<string, string>;
			if (f[oldName] !== undefined) {
				f[newName] = f[oldName];
				delete f[oldName];
			}
		}
		if (Array.isArray(cfg.views)) {
			for (const v of cfg.views as Record<string, unknown>[]) {
				if (Array.isArray(v.order)) v.order = (v.order as string[]).map((o) => (o === oldId ? newId : o));
				for (const k of Object.keys(v)) {
					const colon = k.indexOf(":");
					if (colon > 0 && k.slice(colon + 1) === oldId) {
						v[k.slice(0, colon + 1) + newId] = v[k];
						delete v[k];
					}
				}
			}
		}
	});
}

/** Overwrite a view's column order in the base file (column drag-reorder). */
async function writeViewOrder(app: App, file: TFile, viewName: string, viewType: string, order: string[]) {
	await updateBaseConfig(app, file, (cfg) => {
		if (Array.isArray(cfg.views)) {
			const v = (cfg.views as Record<string, unknown>[]).find((x) => x?.type === viewType && x?.name === viewName);
			if (v) v.order = order;
		}
	});
}

/** The function reference shown in the formula editor; clicking a signature
 *  drops its snippet into the expression. */
const FORMULA_FUNCTIONS: { sig: string; desc: string; insert: string }[] = [
	{ sig: 'note["Property"]', desc: "A note's property (brackets allow spaces).", insert: 'note["Property"]' },
	{ sig: "formula.other", desc: "Reuse another formula in this base.", insert: "formula.other" },
	{ sig: "a + b   a - b   a * b   a / b", desc: "Arithmetic; + also joins text.", insert: "" },
	{ sig: "round(x, digits)", desc: "Round to a number of decimals.", insert: "round(x, 2)" },
	{ sig: "x.toFixed(digits)", desc: "Fixed-decimal text, e.g. 9.50.", insert: ".toFixed(2)" },
	{ sig: "abs, ceil, floor (x)", desc: "Absolute value, round up, round down.", insert: "" },
	{ sig: "min(a, b, ...)   max(a, b, ...)", desc: "Smallest or largest value.", insert: "" },
	{ sig: "if(cond, a, b)", desc: "a when cond is true, else b.", insert: "if(, , )" },
	{ sig: "concat(a, b, ...)", desc: "Join values into one text.", insert: "concat(, )" },
	{ sig: "contains(text, part)", desc: "True when text holds part.", insert: "contains(, )" },
	{ sig: "lower, upper, trim (text)", desc: "Lowercase, uppercase, trim spaces.", insert: "" },
	{ sig: "length(x)", desc: "Character count.", insert: "" },
];

/** Notion-style formula editor over the base's NATIVE formulas: write an
 *  expression, preview it live on a sample row (Bases computes the saved
 *  column), and browse the function reference. */
class FormulaModal extends Modal {
	private nameInput!: HTMLInputElement;
	private exprInput!: HTMLTextAreaElement;
	private rowSelect!: HTMLSelectElement;
	private previewEl!: HTMLElement;
	private readonly entries: BasesEntry[];
	private formulas: Record<string, string> = {};

	constructor(
		app: App,
		private plugin: PowerBasesPlugin,
		private view: PowerTableView,
		private baseFile: TFile,
		private editKey?: string
	) {
		super(app);
		this.entries = view.sampleEntries();
	}

	onOpen() {
		this.titleEl.setText(this.editKey ? `Edit formula: ${this.editKey}` : "Add formula column");
		const c = this.contentEl;
		c.addClass("pb-formula-modal");
		c.createEl("p", {
			cls: "pb-modal-desc",
			text: "Formulas are Obsidian Bases formulas, saved in this base. The preview is a quick check; Bases computes the real column.",
		});

		const nameRow = c.createDiv({ cls: "pb-rule-row" });
		nameRow.createSpan({ cls: "pb-rule-label", text: "Name" });
		this.nameInput = nameRow.createEl("input", { attr: { type: "text", placeholder: "e.g. mo_rent" } });
		this.nameInput.value = this.editKey ?? "";
		if (this.editKey) this.nameInput.disabled = true;

		c.createEl("p", { cls: "pb-rule-head", text: "Formula" });
		this.exprInput = c.createEl("textarea", { cls: "pb-formula-expr", attr: { rows: "3", placeholder: 'note["Rent"] * note["SQM"]' } });
		this.exprInput.addEventListener("input", () => this.updatePreview());

		const prevRow = c.createDiv({ cls: "pb-formula-prevrow" });
		prevRow.createSpan({ cls: "pb-rule-label", text: "Preview" });
		this.rowSelect = prevRow.createEl("select", { cls: ["pb-formula-rowsel", "dropdown"] });
		if (!this.entries.length) this.rowSelect.createEl("option", { text: "no rows" });
		this.entries.forEach((en, i) => this.rowSelect.createEl("option", { attr: { value: String(i) }, text: en.file.basename }));
		this.rowSelect.addEventListener("change", () => this.updatePreview());
		this.previewEl = c.createDiv({ cls: "pb-formula-preview" });

		const ref = c.createEl("details", { cls: "pb-formula-ref" });
		ref.createEl("summary", { text: "Function reference" });
		for (const f of FORMULA_FUNCTIONS) {
			const item = ref.createDiv({ cls: "pb-fn" });
			const sig = item.createEl("code", { cls: "pb-fn-sig", text: f.sig });
			item.createSpan({ cls: "pb-fn-desc", text: f.desc });
			if (f.insert) sig.addEventListener("click", () => this.insert(f.insert));
			else sig.addClass("pb-fn-flat");
		}

		const btns = c.createDiv({ cls: "pb-modal-btns" });
		if (this.editKey) {
			const del = btns.createEl("button", { cls: "pb-fn-del", text: "Delete" });
			del.addEventListener("click", () => void this.remove());
		}
		btns.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		btns.createEl("button", { text: "Save", cls: "mod-cta" }).addEventListener("click", () => void this.save());

		this.updatePreview();
		void this.loadFormulas();
	}

	/** Read the base's existing formulas so `formula.x` refs preview and an edit
	 *  prefills the expression. */
	private async loadFormulas() {
		try {
			const cfg = await readBaseConfig(this.app, this.baseFile);
			this.formulas = (cfg.formulas as Record<string, string>) ?? {};
		} catch {
			this.formulas = {};
		}
		if (this.editKey && !this.exprInput.value) this.exprInput.value = this.formulas[this.editKey] ?? "";
		this.updatePreview();
	}

	private currentRow(): { fm: Record<string, unknown>; en: BasesEntry | undefined } {
		const en = this.entries[Number(this.rowSelect.value) || 0];
		return { fm: en ? frontmatterOf(this.app, en.file) ?? {} : {}, en };
	}

	private updatePreview() {
		const expr = this.exprInput.value;
		this.previewEl.empty();
		if (!expr.trim()) {
			this.previewEl.createSpan({ cls: "pb-formula-empty", text: "Type a formula to preview it." });
			return;
		}
		const { fm, en } = this.currentRow();
		const fileCtx = en ? { name: en.file.basename, ext: en.file.extension, path: en.file.path } : undefined;
		const res = evalFormula(expr, fm, this.formulas, fileCtx);
		if (res.ok) {
			this.previewEl.createSpan({ cls: "pb-formula-val", text: res.value === null ? "(empty)" : String(res.value) });
			if (res.value !== null) this.previewEl.createSpan({ cls: "pb-formula-type", text: typeof res.value });
		} else {
			this.previewEl.createSpan({ cls: "pb-formula-err", text: "Preview unavailable here; Bases will still compute it once saved." });
		}
	}

	private insert(text: string) {
		const el = this.exprInput;
		const s = el.selectionStart ?? el.value.length;
		const e = el.selectionEnd ?? el.value.length;
		el.value = el.value.slice(0, s) + text + el.value.slice(e);
		el.focus();
		el.selectionStart = el.selectionEnd = s + text.length;
		this.updatePreview();
	}

	private async save() {
		const name = safeFormulaName(this.editKey ?? this.nameInput.value);
		const expr = this.exprInput.value.trim();
		if (!name) {
			new Notice("Power Bases: give the formula a name.");
			return;
		}
		if (!expr) {
			new Notice("Power Bases: enter a formula.");
			return;
		}
		this.close();
		try {
			await writeFormula(this.app, this.baseFile, name, expr, this.view.viewName(), this.view.type, this.view.currentOrder());
			this.plugin.refreshAll();
			new Notice(`Power Bases: formula "${name}" saved.`);
		} catch (e) {
			new Notice("Power Bases: could not save formula. " + (e as Error).message);
		}
	}

	private async remove() {
		if (!this.editKey) return;
		this.close();
		try {
			await removeFormula(this.app, this.baseFile, this.editKey);
			this.plugin.refreshAll();
			new Notice(`Power Bases: deleted formula "${this.editKey}".`);
		} catch (e) {
			new Notice("Power Bases: could not delete formula. " + (e as Error).message);
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** Per-column number formatting: decimals, thousands grouping, and an optional
 *  prefix/suffix, with a live sample. Stored global by property id, applied to
 *  numeric cells (formula columns and number properties) in Power Table. */
/** A checklist of sibling columns for bulk-applying a format; returns a getter
 *  for the currently-checked property ids. */
function applyToChecklist(c: HTMLElement, others: { propId: string; label: string }[]): () => string[] {
	if (!others.length) return () => [];
	c.createEl("p", { cls: "pb-rule-head", text: "Also apply to" });
	const wrap = c.createDiv({ cls: "pb-fmt-cols" });
	const checked = new Set<string>();
	for (const col of others) {
		const lab = wrap.createEl("label", { cls: "pb-fmt-col" });
		const cb = lab.createEl("input", { cls: "pb-check", attr: { type: "checkbox" } });
		cb.addEventListener("change", () => {
			if (cb.checked) checked.add(col.propId);
			else checked.delete(col.propId);
		});
		lab.createSpan({ text: col.label });
	}
	return () => [...checked];
}

/** Per-column number formatting: a "Show as" visual (bar, ring, stars, dots,
 *  percent, traffic light) with color, a worldwide-currency picker, decimals,
 *  grouping, prefix/suffix, a live preview, and a bulk "also apply to" picker. */
class NumberFormatModal extends Modal {
	private fmt: NumberFormat;
	private previewEl!: HTMLElement;

	constructor(
		app: App,
		private plugin: PowerBasesPlugin,
		private propId: string,
		private others: { propId: string; label: string }[] = []
	) {
		super(app);
		this.fmt = { ...(plugin.numberFormat(propId) ?? {}) };
	}

	onOpen() {
		this.titleEl.setText("Number format");
		const c = this.contentEl;
		c.addClass("pb-numfmt-modal");
		c.addClass("pb-fmt");
		c.createEl("p", {
			cls: "pb-modal-desc",
			text: `How numbers show in the "${this.propId.replace(/^(note|formula)\./, "")}" column.`,
		});
		const show = (el: HTMLElement, on: boolean) => (el.style.display = on ? "" : "none");

		// Show as
		const showRow = c.createDiv({ cls: "pb-rule-row" });
		showRow.createSpan({ cls: "pb-rule-label", text: "Show as" });
		const showSel = showRow.createEl("select", { cls: "dropdown" });
		for (const [val, label] of [
			["plain", "Plain number"],
			["bar", "Bar"],
			["ring", "Ring"],
			["stars", "Stars"],
			["dots", "Dots"],
			["percent", "Percent"],
			["traffic", "Traffic light"],
		] as [NumberDisplay, string][])
			showSel.createEl("option", { attr: { value: val }, text: label });
		showSel.value = this.fmt.display ?? "plain";

		// Color (bar/ring/stars/dots)
		const colorRow = c.createDiv({ cls: "pb-rule-row" });
		colorRow.createSpan({ cls: "pb-rule-label", text: "Color" });
		const swatches = colorRow.createDiv({ cls: "pb-swatches" });
		const swatchEls: { hex: string; el: HTMLElement }[] = [];
		const paintSwatches = () => swatchEls.forEach((s) => s.el.toggleClass("is-sel", (this.fmt.color ?? "") === s.hex));
		const addSwatch = (hex: string, title: string) => {
			const b = swatches.createEl("button", { cls: "pb-swatch" + (hex ? "" : " pb-swatch-default"), attr: { "aria-label": title } });
			if (hex) b.style.background = hex;
			b.addEventListener("click", () => {
				this.fmt.color = hex || undefined;
				paintSwatches();
				this.preview();
			});
			swatchEls.push({ hex, el: b });
		};
		addSwatch("", "Default");
		for (const [name, hex] of NAMED_PALETTE) addSwatch(hex, name);
		paintSwatches();

		// Show number (any visual)
		const snRow = c.createDiv({ cls: "pb-rule-row" });
		snRow.createSpan({ cls: "pb-rule-label", text: "Show number" });
		const sn = snRow.createEl("input", { cls: "pb-check", attr: { type: "checkbox" } });
		sn.checked = this.fmt.showNumber !== false;
		sn.addEventListener("change", () => {
			this.fmt.showNumber = sn.checked;
			this.preview();
		});
		snRow.createSpan({ cls: "pb-rule-hint", text: "show the value beside the visual" });

		// Max / count (bar/ring/percent = out of; stars/dots = icon count)
		const maxRow = c.createDiv({ cls: "pb-rule-row" });
		const maxLabel = maxRow.createSpan({ cls: "pb-rule-label", text: "Out of" });
		const maxIn = maxRow.createEl("input", { attr: { type: "number", min: "1", placeholder: "column max" } });
		if (this.fmt.max != null) maxIn.value = String(this.fmt.max);
		maxIn.addEventListener("input", () => {
			const v = maxIn.value.trim();
			this.fmt.max = v === "" ? null : Number(v);
			this.preview();
		});

		// Traffic-light thresholds
		const lowRow = c.createDiv({ cls: "pb-rule-row" });
		lowRow.createSpan({ cls: "pb-rule-label", text: "Red below" });
		const lowIn = lowRow.createEl("input", { attr: { type: "number", placeholder: "⅓ of max" } });
		if (this.fmt.low != null) lowIn.value = String(this.fmt.low);
		lowIn.addEventListener("input", () => {
			const v = lowIn.value.trim();
			this.fmt.low = v === "" ? null : Number(v);
			this.preview();
		});
		const highRow = c.createDiv({ cls: "pb-rule-row" });
		highRow.createSpan({ cls: "pb-rule-label", text: "Green at" });
		const highIn = highRow.createEl("input", { attr: { type: "number", placeholder: "⅔ of max" } });
		if (this.fmt.high != null) highIn.value = String(this.fmt.high);
		highIn.addEventListener("input", () => {
			const v = highIn.value.trim();
			this.fmt.high = v === "" ? null : Number(v);
			this.preview();
		});

		// Decimals / thousands / prefix / suffix / currency (format the number text)
		const decRow = c.createDiv({ cls: "pb-rule-row" });
		decRow.createSpan({ cls: "pb-rule-label", text: "Decimals" });
		const spin = decRow.createDiv({ cls: "pb-spin" });
		const dec = spin.createEl("input", { attr: { type: "text", inputmode: "numeric", placeholder: "as-is" } });
		if (this.fmt.decimals != null) dec.value = String(this.fmt.decimals);
		dec.addEventListener("input", () => {
			const v = dec.value.trim();
			this.fmt.decimals = v === "" ? null : Math.max(0, Math.min(8, parseInt(v, 10) || 0));
			this.preview();
		});
		// Excel-style steppers: as-is, then 0 through 8 and back down to as-is
		const setDec = (n: number | null) => {
			this.fmt.decimals = n;
			dec.value = n == null ? "" : String(n);
			this.preview();
		};
		const step = (d: 1 | -1) => {
			const cur = this.fmt.decimals;
			if (d > 0) setDec(cur == null ? 0 : Math.min(8, cur + 1));
			else setDec(cur == null || cur === 0 ? null : cur - 1);
		};
		const spinBtns = spin.createDiv({ cls: "pb-spin-btns" });
		const upB = spinBtns.createEl("button", { cls: "pb-spin-b", attr: { "aria-label": "More decimals" } });
		setIcon(upB, "chevron-up");
		upB.addEventListener("click", () => step(1));
		const dnB = spinBtns.createEl("button", { cls: "pb-spin-b", attr: { "aria-label": "Fewer decimals" } });
		setIcon(dnB, "chevron-down");
		dnB.addEventListener("click", () => step(-1));
		dec.addEventListener("keydown", (e) => {
			if (e.key === "ArrowUp") {
				e.preventDefault();
				step(1);
			} else if (e.key === "ArrowDown") {
				e.preventDefault();
				step(-1);
			}
		});

		const thRow = c.createDiv({ cls: "pb-rule-row" });
		thRow.createSpan({ cls: "pb-rule-label", text: "Thousands" });
		const th = thRow.createEl("input", { cls: "pb-check", attr: { type: "checkbox" } });
		th.checked = !!this.fmt.thousands;
		th.addEventListener("change", () => {
			this.fmt.thousands = th.checked;
			this.preview();
		});
		thRow.createSpan({ cls: "pb-rule-hint", text: "group with commas (1,234,567)" });

		const preRow = c.createDiv({ cls: "pb-rule-row" });
		preRow.createSpan({ cls: "pb-rule-label", text: "Prefix" });
		const pre = preRow.createEl("input", { attr: { type: "text", placeholder: "e.g. unit or symbol" } });
		pre.value = this.fmt.prefix ?? "";
		pre.addEventListener("input", () => {
			this.fmt.prefix = pre.value || undefined;
			this.preview();
		});

		const sufRow = c.createDiv({ cls: "pb-rule-row" });
		sufRow.createSpan({ cls: "pb-rule-label", text: "Suffix" });
		const suf = sufRow.createEl("input", { attr: { type: "text", placeholder: "e.g. % or /mo" } });
		suf.value = this.fmt.suffix ?? "";
		suf.addEventListener("input", () => {
			this.fmt.suffix = suf.value || undefined;
			this.preview();
		});

		const curRow = c.createDiv({ cls: "pb-rule-row" });
		curRow.createSpan({ cls: "pb-rule-label", text: "Currency" });
		const cur = curRow.createEl("select", { cls: "dropdown" });
		cur.createEl("option", { attr: { value: "" }, text: "None" });
		for (const cc of CURRENCIES) cur.createEl("option", { attr: { value: cc.code }, text: `${cc.name} (${cc.symbol.trim()})` });
		cur.value = this.fmt.currency ?? "";
		cur.addEventListener("change", () => {
			this.fmt.currency = cur.value || undefined;
			// a picked currency implies grouping and two decimals, as a convenience
			if (this.fmt.currency) {
				this.fmt.thousands = true;
				th.checked = true;
				if (this.fmt.decimals == null) {
					this.fmt.decimals = 2;
					dec.value = "2";
				}
			}
			this.preview();
		});

		const sync = () => {
			const d = this.fmt.display ?? "plain";
			const visual = d === "bar" || d === "ring" || d === "stars" || d === "dots";
			show(colorRow, visual);
			show(snRow, visual || d === "traffic");
			show(maxRow, visual || d === "percent");
			show(lowRow, d === "traffic");
			show(highRow, d === "traffic");
			maxLabel.setText(d === "stars" ? "Stars" : d === "dots" ? "Dots" : "Out of");
			maxIn.placeholder = d === "stars" || d === "dots" ? "5" : "column max";
		};
		showSel.addEventListener("change", () => {
			this.fmt.display = showSel.value === "plain" ? undefined : (showSel.value as NumberDisplay);
			sync();
			this.preview();
		});

		const prevRow = c.createDiv({ cls: "pb-formula-prevrow" });
		prevRow.createSpan({ cls: "pb-rule-label", text: "Preview" });
		this.previewEl = prevRow.createDiv({ cls: "pb-numfmt-preview" });

		const getApplyTo = applyToChecklist(c, this.others);

		const btns = c.createDiv({ cls: "pb-modal-btns" });
		const rm = btns.createEl("button", { cls: "pb-fn-del", text: "Remove" });
		onEventAsync(rm, "click", async () => {
			await this.plugin.applyNumberFormat([this.propId, ...getApplyTo()], null);
			this.close();
		});
		btns.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		const save = btns.createEl("button", { text: "Save", cls: "mod-cta" });
		onEventAsync(save, "click", async () => {
			await this.plugin.applyNumberFormat([this.propId, ...getApplyTo()], this.fmt);
			this.close();
		});

		sync();
		this.preview();
	}

	/** Render the current format at a representative value, so bars fill, stars
	 *  light up, and text formats update as the controls change. */
	private preview() {
		const fmt = this.fmt;
		const d = fmt.display ?? "plain";
		this.previewEl.empty();
		if (d === "plain") {
			this.previewEl.createSpan({ cls: "pb-formula-val", text: hasNumberFormat(fmt) ? formatNumberValue(1234567.891, fmt) : "1234567.891 (plain)" });
		} else if (d === "percent") {
			this.previewEl.createSpan({ cls: "pb-formula-val", text: formatPercent(65, fmt.max ?? 100, fmt.decimals ?? 0) });
		} else if (d === "stars" || d === "dots") {
			const count = fmt.max ?? 5;
			renderMeter(this.previewEl, Math.max(1, Math.round(count * 0.6)), count, fmt);
		} else {
			const max = fmt.max ?? 100;
			renderMeter(this.previewEl, 0.65 * max, max, fmt);
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** Per-column date/time formatting: a style preset, an optional time part, a
 *  live sample, and the same bulk "also apply to" picker. */
class DateFormatModal extends Modal {
	private fmt: DateFormat;
	private sampleEl!: HTMLElement;

	constructor(
		app: App,
		private plugin: PowerBasesPlugin,
		private propId: string,
		private others: { propId: string; label: string }[] = []
	) {
		super(app);
		this.fmt = { ...(plugin.dateFormat(propId) ?? {}) };
	}

	onOpen() {
		this.titleEl.setText("Date format");
		const c = this.contentEl;
		c.addClass("pb-fmt");
		c.createEl("p", {
			cls: "pb-modal-desc",
			text: `How dates show in the "${this.propId.replace(/^(note|formula|file)\./, "")}" column.`,
		});

		const styleRow = c.createDiv({ cls: "pb-rule-row" });
		styleRow.createSpan({ cls: "pb-rule-label", text: "Style" });
		const style = styleRow.createEl("select", { cls: "dropdown" });
		const PRESETS: [DatePreset, string][] = [
			["iso", "2026-07-12"],
			["us", "07/12/2026"],
			["eu", "12/07/2026"],
			["medium", "Jul 12, 2026"],
			["long", "July 12, 2026"],
			["relative", "Relative (2 days ago)"],
		];
		for (const [val, label] of PRESETS) style.createEl("option", { attr: { value: val }, text: label });
		style.value = this.fmt.preset ?? "iso";
		style.addEventListener("change", () => {
			this.fmt.preset = style.value as DatePreset;
			this.sample();
		});

		const timeRow = c.createDiv({ cls: "pb-rule-row" });
		timeRow.createSpan({ cls: "pb-rule-label", text: "Time" });
		const time = timeRow.createEl("select", { cls: "dropdown" });
		for (const [val, label] of [
			["none", "No time"],
			["24h", "24-hour (13:05)"],
			["12h", "12-hour (1:05 PM)"],
		] as [string, string][])
			time.createEl("option", { attr: { value: val }, text: label });
		time.value = this.fmt.time ?? "none";
		time.addEventListener("change", () => {
			this.fmt.time = time.value as DateFormat["time"];
			this.sample();
		});

		const sampRow = c.createDiv({ cls: "pb-formula-prevrow" });
		sampRow.createSpan({ cls: "pb-rule-label", text: "Sample" });
		this.sampleEl = sampRow.createSpan({ cls: "pb-formula-val" });
		this.sample();

		const getApplyTo = applyToChecklist(c, this.others);

		const btns = c.createDiv({ cls: "pb-modal-btns" });
		const rm = btns.createEl("button", { cls: "pb-fn-del", text: "Remove" });
		onEventAsync(rm, "click", async () => {
			await this.plugin.applyDateFormat([this.propId, ...getApplyTo()], null);
			this.close();
		});
		btns.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		const save = btns.createEl("button", { text: "Save", cls: "mod-cta" });
		onEventAsync(save, "click", async () => {
			await this.plugin.applyDateFormat([this.propId, ...getApplyTo()], this.fmt);
			this.close();
		});
	}

	private sample() {
		// a datetime so the preview shows both the date and (if on) the time part
		this.sampleEl.setText(formatDateValue("2026-07-12T13:05", this.fmt, todayKey()));
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** Per-column phone display style: a grouped style for North-American numbers
 *  (or "as typed" for international), a live sample, and the bulk-apply picker. */
class PhoneFormatModal extends Modal {
	private fmt: PhoneFormat;
	private sampleEl!: HTMLElement;

	constructor(
		app: App,
		private plugin: PowerBasesPlugin,
		private propId: string,
		private others: { propId: string; label: string }[] = []
	) {
		super(app);
		this.fmt = { style: plugin.phoneFormat(propId)?.style ?? "raw" };
	}

	onOpen() {
		this.titleEl.setText("Phone format");
		const c = this.contentEl;
		c.addClass("pb-fmt");
		c.createEl("p", {
			cls: "pb-modal-desc",
			text: `How numbers show in the "${this.propId.replace(/^note\./, "")}" column. The grouped styles apply to 10-digit US and Canadian numbers; a number with any country code other than +1 shows exactly as typed, so international numbers keep their own spacing.`,
		});

		const styleRow = c.createDiv({ cls: "pb-rule-row" });
		styleRow.createSpan({ cls: "pb-rule-label", text: "Style" });
		const style = styleRow.createEl("select", { cls: "dropdown" });
		const STYLES: [PhoneStyle, string][] = [
			["raw", "As typed (free text)"],
			["hyphens", "Hyphens: 800-555-1212"],
			["parens", "Parentheses: (800) 555-1212"],
			["spaces", "Spaces: 800 555 1212"],
			["dots", "Dots: 800.555.1212"],
		];
		for (const [val, label] of STYLES) style.createEl("option", { attr: { value: val }, text: label });
		style.value = this.fmt.style;
		style.addEventListener("change", () => {
			this.fmt.style = style.value as PhoneStyle;
			this.sample();
		});

		const sampRow = c.createDiv({ cls: "pb-formula-prevrow" });
		sampRow.createSpan({ cls: "pb-rule-label", text: "Sample" });
		this.sampleEl = sampRow.createSpan({ cls: "pb-formula-val" });
		this.sample();

		const getApplyTo = applyToChecklist(c, this.others);

		const btns = c.createDiv({ cls: "pb-modal-btns" });
		const rm = btns.createEl("button", { cls: "pb-fn-del", text: "Remove" });
		onEventAsync(rm, "click", async () => {
			await this.plugin.applyPhoneFormat([this.propId, ...getApplyTo()], null);
			this.close();
		});
		btns.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		const save = btns.createEl("button", { text: "Save", cls: "mod-cta" });
		onEventAsync(save, "click", async () => {
			await this.plugin.applyPhoneFormat([this.propId, ...getApplyTo()], this.fmt);
			this.close();
		});
	}

	private sample() {
		this.sampleEl.setText(formatPhoneValue("8005551212", this.fmt));
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** One row in a column-flyout submenu (Set type, Calculate). */
interface PBSubItem {
	icon?: string;
	label: string;
	checked?: boolean;
	onClick: () => void;
}

/** Everything the "+ Column" dialog can create: a plain typed property, a
 *  Power-Base field type, a colored Select/Status, or a formula. */
type AddColType =
	| "text"
	| "number"
	| "date"
	| "datetime"
	| "checkbox"
	| "list"
	| "ctime"
	| "mtime"
	| PBFieldType
	| "formula"
	| "select"
	| "status";

/** A small yes/no confirmation before a destructive action. */
class ConfirmModal extends Modal {
	constructor(
		app: App,
		private opts: { title: string; body: string; confirmText?: string; onConfirm: () => void }
	) {
		super(app);
	}

	onOpen() {
		this.titleEl.setText(this.opts.title);
		this.contentEl.createEl("p", { cls: "pb-modal-desc", text: this.opts.body });
		const btns = this.contentEl.createDiv({ cls: "pb-modal-btns" });
		btns.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		const ok = btns.createEl("button", { text: this.opts.confirmText ?? "Delete", cls: "mod-warning" });
		ok.addEventListener("click", () => {
			this.close();
			this.opts.onConfirm();
		});
		window.setTimeout(() => ok.focus(), 0);
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** Bulk "set property": one column, one value, written across the selected
 *  rows as a single undoable change. */
class SetPropertyModal extends Modal {
	constructor(
		app: App,
		private view: PowerTableView,
		private files: TFile[]
	) {
		super(app);
	}

	onOpen() {
		this.titleEl.setText(`Set a property on ${this.files.length} row${this.files.length === 1 ? "" : "s"}`);
		const c = this.contentEl;
		c.addClass("pb-fmt");
		const cols = this.view.noteColumns();
		if (!cols.length) {
			c.createEl("p", { cls: "pb-modal-desc", text: "This view has no property columns to set." });
			return;
		}
		const colRow = c.createDiv({ cls: "pb-rule-row" });
		colRow.createSpan({ cls: "pb-rule-label", text: "Column" });
		const sel = colRow.createEl("select", { cls: "dropdown" });
		for (const o of cols) sel.createEl("option", { attr: { value: o.key }, text: o.label });
		const valRow = c.createDiv({ cls: "pb-rule-row" });
		valRow.createSpan({ cls: "pb-rule-label", text: "Value" });
		const val = valRow.createEl("input", { attr: { type: "text", placeholder: "blank clears the property" } });
		c.createEl("p", {
			cls: "pb-modal-desc",
			text: "Checkboxes take true or false, lists take comma-separated values, dates take 2026-07-16 style input. Applied as one undoable change.",
		});
		const btns = c.createDiv({ cls: "pb-modal-btns" });
		btns.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		const go = btns.createEl("button", { text: "Apply", cls: "mod-cta" });
		go.addEventListener("click", () => {
			this.close();
			void this.view.bulkSet(this.files, sel.value, val.value);
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** A one-field prompt (used to rename a list value). */
class PromptModal extends Modal {
	constructor(
		app: App,
		private opts: { title: string; initial?: string; onSubmit: (v: string) => void }
	) {
		super(app);
	}

	onOpen() {
		this.titleEl.setText(this.opts.title);
		const inp = this.contentEl.createEl("input", { cls: "pb-prompt-input", attr: { type: "text" } });
		inp.value = this.opts.initial ?? "";
		const submit = () => {
			this.close();
			this.opts.onSubmit(inp.value);
		};
		inp.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				submit();
			}
		});
		const btns = this.contentEl.createDiv({ cls: "pb-modal-btns" });
		btns.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		btns.createEl("button", { text: "Save", cls: "mod-cta" }).addEventListener("click", submit);
		window.setTimeout(() => {
			inp.focus();
			inp.select();
		}, 0);
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** Set (or clear) a per-column filter: a condition and, for most conditions, a
 *  value. Applied client-side in Power Table, on top of the base's own filter. */
class ColumnFilterModal extends Modal {
	private op: string;
	private value: string;

	constructor(
		app: App,
		private colLabel: string,
		current: { op?: string; value?: string } | undefined,
		private onSave: (f: { op: string; value: string } | null) => void
	) {
		super(app);
		this.op = current?.op ?? "contains";
		this.value = current?.value ?? "";
	}

	onOpen() {
		this.titleEl.setText(`Filter: ${this.colLabel}`);
		const c = this.contentEl;
		c.createEl("p", { cls: "pb-modal-desc", text: "Show only rows where this column meets the condition." });

		const opRow = c.createDiv({ cls: "pb-rule-row" });
		opRow.createSpan({ cls: "pb-rule-label", text: "Condition" });
		const opSel = opRow.createEl("select", { cls: "dropdown" });
		for (const o of FILTER_OPS) opSel.createEl("option", { attr: { value: o.op }, text: o.label });
		opSel.value = this.op;

		const valRow = c.createDiv({ cls: "pb-rule-row" });
		valRow.createSpan({ cls: "pb-rule-label", text: "Value" });
		const valIn = valRow.createEl("input", { attr: { type: "text", placeholder: "value" } });
		valIn.value = this.value;
		valIn.addEventListener("input", () => (this.value = valIn.value));

		const sync = () => {
			const needs = FILTER_OPS.find((o) => o.op === opSel.value)?.needsValue ?? true;
			valRow.style.display = needs ? "" : "none";
		};
		opSel.addEventListener("change", () => {
			this.op = opSel.value;
			sync();
		});
		sync();

		const btns = c.createDiv({ cls: "pb-modal-btns" });
		btns.createEl("button", { cls: "pb-fn-del", text: "Remove" }).addEventListener("click", () => {
			this.close();
			this.onSave(null);
		});
		btns.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		btns.createEl("button", { text: "Apply", cls: "mod-cta" }).addEventListener("click", () => {
			this.close();
			this.onSave({ op: this.op, value: this.value });
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** Add a new column to the table: name it and pick a type, and it drops into
 *  the view as an empty, editable column (Notion's "+"). */
class AddColumnModal extends Modal {
	private name = "";
	private type: AddColType = "text";

	constructor(
		app: App,
		private onAdd: (name: string, type: AddColType) => void
	) {
		super(app);
	}

	onOpen() {
		this.titleEl.setText("Add column");
		this.modalEl.addClass("pb-addcol-modal");
		const c = this.contentEl;
		c.addClass("pb-addcol");
		c.createEl("p", { cls: "pb-modal-desc", text: "Adds a property column to this view. Click a cell to fill in values." });

		const nameRow = c.createDiv({ cls: "pb-rule-row" });
		nameRow.createSpan({ cls: "pb-rule-label", text: "Name" });
		const nameIn = nameRow.createEl("input", { attr: { type: "text", placeholder: "e.g. Insurance" } });
		nameIn.addEventListener("input", () => (this.name = nameIn.value));

		const typeRow = c.createDiv({ cls: "pb-rule-row" });
		typeRow.createSpan({ cls: "pb-rule-label", text: "Type" });
		const typeSel = typeRow.createEl("select", { cls: "dropdown" });
		const group = (label: string, opts: [AddColType, string][]) => {
			const og = typeSel.createEl("optgroup", { attr: { label } });
			for (const [val, text] of opts) og.createEl("option", { attr: { value: val }, text });
		};
		group("Basic", [
			["text", "Text"],
			["number", "Number"],
			["date", "Date"],
			["datetime", "Date & time"],
			["checkbox", "Checkbox"],
			["list", "List"],
		]);
		group("File", [
			["ctime", "Created time"],
			["mtime", "Last edited time"],
		]);
		group("Rich", [
			["url", "URL"],
			["email", "Email"],
			["phone", "Phone"],
			["person", "Person"],
			["place", "Place"],
			["id", "ID"],
			["button", "Button"],
			["verification", "Verification"],
			["image", "Image"],
			["files", "Files"],
		]);
		group("Advanced", [
			["select", "Select"],
			["status", "Status"],
			["formula", "Formula"],
		]);
		typeSel.value = this.type;
		typeSel.addEventListener("change", () => {
			this.type = typeSel.value as AddColType;
			// file properties are built in and already named
			const fileProp = this.type === "ctime" || this.type === "mtime";
			nameIn.disabled = fileProp;
			nameIn.placeholder = fileProp ? "built-in file property" : "e.g. Insurance";
		});

		const submit = () => {
			if (this.type !== "formula" && this.type !== "ctime" && this.type !== "mtime" && !this.name.trim()) {
				new Notice("Power Bases: name the column first.");
				return;
			}
			this.close();
			this.onAdd(this.name, this.type);
		};
		nameIn.addEventListener("keydown", (e) => {
			if (e.key === "Enter") submit();
		});

		const btns = c.createDiv({ cls: "pb-modal-btns" });
		btns.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		btns.createEl("button", { text: "Add", cls: "mod-cta" }).addEventListener("click", submit);
		window.setTimeout(() => nameIn.focus(), 0);
	}

	onClose() {
		this.contentEl.empty();
	}
}

/** Month grid over a chosen date property. Double-click a day to start a
 *  page there; chips carry their folder's hue so sections stay recognizable. */
class PowerCalendarView extends PBView {
	type = "powerbases-calendar";

	onDataUpdated(): void {
		const root = this.rootEl;
		root.empty();
		root.className = "pb-root pb-cal";
		const dateProp = this.config.getAsPropertyId("dateProp");
		if (!dateProp) {
			this.hint("Pick a Date property in the view options to place pages on the calendar.");
			return;
		}
		const fmKey = frontmatterKey(dateProp);
		const mondayStart = String(this.config.get("weekStart") ?? "monday") !== "sunday";
		const byDay = new Map<string, BasesEntry[]>();
		for (const en of this.data.data) {
			const key = dateKeyOf(this.text(en, dateProp));
			if (!key) continue;
			const arr = byDay.get(key);
			if (arr) arr.push(en);
			else byDay.set(key, [en]);
		}
		if (String(this.config.get("calMode") ?? "month") === "week") this.renderWeek(root, dateProp, fmKey, mondayStart, byDay);
		else this.renderMonth(root, fmKey, mondayStart, byDay);
	}

	private static todayKey(): string {
		const now = new Date();
		return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
	}

	/** A draggable, openable day chip shared by month and week. */
	private dayChip(host: HTMLElement, en: BasesEntry, fromKey: string, fmKey: string, label?: string) {
		const chip = host.createDiv({ cls: "pb-chip", attr: { title: en.file.basename } });
		chip.createSpan({ cls: "pb-chip-dot" }).style.background = this.plugin.hueFor(null, en.file.parent?.name ?? "");
		chip.createSpan({ cls: "pb-chip-name", text: label ?? en.file.basename });
		this.hoverable(chip, en.file);
		attachPointerGesture(chip, {
			ghostText: en.file.basename,
			onStart: () => chip.addClass("pb-drag-src"),
			onMove: (_dx, _dy, x, y) => this.highlightDay(x, y),
			onDrop: (_dx, _dy, x, y) => {
				chip.removeClass("pb-drag-src");
				const key = this.dayKeyAt(x, y);
				this.clearDayHighlight();
				if (key && key !== fromKey) {
					const raw = frontmatterOf(this.app, en.file)?.[fmKey];
					const next = typeof raw === "string" ? replaceDateKey(raw, key) : key;
					void this.plugin.writeBatch(`Rescheduled "${en.file.basename}" to ${key}`, [
						{ file: en.file, assignments: { [fmKey]: next } },
					]);
				}
			},
			onCancel: () => {
				chip.removeClass("pb-drag-src");
				this.clearDayHighlight();
			},
			onClick: (ev) => {
				ev.stopPropagation();
				this.open(en.file, ev);
			},
		});
	}

	private navBtn(head: HTMLElement, icon: string, label: string, fn: () => void) {
		const b = head.createEl("button", { cls: "pb-cal-btn", attr: { "aria-label": label } });
		if (icon) setIcon(b, icon);
		else b.setText(label);
		b.addEventListener("click", fn);
	}

	private renderMonth(root: HTMLElement, fmKey: string, mondayStart: boolean, byDay: Map<string, BasesEntry[]>) {
		const now = new Date();
		let ym = String(this.config.get("pb-month") ?? "");
		if (!/^\d{4}-\d{2}$/.test(ym)) ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
		const year = +ym.slice(0, 4);
		const month0 = +ym.slice(5, 7) - 1;
		const setMonth = (y: number, m: number) => {
			this.config.set("pb-month", `${y}-${String(m + 1).padStart(2, "0")}`);
			this.onDataUpdated();
		};
		const head = root.createDiv({ cls: "pb-cal-head" });
		this.navBtn(head, "chevron-left", "Previous month", () =>
			month0 === 0 ? setMonth(year - 1, 11) : setMonth(year, month0 - 1)
		);
		head.createSpan({
			cls: "pb-cal-title",
			text: new Date(year, month0, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }),
		});
		this.navBtn(head, "chevron-right", "Next month", () => (month0 === 11 ? setMonth(year + 1, 0) : setMonth(year, month0 + 1)));
		this.navBtn(head, "", "Today", () => setMonth(now.getFullYear(), now.getMonth()));

		const daysRow = root.createDiv({ cls: "pb-cal-days" });
		for (let i = 0; i < 7; i++) {
			const d = new Date(2026, 0, 4 + (mondayStart ? 1 : 0) + i);
			daysRow.createSpan({ text: d.toLocaleDateString(undefined, { weekday: "short" }) });
		}
		const todayKey = PowerCalendarView.todayKey();
		const grid = root.createDiv({ cls: "pb-cal-grid" });
		for (const cell of monthGrid(year, month0, mondayStart)) {
			const c = grid.createDiv({
				cls: "pb-day" + (cell.inMonth ? "" : " pb-out") + (cell.key === todayKey ? " pb-today" : ""),
				attr: { "data-key": cell.key },
			});
			c.createDiv({ cls: "pb-day-num", text: String(cell.day) });
			const list = c.createDiv({ cls: "pb-day-list" });
			for (const en of byDay.get(cell.key) ?? []) this.dayChip(list, en, cell.key, fmKey);
			c.addEventListener("dblclick", () => {
				void this.createFileForView(undefined, (fm: Record<string, unknown>) => {
					fm[fmKey] = cell.key;
					this.plugin.stampCreate(fm);
				});
			});
		}
	}

	/** Week view: seven day columns over an hour grid. Timed pages sit at
	 *  their hour; all-day pages (a date with no time) ride a strip on top. */
	private renderWeek(
		root: HTMLElement,
		dateProp: BasesPropertyId,
		fmKey: string,
		mondayStart: boolean,
		byDay: Map<string, BasesEntry[]>
	) {
		const todayKey = PowerCalendarView.todayKey();
		let anchor = String(this.config.get("pb-week") ?? "");
		if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) anchor = todayKey;
		const days = weekDays(anchor, mondayStart);
		const setAnchor = (key: string) => {
			this.config.set("pb-week", key);
			this.onDataUpdated();
		};
		const head = root.createDiv({ cls: "pb-cal-head" });
		this.navBtn(head, "chevron-left", "Previous week", () => setAnchor(addDays(anchor, -7)));
		head.createSpan({
			cls: "pb-cal-title",
			text:
				new Date(days[0] + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
				", " +
				new Date(days[6] + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
		});
		this.navBtn(head, "chevron-right", "Next week", () => setAnchor(addDays(anchor, 7)));
		this.navBtn(head, "", "Today", () => setAnchor(todayKey));

		const HOUR_H = 34;
		const START_H = 7; // scroll opens on the workday; earlier hours scroll up
		const wk = root.createDiv({ cls: "pb-week" });
		// column headers (weekday + date), with a spacer over the hour gutter
		const cols = wk.createDiv({ cls: "pb-week-cols" });
		cols.createDiv({ cls: "pb-week-gutter-head" });
		for (const key of days) {
			const d = new Date(key + "T00:00");
			const h = cols.createDiv({ cls: "pb-week-colhead" + (key === todayKey ? " pb-today" : ""), attr: { "data-key": key } });
			h.createSpan({ cls: "pb-week-dow", text: d.toLocaleDateString(undefined, { weekday: "short" }) });
			h.createSpan({ cls: "pb-week-dnum", text: String(d.getDate()) });
			// all-day pages (no time component) ride the header strip
			const allday = (byDay.get(key) ?? []).filter((en) => timeMinutes(this.text(en, dateProp)) == null);
			if (allday.length) {
				const strip = h.createDiv({ cls: "pb-week-allday" });
				for (const en of allday) this.dayChip(strip, en, key, fmKey);
			}
		}
		const scroll = wk.createDiv({ cls: "pb-week-scroll" });
		const gridEl = scroll.createDiv({ cls: "pb-week-grid" });
		gridEl.style.setProperty("--pb-hour", HOUR_H + "px");
		const gutter = gridEl.createDiv({ cls: "pb-week-gutter" });
		for (let hr = 0; hr < 24; hr++) {
			const lab = gutter.createDiv({ cls: "pb-week-hour" });
			lab.setText(hr === 0 ? "" : `${((hr + 11) % 12) + 1} ${hr < 12 ? "AM" : "PM"}`);
		}
		for (const key of days) {
			const col = gridEl.createDiv({ cls: "pb-week-col" + (key === todayKey ? " pb-today" : ""), attr: { "data-key": key } });
			for (let hr = 0; hr < 24; hr++) {
				const slot = col.createDiv({ cls: "pb-week-slot", attr: { "data-hour": String(hr) } });
				slot.addEventListener("dblclick", () => {
					void this.createFileForView(undefined, (fm: Record<string, unknown>) => {
						fm[fmKey] = `${key}T${String(hr).padStart(2, "0")}:00`;
						this.plugin.stampCreate(fm);
					});
				});
			}
			const timed = (byDay.get(key) ?? [])
				.map((en) => ({ en, min: timeMinutes(this.text(en, dateProp)) }))
				.filter((x): x is { en: BasesEntry; min: number } => x.min != null)
				.sort((a, b) => a.min - b.min);
			for (const { en, min } of timed) {
				const ev = col.createDiv({ cls: "pb-week-event", attr: { title: en.file.basename } });
				ev.style.top = (min / 60) * HOUR_H + "px";
				ev.style.setProperty("--pb-bar", this.plugin.hueFor(null, en.file.parent?.name ?? ""));
				ev.createSpan({ cls: "pb-week-evtime", text: `${((Math.floor(min / 60) + 11) % 12) + 1}:${String(min % 60).padStart(2, "0")}` });
				ev.createSpan({ cls: "pb-week-evname", text: en.file.basename });
				this.hoverable(ev, en.file);
				ev.addEventListener("click", (e) => this.open(en.file, e));
			}
		}
		scroll.scrollTop = START_H * HOUR_H;
	}

	private hoverDayEl: HTMLElement | null = null;

	private highlightDay(x: number, y: number) {
		this.clearDayHighlight();
		const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest?.(".pb-day") as HTMLElement | null;
		if (el && this.rootEl.contains(el)) {
			el.addClass("pb-day-target");
			this.hoverDayEl = el;
		}
	}

	private dayKeyAt(x: number, y: number): string | null {
		const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest?.(".pb-day") as HTMLElement | null;
		return el && this.rootEl.contains(el) ? el.getAttribute("data-key") : null;
	}

	private clearDayHighlight() {
		this.hoverDayEl?.removeClass("pb-day-target");
		this.hoverDayEl = null;
	}
}

const AGG_LABEL: Record<string, string> = { sum: "Σ", avg: "Avg", min: "Min", max: "Max", filled: "Filled", empty: "Empty" };

/** The Bases table with the PowerTables extras: per-column summaries (footer
 *  plus per-group subtotals), per-column colors (chosen or hashed hues by
 *  value, or a numeric scale tint), collapsible groups, and inline editing
 *  of note properties: click a cell, checkboxes toggle in place. */
class PowerTableView extends PBView {
	type = "powerbases-table";
	/** Collapsed toolbar-group labels (session only). */
	private collapsed = new Set<string>();
	/** While a cell editor is open, data updates wait so typing survives. */
	private editing = false;
	private pendingUpdate = false;
	/** Set while a header drag reorders a column, so the click that follows does
	 *  not also fire a rename. */
	private draggedHeader = false;

	onDataUpdated(): void {
		if (this.editing) {
			this.pendingUpdate = true;
			return;
		}
		this.resetChunkers();
		const root = this.rootEl;
		root.empty();
		root.className = "pb-root pb-tablewrap";
		const head = root.createDiv({ cls: "pb-view-head pb-table-head" });
		this.filterBox(head, "Filter rows…");
		const order = this.config.getOrder();
		// the name column is prepended when the order omits it (getOrder() can),
		// unless the user hid it from the column menu (the pbHideName flag,
		// since an omitted-vs-hidden order looks the same)
		const hideName = this.config.get("pbHideName") === true;
		const cols: BasesPropertyId[] = hideName
			? order.filter((p) => p !== "file.name")
			: order.includes("file.name")
				? order
				: ["file.name", ...order];
		this.lastCols = cols;
		let entries = this.applyColumnFilters(this.filtered(this.data.data));
		const sortCfg = this.sortConfig();
		if (sortCfg) entries = this.sortEntries(entries, sortCfg);
		// manual order: with no explicit sort, rows follow their ranks
		// (unranked rows keep the base's order at the end). Whether a rank has
		// been provisioned or not, a flat unsorted table is draggable.
		const rankKey = this.resolveRankKey(sortCfg);
		if (rankKey) entries = orderByRank(entries, (en) => this.rawRankOf(en, rankKey));
		const rowsDraggable = !sortCfg;
		this.lastEntries = entries;
		this.selected = new Set([...this.selected].filter((p) => entries.some((en) => en.file.path === p)));
		const addColBtn = head.createEl("button", { cls: "pb-fx-add", attr: { "aria-label": "Add a column" } });
		setIcon(addColBtn.createSpan(), "plus");
		addColBtn.createSpan({ text: "Column" });
		addColBtn.addEventListener("click", () => this.openAddColumn());
		const fxBtn = head.createEl("button", { cls: "pb-fx-add", attr: { "aria-label": "Add a formula column" } });
		setIcon(fxBtn.createSpan(), "sigma");
		fxBtn.createSpan({ text: "Formula" });
		fxBtn.addEventListener("click", () => this.openFormulaModal());
		head.createSpan({ cls: "pb-view-count", text: `${entries.length}` });
		if (this.rootEl.closest<HTMLElement>(".internal-embed")) {
			this.decorateEmbed();
			window.setTimeout(() => this.decorateEmbed(), 0); // catch a late native toolbar
		}
		this.selBar = root.createDiv({ cls: "pb-selbar" });
		this.selBar.createSpan({ cls: "pb-selbar-count" });
		const sbBtn = (label: string, icon: string, cb: () => void, danger = false) => {
			const b = this.selBar!.createEl("button", { cls: "pb-selbar-btn" + (danger ? " is-danger" : "") });
			setIcon(b.createSpan(), icon);
			b.createSpan({ text: label });
			b.addEventListener("click", cb);
		};
		sbBtn("Set property", "pencil", () => new SetPropertyModal(this.app, this, this.selectedFiles()).open());
		sbBtn("Duplicate", "copy", () => void this.duplicateRows(this.selectedFiles()));
		sbBtn("Delete", "trash-2", () => this.deleteRows(this.selectedFiles()), true);
		const sbClr = this.selBar.createEl("button", { cls: "pb-selbar-btn", attr: { "aria-label": "Clear selection" } });
		setIcon(sbClr, "x");
		sbClr.addEventListener("click", () => {
			this.selected.clear();
			this.updateSelUi();
		});
		const allow = this.query.trim() || this.columnFilters().length ? new Set(entries.map((en) => en.file.path)) : null;
		const aggOf = (p: BasesPropertyId): AggOp => {
			const v = String(this.config.get("agg:" + p) ?? "none");
			return (["sum", "avg", "min", "max", "filled", "empty"].includes(v) ? v : "none") as AggOp;
		};
		const colorOf = (p: BasesPropertyId): string => String(this.config.get("color:" + p) ?? "none");
		const anyAgg = cols.some((p) => aggOf(p) !== "none");

		// rollup slots: follow a link property, read a property on the linked
		// notes, aggregate. Count-only rollups need no target property.
		const RU_LABEL: Record<RollupOp, string> = { count: "#", sum: "Σ", avg: "Avg", min: "Min", max: "Max", filled: "Filled", list: "" };
		const rollups: { linkKey: string; targetKey: string; op: RollupOp; dir: "from" | "to"; label: string }[] = [];
		for (const n of [1, 2, 3]) {
			const link = this.config.getAsPropertyId(`ru${n}:link`);
			if (!link) continue;
			const target = this.config.getAsPropertyId(`ru${n}:target`);
			const opRaw = String(this.config.get(`ru${n}:op`) ?? "count");
			const op = (["count", "sum", "avg", "min", "max", "filled", "list"].includes(opRaw) ? opRaw : "count") as RollupOp;
			if (op !== "count" && !target) continue;
			const dir = String(this.config.get(`ru${n}:dir`) ?? "from") === "to" ? "to" : "from";
			const label =
				(dir === "to" ? "⇐ " : "") +
				(op === "count"
					? "# " + this.config.getDisplayName(link)
					: (RU_LABEL[op] ? RU_LABEL[op] + " " : "") + this.config.getDisplayName(target as BasesPropertyId));
			rollups.push({ linkKey: frontmatterKey(link), targetKey: target ? frontmatterKey(target) : "", op, dir, label });
		}
		// reverse slots invert the link once per repaint: every markdown file
		// whose link property points at a row becomes that row's source. One
		// vault sweep per slot beats one per cell by orders of magnitude.
		const reverseMaps = new Map<number, Map<string, TFile[]>>();
		for (let i = 0; i < rollups.length; i++) {
			const r = rollups[i];
			if (r.dir !== "to") continue;
			const map = new Map<string, TFile[]>();
			for (const mf of this.app.vault.getMarkdownFiles()) {
				const raw = frontmatterOf(this.app, mf)?.[r.linkKey];
				if (raw == null) continue;
				for (const nm of linkTargets(raw)) {
					const dest = this.app.metadataCache.getFirstLinkpathDest(nm, mf.path);
					if (!dest) continue;
					const arr = map.get(dest.path);
					if (!arr) map.set(dest.path, [mf]);
					else if (!arr.includes(mf)) arr.push(mf);
				}
			}
			reverseMaps.set(i, map);
		}
		const width = cols.length + rollups.length;

		const ranges = new Map<BasesPropertyId, { min: number; max: number }>();
		for (const p of cols) {
			if (colorOf(p) !== "scale") continue;
			let min = Infinity;
			let max = -Infinity;
			for (const en of entries) {
				const n = parseNumber(this.text(en, p));
				if (n == null) continue;
				if (n < min) min = n;
				if (n > max) max = n;
			}
			if (min !== Infinity) ranges.set(p, { min, max });
		}

		// the max per column that shows a "Show as" visual/percent, so bar/ring
		// fills, percentages, and default traffic thresholds have a denominator
		const colMax = new Map<string, number>();
		for (const p of cols) {
			const nf = this.plugin.numberFormat(String(p));
			if (!nf || !nf.display || nf.display === "plain") continue;
			let max = 0;
			for (const en of entries) {
				const n = parseNumber(this.text(en, p));
				if (n != null && n > max) max = n;
			}
			colMax.set(String(p), max || 1);
		}

		const table = root.createEl("table", { cls: "pb-table" });
		const hr = table.createEl("thead").createEl("tr");
		const frozen = this.freezeCount();
		const lefts: number[] = []; // left offset of each column, for freezing
		let totalW = 0;
		let ci = 0;
		for (const p of cols) {
			const th = hr.createEl("th", { cls: "pb-th pb-th-menu" });
			const wrap = th.createDiv({ cls: "pb-th-typed" });
			if (p.startsWith("formula.")) setIcon(wrap.createSpan({ cls: "pb-th-fx" }), "sigma");
			wrap.createSpan({ cls: "pb-th-label", text: this.config.getDisplayName(p) });
			const ft = p.startsWith("note.") ? this.plugin.fieldType(frontmatterKey(p)) : null;
			if (ft) wrap.createSpan({ cls: "pb-th-type", text: PB_TYPE_LABEL[ft] });
			if (sortCfg && sortCfg.prop === String(p)) setIcon(wrap.createSpan({ cls: "pb-th-mark" }), sortCfg.dir === "DESC" ? "arrow-down" : "arrow-up");
			if (this.columnFilter(String(p))) setIcon(wrap.createSpan({ cls: "pb-th-mark" }), "filter");
			th.setAttribute("aria-label", "Click for column options");
			// left click (via the reorder gesture) and right click both open the flyout
			th.addEventListener("contextmenu", (ev) => {
				ev.preventDefault();
				this.openColumnMenu(th, p, { x: ev.clientX, y: ev.clientY });
			});
			const w = this.applyColWidth(th, String(p));
			lefts.push(totalW);
			if (ci < frozen) {
				th.addClass("pb-frozen");
				th.style.left = totalW + "px";
				if (ci === frozen - 1) th.addClass("pb-frozen-edge");
			}
			totalW += w;
			this.attachColResize(th, String(p));
			this.attachColReorder(th, p, cols, hr);
			ci++;
		}
		// Rollup and add-column headers are a fixed size, so the widths live in
		// styles.css. These two constants exist only so the running total the
		// table is sized against agrees with what the browser will lay out.
		const RU_W = 140;
		const ADD_W = 34;
		for (const r of rollups) {
			hr.createEl("th", { cls: "pb-th pb-ru", text: r.label });
			totalW += RU_W;
		}
		const addTh = hr.createEl("th", { cls: "pb-th pb-th-add", attr: { "aria-label": "Add a column" } });
		totalW += ADD_W;
		setIcon(addTh.createSpan(), "plus");
		addTh.addEventListener("click", () => this.openAddColumn());
		const firstTh = hr.cells[0];
		if (firstTh && entries.length) {
			firstTh.addClass("pb-selhost");
			const all = firstTh.createEl("input", { cls: "pb-rowsel pb-selall", attr: { type: "checkbox", "aria-label": "Select all rows" } });
			all.checked = this.selected.size === entries.length;
			all.addEventListener("click", (ev) => {
				ev.stopPropagation();
				if (this.selected.size === entries.length) this.selected.clear();
				else entries.forEach((en) => this.selected.add(en.file.path));
				this.updateSelUi();
			});
		}
		table.style.width = totalW + "px";
		const tbody = table.createEl("tbody");

		const rawOf = (en: BasesEntry, fmKey: string): unknown =>
			frontmatterOf(this.app, en.file)?.[fmKey];

		const renderRow = (en: BasesEntry) => {
			const tr = tbody.createEl("tr", { cls: "pb-tr", attr: { "data-path": en.file.path } });
			let ri = 0;
			for (const p of cols) {
				const td = tr.createEl("td", { cls: "pb-td" });
				if (this.config.get("wrap:" + String(p)) === true) td.addClass("pb-wrap");
				if (ri < frozen) {
					td.addClass("pb-frozen");
					td.style.left = lefts[ri] + "px";
					if (ri === frozen - 1) td.addClass("pb-frozen-edge");
				}
				ri++;
				const s = this.text(en, p);
				const editable = p.startsWith("note.");
				const fmKey = editable ? frontmatterKey(p) : null;
				const raw = fmKey ? rawOf(en, fmKey) : undefined;
				const ft = fmKey ? this.plugin.fieldType(fmKey) : null;
				if (p === "file.name") {
					const link = td.createSpan({ cls: "pb-link", text: s });
					link.addEventListener("click", (ev) => this.open(en.file, ev));
					this.hoverable(link, en.file);
					this.openable(link, en.file);
				} else if (ft) {
					this.renderTypedCell(td, en, fmKey!, ft, raw, s);
				} else {
					// the kind chosen when the column was added wins (so a fresh
					// checkbox renders a box, not "null"); else infer from the value
					const stored = fmKey ? this.plugin.storedKind(fmKey) : null;
					let kind: CellKind = stored ?? inferKind(raw);
					if (!stored && raw === undefined && fmKey) kind = this.plugin.assignedKind(fmKey) ?? "text";
					if (editable && kind === "checkbox") {
						const cb = td.createEl("input", { cls: "pb-check", attr: { type: "checkbox" } });
						cb.checked = raw === true;
						cb.addEventListener("change", () => {
							void this.plugin.writeBatch(
								`${cb.checked ? "Checked" : "Unchecked"} ${this.config.getDisplayName(p)} on "${en.file.basename}"`,
								[{ file: en.file, assignments: { [fmKey!]: cb.checked } }]
							);
						});
					} else {
						// formula columns and note number/date columns honor the
						// column's format: a "Show as" visual, a percent, otherwise
						// formatted text (numbers/dates); text cells pass through
						const nf = this.plugin.numberFormat(String(p));
						const n = nf && hasNumberFormat(nf) ? parseNumber(s) : null;
						if (n != null && isMeter(nf)) {
							renderMeter(td, n, colMax.get(String(p)) ?? 1, nf!);
						} else if (n != null && nf!.display === "percent") {
							td.setText(formatPercent(n, nf!.max ?? (colMax.get(String(p)) ?? 1), nf!.decimals ?? 0));
						} else if (kind === "list" && editable) {
							// list values show as colored chips (like the multi-select editor)
							const arr = Array.isArray(raw) ? raw.map((v) => String(v)) : raw == null || raw === "" ? [] : [String(raw)];
							for (const it of arr) {
								if (!it.trim() || it === "null") continue;
								td.createSpan({ cls: "pb-person", text: it }).style.setProperty("--pb-c", this.plugin.hueFor(fmKey, it));
							}
						} else {
							td.setText(this.display(en, p, s));
						}
					}
					if (editable && kind !== "checkbox") {
						this.registerEdit(td, () => this.beginEdit(td, en, fmKey!, kind, raw));
					}
					const mode = colorOf(p);
					if (mode === "value" && s && kind !== "checkbox") {
						td.addClass("pb-cat");
						td.style.setProperty("--pb-c", this.plugin.hueFor(fmKey, s));
						td.addEventListener("contextmenu", (ev) => {
							if (!fmKey) return;
							ev.preventDefault();
							const menu = new Menu();
							fillValueColorMenu(menu, this.plugin, fmKey, s, () => this.onDataUpdated());
							menu.showAtMouseEvent(ev);
						});
					} else if (mode === "scale") {
						const r = ranges.get(p);
						const n = parseNumber(s);
						const pos = r && n != null ? scalePos(n, r.min, r.max) : null;
						if (pos != null) {
							td.addClass("pb-scale");
							td.style.setProperty("--pb-p", pos.toFixed(3));
						}
					}
				}
			}
			for (let i = 0; i < rollups.length; i++) {
				const r = rollups[i];
				const td = tr.createEl("td", { cls: "pb-td pb-ru" });
				let files: TFile[];
				if (r.dir === "to") {
					files = reverseMaps.get(i)?.get(en.file.path) ?? [];
				} else {
					files = [];
					const raw = frontmatterOf(this.app, en.file)?.[r.linkKey];
					for (const nm of linkTargets(raw)) {
						const lf = this.app.metadataCache.getFirstLinkpathDest(nm, en.file.path);
						if (lf) files.push(lf);
					}
				}
				const values = r.targetKey
					? files.map((lf) => frontmatterOf(this.app, lf)?.[r.targetKey])
					: [];
				td.setText(rollup(r.op, files.length, values));
			}
			const firstTd = tr.cells[0];
			if (firstTd) {
				firstTd.addClass("pb-selhost");
				const cb = firstTd.createEl("input", { cls: "pb-rowsel", attr: { type: "checkbox", "aria-label": "Select row" } });
				cb.checked = this.selected.has(en.file.path);
				if (cb.checked) tr.addClass("is-selected");
				cb.addEventListener("click", (ev) => {
					ev.stopPropagation();
					this.toggleRowSelect(en.file.path, ev.shiftKey);
				});
				if (!sortCfg && flat) {
					// the grip needs no setup: the first drag provisions the
					// manual-order property (pb-order) into the view options
					const grip = firstTd.createSpan({ cls: "pb-rowgrip", attr: { "aria-label": "Drag to reorder" } });
					setIcon(grip, "grip-vertical");
					this.attachRowDrag(grip, tr, rankKey);
				}
			}
			tr.addEventListener("contextmenu", (ev) => {
				if (ev.defaultPrevented) return; // a colored cell's own menu won
				ev.preventDefault();
				const menu = new Menu();
				menu.addItem((i) =>
					i.setTitle(this.selected.has(en.file.path) ? "Deselect row" : "Select row")
						.setIcon("check-square")
						.onClick(() => this.toggleRowSelect(en.file.path, false))
				);
				menu.addItem((i) =>
					i.setTitle("Open in new tab")
						.setIcon("file-plus")
						.onClick(() => void this.app.workspace.getLeaf("tab").openFile(en.file))
				);
				menu.addItem((i) => i.setTitle("Insert row above").setIcon("corner-left-up").onClick(() => void this.insertRowNear(en, 0)));
				menu.addItem((i) => i.setTitle("Insert row below").setIcon("corner-left-down").onClick(() => void this.insertRowNear(en, 1)));
				menu.addItem((i) => i.setTitle("Duplicate row").setIcon("copy").onClick(() => void this.duplicateRows([en.file])));
				menu.addItem((i) => i.setTitle("Delete row").setIcon("trash-2").onClick(() => this.deleteRows([en.file])));
				menu.addSeparator();
				this.app.workspace.trigger("file-menu", menu, en.file, "powerbases-table");
				menu.showAtMouseEvent(ev);
			});
		};

		const summaryRow = (rows: BasesEntry[], cls: string, label: string | null) => {
			const tr = tbody.createEl("tr", { cls });
			for (const p of cols) {
				const td = tr.createEl("td", { cls: "pb-td pb-agg" });
				const op = aggOf(p);
				if (op === "none") continue;
				const n = aggregate(rows.map((en) => this.text(en, p)), op);
				if (n != null) {
					td.createSpan({ cls: "pb-agg-op", text: (label ? label + " " : "") + AGG_LABEL[op] });
					td.createSpan({ text: " " + this.aggDisplay(p, n) });
				}
			}
			for (let i = 0; i < rollups.length; i++) tr.createEl("td", { cls: "pb-td pb-agg" });
		};

		const groups = this.data.groupedData.map((g) => {
			let rows = allow ? g.entries.filter((en) => allow.has(en.file.path)) : g.entries;
			if (sortCfg) rows = this.sortEntries(rows, sortCfg);
			return { g, rows };
		});
		const flat = groups.length === 1 && groups[0].g.key === undefined;
		// grips (and their wider gutter) only where manual drag makes sense
		if (rowsDraggable && flat && entries.length) table.addClass("pb-hasrank");
		for (const { g, rows } of groups) {
			const grouped = g.key !== undefined;
			if (grouped && !rows.length) continue; // a group filtered empty disappears
			const label = grouped ? (g.hasKey() ? String(g.key) : "No value") : null;
			let isCollapsed = false;
			if (label != null) {
				isCollapsed = this.collapsed.has(label);
				const gtr = tbody.createEl("tr", { cls: "pb-grouprow" });
				const td = gtr.createEl("td", { attr: { colspan: String(width) } });
				const chev = td.createSpan({ cls: "pb-gchev" + (isCollapsed ? "" : " is-open") });
				setIcon(chev, "chevron-right");
				td.createSpan({ text: label + " " });
				td.createSpan({ cls: "pb-gcount", text: String(rows.length) });
				gtr.addEventListener("click", () => {
					if (this.collapsed.has(label)) this.collapsed.delete(label);
					else this.collapsed.add(label);
					this.onDataUpdated();
				});
			}
			// the common flat table virtualizes; grouped stays whole (groups cap size)
			if (!isCollapsed) {
				if (flat) this.chunk(tbody, root, rows, (en) => renderRow(en), 140, "tr");
				else for (const en of rows) renderRow(en);
			}
			if (label != null && anyAgg) summaryRow(rows, "pb-tr pb-subtotal", null);
		}
		if (!entries.length) {
			tbody.createEl("tr").createEl("td", { attr: { colspan: String(width) }, cls: "pb-empty", text: this.query ? "No rows match." : "No rows." });
		}
		const foot = table.createEl("tfoot");
		const addTr = foot.createEl("tr", { cls: "pb-addrow" });
		const addTd = addTr.createEl("td", { attr: { colspan: String(width) }, cls: "pb-addrow-td" });
		const addIn = addTd.createSpan({ cls: "pb-addrow-in" });
		setIcon(addIn.createSpan(), "plus");
		addIn.createSpan({ text: "New" });
		addTd.addEventListener("click", () => void this.addRow(0));
		if (anyAgg) {
			const fr = foot.createEl("tr", { cls: "pb-foot" });
			for (const p of cols) {
				const td = fr.createEl("td", { cls: "pb-td pb-agg" });
				const op = aggOf(p);
				if (op === "none") continue;
				const n = aggregate(entries.map((en) => this.text(en, p)), op);
				if (n != null) {
					td.createSpan({ cls: "pb-agg-op", text: AGG_LABEL[op] });
					td.createSpan({ text: " " + this.aggDisplay(p, n) });
				}
			}
			for (let i = 0; i < rollups.length; i++) fr.createEl("td", { cls: "pb-td pb-agg" });
		}

		this.updateSelUi();

		// a row added from the keyboard or the New row: once the repaint brings
		// it in, drop straight into its editor at the remembered column
		if (this.pendingRowEdit) {
			const pe = this.pendingRowEdit;
			this.pendingRowEdit = null;
			type EditCell = HTMLTableCellElement & { pbEdit?: () => void };
			const tr = tbody.querySelector<HTMLTableRowElement>(`tr.pb-tr[data-path="${CSS.escape(pe.path)}"]`);
			if (tr) {
				const cells = Array.from(tr.cells) as EditCell[];
				const target = (cells[pe.ci]?.pbEdit ? cells[pe.ci] : cells.find((c) => c.pbEdit)) ?? null;
				if (target) {
					target.scrollIntoView({ block: "nearest" });
					target.pbEdit?.();
				}
			}
		}
	}

	/** Frontmatter keys seen across the current rows (for config datalists). */
	private notePropKeys(): string[] {
		const set = new Set<string>();
		for (const en of this.data.data.slice(0, 300)) {
			const fm = frontmatterOf(this.app, en.file);
			if (fm) for (const k of Object.keys(fm)) set.add(k);
		}
		return [...set].sort();
	}

	/** The "Set type" submenu: a native kind (checkbox, number, date, ...), a
	 *  Power-Base field type, or Automatic. A column is one or the other. */
	private typeMenuItems(fmKey: string): PBSubItem[] {
		const curField = this.plugin.fieldType(fmKey);
		const curKind = this.plugin.storedKind(fmKey);
		const items: PBSubItem[] = [
			{ label: "Automatic (Obsidian type)", checked: curField == null && curKind == null, onClick: () => void this.setColumnKind(fmKey, null) },
		];
		const NATIVE: [CellKind, string, string][] = [
			["text", "Text", "type"],
			["number", "Number", "hash"],
			["date", "Date", "calendar"],
			["datetime", "Date & time", "calendar-clock"],
			["checkbox", "Checkbox", "check-square"],
			["list", "List", "list"],
		];
		for (const [k, label, icon] of NATIVE) {
			items.push({ icon, label, checked: curField == null && curKind === k, onClick: () => void this.setColumnKind(fmKey, k) });
		}
		for (const t of PB_FIELD_TYPES) {
			items.push({ icon: PB_TYPE_ICON[t], label: PB_TYPE_LABEL[t], checked: curField === t, onClick: () => void this.setColumnFieldType(fmKey, t) });
		}
		if (curField === "id" || curField === "button" || curField === "verification") {
			items.push({ icon: "settings-2", label: `Configure ${PB_TYPE_LABEL[curField]}…`, onClick: () => new FieldConfigModal(this.app, this.plugin, fmKey, curField, this.notePropKeys()).open() });
		}
		return items;
	}

	/** Set a column to a native editor kind (clears any Power-Base field type). */
	private async setColumnKind(fmKey: string, kind: CellKind | null) {
		await this.plugin.setFieldType(fmKey, null);
		await this.plugin.setStoredKind(fmKey, kind);
		if (kind) this.setObsidianType(fmKey, kind === "list" ? "multitext" : kind);
		this.plugin.refreshAll();
	}

	/** Set a column to a Power-Base field type (clears any native kind override). */
	private async setColumnFieldType(fmKey: string, ft: PBFieldType) {
		await this.plugin.setStoredKind(fmKey, null);
		await this.plugin.setFieldType(fmKey, ft);
	}

	/** The "Calculate" submenu items: set the column's summary aggregate (or none). */
	private calcMenuItems(pid: string): PBSubItem[] {
		const cur = String(this.config.get("agg:" + pid) ?? "none");
		const opts: [string, string][] = [
			["none", "None"],
			["sum", "Sum"],
			["avg", "Average"],
			["min", "Minimum"],
			["max", "Maximum"],
			["filled", "Count filled"],
			["empty", "Count empty"],
		];
		return opts.map(([op, label]) => ({
			label,
			checked: cur === op,
			onClick: () => {
				this.config.set("agg:" + pid, op === "none" ? null : op);
				this.onDataUpdated();
			},
		}));
	}

	/** The "Sort" submenu items: sort the table by this column, or clear it. */
	private sortMenuItems(pid: string): PBSubItem[] {
		const cur = this.sortConfig();
		return [
			{ icon: "arrow-up", label: "Ascending", checked: cur?.prop === pid && cur.dir === "ASC", onClick: () => this.setSort(pid, "ASC") },
			{ icon: "arrow-down", label: "Descending", checked: cur?.prop === pid && cur.dir === "DESC", onClick: () => this.setSort(pid, "DESC") },
			{ icon: "x", label: "Clear sort", onClick: () => this.setSort(null) },
		];
	}

	/* ----- formula columns (native Bases formulas, edited here) ----- */

	/** Sample rows for the formula preview (bounded so the picker stays light). */
	sampleEntries(): BasesEntry[] {
		return this.data.data.slice(0, 50);
	}
	viewName(): string {
		return this.config.name;
	}
	currentOrder(): string[] {
		const order = this.config.getOrder().map((p) => String(p));
		// getOrder() can omit file.name (the table prepends it at render); keep it
		// so writing a fresh order never hides the name column in the native Table
		return order.includes("file.name") ? order : ["file.name", ...order];
	}

	/* ----- number + date formatting (per column, applied to cells) ----- */

	/** A cell's display text: the column's number format when the value is a
	 *  number, its date format when the value is a date (file dates read from
	 *  the file's stat so they format regardless of how Bases renders them),
	 *  else the plain rendered string. */
	private display(en: BasesEntry, p: BasesPropertyId, s: string): string {
		const pid = String(p);
		const nf = this.plugin.numberFormat(pid);
		if (nf && hasNumberFormat(nf)) {
			const n = parseNumber(s);
			if (n != null) return formatNumberValue(n, nf);
		}
		const df = this.plugin.dateFormat(pid);
		if (df && hasDateFormat(df)) {
			const src = pid === "file.mtime" ? localDateString(en.file.stat.mtime) : pid === "file.ctime" ? localDateString(en.file.stat.ctime) : s;
			return formatDateValue(src, df, todayKey());
		}
		return s;
	}

	/** An aggregate value formatted with the column's number format if set. */
	private aggDisplay(p: BasesPropertyId, n: number): string {
		const fmt = this.plugin.numberFormat(String(p));
		return fmt && hasNumberFormat(fmt) ? formatNumberValue(n, fmt) : formatNum(n);
	}

	/** Whether a column reads mostly as numbers or dates, by sampling its cells;
	 *  drives which "… format" menu item shows and the bulk-apply picker. */
	private columnKind(p: BasesPropertyId): "number" | "date" | "other" {
		if (p === "file.mtime" || p === "file.ctime") return "date";
		// file names sample as numbers in vaults full of numeric titles
		// ("0-60 MPH", "1Password"), and formatting a name makes no sense
		if (p === "file.name") return "other";
		// a typed column knows its kind before any row has a value: the kind
		// stored when it was added (or set), else Obsidian's assigned type;
		// only a positive number/date signal decides, anything else samples
		if (String(p).startsWith("note.")) {
			const fmKey = frontmatterKey(p);
			const k = this.plugin.storedKind(fmKey) ?? this.plugin.assignedKind(fmKey);
			if (k === "number") return "number";
			if (k === "date" || k === "datetime") return "date";
		}
		let num = 0;
		let date = 0;
		let seen = 0;
		for (const en of this.data.data) {
			const s = this.text(en, p);
			if (!s) continue;
			if (dateKeyOf(s)) date++;
			else if (parseNumber(s) != null) num++;
			if (++seen >= 12) break;
		}
		if (date > 0 && date >= num) return "date";
		if (num > 0) return "number";
		return "other";
	}

	/** The view's other columns of a given kind, for the bulk-apply picker. */
	private formattableColumns(kind: "number" | "date", exclude: string): { propId: string; label: string }[] {
		const out: { propId: string; label: string }[] = [];
		for (const p of this.currentOrder()) {
			if (p === "file.name" || p === exclude) continue;
			if (this.columnKind(p as BasesPropertyId) === kind) out.push({ propId: p, label: this.config.getDisplayName(p as BasesPropertyId) });
		}
		return out;
	}

	private openNumberFormat(propId: string) {
		new NumberFormatModal(this.app, this.plugin, propId, this.formattableColumns("number", propId)).open();
	}

	private openDateFormat(propId: string) {
		new DateFormatModal(this.app, this.plugin, propId, this.formattableColumns("date", propId)).open();
	}

	/** The view's other Phone columns, for the bulk-apply picker. */
	private phoneColumns(exclude: string): { propId: string; label: string }[] {
		const out: { propId: string; label: string }[] = [];
		for (const p of this.currentOrder()) {
			if (p === exclude || !p.startsWith("note.")) continue;
			if (this.plugin.fieldType(frontmatterKey(p as BasesPropertyId)) === "phone")
				out.push({ propId: p, label: this.config.getDisplayName(p as BasesPropertyId) });
		}
		return out;
	}

	private openPhoneFormat(propId: string) {
		new PhoneFormatModal(this.app, this.plugin, propId, this.phoneColumns(propId)).open();
	}

	/* ----- add a new property column (Notion's "+" at the header end) ----- */

	private openAddColumn(at?: number) {
		const file = this.baseFile();
		if (!file) {
			new Notice("Power Bases: adding columns needs a saved .base file; an inline base block has none.");
			return;
		}
		new AddColumnModal(this.app, (name, type) => void this.addColumn(file, name, type, at)).open();
	}

	/** Register the Obsidian type of a new property so empty cells edit right. */
	private setObsidianType(name: string, obsType: string) {
		try {
			const mtm = (this.app as unknown as { metadataTypeManager?: { setType?: (n: string, t: string) => void } }).metadataTypeManager;
			mtm?.setType?.(name, obsType);
		} catch {
			// the property registry is undocumented; the column still works without it
		}
	}

	/** Create a new column of any offered type: a plain property (with its
	 *  Obsidian type), a Power-Base field type, a colored Select/Status, or a
	 *  formula, then open its format/config dialog where that helps. */
	private async addColumn(file: TFile, rawName: string, type: AddColType, at?: number) {
		if (type === "formula") {
			this.openFormulaModal();
			return;
		}
		if (type === "ctime" || type === "mtime") {
			const pid = type === "ctime" ? "file.ctime" : "file.mtime";
			if (this.currentOrder().includes(pid)) {
				new Notice("Power Bases: that column is already in this view.");
				return;
			}
			try {
				await addViewColumn(this.app, file, pid, this.viewName(), this.type, this.currentOrder(), undefined, at);
			} catch (e) {
				new Notice("Power Bases: could not add the column. " + (e as Error).message);
				return;
			}
			this.plugin.refreshAll();
			this.openDateFormat(pid);
			return;
		}
		const name = rawName
			.replace(/[\r\n]+/g, " ")
			.replace(/[:#[\]{}",.]/g, "")
			.replace(/\s+/g, " ")
			.trim();
		if (!name) {
			new Notice("Power Bases: name the column first.");
			return;
		}
		const propId = "note." + name;
		const NATIVE: Record<string, string> = { text: "text", number: "number", date: "date", datetime: "datetime", checkbox: "checkbox", list: "multitext" };
		const isField = (PB_FIELD_TYPES as string[]).includes(type);
		// a Select/Status is a text property tinted by value; files is a list
		this.setObsidianType(name, NATIVE[type] ?? (type === "files" ? "multitext" : "text"));
		// remember the chosen editor kind so an empty column (e.g. a checkbox)
		// renders correctly even if Obsidian's type registry does not take it
		if (NATIVE[type]) await this.plugin.setStoredKind(name, type as CellKind);
		else if (type === "select" || type === "status") await this.plugin.setStoredKind(name, "text");
		// Select and Status tint the column by value (like the board's lanes)
		const viewOpts = type === "select" || type === "status" ? { ["color:" + propId]: "value" } : undefined;
		try {
			await addViewColumn(this.app, file, propId, this.viewName(), this.type, this.currentOrder(), viewOpts, at);
		} catch (e) {
			new Notice("Power Bases: could not add the column. " + (e as Error).message);
			return;
		}
		if (isField) await this.plugin.setFieldType(name, type as PBFieldType);
		this.plugin.refreshAll();
		new Notice(`Power Bases: added the "${name}" column.`);
		if (type === "number") this.openNumberFormat(propId);
		else if (type === "date" || type === "datetime") this.openDateFormat(propId);
		else if (type === "button" || type === "id" || type === "verification") {
			new FieldConfigModal(this.app, this.plugin, name, type, this.notePropKeys()).open();
		}
	}

	/* ----- client-side sort, per-column filters, and freeze ----- */

	private sortConfig(): { prop: string; dir: "ASC" | "DESC" } | null {
		// stored as a JSON string so it round-trips through Bases view config
		const c = parseJson<{ prop?: string; dir?: string }>(this.config.get("pbSort"));
		return c && c.prop ? { prop: c.prop, dir: c.dir === "DESC" ? "DESC" : "ASC" } : null;
	}
	private setSort(prop: string | null, dir: "ASC" | "DESC" = "ASC") {
		this.config.set("pbSort", prop ? JSON.stringify({ prop, dir }) : null);
		this.onDataUpdated();
	}
	private sortEntries(entries: BasesEntry[], cfg: { prop: string; dir: "ASC" | "DESC" }): BasesEntry[] {
		const sign = cfg.dir === "DESC" ? -1 : 1;
		const key = cfg.prop as BasesPropertyId;
		return entries.slice().sort((a, b) => {
			const sa = this.text(a, key);
			const sb = this.text(b, key);
			if (sa === sb) return 0;
			if (sa === "") return 1; // blanks always sink to the bottom
			if (sb === "") return -1;
			const na = parseNumber(sa);
			const nb = parseNumber(sb);
			const cmp = na != null && nb != null ? na - nb : sa.localeCompare(sb);
			return cmp * sign;
		});
	}

	private columnFilter(pid: string): { op: string; value: string } | null {
		const f = parseJson<{ op?: string; value?: string }>(this.config.get("filter:" + pid));
		return f && f.op ? { op: f.op, value: f.value ?? "" } : null;
	}
	private columnFilters(): { pid: string; op: string; value: string }[] {
		const out: { pid: string; op: string; value: string }[] = [];
		for (const p of this.currentOrder()) {
			const f = this.columnFilter(String(p));
			if (f) out.push({ pid: String(p), op: f.op, value: f.value });
		}
		return out;
	}
	private setFilter(pid: string, f: { op: string; value: string } | null) {
		this.config.set("filter:" + pid, f ? JSON.stringify(f) : null);
		this.onDataUpdated();
	}
	private applyColumnFilters(entries: BasesEntry[]): BasesEntry[] {
		const filters = this.columnFilters();
		if (!filters.length) return entries;
		return entries.filter((en) => filters.every((f) => matchesColumnFilter(this.text(en, f.pid as BasesPropertyId), f.op, f.value)));
	}

	private freezeCount(): number {
		const n = Number(this.config.get("freeze") ?? 0);
		return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
	}
	private setFreeze(n: number) {
		this.config.set("freeze", n > 0 ? n : null);
		this.onDataUpdated();
	}

	/** The type icon shown on a column's flyout button (and its meaning). */
	private columnIcon(p: BasesPropertyId): string {
		if (p === "file.name") return "file-text";
		if (p === "file.mtime" || p === "file.ctime") return "calendar-clock";
		if (p.startsWith("formula.")) return "sigma";
		const fmKey = frontmatterKey(p);
		const ft = this.plugin.fieldType(fmKey);
		if (ft) return PB_TYPE_ICON[ft];
		const k = this.plugin.storedKind(fmKey) ?? this.columnKind(p);
		return k === "number" ? "hash" : k === "date" ? "calendar" : k === "checkbox" ? "check-square" : k === "list" ? "list" : "type";
	}

	/** The column flyout: a Notion-style menu opened by clicking a header. A name
	 *  field at the top renames the column; the rows carry every column action. */
	private openColumnMenu(th: HTMLElement, p: BasesPropertyId, at?: { x: number; y: number }) {
		document.body.querySelectorAll(".pb-colmenu").forEach((el) => el.remove());
		const isNote = p.startsWith("note.");
		const isFormula = p.startsWith("formula.");
		const pid = String(p);
		const fmKey = isNote ? frontmatterKey(p) : "";
		const kind = this.columnKind(p);

		const pop = document.body.createDiv({ cls: "pb-colmenu" });
		// the click that opened this may have repainted the table (e.g. it closed
		// a cell editor), detaching `th`; a detached cell reports a zero rect, so
		// fall back to the click position instead of pinning to the top-left
		const rect = th.getBoundingClientRect();
		const live = th.isConnected && rect.width > 0;
		const anchorLeft = live ? rect.left : at ? at.x : 6;
		const anchorTop = live ? rect.bottom : at ? at.y : 76;
		pop.style.left = Math.max(6, Math.min(anchorLeft, window.innerWidth - 240)) + "px";
		pop.style.top = anchorTop + 4 + "px";

		let sub: HTMLElement | null = null;
		const closeSub = () => {
			sub?.remove();
			sub = null;
			pop.querySelectorAll(".pb-colmenu-row.is-active, .pb-colmenu-typebtn.is-active").forEach((el) => el.removeClass("is-active"));
		};
		let closed = false;
		const close = () => {
			if (closed) return;
			closed = true;
			document.removeEventListener("mousedown", outside, true);
			closeSub();
			pop.remove();
		};
		// a click closes only when it lands outside BOTH the flyout and its submenu
		const outside = (e: MouseEvent) => {
			const t = e.target as Node;
			if (!pop.contains(t) && !(sub && sub.contains(t))) close();
		};
		// a nested panel that grows beside the flyout and stays open with it
		const openSubmenuAt = (anchor: { right: number; top: number }, items: PBSubItem[]) => {
			sub = document.body.createDiv({ cls: "pb-colmenu pb-colmenu-sub" });
			sub.style.left = Math.min(anchor.right - 4, window.innerWidth - 220) + "px";
			sub.style.top = Math.min(anchor.top - 6, window.innerHeight - 340) + "px";
			const srows = sub.createDiv({ cls: "pb-colmenu-rows" });
			for (const it of items) {
				const sr = srows.createDiv({ cls: "pb-colmenu-row" });
				const ic = sr.createSpan({ cls: "pb-colmenu-ic" });
				if (it.icon) setIcon(ic, it.icon);
				sr.createSpan({ cls: "pb-colmenu-label", text: it.label });
				if (it.checked) setIcon(sr.createSpan({ cls: "pb-colmenu-x" }), "check");
				sr.addEventListener("click", () => {
					close();
					it.onClick();
				});
			}
		};

		// header row: a type-icon button (opens Set type) plus the name field
		const nameRow = pop.createDiv({ cls: "pb-colmenu-namerow" });
		const typeBtn = nameRow.createDiv({ cls: "pb-colmenu-typebtn", attr: { "aria-label": "Set type" } });
		setIcon(typeBtn, this.columnIcon(p));
		if (isNote) {
			typeBtn.addClass("is-clickable");
			typeBtn.addEventListener("click", () => {
				const already = typeBtn.hasClass("is-active");
				closeSub();
				if (already) return;
				typeBtn.addClass("is-active");
				const pr = pop.getBoundingClientRect();
				openSubmenuAt({ right: pr.right, top: pr.top }, this.typeMenuItems(fmKey));
			});
		}
		if (isNote || isFormula) {
			const cur = this.config.getDisplayName(p);
			const nameBox = nameRow.createDiv({ cls: "pb-colmenu-namebox" });
			const nameIn = nameBox.createEl("input", { cls: "pb-colmenu-name", attr: { placeholder: "Column name" } });
			nameIn.value = cur;
			nameIn.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					const v = nameIn.value.trim();
					close();
					if (v && v !== cur) void this.renameColumn(p, v);
				} else if (e.key === "Escape") close();
			});
		} else {
			nameRow.createDiv({ cls: "pb-colmenu-title", text: this.config.getDisplayName(p) });
		}

		const rows = pop.createDiv({ cls: "pb-colmenu-rows" });
		const sep = () => rows.createDiv({ cls: "pb-colmenu-sep" });
		const row = (icon: string, label: string, cb: () => void, o?: { danger?: boolean; check?: boolean }) => {
			const r = rows.createDiv({ cls: "pb-colmenu-row" + (o?.danger ? " is-danger" : "") });
			setIcon(r.createSpan({ cls: "pb-colmenu-ic" }), icon);
			r.createSpan({ cls: "pb-colmenu-label", text: label });
			if (o?.check) setIcon(r.createSpan({ cls: "pb-colmenu-x" }), "check");
			r.addEventListener("click", () => {
				close();
				cb();
			});
		};
		// a submenu row keeps the flyout open and grows a nested panel beside it
		const subRow = (icon: string, label: string, items: () => PBSubItem[]) => {
			const r = rows.createDiv({ cls: "pb-colmenu-row pb-colmenu-parent" });
			setIcon(r.createSpan({ cls: "pb-colmenu-ic" }), icon);
			r.createSpan({ cls: "pb-colmenu-label", text: label });
			setIcon(r.createSpan({ cls: "pb-colmenu-x" }), "chevron-right");
			r.addEventListener("click", () => {
				const already = r.hasClass("is-active");
				closeSub();
				if (already) return;
				r.addClass("is-active");
				openSubmenuAt(r.getBoundingClientRect(), items());
			});
		};

		const idx = this.currentOrder().indexOf(pid);
		if (isNote) subRow("shapes", "Set type", () => this.typeMenuItems(fmKey));
		if (isFormula) row("pencil", "Edit formula", () => this.openFormulaModal(pid.slice("formula.".length)));
		if (kind === "date") row("calendar", "Date format", () => this.openDateFormat(pid));
		else if (kind === "number" || isFormula) row("hash", "Number format", () => this.openNumberFormat(pid));
		if (isNote && this.plugin.fieldType(fmKey) === "phone") row("phone", "Phone format", () => this.openPhoneFormat(pid));
		sep();
		row("filter", this.columnFilter(pid) ? "Edit filter" : "Filter…", () =>
			new ColumnFilterModal(this.app, this.config.getDisplayName(p), this.columnFilter(pid) ?? undefined, (f) => this.setFilter(pid, f)).open()
		);
		subRow("arrow-up-down", "Sort", () => this.sortMenuItems(pid));
		subRow("sigma", "Calculate", () => this.calcMenuItems(pid));
		if (idx >= 0) {
			const isFrozen = this.freezeCount() > idx;
			row("pin", isFrozen ? "Unfreeze" : "Freeze up to here", () => this.setFreeze(isFrozen ? 0 : idx + 1), { check: isFrozen });
		}
		row("wrap-text", "Wrap content", () => this.toggleWrap(pid), { check: this.config.get("wrap:" + pid) === true });
		row("eye-off", "Hide from this view", () => void this.removeColumn(p));
		if (this.config.get("pbHideName") === true)
			row("eye", "Show file name column", () => {
				this.config.set("pbHideName", false);
				this.onDataUpdated();
			});
		sep();
		row("arrow-left-to-line", "Insert left", () => this.insertColumnBeside(p, 0));
		row("arrow-right-to-line", "Insert right", () => this.insertColumnBeside(p, 1));
		if (isNote) row("copy", "Duplicate", () => void this.duplicateColumn(p));
		row("plus", "Add formula column", () => this.openFormulaModal());
		sep();
		if (isNote) {
			row(
				"trash-2",
				"Delete column and data",
				() => {
					const n = this.countWithProp(fmKey);
					new ConfirmModal(this.app, {
						title: "Delete column",
						body: `Delete the "${this.config.getDisplayName(p)}" column and its data from ${n} note${n === 1 ? "" : "s"} in this base? You can undo this afterward.`,
						confirmText: "Delete",
						onConfirm: () => void this.deleteColumnData(p),
					}).open();
				},
				{ danger: true }
			);
		} else if (isFormula) {
			const name = pid.slice("formula.".length);
			row(
				"trash-2",
				"Delete formula",
				() =>
					new ConfirmModal(this.app, {
						title: "Delete formula",
						body: `Delete the "${name}" formula and its column from this base?`,
						confirmText: "Delete",
						onConfirm: () => void this.deleteFormulaColumn(name),
					}).open(),
				{ danger: true }
			);
		}

		window.setTimeout(() => document.addEventListener("mousedown", outside, true), 0);
	}

	/** Toggle whether a column wraps its content (default is truncate). */
	private toggleWrap(pid: string) {
		this.config.set("wrap:" + pid, this.config.get("wrap:" + pid) === true ? null : true);
		this.onDataUpdated();
	}

	/** Open the add-column dialog inserting beside `p` (offset 0 = left, 1 = right). */
	private insertColumnBeside(p: BasesPropertyId, offset: number) {
		const at = this.currentOrder().indexOf(String(p));
		this.openAddColumn(at < 0 ? undefined : at + offset);
	}

	/** Copy a note column (property, values, type, and formats) to a new column. */
	private async duplicateColumn(p: BasesPropertyId) {
		const file = this.baseFile();
		if (!file || !p.startsWith("note.")) return;
		const key = frontmatterKey(p);
		const newName = this.uniquePropName(key + " copy");
		const newId = "note." + newName;
		const writes: { file: TFile; assignments: Record<string, unknown> }[] = [];
		for (const en of this.data.data) {
			const fm = frontmatterOf(this.app, en.file);
			if (fm && fm[key] != null) writes.push({ file: en.file, assignments: { [newName]: fm[key] } });
		}
		const mtm = (this.app as unknown as { metadataTypeManager?: { getAssignedType?: (n: string) => string | null } }).metadataTypeManager;
		const t = mtm?.getAssignedType?.(key);
		if (t) this.setObsidianType(newName, t);
		const at = this.currentOrder().indexOf(String(p)) + 1;
		try {
			await addViewColumn(this.app, file, newId, this.viewName(), this.type, this.currentOrder(), undefined, at);
		} catch (e) {
			new Notice("Power Bases: could not duplicate. " + (e as Error).message);
			return;
		}
		const ft = this.plugin.fieldType(key);
		if (ft) await this.plugin.setFieldType(newName, ft);
		const sk = this.plugin.storedKind(key);
		if (sk) await this.plugin.setStoredKind(newName, sk);
		const nf = this.plugin.numberFormat(String(p));
		if (nf) await this.plugin.applyNumberFormat([newId], nf);
		const df = this.plugin.dateFormat(String(p));
		if (df) await this.plugin.applyDateFormat([newId], df);
		const pf = this.plugin.phoneFormat(String(p));
		if (pf) await this.plugin.applyPhoneFormat([newId], pf);
		if (writes.length) await this.plugin.writeBatch(`Duplicated "${key}" to "${newName}"`, writes);
		this.plugin.refreshAll();
		new Notice(`Power Bases: duplicated to "${newName}".`);
	}

	/** A property name not already used by the base's notes. */
	private uniquePropName(base: string): string {
		const keys = new Set<string>();
		for (const en of this.data.data.slice(0, 300)) {
			const fm = frontmatterOf(this.app, en.file);
			if (fm) for (const k of Object.keys(fm)) keys.add(k);
		}
		let name = base;
		for (let i = 2; keys.has(name); i++) name = base + " " + i;
		return name;
	}

	/** Delete a formula column (removes the formula and its column from the base). */
	private async deleteFormulaColumn(name: string) {
		const file = this.baseFile();
		if (!file) {
			new Notice("Power Bases: deleting formulas needs a saved .base file; an inline base block has none.");
			return;
		}
		await removeFormula(this.app, file, name);
		this.plugin.refreshAll();
		new Notice(`Power Bases: deleted formula "${name}".`);
	}

	/** Rename a column: the frontmatter key across the base's rows (note columns,
	 *  one undoable change), the id in the base file, and its saved settings. */
	private async renameColumn(p: BasesPropertyId, rawNew: string) {
		const file = this.baseFile();
		if (!file) {
			new Notice("Power Bases: renaming columns needs a saved .base file; an inline base block has none.");
			return;
		}
		const newName = rawNew
			.replace(/[\r\n]+/g, " ")
			.replace(/[:#[\]{}",.]/g, "")
			.replace(/\s+/g, " ")
			.trim();
		const isFormula = p.startsWith("formula.");
		const oldName = String(p).slice(String(p).indexOf(".") + 1);
		if (!newName || newName === oldName) {
			this.onDataUpdated();
			return;
		}
		const newId = (isFormula ? "formula." : "note.") + newName;
		if (!isFormula) {
			const writes: { file: TFile; assignments: Record<string, unknown> }[] = [];
			for (const en of this.data.data) {
				const fm = frontmatterOf(this.app, en.file);
				if (fm && oldName in fm) writes.push({ file: en.file, assignments: { [newName]: fm[oldName], [oldName]: undefined } });
			}
			if (writes.length) await this.plugin.writeBatch(`Renamed "${oldName}" to "${newName}"`, writes);
			const mtm = (this.app as unknown as { metadataTypeManager?: { getAssignedType?: (n: string) => string | null } }).metadataTypeManager;
			const t = mtm?.getAssignedType?.(oldName);
			if (t) this.setObsidianType(newName, t);
		}
		try {
			await renamePropertyInBase(this.app, file, String(p), newId, isFormula, oldName, newName);
		} catch (e) {
			new Notice("Power Bases: could not rename the column. " + (e as Error).message);
			return;
		}
		await this.plugin.renameSettings(oldName, newName, String(p), newId);
		this.plugin.refreshAll();
		new Notice(`Power Bases: renamed to "${newName}".`);
	}

	/* ----- column widths (drag to resize) and drag-to-reorder ----- */

	/** Apply a column's width (saved in the view config, or a sensible default)
	 *  to its header; returns the pixels so the table's total width can be set. */
	private applyColWidth(th: HTMLElement, propId: string): number {
		const stored = this.config.get("w:" + propId);
		const w = typeof stored === "number" && stored > 0 ? Math.round(stored) : this.defaultColWidth(propId);
		th.style.width = w + "px";
		return w;
	}

	private defaultColWidth(propId: string): number {
		if (propId === "file.name") return 180;
		const k = this.columnKind(propId as BasesPropertyId);
		return k === "date" ? 160 : k === "number" ? 120 : 130;
	}

	/** A grip on the header's right edge; dragging it resizes the column and
	 *  saves the new width to the view config (persists, travels with copy-setup). */
	private attachColResize(th: HTMLElement, propId: string) {
		const grip = th.createDiv({ cls: "pb-col-resize" });
		grip.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			e.stopPropagation();
			const startX = e.clientX;
			const startW = th.getBoundingClientRect().width;
			const move = (ev: PointerEvent) => {
				th.style.width = Math.max(48, Math.round(startW + (ev.clientX - startX))) + "px";
			};
			const up = () => {
				document.removeEventListener("pointermove", move);
				document.removeEventListener("pointerup", up);
				this.config.set("w:" + propId, Math.round(th.getBoundingClientRect().width));
			};
			document.addEventListener("pointermove", move);
			document.addEventListener("pointerup", up);
		});
	}

	/** Drag a header sideways to reorder columns; a vertical line marks the drop
	 *  point and the new order is written into the base file. */
	private attachColReorder(th: HTMLElement, p: BasesPropertyId, cols: BasesPropertyId[], hr: HTMLElement) {
		th.addEventListener("pointerdown", (e) => {
			if (e.button !== 0 || (e.target as HTMLElement).closest(".pb-col-resize, input")) return;
			const startX = e.clientX;
			let dragging = false;
			let line: HTMLElement | null = null;
			let insertBefore = cols.length;
			const ths = Array.from(hr.children).slice(0, cols.length) as HTMLElement[];
			const move = (ev: PointerEvent) => {
				if (!dragging && Math.abs(ev.clientX - startX) > 6) {
					dragging = true;
					this.draggedHeader = true;
					th.addClass("pb-col-dragging");
					line = document.body.createDiv({ cls: "pb-col-dropline" });
				}
				if (!dragging || !line) return;
				let edge = 0;
				insertBefore = ths.length;
				for (let i = 0; i < ths.length; i++) {
					const r = ths[i].getBoundingClientRect();
					if (ev.clientX < r.left + r.width / 2) {
						insertBefore = i;
						edge = r.left;
						break;
					}
					edge = r.right;
				}
				const tr = (th.closest("table") as HTMLElement).getBoundingClientRect();
				line.style.left = edge + "px";
				line.style.top = tr.top + "px";
				line.style.height = tr.height + "px";
			};
			const up = (ev: PointerEvent) => {
				document.removeEventListener("pointermove", move);
				document.removeEventListener("pointerup", up);
				th.removeClass("pb-col-dragging");
				line?.remove();
				if (dragging) void this.reorderColumn(cols, p, insertBefore);
				else this.openColumnMenu(th, p, { x: ev.clientX, y: ev.clientY }); // a plain click opens the flyout
			};
			document.addEventListener("pointermove", move);
			document.addEventListener("pointerup", up);
		});
	}

	/** Move a column to a new index and persist the order into the base file. */
	private async reorderColumn(cols: BasesPropertyId[], moved: BasesPropertyId, insertBefore: number) {
		const from = cols.indexOf(moved);
		if (from < 0) return;
		const order = cols.map((c) => String(c));
		order.splice(from, 1);
		const to = insertBefore > from ? insertBefore - 1 : insertBefore;
		order.splice(Math.max(0, Math.min(order.length, to)), 0, String(moved));
		const file = this.baseFile();
		if (!file) {
			new Notice("Power Bases: reordering columns needs a saved .base file; an inline base block has none.");
			this.onDataUpdated();
			return;
		}
		try {
			await writeViewOrder(this.app, file, this.viewName(), this.type, order);
		} catch (e) {
			new Notice("Power Bases: could not reorder. " + (e as Error).message);
			return;
		}
		this.plugin.refreshAll();
	}

	/** Drop a column from this view's order in the base file (the data stays). */
	private async removeColumn(p: BasesPropertyId) {
		if (p === "file.name") {
			// the name column is not part of the stored order (the table
			// prepends it), so hiding it is a view flag, not an order write
			this.config.set("pbHideName", true);
			this.onDataUpdated();
			return;
		}
		const file = this.baseFile();
		if (!file) {
			new Notice("Power Bases: removing columns needs a saved .base file; an inline base block has none.");
			return;
		}
		const label = this.config.getDisplayName(p);
		const order = this.currentOrder().filter((o) => o !== String(p));
		try {
			await writeViewOrder(this.app, file, this.viewName(), this.type, order);
		} catch (e) {
			new Notice("Power Bases: could not remove the column. " + (e as Error).message);
			return;
		}
		this.plugin.refreshAll();
		new Notice(`Power Bases: removed the "${label}" column.`);
	}

	/** Remove a column and delete its property from the base's rows (one undoable
	 *  change), for a full Notion-style column delete. */
	private async deleteColumnData(p: BasesPropertyId) {
		if (!p.startsWith("note.")) {
			await this.removeColumn(p);
			return;
		}
		const key = frontmatterKey(p);
		const writes: { file: TFile; assignments: Record<string, unknown> }[] = [];
		for (const en of this.data.data) {
			const fm = frontmatterOf(this.app, en.file);
			if (fm && key in fm) writes.push({ file: en.file, assignments: { [key]: undefined } });
		}
		if (writes.length) await this.plugin.writeBatch(`Deleted "${key}" from ${writes.length} note${writes.length === 1 ? "" : "s"}`, writes);
		await this.removeColumn(p);
	}

	/** How many of the base's rows carry a given frontmatter key. */
	private countWithProp(key: string): number {
		let n = 0;
		for (const en of this.data.data) {
			const fm = frontmatterOf(this.app, en.file);
			if (fm && key in fm) n++;
		}
		return n;
	}

	/** Open the formula editor for this base (add mode, or edit an existing key). */
	private openFormulaModal(editKey?: string) {
		const file = this.baseFile();
		if (!file) {
			new Notice("Power Bases: formulas need a saved .base file; an inline base block has none.");
			return;
		}
		new FormulaModal(this.app, this.plugin, this, file, editKey).open();
	}

	/** Click anywhere but a link or button inside the cell to edit; the opener
	 *  also rides the element so keyboard navigation (Tab and the arrows) can
	 *  re-invoke it on neighboring cells. */
	private registerEdit(td: HTMLElement, open: () => void) {
		td.addClass("pb-editable");
		(td as HTMLElement & { pbEdit?: () => void }).pbEdit = open;
		td.addEventListener("click", (ev) => {
			if ((ev.target as HTMLElement).closest("a, button")) return;
			open();
		});
	}

	private makeEditable(td: HTMLElement, en: BasesEntry, fmKey: string, kind: CellKind, raw: unknown) {
		this.registerEdit(td, () => this.beginEdit(td, en, fmKey, kind, raw));
	}

	/** Commit-and-move between cells: dx for Tab and Shift+Tab (wrapping to
	 *  the neighboring row), dy for the up and down arrows (same column).
	 *  Cells advertise editability via pbEdit, so checkboxes and read-only
	 *  columns are skipped sideways and block vertical moves. Only rendered
	 *  rows are reachable; scrolling renders more. */
	private editNeighbor(td: HTMLElement, dx: number, dy: number) {
		type EditCell = HTMLTableCellElement & { pbEdit?: () => void };
		const tr = td.closest("tr");
		const table = td.closest("table");
		if (!(tr instanceof HTMLTableRowElement) || !table) return;
		const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr.pb-tr:not(.pb-subtotal)"));
		const ri = rows.indexOf(tr);
		const ci = (td as HTMLTableCellElement).cellIndex;
		if (ri < 0 || ci < 0) return;
		const scan = (row: HTMLTableRowElement, from: number, step: number): EditCell | null => {
			for (let i = from; i >= 0 && i < row.cells.length; i += step) {
				const c = row.cells[i] as EditCell;
				if (c.pbEdit) return c;
			}
			return null;
		};
		let target: EditCell | null = null;
		const pastEnd = ri === rows.length - 1;
		// growing the table needs something in the row being left; otherwise
		// tabbing around an empty row would mint page after empty page
		const rowHasContent = Array.from(tr.cells).some((c) => c.textContent?.trim());
		if (dy) {
			const row = rows[ri + dy];
			if (!row && dy > 0) {
				// moving down off the last row grows the table, Notion-style
				if (rowHasContent) void this.addRow(ci);
				return;
			}
			const c = row?.cells[ci] as EditCell | undefined;
			target = c?.pbEdit ? c : null;
		} else if (dx > 0) {
			target = scan(tr, ci + 1, 1) ?? (rows[ri + 1] ? scan(rows[ri + 1], 0, 1) : null);
			if (!target && pastEnd) {
				if (rowHasContent) void this.addRow(0);
				return;
			}
		} else if (dx < 0) {
			const prev = rows[ri - 1];
			target = scan(tr, ci - 1, -1) ?? (prev ? scan(prev, prev.cells.length - 1, -1) : null);
		}
		if (!target) return;
		target.scrollIntoView({ block: "nearest", inline: "nearest" });
		target.pbEdit?.();
	}

	/** Where a keyboard-added row's note belongs: beside the existing rows;
	 *  else (empty base) the folder the base's own filters scope to, created
	 *  on demand; else the host note's folder. */
	private async rowFolder(): Promise<TFolder> {
		const first = this.data.data[0]?.file.parent;
		if (first) return first;
		const bf = this.baseFile();
		if (bf) {
			try {
				const cfg = await readBaseConfig(this.app, bf);
				const scoped = scopeFolder(cfg.filters);
				if (scoped) {
					await this.plugin.ensureFolder(scoped);
					const af = this.app.vault.getAbstractFileByPath(scoped);
					if (af instanceof TFolder) return af;
				}
			} catch {
				// unreadable base config: fall through to the host note's home
			}
		}
		const probe = (this as unknown as { controller?: { file?: TFile } }).controller?.file;
		if (probe instanceof TFile && probe.extension === "md" && probe.parent) return probe.parent;
		return this.app.workspace.getActiveFile()?.parent ?? this.app.vault.getRoot();
	}

	/** A fresh row, created quietly: the note is written without being opened
	 *  (Bases' own creator opens a pane, which yanks focus out of the table),
	 *  and the repaint that brings the row in drops straight into its editor. */
	private pendingRowEdit: { path: string; ci: number } | null = null;
	private selected = new Set<string>();
	private lastEntries: BasesEntry[] = [];
	private lastCols: BasesPropertyId[] = [];
	private selBar: HTMLElement | null = null;
	private lastSelPath: string | null = null;
	private async addRow(ci = 0) {
		const folder = await this.rowFolder();
		const prefix = folder.path === "/" ? "" : folder.path + "/";
		let name = "Untitled";
		for (let i = 1; this.app.vault.getAbstractFileByPath(prefix + name + ".md"); i++) name = `Untitled ${i}`;
		const f = await this.app.vault.create(prefix + name + ".md", "");
		if (this.plugin.settings.stampEdits && this.plugin.settings.myName.trim()) {
			await this.app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => this.plugin.stampCreate(fm));
		}
		this.pendingRowEdit = { path: f.path, ci };
	}

	/* ----- manual row order, export, fill-down, grid paste ----- */

	private rawRankOf(en: BasesEntry, rankKey: string): number | null {
		const v = frontmatterOf(this.app, en.file)?.[rankKey];
		return typeof v === "number" ? v : null;
	}

	/** Drag a row's grip up or down; the drop renumbers the visible rows in
	 *  their new order (gaps of 100, one undoable change), so the manual
	 *  order is data that syncs and even drives other views. */
	private attachRowDrag(grip: HTMLElement, tr: HTMLTableRowElement, rankKey: string | null) {
		grip.addEventListener("pointerdown", (e) => {
			if (e.button !== 0) return;
			e.preventDefault();
			e.stopPropagation();
			const table = tr.closest("table");
			if (!table) return;
			const rowsNow = () => Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr.pb-tr:not(.pb-subtotal)"));
			let line: HTMLElement | null = null;
			let before: HTMLTableRowElement | null = null;
			let dragging = false;
			const startY = e.clientY;
			const move = (ev: PointerEvent) => {
				if (!dragging && Math.abs(ev.clientY - startY) < 5) return;
				dragging = true;
				tr.addClass("pb-row-dragging");
				if (!line) line = document.body.createDiv({ cls: "pb-row-dropline" });
				before = null;
				const rs = rowsNow();
				let y = rs.length ? rs[rs.length - 1].getBoundingClientRect().bottom : 0;
				for (const r of rs) {
					const rect = r.getBoundingClientRect();
					if (ev.clientY < rect.top + rect.height / 2) {
						before = r;
						y = rect.top;
						break;
					}
				}
				const tRect = table.getBoundingClientRect();
				line.style.left = tRect.left + "px";
				line.style.width = tRect.width + "px";
				line.style.top = y - 1 + "px";
			};
			const up = () => {
				document.removeEventListener("pointermove", move);
				document.removeEventListener("pointerup", up);
				tr.removeClass("pb-row-dragging");
				line?.remove();
				if (!dragging) return;
				const dp = tr.getAttribute("data-path");
				const bp = before?.getAttribute("data-path") ?? null;
				if (dp && bp !== dp) void this.applyRowDrop(rankKey, dp, bp);
			};
			document.addEventListener("pointermove", move);
			document.addEventListener("pointerup", up);
		});
	}

	/** An embedded base sits inside the note's `.internal-embed`, wrapped by
	 *  Bases' own toolbar (Sort, Filter, ..., and the code toggle). Put the
	 *  delete affordance up on that top row, and hide the code toggle (its
	 *  raw YAML is not the point of an embed). Re-run each paint since Bases
	 *  owns and may repaint that toolbar; guarded so it never doubles up. */
	private decorateEmbed() {
		// Mark whichever container this base is drawn in, so the frame around it
		// is a plain class. Reaching it with :has() instead means the browser
		// re-matches a parent whenever its descendants change, which is the cost
		// the directory flags.
		this.rootEl.closest<HTMLElement>(".internal-embed, .block-language-base")?.addClass("pb-base-host");

		const embed = this.rootEl.closest<HTMLElement>(".internal-embed");
		if (!embed) return;
		embed.addClass("pb-embed-host");
		if (!embed.querySelector(":scope > .pb-embed-del")) {
			const del = embed.createEl("button", { cls: "pb-embed-del", attr: { "aria-label": "Delete this base" } });
			setIcon(del, "trash-2");
			del.addEventListener("click", () => void this.plugin.deleteActiveBase(this));
		}
		// hide the native code toggle: the button around a code-glyph svg that
		// lives in the toolbar (outside our own view root)
		embed.querySelectorAll("svg[class*='lucide-code']").forEach((svg) => {
			if (svg.closest(".pb-root")) return;
			const btn = svg.closest<HTMLElement>("button, [role='button'], .clickable-icon") ?? svg.parentElement;
			btn?.classList.add("pb-native-hidden");
		});
	}

	/** The frontmatter key rows order by, with no sort active: a plain string
	 *  stored under `pbRank` (the reliable config path, like freeze and sort),
	 *  or the native "Manual order property" option when set from the gear
	 *  menu. Null while sorting, which owns the order. */
	private resolveRankKey(sortCfg: unknown): string | null {
		if (sortCfg) return null;
		const plain = this.config.get("pbRank");
		if (typeof plain === "string" && plain.trim()) return plain.trim();
		const pid = this.config.getAsPropertyId("pbRankProp");
		return pid && String(pid).startsWith("note.") ? frontmatterKey(pid) : null;
	}

	/** The rank key for a drag, provisioning `pbRank` on first use so manual
	 *  order needs no setup. */
	private ensureRankKey(rankKey: string | null): string {
		if (rankKey) return rankKey;
		this.config.set("pbRank", "pb-order");
		return "pb-order";
	}

	private async applyRowDrop(rankKey: string | null, draggedPath: string, beforePath: string | null) {
		if (this.lastEntries.length > 400) {
			new Notice("Power Bases: manual reorder is for tables up to 400 rows; use Sort for bigger sets.");
			return;
		}
		rankKey = this.ensureRankKey(rankKey);
		const list = this.lastEntries.map((en) => en.file);
		const from = list.findIndex((f) => f.path === draggedPath);
		if (from < 0) return;
		const [moved] = list.splice(from, 1);
		let at = beforePath ? list.findIndex((f) => f.path === beforePath) : list.length;
		if (at < 0) at = list.length;
		list.splice(at, 0, moved);
		const ranks = renumber(list.length);
		await this.plugin.writeBatch(
			"Reordered rows",
			list.map((f, i) => ({ file: f, assignments: { [rankKey]: ranks[i] } }))
		);
	}

	/** A new row at a chosen position: manual order gives position meaning,
	 *  provisioned on first use; the visible set renumbers around the new
	 *  note and its first cell opens for typing. */
	private async insertRowNear(en: BasesEntry, offset: 0 | 1) {
		if (this.sortConfig()) {
			new Notice("Power Bases: clear the column sort to place rows manually.");
			return;
		}
		if (this.lastEntries.length + 1 > 400) {
			new Notice("Power Bases: manual placement is for tables up to 400 rows.");
			return;
		}
		const key = this.ensureRankKey(this.resolveRankKey(this.sortConfig()));
		const folder = await this.rowFolder();
		const prefix = folder.path === "/" ? "" : folder.path + "/";
		let name = "Untitled";
		for (let i = 1; this.app.vault.getAbstractFileByPath(prefix + name + ".md"); i++) name = `Untitled ${i}`;
		const nf = await this.app.vault.create(prefix + name + ".md", "");
		if (this.plugin.settings.stampEdits && this.plugin.settings.myName.trim()) {
			await this.app.fileManager.processFrontMatter(nf, (fm: Record<string, unknown>) => this.plugin.stampCreate(fm));
		}
		const files = this.lastEntries.map((e) => e.file);
		const at = files.findIndex((f) => f.path === en.file.path);
		files.splice(at < 0 ? files.length : at + offset, 0, nf);
		const ranks = renumber(files.length);
		await this.plugin.writeBatch(
			"Inserted a row",
			files.map((f, i) => ({ file: f, assignments: { [key]: ranks[i] } }))
		);
		this.pendingRowEdit = { path: nf.path, ci: 0 };
	}

	/** The visible table (current filters, sort, and columns, formatted as
	 *  shown) as a CSV file beside the base, spreadsheet-ready. */
	async exportCsv() {
		const cols = this.lastCols.length ? this.lastCols : (this.currentOrder() as BasesPropertyId[]);
		const rows: string[][] = [cols.map((p) => this.config.getDisplayName(p))];
		for (const en of this.lastEntries) {
			rows.push(
				cols.map((p) => {
					if (p === "file.name") return en.file.basename;
					return this.display(en, p, this.text(en, p));
				})
			);
		}
		const bf = this.baseFile();
		const folder = bf?.parent?.path ?? this.app.workspace.getActiveFile()?.parent?.path ?? "";
		const path = this.plugin.uniquePath(folder === "/" ? "" : folder, (bf?.basename ?? "table") + " export", ".csv");
		await this.app.vault.create(path, toCsv(rows));
		new Notice(`Power Bases: exported ${this.lastEntries.length} rows to "${path}".`);
	}

	/** The same column's value one row up, for fill-down (Ctrl+D). */
	private cellAbove(td: HTMLElement, fmKey: string): string | null {
		const tr = td.closest("tr");
		const table = td.closest("table");
		if (!(tr instanceof HTMLTableRowElement) || !table) return null;
		const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr.pb-tr:not(.pb-subtotal)"));
		const ri = rows.indexOf(tr);
		if (ri <= 0) return null;
		const f = this.app.vault.getAbstractFileByPath(rows[ri - 1].getAttribute("data-path") ?? "");
		if (!(f instanceof TFile)) return null;
		const v = frontmatterOf(this.app, f)?.[fmKey];
		if (v == null) return "";
		return Array.isArray(v) ? v.map(String).join(", ") : String(v);
	}

	/** Paste a spreadsheet block: tab-separated columns starting at the anchor
	 *  cell, one table row per line, rows created past the end. Property
	 *  writes land as one undoable change; values with no editable column
	 *  under them are counted and reported, never silently eaten. */
	private async pasteGrid(td: HTMLElement, text: string) {
		const grid = parseCsv(text.replace(/\r\n?/g, "\n"), "\t").filter((r) => r.some((c) => c.trim()));
		if (!grid.length) return;
		const tr = td.closest("tr");
		const table = td.closest("table");
		if (!(tr instanceof HTMLTableRowElement) || !table) return;
		const rowsEls = Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr.pb-tr:not(.pb-subtotal)"));
		const ri = rowsEls.indexOf(tr);
		const ci = (td as HTMLTableCellElement).cellIndex;
		if (ri < 0 || ci < 0) return;
		const cols = this.lastCols;
		const width = grid.reduce((m, r) => Math.max(m, r.length), 0);
		const colTargets: ({ key: string; kind: CellKind } | null)[] = [];
		for (let j = 0; j < width; j++) {
			const p = cols[ci + j];
			if (p && String(p).startsWith("note.")) {
				const key = frontmatterKey(p);
				colTargets.push({ key, kind: this.plugin.storedKind(key) ?? this.plugin.assignedKind(key) ?? "text" });
			} else colTargets.push(null);
		}
		if (!colTargets.some(Boolean)) {
			new Notice("Power Bases: the columns under the paste are not editable.");
			return;
		}
		const files: TFile[] = [];
		for (let i = 0; i < grid.length; i++) {
			const f = this.app.vault.getAbstractFileByPath(rowsEls[ri + i]?.getAttribute("data-path") ?? "");
			if (f instanceof TFile) files.push(f);
			else break;
		}
		let created = 0;
		if (files.length < grid.length) {
			const folder = await this.rowFolder();
			const prefix = folder.path === "/" ? "" : folder.path + "/";
			for (let i = files.length; i < grid.length; i++) {
				let name = "Untitled";
				for (let k = 1; this.app.vault.getAbstractFileByPath(prefix + name + ".md"); k++) name = `Untitled ${k}`;
				files.push(await this.app.vault.create(prefix + name + ".md", ""));
				created++;
			}
		}
		const titleKey = this.titleColumnKey();
		const renames: { file: TFile; value: string }[] = [];
		let cellsWritten = 0;
		let dropped = 0;
		const writes: { file: TFile; assignments: Record<string, unknown> }[] = [];
		for (let i = 0; i < grid.length; i++) {
			const assignments: Record<string, unknown> = {};
			for (let j = 0; j < grid[i].length; j++) {
				const t = colTargets[j];
				const cell = (grid[i][j] ?? "").trim();
				if (!t) {
					if (cell) dropped++;
					continue;
				}
				let v: unknown = cell;
				if (!cell) v = undefined;
				else if (t.kind === "checkbox") v = ["true", "yes", "1", "x"].includes(cell.toLowerCase());
				else if (t.kind === "number") v = Number.isFinite(Number(cell)) ? Number(cell) : cell;
				else if (t.kind === "date" || t.kind === "datetime")
					v = parseDateInput(cell, this.plugin.dateFormat("note." + t.key)?.preset === "eu" ? "eu" : "us") ?? cell;
				else if (t.kind === "list")
					v = cell
						.split(",")
						.map((s) => s.trim())
						.filter(Boolean);
				assignments[t.key] = v;
				cellsWritten++;
				if (t.key === titleKey && typeof v === "string") renames.push({ file: files[i], value: v });
			}
			writes.push({ file: files[i], assignments });
		}
		await this.plugin.writeBatch(`Pasted ${cellsWritten} cells across ${grid.length} rows`, writes);
		for (const r of renames) this.maybeRenameUntitledFile(r.file, r.value);
		new Notice(
			`Power Bases: pasted ${cellsWritten} cells across ${grid.length} rows` +
				(created ? `, ${created} created` : "") +
				(dropped ? `; ${dropped} values had no editable column` : "") +
				"."
		);
	}

	/* ----- row selection + bulk actions ----- */

	private toggleRowSelect(path: string, shiftRange: boolean) {
		if (shiftRange && this.lastSelPath) {
			const order = this.lastEntries.map((en) => en.file.path);
			const a = order.indexOf(this.lastSelPath);
			const b = order.indexOf(path);
			if (a >= 0 && b >= 0) {
				for (let i = Math.min(a, b); i <= Math.max(a, b); i++) this.selected.add(order[i]);
				this.lastSelPath = path;
				this.updateSelUi();
				return;
			}
		}
		if (this.selected.has(path)) this.selected.delete(path);
		else this.selected.add(path);
		this.lastSelPath = path;
		this.updateSelUi();
	}

	/** Selection is painted in place (classes, checkboxes, the bar), never by
	 *  a repaint: 18,000 chunked rows should not rebuild per click. */
	private updateSelUi() {
		const n = this.selected.size;
		this.rootEl.querySelector("table")?.toggleClass("pb-hassel", n > 0);
		this.rootEl.querySelectorAll<HTMLTableRowElement>("tr.pb-tr").forEach((tr) => {
			const on = this.selected.has(tr.getAttribute("data-path") ?? "");
			tr.toggleClass("is-selected", on);
			const cb = tr.querySelector<HTMLInputElement>(".pb-rowsel");
			if (cb) cb.checked = on;
		});
		if (this.selBar) {
			this.selBar.toggleClass("is-on", n > 0);
			this.selBar.querySelector(".pb-selbar-count")?.setText(`${n} selected`);
		}
		const all = this.rootEl.querySelector<HTMLInputElement>(".pb-selall");
		if (all) all.checked = n > 0 && n === this.lastEntries.length;
	}

	private selectedFiles(): TFile[] {
		return [...this.selected].map((p) => this.app.vault.getAbstractFileByPath(p)).filter((f): f is TFile => f instanceof TFile);
	}

	/** Trash row notes behind a confirmation; the trash keeps them recoverable. */
	private deleteRows(files: TFile[]) {
		if (!files.length) return;
		new ConfirmModal(this.app, {
			title: files.length === 1 ? `Delete "${files[0].basename}"?` : `Delete ${files.length} rows?`,
			body:
				(files.length === 1 ? "The row's note goes" : `The ${files.length} rows' notes go`) +
				" to the trash, recoverable per your deleted-files setting.",
			confirmText: "Delete",
			onConfirm: () => {
				void (async () => {
					for (const f of files) await this.app.fileManager.trashFile(f);
					files.forEach((f) => this.selected.delete(f.path));
					new Notice(`Power Bases: ${files.length === 1 ? `"${files[0].basename}"` : files.length + " rows"} moved to trash.`);
				})();
			},
		}).open();
	}

	private async duplicateRows(files: TFile[]) {
		if (!files.length) return;
		for (const f of files) {
			const content = await this.app.vault.read(f);
			const folder = f.parent?.path ?? "";
			await this.app.vault.create(this.plugin.uniquePath(folder === "/" ? "" : folder, f.basename + " copy", ".md"), content);
		}
		new Notice(`Power Bases: duplicated ${files.length === 1 ? `"${files[0].basename}"` : files.length + " rows"}.`);
	}

	/** The view's note columns, for the bulk set-property picker. */
	noteColumns(): { key: string; label: string }[] {
		const out: { key: string; label: string }[] = [];
		for (const p of this.currentOrder()) {
			if (!p.startsWith("note.")) continue;
			out.push({ key: frontmatterKey(p as BasesPropertyId), label: this.config.getDisplayName(p as BasesPropertyId) });
		}
		return out;
	}

	/** One property, one value, across many rows, as one undoable change. */
	async bulkSet(files: TFile[], key: string, rawValue: string) {
		if (!files.length || !key) return;
		const kind = this.plugin.storedKind(key) ?? this.plugin.assignedKind(key) ?? "text";
		const t = rawValue.trim();
		let v: unknown = t;
		if (!t) v = undefined;
		else if (kind === "checkbox") v = t.toLowerCase() === "true";
		else if (kind === "number") v = Number.isFinite(Number(t)) ? Number(t) : t;
		else if (kind === "date" || kind === "datetime")
			v = parseDateInput(t, this.plugin.dateFormat("note." + key)?.preset === "eu" ? "eu" : "us") ?? t;
		else if (kind === "list")
			v = t
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
		await this.plugin.writeBatch(
			`Set ${key} on ${files.length} row${files.length === 1 ? "" : "s"}`,
			files.map((f) => ({ file: f, assignments: { [key]: v } }))
		);
	}

	/** Notion names the page after its title column: while a row is still
	 *  Untitled, filling its first text column renames the note to match, so
	 *  search and links show real names instead of Untitled 4. */
	private maybeRenameUntitled(en: BasesEntry, fmKey: string, value: string) {
		if (fmKey !== this.titleColumnKey()) return;
		this.maybeRenameUntitledFile(en.file, value);
	}

	private maybeRenameUntitledFile(file: TFile, value: string) {
		if (!value || !/^Untitled( \d+)?$/.test(file.basename)) return;
		const name = safeName(value);
		if (!name || name === file.basename) return;
		const folder = file.parent?.path ?? "";
		void this.app.fileManager.renameFile(file, this.plugin.uniquePath(folder === "/" ? "" : folder, name, ".md"));
	}

	private titleColumnKey(): string | null {
		for (const p of this.currentOrder()) {
			if (!p.startsWith("note.")) continue;
			const key = frontmatterKey(p as BasesPropertyId);
			const kind = this.plugin.storedKind(key) ?? this.plugin.assignedKind(key) ?? "text";
			if (kind === "text" && !this.plugin.fieldType(key)) return key;
		}
		return null;
	}

	/** Render a cell that carries an assigned field type. */
	private renderTypedCell(td: HTMLElement, en: BasesEntry, fmKey: string, ft: PBFieldType, raw: unknown, s: string) {
		const linkCell = (href: string, text: string, icon: string) => {
			const a = td.createEl("a", { cls: "pb-linkcell", href });
			const ic = a.createSpan({ cls: "pb-linkcell-ic" });
			setIcon(ic, icon);
			a.createSpan({ text });
			a.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				if (href) window.open(href);
			});
		};
		const displayName = () => this.config.getDisplayName(("note." + fmKey) as BasesPropertyId);
		switch (ft) {
			case "url": {
				const { caption, address } = parseLinkValue(s);
				if (address) linkCell(externalHref(address), caption || address, "external-link");
				this.registerEdit(td, () => this.beginUrlEdit(td, en, fmKey, raw));
				break;
			}
			case "email":
				if (s) linkCell(mailtoHref(s), s, "at-sign");
				this.makeEditable(td, en, fmKey, "text", raw);
				break;
			case "phone":
				if (s) linkCell(telHref(s), formatPhoneValue(s, this.plugin.phoneFormat("note." + fmKey)), "phone");
				this.makeEditable(td, en, fmKey, "text", raw);
				break;
			case "place": {
				const { caption, address } = parseLinkValue(s);
				if (address) linkCell(mapsUrl(address), caption || address, "map-pin");
				this.registerEdit(td, () => this.beginPlaceEdit(td, en, fmKey, raw));
				break;
			}
			case "person": {
				for (const nm of personNames(raw)) {
					const chip = td.createSpan({ cls: "pb-person", text: nm });
					chip.style.setProperty("--pb-c", this.plugin.hueFor(fmKey, nm));
				}
				this.makeEditable(td, en, fmKey, "list", raw);
				break;
			}
			case "id":
				if (s) {
					td.createSpan({ cls: "pb-id", text: s });
					td.addEventListener("contextmenu", (ev) => {
						ev.preventDefault();
						const menu = new Menu();
						menu.addItem((i) => i.setTitle("Regenerate ID").setIcon("refresh-cw").onClick(() => this.generateId(en, fmKey)));
						menu.addItem((i) =>
							i
								.setTitle("Clear ID")
								.setIcon("x")
								.onClick(() =>
									void this.plugin.writeBatch(`Cleared ID on "${en.file.basename}"`, [
										{ file: en.file, assignments: { [fmKey]: undefined } },
									])
								)
						);
						menu.showAtMouseEvent(ev);
					});
				} else {
					const b = td.createEl("button", { cls: "pb-id-gen", text: "Generate" });
					b.addEventListener("click", () => this.generateId(en, fmKey));
				}
				break;
			case "button": {
				const cfg = this.plugin.fieldConfig(fmKey);
				const label = cfg?.buttonLabel?.trim() || displayName() || "Run";
				const b = td.createEl("button", { cls: "pb-btn-cell", text: label });
				b.addEventListener("click", (e) => {
					e.stopPropagation();
					this.runButton(en, fmKey);
				});
				break;
			}
			case "verification": {
				const cfg = this.plugin.fieldConfig(fmKey);
				const expRaw = cfg?.verifyExpiryProp
					? frontmatterOf(this.app, en.file)?.[cfg.verifyExpiryProp]
					: null;
				const state = verifyState(raw, expRaw != null ? String(expRaw) : null, todayKey());
				const badge = td.createSpan({ cls: `pb-verify pb-verify-${state}` });
				setIcon(badge.createSpan({ cls: "pb-verify-ic" }), VERIFY_ICON[state]);
				badge.createSpan({ text: VERIFY_LABEL[state] });
				badge.addEventListener("click", (ev) => {
					ev.stopPropagation();
					const menu = new Menu();
					for (const st of ["verified", "unverified", "expired"] as VerifyState[]) {
						menu.addItem((i) =>
							i
								.setTitle(VERIFY_LABEL[st])
								.setIcon(VERIFY_ICON[st])
								.setChecked(state === st)
								.onClick(() => {
									const value = st === "unverified" ? undefined : st === "verified" ? "Verified" : "Expired";
									void this.plugin.writeBatch(`Set ${displayName()} to ${VERIFY_LABEL[st]} on "${en.file.basename}"`, [
										{ file: en.file, assignments: { [fmKey]: value } },
									]);
								})
						);
					}
					menu.showAtMouseEvent(ev);
				});
				break;
			}
			case "image": {
				const src = this.imageSrc(en, s);
				if (src) td.createEl("img", { cls: "pb-img-cell", attr: { src, alt: s } });
				else if (s) td.createSpan({ cls: "pb-file-link", text: s });
				this.registerEdit(td, () => this.beginFilePick(td, en, fmKey, raw, { images: true, multi: false }));
				break;
			}
			case "files": {
				const items = Array.isArray(raw) ? raw : raw == null || raw === "" ? [] : [raw];
				for (const it of items) {
					const str = String(it).trim();
					if (!str) continue;
					const { link, name } = fileLinkParts(str);
					const a = td.createEl("a", { cls: "pb-file-link", text: name });
					a.addEventListener("click", (e) => {
						e.preventDefault();
						e.stopPropagation();
						if (/^https?:\/\//i.test(link)) window.open(link);
						else {
							// openLinkText keeps parsing the #subpath itself; stepping to
							// the tab the note is already in first is enough to stop a
							// second copy, since an open with no new tab asked for lands
							// in whichever tab is active.
							void (async () => {
								const dest = this.app.metadataCache.getFirstLinkpathDest(getLinkpath(link), en.file.path);
								if (dest) await this.plugin.focusOpenTab(dest.path);
								await this.app.workspace.openLinkText(link, en.file.path);
							})();
						}
					});
				}
				this.registerEdit(td, () => this.beginFilePick(td, en, fmKey, raw, { images: false, multi: true }));
				break;
			}
		}
	}

	/** A displayable image src from a wikilink, vault path, or URL cell value. */
	private imageSrc(en: BasesEntry, s: string): string {
		if (!s) return "";
		const { link } = fileLinkParts(s);
		if (/^https?:\/\//i.test(link)) return link;
		const f = this.app.metadataCache.getFirstLinkpathDest(link, en.file.path) ?? this.app.vault.getAbstractFileByPath(link);
		return f instanceof TFile ? this.app.vault.getResourcePath(f) : "";
	}

	/** Fill the next sequential ID for this column into the row. */
	private generateId(en: BasesEntry, fmKey: string) {
		const prefix = this.plugin.fieldConfig(fmKey)?.prefix ?? "";
		const existing: string[] = [];
		for (const e of this.data.data) {
			const v = frontmatterOf(this.app, e.file)?.[fmKey];
			if (v != null && String(v).trim() !== "") existing.push(String(v));
		}
		const id = nextId(existing, prefix);
		void this.plugin.writeBatch(`Assigned ID ${id} to "${en.file.basename}"`, [{ file: en.file, assignments: { [fmKey]: id } }]);
	}

	/** Run a button cell: apply its property writes, then open its link. */
	private runButton(en: BasesEntry, fmKey: string) {
		const cfg = this.plugin.fieldConfig(fmKey);
		if (!cfg || (!cfg.buttonSets && !cfg.buttonLink)) {
			new Notice("Power Bases: configure this button first (right-click the column header).");
			return;
		}
		const now = new Date();
		const assignments: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(cfg.buttonSets ?? {})) {
			if (!k.trim()) continue;
			assignments[k] = parseRuleValue(expandToken(v, now));
		}
		if (Object.keys(assignments).length) {
			void this.plugin.writeBatch(`Button "${cfg.buttonLabel ?? fmKey}" on "${en.file.basename}"`, [{ file: en.file, assignments }]);
		}
		if (cfg.buttonLink?.trim()) {
			let url = cfg.buttonLink.trim();
			if (url.startsWith("note.")) {
				const v = frontmatterOf(this.app, en.file)?.[url.slice(5)];
				url = v != null ? String(v) : "";
			}
			const href = externalHref(url);
			if (href) window.open(href);
		}
	}

	/** A calendar popover for editing a date/datetime cell: click a day to set
	 *  it (a time field appears for datetimes), Today jumps back, Clear empties. */
	/** The month-grid popover. Picking a day (or Clear) calls onPick and
	 *  closes; clicking outside closes without picking. */
	private openDatePicker(
		anchor: HTMLElement,
		cur: string,
		kind: CellKind,
		onPick: (value: string | undefined) => void,
		onClose: () => void
	) {
		const anchorKey = dateKeyOf(cur) ?? todayKey();
		let viewY = +anchorKey.slice(0, 4);
		let viewM = +anchorKey.slice(5, 7) - 1;
		const selected = dateKeyOf(cur);
		const timeStr = cur.match(/T(\d{2}:\d{2})/)?.[1] ?? "";
		let timeField: HTMLInputElement | null = null;

		const pop = document.body.createDiv({ cls: "pb-datepick" });
		const rect = anchor.getBoundingClientRect();
		pop.style.left = Math.max(6, Math.min(rect.left, window.innerWidth - 252)) + "px";
		pop.style.top = rect.bottom + 4 + "px";

		let done = false;
		const close = (picked: string | undefined, commit: boolean) => {
			if (done) return;
			done = true;
			document.removeEventListener("mousedown", outside, true);
			pop.remove();
			if (commit) onPick(picked);
			else onClose();
		};
		const outside = (e: MouseEvent) => {
			if (!pop.contains(e.target as Node)) close(undefined, false);
		};
		const withTime = (key: string): string => (kind === "datetime" ? key + "T" + (timeField?.value || timeStr || "09:00") : key);

		const render = () => {
			pop.empty();
			const head = pop.createDiv({ cls: "pb-dp-head" });
			const prev = head.createEl("button", { cls: "pb-dp-nav" });
			setIcon(prev, "chevron-left");
			prev.addEventListener("click", () => {
				if (--viewM < 0) {
					viewM = 11;
					viewY--;
				}
				render();
			});
			head.createSpan({ cls: "pb-dp-title", text: new Date(viewY, viewM, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }) });
			const next = head.createEl("button", { cls: "pb-dp-nav" });
			setIcon(next, "chevron-right");
			next.addEventListener("click", () => {
				if (++viewM > 11) {
					viewM = 0;
					viewY++;
				}
				render();
			});
			head.createEl("button", { cls: "pb-dp-today", text: "Today" }).addEventListener("click", () => {
				const t = todayKey();
				viewY = +t.slice(0, 4);
				viewM = +t.slice(5, 7) - 1;
				render();
			});

			const dow = pop.createDiv({ cls: "pb-dp-dow" });
			for (let i = 0; i < 7; i++) dow.createSpan({ text: new Date(2026, 0, 4 + i).toLocaleDateString(undefined, { weekday: "narrow" }) });

			const grid = pop.createDiv({ cls: "pb-dp-grid" });
			const tKey = todayKey();
			for (const cell of monthGrid(viewY, viewM, false)) {
				const cls =
					"pb-dp-day" +
					(cell.inMonth ? "" : " pb-dp-out") +
					(cell.key === tKey ? " pb-dp-todaycell" : "") +
					(cell.key === selected ? " pb-dp-sel" : "");
				grid.createEl("button", { cls, text: String(cell.day) }).addEventListener("click", () => close(withTime(cell.key), true));
			}

			if (kind === "datetime") {
				const tr = pop.createDiv({ cls: "pb-dp-time" });
				tr.createSpan({ text: "Time" });
				timeField = tr.createEl("input", { attr: { type: "time" } });
				timeField.value = timeStr || "09:00";
			}

			pop.createDiv({ cls: "pb-dp-foot" })
				.createEl("button", { text: "Clear" })
				.addEventListener("click", () => close(undefined, true));
		};
		render();
		window.setTimeout(() => document.addEventListener("mousedown", outside, true), 0);
	}

	/** Date cells edit as text you can type (read per the column's date style,
	 *  ISO always welcome) with a calendar button for the picker; Tab and the
	 *  arrows navigate like any other cell. */
	private beginDateEdit(td: HTMLElement, en: BasesEntry, fmKey: string, kind: CellKind, raw: unknown) {
		this.editing = true;
		td.empty();
		td.addClass("pb-editing");
		const start = raw == null ? "" : String(raw);
		const wrap = td.createDiv({ cls: "pb-cell-datewrap" });
		const input = wrap.createEl("input", {
			cls: "pb-cell-input",
			attr: { type: "text", placeholder: kind === "datetime" ? "YYYY-MM-DD HH:MM" : "YYYY-MM-DD", spellcheck: "false" },
		});
		input.value = start;
		const calBtn = wrap.createEl("button", { cls: "pb-date-btn", attr: { "aria-label": "Pick from the calendar" } });
		setIcon(calBtn, "calendar");

		const style: "us" | "eu" = this.plugin.dateFormat("note." + fmKey)?.preset === "eu" ? "eu" : "us";
		let pickerOpen = false;
		let done = false;
		// returns false when the text does not read as a date (editor stays open)
		const close = (commit: boolean, navigating = false): boolean => {
			if (done) return true;
			let value: string | undefined;
			if (commit) {
				const text = input.value.trim();
				if (!text) value = undefined;
				else {
					const iso = text === start ? start : parseDateInput(text, style);
					if (iso == null) {
						new Notice("Power Bases: could not read that as a date. Try 2026-07-16" + (style === "eu" ? " or 16/07/2026." : " or 07/16/2026."));
						return false;
					}
					value = iso;
					// a typed date keeps the original time when none was given
					if (kind === "datetime" && !iso.includes("T")) {
						const t = start.match(/T(\d{2}:\d{2})/)?.[1];
						if (t) value = iso + "T" + t;
					}
				}
			}
			done = true;
			this.editing = false;
			if (commit && (value ?? "") !== start) {
				td.removeClass("pb-editing");
				td.setText(value ?? "");
				void this.plugin.writeBatch(`Set ${this.config.getDisplayName(("note." + fmKey) as BasesPropertyId)} on "${en.file.basename}"`, [
					{ file: en.file, assignments: { [fmKey]: value } },
				]);
				if (this.pendingUpdate) this.pendingUpdate = false;
				return true;
			}
			if (navigating) {
				td.removeClass("pb-editing");
				td.setText(input.value.trim());
				return true;
			}
			if (this.pendingUpdate) this.pendingUpdate = false;
			this.onDataUpdated();
			return true;
		};
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				close(true);
			} else if (e.key === "Escape") {
				e.preventDefault();
				close(false);
			} else if (e.key === "Tab") {
				e.preventDefault();
				if (close(true, true)) this.editNeighbor(td, e.shiftKey ? -1 : 1, 0);
			} else if (e.key === "ArrowDown") {
				e.preventDefault();
				if (close(true, true)) this.editNeighbor(td, 0, 1);
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				if (close(true, true)) this.editNeighbor(td, 0, -1);
			} else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
				e.preventDefault();
				const above = this.cellAbove(td, fmKey);
				if (above != null) input.value = above;
			}
		});
		input.addEventListener("blur", () => {
			// the picker owns focus while open; otherwise blur commits like text
			window.setTimeout(() => {
				if (!pickerOpen) close(true);
			}, 0);
		});
		calBtn.addEventListener("mousedown", (e) => e.preventDefault());
		calBtn.addEventListener("click", () => {
			if (pickerOpen) return;
			pickerOpen = true;
			this.openDatePicker(
				td,
				input.value.trim() || start,
				kind,
				(v) => {
					pickerOpen = false;
					input.value = v ?? "";
					close(true);
				},
				() => {
					pickerOpen = false;
					input.focus();
				}
			);
		});
		input.focus();
		input.select();
	}

	/** A Place cell's editor: the address first (with OpenStreetMap autocomplete,
	 *  opt-in and degrading to free text offline), then the caption shown in the
	 *  cell. The address opens Google Maps. */
	private beginPlaceEdit(td: HTMLElement, en: BasesEntry, fmKey: string, raw: unknown) {
		this.beginLinkEdit(td, en, fmKey, raw, {
			addressLabel: "Address",
			addressPlaceholder: "Search or type an address",
			captionLabel: "Caption (shown in cell)",
			captionPlaceholder: "Optional short name",
			captionFirst: false,
			suggest: true,
		});
	}

	/** A URL cell's editor, a classic two-field Link dialog: the text to
	 *  display on top, the address under it. The cell shows the text; the link
	 *  opens the address. */
	private beginUrlEdit(td: HTMLElement, en: BasesEntry, fmKey: string, raw: unknown) {
		this.beginLinkEdit(td, en, fmKey, raw, {
			addressLabel: "Address",
			addressPlaceholder: "https://example.com",
			captionLabel: "Text to display",
			captionPlaceholder: "Optional; the address shows when empty",
			captionFirst: true,
			suggest: false,
		});
	}

	/** The two-field editor popover behind Place and URL cells: an address plus
	 *  the optional display text shown in the cell, stored together as one
	 *  `[text](address)` property (bare address when no text), so it stays plain
	 *  frontmatter. Place adds OpenStreetMap address suggestions. */
	private beginLinkEdit(
		td: HTMLElement,
		en: BasesEntry,
		fmKey: string,
		raw: unknown,
		opts: {
			addressLabel: string;
			addressPlaceholder: string;
			captionLabel: string;
			captionPlaceholder: string;
			captionFirst: boolean;
			suggest: boolean;
		}
	) {
		if (this.editing) return;
		this.editing = true;
		td.addClass("pb-editing");
		const fmLive = frontmatterOf(this.app, en.file);
		if (fmLive) raw = fmLive[fmKey];
		const start = raw == null ? "" : String(raw);
		const cur = parseLinkValue(start);
		let address = cur.address;
		let caption = cur.caption;

		const pop = document.body.createDiv({ cls: "pb-placeedit" });
		const W = 320;
		const rect = td.getBoundingClientRect();
		const left = rect.width > 0 ? rect.left : 40;
		const top = rect.width > 0 ? rect.bottom + 4 : 80;
		pop.style.width = W + "px";
		pop.style.left = Math.max(6, Math.min(left, window.innerWidth - W - 6)) + "px";
		pop.style.top = top + "px";

		const makeField = (label: string, placeholder: string, value: string) => {
			const f = pop.createDiv({ cls: "pb-pe-field" });
			f.createEl("label", { text: label });
			const input = f.createEl("input", {
				cls: "pb-pe-input",
				attr: { type: "text", placeholder, spellcheck: "false" },
			});
			input.value = value;
			return input;
		};

		let addrIn: HTMLInputElement;
		let capIn: HTMLInputElement;
		if (opts.captionFirst) {
			capIn = makeField(opts.captionLabel, opts.captionPlaceholder, caption);
			addrIn = makeField(opts.addressLabel, opts.addressPlaceholder, address);
		} else {
			addrIn = makeField(opts.addressLabel, opts.addressPlaceholder, address);
			capIn = makeField(opts.captionLabel, opts.captionPlaceholder, caption);
		}
		// suggestions live right under the address field, wherever it sits
		let sugg: HTMLElement | null = null;
		if (opts.suggest) {
			sugg = pop.createDiv({ cls: "pb-pe-sugg" });
			addrIn.parentElement?.after(sugg);
		}

		let done = false;
		let timer = 0;
		let reqSeq = 0;
		const finish = (commit: boolean) => {
			if (done) return;
			done = true;
			this.editing = false;
			window.clearTimeout(timer);
			document.removeEventListener("mousedown", outside, true);
			pop.remove();
			if (commit) {
				const val = formatLinkValue(address, caption);
				if (val !== start) {
					void this.plugin.writeBatch(`Set ${this.config.getDisplayName(("note." + fmKey) as BasesPropertyId)} on "${en.file.basename}"`, [
						{ file: en.file, assignments: { [fmKey]: val ? val : undefined } },
					]);
					return;
				}
			}
			this.onDataUpdated();
		};
		const outside = (e: MouseEvent) => {
			if (!pop.contains(e.target as Node)) finish(true);
		};

		const runSearch = async (q: string) => {
			if (!sugg) return;
			const query = q.trim();
			if (!this.plugin.settings.placeAutocomplete || query.length < 3) {
				sugg.empty();
				return;
			}
			const seq = ++reqSeq;
			try {
				const res = await requestUrl({
					url: "https://nominatim.openstreetmap.org/search?format=json&addressdetails=0&limit=6&q=" + encodeURIComponent(query),
					headers: { "User-Agent": "obsidian-power-bases" },
				});
				if (done || seq !== reqSeq) return; // a newer keystroke won
				const arr = Array.isArray(res.json) ? (res.json as Array<{ display_name?: string }>) : [];
				sugg.empty();
				for (const r of arr) {
					const name = String(r.display_name ?? "").trim();
					if (!name) continue;
					const opt = sugg.createDiv({ cls: "pb-pe-opt" });
					setIcon(opt.createSpan({ cls: "pb-pe-opt-ic" }), "map-pin");
					opt.createSpan({ cls: "pb-pe-opt-txt", text: name });
					// mousedown (not click) so the address input's blur doesn't beat it
					opt.addEventListener("mousedown", (e) => {
						e.preventDefault();
						address = name;
						addrIn.value = name;
						sugg?.empty();
						capIn.focus();
					});
				}
			} catch {
				if (seq === reqSeq) sugg.empty(); // offline or blocked: silently fall back to free text
			}
		};

		addrIn.addEventListener("input", () => {
			address = addrIn.value;
			if (!opts.suggest) return;
			window.clearTimeout(timer);
			timer = window.setTimeout(() => void runSearch(addrIn.value), 350);
		});
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Enter") {
				e.preventDefault();
				finish(true);
			} else if (e.key === "Escape") {
				e.preventDefault();
				finish(false);
			}
		};
		addrIn.addEventListener("keydown", onKey);
		capIn.addEventListener("input", () => {
			caption = capIn.value;
		});
		capIn.addEventListener("keydown", onKey);

		window.setTimeout(() => {
			document.addEventListener("mousedown", outside, true);
			// an address is the one required part, so start there; but when a URL
			// already has one, the likely edit is naming it, so start on the text
			const first = opts.captionFirst && address ? capIn : addrIn;
			first.focus();
			first.select();
		}, 0);
	}

	/** The picker behind Image and Files cells: search files already in the
	 *  vault (images preview as thumbnails) or upload from the computer, which
	 *  copies the file into the configured attachment folder. Cells store plain
	 *  `[[wikilinks]]`; typing a URL keeps it as typed, so remote images work. */
	private beginFilePick(td: HTMLElement, en: BasesEntry, fmKey: string, raw: unknown, opts: { images: boolean; multi: boolean }) {
		if (this.editing) return;
		this.editing = true;
		td.addClass("pb-editing");
		const fmLive = frontmatterOf(this.app, en.file);
		if (fmLive) raw = fmLive[fmKey];
		const start = Array.isArray(raw) ? raw.map(String) : raw == null || raw === "" ? [] : [String(raw)];
		let items = [...start];
		let done = false;

		const pop = document.body.createDiv({ cls: "pb-filepick" });
		const W = 340;
		const rect = td.getBoundingClientRect();
		const left = rect.width > 0 ? rect.left : 40;
		const top = rect.width > 0 ? rect.bottom + 4 : 80;
		pop.style.width = W + "px";
		pop.style.left = Math.max(6, Math.min(left, window.innerWidth - W - 6)) + "px";
		pop.style.top = top + "px";

		// single commits per action (undefined = no single write; null = clear);
		// multi accumulates and commits on close
		const finish = (commit: boolean, single?: string | null) => {
			if (done) return;
			done = true;
			this.editing = false;
			document.removeEventListener("mousedown", outside, true);
			pop.remove();
			const label = `Set ${this.config.getDisplayName(("note." + fmKey) as BasesPropertyId)} on "${en.file.basename}"`;
			if (!opts.multi) {
				if (single !== undefined) {
					void this.plugin.writeBatch(label, [{ file: en.file, assignments: { [fmKey]: single ?? undefined } }]);
					return;
				}
			} else if (commit && items.join("\n") !== start.join("\n")) {
				void this.plugin.writeBatch(label, [{ file: en.file, assignments: { [fmKey]: items.length ? items : undefined } }]);
				return;
			}
			this.onDataUpdated();
		};
		const outside = (e: MouseEvent) => {
			// clicking away keeps a multi's edits; a single is action-committed
			if (!pop.contains(e.target as Node)) finish(opts.multi);
		};

		let chips: HTMLElement | null = null;
		const renderChips = () => {
			if (!chips) return;
			chips.empty();
			if (!items.length) chips.createSpan({ cls: "pb-le-empty", text: "No files yet" });
			for (const it of items) {
				const chip = chips.createSpan({ cls: "pb-fp-chip" });
				chip.createSpan({ text: fileLinkParts(it).name });
				const x = chip.createSpan({ cls: "pb-le-cx" });
				setIcon(x, "x");
				x.addEventListener("click", () => {
					items = items.filter((v) => v !== it);
					renderChips();
				});
			}
		};
		if (opts.multi) {
			chips = pop.createDiv({ cls: "pb-fp-chips" });
			renderChips();
		}

		const search = pop.createEl("input", {
			cls: "pb-pe-input",
			attr: { type: "text", placeholder: opts.images ? "Search images in the vault" : "Search files in the vault", spellcheck: "false" },
		});
		const list = pop.createDiv({ cls: "pb-fp-list" });

		const candidates = (): TFile[] => {
			const q = search.value.trim().toLowerCase();
			let files = this.app.vault
				.getFiles()
				.filter((f) => (opts.images ? IMG_EXTS.has(f.extension.toLowerCase()) : f.extension.toLowerCase() !== "base"));
			if (!q) return files.sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 12);
			files = files.filter((f) => f.path.toLowerCase().includes(q));
			const score = (f: TFile) => (f.basename.toLowerCase().startsWith(q) ? 0 : f.basename.toLowerCase().includes(q) ? 1 : 2);
			return files.sort((a, b) => score(a) - score(b) || a.basename.localeCompare(b.basename)).slice(0, 24);
		};

		const pick = (value: string) => {
			if (opts.multi) {
				if (!items.includes(value)) items.push(value);
				renderChips();
				search.value = "";
				renderList();
				search.focus();
			} else {
				finish(true, value);
			}
		};

		const renderList = () => {
			list.empty();
			for (const f of candidates()) {
				const row = list.createDiv({ cls: "pb-fp-item" });
				if (opts.images) row.createEl("img", { cls: "pb-fp-thumb", attr: { src: this.app.vault.getResourcePath(f), alt: f.name } });
				else setIcon(row.createSpan({ cls: "pb-pe-opt-ic" }), "file");
				const txt = row.createDiv({ cls: "pb-fp-text" });
				txt.createDiv({ cls: "pb-fp-name", text: f.name });
				if (f.parent && f.parent.path !== "/") txt.createDiv({ cls: "pb-fp-path", text: f.parent.path });
				row.addEventListener("click", () => pick("[[" + this.app.metadataCache.fileToLinktext(f, en.file.path) + "]]"));
			}
			const q = search.value.trim();
			if (q) {
				// a URL (or any raw text) is kept as typed, so remote images work
				const use = list.createDiv({ cls: "pb-fp-item" });
				setIcon(use.createSpan({ cls: "pb-pe-opt-ic" }), "corner-down-left");
				use.createDiv({ cls: "pb-fp-text" }).createDiv({ cls: "pb-fp-name", text: `Use "${q}" as typed` });
				use.addEventListener("click", () => pick(q));
			}
		};
		renderList();
		search.addEventListener("input", renderList);
		search.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				const q = search.value.trim();
				if (q) pick(q);
				else finish(opts.multi);
			} else if (e.key === "Escape") {
				e.preventDefault();
				finish(false);
			}
		});

		const btns = pop.createDiv({ cls: "pb-fp-btns" });
		const fileIn = pop.createEl("input", { cls: "pb-fp-fileinput", attr: { type: "file" } });
		if (opts.images) fileIn.accept = "image/*";
		if (opts.multi) fileIn.multiple = true;
		btns.createEl("button", { text: opts.images ? "Upload image" : "Upload files" }).addEventListener("click", () => fileIn.click());
		onEventAsync(fileIn, "change", async () => {
			const files = Array.from(fileIn.files ?? []);
			if (!files.length) return;
			const links: string[] = [];
			for (const f of files) {
				try {
					links.push(await this.importFile(f, en.file.path));
				} catch (e) {
					new Notice("Power Bases: could not import. " + (e as Error).message);
				}
			}
			if (!links.length) return;
			if (opts.multi) {
				for (const l of links) if (!items.includes(l)) items.push(l);
				renderChips();
				renderList();
			} else {
				finish(true, links[0]);
			}
		});
		if (!opts.multi && start.length) btns.createEl("button", { text: "Clear" }).addEventListener("click", () => finish(true, null));

		window.setTimeout(() => {
			document.addEventListener("mousedown", outside, true);
			search.focus();
		}, 0);
	}

	/** Copy a picked file into the vault at the configured attachment location
	 *  and return a wikilink to it. */
	private async importFile(f: File, sourcePath: string): Promise<string> {
		const buf = await f.arrayBuffer();
		const path = await this.app.fileManager.getAvailablePathForAttachment(f.name, sourcePath);
		const tf = await this.app.vault.createBinary(path, buf);
		return "[[" + this.app.metadataCache.fileToLinktext(tf, sourcePath) + "]]";
	}

	/** The distinct values used anywhere in a list column (for the multi-select
	 *  options), read from frontmatter so an absent value is never "null". */
	private distinctListValues(fmKey: string): string[] {
		const set = new Set<string>();
		for (const en of this.data.data) {
			const raw = frontmatterOf(this.app, en.file)?.[fmKey];
			const arr = Array.isArray(raw) ? raw : raw == null || raw === "" ? [] : [raw];
			for (const v of arr) {
				const s = String(v).trim();
				if (s && s !== "null") set.add(s);
			}
			if (set.size >= 200) break;
		}
		return [...set].sort((a, b) => a.localeCompare(b));
	}

	/** Rename a list value across every row of the base (one undoable change). */
	private async renameListOptionAcrossRows(fmKey: string, oldV: string, rawNew: string) {
		const newV = rawNew.trim();
		if (!newV || newV === oldV) return;
		const writes: { file: TFile; assignments: Record<string, unknown> }[] = [];
		for (const en of this.data.data) {
			const raw = frontmatterOf(this.app, en.file)?.[fmKey];
			const arr = Array.isArray(raw) ? raw.map((v) => String(v)) : raw == null || raw === "" ? [] : [String(raw)];
			if (arr.includes(oldV)) writes.push({ file: en.file, assignments: { [fmKey]: [...new Set(arr.map((x) => (x === oldV ? newV : x)))] } });
		}
		if (writes.length) await this.plugin.writeBatch(`Renamed "${oldV}" to "${newV}"`, writes);
		this.plugin.refreshAll();
	}

	/** Remove a list value from every row of the base (one undoable change). */
	private async deleteListOptionAcrossRows(fmKey: string, v: string) {
		const writes: { file: TFile; assignments: Record<string, unknown> }[] = [];
		for (const en of this.data.data) {
			const raw = frontmatterOf(this.app, en.file)?.[fmKey];
			const arr = Array.isArray(raw) ? raw.map((x) => String(x)) : raw == null || raw === "" ? [] : [String(raw)];
			if (arr.includes(v)) {
				const next = arr.filter((x) => x !== v);
				writes.push({ file: en.file, assignments: { [fmKey]: next.length ? next : undefined } });
			}
		}
		if (writes.length) await this.plugin.writeBatch(`Removed "${v}"`, writes);
		this.plugin.refreshAll();
	}

	/** A multi-select popover for a list cell: chips you can remove, an input to
	 *  add, and the column's values as options you can add, rename (across the
	 *  base's rows), or delete. */
	private beginListEdit(td: HTMLElement, en: BasesEntry, fmKey: string, raw: unknown) {
		this.editing = true;
		td.addClass("pb-editing");
		let items: string[] = Array.isArray(raw) ? raw.map((v) => String(v)) : raw == null || raw === "" ? [] : [String(raw)];
		const start = JSON.stringify(items);

		const pop = document.body.createDiv({ cls: "pb-listedit" });
		const rect = td.getBoundingClientRect();
		pop.style.left = Math.max(6, Math.min(rect.left, window.innerWidth - 260)) + "px";
		pop.style.top = rect.bottom + 2 + "px";
		pop.style.minWidth = Math.max(210, rect.width) + "px";

		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			this.editing = false;
			document.removeEventListener("mousedown", outside, true);
			pop.remove();
			if (JSON.stringify(items) !== start) {
				void this.plugin.writeBatch(`Edited ${fmKey} of "${en.file.basename}"`, [{ file: en.file, assignments: { [fmKey]: items.length ? items : undefined } }]);
			} else {
				this.onDataUpdated();
			}
		};
		const outside = (e: MouseEvent) => {
			if (!pop.contains(e.target as Node)) finish();
		};

		const chipsEl = pop.createDiv({ cls: "pb-le-chips" });
		const input = pop.createEl("input", { cls: "pb-le-input", attr: { type: "text", placeholder: "Add or find…" } });
		const optsEl = pop.createDiv({ cls: "pb-le-opts" });

		const renderChips = () => {
			chipsEl.empty();
			if (!items.length) chipsEl.createSpan({ cls: "pb-le-empty", text: "Empty" });
			for (const it of items) {
				const chip = chipsEl.createSpan({ cls: "pb-le-chip", text: it });
				chip.style.setProperty("--pb-c", this.plugin.hueFor(fmKey, it));
				const x = chip.createSpan({ cls: "pb-le-cx" });
				setIcon(x, "x");
				x.addEventListener("click", (e) => {
					e.stopPropagation();
					items = items.filter((i) => i !== it);
					renderChips();
					renderOpts(input.value);
				});
			}
		};
		const add = (v: string) => {
			const t = v.trim();
			if (t && !items.includes(t)) items.push(t);
			input.value = "";
			renderChips();
			renderOpts("");
			input.focus();
		};
		const renderOpts = (q: string) => {
			optsEl.empty();
			const query = q.trim().toLowerCase();
			const all = this.distinctListValues(fmKey);
			const typed = q.trim();
			if (typed && !all.includes(typed) && !items.includes(typed)) {
				const row = optsEl.createDiv({ cls: "pb-le-opt" });
				setIcon(row.createSpan({ cls: "pb-le-oic" }), "plus");
				row.createSpan({ cls: "pb-le-olabel", text: `Create "${typed}"` });
				row.addEventListener("click", () => add(typed));
			}
			for (const v of all.filter((x) => !items.includes(x) && x.toLowerCase().includes(query))) {
				const row = optsEl.createDiv({ cls: "pb-le-opt" });
				const chip = row.createSpan({ cls: "pb-le-chip", text: v });
				chip.style.setProperty("--pb-c", this.plugin.hueFor(fmKey, v));
				row.addEventListener("click", () => add(v));
				const acts = row.createSpan({ cls: "pb-le-acts" });
				const edit = acts.createSpan({ cls: "pb-le-act", attr: { "aria-label": "Rename everywhere" } });
				setIcon(edit, "pencil");
				edit.addEventListener("click", (e) => {
					e.stopPropagation();
					finish();
					new PromptModal(this.app, { title: `Rename "${v}"`, initial: v, onSubmit: (nv) => void this.renameListOptionAcrossRows(fmKey, v, nv) }).open();
				});
				const del = acts.createSpan({ cls: "pb-le-act pb-le-del", attr: { "aria-label": "Delete everywhere" } });
				setIcon(del, "trash-2");
				del.addEventListener("click", (e) => {
					e.stopPropagation();
					finish();
					new ConfirmModal(this.app, { title: "Delete value", body: `Remove "${v}" from every row of this base? You can undo this.`, confirmText: "Delete", onConfirm: () => void this.deleteListOptionAcrossRows(fmKey, v) }).open();
				});
			}
		};
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				add(input.value);
			} else if (e.key === "Escape") finish();
		});
		input.addEventListener("input", () => renderOpts(input.value));

		renderChips();
		renderOpts("");
		window.setTimeout(() => {
			input.focus();
			document.addEventListener("mousedown", outside, true);
		}, 0);
	}

	/** Swap the cell for a typed input; Enter or blur commits, Escape cancels.
	 *  Blank input deletes the property, per coerceForKind. */
	private beginEdit(td: HTMLElement, en: BasesEntry, fmKey: string, kind: CellKind, raw: unknown) {
		if (this.editing) return;
		// the closure's raw can lag after keyboard navigation (repaints are
		// deferred while an editor is open); the metadata cache is authoritative
		const fmLive = frontmatterOf(this.app, en.file);
		if (fmLive) raw = fmLive[fmKey];
		if (kind === "date" || kind === "datetime") {
			this.beginDateEdit(td, en, fmKey, kind, raw);
			return;
		}
		if (kind === "list") {
			this.beginListEdit(td, en, fmKey, raw);
			return;
		}
		this.editing = true;
		td.empty();
		td.addClass("pb-editing");
		// date/datetime are handled by beginDateEdit above; only these remain
		const type = kind === "number" ? "number" : "text";
		const input = td.createEl("input", { cls: "pb-cell-input", attr: { type } });
		if (kind === "number") input.setAttr("step", "any");
		input.value = raw == null ? "" : String(raw);
		// suggest existing values only for Select/Status columns (color mode
		// "value"), where repeating values is the point; plain Text stays a
		// clean input, and a field type (Email, URL, Phone) is unique anyway
		if (kind === "text" && !this.plugin.fieldType(fmKey) && this.config.get("color:note." + fmKey) === "value") {
			// offer the column's existing values, Notion-select style (read from
			// frontmatter and skip "null" so an absent value never becomes an option)
			const seen = new Set<string>();
			for (const other of this.data.data) {
				const rawV = frontmatterOf(this.app, other.file)?.[fmKey];
				const s = rawV == null ? "" : String(rawV).trim();
				if (s && s !== "null") seen.add(s);
				if (seen.size >= 40) break;
			}
			if (seen.size) {
				const id = "pb-dl-" + Math.abs(colorIndex(fmKey + Date.now(), 999983));
				const dl = td.createEl("datalist", { attr: { id } });
				for (const s of seen) dl.createEl("option", { attr: { value: s } });
				input.setAttr("list", id);
			}
		}
		let done = false;
		const close = (commit: boolean, navigating = false) => {
			if (done) return;
			done = true;
			this.editing = false;
			if (commit) {
				const next = coerceForKind(kind, input.value);
				const changed = String(raw ?? "") !== input.value.trim();
				if (changed) {
					td.removeClass("pb-editing");
					td.setText(input.value.trim()); // optimistic; the data update repaints truth
					void this.plugin.writeBatch(`Edited ${fmKey} of "${en.file.basename}"`, [
						{ file: en.file, assignments: { [fmKey]: next } },
					]);
					this.maybeRenameUntitled(en, fmKey, input.value.trim());
					if (this.pendingUpdate) {
						this.pendingUpdate = false;
						// a queued repaint would clobber the optimistic cell with
						// stale data; the frontmatter write triggers a fresh one
					}
					return;
				}
			}
			if (navigating) {
				// keep the tree alive for the hop: the unchanged cell gets its
				// text back with no repaint, or the neighbor we are about to
				// open would be found in a detached table and edit invisibly;
				// the final non-navigating close repaints everything
				td.removeClass("pb-editing");
				td.setText(input.value.trim());
				return;
			}
			if (this.pendingUpdate) this.pendingUpdate = false;
			this.onDataUpdated();
		};
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				close(true);
			} else if (e.key === "Escape") {
				e.preventDefault();
				close(false);
			} else if (e.key === "Tab") {
				e.preventDefault();
				close(true, true);
				this.editNeighbor(td, e.shiftKey ? -1 : 1, 0);
			} else if (e.key === "ArrowDown") {
				e.preventDefault();
				close(true, true);
				this.editNeighbor(td, 0, 1);
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				close(true, true);
				this.editNeighbor(td, 0, -1);
			} else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
				// fill-down: take the value from the cell above
				e.preventDefault();
				const above = this.cellAbove(td, fmKey);
				if (above != null) input.value = above;
			}
		});
		input.addEventListener("paste", (e) => {
			const textData = e.clipboardData?.getData("text/plain") ?? "";
			// a block from a spreadsheet has tabs or several lines; a plain
			// value pastes into the input as usual
			if (!textData.includes("\t") && !/\n.*\S/.test(textData)) return;
			e.preventDefault();
			close(false, true);
			void this.pasteGrid(td, textData);
		});
		input.addEventListener("blur", () => close(true));
		input.focus();
		if (type === "text") input.select();
	}
}

/** Bars on a day-scaled axis from a start (and optional end) date property.
 *  Drag a bar to move it, drag its edges to change start or end; every
 *  change writes dates back to frontmatter, time suffixes preserved. Rows
 *  follow toolbar grouping; bars can color by any property's hue. */
class PowerTimelineView extends PBView {
	type = "powerbases-timeline";
	private dragging = false;
	private writing = false;
	private pendingUpdate = false;

	private flushPending() {
		if (this.pendingUpdate) {
			this.pendingUpdate = false;
			this.onDataUpdated();
		}
	}

	onDataUpdated(): void {
		if (this.dragging || this.writing) {
			this.pendingUpdate = true;
			return;
		}
		const root = this.rootEl;
		const prevScroll = root.querySelector<HTMLElement>(".pb-tl-scroll")?.scrollLeft ?? null;
		root.empty();
		root.className = "pb-root pb-tl";
		const startProp = this.config.getAsPropertyId("startProp");
		if (!startProp) {
			this.hint("Pick a Start date property in the view options to draw the timeline.");
			return;
		}
		const endPropRaw = this.config.getAsPropertyId("endProp");
		const endProp = endPropRaw && endPropRaw !== startProp ? endPropRaw : null;
		const colorProp = this.config.getAsPropertyId("colorProp");
		const milestoneProp = this.config.getAsPropertyId("milestoneProp");
		const progressProp = this.config.getAsPropertyId("progressProp");
		const startKeyName = frontmatterKey(startProp);
		const endKeyName = endProp ? frontmatterKey(endProp) : null;
		const zoom = String(this.config.get("zoom") ?? "week");
		const ppd = zoom === "day" ? 44 : zoom === "month" ? 5 : 16;
		const now = new Date();
		const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

		const items: { en: BasesEntry; start: string; end: string }[] = [];
		const unscheduled: BasesEntry[] = [];
		for (const en of this.data.data) {
			const s = dateKeyOf(this.text(en, startProp));
			if (!s) {
				unscheduled.push(en);
				continue;
			}
			let e2 = endProp ? dateKeyOf(this.text(en, endProp)) : null;
			if (!e2 || dayDiff(s, e2) < 0) e2 = s;
			items.push({ en, start: s, end: e2 });
		}
		const byPath = new Map(items.map((i) => [i.en.file.path, i]));
		const range = timelineRange(
			items.flatMap((i) => [i.start, i.end]),
			todayKey,
			7
		);
		const totalDays = dayDiff(range.from, range.to) + 1;
		const NAMEW = 220;

		const top = root.createDiv({ cls: "pb-tl-top" });
		const todayBtn = top.createEl("button", { cls: "pb-cal-btn", text: "Today" });

		const scroll = root.createDiv({ cls: "pb-tl-scroll" });
		const inner = scroll.createDiv({ cls: "pb-tl-inner" });
		inner.style.width = NAMEW + totalDays * ppd + "px";
		if (zoom !== "month") {
			// weekend stripes: one gradient, aligned to the first Saturday
			const satOffset = (6 - dayOfWeek(range.from) + 7) % 7;
			inner.addClass("pb-tl-wk");
			inner.style.setProperty("--pb-wkoff", NAMEW + satOffset * ppd + "px");
			inner.style.setProperty("--pb-wk", ppd * 7 + "px");
			inner.style.setProperty("--pb-wkw", ppd * 2 + "px");
		}

		const months = inner.createDiv({ cls: "pb-tl-months" });
		months.createDiv({ cls: "pb-tl-corner" });
		for (const m of monthSpans(range.from, range.to)) {
			const cell = months.createDiv({ cls: "pb-tl-month" });
			cell.style.width = m.days * ppd + "px";
			if (m.days * ppd > 52) {
				cell.setText(
					new Date(Date.UTC(m.y, m.m0, 1)).toLocaleDateString(undefined, {
						month: "short",
						year: "numeric",
						timeZone: "UTC",
					})
				);
			}
		}
		if (zoom === "day") {
			const ticks = inner.createDiv({ cls: "pb-tl-ticks" });
			ticks.createDiv({ cls: "pb-tl-corner" });
			for (let i = 0; i < totalDays; i++) {
				const t = ticks.createDiv({ cls: "pb-tl-tick" });
				t.style.width = ppd + "px";
				t.setText(String(+addDays(range.from, i).slice(8, 10)));
			}
		} else if (zoom === "week") {
			const ticks = inner.createDiv({ cls: "pb-tl-ticks" });
			ticks.createDiv({ cls: "pb-tl-corner" });
			const firstMonday = (1 - dayOfWeek(range.from) + 7) % 7;
			if (firstMonday > 0) {
				const pad = ticks.createDiv({ cls: "pb-tl-tick pb-tl-pad" });
				pad.style.width = firstMonday * ppd + "px";
			}
			for (let w = firstMonday; w < totalDays; w += 7) {
				const t = ticks.createDiv({ cls: "pb-tl-tick" });
				t.style.width = Math.min(7, totalDays - w) * ppd + "px";
				t.setText(String(+addDays(range.from, w).slice(8, 10)));
			}
		}

		const todayOff = dayDiff(range.from, todayKey);
		if (todayOff >= 0 && todayOff < totalDays) {
			const line = inner.createDiv({ cls: "pb-tl-today" });
			line.style.left = NAMEW + todayOff * ppd + ppd / 2 + "px";
		}
		todayBtn.addEventListener("click", () => {
			scroll.scrollLeft = Math.max(0, NAMEW + todayOff * ppd - scroll.clientWidth / 2);
		});

		// unscheduled pages: expand the strip, then DRAG a chip onto the axis
		// to schedule it; a day guide with the date follows the pointer
		if (unscheduled.length) {
			const uns = top.createDiv({ cls: "pb-tl-unsched" });
			const lbl = uns.createSpan({ cls: "pb-tl-unslbl", text: `Unscheduled ${unscheduled.length}` });
			const chips = uns.createDiv({ cls: "pb-tl-unslist" });
			chips.hide();
			lbl.addEventListener("click", () => (chips.isShown() ? chips.hide() : chips.show()));
			for (const en of unscheduled) {
				const chip = chips.createDiv({ cls: "pb-chip", text: en.file.basename });
				this.hoverable(chip, en.file);
				let guide: HTMLElement | null = null;
				let guideLbl: HTMLElement | null = null;
				let day: number | null = null;
				attachPointerGesture(chip, {
					ghostText: en.file.basename,
					onStart: () => {
						this.dragging = true;
						day = null;
						guide = inner.createDiv({ cls: "pb-tl-guide" });
						guideLbl = guide.createDiv({ cls: "pb-tl-guidelbl" });
					},
					onMove: (_dx, _dy, x) => {
						const r = scroll.getBoundingClientRect();
						const xIn = x - r.left + scroll.scrollLeft - NAMEW;
						day = Math.max(0, Math.min(totalDays - 1, Math.floor(xIn / ppd)));
						if (guide) {
							guide.style.left = NAMEW + day * ppd + "px";
							guide.style.width = Math.max(2, ppd) + "px";
						}
						guideLbl?.setText(addDays(range.from, day));
					},
					onDrop: () => {
						const key = day == null ? null : addDays(range.from, day);
						guide?.remove();
						guide = null;
						this.dragging = false;
						if (key == null) {
							this.flushPending();
							return;
						}
						this.writing = true;
						const raw = frontmatterOf(this.app, en.file)?.[startKeyName];
						const next = typeof raw === "string" && dateKeyOf(raw) ? replaceDateKey(raw, key) : key;
						void this.plugin
							.writeBatch(`Scheduled "${en.file.basename}" for ${key}`, [
								{ file: en.file, assignments: { [startKeyName]: next } },
							])
							.finally(() => {
								this.writing = false;
								this.flushPending();
							});
					},
					onCancel: () => {
						guide?.remove();
						guide = null;
						this.dragging = false;
						this.flushPending();
					},
					onClick: (ev) => this.open(en.file, ev),
				});
			}
		}

		const depProp = this.config.getAsPropertyId("depProp");
		const depKey = depProp ? frontmatterKey(depProp) : null;
		const barEls = new Map<string, HTMLElement>();
		const renderItemRow = (it: { en: BasesEntry; start: string; end: string }) => {
			const row = inner.createDiv({ cls: "pb-tl-row" });
			const name = row.createDiv({ cls: "pb-tl-name", text: it.en.file.basename });
			name.addEventListener("click", (ev) => this.open(it.en.file, ev));
			this.hoverable(name, it.en.file);
			const cell = row.createDiv({ cls: "pb-tl-cell" });
			cell.style.width = totalDays * ppd + "px";
			const off = Math.max(0, dayDiff(range.from, it.start));
			const endOff = Math.min(totalDays - 1, dayDiff(range.from, it.end));
			const msVal = milestoneProp ? this.text(it.en, milestoneProp) : "";
			const milestone = msVal !== "" && msVal !== "false" && msVal !== "0";
			const bar = cell.createDiv({
				cls: "pb-tl-bar" + (milestone ? " pb-tl-ms" : ""),
				attr: { title: it.en.file.basename + "  " + it.start + (it.end !== it.start ? " to " + it.end : "") },
			});
			barEls.set(it.en.file.path, bar);
			let hue = "var(--interactive-accent)";
			if (colorProp) {
				const v = this.text(it.en, colorProp);
				if (v) hue = this.plugin.hueFor(colorProp.startsWith("note.") ? frontmatterKey(colorProp) : null, v);
			}
			bar.style.setProperty("--pb-bar", hue);
			if (milestone) {
				// a diamond pinned to the start date; move-only, no duration.
				// pb-tl-ms carries the 16px square it is rotated from.
				bar.style.left = off * ppd + Math.max(0, ppd / 2 - 8) + "px";
				this.attachBarDrag(bar, { en: it.en, start: it.start, end: it.start }, ppd, startKeyName, null);
				return;
			}
			bar.style.left = off * ppd + "px";
			bar.style.width = Math.max(8, (endOff - off + 1) * ppd - 2) + "px";
			if (progressProp) {
				const pct = progressPct(frontmatterOf(this.app, it.en.file)?.[frontmatterKey(progressProp)]);
				if (pct != null) {
					const fill = bar.createDiv({ cls: "pb-tl-fill" });
					fill.style.width = pct + "%";
					bar.setAttr("title", bar.getAttribute("title") + "  " + Math.round(pct) + "%");
				}
			}
			if (endKeyName) {
				bar.createDiv({ cls: "pb-tl-grip pb-tl-grip-l" });
				bar.createDiv({ cls: "pb-tl-grip pb-tl-grip-r" });
			}
			this.attachBarDrag(bar, it, ppd, startKeyName, endKeyName);
		};
		for (const g of this.data.groupedData) {
			if (g.key !== undefined) {
				const gr = inner.createDiv({ cls: "pb-tl-group" });
				gr.createSpan({ text: g.hasKey() ? String(g.key) : "No value" });
			}
			for (const en of g.entries) {
				const it = byPath.get(en.file.path);
				if (it) renderItemRow(it);
			}
		}

		if (depKey) this.drawDeps(inner, barEls, byPath, depKey);

		if (prevScroll != null) scroll.scrollLeft = prevScroll;
		else if (todayOff >= 0) scroll.scrollLeft = Math.max(0, NAMEW + todayOff * ppd - scroll.clientWidth / 2);
	}

	/** Draw finish-to-start dependency arrows between bars after layout, so
	 *  positions can be measured. A predecessor that ends after this task
	 *  starts is a schedule conflict: the arrow and the late bar go red. */
	private drawDeps(
		inner: HTMLElement,
		barEls: Map<string, HTMLElement>,
		byPath: Map<string, { en: BasesEntry; start: string; end: string }>,
		depKey: string
	) {
		window.requestAnimationFrame(() => {
			if (!inner.isConnected) return;
			const NS = "http://www.w3.org/2000/svg";
			const svg = document.createElementNS(NS, "svg");
			svg.addClass("pb-tl-deps");
			svg.setAttribute("width", String(inner.scrollWidth));
			svg.setAttribute("height", String(inner.scrollHeight));
			const defs = document.createElementNS(NS, "defs");
			for (const [id, cls] of [
				["pb-arrow", "pb-dep-head"],
				["pb-arrow-late", "pb-dep-head-late"],
			]) {
				const marker = document.createElementNS(NS, "marker");
				marker.setAttribute("id", id);
				marker.setAttribute("viewBox", "0 0 8 8");
				marker.setAttribute("refX", "6");
				marker.setAttribute("refY", "4");
				marker.setAttribute("markerWidth", "6");
				marker.setAttribute("markerHeight", "6");
				marker.setAttribute("orient", "auto-start-reverse");
				const tri = document.createElementNS(NS, "path");
				tri.setAttribute("d", "M0 1 L6 4 L0 7 Z");
				tri.setAttribute("class", cls);
				marker.appendChild(tri);
				defs.appendChild(marker);
			}
			svg.appendChild(defs);
			const irect = inner.getBoundingClientRect();
			const loc = (el: HTMLElement) => {
				const r = el.getBoundingClientRect();
				return { left: r.left - irect.left, right: r.right - irect.left, midY: r.top - irect.top + r.height / 2 };
			};
			let any = false;
			for (const [path, el] of barEls) {
				const it = byPath.get(path);
				if (!it) continue;
				const raw = frontmatterOf(this.app, it.en.file)?.[depKey];
				const t = loc(el);
				for (const nm of linkTargets(raw)) {
					const pred = this.app.metadataCache.getFirstLinkpathDest(nm, it.en.file.path);
					const predEl = pred ? barEls.get(pred.path) : null;
					if (!pred || !predEl) continue;
					const predIt = byPath.get(pred.path)!;
					const s = loc(predEl);
					const late = dayDiff(predIt.end, it.start) < 0; // predecessor ends after this starts
					const midx = Math.max(s.right + 10, t.left - 10);
					const d = `M ${s.right} ${s.midY} L ${midx} ${s.midY} L ${midx} ${t.midY} L ${t.left - 2} ${t.midY}`;
					const path2 = document.createElementNS(NS, "path");
					path2.setAttribute("d", d);
					path2.setAttribute("class", "pb-dep" + (late ? " pb-dep-late" : ""));
					path2.setAttribute("marker-end", late ? "url(#pb-arrow-late)" : "url(#pb-arrow)");
					svg.appendChild(path2);
					if (late) el.addClass("pb-tl-late");
					any = true;
				}
			}
			if (any) inner.appendChild(svg);
		});
	}

	/** Middle of the bar moves it; the 8px edges resize start or end. Deltas
	 *  snap to whole days at the current zoom; Escape restores the bar. */
	private attachBarDrag(
		bar: HTMLElement,
		it: { en: BasesEntry; start: string; end: string },
		ppd: number,
		startKeyName: string,
		endKeyName: string | null
	) {
		let mode: "move" | "l" | "r" = "move";
		let baseLeft = 0;
		let baseWidth = 0;
		bar.addEventListener("pointerdown", (e: PointerEvent) => {
			const rect = bar.getBoundingClientRect();
			const x = e.clientX - rect.left;
			mode = endKeyName && x <= 8 ? "l" : endKeyName && x >= rect.width - 8 ? "r" : "move";
		});
		attachPointerGesture(bar, {
			onStart: () => {
				this.dragging = true;
				baseLeft = parseFloat(bar.style.left) || 0;
				baseWidth = parseFloat(bar.style.width) || 0;
				bar.addClass("pb-tl-dragging");
			},
			onMove: (dx) => {
				const dd = Math.round(dx / ppd) * ppd;
				if (mode === "move") bar.style.left = baseLeft + dd + "px";
				else if (mode === "r") bar.style.width = Math.max(8, baseWidth + dd) + "px";
				else {
					const shift = Math.min(dd, baseWidth - 8);
					bar.style.left = baseLeft + shift + "px";
					bar.style.width = baseWidth - shift + "px";
				}
			},
			onDrop: (dx) => {
				bar.removeClass("pb-tl-dragging");
				this.dragging = false;
				const days = Math.round(dx / ppd);
				if (days !== 0) void this.commitBarDrag(it, mode, days, startKeyName, endKeyName);
				else this.flushPending();
			},
			onCancel: () => {
				bar.style.left = baseLeft + "px";
				bar.style.width = baseWidth + "px";
				bar.removeClass("pb-tl-dragging");
				this.dragging = false;
				this.flushPending();
			},
			onClick: (ev) => this.open(it.en.file, ev),
		});
	}

	private async commitBarDrag(
		it: { en: BasesEntry; start: string; end: string },
		mode: "move" | "l" | "r",
		days: number,
		startKeyName: string,
		endKeyName: string | null
	) {
		let newStart = it.start;
		let newEnd = it.end;
		if (mode === "move") {
			newStart = addDays(it.start, days);
			newEnd = addDays(it.end, days);
		} else if (mode === "l") {
			newStart = addDays(it.start, days);
			if (dayDiff(newStart, newEnd) < 0) newStart = newEnd;
		} else {
			newEnd = addDays(it.end, days);
			if (dayDiff(newStart, newEnd) < 0) newEnd = newStart;
		}
		this.writing = true;
		try {
			const cache = frontmatterOf(this.app, it.en.file) ?? {};
			const assignments: Record<string, unknown> = {};
			if (newStart !== it.start) {
				const rawS = cache[startKeyName];
				assignments[startKeyName] = typeof rawS === "string" ? replaceDateKey(rawS, newStart) : newStart;
			}
			if (endKeyName && newEnd !== it.end) {
				// dragging the right edge CREATES an end date when missing
				const rawE = cache[endKeyName];
				if (rawE != null || mode === "r") {
					assignments[endKeyName] = typeof rawE === "string" ? replaceDateKey(rawE, newEnd) : newEnd;
				}
			}
			const label =
				mode === "move" ? `Moved "${it.en.file.basename}" to ${newStart}` : `Resized "${it.en.file.basename}"`;
			await this.plugin.writeBatch(label, [{ file: it.en.file, assignments }]);
		} finally {
			this.writing = false;
			this.flushPending();
		}
	}
}

/** Bar, line, or donut over a grouped measure. Plain SVG, chosen hues, no
 *  library; the chart IS the base, embeddable in any note. */
class PowerChartView extends PBView {
	type = "powerbases-chart";

	onDataUpdated(): void {
		const root = this.rootEl;
		root.empty();
		root.className = "pb-root pb-chart";
		const groupProp = this.config.getAsPropertyId("groupProp");
		if (!groupProp) {
			this.hint("Pick a Group by property in the view options to draw the chart.");
			return;
		}
		const chartType = String(this.config.get("chartType") ?? "bar");
		const aggRaw = String(this.config.get("chartAgg") ?? "count");
		const agg = (["count", "sum", "avg", "min", "max"].includes(aggRaw) ? aggRaw : "count") as ChartAgg;
		const valueProp = this.config.getAsPropertyId("valueProp");
		if (agg !== "count" && !valueProp) {
			this.hint("Pick a Measure property, or set Measure to Count.");
			return;
		}
		const gKey = groupProp.startsWith("note.") ? frontmatterKey(groupProp) : null;
		const labels = this.data.data.map((en) => {
			const s = this.text(en, groupProp);
			return s === "" ? null : s;
		});
		const values = valueProp ? this.data.data.map((en) => this.text(en, valueProp)) : this.data.data.map(() => "");
		let data = groupAggregate(labels, values, agg);
		if (this.config.get("sortValue") === true) data = [...data].sort((a, b) => b.value - a.value);
		if (!data.length) {
			this.hint("No data to chart yet.");
			return;
		}
		const measureLabel =
			agg === "count" ? "Count" : agg[0].toUpperCase() + agg.slice(1) + " of " + this.config.getDisplayName(valueProp!);
		const head = root.createDiv({ cls: "pb-chart-head" });
		head.createSpan({ cls: "pb-chart-title", text: measureLabel + " by " + this.config.getDisplayName(groupProp) });
		const body = root.createDiv({ cls: "pb-chart-body" });
		const hue = (label: string) => this.plugin.hueFor(gKey, label);
		if (chartType === "donut") this.renderDonut(body, data, hue);
		else this.renderAxisChart(body, data, hue, chartType === "line");
		const legend = root.createDiv({ cls: "pb-chart-legend" });
		for (const d of data) {
			const item = legend.createDiv({ cls: "pb-legend-item" });
			item.createSpan({ cls: "pb-legend-dot" }).style.background = hue(d.label);
			item.createSpan({ text: `${d.label} · ${formatNum(d.value)}` });
		}
	}

	private svg(parent: HTMLElement, w: number, h: number): SVGSVGElement {
		const s = createSvg("svg", { cls: "pb-chart-svg", attr: { viewBox: `0 0 ${w} ${h}` } });
		parent.appendChild(s);
		return s;
	}

	private el(tag: keyof SVGElementTagNameMap, attrs: Record<string, string>): SVGElement {
		return createSvg(tag, { attr: attrs });
	}

	private renderAxisChart(
		host: HTMLElement,
		data: { label: string; value: number }[],
		hue: (l: string) => string,
		line: boolean
	) {
		const W = 620;
		const H = 320;
		const padL = 46;
		const padB = 46;
		const padT = 12;
		const plotW = W - padL - 12;
		const plotH = H - padT - padB;
		const max = Math.max(...data.map((d) => d.value), 0);
		const ticks = axisTicks(max, 4);
		const ceil = ticks[ticks.length - 1] || 1;
		const svg = this.svg(host, W, H);
		const yOf = (v: number) => padT + plotH - (v / ceil) * plotH;
		for (const t of ticks) {
			const y = yOf(t);
			svg.appendChild(
				this.el("line", { x1: String(padL), y1: String(y), x2: String(W - 12), y2: String(y), class: "pb-axis-grid" })
			);
			const lbl = this.el("text", { x: String(padL - 6), y: String(y + 3), class: "pb-axis-label", "text-anchor": "end" });
			lbl.textContent = formatNum(t);
			svg.appendChild(lbl);
		}
		const band = plotW / data.length;
		if (line) {
			let d = "";
			data.forEach((row, i) => {
				const x = padL + band * (i + 0.5);
				const y = yOf(row.value);
				d += (i === 0 ? "M" : "L") + x + " " + y + " ";
			});
			svg.appendChild(this.el("path", { d: d.trim(), class: "pb-line", stroke: "var(--interactive-accent)" }));
			data.forEach((row, i) => {
				const x = padL + band * (i + 0.5);
				const dot = this.el("circle", { cx: String(x), cy: String(yOf(row.value)), r: "3.5", fill: hue(row.label) });
				const t = this.el("title", {});
				t.textContent = `${row.label}: ${formatNum(row.value)}`;
				dot.appendChild(t);
				svg.appendChild(dot);
			});
		} else {
			const bw = Math.min(band * 0.7, 64);
			data.forEach((row, i) => {
				const x = padL + band * (i + 0.5) - bw / 2;
				const y = yOf(row.value);
				const rect = this.el("rect", {
					x: String(x),
					y: String(y),
					width: String(bw),
					height: String(padT + plotH - y),
					rx: "3",
					fill: hue(row.label),
					class: "pb-bar-rect",
				});
				const t = this.el("title", {});
				t.textContent = `${row.label}: ${formatNum(row.value)}`;
				rect.appendChild(t);
				svg.appendChild(rect);
			});
		}
		data.forEach((row, i) => {
			const x = padL + band * (i + 0.5);
			const lbl = this.el("text", { x: String(x), y: String(H - padB + 16), class: "pb-axis-label", "text-anchor": "middle" });
			lbl.textContent = row.label.length > 9 ? row.label.slice(0, 8) + "…" : row.label;
			svg.appendChild(lbl);
		});
	}

	private renderDonut(host: HTMLElement, data: { label: string; value: number }[], hue: (l: string) => string) {
		const S = 300;
		const cx = S / 2;
		const cy = S / 2;
		const rOuter = 130;
		const rInner = 78;
		const svg = this.svg(host, S, S);
		const segs = donutSegments(data.map((d) => d.value));
		const total = data.reduce((a, b) => a + (b.value > 0 ? b.value : 0), 0);
		segs.forEach((seg, i) => {
			if (seg.frac <= 0) return;
			const a0 = seg.offset;
			const a1 = seg.offset + seg.frac;
			const [x0o, y0o] = arcPoint(cx, cy, rOuter, a0);
			const [x1o, y1o] = arcPoint(cx, cy, rOuter, a1);
			const [x1i, y1i] = arcPoint(cx, cy, rInner, a1);
			const [x0i, y0i] = arcPoint(cx, cy, rInner, a0);
			const large = seg.frac > 0.5 ? 1 : 0;
			const d = [
				`M ${x0o} ${y0o}`,
				`A ${rOuter} ${rOuter} 0 ${large} 1 ${x1o} ${y1o}`,
				`L ${x1i} ${y1i}`,
				`A ${rInner} ${rInner} 0 ${large} 0 ${x0i} ${y0i}`,
				"Z",
			].join(" ");
			const path = this.el("path", { d, fill: hue(data[i].label), class: "pb-donut-seg" });
			const t = this.el("title", {});
			t.textContent = `${data[i].label}: ${formatNum(data[i].value)} (${Math.round(seg.frac * 100)}%)`;
			path.appendChild(t);
			svg.appendChild(path);
		});
		const center = this.el("text", { x: String(cx), y: String(cy + 6), class: "pb-donut-total", "text-anchor": "middle" });
		center.textContent = formatNum(total);
		svg.appendChild(center);
	}
}

/** A light board: cards with a cover image (an image property, or the first
 *  embedded image in the note). Covers lazy-load so a big gallery stays cheap. */
class PowerGalleryView extends PBView {
	type = "powerbases-gallery";

	onDataUpdated(): void {
		this.resetChunkers();
		const root = this.rootEl;
		root.empty();
		root.className = "pb-root pb-gallery pb-gallery-" + String(this.config.get("cardSize") ?? "medium");
		const imageProp = this.config.getAsPropertyId("imageProp");
		const fit = this.config.get("fitCover") !== false;
		const shown = this.config.getOrder().filter((p) => p !== "file.name" && p !== imageProp);
		const head = root.createDiv({ cls: "pb-view-head" });
		this.filterBox(head, "Filter pages…");
		const entries = this.filtered(this.data.data);
		head.createSpan({ cls: "pb-view-count", text: `${entries.length}` });
		const grid = root.createDiv({ cls: "pb-gallery-grid" });
		this.chunk(grid, root, entries, (en) => {
			const card = grid.createDiv({ cls: "pb-gcard", attr: { "data-path": en.file.path } });
			const cover = card.createDiv({ cls: "pb-gcover" + (fit ? " pb-fit" : "") });
			const src = this.coverSrc(en, imageProp);
			if (src) {
				const img = cover.createEl("img", { attr: { loading: "lazy", src } });
				img.addEventListener("error", () => {
					cover.addClass("pb-gcover-none");
					img.remove();
				});
			} else {
				cover.addClass("pb-gcover-none");
				setIcon(cover.createSpan({ cls: "pb-gcover-icon" }), "image");
			}
			const meta = card.createDiv({ cls: "pb-gmeta" });
			meta.createDiv({ cls: "pb-gtitle", text: en.file.basename });
			for (const p of shown.slice(0, 3)) {
				const s = this.text(en, p);
				if (!s) continue;
				meta.createDiv({ cls: "pb-gprop", text: s });
			}
			this.hoverable(card, en.file);
			this.openable(card, en.file);
			card.addEventListener("click", (ev) => this.open(en.file, ev));
		});
		if (!entries.length) grid.createDiv({ cls: "pb-empty", text: this.query ? "No pages match." : "No pages to show." });
	}

	/** A resource URL for the card cover: an explicit image property (wikilink
	 *  or path) if set, else the first image embedded in the note. */
	private coverSrc(en: BasesEntry, imageProp: BasesPropertyId | null): string | null {
		const resolve = (name: string): string | null => {
			const f = this.app.metadataCache.getFirstLinkpathDest(name, en.file.path);
			return f ? this.app.vault.getResourcePath(f) : null;
		};
		if (imageProp) {
			const raw = frontmatterOf(this.app, en.file)?.[frontmatterKey(imageProp)];
			const first: unknown = Array.isArray(raw) ? (raw as unknown[])[0] : raw;
			if (typeof first === "string" && first.trim()) {
				const m = first.match(/^\[\[([^\]|]+)/);
				const target = (m ? m[1] : first).split("#")[0].trim();
				if (/^https?:\/\//.test(target)) return target;
				const r = resolve(target);
				if (r) return r;
			}
		}
		const embeds = this.app.metadataCache.getFileCache(en.file)?.embeds;
		if (embeds) {
			for (const e of embeds) {
				const target = e.link.split("#")[0].split("|")[0].trim();
				if (/\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i.test(target)) {
					const r = resolve(target);
					if (r) return r;
				}
			}
		}
		return null;
	}
}
