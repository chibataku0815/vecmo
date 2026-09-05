import {
	removeLookNodeKeyframe,
	snapMotionFrame,
	upsertLookNodeKeyframe,
} from "@/entities/motion/model/commands";
import { effectiveLookNodeParam } from "@/entities/motion/model/sampler";
import { useMotionStore } from "@/entities/motion/model/store";
import type { MotionDocument } from "@/entities/motion/model/types";
import {
	isLookGraphNodeParamKeyframable,
	type LookGraphNodeKind,
	type LookGraphOwnerRef,
	sameLookGraphOwner,
} from "@/entities/scene/model/look-graph";
import type { LookGraphNodeNumberPath } from "./look-graph-commands";

/**
 * Closes the human side of Look-node param animation. The data path, the
 * `upsertLookNodeKeyframe` command, and the MCP write all landed earlier; what was
 * missing was the Inspector/Workspace deciding — like every other animatable
 * field — to write a keyframe instead of a static base value when recording (or
 * when the param is already animated). These pure helpers + one motion dispatch
 * are the decision; the surfaces call them from their existing scrub commit/gesture.
 */

/**
 * Strips the `"<kind>."` prefix off a {@link LookGraphNodeNumberPath} to the bare
 * `paramKey` that {@link upsertLookNodeKeyframe} / `withLookNodeParam` expect
 * (`"color-map.mix"` → `"mix"`, `"chromatic-fringe.amount"` → `"amount"` — the
 * hyphen sits before the dot, so the first dot is always the kind boundary).
 */
export const bareLookNodeParamKey = (path: LookGraphNodeNumberPath): string =>
	path.slice(path.indexOf(".") + 1);

/**
 * Extracts the node kind segment from a typed Look slider path. The type already
 * constrains valid paths; the runtime guard keeps future string callers from
 * addressing the param catalog with an empty kind.
 */
const lookNodeKindFromPath = (
	path: LookGraphNodeNumberPath,
): LookGraphNodeKind | null => {
	const dot = path.indexOf(".");
	return dot > 0 ? (path.slice(0, dot) as LookGraphNodeKind) : null;
};

/** Whether scrubbing this path can be recorded as a `lookNodeTracks` keyframe. */
export const isLookNodeTrackAnimatablePath = (
	path: LookGraphNodeNumberPath,
): boolean => {
	const kind = lookNodeKindFromPath(path);
	return kind
		? isLookGraphNodeParamKeyframable(kind, bareLookNodeParamKey(path))
		: false;
};

/** Resolves the frame Look graph owner a `scope` + `artboardId` writes to. */
export const lookGraphOwnerForScope = (
	scope: "current-artboard" | "scene",
	artboardId: string,
): LookGraphOwnerRef =>
	scope === "scene" ? { scope: "scene" } : { scope: "artboard", artboardId };

const lookNodeTrackFor = (
	motion: MotionDocument,
	owner: LookGraphOwnerRef,
	lookNodeId: string,
	paramKey: string,
) =>
	motion.lookNodeTracks?.find(
		(track) =>
			track.target.lookNodeId === lookNodeId &&
			track.target.paramKey === paramKey &&
			sameLookGraphOwner(track.target.owner, owner),
	);

/** Whether a `lookNodeTracks` keyframe already drives this param. */
export const isLookNodeParamAnimated = (
	motion: MotionDocument,
	owner: LookGraphOwnerRef,
	lookNodeId: string,
	paramKey: string,
): boolean =>
	(lookNodeTrackFor(motion, owner, lookNodeId, paramKey)?.keyframes.length ??
		0) > 0;

/**
 * The keyframe-vs-base rule, mirroring `shouldKeyInspectorField`: write a keyframe
 * when recording is on, OR when the param is already animated (so a still-parked
 * animated param is not silently overwritten with a stale base value).
 */
export const shouldKeyLookNodeParam = (
	motion: MotionDocument,
	owner: LookGraphOwnerRef,
	lookNodeId: string,
	paramKey: string,
	recording: boolean,
): boolean =>
	recording || isLookNodeParamAnimated(motion, owner, lookNodeId, paramKey);

/**
 * The value the slider should DISPLAY: the keyframed value at the playhead when the
 * param is animated, else the static base. Without this an animated look slider
 * stays parked at the base value and neither tracks the playhead nor starts a
 * recorded edit from the right place.
 */
export const lookNodeParamDisplayValue = (
	motion: MotionDocument,
	owner: LookGraphOwnerRef,
	lookNodeId: string,
	paramKey: string,
	base: number,
	frame: number,
): number =>
	effectiveLookNodeParam(motion, owner, lookNodeId, paramKey, base, frame);

/**
 * The live transport state a scrub commit consults. The widget layer reads it from
 * the transport store (a sibling feature the editor model must not import) and
 * passes it in, keeping this module within the feature-sliced import rules. Absent
 * context means the caller has no motion timeline → never key (base write only).
 */
export type LookNodeKeyframeContext = {
	readonly recording: boolean;
	/** Playhead frame, already rounded to a whole frame by the caller. */
	readonly frame: number;
};

/**
 * Decides whether a scrub of `path` on `lookNodeId` (owned by the already-resolved
 * `owner`) should record a keyframe rather than write the static base. Returns the
 * bare param key + frame when it should, else null (the caller then does its
 * existing scene-base write). `owner` is the concrete frame Look graph target the
 * commit/gesture already resolved; `motion` is read by the caller from the motion
 * store (an entity, so the editor model may read it directly).
 */
export const planLookNodeKeyframe = (
	motion: MotionDocument,
	context: LookNodeKeyframeContext | undefined,
	owner: LookGraphOwnerRef,
	lookNodeId: string,
	path: LookGraphNodeNumberPath,
): {
	readonly owner: LookGraphOwnerRef;
	readonly paramKey: string;
	readonly frame: number;
} | null => {
	if (!context) return null;
	if (!isLookNodeTrackAnimatablePath(path)) return null;
	const paramKey = bareLookNodeParamKey(path);
	if (
		!shouldKeyLookNodeParam(
			motion,
			owner,
			lookNodeId,
			paramKey,
			context.recording,
		)
	)
		return null;
	return { owner, paramKey, frame: context.frame };
};

/**
 * Applies one Look-node param keyframe at `frame`. The command's per-(track, frame)
 * coalesce key folds a whole scrub gesture (fixed frame) into one undo entry, so the
 * caller needs no motion transaction — a bare `apply` per tick is correct.
 */
export const applyLookNodeParamKeyframe = (
	owner: LookGraphOwnerRef,
	lookNodeId: string,
	paramKey: string,
	frame: number,
	value: number,
): void => {
	if (!Number.isFinite(value)) return;
	useMotionStore
		.getState()
		.apply(upsertLookNodeKeyframe(owner, lookNodeId, paramKey, frame, value));
};

/** Tri-state of one Look-node param's keyframe affordance at the playhead. */
export type LookNodeParamKeyframeState = {
	/** Is the param keyframable via `lookNodeTracks` at all (else no diamond). */
	readonly animatable: boolean;
	/** Does a track with at least one key drive it. */
	readonly animated: boolean;
	/** Is there a key at the (snapped) playhead frame. */
	readonly hasKeyAtFrame: boolean;
};

const NO_KEYFRAME_STATE: LookNodeParamKeyframeState = {
	animatable: false,
	animated: false,
	hasKeyAtFrame: false,
};

/**
 * The keyframe affordance state for `path` on `lookNodeId` at `frame`. The frame is
 * snapped exactly as `upsertLookNodeKeyframe` snaps it, so `hasKeyAtFrame` and the
 * toggle's add/remove address the identical stored frame (round ≠ snap only at the
 * duration boundary, which is precisely where an unsnapped compare would lie).
 */
export const lookNodeParamKeyframeState = (
	motion: MotionDocument,
	owner: LookGraphOwnerRef,
	lookNodeId: string,
	path: LookGraphNodeNumberPath,
	frame: number,
): LookNodeParamKeyframeState => {
	if (!isLookNodeTrackAnimatablePath(path)) return NO_KEYFRAME_STATE;
	const paramKey = bareLookNodeParamKey(path);
	const track = lookNodeTrackFor(motion, owner, lookNodeId, paramKey);
	const animated = (track?.keyframes.length ?? 0) > 0;
	const snapped = snapMotionFrame(frame, motion.durationFrames);
	const hasKeyAtFrame =
		track?.keyframes.some((keyframe) => keyframe.time === snapped) ?? false;
	return { animatable: true, animated, hasKeyAtFrame };
};

/**
 * The diamond affordance: add a keyframe at the playhead (pinning `displayValue`,
 * the value currently shown) when none exists there, or remove the one that does.
 * Removal is included because — until timeline rows ship — this is the only way to
 * delete a Look-node key. Reads the motion document fresh so a rapid re-click never
 * decides off a stale render snapshot.
 */
export const toggleLookNodeParamKeyframe = (
	owner: LookGraphOwnerRef,
	lookNodeId: string,
	path: LookGraphNodeNumberPath,
	frame: number,
	displayValue: number,
): void => {
	if (!isLookNodeTrackAnimatablePath(path)) return;
	const paramKey = bareLookNodeParamKey(path);
	const motion = useMotionStore.getState().document;
	const { hasKeyAtFrame } = lookNodeParamKeyframeState(
		motion,
		owner,
		lookNodeId,
		path,
		frame,
	);
	useMotionStore
		.getState()
		.apply(
			hasKeyAtFrame
				? removeLookNodeKeyframe(owner, lookNodeId, paramKey, frame)
				: upsertLookNodeKeyframe(
						owner,
						lookNodeId,
						paramKey,
						frame,
						displayValue,
					),
		);
};
