import {
	ArrowsOutSimple,
	CaretDown,
	CaretRight,
	FloppyDisk,
	FlowArrow,
	Swap,
	Trash,
	X,
} from "@phosphor-icons/react";
import {
	type ChangeEvent,
	type KeyboardEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { applyAnimationClipTimingTemplate } from "@/entities/motion/model/commands";
import {
	findMotionTimingTemplate,
	type MotionTimingTemplate,
	motionTimingTemplatesForKeyframeSegment,
	sampleMotionTimingTemplatePreview,
} from "@/entities/motion/model/easing";
import { useMotionStore } from "@/entities/motion/model/store";
import type {
	AnimationClip,
	MotionDocument,
} from "@/entities/motion/model/types";
import { createArrangementMappingAuthoringPlan } from "@/entities/motion-grammar/model/arrangement-mapping-authoring";
import type {
	MotionGrammarAuthoringParameterGroup,
	MotionGrammarAuthoringProfileControl,
	MotionGrammarAuthoringProfileDescriptor,
} from "@/entities/motion-grammar/model/authoring-profile";
import { describeMotionGrammarAuthoringProfile } from "@/entities/motion-grammar/model/authoring-profile-registry";
import {
	motionGrammarAuthoringBakeLabel,
	motionGrammarAuthoringSourceSummary,
	motionGrammarAuthoringTimelineLabel,
} from "@/entities/motion-grammar/model/authoring-system";
import { findCatalogEntry } from "@/entities/motion-grammar/model/catalog";
import {
	type MotionGrammarBindingPatch,
	reorderGrammarBinding,
	updateGrammarBinding,
} from "@/entities/motion-grammar/model/commands";
import {
	RANDOM_PULSE_PROFILE_DEFAULT,
	RANDOM_PULSE_PROFILE_MAX_DURATION_FRAMES,
	type RandomPulseProfileEdit,
} from "@/entities/motion-grammar/model/random-pulse-profile";
import { useMotionGrammarStore } from "@/entities/motion-grammar/model/store";
import {
	buildMotionGrammarSystemMap,
	type MotionGrammarSystemMap,
} from "@/entities/motion-grammar/model/system-map";
import type {
	MotionGrammarBinding,
	MotionGrammarEffectBinding,
	MotionGrammarParamSpec,
	MotionGrammarRandomPulseProfile,
	MotionGrammarTechniqueFamily,
	MotionGrammarTechniqueId,
} from "@/entities/motion-grammar/model/types";
import { motionGrammarParameterSpecsForBinding } from "@/entities/motion-grammar/model/versioned-expression-binding";
import { allNodes, findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type { SceneDocument } from "@/entities/scene/model/types";
import { commitMotionSystemClipRetime } from "@/features/motion/model/motion-system-retime";
import { useSelectionStore } from "@/features/selection/model/store";
import { cn } from "@/shared/lib/cn";
import { formatScrubValue, quantizeToRange } from "@/shared/ui/scrub-math";
import {
	commitApplyTechnique,
	commitBakeCollisionBounce,
	commitBindingParameter,
	commitCreateMotionGrammarEditableExpansion,
	commitCreateMotionGrammarWorkspaceInstance,
	commitMotionGrammarProfileEdit,
	commitRemoveBinding,
	commitReplaceMotionGrammarRole,
	createMotionGrammarEditableExpansionRequest,
	createMotionGrammarExpansionPreview,
	defaultTechniqueIdForTargetCount,
	grammarBindingForNodes,
	grammarParameterLabel,
	isTechniqueApplicableToTargetCount,
	type MotionGrammarExpansionIssueItem,
	type MotionGrammarExpansionIssueTone,
	type MotionGrammarExpansionSourceDisposition,
	type MotionGrammarParameterCommitResult,
	motionGrammarRoleReplacementForSelection,
	motionGrammarWorkspaceInstanceForSelection,
	normalizeMotionGrammarExpansionSampleStep,
	selectedMotionGrammarRoleItems,
	techniqueOptionsForTargetCount,
} from "../model/motion-grammar-authoring";

/**
 * Compact "Motion" authoring section for a multi-node selection: applies a named
 * motion-grammar technique to the ordered selection, then exposes its meaningful
 * authoring profile, fallback catalog parameters, and a remove action.
 */

const TECHNIQUE_FAMILIES: readonly MotionGrammarTechniqueFamily[] = [
	"temporal-placement",
	"swarm-field",
	"relational-constraint",
	"spatial-dimensional",
];

const FAMILY_LABELS = {
	"temporal-placement": "Temporal",
	"swarm-field": "Swarm",
	"relational-constraint": "Relational",
	"spatial-dimensional": "Spatial",
} as const satisfies Record<MotionGrammarTechniqueFamily, string>;

const iconButtonClass =
	"grid size-4 shrink-0 place-items-center rounded text-fg-muted transition hover:bg-white/10 hover:text-fg disabled:cursor-not-allowed disabled:opacity-30";

const actionButtonClass =
	"inline-flex h-6 min-w-0 items-center justify-center gap-1 rounded-md border border-white/10 px-1.5 text-fg text-ui transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35";

const segmentButtonClass =
	"h-5 rounded border px-1.5 text-ui transition disabled:cursor-not-allowed disabled:opacity-35";

const TIMING_TEMPLATE_PREVIEW_WIDTH = 44;
const TIMING_TEMPLATE_PREVIEW_HEIGHT = 14;
const TIMING_TEMPLATE_PREVIEW_PADDING = 1.5;

const issueToneClass = (tone: MotionGrammarExpansionIssueTone): string => {
	switch (tone) {
		case "danger":
			return "border-danger/35 bg-danger-surface text-danger-fg";
		case "warn":
			return "border-warn/35 bg-warn-surface text-warn-fg";
		case "accent":
			return "border-accent/30 bg-accent-surface text-accent-fg";
		case "muted":
			return "border-white/8 bg-white/[0.035] text-fg-muted";
	}
};

const formatParameterValue = (value: number, step: number): string =>
	formatScrubValue(value, step);

const isBlockedParameterCommit = (result: unknown): boolean =>
	typeof result === "object" &&
	result !== null &&
	"status" in result &&
	result.status === "blocked";

const timingTemplatePreviewPath = (template: MotionTimingTemplate): string => {
	const points = sampleMotionTimingTemplatePreview(template.id);
	if (points.length === 0) return "";
	const innerWidth =
		TIMING_TEMPLATE_PREVIEW_WIDTH - TIMING_TEMPLATE_PREVIEW_PADDING * 2;
	const innerHeight =
		TIMING_TEMPLATE_PREVIEW_HEIGHT - TIMING_TEMPLATE_PREVIEW_PADDING * 2;
	return points
		.map((point, index) => {
			const x = TIMING_TEMPLATE_PREVIEW_PADDING + point.x * innerWidth;
			const y = TIMING_TEMPLATE_PREVIEW_PADDING + (1 - point.y) * innerHeight;
			return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
		})
		.join(" ");
};

function TimingTemplateSparkline({
	template,
}: {
	readonly template: MotionTimingTemplate;
}) {
	return (
		<svg
			viewBox={`0 0 ${TIMING_TEMPLATE_PREVIEW_WIDTH} ${TIMING_TEMPLATE_PREVIEW_HEIGHT}`}
			aria-hidden="true"
			className="h-3.5 w-11 shrink-0"
		>
			<path
				d={`M ${TIMING_TEMPLATE_PREVIEW_PADDING} ${TIMING_TEMPLATE_PREVIEW_HEIGHT - TIMING_TEMPLATE_PREVIEW_PADDING} H ${TIMING_TEMPLATE_PREVIEW_WIDTH - TIMING_TEMPLATE_PREVIEW_PADDING}`}
				fill="none"
				className="stroke-hairline/25"
				strokeWidth="1"
			/>
			<path
				d={timingTemplatePreviewPath(template)}
				fill="none"
				className="stroke-accent"
				strokeLinecap="round"
				strokeWidth="1.4"
			/>
		</svg>
	);
}

function ExpansionIssuePill({
	issue,
}: {
	readonly issue: MotionGrammarExpansionIssueItem;
}) {
	return (
		<span
			className={cn(
				"min-w-0 truncate rounded border px-1 py-0.5 text-ui leading-3",
				issueToneClass(issue.tone),
			)}
			title={issue.title}
		>
			{issue.label}
		</span>
	);
}

/**
 * Collision Bounce's own explicit-bake trigger. Rendered instead of
 * {@link MotionExpansionControls} for this technique: the generic decompose-
 * and-bake path only emits dense per-frame LINEAR tracks, which
 * `docs/knowledge/bounce-canonical-representation.md` rejects for bounce, so
 * `collision-bounce`'s decomposition-coverage row is intentionally empty and
 * its generic button would always read "blocked". This calls
 * `commitBakeCollisionBounce` (the sparse beat-anchored emitter) directly.
 */
function CollisionBounceBakeAction({
	binding,
	scene,
}: {
	readonly binding: MotionGrammarBinding;
	readonly scene: SceneDocument;
}) {
	const [lastResultTitle, setLastResultTitle] = useState<string | null>(null);
	const commitBake = () => {
		const result = commitBakeCollisionBounce({ binding, scene });
		setLastResultTitle(
			result.status === "committed"
				? `Baked ${result.targetCount} subject(s), ${result.keyCount} key(s).`
				: `Bake blocked: ${result.reason}`,
		);
	};
	return (
		<div className="rounded-md border border-white/8 bg-surface-sunken/70 p-1.5 text-ui">
			<button
				type="button"
				title="Bake sparse beat-anchored position, deformation, and rotation keys for this bounce"
				onClick={commitBake}
				className={cn(
					actionButtonClass,
					"w-full border-accent/50 bg-accent-surface text-accent-fg",
				)}
			>
				<FloppyDisk aria-hidden="true" size={11} />
				<span className="truncate">Bake Collision Bounce</span>
			</button>
			{lastResultTitle ? (
				<div className="mt-1 truncate text-fg-muted text-ui leading-3">
					{lastResultTitle}
				</div>
			) : null}
		</div>
	);
}

function MotionExpansionControls({
	binding,
	scene,
	motion,
	profile,
}: {
	readonly binding: MotionGrammarBinding;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly profile?: MotionGrammarAuthoringProfileDescriptor;
}) {
	const [expanded, setExpanded] = useState(false);
	const [sampleStepFrames, setSampleStepFrames] = useState(1);
	const [sourceDisposition, setSourceDisposition] =
		useState<MotionGrammarExpansionSourceDisposition>("remove");
	const [lastExpansionTitle, setLastExpansionTitle] = useState<string | null>(
		null,
	);

	const preview = useMemo(
		() =>
			createMotionGrammarExpansionPreview({
				binding,
				scene,
				motion,
				profile,
				sampleStepFrames,
				sourceDisposition,
			}),
		[binding, scene, motion, profile, sampleStepFrames, sourceDisposition],
	);
	const expansionRequest = createMotionGrammarEditableExpansionRequest(preview);
	const visibleIssues = preview.issueItems.slice(0, 4);
	const hiddenIssueCount = preview.issueItems.length - visibleIssues.length;
	const setNormalizedSampleStep = (value: number) => {
		setSampleStepFrames(normalizeMotionGrammarExpansionSampleStep(value));
		setLastExpansionTitle(null);
	};
	const dispositionTitle = preview.sourceDispositionTitle;
	const expansionButtonTitle = lastExpansionTitle ?? preview.bakeButtonTitle;
	const commitExpansion = () => {
		const result = commitCreateMotionGrammarEditableExpansion({
			binding,
			scene,
			motion,
			preview,
		});
		const totalTrackCount =
			result.status === "committed"
				? result.scalarTrackCount +
					result.snapshotTrackCount +
					result.automationTrackCount
				: 0;
		setLastExpansionTitle(
			result.status === "committed"
				? `Created ${result.generatedNodeCount} node(s), ${totalTrackCount} track(s), ${result.clipCount} clip(s), and ${result.editableArtifactCount} artifact(s).`
				: `Editable expansion blocked: ${result.blockerLabels.join("; ")}`,
		);
	};

	return (
		<div className="rounded-md border border-white/8 bg-surface-sunken/70 p-1.5 text-ui">
			<div className="grid grid-cols-[minmax(0,1fr)_minmax(4rem,auto)] gap-1">
				<button
					type="button"
					aria-expanded={expanded}
					title={preview.expansion.description}
					onClick={() => setExpanded((current) => !current)}
					className={actionButtonClass}
				>
					{expanded ? (
						<CaretDown aria-hidden="true" size={10} />
					) : (
						<CaretRight aria-hidden="true" size={10} />
					)}
					<ArrowsOutSimple aria-hidden="true" size={11} />
					<span className="truncate">{preview.expansion.previewLabel}</span>
				</button>
				<button
					type="button"
					disabled={expansionRequest.status === "blocked"}
					title={expansionButtonTitle}
					onClick={commitExpansion}
					className={cn(
						actionButtonClass,
						expansionRequest.status === "ready" &&
							"border-accent/50 bg-accent-surface text-accent-fg",
					)}
				>
					<FloppyDisk aria-hidden="true" size={11} />
					<span className="truncate">{preview.expansion.actionLabel}</span>
				</button>
			</div>
			<div
				className="mt-1 truncate text-fg-muted text-ui leading-3"
				title={preview.expansion.outputSummary}
			>
				{preview.expansion.label}
			</div>

			<div className="mt-1 grid grid-cols-4 gap-1">
				{preview.estimateItems.slice(0, 3).map((item) => (
					<div
						key={item.label}
						className="min-w-0 rounded border border-white/8 bg-black/20 px-1 py-0.5 text-center"
						title={item.title}
					>
						<div className="truncate font-mono text-fg leading-3">
							{item.value}
						</div>
						<div className="truncate text-fg-muted leading-3">{item.label}</div>
					</div>
				))}
				<div
					className={cn(
						"min-w-0 rounded border px-1 py-0.5 text-center leading-3",
						preview.canBake
							? "border-accent/30 bg-accent-surface text-accent-fg"
							: "border-warn/35 bg-warn-surface text-warn-fg",
					)}
					title={expansionButtonTitle}
				>
					<div className="truncate font-medium">{preview.bakeStatusLabel}</div>
					<div className="truncate text-ui leading-3">Output</div>
				</div>
			</div>

			{expanded ? (
				<div className="mt-1.5 space-y-1.5">
					<div className="grid grid-cols-2 gap-1">
						<div
							className="min-w-0 rounded border border-white/8 bg-black/20 px-1.5 py-1"
							title="Decomposition frame range"
						>
							<div className="truncate text-fg-muted leading-3">Range</div>
							<div className="truncate font-mono text-fg leading-3">
								{preview.frameRangeLabel}
							</div>
						</div>
						<label className="grid min-w-0 grid-cols-[minmax(0,1fr)_3.25rem] items-center gap-1 rounded border border-white/8 bg-black/20 px-1.5 py-1">
							<span className="min-w-0 truncate text-fg-muted leading-3">
								Step
							</span>
							<input
								type="number"
								min={1}
								step={1}
								value={sampleStepFrames}
								onChange={(event) =>
									setNormalizedSampleStep(event.currentTarget.valueAsNumber)
								}
								className="h-5 min-w-0 rounded border border-white/10 bg-black/25 px-1 text-right font-mono text-fg text-ui tabular-nums outline-none transition focus:border-accent/70"
								aria-label="Sample step frames"
								title={`Sample every ${preview.sampleStepLabel}`}
							/>
						</label>
					</div>

					<div className="flex items-center justify-between gap-1">
						<span className="text-fg-muted leading-3">Source</span>
						<div className="grid grid-cols-2 gap-1" title={dispositionTitle}>
							{(["archive", "remove"] as const).map((disposition) => (
								<button
									key={disposition}
									type="button"
									onClick={() => {
										setSourceDisposition(disposition);
										setLastExpansionTitle(null);
									}}
									className={cn(
										segmentButtonClass,
										sourceDisposition === disposition
											? "border-accent/40 bg-accent-surface text-accent-fg"
											: "border-white/10 bg-white/[0.035] text-fg-muted hover:bg-white/10 hover:text-fg",
									)}
								>
									{disposition === "archive" ? "Archive" : "Remove"}
								</button>
							))}
						</div>
					</div>

					<div className="grid grid-cols-4 gap-1">
						{preview.estimateItems.map((item) => (
							<div
								key={item.label}
								className="min-w-0 rounded border border-white/8 bg-black/20 px-1 py-0.5 text-center"
								title={item.title}
							>
								<div className="truncate font-mono text-fg leading-3">
									{item.value}
								</div>
								<div className="truncate text-fg-muted leading-3">
									{item.label}
								</div>
							</div>
						))}
					</div>

					{preview.issueItems.length > 0 ? (
						<div className="flex flex-wrap gap-1">
							{visibleIssues.map((issue) => (
								<ExpansionIssuePill key={issue.key} issue={issue} />
							))}
							{hiddenIssueCount > 0 ? (
								<span
									className="rounded border border-white/8 bg-white/[0.035] px-1 py-0.5 text-fg-muted text-ui leading-3"
									title={preview.issueItems
										.slice(visibleIssues.length)
										.map((issue) => issue.label)
										.join(", ")}
								>
									+{hiddenIssueCount}
								</span>
							) : null}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function LiveMotionOutputNotice({
	profile,
}: {
	readonly profile: MotionGrammarAuthoringProfileDescriptor;
}) {
	return (
		<div
			className="rounded-md border border-warn/30 bg-warn-surface px-1.5 py-1 text-ui"
			title={profile.expansion.description}
		>
			<div className="font-medium text-warn-fg">{profile.expansion.label}</div>
			<div className="mt-0.5 text-fg-muted leading-3">
				{profile.expansion.outputSummary}
			</div>
		</div>
	);
}

function MotionParameterField({
	bindingId,
	spec,
	value,
	onCommitParameter,
}: {
	readonly bindingId: string;
	readonly spec: MotionGrammarParamSpec;
	readonly value: number;
	readonly onCommitParameter?: (key: string, value: number) => unknown;
}) {
	const label = grammarParameterLabel(spec);
	const resetKey = `${bindingId}:${spec.key}`;
	const [draft, setDraft] = useState(() =>
		formatParameterValue(value, spec.step),
	);
	const focusedResetKeyRef = useRef<string | null>(null);
	const cancelNextBlurRef = useRef(false);

	useEffect(() => {
		setDraft(formatParameterValue(value, spec.step));
		cancelNextBlurRef.current = false;
	}, [spec.step, value]);

	const resetDraft = () => setDraft(formatParameterValue(value, spec.step));
	const commitValue = (next: number) => {
		const quantized = quantizeToRange(next, spec.min, spec.max, spec.step);
		setDraft(formatParameterValue(quantized, spec.step));
		if (quantized === value) return;
		const result = onCommitParameter
			? onCommitParameter(spec.key, quantized)
			: commitBindingParameter(bindingId, spec.key, quantized);
		if (isBlockedParameterCommit(result)) resetDraft();
	};
	const commitDraft = () => {
		if (cancelNextBlurRef.current) {
			cancelNextBlurRef.current = false;
			return;
		}
		if (focusedResetKeyRef.current !== resetKey) {
			resetDraft();
			return;
		}
		const raw = draft.trim();
		if (raw === "") {
			resetDraft();
			return;
		}
		const parsed = Number(raw);
		if (!Number.isFinite(parsed)) {
			resetDraft();
			return;
		}
		commitValue(parsed);
	};
	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") {
			event.currentTarget.blur();
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			cancelNextBlurRef.current = true;
			resetDraft();
			event.currentTarget.blur();
			return;
		}
		if (event.repeat) return;
		const nudge = event.shiftKey ? spec.step * 10 : spec.step;
		if (event.key === "ArrowUp") {
			event.preventDefault();
			commitValue(value + nudge);
		} else if (event.key === "ArrowDown") {
			event.preventDefault();
			commitValue(value - nudge);
		}
	};

	// Enum-valued param (e.g. a shape index): a labeled dropdown is clearer than a
	// raw number, and the stored value stays numeric so commands/MCP are unchanged.
	if (spec.options) {
		const onSelectChange = (event: ChangeEvent<HTMLSelectElement>) => {
			const next = Number(event.currentTarget.value);
			if (!Number.isFinite(next) || next === value) return;
			const result = onCommitParameter
				? onCommitParameter(spec.key, next)
				: commitBindingParameter(bindingId, spec.key, next);
			if (isBlockedParameterCommit(result)) resetDraft();
		};
		return (
			<label
				className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(4.75rem,5.75rem)] items-center gap-1.5 text-ui"
				title={label}
			>
				<span className="min-w-0 text-fg-muted leading-3">{label}</span>
				<select
					aria-label={label}
					value={String(value)}
					onChange={onSelectChange}
					className="h-6 w-full rounded-md border border-white/10 bg-black/25 px-1 text-fg text-ui outline-none transition focus:border-accent/70"
				>
					{spec.options.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</select>
			</label>
		);
	}

	return (
		<label
			className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(4.75rem,5.75rem)] items-center gap-1.5 text-ui"
			title={`${label}: ${spec.min}-${spec.max}, step ${spec.step}`}
		>
			<span className="min-w-0 text-fg-muted leading-3">{label}</span>
			<input
				type="text"
				inputMode="decimal"
				role="spinbutton"
				aria-label={label}
				aria-valuemin={spec.min}
				aria-valuemax={spec.max}
				aria-valuenow={value}
				value={draft}
				onChange={(event) => setDraft(event.currentTarget.value)}
				onFocus={(event) => {
					focusedResetKeyRef.current = resetKey;
					cancelNextBlurRef.current = false;
					event.currentTarget.select();
				}}
				onBlur={() => {
					commitDraft();
					focusedResetKeyRef.current = null;
				}}
				onKeyDown={onKeyDown}
				className="h-6 w-full rounded-md border border-white/10 bg-black/25 px-1.5 text-right font-mono text-fg text-ui tabular-nums outline-none transition focus:border-accent/70"
			/>
		</label>
	);
}

function MotionAuthoringProfileGroup({
	binding,
	group,
	defaultOpen,
	onCommitParameter,
}: {
	readonly binding: MotionGrammarBinding;
	readonly group: MotionGrammarAuthoringParameterGroup;
	readonly defaultOpen: boolean;
	readonly onCommitParameter?: (key: string, value: number) => void;
}) {
	const [open, setOpen] = useState(defaultOpen);
	return (
		<div className="rounded-md border border-white/8 bg-surface-sunken/55 p-1 text-ui">
			<button
				type="button"
				aria-expanded={open}
				title={group.intent}
				onClick={() => setOpen((current) => !current)}
				className="flex h-5 w-full min-w-0 items-center justify-between gap-1 rounded px-1 text-fg-muted transition hover:bg-white/10 hover:text-fg"
			>
				<span className="flex min-w-0 items-center gap-1">
					{open ? (
						<CaretDown aria-hidden="true" size={10} />
					) : (
						<CaretRight aria-hidden="true" size={10} />
					)}
					<span className="truncate">{group.label}</span>
				</span>
				<span className="shrink-0 font-mono text-fg-subtle">
					{group.parameters.length}
				</span>
			</button>
			{open ? (
				<div className="mt-1 grid gap-1 px-1 pb-0.5">
					{group.parameters.map((spec) => (
						<MotionParameterField
							key={`${binding.id}:${spec.key}`}
							bindingId={binding.id}
							spec={spec}
							value={binding.parameters[spec.key] ?? spec.default}
							onCommitParameter={onCommitParameter}
						/>
					))}
				</div>
			) : null}
		</div>
	);
}

const profileNumberSpec = (
	key: string,
	label: string,
	value: number,
	min: number,
	max: number,
	step: number,
): MotionGrammarParamSpec => ({
	key,
	label,
	default: value,
	min,
	max,
	step,
});

function MotionProfileEnvelopeControls({
	binding,
	control,
	onCommitEdit,
}: {
	readonly binding: MotionGrammarBinding;
	readonly control: Extract<
		MotionGrammarAuthoringProfileControl,
		{ readonly kind: "random-pulse-envelope" }
	>;
	readonly onCommitEdit?: (
		edit: RandomPulseProfileEdit,
	) =>
		| { readonly status: "updated" }
		| { readonly status: "blocked"; readonly reason: string };
}) {
	const [status, setStatus] = useState<string | null>(null);
	const profile: MotionGrammarRandomPulseProfile =
		binding.randomPulseProfile ?? RANDOM_PULSE_PROFILE_DEFAULT;
	const commit = (edit: RandomPulseProfileEdit): void => {
		if (!onCommitEdit) return;
		const result = onCommitEdit(edit);
		setStatus(result.status === "updated" ? "Envelope updated" : result.reason);
	};
	const lastSegment = profile.segments.at(-1);
	const durationMin = (lastSegment?.fromFrame ?? 0) + 1;

	return (
		<div className="rounded-md border border-white/8 bg-surface-sunken/55 p-1 text-ui">
			<div className="mb-1 px-1">
				<div className="font-medium text-fg-muted">{control.label}</div>
				<div className="text-fg-subtle leading-3" title={control.description}>
					Shared profile; invalid edits are rejected
				</div>
			</div>
			<div className="grid gap-1 px-1">
				<MotionParameterField
					bindingId={`${binding.id}:profile`}
					spec={profileNumberSpec(
						"profileDurationFrames",
						"Profile duration",
						profile.durationFrames,
						durationMin,
						RANDOM_PULSE_PROFILE_MAX_DURATION_FRAMES,
						1,
					)}
					value={profile.durationFrames}
					onCommitParameter={(_, value) =>
						commit({ kind: "durationFrames", value })
					}
				/>
			</div>
			<div className="mt-1 grid gap-1">
				{profile.segments.map((segment, index) => {
					const nextSegment = profile.segments[index + 1];
					const segmentLabel = `Segment ${index + 1}`;
					return (
						<div
							key={`${binding.id}:profile-segment:${segment.fromFrame}:${segment.toFrame}`}
							className="rounded border border-white/8 bg-black/20 p-1"
						>
							<div className="mb-1 flex items-center justify-between gap-1 px-1">
								<span className="font-medium text-fg-muted">
									{segmentLabel}
								</span>
								<span className="font-mono text-fg-subtle">
									{segment.fromFrame}–{segment.toFrame}f
								</span>
							</div>
							<div className="grid gap-1 px-1">
								{nextSegment ? (
									<MotionParameterField
										bindingId={`${binding.id}:profile:${index}`}
										spec={profileNumberSpec(
											`segment-${index}-toFrame`,
											"End frame",
											segment.toFrame,
											segment.fromFrame + 1,
											nextSegment.toFrame - 1,
											1,
										)}
										value={segment.toFrame}
										onCommitParameter={(_, value) =>
											commit({
												kind: "segment",
												index,
												field: "toFrame",
												value,
											})
										}
									/>
								) : null}
								<div className="grid grid-cols-2 gap-1">
									<MotionParameterField
										bindingId={`${binding.id}:profile:${index}:from`}
										spec={profileNumberSpec(
											`segment-${index}-fromValue`,
											"From value",
											segment.fromValue,
											-1,
											2,
											0.01,
										)}
										value={segment.fromValue}
										onCommitParameter={(_, value) =>
											commit({
												kind: "segment",
												index,
												field: "fromValue",
												value,
											})
										}
									/>
									<MotionParameterField
										bindingId={`${binding.id}:profile:${index}:to`}
										spec={profileNumberSpec(
											`segment-${index}-toValue`,
											"To value",
											segment.toValue,
											-1,
											2,
											0.01,
										)}
										value={segment.toValue}
										onCommitParameter={(_, value) =>
											commit({
												kind: "segment",
												index,
												field: "toValue",
												value,
											})
										}
									/>
								</div>
								<div className="grid grid-cols-2 gap-1">
									<MotionParameterField
										bindingId={`${binding.id}:profile:${index}:p1x`}
										spec={profileNumberSpec(
											`segment-${index}-easingP1X`,
											"Ease P1 X",
											segment.easing[0],
											0,
											1,
											0.01,
										)}
										value={segment.easing[0]}
										onCommitParameter={(_, value) =>
											commit({
												kind: "segment",
												index,
												field: "easingP1X",
												value,
											})
										}
									/>
									<MotionParameterField
										bindingId={`${binding.id}:profile:${index}:p1y`}
										spec={profileNumberSpec(
											`segment-${index}-easingP1Y`,
											"Ease P1 Y",
											segment.easing[1],
											0,
											1,
											0.01,
										)}
										value={segment.easing[1]}
										onCommitParameter={(_, value) =>
											commit({
												kind: "segment",
												index,
												field: "easingP1Y",
												value,
											})
										}
									/>
								</div>
								<div className="grid grid-cols-2 gap-1">
									<MotionParameterField
										bindingId={`${binding.id}:profile:${index}:p2x`}
										spec={profileNumberSpec(
											`segment-${index}-easingP2X`,
											"Ease P2 X",
											segment.easing[2],
											0,
											1,
											0.01,
										)}
										value={segment.easing[2]}
										onCommitParameter={(_, value) =>
											commit({
												kind: "segment",
												index,
												field: "easingP2X",
												value,
											})
										}
									/>
									<MotionParameterField
										bindingId={`${binding.id}:profile:${index}:p2y`}
										spec={profileNumberSpec(
											`segment-${index}-easingP2Y`,
											"Ease P2 Y",
											segment.easing[3],
											0,
											1,
											0.01,
										)}
										value={segment.easing[3]}
										onCommitParameter={(_, value) =>
											commit({
												kind: "segment",
												index,
												field: "easingP2Y",
												value,
											})
										}
									/>
								</div>
							</div>
						</div>
					);
				})}
			</div>
			{status ? (
				<div className="mt-1 truncate px-1 text-fg-muted" title={status}>
					{status}
				</div>
			) : null}
		</div>
	);
}

function MotionSystemMapBadges({
	map,
}: {
	readonly map: MotionGrammarSystemMap;
}) {
	return (
		<div className="grid gap-1">
			{map.buckets.map((bucket) => (
				<div
					key={bucket.id}
					className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1 rounded border border-white/8 bg-black/20 px-1.5 py-1 text-ui"
					title={bucket.summary}
				>
					<div className="min-w-0">
						<div className="truncate text-fg leading-3">{bucket.label}</div>
						<div className="truncate text-fg-muted leading-3">
							{bucket.replaceableCount > 0
								? `${bucket.replaceableCount} replaceable`
								: bucket.runtimeOnly
									? "runtime only"
									: "support role"}
						</div>
					</div>
					<div className="rounded border border-white/8 bg-white/[0.04] px-1.5 py-0.5 text-center">
						<div className="font-mono text-fg leading-3">{bucket.count}</div>
						<div className="text-fg-muted leading-3">{bucket.shortLabel}</div>
					</div>
					<div className="rounded border border-white/8 bg-white/[0.04] px-1.5 py-0.5 text-center">
						<div className="font-mono text-fg leading-3">
							{bucket.editableCount}
						</div>
						<div className="text-fg-muted leading-3">Edit</div>
					</div>
				</div>
			))}
		</div>
	);
}

function MotionProfileTimingTemplates({
	profile,
}: {
	readonly profile: MotionGrammarAuthoringProfileDescriptor;
}) {
	const timingTemplates =
		profile.timingTemplates?.flatMap((item) => {
			const template = findMotionTimingTemplate(item.templateId);
			return template ? [{ item, template }] : [];
		}) ?? [];
	if (timingTemplates.length === 0) return null;
	return (
		<div className="rounded-md border border-white/8 bg-black/20 p-1 text-ui">
			<div className="mb-1 flex h-5 items-center justify-between gap-1 px-1">
				<span className="truncate font-medium text-fg-muted">Timing</span>
				<span className="shrink-0 font-mono text-fg-subtle">
					{timingTemplates.length}
				</span>
			</div>
			<div className="grid gap-1">
				{timingTemplates.map(({ item, template }) => (
					<div
						key={`${profile.bindingId}:${item.templateId}:${item.role}`}
						className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-1.5 rounded border border-white/8 bg-white/[0.035] px-1.5 py-1"
						title={`${template.uiLabel}: ${template.intent} ${item.note}`}
					>
						<TimingTemplateSparkline template={template} />
						<div className="min-w-0">
							<div className="truncate text-fg leading-3">
								{template.uiLabel}
							</div>
							<div className="truncate text-fg-muted leading-3">
								{item.role}
							</div>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

function ClipPhraseTimingControls({ clip }: { readonly clip: AnimationClip }) {
	const templates = motionTimingTemplatesForKeyframeSegment();
	return (
		<div className="rounded-md border border-white/8 bg-black/20 p-1 text-ui">
			<div className="mb-1 px-1 font-medium text-fg-muted">Phrase timing</div>
			<div className="grid grid-cols-2 gap-1">
				{templates.map((template) => (
					<button
						key={template.id}
						type="button"
						className={actionButtonClass}
						title={`Apply ${template.uiLabel} to every segment in ${clip.name}`}
						onClick={() =>
							useMotionStore
								.getState()
								.apply(applyAnimationClipTimingTemplate(clip.id, template.id))
						}
					>
						<TimingTemplateSparkline template={template} />
						<span className="truncate">{template.uiLabel}</span>
					</button>
				))}
			</div>
		</div>
	);
}

function MotionAuthoringProfileControls({
	binding,
	profile,
	showSystemMap = true,
	onCommitParameter,
	onCommitProfileEdit,
}: {
	readonly binding: MotionGrammarBinding;
	readonly profile: MotionGrammarAuthoringProfileDescriptor;
	readonly showSystemMap?: boolean;
	readonly onCommitParameter?: (key: string, value: number) => void;
	readonly onCommitProfileEdit?: (
		edit: RandomPulseProfileEdit,
	) =>
		| { readonly status: "updated" }
		| { readonly status: "blocked"; readonly reason: string };
}) {
	const systemMap = buildMotionGrammarSystemMap(profile);
	const defaultOpenGroups = new Set(["timing", "layout"]);
	return (
		<div className="rounded-md border border-white/8 bg-surface-sunken/70 p-1.5 text-ui">
			<div className="grid grid-cols-3 gap-1">
				<div
					className="min-w-0 rounded border border-white/8 bg-black/20 px-1 py-0.5 text-center"
					title={profile.summary}
				>
					<div className="truncate font-medium text-fg leading-3">
						{motionGrammarAuthoringTimelineLabel(profile.timeline.mode)}
					</div>
					<div className="truncate text-fg-muted leading-3">Timeline</div>
				</div>
				<div
					className="min-w-0 rounded border border-white/8 bg-black/20 px-1 py-0.5 text-center"
					title={`${systemMap.replaceableSlots} replaceable objects out of ${systemMap.totalSlots} profile components`}
				>
					<div className="truncate font-mono text-fg leading-3">
						{systemMap.replaceableSlots}/{systemMap.totalSlots}
					</div>
					<div className="truncate text-fg-muted leading-3">Replace</div>
				</div>
				<div
					className="min-w-0 rounded border border-white/8 bg-black/20 px-1 py-0.5 text-center"
					title="Scalar keyframes are authored only through an explicit bake command."
				>
					<div className="truncate font-medium text-fg leading-3">
						{motionGrammarAuthoringBakeLabel(profile.timeline.bakePolicy)}
					</div>
					<div className="truncate text-fg-muted leading-3">Output</div>
				</div>
			</div>
			<div className="mt-1.5 grid gap-1">
				{showSystemMap ? <MotionSystemMapBadges map={systemMap} /> : null}
				{profile.seedControl ? (
					<div className="rounded-md border border-white/8 bg-surface-sunken/55 p-1 text-ui">
						<div className="mb-1 px-1 font-medium text-fg-muted">
							Randomization
						</div>
						<MotionParameterField
							bindingId={binding.id}
							spec={profile.seedControl}
							value={binding.seed ?? profile.seedControl.default}
							onCommitParameter={onCommitParameter}
						/>
					</div>
				) : null}
				<MotionProfileTimingTemplates profile={profile} />
				{profile.parameterGroups.map((group) => (
					<MotionAuthoringProfileGroup
						key={`${profile.bindingId}:${group.id}`}
						binding={binding}
						group={group}
						defaultOpen={defaultOpenGroups.has(group.id)}
						onCommitParameter={onCommitParameter}
					/>
				))}
				{profile.profileControls?.map((control) =>
					control.kind === "random-pulse-envelope" ? (
						<MotionProfileEnvelopeControls
							key={`${profile.bindingId}:profile-control:${control.kind}`}
							binding={binding}
							control={control}
							onCommitEdit={onCommitProfileEdit}
						/>
					) : null,
				)}
			</div>
		</div>
	);
}

function commitMotionSystemClipRange({
	clip,
	field,
	value,
}: {
	readonly clip: AnimationClip;
	readonly field: "startFrame" | "durationFrames";
	readonly value: number;
}): void {
	commitMotionSystemClipRetime({
		clipId: clip.id,
		range: {
			startFrame: field === "startFrame" ? value : clip.startFrame,
			durationFrames: field === "durationFrames" ? value : clip.durationFrames,
		},
		label:
			field === "startFrame" ? "Move motion system" : "Retime motion system",
	});
}

function MotionSystemClipField({
	label,
	value,
	min,
	max,
	onCommit,
}: {
	readonly label: string;
	readonly value: number;
	readonly min: number;
	readonly max: number;
	readonly onCommit: (value: number) => void;
}) {
	const [draft, setDraft] = useState(String(value));
	const resetKey = `${label}:${value}`;
	const focusedResetKeyRef = useRef<string | null>(null);

	useEffect(() => {
		if (focusedResetKeyRef.current === resetKey) return;
		setDraft(String(value));
	}, [resetKey, value]);

	const resetDraft = () => setDraft(String(value));
	const commitDraft = () => {
		if (focusedResetKeyRef.current !== resetKey) {
			resetDraft();
			return;
		}
		const parsed = Number(draft.trim());
		if (!Number.isFinite(parsed)) {
			resetDraft();
			return;
		}
		const normalized = Math.min(Math.max(Math.round(parsed), min), max);
		setDraft(String(normalized));
		if (normalized !== value) onCommit(normalized);
	};

	return (
		<label className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(4.75rem,5.75rem)] items-center gap-1.5 text-ui">
			<span className="min-w-0 text-fg-muted leading-3">{label}</span>
			<input
				type="text"
				inputMode="numeric"
				role="spinbutton"
				aria-label={label}
				aria-valuemin={min}
				aria-valuemax={max}
				aria-valuenow={value}
				value={draft}
				onChange={(event) => setDraft(event.currentTarget.value)}
				onFocus={(event) => {
					focusedResetKeyRef.current = resetKey;
					event.currentTarget.select();
				}}
				onBlur={() => {
					commitDraft();
					focusedResetKeyRef.current = null;
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.currentTarget.blur();
						return;
					}
					if (event.key === "Escape") {
						event.preventDefault();
						resetDraft();
						event.currentTarget.blur();
					}
				}}
				className="h-6 w-full rounded-md border border-white/10 bg-black/25 px-1.5 text-right font-mono text-fg text-ui tabular-nums outline-none transition focus:border-accent/70"
			/>
		</label>
	);
}

function MotionSystemClipControls({
	clip,
	motion,
}: {
	readonly clip: AnimationClip;
	readonly motion: MotionDocument;
}) {
	const maxStartFrame = Math.max(0, motion.durationFrames - 1);
	const maxDurationFrames = Math.max(
		1,
		motion.durationFrames - clip.startFrame,
	);
	return (
		<div className="rounded-md border border-accent/20 bg-accent-surface/25 p-1.5 text-ui">
			<div className="mb-1 grid grid-cols-3 gap-1">
				<div className="min-w-0 rounded border border-white/8 bg-black/20 px-1 py-0.5 text-center">
					<div className="truncate font-medium text-fg leading-3">
						{clip.name}
					</div>
					<div className="truncate text-fg-muted leading-3">Clip</div>
				</div>
				<div className="min-w-0 rounded border border-white/8 bg-black/20 px-1 py-0.5 text-center">
					<div className="truncate font-mono text-fg leading-3">
						{clip.startFrame}f
					</div>
					<div className="truncate text-fg-muted leading-3">Start</div>
				</div>
				<div className="min-w-0 rounded border border-white/8 bg-black/20 px-1 py-0.5 text-center">
					<div className="truncate font-mono text-fg leading-3">
						{clip.durationFrames}f
					</div>
					<div className="truncate text-fg-muted leading-3">Duration</div>
				</div>
			</div>
			<div className="grid gap-1">
				<MotionSystemClipField
					label="Start"
					value={clip.startFrame}
					min={0}
					max={maxStartFrame}
					onCommit={(value) =>
						commitMotionSystemClipRange({
							clip,
							field: "startFrame",
							value,
						})
					}
				/>
				<MotionSystemClipField
					label="Duration"
					value={clip.durationFrames}
					min={1}
					max={maxDurationFrames}
					onCommit={(value) =>
						commitMotionSystemClipRange({
							clip,
							field: "durationFrames",
							value,
						})
					}
				/>
			</div>
		</div>
	);
}

function MotionSystemSourceControls({
	binding,
	scene,
	profile,
	onClearSystemClip,
}: {
	readonly binding: MotionGrammarBinding;
	readonly scene: SceneDocument;
	readonly profile: MotionGrammarAuthoringProfileDescriptor;
	readonly onClearSystemClip?: () => void;
}) {
	const sourceSummary = motionGrammarAuthoringSourceSummary({
		binding,
		profile,
	});
	const systemMap = buildMotionGrammarSystemMap(profile);
	const sourceNodes = sourceSummary.ids
		.map((nodeId) => findNode(scene, nodeId))
		.filter((node) => node !== undefined);
	const missingCount = sourceSummary.boundCount - sourceNodes.length;
	const nodeNames = sourceNodes.map((node) => node.name).join(", ");
	const selectSources = (): void => {
		if (sourceNodes.length === 0) return;
		useSelectionStore.getState().setSelection(
			sourceNodes.map((node) => node.id),
			sourceNodes.at(-1)?.id ?? null,
		);
		onClearSystemClip?.();
	};

	return (
		<div className="rounded-md border border-white/8 bg-surface-sunken/70 p-1.5 text-ui">
			<div className="mb-1 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1">
				<div className="min-w-0">
					<div className="truncate text-fg leading-3">
						{sourceSummary.label}
					</div>
					<div className="truncate text-fg-muted leading-3" title={nodeNames}>
						{sourceNodes.length} live{" "}
						{sourceNodes.length === 1 ? "object" : "objects"}
						{missingCount > 0 ? ` / ${missingCount} missing` : ""}
					</div>
				</div>
				<button
					type="button"
					disabled={sourceNodes.length === 0}
					title={
						sourceNodes.length > 0
							? `Select ${sourceSummary.label.toLowerCase()}: ${nodeNames}`
							: `No ${sourceSummary.label.toLowerCase()} found`
					}
					onClick={selectSources}
					className={actionButtonClass}
				>
					<ArrowsOutSimple aria-hidden="true" size={11} />
					<span className="truncate">Select</span>
				</button>
			</div>
			<MotionSystemMapBadges map={systemMap} />
		</div>
	);
}

const commitGrammarBindingPatch = (
	bindingId: string,
	patch: MotionGrammarBindingPatch,
): void => {
	useMotionGrammarStore
		.getState()
		.apply(updateGrammarBinding(bindingId, patch));
};

const finiteInputValue = (value: number, fallback: number): number =>
	Number.isFinite(value) ? value : fallback;

const replaceRole = (
	binding: MotionGrammarBinding,
	nodeId: string,
	role: string,
): void => {
	const nextRoleMap = { ...(binding.roleMap ?? {}) };
	const normalized = role.trim();
	if (normalized) nextRoleMap[nodeId] = normalized;
	else delete nextRoleMap[nodeId];
	commitGrammarBindingPatch(binding.id, {
		roleMap: Object.keys(nextRoleMap).length > 0 ? nextRoleMap : null,
	});
};

const defaultEffectBinding = (
	kind: MotionGrammarEffectBinding["kind"],
): MotionGrammarEffectBinding => {
	switch (kind) {
		case "none":
			return { kind };
		case "active-target-influence":
			return {
				kind,
				effect: { id: "effect", path: "recipe.glow.intensity" },
				targetScope: "object",
				strength: 1,
			};
		case "automation-param":
			return {
				kind,
				effect: { id: "effect", path: "recipe.glow.intensity" },
				path: "intensity",
				mode: "replace",
			};
		case "temporal-echo":
			return { kind, copies: 3, delayFrames: 5, decay: 0.62 };
	}
};

function GrammarEffectBindingEditor({
	binding,
}: {
	readonly binding: MotionGrammarBinding;
}) {
	const effect = binding.effectBinding ?? { kind: "none" as const };
	const commit = (next: MotionGrammarEffectBinding) =>
		commitGrammarBindingPatch(binding.id, { effectBinding: next });
	const inputClass =
		"h-6 min-w-0 rounded-md border border-white/10 bg-black/25 px-1.5 text-fg text-ui outline-none transition focus:border-accent/70";
	return (
		<div className="grid gap-1 rounded-md border border-white/8 bg-black/20 p-1.5 text-ui">
			<label className="grid grid-cols-[minmax(0,1fr)_minmax(7rem,9rem)] items-center gap-1.5">
				<span className="text-fg-muted">Effect binding</span>
				<select
					value={effect.kind}
					onChange={(event) =>
						commit(
							defaultEffectBinding(
								event.currentTarget.value as MotionGrammarEffectBinding["kind"],
							),
						)
					}
					className={inputClass}
				>
					<option value="none">None</option>
					<option value="active-target-influence">Target influence</option>
					<option value="automation-param">Automation parameter</option>
					<option value="temporal-echo">Temporal echo</option>
				</select>
			</label>
			{effect.kind === "active-target-influence" ||
			effect.kind === "automation-param" ? (
				<>
					<label className="grid grid-cols-[minmax(0,1fr)_minmax(7rem,9rem)] items-center gap-1.5">
						<span className="text-fg-muted">Effect id</span>
						<input
							value={effect.effect.id}
							onChange={(event) =>
								commit({
									...effect,
									effect: { ...effect.effect, id: event.currentTarget.value },
								})
							}
							className={inputClass}
						/>
					</label>
					<label className="grid grid-cols-[minmax(0,1fr)_minmax(7rem,9rem)] items-center gap-1.5">
						<span className="text-fg-muted">Effect path</span>
						<input
							value={effect.effect.path}
							onChange={(event) =>
								commit({
									...effect,
									effect: { ...effect.effect, path: event.currentTarget.value },
								})
							}
							className={inputClass}
						/>
					</label>
				</>
			) : null}
			{effect.kind === "active-target-influence" ? (
				<>
					<label className="grid grid-cols-[minmax(0,1fr)_minmax(7rem,9rem)] items-center gap-1.5">
						<span className="text-fg-muted">Target scope</span>
						<select
							value={effect.targetScope ?? "object"}
							onChange={(event) =>
								commit({
									...effect,
									targetScope: event.currentTarget.value as NonNullable<
										typeof effect.targetScope
									>,
								})
							}
							className={inputClass}
						>
							{["scene", "selection", "group", "object", "layer"].map(
								(scope) => (
									<option key={scope} value={scope}>
										{scope}
									</option>
								),
							)}
						</select>
					</label>
					<label className="grid grid-cols-[minmax(0,1fr)_minmax(7rem,9rem)] items-center gap-1.5">
						<span className="text-fg-muted">Strength</span>
						<input
							type="number"
							step={0.05}
							value={effect.strength ?? 1}
							onChange={(event) =>
								commit({
									...effect,
									strength: finiteInputValue(
										event.currentTarget.valueAsNumber,
										effect.strength ?? 1,
									),
								})
							}
							className={inputClass}
						/>
					</label>
				</>
			) : null}
			{effect.kind === "automation-param" ? (
				<>
					<label className="grid grid-cols-[minmax(0,1fr)_minmax(7rem,9rem)] items-center gap-1.5">
						<span className="text-fg-muted">Parameter path</span>
						<input
							value={effect.path}
							onChange={(event) =>
								commit({ ...effect, path: event.currentTarget.value })
							}
							className={inputClass}
						/>
					</label>
					<label className="grid grid-cols-[minmax(0,1fr)_minmax(7rem,9rem)] items-center gap-1.5">
						<span className="text-fg-muted">Mode</span>
						<select
							value={effect.mode ?? "replace"}
							onChange={(event) =>
								commit({
									...effect,
									mode: event.currentTarget.value as "additive" | "replace",
								})
							}
							className={inputClass}
						>
							<option value="replace">Replace</option>
							<option value="additive">Additive</option>
						</select>
					</label>
				</>
			) : null}
			{effect.kind === "temporal-echo" ? (
				<div className="grid grid-cols-3 gap-1">
					{(
						[
							["Copies", "copies", 1],
							["Delay", "delayFrames", 1],
							["Decay", "decay", 0.01],
						] as const
					).map(([label, key, step]) => (
						<label key={key} className="grid gap-0.5 text-fg-muted">
							<span>{label}</span>
							<input
								type="number"
								step={step}
								value={effect[key]}
								onChange={(event) =>
									commit({
										...effect,
										[key]: finiteInputValue(
											event.currentTarget.valueAsNumber,
											effect[key],
										),
									})
								}
								className={inputClass}
							/>
						</label>
					))}
				</div>
			) : null}
		</div>
	);
}

function ArrangementMappingEditor({
	binding,
	scene,
}: {
	readonly binding: MotionGrammarBinding;
	readonly scene: SceneDocument;
}) {
	const snapshots = scene.arrangementLayoutSnapshots ?? [];
	const [sourceSnapshotId, setSourceSnapshotId] = useState(
		binding.arrangementMapping?.sourceSnapshotId ?? snapshots[0]?.id ?? "",
	);
	const [destinationSnapshotId, setDestinationSnapshotId] = useState(
		binding.arrangementMapping?.destinationSnapshotId ?? snapshots[1]?.id ?? "",
	);
	const [status, setStatus] = useState<string | null>(null);
	const mapping = binding.arrangementMapping;
	const inputClass =
		"h-6 min-w-0 rounded-md border border-white/10 bg-black/25 px-1 text-fg text-ui outline-none transition focus:border-accent/70";
	const updateMapping = (next: NonNullable<typeof mapping>) =>
		commitGrammarBindingPatch(binding.id, { arrangementMapping: next });
	const buildMapping = () => {
		const source = snapshots.find(
			(snapshot) => snapshot.id === sourceSnapshotId,
		);
		const destination = snapshots.find(
			(snapshot) => snapshot.id === destinationSnapshotId,
		);
		if (!source || !destination) {
			setStatus("Choose source and destination snapshots.");
			return;
		}
		const plan = createArrangementMappingAuthoringPlan({ source, destination });
		if (plan.status === "blocked") {
			setStatus(plan.reason);
			return;
		}
		commitGrammarBindingPatch(binding.id, {
			targetIds: plan.targetIds,
			arrangementMapping: plan.mapping,
		});
		setStatus("Arrangement correspondence created.");
	};
	return (
		<div className="grid gap-1 rounded-md border border-white/8 bg-black/20 p-1.5 text-ui">
			<div className="font-medium text-fg-muted">Arrangement mapping</div>
			<div className="grid grid-cols-2 gap-1">
				<select
					aria-label="Source arrangement snapshot"
					value={sourceSnapshotId}
					onChange={(event) => setSourceSnapshotId(event.currentTarget.value)}
					className={inputClass}
				>
					<option value="">Source</option>
					{snapshots.map((snapshot) => (
						<option key={snapshot.id} value={snapshot.id}>
							{snapshot.name}
						</option>
					))}
				</select>
				<select
					aria-label="Destination arrangement snapshot"
					value={destinationSnapshotId}
					onChange={(event) =>
						setDestinationSnapshotId(event.currentTarget.value)
					}
					className={inputClass}
				>
					<option value="">Destination</option>
					{snapshots.map((snapshot) => (
						<option key={snapshot.id} value={snapshot.id}>
							{snapshot.name}
						</option>
					))}
				</select>
			</div>
			<div className="grid grid-cols-2 gap-1">
				<button
					type="button"
					onClick={buildMapping}
					className={actionButtonClass}
				>
					Build correspondence
				</button>
				<button
					type="button"
					disabled={!mapping}
					onClick={() =>
						commitGrammarBindingPatch(binding.id, {
							arrangementMapping: null,
						})
					}
					className={actionButtonClass}
				>
					Clear mapping
				</button>
			</div>
			{mapping ? (
				<>
					<div className="grid grid-cols-2 gap-1">
						{(["x", "y"] as const).map((axis) => (
							<label key={axis} className="grid gap-0.5 text-fg-muted">
								<span>Pivot {axis.toUpperCase()}</span>
								<input
									type="number"
									value={mapping.pivot[axis]}
									onChange={(event) =>
										updateMapping({
											...mapping,
											pivot: {
												...mapping.pivot,
												[axis]: finiteInputValue(
													event.currentTarget.valueAsNumber,
													mapping.pivot[axis],
												),
											},
										})
									}
									className={inputClass}
								/>
							</label>
						))}
					</div>
					{Object.entries(mapping.stageSlots).map(([slotId, point]) => {
						const sourceId = Object.entries(mapping.sourceToStage).find(
							([, candidateSlotId]) => candidateSlotId === slotId,
						)?.[0];
						return (
							<div
								key={slotId}
								className="grid gap-1 rounded border border-white/8 p-1"
							>
								<div className="truncate text-fg-muted">
									{sourceId
										? (findNode(scene, sourceId)?.name ?? sourceId)
										: slotId}
								</div>
								<div className="grid grid-cols-3 gap-1">
									{(["x", "y"] as const).map((axis) => (
										<input
											key={axis}
											aria-label={`${slotId} ${axis}`}
											type="number"
											value={point[axis]}
											onChange={(event) =>
												updateMapping({
													...mapping,
													stageSlots: {
														...mapping.stageSlots,
														[slotId]: {
															...point,
															[axis]: finiteInputValue(
																event.currentTarget.valueAsNumber,
																point[axis],
															),
														},
													},
												})
											}
											className={inputClass}
										/>
									))}
									<input
										aria-label={`${slotId} delay`}
										type="number"
										min={0}
										max={1}
										step={0.01}
										value={
											sourceId
												? (mapping.stagingDelayFractionBySource?.[sourceId] ??
													0)
												: 0
										}
										onChange={(event) => {
											if (!sourceId) return;
											updateMapping({
												...mapping,
												stagingDelayFractionBySource: {
													...(mapping.stagingDelayFractionBySource ?? {}),
													[sourceId]: finiteInputValue(
														event.currentTarget.valueAsNumber,
														mapping.stagingDelayFractionBySource?.[sourceId] ??
															0,
													),
												},
											});
										}}
										className={inputClass}
									/>
								</div>
							</div>
						);
					})}
				</>
			) : null}
			{status ? <div className="truncate text-fg-muted">{status}</div> : null}
		</div>
	);
}

function GrammarBindingEditor({
	binding,
	bindingIndex,
	bindingCount,
	scene,
}: {
	readonly binding: MotionGrammarBinding;
	readonly bindingIndex: number;
	readonly bindingCount: number;
	readonly scene: SceneDocument;
}) {
	const [open, setOpen] = useState(false);
	const nodes = allNodes(scene);
	const unusedNodes = nodes.filter(
		(node) => !binding.targetIds.includes(node.id),
	);
	const moveTarget = (fromIndex: number, toIndex: number) => {
		const next = [...binding.targetIds];
		const [nodeId] = next.splice(fromIndex, 1);
		if (!nodeId) return;
		next.splice(toIndex, 0, nodeId);
		commitGrammarBindingPatch(binding.id, { targetIds: next });
	};
	return (
		<div className="rounded-md border border-white/8 bg-surface-sunken/70 p-1.5 text-ui">
			<div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1">
				<button
					type="button"
					aria-expanded={open}
					onClick={() => setOpen((value) => !value)}
					className={actionButtonClass}
				>
					{open ? <CaretDown size={10} /> : <CaretRight size={10} />}
					<span className="truncate">Binding & roles</span>
				</button>
				<button
					type="button"
					disabled={bindingIndex <= 0}
					onClick={() =>
						useMotionGrammarStore
							.getState()
							.apply(reorderGrammarBinding(binding.id, bindingIndex - 1))
					}
					className={actionButtonClass}
				>
					Up
				</button>
				<button
					type="button"
					disabled={bindingIndex >= bindingCount - 1}
					onClick={() =>
						useMotionGrammarStore
							.getState()
							.apply(reorderGrammarBinding(binding.id, bindingIndex + 1))
					}
					className={actionButtonClass}
				>
					Down
				</button>
			</div>
			{open ? (
				<div className="mt-1.5 grid gap-1.5">
					{binding.targetIds.map((nodeId, index) => (
						<div
							key={nodeId}
							className="grid gap-1 rounded border border-white/8 p-1"
						>
							<div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-1">
								<select
									aria-label={`Target ${index + 1}`}
									value={nodeId}
									onChange={(event) => {
										const next = [...binding.targetIds];
										next[index] = event.currentTarget.value;
										commitGrammarBindingPatch(binding.id, { targetIds: next });
									}}
									className="h-6 min-w-0 rounded-md border border-white/10 bg-black/25 px-1 text-fg text-ui"
								>
									{nodes.map((node) => (
										<option
											key={node.id}
											value={node.id}
											disabled={
												node.id !== nodeId &&
												binding.targetIds.includes(node.id)
											}
										>
											{node.name}
										</option>
									))}
								</select>
								<button
									type="button"
									disabled={index === 0}
									onClick={() => moveTarget(index, index - 1)}
									className={iconButtonClass}
								>
									↑
								</button>
								<button
									type="button"
									disabled={index === binding.targetIds.length - 1}
									onClick={() => moveTarget(index, index + 1)}
									className={iconButtonClass}
								>
									↓
								</button>
								<button
									type="button"
									disabled={binding.targetIds.length <= 1}
									onClick={() => {
										const nextRoleMap = { ...(binding.roleMap ?? {}) };
										delete nextRoleMap[nodeId];
										commitGrammarBindingPatch(binding.id, {
											targetIds: binding.targetIds.filter(
												(_, candidate) => candidate !== index,
											),
											roleMap:
												Object.keys(nextRoleMap).length > 0
													? nextRoleMap
													: null,
										});
									}}
									className={iconButtonClass}
								>
									<Trash size={10} />
								</button>
							</div>
							<input
								key={`${binding.id}:${nodeId}:${binding.roleMap?.[nodeId] ?? ""}`}
								aria-label={`Role for ${findNode(scene, nodeId)?.name ?? nodeId}`}
								defaultValue={binding.roleMap?.[nodeId] ?? ""}
								placeholder="Semantic role"
								onBlur={(event) =>
									replaceRole(binding, nodeId, event.currentTarget.value)
								}
								className="h-6 min-w-0 rounded-md border border-white/10 bg-black/25 px-1.5 text-fg text-ui"
							/>
						</div>
					))}
					<select
						aria-label="Add motion grammar target"
						value=""
						disabled={unusedNodes.length === 0}
						onChange={(event) => {
							if (!event.currentTarget.value) return;
							commitGrammarBindingPatch(binding.id, {
								targetIds: [...binding.targetIds, event.currentTarget.value],
							});
						}}
						className="h-6 rounded-md border border-white/10 bg-black/25 px-1.5 text-fg text-ui"
					>
						<option value="">Add target…</option>
						{unusedNodes.map((node) => (
							<option key={node.id} value={node.id}>
								{node.name}
							</option>
						))}
					</select>
					<GrammarEffectBindingEditor binding={binding} />
					{binding.techniqueId === "arrangement-transition" ? (
						<ArrangementMappingEditor binding={binding} scene={scene} />
					) : null}
				</div>
			) : null}
		</div>
	);
}

export function MotionTechniqueSection({
	nodeIds,
	systemClip,
	onClearSystemClip,
}: {
	readonly nodeIds: readonly string[];
	readonly systemClip?: AnimationClip;
	readonly onClearSystemClip?: () => void;
}) {
	const defaultTechniqueId = defaultTechniqueIdForTargetCount(nodeIds.length);
	const [selectedTechniqueId, setSelectedTechniqueId] =
		useState<MotionGrammarTechniqueId>(defaultTechniqueId);
	const [replacementStatus, setReplacementStatus] = useState<string | null>(
		null,
	);
	const [instanceStatus, setInstanceStatus] = useState<string | null>(null);
	const [applyStatus, setApplyStatus] = useState<string | null>(null);
	const [parameterStatus, setParameterStatus] = useState<string | null>(null);
	const [selectedBindingId, setSelectedBindingId] = useState<string | null>(
		null,
	);
	const bindings = useMotionGrammarStore((state) => state.document.bindings);
	const passthroughBindings = useMotionGrammarStore(
		(state) => state.document.passthrough,
	);
	const grammarDiagnostics = useMotionGrammarStore(
		(state) => state.document.diagnostics ?? [],
	);
	const scene = useSceneStore((state) => state.document);
	const motion = useMotionStore((state) => state.document);
	const contextualBinding = systemClip?.provenance
		? bindings.find((item) => item.id === systemClip.provenance?.bindingId)
		: grammarBindingForNodes(bindings, nodeIds);
	const binding =
		contextualBinding ??
		(nodeIds.length === 0
			? (bindings.find((item) => item.id === selectedBindingId) ?? bindings[0])
			: undefined);
	const entry = binding ? findCatalogEntry(binding.techniqueId) : undefined;
	const authoringProfile = binding
		? describeMotionGrammarAuthoringProfile(binding)
		: undefined;
	const parameterSpecs =
		binding && !authoringProfile
			? motionGrammarParameterSpecsForBinding(binding)
			: [];
	const selectedGrammarDiagnostics = grammarDiagnostics.filter((diagnostic) => {
		if (diagnostic.bindingId === binding?.id) return true;
		const passthrough = passthroughBindings.find(
			(binding) => binding.id === diagnostic.bindingId,
		);
		return nodeIds.length === 0
			? Boolean(passthrough)
			: Boolean(
					passthrough?.targetIds.some((targetId) => nodeIds.includes(targetId)),
				);
	});
	const selectedRoleItems = binding
		? selectedMotionGrammarRoleItems({
				binding,
				scene,
				selectedNodeIds: nodeIds,
			})
		: [];
	const selectedRoleSummary =
		selectedRoleItems.length === 1
			? `${selectedRoleItems[0].label}: ${selectedRoleItems[0].nodeName}`
			: selectedRoleItems.length > 1
				? `${selectedRoleItems.length} ${entry?.label ?? "motion"} components selected`
				: null;
	const replacementSelection = binding
		? motionGrammarRoleReplacementForSelection({
				binding,
				motion,
				selectedNodeIds: nodeIds,
			})
		: undefined;
	const selectedEntry = findCatalogEntry(selectedTechniqueId);
	const techniqueOptions = techniqueOptionsForTargetCount(nodeIds.length);
	const minTargets = selectedEntry?.minTargets ?? 1;
	const canApply = isTechniqueApplicableToTargetCount(
		selectedTechniqueId,
		nodeIds.length,
	);
	const workspaceInstance = motionGrammarWorkspaceInstanceForSelection({
		techniqueId: selectedTechniqueId,
		scene,
		selectedNodeIds: nodeIds,
	});
	const applyLabel = canApply
		? `Apply ${selectedEntry?.label ?? "Technique"}`
		: nodeIds.length < minTargets
			? `Need ${minTargets} nodes`
			: "Selection not supported";
	const createSystemLabel =
		workspaceInstance.status === "ready"
			? `Create ${workspaceInstance.label}`
			: null;
	const commitVisibleParameter = (
		key: string,
		value: number,
	): MotionGrammarParameterCommitResult => {
		if (!binding) {
			return { status: "blocked", reason: "Motion binding is unavailable." };
		}
		const result = commitBindingParameter(binding.id, key, value);
		setParameterStatus(result.status === "blocked" ? result.reason : null);
		return result;
	};
	const commitSystemParameter = (
		key: string,
		value: number,
	): MotionGrammarParameterCommitResult | undefined => {
		if (!binding) return undefined;
		if (systemClip && authoringProfile?.timeline.durationParameterKey === key) {
			commitMotionSystemClipRetime({
				clipId: systemClip.id,
				range: {
					startFrame: systemClip.startFrame,
					durationFrames: value,
				},
				label: "Retime motion system",
			});
			return undefined;
		}
		return commitBindingParameter(binding.id, key, value);
	};
	const commitProfileEdit = (edit: RandomPulseProfileEdit) =>
		binding
			? commitMotionGrammarProfileEdit({ id: binding.id, edit })
			: {
					status: "blocked" as const,
					reason: "Motion binding is unavailable.",
				};

	useEffect(() => {
		setSelectedTechniqueId(defaultTechniqueId);
	}, [defaultTechniqueId]);

	useEffect(() => {
		if (nodeIds.length !== 0 || systemClip) return;
		if (
			selectedBindingId &&
			bindings.some((item) => item.id === selectedBindingId)
		) {
			return;
		}
		setSelectedBindingId(bindings[0]?.id ?? null);
	}, [bindings, nodeIds.length, selectedBindingId, systemClip]);

	return (
		<section className="border-white/8 border-b px-1.5 pb-1.5 last:border-b-0">
			<div className="sticky top-0 z-20 -mx-1.5 mb-1.5 flex h-6 items-center justify-between gap-1 border-white/8 border-b bg-surface-raised/96 px-1.5 text-fg-secondary text-ui backdrop-blur-xl">
				<div className="flex min-w-0 items-center gap-1 font-medium">
					<FlowArrow aria-hidden="true" size={12} />
					<span className="truncate">Motion</span>
				</div>
				{binding ? (
					systemClip ? (
						<button
							type="button"
							title="Clear motion system selection"
							aria-label="Clear motion system selection"
							onClick={onClearSystemClip}
							className={iconButtonClass}
						>
							<X size={11} />
						</button>
					) : (
						<button
							type="button"
							title="Remove technique"
							aria-label="Remove technique"
							onClick={() => commitRemoveBinding(binding.id)}
							className={iconButtonClass}
						>
							<Trash size={11} />
						</button>
					)
				) : null}
			</div>
			{selectedGrammarDiagnostics.length > 0 ? (
				<div className="mx-1.5 mb-1.5 space-y-1 rounded border border-danger/35 bg-danger-surface p-1.5 text-danger-fg text-ui">
					{selectedGrammarDiagnostics.map((diagnostic) => {
						const isPassthrough = passthroughBindings.some(
							(candidate) => candidate.id === diagnostic.bindingId,
						);
						return (
							<div key={`${diagnostic.code}:${diagnostic.bindingId}`}>
								<div title={diagnostic.message}>{diagnostic.message}</div>
								{isPassthrough ? (
									<button
										type="button"
										onClick={() => commitRemoveBinding(diagnostic.bindingId)}
										className={cn(actionButtonClass, "mt-1 border-danger/45")}
									>
										<Trash aria-hidden="true" size={11} />
										<span className="truncate">
											Remove incompatible binding
										</span>
									</button>
								) : null}
							</div>
						);
					})}
				</div>
			) : null}
			{!systemClip && nodeIds.length === 0 && bindings.length > 0 ? (
				<select
					aria-label="Motion grammar binding"
					value={binding?.id ?? ""}
					onChange={(event) => setSelectedBindingId(event.currentTarget.value)}
					className="mb-1.5 h-6 w-full rounded-md border border-white/10 bg-black/25 px-1.5 text-fg text-ui outline-none transition focus:border-accent/70"
				>
					{bindings.map((item, index) => (
						<option key={item.id} value={item.id}>
							{index + 1}.{" "}
							{findCatalogEntry(item.techniqueId)?.label ?? item.techniqueId}
						</option>
					))}
				</select>
			) : null}

			{binding && entry ? (
				<div className="space-y-1.5">
					{systemClip ? (
						<MotionSystemClipControls clip={systemClip} motion={motion} />
					) : null}
					{systemClip ? <ClipPhraseTimingControls clip={systemClip} /> : null}
					{systemClip && authoringProfile ? (
						<MotionSystemSourceControls
							binding={binding}
							scene={scene}
							profile={authoringProfile}
							onClearSystemClip={onClearSystemClip}
						/>
					) : null}
					<div className="flex items-center justify-between gap-1 text-ui">
						<span className="min-w-0 truncate text-fg">{entry.label}</span>
						<span className="shrink-0 text-fg-subtle">
							{binding.targetIds.length}{" "}
							{binding.targetIds.length === 1 ? "target" : "targets"}
						</span>
					</div>
					<GrammarBindingEditor
						binding={binding}
						bindingIndex={bindings.findIndex((item) => item.id === binding.id)}
						bindingCount={bindings.length}
						scene={scene}
					/>
					{selectedRoleSummary ? (
						<div
							className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-1 rounded border border-white/8 bg-black/20 px-1.5 py-1 text-ui"
							title={selectedRoleSummary}
						>
							<span className="text-fg-muted">Selected</span>
							<span className="truncate text-fg">{selectedRoleSummary}</span>
						</div>
					) : null}
					{replacementSelection?.status === "ready" ? (
						<button
							type="button"
							title={`Replace ${replacementSelection.roleLabel} with selected object`}
							onClick={() => {
								const result = commitReplaceMotionGrammarRole({
									binding,
									motion,
									selectedNodeIds: nodeIds,
								});
								setReplacementStatus(
									result.status === "replaced"
										? `Replaced ${result.roleLabel}`
										: result.reason,
								);
							}}
							className={actionButtonClass}
						>
							<Swap aria-hidden="true" size={11} />
							<span className="truncate">
								Replace {replacementSelection.roleLabel}
							</span>
						</button>
					) : null}
					{replacementStatus ? (
						<div className="truncate text-fg-muted text-ui">
							{replacementStatus}
						</div>
					) : null}
					{parameterSpecs.map((spec) => (
						<MotionParameterField
							key={`${binding.id}:${spec.key}`}
							bindingId={binding.id}
							spec={spec}
							value={binding.parameters[spec.key] ?? spec.default}
							onCommitParameter={commitVisibleParameter}
						/>
					))}
					{parameterStatus ? (
						<div
							className="truncate text-danger-fg text-ui"
							title={parameterStatus}
						>
							{parameterStatus}
						</div>
					) : null}
					{authoringProfile ? (
						<>
							<MotionAuthoringProfileControls
								key={authoringProfile.bindingId}
								binding={binding}
								profile={authoringProfile}
								showSystemMap={!systemClip}
								onCommitParameter={
									systemClip ? commitSystemParameter : undefined
								}
								onCommitProfileEdit={commitProfileEdit}
							/>
							{binding.techniqueId === "collision-bounce" ? (
								<CollisionBounceBakeAction binding={binding} scene={scene} />
							) : authoringProfile.timeline.bakePolicy === "not-supported" ? (
								<LiveMotionOutputNotice profile={authoringProfile} />
							) : (
								<MotionExpansionControls
									binding={binding}
									scene={scene}
									motion={motion}
									profile={authoringProfile}
								/>
							)}
						</>
					) : binding.techniqueId === "collision-bounce" ? (
						<CollisionBounceBakeAction
							key={binding.id}
							binding={binding}
							scene={scene}
						/>
					) : (
						<MotionExpansionControls
							key={binding.id}
							binding={binding}
							scene={scene}
							motion={motion}
						/>
					)}
				</div>
			) : (
				<div className="grid gap-1.5">
					<select
						aria-label="Motion technique"
						value={selectedTechniqueId}
						onChange={(event) => {
							setSelectedTechniqueId(
								event.target.value as MotionGrammarTechniqueId,
							);
							setInstanceStatus(null);
							setApplyStatus(null);
						}}
						className="h-6 w-full rounded-md border border-white/10 bg-black/25 px-1.5 text-fg text-ui outline-none transition focus:border-accent/70"
					>
						{TECHNIQUE_FAMILIES.map((family) => (
							<optgroup key={family} label={FAMILY_LABELS[family]}>
								{techniqueOptions
									.filter((option) => option.family === family)
									.map((option) => {
										return (
											<option
												key={option.id}
												value={option.id}
												disabled={option.disabled}
											>
												{option.label}
												{option.minTargets > 1
													? ` (${option.minTargets}+)`
													: ""}
											</option>
										);
									})}
							</optgroup>
						))}
					</select>
					<div className="grid gap-1">
						<button
							type="button"
							disabled={!canApply}
							onClick={() => {
								const result = commitApplyTechnique(
									selectedTechniqueId,
									nodeIds,
									scene,
									motion,
								);
								setApplyStatus(
									result.status === "applied"
										? "Motion technique applied"
										: `Apply blocked: ${result.reason}`,
								);
							}}
							className="h-6 w-full rounded-md border border-white/10 bg-white/5 px-2 text-fg text-ui transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
						>
							{applyLabel}
						</button>
						{applyStatus ? (
							<div
								className="truncate text-fg-muted text-ui"
								title={applyStatus}
							>
								{applyStatus}
							</div>
						) : null}
						{createSystemLabel ? (
							<button
								type="button"
								title="Create editable role objects for this motion preset"
								onClick={() => {
									const result = commitCreateMotionGrammarWorkspaceInstance({
										techniqueId: selectedTechniqueId,
										scene,
										selectedNodeIds: nodeIds,
									});
									setInstanceStatus(
										result.status === "created"
											? `${result.label} created`
											: result.reason,
									);
								}}
								className={actionButtonClass}
							>
								<ArrowsOutSimple aria-hidden="true" size={11} />
								<span className="truncate">{createSystemLabel}</span>
							</button>
						) : null}
					</div>
					{instanceStatus ? (
						<div className="truncate text-fg-muted text-ui">
							{instanceStatus}
						</div>
					) : null}
				</div>
			)}
		</section>
	);
}
