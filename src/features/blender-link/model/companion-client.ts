import {
	type ProductionArtifactAdmissionVerdict,
	verifyProductionArtifact,
} from "@/entities/scene/model/production-artifacts";
import type { ExternalProductionOutputProfile } from "@/entities/scene/model/production-link";
import {
	encodeProductionLinkMessage,
	PRODUCTION_LINK_ARTIFACT_PATH,
	PRODUCTION_LINK_DEFAULT_PORT,
	PRODUCTION_LINK_DISCOVERY_PATH,
	PRODUCTION_LINK_MAX_ARTIFACT_BYTES,
	PRODUCTION_LINK_PROTOCOL_VERSION,
	type ProductionLinkBuildResultMessage,
	type ProductionLinkBuildState,
	type ProductionLinkClientMessage,
	type ProductionLinkDiagnostic,
	type ProductionLinkDiscoveryRecord,
	type ProductionLinkEditorTarget,
	type ProductionLinkInspectResultMessage,
	type ProductionLinkServerMessage,
	parseProductionLinkDiscoveryRecord,
	parseProductionLinkServerMessage,
	productionLinkTargetIsCurrentOrNewer,
} from "@/entities/scene/model/production-link-protocol";

/**
 * Browser transport for the loopback production companion.
 *
 * The client is intentionally thin: it owns socket lifecycle, the fence stamp on
 * every request, and digest verification of fetched artifact bytes. It owns no
 * document state and issues no Scene command — those belong to the workflow, so
 * that a transport failure can never be the thing that writes a document.
 *
 * The pairing token is held only inside the hello-send closure and discarded as
 * soon as the frame is written, so it never becomes retained client state and
 * never appears in a snapshot the UI could render or a log could capture.
 */

const REQUEST_TIMEOUT_MS = 15_000;
const BUILD_TIMEOUT_MS = 10 * 60 * 1000;
const DISCOVERY_TIMEOUT_MS = 2_000;
const ARTIFACT_FETCH_TIMEOUT_MS = 60_000;
const LOOPBACK_HOST = "127.0.0.1";

export type BlenderCompanionPhase =
	| "idle"
	| "discovering"
	| "ready-to-pair"
	| "pairing"
	| "paired"
	| "bound"
	| "closed"
	| "failed";

export type BlenderCompanionSnapshot = {
	readonly phase: BlenderCompanionPhase;
	readonly companionId?: string;
	readonly adapterVersion?: string;
	readonly sessionId?: string;
	readonly boundLinkId?: string;
	readonly displayName?: string;
	readonly buildState?: ProductionLinkBuildState;
	readonly diagnostics: readonly ProductionLinkDiagnostic[];
};

export type BlenderCompanionArtifact = {
	readonly bytes: Uint8Array;
	readonly artifactDigest: string;
	readonly byteLength: number;
};

export type BlenderCompanionClient = {
	readonly snapshot: () => BlenderCompanionSnapshot;
	readonly subscribe: (listener: () => void) => () => void;
	readonly discover: () => Promise<ProductionLinkDiscoveryRecord | null>;
	readonly pair: (input: {
		readonly pairingToken: string;
		readonly target: ProductionLinkEditorTarget;
	}) => Promise<void>;
	readonly bind: (input: {
		readonly linkId: string;
		readonly localPathToken: string;
		readonly target: ProductionLinkEditorTarget;
	}) => Promise<string>;
	readonly inspect: (input: {
		readonly linkId: string;
		readonly target: ProductionLinkEditorTarget;
	}) => Promise<ProductionLinkInspectResultMessage>;
	readonly build: (input: {
		readonly linkId: string;
		readonly buildKey: string;
		readonly outputProfile: ExternalProductionOutputProfile;
		readonly target: ProductionLinkEditorTarget;
	}) => Promise<ProductionLinkBuildResultMessage>;
	readonly cancel: (input: {
		readonly linkId: string;
		readonly requestId: string;
		readonly target: ProductionLinkEditorTarget;
	}) => void;
	/** Fetches and digest-verifies one produced artifact over the loopback origin. */
	readonly fetchArtifact: (result: ProductionLinkBuildResultMessage) => Promise<
		| {
				readonly status: "verified";
				readonly artifact: BlenderCompanionArtifact;
		  }
		| {
				readonly status: "rejected";
				readonly verdict: ProductionArtifactAdmissionVerdict;
		  }
	>;
	readonly isBoundToTarget: (target: ProductionLinkEditorTarget) => boolean;
	readonly close: () => void;
};

type PendingRequest = {
	readonly resolve: (message: ProductionLinkServerMessage) => void;
	readonly reject: (reason: Error) => void;
	readonly timer: ReturnType<typeof setTimeout>;
	readonly accepts: (message: ProductionLinkServerMessage) => boolean;
};

const randomIdentifier = (): string => {
	const bytes = new Uint8Array(16);
	globalThis.crypto.getRandomValues(bytes);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
};

export const createBlenderCompanionClient = ({
	port = PRODUCTION_LINK_DEFAULT_PORT,
}: {
	readonly port?: number;
} = {}): BlenderCompanionClient => {
	const origin = `http://${LOOPBACK_HOST}:${port}`;
	const listeners = new Set<() => void>();
	const pending = new Map<string, PendingRequest>();
	let socket: WebSocket | null = null;
	let state: BlenderCompanionSnapshot = { phase: "idle", diagnostics: [] };
	let boundTarget: ProductionLinkEditorTarget | null = null;

	const emit = (): void => {
		for (const listener of listeners) listener();
	};

	const setState = (next: Partial<BlenderCompanionSnapshot>): void => {
		state = { ...state, ...next };
		emit();
	};

	const failAllPending = (reason: string): void => {
		for (const [, request] of pending) {
			clearTimeout(request.timer);
			request.reject(new Error(reason));
		}
		pending.clear();
	};

	const send = (message: ProductionLinkClientMessage): void => {
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			throw new Error("The production companion connection is not open.");
		}
		socket.send(encodeProductionLinkMessage(message));
	};

	const awaitMessage = (
		key: string,
		accepts: (message: ProductionLinkServerMessage) => boolean,
		timeoutMs: number,
	): Promise<ProductionLinkServerMessage> =>
		new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				pending.delete(key);
				reject(new Error("The production companion did not answer in time."));
			}, timeoutMs);
			pending.set(key, { resolve, reject, timer, accepts });
		});

	const settle = (message: ProductionLinkServerMessage): boolean => {
		for (const [key, request] of pending) {
			if (!request.accepts(message)) continue;
			clearTimeout(request.timer);
			pending.delete(key);
			request.resolve(message);
			return true;
		}
		return false;
	};

	const handleMessage = (raw: string): void => {
		const parsed = parseProductionLinkServerMessage(raw);
		if (!parsed.ok) {
			setState({ phase: "failed" });
			failAllPending("The production companion sent an unparseable frame.");
			socket?.close();
			return;
		}
		const message = parsed.message;
		if (message.kind === "error") {
			failAllPending("The production companion rejected the operation.");
			setState({ phase: "failed" });
			return;
		}
		if (message.kind === "build-status") {
			setState({ buildState: message.state });
			return;
		}
		if (
			"target" in message &&
			boundTarget &&
			!productionLinkTargetIsCurrentOrNewer(message.target, boundTarget)
		) {
			// A packet addressed to a different fence is never applied here; the
			// companion is expected to reject first, so this is defense in depth.
			// The comparison is monotone rather than exact for the same reason the
			// companion's is: a reply to a request this client itself minted after
			// a binding-epoch advance legitimately carries the newer epoch, and an
			// exact match dropped that reply — turning every relink into a timeout
			// before the companion ever got a chance to answer.
			return;
		}
		if ("target" in message) boundTarget = message.target;
		settle(message);
	};

	const closeSocket = (): void => {
		socket?.close();
		socket = null;
		boundTarget = null;
		failAllPending("The production companion connection closed.");
		setState({ phase: "closed", sessionId: undefined, boundLinkId: undefined });
	};

	const requireSession = (): string => {
		if (!state.sessionId) {
			throw new Error(
				"Pair with the production companion before this request.",
			);
		}
		return state.sessionId;
	};

	return {
		snapshot: () => state,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		discover: async () => {
			setState({ phase: "discovering" });
			try {
				const response = await fetch(
					`${origin}${PRODUCTION_LINK_DISCOVERY_PATH}`,
					{
						signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
					},
				);
				if (!response.ok) {
					setState({ phase: "idle" });
					return null;
				}
				const record = parseProductionLinkDiscoveryRecord(
					await response.json(),
				);
				if (!record || record.protocol !== PRODUCTION_LINK_PROTOCOL_VERSION) {
					setState({ phase: "idle" });
					return null;
				}
				setState({
					phase: "ready-to-pair",
					companionId: record.companionId,
					adapterVersion: record.adapterVersion,
				});
				return record;
			} catch {
				// A closed loopback port is the ordinary "companion not running"
				// case, so it degrades to Disconnected rather than to Failed.
				setState({ phase: "idle" });
				return null;
			}
		},
		pair: async ({ pairingToken, target }) => {
			setState({ phase: "pairing" });
			const next = new WebSocket(`ws://${LOOPBACK_HOST}:${port}`);
			socket = next;
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(() => {
					reject(new Error("The production companion did not accept pairing."));
				}, REQUEST_TIMEOUT_MS);
				next.addEventListener("open", () => {
					clearTimeout(timer);
					resolve();
				});
				next.addEventListener("error", () => {
					clearTimeout(timer);
					reject(new Error("The production companion connection failed."));
				});
			});
			next.addEventListener("message", (event) => {
				if (typeof event.data === "string") handleMessage(event.data);
			});
			next.addEventListener("close", () => {
				if (socket !== next) return;
				socket = null;
				boundTarget = null;
				failAllPending("The production companion connection closed.");
				setState({ phase: "closed", sessionId: undefined });
			});
			const acknowledged = awaitMessage(
				"hello",
				(message) => message.kind === "hello-ack",
				REQUEST_TIMEOUT_MS,
			);
			// The token exists only for this send and is not retained afterwards.
			next.send(
				encodeProductionLinkMessage({
					kind: "hello",
					protocol: PRODUCTION_LINK_PROTOCOL_VERSION,
					clientId: randomIdentifier(),
					token: pairingToken,
					target,
				}),
			);
			const message = await acknowledged;
			if (
				message.kind !== "hello-ack" ||
				!message.accepted ||
				!message.sessionId
			) {
				setState({ phase: "failed" });
				throw new Error("The production companion refused this pairing token.");
			}
			boundTarget = target;
			setState({
				phase: "paired",
				sessionId: message.sessionId,
				...(message.adapterVersion
					? { adapterVersion: message.adapterVersion }
					: {}),
			});
		},
		bind: async ({ linkId, localPathToken, target }) => {
			const sessionId = requireSession();
			const acknowledged = awaitMessage(
				`bind:${linkId}`,
				(message) => message.kind === "bind-ack" && message.linkId === linkId,
				REQUEST_TIMEOUT_MS,
			);
			send({ kind: "bind", sessionId, target, linkId, localPathToken });
			const message = await acknowledged;
			if (message.kind !== "bind-ack") {
				throw new Error("The production companion refused this binding.");
			}
			boundTarget = target;
			setState({
				phase: "bound",
				boundLinkId: linkId,
				displayName: message.displayName,
			});
			return message.displayName;
		},
		inspect: async ({ linkId, target }) => {
			const sessionId = requireSession();
			const requestId = randomIdentifier();
			const answered = awaitMessage(
				`inspect:${requestId}`,
				(message) =>
					(message.kind === "inspect-result" ||
						message.kind === "build-failed") &&
					message.requestId === requestId,
				REQUEST_TIMEOUT_MS,
			);
			send({ kind: "inspect", sessionId, target, linkId, requestId });
			const message = await answered;
			if (message.kind !== "inspect-result") {
				setState({
					diagnostics:
						message.kind === "build-failed" ? message.diagnostics : [],
				});
				throw new Error(
					"The production companion could not inspect the source.",
				);
			}
			setState({
				displayName: message.displayName,
				diagnostics: message.diagnostics,
			});
			return message;
		},
		build: async ({ linkId, buildKey, outputProfile, target }) => {
			const sessionId = requireSession();
			const requestId = randomIdentifier();
			const answered = awaitMessage(
				`build:${requestId}`,
				(message) =>
					(message.kind === "build-result" ||
						message.kind === "build-failed") &&
					message.requestId === requestId,
				BUILD_TIMEOUT_MS,
			);
			send({
				kind: "build",
				sessionId,
				target,
				linkId,
				requestId,
				buildKey,
				outputProfile,
			});
			const message = await answered;
			if (message.kind !== "build-result") {
				setState({
					buildState: "failed",
					diagnostics:
						message.kind === "build-failed" ? message.diagnostics : [],
				});
				throw new Error(
					"The production companion could not build the artifact.",
				);
			}
			if (message.buildKey !== buildKey) {
				setState({ buildState: "failed" });
				throw new Error(
					"The production companion produced a different build key than requested.",
				);
			}
			setState({ buildState: "produced", diagnostics: message.diagnostics });
			return message;
		},
		cancel: ({ linkId, requestId, target }) => {
			if (!state.sessionId) return;
			send({
				kind: "cancel",
				sessionId: state.sessionId,
				target,
				linkId,
				requestId,
			});
		},
		fetchArtifact: async (result) => {
			if (result.byteLength > PRODUCTION_LINK_MAX_ARTIFACT_BYTES) {
				return {
					status: "rejected",
					verdict: { status: "incomplete", reason: "byte-length-mismatch" },
				};
			}
			const response = await fetch(
				`${origin}${PRODUCTION_LINK_ARTIFACT_PATH}`,
				{
					method: "GET",
					headers: { "x-vecmo-artifact-token": result.fetchToken },
					signal: AbortSignal.timeout(ARTIFACT_FETCH_TIMEOUT_MS),
				},
			);
			if (!response.ok) {
				return {
					status: "rejected",
					verdict: { status: "incomplete", reason: "empty-payload" },
				};
			}
			const bytes = new Uint8Array(await response.arrayBuffer());
			const verdict = await verifyProductionArtifact({
				bytes,
				expectedDigest: result.artifactDigest,
				expectedByteLength: result.byteLength,
			});
			if (verdict.status !== "verified") {
				bytes.fill(0);
				return { status: "rejected", verdict };
			}
			return {
				status: "verified",
				artifact: {
					bytes,
					artifactDigest: verdict.artifactDigest,
					byteLength: bytes.byteLength,
				},
			};
		},
		// Monotone, matching the fence the companion enforces: this session is
		// usable by the editor that paired it as long as the caller's fence is
		// not OLDER than the one this socket last had accepted. An exact match
		// here would refuse the caller's own post-relink fence locally, before
		// the companion could re-stamp.
		isBoundToTarget: (target) =>
			Boolean(
				boundTarget &&
					productionLinkTargetIsCurrentOrNewer(target, boundTarget),
			),
		close: () => {
			if (socket && state.sessionId) {
				try {
					send({
						kind: "disconnect",
						sessionId: state.sessionId,
						target: boundTarget ?? {
							editorInstanceId: "unknown",
							workingCopyId: "unknown",
							bindingEpoch: 0,
						},
					});
				} catch {
					// A closed socket is already the desired end state.
				}
			}
			closeSocket();
		},
	};
};
