import { cloneMotionDocument } from "@/entities/motion/model/seed-motion";
import { useMotionStore } from "@/entities/motion/model/store";
import { useMotionGrammarStore } from "@/entities/motion-grammar/model/store";
import { cloneSceneDocument } from "@/entities/scene/model/factory";
import { getNodeParentBounds } from "@/entities/scene/model/rendering";
import { selectCurrentArtboard } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type { Bounds, SceneDocument } from "@/entities/scene/model/types";
import { linkedProductionResolverForScene } from "@/features/blender-link/model/workflow";
import { captureRasterStillFrame } from "@/features/export/adapters/video";
import { scopeSceneToArtboard } from "@/features/export/model/artboards";
import { useTransportStore } from "@/features/motion/model/transport-store";
import { useSelectionStore } from "@/features/selection/model/store";
import {
	createVisualReviewPlan,
	type FrozenVisualReviewSource,
	type VisualReviewCaptureAdapter,
	type VisualReviewCaptureAttempt,
	type VisualReviewPlan,
	type VisualReviewProbeView,
	visualReviewSourceKey,
} from "@/features/visual-review";
import { stableHashValue } from "@/shared/cache";

/** One frozen editor source paired with its source-checking capture adapter. */
export type EditorVisualReviewSession = {
	readonly plan: VisualReviewPlan;
	readonly captureAdapter: VisualReviewCaptureAdapter;
};

const MAX_REVIEW_RAW_BYTES = 256 * 1024 * 1024;

const editorSource = (): FrozenVisualReviewSource => {
	const scene = useSceneStore.getState().document;
	const motion = useMotionStore.getState().document;
	const grammar = useMotionGrammarStore.getState().document;
	const artboard = selectCurrentArtboard(scene);
	const frame = Math.min(
		Math.max(0, Math.round(useTransportStore.getState().currentFrame)),
		Math.max(0, motion.durationFrames - 1),
	);
	return {
		sceneRevision: stableHashValue(scene),
		motionRevision: stableHashValue({ motion, grammar }),
		artboardId: artboard.id,
		frame,
		width: artboard.width,
		height: artboard.height,
		pixelRatio: 1,
	};
};

const normalizedSelectionProbe = (
	scene: SceneDocument,
	artboardWidth: number,
	artboardHeight: number,
): VisualReviewProbeView | null => {
	const primaryId = useSelectionStore.getState().primary;
	if (!primaryId) return null;
	const topLevelNode = scene.layers
		.flatMap((layer) => layer.nodes)
		.find((node) => node.id === primaryId);
	if (!topLevelNode) return null;
	const bounds = getNodeParentBounds(topLevelNode);
	const padded = paddedBounds(bounds, artboardWidth, artboardHeight);
	if (!padded) return null;
	return {
		id: "selected-edge",
		role: "probe",
		label: "Selected edge",
		rect: padded,
	};
};

const paddedBounds = (
	bounds: Bounds,
	artboardWidth: number,
	artboardHeight: number,
): VisualReviewProbeView["rect"] | null => {
	if (
		![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
		bounds.width <= 0 ||
		bounds.height <= 0 ||
		artboardWidth <= 0 ||
		artboardHeight <= 0
	) {
		return null;
	}
	const pad = Math.max(4, Math.min(bounds.width, bounds.height) * 0.12);
	const left = Math.max(0, bounds.x - pad);
	const top = Math.max(0, bounds.y - pad);
	const right = Math.min(artboardWidth, bounds.x + bounds.width + pad);
	const bottom = Math.min(artboardHeight, bounds.y + bounds.height + pad);
	if (right <= left || bottom <= top) return null;
	return {
		x: left / artboardWidth,
		y: top / artboardHeight,
		width: (right - left) / artboardWidth,
		height: (bottom - top) / artboardHeight,
	};
};

const currentSourceKey = (): string => visualReviewSourceKey(editorSource());

const captureFailure = (
	code: Extract<
		VisualReviewCaptureAttempt,
		{ status: "failed" }
	>["failure"]["code"],
	message: string,
	retryable = false,
): VisualReviewCaptureAttempt => ({
	status: "failed",
	failure: { code, message, retryable },
});

const errorCaptureFailure = (error: unknown): VisualReviewCaptureAttempt => {
	const message =
		error instanceof Error ? error.message : "Still capture failed.";
	if (error instanceof DOMException && error.name === "SecurityError") {
		return captureFailure(
			"tainted_canvas",
			"A cross-origin asset prevented pixel inspection.",
			false,
		);
	}
	if (/blank/i.test(message))
		return captureFailure("blank_frame", message, true);
	if (/GPU|context/i.test(message)) {
		return captureFailure("context_lost", message, true);
	}
	if (/encode/i.test(message)) return captureFailure("encode_failed", message);
	return captureFailure("capture_unsupported", message);
};

const monochromePng = async (
	blob: Blob,
	width: number,
	height: number,
): Promise<Blob> => {
	const url = URL.createObjectURL(blob);
	try {
		const image = new Image();
		image.decoding = "sync";
		image.src = url;
		await image.decode();
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext("2d", { alpha: true });
		if (!context)
			throw new Error("Monochrome diagnostic canvas is unavailable.");
		context.drawImage(image, 0, 0, width, height);
		const pixels = context.getImageData(0, 0, width, height);
		for (let index = 0; index < pixels.data.length; index += 4) {
			const luminance = Math.round(
				(pixels.data[index] ?? 0) * 0.2126 +
					(pixels.data[index + 1] ?? 0) * 0.7152 +
					(pixels.data[index + 2] ?? 0) * 0.0722,
			);
			pixels.data[index] = luminance;
			pixels.data[index + 1] = luminance;
			pixels.data[index + 2] = luminance;
		}
		context.putImageData(pixels, 0, 0);
		return await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob((result) => {
				if (result && result.size > 0) resolve(result);
				else reject(new Error("Monochrome diagnostic could not be encoded."));
			}, "image/png");
		});
	} finally {
		URL.revokeObjectURL(url);
	}
};

const renderFrozenBaseline = async ({
	scene,
	motion,
	frame,
	grammarBindings,
}: Parameters<typeof captureRasterStillFrame>[0]) => {
	const resolveProductionArtifact = linkedProductionResolverForScene(scene);
	const input = {
		scene,
		motion,
		frame,
		grammarBindings,
		...(resolveProductionArtifact ? { resolveProductionArtifact } : {}),
	};
	try {
		return await captureRasterStillFrame(input);
	} catch (error) {
		const message = error instanceof Error ? error.message : "";
		if (!/blank|GPU|context/i.test(message)) throw error;
		return await captureRasterStillFrame(input);
	}
};

/**
 * Freezes the current Vecmo frame and binds the review workspace to the same
 * SVG + GPU raster path used for video frames. Live store hashes are checked
 * before and after capture so a later edit cannot be mislabeled as this packet.
 */
export function createEditorVisualReviewSession(): EditorVisualReviewSession | null {
	const source = editorSource();
	const sourceKey = visualReviewSourceKey(source);
	const scene = cloneSceneDocument(useSceneStore.getState().document);
	const scopedScene = scopeSceneToArtboard(scene, source.artboardId);
	if (!scopedScene) return null;
	const motion = cloneMotionDocument(useMotionStore.getState().document);
	const grammarBindings = structuredClone(
		useMotionGrammarStore.getState().document.bindings,
	);
	const selectionProbe = normalizedSelectionProbe(
		scopedScene,
		source.width,
		source.height,
	);
	const planResult = createVisualReviewPlan({
		source,
		probes: selectionProbe ? [selectionProbe] : [],
		diagnostics: [
			{ id: "monochrome", label: "Monochrome", kind: "monochrome" },
		],
	});
	if (planResult.status === "blocked") return null;

	let baselinePromise: ReturnType<typeof renderFrozenBaseline> | null = null;
	const captureAdapter: VisualReviewCaptureAdapter = async (request) => {
		if (
			request.sourceKey !== sourceKey ||
			visualReviewSourceKey(request.source) !== sourceKey ||
			currentSourceKey() !== sourceKey
		) {
			return captureFailure(
				"source_changed",
				"The editor source changed after this review packet was frozen.",
			);
		}
		if (request.diagnostic?.kind === "bypass-contribution") {
			return {
				status: "not-rendered",
				sourceKey,
				disposition: "blocked_owner_ambiguous",
				message:
					"This contribution cannot be bypassed without a stable sampled override owner.",
			};
		}
		if (
			request.source.width *
				request.source.height *
				request.source.pixelRatio ** 2 *
				4 >
			MAX_REVIEW_RAW_BYTES
		) {
			return captureFailure(
				"memory_budget_exceeded",
				"The requested review surface exceeds the 256 MiB raw-pixel budget.",
			);
		}
		try {
			baselinePromise ??= renderFrozenBaseline({
				scene: scopedScene,
				motion,
				frame: source.frame,
				grammarBindings,
			});
			const baseline = await baselinePromise;
			if (currentSourceKey() !== sourceKey) {
				return captureFailure(
					"source_changed",
					"The editor source changed while pixels were being captured.",
				);
			}
			if (request.diagnostic?.kind === "monochrome") {
				const blob = await monochromePng(
					baseline.blob,
					baseline.width,
					baseline.height,
				);
				baselinePromise = null;
				if (currentSourceKey() !== sourceKey) {
					return captureFailure(
						"source_changed",
						"The editor source changed while a diagnostic was being derived.",
					);
				}
				return {
					status: "captured",
					sourceKey,
					blob,
					width: baseline.width,
					height: baseline.height,
					fidelity: {
						status: "capture-only",
						renderer: "vecmo-still-monochrome-diagnostic",
						issues: [],
					},
					completedPassIds: baseline.completedPassIds,
				};
			}
			const issueCodes = [
				...new Set(baseline.issues.map((issue) => issue.code)),
			];
			return {
				status: "captured",
				sourceKey,
				blob: baseline.blob,
				width: baseline.width,
				height: baseline.height,
				fidelity: {
					status: issueCodes.length === 0 ? "native" : "approximated",
					renderer: "vecmo-svg-gpu-still",
					issues: issueCodes,
				},
				completedPassIds: baseline.completedPassIds,
			};
		} catch (error) {
			baselinePromise = null;
			return errorCaptureFailure(error);
		}
	};

	return { plan: planResult.plan, captureAdapter };
}
