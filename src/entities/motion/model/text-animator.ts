import type { NativeExpressionFrameContext } from "@/entities/scene/model/native-expression-binding";
import {
	fragmentCenter,
	resolveLiveTextFragments,
	type TextLineMeasurer,
	type TextMotionFragment,
	type TextMotionTarget,
} from "@/entities/scene/model/text-fragments";
import type { Vec2, VectorNode } from "@/entities/scene/model/types";
import {
	type ExprEvalIssue,
	type ExprVarName,
	evaluateExprResult,
} from "@/shared/expr-dsl";
import { sampleKeyframeTrack } from "@/shared/glammer/keyframe-track";
import { combine, selectorValueCore } from "@/shared/sequencer/range-selector";
import type {
	MotionDocument,
	RangeTextSelector,
	TextAnimatorBinding,
	TextAnimatorOffsetKeyAddress,
	TextAnimatorProperties,
	TextAnimatorTarget,
} from "./types";

/**
 * Source-agnostic Range Selector evaluator. It maps one ordered fragment set
 * (live text today, outline groups later — both arrive as a {@link TextMotionTarget})
 * to a per-fragment pose. Nothing here knows how a fragment is rendered; the pose
 * carries the fragment `source` so the renderer realizes it (split `<text>` vs real
 * node) without a second evaluator. Units are frames, matching the keyframe sampler.
 */

const PERCENT = 100;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const lerp = (from: number, to: number, t: number): number =>
	from + (to - from) * t;

/** Pose applied to one fragment at a frame. Identity (influence 0) leaves it at rest. */
export type TextFragmentPose = {
	readonly fragmentId: string;
	readonly orderIndex: number;
	readonly influence: number;
	readonly translate: Vec2;
	readonly rotation: number;
	readonly scaleX: number;
	readonly scaleY: number;
	readonly opacity: number;
	readonly pivot: Vec2;
	readonly source: TextMotionFragment["source"];
};

/** All fragment poses for one binding at one frame, plus the addressing it needs. */
export type TextAnimatorEvaluation = {
	readonly bindingId: string;
	readonly nodeId: string;
	readonly unit: TextAnimatorBinding["unit"];
	readonly selectableCount: number;
	readonly poses: readonly TextFragmentPose[];
};

/**
 * Samples the authoritative Offset curve used by Text Animator presentation.
 *
 * This is the BASE offset: keyframes when present, the static `offset`
 * otherwise. It deliberately does not consider `offsetExpression`, so the
 * timeline graph keeps editing and displaying the curve the author owns.
 */
export const textAnimatorOffsetAtFrame = (
	selector: RangeTextSelector,
	frame: number,
): number => {
	const keyframes = selector.offsetKeyframes?.filter(
		(keyframe) =>
			Number.isFinite(keyframe.time) && Number.isFinite(keyframe.value),
	);
	if (!keyframes || keyframes.length === 0) return selector.offset;
	return sampleKeyframeTrack(keyframes, frame);
};

/**
 * Variables a selector Offset expression may read. `value` is the sampled base
 * offset; per-instance fan-out has no meaning here because the selector is
 * evaluated once per fragment position, not per duplicate.
 */
export const TEXT_SELECTOR_OFFSET_EXPR_VARS = [
	"time",
	"frame",
	"value",
] as const satisfies readonly ExprVarName[];

/**
 * Per-frame context that lets a selector's `offsetExpression` be evaluated. It
 * is the same record Codeable Native receives, so a `control("id")` reference
 * resolves through the injected sampler and nothing here learns what a linked
 * production is. Omitting it means "no expression evaluation at this surface":
 * the base offset survives, which is the same fail-safe an unresolved reference
 * takes — never a fabricated `0`.
 */
export type TextAnimatorFrameContext = NativeExpressionFrameContext;

/**
 * Effective offset with diagnostics: the sampled base, then the optional
 * expression composed over it with the base arriving as `value`. Composition
 * (not replacement) is what lets one published control shift an authored reveal
 * instead of erasing it. A failed or non-finite result returns the base and the
 * issue explaining why the offset did not move.
 */
export const textAnimatorEffectiveOffsetDetailed = (
	selector: RangeTextSelector,
	frame: number,
	context?: TextAnimatorFrameContext,
): { readonly value: number; readonly issue?: ExprEvalIssue } => {
	const base = textAnimatorOffsetAtFrame(selector, frame);
	const expression = selector.offsetExpression;
	if (!expression || !context) return { value: base };
	// No AST re-validation here, matching `evaluateNativeExpression`: the walker is
	// total over the closed node union, bounded by its own step budget, and always
	// returns a finite number, so a corrupted tree degrades rather than escaping.
	// Structural re-admission belongs at the deserialization boundary for ALL
	// expression side-cars at once, not per frame inside the exported runtime.
	const result = evaluateExprResult(expression.ast, {
		time: context.time,
		frame: context.frame,
		value: base,
		i: 0,
		count: 1,
		seed: 0,
		...(context.controls ? { controls: context.controls } : {}),
	});
	if (!result.ok) return { value: base, issue: result.issue };
	return Number.isFinite(result.value)
		? { value: result.value }
		: { value: base };
};

/** Plain form used by per-frame sampling; issues are for authoring surfaces. */
export const textAnimatorEffectiveOffset = (
	selector: RangeTextSelector,
	frame: number,
	context?: TextAnimatorFrameContext,
): number =>
	textAnimatorEffectiveOffsetDetailed(selector, frame, context).value;

/**
 * Raw 0..1 selection of one fragment by one selector (before the combine mode).
 * The effective offset is passed in rather than sampled here: it does not depend
 * on the fragment, so it is resolved once per frame instead of once per glyph.
 */
const selectorValue = (
	selector: RangeTextSelector,
	position: number,
	selectableCount: number,
	offset: number,
): number => selectorValueCore(selector, position, selectableCount, offset);

/**
 * Resolves an exact selector key from immutable Motion truth. Missing bindings,
 * invalid selector indices, and moved/deleted keys return `null`; callers must
 * never substitute another selector or nearest frame.
 */
export function resolveTextAnimatorOffsetKey(
	motion: MotionDocument,
	address: TextAnimatorOffsetKeyAddress,
): {
	readonly binding: TextAnimatorBinding;
	readonly selector: RangeTextSelector;
	readonly keyframe: NonNullable<RangeTextSelector["offsetKeyframes"]>[number];
	readonly keyIndex: number;
} | null {
	if (!Number.isInteger(address.selectorIndex) || address.selectorIndex < 0) {
		return null;
	}
	const binding = motion.textAnimators?.find(
		(candidate) => candidate.id === address.bindingId,
	);
	const selector = binding?.selectors[address.selectorIndex];
	if (!binding || !selector) return null;
	const keyIndex =
		selector.offsetKeyframes?.findIndex(
			(keyframe) => keyframe.time === address.frame,
		) ?? -1;
	if (keyIndex < 0) return null;
	const keyframe = selector.offsetKeyframes?.[keyIndex];
	return keyframe ? { binding, selector, keyframe, keyIndex } : null;
}

/**
 * Combined 0..1 influence of all selectors on one fragment. Selectors fold against
 * a base of 0, so a single `add` selector returns its own value — the common case.
 */
const fragmentInfluence = (
	selectors: readonly RangeTextSelector[],
	offsets: readonly number[],
	position: number,
	selectableCount: number,
): number => {
	const combined = selectors.reduce(
		(accumulator, selector, selectorIndex) =>
			combine(
				selector.mode,
				accumulator,
				selectorValue(
					selector,
					position,
					selectableCount,
					offsets[selectorIndex] ?? selector.offset,
				),
			),
		0,
	);
	return clamp01(combined);
};

const restPose = (fragment: TextMotionFragment): TextFragmentPose => ({
	fragmentId: fragment.id,
	orderIndex: fragment.orderIndex,
	influence: 0,
	translate: { x: 0, y: 0 },
	rotation: 0,
	scaleX: 1,
	scaleY: 1,
	opacity: 1,
	pivot: fragmentCenter(fragment.bounds),
	source: fragment.source,
});

const posedFragment = (
	fragment: TextMotionFragment,
	properties: TextAnimatorBinding["properties"],
	influence: number,
): TextFragmentPose => ({
	fragmentId: fragment.id,
	orderIndex: fragment.orderIndex,
	influence,
	translate: {
		x: (properties.positionX ?? 0) * influence,
		y: (properties.positionY ?? 0) * influence,
	},
	rotation: (properties.rotation ?? 0) * influence,
	scaleX: lerp(1, properties.scaleX ?? 1, influence),
	scaleY: lerp(1, properties.scaleY ?? 1, influence),
	opacity:
		properties.opacity === undefined
			? 1
			: lerp(1, properties.opacity, influence),
	pivot: fragmentCenter(fragment.bounds),
	source: fragment.source,
});

/**
 * Evaluates one binding against its resolved fragment set at a frame. Non-selectable
 * fragments (e.g. spaces in `character-no-spaces`) always resolve to a rest pose so
 * the renderer can still place every glyph.
 */
export function evaluateTextAnimator(
	target: TextMotionTarget,
	binding: TextAnimatorBinding,
	frame: number,
	context?: TextAnimatorFrameContext,
): TextAnimatorEvaluation {
	const { selectableCount } = target;
	const offsets = binding.selectors.map((selector) =>
		textAnimatorEffectiveOffset(selector, frame, context),
	);
	const poses = target.fragments.map((fragment) => {
		if (!fragment.selectable || selectableCount === 0) {
			return restPose(fragment);
		}
		const position = (fragment.orderIndex + 0.5) / selectableCount;
		const influence = fragmentInfluence(
			binding.selectors,
			offsets,
			position,
			selectableCount,
		);
		if (influence === 0) return restPose(fragment);
		return posedFragment(fragment, binding.properties, influence);
	});
	return {
		bindingId: binding.id,
		nodeId: binding.target.nodeId,
		unit: binding.unit,
		selectableCount,
		poses,
	};
}

/** First enabled binding driving `nodeId`, or undefined. One group per node in v1. */
export function activeTextAnimator(
	motion: MotionDocument,
	nodeId: string,
): TextAnimatorBinding | undefined {
	return motion.textAnimators?.find(
		(binding) => binding.enabled && binding.target.nodeId === nodeId,
	);
}

/** True when at least one enabled binding targets `nodeId`. */
export function hasTextAnimator(
	motion: MotionDocument,
	nodeId: string,
): boolean {
	return activeTextAnimator(motion, nodeId) !== undefined;
}

/**
 * Resolved fragments paired with their poses (same order, same length). The
 * renderer reads `fragments[i]` for the glyph text/anchor and `evaluation.poses[i]`
 * for the transform/opacity — keeping the pose itself source-agnostic.
 */
export type TextAnimatorRender = {
	readonly evaluation: TextAnimatorEvaluation;
	readonly fragments: readonly TextMotionFragment[];
};

/**
 * Render bridge: resolves the active binding for a node into fragments + poses, or
 * `null` when the node has no live-text animator. This is the single entry both the
 * editor canvas and the SVG exporter call in their text case, so fragment math is
 * never duplicated. `measurer` lets browser surfaces inject real text measurement;
 * export/Worker paths omit it and get the deterministic estimate.
 */
export function resolveTextAnimatorRender(
	node: VectorNode,
	motion: MotionDocument,
	frame: number,
	measurer?: TextLineMeasurer,
	context?: TextAnimatorFrameContext,
): TextAnimatorRender | null {
	const binding = activeTextAnimator(motion, node.id);
	if (!binding) return null;
	// Outline-group targets pose real sub-nodes and are resolved elsewhere; the
	// glyph-splitting text renderer only handles live text.
	if (binding.target.kind !== "live-text") return null;
	if (node.geometry.kind !== "text") return null;
	const target = resolveLiveTextFragments(
		node.id,
		node.geometry,
		binding.unit,
		{
			measurer,
		},
	);
	return {
		evaluation: evaluateTextAnimator(target, binding, frame, context),
		fragments: target.fragments,
	};
}

// --- Presets ------------------------------------------------------------------

const BEZIER = 6613;

/**
 * Shared options for every preset factory. `target` selects the realization: live
 * text splits `<text>`; an outline group poses real child nodes (imported outlines).
 * The preset's reveal otherwise behaves identically because the evaluator is shared.
 */
export type TextAnimatorPresetOptions = {
	readonly nodeId: string;
	readonly target?: TextAnimatorTarget["kind"];
	readonly durationFrames?: number;
};

/**
 * The keyframed reveal selector every preset shares: a `rampPercent`-wide smooth
 * window whose `offset` sweeps from before the first fragment to past the last, so
 * each fragment transitions once, in order. `offset` is the only animated value.
 */
const revealSelector = (
	durationFrames: number,
	rampPercent: number,
): RangeTextSelector => ({
	kind: "range",
	mode: "add",
	units: "percent",
	start: -rampPercent,
	end: 0,
	offset: 0,
	offsetKeyframes: [
		{
			time: 0,
			value: 0,
			outInterpolationType: BEZIER,
			inInterpolationType: BEZIER,
		},
		{
			time: durationFrames,
			value: PERCENT + rampPercent,
			outInterpolationType: BEZIER,
			inInterpolationType: BEZIER,
		},
	],
	amount: PERCENT,
	shape: "smooth",
});

const presetBinding = (
	name: string,
	options: TextAnimatorPresetOptions,
	unit: TextAnimatorBinding["unit"],
	properties: TextAnimatorProperties,
	rampPercent: number,
	defaultDuration: number,
): TextAnimatorBinding => ({
	id: `text-anim-${options.nodeId}`,
	name,
	enabled: true,
	target: { kind: options.target ?? "live-text", nodeId: options.nodeId },
	unit,
	properties,
	selectors: [
		revealSelector(options.durationFrames ?? defaultDuration, rampPercent),
	],
});

/**
 * "Word Rise": the default SaaS-launch reveal. Words start below their rest line and
 * transparent, then rise and fade in left-to-right as the selector window sweeps
 * across them. The production starting point.
 */
export function createWordRiseBinding(
	options: TextAnimatorPresetOptions,
): TextAnimatorBinding {
	return presetBinding(
		"Word Rise",
		options,
		"word",
		{ positionY: 52, opacity: 0 },
		22,
		30,
	);
}

/**
 * "Character Cascade": per-character reveal — each glyph scales up from small and
 * rises into place as the window sweeps, giving a tighter, more kinetic cadence than
 * Word Rise. Scale orbits each glyph's center (correct for live text and translation-
 * rest imports).
 */
export function createCharacterCascadeBinding(
	options: TextAnimatorPresetOptions,
): TextAnimatorBinding {
	return presetBinding(
		"Character Cascade",
		options,
		"character",
		{ positionY: 28, scaleX: 0.4, scaleY: 0.4, opacity: 0 },
		14,
		36,
	);
}

/**
 * "Line Fade": per-line reveal — each line fades and lifts slightly into place, for
 * multiline captions/subheads. A wider ramp suits the smaller line count.
 */
export function createLineFadeBinding(
	options: TextAnimatorPresetOptions,
): TextAnimatorBinding {
	return presetBinding(
		"Line Fade",
		options,
		"line",
		{ positionY: 18, opacity: 0 },
		45,
		28,
	);
}

/** Stable preset ids for code/agent/MCP authoring (UI uses the factories directly). */
export const TEXT_ANIMATOR_PRESET_IDS = [
	"word-rise",
	"character-cascade",
	"line-fade",
] as const;

export type TextAnimatorPresetId = (typeof TEXT_ANIMATOR_PRESET_IDS)[number];

/**
 * Builds a binding for a preset id — the single dispatch the agent/MCP write path
 * and code authoring call (the editor UI calls the factories directly). Exhaustive
 * over {@link TextAnimatorPresetId} so a new preset is a compile error here.
 */
export function createTextAnimatorPreset(
	preset: TextAnimatorPresetId,
	options: TextAnimatorPresetOptions,
): TextAnimatorBinding {
	switch (preset) {
		case "word-rise":
			return createWordRiseBinding(options);
		case "character-cascade":
			return createCharacterCascadeBinding(options);
		case "line-fade":
			return createLineFadeBinding(options);
	}
}
