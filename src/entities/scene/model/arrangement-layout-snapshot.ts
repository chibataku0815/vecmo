import { castDraft } from "immer";
import type { SceneCommand } from "./command";
import {
	findNode,
	isTopLevelSceneNode,
	selectArtboardIdForNode,
} from "./selectors";
import type { ArrangementLayoutSnapshot, SceneDocument, Vec2 } from "./types";

export type ArrangementLayoutSnapshotCaptureOptions = {
	readonly snapshotId: string;
	readonly name: string;
	readonly artboardId: string;
	readonly nodeIds: readonly string[];
	readonly captureToken: string;
};

export type ArrangementLayoutSnapshotRecaptureOptions = {
	readonly snapshotId: string;
	readonly captureToken: string;
	readonly nodeIds?: readonly string[];
	readonly name?: string;
};

export type ArrangementLayoutSnapshotRead = {
	readonly snapshot: ArrangementLayoutSnapshot;
	readonly status: "valid" | "stale";
	readonly reasons: readonly string[];
};

const finitePoint = (point: Vec2): boolean =>
	Number.isFinite(point.x) && Number.isFinite(point.y);

const artboardSize = (
	scene: SceneDocument,
	artboardId: string,
): { readonly width: number; readonly height: number } | null => {
	const artboard = (scene.artboards ?? [scene.artboard]).find(
		(candidate) => candidate.id === artboardId,
	);
	return artboard ? { width: artboard.width, height: artboard.height } : null;
};

const captureSnapshot = (
	scene: SceneDocument,
	options: ArrangementLayoutSnapshotCaptureOptions,
): ArrangementLayoutSnapshot | null => {
	if (!options.snapshotId || !options.name || !options.captureToken)
		return null;
	if (
		options.nodeIds.length === 0 ||
		new Set(options.nodeIds).size !== options.nodeIds.length
	) {
		return null;
	}
	const size = artboardSize(scene, options.artboardId);
	if (!size) return null;
	const positions: Record<string, Vec2> = {};
	for (const nodeId of options.nodeIds) {
		const node = findNode(scene, nodeId);
		if (
			!node ||
			!isTopLevelSceneNode(scene, nodeId) ||
			selectArtboardIdForNode(scene, nodeId) !== options.artboardId ||
			!finitePoint(node.transform.position)
		) {
			return null;
		}
		positions[nodeId] = { ...node.transform.position };
	}
	return {
		id: options.snapshotId,
		name: options.name,
		artboardId: options.artboardId,
		coordinateSpace: "artboard-local",
		memberNodeIds: [...options.nodeIds],
		positions,
		captureToken: options.captureToken,
		capturedArtboardSize: size,
	};
};

/** Captures a frozen set of artboard-local node seats through the Scene bus. */
export function createCaptureArrangementLayoutSnapshotCommand(
	options: ArrangementLayoutSnapshotCaptureOptions,
): SceneCommand {
	return {
		type: "scene/capture-arrangement-layout-snapshot",
		label: `Capture Arrangement layout ${options.name}`,
		layoutReapply: "skip",
		run: (draft) => {
			const current = draft.arrangementLayoutSnapshots ?? [];
			if (current.some((snapshot) => snapshot.id === options.snapshotId))
				return;
			const snapshot = captureSnapshot(
				draft as unknown as SceneDocument,
				options,
			);
			if (!snapshot) return;
			draft.arrangementLayoutSnapshots = castDraft([...current, snapshot]);
		},
	};
}

/** Recaptures an existing snapshot only when explicitly requested by id/token. */
export function createRecaptureArrangementLayoutSnapshotCommand(
	options: ArrangementLayoutSnapshotRecaptureOptions,
): SceneCommand {
	return {
		type: "scene/recapture-arrangement-layout-snapshot",
		label: `Recapture Arrangement layout ${options.snapshotId}`,
		layoutReapply: "skip",
		run: (draft) => {
			const current = draft.arrangementLayoutSnapshots ?? [];
			const previous = current.find(
				(snapshot) => snapshot.id === options.snapshotId,
			);
			if (!previous) return;
			const snapshot = captureSnapshot(draft as unknown as SceneDocument, {
				snapshotId: previous.id,
				name: options.name ?? previous.name,
				artboardId: previous.artboardId,
				nodeIds: options.nodeIds ?? previous.memberNodeIds,
				captureToken: options.captureToken,
			});
			if (!snapshot) return;
			draft.arrangementLayoutSnapshots = castDraft(
				current.map((candidate) =>
					candidate.id === snapshot.id ? snapshot : candidate,
				),
			);
		},
	};
}

/** Renames one frozen snapshot without implicitly changing its captured seats. */
export function createRenameArrangementLayoutSnapshotCommand(
	snapshotId: string,
	name: string,
): SceneCommand {
	return {
		type: "scene/rename-arrangement-layout-snapshot",
		label: "Rename Arrangement layout snapshot",
		layoutReapply: "skip",
		run: (draft) => {
			const normalizedName = name.trim();
			if (!normalizedName) return;
			const current = draft.arrangementLayoutSnapshots ?? [];
			const target = current.find((snapshot) => snapshot.id === snapshotId);
			if (!target || target.name === normalizedName) return;
			draft.arrangementLayoutSnapshots = castDraft(
				current.map((snapshot) =>
					snapshot.id === snapshotId
						? { ...snapshot, name: normalizedName }
						: snapshot,
				),
			);
		},
	};
}

/** Removes one frozen Arrangement snapshot; no node content is changed. */
export function createRemoveArrangementLayoutSnapshotCommand(
	snapshotId: string,
): SceneCommand {
	return {
		type: "scene/remove-arrangement-layout-snapshot",
		label: "Remove Arrangement layout snapshot",
		layoutReapply: "skip",
		run: (draft) => {
			const current = draft.arrangementLayoutSnapshots ?? [];
			const next = current.filter((snapshot) => snapshot.id !== snapshotId);
			if (next.length === current.length) return;
			draft.arrangementLayoutSnapshots = castDraft(next);
		},
	};
}

/** Returns whether a frozen snapshot still resolves without guessing remaps. */
export function readArrangementLayoutSnapshot(
	scene: SceneDocument,
	snapshot: ArrangementLayoutSnapshot,
): ArrangementLayoutSnapshotRead {
	const reasons: string[] = [];
	const size = artboardSize(scene, snapshot.artboardId);
	if (!size) reasons.push("snapshot artboard is missing");
	if (
		size &&
		(size.width !== snapshot.capturedArtboardSize.width ||
			size.height !== snapshot.capturedArtboardSize.height)
	) {
		reasons.push("artboard size changed after capture");
	}
	if (
		snapshot.memberNodeIds.length === 0 ||
		new Set(snapshot.memberNodeIds).size !== snapshot.memberNodeIds.length
	) {
		reasons.push("snapshot member ids are not unique");
	}
	for (const nodeId of snapshot.memberNodeIds) {
		const node = findNode(scene, nodeId);
		if (!node) {
			reasons.push(`member node ${nodeId} is missing`);
			continue;
		}
		if (!isTopLevelSceneNode(scene, nodeId))
			reasons.push(`member node ${nodeId} is no longer top-level`);
		if (selectArtboardIdForNode(scene, nodeId) !== snapshot.artboardId) {
			reasons.push(`member node ${nodeId} moved to another artboard`);
		}
		if (
			!finitePoint(
				snapshot.positions[nodeId] ?? { x: Number.NaN, y: Number.NaN },
			)
		) {
			reasons.push(`member node ${nodeId} has no finite captured position`);
		}
	}
	return {
		snapshot,
		status: reasons.length === 0 ? "valid" : "stale",
		reasons,
	};
}

/** Reads all stored snapshots with explicit stale reasons for agent/candidate gates. */
export function listArrangementLayoutSnapshots(
	scene: SceneDocument,
): readonly ArrangementLayoutSnapshotRead[] {
	return (scene.arrangementLayoutSnapshots ?? []).map((snapshot) =>
		readArrangementLayoutSnapshot(scene, snapshot),
	);
}
