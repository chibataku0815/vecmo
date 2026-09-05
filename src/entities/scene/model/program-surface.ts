import type {
	ProgramSurfaceAsset,
	ProgramSurfaceDelivery,
	ProgramSurfaceFallback,
	ProgramSurfaceInputPort,
	ProgramSurfaceLocalDigestApproval,
	ProgramSurfaceManifestV1,
	ProgramSurfaceOutput,
	SceneAssetFidelityIssue,
	SceneMediaSource,
} from "./types";

/** V1 keeps individual dimensions bounded before a host allocates GPU memory. */
export const PROGRAM_SURFACE_MAX_OUTPUT_DIMENSION = 8192;

const digestPattern = /^(?:sha256:)?[a-f0-9]{64}$/iu;
const portIdPattern = /^[a-z][a-z0-9_-]{0,63}$/iu;
const windowsAbsolutePathPattern = /^[a-z]:[\\/]/iu;

export type ProgramSurfaceManifestIssueCode =
	| "program-surface-manifest-invalid"
	| "program-surface-runtime-invalid"
	| "program-surface-entry-invalid"
	| "program-surface-digest-invalid"
	| "program-surface-source-invalid"
	| "program-surface-port-invalid"
	| "program-surface-port-duplicate"
	| "program-surface-camera-port-invalid"
	| "program-surface-output-invalid"
	| "program-surface-timing-invalid"
	| "program-surface-delivery-invalid"
	| "program-surface-fallback-required"
	| "program-surface-fallback-invalid"
	| "program-surface-asset-invalid";

export type ProgramSurfaceManifestIssue = SceneAssetFidelityIssue & {
	readonly code: ProgramSurfaceManifestIssueCode;
};

export type ProgramSurfaceManifestParseResult =
	| {
			readonly status: "valid";
			readonly manifest: ProgramSurfaceManifestV1;
			readonly issues: readonly [];
	  }
	| {
			readonly status: "invalid";
			readonly issues: readonly ProgramSurfaceManifestIssue[];
	  };

export type ProgramSurfaceAssetParseResult =
	| {
			readonly status: "valid";
			readonly asset: ProgramSurfaceAsset;
			readonly issues: readonly [];
	  }
	| {
			readonly status: "invalid";
			readonly issues: readonly ProgramSurfaceManifestIssue[];
	  };

export type ProgramSurfaceLocalApprovalState =
	| "approved"
	| "not-approved"
	| "digest-mismatch";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

const isPositiveInteger = (value: unknown): value is number =>
	isFiniteNumber(value) && Number.isInteger(value) && value > 0;

const issue = (
	code: ProgramSurfaceManifestIssueCode,
	message: string,
): ProgramSurfaceManifestIssue => ({ severity: "error", code, message });

const normalizedString = (value: unknown): string | undefined =>
	typeof value === "string" && value.trim().length > 0
		? value.trim()
		: undefined;

const normalizeDigest = (value: unknown): string | undefined => {
	const digest = normalizedString(value)?.toLowerCase();
	return digest && digestPattern.test(digest) ? digest : undefined;
};

const isRelativeBundleEntry = (entry: string): boolean =>
	entry.length <= 256 &&
	!entry.startsWith("/") &&
	!entry.startsWith("\\") &&
	!entry.includes("\\") &&
	!entry.split("/").some((segment) => segment === "..") &&
	!windowsAbsolutePathPattern.test(entry) &&
	!/^\w+:/u.test(entry);

const isInertProgramReference = (reference: string): boolean =>
	!reference.includes("\u0000") &&
	!reference.startsWith("/") &&
	!reference.startsWith("\\") &&
	!reference.startsWith("./") &&
	!reference.startsWith("../") &&
	!reference.startsWith("~/") &&
	!reference.includes("\\") &&
	!reference.split("/").some((segment) => segment === "..") &&
	!windowsAbsolutePathPattern.test(reference) &&
	!/^file:/iu.test(reference);

const parsePort = (
	value: unknown,
	index: number,
): {
	readonly port?: ProgramSurfaceInputPort;
	readonly issues: readonly ProgramSurfaceManifestIssue[];
} => {
	if (!isRecord(value)) {
		return {
			issues: [
				issue(
					"program-surface-port-invalid",
					`Program Surface input ${index + 1} must be an object.`,
				),
			],
		};
	}
	const id = normalizedString(value.id);
	if (!id || !portIdPattern.test(id)) {
		return {
			issues: [
				issue(
					"program-surface-port-invalid",
					`Program Surface input ${index + 1} needs a stable lowercase port id.`,
				),
			],
		};
	}
	const label =
		value.label === undefined ? undefined : normalizedString(value.label);
	if (value.label !== undefined && !label) {
		return {
			issues: [
				issue(
					"program-surface-port-invalid",
					`Program Surface input "${id}" has an invalid label.`,
				),
			],
		};
	}

	switch (value.kind) {
		case "scalar": {
			const defaultValue = value.defaultValue;
			const min = value.min;
			const max = value.max;
			if (
				(defaultValue !== undefined && !isFiniteNumber(defaultValue)) ||
				(min !== undefined && !isFiniteNumber(min)) ||
				(max !== undefined && !isFiniteNumber(max)) ||
				(isFiniteNumber(min) && isFiniteNumber(max) && min > max) ||
				(isFiniteNumber(defaultValue) &&
					isFiniteNumber(min) &&
					defaultValue < min) ||
				(isFiniteNumber(defaultValue) &&
					isFiniteNumber(max) &&
					defaultValue > max)
			) {
				return {
					issues: [
						issue(
							"program-surface-port-invalid",
							`Program Surface scalar input "${id}" has invalid bounds or default value.`,
						),
					],
				};
			}
			return {
				port: {
					id,
					kind: "scalar",
					...(label ? { label } : {}),
					...(defaultValue !== undefined ? { defaultValue } : {}),
					...(min !== undefined ? { min } : {}),
					...(max !== undefined ? { max } : {}),
				},
				issues: [],
			};
		}
		case "color": {
			const defaultValue =
				value.defaultValue === undefined
					? undefined
					: normalizedString(value.defaultValue);
			if (value.defaultValue !== undefined && !defaultValue) {
				return {
					issues: [
						issue(
							"program-surface-port-invalid",
							`Program Surface color input "${id}" has an invalid default value.`,
						),
					],
				};
			}
			return {
				port: {
					id,
					kind: "color",
					...(label ? { label } : {}),
					...(defaultValue ? { defaultValue } : {}),
				},
				issues: [],
			};
		}
		case "asset-texture":
		case "time":
		case "frame":
		case "seed":
		case "pointer":
		case "resolved-scene-camera":
			return {
				port: {
					id,
					kind: value.kind,
					...(label ? { label } : {}),
				},
				issues: [],
			};
		default:
			return {
				issues: [
					issue(
						"program-surface-port-invalid",
						`Program Surface input "${id}" has an unsupported kind.`,
					),
				],
			};
	}
};

const parseOutput = (
	value: unknown,
): {
	readonly output?: ProgramSurfaceOutput;
	readonly issues: readonly ProgramSurfaceManifestIssue[];
} => {
	if (!isRecord(value) || value.kind !== "rgba-texture") {
		return {
			issues: [
				issue(
					"program-surface-output-invalid",
					"Program Surface output must be one RGBA texture.",
				),
			],
		};
	}
	const alphaMode = value.alphaMode;
	const width = value.width;
	const height = value.height;
	if (alphaMode !== "premultiplied" && alphaMode !== "straight") {
		return {
			issues: [
				issue(
					"program-surface-output-invalid",
					"Program Surface output must declare premultiplied or straight alpha.",
				),
			],
		};
	}
	const normalizedAlphaMode: ProgramSurfaceOutput["alphaMode"] = alphaMode;
	if (
		!isPositiveInteger(width) ||
		!isPositiveInteger(height) ||
		width > PROGRAM_SURFACE_MAX_OUTPUT_DIMENSION ||
		height > PROGRAM_SURFACE_MAX_OUTPUT_DIMENSION
	) {
		return {
			issues: [
				issue(
					"program-surface-output-invalid",
					`Program Surface output dimensions must be positive integers up to ${PROGRAM_SURFACE_MAX_OUTPUT_DIMENSION}.`,
				),
			],
		};
	}
	return {
		output: {
			kind: "rgba-texture",
			alphaMode: normalizedAlphaMode,
			width,
			height,
		},
		issues: [],
	};
};

const parseDelivery = (
	value: unknown,
): {
	readonly delivery?: ProgramSurfaceDelivery;
	readonly issues: readonly ProgramSurfaceManifestIssue[];
} => {
	if (!isRecord(value)) {
		return {
			issues: [
				issue(
					"program-surface-delivery-invalid",
					"Program Surface delivery capability matrix is required.",
				),
			],
		};
	}
	const editor = value.editor;
	const webglPlayer = value.webglPlayer;
	const svgPdf = value.svgPdf;
	const video = value.video;
	if (
		(editor !== "live" && editor !== "fallback") ||
		(webglPlayer !== "live" &&
			webglPlayer !== "fallback" &&
			webglPlayer !== "unsupported") ||
		(svgPdf !== "raster-fallback" && svgPdf !== "unsupported") ||
		(video !== "capture" &&
			video !== "raster-fallback" &&
			video !== "unsupported")
	) {
		return {
			issues: [
				issue(
					"program-surface-delivery-invalid",
					"Program Surface delivery contains an unsupported capability state.",
				),
			],
		};
	}
	const normalizedDelivery: ProgramSurfaceDelivery = {
		editor,
		webglPlayer,
		svgPdf,
		video,
	};
	return {
		delivery: normalizedDelivery,
		issues: [],
	};
};

const parseFallback = (
	value: unknown,
): {
	readonly fallback?: ProgramSurfaceFallback;
	readonly issues: readonly ProgramSurfaceManifestIssue[];
} => {
	if (value === undefined) return { issues: [] };
	if (!isRecord(value)) {
		return {
			issues: [
				issue(
					"program-surface-fallback-invalid",
					"Program Surface fallback must name a raster asset.",
				),
			],
		};
	}
	const assetId = normalizedString(value.assetId);
	if (!assetId) {
		return {
			issues: [
				issue(
					"program-surface-fallback-invalid",
					"Program Surface fallback needs an asset id.",
				),
			],
		};
	}
	const frame = value.frame;
	const normalizedFrame =
		frame === undefined
			? undefined
			: isFiniteNumber(frame) && frame >= 0 && Number.isInteger(frame)
				? frame
				: null;
	if (frame !== undefined && normalizedFrame === null) {
		return {
			issues: [
				issue(
					"program-surface-fallback-invalid",
					"Program Surface fallback frame must be a non-negative integer.",
				),
			],
		};
	}
	return {
		fallback: {
			assetId,
			...(typeof normalizedFrame === "number"
				? { frame: normalizedFrame }
				: {}),
		},
		issues: [],
	};
};

/**
 * Parses and canonicalizes the durable V1 declaration without loading or
 * executing its source. Invalid values return typed fidelity issues rather than
 * a permissive object that a future host might accidentally trust.
 */
export function parseProgramSurfaceManifest(
	value: unknown,
): ProgramSurfaceManifestParseResult {
	if (!isRecord(value) || value.schemaVersion !== 1) {
		return {
			status: "invalid",
			issues: [
				issue(
					"program-surface-manifest-invalid",
					"Program Surface manifest must be a schemaVersion 1 object.",
				),
			],
		};
	}

	const issues: ProgramSurfaceManifestIssue[] = [];
	const runtime = isRecord(value.runtime) ? value.runtime : undefined;
	const entry = runtime ? normalizedString(runtime.entry) : undefined;
	const compiledDigest = runtime
		? normalizeDigest(runtime.compiledDigest)
		: undefined;
	if (runtime?.kind !== "webgl2") {
		issues.push(
			issue(
				"program-surface-runtime-invalid",
				"Program Surface V1 only admits a WebGL2 runtime.",
			),
		);
	}
	if (!entry || !isRelativeBundleEntry(entry)) {
		issues.push(
			issue(
				"program-surface-entry-invalid",
				"Program Surface runtime entry must be a relative bundled module path.",
			),
		);
	}
	if (!compiledDigest) {
		issues.push(
			issue(
				"program-surface-digest-invalid",
				"Program Surface runtime needs a SHA-256 compiled digest.",
			),
		);
	}

	const source = isRecord(value.source) ? value.source : undefined;
	const snapshotDigest = source
		? normalizeDigest(source.snapshotDigest)
		: undefined;
	const rawPortability = source?.portability;
	const portability =
		rawPortability === "self-contained" || rawPortability === "reference-only"
			? rawPortability
			: undefined;
	if (!snapshotDigest || !portability) {
		issues.push(
			issue(
				"program-surface-source-invalid",
				"Program Surface source needs a SHA-256 snapshot digest and portability mode.",
			),
		);
	}

	if (!Array.isArray(value.inputs)) {
		issues.push(
			issue(
				"program-surface-port-invalid",
				"Program Surface inputs must be an array of typed ports.",
			),
		);
	}
	const inputs: ProgramSurfaceInputPort[] = [];
	const seenPortIds = new Set<string>();
	for (const [index, candidate] of (Array.isArray(value.inputs)
		? value.inputs
		: []
	).entries()) {
		const parsed = parsePort(candidate, index);
		issues.push(...parsed.issues);
		if (!parsed.port) continue;
		if (seenPortIds.has(parsed.port.id)) {
			issues.push(
				issue(
					"program-surface-port-duplicate",
					`Program Surface input "${parsed.port.id}" is declared more than once.`,
				),
			);
			continue;
		}
		seenPortIds.add(parsed.port.id);
		inputs.push(parsed.port);
	}

	const output = parseOutput(value.output);
	issues.push(...output.issues);
	const timing = isRecord(value.timing) ? value.timing : undefined;
	const seed = timing?.seed;
	const deterministicAtFrame = timing?.deterministicAtFrame;
	if (!isFiniteNumber(seed) || typeof deterministicAtFrame !== "boolean") {
		issues.push(
			issue(
				"program-surface-timing-invalid",
				"Program Surface timing needs a finite seed and deterministicAtFrame flag.",
			),
		);
	}
	const space = isRecord(value.space) ? value.space : undefined;
	const rawCameraSpacePolicy = space?.cameraSpacePolicy;
	const cameraSpacePolicy =
		rawCameraSpacePolicy === "screen_2d" ||
		rawCameraSpacePolicy === "resolved-scene-camera"
			? rawCameraSpacePolicy
			: undefined;
	if (!cameraSpacePolicy) {
		issues.push(
			issue(
				"program-surface-camera-port-invalid",
				"Program Surface must declare screen_2d or resolved-scene-camera space.",
			),
		);
	}
	const cameraPortCount = inputs.filter(
		(port) => port.kind === "resolved-scene-camera",
	).length;
	if (
		(cameraSpacePolicy === "screen_2d" && cameraPortCount > 0) ||
		(cameraSpacePolicy === "resolved-scene-camera" && cameraPortCount !== 1)
	) {
		issues.push(
			issue(
				"program-surface-camera-port-invalid",
				"Program Surface camera policy and resolved-scene-camera port must agree.",
			),
		);
	}

	const delivery = parseDelivery(value.delivery);
	issues.push(...delivery.issues);
	const fallback = parseFallback(value.fallback);
	issues.push(...fallback.issues);
	// A declaration may be placed and preserved before an author attaches its
	// raster fallback. Fallback readiness is an activation gate in the asset
	// read model and local approval flow, not a reason to reject an inert manual
	// import or legacy document during durable parsing.

	if (
		issues.length > 0 ||
		!runtime ||
		runtime.kind !== "webgl2" ||
		!entry ||
		!compiledDigest ||
		!snapshotDigest ||
		!portability ||
		!output.output ||
		!isFiniteNumber(seed) ||
		typeof deterministicAtFrame !== "boolean" ||
		!cameraSpacePolicy ||
		!delivery.delivery
	) {
		return { status: "invalid", issues };
	}

	return {
		status: "valid",
		manifest: {
			schemaVersion: 1,
			runtime: { kind: "webgl2", entry, compiledDigest },
			source: { snapshotDigest, portability },
			inputs,
			output: output.output,
			timing: {
				seed,
				deterministicAtFrame,
			},
			space: { cameraSpacePolicy },
			delivery: delivery.delivery,
			...(fallback.fallback ? { fallback: fallback.fallback } : {}),
		},
		issues: [],
	};
}

const parseSource = (
	value: unknown,
	portability: ProgramSurfaceManifestV1["source"]["portability"],
): {
	readonly source?: SceneMediaSource;
	readonly issues: readonly ProgramSurfaceManifestIssue[];
} => {
	if (!isRecord(value)) {
		return {
			issues: [
				issue(
					"program-surface-source-invalid",
					"Program Surface asset source is required.",
				),
			],
		};
	}
	if (value.kind === "data-url") {
		const dataUrl = normalizedString(value.dataUrl);
		if (!dataUrl || !/^data:/iu.test(dataUrl)) {
			return {
				issues: [
					issue(
						"program-surface-source-invalid",
						"Program Surface embedded source must be a data URL snapshot.",
					),
				],
			};
		}
		if (portability !== "self-contained") {
			return {
				issues: [
					issue(
						"program-surface-source-invalid",
						"A data URL Program Surface source must declare self-contained portability.",
					),
				],
			};
		}
		return { source: { kind: "data-url", dataUrl }, issues: [] };
	}
	if (value.kind === "reference") {
		const href = normalizedString(value.href);
		if (!href || !isInertProgramReference(href)) {
			return {
				issues: [
					issue(
						"program-surface-source-invalid",
						"Program Surface reference source may not serialize a filesystem path.",
					),
				],
			};
		}
		if (portability !== "reference-only") {
			return {
				issues: [
					issue(
						"program-surface-source-invalid",
						"A referenced Program Surface source must declare reference-only portability.",
					),
				],
			};
		}
		return { source: { kind: "reference", href }, issues: [] };
	}
	return {
		issues: [
			issue(
				"program-surface-source-invalid",
				"Program Surface source must be an embedded snapshot or inert reference.",
			),
		],
	};
};

const parsePersistedIssues = (
	value: unknown,
): readonly SceneAssetFidelityIssue[] | undefined => {
	if (!Array.isArray(value)) return undefined;
	const issues = value.flatMap((candidate): SceneAssetFidelityIssue[] => {
		const severity = isRecord(candidate) ? candidate.severity : undefined;
		const code = isRecord(candidate)
			? normalizedString(candidate.code)
			: undefined;
		if (
			!isRecord(candidate) ||
			(severity !== "info" && severity !== "warning" && severity !== "error") ||
			!code
		) {
			return [];
		}
		const message = normalizedString(candidate.message);
		return [
			{
				severity,
				code,
				...(message ? { message } : {}),
			},
		];
	});
	return issues.length > 0 ? issues : undefined;
};

/**
 * Parses a full inert Program Surface asset. This is the durable-document gate:
 * it validates portability and fallback identity but never executes, hashes, or
 * fetches the source package.
 */
export function parseProgramSurfaceAsset(
	value: unknown,
): ProgramSurfaceAssetParseResult {
	if (!isRecord(value) || value.kind !== "program-surface") {
		return {
			status: "invalid",
			issues: [
				issue(
					"program-surface-asset-invalid",
					"Program Surface asset must use the program-surface kind.",
				),
			],
		};
	}
	const id = normalizedString(value.id);
	const name = normalizedString(value.name);
	if (!id || !name) {
		return {
			status: "invalid",
			issues: [
				issue(
					"program-surface-asset-invalid",
					"Program Surface asset needs a stable id and name.",
				),
			],
		};
	}
	const manifest = parseProgramSurfaceManifest(value.manifest);
	if (manifest.status === "invalid") return manifest;
	const source = parseSource(
		value.source,
		manifest.manifest.source.portability,
	);
	const parsedSource = source.source;
	const issues = [...source.issues];
	if (manifest.manifest.fallback?.assetId === id) {
		issues.push(
			issue(
				"program-surface-fallback-invalid",
				"Program Surface fallback may not reference the Program Surface itself.",
			),
		);
	}
	// Fallback availability is intentionally not a durable parse failure. A
	// fallback-less reference from an older document remains inert and gets an
	// explicit activation/read-model issue instead of becoming unloadable.
	if (issues.length > 0 || !parsedSource) {
		return { status: "invalid", issues };
	}
	const mimeType =
		value.mimeType === undefined ? undefined : normalizedString(value.mimeType);
	const persistedIssues = parsePersistedIssues(value.issues);
	return {
		status: "valid",
		asset: {
			id,
			kind: "program-surface",
			name,
			source: parsedSource,
			manifest: manifest.manifest,
			...(mimeType ? { mimeType } : {}),
			width: manifest.manifest.output.width,
			height: manifest.manifest.output.height,
			...(persistedIssues ? { issues: persistedIssues } : {}),
		},
		issues: [],
	};
}

/** Returns the ephemeral approval state without persisting a trust decision. */
export function programSurfaceLocalApprovalState(
	asset: Pick<ProgramSurfaceAsset, "id" | "manifest">,
	approvals: readonly ProgramSurfaceLocalDigestApproval[] | undefined,
): ProgramSurfaceLocalApprovalState {
	const approval = approvals?.find(
		(candidate) => candidate.assetId === asset.id,
	);
	if (!approval) return "not-approved";
	return approval.compiledDigest === asset.manifest.runtime.compiledDigest
		? "approved"
		: "digest-mismatch";
}
