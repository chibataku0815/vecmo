import {
	type AutomationBinding,
	type AutomationKeyframe,
	type AutomationRecipe,
	type AutomationTrack,
	type AutomationTrackMode,
	type AutomationWrite,
	type EffectInfluence,
	type EffectInfluenceRecipe,
	type EffectSlotRef,
	type EffectTargetRef,
	normalizeAutomationRecipe,
	type VisualRecipe,
} from "@/shared/vec-core";

export const AUTOMATION_BRIDGE_ISSUE_CODES = [
	"automation-channel-unsupported",
	"automation-path-invalid",
	"automation-path-non-numeric",
	"automation-influence-assignment-missing",
] as const;

/** Stable diagnostics emitted when AutomationRecipe cannot be safely routed. */
export type AutomationBridgeIssueCode =
	(typeof AUTOMATION_BRIDGE_ISSUE_CODES)[number];

export type AutomationBridgeIssueSeverity = "warning" | "error";

/**
 * Typed validation seam for automation tracks that cannot produce a recipe or
 * influence patch at the sampled frame. Callers can surface these without
 * mutating the scene document or dropping the remaining valid tracks.
 */
export type AutomationBridgeIssue = {
	readonly code: AutomationBridgeIssueCode;
	readonly severity: AutomationBridgeIssueSeverity;
	readonly frame: number;
	readonly trackIndex: number;
	readonly binding: AutomationBinding;
	readonly path?: string;
	readonly assignmentId?: string;
	readonly message: string;
};

/**
 * Frame-sampled vec-core automation write. The value is the scalar produced by
 * the track curve before additive/replace composition with a base ref.
 */
export type AutomationSampledWrite = AutomationWrite & {
	readonly frame: number;
	readonly trackIndex: number;
};

/**
 * Numeric recipe-relative patch produced from an `effectParam` binding. `value`
 * is the composed value after applying the sampled write's mode to `baseValue`.
 */
export type RecipeAutomationPatch = {
	readonly channel: "effectParam";
	readonly target: EffectTargetRef;
	readonly effect: EffectSlotRef;
	readonly path: string;
	readonly mode: AutomationTrackMode;
	readonly baseValue: number;
	readonly sampledValue: number;
	readonly value: number;
	readonly trackIndex: number;
};

/**
 * Numeric influence-relative patch produced from an `effectInfluence` binding.
 * The path starts at `EffectInfluenceAssignment.influence`, not the assignment
 * wrapper, so assignment routing and mask-authoring data remain separate.
 */
export type InfluenceAutomationPatch = {
	readonly channel: "effectInfluence";
	readonly assignmentId: string;
	readonly path: string;
	readonly mode: AutomationTrackMode;
	readonly baseValue: number;
	readonly sampledValue: number;
	readonly value: number;
	readonly trackIndex: number;
};

/** Inputs needed to sample automation over already-resolved vec-core base refs. */
export type AutomationBridgeInput = {
	readonly automation: AutomationRecipe;
	readonly recipe: VisualRecipe;
	readonly influenceRecipe: EffectInfluenceRecipe;
	readonly frame: number;
};

/**
 * Pure sampled automation frame. Unchanged base refs are preserved by reference;
 * changed recipe/influence data is clone-on-change and scene-document-free.
 */
export type AutomationBridgeFrame = {
	readonly frame: number;
	readonly recipe: VisualRecipe;
	readonly influenceRecipe: EffectInfluenceRecipe;
	readonly writes: readonly AutomationSampledWrite[];
	readonly recipePatches: readonly RecipeAutomationPatch[];
	readonly influencePatches: readonly InfluenceAutomationPatch[];
	readonly issues: readonly AutomationBridgeIssue[];
};

type PathSegment = string | number;

type PathLookup =
	| {
			readonly ok: true;
			readonly value: unknown;
	  }
	| {
			readonly ok: false;
			readonly reason: "malformed" | "missing";
	  };

export type NumericAutomationPathPatchResult<T extends object> =
	| {
			readonly ok: true;
			readonly baseValue: number;
			readonly value: number;
			readonly next: T;
	  }
	| {
			readonly ok: false;
			readonly code: "automation-path-invalid" | "automation-path-non-numeric";
	  };

const DEFAULT_AUTOMATION_MODE: AutomationTrackMode = "additive";
const UNSAFE_PATH_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const PROPERTY_SEGMENT_RE = /^[A-Za-z_$][\w$]*$/;
const BRACKET_INDEX_RE = /\[(\d+)\]/g;

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

const lerp = (from: number, to: number, fraction: number): number =>
	from + (to - from) * fraction;

const easeInOut = (fraction: number): number =>
	fraction * fraction * (3 - 2 * fraction);

const normalizeFrame = (frame: number, durationFrames: number): number => {
	if (!Number.isFinite(frame)) return 0;
	return clamp(frame, 0, Math.max(0, durationFrames));
};

const modeOf = (track: AutomationTrack): AutomationTrackMode =>
	track.mode ?? DEFAULT_AUTOMATION_MODE;

const sampleBetween = (
	from: AutomationKeyframe,
	to: AutomationKeyframe,
	frame: number,
): number => {
	if (from.easing === "hold") return from.value;
	const span = to.frame - from.frame;
	const fraction = span > 0 ? (frame - from.frame) / span : 0;
	const clamped = clamp(fraction, 0, 1);
	const eased = from.easing === "easeInOut" ? easeInOut(clamped) : clamped;
	return lerp(from.value, to.value, eased);
};

const sampleAutomationTrackValue = (
	track: AutomationTrack,
	frame: number,
): number | null => {
	const { keyframes } = track;
	if (keyframes.length === 0) return null;
	const first = keyframes[0];
	if (frame <= first.frame) return first.value;
	const last = keyframes[keyframes.length - 1];
	if (frame >= last.frame) return last.value;
	for (let index = 0; index < keyframes.length - 1; index += 1) {
		const from = keyframes[index];
		const to = keyframes[index + 1];
		if (frame >= from.frame && frame < to.frame) {
			return sampleBetween(from, to, frame);
		}
	}
	return null;
};

const sampleNormalizedAutomationWrites = (
	automation: AutomationRecipe,
	frame: number,
): readonly AutomationSampledWrite[] => {
	if (!automation.enabled || automation.tracks.length === 0) return [];
	const sampledFrame = normalizeFrame(frame, automation.durationFrames);
	return automation.tracks.flatMap((track, trackIndex) => {
		const value = sampleAutomationTrackValue(track, sampledFrame);
		return value === null
			? []
			: [
					{
						binding: track.binding,
						value,
						mode: modeOf(track),
						frame: sampledFrame,
						trackIndex,
					},
				];
	});
};

const isObjectRecord = (
	value: unknown,
): value is Readonly<Record<string, unknown>> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isSafePropertySegment = (segment: string): boolean =>
	PROPERTY_SEGMENT_RE.test(segment) && !UNSAFE_PATH_KEYS.has(segment);

const parseAutomationPath = (path: string): readonly PathSegment[] | null => {
	if (path.length === 0 || path.trim() !== path) return null;
	const dottedPath = path.replace(BRACKET_INDEX_RE, ".$1");
	if (dottedPath.includes("[") || dottedPath.includes("]")) return null;
	const rawSegments = dottedPath.split(".");
	if (rawSegments.some((segment) => segment.length === 0)) return null;
	const segments: PathSegment[] = [];
	for (const segment of rawSegments) {
		if (/^\d+$/.test(segment)) {
			segments.push(Number(segment));
			continue;
		}
		if (!isSafePropertySegment(segment)) return null;
		segments.push(segment);
	}
	return segments;
};

const readPathValue = (
	root: unknown,
	segments: readonly PathSegment[],
): PathLookup => {
	let current = root;
	for (const segment of segments) {
		if (Array.isArray(current)) {
			if (
				typeof segment !== "number" ||
				segment < 0 ||
				segment >= current.length
			) {
				return { ok: false, reason: "missing" };
			}
			current = current[segment];
			continue;
		}
		if (!isObjectRecord(current) || typeof segment !== "string") {
			return { ok: false, reason: "missing" };
		}
		if (!Object.hasOwn(current, segment)) {
			return { ok: false, reason: "missing" };
		}
		current = current[segment];
	}
	return { ok: true, value: current };
};

const writePathValue = (
	root: unknown,
	segments: readonly PathSegment[],
	value: number,
): unknown => {
	const [head, ...tail] = segments;
	if (head === undefined) return value;
	if (Array.isArray(root)) {
		if (typeof head !== "number") return root;
		const current = root[head];
		const next =
			tail.length === 0 ? value : writePathValue(current, tail, value);
		if (Object.is(current, next)) return root;
		return root.map((item, index) => (index === head ? next : item));
	}
	if (!isObjectRecord(root) || typeof head !== "string") return root;
	const current = root[head];
	const next = tail.length === 0 ? value : writePathValue(current, tail, value);
	if (Object.is(current, next)) return root;
	return { ...root, [head]: next };
};

/**
 * Applies one sampled scalar automation value to a numeric object path without
 * mutating the root object. Presentation bridges use this for both vec-core
 * recipe paths and appearance style paths so invalid-path diagnostics stay
 * consistent across effect surfaces.
 */
export const composeAutomationNumericPathPatch = <T extends object>(
	root: T,
	path: string,
	sampledValue: number,
	mode: AutomationTrackMode,
): NumericAutomationPathPatchResult<T> => {
	const segments = parseAutomationPath(path);
	if (!segments) return { ok: false, code: "automation-path-invalid" };
	const lookup = readPathValue(root, segments);
	if (!lookup.ok) return { ok: false, code: "automation-path-invalid" };
	if (typeof lookup.value !== "number" || !Number.isFinite(lookup.value)) {
		return { ok: false, code: "automation-path-non-numeric" };
	}
	const value =
		mode === "additive" ? lookup.value + sampledValue : sampledValue;
	return {
		ok: true,
		baseValue: lookup.value,
		value,
		next: writePathValue(root, segments, value) as T,
	};
};

const issue = ({
	code,
	severity = "error",
	frame,
	trackIndex,
	binding,
	path,
	assignmentId,
	message,
}: {
	readonly code: AutomationBridgeIssueCode;
	readonly severity?: AutomationBridgeIssueSeverity;
	readonly frame: number;
	readonly trackIndex: number;
	readonly binding: AutomationBinding;
	readonly path?: string;
	readonly assignmentId?: string;
	readonly message: string;
}): AutomationBridgeIssue => ({
	code,
	severity,
	frame,
	trackIndex,
	binding,
	path,
	assignmentId,
	message,
});

export const automationPathIssueMessage = (
	code: AutomationBridgeIssueCode,
	path: string,
): string =>
	code === "automation-path-non-numeric"
		? `Automation path "${path}" resolves to a non-numeric value.`
		: `Automation path "${path}" is not a valid numeric vec-core path.`;

const applyRecipeWrite = (
	recipe: VisualRecipe,
	write: AutomationSampledWrite,
): {
	readonly recipe: VisualRecipe;
	readonly patch?: RecipeAutomationPatch;
	readonly issue?: AutomationBridgeIssue;
} => {
	if (write.binding.channel !== "effectParam") return { recipe };
	const { path } = write.binding;
	const patch = composeAutomationNumericPathPatch(
		recipe,
		path,
		write.value,
		write.mode,
	);
	if (!patch.ok) {
		return {
			recipe,
			issue: issue({
				code: patch.code,
				frame: write.frame,
				trackIndex: write.trackIndex,
				binding: write.binding,
				path,
				message: automationPathIssueMessage(patch.code, path),
			}),
		};
	}
	return {
		recipe: patch.next,
		patch: {
			channel: "effectParam",
			target: write.binding.target,
			effect: write.binding.effect,
			path,
			mode: write.mode,
			baseValue: patch.baseValue,
			sampledValue: write.value,
			value: patch.value,
			trackIndex: write.trackIndex,
		},
	};
};

const replaceInfluenceAssignment = (
	influenceRecipe: EffectInfluenceRecipe,
	assignmentIndex: number,
	influence: EffectInfluence,
): EffectInfluenceRecipe => {
	const assignment = influenceRecipe.assignments[assignmentIndex];
	if (!assignment || assignment.influence === influence) return influenceRecipe;
	return {
		...influenceRecipe,
		assignments: influenceRecipe.assignments.map((item, index) =>
			index === assignmentIndex ? { ...item, influence } : item,
		),
	};
};

const applyInfluenceWrite = (
	influenceRecipe: EffectInfluenceRecipe,
	write: AutomationSampledWrite,
): {
	readonly influenceRecipe: EffectInfluenceRecipe;
	readonly patch?: InfluenceAutomationPatch;
	readonly issue?: AutomationBridgeIssue;
} => {
	if (write.binding.channel !== "effectInfluence") return { influenceRecipe };
	const binding = write.binding;
	const assignmentIndex = influenceRecipe.assignments.findIndex(
		(assignment) => assignment.id === binding.assignmentId,
	);
	if (assignmentIndex < 0) {
		return {
			influenceRecipe,
			issue: issue({
				code: "automation-influence-assignment-missing",
				frame: write.frame,
				trackIndex: write.trackIndex,
				binding,
				path: binding.path,
				assignmentId: binding.assignmentId,
				message: `Automation targets missing influence assignment "${binding.assignmentId}".`,
			}),
		};
	}
	const assignment = influenceRecipe.assignments[assignmentIndex];
	const patch = composeAutomationNumericPathPatch(
		assignment.influence,
		binding.path,
		write.value,
		write.mode,
	);
	if (!patch.ok) {
		return {
			influenceRecipe,
			issue: issue({
				code: patch.code,
				frame: write.frame,
				trackIndex: write.trackIndex,
				binding,
				path: binding.path,
				assignmentId: binding.assignmentId,
				message: automationPathIssueMessage(patch.code, binding.path),
			}),
		};
	}
	return {
		influenceRecipe: replaceInfluenceAssignment(
			influenceRecipe,
			assignmentIndex,
			patch.next,
		),
		patch: {
			channel: "effectInfluence",
			assignmentId: binding.assignmentId,
			path: binding.path,
			mode: write.mode,
			baseValue: patch.baseValue,
			sampledValue: write.value,
			value: patch.value,
			trackIndex: write.trackIndex,
		},
	};
};

/**
 * Samples vec-core automation tracks at a frame into scalar writes. This is the
 * frame-time half of the O7 bridge: it understands AutomationRecipe timing, but
 * does not know about scene storage or mutate any recipe/influence object.
 */
export function sampleAutomationWrites(
	automation: AutomationRecipe,
	frame: number,
): readonly AutomationSampledWrite[] {
	const normalized = normalizeAutomationRecipe(automation);
	return sampleNormalizedAutomationWrites(
		normalized,
		normalizeFrame(frame, normalized.durationFrames),
	);
}

/**
 * Composes sampled AutomationRecipe writes over caller-provided vec-core base
 * refs. `effectParam` bindings patch recipe-relative numeric paths, while
 * `effectInfluence` bindings patch assignment-local influence paths. The result
 * is clone-on-change and scene-document-free so O3 can later route refs without
 * changing timeline semantics.
 */
export function sampleAutomationBridgeFrame({
	automation,
	recipe,
	influenceRecipe,
	frame,
}: AutomationBridgeInput): AutomationBridgeFrame {
	const normalized = normalizeAutomationRecipe(automation);
	const sampledFrame = normalizeFrame(frame, normalized.durationFrames);
	const writes = sampleNormalizedAutomationWrites(normalized, sampledFrame);
	if (writes.length === 0) {
		return {
			frame: sampledFrame,
			recipe,
			influenceRecipe,
			writes,
			recipePatches: [],
			influencePatches: [],
			issues: [],
		};
	}

	let nextRecipe = recipe;
	let nextInfluenceRecipe = influenceRecipe;
	const recipePatches: RecipeAutomationPatch[] = [];
	const influencePatches: InfluenceAutomationPatch[] = [];
	const issues: AutomationBridgeIssue[] = [];

	for (const write of writes) {
		switch (write.binding.channel) {
			case "effectParam": {
				const result = applyRecipeWrite(nextRecipe, write);
				nextRecipe = result.recipe;
				if (result.patch) recipePatches.push(result.patch);
				if (result.issue) issues.push(result.issue);
				break;
			}
			case "effectInfluence": {
				const result = applyInfluenceWrite(nextInfluenceRecipe, write);
				nextInfluenceRecipe = result.influenceRecipe;
				if (result.patch) influencePatches.push(result.patch);
				if (result.issue) issues.push(result.issue);
				break;
			}
			case "transform":
				issues.push(
					issue({
						code: "automation-channel-unsupported",
						severity: "warning",
						frame: write.frame,
						trackIndex: write.trackIndex,
						binding: write.binding,
						path: write.binding.path,
						message:
							"AutomationRecipe transform bindings are not mixed into VMA transform/opacity motion tracks by this bridge.",
					}),
				);
				break;
		}
	}

	return {
		frame: sampledFrame,
		recipe: nextRecipe,
		influenceRecipe: nextInfluenceRecipe,
		writes,
		recipePatches,
		influencePatches,
		issues,
	};
}
