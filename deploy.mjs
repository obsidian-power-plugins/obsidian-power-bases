// Copies the built plugin into every Obsidian vault on this machine.
// Vaults are discovered from Obsidian's own registry file, so this works
// unchanged on Windows, macOS, and Linux. Run via: npm run deploy
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import process from "process";

const candidates = [
	process.env.APPDATA ? join(process.env.APPDATA, "obsidian", "obsidian.json") : null,
	join(homedir(), "Library", "Application Support", "obsidian", "obsidian.json"),
	join(homedir(), ".config", "obsidian", "obsidian.json"),
].filter(Boolean);

const registry = candidates.find((p) => existsSync(p));
if (!registry) {
	console.error("No Obsidian vault registry found (is Obsidian installed and has it been opened once?)");
	process.exit(1);
}

const vaults = Object.values(JSON.parse(readFileSync(registry, "utf8")).vaults ?? {}).map((v) => v.path);
if (!vaults.length) {
	console.error("Obsidian registry has no vaults.");
	process.exit(1);
}

const files = ["manifest.json", "main.js", "styles.css", "README.md"];
let deployed = 0;
for (const vault of vaults) {
	if (!existsSync(join(vault, ".obsidian"))) {
		console.log("skip (no .obsidian):", vault);
		continue;
	}
	const dest = join(vault, ".obsidian", "plugins", "powerbases");
	mkdirSync(dest, { recursive: true });
	for (const f of files) copyFileSync(f, join(dest, f));
	console.log("deployed ->", dest);
	deployed++;
}
console.log(deployed ? `Done. Reload Obsidian (Ctrl+R) and enable "Power Bases" if it isn't enabled yet.` : "Nothing deployed.");
