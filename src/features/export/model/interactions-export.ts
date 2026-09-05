import type { InteractionMotionView } from "@/entities/scene/model/interactions";
import {
	validateInteractionAction,
	validateInteractionActionsNotEmpty,
	validateInteractionTrigger,
} from "@/entities/scene/model/interactions";
import { findNode } from "@/entities/scene/model/selectors";
import type {
	ComponentPropDefinition,
	InteractionAction,
	InteractionDefinition,
	SceneDocument,
} from "@/entities/scene/model/types";

/**
 * Export-time compiler/gate for the document interaction library (Interactive
 * Motion program, T3-S2). Where `entities/scene/model/interactions.ts` owns
 * the AUTHORING-time validation contract (allow-with-warning for a dangling
 * `clipId`/`propName`, since the referenced clip/prop may be authored later in
 * the same session), this module is the ENFORCING gate at export: it
 * re-resolves every reference against the PROJECTED scene/motion/component-prop
 * state that will actually ship in THIS export, and DROPS whatever no longer
 * resolves rather than shipping a runtime instruction that would silently no-op
 * or throw. Mirrors `component-props-export.ts`'s compile-and-report shape
 * (`buildComponentPropsExport`/issue-reason pattern) so the two export
 * compilers read the same way.
 *
 * Drop granularity: a dangling `trigger.nodeId` drops the WHOLE interaction
 * (the trigger itself can never fire), while a dangling `clipId`/`propName`
 * inside one action drops just THAT action — the interaction survives with
 * its remaining actions unless the drop empties `actions`, in which case the
 * whole interaction drops too (an interaction with a trigger but no surviving
 * effect is exactly the "empty-actions" case `validateInteractionActionsNotEmpty`
 * already treats as invalid at authoring time).
 */

export type InteractionExportIssueCode =
	| "interaction-node-missing"
	| "interaction-clip-missing"
	| "interaction-prop-missing"
	| "interaction-prop-type-mismatch"
	| "interaction-seek-value-invalid"
	| "interaction-scroll-progress-actions-invalid"
	| "interaction-threshold-out-of-range"
	| "interaction-empty-actions";

/** One dropped interaction or action, for the export report. `actionIndex` is present only when a single action (not the whole interaction) was dropped. */
export type InteractionExportIssue = {
	readonly interactionId: string;
	readonly code: InteractionExportIssueCode;
	readonly message: string;
	readonly actionIndex?: number;
	readonly nodeId?: string;
	readonly clipId?: string;
	readonly propName?: string;
};

/** Runtime-usable interaction payload block plus the export-time diagnostic trail — mirrors `ComponentPropsExportResult`'s shape. */
export type InteractionsExportResult = {
	readonly interactions: readonly InteractionDefinition[];
	readonly issues: readonly InteractionExportIssue[];
};

const nodeMissingIssue = (
	interaction: InteractionDefinition,
): InteractionExportIssue => ({
	interactionId: interaction.id,
	code: "interaction-node-missing",
	message: `Interaction "${interaction.name ?? interaction.id}"'s trigger targets node "${interaction.trigger.nodeId}", which does not exist in this export; the interaction is dropped.`,
	nodeId: interaction.trigger.nodeId,
});

const thresholdOutOfRangeIssue = (
	interaction: InteractionDefinition,
): InteractionExportIssue => ({
	interactionId: interaction.id,
	code: "interaction-threshold-out-of-range",
	message: `Interaction "${interaction.name ?? interaction.id}"'s trigger threshold is out of the required 0..1 range; the interaction is dropped.`,
});

const scrollProgressActionsInvalidIssue = (
	interaction: InteractionDefinition,
): InteractionExportIssue => ({
	interactionId: interaction.id,
	code: "interaction-scroll-progress-actions-invalid",
	message: `Interaction "${interaction.name ?? interaction.id}"'s scroll-progress trigger does not have exactly one seek(progress)-or-play-clip action; the interaction is dropped.`,
});

const emptyActionsIssue = (
	interaction: InteractionDefinition,
): InteractionExportIssue => ({
	interactionId: interaction.id,
	code: "interaction-empty-actions",
	message: `Interaction "${interaction.name ?? interaction.id}" has no surviving actions after export validation; the interaction is dropped.`,
});

/**
 * Resolves one action's dangling-reference drop reason against the PROJECTED
 * document, reusing `validateInteractionAction` (the SAME per-action shape/
 * reference check the authoring-time command bus uses) so a binding that is
 * valid at authoring time and invalid here can only be a projection artifact
 * (a pruned node's clip/prop, a track added after authoring), never a
 * duplicated rule. Unlike the authoring-time contract, an unresolved
 * `clipId`/`propName` here IS a drop — see this module's own JSDoc for why
 * export time enforces what authoring time only warns about.
 */
function actionExportIssue(
	interaction: InteractionDefinition,
	action: InteractionAction,
	actionIndex: number,
	componentProps: readonly ComponentPropDefinition[],
	motion: InteractionMotionView,
): InteractionExportIssue | null {
	const violations = validateInteractionAction(action, componentProps, motion);
	if (violations.length === 0) return null;
	const [violation] = violations;
	if (violation.kind === "clip-missing") {
		return {
			interactionId: interaction.id,
			code: "interaction-clip-missing",
			message: `Interaction "${interaction.name ?? interaction.id}"'s ${action.kind} action targets clip "${violation.clipId}", which does not exist in this export; the action is dropped.`,
			actionIndex,
			clipId: violation.clipId,
		};
	}
	if (violation.kind === "prop-missing") {
		return {
			interactionId: interaction.id,
			code: "interaction-prop-missing",
			message: `Interaction "${interaction.name ?? interaction.id}"'s set-prop action targets component prop "${violation.propName}", which does not exist in this export; the action is dropped.`,
			actionIndex,
			propName: violation.propName,
		};
	}
	if (violation.kind === "prop-value-type-mismatch") {
		return {
			interactionId: interaction.id,
			code: "interaction-prop-type-mismatch",
			message: `Interaction "${interaction.name ?? interaction.id}"'s set-prop action's value type does not match component prop "${violation.propName}"'s declared type "${violation.propType}"; the action is dropped.`,
			actionIndex,
			propName: violation.propName,
		};
	}
	// seek-fields-invalid / seek-frame-invalid / seek-progress-invalid: a
	// malformed seek shape should already be unreachable through the command
	// bus (createUpdateInteractionCommand re-normalizes but does not itself
	// call validateInteractionAction), so this is a defensive drop rather than
	// a reachable authoring path — still reported so a hand-edited or
	// legacy-migrated document degrades honestly instead of shipping a
	// non-functional seek instruction.
	return {
		interactionId: interaction.id,
		code: "interaction-seek-value-invalid",
		message: `Interaction "${interaction.name ?? interaction.id}"'s seek action has an invalid frame/progress value; the action is dropped.`,
		actionIndex,
	};
}

/**
 * Compiles one interaction against the PROJECTED document, returning either
 * the surviving interaction (with any per-action drops already applied to its
 * `actions` list) or `null` when the whole interaction drops (a dangling
 * trigger node, an invalid `scroll-progress` shape, an out-of-range
 * threshold, or an empty `actions` list after per-action drops), plus every
 * issue encountered along the way.
 */
function compileInteraction(
	interaction: InteractionDefinition,
	findNodeById: (nodeId: string) => ReturnType<typeof findNode>,
	componentProps: readonly ComponentPropDefinition[],
	motion: InteractionMotionView,
): {
	readonly interaction: InteractionDefinition | null;
	readonly issues: readonly InteractionExportIssue[];
} {
	const triggerIssue = validateInteractionTrigger(
		interaction.trigger,
		interaction.actions,
		findNodeById,
	);
	if (triggerIssue?.kind === "node-missing") {
		return { interaction: null, issues: [nodeMissingIssue(interaction)] };
	}
	if (triggerIssue?.kind === "threshold-out-of-range") {
		return {
			interaction: null,
			issues: [thresholdOutOfRangeIssue(interaction)],
		};
	}
	if (triggerIssue?.kind === "scroll-progress-actions-invalid") {
		return {
			interaction: null,
			issues: [scrollProgressActionsInvalidIssue(interaction)],
		};
	}

	const issues: InteractionExportIssue[] = [];
	const survivingActions = interaction.actions.filter((action, index) => {
		const issue = actionExportIssue(
			interaction,
			action,
			index,
			componentProps,
			motion,
		);
		if (issue) issues.push(issue);
		return !issue;
	});

	if (validateInteractionActionsNotEmpty(survivingActions)) {
		issues.push(emptyActionsIssue(interaction));
		return { interaction: null, issues };
	}

	const compiled =
		survivingActions.length === interaction.actions.length
			? interaction
			: { ...interaction, actions: survivingActions };
	return { interaction: compiled, issues };
}

/**
 * Builds the runtime-usable `interactions` payload block (surviving,
 * export-validated definitions) plus a typed issue trail, from a document's
 * authored interaction library resolved against the PROJECTED scene, motion,
 * and component-prop state that will actually ship in this export. Pure and
 * side-effect-free: safe to call once per export regardless of profile,
 * matching `buildComponentPropsExport`'s contract.
 */
export function buildInteractionsExport(
	document: SceneDocument,
	motion: InteractionMotionView,
): InteractionsExportResult {
	const interactions = document.interactions ?? [];
	if (interactions.length === 0) return { interactions: [], issues: [] };

	const componentProps = document.componentProps ?? [];
	const findNodeById = (nodeId: string) => findNode(document, nodeId);

	const compiled = interactions.map((interaction) =>
		compileInteraction(interaction, findNodeById, componentProps, motion),
	);
	return {
		interactions: compiled
			.map((entry) => entry.interaction)
			.filter((entry): entry is InteractionDefinition => entry !== null),
		issues: compiled.flatMap((entry) => entry.issues),
	};
}

/**
 * Whether `interaction`'s trigger is node-scoped (`trigger.nodeId` present)
 * rather than component-level (whole mounted player). The WebGL player
 * (Interactive Motion T3-S3) has no per-node DOM elements to attach a
 * listener/observer to — it mounts a single `<canvas>` — so only
 * component-level triggers (click/hover/in-view/scroll-progress against the
 * canvas/container itself) are executable there; a node-scoped trigger is
 * unsupportable on that runtime regardless of its action kind. This is the
 * ONE predicate `webgl-player.ts` (payload filtering) and `export-report.ts`
 * (the narrowed `interaction-node-trigger-webgl-unsupported` issue) both use,
 * so the two layers can never disagree about which interactions the WebGL
 * payload actually ships.
 */
export const interactionHasNodeTrigger = (
	interaction: InteractionDefinition,
): boolean => Boolean(interaction.trigger.nodeId);

/**
 * Per-runtime-family applicability for one interaction. `motionCodeSvg` (the
 * standard `createVectorMotionPlayer`) wires the interaction engine for every
 * surviving interaction, node-scoped or component-level. `webglPlayer`
 * (Interactive Motion T3-S3) wires the SAME engine for COMPONENT-LEVEL
 * triggers only — see {@link interactionHasNodeTrigger}'s JSDoc for why a
 * node-scoped trigger is structurally unsupportable there, not a temporary
 * gap.
 */
export type ExportInteractionRuntimeSupport = {
	readonly motionCodeSvg: "native" | "unsupported";
	readonly webglPlayer: "native" | "unsupported";
};

/** One interaction's manifest row: its trigger/actions verbatim plus per-runtime support. */
export type ExportInteractionManifestEntry = {
	readonly id: string;
	readonly name?: string;
	readonly trigger: InteractionDefinition["trigger"];
	readonly actions: readonly InteractionAction[];
	readonly runtimeSupport: ExportInteractionRuntimeSupport;
};

/**
 * Diagnostic/tooling manifest for the document's `interactions` library,
 * paired with (not a replacement for) the runtime-consumed `interactions`
 * payload block `buildInteractionsExport` produces. Mirrors
 * `ExportComponentPropsManifest`'s shape and versioning convention
 * (`component-props-export.ts`) — one row per SURVIVING interaction (a
 * dropped interaction is not manifest-listed; its drop reason is already in
 * `buildInteractionsExport`'s `issues` trail, matching how a dropped
 * component-prop binding is absent from ITS manifest's `bindings` list
 * rather than listed with `supported:false` at the interaction level).
 */
export type ExportInteractionsManifest = {
	readonly included: true;
	readonly contractVersion: 1;
	readonly interactionCount: number;
	readonly interactions: readonly ExportInteractionManifestEntry[];
};

/**
 * Builds the `interactions` diagnostic manifest from a document's authored
 * interaction library resolved against the PROJECTED scene/motion/
 * component-prop state (matching `buildInteractionsExport`'s projected-
 * document contract, so a manifest built alongside a specific export's
 * payload reports the same surviving/dropped interactions that payload's
 * `issues` trail reports). `runtimeSupport.webglPlayer` reflects
 * {@link interactionHasNodeTrigger} per interaction — `"native"` for a
 * component-level trigger, `"unsupported"` for a node-scoped one — since
 * this manifest is meant to answer "what actually ships" regardless of which
 * runtime family a given export ends up choosing.
 */
export function buildInteractionsManifest(
	document: SceneDocument,
	motion: InteractionMotionView,
): ExportInteractionsManifest {
	const { interactions } = buildInteractionsExport(document, motion);
	return {
		included: true,
		contractVersion: 1,
		interactionCount: interactions.length,
		interactions: interactions.map((interaction) => ({
			id: interaction.id,
			...(interaction.name ? { name: interaction.name } : {}),
			trigger: interaction.trigger,
			actions: interaction.actions,
			runtimeSupport: {
				motionCodeSvg: "native",
				webglPlayer: interactionHasNodeTrigger(interaction)
					? "unsupported"
					: "native",
			},
		})),
	};
}
