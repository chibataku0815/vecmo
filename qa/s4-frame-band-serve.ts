/**
 * Serves a rendered frame package to `qa/s4-frame-band-probe.html` with CORS.
 *
 * The package lives in a scratchpad (~4 MB per package) and never in the repo,
 * so it cannot be served from `public/`. This is a dev-only static server for
 * that one directory; it reads files and serves nothing else.
 *
 * Run: bun qa/s4-frame-band-serve.ts <package-dir> [port]
 */

const root = Bun.argv[2];
if (!root) throw new Error("usage: bun qa/s4-frame-band-serve.ts <dir> [port]");
const port = Number(Bun.argv[3] ?? 6251);

Bun.serve({
	port,
	fetch: async (request) => {
		const name = new URL(request.url).pathname.replace(/^\/+/, "");
		// One directory, no traversal: a path segment is a bare file name or it is
		// refused. This harness serves render output, not the filesystem.
		if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes("..")) {
			return new Response("bad name", {
				status: 400,
				headers: { "access-control-allow-origin": "*" },
			});
		}
		const file = Bun.file(`${root}/${name}`);
		if (!(await file.exists())) {
			return new Response("not found", {
				status: 404,
				headers: { "access-control-allow-origin": "*" },
			});
		}
		return new Response(file, {
			headers: {
				"access-control-allow-origin": "*",
				"cache-control": "no-store",
			},
		});
	},
});
console.log(`serving ${root} on http://127.0.0.1:${port}`);
