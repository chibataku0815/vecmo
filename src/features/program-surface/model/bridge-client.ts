import {
	encodeProgramSurfaceBridgeMessage,
	hasProgramSurfaceControlCharacter,
	PROGRAM_SURFACE_BRIDGE_PROTOCOL_VERSION,
	type ProgramSurfaceBridgeApprovedBundleMessage,
	type ProgramSurfaceBridgeBuildCandidateMessage,
	type ProgramSurfaceBridgeBuildStatus,
	type ProgramSurfaceBridgeDiagnostic,
	type ProgramSurfaceBridgeEditorTarget,
	type ProgramSurfaceBridgeManifestListing,
	type ProgramSurfaceBuildIdentity,
	parseProgramSurfaceBridgeServerMessage,
	serializeProgramSurfaceBridgeManifest,
} from "@/entities/scene/model/program-surface-bridge-protocol";

const DISCOVERY_ENDPOINT = "/__program-surface-bridge";
const HEARTBEAT_INTERVAL_MS = 10_000;
const PAIRING_TIMEOUT_MS = 15_000;
const BIND_TIMEOUT_MS = 15_000;
const CANDIDATE_APPROVAL_TIMEOUT_MS = 30_000;

type BridgePhase =
	| "idle"
	| "discovering"
	| "ready-to-pair"
	| "pairing"
	| "paired"
	| "binding"
	| "bound"
	| "closed"
	| "failed";

type PublicDiagnostic = ProgramSurfaceBridgeDiagnostic;

export type ProgramSurfaceBridgeManifestOption = Pick<
	ProgramSurfaceBridgeManifestListing,
	"id" | "name"
>;

/** Candidate metadata only: it never contains bundle bytes or source paths. */
export type ProgramSurfaceBridgeCandidateSnapshot = {
	readonly assetId: string;
	readonly manifestId: string;
	readonly identity: ProgramSurfaceBuildIdentity;
	readonly manifest: ProgramSurfaceBridgeBuildCandidateMessage["manifest"];
	readonly byteLength: number;
	readonly diagnostics: readonly PublicDiagnostic[];
};

/**
 * Inspector-safe bridge state. `lastKnownGood` reports only the companion's
 * build cache; it is deliberately unrelated to Canvas host liveness.
 */
export type ProgramSurfaceBridgeClientSnapshot = {
	readonly phase: BridgePhase;
	readonly bridgeId?: string;
	readonly sessionId?: string;
	readonly binding?: {
		readonly bindingId: string;
		readonly assetId: string;
		readonly manifestId: string;
	};
	readonly manifests: readonly ProgramSurfaceBridgeManifestOption[];
	readonly candidate?: ProgramSurfaceBridgeCandidateSnapshot;
	readonly buildStatus?: ProgramSurfaceBridgeBuildStatus;
	readonly lastKnownGood: boolean;
	/** This transport has no observation authority over the opaque Canvas host. */
	readonly hostState: "not-observed-by-bridge";
	readonly diagnostics: readonly PublicDiagnostic[];
	readonly notice?: string;
	readonly error?: string;
};

export type ProgramSurfaceBridgeDiscovery = {
	readonly bridgeId: string;
	readonly port: number;
	readonly editorOrigin: string;
	readonly startedAt: string;
};

export type ProgramSurfaceBridgeDiscoveryResult =
	| {
			readonly status: "available";
			readonly discovery: ProgramSurfaceBridgeDiscovery;
	  }
	| { readonly status: "unavailable"; readonly reason: string };

export type ProgramSurfaceBridgePairInput = {
	readonly pairingToken: string;
	readonly target: ProgramSurfaceBridgeEditorTarget;
};

export type ProgramSurfaceBridgeBindInput = {
	readonly assetId: string;
	readonly manifestId: string;
	readonly target: ProgramSurfaceBridgeEditorTarget;
};

export type ProgramSurfaceBridgeClient = {
	readonly snapshot: () => ProgramSurfaceBridgeClientSnapshot;
	readonly subscribe: (listener: () => void) => () => void;
	readonly discover: () => Promise<ProgramSurfaceBridgeDiscoveryResult>;
	/** Pairing token is retained only in the hello send closure, then discarded. */
	readonly pair: (input: ProgramSurfaceBridgePairInput) => Promise<void>;
	readonly bind: (input: ProgramSurfaceBridgeBindInput) => Promise<void>;
	/**
	 * Sends one explicit candidate approval and returns its short-lived raw
	 * bundle packet directly to the workflow. The client never stores it.
	 */
	readonly approveCandidate: (
		identity: ProgramSurfaceBuildIdentity,
	) => Promise<ProgramSurfaceBridgeApprovedBundleMessage>;
	/** Lets the workflow fence an approval without exposing target ids in UI state. */
	readonly isBoundToTarget: (
		currentTarget: ProgramSurfaceBridgeEditorTarget,
	) => boolean;
	/** Closes an old fence; no reconnect is scheduled. */
	readonly invalidateIfTargetChanged: (
		currentTarget: ProgramSurfaceBridgeEditorTarget,
	) => void;
	readonly close: () => void;
	readonly dispose: () => void;
};

type ActiveBinding = {
	readonly bindingId: string;
	readonly assetId: string;
	readonly manifestId: string;
	readonly target: ProgramSurfaceBridgeEditorTarget;
};

type PendingPair = {
	readonly resolve: () => void;
	readonly reject: (reason: Error) => void;
	/** Erases the only retained copy if pairing ends before socket open. */
	readonly discardToken: () => void;
};

type PendingBind = {
	readonly input: ProgramSurfaceBridgeBindInput;
	readonly resolve: () => void;
	readonly reject: (reason: Error) => void;
};

type PendingApproval = {
	readonly identity: ProgramSurfaceBuildIdentity;
	readonly resolve: (
		message: ProgramSurfaceBridgeApprovedBundleMessage,
	) => void;
	readonly reject: (reason: Error) => void;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactlyKeys = (
	value: Record<string, unknown>,
	expected: readonly string[],
): boolean =>
	Object.keys(value).length === expected.length &&
	expected.every((key) => Object.hasOwn(value, key));

const isOpaqueText = (value: unknown, maximumLength = 256): value is string =>
	typeof value === "string" &&
	value.length > 0 &&
	value.length <= maximumLength &&
	value.trim() === value &&
	!hasProgramSurfaceControlCharacter(value);

const sameTarget = (
	left: ProgramSurfaceBridgeEditorTarget,
	right: ProgramSurfaceBridgeEditorTarget,
): boolean =>
	left.editorInstanceId === right.editorInstanceId &&
	left.workingCopyId === right.workingCopyId &&
	left.bindingEpoch === right.bindingEpoch;

const immutableTarget = (
	target: ProgramSurfaceBridgeEditorTarget,
): ProgramSurfaceBridgeEditorTarget =>
	Object.freeze({
		editorInstanceId: target.editorInstanceId,
		workingCopyId: target.workingCopyId,
		bindingEpoch: target.bindingEpoch,
	});

const sameIdentity = (
	left: ProgramSurfaceBuildIdentity,
	right: ProgramSurfaceBuildIdentity,
): boolean =>
	left.manifestDigest === right.manifestDigest &&
	left.inputDigest === right.inputDigest &&
	left.compiledDigest === right.compiledDigest &&
	left.generation === right.generation;

const immutableIdentity = (
	identity: ProgramSurfaceBuildIdentity,
): ProgramSurfaceBuildIdentity =>
	Object.freeze({
		manifestDigest: identity.manifestDigest,
		inputDigest: identity.inputDigest,
		compiledDigest: identity.compiledDigest,
		generation: identity.generation,
	});

const freezeJson = (value: unknown): unknown => {
	if (Array.isArray(value)) {
		for (const entry of value) freezeJson(entry);
		return Object.freeze(value);
	}
	if (isRecord(value)) {
		for (const entry of Object.values(value)) freezeJson(entry);
		return Object.freeze(value);
	}
	return value;
};

/**
 * Server candidates were parsed and canonicalized already, but snapshot readers
 * must still not be able to mutate the transport's internal candidate in place.
 */
const immutableManifest = (
	manifest: ProgramSurfaceBridgeBuildCandidateMessage["manifest"],
): ProgramSurfaceBridgeBuildCandidateMessage["manifest"] =>
	freezeJson(
		JSON.parse(serializeProgramSurfaceBridgeManifest(manifest)) as unknown,
	) as ProgramSurfaceBridgeBuildCandidateMessage["manifest"];

const immutableDiagnostic = (diagnostic: PublicDiagnostic): PublicDiagnostic =>
	Object.freeze({ code: diagnostic.code });

const immutableManifestOption = (
	manifest: ProgramSurfaceBridgeManifestOption,
): ProgramSurfaceBridgeManifestOption =>
	Object.freeze({ id: manifest.id, name: manifest.name });

const immutableCandidate = (
	candidate: ProgramSurfaceBridgeCandidateSnapshot,
): ProgramSurfaceBridgeCandidateSnapshot =>
	Object.freeze({
		assetId: candidate.assetId,
		manifestId: candidate.manifestId,
		identity: immutableIdentity(candidate.identity),
		manifest: immutableManifest(candidate.manifest),
		byteLength: candidate.byteLength,
		diagnostics: Object.freeze(candidate.diagnostics.map(immutableDiagnostic)),
	});

const isTarget = (value: ProgramSurfaceBridgeEditorTarget): boolean =>
	Boolean(value) &&
	isOpaqueText(value.editorInstanceId) &&
	isOpaqueText(value.workingCopyId) &&
	Number.isSafeInteger(value.bindingEpoch) &&
	value.bindingEpoch >= 0;

/**
 * V2's strict wire parser admits only an allowlisted generic code. Projecting
 * into a new record keeps snapshot ownership source-free even if callers later
 * retain the parsed packet longer than the WebSocket callback.
 */
const publicDiagnostics = (
	diagnostics: readonly ProgramSurfaceBridgeDiagnostic[],
): readonly PublicDiagnostic[] =>
	diagnostics.map((diagnostic) => ({
		code: diagnostic.code,
	}));

const parseDiscovery = (
	value: unknown,
	origin: string,
): ProgramSurfaceBridgeDiscovery | null => {
	if (
		!isRecord(value) ||
		!hasExactlyKeys(value, [
			"protocol",
			"bridgeId",
			"port",
			"editorOrigin",
			"startedAt",
		]) ||
		value.protocol !== PROGRAM_SURFACE_BRIDGE_PROTOCOL_VERSION ||
		!isOpaqueText(value.bridgeId) ||
		typeof value.port !== "number" ||
		!Number.isSafeInteger(value.port) ||
		value.port <= 0 ||
		value.port > 65_535 ||
		typeof value.editorOrigin !== "string" ||
		value.editorOrigin !== origin ||
		!isOpaqueText(value.startedAt, 128)
	) {
		return null;
	}
	return {
		bridgeId: value.bridgeId,
		port: value.port,
		editorOrigin: value.editorOrigin,
		startedAt: value.startedAt,
	};
};

const initialSnapshot = (): ProgramSurfaceBridgeClientSnapshot => ({
	phase: "idle",
	manifests: [],
	lastKnownGood: false,
	hostState: "not-observed-by-bridge",
	diagnostics: [],
});

/**
 * Opt-in browser transport for a user-started loopback companion. It owns no
 * SceneDocument access and has no reconnect behavior; the workflow layer is
 * the sole durable command-bus writer after an explicit bundle approval.
 */
export const createProgramSurfaceBridgeClient =
	(): ProgramSurfaceBridgeClient => {
		const listeners = new Set<() => void>();
		let snapshot = initialSnapshot();
		let discovery: ProgramSurfaceBridgeDiscovery | null = null;
		let socket: WebSocket | null = null;
		let target: ProgramSurfaceBridgeEditorTarget | null = null;
		let sessionId: string | null = null;
		let binding: ActiveBinding | null = null;
		let pendingPair: PendingPair | null = null;
		let pendingBind: PendingBind | null = null;
		let pendingApproval: PendingApproval | null = null;
		let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
		let pendingTimer: ReturnType<typeof setTimeout> | null = null;
		let disposed = false;

		const notify = (): void => {
			for (const listener of listeners) listener();
		};
		const publish = (next: ProgramSurfaceBridgeClientSnapshot): void => {
			const bindingSnapshot = next.binding
				? Object.freeze({ ...next.binding })
				: undefined;
			const candidateSnapshot = next.candidate
				? immutableCandidate(next.candidate)
				: undefined;
			snapshot = Object.freeze({
				...next,
				manifests: Object.freeze(next.manifests.map(immutableManifestOption)),
				diagnostics: Object.freeze(next.diagnostics.map(immutableDiagnostic)),
				...(bindingSnapshot ? { binding: bindingSnapshot } : {}),
				...(candidateSnapshot ? { candidate: candidateSnapshot } : {}),
			});
			notify();
		};
		const stopHeartbeat = (): void => {
			if (!heartbeatTimer) return;
			clearInterval(heartbeatTimer);
			heartbeatTimer = null;
		};
		const clearPendingTimer = (): void => {
			if (!pendingTimer) return;
			clearTimeout(pendingTimer);
			pendingTimer = null;
		};
		const rejectPending = (reason: string): void => {
			const error = new Error(reason);
			pendingPair?.discardToken();
			pendingPair?.reject(error);
			pendingPair = null;
			pendingBind?.reject(error);
			pendingBind = null;
			pendingApproval?.reject(error);
			pendingApproval = null;
		};
		const resetConnection = (): void => {
			stopHeartbeat();
			clearPendingTimer();
			socket = null;
			discovery = null;
			target = null;
			sessionId = null;
			binding = null;
		};
		const fail = (message: string): void => {
			rejectPending(message);
			stopHeartbeat();
			const active = socket;
			resetConnection();
			publish({
				...snapshot,
				phase: "failed",
				bridgeId: undefined,
				sessionId: undefined,
				binding: undefined,
				manifests: [],
				candidate: undefined,
				buildStatus: undefined,
				lastKnownGood: false,
				diagnostics: [],
				error: message,
				notice: undefined,
			});
			if (active && active.readyState < 2) active.close();
		};
		const closeWithNotice = (notice: string): void => {
			rejectPending(notice);
			const active = socket;
			stopHeartbeat();
			resetConnection();
			publish({
				...snapshot,
				phase: "closed",
				bridgeId: undefined,
				sessionId: undefined,
				binding: undefined,
				manifests: [],
				candidate: undefined,
				buildStatus: undefined,
				lastKnownGood: false,
				diagnostics: [],
				error: undefined,
				notice,
			});
			if (active && active.readyState < 2) active.close();
		};
		const armPendingTimer = (
			operation: "pair" | "bind" | "approve",
			delayMs: number,
			message: string,
		): void => {
			clearPendingTimer();
			pendingTimer = setTimeout(() => {
				pendingTimer = null;
				const isStillPending =
					(operation === "pair" && pendingPair !== null) ||
					(operation === "bind" && pendingBind !== null) ||
					(operation === "approve" && pendingApproval !== null);
				if (isStillPending) fail(message);
			}, delayMs);
		};
		const send = (
			message: Parameters<typeof encodeProgramSurfaceBridgeMessage>[0],
		): boolean => {
			if (!socket || socket.readyState !== WebSocket.OPEN) return false;
			try {
				socket.send(encodeProgramSurfaceBridgeMessage(message));
				return true;
			} catch {
				return false;
			}
		};
		const isForBinding = (message: {
			readonly sessionId: string;
			readonly bindingId: string;
			readonly target: ProgramSurfaceBridgeEditorTarget;
			readonly assetId: string;
		}): boolean =>
			Boolean(
				sessionId &&
					target &&
					binding &&
					message.sessionId === sessionId &&
					message.bindingId === binding.bindingId &&
					message.assetId === binding.assetId &&
					sameTarget(message.target, target),
			);
		const heartbeat = (): void => {
			if (!socket || !sessionId || !target) return;
			if (
				!send({
					kind: "heartbeat",
					sessionId,
					target,
					...(binding ? { bindingId: binding.bindingId } : {}),
				})
			) {
				closeWithNotice(
					"Program Surface bridge closed. A previously approved session bundle may remain available until revoked or the editor binding changes.",
				);
			}
		};
		const startHeartbeat = (): void => {
			stopHeartbeat();
			heartbeatTimer = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
		};
		const handleMessage = (raw: string): void => {
			const parsed = parseProgramSurfaceBridgeServerMessage(raw);
			if (!parsed.ok) {
				fail("Program Surface bridge sent an invalid server packet.");
				return;
			}
			const message = parsed.message;
			if (message.kind === "error") {
				fail(
					"Program Surface companion rejected the current bridge operation.",
				);
				return;
			}
			if (message.kind === "hello-ack") {
				if (!pendingPair || !target || sessionId !== null) {
					fail(
						"Program Surface bridge hello acknowledgement was out of sequence.",
					);
					return;
				}
				if (!message.accepted || !message.sessionId || !message.manifests) {
					fail("Program Surface bridge pairing was rejected.");
					return;
				}
				sessionId = message.sessionId;
				const manifests = message.manifests.map((manifest) => ({
					id: manifest.id,
					name: manifest.name,
				}));
				const resolve = pendingPair.resolve;
				pendingPair = null;
				clearPendingTimer();
				publish({
					phase: "paired",
					bridgeId: discovery?.bridgeId,
					sessionId,
					manifests,
					lastKnownGood: false,
					hostState: "not-observed-by-bridge",
					diagnostics: [],
				});
				startHeartbeat();
				resolve();
				return;
			}
			if (message.kind === "bind-ack") {
				if (
					!pendingBind ||
					!sessionId ||
					!target ||
					message.sessionId !== sessionId ||
					!sameTarget(message.target, target) ||
					message.assetId !== pendingBind.input.assetId ||
					message.manifestId !== pendingBind.input.manifestId
				) {
					fail(
						"Program Surface bridge binding acknowledgement did not match the explicit asset fence.",
					);
					return;
				}
				binding = {
					bindingId: message.bindingId,
					assetId: message.assetId,
					manifestId: message.manifestId,
					target,
				};
				const resolve = pendingBind.resolve;
				pendingBind = null;
				clearPendingTimer();
				publish({
					...snapshot,
					phase: "bound",
					binding,
					error: undefined,
					notice: undefined,
				});
				resolve();
				return;
			}
			if (message.kind === "build-status") {
				if (!isForBinding(message)) {
					fail(
						"Program Surface bridge build status did not match the current binding.",
					);
					return;
				}
				if (
					pendingApproval &&
					message.status !== "candidate-awaiting-approval"
				) {
					pendingApproval.reject(
						new Error(
							"Program Surface bridge candidate is no longer awaiting approval.",
						),
					);
					pendingApproval = null;
					clearPendingTimer();
				}
				publish({
					...snapshot,
					phase: "bound",
					buildStatus: message.status,
					...(message.status === "candidate-awaiting-approval"
						? {}
						: { candidate: undefined }),
					lastKnownGood:
						message.status === "active-last-known-good" ||
						message.status === "build-failed-last-known-good" ||
						snapshot.lastKnownGood,
					hostState: "not-observed-by-bridge",
				});
				return;
			}
			if (message.kind === "build-candidate") {
				if (
					!isForBinding(message) ||
					message.manifestId !== binding?.manifestId
				) {
					fail(
						"Program Surface bridge candidate did not match the current binding.",
					);
					return;
				}
				if (
					pendingApproval &&
					!sameIdentity(pendingApproval.identity, message.identity)
				) {
					pendingApproval.reject(
						new Error(
							"Program Surface bridge candidate changed before approval.",
						),
					);
					pendingApproval = null;
					clearPendingTimer();
				}
				publish({
					...snapshot,
					phase: "bound",
					candidate: {
						assetId: message.assetId,
						manifestId: message.manifestId,
						identity: message.identity,
						manifest: message.manifest,
						byteLength: message.byteLength,
						diagnostics: publicDiagnostics(message.diagnostics),
					},
					diagnostics: publicDiagnostics(message.diagnostics),
					error: undefined,
				});
				return;
			}
			if (message.kind === "build-diagnostics") {
				if (!isForBinding(message)) {
					fail(
						"Program Surface bridge diagnostics did not match the current binding.",
					);
					return;
				}
				publish({
					...snapshot,
					phase: "bound",
					diagnostics: publicDiagnostics(message.diagnostics),
					lastKnownGood: message.hasLastKnownGood,
					hostState: "not-observed-by-bridge",
				});
				return;
			}
			if (message.kind === "approved-bundle") {
				if (
					!isForBinding(message) ||
					!pendingApproval ||
					!sameIdentity(message.identity, pendingApproval.identity)
				) {
					fail(
						"Program Surface bridge delivered a bundle outside the explicit approval fence.",
					);
					return;
				}
				const resolve = pendingApproval.resolve;
				pendingApproval = null;
				clearPendingTimer();
				resolve(message);
				return;
			}
			if (message.kind === "heartbeat-ack") {
				if (
					!sessionId ||
					message.sessionId !== sessionId ||
					message.bindingId !== binding?.bindingId
				) {
					fail(
						"Program Surface bridge heartbeat acknowledgement did not match the active fence.",
					);
				}
			}
		};

		return {
			snapshot: () => snapshot,
			subscribe: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			discover: async () => {
				if (
					socket ||
					pendingPair ||
					pendingBind ||
					pendingApproval ||
					sessionId
				) {
					const reason =
						"Close the current Program Surface bridge before starting a new discovery.";
					return { status: "unavailable", reason };
				}
				if (!import.meta.env.DEV) {
					const reason =
						"Program Surface bridge discovery is available only in the Vite development editor.";
					publish({
						...snapshot,
						phase: "failed",
						error: reason,
						notice: undefined,
					});
					return { status: "unavailable", reason };
				}
				if (typeof globalThis.location === "undefined") {
					const reason =
						"Program Surface bridge discovery requires a browser editor origin.";
					publish({
						...snapshot,
						phase: "failed",
						error: reason,
						notice: undefined,
					});
					return { status: "unavailable", reason };
				}
				publish({
					...snapshot,
					phase: "discovering",
					error: undefined,
					notice: undefined,
				});
				try {
					const response = await fetch(DISCOVERY_ENDPOINT, {
						cache: "no-store",
					});
					if (!response.ok) {
						const reason =
							"No local Program Surface bridge is available for this editor origin.";
						publish({
							...snapshot,
							phase: "idle",
							error: reason,
							notice: undefined,
						});
						return { status: "unavailable", reason };
					}
					const discovered = parseDiscovery(
						await response.json(),
						globalThis.location.origin,
					);
					if (!discovered) {
						const reason =
							"Program Surface bridge discovery did not match this exact editor origin.";
						publish({
							...snapshot,
							phase: "failed",
							error: reason,
							notice: undefined,
						});
						return { status: "unavailable", reason };
					}
					discovery = discovered;
					publish({
						...snapshot,
						phase: "ready-to-pair",
						bridgeId: discovered.bridgeId,
						error: undefined,
						notice: undefined,
					});
					return { status: "available", discovery: discovered };
				} catch {
					const reason = "Program Surface bridge discovery could not be read.";
					publish({
						...snapshot,
						phase: "idle",
						error: reason,
						notice: undefined,
					});
					return { status: "unavailable", reason };
				}
			},
			pair: async ({ pairingToken, target: nextTarget }) => {
				if (
					disposed ||
					!import.meta.env.DEV ||
					!discovery ||
					!isTarget(nextTarget) ||
					!isOpaqueText(pairingToken, 512) ||
					pairingToken.length < 43 ||
					typeof WebSocket === "undefined"
				) {
					throw new Error(
						"Program Surface bridge pairing is unavailable for this editor session.",
					);
				}
				if (socket || pendingPair || sessionId) {
					throw new Error(
						"Program Surface bridge already has an active editor pairing.",
					);
				}
				let oneTimeToken = pairingToken;
				const discardOneTimeToken = (): void => {
					oneTimeToken = "";
				};
				target = immutableTarget(nextTarget);
				publish({
					...snapshot,
					phase: "pairing",
					bridgeId: discovery.bridgeId,
					error: undefined,
					notice: undefined,
				});
				let ws: WebSocket;
				try {
					ws = new WebSocket(`ws://127.0.0.1:${discovery.port}`);
				} catch {
					discardOneTimeToken();
					fail(
						"Program Surface bridge pairing could not open the loopback connection.",
					);
					throw new Error(
						"Program Surface bridge pairing could not open the loopback connection.",
					);
				}
				socket = ws;
				const result = new Promise<void>((resolve, reject) => {
					pendingPair = { resolve, reject, discardToken: discardOneTimeToken };
				});
				armPendingTimer(
					"pair",
					PAIRING_TIMEOUT_MS,
					"Program Surface bridge pairing timed out.",
				);
				ws.addEventListener("open", () => {
					try {
						if (socket !== ws || !target || !discovery) return;
						ws.send(
							encodeProgramSurfaceBridgeMessage({
								kind: "hello",
								protocol: PROGRAM_SURFACE_BRIDGE_PROTOCOL_VERSION,
								bridgeId: discovery.bridgeId,
								token: oneTimeToken,
								target,
							}),
						);
					} catch {
						fail(
							"Program Surface bridge pairing could not send the one-time hello.",
						);
					} finally {
						// Do not keep a token in state, closure, snapshot, or retry path.
						discardOneTimeToken();
					}
				});
				ws.addEventListener("message", (event: MessageEvent) => {
					if (socket !== ws) return;
					if (typeof event.data !== "string") {
						fail("Program Surface bridge sent a non-text control packet.");
						return;
					}
					handleMessage(event.data);
				});
				ws.addEventListener("error", () => {
					discardOneTimeToken();
					if (socket === ws) fail("Program Surface bridge connection failed.");
				});
				ws.addEventListener("close", () => {
					discardOneTimeToken();
					if (socket !== ws) return;
					closeWithNotice(
						"Program Surface bridge closed. A previously approved session bundle may remain available until revoked or the editor binding changes.",
					);
				});
				return result;
			},
			bind: async (input) => {
				if (
					!socket ||
					socket.readyState !== WebSocket.OPEN ||
					!sessionId ||
					!target ||
					binding ||
					pendingBind ||
					!sameTarget(input.target, target) ||
					!isOpaqueText(input.assetId) ||
					!isOpaqueText(input.manifestId) ||
					!snapshot.manifests.some(
						(manifest) => manifest.id === input.manifestId,
					)
				) {
					throw new Error(
						"Program Surface bridge binding must target one current explicit asset and discovered manifest.",
					);
				}
				publish({
					...snapshot,
					phase: "binding",
					error: undefined,
					notice: undefined,
				});
				const exactInput: ProgramSurfaceBridgeBindInput = Object.freeze({
					assetId: input.assetId,
					manifestId: input.manifestId,
					target: immutableTarget(input.target),
				});
				const result = new Promise<void>((resolve, reject) => {
					pendingBind = { input: exactInput, resolve, reject };
				});
				armPendingTimer(
					"bind",
					BIND_TIMEOUT_MS,
					"Program Surface bridge binding timed out.",
				);
				if (
					!send({
						kind: "bind",
						sessionId,
						target,
						assetId: input.assetId,
						manifestId: input.manifestId,
					})
				) {
					closeWithNotice(
						"Program Surface bridge closed before the explicit asset binding completed.",
					);
				}
				return result;
			},
			approveCandidate: async (identity) => {
				const candidate = snapshot.candidate;
				if (
					!socket ||
					socket.readyState !== WebSocket.OPEN ||
					!sessionId ||
					!target ||
					!binding ||
					!candidate ||
					pendingApproval ||
					candidate.assetId !== binding.assetId ||
					candidate.manifestId !== binding.manifestId ||
					!sameIdentity(candidate.identity, identity)
				) {
					throw new Error(
						"Program Surface bridge candidate is no longer current for this explicit binding.",
					);
				}
				const exactIdentity = immutableIdentity(candidate.identity);
				const result = new Promise<ProgramSurfaceBridgeApprovedBundleMessage>(
					(resolve, reject) => {
						pendingApproval = { identity: exactIdentity, resolve, reject };
					},
				);
				armPendingTimer(
					"approve",
					CANDIDATE_APPROVAL_TIMEOUT_MS,
					"Program Surface bridge candidate approval timed out.",
				);
				if (
					!send({
						kind: "approve-candidate",
						sessionId,
						bindingId: binding.bindingId,
						target,
						assetId: binding.assetId,
						identity: exactIdentity,
					})
				) {
					closeWithNotice(
						"Program Surface bridge closed before candidate approval could be sent.",
					);
				}
				return result;
			},
			isBoundToTarget: (currentTarget) =>
				Boolean(target && binding && sameTarget(target, currentTarget)),
			invalidateIfTargetChanged: (currentTarget) => {
				if (!target || sameTarget(target, currentTarget)) return;
				closeWithNotice(
					"Program Surface bridge closed because the editor instance, working copy, or binding epoch changed.",
				);
			},
			close: () => {
				if (socket && sessionId && target) {
					send({
						kind: "close",
						sessionId,
						target,
						...(binding ? { bindingId: binding.bindingId } : {}),
					});
				}
				closeWithNotice(
					"Program Surface bridge closed. A previously approved session bundle may remain available until revoked or the editor binding changes.",
				);
			},
			dispose: () => {
				disposed = true;
				rejectPending("Program Surface bridge client was disposed.");
				stopHeartbeat();
				const active = socket;
				resetConnection();
				if (active && active.readyState < 2) active.close();
				listeners.clear();
			},
		};
	};
