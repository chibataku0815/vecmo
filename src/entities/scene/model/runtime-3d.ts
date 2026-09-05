import type {
	Runtime3dArtboardClip,
	Runtime3dCamera,
	Runtime3dCoordinateContract,
	Runtime3dEditorView,
	Runtime3dExternalSource,
	Runtime3dFidelityIssue,
	Runtime3dFidelityIssueCode,
	Runtime3dFrame,
	Runtime3dModelSource,
	Runtime3dPlacement,
	Runtime3dVectorPlane,
	Runtime3dViewport,
	Runtime3dWorldMatrix,
} from "@/shared/runtime-3d/types";
import { hasSubtreeCarrier } from "./appearance-targets";
import {
	externalSceneAssetForGeometry,
	hrefForExternalSceneAsset,
} from "./assets";
import { buildSceneCompositePlan } from "./composite-band";
import { nodeVisualMargin } from "./effect-filter";
import { resolveSceneMaskPlan } from "./mask-render";
import {
	type ExternalProductionLink,
	resolveExternalProductionLink,
} from "./production-link";
import { resolveFrameEffectIntent } from "./recipe-resolve";
import {
	composeMatrix,
	getNodeParentPaintBounds,
	type Matrix2D,
	matrixFromTransform,
} from "./rendering";
import {
	effectiveFocalLengthMm,
	resolveSceneCameraTargetPoints,
	sourceNodeIdForCameraCrossfadePresentation,
} from "./scene-camera";
import {
	findArtboardById,
	selectAllArtboards,
	selectArtboardIdForNode,
} from "./selectors";
import { resolveEffects } from "./style-resolve";
import type {
	Artboard,
	ExternalSceneAsset,
	SceneCameraRigContract,
	SceneDocument,
	VectorNode,
} from "./types";

const COORDINATES: Runtime3dCoordinateContract = {
	handedness: "right-handed",
	xAxis: "right",
	yAxis: "down",
	zAxis: "scene-depth",
	fovAxis: "vertical",
};

const IDENTITY_MATRIX: Matrix2D = {
	a: 1,
	b: 0,
	c: 0,
	d: 1,
	e: 0,
	f: 0,
};

const translationMatrix = (x: number, y: number): Matrix2D => ({
	a: 1,
	b: 0,
	c: 0,
	d: 1,
	e: x,
	f: y,
});

const scaleMatrix = (scale: number): Matrix2D => ({
	a: scale,
	b: 0,
	c: 0,
	d: scale,
	e: 0,
	f: 0,
});

const sizeMatrix = (width: number, height: number): Matrix2D => ({
	a: width,
	b: 0,
	c: 0,
	d: height,
	e: 0,
	f: 0,
});

const transformPoint = (
	matrix: Matrix2D,
	x: number,
	y: number,
): { readonly x: number; readonly y: number } => ({
	x: matrix.a * x + matrix.c * y + matrix.e,
	y: matrix.b * x + matrix.d * y + matrix.f,
});

const finitePositive = (value: number | undefined, fallback: number): number =>
	typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: fallback;

const sourceKey = (source: Runtime3dModelSource): string =>
	`${source.kind}:${source.format}:${source.uri}`;

/**
 * Injected pure lookup from a linked production to the artifact this editor has
 * already digest-verified for the current desired build key. It is deliberately
 * synchronous and side-effect free so this compiler stays pure: deriving a
 * desired build key needs WebCrypto and therefore happens upstream, in the
 * owning feature store, which then exposes its result as this closure.
 *
 * Returning `null` means "no artifact at all for this link". Returning a
 * resolution with `stale: true` means "this is the last artifact this editor
 * verified, and it is not the desired build" — the design keeps that visible on
 * canvas rather than blanking it, so `stale` drives a typed issue while the
 * href is still used.
 */
export type Runtime3dProductionArtifactUnavailableCode =
	/** The link is known but no artifact of any build has been verified yet. */
	| "production-artifact-missing"
	/** A rendered link is known, but no frame package is resident in the cache. */
	| "production-frame-package-missing";

export type Runtime3dProductionArtifactResolution =
	| {
			readonly kind: "model";
			readonly linkId: string;
			readonly buildKey: string;
			readonly href: string;
			/** `true` while the shown artifact is last-known-good, not the desired build. */
			readonly stale: boolean;
	  }
	| {
			readonly kind: "frame-sequence";
			readonly linkId: string;
			readonly buildKey: string;
			readonly stale: boolean;
			/**
			 * Dense, index-addressed object URLs: entry `i` is package-local frame
			 * `i`. The compiler addresses it by index and never by filename, time,
			 * or a modulo of the array length.
			 */
			readonly frameHrefs: readonly string[];
			/**
			 * The MANIFEST's own frame origin, which is what converts a Blender-space
			 * evaluation frame into a package index. It is deliberately re-read from
			 * the package rather than assumed equal to the link's
			 * `frame.blenderFrameStart`: if the two disagree, the index lands out of
			 * range and reports, instead of silently showing a shifted frame.
			 */
			readonly blenderFrameStart: number;
			readonly frameCount: number;
			readonly width: number;
			readonly height: number;
			readonly mimeType: string;
			/** The producing side's reproducibility claim, carried, never inferred. */
			readonly reproducible: boolean;
	  }
	| {
			/**
			 * The resolver was asked and has nothing to hand back. This exists so a
			 * dark band is always accompanied by a typed reason: before S4 the same
			 * situation was a bare `null`, indistinguishable from "no resolver".
			 */
			readonly kind: "unavailable";
			readonly linkId: string;
			readonly code: Runtime3dProductionArtifactUnavailableCode;
	  };

export type Runtime3dProductionArtifactResolver = (
	link: ExternalProductionLink,
) => Runtime3dProductionArtifactResolution | null;

/**
 * The document's declared link type is a claim, not a guarantee: cloud restore
 * and portable backup both reach an asset without passing through the command
 * bus. Resolution therefore re-parses strictly before an adapter-produced href
 * may replace the durable one.
 *
 * This runs at most once per node per frame. `resolveExternalProductionLink` is
 * a full field-by-field parse, and `production-link.ts` is explicit that a
 * per-frame render path must not pay for it more than it has to.
 */
type LinkedProduction =
	| { readonly linked: false }
	| {
			readonly linked: true;
			readonly link: ExternalProductionLink;
			/**
			 * S4 widened this parse from `interactive-glb` only to both delivered
			 * profiles, so the profile is carried explicitly. Three behaviors used to
			 * ride on the old single `interactive` flag and each is now decided on
			 * its own terms: `Runtime3dPlacement.animation` stays GLB-only (a frame
			 * package has no animation groups to seek, and its frame identity travels
			 * in the source itself), staleness reporting applies to both, and the old
			 * blanket "rendered profile unsupported" error is gone because the
			 * rendered lane now draws.
			 */
			readonly profile: ExternalProductionLink["outputProfile"];
			/**
			 * `false` when no resolver was injected at all, which is a different
			 * fact from "a resolver was asked and had nothing". Only the second is
			 * evidence of staleness, so the two must not collapse into one flag.
			 */
			readonly resolverInjected: boolean;
			readonly resolution: Runtime3dProductionArtifactResolution | null;
	  };

const resolveProductionArtifactFor = (
	asset: ExternalSceneAsset | null | undefined,
	resolve: Runtime3dProductionArtifactResolver | undefined,
): LinkedProduction => {
	// The parse is gated on the asset actually declaring a production, not on a
	// resolver being injected. S2-B needs the link's frame contract to place a
	// placement in source time even where no artifact resolver exists (export
	// and every non-editor caller), and `production` being absent is the cheap
	// field read that keeps a plain imported GLB from paying for a parse.
	if (!asset?.production) return { linked: false };
	const link = resolveExternalProductionLink(asset);
	if (!link) return { linked: false };
	const resolution = resolve ? resolve(link) : null;
	return {
		linked: true,
		link,
		profile: link.outputProfile,
		resolverInjected: Boolean(resolve),
		resolution:
			resolution && resolution.linkId === link.linkId ? resolution : null,
	};
};

/**
 * The one time conversion of the S2 frame contract: `blenderFrame =
 * blenderFrameStart + vecmoFrame`, clamped into the link's declared duration
 * window `[blenderFrameStart, blenderFrameStart + durationFrames - 1]`.
 *
 * Out-of-window policy is HOLD, deliberately not modulo. A linked 3D band whose
 * source is shorter than the artboard must read as "the source ended and its
 * last pose stands", because that is a visible, explainable state an author can
 * fix by re-authoring the source range. A modulo loop would instead invent
 * motion Vecmo never authored and Blender never produced, and it would make the
 * same Vecmo frame map to different source frames as the duration changes —
 * both of which break the "one clock, one authoritative edit" rule S2 exists to
 * establish. Frames before the window hold on the first frame for the same
 * reason.
 */
const blenderEvaluationFrame = (
	link: ExternalProductionLink,
	vecmoFrame: number,
): number => {
	const first = link.frame.blenderFrameStart;
	const last = first + link.frame.durationFrames - 1;
	const requested = first + vecmoFrame;
	if (!Number.isFinite(requested)) return first;
	return Math.min(last, Math.max(first, requested));
};

/**
 * What one node's runtime source resolved to. The out-of-range case is a
 * distinct outcome rather than `null` because it is a reportable defect (the
 * package does not cover the window the link declares), while `none` is the
 * ordinary "this node is not a runtime 3D placement at all".
 */
type RuntimeSourceOutcome =
	| { readonly kind: "none" }
	| { readonly kind: "source"; readonly source: Runtime3dExternalSource }
	| {
			readonly kind: "frame-out-of-range";
			readonly frameIndex: number;
			readonly frameCount: number;
			readonly blenderFrame: number;
	  };

const NO_RUNTIME_SOURCE: RuntimeSourceOutcome = { kind: "none" };

const runtimeSource = (
	document: SceneDocument,
	node: VectorNode,
	production: Runtime3dProductionArtifactResolution | null,
	blenderFrame: number | null,
	/**
	 * Whether this node's link declares the rendered profile. It is a separate
	 * argument from the resolution because the two disagree in exactly the case
	 * that matters: a rendered link whose package is not resident. Without this,
	 * such a node falls through to the durable GLB href and DRAWS IT — a stale
	 * proxy passing as delivery, which is the one outcome this whole lane exists
	 * to prevent. A rendered link legitimately has no GLB payload, so there is
	 * nothing honest to fall back to.
	 */
	renderedProfile: boolean,
): RuntimeSourceOutcome => {
	if (node.geometry.kind !== "image") return NO_RUNTIME_SOURCE;
	const asset = externalSceneAssetForGeometry(document, node.geometry);
	if (asset?.kind !== "model-3d") return NO_RUNTIME_SOURCE;
	if (renderedProfile && production?.kind !== "frame-sequence") {
		return NO_RUNTIME_SOURCE;
	}
	if (production?.kind === "frame-sequence") {
		// A rendered link legitimately carries no GLB payload, so `asset.format`
		// is deliberately NOT part of this gate — `node-commands.ts`'s
		// `LINKED_PRODUCTION_ASSET_KIND` documents the same exclusion.
		if (blenderFrame === null) return NO_RUNTIME_SOURCE;
		// The one index conversion in this lane. It subtracts the MANIFEST's own
		// origin, never a hardcoded 1 and never the link's start, so a package
		// whose origin disagrees with its link reports instead of drawing a
		// frame-shifted band. `blenderFrame` already had the link's own start
		// added by `blenderEvaluationFrame`; adding or subtracting a second
		// origin here is exactly the linear-in-f defect that reads as correct on
		// frame 0.
		const frameIndex = blenderFrame - production.blenderFrameStart;
		const uri =
			Number.isInteger(frameIndex) && frameIndex >= 0
				? production.frameHrefs[frameIndex]
				: undefined;
		if (uri === undefined) {
			return {
				kind: "frame-out-of-range",
				frameIndex,
				frameCount: production.frameHrefs.length,
				blenderFrame,
			};
		}
		const cacheKey = `frame-sequence:${production.linkId}:${production.buildKey}`;
		return {
			kind: "source",
			source: {
				variant: "frame-sequence",
				kind: "reference",
				uri,
				mimeType: production.mimeType,
				frameIndex,
				blenderFrame,
				frameCount: production.frameCount,
				width: production.width,
				height: production.height,
				buildKey: production.buildKey,
				exact: !production.stale && production.reproducible,
				cacheKey,
				frameCacheKey: `${cacheKey}:${frameIndex}`,
			},
		};
	}
	if (asset.format !== "glb" && asset.format !== "gltf") {
		return NO_RUNTIME_SOURCE;
	}
	// The durable href stays the fallback. A resolver may substitute a verified
	// regenerated artifact for it — including a last-known-good one, which is
	// shown deliberately and reported as stale rather than hidden. With no
	// resolver injected `production` is always null, so every existing caller
	// keeps identical behavior.
	const resolved = production?.kind === "model" ? production : null;
	const uri = resolved?.href ?? hrefForExternalSceneAsset(asset);
	if (!uri) return NO_RUNTIME_SOURCE;
	const source = {
		variant: "model",
		kind: resolved ? "reference" : asset.source.kind,
		uri,
		format: asset.format,
		cacheKey: "",
	} satisfies Runtime3dExternalSource;
	return { kind: "source", source: { ...source, cacheKey: sourceKey(source) } };
};

const matrix4FromPlacement = (
	matrix: Matrix2D,
	z: number,
): Runtime3dWorldMatrix => [
	matrix.a,
	matrix.b,
	0,
	0,
	matrix.c,
	matrix.d,
	0,
	0,
	0,
	0,
	1,
	0,
	matrix.e,
	matrix.f,
	z,
	1,
];

const matrixScale = (matrix: Matrix2D): number =>
	Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));

const subtreeVisualMargin = (node: VectorNode): number => {
	let margin = nodeVisualMargin(
		resolveEffects(node.style.effects),
		Math.max(0, node.style.strokeWidth),
		null,
	);
	for (const child of node.children ?? []) {
		margin = Math.max(
			margin,
			subtreeVisualMargin(child) *
				matrixScale(matrixFromTransform(child.transform)),
		);
	}
	return margin;
};

const vectorPlaneRasterBounds = (node: VectorNode) => {
	const bounds = getNodeParentPaintBounds(node);
	const margin =
		subtreeVisualMargin(node) *
		matrixScale(matrixFromTransform(node.transform));
	return {
		x: bounds.x - margin,
		y: bounds.y - margin,
		width: bounds.width + margin * 2,
		height: bounds.height + margin * 2,
	};
};

const collectSubtreeNodes = (node: VectorNode): readonly VectorNode[] => [
	node,
	...(node.children ?? []).flatMap(collectSubtreeNodes),
];

type VectorPlaneRejection = {
	readonly code: Runtime3dFidelityIssueCode;
	readonly message: string;
};

const vectorPlaneRejections = ({
	artboard,
	document,
	maskPlan,
	node,
	parentNodeId,
}: {
	readonly artboard: Artboard;
	readonly document: SceneDocument;
	readonly maskPlan: ReturnType<typeof resolveSceneMaskPlan>;
	readonly node: VectorNode;
	readonly parentNodeId: string | null;
}): readonly VectorPlaneRejection[] => {
	const rejections: VectorPlaneRejection[] = [];
	const activeCameraId = artboard.activeSceneCameraId;
	if (!activeCameraId) {
		rejections.push({
			code: "runtime-3d-vector-plane-active-camera-required",
			message:
				"A depth-authored vector subtree needs an active scene camera before it can enter the Babylon depth composite.",
		});
	} else if (
		node.depthPlane?.cameraRigId &&
		node.depthPlane.cameraRigId !== activeCameraId
	) {
		rejections.push({
			code: "runtime-3d-vector-plane-camera-mismatch",
			message:
				"The vector subtree depth plane targets a different camera than its artboard active camera.",
		});
	} else if (
		!document.sceneCameras?.some((candidate) => candidate.id === activeCameraId)
	) {
		rejections.push({
			code: "runtime-3d-vector-plane-active-camera-required",
			message:
				"The vector subtree active camera is missing, so its existing 2D render remains authoritative.",
		});
	}
	if (parentNodeId) {
		rejections.push({
			code: "runtime-3d-vector-plane-nesting-unsupported",
			message:
				"P4 admits only a top-level depth-authored subtree; nested carrier compositing remains on the existing 2D path.",
		});
	}

	const subtree = collectSubtreeNodes(node);
	const subtreeIds = new Set(subtree.map((candidate) => candidate.id));
	if (
		subtree.some(
			(candidate, index) => index > 0 && candidate.depthPlane !== undefined,
		)
	) {
		rejections.push({
			code: "runtime-3d-vector-plane-nested-depth-unsupported",
			message:
				"A flattened vector texture plane cannot preserve a second authored depth plane inside the selected subtree.",
		});
	}
	if (
		subtree.some(
			(candidate) =>
				candidate.style.blendMode !== undefined &&
				candidate.style.blendMode !== "normal",
		)
	) {
		rejections.push({
			code: "runtime-3d-vector-plane-blend-unsupported",
			message:
				"The selected vector subtree uses blend modes whose backdrop cannot be preserved by an isolated texture plane.",
		});
	}
	if (
		subtree.some((candidate) =>
			candidate.style.effects?.some(
				(effect) =>
					effect.visible !== false && effect.kind === "background-blur",
			),
		)
	) {
		rejections.push({
			code: "runtime-3d-vector-plane-background-blur-unsupported",
			message:
				"The selected vector subtree uses background blur, which depends on pixels outside its isolated raster source.",
		});
	}
	if (
		subtree.some(
			(candidate) =>
				candidate.recipe !== undefined || Boolean(candidate.recipeRef),
		)
	) {
		rejections.push({
			code: "runtime-3d-vector-plane-look-unsupported",
			message:
				"The selected vector subtree has a node Look that is not admitted to the P4 texture-plane fidelity subset.",
		});
	}
	if (
		subtree.some(
			(candidate) => candidate.frame && candidate.frame.clipsContent !== false,
		)
	) {
		rejections.push({
			code: "runtime-3d-vector-plane-frame-clip-unsupported",
			message:
				"The selected vector subtree requests frame-content clipping that the isolated SVG path does not preserve.",
		});
	}
	if (
		subtree.some(
			(candidate) =>
				maskPlan.consumedMaskNodeIds.has(candidate.id) ||
				maskPlan.applicationsByContentNodeId.has(candidate.id),
		)
	) {
		rejections.push({
			code: "runtime-3d-vector-plane-mask-unsupported",
			message:
				"The selected vector subtree participates in an authored mask relation; P4 leaves it on the existing 2D renderer.",
		});
	}
	if (subtree.some((candidate) => candidate.geometry.kind === "image")) {
		rejections.push({
			code: "runtime-3d-vector-plane-external-subtree-unsupported",
			message:
				"The selected vector subtree contains image, video, 3D, HTML, or code pixels outside the P4 vector-only texture-plane subset.",
		});
	}

	const frameIntent = resolveFrameEffectIntent(document, artboard.id);
	if (
		frameIntent.lookGraph ||
		frameIntent.effectLayerStack ||
		frameIntent.visualRecipe ||
		artboard.sourceOpticsRigs?.length
	) {
		rejections.push({
			code: "runtime-3d-vector-plane-look-unsupported",
			message:
				"The artboard has a frame Look or Source Optics pass that cannot be applied consistently across the isolated Babylon plane.",
		});
	}
	if (frameIntent.influenceRecipe) {
		rejections.push({
			code: "runtime-3d-vector-plane-mask-unsupported",
			message:
				"The artboard has frame influence/mask intent that cannot be applied consistently across the isolated Babylon plane.",
		});
	}
	const scopedLooks = [
		...(document.effectIntent?.scopedLooks ?? []),
		...(artboard.effectIntent?.scopedLooks ?? []),
	];
	if (
		scopedLooks.some((look) =>
			look.targetNodeIds.some((nodeId) => subtreeIds.has(nodeId)),
		)
	) {
		rejections.push({
			code: "runtime-3d-vector-plane-look-unsupported",
			message:
				"The selected vector subtree is targeted by an object-scoped Look that is not admitted to the P4 texture-plane subset.",
		});
	}
	return rejections;
};

const presentationCamera = (viewport: Runtime3dViewport): Runtime3dCamera => {
	const distance = Math.max(viewport.width, viewport.height, 1000);
	return {
		kind: "orthographic",
		coordinates: COORDINATES,
		position: {
			x: viewport.width / 2,
			y: viewport.height / 2,
			z: -distance,
		},
		target: {
			x: viewport.width / 2,
			y: viewport.height / 2,
			z: 0,
		},
		up: { x: 0, y: -1, z: 0 },
		near: Math.max(0.001, distance / 10_000),
		far: distance * 20,
		halfWidth: viewport.width / 2,
		halfHeight: viewport.height / 2,
		zoom: 1,
	};
};

const cameraForRig = ({
	artboard,
	document,
	issues,
	rig,
	viewport,
}: {
	readonly artboard: Artboard;
	readonly document: SceneDocument;
	readonly issues: Runtime3dFidelityIssue[];
	readonly rig: SceneCameraRigContract;
	readonly viewport: Runtime3dViewport;
}): Runtime3dCamera => {
	if (
		rig.body.parentControllerNodeId ||
		rig.parentControllerNodeId ||
		rig.target?.parentControllerNodeId
	) {
		issues.push({
			code: "runtime-3d-camera-controller-static-only",
			severity: "warning",
			message:
				"The shared 3D preview maps the static camera contract; controller-driven camera transforms remain a later motion-parity gate.",
			artboardId: artboard.id,
		});
	}
	const target = resolveSceneCameraTargetPoints(
		document,
		[rig],
		artboard.id,
	).get(rig.id) ??
		rig.target?.point ?? {
			x: artboard.width / 2,
			y: artboard.height / 2,
			z: 0,
		};
	const near = finitePositive(rig.projection.near, 0.001);
	const requestedFar = rig.projection.far;
	const far =
		typeof requestedFar === "number" &&
		Number.isFinite(requestedFar) &&
		requestedFar > near
			? requestedFar
			: Math.max(near * 10, 100_000);
	if (
		requestedFar !== undefined &&
		(!Number.isFinite(requestedFar) || requestedFar <= near)
	) {
		issues.push({
			code: "runtime-3d-camera-far-invalid",
			severity: "warning",
			message:
				"The authored camera far plane is not beyond near; the shared 3D preview uses a finite runtime fallback.",
			artboardId: artboard.id,
		});
	}
	// Mirrors `resolveDepthOfField`'s own focus-distance default in
	// `scene-camera.ts` (authored/sampled value, else the body-to-target
	// distance along the raw Z axis), so a renderer deriving DOF from
	// `sourceCamera` sees the same effective focus point the 2D layer-blur
	// approximation used, not an un-defaulted `undefined`.
	const focusDistance = Math.max(
		near,
		rig.projection.focusDistance ?? Math.abs(rig.body.position.z - target.z),
	);
	const apertureStrength = Math.max(0, rig.projection.aperture ?? 0);
	const base = {
		coordinates: COORDINATES,
		position: rig.body.position,
		target,
		up: { x: 0, y: -1, z: 0 } as const,
		near,
		far,
		focusDistance,
		apertureStrength,
		focalLengthMm: effectiveFocalLengthMm(rig),
	};
	if (rig.projection.kind === "perspective") {
		return {
			...base,
			kind: "perspective",
			verticalFovRadians:
				(finitePositive(rig.projection.fovDegrees, 50) * Math.PI) / 180,
			aspect: viewport.width / Math.max(1, viewport.height),
		};
	}
	const zoom = finitePositive(rig.projection.zoom, 1);
	return {
		...base,
		kind: "orthographic",
		halfWidth: artboard.width / 2 / zoom,
		halfHeight: artboard.height / 2 / zoom,
		zoom,
	};
};

const issueForPlacementFidelity = (
	node: VectorNode,
	artboardId: string,
	clipped: boolean,
	issues: Runtime3dFidelityIssue[],
): void => {
	if (node.style.blendMode && node.style.blendMode !== "normal") {
		issues.push({
			code: "runtime-3d-model-blend-unsupported",
			severity: "warning",
			message:
				"The shared 3D overlay does not reproduce SVG sibling blend modes.",
			artboardId,
			nodeId: node.id,
		});
	}
	if ((node.style.effects?.length ?? 0) > 0) {
		issues.push({
			code: "runtime-3d-model-effects-unsupported",
			severity: "warning",
			message:
				"The shared 3D overlay does not apply Vecmo SVG node effects to Babylon model pixels.",
			artboardId,
			nodeId: node.id,
		});
	}
	if (clipped) {
		issues.push({
			code: "runtime-3d-frame-clip-unsupported",
			severity: "warning",
			message:
				"The shared 3D overlay does not yet reproduce frame-content clipping.",
			artboardId,
			nodeId: node.id,
		});
	}
};

const isCameraCrossfadeCarrier = (node: VectorNode): boolean => {
	const value = node.data?.sceneCameraCrossfade;
	if (!value || typeof value !== "object") return false;
	const role = Reflect.get(value, "role");
	const opacity = Reflect.get(value, "opacity");
	return (
		(role === "from" || role === "to") &&
		typeof opacity === "number" &&
		Number.isFinite(opacity)
	);
};

/**
 * Compiles the sampled Vecmo presentation scene into the immutable runtime-3D
 * contract. Presentation matrices remain the visible editor truth; the static
 * authored camera is preserved separately as `sourceCamera` for later
 * camera/motion parity. This function is DOM-free and Babylon-free.
 */
export function compileRuntime3dFrame({
	frame,
	resolveProductionArtifact,
	scene,
	viewport,
}: {
	readonly frame: number;
	readonly scene: SceneDocument;
	readonly viewport: Runtime3dEditorView;
	/**
	 * Optional, additive, and injected: with it absent this function behaves
	 * exactly as before, which is what keeps every non-linked asset and every
	 * existing caller untouched by the linked-production path.
	 */
	readonly resolveProductionArtifact?: Runtime3dProductionArtifactResolver;
}): Runtime3dFrame {
	const artboards = selectAllArtboards(scene);
	const artboardById = new Map(
		artboards.map((artboard) => [artboard.id, artboard]),
	);
	const issues: Runtime3dFidelityIssue[] = [];
	const placements: Runtime3dPlacement[] = [];
	const vectorPlaneCandidates: Runtime3dVectorPlane[] = [];
	const maskPlan = resolveSceneMaskPlan(scene);
	let hasCameraCrossfade = false;
	const cos = Math.cos(viewport.rotation);
	const sin = Math.sin(viewport.rotation);
	const viewMatrix: Matrix2D = {
		a: cos * viewport.scale,
		b: sin * viewport.scale,
		c: -sin * viewport.scale,
		d: cos * viewport.scale,
		e: viewport.panX,
		f: viewport.panY,
	};

	const visit = (
		node: VectorNode,
		parentMatrix: Matrix2D,
		parentOpacity: number,
		parentClipped: boolean,
		parentVisible: boolean,
		parentPickable: boolean,
		parentCameraCrossfadePresentation: boolean,
		parentNodeId: string | null,
	): void => {
		const nodeArtboardId = selectArtboardIdForNode(scene, node.id);
		const artboard = nodeArtboardId
			? artboardById.get(nodeArtboardId)
			: undefined;
		const nodeMatrix = composeMatrix(
			parentMatrix,
			matrixFromTransform(node.transform),
		);
		const opacity = parentOpacity * node.style.opacity;
		const visible = parentVisible && node.visible;
		const cameraCrossfadeCarrier = isCameraCrossfadeCarrier(node);
		const cameraCrossfadePresentation =
			parentCameraCrossfadePresentation || cameraCrossfadeCarrier;
		const pickable = parentPickable && (cameraCrossfadeCarrier || !node.locked);
		if (cameraCrossfadeCarrier) hasCameraCrossfade = true;
		const clipped =
			parentClipped || Boolean(node.frame && node.frame.clipsContent !== false);
		const externalAsset =
			node.geometry.kind === "image"
				? externalSceneAssetForGeometry(scene, node.geometry)
				: null;
		const production = resolveProductionArtifactFor(
			externalAsset,
			resolveProductionArtifact,
		);
		const blenderFrame = production.linked
			? blenderEvaluationFrame(production.link, frame)
			: null;
		const renderedProfile =
			production.linked && production.profile === "rendered-rgba-sequence";
		const sourceOutcome = runtimeSource(
			scene,
			node,
			production.linked ? production.resolution : null,
			blenderFrame,
			renderedProfile,
		);
		const source =
			sourceOutcome.kind === "source" ? sourceOutcome.source : null;
		const depthPlane = node.depthPlane;
		const wantsVectorPlane =
			visible &&
			artboard &&
			depthPlane !== undefined &&
			hasSubtreeCarrier(node) &&
			!cameraCrossfadePresentation;
		if (wantsVectorPlane && artboard && depthPlane) {
			const rejections = vectorPlaneRejections({
				artboard,
				document: scene,
				maskPlan,
				node,
				parentNodeId,
			});
			for (const rejection of rejections) {
				issues.push({
					code: rejection.code,
					severity: "error",
					message: rejection.message,
					artboardId: artboard.id,
					nodeId: node.id,
				});
			}
			if (rejections.length === 0) {
				const bounds = vectorPlaneRasterBounds(node);
				if (
					!Number.isFinite(bounds.x) ||
					!Number.isFinite(bounds.y) ||
					!Number.isFinite(bounds.width) ||
					!Number.isFinite(bounds.height) ||
					bounds.width <= 0 ||
					bounds.height <= 0
				) {
					issues.push({
						code: "runtime-3d-vector-plane-bounds-invalid",
						severity: "error",
						message:
							"The selected vector subtree has no finite positive raster bounds, so its existing 2D render remains authoritative.",
						artboardId: artboard.id,
						nodeId: node.id,
					});
				} else {
					const centerAndSize = composeMatrix(
						translationMatrix(
							bounds.x + bounds.width / 2,
							bounds.y + bounds.height / 2,
						),
						sizeMatrix(bounds.width, bounds.height),
					);
					const artboardMatrix = translationMatrix(
						artboard.position.x,
						artboard.position.y,
					);
					vectorPlaneCandidates.push({
						nodeId: node.id,
						sourceNodeId: node.id,
						artboardId: artboard.id,
						worldMatrix: matrix4FromPlacement(
							composeMatrix(
								viewMatrix,
								composeMatrix(
									artboardMatrix,
									composeMatrix(parentMatrix, centerAndSize),
								),
							),
							depthPlane.z,
						),
						opacity: Math.min(1, Math.max(0, parentOpacity)),
						visible: opacity > 0,
						pickable,
						rasterBounds: bounds,
						texture: null,
					});
					// The texture contains the whole admitted subtree. Descendants must
					// not also become placements or count as unresolved SVG siblings.
					return;
				}
			}
		}
		if (
			visible &&
			!renderedProfile &&
			externalAsset?.kind === "model-3d" &&
			(externalAsset.format === "glb" || externalAsset.format === "gltf") &&
			!source
		) {
			issues.push({
				code: "runtime-3d-model-source-missing",
				severity: "error",
				message: "The GLB/GLTF placement has no resolvable runtime source.",
				artboardId: nodeArtboardId,
				assetId: externalAsset.id,
				nodeId: node.id,
			});
		}
		// The rendered band draws as of S4-C, so the old blanket
		// `runtime-3d-rendered-profile-unsupported` error is gone. What replaces
		// it is precise: an index the admitted package cannot address fails
		// closed HERE rather than being rounded into a neighbouring frame.
		if (visible && sourceOutcome.kind === "frame-out-of-range") {
			issues.push({
				code: "runtime-3d-frame-package-frame-unavailable",
				severity: "error",
				message: `The rendered frame package cannot address Blender frame ${sourceOutcome.blenderFrame} (package index ${sourceOutcome.frameIndex} of ${sourceOutcome.frameCount}); the band is left empty rather than showing a different frame.`,
				artboardId: nodeArtboardId,
				...(externalAsset ? { assetId: externalAsset.id } : {}),
				nodeId: node.id,
			});
		}
		// Every way a rendered band can end up with no frames reports here, not
		// just the one where a resolver answered `unavailable`. The other two —
		// a resolution for the wrong profile, and no resolver injected at all
		// (every non-editor caller) — used to be silent, and "silent" is the
		// state that let a dark band read as an authored empty frame.
		if (visible && renderedProfile && sourceOutcome.kind === "none") {
			const unavailableCode =
				production.linked && production.resolution?.kind === "unavailable"
					? production.resolution.code
					: null;
			issues.push({
				code: "runtime-3d-linked-production-unavailable",
				severity: "error",
				message:
					unavailableCode === "production-frame-package-missing"
						? "The rendered frame package for this linked production is not resident, so the 3D band has no frames to draw."
						: unavailableCode === "production-artifact-missing"
							? "The linked production has no verified artifact at all, so the 3D band has nothing to draw."
							: "No rendered frame package was resolved for this linked production, so the 3D band has no frames to draw; the durable model source is deliberately NOT substituted for it.",
				artboardId: nodeArtboardId,
				...(externalAsset ? { assetId: externalAsset.id } : {}),
				nodeId: node.id,
			});
		}
		// The package draws, but its producing side declined to claim
		// reproducibility. Reported so the export report can refuse an exact
		// claim over pixels that are nonetheless perfectly visible.
		if (
			visible &&
			source?.variant === "frame-sequence" &&
			production.linked &&
			production.resolution?.kind === "frame-sequence" &&
			!production.resolution.reproducible
		) {
			issues.push({
				code: "runtime-3d-frame-package-not-reproducible",
				severity: "warning",
				message:
					"The rendered frame package is shown, but its producing side could not claim it is reproducible, so it cannot back an exact export.",
				artboardId: nodeArtboardId,
				...(externalAsset ? { assetId: externalAsset.id } : {}),
				nodeId: node.id,
			});
		}
		// A resolver was injected and could not hand back the desired build, so
		// what the canvas is about to show is either the last verified artifact or
		// the durable source. Reporting it as a typed warning is what keeps a
		// stale proxy from silently reading as Ready. `resolverInjected` keeps
		// this branch unreachable for a caller that never had a resolver, exactly
		// as before S2-B widened the parse: "nobody asked" is not evidence of
		// staleness, and turning it into one would make every export of a linked
		// document report a fidelity issue it has no grounds for.
		if (
			visible &&
			externalAsset &&
			production.linked &&
			production.resolverInjected &&
			(production.resolution === null ||
				(production.resolution.kind !== "unavailable" &&
					production.resolution.stale))
		) {
			issues.push({
				code: "runtime-3d-linked-production-stale",
				severity: "warning",
				message:
					"The linked production has no verified artifact for its current desired build, so the last known source is shown.",
				artboardId: nodeArtboardId,
				assetId: externalAsset.id,
				nodeId: node.id,
			});
		}
		if (visible && artboard && node.geometry.kind === "image" && source) {
			const bounds = node.geometry.bounds;
			const normalizedSize = Math.max(
				1,
				Math.min(Math.abs(bounds.width), Math.abs(bounds.height)),
			);
			const centerAndSize = composeMatrix(
				translationMatrix(
					bounds.x + bounds.width / 2,
					bounds.y + bounds.height / 2,
				),
				scaleMatrix(normalizedSize),
			);
			const artboardMatrix = translationMatrix(
				artboard.position.x,
				artboard.position.y,
			);
			placements.push({
				nodeId: node.id,
				sourceNodeId: parentCameraCrossfadePresentation
					? sourceNodeIdForCameraCrossfadePresentation(node.id)
					: node.id,
				assetId: externalAsset?.id ?? node.geometry.assetId,
				artboardId: artboard.id,
				source,
				worldMatrix: matrix4FromPlacement(
					composeMatrix(
						viewMatrix,
						composeMatrix(
							artboardMatrix,
							composeMatrix(nodeMatrix, centerAndSize),
						),
					),
					node.depthPlane?.z ?? 0,
				),
				opacity: Math.min(1, Math.max(0, opacity)),
				visible: opacity > 0,
				pickable,
				// Only a verified `interactive-glb` link carries source time. A
				// plain imported GLB stays without an `animation` field, so the
				// adapter leaves it exactly as before: never started, never seeked.
				// A rendered frame package is deliberately excluded too: it has no
				// animation groups to seek, and its frame identity travels in
				// `source.frameIndex`/`source.blenderFrame` instead. Handing it an
				// `animation` would invite an adapter to advance a clock over
				// already-baked frames.
				...(production.linked &&
				production.profile === "interactive-glb" &&
				blenderFrame !== null
					? {
							animation: {
								frame: blenderFrame,
								fps: production.link.frame.fps,
							},
						}
					: {}),
			});
			issueForPlacementFidelity(node, artboard.id, clipped, issues);
			if (maskPlan.applicationsByContentNodeId.has(node.id)) {
				issues.push({
					code: "runtime-3d-model-mask-unsupported",
					severity: "warning",
					message:
						"The shared 3D overlay reports authored appearance masks but does not apply them to Babylon model pixels.",
					artboardId: artboard.id,
					nodeId: node.id,
				});
			}
		}
		for (const child of node.children ?? []) {
			visit(
				child,
				nodeMatrix,
				opacity,
				clipped,
				visible,
				pickable,
				cameraCrossfadePresentation,
				node.id,
			);
		}
	};

	for (const layer of scene.layers) {
		if (!layer.visible) continue;
		for (const node of layer.nodes) {
			visit(node, IDENTITY_MATRIX, 1, false, true, !layer.locked, false, null);
		}
	}
	const vectorPlanes =
		placements.length > 0 ? vectorPlaneCandidates : ([] as const);

	if (placements.length > 0 && hasCameraCrossfade) {
		issues.push({
			code: "runtime-3d-camera-crossfade-sampled",
			severity: "info",
			message:
				"Camera crossfade uses samplePresentation() dual-scene transforms and opacity; Babylon does not interpolate a second independent optical camera.",
		});
	}

	// S3c (経路A): one contiguous 3D band with vector runs before and after it is
	// now COMPOSED, not approximated — the canvas paints the front run in a
	// second SVG above the Babylon overlay, and the raster export composites
	// back → 3D → front. The blanket "any visible non-model sibling" warning
	// therefore no longer describes reality and must not fire for the supported
	// sandwich. `buildArtboardCompositePlan` owns the shapes that stay genuinely
	// unsupported (more than one band; vector content stranded beneath a band
	// because it shares the band's top-level group) and emits the same typed
	// code for them.
	if (placements.length > 0) {
		issues.push(...buildSceneCompositePlan(scene).issues);
	}
	if (
		placements.length > 0 &&
		(artboards.some((artboard) => artboard.effectIntent?.influenceRecipe) ||
			scene.effectIntent?.influenceRecipe)
	) {
		issues.push({
			code: "runtime-3d-model-mask-unsupported",
			severity: "warning",
			message:
				"The shared 3D overlay reports authored mask/influence intent but does not apply it to Babylon model pixels.",
		});
	}

	const cameraArtboard =
		findArtboardById(scene, scene.currentArtboardId) ??
		artboards[0] ??
		scene.artboard;
	const activeCameraId = cameraArtboard.activeSceneCameraId;
	const rig = activeCameraId
		? scene.sceneCameras?.find((candidate) => candidate.id === activeCameraId)
		: undefined;
	if (activeCameraId && !rig) {
		issues.push({
			code: "runtime-3d-active-camera-missing",
			severity: "error",
			message: `Active scene camera "${activeCameraId}" is missing; the shared 3D preview uses the artboard camera fallback.`,
			artboardId: cameraArtboard.id,
		});
	}
	if ((rig?.projection.aperture ?? 0) > 0) {
		if (vectorPlanes.length > 0) {
			issues.push({
				code: "runtime-3d-vector-plane-dof-sampled",
				severity: "info",
				message:
					"Vector texture planes preserve samplePresentation() camera DOF through the existing isolated SVG raster; Babylon does not advance or resample the camera.",
				artboardId: cameraArtboard.id,
			});
		}
		if (placements.length > 0) {
			issues.push({
				code: "runtime-3d-dof-unsupported",
				severity: "warning",
				message:
					"GLB/GLTF pixels do not yet receive an optical Babylon DOF pass; P4 preserves sampled vector-plane DOF only.",
				artboardId: cameraArtboard.id,
			});
		}
	}
	const runtimeArtboardIds = new Set([
		...placements.map((placement) => placement.artboardId),
		...vectorPlanes.map((plane) => plane.artboardId),
	]);
	const artboardClips: Runtime3dArtboardClip[] = artboards
		.filter((artboard) => runtimeArtboardIds.has(artboard.id))
		.map((artboard) => {
			const left = artboard.position.x;
			const top = artboard.position.y;
			const right = left + artboard.width;
			const bottom = top + artboard.height;
			return {
				artboardId: artboard.id,
				polygon: [
					transformPoint(viewMatrix, left, top),
					transformPoint(viewMatrix, right, top),
					transformPoint(viewMatrix, right, bottom),
					transformPoint(viewMatrix, left, bottom),
				],
			};
		});

	return {
		frame,
		viewport: {
			width: viewport.width,
			height: viewport.height,
			dpr: viewport.dpr,
		},
		camera: presentationCamera(viewport),
		sourceCamera: rig
			? cameraForRig({
					artboard: cameraArtboard,
					document: scene,
					issues,
					rig,
					viewport,
				})
			: undefined,
		artboardClips,
		placements,
		vectorPlanes,
		issues,
	};
}
