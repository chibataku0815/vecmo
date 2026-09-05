/**
 * Codeable Duplicate: a parametric generator that expands one source node into N
 * presentation-only instances whose per-instance transform is computed by DSL
 * expressions over `{ i, count, seed, time, frame }`.
 *
 * The binding stores only ids and inert {@link ExpressionSource} ASTs. Expansion is
 * pure and emits the EXISTING {@link GrammarDuplicateSample} shape (the afterimage
 * rail), so generated instances are locked synthetic nodes that never enter the
 * scene store or command history — the document stays one source node + one binding.
 * The editor and the exported runtime both reproduce the instances by running the
 * same kernel, and `count` is clamped so a runaway expression cannot explode the
 * frame. v1 channels are `x`/`y`/`rotation`; scale/delay/color are deferred.
 */

import type { GrammarDuplicateSample } from "@/entities/motion/model/grammar-bridge";
import {
	type ExprEvalContext,
	type ExpressionSource,
	evaluateExpr,
} from "@/shared/expr-dsl";

/** Per-instance transform channels, each an optional expression (absent ⇒ 0). */
export type DuplicateGeneratorInstanceChannels = {
	readonly x?: ExpressionSource;
	readonly y?: ExpressionSource;
	readonly rotation?: ExpressionSource;
};

/** Scene side-car row describing one parametric duplicate generator. */
export type DuplicateGeneratorBinding = {
	readonly id: string;
	readonly sourceNodeId: string;
	readonly count: ExpressionSource;
	readonly seed?: number;
	readonly instance: DuplicateGeneratorInstanceChannels;
};

/** Hard cap on generated instances; clamps a runaway `count` expression per frame. */
export const MAX_DUPLICATE_COUNT = 256;

/** Separator in a generated duplicate id; distinct from the afterimage namespace. */
export const DUPLICATE_GENERATOR_ID_SEPARATOR = "#gen:";

/** Clip-local frame inputs; expansion fills `i`/`count`/`seed`/`value` per instance. */
export type DuplicateGeneratorFrameContext = {
	readonly time: number;
	readonly frame: number;
};

const evalChannel = (
	channel: ExpressionSource | undefined,
	ctx: ExprEvalContext,
): number => (channel ? evaluateExpr(channel.ast, ctx) : 0);

/**
 * Expands a generator into per-instance presentation duplicates for one frame.
 *
 * `count` is evaluated once (over a count-less context), floored, and clamped to
 * `[0, MAX_DUPLICATE_COUNT]`; each instance `i` then evaluates its transform channels
 * over `{ i, count, seed, time, frame }`. Output ids are `<sourceNodeId>#gen:<i>`.
 */
export function expandDuplicateGenerator(
	binding: DuplicateGeneratorBinding,
	frame: DuplicateGeneratorFrameContext,
): readonly GrammarDuplicateSample[] {
	const seed = binding.seed ?? 0;
	const rawCount = evaluateExpr(binding.count.ast, {
		time: frame.time,
		frame: frame.frame,
		value: 0,
		i: 0,
		count: 0,
		seed,
	});
	const count = Math.max(
		0,
		Math.min(MAX_DUPLICATE_COUNT, Math.floor(rawCount)),
	);
	const samples: GrammarDuplicateSample[] = [];
	for (let i = 0; i < count; i += 1) {
		const ctx: ExprEvalContext = {
			time: frame.time,
			frame: frame.frame,
			value: 0,
			i,
			count,
			seed,
		};
		samples.push({
			sourceNodeId: binding.sourceNodeId,
			duplicateNodeId: `${binding.sourceNodeId}${DUPLICATE_GENERATOR_ID_SEPARATOR}${i}`,
			sourceFrame: frame.frame,
			opacityFactor: 1,
			translate: {
				x: evalChannel(binding.instance.x, ctx),
				y: evalChannel(binding.instance.y, ctx),
			},
			rotate: evalChannel(binding.instance.rotation, ctx),
		});
	}
	return samples;
}
