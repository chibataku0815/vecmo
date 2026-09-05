// Type-only: erased by `verbatimModuleSyntax`, so this never pulls the
// mediabunny runtime into the always-loaded editor bundle. The runtime itself
// is loaded lazily inside `encodeFramesWithMediabunny`/`canUseFrameDrivenVideoEncoder`.
import type { AudioCodec, VideoCodec } from "mediabunny";
import { initialMotionDocument } from "@/entities/motion/model/seed-motion";
import type { MotionDocument } from "@/entities/motion/model/types";
import type { MotionGrammarBinding } from "@/entities/motion-grammar/model/types";
import { resolveAudibleAudioTracks } from "@/entities/scene/model/audio";
import {
	buildSceneCompositePlan,
	type CompositePlanReport,
	compositePlanReport,
	sceneForCompositeRun,
} from "@/entities/scene/model/composite-band";
import type { Runtime3dProductionArtifactResolver } from "@/entities/scene/model/runtime-3d";
import {
	mapGlobalFrameToSequenceItem,
	resolveSequenceTimeline,
	type SceneSequenceTimeline,
} from "@/entities/scene/model/sequence";
import { artboardBackgroundIsTransparent } from "@/entities/scene/model/style-resolve";
import { canvasTextLineMeasurer } from "@/entities/scene/model/text-measure";
import type { SceneDocument } from "@/entities/scene/model/types";
import {
	createGpuRasterSurface,
	type GpuRasterSurface,
} from "@/shared/gpu-lens/surface";
import type {
	ExportArtboardScopeInput,
	ResolvedExportArtboard,
	ResolvedExportArtboardScope,
} from "../model/artboards";
import {
	resolveExportArtboardScope,
	scopeSceneToArtboard,
} from "../model/artboards";
import { buildExportAudioMix } from "../model/audio-mix";
import {
	type FramePackageDeliveryEncoder,
	type FramePackageDeliveryReport,
	type FramePackageFrameRecord,
	framePackageDeliveryReport,
} from "../model/frame-package-delivery";
import type { ExportIssue } from "../model/issues";
import { fileStemForScene } from "../model/json";
import {
	type ProgramSurfaceStaticOutputDeliveryManifest,
	projectProgramSurfacesForVideo,
} from "../model/program-surface-static-output";
import {
	buildRasterPasses,
	buildRasterTree,
	buildScopedDeepGlowPlan,
	buildScopedPathBlurTargets,
	sceneNeedsGpuSurface,
} from "../model/raster-passes";
import { buildExportRenderPresentation } from "../model/render-presentation";
import {
	renderIsolatedNodeSetSvg,
	renderIsolatedNodeSvg,
	renderSceneSvgWithIssues,
} from "../model/svg";
import {
	createWebmVideoExportPlan,
	WEBM_VIDEO_EXPORT_FORMAT,
	WEBM_VIDEO_MIME_TYPE_CANDIDATES,
	type WebmVideoExportPlan,
} from "../model/video";
import { materializeVideoAssetFrames } from "../model/video-frame-materialize";
import {
	type BrowserRuntime3dFrameCompositor,
	createBrowserRuntime3dFrameCompositor,
} from "./browser-runtime-3d-frame";
import { downloadBlob } from "./download";

export type WebmVideoExportResult = {
	readonly fileName: string;
	readonly mimeType: string;
	readonly blob: Blob;
	readonly frameCount: number;
	readonly fps: number;
	readonly issues: readonly ExportIssue[];
	/** Source-free Program Surface delivery facts applied during this capture. */
	readonly programSurfaceDelivery?: ProgramSurfaceStaticOutputDeliveryManifest<"video">;
	/** Artboard composite plan shape this capture actually composited (経路A). */
	readonly compositePlan?: CompositePlanReport;
	/**
	 * S4-D: what this capture delivered out of a rendered Blender frame package,
	 * including whether it may be claimed exact. Absent when the document links
	 * no rendered production.
	 */
	readonly framePackageDelivery?: FramePackageDeliveryReport;
};

export type RasterStillFrameResult = {
	readonly blob: Blob;
	readonly width: number;
	readonly height: number;
	readonly issues: readonly ExportIssue[];
	/** Source-free Program Surface delivery facts applied during this capture. */
	readonly programSurfaceDelivery?: ProgramSurfaceStaticOutputDeliveryManifest<"video">;
	readonly completedPassIds: readonly string[];
	/** Artboard composite plan shape this capture actually composited (経路A). */
	readonly compositePlan?: CompositePlanReport;
};

export type RecordWebmVideoExportInput = {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly artboardScope?: ExportArtboardScopeInput;
	readonly grammarBindings?: readonly MotionGrammarBinding[];
	/**
	 * Linked-production artifact resolver, injected by the invoking widget. See
	 * `createBrowserRuntime3dFrameCompositor`'s option doc for why export cannot
	 * reach the owning feature store itself.
	 */
	readonly resolveProductionArtifact?: Runtime3dProductionArtifactResolver;
};

const delay = (durationMs: number): Promise<void> =>
	new Promise((resolve) => window.setTimeout(resolve, durationMs));

const chooseWebmMimeType = (): string => {
	if (typeof MediaRecorder === "undefined") {
		throw new Error(
			"This browser does not support MediaRecorder video export.",
		);
	}
	for (const mimeType of WEBM_VIDEO_MIME_TYPE_CANDIDATES) {
		if (MediaRecorder.isTypeSupported(mimeType)) return mimeType;
	}
	throw new Error("This browser cannot record WebM from the editor canvas.");
};

const loadSvgImage = async (svg: string): Promise<HTMLImageElement> => {
	const url = URL.createObjectURL(
		new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
	);
	try {
		const image = new Image();
		image.decoding = "sync";
		image.src = url;
		await image.decode();
		return image;
	} finally {
		URL.revokeObjectURL(url);
	}
};

const recorderData = (recorder: MediaRecorder): Promise<readonly Blob[]> =>
	new Promise((resolve, reject) => {
		const chunks: Blob[] = [];
		recorder.addEventListener("dataavailable", (event) => {
			if (event.data.size > 0) chunks.push(event.data);
		});
		recorder.addEventListener("stop", () => resolve(chunks), { once: true });
		recorder.addEventListener(
			"error",
			() => reject(new Error("WebM export failed while recording frames.")),
			{ once: true },
		);
	});

// The frame-driven encoder's codec choice mirrors this file's existing
// MediaRecorder mime-type preference (`WEBM_VIDEO_MIME_TYPE_CANDIDATES[0]` is
// `"video/webm;codecs=vp9"`), so the output stays the same container/codec
// family regardless of which capture path actually ran.
const FRAME_DRIVEN_VIDEO_CODEC: VideoCodec = "vp9";
const FRAME_DRIVEN_VIDEO_MIME_TYPE = "video/webm;codecs=vp9";

/**
 * S5a minimal audio lane mux codec. Opus is WebM-native and mediabunny's
 * `AUDIO_CODECS` registry lists it directly; no separate MediaRecorder
 * fallback path carries audio (see `frameDrivenAudioEncoderUnsupportedIssue`).
 */
const FRAME_DRIVEN_AUDIO_CODEC: AudioCodec = "opus";
/**
 * Opus stereo bitrate comparable to typical "good quality" web presets. This
 * V1 lane targets narration/SFX-scale export audio, not a mastered music bed.
 */
const AUDIO_ENCODE_BITRATE = 128_000;

/**
 * Bits of VP9 payload budgeted per pixel per encoded frame. MediaRecorder
 * never exposed a bitrate knob for `canvas.captureStream()` — the browser
 * picked one internally and it varied by build — so this is a fresh,
 * documented choice rather than a port of an existing number. 0.06 bit/px/frame
 * lands a 1280x720@30fps export around 1.66 Mbps, comparable to typical "high
 * quality" web VP9 presets; exported content here is flat vector fills and
 * occasional GPU raster overlays, which compress far below natural video at
 * the same nominal bitrate, so this is a conservative (quality-favoring)
 * starting point. See the video export verification report for the measured
 * file-size/PSNR comparison against the MediaRecorder path this replaces.
 */
const VIDEO_ENCODE_BITS_PER_PIXEL_PER_FRAME = 0.06;
const MIN_VIDEO_ENCODE_BITRATE = 500_000;
const MAX_VIDEO_ENCODE_BITRATE = 20_000_000;

const computeVideoEncodeBitrate = (
	width: number,
	height: number,
	fps: number,
): number => {
	const raw = width * height * fps * VIDEO_ENCODE_BITS_PER_PIXEL_PER_FRAME;
	return Math.min(
		MAX_VIDEO_ENCODE_BITRATE,
		Math.max(MIN_VIDEO_ENCODE_BITRATE, Math.round(raw)),
	);
};

/**
 * Probes whether this browser can encode the frame-driven export's exact
 * codec/alpha/resolution config via WebCodecs. Checking `VideoEncoder`
 * directly (not just delegating to mediabunny's own probe) is what lets a
 * test stub `VideoEncoder = undefined` and deterministically force the
 * MediaRecorder fallback below.
 */
const canUseFrameDrivenVideoEncoder = async (
	width: number,
	height: number,
): Promise<boolean> => {
	if (typeof VideoEncoder === "undefined") return false;
	try {
		const { canEncodeVideo } = await import("mediabunny");
		return await canEncodeVideo(FRAME_DRIVEN_VIDEO_CODEC, {
			width,
			height,
			alpha: "keep",
		});
	} catch {
		return false;
	}
};

const GPU_RASTER_COMPOSITING_LOST_ISSUE: ExportIssue = {
	severity: "warning",
	category: "unsupported",
	code: "gpu-raster-compositing-lost",
	message:
		"GPU raster Look passes could not be composited into this recording (WebGL unavailable or its context was lost mid-capture); the video contains the SVG-only frames. Close other GPU-heavy tabs/windows and export again.",
	fallback: "local-raster-required",
};

const frameDrivenVideoUnsupportedIssue = (): ExportIssue => ({
	severity: "warning",
	category: "fallback",
	code: "video-frame-driven-encoder-unsupported",
	message:
		"This browser does not support WebCodecs frame-driven video encoding for this resolution/codec; the export used the real-time MediaRecorder capture path instead.",
	fallback: "real-time-capture",
});

/**
 * S4-D gate. A rendered frame package promises frame identity, so a capture that
 * cannot stand behind that promise must say so rather than shipping a file whose
 * exactness a reader would otherwise assume. The MediaRecorder branch is the
 * dangerous one: it is sampled on the compositor's wall clock, and this program
 * measured 70 of 180 frames surviving it. The pixels are still real and still
 * ship — what is withheld is the claim.
 */
const framePackageExactnessBlockedIssue = (
	report: FramePackageDeliveryReport,
): ExportIssue => ({
	severity: "error",
	category: "fallback",
	code: "frame-package-exactness-blocked",
	message: `The rendered Blender frame package (build ${report.buildKeys.join(", ")}) cannot back an exact export in this capture (${report.blockedCodes.join(", ")}); ${report.deliveredFrameCount} of ${report.requestedFrameCount} composed frames carried package pixels through the ${report.encoder} encoder.`,
	fallback: "frame-package-exactness-blocked",
});

const frameDrivenVideoEncodeFailedIssue = (error: unknown): ExportIssue => {
	const detail =
		error instanceof Error ? `${error.name}: ${error.message}` : String(error);
	return {
		severity: "warning",
		category: "fallback",
		code: "video-frame-driven-encoder-failed",
		message: `The frame-driven WebCodecs video encoder failed (${detail}); the export fell back to the real-time MediaRecorder capture path.`,
		fallback: "real-time-capture",
	};
};

const FRAME_DRIVEN_AUDIO_ENCODER_UNSUPPORTED_ISSUE: ExportIssue = {
	severity: "warning",
	category: "fallback",
	code: "audio-frame-driven-encoder-unsupported",
	message:
		"This browser cannot encode Opus audio for the frame-driven WebM export; the export completed video-only.",
	fallback: "audio-track-omitted",
};

/**
 * Encodes `frameCount` frames read off `canvas` into a single VP9/WebM Blob
 * using WebCodecs, via mediabunny's muxer. Each frame's presentation
 * timestamp is derived purely from its sequential output index and `fps`
 * (`index / fps` seconds) — never from wall-clock time — so the frame count
 * and timestamps are exact regardless of how long `drawFrame` takes to
 * render any single frame. `drawFrame` must leave the fully composited frame
 * on `canvas` before it resolves; this function calls `CanvasSource.add()`
 * synchronously right after, so (unlike `canvas.captureStream()`) there is no
 * async sampling race with a mid-build canvas.
 *
 * mediabunny is imported dynamically here so it costs nothing in the
 * always-loaded editor bundle — only an actual WebM video export pulls it in.
 *
 * S5a minimal audio lane: `audioBuffer`, when provided, is one already-mixed
 * buffer covering the whole export range (built by
 * `../model/audio-mix.ts::buildExportAudioMix`, on the same frame-anchored
 * clock the preview driver schedules from). It is fed to mediabunny's
 * `AudioBufferSource` in a single `add()` call — unlike the per-frame video
 * source, audio is not resampled per frame. A browser that cannot encode the
 * chosen codec at this buffer's channel/sample rate mixes video-only and
 * reports a typed issue rather than failing the whole export.
 */
const encodeFramesWithMediabunny = async ({
	width,
	height,
	fps,
	frameCount,
	canvas,
	drawFrame,
	audioBuffer,
}: {
	readonly width: number;
	readonly height: number;
	readonly fps: number;
	readonly frameCount: number;
	readonly canvas: HTMLCanvasElement;
	readonly drawFrame: (frameIndex: number) => Promise<void>;
	readonly audioBuffer?: AudioBuffer | null;
}): Promise<{
	readonly blob: Blob;
	readonly issues: readonly ExportIssue[];
}> => {
	const {
		Output,
		WebMOutputFormat,
		BufferTarget,
		CanvasSource,
		AudioBufferSource,
		Quality,
		canEncodeAudio,
	} = await import("mediabunny");
	const target = new BufferTarget();
	const output = new Output({ format: new WebMOutputFormat(), target });
	const source = new CanvasSource(canvas, {
		codec: FRAME_DRIVEN_VIDEO_CODEC,
		quality: new Quality({
			bitrate: computeVideoEncodeBitrate(width, height, fps),
		}),
		alpha: "keep",
	});
	output.addVideoTrack(source);

	const issues: ExportIssue[] = [];
	let audioSource: InstanceType<typeof AudioBufferSource> | null = null;
	if (audioBuffer) {
		const canEncode = await canEncodeAudio(FRAME_DRIVEN_AUDIO_CODEC, {
			numberOfChannels: audioBuffer.numberOfChannels,
			sampleRate: audioBuffer.sampleRate,
		}).catch(() => false);
		if (canEncode) {
			audioSource = new AudioBufferSource({
				codec: FRAME_DRIVEN_AUDIO_CODEC,
				quality: new Quality({ bitrate: AUDIO_ENCODE_BITRATE }),
			});
			output.addAudioTrack(audioSource);
		} else {
			issues.push(FRAME_DRIVEN_AUDIO_ENCODER_UNSUPPORTED_ISSUE);
		}
	}

	await output.start();
	if (audioSource && audioBuffer) {
		await audioSource.add(audioBuffer);
		audioSource.close();
	}
	const frameDurationSeconds = 1 / Math.max(1, fps);
	for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
		await drawFrame(frameIndex);
		await source.add(frameIndex * frameDurationSeconds, frameDurationSeconds);
	}
	source.close();
	await output.finalize();
	if (!target.buffer) {
		throw new Error(
			"The frame-driven video encoder did not produce an output buffer.",
		);
	}
	return {
		blob: new Blob([target.buffer], { type: FRAME_DRIVEN_VIDEO_MIME_TYPE }),
		issues,
	};
};

const issueKey = (issue: ExportIssue): string =>
	[
		issue.code,
		issue.artboardId ?? "",
		issue.layerId ?? "",
		issue.nodeId ?? "",
		issue.message,
	].join("\u0000");

const addUniqueIssues = (
	target: ExportIssue[],
	issues: readonly ExportIssue[],
): void => {
	const seen = new Set(target.map(issueKey));
	for (const issue of issues) {
		const key = issueKey(issue);
		if (seen.has(key)) continue;
		seen.add(key);
		target.push(issue);
	}
};

const sequenceTimelineForScope = ({
	scene,
	motion,
	resolved,
}: {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly resolved: ResolvedExportArtboardScope;
}): SceneSequenceTimeline | null => {
	if (!scene.sequence) return null;
	const allowedArtboardIds = new Set(
		resolved.targets.map((target) => target.metadata.id),
	);
	const scopedSequence = {
		...scene.sequence,
		items: scene.sequence.items.filter((item) =>
			allowedArtboardIds.has(item.artboardId),
		),
	};
	if (scopedSequence.items.length === 0) return null;
	const timeline = resolveSequenceTimeline({
		scene,
		sequence: scopedSequence,
		motion,
	});
	return timeline.items.length > 1 ? timeline : null;
};

const sequenceVideoPlan = (
	scene: SceneDocument,
	timeline: SceneSequenceTimeline,
): WebmVideoExportPlan | null => {
	const firstItem = timeline.items[0];
	if (!firstItem || timeline.totalFrames <= 0) return null;
	const exportSize = timeline.sequence?.exportSize;
	const width = Math.max(
		1,
		Math.round(exportSize?.width ?? firstItem.artboard.width),
	);
	const height = Math.max(
		1,
		Math.round(exportSize?.height ?? firstItem.artboard.height),
	);
	const endFrame = timeline.totalFrames - 1;
	return {
		exportFormat: WEBM_VIDEO_EXPORT_FORMAT,
		fileName: `${fileStemForScene(scene)}.sequence.motion.webm`,
		width,
		height,
		fps: Math.max(1, Math.round(timeline.fps)),
		durationFrames: timeline.totalFrames,
		startFrame: 0,
		endFrame,
		stepFrames: 1,
		frames: Array.from({ length: timeline.totalFrames }, (_, frame) => frame),
	};
};

type DrawRasterFrameResult = {
	readonly issues: readonly ExportIssue[];
	readonly runtime3dRendered: boolean;
	/** Composite plan shape observed for this frame (fidelity report input). */
	readonly compositePlan: CompositePlanReport;
	/** Rendered frame-package frames this composite carried (S4-D evidence). */
	readonly framePackageFrames: readonly FramePackageFrameRecord[];
};

/**
 * Monotonic identity for the merged 2D canvas handed to the GPU finish. A canvas
 * has no value identity the surface can cache on, so a fresh revision per drawn
 * frame is what stops a stale source texture from surviving into the next one.
 */
let compositeSourceRevision = 0;

const drawSvgFrame = async ({
	canvas,
	context,
	scene,
	motion,
	frame,
	grammarBindings,
	lensSurface,
	pathBlurSurface,
	runtime3dCompositor,
}: {
	readonly canvas: HTMLCanvasElement;
	readonly context: CanvasRenderingContext2D;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frame: number;
	readonly grammarBindings?: readonly MotionGrammarBinding[];
	readonly lensSurface?: GpuRasterSurface | null;
	/** Shared, reused across every scoped Path Blur target and every frame. */
	readonly pathBlurSurface?: GpuRasterSurface | null;
	readonly runtime3dCompositor?: BrowserRuntime3dFrameCompositor | null;
}): Promise<DrawRasterFrameResult> => {
	// Pass the browser measurer so split text-animator fragments land where the
	// editor placed them; the rasterized WebM then matches the authored layout.
	// `rasterSafe` bakes explicit SMIL particle Motion to this frame; Linear
	// fields still use inlined data-URL ramps, so authored direction survives
	// `<img>` capture.
	const timeSeconds = frame / Math.max(1, motion.fps);
	const sampledPresentation = buildExportRenderPresentation({
		scene,
		motion,
		frame,
		grammarBindings,
	});
	const sampledScene = await materializeVideoAssetFrames(
		sampledPresentation.scene,
		timeSeconds,
	);
	const runtime3dComposition = runtime3dCompositor
		? await runtime3dCompositor.prepareFrame(
				sampledScene,
				sampledPresentation.frame,
			)
		: null;
	const compositedScene = runtime3dComposition?.sceneForSvg ?? sampledScene;
	// Artboard composite plan V1 (経路A). The plan is derived from the SAMPLED
	// scene, before `sceneForSvg` hides the placement nodes — hiding them first
	// would erase the very nodes that define the band.
	const compositePlan = buildSceneCompositePlan(sampledScene);
	const overlayCanvas = runtime3dComposition?.overlayCanvas ?? null;
	// A front run only exists as a separate raster when there are 3D pixels to
	// put it above. If Babylon rendered nothing (no placement, or a failure that
	// left the declared preview in the SVG), the single-raster path stays exactly
	// as it was — that is the non-3D compatibility invariant.
	const compositeFrontRun = Boolean(overlayCanvas) && compositePlan.hasFrontRun;
	const deferGpuRasterEffects =
		Boolean(lensSurface) || Boolean(pathBlurSurface);
	const backScene = compositeFrontRun
		? sceneForCompositeRun(compositedScene, compositePlan, "back")
		: compositedScene;
	const renderPresentation =
		backScene === sampledPresentation.scene
			? sampledPresentation
			: { ...sampledPresentation, scene: backScene };
	const result = renderSceneSvgWithIssues({
		scene,
		motion,
		frame,
		grammarBindings,
		renderPresentation,
		measurer: canvasTextLineMeasurer,
		rasterSafe: true,
		deferGpuRasterEffects,
	});
	const svg = result.contents;
	const image = await loadSvgImage(svg);
	context.clearRect(0, 0, canvas.width, canvas.height);
	context.drawImage(image, 0, 0, canvas.width, canvas.height);
	// 経路A step 2 and 3: the 3D band lands on the back plate, then the front run
	// is rasterized against transparency and composited over it. This is the
	// whole point of the double raster — mask, matte, and Look INSIDE each vector
	// run keep working because each run goes through the unmodified SVG renderer.
	// Both draws happen BEFORE the frame finish below, which is what finally lets
	// the artboard Look reach 3D pixels.
	if (overlayCanvas) {
		context.drawImage(overlayCanvas, 0, 0, canvas.width, canvas.height);
	}
	const frontIssues: readonly ExportIssue[] = compositeFrontRun
		? await (async () => {
				const frontScene = sceneForCompositeRun(
					compositedScene,
					compositePlan,
					"front",
				);
				const frontResult = renderSceneSvgWithIssues({
					scene,
					motion,
					frame,
					grammarBindings,
					renderPresentation: { ...sampledPresentation, scene: frontScene },
					// The back plate already painted the artboard background; painting it
					// again here would hide the 3D band the front run must sit above.
					transparentBackground: true,
					measurer: canvasTextLineMeasurer,
					rasterSafe: true,
					deferGpuRasterEffects,
				});
				const frontImage = await loadSvgImage(frontResult.contents);
				context.drawImage(frontImage, 0, 0, canvas.width, canvas.height);
				return frontResult.issues;
			})()
		: [];
	// When anything has been composited into the canvas that the SVG prefix does
	// not contain (the 3D band, the front run), the GPU finish must read the
	// MERGED canvas rather than re-rasterizing the prefix — otherwise `copy`
	// below would replace the composite with a back-plate-only frame.
	compositeSourceRevision += 1;
	const compositedSource = overlayCanvas
		? { canvas, revision: `${frame}:${compositeSourceRevision}` }
		: undefined;
	// Both the frame lens and per-object Path Blur are GPU raster-finish effects
	// with no SVG path, so they composite here on top of the rasterized frame.
	// Params are sampled per frame (via the export presentation) so a keyframed
	// effect animates in the video too.
	const rasterOptions = { timeSeconds };
	if (lensSurface) {
		const tree = buildRasterTree(compositedScene, rasterOptions);
		const passes = tree
			? []
			: buildRasterPasses(compositedScene, rasterOptions);
		const scopedGlow =
			!tree && passes.length === 0
				? buildScopedDeepGlowPlan(compositedScene, rasterOptions)
				: null;
		if (scopedGlow) {
			// The scene has already been sampled at this export frame. Render only
			// the target-owned, post-material pixels against transparency, then let
			// the same linear-light kernel used by the editor composite that radiance
			// over the completed artboard. Source Optics and the background stay in
			// the base and therefore cannot be re-bloomed by a selection-scoped Look.
			const emissionSvg = renderIsolatedNodeSetSvg({
				scene: compositedScene,
				motion: initialMotionDocument,
				frame: 0,
				measurer: canvasTextLineMeasurer,
				rasterSafe: true,
				nodeIds: scopedGlow.targetNodeIds,
				excludedScopedLookId: scopedGlow.overlayId,
			});
			if (emissionSvg) {
				await lensSurface.renderScopedGlow({
					baseSvg: svg,
					emissionSvg,
					pass: scopedGlow.pass,
					...(compositedSource ? { baseCanvas: compositedSource } : {}),
				});
				// `renderScopedGlow`'s own output already IS the complete composited
				// frame (base + glow, blended in linear light inside the GPU kernel —
				// see `ScopedGlowCompositePipeline`'s doc comment), meant to REPLACE
				// the crisp base raster drawn at `context.drawImage(image, ...)`
				// above, not blend on top of it. `source-over` here would
				// double-composite the same content against itself (2a-a^2 in every
				// channel wherever both layers carry partial alpha); `copy` performs
				// the intended full-frame replacement. Restored immediately after so
				// no later draw in this function is affected.
				context.globalCompositeOperation = "copy";
				context.drawImage(
					lensSurface.canvas,
					0,
					0,
					canvas.width,
					canvas.height,
				);
				context.globalCompositeOperation = "source-over";
			}
		} else if (tree) {
			await lensSurface.renderTree({
				svgPrefix: svg,
				root: tree,
				...(compositedSource ? { sourceCanvas: compositedSource } : {}),
			});
			// Same replacement, not overlay: the tree evaluator processes the
			// SAME `svg` this function already drew as its own source texture and
			// its output is the fully-processed frame — see the doc comment above.
			context.globalCompositeOperation = "copy";
			context.drawImage(lensSurface.canvas, 0, 0, canvas.width, canvas.height);
			context.globalCompositeOperation = "source-over";
		} else if (passes.length > 0) {
			await lensSurface.renderPipeline({
				svgPrefix: svg,
				passes,
				...(compositedSource ? { sourceCanvas: compositedSource } : {}),
			});
			// Same replacement, not overlay — see the doc comment above.
			context.globalCompositeOperation = "copy";
			context.drawImage(lensSurface.canvas, 0, 0, canvas.width, canvas.height);
			context.globalCompositeOperation = "source-over";
		}
	}
	if (pathBlurSurface) {
		const targets = buildScopedPathBlurTargets(compositedScene, rasterOptions);
		for (const target of targets) {
			// `compositedScene` is already sampled at this frame's pose. Pass the
			// no-track `initialMotionDocument` (not the real animated `motion`)
			// so `renderIsolatedNodeSvg`'s own presentation build doesn't
			// re-sample the target back to frame 0 — same pattern the editor's
			// live overlay uses.
			const cropSvg = await renderIsolatedNodeSvg({
				scene: compositedScene,
				motion: initialMotionDocument,
				frame: 0,
				nodeId: target.nodeId,
				bounds: target.bounds,
			});
			if (!cropSvg) continue;
			const cropWidth = Math.max(1, Math.round(target.bounds.width));
			const cropHeight = Math.max(1, Math.round(target.bounds.height));
			pathBlurSurface.resize(cropWidth, cropHeight);
			await pathBlurSurface.renderPipeline({
				svgPrefix: cropSvg,
				passes: [{ nodeId: target.nodeId, params: target.params }],
			});
			context.drawImage(
				pathBlurSurface.canvas,
				target.bounds.x,
				target.bounds.y,
				cropWidth,
				cropHeight,
			);
		}
	}
	// The 3D band is deliberately NOT drawn here any more. It is composited above
	// (between the back and front rasters) so the frame finish runs over the
	// merged result — 経路A step 4.
	const issues: ExportIssue[] = [
		...result.issues,
		...(runtime3dComposition?.issues ?? []),
	];
	addUniqueIssues(issues, frontIssues);
	return {
		issues,
		runtime3dRendered: runtime3dComposition?.rendered ?? false,
		compositePlan: compositePlanReport(compositePlan),
		framePackageFrames: runtime3dComposition?.framePackageFrames ?? [],
	};
};

const encodeCanvasPng = (canvas: HTMLCanvasElement): Promise<Blob> =>
	new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob && blob.size > 0) {
				resolve(blob);
				return;
			}
			reject(new Error("The rendered review frame could not be encoded."));
		}, "image/png");
	});

const canvasHasVisiblePixels = (
	context: CanvasRenderingContext2D,
	width: number,
	height: number,
): boolean => {
	const pixels = context.getImageData(0, 0, width, height).data;
	for (let alphaIndex = 3; alphaIndex < pixels.length; alphaIndex += 4) {
		if ((pixels[alphaIndex] ?? 0) > 0) return true;
	}
	return false;
};

const pixelBuffersEqual = (
	a: Uint8ClampedArray,
	b: Uint8ClampedArray,
): boolean => {
	if (a.length !== b.length) return false;
	for (let index = 0; index < a.length; index += 1) {
		if (a[index] !== b[index]) return false;
	}
	return true;
};

/** Bounded so a genuinely never-settling surface fails fast into the honest issue below rather than stalling export. */
const MAX_RUNTIME_3D_STABILITY_RENDERS = 4;

const RUNTIME_3D_FIRST_FRAME_UNSTABLE_ISSUE: ExportIssue = {
	severity: "warning",
	category: "approximated",
	code: "runtime-3d-first-frame-unstable",
	message:
		"The Babylon 3D surface did not settle to a stable frame within the retry budget; the first exported frame may not exactly match how later frames of the same pose would render.",
	fallback: "normalized-value",
};

/**
 * A freshly created `BrowserRuntime3dFrameCompositor`'s first `renderFrame`
 * call can commit its WebGL draw calls before the browser's GPU process has
 * finished GPU-side work queued by that same first render (shader
 * compilation, environment-texture prefiltering) — `renderFrame` resolving
 * only means the JS-side render call returned, not that the GPU process
 * finished producing the pixels it queued. Observed empirically as a
 * reproducible byte-for-byte size delta between the first WebM exported after
 * a page load and any export after it (both internally deterministic, but
 * different from each other). `drawSvgFrame` has already been called once for
 * `frame` by the caller before this runs; this redraws the same frame and
 * compares composited pixels until two consecutive renders match, so encoding
 * never commits frame 0 from a surface that is still settling. A no-op when
 * Babylon rendered nothing for this frame (nothing to stabilize).
 */
const stabilizeRuntime3dFirstFrame = async ({
	canvas,
	context,
	scene,
	motion,
	frame,
	grammarBindings,
	lensSurface,
	pathBlurSurface,
	runtime3dCompositor,
	runtime3dInitiallyRendered,
}: {
	readonly canvas: HTMLCanvasElement;
	readonly context: CanvasRenderingContext2D;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frame: number;
	readonly grammarBindings?: readonly MotionGrammarBinding[];
	readonly lensSurface?: GpuRasterSurface | null;
	readonly pathBlurSurface?: GpuRasterSurface | null;
	readonly runtime3dCompositor: BrowserRuntime3dFrameCompositor;
	readonly runtime3dInitiallyRendered: boolean;
}): Promise<readonly ExportIssue[]> => {
	if (!runtime3dInitiallyRendered) return [];
	let previous = context.getImageData(0, 0, canvas.width, canvas.height).data;
	for (
		let attempt = 1;
		attempt < MAX_RUNTIME_3D_STABILITY_RENDERS;
		attempt += 1
	) {
		await drawSvgFrame({
			canvas,
			context,
			scene,
			motion,
			frame,
			grammarBindings,
			lensSurface,
			pathBlurSurface,
			runtime3dCompositor,
		});
		const next = context.getImageData(0, 0, canvas.width, canvas.height).data;
		if (pixelBuffersEqual(previous, next)) return [];
		previous = next;
	}
	return [RUNTIME_3D_FIRST_FRAME_UNSTABLE_ISSUE];
};

/**
 * Deterministically renders one committed scene frame to a PNG without
 * MediaRecorder or arbitrary waits. The same SVG + GPU/Babylon compositor used
 * by WebM is reused, but the final canvas is encoded only after all passes
 * complete. Callers own source-revision checks before and after this operation.
 */
export async function captureRasterStillFrame({
	scene,
	motion,
	frame,
	grammarBindings,
	resolveProductionArtifact,
}: {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frame: number;
	readonly grammarBindings?: readonly MotionGrammarBinding[];
	/** See `RecordWebmVideoExportInput.resolveProductionArtifact`. */
	readonly resolveProductionArtifact?: Runtime3dProductionArtifactResolver;
}): Promise<RasterStillFrameResult> {
	if (typeof document === "undefined") {
		throw new Error("Still capture requires a browser canvas runtime.");
	}
	await document.fonts?.ready;
	const programSurfaceProjection = projectProgramSurfacesForVideo(scene);
	const outputScene = programSurfaceProjection.scene;
	const width = Math.max(1, Math.round(outputScene.artboard.width));
	const height = Math.max(1, Math.round(outputScene.artboard.height));
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d", { alpha: true });
	if (!context) throw new Error("This browser cannot create a still canvas.");

	const gpuSurfaceNeeded = sceneNeedsGpuSurface(outputScene);
	const lensSurface = gpuSurfaceNeeded
		? createGpuRasterSurface(width, height, {
				preserveSourceAlphaThroughGenerators: artboardBackgroundIsTransparent(
					outputScene.artboard,
				),
			})
		: null;
	const pathBlurSurface =
		buildScopedPathBlurTargets(outputScene).length > 0
			? createGpuRasterSurface(1, 1, { transparentOutput: true })
			: null;
	const runtime3dCompositor = createBrowserRuntime3dFrameCompositor(
		resolveProductionArtifact ? { resolveProductionArtifact } : {},
	);
	const completedPassIds = ["svg-raster"];
	try {
		const frameResult = await drawSvgFrame({
			canvas,
			context,
			scene: outputScene,
			motion,
			frame,
			grammarBindings,
			lensSurface,
			pathBlurSurface,
			runtime3dCompositor,
		});
		let runtime3dRendered = frameResult.runtime3dRendered;
		const issues: ExportIssue[] = [
			...programSurfaceProjection.issues,
			...frameResult.issues,
		];
		if (lensSurface?.presentationIsBlank()) {
			lensSurface.invalidateSourceCache();
			const retryResult = await drawSvgFrame({
				canvas,
				context,
				scene: outputScene,
				motion,
				frame,
				grammarBindings,
				lensSurface,
				pathBlurSurface,
				runtime3dCompositor,
			});
			addUniqueIssues(issues, retryResult.issues);
			runtime3dRendered = runtime3dRendered || retryResult.runtime3dRendered;
		}
		// Same freshly-created-surface GPU race `recordScopedScene` guards against
		// (see `stabilizeRuntime3dFirstFrame`'s doc comment): this function creates
		// its own `runtime3dCompositor` per call, so every still capture is a first
		// render on a brand-new Babylon surface. Without this, `renderFrame`
		// resolving before the GPU process finishes shader compilation/IBL
		// prefiltering committed an unlit (pure black, alpha/geometry intact) frame
		// — reproduced via `capture_editor_snapshot` (median RGB (0,0,0),
		// nearBlackShare ~0.91 over the hero silhouette) while the WebM path,
		// which already stabilizes, rendered lit at the same moment.
		addUniqueIssues(
			issues,
			await stabilizeRuntime3dFirstFrame({
				canvas,
				context,
				scene: outputScene,
				motion,
				frame,
				grammarBindings,
				lensSurface,
				pathBlurSurface,
				runtime3dCompositor,
				runtime3dInitiallyRendered: runtime3dRendered,
			}),
		);
		if (gpuSurfaceNeeded) {
			if (!lensSurface || lensSurface.presentationIsBlank()) {
				throw new Error(
					"GPU raster passes did not produce a committed still frame.",
				);
			}
			completedPassIds.push("gpu-raster");
		}
		if (pathBlurSurface) completedPassIds.push("path-blur-raster");
		if (runtime3dRendered) completedPassIds.push("babylon-3d-raster");
		if (frameResult.compositePlan.band) {
			completedPassIds.push("composite-band-front-raster");
		}
		if (!canvasHasVisiblePixels(context, width, height)) {
			throw new Error("The committed still frame is blank.");
		}
		return {
			blob: await encodeCanvasPng(canvas),
			width,
			height,
			issues,
			...(programSurfaceProjection.manifest
				? { programSurfaceDelivery: programSurfaceProjection.manifest }
				: {}),
			completedPassIds,
			compositePlan: frameResult.compositePlan,
		};
	} finally {
		lensSurface?.dispose();
		pathBlurSurface?.dispose();
		runtime3dCompositor.dispose();
		canvas.width = 1;
		canvas.height = 1;
	}
}

const recordScopedScene = async ({
	scene,
	motion,
	plan,
	grammarBindings,
	resolveProductionArtifact,
}: {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly plan: WebmVideoExportPlan;
	readonly grammarBindings?: readonly MotionGrammarBinding[];
	readonly resolveProductionArtifact?: Runtime3dProductionArtifactResolver;
}): Promise<WebmVideoExportResult> => {
	const programSurfaceProjection = projectProgramSurfacesForVideo(scene);
	const outputScene = programSurfaceProjection.scene;
	const composeCanvas = document.createElement("canvas");
	composeCanvas.width = plan.width;
	composeCanvas.height = plan.height;
	const context = composeCanvas.getContext("2d");
	if (!context) throw new Error("This browser cannot create a video canvas.");
	// Lens presence is static (a node is there or not), so resolve the GPU surface
	// once and reuse it across frames. `null` when there is no lens or WebGL is
	// unavailable → the flat SVG frames are recorded (honest degradation).
	const gpuSurfaceNeeded = sceneNeedsGpuSurface(outputScene);
	const lensSurface = gpuSurfaceNeeded
		? createGpuRasterSurface(plan.width, plan.height, {
				preserveSourceAlphaThroughGenerators: artboardBackgroundIsTransparent(
					outputScene.artboard,
				),
			})
		: null;
	// One shared surface reused across every object-scoped Path Blur target and
	// every frame (not one per object) — transparent output so a small crop
	// composites onto the frame without painting an opaque rectangle over it.
	const pathBlurSurface =
		buildScopedPathBlurTargets(outputScene).length > 0
			? createGpuRasterSurface(1, 1, { transparentOutput: true })
			: null;
	const runtime3dCompositor = createBrowserRuntime3dFrameCompositor(
		resolveProductionArtifact ? { resolveProductionArtifact } : {},
	);
	const issues: ExportIssue[] = [...programSurfaceProjection.issues];

	const preRollResult = await drawSvgFrame({
		canvas: composeCanvas,
		context,
		scene: outputScene,
		motion,
		frame: plan.frames[0] ?? 0,
		grammarBindings,
		lensSurface,
		pathBlurSurface,
		runtime3dCompositor,
	});
	addUniqueIssues(issues, preRollResult.issues);
	let runtime3dRendered = preRollResult.runtime3dRendered;
	// Chrome's FIRST rasterization of an <img>-decoded SVG that embeds data-URL
	// subresources (materialized video frames, placed images) can reach
	// `texImage2D` before those subresources rasterize, leaving the surface's
	// cached source texture EMPTY — every recorded frame then composites a fully
	// transparent overlay and the video ships without its GPU Look passes, with
	// no exception anywhere. The pre-roll frame above exists before capture
	// starts (frame-driven or MediaRecorder), so verify the presented output
	// actually contains pixels; on a blank read, drop the corrupt cached
	// texture and redraw once. A still-blank surface downgrades to the honest
	// `gpu-raster-compositing-lost` issue below.
	if (lensSurface?.presentationIsBlank()) {
		lensSurface.invalidateSourceCache();
		const retryResult = await drawSvgFrame({
			canvas: composeCanvas,
			context,
			scene: outputScene,
			motion,
			frame: plan.frames[0] ?? 0,
			grammarBindings,
			lensSurface,
			pathBlurSurface,
			runtime3dCompositor,
		});
		addUniqueIssues(issues, retryResult.issues);
		runtime3dRendered = runtime3dRendered || retryResult.runtime3dRendered;
	}
	addUniqueIssues(
		issues,
		await stabilizeRuntime3dFirstFrame({
			canvas: composeCanvas,
			context,
			scene: outputScene,
			motion,
			frame: plan.frames[0] ?? 0,
			grammarBindings,
			lensSurface,
			pathBlurSurface,
			runtime3dCompositor,
			runtime3dInitiallyRendered: runtime3dRendered,
		}),
	);

	// GPU compositing can fail without throwing: surface creation returns null
	// when WebGL2 is unavailable, an established context can be LOST under
	// context pressure, and the empty-first-rasterization case above can
	// persist past its one retry (every render then silently no-ops). All of
	// these leave plain SVG frames in the recording, so they must surface as an
	// honest issue — the lost-context check runs before dispose(), which
	// deliberately loses the context itself.
	let gpuCompositingUnavailable =
		gpuSurfaceNeeded &&
		(lensSurface === null || lensSurface.presentationIsBlank());

	// Observed, per composed output frame. Pre-roll and stabilization frames are
	// deliberately excluded: they are drawn before capture and are not in the
	// file, so counting them would let a delivery record claim coverage the
	// output does not have.
	const framePackageFrames: FramePackageFrameRecord[] = [];
	const drawFrame = async (frameIndex: number): Promise<void> => {
		const frame = plan.frames[frameIndex] ?? 0;
		const frameResult = await drawSvgFrame({
			canvas: composeCanvas,
			context,
			scene: outputScene,
			motion,
			frame,
			grammarBindings,
			lensSurface,
			pathBlurSurface,
			runtime3dCompositor,
		});
		addUniqueIssues(issues, frameResult.issues);
		framePackageFrames.push(...frameResult.framePackageFrames);
	};
	/**
	 * Builds this capture's delivery record and, when the record cannot support
	 * an exact claim, records why. Called on BOTH encoder branches so the
	 * frame-driven path proves its exactness with the same shape the fallback
	 * path uses to withhold it.
	 */
	const deliverFramePackages = (
		encoder: FramePackageDeliveryEncoder,
	): FramePackageDeliveryReport | null => {
		const report = framePackageDeliveryReport({
			records: framePackageFrames,
			requestedFrameCount: plan.frames.length,
			fps: plan.fps,
			alphaRequested: artboardBackgroundIsTransparent(outputScene.artboard),
			encoder,
		});
		if (report && !report.exact) {
			addUniqueIssues(issues, [framePackageExactnessBlockedIssue(report)]);
		}
		return report;
	};

	try {
		const canUseFrameDriven = await canUseFrameDrivenVideoEncoder(
			plan.width,
			plan.height,
		);
		if (canUseFrameDriven) {
			try {
				// S5a minimal audio lane: mix once, up front, on the same
				// [plan.startFrame, plan.startFrame + plan.durationFrames) window the
				// frame loop below renders. Only the frame-driven path carries audio —
				// the MediaRecorder fallback below reports a typed omission instead.
				const audioMix = await buildExportAudioMix({
					scene: outputScene,
					fps: plan.fps,
					startFrame: plan.startFrame,
					durationFrames: plan.durationFrames,
				});
				addUniqueIssues(issues, audioMix.issues);
				const { blob, issues: audioMuxIssues } =
					await encodeFramesWithMediabunny({
						width: plan.width,
						height: plan.height,
						fps: plan.fps,
						frameCount: plan.frames.length,
						canvas: composeCanvas,
						drawFrame,
						audioBuffer: audioMix.buffer,
					});
				addUniqueIssues(issues, audioMuxIssues);
				if (lensSurface?.isContextLost()) gpuCompositingUnavailable = true;
				if (gpuCompositingUnavailable) {
					addUniqueIssues(issues, [GPU_RASTER_COMPOSITING_LOST_ISSUE]);
				}
				const framePackageDelivery = deliverFramePackages(
					"frame-driven-webcodecs",
				);
				return {
					fileName: plan.fileName,
					mimeType: FRAME_DRIVEN_VIDEO_MIME_TYPE,
					blob,
					frameCount: plan.frames.length,
					fps: plan.fps,
					issues,
					compositePlan: preRollResult.compositePlan,
					...(framePackageDelivery ? { framePackageDelivery } : {}),
					...(programSurfaceProjection.manifest
						? { programSurfaceDelivery: programSurfaceProjection.manifest }
						: {}),
				};
			} catch (error) {
				addUniqueIssues(issues, [frameDrivenVideoEncodeFailedIssue(error)]);
			}
		} else {
			addUniqueIssues(issues, [frameDrivenVideoUnsupportedIssue()]);
		}

		// Fallback: real-time MediaRecorder capture, unchanged from the original
		// implementation. Two canvases, deliberately: `captureStream` samples the
		// RECORDING canvas on the compositor's schedule, including at any `await`
		// inside a frame's build. Composing directly on it therefore ships
		// half-built frames — the GPU Look pass lands AFTER an await (SVG
		// decode/upload), so whenever a frame's build overruns the frame budget
		// (cold decode caches, slow GPU) the recorder samples the SVG-only
		// intermediate state and the whole video silently loses its GPU passes.
		// Frames are built on the offscreen COMPOSE canvas instead and blitted to
		// the recording canvas in one synchronous draw, so no intermediate state
		// ever exists on the captured surface.
		//
		// S5a minimal audio lane: `canvas.captureStream()` only carries the visual
		// stream, so a document with audible audio tracks that lands here (no
		// frame-driven WebCodecs support) completes video-only. Recorded as a
		// typed issue rather than silently — never re-attempted through
		// MediaRecorder, per the plan's "no MediaRecorder audio" scope.
		if (resolveAudibleAudioTracks(outputScene).length > 0) {
			addUniqueIssues(issues, [FRAME_DRIVEN_AUDIO_ENCODER_UNSUPPORTED_ISSUE]);
		}
		const mimeType = chooseWebmMimeType();
		const canvas = document.createElement("canvas");
		canvas.width = plan.width;
		canvas.height = plan.height;
		const recordingContext = canvas.getContext("2d");
		if (!recordingContext)
			throw new Error("This browser cannot create a video canvas.");
		const presentFrame = (): void => {
			recordingContext.clearRect(0, 0, canvas.width, canvas.height);
			recordingContext.drawImage(composeCanvas, 0, 0);
		};
		presentFrame();
		const frameDurationMs = 1000 / Math.max(1, plan.fps);

		const stream = canvas.captureStream(plan.fps);
		const recorder = new MediaRecorder(stream, { mimeType });
		const chunksPromise = recorderData(recorder);
		recorder.start();
		const recordingStartMs = performance.now();
		try {
			for (const [frameIndex] of plan.frames.entries()) {
				await drawFrame(frameIndex);
				presentFrame();
				const targetElapsedMs = (frameIndex + 1) * frameDurationMs;
				const remainingMs =
					targetElapsedMs - (performance.now() - recordingStartMs);
				if (remainingMs > 0) await delay(remainingMs);
			}
		} finally {
			recorder.stop();
			for (const track of stream.getTracks()) track.stop();
		}
		if (lensSurface?.isContextLost()) gpuCompositingUnavailable = true;
		if (gpuCompositingUnavailable) {
			addUniqueIssues(issues, [GPU_RASTER_COMPOSITING_LOST_ISSUE]);
		}

		const chunks = await chunksPromise;
		// Fail closed: this branch sampled the canvas on a wall clock, so no
		// exact claim survives it even though the frames were composed correctly.
		const framePackageDelivery = deliverFramePackages(
			"real-time-mediarecorder",
		);
		return {
			fileName: plan.fileName,
			mimeType,
			blob: new Blob([...chunks], { type: mimeType }),
			frameCount: plan.frames.length,
			fps: plan.fps,
			issues,
			compositePlan: preRollResult.compositePlan,
			...(framePackageDelivery ? { framePackageDelivery } : {}),
			...(programSurfaceProjection.manifest
				? { programSurfaceDelivery: programSurfaceProjection.manifest }
				: {}),
		};
	} finally {
		lensSurface?.dispose();
		pathBlurSurface?.dispose();
		runtime3dCompositor.dispose();
	}
};

const recordSequenceScene = async ({
	scene,
	motion,
	resolved,
	timeline,
	plan,
	grammarBindings,
	resolveProductionArtifact,
}: {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly resolved: ResolvedExportArtboardScope;
	readonly resolveProductionArtifact?: Runtime3dProductionArtifactResolver;
	readonly timeline: SceneSequenceTimeline;
	readonly plan: WebmVideoExportPlan;
	readonly grammarBindings?: readonly MotionGrammarBinding[];
}): Promise<WebmVideoExportResult> => {
	const programSurfaceProjection = projectProgramSurfacesForVideo(scene);
	const outputTargets: readonly ResolvedExportArtboard[] =
		resolved.targets.flatMap((target) => {
			const outputScene = scopeSceneToArtboard(
				programSurfaceProjection.scene,
				target.metadata.id,
			);
			return outputScene ? [{ ...target, scene: outputScene }] : [];
		});
	const targetByArtboardId = new Map(
		outputTargets.map((target) => [target.metadata.id, target] as const),
	);
	const canvas = document.createElement("canvas");
	canvas.width = plan.width;
	canvas.height = plan.height;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("This browser cannot create a video canvas.");
	const needsGpuSurface = timeline.items.some((item) => {
		const target = targetByArtboardId.get(item.artboard.id);
		return target ? sceneNeedsGpuSurface(target.scene) : false;
	});
	// The lens surface is shared across every artboard in the sequence, so the
	// opt-in only applies when EVERY artboard the sequence can render is
	// transparent — one opaque artboard sharing the surface must keep the
	// AE-faithful forced-opaque Colorama behaviour for its own frames.
	const lensSurface = needsGpuSurface
		? createGpuRasterSurface(plan.width, plan.height, {
				preserveSourceAlphaThroughGenerators: outputTargets.every((target) =>
					artboardBackgroundIsTransparent(target.scene.artboard),
				),
			})
		: null;
	const runtime3dCompositor = createBrowserRuntime3dFrameCompositor(
		resolveProductionArtifact ? { resolveProductionArtifact } : {},
	);
	const issues: ExportIssue[] = [...programSurfaceProjection.issues];

	const framePackageFrames: FramePackageFrameRecord[] = [];
	const drawSequenceFrame = async (globalFrame: number): Promise<void> => {
		const address = mapGlobalFrameToSequenceItem(timeline, globalFrame);
		const target = address
			? targetByArtboardId.get(address.artboardId)
			: undefined;
		if (!address || !target) return;
		const frameResult = await drawSvgFrame({
			canvas,
			context,
			scene: target.scene,
			motion,
			frame: address.localFrame,
			grammarBindings,
			lensSurface,
			runtime3dCompositor,
		});
		addUniqueIssues(issues, frameResult.issues);
		framePackageFrames.push(...frameResult.framePackageFrames);
	};
	const drawFrame = (frameIndex: number): Promise<void> =>
		drawSequenceFrame(plan.frames[frameIndex] ?? 0);
	// Same S4-D obligation as the scoped path: a sequence export of a rendered
	// band must carry its own delivery record, or the one export shape that
	// omits it becomes the shape an unfounded exact claim can hide in.
	const deliverFramePackages = (
		encoder: FramePackageDeliveryEncoder,
	): FramePackageDeliveryReport | null => {
		const report = framePackageDeliveryReport({
			records: framePackageFrames,
			requestedFrameCount: plan.frames.length,
			fps: plan.fps,
			alphaRequested: artboardBackgroundIsTransparent(scene.artboard),
			encoder,
		});
		if (report && !report.exact) {
			addUniqueIssues(issues, [framePackageExactnessBlockedIssue(report)]);
		}
		return report;
	};

	// Pre-roll frame 0 directly (not through `drawSequenceFrame`) so the
	// resolved target scene and `runtime3dRendered` flag are available here for
	// the stability check below — see `stabilizeRuntime3dFirstFrame`'s doc
	// comment for why a freshly created Babylon surface's first render needs
	// this before any frame is encoded.
	const preRollAddress = mapGlobalFrameToSequenceItem(
		timeline,
		plan.frames[0] ?? 0,
	);
	const preRollTarget = preRollAddress
		? targetByArtboardId.get(preRollAddress.artboardId)
		: undefined;
	let sequenceCompositePlan: CompositePlanReport | undefined;
	if (preRollAddress && preRollTarget) {
		const preRollResult = await drawSvgFrame({
			canvas,
			context,
			scene: preRollTarget.scene,
			motion,
			frame: preRollAddress.localFrame,
			grammarBindings,
			lensSurface,
			runtime3dCompositor,
		});
		addUniqueIssues(issues, preRollResult.issues);
		sequenceCompositePlan = preRollResult.compositePlan;
		addUniqueIssues(
			issues,
			await stabilizeRuntime3dFirstFrame({
				canvas,
				context,
				scene: preRollTarget.scene,
				motion,
				frame: preRollAddress.localFrame,
				grammarBindings,
				lensSurface,
				runtime3dCompositor,
				runtime3dInitiallyRendered: preRollResult.runtime3dRendered,
			}),
		);
	}

	try {
		const canUseFrameDriven = await canUseFrameDrivenVideoEncoder(
			plan.width,
			plan.height,
		);
		if (canUseFrameDriven) {
			try {
				// S5a minimal audio lane: `AudioTrack`s are document-level, not
				// per-artboard, so the mix reads `programSurfaceProjection.scene`
				// (the whole document, before per-artboard scoping) rather than any
				// one `outputTargets` entry — same reasoning as `recordScopedScene`.
				const audioMix = await buildExportAudioMix({
					scene: programSurfaceProjection.scene,
					fps: plan.fps,
					startFrame: plan.startFrame,
					durationFrames: plan.durationFrames,
				});
				addUniqueIssues(issues, audioMix.issues);
				const { blob, issues: audioMuxIssues } =
					await encodeFramesWithMediabunny({
						width: plan.width,
						height: plan.height,
						fps: plan.fps,
						frameCount: plan.frames.length,
						canvas,
						drawFrame,
						audioBuffer: audioMix.buffer,
					});
				addUniqueIssues(issues, audioMuxIssues);
				const framePackageDelivery = deliverFramePackages(
					"frame-driven-webcodecs",
				);
				return {
					fileName: plan.fileName,
					mimeType: FRAME_DRIVEN_VIDEO_MIME_TYPE,
					blob,
					frameCount: plan.frames.length,
					fps: plan.fps,
					issues,
					compositePlan: sequenceCompositePlan,
					...(framePackageDelivery ? { framePackageDelivery } : {}),
					...(programSurfaceProjection.manifest
						? { programSurfaceDelivery: programSurfaceProjection.manifest }
						: {}),
				};
			} catch (error) {
				addUniqueIssues(issues, [frameDrivenVideoEncodeFailedIssue(error)]);
			}
		} else {
			addUniqueIssues(issues, [frameDrivenVideoUnsupportedIssue()]);
		}

		// Fallback: real-time MediaRecorder capture, unchanged from the original
		// implementation. See `recordScopedScene` for why this path never carries
		// audio (S5a): `canvas.captureStream()` is visual-only.
		if (resolveAudibleAudioTracks(programSurfaceProjection.scene).length > 0) {
			addUniqueIssues(issues, [FRAME_DRIVEN_AUDIO_ENCODER_UNSUPPORTED_ISSUE]);
		}
		const mimeType = chooseWebmMimeType();
		const frameDurationMs = 1000 / Math.max(1, plan.fps);
		const stream = canvas.captureStream(plan.fps);
		const recorder = new MediaRecorder(stream, { mimeType });
		const chunksPromise = recorderData(recorder);
		recorder.start();
		const recordingStartMs = performance.now();
		try {
			for (const [frameIndex, frame] of plan.frames.entries()) {
				await drawSequenceFrame(frame);
				const targetElapsedMs = (frameIndex + 1) * frameDurationMs;
				const remainingMs =
					targetElapsedMs - (performance.now() - recordingStartMs);
				if (remainingMs > 0) await delay(remainingMs);
			}
		} finally {
			recorder.stop();
			for (const track of stream.getTracks()) track.stop();
		}

		const chunks = await chunksPromise;
		const framePackageDelivery = deliverFramePackages(
			"real-time-mediarecorder",
		);
		return {
			fileName: plan.fileName,
			mimeType,
			blob: new Blob([...chunks], { type: mimeType }),
			frameCount: plan.frames.length,
			fps: plan.fps,
			issues,
			compositePlan: sequenceCompositePlan,
			...(framePackageDelivery ? { framePackageDelivery } : {}),
			...(programSurfaceProjection.manifest
				? { programSurfaceDelivery: programSurfaceProjection.manifest }
				: {}),
		};
	} finally {
		lensSurface?.dispose();
		runtime3dCompositor.dispose();
	}
};

/**
 * Records a sequence WebM when the document sequence resolves inside the chosen
 * artboard scope; otherwise records one WebM per resolved artboard target. This
 * path deliberately bypasses server export jobs because the current Worker
 * runtime only renders still SVG or metadata-only results.
 */
export async function recordAndDownloadWebmVideoExport({
	scene,
	motion,
	artboardScope,
	grammarBindings,
	resolveProductionArtifact,
}: RecordWebmVideoExportInput): Promise<readonly WebmVideoExportResult[]> {
	// `chooseWebmMimeType()` is intentionally NOT called here: the primary path
	// is the frame-driven WebCodecs encoder, which needs no `MediaRecorder`
	// support at all. Each capture function resolves a MediaRecorder mime type
	// lazily, only once it actually falls back to that path, so a browser with
	// WebCodecs but no WebM `MediaRecorder` support can still export.
	const resolved = resolveExportArtboardScope(scene, artboardScope);
	const resolverInput = resolveProductionArtifact
		? { resolveProductionArtifact }
		: {};
	const sequenceTimeline = sequenceTimelineForScope({
		scene,
		motion,
		resolved,
	});
	const sequencePlan = sequenceTimeline
		? sequenceVideoPlan(scene, sequenceTimeline)
		: null;
	if (sequenceTimeline && sequencePlan) {
		const result = await recordSequenceScene({
			scene,
			motion,
			resolved,
			timeline: sequenceTimeline,
			plan: sequencePlan,
			grammarBindings,
			...resolverInput,
		});
		downloadBlob(result.fileName, result.mimeType, result.blob);
		return [result];
	}
	const results: WebmVideoExportResult[] = [];
	for (const target of resolved.targets) {
		const plan = createWebmVideoExportPlan({
			scene: target.scene,
			motion,
			fileNameStem: target.fileStem,
		});
		const result = await recordScopedScene({
			scene: target.scene,
			motion,
			plan,
			grammarBindings,
			...resolverInput,
		});
		downloadBlob(result.fileName, result.mimeType, result.blob);
		results.push(result);
	}
	return results;
}
