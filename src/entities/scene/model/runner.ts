import {
	castDraft,
	type Draft,
	enablePatches,
	type Patch,
	produceWithPatches,
} from "immer";
import { refreshBlendNode } from "./blend";
import type { SceneCommand } from "./command";
import {
	reapplyLayoutFramesAffectedByPatchesInDraft,
	reapplyLayoutFramesInDraft,
} from "./layout-frame-commands";
import type { SceneDocument, VectorNode } from "./types";

enablePatches();

export type SceneCommandRunnerIssue = {
	readonly code: "scene.command.invalid";
	readonly severity: "error";
	readonly message: string;
	readonly commandIndex: number;
	readonly commandType: string;
};

export type SceneCommandRunnerTransaction = {
	readonly coalesceKey: string;
	readonly label?: string;
};

export type SceneCommandRunnerOptions = {
	readonly transaction?: SceneCommandRunnerTransaction;
};

export type SceneCommandRunnerResult = {
	readonly document: SceneDocument;
	readonly changed: boolean;
	readonly appliedCommandCount: number;
	readonly patches: readonly Patch[];
	readonly inversePatches: readonly Patch[];
	readonly issues: readonly SceneCommandRunnerIssue[];
	readonly transaction: SceneCommandRunnerTransaction | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const commandTypeOf = (value: unknown): string => {
	if (!isRecord(value)) return "unknown";
	return typeof value.type === "string" ? value.type : "unknown";
};

const isSceneCommand = (value: unknown): value is SceneCommand => {
	if (!isRecord(value)) return false;
	return typeof value.type === "string" && typeof value.run === "function";
};

const invalidCommandIssue = (
	command: unknown,
	index: number,
): SceneCommandRunnerIssue => ({
	code: "scene.command.invalid",
	severity: "error",
	message: `Scene command ${index} is not a runnable scene command; the command sequence was not applied.`,
	commandIndex: index,
	commandType: commandTypeOf(command),
});

const validateCommands = (
	commands: readonly unknown[],
): {
	readonly commands: readonly SceneCommand[];
	readonly issues: readonly SceneCommandRunnerIssue[];
} => {
	const runnable: SceneCommand[] = [];
	const issues: SceneCommandRunnerIssue[] = [];
	for (const [index, command] of commands.entries()) {
		if (isSceneCommand(command)) {
			runnable.push(command);
			continue;
		}
		issues.push(invalidCommandIssue(command, index));
	}
	return { commands: runnable, issues };
};

const layoutRelevantNodeFields = new Set(["geometry", "transform", "frame"]);
const blendRelevantChildFields = new Set([
	"geometry",
	"transform",
	"style",
	"children",
	"visible",
	"locked",
]);

const patchMayAffectLayout = (patch: Patch): boolean => {
	const path = patch.path;
	if (path.length === 0) return true;
	const layerIndex = path.indexOf("layers");
	if (layerIndex >= 0) {
		const field = path[layerIndex + 2];
		if (field === undefined) return true;
		if (field === "nodes" && path.length <= layerIndex + 4) return true;
	}
	for (let index = path.length - 1; index >= 0; index -= 1) {
		const segment = path[index];
		if (segment !== "nodes" && segment !== "children") continue;
		const field = path[index + 2];
		if (field === undefined) return true;
		return typeof field === "string" && layoutRelevantNodeFields.has(field);
	}
	return false;
};

const commandNeedsLayoutReapply = (
	command: SceneCommand,
	patches: readonly Patch[],
): boolean => {
	if (command.layoutReapply === "skip") return false;
	return patches.some(patchMayAffectLayout);
};

const isVectorNodeLike = (value: unknown): value is VectorNode =>
	isRecord(value) &&
	typeof value.id === "string" &&
	isRecord(value.geometry) &&
	isRecord(value.transform);

const valueAtPathSegment = (
	value: unknown,
	segment: string | number,
): unknown => {
	if (Array.isArray(value)) {
		return typeof segment === "number" ? value[segment] : undefined;
	}
	if (!isRecord(value)) return undefined;
	return value[segment];
};

/**
 * Returns the Blend container whose authored child was touched by an Immer patch.
 * Generated steps are protected by locks, so ordinary direct manipulation writes
 * source children; the owning Blend must then rematerialize its derived cache in
 * the same command boundary.
 */
const blendNodeIdForPatch = (
	document: SceneDocument,
	patch: Patch,
): string | null => {
	let current: unknown = document;
	for (let index = 0; index < patch.path.length; index += 1) {
		const segment = patch.path[index];
		if (isVectorNodeLike(current) && current.blend && segment === "children") {
			const field = patch.path[index + 2];
			if (
				field === undefined ||
				(typeof field === "string" && blendRelevantChildFields.has(field))
			) {
				return current.id;
			}
			return null;
		}
		current = valueAtPathSegment(current, segment);
		if (current === undefined) return null;
	}
	return null;
};

const blendNodeIdsAffectedByPatches = (
	document: SceneDocument,
	patches: readonly Patch[],
): ReadonlySet<string> => {
	const ids = new Set<string>();
	for (const patch of patches) {
		const blendNodeId = blendNodeIdForPatch(document, patch);
		if (blendNodeId) ids.add(blendNodeId);
	}
	return ids;
};

const reapplyBlendNodesById = (
	nodes: Draft<VectorNode>[],
	blendNodeIds: ReadonlySet<string>,
): void => {
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		if (!node) continue;
		if (node.children) {
			reapplyBlendNodesById(node.children as Draft<VectorNode>[], blendNodeIds);
		}
		if (!node.blend || !blendNodeIds.has(node.id)) continue;
		nodes[index] = castDraft(refreshBlendNode(node as unknown as VectorNode));
	}
};

const reapplyAffectedBlendNodesInDraft = (
	draft: Draft<SceneDocument>,
	blendNodeIds: ReadonlySet<string>,
): void => {
	if (blendNodeIds.size === 0) return;
	for (const layer of draft.layers) {
		reapplyBlendNodesById(layer.nodes as Draft<VectorNode>[], blendNodeIds);
	}
};

const appendPatchStep = (
	patches: Patch[],
	inversePatches: readonly Patch[],
	stepPatches: readonly Patch[],
	stepInversePatches: readonly Patch[],
): Patch[] => {
	patches.push(...stepPatches);
	return [...stepInversePatches, ...inversePatches];
};

/**
 * Applies a scene command sequence to the provided document without touching the
 * singleton scene store. Each command gets the same separate Immer draft it
 * would receive through `useSceneStore.apply`, while returned patches are
 * accumulated as one transaction boundary.
 *
 * Layout repair is intentionally patch-gated: commands that edit node geometry,
 * transforms, frame contracts, or node/child arrays refresh stored layout
 * materialization, while style/name/document-only edits avoid a layout rewrite.
 * Exact node-field patches and known layout-frame child-structure patches repair
 * only affected layout frames. Known structural no-ops, such as non-layout
 * sibling add/remove/reorder patches, avoid rewriting unrelated layout geometry;
 * broad structural patches keep the older global fallback. Layout frame commands
 * can mark themselves as self-materializing with `layoutReapply: "skip"`.
 */
export function runSceneCommands(
	document: SceneDocument,
	commands: readonly unknown[],
	options: SceneCommandRunnerOptions = {},
): SceneCommandRunnerResult {
	const validation = validateCommands(commands);
	if (validation.issues.length > 0) {
		return {
			document,
			changed: false,
			appliedCommandCount: 0,
			patches: [],
			inversePatches: [],
			issues: validation.issues,
			transaction: options.transaction ?? null,
		};
	}

	let nextDocument = document;
	const patches: Patch[] = [];
	let inversePatches: Patch[] = [];
	for (const command of validation.commands) {
		const [commandDocument, commandPatches, commandInversePatches] =
			produceWithPatches(nextDocument, (draft) => {
				command.run(draft);
			});
		nextDocument = commandDocument;
		let repairSourcePatches: readonly Patch[] = commandPatches;
		inversePatches = appendPatchStep(
			patches,
			inversePatches,
			commandPatches,
			commandInversePatches,
		);
		if (commandNeedsLayoutReapply(command, commandPatches)) {
			const [layoutDocument, layoutPatches, layoutInversePatches] =
				produceWithPatches(nextDocument, (draft) => {
					if (
						!reapplyLayoutFramesAffectedByPatchesInDraft(draft, commandPatches)
					) {
						reapplyLayoutFramesInDraft(draft);
					}
				});
			nextDocument = layoutDocument;
			repairSourcePatches = [...repairSourcePatches, ...layoutPatches];
			inversePatches = appendPatchStep(
				patches,
				inversePatches,
				layoutPatches,
				layoutInversePatches,
			);
		}

		const blendNodeIds = blendNodeIdsAffectedByPatches(
			nextDocument,
			repairSourcePatches,
		);
		if (blendNodeIds.size === 0) continue;
		const [blendDocument, blendPatches, blendInversePatches] =
			produceWithPatches(nextDocument, (draft) => {
				reapplyAffectedBlendNodesInDraft(draft, blendNodeIds);
			});
		nextDocument = blendDocument;
		inversePatches = appendPatchStep(
			patches,
			inversePatches,
			blendPatches,
			blendInversePatches,
		);
	}

	return {
		document: nextDocument,
		changed: patches.length > 0,
		appliedCommandCount: validation.commands.length,
		patches,
		inversePatches,
		issues: [],
		transaction: options.transaction ?? null,
	};
}
