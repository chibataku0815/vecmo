import {
	beginRevisionedSave,
	createRevisionedSaveState,
	markRevisionChanged,
	rejectRevisionedSave,
	resolveRevisionedSave,
} from "@motion-surface/editor-kernel";
import { create } from "zustand";
import {
	editorSessionStorageKey,
	rebindEditorSession,
} from "@/entities/editor-session/model/session";
import type { CloudProjectSummary } from "./api";

const LEGACY_CLOUD_PROJECT_SESSION_KEY =
	"vector-motion-author:active-cloud-project:v1" as const;
const cloudProjectSessionKey = (): string =>
	editorSessionStorageKey("active-cloud-project:v1");

export type ActiveCloudProject = Pick<
	CloudProjectSummary,
	"id" | "name" | "revision" | "contentHash" | "updatedAt"
>;

export type EditorCloudSaveStatus =
	| "local-only"
	| "saved"
	| "dirty"
	| "saving"
	| "failed"
	| "conflict";

export type EditorCloudSaveFailureReason = "generic" | "project-not-found";

type EditorCloudProjectState = {
	readonly activeProject: ActiveCloudProject | null;
	readonly saveStatus: EditorCloudSaveStatus;
	readonly pendingDirty: boolean;
	readonly lastSavedAt: string | null;
	readonly lastSavedFingerprint: string | null;
	readonly errorMessage: string | null;
	readonly saveFailureReason: EditorCloudSaveFailureReason | null;
	readonly conflictProject: CloudProjectSummary | null;
	readonly setActiveProject: (project: ActiveCloudProject | null) => void;
	readonly markDirty: () => void;
	readonly beginSave: () => number;
	readonly finishSave: (
		project: ActiveCloudProject,
		fingerprint?: string | null,
		attemptId?: number,
	) => boolean;
	readonly updateActiveProject: (project: ActiveCloudProject) => void;
	readonly markSavedIfUnchanged: (fingerprint: string) => void;
	readonly failSave: (
		message: string,
		reason?: EditorCloudSaveFailureReason,
		attemptId?: number,
	) => boolean;
	readonly conflictSave: (
		project: CloudProjectSummary | null,
		attemptId?: number,
	) => boolean;
	readonly dismissConflict: () => void;
	readonly clearActiveProject: () => void;
};

type PersistedEditorCloudProjectState = {
	readonly activeProject: ActiveCloudProject | null;
	readonly saveStatus: Exclude<EditorCloudSaveStatus, "saving">;
	readonly pendingDirty: boolean;
	readonly lastSavedAt: string | null;
	readonly lastSavedFingerprint: string | null;
	readonly errorMessage: string | null;
	readonly saveFailureReason: EditorCloudSaveFailureReason | null;
	readonly conflictProject: CloudProjectSummary | null;
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isActiveCloudProject = (value: unknown): value is ActiveCloudProject =>
	isRecord(value) &&
	typeof value.id === "string" &&
	typeof value.name === "string" &&
	Number.isInteger(value.revision) &&
	(value.contentHash === null || typeof value.contentHash === "string") &&
	typeof value.updatedAt === "string";

const isCloudProjectSummary = (
	value: unknown,
): value is CloudProjectSummary => {
	if (!isRecord(value)) return false;
	const byteLength = value.byteLength;
	const storageProvider = value.storageProvider;
	const createdAt = value.createdAt;
	return (
		isActiveCloudProject(value) &&
		typeof byteLength === "number" &&
		(storageProvider === "d1" || storageProvider === "r2") &&
		typeof createdAt === "string"
	);
};

const isPersistedStatus = (
	value: unknown,
): value is PersistedEditorCloudProjectState["saveStatus"] =>
	value === "local-only" ||
	value === "saved" ||
	value === "dirty" ||
	value === "failed" ||
	value === "conflict";

const isSaveFailureReason = (
	value: unknown,
): value is EditorCloudSaveFailureReason =>
	value === "generic" || value === "project-not-found";

const readPersistedState = (): PersistedEditorCloudProjectState => {
	if (typeof globalThis.localStorage === "undefined") {
		return {
			activeProject: null,
			saveStatus: "local-only",
			pendingDirty: false,
			lastSavedAt: null,
			lastSavedFingerprint: null,
			errorMessage: null,
			saveFailureReason: null,
			conflictProject: null,
		};
	}
	try {
		const raw = globalThis.localStorage.getItem(cloudProjectSessionKey());
		if (!raw) {
			return {
				activeProject: null,
				saveStatus: "local-only",
				pendingDirty: false,
				lastSavedAt: null,
				lastSavedFingerprint: null,
				errorMessage: null,
				saveFailureReason: null,
				conflictProject: null,
			};
		}
		const parsed: unknown = JSON.parse(raw);
		if (!isRecord(parsed)) {
			throw new Error("Invalid cloud project state");
		}
		const activeProject = isActiveCloudProject(parsed.activeProject)
			? parsed.activeProject
			: null;
		const saveStatus =
			activeProject && isPersistedStatus(parsed.saveStatus)
				? parsed.saveStatus
				: "local-only";
		return {
			activeProject,
			saveStatus,
			pendingDirty:
				activeProject !== null &&
				typeof parsed.pendingDirty === "boolean" &&
				parsed.pendingDirty,
			lastSavedAt:
				typeof parsed.lastSavedAt === "string" ? parsed.lastSavedAt : null,
			lastSavedFingerprint:
				typeof parsed.lastSavedFingerprint === "string"
					? parsed.lastSavedFingerprint
					: null,
			errorMessage:
				typeof parsed.errorMessage === "string" ? parsed.errorMessage : null,
			saveFailureReason:
				saveStatus === "failed" && isSaveFailureReason(parsed.saveFailureReason)
					? parsed.saveFailureReason
					: null,
			conflictProject: isCloudProjectSummary(parsed.conflictProject)
				? parsed.conflictProject
				: null,
		};
	} catch {
		globalThis.localStorage.removeItem(cloudProjectSessionKey());
		return {
			activeProject: null,
			saveStatus: "local-only",
			pendingDirty: false,
			lastSavedAt: null,
			lastSavedFingerprint: null,
			errorMessage: null,
			saveFailureReason: null,
			conflictProject: null,
		};
	}
};

const persistState = (state: EditorCloudProjectState): void => {
	if (typeof globalThis.localStorage === "undefined") return;
	if (!state.activeProject) {
		globalThis.localStorage.removeItem(cloudProjectSessionKey());
		return;
	}
	const persisted: PersistedEditorCloudProjectState = {
		activeProject: state.activeProject,
		saveStatus: state.saveStatus === "saving" ? "dirty" : state.saveStatus,
		pendingDirty: state.pendingDirty || state.saveStatus === "saving",
		lastSavedAt: state.lastSavedAt,
		lastSavedFingerprint: state.lastSavedFingerprint,
		errorMessage: state.errorMessage,
		saveFailureReason:
			state.saveStatus === "failed" ? state.saveFailureReason : null,
		conflictProject: state.conflictProject,
	};
	globalThis.localStorage.setItem(
		cloudProjectSessionKey(),
		JSON.stringify(persisted),
	);
};

const persisted = readPersistedState();
if (persisted.activeProject) {
	rebindEditorSession(persisted.activeProject.id);
}

let nextSaveToken = persisted.pendingDirty ? 1 : 0;
let nextSaveAttemptId = 0;
let saveProtocol = createRevisionedSaveState<number, number>(0);
if (persisted.pendingDirty) {
	saveProtocol = markRevisionChanged(saveProtocol, nextSaveToken);
}

const resetSaveProtocol = (dirty: boolean): void => {
	nextSaveToken = dirty ? 1 : 0;
	saveProtocol = createRevisionedSaveState<number, number>(0);
	if (dirty) saveProtocol = markRevisionChanged(saveProtocol, nextSaveToken);
};

const recordSaveChange = (): void => {
	nextSaveToken += 1;
	saveProtocol = markRevisionChanged(saveProtocol, nextSaveToken);
};

const startSaveAttempt = (): number => {
	const attemptId = ++nextSaveAttemptId;
	saveProtocol = beginRevisionedSave(saveProtocol, attemptId);
	return attemptId;
};

const settleSaveAttempt = (attemptId: number): "clean" | "dirty" | null => {
	const transition = resolveRevisionedSave(saveProtocol, attemptId);
	if (!transition.accepted) return null;
	saveProtocol = transition.state;
	return saveProtocol.status === "clean" ? "clean" : "dirty";
};

const rejectSaveAttempt = (attemptId: number): boolean => {
	const transition = rejectRevisionedSave(saveProtocol, attemptId);
	if (!transition.accepted) return false;
	saveProtocol = transition.state;
	return true;
};

/**
 * Editor-session pointer to the cloud project currently loaded in the local
 * stores. The pointer is persisted separately from browser-local document
 * bodies: a refreshed editor can keep updating the same cloud project, while
 * local scene/motion persistence remains the offline source of recoverability.
 */
export const useEditorCloudProjectStore = create<EditorCloudProjectState>()(
	(set, get) => ({
		activeProject: persisted.activeProject,
		saveStatus: persisted.activeProject ? persisted.saveStatus : "local-only",
		pendingDirty: persisted.pendingDirty,
		lastSavedAt: persisted.lastSavedAt,
		lastSavedFingerprint: persisted.lastSavedFingerprint,
		errorMessage: persisted.errorMessage,
		saveFailureReason:
			persisted.saveStatus === "failed" ? persisted.saveFailureReason : null,
		conflictProject:
			persisted.saveStatus === "conflict" ? persisted.conflictProject : null,
		setActiveProject: (project) => {
			resetSaveProtocol(false);
			rebindEditorSession(project?.id ?? null);
			set({
				activeProject: project,
				saveStatus: project ? "saved" : "local-only",
				pendingDirty: false,
				lastSavedAt: project?.updatedAt ?? null,
				lastSavedFingerprint: null,
				errorMessage: null,
				saveFailureReason: null,
				conflictProject: null,
			});
			persistState(get());
		},
		markDirty: () => {
			const state = get();
			if (!state.activeProject) return;
			recordSaveChange();
			if (state.saveStatus === "saving") {
				set({ pendingDirty: true });
				persistState(get());
				return;
			}
			if (state.saveStatus === "conflict") return;
			if (
				state.saveStatus === "failed" &&
				state.saveFailureReason === "project-not-found"
			) {
				set({ pendingDirty: true });
				persistState(get());
				return;
			}
			set({
				saveStatus: "dirty",
				pendingDirty: false,
				errorMessage: null,
				saveFailureReason: null,
			});
			persistState(get());
		},
		beginSave: () => {
			const attemptId = startSaveAttempt();
			set({
				saveStatus: "saving",
				pendingDirty: false,
				errorMessage: null,
				saveFailureReason: null,
				conflictProject: null,
			});
			persistState(get());
			return attemptId;
		},
		finishSave: (project, fingerprint = null, attemptId) => {
			const state = get();
			let protocolStatus: "clean" | "dirty" | null;
			if (attemptId === undefined) {
				resetSaveProtocol(false);
				protocolStatus = "clean";
			} else {
				protocolStatus = settleSaveAttempt(attemptId);
			}
			if (protocolStatus === null) return false;
			if (state.activeProject?.id !== project.id) {
				rebindEditorSession(project.id);
			}
			set({
				activeProject: project,
				saveStatus:
					state.pendingDirty || protocolStatus === "dirty" ? "dirty" : "saved",
				pendingDirty: false,
				lastSavedAt: project.updatedAt,
				lastSavedFingerprint: fingerprint ?? state.lastSavedFingerprint,
				errorMessage: null,
				saveFailureReason: null,
				conflictProject: null,
			});
			persistState(get());
			return true;
		},
		updateActiveProject: (project) => {
			const state = get();
			if (state.activeProject?.id !== project.id) return;
			set({
				activeProject: project,
				lastSavedAt: project.updatedAt,
			});
			persistState(get());
		},
		markSavedIfUnchanged: (fingerprint) => {
			const state = get();
			if (!state.activeProject || state.lastSavedFingerprint !== fingerprint) {
				return;
			}
			if (state.saveStatus === "saving" || state.saveStatus === "conflict") {
				return;
			}
			if (
				state.saveStatus === "failed" &&
				state.saveFailureReason === "project-not-found"
			) {
				return;
			}
			resetSaveProtocol(false);
			set({
				saveStatus: "saved",
				pendingDirty: false,
				errorMessage: null,
				saveFailureReason: null,
			});
			persistState(get());
		},
		failSave: (message, reason = "generic", attemptId) => {
			const state = get();
			if (attemptId === undefined)
				resetSaveProtocol(state.activeProject !== null);
			else if (!rejectSaveAttempt(attemptId)) return false;
			set({
				saveStatus: state.activeProject ? "failed" : "local-only",
				pendingDirty: state.activeProject !== null,
				errorMessage: message,
				saveFailureReason: state.activeProject ? reason : null,
				conflictProject: null,
			});
			persistState(get());
			return true;
		},
		conflictSave: (project, attemptId) => {
			const state = get();
			if (!state.activeProject) return false;
			if (attemptId === undefined) resetSaveProtocol(true);
			else if (!rejectSaveAttempt(attemptId)) return false;
			set({
				saveStatus: "conflict",
				pendingDirty: true,
				errorMessage: null,
				saveFailureReason: null,
				conflictProject: project,
			});
			persistState(get());
			return true;
		},
		dismissConflict: () => {
			const state = get();
			if (!state.activeProject) return;
			recordSaveChange();
			set({
				saveStatus: "dirty",
				pendingDirty: false,
				conflictProject: null,
				errorMessage: null,
				saveFailureReason: null,
			});
			persistState(get());
		},
		clearActiveProject: () => {
			resetSaveProtocol(false);
			rebindEditorSession(null);
			set({
				activeProject: null,
				saveStatus: "local-only",
				pendingDirty: false,
				lastSavedAt: null,
				lastSavedFingerprint: null,
				errorMessage: null,
				saveFailureReason: null,
				conflictProject: null,
			});
			persistState(get());
		},
	}),
);

/** Serializes the complete cloud binding/save state for the atomic Working Copy. */
export const serializeEditorCloudProjectState = (): string => {
	const state = useEditorCloudProjectStore.getState();
	const snapshot: PersistedEditorCloudProjectState = {
		activeProject: state.activeProject,
		saveStatus: state.saveStatus === "saving" ? "dirty" : state.saveStatus,
		pendingDirty: state.pendingDirty || state.saveStatus === "saving",
		lastSavedAt: state.lastSavedAt,
		lastSavedFingerprint: state.lastSavedFingerprint,
		errorMessage: state.errorMessage,
		saveFailureReason:
			state.saveStatus === "failed" ? state.saveFailureReason : null,
		conflictProject: state.conflictProject,
	};
	return JSON.stringify(snapshot);
};

/**
 * Makes the cloud state stored beside the document body authoritative during
 * hydration, preventing a newer standalone pointer from pairing with an older
 * local body after a crash.
 */
export const hydrateEditorCloudProjectState = (serialized: string): boolean => {
	try {
		const parsed: unknown = JSON.parse(serialized);
		if (!isRecord(parsed)) return false;
		const activeProject = isActiveCloudProject(parsed.activeProject)
			? parsed.activeProject
			: null;
		const saveStatus =
			activeProject && isPersistedStatus(parsed.saveStatus)
				? parsed.saveStatus
				: "local-only";
		const next = {
			activeProject,
			saveStatus,
			pendingDirty:
				activeProject !== null &&
				typeof parsed.pendingDirty === "boolean" &&
				parsed.pendingDirty,
			lastSavedAt:
				typeof parsed.lastSavedAt === "string" ? parsed.lastSavedAt : null,
			lastSavedFingerprint:
				typeof parsed.lastSavedFingerprint === "string"
					? parsed.lastSavedFingerprint
					: null,
			errorMessage:
				typeof parsed.errorMessage === "string" ? parsed.errorMessage : null,
			saveFailureReason:
				saveStatus === "failed" && isSaveFailureReason(parsed.saveFailureReason)
					? parsed.saveFailureReason
					: null,
			conflictProject:
				saveStatus === "conflict" &&
				isCloudProjectSummary(parsed.conflictProject)
					? parsed.conflictProject
					: null,
		} satisfies Pick<
			EditorCloudProjectState,
			| "activeProject"
			| "saveStatus"
			| "pendingDirty"
			| "lastSavedAt"
			| "lastSavedFingerprint"
			| "errorMessage"
			| "saveFailureReason"
			| "conflictProject"
		>;
		rebindEditorSession(activeProject?.id ?? null);
		resetSaveProtocol(next.pendingDirty);
		useEditorCloudProjectStore.setState(next);
		persistState(useEditorCloudProjectStore.getState());
		return true;
	} catch {
		return false;
	}
};

/** Read-only legacy input; deletion is intentionally left to a later release. */
export const readLegacyEditorCloudProjectState = (): string | null => {
	try {
		return (
			globalThis.localStorage?.getItem(LEGACY_CLOUD_PROJECT_SESSION_KEY) ?? null
		);
	} catch {
		return null;
	}
};
