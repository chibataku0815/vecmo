/**
 * SVG `<defs>` generators for artboard frame looks — film grain, chromatic
 * aberration, and look-graph influence masks — plus the small spec/region
 * helpers they and the canvas render share. Pure presentational SVG extracted
 * verbatim from `CanvasShell` (see `docs/canvas-shell-decomposition-plan.md`);
 * the shared `rotationDegrees` lives in `model/camera-transform`.
 */
import { useMemo } from "react";
import type { EffectFilterSpec } from "@/entities/scene/model/effect-filter";
import {
	compileLookGraph,
	lookGraphPlanToEffectFilter,
} from "@/entities/scene/model/look-graph-compile";
import { resolveFrameEffectIntent } from "@/entities/scene/model/recipe-resolve";
import type { NormalizedArtboard } from "@/entities/scene/model/selectors";
import type {
	Bounds,
	SceneDocument,
	VectorNode,
} from "@/entities/scene/model/types";
import {
	type ChromaticAberrationParams,
	DEFAULT_FILM_GRAIN_TEXTURE_HEIGHT,
	type EffectMaskSource,
	encodeGrainOverlayRgba,
	type FilmGrainParams,
	grainSampleField,
} from "@/shared/vec-core";
import { artboardLookSvgIdSegment as svgIdSegment } from "@/widgets/canvas-shell/model/artboard-look-plan";
import { rotationDegrees } from "@/widgets/canvas-shell/model/camera-transform";
import type { FrameLookInfluenceMaskPlan } from "@/widgets/canvas-shell/model/frame-look-influence";
import { MaskSilhouette } from "./SvgSceneNode";

const FRAME_GRAIN_OBJECT_RAMP_LOW = 0.2;
const FRAME_GRAIN_OBJECT_RAMP_HIGH = 0.5;
const FRAME_CA_MAP_MAX_SIZE = 96;

const clampByte = (value: number): number =>
	Math.round(Math.min(Math.max(value, 0), 255));

const frameFilmGrainTextureSize = (
	size: Pick<Bounds, "width" | "height">,
): { readonly width: number; readonly height: number } => {
	const regionHeight = Math.max(1, size.height);
	const height = DEFAULT_FILM_GRAIN_TEXTURE_HEIGHT;
	return {
		width: Math.max(1, Math.round((height * size.width) / regionHeight)),
		height,
	};
};

export const fullFrameLookRegion = (
	artboard: NormalizedArtboard,
	padding: number,
): Bounds => ({
	x: -padding,
	y: -padding,
	width: artboard.width + padding * 2,
	height: artboard.height + padding * 2,
});

/**
 * Compiles only an authored explicit frame Look graph for canvas rendering.
 * Projected stack/visualRecipe graphs stay on the legacy high-fidelity canvas path
 * so existing Analog Film looks are not downgraded into the SVG approximation path.
 */
export const explicitFrameLookGraphFilterSpec = (
	document: SceneDocument,
	artboard: NormalizedArtboard,
	artboardIndex: number,
): EffectFilterSpec | null => {
	const lookGraph = resolveFrameEffectIntent(document, artboard.id).lookGraph;
	if (!lookGraph) return null;
	const plan = compileLookGraph(lookGraph, {
		owner: { scope: "artboard", artboardId: artboard.id },
		bounds: {
			x: 0,
			y: 0,
			width: artboard.width,
			height: artboard.height,
		},
	});
	return lookGraphPlanToEffectFilter(plan, {
		id: `vecmo-frame-look-graph-${svgIdSegment(artboard.id)}-${artboardIndex}`,
		bounds: {
			x: 0,
			y: 0,
			width: artboard.width,
			height: artboard.height,
		},
	});
};

const createFilmGrainOverlayDataUrl = ({
	frame,
	seed,
	seedNamespace,
	strength,
	width,
	height,
}: {
	readonly frame: number;
	readonly seed: number;
	readonly seedNamespace: string;
	readonly strength: number;
	readonly width: number;
	readonly height: number;
}): string => {
	const temporalSeed = `${seedNamespace}-g${seed}-${frame}`;
	const data = encodeGrainOverlayRgba(
		grainSampleField(temporalSeed, width, height, strength),
	);
	if (typeof document !== "undefined") {
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext("2d");
		if (context) {
			context.putImageData(
				new ImageData(new Uint8ClampedArray(data), width, height),
				0,
				0,
			);
			return canvas.toDataURL("image/png");
		}
	}

	const rects = Array.from({ length: height }, (_, y) =>
		Array.from({ length: width }, (_, x) => {
			const index = (y * width + x) * 4;
			const alpha = data[index + 3] / 255;
			if (alpha <= 0) return "";
			return `<rect x="${x}" y="${y}" width="1" height="1" fill="rgb(${data[index]} ${data[index + 1]} ${data[index + 2]})" opacity="${alpha}"/>`;
		}).join(""),
	).join("");
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">${rects}</svg>`,
	)}`;
};

export function FrameFilmGrainDefs({
	id,
	params,
	frame,
	region,
	coverage,
}: {
	readonly id: string;
	readonly params: FilmGrainParams;
	readonly frame: number;
	readonly region: Bounds;
	readonly coverage: "frame" | "source";
}) {
	const regionX = region.x;
	const regionY = region.y;
	const regionWidth = region.width;
	const regionHeight = region.height;
	const textureSize = frameFilmGrainTextureSize(region);
	const { backgroundWeight, objectWeight, seed, seedNamespace, strength } =
		params;
	const href = useMemo(
		() =>
			createFilmGrainOverlayDataUrl({
				frame,
				seed,
				seedNamespace,
				strength,
				width: textureSize.width,
				height: textureSize.height,
			}),
		[
			frame,
			seed,
			seedNamespace,
			strength,
			textureSize.height,
			textureSize.width,
		],
	);
	const objectExtraWeight = Math.max(0, objectWeight - backgroundWeight);
	const rampWidth = FRAME_GRAIN_OBJECT_RAMP_HIGH - FRAME_GRAIN_OBJECT_RAMP_LOW;
	const objectRampSlope = rampWidth > 0 ? 1 / rampWidth : 1;
	const objectRampIntercept =
		rampWidth > 0 ? -FRAME_GRAIN_OBJECT_RAMP_LOW / rampWidth : 0;
	const backgroundCompositeResult =
		coverage === "source"
			? "grain-background-unclipped"
			: "grain-with-background";
	const grainOutputInput =
		coverage === "source" ? "grain-output-unclipped" : "grain-output";
	return (
		<filter
			id={id}
			filterUnits="userSpaceOnUse"
			x={regionX}
			y={regionY}
			width={regionWidth}
			height={regionHeight}
			colorInterpolationFilters="sRGB"
		>
			<feImage
				href={href}
				x={regionX}
				y={regionY}
				width={regionWidth}
				height={regionHeight}
				preserveAspectRatio="none"
				result="grain-source"
			/>
			<feComponentTransfer in="grain-source" result="grain-background">
				<feFuncA type="linear" slope={backgroundWeight} />
			</feComponentTransfer>
			<feColorMatrix
				type="matrix"
				in="SourceGraphic"
				values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -0.299 -0.587 -0.114 0 1"
				result="grain-darkness"
			/>
			<feComponentTransfer in="grain-darkness" result="grain-object-mask">
				<feFuncA
					type="linear"
					slope={objectRampSlope}
					intercept={objectRampIntercept}
				/>
			</feComponentTransfer>
			<feComponentTransfer in="grain-source" result="grain-object-source">
				<feFuncA type="linear" slope={objectExtraWeight} />
			</feComponentTransfer>
			<feComposite
				operator="in"
				in="grain-object-source"
				in2="grain-object-mask"
				result="grain-object"
			/>
			<feComposite
				operator="over"
				in="grain-background"
				in2="SourceGraphic"
				result={backgroundCompositeResult}
			/>
			{coverage === "source" ? (
				<feComposite
					operator="in"
					in="grain-background-unclipped"
					in2="SourceAlpha"
					result="grain-with-background"
				/>
			) : null}
			<feComposite
				operator="over"
				in="grain-object"
				in2="grain-with-background"
				result={grainOutputInput}
			/>
			{coverage === "source" ? (
				<feComposite
					operator="in"
					in="grain-output-unclipped"
					in2="SourceAlpha"
					result="grain-output"
				/>
			) : null}
		</filter>
	);
}

const chromaticAberrationMapSize = (
	width: number,
	height: number,
): { readonly width: number; readonly height: number } => {
	const w = Math.max(1, width);
	const h = Math.max(1, height);
	if (w >= h) {
		return {
			width: FRAME_CA_MAP_MAX_SIZE,
			height: Math.max(2, Math.round(FRAME_CA_MAP_MAX_SIZE * (h / w))),
		};
	}
	return {
		width: Math.max(2, Math.round(FRAME_CA_MAP_MAX_SIZE * (w / h))),
		height: FRAME_CA_MAP_MAX_SIZE,
	};
};

const chromaticMapChannel = (
	value: number,
	direction: "inward" | "outward",
): number => (direction === "outward" ? 0.5 + value : 0.5 - value);

/**
 * Builds the displacement map consumed by the editor SVG filter. The map stores
 * the same radial field used by vec-core's CPU pass: displacement is proportional
 * to `(pixel - opticalCenter) / halfDiagonal`, so `feDisplacementMap` with
 * `scale = 2 * fringing * maxShiftPx` reproduces the original R/B sample offsets.
 */
const createChromaticAberrationDisplacementMap = ({
	artboardWidth,
	artboardHeight,
	regionX,
	regionY,
	regionWidth,
	regionHeight,
	params,
	direction,
}: {
	readonly artboardWidth: number;
	readonly artboardHeight: number;
	readonly regionX: number;
	readonly regionY: number;
	readonly regionWidth: number;
	readonly regionHeight: number;
	readonly params: ChromaticAberrationParams;
	readonly direction: "inward" | "outward";
}): string => {
	const size = chromaticAberrationMapSize(regionWidth, regionHeight);
	const data = new Uint8ClampedArray(size.width * size.height * 4);
	const cx = params.centerX * (artboardWidth - 1);
	const cy = params.centerY * (artboardHeight - 1);
	const refDist = Math.sqrt(cx * cx + cy * cy) || 1;

	for (let y = 0; y < size.height; y += 1) {
		const artboardY =
			size.height <= 1
				? regionY
				: regionY + (y / (size.height - 1)) * regionHeight;
		for (let x = 0; x < size.width; x += 1) {
			const artboardX =
				size.width <= 1
					? regionX
					: regionX + (x / (size.width - 1)) * regionWidth;
			const dx = (artboardX - cx) / (2 * refDist);
			const dy = (artboardY - cy) / (2 * refDist);
			const index = (y * size.width + x) * 4;
			data[index] = clampByte(chromaticMapChannel(dx, direction) * 255);
			data[index + 1] = clampByte(chromaticMapChannel(dy, direction) * 255);
			data[index + 2] = 128;
			data[index + 3] = 255;
		}
	}

	if (typeof document !== "undefined") {
		const canvas = document.createElement("canvas");
		canvas.width = size.width;
		canvas.height = size.height;
		const context = canvas.getContext("2d");
		if (context) {
			context.putImageData(new ImageData(data, size.width, size.height), 0, 0);
			return canvas.toDataURL("image/png");
		}
	}

	const rects = Array.from({ length: size.height }, (_, y) =>
		Array.from({ length: size.width }, (_, x) => {
			const index = (y * size.width + x) * 4;
			return `<rect x="${x}" y="${y}" width="1" height="1" fill="rgb(${data[index]} ${data[index + 1]} ${data[index + 2]})"/>`;
		}).join(""),
	).join("");
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}" shape-rendering="crispEdges">${rects}</svg>`,
	)}`;
};

export function FrameChromaticAberrationDefs({
	id,
	artboard,
	params,
	region,
	coverage,
}: {
	readonly id: string;
	readonly artboard: NormalizedArtboard;
	readonly params: ChromaticAberrationParams;
	readonly region: Bounds;
	readonly coverage: "frame" | "source";
}) {
	const { centerX, centerY, fringing, maxShiftPx } = params;
	const regionX = region.x;
	const regionY = region.y;
	const regionWidth = region.width;
	const regionHeight = region.height;
	const maps = useMemo(
		() => ({
			inward: createChromaticAberrationDisplacementMap({
				artboardWidth: artboard.width,
				artboardHeight: artboard.height,
				regionX,
				regionY,
				regionWidth,
				regionHeight,
				params: { centerX, centerY, fringing, maxShiftPx },
				direction: "inward",
			}),
			outward: createChromaticAberrationDisplacementMap({
				artboardWidth: artboard.width,
				artboardHeight: artboard.height,
				regionX,
				regionY,
				regionWidth,
				regionHeight,
				params: { centerX, centerY, fringing, maxShiftPx },
				direction: "outward",
			}),
		}),
		[
			artboard.width,
			artboard.height,
			regionX,
			regionY,
			regionWidth,
			regionHeight,
			centerX,
			centerY,
			fringing,
			maxShiftPx,
		],
	);
	const scale = fringing * maxShiftPx * 2;
	const keepAlpha = "0 0 0 1 0";
	return (
		<filter
			id={id}
			filterUnits="userSpaceOnUse"
			x={regionX}
			y={regionY}
			width={regionWidth}
			height={regionHeight}
			colorInterpolationFilters="sRGB"
		>
			<feImage
				href={maps.inward}
				x={regionX}
				y={regionY}
				width={regionWidth}
				height={regionHeight}
				preserveAspectRatio="none"
				result="ca-inward-map"
			/>
			<feImage
				href={maps.outward}
				x={regionX}
				y={regionY}
				width={regionWidth}
				height={regionHeight}
				preserveAspectRatio="none"
				result="ca-outward-map"
			/>
			<feColorMatrix
				type="matrix"
				in="SourceGraphic"
				values={`1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${keepAlpha}`}
				result="ca-red"
			/>
			<feDisplacementMap
				in="ca-red"
				in2="ca-inward-map"
				scale={scale}
				xChannelSelector="R"
				yChannelSelector="G"
				result="ca-red-shifted"
			/>
			<feColorMatrix
				type="matrix"
				in="SourceGraphic"
				values={`0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 ${keepAlpha}`}
				result="ca-green"
			/>
			<feColorMatrix
				type="matrix"
				in="SourceGraphic"
				values={`0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 ${keepAlpha}`}
				result="ca-blue"
			/>
			<feDisplacementMap
				in="ca-blue"
				in2="ca-outward-map"
				scale={scale}
				xChannelSelector="R"
				yChannelSelector="G"
				result="ca-blue-shifted"
			/>
			<feBlend
				mode="screen"
				in="ca-red-shifted"
				in2="ca-green"
				result="ca-rg"
			/>
			<feBlend mode="screen" in="ca-rg" in2="ca-blue-shifted" result="ca-rgb" />
			{coverage === "source" ? (
				<feComposite operator="in" in="ca-rgb" in2="SourceAlpha" />
			) : null}
		</filter>
	);
}

const maskCoordX = (
	value: number,
	source: EffectMaskSource,
	artboard: NormalizedArtboard,
): number => (source.space === "scene" ? value : value * artboard.width);

const maskCoordY = (
	value: number,
	source: EffectMaskSource,
	artboard: NormalizedArtboard,
): number => (source.space === "scene" ? value : value * artboard.height);

const maskLengthX = (
	value: number,
	source: EffectMaskSource,
	artboard: NormalizedArtboard,
): number => (source.space === "scene" ? value : value * artboard.width);

const maskLengthY = (
	value: number,
	source: EffectMaskSource,
	artboard: NormalizedArtboard,
): number => (source.space === "scene" ? value : value * artboard.height);

const maskStops = (
	stops: readonly { readonly offset: number; readonly alpha: number }[],
	color: "black" | "white",
) =>
	stops.map((stop) => (
		<stop
			key={`${stop.offset}:${stop.alpha}`}
			offset={`${Math.min(Math.max(stop.offset, 0), 1) * 100}%`}
			stopColor={color}
			stopOpacity={Math.min(Math.max(stop.alpha, 0), 1)}
		/>
	));

function FrameLookMatteSource({
	source,
	nodesByRefId,
	color,
	opacity,
}: {
	readonly source: EffectMaskSource;
	readonly nodesByRefId: ReadonlyMap<string, VectorNode>;
	readonly color: "black" | "white";
	readonly opacity: number;
}) {
	switch (source.kind) {
		case "svgMatte": {
			const node = nodesByRefId.get(source.refId);
			return node ? (
				<g opacity={opacity}>
					<MaskSilhouette node={node} includeStroke fill={color} />
				</g>
			) : null;
		}
		case "stack":
			return (
				<>
					{source.items.map((item) =>
						item.enabled &&
						item.strength > 0 &&
						(item.combineMode === "replace" || item.combineMode === "add") &&
						item.source.kind === "svgMatte" ? (
							<FrameLookMatteSource
								key={item.id}
								source={item.source}
								nodesByRefId={nodesByRefId}
								color={color}
								opacity={opacity * item.strength}
							/>
						) : null,
					)}
				</>
			);
		default:
			return null;
	}
}

export function FrameLookInfluenceMaskDefs({
	id,
	artboard,
	plan,
	matteNodesByRefId,
	dilateRadius = 0,
}: {
	readonly id: string;
	readonly artboard: NormalizedArtboard;
	readonly plan: Extract<
		FrameLookInfluenceMaskPlan,
		{ readonly kind: "masked" }
	>;
	readonly matteNodesByRefId: ReadonlyMap<string, VectorNode>;
	readonly dilateRadius?: number;
}) {
	const { influence, source } = plan;
	const strength = Math.min(Math.max(influence.strength, 0), 1);
	const paintColor = influence.invert ? "black" : "white";
	const backgroundColor = influence.invert ? "white" : "black";
	const featherPx =
		influence.featherRadius * Math.min(artboard.width, artboard.height);
	const maskDilatePx = Math.max(0, dilateRadius);
	const shapeFilterPadding = Math.ceil(maskDilatePx + featherPx * 3);
	const shapeFilterId =
		maskDilatePx > 0 || featherPx > 0 ? `${id}-shape` : undefined;
	const shapeFilter = shapeFilterId ? `url(#${shapeFilterId})` : undefined;
	const radialGradientId =
		source.kind === "radialGradient" ? `${id}-radial` : undefined;
	const linearGradientId =
		source.kind === "linearGradient" ? `${id}-linear` : undefined;

	const shape = (() => {
		switch (source.kind) {
			case "rect": {
				const x = maskCoordX(source.x, source, artboard);
				const y = maskCoordY(source.y, source, artboard);
				const width = maskLengthX(source.width, source, artboard);
				const height = maskLengthY(source.height, source, artboard);
				return (
					<rect
						x={x}
						y={y}
						width={width}
						height={height}
						rx={source.cornerRadius}
						fill={paintColor}
						opacity={strength}
						transform={
							source.rotation
								? `rotate(${rotationDegrees(source.rotation)} ${x + width / 2} ${y + height / 2})`
								: undefined
						}
					/>
				);
			}
			case "ellipse": {
				const cx = maskCoordX(source.cx, source, artboard);
				const cy = maskCoordY(source.cy, source, artboard);
				return (
					<ellipse
						cx={cx}
						cy={cy}
						rx={maskLengthX(source.rx, source, artboard)}
						ry={maskLengthY(source.ry, source, artboard)}
						fill={paintColor}
						opacity={strength}
						transform={
							source.rotation
								? `rotate(${rotationDegrees(source.rotation)} ${cx} ${cy})`
								: undefined
						}
					/>
				);
			}
			case "radialGradient": {
				if (!radialGradientId) return null;
				return (
					<rect
						width={artboard.width}
						height={artboard.height}
						fill={`url(#${radialGradientId})`}
						opacity={strength}
					/>
				);
			}
			case "linearGradient": {
				if (!linearGradientId) return null;
				return (
					<rect
						width={artboard.width}
						height={artboard.height}
						fill={`url(#${linearGradientId})`}
						opacity={strength}
					/>
				);
			}
			case "svgMatte":
			case "stack":
				return (
					<FrameLookMatteSource
						source={source}
						nodesByRefId={matteNodesByRefId}
						color={paintColor}
						opacity={strength}
					/>
				);
			default:
				return null;
		}
	})();

	const radialGradient =
		source.kind === "radialGradient" && radialGradientId ? (
			<radialGradient
				id={radialGradientId}
				gradientUnits="userSpaceOnUse"
				cx={maskCoordX(source.cx, source, artboard)}
				cy={maskCoordY(source.cy, source, artboard)}
				r={Math.max(
					maskLengthX(source.rx, source, artboard),
					maskLengthY(source.ry, source, artboard),
				)}
			>
				{maskStops(source.stops, paintColor)}
			</radialGradient>
		) : null;
	const linearGradient =
		source.kind === "linearGradient" && linearGradientId ? (
			<linearGradient
				id={linearGradientId}
				gradientUnits="userSpaceOnUse"
				x1={maskCoordX(source.x1, source, artboard)}
				y1={maskCoordY(source.y1, source, artboard)}
				x2={maskCoordX(source.x2, source, artboard)}
				y2={maskCoordY(source.y2, source, artboard)}
			>
				{maskStops(source.stops, paintColor)}
			</linearGradient>
		) : null;

	return (
		<>
			{radialGradient}
			{linearGradient}
			{shapeFilterId ? (
				<filter
					id={shapeFilterId}
					filterUnits="userSpaceOnUse"
					x={plan.bounds.x - shapeFilterPadding}
					y={plan.bounds.y - shapeFilterPadding}
					width={plan.bounds.width + shapeFilterPadding * 2}
					height={plan.bounds.height + shapeFilterPadding * 2}
				>
					{maskDilatePx > 0 ? (
						<feMorphology
							operator="dilate"
							radius={maskDilatePx}
							in="SourceGraphic"
							result="dilated-mask"
						/>
					) : null}
					{featherPx > 0 ? (
						<feGaussianBlur
							in={maskDilatePx > 0 ? "dilated-mask" : "SourceGraphic"}
							stdDeviation={featherPx}
						/>
					) : null}
				</filter>
			) : null}
			<mask
				id={id}
				maskUnits="userSpaceOnUse"
				maskContentUnits="userSpaceOnUse"
				x={0}
				y={0}
				width={artboard.width}
				height={artboard.height}
			>
				<rect
					width={artboard.width}
					height={artboard.height}
					fill={backgroundColor}
				/>
				<g filter={shapeFilter}>{shape}</g>
			</mask>
		</>
	);
}
