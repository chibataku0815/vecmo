import { useMemo, useRef } from "react";
import {
	type LookGraph,
	type LookGraphNode,
	lookGraphFromIntent,
	type RisoField,
} from "@/entities/scene/model/look-graph";
import { createSetLookGraphCommand } from "@/entities/scene/model/look-graph-commands";
import { resolveFrameLookGraph } from "@/entities/scene/model/recipe-resolve";
import {
	createSetScopedLookGraphOverlayCommand,
	scopedLookGraphNodeBounds,
	scopedLookGraphOverlays,
} from "@/entities/scene/model/scoped-look-graph-overlay";
import { findArtboardById, findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type { Bounds, SceneDocument } from "@/entities/scene/model/types";
import { useLookGraphSelectionStore } from "@/shared/editor-chrome/model/look-graph-selection";

/** Local mirror of the host overlay props this overlay actually reads. */
type OverlayProps = {
	readonly document: SceneDocument;
	readonly viewport: { readonly zoom: number };
};

/**
 * Concrete Look graph owner this overlay can read/write, without depending on
 * `features/look-authoring`'s `ConcreteFrameLookGraphTarget` (a features-only
 * import the arch gate bans from another feature). Structurally the same
 * three variants: scene, artboard, or one object-scoped graph overlay.
 */
type RisoFieldOwner =
	| { readonly scope: "scene" }
	| { readonly scope: "artboard"; readonly artboardId: string }
	| {
			readonly scope: "scoped-overlay";
			readonly artboardId: string;
			readonly scopedLookId: string;
	  };

const ZOOM_PERCENT = 100;
const LINE_PX = 1.6;
const HANDLE_PX = 12;
const CENTER_PX = 9;
const RING_HANDLE_PX = 10;
/** Field coord authorable range, mirrors `look-graph.ts`'s `normalizeRisoField` clamp. */
const MIN_FIELD_COORD = -2;
const MAX_FIELD_COORD = 3;
const MIN_FIELD_RADIUS = 0.01;
const MAX_FIELD_RADIUS = 3;

type RisoHandleKind =
	| "linear-start"
	| "linear-end"
	| "radial-center"
	| "radial-radius";

type ActiveDrag = {
	readonly pointerId: number;
	readonly handle: RisoHandleKind;
	readonly nodeId: string;
	readonly owner: RisoFieldOwner;
	readonly coalesceKey: string;
};

/**
 * Splits the Look Workspace's `lookGraphTargetKey`-built owner-key string
 * (`"scene"` | `"artboard:<id>"` | `"scoped-overlay:<artboardId>:<scopedLookId>"`)
 * back into a {@link RisoFieldOwner}. `lookGraphTargetKey` itself lives in
 * `features/look-authoring` (a feature this overlay may not import), and the
 * Look Workspace panel's active-scope toggle is component-local state this
 * overlay has no other way to see — the globally-shared selection store's
 * owner-key string is the only cross-feature-safe signal for "which graph
 * owns the currently selected node." Domain ids are `createId()` nanoid
 * strings (colon-free), so splitting on the literal `:` separator is
 * unambiguous.
 */
const risoFieldOwnerFromKey = (ownerKey: string): RisoFieldOwner | null => {
	if (ownerKey === "scene") return { scope: "scene" };
	const artboardPrefix = "artboard:";
	if (ownerKey.startsWith(artboardPrefix)) {
		const artboardId = ownerKey.slice(artboardPrefix.length);
		return artboardId ? { scope: "artboard", artboardId } : null;
	}
	const scopedOverlayPrefix = "scoped-overlay:";
	if (ownerKey.startsWith(scopedOverlayPrefix)) {
		const rest = ownerKey.slice(scopedOverlayPrefix.length);
		const separatorIndex = rest.indexOf(":");
		if (separatorIndex <= 0) return null;
		const artboardId = rest.slice(0, separatorIndex);
		const scopedLookId = rest.slice(separatorIndex + 1);
		return artboardId && scopedLookId
			? { scope: "scoped-overlay", artboardId, scopedLookId }
			: null;
	}
	return null;
};

/**
 * Reads the Look graph an owner is currently editing. Mirrors the read side of
 * `features/path-blur/model/guide-commit.ts`'s `resolvePathBlurTarget` (entities
 * primitives only, no feature import): `scene` reads the scene's own explicit
 * slot with no artboard fallback (there is no "resolve down to scene" concept —
 * scene IS the fallback floor), `artboard` resolves with the same
 * artboard-over-scene precedence the rendered frame uses, and `scoped-overlay`
 * reads straight off the artboard's stored overlay graph.
 */
const readGraphForOwner = (
	document: SceneDocument,
	owner: RisoFieldOwner,
): LookGraph | null => {
	switch (owner.scope) {
		case "scene":
			return (
				lookGraphFromIntent(document.effectIntent, { scope: "scene" }) ?? null
			);
		case "artboard":
			return resolveFrameLookGraph(document, owner.artboardId) ?? null;
		case "scoped-overlay": {
			const artboard = findArtboardById(document, owner.artboardId);
			if (!artboard) return null;
			const overlay = scopedLookGraphOverlays(artboard).find(
				(candidate) => candidate.id === owner.scopedLookId,
			);
			return overlay?.lookGraph ?? null;
		}
	}
};

/**
 * Resolves the scene-space rect the selected riso node's field coordinates are
 * normalized against: an object-scoped overlay uses its target node's own
 * paint bounds (mirrors `resolvePathBlurTarget`'s object/frame split), a
 * scene/artboard-scoped graph uses the whole artboard rect.
 */
const fieldSpaceBounds = (
	document: SceneDocument,
	owner: RisoFieldOwner,
): Bounds | null => {
	if (owner.scope !== "scoped-overlay") {
		return {
			x: 0,
			y: 0,
			width: document.artboard.width,
			height: document.artboard.height,
		};
	}
	const artboard = findArtboardById(document, owner.artboardId);
	if (!artboard) return null;
	const overlay = scopedLookGraphOverlays(artboard).find(
		(candidate) => candidate.id === owner.scopedLookId,
	);
	const targetNodeId = overlay?.targetNodeIds[0];
	const targetNode = targetNodeId
		? findNode(document, targetNodeId)
		: undefined;
	return targetNode ? scopedLookGraphNodeBounds(targetNode) : null;
};

/** Replaces one node's `payload.field` inside a graph, entities-only (no feature command). */
const graphWithRisoField = (
	graph: LookGraph,
	nodeId: string,
	field: RisoField,
): LookGraph => ({
	...graph,
	nodes: graph.nodes.map((node) =>
		node.id === nodeId && node.payload.kind === "riso"
			? { ...node, payload: { ...node.payload, field } }
			: node,
	),
});

const clampCoord = (value: number): number =>
	Math.min(MAX_FIELD_COORD, Math.max(MIN_FIELD_COORD, value));

const clampRadius = (value: number): number =>
	Math.min(MAX_FIELD_RADIUS, Math.max(MIN_FIELD_RADIUS, value));

/** Converts an SVG-space pointer event into artboard/graph-local coordinates via the CTM. */
const svgPointFromPointerEvent = (
	svg: SVGSVGElement,
	event: PointerEvent,
): { readonly x: number; readonly y: number } | null => {
	const ctm = svg.getScreenCTM();
	if (!ctm) return null;
	const point = svg.createSVGPoint();
	point.x = event.clientX;
	point.y = event.clientY;
	const local = point.matrixTransform(ctm.inverse());
	return { x: local.x, y: local.y };
};

let risoFieldGestureSeq = 0;

/**
 * Writes an updated `riso.field` through the command bus, entities-level and
 * scope-dispatched exactly like `commitPathBlurGuides` in
 * `features/path-blur/model/guide-commit.ts`: a scene/artboard owner goes
 * through `createSetLookGraphCommand`, a scoped overlay through
 * `createSetScopedLookGraphOverlayCommand`. Re-reads the live graph from the
 * store on every call so concurrent edits compose, and shares `coalesceKey`
 * across a whole drag so the gesture collapses to one undo entry.
 */
const commitRisoField = (
	owner: RisoFieldOwner,
	nodeId: string,
	nextField: RisoField,
	coalesceKey: string,
): void => {
	const document = useSceneStore.getState().document;
	const graph = readGraphForOwner(document, owner);
	if (!graph) return;
	const nextGraph = graphWithRisoField(graph, nodeId, nextField);
	const label = "Drag Riso field";
	if (owner.scope === "scoped-overlay") {
		useSceneStore
			.getState()
			.apply(
				createSetScopedLookGraphOverlayCommand(
					owner.artboardId,
					owner.scopedLookId,
					nextGraph,
					{ label, coalesceKey },
				),
			);
		return;
	}
	useSceneStore
		.getState()
		.apply(createSetLookGraphCommand(owner, nextGraph, { label, coalesceKey }));
};

function RisoFieldOverlay({ document, viewport }: OverlayProps) {
	const svgRef = useRef<SVGSVGElement | null>(null);
	const dragRef = useRef<ActiveDrag | null>(null);

	const selectedOwnerKey = useLookGraphSelectionStore(
		(selection) => selection.selectedOwnerKey,
	);
	const selectedNodeId = useLookGraphSelectionStore(
		(selection) => selection.selectedNodeId,
	);

	const owner = useMemo(
		() => (selectedOwnerKey ? risoFieldOwnerFromKey(selectedOwnerKey) : null),
		[selectedOwnerKey],
	);

	const risoNode = useMemo<LookGraphNode | null>(() => {
		if (!owner || !selectedNodeId) return null;
		const graph = readGraphForOwner(document, owner);
		const node = graph?.nodes.find(
			(candidate) => candidate.id === selectedNodeId,
		);
		return node?.payload.kind === "riso" ? node : null;
	}, [document, owner, selectedNodeId]);

	const bounds = useMemo(
		() => (owner && risoNode ? fieldSpaceBounds(document, owner) : null),
		[document, owner, risoNode],
	);

	if (!owner || !risoNode || !bounds) return null;
	const field =
		risoNode.payload.kind === "riso" ? risoNode.payload.field : null;
	if (!field || field.mode === "uniform") return null;
	const nodeInDoc = findNode(document, risoNode.id);
	if (nodeInDoc?.locked) return null;

	const toScene = (coord: { readonly x: number; readonly y: number }) => ({
		x: bounds.x + coord.x * bounds.width,
		y: bounds.y + coord.y * bounds.height,
	});

	const scale = Math.max(viewport.zoom / ZOOM_PERCENT, 0.001);
	const strokeWidth = LINE_PX / scale;
	const handleRadius = HANDLE_PX / scale / 2;
	const centerRadius = CENTER_PX / scale / 2;
	const ringHandleRadius = RING_HANDLE_PX / scale / 2;

	const beginDrag = (
		handle: RisoHandleKind,
		event: React.PointerEvent<SVGElement>,
	): void => {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.setPointerCapture(event.pointerId);
		risoFieldGestureSeq += 1;
		const coalesceKey = `riso-field-drag:${risoNode.id}:${handle}:${risoFieldGestureSeq}`;
		useSceneStore.getState().beginTransaction(coalesceKey, "Drag Riso field");
		dragRef.current = {
			pointerId: event.pointerId,
			handle,
			nodeId: risoNode.id,
			owner,
			coalesceKey,
		};
	};

	const onDragMove = (event: React.PointerEvent<SVGElement>): void => {
		const drag = dragRef.current;
		const svg = svgRef.current;
		if (!drag || !svg || drag.pointerId !== event.pointerId) return;
		const local = svgPointFromPointerEvent(svg, event.nativeEvent);
		if (!local) return;
		const doc = useSceneStore.getState().document;
		const liveBounds = fieldSpaceBounds(doc, drag.owner);
		if (!liveBounds) return;
		const graph = readGraphForOwner(doc, drag.owner);
		const liveNode = graph?.nodes.find(
			(candidate) => candidate.id === drag.nodeId,
		);
		if (liveNode?.payload.kind !== "riso") return;
		const liveField = liveNode.payload.field;
		const normalized = {
			x: (local.x - liveBounds.x) / liveBounds.width,
			y: (local.y - liveBounds.y) / liveBounds.height,
		};
		const nextField = ((): RisoField => {
			switch (drag.handle) {
				case "linear-start":
					return {
						...liveField,
						x1: clampCoord(normalized.x),
						y1: clampCoord(normalized.y),
					};
				case "linear-end":
					return {
						...liveField,
						x2: clampCoord(normalized.x),
						y2: clampCoord(normalized.y),
					};
				case "radial-center":
					return {
						...liveField,
						cx: clampCoord(normalized.x),
						cy: clampCoord(normalized.y),
					};
				case "radial-radius": {
					const dx = normalized.x - liveField.cx;
					const dy = normalized.y - liveField.cy;
					return { ...liveField, radius: clampRadius(Math.hypot(dx, dy)) };
				}
			}
		})();
		commitRisoField(drag.owner, drag.nodeId, nextField, drag.coalesceKey);
	};

	const endDrag = (event: React.PointerEvent<SVGElement>): void => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== event.pointerId) return;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		dragRef.current = null;
		useSceneStore.getState().commit();
	};

	const handleProps = (handle: RisoHandleKind) => ({
		onPointerDown: (event: React.PointerEvent<SVGElement>) =>
			beginDrag(handle, event),
		onPointerMove: onDragMove,
		onPointerUp: endDrag,
		onPointerCancel: endDrag,
	});

	const linearStart = toScene({ x: field.x1, y: field.y1 });
	const linearEnd = toScene({ x: field.x2, y: field.y2 });
	const radialCenter = toScene({ x: field.cx, y: field.cy });
	const radialRingHandle = toScene({ x: field.cx + field.radius, y: field.cy });
	const radialRx = field.radius * bounds.width;
	const radialRy = field.radius * bounds.height;

	return (
		<svg
			ref={svgRef}
			className="pointer-events-none absolute inset-0 h-full w-full"
			viewBox={`0 0 ${document.artboard.width} ${document.artboard.height}`}
			aria-hidden="true"
		>
			{field.mode === "linear" ? (
				<>
					<line
						x1={linearStart.x}
						y1={linearStart.y}
						x2={linearEnd.x}
						y2={linearEnd.y}
						stroke="#191817"
						strokeWidth={strokeWidth * 3}
						strokeLinecap="round"
						vectorEffect="non-scaling-stroke"
					/>
					<line
						x1={linearStart.x}
						y1={linearStart.y}
						x2={linearEnd.x}
						y2={linearEnd.y}
						stroke="#2ec4b6"
						strokeWidth={strokeWidth}
						strokeLinecap="round"
						vectorEffect="non-scaling-stroke"
					/>
					<circle
						cx={linearStart.x}
						cy={linearStart.y}
						r={handleRadius}
						fill="#f7f4eb"
						stroke="#191817"
						strokeWidth={strokeWidth}
						vectorEffect="non-scaling-stroke"
						pointerEvents="auto"
						cursor="grab"
						{...handleProps("linear-start")}
					/>
					<circle
						cx={linearEnd.x}
						cy={linearEnd.y}
						r={handleRadius}
						fill="#2ec4b6"
						stroke="#191817"
						strokeWidth={strokeWidth}
						vectorEffect="non-scaling-stroke"
						pointerEvents="auto"
						cursor="grab"
						{...handleProps("linear-end")}
					/>
				</>
			) : (
				<>
					{/* Anisotropic ellipse approximation for a non-square object: the
					    normalized `radius` scales independently by bounds.width/height,
					    so a non-square target renders (and drags) as an ellipse rather
					    than a true circle. */}
					{/* TODO: aspect-correct radial handle */}
					<ellipse
						cx={radialCenter.x}
						cy={radialCenter.y}
						rx={radialRx}
						ry={radialRy}
						fill="none"
						stroke="#191817"
						strokeWidth={strokeWidth * 3}
						vectorEffect="non-scaling-stroke"
					/>
					<ellipse
						cx={radialCenter.x}
						cy={radialCenter.y}
						rx={radialRx}
						ry={radialRy}
						fill="none"
						stroke="#2ec4b6"
						strokeWidth={strokeWidth}
						vectorEffect="non-scaling-stroke"
					/>
					<circle
						cx={radialCenter.x}
						cy={radialCenter.y}
						r={centerRadius}
						fill="#2ec4b6"
						stroke="#191817"
						strokeWidth={strokeWidth}
						vectorEffect="non-scaling-stroke"
						pointerEvents="auto"
						cursor="grab"
						{...handleProps("radial-center")}
					/>
					<circle
						cx={radialRingHandle.x}
						cy={radialRingHandle.y}
						r={ringHandleRadius}
						fill="#f7f4eb"
						stroke="#2ec4b6"
						strokeWidth={strokeWidth}
						vectorEffect="non-scaling-stroke"
						pointerEvents="auto"
						cursor="ew-resize"
						{...handleProps("radial-radius")}
					/>
				</>
			)}
		</svg>
	);
}

export const overlay = {
	id: "riso-field",
	Component: RisoFieldOverlay,
};
