import type { EffectMaskSource } from "@/shared/vec-core";
import type {
	EffectFieldFidelity,
	EffectFieldRenderSurface,
	EffectFieldRoutePlan,
	EffectFieldTargetDescriptor,
} from "./effect-field-routing";
import { resolveFrameEffectIntent } from "./recipe-resolve";
import {
	applyMatrixToPoint,
	composeMatrix,
	getNodeLocalBounds,
	invertMatrix,
	type Matrix2D,
	matrixFromTransform,
} from "./rendering";
import {
	findArtboardById,
	selectCurrentArtboard,
	selectNodeArtboardMapping,
} from "./selectors";
import type {
	Artboard,
	Bounds,
	SceneDocument,
	SourceOpticsAtmosphereContract,
	SourceOpticsBloomContract,
	SourceOpticsDiffusionResponse,
	SourceOpticsEdgeResponse,
	SourceOpticsLensContract,
	SourceOpticsMicrostructureResponse,
	SourceOpticsRayContract,
	SourceOpticsResponseBinding,
	SourceOpticsRigContract,
	SourceOpticsSpectralResponse,
	SourceOpticsSurfaceResponse,
	Vec2,
	VectorNode,
} from "./types";

const IDENTITY_MATRIX: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const EPSILON = 1e-6;
const MAX_RAYS = 4;
const MAX_AUTHORED_DISTANCE = 65_536;

export type SourceOpticsParameterDescriptor = {
	readonly id: string;
	readonly owner: "rig" | "ray" | "response";
	readonly channel:
		| "bloom"
		| "ray"
		| "atmosphere"
		| "lens"
		| "surface"
		| "diffusion"
		| "edge"
		| "microstructure"
		| "spectral";
	readonly unit: "px" | "ratio" | "degrees";
	readonly min: number;
	readonly max: number;
	readonly keyframable: boolean;
};

/**
 * Stable numeric ids shared by static authoring and the additive motion sidecar.
 * Ray channels are promoted to their own identity scope while preserving every
 * P1 id and range.
 */
const SOURCE_OPTICS_PARAMETER_DESCRIPTOR_INPUT = [
	{
		id: "source-optics.bloom.radius-x",
		owner: "rig",
		channel: "bloom",
		unit: "px",
		min: 0,
		max: MAX_AUTHORED_DISTANCE,
		keyframable: false,
	},
	{
		id: "source-optics.bloom.radius-y",
		owner: "rig",
		channel: "bloom",
		unit: "px",
		min: 0,
		max: MAX_AUTHORED_DISTANCE,
		keyframable: false,
	},
	{
		id: "source-optics.bloom.intensity",
		owner: "rig",
		channel: "bloom",
		unit: "ratio",
		min: 0,
		max: 8,
		keyframable: false,
	},
	{
		id: "source-optics.bloom.threshold",
		owner: "rig",
		channel: "bloom",
		unit: "ratio",
		min: 0,
		max: 1,
		keyframable: false,
	},
	{
		id: "source-optics.ray.angle",
		owner: "rig",
		channel: "ray",
		unit: "degrees",
		min: 0,
		max: 360,
		keyframable: false,
	},
	{
		id: "source-optics.ray.length",
		owner: "rig",
		channel: "ray",
		unit: "px",
		min: 0,
		max: MAX_AUTHORED_DISTANCE,
		keyframable: false,
	},
	{
		id: "source-optics.ray.width",
		owner: "rig",
		channel: "ray",
		unit: "px",
		min: 0,
		max: MAX_AUTHORED_DISTANCE,
		keyframable: false,
	},
	{
		id: "source-optics.ray.intensity",
		owner: "rig",
		channel: "ray",
		unit: "ratio",
		min: 0,
		max: 8,
		keyframable: false,
	},
	{
		id: "source-optics.ray.falloff",
		owner: "rig",
		channel: "ray",
		unit: "ratio",
		min: 0,
		max: 1,
		keyframable: false,
	},
	{
		id: "source-optics.ray.opposite-side-ratio",
		owner: "rig",
		channel: "ray",
		unit: "ratio",
		min: 0,
		max: 1,
		keyframable: false,
	},
	{
		id: "source-optics.atmosphere.mix",
		owner: "rig",
		channel: "atmosphere",
		unit: "ratio",
		min: 0,
		max: 1,
		keyframable: false,
	},
	{
		id: "source-optics.atmosphere.falloff",
		owner: "rig",
		channel: "atmosphere",
		unit: "ratio",
		min: 0,
		max: 1,
		keyframable: false,
	},
	{
		id: "source-optics.atmosphere.reach",
		owner: "rig",
		channel: "atmosphere",
		unit: "px",
		min: 0,
		max: MAX_AUTHORED_DISTANCE,
		keyframable: false,
	},
	{
		id: "source-optics.lens.mix",
		owner: "rig",
		channel: "lens",
		unit: "ratio",
		min: 0,
		max: 1,
		keyframable: false,
	},
	{
		id: "source-optics.lens.chroma",
		owner: "rig",
		channel: "lens",
		unit: "px",
		min: 0,
		max: MAX_AUTHORED_DISTANCE,
		keyframable: false,
	},
	{
		id: "source-optics.lens.reach",
		owner: "rig",
		channel: "lens",
		unit: "px",
		min: 0,
		max: MAX_AUTHORED_DISTANCE,
		keyframable: false,
	},
	{
		id: "source-optics.surface.amount",
		owner: "response",
		channel: "surface",
		unit: "ratio",
		min: 0,
		max: 1,
		keyframable: false,
	},
	{
		id: "source-optics.surface.width",
		owner: "response",
		channel: "surface",
		unit: "px",
		min: 0,
		max: MAX_AUTHORED_DISTANCE,
		keyframable: false,
	},
	{
		id: "source-optics.surface.softness",
		owner: "response",
		channel: "surface",
		unit: "px",
		min: 0,
		max: MAX_AUTHORED_DISTANCE,
		keyframable: false,
	},
	{
		id: "source-optics.diffusion.amount",
		owner: "response",
		channel: "diffusion",
		unit: "ratio",
		min: 0,
		max: 1,
		keyframable: false,
	},
	{
		id: "source-optics.diffusion.depth",
		owner: "response",
		channel: "diffusion",
		unit: "px",
		min: 0,
		max: MAX_AUTHORED_DISTANCE,
		keyframable: false,
	},
	{
		id: "source-optics.diffusion.softness",
		owner: "response",
		channel: "diffusion",
		unit: "px",
		min: 0,
		max: MAX_AUTHORED_DISTANCE,
		keyframable: false,
	},
	{
		id: "source-optics.edge.amount",
		owner: "response",
		channel: "edge",
		unit: "ratio",
		min: 0,
		max: 1,
		keyframable: false,
	},
	{
		id: "source-optics.edge.width",
		owner: "response",
		channel: "edge",
		unit: "px",
		min: 0,
		max: MAX_AUTHORED_DISTANCE,
		keyframable: false,
	},
	{
		id: "source-optics.edge.softness",
		owner: "response",
		channel: "edge",
		unit: "px",
		min: 0,
		max: MAX_AUTHORED_DISTANCE,
		keyframable: false,
	},
	{
		id: "source-optics.microstructure.amount",
		owner: "response",
		channel: "microstructure",
		unit: "ratio",
		min: 0,
		max: 1,
		keyframable: false,
	},
	{
		id: "source-optics.spectral.amount",
		owner: "response",
		channel: "spectral",
		unit: "ratio",
		min: 0,
		max: 1,
		keyframable: false,
	},
	{
		id: "source-optics.spectral.offset",
		owner: "response",
		channel: "spectral",
		unit: "px",
		min: 0,
		max: MAX_AUTHORED_DISTANCE,
		keyframable: false,
	},
] as const satisfies readonly SourceOpticsParameterDescriptor[];

/**
 * `@__PURE__`-annotated so a bundler that never reaches a consumer of this
 * export (every LEAN/FLAT runtime-sampler tier — see `docs/codemap.md`'s
 * motion/timeline row) can tree-shake the whole derivation away. Without the
 * annotation esbuild cannot prove the `.map` callback is free of observable
 * side effects and keeps the dead import edge (and `recipe-controls.ts`-
 * adjacent modules it pulls in) alive even when nothing calls
 * `SOURCE_OPTICS_PARAMETER_DESCRIPTORS`. Must stay pure: no side effects in
 * the callback, and behavior for every existing caller (editor, FULL, CORE)
 * is unchanged — this only affects whether the computation can be elided
 * when unused.
 */
export const SOURCE_OPTICS_PARAMETER_DESCRIPTORS: readonly SourceOpticsParameterDescriptor[] =
	/* @__PURE__ */ SOURCE_OPTICS_PARAMETER_DESCRIPTOR_INPUT.map(
		(descriptor) => ({
			...descriptor,
			owner: descriptor.channel === "ray" ? "ray" : descriptor.owner,
			keyframable: true,
		}),
	);

/** Stable address for one numeric Source Optics owner parameter. */
export type SourceOpticsParameterTarget =
	| {
			readonly kind: "rig";
			readonly artboardId: string;
			readonly rigId: string;
			readonly parameterId: string;
	  }
	| {
			readonly kind: "ray";
			readonly artboardId: string;
			readonly rigId: string;
			readonly rayId: string;
			readonly parameterId: string;
	  }
	| {
			readonly kind: "binding";
			readonly artboardId: string;
			readonly rigId: string;
			readonly bindingId: string;
			readonly parameterId: string;
	  };

const finite = (value: number | undefined, fallback: number): number =>
	value !== undefined && Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));
const clamp01 = (value: number): number => clamp(value, 0, 1);
const nonNegative = (value: number | undefined, fallback: number): number =>
	clamp(finite(value, fallback), 0, MAX_AUTHORED_DISTANCE);
const positive = (value: number | undefined, fallback: number): number =>
	clamp(finite(value, fallback), EPSILON, MAX_AUTHORED_DISTANCE);
const optionalText = (value: string | null | undefined): string | undefined => {
	const normalized = value?.trim();
	return normalized ? normalized : undefined;
};
const normalizedAngle = (value: number): number => ((value % 360) + 360) % 360;

const normalizeBloom = (
	draft: Partial<SourceOpticsBloomContract> | undefined,
): SourceOpticsBloomContract => {
	const radiusX = nonNegative(draft?.radiusX, 24);
	const authoredRadiusY = draft?.radiusY;
	return {
		enabled: draft?.enabled ?? true,
		radiusX,
		...(authoredRadiusY === undefined
			? {}
			: { radiusY: nonNegative(authoredRadiusY, radiusX) }),
		intensity: clamp(nonNegative(draft?.intensity, 0.8), 0, 8),
		threshold: clamp01(finite(draft?.threshold, 0.65)),
		blendMode: draft?.blendMode ?? "screen",
	};
};

const normalizeRay = (
	draft: Partial<SourceOpticsRayContract> | undefined,
	index: number,
): SourceOpticsRayContract => ({
	id: optionalText(draft?.id) ?? `ray-${index + 1}`,
	enabled: draft?.enabled ?? true,
	angle: normalizedAngle(finite(draft?.angle, index * 90)),
	length: positive(draft?.length, 96),
	width: positive(draft?.width, 3),
	intensity: clamp(nonNegative(draft?.intensity, 0.45), 0, 8),
	falloff: clamp01(finite(draft?.falloff, 0.7)),
	oppositeSideRatio: clamp01(finite(draft?.oppositeSideRatio, 0.6)),
});

const normalizeAtmosphere = (
	draft: Partial<SourceOpticsAtmosphereContract> | undefined,
): SourceOpticsAtmosphereContract | undefined => {
	if (!draft) return undefined;
	const fieldId = optionalText(draft.fieldId);
	const tint = optionalText(draft.tint);
	return {
		enabled: draft.enabled ?? true,
		...(fieldId ? { fieldId } : {}),
		mix: clamp01(finite(draft.mix, 0.16)),
		falloff: clamp01(finite(draft.falloff, 0.72)),
		reach: positive(draft.reach, 180),
		...(tint ? { tint } : {}),
	};
};

const normalizeLens = (
	draft: Partial<SourceOpticsLensContract> | undefined,
): SourceOpticsLensContract | undefined =>
	draft
		? {
				enabled: draft.enabled ?? true,
				mix: clamp01(finite(draft.mix, 0.18)),
				chroma: nonNegative(draft.chroma, 2),
				reach: positive(draft.reach, 32),
			}
		: undefined;

const normalizeSurface = (
	draft: Partial<SourceOpticsSurfaceResponse> | undefined,
): SourceOpticsSurfaceResponse | undefined => {
	if (!draft) return undefined;
	const tint = optionalText(draft.tint);
	return {
		amount: clamp01(finite(draft.amount, 0.55)),
		width: positive(draft.width, 18),
		softness: nonNegative(draft.softness, 5),
		...(tint ? { tint } : {}),
	};
};

const normalizeDiffusion = (
	draft: Partial<SourceOpticsDiffusionResponse> | undefined,
): SourceOpticsDiffusionResponse | undefined => {
	if (!draft) return undefined;
	const tint = optionalText(draft.tint);
	return {
		amount: clamp01(finite(draft.amount, 0.22)),
		depth: positive(draft.depth, 28),
		softness: nonNegative(draft.softness, 9),
		...(tint ? { tint } : {}),
	};
};

const normalizeEdge = (
	draft: Partial<SourceOpticsEdgeResponse> | undefined,
): SourceOpticsEdgeResponse | undefined => {
	if (!draft) return undefined;
	const tint = optionalText(draft.tint);
	return {
		amount: clamp01(finite(draft.amount, 0.2)),
		width: positive(draft.width, 8),
		softness: nonNegative(draft.softness, 2),
		...(tint ? { tint } : {}),
	};
};

const normalizeMicrostructure = (
	draft: Partial<SourceOpticsMicrostructureResponse> | undefined,
): SourceOpticsMicrostructureResponse | undefined =>
	draft ? { amount: clamp01(finite(draft.amount, 0.25)) } : undefined;

const normalizeSpectral = (
	draft: Partial<SourceOpticsSpectralResponse> | undefined,
): SourceOpticsSpectralResponse | undefined =>
	draft
		? {
				amount: clamp01(finite(draft.amount, 0.12)),
				offset: nonNegative(draft.offset, 2),
			}
		: undefined;

/** Sparse response update used by UI and agent command adapters. */
export type SourceOpticsResponseDraft = Partial<
	Omit<
		SourceOpticsResponseBinding,
		"fieldId" | "surface" | "diffusion" | "edge" | "microstructure" | "spectral"
	>
> & {
	readonly fieldId?: string | null;
	readonly surface?: Partial<SourceOpticsSurfaceResponse> | null;
	readonly diffusion?: Partial<SourceOpticsDiffusionResponse> | null;
	readonly edge?: Partial<SourceOpticsEdgeResponse> | null;
	readonly microstructure?: Partial<SourceOpticsMicrostructureResponse> | null;
	readonly spectral?: Partial<SourceOpticsSpectralResponse> | null;
};

/** Sparse rig update used by UI and agent command adapters. */
export type SourceOpticsRigDraft = Partial<
	Omit<
		SourceOpticsRigContract,
		"bloom" | "rays" | "atmosphere" | "lens" | "responses"
	>
> & {
	readonly bloom?: Partial<SourceOpticsBloomContract>;
	readonly rays?: readonly Partial<SourceOpticsRayContract>[] | null;
	readonly atmosphere?: Partial<SourceOpticsAtmosphereContract> | null;
	readonly lens?: Partial<SourceOpticsLensContract> | null;
	readonly responses?: readonly SourceOpticsResponseDraft[];
};

/** Canonicalizes one response without introducing a material or geometry branch. */
export function normalizeSourceOpticsResponse(
	draft: SourceOpticsResponseDraft,
	index = 0,
): SourceOpticsResponseBinding | null {
	const targetNodeId = optionalText(draft.targetNodeId);
	if (!targetNodeId) return null;
	const fieldId = optionalText(draft.fieldId);
	const surface =
		draft.surface === null ? undefined : normalizeSurface(draft.surface);
	const diffusion =
		draft.diffusion === null ? undefined : normalizeDiffusion(draft.diffusion);
	const edge = draft.edge === null ? undefined : normalizeEdge(draft.edge);
	const microstructure =
		draft.microstructure === null
			? undefined
			: normalizeMicrostructure(draft.microstructure);
	const spectral =
		draft.spectral === null ? undefined : normalizeSpectral(draft.spectral);
	return {
		id: optionalText(draft.id) ?? `response-${index + 1}`,
		targetNodeId,
		enabled: draft.enabled ?? true,
		...(fieldId ? { fieldId } : {}),
		...(surface ? { surface } : {}),
		...(diffusion ? { diffusion } : {}),
		...(edge ? { edge } : {}),
		...(microstructure ? { microstructure } : {}),
		...(spectral ? { spectral } : {}),
	};
}

/** Canonicalizes one additive rig while preserving the source node as the core owner. */
export function normalizeSourceOpticsRig(
	draft: SourceOpticsRigDraft,
	index = 0,
): SourceOpticsRigContract | null {
	const sourceNodeId = optionalText(draft.sourceNodeId);
	if (!sourceNodeId) return null;
	const atmosphere =
		draft.atmosphere === null
			? undefined
			: normalizeAtmosphere(draft.atmosphere);
	const lens = draft.lens === null ? undefined : normalizeLens(draft.lens);
	const rays =
		draft.rays === null
			? undefined
			: draft.rays
					?.slice(0, MAX_RAYS)
					.map((ray, rayIndex) => normalizeRay(ray, rayIndex));
	const responses = (draft.responses ?? [])
		.map((response, responseIndex) =>
			normalizeSourceOpticsResponse(response, responseIndex),
		)
		.filter(
			(response): response is SourceOpticsResponseBinding => response !== null,
		);
	return {
		id: optionalText(draft.id) ?? `source-optics-${index + 1}`,
		name: optionalText(draft.name) ?? "Source optics",
		enabled: draft.enabled ?? true,
		sourceNodeId,
		bloom: normalizeBloom(draft.bloom),
		...(rays && rays.length > 0 ? { rays } : {}),
		...(atmosphere ? { atmosphere } : {}),
		...(lens ? { lens } : {}),
		responses,
	};
}

/** Returns normalized rig values without rewriting legacy artboards. */
export function sourceOpticsRigsForArtboard(
	artboard: Pick<Artboard, "sourceOpticsRigs">,
): readonly SourceOpticsRigContract[] {
	return (artboard.sourceOpticsRigs ?? [])
		.map((rig, index) => normalizeSourceOpticsRig(rig, index))
		.filter((rig): rig is SourceOpticsRigContract => rig !== null);
}

/** Resolves one stable numeric descriptor without accepting unknown ids. */
export function sourceOpticsParameterDescriptor(
	parameterId: string,
): SourceOpticsParameterDescriptor | undefined {
	return SOURCE_OPTICS_PARAMETER_DESCRIPTORS.find(
		(descriptor) => descriptor.id === parameterId,
	);
}

const descriptorMatchesTarget = (
	descriptor: SourceOpticsParameterDescriptor,
	target: SourceOpticsParameterTarget,
): boolean =>
	(target.kind === "binding" ? "response" : target.kind) === descriptor.owner;

const uniqueRigForTarget = (
	artboard: Pick<Artboard, "sourceOpticsRigs">,
	target: SourceOpticsParameterTarget,
): SourceOpticsRigContract | undefined => {
	const matches = sourceOpticsRigsForArtboard(artboard).filter(
		(rig) => rig.id === target.rigId,
	);
	return matches.length === 1 ? matches[0] : undefined;
};

/** Reads the static value addressed by a Source Optics parameter target. */
export function sourceOpticsParameterValue(
	artboard: Pick<Artboard, "sourceOpticsRigs">,
	target: SourceOpticsParameterTarget,
): number | undefined {
	const descriptor = sourceOpticsParameterDescriptor(target.parameterId);
	if (
		!descriptor?.keyframable ||
		!descriptorMatchesTarget(descriptor, target)
	) {
		return undefined;
	}
	const rig = uniqueRigForTarget(artboard, target);
	if (!rig) return undefined;
	if (target.kind === "rig") {
		switch (target.parameterId) {
			case "source-optics.bloom.radius-x":
				return rig.bloom.radiusX;
			case "source-optics.bloom.radius-y":
				return rig.bloom.radiusY ?? rig.bloom.radiusX;
			case "source-optics.bloom.intensity":
				return rig.bloom.intensity;
			case "source-optics.bloom.threshold":
				return rig.bloom.threshold;
			case "source-optics.atmosphere.mix":
				return rig.atmosphere?.mix;
			case "source-optics.atmosphere.falloff":
				return rig.atmosphere?.falloff;
			case "source-optics.atmosphere.reach":
				return rig.atmosphere?.reach;
			case "source-optics.lens.mix":
				return rig.lens?.mix;
			case "source-optics.lens.chroma":
				return rig.lens?.chroma;
			case "source-optics.lens.reach":
				return rig.lens?.reach;
			default:
				return undefined;
		}
	}
	if (target.kind === "ray") {
		const matches = (rig.rays ?? []).filter((ray) => ray.id === target.rayId);
		const ray = matches.length === 1 ? matches[0] : undefined;
		if (!ray) return undefined;
		switch (target.parameterId) {
			case "source-optics.ray.angle":
				return ray.angle;
			case "source-optics.ray.length":
				return ray.length;
			case "source-optics.ray.width":
				return ray.width;
			case "source-optics.ray.intensity":
				return ray.intensity;
			case "source-optics.ray.falloff":
				return ray.falloff;
			case "source-optics.ray.opposite-side-ratio":
				return ray.oppositeSideRatio;
			default:
				return undefined;
		}
	}
	const matches = rig.responses.filter(
		(response) => response.id === target.bindingId,
	);
	const response = matches.length === 1 ? matches[0] : undefined;
	if (!response) return undefined;
	switch (target.parameterId) {
		case "source-optics.surface.amount":
			return response.surface?.amount;
		case "source-optics.surface.width":
			return response.surface?.width;
		case "source-optics.surface.softness":
			return response.surface?.softness;
		case "source-optics.diffusion.amount":
			return response.diffusion?.amount;
		case "source-optics.diffusion.depth":
			return response.diffusion?.depth;
		case "source-optics.diffusion.softness":
			return response.diffusion?.softness;
		case "source-optics.edge.amount":
			return response.edge?.amount;
		case "source-optics.edge.width":
			return response.edge?.width;
		case "source-optics.edge.softness":
			return response.edge?.softness;
		case "source-optics.microstructure.amount":
			return response.microstructure?.amount;
		case "source-optics.spectral.amount":
			return response.spectral?.amount;
		case "source-optics.spectral.offset":
			return response.spectral?.offset;
		default:
			return undefined;
	}
}

const boundedParameterValue = (
	descriptor: SourceOpticsParameterDescriptor,
	value: number,
): number => clamp(value, descriptor.min, descriptor.max);

const withRigParameterValue = (
	rig: SourceOpticsRigContract,
	target: SourceOpticsParameterTarget,
	value: number,
): SourceOpticsRigContract | null => {
	if (target.kind === "rig") {
		switch (target.parameterId) {
			case "source-optics.bloom.radius-x":
				return normalizeSourceOpticsRig({
					...rig,
					bloom: { ...rig.bloom, radiusX: value },
				});
			case "source-optics.bloom.radius-y":
				return normalizeSourceOpticsRig({
					...rig,
					bloom: { ...rig.bloom, radiusY: value },
				});
			case "source-optics.bloom.intensity":
				return normalizeSourceOpticsRig({
					...rig,
					bloom: { ...rig.bloom, intensity: value },
				});
			case "source-optics.bloom.threshold":
				return normalizeSourceOpticsRig({
					...rig,
					bloom: { ...rig.bloom, threshold: value },
				});
			case "source-optics.atmosphere.mix":
				return rig.atmosphere
					? normalizeSourceOpticsRig({
							...rig,
							atmosphere: { ...rig.atmosphere, mix: value },
						})
					: null;
			case "source-optics.atmosphere.falloff":
				return rig.atmosphere
					? normalizeSourceOpticsRig({
							...rig,
							atmosphere: { ...rig.atmosphere, falloff: value },
						})
					: null;
			case "source-optics.atmosphere.reach":
				return rig.atmosphere
					? normalizeSourceOpticsRig({
							...rig,
							atmosphere: { ...rig.atmosphere, reach: value },
						})
					: null;
			case "source-optics.lens.mix":
				return rig.lens
					? normalizeSourceOpticsRig({
							...rig,
							lens: { ...rig.lens, mix: value },
						})
					: null;
			case "source-optics.lens.chroma":
				return rig.lens
					? normalizeSourceOpticsRig({
							...rig,
							lens: { ...rig.lens, chroma: value },
						})
					: null;
			case "source-optics.lens.reach":
				return rig.lens
					? normalizeSourceOpticsRig({
							...rig,
							lens: { ...rig.lens, reach: value },
						})
					: null;
			default:
				return null;
		}
	}
	if (target.kind === "ray") {
		const rays = rig.rays ?? [];
		if (rays.filter((ray) => ray.id === target.rayId).length !== 1) return null;
		const nextRays = rays.map((ray) => {
			if (ray.id !== target.rayId) return ray;
			switch (target.parameterId) {
				case "source-optics.ray.angle":
					return { ...ray, angle: value };
				case "source-optics.ray.length":
					return { ...ray, length: value };
				case "source-optics.ray.width":
					return { ...ray, width: value };
				case "source-optics.ray.intensity":
					return { ...ray, intensity: value };
				case "source-optics.ray.falloff":
					return { ...ray, falloff: value };
				case "source-optics.ray.opposite-side-ratio":
					return { ...ray, oppositeSideRatio: value };
				default:
					return ray;
			}
		});
		return normalizeSourceOpticsRig({ ...rig, rays: nextRays });
	}
	if (
		rig.responses.filter((response) => response.id === target.bindingId)
			.length !== 1
	) {
		return null;
	}
	const nextResponses = rig.responses.map((response) => {
		if (response.id !== target.bindingId) return response;
		switch (target.parameterId) {
			case "source-optics.surface.amount":
				return response.surface
					? { ...response, surface: { ...response.surface, amount: value } }
					: response;
			case "source-optics.surface.width":
				return response.surface
					? { ...response, surface: { ...response.surface, width: value } }
					: response;
			case "source-optics.surface.softness":
				return response.surface
					? { ...response, surface: { ...response.surface, softness: value } }
					: response;
			case "source-optics.diffusion.amount":
				return response.diffusion
					? {
							...response,
							diffusion: { ...response.diffusion, amount: value },
						}
					: response;
			case "source-optics.diffusion.depth":
				return response.diffusion
					? {
							...response,
							diffusion: { ...response.diffusion, depth: value },
						}
					: response;
			case "source-optics.diffusion.softness":
				return response.diffusion
					? {
							...response,
							diffusion: { ...response.diffusion, softness: value },
						}
					: response;
			case "source-optics.edge.amount":
				return response.edge
					? { ...response, edge: { ...response.edge, amount: value } }
					: response;
			case "source-optics.edge.width":
				return response.edge
					? { ...response, edge: { ...response.edge, width: value } }
					: response;
			case "source-optics.edge.softness":
				return response.edge
					? { ...response, edge: { ...response.edge, softness: value } }
					: response;
			case "source-optics.microstructure.amount":
				return response.microstructure
					? {
							...response,
							microstructure: { ...response.microstructure, amount: value },
						}
					: response;
			case "source-optics.spectral.amount":
				return response.spectral
					? { ...response, spectral: { ...response.spectral, amount: value } }
					: response;
			case "source-optics.spectral.offset":
				return response.spectral
					? { ...response, spectral: { ...response.spectral, offset: value } }
					: response;
			default:
				return response;
		}
	});
	return normalizeSourceOpticsRig({ ...rig, responses: nextResponses });
};

/**
 * Returns a clone-on-change scene with one sampled numeric optical value. The
 * static scene remains untouched; invalid or stale addresses are total no-ops.
 */
export function withSourceOpticsParameterValue(
	document: SceneDocument,
	target: SourceOpticsParameterTarget,
	value: number,
): SceneDocument {
	const descriptor = sourceOpticsParameterDescriptor(target.parameterId);
	if (
		!Number.isFinite(value) ||
		!descriptor?.keyframable ||
		!descriptorMatchesTarget(descriptor, target)
	) {
		return document;
	}
	const updateArtboard = (artboard: Artboard): Artboard => {
		if (artboard.id !== target.artboardId) return artboard;
		const rigs = sourceOpticsRigsForArtboard(artboard);
		if (rigs.filter((rig) => rig.id === target.rigId).length !== 1) {
			return artboard;
		}
		const rig = rigs.find((candidate) => candidate.id === target.rigId);
		if (!rig) return artboard;
		const nextRig = withRigParameterValue(
			rig,
			target,
			boundedParameterValue(descriptor, value),
		);
		if (!nextRig) return artboard;
		return {
			...artboard,
			sourceOpticsRigs: rigs.map((rig) =>
				rig.id === target.rigId ? nextRig : rig,
			),
		};
	};
	const primary = updateArtboard(document.artboard);
	const artboards = document.artboards?.map(updateArtboard);
	const additionalArtboardsUnchanged =
		artboards === undefined ||
		artboards.every((item, index) => item === document.artboards?.[index]);
	if (primary === document.artboard && additionalArtboardsUnchanged) {
		return document;
	}
	return {
		...document,
		artboard: primary,
		...(artboards ? { artboards } : {}),
	};
}

/** Creates a visible but geometry-relative first rig without copying source pixels. */
export function createDefaultSourceOpticsRig(
	sourceNodeId: string,
	bounds: Bounds,
	id = `source-optics-${sourceNodeId}`,
): SourceOpticsRigContract {
	const carrier = Math.max(
		positive(bounds.width, 1),
		positive(bounds.height, 1),
	);
	return {
		id,
		name: "Source optics",
		enabled: true,
		sourceNodeId,
		bloom: {
			enabled: true,
			radiusX: carrier * 4,
			radiusY: carrier * 2,
			intensity: 0.9,
			threshold: 0.65,
			blendMode: "screen",
		},
		rays: [
			{
				id: `${id}-ray-1`,
				enabled: true,
				angle: 0,
				length: carrier * 12,
				width: Math.max(1, carrier * 0.35),
				intensity: 0.38,
				falloff: 0.72,
				oppositeSideRatio: 0.58,
			},
		],
		atmosphere: {
			enabled: true,
			mix: 0.14,
			falloff: 0.76,
			reach: carrier * 20,
		},
		lens: {
			enabled: true,
			mix: 0.12,
			chroma: Math.max(0.5, carrier * 0.08),
			reach: carrier * 4,
		},
		responses: [],
	};
}

type NodeWorldEntry = {
	readonly node: VectorNode;
	readonly matrix: Matrix2D;
	readonly inverse: Matrix2D | null;
	readonly bounds: Bounds;
	readonly center: Vec2;
};

const transformedBounds = (bounds: Bounds, matrix: Matrix2D): Bounds => {
	const points = [
		{ x: bounds.x, y: bounds.y },
		{ x: bounds.x + bounds.width, y: bounds.y },
		{ x: bounds.x + bounds.width, y: bounds.y + bounds.height },
		{ x: bounds.x, y: bounds.y + bounds.height },
	].map((point) => applyMatrixToPoint(matrix, point));
	const xs = points.map((point) => point.x);
	const ys = points.map((point) => point.y);
	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

const nodeWorldEntries = (
	document: SceneDocument,
	artboardId: string,
): ReadonlyMap<string, NodeWorldEntry> => {
	const mapping = selectNodeArtboardMapping(document);
	const entries = new Map<string, NodeWorldEntry>();
	const walk = (node: VectorNode, parent: Matrix2D): void => {
		const matrix = composeMatrix(parent, matrixFromTransform(node.transform));
		if (mapping.byNodeId[node.id] === artboardId) {
			const localBounds = getNodeLocalBounds(node);
			const bounds = transformedBounds(localBounds, matrix);
			entries.set(node.id, {
				node,
				matrix,
				inverse: invertMatrix(matrix),
				bounds,
				center: {
					x: bounds.x + bounds.width / 2,
					y: bounds.y + bounds.height / 2,
				},
			});
		}
		for (const child of node.children ?? []) walk(child, matrix);
	};
	for (const layer of document.layers) {
		if (!layer.visible) continue;
		for (const node of layer.nodes) walk(node, IDENTITY_MATRIX);
	}
	return entries;
};

const unit = (vector: Vec2): Vec2 => {
	const length = Math.hypot(vector.x, vector.y);
	return length > EPSILON
		? { x: vector.x / length, y: vector.y / length }
		: { x: 0, y: -1 };
};

const localDirection = (entry: NodeWorldEntry, worldDirection: Vec2): Vec2 => {
	if (!entry.inverse) return unit(worldDirection);
	const origin = applyMatrixToPoint(entry.inverse, { x: 0, y: 0 });
	const endpoint = applyMatrixToPoint(entry.inverse, worldDirection);
	return unit({ x: endpoint.x - origin.x, y: endpoint.y - origin.y });
};

const fieldForDirection = (direction: Vec2): EffectMaskSource => ({
	kind: "linearGradient",
	space: "objectBoundingBox",
	x1: 0.5 + direction.x * 0.5,
	y1: 0.5 + direction.y * 0.5,
	x2: 0.5 - direction.x * 0.5,
	y2: 0.5 - direction.y * 0.5,
	stops: [
		{ offset: 0, alpha: 1 },
		{ offset: 0.42, alpha: 0.72 },
		{ offset: 1, alpha: 0 },
	],
});

const sourceOpticsFidelity = (
	surface: EffectFieldRenderSurface,
): EffectFieldFidelity => {
	switch (surface) {
		case "editor-svg":
		case "svg-export":
		case "worker-svg":
			return { status: "native" };
		case "webm-capture":
			return {
				status: "capture-only",
				reason: "Source Optics is preserved through the SVG capture surface.",
			};
		case "runtime-svg":
			return { status: "native" };
		case "webgl":
			return {
				status: "deferred",
				reason: "The direct GPU display list has no Source Optics pass.",
			};
		case "webgpu":
			return { status: "native" };
	}
};

/**
 * Generic field adapter descriptor for Source Optics target-response wet mix.
 * It remains rig-owned instead of appearing in the ordinary node Effect Field
 * picker, where no source relationship would exist to resolve.
 */
export const SOURCE_OPTICS_FIELD_TARGET_DESCRIPTOR = {
	id: "source-optics.response-field",
	effectPath: "source-optics.response-field",
	label: "Source optics response field",
	owner: "presentation",
	targetScopes: ["object", "group"],
	coordinateSpaces: ["target", "objectBoundingBox"],
	unit: "normalized",
	range: [0, 1],
	neutralValue: 1,
	operator: "effect-wet-mix",
	eligibleSourceKinds: [
		"fullFrame",
		"rect",
		"ellipse",
		"polygon",
		"linearGradient",
		"radialGradient",
		"contourGradient",
		"fieldMesh",
		"proceduralNoise",
		"stack",
	],
	outwardPadding: { kind: "owner-defined" },
	keyframable: false,
	support: {
		"editor-svg": /* @__PURE__ */ sourceOpticsFidelity("editor-svg"),
		"svg-export": /* @__PURE__ */ sourceOpticsFidelity("svg-export"),
		"worker-svg": /* @__PURE__ */ sourceOpticsFidelity("worker-svg"),
		"runtime-svg": /* @__PURE__ */ sourceOpticsFidelity("runtime-svg"),
		webgl: /* @__PURE__ */ sourceOpticsFidelity("webgl"),
		webgpu: /* @__PURE__ */ sourceOpticsFidelity("webgpu"),
		"webm-capture": /* @__PURE__ */ sourceOpticsFidelity("webm-capture"),
	},
} as const satisfies EffectFieldTargetDescriptor;

const fieldRoute = (options: {
	readonly rigId: string;
	readonly assignmentId: string;
	readonly nodeId: string;
	readonly fieldId?: string;
	readonly source: EffectMaskSource;
	readonly surface: EffectFieldRenderSurface;
	readonly strength: number;
}): EffectFieldRoutePlan => ({
	assignmentId: options.assignmentId,
	...(options.fieldId ? { fieldId: options.fieldId } : {}),
	target: { scope: "object", id: options.nodeId },
	effect: {
		id: SOURCE_OPTICS_FIELD_TARGET_DESCRIPTOR.id,
		path: SOURCE_OPTICS_FIELD_TARGET_DESCRIPTOR.effectPath,
		label: SOURCE_OPTICS_FIELD_TARGET_DESCRIPTOR.label,
	},
	descriptorId: SOURCE_OPTICS_FIELD_TARGET_DESCRIPTOR.id,
	operator: SOURCE_OPTICS_FIELD_TARGET_DESCRIPTOR.operator,
	source: options.source,
	sourceOrigin: options.fieldId ? "shared-field" : "inline",
	influence: {
		enabled: true,
		source: options.source,
		strength: clamp01(options.strength),
		invert: false,
		featherRadius: 0,
		falloff: {
			kind: "smoothstep",
			inputMin: 0,
			inputMax: 1,
			gamma: 1,
			softness: 0.2,
		},
	},
	surface: options.surface,
	fidelity: sourceOpticsFidelity(options.surface),
	routeKey: `${options.nodeId}|${options.rigId}|source-optics`,
});

export type SourceOpticsIssueCode =
	| "duplicate-rig-id"
	| "duplicate-source-owner"
	| "source-node-missing"
	| "source-node-hidden"
	| "source-node-wrong-artboard"
	| "duplicate-response-id"
	| "duplicate-target-owner"
	| "target-node-missing"
	| "target-node-hidden"
	| "target-node-wrong-artboard"
	| "source-target-cycle"
	| "field-reference-missing"
	| "field-reference-ambiguous"
	| "field-space-unsupported"
	| "resource-budget-clamped";

export type SourceOpticsIssue = {
	readonly code: SourceOpticsIssueCode;
	readonly rigId?: string;
	readonly bindingId?: string;
	readonly nodeId?: string;
	readonly detail: string;
};

export type SourceOpticsSourcePlan = {
	readonly rigId: string;
	readonly sourceNodeId: string;
	readonly sourceCenter: Vec2;
	readonly bloom: SourceOpticsBloomContract;
	readonly rays: readonly SourceOpticsRayContract[];
	readonly atmosphere?: SourceOpticsAtmosphereContract;
	readonly atmosphereDirection: Vec2;
	readonly atmosphereFieldRoute?: EffectFieldRoutePlan;
	readonly lens?: SourceOpticsLensContract;
	readonly outwardReach: number;
	readonly fidelity: EffectFieldFidelity;
};

export type SourceOpticsTargetPlan = {
	readonly rigId: string;
	readonly binding: SourceOpticsResponseBinding;
	readonly targetNodeId: string;
	readonly sourceCenter: Vec2;
	readonly targetCenter: Vec2;
	readonly sourceDirection: Vec2;
	readonly fieldRoute: EffectFieldRoutePlan;
	readonly hasExistingMicrostructure: boolean;
	readonly fidelity: EffectFieldFidelity;
};

export type SourceOpticsNodePlan = {
	readonly source?: SourceOpticsSourcePlan;
	readonly target?: SourceOpticsTargetPlan;
};

export type SourceOpticsPresentation = {
	readonly artboardId: string;
	readonly sourcePlans: readonly SourceOpticsSourcePlan[];
	readonly targetPlans: readonly SourceOpticsTargetPlan[];
	readonly nodePlans: Readonly<Record<string, SourceOpticsNodePlan>>;
	readonly issues: readonly SourceOpticsIssue[];
};

/**
 * Projects a resolved Source Optics presentation down to target-owned surface
 * consequences for a specific node set. This is the emission-safe view used
 * when another optical effect must see material-facing Surface, Diffusion,
 * Edge, and Spectral responses without also ingesting source-owned Bloom, Ray,
 * Atmosphere, or Lens pixels as new emitters.
 */
export function sourceOpticsTargetResponsePresentation(
	presentation: SourceOpticsPresentation,
	targetNodeIds: ReadonlySet<string>,
): SourceOpticsPresentation {
	const targetPlans = presentation.targetPlans.filter((plan) =>
		targetNodeIds.has(plan.targetNodeId),
	);
	const nodePlans = Object.fromEntries(
		targetPlans.map((target) => [target.targetNodeId, { target }]),
	);
	return {
		...presentation,
		sourcePlans: [],
		targetPlans,
		nodePlans,
	};
}

const sourceOpticsPresentationCache = new WeakMap<
	SceneDocument,
	Map<string, SourceOpticsPresentation>
>();

/** True when a target already owns texture that response coupling may reuse. */
export const sourceOpticsTargetHasMicrostructure = (
	node: VectorNode,
): boolean =>
	Boolean(
		node.recipe?.texture?.grain?.enabled ||
			node.recipe?.texture?.material?.mode === "density" ||
			node.recipe?.texture?.material?.mode === "particle" ||
			node.recipe?.texture?.material?.mode === "mixed",
	);

/**
 * Resolves one sampled scene into renderer-neutral source and target plans.
 * The resolver is pure: no helper nodes, Look graphs, or sampled parameters are
 * written back into the document.
 */
export function buildSourceOpticsPresentation(
	document: SceneDocument,
	artboardId: string | null | undefined,
	surface: EffectFieldRenderSurface,
): SourceOpticsPresentation {
	const artboard =
		findArtboardById(document, artboardId) ?? selectCurrentArtboard(document);
	const cacheKey = `${artboard.id}:${surface}`;
	let documentCache = sourceOpticsPresentationCache.get(document);
	const cached = documentCache?.get(cacheKey);
	if (cached) return cached;
	if (!documentCache) {
		documentCache = new Map<string, SourceOpticsPresentation>();
		sourceOpticsPresentationCache.set(document, documentCache);
	}
	const rigs = sourceOpticsRigsForArtboard(artboard).filter(
		(rig) => rig.enabled,
	);
	const presentationDistanceBudget = Math.max(
		1,
		Math.hypot(artboard.width, artboard.height) * 2,
	);
	const entries = nodeWorldEntries(document, artboard.id);
	const issues: SourceOpticsIssue[] = [];
	const sourcePlans: SourceOpticsSourcePlan[] = [];
	const targetPlans: SourceOpticsTargetPlan[] = [];
	const nodePlans: Record<string, SourceOpticsNodePlan> = {};
	const rigCounts = new Map<string, number>();
	const sourceCounts = new Map<string, number>();
	const targetCounts = new Map<string, number>();
	for (const rig of rigs) {
		rigCounts.set(rig.id, (rigCounts.get(rig.id) ?? 0) + 1);
		sourceCounts.set(
			rig.sourceNodeId,
			(sourceCounts.get(rig.sourceNodeId) ?? 0) + 1,
		);
		for (const binding of rig.responses.filter(
			(response) => response.enabled,
		)) {
			targetCounts.set(
				binding.targetNodeId,
				(targetCounts.get(binding.targetNodeId) ?? 0) + 1,
			);
		}
	}

	const resolvedIntent = resolveFrameEffectIntent(document, artboard.id);
	const fields = resolvedIntent.influenceRecipe?.fields ?? [];
	const resolveField = (
		fieldId: string | undefined,
		fallback: EffectMaskSource,
		rigId: string,
		bindingId?: string,
	): { readonly source: EffectMaskSource; readonly fieldId?: string } => {
		if (!fieldId) return { source: fallback };
		const matches = fields.filter((field) => field.id === fieldId);
		if (matches.length !== 1) {
			issues.push({
				code:
					matches.length === 0
						? "field-reference-missing"
						: "field-reference-ambiguous",
				rigId,
				...(bindingId ? { bindingId } : {}),
				detail:
					matches.length === 0
						? `Shared Effect Field "${fieldId}" is missing; the derived source-relative field is retained.`
						: `Shared Effect Field "${fieldId}" is duplicated; the derived source-relative field is retained.`,
			});
			return { source: fallback };
		}
		const source = matches[0]?.source;
		if (!source || source.space === "scene") {
			issues.push({
				code: "field-space-unsupported",
				rigId,
				...(bindingId ? { bindingId } : {}),
				detail: `Source Optics currently requires target/objectBoundingBox field space; "${fieldId}" remains stored but is not applied.`,
			});
			return { source: fallback };
		}
		return { source, fieldId };
	};

	for (const rig of rigs) {
		if ((rigCounts.get(rig.id) ?? 0) > 1) {
			issues.push({
				code: "duplicate-rig-id",
				rigId: rig.id,
				detail: `Source Optics rig id "${rig.id}" is duplicated; none of its contributions were applied.`,
			});
			continue;
		}
		if ((sourceCounts.get(rig.sourceNodeId) ?? 0) > 1) {
			issues.push({
				code: "duplicate-source-owner",
				rigId: rig.id,
				nodeId: rig.sourceNodeId,
				detail: `Source node "${rig.sourceNodeId}" has more than one active rig.`,
			});
			continue;
		}
		const sourceEntry = entries.get(rig.sourceNodeId);
		if (!sourceEntry) {
			issues.push({
				code: "source-node-missing",
				rigId: rig.id,
				nodeId: rig.sourceNodeId,
				detail: `Source node "${rig.sourceNodeId}" is missing or belongs to another artboard.`,
			});
			continue;
		}
		if (!sourceEntry.node.visible) {
			issues.push({
				code: "source-node-hidden",
				rigId: rig.id,
				nodeId: rig.sourceNodeId,
				detail: `Source node "${rig.sourceNodeId}" is hidden.`,
			});
			continue;
		}
		let resourceBudgetClamped = false;
		const boundedDistance = (value: number): number => {
			const bounded = Math.min(value, presentationDistanceBudget);
			if (bounded !== value) resourceBudgetClamped = true;
			return bounded;
		};
		const bloom: SourceOpticsBloomContract = {
			...rig.bloom,
			radiusX: boundedDistance(rig.bloom.radiusX),
			...(rig.bloom.radiusY !== undefined
				? { radiusY: boundedDistance(rig.bloom.radiusY) }
				: {}),
		};
		const atmosphere = rig.atmosphere
			? { ...rig.atmosphere, reach: boundedDistance(rig.atmosphere.reach) }
			: undefined;
		const lens = rig.lens
			? {
					...rig.lens,
					chroma: boundedDistance(rig.lens.chroma),
					reach: boundedDistance(rig.lens.reach),
				}
			: undefined;
		const artboardCenter = { x: artboard.width / 2, y: artboard.height / 2 };
		const atmosphereDirection = localDirection(sourceEntry, {
			x: artboardCenter.x - sourceEntry.center.x,
			y: artboardCenter.y - sourceEntry.center.y,
		});
		const atmosphereField = atmosphere
			? resolveField(
					atmosphere.fieldId,
					fieldForDirection(atmosphereDirection),
					rig.id,
				)
			: null;
		const rays = (rig.rays ?? [])
			.filter((ray) => ray.enabled)
			.map((ray) => {
				const radians = (ray.angle * Math.PI) / 180;
				const direction = localDirection(sourceEntry, {
					x: Math.cos(radians),
					y: Math.sin(radians),
				});
				return {
					...ray,
					length: boundedDistance(ray.length),
					width: boundedDistance(ray.width),
					angle: normalizedAngle(
						(Math.atan2(direction.y, direction.x) * 180) / Math.PI,
					),
				};
			});
		const outwardReach = Math.max(
			bloom.enabled
				? Math.max(bloom.radiusX, bloom.radiusY ?? bloom.radiusX) * 3
				: 0,
			...rays.map((ray) => ray.length),
			atmosphere?.enabled ? atmosphere.reach : 0,
			lens?.enabled ? lens.reach : 0,
		);
		const sourcePlan: SourceOpticsSourcePlan = {
			rigId: rig.id,
			sourceNodeId: rig.sourceNodeId,
			sourceCenter: sourceEntry.center,
			bloom,
			rays,
			...(atmosphere ? { atmosphere } : {}),
			atmosphereDirection,
			...(atmosphere && atmosphereField
				? {
						atmosphereFieldRoute: fieldRoute({
							rigId: rig.id,
							assignmentId: `${rig.id}:atmosphere`,
							nodeId: rig.sourceNodeId,
							fieldId: atmosphereField.fieldId,
							source: atmosphereField.source,
							surface,
							strength: atmosphere.mix,
						}),
					}
				: {}),
			...(lens ? { lens } : {}),
			outwardReach,
			fidelity: sourceOpticsFidelity(surface),
		};
		sourcePlans.push(sourcePlan);
		nodePlans[rig.sourceNodeId] = {
			...nodePlans[rig.sourceNodeId],
			source: sourcePlan,
		};

		const responseCounts = new Map<string, number>();
		for (const response of rig.responses.filter((entry) => entry.enabled)) {
			responseCounts.set(
				response.id,
				(responseCounts.get(response.id) ?? 0) + 1,
			);
		}
		for (const binding of rig.responses.filter((entry) => entry.enabled)) {
			if ((responseCounts.get(binding.id) ?? 0) > 1) {
				issues.push({
					code: "duplicate-response-id",
					rigId: rig.id,
					bindingId: binding.id,
					detail: `Response id "${binding.id}" is duplicated within rig "${rig.id}".`,
				});
				continue;
			}
			if ((targetCounts.get(binding.targetNodeId) ?? 0) > 1) {
				issues.push({
					code: "duplicate-target-owner",
					rigId: rig.id,
					bindingId: binding.id,
					nodeId: binding.targetNodeId,
					detail: `Target node "${binding.targetNodeId}" has more than one active Source Optics owner.`,
				});
				continue;
			}
			if (binding.targetNodeId === rig.sourceNodeId) {
				issues.push({
					code: "source-target-cycle",
					rigId: rig.id,
					bindingId: binding.id,
					nodeId: binding.targetNodeId,
					detail: "A source node cannot also be its own response target in V1.",
				});
				continue;
			}
			const targetEntry = entries.get(binding.targetNodeId);
			if (!targetEntry) {
				issues.push({
					code: "target-node-missing",
					rigId: rig.id,
					bindingId: binding.id,
					nodeId: binding.targetNodeId,
					detail: `Target node "${binding.targetNodeId}" is missing or belongs to another artboard.`,
				});
				continue;
			}
			if (!targetEntry.node.visible) {
				issues.push({
					code: "target-node-hidden",
					rigId: rig.id,
					bindingId: binding.id,
					nodeId: binding.targetNodeId,
					detail: `Target node "${binding.targetNodeId}" is hidden.`,
				});
				continue;
			}
			const sourceDirection = localDirection(targetEntry, {
				x: sourceEntry.center.x - targetEntry.center.x,
				y: sourceEntry.center.y - targetEntry.center.y,
			});
			const boundedBinding: SourceOpticsResponseBinding = {
				...binding,
				...(binding.surface
					? {
							surface: {
								...binding.surface,
								width: boundedDistance(binding.surface.width),
								softness: boundedDistance(binding.surface.softness),
							},
						}
					: {}),
				...(binding.diffusion
					? {
							diffusion: {
								...binding.diffusion,
								depth: boundedDistance(binding.diffusion.depth),
								softness: boundedDistance(binding.diffusion.softness),
							},
						}
					: {}),
				...(binding.edge
					? {
							edge: {
								...binding.edge,
								width: boundedDistance(binding.edge.width),
								softness: boundedDistance(binding.edge.softness),
							},
						}
					: {}),
				...(binding.spectral
					? {
							spectral: {
								...binding.spectral,
								offset: boundedDistance(binding.spectral.offset),
							},
						}
					: {}),
			};
			const field = resolveField(
				binding.fieldId,
				fieldForDirection(sourceDirection),
				rig.id,
				binding.id,
			);
			const targetPlan: SourceOpticsTargetPlan = {
				rigId: rig.id,
				binding: boundedBinding,
				targetNodeId: binding.targetNodeId,
				sourceCenter: sourceEntry.center,
				targetCenter: targetEntry.center,
				sourceDirection,
				fieldRoute: fieldRoute({
					rigId: rig.id,
					assignmentId: binding.id,
					nodeId: binding.targetNodeId,
					fieldId: field.fieldId,
					source: field.source,
					surface,
					strength: 1,
				}),
				hasExistingMicrostructure: sourceOpticsTargetHasMicrostructure(
					targetEntry.node,
				),
				fidelity: sourceOpticsFidelity(surface),
			};
			targetPlans.push(targetPlan);
			nodePlans[binding.targetNodeId] = {
				...nodePlans[binding.targetNodeId],
				target: targetPlan,
			};
		}
		if (resourceBudgetClamped) {
			issues.push({
				code: "resource-budget-clamped",
				rigId: rig.id,
				detail: `Source Optics presentation distances were bounded to ${presentationDistanceBudget.toFixed(2)} artboard units for this surface. Authored values remain unchanged.`,
			});
		}
	}

	const presentation = {
		artboardId: artboard.id,
		sourcePlans,
		targetPlans,
		nodePlans,
		issues,
	};
	documentCache.set(cacheKey, presentation);
	return presentation;
}
