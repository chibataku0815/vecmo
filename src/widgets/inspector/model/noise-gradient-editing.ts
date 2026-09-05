/**
 * Inspector editing for the Noise Gradient ("noise gradient" 粒状) particle dissolve —
 * both the per-object recipe surface and the graph-native scoped frame overlay surface,
 * including transparent-gradient alpha-matte and dissolve-field authoring.
 */
import {
	createConvertNodeNoiseGradientToScopedLookGraphCommand,
	createUpdateEffectIntentCommand,
	createUpdateNodeRecipeCommand,
} from "@/entities/scene/model/node-commands";
import {
	graphWithObjectNoiseGradientTexture,
	isObjectNoiseGradientScopedLook,
	NOISE_GRADIENT_DEFAULT_CONTRAST,
	NOISE_GRADIENT_DEFAULT_STRENGTH,
	NOISE_GRADIENT_DEFAULT_TEMPORAL_STABILITY,
	OBJECT_NOISE_GRADIENT_DEFAULT_AMOUNT,
	OBJECT_NOISE_GRADIENT_DEFAULT_MIXED_GRAIN,
	objectNoiseGradientGrainNode,
	objectNoiseGradientScopedLookForNode,
} from "@/entities/scene/model/noise-gradient-look";
import {
	type NoiseGradientStyle,
	textureWithNoiseGradientStyle,
} from "@/entities/scene/model/noise-gradient-texture-edits";
import { findArtboardById, findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	RevealPaint,
	SceneDocument,
	ScopedEffectLook,
	VectorNode,
} from "@/entities/scene/model/types";
import {
	DEFAULT_TEXTURE_PARTICLE_FIELD_MESH,
	type EffectMaskLinearGradientSource,
	type EffectMaskRadialGradientSource,
	effectiveTextureBlendMode,
	normalizeVisualRecipe,
	resolveTextureParticleLinearField,
	TEXTURE_MATERIAL_BLEND_MODES,
	type TextureMaterialAlphaMatteSource,
	type TextureMaterialBlendMode,
	type TextureParticleFieldMode,
	type TextureParticleLinearField,
	type TextureRecipe,
	textureParticleFieldMode,
	textureParticleLinearFieldAngle,
	textureParticleLinearFieldEffective,
	textureParticleLinearFieldExtent,
	textureParticleLinearFieldFromAngle,
	textureParticleLinearFieldWithAngle,
} from "@/shared/vec-core";
import {
	applyCommandsAsTransaction,
	MIXED_VALUE,
	type MixedValue,
	mixedValue,
	sameSerializable,
	uniqueNodeIds,
} from "./editing-shared";
import { nodeIdsByArtboard, recipeForNode } from "./frame-look-shared";

const objectNoiseGradientParticleTexturesForSelection = (
	document: SceneDocument,
	nodeIds: readonly string[],
): readonly TextureRecipe[] => {
	const textures: TextureRecipe[] = [];
	const seen = new Set<string>();
	for (const [artboardId, artboardNodeIds] of nodeIdsByArtboard(
		document,
		nodeIds,
	)) {
		const artboard = findArtboardById(document, artboardId);
		if (!artboard) continue;
		for (const nodeId of artboardNodeIds) {
			const look = objectNoiseGradientScopedLookForNode(artboard, nodeId);
			if (!look || seen.has(look.id)) continue;
			seen.add(look.id);
			const particleNode = objectNoiseGradientGrainNode(look);
			if (particleNode?.payload.kind === "grain") {
				textures.push(particleNode.payload.texture);
			}
		}
	}
	return textures;
};

/**
 * Each selected node's OWN `revealPaint` reading (`null` when the node's
 * overlay grain payload carries none), one entry per node id — deliberately
 * NOT de-duplicated by overlay id like
 * {@link objectNoiseGradientParticleTexturesForSelection}, because the mixed-
 * value comparison below needs one reading per SELECTED node (two selected
 * nodes that happen to share one overlay always agree trivially; the
 * de-duplication there exists only to avoid double-counting a texture read,
 * which does not change this comparison either way, but de-duplicating here
 * would silently drop a node whose overlay lookup fails from the comparison
 * instead of contributing its own `null`).
 */
const objectNoiseGradientRevealPaintsForSelection = (
	document: SceneDocument,
	nodeIds: readonly string[],
): readonly (RevealPaint | null)[] => {
	const readings: (RevealPaint | null)[] = [];
	for (const [artboardId, artboardNodeIds] of nodeIdsByArtboard(
		document,
		nodeIds,
	)) {
		const artboard = findArtboardById(document, artboardId);
		if (!artboard) continue;
		for (const nodeId of artboardNodeIds) {
			const look = objectNoiseGradientScopedLookForNode(artboard, nodeId);
			const particleNode = look ? objectNoiseGradientGrainNode(look) : null;
			readings.push(
				particleNode?.payload.kind === "grain"
					? (particleNode.payload.revealPaint ?? null)
					: null,
			);
		}
	}
	return readings;
};

/**
 * Mixed-value collapse using STRUCTURAL equality ({@link sameSerializable}),
 * unlike {@link mixedItemValue}/`mixedValue` (both `Object.is`-based, which
 * would misreport two structurally-identical gradient objects — a common
 * case here, since every node created by one `scene/author-object-noise-
 * gradient` multi-node authoring call gets its own freshly-built but
 * value-equal `revealPaint` object — as "mixed").
 */
const mixedRevealPaintValue = (
	readings: readonly (RevealPaint | null)[],
): MixedValue<RevealPaint | null> | null => {
	if (readings.length === 0) return null;
	const [first, ...rest] = readings;
	return rest.every((reading) => sameSerializable(reading, first))
		? (first ?? null)
		: MIXED_VALUE;
};

/** Current object Noise Gradient `revealPaint` (mixed across selected overlays). */
export function noiseGradientFrameGraphRevealPaintForSelection(
	document: SceneDocument,
	nodeIds: readonly string[],
): MixedValue<RevealPaint | null> | null {
	return mixedRevealPaintValue(
		objectNoiseGradientRevealPaintsForSelection(document, nodeIds),
	);
}

const mixedItemValue = <Item, Value>(
	items: readonly Item[],
	read: (item: Item) => Value,
): MixedValue<Value> | null => {
	if (items.length === 0) return null;
	const first = read(items[0]);
	return items.every((item) => Object.is(read(item), first))
		? first
		: MIXED_VALUE;
};

export const NOISE_GRADIENT_MATTE_NONE = "none";
export const NOISE_GRADIENT_MATTE_LINEAR = "linear";
export const NOISE_GRADIENT_MATTE_RADIAL = "radial";
export const NOISE_GRADIENT_MATTE_CUSTOM = "custom";

export type NoiseGradientMatteKind =
	| typeof NOISE_GRADIENT_MATTE_NONE
	| typeof NOISE_GRADIENT_MATTE_LINEAR
	| typeof NOISE_GRADIENT_MATTE_RADIAL
	| typeof NOISE_GRADIENT_MATTE_CUSTOM;

export type NoiseGradientMatteNumberField =
	| "angle"
	| "centerX"
	| "centerY"
	| "radiusX"
	| "radiusY"
	| "feather";

export type NoiseGradientMatteValues = {
	readonly kind: MixedValue<NoiseGradientMatteKind> | null;
	readonly angle: MixedValue<number> | null;
	readonly centerX: MixedValue<number> | null;
	readonly centerY: MixedValue<number> | null;
	readonly radiusX: MixedValue<number> | null;
	readonly radiusY: MixedValue<number> | null;
	readonly feather: MixedValue<number> | null;
};

export type NoiseGradientLinearFieldNumberField = "x1" | "y1" | "x2" | "y2";

export type NoiseGradientLinearFieldValues = Record<
	NoiseGradientLinearFieldNumberField,
	MixedValue<number> | null
>;

const FULL_TURN_DEGREES = 360;
const HALF_TURN_DEGREES = 180;
const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const DEFAULT_ALPHA_MATTE_FEATHER = 0.24;
const alphaMatteStopsForFeather = (feather: number) => {
	const clamped = Math.min(1, Math.max(0.02, feather));
	return clamped >= 0.995
		? ([
				{ offset: 0, alpha: 1 },
				{ offset: 1, alpha: 0 },
			] as const)
		: ([
				{ offset: 0, alpha: 1 },
				{ offset: Math.max(0, 1 - clamped), alpha: 1 },
				{ offset: 1, alpha: 0 },
			] as const);
};

const clampUnit = (value: number): number => Math.min(1, Math.max(0, value));

const linearFieldLengthSq = (field: TextureParticleLinearField): number => {
	const dx = field.x2 - field.x1;
	const dy = field.y2 - field.y1;
	return dx * dx + dy * dy;
};

const effectiveLinearFieldForTexture = (
	texture: TextureRecipe,
): TextureParticleLinearField =>
	textureParticleLinearFieldEffective(
		resolveTextureParticleLinearField(texture),
	);

const normalizeAngleDegrees = (angle: number): number =>
	((angle % FULL_TURN_DEGREES) + FULL_TURN_DEGREES) % FULL_TURN_DEGREES;

const defaultLinearAlphaMatte = (
	angle = HALF_TURN_DEGREES,
	feather = DEFAULT_ALPHA_MATTE_FEATHER,
): EffectMaskLinearGradientSource => {
	const radians = normalizeAngleDegrees(angle) * DEG_TO_RAD;
	const direction = { x: Math.cos(radians), y: Math.sin(radians) };
	const extent =
		0.5 / Math.max(Math.abs(direction.x), Math.abs(direction.y), 1e-6);
	return {
		kind: "linearGradient",
		space: "target",
		x1: clampUnit(0.5 - direction.x * extent),
		y1: clampUnit(0.5 - direction.y * extent),
		x2: clampUnit(0.5 + direction.x * extent),
		y2: clampUnit(0.5 + direction.y * extent),
		stops: alphaMatteStopsForFeather(feather),
	};
};

const defaultRadialAlphaMatte = (
	feather = DEFAULT_ALPHA_MATTE_FEATHER,
): EffectMaskRadialGradientSource => ({
	kind: "radialGradient",
	space: "target",
	cx: 0.5,
	cy: 0.5,
	radius: 0.5,
	rx: 0.5,
	ry: 0.5,
	rotation: 0,
	stops: alphaMatteStopsForFeather(feather),
});

const alphaMatteKind = (
	matte: TextureRecipe["material"]["alphaMatte"],
): NoiseGradientMatteKind => {
	if (!matte) return NOISE_GRADIENT_MATTE_NONE;
	if (matte.kind === "linearGradient") return NOISE_GRADIENT_MATTE_LINEAR;
	if (matte.kind === "radialGradient") return NOISE_GRADIENT_MATTE_RADIAL;
	return NOISE_GRADIENT_MATTE_CUSTOM;
};

const alphaMatteLinearAngle = (
	matte: TextureRecipe["material"]["alphaMatte"],
): number => {
	if (matte?.kind !== "linearGradient") return HALF_TURN_DEGREES;
	return Math.round(
		normalizeAngleDegrees(
			Math.atan2(matte.y2 - matte.y1, matte.x2 - matte.x1) * RAD_TO_DEG,
		),
	);
};

const alphaMatteRadiusX = (
	matte: TextureRecipe["material"]["alphaMatte"],
): number => {
	if (matte?.kind !== "radialGradient") return 0.5;
	return Math.round(matte.rx * 1000) / 1000;
};

const alphaMatteRadiusY = (
	matte: TextureRecipe["material"]["alphaMatte"],
): number => {
	if (matte?.kind !== "radialGradient") return 0.5;
	return Math.round(matte.ry * 1000) / 1000;
};

const alphaMatteFeather = (
	matte: TextureRecipe["material"]["alphaMatte"],
): number => {
	if (!matte || !("stops" in matte) || matte.stops.length < 2) {
		return DEFAULT_ALPHA_MATTE_FEATHER;
	}
	const lastOpaqueOffset = matte.stops.reduce(
		(maxOffset, stop) =>
			stop.alpha >= 0.98 ? Math.max(maxOffset, stop.offset) : maxOffset,
		0,
	);
	return Math.round((1 - lastOpaqueOffset) * 1000) / 1000;
};

const textureWithNoiseGradientMatteKind = (
	texture: TextureRecipe,
	kind: NoiseGradientMatteKind,
): TextureRecipe => {
	if (kind === NOISE_GRADIENT_MATTE_CUSTOM) return texture;
	const alphaMatte =
		kind === NOISE_GRADIENT_MATTE_LINEAR
			? defaultLinearAlphaMatte(
					alphaMatteLinearAngle(texture.material.alphaMatte),
					alphaMatteFeather(texture.material.alphaMatte),
				)
			: kind === NOISE_GRADIENT_MATTE_RADIAL
				? defaultRadialAlphaMatte(
						alphaMatteFeather(texture.material.alphaMatte),
					)
				: undefined;
	return normalizeVisualRecipe({
		texture: {
			...texture,
			material: {
				...texture.material,
				mode: "particle",
				alphaMatte,
			},
		},
	}).texture;
};

const textureWithNoiseGradientMatteNumber = (
	texture: TextureRecipe,
	field: NoiseGradientMatteNumberField,
	value: number,
): TextureRecipe => {
	const matte = texture.material.alphaMatte;
	let alphaMatte: TextureMaterialAlphaMatteSource;
	if (field === "angle") {
		alphaMatte = defaultLinearAlphaMatte(value, alphaMatteFeather(matte));
	} else if (field === "feather") {
		const base =
			matte?.kind === "linearGradient" || matte?.kind === "radialGradient"
				? matte
				: defaultRadialAlphaMatte();
		alphaMatte = {
			...base,
			stops: alphaMatteStopsForFeather(value),
		};
	} else {
		const base =
			matte?.kind === "radialGradient"
				? matte
				: defaultRadialAlphaMatte(alphaMatteFeather(matte));
		const rx = field === "radiusX" ? clampUnit(value) : base.rx;
		const ry = field === "radiusY" ? clampUnit(value) : base.ry;
		alphaMatte = {
			...base,
			...(field === "centerX" ? { cx: clampUnit(value) } : {}),
			...(field === "centerY" ? { cy: clampUnit(value) } : {}),
			radius: (rx + ry) / 2,
			rx,
			ry,
		};
	}
	return normalizeVisualRecipe({
		texture: {
			...texture,
			material: {
				...texture.material,
				mode: "particle",
				alphaMatte,
			},
		},
	}).texture;
};

const textureWithNoiseGradientNumber = (
	texture: TextureRecipe,
	field: NoiseGradientNumberField,
	value: number,
): TextureRecipe =>
	normalizeVisualRecipe({
		texture: {
			...texture,
			material: {
				...texture.material,
				mode: "particle",
				strength: field === "extent" ? value : texture.material.strength,
				particleContrast:
					field === "softness" ? 1 - value : texture.material.particleContrast,
				...(field === "extent" && textureParticleFieldMode(texture) === "linear"
					? {
							linearField: {
								...effectiveLinearFieldForTexture(texture),
								plateau: 1 - value,
							},
						}
					: {}),
			},
		},
	}).texture;

const textureWithNoiseGradientDirection = (
	texture: TextureRecipe,
	angle: number | null | typeof NOISE_GRADIENT_DIRECTION_MESH,
): TextureRecipe => {
	const nextLinearField =
		typeof angle === "number"
			? textureParticleLinearFieldWithAngle(
					effectiveLinearFieldForTexture(texture),
					angle,
				)
			: null;
	return normalizeVisualRecipe({
		texture: {
			...texture,
			material: {
				...texture.material,
				mode: "particle",
				fieldMode:
					angle === null
						? "contour"
						: angle === NOISE_GRADIENT_DIRECTION_MESH
							? "mesh"
							: "linear",
				...(nextLinearField
					? {
							angle: textureParticleLinearFieldAngle(nextLinearField),
							strength: textureParticleLinearFieldExtent(nextLinearField),
							linearField: nextLinearField,
						}
					: {}),
				...(angle === NOISE_GRADIENT_DIRECTION_MESH
					? {
							fieldMesh:
								texture.material.fieldMesh ??
								DEFAULT_TEXTURE_PARTICLE_FIELD_MESH,
						}
					: {}),
			},
		},
	}).texture;
};

/**
 * Sets only `material.blendMode`, leaving every other material/grain field
 * untouched — unlike {@link textureWithNoiseGradientDirection}, this never
 * forces `mode: "particle"` since Blend is editable regardless of dissolve
 * field shape.
 */
const textureWithNoiseGradientBlendMode = (
	texture: TextureRecipe,
	blendMode: TextureMaterialBlendMode,
): TextureRecipe =>
	normalizeVisualRecipe({
		texture: {
			...texture,
			material: {
				...texture.material,
				blendMode,
			},
		},
	}).texture;

const textureWithNoiseGradientLinearFieldNumber = (
	texture: TextureRecipe,
	field: NoiseGradientLinearFieldNumberField,
	value: number,
): TextureRecipe => {
	const linearField = effectiveLinearFieldForTexture(texture);
	const nextLinearField = {
		...linearField,
		x1: field === "x1" ? value : linearField.x1,
		y1: field === "y1" ? value : linearField.y1,
		x2: field === "x2" ? value : linearField.x2,
		y2: field === "y2" ? value : linearField.y2,
	} satisfies TextureParticleLinearField;
	if (linearFieldLengthSq(nextLinearField) <= 1e-6) return texture;
	return normalizeVisualRecipe({
		texture: {
			...texture,
			material: {
				...texture.material,
				fieldMode: "linear",
				angle: textureParticleLinearFieldAngle(nextLinearField),
				strength: textureParticleLinearFieldExtent(nextLinearField),
				linearField: nextLinearField,
			},
		},
	}).texture;
};

const textureWithNoiseGradientLinearFieldInvert = (
	texture: TextureRecipe,
): TextureRecipe => {
	const linearField = effectiveLinearFieldForTexture(texture);
	const nextLinearField = {
		...linearField,
		x1: linearField.x2,
		y1: linearField.y2,
		x2: linearField.x1,
		y2: linearField.y1,
	};
	return normalizeVisualRecipe({
		texture: {
			...texture,
			material: {
				...texture.material,
				fieldMode: "linear",
				angle: textureParticleLinearFieldAngle(nextLinearField),
				strength: textureParticleLinearFieldExtent(nextLinearField),
				linearField: nextLinearField,
			},
		},
	}).texture;
};

const textureWithNoiseGradientLinearFieldFit = (
	texture: TextureRecipe,
): TextureRecipe => {
	const linearField = effectiveLinearFieldForTexture(texture);
	const nextLinearField = textureParticleLinearFieldFromAngle(
		textureParticleLinearFieldAngle(linearField),
		textureParticleLinearFieldExtent(linearField),
	);
	return normalizeVisualRecipe({
		texture: {
			...texture,
			material: {
				...texture.material,
				fieldMode: "linear",
				angle: textureParticleLinearFieldAngle(nextLinearField),
				strength: textureParticleLinearFieldExtent(nextLinearField),
				linearField: nextLinearField,
			},
		},
	}).texture;
};

const textureWithNoiseGradientPreset = (
	texture: TextureRecipe,
	preset: NoiseGradientPreset,
): TextureRecipe =>
	normalizeVisualRecipe({
		texture: {
			...texture,
			grain: {
				...texture.grain,
				enabled: true,
				strength:
					texture.grain.densityCoupling > 0
						? texture.grain.densityCoupling
						: OBJECT_NOISE_GRADIENT_DEFAULT_AMOUNT,
				size: preset.size,
				densityCoupling:
					texture.grain.densityCoupling > 0
						? texture.grain.densityCoupling
						: OBJECT_NOISE_GRADIENT_DEFAULT_AMOUNT,
				temporalStability: preset.temporalStability,
			},
			material: {
				...texture.material,
				mode: "particle",
				strength: preset.strength,
				particleContrast: preset.particleContrast,
				fieldMode:
					preset.fieldMode ??
					(typeof preset.angle === "number" ? "linear" : "contour"),
				...(typeof preset.angle === "number" ? { angle: preset.angle } : {}),
				...(typeof preset.angle === "number"
					? {
							linearField: textureParticleLinearFieldFromAngle(
								preset.angle,
								preset.strength,
							),
						}
					: {}),
				...(preset.fieldMode === "mesh"
					? {
							fieldMesh:
								texture.material.fieldMesh ??
								DEFAULT_TEXTURE_PARTICLE_FIELD_MESH,
						}
					: {}),
			},
		},
	}).texture;

const commitNoiseGradientFrameGraphTextureEdit = (
	nodeIds: readonly string[],
	scope: string,
	label: string,
	update: (texture: TextureRecipe) => TextureRecipe,
): boolean => {
	const document = useSceneStore.getState().document;
	const commands = [...nodeIdsByArtboard(document, nodeIds).entries()].flatMap(
		([artboardId, artboardNodeIds]) => {
			const artboard = findArtboardById(document, artboardId);
			const scopedLooks = artboard?.effectIntent?.scopedLooks;
			if (!artboard || !scopedLooks?.length) return [];
			const selectedIds = new Set(artboardNodeIds);
			let changed = false;
			const nextScopedLooks = scopedLooks.map((look) => {
				if (
					!isObjectNoiseGradientScopedLook(look) ||
					!look.targetNodeIds.some((nodeId) => selectedIds.has(nodeId))
				) {
					return look;
				}
				const particleNode = objectNoiseGradientGrainNode(look);
				if (particleNode?.payload.kind !== "grain") return look;
				const nextTexture = update(particleNode.payload.texture);
				const nextGraph = graphWithObjectNoiseGradientTexture(
					look,
					nextTexture,
				);
				if (!nextGraph) return look;
				const nextLook = { ...look, lookGraph: nextGraph };
				if (sameSerializable(look, nextLook)) return look;
				changed = true;
				return nextLook;
			});
			if (!changed) return [];
			return [
				createUpdateEffectIntentCommand(
					{ scope: "artboard", artboardId },
					{ scopedLooks: nextScopedLooks },
					{
						label,
						coalesceKey: `frame-look:noise-gradient:${scope}:${artboardId}`,
					},
				),
			];
		},
	);
	if (commands.length === 0) return false;
	return applyCommandsAsTransaction(
		`frame-look:noise-gradient:${scope}:${uniqueNodeIds(nodeIds).join(",")}`,
		label,
		commands,
	);
};

/**
 * Commits the object Noise Gradient dissolve's `revealPaint` across selected
 * overlays — the Inspector's "Reveal paint" row. Deliberately its OWN function
 * rather than a `commitNoiseGradientFrameGraphTextureEdit(nodeIds, scope,
 * label, (texture) => texture)` call: that helper always calls
 * `graphWithObjectNoiseGradientTexture(look, nextTexture)` with ONLY the
 * 2-arg form, which PRESERVES the existing `revealPaint` (see that function's
 * own doc) — exactly the contract every texture-slider commit needs, but the
 * opposite of what a `revealPaint` write itself needs (it must pass the 3rd
 * `options` arg to actually set/clear the value). Passes the particle node's
 * OWN CURRENT texture back unchanged as the 2nd arg, so this commit touches
 * only the `revealPaint` field.
 *
 * `value: RevealPaint | null` mirrors the entity-layer tri-state contract
 * exactly (see `GraphWithObjectNoiseGradientTextureOptions`): `null` clears
 * the reveal (explicit remove), a `RevealPaint` sets it. There is no
 * "preserve" case here because presence in this call always means the user
 * took an explicit action (picked a color, chose a kind, or clicked the clear
 * affordance) — the preserve default lives only in `graphWithObjectNoise
 * GradientTexture`'s omitted-3rd-arg contract, used by the OTHER (texture)
 * commits above, never by this one.
 *
 * `coalesceKey`, like {@link commitPrimaryPaintColor} in `paint-editing.ts`,
 * lets a live color-picker drag merge every tick into one undo entry; a
 * discrete kind-switch or clear click omits it and gets its own undo step.
 * Threaded ONLY to `applyCommandsAsTransaction`'s own coalesce parameter
 * (the mechanism `useSceneStore.beginTransaction` actually reads for undo-
 * merging — see that store's doc): each individual `SceneCommand`'s own
 * `coalesceKey` field is dead weight once wrapped in a transaction (`apply`
 * only consults a command's own key on the direct, non-transactional path),
 * so unlike the sibling `commitNoiseGradientFrameGraph*` functions above
 * (which have no gesture caller and so bake a static coalesce string into
 * each command instead), this function does not set one.
 */
export function commitNoiseGradientFrameGraphRevealPaint(
	nodeIds: readonly string[],
	value: RevealPaint | null,
	coalesceKey?: string,
): boolean {
	const document = useSceneStore.getState().document;
	const commands = [...nodeIdsByArtboard(document, nodeIds).entries()].flatMap(
		([artboardId, artboardNodeIds]) => {
			const artboard = findArtboardById(document, artboardId);
			const scopedLooks = artboard?.effectIntent?.scopedLooks;
			if (!artboard || !scopedLooks?.length) return [];
			const selectedIds = new Set(artboardNodeIds);
			let changed = false;
			const nextScopedLooks = scopedLooks.map((look) => {
				if (
					!isObjectNoiseGradientScopedLook(look) ||
					!look.targetNodeIds.some((nodeId) => selectedIds.has(nodeId))
				) {
					return look;
				}
				const particleNode = objectNoiseGradientGrainNode(look);
				if (particleNode?.payload.kind !== "grain") return look;
				const nextGraph = graphWithObjectNoiseGradientTexture(
					look,
					particleNode.payload.texture,
					{ revealPaint: value },
				);
				if (!nextGraph) return look;
				const nextLook = { ...look, lookGraph: nextGraph };
				if (sameSerializable(look, nextLook)) return look;
				changed = true;
				return nextLook;
			});
			if (!changed) return [];
			return [
				createUpdateEffectIntentCommand(
					{ scope: "artboard", artboardId },
					{ scopedLooks: nextScopedLooks },
					{ label: "Edit reveal paint" },
				),
			];
		},
	);
	if (commands.length === 0) return false;
	return applyCommandsAsTransaction(
		`frame-look:noise-gradient:reveal-paint:${uniqueNodeIds(nodeIds).join(",")}`,
		"Edit reveal paint",
		commands,
		coalesceKey,
	);
}

/**
 * Inspector-side counterpart to the tool bar's `commitNoiseGradientToolRevealPaint`
 * (`features/noise-gradient/model/tool-controls.ts`): `revealPaint` lives only in
 * the scoped Look Graph grain payload, so a plain object-material Dissolve has no
 * `revealPaint` to write until it is promoted to a scoped overlay. This auto-
 * promotes every selected node that is not already scoped, then commits the reveal
 * through {@link commitNoiseGradientFrameGraphRevealPaint} — giving the Inspector's
 * "Reveal paint" row the same no-manual-convert reachability the tool bar already
 * has, across a multi-node selection.
 *
 * Two-phase, each its own undo-visible commit (mirroring the tool bar, which also
 * applies the convert and the reveal as separate applies): phase 1 converts only
 * the nodes that need it (an already-scoped node is left untouched), phase 2 then
 * always runs so a selection that was already fully scoped still gets its reveal
 * written. `coalesceKey` forwards to phase 2 only — the promote step is a discrete,
 * one-time structural change and should never merge with a color-drag gesture.
 */
export function commitNoiseGradientRevealPaint(
	nodeIds: readonly string[],
	value: RevealPaint | null,
	coalesceKey?: string,
): boolean {
	const document = useSceneStore.getState().document;
	const convertCommands = [
		...nodeIdsByArtboard(document, nodeIds).entries(),
	].flatMap(([artboardId, artboardNodeIds]) => {
		const artboard = findArtboardById(document, artboardId);
		if (!artboard) return [];
		return artboardNodeIds
			.filter(
				(nodeId) => !objectNoiseGradientScopedLookForNode(artboard, nodeId),
			)
			.map((nodeId) =>
				createConvertNodeNoiseGradientToScopedLookGraphCommand(nodeId, {
					label: "Convert Noise Gradient to scoped effect",
					coalesceKey: `frame-look:noise-gradient-convert:${nodeId}`,
				}),
			);
	});
	if (convertCommands.length > 0) {
		applyCommandsAsTransaction(
			`frame-look:noise-gradient-convert:${uniqueNodeIds(nodeIds).join(",")}`,
			"Convert Noise Gradient to scoped effect",
			convertCommands,
		);
	}
	return commitNoiseGradientFrameGraphRevealPaint(nodeIds, value, coalesceKey);
}

/**
 * Moves the selected object Noise Gradient dissolve into graph-native scoped
 * frame overlays, then clears only the object recipe's particle material mode so
 * the dissolve is not applied twice. Each selected node gets its own overlay to
 * preserve per-object particle values.
 */
export function commitNoiseGradientFrameGraph(
	nodeIds: readonly string[],
): boolean {
	const ids = uniqueNodeIds(nodeIds);
	if (ids.length === 0) return false;
	return applyCommandsAsTransaction(
		`frame-look:noise-gradient-convert:${ids.join(",")}`,
		"Convert Noise Gradient to scoped effect",
		ids.map((nodeId) =>
			createConvertNodeNoiseGradientToScopedLookGraphCommand(nodeId, {
				label: "Convert Noise Gradient to scoped effect",
				coalesceKey: `frame-look:noise-gradient-convert:${nodeId}`,
			}),
		),
	);
}

export type NoiseGradientFrameGraphLookState = {
	readonly status: "none" | "partial" | "all";
	readonly selectedCount: number;
	readonly appliedCount: number;
};

/** Reports how much of the current selection is covered by scoped graph Noise Gradient overlays. */
export function noiseGradientFrameGraphStateForSelection(
	document: SceneDocument,
	nodeIds: readonly string[],
): NoiseGradientFrameGraphLookState {
	let selectedCount = 0;
	let appliedCount = 0;
	for (const [artboardId, artboardNodeIds] of nodeIdsByArtboard(
		document,
		nodeIds,
	)) {
		const artboard = findArtboardById(document, artboardId);
		if (!artboard) continue;
		selectedCount += artboardNodeIds.length;
		for (const nodeId of artboardNodeIds) {
			if (objectNoiseGradientScopedLookForNode(artboard, nodeId)) {
				appliedCount += 1;
			}
		}
	}
	return {
		status:
			appliedCount === 0
				? "none"
				: appliedCount === selectedCount
					? "all"
					: "partial",
		selectedCount,
		appliedCount,
	};
}

/**
 * Removes scoped graph Noise Gradient overlays from the selected nodes. If a
 * future overlay targets multiple nodes, only the selected targets are removed.
 */
export function commitRemoveNoiseGradientFrameGraph(
	nodeIds: readonly string[],
): boolean {
	const document = useSceneStore.getState().document;
	const commands = [...nodeIdsByArtboard(document, nodeIds).entries()].flatMap(
		([artboardId, artboardNodeIds]) => {
			const artboard = findArtboardById(document, artboardId);
			const scopedLooks = artboard?.effectIntent?.scopedLooks;
			if (!artboard || !scopedLooks?.length) return [];
			const selectedIds = new Set(artboardNodeIds);
			let changed = false;
			const nextScopedLooks: ScopedEffectLook[] = scopedLooks.flatMap(
				(look): ScopedEffectLook[] => {
					if (!isObjectNoiseGradientScopedLook(look)) return [look];
					const remainingTargetNodeIds = look.targetNodeIds.filter(
						(nodeId) => !selectedIds.has(nodeId),
					);
					if (remainingTargetNodeIds.length === look.targetNodeIds.length) {
						return [look];
					}
					changed = true;
					return remainingTargetNodeIds.length > 0
						? [{ ...look, targetNodeIds: remainingTargetNodeIds }]
						: [];
				},
			);
			if (!changed) return [];
			return [
				createUpdateEffectIntentCommand(
					{ scope: "artboard", artboardId },
					{ scopedLooks: nextScopedLooks.length > 0 ? nextScopedLooks : null },
					{
						label: "Remove scoped Noise Gradient",
						coalesceKey: `frame-look:noise-gradient-remove:${artboardId}`,
					},
				),
			];
		},
	);
	if (commands.length === 0) return false;
	return applyCommandsAsTransaction(
		`frame-look:noise-gradient-remove:${uniqueNodeIds(nodeIds).join(",")}`,
		"Remove scoped Noise Gradient",
		commands,
	);
}

/**
 * Toggles the Noise Gradient on the selected nodes by flipping each node
 * recipe's `texture.material.mode` between `"particle"` and `"off"`, through the
 * same undoable node-recipe command bus as every other look edit. A truly fresh
 * enable (no `material.blendMode` authored yet) also seeds `blendMode: "hard-light"`
 * plus sensible band/contrast/grain defaults, so one click shows the reframed
 * default look — noise composited OVER the object's normal fill via
 * {@link grainPrimitives} — not the legacy particle dissolve; picking `"dissolve"`
 * from the Blend dropdown (or an already-authored `blendMode`) still routes
 * through {@link particleDissolvePrimitives} unchanged. Re-enabling after a
 * disable preserves whatever `blendMode` was last authored.
 */
export function commitNoiseGradientNodeLook(
	nodeIds: readonly string[],
	enabled: boolean,
): boolean {
	const document = useSceneStore.getState().document;
	const commands = uniqueNodeIds(nodeIds).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node) return [];
		const current = recipeForNode(node);
		const material = current.texture.material;
		const particleActive =
			material.mode === "particle" || material.mode === "mixed";
		const isFreshEnable = enabled && material.blendMode === undefined;
		const next = normalizeVisualRecipe({
			...current,
			texture: {
				...current.texture,
				grain: {
					...current.texture.grain,
					enabled: enabled || current.texture.grain.enabled,
					strength:
						isFreshEnable && current.texture.grain.strength <= 0
							? OBJECT_NOISE_GRADIENT_DEFAULT_AMOUNT
							: current.texture.grain.strength,
					temporalStability:
						enabled && !particleActive
							? NOISE_GRADIENT_DEFAULT_TEMPORAL_STABILITY
							: current.texture.grain.temporalStability,
				},
				material: {
					...material,
					mode: enabled ? "particle" : "off",
					...(isFreshEnable ? { blendMode: "hard-light" as const } : {}),
					strength:
						enabled && material.strength <= 0
							? NOISE_GRADIENT_DEFAULT_STRENGTH
							: material.strength,
					particleContrast:
						enabled && material.particleContrast <= 0
							? NOISE_GRADIENT_DEFAULT_CONTRAST
							: material.particleContrast,
				},
			},
		});
		return [createUpdateNodeRecipeCommand(nodeId, next)];
	});
	if (commands.length === 0) return false;
	return applyCommandsAsTransaction(
		`recipe:noise-gradient:${uniqueNodeIds(nodeIds).join(",")}`,
		enabled ? "Enable noise gradient" : "Disable noise gradient",
		commands,
	);
}

export type NoiseGradientNodeLookState = {
	readonly status: "none" | "partial" | "all";
	readonly selectedCount: number;
	readonly enabledCount: number;
};

/** Reports how much of the node selection currently has the noise-gradient dissolve. */
export function noiseGradientNodeLookStateForSelection(
	document: SceneDocument,
	nodeIds: readonly string[],
): NoiseGradientNodeLookState {
	let selectedCount = 0;
	let enabledCount = 0;
	for (const nodeId of uniqueNodeIds(nodeIds)) {
		const node = findNode(document, nodeId);
		if (!node) continue;
		selectedCount += 1;
		const mode = recipeForNode(node).texture.material.mode;
		if (mode === "particle" || mode === "mixed") enabledCount += 1;
	}
	return {
		status:
			enabledCount === 0
				? "none"
				: enabledCount === selectedCount
					? "all"
					: "partial",
		selectedCount,
		enabledCount,
	};
}

export type NoiseGradientNumberField = "extent" | "softness";

/**
 * Commits one noise-gradient range control across the selection through the same
 * undoable node-recipe bus. `extent` is the dissolve band reach
 * (`material.strength`); `softness` is the inverse of threshold hardness
 * (`material.particleContrast = 1 − softness`) so a higher value feathers the
 * particles. Field/angle are authored separately; transparent fill ramps still
 * enrich the dissolve when the object uses one.
 */
export function commitNoiseGradientNumber(
	nodeIds: readonly string[],
	field: NoiseGradientNumberField,
	value: number,
): boolean {
	if (!Number.isFinite(value)) return false;
	const clamped = Math.min(1, Math.max(0, value));
	const document = useSceneStore.getState().document;
	const commands = uniqueNodeIds(nodeIds).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node) return [];
		const current = recipeForNode(node);
		const material = current.texture.material;
		const nextLinearField =
			field === "extent" &&
			textureParticleFieldMode(current.texture) === "linear"
				? {
						...effectiveLinearFieldForTexture(current.texture),
						plateau: 1 - clamped,
					}
				: null;
		const next = normalizeVisualRecipe({
			...current,
			texture: {
				...current.texture,
				material: {
					...material,
					strength: field === "extent" ? clamped : material.strength,
					particleContrast:
						field === "softness" ? 1 - clamped : material.particleContrast,
					...(nextLinearField ? { linearField: nextLinearField } : {}),
				},
			},
		});
		return [createUpdateNodeRecipeCommand(nodeId, next)];
	});
	if (commands.length === 0) return false;
	return applyCommandsAsTransaction(
		`recipe:noise-gradient-${field}:${uniqueNodeIds(nodeIds).join(",")}`,
		field === "extent" ? "Noise gradient extent" : "Noise gradient softness",
		commands,
	);
}

export type NoiseGradientNodeValues = {
	readonly extent: MixedValue<number> | null;
	readonly softness: MixedValue<number> | null;
};

/** Current scoped graph extent and softness for selected Noise Gradient overlays. */
export function noiseGradientFrameGraphValuesForSelection(
	document: SceneDocument,
	nodeIds: readonly string[],
): NoiseGradientNodeValues {
	const textures = objectNoiseGradientParticleTexturesForSelection(
		document,
		nodeIds,
	);
	return {
		extent: mixedItemValue(textures, (texture) => texture.material.strength),
		softness: mixedItemValue(
			textures,
			(texture) => 1 - texture.material.particleContrast,
		),
	};
}

/** Current extent and softness (mixed across the selection) for Inspector controls. */
export function noiseGradientNodeValuesForSelection(
	nodes: readonly VectorNode[],
): NoiseGradientNodeValues {
	return {
		extent: mixedValue(
			nodes,
			(node) => recipeForNode(node).texture.material.strength,
		),
		softness: mixedValue(
			nodes,
			(node) => 1 - recipeForNode(node).texture.material.particleContrast,
		),
	};
}

/** Current transparent-gradient matte controls for selected scoped Noise Gradient overlays. */
export function noiseGradientFrameGraphMatteValuesForSelection(
	document: SceneDocument,
	nodeIds: readonly string[],
): NoiseGradientMatteValues {
	const textures = objectNoiseGradientParticleTexturesForSelection(
		document,
		nodeIds,
	);
	return {
		kind: mixedItemValue(textures, (texture) =>
			alphaMatteKind(texture.material.alphaMatte),
		),
		angle: mixedItemValue(textures, (texture) =>
			alphaMatteLinearAngle(texture.material.alphaMatte),
		),
		centerX: mixedItemValue(textures, (texture) =>
			texture.material.alphaMatte?.kind === "radialGradient"
				? texture.material.alphaMatte.cx
				: 0.5,
		),
		centerY: mixedItemValue(textures, (texture) =>
			texture.material.alphaMatte?.kind === "radialGradient"
				? texture.material.alphaMatte.cy
				: 0.5,
		),
		radiusX: mixedItemValue(textures, (texture) =>
			alphaMatteRadiusX(texture.material.alphaMatte),
		),
		radiusY: mixedItemValue(textures, (texture) =>
			alphaMatteRadiusY(texture.material.alphaMatte),
		),
		feather: mixedItemValue(textures, (texture) =>
			alphaMatteFeather(texture.material.alphaMatte),
		),
	};
}

/** Current transparent-gradient matte controls for selected object Noise Gradients. */
export function noiseGradientNodeMatteValuesForSelection(
	nodes: readonly VectorNode[],
): NoiseGradientMatteValues {
	return {
		kind: mixedValue(nodes, (node) =>
			alphaMatteKind(recipeForNode(node).texture.material.alphaMatte),
		),
		angle: mixedValue(nodes, (node) =>
			alphaMatteLinearAngle(recipeForNode(node).texture.material.alphaMatte),
		),
		centerX: mixedValue(nodes, (node) => {
			const matte = recipeForNode(node).texture.material.alphaMatte;
			return matte?.kind === "radialGradient" ? matte.cx : 0.5;
		}),
		centerY: mixedValue(nodes, (node) => {
			const matte = recipeForNode(node).texture.material.alphaMatte;
			return matte?.kind === "radialGradient" ? matte.cy : 0.5;
		}),
		radiusX: mixedValue(nodes, (node) =>
			alphaMatteRadiusX(recipeForNode(node).texture.material.alphaMatte),
		),
		radiusY: mixedValue(nodes, (node) =>
			alphaMatteRadiusY(recipeForNode(node).texture.material.alphaMatte),
		),
		feather: mixedValue(nodes, (node) =>
			alphaMatteFeather(recipeForNode(node).texture.material.alphaMatte),
		),
	};
}

/** Commits one numeric Noise Gradient field across selected scoped graph overlays. */
export function commitNoiseGradientFrameGraphNumber(
	nodeIds: readonly string[],
	field: NoiseGradientNumberField,
	value: number,
): boolean {
	if (!Number.isFinite(value)) return false;
	const clamped = Math.min(1, Math.max(0, value));
	return commitNoiseGradientFrameGraphTextureEdit(
		nodeIds,
		`number:${field}`,
		field === "extent"
			? "Noise gradient frame extent"
			: "Noise gradient frame softness",
		(texture) => textureWithNoiseGradientNumber(texture, field, clamped),
	);
}

/** Selects the transparent-gradient matte source for selected scoped Noise Gradient overlays. */
export function commitNoiseGradientFrameGraphMatteKind(
	nodeIds: readonly string[],
	kind: NoiseGradientMatteKind,
): boolean {
	if (kind === NOISE_GRADIENT_MATTE_CUSTOM) return false;
	return commitNoiseGradientFrameGraphTextureEdit(
		nodeIds,
		`matte-kind:${kind}`,
		"Noise gradient frame matte",
		(texture) => textureWithNoiseGradientMatteKind(texture, kind),
	);
}

/** Edits one transparent-gradient matte number on selected scoped overlays. */
export function commitNoiseGradientFrameGraphMatteNumber(
	nodeIds: readonly string[],
	field: NoiseGradientMatteNumberField,
	value: number,
): boolean {
	if (!Number.isFinite(value)) return false;
	return commitNoiseGradientFrameGraphTextureEdit(
		nodeIds,
		`matte-number:${field}`,
		"Noise gradient frame matte",
		(texture) => textureWithNoiseGradientMatteNumber(texture, field, value),
	);
}

/** Edits one Linear field endpoint coordinate on selected scoped overlays. */
export function commitNoiseGradientFrameGraphLinearFieldNumber(
	nodeIds: readonly string[],
	field: NoiseGradientLinearFieldNumberField,
	value: number,
): boolean {
	if (!Number.isFinite(value)) return false;
	return commitNoiseGradientFrameGraphTextureEdit(
		nodeIds,
		`linear-field:${field}`,
		"Noise gradient frame field",
		(texture) =>
			textureWithNoiseGradientLinearFieldNumber(texture, field, value),
	);
}

/** Swaps Linear field endpoints on selected scoped Noise Gradient overlays. */
export function commitNoiseGradientFrameGraphLinearFieldInvert(
	nodeIds: readonly string[],
): boolean {
	return commitNoiseGradientFrameGraphTextureEdit(
		nodeIds,
		"linear-field:invert",
		"Noise gradient frame field",
		textureWithNoiseGradientLinearFieldInvert,
	);
}

/** Fits Linear field endpoints to selected scoped overlay bounds at the current angle. */
export function commitNoiseGradientFrameGraphLinearFieldFit(
	nodeIds: readonly string[],
): boolean {
	return commitNoiseGradientFrameGraphTextureEdit(
		nodeIds,
		"linear-field:fit",
		"Noise gradient frame field",
		textureWithNoiseGradientLinearFieldFit,
	);
}

/** Selects the transparent-gradient matte source for selected object Noise Gradients. */
export function commitNoiseGradientMatteKind(
	nodeIds: readonly string[],
	kind: NoiseGradientMatteKind,
): boolean {
	if (kind === NOISE_GRADIENT_MATTE_CUSTOM) return false;
	const document = useSceneStore.getState().document;
	const commands = uniqueNodeIds(nodeIds).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node) return [];
		const current = recipeForNode(node);
		const next = normalizeVisualRecipe({
			...current,
			texture: textureWithNoiseGradientMatteKind(current.texture, kind),
		});
		return [createUpdateNodeRecipeCommand(nodeId, next)];
	});
	if (commands.length === 0) return false;
	return applyCommandsAsTransaction(
		`recipe:noise-gradient-matte:${uniqueNodeIds(nodeIds).join(",")}`,
		"Noise gradient matte",
		commands,
	);
}

/** Edits one transparent-gradient matte number on selected object Noise Gradients. */
export function commitNoiseGradientMatteNumber(
	nodeIds: readonly string[],
	field: NoiseGradientMatteNumberField,
	value: number,
): boolean {
	if (!Number.isFinite(value)) return false;
	const document = useSceneStore.getState().document;
	const commands = uniqueNodeIds(nodeIds).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node) return [];
		const current = recipeForNode(node);
		const next = normalizeVisualRecipe({
			...current,
			texture: textureWithNoiseGradientMatteNumber(
				current.texture,
				field,
				value,
			),
		});
		return [createUpdateNodeRecipeCommand(nodeId, next)];
	});
	if (commands.length === 0) return false;
	return applyCommandsAsTransaction(
		`recipe:noise-gradient-matte-${field}:${uniqueNodeIds(nodeIds).join(",")}`,
		"Noise gradient matte",
		commands,
	);
}

/** Edits one Linear field endpoint coordinate on selected object Noise Gradients. */
export function commitNoiseGradientLinearFieldNumber(
	nodeIds: readonly string[],
	field: NoiseGradientLinearFieldNumberField,
	value: number,
): boolean {
	if (!Number.isFinite(value)) return false;
	const document = useSceneStore.getState().document;
	const commands = uniqueNodeIds(nodeIds).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node) return [];
		const current = recipeForNode(node);
		const next = normalizeVisualRecipe({
			...current,
			texture: textureWithNoiseGradientLinearFieldNumber(
				current.texture,
				field,
				value,
			),
		});
		return [createUpdateNodeRecipeCommand(nodeId, next)];
	});
	if (commands.length === 0) return false;
	return applyCommandsAsTransaction(
		`recipe:noise-gradient-linear-${field}:${uniqueNodeIds(nodeIds).join(",")}`,
		"Noise gradient field",
		commands,
	);
}

/** Swaps Linear field endpoints on selected object Noise Gradients. */
export function commitNoiseGradientLinearFieldInvert(
	nodeIds: readonly string[],
): boolean {
	const document = useSceneStore.getState().document;
	const commands = uniqueNodeIds(nodeIds).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node) return [];
		const current = recipeForNode(node);
		const next = normalizeVisualRecipe({
			...current,
			texture: textureWithNoiseGradientLinearFieldInvert(current.texture),
		});
		return [createUpdateNodeRecipeCommand(nodeId, next)];
	});
	if (commands.length === 0) return false;
	return applyCommandsAsTransaction(
		`recipe:noise-gradient-linear-invert:${uniqueNodeIds(nodeIds).join(",")}`,
		"Noise gradient field",
		commands,
	);
}

/** Fits Linear field endpoints to selected object bounds at the current angle. */
export function commitNoiseGradientLinearFieldFit(
	nodeIds: readonly string[],
): boolean {
	const document = useSceneStore.getState().document;
	const commands = uniqueNodeIds(nodeIds).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node) return [];
		const current = recipeForNode(node);
		const next = normalizeVisualRecipe({
			...current,
			texture: textureWithNoiseGradientLinearFieldFit(current.texture),
		});
		return [createUpdateNodeRecipeCommand(nodeId, next)];
	});
	if (commands.length === 0) return false;
	return applyCommandsAsTransaction(
		`recipe:noise-gradient-linear-fit:${uniqueNodeIds(nodeIds).join(",")}`,
		"Noise gradient field",
		commands,
	);
}

/** Sentinel for the circular/contour dissolve in the Field select. */
export const NOISE_GRADIENT_DIRECTION_EDGE = "edge";
/** Sentinel for the scalar Field Mesh dissolve density surface. */
export const NOISE_GRADIENT_DIRECTION_MESH = "mesh";
/** Sentinel shown when the angle is set but is not one of the compass presets. */
export const NOISE_GRADIENT_DIRECTION_CUSTOM = "custom";
/** The eight compass-direction angles offered as Linear field presets. */
export const NOISE_GRADIENT_DIRECTION_PRESETS = [
	0, 45, 90, 135, 180, 225, 270, 315,
] as const;

const titleFromBlendModeToken = (value: TextureMaterialBlendMode): string =>
	value === "dissolve"
		? "Dissolve"
		: value
				.split("-")
				.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
				.join(" ");

/** Blend-mode select options for the Blend dropdown, in {@link TEXTURE_MATERIAL_BLEND_MODES} order. */
export const NOISE_GRADIENT_BLEND_MODE_OPTIONS: readonly {
	readonly value: TextureMaterialBlendMode;
	readonly label: string;
}[] = TEXTURE_MATERIAL_BLEND_MODES.map((value) => ({
	value,
	label: titleFromBlendModeToken(value),
}));

/**
 * Sets the dissolve field across the selection: a numeric `angle` writes a
 * linear field, `null` selects the circular/contour field, and `"mesh"` selects
 * the scalar density mesh. Same undoable node-recipe bus as the other look edits.
 */
export function commitNoiseGradientDirection(
	nodeIds: readonly string[],
	angle: number | null | typeof NOISE_GRADIENT_DIRECTION_MESH,
): boolean {
	const document = useSceneStore.getState().document;
	const commands = uniqueNodeIds(nodeIds).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node) return [];
		const current = recipeForNode(node);
		const nextLinearField =
			typeof angle === "number"
				? textureParticleLinearFieldWithAngle(
						effectiveLinearFieldForTexture(current.texture),
						angle,
					)
				: null;
		const next = normalizeVisualRecipe({
			...current,
			texture: {
				...current.texture,
				material: {
					...current.texture.material,
					fieldMode:
						angle === null
							? "contour"
							: angle === NOISE_GRADIENT_DIRECTION_MESH
								? "mesh"
								: "linear",
					...(nextLinearField
						? {
								angle: textureParticleLinearFieldAngle(nextLinearField),
								strength: textureParticleLinearFieldExtent(nextLinearField),
								linearField: nextLinearField,
							}
						: {}),
					...(angle === NOISE_GRADIENT_DIRECTION_MESH
						? {
								fieldMesh:
									current.texture.material.fieldMesh ??
									DEFAULT_TEXTURE_PARTICLE_FIELD_MESH,
							}
						: {}),
				},
			},
		});
		return [createUpdateNodeRecipeCommand(nodeId, next)];
	});
	if (commands.length === 0) return false;
	return applyCommandsAsTransaction(
		`recipe:noise-gradient-direction:${uniqueNodeIds(nodeIds).join(",")}`,
		"Noise gradient field",
		commands,
	);
}

/** Current dissolve field (mixed across the selection) — circular or a linear angle. */
export function noiseGradientNodeDirectionForSelection(
	nodes: readonly VectorNode[],
): MixedValue<string> | null {
	return mixedValue(nodes, (node) => {
		const texture = recipeForNode(node).texture;
		const fieldMode = textureParticleFieldMode(texture);
		if (fieldMode === "mesh") return NOISE_GRADIENT_DIRECTION_MESH;
		if (fieldMode !== "linear") {
			return NOISE_GRADIENT_DIRECTION_EDGE;
		}
		const angle = textureParticleLinearFieldAngle(
			effectiveLinearFieldForTexture(texture),
		);
		const rounded = Math.round(angle);
		return NOISE_GRADIENT_DIRECTION_PRESETS.some((preset) => preset === rounded)
			? String(rounded)
			: NOISE_GRADIENT_DIRECTION_CUSTOM;
	});
}

/** Current scoped graph dissolve field (mixed across selected overlays). */
export function noiseGradientFrameGraphDirectionForSelection(
	document: SceneDocument,
	nodeIds: readonly string[],
): MixedValue<string> | null {
	const textures = objectNoiseGradientParticleTexturesForSelection(
		document,
		nodeIds,
	);
	return mixedItemValue(textures, (texture) => {
		const fieldMode = textureParticleFieldMode(texture);
		if (fieldMode === "mesh") return NOISE_GRADIENT_DIRECTION_MESH;
		if (fieldMode !== "linear") {
			return NOISE_GRADIENT_DIRECTION_EDGE;
		}
		const angle = textureParticleLinearFieldAngle(
			effectiveLinearFieldForTexture(texture),
		);
		const rounded = Math.round(angle);
		return NOISE_GRADIENT_DIRECTION_PRESETS.some((preset) => preset === rounded)
			? String(rounded)
			: NOISE_GRADIENT_DIRECTION_CUSTOM;
	});
}

/**
 * The dissolve angle in degrees (mixed across the selection) for the free-angle
 * field. The Inspector consumes this only when the selected field is Linear;
 * Circular and Mesh preserve the dormant angle for a later Linear switch.
 */
export function noiseGradientNodeAngleForSelection(
	nodes: readonly VectorNode[],
): MixedValue<number> | null {
	if (nodes.length === 0) return null;
	return mixedValue(nodes, (node) =>
		Math.round(
			textureParticleLinearFieldAngle(
				effectiveLinearFieldForTexture(recipeForNode(node).texture),
			),
		),
	);
}

/** Current scoped graph dissolve angle in degrees (mixed across selected overlays). */
export function noiseGradientFrameGraphAngleForSelection(
	document: SceneDocument,
	nodeIds: readonly string[],
): MixedValue<number> | null {
	const textures = objectNoiseGradientParticleTexturesForSelection(
		document,
		nodeIds,
	);
	return mixedItemValue(textures, (texture) =>
		Math.round(
			textureParticleLinearFieldAngle(effectiveLinearFieldForTexture(texture)),
		),
	);
}

/** Current scoped graph Linear endpoint coordinates (mixed across selected overlays). */
export function noiseGradientFrameGraphLinearFieldValuesForSelection(
	document: SceneDocument,
	nodeIds: readonly string[],
): NoiseGradientLinearFieldValues {
	const textures = objectNoiseGradientParticleTexturesForSelection(
		document,
		nodeIds,
	);
	return {
		x1: mixedItemValue(
			textures,
			(texture) => effectiveLinearFieldForTexture(texture).x1,
		),
		y1: mixedItemValue(
			textures,
			(texture) => effectiveLinearFieldForTexture(texture).y1,
		),
		x2: mixedItemValue(
			textures,
			(texture) => effectiveLinearFieldForTexture(texture).x2,
		),
		y2: mixedItemValue(
			textures,
			(texture) => effectiveLinearFieldForTexture(texture).y2,
		),
	};
}

/** Current object Linear endpoint coordinates (mixed across the selection). */
export function noiseGradientNodeLinearFieldValuesForSelection(
	nodes: readonly VectorNode[],
): NoiseGradientLinearFieldValues {
	return {
		x1: mixedValue(
			nodes,
			(node) => effectiveLinearFieldForTexture(recipeForNode(node).texture).x1,
		),
		y1: mixedValue(
			nodes,
			(node) => effectiveLinearFieldForTexture(recipeForNode(node).texture).y1,
		),
		x2: mixedValue(
			nodes,
			(node) => effectiveLinearFieldForTexture(recipeForNode(node).texture).x2,
		),
		y2: mixedValue(
			nodes,
			(node) => effectiveLinearFieldForTexture(recipeForNode(node).texture).y2,
		),
	};
}

/** Commits the scoped graph Noise Gradient field across selected overlays. */
export function commitNoiseGradientFrameGraphDirection(
	nodeIds: readonly string[],
	angle: number | null | typeof NOISE_GRADIENT_DIRECTION_MESH,
): boolean {
	return commitNoiseGradientFrameGraphTextureEdit(
		nodeIds,
		"direction",
		"Noise gradient frame field",
		(texture) => textureWithNoiseGradientDirection(texture, angle),
	);
}

/** Current scoped graph Blend mode (mixed across selected overlays); see {@link effectiveTextureBlendMode}. */
export function noiseGradientFrameGraphBlendModeForSelection(
	document: SceneDocument,
	nodeIds: readonly string[],
): MixedValue<TextureMaterialBlendMode> | null {
	const textures = objectNoiseGradientParticleTexturesForSelection(
		document,
		nodeIds,
	);
	return mixedItemValue(textures, (texture) =>
		effectiveTextureBlendMode(texture.material),
	);
}

/** Commits the scoped graph Noise Gradient Blend mode across selected overlays. */
export function commitNoiseGradientFrameGraphBlendMode(
	nodeIds: readonly string[],
	blendMode: TextureMaterialBlendMode,
): boolean {
	return commitNoiseGradientFrameGraphTextureEdit(
		nodeIds,
		`blend-mode:${blendMode}`,
		"Noise gradient frame blend",
		(texture) => textureWithNoiseGradientBlendMode(texture, blendMode),
	);
}

/** Current object Blend mode (mixed across the selection); see {@link effectiveTextureBlendMode}. */
export function noiseGradientNodeBlendModeForSelection(
	nodes: readonly VectorNode[],
): MixedValue<TextureMaterialBlendMode> | null {
	return mixedValue(nodes, (node) =>
		effectiveTextureBlendMode(recipeForNode(node).texture.material),
	);
}

/** Commits the object Noise Gradient Blend mode across the selection. */
export function commitNoiseGradientBlendMode(
	nodeIds: readonly string[],
	blendMode: TextureMaterialBlendMode,
): boolean {
	const document = useSceneStore.getState().document;
	const commands = uniqueNodeIds(nodeIds).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node) return [];
		const current = recipeForNode(node);
		const next = normalizeVisualRecipe({
			...current,
			texture: textureWithNoiseGradientBlendMode(current.texture, blendMode),
		});
		return [createUpdateNodeRecipeCommand(nodeId, next)];
	});
	if (commands.length === 0) return false;
	return applyCommandsAsTransaction(
		`recipe:noise-gradient-blend-mode:${uniqueNodeIds(nodeIds).join(",")}`,
		"Noise gradient blend",
		commands,
	);
}

/** A one-click noise-gradient look: a full tuned config the preset buttons apply. */
export type NoiseGradientPreset = {
	readonly id: string;
	readonly label: string;
	readonly strength: number;
	readonly particleContrast: number;
	readonly temporalStability: number;
	readonly size: number;
	readonly fieldMode?: TextureParticleFieldMode;
	readonly angle?: number;
};

/** Two distinct, tasteful starting looks for the noise-gradient dissolve. */
export const NOISE_GRADIENT_PRESETS: readonly NoiseGradientPreset[] = [
	{
		id: "spray",
		label: "Spray",
		strength: 0.9,
		particleContrast: 0.3,
		temporalStability: 1,
		size: 0.22,
		fieldMode: "contour",
	},
	{
		id: "crisp",
		label: "Crisp",
		strength: 0.35,
		particleContrast: 0.85,
		temporalStability: 1,
		size: 0.3,
		fieldMode: "contour",
	},
];

/** Applies a tuned Noise Gradient preset to selected scoped graph overlays. */
export function commitNoiseGradientFrameGraphPreset(
	nodeIds: readonly string[],
	preset: NoiseGradientPreset,
): boolean {
	return commitNoiseGradientFrameGraphTextureEdit(
		nodeIds,
		`preset:${preset.id}`,
		`Noise gradient frame: ${preset.label}`,
		(texture) => textureWithNoiseGradientPreset(texture, preset),
	);
}

/**
 * Applies a one-click preset to the selection: enables the particle dissolve and
 * sets its whole tuned config (extent/softness/motion/coarseness, and field
 * mode when the preset specifies one), through the same undoable node-recipe bus.
 */
export function commitNoiseGradientPreset(
	nodeIds: readonly string[],
	preset: NoiseGradientPreset,
): boolean {
	const document = useSceneStore.getState().document;
	const commands = uniqueNodeIds(nodeIds).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node) return [];
		const current = recipeForNode(node);
		const next = normalizeVisualRecipe({
			...current,
			texture: {
				...current.texture,
				grain: {
					...current.texture.grain,
					enabled: true,
					temporalStability: preset.temporalStability,
					size: preset.size,
				},
				material: {
					...current.texture.material,
					mode: "particle",
					strength: preset.strength,
					particleContrast: preset.particleContrast,
					fieldMode:
						preset.fieldMode ??
						(typeof preset.angle === "number" ? "linear" : "contour"),
					...(typeof preset.angle === "number" ? { angle: preset.angle } : {}),
					...(typeof preset.angle === "number"
						? {
								linearField: textureParticleLinearFieldFromAngle(
									preset.angle,
									preset.strength,
								),
							}
						: {}),
					...(preset.fieldMode === "mesh"
						? {
								fieldMesh:
									current.texture.material.fieldMesh ??
									DEFAULT_TEXTURE_PARTICLE_FIELD_MESH,
							}
						: {}),
				},
			},
		});
		return [createUpdateNodeRecipeCommand(nodeId, next)];
	});
	if (commands.length === 0) return false;
	return applyCommandsAsTransaction(
		`recipe:noise-gradient-preset:${preset.id}:${uniqueNodeIds(nodeIds).join(",")}`,
		`Noise gradient: ${preset.label}`,
		commands,
	);
}

/** The tool bar's single primary Style axis, gating every family below. */
export type { NoiseGradientStyle };

/** Default film-grain strength when a Style/material-mode switch lands on Mixed. */
const DEFAULT_MIXED_GRAIN_STRENGTH = OBJECT_NOISE_GRADIENT_DEFAULT_MIXED_GRAIN;

/**
 * Derives the single primary Style axis from a texture's material — the same
 * projection as `noiseGradientToolControlState`'s `style` field and
 * {@link commitNoiseGradientToolStyle}'s reference mapping: `"off"` when the
 * material is disabled, `"dissolve"` when the effective blend mode is the
 * legacy particle-erosion blend, and `"overlay"` for every other active blend.
 */
const noiseGradientStyleFromMaterial = (
	material: TextureRecipe["material"],
): NoiseGradientStyle =>
	material.mode === "off"
		? "off"
		: effectiveTextureBlendMode(material) === "dissolve"
			? "dissolve"
			: "overlay";

const NOISE_GRADIENT_STYLE_LABEL: Record<NoiseGradientStyle, string> = {
	off: "Disable Noise Gradient",
	overlay: "Set Noise Gradient overlay",
	dissolve: "Set Noise Gradient dissolve",
};

/**
 * Commits the single primary Style axis (Off / Overlay / Dissolve) across
 * selected object Noise Gradients, through the same undoable node-recipe bus
 * as every other look edit. See {@link textureWithNoiseGradientStyle} for the
 * exact field mapping, mirrored from the tool bar's
 * {@link commitNoiseGradientToolStyle}.
 */
export function commitNoiseGradientStyle(
	nodeIds: readonly string[],
	style: NoiseGradientStyle,
): boolean {
	const document = useSceneStore.getState().document;
	const commands = uniqueNodeIds(nodeIds).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node) return [];
		const current = recipeForNode(node);
		const next = normalizeVisualRecipe({
			...current,
			texture: textureWithNoiseGradientStyle(current.texture, style),
		});
		return [createUpdateNodeRecipeCommand(nodeId, next)];
	});
	if (commands.length === 0) return false;
	return applyCommandsAsTransaction(
		`recipe:noise-gradient-style:${uniqueNodeIds(nodeIds).join(",")}`,
		NOISE_GRADIENT_STYLE_LABEL[style],
		commands,
	);
}

/**
 * Commits the single primary Style axis across selected scoped graph Noise
 * Gradient overlays. `"off"` delegates to
 * {@link commitRemoveNoiseGradientFrameGraph} — matching the current disable
 * behavior for scoped owners (removing the selected targets from the overlay
 * rather than writing a disabled texture into a graph node) — while
 * `"overlay"`/`"dissolve"` go through the shared texture-edit helper like
 * every other scoped Noise Gradient field commit.
 */
export function commitNoiseGradientFrameGraphStyle(
	nodeIds: readonly string[],
	style: NoiseGradientStyle,
): boolean {
	if (style === "off") return commitRemoveNoiseGradientFrameGraph(nodeIds);
	return commitNoiseGradientFrameGraphTextureEdit(
		nodeIds,
		`style:${style}`,
		NOISE_GRADIENT_STYLE_LABEL[style],
		(texture) => textureWithNoiseGradientStyle(texture, style),
	);
}

/** Current Style axis (mixed across the selection) for selected object Noise Gradients. */
export function noiseGradientNodeStyleForSelection(
	nodes: readonly VectorNode[],
): MixedValue<NoiseGradientStyle> | null {
	return mixedValue(nodes, (node) =>
		noiseGradientStyleFromMaterial(recipeForNode(node).texture.material),
	);
}

/** Current Style axis (mixed across selected overlays) for selected scoped graph Noise Gradients. */
export function noiseGradientFrameGraphStyleForSelection(
	document: SceneDocument,
	nodeIds: readonly string[],
): MixedValue<NoiseGradientStyle> | null {
	const textures = objectNoiseGradientParticleTexturesForSelection(
		document,
		nodeIds,
	);
	return mixedItemValue(textures, (texture) =>
		noiseGradientStyleFromMaterial(texture.material),
	);
}

/**
 * Writes (or clears) the noise-over-fill overlay grain tint
 * (`material.overlayColor`). Mirrors the tool bar's
 * {@link commitNoiseGradientToolOverlayColor}: `value: null` writes
 * `overlayColor: undefined`, which normalization omits, reverting the grain to
 * monochrome. Deliberately does NOT force `material.mode` — grain color is a
 * cosmetic tint orthogonal to the off/particle/mixed axis, so writing it must
 * not silently change the selection's Style.
 */
const textureWithNoiseGradientOverlayColor = (
	texture: TextureRecipe,
	value: string | null,
): TextureRecipe =>
	normalizeVisualRecipe({
		texture: {
			...texture,
			material: {
				...texture.material,
				overlayColor: value ?? undefined,
			},
		},
	}).texture;

/** Commits the noise-over-fill overlay grain tint across selected object Noise Gradients. */
export function commitNoiseGradientOverlayColor(
	nodeIds: readonly string[],
	value: string | null,
): boolean {
	const document = useSceneStore.getState().document;
	const commands = uniqueNodeIds(nodeIds).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node) return [];
		const current = recipeForNode(node);
		const next = normalizeVisualRecipe({
			...current,
			texture: textureWithNoiseGradientOverlayColor(current.texture, value),
		});
		return [createUpdateNodeRecipeCommand(nodeId, next)];
	});
	if (commands.length === 0) return false;
	return applyCommandsAsTransaction(
		`recipe:noise-gradient-overlay-color:${uniqueNodeIds(nodeIds).join(",")}`,
		"Edit Noise Gradient grain color",
		commands,
	);
}

/** Commits the noise-over-fill overlay grain tint across selected scoped graph overlays. */
export function commitNoiseGradientFrameGraphOverlayColor(
	nodeIds: readonly string[],
	value: string | null,
): boolean {
	return commitNoiseGradientFrameGraphTextureEdit(
		nodeIds,
		"overlay-color",
		"Edit Noise Gradient grain color",
		(texture) => textureWithNoiseGradientOverlayColor(texture, value),
	);
}

/** Current overlay grain tint (mixed across the selection) for selected object Noise Gradients. */
export function noiseGradientNodeOverlayColorForSelection(
	nodes: readonly VectorNode[],
): MixedValue<string | null> | null {
	return mixedValue(
		nodes,
		(node) => recipeForNode(node).texture.material.overlayColor ?? null,
	);
}

/** Current overlay grain tint (mixed across selected overlays) for selected scoped graph Noise Gradients. */
export function noiseGradientFrameGraphOverlayColorForSelection(
	document: SceneDocument,
	nodeIds: readonly string[],
): MixedValue<string | null> | null {
	const textures = objectNoiseGradientParticleTexturesForSelection(
		document,
		nodeIds,
	);
	return mixedItemValue(
		textures,
		(texture) => texture.material.overlayColor ?? null,
	);
}

/**
 * Switches the Noise Gradient's film-grain sub-state between the plain
 * particle field (`"particle"`) and the mixed composite with film grain
 * layered on top (`"mixed"`) — mirrors the tool bar's
 * {@link commitNoiseGradientToolMaterialMode}, restricted to this pair (no
 * `"off"` case here; Style §1 owns disabling the material outright). Switching
 * to `"mixed"` enables grain, preserving a nonzero authored strength or
 * falling back to {@link DEFAULT_MIXED_GRAIN_STRENGTH}; switching to
 * `"particle"` disables grain so a stale enabled grain can't keep rendering on
 * top of a mode that no longer intends it.
 */
const textureWithNoiseGradientMaterialMode = (
	texture: TextureRecipe,
	mode: "particle" | "mixed",
): TextureRecipe =>
	normalizeVisualRecipe({
		texture: {
			...texture,
			material: {
				...texture.material,
				mode,
				blendMode: texture.material.blendMode ?? "hard-light",
			},
			grain:
				mode === "mixed"
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

const NOISE_GRADIENT_MATERIAL_MODE_LABEL: Record<"particle" | "mixed", string> =
	{
		particle: "Enable Noise Gradient particle",
		mixed: "Enable Noise Gradient mixed",
	};

/** Commits the particle/mixed film-grain sub-state across selected object Noise Gradients. */
export function commitNoiseGradientMaterialMode(
	nodeIds: readonly string[],
	mode: "particle" | "mixed",
): boolean {
	const document = useSceneStore.getState().document;
	const commands = uniqueNodeIds(nodeIds).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node) return [];
		const current = recipeForNode(node);
		const next = normalizeVisualRecipe({
			...current,
			texture: textureWithNoiseGradientMaterialMode(current.texture, mode),
		});
		return [createUpdateNodeRecipeCommand(nodeId, next)];
	});
	if (commands.length === 0) return false;
	return applyCommandsAsTransaction(
		`recipe:noise-gradient-material-mode:${uniqueNodeIds(nodeIds).join(",")}`,
		NOISE_GRADIENT_MATERIAL_MODE_LABEL[mode],
		commands,
	);
}

/** Commits the particle/mixed film-grain sub-state across selected scoped graph overlays. */
export function commitNoiseGradientFrameGraphMaterialMode(
	nodeIds: readonly string[],
	mode: "particle" | "mixed",
): boolean {
	return commitNoiseGradientFrameGraphTextureEdit(
		nodeIds,
		`material-mode:${mode}`,
		NOISE_GRADIENT_MATERIAL_MODE_LABEL[mode],
		(texture) => textureWithNoiseGradientMaterialMode(texture, mode),
	);
}

/** Whether the film-grain sub-state is Mixed (mixed across the selection) for selected object Noise Gradients. */
export function noiseGradientNodeMaterialModeIsMixedForSelection(
	nodes: readonly VectorNode[],
): MixedValue<boolean> | null {
	return mixedValue(
		nodes,
		(node) => recipeForNode(node).texture.material.mode === "mixed",
	);
}

/** Whether the film-grain sub-state is Mixed (mixed across selected overlays) for selected scoped graph Noise Gradients. */
export function noiseGradientFrameGraphMaterialModeIsMixedForSelection(
	document: SceneDocument,
	nodeIds: readonly string[],
): MixedValue<boolean> | null {
	const textures = objectNoiseGradientParticleTexturesForSelection(
		document,
		nodeIds,
	);
	return mixedItemValue(
		textures,
		(texture) => texture.material.mode === "mixed",
	);
}

/**
 * Writes the Mixed-mode film-grain strength (`grain.strength`). Mirrors the
 * tool bar's {@link commitNoiseGradientToolGrainStrength}: orthogonal to
 * `material.mode` (same reasoning as the overlay tint above), so this writes
 * only the grain sub-recipe and does NOT force `material.mode` — the film-grain
 * commit above owns whether grain is enabled at all. A strength of `0` also
 * disables grain so the slider's low end matches "no grain" rather than "grain
 * at zero strength".
 */
const textureWithNoiseGradientGrainStrength = (
	texture: TextureRecipe,
	strength: number,
): TextureRecipe =>
	normalizeVisualRecipe({
		texture: {
			...texture,
			grain: {
				...texture.grain,
				strength: clampUnit(strength),
				enabled: strength > 0,
			},
		},
	}).texture;

/** Commits Mixed-mode film-grain strength across selected object Noise Gradients. */
export function commitNoiseGradientGrainStrength(
	nodeIds: readonly string[],
	value: number,
): boolean {
	if (!Number.isFinite(value)) return false;
	const clamped = clampUnit(value);
	const document = useSceneStore.getState().document;
	const commands = uniqueNodeIds(nodeIds).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node) return [];
		const current = recipeForNode(node);
		const next = normalizeVisualRecipe({
			...current,
			texture: textureWithNoiseGradientGrainStrength(current.texture, clamped),
		});
		return [createUpdateNodeRecipeCommand(nodeId, next)];
	});
	if (commands.length === 0) return false;
	return applyCommandsAsTransaction(
		`recipe:noise-gradient-grain-strength:${uniqueNodeIds(nodeIds).join(",")}`,
		"Edit Noise Gradient grain strength",
		commands,
	);
}

/** Commits Mixed-mode film-grain strength across selected scoped graph overlays. */
export function commitNoiseGradientFrameGraphGrainStrength(
	nodeIds: readonly string[],
	value: number,
): boolean {
	if (!Number.isFinite(value)) return false;
	const clamped = clampUnit(value);
	return commitNoiseGradientFrameGraphTextureEdit(
		nodeIds,
		"grain-strength",
		"Edit Noise Gradient grain strength",
		(texture) => textureWithNoiseGradientGrainStrength(texture, clamped),
	);
}

/** Current Mixed-mode film-grain strength (mixed across the selection) for selected object Noise Gradients. */
export function noiseGradientNodeGrainStrengthForSelection(
	nodes: readonly VectorNode[],
): MixedValue<number> | null {
	return mixedValue(nodes, (node) =>
		clampUnit(recipeForNode(node).texture.grain.strength),
	);
}

/** Current Mixed-mode film-grain strength (mixed across selected overlays) for selected scoped graph Noise Gradients. */
export function noiseGradientFrameGraphGrainStrengthForSelection(
	document: SceneDocument,
	nodeIds: readonly string[],
): MixedValue<number> | null {
	const textures = objectNoiseGradientParticleTexturesForSelection(
		document,
		nodeIds,
	);
	return mixedItemValue(textures, (texture) =>
		clampUnit(texture.grain.strength),
	);
}

/**
 * Writes the dissolve coverage/density bias (`grain.densityCoupling`), read
 * unconditionally as `bias` by
 * {@link import("@/entities/scene/model/effect-filter").particleDissolvePrimitives}.
 * Mirrors the tool bar's {@link commitNoiseGradientToolAmount}.
 */
const textureWithNoiseGradientCoverage = (
	texture: TextureRecipe,
	value: number,
): TextureRecipe =>
	normalizeVisualRecipe({
		texture: {
			...texture,
			grain: { ...texture.grain, densityCoupling: clampUnit(value) },
		},
	}).texture;

/** Commits dissolve coverage/density bias across selected object Noise Gradients. */
export function commitNoiseGradientCoverage(
	nodeIds: readonly string[],
	value: number,
): boolean {
	if (!Number.isFinite(value)) return false;
	const clamped = clampUnit(value);
	const document = useSceneStore.getState().document;
	const commands = uniqueNodeIds(nodeIds).flatMap((nodeId) => {
		const node = findNode(document, nodeId);
		if (!node) return [];
		const current = recipeForNode(node);
		const next = normalizeVisualRecipe({
			...current,
			texture: textureWithNoiseGradientCoverage(current.texture, clamped),
		});
		return [createUpdateNodeRecipeCommand(nodeId, next)];
	});
	if (commands.length === 0) return false;
	return applyCommandsAsTransaction(
		`recipe:noise-gradient-coverage:${uniqueNodeIds(nodeIds).join(",")}`,
		"Edit Noise Gradient amount",
		commands,
	);
}

/** Commits dissolve coverage/density bias across selected scoped graph overlays. */
export function commitNoiseGradientFrameGraphCoverage(
	nodeIds: readonly string[],
	value: number,
): boolean {
	if (!Number.isFinite(value)) return false;
	const clamped = clampUnit(value);
	return commitNoiseGradientFrameGraphTextureEdit(
		nodeIds,
		"coverage",
		"Edit Noise Gradient amount",
		(texture) => textureWithNoiseGradientCoverage(texture, clamped),
	);
}

/** Current dissolve coverage/density bias (mixed across the selection) for selected object Noise Gradients. */
export function noiseGradientNodeCoverageForSelection(
	nodes: readonly VectorNode[],
): MixedValue<number> | null {
	return mixedValue(nodes, (node) =>
		clampUnit(recipeForNode(node).texture.grain.densityCoupling),
	);
}

/** Current dissolve coverage/density bias (mixed across selected overlays) for selected scoped graph Noise Gradients. */
export function noiseGradientFrameGraphCoverageForSelection(
	document: SceneDocument,
	nodeIds: readonly string[],
): MixedValue<number> | null {
	const textures = objectNoiseGradientParticleTexturesForSelection(
		document,
		nodeIds,
	);
	return mixedItemValue(textures, (texture) =>
		clampUnit(texture.grain.densityCoupling),
	);
}
