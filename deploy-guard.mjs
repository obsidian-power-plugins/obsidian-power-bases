// The version arithmetic behind the deploy guard, kept apart from the deploy
// itself so it can be tested. Nothing here touches the filesystem: it is handed
// strings and answers questions about them.

/** Compare two "1.2.3" version strings: negative, zero, or positive, like a
 *  sort comparator.
 *
 *  Compared as numbers per part, never as strings. As strings "1.9.0" sorts
 *  after "1.10.0", which would make the guard wave through exactly the
 *  overwrites it exists to catch. A missing or malformed part counts as 0, so a
 *  version this cannot read loses rather than blocking a deploy. */
export function compareVersions(a, b) {
	const parts = (v) =>
		String(v ?? "")
			.trim()
			.split(".")
			.map((n) => (/^\d+$/.test(n) ? Number(n) : 0));
	const x = parts(a);
	const y = parts(b);
	for (let i = 0; i < Math.max(x.length, y.length); i++) {
		const d = (x[i] ?? 0) - (y[i] ?? 0);
		if (d) return d;
	}
	return 0;
}

/** Whether deploying `incoming` over an installed `installed` would move the
 *  vault backwards. Equal versions are fine: rebuilding and redeploying the
 *  same version is what developing this plugin looks like all day. An absent or
 *  unreadable installed version is not a downgrade either — there is nothing
 *  there to lose. */
export function isDowngrade(installed, incoming) {
	if (!installed) return false;
	return compareVersions(installed, incoming) > 0;
}

/** The version named by a manifest's text, or null when it says none. A
 *  manifest too broken to parse counts as nothing installed: it cannot be the
 *  newer work worth protecting. */
export function versionFromManifest(text) {
	try {
		const v = JSON.parse(text).version;
		return typeof v === "string" && v.trim() ? v.trim() : null;
	} catch {
		return null;
	}
}
