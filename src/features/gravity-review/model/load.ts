import { isGravityReviewSlug } from "./catalog";

export type GravityReviewProjectLoad =
	| { readonly status: "ok"; readonly payload: string }
	| { readonly status: "unavailable" };

/**
 * Reads one fixed candidate from Vecmo's development-only review endpoint.
 *
 * The endpoint is deliberately absent from production builds. It exposes no
 * directory listing or arbitrary path parameter, and the payload is handed to
 * the existing portable-project restore path rather than a review-owned model.
 */
export async function loadGravityReviewProject(
	slug: string,
): Promise<GravityReviewProjectLoad> {
	if (!isGravityReviewSlug(slug)) return { status: "unavailable" };

	try {
		const response = await fetch(
			`/__gravity-review/${encodeURIComponent(slug)}`,
			{ cache: "no-store" },
		);
		if (!response.ok) return { status: "unavailable" };
		return { status: "ok", payload: await response.text() };
	} catch {
		return { status: "unavailable" };
	}
}
