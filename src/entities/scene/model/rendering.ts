import { aeShapeToSvgPath } from "@/shared/glammer/ae-shape-svg-path";
import {
	hrefForExternalSceneAsset,
	hrefForImageAsset,
	hrefForVideoAsset,
	imagePlacementForNode,
	sceneAssetForGeometry,
} from "./assets";
import { hrefForAudioAsset } from "./audio";
import { normalizeTextGeometry } from "./text-geometry";
import type {
	BezierShape,
	Bounds,
	NodeGeometry,
	PathGeometry,
	SceneDocument,
	Transform,
	Vec2,
	VectorNode,
} from "./types";

export type {
	NormalizedTextGeometry,
	TextBoxResizeHandle,
	TextBoxResizeOptions,
	TextLayoutResult,
	TextMetrics,
} from "./text-geometry";
export {
	clampTextBoxBounds,
	DEFAULT_TEXT_STYLE,
	estimateTextLineWidth,
	normalizeTextContent,
	normalizeTextGeometry,
	normalizeTextResizeMode,
	normalizeTextStyle,
	resizedTextBoundsForGeometry,
	resizeTextBoxBoundsForHandle,
	resolveTextStyle,
	svgTextAnchorForAlign,
	TEXT_METRICS_FALLBACK,
	textAnchorXForAlign,
	textBoundsForContent,
	textFontMetricsForStyle,
	textLayoutForGeometry,
	textLineLeftForAlign,
	textLinesForGeometry,
	textMetricsForContent,
	textMetricsForGeometry,
} from "./text-geometry";

export type Matrix2D = {
	readonly a: number;
	readonly b: number;
	readonly c: number;
	readonly d: number;
	readonly e: number;
	readonly f: number;
};

export type InspectorTransformValues = {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly anchorX: number;
	readonly anchorY: number;
	readonly rotation: number;
	readonly opacity: number;
};

const identityMatrix: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

const roundTiny = (value: number): number =>
	Math.abs(value) < 1e-10 ? 0 : Number(value.toFixed(6));

const compactPathData = (pathData: string): string =>
	pathData.replace(/\b([MC])\s+/g, "$1").replace(/\s+Z$/, "Z");

const pointsBounds = (points: readonly Vec2[]): Bounds => {
	if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
	const xs = points.map((point) => point.x);
	const ys = points.map((point) => point.y);
	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

const shapeControlPoints = (shape: BezierShape): Vec2[] =>
	shape.vertices.flatMap(([x, y], index) => {
		const inTangent = shape.inTangents[index] ?? [0, 0];
		const outTangent = shape.outTangents[index] ?? [0, 0];
		return [
			{ x, y },
			{ x: x + inTangent[0], y: y + inTangent[1] },
			{ x: x + outTangent[0], y: y + outTangent[1] },
		];
	});

const pathGeometryBounds = (geometry: PathGeometry): Bounds =>
	unionBoundsList(
		[geometry.shape, ...(geometry.subpaths ?? [])].map((shape) =>
			pointsBounds(shapeControlPoints(shape)),
		),
	);

/**
 * Returns the geometry's local bounds before node transform application. Path
 * bounds include every compound contour and its control handles for editor
 * chrome; final path rendering still comes from the BezierShape.
 */
export function getGeometryBounds(geometry: NodeGeometry): Bounds {
	switch (geometry.kind) {
		case "rect":
		case "ellipse":
		case "text":
		case "image":
			return geometry.bounds;
		case "line":
			return pointsBounds([geometry.start, geometry.end]);
		case "polygon":
			return pointsBounds(geometry.points);
		case "star":
			return {
				x: geometry.center.x - geometry.outerRadius,
				y: geometry.center.y - geometry.outerRadius,
				width: geometry.outerRadius * 2,
				height: geometry.outerRadius * 2,
			};
		case "path":
			return pathGeometryBounds(geometry);
	}
}

/**
 * Axis-aligned bounding rect of `bounds` after `matrix` — projects all four
 * corners (not just the two opposite ones) so a rotated/sheared/
 * non-uniformly-scaled `matrix` still yields a correct, conservative AABB.
 * Exported (E1 S6) for `entities/scene/model/gpu/capability.ts`'s gate (d)
 * blend-overhang bounds check, which needs the SAME corner-projection this
 * module's own `getNodeParentBounds`/`getNodeParentPaintBounds` family
 * already uses — see that module's doc comment for why it reuses this
 * exact helper rather than a second bounds-transform implementation.
 */
export const boundsUnderMatrix = (bounds: Bounds, matrix: Matrix2D): Bounds =>
	pointsBounds(
		[
			{ x: bounds.x, y: bounds.y },
			{ x: bounds.x + bounds.width, y: bounds.y },
			{ x: bounds.x, y: bounds.y + bounds.height },
			{ x: bounds.x + bounds.width, y: bounds.y + bounds.height },
		].map((point) => applyMatrixToPoint(matrix, point)),
	);

const unionBoundsList = (boxes: readonly Bounds[]): Bounds => {
	if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const box of boxes) {
		minX = Math.min(minX, box.x);
		minY = Math.min(minY, box.y);
		maxX = Math.max(maxX, box.x + box.width);
		maxY = Math.max(maxY, box.y + box.height);
	}
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

/**
 * Axis-aligned local-space bounds of a node, expanded to enclose any group
 * members. A group container holds its members in `children` (each positioned by
 * its own transform within this node's local space) and uses a degenerate
 * own-geometry, so its true extent is the union of its transformed children
 * rather than `getGeometryBounds`. Leaf nodes fall back to geometry bounds.
 * Recurses for nested groups.
 */
export function getNodeLocalBounds(node: VectorNode): Bounds {
	const children = node.children;
	if (!children || children.length === 0) {
		return getGeometryBounds(node.geometry);
	}
	return unionBoundsList(
		children.map((child) =>
			boundsUnderMatrix(
				getNodeLocalBounds(child),
				matrixFromTransform(child.transform),
			),
		),
	);
}

/**
 * Axis-aligned local-space bounds of everything a node can paint: its own
 * geometry plus transformed descendants. Unlike {@link getNodeLocalBounds}, this
 * includes a container/frame's own visible geometry when it also has children.
 */
export function getNodeLocalPaintBounds(node: VectorNode): Bounds {
	const children = node.children ?? [];
	return unionBoundsList([
		getGeometryBounds(node.geometry),
		...children.map((child) =>
			boundsUnderMatrix(
				getNodeLocalPaintBounds(child),
				matrixFromTransform(child.transform),
			),
		),
	]);
}

/**
 * Axis-aligned bounds of a node after applying its own transform in the parent
 * coordinate space. Scoped graph overlays use this to size a filter around the
 * exact node run that becomes `SourceGraphic`.
 */
export function getNodeParentBounds(node: VectorNode): Bounds {
	return getNodeParentBoundsForTransform(node, node.transform);
}

/**
 * Axis-aligned bounds of a node under an explicit transform. Motion-sampled
 * exporters pass the sampled transform so scoped filters size around the frame's
 * actual source graphic, not the stored rest pose.
 */
export function getNodeParentBoundsForTransform(
	node: VectorNode,
	transform: Transform,
): Bounds {
	return boundsUnderMatrix(
		getNodeLocalBounds(node),
		matrixFromTransform(transform),
	);
}

/** Axis-aligned painted bounds of a node after applying its own transform. */
export function getNodeParentPaintBounds(node: VectorNode): Bounds {
	return getNodeParentPaintBoundsForTransform(node, node.transform);
}

/** Axis-aligned painted bounds of a node under an explicit transform. */
export function getNodeParentPaintBoundsForTransform(
	node: VectorNode,
	transform: Transform,
): Bounds {
	return boundsUnderMatrix(
		getNodeLocalPaintBounds(node),
		matrixFromTransform(transform),
	);
}

/** Returns one conservative AABB enclosing all supplied bounds. */
export function unionBounds(bounds: readonly Bounds[]): Bounds {
	return unionBoundsList(bounds);
}

/**
 * Matrix for the editor's TRS+anchor representation. It is emitted as an SVG
 * matrix to keep host rendering and future feature handlers on one transform
 * representation.
 */
export function matrixFromTransform(transform: Transform): Matrix2D {
	if (transform.presentationMatrix) {
		return {
			a: roundTiny(transform.presentationMatrix.a),
			b: roundTiny(transform.presentationMatrix.b),
			c: roundTiny(transform.presentationMatrix.c),
			d: roundTiny(transform.presentationMatrix.d),
			e: roundTiny(transform.presentationMatrix.e),
			f: roundTiny(transform.presentationMatrix.f),
		};
	}
	const radians = (transform.rotation * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const a = cos * transform.scale.x;
	const b = sin * transform.scale.x;
	const c = -sin * transform.scale.y;
	const d = cos * transform.scale.y;
	const e =
		transform.position.x +
		transform.anchor.x -
		a * transform.anchor.x -
		c * transform.anchor.y;
	const f =
		transform.position.y +
		transform.anchor.y -
		b * transform.anchor.x -
		d * transform.anchor.y;

	return {
		a: roundTiny(a),
		b: roundTiny(b),
		c: roundTiny(c),
		d: roundTiny(d),
		e: roundTiny(e),
		f: roundTiny(f),
	};
}

/**
 * Moves a node-local transform anchor without changing the rendered affine
 * matrix. This is the authoring behavior users expect from a pivot edit: the
 * artwork stays put while future rotation/scale use the new pivot.
 */
export function transformWithAnchorPreservingMatrix(
	transform: Transform,
	anchor: Vec2,
): Transform {
	const radians = (transform.rotation * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const a = cos * transform.scale.x;
	const b = sin * transform.scale.x;
	const c = -sin * transform.scale.y;
	const d = cos * transform.scale.y;
	const dx = anchor.x - transform.anchor.x;
	const dy = anchor.y - transform.anchor.y;
	return {
		...transform,
		position: {
			x: roundTiny(transform.position.x + a * dx + c * dy - dx),
			y: roundTiny(transform.position.y + b * dx + d * dy - dy),
		},
		anchor: {
			x: roundTiny(anchor.x),
			y: roundTiny(anchor.y),
		},
	};
}

/**
 * Composes two affine matrices so the result applies `inner` first and then
 * `outer` (`outer ∘ inner`), in the SVG convention `x' = a·x + c·y + e` that
 * {@link matrixFromTransform} emits. Lives here (entities) so feature code on
 * either side of the import boundary can compose parent/child transforms without
 * a feature-to-feature import.
 */
export function composeMatrix(outer: Matrix2D, inner: Matrix2D): Matrix2D {
	return {
		a: outer.a * inner.a + outer.c * inner.b,
		b: outer.b * inner.a + outer.d * inner.b,
		c: outer.a * inner.c + outer.c * inner.d,
		d: outer.b * inner.c + outer.d * inner.d,
		e: outer.a * inner.e + outer.c * inner.f + outer.e,
		f: outer.b * inner.e + outer.d * inner.f + outer.f,
	};
}

/** Whether a matrix is (within rounding) the identity transform. */
export function isIdentityMatrix(matrix: Matrix2D): boolean {
	return (
		matrix.a === 1 &&
		matrix.b === 0 &&
		matrix.c === 0 &&
		matrix.d === 1 &&
		matrix.e === 0 &&
		matrix.f === 0
	);
}

/**
 * Decomposes a non-skewed matrix back into the scene transform contract. The
 * writer uses this when UI tools submit matrix-based updates. `matrix.e/f` are
 * the rendered affine translation; the returned position is adjusted so the
 * supplied scene anchor still round-trips through `matrixFromTransform`.
 */
export function transformFromMatrix(matrix: Matrix2D, anchor: Vec2): Transform {
	const scaleX = Math.hypot(matrix.a, matrix.b) || 1;
	const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
	const scaleY = determinant / scaleX || 1;
	const rotation = (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
	const position = {
		x: matrix.e - anchor.x + matrix.a * anchor.x + matrix.c * anchor.y,
		y: matrix.f - anchor.y + matrix.b * anchor.x + matrix.d * anchor.y,
	};

	return {
		position: { x: roundTiny(position.x), y: roundTiny(position.y) },
		rotation: roundTiny(rotation),
		scale: { x: roundTiny(scaleX), y: roundTiny(scaleY) },
		anchor,
	};
}

/**
 * Builds a renderer-facing transform that preserves an exact affine matrix while
 * retaining a best-effort TRS decomposition for Inspector/read-model consumers.
 * This helper is for ephemeral presentation scenes only; serialization rejects
 * the override so authored SceneDocument state cannot acquire a hidden skew.
 */
export function transformWithPresentationMatrix(
	matrix: Matrix2D,
	anchor: Vec2,
): Transform {
	return {
		...transformFromMatrix(matrix, anchor),
		presentationMatrix: {
			a: roundTiny(matrix.a),
			b: roundTiny(matrix.b),
			c: roundTiny(matrix.c),
			d: roundTiny(matrix.d),
			e: roundTiny(matrix.e),
			f: roundTiny(matrix.f),
		},
	};
}

export function matrixToSvg(matrix: Matrix2D): string {
	return `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`;
}

/** Applies an affine matrix to a point (e.g. node-local → artboard-local). */
export function applyMatrixToPoint(matrix: Matrix2D, point: Vec2): Vec2 {
	return {
		x: matrix.a * point.x + matrix.c * point.y + matrix.e,
		y: matrix.b * point.x + matrix.d * point.y + matrix.f,
	};
}

/**
 * Inverts an affine matrix, or returns `null` when it is (near) singular. Mirrors
 * the private inverse used by hit-testing so callers outside that module can map
 * an artboard-local point back into a node's local space.
 */
export function invertMatrix(matrix: Matrix2D): Matrix2D | null {
	const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
	if (Math.abs(determinant) < 1e-10) return null;
	return {
		a: matrix.d / determinant,
		b: -matrix.b / determinant,
		c: -matrix.c / determinant,
		d: matrix.a / determinant,
		e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
		f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant,
	};
}

export function pathDataForGeometry(
	geometry: NodeGeometry,
): string | undefined {
	if (geometry.kind !== "path") return undefined;
	const contours = [geometry.shape, ...(geometry.subpaths ?? [])];
	return compactPathData(
		contours
			.map(aeShapeToSvgPath)
			.filter((data) => data.length > 0)
			.join(" "),
	);
}

/**
 * Bounds the Inspector treats as the node's own box. Group containers keep a
 * degenerate zero-size own-geometry (their extent lives in `children`), so they
 * report the children union; frames and leaves keep their real geometry box.
 * Because the box is non-zero for groups, Inspector W/H edits resolve to
 * transform scale for them, the same contract leaf nodes already use.
 */
export function inspectorBoundsForNode(node: VectorNode): Bounds {
	const bounds = getGeometryBounds(node.geometry);
	const degenerate = bounds.width === 0 && bounds.height === 0;
	if (degenerate && node.children && node.children.length > 0) {
		return getNodeLocalBounds(node);
	}
	return bounds;
}

export function inspectorValuesForNode(
	node: VectorNode,
): InspectorTransformValues {
	const bounds = inspectorBoundsForNode(node);
	return {
		x: roundTiny(bounds.x + node.transform.position.x),
		y: roundTiny(bounds.y + node.transform.position.y),
		width: roundTiny(bounds.width * node.transform.scale.x),
		height: roundTiny(bounds.height * node.transform.scale.y),
		anchorX: roundTiny(node.transform.anchor.x),
		anchorY: roundTiny(node.transform.anchor.y),
		rotation: roundTiny(node.transform.rotation),
		opacity: roundTiny(node.style.opacity),
	};
}

/**
 * Builds a matrix from Inspector values while keeping local geometry as source
 * data. Width and height are represented as transform scale, not geometry edits.
 */
export function matrixFromInspectorValues(
	node: VectorNode,
	values: Partial<InspectorTransformValues>,
): Matrix2D {
	const current = inspectorValuesForNode(node);
	const next = { ...current, ...values };
	const bounds = inspectorBoundsForNode(node);
	const scaleX =
		bounds.width === 0 ? node.transform.scale.x : next.width / bounds.width;
	const scaleY =
		bounds.height === 0 ? node.transform.scale.y : next.height / bounds.height;

	return matrixFromTransform({
		position: {
			x: next.x - bounds.x,
			y: next.y - bounds.y,
		},
		rotation: next.rotation,
		scale: {
			x: scaleX,
			y: scaleY,
		},
		anchor: {
			x: next.anchorX,
			y: next.anchorY,
		},
	});
}

/**
 * Stable byte signature for seed-rendering regression tests. It captures the
 * SVG-relevant attributes that existed before the scene model migration.
 */
export function sceneRenderSignature(document: SceneDocument): string {
	return document.layers
		.flatMap((layer) => layer.nodes)
		.map((node) => {
			const path = pathDataForGeometry(node.geometry);
			const style = [
				`fill=${node.style.fill}`,
				`stroke=${node.style.stroke}`,
				`strokeWidth=${node.style.strokeWidth}`,
				`opacity=${node.style.opacity}`,
				`transform=${matrixToSvg(matrixFromTransform(node.transform))}`,
			].join(";");
			if (node.geometry.kind === "path") {
				return `${node.id}|path|d=${path ?? ""}|${style}`;
			}
			if (node.geometry.kind === "rect") {
				const { bounds, cornerRadii, cornerSmoothing } = node.geometry;
				const radii = cornerRadii
					? `${cornerRadii.tl},${cornerRadii.tr},${cornerRadii.br},${cornerRadii.bl}`
					: "";
				return `${node.id}|rect|x=${bounds.x};y=${bounds.y};width=${bounds.width};height=${bounds.height};rx=${node.geometry.cornerRadius};radii=${radii};smooth=${cornerSmoothing ?? 0}|${style}`;
			}
			if (node.geometry.kind === "ellipse") {
				const { bounds } = node.geometry;
				return `${node.id}|ellipse|cx=${bounds.x + bounds.width / 2};cy=${bounds.y + bounds.height / 2};rx=${bounds.width / 2};ry=${bounds.height / 2}|${style}`;
			}
			if (node.geometry.kind === "text") {
				const { bounds } = node.geometry;
				const textGeometry = normalizeTextGeometry(node.geometry);
				const text = textGeometry.text.replaceAll("\n", "\\n");
				const textStyle = [
					`fontFamily=${textGeometry.style.fontFamily}`,
					`fontSize=${textGeometry.style.fontSize}`,
					`lineHeight=${textGeometry.style.lineHeight}`,
					`align=${textGeometry.style.align}`,
					`fontWeight=${textGeometry.style.fontWeight}`,
					`letterSpacing=${textGeometry.style.letterSpacing}`,
					`italic=${textGeometry.style.italic}`,
					`underline=${textGeometry.style.underline}`,
				].join(";");
				return `${node.id}|text|x=${bounds.x};y=${bounds.y};text=${text}|${textStyle}|fill=${node.style.fill};opacity=${node.style.opacity};transform=${matrixToSvg(matrixFromTransform(node.transform))}`;
			}
			if (node.geometry.kind === "image") {
				const { bounds } = node.geometry;
				const asset = sceneAssetForGeometry(document, node.geometry);
				const href = asset
					? asset.kind === "image"
						? (hrefForImageAsset(asset) ?? "empty")
						: asset.kind === "video"
							? (hrefForVideoAsset(asset) ?? "empty")
							: asset.kind === "program-surface"
								? `program:${asset.manifest.runtime.compiledDigest};snapshot=${asset.manifest.source.snapshotDigest};fallback=${asset.manifest.fallback?.assetId ?? "none"}`
								: asset.kind === "audio"
									? // Audio (S5a) has no node/geometry placement, so
										// `ImageGeometry.assetId` should never actually
										// resolve to one; this branch only keeps the
										// signature total rather than claiming reachability.
										(hrefForAudioAsset(asset) ?? "empty")
									: (hrefForExternalSceneAsset(asset) ?? "empty")
					: "missing";
				const sourceKind = asset
					? `${asset.kind}:${asset.source.kind}`
					: "missing";
				const crop = imagePlacementForNode(node)?.crop;
				const cropSignature = crop
					? `;crop=${crop.x},${crop.y},${crop.width},${crop.height}`
					: "";
				return `${node.id}|image|asset=${node.geometry.assetId};source=${sourceKind};href=${href};x=${bounds.x};y=${bounds.y};width=${bounds.width};height=${bounds.height}${cropSignature};opacity=${node.style.opacity};transform=${matrixToSvg(matrixFromTransform(node.transform))}`;
			}
			if (node.geometry.kind === "star") {
				const { center, points, innerRadius, outerRadius } = node.geometry;
				return `${node.id}|star|cx=${center.x};cy=${center.y};points=${points};inner=${innerRadius};outer=${outerRadius};r=${node.geometry.cornerRadius ?? 0};smooth=${node.geometry.cornerSmoothing ?? 0}|${style}`;
			}
			if (node.geometry.kind === "polygon") {
				const pts = node.geometry.points
					.map((point) => `${point.x},${point.y}`)
					.join(" ");
				return `${node.id}|polygon|pts=${pts};r=${node.geometry.cornerRadius ?? 0};smooth=${node.geometry.cornerSmoothing ?? 0}|${style}`;
			}
			return [
				node.id,
				node.geometry.kind,
				matrixToSvg(matrixFromTransform(node.transform)),
			].join("|");
		})
		.join("\n");
}

export const IDENTITY_MATRIX = identityMatrix;
