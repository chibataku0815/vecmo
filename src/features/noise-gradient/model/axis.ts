import {
	objectNoiseGradientTextureFromRecipe,
	textureMaterialIsParticle,
} from "@/entities/scene/model/noise-gradient-look";
import {
	applyMatrixToPoint,
	getGeometryBounds,
	invertMatrix,
	matrixFromTransform,
} from "@/entities/scene/model/rendering";
import type { Vec2, VectorNode } from "@/entities/scene/model/types";
import {
	hitScalarEffectFieldMeshPoint,
	linearEffectFieldAxis,
	type ScalarEffectFieldMeshPatchHit,
	type ScalarEffectFieldMeshScene,
	scalarEffectFieldMeshPatchAt,
	scalarEffectFieldMeshScene,
	scalarEffectFieldPointForLocalPoint,
} from "@/shared/effect-field";
import {
	DEFAULT_TEXTURE_PARTICLE_FIELD_MESH,
	normalizeVisualRecipe,
	resolveTextureParticleLinearField,
	type TextureParticleFieldMesh,
	type TextureRecipe,
	textureParticleFieldMeshToScalarEffectFieldMesh,
	textureParticleFieldMode,
	textureParticleLinearFieldAngle,
	textureParticleLinearFieldEffective,
	textureParticleLinearFieldExtent,
} from "@/shared/vec-core";

const MIN_AXIS_LENGTH = 1e-6;
const FULL_TURN_DEGREES = 360;
const RIGHT_ANGLE_STEPS = 8;

export type NoiseGradientAxisHandleId = "from" | "to" | "center" | "extent";

export type NoiseGradientAxisScene = {
	readonly angle: number;
	readonly extent: number;
	readonly fixedAngle: boolean;
	readonly center: Vec2;
	readonly from: Vec2;
	readonly to: Vec2;
	readonly extentFrom: Vec2;
	readonly extentTo: Vec2;
	readonly extentPoint: Vec2;
	readonly handles: readonly {
		readonly id: NoiseGradientAxisHandleId;
		readonly point: Vec2;
	}[];
};

export type NoiseGradientFieldMeshPointScene = {
	readonly row: number;
	readonly col: number;
	readonly density: number;
	readonly value: number;
	readonly normalized: Vec2;
	readonly local: Vec2;
	readonly artboard: Vec2;
};

export type NoiseGradientFieldMeshScene = {
	readonly fieldMesh: TextureParticleFieldMesh;
	readonly points: readonly NoiseGradientFieldMeshPointScene[];
	readonly segments: readonly {
		readonly from: Vec2;
		readonly to: Vec2;
	}[];
};

export type NoiseGradientAxisSceneOptions = {
	/** Texture already resolved by the Noise Gradient owner read model. */
	readonly texture?: TextureRecipe;
	/**
	 * When true, a non-particle object is projected through the default object
	 * Noise Gradient texture without mutating the document. The tool uses this for
	 * edit-only activation: first real Angle/Extent edit still seeds via command bus.
	 */
	readonly preview?: boolean;
};

/** Returns true when the node's vec-core recipe currently renders Noise Gradient. */
export function nodeHasNoiseGradient(node: VectorNode): boolean {
	return textureMaterialIsParticle(normalizeVisualRecipe(node.recipe).texture);
}

const normalizeAngle = (angle: number): number =>
	((angle % FULL_TURN_DEGREES) + FULL_TURN_DEGREES) % FULL_TURN_DEGREES;

const snapAngle = (angle: number): number => {
	const step = FULL_TURN_DEGREES / RIGHT_ANGLE_STEPS;
	return normalizeAngle(Math.round(angle / step) * step);
};

const clampUnit = (value: number): number => Math.min(1, Math.max(0, value));

const axisPoint = (from: Vec2, to: Vec2, offset: number): Vec2 => ({
	x: from.x + (to.x - from.x) * offset,
	y: from.y + (to.y - from.y) * offset,
});

const normalizedPointToLocal = (
	bounds: ReturnType<typeof getGeometryBounds>,
	point: Vec2,
): Vec2 => ({
	x: bounds.x + point.x * bounds.width,
	y: bounds.y + point.y * bounds.height,
});

/**
 * Projects the node-local Noise Gradient field axis into artboard-local handle
 * positions. In Linear mode, explicit `material.linearField` endpoints win;
 * legacy angle-only recipes synthesize the same full-bounds axis as before. In
 * Circular contour mode, `extentPoint` is presented as a scalar reach from the
 * shape center so the all-sides dissolve does not masquerade as a directional
 * gradient.
 */
export function noiseGradientAxisScene(
	node: VectorNode,
	options: NoiseGradientAxisSceneOptions = {},
): NoiseGradientAxisScene | null {
	const recipe = normalizeVisualRecipe(node.recipe);
	const texture =
		options.texture ??
		(textureMaterialIsParticle(recipe.texture)
			? recipe.texture
			: options.preview
				? objectNoiseGradientTextureFromRecipe(recipe)
				: null);
	if (!texture) return null;
	const bounds = getGeometryBounds(node.geometry);
	const fixedAngle = textureParticleFieldMode(texture) === "linear";
	const linearField = fixedAngle
		? textureParticleLinearFieldEffective(
				resolveTextureParticleLinearField(texture),
			)
		: null;
	const angle = normalizeAngle(
		linearField
			? textureParticleLinearFieldAngle(linearField)
			: (texture.material.angle ?? 0),
	);
	// Circular may keep dormant Linear data for restoration, but its direct
	// controls should not imply a directional field.
	const displayAxis =
		fixedAngle && linearField
			? {
					center: normalizedPointToLocal(bounds, {
						x: (linearField.x1 + linearField.x2) / 2,
						y: (linearField.y1 + linearField.y2) / 2,
					}),
					from: normalizedPointToLocal(bounds, {
						x: linearField.x1,
						y: linearField.y1,
					}),
					to: normalizedPointToLocal(bounds, {
						x: linearField.x2,
						y: linearField.y2,
					}),
				}
			: linearEffectFieldAxis(bounds, 0);
	const centerLocal = displayAxis.center;
	const fromLocal = displayAxis.from;
	const toLocal = displayAxis.to;
	const extent = clampUnit(
		linearField
			? textureParticleLinearFieldExtent(linearField)
			: texture.material.strength,
	);
	const extentFromLocal = fixedAngle ? toLocal : centerLocal;
	const extentToLocal = fixedAngle ? fromLocal : toLocal;
	const extentLocal = axisPoint(extentFromLocal, extentToLocal, extent);
	const matrix = matrixFromTransform(node.transform);
	const from = applyMatrixToPoint(matrix, fromLocal);
	const to = applyMatrixToPoint(matrix, toLocal);
	const center = applyMatrixToPoint(matrix, centerLocal);
	const extentFrom = applyMatrixToPoint(matrix, extentFromLocal);
	const extentTo = applyMatrixToPoint(matrix, extentToLocal);
	const extentPoint = applyMatrixToPoint(matrix, extentLocal);
	return {
		angle,
		extent,
		fixedAngle,
		center,
		from,
		to,
		extentFrom,
		extentTo,
		extentPoint,
		handles: fixedAngle
			? [
					{ id: "from", point: from },
					{ id: "center", point: center },
					{ id: "to", point: to },
					{ id: "extent", point: extentPoint },
				]
			: [{ id: "extent", point: extentPoint }],
	};
}

/**
 * Projects a particle Field Mesh from normalized effect-bounds coordinates into
 * artboard coordinates for the Noise Gradient Tool. This is intentionally
 * separate from color Gradient Mesh authoring: the payload is scalar density,
 * but the canvas vocabulary mirrors mesh point/line editing.
 */
export function noiseGradientFieldMeshScene(
	node: VectorNode,
	options: NoiseGradientAxisSceneOptions = {},
): NoiseGradientFieldMeshScene | null {
	const recipe = normalizeVisualRecipe(node.recipe);
	const texture =
		options.texture ??
		(textureMaterialIsParticle(recipe.texture)
			? recipe.texture
			: options.preview
				? objectNoiseGradientTextureFromRecipe(recipe)
				: null);
	if (!texture || textureParticleFieldMode(texture) !== "mesh") return null;
	const fieldMesh =
		texture.material.fieldMesh ?? DEFAULT_TEXTURE_PARTICLE_FIELD_MESH;
	const bounds = getGeometryBounds(node.geometry);
	const matrix = matrixFromTransform(node.transform);
	const scene = scalarEffectFieldMeshScene(
		textureParticleFieldMeshToScalarEffectFieldMesh(fieldMesh),
		bounds,
		(local) => applyMatrixToPoint(matrix, local),
	);
	return {
		fieldMesh,
		points: scene.points.map((point) => ({
			...point,
			density: point.value,
		})),
		segments: scene.segments,
	};
}

const scalarNoiseGradientFieldMeshScene = (
	scene: NoiseGradientFieldMeshScene,
): ScalarEffectFieldMeshScene => ({
	fieldMesh: textureParticleFieldMeshToScalarEffectFieldMesh(scene.fieldMesh),
	points: scene.points,
	segments: scene.segments,
});

/** Closest Field Mesh point within `tolerance`, or null. */
export function hitNoiseGradientFieldMeshPoint(
	scene: NoiseGradientFieldMeshScene,
	point: Vec2,
	tolerance: number,
): { readonly row: number; readonly col: number } | null {
	return hitScalarEffectFieldMeshPoint(
		scalarNoiseGradientFieldMeshScene(scene),
		point,
		tolerance,
	);
}

/** Converts an artboard-local pointer into normalized Field Mesh coordinates. */
export function noiseGradientFieldMeshPointForArtboardPoint(
	node: VectorNode,
	point: Vec2,
): Vec2 | null {
	const inverse = invertMatrix(matrixFromTransform(node.transform));
	if (!inverse) return null;
	const local = applyMatrixToPoint(inverse, point);
	const bounds = getGeometryBounds(node.geometry);
	return scalarEffectFieldPointForLocalPoint(bounds, local);
}

/** Converts an artboard-local pointer into target-space Linear field coordinates. */
export function noiseGradientLinearFieldPointForArtboardPoint(
	node: VectorNode,
	point: Vec2,
): Vec2 | null {
	const inverse = invertMatrix(matrixFromTransform(node.transform));
	if (!inverse) return null;
	const local = applyMatrixToPoint(inverse, point);
	const bounds = getGeometryBounds(node.geometry);
	if (Math.abs(bounds.width) <= MIN_AXIS_LENGTH) return null;
	if (Math.abs(bounds.height) <= MIN_AXIS_LENGTH) return null;
	return {
		x: (local.x - bounds.x) / bounds.width,
		y: (local.y - bounds.y) / bounds.height,
	};
}

/** Field Mesh patch under an artboard-local pointer, for row+column insertion. */
export function noiseGradientFieldMeshPatchAt(
	scene: NoiseGradientFieldMeshScene,
	node: VectorNode,
	point: Vec2,
): ScalarEffectFieldMeshPatchHit | null {
	const inverse = invertMatrix(matrixFromTransform(node.transform));
	if (!inverse) return null;
	const local = applyMatrixToPoint(inverse, point);
	return scalarEffectFieldMeshPatchAt(
		scalarNoiseGradientFieldMeshScene(scene),
		local,
	);
}

/** Closest Noise Gradient axis handle within `tolerance`, or null. */
export function hitNoiseGradientAxisHandle(
	axis: NoiseGradientAxisScene,
	point: Vec2,
	tolerance: number,
): NoiseGradientAxisHandleId | null {
	let best: NoiseGradientAxisHandleId | null = null;
	let bestDistance = tolerance;
	for (const handle of axis.handles) {
		const distance = Math.hypot(
			handle.point.x - point.x,
			handle.point.y - point.y,
		);
		if (distance <= bestDistance) {
			bestDistance = distance;
			best = handle.id;
		}
	}
	return best;
}

/** Perpendicular distance from `point` to the displayed axis segment. */
export function distanceToNoiseGradientAxis(
	axis: NoiseGradientAxisScene,
	point: Vec2,
): number {
	const dx = axis.to.x - axis.from.x;
	const dy = axis.to.y - axis.from.y;
	const lengthSq = dx * dx + dy * dy;
	if (lengthSq <= MIN_AXIS_LENGTH) {
		return Math.hypot(point.x - axis.center.x, point.y - axis.center.y);
	}
	const raw =
		((point.x - axis.from.x) * dx + (point.y - axis.from.y) * dy) / lengthSq;
	const t = Math.min(1, Math.max(0, raw));
	const projected = {
		x: axis.from.x + dx * t,
		y: axis.from.y + dy * t,
	};
	return Math.hypot(point.x - projected.x, point.y - projected.y);
}

/** Maps an artboard-local point on the displayed axis to `material.strength`. */
export function noiseGradientExtentForPoint(
	axis: NoiseGradientAxisScene,
	point: Vec2,
): number {
	const dx = axis.extentTo.x - axis.extentFrom.x;
	const dy = axis.extentTo.y - axis.extentFrom.y;
	const lengthSq = dx * dx + dy * dy;
	if (lengthSq <= MIN_AXIS_LENGTH) return axis.extent;
	const offset = clampUnit(
		((point.x - axis.extentFrom.x) * dx + (point.y - axis.extentFrom.y) * dy) /
			lengthSq,
	);
	return offset;
}

/**
 * Converts an artboard-local pointer into a node-local Noise Gradient angle.
 * Shift snaps to the same 45-degree presets shown in the Inspector.
 */
export function noiseGradientAngleForPoint(
	node: VectorNode,
	point: Vec2,
	snap: boolean,
): number | null {
	const inverse = invertMatrix(matrixFromTransform(node.transform));
	if (!inverse) return null;
	const local = applyMatrixToPoint(inverse, point);
	const bounds = getGeometryBounds(node.geometry);
	const center = {
		x: bounds.x + bounds.width / 2,
		y: bounds.y + bounds.height / 2,
	};
	const dx = local.x - center.x;
	const dy = local.y - center.y;
	if (dx * dx + dy * dy <= MIN_AXIS_LENGTH) return null;
	const angle = normalizeAngle((Math.atan2(dy, dx) * 180) / Math.PI);
	return snap ? snapAngle(angle) : angle;
}
