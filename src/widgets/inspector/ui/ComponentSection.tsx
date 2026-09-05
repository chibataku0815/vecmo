import { LinkSimple } from "@phosphor-icons/react";
import { useRef } from "react";
import { findComponentSymbol } from "@/entities/scene/model/component-symbols";
import { useSceneStore } from "@/entities/scene/model/store";
import type { VectorNode } from "@/entities/scene/model/types";
import { createId } from "@/shared/lib/id";
import { ScrubSlider } from "@/shared/ui/ScrubSlider";
import { applyInstanceTimingOffset } from "../model/component-timing-offset";

/** Frames the timing offset can span (±10s at 30fps) — a generous staggering range. */
const OFFSET_LIMIT_FRAMES = 300;

/**
 * Inspector section for a linked component INSTANCE. Surfaces the master it links to
 * and the only per-instance motion control in Phase 1: a timing offset (frames) that
 * phase-shifts the instance's copied keyframe motion, so staggered copies form a wave
 * while staying linked. Renders nothing for non-instance nodes, so it can be dropped
 * unconditionally into the single-selection panel.
 */
export function ComponentSection({ node }: { readonly node: VectorNode }) {
	const gestureKeyRef = useRef<string | null>(null);
	const binding = node.component?.kind === "instance" ? node.component : null;
	const masterName = useSceneStore((state) =>
		binding
			? (findComponentSymbol(state.document, binding.symbolId)?.name ??
				"Unknown master")
			: null,
	);
	if (!binding) return null;

	const offset = binding.timingOffsetFrames ?? 0;
	return (
		<section className="border-white/8 border-b px-1.5 pb-1.5 last:border-b-0">
			<div className="-mx-1.5 mb-1.5 sticky top-0 z-20 flex h-6 items-center justify-between gap-1 border-white/8 border-b bg-surface-raised/96 px-1.5 text-fg-secondary text-ui backdrop-blur-xl">
				<div className="flex min-w-0 items-center gap-1 font-medium">
					<LinkSimple aria-hidden="true" size={12} />
					<span className="truncate">Component</span>
				</div>
			</div>
			<div className="space-y-1">
				<div className="flex h-6 items-center justify-between gap-2 rounded-md border border-white/8 bg-black/15 px-1.5 text-ui">
					<span className="text-fg-muted">Master</span>
					<span
						className="min-w-0 truncate font-medium text-fg-secondary"
						title={masterName ?? undefined}
					>
						{masterName}
					</span>
				</div>
				<ScrubSlider
					label="Offset"
					value={offset}
					min={-OFFSET_LIMIT_FRAMES}
					max={OFFSET_LIMIT_FRAMES}
					neutral={0}
					step={1}
					bipolar
					unit="f"
					onScrubStart={() => {
						gestureKeyRef.current = createId("offset-gesture");
					}}
					onScrub={(next) => {
						if (gestureKeyRef.current) {
							applyInstanceTimingOffset(node.id, next, gestureKeyRef.current);
						}
					}}
					onScrubEnd={() => {
						gestureKeyRef.current = null;
					}}
					onCommitValue={(next) => {
						applyInstanceTimingOffset(node.id, next, createId("offset-commit"));
					}}
				/>
			</div>
		</section>
	);
}
