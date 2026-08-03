// Node unit tests for the pure view logic. Run: npm test
import {
	addDays,
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
	listToText,
	monthGrid,
	monthSpans,
	orderByRank,
	parseNumber,
	parseRuleValue,
	rankBetween,
	renumber,
	replaceDateKey,
	rollup,
	scalePos,
	textToList,
	timelineRange,
	mergeForSave,
} from "../src/core";

let failures = 0;
function eq(a: unknown, b: unknown, msg: string) {
	const sa = JSON.stringify(a);
	const sb = JSON.stringify(b);
	if (sa === sb) console.log("  ok -", msg);
	else {
		failures++;
		console.error("  FAIL -", msg, "\n    got:     ", sa, "\n    expected:", sb);
	}
}

// --- parseNumber ---
eq(parseNumber("42"), 42, "plain integer");
eq(parseNumber(" 1,234.5 "), 1234.5, "thousands separators and spaces");
eq(parseNumber("$99"), 99, "currency prefix");
eq(parseNumber("45%"), 45, "unit suffix");
eq(parseNumber("-5.25"), -5.25, "negative decimal");
eq(parseNumber("1e3"), 1000, "scientific notation");
eq(parseNumber("2026-07-11"), null, "a date is not a number");
eq(parseNumber("abc"), null, "text is not a number");
eq(parseNumber(""), null, "empty is not a number");
eq(parseNumber("3 apples"), 3, "trailing words are units");

// --- aggregate ---
const VALS = ["10", "5", "", "oops", "2.5"];
eq(aggregate(VALS, "sum"), 17.5, "sum skips blanks and junk");
eq(aggregate(VALS, "avg"), 17.5 / 3, "avg divides by numeric count only");
eq(aggregate(VALS, "min"), 2.5, "min");
eq(aggregate(VALS, "max"), 10, "max");
eq(aggregate(VALS, "filled"), 4, "filled counts non-empty");
eq(aggregate(VALS, "empty"), 1, "empty counts blanks");
eq(aggregate(VALS, "none"), null, "none is null");
eq(aggregate(["a", "b"], "sum"), null, "no numbers means no sum");

// --- formatNum ---
eq(formatNum(2), "2", "integers stay bare");
eq(formatNum(1234.5), "1234.5", "one decimal kept");
eq(formatNum(1 / 3), "0.33", "long decimals round to two");
eq(formatNum(1.2), "1.2", "trailing zero trimmed");

// --- colorIndex ---
eq(colorIndex("Done", 16), colorIndex("Done", 16), "same value, same hue");
eq(colorIndex("x", 0), 0, "empty palette degrades to zero");
eq(colorIndex("a", 16) >= 0 && colorIndex("a", 16) < 16, true, "index stays in range");

// --- dateKeyOf ---
eq(dateKeyOf("2026-07-11"), "2026-07-11", "plain date");
eq(dateKeyOf("2026-07-11T09:30:00"), "2026-07-11", "datetime keeps the date part");
eq(dateKeyOf("due 2026-01-02 noon"), "2026-01-02", "date inside text");
eq(dateKeyOf("2026-13-40"), null, "impossible month and day rejected");
eq(dateKeyOf("tomorrow"), null, "words are not dates");

// --- monthGrid ---
const july = monthGrid(2026, 6, true); // July 2026; the 1st is a Wednesday
eq(july.length, 42, "grid is always six weeks");
eq(july[0].key, "2026-06-29", "monday-start grid leads with prior Monday");
eq(july[0].inMonth, false, "lead cells are out of month");
eq(july[2].key, "2026-07-01", "the 1st lands on Wednesday");
eq(july[2].inMonth, true, "in-month flagged");
const julySun = monthGrid(2026, 6, false);
eq(julySun[0].key, "2026-06-28", "sunday-start grid leads with prior Sunday");
const jan = monthGrid(2026, 0, true); // Jan 1 2026 is a Thursday
eq(jan[3].key, "2026-01-01", "January grid places the 1st on Thursday");

// --- boardColumns ---
eq(boardColumns(["B", "A", "B", null, ""], []), ["B", "A"], "first-seen order, no null lane");
eq(boardColumns(["B", "A", "C"], ["A", "Z", "C"]), ["A", "C", "B"], "saved order wins; stale saved names drop; new values append");
eq(boardColumns([], ["A"]), [], "saved values gone from data disappear");

// --- scalePos ---
eq(scalePos(5, 0, 10), 0.5, "midpoint");
eq(scalePos(10, 10, 10), null, "flat range has no position");
eq(scalePos(0, 0, 10), 0, "min is zero");
eq(scalePos(10, 0, 10), 1, "max is one");

// --- inferKind ---
eq(inferKind(true), "checkbox", "boolean is a checkbox");
eq(inferKind(42), "number", "number kind");
eq(inferKind(["a"]), "list", "array is a list");
eq(inferKind("2026-07-11"), "date", "date string");
eq(inferKind("2026-07-11T09:30"), "datetime", "datetime string");
eq(inferKind("hello"), "text", "plain string");
eq(inferKind(undefined), "text", "missing value edits as text");

// --- list round trip ---
eq(listToText(["a", "b c"]), "a, b c", "list joins readably");
eq(listToText(undefined), "", "missing list is empty");
eq(textToList("a, b c,, d "), ["a", "b c", "d"], "split trims and drops empties");

// --- manual rank ---
eq(rankBetween(null, null), 1000, "first rank in an empty lane");
eq(rankBetween(null, 100), 0, "before the first ranked card");
eq(rankBetween(300, null), 400, "after the last ranked card");
eq(rankBetween(100, 200), 150, "between two ranks");
eq(rankBetween(100, 100.0000001), null, "exhausted gap asks for a renumber");
eq(rankBetween(200, 100), null, "inverted neighbors ask for a renumber");
eq(renumber(3), [100, 200, 300], "renumber leaves gaps");
const R = new Map([["b", 50], ["c", 10]]);
eq(
	orderByRank(["a", "b", "c", "d"], (x) => R.get(x) ?? null),
	["c", "b", "a", "d"],
	"ranked ascend first, unranked keep base order after"
);

// --- lane rules ---
const NOW = new Date(2026, 6, 11, 9, 5);
eq(expandToken("{today}", NOW), "2026-07-11", "today token");
eq(expandToken("{now}", NOW), "2026-07-11T09:05", "now token");
eq(expandToken("Done", NOW), "Done", "plain values pass through");
eq(parseRuleValue("true"), true, "boolean rule value");
eq(parseRuleValue("42"), 42, "numeric rule value");
eq(parseRuleValue("2026-07-11"), "2026-07-11", "dates stay strings in rules");
eq(parseRuleValue("  "), undefined, "blank rule value deletes the property");
eq(parseRuleValue("In Progress"), "In Progress", "text rule value");

// --- coerceForKind ---
eq(coerceForKind("number", "42"), 42, "number commits as number");
eq(coerceForKind("number", "abc"), "abc", "non-numeric input falls back to text");
eq(coerceForKind("list", "x, y"), ["x", "y"], "list commits as array");
eq(coerceForKind("text", "  hi  "), "hi", "text trims");
eq(coerceForKind("text", "   "), undefined, "blank deletes the property");
eq(coerceForKind("date", "2026-07-11"), "2026-07-11", "dates stay strings");

// --- undo capture ---
import { blankBaseYaml, capturePrev, starterBaseYaml } from "../src/core";
const FM = { status: "Done", tags: ["a", "b"], estimate: 3 };
const prev = capturePrev(FM, ["status", "tags", "missing"]);
eq(prev.status, "Done", "scalar captured");
eq(prev.tags, ["a", "b"], "arrays captured by copy");
eq("missing" in prev && prev.missing === undefined, true, "absent keys captured as undefined");
(prev.tags as string[]).push("c");
eq(FM.tags, ["a", "b"], "captured copy does not alias the original");

// --- starter base ---
const YAML = starterBaseYaml('Client "A"/Tasks');
eq(YAML.includes('file.inFolder("Client \\"A\\"/Tasks")'), true, "folder path quotes escape");
eq(YAML.includes("pbGroup: note.status"), true, "board group preset uses the safe key");
eq(YAML.includes('file.ext == "md"'), true, "markdown-only filter included");

const BLANK = blankBaseYaml("Projects");
eq(BLANK.includes("type: powerbases-table"), true, "blank base is a power table");
eq(BLANK.includes("- file.name"), true, "blank base starts with just the name column");
eq(BLANK.includes("powerbases-board"), false, "blank base has no other views");
eq(BLANK.includes('file.inFolder("Projects")'), true, "blank base scopes to its folder");
const EMBED = blankBaseYaml("Projects", false);
eq(EMBED.includes("pbHideName: true"), true, "embed flavor hides the name column");
eq(EMBED.includes("file.name"), false, "embed flavor starts with zero columns");

// --- timeline day math ---
eq(addDays("2026-07-11", 1), "2026-07-12", "add a day");
eq(addDays("2026-12-31", 1), "2027-01-01", "add across a year");
eq(addDays("2026-03-01", -1), "2026-02-28", "back across a month");
eq(dayDiff("2026-07-01", "2026-07-11"), 10, "day difference");
eq(dayDiff("2026-11-01", "2026-11-08"), 7, "a DST week is still seven days");
eq(dayOfWeek("2026-01-04"), 0, "2026-01-04 is a Sunday");
eq(dayOfWeek("2026-07-11"), 6, "2026-07-11 is a Saturday");
eq(
	monthSpans("2026-06-20", "2026-08-05"),
	[
		{ y: 2026, m0: 5, days: 11 },
		{ y: 2026, m0: 6, days: 31 },
		{ y: 2026, m0: 7, days: 5 },
	],
	"month header spans clip to the range"
);
eq(monthSpans("2026-07-05", "2026-07-05"), [{ y: 2026, m0: 6, days: 1 }], "single-day range");
const TR = timelineRange(["2026-07-01", "2026-08-15"], "2026-07-11", 7);
eq(TR, { from: "2026-06-24", to: "2026-08-22" }, "range pads the data span");
eq(timelineRange([], "2026-07-11").from, "2026-06-11", "empty data centers on today");
eq(
	timelineRange(["1999-01-01", "2026-08-01"], "2026-07-11"),
	{ from: "2025-07-11", to: "2028-07-15" },
	"a stray ancient date clamps the range"
);
eq(replaceDateKey("2026-07-11T09:30", "2026-07-14"), "2026-07-14T09:30", "time suffix survives a date swap");
eq(replaceDateKey("not a date", "2026-07-14"), "2026-07-14", "junk becomes the new date");

// --- week view ---
import { timeMinutes, weekDays } from "../src/core";
eq(weekDays("2026-07-15", true), ["2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17", "2026-07-18", "2026-07-19"], "Monday-start week around Wed the 15th");
eq(weekDays("2026-07-15", false)[0], "2026-07-12", "Sunday-start week leads with Sunday the 12th");
eq(weekDays("2026-07-13", true)[0], "2026-07-13", "a Monday is its own week start");
eq(timeMinutes("2026-07-11T09:30"), 570, "9:30 is 570 minutes");
eq(timeMinutes("2026-07-11T00:00"), 0, "midnight is zero");
eq(timeMinutes("2026-07-11"), null, "a date without time has no minutes");
eq(timeMinutes("2026-07-11T25:00"), null, "an impossible hour is rejected");

// --- rollups ---
eq(linkTargets("[[Project A]]"), ["Project A"], "wikilink target");
eq(linkTargets("[[Project A|alias]]"), ["Project A"], "alias stripped");
eq(linkTargets("[[Note#Heading]]"), ["Note"], "heading stripped");
eq(linkTargets(["[[A]]", "B", ""]), ["A", "B"], "lists and plain names");
eq(linkTargets(null), [], "no links");
eq(rollup("count", 3, ["x", "y"]), "3", "count counts targets");
eq(rollup("sum", 2, [5, "3", null]), "8", "sum over raw values");
eq(rollup("avg", 2, [4, 6]), "5", "average");
eq(rollup("filled", 3, ["a", "", null, "b"]), "2", "filled skips blanks");
eq(rollup("list", 2, ["b", "a", "b"]), "b, a", "list joins distinct in order");
eq(rollup("sum", 2, ["a", "b"]), "", "no numbers, empty cell");

// --- filter matching ---
import { matchesQuery } from "../src/core";
eq(matchesQuery(["Alpha", "Done"], ""), true, "empty query matches everything");
eq(matchesQuery(["Alpha Task", "High"], "alp"), true, "token is a substring, case-insensitive");
eq(matchesQuery(["Alpha", "High"], "alpha high"), true, "all tokens must match across parts");
eq(matchesQuery(["Alpha", "Low"], "alpha high"), false, "a missing token fails the row");
eq(matchesQuery(["Alpha", "Beta"], "alphabeta"), false, "tokens do not bridge across parts");

// --- charts ---
import { arcPoint, axisTicks, donutSegments, groupAggregate, niceCeil } from "../src/core";
eq(
	groupAggregate(["A", "B", "A", null], ["1", "2", "3", "9"], "count"),
	[
		{ label: "A", value: 2 },
		{ label: "B", value: 1 },
		{ label: "(empty)", value: 1 },
	],
	"count groups keep first-seen order, null becomes (empty)"
);
eq(
	groupAggregate(["A", "B", "A"], ["5", "2", "3"], "sum"),
	[
		{ label: "A", value: 8 },
		{ label: "B", value: 2 },
	],
	"sum aggregates the value column per group"
);
eq(groupAggregate(["A"], ["x"], "sum"), [], "a group with no numbers drops under sum");
eq(groupAggregate(["A"], ["x"], "count"), [{ label: "A", value: 1 }], "count survives non-numeric values");
eq(niceCeil(7), 10, "nice ceiling rounds up to 10");
eq(niceCeil(23), 25, "23 rounds to 25");
eq(niceCeil(0), 1, "zero max still draws an axis");
eq(niceCeil(200), 200, "exact powers stay put");
eq(axisTicks(80, 4)[0], 0, "ticks start at zero");
const t80 = axisTicks(80, 4);
eq(t80[t80.length - 1] >= 80, true, "ticks reach past the max");
eq(donutSegments([1, 1, 2]).map((s) => Math.round(s.frac * 100)), [25, 25, 50], "donut fractions sum by share");
eq(donutSegments([1, 1, 2])[2].offset, 0.5, "third segment starts halfway");
eq(donutSegments([0, 0]), [], "all-zero donut has no segments");
eq(arcPoint(50, 50, 40, 0), [50, 10], "fraction 0 is twelve o'clock");
eq(arcPoint(50, 50, 40, 0.25), [90, 50], "quarter turn is three o'clock");

// --- progress ---
import { progressPct } from "../src/core";
eq(progressPct(0.4), 40, "fractions scale to percent");
eq(progressPct(45), 45, "plain percent passes");
eq(progressPct("80%"), 80, "strings with units parse");
eq(progressPct(150), 100, "clamps high");
eq(progressPct(0), 0, "zero stays zero");
eq(progressPct(1), 100, "one reads as done");
eq(progressPct("abc"), null, "junk is null");
eq(progressPct(null), null, "missing is null");

// --- field types: links ---
import {
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
	formatPhoneValue,
	hasPhoneFormat,
	looksLikeEmail,
	looksLikeUrl,
	personNames,
	nextId,
	verifyState,
	parseCsv,
	inferColumnKind,
	csvValue,
	inferFieldType,
	sanitizeKey,
	safeName,
	buildBaseYaml,
} from "../src/core";
eq(externalHref("example.com"), "https://example.com", "bare host gets https");
eq(externalHref("http://x.io"), "http://x.io", "existing scheme kept");
eq(externalHref("obsidian://open"), "obsidian://open", "obsidian scheme kept");
eq(externalHref("  "), "", "blank url is empty");
eq(mailtoHref("a@b.com"), "mailto:a@b.com", "email gets mailto");
eq(mailtoHref("mailto:a@b.com"), "mailto:a@b.com", "mailto not doubled");
eq(telHref("+1 (555) 123-4567"), "tel:+15551234567", "phone keeps plus, strips punctuation");
eq(telHref("555.1234"), "tel:5551234", "phone without plus");
eq(mapsUrl("1600 Amphitheatre Pkwy"), "https://www.google.com/maps/search/?api=1&query=1600%20Amphitheatre%20Pkwy", "maps url encodes query");
eq(parseLinkValue("[Head office](123 Main St, Springfield)").caption, "Head office", "place caption parsed");
eq(parseLinkValue("[Head office](123 Main St, Springfield)").address, "123 Main St, Springfield", "place address parsed");
eq(parseLinkValue("123 Main St").caption, "", "bare address has no caption");
eq(parseLinkValue("123 Main St").address, "123 Main St", "bare address kept as address");
eq(parseLinkValue("").address, "", "blank place is empty");
eq(parseLinkValue("[Docs](https://claude.ai/design/p/9675ac5d)").caption, "Docs", "url display text parsed");
eq(parseLinkValue("[Docs](https://claude.ai/design/p/9675ac5d)").address, "https://claude.ai/design/p/9675ac5d", "url address parsed");
eq(
	parseLinkValue("[Rust](https://en.wikipedia.org/wiki/Rust_(programming_language))").address,
	"https://en.wikipedia.org/wiki/Rust_(programming_language)",
	"greedy capture keeps parens inside a url"
);
eq(formatLinkValue("123 Main St", "Home"), "[Home](123 Main St)", "link value composes text + address");
eq(formatLinkValue("123 Main St", ""), "123 Main St", "no text stores bare address");
eq(formatLinkValue("", "Home"), "", "no address yields empty value");
eq(formatLinkValue("https://x.io", "a]b[c"), "[abc](https://x.io)", "brackets dropped from display text");
eq(formatLinkValue(parseLinkValue("[Home](123 Main St)").address, parseLinkValue("[Home](123 Main St)").caption), "[Home](123 Main St)", "link value round-trips");
eq(fileLinkParts("[[Attachments/report.pdf]]").link, "Attachments/report.pdf", "file wikilink target");
eq(fileLinkParts("[[Attachments/report.pdf]]").name, "report.pdf", "file name is last segment");
eq(fileLinkParts("[[Attachments/report.pdf|Q3 report]]").name, "Q3 report", "file alias wins as name");
eq(fileLinkParts("[[Attachments/report.pdf|Q3 report]]").link, "Attachments/report.pdf", "alias does not leak into target");
eq(fileLinkParts("photo.png").link, "photo.png", "bare path is the target");
eq(fileLinkParts("https://x.io/a.png").name, "a.png", "url name is last segment");
eq(parseDateInput("2026-07-16"), "2026-07-16", "iso date passes through");
eq(parseDateInput("2026-07-16T09:30"), "2026-07-16T09:30", "iso datetime passes through");
eq(parseDateInput("07/16/2026"), "2026-07-16", "us slashes parse");
eq(parseDateInput("7/4/2026"), "2026-07-04", "single digits pad");
eq(parseDateInput("16/07/2026", "eu"), "2026-07-16", "eu order honored");
eq(parseDateInput("16.7.2026", "eu"), "2026-07-16", "eu dots parse");
eq(parseDateInput("13/1/2026"), "2026-01-13", "impossible month flips to day");
eq(parseDateInput("7/16/2026 9:30"), "2026-07-16T09:30", "trailing time rides along");
eq(parseDateInput("7/16/2026 1:30 pm"), "2026-07-16T13:30", "12-hour pm converts");
eq(parseDateInput("7/16/2026 12:05 am"), "2026-07-16T00:05", "12 am is midnight");
eq(parseDateInput("hello"), null, "words are not dates");
eq(parseDateInput("13/13/2026"), null, "impossible both ways rejects");
eq(parseDateInput(""), null, "blank is null");
eq(scopeFolder('file.inFolder("A/B")'), "A/B", "scope reads a bare filter string");
eq(scopeFolder({ and: ['file.inFolder("_resources/bases/X Base")', 'file.ext == "md"'] }), "_resources/bases/X Base", "scope found inside an and-group");
eq(scopeFolder({ or: [{ and: ['file.ext == "md"'] }, { and: ['file.inFolder("Deep")'] }] }), "Deep", "scope found in nested groups");
eq(scopeFolder({ and: ['file.ext == "md"'] }), null, "no folder scope is null");
eq(scopeFolder(undefined), null, "missing filters is null");
eq(toCsv([["a", "b"], ["1", "2"]]), "a,b\r\n1,2\r\n", "csv rows join with crlf");
eq(toCsv([["a,b", 'say "hi"', "x\ny"]]), '"a,b","say ""hi""","x\ny"\r\n', "fields quote and double as needed");
eq(parseCsv(toCsv([["a,b", 'q"q', "plain"]]).trim()), [["a,b", 'q"q', "plain"]], "toCsv round-trips through parseCsv");
eq(parseCsv("a\tb\tc\n1\t2\t3", "\t"), [["a", "b", "c"], ["1", "2", "3"]], "tab delimiter parses a pasted grid");
eq(parseCsv('a\t"multi\nline"\tb', "\t"), [["a", "multi\nline", "b"]], "quoted cells keep newlines in tsv");
eq(formatPhoneValue("8005551212", { style: "hyphens" }), "800-555-1212", "phone hyphens");
eq(formatPhoneValue("8005551212", { style: "parens" }), "(800) 555-1212", "phone parentheses");
eq(formatPhoneValue("8005551212", { style: "spaces" }), "800 555 1212", "phone spaces");
eq(formatPhoneValue("8005551212", { style: "dots" }), "800.555.1212", "phone dots");
eq(formatPhoneValue("(800) 555-1212", { style: "dots" }), "800.555.1212", "phone reformats from messy input");
eq(formatPhoneValue("1-800-555-1212", { style: "hyphens" }), "1-800-555-1212", "leading 1 kept as country code");
eq(formatPhoneValue("+1 800 555 1212", { style: "parens" }), "+1 (800) 555-1212", "plus-1 kept with parens");
eq(formatPhoneValue("8005551212", { style: "raw" }), "8005551212", "raw style leaves digits alone");
eq(formatPhoneValue("+44 20 7946 0958", { style: "hyphens" }), "+44 20 7946 0958", "UK number passes through as typed");
eq(formatPhoneValue("+63 917 123 4567", { style: "dots" }), "+63 917 123 4567", "Philippines mobile passes through");
eq(formatPhoneValue("555-1212", { style: "hyphens" }), "555-1212", "seven-digit local left as typed");
eq(hasPhoneFormat({ style: "raw" }), false, "raw is not a formatting style");
eq(hasPhoneFormat({ style: "parens" }), true, "parens is a formatting style");
eq(hasPhoneFormat(null), false, "no format is not formatting");
eq(looksLikeEmail("a@b.com"), true, "email shape");
eq(looksLikeEmail("nope"), false, "non-email");
eq(looksLikeUrl("https://x.io/y"), true, "http url shape");
eq(looksLikeUrl("www.x.io"), true, "www url shape");
eq(looksLikeUrl("plain text"), false, "non-url");

// --- field types: person ---
eq(personNames("Alice"), ["Alice"], "single person string");
eq(personNames(["Alice", "Bob"]), ["Alice", "Bob"], "person list");
eq(personNames("[[People/Carol|Carol]]"), ["Carol"], "person wikilink unwrapped");
eq(personNames(""), [], "empty person");
eq(personNames([" Dave ", ""]), ["Dave"], "person trims and drops blanks");

// --- field types: id ---
eq(nextId([], "PB-"), "PB-1", "first id starts at one");
eq(nextId(["PB-1", "PB-2"], "PB-"), "PB-3", "next after highest");
eq(nextId(["PB-007", "PB-003"], "PB-"), "PB-008", "padding preserved");
eq(nextId(["1", "5", "3"], ""), "6", "no prefix, bare numbers");
eq(nextId(["other", "PB-4"], "PB-"), "PB-5", "ignores values off the prefix");

// --- field types: verification ---
eq(verifyState("verified", null, "2026-07-12"), "verified", "verified with no expiry");
eq(verifyState("verified", "2026-01-01", "2026-07-12"), "expired", "verified but past expiry");
eq(verifyState("verified", "2026-12-01", "2026-07-12"), "verified", "verified within expiry");
eq(verifyState("", null, "2026-07-12"), "unverified", "empty is unverified");
eq(verifyState("expired", null, "2026-07-12"), "expired", "explicit expired");

// --- CSV ---
eq(parseCsv("a,b,c\n1,2,3"), [["a", "b", "c"], ["1", "2", "3"]], "simple csv");
eq(parseCsv('name,note\n"Smith, J","says ""hi"""'), [["name", "note"], ["Smith, J", 'says "hi"']], "quoted commas and doubled quotes");
eq(parseCsv("a\r\nb\r\n"), [["a"], ["b"]], "crlf and trailing newline");
eq(parseCsv('x,"line\none"'), [["x", "line\none"]], "newline inside quotes");
eq(parseCsv("a,b\n\n1,2"), [["a", "b"], ["1", "2"]], "blank line dropped");
eq(inferColumnKind(["1", "2", "3"]), "number", "all numbers");
eq(inferColumnKind(["1,234", "5,678"]), "number", "thousands separators are numbers");
eq(inferColumnKind(["2026-07-12", "2026-01-01"]), "date", "all dates");
eq(inferColumnKind(["true", "false", "yes"]), "checkbox", "booleans");
eq(inferColumnKind(["1", "hello"]), "text", "mixed falls back to text");
eq(inferColumnKind([]), "text", "empty is text");
eq(csvValue("number", "1,234"), 1234, "csv number strips separators");
eq(csvValue("checkbox", "yes"), true, "csv checkbox yes");
eq(csvValue("checkbox", "false"), false, "csv checkbox false");
eq(csvValue("date", "2026-07-12"), "2026-07-12", "csv date stays string");
eq(csvValue("text", "  "), undefined, "csv blank is undefined");
eq(csvValue("text", "hi"), "hi", "csv text trimmed");
eq(inferFieldType("Email", ["a@b.com"]), "email", "email by header");
eq(inferFieldType("contact", ["x@y.com", "z@w.com"]), "email", "email by values");
eq(inferFieldType("Website", ["acme.com"]), "url", "url by header");
eq(inferFieldType("Mobile", ["555-1212"]), "phone", "phone by header");
eq(inferFieldType("Assignee", ["Alice"]), "person", "person by header");
eq(inferFieldType("Notes", ["whatever"]), null, "no special type");

// --- key and name sanitizing ---
eq(sanitizeKey("Due Date", 1), "Due Date", "clean header kept");
eq(sanitizeKey("Price: USD", 1), "Price USD", "colon stripped");
eq(sanitizeKey("   ", 3), "col3", "blank header falls back");
eq(safeName('a/b:c*d?"'), "abcd", "illegal file chars stripped");
eq(safeName("   "), "Untitled", "blank name falls back");

// --- base builder ---
eq(
	buildBaseYaml("Tasks", [{ type: "powerbases-table", name: "Table", order: ["file.name", "note.status"] }]),
	'filters:\n  and:\n    - file.inFolder("Tasks")\n    - file.ext == "md"\nviews:\n  - type: powerbases-table\n    name: Table\n    order:\n      - file.name\n      - note.status\n',
	"base yaml with order"
);
eq(
	buildBaseYaml("", [{ type: "powerbases-calendar", name: "Cal", options: { dateProp: "note.due" } }]).includes("dateProp: note.due"),
	true,
	"base yaml carries view options"
);

// --- number formatting ---
import { formatNumberValue, hasNumberFormat, isMeter, meterFraction, currencySymbol, starCount, formatPercent, trafficState } from "../src/core";
eq(isMeter({ display: "stars" }), true, "stars is a meter");
eq(isMeter({ display: "dots" }), true, "dots is a meter");
eq(isMeter({ display: "traffic" }), true, "traffic is a meter");
eq(isMeter({ display: "percent" }), false, "percent is text, not a meter");
eq(starCount(3, 5), 3, "three of five");
eq(starCount(3.6, 5), 4, "rounds up");
eq(starCount(9, 5), 5, "clamps to count");
eq(starCount(-1, 5), 0, "clamps to zero");
eq(formatPercent(30, 60), "50%", "half is 50 percent");
eq(formatPercent(0.4, 1), "40%", "fraction of one");
eq(formatPercent(1, 3, 1), "33.3%", "percent with a decimal");
eq(trafficState(12, 33, 66), "red", "below low is red");
eq(trafficState(54, 33, 66), "amber", "between is amber");
eq(trafficState(82, 33, 66), "green", "above high is green");
eq(trafficState(66, 33, 66), "green", "at high is green");
eq(currencySymbol("USD"), "$", "USD symbol");
eq(currencySymbol("PHP"), "₱", "PHP symbol");
eq(currencySymbol("EUR"), "€", "EUR symbol");
eq(currencySymbol(undefined), "", "no currency");
eq(formatNumberValue(1234.5, { decimals: 2, thousands: true, currency: "USD" }), "$1,234.50", "currency prefixes the number");
eq(formatNumberValue(1234.5, { decimals: 2, thousands: true, currency: "PHP", prefix: "₱" }), "₱1,234.50", "explicit prefix wins over currency");
eq(formatNumberValue(-99, { currency: "EUR" }), "-€99", "sign leads currency symbol");
eq(isMeter({ display: "bar" }), true, "bar is a meter");
eq(isMeter({ display: "ring" }), true, "ring is a meter");
eq(isMeter({ display: "plain" }), false, "plain is not a meter");
eq(isMeter({ decimals: 2 }), false, "no display is not a meter");
eq(meterFraction(50, 100), 0.5, "half fill");
eq(meterFraction(150, 100), 1, "over max clamps to full");
eq(meterFraction(-10, 100), 0, "negative clamps to empty");
eq(meterFraction(5, 0), 0, "zero max is empty");
eq(hasNumberFormat({ display: "bar" }), true, "bar display counts as a format");
eq(hasNumberFormat({ currency: "USD" }), true, "currency counts as a format");
eq(formatNumberValue(414000.8564, { decimals: 2, thousands: true }), "414,000.86", "2dp + thousands");
eq(formatNumberValue(67591.70999999999, { decimals: 2, thousands: true }), "67,591.71", "float noise rounds away");
eq(formatNumberValue(5869233.0768, { decimals: 2, thousands: true, prefix: "₱" }), "₱5,869,233.08", "currency prefix");
eq(formatNumberValue(7527, { decimals: 0, thousands: true, prefix: "$" }), "$7,527", "no decimals, prefix");
eq(formatNumberValue(-1234.5, { decimals: 2, thousands: true, prefix: "$" }), "-$1,234.50", "sign leads the prefix");
eq(formatNumberValue(45, { suffix: "%" }), "45%", "suffix only");
eq(formatNumberValue(326.53, {}), "326.53", "empty format leaves the number");
eq(hasNumberFormat({ decimals: 2 }), true, "decimals counts as a format");
eq(hasNumberFormat({}), false, "empty format is no format");
eq(hasNumberFormat(null), false, "null is no format");

// --- date/time formatting ---
import { formatDateValue, hasDateFormat } from "../src/core";
eq(formatDateValue("2026-07-12", { preset: "iso" }), "2026-07-12", "iso date");
eq(formatDateValue("2026-07-12", { preset: "us" }), "07/12/2026", "us date");
eq(formatDateValue("2026-07-12", { preset: "eu" }), "12/07/2026", "eu date");
eq(formatDateValue("2026-07-12", { preset: "medium" }), "Jul 12, 2026", "medium date");
eq(formatDateValue("2026-07-12", { preset: "long" }), "July 12, 2026", "long date");
eq(formatDateValue("2026-07-15T09:30", { preset: "iso", time: "24h" }), "2026-07-15 09:30", "iso + 24h time");
eq(formatDateValue("2026-07-15T13:05", { preset: "medium", time: "12h" }), "Jul 15, 2026 1:05 PM", "medium + 12h time");
eq(formatDateValue("2026-07-15T00:00", { preset: "iso", time: "12h" }), "2026-07-15 12:00 AM", "midnight is 12 AM");
eq(formatDateValue("2026-07-12", { preset: "iso", time: "24h" }), "2026-07-12", "time requested but none present");
eq(formatDateValue("2026-07-12", { preset: "relative" }, "2026-07-12"), "today", "relative today");
eq(formatDateValue("2026-07-13", { preset: "relative" }, "2026-07-12"), "tomorrow", "relative tomorrow");
eq(formatDateValue("2026-07-11", { preset: "relative" }, "2026-07-12"), "yesterday", "relative yesterday");
eq(formatDateValue("2026-07-05", { preset: "relative" }, "2026-07-12"), "7 days ago", "relative past");
eq(formatDateValue("2026-07-19", { preset: "relative" }, "2026-07-12"), "in 7 days", "relative future");
eq(formatDateValue("not a date", { preset: "long" }), "not a date", "non-date passes through");
eq(hasDateFormat({ preset: "iso" }), true, "explicit iso counts");
eq(hasDateFormat({ time: "24h" }), true, "time-only counts");
eq(hasDateFormat({}), false, "empty date format is none");

// --- formula evaluator (preview) ---
import { evalFormula, safeFormulaName } from "../src/core";
eq(safeFormulaName("Mo. Rent"), "Mo_Rent", "formula name spaces to underscores");
eq(safeFormulaName("ppu"), "ppu", "clean name kept");
eq(safeFormulaName("2024 total"), "f_2024_total", "leading digit gets prefix");
eq(safeFormulaName("  "), "", "blank name is empty");
const rentRow = { Rent: 1267.88, SQM: 326.53, "Due Rate": 230, "Exch Rate": 55 };
const val = (r: ReturnType<typeof evalFormula>) => (r.ok ? r.value : "ERR:" + r.error);
eq(evalFormula('note["Rent"] * note["SQM"]', rentRow).ok, true, "rent formula parses");
eq(Math.round(val(evalFormula('note["Rent"] * note["SQM"]', rentRow)) as number), 414001, "Mo. Rent = Rent * SQM");
eq(Math.round(val(evalFormula('note["Due Rate"] * note["SQM"]', rentRow)) as number), 75102, "Mo. Dues = Due Rate * SQM");
eq(
	Math.round(val(evalFormula('(formula.mo_rent + formula.mo_dues) * 12', rentRow, { mo_rent: 'note["Rent"] * note["SQM"]', mo_dues: 'note["Due Rate"] * note["SQM"]' })) as number),
	5869233,
	"Yr. Rent via formula refs"
);
eq(val(evalFormula('(note["Rent"] * note["SQM"] / note["Exch Rate"]).round()', rentRow)), 7527, "USD with method round()");
eq(evalFormula("2 + 3 * 4", {}).ok && (evalFormula("2 + 3 * 4", {}) as { value: unknown }).value, 14, "operator precedence");
eq(val(evalFormula("(2 + 3) * 4", {})), 20, "parentheses");
eq(val(evalFormula("-5 + 2", {})), -3, "unary minus");
eq(val(evalFormula("round(3.14159, 2)", {})), 3.14, "round to 2 places");
eq(val(evalFormula("price.toFixed(2)", { price: 9.5 })), "9.50", "toFixed returns string");
eq(val(evalFormula('if(votes > 50, "hot", "cold")', { votes: 88 })), "hot", "if true branch");
eq(val(evalFormula('if(votes > 50, "hot", "cold")', { votes: 12 })), "cold", "if false branch");
eq(val(evalFormula('first + " " + last', { first: "Ada", last: "Lovelace" })), "Ada Lovelace", "string concat with +");
eq(val(evalFormula("max(a, b, 10)", { a: 3, b: 7 })), 10, "max of args");
eq(val(evalFormula('upper(name)', { name: "obsidian" })), "OBSIDIAN", "upper()");
eq(val(evalFormula('contains(tags, "urgent")', { tags: ["urgent", "bug"] })), true, "contains on a list");
eq(val(evalFormula("note.missing + 1", {})), "1", "missing property in + concatenates (null as empty)");
eq(val(evalFormula("note.missing * 2", {})), "ERR:expected a number", "missing property in numeric op fails gracefully");
eq(evalFormula("2 +", {}).ok, false, "incomplete expression is not ok");
eq(evalFormula("weirdfn(1)", {}).ok, false, "unknown function is not ok");
eq(evalFormula("formula.nope", {}).ok, false, "unknown formula ref is not ok");

// --- mergeForSave: data.json is synced, so a save must not clobber a device ---
{
	// A device holding an old snapshot changes one thing. Its save must not carry
	// the rest of that snapshot over what another device set since. A setting
	// nothing rewrites afterwards never comes back from that.
	const idleBaseline = { basesFolder: "old", valueColors: {} as Record<string, unknown> };
	const idleMemory = { basesFolder: "new", valueColors: {} as Record<string, unknown> };
	const disk = { basesFolder: "old", valueColors: { Status: { Done: "#0f0" } } };
	eq(
		mergeForSave(idleMemory, idleBaseline, disk),
		{ basesFolder: "new", valueColors: { Status: { Done: "#0f0" } } },
		"an idle device keeps another device's colors and carries only its own change"
	);
}
eq(mergeForSave({ k: "new" }, { k: "old" }, { k: "other" }), { k: "new" }, "our own change still wins over disk");
eq(mergeForSave({ k: "" }, { k: "had" }, { k: "had" }), { k: "" }, "clearing on purpose is a change and sticks");
eq(mergeForSave({ k: "ours", n: 1 } as { k?: string; n: number }, { k: "ours", n: 1 } as { k?: string; n: number }, { n: 2 }), { k: "ours", n: 2 }, "a key absent from disk keeps ours");
eq(mergeForSave({ k: 1 }, { k: 1 }, null), { k: 1 }, "no disk state yet = write ours");

{
	// A key holding one value per item is a whole vault's worth of settings behind
	// a single name. Changing ONE of them used to publish ALL of them, erasing
	// every item another device had configured since this one last read.
	type M = { map: Record<string, number[]> };
	const baseline: M = { map: { A: [1] } };
	const ours: M = { map: { A: [2] } };
	const disk: M = { map: { A: [1], B: [9] } };
	eq(mergeForSave(ours, baseline, disk), { map: { A: [2], B: [9] } }, "one entry's change publishes that entry, not the whole map");
	eq(mergeForSave({ map: { A: [1] } } as M, { map: { A: [1], B: [9] } } as M, { map: { A: [1], B: [9] } } as M), { map: { A: [1] } }, "an entry we removed stays removed");
	eq(mergeForSave({ map: { A: [1] } } as M, { map: { A: [1] } } as M, { map: { A: [7] } } as M), { map: { A: [7] } }, "an entry we did not touch takes the disk's");
	eq(mergeForSave({ list: ["a"] }, { list: ["a", "b"] }, { list: ["a", "b"] }), { list: ["a"] }, "an array is a value, still merged whole");
}

if (failures) {
	console.error(`\n${failures} test(s) FAILED.`);
	process.exit(1);
}
console.log("\nAll tests passed.");

// --- the deploy guard ---
// Two sessions building this plugin at once is enough for the second to
// overwrite the first with an older build, silently. The comparison is where a
// bug would disable the guard without failing anything, so it is pinned here.
{
	const { compareVersions, isDowngrade, versionFromManifest } = require("../deploy-guard.mjs");

	eq(compareVersions("1.89.1", "1.89.0") > 0, true, "a later patch sorts after");
	eq(compareVersions("1.89.0", "1.89.1") < 0, true, "and an earlier one before");
	eq(compareVersions("1.89.1", "1.89.1"), 0, "the same version ties");
	// the whole reason this compares numbers: as strings, "1.9.0" sorts after
	// "1.10.0", which is exactly backwards
	eq(compareVersions("1.10.0", "1.9.0") > 0, true, "10 is a later minor than 9, not an earlier one");
	eq(compareVersions("1.88.10", "1.88.9") > 0, true, "and the same holds for the patch");
	eq(compareVersions("2.0.0", "1.99.99") > 0, true, "a major bump outranks everything under it");
	eq(compareVersions("1.89", "1.89.0"), 0, "a missing part counts as zero");
	eq(compareVersions("", ""), 0, "two unreadable versions tie rather than throwing");

	eq(isDowngrade("1.89.1", "1.88.1"), true, "deploying an older build over a newer one is the collision this catches");
	eq(isDowngrade("1.88.1", "1.89.1"), false, "the ordinary direction is not");
	eq(isDowngrade("1.89.1", "1.89.1"), false, "and neither is redeploying the same version, which is what developing looks like");
	eq(isDowngrade(null, "1.89.1"), false, "a vault with nothing installed has nothing to lose");
	eq(isDowngrade("", "1.89.1"), false, "nor one whose version could not be read");

	eq(versionFromManifest("{ not json"), null, "a manifest too broken to parse names no version");
	eq(versionFromManifest("{}"), null, "and neither does one with no version key");
	eq(versionFromManifest('{"version":"1.2.3"}'), "1.2.3", "otherwise the version is read off it");
	eq(versionFromManifest('{"version":"  "}'), null, "a blank version is no version");
}
