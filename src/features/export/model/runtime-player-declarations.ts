const RUNTIME_TYPES_MIME_TYPE = "text/typescript;charset=utf-8" as const;

export type RuntimeTypesAsset = {
	readonly kind: "runtime-types";
	readonly fileName: string;
	readonly mimeType: typeof RUNTIME_TYPES_MIME_TYPE;
	readonly contents: string;
	readonly shared: boolean;
};

export const runtimeTypesFileName = (runtimeFileName: string): string =>
	runtimeFileName.replace(/\.js$/i, ".d.ts");

const commonDeclarations = `export type VectorMotionRenderer = "svg" | "webgl";
export type VectorMotionFrameScope = { readonly kind: "scene"; readonly artboardId: string; readonly localFrame: number } | { readonly kind: "scene-sequence"; readonly sequenceId: string; readonly itemId: string; readonly artboardId: string; readonly globalFrame: number; readonly localFrame: number; readonly itemStartFrame: number; readonly itemEndFrameExclusive: number };
export type CameraRigAnimatableProperty = "bodyX" | "bodyY" | "bodyZ" | "bodyRotationX" | "bodyRotationY" | "bodyRotationZ" | "targetX" | "targetY" | "targetZ" | "fovDegrees" | "zoom" | "focusDistance" | "aperture";
export type RuntimeCameraIssue = { readonly code: string; readonly severity: "warning" | "error"; readonly message: string; readonly cameraRigId?: string; readonly artboardId?: string; readonly nodeId?: string };
export type RuntimeVec3 = { readonly x: number; readonly y: number; readonly z: number };
export type RuntimeCameraDepthOfField = { readonly active: boolean; readonly focusDistance: number; readonly aperture: number; readonly maxBlurRadius: number; readonly maxCircleOfConfusion: number; readonly blurredNodeCount: number; readonly nearBlurredNodeCount: number; readonly farBlurredNodeCount: number; readonly maxBlurNodeId?: string; readonly maxBlurDepth?: number; readonly fidelity: "none" | "svg-layer-blur-approximation" | "optical-bokeh-preview-required"; readonly renderer: "none" | "svg-layer-blur"; readonly opticalModel: "none" | "thin-lens-normalized-coc"; readonly bokehShape: "none" | "circular" };
export type RuntimeCameraProjection = { readonly kind: "orthographic"; readonly zoom: number } | { readonly kind: "perspective"; readonly fovDegrees: number; readonly zoom: number; readonly near: number; readonly far: number | null };
export type RuntimeCameraView = { readonly cameraRigId: string; readonly selectionSource: "artboard" | "cut" | "runtime-override"; readonly overridden: boolean; readonly artboardId: string; readonly artboard: { readonly width: number; readonly height: number }; readonly coordinates: { readonly worldUnits: "scene-pixels"; readonly angles: "degrees"; readonly xAxis: "right"; readonly yAxis: "down"; readonly zAxis: "scene-depth"; readonly fovAxis: "vertical"; readonly handedness: "right-handed"; readonly projectionVerticalAxis: "down" }; readonly body: RuntimeVec3; readonly target: RuntimeVec3; readonly basis: { readonly right: RuntimeVec3; readonly up: RuntimeVec3; readonly down: RuntimeVec3; readonly forward: RuntimeVec3; readonly targetDistance: number }; readonly projection: RuntimeCameraProjection; readonly depthOfField: RuntimeCameraDepthOfField; readonly fidelity: "svg-affine" | "requires-3d" | "invalid"; readonly issues: readonly RuntimeCameraIssue[] };
export type RuntimeCameraState = { readonly kind: "none"; readonly artboardId: string; readonly fidelity: "none"; readonly issues: readonly [] } | { readonly kind: "invalid"; readonly artboardId: string; readonly requestedCameraRigId?: string; readonly fidelity: "invalid"; readonly issues: readonly RuntimeCameraIssue[] } | { readonly kind: "single"; readonly view: RuntimeCameraView } | { readonly kind: "crossfade"; readonly from: RuntimeCameraView; readonly to: RuntimeCameraView; readonly progress: number };
export type RuntimeCameraOverride = { readonly mode: "replace"; readonly channels: Readonly<Partial<Record<CameraRigAnimatableProperty, number>>> };
export type RuntimeCameraCatalogEntry = { readonly cameraRigId: string; readonly name?: string; readonly artboardId?: string; readonly projectionKind: "perspective" | "orthographic" };
export type VectorMotionFrameSnapshot = { readonly revision: number; readonly renderer: VectorMotionRenderer; readonly frame: number; readonly progress: number; readonly fps: number; readonly durationFrames: number; readonly duration: number; readonly scope: VectorMotionFrameScope; readonly camera: RuntimeCameraState };
export type FrameSampleEvent = { readonly phase: "sampled"; readonly requestId: number; readonly requestedFrame: number; readonly sampledFrame: number; readonly renderer: VectorMotionRenderer; readonly scope: VectorMotionFrameScope; readonly camera: RuntimeCameraState };
export type FrameRenderedEvent = { readonly phase: "rendered"; readonly requestId: number; readonly revision: number; readonly snapshot: VectorMotionFrameSnapshot };
export type RuntimeControlIssue = { readonly code: string; readonly message: string };
export type RenderRequestResult = { readonly status: "committed"; readonly requestId: number; readonly snapshot: VectorMotionFrameSnapshot } | { readonly status: "superseded"; readonly requestId: number; readonly byRequestId: number } | { readonly status: "rejected"; readonly requestId: number; readonly issue: RuntimeControlIssue } | { readonly status: "disposed"; readonly requestId: number };
export type VectorMotionRuntimePayload = { readonly scene: unknown; readonly motion: unknown; readonly grammarBindings?: readonly unknown[]; readonly sceneSequence?: unknown; readonly componentProps?: unknown; readonly interactions?: readonly unknown[] };
export type VectorMotionRuntimeSource = { readonly kind: "embedded" } | { readonly kind: "payload"; readonly payload: VectorMotionRuntimePayload } | { readonly kind: "url"; readonly url: string | URL };
export type MountVectorMotionOptions = { readonly source?: VectorMotionRuntimeSource; readonly autoplay?: boolean; readonly loop?: boolean; readonly frame?: number; readonly playbackRate?: number; readonly fps?: number; readonly durationFrames?: number; readonly interactions?: boolean; readonly patchDom?: boolean; readonly transparentBackground?: boolean; readonly fit?: "intrinsic" | "contain" | "cover" | "fill"; readonly props?: Readonly<Record<string, unknown>>; readonly cameraOverrides?: readonly { readonly cameraRigId: string; readonly override: RuntimeCameraOverride }[]; readonly activeCameraOverride?: string | null; readonly onFrameSampled?: (event: FrameSampleEvent) => void; readonly onFrameRendered?: (event: FrameRenderedEvent) => void };
export type VectorMotionOverlayOptions = MountVectorMotionOptions & { readonly position?: "absolute" | "fixed"; readonly pointerEvents?: "none" | "auto"; readonly zIndex?: number | string };
`;

/**
 * `VectorMotionPlayer`'s interface body, split out of `commonDeclarations` so
 * the motion-artifact profile's `.d.ts` can narrow it to exactly the
 * capabilities its paired runtime.js actually provides (see `code.ts`'s
 * `motionArtifactPlayerSource`: `on`/`setProps`/`props`/`propSchema` are
 * scene-conditional there too, not fixed per profile). Every other caller
 * passes both flags `true`, reproducing the original single-interface text
 * byte-for-byte.
 */
const vectorMotionPlayerInterface = ({
	includeComponentPropsApi,
	includeInteractionsSurface,
}: {
	readonly includeComponentPropsApi: boolean;
	readonly includeInteractionsSurface: boolean;
}): string =>
	`export interface VectorMotionPlayer { readonly renderer: VectorMotionRenderer; readonly frame: number; progress: number; readonly fps: number; readonly durationFrames: number; readonly duration: number; readonly loop: boolean; readonly playbackRate: number; setLoop(loop: boolean): void; setPlaybackRate(playbackRate: number): void; seekFrame(frame: number): Promise<RenderRequestResult>; seekProgress(progress: number): Promise<RenderRequestResult>; play(): void; pause(): void; destroy(): void; dispose(): void; getSnapshot(): VectorMotionFrameSnapshot; getCameraState(): RuntimeCameraState; getCameraCatalog(): readonly RuntimeCameraCatalogEntry[]; subscribe(listener: () => void, options?: { readonly emitCurrent?: boolean }): () => void; onFrameSampled(listener: (event: FrameSampleEvent) => void): () => void; onFrameRendered(listener: (event: FrameRenderedEvent) => void): () => void; setCameraOverride(cameraRigId: string, patch: RuntimeCameraOverride | null): Promise<RenderRequestResult>; clearCameraOverrides(): Promise<RenderRequestResult>; setActiveCameraOverride(cameraRigId: string | null): Promise<RenderRequestResult>;` +
	(includeInteractionsSurface
		? " on(eventName: string, callback: (event: unknown) => void): () => void;"
		: "") +
	(includeComponentPropsApi
		? " setProps(partial: Readonly<Record<string, unknown>>): void; readonly props: Readonly<Record<string, unknown>>; readonly propSchema: readonly unknown[]"
		: "") +
	` }
`;

const commonTailDeclarations = `export declare class VectorMotionMountError extends Error { readonly issue: RuntimeControlIssue }
export declare function mountVectorMotion(container: HTMLElement, options?: MountVectorMotionOptions): Promise<VectorMotionPlayer>;
export type EmbeddableMotionMountOptions = { readonly reducedMotion?: boolean; readonly dpr?: number; readonly palette?: Readonly<Record<string, string>>; readonly autoplay?: boolean; readonly loop?: boolean; readonly densityCenter?: { readonly x: number; readonly y: number } };
export interface EmbeddableMotionMountHandle { play(): void; pause(): void; seek(progress: number): void; destroy(): void; readonly ready: Promise<void> }
`;

const svgPlayerDeclarations = `export type VectorMotionSequencePlayer = VectorMotionPlayer;
export declare function createVectorMotionPlayer(container: HTMLElement, payloadOrOptions?: VectorMotionRuntimePayload | MountVectorMotionOptions, maybeOptions?: MountVectorMotionOptions): VectorMotionPlayer & { readonly ready: Promise<RenderRequestResult>; renderFrame(frame?: number): number; seek(progress: number): number };
`;

/**
 * Standalone one-shot render + legacy sequence-alias declarations, split out
 * to match `code.ts`'s `RUNTIME_PLAYER_RENDER_FRAME_WRAPPER_SOURCE` /
 * `RUNTIME_PLAYER_RENDER_SEQUENCE_FRAME_WRAPPER_SOURCE` /
 * `RUNTIME_PLAYER_SEQUENCE_ALIAS_SOURCE`: the motion-artifact profile's
 * runtime.js (`motionArtifactPlayerSource`) never bundles `renderFrame`/
 * `renderVectorMotionFrame`/`renderSequenceFrame`/
 * `renderVectorMotionSequenceFrame`/`createVectorMotionSequencePlayer`/
 * `mountVectorMotionSequence` (nothing in its embed-only `mount()`/
 * `mountVectorMotion` surface calls them), so its `.d.ts` must not declare
 * them either — a declared-but-absent export is a silent lie to a
 * TypeScript consumer, not merely a missed size optimization.
 */
const svgStandaloneRenderSurfaceDeclarations = `export declare function renderFrame(frame?: number, payload?: VectorMotionRuntimePayload): string;
export declare const renderVectorMotionFrame: (payload: VectorMotionRuntimePayload, frame?: number) => string;
export declare function renderSequenceFrame(frame?: number, payload?: VectorMotionRuntimePayload): string;
export declare const renderVectorMotionSequenceFrame: (payload: VectorMotionRuntimePayload, frame?: number) => string;
export declare function createVectorMotionSequencePlayer(container: HTMLElement, payloadOrOptions?: VectorMotionRuntimePayload | MountVectorMotionOptions, maybeOptions?: MountVectorMotionOptions): VectorMotionPlayer & { readonly ready: Promise<RenderRequestResult>; renderFrame(frame?: number): number; seek(progress: number): number };
export declare const mountVectorMotionSequence: typeof createVectorMotionSequencePlayer;
`;

const svgMountDeclaration = `export declare function mount(container: HTMLElement, options?: EmbeddableMotionMountOptions): EmbeddableMotionMountHandle;
`;

/**
 * URL-loader declarations, split out to match `code.ts`'s
 * `RUNTIME_PLAYER_URL_LOADER_ADDON_SOURCE`: the motion-artifact profile's
 * runtime.js never bundles `loadVectorMotionPayload`/`mountVectorMotionFromUrl`/
 * `mountVectorMotionSequenceFromUrl` (it always embeds its payload, never
 * loads one from a URL), so its `.d.ts` must not declare them either — a
 * declared-but-absent export is a silent lie to a TypeScript consumer, not
 * merely a missed size optimization.
 */
const svgUrlLoaderDeclarations = `export declare function loadVectorMotionPayload(url: string | URL): Promise<VectorMotionRuntimePayload>;
export declare function mountVectorMotionFromUrl(container: HTMLElement, url: string | URL, options?: MountVectorMotionOptions): Promise<VectorMotionPlayer>;
export declare function mountVectorMotionSequenceFromUrl(container: HTMLElement, url: string | URL, options?: MountVectorMotionOptions): Promise<VectorMotionPlayer>;
`;

const svgEmbeddedDeclarations = `export declare const vectorMotionExport: VectorMotionRuntimePayload; export declare const scene: unknown; export declare const motion: unknown; export declare const grammarBindings: readonly unknown[]; export declare const manifest: unknown; export declare const effectCapabilities: unknown; export declare const recipes: readonly unknown[]; export declare const animationSequences: readonly unknown[]; export declare const sceneSequence: unknown; export declare const motionRuntime: unknown; export declare const paletteManifest: Readonly<Record<string, string>>; export default vectorMotionExport;
`;

const webglDeclarations = `export declare const webglRuntime: unknown;
export declare const mountVectorMotionWebglOverlayRuntime: (container: HTMLElement, payload: VectorMotionRuntimePayload, options?: VectorMotionOverlayOptions) => Promise<VectorMotionPlayer>;
export declare function createVectorMotionWebglPlayer(container: HTMLElement, payload: VectorMotionRuntimePayload, options?: MountVectorMotionOptions): Promise<VectorMotionPlayer & { seek(frame: number): Promise<number> }>;
export declare function loadVectorMotionWebglPayload(url: string | URL): Promise<VectorMotionRuntimePayload>;
export declare function mountVectorMotionWebglPlayerFromUrl(container: HTMLElement, url: string | URL, options?: MountVectorMotionOptions): Promise<VectorMotionPlayer>;
export declare function mountVectorMotionWebglOverlayFromUrl(container: HTMLElement, url: string | URL, options?: VectorMotionOverlayOptions): Promise<VectorMotionPlayer>;
`;

const webglEmbeddedDeclarations = `export declare const vectorMotionWebglExport: VectorMotionRuntimePayload; export declare const scene: unknown; export declare const motion: unknown; export declare const grammarBindings: readonly unknown[]; export declare const sceneSequence: unknown; export declare const componentProps: unknown; export declare const interactions: readonly unknown[] | undefined; export declare const paletteManifest: Readonly<Record<string, string>>;
export declare function mountVectorMotionWebglPlayer(container: HTMLElement, options?: MountVectorMotionOptions): Promise<VectorMotionPlayer>;
export declare function mountVectorMotionWebglOverlay(container: HTMLElement, options?: VectorMotionOverlayOptions): Promise<VectorMotionPlayer>;
export declare function mount(container: HTMLElement, options?: EmbeddableMotionMountOptions): EmbeddableMotionMountHandle;
export default vectorMotionWebglExport;
`;

const webglExternalDeclarations = `export declare function mountVectorMotionWebglPlayer(container: HTMLElement, payload: VectorMotionRuntimePayload, options?: MountVectorMotionOptions): Promise<VectorMotionPlayer>;
export declare function mountVectorMotionWebglOverlay(container: HTMLElement, payload: VectorMotionRuntimePayload, options?: VectorMotionOverlayOptions): Promise<VectorMotionPlayer>;
export declare function mount(container: HTMLElement, payload: VectorMotionRuntimePayload, options?: EmbeddableMotionMountOptions): EmbeddableMotionMountHandle;
`;

export const createRuntimeTypesAsset = ({
	runtimeFileName,
	renderer,
	shared,
	embedded,
	includeUrlLoader = true,
	includeStandaloneRenderSurface = true,
	includeComponentPropsApi = true,
	includeInteractionsSurface = true,
}: {
	readonly runtimeFileName: string;
	readonly renderer: "svg" | "webgl";
	readonly shared: boolean;
	readonly embedded: boolean;
	/**
	 * Whether the runtime this describes bundles
	 * `RUNTIME_PLAYER_URL_LOADER_ADDON_SOURCE` (`code.ts`). Defaults to `true`
	 * (every renderer/packaging combination except the motion-artifact
	 * profile ships the addon); `createMotionCodeRuntimeTypesAsset` passes
	 * `false` for motion-artifact specifically, so its `.d.ts` never declares
	 * an export the runtime doesn't actually provide.
	 */
	readonly includeUrlLoader?: boolean;
	/**
	 * Whether the runtime this describes bundles the standalone one-shot
	 * render wrappers and legacy sequence alias (`RUNTIME_PLAYER_RENDER_FRAME_
	 * WRAPPER_SOURCE`/`RUNTIME_PLAYER_RENDER_SEQUENCE_FRAME_WRAPPER_SOURCE`/
	 * `RUNTIME_PLAYER_SEQUENCE_ALIAS_SOURCE`, `code.ts`). Defaults to `true`;
	 * `createMotionCodeRuntimeTypesAsset` passes `false` for motion-artifact
	 * specifically (its player is always assembled via
	 * `motionArtifactPlayerSource`, which omits them), so its `.d.ts` never
	 * declares an export the runtime doesn't actually provide.
	 */
	readonly includeStandaloneRenderSurface?: boolean;
	/**
	 * Whether `VectorMotionPlayer` declares `setProps`/`props`/`propSchema`.
	 * Defaults to `true` (every renderer/profile except a props-free
	 * motion-artifact export declares them); `createMotionCodeRuntimeTypesAsset`
	 * passes the SAME payload-derived signal `code.ts`'s
	 * `runtimePlayerSourceForProfile` uses to decide whether the runtime
	 * actually installs them, so the `.d.ts` never advertises a member the
	 * paired runtime.js omits.
	 */
	readonly includeComponentPropsApi?: boolean;
	/**
	 * Whether `VectorMotionPlayer` declares `on`. Defaults to `true`;
	 * `createMotionCodeRuntimeTypesAsset` passes the SAME
	 * `sceneHasAuthoredInteractions` signal `code.ts` uses to decide whether
	 * the runtime actually wires an interaction engine and forwards its
	 * events through the emitter.
	 */
	readonly includeInteractionsSurface?: boolean;
}): RuntimeTypesAsset => ({
	kind: "runtime-types",
	fileName: runtimeTypesFileName(runtimeFileName),
	mimeType: RUNTIME_TYPES_MIME_TYPE,
	contents:
		commonDeclarations +
		vectorMotionPlayerInterface({
			includeComponentPropsApi,
			includeInteractionsSurface,
		}) +
		commonTailDeclarations +
		(renderer === "svg"
			? svgPlayerDeclarations +
				(includeStandaloneRenderSurface
					? svgStandaloneRenderSurfaceDeclarations
					: "") +
				svgMountDeclaration +
				(includeUrlLoader ? svgUrlLoaderDeclarations : "") +
				(embedded ? svgEmbeddedDeclarations : "")
			: webglDeclarations +
				(embedded ? webglEmbeddedDeclarations : webglExternalDeclarations)),
	shared,
});
