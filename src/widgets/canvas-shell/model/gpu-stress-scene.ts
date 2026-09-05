/**
 * Dev-only GPU stress-scene generator (E1 S4 — see
 * `docs/gpu-canvas-convergence-e1-plan.md` D7 verification tooling). Appends
 * one new, GPU-capability-supported artboard full of generated content to the
 * live document through the SAME scene command bus every other editor
 * mutation uses (never `useSceneStore.setState`) — see
 * `generateGpuStressScene`'s doc comment for the exact command composition
 * that keeps this a single undo entry.
 *
 * Registered as `globalThis.__vmaGpuStress` by `GpuSceneCanvas` (dev builds
 * only), so a developer can run `__vmaGpuStress(400)` from the browser
 * console to populate a capability-clean artboard for the diff overlay and
 * frame HUD to measure. This module has no React/DOM dependency of its own —
 * it is pure scene-command construction plus registration wiring.
 */
import { createUseNodeAsMaskCommand } from "@/entities/scene/model/appearance";
import type { SceneCommand } from "@/entities/scene/model/command";
import {
	createAddArtboardCommand,
	createAppendNodeCommand,
	createPlaceImageNodeCommand,
} from "@/entities/scene/model/node-commands";
import { selectAllArtboards } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	Artboard,
	BezierShape,
	BlendMode,
	SceneDocument,
	StrokeCap,
	StrokeJoin,
	VectorNode,
} from "@/entities/scene/model/types";
import { IDENTITY_TRANSFORM } from "@/entities/scene/model/types";
import { STROKE_WIDTH_PROFILE_PRESETS } from "@/shared/stroke/width-profile";

/** Default node count for `__vmaGpuStress()` when called with no argument. */
const STRESS_NODE_COUNT = 400;

/** Every generated artboard's id starts with this — the idempotence guard checks for it (see {@link generateGpuStressScene}'s doc comment). */
const STRESS_ARTBOARD_ID_PREFIX = "gpu-stress-";

/** Fraction of generated nodes that get an E0 width-profile stroked open path, matching this slice's acceptance bar ("at least 15%"). */
const STRESS_PROFILE_STROKE_FRACTION = 0.15;

/** Gap (world units) between the existing pasteboard content and the stress artboard, mirroring `DUPLICATED_ARTBOARD_GAP`'s role for ordinary artboard placement. */
const STRESS_ARTBOARD_GAP = 240;

/** Fixed stress-artboard size — large enough to host `STRESS_NODE_COUNT` nodes in a readable grid at the default node cell size below. */
const STRESS_ARTBOARD_WIDTH = 3200;
const STRESS_ARTBOARD_HEIGHT = 2400;

/** Grid cell size (world units) generated nodes are placed within, before jitter. */
const STRESS_CELL_SIZE = 140;
const STRESS_NODE_SIZE = 90;
/** Max random offset applied inside each grid cell, keeping nodes clear of the next cell. */
const STRESS_JITTER_RANGE = 30;

/**
 * Seeded linear congruential generator (Numerical Recipes constants) so
 * repeated `__vmaGpuStress()` runs produce the SAME layout for a given seed —
 * deterministic pseudo-randomness, not `Math.random()`, so two stress runs
 * (e.g. before/after a perf change) are visually comparable.
 */
function createSeededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 0x100000000;
	};
}

/** Fixed seed for the stress generator's deterministic layout (Numerical Recipes LCG, see {@link createSeededRandom}). */
const STRESS_LAYOUT_SEED = 20260705;

const STRESS_PALETTE = [
	"#2ec4b6",
	"#ff5a5f",
	"#f4c430",
	"#7c5cff",
	"#191817",
	"#0e7c86",
] as const;

/** Straight zero-tangent vertices for a generated `BezierShape` — mirrors `pathGeometryFromPoints`'s all-zero-tangent convention for a polyline authored directly as scene geometry, without routing through the path-boolean conversion helpers (unneeded for straight segments). */
function straightBezierShape(
	vertices: readonly [number, number][],
	closed: boolean,
): BezierShape {
	return {
		type: "Shape",
		closed,
		vertices: vertices.map((point) => [...point] as [number, number]),
		inTangents: vertices.map(() => [0, 0] as [number, number]),
		outTangents: vertices.map(() => [0, 0] as [number, number]),
	};
}

/**
 * Builds one E0 width-profile stroked open path node — a straight 4-vertex
 * zig-zag spine (long enough for `expandStrokeWidthProfile`'s arc-length
 * sampling to produce a real taper) with `style.strokeWidthProfile` set to a
 * BUILT-IN preset (see `STROKE_WIDTH_PROFILE_PRESETS`), reusing the exact
 * field the E0 model/renderer already reads (`getStrokeWidthProfileOutline`)
 * rather than inventing a parallel shape. `style.fill` stays `"none"` and
 * `style.strokes` stays unset, matching how a profile-stroke node is actually
 * authored in the live editor — `legacyStrokeIsActive` (this node's gate into
 * `getStrokeWidthProfileOutline`) requires `style.stroke !== "none"` AND an
 * EMPTY `style.strokes` stack.
 */
function stressProfileStrokeNode(
	id: string,
	origin: { readonly x: number; readonly y: number },
	color: string,
	random: () => number,
): VectorNode {
	const span = STRESS_NODE_SIZE;
	const wobble = span * 0.3;
	const vertices: [number, number][] = [
		[origin.x, origin.y + span],
		[origin.x + span * 0.33, origin.y - wobble * random()],
		[origin.x + span * 0.66, origin.y + wobble * random()],
		[origin.x + span, origin.y - span * 0.2],
	];
	const presetIds = Object.keys(
		STROKE_WIDTH_PROFILE_PRESETS,
	) as (keyof typeof STROKE_WIDTH_PROFILE_PRESETS)[];
	const preset =
		STROKE_WIDTH_PROFILE_PRESETS[
			presetIds[Math.floor(random() * presetIds.length) % presetIds.length]
		];
	return {
		id,
		name: `stress profile stroke ${id}`,
		geometry: { kind: "path", shape: straightBezierShape(vertices, false) },
		transform: IDENTITY_TRANSFORM,
		style: {
			fill: "none",
			stroke: color,
			strokeWidth: 14,
			opacity: 1,
			strokeWidthProfile: preset,
		},
		visible: true,
		locked: false,
	};
}

type StressGeometryKind =
	| "rect"
	| "rounded-rect"
	| "ellipse"
	| "solid-path"
	| "linear-gradient"
	| "radial-gradient"
	| "uniform-stroke";

/** Deterministic round-robin over the non-profile-stroke geometry kinds, so the fixed seed produces a reproducible mix across a run. */
const STRESS_GEOMETRY_KINDS: readonly StressGeometryKind[] = [
	"rect",
	"rounded-rect",
	"ellipse",
	"solid-path",
	"linear-gradient",
	"radial-gradient",
	"uniform-stroke",
];

/**
 * Builds one non-profile-stroke stress node — a mix of solid-fill rects/
 * rounded-rects/ellipses/paths, linear/radial gradient fills, and uniform
 * strokes (translucent color, varied cap/join) covering the S3 GPU capability
 * envelope alongside the profile-stroke nodes {@link stressProfileStrokeNode}
 * generates. `style.fills`/`style.strokes` (the appearance-stack fields) are
 * deliberately left UNSET — a gradient fill here uses the LEGACY
 * `style.fill` as an inline paint object, matching `canvasPaintsForStyle`'s
 * "single paint" fast path exactly like the seed scene's own solid-fill nodes
 * do, and keeping every generated node inside `nodeCapabilityReasons`'s
 * `fillCount <= 1`/`strokeCount <= 1` GPU envelope by construction (an
 * appearance-stack node would need `resolvePaints` to see `style.fills`, which
 * this generator never sets).
 */
function stressGeometryNode(
	id: string,
	kind: StressGeometryKind,
	origin: { readonly x: number; readonly y: number },
	color: string,
	secondaryColor: string,
	random: () => number,
): VectorNode {
	const size = STRESS_NODE_SIZE;
	const bounds = { x: origin.x, y: origin.y, width: size, height: size };
	const baseStyle = {
		fill: "none",
		stroke: "none",
		strokeWidth: 0,
		opacity: 1,
	};

	switch (kind) {
		case "rect":
			return {
				id,
				name: `stress rect ${id}`,
				geometry: { kind: "rect", bounds, cornerRadius: 0 },
				transform: IDENTITY_TRANSFORM,
				style: { ...baseStyle, fill: color },
				visible: true,
				locked: false,
			};
		case "rounded-rect":
			return {
				id,
				name: `stress rounded-rect ${id}`,
				geometry: { kind: "rect", bounds, cornerRadius: size * 0.2 },
				transform: IDENTITY_TRANSFORM,
				style: { ...baseStyle, fill: color },
				visible: true,
				locked: false,
			};
		case "ellipse":
			return {
				id,
				name: `stress ellipse ${id}`,
				geometry: { kind: "ellipse", bounds },
				transform: IDENTITY_TRANSFORM,
				style: { ...baseStyle, fill: color },
				visible: true,
				locked: false,
			};
		case "solid-path": {
			const vertices: [number, number][] = [
				[origin.x + size / 2, origin.y],
				[origin.x + size, origin.y + size * 0.7],
				[origin.x + size * 0.2, origin.y + size],
			];
			return {
				id,
				name: `stress path ${id}`,
				geometry: {
					kind: "path",
					shape: straightBezierShape(vertices, true),
				},
				transform: IDENTITY_TRANSFORM,
				style: { ...baseStyle, fill: color },
				visible: true,
				locked: false,
			};
		}
		case "linear-gradient":
			return {
				id,
				name: `stress linear-gradient ${id}`,
				geometry: { kind: "rect", bounds, cornerRadius: 0 },
				transform: IDENTITY_TRANSFORM,
				style: {
					...baseStyle,
					fills: [
						{
							kind: "linear-gradient",
							from: { x: origin.x, y: origin.y },
							to: { x: origin.x + size, y: origin.y + size },
							stops: [
								{ offset: 0, color },
								{ offset: 1, color: secondaryColor },
							],
						},
					],
				},
				visible: true,
				locked: false,
			};
		case "radial-gradient":
			return {
				id,
				name: `stress radial-gradient ${id}`,
				geometry: { kind: "ellipse", bounds },
				transform: IDENTITY_TRANSFORM,
				style: {
					...baseStyle,
					fills: [
						{
							kind: "radial-gradient",
							center: { x: origin.x + size / 2, y: origin.y + size / 2 },
							radius: { x: size / 2, y: size / 2 },
							stops: [
								{ offset: 0, color: secondaryColor },
								{ offset: 1, color },
							],
						},
					],
				},
				visible: true,
				locked: false,
			};
		default: {
			const caps: readonly StrokeCap[] = ["butt", "round", "square"];
			const joins: readonly StrokeJoin[] = ["miter", "round", "bevel"];
			return {
				id,
				name: `stress uniform-stroke ${id}`,
				geometry: { kind: "rect", bounds, cornerRadius: size * 0.1 },
				transform: IDENTITY_TRANSFORM,
				style: {
					...baseStyle,
					stroke: color,
					strokeWidth: 10,
					strokeCap: caps[Math.floor(random() * caps.length) % caps.length],
					strokeJoin: joins[Math.floor(random() * joins.length) % joins.length],
					strokes: [{ kind: "solid", color, opacity: 0.55 }],
				},
				visible: true,
				locked: false,
			};
		}
	}
}

/**
 * Half the overlap-pair footprint (world units) — one shape sits at
 * `origin - OVERLAP_OFFSET` and the other at `origin + OVERLAP_OFFSET`, so the
 * two shapes' bounds genuinely overlap by roughly half their own size rather
 * than merely touching at an edge.
 */
const OVERLAP_OFFSET = STRESS_NODE_SIZE * 0.3;

/**
 * Builds one fill-only rect node — a solid, opaque, capability-clean fill
 * with NO stroke (`style.stroke` stays `"none"`), used by
 * {@link overlapPairNodes} as one half of a cross-node paint-order smoke pair
 * (see `docs/gpu-canvas-convergence-e1-plan.md`'s review-findings addendum:
 * this is the fixture used to manually verify the interleaved-paint-order
 * fix — a fill drawn either under or over a DIFFERENT node's stroke, in both
 * stacking directions).
 */
function overlapFillNode(
	id: string,
	origin: { readonly x: number; readonly y: number },
	color: string,
): VectorNode {
	const size = STRESS_NODE_SIZE;
	return {
		id,
		name: `stress overlap fill ${id}`,
		geometry: {
			kind: "rect",
			bounds: { x: origin.x, y: origin.y, width: size, height: size },
			cornerRadius: 0,
		},
		transform: IDENTITY_TRANSFORM,
		style: { fill: color, stroke: "none", strokeWidth: 0, opacity: 1 },
		visible: true,
		locked: false,
	};
}

/**
 * Builds one stroke-only ellipse node — a solid, opaque, capability-clean
 * uniform stroke with NO fill (`style.fill` stays `"none"`), used by
 * {@link overlapPairNodes} as the other half of a cross-node paint-order
 * smoke pair. An ellipse (rather than the fill node's rect) makes the two
 * shapes' overlap region visually obvious at a glance — a stroke ring
 * crossing a solid square reveals immediately which one painted on top.
 */
function overlapStrokeNode(
	id: string,
	origin: { readonly x: number; readonly y: number },
	color: string,
): VectorNode {
	const size = STRESS_NODE_SIZE;
	return {
		id,
		name: `stress overlap stroke ${id}`,
		geometry: {
			kind: "ellipse",
			bounds: { x: origin.x, y: origin.y, width: size, height: size },
		},
		transform: IDENTITY_TRANSFORM,
		style: {
			fill: "none",
			stroke: color,
			strokeWidth: 16,
			strokeCap: "round",
			strokeJoin: "round",
			opacity: 1,
		},
		visible: true,
		locked: false,
	};
}

/**
 * Builds the cross-node paint-order smoke fixture (post-S4 review fix — see
 * `docs/gpu-canvas-convergence-e1-plan.md`'s review-findings addendum): TWO
 * overlapping pairs, one per stacking direction, so a manual GPU-vs-SVG diff
 * check (`?gpuDiff=1`) can confirm the fix holds both ways:
 *
 * - Pair A: a stroke-only node compiled FIRST (so it is EARLIER in document/
 *   z order), then a fill-only node compiled SECOND (LATER), overlapping it —
 *   the fill must paint OVER the stroke.
 * - Pair B: the REVERSE stacking — a fill-only node FIRST, then a
 *   stroke-only node SECOND, overlapping it — the stroke must paint OVER the
 *   fill.
 *
 * Both pairs sit at a FIXED origin within `[0, topMargin)` — a reserved band
 * {@link buildStressSceneCommand} adds above the jittered grid
 * {@link stressGridOrigins} places elsewhere — so this fixture is
 * reproducible and collision-free without depending on the seeded random
 * layout at all. `topMargin` must be at least one `STRESS_CELL_SIZE` tall
 * (both pairs' shapes span well under that in Y).
 */
function overlapPairNodes(artboardId: string): readonly VectorNode[] {
	const pairAOrigin = { x: STRESS_CELL_SIZE / 2, y: STRESS_CELL_SIZE / 2 };
	const pairBOrigin = {
		x: pairAOrigin.x + STRESS_CELL_SIZE * 2,
		y: pairAOrigin.y,
	};

	return [
		// Pair A: stroke under, fill over.
		overlapStrokeNode(
			`${artboardId}-overlap-a-under`,
			pairAOrigin,
			STRESS_PALETTE[0],
		),
		overlapFillNode(
			`${artboardId}-overlap-a-over`,
			{ x: pairAOrigin.x + OVERLAP_OFFSET, y: pairAOrigin.y + OVERLAP_OFFSET },
			STRESS_PALETTE[1],
		),
		// Pair B: fill under, stroke over (the reverse stacking).
		overlapFillNode(
			`${artboardId}-overlap-b-under`,
			pairBOrigin,
			STRESS_PALETTE[2],
		),
		overlapStrokeNode(
			`${artboardId}-overlap-b-over`,
			{ x: pairBOrigin.x + OVERLAP_OFFSET, y: pairBOrigin.y + OVERLAP_OFFSET },
			STRESS_PALETTE[3],
		),
	];
}

/**
 * Deterministic inline 8x8 checker PNG (teal/near-black, matching
 * `STRESS_PALETTE[0]`/`[4]`), hand-encoded so the S5 fixture below never
 * depends on a network fetch — every pixel is either fully opaque teal or
 * fully opaque near-black, alternating, so an image fill's placement/UV
 * mapping is trivially eyeballable (a visible checker pattern, not a flat
 * color a mapping bug could hide behind).
 */
const STRESS_CHECKER_PNG_DATA_URL =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAHElEQVR42mPQO7Ltv6SE+H9cNAM+SRDNMCxMAACKaH3BtJtoagAAAABJRU5ErkJggg==";

/**
 * Deterministic inline 2x2 JPEG for the S33 image-artboard-background fixture.
 * JPEG has no alpha channel, which is load-bearing: the GPU can draw it above
 * the retained SVG artboard background without transparent pixels
 * double-compositing against the page.
 */
const STRESS_BACKGROUND_JPEG_DATA_URL =
	"data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD6H8KaDpl14W0aabTrSaaSyhd5JIFZmYoCSSRySe9FFFfgOZf77X/xy/Nn9HZf/udH/DH8kf/Z";

/**
 * Builds a simple valid 2x2 gradient mesh (E1 S5) covering `bounds` — four
 * corner colors, no tangent handles (bilinear-degenerate, the simplest valid
 * mesh `coonsPatchesFromMesh` accepts per `MIN_GRID = 2`), used as
 * `style.fills[0]` on the S5 mesh-paint fixture node.
 */
function stressMeshPaint(bounds: {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}): {
	readonly kind: "mesh-gradient";
	readonly rows: number;
	readonly cols: number;
	readonly points: readonly {
		readonly point: { readonly x: number; readonly y: number };
		readonly color: string;
	}[];
} {
	const { x, y, width, height } = bounds;
	return {
		kind: "mesh-gradient",
		rows: 2,
		cols: 2,
		points: [
			{ point: { x, y }, color: STRESS_PALETTE[0] },
			{ point: { x: x + width, y }, color: STRESS_PALETTE[1] },
			{ point: { x, y: y + height }, color: STRESS_PALETTE[3] },
			{ point: { x: x + width, y: y + height }, color: STRESS_PALETTE[2] },
		],
	};
}

/**
 * Reserved band (world units) added to the stress artboard's height,
 * alongside {@link OVERLAP_FIXTURE_MARGIN}, exclusively for
 * {@link s5FixtureCommands}'s three fixed-origin nodes — one
 * `STRESS_CELL_SIZE` row, so the jittered grid can never collide with it
 * regardless of `count`, matching {@link OVERLAP_FIXTURE_MARGIN}'s existing
 * precedent for a dedicated non-jittered band.
 */
const S5_FIXTURE_MARGIN = STRESS_CELL_SIZE;

/**
 * Builds the E1 S5 fixture commands: an image-FILL-paint node (a rect whose
 * `style.fills[0]` is an `image-reference` paint pointing at the checker PNG
 * asset), a placed IMAGE-geometry node (`kind: "image"`, the SAME asset,
 * mirroring how `PlacedImageNode` renders an editable image node in
 * `CanvasShell.tsx`), and a mesh-paint node (a rect whose `style.fills[0]` is
 * a 2x2 gradient mesh) — the three new content classes this slice adds GPU
 * support for, so `__vmaGpuStress()` exercises all of them and the resulting
 * artboard stays GPU-supported (capability reasons `[]`).
 *
 * Returns commands, not bare nodes (unlike {@link overlapPairNodes}): placing
 * an image node needs `createPlaceImageNodeCommand`, which ALSO appends the
 * backing `SceneAsset` to `draft.assets` — a step `createAppendNodeCommand`
 * alone cannot do. All three commands' `run` are composed into the SAME
 * outer draft by {@link buildStressSceneCommand}, exactly like every other
 * fixture here. `topMargin` places this fixture in its OWN row, below
 * {@link overlapPairNodes}'s band — both bands span the SAME X range
 * (`[STRESS_CELL_SIZE/2, STRESS_CELL_SIZE/2 + STRESS_CELL_SIZE*2]`), so they
 * would collide if placed at the same Y.
 */
function s5FixtureCommands(
	artboardId: string,
	topMargin: number,
): readonly SceneCommand[] {
	const origin = {
		x: STRESS_CELL_SIZE / 2,
		y: topMargin + STRESS_CELL_SIZE / 2,
	};
	const size = STRESS_NODE_SIZE;
	const assetId = `${artboardId}-s5-checker-asset`;

	const imagePlaceCommand = createPlaceImageNodeCommand(
		{
			assetId,
			nodeId: `${artboardId}-s5-placed-image`,
			name: "GPU stress placed image",
			bounds: { x: origin.x, y: origin.y, width: size, height: size },
			source: { kind: "data-url", dataUrl: STRESS_CHECKER_PNG_DATA_URL },
			artboardId,
			width: 8,
			height: 8,
		},
		{ label: "Add GPU stress placed image" },
	);

	const imageFillOrigin = { x: origin.x + STRESS_CELL_SIZE, y: origin.y };
	const imageFillNode: VectorNode = {
		id: `${artboardId}-s5-image-fill`,
		name: "stress image-fill rect",
		geometry: {
			kind: "rect",
			bounds: {
				x: imageFillOrigin.x,
				y: imageFillOrigin.y,
				width: size,
				height: size,
			},
			cornerRadius: 0,
		},
		transform: IDENTITY_TRANSFORM,
		style: {
			fill: "none",
			stroke: "none",
			strokeWidth: 0,
			opacity: 1,
			fills: [{ kind: "image-reference", assetId, fit: "fill" }],
		},
		visible: true,
		locked: false,
	};
	const imageFillCommand = createAppendNodeCommand(
		{ ...imageFillNode, artboardId },
		{ label: "Add GPU stress image-fill node" },
	);

	const meshOrigin = { x: origin.x + STRESS_CELL_SIZE * 2, y: origin.y };
	const meshBoundsRect = {
		x: meshOrigin.x,
		y: meshOrigin.y,
		width: size,
		height: size,
	};
	const meshNode: VectorNode = {
		id: `${artboardId}-s5-mesh-paint`,
		name: "stress mesh-paint rect",
		geometry: { kind: "rect", bounds: meshBoundsRect, cornerRadius: 0 },
		transform: IDENTITY_TRANSFORM,
		style: {
			fill: "none",
			stroke: "none",
			strokeWidth: 0,
			opacity: 1,
			fills: [stressMeshPaint(meshBoundsRect)],
		},
		visible: true,
		locked: false,
	};
	const meshCommand = createAppendNodeCommand(
		{ ...meshNode, artboardId },
		{ label: "Add GPU stress mesh-paint node" },
	);

	return [imagePlaceCommand, imageFillCommand, meshCommand];
}

/**
 * Reserved band (world units) added to the stress artboard's height,
 * alongside {@link OVERLAP_FIXTURE_MARGIN}/{@link S5_FIXTURE_MARGIN},
 * exclusively for {@link s6BlendFixtureCommands}'s five fixed-origin blend
 * pairs — one `STRESS_CELL_SIZE` row, matching those two fixtures' existing
 * precedent for a dedicated non-jittered band.
 */
const S6_FIXTURE_MARGIN = STRESS_CELL_SIZE;

/**
 * Builds one opaque solid-fill rect node — the "base"/backdrop half of one
 * E1 S6/S31 blend-mode fixture pair. Identical shape to {@link overlapFillNode}
 * (kept as a separate, blend-fixture-scoped helper rather than reused
 * directly, since {@link overlapFillNode}'s doc comment scopes it to the
 * cross-node paint-order smoke fixture specifically).
 */
function blendBaseSolidNode(
	id: string,
	origin: { readonly x: number; readonly y: number },
	color: string,
): VectorNode {
	const size = STRESS_NODE_SIZE;
	return {
		id,
		name: `stress blend base ${id}`,
		geometry: {
			kind: "rect",
			bounds: { x: origin.x, y: origin.y, width: size, height: size },
			cornerRadius: 0,
		},
		transform: IDENTITY_TRANSFORM,
		style: { fill: color, stroke: "none", strokeWidth: 0, opacity: 1 },
		visible: true,
		locked: false,
	};
}

/**
 * Builds one opaque linear-gradient-fill rect node — used as EITHER half of
 * an E1 S6/S31 blend-mode fixture pair (the multiply pair's opaque BASE, or the
 * screen pair's blended TOP — see {@link s6BlendFixtureCommands}'s doc
 * comment for why a gradient is admissible under multiply/screen but not
 * under a pair's BLENDED node when that mode is darken/lighten, per
 * `entities/scene/model/gpu/capability.ts`'s gate (e)). Mirrors
 * `stressGeometryNode`'s `"linear-gradient"` case's authoring pattern
 * exactly (`style.fills`, never the legacy `style.fill`, and both gradient
 * stops fully opaque so the fixture stays capability-clean regardless of
 * which role it plays).
 */
function blendGradientNode(
	id: string,
	origin: { readonly x: number; readonly y: number },
	color: string,
	secondaryColor: string,
	blendMode?: BlendMode,
): VectorNode {
	const size = STRESS_NODE_SIZE;
	return {
		id,
		name: `stress blend gradient ${id}`,
		geometry: {
			kind: "rect",
			bounds: { x: origin.x, y: origin.y, width: size, height: size },
			cornerRadius: 0,
		},
		transform: IDENTITY_TRANSFORM,
		style: {
			fill: "none",
			stroke: "none",
			strokeWidth: 0,
			opacity: 1,
			blendMode,
			fills: [
				{
					kind: "linear-gradient",
					from: { x: origin.x, y: origin.y },
					to: { x: origin.x + size, y: origin.y + size },
					stops: [
						{ offset: 0, color },
						{ offset: 1, color: secondaryColor },
					],
				},
			],
		},
		visible: true,
		locked: false,
	};
}

/**
 * Builds one opaque solid-fill rect node carrying a fixed-function
 * `blendMode` — the BLENDED "top" half of a solid-top fixed-function blend
 * fixture pair. Identical shape to {@link blendBaseSolidNode} plus
 * `style.blendMode`, kept separate so the base/blended roles stay
 * textually distinct at each call site below.
 */
function blendSolidNode(
	id: string,
	origin: { readonly x: number; readonly y: number },
	color: string,
	blendMode: BlendMode,
): VectorNode {
	const size = STRESS_NODE_SIZE;
	return {
		id,
		name: `stress blend solid ${id}`,
		geometry: {
			kind: "rect",
			bounds: { x: origin.x, y: origin.y, width: size, height: size },
			cornerRadius: 0,
		},
		transform: IDENTITY_TRANSFORM,
		style: {
			fill: color,
			stroke: "none",
			strokeWidth: 0,
			opacity: 1,
			blendMode,
		},
		visible: true,
		locked: false,
	};
}

/**
 * Builds the E1 S6/S31 fixed-function blend-mode fixture commands: FIVE
 * fixture pairs laid out along X, one per admitted mode
 * (`multiply`/`screen`/`darken`/`lighten`/`exclusion` — see
 * `entities/scene/model/gpu/capability.ts`'s gate list and
 * `shared/gpu/webgpu.ts`'s `BLEND_STATE_BY_MODE` for the exact math each
 * pair exercises), each pair an opaque BASE rect plus a single-fill BLENDED
 * rect overlapping it by half — mirroring {@link overlapPairNodes}'s
 * half-shift overlap convention exactly (`OVERLAP_OFFSET`), so the blended
 * half's overlap with its own base is visually obvious.
 *
 * - Pair 1 (multiply): a solid BLENDED node over a linear-gradient BASE
 *   (multiply is exact for ANY source alpha over an opaque backdrop, so a
 *   gradient BASE — spatially varying color, still fully opaque — is a
 *   stronger check than a flat base color).
 * - Pair 2 (screen): a linear-gradient BLENDED node over a solid BASE
 *   (screen is likewise exact for any source alpha; putting the gradient
 *   on the BLENDED side instead exercises the opposite pairing from
 *   `multiply`'s).
 * - Pair 3 (darken) / Pair 4 (lighten): an opaque solid BLENDED node over
 *   an opaque solid BASE — darken/lighten require an opaque-solid-only
 *   blended paint (gate (e)), so both pairs use plain solids on both
 *   halves.
 * - Pair 5 (exclusion): a linear-gradient BLENDED node over a solid BASE,
 *   matching multiply/screen's "any source alpha" class while exercising the
 *   S31 blend state.
 *
 * Every node here is a single-fill leaf (`fill` via the legacy field or
 * `fills: [...]`, matching each helper's own authoring pattern), fully
 * inside the artboard band, `IDENTITY_TRANSFORM` — no rotation/scale, so
 * gate (d)'s committed-bounds walk (`blendOverhangReasons` in
 * `entities/scene/model/gpu/capability.ts`) trivially passes for this
 * fixture. `topMargin` places this fixture in its own row, below
 * {@link s5FixtureCommands}'s band (both bands span overlapping X ranges,
 * so they would collide if placed at the same Y — see that function's doc
 * comment for the identical constraint).
 */
function s6BlendFixtureCommands(
	artboardId: string,
	topMargin: number,
): readonly SceneCommand[] {
	const rowOrigin = {
		x: STRESS_CELL_SIZE / 2,
		y: topMargin + STRESS_CELL_SIZE / 2,
	};
	const pairOffset = { x: OVERLAP_OFFSET, y: OVERLAP_OFFSET };
	const pairOrigin = (
		pairIndex: number,
	): { readonly x: number; readonly y: number } => ({
		x: rowOrigin.x + pairIndex * STRESS_CELL_SIZE,
		y: rowOrigin.y,
	});

	const multiplyOrigin = pairOrigin(0);
	const multiplyBase = blendGradientNode(
		`${artboardId}-s6-multiply-base`,
		multiplyOrigin,
		STRESS_PALETTE[0],
		STRESS_PALETTE[3],
	);
	const multiplyTop = blendSolidNode(
		`${artboardId}-s6-multiply-top`,
		{ x: multiplyOrigin.x + pairOffset.x, y: multiplyOrigin.y + pairOffset.y },
		STRESS_PALETTE[1],
		"multiply",
	);

	const screenOrigin = pairOrigin(1);
	const screenBase = blendBaseSolidNode(
		`${artboardId}-s6-screen-base`,
		screenOrigin,
		STRESS_PALETTE[4],
	);
	const screenTop = blendGradientNode(
		`${artboardId}-s6-screen-top`,
		{ x: screenOrigin.x + pairOffset.x, y: screenOrigin.y + pairOffset.y },
		STRESS_PALETTE[2],
		STRESS_PALETTE[3],
		"screen",
	);

	const darkenOrigin = pairOrigin(2);
	const darkenBase = blendBaseSolidNode(
		`${artboardId}-s6-darken-base`,
		darkenOrigin,
		STRESS_PALETTE[2],
	);
	const darkenTop = blendSolidNode(
		`${artboardId}-s6-darken-top`,
		{ x: darkenOrigin.x + pairOffset.x, y: darkenOrigin.y + pairOffset.y },
		STRESS_PALETTE[0],
		"darken",
	);

	const lightenOrigin = pairOrigin(3);
	const lightenBase = blendBaseSolidNode(
		`${artboardId}-s6-lighten-base`,
		lightenOrigin,
		STRESS_PALETTE[4],
	);
	const lightenTop = blendSolidNode(
		`${artboardId}-s6-lighten-top`,
		{ x: lightenOrigin.x + pairOffset.x, y: lightenOrigin.y + pairOffset.y },
		STRESS_PALETTE[1],
		"lighten",
	);

	const exclusionOrigin = pairOrigin(4);
	const exclusionBase = blendBaseSolidNode(
		`${artboardId}-s31-exclusion-base`,
		exclusionOrigin,
		STRESS_PALETTE[0],
	);
	const exclusionTop = blendGradientNode(
		`${artboardId}-s31-exclusion-top`,
		{
			x: exclusionOrigin.x + pairOffset.x,
			y: exclusionOrigin.y + pairOffset.y,
		},
		STRESS_PALETTE[4],
		STRESS_PALETTE[2],
		"exclusion",
	);

	const nodes: readonly VectorNode[] = [
		multiplyBase,
		multiplyTop,
		screenBase,
		screenTop,
		darkenBase,
		darkenTop,
		lightenBase,
		lightenTop,
		exclusionBase,
		exclusionTop,
	];
	return nodes.map((node) =>
		createAppendNodeCommand(
			{ ...node, artboardId },
			{ label: "Add GPU stress blend-mode node" },
		),
	);
}

/**
 * Reserved band (world units) added to the stress artboard's height,
 * alongside {@link OVERLAP_FIXTURE_MARGIN}/{@link S5_FIXTURE_MARGIN}/
 * {@link S6_FIXTURE_MARGIN}, exclusively for {@link s7ClipFixtureCommands}'s
 * three fixed-origin clip-mask pairs — one `STRESS_CELL_SIZE` row, matching
 * those three fixtures' existing precedent for a dedicated non-jittered band.
 */
const S7_FIXTURE_MARGIN = STRESS_CELL_SIZE;

/**
 * Builds one solid-fill rect node — the CONTENT half of the E1 S7 clip-mask
 * fixture pair 1 (rect content clipped by an ellipse silhouette). Identical
 * shape to {@link overlapFillNode} (kept separate since that helper's own
 * doc comment scopes it to the S4 paint-order smoke fixture specifically).
 */
function clipContentRectNode(
	id: string,
	origin: { readonly x: number; readonly y: number },
	color: string,
): VectorNode {
	const size = STRESS_NODE_SIZE;
	return {
		id,
		name: `stress clip content ${id}`,
		geometry: {
			kind: "rect",
			bounds: { x: origin.x, y: origin.y, width: size, height: size },
			cornerRadius: 0,
		},
		transform: IDENTITY_TRANSFORM,
		style: { fill: color, stroke: "none", strokeWidth: 0, opacity: 1 },
		visible: true,
		locked: false,
	};
}

/**
 * Fraction of {@link STRESS_NODE_SIZE} an ellipse/rect clip-mask SILHOUETTE
 * is shifted by, relative to its own content's origin — large enough that
 * the silhouette visibly cuts into (rather than fully containing) its
 * content, so the clip is eyeballable at a glance rather than looking
 * identical to the unclipped content.
 */
const CLIP_SILHOUETTE_OFFSET = STRESS_NODE_SIZE * 0.35;

/**
 * Builds an ellipse silhouette node — the MASK SOURCE half of clip-mask
 * fixture pair 1. Placed OFFSET from (not centered on) its content's origin
 * (see {@link CLIP_SILHOUETTE_OFFSET}) so the ellipse partially overlaps the
 * content rect and the clip visibly cuts it, rather than the silhouette
 * fully containing the content (which would render identically to the
 * unclipped case and defeat the fixture's purpose). `IDENTITY_TRANSFORM` —
 * pair 2's silhouette below is the one that exercises a non-identity mask
 * source transform.
 */
function clipEllipseSilhouetteNode(
	id: string,
	contentOrigin: { readonly x: number; readonly y: number },
	color: string,
): VectorNode {
	const size = STRESS_NODE_SIZE;
	return {
		id,
		name: `stress clip ellipse silhouette ${id}`,
		geometry: {
			kind: "ellipse",
			bounds: {
				x: contentOrigin.x + CLIP_SILHOUETTE_OFFSET,
				y: contentOrigin.y + CLIP_SILHOUETTE_OFFSET,
				width: size,
				height: size,
			},
		},
		transform: IDENTITY_TRANSFORM,
		// A mask source's own fill/stroke never paints once consumed (see
		// `entities/scene/model/gpu/capability.ts`'s S7 doc comment) — solid and
		// opaque here purely so the node reads sensibly in the layers panel if a
		// developer inspects it before/after release-mask.
		style: { fill: color, stroke: "none", strokeWidth: 0, opacity: 1 },
		visible: true,
		locked: false,
	};
}

/**
 * Builds the small GROUP for clip-mask fixture pair 2 — TWO children (a
 * solid-fill rect and a uniform-STROKE-only rect, positioned to overlap each
 * other by half like {@link overlapFillNode}/{@link overlapStrokeNode}'s own
 * convention) wrapped in a degenerate-geometry group node, mirroring
 * `entities/scene/model/group-commands.ts::createGroupNode`'s exact
 * wrapper-container shape (`kind: "line"` zero-length placeholder geometry,
 * solid-black placeholder style, `IDENTITY_TRANSFORM`) since that helper is
 * private to its own module. Exercises the CLIPPED-stroke replay branch in
 * `shared/gpu/webgpu.ts` (a clip scope containing a stroke draw, not just
 * fills).
 */
function clipGroupNode(
	id: string,
	origin: { readonly x: number; readonly y: number },
	fillColor: string,
	strokeColor: string,
): VectorNode {
	const size = STRESS_NODE_SIZE * 0.6;
	const fillChild: VectorNode = {
		id: `${id}-fill-child`,
		name: "stress clip group fill child",
		geometry: {
			kind: "rect",
			bounds: { x: origin.x, y: origin.y, width: size, height: size },
			cornerRadius: 0,
		},
		transform: IDENTITY_TRANSFORM,
		style: { fill: fillColor, stroke: "none", strokeWidth: 0, opacity: 1 },
		visible: true,
		locked: false,
	};
	const strokeChild: VectorNode = {
		id: `${id}-stroke-child`,
		name: "stress clip group stroke child",
		geometry: {
			kind: "ellipse",
			bounds: {
				x: origin.x + size * 0.4,
				y: origin.y + size * 0.4,
				width: size,
				height: size,
			},
		},
		transform: IDENTITY_TRANSFORM,
		style: {
			fill: "none",
			stroke: strokeColor,
			strokeWidth: 10,
			strokeCap: "round",
			strokeJoin: "round",
			opacity: 1,
		},
		visible: true,
		locked: false,
	};
	return {
		id,
		name: "stress clip group",
		geometry: { kind: "line", start: origin, end: origin },
		transform: IDENTITY_TRANSFORM,
		style: { fill: "#000000", stroke: "#000000", strokeWidth: 0, opacity: 1 },
		visible: true,
		locked: false,
		children: [fillChild, strokeChild],
	};
}

/**
 * Builds a ROTATED rect silhouette node — the MASK SOURCE half of clip-mask
 * fixture pair 2. `rotation: 30` (degrees) exercises a non-identity mask
 * source transform end to end: `display-list.ts`'s clip-scope branch derives
 * the silhouette's `worldTransform` from `matrixFromTransform(maskNode.
 * transform)` composed with the ARTBOARD's own origin — never the content
 * group's ancestor chain — so a bug that accidentally read the CONTENT
 * node's transform instead would show as a silhouette that fails to rotate
 * with its own source. `anchor`/`position` are both set to the rect's own
 * center so the rotation visibly spins the silhouette in place rather than
 * also translating it.
 */
function clipRotatedRectSilhouetteNode(
	id: string,
	groupOrigin: { readonly x: number; readonly y: number },
	color: string,
): VectorNode {
	const size = STRESS_NODE_SIZE * 0.6;
	const center = {
		x: groupOrigin.x + size / 2,
		y: groupOrigin.y + size / 2,
	};
	return {
		id,
		name: `stress clip rotated-rect silhouette ${id}`,
		geometry: {
			kind: "rect",
			bounds: {
				x: groupOrigin.x - size * 0.1,
				y: groupOrigin.y - size * 0.1,
				width: size * 1.2,
				height: size * 1.2,
			},
			cornerRadius: 0,
		},
		transform: {
			// Rotate IN PLACE about the silhouette's center: `matrixFromTransform`
			// maps the anchor point to `position + anchor` (position is an
			// ADDITIONAL translation on top of the anchor-relative rotation), so an
			// in-place spin needs `position: {0,0}` — setting `position: center`
			// alongside `anchor: center` would shift the silhouette by a full
			// `center` offset, parking the clip region far away from the pair's
			// content and clipping everything to nothing.
			position: { x: 0, y: 0 },
			rotation: 30,
			scale: { x: 1, y: 1 },
			anchor: center,
		},
		style: { fill: color, stroke: "none", strokeWidth: 0, opacity: 1 },
		visible: true,
		locked: false,
	};
}

/**
 * Builds a gradient-filled rect node — the CONTENT half of clip-mask fixture
 * pair 3. Mirrors `stressGeometryNode`'s `"linear-gradient"` case's
 * authoring pattern exactly (`style.fills`, never the legacy `style.fill`).
 */
function clipGradientContentNode(
	id: string,
	origin: { readonly x: number; readonly y: number },
	color: string,
	secondaryColor: string,
): VectorNode {
	const size = STRESS_NODE_SIZE;
	return {
		id,
		name: `stress clip gradient content ${id}`,
		geometry: {
			kind: "rect",
			bounds: { x: origin.x, y: origin.y, width: size, height: size },
			cornerRadius: 0,
		},
		transform: IDENTITY_TRANSFORM,
		style: {
			fill: "none",
			stroke: "none",
			strokeWidth: 0,
			opacity: 1,
			fills: [
				{
					kind: "linear-gradient",
					from: { x: origin.x, y: origin.y },
					to: { x: origin.x + size, y: origin.y + size },
					stops: [
						{ offset: 0, color },
						{ offset: 1, color: secondaryColor },
					],
				},
			],
		},
		visible: true,
		locked: false,
	};
}

/**
 * Builds a closed-path silhouette node — the MASK SOURCE half of clip-mask
 * fixture pair 3 (a simple hexagon), the one fixture exercising a `"path"`
 * geometry silhouette (rather than pair 1's ellipse or pair 2's rect) —
 * `resolveSceneMaskPlan`'s `SUPPORTED_MASK_SOURCE_KINDS` admits `"path"`
 * alongside `"rect"`/`"ellipse"`/`"polygon"`/`"star"`, and this fixture is
 * the one that actually exercises it. Reuses {@link straightBezierShape}
 * (the SAME straight-zero-tangent-vertices helper every other stress path
 * node already builds its geometry from) rather than a separate path-
 * building utility.
 */
function clipPathSilhouetteNode(
	id: string,
	contentOrigin: { readonly x: number; readonly y: number },
	color: string,
): VectorNode {
	const size = STRESS_NODE_SIZE;
	const cx = contentOrigin.x + size / 2;
	const cy = contentOrigin.y + size / 2;
	const radius = size * 0.55;
	const hexagonPoint = (index: number): [number, number] => {
		const angle = (Math.PI / 3) * index - Math.PI / 6;
		return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
	};
	const vertices: [number, number][] = [0, 1, 2, 3, 4, 5].map(hexagonPoint);
	return {
		id,
		name: `stress clip path silhouette ${id}`,
		geometry: {
			kind: "path",
			shape: straightBezierShape(vertices, true),
		},
		transform: IDENTITY_TRANSFORM,
		style: { fill: color, stroke: "none", strokeWidth: 0, opacity: 1 },
		visible: true,
		locked: false,
	};
}

/**
 * Builds the E1 S7 fixture commands: THREE clip-mask pairs laid out along X
 * (mirroring {@link s6BlendFixtureCommands}'s row layout convention exactly),
 * each composed of a CONTENT append, a MASK SOURCE append, and a
 * `createUseNodeAsMaskCommand` relation authored the SAME way the product's
 * own "use as mask" UI does (`features/structure-actions/model/mask-
 * actions.ts::buildUseAsMaskCommand` calls this identical entities-layer
 * command) — never a hand-rolled `maskRelations` metadata literal, so this
 * fixture stays honest to how a real document acquires a clip relation:
 *
 * 1. A solid rect CONTENT clipped by an ELLIPSE silhouette, partially
 *    overlapping so the clip visibly cuts (exercises the baseline
 *    rect-content/ellipse-source clip path).
 * 2. A small GROUP (fill child + stroke-only child) clipped by a ROTATED
 *    rect silhouette (exercises both the clipped-STROKE replay branch in
 *    `shared/gpu/webgpu.ts` and a non-identity mask-source transform in
 *    `display-list.ts`'s clip-scope branch).
 * 3. A gradient-filled rect CONTENT clipped by a PATH-geometry (hexagon)
 *    silhouette (exercises a `"path"`-kind silhouette and a gradient-paint
 *    content leaf inside an open clip scope).
 *
 * Returns commands, not bare nodes (unlike {@link overlapPairNodes}):
 * `createUseNodeAsMaskCommand`'s own `run` reads the draft's ALREADY-APPENDED
 * mask/content nodes (`findDraftLayerByNodeId`/`editableDraftNode`), so it
 * must run strictly after both append commands for the SAME pair, in the
 * SAME composed draft — mirroring {@link s5FixtureCommands}'s identical
 * "append first, relate second" composition. `topMargin` places this fixture
 * in its own row, below {@link s6BlendFixtureCommands}'s band (all four
 * fixed-origin fixture bands share overlapping X ranges, so they would
 * collide if placed at the same Y — see that function's doc comment for the
 * identical constraint).
 */
function s7ClipFixtureCommands(
	artboardId: string,
	topMargin: number,
): readonly SceneCommand[] {
	const rowOrigin = {
		x: STRESS_CELL_SIZE / 2,
		y: topMargin + STRESS_CELL_SIZE / 2,
	};
	const pairOrigin = (
		pairIndex: number,
	): { readonly x: number; readonly y: number } => ({
		x: rowOrigin.x + pairIndex * STRESS_CELL_SIZE,
		y: rowOrigin.y,
	});

	// Pair 1: rect content / ellipse silhouette.
	const pair1Origin = pairOrigin(0);
	const pair1ContentId = `${artboardId}-s7-ellipse-content`;
	const pair1SourceId = `${artboardId}-s7-ellipse-source`;
	const pair1Content = clipContentRectNode(
		pair1ContentId,
		pair1Origin,
		STRESS_PALETTE[0],
	);
	const pair1Source = clipEllipseSilhouetteNode(
		pair1SourceId,
		pair1Origin,
		STRESS_PALETTE[1],
	);

	// Pair 2: group (fill + stroke children) / rotated rect silhouette.
	const pair2Origin = pairOrigin(1);
	const pair2ContentId = `${artboardId}-s7-group-content`;
	const pair2SourceId = `${artboardId}-s7-rotated-rect-source`;
	const pair2Content = clipGroupNode(
		pair2ContentId,
		pair2Origin,
		STRESS_PALETTE[2],
		STRESS_PALETTE[3],
	);
	const pair2Source = clipRotatedRectSilhouetteNode(
		pair2SourceId,
		pair2Origin,
		STRESS_PALETTE[4],
	);

	// Pair 3: gradient rect content / path (hexagon) silhouette.
	const pair3Origin = pairOrigin(2);
	const pair3ContentId = `${artboardId}-s7-gradient-content`;
	const pair3SourceId = `${artboardId}-s7-path-source`;
	const pair3Content = clipGradientContentNode(
		pair3ContentId,
		pair3Origin,
		STRESS_PALETTE[0],
		STRESS_PALETTE[3],
	);
	const pair3Source = clipPathSilhouetteNode(
		pair3SourceId,
		pair3Origin,
		STRESS_PALETTE[1],
	);

	const appendCommands: readonly SceneCommand[] = [
		createAppendNodeCommand(
			{ ...pair1Content, artboardId },
			{ label: "Add GPU stress clip-mask content" },
		),
		createAppendNodeCommand(
			{ ...pair1Source, artboardId },
			{ label: "Add GPU stress clip-mask source" },
		),
		createAppendNodeCommand(
			{ ...pair2Content, artboardId },
			{ label: "Add GPU stress clip-mask content" },
		),
		createAppendNodeCommand(
			{ ...pair2Source, artboardId },
			{ label: "Add GPU stress clip-mask source" },
		),
		createAppendNodeCommand(
			{ ...pair3Content, artboardId },
			{ label: "Add GPU stress clip-mask content" },
		),
		createAppendNodeCommand(
			{ ...pair3Source, artboardId },
			{ label: "Add GPU stress clip-mask source" },
		),
	];
	const relationCommands: readonly SceneCommand[] = [
		createUseNodeAsMaskCommand(pair1SourceId, [pair1ContentId], {
			label: "Use as mask (GPU stress clip fixture)",
		}),
		createUseNodeAsMaskCommand(pair2SourceId, [pair2ContentId], {
			label: "Use as mask (GPU stress clip fixture)",
		}),
		createUseNodeAsMaskCommand(pair3SourceId, [pair3ContentId], {
			label: "Use as mask (GPU stress clip fixture)",
		}),
	];
	return [...appendCommands, ...relationCommands];
}

/**
 * Reserved top-margin band (world units) for {@link s8DashFixtureCommands}'s
 * three fixed-origin dashed-stroke fixtures — one `STRESS_CELL_SIZE` row,
 * matching {@link S5_FIXTURE_MARGIN}/{@link S6_FIXTURE_MARGIN}/
 * {@link S7_FIXTURE_MARGIN}'s identical dedicated-band precedent.
 */
const S8_FIXTURE_MARGIN = STRESS_CELL_SIZE;

/**
 * Builds a dashed rect-outline node — E1 S8 fixture 1 (butt-cap, even-length
 * pattern, no offset). `fill: "none"` so only the dashed stroke paints,
 * matching every other stroke-only stress fixture's authoring pattern (see
 * `stressProfileStrokeNode`).
 */
function s8DashedRectNode(
	id: string,
	origin: { readonly x: number; readonly y: number },
	color: string,
): VectorNode {
	const size = STRESS_NODE_SIZE;
	return {
		id,
		name: `stress dash rect ${id}`,
		geometry: {
			kind: "rect",
			bounds: { x: origin.x, y: origin.y, width: size, height: size },
			cornerRadius: 0,
		},
		transform: IDENTITY_TRANSFORM,
		style: {
			fill: "none",
			stroke: color,
			strokeWidth: 4,
			opacity: 1,
			strokeDash: [12, 6],
			strokeCap: "butt",
		},
		visible: true,
		locked: false,
	};
}

/**
 * Builds a dashed, ROTATED rect-outline node — E1 S8 fixture 2 (butt-cap, a
 * 4-entry even-length pattern, a non-identity in-place rotation). This keeps
 * the non-identity-transform coverage the original pentagon exercised while
 * staying on the native-`<rect>` fast path; the straight `path` branch is now
 * covered separately by {@link s8DashedStraightPathNode}. `anchor`/`position`
 * follow
 * {@link clipRotatedRectSilhouetteNode}'s IN-PLACE rotation authoring
 * pattern exactly: `position: {0,0}` plus `anchor: <rect center>` spins the
 * rect about its own center instead of also translating it
 * (`matrixFromTransform` maps the anchor to `position + anchor` — setting
 * `position` to the center too would double-apply the offset).
 */
function s8DashedRotatedRectNode(
	id: string,
	origin: { readonly x: number; readonly y: number },
	color: string,
): VectorNode {
	const size = STRESS_NODE_SIZE;
	const center = { x: origin.x + size / 2, y: origin.y + size / 2 };
	return {
		id,
		name: `stress dash rotated rect ${id}`,
		geometry: {
			kind: "rect",
			bounds: { x: origin.x, y: origin.y, width: size, height: size },
			cornerRadius: 0,
		},
		transform: {
			position: { x: 0, y: 0 },
			rotation: 25,
			scale: { x: 1, y: 1 },
			anchor: center,
		},
		style: {
			fill: "none",
			stroke: color,
			strokeWidth: 6,
			opacity: 1,
			strokeDash: [4, 4, 12, 4],
			strokeCap: "butt",
		},
		visible: true,
		locked: false,
	};
}

/**
 * Builds a dashed rect-outline node with a nonzero `strokeDashoffset` — E1
 * S8 fixture 3 (butt-cap, a 2-entry pattern, phase offset `7`, identity
 * transform). This remains a rect so the baseline S8 phase-offset case keeps
 * diffing against the native-`<rect>` reference path; the post-S8 straight
 * `path` admission gets its own fixture below.
 */
function s8DashedOffsetRectNode(
	id: string,
	origin: { readonly x: number; readonly y: number },
	color: string,
): VectorNode {
	const size = STRESS_NODE_SIZE;
	return {
		id,
		name: `stress dash offset rect ${id}`,
		geometry: {
			kind: "rect",
			bounds: { x: origin.x, y: origin.y, width: size, height: size },
			cornerRadius: 0,
		},
		transform: IDENTITY_TRANSFORM,
		style: {
			fill: "none",
			stroke: color,
			strokeWidth: 4,
			opacity: 1,
			strokeDash: [10, 5],
			strokeDashoffset: 7,
			strokeCap: "butt",
		},
		visible: true,
		locked: false,
	};
}

/**
 * Builds a dashed, straight closed `path` node — the post-S8 fixture proving
 * the SVG path renderer now honors authored butt caps/joins and therefore can
 * serve as a clean reference for the GPU dash discard path. The geometry uses
 * literal zero-tangent vertices so it passes `isStraightSegmentGeometry` for
 * the same reason generated stress-path nodes do.
 */
function s8DashedStraightPathNode(
	id: string,
	origin: { readonly x: number; readonly y: number },
	color: string,
): VectorNode {
	const size = STRESS_NODE_SIZE;
	const center = { x: origin.x + size / 2, y: origin.y + size / 2 };
	const radius = size * 0.5;
	const vertices: [number, number][] = [0, 1, 2, 3, 4].map((index) => {
		const angle = (Math.PI * 2 * index) / 5 - Math.PI / 2;
		return [
			center.x + radius * Math.cos(angle),
			center.y + radius * Math.sin(angle),
		] as [number, number];
	});
	return {
		id,
		name: `stress dash straight path ${id}`,
		geometry: {
			kind: "path",
			shape: straightBezierShape(vertices, true),
		},
		transform: IDENTITY_TRANSFORM,
		style: {
			fill: "none",
			stroke: color,
			strokeWidth: 5,
			opacity: 1,
			strokeDash: [8, 4, 2, 4],
			strokeDashoffset: 3,
			strokeCap: "butt",
			strokeJoin: "miter",
		},
		visible: true,
		locked: false,
	};
}

/**
 * Builds the E1 S8 fixture commands: FOUR standalone dashed-stroke nodes laid
 * out along X (mirroring {@link s6BlendFixtureCommands}'s/
 * {@link s7ClipFixtureCommands}'s row layout convention exactly):
 *
 * 1. A dashed RECT outline (`strokeDash: [12, 6]`, butt cap, no rotation —
 *    the baseline axis-aligned case).
 * 2. A dashed, ROTATED rect outline (`strokeDash: [4, 4, 12, 4]`, a
 *    non-identity transform exercising the WORLD-space arc-length
 *    computation under rotation — see `stroke-mesh.ts`'s
 *    `worldSegmentsForRing` doc comment for why arc length must be measured
 *    POST-transform).
 * 3. A dashed RECT with a nonzero `strokeDashoffset` (`strokeDash: [10, 5]`,
 *    offset `7`, identity transform), exercising the phase-offset uniform.
 * 4. A dashed STRAIGHT PATH (`strokeDash: [8, 4, 2, 4]`, offset `3`) that
 *    exercises the post-S8 SVG path cap/join parity fix and the widened
 *    `isDashableGeometry` path branch.
 *
 * `topMargin` places this fixture in its own row, below
 * {@link s7ClipFixtureCommands}'s band (all fixed-origin fixture bands share
 * overlapping X ranges, so they would collide at the same Y — see that
 * function's doc comment for the identical constraint).
 */
function s8DashFixtureCommands(
	artboardId: string,
	topMargin: number,
): readonly SceneCommand[] {
	const rowOrigin = {
		x: STRESS_CELL_SIZE / 2,
		y: topMargin + STRESS_CELL_SIZE / 2,
	};
	const fixtureOrigin = (
		index: number,
	): { readonly x: number; readonly y: number } => ({
		x: rowOrigin.x + index * STRESS_CELL_SIZE,
		y: rowOrigin.y,
	});

	const rectNode = s8DashedRectNode(
		`${artboardId}-s8-dash-rect`,
		fixtureOrigin(0),
		STRESS_PALETTE[0],
	);
	const rotatedRectNode = s8DashedRotatedRectNode(
		`${artboardId}-s8-dash-rotated-rect`,
		fixtureOrigin(1),
		STRESS_PALETTE[1],
	);
	const offsetRectNode = s8DashedOffsetRectNode(
		`${artboardId}-s8-dash-offset-rect`,
		fixtureOrigin(2),
		STRESS_PALETTE[2],
	);
	const straightPathNode = s8DashedStraightPathNode(
		`${artboardId}-s8-dash-straight-path`,
		fixtureOrigin(3),
		STRESS_PALETTE[3],
	);

	return [
		createAppendNodeCommand(
			{ ...rectNode, artboardId },
			{ label: "Add GPU stress dash fixture" },
		),
		createAppendNodeCommand(
			{ ...rotatedRectNode, artboardId },
			{ label: "Add GPU stress dash fixture" },
		),
		createAppendNodeCommand(
			{ ...offsetRectNode, artboardId },
			{ label: "Add GPU stress dash fixture" },
		),
		createAppendNodeCommand(
			{ ...straightPathNode, artboardId },
			{ label: "Add GPU stress dash fixture" },
		),
	];
}

/**
 * Deterministic grid+jitter placement for `count` nodes inside a
 * `width`×`height` artboard, leaving a `STRESS_CELL_SIZE` margin on every
 * edge so cover-pass geometry never spills past the artboard bounds.
 * `topMargin` (default 0, used only by {@link buildStressSceneCommand} to
 * reserve a band for {@link overlapPairNodes}) shifts every origin's Y down
 * by that many world units without otherwise changing the column/row/
 * truncation math, so passing `0` reproduces the exact PRE-existing layout.
 */
function stressGridOrigins(
	count: number,
	width: number,
	height: number,
	random: () => number,
	topMargin = 0,
): { readonly x: number; readonly y: number }[] {
	const columns = Math.max(
		1,
		Math.floor((width - STRESS_CELL_SIZE) / STRESS_CELL_SIZE),
	);
	const origins: { readonly x: number; readonly y: number }[] = [];
	for (let index = 0; index < count; index += 1) {
		const column = index % columns;
		const row = Math.floor(index / columns);
		const baseX = STRESS_CELL_SIZE / 2 + column * STRESS_CELL_SIZE;
		const baseY = topMargin + STRESS_CELL_SIZE / 2 + row * STRESS_CELL_SIZE;
		if (baseY > topMargin + height - STRESS_CELL_SIZE / 2) break;
		origins.push({
			x: baseX + (random() * 2 - 1) * STRESS_JITTER_RANGE,
			y: baseY + (random() * 2 - 1) * STRESS_JITTER_RANGE,
		});
	}
	return origins;
}

/** Next free `gpu-stress-N` artboard id/name suffix, so repeated runs after an undo never collide with a same-session leftover. */
function nextStressArtboardSuffix(document: SceneDocument): number {
	const existing = selectAllArtboards(document).filter((artboard) =>
		artboard.id.startsWith(STRESS_ARTBOARD_ID_PREFIX),
	);
	return existing.length;
}

/** Rightmost extent of the document's existing pasteboard content, so the stress artboard is placed clear of authored content. */
function pasteboardRightEdge(document: SceneDocument): number {
	return selectAllArtboards(document).reduce((max, artboard) => {
		const x = artboard.position?.x ?? 0;
		return Math.max(max, x + artboard.width);
	}, 0);
}

/**
 * Reserved top-margin band (world units) added to the stress artboard's
 * height, exclusively for {@link overlapPairNodes}'s fixed-origin overlap
 * pairs — one `STRESS_CELL_SIZE` row, so the jittered grid
 * {@link stressGridOrigins} places starting just below it can never collide
 * with the overlap fixture regardless of `count`.
 */
const OVERLAP_FIXTURE_MARGIN = STRESS_CELL_SIZE;

/**
 * Builds the single composite {@link SceneCommand} the generator applies.
 * Composes `createAddArtboardCommand`'s `run` (adds the artboard) with one
 * `createAppendNodeCommand` `run` per generated node, all inside ONE outer
 * `run` closure — `SceneCommand.run` is a plain `(draft) => void`, so calling
 * several existing commands' `run` functions against the SAME draft, in
 * order, is the supported way to compose a multi-step edit into a single
 * `useSceneStore.apply` call (one Immer patch set, one undo entry). The
 * artboard MUST run first: `createAppendNodeCommand` resolves each node's
 * `artboardId` via `findArtboardValue(draft, node.artboardId)` (see
 * `node-commands.ts::nodeWithResolvedInsertionArtboard`), which only
 * succeeds once the artboard already exists in the SAME draft.
 *
 * The artboard's height grows by {@link OVERLAP_FIXTURE_MARGIN} (a post-S4
 * review-fix addition — see `docs/gpu-canvas-convergence-e1-plan.md`'s
 * review-findings addendum) to host {@link overlapPairNodes}'s fixed-origin
 * cross-node paint-order smoke fixture in a dedicated band above the
 * jittered grid, plus {@link S5_FIXTURE_MARGIN} (E1 S5), {@link
 * S6_FIXTURE_MARGIN} (E1 S6), {@link S7_FIXTURE_MARGIN} (E1 S7), and {@link
 * S8_FIXTURE_MARGIN} (E1 S8) for {@link s5FixtureCommands}'s, {@link
 * s6BlendFixtureCommands}'s, {@link s7ClipFixtureCommands}'s, and {@link
 * s8DashFixtureCommands}'s own dedicated bands stacked below it, in that
 * order — the jittered grid is itself shifted down by the combined
 * `totalFixtureMargin` below — every OTHER aspect of the grid's layout
 * (column count, jitter, truncation at `count`) is unchanged from before
 * these fixtures existed.
 */
function buildStressSceneCommand(
	document: SceneDocument,
	count: number,
): SceneCommand {
	const suffix = nextStressArtboardSuffix(document);
	const artboardId = `${STRESS_ARTBOARD_ID_PREFIX}${suffix}`;
	const position = {
		x: pasteboardRightEdge(document) + STRESS_ARTBOARD_GAP,
		y: 0,
	};
	// Five fixed-origin fixture bands stack vertically (overlap-pair band,
	// then S5's band, then S6's band, then S7's band, then S8's band directly
	// below that) — see `s5FixtureCommands`'s/`s6BlendFixtureCommands`'s/
	// `s7ClipFixtureCommands`'s/`s8DashFixtureCommands`'s doc comments for why
	// they cannot share one row (overlapping X ranges).
	const totalFixtureMargin =
		OVERLAP_FIXTURE_MARGIN +
		S5_FIXTURE_MARGIN +
		S6_FIXTURE_MARGIN +
		S7_FIXTURE_MARGIN +
		S8_FIXTURE_MARGIN;
	const artboard: Artboard = {
		id: artboardId,
		name: `GPU Stress ${suffix}`,
		position,
		width: STRESS_ARTBOARD_WIDTH,
		height: STRESS_ARTBOARD_HEIGHT + totalFixtureMargin,
		background: "#12141a",
		fills: [
			{
				kind: "image-reference",
				href: STRESS_BACKGROUND_JPEG_DATA_URL,
				fit: "crop",
			},
		],
		fps: 30,
		durationFrames: 180,
	};
	const addArtboard = createAddArtboardCommand(artboard, {
		label: "Add GPU stress artboard",
		select: false,
	});

	const random = createSeededRandom(STRESS_LAYOUT_SEED + suffix);
	const origins = stressGridOrigins(
		count,
		STRESS_ARTBOARD_WIDTH,
		STRESS_ARTBOARD_HEIGHT,
		random,
		totalFixtureMargin,
	);
	const profileStrokeCount = Math.max(
		1,
		Math.round(origins.length * STRESS_PROFILE_STROKE_FRACTION),
	);
	const gridNodeCommands: SceneCommand[] = origins.map((origin, index) => {
		const nodeId = `${artboardId}-node-${index}`;
		const color = STRESS_PALETTE[index % STRESS_PALETTE.length];
		const secondaryColor = STRESS_PALETTE[(index + 1) % STRESS_PALETTE.length];
		const node: VectorNode =
			index < profileStrokeCount
				? stressProfileStrokeNode(nodeId, origin, color, random)
				: stressGeometryNode(
						nodeId,
						STRESS_GEOMETRY_KINDS[
							(index - profileStrokeCount) % STRESS_GEOMETRY_KINDS.length
						],
						origin,
						color,
						secondaryColor,
						random,
					);
		return createAppendNodeCommand(
			{ ...node, artboardId },
			{ label: "Add GPU stress node" },
		);
	});
	const overlapNodeCommands: SceneCommand[] = overlapPairNodes(artboardId).map(
		(node) =>
			createAppendNodeCommand(
				{ ...node, artboardId },
				{ label: "Add GPU stress overlap-pair node" },
			),
	);
	const s5Commands = s5FixtureCommands(artboardId, OVERLAP_FIXTURE_MARGIN);
	const s6Commands = s6BlendFixtureCommands(
		artboardId,
		OVERLAP_FIXTURE_MARGIN + S5_FIXTURE_MARGIN,
	);
	const s7Commands = s7ClipFixtureCommands(
		artboardId,
		OVERLAP_FIXTURE_MARGIN + S5_FIXTURE_MARGIN + S6_FIXTURE_MARGIN,
	);
	const s8Commands = s8DashFixtureCommands(
		artboardId,
		OVERLAP_FIXTURE_MARGIN +
			S5_FIXTURE_MARGIN +
			S6_FIXTURE_MARGIN +
			S7_FIXTURE_MARGIN,
	);
	// `overlapPairNodes` already returns its 4 nodes in "under" then "over"
	// order per pair (see its doc comment); appending them ahead of the grid
	// here just keeps them earliest in the artboard's overall document order,
	// which is irrelevant to the smoke test itself — only each PAIR's own
	// relative under/over order matters, and that is fixed by the source
	// array's order, not by where this slice sits relative to the grid.
	// `s7Commands` mixes append AND relation commands (unlike every other
	// fixture list here) — `s7ClipFixtureCommands`'s own returned array
	// order already guarantees each pair's relation command runs after that
	// SAME pair's two append commands (see that function's doc comment), so
	// no additional interleaving with `gridNodeCommands`/other fixtures is
	// needed; this whole array just needs to preserve `s7Commands`'
	// INTERNAL order, which spreading it as one contiguous block does.
	// `s8Commands` is append-only (no mask relations), like S5/S6.
	const appendNodeCommands: readonly SceneCommand[] = [
		...overlapNodeCommands,
		...s5Commands,
		...s6Commands,
		...s7Commands,
		...s8Commands,
		...gridNodeCommands,
	];

	return {
		type: "gpu-stress/add-scene",
		label: "Add GPU stress-test artboard",
		run: (draft) => {
			addArtboard.run(draft);
			for (const command of appendNodeCommands) command.run(draft);
		},
	};
}

/**
 * Generates and commits one GPU stress-test artboard through the scene
 * command bus (single undo entry — see {@link buildStressSceneCommand}'s doc
 * comment). Refuses (console warning, no-op) when the document already has an
 * artboard whose id starts with `gpu-stress-` — idempotence WITHOUT any
 * cleanup logic of its own; the existing artboard stays until the user
 * Cmd+Z's it or deletes it like any other authored content. `count` defaults
 * to `STRESS_NODE_COUNT`.
 */
export function generateGpuStressScene(
	count: number = STRESS_NODE_COUNT,
): void {
	const document = useSceneStore.getState().document;
	const alreadyGenerated = selectAllArtboards(document).some((artboard) =>
		artboard.id.startsWith(STRESS_ARTBOARD_ID_PREFIX),
	);
	if (alreadyGenerated) {
		console.warn(
			"[gpu-stress] A GPU stress artboard already exists in this document — undo (Cmd+Z) it before generating another.",
		);
		return;
	}
	const command = buildStressSceneCommand(document, Math.max(1, count));
	useSceneStore.getState().apply(command);
}

const GPU_STRESS_GLOBAL_KEY = "__vmaGpuStress";

/**
 * Registers `globalThis.__vmaGpuStress` (dev builds only — `import.meta.env.DEV`
 * gate). Idempotent: calling this twice just reassigns the same function
 * reference, so `GpuSceneCanvas` can safely call it from an effect that may
 * re-run in strict-mode double-invoke. Returns an unregister callback mirroring
 * every other effect-owned global in this codebase's convention.
 */
export function registerGpuStressGlobal(): () => void {
	if (!import.meta.env.DEV) return () => {};
	const globalTarget = globalThis as Record<string, unknown>;
	globalTarget[GPU_STRESS_GLOBAL_KEY] = generateGpuStressScene;
	return () => {
		if (globalTarget[GPU_STRESS_GLOBAL_KEY] === generateGpuStressScene) {
			delete globalTarget[GPU_STRESS_GLOBAL_KEY];
		}
	};
}
