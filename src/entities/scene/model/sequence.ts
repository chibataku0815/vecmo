import type { MotionDocument } from "@/entities/motion/model/types";
import {
	findArtboardById,
	isSceneArtboard,
	type NormalizedArtboard,
	selectSceneArtboards,
} from "./selectors";
import type {
	SceneDocument,
	SceneSequence,
	SceneSequenceItem,
	SceneTransition,
} from "./types";

export type SceneSequenceTimelineIssueCode =
	| "sequence-item-invalid-duration"
	| "sequence-item-missing-artboard"
	| "sequence-item-non-scene-artboard"
	| "sequence-item-unsupported-transition";

/** Non-fatal problem found while resolving a sequence into frame ranges. */
export type SceneSequenceTimelineIssue = {
	readonly code: SceneSequenceTimelineIssueCode;
	readonly message: string;
	readonly itemId?: string;
	readonly artboardId?: string;
};

/** Sequence item with its resolved artboard and absolute frame range. */
export type ResolvedSceneSequenceItem = {
	readonly item: SceneSequenceItem;
	readonly artboard: NormalizedArtboard;
	readonly label: string;
	readonly transition: SceneTransition;
	readonly startFrame: number;
	readonly endFrameExclusive: number;
	readonly durationFrames: number;
};

/** Resolved timeline read model used by sequence preview and export adapters. */
export type SceneSequenceTimeline = {
	readonly sequence?: SceneSequence;
	readonly fps: number;
	readonly items: readonly ResolvedSceneSequenceItem[];
	readonly totalFrames: number;
	readonly issues: readonly SceneSequenceTimelineIssue[];
	readonly issueCodes: readonly SceneSequenceTimelineIssueCode[];
};

/** Address of one global frame after mapping it into the active scene item. */
export type SequenceFrameAddress = {
	readonly sequenceId: string;
	readonly itemId: string;
	readonly artboardId: string;
	readonly localFrame: number;
	readonly globalFrame: number;
	readonly itemStartFrame: number;
	readonly itemEndFrameExclusive: number;
};

/** Minimal serialized sequence shape shared by exported SVG and WebGL runtimes. */
export type SequenceFrameTimelineContract = {
	readonly id: string;
	readonly totalFrames: number;
	readonly items: readonly {
		readonly id: string;
		readonly artboardId: string;
		readonly startFrame: number;
		readonly endFrameExclusive: number;
	}[];
};

/** Inputs for resolving a scene sequence without coupling callers to stores. */
export type ResolveSequenceTimelineInput = {
	readonly scene: SceneDocument;
	readonly sequence?: SceneSequence;
	readonly motion?: Pick<MotionDocument, "durationFrames" | "fps">;
};

const DEFAULT_SEQUENCE_FPS = 30;
const DEFAULT_SEQUENCE_DURATION_FRAMES = 1;
const CUT_TRANSITION: SceneTransition = { kind: "cut" };

const issueCodes = (
	issues: readonly SceneSequenceTimelineIssue[],
): readonly SceneSequenceTimelineIssueCode[] =>
	[...new Set(issues.map((issue) => issue.code))].sort((left, right) =>
		left.localeCompare(right),
	) as readonly SceneSequenceTimelineIssueCode[];

const positiveIntegerOrUndefined = (
	value: number | undefined,
): number | undefined => {
	if (value === undefined || !Number.isFinite(value) || value <= 0) {
		return undefined;
	}
	return Math.max(1, Math.floor(value));
};

const positiveNumberOrUndefined = (
	value: number | undefined,
): number | undefined => {
	if (value === undefined || !Number.isFinite(value) || value <= 0) {
		return undefined;
	}
	return value;
};

const unsupportedTransition = (
	transition: SceneTransition | undefined,
): boolean => {
	if (!transition) return false;
	return (transition as { readonly kind?: unknown }).kind !== "cut";
};

const supportedTransitionOrCut = (
	item: SceneSequenceItem,
	issues: SceneSequenceTimelineIssue[],
): SceneTransition => {
	if (!unsupportedTransition(item.transition)) {
		return item.transition ?? CUT_TRANSITION;
	}
	issues.push({
		code: "sequence-item-unsupported-transition",
		message: `Sequence item "${item.id}" uses an unsupported transition and will be treated as a cut.`,
		itemId: item.id,
		artboardId: item.artboardId,
	});
	return CUT_TRANSITION;
};

const resolvedDurationFrames = ({
	item,
	artboard,
	motion,
	issues,
}: {
	readonly item: SceneSequenceItem;
	readonly artboard: NormalizedArtboard;
	readonly motion?: Pick<MotionDocument, "durationFrames">;
	readonly issues: SceneSequenceTimelineIssue[];
}): number => {
	const itemDuration = positiveIntegerOrUndefined(item.durationFrames);
	if (itemDuration !== undefined) return itemDuration;
	if (item.durationFrames !== undefined) {
		issues.push({
			code: "sequence-item-invalid-duration",
			message: `Sequence item "${item.id}" has a non-positive duration and fell back to its artboard duration.`,
			itemId: item.id,
			artboardId: item.artboardId,
		});
	}
	return (
		positiveIntegerOrUndefined(artboard.durationFrames) ??
		positiveIntegerOrUndefined(motion?.durationFrames) ??
		DEFAULT_SEQUENCE_DURATION_FRAMES
	);
};

const resolvedFps = ({
	scene,
	sequence,
	motion,
}: ResolveSequenceTimelineInput): number =>
	positiveNumberOrUndefined(sequence?.fps) ??
	positiveNumberOrUndefined(motion?.fps) ??
	positiveNumberOrUndefined(selectSceneArtboards(scene)[0]?.fps) ??
	DEFAULT_SEQUENCE_FPS;

/**
 * Resolves a document-level scene sequence into deterministic frame ranges. This
 * helper does not mutate or scope the scene; export adapters consume the returned
 * artboard ids and frame windows to build their own scoped snapshots.
 */
export function resolveSequenceTimeline(
	input: ResolveSequenceTimelineInput,
): SceneSequenceTimeline {
	const { scene, motion } = input;
	const sequence = input.sequence ?? scene.sequence;
	const issues: SceneSequenceTimelineIssue[] = [];
	const items: ResolvedSceneSequenceItem[] = [];
	let nextStartFrame = 0;

	for (const item of sequence?.items ?? []) {
		const artboard = findArtboardById(scene, item.artboardId);
		if (!artboard) {
			issues.push({
				code: "sequence-item-missing-artboard",
				message: `Sequence item "${item.id}" references missing artboard "${item.artboardId}" and was skipped.`,
				itemId: item.id,
				artboardId: item.artboardId,
			});
			continue;
		}
		if (!isSceneArtboard(artboard)) {
			issues.push({
				code: "sequence-item-non-scene-artboard",
				message: `Sequence item "${item.id}" references non-scene artboard "${artboard.name}" and was skipped.`,
				itemId: item.id,
				artboardId: item.artboardId,
			});
			continue;
		}

		const durationFrames = resolvedDurationFrames({
			item,
			artboard,
			motion,
			issues,
		});
		const startFrame = nextStartFrame;
		const endFrameExclusive = startFrame + durationFrames;
		items.push({
			item,
			artboard,
			label: item.label ?? artboard.name,
			transition: supportedTransitionOrCut(item, issues),
			startFrame,
			endFrameExclusive,
			durationFrames,
		});
		nextStartFrame = endFrameExclusive;
	}

	return {
		...(sequence ? { sequence } : {}),
		fps: resolvedFps(input),
		items,
		totalFrames: nextStartFrame,
		issues,
		issueCodes: issueCodes(issues),
	};
}

/** Calculates the composed duration of a sequence in frames. */
export function calculateSequenceDurationFrames(
	input: ResolveSequenceTimelineInput,
): number {
	return resolveSequenceTimeline(input).totalFrames;
}

const clampFrame = (frame: number, totalFrames: number): number => {
	if (totalFrames <= 0) return 0;
	if (!Number.isFinite(frame)) return 0;
	return Math.min(Math.max(frame, 0), totalFrames - 1);
};

/**
 * Maps a global sequence frame to the active scene artboard and local frame.
 * Frames outside the sequence clamp to the nearest valid frame, matching the
 * expected runtime `seek(0..1)` edge behavior.
 */
export function mapGlobalFrameToSequenceItem(
	timeline: SceneSequenceTimeline,
	frame: number,
): SequenceFrameAddress | undefined {
	return resolveSequenceFrameAddress(
		{
			id: timeline.sequence?.id ?? "sequence",
			totalFrames: timeline.totalFrames,
			items: timeline.items.map((item) => ({
				id: item.item.id,
				artboardId: item.artboard.id,
				startFrame: item.startFrame,
				endFrameExclusive: item.endFrameExclusive,
			})),
		},
		frame,
	);
}

/**
 * Maps a global player frame into a serialized scene-sequence item without
 * depending on editor stores or normalized artboard objects. Fractional frames
 * remain fractional so camera and motion interpolation stay smooth.
 */
export function resolveSequenceFrameAddress(
	timeline: SequenceFrameTimelineContract,
	frame: number,
): SequenceFrameAddress | undefined {
	if (timeline.totalFrames <= 0) return undefined;
	const globalFrame = clampFrame(frame, timeline.totalFrames);
	const item =
		timeline.items.find(
			(candidate) =>
				globalFrame >= candidate.startFrame &&
				globalFrame < candidate.endFrameExclusive,
		) ?? timeline.items.at(-1);
	if (!item) return undefined;

	return {
		sequenceId: timeline.id,
		itemId: item.id,
		artboardId: item.artboardId,
		localFrame: globalFrame - item.startFrame,
		globalFrame,
		itemStartFrame: item.startFrame,
		itemEndFrameExclusive: item.endFrameExclusive,
	};
}
