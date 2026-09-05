import type {
	AuthoringOutputEvidence,
	AuthoringOutputFidelity,
} from "@/shared/authoring-capability/model";

export const AUTHORING_OUTPUT_RELEVANT_CAPABILITY_IDS = [
	"scene.geometry.rect",
	"scene.geometry.ellipse",
	"scene.geometry.line",
	"scene.geometry.polygon",
	"scene.geometry.star",
	"scene.geometry.path",
	"scene.geometry.text",
	"scene.geometry.image",
	"scene.node.transform",
	"scene.appearance.basic",
	"scene.appearance.rich",
	"scene.appearance.look",
	"scene.appearance.mask",
	"scene.assets",
	"scene.blend",
	"scene.camera-depth",
	"scene.source-optics",
	"motion.track.scalar",
	"motion.track.path-shape",
	"motion.track.mesh-paint",
	"motion.track.fill-gradient",
	"motion.position-path",
	"motion.look-node-track",
	"motion.source-optics-track",
	"motion.camera-track",
	"motion.production-control-track",
	"motion.camera-cut",
	"motion.text-animator",
	"motion.automation",
	"grammar.technique-profile",
	"grammar.technique.time-delay",
	"grammar.technique.random-phase-pulse",
	"grammar.technique.mirror-symmetric-scale",
	"grammar.technique.time-offset-propagation",
	"grammar.technique.ring-wave-interference",
	"grammar.technique.planar-solid-tumble",
	"grammar.technique.boolean-difference-rotation",
	"grammar.technique.inverse-proportion-link",
	"grammar.technique.arrangement-transition",
	"grammar.technique.shear-split",
	"grammar.technique.merge-split-cycle",
	"grammar.technique.count-growth",
	"grammar.technique.periodic-afterimage",
	"grammar.technique.cyclic-path-travel",
	"grammar.technique.auto-orient-along-path",
	"grammar.technique.size-speed-parallax",
	"grammar.technique.reactive-neighbor-displacement",
	"grammar.technique.lag-follow-through",
	"grammar.technique.noise-wipe",
	"grammar.technique.stroke-draw-on",
	"grammar.technique.collision-bounce",
] as const;

export type AuthoringOutputRelevantCapabilityId =
	(typeof AUTHORING_OUTPUT_RELEVANT_CAPABILITY_IDS)[number];

export type AuthoringOutputTierDeclaration = Omit<
	AuthoringOutputEvidence,
	"capabilityId" | "limitationVisible"
>;

export const AUTHORING_OUTPUT_TIER_DECLARATIONS = [
	{
		outputId: "svg-export",
		fidelity: "approximated",
		adapterId: "svg-export-with-visible-fidelity-report",
		sourceAnchorIds: [
			"src/features/export/model/svg.ts",
			"src/widgets/top-bar/model/export-report.ts",
		],
	},
	{
		outputId: "pdf-export",
		fidelity: "approximated",
		adapterId: "pdf-export-with-visible-fidelity-report",
		sourceAnchorIds: [
			"src/features/export/model/pdf.ts",
			"src/widgets/top-bar/model/export-report.ts",
		],
	},
	{
		outputId: "video-capture",
		fidelity: "capture-only",
		adapterId: "rendered-video-capture-with-visible-fidelity-report",
		sourceAnchorIds: [
			"src/features/export/model/video.ts",
			"src/widgets/top-bar/model/export-report.ts",
		],
	},
	{
		outputId: "motion-runtime-code",
		fidelity: "side-car-only",
		adapterId: "motion-runtime-code-with-visible-fidelity-report",
		sourceAnchorIds: [
			"src/features/export/model/code.ts",
			"src/features/export/model/motion-grammar-fidelity.ts",
			"src/widgets/top-bar/model/export-report.ts",
		],
	},
] as const satisfies readonly AuthoringOutputTierDeclaration[];

export type AuthoringOutputDeclaration = {
	readonly outputId:
		| (typeof AUTHORING_OUTPUT_TIER_DECLARATIONS)[number]["outputId"]
		| "not-applicable";
	readonly fidelity: AuthoringOutputFidelity;
};

const outputRelevantCapabilityIds = new Set<string>(
	AUTHORING_OUTPUT_RELEVANT_CAPABILITY_IDS,
);

/** Returns the conservative, user-visible output declaration for one capability. */
export function authoringOutputDeclarationsForCapability(
	capabilityId: string,
): readonly AuthoringOutputDeclaration[] {
	if (!outputRelevantCapabilityIds.has(capabilityId)) {
		return [{ outputId: "not-applicable", fidelity: "not_applicable" }];
	}
	return AUTHORING_OUTPUT_TIER_DECLARATIONS.map(({ outputId, fidelity }) => ({
		outputId,
		fidelity,
	}));
}
