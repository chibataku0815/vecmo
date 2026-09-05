import { castDraft, type Draft } from "immer";
import type { SceneCommand } from "./command";
import { cloneSceneDocument } from "./factory";
import { getNodeLocalBounds } from "./rendering";
import { findNode, selectNodeArtboardMapping } from "./selectors";
import {
	createDefaultSourceOpticsRig,
	normalizeSourceOpticsResponse,
	normalizeSourceOpticsRig,
	type SourceOpticsResponseDraft,
	type SourceOpticsRigDraft,
} from "./source-optics";
import type {
	Artboard,
	SceneDocument,
	SourceOpticsResponseBinding,
	SourceOpticsRigContract,
} from "./types";

const trimmed = (value: string): string => value.trim();

const uniqueId = (existing: ReadonlySet<string>, base: string): string => {
	const normalized = trimmed(base) || "source-optics";
	if (!existing.has(normalized)) return normalized;
	let suffix = 2;
	while (existing.has(`${normalized}-${suffix}`)) suffix += 1;
	return `${normalized}-${suffix}`;
};

const artboardValue = (
	document: SceneDocument,
	artboardId: string,
): Artboard | undefined =>
	document.artboard.id === artboardId
		? document.artboard
		: document.artboards?.find((artboard) => artboard.id === artboardId);

const writeArtboardRigs = (
	draft: Draft<SceneDocument>,
	artboardId: string,
	rigs: readonly SourceOpticsRigContract[],
): void => {
	const normalized = rigs
		.map((rig, index) => normalizeSourceOpticsRig(rig, index))
		.filter((rig): rig is SourceOpticsRigContract => rig !== null);
	const sourceOpticsRigs = normalized.length > 0 ? normalized : undefined;
	const update = (artboard: Draft<Artboard>): void => {
		if (sourceOpticsRigs) {
			artboard.sourceOpticsRigs = castDraft(
				cloneSceneDocument(sourceOpticsRigs),
			);
		} else {
			delete artboard.sourceOpticsRigs;
		}
	};
	if (draft.artboard.id === artboardId) update(draft.artboard);
	for (const artboard of draft.artboards ?? []) {
		if (artboard.id === artboardId) update(artboard);
	}
};

const rigsForArtboard = (
	document: SceneDocument,
	artboardId: string,
): readonly SourceOpticsRigContract[] =>
	(artboardValue(document, artboardId)?.sourceOpticsRigs ?? [])
		.map((rig, index) => normalizeSourceOpticsRig(rig, index))
		.filter((rig): rig is SourceOpticsRigContract => rig !== null);

const nodeBelongsToArtboard = (
	document: SceneDocument,
	nodeId: string,
	artboardId: string,
): boolean =>
	selectNodeArtboardMapping(document).byNodeId[nodeId] === artboardId;

export type AddSourceOpticsRigOptions = {
	readonly id?: string;
	readonly name?: string;
	readonly label?: string;
};

/** Adds one source rig through the scene command bus without copying source content. */
export function createAddSourceOpticsRigCommand(
	artboardId: string,
	sourceNodeId: string,
	options: AddSourceOpticsRigOptions = {},
): SceneCommand {
	return {
		type: "scene/add-source-optics-rig",
		label: options.label ?? "Add source optics",
		run: (draft) => {
			const source = findNode(draft, sourceNodeId);
			if (
				!source?.visible ||
				!nodeBelongsToArtboard(draft, sourceNodeId, artboardId)
			) {
				return;
			}
			const rigs = rigsForArtboard(draft, artboardId);
			if (rigs.some((rig) => rig.sourceNodeId === sourceNodeId)) return;
			const id = uniqueId(
				new Set(rigs.map((rig) => rig.id)),
				options.id ?? `source-optics-${sourceNodeId}`,
			);
			const created = createDefaultSourceOpticsRig(
				sourceNodeId,
				getNodeLocalBounds(source),
				id,
			);
			writeArtboardRigs(draft, artboardId, [
				...rigs,
				{
					...created,
					name: trimmed(options.name ?? created.name) || created.name,
				},
			]);
		},
	};
}

export type SourceOpticsRigPatch = Partial<
	Pick<SourceOpticsRigContract, "name" | "enabled">
> & {
	readonly bloom?: Omit<
		NonNullable<SourceOpticsRigDraft["bloom"]>,
		"radiusY"
	> & {
		readonly radiusY?: number | null;
	};
	readonly rays?: SourceOpticsRigDraft["rays"];
	readonly atmosphere?: SourceOpticsRigDraft["atmosphere"];
	readonly lens?: SourceOpticsRigDraft["lens"];
};

const mergeRigPatch = (
	rig: SourceOpticsRigContract,
	patch: SourceOpticsRigPatch,
): SourceOpticsRigContract | null => {
	const mergedBloom = { ...rig.bloom, ...patch.bloom };
	const { radiusY: mergedRadiusY, ...bloomBase } = mergedBloom;
	const bloom =
		patch.bloom?.radiusY === null
			? bloomBase
			: {
					...bloomBase,
					...(typeof mergedRadiusY === "number"
						? { radiusY: mergedRadiusY }
						: {}),
				};
	return normalizeSourceOpticsRig({
		...rig,
		...patch,
		bloom,
		rays: patch.rays === undefined ? rig.rays : patch.rays,
		atmosphere:
			patch.atmosphere === undefined
				? rig.atmosphere
				: patch.atmosphere === null
					? null
					: { ...rig.atmosphere, ...patch.atmosphere },
		lens:
			patch.lens === undefined
				? rig.lens
				: patch.lens === null
					? null
					: { ...rig.lens, ...patch.lens },
		responses: rig.responses,
	});
};

/** Updates one rig owner without rewriting its response bindings. */
export function createUpdateSourceOpticsRigCommand(
	artboardId: string,
	rigId: string,
	patch: SourceOpticsRigPatch,
	options: { readonly label?: string; readonly coalesceKey?: string } = {},
): SceneCommand {
	return {
		type: "scene/update-source-optics-rig",
		label: options.label ?? "Edit source optics",
		...(options.coalesceKey ? { coalesceKey: options.coalesceKey } : {}),
		run: (draft) => {
			const rigs = rigsForArtboard(draft, artboardId);
			if (rigs.filter((rig) => rig.id === rigId).length !== 1) return;
			const next = rigs.map((rig) => {
				if (rig.id !== rigId) return rig;
				return mergeRigPatch(rig, patch) ?? rig;
			});
			writeArtboardRigs(draft, artboardId, next);
		},
	};
}

/** Removes one rig and all of its bindings as one undoable edit. */
export function createRemoveSourceOpticsRigCommand(
	artboardId: string,
	rigId: string,
	options: { readonly label?: string } = {},
): SceneCommand {
	return {
		type: "scene/remove-source-optics-rig",
		label: options.label ?? "Remove source optics",
		run: (draft) => {
			const rigs = rigsForArtboard(draft, artboardId);
			if (rigs.filter((rig) => rig.id === rigId).length !== 1) return;
			writeArtboardRigs(
				draft,
				artboardId,
				rigs.filter((rig) => rig.id !== rigId),
			);
		},
	};
}

export type BindSourceOpticsResponseOptions = {
	readonly id?: string;
	readonly label?: string;
	readonly response?: Omit<SourceOpticsResponseDraft, "id" | "targetNodeId">;
};

/** Binds one existing target to one source using generic response descriptors. */
export function createBindSourceOpticsResponseCommand(
	artboardId: string,
	rigId: string,
	targetNodeId: string,
	options: BindSourceOpticsResponseOptions = {},
): SceneCommand {
	return {
		type: "scene/bind-source-optics-response",
		label: options.label ?? "Bind light response",
		run: (draft) => {
			const target = findNode(draft, targetNodeId);
			if (
				!target?.visible ||
				!nodeBelongsToArtboard(draft, targetNodeId, artboardId)
			) {
				return;
			}
			const rigs = rigsForArtboard(draft, artboardId);
			const owner = rigs.filter((rig) => rig.id === rigId);
			if (owner.length !== 1 || owner[0]?.sourceNodeId === targetNodeId) return;
			if (
				rigs.some((rig) =>
					rig.responses.some(
						(response) =>
							response.enabled && response.targetNodeId === targetNodeId,
					),
				)
			) {
				return;
			}
			const rig = owner[0];
			if (!rig) return;
			const responseId = uniqueId(
				new Set(rig.responses.map((response) => response.id)),
				options.id ?? `${rig.id}-response-${targetNodeId}`,
			);
			const bounds = getNodeLocalBounds(target);
			const shortAxis = Math.max(1, Math.min(bounds.width, bounds.height));
			const response = normalizeSourceOpticsResponse({
				id: responseId,
				targetNodeId,
				enabled: true,
				surface: {
					amount: 0.58,
					width: shortAxis * 0.1,
					softness: shortAxis * 0.035,
				},
				diffusion: {
					amount: 0.18,
					depth: shortAxis * 0.16,
					softness: shortAxis * 0.08,
				},
				...options.response,
			});
			if (!response) return;
			writeArtboardRigs(
				draft,
				artboardId,
				rigs.map((candidate) =>
					candidate.id === rigId
						? { ...candidate, responses: [...candidate.responses, response] }
						: candidate,
				),
			);
		},
	};
}

export type SourceOpticsResponsePatch = Partial<
	Pick<SourceOpticsResponseBinding, "enabled">
> & {
	readonly fieldId?: string | null;
	readonly surface?: SourceOpticsResponseDraft["surface"];
	readonly diffusion?: SourceOpticsResponseDraft["diffusion"];
	readonly edge?: SourceOpticsResponseDraft["edge"];
	readonly microstructure?: SourceOpticsResponseDraft["microstructure"];
	readonly spectral?: SourceOpticsResponseDraft["spectral"];
};

const mergeResponsePatch = (
	response: SourceOpticsResponseBinding,
	patch: SourceOpticsResponsePatch,
): SourceOpticsResponseBinding | null => {
	const { fieldId: _currentFieldId, ...withoutFieldId } = response;
	const nextFieldId =
		patch.fieldId === undefined
			? response.fieldId
			: patch.fieldId === null
				? undefined
				: patch.fieldId;
	return normalizeSourceOpticsResponse({
		...withoutFieldId,
		...(nextFieldId ? { fieldId: nextFieldId } : {}),
		enabled: patch.enabled ?? response.enabled,
		surface:
			patch.surface === undefined
				? response.surface
				: patch.surface === null
					? null
					: { ...response.surface, ...patch.surface },
		diffusion:
			patch.diffusion === undefined
				? response.diffusion
				: patch.diffusion === null
					? null
					: { ...response.diffusion, ...patch.diffusion },
		edge:
			patch.edge === undefined
				? response.edge
				: patch.edge === null
					? null
					: { ...response.edge, ...patch.edge },
		microstructure:
			patch.microstructure === undefined
				? response.microstructure
				: patch.microstructure === null
					? null
					: { ...response.microstructure, ...patch.microstructure },
		spectral:
			patch.spectral === undefined
				? response.spectral
				: patch.spectral === null
					? null
					: { ...response.spectral, ...patch.spectral },
	});
};

/** Updates one bound response through a channel-specific patch. */
export function createUpdateSourceOpticsResponseCommand(
	artboardId: string,
	rigId: string,
	bindingId: string,
	patch: SourceOpticsResponsePatch,
	options: { readonly label?: string; readonly coalesceKey?: string } = {},
): SceneCommand {
	return {
		type: "scene/update-source-optics-response",
		label: options.label ?? "Edit light response",
		...(options.coalesceKey ? { coalesceKey: options.coalesceKey } : {}),
		run: (draft) => {
			const rigs = rigsForArtboard(draft, artboardId);
			const rig = rigs.find((candidate) => candidate.id === rigId);
			if (
				rig?.responses.filter((entry) => entry.id === bindingId).length !== 1
			) {
				return;
			}
			const response = rig.responses.find((entry) => entry.id === bindingId);
			if (
				patch.enabled === true &&
				response &&
				!response.enabled &&
				rigs.some((candidate) =>
					candidate.responses.some(
						(entry) =>
							entry.enabled &&
							entry.targetNodeId === response.targetNodeId &&
							(candidate.id !== rigId || entry.id !== bindingId),
					),
				)
			) {
				return;
			}
			const next = rigs.map((candidate) =>
				candidate.id === rigId
					? {
							...candidate,
							responses: candidate.responses.map((response) =>
								response.id === bindingId
									? (mergeResponsePatch(response, patch) ?? response)
									: response,
							),
						}
					: candidate,
			);
			writeArtboardRigs(draft, artboardId, next);
		},
	};
}

/** Removes one response binding without disturbing the rig or sibling targets. */
export function createUnbindSourceOpticsResponseCommand(
	artboardId: string,
	rigId: string,
	bindingId: string,
	options: { readonly label?: string } = {},
): SceneCommand {
	return {
		type: "scene/unbind-source-optics-response",
		label: options.label ?? "Unbind light response",
		run: (draft) => {
			const rigs = rigsForArtboard(draft, artboardId);
			const rig = rigs.find((candidate) => candidate.id === rigId);
			if (!rig?.responses.some((entry) => entry.id === bindingId)) return;
			writeArtboardRigs(
				draft,
				artboardId,
				rigs.map((candidate) =>
					candidate.id === rigId
						? {
								...candidate,
								responses: candidate.responses.filter(
									(entry) => entry.id !== bindingId,
								),
							}
						: candidate,
				),
			);
		},
	};
}

/** Removes rigs whose source disappeared and prunes removed target bindings. */
export function pruneSourceOpticsRigs(
	rigs: readonly SourceOpticsRigContract[] | undefined,
	removedNodeIds: ReadonlySet<string>,
): readonly SourceOpticsRigContract[] | undefined {
	if (!rigs || removedNodeIds.size === 0) return rigs;
	const next = rigs.flatMap((rig) =>
		removedNodeIds.has(rig.sourceNodeId)
			? []
			: [
					{
						...rig,
						responses: rig.responses.filter(
							(response) => !removedNodeIds.has(response.targetNodeId),
						),
					},
				],
	);
	return next.length > 0 ? next : undefined;
}

/** Remaps a duplicated artboard's rigs only when both source and target were cloned. */
export function remapSourceOpticsRigsForDuplicate(
	rigs: readonly SourceOpticsRigContract[] | undefined,
	idMap: Readonly<Record<string, string>>,
): readonly SourceOpticsRigContract[] | undefined {
	if (!rigs) return undefined;
	const usedRigIds = new Set<string>();
	const next = rigs.flatMap((rig) => {
		const sourceNodeId = idMap[rig.sourceNodeId];
		if (!sourceNodeId) return [];
		const id = uniqueId(usedRigIds, `${rig.id}-copy`);
		usedRigIds.add(id);
		const responses = rig.responses.flatMap((response) => {
			const targetNodeId = idMap[response.targetNodeId];
			return targetNodeId
				? [
						{
							...response,
							id: `${id}-${response.id}`,
							targetNodeId,
						},
					]
				: [];
		});
		return [{ ...rig, id, sourceNodeId, responses }];
	});
	return next.length > 0 ? next : undefined;
}

/**
 * Duplicates same-artboard relations after a clipboard node clone. A duplicated
 * target keeps the original source and receives a new binding. A duplicated
 * source creates a second rig only when at least one of its bound targets was
 * duplicated in the same operation; source-only duplication stays unbound.
 */
export function duplicateSourceOpticsRelationsForNodeMap(
	rigs: readonly SourceOpticsRigContract[] | undefined,
	idMap: Readonly<Record<string, string>>,
): readonly SourceOpticsRigContract[] | undefined {
	if (!rigs) return undefined;
	const usedRigIds = new Set(rigs.map((rig) => rig.id));
	const next: SourceOpticsRigContract[] = [];
	const clonedRigs: SourceOpticsRigContract[] = [];
	let changed = false;
	for (const rig of rigs) {
		const usedResponseIds = new Set(
			rig.responses.map((response) => response.id),
		);
		const duplicatedSourceNodeId = idMap[rig.sourceNodeId];
		const duplicatedResponses = rig.responses.flatMap((response) => {
			const targetNodeId = idMap[response.targetNodeId];
			if (!targetNodeId) return [];
			const id = uniqueId(usedResponseIds, `${response.id}-copy`);
			usedResponseIds.add(id);
			return [{ ...response, id, targetNodeId }];
		});
		if (duplicatedSourceNodeId && duplicatedResponses.length > 0) {
			changed = true;
			const id = uniqueId(usedRigIds, `${rig.id}-copy`);
			usedRigIds.add(id);
			clonedRigs.push({
				...rig,
				id,
				sourceNodeId: duplicatedSourceNodeId,
				responses: duplicatedResponses.map((response) => ({
					...response,
					id: `${id}-${response.id}`,
				})),
			});
			next.push(rig);
			continue;
		}
		if (duplicatedResponses.length > 0) changed = true;
		next.push(
			duplicatedResponses.length > 0
				? {
						...rig,
						responses: [...rig.responses, ...duplicatedResponses],
					}
				: rig,
		);
	}
	return changed ? [...next, ...clonedRigs] : rigs;
}
