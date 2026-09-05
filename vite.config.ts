import {
	closeSync,
	existsSync,
	constants as fsConstants,
	fstatSync,
	openSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type PluginOption, type ViteDevServer } from "vite";

const parsePort = (value: string | undefined): number | undefined => {
	if (!value) return undefined;
	const port = Number(value);
	return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
};

const hashOffset = (value: string, spread: number): number => {
	let hash = 0;
	for (const char of value) {
		hash = (hash * 31 + char.charCodeAt(0)) % spread;
	}
	return hash;
};

const parseAllowedHosts = (value: string | undefined): string[] | undefined => {
	if (!value) return undefined;
	const hosts = value
		.split(",")
		.map((host) => host.trim())
		.filter((host) => host.length > 0);
	return hosts.length > 0 ? hosts : undefined;
};

const devInstanceSeed = `${process.cwd()}:${process.env.VMA_DEV_INSTANCE ?? "default"}`;
const fallbackOffset = hashOffset(devInstanceSeed, 400);
const devPort = parsePort(process.env.VMA_DEV_PORT) ?? 5173 + fallbackOffset;
// Cloudflare-only: consumed by vite.config.cloud.ts's `cloudflare()` plugin.
export const inspectorPort =
	parsePort(process.env.VMA_INSPECTOR_PORT) ?? 9229 + fallbackOffset;
export const wranglerConfigPath = process.env.VMA_WRANGLER_CONFIG
	? path.resolve(process.env.VMA_WRANGLER_CONFIG)
	: undefined;
const reactCompilerPilotEnabled = process.env.VMA_REACT_COMPILER !== "0";
const reactCompilerPilotInclude =
	/src[\\/]widgets[\\/]tool-rail[\\/]ui[\\/].+\.tsx$/;

const resolveNodeModuleFile = (modulePath: string): string => {
	let directory = process.cwd();
	while (true) {
		const candidate = path.join(directory, "node_modules", modulePath);
		if (existsSync(candidate)) return candidate;
		const parent = path.dirname(directory);
		if (parent === directory) break;
		directory = parent;
	}
	return fileURLToPath(
		new URL(`./node_modules/${modulePath}`, import.meta.url),
	);
};

const polarCheckoutEmbedEntry = resolveNodeModuleFile(
	"@polar-sh/checkout/dist/embed.js",
);
const polarCheckoutPaymentMethodEntry = resolveNodeModuleFile(
	"@polar-sh/checkout/dist/payment-method.js",
);
// Opt-in verification path for public tunnels such as ngrok. Production and
// normal local dev stay unchanged unless VMA_ALLOWED_HOSTS is set.
const allowedHosts = parseAllowedHosts(process.env.VMA_ALLOWED_HOSTS);

const isLocalSecretArtifact = (fileName: string): boolean =>
	fileName === ".dev.vars" ||
	fileName.startsWith(".dev.vars.") ||
	fileName === ".env" ||
	fileName.startsWith(".env.");

const removeLocalSecretArtifacts = (directory: string): void => {
	if (!existsSync(directory)) return;
	for (const entry of readdirSync(directory)) {
		const absolute = path.join(directory, entry);
		const stats = statSync(absolute);
		if (stats.isDirectory()) {
			removeLocalSecretArtifacts(absolute);
			continue;
		}
		if (stats.isFile() && isLocalSecretArtifact(entry)) {
			rmSync(absolute);
		}
	}
};

// Cloudflare-only: `.dev.vars` is emitted into dist by the `cloudflare()`
// plugin (preview mode); exported for vite.config.cloud.ts to append.
export const removeLocalSecretArtifactsPlugin = () => ({
	name: "vma:remove-local-secret-artifacts",
	apply: "build" as const,
	closeBundle() {
		removeLocalSecretArtifacts(path.join(process.cwd(), "dist"));
	},
});

// Dev-only discovery endpoint for the local agent ⇄ editor bridge. The relay
// binds an ephemeral loopback port and records it in `.vma-agent-bridge`; the
// browser can't read that file, so this middleware hands the editor tab the
// port (never the token — the editor leg is gated by Origin, not the token).
const agentBridgeDiscoveryPlugin = () => ({
	name: "vma:agent-bridge-discovery",
	apply: "serve" as const,
	configureServer(server: ViteDevServer) {
		server.middlewares.use("/__agent-bridge", (_request, response) => {
			response.setHeader("content-type", "application/json");
			try {
				const raw = readFileSync(
					process.env.VMA_AGENT_BRIDGE_DISCOVERY_PATH ??
						path.join(process.cwd(), ".vma-agent-bridge"),
					"utf8",
				);
				const info = JSON.parse(raw) as { port?: unknown; protocol?: unknown };
				if (typeof info.port === "number") {
					response.end(
						JSON.stringify({
							port: info.port,
							protocol: typeof info.protocol === "number" ? info.protocol : 0,
						}),
					);
					return;
				}
			} catch {
				// No relay running; fall through to the 503 below.
			}
			response.statusCode = 503;
			response.end(JSON.stringify({ error: "agent bridge relay not running" }));
		});
	},
});

type ProgramSurfaceBridgePublicDiscovery = {
	readonly protocol: 2;
	readonly bridgeId: string;
	readonly port: number;
	readonly editorOrigin: string;
	readonly startedAt: string;
};

const programSurfaceDiscoveryKeys = new Set([
	"protocol",
	"bridgeId",
	"port",
	"editorOrigin",
	"startedAt",
	"pid",
]);

/**
 * Reads the local record through an already-open, nofollow descriptor. The
 * Vite process projects only the public fields; a surprise token field makes
 * the record unavailable rather than becoming an accidental authority path.
 */
const readProgramSurfaceBridgePublicDiscovery = (
	discoveryPath: string,
): ProgramSurfaceBridgePublicDiscovery | null => {
	let descriptor: number | null = null;
	try {
		descriptor = openSync(
			discoveryPath,
			fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
		);
		const stats = fstatSync(descriptor);
		if (
			!stats.isFile() ||
			(stats.mode & 0o077) !== 0 ||
			stats.size > 8 * 1024
		) {
			return null;
		}
		const value = JSON.parse(readFileSync(descriptor, "utf8")) as unknown;
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			return null;
		}
		const record = value as Record<string, unknown>;
		if (
			Object.keys(record).length !== programSurfaceDiscoveryKeys.size ||
			!Object.keys(record).every((key) =>
				programSurfaceDiscoveryKeys.has(key),
			) ||
			record.protocol !== 2 ||
			typeof record.bridgeId !== "string" ||
			record.bridgeId.length === 0 ||
			typeof record.port !== "number" ||
			!Number.isInteger(record.port) ||
			record.port <= 0 ||
			record.port > 65535 ||
			typeof record.editorOrigin !== "string" ||
			typeof record.startedAt !== "string" ||
			typeof record.pid !== "number" ||
			!Number.isInteger(record.pid) ||
			record.pid <= 0
		) {
			return null;
		}
		const origin = new URL(record.editorOrigin);
		if (
			origin.protocol !== "http:" ||
			origin.origin !== record.editorOrigin ||
			!["localhost", "127.0.0.1", "::1", "[::1]"].includes(
				origin.hostname.toLowerCase(),
			)
		) {
			return null;
		}
		return {
			protocol: 2,
			bridgeId: record.bridgeId,
			port: record.port,
			editorOrigin: record.editorOrigin,
			startedAt: record.startedAt,
		};
	} catch {
		return null;
	} finally {
		if (descriptor !== null) {
			try {
				closeSync(descriptor);
			} catch {
				// The descriptor is already closed or invalid; treat the record as absent.
			}
		}
	}
};

// Dev-only, token-free discovery for the separate local Program Surface
// companion. This is deliberately not an API/Worker route and never exposes
// the terminal-only pairing token, pid, workspace path, source, or bundle.
const programSurfaceBridgeDiscoveryPlugin = () => ({
	name: "vma:program-surface-bridge-discovery",
	apply: "serve" as const,
	configureServer(server: ViteDevServer) {
		server.middlewares.use("/__program-surface-bridge", (request, response) => {
			response.setHeader("content-type", "application/json");
			response.setHeader("cache-control", "no-store");
			const discoveryPath =
				process.env.VMA_PROGRAM_SURFACE_BRIDGE_DISCOVERY_PATH ??
				path.join(process.cwd(), ".vma-program-surface-bridge");
			const info = readProgramSurfaceBridgePublicDiscovery(discoveryPath);
			const requestHost = request.headers.host?.toLowerCase();
			// The browser client must also require `editorOrigin === location.origin`.
			// This host fence prevents this endpoint from acting as cross-origin
			// discovery authority before that client feature is introduced.
			if (
				info &&
				requestHost &&
				new URL(info.editorOrigin).host === requestHost
			) {
				response.end(JSON.stringify(info));
				return;
			}
			response.statusCode = 503;
			response.end();
		});
	},
});

const gravityReviewArtifacts: ReadonlyMap<string, string> = new Map([
	[
		"s1-opening",
		"artifacts/gravity-s1-opening-reproduction/gravity-s1-opening-reproduction.vecmo-backup.json",
	],
	[
		"s1-s2-match-cut",
		"artifacts/gravity-s1-s2-match-cut-reproduction/gravity-s1-s2-match-cut-reproduction.vecmo-backup.json",
	],
	[
		"s3-s4-match-cut",
		"artifacts/gravity-s3-s4-match-cut-reproduction/gravity-s3-s4-match-cut-reproduction.vecmo-backup.json",
	],
	[
		"s4-ringed-planet",
		"artifacts/gravity-s4-ringed-planet-reproduction/gravity-s4-ringed-planet-reproduction.vecmo-backup.json",
	],
	[
		"s4-board-1",
		"artifacts/gravity-s4-board1-reproduction/gravity-s4-board1-reproduction.vecmo-backup.json",
	],
] as const);

const MAX_GRAVITY_REVIEW_PROJECT_BYTES = 512 * 1024;

const isLoopbackRequestHost = (host: string | undefined): boolean => {
	if (!host) return false;
	try {
		const hostname = new URL(`http://${host}`).hostname.toLowerCase();
		return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
	} catch {
		return false;
	}
};

/**
 * Serves only the fixed internal review candidates during Vite development.
 *
 * This is not a production Worker route or a public asset directory. The
 * allowlist deliberately maps opaque review slugs to checked-in artifacts,
 * rejecting arbitrary paths and payloads outside the project-backup contract.
 */
const gravityReviewArtifactsPlugin = () => ({
	name: "vma:gravity-review-artifacts",
	apply: "serve" as const,
	configureServer(server: ViteDevServer) {
		server.middlewares.use("/__gravity-review", (request, response) => {
			if (!isLoopbackRequestHost(request.headers.host)) {
				response.statusCode = 403;
				response.end();
				return;
			}
			if (request.method !== "GET") {
				response.statusCode = 405;
				response.end();
				return;
			}
			const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
			const slug = pathname.split("/").filter(Boolean).at(-1);
			const relativePath = slug ? gravityReviewArtifacts.get(slug) : undefined;
			const artifactRoot = path.resolve(process.cwd(), "artifacts");
			const artifactPath = relativePath
				? path.resolve(process.cwd(), relativePath)
				: undefined;
			if (
				!artifactPath?.startsWith(`${artifactRoot}${path.sep}`) ||
				!existsSync(artifactPath)
			) {
				response.statusCode = 404;
				response.end();
				return;
			}
			try {
				const stats = statSync(artifactPath);
				if (!stats.isFile() || stats.size > MAX_GRAVITY_REVIEW_PROJECT_BYTES) {
					response.statusCode = 404;
					response.end();
					return;
				}
				const payload = readFileSync(artifactPath, "utf8");
				const parsed = JSON.parse(payload) as {
					kind?: unknown;
					version?: unknown;
				};
				if (
					parsed.kind !== "vector-motion-author.project-backup" ||
					parsed.version !== 1
				) {
					response.statusCode = 404;
					response.end();
					return;
				}
				response.setHeader("cache-control", "no-store");
				response.setHeader("content-type", "application/json; charset=utf-8");
				response.end(payload);
			} catch {
				response.statusCode = 404;
				response.end();
			}
		});
	},
});

// https://vite.dev/config/
// Public (no Cloudflare) config. `extraPlugins` lets vite.config.cloud.ts
// insert the `cloudflare()` plugin (+ its dist cleanup) at the same slot it
// occupied before this split, preserving plugin order for the cloud build.
export const defaultExtensionRoot = fileURLToPath(
	new URL("./src/app/ext", import.meta.url),
);

export const createBaseConfig = (
	extraPlugins: PluginOption[] = [],
	options: { extensionRoot?: string } = {},
) =>
	defineConfig({
		plugins: [
			react(),
			...(reactCompilerPilotEnabled
				? [
						babel({
							include: reactCompilerPilotInclude,
							plugins: [
								[
									"babel-plugin-react-compiler",
									{ compilationMode: "annotation" },
								],
							],
						}),
					]
				: []),
			tailwindcss(),
			...extraPlugins,
			agentBridgeDiscoveryPlugin(),
			programSurfaceBridgeDiscoveryPlugin(),
			gravityReviewArtifactsPlugin(),
		],
		server: {
			port: devPort,
			strictPort: true,
			warmup: {
				clientFiles: [
					"src/app/App.tsx",
					"src/pages/editor/ui/EditorPage.tsx",
					"src/widgets/canvas-shell/ui/CanvasShell.tsx",
				],
			},
			...(allowedHosts ? { allowedHosts } : {}),
		},
		build: {
			manifest: true,
		},
		resolve: {
			alias: {
				"@": fileURLToPath(new URL("./src", import.meta.url)),
				"@vecmo-ext": options.extensionRoot ?? defaultExtensionRoot,
				"@polar-sh/checkout/embed": polarCheckoutEmbedEntry,
				"@polar-sh/checkout/payment-method": polarCheckoutPaymentMethodEntry,
			},
		},
	});

export default createBaseConfig();
