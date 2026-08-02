// Refuse to ship a bundle that a stale JavaScript engine cannot even parse.
//
// Lookbehind is a *parse*-time syntax error on Safari below 16.4, which means
// one regex literal anywhere in main.js stops the whole plugin from loading on
// older iOS. Not the feature that uses it: all of it.
//
// This exists because that shipped. The source was clean and the directory
// linter was happy, but the linter only reads src/, and Obsidian loads the
// bundle. @anthropic-ai/sdk contributed a lookbehind literal of its own, so a
// plugin whose own code had none still could not start.
//
// esbuild.config.mjs now declares the feature unavailable, which makes esbuild
// emit new RegExp("...") instead. A string is parsed lazily, so an old engine
// only trips if that code path actually runs. This check proves the setting is
// still doing its job: re-transforming the finished bundle with the same
// setting must find nothing left to convert. If someone drops the setting, or
// a future dependency slips a literal through some path esbuild does not
// cover, the delta goes positive and the build stops here.
//
// Run by esbuild.config.mjs after a production build; also fine on its own.
import esbuild from "esbuild";
import { readFileSync } from "fs";
import process from "process";

const bundle = readFileSync("main.js", "utf8");
const ctors = (s) => (s.match(/new RegExp\(/g) ?? []).length;

const rebuilt = await esbuild.transform(bundle, {
	loader: "js",
	format: "cjs",
	target: "es2020",
	supported: { "regexp-lookbehind-assertions": false },
});

const converted = ctors(rebuilt.code) - ctors(bundle);

if (converted > 0) {
	console.error(
		`\n  main.js still contains ${converted} lookbehind regex ` +
			`literal${converted === 1 ? "" : "s"}.\n` +
			"  The plugin will not load at all on Safari below 16.4.\n" +
			'  Check that esbuild.config.mjs still sets supported: { "regexp-lookbehind-assertions": false }.\n',
	);
	process.exit(1);
}

// Lookbehind inside a string reaches RegExp at runtime, so it throws only when
// that code path runs. Worth seeing, not worth blocking on: some of these are
// feature-detected by the library that owns them.
const strings = (bundle.match(/\(\?<[=!]/g) ?? []).length;
if (strings > 0) {
	console.log(`  bundle check: no lookbehind literals; ${strings} in strings (runtime only)`);
} else {
	console.log("  bundle check: no lookbehind");
}
