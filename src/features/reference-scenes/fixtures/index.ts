import { cornerRadiusFixture } from "./corner-radius-expansion.fixture";
import { cycleMotionFixture } from "./cycle-motion-system.fixture";
import { grainyDissolveCoverFixture } from "./grainy-dissolve-cover.fixture";
import { grainyGradientOrbFixture } from "./grainy-gradient-orb.fixture";
import { projectedSolidProbeFixture } from "./projected-solid-probe.fixture";
import { signalHandoffFixture } from "./signal-handoff.fixture";
import { signalHandoffMaterialFixture } from "./signal-handoff-material.fixture";
import { timeDelayMotionFixture } from "./time-delay-motion-system.fixture";

/**
 * A reference fixture is the serialized scene + motion side-car for one library
 * entry, stored as opaque strings. Keeping this module free of `@/` imports lets
 * the `check:reference-scenes` gate import the raw fixtures without pulling the
 * runtime resolver (and its entity graph) into the build script.
 */
export type ReferenceSceneFixture = {
	readonly slug: string;
	readonly sceneEnvelope: string;
	readonly motionEnvelope: string;
};

/**
 * The fixture payloads, keyed by slug. Slugs must match a
 * `docs/product-knowledge/<slug>.md` entry and the registry metadata in
 * `model/registry.ts`. Generated payloads come from `gen:reference-scenes`.
 */
export const REFERENCE_SCENE_FIXTURES: readonly ReferenceSceneFixture[] = [
	{ slug: "grainy-gradient-orb", ...grainyGradientOrbFixture },
	{ slug: "grainy-dissolve-cover", ...grainyDissolveCoverFixture },
	{ slug: "cycle-motion-system", ...cycleMotionFixture },
	{ slug: "time-delay-motion-system", ...timeDelayMotionFixture },
	{ slug: "corner-radius-expansion", ...cornerRadiusFixture },
	{ slug: "signal-handoff", ...signalHandoffFixture },
	{ slug: "signal-handoff-material", ...signalHandoffMaterialFixture },
	{ slug: "projected-solid-probe", ...projectedSolidProbeFixture },
];

/**
 * Looks up the serialized fixture payload by slug. Lives here (not the registry)
 * so the metadata registry stays free of the heavy payloads; the gallery loads
 * this module dynamically so the ~120KB of fixtures never ships in the main
 * bundle that every `/editor` visit downloads.
 */
export function findReferenceFixture(
	slug: string,
): ReferenceSceneFixture | undefined {
	return REFERENCE_SCENE_FIXTURES.find((fixture) => fixture.slug === slug);
}
