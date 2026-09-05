import { OBJECT_NOISE_GRADIENT_DEFAULT_MIXED_GRAIN } from "@/entities/scene/model/noise-gradient-look";
import { normalizeVisualRecipe, type TextureRecipe } from "@/shared/vec-core";

/**
 * Single source of truth for the Noise Gradient's primary Style axis mapping,
 * shared by the two parallel authoring surfaces — the tool bar
 * (`features/noise-gradient/model/tool-controls`) and the Inspector
 * (`widgets/inspector/model/noise-gradient-editing`) — so their Style writes
 * cannot drift. Only the pure texture transform lives here; each surface keeps
 * its own Style *derivation* (read side), because they resolve the owner's
 * material differently (the tool bar reads the recipe's raw mode, the Inspector
 * the resolved material), so a shared reader would change one surface's output.
 */
export type NoiseGradientStyle = "off" | "overlay" | "dissolve";

/** Default film-grain strength when a Style switch lands on Mixed. */
const DEFAULT_MIXED_GRAIN_STRENGTH = OBJECT_NOISE_GRADIENT_DEFAULT_MIXED_GRAIN;

/**
 * Maps the single primary Style axis onto `material.mode` / `material.blendMode`
 * / `grain`. `"off"` disables the material and grain outright, always resetting
 * `blendMode` to `undefined` so a later re-enable starts fresh. `"dissolve"`
 * forces the legacy particle-erosion blend and turns grain off (dissolve does
 * not compose with the Mixed film-grain sub-state). `"overlay"` picks a real
 * compositing blend — never `"dissolve"` — defaulting a fresh enable to
 * `"hard-light"` while preserving an already-authored non-dissolve blend, and
 * preserves an existing `"mixed"` (film-grain) sub-state 1:1 with grain enabled,
 * otherwise settling on `"particle"` with grain off. The result is normalized,
 * so callers can pass it straight through their own write path (an outer
 * `normalizeVisualRecipe`/`writeTexture` re-normalize is idempotent).
 */
export const textureWithNoiseGradientStyle = (
	texture: TextureRecipe,
	style: NoiseGradientStyle,
): TextureRecipe => {
	if (style === "off") {
		return normalizeVisualRecipe({
			texture: {
				...texture,
				material: { ...texture.material, mode: "off", blendMode: undefined },
				grain: { ...texture.grain, enabled: false },
			},
		}).texture;
	}
	if (style === "dissolve") {
		return normalizeVisualRecipe({
			texture: {
				...texture,
				material: {
					...texture.material,
					mode: "particle",
					blendMode: "dissolve",
				},
				grain: { ...texture.grain, enabled: false },
			},
		}).texture;
	}
	const keepMixed = texture.material.mode === "mixed";
	const overlayBlend =
		texture.material.blendMode && texture.material.blendMode !== "dissolve"
			? texture.material.blendMode
			: "hard-light";
	return normalizeVisualRecipe({
		texture: {
			...texture,
			material: {
				...texture.material,
				mode: keepMixed ? "mixed" : "particle",
				blendMode: overlayBlend,
			},
			grain: keepMixed
				? {
						...texture.grain,
						enabled: true,
						strength:
							texture.grain.strength > 0
								? texture.grain.strength
								: DEFAULT_MIXED_GRAIN_STRENGTH,
					}
				: { ...texture.grain, enabled: false },
		},
	}).texture;
};
