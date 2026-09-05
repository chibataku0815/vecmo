/**
 * S4-C probe: does a link keep the SAME placement across a GLB <-> rendered
 * profile switch, and does the rendered lane address the right frame?
 *
 * The predecessor proved link identity and control identity survive the switch
 * but explicitly did NOT prove placement identity, because a rendered link
 * emitted no `Runtime3dPlacement` at all. This probe closes that by compiling
 * the SAME scene twice — once with a `model` resolution, once with a
 * `frame-sequence` resolution over the real 120-frame manifest — and diffing
 * every placement field.
 *
 * It observes rather than asserts. Nothing here is a test file and nothing is
 * run by a test runner; it prints JSON evidence.
 *
 * Run: bun scripts/blender-link-spike/s4-render-probe/placement_probe.ts <manifest.json> <link.json>
 */

import {
	mimeTypeForFramePackageCodec,
	parseProductionFramePackageManifest,
} from "../../../src/entities/scene/model/production-frame-package";
import { parseExternalProductionLink } from "../../../src/entities/scene/model/production-link";
import {
	compileRuntime3dFrame,
	type Runtime3dProductionArtifactResolution,
} from "../../../src/entities/scene/model/runtime-3d";
import type {
	ExternalSceneAsset,
	SceneDocument,
} from "../../../src/entities/scene/model/types";
import type { Runtime3dPlacement } from "../../../src/shared/runtime-3d/types";

const manifestPath = Bun.argv[2];
const linkPath = Bun.argv[3];

const parsed = parseProductionFramePackageManifest(
	JSON.parse(await Bun.file(manifestPath).text()),
);
if (!parsed.ok) throw new Error(`manifest rejected: ${parsed.code}`);
const manifest = parsed.manifest;
const linkJson = JSON.parse(await Bun.file(linkPath).text());
const renderedLink = parseExternalProductionLink(linkJson);
if (!renderedLink) throw new Error("rendered link rejected");
const glbLink = parseExternalProductionLink({
	...linkJson,
	outputProfile: "interactive-glb",
});
if (!glbLink) throw new Error("glb link rejected");

const ASSET_ID = "asset-s4probe";
const NODE_ID = "node-s4probe";
const ARTBOARD_ID = "artboard-s4probe";

const assetFor = (production: unknown): ExternalSceneAsset =>
	({
		id: ASSET_ID,
		kind: "model-3d",
		name: "s4-probe",
		format: "glb",
		source: { kind: "reference", href: "https://example.invalid/s4probe.glb" },
		production,
	}) as ExternalSceneAsset;

const sceneFor = (production: unknown): SceneDocument =>
	({
		id: "scene-s4probe",
		name: "s4 placement probe",
		artboard: {
			id: ARTBOARD_ID,
			name: "probe",
			width: 640,
			height: 360,
			background: "#00000000",
			position: { x: 0, y: 0 },
			cameraSpacePolicy: "screen_2d",
		},
		layers: [
			{
				id: "layer-1",
				name: "layer",
				visible: true,
				locked: false,
				nodes: [
					{
						id: NODE_ID,
						name: "band",
						type: "image",
						visible: true,
						locked: false,
						transform: {
							position: { x: 40, y: 20 },
							rotation: 0,
							scale: { x: 1, y: 1 },
							anchor: { x: 0, y: 0 },
						},
						style: { opacity: 1, strokeWidth: 0 },
						geometry: {
							kind: "image",
							assetId: ASSET_ID,
							bounds: { x: 0, y: 0, width: 640, height: 360 },
						},
					},
				],
			},
		],
		assets: [assetFor(production)],
	}) as unknown as SceneDocument;

const frameHrefs = manifest.frames.map(
	(frame) => `blob:probe/${manifest.buildKey}/${frame.index}`,
);

const modelResolution = (): Runtime3dProductionArtifactResolution => ({
	kind: "model",
	linkId: renderedLink.linkId,
	buildKey: manifest.buildKey,
	href: "blob:probe/glb",
	stale: false,
});

const frameSequenceResolution = (
	stale = false,
	reproducible = manifest.reproducible,
): Runtime3dProductionArtifactResolution => ({
	kind: "frame-sequence",
	linkId: renderedLink.linkId,
	buildKey: manifest.buildKey,
	stale,
	frameHrefs,
	blenderFrameStart: manifest.blenderFrameStart,
	frameCount: manifest.frameCount,
	width: manifest.width,
	height: manifest.height,
	mimeType: mimeTypeForFramePackageCodec(manifest.codec),
	reproducible,
});

const compile = (
	production: unknown,
	resolution: Runtime3dProductionArtifactResolution | null,
	frame: number,
) =>
	compileRuntime3dFrame({
		scene: sceneFor(production),
		frame,
		viewport: {
			width: 640,
			height: 360,
			dpr: 1,
			scale: 1,
			panX: 0,
			panY: 0,
			rotation: 0,
		},
		resolveProductionArtifact: () => resolution,
	});

/** Every placement field EXCEPT `source`, which is the thing allowed to differ. */
const placementIdentity = (placement: Runtime3dPlacement) => ({
	nodeId: placement.nodeId,
	sourceNodeId: placement.sourceNodeId,
	assetId: placement.assetId,
	artboardId: placement.artboardId,
	worldMatrix: placement.worldMatrix,
	opacity: placement.opacity,
	visible: placement.visible,
	pickable: placement.pickable,
});

const results: Record<string, unknown> = {};
let failures = 0;
const record = (name: string, value: unknown, ok: boolean): void => {
	results[name] = { ok, ...(value as object) };
	if (!ok) failures += 1;
};

// --- 1. Placement identity across the profile switch -----------------------
{
	const glbFrame = compile(glbLink, modelResolution(), 10);
	const renderedFrame = compile(renderedLink, frameSequenceResolution(), 10);
	const glb = glbFrame.placements;
	const rendered = renderedFrame.placements;
	const glbIdentity = glb.map(placementIdentity);
	const renderedIdentity = rendered.map(placementIdentity);
	const identical =
		JSON.stringify(glbIdentity) === JSON.stringify(renderedIdentity);
	record(
		"placementIdentityAcrossProfileSwitch",
		{
			glbPlacementCount: glb.length,
			renderedPlacementCount: rendered.length,
			// Order is part of identity: a band that reorders under a mode switch
			// composites differently even if every field matches.
			glbOrder: glb.map((placement) => placement.nodeId),
			renderedOrder: rendered.map((placement) => placement.nodeId),
			identity: glbIdentity[0] ?? null,
			identical,
			glbSourceVariant: glb[0]?.source.variant ?? null,
			renderedSourceVariant: rendered[0]?.source.variant ?? null,
			// The GLB lane carries source time; the rendered lane must not.
			glbHasAnimation: Boolean(glb[0]?.animation),
			renderedHasAnimation: Boolean(rendered[0]?.animation),
		},
		identical &&
			glb.length === 1 &&
			rendered.length === 1 &&
			glb[0]?.source.variant === "model" &&
			rendered[0]?.source.variant === "frame-sequence" &&
			Boolean(glb[0]?.animation) &&
			!rendered[0]?.animation,
	);
}

// --- 2. Frame addressing: first, interior, last ---------------------------
{
	const samples = [0, 1, 59, manifest.frameCount - 1].map((vecmoFrame) => {
		const compiled = compile(
			renderedLink,
			frameSequenceResolution(),
			vecmoFrame,
		);
		const source = compiled.placements[0]?.source;
		return {
			vecmoFrame,
			frameIndex:
				source?.variant === "frame-sequence" ? source.frameIndex : null,
			blenderFrame:
				source?.variant === "frame-sequence" ? source.blenderFrame : null,
			uri: source?.variant === "frame-sequence" ? source.uri : null,
			expectedHref: frameHrefs[vecmoFrame] ?? null,
		};
	});
	record(
		"frameAddressing",
		{ samples },
		samples.every(
			(sample) =>
				sample.frameIndex === sample.vecmoFrame &&
				sample.blenderFrame ===
					manifest.blenderFrameStart + sample.vecmoFrame &&
				sample.uri === sample.expectedHref,
		),
	);
}

// --- 3. Out-of-window HOLD is the contract, and it must not silently work --
{
	// The link declares 120 frames and the package has 120, so a Vecmo frame past
	// the end is clamped by HOLD onto the LAST package frame. This is the
	// documented contract; it is recorded so a later modulo regression is visible.
	const beyond = compile(
		renderedLink,
		frameSequenceResolution(),
		manifest.frameCount + 40,
	);
	const source = beyond.placements[0]?.source;
	const held = source?.variant === "frame-sequence" ? source.frameIndex : null;
	record(
		"outOfWindowHold",
		{
			requestedVecmoFrame: manifest.frameCount + 40,
			heldFrameIndex: held,
			lastPackageIndex: manifest.frameCount - 1,
			moduloWouldHaveGiven: (manifest.frameCount + 40) % manifest.frameCount,
		},
		held === manifest.frameCount - 1,
	);
}

// --- 4. A short package must report, not round ----------------------------
{
	const short = {
		...frameSequenceResolution(),
		frameHrefs: frameHrefs.slice(0, 10),
	} as Runtime3dProductionArtifactResolution;
	const compiled = compile(renderedLink, short, 60);
	const codes = compiled.issues.map((issue) => issue.code);
	record(
		"shortPackageFailsClosed",
		{
			placementCount: compiled.placements.length,
			codes,
		},
		compiled.placements.length === 0 &&
			codes.includes("runtime-3d-frame-package-frame-unavailable"),
	);
}

// --- 5. A manifest origin that disagrees with its link must report ---------
{
	const shifted = {
		...frameSequenceResolution(),
		blenderFrameStart: manifest.blenderFrameStart + 500,
	} as Runtime3dProductionArtifactResolution;
	const compiled = compile(renderedLink, shifted, 10);
	const codes = compiled.issues.map((issue) => issue.code);
	record(
		"disagreeingOriginFailsClosed",
		{ placementCount: compiled.placements.length, codes },
		compiled.placements.length === 0 &&
			codes.includes("runtime-3d-frame-package-frame-unavailable"),
	);
}

// --- 6. The silent-null trap: unavailable must be typed -------------------
{
	const compiled = compile(
		renderedLink,
		{
			kind: "unavailable",
			linkId: renderedLink.linkId,
			code: "production-frame-package-missing",
		},
		10,
	);
	const codes = compiled.issues.map((issue) => issue.code);
	record(
		"unavailableIsTyped",
		{ placementCount: compiled.placements.length, codes },
		compiled.placements.length === 0 &&
			codes.includes("runtime-3d-linked-production-unavailable"),
	);
}

// --- 7. Exactness downgrades -------------------------------------------
{
	const stale = compile(renderedLink, frameSequenceResolution(true), 10);
	const staleSource = stale.placements[0]?.source;
	const notReproducible = compile(
		renderedLink,
		frameSequenceResolution(false, false),
		10,
	);
	const nrSource = notReproducible.placements[0]?.source;
	record(
		"exactnessDowngrades",
		{
			staleExact:
				staleSource?.variant === "frame-sequence" ? staleSource.exact : null,
			staleCodes: stale.issues.map((issue) => issue.code),
			notReproducibleExact:
				nrSource?.variant === "frame-sequence" ? nrSource.exact : null,
			notReproducibleCodes: notReproducible.issues.map((issue) => issue.code),
			// Pixels still arrive in both cases; only the claim is withheld.
			stalePlacementCount: stale.placements.length,
			notReproduciblePlacementCount: notReproducible.placements.length,
		},
		staleSource?.variant === "frame-sequence" &&
			staleSource.exact === false &&
			stale.placements.length === 1 &&
			stale.issues.some(
				(issue) => issue.code === "runtime-3d-linked-production-stale",
			) &&
			nrSource?.variant === "frame-sequence" &&
			nrSource.exact === false &&
			notReproducible.placements.length === 1 &&
			notReproducible.issues.some(
				(issue) => issue.code === "runtime-3d-frame-package-not-reproducible",
			),
	);
}

// --- 8. A rendered link with NO resolver at all must still report ---------
{
	// Every non-editor caller compiles without a resolver. Before the fix found
	// by case 6, this node fell through to the durable GLB href and DREW it — a
	// pre-link model standing in for a rendered delivery, silently.
	const compiled = compileRuntime3dFrame({
		scene: sceneFor(renderedLink),
		frame: 10,
		viewport: {
			width: 640,
			height: 360,
			dpr: 1,
			scale: 1,
			panX: 0,
			panY: 0,
			rotation: 0,
		},
	});
	const codes = compiled.issues.map((issue) => issue.code);
	record(
		"noResolverStillReports",
		{ placementCount: compiled.placements.length, codes },
		compiled.placements.length === 0 &&
			codes.includes("runtime-3d-linked-production-unavailable"),
	);
}

// --- 9. A GLB link with no resolver keeps its durable source (no regression)
{
	const compiled = compileRuntime3dFrame({
		scene: sceneFor(glbLink),
		frame: 10,
		viewport: {
			width: 640,
			height: 360,
			dpr: 1,
			scale: 1,
			panX: 0,
			panY: 0,
			rotation: 0,
		},
	});
	const source = compiled.placements[0]?.source;
	record(
		"glbLinkKeepsDurableSourceWithoutResolver",
		{
			placementCount: compiled.placements.length,
			variant: source?.variant ?? null,
			uri: source?.uri ?? null,
			codes: compiled.issues.map((issue) => issue.code),
		},
		compiled.placements.length === 1 &&
			source?.variant === "model" &&
			source.uri === "https://example.invalid/s4probe.glb",
	);
}

console.log(
	JSON.stringify(
		{
			manifest: {
				buildKey: manifest.buildKey,
				frameCount: manifest.frameCount,
				blenderFrameStart: manifest.blenderFrameStart,
				codec: manifest.codec,
				width: manifest.width,
				height: manifest.height,
				reproducible: manifest.reproducible,
			},
			results,
			failureCount: failures,
		},
		null,
		2,
	),
);
