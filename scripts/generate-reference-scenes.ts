import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { produce } from "immer";
import type { AgentDocumentContext } from "@/entities/agent/model/read-only";
import type { AgentSceneCommand } from "@/entities/agent/model/types";
import { applyAgentSceneCommands } from "@/entities/agent/model/write";
import { initialMotionDocument } from "@/entities/motion/model/seed-motion";
import { serializeMotionDocument } from "@/entities/motion/model/serialization";
import type { MotionDocument } from "@/entities/motion/model/types";
import { EMPTY_GRAMMAR_DOCUMENT } from "@/entities/motion-grammar/model/command";
import { serializeMotionGrammarLayer } from "@/entities/motion-grammar/model/parse";
import {
	ANALOG_FILM_LOOK_RECIPE,
	createApplyTimeDelayMaterializationMotionCommand,
	createApplyTimeDelayMaterializationSceneCommand,
	createTimeDelayMaterializationPlan,
	GLAMMER_TIME_DELAY_STAGE_BACKGROUND,
} from "@/entities/motion-grammar/model/time-delay-materialization";
import type { MotionGrammarBinding } from "@/entities/motion-grammar/model/types";
import { buildDotMatrixNode } from "@/entities/scene/model/dot-matrix";
import { allNodes } from "@/entities/scene/model/selectors";
import { serializeSceneDocument } from "@/entities/scene/model/serialization";
import {
	createAddSourceOpticsRigCommand,
	createBindSourceOpticsResponseCommand,
	createUpdateSourceOpticsRigCommand,
} from "@/entities/scene/model/source-optics-commands";
import type {
	BezierShape,
	MeshGradientPaint,
	MeshPoint,
	NodeGeometry,
	SceneDocument,
	VectorNode,
} from "@/entities/scene/model/types";
import { SCENE_SCHEMA_VERSION } from "@/entities/scene/model/types";
import { createExportBundle } from "@/features/export/model/bundle";
import {
	createMotionCodeHtmlAsset,
	createMotionCodeRuntimeAsset,
} from "@/features/export/model/code";
import { exportOptimizationOptionsForProfile } from "@/features/export/model/optimization";
import { STROKE_WIDTH_PROFILE_PRESETS } from "@/shared/stroke/width-profile";

/**
 * Authoring loop for the reference-scene fixture library. Each source pairs a
 * scene with its motion side-car (and optional motion-grammar bindings); the
 * generator serializes everything through the editor's real persistence
 * serializers and emits a pure-string `*.fixture.ts` module. Storing serialized
 * strings (not typed object literals) is deliberate: the TypeScript compiler
 * treats the strings as opaque, so the only thing that proves a fixture still
 * matches the current schema is the runtime deserialize path exercised by
 * `check:reference-scenes` — which makes every fixture a real regression fixture.
 *
 * Re-run with `bun run gen:reference-scenes` whenever a source below changes.
 */

/**
 * Pinned timestamp so regenerating a fixture is byte-deterministic. The
 * serializers default `savedAt` to `new Date().toISOString()`; without a fixed
 * value every generator run would rewrite the fixtures with a fresh timestamp,
 * producing perpetual churn. Mirrors the editor's legacy-seed comparison date.
 */
const REFERENCE_SCENE_SAVED_AT = "2024-01-01T00:00:00.000Z";

const ARTBOARD_WIDTH = 1280;
const ARTBOARD_HEIGHT = 720;
const SCENE_FPS = 30;

/**
 * The reference scenes wear the editor's actual **Analog Film** look at the FRAME
 * level (`artboard.effectIntent.visualRecipe = ANALOG_FILM_LOOK_RECIPE`), exactly
 * as the Time Delay preset does. The SVG exporter now applies the frame look
 * (grain + chromatic aberration) to the poster, so the shapes need no per-node
 * look — they are plain charcoal fills and the frame finish does the rest (this
 * also keeps the fixture payload small). Fill and stage are the preset's own
 * values: `rgb(29 31 35)` charcoal on the `#f4f3ef` film stage.
 */
const PRESET_FILL = "rgb(29 31 35)";
const PRESET_BACKGROUND = GLAMMER_TIME_DELAY_STAGE_BACKGROUND;

const ellipse = (cx: number, cy: number, radius: number): NodeGeometry => ({
	kind: "ellipse",
	bounds: {
		x: cx - radius,
		y: cy - radius,
		width: radius * 2,
		height: radius * 2,
	},
});

const dot = (
	id: string,
	cx: number,
	cy: number,
	radius: number,
	fill: string,
): VectorNode => ({
	id,
	name: id,
	geometry: ellipse(cx, cy, radius),
	transform: {
		position: { x: 0, y: 0 },
		rotation: 0,
		scale: { x: 1, y: 1 },
		anchor: { x: 0, y: 0 },
	},
	style: { fill, stroke: "none", strokeWidth: 0, opacity: 1 },
	visible: true,
	locked: false,
});

/**
 * Builds the "Cycle" reference scene: a row of dots that each travel a closed
 * loop, phase-offset so the row reads as a continuous traveling wave. This is
 * the `cyclic-path-travel` Glammer technique — the same Cycle motion system the
 * editor authors — so `radius` / `periodFrames` / `phaseStepDegrees` here are
 * exactly the parameters the product how-to teaches. Fill, look, and stage are
 * the Time Delay preset's own values so the gallery is one consistent product
 * look; sizes bell toward the center.
 */
const buildCycleSource = (): {
	scene: SceneDocument;
	motion: MotionDocument;
	grammarBindings: readonly MotionGrammarBinding[];
} => {
	const radii = [44, 56, 70, 56, 44];
	const count = radii.length;
	const spacing = 236;
	const startX = ARTBOARD_WIDTH / 2 - ((count - 1) * spacing) / 2;
	const centerY = ARTBOARD_HEIGHT / 2;
	const nodes: VectorNode[] = radii.map((radius, index) =>
		dot(
			`cycle-dot-${index + 1}`,
			startX + index * spacing,
			centerY,
			radius,
			PRESET_FILL,
		),
	);

	const artboard = {
		id: "cycle-artboard",
		name: "Cycle",
		position: { x: 0, y: 0 },
		width: ARTBOARD_WIDTH,
		height: ARTBOARD_HEIGHT,
		background: PRESET_BACKGROUND,
		fps: SCENE_FPS,
		durationFrames: 90,
		effectIntent: { visualRecipe: ANALOG_FILM_LOOK_RECIPE },
	};

	const scene: SceneDocument = {
		schemaVersion: SCENE_SCHEMA_VERSION,
		id: "reference-cycle",
		name: "Cycle Motion",
		artboard,
		artboards: [artboard],
		currentArtboardId: artboard.id,
		layers: [
			{
				id: "cycle-layer",
				name: "Orbits",
				visible: true,
				locked: false,
				nodes,
			},
		],
	};

	const motion: MotionDocument = {
		schemaVersion: 1,
		fps: SCENE_FPS,
		durationFrames: 90,
		tracks: [],
		clips: [],
	};

	const grammarBindings: readonly MotionGrammarBinding[] = [
		{
			id: "cycle-orbit",
			techniqueId: "cyclic-path-travel",
			targetIds: nodes.map((node) => node.id),
			parameters: { periodFrames: 90, radius: 64, phaseStepDegrees: 72 },
		},
	];

	return { scene, motion, grammarBindings };
};

/**
 * Builds the "Time Delay" reference scene from the editor's REAL master-instance
 * authoring system. `createTimeDelayMaterializationPlan` mints the five body
 * dots, five satellites, the "Time Delay expansion" clip (whose provenance gates
 * the typed evaluator), and the authoring-profile binding (`profileVersion: 1` +
 * roleMap) that produces the staggered wave — exactly what the Inspector's
 * "Create Time Delay" action produces, not a bare grammar binding. The plan
 * mints node/clip ids via nanoid, so they are remapped to stable ids to keep the
 * committed fixture byte-deterministic across regenerations.
 */
const buildTimeDelaySource = (): {
	scene: SceneDocument;
	motion: MotionDocument;
	grammarBindings: readonly MotionGrammarBinding[];
	idRemap: ReadonlyMap<string, string>;
} => {
	const artboard = {
		id: "time-delay-artboard",
		name: "Time Delay",
		position: { x: 0, y: 0 },
		width: ARTBOARD_WIDTH,
		height: ARTBOARD_HEIGHT,
		background: "#f4f3ef",
		fps: SCENE_FPS,
		durationFrames: 90,
	};
	const baseScene: SceneDocument = {
		schemaVersion: SCENE_SCHEMA_VERSION,
		id: "reference-time-delay",
		name: "Time Delay Motion",
		artboard,
		artboards: [artboard],
		currentArtboardId: artboard.id,
		layers: [
			{
				id: "time-delay-layer",
				name: "Time Delay",
				visible: true,
				locked: false,
				nodes: [],
			},
		],
	};
	const baseMotion: MotionDocument = {
		schemaVersion: 1,
		fps: SCENE_FPS,
		durationFrames: 90,
		tracks: [],
		clips: [],
	};

	const plan = createTimeDelayMaterializationPlan({
		scene: baseScene,
		selectedNodeIds: [],
		bindingId: "time-delay-binding",
	});
	if (plan.status !== "ready") {
		throw new Error(`Time Delay plan blocked: ${plan.reason}`);
	}

	const scene = produce(baseScene, (draft) => {
		createApplyTimeDelayMaterializationSceneCommand(plan).run(draft);
	});
	const motion = produce(baseMotion, (draft) => {
		createApplyTimeDelayMaterializationMotionCommand(plan).run(draft);
	});

	const idRemap = new Map<string, string>();
	plan.generatedNodes.forEach((generated, index) => {
		idRemap.set(generated.node.id, `time-delay-node-${index + 1}`);
	});
	idRemap.set(plan.clip.id, "time-delay-expansion-clip");

	return { scene, motion, grammarBindings: [plan.binding], idRemap };
};

const IDENTITY_TRANSFORM = {
	position: { x: 0, y: 0 },
	rotation: 0,
	scale: { x: 1, y: 1 },
	anchor: { x: 0, y: 0 },
} as const;

const signalShape = (
	vertices: readonly (readonly [number, number])[],
): BezierShape => ({
	type: "Shape",
	closed: true,
	vertices,
	inTangents: vertices.map(() => [0, 0] as const),
	outTangents: vertices.map(() => [0, 0] as const),
});

const buildReferenceDotMatrixNode = (
	id: string,
	options: Parameters<typeof buildDotMatrixNode>[0],
	data?: Record<string, unknown>,
): VectorNode => {
	const result = buildDotMatrixNode(options);
	if (!result.ok) {
		throw new Error(
			`Invalid ${id} dot matrix: ${result.issues
				.map((issue) => issue.message)
				.join(" ")}`,
		);
	}
	return {
		...result.node,
		id,
		data: { ...result.node.data, ...data },
	};
};

/**
 * Source-independent integration proof for exact affine parenting, authored
 * temporal curves, a channel constraint, nested traveling matte, and ordered
 * morph correspondence. The scene follows the concept gate in
 * `original-combined-motion-brief.md`; it is internal until user visual review.
 */
const buildSignalHandoffSource = (): {
	scene: SceneDocument;
	motion: MotionDocument;
} => {
	const artboard = {
		id: "signal-handoff-artboard",
		name: "Signal Handoff",
		position: { x: 0, y: 0 },
		width: 960,
		height: 540,
		background: "#10151f",
		fps: SCENE_FPS,
		durationFrames: 90,
	};
	const maskData = (contentNodeId: string) => ({
		appearance: {
			maskRelations: [
				{
					id: `signal-aperture-mask:${contentNodeId}`,
					kind: "mask",
					origin: "native",
					affectedNodeIds: [contentNodeId],
					fallback: "unclipped-vector",
					maskNodeId: "signal-aperture",
					settings: {
						channel: "red",
						sourceSampling: "pre-effects",
						coordinateSpace: "artboard",
					},
				},
			],
		},
	});
	const controller: VectorNode = {
		id: "signal-controller",
		name: "Pressure controller",
		geometry: { kind: "line", start: { x: 0, y: 0 }, end: { x: 0, y: 0 } },
		transform: {
			position: { x: 160, y: 270 },
			rotation: -8,
			scale: { x: 1.25, y: 0.78 },
			anchor: { x: 0, y: 0 },
		},
		style: { fill: "none", stroke: "none", strokeWidth: 0, opacity: 1 },
		visible: true,
		locked: false,
		motionController: { kind: "motion-controller", handleRadius: 22 },
	};
	const aperture: VectorNode = {
		id: "signal-aperture",
		name: "Changing aperture",
		geometry: {
			kind: "path",
			shape: signalShape([
				[0, -86],
				[54, 0],
				[0, 86],
				[-54, 0],
			]),
		},
		transform: IDENTITY_TRANSFORM,
		style: { fill: "#ff704d", stroke: "none", strokeWidth: 0, opacity: 1 },
		visible: true,
		locked: false,
		motionParent: {
			parentNodeId: controller.id,
			bindMatrix: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
		},
	};
	const sourceGroup: VectorNode = {
		id: "signal-aperture-group",
		name: "Aperture source group",
		geometry: { kind: "line", start: { x: 0, y: 0 }, end: { x: 0, y: 0 } },
		transform: IDENTITY_TRANSFORM,
		style: { fill: "none", stroke: "none", strokeWidth: 0, opacity: 1 },
		visible: true,
		locked: false,
		children: [aperture],
	};
	const wakeMatrixColumns = 64;
	const wakeMatrixRows = 9;
	const wakeBandWidth = 13;
	const wake: VectorNode = {
		...buildReferenceDotMatrixNode("signal-wake", {
			name: "Inherited wake",
			origin: { x: -230, y: -22 },
			rows: Array.from({ length: wakeMatrixRows }, (_, rowIndex) => {
				const firstActiveColumn = Math.round(
					(rowIndex * (wakeMatrixColumns - wakeBandWidth)) /
						(wakeMatrixRows - 1),
				);
				const lastActiveColumn = firstActiveColumn + wakeBandWidth - 1;
				return Array.from({ length: wakeMatrixColumns }, (_, columnIndex) =>
					columnIndex >= firstActiveColumn && columnIndex <= lastActiveColumn
						? "#"
						: ".",
				).join("");
			}),
			cellSize: 5,
			gap: 0,
			style: { fill: "#76d6d0", opacity: 0.58 },
		}),
		transform: {
			position: { x: 70, y: 320 },
			rotation: 0,
			scale: { x: 1, y: 1 },
			anchor: { x: 0, y: 0 },
		},
		transformConstraint: {
			id: "signal-wake-constraint",
			sourceNodeId: controller.id,
			channels: ["position", "rotation"],
			strength: 1,
			sourceSpace: "world",
			destinationSpace: "world",
			maintainOffset: true,
			offset: {
				position: { x: -90, y: 50 },
				rotation: 8,
				scale: { x: 1, y: 1 },
			},
		},
	};
	const axis: VectorNode = {
		id: "signal-axis",
		name: "Decision axis",
		geometry: {
			kind: "line",
			start: { x: 96, y: 330 },
			end: { x: 872, y: 330 },
		},
		transform: IDENTITY_TRANSFORM,
		style: { fill: "none", stroke: "#273246", strokeWidth: 2, opacity: 1 },
		visible: true,
		locked: false,
	};
	const signalMatrixColumns = 21;
	const signalParent = {
		parentNodeId: controller.id,
		bindMatrix: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
	} as const;
	const signalPlate: VectorNode = {
		...buildReferenceDotMatrixNode(
			"signal-plate",
			{
				name: "Main signal field",
				origin: { x: -52.5, y: -27.5 },
				rows: Array.from({ length: 11 }, () => "#".repeat(signalMatrixColumns)),
				cellSize: 5,
				gap: 0,
				style: { fill: "#f2e8ce" },
			},
			maskData("signal-plate"),
		),
		motionParent: signalParent,
	};
	const accentPlate: VectorNode = {
		...buildReferenceDotMatrixNode(
			"signal-accent-plate",
			{
				name: "Signal accent band",
				origin: { x: -52.5, y: -27.5 },
				rows: Array.from({ length: 2 }, () => "#".repeat(signalMatrixColumns)),
				cellSize: 5,
				gap: 0,
				style: { fill: "#ff704d" },
			},
			maskData("signal-accent-plate"),
		),
		motionParent: signalParent,
	};
	const scene: SceneDocument = {
		schemaVersion: SCENE_SCHEMA_VERSION,
		id: "reference-signal-handoff",
		name: "Signal Handoff",
		artboard,
		artboards: [artboard],
		currentArtboardId: artboard.id,
		layers: [
			{
				id: "signal-axis-layer",
				name: "Axis",
				visible: true,
				locked: false,
				nodes: [axis],
			},
			{
				id: "signal-wake-layer",
				name: "Wake",
				visible: true,
				locked: false,
				nodes: [wake],
			},
			{
				id: "signal-plate-layer",
				name: "Signal",
				visible: true,
				locked: false,
				nodes: [signalPlate],
			},
			{
				id: "signal-accent-layer",
				name: "Accent",
				visible: true,
				locked: false,
				nodes: [accentPlate],
			},
			{
				id: "signal-source-layer",
				name: "Aperture source",
				visible: true,
				locked: false,
				nodes: [sourceGroup, controller],
			},
		],
	};
	const exactCurve = { x1: 0.12, y1: 0, x2: 0.44, y2: 1.16 } as const;
	const settleCurve = { x1: 0.3, y1: 0.08, x2: 0.82, y2: 1 } as const;
	const numericTrack = (
		id: string,
		property: "x" | "y" | "rotation" | "scaleX" | "scaleY",
		values: readonly [number, number][],
	) => ({
		id,
		target: { nodeId: controller.id, property },
		keyframes: values.map(([time, value], index) => ({
			time,
			value,
			outInterpolationType: 6613,
			...(index < values.length - 1
				? { outTemporalCurve: index === 0 ? exactCurve : settleCurve }
				: {}),
		})),
	});
	const motion: MotionDocument = {
		schemaVersion: 1,
		fps: SCENE_FPS,
		durationFrames: 90,
		tracks: [
			numericTrack("signal-controller-x", "x", [
				[0, 160],
				[52, 748],
				[76, 792],
			]),
			numericTrack("signal-controller-y", "y", [
				[0, 270],
				[52, 248],
				[76, 270],
			]),
			numericTrack("signal-controller-rotation", "rotation", [
				[0, -8],
				[52, 18],
				[76, 4],
			]),
			numericTrack("signal-controller-scale-x", "scaleX", [
				[0, 1.25],
				[52, 1.58],
				[76, 1.34],
			]),
			numericTrack("signal-controller-scale-y", "scaleY", [
				[0, 0.78],
				[52, 0.62],
				[76, 0.76],
			]),
			{
				id: "signal-aperture-rotation",
				target: { nodeId: aperture.id, property: "rotation" },
				keyframes: [
					{
						time: 0,
						value: 0,
						outInterpolationType: 6613,
						outTemporalCurve: exactCurve,
					},
					{
						time: 52,
						value: 26,
						outInterpolationType: 6613,
						outTemporalCurve: settleCurve,
					},
					{ time: 76, value: 10 },
				],
			},
			{
				id: "signal-aperture-morph",
				target: { nodeId: aperture.id, property: "pathShape" },
				keyframes: [
					{
						time: 0,
						value: signalShape([
							[0, -86],
							[54, 0],
							[0, 86],
							[-54, 0],
						]),
						outInterpolationType: 6613,
						outTemporalCurve: exactCurve,
					},
					{
						time: 52,
						value: signalShape([
							[-78, -30],
							[76, -30],
							[110, 0],
							[-78, 30],
						]),
						outInterpolationType: 6613,
						outTemporalCurve: settleCurve,
					},
					{
						time: 76,
						value: signalShape([
							[-62, -38],
							[82, -22],
							[116, 0],
							[-62, 38],
						]),
					},
				],
			},
		],
		positionPaths: [
			{
				id: "signal-controller-path",
				nodeId: controller.id,
				keys: [
					{
						frame: 0,
						position: { x: 160, y: 270 },
						spatialMode: "continuous",
						outTangent: { x: 170, y: -44 },
						inTangent: { x: -170, y: 44 },
					},
					{
						frame: 52,
						position: { x: 748, y: 248 },
						spatialMode: "continuous",
						outTangent: { x: 42, y: 30 },
						inTangent: { x: -42, y: -30 },
					},
					{
						frame: 76,
						position: { x: 792, y: 270 },
						spatialMode: "auto",
						inTangent: { x: 0, y: 0 },
						outTangent: { x: 0, y: 0 },
					},
				],
			},
		],
		clips: [],
	};
	return { scene, motion };
};

const SIGNAL_MATERIAL_ARTBOARD_ID = "signal-handoff-material-artboard";
const SIGNAL_MATERIAL_RIG_ID = "signal-receiver-source-optics";
const SIGNAL_MATERIAL_RESPONSE_ID = "signal-receiver-response";
const SIGNAL_MATERIAL_RECEIVER_ID = "signal-receiver";

/**
 * Builds the isolated material-coupled successor to `signal-handoff`. The
 * accepted motion proof remains byte-stable; this variant adds one ordinary
 * receiving carrier, authors its grain through the agent command bus, and
 * couples it to the existing moving aperture through the native Source Optics
 * command surface. Response amounts wake only after contact through typed
 * Source Optics motion tracks, so the quiet-before-contact read is authored
 * rather than inferred from source distance.
 */
const buildMaterialSignalHandoffSource = (): {
	scene: SceneDocument;
	motion: MotionDocument;
} => {
	const accepted = buildSignalHandoffSource();
	const receiver: VectorNode = {
		id: SIGNAL_MATERIAL_RECEIVER_ID,
		name: "Receiving knot",
		geometry: {
			kind: "ellipse",
			bounds: { x: 708, y: 178, width: 184, height: 184 },
		},
		transform: IDENTITY_TRANSFORM,
		style: {
			fill: "#23334a",
			stroke: "#4b6476",
			strokeWidth: 3,
			opacity: 1,
		},
		visible: true,
		locked: false,
	};
	const artboard = {
		...accepted.scene.artboard,
		id: SIGNAL_MATERIAL_ARTBOARD_ID,
		name: "Signal Handoff — Material Wake",
	};
	const [axisLayer, ...remainingLayers] = accepted.scene.layers;
	if (!axisLayer) {
		throw new Error(
			"Signal Handoff material candidate requires its Axis layer.",
		);
	}
	const baseScene: SceneDocument = {
		...accepted.scene,
		id: "reference-signal-handoff-material",
		name: "Signal Handoff — Material Wake",
		artboard,
		artboards: [artboard],
		currentArtboardId: artboard.id,
		layers: [
			axisLayer,
			{
				id: "signal-receiver-layer",
				name: "Receiver",
				visible: true,
				locked: false,
				nodes: [receiver],
			},
			...remainingLayers,
		],
	};
	const grained = applyAgentSceneCommands(
		{
			scene: baseScene,
			motion: accepted.motion,
			grammar: EMPTY_GRAMMAR_DOCUMENT,
		},
		{
			commands: [
				{
					type: "scene/set-bindable-property",
					nodeId: SIGNAL_MATERIAL_RECEIVER_ID,
					propertyId: "effect.node-look.grain",
					value: 0.3,
				},
				{
					type: "scene/set-bindable-property",
					nodeId: SIGNAL_MATERIAL_RECEIVER_ID,
					propertyId: "effect.node-look.noiseScale",
					value: 0.42,
				},
			],
		},
	);
	const applyErrors = grained.issues.filter(
		(issue) => issue.severity === "error",
	);
	if (applyErrors.length > 0) {
		throw new Error(
			`Signal material recipe commands failed: ${applyErrors.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`,
		);
	}

	const scene = produce(grained.data.scene, (draft) => {
		const receiverDraft = allNodes(draft).find(
			(node) => node.id === SIGNAL_MATERIAL_RECEIVER_ID,
		);
		if (!receiverDraft?.recipe) {
			throw new Error(
				"Signal material candidate requires the receiver grain recipe.",
			);
		}
		receiverDraft.recipe.alphaMode = "straight";
		receiverDraft.recipe.surface.paint = {
			kind: "solid",
			color: "#23334a",
		};
		createAddSourceOpticsRigCommand(
			SIGNAL_MATERIAL_ARTBOARD_ID,
			"signal-aperture",
			{
				id: SIGNAL_MATERIAL_RIG_ID,
				name: "Aperture-driven receiver wake",
			},
		).run(draft);
		createUpdateSourceOpticsRigCommand(
			SIGNAL_MATERIAL_ARTBOARD_ID,
			SIGNAL_MATERIAL_RIG_ID,
			{
				bloom: {
					enabled: true,
					radiusX: 30,
					radiusY: 18,
					intensity: 0.68,
					threshold: 0.48,
					blendMode: "screen",
				},
				rays: [
					{
						id: "signal-receiver-ray",
						enabled: true,
						angle: 11,
						length: 118,
						width: 9,
						intensity: 0.16,
						falloff: 0.74,
						oppositeSideRatio: 0.12,
					},
				],
				atmosphere: {
					enabled: true,
					mix: 0.08,
					falloff: 0.82,
					reach: 130,
					tint: "#76d6d0",
				},
				lens: { enabled: true, mix: 0.08, chroma: 1.4, reach: 24 },
			},
		).run(draft);
		createBindSourceOpticsResponseCommand(
			SIGNAL_MATERIAL_ARTBOARD_ID,
			SIGNAL_MATERIAL_RIG_ID,
			SIGNAL_MATERIAL_RECEIVER_ID,
			{
				id: SIGNAL_MATERIAL_RESPONSE_ID,
				response: {
					surface: {
						amount: 0.78,
						width: 18,
						softness: 5,
						tint: "#c7fff2",
					},
					diffusion: {
						amount: 0.36,
						depth: 26,
						softness: 10,
						tint: "#5fe0d1",
					},
					edge: {
						amount: 0.62,
						width: 10,
						softness: 2,
						tint: "#f6ffff",
					},
					microstructure: { amount: 0.58 },
					spectral: { amount: 0.1, offset: 1.2 },
				},
			},
		).run(draft);
	});

	const responseTrack = (
		id: string,
		parameterId: string,
		peak: number,
		settle: number,
	) => ({
		id,
		target: {
			kind: "binding" as const,
			artboardId: SIGNAL_MATERIAL_ARTBOARD_ID,
			rigId: SIGNAL_MATERIAL_RIG_ID,
			bindingId: SIGNAL_MATERIAL_RESPONSE_ID,
			parameterId,
		},
		keyframes: [
			{ time: 0, value: 0 },
			{
				time: 46,
				value: 0,
				outInterpolationType: 6613,
				outTemporalCurve: { x1: 0.16, y1: 0, x2: 0.38, y2: 1.12 },
			},
			{
				time: 58,
				value: peak,
				outInterpolationType: 6613,
				outTemporalCurve: { x1: 0.3, y1: 0.08, x2: 0.82, y2: 1 },
			},
			{ time: 72, value: settle },
		],
	});
	const motion: MotionDocument = {
		...accepted.motion,
		sourceOpticsTracks: [
			responseTrack(
				"signal-receiver-surface-wake",
				"source-optics.surface.amount",
				0.78,
				0.64,
			),
			responseTrack(
				"signal-receiver-diffusion-wake",
				"source-optics.diffusion.amount",
				0.36,
				0.24,
			),
			responseTrack(
				"signal-receiver-edge-wake",
				"source-optics.edge.amount",
				0.62,
				0.44,
			),
			responseTrack(
				"signal-receiver-grain-wake",
				"source-optics.microstructure.amount",
				0.58,
				0.42,
			),
		],
	};
	return { scene, motion };
};

const PROJECTED_SOLID_ARTBOARD_ID = "projected-solid-probe-artboard";
const PROJECTED_SOLID_RIG_ID = "projected-solid-source-optics";
const PROJECTED_SOLID_SOURCE_ID = "projected-solid-light-source";
const PROJECTED_SOLID_FRONT_ID = "projected-solid-front";
const PROJECTED_SOLID_SIDE_ID = "projected-solid-side";

type ProjectedSolidPoint = readonly [number, number];

const projectedSolidShape = (
	vertices: readonly ProjectedSolidPoint[],
	inTangents?: readonly ProjectedSolidPoint[],
	outTangents?: readonly ProjectedSolidPoint[],
): BezierShape => ({
	type: "Shape",
	closed: true,
	vertices,
	inTangents: inTangents ?? vertices.map(() => [0, 0] as const),
	outTangents: outTangents ?? vertices.map(() => [0, 0] as const),
});

const shiftedProjectedSolidShape = (
	shape: BezierShape,
	dx: number,
	dy: number,
): BezierShape => ({
	...shape,
	vertices: shape.vertices.map(
		([x, y]) =>
			[Number((x + dx).toFixed(3)), Number((y + dy).toFixed(3))] as const,
	),
});

/**
 * Generates the source-independent projected-solid falsification probe from a
 * frozen profile/axis/depth recipe. The output is deliberately ordinary path
 * nodes: it proves silhouette, role ordering, material coupling, persistence,
 * and delivery without pretending that direct edits to one emitted face can
 * regenerate its siblings. That missing live owner remains the contract gap.
 */
const buildProjectedSolidProbeSource = (): {
	scene: SceneDocument;
	motion: MotionDocument;
} => {
	const profile = projectedSolidShape(
		[
			[350, 230],
			[568, 184],
			[642, 322],
			[418, 416],
		],
		[
			[0, 0],
			[0, 0],
			[-18, -44],
			[88, -34],
		],
		[
			[0, 0],
			[0, 0],
			[-64, 78],
			[0, 0],
		],
	);
	const axisDegrees = 31;
	const depth = 180;
	const axisRadians = (axisDegrees * Math.PI) / 180;
	const axis = {
		x: Number((Math.cos(axisRadians) * depth).toFixed(3)),
		y: Number((-Math.sin(axisRadians) * depth).toFixed(3)),
	};
	const backProfile = shiftedProjectedSolidShape(profile, axis.x, axis.y);
	const [front0, front1, front2, front3] = profile.vertices;
	const [back0, back1, back2, back3] = backProfile.vertices;
	if (
		!front0 ||
		!front1 ||
		!front2 ||
		!front3 ||
		!back0 ||
		!back1 ||
		!back2 ||
		!back3
	) {
		throw new Error("Projected-solid probe requires a four-point profile.");
	}

	const back: VectorNode = {
		id: "projected-solid-back",
		name: "Back — generated profile",
		geometry: { kind: "path", shape: backProfile },
		transform: IDENTITY_TRANSFORM,
		style: {
			fill: "#171a38",
			stroke: "#3f4968",
			strokeWidth: 2,
			opacity: 1,
		},
		visible: true,
		locked: false,
	};
	const side: VectorNode = {
		id: PROJECTED_SOLID_SIDE_ID,
		name: "Side — generated depth carrier",
		geometry: {
			kind: "path",
			shape: projectedSolidShape([front0, front1, back1, back0]),
			subpaths: [
				projectedSolidShape([front1, front2, back2, back1]),
				projectedSolidShape([front2, front3, back3, back2]),
			],
			fillRule: "nonzero",
		},
		transform: IDENTITY_TRANSFORM,
		style: {
			fill: "#8d7351",
			stroke: "#b69b70",
			strokeWidth: 2,
			opacity: 1,
			fills: [
				{
					kind: "linear-gradient",
					from: { x: 380, y: 410 },
					to: { x: 760, y: 90 },
					stops: [
						{ offset: 0, color: "#66513f" },
						{ offset: 0.58, color: "#9a7f59" },
						{ offset: 1, color: "#c5aa78" },
					],
				},
			],
		},
		visible: true,
		locked: false,
	};
	const front: VectorNode = {
		id: PROJECTED_SOLID_FRONT_ID,
		name: "Front — source profile snapshot",
		geometry: { kind: "path", shape: profile },
		transform: IDENTITY_TRANSFORM,
		style: {
			fill: "#2b2b62",
			stroke: "#575890",
			strokeWidth: 2,
			opacity: 1,
			fills: [
				{
					kind: "linear-gradient",
					from: { x: 350, y: 420 },
					to: { x: 610, y: 180 },
					stops: [
						{ offset: 0, color: "#20204e" },
						{ offset: 0.62, color: "#343572" },
						{ offset: 1, color: "#4d4f91" },
					],
				},
			],
		},
		visible: true,
		locked: false,
	};
	const edge: VectorNode = {
		id: "projected-solid-source-edge",
		name: "Source-facing edge",
		geometry: {
			kind: "path",
			shape: {
				type: "Shape",
				closed: false,
				vertices: [front0, front1, back1],
				inTangents: [
					[0, 0],
					[-46, 10],
					[-42, 24],
				],
				outTangents: [
					[46, -10],
					[42, -24],
					[0, 0],
				],
			},
		},
		transform: IDENTITY_TRANSFORM,
		style: {
			fill: "none",
			stroke: "#bdeef2",
			strokeWidth: 7,
			opacity: 0.86,
			effects: [{ kind: "layer-blur", radius: 2 }],
		},
		visible: true,
		locked: false,
	};
	const source: VectorNode = {
		id: PROJECTED_SOLID_SOURCE_ID,
		name: "Single material source",
		geometry: {
			kind: "ellipse",
			bounds: { x: 246, y: 102, width: 24, height: 24 },
		},
		transform: IDENTITY_TRANSFORM,
		style: {
			fill: "#bdeef2",
			stroke: "none",
			strokeWidth: 0,
			opacity: 1,
		},
		visible: true,
		locked: false,
	};
	const axisGuide: VectorNode = {
		id: "projected-solid-axis-guide",
		name: "31 degree axis guide",
		geometry: {
			kind: "line",
			start: { x: 316, y: 450 },
			end: { x: 316 + axis.x, y: 450 + axis.y },
		},
		transform: IDENTITY_TRANSFORM,
		style: {
			fill: "none",
			stroke: "#586174",
			strokeWidth: 2,
			opacity: 0.5,
		},
		visible: true,
		locked: false,
	};
	const artboard = {
		id: PROJECTED_SOLID_ARTBOARD_ID,
		name: "Projected Solid — Asymmetric Probe",
		position: { x: 0, y: 0 },
		width: 960,
		height: 540,
		background: "#10131d",
		fps: SCENE_FPS,
		durationFrames: 90,
	};
	const baseScene: SceneDocument = {
		schemaVersion: SCENE_SCHEMA_VERSION,
		id: "reference-projected-solid-probe",
		name: "Projected Solid — Asymmetric Probe",
		artboard,
		artboards: [artboard],
		currentArtboardId: artboard.id,
		layers: [
			{
				id: "projected-solid-guides-layer",
				name: "Axis",
				visible: true,
				locked: false,
				nodes: [axisGuide],
			},
			{
				id: "projected-solid-carriers-layer",
				name: "Generated carriers",
				visible: true,
				locked: false,
				nodes: [back, side, front, edge, source],
			},
		],
	};
	const grained = applyAgentSceneCommands(
		{
			scene: baseScene,
			motion: initialMotionDocument,
			grammar: EMPTY_GRAMMAR_DOCUMENT,
		},
		{
			commands: [
				{
					type: "scene/set-bindable-property",
					nodeId: PROJECTED_SOLID_FRONT_ID,
					propertyId: "effect.node-look.grain",
					value: 0.2,
				},
				{
					type: "scene/set-bindable-property",
					nodeId: PROJECTED_SOLID_FRONT_ID,
					propertyId: "effect.node-look.noiseScale",
					value: 0.32,
				},
			],
		},
	);
	const applyErrors = grained.issues.filter(
		(issue) => issue.severity === "error",
	);
	if (applyErrors.length > 0) {
		throw new Error(
			`Projected-solid recipe commands failed: ${applyErrors.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`,
		);
	}
	const scene = produce(grained.data.scene, (draft) => {
		const frontDraft = allNodes(draft).find(
			(node) => node.id === PROJECTED_SOLID_FRONT_ID,
		);
		if (!frontDraft?.recipe) {
			throw new Error(
				"Projected-solid candidate requires the front grain recipe.",
			);
		}
		frontDraft.recipe.alphaMode = "straight";
		frontDraft.recipe.surface.paint = {
			kind: "linearGradient",
			from: "#20204e",
			to: "#4d4f91",
			angle: 5.45,
			balance: 0.08,
		};
		createAddSourceOpticsRigCommand(
			PROJECTED_SOLID_ARTBOARD_ID,
			PROJECTED_SOLID_SOURCE_ID,
			{
				id: PROJECTED_SOLID_RIG_ID,
				name: "Projected-solid regional source",
			},
		).run(draft);
		createUpdateSourceOpticsRigCommand(
			PROJECTED_SOLID_ARTBOARD_ID,
			PROJECTED_SOLID_RIG_ID,
			{
				bloom: {
					enabled: true,
					radiusX: 24,
					radiusY: 16,
					intensity: 0.56,
					threshold: 0.5,
					blendMode: "screen",
				},
				rays: [],
				atmosphere: {
					enabled: true,
					mix: 0.06,
					falloff: 0.86,
					reach: 170,
					tint: "#bdeef2",
				},
				lens: null,
			},
		).run(draft);
		createBindSourceOpticsResponseCommand(
			PROJECTED_SOLID_ARTBOARD_ID,
			PROJECTED_SOLID_RIG_ID,
			PROJECTED_SOLID_FRONT_ID,
			{
				id: "projected-solid-front-response",
				response: {
					surface: {
						amount: 0.52,
						width: 24,
						softness: 8,
						tint: "#d9fbff",
					},
					diffusion: {
						amount: 0.14,
						depth: 30,
						softness: 14,
						tint: "#6d8fc8",
					},
					edge: {
						amount: 0.38,
						width: 11,
						softness: 3,
						tint: "#bdeef2",
					},
					microstructure: { amount: 0.42 },
				},
			},
		).run(draft);
		createBindSourceOpticsResponseCommand(
			PROJECTED_SOLID_ARTBOARD_ID,
			PROJECTED_SOLID_RIG_ID,
			PROJECTED_SOLID_SIDE_ID,
			{
				id: "projected-solid-side-response",
				response: {
					surface: {
						amount: 0.3,
						width: 18,
						softness: 6,
						tint: "#f2d7a2",
					},
					edge: {
						amount: 0.26,
						width: 8,
						softness: 2,
						tint: "#bdeef2",
					},
				},
			},
		).run(draft);
	});
	const motion: MotionDocument = {
		schemaVersion: 1,
		fps: SCENE_FPS,
		durationFrames: 90,
		tracks: [],
		clips: [],
	};
	return { scene, motion };
};

/**
 * Recursively rewrites id strings — as both values and object keys — using the
 * supplied map. Applied to a document BEFORE serialization so the serializer's
 * key-sorting canonicalization runs on stable ids; remapping the serialized
 * string afterwards would leave id-keyed records (e.g. a binding `roleMap`) in a
 * run-specific sorted order, defeating determinism. Safe because the map keys are
 * unique nanoid-suffixed ids that never collide with field names.
 */
const remapIds = (
	value: unknown,
	map: ReadonlyMap<string, string>,
): unknown => {
	if (typeof value === "string") return map.get(value) ?? value;
	if (Array.isArray(value)) return value.map((item) => remapIds(item, map));
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			out[map.get(key) ?? key] = remapIds(item, map);
		}
		return out;
	}
	return value;
};

/**
 * Builds the "Corner radius & squircle" reference scene: three gradient-filled
 * rectangles showing the three corner treatments the editor supports — uniform
 * radius, per-corner radii, and squircle smoothing — plus one open path wearing
 * a variable-width stroke profile, showing the tapered-outline stroke render.
 * This is a DESIGN (vector) tutorial, so it carries no motion; the SVG renderer
 * bakes every corner variant to native vector paths (zero fidelity issues), the
 * gradients render as native `<linearGradient>`, and the profiled stroke renders
 * as a native filled outline path (see `stroke-outline.ts`). Authored as plain
 * literals with fixed ids, so it is inherently deterministic (no nanoid, no
 * remap).
 */
const buildCornerRadiusSource = (): {
	scene: SceneDocument;
	motion: MotionDocument;
} => {
	const size = 220;
	const top = 250;
	const rect = (
		id: string,
		x: number,
		geometryCorners: Record<string, unknown>,
	): VectorNode => ({
		id,
		name: id,
		geometry: {
			kind: "rect",
			bounds: { x, y: top, width: size, height: size },
			cornerRadius: 0,
			...geometryCorners,
		} as VectorNode["geometry"],
		transform: IDENTITY_TRANSFORM,
		style: {
			fill: PRESET_FILL,
			stroke: "none",
			strokeWidth: 0,
			opacity: 1,
		},
		visible: true,
		locked: false,
	});

	// A gentle open S-curve, well clear of the rects above (y 250-470) so the
	// tapered outline reads on its own. `strokeWidthProfile` is the built-in
	// "taper-out" preset: full width at the start narrowing to a fine point at
	// the end, the same authoring surface the Inspector's preset picker offers.
	const strokeProfileNode: VectorNode = {
		id: "stroke-width-profile-taper",
		name: "stroke-width-profile-taper",
		geometry: {
			kind: "path",
			shape: {
				type: "Shape",
				closed: false,
				vertices: [
					[60, 600],
					[640, 560],
					[1220, 600],
				],
				inTangents: [
					[0, 0],
					[-180, 30],
					[-180, -30],
				],
				outTangents: [
					[180, -30],
					[180, 30],
					[0, 0],
				],
			},
		},
		transform: IDENTITY_TRANSFORM,
		style: {
			fill: "none",
			stroke: PRESET_FILL,
			strokeWidth: 28,
			opacity: 1,
			strokeWidthProfile: STROKE_WIDTH_PROFILE_PRESETS["taper-out"],
		},
		visible: true,
		locked: false,
	};

	const nodes: VectorNode[] = [
		rect("corner-uniform", 170, { cornerRadius: 48 }),
		rect("corner-per-corner", 530, {
			cornerRadius: 0,
			cornerRadii: { tl: 84, tr: 14, br: 84, bl: 14 },
		}),
		rect("corner-squircle", 890, { cornerRadius: 60, cornerSmoothing: 0.6 }),
		strokeProfileNode,
	];

	const artboard = {
		id: "corner-radius-artboard",
		name: "Corner Radius",
		position: { x: 0, y: 0 },
		width: ARTBOARD_WIDTH,
		height: ARTBOARD_HEIGHT,
		background: PRESET_BACKGROUND,
		fps: SCENE_FPS,
		durationFrames: 90,
		effectIntent: { visualRecipe: ANALOG_FILM_LOOK_RECIPE },
	};

	const scene: SceneDocument = {
		schemaVersion: SCENE_SCHEMA_VERSION,
		id: "reference-corner-radius",
		name: "Corner Radius & Squircle",
		artboard,
		artboards: [artboard],
		currentArtboardId: artboard.id,
		layers: [
			{
				id: "corner-layer",
				name: "Shapes",
				visible: true,
				locked: false,
				nodes,
			},
		],
	};

	const motion: MotionDocument = {
		schemaVersion: 1,
		fps: SCENE_FPS,
		durationFrames: 90,
		tracks: [],
		clips: [],
	};

	return { scene, motion };
};

const ORB_SIZE = 720;
const ORB_GRID = 9;
const ORB_STEP = ORB_SIZE / (ORB_GRID - 1); // 90

type OrbAnchor = { readonly x: number; readonly y: number; readonly c: string };

/**
 * Multi-pole anchor field for the orb mesh gradient: violet highlights at the
 * top, an indigo core, and a deep-blue base. Ported verbatim from the
 * `render-orb.ts` authoring spike (repo root, not part of the app) that
 * reproduces the reference "grainy gradient orb" document authored live in the
 * product — kept in lockstep intentionally, do not renumber independently.
 */
const ORB_ANCHORS: readonly OrbAnchor[] = [
	{ x: 0.24, y: 0.14, c: "#e0c9ec" },
	{ x: 0.42, y: 0.2, c: "#cdbfe8" },
	{ x: 0.82, y: 0.2, c: "#a6c8f4" },
	{ x: 0.5, y: 0.44, c: "#3548da" },
	{ x: 0.9, y: 0.52, c: "#3f82f8" },
	{ x: 0.2, y: 0.84, c: "#241c6e" },
	{ x: 0.82, y: 0.8, c: "#2f2296" },
	{ x: 0.5, y: 0.92, c: "#201862" },
];

const ORB_ANCHOR_WEIGHT_EXP = 2.6;
const ORB_EXACT_HIT_EPS = 1e-4;

const orbClamp01 = (v: number): number => Math.max(0, Math.min(1, v));

function orbHexToRgbTuple(hex: string): readonly [number, number, number] {
	const clean = hex.replace(/^#/, "");
	return [
		Number.parseInt(clean.slice(0, 2), 16),
		Number.parseInt(clean.slice(2, 4), 16),
		Number.parseInt(clean.slice(4, 6), 16),
	];
}

function orbToHexChannel(value: number): string {
	return Math.round(orbClamp01(value / 255) * 255)
		.toString(16)
		.padStart(2, "0");
}

/** Inverse-distance-weighted blend of {@link ORB_ANCHORS} at normalized (nx, ny). */
function orbAnchorColorAt(nx: number, ny: number): string {
	for (const anchor of ORB_ANCHORS) {
		const d = Math.hypot(nx - anchor.x, ny - anchor.y);
		if (d < ORB_EXACT_HIT_EPS) return anchor.c;
	}
	let sumW = 0;
	let sumR = 0;
	let sumG = 0;
	let sumB = 0;
	for (const anchor of ORB_ANCHORS) {
		const d = Math.hypot(nx - anchor.x, ny - anchor.y);
		const w = 1 / d ** ORB_ANCHOR_WEIGHT_EXP;
		const [r, g, b] = orbHexToRgbTuple(anchor.c);
		sumW += w;
		sumR += w * r;
		sumG += w * g;
		sumB += w * b;
	}
	const r = Math.max(0, Math.min(255, Math.round(sumR / sumW)));
	const g = Math.max(0, Math.min(255, Math.round(sumG / sumW)));
	const b = Math.max(0, Math.min(255, Math.round(sumB / sumW)));
	return `#${orbToHexChannel(r)}${orbToHexChannel(g)}${orbToHexChannel(b)}`;
}

function orbSmoothstep(a: number, b: number, t: number): number {
	const x = orbClamp01((t - a) / (b - a));
	return x * x * (3 - 2 * x);
}

const ORB_OPACITY_INNER = 0.55;
const ORB_OPACITY_OUTER = 1.05;
const ORB_OPACITY_RADIUS_NORM = 0.52;

function orbOpacityAt(nx: number, ny: number): number {
	const d = Math.hypot(nx - 0.5, ny - 0.53) / ORB_OPACITY_RADIUS_NORM;
	return Number(
		(1 - orbSmoothstep(ORB_OPACITY_INNER, ORB_OPACITY_OUTER, d)).toFixed(3),
	);
}

/**
 * Builds the 9x9 mesh-gradient points for the orb aurora field, row-major, in
 * node-local units (the paint has no size/position of its own — it fills the
 * carrying rect's local bounds). Deterministic and side-effect free so
 * `check:reference-scenes-fresh` reproduces byte-identical output every run.
 */
function buildOrbMeshPaint(): MeshGradientPaint {
	const points: MeshPoint[] = [];
	for (let row = 0; row < ORB_GRID; row += 1) {
		for (let col = 0; col < ORB_GRID; col += 1) {
			const x = col * ORB_STEP;
			const y = row * ORB_STEP;
			const nx = x / ORB_SIZE;
			const ny = y / ORB_SIZE;
			points.push({
				point: { x, y },
				color: orbAnchorColorAt(nx, ny),
				opacity: orbOpacityAt(nx, ny),
			});
		}
	}
	return { kind: "mesh-gradient", rows: ORB_GRID, cols: ORB_GRID, points };
}

const ORB_NODE_ID = "grainy-orb";
const ORB_GRAIN_AMOUNT = 0.28;
/**
 * Requested noise-scale multiplier from the source authoring session. The
 * `node-look.noiseScale` capability writes directly to the canonical
 * `texture.grain.size` recipe path, which `normalizeVisualRecipe` clamps to
 * `0..1` (see `@/shared/vec-core`) — the same ceiling the Inspector's own
 * "Noise scale" slider has. A value above `1` is intentionally left as-is here
 * (not silently rewritten to a value inside the ceiling) so the generator
 * faithfully reproduces what that authoring session actually sent; the command
 * bus clamps it to `1`, exactly as it would for a live UI drag past the max.
 */
const ORB_GRAIN_NOISE_SCALE = 1.15;

/**
 * Builds the "Grainy gradient orb" reference scene: a single 720x720 rect
 * carrying a 9x9 mesh-gradient aurora field, a 10px layer blur for the glow,
 * and fine node-look grain — reproducing a real document authored live in the
 * product via the agent bridge. Unlike the other reference scenes, this one is
 * intentionally light/airy (no Analog Film frame look): a light `#f8fafc`
 * stage so the orb reads as a glow, not a charcoal silhouette.
 *
 * The mesh gradient and blur are authored as plain literals (native `NodeStyle`
 * fields), but the grain/noise-scale finish is applied through the REAL
 * `scene/set-bindable-property` agent command bus
 * (`applyAgentSceneCommands`) — the same code path the product's agent bridge
 * runs — so the emitted `node.recipe.texture.grain/noiseScale` values are
 * exactly what that authoring flow produces, not a hand-typed recipe shape.
 */
const buildGrainyOrbSource = (): {
	scene: SceneDocument;
	motion: MotionDocument;
} => {
	const orbNode: VectorNode = {
		id: ORB_NODE_ID,
		name: ORB_NODE_ID,
		geometry: {
			kind: "rect",
			bounds: { x: 0, y: 0, width: ORB_SIZE, height: ORB_SIZE },
			cornerRadius: 0,
		},
		transform: IDENTITY_TRANSFORM,
		style: {
			fill: "none",
			stroke: "none",
			strokeWidth: 0,
			opacity: 1,
			effects: [{ kind: "layer-blur", radius: 10 }],
			fills: [buildOrbMeshPaint()],
		},
		visible: true,
		locked: false,
	};

	const artboard = {
		id: "grainy-orb-artboard",
		name: "Grainy Gradient Orb",
		position: { x: 0, y: 0 },
		width: ORB_SIZE,
		height: ORB_SIZE,
		background: "#f8fafc",
		fps: SCENE_FPS,
		durationFrames: 90,
	};

	const baseScene: SceneDocument = {
		schemaVersion: SCENE_SCHEMA_VERSION,
		id: "reference-grainy-gradient-orb",
		name: "Grainy Gradient Orb",
		artboard,
		artboards: [artboard],
		currentArtboardId: artboard.id,
		layers: [
			{
				id: "grainy-orb-layer",
				name: "Orb",
				visible: true,
				locked: false,
				nodes: [orbNode],
			},
		],
	};

	const result = applyAgentSceneCommands(
		{
			scene: baseScene,
			motion: initialMotionDocument,
			grammar: EMPTY_GRAMMAR_DOCUMENT,
		},
		{
			commands: [
				{
					type: "scene/set-bindable-property",
					nodeId: ORB_NODE_ID,
					propertyId: "effect.node-look.grain",
					value: ORB_GRAIN_AMOUNT,
				},
				{
					type: "scene/set-bindable-property",
					nodeId: ORB_NODE_ID,
					propertyId: "effect.node-look.noiseScale",
					value: ORB_GRAIN_NOISE_SCALE,
				},
			],
		},
	);
	const applyErrors = result.issues.filter(
		(issue) => issue.severity === "error",
	);
	if (applyErrors.length > 0) {
		throw new Error(
			`Grainy orb grain commands failed: ${applyErrors.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`,
		);
	}
	const grainedNode = result.data.scene.layers[0]?.nodes.find(
		(node) => node.id === ORB_NODE_ID,
	);
	if (!grainedNode?.recipe) {
		throw new Error(
			"Grainy orb grain commands did not produce a node.recipe on the orb node.",
		);
	}

	const motion: MotionDocument = {
		schemaVersion: 1,
		fps: SCENE_FPS,
		durationFrames: 90,
		tracks: [],
		clips: [],
	};

	return { scene: result.data.scene, motion };
};

const DISSOLVE_COVER_ARTBOARD_ID = "grainy-dissolve-cover-artboard";
const DISSOLVE_COVER_SIZE = 1080;

/**
 * "Two-plate grainy dissolve" composition config, ported VERBATIM (colors,
 * bounds, gradient endpoints, field endpoints, plateau, amount, noiseScale)
 * from the approved authoring-session spike that produced this reference
 * scene — see the repository history for the original Newting render study (an
 * untracked authoring scratch file, not part of the shipped app) for the full
 * derivation of the dissolve-field numbers below. One shared violet/blue-violet
 * to bright-pink palette; the background and the sphere differ ONLY in
 * gradient geometry (linear vs. radial) and Noise Gradient field direction
 * (diagonal vs. vertical) — that shared-palette, geometry-only contrast is the
 * teachable core of this tutorial.
 */
const DISSOLVE_COVER_CONFIG = {
	bgDeep: {
		bounds: { x: 0, y: 0, width: 1080, height: 1080 },
		gradient: {
			from: { x: 1080, y: 0 },
			to: { x: 0, y: 1080 },
			stops: [
				{ offset: 0, color: "#7A64EC" },
				{ offset: 1, color: "#4E3BD8" },
			],
		},
	},
	bgPink: {
		bounds: { x: 0, y: 0, width: 1080, height: 1080 },
		gradient: {
			from: { x: 1080, y: 0 },
			to: { x: 0, y: 1080 },
			stops: [
				{ offset: 0, color: "#F6B6DC" },
				{ offset: 1, color: "#E59FD4" },
			],
		},
	},
	sphereDeep: {
		bounds: { x: 100, y: 130, width: 713, height: 713 },
		gradient: {
			center: { x: 445, y: 230 },
			radius: { x: 390, y: 390 },
			stops: [
				{ offset: 0, color: "#7A64EC" },
				{ offset: 1, color: "#4E3BD8" },
			],
		},
	},
	spherePink: {
		bounds: { x: 100, y: 130, width: 713, height: 713 },
		gradient: {
			center: { x: 445, y: 230 },
			radius: { x: 390, y: 390 },
			stops: [
				{ offset: 0, color: "#F8C4E4" },
				{ offset: 0.35, color: "#EBB2E6" },
				{ offset: 0.7, color: "#C9A0EE" },
				{ offset: 1, color: "#B291EC" },
			],
		},
	},
	noiseGradientBgPink: {
		fieldMode: "linear" as const,
		linearField: { x1: 3, y1: -2, x2: -2, y2: 2.75, plateau: 0 },
		amount: 0.15 / 0.3,
		materialStrength: 1.0,
		grainStrength: 1.0,
		particleContrast: 0.85,
		grainSize: 0.9,
	},
	noiseGradientSpherePink: {
		fieldMode: "linear" as const,
		linearField: { x1: 0.5, y1: -1.4, x2: 0.5, y2: 1.7, plateau: 0.01 },
		amount: 0.09 / 0.3,
		materialStrength: 1.0,
		grainStrength: 1.0,
		particleContrast: 0.85,
		grainSize: 0.9,
	},
} as const;

/**
 * Builds the "Grainy dissolve cover" reference scene: an album-cover-style
 * two-plate composition — a full-bleed background rect and a large sphere,
 * each a bright pink plate Noise-Gradient-dissolved over a deep blue-violet
 * plate of the same geometry beneath it. The artboard and its empty layer are
 * authored as a plain literal (mirroring `buildGrainyOrbSource` and
 * `buildCornerRadiusSource`, not `scene/add-artboard`, so the base document
 * carries no unrelated seed content); the four plates are then appended and
 * Noise-Gradient-dissolved through the REAL agent scene command bus
 * (`applyAgentSceneCommands`, the same code path the MCP server and the agent
 * bridge run) in two batches, because commands in one
 * `applyAgentSceneCommands` call validate against the pre-batch snapshot —
 * the second batch's `scene/author-object-noise-gradient` commands target
 * node ids that only exist once the first batch's `scene/append-node`
 * commands have run.
 *
 * Z-order bottom -> top: bgDeep, bgPink, sphereDeep, spherePink. Only the two
 * PINK plates get a Noise Gradient; the DEEP plates are plain gradient fills
 * that show through wherever the pink plate above them is dissolved into
 * grain — this is a dissolve (pink plate eroding into discrete opaque specks
 * that reveal the deep plate), not a noise overlay darkening a single fill.
 *
 * `scene/append-node` mints a nanoid id per node (there is no way to pass an
 * explicit id through the agent command surface), so the four plate ids are
 * run-specific after the append batch. This builder stabilizes them
 * STRUCTURALLY — via `remapIds` on the scene document — BETWEEN the append
 * batch and the noise-gradient batch, i.e. BEFORE any command derives a
 * compound id from a plate's node id. `scene/author-object-noise-gradient`
 * converts each pink plate into a scoped Look Graph overlay whose own ids
 * (`objectNoiseGradientScopedLookId`/`lookGraphNodeId` in
 * `noise-gradient-look.ts`/`look-graph.ts`) are pure functions of the node id
 * it is called with, so once the node id itself is stable, every id derived
 * from it — including ids that embed it as a lowercased/slugified SUBSTRING
 * of a longer compound string, or embed it a second time raw-cased after a
 * `:` suffix — is automatically stable too, with no further remapping step
 * needed after the noise-gradient batch runs.
 *
 * A text-level remap AFTER derivation (the previous approach: serialize the
 * final scene, then `sceneText.split(rawId).join(stableId)` for each plate)
 * is forbidden and cannot be fixed in general: `svgIdSegment` strips a
 * leading/trailing hyphen RUN from the compound string it slugifies, not a
 * whole-string hyphen collapse. When a minted nanoid happens to end in `-`,
 * that trailing hyphen is stripped from the id embedded inside the derived
 * compound id, but the naive substring search still looks for the raw id
 * WITH its own trailing hyphen — so the match extends one character past
 * where `svgIdSegment` had already stripped it and consumes the following
 * `-look-` template literal's own joiner hyphen, emitting e.g.
 * `...spherepinklook-source` instead of `...spherepink-look-source`. Text
 * substitution cannot see that a character it is matching was structurally
 * removed during derivation; only stabilizing the input before derivation
 * can.
 */
const buildGrainyDissolveCoverSource = (): {
	scene: SceneDocument;
	motion: MotionDocument;
	idRemap: undefined;
} => {
	const config = DISSOLVE_COVER_CONFIG;

	const artboard = {
		id: DISSOLVE_COVER_ARTBOARD_ID,
		name: "Grainy Dissolve Cover",
		position: { x: 0, y: 0 },
		width: DISSOLVE_COVER_SIZE,
		height: DISSOLVE_COVER_SIZE,
		background: "#F2A8CF",
		fps: SCENE_FPS,
		durationFrames: 90,
	};

	const baseScene: SceneDocument = {
		schemaVersion: SCENE_SCHEMA_VERSION,
		id: "reference-grainy-dissolve-cover",
		name: "Grainy Dissolve Cover",
		artboard,
		artboards: [artboard],
		currentArtboardId: artboard.id,
		layers: [
			{
				id: "grainy-dissolve-cover-layer",
				name: "Plates",
				visible: true,
				locked: false,
				nodes: [],
			},
		],
	};

	const baseContext: AgentDocumentContext = {
		scene: baseScene,
		motion: initialMotionDocument,
		grammar: EMPTY_GRAMMAR_DOCUMENT,
	};

	// `strokeWidth: 0` on every appended node overrides `factory.ts`'s
	// `defaultStyle` (every appended node otherwise gets a 1px `#191817`
	// stroke), which would otherwise paint a visible dark edge ring around
	// each plate.
	const buildCommands: readonly AgentSceneCommand[] = [
		{
			type: "scene/append-node",
			node: {
				name: "bgDeep",
				geometry: { kind: "rect", bounds: config.bgDeep.bounds },
				style: {
					strokeWidth: 0,
					fills: [
						{
							kind: "linear-gradient",
							from: config.bgDeep.gradient.from,
							to: config.bgDeep.gradient.to,
							stops: config.bgDeep.gradient.stops,
						},
					],
				},
			},
		},
		{
			type: "scene/append-node",
			node: {
				name: "bgPink",
				geometry: { kind: "rect", bounds: config.bgPink.bounds },
				style: {
					strokeWidth: 0,
					fills: [
						{
							kind: "linear-gradient",
							from: config.bgPink.gradient.from,
							to: config.bgPink.gradient.to,
							stops: config.bgPink.gradient.stops,
						},
					],
				},
			},
		},
		{
			type: "scene/append-node",
			node: {
				name: "sphereDeep",
				geometry: { kind: "ellipse", bounds: config.sphereDeep.bounds },
				style: {
					strokeWidth: 0,
					fills: [
						{
							kind: "radial-gradient",
							center: config.sphereDeep.gradient.center,
							radius: config.sphereDeep.gradient.radius,
							stops: config.sphereDeep.gradient.stops,
						},
					],
				},
			},
		},
		{
			type: "scene/append-node",
			node: {
				name: "spherePink",
				geometry: { kind: "ellipse", bounds: config.spherePink.bounds },
				style: {
					strokeWidth: 0,
					fills: [
						{
							kind: "radial-gradient",
							center: config.spherePink.gradient.center,
							radius: config.spherePink.gradient.radius,
							stops: config.spherePink.gradient.stops,
						},
					],
				},
			},
		},
	];

	const buildResult = applyAgentSceneCommands(baseContext, {
		commands: buildCommands,
	});
	const buildErrors = buildResult.issues.filter(
		(issue) => issue.severity === "error",
	);
	if (!buildResult.ok || buildErrors.length > 0) {
		throw new Error(
			`Grainy dissolve cover build commands failed: ${buildErrors.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`,
		);
	}
	const builtScene = buildResult.data.scene;

	const findByName = (name: string): string => {
		const node = allNodes(builtScene).find(
			(candidate) => candidate.name === name,
		);
		if (!node) {
			throw new Error(
				`Grainy dissolve cover: expected node named "${name}" but found none.`,
			);
		}
		return node.id;
	};

	// Stabilize the four append-minted node ids BEFORE the noise-gradient batch
	// derives any compound id from them (see the builder's own doc comment for
	// why this must happen structurally, between the two batches, rather than
	// as a text-level pass on the finished scene).
	const plateIdRemap = new Map<string, string>(
		(["bgDeep", "bgPink", "sphereDeep", "spherePink"] as const).map(
			(name) => [findByName(name), `grainy-dissolve-cover-${name}`] as const,
		),
	);
	const stableScene = remapIds(builtScene, plateIdRemap) as SceneDocument;

	const bgPinkId = "grainy-dissolve-cover-bgPink";
	const spherePinkId = "grainy-dissolve-cover-spherePink";

	// `effect.node-look.noiseScale` MUST be set before
	// `scene/author-object-noise-gradient` for the SAME node, in this order,
	// because `objectNoiseGradientScopedLook` snapshot-copies `node.recipe.
	// texture` only at first-conversion time — there is no later edit path
	// that would apply a grain-size change to an already-converted node's
	// scoped look.
	//
	// Both `scene/author-object-noise-gradient` commands below pass
	// `blendMode: "dissolve"` EXPLICITLY. `write.ts` now writes
	// `material.blendMode` unconditionally, defaulting an omitted value to
	// `NOISE_GRADIENT_FRESH_ENABLE_BLEND_MODE` ("hard-light", the noise-OVER-
	// fill overlay route) to match the Inspector/Noise Gradient Tool's own
	// fresh-enable default — an OMITTED `blendMode` no longer means dissolve.
	// `"dissolve"` is a validated `TEXTURE_MATERIAL_BLEND_MODES` value (see
	// `@/shared/vec-core`) that resolves through `effectiveTextureBlendMode`
	// to the exact same particle-erosion render path
	// (`particleDissolvePrimitives`) this two-plate scene depends on — the
	// deep plate showing through wherever the pink plate above it is
	// dissolved into grain, not a noise texture composited over one fill.
	// `materialStrength`/`particleContrast` below only take effect under
	// `blendMode: "dissolve"`.
	const noiseGradientContext: AgentDocumentContext = {
		scene: stableScene,
		motion: baseContext.motion,
		grammar: baseContext.grammar,
	};

	const noiseGradientCommands: readonly AgentSceneCommand[] = [
		{
			type: "scene/set-bindable-property",
			nodeId: bgPinkId,
			propertyId: "effect.node-look.noiseScale",
			value: config.noiseGradientBgPink.grainSize,
		},
		{
			type: "scene/author-object-noise-gradient",
			nodeId: bgPinkId,
			fieldMode: config.noiseGradientBgPink.fieldMode,
			linearField: config.noiseGradientBgPink.linearField,
			amount: config.noiseGradientBgPink.amount,
			materialStrength: config.noiseGradientBgPink.materialStrength,
			grainStrength: config.noiseGradientBgPink.grainStrength,
			particleContrast: config.noiseGradientBgPink.particleContrast,
			blendMode: "dissolve",
		},
		{
			type: "scene/set-bindable-property",
			nodeId: spherePinkId,
			propertyId: "effect.node-look.noiseScale",
			value: config.noiseGradientSpherePink.grainSize,
		},
		{
			type: "scene/author-object-noise-gradient",
			nodeId: spherePinkId,
			fieldMode: config.noiseGradientSpherePink.fieldMode,
			linearField: config.noiseGradientSpherePink.linearField,
			amount: config.noiseGradientSpherePink.amount,
			materialStrength: config.noiseGradientSpherePink.materialStrength,
			grainStrength: config.noiseGradientSpherePink.grainStrength,
			particleContrast: config.noiseGradientSpherePink.particleContrast,
			blendMode: "dissolve",
		},
	];

	const ngResult = applyAgentSceneCommands(noiseGradientContext, {
		commands: noiseGradientCommands,
	});
	const ngErrors = ngResult.issues.filter(
		(issue) => issue.severity === "error",
	);
	if (!ngResult.ok || ngErrors.length > 0) {
		throw new Error(
			`Grainy dissolve cover noise-gradient commands failed: ${ngErrors.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`,
		);
	}

	const finalScene = ngResult.data.scene;

	// Tripwire: every raw append-minted id must be gone, and every stable id
	// must be present, in the final serialized scene. Because the noise-
	// gradient batch ran against `stableScene` (not `builtScene`), every id it
	// derives is already a pure function of the stable ids — this assertion
	// exists to catch a regression (e.g. a future edit that re-introduces a
	// raw-id lookup) loudly, at generation time, rather than as silent byte
	// drift a human has to notice in a diff. A generator throw is a failure
	// `check:reference-scenes-fresh` surfaces and recovers from (see its
	// try/catch around the generator invocation); silent drift is not.
	const finalText = JSON.stringify(finalScene);
	for (const [rawId, stableId] of plateIdRemap) {
		if (
			finalText.includes(rawId) ||
			finalText.toLowerCase().includes(rawId.toLowerCase())
		) {
			throw new Error(
				`Grainy dissolve cover: raw append-minted id "${rawId}" leaked into the final scene text; expected only the stable id "${stableId}".`,
			);
		}
		if (!finalText.includes(stableId)) {
			throw new Error(
				`Grainy dissolve cover: stable id "${stableId}" is missing from the final scene text.`,
			);
		}
	}

	const motion: MotionDocument = {
		schemaVersion: 1,
		fps: SCENE_FPS,
		durationFrames: 90,
		tracks: [],
		clips: [],
	};

	return { scene: finalScene, motion, idRemap: undefined };
};

type ReferenceFixtureSource = {
	/** Matches the `REFERENCE_SCENES` registry slug (`model/registry.ts`). */
	readonly slug: string;
	readonly exportName: string;
	readonly fileStem: string;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly grammarBindings?: readonly MotionGrammarBinding[];
	/** Maps nanoid-minted ids to stable ids for byte-deterministic output. */
	readonly idRemap?: ReadonlyMap<string, string>;
};

const cycle = buildCycleSource();
const timeDelay = buildTimeDelaySource();
const cornerRadius = buildCornerRadiusSource();
const grainyOrb = buildGrainyOrbSource();
const grainyDissolveCover = buildGrainyDissolveCoverSource();
const signalHandoff = buildSignalHandoffSource();
const materialSignalHandoff = buildMaterialSignalHandoffSource();
const projectedSolidProbe = buildProjectedSolidProbeSource();

const SOURCES: readonly ReferenceFixtureSource[] = [
	{
		slug: "grainy-gradient-orb",
		exportName: "grainyGradientOrbFixture",
		fileStem: "grainy-gradient-orb.fixture",
		scene: grainyOrb.scene,
		motion: grainyOrb.motion,
	},
	{
		slug: "grainy-dissolve-cover",
		exportName: "grainyDissolveCoverFixture",
		fileStem: "grainy-dissolve-cover.fixture",
		scene: grainyDissolveCover.scene,
		motion: grainyDissolveCover.motion,
	},
	{
		slug: "cycle-motion-system",
		exportName: "cycleMotionFixture",
		fileStem: "cycle-motion-system.fixture",
		scene: cycle.scene,
		motion: cycle.motion,
		grammarBindings: cycle.grammarBindings,
	},
	{
		slug: "time-delay-motion-system",
		exportName: "timeDelayMotionFixture",
		fileStem: "time-delay-motion-system.fixture",
		scene: timeDelay.scene,
		motion: timeDelay.motion,
		grammarBindings: timeDelay.grammarBindings,
		idRemap: timeDelay.idRemap,
	},
	{
		slug: "corner-radius-expansion",
		exportName: "cornerRadiusFixture",
		fileStem: "corner-radius-expansion.fixture",
		scene: cornerRadius.scene,
		motion: cornerRadius.motion,
	},
	{
		slug: "signal-handoff",
		exportName: "signalHandoffFixture",
		fileStem: "signal-handoff.fixture",
		scene: signalHandoff.scene,
		motion: signalHandoff.motion,
	},
	{
		slug: "signal-handoff-material",
		exportName: "signalHandoffMaterialFixture",
		fileStem: "signal-handoff-material.fixture",
		scene: materialSignalHandoff.scene,
		motion: materialSignalHandoff.motion,
	},
	{
		slug: "projected-solid-probe",
		exportName: "projectedSolidProbeFixture",
		fileStem: "projected-solid-probe.fixture",
		scene: projectedSolidProbe.scene,
		motion: projectedSolidProbe.motion,
	},
];

const fixturesDir = path.join(
	process.cwd(),
	"src/features/reference-scenes/fixtures",
);
const exportDemoDir = path.join(process.cwd(), "public/tutorial-exports");

mkdirSync(fixturesDir, { recursive: true });
mkdirSync(exportDemoDir, { recursive: true });

const writtenPaths: string[] = [];
/** slug -> html path relative to `public/tutorial-exports/`, for `ReferenceSceneMeta.exportDemo`. */
const exportDemoPathBySlug = new Map<string, string>();

for (const source of SOURCES) {
	const remap = source.idRemap;
	// Remap nanoid-minted ids to stable ids on the documents BEFORE serializing,
	// so the serializer's key-sorting produces byte-identical output every run.
	const scene = remap
		? (remapIds(source.scene, remap) as SceneDocument)
		: source.scene;
	const motionBase = remap
		? (remapIds(source.motion, remap) as MotionDocument)
		: source.motion;
	const bindings =
		source.grammarBindings && remap
			? source.grammarBindings.map(
					(binding) => remapIds(binding, remap) as MotionGrammarBinding,
				)
			: source.grammarBindings;
	const sceneEnvelope = serializeSceneDocument(scene, {
		savedAt: REFERENCE_SCENE_SAVED_AT,
	});
	// Embed the grammar layer inline on the motion side-car, mirroring how the
	// editor persists scene+motion+grammar so the fixture restores identically.
	const motionWithGrammar =
		bindings && bindings.length > 0
			? { ...motionBase, grammar: serializeMotionGrammarLayer(bindings, []) }
			: motionBase;
	const motionEnvelope = serializeMotionDocument(motionWithGrammar, {
		savedAt: REFERENCE_SCENE_SAVED_AT,
	});
	const contents = `// GENERATED by \`bun run gen:reference-scenes\` — do not edit by hand.\n// Serialized through the editor's persistence serializers; rerun to refresh.\nexport const ${source.exportName} = {\n\tsceneEnvelope: ${JSON.stringify(sceneEnvelope)},\n\tmotionEnvelope: ${JSON.stringify(motionEnvelope)},\n} as const;\n`;
	const target = path.join(fixturesDir, `${source.fileStem}.ts`);
	writeFileSync(target, contents, "utf8");
	writtenPaths.push(target);
	console.log(`Wrote ${path.relative(process.cwd(), target)}`);

	// "View export result" artifact (product-honesty tutorial affordance): the
	// SAME `createExportBundle` -> `createMotionCodeHtmlAsset`/
	// `createMotionCodeRuntimeAsset` pipeline the in-app export panel runs,
	// against the SAME remapped scene/motion/bindings used for the fixture
	// above (never the pre-remap `cycle`/`timeDelay`/`cornerRadius`/`grainyOrb`
	// locals, which for Time Delay still carry nanoid-minted ids) — so the
	// committed HTML+JS pair is genuine, deterministic export output, not a
	// bespoke demo renderer. `currentFrame: 0` matches the HTML template's own
	// `mountVectorMotion(el, { autoplay: true, loop: true })` call (see
	// `code.ts`'s `runtimeHtmlContents`), which never passes a `frame` option
	// and always starts playback at 0 regardless of what frame the bundle was
	// built with — the bundle's `currentFrame` only affects embedded
	// diagnostic manifest fields, not what the page actually plays.
	const exportOptimization = exportOptimizationOptionsForProfile("editable");
	const exportBundle = createExportBundle({
		scene,
		motion: motionBase,
		currentFrame: 0,
		artboardScope: "current",
		grammarBindings: bindings,
	});
	const htmlAsset = createMotionCodeHtmlAsset(exportBundle, {
		optimization: exportOptimization,
	});
	const runtimeAsset = createMotionCodeRuntimeAsset(
		exportBundle,
		bindings ?? [],
		{ optimization: exportOptimization },
	);
	for (const asset of [htmlAsset, runtimeAsset]) {
		writeFileSync(
			path.join(exportDemoDir, asset.fileName),
			asset.contents,
			"utf8",
		);
	}
	exportDemoPathBySlug.set(source.slug, htmlAsset.fileName);
	console.log(
		`Wrote public/tutorial-exports/${htmlAsset.fileName} (+ ${runtimeAsset.fileName})`,
	);
}

// Normalize the emitted files to the repo's Biome style so the committed
// fixtures stay clean under `biome check .` without a manual format pass.
// Export-demo artifacts under public/ are excluded from Biome (see
// biome.json's `files.includes`) — they are generated verbatim by the export
// pipeline and must stay byte-exact as emitted, not reformatted.
execFileSync("bunx", ["biome", "format", "--write", ...writtenPaths], {
	cwd: process.cwd(),
	stdio: "inherit",
});

console.log(
	`Generated ${writtenPaths.length} reference-scene ${writtenPaths.length === 1 ? "fixture" : "fixtures"}.`,
);
console.log("Export-result demo paths (registry.ts `exportDemo` field):");
for (const [slug, htmlPath] of exportDemoPathBySlug) {
	console.log(`  ${slug} -> ${htmlPath}`);
}
