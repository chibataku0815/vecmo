import type {
	VisualReviewCaptureAdapter,
	VisualReviewCaptureAttempt,
	VisualReviewCaptureFailure,
	VisualReviewDiagnosticOutcome,
	VisualReviewMasterCapture,
	VisualReviewPlan,
	VisualReviewTechnicalManifest,
} from "./contracts";
import {
	createPrivateVisualReviewImage,
	type PrivateVisualReviewImage,
	PrivateVisualReviewPacket,
} from "./private-pixels";

export type VisualReviewPacketCaptureResult =
	| {
			readonly status: "ready" | "degraded";
			readonly packet: PrivateVisualReviewPacket;
	  }
	| { readonly status: "failed"; readonly failure: VisualReviewCaptureFailure };

const failedCapture = (
	code: VisualReviewCaptureFailure["code"],
	message: string,
	retryable: boolean,
): VisualReviewPacketCaptureResult => ({
	status: "failed",
	failure: { code, message, retryable },
});

const sourceMismatch = (
	plan: VisualReviewPlan,
	attempt: VisualReviewCaptureAttempt,
): boolean =>
	attempt.status !== "failed" && attempt.sourceKey !== plan.sourceKey;

const validMasterDimensions = (
	plan: VisualReviewPlan,
	capture: VisualReviewMasterCapture,
): boolean => {
	const expectedWidth = Math.max(
		1,
		Math.round(plan.source.width * plan.source.pixelRatio),
	);
	const expectedHeight = Math.max(
		1,
		Math.round(plan.source.height * plan.source.pixelRatio),
	);
	return capture.width === expectedWidth && capture.height === expectedHeight;
};

const manifestFor = (
	plan: VisualReviewPlan,
	capture: VisualReviewMasterCapture,
): VisualReviewTechnicalManifest => ({
	sourceKey: plan.sourceKey,
	sceneRevision: plan.source.sceneRevision,
	motionRevision: plan.source.motionRevision,
	artboardId: plan.source.artboardId,
	frame: plan.source.frame,
	width: capture.width,
	height: capture.height,
	pixelRatio: plan.source.pixelRatio,
	renderer: capture.fidelity.renderer,
	fidelity: capture.fidelity.status,
	completedPassIds: Object.freeze([...(capture.completedPassIds ?? [])]),
	issueCodes: Object.freeze([...capture.fidelity.issues]),
});

const captureAdapterFailure = (error: unknown): VisualReviewCaptureFailure => ({
	code: "capture_unsupported",
	message:
		error instanceof Error
			? error.message
			: "The review renderer failed without a typed result.",
	retryable: false,
});

const invokeAdapter = async (
	adapter: VisualReviewCaptureAdapter,
	request: Parameters<VisualReviewCaptureAdapter>[0],
): Promise<VisualReviewCaptureAttempt> => {
	try {
		return await adapter(request);
	} catch (error) {
		return { status: "failed", failure: captureAdapterFailure(error) };
	}
};

/**
 * Captures one baseline plus zero-or-more diagnostics sequentially. Optional
 * diagnostic failures are reported but never make the mandatory fit/100%/probe
 * views disappear. Any cross-revision result invalidates the whole packet.
 */
export async function captureVisualReviewPacket({
	plan,
	adapter,
}: {
	readonly plan: VisualReviewPlan;
	readonly adapter: VisualReviewCaptureAdapter;
}): Promise<VisualReviewPacketCaptureResult> {
	const baseline = await invokeAdapter(adapter, {
		source: plan.source,
		sourceKey: plan.sourceKey,
	});
	if (sourceMismatch(plan, baseline)) {
		return failedCapture(
			"source_changed",
			"The renderer returned pixels from a different frozen source.",
			false,
		);
	}
	if (baseline.status === "failed") {
		return { status: "failed", failure: baseline.failure };
	}
	if (baseline.status === "not-rendered") {
		return failedCapture(
			"capture_unsupported",
			"The baseline capture cannot be skipped or approximated by absence.",
			false,
		);
	}
	if (!validMasterDimensions(plan, baseline)) {
		return failedCapture(
			"invalid_dimensions",
			"The baseline pixels do not match the frozen output dimensions.",
			false,
		);
	}
	const masterResult = await createPrivateVisualReviewImage(baseline.blob);
	if (masterResult.status === "failed") return masterResult;

	const diagnosticResources = new Map<string, PrivateVisualReviewImage>();
	const diagnosticOutcomes: VisualReviewDiagnosticOutcome[] = [];
	const degraded = baseline.fidelity.status !== "native";
	for (const diagnostic of plan.diagnostics) {
		const attempt = await invokeAdapter(adapter, {
			source: plan.source,
			sourceKey: plan.sourceKey,
			diagnostic,
		});
		if (sourceMismatch(plan, attempt)) {
			masterResult.image.dispose();
			for (const resource of diagnosticResources.values()) resource.dispose();
			return failedCapture(
				"source_changed",
				"A diagnostic returned pixels from a different frozen source.",
				false,
			);
		}
		if (attempt.status === "not-rendered") {
			diagnosticOutcomes.push({
				diagnostic,
				status: attempt.disposition,
				message: attempt.message,
			});
			continue;
		}
		if (attempt.status === "failed") {
			diagnosticOutcomes.push({
				diagnostic,
				status: "unsupported",
				message: `${attempt.failure.code}: ${attempt.failure.message}`,
			});
			continue;
		}
		if (!validMasterDimensions(plan, attempt)) {
			diagnosticOutcomes.push({
				diagnostic,
				status: "unsupported",
				message: "Diagnostic dimensions did not match the frozen baseline.",
			});
			continue;
		}
		const privateImage = await createPrivateVisualReviewImage(attempt.blob);
		if (privateImage.status === "failed") {
			diagnosticOutcomes.push({
				diagnostic,
				status: "unsupported",
				message: `${privateImage.failure.code}: ${privateImage.failure.message}`,
			});
			continue;
		}
		diagnosticResources.set(diagnostic.id, privateImage.image);
		diagnosticOutcomes.push({
			diagnostic,
			status: "rendered",
			fidelity: attempt.fidelity,
		});
	}

	return {
		status: degraded ? "degraded" : "ready",
		packet: new PrivateVisualReviewPacket({
			sourceKey: plan.sourceKey,
			master: masterResult.image,
			fidelity: baseline.fidelity,
			diagnostics: diagnosticResources,
			diagnosticOutcomes,
			technicalManifest: manifestFor(plan, baseline),
		}),
	};
}

/** Honest result for hosts that have not supplied a native capture adapter. */
export function unsupportedVisualReviewCapture(): VisualReviewPacketCaptureResult {
	return failedCapture(
		"capture_unsupported",
		"No native visual-review capture adapter is connected.",
		false,
	);
}
