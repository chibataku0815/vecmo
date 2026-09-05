import {
	createAgentIssue,
	summarizeAgentIssues,
} from "@/entities/agent/model/contracts";
import type { AgentDocumentContext } from "@/entities/agent/model/read-only";
import {
	AGENT_CONTRACT_VERSION,
	type AgentAppliedCommandSummary,
	type AgentCommandPlanApplyRequest,
	type AgentCommandPlanDryRunSummary,
	type AgentCommandPlanMode,
	type AgentCommandPlanRequest,
	type AgentCommandPlanResult,
	type AgentCommandTransactionEntry,
	type AgentCommandTransactionPolicy,
	type AgentCommandTransactionStore,
	type AgentIssue,
	type AgentIssueTarget,
} from "@/entities/agent/model/types";
import {
	type AgentCompiledDocumentCommandBatch,
	type AgentCompiledMotionCommand,
	type AgentCompiledMotionCommandBatch,
	type AgentCompiledMotionGrammarCommand,
	type AgentCompiledMotionGrammarCommandBatch,
	type AgentCompiledSceneCommand,
	type AgentCompiledSceneCommandBatch,
	compileAgentDocumentCommandBatch,
	compileAgentMotionCommandBatch,
	compileAgentMotionGrammarCommandBatch,
	compileAgentSceneCommandBatch,
	proposeAgentEditPlan,
} from "@/entities/agent/model/write";
import { useMotionStore } from "@/entities/motion/model/store";
import { useMotionGrammarStore } from "@/entities/motion-grammar/model/store";
import { useSceneStore } from "@/entities/scene/model/store";
import { liveSceneNodeIds, scanOrphanedMotion } from "./orphan-motion";

type AgentPlanReview = {
	readonly context: AgentDocumentContext;
	readonly plan: AgentCommandPlanResult["plan"];
	readonly documentBatch?: AgentCompiledDocumentCommandBatch;
	readonly sceneBatch?: AgentCompiledSceneCommandBatch;
	readonly motionBatch?: AgentCompiledMotionCommandBatch;
	readonly motionGrammarBatch?: AgentCompiledMotionGrammarCommandBatch;
	readonly issues: readonly AgentIssue[];
	readonly transactionPolicy: AgentCommandTransactionPolicy;
};

const targetKey = (target: AgentIssueTarget): string =>
	`${target.kind}:${target.id ?? ""}:${target.path ?? ""}`;

const uniqueTargets = (
	targets: readonly AgentIssueTarget[],
): readonly AgentIssueTarget[] => {
	const seen = new Set<string>();
	const unique: AgentIssueTarget[] = [];
	for (const target of targets) {
		const key = targetKey(target);
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(target);
	}
	return unique;
};

const sceneLabel = (count: number): string =>
	count === 1 ? "Agent scene command" : "Agent scene commands";

const motionLabel = (count: number): string =>
	count === 1 ? "Agent motion command" : "Agent motion commands";

const motionGrammarLabel = (count: number): string =>
	count === 1
		? "Agent motion grammar command"
		: "Agent motion grammar commands";

const baseTransactionId = (request: AgentCommandPlanRequest): string =>
	`${request.transactionId?.trim() || `agent-plan:${request.planId}`}:${crypto.randomUUID()}`;

const createTransactionPolicy = (
	request: AgentCommandPlanRequest,
	sceneSidecarMotionCommandCount = 0,
	documentBatch?: AgentCompiledDocumentCommandBatch,
): AgentCommandTransactionPolicy => {
	const base = baseTransactionId(request);
	const documentSceneCommandCount =
		documentBatch?.commands.reduce(
			(count, command) => count + command.sceneCommands.length,
			0,
		) ?? 0;
	const documentMotionCommandCount =
		documentBatch?.commands.reduce(
			(count, command) => count + command.motionCommands.length,
			0,
		) ?? 0;
	const documentGrammarCommandCount =
		documentBatch?.commands.reduce(
			(count, command) => count + command.grammarCommands.length,
			0,
		) ?? 0;
	const sceneCommandCount =
		(request.sceneCommands?.length ?? 0) + documentSceneCommandCount;
	const explicitMotionCommandCount = request.motionCommands?.length ?? 0;
	const motionCommandCount =
		explicitMotionCommandCount +
		sceneSidecarMotionCommandCount +
		documentMotionCommandCount;
	const motionGrammarCommandCount =
		(request.motionGrammarCommands?.length ?? 0) + documentGrammarCommandCount;
	const activeStoreCount = [
		sceneCommandCount,
		motionCommandCount,
		motionGrammarCommandCount,
	].filter((count) => count > 0).length;
	const hasMultipleStores = activeStoreCount > 1;
	const entries: AgentCommandTransactionEntry[] = [];
	if (sceneCommandCount > 0) {
		entries.push({
			store: "scene",
			transactionId: base,
			label: hasMultipleStores
				? "Agent compound plan"
				: sceneLabel(sceneCommandCount),
			commandCount: sceneCommandCount,
			undoUnit: "single-transaction",
		});
	}
	if (motionCommandCount > 0) {
		entries.push({
			store: "motion",
			transactionId: base,
			label: hasMultipleStores
				? "Agent compound plan"
				: motionLabel(motionCommandCount),
			commandCount: motionCommandCount,
			undoUnit: "single-transaction",
		});
	}
	if (motionGrammarCommandCount > 0) {
		entries.push({
			store: "motion-grammar",
			transactionId: base,
			label: hasMultipleStores
				? "Agent compound plan"
				: motionGrammarLabel(motionGrammarCommandCount),
			commandCount: motionGrammarCommandCount,
			undoUnit: "single-transaction",
		});
	}
	const crossStoreUndo = hasMultipleStores
		? "compound-command-stores"
		: "single-store";
	return {
		entries,
		coalesce:
			entries.length > 0
				? "commands-in-each-store-are-wrapped-in-one-transaction"
				: "none",
		crossStoreUndo,
		note: hasMultipleStores
			? "All active command stores share one compound id and roll back together if any apply or commit fails."
			: "Commands are applied through one transaction in the target command store.",
	};
};

/**
 * Live scene/motion/grammar snapshot, read fresh from the Zustand stores each
 * call. Exported so `editor-bridge.ts` can build the same context for the
 * read-only `"observe"` bridge op without duplicating this live-store read.
 */
export const currentAgentContext = (): AgentDocumentContext => ({
	scene: useSceneStore.getState().document,
	motion: useMotionStore.getState().document,
	grammar: useMotionGrammarStore.getState().document,
});

const blockedReason = (
	request: AgentCommandPlanRequest,
	issues: readonly AgentIssue[],
	ready: boolean,
): string | undefined => {
	if (
		(request.documentCommands?.length ?? 0) +
			(request.sceneCommands?.length ?? 0) +
			(request.motionCommands?.length ?? 0) +
			(request.motionGrammarCommands?.length ?? 0) ===
		0
	) {
		return "Agent command plan has no typed document, scene, motion, or motion-grammar commands.";
	}
	const firstError = issues.find((issue) => issue.severity === "error");
	if (firstError) return firstError.message;
	if (!ready) return "Agent command plan is not ready to apply.";
	return undefined;
};

const approvalIssue = (): AgentIssue =>
	createAgentIssue(
		"agent.plan-approval-required",
		"error",
		"Agent command plan must be explicitly approved before apply.",
		{ kind: "tool", id: "agent-review-apply" },
	);

const storeLabel = (store: AgentCommandTransactionStore): string => {
	switch (store) {
		case "scene":
			return "Scene";
		case "motion":
			return "Motion";
		case "motion-grammar":
			return "Motion grammar";
	}
};

const activeTransactionIssue = (
	store: AgentCommandTransactionStore,
): AgentIssue =>
	createAgentIssue(
		`agent.${store}-transaction-active`,
		"error",
		`${storeLabel(store)} has an active editor transaction; finish the current gesture before applying an agent plan.`,
		{ kind: "tool", id: "agent-review-apply" },
	);

const activeTransactionIssues = (
	review: AgentPlanReview,
): readonly AgentIssue[] => {
	const documentSceneCommandCount =
		review.documentBatch?.commands.reduce(
			(count, command) => count + command.sceneCommands.length,
			0,
		) ?? 0;
	const documentMotionCommandCount =
		review.documentBatch?.commands.reduce(
			(count, command) => count + command.motionCommands.length,
			0,
		) ?? 0;
	const documentGrammarCommandCount =
		review.documentBatch?.commands.reduce(
			(count, command) => count + command.grammarCommands.length,
			0,
		) ?? 0;
	const sceneCommandCount =
		(review.sceneBatch?.commands.length ?? 0) + documentSceneCommandCount;
	const sceneSidecarMotionCommandCount =
		review.sceneBatch?.commands.reduce(
			(sum, command) => sum + (command.motionCommands?.length ?? 0),
			0,
		) ?? 0;
	const motionCommandCount =
		(review.motionBatch?.commands.length ?? 0) +
		sceneSidecarMotionCommandCount +
		documentMotionCommandCount;
	const motionGrammarCommandCount =
		(review.motionGrammarBatch?.commands.length ?? 0) +
		documentGrammarCommandCount;
	const commandCount =
		sceneCommandCount + motionCommandCount + motionGrammarCommandCount;
	if (commandCount === 0) return [];

	const issues: AgentIssue[] = [];
	if (sceneCommandCount > 0 && useSceneStore.getState().transaction) {
		issues.push(activeTransactionIssue("scene"));
	}
	if (motionCommandCount > 0 && useMotionStore.getState().transaction) {
		issues.push(activeTransactionIssue("motion"));
	}
	if (
		motionGrammarCommandCount > 0 &&
		useMotionGrammarStore.getState().transaction
	) {
		issues.push(activeTransactionIssue("motion-grammar"));
	}
	return issues;
};

const motionTrackOrphanIssues = (
	request: AgentCommandPlanRequest,
	context: AgentDocumentContext,
): readonly AgentIssue[] => {
	const deletedNodeIds = new Set<string>();
	for (const command of request.sceneCommands ?? []) {
		if (command.type !== "scene/delete-nodes") continue;
		for (const nodeId of command.nodeIds) deletedNodeIds.add(nodeId);
	}
	if (deletedNodeIds.size === 0) return [];

	return context.motion.tracks
		.filter((track) => deletedNodeIds.has(track.target.nodeId))
		.map((track) =>
			createAgentIssue(
				"agent.scene-delete-would-orphan-motion-track",
				"error",
				"Live agent scene deletes cannot orphan existing motion tracks.",
				{ kind: "motion-track", id: track.id },
			),
		);
};

const motionGrammarBindingOrphanIssues = (
	request: AgentCommandPlanRequest,
	context: AgentDocumentContext,
): readonly AgentIssue[] => {
	const deletedNodeIds = new Set<string>();
	for (const command of request.sceneCommands ?? []) {
		if (command.type !== "scene/delete-nodes") continue;
		for (const nodeId of command.nodeIds) deletedNodeIds.add(nodeId);
	}
	if (deletedNodeIds.size === 0) return [];

	return context.grammar.bindings
		.filter((binding) =>
			binding.targetIds.some((nodeId) => deletedNodeIds.has(nodeId)),
		)
		.map((binding) =>
			createAgentIssue(
				"agent.scene-delete-would-orphan-motion-grammar-binding",
				"error",
				"Live agent scene deletes cannot orphan existing motion-grammar bindings.",
				{ kind: "motion-grammar-binding", id: binding.id },
			),
		);
};

const existingOrphanedMotionIssues = (
	context: AgentDocumentContext,
): readonly AgentIssue[] => {
	const scan = scanOrphanedMotion(
		liveSceneNodeIds(context.scene),
		context.motion,
		context.grammar,
		context.scene,
	);
	if (scan.count === 0) return [];
	const issues: AgentIssue[] = [];
	for (const trackId of scan.orphanTrackIds) {
		issues.push(
			createAgentIssue(
				"agent.document-orphaned-motion-track",
				"error",
				`The open document has motion track "${trackId}" for a deleted scene node. Repair orphaned motion in the agent banner before applying live agent edits.`,
				{ kind: "motion-track", id: trackId },
			),
		);
	}
	for (const trackId of scan.orphanSourceOpticsTrackIds) {
		issues.push(
			createAgentIssue(
				"agent.document-orphaned-source-optics-track",
				"error",
				`The open document has Source Optics track "${trackId}" for a missing rig owner. Repair orphaned motion in the agent banner before applying live agent edits.`,
				{ kind: "motion-track", id: trackId },
			),
		);
	}
	for (const bindingId of scan.orphanBindingIds) {
		issues.push(
			createAgentIssue(
				"agent.document-orphaned-motion-grammar-binding",
				"error",
				`The open document has motion-grammar binding "${bindingId}" for a deleted scene node. Repair orphaned motion in the agent banner before applying live agent edits.`,
				{ kind: "motion-grammar-binding", id: bindingId },
			),
		);
	}
	return issues;
};

const livePlanScopeIssues = (
	request: AgentCommandPlanRequest,
	context: AgentDocumentContext,
): readonly AgentIssue[] => {
	const issues: AgentIssue[] = [];
	issues.push(...existingOrphanedMotionIssues(context));
	issues.push(...motionTrackOrphanIssues(request, context));
	issues.push(...motionGrammarBindingOrphanIssues(request, context));
	return issues;
};

const createDryRunSummary = (
	mode: AgentCommandPlanMode,
	request: AgentCommandPlanRequest,
	review: AgentPlanReview,
	wouldApply: boolean,
	blocked: string | undefined,
): AgentCommandPlanDryRunSummary => ({
	mode,
	wouldApply,
	documentCommandCount: request.documentCommands?.length ?? 0,
	sceneCommandCount:
		review.transactionPolicy.entries.find((entry) => entry.store === "scene")
			?.commandCount ??
		request.sceneCommands?.length ??
		0,
	motionCommandCount:
		review.transactionPolicy.entries.find((entry) => entry.store === "motion")
			?.commandCount ??
		request.motionCommands?.length ??
		0,
	motionGrammarCommandCount:
		review.transactionPolicy.entries.find(
			(entry) => entry.store === "motion-grammar",
		)?.commandCount ??
		request.motionGrammarCommands?.length ??
		0,
	validDocumentCommandCount:
		review.documentBatch?.report.validCommandCount ?? 0,
	validSceneCommandCount: review.sceneBatch?.report.validCommandCount ?? 0,
	validMotionCommandCount: review.motionBatch?.report.validCommandCount ?? 0,
	validMotionGrammarCommandCount:
		review.motionGrammarBatch?.report.validCommandCount ?? 0,
	affected: review.plan.affected,
	transactionPolicy: review.transactionPolicy,
	...(blocked ? { blockedReason: blocked } : {}),
});

const createPlanReview = (
	request: AgentCommandPlanRequest,
	context: AgentDocumentContext,
): AgentPlanReview => {
	const documentBatch = request.documentCommands
		? compileAgentDocumentCommandBatch(context, request.documentCommands)
		: undefined;
	const sceneBatch = request.sceneCommands
		? compileAgentSceneCommandBatch(context, request.sceneCommands)
		: undefined;
	const motionBatch = request.motionCommands
		? compileAgentMotionCommandBatch(context, request.motionCommands)
		: undefined;
	const motionGrammarBatch = request.motionGrammarCommands
		? compileAgentMotionGrammarCommandBatch(
				context,
				request.motionGrammarCommands,
			)
		: undefined;
	const planResult = proposeAgentEditPlan(
		context,
		{
			intent: request.intent,
			target: request.target,
			documentCommands: request.documentCommands,
			sceneCommands: request.sceneCommands,
			motionCommands: request.motionCommands,
			motionGrammarCommands: request.motionGrammarCommands,
			includeValidation: request.includeValidation,
		},
		{
			document: documentBatch?.report,
			scene: sceneBatch?.report,
			motion: motionBatch?.report,
			motionGrammar: motionGrammarBatch?.report,
		},
	);
	if (!planResult.data) {
		throw new Error("Agent edit plan unexpectedly omitted data.");
	}
	const sceneSidecarMotionCommandCount =
		sceneBatch?.commands.reduce(
			(sum, command) => sum + (command.motionCommands?.length ?? 0),
			0,
		) ?? 0;
	return {
		context,
		plan: planResult.data,
		documentBatch,
		sceneBatch,
		motionBatch,
		motionGrammarBatch,
		issues: [...planResult.issues, ...livePlanScopeIssues(request, context)],
		transactionPolicy: createTransactionPolicy(
			request,
			sceneSidecarMotionCommandCount,
			documentBatch,
		),
	};
};

const createResult = (options: {
	readonly mode: AgentCommandPlanMode;
	readonly request: AgentCommandPlanRequest;
	readonly review: AgentPlanReview;
	readonly approved: boolean;
	readonly applied: boolean;
	readonly changed: boolean;
	readonly appliedCommands: readonly AgentAppliedCommandSummary[];
	readonly extraIssues?: readonly AgentIssue[];
}): AgentCommandPlanResult => {
	const issues = [...options.review.issues, ...(options.extraIssues ?? [])];
	const ready =
		options.review.plan.ready &&
		issues.every((issue) => issue.severity !== "error");
	const blocked = blockedReason(options.request, issues, ready);
	return {
		contractVersion: AGENT_CONTRACT_VERSION,
		mode: options.mode,
		planId: options.request.planId,
		intent: options.request.intent,
		approved: options.approved,
		ready,
		applied: options.applied,
		changed: options.changed,
		affected: uniqueTargets([
			...options.review.plan.affected,
			...options.appliedCommands.flatMap((item) => item.affected),
		]),
		summary: summarizeAgentIssues(issues),
		issues,
		dryRunSummary: createDryRunSummary(
			options.mode,
			options.request,
			options.review,
			ready && (options.mode === "validate" || options.approved),
			blocked,
		),
		transactionPolicy: options.review.transactionPolicy,
		plan: options.review.plan,
		appliedCommands: options.appliedCommands,
		...(blocked ? { blockedReason: blocked } : {}),
	};
};

const entryFor = (
	policy: AgentCommandTransactionPolicy,
	store: AgentCommandTransactionStore,
): AgentCommandTransactionEntry => {
	const entry = policy.entries.find((item) => item.store === store);
	if (!entry) {
		throw new Error(`Missing ${store} transaction policy entry.`);
	}
	return entry;
};

type LiveCompoundCommands = {
	readonly scene: readonly AgentCompiledSceneCommand[];
	readonly motion: readonly AgentCompiledMotionCommand[];
	readonly motionGrammar: readonly AgentCompiledMotionGrammarCommand[];
};

const collectLiveCompoundCommands = (
	review: AgentPlanReview,
): LiveCompoundCommands => {
	const scene: AgentCompiledSceneCommand[] = [];
	const motion: AgentCompiledMotionCommand[] = [];
	const motionGrammar: AgentCompiledMotionGrammarCommand[] = [];

	for (const compiled of review.documentBatch?.commands ?? []) {
		for (const command of compiled.sceneCommands) {
			scene.push({
				command,
				target: compiled.targets[0] ?? { kind: "document" },
			});
		}
		for (const command of compiled.motionCommands) {
			motion.push({
				command,
				target: compiled.targets[0] ?? { kind: "document" },
			});
		}
		for (const command of compiled.grammarCommands) {
			motionGrammar.push({
				command,
				target: compiled.targets[0] ?? { kind: "document" },
			});
		}
	}
	for (const compiled of review.sceneBatch?.commands ?? []) {
		scene.push(compiled);
		motion.push(...(compiled.motionCommands ?? []));
	}
	motion.push(...(review.motionBatch?.commands ?? []));
	motionGrammar.push(...(review.motionGrammarBatch?.commands ?? []));

	return { scene, motion, motionGrammar };
};

/**
 * Applies every compiled durable write in one live compound. All active stores
 * open before the first command runs, share one history id, and stay reversible
 * until every store commits. A runner/commit/subscriber failure aborts open
 * transactions and compensates only already-finalized entries carrying this
 * exact compound id.
 */
const applyLiveCompound = (
	review: AgentPlanReview,
): readonly AgentAppliedCommandSummary[] => {
	const commands = collectLiveCompoundCommands(review);
	const activeStores: readonly AgentCommandTransactionStore[] = [
		...(commands.scene.length > 0 ? (["scene"] as const) : []),
		...(commands.motion.length > 0 ? (["motion"] as const) : []),
		...(commands.motionGrammar.length > 0 ? (["motion-grammar"] as const) : []),
	];
	if (activeStores.length === 0) return [];

	const entries = activeStores.map((store) =>
		entryFor(review.transactionPolicy, store),
	);
	const compoundId = entries[0]?.transactionId;
	if (
		!compoundId ||
		entries.some((entry) => entry.transactionId !== compoundId)
	) {
		throw new Error("Agent compound plan lost its shared transaction id.");
	}

	const beforeScene = useSceneStore.getState().document;
	const beforeMotion = useMotionStore.getState().document;
	const beforeMotionGrammar = useMotionGrammarStore.getState().document;
	try {
		if (commands.scene.length > 0) {
			const entry = entryFor(review.transactionPolicy, "scene");
			useSceneStore
				.getState()
				.beginTransaction(compoundId, entry.label, compoundId);
		}
		if (commands.motion.length > 0) {
			const entry = entryFor(review.transactionPolicy, "motion");
			useMotionStore
				.getState()
				.beginTransaction(compoundId, entry.label, compoundId);
		}
		if (commands.motionGrammar.length > 0) {
			const entry = entryFor(review.transactionPolicy, "motion-grammar");
			useMotionGrammarStore
				.getState()
				.beginTransaction(compoundId, entry.label, compoundId);
		}

		for (const compiled of commands.scene) {
			useSceneStore.getState().apply({
				...compiled.command,
				compoundId,
				coalesceKey: compoundId,
			});
		}
		for (const compiled of commands.motion) {
			useMotionStore.getState().apply({
				...compiled.command,
				compoundId,
				coalesceKey: compoundId,
			});
		}
		for (const compiled of commands.motionGrammar) {
			useMotionGrammarStore.getState().apply({
				...compiled.command,
				compoundId,
				coalesceKey: compoundId,
			});
		}

		if (commands.motionGrammar.length > 0) {
			useMotionGrammarStore.getState().commit();
		}
		if (commands.motion.length > 0) useMotionStore.getState().commit();
		if (commands.scene.length > 0) useSceneStore.getState().commit();
	} catch (error) {
		const rollbackErrors: unknown[] = [];
		const attemptRollback = (operation: () => void): void => {
			try {
				operation();
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError);
			}
		};
		if (
			useMotionGrammarStore.getState().transaction?.coalesceKey === compoundId
		) {
			attemptRollback(() =>
				useMotionGrammarStore.getState().abortTransaction(),
			);
		}
		if (useMotionStore.getState().transaction?.coalesceKey === compoundId) {
			attemptRollback(() => useMotionStore.getState().abortTransaction());
		}
		if (useSceneStore.getState().transaction?.coalesceKey === compoundId) {
			attemptRollback(() => useSceneStore.getState().abortTransaction());
		}

		// `commit` is synchronous, but a store subscriber may throw after the
		// history entry is finalized. Revert only this exact top entry.
		const committedGrammar = useMotionGrammarStore.getState();
		if (committedGrammar.undoStack.at(-1)?.meta.compoundId === compoundId) {
			attemptRollback(() => committedGrammar.undo());
		}
		const committedMotion = useMotionStore.getState();
		if (committedMotion.undoStack.at(-1)?.meta.compoundId === compoundId) {
			attemptRollback(() => committedMotion.undo());
		}
		const committedScene = useSceneStore.getState();
		if (committedScene.undoStack.at(-1)?.meta.compoundId === compoundId) {
			attemptRollback(() => committedScene.undo());
		}
		if (rollbackErrors.length > 0) {
			const rollbackFailure = new Error(
				`Agent compound rollback encountered ${rollbackErrors.length} subscriber error(s).`,
			);
			(rollbackFailure as Error & { cause?: unknown }).cause = error;
			throw rollbackFailure;
		}
		throw error;
	}

	const summaries: AgentAppliedCommandSummary[] = [];
	if (commands.scene.length > 0) {
		const changed = useSceneStore.getState().document !== beforeScene;
		summaries.push({
			store: "scene",
			transactionId: compoundId,
			commandCount: commands.scene.length,
			changed,
			affected: changed
				? uniqueTargets(commands.scene.map((command) => command.target))
				: [],
		});
	}
	if (commands.motion.length > 0) {
		const changed = useMotionStore.getState().document !== beforeMotion;
		summaries.push({
			store: "motion",
			transactionId: compoundId,
			commandCount: commands.motion.length,
			changed,
			affected: changed
				? uniqueTargets(commands.motion.map((command) => command.target))
				: [],
		});
	}
	if (commands.motionGrammar.length > 0) {
		const changed =
			useMotionGrammarStore.getState().document !== beforeMotionGrammar;
		summaries.push({
			store: "motion-grammar",
			transactionId: compoundId,
			commandCount: commands.motionGrammar.length,
			changed,
			affected: changed
				? uniqueTargets(commands.motionGrammar.map((command) => command.target))
				: [],
		});
	}
	return summaries;
};

const noChangeIssues = (
	appliedCommands: readonly AgentAppliedCommandSummary[],
): readonly AgentIssue[] =>
	appliedCommands
		.filter((item) => item.commandCount > 0 && !item.changed)
		.map((item) =>
			createAgentIssue(
				`agent.${item.store}-plan-no-changes`,
				"warning",
				`${storeLabel(item.store)} commands were valid but did not change the document.`,
				{ kind: "document" },
			),
		);

/**
 * Validates an agent command plan against the live editor documents without
 * mutating either command store. This is the review-only half of the bridge
 * used before a user or host grants approval to apply the plan.
 *
 * `createPlanReview` builds this result's `plan` from the SAME compiled batch
 * as `sceneBatch`/`motionBatch`/`motionGrammarBatch` (single compile per
 * result), so the returned `plan.steps[].affected` and `plan.affected` are
 * internally consistent with each other. They are still provisional for any
 * created resource: a later `applyApprovedAgentCommandPlan` call compiles the
 * same envelope fresh and mints new ids, so a caller must not chain a
 * created-resource id from a validate result into a follow-up command.
 */
export function validateAgentCommandPlan(
	request: AgentCommandPlanRequest,
	context: AgentDocumentContext = currentAgentContext(),
): AgentCommandPlanResult {
	const review = createPlanReview(request, context);
	return createResult({
		mode: "validate",
		request,
		review,
		approved: false,
		applied: false,
		changed: false,
		appliedCommands: [],
	});
}

/**
 * Applies an approved agent command plan to the live command stores. Scene and
 * side-car commands never touch raw Zustand mutation: each domain is wrapped in
 * one explicit transaction and all edits enter through its command-store `apply`.
 *
 * Because `createPlanReview` compiles the command envelope exactly once and
 * feeds that same compile into both the plan and the apply step, every id in
 * this result's `plan.steps[].affected`, `plan.affected`, and
 * `appliedCommands[].affected` refers to the same committed resources — there
 * is no second, independently-minted compile. `appliedCommands[].affected` is
 * the canonical mapping (each entry is `batch.commands.map(c => c.target)`,
 * one target per successfully compiled command, in request order);
 * `plan.steps[].affected` carries the same ids but deduplicated by
 * `kind:id`, so it is not guaranteed to preserve a strict one-per-command
 * count or order.
 */
export function applyApprovedAgentCommandPlan(
	request: AgentCommandPlanApplyRequest,
): AgentCommandPlanResult {
	const review = createPlanReview(request, currentAgentContext());
	const approved = request.approval?.approved === true;
	if (!approved) {
		return createResult({
			mode: "apply",
			request,
			review,
			approved,
			applied: false,
			changed: false,
			appliedCommands: [],
			extraIssues: [approvalIssue()],
		});
	}
	const transactionIssues = activeTransactionIssues(review);
	if (transactionIssues.length > 0) {
		return createResult({
			mode: "apply",
			request,
			review,
			approved,
			applied: false,
			changed: false,
			appliedCommands: [],
			extraIssues: transactionIssues,
		});
	}
	if (review.issues.some((issue) => issue.severity === "error")) {
		return createResult({
			mode: "apply",
			request,
			review,
			approved,
			applied: false,
			changed: false,
			appliedCommands: [],
		});
	}
	if (!review.plan.ready) {
		return createResult({
			mode: "apply",
			request,
			review,
			approved,
			applied: false,
			changed: false,
			appliedCommands: [],
		});
	}

	const appliedCommands = applyLiveCompound(review);

	return createResult({
		mode: "apply",
		request,
		review,
		approved,
		applied: true,
		changed: appliedCommands.some((item) => item.changed),
		appliedCommands,
		extraIssues: noChangeIssues(appliedCommands),
	});
}
