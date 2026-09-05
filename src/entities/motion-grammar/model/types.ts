import type {
	AutomationTrackMode,
	EffectSlotRef,
	EffectTargetRef,
} from "@/shared/vec-core";

/**
 * Motion-grammar domain truth. This entity sits above `entities/motion`
 * (the evaluator imports motion's sampler one-way) and models named motion
 * techniques as authoring vocabulary, not vec-core visual effects. The serialized
 * storage shape and the presentation-input shapes live in
 * `entities/motion/model/grammar-bridge` so the presentation bridge can compose
 * grammar output without importing this entity.
 */

/**
 * Closed technique-id union. Grows additively as techniques land; the storage
 * boundary keeps `techniqueId: string` so the union can widen without touching
 * serialization. The four essence-slice techniques cover the four families.
 */
export type MotionGrammarTechniqueId =
	| "time-delay"
	| "random-phase-pulse"
	| "mirror-symmetric-scale"
	| "time-offset-propagation"
	| "ring-wave-interference"
	| "planar-solid-tumble"
	| "boolean-difference-rotation"
	| "inverse-proportion-link"
	| "arrangement-transition"
	| "shear-split"
	| "merge-split-cycle"
	| "count-growth"
	| "periodic-afterimage"
	| "cyclic-path-travel"
	| "auto-orient-along-path"
	| "size-speed-parallax"
	| "reactive-neighbor-displacement"
	| "lag-follow-through"
	| "noise-wipe"
	| "stroke-draw-on"
	| "collision-bounce";

/** Runtime membership list mirroring {@link MotionGrammarTechniqueId} for the parser. */
export const MOTION_GRAMMAR_TECHNIQUE_IDS = [
	"time-delay",
	"random-phase-pulse",
	"mirror-symmetric-scale",
	"time-offset-propagation",
	"ring-wave-interference",
	"planar-solid-tumble",
	"boolean-difference-rotation",
	"inverse-proportion-link",
	"arrangement-transition",
	"shear-split",
	"merge-split-cycle",
	"count-growth",
	"periodic-afterimage",
	"cyclic-path-travel",
	"auto-orient-along-path",
	"size-speed-parallax",
	"reactive-neighbor-displacement",
	"lag-follow-through",
	"noise-wipe",
	"stroke-draw-on",
	"collision-bounce",
] as const satisfies readonly MotionGrammarTechniqueId[];

export type MotionGrammarTechniqueFamily =
	| "temporal-placement"
	| "swarm-field"
	| "relational-constraint"
	| "spatial-dimensional";

export type MotionGrammarImplementationStatus = "implemented" | "planned";

/**
 * Future-proof effect channel. TYPE ONLY for the essence slice — every binding
 * defaults to `{ kind: "none" }` and no resolver exists yet. `temporal-echo` is a
 * first-class member so afterimage stays grammar-owned temporal duplication and
 * can never collapse into a vec-core glow slot.
 */
export type MotionGrammarEffectBinding =
	| { readonly kind: "none" }
	| {
			readonly kind: "active-target-influence";
			readonly effect: EffectSlotRef;
			readonly targetScope?: EffectTargetRef["scope"];
			readonly strength?: number;
	  }
	| {
			readonly kind: "automation-param";
			readonly effect: EffectSlotRef;
			readonly path: string;
			readonly mode?: AutomationTrackMode;
	  }
	| {
			readonly kind: "temporal-echo";
			readonly copies: number;
			readonly delayFrames: number;
			readonly decay: number;
	  };

export const MOTION_GRAMMAR_EFFECT_BINDING_KINDS = [
	"none",
	"active-target-influence",
	"automation-param",
	"temporal-echo",
] as const satisfies readonly MotionGrammarEffectBinding["kind"][];

/** Durable Scene-snapshot references and identity maps owned by Arrangement grammar. */
export type MotionGrammarPoint = {
	readonly x: number;
	readonly y: number;
};

export type MotionGrammarRandomPulseEnvelopeSegment = {
	readonly fromFrame: number;
	readonly toFrame: number;
	readonly fromValue: number;
	readonly toValue: number;
	readonly easing: readonly [number, number, number, number];
};

/**
 * Declarative, versioned Random Pulse candidate data. This is intentionally a
 * narrow binding field, not an executable expression or a promoted profile.
 */
export type MotionGrammarRandomPulseProfile = {
	readonly version: 1;
	readonly durationFrames: number;
	readonly segments: readonly MotionGrammarRandomPulseEnvelopeSegment[];
};

export type MotionGrammarArrangementMapping = {
	readonly sourceSnapshotId: string;
	readonly destinationSnapshotId: string;
	readonly sourceToStage: Readonly<Record<string, string>>;
	readonly stageToDestination: Readonly<Record<string, string>>;
	readonly stageSlots: Readonly<Record<string, MotionGrammarPoint>>;
	readonly pivot: MotionGrammarPoint;
	readonly stagingDelayFractionBySource?: Readonly<Record<string, number>>;
};

/**
 * A grammar binding: one named technique applied to an ordered target set. Target
 * order IS the wavefront for ordered techniques (e.g. time-delay). `parameters`
 * are normalized/clamped against the catalog at parse time. `roleMap` is reserved
 * for driver/follower roles and is preserved verbatim through serialization.
 */
export type MotionGrammarBinding = {
	readonly id: string;
	readonly techniqueId: MotionGrammarTechniqueId;
	readonly targetIds: readonly string[];
	readonly randomPulseProfile?: MotionGrammarRandomPulseProfile;
	readonly roleMap?: Readonly<Record<string, string>>;
	readonly arrangementMapping?: MotionGrammarArrangementMapping;
	readonly parameters: Readonly<Record<string, number>>;
	readonly seed?: number;
	readonly effectBinding?: MotionGrammarEffectBinding;
};

/** One authorable numeric parameter: drives the inspector control + clamp envelope. */
export type MotionGrammarParamSpec = {
	readonly key: string;
	readonly label: string;
	readonly default: number;
	readonly min: number;
	readonly max: number;
	readonly step: number;
	/**
	 * Optional discrete choices for an enum-valued numeric param (e.g. a shape
	 * index). When present the inspector renders a labeled dropdown instead of a
	 * raw number field; the stored value stays a number so commands/MCP/decomposition
	 * are unaffected. Absent for continuous params.
	 */
	readonly options?: readonly {
		readonly value: number;
		readonly label: string;
	}[];
};

/** Catalog metadata for one technique: drives the inspector picker and defaults. */
export type MotionGrammarCatalogEntry = {
	readonly id: MotionGrammarTechniqueId;
	readonly label: string;
	readonly family: MotionGrammarTechniqueFamily;
	readonly status: MotionGrammarImplementationStatus;
	/** Minimum ordered targets the technique needs to read (e.g. a wavefront). */
	readonly minTargets: number;
	readonly params: readonly MotionGrammarParamSpec[];
	/** Random-field techniques only; seed is a permutation generator, never noise. */
	readonly usesSeed: boolean;
};
