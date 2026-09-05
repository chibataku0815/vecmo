import { initialMotionDocument } from "@/entities/motion/model/seed-motion";
import {
	compileRuntime3dFrame,
	type Runtime3dProductionArtifactResolver,
} from "@/entities/scene/model/runtime-3d";
import type {
	SceneDocument,
	SceneLayer,
	VectorNode,
} from "@/entities/scene/model/types";
import type { BabylonRuntimeSurface } from "@/shared/babylon";
import type {
	Runtime3dFidelityIssue,
	Runtime3dFrame,
} from "@/shared/runtime-3d/types";
import { materializeRuntime3dVectorPlaneTextures } from "@/shared/runtime-3d/vector-plane-texture";
import type { FramePackageFrameRecord } from "../model/frame-package-delivery";
import type { ExportIssue } from "../model/issues";
import { renderIsolatedNodeSvg } from "../model/svg";

export type BrowserRuntime3dFrameComposition = {
	/** Sampled Scene with successfully rendered GLB/vector fallbacks hidden. */
	readonly sceneForSvg: SceneDocument;
	/** Origin-clean, sRGB browser canvas containing only Babylon pixels. */
	readonly overlayCanvas: HTMLCanvasElement | null;
	readonly issues: readonly ExportIssue[];
	readonly rendered: boolean;
	/**
	 * Rendered Blender frame-package frames this composite actually carried
	 * (S4-D). Empty for every document that links no rendered production, which
	 * keeps existing callers on identical behavior. Reported ONLY on a committed
	 * composite: a frame whose Babylon readback failed contributes nothing here,
	 * so a delivery record can never claim a frame the output does not contain.
	 */
	readonly framePackageFrames: readonly FramePackageFrameRecord[];
};

export type BrowserRuntime3dFrameCompositor = {
	readonly prepareFrame: (
		scene: SceneDocument,
		frame: number,
	) => Promise<BrowserRuntime3dFrameComposition>;
	readonly dispose: () => void;
};

const runtimeIssueForExport = (issue: Runtime3dFidelityIssue): ExportIssue => ({
	severity: issue.severity,
	category:
		issue.code === "runtime-3d-camera-crossfade-sampled" ||
		issue.code === "runtime-3d-vector-plane-dof-sampled"
			? "approximated"
			: issue.severity === "error"
				? "fallback"
				: "unsupported",
	code: issue.code,
	message: issue.message,
	fallback:
		issue.code === "runtime-3d-model-source-missing" ||
		issue.code === "runtime-3d-vector-plane-raster-failed"
			? "preview-image"
			: "normalized-value",
	...(issue.nodeId ? { nodeId: issue.nodeId } : {}),
	...(issue.assetId ? { assetId: issue.assetId } : {}),
	...(issue.artboardId ? { artboardId: issue.artboardId } : {}),
});

const runtimeFailureIssue = (error: unknown): ExportIssue => {
	const detail =
		error instanceof Error ? `${error.name} ${error.message}` : String(error);
	const sourceUnreadable =
		/cors|cross-origin|failed to fetch|networkerror|loadfile|load file|unable to load|load asset/i.test(
			detail,
		);
	const alphaUnavailable = /export alpha is unavailable/i.test(detail);
	const colorSpaceUnavailable = /export color space is unavailable/i.test(
		detail,
	);
	const canvasUnreadable =
		(error instanceof Error && error.name === "SecurityError") ||
		/tainted|origin-clean/i.test(detail);
	let code = "runtime-3d-export-fallback";
	let message =
		"The Babylon 3D frame could not be committed to browser export; the declared Scene preview or placeholder remains in the output.";
	if (canvasUnreadable) {
		code = "runtime-3d-export-canvas-unreadable";
		message =
			"Babylon rendered the 3D frame, but browser canvas security prevented an origin-clean export readback; the declared Scene preview or placeholder remains in the output.";
	} else if (sourceUnreadable) {
		code = "runtime-3d-export-source-unreadable";
		message =
			"The GLB/GLTF source was not readable by the browser export runtime (network or CORS); the declared Scene preview or placeholder remains in the output.";
	} else if (alphaUnavailable) {
		code = "runtime-3d-export-alpha-unavailable";
		message =
			"The browser Babylon surface cannot preserve transparent 3D pixels; the declared Scene preview or placeholder remains in the output.";
	} else if (colorSpaceUnavailable) {
		code = "runtime-3d-export-color-space-unavailable";
		message =
			"The browser cannot provide an sRGB 3D export readback; the declared Scene preview or placeholder remains in the output.";
	}
	return {
		severity: "warning",
		category: "fallback",
		code,
		message,
		fallback: "preview-image",
	};
};

const framePackageFramesForFrame = (
	frame: Runtime3dFrame,
): readonly FramePackageFrameRecord[] =>
	frame.placements.flatMap((placement) =>
		placement.source.variant === "frame-sequence" && placement.visible
			? [
					{
						nodeId: placement.nodeId,
						assetId: placement.assetId,
						buildKey: placement.source.buildKey,
						frameIndex: placement.source.frameIndex,
						blenderFrame: placement.source.blenderFrame,
						packageFrameCount: placement.source.frameCount,
						exact: placement.source.exact,
					},
				]
			: [],
	);

const hideRuntimePlacementNodes = (
	nodes: readonly VectorNode[],
	runtimeNodeIds: ReadonlySet<string>,
): readonly VectorNode[] => {
	let changed = false;
	const next = nodes.map((node) => {
		if (runtimeNodeIds.has(node.id)) {
			changed = true;
			return node.visible ? { ...node, visible: false } : node;
		}
		if (!node.children || node.children.length === 0) return node;
		const children = hideRuntimePlacementNodes(node.children, runtimeNodeIds);
		if (children === node.children) return node;
		changed = true;
		return { ...node, children };
	});
	return changed ? next : nodes;
};

const sceneWithoutRuntimeFallbacks = (
	scene: SceneDocument,
	frame: Runtime3dFrame,
): SceneDocument => {
	const runtimeNodeIds = new Set([
		...frame.placements.map((placement) => placement.nodeId),
		...frame.vectorPlanes
			.filter((plane) => plane.texture !== null)
			.map((plane) => plane.nodeId),
	]);
	let changed = false;
	const layers: readonly SceneLayer[] = scene.layers.map((layer) => {
		const nodes = hideRuntimePlacementNodes(layer.nodes, runtimeNodeIds);
		if (nodes === layer.nodes) return layer;
		changed = true;
		return { ...layer, nodes };
	});
	return changed ? { ...scene, layers } : scene;
};

const exportViewForScene = (scene: SceneDocument) => {
	// Legacy single-artboard documents omit `position` and normalize to
	// { x: 0, y: 0 } — see `Artboard.position`'s own doc comment
	// (`entities/scene/model/types.ts`) and the same defaulting pattern at
	// `entities/agent/model/write.ts`.
	const position = scene.artboard.position ?? { x: 0, y: 0 };
	return {
		width: scene.artboard.width,
		height: scene.artboard.height,
		dpr: 1,
		scale: 1,
		panX: -position.x,
		panY: -position.y,
		rotation: 0,
	};
};

/**
 * Creates a browser-only, export-owned Babylon frame reader. It dynamically
 * crosses the Babylon boundary only after the sampled Scene contains a
 * renderable GLB/GLTF placement. One surface is reused across still/video
 * frames so AssetContainer caching and lifecycle remain adapter-owned.
 */
export function createBrowserRuntime3dFrameCompositor(
	options: {
		/**
		 * S1-C deferral closed: export must resolve linked production artifacts
		 * through the SAME entity contract the canvas uses, or a WebM would keep
		 * exporting the durable source while the canvas shows a regenerated
		 * build. `features/export` cannot import `features/blender-link`
		 * (feature-to-feature), so the owning widget threads the resolver in —
		 * exactly how `ExternalAssetRuntimePreviewLayer` hands it to
		 * `compileRuntime3dFrame`. Absent, every existing caller keeps identical
		 * behavior.
		 */
		readonly resolveProductionArtifact?: Runtime3dProductionArtifactResolver;
	} = {},
): BrowserRuntime3dFrameCompositor {
	const runtimeCanvas = document.createElement("canvas");
	const readbackCanvas = document.createElement("canvas");
	const readbackContext = readbackCanvas.getContext("2d", {
		alpha: true,
		colorSpace: "srgb",
	});
	const readbackSettings = readbackContext?.getContextAttributes?.();
	let readbackCapabilityError: Error | null = null;
	if (readbackSettings?.alpha === false) {
		readbackCapabilityError = new Error("Browser export alpha is unavailable.");
	} else if (
		readbackSettings?.colorSpace &&
		readbackSettings.colorSpace !== "srgb"
	) {
		readbackCapabilityError = new Error(
			"Browser export color space is unavailable.",
		);
	}
	let surface: BabylonRuntimeSurface | null = null;
	let surfacePromise: Promise<BabylonRuntimeSurface> | null = null;
	let surfaceError: unknown = null;
	let failedIssue: ExportIssue | null = null;
	// Non-fatal: reported by the surface when the P6-A candidate environment
	// falls back to the baseline rig. Distinct from `surfaceError`/`failedIssue`
	// — rendering still succeeds, so this only ever gets appended to `issues`,
	// never routed into the failure paths above.
	let environmentIssue: ExportIssue | null = null;
	let disposed = false;

	const disposeSurface = (): void => {
		surface?.dispose();
		surface = null;
		surfacePromise = null;
		environmentIssue = null;
	};

	const ensureSurface = async (): Promise<BabylonRuntimeSurface> => {
		if (surface) return surface;
		if (!surfacePromise) {
			surfacePromise = import("@/shared/babylon").then(
				({ createBabylonRuntimeSurface }) =>
					createBabylonRuntimeSurface(
						runtimeCanvas,
						(error) => {
							surfaceError = error;
						},
						{
							preserveDrawingBuffer: true,
							onIssue: (issue) => {
								environmentIssue = runtimeIssueForExport(issue);
							},
						},
					),
			);
		}
		const created = await surfacePromise;
		if (disposed) {
			created.dispose();
			throw new Error("Browser 3D frame compositor was disposed during load.");
		}
		surface = created;
		return created;
	};

	return {
		prepareFrame: async (scene, frame) => {
			let runtimeFrame = compileRuntime3dFrame({
				scene,
				frame,
				viewport: exportViewForScene(scene),
				...(options.resolveProductionArtifact
					? { resolveProductionArtifact: options.resolveProductionArtifact }
					: {}),
			});
			let issues = runtimeFrame.issues.map(runtimeIssueForExport);
			if (environmentIssue) issues = [...issues, environmentIssue];
			if (runtimeFrame.placements.length === 0) {
				return {
					sceneForSvg: scene,
					overlayCanvas: null,
					issues,
					rendered: false,
					framePackageFrames: [],
				};
			}
			if (!readbackContext || readbackCapabilityError) {
				failedIssue ??= runtimeFailureIssue(
					readbackCapabilityError ??
						new Error("Browser 2D readback canvas is unavailable."),
				);
				return {
					sceneForSvg: scene,
					overlayCanvas: null,
					issues: [...issues, failedIssue],
					rendered: false,
					framePackageFrames: [],
				};
			}
			if (failedIssue) {
				return {
					sceneForSvg: scene,
					overlayCanvas: null,
					issues: [...issues, failedIssue],
					rendered: false,
					framePackageFrames: [],
				};
			}

			const width = Math.max(1, Math.round(scene.artboard.width));
			const height = Math.max(1, Math.round(scene.artboard.height));
			if (runtimeCanvas.width !== width || runtimeCanvas.height !== height) {
				runtimeCanvas.width = width;
				runtimeCanvas.height = height;
			}
			if (readbackCanvas.width !== width || readbackCanvas.height !== height) {
				readbackCanvas.width = width;
				readbackCanvas.height = height;
			}

			try {
				if (surfaceError) throw surfaceError;
				runtimeFrame = await materializeRuntime3dVectorPlaneTextures(
					runtimeFrame,
					(plane) =>
						renderIsolatedNodeSvg({
							scene,
							motion: initialMotionDocument,
							frame: 0,
							rasterSafe: true,
							nodeId: plane.sourceNodeId,
							bounds: plane.rasterBounds,
						}),
				);
				issues = runtimeFrame.issues.map(runtimeIssueForExport);
				const activeSurface = await ensureSurface();
				if (surfaceError) throw surfaceError;
				const runtimeContext =
					runtimeCanvas.getContext("webgl2") ??
					runtimeCanvas.getContext("webgl");
				if (runtimeContext?.getContextAttributes()?.alpha === false) {
					throw new Error("Browser export alpha is unavailable.");
				}
				await activeSurface.renderFrame(runtimeFrame);
				if (surfaceError) throw surfaceError;
				readbackContext.clearRect(0, 0, width, height);
				readbackContext.drawImage(runtimeCanvas, 0, 0, width, height);
				// Reading one pixel is an inexpensive origin-clean gate. A tainted
				// overlay must fail before it contaminates the WebM/PNG canvas.
				readbackContext.getImageData(0, 0, 1, 1);
				if (environmentIssue) issues = [...issues, environmentIssue];
				return {
					sceneForSvg: sceneWithoutRuntimeFallbacks(scene, runtimeFrame),
					overlayCanvas: readbackCanvas,
					issues,
					rendered: true,
					framePackageFrames: framePackageFramesForFrame(runtimeFrame),
				};
			} catch (error) {
				failedIssue = runtimeFailureIssue(error);
				disposeSurface();
				return {
					sceneForSvg: scene,
					overlayCanvas: null,
					issues: [...issues, failedIssue],
					rendered: false,
					framePackageFrames: [],
				};
			}
		},
		dispose: () => {
			if (disposed) return;
			disposed = true;
			const pendingSurface = surface ? null : surfacePromise;
			disposeSurface();
			void pendingSurface
				?.then((pending) => pending.dispose())
				.catch(() => undefined);
			runtimeCanvas.width = 1;
			runtimeCanvas.height = 1;
			readbackCanvas.width = 1;
			readbackCanvas.height = 1;
		},
	};
}
