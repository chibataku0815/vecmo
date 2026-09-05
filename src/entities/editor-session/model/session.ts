import { recordEditorDiagnostic } from "./diagnostics";

export type ProjectId = string & { readonly __brand: "ProjectId" };
export type WorkingCopyId = string & { readonly __brand: "WorkingCopyId" };
export type EditorInstanceId = string & {
	readonly __brand: "EditorInstanceId";
};
export type BridgeSessionId = string & { readonly __brand: "BridgeSessionId" };
export type DevInstanceId = string & { readonly __brand: "DevInstanceId" };

export type EditorSessionDescriptor = {
	readonly editorInstanceId: EditorInstanceId;
	readonly workingCopyId: WorkingCopyId;
	readonly projectId: ProjectId | null;
	readonly bindingEpoch: number;
};

export type EditorBindingFence = EditorSessionDescriptor;

const WORKING_COPY_QUERY_KEY = "workingCopy";
const LAST_WORKING_COPY_KEY = "vector-motion-author:last-working-copy:v1";
const WORKING_COPY_OWNER_PREFIX = "vector-motion-author:working-copy-owner:";
const WORKING_COPY_FORK_SOURCE_PREFIX =
	"vector-motion-author:working-copy-fork-source:";
const OWNER_FRESH_MS = 15_000;
const RUNTIME_DESCRIPTOR_KEY = "__vmaEditorSessionDescriptorV1";

/** The one working-copy record that also lives in the IndexedDB repository. */
export const WORKING_COPY_SNAPSHOT_SUFFIX = "snapshot:v1";
/** Local-only map from a durable link id to the machine's source binding. */
export const PRODUCTION_LINK_REGISTRY_SUFFIX = "production-links:v1";

/**
 * Every working-copy-scoped payload a collision fork must inherit. A suffix
 * missing from this list silently disappears when a second tab forks, which
 * previously made a same-machine link registry look unbound. New working-copy
 * persistence registers here rather than at the copy site.
 */
export const WORKING_COPY_FORK_SUFFIXES = [
	WORKING_COPY_SNAPSHOT_SUFFIX,
	"active-cloud-project:v1",
	PRODUCTION_LINK_REGISTRY_SUFFIX,
] as const;

const createOpaqueId = <T extends string>(prefix: string): T => {
	const entropy =
		globalThis.crypto?.randomUUID?.() ??
		`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
	return `${prefix}_${entropy}` as T;
};

/** Creates a durable identity for one independently persisted editor copy. */
export const createWorkingCopyId = (): WorkingCopyId =>
	createOpaqueId<WorkingCopyId>("wc");

const createEditorInstanceId = (): EditorInstanceId =>
	createOpaqueId<EditorInstanceId>("editor");

const resolveWorkingCopyId = (): WorkingCopyId => {
	const url = new URL(globalThis.location.href);
	const existing = url.searchParams.get(WORKING_COPY_QUERY_KEY)?.trim();
	if (existing) {
		try {
			globalThis.localStorage?.setItem(LAST_WORKING_COPY_KEY, existing);
		} catch {
			// URL identity remains authoritative when storage is restricted.
		}
		return existing as WorkingCopyId;
	}
	if (url.pathname !== "/editor") {
		try {
			const last = globalThis.localStorage?.getItem(LAST_WORKING_COPY_KEY);
			if (last) return last as WorkingCopyId;
		} catch {
			// Fall through to an ephemeral non-editor identity.
		}
		return createWorkingCopyId();
	}
	let created = createWorkingCopyId();
	if (url.searchParams.get("newProject") !== "1") {
		try {
			created =
				(globalThis.localStorage?.getItem(
					LAST_WORKING_COPY_KEY,
				) as WorkingCopyId | null) ?? created;
		} catch {
			// A new isolated copy remains the safe fallback.
		}
	}
	url.searchParams.set(WORKING_COPY_QUERY_KEY, created);
	globalThis.history.replaceState(null, "", url);
	try {
		globalThis.localStorage?.setItem(LAST_WORKING_COPY_KEY, created);
	} catch {
		// URL identity remains authoritative when storage is restricted.
	}
	return created;
};

const readProjectId = (): ProjectId | null => {
	const params = new URLSearchParams(globalThis.location.search);
	const id = (params.get("cloudProject") ?? params.get("project"))?.trim();
	return id ? (id as ProjectId) : null;
};

const isEditorSessionDescriptor = (
	value: unknown,
): value is EditorSessionDescriptor => {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Readonly<Record<string, unknown>>;
	return (
		typeof candidate.editorInstanceId === "string" &&
		typeof candidate.workingCopyId === "string" &&
		(candidate.projectId === null || typeof candidate.projectId === "string") &&
		typeof candidate.bindingEpoch === "number" &&
		Number.isInteger(candidate.bindingEpoch)
	);
};

// Vite can replace this module without unloading the tab. Retaining the runtime
// descriptor prevents the surviving owner heartbeat from looking like a rival tab.
const retainedDescriptor = Reflect.get(globalThis, RUNTIME_DESCRIPTOR_KEY);
let descriptor: EditorSessionDescriptor | undefined = isEditorSessionDescriptor(
	retainedDescriptor,
)
	? retainedDescriptor
	: undefined;
let bindingEpoch = descriptor?.bindingEpoch ?? 1;
let descriptorScope: "editor" | "non-editor" | undefined = descriptor
	? globalThis.location?.pathname === "/editor"
		? "editor"
		: "non-editor"
	: undefined;
let ownerHeartbeat: number | undefined;
const descriptorListeners = new Set<(value: EditorSessionDescriptor) => void>();

/** Subscribes bridge and diagnostics adapters to identity rebinds. */
export const subscribeEditorSessionDescriptor = (
	listener: (value: EditorSessionDescriptor) => void,
): (() => void) => {
	descriptorListeners.add(listener);
	return () => descriptorListeners.delete(listener);
};

/**
 * Returns the identity tuple for the current browser editor. The working-copy
 * identity is written into the URL before persistence starts, so reloads reopen
 * the same local copy while duplicated tabs can be intentionally forked.
 */
export const getEditorSessionDescriptor = (): EditorSessionDescriptor => {
	const scope =
		globalThis.location.pathname === "/editor" ? "editor" : "non-editor";
	if (descriptor && descriptorScope === "non-editor" && scope === "editor") {
		descriptor = undefined;
		bindingEpoch = 1;
		Reflect.deleteProperty(globalThis, RUNTIME_DESCRIPTOR_KEY);
	}
	if (!descriptor) {
		const editorInstanceId = createEditorInstanceId();
		let workingCopyId = resolveWorkingCopyId();
		if (scope === "editor") {
			workingCopyId = claimWorkingCopyIdentity(workingCopyId, editorInstanceId);
		}
		descriptor = {
			editorInstanceId,
			workingCopyId,
			projectId: readProjectId(),
			bindingEpoch,
		};
		descriptorScope = scope;
		Reflect.set(globalThis, RUNTIME_DESCRIPTOR_KEY, descriptor);
		recordEditorDiagnostic({
			event: "session-created",
			workingCopyId: descriptor.workingCopyId,
			projectId: descriptor.projectId,
		});
	}
	return descriptor;
};

const copyWorkingCopyFallback = (
	from: WorkingCopyId,
	to: WorkingCopyId,
): void => {
	for (const suffix of WORKING_COPY_FORK_SUFFIXES) {
		const fromKey = `vector-motion-author:working-copy:${from}:${suffix}`;
		const value = globalThis.localStorage?.getItem(fromKey);
		if (value !== null && value !== undefined) {
			globalThis.localStorage?.setItem(
				`vector-motion-author:working-copy:${to}:${suffix}`,
				value,
			);
		}
	}
};

const claimWorkingCopyIdentity = (
	requested: WorkingCopyId,
	editorInstanceId: EditorInstanceId,
): WorkingCopyId => {
	try {
		const ownerKey = `${WORKING_COPY_OWNER_PREFIX}${requested}`;
		const raw = globalThis.localStorage?.getItem(ownerKey);
		const owner = raw
			? (JSON.parse(raw) as {
					editorInstanceId?: unknown;
					heartbeatAt?: unknown;
				})
			: null;
		const occupied =
			owner &&
			owner.editorInstanceId !== editorInstanceId &&
			typeof owner.heartbeatAt === "number" &&
			Date.now() - owner.heartbeatAt < OWNER_FRESH_MS;
		const workingCopyId = occupied ? createWorkingCopyId() : requested;
		if (occupied) {
			copyWorkingCopyFallback(requested, workingCopyId);
			globalThis.localStorage?.setItem(
				`${WORKING_COPY_FORK_SOURCE_PREFIX}${workingCopyId}`,
				requested,
			);
			const url = new URL(globalThis.location.href);
			url.searchParams.set(WORKING_COPY_QUERY_KEY, workingCopyId);
			globalThis.history.replaceState(null, "", url);
			globalThis.localStorage?.setItem(LAST_WORKING_COPY_KEY, workingCopyId);
		}
		const claimedKey = `${WORKING_COPY_OWNER_PREFIX}${workingCopyId}`;
		const heartbeat = () =>
			globalThis.localStorage?.setItem(
				claimedKey,
				JSON.stringify({ editorInstanceId, heartbeatAt: Date.now() }),
			);
		heartbeat();
		globalThis.clearInterval(ownerHeartbeat);
		ownerHeartbeat = globalThis.setInterval(heartbeat, 5_000);
		globalThis.addEventListener(
			"pagehide",
			() => {
				globalThis.clearInterval(ownerHeartbeat);
				const current = globalThis.localStorage?.getItem(claimedKey);
				if (current?.includes(editorInstanceId)) {
					globalThis.localStorage?.removeItem(claimedKey);
				}
			},
			{ once: true },
		);
		return workingCopyId;
	} catch {
		// Storage-restricted browsers retain URL isolation and cloud CAS safety.
		return requested;
	}
};

/** Captures the complete async-result ownership fence for the current editor. */
export const captureEditorBindingFence = (): EditorBindingFence => ({
	...getEditorSessionDescriptor(),
});

/** Rejects delayed results after any editor, working-copy, or project rebind. */
export const isEditorBindingFenceCurrent = (
	fence: EditorBindingFence,
): boolean => {
	const current = getEditorSessionDescriptor();
	return (
		current.editorInstanceId === fence.editorInstanceId &&
		current.workingCopyId === fence.workingCopyId &&
		current.projectId === fence.projectId &&
		current.bindingEpoch === fence.bindingEpoch
	);
};

/**
 * Single mechanism behind every fence advance. The counter increments before
 * the descriptor is read so a concurrent reader can never observe the old epoch
 * paired with the new binding.
 */
const advanceBindingEpoch = (
	projectId: ProjectId | null,
	event: "session-rebound" | "session-relinked",
): EditorSessionDescriptor => {
	bindingEpoch += 1;
	const current = getEditorSessionDescriptor();
	descriptor = {
		...current,
		projectId,
		bindingEpoch,
	};
	Reflect.set(globalThis, RUNTIME_DESCRIPTOR_KEY, descriptor);
	recordEditorDiagnostic({
		event,
		workingCopyId: descriptor.workingCopyId,
		projectId: descriptor.projectId,
	});
	for (const listener of descriptorListeners) listener(descriptor);
	return descriptor;
};

/** Advances the binding fence whenever this editor changes cloud identity. */
export const rebindEditorSession = (
	projectId: string | null,
): EditorSessionDescriptor =>
	advanceBindingEpoch(
		projectId ? (projectId as ProjectId) : null,
		"session-rebound",
	);

/**
 * Advances the binding fence when a local source binding changes without any
 * cloud identity change. Relinking or unlinking a production source invalidates
 * in-flight companion work that was authorized against the previous binding, so
 * the epoch must move even though the project stays the same.
 */
export const advanceBindingEpochForRelink = (): EditorSessionDescriptor =>
	advanceBindingEpoch(
		getEditorSessionDescriptor().projectId,
		"session-relinked",
	);

/** Keeps the editor locator while removing one-shot open instructions. */
export const editorRouteForCurrentWorkingCopy = (): string => {
	const { projectId, workingCopyId } = getEditorSessionDescriptor();
	const current = new URLSearchParams(globalThis.location.search);
	const params = new URLSearchParams({ workingCopy: workingCopyId });
	if (projectId) params.set("project", projectId);
	if (current.get("agentBridge") === "1") params.set("agentBridge", "1");
	return `/editor?${params.toString()}`;
};

/** Creates a native-link-safe URL for opening an isolated editor runtime. */
export const createEditorOpenUrl = ({
	newProject,
	projectId,
	revision,
}: {
	readonly newProject?: boolean;
	readonly projectId?: string;
	readonly revision?: number;
} = {}): string => {
	const params = new URLSearchParams({ workingCopy: createWorkingCopyId() });
	if (newProject) params.set("newProject", "1");
	if (projectId) params.set("cloudProject", projectId);
	if (revision !== undefined) params.set("cloudRevision", String(revision));
	return `/editor?${params.toString()}`;
};

/** Namespace used by all browser persistence owned by this working copy. */
export const editorSessionStorageKey = (suffix: string): string =>
	workingCopyStorageKey(getEditorSessionDescriptor().workingCopyId, suffix);

/** Builds a persistence key for a specific Working Copy without rebinding it. */
export const workingCopyStorageKey = (
	workingCopyId: WorkingCopyId,
	suffix: string,
): string => `vector-motion-author:working-copy:${workingCopyId}:${suffix}`;

/** Returns the persisted source of a collision-driven Working Copy fork. */
export const readCurrentWorkingCopyForkSource = (): WorkingCopyId | null => {
	try {
		const { workingCopyId } = getEditorSessionDescriptor();
		return (
			(globalThis.localStorage?.getItem(
				`${WORKING_COPY_FORK_SOURCE_PREFIX}${workingCopyId}`,
			) as WorkingCopyId | null) ?? null
		);
	} catch {
		return null;
	}
};

/** Clears a fork marker only after the new Working Copy owns a durable snapshot. */
export const clearCurrentWorkingCopyForkSource = (): void => {
	try {
		const { workingCopyId } = getEditorSessionDescriptor();
		globalThis.localStorage?.removeItem(
			`${WORKING_COPY_FORK_SOURCE_PREFIX}${workingCopyId}`,
		);
	} catch {
		// A restricted storage environment already relies on URL isolation only.
	}
};

Reflect.set(globalThis, "__vmaEditorSession", getEditorSessionDescriptor);
