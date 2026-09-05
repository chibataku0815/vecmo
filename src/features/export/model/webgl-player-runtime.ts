import {
	createInteractionEngine,
	type InteractionEngine,
	type InteractionEngineActiveState,
	type InteractionEngineOutputEvent,
} from "@/entities/motion/model/interaction-engine";
import type { MotionDocument } from "@/entities/motion/model/types";
import type { MotionGrammarBinding } from "@/entities/motion-grammar/model/types";
import type { RuntimeCameraOverride } from "@/entities/scene/model/scene-camera";
import { runtimeCameraControlForArtboard } from "@/entities/scene/model/scene-camera";
import {
	resolveSequenceFrameAddress,
	type SequenceFrameTimelineContract,
} from "@/entities/scene/model/sequence";
import type {
	ComponentPropValue,
	InteractionDefinition,
	SceneDocument,
	VectorNode,
} from "@/entities/scene/model/types";
import { createGpuRasterSurface } from "@/shared/gpu-lens/surface";
import { scopeSceneToArtboard } from "./artboards";
import type {
	ComponentPropApplierInstruction,
	ComponentPropExportSchemaEntry,
	ComponentPropsExportResult,
} from "./component-props-export";
import { buildRasterPasses, buildRasterTree } from "./raster-passes";
import { buildExportRenderPresentation } from "./render-presentation";
import {
	createRuntimePlayerControl,
	type FrameRenderedEvent,
	type FrameSampleEvent,
	type RenderRequestResult,
	type RuntimeCameraCatalogEntry,
	type VectorMotionFrameSnapshot,
} from "./runtime-player-control";
import { renderSceneSvg } from "./svg";
import { materializeVideoAssetFrames } from "./video-frame-materialize";

/** Serializable source data embedded into a WebGL player runtime module. */
export type WebglPlayerPayload = {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly grammarBindings?: readonly MotionGrammarBinding[];
	readonly sceneSequence?: SequenceFrameTimelineContract & {
		readonly fps: number;
	};
	/**
	 * Motion Component export props (T2-S3): schema + compiled runtime applier
	 * instructions for the document's `componentProps` library, resolved
	 * against THIS payload's (already-projected) `scene`. Same shape and
	 * compilation (`component-props-export.ts`'s `buildComponentPropsExport`)
	 * the motion/code SVG payload carries at its payload root — see
	 * `applyComponentProps` below for the interpreter, ported line-for-line
	 * from `RUNTIME_PLAYER_SOURCE` in `code.ts` so the two runtimes apply a
	 * prop change identically. Omitted when the document defines no component
	 * props, matching that payload's omit-when-empty convention.
	 */
	readonly componentProps?: ComponentPropsExportResult;
	/**
	 * Interactive Motion (T3-S3): export-validated surviving interactions,
	 * already narrowed to COMPONENT-LEVEL triggers only (see
	 * `webgl-player.ts`'s `createWebglPlayerRuntimePayload` — a node-scoped
	 * trigger is excluded before it ever reaches this payload, since this
	 * runtime mounts one `<canvas>` with no per-node DOM elements to attach a
	 * listener/observer to). Passed to `createInteractionEngine` as-is; a
	 * node-scoped interaction reaching this field anyway (e.g. a hand-built
	 * payload bypassing the export gate) stays harmlessly inert rather than
	 * erroring, because every event this runtime's host wiring reports omits
	 * `nodeId` and `InteractionEngine.handleEvent`'s trigger matching never
	 * fires a node-scoped trigger for a `nodeId`-less event — see
	 * `interaction-engine.ts`'s `triggerMatchesEvent` JSDoc. Omitted when the
	 * document defines no interactions OR every authored interaction was
	 * dropped/excluded, matching `componentProps`'s omit-when-empty
	 * convention above.
	 */
	readonly interactions?: readonly InteractionDefinition[];
	/**
	 * Internal wiring detail for the Embeddable Motion Artifact contract (see
	 * `mount` below): the embedded artifact's static palette manifest
	 * (`color1..colorN` auto slots plus semantic roles), threaded through by
	 * `webgl-player.ts`'s generated `mount(container, options)` wrapper — that
	 * outer wrapper is the only place with access to the module-level
	 * `paletteManifest` const (declared AFTER the bundled IIFE this file
	 * compiles into, so this generic `mount` cannot read it any other way). A
	 * hand-built or fetched external payload simply omits this; a palette
	 * slot/role-name key then has no effect at mount (only literal hex keys
	 * do) — matching the SVG runtime's identical non-embedded degrade.
	 */
	readonly paletteManifest?: Readonly<Record<string, string>>;
};

/** Host-supplied component-prop values, keyed by prop `name`. */
export type WebglPlayerPropValues = Readonly<Record<string, unknown>>;

/** One item in `WebglPlayer.on(...)`'s event stream — mirrors the SVG runtime's `player.on` event-name set (`RUNTIME_PLAYER_SOURCE` in `code.ts`) so a host callback written against one runtime family reads unchanged against the other. */
export type WebglPlayerEventName =
	| "frame"
	| "clipStart"
	| "clipEnd"
	| "ended"
	| "stateChange";

/** Runtime playback and mount options for a generated WebGL player. */
export type WebglPlayerOptions = {
	readonly frame?: number;
	readonly loop?: boolean;
	readonly autoplay?: boolean;
	readonly playbackRate?: number;
	readonly transparentBackground?: boolean;
	readonly fit?: "intrinsic" | "contain" | "cover" | "fill";
	/**
	 * Device-pixel-ratio multiplier applied to the canvas's backing (raster)
	 * resolution only — its CSS display size (driven by `fit`) is unaffected,
	 * since that is 100%/auto-of-container regardless of backing resolution.
	 * Defaults to 1 (native scene-pixel resolution). Clamped to a minimum of 1.
	 */
	readonly dpr?: number;
	/** Initial component-prop values, applied before the first frame renders. */
	readonly props?: WebglPlayerPropValues;
	/**
	 * Interactive Motion (T3-S3): set `false` to skip instantiating the
	 * interaction engine and its DOM wiring even when `payload.interactions`
	 * is non-empty. Mirrors the SVG runtime's `options.interactions` opt-out
	 * (`RUNTIME_PLAYER_SOURCE` in `code.ts`); defaults to enabled (`true`).
	 */
	readonly interactions?: boolean;
	readonly cameraOverrides?: readonly {
		readonly cameraRigId: string;
		readonly override: RuntimeCameraOverride;
	}[];
	readonly activeCameraOverride?: string | null;
	readonly onFrameSampled?: (event: FrameSampleEvent) => void;
	readonly onFrameRendered?: (event: FrameRenderedEvent) => void;
};

/** Host-overlay mount options for compositing Vecmo output over external media. */
export type WebglPlayerOverlayOptions = WebglPlayerOptions & {
	readonly position?: "absolute" | "fixed";
	readonly pointerEvents?: "none" | "auto";
	readonly zIndex?: number | string;
};

/** Public player API intentionally shaped for GSAP/ScrollTrigger numeric tweens. */
export interface WebglPlayer {
	readonly renderer: "webgl";
	progress: number;
	readonly frame: number;
	readonly durationFrames: number;
	readonly fps: number;
	readonly duration: number;
	readonly loop: boolean;
	readonly playbackRate: number;
	setLoop(loop: boolean): void;
	setPlaybackRate(playbackRate: number): void;
	seek(frame: number): Promise<number>;
	seekFrame(frame: number): Promise<RenderRequestResult>;
	seekProgress(progress: number): Promise<RenderRequestResult>;
	play(): void;
	pause(): void;
	dispose(): void;
	destroy(): void;
	getSnapshot(): VectorMotionFrameSnapshot;
	getCameraState(): VectorMotionFrameSnapshot["camera"];
	getCameraCatalog(): readonly RuntimeCameraCatalogEntry[];
	subscribe(
		listener: () => void,
		options?: { emitCurrent?: boolean },
	): () => void;
	onFrameSampled(listener: (event: FrameSampleEvent) => void): () => void;
	onFrameRendered(listener: (event: FrameRenderedEvent) => void): () => void;
	setCameraOverride(
		cameraRigId: string,
		override: RuntimeCameraOverride | null,
	): Promise<RenderRequestResult>;
	clearCameraOverrides(): Promise<RenderRequestResult>;
	setActiveCameraOverride(
		cameraRigId: string | null,
	): Promise<RenderRequestResult>;
	/**
	 * Subscribes to an Interactive Motion (T3-S3) engine event; returns an
	 * unsubscribe function. Mirrors the SVG runtime's `player.on(...)`
	 * (`RUNTIME_PLAYER_SOURCE` in `code.ts`) — same event names, same
	 * synchronous emission-order contract. Firing requires the payload to
	 * carry at least one surviving interaction AND `options.interactions` not
	 * be `false`; when neither engine is instantiated, `on` still returns a
	 * working (permanently silent) unsubscribe function rather than throwing.
	 */
	on(
		eventName: WebglPlayerEventName,
		callback: (event: InteractionEngineOutputEvent) => void,
	): () => void;
	/**
	 * Applies partial component-prop values, coercing/validating against the
	 * payload's `componentProps.schema` and re-rendering the current frame so
	 * a host sees the change immediately. Unknown prop names warn and are
	 * ignored; see {@link applyComponentProps}.
	 */
	setProps(partial: WebglPlayerPropValues): void;
	/** Frozen live snapshot of the current component-prop values. */
	readonly props: WebglPlayerPropValues;
	/** The payload's component-prop schema (empty when the document defines none). */
	readonly propSchema: readonly ComponentPropExportSchemaEntry[];
}

const numberOr = (value: unknown, fallback: number): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

const frameFromProgress = (progress: number, durationFrames: number): number =>
	clamp(progress, 0, 1) * Math.max(0, durationFrames - 1);

const stylePlayerCanvas = (
	canvas: HTMLCanvasElement,
	fit: WebglPlayerOptions["fit"] = "intrinsic",
): void => {
	canvas.style.display = "block";
	canvas.style.background = "transparent";
	if (fit === "intrinsic") {
		canvas.style.width = "100%";
		canvas.style.height = "auto";
		canvas.style.objectFit = "";
	} else {
		canvas.style.width = "100%";
		canvas.style.height = "100%";
		canvas.style.objectFit = fit;
	}
	canvas.style.setProperty(
		"aspect-ratio",
		`${canvas.width} / ${canvas.height}`,
	);
};

const styleOverlayContainer = (
	container: HTMLElement,
	options: WebglPlayerOverlayOptions,
): void => {
	container.style.position = options.position ?? "absolute";
	container.style.inset = "0";
	container.style.width = "100%";
	container.style.height = "100%";
	container.style.overflow = "hidden";
	container.style.background = "transparent";
	container.style.pointerEvents = options.pointerEvents ?? "none";
	if (options.zIndex !== undefined) {
		container.style.zIndex = String(options.zIndex);
	}
};

// --- Motion Component export props (player.setProps) ---
//
// Ported line-for-line from RUNTIME_PLAYER_SOURCE's applier interpreter in
// code.ts (same clone-on-first-write semantics, same coercion rules) so a
// component-prop change applies identically whether an export routes through
// the SVG or the WebGL player. The applier table (payload.componentProps,
// built by component-props-export.ts at export time) already resolved every
// binding down to a node id + field path; this only executes those
// instructions against the CURRENT scene.

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Depth-first node-id index, rebuilt per `setProps` call (never cached — see JSDoc on `code.ts`'s `buildNodeIndex`). */
const buildNodeIndex = (scene: SceneDocument): Map<string, VectorNode> => {
	const index = new Map<string, VectorNode>();
	const visit = (node: VectorNode): void => {
		index.set(node.id, node);
		for (const child of node.children ?? []) visit(child);
	};
	for (const layer of scene.layers) {
		for (const node of layer.nodes) visit(node);
	}
	return index;
};

/**
 * Clones every object along `path` (not off-path siblings), replacing the
 * leaf with `value`; returns the new root. Mirrors `withValueAtFieldPath` in
 * `RUNTIME_PLAYER_SOURCE` and the plain nested-spread semantics
 * `withValueAtPath` uses in the editor (`recipe-controls.ts`).
 */
const withValueAtFieldPath = (
	root: unknown,
	path: readonly string[],
	value: unknown,
): unknown => {
	if (path.length === 0) return value;
	const [head, ...rest] = path as [string, ...string[]];
	const source = isRecord(root) ? root : {};
	return {
		...source,
		[head]: withValueAtFieldPath(source[head], rest, value),
	};
};

/**
 * Rebuilds the layer/children arrays down to `nodeId`, cloning only the path
 * from the scene root to that node (siblings keep their original
 * references). Mirrors `replaceNodeInScene` in `RUNTIME_PLAYER_SOURCE`.
 */
const replaceNodeInScene = (
	scene: SceneDocument,
	nodeId: string,
	nextNode: VectorNode,
): SceneDocument => {
	const replaceInList = (
		nodes: readonly VectorNode[],
	): readonly VectorNode[] => {
		let changed = false;
		const next = nodes.map((node) => {
			if (node.id === nodeId) {
				changed = true;
				return nextNode;
			}
			if (node.children && node.children.length > 0) {
				const nextChildren = replaceInList(node.children);
				if (nextChildren !== node.children) {
					changed = true;
					return { ...node, children: nextChildren };
				}
			}
			return node;
		});
		return changed ? next : nodes;
	};
	const nextLayers = scene.layers.map((layer) => {
		const nextNodes = replaceInList(layer.nodes);
		return nextNodes === layer.nodes ? layer : { ...layer, nodes: nextNodes };
	});
	return { ...scene, layers: nextLayers };
};

const applySceneFieldInstruction = (
	scene: SceneDocument,
	nodeIndex: Map<string, VectorNode>,
	instruction: Extract<
		ComponentPropApplierInstruction,
		{ kind: "scene-field" }
	>,
	value: unknown,
): SceneDocument => {
	const node = nodeIndex.get(instruction.nodeId);
	if (!node || typeof value !== "number") return scene;
	const nextNode = withValueAtFieldPath(
		node,
		instruction.fieldPath,
		value,
	) as VectorNode;
	nodeIndex.set(instruction.nodeId, nextNode);
	return replaceNodeInScene(scene, instruction.nodeId, nextNode);
};

const applyStyleColorLegacyInstruction = (
	scene: SceneDocument,
	nodeIndex: Map<string, VectorNode>,
	instruction: Extract<
		ComponentPropApplierInstruction,
		{ kind: "style-color-legacy" }
	>,
	value: unknown,
): SceneDocument => {
	const node = nodeIndex.get(instruction.nodeId);
	if (!node || typeof value !== "string") return scene;
	const nextNode = withValueAtFieldPath(
		node,
		["style", instruction.field],
		value,
	) as VectorNode;
	nodeIndex.set(instruction.nodeId, nextNode);
	return replaceNodeInScene(scene, instruction.nodeId, nextNode);
};

const applyStyleColorPaintInstruction = (
	scene: SceneDocument,
	nodeIndex: Map<string, VectorNode>,
	instruction: Extract<
		ComponentPropApplierInstruction,
		{ kind: "style-color-paint" }
	>,
	value: unknown,
): SceneDocument => {
	const node = nodeIndex.get(instruction.nodeId);
	if (!node || typeof value !== "string") return scene;
	const list = (node.style as Record<string, unknown>)[instruction.role];
	if (!Array.isArray(list) || !list[instruction.index]) return scene;
	const nextList = list.map((paint: Record<string, unknown>, index: number) =>
		index === instruction.index ? { ...paint, color: value } : paint,
	);
	const nextNode = withValueAtFieldPath(
		node,
		["style", instruction.role],
		nextList,
	) as VectorNode;
	nodeIndex.set(instruction.nodeId, nextNode);
	return replaceNodeInScene(scene, instruction.nodeId, nextNode);
};

const applyTextContentInstruction = (
	scene: SceneDocument,
	nodeIndex: Map<string, VectorNode>,
	instruction: Extract<
		ComponentPropApplierInstruction,
		{ kind: "text-content" }
	>,
	value: unknown,
): SceneDocument => {
	const node = nodeIndex.get(instruction.nodeId);
	if (!node || typeof value !== "string") return scene;
	const nextNode = withValueAtFieldPath(
		node,
		["geometry", "text"],
		value,
	) as VectorNode;
	nodeIndex.set(instruction.nodeId, nextNode);
	return replaceNodeInScene(scene, instruction.nodeId, nextNode);
};

const applyComponentPropInstruction = (
	scene: SceneDocument,
	nodeIndex: Map<string, VectorNode>,
	instruction: ComponentPropApplierInstruction,
	value: unknown,
): SceneDocument => {
	if (instruction.kind === "scene-field") {
		return applySceneFieldInstruction(scene, nodeIndex, instruction, value);
	}
	if (instruction.kind === "style-color-legacy") {
		return applyStyleColorLegacyInstruction(
			scene,
			nodeIndex,
			instruction,
			value,
		);
	}
	if (instruction.kind === "style-color-paint") {
		return applyStyleColorPaintInstruction(
			scene,
			nodeIndex,
			instruction,
			value,
		);
	}
	return applyTextContentInstruction(scene, nodeIndex, instruction, value);
};

/**
 * Conservative coercion matching the schema's declared type: numbers go
 * through `Number()` + finite-check + min/max clamp (never NaN/Infinity into
 * the scene), color/text pass through as strings. Returns `undefined` (never
 * sets) when the raw value cannot be coerced. Mirrors
 * `coerceComponentPropValue` in `RUNTIME_PLAYER_SOURCE`.
 */
const coerceComponentPropValue = (
	schemaEntry: ComponentPropExportSchemaEntry,
	rawValue: unknown,
): number | string | undefined => {
	if (schemaEntry.type === "number") {
		const numeric = Number(rawValue);
		if (!Number.isFinite(numeric)) return undefined;
		const min =
			typeof schemaEntry.min === "number" ? schemaEntry.min : -Infinity;
		const max =
			typeof schemaEntry.max === "number" ? schemaEntry.max : Infinity;
		return Math.min(max, Math.max(min, numeric));
	}
	if (rawValue === undefined || rawValue === null) return undefined;
	return String(rawValue);
};

const defaultComponentPropValue = (
	value: ComponentPropValue,
): number | string => value.value;

/** Mutable per-mount component-prop state: the payload's schema/appliers plus the current values. */
type ComponentPropsRuntimeState = {
	readonly schema: readonly ComponentPropExportSchemaEntry[];
	readonly appliers: ReadonlyMap<
		string,
		readonly ComponentPropApplierInstruction[]
	>;
	propValues: Record<string, number | string>;
};

const createComponentPropsRuntimeState = (
	componentProps: ComponentPropsExportResult | undefined,
): ComponentPropsRuntimeState => ({
	schema: componentProps?.schema ?? [],
	appliers: new Map(
		(componentProps?.appliers ?? []).map(
			(entry) => [entry.name, entry.instructions] as const,
		),
	),
	propValues: {},
});

/**
 * Applies `partial` against `scene`, validating prop names against the
 * schema (unknown -> `console.warn` + ignore), coercing each value, and
 * applying every surviving instruction (clone-on-first-write). Stores the
 * coerced value in `state.propValues` regardless of whether any instruction
 * could apply, so `player.props` always reflects what the host set even for
 * a `supported:false` schema entry — but a known, `supported:false` prop
 * also `console.warn`s (distinct message from the unknown-prop case) since
 * setting it is a silent no-op otherwise, e.g. a binding the export compiler
 * dropped for targeting a node+property that already has a keyframe track.
 * Returns the (possibly unchanged) scene; the caller re-renders the current
 * frame when a `WebglPlayerPropValues` value actually moved the tree.
 * Mirrors `applyComponentProps` in `RUNTIME_PLAYER_SOURCE`.
 */
const applyComponentProps = (
	state: ComponentPropsRuntimeState,
	scene: SceneDocument,
	partial: WebglPlayerPropValues,
): SceneDocument => {
	const schemaByName = new Map(
		state.schema.map((entry) => [entry.name, entry] as const),
	);
	let nextScene = scene;
	let nodeIndex: Map<string, VectorNode> | null = null;
	for (const [name, rawValue] of Object.entries(partial)) {
		const schemaEntry = schemaByName.get(name);
		if (!schemaEntry) {
			console.warn(
				`Vector motion WebGL runtime: unknown component prop "${name}".`,
			);
			continue;
		}
		const coerced = coerceComponentPropValue(schemaEntry, rawValue);
		if (coerced === undefined) {
			console.warn(
				`Vector motion WebGL runtime: invalid value for component prop "${name}".`,
			);
			continue;
		}
		state.propValues[name] = coerced;
		if (schemaEntry.supported === false) {
			console.warn(
				`Vector motion WebGL runtime: component prop "${name}" has no runtime-applicable binding (dropped at export time, e.g. an unsupported source or a conflicting keyframe track); the value is stored but will not change the render output.`,
			);
			continue;
		}
		const instructions = state.appliers.get(name) ?? [];
		if (instructions.length === 0) continue;
		if (!nodeIndex) nodeIndex = buildNodeIndex(nextScene);
		for (const instruction of instructions) {
			const appliedScene = applyComponentPropInstruction(
				nextScene,
				nodeIndex,
				instruction,
				coerced,
			);
			if (appliedScene !== nextScene) {
				nextScene = appliedScene;
				// A descendant replacement clones its ancestor chain. Re-index the
				// current tree so a later ancestor write preserves that new subtree.
				nodeIndex = buildNodeIndex(nextScene);
			}
		}
	}
	return nextScene;
};

/**
 * Seeds `state.propValues` from the schema's declared defaults, then layers
 * `initialProps` (constructor `options.props`) on top through the same
 * coerce/apply path a later `setProps` call uses, so an initial value takes
 * effect in the very first rendered frame. Mirrors `initializeComponentProps`
 * in `RUNTIME_PLAYER_SOURCE`.
 */
const initializeComponentProps = (
	state: ComponentPropsRuntimeState,
	scene: SceneDocument,
	initialProps: WebglPlayerPropValues | undefined,
): SceneDocument => {
	for (const entry of state.schema) {
		state.propValues[entry.name] = defaultComponentPropValue(
			entry.defaultValue,
		);
	}
	if (!initialProps || state.schema.length === 0) return scene;
	return applyComponentProps(state, scene, initialProps);
};

// --- Interactive Motion (T3-S3): engine bridge + DOM event wiring ---
//
// Reuses the SAME pure `createInteractionEngine` the SVG runtime bundles (see
// `interaction-engine.ts`'s module JSDoc) via a normal ES import — unlike the
// SVG runtime, this module ships as a real esbuild bundle
// (`scripts/webgl-player-bundle.ts` bundles `webgl-player-entry.ts`'s full
// import graph, the same way it already pulls in `buildExportRenderPresentation`
// from `render-presentation.ts`), so no line-for-line port or generated-bundle
// indirection is needed here. Only COMPONENT-LEVEL triggers are wired: this
// runtime mounts one `<canvas>` with no per-node DOM elements, so every
// synthesized `InteractionEngineEvent` below omits `nodeId` — a node-scoped
// interaction (already excluded from `payload.interactions` at export time,
// see `webgl-player.ts`) stays inert by construction even if one slipped
// through, since the engine's own trigger matching never fires a node-scoped
// trigger for a `nodeId`-less event.

/** Minimal synchronous pub/sub for `WebglPlayer.on(...)`; mirrors `createEventEmitter` in `code.ts`'s `RUNTIME_PLAYER_SOURCE`. */
const createWebglEventEmitter = () => {
	const listenersByName = new Map<
		WebglPlayerEventName,
		Set<(event: InteractionEngineOutputEvent) => void>
	>();
	return {
		on(
			name: WebglPlayerEventName,
			callback: (event: InteractionEngineOutputEvent) => void,
		): () => void {
			if (typeof callback !== "function") return () => {};
			const listeners = listenersByName.get(name) ?? new Set();
			listeners.add(callback);
			listenersByName.set(name, listeners);
			return () => {
				listeners.delete(callback);
			};
		},
		emit(
			name: WebglPlayerEventName,
			event: InteractionEngineOutputEvent,
		): void {
			for (const callback of listenersByName.get(name) ?? []) callback(event);
		},
		clear(): void {
			listenersByName.clear();
		},
	};
};

type WebglEventEmitter = ReturnType<typeof createWebglEventEmitter>;

/** Routes one engine output event to either `applySetProp` (`"set-prop"`) or the emitter under its own kind name — mirrors `dispatchEngineEvents` in `code.ts`. */
const dispatchWebglEngineEvents = (
	events: readonly InteractionEngineOutputEvent[],
	emitter: WebglEventEmitter,
	applySetProp: (propName: string, value: number | string) => void,
): void => {
	for (const event of events) {
		if (event.kind === "set-prop") {
			applySetProp(event.propName, event.value);
			continue;
		}
		emitter.emit(event.kind, event);
	}
};

/** Same enter-to-exit scroll fraction formula as the SVG runtime's `scrollProgressForContainer` in `code.ts`, kept byte-identical so a document's `scroll-progress` trigger behaves the same regardless of which runtime family renders it. */
const scrollProgressForElement = (element: HTMLElement): number => {
	const rect = element.getBoundingClientRect();
	const viewportHeight =
		window.innerHeight || document.documentElement.clientHeight || 1;
	const denominator = viewportHeight + rect.height;
	if (denominator <= 0) return 0;
	const fraction = (viewportHeight - rect.top) / denominator;
	return Math.min(1, Math.max(0, fraction));
};

/**
 * Callbacks {@link installWebglInteractionWiring} uses to close the
 * render/play-loop gap between the interaction path and the player's own
 * clock. An interaction-fired action (play-clip, toggle-clip, seek, pause,
 * resume) mutates engine state and returns output events, but nothing about
 * that call touches the GPU raster or the rAF loop by itself — `engine.tick()`
 * (the only thing that advances frames and re-renders during normal playback)
 * runs exclusively from inside the player's own `tick()`, which is itself
 * gated on `playing`. Without this bridge, a paused/static player
 * (`autoplay: false`) that receives a `click -> play-clip` never repaints and
 * never starts progressing, even though the engine's own frame pointer and
 * `clipStart`/`stateChange` events are already correct.
 */
type WebglLoopControl = {
	/**
	 * Re-renders the engine's CURRENT frame through the player's normal
	 * internal request-serialized render path (`requestFrame`) — never
	 * `api.seek`/`api.seekProgress`, which re-run `engine.seek()` and would
	 * clear the very clip segment `engine.handleEvent` just established.
	 */
	renderNow(): void;
	/**
	 * Starts the rAF loop the exact same way `api.play()` does (shared body,
	 * so the two call sites cannot drift) when `engineState` is no longer
	 * `"paused"` and the loop isn't already running, and stops it when the
	 * engine just became `"paused"` while the loop WAS running — otherwise a
	 * `pause` action would leave `tick()` scheduling itself forever
	 * (`engine.tick()` no-ops while paused, so nothing ever changes, but the
	 * rAF loop would still spin re-rastering the same frame every tick).
	 */
	syncStateChange(engineState: InteractionEngineActiveState): void;
};

/**
 * Installs every DOM listener/observer a COMPONENT-LEVEL trigger needs against
 * `container` (click/hover-in/hover-out/in-view/scroll-progress — the same
 * trigger kinds the SVG runtime's `installInteractionWiring` supports for its
 * OWN component-level triggers), dispatching each into `engine.handleEvent`
 * and forwarding the resulting output events. Returns a `dispose()` that
 * removes everything installed here; `WebglPlayer.dispose()` calls it
 * unconditionally so a player mounted with an inert (no-interactions) payload
 * still gets a no-op dispose.
 */
const installWebglInteractionWiring = (
	container: HTMLElement,
	engine: InteractionEngine,
	interactions: readonly InteractionDefinition[],
	emitter: WebglEventEmitter,
	applySetProp: (propName: string, value: number | string) => void,
	loopControl: WebglLoopControl,
): (() => void) => {
	const disposers: Array<() => void> = [];
	const handle = (
		event: Parameters<InteractionEngine["handleEvent"]>[0],
	): void => {
		const events = engine.handleEvent(event);
		dispatchWebglEngineEvents(events, emitter, applySetProp);
		// A set-prop-only event list is already re-rendered by applySetProp's
		// own requestFrame call (see this module's applySetProp) — rendering
		// again here would be a harmless but wasted duplicate GPU raster pass,
		// so only trigger loopControl.renderNow for an event list containing at
		// least one non-"set-prop" kind.
		const needsRender = events.some(
			(outputEvent) => outputEvent.kind !== "set-prop",
		);
		if (needsRender) loopControl.renderNow();
		const stateChange = events.find(
			(outputEvent) => outputEvent.kind === "stateChange",
		);
		if (stateChange && stateChange.kind === "stateChange") {
			loopControl.syncStateChange(stateChange.state);
		}
	};

	const onClick = (): void => handle({ kind: "click" });
	const onPointerOver = (): void => handle({ kind: "hover-in" });
	const onPointerOut = (): void => handle({ kind: "hover-out" });
	container.addEventListener("click", onClick);
	container.addEventListener("pointerover", onPointerOver);
	container.addEventListener("pointerout", onPointerOut);
	disposers.push(() => {
		container.removeEventListener("click", onClick);
		container.removeEventListener("pointerover", onPointerOver);
		container.removeEventListener("pointerout", onPointerOut);
	});

	const hasInViewTrigger = interactions.some(
		(interaction) => interaction.trigger.kind === "in-view",
	);
	if (hasInViewTrigger && typeof IntersectionObserver === "function") {
		// One observer per distinct threshold across every component-level
		// in-view trigger, observing `container` itself (there is no per-node
		// target on a canvas) — re-arms both directions like the SVG runtime's
		// equivalent observer, so the trigger can fire again after the player
		// leaves and re-enters view.
		const thresholds = new Set(
			interactions
				.filter((interaction) => interaction.trigger.kind === "in-view")
				.map((interaction) =>
					Math.min(1, Math.max(0, interaction.trigger.threshold ?? 0.5)),
				),
		);
		const observers = [...thresholds].map((threshold) => {
			const observer = new IntersectionObserver(
				(entries) => {
					for (const entry of entries) {
						if (entry.isIntersecting) handle({ kind: "in-view" });
					}
				},
				{ threshold },
			);
			observer.observe(container);
			return observer;
		});
		disposers.push(() => {
			for (const observer of observers) observer.disconnect();
		});
	}

	const hasScrollProgressTrigger = interactions.some(
		(interaction) => interaction.trigger.kind === "scroll-progress",
	);
	if (hasScrollProgressTrigger) {
		const onScroll = (): void => {
			handle({
				kind: "scroll-progress",
				value: scrollProgressForElement(container),
			});
		};
		window.addEventListener("scroll", onScroll, { passive: true });
		window.addEventListener("resize", onScroll);
		onScroll();
		disposers.push(() => {
			window.removeEventListener("scroll", onScroll);
			window.removeEventListener("resize", onScroll);
		});
	}

	return () => {
		for (const dispose of disposers) dispose();
	};
};

/**
 * Mounts a deterministic WebGL player backed by the same SVG serializer,
 * motion sampler, Look graph resolver, and GPU surface used by editor/export
 * rendering. The returned object intentionally exposes `progress` as a mutable
 * numeric property so GSAP/ScrollTrigger can drive it directly.
 */
export async function createVectorMotionWebglPlayer(
	container: HTMLElement | null | undefined,
	payload: WebglPlayerPayload,
	options: WebglPlayerOptions = {},
): Promise<WebglPlayer> {
	if (!container) {
		throw new Error("WebGL player export requires a mount container.");
	}
	const { motion, grammarBindings } = payload;
	// Mutable: `setProps` reassigns this via clone-on-first-write so the next
	// `renderFrame` call picks up the patched scene, exactly like the SVG
	// player's `state.payload.scene` reassignment. Artboard dimensions and fps/
	// durationFrames are read once at mount — no component-prop binding kind
	// targets those fields, so they never need to change after construction.
	let scene = payload.scene;
	const sequence = payload.sceneSequence;
	const hasSceneSequence = (sequence?.items.length ?? 0) > 0;
	let currentFrame = clamp(
		numberOr(options.frame, 0),
		0,
		Math.max(
			1,
			(hasSceneSequence ? sequence?.totalFrames : motion.durationFrames) ?? 1,
		) - 1,
	);
	const initialAddress =
		hasSceneSequence && sequence
			? resolveSequenceFrameAddress(sequence, currentFrame)
			: undefined;
	const initialScene = initialAddress
		? (scopeSceneToArtboard(scene, initialAddress.artboardId) ?? scene)
		: scene;
	// Backing (raster) resolution only — CSS display size (`stylePlayerCanvas`,
	// driven by `fit`) is 100%/auto regardless of this, so `dpr` sharpens the
	// output on high-DPI screens without a re-architected viewport mapping.
	const dpr = Math.max(1, numberOr(options.dpr, 1));
	const width = Math.max(1, Math.round(initialScene.artboard.width * dpr));
	const height = Math.max(1, Math.round(initialScene.artboard.height * dpr));
	const fps = Math.max(
		1,
		numberOr(hasSceneSequence ? sequence?.fps : motion.fps, 30),
	);
	const durationFrames = Math.max(
		1,
		Math.round(
			numberOr(
				hasSceneSequence ? sequence?.totalFrames : motion.durationFrames,
				1,
			),
		),
	);
	const surface = createGpuRasterSurface(width, height, {
		transparentOutput: options.transparentBackground !== false,
	});
	if (!surface) {
		throw new Error("This browser does not support the WebGL player.");
	}

	stylePlayerCanvas(surface.canvas, options.fit);
	container.replaceChildren(surface.canvas);

	const componentPropsState = createComponentPropsRuntimeState(
		payload.componentProps,
	);
	scene = initializeComponentProps(componentPropsState, scene, options.props);

	let loop = options.loop !== false;
	let playbackRateValue = numberOr(options.playbackRate, 1);
	const playbackRate = (): number => playbackRateValue;
	currentFrame = clamp(currentFrame, 0, durationFrames - 1);
	let playheadFrame = currentFrame;
	let playing = false;
	let rafId = 0;
	let lastTime = 0;
	let disposed = false;

	// Interactive Motion (T3-S3): an engine is instantiated only when the
	// payload actually carries surviving (already export-narrowed to
	// component-level, see `payload.interactions`'s JSDoc) interactions AND
	// the host has not opted out via `options.interactions === false` —
	// mirrors the SVG runtime's `interactionsEnabled` gate exactly
	// (`RUNTIME_PLAYER_SOURCE` in `code.ts`).
	const authoredInteractions = payload.interactions ?? [];
	const interactionsEnabled =
		!hasSceneSequence &&
		authoredInteractions.length > 0 &&
		options.interactions !== false;
	const engine = interactionsEnabled
		? createInteractionEngine({
				interactions: authoredInteractions,
				clips: motion.clips ?? [],
				fps,
				durationFrames,
				loop,
			})
		: null;
	const eventEmitter = createWebglEventEmitter();
	let disposeInteractionWiring: (() => void) | null = null;
	const cameraCatalog: readonly RuntimeCameraCatalogEntry[] = (
		scene.sceneCameras ?? []
	).map((rig) => ({
		cameraRigId: rig.id,
		name: rig.name,
		...(rig.scope.kind === "artboard"
			? { artboardId: rig.scope.artboardId }
			: {}),
		projectionKind: rig.projection.kind,
	}));
	let control: ReturnType<typeof createRuntimePlayerControl>;
	try {
		control = createRuntimePlayerControl({
			renderer: "webgl",
			fps,
			durationFrames,
			initialFrame: currentFrame,
			initialCamera: {
				kind: "none",
				artboardId: initialScene.artboard.id,
				fidelity: "none",
				issues: [],
			},
			initialFrameScope: initialAddress
				? {
						kind: "scene-sequence",
						sequenceId: initialAddress.sequenceId,
						itemId: initialAddress.itemId,
						artboardId: initialAddress.artboardId,
						globalFrame: initialAddress.globalFrame,
						localFrame: initialAddress.localFrame,
						itemStartFrame: initialAddress.itemStartFrame,
						itemEndFrameExclusive: initialAddress.itemEndFrameExclusive,
					}
				: {
						kind: "scene",
						artboardId: initialScene.artboard.id,
						localFrame: currentFrame,
					},
			cameraCatalog,
			initialCameraOverrides: options.cameraOverrides,
			initialActiveCameraOverride: options.activeCameraOverride,
			onFrameSampled: options.onFrameSampled,
			onFrameRendered: options.onFrameRendered,
			async render(request) {
				const address =
					hasSceneSequence && sequence
						? resolveSequenceFrameAddress(sequence, request.requestedFrame)
						: undefined;
				if (hasSceneSequence && !address) {
					throw new Error(
						"WebGL sequence frame could not resolve an artboard.",
					);
				}
				const artboardId = address?.artboardId ?? scene.artboard.id;
				const localFrame = address?.localFrame ?? request.requestedFrame;
				const cameraRuntimeControl = address
					? runtimeCameraControlForArtboard(
							scene,
							artboardId,
							request.cameraRuntimeControl,
						)
					: request.cameraRuntimeControl;
				const renderPresentation = buildExportRenderPresentation({
					scene,
					motion,
					frame: localFrame,
					artboardId,
					grammarBindings,
					cameraRuntimeControl,
				});
				const scope = address
					? {
							kind: "scene-sequence" as const,
							sequenceId: address.sequenceId,
							itemId: address.itemId,
							artboardId: address.artboardId,
							globalFrame: address.globalFrame,
							localFrame: address.localFrame,
							itemStartFrame: address.itemStartFrame,
							itemEndFrameExclusive: address.itemEndFrameExclusive,
						}
					: {
							kind: "scene" as const,
							artboardId,
							localFrame: renderPresentation.frame,
						};
				const committedFrame = address?.globalFrame ?? renderPresentation.frame;
				if (!request.sample(committedFrame, renderPresentation.camera, scope)) {
					throw new Error("WebGL render request was disposed before commit.");
				}
				const hasRuntimeCameraControl =
					request.cameraRuntimeControl.activeCameraRigId != null ||
					Object.keys(request.cameraRuntimeControl.cameraOverrides ?? {})
						.length > 0;
				if (
					hasRuntimeCameraControl &&
					renderPresentation.camera.kind === "invalid"
				) {
					throw new Error(
						"Runtime camera control produced an invalid camera state.",
					);
				}
				const scopedPresentationScene = address
					? scopeSceneToArtboard(renderPresentation.scene, artboardId)
					: renderPresentation.scene;
				if (!scopedPresentationScene) {
					throw new Error(
						`WebGL sequence artboard "${artboardId}" is missing from the sampled scene.`,
					);
				}
				if (
					surface.canvas.width !==
						Math.round(scopedPresentationScene.artboard.width * dpr) ||
					surface.canvas.height !==
						Math.round(scopedPresentationScene.artboard.height * dpr)
				) {
					surface.resize(
						scopedPresentationScene.artboard.width * dpr,
						scopedPresentationScene.artboard.height * dpr,
					);
					stylePlayerCanvas(surface.canvas, options.fit);
				}
				const presentationFps = Math.max(
					1,
					numberOr(renderPresentation.sourceMotion?.fps, fps),
				);
				const timeSeconds = renderPresentation.frame / presentationFps;
				const sampledScene = await materializeVideoAssetFrames(
					scopedPresentationScene,
					timeSeconds,
				);
				if (!request.isActive()) {
					throw new Error("WebGL render request is no longer active.");
				}
				const materializedPresentation = {
					...renderPresentation,
					scene: sampledScene,
				};
				const svgPrefix = renderSceneSvg({
					scene: scopedPresentationScene,
					motion,
					frame: renderPresentation.frame,
					grammarBindings,
					renderPresentation: materializedPresentation,
					transparentBackground: options.transparentBackground !== false,
					deferGpuRasterEffects: true,
				});
				const rasterOptions = { timeSeconds };
				const tree = buildRasterTree(sampledScene, rasterOptions);
				if (tree) {
					await surface.renderTree({ svgPrefix, root: tree });
				} else {
					const passes = buildRasterPasses(sampledScene, rasterOptions);
					if (passes.length > 0) {
						await surface.renderPipeline({ svgPrefix, passes });
					} else {
						await surface.renderTree({ svgPrefix, root: { kind: "source" } });
					}
				}
				if (!request.isActive()) {
					throw new Error("WebGL render request was disposed during commit.");
				}
				currentFrame = committedFrame;
				return {
					frame: committedFrame,
					scope,
					camera: renderPresentation.camera,
				};
			},
		});
	} catch (error) {
		container.replaceChildren();
		surface.dispose();
		throw error;
	}
	const requestFrame = control.requestFrame;

	// Component-prop write path shared by `api.setProps` and engine `set-prop`
	// output events — never `await`ed here (matches every other fire-and-forget
	// `requestFrame` call in this module; a set-prop write does not need to
	// block the caller on the next GPU raster completing).
	const applySetProp = (propName: string, value: number | string): void => {
		scene = applyComponentProps(componentPropsState, scene, {
			[propName]: value,
		});
		void control.rerenderCommittedFrame();
	};

	// Shared by `api.play()` and the interaction path
	// (`installWebglInteractionWiring`'s `loopControl.syncStateChange` below)
	// so a play-clip/toggle-clip/resume action starts the rAF loop THE EXACT
	// SAME WAY an explicit `api.play()` call does — one body, so the two call
	// sites can never drift apart.
	const startLoop = (): void => {
		if (playing || disposed) return;
		playing = true;
		lastTime = 0;
		rafId = requestAnimationFrame(tick);
	};
	const stopLoop = (): void => {
		playing = false;
		if (rafId !== 0) cancelAnimationFrame(rafId);
		rafId = 0;
		lastTime = 0;
	};

	const tick = (timestamp: number): void => {
		if (!playing || disposed) return;
		if (lastTime === 0) lastTime = timestamp;
		const deltaSeconds = (timestamp - lastTime) / 1000;
		lastTime = timestamp;
		if (engine) {
			// The engine owns frame advancement (including clip windows and its
			// own `loop` option) — `engine.tick()` is already authoritative, so
			// this branch must NOT also apply the raw `playheadFrame += deltaFrames`
			// arithmetic below, mirroring the SVG runtime's `applyRenderFrame` vs
			// `api.renderFrame` split (`code.ts`'s `tick` function has the same
			// engine/non-engine branch for the identical reason).
			const result = engine.tick(deltaSeconds * playbackRate());
			dispatchWebglEngineEvents(result.events, eventEmitter, applySetProp);
			playheadFrame = result.frame;
			void requestFrame(playheadFrame);
			if (result.ended) {
				stopLoop();
				return;
			}
			if (playing) rafId = requestAnimationFrame(tick);
			return;
		}
		const deltaFrames = deltaSeconds * fps * playbackRate();
		playheadFrame += deltaFrames;
		if (playheadFrame > durationFrames - 1) {
			if (loop) {
				playheadFrame %= durationFrames;
			} else {
				playheadFrame = durationFrames - 1;
				playing = false;
			}
		}
		void requestFrame(playheadFrame);
		if (playing) rafId = requestAnimationFrame(tick);
	};

	const api: WebglPlayer = {
		renderer: "webgl",
		get frame() {
			return control.getSnapshot().frame;
		},
		get progress() {
			return control.getSnapshot().progress;
		},
		set progress(value) {
			void api.seekProgress(value);
		},
		get durationFrames() {
			return durationFrames;
		},
		get fps() {
			return fps;
		},
		get duration() {
			return durationFrames / fps;
		},
		get loop() {
			return loop;
		},
		setLoop(nextLoop: boolean) {
			loop = nextLoop;
			engine?.setLoop(loop);
		},
		get playbackRate() {
			return playbackRateValue;
		},
		setPlaybackRate(nextPlaybackRate: number) {
			playbackRateValue = numberOr(nextPlaybackRate, 1);
		},
		async seek(frame: number) {
			const result = await api.seekFrame(frame);
			return result.status === "committed" ? result.snapshot.frame : api.frame;
		},
		seekFrame(frame: number) {
			playheadFrame = clamp(frame, 0, durationFrames - 1);
			// A host-initiated seek is authoritative over the engine's frame
			// pointer — sync it via `engine.seek()` (which also clears any active
			// clip segment, like a scrubber jumping the player out of whatever
			// clip was mid-playback), mirroring the SVG runtime's
			// `api.renderFrame`/`engine.seek()` pairing. The internal `tick()`
			// path above never calls this, since `engine.tick()` is already its
			// own authoritative frame source.
			engine?.seek(playheadFrame);
			return requestFrame(playheadFrame);
		},
		seekProgress(progress: number) {
			const frame = frameFromProgress(numberOr(progress, 0), durationFrames);
			playheadFrame = frame;
			engine?.seek(playheadFrame);
			return requestFrame(frame);
		},
		play: startLoop,
		pause: stopLoop,
		getSnapshot: control.getSnapshot,
		getCameraState: control.getCameraState,
		getCameraCatalog: control.getCameraCatalog,
		subscribe: control.subscribe,
		onFrameSampled: control.onFrameSampled,
		onFrameRendered: control.onFrameRendered,
		setCameraOverride: control.setCameraOverride,
		clearCameraOverrides: control.clearCameraOverrides,
		setActiveCameraOverride: control.setActiveCameraOverride,
		destroy() {
			if (disposed) return;
			disposed = true;
			api.pause();
			disposeInteractionWiring?.();
			control.destroy();
			eventEmitter.clear();
			container.replaceChildren();
			surface.dispose();
		},
		dispose() {
			api.destroy();
		},
		on(eventName, callback) {
			return eventEmitter.on(eventName, callback);
		},
		setProps(partial: WebglPlayerPropValues) {
			scene = applyComponentProps(componentPropsState, scene, partial);
			void control.rerenderCommittedFrame();
		},
		get props() {
			return Object.freeze({ ...componentPropsState.propValues });
		},
		get propSchema() {
			return componentPropsState.schema;
		},
	};
	if (engine) {
		disposeInteractionWiring = installWebglInteractionWiring(
			container,
			engine,
			authoredInteractions,
			eventEmitter,
			applySetProp,
			{
				renderNow: () => {
					playheadFrame = engine.frame;
					void requestFrame(engine.frame);
				},
				syncStateChange: (engineState) => {
					if (engineState === "paused") {
						if (playing) stopLoop();
						return;
					}
					startLoop();
				},
			},
		);
	}

	const initialResult = await requestFrame(currentFrame);
	if (initialResult.status !== "committed") {
		api.destroy();
		throw new Error(
			initialResult.status === "rejected"
				? initialResult.issue.message
				: `Initial WebGL render ended with status "${initialResult.status}".`,
		);
	}
	if (options.autoplay) api.play();
	return api;
}

/**
 * Mounts the WebGL player as a transparent overlay layer for host-composited
 * video, VJ, signage, or OBS/browser-source usage. The helper only owns the
 * passed container and canvas styling; the host remains responsible for the
 * external media beneath it.
 */
export async function mountVectorMotionWebglOverlay(
	container: HTMLElement | null | undefined,
	payload: WebglPlayerPayload,
	options: WebglPlayerOverlayOptions = {},
): Promise<WebglPlayer> {
	if (!container) {
		throw new Error("WebGL overlay export requires a mount container.");
	}
	styleOverlayContainer(container, options);
	return createVectorMotionWebglPlayer(container, payload, {
		...options,
		transparentBackground: true,
		fit: options.fit ?? "cover",
	});
}

// --- Embeddable Motion Artifact: mount(container, payload, opts) (F1/F2) ---
//
// WebGL parity for the SVG runtime's `mount` (`RUNTIME_PLAYER_SOURCE` in
// `code.ts`): same synchronous-handle contract (play/pause/seek/destroy/
// ready), same pre-ready intent queuing, same destroy-before-ready
// cancellation, same idle-CPU visibility gating, same cover-fit +
// densityCenter container-following. `dpr`/palette remap are handled above
// this function (dpr inside `createVectorMotionWebglPlayer` itself; palette
// remap here, before that call, since it operates on the whole payload).

const PALETTE_HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{3,8}$/;

/** Mirrors `PALETTE_COLOR_FUNCTION_PATTERN` in `palette-manifest.ts` — see `normalizeColorToken` below for why this is duplicated rather than imported. Closed and anchored deliberately: `applyPaletteReplacements` below tests every string in the payload, so a permissive match would false-positive on unrelated function-shaped strings. */
const PALETTE_COLOR_FUNCTION_PATTERN =
	/^(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\((.+)\)$/i;

/** Mirrors `canonicalizeColorFunctionArgs` in `palette-manifest.ts` — syntax-only comma/space/slash/whitespace canonicalization, no numeric or unit math. */
const canonicalizeColorFunctionArgs = (rawArgs: string): string | null => {
	const args = rawArgs
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
		.join(" ")
		.replace(/\s*\/\s*/g, " / ")
		.replace(/\s+/g, " ")
		.trim();
	return args.length > 0 ? args : null;
};

/**
 * Mirrors `normalizeColorToken` in `palette-manifest.ts` — duplicated (not
 * imported) so that module's build-time-only role-scoring/luminance code
 * never ships inside this browser-bundled runtime; keep both copies in sync.
 * Only the recognition/canonicalization half is needed here: role assignment
 * already happened at build time and is baked into the static
 * `paletteManifest` this runtime receives, so this copy only ever has to
 * match a payload string against that manifest's already-normalized values.
 */
const normalizeColorToken = (value: unknown): string | null => {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (PALETTE_HEX_COLOR_PATTERN.test(trimmed)) {
		const lower = trimmed.toLowerCase();
		const digits = lower.slice(1);
		if (digits.length === 3 || digits.length === 4) {
			return `#${digits
				.split("")
				.map((digit) => digit + digit)
				.join("")}`;
		}
		return lower;
	}
	const match = PALETTE_COLOR_FUNCTION_PATTERN.exec(trimmed);
	if (!match) return null;
	const name = match[1]?.toLowerCase();
	const args = match[2] ? canonicalizeColorFunctionArgs(match[2]) : null;
	return name && args ? `${name}(${args})` : null;
};

/** Mirrors `resolvePaletteReplacements` in `palette-manifest.ts` — see `normalizeColorToken` above for why this is duplicated rather than imported. */
const resolvePaletteReplacements = (
	manifest: Readonly<Record<string, string>> | undefined,
	palette: Readonly<Record<string, string>> | undefined,
): ReadonlyMap<string, string> => {
	const replacements = new Map<string, string>();
	if (!palette) return replacements;
	for (const key of Object.keys(palette)) {
		const requestedReplacement = palette[key];
		if (requestedReplacement === undefined) continue;
		const sourceColor =
			manifest && Object.hasOwn(manifest, key)
				? normalizeColorToken(manifest[key])
				: normalizeColorToken(key);
		if (sourceColor) replacements.set(sourceColor, requestedReplacement);
	}
	return replacements;
};

/** Mirrors `applyPaletteReplacements` in `palette-manifest.ts` — see `normalizeColorToken` above for why this is duplicated rather than imported. */
const applyPaletteReplacements = <T>(
	value: T,
	replacements: ReadonlyMap<string, string>,
): T => {
	if (replacements.size === 0) return value;
	if (typeof value === "string") {
		const normalized = normalizeColorToken(value);
		const replacement = normalized ? replacements.get(normalized) : undefined;
		return (replacement ?? value) as T;
	}
	if (Array.isArray(value)) {
		return value.map((item) =>
			applyPaletteReplacements(item, replacements),
		) as T;
	}
	if (isRecord(value)) {
		const next: Record<string, unknown> = {};
		for (const key of Object.keys(value)) {
			next[key] = applyPaletteReplacements(value[key], replacements);
		}
		return next as T;
	}
	return value;
};

/** Host-facing options for the Embeddable Motion Artifact `mount` contract. */
export type EmbeddableMotionMountOptions = {
	readonly reducedMotion?: boolean;
	readonly dpr?: number;
	readonly palette?: Readonly<Record<string, string>>;
	readonly autoplay?: boolean;
	readonly loop?: boolean;
	/**
	 * Cover-crop focal point, each axis normalized 0-1 against the artboard —
	 * like CSS `object-position`. Default `{ x: 0.5, y: 0.5 }` (center).
	 * Crop alignment only: never re-choreographs scene content.
	 */
	readonly densityCenter?: { readonly x: number; readonly y: number };
};

/** Handle returned synchronously by `mount`. */
export interface EmbeddableMotionMountHandle {
	play(): void;
	pause(): void;
	/** Clamped 0..1; maps to `seekProgress`. */
	seek(progress: number): void;
	/** Idempotent; releases the rAF loop, every observer, and the DOM. Safe before `ready` resolves. */
	destroy(): void;
	/** Resolves once the underlying player is initialized; rejects on mount failure or a `destroy()` before that. */
	readonly ready: Promise<void>;
}

/**
 * Mounts a WebGL player under the Embeddable Motion Artifact contract: a
 * variable-size, full-bleed hero background is the primary target, so `fit`
 * is always `"cover"` here (not host-configurable through `opts`) and the
 * canvas CSS-tracks the container's size natively (`stylePlayerCanvas` sets
 * width/height:100%) — a `ResizeObserver` still re-asserts the cover CSS
 * defensively, but never re-renders or resizes the backing buffer, so it can
 * never wake a paused rAF loop.
 */
export function mount(
	container: HTMLElement | null | undefined,
	payload: WebglPlayerPayload,
	opts: EmbeddableMotionMountOptions = {},
): EmbeddableMotionMountHandle {
	if (!container) {
		throw new Error("WebGL player mount requires a container.");
	}
	const options = opts ?? {};
	const reducedMotion = options.reducedMotion === true;
	const wantsAutoplay = options.autoplay !== false;
	const loop = options.loop !== false;
	const densityCenter = {
		x: clamp(numberOr(options.densityCenter?.x, 0.5), 0, 1),
		y: clamp(numberOr(options.densityCenter?.y, 0.5), 0, 1),
	};

	let player: WebglPlayer | null = null;
	let destroyed = false;
	let cancelled = false;
	let pendingSeek: number | null = null;
	let intent: "playing" | "paused" =
		!reducedMotion && wantsAutoplay ? "playing" : "paused";
	// See the identical rationale in the SVG runtime's mount() (code.ts):
	// starts suspended whenever IntersectionObserver exists so autoplay never
	// spins the rAF loop before the observer's own first (always-fires-on-
	// observe) callback confirms real visibility.
	let suspendedByVisibility = typeof IntersectionObserver !== "undefined";
	let visibilityObserver: IntersectionObserver | null = null;
	let resizeObserver: ResizeObserver | null = null;

	const disconnectObservers = (): void => {
		if (visibilityObserver) {
			visibilityObserver.disconnect();
			visibilityObserver = null;
		}
		if (resizeObserver) {
			resizeObserver.disconnect();
			resizeObserver = null;
		}
	};

	const applyDensityPosition = (): void => {
		const canvas = container.querySelector("canvas");
		if (!canvas) return;
		canvas.style.objectPosition = `${densityCenter.x * 100}% ${densityCenter.y * 100}%`;
	};

	const installResizeTracking = (): void => {
		applyDensityPosition();
		if (typeof ResizeObserver === "undefined") return;
		resizeObserver = new ResizeObserver(() => {
			applyDensityPosition();
		});
		resizeObserver.observe(container);
	};

	const applyIntent = (): void => {
		if (!player || destroyed || reducedMotion) return;
		if (intent === "playing" && !suspendedByVisibility) player.play();
		else player.pause();
	};

	const installVisibilityGate = (): void => {
		if (typeof IntersectionObserver === "undefined") return;
		visibilityObserver = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!player || destroyed) continue;
					if (entry.isIntersecting) {
						if (suspendedByVisibility) {
							suspendedByVisibility = false;
							applyIntent();
						}
					} else if (!suspendedByVisibility) {
						suspendedByVisibility = true;
						player.pause();
					}
				}
			},
			{ threshold: 0 },
		);
		visibilityObserver.observe(container);
	};

	const ready: Promise<void> = (async () => {
		const replacements = resolvePaletteReplacements(
			payload.paletteManifest,
			options.palette,
		);
		const resolvedPayload =
			replacements.size > 0
				? applyPaletteReplacements(payload, replacements)
				: payload;
		const nextPlayer = await createVectorMotionWebglPlayer(
			container,
			resolvedPayload,
			{
				autoplay: false,
				loop,
				dpr: options.dpr,
				fit: "cover",
			},
		);
		if (cancelled) {
			nextPlayer.destroy();
			throw new Error(
				"WebGL player mount was destroyed before it became ready.",
			);
		}
		player = nextPlayer;
		if (pendingSeek !== null) {
			const target = pendingSeek;
			pendingSeek = null;
			await player.seekProgress(target);
		} else if (reducedMotion) {
			await player.seekProgress(1);
		}
		// Cover-layout tracking is orthogonal to reducedMotion/play state — a
		// frozen final-frame hero still needs to fill and crop to its container.
		installResizeTracking();
		if (!reducedMotion) {
			installVisibilityGate();
			applyIntent();
		}
	})();
	ready.catch(() => {});

	return {
		play() {
			if (destroyed || reducedMotion) return;
			intent = "playing";
			applyIntent();
		},
		pause() {
			if (destroyed) return;
			intent = "paused";
			if (player) player.pause();
		},
		seek(progress: number) {
			if (destroyed) return;
			const clamped = clamp(numberOr(progress, 0), 0, 1);
			if (player) {
				pendingSeek = null;
				void player.seekProgress(clamped);
			} else {
				pendingSeek = clamped;
			}
		},
		destroy() {
			if (destroyed) return;
			destroyed = true;
			cancelled = true;
			disconnectObservers();
			if (player) {
				player.destroy();
				player = null;
			}
		},
		ready,
	};
}
