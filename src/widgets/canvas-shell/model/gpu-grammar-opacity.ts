/**
 * Grammar-driven-opacity node-id summary for the GPU capability predicate (E1
 * S2 review fix — see `docs/gpu-canvas-convergence-e1-plan.md` D1). Lives in
 * the WIDGETS layer, not `entities/scene/model/gpu/capability.ts`, because
 * `entities/scene` (same-layer rank 1) cannot value-import
 * `entities/motion-grammar` (rank 4) — the same rank-order constraint that
 * already forced `capability.ts` to inline a small motion-tracks lookup
 * rather than importing `entities/motion`'s `findTrack`. This module does the
 * real inspection here, in a layer with no such restriction, and hands
 * `capability.ts` a plain `ReadonlySet<string>` it can intersect against
 * `hasSubtreeCarrier` nodes without importing anything motion-grammar-shaped.
 *
 * Reads ONLY the committed `MotionGrammarBinding[]` (never sampled evaluator
 * output) — the same D1 "no-flap" rule `computeGpuArtboardSupport` already
 * follows for `motion.tracks`. A committed binding's technique id and target
 * ids are static per edit; nothing here samples a frame.
 */
import {
	MOTION_GRAMMAR_DECOMPOSITION_COVERAGE,
	type MotionGrammarScalarTrackCoverage,
	type MotionGrammarTechniqueDecompositionCoverage,
} from "@/entities/motion-grammar/model/decomposition";
import type { MotionGrammarBinding } from "@/entities/motion-grammar/model/types";

/**
 * `MOTION_GRAMMAR_DECOMPOSITION_COVERAGE` is declared `as const satisfies
 * readonly MotionGrammarTechniqueDecompositionCoverage[]`, which proves every
 * entry already conforms to that interface — but leaves each entry's
 * INFERRED type as its own narrower object literal (some rows omit the
 * optional `generatedScalarTracks`/`editableArtifacts` keys entirely rather
 * than typing them `undefined`), so a plain `.find()` over the raw const
 * does not uniformly expose optional fields declared on the named interface.
 * This cast is a widen-to-the-already-proven-supertype, not a type-safety
 * bypass.
 */
const DECOMPOSITION_COVERAGE =
	MOTION_GRAMMAR_DECOMPOSITION_COVERAGE as readonly MotionGrammarTechniqueDecompositionCoverage[];

/**
 * True when a technique's static coverage row declares an opacity-property
 * scalar track — either on the binding's own `targetIds` (`scalarTracks`) or
 * on nodes the technique GENERATES from those targets (`generatedScalarTracks`,
 * e.g. `periodic-afterimage`'s temporal-echo clones). Both cases are folded
 * into ONE boolean here: this module attributes either case to the binding's
 * own `targetIds` (see this file's doc comment on the exported function for
 * why a generated-clone technique cannot be attributed more precisely without
 * duplicating `decomposition.ts`'s private target-scope/role-resolution
 * logic — an honest, coarser-than-ideal but never-false-negative choice).
 */
function coverageDrivesOpacity(
	tracks: readonly MotionGrammarScalarTrackCoverage[] | undefined,
): boolean {
	return (tracks ?? []).some((track) => track.property === "opacity");
}

/**
 * Computes the set of node ids that a committed grammar binding drives an
 * opacity-like channel for, at the FINEST granularity achievable without
 * reimplementing `decomposition.ts`'s private `targetIdsForScope`/role-alias
 * resolution: every id in `binding.targetIds` whose technique's static
 * coverage row (`motionGrammarDecompositionCoverageForTechnique`, looked up
 * via the exported `MOTION_GRAMMAR_DECOMPOSITION_COVERAGE` table so a missing
 * row degrades to "no known opacity binding" instead of throwing) declares an
 * opacity scalar track, whether that track lands on the target itself
 * (`scalarTracks`, e.g. `random-phase-pulse`'s `opacity-factor`) or on nodes
 * generated FROM the target (`generatedScalarTracks`, e.g.
 * `periodic-afterimage`'s `duplicate-opacity` on its temporal-echo clones —
 * attributed back to the SOURCE node here, since the source's own visual
 * subtree is what an unaccounted GPU render would misrepresent alongside its
 * fading echoes).
 *
 * This is coarser than per-scope/per-role attribution for techniques whose
 * `targetScope` excludes some `targetIds` from the actual opacity output
 * (e.g. `"ordered-followers"` never animates the first/driver id) — those
 * ids are still included here, a false POSITIVE (an artboard stays SVG
 * fallback when it did not strictly need to), never a false negative. Per
 * the review decision, this is the accepted tradeoff over duplicating
 * `decomposition.ts`'s private target-scope resolution logic in this module.
 */
export function nodeIdsWithGrammarDrivenOpacity(
	bindings: readonly MotionGrammarBinding[],
): ReadonlySet<string> {
	const nodeIds = new Set<string>();
	for (const binding of bindings) {
		const coverage = DECOMPOSITION_COVERAGE.find(
			(entry) => entry.techniqueId === binding.techniqueId,
		);
		if (!coverage) continue;
		const drivesOpacity =
			coverageDrivesOpacity(coverage.scalarTracks) ||
			coverageDrivesOpacity(coverage.generatedScalarTracks);
		if (!drivesOpacity) continue;
		for (const targetId of binding.targetIds) nodeIds.add(targetId);
	}
	return nodeIds;
}
