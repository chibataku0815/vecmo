import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type {
	AgentBridgeProjectSaveMode,
	AgentBridgeProjectSaveRequest,
	AgentBridgeProjectSaveResult,
	AgentBridgeProjectSaveSummary,
} from "@/entities/agent/model/bridge-protocol";
import {
	AGENT_CONTRACT_VERSION,
	type AgentCommandPlanApproval,
} from "@/entities/agent/model/types";
import {
	activateCloudWriterLease,
	canWriteCloudProject,
	useCloudWriterLeaseStore,
} from "@/entities/editor-session/model/cloud-writer-lease";
import {
	captureEditorBindingFence,
	editorRouteForCurrentWorkingCopy,
	getEditorSessionDescriptor,
	isEditorBindingFenceCurrent,
	rebindEditorSession,
} from "@/entities/editor-session/model/session";
import {
	createWorkingCopyTextAdapter,
	readWorkingCopySnapshot,
	serializeWorkingCopySnapshot,
} from "@/entities/editor-session/model/working-copy-repository";
import { initialMotionDocument } from "@/entities/motion/model/seed-motion";
import { restoreMotionDocumentFromSerialized } from "@/entities/motion/model/serialization";
import { useMotionStore } from "@/entities/motion/model/store";
import { parseMotionGrammarLayer } from "@/entities/motion-grammar/model/parse";
import { useMotionGrammarStore } from "@/entities/motion-grammar/model/store";
import { scanLegacyPathBlurSeeds } from "@/entities/scene/model/legacy-path-blur-seed";
import {
	blankSceneDocument,
	initialSceneDocument,
} from "@/entities/scene/model/seed-scene";
import {
	allNodes,
	selectCurrentArtboard,
} from "@/entities/scene/model/selectors";
import {
	restoreSceneDocumentFromSerialized,
	serializeSceneDocument,
} from "@/entities/scene/model/serialization";
import { useSceneStore } from "@/entities/scene/model/store";
import type { SceneDocument } from "@/entities/scene/model/types";
import { useAgentBridgeStore } from "@/features/agent/model/approval-store";
import {
	pruneOrphanedMotion,
	scanDocumentMotionHealth,
} from "@/features/agent/model/orphan-motion";
import { deriveAgentCloudProjectName } from "@/features/cloud-projects/model/agent-save-name";
import {
	createCloudProject,
	readCloudProject,
	readCloudProjectRevision,
	updateCloudProject,
} from "@/features/cloud-projects/model/api";
import {
	type ActiveCloudProject,
	hydrateEditorCloudProjectState,
	readLegacyEditorCloudProjectState,
	serializeEditorCloudProjectState,
	useEditorCloudProjectStore,
} from "@/features/cloud-projects/model/editor-cloud-project-store";
import { cloudProjectFingerprint } from "@/features/cloud-projects/model/project-fingerprint";
import { findGravityReviewEntry } from "@/features/gravity-review/model/catalog";
import { loadGravityReviewProject } from "@/features/gravity-review/model/load";
import { useTransportStore } from "@/features/motion/model/transport-store";
import {
	projectBackupFileName,
	projectBackupMimeType,
	restorePortableProject,
	serializeProjectBackup,
} from "@/features/project-backup/model/project-backup";
import { findReferenceScene } from "@/features/reference-scenes/model/registry";
import { useSelectionStore } from "@/features/selection/model/store";
import { downloadTextFile } from "@/shared/lib/download";
import {
	createDebouncedPersistenceWriter,
	createLocalStorageTextAdapter,
} from "@/shared/lib/persistence";
import { platformCapabilities } from "@/shared/platform/mode";
import { AgentApprovalBanner } from "@/widgets/agent-bridge/ui/AgentApprovalBanner";
import { type AppRoute, resolveAppRoute } from "./routes";

const EditorPage = lazy(() =>
	import("@/pages/editor/ui/EditorPage").then((module) => ({
		default: module.EditorPage,
	})),
);

const UpdatesPage = lazy(() =>
	import("@/pages/updates/ui/UpdatesPage").then((module) => ({
		default: module.UpdatesPage,
	})),
);

/**
 * Lazy-loaded so the tutorial gallery — and the ~120KB of reference-scene
 * fixtures it pulls in — ship as their own chunk instead of in the main bundle
 * that every `/editor` visit downloads.
 */
const TutorialsPage = lazy(() =>
	import("@/pages/tutorials/ui/TutorialsPage").then((module) => ({
		default: module.TutorialsPage,
	})),
);

const LOCAL_SCENE_STORAGE_KEY = "vector-motion-author:scene-document:v1";
const LOCAL_MOTION_STORAGE_KEY = "vector-motion-author:motion-document:v1";
const LEGACY_DOCUMENT_MIGRATION_KEY =
	"vector-motion-author:migration:working-copy:v1";
const LOCAL_SCENE_SAVE_DELAY_MS = 500;
const CLOUD_PROJECT_AUTOSAVE_DELAY_MS = 2800;
const LEGACY_DEMO_SEED_COMPARISON_DATE = "1970-01-01T00:00:00.000Z";
const LEGACY_DEMO_SEED_PAYLOAD = serializeSceneDocument(initialSceneDocument, {
	savedAt: LEGACY_DEMO_SEED_COMPARISON_DATE,
});

const ignorePersistenceError = () => undefined;

const currentCloudProjectPayload = (): {
	readonly name: string;
	readonly documentJson: string;
	readonly fingerprint: string;
} => {
	const scene = useSceneStore.getState().document;
	const motion = useMotionStore.getState().document;
	const grammar = useMotionGrammarStore.getState().document;
	return {
		name: scene.name,
		documentJson: serializeProjectBackup(scene, motion, { grammar }),
		fingerprint: cloudProjectFingerprint({ scene, motion, grammar }),
	};
};

const BLANK_EDITOR_FINGERPRINT = cloudProjectFingerprint({
	scene: blankSceneDocument,
	motion: initialMotionDocument,
	grammar: { bindings: [], passthrough: [] },
});

const currentEditorHasLocalWork = (): boolean =>
	currentCloudProjectPayload().fingerprint !== BLANK_EDITOR_FINGERPRINT;

const sceneWithProjectName = (
	document: SceneDocument,
	projectName: string,
): SceneDocument => {
	const name = projectName.trim();
	if (name.length === 0 || document.name === name) return document;
	return { ...document, name };
};

const replaceEditorRoute = (): void => {
	globalThis.history.replaceState(null, "", editorRouteForCurrentWorkingCopy());
	globalThis.dispatchEvent(new PopStateEvent("popstate"));
};

const resetEditorToBlankProject = (): void => {
	useEditorCloudProjectStore.getState().clearActiveProject();
	useSceneStore.getState().reset(blankSceneDocument);
	useMotionStore.getState().reset(initialMotionDocument);
	useMotionGrammarStore.getState().reset();
	useSelectionStore.getState().clearSelection();
	useTransportStore.getState().stop();
	replaceEditorRoute();
};

const downloadCurrentProjectBackup = (): void => {
	const payload = currentCloudProjectPayload();
	downloadTextFile(
		projectBackupFileName(payload.name),
		projectBackupMimeType(),
		payload.documentJson,
	);
};

const isLegacyDemoSeedDocument = (
	document: typeof initialSceneDocument,
): boolean =>
	serializeSceneDocument(document, {
		savedAt: LEGACY_DEMO_SEED_COMPARISON_DATE,
	}) === LEGACY_DEMO_SEED_PAYLOAD;

const useWorkingCopyPersistence = ({
	onHydrated,
}: {
	readonly onHydrated?: () => void;
} = {}) => {
	const manualFlushRef = useRef<() => Promise<void>>(async () => undefined);
	useEffect(() => {
		let disposed = false;
		let hydrated = false;
		let unsubscribe: (() => void) | undefined;
		const adapter = createWorkingCopyTextAdapter();
		const writer = createDebouncedPersistenceWriter<string>({
			delayMs: LOCAL_SCENE_SAVE_DELAY_MS,
			save: adapter.save,
			onError: ignorePersistenceError,
		});
		const snapshot = () =>
			serializeWorkingCopySnapshot(
				currentCloudProjectPayload().documentJson,
				serializeEditorCloudProjectState(),
			);
		const flushNow = async (): Promise<void> => {
			if (!hydrated) return;
			if (!writer.pending()) writer.schedule(snapshot());
			await writer.flush();
		};
		const flush = () => {
			void flushNow().catch(ignorePersistenceError);
		};
		manualFlushRef.current = flushNow;
		const persistSnapshot = () => writer.schedule(snapshot());
		const subscribeToChanges = () => {
			const unsubscribeScene = useSceneStore.subscribe((state, previous) => {
				if (state.document !== previous.document) persistSnapshot();
			});
			const unsubscribeMotion = useMotionStore.subscribe((state, previous) => {
				if (state.document !== previous.document) persistSnapshot();
			});
			const unsubscribeGrammar = useMotionGrammarStore.subscribe(
				(state, previous) => {
					if (state.document !== previous.document) persistSnapshot();
				},
			);
			const unsubscribeCloud =
				useEditorCloudProjectStore.subscribe(persistSnapshot);
			unsubscribe = () => {
				unsubscribeScene();
				unsubscribeMotion();
				unsubscribeGrammar();
				unsubscribeCloud();
			};
		};
		const restoreLegacy = async (): Promise<boolean> => {
			const params = new URLSearchParams(globalThis.location.search);
			if (params.has("cloudProject") || params.has("newProject")) return false;
			const migrate = async (): Promise<boolean> => {
				try {
					if (
						globalThis.localStorage.getItem(LEGACY_DOCUMENT_MIGRATION_KEY) ===
						"complete"
					) {
						return false;
					}
				} catch {
					// Continue: old keys remain read-only and the commit decides success.
				}
				const [sceneLoaded, motionLoaded] = await Promise.all([
					createLocalStorageTextAdapter({
						key: LOCAL_SCENE_STORAGE_KEY,
					}).load(),
					createLocalStorageTextAdapter({
						key: LOCAL_MOTION_STORAGE_KEY,
					}).load(),
				]);
				let found = false;
				if (sceneLoaded.status === "found") {
					const restored = restoreSceneDocumentFromSerialized(
						sceneLoaded.value,
						blankSceneDocument,
					);
					if (restored.source === "persisted") {
						useSceneStore
							.getState()
							.reset(
								isLegacyDemoSeedDocument(restored.document)
									? blankSceneDocument
									: restored.document,
							);
						found = true;
					}
				}
				if (motionLoaded.status === "found") {
					const restored = restoreMotionDocumentFromSerialized(
						motionLoaded.value,
						initialMotionDocument,
					);
					if (restored.source === "persisted") {
						const { grammar, ...motion } = restored.document;
						useMotionStore.getState().reset(motion);
						if (grammar) {
							const parsed = parseMotionGrammarLayer(grammar);
							useMotionGrammarStore.getState().load({
								bindings: parsed.bindings,
								passthrough: parsed.passthrough,
								diagnostics: parsed.issues,
							});
						}
						found = true;
					}
				}
				if (!found) return false;
				const legacyCloud = readLegacyEditorCloudProjectState();
				if (legacyCloud) hydrateEditorCloudProjectState(legacyCloud);
				const committed = await adapter.save(snapshot());
				if (committed.status !== "saved") return false;
				try {
					globalThis.localStorage.setItem(
						LEGACY_DOCUMENT_MIGRATION_KEY,
						"complete",
					);
				} catch {
					// The committed namespaced snapshot is sufficient for safe retry.
				}
				return true;
			};
			const locks = globalThis.navigator?.locks;
			return locks
				? locks.request(
						"vector-motion-author:legacy-working-copy-migration",
						{ mode: "exclusive" },
						migrate,
					)
				: migrate();
		};

		void adapter
			.load()
			.then(async (loaded) => {
				if (disposed) return;
				let restoredUnified = false;
				if (loaded.status === "found") {
					const workingCopy = readWorkingCopySnapshot(loaded.value);
					const restored = restorePortableProject(workingCopy.projectJson);
					if (restored.status === "ok") {
						restoredUnified = true;
						if (
							workingCopy.format === "working-copy" &&
							workingCopy.cloudStateJson
						) {
							hydrateEditorCloudProjectState(workingCopy.cloudStateJson);
						}
						useSceneStore.getState().reset(restored.scene);
						useMotionStore
							.getState()
							.reset(restored.motion ?? initialMotionDocument);
						if (restored.grammar) {
							useMotionGrammarStore.getState().load(restored.grammar);
						} else {
							useMotionGrammarStore.getState().reset();
						}
					}
				}
				if (!restoredUnified) await restoreLegacy();
				if (!disposed) {
					hydrated = true;
					subscribeToChanges();
				}
			})
			.catch(ignorePersistenceError)
			.finally(() => {
				if (!disposed) {
					useAgentBridgeStore.getState().setSceneHydrated(true);
					onHydrated?.();
				}
			});

		globalThis.addEventListener("pagehide", flush);
		return () => {
			disposed = true;
			unsubscribe?.();
			globalThis.removeEventListener("pagehide", flush);
			flush();
			manualFlushRef.current = async () => undefined;
		};
	}, [onHydrated]);
	return useCallback(() => manualFlushRef.current(), []);
};

const activeCloudProjectFromResult = (
	project: ActiveCloudProject,
): ActiveCloudProject => ({
	id: project.id,
	name: project.name,
	revision: project.revision,
	contentHash: project.contentHash,
	updatedAt: project.updatedAt,
});

const projectSaveSummaryFromResult = (
	project: ActiveCloudProject,
): AgentBridgeProjectSaveSummary => ({
	id: project.id,
	name: project.name,
	revision: project.revision,
	updatedAt: project.updatedAt,
	contentHash: project.contentHash,
});

const projectSaveResult = ({
	mode,
	status,
	message,
	changed = false,
	project,
	conflictProject,
}: {
	readonly mode: AgentBridgeProjectSaveMode;
	readonly status: AgentBridgeProjectSaveResult["status"];
	readonly message: string;
	readonly changed?: boolean;
	readonly project?: ActiveCloudProject;
	readonly conflictProject?: ActiveCloudProject;
}): AgentBridgeProjectSaveResult => ({
	contractVersion: AGENT_CONTRACT_VERSION,
	ok: status === "saved" || status === "already-saved",
	op: "save-project",
	mode,
	status,
	message,
	changed,
	...(project ? { project: projectSaveSummaryFromResult(project) } : {}),
	...(conflictProject
		? { conflictProject: projectSaveSummaryFromResult(conflictProject) }
		: {}),
});

const supersededProjectSaveResult = (
	mode: AgentBridgeProjectSaveMode,
): AgentBridgeProjectSaveResult =>
	projectSaveResult({
		mode,
		status: "busy",
		message: "A newer cloud save superseded this result.",
	});

const projectNameForAgentSave = (
	request: AgentBridgeProjectSaveRequest,
	mode: AgentBridgeProjectSaveMode,
): string => {
	const scene = useSceneStore.getState().document;
	const motion = useMotionStore.getState().document;
	const grammar = useMotionGrammarStore.getState().document;
	return deriveAgentCloudProjectName({
		explicitName: request.name,
		intent: request.intent,
		mode,
		activeProjectName:
			useEditorCloudProjectStore.getState().activeProject?.name ?? null,
		scene,
		motion,
		grammar,
	});
};

const saveLiveProjectForAgent = async (
	request: AgentBridgeProjectSaveRequest,
	approval: AgentCommandPlanApproval,
): Promise<AgentBridgeProjectSaveResult> => {
	const mode = request.mode ?? "save";
	const payload = currentCloudProjectPayload();
	const cloud = useEditorCloudProjectStore.getState();
	const projectName = projectNameForAgentSave(request, mode);

	if (!approval.approved) {
		return projectSaveResult({
			mode,
			status: "rejected",
			message: approval.note ?? "Cloud save was rejected in the editor.",
		});
	}
	if (cloud.saveStatus === "saving") {
		return projectSaveResult({
			mode,
			status: "busy",
			message: "A cloud save is already in progress.",
			...(cloud.activeProject ? { project: cloud.activeProject } : {}),
		});
	}
	if (mode === "save" && cloud.saveStatus === "conflict") {
		return projectSaveResult({
			mode,
			status: "conflict",
			message:
				"Cloud has a newer revision. Open the latest revision, save as new, or resolve the conflict first.",
			...(cloud.activeProject ? { project: cloud.activeProject } : {}),
			...(cloud.conflictProject
				? { conflictProject: cloud.conflictProject }
				: {}),
		});
	}
	if (
		mode === "save" &&
		cloud.activeProject &&
		!canWriteCloudProject(cloud.activeProject.id)
	) {
		return projectSaveResult({
			mode,
			status: "busy",
			message:
				"This editor is in review mode. Take over writing or save as a copy.",
			project: cloud.activeProject,
		});
	}
	if (
		mode === "save" &&
		cloud.activeProject &&
		cloud.lastSavedFingerprint === payload.fingerprint
	) {
		cloud.markSavedIfUnchanged(payload.fingerprint);
		return projectSaveResult({
			mode,
			status: "already-saved",
			message: "The live editor project is already saved to cloud.",
			project: cloud.activeProject,
		});
	}

	const saveAttemptId = useEditorCloudProjectStore.getState().beginSave();
	const saveFence = captureEditorBindingFence();
	const result =
		mode === "save" && cloud.activeProject
			? await updateCloudProject(cloud.activeProject.id, {
					name: projectName,
					documentJson: payload.documentJson,
					baseRevision: cloud.activeProject.revision,
				})
			: await createCloudProject({
					name: projectName,
					documentJson: payload.documentJson,
				});
	if (!isEditorBindingFenceCurrent(saveFence)) {
		const accepted = useEditorCloudProjectStore
			.getState()
			.failSave(
				"The editor changed projects before the save completed.",
				"generic",
				saveAttemptId,
			);
		return projectSaveResult({
			mode,
			status: "busy",
			message: accepted
				? "The editor changed projects before the save completed."
				: "A newer cloud save superseded this result.",
		});
	}
	if (
		mode === "save" &&
		cloud.activeProject &&
		!canWriteCloudProject(cloud.activeProject.id)
	) {
		const accepted = useEditorCloudProjectStore
			.getState()
			.failSave(
				"Writer ownership changed before the save completed.",
				"generic",
				saveAttemptId,
			);
		return projectSaveResult({
			mode,
			status: "busy",
			message: accepted
				? "Writer ownership changed before the save completed."
				: "A newer cloud save superseded this result.",
		});
	}

	if (result.kind === "ok") {
		const activeProject = activeCloudProjectFromResult(result.project);
		const accepted = useEditorCloudProjectStore
			.getState()
			.finishSave(activeProject, payload.fingerprint, saveAttemptId);
		if (!accepted) return supersededProjectSaveResult(mode);
		return projectSaveResult({
			mode,
			status: "saved",
			message:
				mode === "save" && cloud.activeProject
					? "Updated the live editor cloud project."
					: "Saved the live editor project as a cloud project.",
			changed: true,
			project: activeProject,
		});
	}
	if (result.kind === "conflict") {
		const accepted = useEditorCloudProjectStore
			.getState()
			.conflictSave(result.project, saveAttemptId);
		if (!accepted) return supersededProjectSaveResult(mode);
		return projectSaveResult({
			mode,
			status: "conflict",
			message:
				"Cloud has a newer revision. Open the latest revision, save as new, or resolve the conflict first.",
			...(cloud.activeProject ? { project: cloud.activeProject } : {}),
			...(result.project ? { conflictProject: result.project } : {}),
		});
	}
	if (result.kind === "unauthenticated") {
		const accepted = useEditorCloudProjectStore
			.getState()
			.failSave("Sign in to save cloud projects.", "generic", saveAttemptId);
		if (!accepted) return supersededProjectSaveResult(mode);
		return projectSaveResult({
			mode,
			status: "unauthenticated",
			message: "Sign in to save cloud projects.",
		});
	}
	if (result.kind === "not_found") {
		const accepted = useEditorCloudProjectStore
			.getState()
			.failSave(
				"This cloud project is no longer available. Your document is still open locally.",
				"project-not-found",
				saveAttemptId,
			);
		if (!accepted) return supersededProjectSaveResult(mode);
		return projectSaveResult({
			mode,
			status: "not-found",
			message:
				"This cloud project is no longer available. Save as new or continue locally.",
		});
	}
	if (result.kind === "too_large") {
		const accepted = useEditorCloudProjectStore
			.getState()
			.failSave(
				"This project is larger than the cloud project limit.",
				"generic",
				saveAttemptId,
			);
		if (!accepted) return supersededProjectSaveResult(mode);
		return projectSaveResult({
			mode,
			status: "too-large",
			message: "This project is larger than the cloud project limit.",
		});
	}
	if (result.kind === "upgrade_required") {
		const accepted = useEditorCloudProjectStore
			.getState()
			.failSave(result.message, "generic", saveAttemptId);
		if (!accepted) return supersededProjectSaveResult(mode);
		return projectSaveResult({
			mode,
			status: "upgrade-required",
			message: result.message,
		});
	}
	if (result.kind === "quota_exceeded") {
		const accepted = useEditorCloudProjectStore
			.getState()
			.failSave(result.message, "generic", saveAttemptId);
		if (!accepted) return supersededProjectSaveResult(mode);
		return projectSaveResult({
			mode,
			status: "quota-exceeded",
			message: result.message,
		});
	}
	const accepted = useEditorCloudProjectStore
		.getState()
		.failSave(result.message, "generic", saveAttemptId);
	if (!accepted) return supersededProjectSaveResult(mode);
	return projectSaveResult({
		mode,
		status: result.kind === "invalid" ? "invalid" : "failed",
		message: result.message,
	});
};

type ActiveCloudSaveOutcome =
	| "saved"
	| "local-only"
	| "busy"
	| "conflict"
	| "failed";

const saveActiveCloudProjectNow = async (): Promise<ActiveCloudSaveOutcome> => {
	const cloud = useEditorCloudProjectStore.getState();
	const activeProject = cloud.activeProject;
	if (!activeProject) return "local-only";
	if (!canWriteCloudProject(activeProject.id)) return "busy";
	if (cloud.saveStatus === "saving") {
		return "busy";
	}
	if (cloud.saveStatus === "conflict") {
		return "conflict";
	}
	if (
		cloud.saveStatus === "failed" &&
		cloud.saveFailureReason === "project-not-found"
	) {
		return "failed";
	}

	const payload = currentCloudProjectPayload();
	if (
		cloud.lastSavedFingerprint !== null &&
		cloud.lastSavedFingerprint === payload.fingerprint
	) {
		cloud.markSavedIfUnchanged(payload.fingerprint);
		return "saved";
	}

	const saveAttemptId = cloud.beginSave();
	const saveFence = captureEditorBindingFence();
	const result = await updateCloudProject(activeProject.id, {
		name: payload.name,
		documentJson: payload.documentJson,
		baseRevision: activeProject.revision,
	});
	if (!isEditorBindingFenceCurrent(saveFence)) {
		const accepted = useEditorCloudProjectStore
			.getState()
			.failSave(
				"The editor changed projects before the save completed.",
				"generic",
				saveAttemptId,
			);
		if (!accepted) return "busy";
		return "busy";
	}
	if (!canWriteCloudProject(activeProject.id)) {
		const accepted = useEditorCloudProjectStore
			.getState()
			.failSave(
				"Writer ownership changed before the save completed.",
				"generic",
				saveAttemptId,
			);
		if (!accepted) return "busy";
		return "busy";
	}
	if (result.kind === "ok") {
		const accepted = useEditorCloudProjectStore
			.getState()
			.finishSave(
				activeCloudProjectFromResult(result.project),
				payload.fingerprint,
				saveAttemptId,
			);
		if (!accepted) return "busy";
		if (useEditorCloudProjectStore.getState().saveStatus === "dirty") {
			return saveActiveCloudProjectNow();
		}
		return "saved";
	}
	if (result.kind === "conflict") {
		const accepted = useEditorCloudProjectStore
			.getState()
			.conflictSave(result.project, saveAttemptId);
		if (!accepted) return "busy";
		return "conflict";
	}
	if (result.kind === "not_found") {
		const accepted = useEditorCloudProjectStore
			.getState()
			.failSave(
				"This cloud project is no longer available. Your document is still open locally.",
				"project-not-found",
				saveAttemptId,
			);
		if (!accepted) return "busy";
		return "failed";
	}
	if (result.kind === "unauthenticated") {
		const accepted = useEditorCloudProjectStore
			.getState()
			.failSave(
				"Sign in again to save this cloud project.",
				"generic",
				saveAttemptId,
			);
		if (!accepted) return "busy";
		return "failed";
	}
	if (result.kind === "too_large") {
		const accepted = useEditorCloudProjectStore
			.getState()
			.failSave(
				"This project is larger than the cloud project limit.",
				"generic",
				saveAttemptId,
			);
		if (!accepted) return "busy";
		return "failed";
	}
	if (result.kind === "upgrade_required") {
		const accepted = useEditorCloudProjectStore
			.getState()
			.failSave(result.message, "generic", saveAttemptId);
		if (!accepted) return "busy";
		return "failed";
	}
	const accepted = useEditorCloudProjectStore
		.getState()
		.failSave(
			result.kind === "invalid" ? result.message : result.message,
			"generic",
			saveAttemptId,
		);
	if (!accepted) return "busy";
	return "failed";
};

const useActiveCloudProjectAutosave = (): void => {
	useEffect(() => {
		if (!platformCapabilities.cloudProjects) return;
		let disposed = false;
		let timer: number | undefined;
		const scheduleSave = () => {
			if (disposed) return;
			if (!useEditorCloudProjectStore.getState().activeProject) return;
			globalThis.clearTimeout(timer);
			timer = globalThis.setTimeout(() => {
				timer = undefined;
				void saveActiveCloudProjectNow();
			}, CLOUD_PROJECT_AUTOSAVE_DELAY_MS);
		};
		const markDirtyAndSchedule = () => {
			const cloud = useEditorCloudProjectStore.getState();
			if (!cloud.activeProject) return;
			cloud.markDirty();
			const nextCloud = useEditorCloudProjectStore.getState();
			if (
				nextCloud.saveStatus === "failed" &&
				nextCloud.saveFailureReason === "project-not-found"
			) {
				return;
			}
			scheduleSave();
		};
		const unsubscribeScene = useSceneStore.subscribe((state, previous) => {
			if (state.document !== previous.document) markDirtyAndSchedule();
		});
		const unsubscribeMotion = useMotionStore.subscribe((state, previous) => {
			if (state.document !== previous.document) markDirtyAndSchedule();
		});
		const unsubscribeGrammar = useMotionGrammarStore.subscribe(
			(state, previous) => {
				if (state.document !== previous.document) markDirtyAndSchedule();
			},
		);
		const unsubscribeLease = useCloudWriterLeaseStore.subscribe(
			(state, previous) => {
				if (state.mode !== "writer" || previous.mode === "writer") return;
				if (useEditorCloudProjectStore.getState().saveStatus === "dirty") {
					scheduleSave();
				}
			},
		);
		const unsubscribeCloud = useEditorCloudProjectStore.subscribe(
			(state, previous) => {
				if (state.saveStatus === "dirty" && previous.saveStatus === "saving") {
					scheduleSave();
				}
			},
		);
		const flush = () => {
			globalThis.clearTimeout(timer);
			timer = undefined;
			void saveActiveCloudProjectNow();
		};
		globalThis.addEventListener("pagehide", flush);
		return () => {
			disposed = true;
			globalThis.clearTimeout(timer);
			unsubscribeScene();
			unsubscribeMotion();
			unsubscribeGrammar();
			unsubscribeLease();
			unsubscribeCloud();
			globalThis.removeEventListener("pagehide", flush);
		};
	}, []);
};

const useCloudProjectWriterLease = (): void => {
	useEffect(() => {
		if (!platformCapabilities.cloudProjects) return;
		const sync = () =>
			activateCloudWriterLease(
				useEditorCloudProjectStore.getState().activeProject?.id ?? null,
			);
		sync();
		const unsubscribe = useEditorCloudProjectStore.subscribe(
			(state, previous) => {
				if (state.activeProject?.id !== previous.activeProject?.id) sync();
			},
		);
		return () => {
			unsubscribe();
			activateCloudWriterLease(null);
		};
	}, []);
};

const useActiveCloudProjectHydrationReconcile = (
	localDocumentsHydrated: boolean,
): void => {
	useEffect(() => {
		if (!platformCapabilities.cloudProjects) return;
		if (!localDocumentsHydrated) return;
		const cloud = useEditorCloudProjectStore.getState();
		if (!cloud.activeProject) return;
		if (
			cloud.saveStatus === "saved" &&
			useSceneStore.getState().document.name !== cloud.activeProject.name
		) {
			useSceneStore
				.getState()
				.reset(
					sceneWithProjectName(
						useSceneStore.getState().document,
						cloud.activeProject.name,
					),
				);
		}
		const fingerprint = currentCloudProjectPayload().fingerprint;
		if (cloud.lastSavedFingerprint === fingerprint) {
			cloud.markSavedIfUnchanged(fingerprint);
			return;
		}
		cloud.markDirty();
	}, [localDocumentsHydrated]);
};

type CurrentRoute = AppRoute & {
	readonly search: string;
};

const readCurrentRoute = (): CurrentRoute => ({
	...resolveAppRoute(globalThis.location.pathname),
	search: globalThis.location.search,
});

const useCurrentRoute = () => {
	const [route, setRoute] = useState(readCurrentRoute);

	useEffect(() => {
		const syncRoute = () => setRoute(readCurrentRoute());
		globalThis.addEventListener("popstate", syncRoute);
		return () => globalThis.removeEventListener("popstate", syncRoute);
	}, []);

	return route;
};

const shouldEnableProductionAgentBridge = (): boolean => {
	if (!platformCapabilities.productionAgentBridge) return false;
	const params = new URLSearchParams(globalThis.location.search);
	return params.get("agentBridge") === "1";
};

type CloudProjectOpenTarget = {
	readonly projectId: string;
	readonly revision?: number;
};

const readCloudProjectOpenTarget = (): CloudProjectOpenTarget | undefined => {
	const params = new URLSearchParams(globalThis.location.search);
	const id = params.get("cloudProject");
	const trimmed = id?.trim();
	if (!trimmed || trimmed.length === 0) return undefined;
	const revisionValue = params.get("cloudRevision");
	if (revisionValue === null || revisionValue.trim().length === 0) {
		return { projectId: trimmed };
	}
	const revision = Number(revisionValue);
	return Number.isInteger(revision) && revision >= 1
		? { projectId: trimmed, revision }
		: { projectId: trimmed };
};

const readNewProjectRequest = (): boolean => {
	const params = new URLSearchParams(globalThis.location.search);
	return params.get("newProject") === "1";
};

type PendingCloudOpen = {
	readonly projectId: string;
	readonly revision?: number;
} & PendingEditorReplacement;

type PendingEditorReplacement = {
	readonly canSaveFirst: boolean;
	readonly busyLabel: "saving" | "opening" | null;
	readonly errorMessage: string | null;
};

const guardedCloudSaveStatuses = new Set([
	"dirty",
	"saving",
	"failed",
	"conflict",
]);

function CloudProjectReplaceDialog({
	mode = "cloud-project",
	pending,
	onBackup,
	onCancel,
	onReplace,
	onSaveFirst,
}: {
	readonly mode?: "cloud-project" | "new-project";
	readonly pending: PendingEditorReplacement;
	readonly onBackup: () => void;
	readonly onCancel: () => void;
	readonly onReplace: () => void;
	readonly onSaveFirst: () => void;
}) {
	const busy = pending.busyLabel !== null;
	const newProject = mode === "new-project";
	const primaryProtectLabel = pending.canSaveFirst
		? pending.busyLabel === "saving"
			? "Saving..."
			: "Save current project first"
		: "Download local backup";
	const primaryProtectDetail = pending.canSaveFirst
		? newProject
			? "Update the attached cloud project before starting a new one."
			: "Update the attached cloud project before opening another."
		: "Keep a portable copy before replacing this local document.";
	const destructiveLabel =
		pending.busyLabel === "opening"
			? newProject
				? "Starting..."
				: "Opening..."
			: newProject
				? "Start without saving"
				: "Replace without saving";
	return (
		<div className="fixed inset-0 z-[80] grid place-items-center bg-scrim/55 px-4 text-ui [color-scheme:dark]">
			<div className="w-[min(92vw,420px)] rounded-md border border-hairline/16 bg-surface-raised p-3 text-fg shadow-2xl shadow-black/50">
				<div className="font-medium leading-4">
					{newProject
						? "Protect current work before starting?"
						: "Protect current work before opening?"}
				</div>
				<div className="mt-1 text-fg-secondary leading-4">
					{pending.canSaveFirst
						? newProject
							? "Starting a new project replaces the editor contents. Save the current cloud project first, download a backup, or start without saving."
							: "Opening the selected cloud project replaces the editor contents. Save the current cloud project first, download a backup, or replace without saving."
						: newProject
							? "This document is local-only in the editor. Download a backup before starting a new project, or start without saving."
							: "This document is local-only in the editor. Download a backup before replacing it, or replace without saving."}
				</div>
				{pending.errorMessage ? (
					<div className="mt-2 rounded border border-danger/35 bg-danger-surface px-2 py-1 text-danger-fg leading-3">
						{pending.errorMessage}
					</div>
				) : null}
				<div className="mt-3 grid gap-1.5">
					<button
						type="button"
						className="grid min-h-8 grid-cols-[minmax(0,1fr)] rounded-md border border-accent/35 bg-accent-surface px-2 py-1 text-left font-medium text-accent-fg leading-3 hover:bg-accent-surface/80 disabled:opacity-45"
						disabled={busy}
						onClick={pending.canSaveFirst ? onSaveFirst : onBackup}
					>
						<span>{primaryProtectLabel}</span>
						<span className="font-normal text-fg-secondary">
							{primaryProtectDetail}
						</span>
					</button>
					{pending.canSaveFirst ? (
						<button
							type="button"
							className="grid min-h-8 rounded-md border border-hairline/12 bg-surface-sunken px-2 py-1 text-left text-fg-secondary leading-3 hover:bg-white/8 hover:text-fg disabled:opacity-45"
							disabled={busy}
							onClick={onBackup}
						>
							<span className="font-medium text-fg">Download local backup</span>
							<span>Save a portable copy before replacing the editor.</span>
						</button>
					) : null}
					<div className="grid grid-cols-2 gap-1.5">
						<button
							type="button"
							className="h-7 rounded-md border border-danger/35 bg-danger-surface px-2 font-medium text-danger-fg hover:bg-danger-surface/80 disabled:opacity-45"
							disabled={busy}
							onClick={onReplace}
						>
							{destructiveLabel}
						</button>
						<button
							type="button"
							className="h-7 rounded-md border border-hairline/12 bg-surface-sunken px-2 text-fg-secondary hover:bg-white/8 hover:text-fg disabled:opacity-45"
							disabled={busy}
							onClick={onCancel}
						>
							Keep editing
						</button>
					</div>
				</div>
				<div className="mt-2 text-fg-muted leading-3">
					Backup and local export remain available even if cloud save is
					blocked.
				</div>
			</div>
		</div>
	);
}

const useCloudProjectUrlLoad = (
	projectId: string | undefined,
	revision: number | undefined,
	readyForCloudOpen: boolean,
) => {
	const [pendingOpen, setPendingOpen] = useState<PendingCloudOpen | null>(null);
	const restoreCloudProject = useCallback(
		async (target: CloudProjectOpenTarget): Promise<boolean> => {
			const openFence = captureEditorBindingFence();
			const openingFingerprint = currentCloudProjectPayload().fingerprint;
			let project: {
				readonly id: string;
				readonly name: string;
				readonly revision: number;
				readonly contentHash: string | null;
				readonly updatedAt: string;
				readonly documentJson: string;
				readonly current: boolean;
			};
			if (target.revision === undefined) {
				const result = await readCloudProject(target.projectId);
				if (result.kind !== "ok") {
					if (result.kind === "not_found") {
						const cloud = useEditorCloudProjectStore.getState();
						if (cloud.activeProject?.id === target.projectId) {
							cloud.failSave(
								"This cloud project is no longer available. Your document is still open locally.",
								"project-not-found",
							);
						}
					}
					window.alert(
						result.kind === "unauthenticated"
							? "Sign in to open this cloud project."
							: result.kind === "not_found"
								? "Cloud project was not found."
								: result.message,
					);
					return false;
				}
				project = {
					id: result.project.id,
					name: result.project.name,
					revision: result.project.revision,
					contentHash: result.project.contentHash,
					updatedAt: result.project.updatedAt,
					documentJson: result.project.documentJson,
					current: true,
				};
			} else {
				const result = await readCloudProjectRevision(
					target.projectId,
					target.revision,
				);
				if (result.kind !== "ok") {
					window.alert(
						result.kind === "unauthenticated"
							? "Sign in to open this cloud project."
							: result.kind === "not_found"
								? "Cloud project revision was not found."
								: result.message,
					);
					return false;
				}
				project = {
					id: result.revision.projectId,
					name: result.revision.projectName,
					revision: result.revision.revision,
					contentHash: result.revision.contentHash,
					updatedAt: result.revision.projectUpdatedAt,
					documentJson: result.revision.documentJson,
					current: result.revision.current,
				};
			}
			const restored = restorePortableProject(project.documentJson);
			if (restored.status !== "ok") {
				window.alert("The saved cloud project could not be restored.");
				return false;
			}
			if (
				!isEditorBindingFenceCurrent(openFence) ||
				currentCloudProjectPayload().fingerprint !== openingFingerprint
			) {
				return false;
			}
			rebindEditorSession(project.current ? project.id : null);

			useSceneStore
				.getState()
				.reset(
					project.current
						? sceneWithProjectName(restored.scene, project.name)
						: restored.scene,
				);
			if (restored.motion) useMotionStore.getState().reset(restored.motion);
			if (restored.grammar) {
				useMotionGrammarStore.getState().load(restored.grammar);
			} else {
				useMotionGrammarStore.getState().reset();
			}
			useSelectionStore.getState().clearSelection();
			useTransportStore.getState().stop();
			const fingerprint = currentCloudProjectPayload().fingerprint;
			if (project.current) {
				useEditorCloudProjectStore.getState().finishSave(
					{
						id: project.id,
						name: project.name,
						revision: project.revision,
						contentHash: project.contentHash,
						updatedAt: project.updatedAt,
					},
					fingerprint,
				);
			} else {
				useEditorCloudProjectStore.getState().clearActiveProject();
			}
			replaceEditorRoute();
			return true;
		},
		[],
	);

	useEffect(() => {
		if (!platformCapabilities.cloudProjects) return;
		if (projectId === undefined) return;
		if (!readyForCloudOpen) return;
		let cancelled = false;
		void (async () => {
			const cloud = useEditorCloudProjectStore.getState();
			if (
				(cloud.activeProject &&
					guardedCloudSaveStatuses.has(cloud.saveStatus)) ||
				(!cloud.activeProject && currentEditorHasLocalWork())
			) {
				setPendingOpen((current) =>
					current?.projectId === projectId && current.revision === revision
						? current
						: {
								projectId,
								...(revision !== undefined ? { revision } : {}),
								canSaveFirst: cloud.activeProject !== null,
								busyLabel: null,
								errorMessage: null,
							},
				);
				return;
			}
			const target: CloudProjectOpenTarget =
				revision === undefined ? { projectId } : { projectId, revision };
			const opened = await restoreCloudProject(target);
			if (!cancelled && !opened) {
				replaceEditorRoute();
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [projectId, readyForCloudOpen, restoreCloudProject, revision]);

	const updatePending = (
		update: Partial<Omit<PendingCloudOpen, "projectId" | "revision">>,
	): void => {
		setPendingOpen((current) =>
			current
				? {
						...current,
						...update,
					}
				: current,
		);
	};

	const openPendingProject = async (): Promise<void> => {
		const pending = pendingOpen;
		if (!pending) return;
		updatePending({ busyLabel: "opening", errorMessage: null });
		const target: CloudProjectOpenTarget =
			pending.revision === undefined
				? { projectId: pending.projectId }
				: { projectId: pending.projectId, revision: pending.revision };
		const opened = await restoreCloudProject(target);
		if (opened) {
			setPendingOpen(null);
		} else {
			updatePending({
				busyLabel: null,
				errorMessage: "The selected cloud project could not be opened.",
			});
		}
	};

	const saveThenOpenPendingProject = async (): Promise<void> => {
		const pending = pendingOpen;
		if (!pending) return;
		if (!pending.canSaveFirst) {
			updatePending({
				errorMessage:
					"This is a local-only document. Download a backup or replace it.",
			});
			return;
		}
		updatePending({ busyLabel: "saving", errorMessage: null });
		const saveOutcome = await saveActiveCloudProjectNow();
		const cloud = useEditorCloudProjectStore.getState();
		if (saveOutcome !== "saved") {
			updatePending({
				busyLabel: null,
				errorMessage:
					saveOutcome === "conflict" || cloud.saveStatus === "conflict"
						? "Cloud changed elsewhere. Save this work as a copy or download a backup before replacing it."
						: saveOutcome === "busy"
							? "A cloud save is already in progress. Wait for it to finish or download a backup before replacing."
							: (cloud.errorMessage ?? "Cloud save failed."),
			});
			return;
		}
		await openPendingProject();
	};

	const cancelPendingOpen = (): void => {
		setPendingOpen(null);
		replaceEditorRoute();
	};

	return pendingOpen ? (
		<CloudProjectReplaceDialog
			pending={pendingOpen}
			onBackup={downloadCurrentProjectBackup}
			onCancel={cancelPendingOpen}
			onReplace={() => void openPendingProject()}
			onSaveFirst={() => void saveThenOpenPendingProject()}
		/>
	) : null;
};

const useNewProjectUrlLoad = (
	requested: boolean,
	readyForNewProject: boolean,
) => {
	const [pendingOpen, setPendingOpen] =
		useState<PendingEditorReplacement | null>(null);

	useEffect(() => {
		if (!requested) return;
		if (!readyForNewProject) return;
		const cloud = useEditorCloudProjectStore.getState();
		if (
			(cloud.activeProject && guardedCloudSaveStatuses.has(cloud.saveStatus)) ||
			(!cloud.activeProject && currentEditorHasLocalWork())
		) {
			setPendingOpen((current) =>
				current
					? current
					: {
							canSaveFirst: cloud.activeProject !== null,
							busyLabel: null,
							errorMessage: null,
						},
			);
			return;
		}
		resetEditorToBlankProject();
	}, [readyForNewProject, requested]);

	const updatePending = (
		update: Partial<Omit<PendingEditorReplacement, "canSaveFirst">>,
	): void => {
		setPendingOpen((current) =>
			current
				? {
						...current,
						...update,
					}
				: current,
		);
	};

	const startNewProject = (): void => {
		resetEditorToBlankProject();
		setPendingOpen(null);
	};

	const saveThenStartNewProject = async (): Promise<void> => {
		const pending = pendingOpen;
		if (!pending) return;
		if (!pending.canSaveFirst) {
			updatePending({
				errorMessage:
					"This is a local-only document. Download a backup or start without saving.",
			});
			return;
		}
		updatePending({ busyLabel: "saving", errorMessage: null });
		const saveOutcome = await saveActiveCloudProjectNow();
		const cloud = useEditorCloudProjectStore.getState();
		if (saveOutcome !== "saved") {
			updatePending({
				busyLabel: null,
				errorMessage:
					saveOutcome === "conflict" || cloud.saveStatus === "conflict"
						? "Cloud changed elsewhere. Save this work as a copy or download a backup before starting a new project."
						: saveOutcome === "busy"
							? "A cloud save is already in progress. Wait for it to finish or download a backup before starting a new project."
							: (cloud.errorMessage ?? "Cloud save failed."),
			});
			return;
		}
		startNewProject();
	};

	const cancelPendingOpen = (): void => {
		setPendingOpen(null);
		replaceEditorRoute();
	};

	return pendingOpen ? (
		<CloudProjectReplaceDialog
			mode="new-project"
			pending={pendingOpen}
			onBackup={downloadCurrentProjectBackup}
			onCancel={cancelPendingOpen}
			onReplace={startNewProject}
			onSaveFirst={() => void saveThenStartNewProject()}
		/>
	) : null;
};

/**
 * Live agent bridge. Dev keeps the loopback relay; production is an explicit
 * opt-in session (`?agentBridge=1`) that connects to the Worker/Durable Object
 * relay. Local dev bridge auto-approves apply/save for iteration speed;
 * production bridge sessions still land mutations only after the approval
 * banner accepts them.
 */
const useAgentBridge = () => {
	useEffect(() => {
		const productionBridge = shouldEnableProductionAgentBridge();
		if (!import.meta.env.DEV && !productionBridge) return;
		let dispose: (() => void) | undefined;
		let cancelled = false;
		void Promise.all([
			import("@/features/agent/model/editor-bridge"),
			import("@/widgets/canvas-shell/model/agent-preview-capture"),
		]).then(
			([
				{
					createEditorBridgeConnection,
					createProductionEditorBridgeConnection,
				},
				{ createAgentPreviewCaptureCapability },
			]) => {
				if (cancelled) return;
				// Inject the live selection so agent reviews (and the observe_selection
				// MCP tool) can read the user's current selection and focused artboard
				// instead of a hand-supplied node id.
				const getLiveSelectionSnapshot = () => {
					const selection = useSelectionStore.getState();
					return {
						nodeIds: selection.nodeIds,
						selectedArtboardId: selection.selectedArtboardId,
						selectedSceneCamera: selection.sceneCamera,
						currentArtboardId: selectCurrentArtboard(
							useSceneStore.getState().document,
						).id,
						currentFrame: useTransportStore.getState().currentFrame,
					};
				};
				const getProjectSaveApprovalPreview = (
					request: AgentBridgeProjectSaveRequest,
				) => {
					const mode = request.mode ?? "save";
					return {
						projectName: projectNameForAgentSave(request, mode),
						activeProjectName:
							useEditorCloudProjectStore.getState().activeProject?.name ?? null,
					};
				};
				const bridgeOptions = {
					getLiveSelectionSnapshot,
					getProjectSaveApprovalPreview,
					saveProject: saveLiveProjectForAgent,
					// Read-only native artboard capture engine (Phase D). Built here in
					// the app layer and injected so `features/agent` never imports the
					// widget capture engine, the transport store, or the export raster
					// path — same seam as saveProject / getLiveSelectionSnapshot.
					previewCapture: createAgentPreviewCaptureCapability(),
				};
				dispose = productionBridge
					? createProductionEditorBridgeConnection(bridgeOptions)
					: createEditorBridgeConnection(bridgeOptions);
			},
		);
		return () => {
			cancelled = true;
			dispose?.();
		};
	}, []);
};

const pruneSelectionToSceneDocument = (): void => {
	const sceneDocument = useSceneStore.getState().document;
	const liveNodeIds = new Set(allNodes(sceneDocument).map((node) => node.id));
	const selection = useSelectionStore.getState();
	const nextNodeIds = selection.nodeIds.filter((nodeId) =>
		liveNodeIds.has(nodeId),
	);
	const nextPrimary =
		selection.primary && liveNodeIds.has(selection.primary)
			? selection.primary
			: (nextNodeIds.at(-1) ?? null);
	const subNodeId = selection.sub?.nodeId;
	const subIsStale = subNodeId !== undefined && !liveNodeIds.has(subNodeId);

	if (
		nextNodeIds.length === selection.nodeIds.length &&
		nextPrimary === selection.primary &&
		!subIsStale
	) {
		return;
	}
	if (nextNodeIds.length === 0) {
		useSelectionStore.getState().clearSelection();
		return;
	}
	useSelectionStore.getState().setSelection(nextNodeIds, nextPrimary);
};

const useSelectionScenePrune = (): void => {
	useEffect(() => {
		pruneSelectionToSceneDocument();
		const unsubscribeScene = useSceneStore.subscribe((state, previous) => {
			if (state.document !== previous.document) pruneSelectionToSceneDocument();
		});
		return () => unsubscribeScene();
	}, []);
};

/**
 * Watches the three document stores and auto-repairs orphaned motion before it
 * can block live agent editing, while still reporting legacy auto-seeded Path
 * Blur nodes to the agent UI store. Gated on scene hydration so it never scans
 * live motion against a not-yet-loaded scene. If a repair somehow leaves
 * orphans behind, the health card remains as a fallback instead of hiding a
 * broken state.
 */
const useDocumentHealthMonitor = () => {
	const sceneHydrated = useAgentBridgeStore((state) => state.sceneHydrated);
	const lastAutoRepairSignature = useRef<string | null>(null);
	useEffect(() => {
		if (!sceneHydrated) return;
		let disposed = false;
		let rescanQueued = false;
		const rescan = () => {
			const bridgeStore = useAgentBridgeStore.getState();
			const motionHealth = scanDocumentMotionHealth();
			if (motionHealth) {
				const signature = [
					useSceneStore.getState().document.id,
					motionHealth.trackCount,
					motionHealth.sourceOpticsTrackCount,
					motionHealth.bindingCount,
					useMotionStore.getState().document.tracks.length,
					useMotionStore.getState().document.sourceOpticsTracks?.length ?? 0,
					useMotionGrammarStore.getState().document.bindings.length,
				].join(":");
				if (lastAutoRepairSignature.current !== signature) {
					lastAutoRepairSignature.current = signature;
					pruneOrphanedMotion();
					bridgeStore.setDocumentHealth(scanDocumentMotionHealth());
				} else {
					bridgeStore.setDocumentHealth(motionHealth);
				}
			} else {
				lastAutoRepairSignature.current = null;
				bridgeStore.setDocumentHealth(null);
			}
			const seedScan = scanLegacyPathBlurSeeds(
				useSceneStore.getState().document,
			);
			bridgeStore.setLegacyPathBlurSeeds(seedScan.count > 0 ? seedScan : null);
		};
		const scheduleRescan = (): void => {
			if (rescanQueued) return;
			rescanQueued = true;
			queueMicrotask(() => {
				rescanQueued = false;
				if (!disposed) rescan();
			});
		};
		rescan();
		const unsubscribeScene = useSceneStore.subscribe((state, previous) => {
			if (state.document !== previous.document) scheduleRescan();
		});
		const unsubscribeMotion = useMotionStore.subscribe((state, previous) => {
			if (state.document !== previous.document) scheduleRescan();
		});
		const unsubscribeGrammar = useMotionGrammarStore.subscribe(
			(state, previous) => {
				if (state.document !== previous.document) scheduleRescan();
			},
		);
		return () => {
			disposed = true;
			unsubscribeScene();
			unsubscribeMotion();
			unsubscribeGrammar();
		};
	}, [sceneHydrated]);
};

function EditorRoute({
	cloudProjectId,
	cloudRevision,
	newProjectRequested,
}: {
	readonly cloudProjectId?: string;
	readonly cloudRevision?: number;
	readonly newProjectRequested?: boolean;
}) {
	const [localDocumentsHydrated, setLocalDocumentsHydrated] = useState(false);
	const markLocalDocumentsHydrated = useCallback(
		() => setLocalDocumentsHydrated(true),
		[],
	);
	const session = getEditorSessionDescriptor();
	const flushWorkingCopy = useWorkingCopyPersistence({
		onHydrated: markLocalDocumentsHydrated,
	});
	const saveEditor = useCallback(async () => {
		await flushWorkingCopy().catch(ignorePersistenceError);
		const activeProject = useEditorCloudProjectStore.getState().activeProject;
		if (activeProject && canWriteCloudProject(activeProject.id)) {
			try {
				await saveActiveCloudProjectNow();
			} finally {
				await flushWorkingCopy().catch(ignorePersistenceError);
			}
		}
	}, [flushWorkingCopy]);
	useCloudProjectWriterLease();
	useEffect(() => {
		const syncTitle = () => {
			const cloud = useEditorCloudProjectStore.getState();
			const writer = useCloudWriterLeaseStore.getState();
			const projectName =
				cloud.activeProject?.name ?? useSceneStore.getState().document.name;
			const cloudState = cloud.activeProject
				? `r${cloud.activeProject.revision} · ${writer.mode === "writer" ? "Writer" : "Review"} · ${cloud.saveStatus === "saved" ? "Synced" : "Unsaved"}`
				: "Local";
			document.title = `${projectName} · ${cloudState} · ${session.workingCopyId.slice(-6)} · Vecmo`;
		};
		syncTitle();
		const unsubscribeScene = useSceneStore.subscribe(syncTitle);
		const unsubscribeCloud = useEditorCloudProjectStore.subscribe(syncTitle);
		const unsubscribeWriter = useCloudWriterLeaseStore.subscribe(syncTitle);
		return () => {
			unsubscribeScene();
			unsubscribeCloud();
			unsubscribeWriter();
		};
	}, [session.workingCopyId]);
	useSelectionScenePrune();
	useActiveCloudProjectAutosave();
	useActiveCloudProjectHydrationReconcile(localDocumentsHydrated);
	const cloudOpenDialog = useCloudProjectUrlLoad(
		cloudProjectId,
		cloudRevision,
		cloudProjectId === undefined || localDocumentsHydrated,
	);
	const newProjectDialog = useNewProjectUrlLoad(
		Boolean(newProjectRequested && cloudProjectId === undefined),
		localDocumentsHydrated,
	);
	useDocumentHealthMonitor();
	useAgentBridge();
	return (
		<>
			<Suspense fallback={null}>
				<EditorPage
					onSave={saveEditor}
					saveAvailable={localDocumentsHydrated}
				/>
			</Suspense>
			{cloudOpenDialog}
			{newProjectDialog}
			<AgentApprovalBanner />
		</>
	);
}

/**
 * Reads a `?ref=<slug>` reference-scene request from the editor URL, returning
 * the slug only when it resolves to a real fixture. An unknown slug falls back
 * to `undefined` so the editor opens the user's own document instead of a blank.
 */
const readReferenceSceneSlug = (): string | undefined => {
	const slug = new URLSearchParams(globalThis.location.search).get("ref");
	if (!slug) return undefined;
	return findReferenceScene(slug) ? slug : undefined;
};

/** Resolves only the closed, dev-only Gravity review catalog. */
const readGravityReviewSlug = (): string | undefined => {
	if (!import.meta.env.DEV) return undefined;
	const slug = new URLSearchParams(globalThis.location.search).get(
		"gravityReview",
	);
	if (!slug) return undefined;
	return findGravityReviewEntry(slug) ? slug : undefined;
};

/**
 * Hydrates one fixed internal candidate through the ordinary portable-project
 * reader. This route omits all working-copy/cloud persistence just like a
 * reference session, so a review never replaces the user's document.
 */
const useGravityReviewLoad = (slug: string): void => {
	useEffect(() => {
		let cancelled = false;
		void (async () => {
			const payload = await loadGravityReviewProject(slug);
			if (cancelled || payload.status !== "ok") return;
			const restored = restorePortableProject(payload.payload);
			if (restored.status !== "ok" || cancelled) return;
			useSceneStore.getState().reset(restored.scene);
			useMotionStore.getState().reset(restored.motion ?? initialMotionDocument);
			if (restored.grammar) {
				useMotionGrammarStore.getState().load(restored.grammar);
			} else {
				useMotionGrammarStore.getState().reset();
			}
			useSelectionStore.getState().clearSelection();
			useTransportStore.getState().stop();
		})();
		return () => {
			cancelled = true;
		};
	}, [slug]);
};

/**
 * Loads a reference scene into the live stores exactly as the editor hydrates a
 * reopened document — scene, motion, and grammar in lockstep — then cues the
 * playhead to the scene's poster frame so motion reads as motion. This runs only
 * inside `ReferenceEditorRoute`, which omits the persistence hooks, so the load
 * is ephemeral and never overwrites the user's autosaved document. The fixture
 * payload and resolver are imported dynamically so the ~120KB of reference scenes
 * never ship in the main bundle — only opening a reference pulls them.
 */
const useReferenceSceneLoad = (slug: string): void => {
	useEffect(() => {
		let cancelled = false;
		void (async () => {
			const [{ findReferenceFixture }, { resolveReferenceScene }] =
				await Promise.all([
					import("@/features/reference-scenes/fixtures"),
					import("@/features/reference-scenes/model/resolve"),
				]);
			if (cancelled) return;
			const fixture = findReferenceFixture(slug);
			if (!fixture) return;
			const resolved = resolveReferenceScene(fixture);
			useSceneStore.getState().reset(resolved.scene);
			useMotionStore.getState().reset(resolved.motion);
			useMotionGrammarStore.getState().load(resolved.grammar);
			const meta = findReferenceScene(slug);
			if (meta) useTransportStore.getState().setFrame(meta.posterFrame);
		})();
		return () => {
			cancelled = true;
		};
	}, [slug]);
};

/**
 * Editor opened from the tutorial gallery via `/editor?ref=<slug>`. It loads the
 * reference scene but runs NO local persistence: the user's saved document is
 * neither read nor written for the session, so browsing a reference can never
 * clobber their work. Reloading plain `/editor` restores their document.
 */
function ReferenceEditorRoute({ slug }: { readonly slug: string }) {
	useReferenceSceneLoad(slug);
	useAgentBridge();
	return (
		<>
			<Suspense fallback={null}>
				<EditorPage referenceTutorialSlug={slug} saveAvailable={false} />
			</Suspense>
			<AgentApprovalBanner />
		</>
	);
}

/** Internal review route for existing Gravity artifacts; never persisted or public. */
function GravityReviewEditorRoute({ slug }: { readonly slug: string }) {
	useGravityReviewLoad(slug);
	useAgentBridge();
	return (
		<>
			<Suspense fallback={null}>
				<EditorPage gravityReviewSlug={slug} saveAvailable={false} />
			</Suspense>
			<AgentApprovalBanner />
		</>
	);
}

export function App() {
	const route = useCurrentRoute();

	if (route.kind === "editor") {
		const referenceSlug = readReferenceSceneSlug();
		const gravityReviewSlug = readGravityReviewSlug();
		const cloudOpenTarget = readCloudProjectOpenTarget();
		const newProjectRequested = readNewProjectRequest();
		if (gravityReviewSlug) {
			return <GravityReviewEditorRoute slug={gravityReviewSlug} />;
		}
		return referenceSlug ? (
			<ReferenceEditorRoute slug={referenceSlug} />
		) : (
			<EditorRoute
				cloudProjectId={cloudOpenTarget?.projectId}
				cloudRevision={cloudOpenTarget?.revision}
				newProjectRequested={newProjectRequested}
			/>
		);
	}
	if (route.kind === "updates")
		return (
			<Suspense fallback={null}>
				<UpdatesPage />
			</Suspense>
		);
	if (route.kind === "tutorials")
		return (
			<Suspense fallback={null}>
				<TutorialsPage />
			</Suspense>
		);
	const ExtensionPage = route.component;
	return (
		<Suspense fallback={null}>
			<ExtensionPage />
		</Suspense>
	);
}
