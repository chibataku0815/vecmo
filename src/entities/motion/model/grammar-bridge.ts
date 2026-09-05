/**
 * Motion-owned bridge types for the motion-grammar authoring layer.
 *
 * `entities/motion` owns the **serialized storage shape** and the
 * **presentation-input shapes** so `presentation.ts` can compose grammar output
 * WITHOUT importing `entities/motion-grammar`. That import would form a
 * `motion ↔ motion-grammar` cycle, since the grammar evaluator imports motion's
 * {@link ./sampler}. The rich domain types (`MotionGrammarBinding`, the closed
 * technique-id union, the evaluator) live in `entities/motion-grammar` and depend
 * on these one-way.
 *
 * `MotionDocument` embeds the serialized layer (`grammar?`) for persistence only.
 * Sampling never reads `MotionDocument.grammar`; the live source of truth is the
 * grammar store's parsed bindings, threaded in as a {@link GrammarFrameSampler}.
 */

import type { VisualRecipe } from "@/shared/vec-core";

/**
 * Storage-boundary binding. `techniqueId` stays `string` (never the closed union)
 * so a forward-version document never fails the motion runtime guard and never
 * triggers a silent fallback. Unknown ids and malformed parameters are preserved
 * verbatim and resolved at the evaluator boundary, never at load.
 */
export type SerializedMotionGrammarBinding = {
	readonly id: string;
	readonly techniqueId: string;
	readonly targetIds: readonly string[];
	/** Declarative Random Pulse candidate; executable code never crosses storage. */
	readonly randomPulseProfile?: {
		readonly version: number;
		readonly durationFrames: number;
		readonly segments: readonly {
			readonly fromFrame: number;
			readonly toFrame: number;
			readonly fromValue: number;
			readonly toValue: number;
			readonly easing: readonly number[];
		}[];
	};
	readonly roleMap?: Record<string, string>;
	readonly arrangementMapping?: {
		readonly sourceSnapshotId: string;
		readonly destinationSnapshotId: string;
		readonly sourceToStage: Record<string, string>;
		readonly stageToDestination: Record<string, string>;
		readonly stageSlots: Record<
			string,
			{ readonly x: number; readonly y: number }
		>;
		readonly pivot: { readonly x: number; readonly y: number };
		readonly stagingDelayFractionBySource?: Record<string, number>;
	};
	readonly parameters: Record<string, unknown>;
	readonly seed?: number;
	readonly effectBinding?: unknown;
};

export type SerializedMotionGrammarLayer = {
	readonly schemaVersion: 1;
	readonly bindings: readonly SerializedMotionGrammarBinding[];
};

/**
 * Per-node grammar sample composed over the keyframe pose by the presentation
 * bridge. Compose order (invariant): `sourceFrame` re-times the node's own tracks
 * → keyframe sample (base pose) → additive `translate`/`rotate` + multiplicative
 * `scaleFactor` → opacity (`opacityOverride` wins, otherwise `opacityFactor`
 * multiplies) → optional `recipeOverride` → `rotationOverride` (if present)
 * supersedes the composed rotation → optional `strokeDashoffset` marches the
 * node's static dash array (composed over the base style, never under).
 * `sourceFrame` is absolute and already wrapped by the evaluator (presentation
 * cannot loop, it only clamps).
 */
export type GrammarNodeSample = {
	readonly nodeId: string;
	readonly sourceFrame?: number;
	readonly translate?: { readonly x: number; readonly y: number };
	readonly rotate?: number;
	readonly scaleFactor?: { readonly x: number; readonly y: number };
	readonly opacityFactor?: number;
	readonly opacityOverride?: number;
	readonly recipeOverride?: VisualRecipe;
	readonly rotationOverride?: number;
	readonly strokeDashoffset?: number;
};

/**
 * Presentation-only duplicate of a source node. Used by temporal grammar such as
 * afterimage where one source node must draw multiple historical poses in a
 * single frame. Duplicates are never persisted to the scene store; presentation
 * inserts locked synthetic nodes so canvas hit testing and editing still target
 * only real scene nodes.
 */
export type GrammarDuplicateSample = {
	readonly sourceNodeId: string;
	readonly duplicateNodeId: string;
	readonly sourceFrame: number;
	readonly opacityFactor: number;
	readonly translate?: { readonly x: number; readonly y: number };
	readonly rotate?: number;
	readonly scaleFactor?: { readonly x: number; readonly y: number };
	readonly opacityOverride?: number;
	readonly recipeOverride?: VisualRecipe;
};

export type GrammarFrameSample = {
	readonly samples: ReadonlyMap<string, GrammarNodeSample>;
	readonly duplicates: readonly GrammarDuplicateSample[];
};

export type GrammarPresentationIssue = {
	readonly code: string;
	readonly bindingId: string;
	readonly nodeId?: string;
	readonly techniqueId?: string;
};

/**
 * Injected per-frame grammar sampler. The presentation bridge calls this once per
 * frame to obtain node samples and optional presentation-only duplicates; the
 * closure is built by a higher layer (canvas-shell / export) from the grammar
 * store's parsed bindings plus the motion-grammar evaluator. Presentation never
 * imports the evaluator, preserving the one-way `motion-grammar → motion`
 * dependency.
 */
export type GrammarFrameSampler = (
	frame: number,
) => ReadonlyMap<string, GrammarNodeSample> | GrammarFrameSample;
