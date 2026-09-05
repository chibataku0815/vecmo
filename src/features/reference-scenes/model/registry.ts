import type { ReferenceSceneMeta } from "./types";

/**
 * The browsable reference-scene catalog — metadata only. Each entry's `slug`
 * matches both a fixture in `../fixtures` and a `docs/product-knowledge/<slug>.md`
 * how-to, so the gallery composes navigation here, the executable scene from the
 * (dynamically imported) fixture, and tutorial prose from product-knowledge —
 * without duplicating content. This module deliberately does NOT import the
 * fixtures, so importing the catalog never pulls the heavy payloads into the
 * bundle (the FK alignment is enforced by `check:reference-scenes`).
 */
export const REFERENCE_SCENES: readonly ReferenceSceneMeta[] = [
	{
		slug: "hello-motion",
		title: "Hello Motion",
		summary:
			"Three rounded rects stagger in, a small orbiting pair loops overhead, and a diamond settles with an overshoot ease — a plain vector motion piece with no look effects, masks, or camera. Open it and scrub the Timeline.",
		category: "Motion",
		status: "public",
		posterFrame: 45,
		productKnowledge: "hello-motion.md",
		exportDemo: "hello-motion.html",
	},
	{
		slug: "grainy-gradient-orb",
		title: "Grainy gradient orb",
		summary:
			"A glowing aurora orb built from a single 9-by-9 mesh gradient, softened with layer blur and finished with fine object-scoped grain. Open it and reshape the mesh points, blur radius, and grain amount.",
		category: "Design",
		status: "public",
		posterFrame: 0,
		productKnowledge: "grainy-gradient-orb.md",
		exportDemo: "grainy-gradient-orb.html",
	},
	{
		slug: "grainy-dissolve-cover",
		title: "Grainy dissolve cover",
		summary:
			"An album-cover-style composition: a full-bleed field and a large sphere, each a bright plate noise-dissolved over a deep plate of the same shape beneath it. Open it and see how one shared palette plus a field direction change reads as two different surfaces.",
		category: "Design",
		status: "public",
		posterFrame: 0,
		productKnowledge: "grainy-dissolve-cover.md",
		exportDemo: "grainy-dissolve-cover.html",
	},
	{
		slug: "cycle-motion-system",
		title: "Cycle — looping orbit",
		summary:
			"A row of dots each travels a repeating loop, phase-offset so the row reads as one traveling wave. Open it to play, then change Period, Radius, and Phase.",
		category: "Motion",
		status: "public",
		posterFrame: 23,
		productKnowledge: "cycle-motion-system.md",
		exportDemo: "cycle-motion.html",
	},
	{
		slug: "time-delay-motion-system",
		title: "Time Delay — delayed replay",
		summary:
			"Five master dots drive delayed instances: one Time Delay expansion clip replays the motion across the row with a per-instance stagger. Open it to play, then retime from the clip.",
		category: "Motion",
		status: "public",
		posterFrame: 30,
		productKnowledge: "time-delay-motion-system.md",
		exportDemo: "time-delay-motion.html",
	},
	{
		slug: "corner-radius-expansion",
		title: "Corner radius & squircle",
		summary:
			"Three shapes show the corner treatments: uniform radius, per-corner radii, and iOS-style squircle smoothing. Open it, then edit the corner values in the inspector.",
		category: "Design",
		status: "public",
		posterFrame: 0,
		productKnowledge: "corner-radius-expansion.md",
		exportDemo: "corner-radius-squircle.html",
	},
	{
		slug: "signal-handoff",
		title: "Signal Handoff",
		summary:
			"An internal integration proof: a constrained circle-cell wake tightens into an affine moving aperture, then the aperture morphs while revealing a denser cell field through a nested traveling matte.",
		category: "Motion",
		status: "internal",
		posterFrame: 52,
		productKnowledge: "signal-handoff.md",
		exportDemo: "signal-handoff.html",
	},
	{
		slug: "signal-handoff-material",
		title: "Signal Handoff — Material Wake",
		summary:
			"An internal material-coupling proof: the moving aperture remains the only source, while one receiving knot wakes through source-relative surface, diffusion, edge, and microstructure response after contact.",
		category: "Motion",
		status: "internal",
		posterFrame: 58,
		productKnowledge: "signal-handoff-material.md",
		exportDemo: "signal-handoff-material-wake.html",
	},
	{
		slug: "projected-solid-probe",
		title: "Projected Solid — Asymmetric Probe",
		summary:
			"An internal generated-native probe: one clipped, bowed profile is displaced along a 31-degree axis into editable front, side, back, and edge carriers with one regional light source.",
		category: "Design",
		status: "internal",
		posterFrame: 0,
		productKnowledge: "projected-solid-probe.md",
		exportDemo: "projected-solid-asymmetric-probe.html",
	},
];

/** Public gallery subset; internal fixtures remain addressable by explicit editor ref only. */
export const PUBLIC_REFERENCE_SCENES: readonly ReferenceSceneMeta[] =
	REFERENCE_SCENES.filter((entry) => entry.status !== "internal");

/** Looks up catalog metadata by slug. */
export function findReferenceScene(
	slug: string,
): ReferenceSceneMeta | undefined {
	return REFERENCE_SCENES.find((entry) => entry.slug === slug);
}
