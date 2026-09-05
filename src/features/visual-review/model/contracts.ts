export const REVIEW_FIT_VIEW_ID = "baseline-fit";
export const REVIEW_ACTUAL_PIXEL_VIEW_ID = "baseline-actual-pixel";

export type VisualReviewRect = {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
};

export type FrozenVisualReviewSource = {
	readonly sceneRevision: string;
	readonly motionRevision?: string;
	readonly artboardId: string;
	readonly frame: number;
	readonly width: number;
	readonly height: number;
	readonly pixelRatio: number;
};

export type VisualReviewFitView = {
	readonly id: typeof REVIEW_FIT_VIEW_ID;
	readonly role: "fit";
};

export type VisualReviewActualPixelView = {
	readonly id: typeof REVIEW_ACTUAL_PIXEL_VIEW_ID;
	readonly role: "actual-pixel";
};

export type VisualReviewProbeView = {
	readonly id: string;
	readonly role: "probe";
	readonly label: string;
	/** Normalized source-image coordinates. */
	readonly rect: VisualReviewRect;
};

export type VisualReviewViewSpec =
	| VisualReviewFitView
	| VisualReviewActualPixelView
	| VisualReviewProbeView;

/**
 * Optional presentation diagnostics. They never participate in baseline packet
 * completeness. `bypass-contribution` targets stable contributor identities;
 * no display-name lookup or grain-specific branch is permitted.
 */
export type VisualReviewDiagnosticSpec =
	| {
			readonly id: string;
			readonly label: string;
			readonly kind: "monochrome";
	  }
	| {
			readonly id: string;
			readonly label: string;
			readonly kind: "bypass-contribution";
			readonly contributionIds: readonly string[];
	  };

export type VisualReviewPlan = {
	readonly source: FrozenVisualReviewSource;
	readonly sourceKey: string;
	readonly probePolicy: "optional" | "required";
	readonly views: readonly [
		VisualReviewFitView,
		VisualReviewActualPixelView,
		...VisualReviewProbeView[],
	];
	readonly diagnostics: readonly VisualReviewDiagnosticSpec[];
};

export type VisualReviewPlanFailure =
	| { readonly code: "probe_required"; readonly message: string }
	| { readonly code: "invalid_probe"; readonly message: string }
	| { readonly code: "duplicate_id"; readonly message: string }
	| { readonly code: "invalid_source"; readonly message: string };

export type VisualReviewPlanResult =
	| { readonly status: "ready"; readonly plan: VisualReviewPlan }
	| { readonly status: "blocked"; readonly failure: VisualReviewPlanFailure };

export type VisualReviewFidelityStatus =
	| "native"
	| "approximated"
	| "capture-only"
	| "side-car-only"
	| "deferred"
	| "unsupported";

export type VisualReviewFidelity = {
	readonly status: VisualReviewFidelityStatus;
	readonly renderer: string;
	readonly issues: readonly string[];
};

export type VisualReviewCaptureFailureCode =
	| "source_changed"
	| "asset_not_ready"
	| "font_not_ready"
	| "context_lost"
	| "blank_frame"
	| "silent_downgrade"
	| "tainted_canvas"
	| "memory_budget_exceeded"
	| "capture_unsupported"
	| "decode_failed"
	| "encode_failed"
	| "invalid_dimensions"
	| "aborted";

export type VisualReviewCaptureFailure = {
	readonly code: VisualReviewCaptureFailureCode;
	readonly message: string;
	readonly retryable: boolean;
	readonly diagnosticId?: string;
};

export type VisualReviewCaptureRequest = {
	readonly source: FrozenVisualReviewSource;
	readonly sourceKey: string;
	readonly diagnostic?: VisualReviewDiagnosticSpec;
};

export type VisualReviewMasterCapture = {
	readonly status: "captured";
	readonly sourceKey: string;
	readonly blob: Blob;
	readonly width: number;
	readonly height: number;
	readonly fidelity: VisualReviewFidelity;
	readonly completedPassIds?: readonly string[];
};

export type VisualReviewOptionalCaptureDisposition =
	| "skipped_not_applicable"
	| "blocked_owner_ambiguous"
	| "unsupported";

export type VisualReviewCaptureAttempt =
	| VisualReviewMasterCapture
	| {
			readonly status: "not-rendered";
			readonly sourceKey: string;
			readonly disposition: VisualReviewOptionalCaptureDisposition;
			readonly message: string;
	  }
	| {
			readonly status: "failed";
			readonly sourceKey?: string;
			readonly failure: VisualReviewCaptureFailure;
	  };

/** Renderer boundary used by native scene capture integrations. */
export type VisualReviewCaptureAdapter = (
	request: VisualReviewCaptureRequest,
) => Promise<VisualReviewCaptureAttempt>;

export type VisualReviewTechnicalManifest = {
	readonly sourceKey: string;
	readonly sceneRevision: string;
	readonly motionRevision?: string;
	readonly artboardId: string;
	readonly frame: number;
	readonly width: number;
	readonly height: number;
	readonly pixelRatio: number;
	readonly renderer: string;
	readonly fidelity: VisualReviewFidelityStatus;
	readonly completedPassIds: readonly string[];
	readonly issueCodes: readonly string[];
};

export type VisualReviewDiagnosticOutcome =
	| {
			readonly diagnostic: VisualReviewDiagnosticSpec;
			readonly status: "rendered";
			readonly fidelity: VisualReviewFidelity;
	  }
	| {
			readonly diagnostic: VisualReviewDiagnosticSpec;
			readonly status: VisualReviewOptionalCaptureDisposition;
			readonly message: string;
	  };

export type VisualReviewCriticTerminal =
	| "visual_reject"
	| "retry_one_residual"
	| "user_review_ready"
	| "critic_uncertain";

export type VisualReviewConfidence = "low" | "medium" | "high";

export type LockedVisualReviewVerdict = {
	readonly terminal: VisualReviewCriticTerminal;
	readonly largestVisibleResidual: string;
	readonly confidence: VisualReviewConfidence;
	readonly viewId: string;
	readonly diagnosticId: string | null;
	readonly lockedAt: number;
};

export type VisualReviewComparisonMode = "side-by-side" | "blink" | "swipe";

export type VisualReviewPhase =
	| "empty"
	| "preparing"
	| "ready_pixel_only"
	| "verdict_locked"
	| "metadata_revealed"
	| "degraded_blocked"
	| "source_changed";

const finitePositive = (value: number): boolean =>
	Number.isFinite(value) && value > 0;

/**
 * Produces the immutable source identity used to reject cross-revision capture.
 * The caller supplies document revisions; visual review never derives identity
 * from implementation metadata such as node or track counts.
 */
export function freezeVisualReviewSource(
	input: FrozenVisualReviewSource,
): FrozenVisualReviewSource | null {
	if (
		input.sceneRevision.trim().length === 0 ||
		input.artboardId.trim().length === 0 ||
		!Number.isFinite(input.frame) ||
		!finitePositive(input.width) ||
		!finitePositive(input.height) ||
		!finitePositive(input.pixelRatio)
	) {
		return null;
	}
	return Object.freeze({
		...input,
		frame: Math.max(0, Math.round(input.frame)),
		width: Math.round(input.width),
		height: Math.round(input.height),
	});
}

/** Stable identity checked before and after every renderer request. */
export function visualReviewSourceKey(
	source: FrozenVisualReviewSource,
): string {
	return [
		source.sceneRevision,
		source.motionRevision ?? "",
		source.artboardId,
		source.frame,
		source.width,
		source.height,
		source.pixelRatio,
	].join("\u0000");
}
