// Refuse to ship an icon name Obsidian does not have.
//
// setIcon() with a name Obsidian does not know draws nothing at all: no error,
// no console warning, just an empty slot where the icon should be. It reads as
// a deliberately icon-less item, which is why "Sort A→Z" sat there blank in the
// Table menu and the AutoFilter dropdown for months before anyone questioned it.
//
// The cause is that Lucide renamed things and Obsidian did not follow. Obsidian
// bundles the icon set it bundles, and the names in it are the names it has:
// arrow-down-az here is arrow-down-a-z in current Lucide, and a name looked up
// from Lucide's own site is therefore right and useless at the same time.
//
// So the names are checked against the icon data inside the installed Obsidian
// rather than against anything written down here, which cannot drift. Unlike
// check-bundle.mjs this reads src/ rather than main.js: it is our own strings
// that are at stake, and the source is where the file and line are.
//
// Skipped, not failed, when Obsidian is not installed on the machine (CI).
// Set OBSIDIAN_ASAR to point at an obsidian.asar somewhere else.
//
// Run by esbuild.config.mjs after a production build; also fine on its own.
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import process from "process";

/**
 * The asar Obsidian actually runs.
 *
 * Obsidian updates itself without touching the installer: it downloads
 * obsidian-<version>.asar into the user's config folder and loads that instead
 * of the copy under Program Files, which stays at whatever version was last
 * installed by hand. Checking the installer copy therefore checks a version
 * nobody is running, and that is not a theoretical gap. It is how
 * `icon: "youtube"` passed this check against 1.12.7 and drew an empty slot in
 * the launcher on 1.13.4, which is the release that dropped the brand icons.
 *
 * Newest wins, because several downloaded versions accumulate there.
 */
const selfUpdated = () => {
	const dirs = [
		process.env.APPDATA ? join(process.env.APPDATA, "obsidian") : null,
		join(homedir(), "Library", "Application Support", "obsidian"),
		join(homedir(), ".config", "obsidian"),
	].filter(Boolean);
	const found = [];
	for (const dir of dirs) {
		if (!existsSync(dir)) continue;
		for (const name of readdirSync(dir)) {
			const m = /^obsidian-(\d+(?:\.\d+)*)\.asar$/.exec(name);
			if (m) found.push([m[1].split(".").map(Number), join(dir, name)]);
		}
	}
	found.sort(([a], [b]) => {
		for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (b[i] ?? 0) - (a[i] ?? 0);
		return 0;
	});
	return found.length ? found[0][1] : null;
};

const candidates = [
	process.env.OBSIDIAN_ASAR,
	selfUpdated(),
	process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Obsidian", "resources", "obsidian.asar") : null,
	process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, "Obsidian", "resources", "obsidian.asar") : null,
	"/Applications/Obsidian.app/Contents/Resources/obsidian.asar",
	join(homedir(), "Applications", "Obsidian.app", "Contents", "Resources", "obsidian.asar"),
	"/opt/Obsidian/resources/obsidian.asar",
	"/usr/lib/obsidian/resources/obsidian.asar",
	join(homedir(), ".local", "share", "obsidian", "resources", "obsidian.asar"),
].filter(Boolean);

const asarPath = candidates.find((p) => existsSync(p));
if (!asarPath) {
	console.log("  icon check: skipped (no Obsidian install found; set OBSIDIAN_ASAR to point at one)");
	process.exit(0);
}

// latin1, not utf8: the archive is binary and every icon name is ASCII, so this
// reads the names exactly while leaving the rest of the bytes alone.
const asar = readFileSync(asarPath, "latin1");

/**
 * Every icon name Obsidian knows.
 *
 * The set is stored as name -> list of shapes, each shape an array starting
 * with a number, and a minifier leaves a key unquoted when it is a valid
 * identifier: `plus:[[6,...` but `"trash-2":[[6,...`. Both spellings are read
 * here. The pattern is deliberately loose about what else it might sweep up:
 * a name wrongly counted as valid costs a blank icon nobody was going to see,
 * while a real name missed would fail a build that should have passed.
 */
const icons = new Set();
for (const m of asar.matchAll(/(?:"([a-z][a-z0-9-]*)"|([a-z][a-z0-9]*)):\[\[\d/g)) icons.add(m[1] ?? m[2]);

if (icons.size < 200) {
	console.log(`  icon check: skipped (read ${icons.size} icons from ${asarPath}, which is too few to trust)`);
	process.exit(0);
}

/** Obsidian's older names, kept working through an alias map of name -> modern
 *  name ("lines-of-text" is "align-left" now). They are still valid to ask for,
 *  so a plugin using one is not making a mistake. */
const alias = (name) => asar.includes(`"${name}":"`);

const files = [];
const walk = (dir) => {
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) walk(p);
		else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) files.push(p);
	}
};
walk("src");

// Where a string is unambiguously an icon: anything unknown here is an error.
// `icon:` is the loose one, being an ordinary word that other objects use as a
// key too, so it only counts when the value is shaped like an icon id at all:
// lower case, no spaces. An icon named "icon set" is not a typo, it is a label.
const CERTAIN = [
	/\bsetIcon\s*\(\s*(?:[^,()]*,\s*)?"([^"]+)"/g,
	/\bicon\s*:\s*"([a-z][a-z0-9-]*)"/g,
	/\baddRibbonIcon\s*\(\s*"([^"]+)"/g,
];
// Everywhere else. Icon names reach setIcon through ["Label", "icon", …]
// tuples and through the plugin's own helpers, whose arguments no pattern here
// can recognize, so every hyphenated lower-case string in the source is a
// candidate. Most of them are CSS classes: what makes a candidate a finding is
// being a near miss of a real icon name, which is what a renamed icon looks
// like and what a class name does not.
const MAYBE = [/"([a-z][a-z0-9]*(?:-[a-z0-9]+)+)"/g];

/** Icons the plugin registers itself are its own to name. */
const own = new Set();
const sources = files.map((f) => [f, readFileSync(f, "utf8")]);
for (const [, src] of sources) {
	for (const m of src.matchAll(/\baddIcon\s*\(\s*"([^"]+)"/g)) own.add(m[1]);
}

/** Obsidian takes a name with or without the lucide- prefix. */
const known = (name) => {
	const n = name.startsWith("lucide-") ? name.slice(7) : name;
	return icons.has(n) || own.has(n) || alias(n);
};

/** The same name with its hyphens moved is the whole of this bug: report it
 *  with the spelling that would have worked. */
const flat = (s) => s.replace(/-/g, "");
const suggest = (name) => {
	const f = flat(name.startsWith("lucide-") ? name.slice(7) : name);
	for (const i of icons) if (flat(i) === f) return i;
	return null;
};

const lineOf = (src, index) => src.slice(0, index).split("\n").length;

const bad = [];
let checked = 0;
for (const [file, src] of sources) {
	for (const [patterns, certain] of [
		[CERTAIN, true],
		[MAYBE, false],
	]) {
		for (const re of patterns) {
			for (const m of src.matchAll(re)) {
				const name = m[1];
				checked++;
				if (known(name)) continue;
				const fix = suggest(name);
				// An unknown string in an ambiguous slot is usually a CSS class,
				// not a typo: only the near misses are worth stopping a build for.
				if (!certain && !fix) continue;
				bad.push({ file, line: lineOf(src, m.index), name, fix });
			}
		}
	}
}

if (bad.length) {
	console.error(`\n  ${bad.length} icon name${bad.length === 1 ? "" : "s"} this Obsidian does not have:\n`);
	for (const b of bad) {
		const fix = b.fix ? `  ->  "${b.fix}"` : "  (no icon of that name, or anything close to it)";
		console.error(`    ${b.file}:${b.line}  "${b.name}"${fix}`);
	}
	console.error(
		"\n  An unknown name draws an empty slot rather than failing, so this is the only\n" +
			"  place it gets caught. Names come from the icon set Obsidian bundles, which is\n" +
			`  behind Lucide's current naming: checked against ${asarPath}\n`,
	);
	process.exit(1);
}

console.log(`  icon check: ${checked} icon names, all known to the installed Obsidian`);
