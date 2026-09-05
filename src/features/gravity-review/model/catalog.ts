/**
 * Fixed, internal-only review metadata for the existing Gravity candidates.
 *
 * This catalog intentionally carries no scene geometry, source-media locator,
 * or approval claim. The dev-only endpoint owns its fixed artifact allowlist;
 * the editor consumes each payload through the normal portable-project reader.
 */
export type GravityReviewEntry = {
	readonly slug: string;
	readonly title: string;
	readonly coverage: string;
	readonly fps: number;
	readonly durationFrames: number;
	readonly continuity: string;
	readonly nativeSurface: string;
	readonly residual: string;
	readonly status: "user_review_required";
	readonly approvalId: null;
	readonly implementationAuthorization: "not_authorized_before_storyboard_approval";
};

export const GRAVITY_REVIEW_ENTRIES: readonly GravityReviewEntry[] = [
	{
		slug: "s1-opening",
		title: "Scene 01 — opening",
		coverage:
			"source f0–13 · source-inspired / VECMO_TRANSLATION handoff o14–o16",
		fps: 24,
		durationFrames: 17,
		continuity:
			"Source coverage ends at f13. Outputs o14–o16 are a source-inspired VECMO_TRANSLATION handoff, not source-exact; review the next chapter separately.",
		nativeSurface: "Vecmo-native SceneDocument + MotionDocument",
		residual:
			"Schematic ring/capsule and Echo representation; no source-pixel or exact-AE accumulation claim.",
		status: "user_review_required",
		approvalId: null,
		implementationAuthorization: "not_authorized_before_storyboard_approval",
	},
	{
		slug: "s1-s2-match-cut",
		title: "Scene 01 → 02 — graphic match cut",
		coverage:
			"source f0–13 · VECMO_TRANSLATION o14–o16 · cut o16→o17 · Scene 02 source f14–39 = o17–o42",
		fps: 24,
		durationFrames: 43,
		continuity:
			"One hard cut at o16→o17 with zero inserted frames preserves the local visible boundary law. The later Scene 02→03 boundary is not part of this review entry.",
		nativeSurface: "Vecmo-native unified artboard with a root-visibility cut",
		residual:
			"The Scene 02 source f16→f17 stretch-representation seam (output o19→o20) remains disclosed for review.",
		status: "user_review_required",
		approvalId: null,
		implementationAuthorization: "not_authorized_before_storyboard_approval",
	},
	{
		slug: "s3-s4-match-cut",
		title: "Scene 03 → 04 — match cut",
		coverage: "source f40–90 · global output o43–o93 · hard cut f64→f65",
		fps: 24,
		durationFrames: 51,
		continuity:
			"This chapter begins after omitted earlier source coverage and ends before f91. Its hard cut is native root visibility, not a blend or bridge.",
		nativeSurface: "Vecmo-native merged SceneDocument + MotionDocument",
		residual:
			"Ringed-planet finish remains outside the candidate: illustrative subordinate geometry only; no Deep Glow or source finish is implied.",
		status: "user_review_required",
		approvalId: null,
		implementationAuthorization: "not_authorized_before_storyboard_approval",
	},
	{
		slug: "s4-ringed-planet",
		title: "Scene 04 — ringed planet",
		coverage: "source f65–90",
		fps: 24,
		durationFrames: 26,
		continuity:
			"Context f64 and f91 belongs to neighboring chapters. This entry does not bridge either boundary.",
		nativeSurface: "Vecmo-native scene/motion chain under screen_2d",
		residual:
			"Planet, ring, and line are illustrative; source gradient sphere, Set Matte, and Deep Glow remain out of scope.",
		status: "user_review_required",
		approvalId: null,
		implementationAuthorization: "not_authorized_before_storyboard_approval",
	},
	{
		slug: "s4-board-1",
		title: "Scene 04 — board 1 impact",
		coverage: "source f91–103 · launch through first contact only",
		fps: 24,
		durationFrames: 13,
		continuity:
			"Stops at first contact. Rebound, platform give, crack reveal, camera exit, and flash handoff are absent.",
		nativeSurface:
			"Vecmo-native scene/motion with a locked orthographic scene camera",
		residual:
			"Model-driven skeleton proof only; it is not a pixel-faithful source render or a continuation of the later impact phrase.",
		status: "user_review_required",
		approvalId: null,
		implementationAuthorization: "not_authorized_before_storyboard_approval",
	},
];

export const findGravityReviewEntry = (
	slug: string,
): GravityReviewEntry | undefined =>
	GRAVITY_REVIEW_ENTRIES.find((entry) => entry.slug === slug);

/** A closed catalog keeps the development endpoint from becoming a file browser. */
export const isGravityReviewSlug = (slug: string): boolean =>
	findGravityReviewEntry(slug) !== undefined;
