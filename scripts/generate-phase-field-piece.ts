/**
 * Generates "PHASE FIELD": an 18x10 grid of vertical rounded bars whose
 * opacity and vertical scale are driven by a validated wave model, finished
 * with a GPU look (color-map -> ordered-dither). This is a one-off motion-art
 * artifact generator, not a product runtime: it builds the scene/motion
 * documents as plain typed literals, runs them through the maintained WebGL
 * export path, and writes the returned assets to disk for inspection.
 *
 * The per-node curves are extracted from a continuous simulation (an
 * asymmetric one-pole spring driven by a strictly T-periodic forcing
 * function) via greedy piecewise-linear keyframe simplification, so each of
 * the 360 tracks (180 nodes x {opacity, scaleY}) stays lean while still
 * reproducing the simulated wave to within the authored tolerance.
 *
 * Usage:
 *   bun run scripts/generate-phase-field-piece.ts
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { withSegmentEasing } from "@/entities/motion/model/easing";
import type {
	KeyframeTrack,
	LookNodeParamTrack,
	MotionDocument,
} from "@/entities/motion/model/types";
import { sceneNeedsGpuSurface } from "@/entities/scene/model/gpu-raster-adapter";
import {
	lookGraphPortId,
	normalizeLookGraph,
} from "@/entities/scene/model/look-graph";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import { createExportBundle } from "@/features/export/model/bundle";
import { exportOptimizationOptionsForProfile } from "@/features/export/model/optimization";
import { createWebglPlayerExportAssets } from "@/features/export/model/webgl-player";
import type { AeKeyframe } from "@/shared/glammer/keyframe-track";

const outputDirectory = path.join(process.cwd(), "artifacts/phase-field-01");
const FILE_STEM = "phase-field-01";

// --- Grid geometry -----------------------------------------------------

const COLS = 28;
const ROWS = 18;
const X_OFFSET = 80;
const Y_OFFSET = 0;
const PITCH = 40;
const BAR_WIDTH = 12;
const BAR_HEIGHT = 34;
const BAR_CORNER_RADIUS = 4;
const MIN_BAR_HEIGHT = 7;

const cellCenterX = (col: number): number => X_OFFSET + col * PITCH + PITCH / 2;
const cellCenterY = (row: number): number => Y_OFFSET + row * PITCH + PITCH / 2;

// --- Wave model (ported exactly; validated design) ----------------------

const TAU = 2 * Math.PI;
const DURATION_FRAMES = 360;

const S1 = { x: -8, y: 9 };
const S2 = { x: 21, y: 13 };
const WAVE_N = 2;
const WAVE_NH = 6;
const K1 = TAU / 12;
const K2 = TAU / 9;
const A1 = 0.55;
const A2 = 0.45;
const B_IDLE = 0.14;
const BASE = 0.1;
const ALPHA_ATTACK = 0.55;
const ALPHA_SETTLE = 0.12;

// Glyph "n" figure: a dot-matrix lowercase n in an 8x9 cell box placed
// center-right (left third stays calm for the LP copy zone). The figure the
// field crystallizes into IS this glyph's cell-coverage mask. Pilot bakes
// one glyph; productization exposes it as a host-injectable parameter
// (studio contract forbids baked text on the LP slot itself).
/**
 * Wordmark "not / deploy" composed from a hand-authored 3-wide pixel font
 * (1 ascender row + 5 x-height rows + 2 descender rows per character, one
 * empty column between characters). Binary cells only — partial coverage
 * and per-cell shimmer both break the dot-matrix read (validated on the
 * single-glyph revisions).
 */
type WordmarkGlyph = {
	readonly asc: string;
	readonly x: readonly string[];
	readonly desc: readonly string[];
};
const WORDMARK_FONT: Readonly<Record<string, WordmarkGlyph>> = {
	n: {
		asc: "...",
		x: ["xxx", "x.x", "x.x", "x.x", "x.x"],
		desc: ["...", "..."],
	},
	o: {
		asc: "...",
		x: [".x.", "x.x", "x.x", "x.x", ".x."],
		desc: ["...", "..."],
	},
	t: {
		asc: ".x.",
		x: ["xxx", ".x.", ".x.", ".x.", ".xx"],
		desc: ["...", "..."],
	},
	d: {
		asc: "..x",
		x: [".xx", "x.x", "x.x", "x.x", ".xx"],
		desc: ["...", "..."],
	},
	e: {
		asc: "...",
		x: [".x.", "x.x", "xxx", "x..", ".xx"],
		desc: ["...", "..."],
	},
	p: {
		asc: "...",
		x: ["xx.", "x.x", "x.x", "xx.", "x.."],
		desc: ["x..", "..."],
	},
	l: {
		asc: ".x.",
		x: [".x.", ".x.", ".x.", ".x.", ".xx"],
		desc: ["...", "..."],
	},
	y: {
		asc: "...",
		x: ["x.x", "x.x", "x.x", ".xx", "..x"],
		desc: [".x.", "..."],
	},
};

const WORDMARK_GRID: number[][] = Array.from({ length: ROWS }, () =>
	Array.from({ length: COLS }, () => 0),
);
const composeWord = (word: string, startCol: number, ascRow: number): void => {
	let col = startCol;
	for (const ch of word) {
		const glyph = WORDMARK_FONT[ch];
		if (!glyph) throw new Error(`No wordmark glyph for "${ch}".`);
		const rows = [glyph.asc, ...glyph.x, ...glyph.desc];
		rows.forEach((row, rowIndex) => {
			for (let k = 0; k < 3; k += 1) {
				if (row[k] === "x") WORDMARK_GRID[ascRow + rowIndex][col + k] = 1;
			}
		});
		col += 4;
	}
};
composeWord("not", 9, 2);
composeWord("deploy", 3, 9);

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** GLSL-style `smoothstep`: cubic Hermite ease clamped to the edge range. */
const smooth = (edge0: number, edge1: number, x: number): number => {
	const t = clamp01((x - edge0) / (edge1 - edge0));
	return t * t * (3 - 2 * t);
};

/** Rising-then-falling envelope window over `[r0,r1]` rise / `[f0,f1]` fall. */
const win = (
	t: number,
	r0: number,
	r1: number,
	f0: number,
	f1: number,
): number => smooth(r0, r1, t) * (1 - smooth(f0, f1, t));

const Ew = (t: number): number => win(t, 75, 105, 300, 345);
const Es = (t: number): number => win(t, 160, 190, 275, 305);
/** Figure lock: 12f snap rise, ~2.4s hold (two words to read), slow release. */
const Ec = (t: number): number => win(t, 197, 209, 282, 310);
/** Energy exchange: the field dips while the figure holds its energy. */
const Edip = (t: number): number => win(t, 199, 209, 240, 268);

const frac = (x: number): number => x - Math.floor(x);

/** Deterministic per-node phase offset, radians, from a hashed grid index. */
const hash = (i: number, j: number): number =>
	frac(Math.sin(i * 127.1 + j * 311.7) * 43758.5453) * TAU;

/** Binary wordmark-cell mask at grid cell (i,j). */
const glyphMask = (i: number, j: number): number => WORDMARK_GRID[j]?.[i] ?? 0;

/**
 * Whole-letter breathing (temporal only). A spatial phase sweep made the
 * letter cells unequal in height and broke the dot-matrix read; the figure
 * stays alive by breathing as one body instead.
 */
const glyphBreath = (t: number): number =>
	0.93 + 0.07 * Math.sin((TAU * 3 * t) / DURATION_FRAMES);

/** Per-node depth bias: back rows/columns ramp in later and softer. */
const depthBias = (i: number, j: number): number =>
	0.45 + 0.55 * smooth(-2, 30, i * 0.85 + j * 1.1);

/** Strictly T-periodic forcing drive for node (i,j) at time t (frames). */
const drive = (t: number, i: number, j: number): number => {
	const idle =
		B_IDLE * Math.sin((TAU * WAVE_NH * t) / DURATION_FRAMES + hash(i, j));
	const w1 =
		Ew(t) *
		A1 *
		Math.sin(
			(TAU * WAVE_N * t) / DURATION_FRAMES -
				K1 * Math.hypot(i - S1.x, j - S1.y),
		);
	const w2 =
		Es(t) *
		A2 *
		Math.sin(
			(TAU * WAVE_N * t) / DURATION_FRAMES -
				K2 * Math.hypot(i - S2.x, j - S2.y),
		);
	const waves = (1 - 0.85 * Ec(t)) * (w1 + w2);
	const figure = Ec(t) * glyphMask(i, j) * glyphBreath(t) * 1.05;
	const fieldTerm =
		(1 - 0.45 * Edip(t)) * depthBias(i, j) * (BASE + Math.max(0, idle + waves));
	return Math.min(1, fieldTerm + figure);
};

/**
 * Runs the asymmetric one-pole spring over 3 full periods of the periodic
 * `drive` forcing and keeps the converged 3rd period as the node's sample
 * array (frame 0..359). Two warm-up periods let the limit cycle settle so
 * the captured period reads as a stable loop rather than a transient decay.
 * Frame 359's sample is snapped to frame 0's so the timeline (which loops
 * frame 359 back to frame 0) closes without a visible seam.
 */
const simulatePeriodic = (
	forcing: (t: number) => number,
): readonly number[] => {
	const samples = Array.from({ length: DURATION_FRAMES }, () => 0);
	let y = 0;
	for (let period = 0; period < 3; period += 1) {
		for (let t = 0; t < DURATION_FRAMES; t += 1) {
			const x = forcing(t);
			y += (x > y ? ALPHA_ATTACK : ALPHA_SETTLE) * (x - y);
			if (period === 2) samples[t] = y;
		}
	}
	samples[DURATION_FRAMES - 1] = samples[0];
	return samples;
};

const simulateNode = (i: number, j: number): readonly number[] =>
	simulatePeriodic((t) => drive(t, i, j));

// --- Curve mappings ------------------------------------------------------

const scaleYFromV = (v: number): number =>
	(MIN_BAR_HEIGHT + 27 * v) / BAR_HEIGHT;
const opacityFromV = (v: number): number => 0.16 + 0.84 * v;

// --- Greedy piecewise-linear keyframe simplification ---------------------

const SIMPLIFY_TOLERANCE = 0.008;

type RawKey = { readonly time: number; readonly value: number };

/**
 * Greedy piecewise-linear simplification: extends each segment as far as it
 * can while every skipped sample stays within `tolerance` of the straight
 * line between the segment's endpoints, then starts the next segment there.
 * Always emits the first and last sample. Values are rounded to 3 decimals.
 */
const simplifyToKeyframes = (
	samples: readonly number[],
	tolerance: number,
): readonly RawKey[] => {
	const round3 = (value: number): number => Math.round(value * 1000) / 1000;
	const keys: RawKey[] = [{ time: 0, value: round3(samples[0]) }];
	let startIndex = 0;
	while (startIndex < samples.length - 1) {
		let lastGood = startIndex + 1;
		let endIndex = startIndex + 1;
		while (endIndex < samples.length) {
			const v0 = samples[startIndex];
			const v1 = samples[endIndex];
			const span = endIndex - startIndex;
			let maxDeviation = 0;
			for (let k = startIndex + 1; k < endIndex; k += 1) {
				const interpolated = v0 + ((v1 - v0) * (k - startIndex)) / span;
				maxDeviation = Math.max(
					maxDeviation,
					Math.abs(samples[k] - interpolated),
				);
			}
			if (maxDeviation > tolerance) break;
			lastGood = endIndex;
			endIndex += 1;
		}
		keys.push({ time: lastGood, value: round3(samples[lastGood]) });
		startIndex = lastGood;
	}
	const lastIndex = samples.length - 1;
	if (keys[keys.length - 1].time !== lastIndex) {
		keys.push({ time: lastIndex, value: round3(samples[lastIndex]) });
	}
	return keys;
};

/** Applies exact linear easing (zero influence both sides) across a key chain. */
const withLinearEasing = (rawKeys: readonly RawKey[]): AeKeyframe<number>[] => {
	const keys: AeKeyframe<number>[] = rawKeys.map((key) => ({
		time: key.time,
		value: key.value,
	}));
	for (let i = 0; i < keys.length; i += 1) {
		const left = keys[i];
		const right = i + 1 < keys.length ? keys[i + 1] : undefined;
		const eased = withSegmentEasing(left, right, "linear");
		keys[i] = eased.left;
		if (right && eased.right) keys[i + 1] = eased.right;
	}
	return keys;
};

// --- Scene assembly -------------------------------------------------------

const barNode = (col: number, row: number): VectorNode => {
	const id = `pf-bar-${col}-${row}`;
	return {
		id,
		name: id,
		geometry: {
			kind: "rect",
			bounds: {
				x: -BAR_WIDTH / 2,
				y: -BAR_HEIGHT / 2,
				width: BAR_WIDTH,
				height: BAR_HEIGHT,
			},
			cornerRadius: BAR_CORNER_RADIUS,
		},
		transform: {
			position: { x: cellCenterX(col), y: cellCenterY(row) },
			rotation: 0,
			scale: { x: 1, y: 1 },
			anchor: { x: 0, y: 0 },
		},
		style: {
			fill: "#f1efe7",
			stroke: "none",
			strokeWidth: 0,
			opacity: 1,
		},
		visible: true,
		locked: false,
	};
};

const bars: VectorNode[] = [];
const tracks: KeyframeTrack[] = [];
let totalKeyframeCount = 0;

for (let row = 0; row < ROWS; row += 1) {
	for (let col = 0; col < COLS; col += 1) {
		bars.push(barNode(col, row));
		const nodeId = `pf-bar-${col}-${row}`;
		const samples = simulateNode(col, row);
		const scaleYSamples = samples.map(scaleYFromV);
		const opacitySamples = samples.map(opacityFromV);
		const scaleYKeys = withLinearEasing(
			simplifyToKeyframes(scaleYSamples, SIMPLIFY_TOLERANCE),
		);
		const opacityKeys = withLinearEasing(
			simplifyToKeyframes(opacitySamples, SIMPLIFY_TOLERANCE),
		);
		totalKeyframeCount += scaleYKeys.length + opacityKeys.length;
		tracks.push({
			id: `${nodeId}-scaleY`,
			target: { nodeId, property: "scaleY" },
			keyframes: scaleYKeys,
		});
		tracks.push({
			id: `${nodeId}-opacity`,
			target: { nodeId, property: "opacity" },
			keyframes: opacityKeys,
		});
	}
}

// --- Animated look parameters (the effects themselves move with the beats) --
// Sampled every 4 frames with a loop-closing final key; the WebGL runtime
// samples `lookNodeTracks` per frame, so glow and dither stop being a static
// finish: the print boils continuously and the light answers the figure.

const ARTBOARD_OWNER = {
	scope: "artboard",
	artboardId: "phase-field-artboard",
} as const;

/**
 * Quiet halos at rest; the hold lifts the letter gently off the page.
 * No flash spike: full-frame luminance detonation read as LED signage
 * (user-rejected); the lock is marked by the field's energy dip instead.
 */
const glowIntensityAt = (t: number): number => 0.4 + 0.15 * Ew(t) + 0.5 * Ec(t);

/** Halo reach widens a touch while the figure holds. */
const glowRadiusAt = (t: number): number => 0.1 + 0.03 * Ec(t);

/** Continuous Bayer boil: the print never sits still. */
const ditherThresholdAt = (t: number): number =>
	0.5 + 0.06 * Math.sin((TAU * 6 * t) / DURATION_FRAMES);

/** The page snaps crisper while the letter holds. */
const ditherContrastAt = (t: number): number => 1.05 + 0.25 * Ec(t);

const lookTrack = (
	lookNodeId: string,
	paramKey: string,
	valueAt: (t: number) => number,
): LookNodeParamTrack => {
	const round3 = (value: number): number => Math.round(value * 1000) / 1000;
	const raw: RawKey[] = [];
	for (let t = 0; t < DURATION_FRAMES - 1; t += 4) {
		raw.push({ time: t, value: round3(valueAt(t)) });
	}
	raw.push({ time: DURATION_FRAMES - 1, value: round3(valueAt(0)) });
	return {
		id: `look-${lookNodeId}-${paramKey}`,
		target: { owner: ARTBOARD_OWNER, lookNodeId, paramKey },
		keyframes: withLinearEasing(raw),
	};
};

const lookNodeTracks: LookNodeParamTrack[] = [
	lookTrack("deep-glow", "intensity", glowIntensityAt),
	lookTrack("deep-glow", "radius", glowRadiusAt),
	lookTrack("ordered-dither", "threshold", ditherThresholdAt),
	lookTrack("ordered-dither", "contrast", ditherContrastAt),
];

const edge = (fromNode: string, toNode: string) => ({
	from: {
		nodeId: fromNode,
		portId: lookGraphPortId(fromNode, "output", "image"),
	},
	to: { nodeId: toNode, portId: lookGraphPortId(toNode, "input", "image") },
});

const phaseFieldLookGraph = normalizeLookGraph({
	nodes: [
		{ id: "source", kind: "source" },
		{
			id: "deep-glow",
			kind: "deep-glow",
			payload: {
				kind: "deep-glow",
				radius: 0.12,
				intensity: 1.1,
				threshold: 0.8,
				chroma: 0,
				blendMode: "screen",
			},
		},
		{
			id: "ordered-dither",
			kind: "ordered-dither",
			payload: {
				kind: "ordered-dither",
				cellSize: 6,
				matrixSize: 8,
				levels: 6,
				mode: "rgb",
				pattern: "bayer",
				contrast: 1.05,
				threshold: 0.5,
				strength: 1,
				mix: 1,
				brightness: 0,
				gamma: 1,
				ink: "#11130f",
				paper: "#f1efe7",
			},
		},
		{ id: "output", kind: "output" },
	],
	// Print first, then light: dithering the crisp source keeps the field a
	// clean duotone (soft glow gradients fed INTO an rgb ordered-dither
	// posterize to primary-color confetti — observed failure), and the glow
	// then blooms the bright glyph/acid over the printed page without being
	// re-quantized.
	edges: [
		edge("source", "ordered-dither"),
		edge("ordered-dither", "deep-glow"),
		edge("deep-glow", "output"),
	],
	outputNodeId: "output",
});
if (!phaseFieldLookGraph) {
	throw new Error("PHASE FIELD Look graph is invalid.");
}

const scene: SceneDocument = {
	schemaVersion: 1,
	id: "phase-field-01",
	name: "PHASE FIELD",
	artboard: {
		id: "phase-field-artboard",
		name: "PHASE FIELD",
		width: 1280,
		height: 720,
		background: "#11130f",
		// Radial night gradient centered behind the glyph zone: ordered-dither
		// quantizes it into a Bayer ramp (the dithered-gradient idiom), which
		// reads as the brand's noise-gradation without stacking a second
		// competing grain pattern (dither+grain is a known mud trap).
		fills: [
			{
				kind: "radial-gradient",
				center: { x: 840, y: 350 },
				radius: { x: 940, y: 700 },
				stops: [
					{ offset: 0, color: "#191b12" },
					{ offset: 0.55, color: "#111308" },
					{ offset: 1, color: "#0a0c08" },
				],
			},
		],
		fps: 30,
		durationFrames: DURATION_FRAMES,
		cameraSpacePolicy: "screen_2d",
		effectIntent: { lookGraph: phaseFieldLookGraph },
	},
	layers: [
		{
			id: "phase-field-layer",
			name: "Bars",
			visible: true,
			locked: false,
			nodes: bars,
		},
	],
};

if (!sceneNeedsGpuSurface(scene)) {
	throw new Error("PHASE FIELD scene did not select a GPU surface.");
}

const motion: MotionDocument = {
	schemaVersion: 1,
	fps: 30,
	durationFrames: DURATION_FRAMES,
	clips: [],
	tracks,
	lookNodeTracks,
};

const optimization = exportOptimizationOptionsForProfile("editable");
const bundle = createExportBundle({
	scene,
	motion,
	currentFrame: 0,
	artboardScope: "current",
});
const assets = createWebglPlayerExportAssets(bundle, [], {
	optimization,
	fileStem: FILE_STEM,
	scene,
});

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });

const written: { fileName: string; byteLength: number }[] = [];
for (const asset of assets) {
	if (!("contents" in asset)) continue;
	const filePath = path.join(outputDirectory, asset.fileName);
	writeFileSync(filePath, asset.contents);
	written.push({
		fileName: asset.fileName,
		byteLength: Buffer.byteLength(asset.contents, "utf8"),
	});
}

// QA page: same player, paused, exposed on window for seek-and-screenshot QA.
const qaPage = [
	"<!doctype html>",
	'<html lang="en">',
	"  <head>",
	'    <meta charset="utf-8" />',
	'    <meta name="viewport" content="width=device-width, initial-scale=1" />',
	"    <title>PHASE FIELD QA</title>",
	"    <style>",
	"      html, body { margin: 0; width: 100%; min-height: 100%; background: #11130f; }",
	"      body { min-height: 100vh; display: grid; place-items: center; overflow: hidden; }",
	"      #player { width: 100vw; aspect-ratio: 1280 / 720; overflow: hidden; }",
	"      @media (min-aspect-ratio: 1280/720) { #player { width: auto; height: 100vh; } }",
	"      #player > canvas { display: block; width: 100%; height: auto; }",
	"    </style>",
	"  </head>",
	"  <body>",
	'    <div id="player" aria-label="PHASE FIELD QA player"></div>',
	'    <script type="module">',
	`      import { mountVectorMotionWebglPlayer } from "./${FILE_STEM}.webgl-player.js";`,
	'      const container = document.getElementById("player");',
	"      const player = await mountVectorMotionWebglPlayer(container, { autoplay: true, loop: true });",
	"      window.player = player;",
	"      window.qaReady = true;",
	"      // Some embedded review panes suppress requestAnimationFrame entirely,",
	"      // freezing the player's own clock. Detect a dead rAF and fall back to",
	"      // a timer-driven seek loop so the motion stays reviewable there.",
	"      let rafFired = false;",
	"      requestAnimationFrame(() => { rafFired = true; });",
	"      setTimeout(() => {",
	"        if (rafFired) return;",
	"        player.pause();",
	"        let frame = player.frame;",
	"        window.qaTimerFallback = setInterval(() => {",
	"          if (window.qaHoldSeek) return;",
	"          frame = (frame + 1) % player.durationFrames;",
	"          void player.seekFrame(frame);",
	"        }, 1000 / 30);",
	"      }, 400);",
	"    </script>",
	"  </body>",
	"</html>",
	"",
].join("\n");
writeFileSync(path.join(outputDirectory, `${FILE_STEM}.qa.html`), qaPage);

console.log(`Generated ${path.relative(process.cwd(), outputDirectory)}.`);
console.log(
	`Total keyframes across ${tracks.length} tracks: ${totalKeyframeCount}`,
);
for (const file of written) {
	console.log(`  ${file.fileName} — ${file.byteLength} bytes`);
}
