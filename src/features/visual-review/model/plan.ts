import {
	type FrozenVisualReviewSource,
	freezeVisualReviewSource,
	REVIEW_ACTUAL_PIXEL_VIEW_ID,
	REVIEW_FIT_VIEW_ID,
	type VisualReviewDiagnosticSpec,
	type VisualReviewPlanResult,
	type VisualReviewProbeView,
	visualReviewSourceKey,
} from "./contracts";

const normalizedRect = (
	rect: VisualReviewProbeView["rect"],
): VisualReviewProbeView["rect"] | null => {
	if (
		![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
		rect.x < 0 ||
		rect.y < 0 ||
		rect.width <= 0 ||
		rect.height <= 0 ||
		rect.x + rect.width > 1 ||
		rect.y + rect.height > 1
	) {
		return null;
	}
	return Object.freeze({ ...rect });
};

const cleanId = (value: string): string => value.trim();

/**
 * Builds the only valid packet plan: fit and actual-pixel are always first,
 * normalized probes follow when supplied, and diagnostics remain optional.
 */
export function createVisualReviewPlan({
	source: sourceInput,
	probes,
	diagnostics = [],
	requireProbe = false,
}: {
	readonly source: FrozenVisualReviewSource;
	readonly probes: readonly VisualReviewProbeView[];
	readonly diagnostics?: readonly VisualReviewDiagnosticSpec[];
	readonly requireProbe?: boolean;
}): VisualReviewPlanResult {
	const source = freezeVisualReviewSource(sourceInput);
	if (!source) {
		return {
			status: "blocked",
			failure: {
				code: "invalid_source",
				message: "The review source must have stable revisions and dimensions.",
			},
		};
	}
	if (requireProbe && probes.length === 0) {
		return {
			status: "blocked",
			failure: {
				code: "probe_required",
				message: "Add at least one visual probe before capture.",
			},
		};
	}

	const normalizedProbes: VisualReviewProbeView[] = [];
	const ids = new Set<string>([
		REVIEW_FIT_VIEW_ID,
		REVIEW_ACTUAL_PIXEL_VIEW_ID,
	]);
	for (const probe of probes) {
		const id = cleanId(probe.id);
		const rect = normalizedRect(probe.rect);
		if (!id || !rect) {
			return {
				status: "blocked",
				failure: {
					code: "invalid_probe",
					message: "Probe ids and normalized rectangles must be valid.",
				},
			};
		}
		if (ids.has(id)) {
			return {
				status: "blocked",
				failure: {
					code: "duplicate_id",
					message: `Review view id "${id}" is duplicated.`,
				},
			};
		}
		ids.add(id);
		normalizedProbes.push(
			Object.freeze({
				...probe,
				id,
				label: probe.label.trim() || "Probe",
				rect,
			}),
		);
	}

	const normalizedDiagnostics: VisualReviewDiagnosticSpec[] = [];
	for (const diagnostic of diagnostics) {
		const id = cleanId(diagnostic.id);
		if (!id || ids.has(id)) {
			return {
				status: "blocked",
				failure: {
					code: "duplicate_id",
					message: `Review diagnostic id "${id || diagnostic.id}" is invalid or duplicated.`,
				},
			};
		}
		if (
			diagnostic.kind === "bypass-contribution" &&
			diagnostic.contributionIds.length === 0
		) {
			return {
				status: "blocked",
				failure: {
					code: "invalid_probe",
					message: `Diagnostic "${id}" needs at least one stable contribution id.`,
				},
			};
		}
		ids.add(id);
		normalizedDiagnostics.push(
			Object.freeze({
				...diagnostic,
				id,
				label: diagnostic.label.trim() || "Diagnostic",
				...(diagnostic.kind === "bypass-contribution"
					? {
							contributionIds: Object.freeze([...diagnostic.contributionIds]),
						}
					: {}),
			}) as VisualReviewDiagnosticSpec,
		);
	}

	return {
		status: "ready",
		plan: Object.freeze({
			source,
			sourceKey: visualReviewSourceKey(source),
			probePolicy: requireProbe ? "required" : "optional",
			views: Object.freeze([
				Object.freeze({ id: REVIEW_FIT_VIEW_ID, role: "fit" as const }),
				Object.freeze({
					id: REVIEW_ACTUAL_PIXEL_VIEW_ID,
					role: "actual-pixel" as const,
				}),
				...normalizedProbes,
			] as const),
			diagnostics: Object.freeze(normalizedDiagnostics),
		}),
	};
}

/** Material-review profile: unlike the generic packet, it requires an ROI. */
export function createMaterialVisualReviewPlan(
	input: Omit<Parameters<typeof createVisualReviewPlan>[0], "requireProbe">,
): VisualReviewPlanResult {
	return createVisualReviewPlan({ ...input, requireProbe: true });
}

/** Generic center probe used only when a host has not supplied a selected ROI. */
export function defaultVisualReviewProbe(): VisualReviewProbeView {
	return {
		id: "probe-1",
		role: "probe",
		label: "Probe 1",
		rect: { x: 0.35, y: 0.35, width: 0.3, height: 0.3 },
	};
}
