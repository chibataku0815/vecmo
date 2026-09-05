import { hitTestScene } from "@/entities/scene/model/hit-testing";
import {
	findArtboardById,
	selectCurrentArtboard,
	selectNodeArtboardMapping,
} from "@/entities/scene/model/selectors";
import {
	getSceneSpatialIndex,
	type SceneSpatialEntry,
	sceneHitTestCandidates,
} from "@/entities/scene/model/spatial";
import {
	type ResolvedNodeStyle,
	type ResolvedPaint,
	resolveNodeStyle,
} from "@/entities/scene/model/style-resolve";
import type {
	SceneDocument,
	SceneLayer,
	Vec2,
	VectorNode,
} from "@/entities/scene/model/types";

export type ColorPickPaintRole = "fill" | "stroke";

export type ColorPickArtboardScope =
	| "current"
	| "all"
	| {
			readonly kind: "artboard";
			readonly artboardId: string;
	  };

export type ColorPickCandidateSource =
	| "legacy-color"
	| "solid-paint"
	| "gradient-stop-fallback"
	| "legacy-fallback";

export type ColorPickIssueCode =
	| "color-pick.no-hit"
	| "color-pick.no-color-candidate"
	| "color-pick.artboard-missing"
	| "color-pick.paint-stack-approximated"
	| "color-pick.gradient-approximated"
	| "color-pick.image-paint-unsupported"
	| "color-pick.mesh-paint-unsupported"
	| "color-pick.image-node-unsupported"
	| "color-pick.effects-ignored"
	| "color-pick.blend-not-composited"
	| "color-pick.opacity-not-composited";

export type ColorPickIssue = {
	readonly code: ColorPickIssueCode;
	readonly severity: "info" | "warning";
	readonly message: string;
	readonly nodeId?: string;
	readonly layerId?: string;
	readonly artboardId?: string;
	readonly role?: ColorPickPaintRole;
	readonly paintKind?: ResolvedPaint["kind"];
	readonly fallback?: ColorPickCandidateSource | "none";
};

export type ColorPickHit = {
	readonly nodeId: string;
	readonly layerId: string;
	readonly artboardId: string;
	readonly point: Vec2;
	readonly localPoint: Vec2;
	readonly locked: boolean;
};

export type ColorPickCandidate = {
	readonly nodeId: string;
	readonly layerId: string;
	readonly artboardId: string;
	readonly role: ColorPickPaintRole;
	readonly color: string;
	readonly source: ColorPickCandidateSource;
	readonly paintKind: ResolvedPaint["kind"] | "legacy";
	readonly nodeOpacity: number;
	readonly paintOpacity: number;
	readonly stopOpacity?: number;
	readonly effectiveOpacity: number;
	readonly issues: readonly ColorPickIssue[];
};

export type ColorPickNodeCandidateResult = {
	readonly candidates: readonly ColorPickCandidate[];
	readonly issues: readonly ColorPickIssue[];
};

export type ColorPickResult =
	| {
			readonly kind: "picked";
			readonly hit: ColorPickHit;
			readonly candidate: ColorPickCandidate;
			readonly candidates: readonly ColorPickCandidate[];
			readonly issues: readonly ColorPickIssue[];
	  }
	| {
			readonly kind: "empty";
			readonly reason: "no-hit" | "no-color-candidate" | "artboard-missing";
			readonly hit?: ColorPickHit;
			readonly issues: readonly ColorPickIssue[];
	  };

export type ColorPickOptions = {
	/**
	 * Artboard-local geometry tolerance. The default is exact vector picking,
	 * unlike selection hit testing which adds a click-friendly halo.
	 */
	readonly tolerance?: number;
	/**
	 * Eyedropper is a visual sampler, so locked visible artwork is included by
	 * default. Set this to false for selection-like protection semantics.
	 */
	readonly includeLocked?: boolean;
	readonly artboardScope?: ColorPickArtboardScope;
	readonly preferredRole?: ColorPickPaintRole;
};

type ResolvedArtboardScope =
	| {
			readonly kind: "all";
	  }
	| {
			readonly kind: "artboard";
			readonly artboardId: string;
	  }
	| {
			readonly kind: "missing";
			readonly artboardId: string;
	  };

type ColorPickIssueContext = {
	readonly nodeId?: string;
	readonly layerId?: string;
	readonly artboardId?: string;
	readonly role?: ColorPickPaintRole;
	readonly paintKind?: ResolvedPaint["kind"];
	readonly fallback?: ColorPickCandidateSource | "none";
};

const DEFAULT_COLOR_PICK_TOLERANCE = 0;

const issue = (
	code: ColorPickIssueCode,
	severity: ColorPickIssue["severity"],
	message: string,
	context: ColorPickIssueContext = {},
): ColorPickIssue => ({
	code,
	severity,
	message,
	...(context.nodeId ? { nodeId: context.nodeId } : {}),
	...(context.layerId ? { layerId: context.layerId } : {}),
	...(context.artboardId ? { artboardId: context.artboardId } : {}),
	...(context.role ? { role: context.role } : {}),
	...(context.paintKind ? { paintKind: context.paintKind } : {}),
	...(context.fallback ? { fallback: context.fallback } : {}),
});

const isVisibleColor = (value: string): boolean => {
	const normalized = value.trim().toLowerCase();
	return (
		normalized.length > 0 &&
		normalized !== "none" &&
		normalized !== "transparent"
	);
};

const clampUnit = (value: number): number =>
	Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1));

const paintStackForRole = (
	style: ResolvedNodeStyle,
	role: ColorPickPaintRole,
): readonly ResolvedPaint[] => (role === "fill" ? style.fills : style.strokes);

const legacyColorForRole = (
	style: ResolvedNodeStyle,
	role: ColorPickPaintRole,
): string => (role === "fill" ? style.fill : style.stroke);

const isRoleRenderable = (
	style: ResolvedNodeStyle,
	role: ColorPickPaintRole,
): boolean => role === "fill" || style.strokeWidth > 0;

const orderedRoles = (
	preferredRole: ColorPickPaintRole | undefined,
): readonly ColorPickPaintRole[] =>
	preferredRole === "stroke" ? ["stroke", "fill"] : ["fill", "stroke"];

const roleUsesLegacyPaintList = (
	node: VectorNode,
	role: ColorPickPaintRole,
): boolean => (role === "fill" ? !node.style.fills : !node.style.strokes);

const canUseLegacyFallback = (
	node: VectorNode,
	role: ColorPickPaintRole,
	paints: readonly ResolvedPaint[],
): boolean =>
	!roleUsesLegacyPaintList(node, role) &&
	paints.some((paint) => paint.kind !== "solid");

const commonAppearanceIssues = (
	node: VectorNode,
	style: ResolvedNodeStyle,
	context: Omit<ColorPickIssueContext, "role" | "paintKind" | "fallback">,
): readonly ColorPickIssue[] => {
	const issues: ColorPickIssue[] = [];
	if (node.geometry.kind === "image") {
		issues.push(
			issue(
				"color-pick.image-node-unsupported",
				"warning",
				"Raster image pixels are not sampled by the scene color picker yet.",
				{ ...context, fallback: "none" },
			),
		);
	}
	const visibleEffects = style.effects.filter((effect) => effect.visible);
	if (visibleEffects.length > 0) {
		issues.push(
			issue(
				"color-pick.effects-ignored",
				"info",
				"Visible effects are ignored; the candidate reports the node paint color.",
				context,
			),
		);
	}
	if (style.blendMode !== "normal") {
		issues.push(
			issue(
				"color-pick.blend-not-composited",
				"info",
				"Blend mode compositing is not sampled; the candidate reports the source paint color.",
				context,
			),
		);
	}
	return issues;
};

const opacityIssue = (
	effectiveOpacity: number,
	context: ColorPickIssueContext,
): ColorPickIssue | undefined =>
	effectiveOpacity < 1
		? issue(
				"color-pick.opacity-not-composited",
				"info",
				"Opacity is reported as metadata; the candidate color is not composited against artwork underneath.",
				context,
			)
		: undefined;

const candidateFromColor = (
	color: string,
	input: {
		readonly nodeId: string;
		readonly layerId: string;
		readonly artboardId: string;
		readonly role: ColorPickPaintRole;
		readonly source: ColorPickCandidateSource;
		readonly paintKind: ResolvedPaint["kind"] | "legacy";
		readonly nodeOpacity: number;
		readonly paintOpacity: number;
		readonly stopOpacity?: number;
		readonly issues: readonly ColorPickIssue[];
	},
): ColorPickCandidate | undefined => {
	if (!isVisibleColor(color)) return undefined;
	const effectiveOpacity = clampUnit(input.nodeOpacity) * input.paintOpacity;
	const finalOpacity =
		input.stopOpacity === undefined
			? effectiveOpacity
			: effectiveOpacity * input.stopOpacity;
	if (finalOpacity <= 0) return undefined;
	const opacity = opacityIssue(finalOpacity, {
		nodeId: input.nodeId,
		layerId: input.layerId,
		artboardId: input.artboardId,
		role: input.role,
		paintKind: input.paintKind === "legacy" ? undefined : input.paintKind,
		fallback: input.source,
	});
	return {
		nodeId: input.nodeId,
		layerId: input.layerId,
		artboardId: input.artboardId,
		role: input.role,
		color,
		source: input.source,
		paintKind: input.paintKind,
		nodeOpacity: clampUnit(input.nodeOpacity),
		paintOpacity: input.paintOpacity,
		...(input.stopOpacity === undefined
			? {}
			: { stopOpacity: input.stopOpacity }),
		effectiveOpacity: finalOpacity,
		issues: opacity ? [...input.issues, opacity] : input.issues,
	};
};

const candidateFromLegacyFallback = (
	style: ResolvedNodeStyle,
	input: {
		readonly nodeId: string;
		readonly layerId: string;
		readonly artboardId: string;
		readonly role: ColorPickPaintRole;
		readonly issues: readonly ColorPickIssue[];
	},
): ColorPickCandidate | undefined =>
	candidateFromColor(legacyColorForRole(style, input.role), {
		...input,
		source: "legacy-fallback",
		paintKind: "legacy",
		nodeOpacity: style.opacity,
		paintOpacity: 1,
	});

const gradientStopCandidate = (
	paint: Extract<ResolvedPaint, { readonly kind: "linear-gradient" }>,
	input: {
		readonly nodeId: string;
		readonly layerId: string;
		readonly artboardId: string;
		readonly role: ColorPickPaintRole;
		readonly nodeOpacity: number;
		readonly roleIssues: readonly ColorPickIssue[];
	},
): ColorPickCandidate | undefined => {
	const stop = paint.stops.find(
		(entry) => isVisibleColor(entry.color) && entry.opacity > 0,
	);
	if (!stop) return undefined;
	const approximation = issue(
		"color-pick.gradient-approximated",
		"warning",
		"Gradient pixels are not sampled yet; the candidate uses the first visible gradient stop.",
		{
			nodeId: input.nodeId,
			layerId: input.layerId,
			artboardId: input.artboardId,
			role: input.role,
			paintKind: paint.kind,
			fallback: "gradient-stop-fallback",
		},
	);
	return candidateFromColor(stop.color, {
		nodeId: input.nodeId,
		layerId: input.layerId,
		artboardId: input.artboardId,
		role: input.role,
		source: "gradient-stop-fallback",
		paintKind: paint.kind,
		nodeOpacity: input.nodeOpacity,
		paintOpacity: paint.opacity,
		stopOpacity: stop.opacity,
		issues: [...input.roleIssues, approximation],
	});
};

const radialGradientStopCandidate = (
	paint: Extract<ResolvedPaint, { readonly kind: "radial-gradient" }>,
	input: {
		readonly nodeId: string;
		readonly layerId: string;
		readonly artboardId: string;
		readonly role: ColorPickPaintRole;
		readonly nodeOpacity: number;
		readonly roleIssues: readonly ColorPickIssue[];
	},
): ColorPickCandidate | undefined => {
	const stop = paint.stops.find(
		(entry) => isVisibleColor(entry.color) && entry.opacity > 0,
	);
	if (!stop) return undefined;
	const approximation = issue(
		"color-pick.gradient-approximated",
		"warning",
		"Gradient pixels are not sampled yet; the candidate uses the first visible gradient stop.",
		{
			nodeId: input.nodeId,
			layerId: input.layerId,
			artboardId: input.artboardId,
			role: input.role,
			paintKind: paint.kind,
			fallback: "gradient-stop-fallback",
		},
	);
	return candidateFromColor(stop.color, {
		nodeId: input.nodeId,
		layerId: input.layerId,
		artboardId: input.artboardId,
		role: input.role,
		source: "gradient-stop-fallback",
		paintKind: paint.kind,
		nodeOpacity: input.nodeOpacity,
		paintOpacity: paint.opacity,
		stopOpacity: stop.opacity,
		issues: [...input.roleIssues, approximation],
	});
};

const candidatesForRole = (
	node: VectorNode,
	style: ResolvedNodeStyle,
	role: ColorPickPaintRole,
	baseIssues: readonly ColorPickIssue[],
	context: {
		readonly nodeId: string;
		readonly layerId: string;
		readonly artboardId: string;
	},
): ColorPickNodeCandidateResult => {
	if (!isRoleRenderable(style, role)) {
		return { candidates: [], issues: [] };
	}

	const paints = paintStackForRole(style, role);
	const roleContext = { ...context, role };
	const roleIssues: ColorPickIssue[] = [...baseIssues];
	if (paints.length > 1) {
		roleIssues.push(
			issue(
				"color-pick.paint-stack-approximated",
				"info",
				"Multiple paints are resolved to the first usable color candidate.",
				roleContext,
			),
		);
	}

	const candidates: ColorPickCandidate[] = [];
	for (const paint of paints) {
		switch (paint.kind) {
			case "solid": {
				const candidate = candidateFromColor(paint.color, {
					...roleContext,
					source: roleUsesLegacyPaintList(node, role)
						? "legacy-color"
						: "solid-paint",
					paintKind: paint.kind,
					nodeOpacity: style.opacity,
					paintOpacity: paint.opacity,
					issues: roleIssues,
				});
				if (candidate) candidates.push(candidate);
				break;
			}
			case "linear-gradient": {
				const candidate = gradientStopCandidate(paint, {
					...roleContext,
					nodeOpacity: style.opacity,
					roleIssues,
				});
				if (candidate) candidates.push(candidate);
				break;
			}
			case "radial-gradient": {
				const candidate = radialGradientStopCandidate(paint, {
					...roleContext,
					nodeOpacity: style.opacity,
					roleIssues,
				});
				if (candidate) candidates.push(candidate);
				break;
			}
			case "image-reference":
				roleIssues.push(
					issue(
						"color-pick.image-paint-unsupported",
						"warning",
						"Image paints are not raster-sampled by the scene color picker yet.",
						{
							...roleContext,
							paintKind: paint.kind,
							fallback: "legacy-fallback",
						},
					),
				);
				break;
			case "mesh-gradient":
				roleIssues.push(
					issue(
						"color-pick.mesh-paint-unsupported",
						"warning",
						"Mesh gradient paints are not sampled by the scene color picker yet.",
						{
							...roleContext,
							paintKind: paint.kind,
							fallback: "legacy-fallback",
						},
					),
				);
				break;
		}
	}

	if (candidates.length > 0) {
		return { candidates, issues: roleIssues };
	}

	const fallback = canUseLegacyFallback(node, role, paints)
		? candidateFromLegacyFallback(style, {
				...roleContext,
				issues: roleIssues,
			})
		: undefined;
	return {
		candidates: fallback ? [fallback] : [],
		issues: roleIssues,
	};
};

/**
 * Resolves the fill/stroke color candidates for one already-hit scene node.
 * The returned colors are source scene-data literals; gradients, images,
 * effects, blend modes, and opacity are reported as typed approximation issues
 * instead of coupling this feature to renderer pixels.
 */
export function colorCandidatesForNode(
	node: VectorNode,
	context: {
		readonly layerId: string;
		readonly artboardId: string;
		readonly preferredRole?: ColorPickPaintRole;
	},
): ColorPickNodeCandidateResult {
	const style = resolveNodeStyle(node.style);
	const baseContext = {
		nodeId: node.id,
		layerId: context.layerId,
		artboardId: context.artboardId,
	};
	const baseIssues = commonAppearanceIssues(node, style, baseContext);
	const candidateResults = orderedRoles(context.preferredRole).map((role) =>
		candidatesForRole(node, style, role, baseIssues, baseContext),
	);
	return {
		candidates: candidateResults.flatMap((result) => result.candidates),
		issues: candidateResults.flatMap((result) => result.issues),
	};
}

const resolveArtboardScope = (
	document: SceneDocument,
	scope: ColorPickArtboardScope | undefined,
): ResolvedArtboardScope => {
	if (scope === "all") return { kind: "all" };
	if (!scope || scope === "current") {
		return { kind: "artboard", artboardId: selectCurrentArtboard(document).id };
	}
	return findArtboardById(document, scope.artboardId)
		? { kind: "artboard", artboardId: scope.artboardId }
		: { kind: "missing", artboardId: scope.artboardId };
};

const matchesArtboardScope = (
	artboardId: string,
	scope: ResolvedArtboardScope,
): boolean => scope.kind === "all" || artboardId === scope.artboardId;

const oneNodeHitDocument = (
	document: SceneDocument,
	layer: SceneLayer,
	node: VectorNode,
): SceneDocument => ({
	...document,
	layers: [
		{
			...layer,
			visible: true,
			nodes: [node],
		},
	],
});

const exactHitForEntry = (
	document: SceneDocument,
	entry: SceneSpatialEntry,
	point: Vec2,
	tolerance: number,
): ColorPickHit | undefined => {
	const precise = hitTestScene(
		oneNodeHitDocument(document, entry.layer, entry.node),
		point,
		{ tolerance, includeLocked: true },
	);
	if (!precise) return undefined;
	return {
		nodeId: entry.nodeId,
		layerId: entry.layerId,
		artboardId: "",
		point: precise.point,
		localPoint: precise.localPoint,
		locked: entry.locked,
	};
};

const noColorCandidateIssue = (hit: ColorPickHit): ColorPickIssue =>
	issue(
		"color-pick.no-color-candidate",
		"warning",
		"The topmost hit node has no usable solid color candidate.",
		{
			nodeId: hit.nodeId,
			layerId: hit.layerId,
			artboardId: hit.artboardId,
			fallback: "none",
		},
	);

const blocksUnderlyingColor = (issues: readonly ColorPickIssue[]): boolean =>
	issues.some(
		(entry) =>
			entry.code === "color-pick.image-node-unsupported" ||
			entry.code === "color-pick.image-paint-unsupported",
	);

/**
 * Picks the topmost visible scene color candidate at an artboard-local canvas
 * point. Hidden nodes/layers never participate; locked artwork participates by
 * default because eyedropper is a visual sampling feature rather than selection.
 */
export function pickSceneColorCandidate(
	document: SceneDocument,
	point: Vec2,
	options: ColorPickOptions = {},
): ColorPickResult {
	const scope = resolveArtboardScope(document, options.artboardScope);
	if (scope.kind === "missing") {
		return {
			kind: "empty",
			reason: "artboard-missing",
			issues: [
				issue(
					"color-pick.artboard-missing",
					"warning",
					`Artboard "${scope.artboardId}" does not exist in this scene snapshot.`,
					{ artboardId: scope.artboardId, fallback: "none" },
				),
			],
		};
	}

	const tolerance = Math.max(
		0,
		Number.isFinite(options.tolerance ?? DEFAULT_COLOR_PICK_TOLERANCE)
			? (options.tolerance ?? DEFAULT_COLOR_PICK_TOLERANCE)
			: DEFAULT_COLOR_PICK_TOLERANCE,
	);
	const includeLocked = options.includeLocked ?? true;
	const currentArtboardId = selectCurrentArtboard(document).id;
	const nodeArtboards = selectNodeArtboardMapping(document).byNodeId;
	const spatial = getSceneSpatialIndex(document, { tolerance });
	const candidates = sceneHitTestCandidates(spatial, point, { includeLocked });
	let firstColorlessHit:
		| {
				readonly hit: ColorPickHit;
				readonly issues: readonly ColorPickIssue[];
		  }
		| undefined;

	for (const entry of candidates) {
		const artboardId = nodeArtboards[entry.nodeId] ?? currentArtboardId;
		if (!matchesArtboardScope(artboardId, scope)) continue;
		const exactHit = exactHitForEntry(document, entry, point, tolerance);
		if (!exactHit) continue;
		const hit = { ...exactHit, artboardId };
		const nodeResult = colorCandidatesForNode(entry.node, {
			layerId: entry.layerId,
			artboardId,
			preferredRole: options.preferredRole,
		});
		const candidate = nodeResult.candidates[0];
		if (candidate) {
			return {
				kind: "picked",
				hit,
				candidate,
				candidates: nodeResult.candidates,
				issues: candidate.issues,
			};
		}
		const issues = [...nodeResult.issues, noColorCandidateIssue(hit)];
		if (blocksUnderlyingColor(issues)) {
			return {
				kind: "empty",
				reason: "no-color-candidate",
				hit,
				issues,
			};
		}
		firstColorlessHit ??= { hit, issues };
	}

	if (firstColorlessHit) {
		return {
			kind: "empty",
			reason: "no-color-candidate",
			hit: firstColorlessHit.hit,
			issues: firstColorlessHit.issues,
		};
	}

	return {
		kind: "empty",
		reason: "no-hit",
		issues: [
			issue(
				"color-pick.no-hit",
				"info",
				"No visible node was hit in the requested artboard scope.",
				{ fallback: "none" },
			),
		],
	};
}
