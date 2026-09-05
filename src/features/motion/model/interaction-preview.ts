import { create } from "zustand";
import {
	createInteractionEngine,
	type InteractionEngine,
	type InteractionEngineEvent,
	type InteractionEngineOutputEvent,
} from "@/entities/motion/model/interaction-engine";
import { useMotionStore } from "@/entities/motion/model/store";
import type {
	AnimationClip,
	MotionDocument,
} from "@/entities/motion/model/types";
import { currentMotionGrammarTargetNodeIds } from "@/entities/motion-grammar/model/store";
import { hasSubtreeCarrier } from "@/entities/scene/model/appearance-targets";
import {
	buildComponentPropsExport,
	type ComponentPropApplierInstruction,
} from "@/entities/scene/model/component-props-runtime";
import { readInteractions } from "@/entities/scene/model/interactions";
import {
	matrixFromTransform,
	matrixToSvg,
} from "@/entities/scene/model/rendering";
import { findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	InteractionDefinition,
	SceneDocument,
	Transform,
	VectorNode,
} from "@/entities/scene/model/types";
import {
	SVG_RENDER_PARTS,
	svgNodeSelector,
	svgRenderPartSelector,
} from "@/shared/lib/svg-render-parts";
import { useTransportStore } from "./transport-store";

/**
 * Editor "Preview interactions" session (Interactive Motion program, T3-S4:
 * editor preview — the final slice, wiring the SAME pure engine every
 * exported runtime uses into the canvas so an author can click/hover the
 * artwork and watch triggers fire without a real export or any document
 * mutation). This module owns the pure session-management around
 * `createInteractionEngine` — building/rebuilding it from the live
 * scene+motion documents, and resolving its `"set-prop"` output events into
 * DOM-applicable instructions via `compileBinding` (the SAME resolution
 * `buildComponentPropsExport` uses, so a `set-prop` action previews IDENTICALLY
 * to how it behaves in an exported runtime). The rAF tick loop and DOM pose
 * application live in `features/motion/canvas/overlay.tsx`
 * (`InteractionPreviewDriver`), mirroring where the ordinary playback rAF loop
 * lives — this file stays free of `requestAnimationFrame`/DOM so the session
 * lifecycle (build, rebuild-on-change, dispatch) is unit-testable in
 * isolation.
 */

/** One resolved effect of a `set-prop` interaction action: either a cheap, directly DOM-applicable transform/opacity patch, or a kind this preview slice does not apply live (reported so the host can degrade honestly instead of silently doing nothing). */
export type SetPropPreviewEffect =
	| {
			readonly kind: "transform-field";
			readonly nodeId: string;
			/** One leaf field under `Transform` — see {@link TRANSFORM_FIELD_PATHS}. */
			readonly fieldPath: readonly string[];
			readonly value: number;
	  }
	| {
			readonly kind: "opacity";
			readonly nodeId: string;
			readonly value: number;
	  }
	| {
			/**
			 * A resolved instruction this preview slice does not apply live: paint
			 * (`style-color-legacy`/`style-color-paint`) and `text-content`
			 * instructions need a render-tree DOM write this slice's transform/
			 * opacity-only applier does not perform (see this module's top JSDoc);
			 * a `scene-field` instruction outside the transform/opacity leaf set
			 * (e.g. `geometry.cornerRadius`) is likewise not wired. The host
			 * (`InteractionPreviewDriver`) reports this once per session via
			 * `console.info` rather than silently doing nothing.
			 */
			readonly kind: "unsupported";
			readonly nodeId: string;
			readonly propName: string;
			readonly reason:
				| "paint-binding"
				| "text-content-binding"
				| "unsupported-scene-field"
				| "prop-not-found"
				| "no-instructions";
	  };

/**
 * The exact `Transform` leaf field paths this preview slice can patch
 * directly (mirrors the `NATIVE_SCALAR_SUPPORT` bindable-property registry
 * entries in `bindable-property.ts`, minus `style.opacity`, which is handled
 * as its own `"opacity"` effect kind since it lives on `NodeStyle`, not
 * `Transform`).
 */
const TRANSFORM_FIELD_PATHS: readonly (readonly string[])[] = [
	["transform", "position", "x"],
	["transform", "position", "y"],
	["transform", "anchor", "x"],
	["transform", "anchor", "y"],
	["transform", "rotation"],
	["transform", "scale", "x"],
	["transform", "scale", "y"],
];

const fieldPathMatches = (
	fieldPath: readonly string[],
	candidate: readonly string[],
): boolean =>
	fieldPath.length === candidate.length &&
	fieldPath.every((segment, index) => segment === candidate[index]);

/**
 * Resolves one compiled `scene-field` instruction to the cheap transform/
 * opacity effect it patches, or `null` when the field path is outside the
 * directly-writable set (e.g. `geometry.cornerRadius`) — the caller turns
 * `null` into an `"unsupported-scene-field"` effect.
 */
const sceneFieldEffect = (
	instruction: Extract<
		ComponentPropApplierInstruction,
		{ readonly kind: "scene-field" }
	>,
	value: number,
): SetPropPreviewEffect | null => {
	if (fieldPathMatches(instruction.fieldPath, ["style", "opacity"])) {
		return { kind: "opacity", nodeId: instruction.nodeId, value };
	}
	const transformPath = TRANSFORM_FIELD_PATHS.find((candidate) =>
		fieldPathMatches(instruction.fieldPath, candidate),
	);
	if (!transformPath) return null;
	return {
		kind: "transform-field",
		nodeId: instruction.nodeId,
		fieldPath: transformPath,
		value,
	};
};

/**
 * Resolves one engine `"set-prop"` output event into a preview effect,
 * reusing `buildComponentPropsExport`, including its prop-level atomicity and
 * ownership checks. If export compilation rejects any peer, preview applies
 * none. Preview also fails the whole prop closed when one compiled instruction
 * needs a DOM write this transform/opacity-only adapter cannot perform.
 */
export function resolveSetPropPreviewEffects(
	document: SceneDocument,
	motion: MotionDocument,
	propName: string,
	value: number | string,
	grammarTargetNodeIds: ReadonlySet<string> = new Set(
		motion.grammar?.bindings.flatMap((binding) => binding.targetIds) ?? [],
	),
): readonly SetPropPreviewEffect[] {
	const compiled = buildComponentPropsExport(document, motion, {
		...document,
		grammarTargetNodeIds,
	});
	const schema = compiled.schema.find((entry) => entry.name === propName);
	if (!schema) {
		return [
			{
				kind: "unsupported",
				nodeId: "",
				propName,
				reason: "prop-not-found",
			},
		];
	}
	const instructions = compiled.appliers.find(
		(entry) => entry.name === propName,
	)?.instructions;
	if (
		schema.supported === false ||
		!instructions ||
		instructions.length === 0
	) {
		return [
			{ kind: "unsupported", nodeId: "", propName, reason: "no-instructions" },
		];
	}
	const effects = instructions.map((result): SetPropPreviewEffect => {
		if (
			result.kind === "style-color-legacy" ||
			result.kind === "style-color-paint"
		) {
			return {
				kind: "unsupported",
				nodeId: result.nodeId,
				propName,
				reason: "paint-binding",
			};
		}
		if (result.kind === "text-content") {
			return {
				kind: "unsupported",
				nodeId: result.nodeId,
				propName,
				reason: "text-content-binding",
			};
		}
		if (typeof value !== "number") {
			return {
				kind: "unsupported",
				nodeId: result.nodeId,
				propName,
				reason: "unsupported-scene-field",
			};
		}
		return (
			sceneFieldEffect(result, value) ?? {
				kind: "unsupported",
				nodeId: result.nodeId,
				propName,
				reason: "unsupported-scene-field",
			}
		);
	});
	const unsupported = effects.filter(
		(
			effect,
		): effect is Extract<SetPropPreviewEffect, { kind: "unsupported" }> =>
			effect.kind === "unsupported",
	);
	return unsupported.length > 0 ? unsupported : effects;
}

/**
 * Applies one `"transform-field"` effect's `fieldPath`/`value` onto a plain
 * `Transform`, returning a patched copy. Pure — the caller
 * (`InteractionPreviewDriver`) recomputes the SVG matrix from the result and
 * writes it to the DOM. `fieldPath` is always one of
 * {@link TRANSFORM_FIELD_PATHS} (the only paths `sceneFieldEffect` ever
 * produces), so every branch here is exhaustive over that fixed set; an
 * unrecognized path is a no-op (defensive — should be unreachable given the
 * effect's own construction).
 */
export function applyTransformFieldEffect(
	transform: Transform,
	fieldPath: readonly string[],
	value: number,
): Transform {
	if (fieldPathMatches(fieldPath, ["transform", "position", "x"])) {
		return { ...transform, position: { ...transform.position, x: value } };
	}
	if (fieldPathMatches(fieldPath, ["transform", "position", "y"])) {
		return { ...transform, position: { ...transform.position, y: value } };
	}
	if (fieldPathMatches(fieldPath, ["transform", "anchor", "x"])) {
		return { ...transform, anchor: { ...transform.anchor, x: value } };
	}
	if (fieldPathMatches(fieldPath, ["transform", "anchor", "y"])) {
		return { ...transform, anchor: { ...transform.anchor, y: value } };
	}
	if (fieldPathMatches(fieldPath, ["transform", "rotation"])) {
		return { ...transform, rotation: value };
	}
	if (fieldPathMatches(fieldPath, ["transform", "scale", "x"])) {
		return { ...transform, scale: { ...transform.scale, x: value } };
	}
	if (fieldPathMatches(fieldPath, ["transform", "scale", "y"])) {
		return { ...transform, scale: { ...transform.scale, y: value } };
	}
	return transform;
}

/** One interactions-relevant slice of the live scene + motion documents, re-read on every rebuild trigger. */
export type InteractionPreviewSource = {
	readonly interactions: readonly InteractionDefinition[];
	readonly clips: readonly AnimationClip[];
	readonly fps: number;
	readonly durationFrames: number;
};

/** Reads the current interaction-preview engine inputs directly from the live scene/motion stores (not React state), so a session can be (re)built imperatively from an rAF effect without a render dependency. */
export function readInteractionPreviewSource(): InteractionPreviewSource {
	const scene = useSceneStore.getState().document;
	const motion = useMotionStore.getState().document;
	return {
		interactions: readInteractions(scene),
		clips: motion.clips,
		fps: motion.fps,
		durationFrames: motion.durationFrames,
	};
}

/** A cheap signature of {@link InteractionPreviewSource}, comparable with `===`, so a caller can bail out of rebuilding the engine when nothing interactions-relevant changed. NOT a content hash of every interaction — an interaction/clip LIST identity change (add/remove/edit through the command bus always replaces the array) is enough, since `readInteractions`/`motion.clips` are themselves already-normalized arrays the scene/motion stores replace wholesale on every mutation. */
export function interactionPreviewSourceSignature(
	source: InteractionPreviewSource,
): string {
	return JSON.stringify([
		source.interactions,
		source.clips,
		source.fps,
		source.durationFrames,
	]);
}

/**
 * Builds a fresh `InteractionEngine` from the current live scene/motion
 * documents. Interaction preview always starts a session at frame 0
 * (mirroring `createInteractionEngine`'s own construction default) — the
 * caller (`InteractionPreviewDriver`) seeks it to the transport's current
 * frame immediately after construction so entering preview does not jump the
 * playhead.
 */
export function buildInteractionPreviewEngine(
	source: InteractionPreviewSource,
): InteractionEngine {
	return createInteractionEngine({
		interactions: source.interactions,
		clips: source.clips,
		fps: source.fps,
		durationFrames: source.durationFrames,
		// Whole-timeline end-of-playback loops by default, matching ordinary
		// transport playback's `loop` default — interaction preview does not
		// expose its own loop toggle (T3-S4 scope: click/hover/in-view triggers
		// and clip playback, not a second transport UI).
		loop: true,
	});
}

/** One `dispatchPreviewEvent` call's result: the engine's frame right after processing the event (for an immediate visual update on click, not just next tick) plus every output event it produced. */
export type DispatchPreviewEventResult = {
	readonly frame: number;
	readonly events: readonly InteractionEngineOutputEvent[];
};

/**
 * Feeds one semantic pointer/lifecycle event into the engine and returns its
 * immediate output. Exists as a thin, named wrapper (rather than callers using
 * `engine.handleEvent` directly) so the canvas wiring and any future preview
 * entry point share one typed seam and this module's JSDoc is the single
 * source of truth for what "dispatching a preview event" means.
 */
export function dispatchPreviewEvent(
	engine: InteractionEngine,
	event: InteractionEngineEvent,
): DispatchPreviewEventResult {
	const events = engine.handleEvent(event);
	return { frame: engine.frame, events };
}

/** Restores the transport playhead to `frame` and clears `useTransportStore`'s playing flag — the shared "leave preview" cleanup both an explicit toggle-off and an Esc-exit run. Does not touch `interactionPreview` itself; the caller flips that separately (see `useTransportStore`'s `setInteractionPreview`). */
export function restoreTransportAfterPreview(frame: number): void {
	const transport = useTransportStore.getState();
	transport.pause();
	transport.setFrame(frame);
}

/**
 * Cross-component seam for the ONE live interaction-preview engine instance:
 * `InteractionPreviewDriver` (mounted once, headless, in the canvas overlay
 * registry) owns the engine's lifecycle (build/rebuild/teardown) and writes
 * it here; the canvas pointer wiring in `CanvasShell.tsx` (a different
 * component, several levels away) reads it here to dispatch click/hover
 * events — a plain Zustand store rather than prop drilling or a hand-rolled
 * subscription, matching how `useLiveTransformStore`/`useTransportStore`
 * already share imperative, gesture/session-scoped state across components
 * in this codebase. `null` whenever preview is off or between rebuilds.
 */
export const useInteractionPreviewEngineStore = create<{
	readonly engine: InteractionEngine | null;
	readonly setEngine: (engine: InteractionEngine | null) => void;
}>()((set) => ({
	engine: null,
	setEngine: (engine) => set({ engine }),
}));

const INTERACTION_PREVIEW_UNSUPPORTED_NOTICE_LIMIT = 5;

/**
 * One-time-per-session degrade notice for a `set-prop` interaction action this
 * preview slice cannot apply live (the `"unsupported"` `SetPropPreviewEffect`
 * variant). Deduplicated per `(propName, reason)` pair and capped so a rapid
 * click/hover storm against an unsupported binding cannot flood the console —
 * a dedicated toast system is disproportionate infrastructure for this
 * slice's degrade path (see `SetPropPreviewEffect`'s JSDoc for the full
 * rationale), so `console.info` is the intentionally small surface.
 */
const reportedUnsupportedSetProps = new Set<string>();
let unsupportedSetPropNoticeCount = 0;

const reportUnsupportedSetProp = (effect: {
	readonly propName: string;
	readonly reason: string;
}): void => {
	const key = `${effect.propName}:${effect.reason}`;
	if (reportedUnsupportedSetProps.has(key)) return;
	if (
		unsupportedSetPropNoticeCount >=
		INTERACTION_PREVIEW_UNSUPPORTED_NOTICE_LIMIT
	)
		return;
	reportedUnsupportedSetProps.add(key);
	unsupportedSetPropNoticeCount += 1;
	// Intentional, capped, deduplicated editor-only degrade notice — see this
	// function's JSDoc.
	console.info(
		`[Preview interactions] "${effect.propName}" set-prop action (${effect.reason}) is not previewed live in the editor; it applies correctly in an exported runtime.`,
	);
};

/** Resets the degrade-notice dedup/cap state. Exposed only for the smoke/unit-test entry point — production code never needs to reset it mid-session. */
export function resetInteractionPreviewUnsupportedNoticeState(): void {
	reportedUnsupportedSetProps.clear();
	unsupportedSetPropNoticeCount = 0;
}

const findGroup = (root: Element, nodeId: string): SVGGElement | null =>
	root.querySelector<SVGGElement>(svgNodeSelector(nodeId));

const findPaintTarget = (group: Element): SVGElement | null =>
	group.querySelector<SVGElement>(
		svgRenderPartSelector(SVG_RENDER_PARTS.paint),
	);

const findSubtreeCarrier = (group: Element): SVGElement | null =>
	group.querySelector<SVGElement>(
		svgRenderPartSelector(SVG_RENDER_PARTS.subtree),
	);

/** Mirrors `features/motion/canvas/overlay.tsx`'s own `findOpacityTarget` (kept as a separate small copy rather than an export from that file, since this module must stay DOM-adapter-agnostic in its exported API — only this one internal writer needs it). */
const findOpacityTarget = (
	group: Element,
	node: VectorNode,
): SVGElement | null =>
	hasSubtreeCarrier(node) ? findSubtreeCarrier(group) : findPaintTarget(group);

/**
 * Writes one live-applicable `SetPropPreviewEffect` (`"transform-field"`/
 * `"opacity"`) directly to the DOM under `root` (the canvas's `.canvas-shell`
 * element), mirroring `applyNodePose`'s own transform/opacity writers in
 * `overlay.tsx` but patching a single named field to a FIXED value instead of
 * a keyframe-sampled one. `"unsupported"` effects are reported once via
 * {@link reportUnsupportedSetProp} instead of applied.
 */
function applySetPropPreviewEffect(
	root: Element,
	scene: SceneDocument,
	effect: SetPropPreviewEffect,
): void {
	if (effect.kind === "unsupported") {
		reportUnsupportedSetProp(effect);
		return;
	}
	const node = findNode(scene, effect.nodeId);
	const group = findGroup(root, effect.nodeId);
	if (!node || !group) return;
	if (effect.kind === "transform-field") {
		const transform = applyTransformFieldEffect(
			node.transform,
			effect.fieldPath,
			effect.value,
		);
		group.setAttribute(
			"transform",
			matrixToSvg(matrixFromTransform(transform)),
		);
		return;
	}
	const opacityTarget = findOpacityTarget(group, node);
	if (opacityTarget)
		opacityTarget.setAttribute("opacity", String(effect.value));
}

/**
 * Applies every `"set-prop"` output event from one `handleEvent`/`tick` call
 * as a transient DOM write, resolving each via `resolveSetPropPreviewEffects`
 * (the SAME binding resolution `buildComponentPropsExport` uses for every
 * exported runtime). No scene/motion document mutation occurs — every write
 * lands on the live SVG DOM under `root` only, exactly like ordinary playback
 * pose application.
 */
export function applySetPropOutputEvents(
	root: Element,
	events: readonly InteractionEngineOutputEvent[],
): void {
	const setPropEvents = events.filter(
		(
			event,
		): event is Extract<InteractionEngineOutputEvent, { kind: "set-prop" }> =>
			event.kind === "set-prop",
	);
	if (setPropEvents.length === 0) return;
	const scene = useSceneStore.getState().document;
	const motion = useMotionStore.getState().document;
	for (const event of setPropEvents) {
		for (const effect of resolveSetPropPreviewEffects(
			scene,
			motion,
			event.propName,
			event.value,
			currentMotionGrammarTargetNodeIds(),
		)) {
			applySetPropPreviewEffect(root, scene, effect);
		}
	}
}

/**
 * Dispatches one semantic event into the currently active preview engine, if
 * any, and applies any resulting `"set-prop"` effects to `root`'s DOM. A
 * no-op (returns `null`) when preview is off/the engine has not been built
 * yet (e.g. a pointer event lands on the SAME rAF tick the driver's effect
 * has not run its `start()` on yet) — the canvas pointer wiring treats a
 * `null` result as "nothing to do" rather than an error, since a stray event
 * during that narrow startup window has no session to affect anyway.
 */
export function dispatchActiveInteractionPreviewEvent(
	event: InteractionEngineEvent,
	root: Element,
): DispatchPreviewEventResult | null {
	const engine = useInteractionPreviewEngineStore.getState().engine;
	if (!engine) return null;
	const result = dispatchPreviewEvent(engine, event);
	applySetPropOutputEvents(root, result.events);
	return result;
}
