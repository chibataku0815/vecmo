/**
 * Throwaway, dev-only fixture generator for the transparent-background alpha
 * regression QA harness (`qa/alpha-probe.html`/`qa/alpha-probe.ts`). Not part
 * of the product build.
 *
 * Reuses the exact failing scene's geometry and GPU Look chain — the two-star
 * blur -> wave-warp -> colorama -> bend-warp recipe authored in
 * `scripts/generate-liquid-gradient-piece.ts` (colorama stops/payloads copied
 * verbatim from that file's `VIVID_COLORAMA_STOPS`/`BLUR_PAYLOAD`/
 * `WAVE_WARP_PAYLOAD`/`BEND_WARP_PAYLOAD`) — rather than hand-authoring new
 * geometry. That script cannot be imported directly: it is a one-shot CLI
 * with top-level side effects (writes to `artifacts/` on import), so the
 * geometry/payload constants are duplicated here instead.
 *
 * Every variant below is identical in artboard size/fps/duration and node
 * geometry; only the artboard's background/fills and the Look graph's node
 * set differ, isolating exactly one variable per fixture. Motion is
 * deliberately omitted (empty tracks) — frame 0 already samples every look
 * node's static payload (colorama `phase` is pinned to 0 by design in the
 * source piece; see that file's TRAP comment on why it must never animate),
 * so a motion document contributes no variance to the alpha bug under test.
 *
 * Emits one `{ scene, motion }` JSON pair per variant to
 * `qa/fixtures/alpha-probe/<variant>.json` for `qa/alpha-probe.ts` to import
 * statically.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { MotionDocument } from "@/entities/motion/model/types";
import {
	type LookGraph,
	lookGraphPortId,
	normalizeLookGraph,
} from "@/entities/scene/model/look-graph";
import type {
	Paint,
	SceneDocument,
	VectorNode,
} from "@/entities/scene/model/types";
import type { AePoint, AeShape } from "@/shared/glammer/ae-shape";

const outputDirectory = path.join(process.cwd(), "qa/fixtures/alpha-probe");

const ARTBOARD_ID = "alpha-probe-artboard";
const ARTBOARD_WIDTH = 1280;
const ARTBOARD_HEIGHT = 720;
const ARTBOARD_FPS = 30;
const DURATION_FRAMES = 360;

/** Same frame for every capture (STEP 3 requirement) — see the file doc comment for why frame 0 is sufficient. */
export const PROBE_FRAME = 0;

const identityTransform = {
	position: { x: 0, y: 0 },
	rotation: 0,
	scale: { x: 1, y: 1 },
	anchor: { x: 0, y: 0 },
} as const;

// --- Geometry: verbatim copy of `scripts/generate-liquid-gradient-piece.ts`'s
// `starPath`/`STARS`/`starNode` (v31+), the exact failing scene's source shapes.

const starPath = (arms: number, outerR: number, innerR: number): AeShape => {
	const pointCount = arms * 2;
	const vertices: AePoint[] = [];
	for (let i = 0; i < pointCount; i += 1) {
		const angleDeg = -90 + (360 * i) / pointCount;
		const radius = i % 2 === 0 ? outerR : innerR;
		const theta = (angleDeg * Math.PI) / 180;
		vertices.push([radius * Math.cos(theta), radius * Math.sin(theta)]);
	}
	const zero: AePoint = [0, 0];
	return {
		type: "Shape",
		closed: true,
		vertices,
		inTangents: vertices.map(() => zero),
		outTangents: vertices.map(() => zero),
	};
};

type StarSpec = {
	readonly id: string;
	readonly arms: number;
	readonly outerR: number;
	readonly innerR: number;
	readonly cx: number;
	readonly cy: number;
};

const STARS: readonly StarSpec[] = [
	{ id: "star-a", arms: 5, outerR: 460, innerR: 150, cx: 230, cy: 140 },
	{ id: "star-b", arms: 5, outerR: 460, innerR: 150, cx: 1050, cy: 580 },
];

const starNodeId = (star: StarSpec): string => `${star.id}-node`;

const starNode = (star: StarSpec): VectorNode => ({
	id: starNodeId(star),
	name: star.id,
	geometry: {
		kind: "path",
		shape: starPath(star.arms, star.outerR, star.innerR),
	},
	transform: { ...identityTransform, position: { x: star.cx, y: star.cy } },
	style: {
		fill: "none",
		stroke: "none",
		strokeWidth: 0,
		opacity: 1,
		fills: [{ kind: "solid", color: "#ffffff" }],
	},
	visible: true,
	locked: false,
});

const STAR_NODES: readonly VectorNode[] = STARS.map((star) => starNode(star));

// --- Look graph payloads: verbatim copy of the source piece's
// `BLUR_PAYLOAD`/`WAVE_WARP_PAYLOAD`/`VIVID_COLORAMA_STOPS`/`BEND_WARP_PAYLOAD`.

const BLUR_PAYLOAD = { kind: "blur" as const, radius: 60, radiusY: 60 };

const WAVE_WARP_PAYLOAD = {
	kind: "wave-warp" as const,
	waveType: "semicircle" as const,
	height: 150,
	width: 380,
	direction: 35,
	phase: 0,
};

const VIVID_COLORAMA_STOPS = [
	{ offset: 0, color: "#05060f" },
	{ offset: 0.12, color: "#1b2fd6" },
	{ offset: 0.26, color: "#4a6cff" },
	{ offset: 0.4, color: "#8f5fe8" },
	{ offset: 0.55, color: "#d95bd0" },
	{ offset: 0.68, color: "#ff9ec4" },
	{ offset: 0.8, color: "#ffe9a8" },
	{ offset: 0.9, color: "#fff8e0" },
	{ offset: 0.97, color: "#0a0a2a" },
];

const BEND_WARP_PAYLOAD = {
	kind: "bend-warp" as const,
	bend: 0.45,
	distortionH: 0.7,
	distortionV: 0,
	scale: 1.6,
};

const edge = (fromNode: string, toNode: string) => ({
	from: {
		nodeId: fromNode,
		portId: lookGraphPortId(fromNode, "output", "image"),
	},
	to: { nodeId: toNode, portId: lookGraphPortId(toNode, "input", "image") },
});

const buildOrThrow = (
	label: string,
	spec: Parameters<typeof normalizeLookGraph>[0],
): LookGraph => {
	const graph = normalizeLookGraph(spec);
	if (!graph) throw new Error(`alpha-probe Look graph "${label}" is invalid.`);
	return graph;
};

/** V1/V5/V6: full blur -> wave-warp -> colorama(alpha-input) -> bend-warp chain — the exact failing recipe. */
const buildFullLookGraph = (): LookGraph =>
	buildOrThrow("full", {
		nodes: [
			{ id: "source", kind: "source" },
			{ id: "blur", kind: "blur", payload: BLUR_PAYLOAD },
			{ id: "wave-warp", kind: "wave-warp", payload: WAVE_WARP_PAYLOAD },
			{
				id: "colorama",
				kind: "colorama",
				payload: {
					kind: "colorama",
					stops: VIVID_COLORAMA_STOPS,
					phase: 0,
					repetitions: 1,
					inputPhase: "alpha",
					mix: 1,
				},
			},
			{ id: "bend-warp", kind: "bend-warp", payload: BEND_WARP_PAYLOAD },
			{ id: "output", kind: "output" },
		],
		edges: [
			edge("source", "blur"),
			edge("blur", "wave-warp"),
			edge("wave-warp", "colorama"),
			edge("colorama", "bend-warp"),
			edge("bend-warp", "output"),
		],
		outputNodeId: "output",
	});

/** V2 control: same chain with the colorama node removed and its neighbours rewired directly. */
const buildControlLookGraph = (): LookGraph =>
	buildOrThrow("control-no-colorama", {
		nodes: [
			{ id: "source", kind: "source" },
			{ id: "blur", kind: "blur", payload: BLUR_PAYLOAD },
			{ id: "wave-warp", kind: "wave-warp", payload: WAVE_WARP_PAYLOAD },
			{ id: "bend-warp", kind: "bend-warp", payload: BEND_WARP_PAYLOAD },
			{ id: "output", kind: "output" },
		],
		edges: [
			edge("source", "blur"),
			edge("blur", "wave-warp"),
			edge("wave-warp", "bend-warp"),
			edge("bend-warp", "output"),
		],
		outputNodeId: "output",
	});

/** V4: source -> blur -> output only. */
const buildBlurOnlyLookGraph = (): LookGraph =>
	buildOrThrow("blur-only", {
		nodes: [
			{ id: "source", kind: "source" },
			{ id: "blur", kind: "blur", payload: BLUR_PAYLOAD },
			{ id: "output", kind: "output" },
		],
		edges: [edge("source", "blur"), edge("blur", "output")],
		outputNodeId: "output",
	});

/**
 * V7: source -> wave-warp(height: 0) -> output. `height` is wave-warp's
 * displacement amplitude (see `WaveWarpParams.height`'s own doc comment in
 * `src/shared/gpu-lens/surface.ts`); at `height: 0` the UV remap is the
 * identity (every sampled offset collapses to 0 regardless of `width`/
 * `direction`/`phase`), so this is a real `GPU_RASTER_KINDS` node — the
 * "gpu-raster" completedPassId and the full source->GPU-surface->composite
 * path both run — with a geometrically-inert transform, isolating whatever
 * the full-frame GPU composite step itself contributes to the alpha channel
 * from any node's own alpha-changing behaviour (blur's spread, colorama's
 * forced opacity, etc).
 */
const buildGpuIdentityLookGraph = (): LookGraph =>
	buildOrThrow("gpu-identity", {
		nodes: [
			{ id: "source", kind: "source" },
			{
				id: "wave-warp",
				kind: "wave-warp",
				payload: {
					kind: "wave-warp" as const,
					waveType: "sine" as const,
					height: 0,
					width: 380,
					direction: 35,
					phase: 0,
				},
			},
			{ id: "output", kind: "output" },
		],
		edges: [edge("source", "wave-warp"), edge("wave-warp", "output")],
		outputNodeId: "output",
	});

// --- Artboard background variants ------------------------------------------

const OPAQUE_BACKGROUND = "#000000";

/** V6: a single opaque-stop linear gradient — every stop's own opacity is 1, so the fill is fully opaque end to end. */
const GRADIENT_FILLS: readonly Paint[] = [
	{
		kind: "linear-gradient",
		from: { x: 0, y: 0 },
		to: { x: ARTBOARD_WIDTH, y: ARTBOARD_HEIGHT },
		stops: [
			{ offset: 0, color: "#101024" },
			{ offset: 1, color: "#301050" },
		],
	},
];

type AlphaProbeVariant = {
	readonly key: string;
	readonly label: string;
	readonly background: string;
	/** Omitted = legacy scalar-color fallback (opaque). `[]` = explicit no-paint (transparent). Present array = that paint stack. */
	readonly fills?: readonly Paint[];
	readonly lookGraph: LookGraph | null;
};

const VARIANTS: readonly AlphaProbeVariant[] = [
	{
		key: "v1-repro",
		label: "V1 repro — transparent artboard + full look graph",
		background: OPAQUE_BACKGROUND,
		fills: [],
		lookGraph: buildFullLookGraph(),
	},
	{
		key: "v2-control",
		label: "V2 control — transparent artboard, colorama removed",
		background: OPAQUE_BACKGROUND,
		fills: [],
		lookGraph: buildControlLookGraph(),
	},
	{
		key: "v3-no-look",
		label: "V3 no-look — transparent artboard, no look graph",
		background: OPAQUE_BACKGROUND,
		fills: [],
		lookGraph: null,
	},
	{
		key: "v4-blur-only",
		label: "V4 blur-only — transparent artboard, source->blur->output",
		background: OPAQUE_BACKGROUND,
		fills: [],
		lookGraph: buildBlurOnlyLookGraph(),
	},
	{
		key: "v5-opaque-full",
		label: "V5 opaque+full — opaque solid background + full look graph",
		background: OPAQUE_BACKGROUND,
		fills: undefined,
		lookGraph: buildFullLookGraph(),
	},
	{
		key: "v6-gradient",
		label: "V6 gradient — gradient-filled artboard + full look graph",
		background: OPAQUE_BACKGROUND,
		fills: GRADIENT_FILLS,
		lookGraph: buildFullLookGraph(),
	},
	{
		key: "v7-gpu-identity",
		label:
			"V7 GPU identity — transparent artboard, source->wave-warp(height:0)->output",
		background: OPAQUE_BACKGROUND,
		fills: [],
		lookGraph: buildGpuIdentityLookGraph(),
	},
];

const buildScene = (variant: AlphaProbeVariant): SceneDocument => ({
	schemaVersion: 1,
	id: `alpha-probe-${variant.key}`,
	name: `Alpha probe — ${variant.key}`,
	artboard: {
		id: ARTBOARD_ID,
		name: "Alpha Probe",
		// Explicit rather than omitted: normal document load hydrates a missing
		// `position` to this default via selectors, but this harness feeds a raw
		// `SceneDocument` straight to `captureRasterStillFrame`, bypassing that
		// hydration — `browser-runtime-3d-frame.ts`'s `exportViewForScene` reads
		// `artboard.position.x/y` unguarded and throws on `undefined`.
		position: { x: 0, y: 0 },
		width: ARTBOARD_WIDTH,
		height: ARTBOARD_HEIGHT,
		background: variant.background,
		...(variant.fills !== undefined ? { fills: variant.fills } : {}),
		fps: ARTBOARD_FPS,
		durationFrames: DURATION_FRAMES,
		cameraSpacePolicy: "screen_2d",
		...(variant.lookGraph
			? { effectIntent: { lookGraph: variant.lookGraph } }
			: {}),
	},
	layers: [
		{
			id: "alpha-probe-layer",
			name: "Alpha Probe",
			visible: true,
			locked: false,
			nodes: STAR_NODES,
		},
	],
});

const motion: MotionDocument = {
	schemaVersion: 1,
	fps: ARTBOARD_FPS,
	durationFrames: DURATION_FRAMES,
	clips: [],
	tracks: [],
	lookNodeTracks: [],
};

mkdirSync(outputDirectory, { recursive: true });

const written: string[] = [];
for (const variant of VARIANTS) {
	const scene = buildScene(variant);
	const payload = { label: variant.label, frame: PROBE_FRAME, scene, motion };
	const filePath = path.join(outputDirectory, `${variant.key}.json`);
	writeFileSync(filePath, JSON.stringify(payload, null, 2));
	written.push(filePath);
}

console.log(
	`Wrote ${written.length} alpha-probe fixtures to ${outputDirectory}:`,
);
for (const filePath of written)
	console.log(`  ${path.relative(process.cwd(), filePath)}`);
