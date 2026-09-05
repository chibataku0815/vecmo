import {
	createImportedAppearanceMetadataData,
	createImportedClipMaskRelationMetadata,
	readImportedClipMaskRelations,
	readImportedCompoundPath,
	readImportedEffects,
	readImportedPaint,
} from "@/entities/scene/model/appearance";
import {
	type Matrix2D,
	transformFromMatrix,
} from "@/entities/scene/model/rendering";
import { normalizeTextStyle } from "@/entities/scene/model/text-geometry";
import type {
	Artboard,
	BezierShape,
	BlendMode,
	GradientStop,
	LinearGradientPaint,
	NodeGeometry,
	NodeStyle,
	RadialGradientPaint,
	SceneLayer,
	StrokeCap,
	StrokeJoin,
	TextStyle,
	Transform,
	Vec2,
	VectorNode,
} from "@/entities/scene/model/types";
import { IDENTITY_TRANSFORM } from "@/entities/scene/model/types";
import type { AePoint } from "@/shared/glammer/ae-shape";
import {
	createImportArtboard,
	IMPORT_ARTBOARD_GAP,
	type ImportArtboardBounds,
} from "./artboard-mapping";
import type {
	ImportedScenePayload,
	ImportIssue,
	ImportIssueAffectedTarget,
	ImportIssueSeverity,
} from "./types";

const PDF_HEADER = "%PDF-";
const PDF_HEADER_SCAN_LIMIT = 1024;
const DEFAULT_SCAN_TEXT_BYTES = 1_048_576;
const PDF_MEDIA_TYPE = "application/pdf";
const AI_PDF_COMPATIBLE_SOURCE_FORMAT = "ai/pdf-compatible";
const AI_NATIVE_OR_LEGACY_SOURCE_FORMAT = "ai/native-or-legacy";
const UNKNOWN_SOURCE_FORMAT = "unknown";
const DEFAULT_PDF_BOX = { x: 0, y: 0, width: 1024, height: 768 } as const;
const DEFAULT_PDF_STYLE: NodeStyle = {
	fill: "#000000",
	stroke: "none",
	strokeWidth: 1,
	opacity: 1,
};
const DEFAULT_PDF_TEXT_STYLE = normalizeTextStyle({
	fontFamily: "sans-serif",
	fontSize: 12,
	lineHeight: 14.4,
	align: "left",
	fontWeight: 400,
});
const IDENTITY_MATRIX: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const PDF_IMPORT_SUPPORTED_SUBSET = [
	"uncompressed-page-content-streams",
	"MediaBox-CropBox-ArtBox",
	"page-artboard-mapping",
	"q-Q-graphics-state",
	"cm-transforms",
	"m-l-c-v-y-h-re-paths",
	"f-F-S-s-B-b-paint",
	"simple-gradient-shading-paint",
	"rgb-gray-cmyk-colors",
	"stroke-width",
	"stroke-dash-cap-join-miter-style",
	"stroke-detail-source-metadata",
	"ExtGState-opacity",
	"ExtGState-blend-mode",
	"appearance-source-metadata",
	"text-basic",
] as const;
const PDF_IMPORT_UNSUPPORTED_SUBSET = [
	"compressed-streams",
	"native-ai-private-data",
	"advanced-text-layout",
	"images",
	"xobjects",
	"patterns",
	"advanced-gradient-shadings",
	"clips",
	"soft-masks",
	"transparency-groups",
	"alpha-source",
	"dash-phase",
	"unsupported-blend-modes",
	"custom-color-spaces",
	"text-rendering-clips",
] as const;

export type AiImportIssueCode =
	| "ai.empty_input"
	| "ai.illustrator_marker_missing"
	| "ai.native_private_data_unsupported"
	| "ai.pdf_approximated_cmyk_color"
	| "ai.pdf_approximated_fill_rule"
	| "ai.pdf_approximated_hairline_stroke"
	| "ai.pdf_approximated_opacity"
	| "ai.pdf_approximated_shading"
	| "ai.pdf_approximated_stroke_dash"
	| "ai.pdf_approximated_stroke_dash_phase"
	| "ai.pdf_approximated_stroke_linecap"
	| "ai.pdf_approximated_stroke_linejoin"
	| "ai.pdf_approximated_stroke_miter_limit"
	| "ai.pdf_approximated_text_font"
	| "ai.pdf_approximated_text_metrics"
	| "ai.pdf_approximated_text_spacing"
	| "ai.pdf_approximated_transform"
	| "ai.pdf_compound_path_split"
	| "ai.pdf_content_stream_missing"
	| "ai.pdf_degenerate_path"
	| "ai.pdf_invalid_content_stream"
	| "ai.pdf_invalid_operator_operands"
	| "ai.pdf_multiple_pages_unsupported"
	| "ai.pdf_page_box_missing"
	| "ai.pdf_payload_detected"
	| "ai.pdf_payload_missing"
	| "ai.pdf_scene_conversion_pending"
	| "ai.pdf_scene_imported"
	| "ai.pdf_unsupported_clipping_path"
	| "ai.pdf_unsupported_blend_mode"
	| "ai.pdf_unsupported_color_space"
	| "ai.pdf_unsupported_extgstate"
	| "ai.pdf_unsupported_filter"
	| "ai.pdf_unsupported_inline_image"
	| "ai.pdf_unsupported_invisible_text"
	| "ai.pdf_unsupported_operator"
	| "ai.pdf_unsupported_shading"
	| "ai.pdf_unsupported_soft_mask"
	| "ai.pdf_unsupported_text"
	| "ai.pdf_unsupported_text_clipping"
	| "ai.pdf_unsupported_transparency_group"
	| "ai.pdf_unsupported_xobject";

export type AiImportIssue = ImportIssue & {
	readonly code: AiImportIssueCode;
};

export type AiImportFidelityReport = {
	readonly accepted: boolean;
	readonly sourceFormat: string;
	readonly importedCount: number;
	readonly approximatedCount: number;
	readonly unsupportedCount: number;
	readonly artboardCount: number;
	readonly artboardSummary: {
		readonly imported: number;
		readonly approximated: number;
		readonly unsupported: number;
	};
	readonly summary: {
		readonly imported: number;
		readonly approximated: number;
		readonly unsupported: number;
	};
	readonly issueCounts: Readonly<Record<ImportIssueSeverity, number>>;
	readonly issueCodes: readonly AiImportIssueCode[];
};

export type AiPdfBox = {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
};

export type AiPdfMetadata = {
	readonly pdfVersion?: string;
	readonly pageCount?: number;
	readonly title?: string;
	readonly creator?: string;
	readonly producer?: string;
	readonly creationDate?: string;
	readonly modifiedDate?: string;
	readonly mediaBox?: AiPdfBox;
	readonly cropBox?: AiPdfBox;
	readonly artBox?: AiPdfBox;
	readonly illustratorMarkers: readonly string[];
};

export type AiImportSource = string | ArrayBuffer | Uint8Array;

export type AnalyzeAiImportOptions = {
	readonly sourceName?: string;
	readonly scanTextBytes?: number;
	readonly layerName?: string;
	readonly idPrefix?: string;
};

/**
 * Boundary object for the dependency-free PDF-compatible vector import path.
 * The bytes remain available for a fuller adapter later, while the MVP parser
 * emits editable scene payloads from the supported uncompressed graphics subset.
 */
export type AiPdfCompatibleAdapterPayload = {
	readonly kind: "pdf-compatible-ai-payload";
	readonly targetPipeline: "pdf-compatible-import";
	readonly mediaType: typeof PDF_MEDIA_TYPE;
	readonly sourceFormat: typeof AI_PDF_COMPATIBLE_SOURCE_FORMAT;
	readonly sourceName?: string;
	readonly bytes: Uint8Array;
	readonly metadata: AiPdfMetadata;
};

export type AiPdfCompatibleImportResult = {
	readonly kind: "pdf-compatible";
	readonly supported: true;
	readonly sourceFormat: typeof AI_PDF_COMPATIBLE_SOURCE_FORMAT;
	readonly sourceName?: string;
	readonly metadata: AiPdfMetadata;
	readonly issues: readonly AiImportIssue[];
	readonly fidelityReport: AiImportFidelityReport;
	readonly adapterPayload: AiPdfCompatibleAdapterPayload;
	readonly scenePayload: ImportedScenePayload;
};

export type AiUnsupportedImportResult = {
	readonly kind: "unsupported";
	readonly supported: false;
	readonly sourceFormat:
		| typeof AI_NATIVE_OR_LEGACY_SOURCE_FORMAT
		| typeof UNKNOWN_SOURCE_FORMAT;
	readonly sourceName?: string;
	readonly metadata: AiPdfMetadata;
	readonly issues: readonly AiImportIssue[];
	readonly fidelityReport: AiImportFidelityReport;
};

export type AiImportAnalysis =
	| AiPdfCompatibleImportResult
	| AiUnsupportedImportResult;

type PdfObject = {
	readonly id: number;
	readonly generation: number;
	readonly body: string;
	readonly dictionary: string;
	readonly stream?: string;
	readonly filter?: string;
};

type PdfExtGState = {
	readonly fillOpacity?: number;
	readonly strokeOpacity?: number;
	readonly blendMode?: BlendMode;
	readonly unsupportedBlendMode?: string;
	readonly unsupportedEntries: readonly string[];
};

type PdfGradientPaint = LinearGradientPaint | RadialGradientPaint;

type PdfShadingResource = {
	readonly kind: "axial" | "radial";
	readonly ref: string;
	readonly sourcePath: string;
	readonly bounds: AiPdfBox;
	readonly fallbackColor: string;
	readonly paint: PdfGradientPaint;
};

type PdfOperand =
	| {
			readonly kind: "number";
			readonly value: number;
	  }
	| {
			readonly kind: "name";
			readonly name: string;
	  }
	| {
			readonly kind: "string";
			readonly value: string;
	  };

type PdfToken =
	| PdfOperand
	| {
			readonly kind: "operator";
			readonly operator: string;
	  };

type Point = {
	readonly x: number;
	readonly y: number;
};

type MutableSubpath = {
	closed: boolean;
	sourceKind?: "rect";
	readonly vertices: AePoint[];
	readonly inTangents: AePoint[];
	readonly outTangents: AePoint[];
};

type PathBuilder = {
	current?: Point;
	start?: Point;
	active?: MutableSubpath;
	readonly subpaths: MutableSubpath[];
};

type GraphicsState = {
	readonly ctm: Matrix2D;
	readonly fillColor: string;
	readonly strokeColor: string;
	readonly strokeWidth: number;
	readonly fillOpacity: number;
	readonly strokeOpacity: number;
	readonly lineCap: PdfLineCap;
	readonly lineJoin: PdfLineJoin;
	readonly miterLimit: number;
	readonly dashArray: readonly number[];
	readonly dashPhase: number;
	readonly blendMode?: BlendMode;
	readonly unsupportedEffects: readonly PdfUnsupportedEffectData[];
};

type PdfTextState = {
	readonly active: boolean;
	readonly fontName?: string;
	readonly fontSize: number;
	readonly leading: number;
	readonly renderingMode: PdfTextRenderingMode;
	readonly textMatrix: Matrix2D;
	readonly lineMatrix: Matrix2D;
};

type PdfTextRenderingMode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

type PdfLineCap = "butt" | "round" | "projecting-square";

type PdfLineJoin = "miter" | "round" | "bevel";

type PdfStrokeFidelityData = {
	readonly dashArray?: readonly number[];
	readonly dashPhase?: number;
	readonly lineCap?: PdfLineCap;
	readonly lineJoin?: PdfLineJoin;
	readonly miterLimit?: number;
};

type PdfUnsupportedEffectData = {
	readonly kind: "alpha-source" | "blend-mode" | "clip-path" | "soft-mask";
	readonly value: string;
	readonly sourcePath: string;
};

type PdfCompoundPathFidelityData = {
	readonly source: "pdf-path";
	readonly fillRule: "evenodd" | "nonzero";
	readonly subpathCount: number;
	readonly subpathIndex: number;
	readonly sourcePath: string;
};

type PdfTextFidelityData = {
	readonly source: "pdf-text";
	readonly metrics: "estimated";
	readonly fontFallback: true;
	readonly spacingFlattened: boolean;
	readonly sourcePath: string;
};

type PaintMode = {
	readonly fill: boolean;
	readonly stroke: boolean;
	readonly close: boolean;
	readonly evenOdd: boolean;
	readonly operator: string;
};

type PdfParseContext = {
	readonly sourceName?: string;
	readonly layerName?: string;
	readonly idPrefix?: string;
	readonly metadata: AiPdfMetadata;
	readonly fullText: string;
	readonly issueKeys: Set<string>;
};

type PdfContentContext = PdfParseContext & {
	readonly streamPath: string;
	readonly pageIndex: number;
	readonly artboardId: string;
	readonly pageBox: AiPdfBox;
	readonly contentIndex: number;
	readonly nextId: ReturnType<typeof makeIdFactory>;
	readonly extGStates: ReadonlyMap<string, PdfExtGState>;
	readonly shadings: ReadonlyMap<string, PdfShadingResource>;
	readonly transparencyGroupXObjects: ReadonlySet<string>;
	paintedPathCount: number;
	paintedShadingCount: number;
};

type PdfSceneParseResult = {
	readonly payload: ImportedScenePayload;
	readonly issues: readonly AiImportIssue[];
};

const decoder = new TextDecoder("latin1", { fatal: false });
const encoder = new TextEncoder();

const normalizeInput = (input: AiImportSource): Uint8Array => {
	if (typeof input === "string") return encoder.encode(input);
	if (input instanceof Uint8Array) return input.slice();
	return new Uint8Array(input.slice(0));
};

const issue = (
	severity: AiImportIssue["severity"],
	code: AiImportIssueCode,
	message: string,
	context:
		| {
				readonly sourceName?: string;
				readonly ref?: string;
				readonly path?: string;
		  }
		| string
		| undefined = undefined,
): AiImportIssue => {
	const normalizedContext =
		typeof context === "string" ? { sourceName: context } : context;
	return {
		severity,
		code,
		message,
		...(normalizedContext?.sourceName
			? { source: normalizedContext.sourceName }
			: {}),
		...(normalizedContext?.ref ? { ref: normalizedContext.ref } : {}),
		...(normalizedContext?.path ? { path: normalizedContext.path } : {}),
	};
};

const issueOnce = (
	issues: AiImportIssue[],
	keys: Set<string>,
	nextIssue: AiImportIssue,
	keyParts: readonly string[],
) => {
	const key = keyParts.join(":");
	if (keys.has(key)) return;
	keys.add(key);
	issues.push(nextIssue);
};

const isApproximatedIssue = (item: AiImportIssue): boolean =>
	item.code === "ai.pdf_page_box_missing" ||
	item.code.includes("_approximated_") ||
	item.code === "ai.pdf_compound_path_split";

const isUnsupportedIssue = (item: AiImportIssue): boolean =>
	item.severity === "error" ||
	item.code.includes("_unsupported_") ||
	item.code === "ai.pdf_multiple_pages_unsupported" ||
	item.code === "ai.pdf_payload_missing" ||
	item.code === "ai.pdf_content_stream_missing";

const isArtboardFidelityIssue = (item: AiImportIssue): boolean =>
	item.code === "ai.pdf_multiple_pages_unsupported" ||
	item.code === "ai.pdf_page_box_missing";

const issueCounts = (
	issues: readonly AiImportIssue[],
): Readonly<Record<ImportIssueSeverity, number>> => ({
	info: issues.filter((item) => item.severity === "info").length,
	warning: issues.filter((item) => item.severity === "warning").length,
	error: issues.filter((item) => item.severity === "error").length,
});

const fidelityReport = (
	accepted: boolean,
	sourceFormat: string,
	issues: readonly AiImportIssue[],
	importedCount = 0,
	artboardCount = 0,
): AiImportFidelityReport => {
	const approximatedCount = issues.filter(isApproximatedIssue).length;
	const unsupportedCount = issues.filter(isUnsupportedIssue).length;
	const artboardIssues = issues.filter(isArtboardFidelityIssue);
	return {
		accepted,
		sourceFormat,
		importedCount,
		approximatedCount,
		unsupportedCount,
		artboardCount,
		artboardSummary: {
			imported: artboardCount,
			approximated: artboardIssues.filter(isApproximatedIssue).length,
			unsupported: artboardIssues.filter(isUnsupportedIssue).length,
		},
		summary: {
			imported: importedCount,
			approximated: approximatedCount,
			unsupported: unsupportedCount,
		},
		issueCounts: issueCounts(issues),
		issueCodes: issues.map((item) => item.code),
	};
};

const pdfBlendModes: Readonly<Record<string, BlendMode>> = {
	normal: "normal",
	multiply: "multiply",
	screen: "screen",
	overlay: "overlay",
	darken: "darken",
	lighten: "lighten",
	colordodge: "color-dodge",
	colorburn: "color-burn",
	hardlight: "hard-light",
	softlight: "soft-light",
	difference: "difference",
	exclusion: "exclusion",
	hue: "hue",
	saturation: "saturation",
	color: "color",
	luminosity: "luminosity",
};

const pdfBlendModeFrom = (value: string | undefined): BlendMode | undefined => {
	const normalized = value
		?.trim()
		.replaceAll(/[^A-Za-z]/g, "")
		.toLowerCase();
	return normalized ? pdfBlendModes[normalized] : undefined;
};

const hasAsciiAt = (
	bytes: Uint8Array,
	pattern: string,
	offset: number,
): boolean => {
	if (offset + pattern.length > bytes.length) return false;
	for (let index = 0; index < pattern.length; index += 1) {
		if (bytes[offset + index] !== pattern.charCodeAt(index)) return false;
	}
	return true;
};

const indexOfAscii = (
	bytes: Uint8Array,
	pattern: string,
	scanLimit: number,
): number => {
	const limit = Math.min(bytes.length, scanLimit);
	for (let offset = 0; offset <= limit - pattern.length; offset += 1) {
		if (hasAsciiAt(bytes, pattern, offset)) return offset;
	}
	return -1;
};

const scanText = (bytes: Uint8Array, scanTextBytes: number): string => {
	if (bytes.length <= scanTextBytes) return decoder.decode(bytes);

	const halfWindow = Math.max(Math.floor(scanTextBytes / 2), 1);
	const prefix = bytes.slice(0, halfWindow);
	const suffix = bytes.slice(bytes.length - halfWindow);

	return `${decoder.decode(prefix)}\n__AI_IMPORT_SCAN_WINDOW_SPLIT__\n${decoder.decode(suffix)}`;
};

const literalPdfString = (raw: string): string =>
	raw
		.replaceAll("\\(", "(")
		.replaceAll("\\)", ")")
		.replaceAll("\\\\", "\\")
		.replaceAll("\\n", "\n")
		.replaceAll("\\r", "\r")
		.replaceAll("\\t", "\t")
		.trim();

const metadataString = (text: string, key: string): string | undefined => {
	const match = new RegExp(`/${key}\\s*\\(([^)]*)\\)`).exec(text);
	return match?.[1] ? literalPdfString(match[1]) : undefined;
};

const parseNumber = (value: string): number | undefined => {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : undefined;
};

const isFiniteNumber = (value: number): boolean => Number.isFinite(value);

const roundTiny = (value: number): number =>
	Math.abs(value) < 1e-10 ? 0 : Number(value.toFixed(6));

const clamp01 = (value: number): number =>
	Math.min(1, Math.max(0, isFiniteNumber(value) ? value : 0));

const pdfBox = (
	text: string,
	key: "ArtBox" | "CropBox" | "MediaBox",
): AiPdfBox | undefined => {
	const match = new RegExp(
		`/${key}\\s*\\[\\s*(-?\\d+(?:\\.\\d+)?)\\s+(-?\\d+(?:\\.\\d+)?)\\s+(-?\\d+(?:\\.\\d+)?)\\s+(-?\\d+(?:\\.\\d+)?)\\s*\\]`,
	).exec(text);
	if (!match) return undefined;

	const x1 = parseNumber(match[1] ?? "");
	const y1 = parseNumber(match[2] ?? "");
	const x2 = parseNumber(match[3] ?? "");
	const y2 = parseNumber(match[4] ?? "");
	if (
		x1 === undefined ||
		y1 === undefined ||
		x2 === undefined ||
		y2 === undefined
	) {
		return undefined;
	}

	return {
		x: Math.min(x1, x2),
		y: Math.min(y1, y2),
		width: Math.abs(x2 - x1),
		height: Math.abs(y2 - y1),
	};
};

const countPages = (text: string): number | undefined => {
	const matches = text.match(/\/Type\s*\/Page\b/g);
	return matches?.length;
};

const illustratorMarkers = (text: string): readonly string[] => {
	const markers: string[] = [];
	if (/Adobe\s+Illustrator/i.test(text)) markers.push("adobe-illustrator");
	if (/%AIPrivateData(?:Begin|End)/.test(text)) markers.push("ai-private-data");
	if (/%%AI\d+_CreatorVersion/.test(text)) markers.push("ai-creator-version");
	if (/%%AI\d+_FileFormat/.test(text)) markers.push("ai-file-format");
	return markers;
};

const hasNativeIllustratorPrivateData = (text: string): boolean =>
	/%AIPrivateData(?:Begin|End)/.test(text) ||
	/%%AI\d+_(?:CreatorVersion|FileFormat)/.test(text);

const hasLegacyIllustratorPostScript = (text: string): boolean =>
	/^%!PS-Adobe/m.test(text) || /%%Creator:.*Adobe\s+Illustrator/i.test(text);

const extractMetadata = (text: string): AiPdfMetadata => {
	const version = /%PDF-(\d+\.\d+)/.exec(text)?.[1];
	const pageCount = countPages(text);
	const title = metadataString(text, "Title");
	const creator = metadataString(text, "Creator");
	const producer = metadataString(text, "Producer");
	const creationDate = metadataString(text, "CreationDate");
	const modifiedDate = metadataString(text, "ModDate");
	const mediaBox = pdfBox(text, "MediaBox");
	const cropBox = pdfBox(text, "CropBox");
	const artBox = pdfBox(text, "ArtBox");

	return {
		...(version ? { pdfVersion: version } : {}),
		...(pageCount ? { pageCount } : {}),
		...(title ? { title } : {}),
		...(creator ? { creator } : {}),
		...(producer ? { producer } : {}),
		...(creationDate ? { creationDate } : {}),
		...(modifiedDate ? { modifiedDate } : {}),
		...(mediaBox ? { mediaBox } : {}),
		...(cropBox ? { cropBox } : {}),
		...(artBox ? { artBox } : {}),
		illustratorMarkers: illustratorMarkers(text),
	};
};

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

const pageMatrix = (box: AiPdfBox): Matrix2D => ({
	a: 1,
	b: 0,
	c: 0,
	d: -1,
	e: -box.x,
	f: box.y + box.height,
});

const matrixToTransform = (
	matrix: Matrix2D,
	context: { readonly sourceName?: string; readonly path?: string },
	issues: AiImportIssue[],
): Transform => {
	if (
		![matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(
			isFiniteNumber,
		)
	) {
		issues.push(
			issue(
				"warning",
				"ai.pdf_approximated_transform",
				"Transform matrix contained non-finite values and was reset.",
				context,
			),
		);
		return IDENTITY_TRANSFORM;
	}

	const columnDot = matrix.a * matrix.c + matrix.b * matrix.d;
	if (Math.abs(columnDot) > 0.000001) {
		issues.push(
			issue(
				"warning",
				"ai.pdf_approximated_transform",
				"Skewed PDF transform matrix was approximated as translate/rotate/scale.",
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

const parsePdfObjects = (text: string): readonly PdfObject[] => {
	const objects: PdfObject[] = [];
	const objectPattern = /(\d+)\s+(\d+)\s+obj\b([\s\S]*?)\bendobj\b/g;
	for (const match of text.matchAll(objectPattern)) {
		const id = Number(match[1]);
		const generation = Number(match[2]);
		const body = match[3] ?? "";
		const streamStart = body.indexOf("stream");
		const dictionarySource =
			streamStart >= 0 ? body.slice(0, streamStart) : body;
		const dictionary = /<<[\s\S]*?>>/.exec(dictionarySource)?.[0] ?? "";
		const filter =
			/\/Filter\s*(?:\/([A-Za-z0-9]+)|\[\s*\/([A-Za-z0-9]+))/.exec(
				dictionary,
			)?.[1] ??
			/\/Filter\s*(?:\/([A-Za-z0-9]+)|\[\s*\/([A-Za-z0-9]+))/.exec(
				dictionary,
			)?.[2];

		let stream: string | undefined;
		if (streamStart >= 0) {
			let contentStart = streamStart + "stream".length;
			if (body[contentStart] === "\r" && body[contentStart + 1] === "\n") {
				contentStart += 2;
			} else if (body[contentStart] === "\n" || body[contentStart] === "\r") {
				contentStart += 1;
			}
			const contentEnd = body.indexOf("endstream", contentStart);
			if (contentEnd >= 0) stream = body.slice(contentStart, contentEnd);
		}

		if (Number.isFinite(id) && Number.isFinite(generation)) {
			objects.push({
				id,
				generation,
				body,
				dictionary,
				...(stream !== undefined ? { stream } : {}),
				...(filter ? { filter } : {}),
			});
		}
	}
	return objects;
};

const contentRefsFromPage = (pageBody: string): readonly number[] => {
	const match = /\/Contents\s+(\[[\s\S]*?\]|\d+\s+\d+\s+R)/.exec(pageBody);
	if (!match) return [];
	return Array.from(match[1].matchAll(/(\d+)\s+\d+\s+R/g), ([, id]) =>
		Number(id),
	).filter(Number.isFinite);
};

const pageBoxFrom = (
	pageBody: string | undefined,
	metadata: AiPdfMetadata,
): AiPdfBox | undefined =>
	(pageBody ? pdfBox(pageBody, "ArtBox") : undefined) ??
	(pageBody ? pdfBox(pageBody, "CropBox") : undefined) ??
	(pageBody ? pdfBox(pageBody, "MediaBox") : undefined) ??
	metadata.artBox ??
	metadata.cropBox ??
	metadata.mediaBox;

const emptyPdfMetadata = { illustratorMarkers: [] } satisfies AiPdfMetadata;

const pdfArtboardName = (
	context: PdfParseContext,
	pageIndex: number,
	pageCount: number,
): string => {
	const baseName =
		context.metadata.title ?? context.sourceName ?? "Imported AI PDF";
	return pageCount > 1 ? `${baseName} Page ${pageIndex + 1}` : baseName;
};

const pdfArtboardBounds = (box: AiPdfBox, x: number): ImportArtboardBounds => ({
	x,
	y: 0,
	width: box.width,
	height: box.height,
});

const pdfPageArtboards = (
	pageObjects: readonly PdfObject[],
	firstPageBox: AiPdfBox,
	nextId: ReturnType<typeof makeIdFactory>,
	context: PdfParseContext,
	issues: AiImportIssue[],
): readonly Artboard[] => {
	const pages =
		pageObjects.length > 0 ? pageObjects.map((page) => page.body) : [undefined];
	const artboards: Artboard[] = [];
	let x = 0;

	pages.forEach((pageBody, pageIndex) => {
		const pageBox =
			pageIndex === 0
				? firstPageBox
				: (pageBoxFrom(pageBody, emptyPdfMetadata) ?? DEFAULT_PDF_BOX);
		if (pageIndex > 0 && !pageBoxFrom(pageBody, emptyPdfMetadata)) {
			issues.push(
				issue(
					"warning",
					"ai.pdf_page_box_missing",
					`PDF page ${pageIndex + 1} lacked ArtBox/CropBox/MediaBox data; a fallback import artboard was used.`,
					context,
				),
			);
		}
		const artboard = createImportArtboard({
			id: nextId("artboard", `page-${pageIndex + 1}`),
			name: pdfArtboardName(context, pageIndex, pages.length),
			bounds: pdfArtboardBounds(pageBox, x),
		});
		artboards.push(artboard);
		x += pageBox.width + IMPORT_ARTBOARD_GAP;
	});

	return artboards;
};

const parseExtGStateDictionary = (
	dictionary: string,
): PdfExtGState | undefined => {
	const fillMatch = /\/ca\s+(-?(?:\d+\.?\d*|\.\d+))/.exec(dictionary);
	const strokeMatch = /\/CA\s+(-?(?:\d+\.?\d*|\.\d+))/.exec(dictionary);
	const blendModeMatch =
		/\/BM\s+(?:\/([A-Za-z0-9_.-]+)|\[\s*\/([A-Za-z0-9_.-]+))/.exec(dictionary);
	const rawBlendMode = blendModeMatch?.[1] ?? blendModeMatch?.[2];
	const blendMode = pdfBlendModeFrom(rawBlendMode);
	const hasSoftMask = /\/SMask\b/.test(dictionary);
	const hasAlphaSource = /\/AIS\s+true\b/.test(dictionary);
	const fillOpacity = fillMatch ? parseNumber(fillMatch[1]) : undefined;
	const strokeOpacity = strokeMatch ? parseNumber(strokeMatch[1]) : undefined;
	const unsupportedBlendMode =
		rawBlendMode && !blendMode ? rawBlendMode : undefined;
	const unsupportedEntries = [
		...(unsupportedBlendMode ? [`blend-mode:${unsupportedBlendMode}`] : []),
		...(hasSoftMask ? ["soft-mask"] : []),
		...(hasAlphaSource ? ["alpha-source"] : []),
	];

	if (
		fillOpacity === undefined &&
		strokeOpacity === undefined &&
		blendMode === undefined &&
		unsupportedEntries.length === 0
	) {
		return undefined;
	}

	return {
		...(fillOpacity !== undefined ? { fillOpacity: clamp01(fillOpacity) } : {}),
		...(strokeOpacity !== undefined
			? { strokeOpacity: clamp01(strokeOpacity) }
			: {}),
		...(blendMode && blendMode !== "normal" ? { blendMode } : {}),
		...(unsupportedBlendMode ? { unsupportedBlendMode } : {}),
		unsupportedEntries,
	};
};

const parseExtGStates = (
	text: string,
	objects: readonly PdfObject[],
): ReadonlyMap<string, PdfExtGState> => {
	const byObjectId = new Map<number, PdfExtGState>();
	for (const object of objects) {
		if (
			/\/Type\s*\/ExtGState\b/.test(object.dictionary) ||
			/\/(?:ca|CA|BM|SMask)\b/.test(object.dictionary)
		) {
			const parsed = parseExtGStateDictionary(object.dictionary);
			if (parsed) byObjectId.set(object.id, parsed);
		}
	}

	const states = new Map<string, PdfExtGState>();
	for (const blockMatch of text.matchAll(/\/ExtGState\s*<<([\s\S]*?)>>/g)) {
		const block = blockMatch[1] ?? "";
		for (const refMatch of block.matchAll(
			/\/([A-Za-z0-9_.-]+)\s+(\d+)\s+\d+\s+R/g,
		)) {
			const state = byObjectId.get(Number(refMatch[2]));
			if (state) states.set(refMatch[1], state);
		}
		for (const directMatch of block.matchAll(
			/\/([A-Za-z0-9_.-]+)\s*<<([\s\S]*?)>>/g,
		)) {
			const state = parseExtGStateDictionary(directMatch[2] ?? "");
			if (state) states.set(directMatch[1], state);
		}
	}

	return states;
};

const parseTransparencyGroupXObjects = (
	text: string,
	objects: readonly PdfObject[],
): ReadonlySet<string> => {
	const transparencyGroupObjectIds = new Set(
		objects
			.filter(
				(object) =>
					/\/Type\s*\/XObject\b/.test(object.dictionary) &&
					/\/Group\s*<<[\s\S]*?\/S\s*\/Transparency\b/.test(object.body),
			)
			.map((object) => object.id),
	);
	if (transparencyGroupObjectIds.size === 0) return new Set();

	const names = new Set<string>();
	for (const blockMatch of text.matchAll(/\/XObject\s*<<([\s\S]*?)>>/g)) {
		const block = blockMatch[1] ?? "";
		for (const refMatch of block.matchAll(
			/\/([A-Za-z0-9_.-]+)\s+(\d+)\s+\d+\s+R/g,
		)) {
			if (transparencyGroupObjectIds.has(Number(refMatch[2]))) {
				names.add(refMatch[1]);
			}
		}
	}
	return names;
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

const makeIdFactory = (prefix: string | undefined) => {
	const counts = new Map<string, number>();
	const namespace = sanitizeIdPart(prefix) ?? "ai";

	return (
		kind: "artboard" | "layer" | "node",
		preferred: string | undefined,
	): string => {
		const base = `${kind}-${namespace}-${sanitizeIdPart(preferred) ?? kind}`;
		const count = counts.get(base) ?? 0;
		counts.set(base, count + 1);
		return count === 0 ? base : `${base}-${count + 1}`;
	};
};

const isPdfWhitespace = (value: string | undefined): boolean =>
	value === "\u0000" ||
	value === "\t" ||
	value === "\n" ||
	value === "\f" ||
	value === "\r" ||
	value === " ";

const isPdfTokenDelimiter = (value: string | undefined): boolean =>
	isPdfWhitespace(value) || value === undefined || "[]<>()/%".includes(value);

const decodeOctalEscape = (value: string): string | undefined => {
	const match = /^[0-7]{1,3}/.exec(value);
	if (!match) return undefined;
	return String.fromCharCode(Number.parseInt(match[0], 8) & 0xff);
};

const readLiteralString = (
	stream: string,
	openIndex: number,
): {
	readonly value: string;
	readonly nextIndex: number;
} => {
	let index = openIndex + 1;
	let depth = 1;
	let value = "";

	while (index < stream.length && depth > 0) {
		const char = stream[index];
		if (char === "\\") {
			const escaped = stream[index + 1];
			if (escaped === undefined) {
				index += 1;
				continue;
			}
			if (escaped === "\r" || escaped === "\n") {
				index += escaped === "\r" && stream[index + 2] === "\n" ? 3 : 2;
				continue;
			}
			const octal = decodeOctalEscape(stream.slice(index + 1));
			if (octal !== undefined) {
				const octalLength =
					/^[0-7]{1,3}/.exec(stream.slice(index + 1))?.[0].length ?? 0;
				value += octal;
				index += 1 + octalLength;
				continue;
			}
			const mapped =
				escaped === "n"
					? "\n"
					: escaped === "r"
						? "\r"
						: escaped === "t"
							? "\t"
							: escaped === "b"
								? "\b"
								: escaped === "f"
									? "\f"
									: escaped;
			value += mapped;
			index += 2;
			continue;
		}
		if (char === "(") {
			depth += 1;
			value += char;
			index += 1;
			continue;
		}
		if (char === ")") {
			depth -= 1;
			if (depth > 0) value += char;
			index += 1;
			continue;
		}
		value += char;
		index += 1;
	}

	return { value, nextIndex: index };
};

const hexStringToText = (raw: string): string => {
	const normalized = raw.replace(/\s+/g, "");
	const padded = normalized.length % 2 === 0 ? normalized : `${normalized}0`;
	let value = "";
	for (let index = 0; index < padded.length; index += 2) {
		const byte = Number.parseInt(padded.slice(index, index + 2), 16);
		if (Number.isFinite(byte)) value += String.fromCharCode(byte);
	}
	return value;
};

const tokenizeContentStream = (stream: string): readonly PdfToken[] => {
	const tokens: PdfToken[] = [];
	let index = 0;

	const skipWhitespace = () => {
		while (index < stream.length && isPdfWhitespace(stream[index])) {
			index += 1;
		}
	};

	while (index < stream.length) {
		skipWhitespace();
		const char = stream[index];
		if (!char) break;

		if (char === "%") {
			while (index < stream.length && !/[\r\n]/.test(stream[index] ?? "")) {
				index += 1;
			}
			continue;
		}

		if (char === "(") {
			const text = readLiteralString(stream, index);
			tokens.push({ kind: "string", value: text.value });
			index = text.nextIndex;
			continue;
		}

		if (char === "<" && stream[index + 1] !== "<") {
			const start = index + 1;
			index = start;
			while (index < stream.length && stream[index] !== ">") index += 1;
			tokens.push({
				kind: "string",
				value: hexStringToText(stream.slice(start, index)),
			});
			if (stream[index] === ">") index += 1;
			continue;
		}

		if (char === "[" || char === "]") {
			index += 1;
			continue;
		}

		if (char === "<" && stream[index + 1] === "<") {
			index += 2;
			continue;
		}

		if (char === ">" && stream[index + 1] === ">") {
			index += 2;
			continue;
		}

		if (char === "/") {
			index += 1;
			const start = index;
			while (index < stream.length && !isPdfTokenDelimiter(stream[index])) {
				index += 1;
			}
			tokens.push({ kind: "name", name: stream.slice(start, index) });
			continue;
		}

		const numberMatch =
			/^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?/.exec(
				stream.slice(index),
			);
		if (numberMatch) {
			const value = Number(numberMatch[0]);
			tokens.push({ kind: "number", value });
			index += numberMatch[0].length;
			continue;
		}

		const start = index;
		while (index < stream.length && !isPdfTokenDelimiter(stream[index])) {
			index += 1;
		}
		const operator = stream.slice(start, index);
		if (operator.length > 0) tokens.push({ kind: "operator", operator });
	}

	return tokens;
};

const numbersFrom = (
	operands: readonly PdfOperand[],
	count: number,
): readonly number[] | undefined => {
	if (operands.length < count) return undefined;
	const tail = operands.slice(operands.length - count);
	if (!tail.every((operand) => operand.kind === "number")) return undefined;
	return tail.map((operand) => operand.value);
};

const nameFrom = (operands: readonly PdfOperand[]): string | undefined => {
	const operand = operands[operands.length - 1];
	return operand?.kind === "name" ? operand.name : undefined;
};

const lineCapFromPdf = (value: number): PdfLineCap | undefined => {
	if (value === 0) return "butt";
	if (value === 1) return "round";
	if (value === 2) return "projecting-square";
	return undefined;
};

const lineJoinFromPdf = (value: number): PdfLineJoin | undefined => {
	if (value === 0) return "miter";
	if (value === 1) return "round";
	if (value === 2) return "bevel";
	return undefined;
};

const sceneStrokeCapFromPdf = (value: PdfLineCap): StrokeCap =>
	value === "projecting-square" ? "square" : value;

const sceneStrokeJoinFromPdf = (value: PdfLineJoin): StrokeJoin => value;

const numericOperands = (
	operands: readonly PdfOperand[],
): readonly number[] | undefined => {
	if (!operands.every((operand) => operand.kind === "number")) {
		return undefined;
	}
	return operands.map((operand) => operand.value);
};

const point = (x: number, y: number): Point => ({ x, y });
const pointToAe = ({ x, y }: Point): AePoint => [roundTiny(x), roundTiny(y)];
const tangent = (from: Point, to: Point): AePoint => [
	roundTiny(to.x - from.x),
	roundTiny(to.y - from.y),
];

const newPath = (): PathBuilder => ({ subpaths: [] });

const moveTo = (builder: PathBuilder, to: Point, sourceKind?: "rect") => {
	const subpath: MutableSubpath = {
		closed: false,
		...(sourceKind ? { sourceKind } : {}),
		vertices: [pointToAe(to)],
		inTangents: [[0, 0]],
		outTangents: [[0, 0]],
	};
	builder.subpaths.push(subpath);
	builder.active = subpath;
	builder.current = to;
	builder.start = to;
};

const appendCubic = (
	builder: PathBuilder,
	control1: Point,
	control2: Point,
	to: Point,
): boolean => {
	if (!builder.active || !builder.current) return false;
	const previousIndex = builder.active.vertices.length - 1;
	builder.active.outTangents[previousIndex] = tangent(
		builder.current,
		control1,
	);
	builder.active.vertices.push(pointToAe(to));
	builder.active.inTangents.push(tangent(to, control2));
	builder.active.outTangents.push([0, 0]);
	builder.current = to;
	return true;
};

const lineTo = (builder: PathBuilder, to: Point): boolean =>
	builder.current ? appendCubic(builder, builder.current, to, to) : false;

const closePath = (builder: PathBuilder) => {
	if (!builder.active || !builder.start) return;
	builder.active.closed = true;
	builder.current = builder.start;
};

const rectPath = (
	builder: PathBuilder,
	x: number,
	y: number,
	width: number,
	height: number,
) => {
	const p0 = point(x, y);
	const p1 = point(x + width, y);
	const p2 = point(x + width, y + height);
	const p3 = point(x, y + height);
	moveTo(builder, p0, "rect");
	lineTo(builder, p1);
	lineTo(builder, p2);
	lineTo(builder, p3);
	closePath(builder);
};

const shapeFromSubpath = (subpath: MutableSubpath): BezierShape => ({
	type: "Shape",
	closed: subpath.closed,
	vertices: [...subpath.vertices],
	inTangents: [...subpath.inTangents],
	outTangents: [...subpath.outTangents],
});

const rectGeometryFromSubpath = (
	subpath: MutableSubpath,
): NodeGeometry | undefined => {
	if (subpath.sourceKind !== "rect" || subpath.vertices.length < 4) {
		return undefined;
	}
	const points = subpath.vertices.map(([x, y]) => ({ x, y }));
	const xs = points.map((item) => item.x);
	const ys = points.map((item) => item.y);
	const minX = Math.min(...xs);
	const minY = Math.min(...ys);
	const maxX = Math.max(...xs);
	const maxY = Math.max(...ys);
	return {
		kind: "rect",
		bounds: {
			x: roundTiny(minX),
			y: roundTiny(minY),
			width: roundTiny(maxX - minX),
			height: roundTiny(maxY - minY),
		},
		cornerRadius: 0,
	};
};

const rgb = (red: number, green: number, blue: number): string => {
	const channel = (value: number): string =>
		Math.round(clamp01(value) * 255)
			.toString(16)
			.padStart(2, "0");
	return `#${channel(red)}${channel(green)}${channel(blue)}`;
};

const cmykToRgb = (
	cyan: number,
	magenta: number,
	yellow: number,
	key: number,
): string => {
	const k = clamp01(key);
	return rgb(
		(1 - clamp01(cyan)) * (1 - k),
		(1 - clamp01(magenta)) * (1 - k),
		(1 - clamp01(yellow)) * (1 - k),
	);
};

const pdfNumberArray = (
	source: string,
	key: string,
): readonly number[] | undefined => {
	const match = new RegExp(`/${key}\\s*\\[([^\\]]*)\\]`).exec(source);
	if (!match) return undefined;
	const values = Array.from(
		(match[1] ?? "").matchAll(
			/[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?/g,
		),
		([value]) => Number(value),
	);
	return values.length > 0 && values.every(isFiniteNumber) ? values : undefined;
};

const pdfName = (source: string, key: string): string | undefined =>
	new RegExp(`/${key}\\s*/([A-Za-z0-9_.-]+)`).exec(source)?.[1];

const pdfInteger = (source: string, key: string): number | undefined => {
	const parsed = parseNumber(
		new RegExp(`/${key}\\s+(-?\\d+)`).exec(source)?.[1] ?? "",
	);
	return parsed !== undefined && Number.isInteger(parsed) ? parsed : undefined;
};

const pdfObjectReference = (
	source: string,
	key: string,
): number | undefined => {
	const parsed = parseNumber(
		new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(source)?.[1] ?? "",
	);
	return parsed !== undefined && Number.isInteger(parsed) ? parsed : undefined;
};

const gradientPointInBounds = (
	bounds: AiPdfBox,
	x: number,
	y: number,
): Vec2 => ({
	x: bounds.width > 0 ? roundTiny((x - bounds.x) / bounds.width) : 0,
	y: bounds.height > 0 ? roundTiny((y - bounds.y) / bounds.height) : 0,
});

const gradientRadiusInBounds = (bounds: AiPdfBox, radius: number): Vec2 => ({
	x: bounds.width > 0 ? roundTiny(radius / bounds.width) : 0.5,
	y: bounds.height > 0 ? roundTiny(radius / bounds.height) : 0.5,
});

const gradientStopsForFunction = (
	functionObject: PdfObject | undefined,
):
	| { readonly stops: readonly GradientStop[]; readonly fallbackColor: string }
	| undefined => {
	if (
		!functionObject ||
		pdfInteger(functionObject.body, "FunctionType") !== 2
	) {
		return undefined;
	}
	const start = pdfNumberArray(functionObject.body, "C0");
	const end = pdfNumberArray(functionObject.body, "C1");
	if (!start || !end || start.length < 3 || end.length < 3) return undefined;
	const startColor = rgb(start[0], start[1], start[2]);
	const endColor = rgb(end[0], end[1], end[2]);
	return {
		stops: [
			{ offset: 0, color: startColor },
			{ offset: 1, color: endColor },
		],
		fallbackColor: rgb(
			(start[0] + end[0]) / 2,
			(start[1] + end[1]) / 2,
			(start[2] + end[2]) / 2,
		),
	};
};

const pdfShadingResource = ({
	ref,
	shadingObject,
	functionObject,
	pageBox,
}: {
	readonly ref: string;
	readonly shadingObject: PdfObject;
	readonly functionObject: PdfObject | undefined;
	readonly pageBox: AiPdfBox;
}): PdfShadingResource | undefined => {
	if (pdfName(shadingObject.body, "ColorSpace") !== "DeviceRGB") {
		return undefined;
	}
	const shadingType = pdfInteger(shadingObject.body, "ShadingType");
	const coords = pdfNumberArray(shadingObject.body, "Coords");
	const color = gradientStopsForFunction(functionObject);
	if (!coords || !color) return undefined;
	const sourcePath = `/Shading/${ref}`;
	if (shadingType === 2 && coords.length >= 4) {
		const [x1, y1, x2, y2] = coords;
		const paint: LinearGradientPaint = {
			kind: "linear-gradient",
			from: gradientPointInBounds(pageBox, x1, y1),
			to: gradientPointInBounds(pageBox, x2, y2),
			stops: color.stops,
		};
		return {
			kind: "axial",
			ref,
			sourcePath,
			bounds: pageBox,
			fallbackColor: color.fallbackColor,
			paint,
		};
	}
	if (shadingType === 3 && coords.length >= 6) {
		const [, , , x2, y2, r2] = coords;
		const paint: RadialGradientPaint = {
			kind: "radial-gradient",
			center: gradientPointInBounds(pageBox, x2, y2),
			radius: gradientRadiusInBounds(pageBox, Math.max(r2, 0)),
			stops: color.stops,
		};
		return {
			kind: "radial",
			ref,
			sourcePath,
			bounds: pageBox,
			fallbackColor: color.fallbackColor,
			paint,
		};
	}
	return undefined;
};

const parseShadings = (
	text: string,
	objects: readonly PdfObject[],
	pageBox: AiPdfBox,
): ReadonlyMap<string, PdfShadingResource> => {
	const byObjectId = new Map(objects.map((object) => [object.id, object]));
	const resources = new Map<string, PdfShadingResource>();
	for (const blockMatch of text.matchAll(/\/Shading\s*<<([\s\S]*?)>>/g)) {
		const block = blockMatch[1] ?? "";
		for (const refMatch of block.matchAll(
			/\/([A-Za-z0-9_.-]+)\s+(\d+)\s+\d+\s+R/g,
		)) {
			const ref = refMatch[1];
			const shadingObject = byObjectId.get(Number(refMatch[2]));
			if (!ref || !shadingObject) continue;
			const functionObjectId = pdfObjectReference(
				shadingObject.body,
				"Function",
			);
			const resource = pdfShadingResource({
				ref,
				shadingObject,
				functionObject:
					functionObjectId !== undefined
						? byObjectId.get(functionObjectId)
						: undefined,
				pageBox,
			});
			if (resource) resources.set(ref, resource);
		}
	}
	return resources;
};

const cloneGraphicsState = (state: GraphicsState): GraphicsState => ({
	ctm: { ...state.ctm },
	fillColor: state.fillColor,
	strokeColor: state.strokeColor,
	strokeWidth: state.strokeWidth,
	fillOpacity: state.fillOpacity,
	strokeOpacity: state.strokeOpacity,
	lineCap: state.lineCap,
	lineJoin: state.lineJoin,
	miterLimit: state.miterLimit,
	dashArray: [...state.dashArray],
	dashPhase: state.dashPhase,
	...(state.blendMode ? { blendMode: state.blendMode } : {}),
	unsupportedEffects: state.unsupportedEffects.map((effect) => ({ ...effect })),
});

const initialGraphicsState = (box: AiPdfBox): GraphicsState => ({
	ctm: pageMatrix(box),
	fillColor: DEFAULT_PDF_STYLE.fill,
	strokeColor: "#000000",
	strokeWidth: DEFAULT_PDF_STYLE.strokeWidth,
	fillOpacity: DEFAULT_PDF_STYLE.opacity,
	strokeOpacity: DEFAULT_PDF_STYLE.opacity,
	lineCap: "butt",
	lineJoin: "miter",
	miterLimit: 10,
	dashArray: [],
	dashPhase: 0,
	unsupportedEffects: [],
});

const initialTextState = (): PdfTextState => ({
	active: false,
	fontSize: DEFAULT_PDF_TEXT_STYLE.fontSize,
	leading: DEFAULT_PDF_TEXT_STYLE.lineHeight,
	renderingMode: 0,
	textMatrix: IDENTITY_MATRIX,
	lineMatrix: IDENTITY_MATRIX,
});

const textStyleForState = (state: PdfTextState): TextStyle =>
	normalizeTextStyle({
		fontFamily: DEFAULT_PDF_TEXT_STYLE.fontFamily,
		fontSize: roundTiny(state.fontSize),
		lineHeight: roundTiny(
			state.leading > 0 ? state.leading : Math.max(state.fontSize * 1.2, 1),
		),
		align: "left",
		fontWeight: DEFAULT_PDF_TEXT_STYLE.fontWeight,
	});

const textWidthEstimate = (text: string, style: TextStyle): number =>
	Math.max(
		style.fontSize,
		Array.from(text).reduce(
			(width, char) => width + (char === "\t" ? 2 : 0.6) * style.fontSize,
			0,
		),
	);

const textGeometryForState = (
	text: string,
	state: PdfTextState,
): Extract<NodeGeometry, { readonly kind: "text" }> => {
	const style = textStyleForState(state);
	const lines = text.split("\n");
	const width = Math.max(
		style.fontSize,
		...lines.map((line) => textWidthEstimate(line, style)),
	);
	return {
		kind: "text",
		bounds: {
			x: roundTiny(state.textMatrix.e),
			y: roundTiny(state.textMatrix.f),
			width: roundTiny(width),
			height: roundTiny(
				Math.max(style.lineHeight, lines.length * style.lineHeight),
			),
		},
		text,
		style,
	};
};

const importEffectsData = (
	effects: readonly PdfUnsupportedEffectData[],
): readonly Record<string, unknown>[] | undefined =>
	effects.length > 0
		? effects.map((effect) => ({
				kind: effect.kind,
				value: effect.value,
				sourcePath: effect.sourcePath,
			}))
		: undefined;

const importedClipMaskRelationsData = (
	nodeId: string,
	effects: readonly PdfUnsupportedEffectData[],
) =>
	effects.flatMap((effect) => {
		const relation = createImportedClipMaskRelationMetadata({
			...effect,
			affectedNodeIds: [nodeId],
		});
		return relation ? [relation] : [];
	});

const textNodeData = (
	nodeId: string,
	context: PdfContentContext,
	operator: string,
	textIndex: number,
	fontName: string | undefined,
	effects: readonly PdfUnsupportedEffectData[],
	spacingFlattened: boolean,
): Record<string, unknown> => {
	const importPath = `${context.streamPath}/text[${textIndex}]`;
	const data: Record<string, unknown> = {
		importFormat: AI_PDF_COMPATIBLE_SOURCE_FORMAT,
		importElement: "pdf-text",
		importPath,
		importRef: `page-${context.pageIndex + 1}-content-${context.contentIndex + 1}-text-${textIndex + 1}`,
		importPdfOperator: operator,
		importText: {
			source: "pdf-text",
			metrics: "estimated",
			fontFallback: true,
			spacingFlattened,
			sourcePath: importPath,
		} satisfies PdfTextFidelityData,
		...(fontName ? { importPdfFont: fontName } : {}),
		...(context.sourceName ? { importSource: context.sourceName } : {}),
	};
	const importEffects = importEffectsData(effects);
	if (importEffects) data.importEffects = importEffects;
	const importAppearance = createImportedAppearanceMetadataData({
		effects,
		clipMaskRelations: importedClipMaskRelationsData(nodeId, effects),
	});
	if (importAppearance) data.importAppearance = importAppearance;
	return data;
};

const isTranslationOnlyMatrix = (matrix: Matrix2D): boolean =>
	Math.abs(matrix.a - 1) <= 0.000001 &&
	Math.abs(matrix.b) <= 0.000001 &&
	Math.abs(matrix.c) <= 0.000001 &&
	Math.abs(matrix.d - 1) <= 0.000001;

const textFromOperands = (operands: readonly PdfOperand[]): string =>
	operands
		.filter(
			(operand): operand is Extract<PdfOperand, { readonly kind: "string" }> =>
				operand.kind === "string",
		)
		.map((operand) => operand.value)
		.join("");

const hasTextSpacingApproximation = (
	operator: string,
	operands: readonly PdfOperand[],
): boolean =>
	operator === '"' ||
	operator === "TJ" ||
	operands.some((operand) => operand.kind === "number");

const advanceTextState = (state: PdfTextState, text: string): PdfTextState => {
	const style = textStyleForState(state);
	const width = textWidthEstimate(text, style);
	return {
		...state,
		textMatrix: multiplyMatrix(state.textMatrix, translateMatrix(width, 0)),
	};
};

const moveTextLine = (state: PdfTextState): PdfTextState => {
	const leading =
		state.leading > 0 ? state.leading : Math.max(state.fontSize * 1.2, 1);
	const lineMatrix = multiplyMatrix(
		state.lineMatrix,
		translateMatrix(0, -leading),
	);
	return {
		...state,
		lineMatrix,
		textMatrix: lineMatrix,
	};
};

const fontOperands = (
	operands: readonly PdfOperand[],
):
	| {
			readonly fontName: string;
			readonly fontSize: number;
	  }
	| undefined => {
	const fontName = operands[operands.length - 2];
	const fontSize = operands[operands.length - 1];
	if (fontName?.kind !== "name" || fontSize?.kind !== "number") {
		return undefined;
	}
	return { fontName: fontName.name, fontSize: fontSize.value };
};

const textMatrixOperands = (
	operands: readonly PdfOperand[],
): Matrix2D | undefined => {
	const values = numbersFrom(operands, 6);
	if (!values) return undefined;
	const [a, b, c, d, e, f] = values;
	return { a, b, c, d, e, f };
};

const pdfTextRenderingModeFrom = (
	value: number,
): PdfTextRenderingMode | undefined =>
	Number.isInteger(value) && value >= 0 && value <= 7
		? (value as PdfTextRenderingMode)
		: undefined;

const textPaintMode = (renderingMode: PdfTextRenderingMode): 0 | 1 | 2 | 3 =>
	(renderingMode % 4) as 0 | 1 | 2 | 3;

const textNodeForShow = (
	operator: string,
	text: string,
	state: PdfTextState,
	graphicsState: GraphicsState,
	context: PdfContentContext,
	textIndex: number,
	issues: AiImportIssue[],
	spacingApproximated: boolean,
): VectorNode | undefined => {
	if (!state.active) {
		issues.push(
			issue(
				"warning",
				"ai.pdf_invalid_operator_operands",
				`PDF text operator ${operator} appeared outside a text object and was skipped.`,
				{ sourceName: context.sourceName, path: context.streamPath },
			),
		);
		return undefined;
	}
	if (text.length === 0) return undefined;
	const paintMode = textPaintMode(state.renderingMode);
	if (state.renderingMode >= 4) {
		issues.push(
			issue(
				"warning",
				"ai.pdf_unsupported_text_clipping",
				`PDF text rendering mode ${state.renderingMode} adds glyph outlines to the clipping path; clipping was ignored by the editable text fallback.`,
				{ sourceName: context.sourceName, path: context.streamPath },
			),
		);
	}
	if (paintMode === 3) {
		issues.push(
			issue(
				"warning",
				"ai.pdf_unsupported_invisible_text",
				`PDF text rendering mode ${state.renderingMode} has no visible paint, so the text run was not imported as a scene node.`,
				{ sourceName: context.sourceName, path: context.streamPath },
			),
		);
		return undefined;
	}
	if (!isTranslationOnlyMatrix(state.textMatrix)) {
		issues.push(
			issue(
				"info",
				"ai.pdf_approximated_transform",
				"PDF text matrix scale or rotation was approximated to a translated scene text box.",
				{ sourceName: context.sourceName, path: context.streamPath },
			),
		);
	}
	issues.push(
		issue(
			"info",
			"ai.pdf_approximated_text_metrics",
			"PDF text was imported as editable scene text with approximated bounds; embedded font metrics are not preserved.",
			{ sourceName: context.sourceName, path: context.streamPath },
		),
	);
	issues.push(
		issue(
			"info",
			"ai.pdf_approximated_text_font",
			state.fontName
				? `PDF font resource /${state.fontName} was mapped to the importer fallback font family.`
				: "PDF text had no resolved font resource and was mapped to the importer fallback font family.",
			{ sourceName: context.sourceName, path: context.streamPath },
		),
	);
	if (spacingApproximated) {
		issues.push(
			issue(
				"info",
				"ai.pdf_approximated_text_spacing",
				"PDF text spacing adjustments were flattened into plain scene text.",
				{ sourceName: context.sourceName, path: context.streamPath },
			),
		);
	}

	const fillText = paintMode === 0 || paintMode === 2;
	const strokeText = paintMode === 1 || paintMode === 2;
	let opacity = fillText
		? graphicsState.fillOpacity
		: graphicsState.strokeOpacity;
	if (
		fillText &&
		strokeText &&
		Math.abs(graphicsState.fillOpacity - graphicsState.strokeOpacity) > 0.000001
	) {
		opacity = Math.min(graphicsState.fillOpacity, graphicsState.strokeOpacity);
		issues.push(
			issue(
				"info",
				"ai.pdf_approximated_opacity",
				"Different PDF text fill and stroke opacity values were approximated to one scene text opacity.",
				{ sourceName: context.sourceName, path: context.streamPath },
			),
		);
	}
	let strokeWidth = graphicsState.strokeWidth;
	if (strokeText && strokeWidth === 0) {
		strokeWidth = 1;
		issues.push(
			issue(
				"info",
				"ai.pdf_approximated_hairline_stroke",
				"PDF text hairline stroke width 0 was imported as 1 scene unit.",
				{ sourceName: context.sourceName, path: context.streamPath },
			),
		);
	}

	const nodeId = context.nextId("node", `text-${textIndex + 1}`);
	return {
		id: nodeId,
		name: `PDF Text ${textIndex + 1}`,
		artboardId: context.artboardId,
		geometry: textGeometryForState(text, state),
		transform: matrixToTransform(
			graphicsState.ctm,
			{ sourceName: context.sourceName, path: context.streamPath },
			issues,
		),
		style: {
			fill: fillText ? graphicsState.fillColor : "none",
			stroke: strokeText ? graphicsState.strokeColor : "none",
			strokeWidth: strokeText ? strokeWidth : DEFAULT_PDF_STYLE.strokeWidth,
			opacity,
			...(strokeText && graphicsState.dashArray.length > 0
				? { strokeDash: graphicsState.dashArray }
				: {}),
			...(strokeText && graphicsState.lineCap !== "butt"
				? { strokeCap: sceneStrokeCapFromPdf(graphicsState.lineCap) }
				: {}),
			...(strokeText && graphicsState.lineJoin !== "miter"
				? { strokeJoin: sceneStrokeJoinFromPdf(graphicsState.lineJoin) }
				: {}),
			...(strokeText && Math.abs(graphicsState.miterLimit - 10) > 0.000001
				? { strokeMiterLimit: graphicsState.miterLimit }
				: {}),
			...(graphicsState.blendMode
				? { blendMode: graphicsState.blendMode }
				: {}),
		},
		visible: true,
		locked: false,
		data: textNodeData(
			nodeId,
			context,
			operator,
			textIndex,
			state.fontName,
			graphicsState.unsupportedEffects,
			spacingApproximated,
		),
	};
};

const pdfStrokeFidelityData = (
	mode: PaintMode,
	state: GraphicsState,
): PdfStrokeFidelityData | undefined => {
	if (!mode.stroke) return undefined;
	const data: PdfStrokeFidelityData = {
		...(state.dashArray.length > 0
			? { dashArray: [...state.dashArray], dashPhase: state.dashPhase }
			: {}),
		...(state.lineCap !== "butt" ? { lineCap: state.lineCap } : {}),
		...(state.lineJoin !== "miter" ? { lineJoin: state.lineJoin } : {}),
		...(Math.abs(state.miterLimit - 10) > 0.000001
			? { miterLimit: state.miterLimit }
			: {}),
	};
	return Object.keys(data).length > 0 ? data : undefined;
};

const reportStrokeDetailApproximations = (
	mode: PaintMode,
	state: GraphicsState,
	issues: AiImportIssue[],
	context: { readonly sourceName?: string; readonly path?: string },
) => {
	if (!mode.stroke) return;
	if (state.dashArray.length > 0) {
		if (Math.abs(state.dashPhase) > 0.000001) {
			issues.push(
				issue(
					"info",
					"ai.pdf_approximated_stroke_dash_phase",
					`PDF dashed stroke phase ${state.dashPhase} has no NodeStyle field yet; dash pattern was imported without offset.`,
					context,
				),
			);
		}
	}
};

const styleForPaint = (
	mode: PaintMode,
	state: GraphicsState,
	issues: AiImportIssue[],
	context: { readonly sourceName?: string; readonly path?: string },
): NodeStyle => {
	let strokeWidth = state.strokeWidth;
	if (mode.stroke && strokeWidth === 0) {
		strokeWidth = 1;
		issues.push(
			issue(
				"info",
				"ai.pdf_approximated_hairline_stroke",
				"PDF hairline stroke width 0 was imported as 1 scene unit.",
				context,
			),
		);
	}

	let opacity = mode.fill ? state.fillOpacity : state.strokeOpacity;
	if (
		mode.fill &&
		mode.stroke &&
		Math.abs(state.fillOpacity - state.strokeOpacity) > 0.000001
	) {
		opacity = Math.min(state.fillOpacity, state.strokeOpacity);
		issues.push(
			issue(
				"info",
				"ai.pdf_approximated_opacity",
				"Different PDF fill and stroke opacity values were approximated to one node opacity.",
				context,
			),
		);
	}
	reportStrokeDetailApproximations(mode, state, issues, context);

	return {
		fill: mode.fill ? state.fillColor : "none",
		stroke: mode.stroke ? state.strokeColor : "none",
		strokeWidth,
		opacity,
		...(mode.stroke && state.dashArray.length > 0
			? { strokeDash: state.dashArray }
			: {}),
		...(mode.stroke && state.lineCap !== "butt"
			? { strokeCap: sceneStrokeCapFromPdf(state.lineCap) }
			: {}),
		...(mode.stroke && state.lineJoin !== "miter"
			? { strokeJoin: sceneStrokeJoinFromPdf(state.lineJoin) }
			: {}),
		...(mode.stroke && Math.abs(state.miterLimit - 10) > 0.000001
			? { strokeMiterLimit: state.miterLimit }
			: {}),
		...(state.blendMode ? { blendMode: state.blendMode } : {}),
	};
};

const nodeData = (
	nodeId: string,
	context: PdfContentContext,
	paintOperator: string,
	pathIndex: number,
	strokeFidelity: PdfStrokeFidelityData | undefined,
	effects: readonly PdfUnsupportedEffectData[],
	compoundPath: PdfCompoundPathFidelityData | undefined,
): Record<string, unknown> => {
	const data: Record<string, unknown> = {
		importFormat: AI_PDF_COMPATIBLE_SOURCE_FORMAT,
		importElement: "pdf-path",
		importPath: `${context.streamPath}/path[${pathIndex}]`,
		importRef: `page-${context.pageIndex + 1}-content-${context.contentIndex + 1}-path-${pathIndex + 1}`,
		importPdfOperator: paintOperator,
		...(context.sourceName ? { importSource: context.sourceName } : {}),
	};
	if (strokeFidelity) data.importStroke = strokeFidelity;
	const importEffects = importEffectsData(effects);
	if (importEffects) data.importEffects = importEffects;
	if (compoundPath) data.importCompoundPath = { ...compoundPath };
	const importAppearance = createImportedAppearanceMetadataData({
		effects,
		clipMaskRelations: importedClipMaskRelationsData(nodeId, effects),
		...(compoundPath ? { compoundPath } : {}),
	});
	if (importAppearance) data.importAppearance = importAppearance;
	return data;
};

const shadingPaintMetadata = (
	shading: PdfShadingResource,
): {
	readonly fill: {
		readonly source: "pdf-shading";
		readonly ref: string;
		readonly fallback: string;
		readonly sourcePath: string;
	};
} => ({
	fill: {
		source: "pdf-shading",
		ref: shading.ref,
		fallback: shading.fallbackColor,
		sourcePath: shading.sourcePath,
	},
});

const shadingNodeData = (
	nodeId: string,
	context: PdfContentContext,
	shading: PdfShadingResource,
	shadingIndex: number,
	effects: readonly PdfUnsupportedEffectData[],
): Record<string, unknown> => {
	const importPaint = shadingPaintMetadata(shading);
	const data: Record<string, unknown> = {
		importFormat: AI_PDF_COMPATIBLE_SOURCE_FORMAT,
		importElement: "pdf-shading",
		importPath: `${context.streamPath}/shading[${shadingIndex}]`,
		importRef: `page-${context.pageIndex + 1}-content-${context.contentIndex + 1}-shading-${shadingIndex + 1}`,
		importPdfOperator: "sh",
		importPaint,
		...(context.sourceName ? { importSource: context.sourceName } : {}),
	};
	const importEffects = importEffectsData(effects);
	if (importEffects) data.importEffects = importEffects;
	const importAppearance = createImportedAppearanceMetadataData({
		effects,
		clipMaskRelations: importedClipMaskRelationsData(nodeId, effects),
		paint: importPaint,
	});
	if (importAppearance) data.importAppearance = importAppearance;
	return data;
};

const nodeForShading = (
	shading: PdfShadingResource,
	state: GraphicsState,
	context: PdfContentContext,
	issues: AiImportIssue[],
): VectorNode => {
	const shadingIndex = context.paintedShadingCount;
	const nodeId = context.nextId("node", `shading-${shadingIndex + 1}`);
	issues.push(
		issue(
			"info",
			"ai.pdf_approximated_shading",
			`PDF ${shading.kind} shading /${shading.ref} was imported as an editable gradient paint on a page-sized rectangle.`,
			{
				sourceName: context.sourceName,
				ref: shading.ref,
				path: context.streamPath,
			},
		),
	);
	return {
		id: nodeId,
		name: `PDF Gradient ${shadingIndex + 1}`,
		artboardId: context.artboardId,
		geometry: {
			kind: "rect",
			bounds: {
				x: shading.bounds.x,
				y: shading.bounds.y,
				width: shading.bounds.width,
				height: shading.bounds.height,
			},
			cornerRadius: 0,
		},
		transform: matrixToTransform(
			state.ctm,
			{ sourceName: context.sourceName, path: context.streamPath },
			issues,
		),
		style: {
			fill: shading.fallbackColor,
			stroke: "none",
			strokeWidth: DEFAULT_PDF_STYLE.strokeWidth,
			opacity: state.fillOpacity,
			fills: [shading.paint],
			...(state.blendMode ? { blendMode: state.blendMode } : {}),
		},
		visible: true,
		locked: false,
		data: shadingNodeData(
			nodeId,
			context,
			shading,
			shadingIndex,
			state.unsupportedEffects,
		),
	};
};

const stringDataField = (
	data: Record<string, unknown> | undefined,
	field: string,
): string | undefined => {
	const value = data?.[field];
	return typeof value === "string" && value.length > 0 ? value : undefined;
};

const recordDataField = (
	data: Record<string, unknown> | undefined,
	field: string,
): Record<string, unknown> | undefined => {
	const value = data?.[field];
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: undefined;
};

const targetKey = (target: ImportIssueAffectedTarget): string =>
	`${target.kind}:${target.id}`;

const uniqueTargets = (
	targets: readonly ImportIssueAffectedTarget[],
): readonly ImportIssueAffectedTarget[] => [
	...new Map(targets.map((target) => [targetKey(target), target])).values(),
];

const importPathStartsWith = (
	node: VectorNode,
	path: string | undefined,
	segment: "path" | "text",
): boolean => {
	const importPath = stringDataField(node.data, "importPath");
	return (
		path !== undefined && importPath?.startsWith(`${path}/${segment}[`) === true
	);
};

const metadataSourceMatches = (
	issue: AiImportIssue,
	metadata: { readonly ref?: string; readonly sourcePath?: string },
): boolean =>
	(issue.path !== undefined && metadata.sourcePath === issue.path) ||
	(issue.ref !== undefined && metadata.ref === issue.ref);

const effectKindForIssue = (
	code: AiImportIssueCode,
): "alpha-source" | "blend-mode" | "clip-path" | "soft-mask" | undefined => {
	if (code === "ai.pdf_unsupported_extgstate") return "alpha-source";
	if (code === "ai.pdf_unsupported_blend_mode") return "blend-mode";
	if (code === "ai.pdf_unsupported_clipping_path") return "clip-path";
	if (code === "ai.pdf_unsupported_soft_mask") return "soft-mask";
	return undefined;
};

const nodeMatchesAiImportIssue = (
	issue: AiImportIssue,
	node: VectorNode,
): boolean => {
	const effectKind = effectKindForIssue(issue.code);
	if (effectKind) {
		if (effectKind === "clip-path" || effectKind === "soft-mask") {
			return readImportedClipMaskRelations(node).some(
				(relation) =>
					relation.kind === effectKind &&
					metadataSourceMatches(issue, relation),
			);
		}
		return readImportedEffects(node).some(
			(effect) =>
				effect.kind === effectKind && metadataSourceMatches(issue, effect),
		);
	}

	if (
		(issue.code === "ai.pdf_approximated_fill_rule" ||
			issue.code === "ai.pdf_compound_path_split") &&
		metadataSourceMatches(issue, readImportedCompoundPath(node) ?? {})
	) {
		return true;
	}

	if (issue.code === "ai.pdf_approximated_shading") {
		const importedPaint = readImportedPaint(node);
		return [importedPaint?.fill, importedPaint?.stroke].some(
			(paint) => paint !== undefined && metadataSourceMatches(issue, paint),
		);
	}

	if (
		(issue.code === "ai.pdf_approximated_text_metrics" ||
			issue.code === "ai.pdf_approximated_text_font" ||
			issue.code === "ai.pdf_approximated_text_spacing" ||
			issue.code === "ai.pdf_unsupported_text_clipping") &&
		stringDataField(node.data, "importElement") === "pdf-text" &&
		importPathStartsWith(node, issue.path, "text")
	) {
		return true;
	}

	if (
		(issue.code === "ai.pdf_approximated_stroke_dash" ||
			issue.code === "ai.pdf_approximated_stroke_dash_phase" ||
			issue.code === "ai.pdf_approximated_stroke_linecap" ||
			issue.code === "ai.pdf_approximated_stroke_linejoin" ||
			issue.code === "ai.pdf_approximated_stroke_miter_limit") &&
		stringDataField(node.data, "importElement") === "pdf-path" &&
		recordDataField(node.data, "importStroke") !== undefined &&
		importPathStartsWith(node, issue.path, "path")
	) {
		return true;
	}

	return false;
};

const attachAiImportIssueTargetMetadata = (
	issues: readonly AiImportIssue[],
	nodes: readonly VectorNode[],
): readonly AiImportIssue[] =>
	issues.map((item) => {
		const effectKind = effectKindForIssue(item.code);
		const affectedNodeIds = nodes.flatMap((node) =>
			nodeMatchesAiImportIssue(item, node) ? [node.id] : [],
		);
		if (affectedNodeIds.length === 0) return item;
		const affectedTargets = uniqueTargets([
			...(item.affectedTargets ?? []),
			...affectedNodeIds.map(
				(id) => ({ kind: "node", id }) satisfies ImportIssueAffectedTarget,
			),
		]);
		return {
			...item,
			affectedTargets,
			...(effectKind === "clip-path" || effectKind === "soft-mask"
				? { fallbackType: "unclipped-vector" }
				: effectKind === "alpha-source"
					? { fallbackType: "appearance-fallback" }
					: {}),
			...(affectedNodeIds.length === 1 && !item.nodeId
				? { nodeId: affectedNodeIds[0] }
				: {}),
		};
	});

const nodesForPaint = (
	builder: PathBuilder,
	mode: PaintMode,
	state: GraphicsState,
	context: PdfContentContext,
	issues: AiImportIssue[],
): readonly VectorNode[] => {
	if (mode.close) closePath(builder);
	if (mode.evenOdd) {
		issues.push(
			issue(
				"info",
				"ai.pdf_approximated_fill_rule",
				"Even-odd PDF fill rule was imported with the scene default fill rule.",
				{ sourceName: context.sourceName, path: context.streamPath },
			),
		);
	}

	const validSubpaths = builder.subpaths.filter(
		(subpath) => subpath.vertices.length >= 2,
	);
	if (validSubpaths.length === 0) {
		issues.push(
			issue(
				"info",
				"ai.pdf_degenerate_path",
				`${mode.operator} painted an empty or degenerate path, so no scene node was created.`,
				{ sourceName: context.sourceName, path: context.streamPath },
			),
		);
		return [];
	}

	if (validSubpaths.length > 1) {
		issues.push(
			issue(
				"warning",
				"ai.pdf_compound_path_split",
				"Compound PDF path was split into separate editable scene paths.",
				{ sourceName: context.sourceName, path: context.streamPath },
			),
		);
	}

	const style = styleForPaint(mode, state, issues, {
		sourceName: context.sourceName,
		path: context.streamPath,
	});
	const strokeFidelity = pdfStrokeFidelityData(mode, state);
	const compoundPath =
		validSubpaths.length > 1
			? ({
					source: "pdf-path",
					fillRule: mode.evenOdd ? "evenodd" : "nonzero",
					subpathCount: validSubpaths.length,
					sourcePath: context.streamPath,
				} satisfies Omit<PdfCompoundPathFidelityData, "subpathIndex">)
			: undefined;
	const transform = matrixToTransform(
		state.ctm,
		{
			sourceName: context.sourceName,
			path: context.streamPath,
		},
		issues,
	);

	return validSubpaths.flatMap((subpath, index) => {
		const geometry =
			validSubpaths.length === 1
				? (rectGeometryFromSubpath(subpath) ?? {
						kind: "path",
						shape: shapeFromSubpath(subpath),
					})
				: ({
						kind: "path",
						shape: shapeFromSubpath(subpath),
					} satisfies NodeGeometry);
		const pathIndex = context.paintedPathCount + index;
		const name =
			geometry.kind === "rect"
				? `PDF Rect ${pathIndex + 1}`
				: `PDF Path ${pathIndex + 1}`;
		const nodeId = context.nextId("node", `${geometry.kind}-${pathIndex + 1}`);

		return {
			id: nodeId,
			name,
			artboardId: context.artboardId,
			geometry,
			transform,
			style,
			visible: true,
			locked: false,
			data: nodeData(
				nodeId,
				context,
				mode.operator,
				pathIndex,
				strokeFidelity,
				state.unsupportedEffects,
				compoundPath
					? {
							...compoundPath,
							subpathIndex: index,
						}
					: undefined,
			),
		} satisfies VectorNode;
	});
};

const unsupportedOperatorIssue = (
	operator: string,
	message: string,
	context: PdfContentContext,
	issues: AiImportIssue[],
	code: AiImportIssueCode = "ai.pdf_unsupported_operator",
) => {
	issueOnce(
		issues,
		context.issueKeys,
		issue("warning", code, message, {
			sourceName: context.sourceName,
			path: context.streamPath,
		}),
		[code, context.streamPath, operator],
	);
};

const unsupportedReferencedOperatorIssue = (
	operator: string,
	message: string,
	context: PdfContentContext,
	issues: AiImportIssue[],
	code: AiImportIssueCode,
	ref: string | undefined,
) => {
	issueOnce(
		issues,
		context.issueKeys,
		issue("warning", code, message, {
			sourceName: context.sourceName,
			path: context.streamPath,
			...(ref ? { ref } : {}),
		}),
		[code, context.streamPath, operator, ref ?? "(anonymous)"],
	);
};

const invalidOperandsIssue = (
	operator: string,
	context: PdfContentContext,
	issues: AiImportIssue[],
) => {
	issues.push(
		issue(
			"warning",
			"ai.pdf_invalid_operator_operands",
			`PDF operator ${operator} did not receive the numeric operands required by the MVP importer.`,
			{ sourceName: context.sourceName, path: context.streamPath },
		),
	);
};

const isOperatorTokenAt = (
	tokens: readonly PdfToken[],
	index: number,
	operator: string,
): boolean => {
	const token = tokens[index];
	return token?.kind === "operator" && token.operator === operator;
};

const parseContentStream = (
	stream: string,
	initialState: GraphicsState,
	context: PdfContentContext,
	issues: AiImportIssue[],
): readonly VectorNode[] => {
	const tokens = tokenizeContentStream(stream);
	const nodes: VectorNode[] = [];
	const stack: GraphicsState[] = [];
	let state = cloneGraphicsState(initialState);
	let textState = initialTextState();
	let textNodeCount = 0;
	let path = newPath();
	let operands: PdfOperand[] = [];

	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (!token) break;
		if (token.kind !== "operator") {
			operands.push(token);
			continue;
		}

		const operator = token.operator;
		if (operator === "BI") {
			unsupportedOperatorIssue(
				operator,
				"PDF inline image data is not imported by the AI vector MVP.",
				context,
				issues,
				"ai.pdf_unsupported_inline_image",
			);
			while (index < tokens.length && !isOperatorTokenAt(tokens, index, "EI")) {
				index += 1;
			}
			operands = [];
			continue;
		}

		if (operator === "q") {
			stack.push(cloneGraphicsState(state));
		} else if (operator === "Q") {
			const previous = stack.pop();
			if (previous) {
				state = previous;
			} else {
				issues.push(
					issue(
						"warning",
						"ai.pdf_invalid_content_stream",
						"PDF graphics state restore appeared without a matching save.",
						{ sourceName: context.sourceName, path: context.streamPath },
					),
				);
			}
		} else if (operator === "cm") {
			const values = numbersFrom(operands, 6);
			if (!values) {
				invalidOperandsIssue(operator, context, issues);
			} else {
				const [a, b, c, d, e, f] = values;
				state = {
					...state,
					ctm: multiplyMatrix(state.ctm, { a, b, c, d, e, f }),
				};
			}
		} else if (operator === "w") {
			const values = numbersFrom(operands, 1);
			if (!values) {
				invalidOperandsIssue(operator, context, issues);
			} else {
				state = { ...state, strokeWidth: Math.max(0, values[0]) };
			}
		} else if (operator === "J") {
			const values = numbersFrom(operands, 1);
			const lineCap = values ? lineCapFromPdf(values[0]) : undefined;
			if (!lineCap) {
				invalidOperandsIssue(operator, context, issues);
			} else {
				state = { ...state, lineCap };
			}
		} else if (operator === "j") {
			const values = numbersFrom(operands, 1);
			const lineJoin = values ? lineJoinFromPdf(values[0]) : undefined;
			if (!lineJoin) {
				invalidOperandsIssue(operator, context, issues);
			} else {
				state = { ...state, lineJoin };
			}
		} else if (operator === "M") {
			const values = numbersFrom(operands, 1);
			if (!values || values[0] <= 0) {
				invalidOperandsIssue(operator, context, issues);
			} else {
				state = { ...state, miterLimit: values[0] };
			}
		} else if (operator === "d") {
			const values = numericOperands(operands);
			if (!values || values.length === 0) {
				invalidOperandsIssue(operator, context, issues);
			} else {
				const dashPhase = values[values.length - 1] ?? 0;
				const dashArray = values.slice(0, -1).filter((value) => value >= 0);
				state = { ...state, dashArray, dashPhase };
			}
		} else if (operator === "rg" || operator === "RG") {
			const values = numbersFrom(operands, 3);
			if (!values) {
				invalidOperandsIssue(operator, context, issues);
			} else {
				const color = rgb(values[0], values[1], values[2]);
				state =
					operator === "rg"
						? { ...state, fillColor: color }
						: { ...state, strokeColor: color };
			}
		} else if (operator === "g" || operator === "G") {
			const values = numbersFrom(operands, 1);
			if (!values) {
				invalidOperandsIssue(operator, context, issues);
			} else {
				const color = rgb(values[0], values[0], values[0]);
				state =
					operator === "g"
						? { ...state, fillColor: color }
						: { ...state, strokeColor: color };
			}
		} else if (operator === "k" || operator === "K") {
			const values = numbersFrom(operands, 4);
			if (!values) {
				invalidOperandsIssue(operator, context, issues);
			} else {
				const color = cmykToRgb(values[0], values[1], values[2], values[3]);
				state =
					operator === "k"
						? { ...state, fillColor: color }
						: { ...state, strokeColor: color };
				issues.push(
					issue(
						"info",
						"ai.pdf_approximated_cmyk_color",
						"PDF CMYK color was converted to scene RGB.",
						{ sourceName: context.sourceName, path: context.streamPath },
					),
				);
			}
		} else if (operator === "gs") {
			const name = nameFrom(operands);
			const extGState = name ? context.extGStates.get(name) : undefined;
			if (!name || !extGState) {
				unsupportedOperatorIssue(
					operator,
					`PDF ExtGState ${name ?? "(missing)"} could not be resolved by the MVP importer.`,
					context,
					issues,
					"ai.pdf_unsupported_extgstate",
				);
			} else {
				const unsupportedEffects: PdfUnsupportedEffectData[] = [
					...state.unsupportedEffects,
				];
				if (extGState.unsupportedBlendMode) {
					unsupportedEffects.push({
						kind: "blend-mode",
						value: extGState.unsupportedBlendMode,
						sourcePath: context.streamPath,
					});
				}
				if (extGState.unsupportedEntries.includes("soft-mask")) {
					unsupportedEffects.push({
						kind: "soft-mask",
						value: "/SMask",
						sourcePath: context.streamPath,
					});
				}
				if (extGState.unsupportedEntries.includes("alpha-source")) {
					unsupportedEffects.push({
						kind: "alpha-source",
						value: "/AIS true",
						sourcePath: context.streamPath,
					});
				}
				state = {
					...state,
					fillOpacity: extGState.fillOpacity ?? state.fillOpacity,
					strokeOpacity: extGState.strokeOpacity ?? state.strokeOpacity,
					blendMode: extGState.blendMode ?? state.blendMode,
					unsupportedEffects,
				};
				if (extGState.unsupportedEntries.length > 0) {
					if (extGState.unsupportedBlendMode) {
						unsupportedOperatorIssue(
							operator,
							`PDF blend mode ${extGState.unsupportedBlendMode} is not represented in the scene model and was ignored.`,
							context,
							issues,
							"ai.pdf_unsupported_blend_mode",
						);
					}
					if (extGState.unsupportedEntries.includes("soft-mask")) {
						unsupportedOperatorIssue(
							operator,
							"PDF soft masks are not represented in the scene model and were ignored.",
							context,
							issues,
							"ai.pdf_unsupported_soft_mask",
						);
					}
					if (
						extGState.unsupportedEntries.some(
							(entry) =>
								!entry.startsWith("blend-mode:") && entry !== "soft-mask",
						)
					) {
						unsupportedOperatorIssue(
							operator,
							`PDF ExtGState entries are not imported: ${extGState.unsupportedEntries.join(", ")}.`,
							context,
							issues,
							"ai.pdf_unsupported_extgstate",
						);
					}
				}
			}
		} else if (operator === "m") {
			const values = numbersFrom(operands, 2);
			if (values) moveTo(path, point(values[0], values[1]));
			else invalidOperandsIssue(operator, context, issues);
		} else if (operator === "l") {
			const values = numbersFrom(operands, 2);
			if (values) {
				if (!lineTo(path, point(values[0], values[1]))) {
					invalidOperandsIssue(operator, context, issues);
				}
			} else {
				invalidOperandsIssue(operator, context, issues);
			}
		} else if (operator === "c") {
			const values = numbersFrom(operands, 6);
			if (values) {
				const ok = appendCubic(
					path,
					point(values[0], values[1]),
					point(values[2], values[3]),
					point(values[4], values[5]),
				);
				if (!ok) invalidOperandsIssue(operator, context, issues);
			} else {
				invalidOperandsIssue(operator, context, issues);
			}
		} else if (operator === "v") {
			const values = numbersFrom(operands, 4);
			if (values && path.current) {
				const ok = appendCubic(
					path,
					path.current,
					point(values[0], values[1]),
					point(values[2], values[3]),
				);
				if (!ok) invalidOperandsIssue(operator, context, issues);
			} else {
				invalidOperandsIssue(operator, context, issues);
			}
		} else if (operator === "y") {
			const values = numbersFrom(operands, 4);
			if (values) {
				const to = point(values[2], values[3]);
				const ok = appendCubic(path, point(values[0], values[1]), to, to);
				if (!ok) invalidOperandsIssue(operator, context, issues);
			} else {
				invalidOperandsIssue(operator, context, issues);
			}
		} else if (operator === "h") {
			closePath(path);
		} else if (operator === "re") {
			const values = numbersFrom(operands, 4);
			if (values) rectPath(path, values[0], values[1], values[2], values[3]);
			else invalidOperandsIssue(operator, context, issues);
		} else if (
			operator === "f" ||
			operator === "F" ||
			operator === "f*" ||
			operator === "S" ||
			operator === "s" ||
			operator === "B" ||
			operator === "B*" ||
			operator === "b" ||
			operator === "b*"
		) {
			const mode: PaintMode = {
				fill: ["f", "F", "f*", "B", "B*", "b", "b*"].includes(operator),
				stroke: ["S", "s", "B", "B*", "b", "b*"].includes(operator),
				close: ["s", "b", "b*"].includes(operator),
				evenOdd: operator.endsWith("*"),
				operator,
			};
			const painted = nodesForPaint(path, mode, state, context, issues);
			nodes.push(...painted);
			context.paintedPathCount += painted.length;
			path = newPath();
		} else if (operator === "n") {
			path = newPath();
		} else if (operator === "W" || operator === "W*") {
			unsupportedOperatorIssue(
				operator,
				"PDF clipping paths are not represented in the first scene import subset.",
				context,
				issues,
				"ai.pdf_unsupported_clipping_path",
			);
			state = {
				...state,
				unsupportedEffects: [
					...state.unsupportedEffects,
					{
						kind: "clip-path",
						value: operator,
						sourcePath: context.streamPath,
					},
				],
			};
		} else if (
			operator === "cs" ||
			operator === "CS" ||
			operator === "sc" ||
			operator === "SC" ||
			operator === "scn" ||
			operator === "SCN"
		) {
			unsupportedOperatorIssue(
				operator,
				"PDF custom color spaces and pattern colors are not imported by the MVP importer.",
				context,
				issues,
				"ai.pdf_unsupported_color_space",
			);
		} else if (operator === "Do") {
			const xobjectName = nameFrom(operands);
			if (xobjectName && context.transparencyGroupXObjects.has(xobjectName)) {
				unsupportedReferencedOperatorIssue(
					operator,
					`PDF transparency group XObject ${xobjectName} is not represented in the scene model and was ignored.`,
					context,
					issues,
					"ai.pdf_unsupported_transparency_group",
					xobjectName,
				);
			}
			unsupportedReferencedOperatorIssue(
				operator,
				xobjectName
					? `PDF XObject/image asset ${xobjectName} is not imported by the AI vector MVP.`
					: "PDF XObject/image asset drawing is not imported by the AI vector MVP.",
				context,
				issues,
				"ai.pdf_unsupported_xobject",
				xobjectName,
			);
		} else if (operator === "sh") {
			const shadingName = nameFrom(operands);
			const shading = shadingName
				? context.shadings.get(shadingName)
				: undefined;
			if (shading) {
				nodes.push(nodeForShading(shading, state, context, issues));
				context.paintedShadingCount += 1;
			} else {
				unsupportedReferencedOperatorIssue(
					operator,
					shadingName
						? `PDF shading asset ${shadingName} is not imported by the AI vector MVP.`
						: "PDF shading assets are not imported by the AI vector MVP.",
					context,
					issues,
					"ai.pdf_unsupported_shading",
					shadingName,
				);
			}
		} else if (operator === "BT") {
			textState = { ...initialTextState(), active: true };
		} else if (operator === "ET") {
			textState = { ...textState, active: false };
		} else if (operator === "Tf") {
			const font = fontOperands(operands);
			if (!font || font.fontSize <= 0) {
				invalidOperandsIssue(operator, context, issues);
			} else {
				textState = {
					...textState,
					fontName: font.fontName,
					fontSize: font.fontSize,
					leading:
						Math.abs(textState.leading - DEFAULT_PDF_TEXT_STYLE.lineHeight) <=
						0.000001
							? font.fontSize * 1.2
							: textState.leading,
				};
			}
		} else if (operator === "TL") {
			const values = numbersFrom(operands, 1);
			if (!values || values[0] <= 0) {
				invalidOperandsIssue(operator, context, issues);
			} else {
				textState = { ...textState, leading: values[0] };
			}
		} else if (operator === "Td" || operator === "TD") {
			const values = numbersFrom(operands, 2);
			if (!values) {
				invalidOperandsIssue(operator, context, issues);
			} else {
				const [tx, ty] = values;
				const lineMatrix = multiplyMatrix(
					textState.lineMatrix,
					translateMatrix(tx, ty),
				);
				textState = {
					...textState,
					...(operator === "TD" ? { leading: Math.abs(ty) } : {}),
					lineMatrix,
					textMatrix: lineMatrix,
				};
			}
		} else if (operator === "Tm") {
			const matrix = textMatrixOperands(operands);
			if (!matrix) {
				invalidOperandsIssue(operator, context, issues);
			} else {
				textState = { ...textState, lineMatrix: matrix, textMatrix: matrix };
			}
		} else if (operator === "T*") {
			textState = moveTextLine(textState);
		} else if (operator === "Tr") {
			const values = numbersFrom(operands, 1);
			const renderingMode = values
				? pdfTextRenderingModeFrom(values[0])
				: undefined;
			if (renderingMode === undefined) {
				invalidOperandsIssue(operator, context, issues);
			} else {
				textState = { ...textState, renderingMode };
			}
		} else if (
			operator === "Tj" ||
			operator === "TJ" ||
			operator === "'" ||
			operator === '"'
		) {
			if (operator === "'" || operator === '"') {
				textState = moveTextLine(textState);
			}
			const text = textFromOperands(operands);
			const node = textNodeForShow(
				operator,
				text,
				textState,
				state,
				context,
				textNodeCount,
				issues,
				hasTextSpacingApproximation(operator, operands),
			);
			if (node) nodes.push(node);
			if (textState.active && text.length > 0) {
				textState = advanceTextState(textState, text);
			}
			if (node) textNodeCount += 1;
		} else if (["Tc", "Tw", "Tz", "Ts"].includes(operator)) {
			unsupportedOperatorIssue(
				operator,
				`PDF text operator ${operator} affects typography details outside the basic editable text import subset.`,
				context,
				issues,
				"ai.pdf_unsupported_text",
			);
		} else if (
			["i", "ri", "BX", "EX", "MP", "DP", "BMC", "BDC", "EMC"].includes(
				operator,
			)
		) {
			unsupportedOperatorIssue(
				operator,
				`PDF operator ${operator} affects rendering metadata or stroke details outside the MVP scene model.`,
				context,
				issues,
			);
		} else {
			unsupportedOperatorIssue(
				operator,
				`PDF operator ${operator} is outside the first AI vector import subset.`,
				context,
				issues,
			);
		}

		operands = [];
	}

	if (stack.length > 0) {
		issues.push(
			issue(
				"warning",
				"ai.pdf_invalid_content_stream",
				"PDF content stream ended with unbalanced graphics state saves.",
				{ sourceName: context.sourceName, path: context.streamPath },
			),
		);
	}

	return nodes;
};

const countLayerNodes = (layers: readonly SceneLayer[]): number =>
	layers.reduce((count, layer) => count + layer.nodes.length, 0);

/**
 * Converts the PDF-compatible portion of an Illustrator file into import-ready
 * scene layers. This MVP intentionally handles only plain, uncompressed PDF
 * graphics streams and reports every approximated or unsupported graphics
 * feature as an import issue instead of reading native AI private data.
 */
export function parseAiPdfCompatibleToImportedScenePayload(
	payload: AiPdfCompatibleAdapterPayload,
	options: AnalyzeAiImportOptions = {},
): ImportedScenePayload {
	const fullText = decoder.decode(payload.bytes);
	const context: PdfParseContext = {
		sourceName: options.sourceName ?? payload.sourceName,
		layerName: options.layerName,
		idPrefix: options.idPrefix,
		metadata: payload.metadata,
		fullText,
		issueKeys: new Set<string>(),
	};
	const result = parsePdfScenePayload(context);
	return result.payload;
}

const parsePdfScenePayload = (
	context: PdfParseContext,
): PdfSceneParseResult => {
	const issues: AiImportIssue[] = [];
	const objects = parsePdfObjects(context.fullText);
	const objectsById = new Map(objects.map((object) => [object.id, object]));
	const pageObjects = objects.filter((object) =>
		/\/Type\s*\/Page\b/.test(object.body),
	);
	const firstPage = pageObjects[0];
	if (pageObjects.length > 1) {
		issues.push(
			issue(
				"warning",
				"ai.pdf_multiple_pages_unsupported",
				"Only the first PDF page is imported by the AI vector MVP.",
				context,
			),
		);
	}

	const selectedBox = pageBoxFrom(firstPage?.body, context.metadata);
	const box = selectedBox ?? DEFAULT_PDF_BOX;
	if (!selectedBox) {
		issues.push(
			issue(
				"warning",
				"ai.pdf_page_box_missing",
				"PDF page box was missing; a fallback import artboard was used.",
				context,
			),
		);
	}

	const contentRefs = firstPage ? contentRefsFromPage(firstPage.body) : [];
	if (contentRefs.length === 0) {
		issues.push(
			issue(
				"warning",
				"ai.pdf_content_stream_missing",
				"No first-page PDF content streams were found for scene conversion.",
				context,
			),
		);
	}

	const nextId = makeIdFactory(
		context.idPrefix ?? context.sourceName ?? context.metadata.title,
	);
	const artboards = pdfPageArtboards(pageObjects, box, nextId, context, issues);
	const firstArtboard =
		artboards[0] ??
		createImportArtboard({
			id: nextId("artboard", "page-1"),
			name: pdfArtboardName(context, 0, 1),
			bounds: pdfArtboardBounds(box, 0),
		});
	const extGStates = parseExtGStates(context.fullText, objects);
	const shadings = parseShadings(context.fullText, objects, box);
	const transparencyGroupXObjects = parseTransparencyGroupXObjects(
		context.fullText,
		objects,
	);
	const initialState = initialGraphicsState(box);
	const nodes: VectorNode[] = [];

	contentRefs.forEach((objectId, contentIndex) => {
		const object = objectsById.get(objectId);
		const streamPath = `/Page[0]/Contents[${contentIndex}]`;
		if (!object?.stream) {
			issues.push(
				issue(
					"warning",
					"ai.pdf_invalid_content_stream",
					`PDF content object ${objectId} did not contain a readable stream.`,
					{ sourceName: context.sourceName, path: streamPath },
				),
			);
			return;
		}
		if (object.filter) {
			issues.push(
				issue(
					"warning",
					"ai.pdf_unsupported_filter",
					`PDF content stream ${objectId} uses /${object.filter}; compressed streams need an approved parser/decoder dependency.`,
					{ sourceName: context.sourceName, path: streamPath },
				),
			);
			return;
		}

		const contentContext: PdfContentContext = {
			...context,
			streamPath,
			pageIndex: 0,
			artboardId: firstArtboard.id,
			pageBox: box,
			contentIndex,
			nextId,
			extGStates,
			shadings,
			transparencyGroupXObjects,
			paintedPathCount: nodes.filter(
				(node) => node.data?.importElement === "pdf-path",
			).length,
			paintedShadingCount: nodes.filter(
				(node) => node.data?.importElement === "pdf-shading",
			).length,
		};
		nodes.push(
			...parseContentStream(
				object.stream,
				initialState,
				contentContext,
				issues,
			),
		);
	});

	if (nodes.length > 0) {
		issues.unshift(
			issue(
				"info",
				"ai.pdf_scene_imported",
				`Imported ${nodes.length} editable vector node${nodes.length === 1 ? "" : "s"} from the PDF-compatible payload.`,
				context,
			),
		);
	}
	const targetedIssues = attachAiImportIssueTargetMetadata(issues, nodes);

	const layer: SceneLayer = {
		id: nextId("layer", context.layerName ?? context.sourceName),
		name: context.layerName ?? context.sourceName ?? "Imported AI PDF",
		visible: true,
		locked: false,
		nodes,
	};

	return {
		issues: targetedIssues,
		payload: {
			sourceName: context.sourceName,
			sourceFormat: AI_PDF_COMPATIBLE_SOURCE_FORMAT,
			issues: targetedIssues,
			artboards,
			currentArtboardId: firstArtboard.id,
			layers: nodes.length > 0 ? [layer] : [],
		},
	};
};

/**
 * Performs the dependency-free first pass for `.ai` import. It detects whether
 * the input exposes a PDF-compatible payload, converts the supported PDF vector
 * subset to scene layers, and reports native Illustrator/private data as
 * unsupported rather than parsing it.
 */
export function analyzeAiImport(
	input: AiImportSource,
	options: AnalyzeAiImportOptions = {},
): AiImportAnalysis {
	const bytes = normalizeInput(input);
	const sourceName = options.sourceName;
	const scanWindow = Math.max(
		options.scanTextBytes ?? DEFAULT_SCAN_TEXT_BYTES,
		1,
	);
	const text = scanText(bytes, scanWindow);
	const fullText = decoder.decode(bytes);
	const metadata = extractMetadata(text);

	if (bytes.length === 0) {
		const issues = [
			issue("error", "ai.empty_input", "The .ai input is empty.", sourceName),
		];
		return {
			kind: "unsupported",
			supported: false,
			sourceFormat: UNKNOWN_SOURCE_FORMAT,
			...(sourceName ? { sourceName } : {}),
			metadata,
			issues,
			fidelityReport: fidelityReport(false, UNKNOWN_SOURCE_FORMAT, issues),
		};
	}

	const pdfHeaderOffset = indexOfAscii(
		bytes,
		PDF_HEADER,
		PDF_HEADER_SCAN_LIMIT,
	);
	const isPdfCompatible = pdfHeaderOffset >= 0;

	if (!isPdfCompatible) {
		const sourceFormat = hasLegacyIllustratorPostScript(text)
			? AI_NATIVE_OR_LEGACY_SOURCE_FORMAT
			: UNKNOWN_SOURCE_FORMAT;
		const issues = [
			issue(
				"error",
				"ai.pdf_payload_missing",
				"This .ai file does not expose a PDF-compatible payload in the file header.",
				sourceName,
			),
			issue(
				"error",
				"ai.native_private_data_unsupported",
				"Native Illustrator private/PostScript data is outside the initial import scope.",
				sourceName,
			),
		];
		return {
			kind: "unsupported",
			supported: false,
			sourceFormat,
			...(sourceName ? { sourceName } : {}),
			metadata,
			issues,
			fidelityReport: fidelityReport(false, sourceFormat, issues),
		};
	}

	const adapterPayload: AiPdfCompatibleAdapterPayload = {
		kind: "pdf-compatible-ai-payload",
		targetPipeline: "pdf-compatible-import",
		mediaType: PDF_MEDIA_TYPE,
		sourceFormat: AI_PDF_COMPATIBLE_SOURCE_FORMAT,
		...(sourceName ? { sourceName } : {}),
		bytes,
		metadata,
	};
	const parsed = parsePdfScenePayload({
		sourceName,
		layerName: options.layerName,
		idPrefix: options.idPrefix,
		metadata,
		fullText,
		issueKeys: new Set<string>(),
	});
	const issues: AiImportIssue[] = [
		issue(
			"info",
			"ai.pdf_payload_detected",
			"PDF-compatible payload detected; supported vector content was inspected for scene import.",
			sourceName,
		),
		...parsed.issues,
	];

	if (metadata.illustratorMarkers.length === 0) {
		issues.push(
			issue(
				"warning",
				"ai.illustrator_marker_missing",
				"The PDF payload lacks Adobe Illustrator markers, so it is treated as PDF-compatible but not confirmed as Illustrator-authored.",
				sourceName,
			),
		);
	}

	if (hasNativeIllustratorPrivateData(text)) {
		issues.push(
			issue(
				"warning",
				"ai.native_private_data_unsupported",
				"Native Illustrator private data was detected but is not parsed by this adapter.",
				sourceName,
			),
		);
	}

	if (countLayerNodes(parsed.payload.layers) === 0) {
		issues.push(
			issue(
				"warning",
				"ai.pdf_scene_conversion_pending",
				"No supported editable vector paths were imported from this PDF-compatible payload.",
				sourceName,
			),
		);
	}

	const scenePayload: ImportedScenePayload = {
		...parsed.payload,
		issues,
	};

	return {
		kind: "pdf-compatible",
		supported: true,
		sourceFormat: AI_PDF_COMPATIBLE_SOURCE_FORMAT,
		...(sourceName ? { sourceName } : {}),
		metadata,
		issues,
		fidelityReport: fidelityReport(
			true,
			AI_PDF_COMPATIBLE_SOURCE_FORMAT,
			issues,
			countLayerNodes(scenePayload.layers),
			scenePayload.artboards?.length ?? 0,
		),
		adapterPayload,
		scenePayload,
	};
}

export const AI_PDF_IMPORT_SUPPORTED_SUBSET = PDF_IMPORT_SUPPORTED_SUBSET;
export const AI_PDF_IMPORT_UNSUPPORTED_SUBSET = PDF_IMPORT_UNSUPPORTED_SUBSET;
