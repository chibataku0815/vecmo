/**
 * Code-registered motion-expression definitions. Kept separate from the type
 * module so concrete definitions (e.g. `glammer-cycle-v1.ts`) import the frozen
 * types one-way while this registry imports the concrete definitions — no cycle.
 * Mirrors the technique-module registry shape (`technique-module.ts`).
 *
 * The registry is empty until the Cycle pilot (P3) registers the first built-in.
 */

import { COLLISION_BOUNCE_V1 } from "./collision-bounce-v1";
import { COUNT_GROWTH_V1 } from "./count-growth-v1";
import {
	MOTION_EXPRESSION_VERSION_PARAM_KEY,
	type MotionExpressionDefinition,
} from "./expression-definition";
import {
	FOLLOW_THROUGH_LEAD_ADAPTER_TECHNIQUE_ID,
	FOLLOW_THROUGH_LEAD_ADAPTER_VERSION,
} from "./follow-through-lead-binding";
import { FOLLOW_THROUGH_V1 } from "./follow-through-v1";
import { GLAMMER_CYCLE_V1 } from "./glammer-cycle-v1";
import { INTERFERENCE_RING_V1 } from "./interference-ring-v1";
import { INVERSE_PROPORTION_V1 } from "./inverse-proportion-v1";
import { MERGE_SPLIT_V1 } from "./merge-split-v1";
import { PARALLAX_WAVE_V1 } from "./parallax-wave-v1";
import { RANDOM_PULSE_V1 } from "./random-pulse-v1";
import { STROKE_DRAW_ON_V1 } from "./stroke-draw-on-v1";
import { SYMMETRY_PULSE_V1 } from "./symmetry-pulse-v1";
import type { MotionGrammarBinding, MotionGrammarTechniqueId } from "./types";

const MOTION_EXPRESSION_DEFINITIONS: readonly MotionExpressionDefinition[] = [
	GLAMMER_CYCLE_V1,
	STROKE_DRAW_ON_V1,
	COLLISION_BOUNCE_V1,
	RANDOM_PULSE_V1,
	COUNT_GROWTH_V1,
	SYMMETRY_PULSE_V1,
	FOLLOW_THROUGH_V1,
	INTERFERENCE_RING_V1,
	MERGE_SPLIT_V1,
	PARALLAX_WAVE_V1,
	INVERSE_PROPORTION_V1,
];

/** All built-in expression definitions available to authoring + sampling. */
export function registeredMotionExpressionDefinitions(): readonly MotionExpressionDefinition[] {
	return MOTION_EXPRESSION_DEFINITIONS;
}

/**
 * Binding state for a technique that has versioned definitions. A missing marker
 * is deliberately different from a malformed or unknown marker: only the former
 * selects the historical legacy evaluator.
 */
export type MotionExpressionBindingState = "active" | "legacy" | "unsupported";

const definitionsForTechnique = (
	expressionId: string,
): readonly MotionExpressionDefinition[] =>
	MOTION_EXPRESSION_DEFINITIONS.filter(
		(definition) => definition.expressionId === expressionId,
	);

const newestDefinition = (
	definitions: readonly MotionExpressionDefinition[],
): MotionExpressionDefinition | undefined =>
	definitions.reduce<MotionExpressionDefinition | undefined>(
		(current, definition) =>
			!current || definition.version > current.version ? definition : current,
		undefined,
	);

/**
 * Some versioned bindings need a durable external-data adapter rather than the
 * scene-only `MotionExpressionDefinition.sample` signature. They share marker
 * parsing/fail-closed semantics with generic expressions but are dispatched by
 * their owning sampler seam instead of this registry's generic expression path.
 */
const EXTERNAL_VERSIONED_BINDING_VERSIONS = [
	{
		expressionId: FOLLOW_THROUGH_LEAD_ADAPTER_TECHNIQUE_ID,
		version: FOLLOW_THROUGH_LEAD_ADAPTER_VERSION,
	},
] as const;

const versionedBindingVersionsForTechnique = (
	expressionId: string,
): readonly number[] => [
	...definitionsForTechnique(expressionId)
		.filter((definition) => definition.activation === "versioned")
		.map((definition) => definition.version),
	...EXTERNAL_VERSIONED_BINDING_VERSIONS.filter(
		(definition) => definition.expressionId === expressionId,
	).map((definition) => definition.version),
];

const hasOwn = (
	value: Readonly<Record<string, unknown>>,
	key: string,
): boolean => Object.hasOwn(value, key);

/**
 * Finds a built-in expression by technique and optional persisted version. With
 * no version it returns the newest registered definition, which is the one a
 * newly authored binding must receive. Existing bindings always resolve through
 * {@link findActiveVersionedMotionExpressionDefinition} instead.
 */
export function findMotionExpressionDefinition(
	expressionId: string,
	version?: number,
): MotionExpressionDefinition | undefined {
	const definitions = definitionsForTechnique(expressionId);
	return version === undefined
		? newestDefinition(definitions)
		: definitions.find((definition) => definition.version === version);
}

/**
 * Resolves whether stored parameters select an executable current expression,
 * the legacy evaluator, or an unsupported future/malformed version. This is the
 * fail-closed boundary for renderer, Bake, Agent, and Inspector consumers.
 */
export function motionExpressionBindingState(
	techniqueId: string,
	parameters: Readonly<Record<string, unknown>>,
): MotionExpressionBindingState {
	const versionedVersions = versionedBindingVersionsForTechnique(techniqueId);
	if (versionedVersions.length === 0) return "active";
	if (!hasOwn(parameters, MOTION_EXPRESSION_VERSION_PARAM_KEY)) {
		return "legacy";
	}
	const marker = parameters[MOTION_EXPRESSION_VERSION_PARAM_KEY];
	return typeof marker === "number" &&
		Number.isInteger(marker) &&
		versionedVersions.includes(marker)
		? "active"
		: "unsupported";
}

/**
 * A versioned expression is opt-in for an existing technique id. This preserves
 * legacy evaluator bindings until a workspace or Agent creates the explicit
 * expression-version marker.
 */
export function isMotionExpressionBindingActive(
	definition: MotionExpressionDefinition,
	binding: MotionGrammarBinding,
): boolean {
	return isMotionExpressionParametersActive(definition, binding.parameters);
}

/**
 * Raw-storage equivalent of {@link isMotionExpressionBindingActive}. Parsing
 * must decide its parameter contract before it can build a rich binding, so it
 * cannot call the binding-shaped helper above.
 */
export function isMotionExpressionParametersActive(
	definition: MotionExpressionDefinition,
	parameters: Readonly<Record<string, unknown>>,
): boolean {
	if (definition.activation !== "versioned") return true;
	return (
		motionExpressionBindingState(definition.expressionId, parameters) ===
			"active" &&
		parameters[MOTION_EXPRESSION_VERSION_PARAM_KEY] === definition.version
	);
}

/**
 * Finds the versioned definition selected by persisted raw parameters. This is
 * deliberately narrower than the registry lookup: unmarked bindings retain
 * their legacy catalog contract and legacy evaluator semantics.
 */
export function findActiveVersionedMotionExpressionDefinition(
	techniqueId: string,
	parameters: Readonly<Record<string, unknown>>,
): MotionExpressionDefinition | undefined {
	if (motionExpressionBindingState(techniqueId, parameters) !== "active") {
		return undefined;
	}
	const marker = parameters[MOTION_EXPRESSION_VERSION_PARAM_KEY];
	return typeof marker === "number"
		? findMotionExpressionDefinition(techniqueId, marker)
		: undefined;
}

/** Returns the non-authorable persistence marker required by a new binding. */
export function motionExpressionBootstrapParameters(
	techniqueId: MotionGrammarTechniqueId,
): Readonly<Record<string, number>> {
	const versions = versionedBindingVersionsForTechnique(techniqueId);
	const version = versions.length > 0 ? Math.max(...versions) : undefined;
	return version === undefined
		? {}
		: { [MOTION_EXPRESSION_VERSION_PARAM_KEY]: version };
}
