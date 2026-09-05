import {
	createImportedAppearanceMetadataData,
	createImportedClipMaskRelationMetadata,
	type ImportedAppearanceEffectMetadata,
	type ImportedOpacityGroupMetadata,
	readImportedClipMaskRelations,
	readImportedCompoundPath,
	readImportedEffects,
	readImportedOpacityGroups,
	readImportedPaint,
} from "@/entities/scene/model/appearance";
import {
	isImageDataUrl,
	mimeTypeFromImageDataUrl,
} from "@/entities/scene/model/assets";
import {
	type Matrix2D,
	transformFromMatrix,
} from "@/entities/scene/model/rendering";
import { normalizeTextStyle } from "@/entities/scene/model/text-geometry";
import type {
	Artboard,
	BlendMode,
	GradientStop,
	ImageAsset,
	LinearGradientPaint,
	NodeGeometry,
	NodeStyle,
	Paint,
	PaintTransform,
	RadialGradientPaint,
	SceneAsset,
	SceneLayer,
	TextAlign,
	TextStyle,
	Transform,
	Vec2,
	VectorNode,
} from "@/entities/scene/model/types";
import { IDENTITY_TRANSFORM } from "@/entities/scene/model/types";
import {
	createImportArtboard,
	type ImportArtboardBounds,
} from "./artboard-mapping";
import { nestedSubpathIndices } from "./compound";
import { svgPathDataToAeShapes } from "./svg-path";
import type {
	ImportedScenePayload,
	ImportIssue,
	ImportIssueAffectedTarget,
} from "./types";

type SvgAttributes = Readonly<Record<string, string>>;

type SvgContent = string | SvgElement;

type SvgElement = {
	readonly tagName: string;
	readonly attributes: SvgAttributes;
	readonly children: SvgElement[];
	readonly content: SvgContent[];
	readonly path: string;
};

type SvgParseResult = {
	readonly root?: SvgElement;
	readonly issues: readonly ImportIssue[];
};

type ImportContext = {
	readonly sourceName?: string;
	readonly ref?: string;
	readonly path?: string;
};

type TraverseState = {
	readonly style: NodeStyle;
	readonly paintFidelity: SvgPaintFidelityData;
	readonly strokeFidelity: SvgStrokeFidelityData;
	readonly effects: readonly SvgEffectFidelityData[];
	readonly opacityGroups: readonly SvgOpacityGroupFidelityData[];
	readonly matrix: Matrix2D;
	readonly artboardId: string;
	readonly renderable: boolean;
	readonly paintServers: SvgPaintServers;
};

type SvgViewBox = {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
};

type SvgViewportLayout = {
	readonly matrix: Matrix2D;
	readonly bounds: ImportArtboardBounds;
};

type SvgPaintServer = {
	readonly tagName:
		| "lineargradient"
		| "meshgradient"
		| "pattern"
		| "radialgradient";
	readonly id: string;
	readonly fallbackColor?: string;
	readonly paint?: LinearGradientPaint | RadialGradientPaint;
	readonly path: string;
};

type SvgPaintServers = ReadonlyMap<string, SvgPaintServer>;

type SvgPaintFidelityEntry = {
	readonly source: SvgPaintServer["tagName"] | "paint-server";
	readonly ref?: string;
	readonly fallback: string;
	readonly sourcePath?: string;
	readonly unsupported?: boolean;
};

type SvgPaintFidelityData = {
	readonly fill?: SvgPaintFidelityEntry;
	readonly stroke?: SvgPaintFidelityEntry;
};

type ParsedSvgPaint = {
	readonly value: string;
	readonly paint?: Paint;
	readonly fidelity?: SvgPaintFidelityEntry;
};

type SvgStrokeLineCap = "butt" | "round" | "square";

type SvgStrokeLineJoin = "miter" | "round" | "bevel";

type SvgStrokeFidelityData = {
	dashArray?: readonly number[];
	dashOffset?: number;
	lineCap?: SvgStrokeLineCap;
	lineJoin?: SvgStrokeLineJoin;
	miterLimit?: number;
	rawDashArray?: string;
};

type SvgUnsupportedEffectAttribute =
	(typeof unsupportedEffectAttributes)[number];

type SvgUnsupportedEffectKind = SvgUnsupportedEffectAttribute | "blend-mode";

type SvgEffectFidelityData = ImportedAppearanceEffectMetadata & {
	readonly kind: SvgUnsupportedEffectKind;
	readonly value: string;
	readonly ref?: string;
	readonly sourcePath: string;
};

type SvgOpacityGroupFidelityData = ImportedOpacityGroupMetadata & {
	readonly source: "svg-opacity-group";
	readonly sourcePath: string;
	readonly flattenedTo: "node-opacity";
};

type SvgCompoundPathFidelityData = {
	readonly source: "svg-path";
	readonly fillRule: string;
	readonly subpathCount: number;
	readonly subpathIndex: number;
	readonly sourcePath: string;
};

type SvgTextFidelityData = {
	readonly source: "svg-text";
	readonly metrics: "estimated";
	readonly spansFlattened: boolean;
	readonly sourcePath: string;
};

type SvgImageFidelityData = {
	readonly source: "svg-image";
	readonly assetId: string;
	readonly sourcePath: string;
	readonly referenceMode: "data-url" | "reference";
	readonly href?: string;
};

type SvgGeometryImport = {
	readonly geometry: NodeGeometry;
	readonly asset?: ImageAsset;
	readonly compoundPath?: SvgCompoundPathFidelityData;
	readonly imageFidelity?: SvgImageFidelityData;
	readonly textFidelity?: SvgTextFidelityData;
};

type SvgArtboardFidelityIssueCode =
	| "svg.approximated-artboard-group"
	| "svg.approximated-artboard-transform"
	| "svg.unsupported-artboard-bounds"
	| "svg.unsupported-artboard-viewport";

export type SvgImportOptions = {
	readonly sourceName?: string;
	readonly layerName?: string;
	readonly idPrefix?: string;
	readonly fallbackArtboard?: {
		readonly width: number;
		readonly height: number;
	};
};

const SVG_SOURCE_FORMAT = "svg";
const DEFAULT_FALLBACK_ARTBOARD = { width: 1024, height: 768 } as const;
const DEFAULT_STYLE: NodeStyle = {
	fill: "#000000",
	stroke: "none",
	strokeWidth: 1,
	opacity: 1,
};
const IDENTITY_MATRIX: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const numberPattern = /[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?/g;
const tagPattern = /<(?:"[^"]*"|'[^']*'|[^'">])*>/g;
const attributePattern =
	/([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const nonRenderingTags = new Set(["desc", "metadata", "title"]);
const definitionTags = new Set([
	"clippath",
	"defs",
	"filter",
	"lineargradient",
	"mask",
	"marker",
	"meshgradient",
	"pattern",
	"radialgradient",
	"symbol",
]);
const unsupportedRenderableTags = new Set(["foreignobject", "polyline", "use"]);
const supportedShapeTags = new Set([
	"circle",
	"ellipse",
	"line",
	"path",
	"polygon",
	"rect",
	"text",
	"image",
]);
const unsupportedEffectAttributes = [
	"clip-path",
	"filter",
	"mask",
	"marker-start",
	"marker-mid",
	"marker-end",
] as const;
const paintServerReferencePattern =
	/^url\(\s*(?:"|')?#([^"')\s]+)(?:"|')?\s*\)$/i;
const svgStrokeLineCaps = new Set<SvgStrokeLineCap>([
	"butt",
	"round",
	"square",
]);
const svgStrokeLineJoins = new Set<SvgStrokeLineJoin>([
	"miter",
	"round",
	"bevel",
]);
const supportedBlendModes = new Set<BlendMode>([
	"normal",
	"multiply",
	"screen",
	"overlay",
	"darken",
	"lighten",
	"color-dodge",
	"color-burn",
	"hard-light",
	"soft-light",
	"difference",
	"exclusion",
	"hue",
	"saturation",
	"color",
	"luminosity",
]);

const paintServerTags = new Set<SvgPaintServer["tagName"]>([
	"lineargradient",
	"meshgradient",
	"pattern",
	"radialgradient",
]);

const isFiniteNumber = (value: number): boolean => Number.isFinite(value);

const roundTiny = (value: number): number =>
	Math.abs(value) < 1e-10 ? 0 : Number(value.toFixed(6));

const clampOpacity = (value: number): number =>
	Math.min(1, Math.max(0, isFiniteNumber(value) ? value : 1));

const parseNumberList = (value: string): readonly number[] =>
	Array.from(value.matchAll(numberPattern), ([match]) => Number(match)).filter(
		isFiniteNumber,
	);

const parseNumber = (value: string | undefined): number | undefined => {
	if (!value) return undefined;
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.endsWith("%")) return undefined;
	const match = trimmed.match(
		/^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?/,
	);
	if (!match) return undefined;
	const parsed = Number(match[0]);
	return isFiniteNumber(parsed) ? parsed : undefined;
};

const normalizeTagName = (value: string): string => {
	const name = value.trim().toLowerCase();
	const parts = name.split(":");
	return parts[parts.length - 1] ?? name;
};

const sanitizeIdPart = (value: string | undefined): string | undefined => {
	const sanitized = value
		?.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
	return sanitized && sanitized.length > 0 ? sanitized : undefined;
};

const elementRef = (element: SvgElement): string | undefined =>
	element.attributes.id ?? element.attributes["data-node-id"];

const elementName = (element: SvgElement, fallback: string): string =>
	element.attributes["data-node-name"] ??
	element.attributes["inkscape:label"] ??
	element.attributes.id ??
	fallback;

const makeIssue = (
	code: string,
	message: string,
	context: ImportContext,
	severity: ImportIssue["severity"] = "warning",
): ImportIssue => ({
	severity,
	code,
	message,
	source: context.sourceName,
	ref: context.ref,
	path: context.path,
});

const issueForElement = (
	code: string,
	message: string,
	element: SvgElement,
	sourceName: string | undefined,
	severity: ImportIssue["severity"] = "warning",
): ImportIssue =>
	makeIssue(
		code,
		message,
		{
			sourceName,
			ref: elementRef(element),
			path: element.path,
		},
		severity,
	);

const multiplyMatrix = (left: Matrix2D, right: Matrix2D): Matrix2D => ({
	a: left.a * right.a + left.c * right.b,
	b: left.b * right.a + left.d * right.b,
	c: left.a * right.c + left.c * right.d,
	d: left.b * right.c + left.d * right.d,
	e: left.a * right.e + left.c * right.f + left.e,
	f: left.b * right.e + left.d * right.f + left.f,
});

const translateMatrix = (x: number, y: number): Matrix2D => ({
	a: 1,
	b: 0,
	c: 0,
	d: 1,
	e: x,
	f: y,
});

const scaleMatrix = (x: number, y: number): Matrix2D => ({
	a: x,
	b: 0,
	c: 0,
	d: y,
	e: 0,
	f: 0,
});

const rotateMatrix = (degrees: number): Matrix2D => {
	const radians = (degrees * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	return {
		a: cos,
		b: sin,
		c: -sin,
		d: cos,
		e: 0,
		f: 0,
	};
};

const transformPoint = (matrix: Matrix2D, point: Vec2): Vec2 => ({
	x: roundTiny(matrix.a * point.x + matrix.c * point.y + matrix.e),
	y: roundTiny(matrix.b * point.x + matrix.d * point.y + matrix.f),
});

const transformBounds = (
	matrix: Matrix2D,
	bounds: ImportArtboardBounds,
): ImportArtboardBounds => {
	const corners = [
		transformPoint(matrix, { x: bounds.x, y: bounds.y }),
		transformPoint(matrix, { x: bounds.x + bounds.width, y: bounds.y }),
		transformPoint(matrix, {
			x: bounds.x + bounds.width,
			y: bounds.y + bounds.height,
		}),
		transformPoint(matrix, { x: bounds.x, y: bounds.y + bounds.height }),
	];
	const xs = corners.map((corner) => corner.x);
	const ys = corners.map((corner) => corner.y);
	const minX = Math.min(...xs);
	const minY = Math.min(...ys);
	const maxX = Math.max(...xs);
	const maxY = Math.max(...ys);
	return {
		x: minX,
		y: minY,
		width: roundTiny(maxX - minX),
		height: roundTiny(maxY - minY),
	};
};

const parseStyleDeclarations = (
	style: string | undefined,
): Readonly<Record<string, string>> => {
	if (!style) return {};
	const declarations: Record<string, string> = {};
	for (const part of style.split(";")) {
		const separator = part.indexOf(":");
		if (separator < 0) continue;
		const key = part.slice(0, separator).trim().toLowerCase();
		const value = part.slice(separator + 1).trim();
		if (key && value) declarations[key] = value;
	}
	return declarations;
};

const decodeXmlText = (text: string): string =>
	text.replace(
		/&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|quot);/gi,
		(match, entity: string) => {
			const decodeCodePoint = (codePoint: number): string =>
				Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
					? String.fromCodePoint(codePoint)
					: match;
			const normalized = entity.toLowerCase();
			if (normalized === "amp") return "&";
			if (normalized === "apos") return "'";
			if (normalized === "gt") return ">";
			if (normalized === "lt") return "<";
			if (normalized === "quot") return '"';
			if (normalized.startsWith("#x")) {
				const codePoint = Number.parseInt(normalized.slice(2), 16);
				return decodeCodePoint(codePoint);
			}
			if (normalized.startsWith("#")) {
				const codePoint = Number.parseInt(normalized.slice(1), 10);
				return decodeCodePoint(codePoint);
			}
			return match;
		},
	);

const collectSvgText = (element: SvgElement): string =>
	element.content
		.map((item) => (typeof item === "string" ? item : collectSvgText(item)))
		.join("");

const normalizedTextContent = (element: SvgElement): string => {
	const decoded = decodeXmlText(collectSvgText(element));
	if (element.attributes["xml:space"] === "preserve") {
		return decoded.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
	}
	return decoded.replace(/\s+/g, " ").trim();
};

const styleProperty = (
	attributes: SvgAttributes,
	property: string,
): string | undefined =>
	parseStyleDeclarations(attributes.style)[property] ?? attributes[property];

const textFontSize = (attributes: SvgAttributes): number => {
	const parsed = parseNumber(styleProperty(attributes, "font-size"));
	return parsed && parsed > 0 ? parsed : 46;
};

const fontWeightFrom = (value: string | undefined): number => {
	if (!value) return 400;
	const normalized = value.trim().toLowerCase();
	if (normalized === "normal") return 400;
	if (normalized === "bold" || normalized === "bolder") return 700;
	if (normalized === "lighter") return 300;
	const parsed = parseNumber(normalized);
	return parsed !== undefined ? parsed : 400;
};

const textAlignFrom = (attributes: SvgAttributes): TextAlign => {
	const anchor = styleProperty(attributes, "text-anchor")?.trim().toLowerCase();
	if (anchor === "middle") return "center";
	if (anchor === "end") return "right";
	const align = styleProperty(attributes, "text-align")?.trim().toLowerCase();
	if (align === "center" || align === "right") return align;
	return "left";
};

const textLineHeight = (
	attributes: SvgAttributes,
	fontSize: number,
): number => {
	const value = styleProperty(attributes, "line-height")?.trim();
	if (!value || value.toLowerCase() === "normal") return fontSize * 1.2;
	if (value.endsWith("%")) {
		const percent = Number(value.slice(0, -1));
		return isFiniteNumber(percent) && percent > 0
			? fontSize * (percent / 100)
			: fontSize * 1.2;
	}
	const parsed = parseNumber(value);
	if (parsed === undefined || parsed <= 0) return fontSize * 1.2;
	return parsed <= 4 && /^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))$/.test(value)
		? parsed * fontSize
		: parsed;
};

const textStyleFor = (attributes: SvgAttributes): TextStyle => {
	const fontSize = textFontSize(attributes);
	return normalizeTextStyle({
		fontFamily: styleProperty(attributes, "font-family") ?? "sans-serif",
		fontSize,
		lineHeight: textLineHeight(attributes, fontSize),
		align: textAlignFrom(attributes),
		fontWeight: fontWeightFrom(styleProperty(attributes, "font-weight")),
	});
};

const textBoundsFor = (
	element: SvgElement,
	sourceName: string | undefined,
	issues: ImportIssue[],
): Extract<NodeGeometry, { readonly kind: "text" }>["bounds"] => {
	const x = parseLengthForElement(
		element.attributes.x,
		0,
		element,
		sourceName,
		issues,
	);
	const y = parseLengthForElement(
		element.attributes.y,
		0,
		element,
		sourceName,
		issues,
	);
	const fontSize = textFontSize(element.attributes);
	const textStyle = textStyleFor(element.attributes);
	const text = normalizedTextContent(element);
	const lines = text.split("\n");
	const longestLine = Math.max(...lines.map((line) => line.length), 1);
	return {
		x,
		y,
		width: roundTiny(Math.max(fontSize, longestLine * fontSize * 0.6)),
		height: roundTiny(Math.max(fontSize, lines.length * textStyle.lineHeight)),
	};
};

const paintServerIdFrom = (value: string): string | undefined =>
	paintServerReferencePattern.exec(value.trim())?.[1];

const blendModeFrom = (value: string | undefined): BlendMode | undefined => {
	const normalized = value?.trim().toLowerCase();
	return normalized && supportedBlendModes.has(normalized as BlendMode)
		? (normalized as BlendMode)
		: undefined;
};

type RgbColor = {
	readonly red: number;
	readonly green: number;
	readonly blue: number;
};

const clampByte = (value: number): number =>
	Math.min(255, Math.max(0, Math.round(value)));

const parseRgbChannel = (value: string): number | undefined => {
	const trimmed = value.trim();
	if (trimmed.endsWith("%")) {
		const percent = Number(trimmed.slice(0, -1));
		return isFiniteNumber(percent)
			? clampByte((percent / 100) * 255)
			: undefined;
	}
	const parsed = Number(trimmed);
	return isFiniteNumber(parsed) ? clampByte(parsed) : undefined;
};

const parseCssRgbColor = (value: string): RgbColor | undefined => {
	const trimmed = value.trim().toLowerCase();
	const shortHex = /^#([0-9a-f]{3})$/i.exec(trimmed)?.[1];
	if (shortHex) {
		return {
			red: Number.parseInt(`${shortHex[0]}${shortHex[0]}`, 16),
			green: Number.parseInt(`${shortHex[1]}${shortHex[1]}`, 16),
			blue: Number.parseInt(`${shortHex[2]}${shortHex[2]}`, 16),
		};
	}
	const longHex = /^#([0-9a-f]{6})$/i.exec(trimmed)?.[1];
	if (longHex) {
		return {
			red: Number.parseInt(longHex.slice(0, 2), 16),
			green: Number.parseInt(longHex.slice(2, 4), 16),
			blue: Number.parseInt(longHex.slice(4, 6), 16),
		};
	}
	const rgbMatch = /^rgba?\(([^)]*)\)$/i.exec(trimmed);
	if (!rgbMatch) return undefined;
	const channels = (rgbMatch[1] ?? "")
		.replace(/\s*\/.*$/, "")
		.split(/[,\s]+/)
		.filter(Boolean)
		.slice(0, 3)
		.map(parseRgbChannel);
	if (
		channels.length !== 3 ||
		channels.some((channel) => channel === undefined)
	) {
		return undefined;
	}
	const [red, green, blue] = channels;
	if (red === undefined || green === undefined || blue === undefined) {
		return undefined;
	}
	return {
		red,
		green,
		blue,
	};
};

const rgbToHex = ({ red, green, blue }: RgbColor): string =>
	`#${[red, green, blue]
		.map((channel) => clampByte(channel).toString(16).padStart(2, "0"))
		.join("")}`;

const averageColors = (colors: readonly RgbColor[]): RgbColor | undefined => {
	if (colors.length === 0) return undefined;
	return {
		red: colors.reduce((sum, color) => sum + color.red, 0) / colors.length,
		green: colors.reduce((sum, color) => sum + color.green, 0) / colors.length,
		blue: colors.reduce((sum, color) => sum + color.blue, 0) / colors.length,
	};
};

const solidGradientFallback = (
	stopColors: readonly string[],
): string | undefined => {
	if (stopColors.length === 0) return undefined;
	const parsed = stopColors
		.map(parseCssRgbColor)
		.filter((color): color is RgbColor => color !== undefined);
	if (parsed.length === stopColors.length) {
		const average = averageColors(parsed);
		if (average) return rgbToHex(average);
	}
	return stopColors.find(
		(color) => color !== "none" && color !== "transparent",
	);
};

const stopColorFor = (stop: SvgElement): string | undefined =>
	styleProperty(stop.attributes, "stop-color") ??
	styleProperty(stop.attributes, "color");

const stopOpacityFor = (stop: SvgElement): number | undefined => {
	const opacity =
		styleProperty(stop.attributes, "stop-opacity") ??
		styleProperty(stop.attributes, "opacity");
	if (!opacity) return undefined;
	const parsed = parseNumber(opacity);
	return parsed === undefined ? undefined : clampOpacity(parsed);
};

const parseGradientUnit = (
	value: string | undefined,
	fallback: number,
): number => {
	if (!value) return fallback;
	const trimmed = value.trim();
	if (trimmed.endsWith("%")) {
		const percent = Number(trimmed.slice(0, -1));
		return isFiniteNumber(percent) ? roundTiny(percent / 100) : fallback;
	}
	const parsed = parseNumber(trimmed);
	return parsed === undefined ? fallback : roundTiny(parsed);
};

const parseGradientOffset = (
	value: string | undefined,
	fallback: number,
): number => Math.min(1, Math.max(0, parseGradientUnit(value, fallback)));

const gradientStopsFor = (gradient: SvgElement): readonly GradientStop[] => {
	const stops = gradient.children.filter((child) => child.tagName === "stop");
	const lastIndex = Math.max(stops.length - 1, 1);
	return stops.map((stop, index) => {
		const opacity = stopOpacityFor(stop);
		return {
			offset: parseGradientOffset(
				styleProperty(stop.attributes, "offset"),
				index / lastIndex,
			),
			color: stopColorFor(stop) ?? "#000000",
			...(opacity !== undefined && opacity < 1 ? { opacity } : {}),
		};
	});
};

const paintTransformFor = (
	value: string | undefined,
): PaintTransform | undefined => {
	if (!value) return undefined;
	const transform = parseTransformAttribute(value, {});
	return transform.issues.length === 0 ? transform.matrix : undefined;
};

const gradientPaintFor = (
	gradient: SvgElement,
): LinearGradientPaint | RadialGradientPaint | undefined => {
	const stops = gradientStopsFor(gradient);
	if (stops.length < 2) return undefined;
	const transform = paintTransformFor(gradient.attributes.gradientTransform);
	if (gradient.tagName === "lineargradient") {
		return {
			kind: "linear-gradient",
			from: {
				x: parseGradientUnit(gradient.attributes.x1, 0),
				y: parseGradientUnit(gradient.attributes.y1, 0),
			},
			to: {
				x: parseGradientUnit(gradient.attributes.x2, 1),
				y: parseGradientUnit(gradient.attributes.y2, 0),
			},
			stops,
			...(transform ? { transform } : {}),
		};
	}
	const radius = parseGradientUnit(gradient.attributes.r, 0.5);
	return {
		kind: "radial-gradient",
		center: {
			x: parseGradientUnit(gradient.attributes.cx, 0.5),
			y: parseGradientUnit(gradient.attributes.cy, 0.5),
		},
		radius: { x: radius, y: radius },
		stops,
		...(transform ? { transform } : {}),
	};
};

const collectPaintServers = (root: SvgElement): SvgPaintServers => {
	const servers = new Map<string, SvgPaintServer>();
	const visit = (element: SvgElement) => {
		const id = element.attributes.id;
		if (
			id &&
			paintServerTags.has(element.tagName as SvgPaintServer["tagName"])
		) {
			const gradient =
				element.tagName === "lineargradient" ||
				element.tagName === "radialgradient";
			const stopColors = gradient
				? gradientStopsFor(element).map((stop) => stop.color)
				: [];
			const fallbackColor = gradient
				? solidGradientFallback(stopColors)
				: undefined;
			const paint = gradient ? gradientPaintFor(element) : undefined;
			servers.set(id, {
				tagName: element.tagName as SvgPaintServer["tagName"],
				id,
				...(fallbackColor ? { fallbackColor } : {}),
				...(paint ? { paint } : {}),
				path: element.path,
			});
		}
		for (const child of element.children) visit(child);
	};
	visit(root);
	return servers;
};

const definitionIssueCode = (tagName: string): string =>
	tagName === "clippath"
		? "svg.unsupported-clip-path"
		: tagName === "symbol"
			? "svg.unsupported-component-symbol"
			: `svg.unsupported-${tagName}`;

const unsupportedRenderableIssueCode = (tagName: string): string => {
	if (tagName === "use") return "svg.unsupported-component-instance";
	if (tagName === "image") return "svg.unsupported-image-asset";
	return `svg.unsupported-${tagName}`;
};

const unsupportedRenderableMessage = (element: SvgElement): string => {
	if (element.tagName === "use") {
		const href = element.attributes.href ?? element.attributes["xlink:href"];
		return href
			? `SVG use instance ${href} is not imported because reusable component references are not represented in the scene model yet.`
			: "SVG use instances are not imported because reusable component references are not represented in the scene model yet.";
	}
	if (element.tagName === "image") {
		return "SVG raster image assets are not imported in this vector subset; place the image separately after import.";
	}
	return `${element.tagName} is not imported in the first SVG subset.`;
};

const supportedDefinitionTag = (tagName: string): boolean =>
	tagName === "defs" ||
	tagName === "lineargradient" ||
	tagName === "radialgradient" ||
	tagName === "stop";

const hasRenderableDescendant = (element: SvgElement): boolean =>
	element.children.some((child) => {
		if (supportedShapeTags.has(child.tagName)) return true;
		if (unsupportedRenderableTags.has(child.tagName)) return true;
		if (definitionTags.has(child.tagName)) return false;
		return hasRenderableDescendant(child);
	});

const hasDescendantTag = (element: SvgElement, tagName: string): boolean =>
	element.children.some(
		(child) => child.tagName === tagName || hasDescendantTag(child, tagName),
	);

const opacityGroupFidelityData = (
	element: SvgElement,
	sourceName: string | undefined,
	issues: ImportIssue[],
): SvgOpacityGroupFidelityData | undefined => {
	if (!["a", "g", "svg"].includes(element.tagName)) return undefined;
	const opacity = styleProperty(element.attributes, "opacity");
	if (!opacity) return undefined;
	const parsed = parseNumber(opacity);
	if (
		parsed === undefined ||
		parsed >= 1 ||
		!hasRenderableDescendant(element)
	) {
		return undefined;
	}
	issues.push(
		issueForElement(
			"svg.approximated-opacity-group",
			"SVG group opacity was pushed down to child node opacity; overlapping children may not composite exactly.",
			element,
			sourceName,
			"info",
		),
	);
	return {
		source: "svg-opacity-group",
		opacity: clampOpacity(parsed),
		flattenedTo: "node-opacity",
		...(elementRef(element) ? { ref: elementRef(element) } : {}),
		sourcePath: element.path,
	};
};

const parsePaint = (
	value: string,
	property: "fill" | "stroke",
	context: ImportContext,
	issues: ImportIssue[],
	paintServers: SvgPaintServers,
): ParsedSvgPaint => {
	const trimmed = value.trim();
	const paintServerId = paintServerIdFrom(trimmed);
	if (paintServerId) {
		const paintServer = paintServers.get(paintServerId);
		if (paintServer?.paint) {
			return {
				value: paintServer.fallbackColor ?? "none",
				paint: paintServer.paint,
			};
		}
		if (paintServer?.fallbackColor) {
			issues.push(
				makeIssue(
					"svg.approximated-gradient-paint",
					`${property} references ${paintServer.tagName} #${paintServer.id}; it was imported as solid ${paintServer.fallbackColor}.`,
					context,
					"info",
				),
			);
			return {
				value: paintServer.fallbackColor,
				fidelity: {
					source: paintServer.tagName,
					ref: paintServer.id,
					fallback: paintServer.fallbackColor,
					sourcePath: paintServer.path,
				},
			};
		}
		issues.push(
			makeIssue(
				paintServer?.tagName === "meshgradient"
					? "svg.unsupported-mesh-gradient-paint"
					: paintServer?.tagName === "pattern"
						? "svg.unsupported-pattern-paint"
						: paintServer
							? "svg.unsupported-gradient-paint"
							: "svg.unsupported-paint-server",
				paintServer
					? `${property} references ${paintServer.tagName} #${paintServer.id}, but no usable solid fallback color could be derived.`
					: `${property} references unsupported paint server #${paintServerId} and was imported as none.`,
				context,
			),
		);
		return {
			value: "none",
			fidelity: {
				source: paintServer?.tagName ?? "paint-server",
				ref: paintServerId,
				fallback: "none",
				...(paintServer?.path ? { sourcePath: paintServer.path } : {}),
				unsupported: true,
			},
		};
	}
	if (/^url\(/i.test(trimmed)) {
		issues.push(
			makeIssue(
				"svg.unsupported-paint-server",
				`${property} uses a paint server and was imported as none.`,
				context,
			),
		);
		return {
			value: "none",
			fidelity: {
				source: "paint-server",
				fallback: "none",
				unsupported: true,
			},
		};
	}
	return { value: trimmed };
};

const parseOpacity = (
	value: string,
	context: ImportContext,
	issues: ImportIssue[],
): number | undefined => {
	const parsed = parseNumber(value);
	if (parsed === undefined) {
		issues.push(
			makeIssue(
				"svg.invalid-opacity",
				`Opacity value "${value}" could not be parsed.`,
				context,
			),
		);
		return undefined;
	}
	return clampOpacity(parsed);
};

const applyStyle = (
	base: NodeStyle,
	basePaintFidelity: SvgPaintFidelityData,
	attributes: SvgAttributes,
	context: ImportContext,
	issues: ImportIssue[],
	paintServers: SvgPaintServers,
): {
	readonly style: NodeStyle;
	readonly paintFidelity: SvgPaintFidelityData;
} => {
	const declarations = parseStyleDeclarations(attributes.style);
	const fill = declarations.fill ?? attributes.fill;
	const stroke = declarations.stroke ?? attributes.stroke;
	const strokeWidth =
		declarations["stroke-width"] ?? attributes["stroke-width"];
	const opacity = declarations.opacity ?? attributes.opacity;

	let strokeWidthValue = base.strokeWidth;
	let opacityValue = base.opacity;
	let paintFidelity = basePaintFidelity;

	if (strokeWidth) {
		const parsedStrokeWidth = parseNumber(strokeWidth);
		if (parsedStrokeWidth === undefined || parsedStrokeWidth < 0) {
			issues.push(
				makeIssue(
					"svg.invalid-stroke-width",
					`Stroke width "${strokeWidth}" could not be parsed.`,
					context,
				),
			);
		} else {
			strokeWidthValue = parsedStrokeWidth;
		}
	}

	if (opacity) {
		const parsedOpacity = parseOpacity(opacity, context, issues);
		if (parsedOpacity !== undefined) {
			opacityValue = clampOpacity(base.opacity * parsedOpacity);
		}
	}

	for (const attribute of unsupportedEffectAttributes) {
		const value = declarations[attribute] ?? attributes[attribute];
		if (value && value !== "none") {
			issues.push(
				makeIssue(
					`svg.unsupported-${attribute}`,
					`${attribute} is not imported in the first SVG subset.`,
					context,
				),
			);
		}
	}

	const blendMode =
		declarations["mix-blend-mode"] ??
		attributes["mix-blend-mode"] ??
		declarations["blend-mode"] ??
		attributes["blend-mode"];
	const parsedBlendMode = blendModeFrom(blendMode);
	if (blendMode && !parsedBlendMode) {
		issues.push(
			makeIssue(
				"svg.unsupported-blend-mode",
				`Blend mode "${blendMode}" is not represented in the scene model and was ignored.`,
				context,
			),
		);
	}

	const parsedFill = fill
		? parsePaint(fill, "fill", context, issues, paintServers)
		: undefined;
	const parsedStroke = stroke
		? parsePaint(stroke, "stroke", context, issues, paintServers)
		: undefined;
	if (parsedFill) {
		const { fill: _fill, ...rest } = paintFidelity;
		paintFidelity = parsedFill.fidelity
			? { ...rest, fill: parsedFill.fidelity }
			: rest;
	}
	if (parsedStroke) {
		const { stroke: _stroke, ...rest } = paintFidelity;
		paintFidelity = parsedStroke.fidelity
			? { ...rest, stroke: parsedStroke.fidelity }
			: rest;
	}

	return {
		style: {
			fill: parsedFill ? parsedFill.value : base.fill,
			stroke: parsedStroke ? parsedStroke.value : base.stroke,
			strokeWidth: strokeWidthValue,
			opacity: opacityValue,
			...(parsedFill?.paint
				? { fills: [parsedFill.paint] }
				: !parsedFill && base.fills
					? { fills: base.fills }
					: {}),
			...(parsedStroke?.paint
				? { strokes: [parsedStroke.paint] }
				: !parsedStroke && base.strokes
					? { strokes: base.strokes }
					: {}),
			...(parsedBlendMode
				? { blendMode: parsedBlendMode }
				: !blendMode && base.blendMode
					? { blendMode: base.blendMode }
					: {}),
		},
		paintFidelity,
	};
};

const paintFidelityData = (
	data: SvgPaintFidelityData,
): Record<string, unknown> | undefined => {
	const result: Record<string, unknown> = {};
	if (data.fill) result.fill = { ...data.fill };
	if (data.stroke) result.stroke = { ...data.stroke };
	return Object.keys(result).length > 0 ? result : undefined;
};

const strokeFidelityData = (
	data: SvgStrokeFidelityData,
): Record<string, unknown> | undefined => {
	const result: Record<string, unknown> = {};
	if (data.dashArray) result.dashArray = [...data.dashArray];
	if (data.dashOffset !== undefined) result.dashOffset = data.dashOffset;
	if (data.lineCap) result.lineCap = data.lineCap;
	if (data.lineJoin) result.lineJoin = data.lineJoin;
	if (data.miterLimit !== undefined) result.miterLimit = data.miterLimit;
	if (data.rawDashArray) result.rawDashArray = data.rawDashArray;
	return Object.keys(result).length > 0 ? result : undefined;
};

const unsupportedEffectFidelityData = (
	attributes: SvgAttributes,
	sourcePath: string,
): readonly SvgEffectFidelityData[] => {
	const effects: SvgEffectFidelityData[] = unsupportedEffectAttributes.flatMap(
		(kind) => {
			const value = styleProperty(attributes, kind);
			if (!value || value.trim().toLowerCase() === "none") return [];
			const normalized = value.trim();
			const ref = paintServerIdFrom(normalized);
			return [
				{
					kind,
					value: normalized,
					...(ref ? { ref } : {}),
					sourcePath,
				},
			];
		},
	);
	const blendMode =
		styleProperty(attributes, "mix-blend-mode") ??
		styleProperty(attributes, "blend-mode");
	if (blendMode && !blendModeFrom(blendMode)) {
		effects.push({
			kind: "blend-mode",
			value: blendMode.trim(),
			sourcePath,
		});
	}
	return effects;
};

const importEffectsData = (
	effects: readonly SvgEffectFidelityData[],
): readonly Record<string, unknown>[] | undefined =>
	effects.length > 0
		? effects.map((effect) => ({
				kind: effect.kind,
				value: effect.value,
				...(effect.ref ? { ref: effect.ref } : {}),
				sourcePath: effect.sourcePath,
			}))
		: undefined;

const lineCapFrom = (value: string): SvgStrokeLineCap | undefined => {
	const normalized = value.trim().toLowerCase();
	return svgStrokeLineCaps.has(normalized as SvgStrokeLineCap)
		? (normalized as SvgStrokeLineCap)
		: undefined;
};

const lineJoinFrom = (value: string): SvgStrokeLineJoin | undefined => {
	const normalized = value.trim().toLowerCase();
	return svgStrokeLineJoins.has(normalized as SvgStrokeLineJoin)
		? (normalized as SvgStrokeLineJoin)
		: undefined;
};

const applyStrokeFidelity = (
	base: SvgStrokeFidelityData,
	attributes: SvgAttributes,
	context: ImportContext,
	issues: ImportIssue[],
): SvgStrokeFidelityData => {
	const next: SvgStrokeFidelityData = { ...base };
	const dashArray = styleProperty(attributes, "stroke-dasharray");
	const dashOffset = styleProperty(attributes, "stroke-dashoffset");
	const lineCap = styleProperty(attributes, "stroke-linecap");
	const lineJoin = styleProperty(attributes, "stroke-linejoin");
	const miterLimit = styleProperty(attributes, "stroke-miterlimit");

	if (dashArray) {
		const normalized = dashArray.trim().toLowerCase();
		if (normalized === "none") {
			delete next.dashArray;
			delete next.rawDashArray;
		} else {
			const values = parseNumberList(dashArray).filter((value) => value >= 0);
			next.dashArray = values;
			next.rawDashArray = dashArray;
		}
	}

	if (dashOffset) {
		const parsed = parseNumber(dashOffset);
		if (parsed !== undefined) {
			next.dashOffset = parsed;
		}
	}

	if (lineCap) {
		const parsed = lineCapFrom(lineCap);
		if (parsed) {
			next.lineCap = parsed;
		} else {
			issues.push(
				makeIssue(
					"svg.unsupported-stroke-linecap",
					`SVG stroke-linecap "${lineCap}" is not supported by the importer.`,
					context,
				),
			);
		}
	}

	if (lineJoin) {
		const parsed = lineJoinFrom(lineJoin);
		if (parsed) {
			next.lineJoin = parsed;
		} else {
			issues.push(
				makeIssue(
					"svg.unsupported-stroke-linejoin",
					`SVG stroke-linejoin "${lineJoin}" is not supported by the importer.`,
					context,
				),
			);
		}
	}

	if (miterLimit) {
		const parsed = parseNumber(miterLimit);
		if (parsed !== undefined && parsed > 0) {
			next.miterLimit = parsed;
		}
	}

	return next;
};

const styleWithStrokeFidelity = (
	style: NodeStyle,
	strokeFidelity: SvgStrokeFidelityData,
): NodeStyle => ({
	...style,
	...(strokeFidelity.dashArray && strokeFidelity.dashArray.length > 0
		? { strokeDash: strokeFidelity.dashArray }
		: {}),
	...(strokeFidelity.dashOffset !== undefined
		? { strokeDashoffset: strokeFidelity.dashOffset }
		: {}),
	...(strokeFidelity.lineCap ? { strokeCap: strokeFidelity.lineCap } : {}),
	...(strokeFidelity.lineJoin ? { strokeJoin: strokeFidelity.lineJoin } : {}),
	...(strokeFidelity.miterLimit !== undefined
		? { strokeMiterLimit: strokeFidelity.miterLimit }
		: {}),
});

const parseTransformAttribute = (
	value: string | undefined,
	context: ImportContext,
): {
	readonly matrix: Matrix2D;
	readonly issues: readonly ImportIssue[];
} => {
	if (!value) return { matrix: IDENTITY_MATRIX, issues: [] };

	const issues: ImportIssue[] = [];
	let matrix = IDENTITY_MATRIX;
	let matchedLength = 0;
	const functionPattern = /([A-Za-z][A-Za-z0-9-]*)\s*\(([^)]*)\)/g;

	for (const match of value.matchAll(functionPattern)) {
		matchedLength += match[0].length;
		const name = match[1].toLowerCase();
		const numbers = parseNumberList(match[2]);
		let nextMatrix: Matrix2D | undefined;

		if (name === "matrix" && numbers.length === 6) {
			nextMatrix = {
				a: numbers[0],
				b: numbers[1],
				c: numbers[2],
				d: numbers[3],
				e: numbers[4],
				f: numbers[5],
			};
		} else if (name === "translate" && numbers.length >= 1) {
			nextMatrix = translateMatrix(numbers[0], numbers[1] ?? 0);
		} else if (name === "scale" && numbers.length >= 1) {
			nextMatrix = scaleMatrix(numbers[0], numbers[1] ?? numbers[0]);
		} else if (
			name === "rotate" &&
			(numbers.length === 1 || numbers.length >= 3)
		) {
			const rotation = rotateMatrix(numbers[0]);
			nextMatrix =
				numbers.length >= 3
					? multiplyMatrix(
							multiplyMatrix(translateMatrix(numbers[1], numbers[2]), rotation),
							translateMatrix(-numbers[1], -numbers[2]),
						)
					: rotation;
		} else if (name === "skewx" || name === "skewy") {
			issues.push(
				makeIssue(
					"svg.unsupported-transform",
					`${name} transform is not representable in the first scene Transform subset.`,
					context,
				),
			);
		} else {
			issues.push(
				makeIssue(
					"svg.invalid-transform",
					`Transform function "${match[0]}" could not be parsed.`,
					context,
				),
			);
		}

		if (nextMatrix) matrix = multiplyMatrix(matrix, nextMatrix);
	}

	const unparsed = value.replace(functionPattern, "").replace(/[\s,]+/g, "");
	if (matchedLength === 0 || unparsed.length > 0) {
		issues.push(
			makeIssue(
				"svg.invalid-transform",
				`Transform value "${value}" contained unsupported syntax.`,
				context,
			),
		);
	}

	return { matrix, issues };
};

const matrixToTransform = (
	matrix: Matrix2D,
	context: ImportContext,
	issues: ImportIssue[],
): Transform => {
	if (
		![matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(
			isFiniteNumber,
		)
	) {
		issues.push(
			makeIssue(
				"svg.invalid-transform",
				"Transform matrix contained non-finite values and was reset.",
				context,
			),
		);
		return IDENTITY_TRANSFORM;
	}

	const columnDot = matrix.a * matrix.c + matrix.b * matrix.d;
	if (Math.abs(columnDot) > 0.000001) {
		issues.push(
			makeIssue(
				"svg.unsupported-transform",
				"Skewed transform matrix was approximated as translate/rotate/scale.",
				context,
			),
		);
	}

	const transform = transformFromMatrix(matrix, { x: 0, y: 0 });
	return {
		position: {
			x: roundTiny(transform.position.x),
			y: roundTiny(transform.position.y),
		},
		rotation: roundTiny(transform.rotation),
		scale: {
			x: roundTiny(transform.scale.x),
			y: roundTiny(transform.scale.y),
		},
		anchor: transform.anchor,
	};
};

const parseAttributes = (source: string): SvgAttributes => {
	const attributes: Record<string, string> = {};
	for (const match of source.matchAll(attributePattern)) {
		const key = match[1].toLowerCase();
		const value = match[2] ?? match[3] ?? match[4] ?? "";
		attributes[key] = value;
	}
	return attributes;
};

const childPath = (parent: SvgElement | undefined, tagName: string): string => {
	const siblingIndex =
		parent?.children.filter((child) => child.tagName === tagName).length ?? 0;
	return parent
		? `${parent.path}/${tagName}[${siblingIndex}]`
		: `/${tagName}[0]`;
};

const parseSvgXml = (
	svgText: string,
	sourceName: string | undefined,
): SvgParseResult => {
	const issues: ImportIssue[] = [];
	const stack: SvgElement[] = [];
	let root: SvgElement | undefined;
	let cursor = 0;

	const appendText = (text: string) => {
		const parent = stack[stack.length - 1];
		if (!parent || text.length === 0) return;
		parent.content.push(text);
	};

	for (const match of svgText.matchAll(tagPattern)) {
		const tagStart = match.index ?? cursor;
		appendText(svgText.slice(cursor, tagStart));
		const rawTag = match[0];
		cursor = tagStart + rawTag.length;
		const inner = rawTag.slice(1, -1).trim();
		if (
			inner.startsWith("!--") ||
			inner.startsWith("!") ||
			inner.startsWith("?")
		) {
			continue;
		}

		if (inner.startsWith("/")) {
			const closingName = normalizeTagName(inner.slice(1));
			const open = stack.pop();
			if (!open || open.tagName !== closingName) {
				issues.push(
					makeIssue(
						"svg.mismatched-tag",
						`Closing tag ${closingName} did not match the current SVG element stack.`,
						{ sourceName },
					),
				);
			}
			continue;
		}

		const selfClosing = /\/\s*$/.test(inner);
		const openSource = selfClosing ? inner.replace(/\/\s*$/, "") : inner;
		const nameMatch = openSource.match(/^([^\s/>]+)/);
		if (!nameMatch) continue;
		const tagName = normalizeTagName(nameMatch[1]);
		const attributeSource = openSource.slice(nameMatch[0].length);
		const parent = stack[stack.length - 1];
		const element: SvgElement = {
			tagName,
			attributes: parseAttributes(attributeSource),
			children: [],
			content: [],
			path: childPath(parent, tagName),
		};

		if (parent) {
			parent.children.push(element);
			parent.content.push(element);
		} else if (!root) {
			root = element;
		} else {
			issues.push(
				makeIssue(
					"svg.multiple-roots",
					"Only the first root SVG element was imported.",
					{ sourceName, path: element.path },
				),
			);
		}

		if (!selfClosing) stack.push(element);
	}

	appendText(svgText.slice(cursor));

	if (stack.length > 0) {
		issues.push(
			makeIssue(
				"svg.unclosed-tag",
				"SVG markup ended before all open tags were closed.",
				{ sourceName, path: stack[stack.length - 1]?.path },
			),
		);
	}

	return { root, issues };
};

const viewBoxFrom = (
	attributes: SvgAttributes,
	sourceName: string | undefined,
	issues: ImportIssue[],
): SvgViewBox | undefined => {
	const value = attributes.viewbox;
	if (!value) return undefined;
	const numbers = parseNumberList(value);
	if (numbers.length !== 4 || numbers[2] <= 0 || numbers[3] <= 0) {
		issues.push(
			makeIssue(
				"svg.invalid-viewbox",
				`ViewBox "${value}" could not be parsed.`,
				{ sourceName, path: "/svg[0]" },
			),
		);
		return undefined;
	}
	return {
		x: numbers[0],
		y: numbers[1],
		width: numbers[2],
		height: numbers[3],
	};
};

const rootViewportLayout = (
	root: SvgElement,
	options: SvgImportOptions,
	issues: ImportIssue[],
): SvgViewportLayout => {
	const fallback = options.fallbackArtboard ?? DEFAULT_FALLBACK_ARTBOARD;
	const viewBox = viewBoxFrom(root.attributes, options.sourceName, issues);
	const parsedWidth = parseNumber(root.attributes.width);
	const parsedHeight = parseNumber(root.attributes.height);
	const width = parsedWidth ?? viewBox?.width ?? fallback.width;
	const height = parsedHeight ?? viewBox?.height ?? fallback.height;
	const safeWidth = width > 0 ? width : fallback.width;
	const safeHeight = height > 0 ? height : fallback.height;
	const safeViewBox = viewBox ?? {
		x: 0,
		y: 0,
		width: safeWidth,
		height: safeHeight,
	};
	const scaleX = safeWidth / safeViewBox.width;
	const scaleY = safeHeight / safeViewBox.height;
	const matrix = multiplyMatrix(
		scaleMatrix(scaleX, scaleY),
		translateMatrix(-safeViewBox.x, -safeViewBox.y),
	);
	return {
		matrix,
		bounds: {
			x: 0,
			y: 0,
			width: safeWidth,
			height: safeHeight,
		},
	};
};

const parseLengthForElement = (
	value: string | undefined,
	fallback: number,
	element: SvgElement,
	sourceName: string | undefined,
	issues: ImportIssue[],
): number => {
	const parsed = parseNumber(value);
	if (parsed !== undefined) return parsed;
	if (value !== undefined) {
		issues.push(
			issueForElement(
				"svg.invalid-length",
				`Length value "${value}" could not be parsed.`,
				element,
				sourceName,
			),
		);
	}
	return fallback;
};

const firstAttribute = (
	attributes: SvgAttributes,
	keys: readonly string[],
): string | undefined => {
	const key = keys.find((candidate) => attributes[candidate] !== undefined);
	return key ? attributes[key] : undefined;
};

const artboardNamePattern =
	/(^|[\s_-])(artboard|page|frame|canvas)([\s_:\-#]|\d|$)/i;

const artboardGroupName = (element: SvgElement): string =>
	element.attributes["data-artboard-name"] ??
	element.attributes["data-page-name"] ??
	element.attributes["data-frame-name"] ??
	element.attributes["data-canvas-name"] ??
	element.attributes["data-name"] ??
	element.attributes["aria-label"] ??
	elementName(element, "Imported Artboard");

const isAffirmativeArtboardAttribute = (value: string | undefined): boolean =>
	value !== undefined &&
	!["", "0", "false", "no"].includes(value.trim().toLowerCase());

const hasArtboardLikeSignal = (element: SvgElement): boolean => {
	if (
		isAffirmativeArtboardAttribute(element.attributes["data-artboard"]) ||
		isAffirmativeArtboardAttribute(element.attributes["data-page"]) ||
		isAffirmativeArtboardAttribute(element.attributes["data-frame"]) ||
		isAffirmativeArtboardAttribute(element.attributes["data-canvas"])
	) {
		return true;
	}
	return artboardNamePattern.test(artboardGroupName(element));
};

const isArtboardLikeGroup = (element: SvgElement): boolean =>
	element.tagName === "g" && hasArtboardLikeSignal(element);

const isUnsupportedNestedSvgArtboardViewport = (element: SvgElement): boolean =>
	element.tagName === "svg" &&
	element.path !== "/svg[0]" &&
	hasArtboardLikeSignal(element);

const artboardGroupSourceBounds = (
	element: SvgElement,
	sourceName: string | undefined,
	issues: ImportIssue[],
): ImportArtboardBounds | undefined => {
	const xValue = firstAttribute(element.attributes, [
		"data-artboard-x",
		"data-page-x",
		"data-frame-x",
		"data-canvas-x",
		"data-x",
		"x",
	]);
	const yValue = firstAttribute(element.attributes, [
		"data-artboard-y",
		"data-page-y",
		"data-frame-y",
		"data-canvas-y",
		"data-y",
		"y",
	]);
	const widthValue = firstAttribute(element.attributes, [
		"data-artboard-width",
		"data-page-width",
		"data-frame-width",
		"data-canvas-width",
		"data-width",
		"width",
	]);
	const heightValue = firstAttribute(element.attributes, [
		"data-artboard-height",
		"data-page-height",
		"data-frame-height",
		"data-canvas-height",
		"data-height",
		"height",
	]);
	const width = parseNumber(widthValue);
	const height = parseNumber(heightValue);
	if (
		width === undefined ||
		height === undefined ||
		width <= 0 ||
		height <= 0
	) {
		issues.push(
			issueForElement(
				"svg.unsupported-artboard-bounds" satisfies SvgArtboardFidelityIssueCode,
				"Named SVG artboard-like group lacked finite width/height metadata, so its children remain on the inherited import artboard.",
				element,
				sourceName,
			),
		);
		return undefined;
	}
	const x = parseNumber(xValue) ?? 0;
	const y = parseNumber(yValue) ?? 0;
	return { x, y, width, height };
};

const createGroupArtboard = (
	element: SvgElement,
	sourceName: string | undefined,
	nextId: ReturnType<typeof makeIdFactory>,
	matrix: Matrix2D,
	issues: ImportIssue[],
): Artboard | undefined => {
	if (!isArtboardLikeGroup(element)) return undefined;
	const sourceBounds = artboardGroupSourceBounds(element, sourceName, issues);
	if (!sourceBounds) return undefined;
	if (Math.abs(matrix.b) > 0.000001 || Math.abs(matrix.c) > 0.000001) {
		issues.push(
			issueForElement(
				"svg.approximated-artboard-transform" satisfies SvgArtboardFidelityIssueCode,
				"Rotated or skewed SVG artboard-like group bounds were mapped to an axis-aligned scene artboard.",
				element,
				sourceName,
				"info",
			),
		);
	}
	issues.push(
		issueForElement(
			"svg.approximated-artboard-group" satisfies SvgArtboardFidelityIssueCode,
			"SVG has no native artboard element; this named group was mapped to a scene artboard from its bounds metadata.",
			element,
			sourceName,
			"info",
		),
	);
	return createImportArtboard({
		id: nextId("artboard", elementRef(element) ?? artboardGroupName(element)),
		name: artboardGroupName(element),
		bounds: transformBounds(matrix, sourceBounds),
	});
};

const parseRequiredLength = (
	value: string | undefined,
	name: string,
	element: SvgElement,
	sourceName: string | undefined,
	issues: ImportIssue[],
): number | undefined => {
	const parsed = parseNumber(value);
	if (parsed !== undefined) return parsed;
	issues.push(
		issueForElement(
			"svg.missing-length",
			`${element.tagName} is missing a valid ${name} value and was skipped.`,
			element,
			sourceName,
			"error",
		),
	);
	return undefined;
};

const imageHrefForElement = (element: SvgElement): string | undefined =>
	element.attributes.href ?? element.attributes["xlink:href"];

const imageGeometryForElement = (
	element: SvgElement,
	sourceName: string | undefined,
	nextId: ReturnType<typeof makeIdFactory>,
	issues: ImportIssue[],
): SvgGeometryImport[] => {
	const href = imageHrefForElement(element);
	if (!href || href.trim().length === 0) {
		issues.push(
			issueForElement(
				"svg.image-missing-reference",
				"SVG image is missing an href and was skipped.",
				element,
				sourceName,
				"error",
			),
		);
		return [];
	}

	const x = parseLengthForElement(
		element.attributes.x,
		0,
		element,
		sourceName,
		issues,
	);
	const y = parseLengthForElement(
		element.attributes.y,
		0,
		element,
		sourceName,
		issues,
	);
	const width = parseRequiredLength(
		element.attributes.width,
		"width",
		element,
		sourceName,
		issues,
	);
	const height = parseRequiredLength(
		element.attributes.height,
		"height",
		element,
		sourceName,
		issues,
	);
	if (
		width === undefined ||
		height === undefined ||
		width <= 0 ||
		height <= 0
	) {
		return [];
	}

	const trimmedHref = href.trim();
	const referenceMode = isImageDataUrl(trimmedHref) ? "data-url" : "reference";
	const assetId = nextId("asset", elementRef(element) ?? "image");
	const name = elementName(element, "Imported image");
	const asset: ImageAsset = {
		id: assetId,
		kind: "image",
		name,
		source:
			referenceMode === "data-url"
				? { kind: "data-url", dataUrl: trimmedHref }
				: { kind: "reference", href: trimmedHref },
		...(referenceMode === "data-url"
			? { mimeType: mimeTypeFromImageDataUrl(trimmedHref) }
			: {}),
		width,
		height,
	};

	if (referenceMode === "reference") {
		issues.push({
			...issueForElement(
				"svg.image-reference-fallback",
				"SVG image reference was kept as document asset metadata; bytes are not embedded in the scene document.",
				element,
				sourceName,
				"info",
			),
			assetId,
			fallbackType: "external-image-reference",
		});
	}

	return [
		{
			geometry: {
				kind: "image",
				bounds: { x, y, width, height },
				assetId,
			},
			asset,
			imageFidelity: {
				source: "svg-image",
				assetId,
				sourcePath: element.path,
				referenceMode,
				...(referenceMode === "reference" ? { href: trimmedHref } : {}),
			},
		},
	];
};

const geometryForElement = (
	element: SvgElement,
	sourceName: string | undefined,
	nextId: ReturnType<typeof makeIdFactory>,
	issues: ImportIssue[],
): readonly SvgGeometryImport[] => {
	if (element.tagName === "rect") {
		const x = parseLengthForElement(
			element.attributes.x,
			0,
			element,
			sourceName,
			issues,
		);
		const y = parseLengthForElement(
			element.attributes.y,
			0,
			element,
			sourceName,
			issues,
		);
		const width = parseRequiredLength(
			element.attributes.width,
			"width",
			element,
			sourceName,
			issues,
		);
		const height = parseRequiredLength(
			element.attributes.height,
			"height",
			element,
			sourceName,
			issues,
		);
		if (
			width === undefined ||
			height === undefined ||
			width <= 0 ||
			height <= 0
		) {
			return [];
		}
		const rx = parseNumber(element.attributes.rx);
		const ry = parseNumber(element.attributes.ry);
		if (rx !== undefined && ry !== undefined && Math.abs(rx - ry) > 0.000001) {
			issues.push(
				issueForElement(
					"svg.approximated-rounded-rect",
					"Different rect rx/ry values were approximated to one corner radius.",
					element,
					sourceName,
					"info",
				),
			);
		}
		const cornerRadius = Math.min(
			width / 2,
			height / 2,
			Math.max(0, Math.min(rx ?? ry ?? 0, ry ?? rx ?? 0)),
		);
		return [
			{
				geometry: {
					kind: "rect",
					bounds: { x, y, width, height },
					cornerRadius,
				},
			},
		];
	}

	if (element.tagName === "ellipse" || element.tagName === "circle") {
		const cx = parseLengthForElement(
			element.attributes.cx,
			0,
			element,
			sourceName,
			issues,
		);
		const cy = parseLengthForElement(
			element.attributes.cy,
			0,
			element,
			sourceName,
			issues,
		);
		const radius = parseNumber(element.attributes.r);
		const rx =
			element.tagName === "circle"
				? radius
				: parseRequiredLength(
						element.attributes.rx,
						"rx",
						element,
						sourceName,
						issues,
					);
		const ry =
			element.tagName === "circle"
				? radius
				: parseRequiredLength(
						element.attributes.ry,
						"ry",
						element,
						sourceName,
						issues,
					);
		if (rx === undefined || ry === undefined || rx <= 0 || ry <= 0) return [];
		return [
			{
				geometry: {
					kind: "ellipse",
					bounds: { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 },
				},
			},
		];
	}

	if (element.tagName === "line") {
		const x1 = parseLengthForElement(
			element.attributes.x1,
			0,
			element,
			sourceName,
			issues,
		);
		const y1 = parseLengthForElement(
			element.attributes.y1,
			0,
			element,
			sourceName,
			issues,
		);
		const x2 = parseLengthForElement(
			element.attributes.x2,
			0,
			element,
			sourceName,
			issues,
		);
		const y2 = parseLengthForElement(
			element.attributes.y2,
			0,
			element,
			sourceName,
			issues,
		);
		return [
			{
				geometry: {
					kind: "line",
					start: { x: x1, y: y1 },
					end: { x: x2, y: y2 },
				},
			},
		];
	}

	if (element.tagName === "polygon") {
		const points = parsePoints(element.attributes.points);
		if (points.length < 3) {
			issues.push(
				issueForElement(
					"svg.invalid-points",
					"Polygon points were invalid or had fewer than three vertices.",
					element,
					sourceName,
					"error",
				),
			);
			return [];
		}
		return [{ geometry: { kind: "polygon", points } }];
	}

	if (element.tagName === "path") {
		const pathData = element.attributes.d;
		if (!pathData) {
			issues.push(
				issueForElement(
					"svg.missing-path-data",
					"Path is missing a d attribute and was skipped.",
					element,
					sourceName,
					"error",
				),
			);
			return [];
		}
		const fillRule = styleProperty(element.attributes, "fill-rule");
		const result = svgPathDataToAeShapes(pathData, {
			sourceName,
			ref: elementRef(element),
			path: element.path,
		});
		issues.push(...result.issues);

		const nested = nestedSubpathIndices(result.shapes);
		const outerIndices = result.shapes
			.map((_, index) => index)
			.filter((index) => !nested.has(index));
		// A single outer contour with nested holes (donut, letter counter, window
		// cutout) is preserved as ONE editable compound path, so the hole stays cut
		// and the fill rule is honored — no fidelity loss.
		if (
			result.shapes.length > 1 &&
			nested.size > 0 &&
			outerIndices.length === 1
		) {
			const outerIndex = outerIndices[0];
			const subpaths = result.shapes.filter((_, index) => index !== outerIndex);
			const resolvedFillRule =
				fillRule?.toLowerCase() === "evenodd" ? "evenodd" : "nonzero";
			issues.push(
				issueForElement(
					"svg.compound-path-preserved",
					`Compound path with ${subpaths.length} hole subpath${subpaths.length === 1 ? "" : "s"} was imported as a single editable path using the ${resolvedFillRule} fill rule.`,
					element,
					sourceName,
					"info",
				),
			);
			return [
				{
					geometry: {
						kind: "path",
						shape: result.shapes[outerIndex],
						subpaths,
						fillRule: resolvedFillRule,
					},
				},
			];
		}

		// Not a preservable compound: a non-nonzero fill rule is not stored on a
		// single contour, so note the approximation.
		if (fillRule && fillRule.toLowerCase() !== "nonzero") {
			issues.push(
				issueForElement(
					"svg.approximated-fill-rule",
					`Path fill-rule "${fillRule}" is not represented in the scene model and was imported with the default fill rule.`,
					element,
					sourceName,
					"info",
				),
			);
		}
		// Disjoint subpaths (e.g. an Apple-logo body + detached leaf) render
		// identically once split. Only nested holes that span multiple outer
		// shapes still lose their cutout, so warn there. Hole topology, not subpath
		// count, is the discriminator.
		if (result.shapes.length > 1 && nested.size > 0) {
			issues.push(
				issueForElement(
					"svg.approximated-compound-path-split",
					"A compound path with multiple outer shapes was split into separate editable paths, so a nested hole is no longer cut; only single-outer holes are preserved.",
					element,
					sourceName,
				),
			);
		}
		const compoundPath =
			result.shapes.length > 1
				? ({
						source: "svg-path",
						fillRule: fillRule ?? "nonzero",
						subpathCount: result.shapes.length,
						sourcePath: element.path,
					} satisfies Omit<SvgCompoundPathFidelityData, "subpathIndex">)
				: undefined;
		return result.shapes.map((shape, index) => ({
			geometry: { kind: "path", shape },
			...(compoundPath
				? {
						compoundPath: {
							...compoundPath,
							subpathIndex: index,
						},
					}
				: {}),
		}));
	}

	if (element.tagName === "text") {
		const text = normalizedTextContent(element);
		if (text.length === 0) {
			issues.push(
				issueForElement(
					"svg.empty-text",
					"Text element contained no importable text content and was skipped.",
					element,
					sourceName,
					"info",
				),
			);
			return [];
		}
		issues.push(
			issueForElement(
				"svg.approximated-text-metrics",
				"SVG text was imported as editable scene text with approximated bounds; font metrics are not preserved in the scene model.",
				element,
				sourceName,
				"info",
			),
		);
		if (element.children.length > 0) {
			issues.push(
				issueForElement(
					"svg.approximated-text-spans",
					"Nested SVG text spans were flattened into one editable scene text node.",
					element,
					sourceName,
					"info",
				),
			);
		}
		if (hasDescendantTag(element, "textpath")) {
			issues.push(
				issueForElement(
					"svg.unsupported-text-path",
					"SVG textPath layout was flattened into a regular editable text box.",
					element,
					sourceName,
				),
			);
		}
		return [
			{
				geometry: {
					kind: "text",
					bounds: textBoundsFor(element, sourceName, issues),
					text,
					style: textStyleFor(element.attributes),
				},
				textFidelity: {
					source: "svg-text",
					metrics: "estimated",
					spansFlattened: element.children.length > 0,
					sourcePath: element.path,
				},
			},
		];
	}

	if (element.tagName === "image") {
		return imageGeometryForElement(element, sourceName, nextId, issues);
	}

	return [];
};

const parsePoints = (value: string | undefined): readonly Vec2[] => {
	if (!value) return [];
	const numbers = parseNumberList(value);
	if (numbers.length % 2 !== 0) return [];
	const points: Vec2[] = [];
	for (let index = 0; index < numbers.length; index += 2) {
		points.push({ x: numbers[index], y: numbers[index + 1] });
	}
	return points;
};

const makeIdFactory = (prefix: string | undefined) => {
	const counts = new Map<string, number>();
	const namespace = sanitizeIdPart(prefix) ?? "svg";

	return (
		kind: "artboard" | "asset" | "layer" | "node",
		preferred: string | undefined,
	): string => {
		const base = `${kind}-${namespace}-${sanitizeIdPart(preferred) ?? kind}`;
		const count = counts.get(base) ?? 0;
		counts.set(base, count + 1);
		return count === 0 ? base : `${base}-${count + 1}`;
	};
};

const nodeData = (
	nodeId: string,
	element: SvgElement,
	sourceName: string | undefined,
	paintFidelity: SvgPaintFidelityData,
	strokeFidelity: SvgStrokeFidelityData,
	effects: readonly SvgEffectFidelityData[],
	opacityGroups: readonly SvgOpacityGroupFidelityData[],
	compoundPath: SvgCompoundPathFidelityData | undefined,
	imageFidelity: SvgImageFidelityData | undefined,
	textFidelity: SvgTextFidelityData | undefined,
): Record<string, unknown> => {
	const data: Record<string, unknown> = {
		importElement: element.tagName,
		importFormat: SVG_SOURCE_FORMAT,
		importPath: element.path,
	};
	if (sourceName) data.importSource = sourceName;
	const ref = elementRef(element);
	if (ref) data.importRef = ref;
	const importPaint = paintFidelityData(paintFidelity);
	if (importPaint) data.importPaint = importPaint;
	const importStroke = strokeFidelityData(strokeFidelity);
	if (importStroke) data.importStroke = importStroke;
	const importEffects = importEffectsData(effects);
	if (importEffects) data.importEffects = importEffects;
	if (compoundPath) data.importCompoundPath = { ...compoundPath };
	if (imageFidelity) data.importImage = { ...imageFidelity };
	const clipMaskRelations = effects.flatMap((effect) => {
		const relation = createImportedClipMaskRelationMetadata({
			...effect,
			affectedNodeIds: [nodeId],
		});
		return relation ? [relation] : [];
	});
	const importAppearance = createImportedAppearanceMetadataData({
		paint: paintFidelity,
		effects,
		opacityGroups,
		clipMaskRelations,
		...(compoundPath ? { compoundPath } : {}),
	});
	if (importAppearance) data.importAppearance = importAppearance;
	if (textFidelity) data.importText = { ...textFidelity };
	return data;
};

const makeNodesForElement = (
	element: SvgElement,
	state: TraverseState,
	sourceName: string | undefined,
	nextId: ReturnType<typeof makeIdFactory>,
	issues: ImportIssue[],
): {
	readonly nodes: readonly VectorNode[];
	readonly assets: readonly SceneAsset[];
} => {
	const context = {
		sourceName,
		ref: elementRef(element),
		path: element.path,
	};
	const styled = applyStyle(
		state.style,
		state.paintFidelity,
		element.attributes,
		context,
		issues,
		state.paintServers,
	);
	const strokeFidelity = applyStrokeFidelity(
		state.strokeFidelity,
		element.attributes,
		context,
		issues,
	);
	const localTransform = parseTransformAttribute(
		element.attributes.transform,
		context,
	);
	issues.push(...localTransform.issues);
	const matrix = multiplyMatrix(state.matrix, localTransform.matrix);
	const transform = matrixToTransform(matrix, context, issues);
	const geometries = geometryForElement(element, sourceName, nextId, issues);
	const baseName = elementName(element, element.tagName);
	const effects = [
		...state.effects,
		...unsupportedEffectFidelityData(element.attributes, element.path),
	];

	const nodes = geometries.map((importedGeometry, index) => {
		const name = geometries.length > 1 ? `${baseName} ${index + 1}` : baseName;
		const nodeId = nextId(
			"node",
			elementRef(element) ?? `${element.tagName}-${index + 1}`,
		);
		const style = styleWithStrokeFidelity(styled.style, strokeFidelity);
		return {
			id: nodeId,
			name,
			artboardId: state.artboardId,
			geometry: importedGeometry.geometry,
			transform,
			style,
			visible: true,
			locked: false,
			data: nodeData(
				nodeId,
				element,
				sourceName,
				styled.paintFidelity,
				strokeFidelity,
				effects,
				state.opacityGroups,
				importedGeometry.compoundPath,
				importedGeometry.imageFidelity,
				importedGeometry.textFidelity,
			),
		};
	});
	return {
		nodes,
		assets: geometries.flatMap((importedGeometry) =>
			importedGeometry.asset ? [importedGeometry.asset] : [],
		),
	};
};

const flattenedNodes = (nodes: readonly VectorNode[]): readonly VectorNode[] =>
	nodes.flatMap((node) => [node, ...flattenedNodes(node.children ?? [])]);

const clipMaskKindForIssue = (
	issue: ImportIssue,
): "clip-path" | "mask" | undefined => {
	if (issue.code.endsWith("clip-path")) return "clip-path";
	if (issue.code.endsWith("mask")) return "mask";
	return undefined;
};

const stringDataField = (
	data: Record<string, unknown> | undefined,
	field: string,
): string | undefined => {
	const value = data?.[field];
	return typeof value === "string" && value.length > 0 ? value : undefined;
};

type SourceLocatorMetadata = {
	readonly ref?: string;
	readonly sourcePath?: string;
};

const sourceLocatorMatches = (
	issue: ImportIssue,
	metadata: SourceLocatorMetadata,
): boolean =>
	(issue.path !== undefined && metadata.sourcePath === issue.path) ||
	(issue.ref !== undefined && metadata.ref === issue.ref);

const importedPaintEntries = (
	node: VectorNode,
): readonly SourceLocatorMetadata[] => {
	const paint = readImportedPaint(node);
	const entries: SourceLocatorMetadata[] = [];
	if (paint?.fill) entries.push(paint.fill);
	if (paint?.stroke) entries.push(paint.stroke);
	return entries;
};

const nodeMatchesImportIssue = (
	issue: ImportIssue,
	node: VectorNode,
): boolean => {
	const importPath = stringDataField(node.data, "importPath");
	const importRef = stringDataField(node.data, "importRef");
	if (issue.path !== undefined && importPath === issue.path) return true;
	if (issue.ref !== undefined && importRef === issue.ref) return true;
	if (
		readImportedEffects(node).some((effect) =>
			sourceLocatorMatches(issue, effect),
		)
	) {
		return true;
	}
	if (
		readImportedClipMaskRelations(node).some((relation) =>
			sourceLocatorMatches(issue, relation),
		)
	) {
		return true;
	}
	if (
		readImportedOpacityGroups(node).some((group) =>
			sourceLocatorMatches(issue, group),
		)
	) {
		return true;
	}
	if (
		importedPaintEntries(node).some((paint) =>
			sourceLocatorMatches(issue, paint),
		)
	) {
		return true;
	}
	const compoundPath = readImportedCompoundPath(node);
	return compoundPath ? sourceLocatorMatches(issue, compoundPath) : false;
};

const targetKey = (target: ImportIssueAffectedTarget): string =>
	`${target.kind}:${target.id}`;

const uniqueTargets = (
	targets: readonly ImportIssueAffectedTarget[],
): readonly ImportIssueAffectedTarget[] => [
	...new Map(targets.map((target) => [targetKey(target), target])).values(),
];

const attachImportIssueTargetMetadata = (
	issues: readonly ImportIssue[],
	nodes: readonly VectorNode[],
): readonly ImportIssue[] => {
	const importedNodes = flattenedNodes(nodes);
	return issues.map((issue) => {
		const kind = clipMaskKindForIssue(issue);
		const affectedNodeIds = importedNodes.flatMap((node) => {
			if (kind) {
				const matches = readImportedClipMaskRelations(node).some(
					(relation) =>
						relation.kind === kind && sourceLocatorMatches(issue, relation),
				);
				return matches ? [node.id] : [];
			}
			return nodeMatchesImportIssue(issue, node) ? [node.id] : [];
		});
		if (affectedNodeIds.length === 0) return issue;
		const affectedTargets = uniqueTargets([
			...(issue.affectedTargets ?? []),
			...affectedNodeIds.map(
				(id) => ({ kind: "node", id }) satisfies ImportIssueAffectedTarget,
			),
		]);
		return {
			...issue,
			affectedTargets,
			...(kind && !issue.fallbackType
				? { fallbackType: "unclipped-vector" }
				: {}),
			...(affectedNodeIds.length === 1 && !issue.nodeId
				? { nodeId: affectedNodeIds[0] }
				: {}),
		};
	});
};

const traverseElement = (
	element: SvgElement,
	state: TraverseState,
	sourceName: string | undefined,
	nextId: ReturnType<typeof makeIdFactory>,
	issues: ImportIssue[],
	artboards: Artboard[],
	assets: SceneAsset[],
	nodes: VectorNode[],
) => {
	if (nonRenderingTags.has(element.tagName)) return;

	const context = {
		sourceName,
		ref: elementRef(element),
		path: element.path,
	};

	if (definitionTags.has(element.tagName)) {
		if (!supportedDefinitionTag(element.tagName)) {
			issues.push(
				issueForElement(
					definitionIssueCode(element.tagName),
					`${element.tagName} definitions are not represented in the scene model.`,
					element,
					sourceName,
				),
			);
		}
		for (const child of element.children) {
			traverseElement(
				child,
				{ ...state, renderable: false },
				sourceName,
				nextId,
				issues,
				artboards,
				assets,
				nodes,
			);
		}
		return;
	}

	if (!state.renderable) return;

	if (supportedShapeTags.has(element.tagName)) {
		const result = makeNodesForElement(
			element,
			state,
			sourceName,
			nextId,
			issues,
		);
		nodes.push(...result.nodes);
		assets.push(...result.assets);
		return;
	}

	if (unsupportedRenderableTags.has(element.tagName)) {
		issues.push(
			issueForElement(
				unsupportedRenderableIssueCode(element.tagName),
				unsupportedRenderableMessage(element),
				element,
				sourceName,
			),
		);
		return;
	}

	const opacityGroup = opacityGroupFidelityData(element, sourceName, issues);

	const styled = applyStyle(
		state.style,
		state.paintFidelity,
		element.attributes,
		context,
		issues,
		state.paintServers,
	);
	const styledState: TraverseState = {
		style: styled.style,
		paintFidelity: styled.paintFidelity,
		strokeFidelity: applyStrokeFidelity(
			state.strokeFidelity,
			element.attributes,
			context,
			issues,
		),
		effects: [
			...state.effects,
			...unsupportedEffectFidelityData(element.attributes, element.path),
		],
		opacityGroups: [
			...state.opacityGroups,
			...(opacityGroup ? [opacityGroup] : []),
		],
		matrix: state.matrix,
		artboardId: state.artboardId,
		renderable: state.renderable,
		paintServers: state.paintServers,
	};
	const localTransform = parseTransformAttribute(
		element.attributes.transform,
		context,
	);
	issues.push(...localTransform.issues);
	const transformedState = {
		...styledState,
		matrix: multiplyMatrix(styledState.matrix, localTransform.matrix),
	};

	if (
		element.tagName === "svg" ||
		element.tagName === "g" ||
		element.tagName === "a"
	) {
		if (isUnsupportedNestedSvgArtboardViewport(element)) {
			issues.push(
				issueForElement(
					"svg.unsupported-artboard-viewport" satisfies SvgArtboardFidelityIssueCode,
					"Nested SVG artboard/page/canvas viewport metadata is not mapped yet; its children remain on the inherited import artboard.",
					element,
					sourceName,
				),
			);
		}
		const groupArtboard = createGroupArtboard(
			element,
			sourceName,
			nextId,
			transformedState.matrix,
			issues,
		);
		const childState = groupArtboard
			? {
					...transformedState,
					artboardId: groupArtboard.id,
					matrix: multiplyMatrix(
						translateMatrix(
							-(groupArtboard.position?.x ?? 0),
							-(groupArtboard.position?.y ?? 0),
						),
						transformedState.matrix,
					),
				}
			: transformedState;
		if (groupArtboard) artboards.push(groupArtboard);
		for (const child of element.children) {
			traverseElement(
				child,
				childState,
				sourceName,
				nextId,
				issues,
				artboards,
				assets,
				nodes,
			);
		}
		return;
	}

	issues.push(
		issueForElement(
			"svg.unsupported-element",
			`${element.tagName} is not imported in the first SVG subset.`,
			element,
			sourceName,
		),
	);
};

/**
 * Converts SVG text into import-ready scene layers without touching React,
 * Zustand stores, command history, DOMParser, or browser-only APIs. The first
 * subset preserves editable primitives and reports unsupported SVG features as
 * ImportIssue diagnostics instead of silently dropping source content.
 */
export function parseSvgToImportedScenePayload(
	svgText: string,
	options: SvgImportOptions = {},
): ImportedScenePayload {
	const parsed = parseSvgXml(svgText, options.sourceName);
	const issues = [...parsed.issues];
	const root = parsed.root;

	if (root?.tagName !== "svg") {
		return {
			sourceName: options.sourceName,
			sourceFormat: SVG_SOURCE_FORMAT,
			issues: [
				...issues,
				makeIssue(
					"svg.missing-root",
					"SVG import requires a root <svg> element.",
					{ sourceName: options.sourceName },
					"error",
				),
			],
			layers: [],
		};
	}

	const viewport = rootViewportLayout(root, options, issues);
	const paintServers = collectPaintServers(root);
	const nextId = makeIdFactory(
		options.idPrefix ?? options.sourceName ?? root.attributes.id,
	);
	const rootArtboard = createImportArtboard({
		id: nextId(
			"artboard",
			root.attributes.id ?? options.layerName ?? options.sourceName ?? "root",
		),
		name: options.layerName ?? root.attributes.id ?? "Imported SVG",
		bounds: viewport.bounds,
	});
	const artboards: Artboard[] = [rootArtboard];
	const assets: SceneAsset[] = [];
	const nodes: VectorNode[] = [];
	const state: TraverseState = {
		style: DEFAULT_STYLE,
		paintFidelity: {},
		strokeFidelity: {},
		effects: [],
		opacityGroups: [],
		matrix: viewport.matrix,
		artboardId: rootArtboard.id,
		renderable: true,
		paintServers,
	};

	traverseElement(
		root,
		state,
		options.sourceName,
		nextId,
		issues,
		artboards,
		assets,
		nodes,
	);

	const layer: SceneLayer = {
		id: nextId(
			"layer",
			root.attributes.id ?? options.layerName ?? options.sourceName,
		),
		name: options.layerName ?? root.attributes.id ?? "Imported SVG",
		visible: true,
		locked: false,
		nodes,
	};

	return {
		sourceName: options.sourceName,
		sourceFormat: SVG_SOURCE_FORMAT,
		issues: attachImportIssueTargetMetadata(issues, nodes),
		artboards,
		currentArtboardId: rootArtboard.id,
		...(assets.length > 0 ? { assets } : {}),
		layers: nodes.length > 0 ? [layer] : [],
	};
}

export const SVG_IMPORT_SUPPORTED_SUBSET = [
	"path",
	"rect",
	"ellipse",
	"circle-as-ellipse",
	"line",
	"polygon",
	"text-basic",
	"image-data-url",
	"image-reference-metadata",
	"fill",
	"stroke",
	"stroke-width",
	"linear-gradient-paint",
	"radial-gradient-paint",
	"blend-mode",
	"stroke-dasharray",
	"stroke-linecap",
	"stroke-linejoin",
	"stroke-miterlimit",
	"stroke-dashoffset",
	"stroke-dasharray-source-metadata",
	"stroke-linecap-source-metadata",
	"stroke-linejoin-source-metadata",
	"opacity",
	"opacity-group-source-metadata",
	"text-style-basic",
	"translate",
	"scale",
	"rotate",
	"matrix-without-skew",
	"width-height-viewBox",
	"root-viewport-artboard",
	"bounded-artboard-groups",
] as const;

export const SVG_IMPORT_UNSUPPORTED_SUBSET = [
	"advanced-gradient-spread",
	"advanced-gradient-focal-point",
	"filters",
	"mesh-gradient-paint",
	"masks",
	"clipPath",
	"patterns",
	"text-font-metrics",
	"text-rich-spans",
	"image-pixel-decoding",
	"image-reference-fetching",
	"use",
	"polyline",
	"path-arcs",
	"path-fill-rule",
	"compound-paths",
	"opacity-groups",
	"markers",
	"text-path",
	"unsupported-blend-modes",
	"skew",
	"nested-svg-artboard-viewports",
	"unbounded-artboard-groups",
] as const;
