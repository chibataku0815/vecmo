import {
	isImageDataUrl,
	programSurfaceAssetForGeometry,
	programSurfaceAssetReadModel,
} from "@/entities/scene/model/assets";
import type {
	ImageAsset,
	ImageGeometry,
	ProgramSurfaceAsset,
	ProgramSurfaceDelivery,
	ProgramSurfaceLocalDigestApproval,
	SceneDocument,
} from "@/entities/scene/model/types";
import type {
	ExportIssueCategory,
	ExportIssueFallback,
	ExportIssueSeverity,
} from "./issues";

/** Export destinations whose Program Surface delivery must be stated explicitly. */
export type ProgramSurfaceExportTarget =
	| "editor"
	| "motion-code"
	| "webgl-player"
	| "svg"
	| "pdf"
	| "video";

/** The only truthful result states for a bounded Program Surface. */
export type ProgramSurfaceDeliveryRoute =
	| "live"
	| "capture"
	| "raster-fallback"
	| "unsupported";

export type ProgramSurfaceDeliveryIssueCode =
	| "program-surface-asset-missing"
	| "program-surface-manifest-invalid"
	| "program-surface-declared-fallback-required"
	| "program-surface-declared-fallback-invalid"
	| "program-surface-editor-host-unavailable"
	| "program-surface-editor-raster-fallback"
	| "program-surface-motion-code-raster-fallback"
	| "program-surface-static-output-unsupported"
	| "program-surface-webgl-host-unavailable"
	| "program-surface-webgl-raster-fallback"
	| "program-surface-pdf-raster-fallback-unavailable"
	| "program-surface-video-capture-unavailable"
	| "program-surface-video-determinism-required"
	| "program-surface-video-raster-fallback"
	| "program-surface-self-contained-source-required"
	| "program-surface-local-approval-required"
	| "program-surface-svg-raster-fallback";

/** Typed, source-safe explanation for one delivery decision. */
export type ProgramSurfaceDeliveryIssue = {
	readonly severity: Extract<ExportIssueSeverity, "warning" | "error">;
	readonly category: Extract<
		ExportIssueCategory,
		"fallback" | "invalid" | "unsupported"
	>;
	readonly code: ProgramSurfaceDeliveryIssueCode;
	readonly message: string;
	readonly fallback: ExportIssueFallback;
	readonly assetId: string;
};

/**
 * Export-safe projection of the durable asset contract. It deliberately omits
 * source bytes, document handles, local paths, and any execution capability.
 */
export type ProgramSurfaceExportDescriptor = {
	readonly assetId: string;
	readonly compiledDigest: string;
	readonly sourcePortability: "self-contained" | "reference-only";
	readonly output: ProgramSurfaceAsset["manifest"]["output"];
	readonly timing: ProgramSurfaceAsset["manifest"]["timing"];
	readonly cameraSpacePolicy: ProgramSurfaceAsset["manifest"]["space"]["cameraSpacePolicy"];
	readonly delivery: ProgramSurfaceDelivery;
	readonly fallback?: ProgramSurfaceAsset["manifest"]["fallback"];
};

/** A named raster fallback that has been validated without executing program code. */
export type ProgramSurfaceRasterFallback = {
	readonly assetId: string;
	readonly frame?: number;
	readonly href: string;
	readonly asset: ImageAsset;
};

export type ProgramSurfaceFallbackResolution =
	| {
			readonly state: "ready";
			readonly fallback: ProgramSurfaceRasterFallback;
	  }
	| {
			readonly state: "not-required" | "not-declared" | "missing" | "invalid";
			readonly assetId?: string;
			readonly frame?: number;
	  };

/**
 * Runtime facts are ephemeral. In particular, local digest approval is not a
 * SceneDocument field and cannot be granted by an imported document.
 */
export type ProgramSurfaceDeliveryCapabilities = {
	readonly editorHost: boolean;
	readonly isolatedWebglPlayerHost: boolean;
	readonly videoCaptureHost: boolean;
};

/** Current V1 implementation facts. Future hosts must opt in explicitly. */
export const PROGRAM_SURFACE_V1_EXPORT_CAPABILITIES = {
	editorHost: false,
	isolatedWebglPlayerHost: false,
	videoCaptureHost: false,
} as const satisfies ProgramSurfaceDeliveryCapabilities;

export type ProgramSurfaceDeliveryEnvironment = {
	readonly capabilities?: ProgramSurfaceDeliveryCapabilities;
	readonly localApproval?: "approved" | "not-approved" | "digest-mismatch";
};

export type ProgramSurfaceDeliveryDecision = {
	readonly assetId: string;
	readonly target: ProgramSurfaceExportTarget;
	readonly route: ProgramSurfaceDeliveryRoute;
	readonly compiledDigest?: string;
	readonly fallback?: ProgramSurfaceRasterFallback;
	readonly issue?: ProgramSurfaceDeliveryIssue;
};

export type ResolveProgramSurfaceDeliveryForGeometryInput = {
	readonly document: Pick<SceneDocument, "assets">;
	readonly geometry: ImageGeometry;
	readonly target: ProgramSurfaceExportTarget;
	readonly localDigestApprovals?: readonly ProgramSurfaceLocalDigestApproval[];
	readonly capabilities?: ProgramSurfaceDeliveryCapabilities;
};

const issue = (
	assetId: string,
	code: ProgramSurfaceDeliveryIssueCode,
	message: string,
	category: ProgramSurfaceDeliveryIssue["category"],
	fallback: ExportIssueFallback,
	severity: ProgramSurfaceDeliveryIssue["severity"] = "warning",
): ProgramSurfaceDeliveryIssue => ({
	assetId,
	code,
	message,
	category,
	fallback,
	severity,
});

const unsupported = (
	asset: {
		readonly assetId: string;
		readonly compiledDigest?: string;
	},
	target: ProgramSurfaceExportTarget,
	issueValue: ProgramSurfaceDeliveryIssue,
): ProgramSurfaceDeliveryDecision => ({
	assetId: asset.assetId,
	target,
	route: "unsupported",
	...(asset.compiledDigest ? { compiledDigest: asset.compiledDigest } : {}),
	issue: issueValue,
});

const fallback = (
	descriptor: Pick<
		ProgramSurfaceExportDescriptor,
		"assetId" | "compiledDigest"
	>,
	target: ProgramSurfaceExportTarget,
	rasterFallback: ProgramSurfaceRasterFallback,
	issueValue: ProgramSurfaceDeliveryIssue,
): ProgramSurfaceDeliveryDecision => ({
	assetId: descriptor.assetId,
	target,
	route: "raster-fallback",
	compiledDigest: descriptor.compiledDigest,
	fallback: rasterFallback,
	issue: issueValue,
});

const live = (
	descriptor: Pick<
		ProgramSurfaceExportDescriptor,
		"assetId" | "compiledDigest"
	>,
	target: Extract<ProgramSurfaceExportTarget, "editor" | "webgl-player">,
): ProgramSurfaceDeliveryDecision => ({
	assetId: descriptor.assetId,
	target,
	route: "live",
	compiledDigest: descriptor.compiledDigest,
});

const capture = (
	descriptor: Pick<
		ProgramSurfaceExportDescriptor,
		"assetId" | "compiledDigest"
	>,
): ProgramSurfaceDeliveryDecision => ({
	assetId: descriptor.assetId,
	target: "video",
	route: "capture",
	compiledDigest: descriptor.compiledDigest,
});

/** Lowers a valid durable asset to the minimal input accepted by export policy. */
export const lowerProgramSurfaceExportDescriptor = (
	asset: ProgramSurfaceAsset,
): ProgramSurfaceExportDescriptor => ({
	assetId: asset.id,
	compiledDigest: asset.manifest.runtime.compiledDigest,
	sourcePortability: asset.manifest.source.portability,
	output: asset.manifest.output,
	timing: asset.manifest.timing,
	cameraSpacePolicy: asset.manifest.space.cameraSpacePolicy,
	delivery: asset.manifest.delivery,
	...(asset.manifest.fallback ? { fallback: asset.manifest.fallback } : {}),
});

const fallbackUnavailable = (
	descriptor: ProgramSurfaceExportDescriptor,
	target: ProgramSurfaceExportTarget,
	fallbackResolution: ProgramSurfaceFallbackResolution,
): ProgramSurfaceDeliveryDecision => {
	const needsNamedFallback = !descriptor.fallback;
	const namedAsset =
		fallbackResolution.state === "ready"
			? fallbackResolution.fallback.assetId
			: (fallbackResolution.assetId ?? descriptor.fallback?.assetId);
	return unsupported(
		descriptor,
		target,
		issue(
			descriptor.assetId,
			needsNamedFallback
				? "program-surface-declared-fallback-required"
				: "program-surface-declared-fallback-invalid",
			needsNamedFallback
				? `Program Surface "${descriptor.assetId}" requires an explicitly named raster fallback for ${target} output.`
				: `Program Surface "${descriptor.assetId}" cannot use declared fallback "${namedAsset ?? "unknown"}" for ${target} output.`,
			needsNamedFallback ? "unsupported" : "invalid",
			"vector-placeholder",
			needsNamedFallback ? "warning" : "error",
		),
	);
};

const declaredFallback = (
	descriptor: ProgramSurfaceExportDescriptor,
	target: ProgramSurfaceExportTarget,
	fallbackResolution: ProgramSurfaceFallbackResolution,
	code:
		| "program-surface-editor-raster-fallback"
		| "program-surface-motion-code-raster-fallback"
		| "program-surface-webgl-raster-fallback"
		| "program-surface-video-raster-fallback"
		| "program-surface-svg-raster-fallback",
): ProgramSurfaceDeliveryDecision => {
	if (fallbackResolution.state !== "ready") {
		return fallbackUnavailable(descriptor, target, fallbackResolution);
	}
	const declared = descriptor.fallback;
	if (!declared) {
		return fallbackUnavailable(descriptor, target, { state: "not-declared" });
	}
	if (
		declared.assetId !== fallbackResolution.fallback.assetId ||
		declared.frame !== fallbackResolution.fallback.frame
	) {
		return unsupported(
			descriptor,
			target,
			issue(
				descriptor.assetId,
				"program-surface-declared-fallback-invalid",
				`Program Surface "${descriptor.assetId}" fallback result does not match the declared asset/frame for ${target} output.`,
				"invalid",
				"vector-placeholder",
				"error",
			),
		);
	}
	return fallback(
		descriptor,
		target,
		fallbackResolution.fallback,
		issue(
			descriptor.assetId,
			code,
			`Program Surface "${descriptor.assetId}" was exported through declared raster fallback "${fallbackResolution.fallback.assetId}"${fallbackResolution.fallback.frame === undefined ? "" : ` at frame ${fallbackResolution.fallback.frame}`}.`,
			"fallback",
			"declared-raster-fallback",
		),
	);
};

const hostEligibilityIssue = (
	descriptor: ProgramSurfaceExportDescriptor,
	target: Extract<
		ProgramSurfaceExportTarget,
		"editor" | "webgl-player" | "video"
	>,
	environment: Required<ProgramSurfaceDeliveryEnvironment>,
): ProgramSurfaceDeliveryIssue | null => {
	if (descriptor.sourcePortability !== "self-contained") {
		return issue(
			descriptor.assetId,
			"program-surface-self-contained-source-required",
			`Program Surface "${descriptor.assetId}" needs a self-contained snapshot before ${target} can execute or capture it.`,
			"unsupported",
			"vector-placeholder",
		);
	}
	if (environment.localApproval !== "approved") {
		return issue(
			descriptor.assetId,
			"program-surface-local-approval-required",
			`Program Surface "${descriptor.assetId}" needs local approval for compiled digest "${descriptor.compiledDigest}" before ${target} can execute or capture it.`,
			environment.localApproval === "digest-mismatch"
				? "invalid"
				: "unsupported",
			"vector-placeholder",
			environment.localApproval === "digest-mismatch" ? "error" : "warning",
		);
	}
	if (target === "video" && !descriptor.timing.deterministicAtFrame) {
		return issue(
			descriptor.assetId,
			"program-surface-video-determinism-required",
			`Program Surface "${descriptor.assetId}" does not declare deterministic frame-addressed timing required for video capture.`,
			"invalid",
			"vector-placeholder",
			"error",
		);
	}
	if (
		(target === "editor" && !environment.capabilities.editorHost) ||
		(target === "webgl-player" &&
			!environment.capabilities.isolatedWebglPlayerHost) ||
		(target === "video" && !environment.capabilities.videoCaptureHost)
	) {
		const code =
			target === "editor"
				? "program-surface-editor-host-unavailable"
				: target === "webgl-player"
					? "program-surface-webgl-host-unavailable"
					: "program-surface-video-capture-unavailable";
		return issue(
			descriptor.assetId,
			code,
			`Program Surface "${descriptor.assetId}" cannot use ${target} ${target === "video" ? "capture" : "live delivery"} because the required isolated host is unavailable.`,
			"unsupported",
			"vector-placeholder",
		);
	}
	return null;
};

/**
 * Resolves one target without loading or executing source. A caller must pass a
 * validated named fallback; this function never substitutes a preview image.
 */
export const resolveProgramSurfaceDelivery = ({
	descriptor,
	target,
	fallbackResolution,
	environment = {},
}: {
	readonly descriptor: ProgramSurfaceExportDescriptor;
	readonly target: ProgramSurfaceExportTarget;
	readonly fallbackResolution: ProgramSurfaceFallbackResolution;
	readonly environment?: ProgramSurfaceDeliveryEnvironment;
}): ProgramSurfaceDeliveryDecision => {
	const resolvedEnvironment: Required<ProgramSurfaceDeliveryEnvironment> = {
		capabilities:
			environment.capabilities ?? PROGRAM_SURFACE_V1_EXPORT_CAPABILITIES,
		localApproval: environment.localApproval ?? "not-approved",
	};

	switch (target) {
		case "editor":
			if (descriptor.delivery.editor === "fallback") {
				return declaredFallback(
					descriptor,
					target,
					fallbackResolution,
					"program-surface-editor-raster-fallback",
				);
			}
			{
				const eligibility = hostEligibilityIssue(
					descriptor,
					target,
					resolvedEnvironment,
				);
				return eligibility
					? unsupported(descriptor, target, eligibility)
					: live(descriptor, target);
			}

		case "motion-code":
			if (descriptor.delivery.svgPdf !== "raster-fallback") {
				return unsupported(
					descriptor,
					target,
					issue(
						descriptor.assetId,
						"program-surface-static-output-unsupported",
						`Program Surface "${descriptor.assetId}" does not declare a static raster fallback for Motion/Code output.`,
						"unsupported",
						"vector-placeholder",
					),
				);
			}
			return declaredFallback(
				descriptor,
				target,
				fallbackResolution,
				"program-surface-motion-code-raster-fallback",
			);

		case "webgl-player":
			if (descriptor.delivery.webglPlayer === "fallback") {
				return declaredFallback(
					descriptor,
					target,
					fallbackResolution,
					"program-surface-webgl-raster-fallback",
				);
			}
			if (descriptor.delivery.webglPlayer === "unsupported") {
				return unsupported(
					descriptor,
					target,
					issue(
						descriptor.assetId,
						"program-surface-static-output-unsupported",
						`Program Surface "${descriptor.assetId}" declares generated WebGL player output unsupported.`,
						"unsupported",
						"vector-placeholder",
					),
				);
			}
			{
				const eligibility = hostEligibilityIssue(
					descriptor,
					target,
					resolvedEnvironment,
				);
				return eligibility
					? unsupported(descriptor, target, eligibility)
					: live(descriptor, target);
			}

		case "svg":
			if (descriptor.delivery.svgPdf !== "raster-fallback") {
				return unsupported(
					descriptor,
					target,
					issue(
						descriptor.assetId,
						"program-surface-static-output-unsupported",
						`Program Surface "${descriptor.assetId}" declares SVG output unsupported.`,
						"unsupported",
						"vector-placeholder",
					),
				);
			}
			return declaredFallback(
				descriptor,
				target,
				fallbackResolution,
				"program-surface-svg-raster-fallback",
			);

		case "pdf": {
			if (descriptor.delivery.svgPdf !== "raster-fallback") {
				return unsupported(
					descriptor,
					target,
					issue(
						descriptor.assetId,
						"program-surface-static-output-unsupported",
						`Program Surface "${descriptor.assetId}" declares PDF output unsupported.`,
						"unsupported",
						"vector-placeholder",
					),
				);
			}
			if (fallbackResolution.state !== "ready") {
				return fallbackUnavailable(descriptor, target, fallbackResolution);
			}
			const declared = descriptor.fallback;
			if (!declared) {
				return fallbackUnavailable(descriptor, target, {
					state: "not-declared",
				});
			}
			if (
				declared.assetId !== fallbackResolution.fallback.assetId ||
				declared.frame !== fallbackResolution.fallback.frame
			) {
				return unsupported(
					descriptor,
					target,
					issue(
						descriptor.assetId,
						"program-surface-declared-fallback-invalid",
						`Program Surface "${descriptor.assetId}" fallback result does not match the declared asset/frame for PDF output.`,
						"invalid",
						"vector-placeholder",
						"error",
					),
				);
			}
			return unsupported(
				descriptor,
				target,
				issue(
					descriptor.assetId,
					"program-surface-pdf-raster-fallback-unavailable",
					`Program Surface "${descriptor.assetId}" has declared fallback "${fallbackResolution.fallback.assetId}", but the current PDF writer cannot embed raster fallbacks.`,
					"unsupported",
					"vector-placeholder",
				),
			);
		}

		case "video":
			if (descriptor.delivery.video === "raster-fallback") {
				return declaredFallback(
					descriptor,
					target,
					fallbackResolution,
					"program-surface-video-raster-fallback",
				);
			}
			if (descriptor.delivery.video === "unsupported") {
				return unsupported(
					descriptor,
					target,
					issue(
						descriptor.assetId,
						"program-surface-static-output-unsupported",
						`Program Surface "${descriptor.assetId}" declares video output unsupported.`,
						"unsupported",
						"vector-placeholder",
					),
				);
			}
			{
				const eligibility = hostEligibilityIssue(
					descriptor,
					target,
					resolvedEnvironment,
				);
				return eligibility
					? unsupported(descriptor, target, eligibility)
					: capture(descriptor);
			}
	}
};

type ProgramSurfaceAssetDeliveryRead =
	| {
			readonly status: "missing" | "invalid";
			readonly approval: "not-approved";
			readonly fallback: ProgramSurfaceFallbackResolution;
	  }
	| {
			readonly status: "valid";
			readonly asset: ProgramSurfaceAsset;
			readonly approval: "approved" | "not-approved" | "digest-mismatch";
			readonly fallback: ProgramSurfaceFallbackResolution;
	  };

const fallbackResolutionForAsset = (
	document: Pick<SceneDocument, "assets">,
	asset: ProgramSurfaceAsset,
	localDigestApprovals:
		| readonly ProgramSurfaceLocalDigestApproval[]
		| undefined,
): ProgramSurfaceAssetDeliveryRead => {
	const read = programSurfaceAssetReadModel(
		document,
		asset.id,
		localDigestApprovals,
	);
	if (read.status === "missing") {
		return {
			status: "missing",
			approval: "not-approved",
			fallback: { state: "not-required" },
		};
	}
	const validatedAsset = read.asset;
	if (read.status === "invalid" || !validatedAsset || !read.manifest) {
		return {
			status: "invalid",
			approval: "not-approved",
			fallback: { state: "not-required" },
		};
	}
	if (read.fallback.state !== "ready") {
		return {
			status: "valid",
			asset: validatedAsset,
			approval: read.approval ?? "not-approved",
			fallback: {
				state: read.fallback.state,
				...(read.fallback.assetId ? { assetId: read.fallback.assetId } : {}),
				...(read.fallback.frame !== undefined
					? { frame: read.fallback.frame }
					: {}),
			},
		};
	}
	if (!read.fallback.assetId || !read.fallback.href) {
		return {
			status: "valid",
			asset: validatedAsset,
			approval: read.approval ?? "not-approved",
			fallback: {
				state: "invalid",
				...(read.fallback.assetId ? { assetId: read.fallback.assetId } : {}),
				...(read.fallback.frame !== undefined
					? { frame: read.fallback.frame }
					: {}),
			},
		};
	}
	const fallbackAsset = document.assets?.find(
		(candidate): candidate is ImageAsset =>
			candidate.kind === "image" && candidate.id === read.fallback.assetId,
	);
	if (
		!fallbackAsset ||
		(fallbackAsset.source.kind === "data-url" &&
			!isImageDataUrl(fallbackAsset.source.dataUrl))
	) {
		return {
			status: "valid",
			asset: validatedAsset,
			approval: read.approval ?? "not-approved",
			fallback: {
				state: "invalid",
				assetId: read.fallback.assetId,
				...(read.fallback.frame !== undefined
					? { frame: read.fallback.frame }
					: {}),
			},
		};
	}
	return {
		status: "valid",
		asset: validatedAsset,
		approval: read.approval ?? "not-approved",
		fallback: {
			state: "ready",
			fallback: {
				assetId: fallbackAsset.id,
				...(read.fallback.frame !== undefined
					? { frame: read.fallback.frame }
					: {}),
				href: read.fallback.href,
				asset: fallbackAsset,
			},
		},
	};
};

/**
 * Resolves a placed Program Surface when present. Other scene asset kinds return
 * `undefined` so their existing preview/fallback behavior remains untouched.
 */
export const resolveProgramSurfaceDeliveryForGeometry = ({
	document,
	geometry,
	target,
	localDigestApprovals,
	capabilities,
}: ResolveProgramSurfaceDeliveryForGeometryInput):
	| ProgramSurfaceDeliveryDecision
	| undefined => {
	const asset = programSurfaceAssetForGeometry(document, geometry);
	if (!asset) return undefined;
	const derived = fallbackResolutionForAsset(
		document,
		asset,
		localDigestApprovals,
	);
	if (derived.status !== "valid") {
		if (derived.status === "missing") {
			return unsupported(
				{ assetId: asset.id },
				target,
				issue(
					asset.id,
					"program-surface-asset-missing",
					`Program Surface "${asset.id}" is unavailable for ${target} output.`,
					"unsupported",
					"vector-placeholder",
				),
			);
		}
		return unsupported(
			{ assetId: asset.id },
			target,
			issue(
				asset.id,
				"program-surface-manifest-invalid",
				`Program Surface "${asset.id}" has an invalid durable manifest and cannot be exported.`,
				"invalid",
				"vector-placeholder",
				"error",
			),
		);
	}
	const descriptor = lowerProgramSurfaceExportDescriptor(derived.asset);
	return resolveProgramSurfaceDelivery({
		descriptor,
		target,
		fallbackResolution: derived.fallback,
		environment: {
			...(capabilities ? { capabilities } : {}),
			localApproval: derived.approval,
		},
	});
};
