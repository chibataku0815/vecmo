/**
 * Local Blender companion for the linked-production contract (S1-C).
 *
 * Run:
 *   bun scripts/blender-link-companion.ts \
 *     --source <absolute .blend path> [--source <...>] \
 *     [--port 43219] [--editor-origin http://localhost:5173] [--blender <path>]
 *
 * It binds 127.0.0.1 only, prints one short-lived pairing token to the terminal,
 * and speaks the typed protocol in
 * `src/entities/scene/model/production-link-protocol.ts`.
 *
 * The disciplines this process is responsible for:
 *
 * - No absolute path ever leaves it. Sources are addressed by companion-minted
 *   opaque tokens; every editor-bound packet carries a basename-style display
 *   name that the protocol's own `isProductionLinkDisplayName` guard re-checks.
 * - Every request is fenced. A request whose `{editorInstanceId, workingCopyId,
 *   bindingEpoch}` tuple or `linkId` does not match the bound target is
 *   rejected, not applied to the current binding.
 * - Nothing is trusted from the document. Every build re-inspects the source
 *   first and refuses to export when the observed digest moved since the
 *   inspect the editor derived its key from.
 * - Build keys are derived by the SINGLE implementation in
 *   `entities/scene/model/production-artifacts.ts`, imported here rather than
 *   re-ported, so a canonicalization divergence cannot masquerade as drift.
 * - Artifacts never travel inline. The build result carries metadata plus a
 *   one-time fetch token; the bytes leave over a bounded HTTP GET.
 */

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	canonicalProductionJson,
	PRODUCTION_ARTIFACT_ADAPTER_VERSION,
	productionDigestOfBytes,
	productionDigestOfText,
	productionSourceClosureDigest,
} from "../src/entities/scene/model/production-artifacts";
import type {
	AllowlistedBindingDescriptor,
	ExternalProductionOutputProfile,
	PublishedControl,
} from "../src/entities/scene/model/production-link";
import {
	encodeProductionLinkMessage,
	PRODUCTION_LINK_ARTIFACT_PATH,
	PRODUCTION_LINK_DEFAULT_PORT,
	PRODUCTION_LINK_DISCOVERY_PATH,
	PRODUCTION_LINK_ERROR_CODE,
	PRODUCTION_LINK_MAX_ARTIFACT_BYTES,
	PRODUCTION_LINK_MAX_PUBLISHED_CONTROLS,
	PRODUCTION_LINK_PROTOCOL_VERSION,
	type ProductionLinkClientMessage,
	type ProductionLinkDiagnosticCode,
	type ProductionLinkEditorTarget,
	type ProductionLinkServerMessage,
	parseProductionLinkClientMessage,
	productionLinkTargetIsCurrentOrNewer,
} from "../src/entities/scene/model/production-link-protocol";

const DEFAULT_BLENDER_BINARY = "/opt/homebrew/bin/blender";
const DEFAULT_EDITOR_ORIGIN = "http://localhost:5173";
const LOOPBACK_HOST = "127.0.0.1";
const INSPECT_TIMEOUT_MS = 120_000;
const EXPORT_TIMEOUT_MS = 600_000;
const PAIRING_TOKEN_BYTES = 32;
const FETCH_TOKEN_BYTES = 32;
const ARTIFACT_MIME_TYPE = "model/gltf-binary";
const ARTIFACT_TOKEN_HEADER = "x-vecmo-artifact-token";
const BLEND_SUFFIX = ".blend";
const HEX_RADIX = 16;
const HEX_PAIR_WIDTH = 2;
const SCRIPT_DIR = path.join(import.meta.dir, "blender-link-companion");
const INSPECT_SCRIPT = path.join(SCRIPT_DIR, "inspect.py");
const EXPORT_SCRIPT = path.join(SCRIPT_DIR, "export_glb.py");

type SourceRegistration = {
	readonly localPathToken: string;
	readonly absolutePath: string;
	readonly displayName: string;
};

type Binding = {
	readonly bindingId: string;
	readonly linkId: string;
	readonly source: SourceRegistration;
	readonly target: ProductionLinkEditorTarget;
	lastInspectedSourceDigest?: string;
};

type ArtifactHandout = {
	readonly fetchToken: string;
	readonly filePath: string;
	readonly byteLength: number;
	readonly artifactDigest: string;
};

type InspectManifest = {
	readonly blender: {
		readonly versionString: string;
		readonly buildDate: string;
		readonly buildHash: string;
		readonly buildPlatform: string;
	};
	readonly host: { readonly platform: string; readonly machine: string };
	readonly environment: { readonly enabledAddons: readonly string[] };
	readonly scene: {
		readonly fps: number;
		readonly durationFrames: number;
		readonly frameStart: number;
	};
	readonly render: Record<string, unknown>;
	readonly publishedControlCandidates: readonly Record<string, unknown>[];
	readonly gltfSignals: Record<string, unknown>;
	readonly linkedLibraryCount: number;
	readonly externalDependencies: {
		readonly contentDigests: readonly string[];
		readonly missingCount: number;
	};
};

type InspectOutcome = {
	readonly manifest: InspectManifest;
	readonly sourceDigest: string;
	readonly environmentDigest: string;
	readonly renderSettingsDigest: string;
	readonly outputProfile: ExternalProductionOutputProfile;
	readonly controls: readonly PublishedControl[];
};

const randomToken = (byteLength: number): string => {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return Buffer.from(bytes).toString("base64url");
};

const randomIdentifier = (): string => {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (byte) =>
		byte.toString(HEX_RADIX).padStart(HEX_PAIR_WIDTH, "0"),
	).join("");
};

const argValues = (flag: string): readonly string[] => {
	const values: string[] = [];
	for (let index = 0; index < Bun.argv.length; index += 1) {
		if (Bun.argv[index] !== flag) continue;
		const value = Bun.argv[index + 1];
		if (value) values.push(value);
	}
	return values;
};

const argValue = (flag: string, fallback: string): string =>
	argValues(flag)[0] ?? fallback;

/**
 * Runs one Blender invocation. `--python-exit-code 1` is not optional: without
 * it a raising script still exits 0, and a silent failure would be reported as
 * a successful build.
 */
const runBlender = async (
	binary: string,
	args: readonly string[],
	timeoutMs: number,
): Promise<{ readonly ok: boolean; readonly timedOut: boolean }> => {
	const proc = Bun.spawn(
		[
			binary,
			"--background",
			"--factory-startup",
			"--python-exit-code",
			"1",
			...args,
		],
		{
			stdout: "pipe",
			stderr: "pipe",
			signal: AbortSignal.timeout(timeoutMs),
		},
	);
	try {
		const exitCode = await proc.exited;
		// Detail stays process-local: it can name paths and source text.
		const stderr = (await new Response(proc.stderr).text()).trim();
		if (exitCode !== 0 && stderr.length > 0) {
			console.error(`[production-link] adapter stderr:\n${stderr}`);
		}
		return { ok: exitCode === 0, timedOut: false };
	} catch {
		proc.kill();
		return { ok: false, timedOut: true };
	}
};

const GLTF_DISQUALIFIERS = [
	"hasDrivers",
	"hasParticleSystems",
	"hasPhysics",
	"hasSimulationNodes",
	"usesProceduralTexturesOnly",
] as const;

/**
 * Fail closed: an unknown or missing representability signal forces the
 * rendered profile. Design section 9 forbids silently degrading an unsupported
 * source into GLB.
 */
const resolveOutputProfile = (
	manifest: InspectManifest,
): ExternalProductionOutputProfile => {
	const signals = manifest.gltfSignals;
	for (const key of GLTF_DISQUALIFIERS) {
		if (typeof signals[key] !== "boolean" || signals[key] === true) {
			return "rendered-rgba-sequence";
		}
	}
	if (
		!Array.isArray(signals.unknownSignals) ||
		signals.unknownSignals.length > 0
	) {
		return "rendered-rgba-sequence";
	}
	if (manifest.linkedLibraryCount > 0) return "rendered-rgba-sequence";
	if (manifest.externalDependencies.missingCount > 0) {
		return "rendered-rgba-sequence";
	}
	return "interactive-glb";
};

const CONTROL_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/iu;
const PROPERTY_NAME_PATTERN = /^[a-z_][a-z0-9_]{0,63}$/iu;
const UNSAFE_NAME_CHARACTERS = new Set(["[", "]", '"', "'", "\\", "/"]);

const bindingDescriptor = (
	candidate: Record<string, unknown>,
): AllowlistedBindingDescriptor | null => {
	const ownerType =
		candidate.ownerType === "Scene"
			? "SCENE"
			: candidate.ownerType === "Object"
				? "OBJECT"
				: null;
	const ownerName = candidate.ownerName;
	const propertyName = candidate.name;
	if (
		!ownerType ||
		typeof ownerName !== "string" ||
		typeof propertyName !== "string"
	) {
		return null;
	}
	if (
		[...ownerName].some((character) => UNSAFE_NAME_CHARACTERS.has(character))
	) {
		return null;
	}
	if (!PROPERTY_NAME_PATTERN.test(propertyName)) return null;
	return { kind: "custom-property", ownerType, ownerName, propertyName };
};

/**
 * Maps inspected candidates to the V1 published-control contract. A candidate
 * whose default came from Blender's fabricated `0.0` keeps the property's own
 * observed value as its default and stays flagged ambiguous, so the editor can
 * refuse to treat it as an authored fallback.
 */
const publishedControls = (
	manifest: InspectManifest,
): readonly PublishedControl[] => {
	const controls: PublishedControl[] = [];
	const seen = new Set<string>();
	for (const candidate of manifest.publishedControlCandidates) {
		if (controls.length >= PRODUCTION_LINK_MAX_PUBLISHED_CONTROLS) break;
		const id = candidate.name;
		if (typeof id !== "string" || !CONTROL_ID_PATTERN.test(id)) continue;
		if (seen.has(id)) continue;
		const blenderBinding = bindingDescriptor(candidate);
		if (!blenderBinding) continue;
		const rangeDeclared = candidate.rangeDeclared === true;
		const defaultIsAmbiguous = candidate.defaultIsAmbiguous !== false;
		const declaredDefault = candidate.default;
		const observedValue = candidate.value;
		const defaultValue =
			!defaultIsAmbiguous && typeof declaredDefault === "number"
				? declaredDefault
				: typeof observedValue === "number"
					? observedValue
					: null;
		if (defaultValue === null || !Number.isFinite(defaultValue)) continue;
		const min =
			rangeDeclared && typeof candidate.min === "number"
				? candidate.min
				: undefined;
		const max =
			rangeDeclared && typeof candidate.max === "number"
				? candidate.max
				: undefined;
		seen.add(id);
		controls.push({
			id,
			label: id,
			valueType: "number",
			unit: "scalar",
			defaultValue,
			...(min === undefined ? {} : { min }),
			...(max === undefined ? {} : { max }),
			rangeDeclared,
			defaultIsAmbiguous,
			blenderBinding,
		});
	}
	return controls;
};

const main = async (): Promise<void> => {
	const port = Number(argValue("--port", String(PRODUCTION_LINK_DEFAULT_PORT)));
	const editorOrigin = argValue("--editor-origin", DEFAULT_EDITOR_ORIGIN);
	const blenderBinary = argValue("--blender", DEFAULT_BLENDER_BINARY);
	const sourcePaths = argValues("--source");
	if (sourcePaths.length === 0) {
		throw new Error(
			"blender-link-companion requires at least one --source <absolute .blend path>",
		);
	}

	const sources = new Map<string, SourceRegistration>();
	for (const candidate of sourcePaths) {
		const absolutePath = path.resolve(candidate);
		if (!absolutePath.endsWith(BLEND_SUFFIX)) {
			throw new Error("blender-link-companion accepts .blend sources only");
		}
		const info = await stat(absolutePath);
		if (!info.isFile()) {
			throw new Error("blender-link-companion source is not a regular file");
		}
		const registration: SourceRegistration = {
			localPathToken: randomToken(FETCH_TOKEN_BYTES),
			absolutePath,
			displayName: path.basename(absolutePath),
		};
		sources.set(registration.localPathToken, registration);
	}

	const companionId = randomIdentifier();
	const pairingToken = randomToken(PAIRING_TOKEN_BYTES);
	const startedAt = new Date().toISOString();
	const workDirectory = await mkdtemp(
		path.join(tmpdir(), `vecmo-production-link-${companionId}-`),
	);

	let sessionId: string | null = null;
	let sessionTarget: ProductionLinkEditorTarget | null = null;
	/**
	 * The pairing token is single-use. Reconnecting after a page reload
	 * therefore requires a fresh companion approval, which is exactly the
	 * design's stated constraint that companion approval does not survive a
	 * reload. Making it reusable would hide that in the UI.
	 */
	let pairingTokenConsumed = false;
	let binding: Binding | null = null;
	let busy = false;
	const cancelledRequests = new Set<string>();
	const handouts = new Map<string, ArtifactHandout>();

	const send = (
		ws: { send: (data: string) => number },
		message: ProductionLinkServerMessage,
	): void => {
		ws.send(encodeProductionLinkMessage(message));
	};

	const reject = (ws: { send: (data: string) => number }): void => {
		send(ws, { kind: "error", code: PRODUCTION_LINK_ERROR_CODE });
	};

	/**
	 * The fence check. A well-formed tuple is a claim; only an owner match plus
	 * a not-older binding epoch is an authorization.
	 *
	 * Acceptance advances `sessionTarget` to the accepted epoch. That monotone
	 * re-stamp is the whole point: the editor's binding epoch moves whenever it
	 * re-points a link at a different source, and this session paired at the
	 * epoch that was current at pairing time. Demanding exact equality made the
	 * first relink of a live session unauthorizable forever, because the pairing
	 * token is single use and could not mint a second session. Re-stamping
	 * forward keeps the real guarantee — an in-flight authorization minted
	 * before the advance carries a strictly lower epoch and is still rejected,
	 * and the fence never moves backwards.
	 */
	const fenceAccepts = (
		message: ProductionLinkClientMessage,
		linkId?: string,
	): boolean => {
		if (!sessionId || !sessionTarget) return false;
		if (!("sessionId" in message) || message.sessionId !== sessionId)
			return false;
		if (!productionLinkTargetIsCurrentOrNewer(message.target, sessionTarget)) {
			return false;
		}
		// A link-scoped operation additionally has to be no older than the
		// binding it names, so a result authorized against a superseded binding
		// cannot be applied to the current one.
		if (
			linkId !== undefined &&
			!(
				binding &&
				binding.linkId === linkId &&
				productionLinkTargetIsCurrentOrNewer(message.target, binding.target)
			)
		) {
			return false;
		}
		sessionTarget = message.target;
		return true;
	};

	const inspectSource = async (
		source: SourceRegistration,
	): Promise<InspectOutcome | ProductionLinkDiagnosticCode> => {
		const manifestPath = path.join(
			workDirectory,
			`inspect-${randomIdentifier()}.json`,
		);
		const run = await runBlender(
			blenderBinary,
			[
				source.absolutePath,
				"--python",
				INSPECT_SCRIPT,
				"--",
				"--out",
				manifestPath,
			],
			INSPECT_TIMEOUT_MS,
		);
		if (!run.ok) {
			return run.timedOut
				? "production-link-adapter-timeout"
				: "production-link-inspect-failed";
		}
		let manifest: InspectManifest;
		let blendBytes: Buffer;
		try {
			manifest = JSON.parse(
				await readFile(manifestPath, "utf8"),
			) as InspectManifest;
			blendBytes = await readFile(source.absolutePath);
		} catch {
			return "production-link-source-unreadable";
		} finally {
			await rm(manifestPath, { force: true });
		}
		const blendDigest = await productionDigestOfBytes(
			new Uint8Array(blendBytes),
		);
		if (!blendDigest) return "production-link-inspect-failed";
		const sourceDigest = await productionSourceClosureDigest(
			blendDigest,
			manifest.externalDependencies.contentDigests,
		);
		const environmentDigest = await productionDigestOfText(
			canonicalProductionJson({
				blenderVersionString: manifest.blender.versionString,
				blenderBuildDate: manifest.blender.buildDate,
				blenderBuildHash: manifest.blender.buildHash,
				blenderBuildPlatform: manifest.blender.buildPlatform,
				enabledAddons: [...manifest.environment.enabledAddons].sort(),
				hostPlatform: manifest.host.platform,
				hostMachine: manifest.host.machine,
			}),
		);
		const renderSettingsDigest = await productionDigestOfText(
			canonicalProductionJson(manifest.render),
		);
		if (!sourceDigest || !environmentDigest || !renderSettingsDigest) {
			return "production-link-inspect-failed";
		}
		return {
			manifest,
			sourceDigest,
			environmentDigest,
			renderSettingsDigest,
			outputProfile: resolveOutputProfile(manifest),
			controls: publishedControls(manifest),
		};
	};

	const exportArtifact = async (
		source: SourceRegistration,
	): Promise<ArtifactHandout | ProductionLinkDiagnosticCode> => {
		// The destination lives in the companion's own temp directory, never near
		// the user's source: Blender writes `.blend1` siblings beside whatever it
		// saves, and an artifact path inside the workspace is one refactor away
		// from mutating it.
		const artifactPath = path.join(
			workDirectory,
			`artifact-${randomIdentifier()}.glb`,
		);
		const run = await runBlender(
			blenderBinary,
			[
				source.absolutePath,
				"--python",
				EXPORT_SCRIPT,
				"--",
				"--out",
				artifactPath,
			],
			EXPORT_TIMEOUT_MS,
		);
		if (!run.ok) {
			await rm(artifactPath, { force: true });
			return run.timedOut
				? "production-link-adapter-timeout"
				: "production-link-build-failed";
		}
		let bytes: Buffer;
		try {
			bytes = await readFile(artifactPath);
		} catch {
			return "production-link-artifact-empty";
		}
		if (
			bytes.byteLength === 0 ||
			bytes.byteLength > PRODUCTION_LINK_MAX_ARTIFACT_BYTES
		) {
			await rm(artifactPath, { force: true });
			return "production-link-artifact-empty";
		}
		const artifactDigest = await productionDigestOfBytes(new Uint8Array(bytes));
		if (!artifactDigest) {
			await rm(artifactPath, { force: true });
			return "production-link-build-failed";
		}
		return {
			fetchToken: randomToken(FETCH_TOKEN_BYTES),
			filePath: artifactPath,
			byteLength: bytes.byteLength,
			artifactDigest,
		};
	};

	const handleInspect = async (
		ws: { send: (data: string) => number },
		message: Extract<ProductionLinkClientMessage, { kind: "inspect" }>,
	): Promise<void> => {
		if (!fenceAccepts(message, message.linkId) || !binding || !sessionId) {
			reject(ws);
			return;
		}
		const active = binding;
		busy = true;
		send(ws, {
			kind: "build-status",
			sessionId,
			target: active.target,
			linkId: active.linkId,
			requestId: message.requestId,
			state: "inspecting",
		});
		const outcome = await inspectSource(active.source);
		busy = false;
		if (typeof outcome === "string") {
			send(ws, {
				kind: "build-failed",
				sessionId,
				target: active.target,
				linkId: active.linkId,
				requestId: message.requestId,
				diagnostics: [{ code: outcome }],
			});
			return;
		}
		active.lastInspectedSourceDigest = outcome.sourceDigest;
		send(ws, {
			kind: "inspect-result",
			sessionId,
			target: active.target,
			linkId: active.linkId,
			requestId: message.requestId,
			displayName: active.source.displayName,
			sourceDigest: outcome.sourceDigest,
			environment: {
				blenderVersion: outcome.manifest.blender.versionString,
				environmentDigest: outcome.environmentDigest,
				renderSettingsDigest: outcome.renderSettingsDigest,
			},
			frame: {
				fps: outcome.manifest.scene.fps,
				durationFrames: outcome.manifest.scene.durationFrames,
				blenderFrameStart: outcome.manifest.scene.frameStart,
			},
			outputProfile: outcome.outputProfile,
			controls: outcome.controls,
			diagnostics: [],
		});
	};

	const handleBuild = async (
		ws: { send: (data: string) => number },
		message: Extract<ProductionLinkClientMessage, { kind: "build" }>,
	): Promise<void> => {
		if (!fenceAccepts(message, message.linkId) || !binding || !sessionId) {
			reject(ws);
			return;
		}
		const active = binding;
		const failed = (code: ProductionLinkDiagnosticCode): void => {
			send(ws, {
				kind: "build-failed",
				sessionId: sessionId as string,
				target: active.target,
				linkId: active.linkId,
				requestId: message.requestId,
				diagnostics: [{ code }],
			});
		};
		if (message.outputProfile !== "interactive-glb") {
			failed("production-link-profile-unsupported");
			return;
		}
		busy = true;
		try {
			send(ws, {
				kind: "build-status",
				sessionId,
				target: active.target,
				linkId: active.linkId,
				requestId: message.requestId,
				state: "inspecting",
			});
			// The companion never trusts a descriptor the document handed it. A
			// fresh inspect precedes every export, and a source that moved since
			// the editor derived its key fails closed into an explicit Refresh.
			const outcome = await inspectSource(active.source);
			if (typeof outcome === "string") {
				failed(outcome);
				return;
			}
			if (
				active.lastInspectedSourceDigest &&
				active.lastInspectedSourceDigest !== outcome.sourceDigest
			) {
				failed("production-link-source-drifted");
				return;
			}
			active.lastInspectedSourceDigest = outcome.sourceDigest;
			if (outcome.outputProfile !== "interactive-glb") {
				failed("production-link-profile-unsupported");
				return;
			}
			if (cancelledRequests.delete(message.requestId)) {
				failed("production-link-cancelled");
				return;
			}
			send(ws, {
				kind: "build-status",
				sessionId,
				target: active.target,
				linkId: active.linkId,
				requestId: message.requestId,
				state: "exporting",
			});
			const artifact = await exportArtifact(active.source);
			if (typeof artifact === "string") {
				failed(artifact);
				return;
			}
			if (cancelledRequests.delete(message.requestId)) {
				await rm(artifact.filePath, { force: true });
				failed("production-link-cancelled");
				return;
			}
			handouts.set(artifact.fetchToken, artifact);
			send(ws, {
				kind: "build-result",
				sessionId,
				target: active.target,
				linkId: active.linkId,
				requestId: message.requestId,
				buildKey: message.buildKey,
				artifactDigest: artifact.artifactDigest,
				byteLength: artifact.byteLength,
				fetchToken: artifact.fetchToken,
				// Sound only because `resolveOutputProfile` has already forced the
				// rendered profile for physics, particles, simulation nodes, and
				// drivers. Every source that reaches an interactive GLB export here
				// therefore has no simulation or bake dependency. A future profile
				// that admits those must compute this rather than assert it: the
				// design is explicit that nondeterminism downgrades the claim
				// instead of changing the build key.
				reproducible: true,
				diagnostics: [],
			});
		} finally {
			busy = false;
		}
	};

	const handleMessage = (
		ws: { send: (data: string) => number; close: () => void },
		message: ProductionLinkClientMessage,
	): void => {
		switch (message.kind) {
			case "hello": {
				if (
					sessionId ||
					pairingTokenConsumed ||
					message.token !== pairingToken
				) {
					send(ws, {
						kind: "hello-ack",
						protocol: PRODUCTION_LINK_PROTOCOL_VERSION,
						accepted: false,
					});
					ws.close();
					return;
				}
				pairingTokenConsumed = true;
				sessionId = randomIdentifier();
				sessionTarget = message.target;
				send(ws, {
					kind: "hello-ack",
					protocol: PRODUCTION_LINK_PROTOCOL_VERSION,
					accepted: true,
					sessionId,
					adapterVersion: PRODUCTION_ARTIFACT_ADAPTER_VERSION,
				});
				return;
			}
			case "bind": {
				const source = sources.get(message.localPathToken);
				if (!fenceAccepts(message) || !source || !sessionId) {
					reject(ws);
					return;
				}
				binding = {
					bindingId: randomIdentifier(),
					linkId: message.linkId,
					source,
					target: message.target,
				};
				send(ws, {
					kind: "bind-ack",
					sessionId,
					target: message.target,
					linkId: message.linkId,
					bindingId: binding.bindingId,
					displayName: source.displayName,
				});
				return;
			}
			case "inspect":
				void handleInspect(ws, message);
				return;
			case "build":
				void handleBuild(ws, message);
				return;
			case "cancel":
				if (!fenceAccepts(message, message.linkId)) {
					reject(ws);
					return;
				}
				cancelledRequests.add(message.requestId);
				return;
			case "status":
				if (!fenceAccepts(message) || !sessionId) {
					reject(ws);
					return;
				}
				send(ws, {
					kind: "status-report",
					sessionId,
					bound: Boolean(binding),
					busy,
					...(binding ? { linkId: binding.linkId } : {}),
				});
				return;
			case "disconnect":
				sessionId = null;
				sessionTarget = null;
				binding = null;
				ws.close();
				return;
		}
	};

	const server = Bun.serve<undefined, undefined>({
		port,
		hostname: LOOPBACK_HOST,
		async fetch(request, bunServer) {
			const url = new URL(request.url);
			const origin = request.headers.get("origin");
			// The artifact GET carries a custom `x-vecmo-artifact-token` header, which
			// makes it a non-simple cross-origin request: the browser sends an OPTIONS
			// preflight first and never issues the real GET unless that preflight
			// itself answers with the matching CORS headers. Without this branch the
			// preflight fell through to the artifact-token check below, which read no
			// token from an OPTIONS request and replied 403 with no CORS headers at
			// all — the browser then blocked the GET before this companion ever saw
			// it, surfacing only as an opaque "Failed to fetch" in the editor.
			if (
				request.method === "OPTIONS" &&
				url.pathname === PRODUCTION_LINK_ARTIFACT_PATH
			) {
				if (origin !== null && origin !== editorOrigin) {
					return new Response(null, { status: 403 });
				}
				return new Response(null, {
					status: 204,
					headers: {
						"access-control-allow-origin": editorOrigin,
						"access-control-allow-methods": "GET",
						"access-control-allow-headers": ARTIFACT_TOKEN_HEADER,
						"access-control-max-age": "60",
					},
				});
			}
			if (url.pathname === PRODUCTION_LINK_DISCOVERY_PATH) {
				// Source display names are answered only for the configured editor
				// origin, so an arbitrary page that can reach loopback learns nothing
				// about which files this companion offers.
				if (origin !== null && origin !== editorOrigin) {
					return new Response("origin rejected", { status: 403 });
				}
				return Response.json(
					{
						protocol: PRODUCTION_LINK_PROTOCOL_VERSION,
						companionId,
						port,
						adapterVersion: PRODUCTION_ARTIFACT_ADAPTER_VERSION,
						startedAt,
						sources: [...sources.values()].map((source) => ({
							localPathToken: source.localPathToken,
							displayName: source.displayName,
						})),
					},
					{ headers: { "access-control-allow-origin": editorOrigin } },
				);
			}
			if (url.pathname === PRODUCTION_LINK_ARTIFACT_PATH) {
				if (origin !== null && origin !== editorOrigin) {
					return new Response("origin rejected", { status: 403 });
				}
				const token = request.headers.get(ARTIFACT_TOKEN_HEADER);
				const handout = token ? handouts.get(token) : undefined;
				if (!handout || !token) {
					return new Response("artifact token rejected", { status: 403 });
				}
				// One-time: the token is spent before the body is read, so a replay
				// cannot re-fetch even if the first read fails.
				handouts.delete(token);
				const file = Bun.file(handout.filePath);
				return new Response(file, {
					headers: {
						"content-type": ARTIFACT_MIME_TYPE,
						"content-length": String(handout.byteLength),
						"access-control-allow-origin": editorOrigin,
					},
				});
			}
			if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
				return new Response("production link companion", { status: 404 });
			}
			if (origin !== null && origin !== editorOrigin) {
				return new Response("origin rejected", { status: 403 });
			}
			return bunServer.upgrade(request)
				? undefined
				: new Response("websocket upgrade required", { status: 426 });
		},
		websocket: {
			message(ws, raw) {
				if (typeof raw !== "string") {
					reject(ws);
					ws.close();
					return;
				}
				const parsed = parseProductionLinkClientMessage(raw);
				if (!parsed.ok) {
					reject(ws);
					ws.close();
					return;
				}
				handleMessage(ws, parsed.message);
			},
			close() {
				sessionId = null;
				sessionTarget = null;
				binding = null;
			},
		},
	});

	console.log(
		`[production-link] listening on http://${LOOPBACK_HOST}:${server.port} for ${editorOrigin}`,
	);
	console.log(`[production-link] pairing token: ${pairingToken}`);
	for (const source of sources.values()) {
		console.log(
			`[production-link] source ${source.displayName} token ${source.localPathToken}`,
		);
	}
};

if (import.meta.main) {
	await main();
}
