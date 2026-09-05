/**
 * Typed motion-expression runtime contract (P0, FROZEN).
 *
 * ONE {@link MotionExpressionDefinition} is the single source from which the
 * Inspector descriptor, the timeline clip policy, the runtime sampler, and the
 * explicit bake are all DERIVED. A definition is a code-registered built-in: its
 * executable `sample` fn is resolved by id at the evaluator boundary and is NEVER
 * serialized. Stored document state stays the plain
 * {@link MotionGrammarBinding} shape (`techniqueId`, numeric `parameters`,
 * declarative profile metadata, `roleMap`, `seed`), so no executable
 * JavaScript ever enters the document.
 *
 * The channel union is 1:1 with the value-bearing fields of `GrammarNodeSample`
 * (`entities/motion/model/grammar-bridge.ts`) plus the new scalar
 * `strokeDashoffset`. The mapped-type coverage contract below keeps the two
 * unions in lockstep at compile time.
 */

import type { EffectCapabilityTargetScope } from "@/entities/scene/model/effect-capabilities";
import type { PathMetricSample } from "@/entities/scene/model/path-metrics";
import type { VisualRecipe } from "@/shared/vec-core";
import type {
	MotionGrammarAuthoringBakePolicy,
	MotionGrammarAuthoringExpansionCapability,
	MotionGrammarAuthoringParameterSpec,
	MotionGrammarAuthoringProfileControl,
	MotionGrammarAuthoringProfileKind,
	MotionGrammarAuthoringTimelineMode,
	MotionGrammarAuthoringTimingTemplateDescriptor,
} from "./authoring-profile";
import type {
	MotionGrammarRandomPulseProfile,
	MotionGrammarTechniqueId,
} from "./types";

/**
 * Reserved parameter key carrying the expression version on a binding. It rides
 * as a binding parameter (afterimage `profileVersion` precedent) so no new
 * serialized field is introduced, and is excluded from the authorable parameter
 * surface so it never renders as a phantom Inspector control.
 */
export const MOTION_EXPRESSION_VERSION_PARAM_KEY = "expressionVersion";

/**
 * Registration policy for a technique id that already has legacy evaluator
 * semantics. A versioned definition activates only on a binding created by its
 * owner, so adding a richer law never silently changes an existing document.
 */
export type MotionExpressionActivation = "always" | "versioned";

/** Two-component vector emitted by translate/scale channels. */
export type ExpressionVector2 = {
	readonly x: number;
	readonly y: number;
};

/**
 * Closed output-channel union. EXACTLY the value-bearing `GrammarNodeSample`
 * fields (`nodeId` is identity, not a channel) plus the new `strokeDashoffset`
 * scalar. Adding a channel here REQUIRES adding the matching `GrammarNodeSample`
 * field; the coverage test fails otherwise.
 */
export type ExpressionChannelKind =
	| "sourceFrame"
	| "translate"
	| "rotate"
	| "scaleFactor"
	| "opacityFactor"
	| "opacityOverride"
	| "recipeOverride"
	| "rotationOverride"
	| "strokeDashoffset";

/** Runtime mirror of {@link ExpressionChannelKind} (exhaustive, see test). */
export const EXPRESSION_CHANNEL_KINDS = [
	"sourceFrame",
	"translate",
	"rotate",
	"scaleFactor",
	"opacityFactor",
	"opacityOverride",
	"recipeOverride",
	"rotationOverride",
	"strokeDashoffset",
] as const satisfies readonly ExpressionChannelKind[];

/**
 * One typed channel write for one node. The discriminant `kind` selects the
 * `value` shape: vectors for translate/scaleFactor, a recipe for recipeOverride,
 * a scalar for every other channel.
 */
export type ExpressionChannelEmit =
	| {
			readonly kind: "sourceFrame";
			readonly nodeId: string;
			readonly value: number;
	  }
	| {
			readonly kind: "translate";
			readonly nodeId: string;
			readonly value: ExpressionVector2;
	  }
	| { readonly kind: "rotate"; readonly nodeId: string; readonly value: number }
	| {
			readonly kind: "scaleFactor";
			readonly nodeId: string;
			readonly value: ExpressionVector2;
	  }
	| {
			readonly kind: "opacityFactor";
			readonly nodeId: string;
			readonly value: number;
	  }
	| {
			readonly kind: "opacityOverride";
			readonly nodeId: string;
			readonly value: number;
	  }
	| {
			readonly kind: "recipeOverride";
			readonly nodeId: string;
			readonly value: VisualRecipe;
	  }
	| {
			readonly kind: "rotationOverride";
			readonly nodeId: string;
			readonly value: number;
	  }
	| {
			readonly kind: "strokeDashoffset";
			readonly nodeId: string;
			readonly value: number;
	  };

/**
 * Role-slot target category. Reuses the existing 3-kind authoring taxonomy
 * (`MotionGrammarAuthoringInstanceReference`): editable document objects,
 * technique-owned generated nodes, and runtime-only presentation artifacts.
 */
export type ExpressionRoleKind =
	| "scene-node"
	| "generated-scene-node"
	| "presentation-artifact";

/** One declared role slot the technique drives and the user may replace/edit. */
export type ExpressionRoleDeclaration = {
	readonly roleId: string;
	/**
	 * Serialized workspace role keys or legacy role ids that should bind to this
	 * declaration. Keeps expression role ids stable while workspace systems carry
	 * technique-qualified keys such as `cyclic-path-travel:path`.
	 */
	readonly aliases?: readonly string[];
	readonly label: string;
	readonly kind: ExpressionRoleKind;
	readonly editable: boolean;
	readonly replaceable: boolean;
};

/**
 * One authorable numeric parameter. Identical to the authoring parameter spec
 * (`MotionGrammarAuthoringParameterSpec`) so the existing
 * `normalizeMotionGrammarAuthoringParameterPatch` validates expression patches
 * unchanged, plus the Inspector group this parameter belongs to.
 */
export type ExpressionParamSpec = MotionGrammarAuthoringParameterSpec & {
	readonly groupId: string;
	readonly groupLabel: string;
};

/** Context shared by every {@link RoleExpansionPolicy} computed callback. */
export type RoleExpansionContext = {
	readonly targetIds: readonly string[];
	readonly parameters: Readonly<Record<string, number>>;
};

/** Per-(source × copy) coordinate handed to fanout callbacks. */
export type RoleExpansionFanoutContext = RoleExpansionContext & {
	readonly sourceIndex: number;
	readonly copyIndex: number;
};

/**
 * How a definition's roles expand over the binding's targets.
 *
 * - `per-target` is implemented in P1 and covers Cycle and time-offset: each
 *   ordered target fills the role once.
 * - `per-target-fanout` is declared now but evaluated later. It can express
 *   afterimage's per-(source × copy) presentation artifacts with a COMPUTED
 *   `delayFrames`, which is why the branch must exist in the frozen type from day
 *   one — undersizing it would force a breaking redesign.
 */
export type RoleExpansionPolicy =
	| {
			readonly mode: "per-target";
			readonly roleId: string;
	  }
	| {
			readonly mode: "per-target-fanout";
			readonly sourceRoleId: string;
			readonly copyRoleId: string;
			readonly copyCount: (context: RoleExpansionContext) => number;
			readonly delayFrames: (context: RoleExpansionFanoutContext) => number;
	  };

/** Timeline policy; mirrors `descriptor.timeline` so projection is a copy. */
export type ExpressionTimelinePolicy = {
	readonly mode: MotionGrammarAuthoringTimelineMode;
	readonly bakePolicy: MotionGrammarAuthoringBakePolicy;
	readonly clipLabel?: string;
	/**
	 * Parameter key whose value drives the authoring clip duration. INVARIANT:
	 * it MUST name a real `params` key, else `profilePeriodFrames` silently
	 * returns a 1-frame clip. The P1 projection asserts this.
	 */
	readonly durationParameterKey?: string;
};

/**
 * Declarative look/effect hook a motion expression may drive. The capability id
 * points at the scene-domain effect registry, so expressions bind to authored
 * recipe/influence controls instead of inventing technique-local look fields.
 */
export type MotionExpressionLookHook = {
	readonly id: string;
	readonly label: string;
	readonly capabilityId: string;
	readonly targetScope: EffectCapabilityTargetScope;
	readonly targetRoleId?: string;
	readonly parameterKey?: string;
	readonly outputChannel?: Extract<ExpressionChannelKind, "recipeOverride">;
};

/**
 * Pure sampling environment. No scene-store or command-bus handle exists here BY
 * CONSTRUCTION, so a `sample` implementation cannot mutate the document. `frame`
 * is clip-local. `resolvedRoleNodeIds` degrades to a single implicit role keyed
 * off `binding.targetIds` for techniques without a `roleMap` (e.g. Cycle).
 */
export type ExpressionSampleEnv = {
	readonly frame: number;
	readonly resolvedRoleNodeIds: ReadonlyMap<string, readonly string[]>;
	readonly parameters: Readonly<Record<string, number>>;
	readonly seed?: number;
	/** Optional explicit Random Pulse envelope carried by the binding. */
	readonly randomPulseProfile?: MotionGrammarRandomPulseProfile;
	readonly restPositionOf: (nodeId: string) => ExpressionVector2;
	/** Optional presentation-safe read of a node's pre-expression position at a frame. */
	readonly samplePositionAt?: (
		nodeId: string,
		frame: number,
	) => ExpressionVector2;
	/** Optional presentation-safe read of a node's pre-expression scale at a frame. */
	readonly sampleScaleAt?: (nodeId: string, frame: number) => ExpressionVector2;
	/** Optional read-only base radius for a uniformly-scaled ellipse carrier. */
	readonly restCircleRadiusOf?: (nodeId: string) => number | null;
	readonly restPointOf?: (nodeId: string) => ExpressionVector2;
	readonly pathSampleAt?: (
		nodeId: string,
		progress: number,
		options?: { readonly stepsPerSegment?: number },
	) => PathMetricSample | null;
};

/**
 * The single source of truth for one promoted Glammer technique. Inspector
 * controls, timeline clip policy, runtime sampler dispatch, and explicit bake all
 * derive from this declaration.
 */
export type MotionExpressionDefinition = {
	/** Equals the technique id for the pilot; a separate serialized id is deferred. */
	readonly expressionId: MotionGrammarTechniqueId;
	readonly version: number;
	/** Defaults to `always`; use `versioned` when this id has legacy semantics. */
	readonly activation?: MotionExpressionActivation;
	readonly source: {
		readonly origin: string;
		readonly reference?: string;
	};
	readonly label: string;
	readonly summary: string;
	readonly kind: MotionGrammarAuthoringProfileKind;
	readonly expansion: MotionGrammarAuthoringExpansionCapability;
	readonly seedControl?: MotionGrammarAuthoringParameterSpec;
	readonly profileControls?: readonly MotionGrammarAuthoringProfileControl[];
	readonly roles: readonly ExpressionRoleDeclaration[];
	readonly params: readonly ExpressionParamSpec[];
	readonly outputs: readonly ExpressionChannelKind[];
	readonly timeline: ExpressionTimelinePolicy;
	readonly roleExpansion: RoleExpansionPolicy;
	readonly lookHooks?: readonly MotionExpressionLookHook[];
	readonly timingTemplates?: readonly MotionGrammarAuthoringTimingTemplateDescriptor[];
	readonly recipeRoles?: readonly string[];
	/** Pure, deterministic per-frame sampler. No `Math.random` / `Date`. */
	readonly sample: (
		env: ExpressionSampleEnv,
	) => readonly ExpressionChannelEmit[];
};
