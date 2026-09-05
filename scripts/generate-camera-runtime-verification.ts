/** Generates the minimal SVG/WebGL browser harness for camera-runtime QA. */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { MotionDocument } from "../src/entities/motion/model/types";
import { sceneNeedsGpuSurface } from "../src/entities/scene/model/gpu-raster-adapter";
import {
	lookGraphPortId,
	normalizeLookGraph,
} from "../src/entities/scene/model/look-graph";
import type {
	SceneCameraRigContract,
	SceneDocument,
	VectorNode,
} from "../src/entities/scene/model/types";
import { createExportBundle } from "../src/features/export/model/bundle";
import { createMotionCodeExportAssets } from "../src/features/export/model/code";
import { exportOptimizationOptionsForProfile } from "../src/features/export/model/optimization";
import { createWebglPlayerExportAssets } from "../src/features/export/model/webgl-player";

const outputDirectory = path.join(
	process.cwd(),
	"artifacts/camera-runtime-verification",
);

const camera = (
	id: string,
	name: string,
	body: { readonly x: number; readonly y: number; readonly z: number },
	fovDegrees: number,
	artboardId = "camera-artboard",
): SceneCameraRigContract => ({
	id,
	name,
	version: 1,
	scope: { kind: "artboard", artboardId },
	projection: {
		kind: "perspective",
		fovDegrees,
		near: 0.1,
		far: 5000,
		focusDistance: 1000,
		aperture: 0,
	},
	body: { position: body },
	target: { point: { x: 240, y: 160, z: 0 } },
});

const node = ({
	id,
	x,
	y,
	z,
	fill,
	size,
	artboardId,
}: {
	readonly id: string;
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly fill: string;
	readonly size: number;
	readonly artboardId?: string;
}): VectorNode => ({
	id,
	name: id,
	geometry: {
		kind: "rect",
		bounds: { x: -size / 2, y: -size / 2, width: size, height: size },
		cornerRadius: size * 0.22,
	},
	transform: {
		position: { x, y },
		rotation: 0,
		scale: { x: 1, y: 1 },
		anchor: { x: 0, y: 0 },
	},
	style: {
		fill,
		stroke: "rgba(255,255,255,0.75)",
		strokeWidth: 3,
		opacity: 1,
	},
	visible: true,
	locked: false,
	...(artboardId ? { artboardId } : {}),
	depthPlane: { kind: "depth-plane", version: 1, z },
});

const baseScene: SceneDocument = {
	schemaVersion: 1,
	id: "camera-runtime-verification",
	name: "Camera Runtime Verification",
	artboard: {
		id: "camera-artboard",
		name: "Camera Runtime",
		width: 480,
		height: 320,
		background: "#111827",
		fps: 30,
		durationFrames: 12,
		activeSceneCameraId: "camera-a",
	},
	sceneCameras: [
		camera("camera-a", "Camera A", { x: 240, y: 160, z: -1000 }, 50),
		camera("camera-b", "Camera B", { x: 320, y: 105, z: -820 }, 62),
	],
	layers: [
		{
			id: "depth-layer",
			name: "Depth Cards",
			visible: true,
			locked: false,
			nodes: [
				node({
					id: "background",
					x: 145,
					y: 165,
					z: 220,
					fill: "#2563eb",
					size: 145,
				}),
				node({
					id: "midground",
					x: 250,
					y: 165,
					z: 0,
					fill: "#8b5cf6",
					size: 112,
				}),
				node({
					id: "foreground",
					x: 350,
					y: 165,
					z: -190,
					fill: "#f97316",
					size: 82,
				}),
			],
		},
	],
};

const motion: MotionDocument = {
	schemaVersion: 1,
	fps: 30,
	durationFrames: 12,
	clips: [],
	tracks: [],
	cameraTracks: [
		{
			id: "camera-a-body-x",
			target: { cameraRigId: "camera-a", property: "bodyX" },
			keyframes: [
				{ time: 0, value: 240 },
				{ time: 10, value: 285 },
			],
		},
		{
			id: "camera-a-target-y",
			target: { cameraRigId: "camera-a", property: "targetY" },
			keyframes: [
				{ time: 0, value: 160 },
				{ time: 10, value: 135 },
			],
		},
		{
			id: "camera-a-fov",
			target: { cameraRigId: "camera-a", property: "fovDegrees" },
			keyframes: [
				{ time: 0, value: 50 },
				{ time: 10, value: 56 },
			],
		},
	],
	cameraCuts: [
		{
			id: "camera-b-crossfade",
			artboardId: "camera-artboard",
			cameraRigId: "camera-b",
			startFrame: 5,
			durationFrames: 3,
			transition: "crossfade",
			transitionDurationFrames: 3,
		},
		{
			id: "camera-b-hard-cut",
			artboardId: "camera-artboard",
			cameraRigId: "camera-b",
			startFrame: 8,
			durationFrames: 2,
			transition: "cut",
		},
	],
};

const edge = (fromNode: string, toNode: string) => ({
	from: {
		nodeId: fromNode,
		portId: lookGraphPortId(fromNode, "output", "image"),
	},
	to: { nodeId: toNode, portId: lookGraphPortId(toNode, "input", "image") },
});

const gpuLookGraph = normalizeLookGraph({
	nodes: [
		{ id: "source", kind: "source" },
		{
			id: "lens",
			kind: "lens",
			payload: {
				kind: "lens",
				size: 0.62,
				convergence: 0.18,
				centerX: 0.5,
				centerY: 0.5,
				clipToRim: false,
			},
		},
		{ id: "output", kind: "output" },
	],
	edges: [edge("source", "lens"), edge("lens", "output")],
	outputNodeId: "output",
});
if (!gpuLookGraph)
	throw new Error("Camera verification GPU Look graph is invalid.");

const gpuScene: SceneDocument = {
	...baseScene,
	artboard: {
		...baseScene.artboard,
		effectIntent: { lookGraph: gpuLookGraph },
	},
};
if (!sceneNeedsGpuSurface(gpuScene)) {
	throw new Error("Camera verification GPU scene did not select WebGL.");
}

const sequenceSecondArtboard = {
	...baseScene.artboard,
	id: "camera-artboard-b",
	name: "Camera Runtime B",
	width: 360,
	height: 360,
	activeSceneCameraId: "camera-c",
};

const sequenceScene: SceneDocument = {
	...baseScene,
	id: "camera-runtime-sequence-verification",
	name: "Camera Runtime Sequence Verification",
	artboards: [baseScene.artboard, sequenceSecondArtboard],
	currentArtboardId: baseScene.artboard.id,
	sequence: {
		id: "camera-sequence",
		name: "Camera Sequence",
		fps: 30,
		items: [
			{
				id: "sequence-item-a",
				artboardId: baseScene.artboard.id,
				durationFrames: 6,
			},
			{
				id: "sequence-item-b",
				artboardId: sequenceSecondArtboard.id,
				durationFrames: 6,
			},
		],
	},
	sceneCameras: [
		...(baseScene.sceneCameras ?? []),
		camera(
			"camera-c",
			"Camera C",
			{ x: 180, y: 180, z: -900 },
			46,
			sequenceSecondArtboard.id,
		),
	],
	layers: [
		{
			...baseScene.layers[0],
			nodes: [
				...baseScene.layers[0].nodes.map((entry) => ({
					...entry,
					artboardId: baseScene.artboard.id,
				})),
				node({
					id: "sequence-b-background",
					x: 105,
					y: 180,
					z: 180,
					fill: "#0f766e",
					size: 132,
					artboardId: sequenceSecondArtboard.id,
				}),
				node({
					id: "sequence-b-foreground",
					x: 250,
					y: 180,
					z: -150,
					fill: "#e11d48",
					size: 88,
					artboardId: sequenceSecondArtboard.id,
				}),
			],
		},
	],
};

const sequenceGpuScene: SceneDocument = {
	...sequenceScene,
	artboards: sequenceScene.artboards?.map((artboard) =>
		artboard.id === sequenceSecondArtboard.id
			? { ...artboard, effectIntent: { lookGraph: gpuLookGraph } }
			: artboard,
	),
};

const optimization = exportOptimizationOptionsForProfile("editable");
const svgBundle = createExportBundle({ scene: baseScene, motion, frame: 0 });
const webglBundle = createExportBundle({ scene: gpuScene, motion, frame: 0 });
const sequenceSvgBundle = createExportBundle({
	scene: sequenceScene,
	motion,
	frame: 0,
	artboardScope: "all",
});
const sequenceWebglBundle = createExportBundle({
	scene: sequenceGpuScene,
	motion,
	frame: 0,
	artboardScope: "all",
});
const svgAssets = createMotionCodeExportAssets(svgBundle, [], { optimization });
const webglAssets = createWebglPlayerExportAssets(webglBundle, [], {
	optimization,
	fileStem: "camera-webgl",
	scene: gpuScene,
});
const sequenceSvgAssets = createMotionCodeExportAssets(sequenceSvgBundle, [], {
	optimization,
});
const sequenceWebglAssets = createWebglPlayerExportAssets(
	sequenceWebglBundle,
	[],
	{
		optimization,
		fileStem: "camera-webgl-sequence",
	},
);

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });
for (const asset of [
	...svgAssets,
	...webglAssets,
	...sequenceSvgAssets,
	...sequenceWebglAssets,
]) {
	if (!("contents" in asset)) continue;
	writeFileSync(path.join(outputDirectory, asset.fileName), asset.contents);
}

const svgRuntime = svgAssets.find((asset) => asset.kind === "runtime-js");
const webglRuntime = webglAssets.find(
	(asset) => asset.kind === "webgl-runtime-js",
);
const sequenceSvgRuntime = sequenceSvgAssets.find(
	(asset) => asset.kind === "runtime-js",
);
const sequenceWebglRuntime = sequenceWebglAssets.find(
	(asset) => asset.kind === "webgl-runtime-js",
);
const svgReact = svgAssets.find((asset) => asset.kind === "runtime-react");
const webglReact = webglAssets.find(
	(asset) => asset.kind === "webgl-runtime-react",
);
if (
	!svgRuntime ||
	!webglRuntime ||
	!sequenceSvgRuntime ||
	!sequenceWebglRuntime ||
	!svgReact ||
	!webglReact
)
	throw new Error("Verification runtimes missing.");

const reactHarnessEntry = path.join(outputDirectory, "react-harness.tsx");
writeFileSync(
	reactHarnessEntry,
	`import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { VectorMotion as SvgMotion } from "./${svgReact.fileName}";
import { VectorMotion as WebglMotion } from "./${webglReact.fileName}";

const state = {
  status: "mounting",
  ready: { svg: 0, webgl: 0 },
  renderedGenerations: { svg: [], webgl: [] },
  players: {},
};
window.__cameraReactHarness = state;

function App() {
  const [generation, setGeneration] = useState(0);
  const [readyCount, setReadyCount] = useState(0);

  useEffect(() => {
    if (readyCount !== 2 || generation !== 0) return;
    setGeneration(1);
  }, [generation, readyCount]);

  useEffect(() => {
    if (readyCount !== 2 || generation !== 1) return;
    const timer = window.setTimeout(async () => {
      try {
        state.renderedGenerations.svg.length = 0;
        state.renderedGenerations.webgl.length = 0;
        await state.players.svg.seekFrame(3.25);
        await state.players.webgl.seekFrame(3.25);
        const latestCallbacks =
          state.renderedGenerations.svg.at(-1) === 1 &&
          state.renderedGenerations.webgl.at(-1) === 1;
        const noRemount = state.ready.svg === 1 && state.ready.webgl === 1;
        state.status = latestCallbacks && noRemount ? "passed" : "failed";
        state.detail = { latestCallbacks, noRemount };
      } catch (error) {
        state.status = "failed";
        state.error = error instanceof Error ? error.message : String(error);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [generation, readyCount]);

  return <>
    <SvgMotion
      autoplay={false}
      onReady={(player) => {
        state.ready.svg += 1;
        state.players.svg = player;
        setReadyCount((value) => value + 1);
      }}
      onFrameRendered={() => state.renderedGenerations.svg.push(generation)}
    />
    {createPortal(<WebglMotion
      autoplay={false}
      onReady={(player) => {
        state.ready.webgl += 1;
        state.players.webgl = player;
        setReadyCount((value) => value + 1);
      }}
      onFrameRendered={() => state.renderedGenerations.webgl.push(generation)}
    />, document.querySelector("#react-webgl"))}
  </>;
}

createRoot(document.querySelector("#react-svg")).render(<App />);
`,
);
const reactBuild = await Bun.build({
	entrypoints: [reactHarnessEntry],
	outdir: outputDirectory,
	target: "browser",
	format: "esm",
	sourcemap: "none",
});
rmSync(reactHarnessEntry, { force: true });
if (!reactBuild.success) {
	throw new Error(
		`React camera harness failed to build: ${reactBuild.logs.join("\n")}`,
	);
}

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <link rel="icon" href="data:," />
  <title>Camera Runtime Integration Verification</title>
  <style>
    body { margin: 0; padding: 24px; color: #e5e7eb; background: #030712; font: 14px/1.4 ui-monospace, monospace; }
    h1 { margin: 0 0 16px; font: 600 20px system-ui; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 480px)); gap: 16px; }
    .panel { padding: 12px; border: 1px solid #374151; border-radius: 12px; background: #111827; }
    .player { width: 100%; aspect-ratio: 3 / 2; overflow: hidden; border-radius: 8px; background: #111827; }
    .player > svg, .player > canvas { display: block; width: 100%; height: 100%; }
    #status { margin: 16px 0; padding: 10px 12px; border-radius: 8px; background: #374151; }
    #status[data-state="passed"] { background: #064e3b; }
    #status[data-state="failed"] { background: #7f1d1d; }
    pre { max-height: 280px; overflow: auto; white-space: pre-wrap; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <h1>Camera Runtime Integration Verification</h1>
  <div id="status" data-state="running">running</div>
  <div class="grid">
    <section class="panel"><strong>SVG</strong><div id="svg" class="player"></div></section>
    <section class="panel"><strong>WebGL</strong><div id="webgl" class="player"></div></section>
    <section class="panel"><strong>SVG sequence</strong><div id="svg-sequence" class="player"></div></section>
    <section class="panel"><strong>WebGL sequence</strong><div id="webgl-sequence" class="player"></div></section>
    <section class="panel"><strong>React SVG</strong><div id="react-svg" class="player"></div></section>
    <section class="panel"><strong>React WebGL</strong><div id="react-webgl" class="player"></div></section>
  </div>
  <div id="lifecycle" class="hidden"></div>
  <div id="svg-baseline" class="hidden"></div>
  <div id="webgl-baseline" class="hidden"></div>
  <pre id="trace"></pre>
  <script type="module" src="./react-harness.js"></script>
  <script type="module">
    import { mountVectorMotion as mountSvg } from "./${svgRuntime.fileName}";
    import { mountVectorMotion as mountWebgl } from "./${webglRuntime.fileName}";
    import { mountVectorMotion as mountSvgSequence } from "./${sequenceSvgRuntime.fileName}";
    import { mountVectorMotion as mountWebglSequence } from "./${sequenceWebglRuntime.fileName}";

    const trace = { startedAt: new Date().toISOString(), assertions: [], events: { svg: [], webgl: [], svgSequence: [], webglSequence: [] }, timingsMs: {} };
    const assert = (name, condition, detail) => {
      trace.assertions.push({ name, passed: Boolean(condition), detail });
      if (!condition) throw new Error(name + ": " + JSON.stringify(detail));
    };
    const cameraJson = (player) => JSON.stringify(player.getCameraState());
    const eventRecord = (event) => ({
      phase: event.phase,
      requestId: event.requestId,
      frame: event.sampledFrame ?? event.snapshot.frame,
      scope: event.scope ?? event.snapshot.scope,
      cameraKind: event.camera?.kind ?? event.snapshot.camera.kind,
    });
    const timed = async (name, action) => { const start = performance.now(); const result = await action(); trace.timingsMs[name] = Number((performance.now() - start).toFixed(3)); return result; };
    const waitForReactHarness = async () => {
      const deadline = performance.now() + 15000;
      while (performance.now() < deadline) {
        const state = window.__cameraReactHarness;
        if (state?.status === "passed" || state?.status === "failed") return state;
        await new Promise((resolve) => window.setTimeout(resolve, 20));
      }
      throw new Error("React camera harness timed out.");
    };
    const benchmark = async (player) => {
      const frames = Array.from({ length: 24 }, (_, index) => ((index * 2.375) % 11));
      const latencies = [];
      const totalStart = performance.now();
      for (const frame of frames) {
        const start = performance.now();
        const result = await player.seekFrame(frame);
        if (result.status !== "committed") throw new Error("benchmark request did not commit");
        latencies.push(performance.now() - start);
      }
      const totalMs = performance.now() - totalStart;
      const sorted = [...latencies].sort((a, b) => a - b);
      return {
        count: frames.length,
        totalMs: Number(totalMs.toFixed(3)),
        committedFramesPerSecond: Number(((frames.length / totalMs) * 1000).toFixed(1)),
        p95Ms: Number(sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(3)),
      };
    };
    const noMaterialRegression = (hooked, baseline) =>
      hooked.p95Ms <= baseline.p95Ms + Math.max(3, baseline.p95Ms * 0.75) &&
      hooked.committedFramesPerSecond >= baseline.committedFramesPerSecond * 0.5;

    try {
      const svg = await mountSvg(document.querySelector("#svg"), {
        source: { kind: "embedded" },
        autoplay: false,
        onFrameSampled: (event) => trace.events.svg.push(eventRecord(event)),
        onFrameRendered: (event) => trace.events.svg.push(eventRecord(event)),
      });
      const webgl = await mountWebgl(document.querySelector("#webgl"), {
        source: { kind: "embedded" },
        autoplay: false,
        onFrameSampled: (event) => trace.events.webgl.push(eventRecord(event)),
        onFrameRendered: (event) => trace.events.webgl.push(eventRecord(event)),
      });
      const svgSequence = await mountSvgSequence(document.querySelector("#svg-sequence"), {
        source: { kind: "embedded" },
        autoplay: false,
        onFrameSampled: (event) => trace.events.svgSequence.push(eventRecord(event)),
        onFrameRendered: (event) => trace.events.svgSequence.push(eventRecord(event)),
      });
      const webglSequence = await mountWebglSequence(document.querySelector("#webgl-sequence"), {
        source: { kind: "embedded" },
        autoplay: false,
        onFrameSampled: (event) => trace.events.webglSequence.push(eventRecord(event)),
        onFrameRendered: (event) => trace.events.webglSequence.push(eventRecord(event)),
      });

      assert("renderer substitution", svg.renderer === "svg" && webgl.renderer === "webgl", { svg: svg.renderer, webgl: webgl.renderer });
      assert("mount hooks", trace.events.svg.length >= 2 && trace.events.webgl.length >= 2, trace.events);
      assert("committed mount state", [svg, webgl, svgSequence, webglSequence].every((player) => player.getSnapshot().revision >= 1 && player.getCameraState().kind !== "none"), [svg, webgl, svgSequence, webglSequence].map((player) => player.getSnapshot()));
      assert("catalog parity", JSON.stringify(svg.getCameraCatalog()) === JSON.stringify(webgl.getCameraCatalog()), { svg: svg.getCameraCatalog(), webgl: webgl.getCameraCatalog() });

      let externalStoreNotifications = 0;
      const unsubscribe = svg.subscribe(() => { externalStoreNotifications += 1; }, { emitCurrent: true });
      await svg.seekProgress(0.375);
      await webgl.seekProgress(0.375);
      unsubscribe();
      assert("progress clock and external store", svg.frame === 4.125 && webgl.frame === 4.125 && externalStoreNotifications === 2 && cameraJson(svg) === cameraJson(webgl), { svg: svg.frame, webgl: webgl.frame, externalStoreNotifications });

      await timed("fractionalSeekSvg", () => svg.seekFrame(4.5));
      await timed("fractionalSeekWebgl", () => webgl.seekFrame(4.5));
      assert("fractional frame parity", svg.frame === 4.5 && webgl.frame === 4.5, { svg: svg.frame, webgl: webgl.frame });
      assert("fractional camera parity", cameraJson(svg) === cameraJson(webgl), { svg: svg.getCameraState(), webgl: webgl.getCameraState() });

      await svg.seekFrame(6);
      await webgl.seekFrame(6);
      assert("crossfade state parity", svg.getCameraState().kind === "crossfade" && cameraJson(svg) === cameraJson(webgl), { svg: svg.getCameraState(), webgl: webgl.getCameraState() });

      const authoredCrossfade = cameraJson(svg);
      await svg.setCameraOverride("camera-a", { mode: "replace", channels: { bodyX: 360 } });
      await webgl.setCameraOverride("camera-a", { mode: "replace", channels: { bodyX: 360 } });
      assert("override parity", cameraJson(svg) === cameraJson(webgl) && cameraJson(svg) !== authoredCrossfade, { svg: svg.getCameraState(), webgl: webgl.getCameraState() });
      await svg.clearCameraOverrides();
      await webgl.clearCameraOverrides();
      assert("override clear", cameraJson(svg) === authoredCrossfade && cameraJson(webgl) === authoredCrossfade, { svg: svg.getCameraState(), webgl: webgl.getCameraState() });

      const playerMethods = ["seekFrame", "seekProgress", "play", "pause", "destroy", "getSnapshot", "getCameraState", "getCameraCatalog", "subscribe", "onFrameSampled", "onFrameRendered", "setCameraOverride", "clearCameraOverrides", "setActiveCameraOverride", "setLoop", "setPlaybackRate"];
      assert("renderer-neutral method surface", [svg, webgl, svgSequence, webglSequence].every((player) => playerMethods.every((name) => typeof player[name] === "function")), playerMethods);

      await svgSequence.seekFrame(5.75);
      await webglSequence.seekFrame(5.75);
      assert("sequence before cut", JSON.stringify(svgSequence.getSnapshot().scope) === JSON.stringify(webglSequence.getSnapshot().scope) && svgSequence.getSnapshot().scope.artboardId === "camera-artboard" && svgSequence.getSnapshot().scope.localFrame === 5.75 && cameraJson(svgSequence) === cameraJson(webglSequence), { svg: svgSequence.getSnapshot(), webgl: webglSequence.getSnapshot() });

      await svgSequence.setActiveCameraOverride("camera-a");
      await webglSequence.setActiveCameraOverride("camera-a");
      await svgSequence.setCameraOverride("camera-a", { mode: "replace", channels: { bodyX: 365 } });
      await webglSequence.setCameraOverride("camera-a", { mode: "replace", channels: { bodyX: 365 } });
      await svgSequence.seekFrame(6.25);
      await webglSequence.seekFrame(6.25);
      const svgCutSnapshot = svgSequence.getSnapshot();
      const webglCutSnapshot = webglSequence.getSnapshot();
      assert("sequence cut scope", JSON.stringify(svgCutSnapshot.scope) === JSON.stringify(webglCutSnapshot.scope) && svgCutSnapshot.frame === 6.25 && svgCutSnapshot.scope.artboardId === "camera-artboard-b" && svgCutSnapshot.scope.localFrame === 0.25, { svg: svgCutSnapshot.scope, webgl: webglCutSnapshot.scope });
      assert("active override dormancy", svgSequence.getCameraState().kind === "single" && svgSequence.getCameraState().view.cameraRigId === "camera-c" && cameraJson(svgSequence) === cameraJson(webglSequence), { svg: svgSequence.getCameraState(), webgl: webglSequence.getCameraState() });
      const sequenceCanvas = document.querySelector("#webgl-sequence canvas");
      assert("mixed-size surface cut", sequenceCanvas?.width === 360 && sequenceCanvas?.height === 360, { width: sequenceCanvas?.width, height: sequenceCanvas?.height });
      await svgSequence.seekFrame(2);
      await webglSequence.seekFrame(2);
      assert("override resumes after compatible cut", svgSequence.getCameraState().kind === "single" && svgSequence.getCameraState().view.body.x === 365 && cameraJson(svgSequence) === cameraJson(webglSequence), { svg: svgSequence.getCameraState(), webgl: webglSequence.getCameraState() });

      const hooksAreOrdered = (events) => {
        const phasesByRequest = new Map();
        for (const event of events) {
          const phases = phasesByRequest.get(event.requestId) ?? [];
          phases.push(event.phase);
          phasesByRequest.set(event.requestId, phases);
        }
        return [...phasesByRequest.values()].every((phases) => phases.join(",") === "sampled,rendered");
      };
      assert("sampled before rendered", Object.values(trace.events).every(hooksAreOrdered), trace.events);

      const stable = svg.getSnapshot();
      assert("snapshot identity", stable === svg.getSnapshot(), { revision: stable.revision });

      const q1 = webgl.seekFrame(1.25);
      const q2 = webgl.seekFrame(2.5);
      const q3 = webgl.seekFrame(3.75);
      const queueResults = await Promise.all([q1, q2, q3]);
      trace.queueResults = queueResults.map((result) => ({ status: result.status, requestId: result.requestId, byRequestId: result.byRequestId }));
      assert("bounded latest wins", queueResults[0].status === "committed" && queueResults[1].status === "superseded" && queueResults[2].status === "committed", trace.queueResults);

      const svgBaseline = await mountSvg(document.querySelector("#svg-baseline"), { source: { kind: "embedded" }, autoplay: false });
      const webglBaseline = await mountWebgl(document.querySelector("#webgl-baseline"), { source: { kind: "embedded" }, autoplay: false });
      trace.performance = {
        svg: { hooked: await benchmark(svg), baseline: await benchmark(svgBaseline) },
        webgl: { hooked: await benchmark(webgl), baseline: await benchmark(webglBaseline) },
      };
      assert("hook overhead", noMaterialRegression(trace.performance.svg.hooked, trace.performance.svg.baseline) && noMaterialRegression(trace.performance.webgl.hooked, trace.performance.webgl.baseline), trace.performance);
      svgBaseline.destroy();
      webglBaseline.destroy();

      let lifecycleEvents = 0;
      const lifecycle = await mountSvg(document.querySelector("#lifecycle"), {
        source: { kind: "embedded" },
        onFrameRendered: () => { lifecycleEvents += 1; },
      });
      lifecycle.destroy();
      const afterDestroy = await lifecycle.seekFrame(2);
      const eventCountAfterDestroy = lifecycleEvents;
      await Promise.resolve();
      assert("destroy settlement", afterDestroy.status === "disposed" && lifecycleEvents === eventCountAfterDestroy, { afterDestroy, lifecycleEvents });

      trace.react = await waitForReactHarness();
      assert("React latest callback without remount", trace.react.status === "passed", trace.react);

      await svg.seekFrame(6);
      await webgl.seekFrame(6);
      trace.finalSnapshots = { svg: svg.getSnapshot(), webgl: webgl.getSnapshot() };
      trace.completedAt = new Date().toISOString();
      trace.status = "passed";
      window.__cameraRuntimeVerification = trace;
      document.querySelector("#status").dataset.state = "passed";
      document.querySelector("#status").textContent = "passed";
      document.querySelector("#trace").textContent = JSON.stringify(trace, null, 2);
    } catch (error) {
      trace.status = "failed";
      trace.error = error instanceof Error ? error.message : String(error);
      window.__cameraRuntimeVerification = trace;
      document.querySelector("#status").dataset.state = "failed";
      document.querySelector("#status").textContent = "failed: " + trace.error;
      document.querySelector("#trace").textContent = JSON.stringify(trace, null, 2);
    }
  </script>
</body>
</html>`;

writeFileSync(path.join(outputDirectory, "index.html"), html);
writeFileSync(
	path.join(outputDirectory, "generation.json"),
	JSON.stringify(
		{
			generatedAt: new Date().toISOString(),
			svgRuntime: svgRuntime.fileName,
			webglRuntime: webglRuntime.fileName,
			sequenceSvgRuntime: sequenceSvgRuntime.fileName,
			sequenceWebglRuntime: sequenceWebglRuntime.fileName,
			reactHarness: "react-harness.js",
			webglSelectedByGpuContent: true,
			sequenceMixedArtboardSizes: true,
		},
		null,
		2,
	),
);

console.log(`Generated ${path.relative(process.cwd(), outputDirectory)}.`);
