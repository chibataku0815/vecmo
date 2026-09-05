import {
	effectiveCornerRadii,
	effectiveCornerRadius,
	effectiveOpacity,
	effectiveShape,
	effectiveTransform,
} from "@/entities/motion/model/sampler";
import type { MotionDocument } from "@/entities/motion/model/types";
import type { MotionGrammarBinding } from "@/entities/motion-grammar/model/types";
import {
	affectedNodeIdsForMaskRelations,
	isImportedClipMaskKind,
	maskRelationSourceSummary,
	readAppearanceMaskRelations,
	readImportedCompoundPath,
	readImportedEffects,
	readImportedOpacityGroups,
	readImportedPaint,
} from "@/entities/scene/model/appearance";
import { resolveImageAssetReference } from "@/entities/scene/model/assets";
import {
	buildRoundedRectShape,
	filletPolygonShape,
	rectNeedsBakedPath,
	resolveCornerRadii,
	starVertices,
} from "@/entities/scene/model/corner-geometry";
import { sortedSceneFidelitySourcePaths } from "@/entities/scene/model/fidelity-issues";
import { lookGraphNodeLabel } from "@/entities/scene/model/look-graph";
import { compileLookGraph } from "@/entities/scene/model/look-graph-compile";
import {
	resolveFrameEffectIntent,
	resolveNodeRecipe,
} from "@/entities/scene/model/recipe-resolve";
import {
	getGeometryBounds,
	type Matrix2D,
	matrixFromTransform,
	type TextMetrics,
	textLineLeftForAlign,
	textMetricsForGeometry,
} from "@/entities/scene/model/rendering";
import type {
	ResolvedNodeStyle,
	ResolvedPaint,
} from "@/entities/scene/model/style-resolve";
import type {
	BezierShape,
	Bounds,
	NodeGeometry,
	SceneDocument,
	SceneLayer,
	Vec2,
	VectorNode,
} from "@/entities/scene/model/types";
import type { ExportIssue, ExportIssueSeverity } from "./issues";
import {
	type ExportAsset,
	fileStemForScene,
	stableJsonStringify,
} from "./json";
import {
	type ProgramSurfaceDeliveryDecision,
	type ProgramSurfaceDeliveryIssueCode,
	resolveProgramSurfaceDeliveryForGeometry,
} from "./program-surface-delivery";
import {
	buildExportRenderPresentation,
	type ExportRenderPresentation,
} from "./render-presentation";
import {
	createExportAppearanceFidelityTracker,
	type ExportAppearanceFidelity,
	type ExportAppearanceFidelityTracker,
	type ExportPaintRole,
	fallbackColorForRole,
	finalizeExportAppearanceFidelity,
	paintKindSummary,
	paintListForRole,
	paintListSummary,
	recordExportAppearanceFidelity,
	resolveExportNodeStyle,
	visibleStyleEffects,
} from "./style";
import {
	analyzeVecCoreRecipeSvgApproximation,
	VEC_CORE_RECIPE_PDF_UNSUPPORTED_ISSUE_CODE,
	vecCoreRecipePathSummary,
} from "./vec-core";

const PDF_MIME_TYPE = "application/pdf";
const PDF_PRODUCER = "vector-motion-author";
const PDF_EXPORT_FORMAT = "vector-motion-author/pdf";
const ELLIPSE_KAPPA = 0.552_284_749_830_793_6;
const FALLBACK_STROKE = "#d946ef";
const FALLBACK_FILL = "#fff1ff";
const PDF_TEXT_FONT = "Helvetica";
const PDF_TEXT_FONT_RESOURCE = "F1";
const PDF_STYLE_FALLBACK_COLOR = "#000000";

export type PdfExportIssueSeverity = Extract<
	ExportIssueSeverity,
	"warning" | "error"
>;

export type PdfExportIssueCode =
	| "external-asset-preview-fallback"
	| "external-asset-preview-required"
	| "image-asset-invalid-source"
	| "image-asset-missing"
	| "image-asset-pdf-fallback"
	| "program-surface-asset-missing"
	| "program-surface-declared-fallback-invalid"
	| "program-surface-declared-fallback-required"
	| "program-surface-manifest-invalid"
	| "program-surface-pdf-raster-fallback-unavailable"
	| "program-surface-static-output-unsupported"
	| "video-asset-frame-required"
	| "import-clip-mask-fallback"
	| "import-compound-path-split"
	| "import-effect-unsupported"
	| "import-opacity-group-flattened"
	| "import-paint-approximated"
	| "import-paint-unsupported"
	| "frame-look-graph-deferred-unsupported"
	| "invalid-artboard"
	| "invalid-path"
	| "invalid-primitive"
	| "mask-relation-fallback"
	| "style-blend-mode-unsupported"
	| "style-effect-unsupported"
	| "style-paint-approximated"
	| "style-paint-opacity-unsupported"
	| "style-paint-unsupported"
	| "style-stroke-align-unsupported"
	| "text-font-fallback"
	| "text-typography-unsupported"
	| "unsupported-color"
	| "unsupported-geometry"
	| "unsupported-opacity"
	| "vec-core-recipe-pdf-local-raster-required"
	| "vec-core-recipe-pdf-unsupported";

/**
 * A deterministic fidelity report entry embedded alongside the PDF bytes.
 * Visible unsupported content must produce an issue and a vector placeholder
 * instead of disappearing from the artboard.
 */
export type PdfExportIssue = ExportIssue & {
	readonly severity: PdfExportIssueSeverity;
	readonly code: PdfExportIssueCode;
	readonly fallback:
		| "default-color"
		| "font-substitution"
		| "local-raster-required"
		| "normalized-value"
		| "unclipped-vector"
		| "vector-placeholder";
};

export type PdfExportAsset = ExportAsset & {
	readonly kind: "pdf";
	readonly appearance: ExportAppearanceFidelity;
	readonly issues: readonly PdfExportIssue[];
};

/**
 * Full PDF render result. Keeping issues next to contents makes the fallback
 * policy testable without parsing PDF internals.
 */
export type PdfRenderResult = {
	readonly contents: string;
	readonly appearance: ExportAppearanceFidelity;
	readonly issues: readonly PdfExportIssue[];
};

type PdfExportInput = {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frame: number;
	readonly fileNameStem?: string;
	readonly grammarBindings?: readonly MotionGrammarBinding[];
	readonly renderPresentation?: ExportRenderPresentation;
};

type PdfColor = {
	readonly r: number;
	readonly g: number;
	readonly b: number;
};

type PdfPaint = {
	readonly fill: PdfColor | null;
	readonly stroke: PdfColor | null;
	readonly strokeWidth: number;
	readonly strokeDash: readonly number[];
	readonly strokeDashoffset: number;
	readonly strokeCap: ResolvedNodeStyle["strokeCap"];
	readonly strokeJoin: ResolvedNodeStyle["strokeJoin"];
	readonly strokeMiterLimit: number;
};

type PdfPaintResolution = {
	readonly paint: PdfPaint;
	readonly issues: readonly PdfExportIssue[];
};

type PdfRenderState = {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frame: number;
	readonly appearance: ExportAppearanceFidelityTracker;
	readonly issues: PdfExportIssue[];
	readonly opacityResources: Map<string, string>;
	nextOpacityIndex: number;
};

type PdfPageSize = {
	readonly width: number;
	readonly height: number;
};

type IssueContext = {
	readonly layerId?: string;
	readonly nodeId?: string;
};

type PdfMetadata = {
	readonly artboard: {
		readonly background: string;
		readonly height: number;
		readonly width: number;
	};
	readonly durationFrames: number;
	readonly exportFormat: typeof PDF_EXPORT_FORMAT;
	readonly fps: number;
	readonly frame: number;
	readonly issueCount: number;
	readonly issues: readonly PdfExportIssue[];
	readonly motionSchemaVersion: MotionDocument["schemaVersion"];
	readonly sceneSchemaVersion: SceneDocument["schemaVersion"];
};

const formatNumber = (value: number): string => {
	if (!Number.isFinite(value)) return "0";
	const rounded = Math.abs(value) < 1e-10 ? 0 : Number(value.toFixed(6));
	// String() and toFixed() both flip to exponent notation at |n| >= 1e21, which PDF number
	// syntax (ISO 32000-1) forbids as a content-stream token. This formatter is duplicated
	// byte-identically in pdf.ts and svg.ts, so both branches stay in sync. Every double this
	// large is integer-valued (past 2^52), so BigInt renders a plain-decimal token, never throwing.
	if (Math.abs(rounded) >= 1e21) return BigInt(rounded).toString();
	return String(rounded);
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const createState = (
	scene: SceneDocument,
	motion: MotionDocument,
	frame: number,
): PdfRenderState => ({
	scene,
	motion,
	frame,
	appearance: createExportAppearanceFidelityTracker(),
	issues: [],
	opacityResources: new Map(),
	nextOpacityIndex: 1,
});

const addIssue = (state: PdfRenderState, issue: PdfExportIssue): void => {
	state.issues.push(issue);
};

const recordAppearance = (
	state: PdfRenderState,
	status: Parameters<typeof recordExportAppearanceFidelity>[1],
	capability: string,
): void => {
	recordExportAppearanceFidelity(state.appearance, status, capability);
};

const importClipMaskIssue = (
	node: VectorNode,
	state: PdfRenderState,
	context: IssueContext,
): PdfExportIssue | null => {
	const relations = readAppearanceMaskRelations(node);
	if (relations.length === 0) return null;
	const affectedNodeIds = affectedNodeIdsForMaskRelations(
		relations,
		context.nodeId,
	);
	const affectedSummary = affectedNodeIds.join(", ");
	const importedOnly = relations.every(
		(relation) => relation.origin === "imported",
	);
	const relationSourcePaths = sortedSceneFidelitySourcePaths(
		relations.map((relation) => relation.sourcePath),
	);
	const issue: PdfExportIssue = {
		severity: "warning",
		category: "unsupported",
		code: importedOnly ? "import-clip-mask-fallback" : "mask-relation-fallback",
		message: `${importedOnly ? "Imported c" : "C"}lip/mask relation metadata (${maskRelationSourceSummary(relations)}) cannot be re-emitted by PDF export yet; affected nodes (${affectedSummary}) were exported as unclipped vector geometry.`,
		fallback: "unclipped-vector",
		...context,
		...(relationSourcePaths.length > 0
			? { sourcePaths: relationSourcePaths }
			: {}),
	};
	addIssue(state, issue);
	return issue;
};

const importEffectIssue = (
	node: VectorNode,
	state: PdfRenderState,
	context: IssueContext,
): PdfExportIssue | null => {
	const effects = readImportedEffects(node).filter(
		(effect) => !isImportedClipMaskKind(effect.kind),
	);
	if (effects.length === 0) return null;
	const effectSourcePaths = sortedSceneFidelitySourcePaths(
		effects.map((effect) => effect.sourcePath),
	);
	const issue: PdfExportIssue = {
		severity: "warning",
		category: "unsupported",
		code: "import-effect-unsupported",
		message: `Imported effect metadata (${effects
			.map((effect) => effect.kind)
			.join(
				", ",
			)}) has no scene/export representation; node was exported as unclipped vector geometry.`,
		fallback: "unclipped-vector",
		...context,
		...(effectSourcePaths.length > 0 ? { sourcePaths: effectSourcePaths } : {}),
	};
	addIssue(state, issue);
	return issue;
};

const importOpacityGroupIssue = (
	node: VectorNode,
	state: PdfRenderState,
	context: IssueContext,
): PdfExportIssue | null => {
	const groups = readImportedOpacityGroups(node);
	if (groups.length === 0) return null;
	const groupSourcePaths = sortedSceneFidelitySourcePaths(
		groups.map((group) => group.sourcePath),
	);
	const issue: PdfExportIssue = {
		severity: "warning",
		category: "approximated",
		code: "import-opacity-group-flattened",
		message: `Imported opacity group metadata (${groups
			.map((group) => `${group.source} ${group.opacity}`)
			.join(
				", ",
			)}) was flattened into node opacity; overlapping children may not composite exactly as the source.`,
		fallback: "normalized-value",
		...context,
		...(groupSourcePaths.length > 0 ? { sourcePaths: groupSourcePaths } : {}),
	};
	addIssue(state, issue);
	return issue;
};

const importPaintIssues = (
	node: VectorNode,
	state: PdfRenderState,
	context: IssueContext,
): readonly PdfExportIssue[] => {
	const paint = readImportedPaint(node);
	if (!paint) return [];
	const issues: PdfExportIssue[] = [];
	for (const role of ["fill", "stroke"] as const) {
		const entry = paint[role];
		if (!entry) continue;
		const ref = entry.ref ? ` #${entry.ref}` : "";
		const unsupported = entry.unsupported === true;
		const entrySourcePaths = sortedSceneFidelitySourcePaths([entry.sourcePath]);
		recordAppearance(
			state,
			unsupported ? "unsupported" : "approximated",
			`import:${role}:paint`,
		);
		const issue: PdfExportIssue = {
			severity: "warning",
			category: unsupported ? "unsupported" : "approximated",
			code: unsupported
				? "import-paint-unsupported"
				: "import-paint-approximated",
			message: unsupported
				? `Imported ${role} paint ${entry.source}${ref} had no usable scene paint and was exported with fallback ${entry.fallback}.`
				: `Imported ${role} paint ${entry.source}${ref} was flattened to solid ${entry.fallback} for scene/export compatibility.`,
			fallback: "default-color",
			...context,
			...(entrySourcePaths.length > 0 ? { sourcePaths: entrySourcePaths } : {}),
		};
		addIssue(state, issue);
		issues.push(issue);
	}
	return issues;
};

const importCompoundPathIssue = (
	node: VectorNode,
	state: PdfRenderState,
	context: IssueContext,
): PdfExportIssue | null => {
	const compound = readImportedCompoundPath(node);
	if (!compound) return null;
	const compoundSourcePaths = sortedSceneFidelitySourcePaths([
		compound.sourcePath,
	]);
	const issue: PdfExportIssue = {
		severity: "warning",
		category: "approximated",
		code: "import-compound-path-split",
		message: `Imported compound path subpath ${compound.subpathIndex ?? "?"} of ${compound.subpathCount ?? "?"} was exported as an independent editable path using ${compound.fillRule ?? "unknown"} fill-rule metadata.`,
		fallback: "normalized-value",
		...context,
		...(compoundSourcePaths.length > 0
			? { sourcePaths: compoundSourcePaths }
			: {}),
	};
	addIssue(state, issue);
	return issue;
};

const styleEffectIssue = (
	style: ResolvedNodeStyle,
	state: PdfRenderState,
	context: IssueContext,
): PdfExportIssue | null => {
	const effects = visibleStyleEffects(style);
	if (effects.length === 0) return null;
	for (const effect of effects) {
		recordAppearance(state, "unsupported", `effect:${effect.kind}`);
	}
	const issue: PdfExportIssue = {
		severity: "warning",
		category: "unsupported",
		code: "style-effect-unsupported",
		message: `Node effects (${effects.map((effect) => effect.kind).join(", ")}) cannot be emitted by the basic PDF writer yet; node was exported without those effects.`,
		fallback: "normalized-value",
		...context,
	};
	addIssue(state, issue);
	return issue;
};

const styleBlendModeIssue = (
	style: ResolvedNodeStyle,
	state: PdfRenderState,
	context: IssueContext,
): PdfExportIssue | null => {
	if (style.blendMode === "normal") return null;
	recordAppearance(state, "unsupported", "blend-mode");
	const issue: PdfExportIssue = {
		severity: "warning",
		category: "unsupported",
		code: "style-blend-mode-unsupported",
		message: `Blend mode "${style.blendMode}" cannot be emitted by the basic PDF writer yet; node was exported with normal compositing.`,
		fallback: "normalized-value",
		...context,
	};
	addIssue(state, issue);
	return issue;
};

const styleStrokeAlignIssue = (
	style: ResolvedNodeStyle,
	state: PdfRenderState,
	context: IssueContext,
): PdfExportIssue | null => {
	if (
		style.strokeAlign === "center" ||
		style.strokeWidth <= 0 ||
		paintListForRole(style, "stroke").length === 0
	) {
		return null;
	}
	recordAppearance(state, "unsupported", "stroke:align");
	const issue: PdfExportIssue = {
		severity: "warning",
		category: "unsupported",
		code: "style-stroke-align-unsupported",
		message: `Stroke align "${style.strokeAlign}" cannot be emitted by the basic PDF writer yet; stroke was exported centered.`,
		fallback: "normalized-value",
		...context,
	};
	addIssue(state, issue);
	return issue;
};

const vecCoreRecipePdfIssue = (
	node: VectorNode,
	state: PdfRenderState,
	context: IssueContext,
): PdfExportIssue | null => {
	const recipe = resolveNodeRecipe(node);
	if (!recipe) return null;
	recordAppearance(state, "preserved", "recipe:sidecar");
	const analysis = analyzeVecCoreRecipeSvgApproximation(recipe);
	const activePaths = [
		...analysis.approximatedPaths,
		...analysis.unsupportedPaths,
	];
	if (activePaths.length === 0) return null;
	recordAppearance(state, "unsupported", "recipe:pdf-renderer");
	const particleTexture =
		recipe.texture.material.mode === "particle" ||
		recipe.texture.material.mode === "mixed";
	const issue: PdfExportIssue = {
		severity: "warning",
		category: "unsupported",
		code: particleTexture
			? "vec-core-recipe-pdf-local-raster-required"
			: VEC_CORE_RECIPE_PDF_UNSUPPORTED_ISSUE_CODE,
		message: particleTexture
			? `Vec-core recipe "${recipe.label}" uses Particle Dissolve / Noise Gradient (${vecCoreRecipePathSummary(activePaths)}) and requires a local-raster PDF export tier for visual fidelity; the basic vector PDF keeps the deterministic flat-vector fallback and preserves the canonical high-fidelity payload beside the SVG as .recipe.json.`
			: `Vec-core recipe "${recipe.label}" cannot be rendered by the basic PDF writer yet (${vecCoreRecipePathSummary(activePaths)}); the canonical high-fidelity payload is preserved beside the SVG as .recipe.json.`,
		fallback: particleTexture ? "local-raster-required" : "normalized-value",
		...context,
	};
	addIssue(state, issue);
	return issue;
};

/**
 * Warns that GPU raster-finish frame effects (Path Blur, Lens, Flow,
 * Kaleidoscope, Noise Source, Deep Glow) are NOT rendered in PDF. Unlike SVG —
 * which compiles native/approx nodes into a `<filter>` — the basic PDF writer
 * has no frame-look pipeline at all, so these `deferred`-tier nodes would
 * otherwise be silently dropped. They render only in the editor canvas and WebM
 * video. Detection reuses the compiled Look plan's per-node fidelity so the
 * deferred kind list is never hardcoded here.
 */
const frameLookDeferredEffectIssue = (
	state: PdfRenderState,
): PdfExportIssue | null => {
	const frameIntent = resolveFrameEffectIntent(
		state.scene,
		state.scene.artboard.id,
	);
	const graph = frameIntent.lookGraph;
	if (!graph) return null;
	const plan = compileLookGraph(graph, {
		owner: { scope: "artboard", artboardId: frameIntent.artboardId },
		bounds: {
			x: 0,
			y: 0,
			width: state.scene.artboard.width,
			height: state.scene.artboard.height,
		},
	});
	const deferredNodes = plan.nodes.filter(
		(node) => node.fidelity.status === "deferred",
	);
	if (deferredNodes.length === 0) return null;
	const deferredLabels = [
		...new Set(deferredNodes.map((node) => lookGraphNodeLabel(node.kind))),
	]
		.sort()
		.join(", ");
	const deferredNodeIds = deferredNodes
		.map((node) => node.nodeId)
		.sort()
		.join(", ");
	recordAppearance(state, "unsupported", "look-graph:pdf-deferred");
	const issue: PdfExportIssue = {
		severity: "warning",
		category: "unsupported",
		code: "frame-look-graph-deferred-unsupported",
		message: `Frame Look graph GPU effects (${deferredLabels}) are not rendered by the PDF writer and were dropped from this export; they render only in the editor canvas and WebM video. Affected nodes: ${deferredNodeIds}. The canonical graph is preserved beside the SVG as .recipe.json.`,
		fallback: "local-raster-required",
		artboardId: frameIntent.artboardId,
	};
	addIssue(state, issue);
	return issue;
};

const parseHexColor = (value: string): PdfColor | null => {
	const trimmed = value.trim().toLowerCase();
	const short = /^#([\da-f])([\da-f])([\da-f])$/u.exec(trimmed);
	if (short) {
		return {
			r: Number.parseInt(`${short[1]}${short[1]}`, 16) / 255,
			g: Number.parseInt(`${short[2]}${short[2]}`, 16) / 255,
			b: Number.parseInt(`${short[3]}${short[3]}`, 16) / 255,
		};
	}

	const long = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/u.exec(trimmed);
	if (!long) return null;
	return {
		r: Number.parseInt(long[1], 16) / 255,
		g: Number.parseInt(long[2], 16) / 255,
		b: Number.parseInt(long[3], 16) / 255,
	};
};

const colorOrFallback = (
	value: string,
	fallback: string,
	state: PdfRenderState,
	context: IssueContext,
	role: string,
): PdfColor | null => {
	const normalized = value.trim().toLowerCase();
	if (normalized === "none" || normalized === "transparent") return null;
	const parsed = parseHexColor(value);
	if (parsed) return parsed;

	addIssue(state, {
		severity: "warning",
		category: "unsupported",
		code: "unsupported-color",
		message: `${role} color "${value}" is not supported by the basic PDF writer.`,
		fallback: "default-color",
		...context,
	});
	return parseHexColor(fallback);
};

const addStylePaintIssue = (
	state: PdfRenderState,
	context: IssueContext,
	role: ExportPaintRole,
	issue: Pick<
		PdfExportIssue,
		"category" | "code" | "fallback" | "message" | "severity"
	>,
): PdfExportIssue => {
	const resolvedIssue: PdfExportIssue = {
		...issue,
		...context,
		message: `${role} ${issue.message}`,
	};
	addIssue(state, resolvedIssue);
	return resolvedIssue;
};

const addStylePaintOpacityIssue = (
	state: PdfRenderState,
	context: IssueContext,
	role: ExportPaintRole,
	opacity: number,
): PdfExportIssue | null => {
	if (opacity === 1) return null;
	recordAppearance(state, "unsupported", `${role}:paint-opacity`);
	return addStylePaintIssue(state, context, role, {
		severity: "warning",
		category: "unsupported",
		code: "style-paint-opacity-unsupported",
		message: `paint opacity ${formatNumber(opacity)} cannot be emitted by the basic PDF writer yet; paint was exported at full opacity.`,
		fallback: "normalized-value",
	});
};

const gradientFallbackColor = (
	paint: Extract<
		ResolvedPaint,
		{ readonly kind: "linear-gradient" | "radial-gradient" }
	>,
	style: ResolvedNodeStyle,
	role: ExportPaintRole,
): string =>
	paint.stops[0]?.color ??
	fallbackColorForRole(style, role, PDF_STYLE_FALLBACK_COLOR);

const colorForPaintRole = (
	style: ResolvedNodeStyle,
	role: ExportPaintRole,
	state: PdfRenderState,
	context: IssueContext,
): {
	readonly color: PdfColor | null;
	readonly issues: readonly PdfExportIssue[];
} => {
	const paints = paintListForRole(style, role);
	if (paints.length === 0) return { color: null, issues: [] };

	const [paint] = paints;
	if (!paint) return { color: null, issues: [] };
	const issues: PdfExportIssue[] = [];
	if (paints.length > 1) {
		recordAppearance(state, "approximated", `${role}:paint-stack`);
		issues.push(
			addStylePaintIssue(state, context, role, {
				severity: "warning",
				category: "approximated",
				code: "style-paint-approximated",
				message: `paint list (${paintListSummary(paints)}) cannot be represented as multiple PDF paints on one vector element; only ${paintKindSummary(paint)} was used for fallback color.`,
				fallback: "normalized-value",
			}),
		);
	}
	const opacityIssue = addStylePaintOpacityIssue(
		state,
		context,
		role,
		paint.opacity,
	);
	if (opacityIssue) issues.push(opacityIssue);

	switch (paint.kind) {
		case "solid":
			return {
				color: colorOrFallback(
					paint.color,
					PDF_STYLE_FALLBACK_COLOR,
					state,
					context,
					role,
				),
				issues,
			};
		case "linear-gradient":
		case "radial-gradient": {
			recordAppearance(state, "approximated", `${role}:${paint.kind}`);
			const fallback = gradientFallbackColor(paint, style, role);
			issues.push(
				addStylePaintIssue(state, context, role, {
					severity: "warning",
					category: "approximated",
					code: "style-paint-approximated",
					message: `paint ${paintKindSummary(paint)} cannot be emitted by the basic PDF writer yet; exported with first-stop fallback color ${fallback}.`,
					fallback: "default-color",
				}),
			);
			return {
				color: colorOrFallback(
					fallback,
					PDF_STYLE_FALLBACK_COLOR,
					state,
					context,
					role,
				),
				issues,
			};
		}
		case "image-reference": {
			recordAppearance(state, "unsupported", `${role}:image-reference`);
			const fallback = fallbackColorForRole(
				style,
				role,
				PDF_STYLE_FALLBACK_COLOR,
			);
			issues.push(
				addStylePaintIssue(state, context, role, {
					severity: "warning",
					category: "unsupported",
					code: "style-paint-unsupported",
					message: `paint ${paintKindSummary(paint)} cannot be emitted by the basic PDF writer yet; exported with deterministic fallback color ${fallback}.`,
					fallback: "default-color",
				}),
			);
			return {
				color: colorOrFallback(
					fallback,
					PDF_STYLE_FALLBACK_COLOR,
					state,
					context,
					role,
				),
				issues,
			};
		}
		case "mesh-gradient": {
			// First-point color approximation until native ShadingType 6 (Coons)
			// lands; mirrors the gradient first-stop fallback above.
			recordAppearance(state, "approximated", `${role}:mesh-gradient`);
			const fallback = fallbackColorForRole(
				style,
				role,
				PDF_STYLE_FALLBACK_COLOR,
			);
			issues.push(
				addStylePaintIssue(state, context, role, {
					severity: "warning",
					category: "approximated",
					code: "style-paint-approximated",
					message: `paint ${paintKindSummary(paint)} cannot be emitted by the basic PDF writer yet; exported with first-point fallback color ${fallback}.`,
					fallback: "default-color",
				}),
			);
			return {
				color: colorOrFallback(
					fallback,
					PDF_STYLE_FALLBACK_COLOR,
					state,
					context,
					role,
				),
				issues,
			};
		}
	}
};

const rgbCommand = (color: PdfColor, operator: "RG" | "rg"): string =>
	`${formatNumber(color.r)} ${formatNumber(color.g)} ${formatNumber(color.b)} ${operator}`;

const pdfStrokeCap = (cap: PdfPaint["strokeCap"]): number => {
	switch (cap) {
		case "butt":
			return 0;
		case "round":
			return 1;
		case "square":
			return 2;
	}
};

const pdfStrokeJoin = (join: PdfPaint["strokeJoin"]): number => {
	switch (join) {
		case "miter":
			return 0;
		case "round":
			return 1;
		case "bevel":
			return 2;
	}
};

/**
 * PDF dash phase must be non-negative (ISO 32000-1 §8.4.3.6) while SVG allows
 * negative stroke-dashoffset, so negative offsets wrap into the equivalent
 * phase within one visual dash period. Odd-length arrays repeat on/off twice
 * per period, matching SVG's odd-array duplication semantics.
 */
const pdfDashPhase = (offset: number, dash: readonly number[]): number => {
	if (offset >= 0) return offset;
	const patternLength = dash.reduce((total, value) => total + value, 0);
	const period = dash.length % 2 === 0 ? patternLength : patternLength * 2;
	if (period <= 0) return 0;
	return ((offset % period) + period) % period;
};

const strokeStyleCommands = (paint: PdfPaint): readonly string[] => [
	`${pdfStrokeCap(paint.strokeCap)} J`,
	`${pdfStrokeJoin(paint.strokeJoin)} j`,
	...(paint.strokeJoin === "miter"
		? [`${formatNumber(paint.strokeMiterLimit)} M`]
		: []),
	...(paint.strokeDash.length
		? [
				`[${paint.strokeDash.map(formatNumber).join(" ")}] ${formatNumber(
					pdfDashPhase(paint.strokeDashoffset, paint.strokeDash),
				)} d`,
			]
		: []),
];

const normalizeOpacity = (
	value: number,
	state: PdfRenderState,
	context: IssueContext,
): number => {
	if (!Number.isFinite(value)) {
		addIssue(state, {
			severity: "warning",
			category: "normalized",
			code: "unsupported-opacity",
			message: "Opacity is not finite and was normalized to 1.",
			fallback: "normalized-value",
			...context,
		});
		return 1;
	}

	const clamped = clamp01(value);
	if (clamped !== value) {
		addIssue(state, {
			severity: "warning",
			category: "normalized",
			code: "unsupported-opacity",
			message: `Opacity ${formatNumber(value)} is outside 0..1 and was clamped.`,
			fallback: "normalized-value",
			...context,
		});
	}
	return clamped;
};

const opacityResourceName = (
	opacity: number,
	state: PdfRenderState,
): string | null => {
	if (opacity >= 1) return null;
	const key = formatNumber(opacity);
	const current = state.opacityResources.get(key);
	if (current) return current;

	const name = `GS${state.nextOpacityIndex}`;
	state.nextOpacityIndex += 1;
	state.opacityResources.set(key, name);
	return name;
};

const paintForNode = (
	style: ResolvedNodeStyle,
	state: PdfRenderState,
	context: IssueContext,
): PdfPaintResolution => {
	const fill = colorForPaintRole(style, "fill", state, context);
	const stroke =
		style.strokeWidth > 0
			? colorForPaintRole(style, "stroke", state, context)
			: { color: null, issues: [] };
	if (style.strokeWidth > 0 && stroke.color) {
		if (style.strokeDash.length > 0) {
			recordAppearance(state, "preserved", "stroke:dash");
		}
		if (style.strokeCap !== "butt") {
			recordAppearance(state, "preserved", "stroke:cap");
		}
		if (style.strokeJoin !== "miter") {
			recordAppearance(state, "preserved", "stroke:join");
		}
		if (style.strokeJoin === "miter" && style.strokeMiterLimit !== 4) {
			recordAppearance(state, "preserved", "stroke:miter-limit");
		}
	}
	return {
		paint: {
			fill: fill.color,
			stroke: stroke.color,
			strokeWidth: style.strokeWidth,
			strokeDash: style.strokeDash,
			strokeDashoffset: style.strokeDashoffset,
			strokeCap: style.strokeCap,
			strokeJoin: style.strokeJoin,
			strokeMiterLimit: style.strokeMiterLimit,
		},
		issues: [...fill.issues, ...stroke.issues],
	};
};

const matrixToPdf = (matrix: Matrix2D): string =>
	[matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]
		.map(formatNumber)
		.join(" ");

const safeBounds = (bounds: Bounds): Bounds => ({
	x: Number.isFinite(bounds.x) ? bounds.x : 0,
	y: Number.isFinite(bounds.y) ? bounds.y : 0,
	width: Number.isFinite(bounds.width) && bounds.width > 0 ? bounds.width : 24,
	height:
		Number.isFinite(bounds.height) && bounds.height > 0 ? bounds.height : 24,
});

const rectPath = (bounds: Bounds, cornerRadius = 0): readonly string[] => {
	const { x, y, width, height } = safeBounds(bounds);
	const radius = Math.min(
		Math.max(0, cornerRadius),
		Math.max(0, width / 2),
		Math.max(0, height / 2),
	);
	if (radius === 0) {
		return [
			`${formatNumber(x)} ${formatNumber(y)} ${formatNumber(width)} ${formatNumber(height)} re`,
		];
	}

	const k = radius * ELLIPSE_KAPPA;
	const right = x + width;
	const bottom = y + height;
	return [
		`${formatNumber(x + radius)} ${formatNumber(y)} m`,
		`${formatNumber(right - radius)} ${formatNumber(y)} l`,
		`${formatNumber(right - radius + k)} ${formatNumber(y)} ${formatNumber(right)} ${formatNumber(y + radius - k)} ${formatNumber(right)} ${formatNumber(y + radius)} c`,
		`${formatNumber(right)} ${formatNumber(bottom - radius)} l`,
		`${formatNumber(right)} ${formatNumber(bottom - radius + k)} ${formatNumber(right - radius + k)} ${formatNumber(bottom)} ${formatNumber(right - radius)} ${formatNumber(bottom)} c`,
		`${formatNumber(x + radius)} ${formatNumber(bottom)} l`,
		`${formatNumber(x + radius - k)} ${formatNumber(bottom)} ${formatNumber(x)} ${formatNumber(bottom - radius + k)} ${formatNumber(x)} ${formatNumber(bottom - radius)} c`,
		`${formatNumber(x)} ${formatNumber(y + radius)} l`,
		`${formatNumber(x)} ${formatNumber(y + radius - k)} ${formatNumber(x + radius - k)} ${formatNumber(y)} ${formatNumber(x + radius)} ${formatNumber(y)} c`,
		"h",
	];
};

const ellipsePath = (bounds: Bounds): readonly string[] => {
	const { x, y, width, height } = safeBounds(bounds);
	const cx = x + width / 2;
	const cy = y + height / 2;
	const rx = width / 2;
	const ry = height / 2;
	const ox = rx * ELLIPSE_KAPPA;
	const oy = ry * ELLIPSE_KAPPA;
	return [
		`${formatNumber(cx + rx)} ${formatNumber(cy)} m`,
		`${formatNumber(cx + rx)} ${formatNumber(cy + oy)} ${formatNumber(cx + ox)} ${formatNumber(cy + ry)} ${formatNumber(cx)} ${formatNumber(cy + ry)} c`,
		`${formatNumber(cx - ox)} ${formatNumber(cy + ry)} ${formatNumber(cx - rx)} ${formatNumber(cy + oy)} ${formatNumber(cx - rx)} ${formatNumber(cy)} c`,
		`${formatNumber(cx - rx)} ${formatNumber(cy - oy)} ${formatNumber(cx - ox)} ${formatNumber(cy - ry)} ${formatNumber(cx)} ${formatNumber(cy - ry)} c`,
		`${formatNumber(cx + ox)} ${formatNumber(cy - ry)} ${formatNumber(cx + rx)} ${formatNumber(cy - oy)} ${formatNumber(cx + rx)} ${formatNumber(cy)} c`,
		"h",
	];
};

const polygonPath = (points: readonly Vec2[]): readonly string[] => {
	if (points.length === 0) return [];
	const [first, ...rest] = points;
	return [
		`${formatNumber(first.x)} ${formatNumber(first.y)} m`,
		...rest.map(
			(point) => `${formatNumber(point.x)} ${formatNumber(point.y)} l`,
		),
		"h",
	];
};

const starPoints = (
	geometry: Extract<NodeGeometry, { readonly kind: "star" }>,
): readonly Vec2[] => {
	const points: Vec2[] = [];
	const total = geometry.points * 2;
	for (let index = 0; index < total; index += 1) {
		const radius =
			index % 2 === 0 ? geometry.outerRadius : geometry.innerRadius;
		const angle = -Math.PI / 2 + (index / total) * Math.PI * 2;
		points.push({
			x: geometry.center.x + Math.cos(angle) * radius,
			y: geometry.center.y + Math.sin(angle) * radius,
		});
	}
	return points;
};

const shapeToPdfCommands = (shape: BezierShape): readonly string[] | null => {
	const { vertices, inTangents, outTangents } = shape;
	if (
		vertices.length === 0 ||
		inTangents.length !== vertices.length ||
		outTangents.length !== vertices.length
	) {
		return null;
	}

	const commands = [
		`${formatNumber(vertices[0][0])} ${formatNumber(vertices[0][1])} m`,
	];
	const segmentCount = shape.closed ? vertices.length : vertices.length - 1;
	for (let index = 0; index < segmentCount; index += 1) {
		const nextIndex = (index + 1) % vertices.length;
		const point = vertices[index];
		const nextPoint = vertices[nextIndex];
		const out = outTangents[index];
		const input = inTangents[nextIndex];
		commands.push(
			`${formatNumber(point[0] + out[0])} ${formatNumber(point[1] + out[1])} ${formatNumber(nextPoint[0] + input[0])} ${formatNumber(nextPoint[1] + input[1])} ${formatNumber(nextPoint[0])} ${formatNumber(nextPoint[1])} c`,
		);
	}
	if (shape.closed) commands.push("h");
	return commands;
};

const bezierPath = (
	node: VectorNode,
	state: PdfRenderState,
): readonly string[] | null => {
	if (node.geometry.kind !== "path") return null;
	const sampledShape =
		effectiveShape(node, state.motion, state.frame) ?? node.geometry.shape;
	const outer = shapeToPdfCommands(sampledShape);
	if (!outer) return null;
	// Append hole subpaths so a compound path emits one fillable figure; the path
	// case selects the even-odd fill operator to actually cut the holes.
	const holes = (node.geometry.subpaths ?? [])
		.map(shapeToPdfCommands)
		.filter((commands): commands is readonly string[] => commands !== null);
	return [...outer, ...holes.flat()];
};

const paintPath = (
	pathCommands: readonly string[],
	paint: PdfPaint,
	options?: {
		readonly fill?: boolean;
		readonly stroke?: boolean;
		readonly evenOdd?: boolean;
	},
): readonly string[] => {
	const shouldFill = options?.fill ?? true;
	const shouldStroke = options?.stroke ?? true;
	const evenOdd = options?.evenOdd ?? false;
	const fill = shouldFill ? paint.fill : null;
	const stroke = shouldStroke && paint.strokeWidth > 0 ? paint.stroke : null;
	if (!fill && !stroke) return [];

	const commands: string[] = [];
	if (fill) commands.push(rgbCommand(fill, "rg"));
	if (stroke) {
		commands.push(rgbCommand(stroke, "RG"));
		commands.push(`${formatNumber(paint.strokeWidth)} w`);
		commands.push(...strokeStyleCommands(paint));
	}
	commands.push(...pathCommands);
	const fillStrokeOp = evenOdd ? "B*" : "B";
	const fillOp = evenOdd ? "f*" : "f";
	commands.push(fill && stroke ? fillStrokeOp : fill ? fillOp : "S");
	return commands;
};

const placeholderIssueComment = (issue: PdfExportIssue): string =>
	`% issue ${issue.code} category=${issue.category} node=${issue.nodeId ?? "none"} fallback=${issue.fallback}`;

const placeholderBox = (
	bounds: Bounds,
	issue: PdfExportIssue,
): readonly string[] => {
	const normalized = safeBounds(bounds);
	const fill = parseHexColor(FALLBACK_FILL);
	const stroke = parseHexColor(FALLBACK_STROKE);
	if (!fill || !stroke) return [placeholderIssueComment(issue)];

	return [
		placeholderIssueComment(issue),
		...paintPath(rectPath(normalized), {
			fill,
			stroke,
			strokeWidth: 1,
			strokeDash: [],
			strokeDashoffset: 0,
			strokeCap: "butt",
			strokeJoin: "miter",
			strokeMiterLimit: 4,
		}),
		rgbCommand(stroke, "RG"),
		"1 w",
		`${formatNumber(normalized.x)} ${formatNumber(normalized.y)} m`,
		`${formatNumber(normalized.x + normalized.width)} ${formatNumber(normalized.y + normalized.height)} l`,
		"S",
		`${formatNumber(normalized.x + normalized.width)} ${formatNumber(normalized.y)} m`,
		`${formatNumber(normalized.x)} ${formatNumber(normalized.y + normalized.height)} l`,
		"S",
	];
};

const fallbackPlaceholder = (
	bounds: Bounds,
	state: PdfRenderState,
	context: IssueContext,
	message: string,
): readonly string[] => {
	const issue: PdfExportIssue = {
		severity: "warning",
		category: "unsupported",
		code: "unsupported-geometry",
		message,
		fallback: "vector-placeholder",
		...context,
	};
	addIssue(state, issue);
	return placeholderBox(bounds, issue);
};

const invalidPrimitivePlaceholder = (
	bounds: Bounds,
	state: PdfRenderState,
	context: IssueContext,
	message: string,
): readonly string[] => {
	const issue: PdfExportIssue = {
		severity: "warning",
		category: "invalid",
		code: "invalid-primitive",
		message,
		fallback: "vector-placeholder",
		...context,
	};
	addIssue(state, issue);
	return placeholderBox(bounds, issue);
};

const textFallbackIssue = (
	state: PdfRenderState,
	context: IssueContext,
	metrics: TextMetrics,
): PdfExportIssue => {
	const fallbackFields = textStyleFieldSummary(
		metrics.styleResolution.fallbackFields,
	);
	const normalizedFields = textStyleFieldSummary(
		metrics.styleResolution.normalizedFields,
	);
	const issue: PdfExportIssue = {
		severity: "warning",
		category: "fallback",
		code: "text-font-fallback",
		message: [
			`Text was emitted with PDF base font ${PDF_TEXT_FONT} instead of the scene font family and deterministic estimated baseline metrics because scene fonts are not embedded by the basic PDF writer.`,
			fallbackFields ? `Style fallbacks: ${fallbackFields}.` : null,
			normalizedFields ? `Style normalizations: ${normalizedFields}.` : null,
		]
			.filter((part): part is string => part !== null)
			.join(" "),
		fallback: "font-substitution",
		...context,
	};
	addIssue(state, issue);
	return issue;
};

/**
 * Reports italic/underline as unsupported in the dependency-free PDF writer.
 * Canvas and SVG export render these flags, but the basic writer emits a single
 * upright Helvetica with no decoration path, so styled text is degraded to plain
 * upright/un-decorated text. Fires only when a flag is actually set so default
 * text stays issue-free, mirroring the conditional image/style fallbacks. The
 * text itself is still drawn — only the slant/rule is dropped.
 */
const textTypographyIssue = (
	state: PdfRenderState,
	context: IssueContext,
	metrics: TextMetrics,
): void => {
	const dropped = [
		metrics.style.italic ? "italic" : null,
		metrics.style.underline ? "underline" : null,
	].filter((flag): flag is string => flag !== null);
	if (dropped.length === 0) return;
	addIssue(state, {
		severity: "warning",
		category: "unsupported",
		code: "text-typography-unsupported",
		message: `Text ${dropped.join(" and ")} ${dropped.length > 1 ? "are" : "is"} not represented by the basic PDF writer and the text was emitted as plain upright, un-decorated ${PDF_TEXT_FONT}.`,
		fallback: "normalized-value",
		...context,
	});
};

const textStyleFieldSummary = (
	fields: readonly string[],
): string | undefined => (fields.length > 0 ? fields.join(",") : undefined);

const textMetricsModel = (metrics: TextMetrics): string =>
	`${metrics.fontMetrics.kind}:${metrics.fontMetrics.lineModel}:${metrics.fontMetrics.widthModel}`;

const textMetricsComment = (metrics: TextMetrics): string =>
	[
		"% text metrics",
		`model=${textMetricsModel(metrics)}`,
		`sceneFont=${asciiComment(metrics.style.fontFamily)}`,
		`sceneWeight=${formatNumber(metrics.style.fontWeight)}`,
		`pdfFont=${PDF_TEXT_FONT}`,
		`lineHeight=${formatNumber(metrics.style.lineHeight)}`,
		`baselineOffset=${formatNumber(metrics.fontMetrics.baselineOffset)}`,
		`fallbacks=${textStyleFieldSummary(metrics.styleResolution.fallbackFields) ?? "none"}`,
		`normalized=${textStyleFieldSummary(metrics.styleResolution.normalizedFields) ?? "none"}`,
	].join(" ");

const programSurfacePdfIssueCode = (
	code: ProgramSurfaceDeliveryIssueCode | undefined,
): PdfExportIssueCode => {
	switch (code) {
		case "program-surface-asset-missing":
		case "program-surface-declared-fallback-invalid":
		case "program-surface-declared-fallback-required":
		case "program-surface-manifest-invalid":
		case "program-surface-pdf-raster-fallback-unavailable":
		case "program-surface-static-output-unsupported":
			return code;
		default:
			return "program-surface-static-output-unsupported";
	}
};

const programSurfacePdfIssue = (
	delivery: ProgramSurfaceDeliveryDecision,
): PdfExportIssue => ({
	severity: delivery.issue?.severity ?? "warning",
	category: delivery.issue?.category ?? "unsupported",
	code: programSurfacePdfIssueCode(delivery.issue?.code),
	message:
		delivery.issue?.message ??
		`Program Surface "${delivery.assetId}" has no available PDF delivery route.`,
	fallback: "vector-placeholder",
	assetId: delivery.assetId,
});

const renderImageGeometry = (
	node: VectorNode & {
		readonly geometry: Extract<NodeGeometry, { readonly kind: "image" }>;
	},
	state: PdfRenderState,
	context: IssueContext,
): readonly string[] => {
	const programSurfaceDelivery = resolveProgramSurfaceDeliveryForGeometry({
		document: state.scene,
		geometry: node.geometry,
		target: "pdf",
	});
	if (programSurfaceDelivery) {
		const issue = programSurfacePdfIssue(programSurfaceDelivery);
		addIssue(state, { ...issue, ...context });
		return placeholderBox(node.geometry.bounds, { ...issue, ...context });
	}

	const resolution = resolveImageAssetReference(state.scene, node.geometry);
	const issue: PdfExportIssue =
		resolution.status === "missing"
			? {
					severity: "warning",
					category: "unsupported",
					code: "image-asset-missing",
					message: `Image node references missing asset "${node.geometry.assetId}" and was exported as a visible placeholder.`,
					fallback: "vector-placeholder",
					assetId: node.geometry.assetId,
					...context,
				}
			: resolution.status === "invalid-source"
				? {
						severity: "warning",
						category: "invalid",
						code: "image-asset-invalid-source",
						message: `Image asset "${resolution.asset.id}" has no usable image source and was exported as a vector placeholder.`,
						fallback: "vector-placeholder",
						assetId: resolution.asset.id,
						...context,
					}
				: resolution.status === "unsupported-asset"
					? {
							severity: "warning",
							category: "unsupported",
							code:
								resolution.reason === "video-frame-required"
									? "video-asset-frame-required"
									: "external-asset-preview-required",
							message:
								resolution.reason === "video-frame-required"
									? `Video asset "${resolution.asset.id}" needs browser frame extraction before PDF export and was exported as a vector placeholder.`
									: `External asset "${resolution.asset.id}" has no usable preview image; PDF export used a vector placeholder instead of executing or rendering the source asset.`,
							fallback: "vector-placeholder",
							assetId: resolution.asset.id,
							...context,
						}
					: resolution.status === "external-preview"
						? {
								severity: "warning",
								category: "fallback",
								code: "external-asset-preview-fallback",
								message: `External asset "${resolution.asset.id}" was exported as a vector placeholder by the dependency-free PDF writer; preview/source metadata remains in the Vecmo document.`,
								fallback: "vector-placeholder",
								assetId: resolution.asset.id,
								...context,
							}
						: {
								severity: "warning",
								category: "unsupported",
								code: "image-asset-pdf-fallback",
								message: `Image asset "${resolution.asset.id}" cannot be embedded by the dependency-free PDF writer and was exported as a vector placeholder.`,
								fallback: "vector-placeholder",
								assetId: resolution.asset.id,
								...context,
							};
	addIssue(state, issue);
	return placeholderBox(node.geometry.bounds, issue);
};

const renderTextGeometry = (
	geometry: Extract<NodeGeometry, { readonly kind: "text" }>,
	paint: PdfPaint,
	state: PdfRenderState,
	context: IssueContext,
): readonly string[] => {
	const fill = paint.fill;
	const stroke = paint.strokeWidth > 0 ? paint.stroke : null;
	if (!fill && !stroke) return [];

	const renderingMode = fill && stroke ? 2 : fill ? 0 : 1;
	const { bounds } = geometry;
	const metrics = textMetricsForGeometry(geometry);
	const issue = textFallbackIssue(state, context, metrics);
	textTypographyIssue(state, context, metrics);
	const paintCommands = [
		...(fill ? [rgbCommand(fill, "rg")] : []),
		...(stroke
			? [rgbCommand(stroke, "RG"), `${formatNumber(paint.strokeWidth)} w`]
			: []),
	];

	return [
		placeholderIssueComment(issue),
		textMetricsComment(metrics),
		...paintCommands,
		...metrics.lines.flatMap((line, index) => {
			const lineMetric = metrics.lineMetrics[index];
			const x = textLineLeftForAlign(
				bounds,
				metrics.style.align,
				metrics.lineWidths[index] ?? 0,
			);
			return [
				"BT",
				`/${PDF_TEXT_FONT_RESOURCE} ${formatNumber(metrics.style.fontSize)} Tf`,
				`${renderingMode} Tr`,
				`1 0 0 -1 ${formatNumber(x)} ${formatNumber(lineMetric?.baseline ?? bounds.y + index * metrics.style.lineHeight + metrics.fontMetrics.baselineOffset)} Tm`,
				`${pdfString(line)} Tj`,
				"ET",
			];
		}),
	];
};

const renderGeometry = (
	node: VectorNode,
	state: PdfRenderState,
	context: IssueContext,
	style: ResolvedNodeStyle,
): readonly string[] => {
	const paintResolution = paintForNode(style, state, context);
	const paint = paintResolution.paint;
	const paintIssueComments = paintResolution.issues.map(
		placeholderIssueComment,
	);
	switch (node.geometry.kind) {
		case "rect": {
			// Sample corner radii at the frame (consistent with inline transform/shape
			// sampling); static export resolves to the base geometry.
			const sampledRadii = effectiveCornerRadii(
				node,
				state.motion,
				state.frame,
			);
			const rect = sampledRadii
				? { ...node.geometry, cornerRadii: sampledRadii }
				: node.geometry;
			// Per-corner / squircle rects bake to an all-cubic path. PDF has no arc
			// operator, so squircle falls back to a circular bake (buildRoundedRectShape
			// is circular); per-corner is exact.
			if (rectNeedsBakedPath(rect)) {
				const commands = shapeToPdfCommands(
					buildRoundedRectShape(rect.bounds, {
						radii: resolveCornerRadii(rect),
						smoothing: 0,
					}),
				);
				if (commands) {
					return [...paintIssueComments, ...paintPath(commands, paint)];
				}
			}
			return [
				...paintIssueComments,
				...paintPath(
					rectPath(
						rect.bounds,
						sampledRadii ? sampledRadii.tl : rect.cornerRadius,
					),
					paint,
				),
			];
		}
		case "ellipse":
			return [
				...paintIssueComments,
				...paintPath(ellipsePath(node.geometry.bounds), paint),
			];
		case "line":
			return [
				...paintIssueComments,
				...paintPath(
					[
						`${formatNumber(node.geometry.start.x)} ${formatNumber(node.geometry.start.y)} m`,
						`${formatNumber(node.geometry.end.x)} ${formatNumber(node.geometry.end.y)} l`,
					],
					paint,
					{ fill: false, stroke: true },
				),
			];
		case "polygon": {
			if (node.geometry.points.length < 3) {
				return invalidPrimitivePlaceholder(
					getGeometryBounds(node.geometry),
					state,
					context,
					"Polygon needs at least three points and was replaced with a placeholder.",
				);
			}
			const polygonRadius =
				effectiveCornerRadius(node, state.motion, state.frame) ??
				node.geometry.cornerRadius ??
				0;
			if (polygonRadius > 0) {
				const commands = shapeToPdfCommands(
					filletPolygonShape(node.geometry.points, polygonRadius),
				);
				if (commands) {
					return [...paintIssueComments, ...paintPath(commands, paint)];
				}
			}
			return [
				...paintIssueComments,
				...paintPath(polygonPath(node.geometry.points), paint),
			];
		}
		case "star": {
			if (
				node.geometry.points < 2 ||
				node.geometry.innerRadius <= 0 ||
				node.geometry.outerRadius <= 0
			) {
				return invalidPrimitivePlaceholder(
					getGeometryBounds(node.geometry),
					state,
					context,
					"Star geometry is invalid and was replaced with a placeholder.",
				);
			}
			const starRadius =
				effectiveCornerRadius(node, state.motion, state.frame) ??
				node.geometry.cornerRadius ??
				0;
			if (starRadius > 0) {
				const commands = shapeToPdfCommands(
					filletPolygonShape(starVertices(node.geometry), starRadius),
				);
				if (commands) {
					return [...paintIssueComments, ...paintPath(commands, paint)];
				}
			}
			return [
				...paintIssueComments,
				...paintPath(polygonPath(starPoints(node.geometry)), paint),
			];
		}
		case "path": {
			const commands = bezierPath(node, state);
			if (!commands) {
				const issue: PdfExportIssue = {
					severity: "warning",
					category: "invalid",
					code: "invalid-path",
					message:
						"Path could not be emitted and was replaced with a placeholder.",
					fallback: "vector-placeholder",
					...context,
				};
				addIssue(state, issue);
				return placeholderBox({ x: 0, y: 0, width: 24, height: 24 }, issue);
			}
			return [
				...paintIssueComments,
				...paintPath(commands, paint, {
					evenOdd: node.geometry.fillRule === "evenodd",
				}),
			];
		}
		case "text":
			return [
				...paintIssueComments,
				...renderTextGeometry(node.geometry, paint, state, context),
			];
		case "image":
			return renderImageGeometry(
				node as VectorNode & {
					readonly geometry: Extract<NodeGeometry, { readonly kind: "image" }>;
				},
				state,
				context,
			);
		default: {
			const geometry = node.geometry as { readonly kind?: string };
			return fallbackPlaceholder(
				{ x: 0, y: 0, width: 24, height: 24 },
				state,
				context,
				`Geometry kind "${geometry.kind ?? "unknown"}" is not supported by the basic PDF writer.`,
			);
		}
	}
};

const renderNode = (
	node: VectorNode,
	state: PdfRenderState,
	context: IssueContext,
): readonly string[] => {
	if (!node.visible) return [];

	const nodeContext = { ...context, nodeId: node.id };
	const style = resolveExportNodeStyle(node);
	const opacity = normalizeOpacity(
		effectiveOpacity(node, state.motion, state.frame),
		state,
		nodeContext,
	);
	const opacityName = opacityResourceName(opacity, state);
	const transform = matrixFromTransform(
		effectiveTransform(node, state.motion, state.frame),
	);
	const paintIssues = importPaintIssues(node, state, nodeContext);
	const compoundIssue = importCompoundPathIssue(node, state, nodeContext);
	const opacityGroupIssue = importOpacityGroupIssue(node, state, nodeContext);
	const clipMaskIssue = importClipMaskIssue(node, state, nodeContext);
	const effectIssue = importEffectIssue(node, state, nodeContext);
	const styleEffect = styleEffectIssue(style, state, nodeContext);
	const styleBlend = styleBlendModeIssue(style, state, nodeContext);
	const styleStrokeAlign = styleStrokeAlignIssue(style, state, nodeContext);
	const recipeIssue = vecCoreRecipePdfIssue(node, state, nodeContext);
	const commands = [
		"q",
		`${matrixToPdf(transform)} cm`,
		...(opacityName ? [`/${opacityName} gs`] : []),
		...paintIssues.map(placeholderIssueComment),
		...(compoundIssue ? [placeholderIssueComment(compoundIssue)] : []),
		...(opacityGroupIssue ? [placeholderIssueComment(opacityGroupIssue)] : []),
		...(clipMaskIssue ? [placeholderIssueComment(clipMaskIssue)] : []),
		...(effectIssue ? [placeholderIssueComment(effectIssue)] : []),
		...(styleEffect ? [placeholderIssueComment(styleEffect)] : []),
		...(styleBlend ? [placeholderIssueComment(styleBlend)] : []),
		...(styleStrokeAlign ? [placeholderIssueComment(styleStrokeAlign)] : []),
		...(recipeIssue ? [placeholderIssueComment(recipeIssue)] : []),
		...(node.motionController
			? []
			: renderGeometry(node, state, nodeContext, style)),
		...(node.children ?? []).flatMap((child) =>
			renderNode(child, state, nodeContext),
		),
		"Q",
	];
	return commands;
};

const renderLayer = (
	layer: SceneLayer,
	state: PdfRenderState,
): readonly string[] => {
	if (!layer.visible) return [];
	return layer.nodes.flatMap((node) =>
		renderNode(node, state, { layerId: layer.id }),
	);
};

const normalizePageSize = (
	scene: SceneDocument,
	state: PdfRenderState,
): PdfPageSize => {
	const width =
		Number.isFinite(scene.artboard.width) && scene.artboard.width > 0
			? scene.artboard.width
			: 1;
	const height =
		Number.isFinite(scene.artboard.height) && scene.artboard.height > 0
			? scene.artboard.height
			: 1;
	if (width !== scene.artboard.width || height !== scene.artboard.height) {
		addIssue(state, {
			severity: "error",
			category: "invalid",
			code: "invalid-artboard",
			message: "Artboard dimensions must be positive finite numbers.",
			fallback: "normalized-value",
		});
	}
	return { width, height };
};

const renderPdfBody = (
	scene: SceneDocument,
	state: PdfRenderState,
	pageSize: PdfPageSize,
): readonly string[] => {
	const background = colorOrFallback(
		scene.artboard.background,
		"#ffffff",
		state,
		{},
		"artboard background",
	);
	return [
		"q",
		`1 0 0 -1 0 ${formatNumber(pageSize.height)} cm`,
		...(background ? [rgbCommand(background, "rg")] : []),
		`0 0 ${formatNumber(pageSize.width)} ${formatNumber(pageSize.height)} re`,
		background ? "f" : "n",
		...scene.layers.flatMap((layer) => renderLayer(layer, state)),
		"Q",
	];
};

const asciiComment = (value: string): string =>
	value.replace(/[^\u0020-\u007e]/gu, "?");

const metadataComments = (metadataJson: string): readonly string[] => [
	"% vector-motion-author PDF metadata",
	...metadataJson
		.trimEnd()
		.split("\n")
		.map((line) => `% ${asciiComment(line)}`),
];

const escapeXml = (value: string): string =>
	Array.from(value, (character) => {
		const code = character.codePointAt(0) ?? 0;
		if (character === "&") return "&amp;";
		if (character === "<") return "&lt;";
		if (character === ">") return "&gt;";
		if (character === '"') return "&quot;";
		if (character === "'") return "&apos;";
		if (code < 0x20 && character !== "\n" && character !== "\t") return " ";
		if (code > 0x7e) return `&#x${code.toString(16).toUpperCase()};`;
		return character;
	}).join("");

const metadataXml = (metadataJson: string): string =>
	[
		'<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>',
		'<x:xmpmeta xmlns:x="adobe:ns:meta/">',
		'<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
		'<rdf:Description xmlns:vma="https://vector-motion-author.local/export/pdf">',
		`<vma:metadata>${escapeXml(metadataJson.trimEnd())}</vma:metadata>`,
		"</rdf:Description>",
		"</rdf:RDF>",
		"</x:xmpmeta>",
		'<?xpacket end="w"?>',
		"",
	].join("\n");

const hexByte = (value: number): string =>
	value.toString(16).toUpperCase().padStart(2, "0");

const pdfString = (value: string): string => {
	if (/^[\u0020-\u007e]*$/u.test(value)) {
		const escaped = value
			.replaceAll("\\", "\\\\")
			.replaceAll("(", "\\(")
			.replaceAll(")", "\\)");
		return `(${escaped})`;
	}

	const bytes = [0xfe, 0xff];
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		bytes.push((code >> 8) & 0xff, code & 0xff);
	}
	return `<${bytes.map(hexByte).join("")}>`;
};

const streamObject = (stream: string, extraDictionary = ""): string => {
	const dictionary = extraDictionary ? `${extraDictionary} ` : "";
	return `<< ${dictionary}/Length ${stream.length} >>\nstream\n${stream}endstream`;
};

const createPdfMetadata = (
	scene: SceneDocument,
	motion: MotionDocument,
	frame: number,
	pageSize: PdfPageSize,
	issues: readonly PdfExportIssue[],
): PdfMetadata => ({
	artboard: {
		background: scene.artboard.background,
		height: pageSize.height,
		width: pageSize.width,
	},
	durationFrames: motion.durationFrames,
	exportFormat: PDF_EXPORT_FORMAT,
	fps: motion.fps,
	frame,
	issueCount: issues.length,
	issues,
	motionSchemaVersion: motion.schemaVersion,
	sceneSchemaVersion: scene.schemaVersion,
});

const xrefOffset = (offset: number): string =>
	`${String(offset).padStart(10, "0")} 00000 n `;

const buildPdf = (objects: readonly string[], infoObjectId: number): string => {
	let output = "%PDF-1.4\n% vector-motion-author\n";
	const offsets: number[] = [];
	for (const [index, object] of objects.entries()) {
		offsets.push(output.length);
		output += `${index + 1} 0 obj\n${object}\nendobj\n`;
	}

	const startxref = output.length;
	output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	output += `${offsets.map(xrefOffset).join("\n")}\n`;
	output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoObjectId} 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
	return output;
};

const buildPdfDocument = ({
	scene,
	motion,
	frame,
	metadataJson,
	content,
	pageSize,
	opacityResources,
}: {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly frame: number;
	readonly metadataJson: string;
	readonly content: string;
	readonly pageSize: PdfPageSize;
	readonly opacityResources: ReadonlyMap<string, string>;
}): string => {
	const extEntries = [...opacityResources.entries()].map(([opacity, name]) => ({
		name,
		opacity: Number(opacity),
	}));
	const metadataObjectId = 5;
	const infoObjectId = 6;
	const fontObjectId = 7;
	const extStateStartObjectId = 8;
	const contentObjectId = extStateStartObjectId + extEntries.length;
	const extStateResources = extEntries
		.map(
			(entry, index) => `/${entry.name} ${extStateStartObjectId + index} 0 R`,
		)
		.join(" ");
	const resources = [
		"<< /ProcSet [/PDF /Text]",
		`/Font << /${PDF_TEXT_FONT_RESOURCE} ${fontObjectId} 0 R >>`,
		...(extEntries.length ? [`/ExtGState << ${extStateResources} >>`] : []),
		">>",
	].join(" ");

	const objects = [
		`<< /Type /Catalog /Pages 2 0 R /Metadata ${metadataObjectId} 0 R >>`,
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		[
			"<< /Type /Page /Parent 2 0 R",
			`/MediaBox [0 0 ${formatNumber(pageSize.width)} ${formatNumber(pageSize.height)}]`,
			"/Resources 4 0 R",
			`/Contents ${contentObjectId} 0 R >>`,
		].join("\n"),
		resources,
		streamObject(metadataXml(metadataJson), "/Type /Metadata /Subtype /XML"),
		[
			"<<",
			`/Producer ${pdfString(PDF_PRODUCER)}`,
			`/Creator ${pdfString(PDF_EXPORT_FORMAT)}`,
			`/Title ${pdfString(scene.name)}`,
			`/Subject ${pdfString(`frame=${formatNumber(frame)} scene=${scene.schemaVersion} motion=${motion.schemaVersion}`)}`,
			`/Keywords ${pdfString(`issues=${metadataJson.includes('"issueCount": 0') ? 0 : "present"}`)}`,
			">>",
		].join("\n"),
		`<< /Type /Font /Subtype /Type1 /BaseFont /${PDF_TEXT_FONT} /Encoding /WinAnsiEncoding >>`,
		...extEntries.map(
			(entry) =>
				`<< /Type /ExtGState /ca ${formatNumber(entry.opacity)} /CA ${formatNumber(entry.opacity)} >>`,
		),
		streamObject(content),
	];

	return buildPdf(objects, infoObjectId);
};

/**
 * Renders a one-page, artboard-sized PDF from the scene sampled against the
 * side-car motion document. The writer is dependency-free and ASCII-only so it
 * can run in the browser or a future Worker path without Node adapters.
 */
export function renderScenePdf({
	scene,
	motion,
	frame,
	grammarBindings,
	renderPresentation,
}: PdfExportInput): PdfRenderResult {
	const presentation =
		renderPresentation ??
		buildExportRenderPresentation({
			scene,
			motion,
			frame,
			grammarBindings,
		});
	const renderScene = presentation.scene;
	const renderMotion = presentation.renderMotion;
	const sampledFrame = presentation.frame;
	const state = createState(renderScene, renderMotion, sampledFrame);
	const pageSize = normalizePageSize(renderScene, state);
	const body = renderPdfBody(renderScene, state, pageSize);
	if (
		presentation.sourceOptics.sourcePlans.length > 0 ||
		presentation.sourceOptics.targetPlans.length > 0
	) {
		recordAppearance(state, "unsupported", "source-optics");
		addIssue(state, {
			severity: "warning",
			category: "unsupported",
			code: "style-effect-unsupported",
			message:
				"Source Optics filter pixels cannot be emitted by the basic vector PDF writer; the canonical source and target vectors were exported without optical consequences.",
			fallback: "normalized-value",
			artboardId: renderScene.artboard.id,
		});
	}
	// Frame-level GPU look effects (Path Blur, Lens, …) have no PDF pipeline; warn
	// once for the artboard so they are not silently dropped from the export.
	frameLookDeferredEffectIssue(state);
	const metadataJson = stableJsonStringify(
		createPdfMetadata(
			renderScene,
			presentation.sourceMotion,
			sampledFrame,
			pageSize,
			state.issues,
		),
	);
	const content = [...metadataComments(metadataJson), ...body, ""].join("\n");

	return {
		contents: buildPdfDocument({
			scene: renderScene,
			motion: presentation.sourceMotion,
			frame: sampledFrame,
			metadataJson,
			content,
			pageSize,
			opacityResources: state.opacityResources,
		}),
		appearance: finalizeExportAppearanceFidelity(state.appearance),
		issues: state.issues,
	};
}

/**
 * Creates the deterministic PDF export asset for the sampled artboard frame.
 * Unsupported visible geometry is represented by a placeholder and reported in
 * `issues`, preserving reviewable fidelity instead of silently dropping nodes.
 */
export function createPdfExport({
	scene,
	motion,
	frame,
	fileNameStem,
	grammarBindings,
	renderPresentation,
}: PdfExportInput): PdfExportAsset {
	const presentation =
		renderPresentation ??
		buildExportRenderPresentation({
			scene,
			motion,
			frame,
			grammarBindings,
		});
	const sampledFrame = presentation.frame;
	const result = renderScenePdf({
		scene,
		motion,
		frame: sampledFrame,
		renderPresentation: presentation,
	});
	return {
		kind: "pdf",
		fileName: `${fileNameStem ?? fileStemForScene(scene)}.frame-${Math.round(sampledFrame)}.pdf`,
		mimeType: PDF_MIME_TYPE,
		contents: result.contents,
		appearance: result.appearance,
		issues: result.issues,
	};
}
