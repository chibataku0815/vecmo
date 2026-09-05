import type { MotionDocument } from "@/entities/motion/model/types";
import { createId } from "@/shared/lib/id";
import type {
	ComponentPropDefinition,
	InteractionAction,
	InteractionDefinition,
	InteractionTrigger,
	SceneDocument,
	VectorNode,
} from "./types";

/**
 * Pure interactions model (Interactive Motion program, T3-S1: document model +
 * agent authoring only). This file owns the document-scoped interaction-library
 * contract (read, normalize, mint, validate) as side-effect-free helpers so the
 * command bus and the agent write boundary share one normalization and one
 * validation seam. Nothing here mutates a live document;
 * `interaction-commands.ts` wraps these helpers to produce undoable Immer
 * patches. Mirrors `component-props.ts`'s shape.
 */

/**
 * Minimal motion-document view interaction validation needs: read-only access
 * to the clip list, so a `play-clip`/`toggle-clip` action's `clipId` can be
 * resolved. Kept narrow (not the full `MotionDocument`) so this file documents
 * exactly what it reads, mirroring `component-props.ts`'s `MotionConflictView`
 * convention with its own `Pick` rather than importing that file's type — the
 * two views read different fields (`tracks` there, `clips` here) for unrelated
 * reasons, so keeping them independent avoids a cross-domain naming coupling
 * that would otherwise force one file's binding-conflict-specific doc comment
 * onto an unrelated clip-existence check. Both are structurally satisfied by
 * the same real `MotionDocument`/`AgentDocumentContext.motion`, so no call site
 * needs to construct a special narrowed object for either.
 */
export type InteractionMotionView = Pick<MotionDocument, "clips">;

/**
 * Reason an interaction's `trigger` was refused, for typed agent issues and
 * inline validation UI.
 */
export type InteractionTriggerIssue =
	| { readonly kind: "node-missing"; readonly nodeId: string }
	| { readonly kind: "threshold-out-of-range"; readonly threshold: number }
	| {
			/**
			 * A `scroll-progress` trigger's `actions` is not exactly one
			 * `{kind: "seek", progress: ...}` or `{kind: "play-clip", ...}` entry —
			 * see {@link InteractionDefinition}'s doc comment for the exact shape
			 * rule this enforces.
			 */
			readonly kind: "scroll-progress-actions-invalid";
	  };

/**
 * Validates an interaction's `trigger` against the scene (`nodeId` existence)
 * and its own shape rules (`threshold` range, `scroll-progress`'s single-action
 * requirement). `actions` is passed in (rather than read from a parent
 * `InteractionDefinition`) so this stays a pure per-field check independent of
 * how the caller assembles the full definition. Returns `null` when valid.
 */
export function validateInteractionTrigger(
	trigger: InteractionTrigger,
	actions: readonly InteractionAction[],
	findNodeById: (nodeId: string) => VectorNode | undefined,
): InteractionTriggerIssue | null {
	if (trigger.nodeId && !findNodeById(trigger.nodeId)) {
		return { kind: "node-missing", nodeId: trigger.nodeId };
	}
	if (
		trigger.threshold !== undefined &&
		!(
			Number.isFinite(trigger.threshold) &&
			trigger.threshold >= 0 &&
			trigger.threshold <= 1
		)
	) {
		return { kind: "threshold-out-of-range", threshold: trigger.threshold };
	}
	if (
		trigger.kind === "scroll-progress" &&
		!isValidScrollProgressActions(actions)
	) {
		return { kind: "scroll-progress-actions-invalid" };
	}
	return null;
}

/**
 * `scroll-progress`'s v1-minimal shape rule: exactly one action, and that
 * action must be `{kind: "seek", progress: ...}` (the `progress` form
 * specifically, not `frame`) or `{kind: "play-clip", ...}` — see
 * {@link InteractionDefinition}'s doc comment for why.
 */
function isValidScrollProgressActions(
	actions: readonly InteractionAction[],
): boolean {
	if (actions.length !== 1) return false;
	const [action] = actions;
	if (action.kind === "play-clip") return true;
	if (action.kind === "seek")
		return action.progress !== undefined && action.frame === undefined;
	return false;
}

/**
 * Reason one {@link InteractionAction} was refused, for typed agent issues and
 * inline validation UI.
 */
export type InteractionActionIssue =
	| { readonly kind: "empty-actions" }
	| { readonly kind: "seek-fields-invalid" }
	| { readonly kind: "seek-frame-invalid"; readonly frame: number }
	| { readonly kind: "seek-progress-invalid"; readonly progress: number }
	| {
			/**
			 * `set-prop`'s `propName` does not resolve in
			 * `SceneDocument.componentProps`. ALLOW-WITH-WARNING: the prop may be
			 * authored later in the same editing session — see
			 * {@link InteractionDefinition}'s doc comment.
			 */
			readonly kind: "prop-missing";
			readonly propName: string;
	  }
	| {
			readonly kind: "prop-value-type-mismatch";
			readonly propName: string;
			readonly propType: ComponentPropDefinition["type"];
			readonly valueType: "number" | "string";
	  }
	| {
			/**
			 * A `play-clip`/`toggle-clip` `clipId` does not resolve in
			 * `MotionDocument.clips`. ALLOW-WITH-WARNING: the clip may be authored
			 * later in the same editing session — see
			 * {@link InteractionDefinition}'s doc comment.
			 */
			readonly kind: "clip-missing";
			readonly clipId: string;
	  };

/**
 * Validates one {@link InteractionAction}'s own shape and, where the action
 * references another document entity (`set-prop`'s `propName`, `play-clip`/
 * `toggle-clip`'s `clipId`), resolves that reference against the supplied
 * `componentProps`/`motion` views. Returns every violated condition for this
 * one action (not just the first) so a caller batching several actions in one
 * definition sees every failure at once; an action can violate at most one
 * condition in practice (the checks are mutually exclusive by `kind`), but the
 * array shape keeps this consistent with how binding issues are collected in
 * `component-props.ts`.
 *
 * `componentProps`/`motion` are optional: omitting either skips the
 * corresponding reference check (matching `resolveComponentPropBindingIssue`'s
 * optional-`motion` convention) — callers that DO have the relevant document in
 * scope should always pass it.
 */
export function validateInteractionAction(
	action: InteractionAction,
	componentProps?: readonly ComponentPropDefinition[],
	motion?: InteractionMotionView,
): readonly InteractionActionIssue[] {
	if (action.kind === "seek") {
		const hasFrame = action.frame !== undefined;
		const hasProgress = action.progress !== undefined;
		if (hasFrame === hasProgress) {
			// Both present or both absent: exactly one of frame|progress is required.
			return [{ kind: "seek-fields-invalid" }];
		}
		if (
			hasFrame &&
			!(Number.isFinite(action.frame) && (action.frame as number) >= 0)
		) {
			return [{ kind: "seek-frame-invalid", frame: action.frame as number }];
		}
		if (
			hasProgress &&
			!(
				Number.isFinite(action.progress) &&
				(action.progress as number) >= 0 &&
				(action.progress as number) <= 1
			)
		) {
			return [
				{ kind: "seek-progress-invalid", progress: action.progress as number },
			];
		}
		return [];
	}
	if (action.kind === "set-prop") {
		if (!componentProps) return [];
		const prop = componentProps.find((entry) => entry.name === action.propName);
		if (!prop) return [{ kind: "prop-missing", propName: action.propName }];
		const valueType = typeof action.value === "number" ? "number" : "string";
		const expectedValueType = prop.type === "number" ? "number" : "string";
		if (valueType !== expectedValueType) {
			return [
				{
					kind: "prop-value-type-mismatch",
					propName: action.propName,
					propType: prop.type,
					valueType,
				},
			];
		}
		return [];
	}
	if (action.kind === "play-clip" || action.kind === "toggle-clip") {
		if (!motion) return [];
		const exists = motion.clips.some((clip) => clip.id === action.clipId);
		return exists ? [] : [{ kind: "clip-missing", clipId: action.clipId }];
	}
	return [];
}

/**
 * Validates that `actions` is non-empty — an interaction with a trigger but no
 * effect is a typed issue, not a silently-stored no-op. Split from
 * {@link validateInteractionAction} (which validates one action's own shape)
 * since this is a property of the whole list, not any single entry.
 */
export function validateInteractionActionsNotEmpty(
	actions: readonly InteractionAction[],
): InteractionActionIssue | null {
	return actions.length === 0 ? { kind: "empty-actions" } : null;
}

const isValidInteractionId = (id: unknown): id is string =>
	typeof id === "string" && id.trim().length > 0;

/**
 * Reads the document's interaction library as a normalized array. Legacy
 * documents that omit `interactions` read as empty; malformed entries (bad id,
 * blank trigger kind, empty actions) are dropped so downstream readers never
 * branch on a partially valid interaction. This intentionally does NOT
 * re-validate trigger/action references against a live scene/motion document (a
 * node/clip/prop referenced may have been deleted since); reference resolution
 * against a specific document snapshot is `validateInteractionTrigger`'s/
 * `validateInteractionAction`'s job, called by commands/agent writes at
 * mutation time.
 */
export function readInteractions(
	document: Pick<SceneDocument, "interactions">,
): readonly InteractionDefinition[] {
	const interactions = document.interactions;
	if (!interactions || interactions.length === 0) return [];
	const seenIds = new Set<string>();
	const result: InteractionDefinition[] = [];
	for (const interaction of interactions) {
		const normalized = normalizeInteractionDefinition(interaction);
		if (!normalized || seenIds.has(normalized.id)) continue;
		seenIds.add(normalized.id);
		result.push(normalized);
	}
	return result;
}

/**
 * Normalizes a single interaction record: trims id/name, drops the record when
 * its id is blank, its trigger has no recognizable `kind`, or its `actions` is
 * empty. This is a defensive structural normalization only — well-formed
 * callers never produce a record this strict-but-shallow check would drop
 * because {@link validateInteractionTrigger}/{@link validateInteractionAction}
 * already enforce the richer semantic rules at write time, but a hand-edited or
 * legacy-migrated document could. Returns `null` when the record fails this
 * shallow shape check.
 */
export function normalizeInteractionDefinition(
	interaction: InteractionDefinition | undefined,
): InteractionDefinition | null {
	if (!interaction) return null;
	if (!isValidInteractionId(interaction.id)) return null;
	if (!interaction.trigger || typeof interaction.trigger.kind !== "string")
		return null;
	if (!Array.isArray(interaction.actions) || interaction.actions.length === 0)
		return null;

	const id = interaction.id.trim();
	const name = interaction.name?.trim();
	return {
		id,
		...(name ? { name } : {}),
		trigger: interaction.trigger,
		actions: interaction.actions,
	};
}

/** Finds an interaction by id from the normalized library, or undefined. */
export function findInteraction(
	document: Pick<SceneDocument, "interactions">,
	interactionId: string | null | undefined,
): InteractionDefinition | undefined {
	if (!interactionId) return undefined;
	return readInteractions(document).find(
		(interaction) => interaction.id === interactionId,
	);
}

/** Options for minting a new interaction. Mirrors `CreateComponentPropOptions`'s shape. */
export type CreateInteractionOptions = {
	readonly id?: string;
	readonly name?: string;
	readonly trigger: InteractionTrigger;
	readonly actions: readonly InteractionAction[];
};

/**
 * Mints a normalized interaction against an existing library, id-collision-free
 * (a random suffix candidate, retried on collision — the same minting loop
 * `createComponentProp` uses). Returns `null` when `actions` is empty, or when
 * `options.id` is supplied and already exists in `existingInteractions` (a
 * supplied id that collides is a REFUSAL, not silently re-minted — matching
 * `createComponentProp`'s id-collision contract, since a caller may depend on
 * getting back exactly the id it asked for). Callers that need the specific
 * refusal reason for a typed issue should check the conditions themselves
 * before minting (this is what the agent write boundary does).
 */
export function createInteraction(
	existingInteractions: readonly InteractionDefinition[],
	options: CreateInteractionOptions,
): InteractionDefinition | null {
	if (options.actions.length === 0) return null;
	const existingIds = new Set(
		existingInteractions.map((interaction) => interaction.id),
	);
	if (options.id && existingIds.has(options.id)) return null;

	let id = options.id?.trim() || createId("interaction");
	while (existingIds.has(id)) id = createId("interaction");
	const name = options.name?.trim();

	return {
		id,
		...(name ? { name } : {}),
		trigger: options.trigger,
		actions: options.actions,
	};
}
