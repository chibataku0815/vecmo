import type { LookGraph } from "@/entities/scene/model/look-graph";
import {
	createConvertNodeNoiseGradientToScopedLookGraphCommand,
	createUpdateEffectIntentCommand,
	createUpdateNodeRecipeCommand,
} from "@/entities/scene/model/node-commands";
import {
	graphWithObjectNoiseGradientTexture,
	OBJECT_NOISE_GRADIENT_DEFAULT_MIXED_GRAIN,
	objectNoiseGradientGrainNode,
	objectNoiseGradientScopedLookForNode,
	objectNoiseGradientTextureFromRecipe,
	scopedLookGraphOverlayForNode,
	textureMaterialIsParticle,
} from "@/entities/scene/model/noise-gradient-look";
import { textureWithNoiseGradientStyle } from "@/entities/scene/model/noise-gradient-texture-edits";
import {
	findArtboardById,
	findNode,
	selectArtboardIdForNode,
} from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	LookGraphScopedEffectLook,
	RevealPaint,
	SceneDocument,
	VectorNode,
} from "@/entities/scene/model/types";
import {
	DEFAULT_TEXTURE_PARTICLE_FIELD_MESH,
	effectiveTextureBlendMode,
	insertTextureParticleFieldMeshColumn,
	insertTextureParticleFieldMeshRow,
	moveTextureParticleFieldMeshPoint,
	normalizeVisualRecipe,
	removeTextureParticleFieldMeshPointLines,
	resolveTextureParticleLinearField,
	setTextureParticleFieldMeshPointDensity,
	type TextureMaterialBlendMode,
	type TextureMaterialMode,
	type TextureParticleFieldMode,
	type TextureParticleLinearField,
	type TextureRecipe,
	textureParticleFieldMode,
	textureParticleLinearFieldAngle,
	textureParticleLinearFieldEffective,
	textureParticleLinearFieldExtent,
	textureParticleLinearFieldFromAngle,
	textureParticleLinearFieldWithAngle,
	type VisualRecipe,
} from "@/shared/vec-core";

const FULL_TURN_DEGREES = 360;

/** Default film-grain strength when switching to Mixed. */
const DEFAULT_MIXED_GRAIN_STRENGTH = OBJECT_NOISE_GRADIENT_DEFAULT_MIXED_GRAIN;

export type NoiseGradientToolControlState = {
	readonly nodeId: string;
	readonly amount: number;
	readonly angle: number;
	readonly blendMode: TextureMaterialBlendMode;
	readonly editable: boolean;
	readonly extent: number;
	readonly fieldMode: TextureParticleFieldMode;
	readonly fixedAngle: boolean;
	readonly grainStrength: number;
	readonly isDissolve: boolean;
	readonly isScopedGraph: boolean;
	readonly materialMode: TextureMaterialMode;
	readonly openGraphLabel: "Open Graph" | "Open Existing Graph";
	readonly openGraphTitle: string;
	readonly overlayColor: string | null;
	readonly revealPaint: RevealPaint | null;
	readonly softness: number;
	readonly source: "object" | "scoped-object" | "external-scoped-graph";
	readonly style: "off" | "overlay" | "dissolve";
	readonly texture: TextureRecipe;
};

export type NoiseGradientScopedLookGraphTarget = {
	readonly artboardId: string;
	readonly scopedLookId: string;
};

type NoiseGradientToolOwner =
	| {
			readonly source: "object";
			readonly nodeId: string;
			readonly node: VectorNode;
			readonly recipe: VisualRecipe;
			readonly texture: TextureRecipe;
	  }
	| {
			readonly source: "scoped-object";
			readonly nodeId: string;
			readonly node: VectorNode;
			readonly artboardId: string;
			readonly look: LookGraphScopedEffectLook;
			readonly texture: TextureRecipe;
	  }
	| {
			readonly source: "external-scoped-graph";
			readonly nodeId: string;
			readonly node: VectorNode;
			readonly texture: TextureRecipe;
	  };

const normalizeAngle = (angle: number): number =>
	((angle % FULL_TURN_DEGREES) + FULL_TURN_DEGREES) % FULL_TURN_DEGREES;

const clampUnit = (value: number): number => Math.min(1, Math.max(0, value));

const linearFieldWithAngle = (
	texture: TextureRecipe,
	angle: number,
): TextureParticleLinearField =>
	textureParticleLinearFieldWithAngle(
		textureParticleLinearFieldEffective(
			resolveTextureParticleLinearField(texture),
		),
		normalizeAngle(angle),
	);

const linearFieldWithExtent = (
	texture: TextureRecipe,
	extent: number,
): TextureParticleLinearField => ({
	...textureParticleLinearFieldEffective(
		resolveTextureParticleLinearField(texture),
	),
	plateau: clampUnit(1 - extent),
});

const textureWithLinearField = (
	texture: TextureRecipe,
	linearField: TextureParticleLinearField,
): TextureRecipe => {
	const effectiveLinearField = textureParticleLinearFieldEffective(linearField);
	return {
		...texture,
		material: {
			...texture.material,
			mode: "particle",
			blendMode: texture.material.blendMode ?? "hard-light",
			fieldMode: "linear",
			angle: textureParticleLinearFieldAngle(effectiveLinearField),
			strength: textureParticleLinearFieldExtent(effectiveLinearField),
			linearField: effectiveLinearField,
		},
	};
};

const linearFieldLengthSq = (
	linearField: TextureParticleLinearField,
): number => {
	const dx = linearField.x2 - linearField.x1;
	const dy = linearField.y2 - linearField.y1;
	return dx * dx + dy * dy;
};

const sameSerializable = (left: unknown, right: unknown): boolean =>
	JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

const applyRecipe = (
	nodeId: string,
	current: VisualRecipe,
	next: VisualRecipe,
	label: string,
): boolean => {
	if (sameSerializable(current, next)) return false;
	useSceneStore.getState().apply({
		...createUpdateNodeRecipeCommand(nodeId, next),
		label,
	});
	return true;
};

/**
 * Applies a rebuilt Look Graph to the scoped-look owner backing one object's
 * Noise Gradient, replacing that overlay in the artboard's `scopedLooks` list.
 * Shared by every writer of a scoped Object Noise Gradient's `lookGraph` —
 * texture edits ({@link applyScopedTexture}) and the reveal-paint commit both
 * fan through here so the artboard/scopedLooks plumbing and no-op guard live
 * in exactly one place.
 */
const applyScopedLookGraph = (
	owner: Extract<NoiseGradientToolOwner, { readonly source: "scoped-object" }>,
	nextGraph: LookGraph,
	label: string,
): boolean => {
	const nextLook = { ...owner.look, lookGraph: nextGraph };
	if (sameSerializable(owner.look, nextLook)) return false;
	const document = useSceneStore.getState().document;
	const artboard = findArtboardById(document, owner.artboardId);
	if (!artboard) return false;
	const scopedLooks = artboard.effectIntent?.scopedLooks;
	if (!scopedLooks?.some((look) => look.id === owner.look.id)) return false;
	useSceneStore.getState().apply({
		...createUpdateEffectIntentCommand(
			{ scope: "artboard", artboardId: owner.artboardId },
			{
				scopedLooks: scopedLooks.map((look) =>
					look.id === owner.look.id ? nextLook : look,
				),
			},
		),
		label,
	});
	return true;
};

const applyScopedTexture = (
	owner: Extract<NoiseGradientToolOwner, { readonly source: "scoped-object" }>,
	nextTexture: TextureRecipe,
	label: string,
): boolean => {
	const nextGraph = graphWithObjectNoiseGradientTexture(
		owner.look,
		nextTexture,
	);
	if (!nextGraph) return false;
	return applyScopedLookGraph(owner, nextGraph, label);
};

const writeTexture = (
	texture: TextureRecipe,
	write: (texture: TextureRecipe) => TextureRecipe,
): TextureRecipe =>
	normalizeVisualRecipe({
		texture: write(texture),
	}).texture;

const resolveNoiseGradientToolOwner = (
	document: SceneDocument,
	nodeId: string | null | undefined,
): NoiseGradientToolOwner | null => {
	const node = findNode(document, nodeId ?? null);
	if (!node || node.locked) return null;
	const artboardId = selectArtboardIdForNode(document, node.id);
	if (!artboardId) return null;
	const artboard = findArtboardById(document, artboardId);
	if (!artboard) return null;
	const scopedLook = objectNoiseGradientScopedLookForNode(artboard, node.id);
	if (scopedLook) {
		const particleNode = objectNoiseGradientGrainNode(scopedLook);
		if (particleNode?.payload.kind !== "grain") return null;
		return {
			source: "scoped-object",
			nodeId: node.id,
			node,
			artboardId,
			look: scopedLook,
			texture: particleNode.payload.texture,
		};
	}
	const existingScopedGraph = scopedLookGraphOverlayForNode(
		artboard.effectIntent?.scopedLooks,
		node.id,
	);
	if (existingScopedGraph) {
		const particleNode = objectNoiseGradientGrainNode(existingScopedGraph);
		const singleTarget =
			existingScopedGraph.targetNodeIds.length === 1 &&
			existingScopedGraph.targetNodeIds[0] === node.id;
		if (singleTarget && particleNode?.payload.kind === "grain") {
			return {
				source: "scoped-object",
				nodeId: node.id,
				node,
				artboardId,
				look: existingScopedGraph,
				texture: particleNode.payload.texture,
			};
		}
		const recipe = normalizeVisualRecipe(node.recipe);
		return {
			source: "external-scoped-graph",
			nodeId: node.id,
			node,
			texture: textureMaterialIsParticle(recipe.texture)
				? recipe.texture
				: objectNoiseGradientTextureFromRecipe(recipe),
		};
	}
	const recipe = normalizeVisualRecipe(node.recipe);
	return {
		source: "object",
		nodeId: node.id,
		node,
		recipe,
		texture: textureMaterialIsParticle(recipe.texture)
			? recipe.texture
			: objectNoiseGradientTextureFromRecipe(recipe),
	};
};

/** Resolves the scoped graph overlay target currently backing one object's Noise Gradient. */
export function noiseGradientScopedLookGraphTargetForNode(
	document: SceneDocument,
	nodeId: string,
): NoiseGradientScopedLookGraphTarget | null {
	const artboardId = selectArtboardIdForNode(document, nodeId);
	if (!artboardId) return null;
	const artboard = findArtboardById(document, artboardId);
	const scopedLook = artboard
		? objectNoiseGradientScopedLookForNode(artboard, nodeId)
		: null;
	return scopedLook ? { artboardId, scopedLookId: scopedLook.id } : null;
}

/** Resolves an existing scoped Look Graph owner, preferring Object Noise Gradient. */
export function noiseGradientExistingLookGraphTargetForNode(
	document: SceneDocument,
	nodeId: string,
): NoiseGradientScopedLookGraphTarget | null {
	const artboardId = selectArtboardIdForNode(document, nodeId);
	if (!artboardId) return null;
	const artboard = findArtboardById(document, artboardId);
	const objectScopedLook = artboard
		? objectNoiseGradientScopedLookForNode(artboard, nodeId)
		: null;
	const scopedLook =
		objectScopedLook ??
		scopedLookGraphOverlayForNode(artboard?.effectIntent?.scopedLooks, nodeId);
	return scopedLook ? { artboardId, scopedLookId: scopedLook.id } : null;
}

/**
 * Resolves the workspace target for the Noise Gradient Tool's Open Graph action.
 * Object Noise Gradient owners win, generic scoped graph owners are opened as a
 * fallback, and only ownerless object-material Noise Gradients are converted.
 */
export function resolveNoiseGradientOpenGraphTarget(
	nodeId: string,
): NoiseGradientScopedLookGraphTarget | null {
	const current = useSceneStore.getState().document;
	const existing = noiseGradientExistingLookGraphTargetForNode(current, nodeId);
	if (existing) return existing;
	useSceneStore.getState().apply(
		createConvertNodeNoiseGradientToScopedLookGraphCommand(nodeId, {
			label: "Convert Noise Gradient to graph",
			coalesceKey: `noise-gradient-open-graph:${nodeId}`,
		}),
	);
	return noiseGradientScopedLookGraphTargetForNode(
		useSceneStore.getState().document,
		nodeId,
	);
}

const openGraphPresentation = (
	document: SceneDocument,
	nodeId: string,
): Pick<NoiseGradientToolControlState, "openGraphLabel" | "openGraphTitle"> => {
	const artboardId = selectArtboardIdForNode(document, nodeId);
	const artboard = artboardId ? findArtboardById(document, artboardId) : null;
	const existing = scopedLookGraphOverlayForNode(
		artboard?.effectIntent?.scopedLooks,
		nodeId,
	);
	const objectScopedLook = objectNoiseGradientScopedLookForNode(
		artboard ?? undefined,
		nodeId,
	);
	if (existing && !objectScopedLook) {
		return {
			openGraphLabel: "Open Existing Graph",
			openGraphTitle:
				"Open the scoped Look Graph already targeting this object",
		};
	}
	return {
		openGraphLabel: "Open Graph",
		openGraphTitle: "Open this object Noise Gradient as a Look Graph",
	};
};

const applyOwnerTexture = (
	owner: NoiseGradientToolOwner,
	nextTexture: TextureRecipe,
	label: string,
): boolean => {
	if (owner.source === "scoped-object") {
		return applyScopedTexture(owner, nextTexture, label);
	}
	if (owner.source === "external-scoped-graph") return false;
	return applyRecipe(
		owner.nodeId,
		owner.recipe,
		normalizeVisualRecipe({
			...owner.recipe,
			texture: nextTexture,
		}),
		label,
	);
};

/**
 * Reads the primary selected object's Noise Gradient owner for compact tool
 * chrome. Existing graph-backed scoped overlays stay the owner; otherwise the
 * tool previews and writes the object material directly.
 */
export function noiseGradientToolControlState(
	document: SceneDocument,
	selection: {
		readonly nodeIds: readonly string[];
		readonly primary: string | null;
	},
): NoiseGradientToolControlState | null {
	const nodeId = selection.primary ?? selection.nodeIds[0];
	if (!nodeId) return null;
	const owner = resolveNoiseGradientToolOwner(document, nodeId);
	if (!owner) return null;
	const texture = owner.texture;
	const fieldMode = textureParticleFieldMode(texture);
	const linearField =
		fieldMode === "linear"
			? textureParticleLinearFieldEffective(
					resolveTextureParticleLinearField(texture),
				)
			: null;
	const openGraph = openGraphPresentation(document, owner.nodeId);
	const editable = owner.source !== "external-scoped-graph";
	const blendMode = effectiveTextureBlendMode(texture.material);
	// `owner.texture` is synthesized (always "particle") for a plain object owner
	// whose recipe isn't already a particle material, so the true authored mode
	// (incl. "off") must come from the recipe/look payload the owner actually
	// carries, not from the synthesized preview texture.
	const materialMode =
		owner.source === "object"
			? owner.recipe.texture.material.mode
			: owner.texture.material.mode;
	const revealPaint =
		owner.source === "scoped-object"
			? (() => {
					const particleNode = objectNoiseGradientGrainNode(owner.look);
					return particleNode?.payload.kind === "grain"
						? (particleNode.payload.revealPaint ?? null)
						: null;
				})()
			: null;
	const style: "off" | "overlay" | "dissolve" =
		materialMode === "off"
			? "off"
			: blendMode === "dissolve"
				? "dissolve"
				: "overlay";
	return {
		nodeId: owner.nodeId,
		amount: clampUnit(texture.grain.densityCoupling),
		angle:
			Math.round(
				normalizeAngle(
					linearField
						? textureParticleLinearFieldAngle(linearField)
						: (texture.material.angle ?? 0),
				),
			) % FULL_TURN_DEGREES,
		blendMode,
		editable,
		extent: clampUnit(
			linearField
				? textureParticleLinearFieldExtent(linearField)
				: texture.material.strength,
		),
		fieldMode,
		fixedAngle: fieldMode === "linear",
		grainStrength: clampUnit(texture.grain.strength),
		isDissolve: blendMode === "dissolve",
		isScopedGraph: owner.source === "scoped-object",
		materialMode,
		openGraphLabel: openGraph.openGraphLabel,
		openGraphTitle: openGraph.openGraphTitle,
		overlayColor: texture.material.overlayColor ?? null,
		revealPaint,
		softness: clampUnit(1 - texture.material.particleContrast),
		source: owner.source,
		style,
		texture,
	};
}

/** Writes a Linear Noise Gradient angle to the resolved tool owner. */
export function commitNoiseGradientToolAngle(
	nodeId: string,
	angle: number,
): boolean {
	return commitNoiseGradientToolDirection(nodeId, angle);
}

/** Writes one target-space Linear field endpoint to the resolved tool owner. */
export function commitNoiseGradientToolLinearFieldEndpoint(
	nodeId: string,
	endpoint: "from" | "to",
	point: { readonly x: number; readonly y: number },
): boolean {
	if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
	const owner = resolveNoiseGradientToolOwner(
		useSceneStore.getState().document,
		nodeId,
	);
	if (!owner) return false;
	const nextTexture = writeTexture(owner.texture, (texture) => {
		const current = textureParticleLinearFieldEffective(
			resolveTextureParticleLinearField(texture),
		);
		const nextLinearField =
			endpoint === "from"
				? { ...current, x1: point.x, y1: point.y }
				: { ...current, x2: point.x, y2: point.y };
		if (linearFieldLengthSq(nextLinearField) <= 1e-6) return texture;
		return textureWithLinearField(texture, nextLinearField);
	});
	return applyOwnerTexture(owner, nextTexture, "Edit Noise Gradient field");
}

/** Writes both target-space Linear field endpoints to the resolved tool owner. */
export function commitNoiseGradientToolLinearFieldEndpoints(
	nodeId: string,
	from: { readonly x: number; readonly y: number },
	to: { readonly x: number; readonly y: number },
): boolean {
	if (!Number.isFinite(from.x) || !Number.isFinite(from.y)) return false;
	if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return false;
	const owner = resolveNoiseGradientToolOwner(
		useSceneStore.getState().document,
		nodeId,
	);
	if (!owner) return false;
	const nextTexture = writeTexture(owner.texture, (texture) => {
		const current = textureParticleLinearFieldEffective(
			resolveTextureParticleLinearField(texture),
		);
		const nextLinearField = {
			...current,
			x1: from.x,
			y1: from.y,
			x2: to.x,
			y2: to.y,
		};
		if (linearFieldLengthSq(nextLinearField) <= 1e-6) return texture;
		return textureWithLinearField(texture, nextLinearField);
	});
	return applyOwnerTexture(owner, nextTexture, "Edit Noise Gradient field");
}

/** Moves the whole target-space Linear field by a normalized delta. */
export function commitNoiseGradientToolLinearFieldMove(
	nodeId: string,
	delta: { readonly x: number; readonly y: number },
): boolean {
	if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) return false;
	const owner = resolveNoiseGradientToolOwner(
		useSceneStore.getState().document,
		nodeId,
	);
	if (!owner) return false;
	const nextTexture = writeTexture(owner.texture, (texture) => {
		const current = textureParticleLinearFieldEffective(
			resolveTextureParticleLinearField(texture),
		);
		return textureWithLinearField(texture, {
			...current,
			x1: current.x1 + delta.x,
			y1: current.y1 + delta.y,
			x2: current.x2 + delta.x,
			y2: current.y2 + delta.y,
		});
	});
	return applyOwnerTexture(owner, nextTexture, "Move Noise Gradient field");
}

/** Swaps the Linear field's start and end points so the dissolve direction flips. */
export function commitNoiseGradientToolLinearFieldInvert(
	nodeId: string,
): boolean {
	const owner = resolveNoiseGradientToolOwner(
		useSceneStore.getState().document,
		nodeId,
	);
	if (!owner) return false;
	const nextTexture = writeTexture(owner.texture, (texture) => {
		const current = textureParticleLinearFieldEffective(
			resolveTextureParticleLinearField(texture),
		);
		return textureWithLinearField(texture, {
			kind: current.kind,
			space: current.space,
			x1: current.x2,
			y1: current.y2,
			x2: current.x1,
			y2: current.y1,
			plateau: current.plateau,
		});
	});
	return applyOwnerTexture(owner, nextTexture, "Invert Noise Gradient field");
}

/** Fits the Linear field back to the selected object's bounds at the current angle. */
export function commitNoiseGradientToolLinearFieldFit(nodeId: string): boolean {
	const owner = resolveNoiseGradientToolOwner(
		useSceneStore.getState().document,
		nodeId,
	);
	if (!owner) return false;
	const nextTexture = writeTexture(owner.texture, (texture) => {
		const current = textureParticleLinearFieldEffective(
			resolveTextureParticleLinearField(texture),
		);
		return textureWithLinearField(
			texture,
			textureParticleLinearFieldFromAngle(
				textureParticleLinearFieldAngle(current),
				textureParticleLinearFieldExtent(current),
			),
		);
	});
	return applyOwnerTexture(owner, nextTexture, "Fit Noise Gradient field");
}

/** Selects the particle density field for the resolved tool owner. */
export function commitNoiseGradientToolFieldMode(
	nodeId: string,
	fieldMode: TextureParticleFieldMode,
	fallbackAngle = 0,
): boolean {
	const owner = resolveNoiseGradientToolOwner(
		useSceneStore.getState().document,
		nodeId,
	);
	if (!owner) return false;
	const nextTexture = writeTexture(owner.texture, (texture) => {
		let nextLinearField: TextureParticleLinearField | null = null;
		if (fieldMode === "linear") {
			nextLinearField = texture.material.linearField
				? textureParticleLinearFieldEffective(texture.material.linearField)
				: linearFieldWithAngle(texture, fallbackAngle);
		}
		return {
			...texture,
			material: {
				...texture.material,
				mode: "particle",
				// Canvas tool defaults a fresh apply to the reframed noise-over-fill
				// model (grainPrimitives); a user-picked blend mode (incl. "dissolve"
				// for the legacy look) is preserved on later edits.
				blendMode: texture.material.blendMode ?? "hard-light",
				fieldMode,
				...(nextLinearField
					? {
							angle: textureParticleLinearFieldAngle(nextLinearField),
							strength: textureParticleLinearFieldExtent(nextLinearField),
							linearField: nextLinearField,
						}
					: fieldMode === "mesh"
						? {
								fieldMesh:
									texture.material.fieldMesh ??
									DEFAULT_TEXTURE_PARTICLE_FIELD_MESH,
							}
						: {}),
			},
		};
	});
	return applyOwnerTexture(
		owner,
		nextTexture,
		fieldMode === "linear"
			? "Edit Noise Gradient field: linear"
			: fieldMode === "mesh"
				? "Edit Noise Gradient field: mesh"
				: "Edit Noise Gradient field: circular",
	);
}

/** Sets fixed linear direction, or switches back to circular contour dissolve. */
export function commitNoiseGradientToolDirection(
	nodeId: string,
	angle: number | null,
): boolean {
	if (angle !== null && !Number.isFinite(angle)) return false;
	const owner = resolveNoiseGradientToolOwner(
		useSceneStore.getState().document,
		nodeId,
	);
	if (!owner) return false;
	const nextTexture = writeTexture(owner.texture, (texture) => {
		const nextLinearField =
			angle === null ? null : linearFieldWithAngle(texture, angle);
		return {
			...texture,
			material: {
				...texture.material,
				mode: "particle",
				// Canvas tool defaults a fresh apply to the reframed noise-over-fill
				// model (grainPrimitives); a user-picked blend mode (incl. "dissolve"
				// for the legacy look) is preserved on later edits.
				blendMode: texture.material.blendMode ?? "hard-light",
				fieldMode: angle === null ? "contour" : "linear",
				...(nextLinearField
					? {
							angle: textureParticleLinearFieldAngle(nextLinearField),
							strength: textureParticleLinearFieldExtent(nextLinearField),
							linearField: nextLinearField,
						}
					: {}),
			},
		};
	});
	return applyOwnerTexture(
		owner,
		nextTexture,
		angle === null
			? "Edit Noise Gradient field: circular"
			: "Edit Noise Gradient angle",
	);
}

/** Writes the Noise Gradient reach/extent to the resolved tool owner. */
export function commitNoiseGradientToolExtent(
	nodeId: string,
	extent: number,
): boolean {
	if (!Number.isFinite(extent)) return false;
	const owner = resolveNoiseGradientToolOwner(
		useSceneStore.getState().document,
		nodeId,
	);
	if (!owner) return false;
	const nextTexture = writeTexture(owner.texture, (texture) => ({
		...texture,
		material: {
			...texture.material,
			mode: "particle",
			blendMode: texture.material.blendMode ?? "hard-light",
			strength: clampUnit(extent),
			...(textureParticleFieldMode(texture) === "linear"
				? { linearField: linearFieldWithExtent(texture, extent) }
				: {}),
		},
	}));
	return applyOwnerTexture(owner, nextTexture, "Edit Noise Gradient extent");
}

/**
 * Switches the Noise Gradient's composite mode between the reframed
 * noise-over-fill look (`"hard-light"`) and the legacy particle-erosion
 * dissolve (`"dissolve"`); see {@link import("@/shared/vec-core").TextureMaterialBlendMode}.
 */
export function commitNoiseGradientToolBlendMode(
	nodeId: string,
	blendMode: TextureMaterialBlendMode,
): boolean {
	const owner = resolveNoiseGradientToolOwner(
		useSceneStore.getState().document,
		nodeId,
	);
	if (!owner) return false;
	const nextTexture = writeTexture(owner.texture, (texture) => ({
		...texture,
		material: {
			...texture.material,
			mode: "particle",
			blendMode,
		},
	}));
	return applyOwnerTexture(
		owner,
		nextTexture,
		blendMode === "dissolve"
			? "Enable Noise Gradient dissolve"
			: "Disable Noise Gradient dissolve",
	);
}

/**
 * Writes (or clears) the tint on the noise-over-fill overlay grain
 * (`material.overlayColor`, see {@link import("@/shared/vec-core").TextureRecipe}).
 * `value: null` writes `overlayColor: undefined`, which normalization omits
 * (the same tri-state as {@link commitNoiseGradientToolBlendMode}'s
 * `blendMode`), reverting the grain to monochrome. Unlike every other
 * material commit in this module, this one does NOT force `material.mode` to
 * `"particle"` — grain color is a cosmetic tint orthogonal to the
 * particle/mixed mode axis, so writing it must not silently downgrade a
 * `"mixed"` document back to `"particle"`.
 */
export function commitNoiseGradientToolOverlayColor(
	nodeId: string,
	value: string | null,
): boolean {
	const owner = resolveNoiseGradientToolOwner(
		useSceneStore.getState().document,
		nodeId,
	);
	if (!owner) return false;
	const nextTexture = writeTexture(owner.texture, (texture) => ({
		...texture,
		material: {
			...texture.material,
			overlayColor: value ?? undefined,
		},
	}));
	return applyOwnerTexture(
		owner,
		nextTexture,
		"Edit Noise Gradient grain color",
	);
}

/**
 * Switches the Noise Gradient material between disabled (`"off"`), the
 * particle field (`"particle"`), and the mixed composite (`"mixed"`) — a
 * separate axis from {@link commitNoiseGradientToolBlendMode}'s composite
 * mode. Unlike the other material commits in this module, this one OWNS
 * `material.mode` and must not force it back to `"particle"`. `"off"` also
 * clears `material.blendMode` (writes `undefined`) so
 * {@link import("@/shared/vec-core").normalizeTextureRecipe}'s
 * `...(blendMode ? { blendMode } : {})` spread omits the key entirely,
 * leaving the render with no material contribution; `"particle"`/`"mixed"`
 * default an absent blend mode to `"hard-light"` (the reframed
 * noise-over-fill look) without disturbing an already-authored one. This
 * commit also owns the grain sub-recipe's on/off axis: grain is kept 1:1
 * with `"mixed"` (enabled, preserving a nonzero authored strength or falling
 * back to {@link DEFAULT_MIXED_GRAIN_STRENGTH}) so switching away to
 * `"particle"`/`"off"` can't leave a stale enabled grain rendering on top of
 * a mode that no longer intends it.
 */
export function commitNoiseGradientToolMaterialMode(
	nodeId: string,
	mode: TextureMaterialMode,
): boolean {
	const owner = resolveNoiseGradientToolOwner(
		useSceneStore.getState().document,
		nodeId,
	);
	if (!owner) return false;
	const nextTexture = writeTexture(owner.texture, (texture) => ({
		...texture,
		material:
			mode === "off"
				? { ...texture.material, mode, blendMode: undefined }
				: {
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
	}));
	return applyOwnerTexture(
		owner,
		nextTexture,
		mode === "off"
			? "Disable Noise Gradient material"
			: mode === "particle"
				? "Enable Noise Gradient particle"
				: "Enable Noise Gradient mixed",
	);
}

/**
 * Writes the single primary "Style" axis — Off / Overlay / Dissolve — that
 * replaces the old two-axis `Type` + `Blend` UI. `"dissolve"` is a render
 * mode (particle-erode the fill), not a compositing blend like the other 16
 * `TextureMaterialBlendMode` values, so this commit maps Style onto the
 * existing `material.mode` / `material.blendMode` / `grain` fields rather
 * than introducing new schema. `"off"` disables the material and grain.
 * `"dissolve"` forces `mode: "particle"` and `blendMode: "dissolve"` and
 * turns grain off (dissolve doesn't compose with the Mixed film-grain
 * sub-state). `"overlay"` picks a real compositing blend — never
 * `"dissolve"` — defaulting a fresh enable to `"hard-light"` while
 * preserving an already-authored non-dissolve blend; it also preserves an
 * existing `"mixed"` (film-grain) sub-state 1:1 with grain enabled (same
 * `DEFAULT_MIXED_GRAIN_STRENGTH` fallback as
 * {@link commitNoiseGradientToolMaterialMode}), otherwise it settles on
 * `"particle"` with grain off. This commit exists alongside, not instead of,
 * {@link commitNoiseGradientToolMaterialMode} and
 * {@link commitNoiseGradientToolBlendMode} — later UI work still uses those
 * for the Film-grain toggle and the Blend dropdown.
 */
export function commitNoiseGradientToolStyle(
	nodeId: string,
	style: "off" | "overlay" | "dissolve",
): boolean {
	const owner = resolveNoiseGradientToolOwner(
		useSceneStore.getState().document,
		nodeId,
	);
	if (!owner) return false;
	const nextTexture = writeTexture(owner.texture, (texture) =>
		textureWithNoiseGradientStyle(texture, style),
	);
	return applyOwnerTexture(
		owner,
		nextTexture,
		style === "off"
			? "Disable Noise Gradient"
			: style === "dissolve"
				? "Set Noise Gradient dissolve"
				: "Set Noise Gradient overlay",
	);
}

/**
 * Writes the dissolve coverage/density bias read unconditionally as `bias` by
 * {@link import("@/entities/scene/model/effect-filter").particleDissolvePrimitives}.
 */
export function commitNoiseGradientToolAmount(
	nodeId: string,
	amount: number,
): boolean {
	if (!Number.isFinite(amount)) return false;
	const owner = resolveNoiseGradientToolOwner(
		useSceneStore.getState().document,
		nodeId,
	);
	if (!owner) return false;
	const nextTexture = writeTexture(owner.texture, (texture) => ({
		...texture,
		grain: { ...texture.grain, densityCoupling: clampUnit(amount) },
	}));
	return applyOwnerTexture(owner, nextTexture, "Edit Noise Gradient amount");
}

/**
 * Writes the dissolve threshold softness. Authored inversely as
 * `material.particleContrast` (higher softness = lower contrast = a softer,
 * more feathered particle edge).
 */
export function commitNoiseGradientToolSoftness(
	nodeId: string,
	softness: number,
): boolean {
	if (!Number.isFinite(softness)) return false;
	const owner = resolveNoiseGradientToolOwner(
		useSceneStore.getState().document,
		nodeId,
	);
	if (!owner) return false;
	const nextTexture = writeTexture(owner.texture, (texture) => ({
		...texture,
		material: {
			...texture.material,
			mode: "particle",
			particleContrast: clampUnit(1 - softness),
		},
	}));
	return applyOwnerTexture(owner, nextTexture, "Edit Noise Gradient softness");
}

/**
 * Writes the Mixed-mode film-grain strength. Grain strength is orthogonal to
 * `material.mode` (same reasoning as {@link commitNoiseGradientToolOverlayColor}),
 * so this writes only the grain sub-recipe and does NOT force `material.mode`
 * to `"particle"` — {@link commitNoiseGradientToolMaterialMode} owns whether
 * grain is enabled at all. A strength of `0` also disables grain so the
 * slider's low end matches "no grain" rather than "grain at zero strength".
 */
export function commitNoiseGradientToolGrainStrength(
	nodeId: string,
	strength: number,
): boolean {
	if (!Number.isFinite(strength)) return false;
	const owner = resolveNoiseGradientToolOwner(
		useSceneStore.getState().document,
		nodeId,
	);
	if (!owner) return false;
	const nextTexture = writeTexture(owner.texture, (texture) => ({
		...texture,
		grain: {
			...texture.grain,
			strength: clampUnit(strength),
			enabled: strength > 0,
		},
	}));
	return applyOwnerTexture(
		owner,
		nextTexture,
		"Edit Noise Gradient grain strength",
	);
}

/**
 * Writes the dissolve's reveal paint — the second paint a `"dissolve"` blend
 * mode reveals underneath the object's own fill. `revealPaint` lives only in
 * scoped Look Graph form (`LookGraphScopedEffectLook`'s grain payload), so a
 * plain object-material owner is auto-promoted to a scoped graph first via
 * {@link resolveNoiseGradientOpenGraphTarget} — this is what makes the reveal
 * paint reachable straight from the tool bar with no manual "Open Graph"
 * click. `value: null` explicitly clears the reveal paint; a `RevealPaint`
 * sets it (see {@link import("@/entities/scene/model/noise-gradient-look").GraphWithObjectNoiseGradientTextureOptions}
 * for the full tri-state, including the "omitted" preserve case this commit
 * never uses).
 */
export function commitNoiseGradientToolRevealPaint(
	nodeId: string,
	value: RevealPaint | null,
): boolean {
	const target = resolveNoiseGradientOpenGraphTarget(nodeId);
	if (!target) return false;
	const owner = resolveNoiseGradientToolOwner(
		useSceneStore.getState().document,
		nodeId,
	);
	if (owner?.source !== "scoped-object") return false;
	const nextGraph = graphWithObjectNoiseGradientTexture(
		owner.look,
		owner.texture,
		{
			revealPaint: value,
		},
	);
	if (!nextGraph) return false;
	return applyScopedLookGraph(
		owner,
		nextGraph,
		"Edit Noise Gradient reveal paint",
	);
}

const fieldMeshOrDefault = (texture: TextureRecipe) =>
	texture.material.fieldMesh ?? DEFAULT_TEXTURE_PARTICLE_FIELD_MESH;

const commitNoiseGradientToolFieldMeshEdit = (
	nodeId: string,
	edit: (
		fieldMesh: typeof DEFAULT_TEXTURE_PARTICLE_FIELD_MESH,
	) => typeof DEFAULT_TEXTURE_PARTICLE_FIELD_MESH,
	label: string,
): boolean => {
	const owner = resolveNoiseGradientToolOwner(
		useSceneStore.getState().document,
		nodeId,
	);
	if (!owner) return false;
	const nextTexture = writeTexture(owner.texture, (texture) => ({
		...texture,
		material: {
			...texture.material,
			mode: "particle",
			blendMode: texture.material.blendMode ?? "hard-light",
			fieldMode: "mesh",
			fieldMesh: edit(fieldMeshOrDefault(texture)),
		},
	}));
	return applyOwnerTexture(owner, nextTexture, label);
};

/** Moves one Field Mesh density control point in normalized effect bounds. */
export function commitNoiseGradientToolFieldMeshPoint(
	nodeId: string,
	row: number,
	col: number,
	point: { readonly x: number; readonly y: number },
): boolean {
	if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
	return commitNoiseGradientToolFieldMeshEdit(
		nodeId,
		(fieldMesh) =>
			moveTextureParticleFieldMeshPoint(fieldMesh, row, col, point),
		"Edit Noise Gradient mesh point",
	);
}

/** Sets one Field Mesh point's scalar particle density. */
export function commitNoiseGradientToolFieldMeshDensity(
	nodeId: string,
	row: number,
	col: number,
	density: number,
): boolean {
	if (!Number.isFinite(density)) return false;
	return commitNoiseGradientToolFieldMeshEdit(
		nodeId,
		(fieldMesh) =>
			setTextureParticleFieldMeshPointDensity(fieldMesh, row, col, density),
		"Edit Noise Gradient mesh density",
	);
}

/** Adds one Field Mesh row and column at a patch hit. */
export function commitNoiseGradientToolFieldMeshInsert(
	nodeId: string,
	row: number,
	col: number,
	u: number,
	v: number,
): boolean {
	if (![row, col, u, v].every(Number.isFinite)) return false;
	return commitNoiseGradientToolFieldMeshEdit(
		nodeId,
		(fieldMesh) =>
			insertTextureParticleFieldMeshColumn(
				insertTextureParticleFieldMeshRow(fieldMesh, row, v),
				col,
				u,
			),
		"Add Noise Gradient mesh lines",
	);
}

/** Removes the interior row/column through one Field Mesh point. */
export function commitNoiseGradientToolFieldMeshRemove(
	nodeId: string,
	row: number,
	col: number,
): boolean {
	return commitNoiseGradientToolFieldMeshEdit(
		nodeId,
		(fieldMesh) =>
			removeTextureParticleFieldMeshPointLines(fieldMesh, row, col),
		"Remove Noise Gradient mesh lines",
	);
}
