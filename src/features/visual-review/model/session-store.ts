import { createStore, type StoreApi } from "zustand/vanilla";
import type {
	LockedVisualReviewVerdict,
	VisualReviewCaptureFailure,
	VisualReviewComparisonMode,
	VisualReviewConfidence,
	VisualReviewCriticTerminal,
	VisualReviewPhase,
	VisualReviewPlan,
} from "./contracts";
import type { PrivateVisualReviewPacket } from "./private-pixels";

export type VisualReviewSide = "reference" | "candidate";

export type VisualReviewSideOrder = {
	readonly a: VisualReviewSide;
	readonly b: VisualReviewSide;
};

export type VisualReviewCaptureState =
	| { readonly status: "idle" }
	| { readonly status: "capturing"; readonly sourceKey: string }
	| {
			readonly status: "ready";
			readonly sourceKey: string;
			readonly origin: "native" | "local-import";
	  }
	| { readonly status: "degraded"; readonly sourceKey: string }
	| {
			readonly status: "blocked";
			readonly failure: VisualReviewCaptureFailure;
	  };

export type VisualReviewPan = {
	readonly x: number;
	readonly y: number;
};

export type VisualReviewSessionState = {
	readonly phase: VisualReviewPhase;
	readonly plan: VisualReviewPlan | null;
	readonly referencePacket: PrivateVisualReviewPacket | null;
	readonly candidatePacket: PrivateVisualReviewPacket | null;
	readonly capture: VisualReviewCaptureState;
	readonly sideOrder: VisualReviewSideOrder;
	readonly activeViewId: string | null;
	readonly activeDiagnosticId: string | null;
	readonly comparisonMode: VisualReviewComparisonMode;
	readonly blinkSide: "a" | "b";
	readonly swipePercent: number;
	readonly zoom: number;
	readonly pan: VisualReviewPan;
	readonly verdict: LockedVisualReviewVerdict | null;
};

export type VisualReviewVerdictInput = {
	readonly terminal: VisualReviewCriticTerminal;
	readonly largestVisibleResidual: string;
	readonly confidence: VisualReviewConfidence;
};

export type VisualReviewSessionActions = {
	readonly setPlan: (plan: VisualReviewPlan) => void;
	readonly setReferencePacket: (packet: PrivateVisualReviewPacket) => void;
	readonly setCandidatePacket: (
		packet: PrivateVisualReviewPacket,
		captureStatus?: "ready" | "degraded" | "local-import",
	) => void;
	readonly beginCapture: () => boolean;
	readonly setCaptureFailure: (failure: VisualReviewCaptureFailure) => void;
	readonly markSourceChanged: (message?: string) => void;
	readonly setActiveView: (viewId: string) => void;
	readonly setActiveDiagnostic: (diagnosticId: string | null) => void;
	readonly setComparisonMode: (mode: VisualReviewComparisonMode) => void;
	readonly setBlinkSide: (side: "a" | "b") => void;
	readonly setSwipePercent: (percent: number) => void;
	readonly setZoom: (zoom: number) => void;
	readonly setPan: (pan: VisualReviewPan) => void;
	readonly resetNavigation: () => void;
	readonly lockVerdict: (input: VisualReviewVerdictInput) => boolean;
	readonly revealMetadata: () => boolean;
	readonly resetSession: () => void;
	readonly disposeSession: () => void;
};

export type VisualReviewSessionStore = VisualReviewSessionState &
	VisualReviewSessionActions;

export type VisualReviewSessionStoreApi = StoreApi<VisualReviewSessionStore>;

const randomSideOrder = (): VisualReviewSideOrder => {
	const randomByte = new Uint8Array(1);
	if (typeof globalThis.crypto?.getRandomValues === "function") {
		globalThis.crypto.getRandomValues(randomByte);
	} else {
		randomByte[0] = Math.floor(Math.random() * 256);
	}
	return (randomByte[0] ?? 0) < 128
		? { a: "reference", b: "candidate" }
		: { a: "candidate", b: "reference" };
};

const packetReady = (packet: PrivateVisualReviewPacket | null): boolean =>
	packet !== null && !packet.disposed && packet.master.objectUrl !== null;

const packetMatchesPlanDimensions = (
	packet: PrivateVisualReviewPacket | null,
	plan: VisualReviewPlan | null,
): boolean =>
	packet !== null &&
	plan !== null &&
	packet.master.width ===
		Math.max(1, Math.round(plan.source.width * plan.source.pixelRatio)) &&
	packet.master.height ===
		Math.max(1, Math.round(plan.source.height * plan.source.pixelRatio));

const readyForPixelReview = (
	state: Pick<
		VisualReviewSessionState,
		"plan" | "referencePacket" | "candidatePacket" | "capture"
	>,
): boolean =>
	state.plan !== null &&
	packetReady(state.referencePacket) &&
	packetReady(state.candidatePacket) &&
	packetMatchesPlanDimensions(state.candidatePacket, state.plan) &&
	state.candidatePacket?.sourceKey === state.plan.sourceKey &&
	state.capture.status === "ready";

const phaseAfterPixelChange = (
	state: Pick<
		VisualReviewSessionState,
		"plan" | "referencePacket" | "candidatePacket" | "capture"
	>,
): VisualReviewPhase => {
	if (state.capture.status === "degraded" && state.candidatePacket) {
		return "degraded_blocked";
	}
	if (readyForPixelReview(state)) return "ready_pixel_only";
	if (state.capture.status === "blocked" && !state.candidatePacket) {
		return state.capture.failure.code === "source_changed"
			? "source_changed"
			: "degraded_blocked";
	}
	return state.plan || state.referencePacket || state.candidatePacket
		? "preparing"
		: "empty";
};

const initialState = (): VisualReviewSessionState => ({
	phase: "empty",
	plan: null,
	referencePacket: null,
	candidatePacket: null,
	capture: { status: "idle" },
	sideOrder: randomSideOrder(),
	activeViewId: null,
	activeDiagnosticId: null,
	comparisonMode: "side-by-side",
	blinkSide: "a",
	swipePercent: 50,
	zoom: 1,
	pan: { x: 0, y: 0 },
	verdict: null,
});

const disposePackets = (
	referencePacket: PrivateVisualReviewPacket | null,
	candidatePacket: PrivateVisualReviewPacket | null,
): void => {
	referencePacket?.dispose();
	if (candidatePacket !== referencePacket) candidatePacket?.dispose();
};

/**
 * Creates an entirely ephemeral review store. It has no persistence middleware,
 * never imports SceneDocument, and owns disposal of every installed packet.
 */
export function createVisualReviewSessionStore(): VisualReviewSessionStoreApi {
	return createStore<VisualReviewSessionStore>()((set, get) => ({
		...initialState(),
		setPlan: (plan) => {
			const state = get();
			const sourceChanged =
				state.plan !== null && state.plan.sourceKey !== plan.sourceKey;
			if (sourceChanged) state.candidatePacket?.dispose();
			const candidatePacket = sourceChanged ? null : state.candidatePacket;
			const capture: VisualReviewCaptureState = sourceChanged
				? { status: "idle" }
				: state.capture;
			const next = {
				...state,
				plan,
				candidatePacket,
				capture,
				activeViewId: plan.views[0].id,
				activeDiagnosticId: null,
				verdict: null,
				zoom: 1,
				pan: { x: 0, y: 0 },
			};
			set({ ...next, phase: phaseAfterPixelChange(next) });
		},
		setReferencePacket: (packet) => {
			const state = get();
			if (state.referencePacket !== packet) state.referencePacket?.dispose();
			const next = {
				...state,
				referencePacket: packet,
				verdict: null,
				activeDiagnosticId: null,
			};
			set({ ...next, phase: phaseAfterPixelChange(next) });
		},
		setCandidatePacket: (packet, captureStatus = "ready") => {
			const state = get();
			if (
				!state.plan ||
				packet.sourceKey !== state.plan.sourceKey ||
				!packetMatchesPlanDimensions(packet, state.plan)
			) {
				packet.dispose();
				set({
					phase:
						state.plan && packet.sourceKey === state.plan.sourceKey
							? "degraded_blocked"
							: "source_changed",
					capture: {
						status: "blocked",
						failure: {
							code:
								state.plan && packet.sourceKey === state.plan.sourceKey
									? "invalid_dimensions"
									: "source_changed",
							message:
								state.plan && packet.sourceKey === state.plan.sourceKey
									? "Candidate pixels do not match the frozen output dimensions."
									: "Candidate pixels do not match the frozen review source.",
							retryable: false,
						},
					},
					verdict: null,
				});
				return;
			}
			if (state.candidatePacket !== packet) state.candidatePacket?.dispose();
			const next = {
				...state,
				candidatePacket: packet,
				capture:
					captureStatus === "degraded"
						? {
								status: "degraded" as const,
								sourceKey: state.plan.sourceKey,
							}
						: {
								status: "ready" as const,
								sourceKey: state.plan.sourceKey,
								origin:
									captureStatus === "local-import"
										? ("local-import" as const)
										: ("native" as const),
							},
				verdict: null,
				activeDiagnosticId: null,
			};
			set({ ...next, phase: phaseAfterPixelChange(next) });
		},
		beginCapture: () => {
			const state = get();
			const plan = state.plan;
			if (!plan) return false;
			state.candidatePacket?.dispose();
			set({
				phase: "preparing",
				candidatePacket: null,
				capture: { status: "capturing", sourceKey: plan.sourceKey },
				verdict: null,
			});
			return true;
		},
		setCaptureFailure: (failure) => {
			const state = get();
			const invalidateCandidate = failure.code === "source_changed";
			if (invalidateCandidate) state.candidatePacket?.dispose();
			const next = {
				...state,
				candidatePacket: invalidateCandidate ? null : state.candidatePacket,
				capture: { status: "blocked", failure } as VisualReviewCaptureState,
				verdict: null,
			};
			set({ ...next, phase: phaseAfterPixelChange(next) });
		},
		markSourceChanged: (message) => {
			const state = get();
			state.candidatePacket?.dispose();
			set({
				phase: "source_changed",
				candidatePacket: null,
				capture: {
					status: "blocked",
					failure: {
						code: "source_changed",
						message:
							message ?? "The candidate source changed after verdict setup.",
						retryable: false,
					},
				},
				verdict: null,
			});
		},
		setActiveView: (viewId) => {
			const plan = get().plan;
			if (!plan?.views.some((view) => view.id === viewId)) return;
			set({ activeViewId: viewId, pan: { x: 0, y: 0 }, zoom: 1 });
		},
		setActiveDiagnostic: (diagnosticId) => {
			const state = get();
			if (
				diagnosticId !== null &&
				!state.plan?.diagnostics.some(
					(diagnostic) => diagnostic.id === diagnosticId,
				)
			) {
				return;
			}
			set({ activeDiagnosticId: diagnosticId });
		},
		setComparisonMode: (comparisonMode) => set({ comparisonMode }),
		setBlinkSide: (blinkSide) => set({ blinkSide }),
		setSwipePercent: (percent) =>
			set({ swipePercent: Math.min(100, Math.max(0, percent)) }),
		setZoom: (zoom) => set({ zoom: Math.min(8, Math.max(0.1, zoom)) }),
		setPan: (pan) =>
			set({
				pan: {
					x: Number.isFinite(pan.x) ? pan.x : 0,
					y: Number.isFinite(pan.y) ? pan.y : 0,
				},
			}),
		resetNavigation: () => set({ zoom: 1, pan: { x: 0, y: 0 } }),
		lockVerdict: (input) => {
			const state = get();
			const residual = input.largestVisibleResidual.trim();
			if (
				state.phase !== "ready_pixel_only" ||
				!state.activeViewId ||
				residual.length === 0
			) {
				return false;
			}
			set({
				phase: "verdict_locked",
				verdict: Object.freeze({
					...input,
					largestVisibleResidual: residual,
					viewId: state.activeViewId,
					diagnosticId: state.activeDiagnosticId,
					lockedAt: Date.now(),
				}),
			});
			return true;
		},
		revealMetadata: () => {
			if (get().phase !== "verdict_locked") return false;
			set({ phase: "metadata_revealed" });
			return true;
		},
		resetSession: () => {
			const state = get();
			disposePackets(state.referencePacket, state.candidatePacket);
			set(initialState());
		},
		disposeSession: () => {
			const state = get();
			disposePackets(state.referencePacket, state.candidatePacket);
			set(initialState());
		},
	}));
}

/** Default session for the editor-level detached workspace composition. */
export const visualReviewSessionStore = createVisualReviewSessionStore();
