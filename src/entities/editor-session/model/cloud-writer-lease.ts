import { create } from "zustand";
import { recordEditorDiagnostic } from "./diagnostics";
import { getEditorSessionDescriptor } from "./session";

export type CloudWriterMode = "local" | "acquiring" | "writer" | "review";

type CloudWriterLeaseState = {
	readonly projectId: string | null;
	readonly mode: CloudWriterMode;
	readonly ownerEditorInstanceId: string | null;
};

export const useCloudWriterLeaseStore = create<CloudWriterLeaseState>(() => ({
	projectId: null,
	mode: "local",
	ownerEditorInstanceId: null,
}));

type LeaseMessage = {
	readonly kind: "writer" | "takeover";
	readonly projectId: string;
	readonly editorInstanceId: string;
};

let generation = 0;
let channel: BroadcastChannel | undefined;
let releaseLock: (() => void) | undefined;
let retryTimer: number | undefined;

const setLeaseState = (state: CloudWriterLeaseState): void => {
	useCloudWriterLeaseStore.setState(state);
	recordEditorDiagnostic({
		event: "writer-mode-changed",
		projectId: state.projectId,
		mode: state.mode,
	});
};

const announce = (message: LeaseMessage): void => channel?.postMessage(message);

const attemptLock = (projectId: string, token: number): void => {
	const editorInstanceId = getEditorSessionDescriptor().editorInstanceId;
	const locks = globalThis.navigator?.locks;
	if (!locks) {
		setLeaseState({ projectId, mode: "review", ownerEditorInstanceId: null });
		return;
	}
	void locks.request(
		`vector-motion-author:cloud-writer:${projectId}`,
		{ ifAvailable: true, mode: "exclusive" },
		async (lock) => {
			if (generation !== token) return;
			if (!lock) {
				setLeaseState({
					projectId,
					mode: "review",
					ownerEditorInstanceId:
						useCloudWriterLeaseStore.getState().ownerEditorInstanceId,
				});
				return;
			}
			setLeaseState({
				projectId,
				mode: "writer",
				ownerEditorInstanceId: editorInstanceId,
			});
			announce({ kind: "writer", projectId, editorInstanceId });
			await new Promise<void>((resolve) => {
				releaseLock = resolve;
			});
			releaseLock = undefined;
		},
	);
};

/** Claims the single cloud-writer slot for the active project in this origin. */
export const activateCloudWriterLease = (projectId: string | null): void => {
	generation += 1;
	const token = generation;
	globalThis.clearTimeout(retryTimer);
	releaseLock?.();
	releaseLock = undefined;
	channel?.close();
	channel = undefined;
	if (!projectId) {
		setLeaseState({
			projectId: null,
			mode: "local",
			ownerEditorInstanceId: null,
		});
		return;
	}
	setLeaseState({ projectId, mode: "acquiring", ownerEditorInstanceId: null });
	channel = new BroadcastChannel(
		`vector-motion-author:cloud-writer:${projectId}`,
	);
	channel.onmessage = (event: MessageEvent<LeaseMessage>) => {
		const message = event.data;
		if (message.projectId !== projectId) return;
		if (message.kind === "writer") {
			const state = useCloudWriterLeaseStore.getState();
			if (state.mode !== "writer") {
				setLeaseState({
					projectId,
					mode: "review",
					ownerEditorInstanceId: message.editorInstanceId,
				});
			}
			return;
		}
		if (
			message.kind === "takeover" &&
			useCloudWriterLeaseStore.getState().mode === "writer"
		) {
			releaseLock?.();
			setLeaseState({
				projectId,
				mode: "review",
				ownerEditorInstanceId: message.editorInstanceId,
			});
		}
	};
	attemptLock(projectId, token);
};

/** Requests an explicit writer handoff from another editor and retries claim. */
export const requestCloudWriterTakeover = (): void => {
	const state = useCloudWriterLeaseStore.getState();
	if (!state.projectId || state.mode === "writer") return;
	const editorInstanceId = getEditorSessionDescriptor().editorInstanceId;
	setLeaseState({ ...state, mode: "acquiring" });
	announce({
		kind: "takeover",
		projectId: state.projectId,
		editorInstanceId,
	});
	const token = generation;
	retryTimer = globalThis.setTimeout(
		() => attemptLock(state.projectId as string, token),
		180,
	);
};

/** True only for the editor currently holding this project's writer lock. */
export const canWriteCloudProject = (projectId: string): boolean => {
	const state = useCloudWriterLeaseStore.getState();
	return state.projectId === projectId && state.mode === "writer";
};
