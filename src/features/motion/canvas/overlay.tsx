import {
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	distributeRovingPositionKeys,
	enablePositionPath,
	repairPathMorphTopology,
	reversePathMorphKeyWinding,
	setPathMorphFirstVertex,
	setPositionPathRoving,
	setPositionPathSpatialMode,
	setPositionPathTangent,
	upsertPositionKeyframe,
} from "@/entities/motion/model/commands";
import type { InteractionEngine } from "@/entities/motion/model/interaction-engine";
import { isValidPathShape } from "@/entities/motion/model/keyframe-validation";
import {
	repairMorphShapeVertexCount,
	reverseMorphWinding,
	rotateMorphFirstVertex,
} from "@/entities/motion/model/morph-topology";
import { buildMotionPath } from "@/entities/motion/model/motion-path";
import { advanceFrame } from "@/entities/motion/model/playback";
import { samplePositionPath } from "@/entities/motion/model/position-path";
import {
	animatedNodeIds,
	effectiveMesh,
	effectiveOpacity,
	effectiveShape,
	effectiveTransform,
} from "@/entities/motion/model/sampler";
import { useMotionStore } from "@/entities/motion/model/store";
import type { MotionDocument } from "@/entities/motion/model/types";
import { useMotionGrammarStore } from "@/entities/motion-grammar/model/store";
import { hasSubtreeCarrier } from "@/entities/scene/model/appearance-targets";
import {
	type MeshImage,
	rasterizeMeshToImage,
} from "@/entities/scene/model/mesh-edit";
import { resolveMotionRelations } from "@/entities/scene/model/motion-relations";
import {
	applyMatrixToPoint,
	IDENTITY_MATRIX,
	invertMatrix,
	matrixFromTransform,
	matrixToSvg,
	pathDataForGeometry,
} from "@/entities/scene/model/rendering";
import { sceneCameraAffectsPlayback } from "@/entities/scene/model/scene-camera";
import { allNodes, findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import { aeShapeToSvgPath } from "@/shared/glammer/ae-shape-svg-path";
import {
	SVG_NODE_ID_ATTRIBUTE,
	SVG_RENDER_PARTS,
	SVG_REVEAL_OPACITY_OWNER_ATTRIBUTE,
	svgNodeSelector,
	svgRenderPartSelector,
} from "@/shared/lib/svg-render-parts";
import {
	addFrameDiagnosticCount,
	beginFramePhase,
	recordFramePhase,
	setFrameDiagnosticGauge,
} from "@/shared/performance/frame-diagnostics";
import { collectAutoKeyCommands } from "../model/auto-keyframe";
import {
	buildInteractionPreviewEngine,
	interactionPreviewSourceSignature,
	readInteractionPreviewSource,
	useInteractionPreviewEngineStore,
} from "../model/interaction-preview";
import { useTransportStore } from "../model/transport-store";
import { samplePlaybackPresentationScene } from "./playback-presentation";

const MILLIS_PER_SECOND = 1000;
const CANVAS_ROOT_SELECTOR = ".canvas-shell";
const PLAYBACK_DUPLICATE_NODE_ATTRIBUTE = "data-motion-playback-duplicate";

type TouchedRef = { current: Set<string> };
type MotionGrammarDuplicateData = {
	readonly sourceNodeId: string;
};

type PlaybackDriverProps = {
	readonly selection: {
		readonly nodeIds: readonly string[];
	};
};

const rootFrom = (marker: Element | null): Element | null =>
	marker?.closest(CANVAS_ROOT_SELECTOR) ?? null;

const findGroup = (root: Element, nodeId: string): SVGGElement | null =>
	root.querySelector<SVGGElement>(svgNodeSelector(nodeId));

const findPaintTarget = (group: Element): SVGElement | null =>
	group.querySelector<SVGElement>(
		svgRenderPartSelector(SVG_RENDER_PARTS.paint),
	);

const findSubtreeCarrier = (group: Element): SVGElement | null =>
	group.querySelector<SVGElement>(
		svgRenderPartSelector(SVG_RENDER_PARTS.subtree),
	);

/**
 * The render part that owns a node's opacity: this node's own `<g
 * data-node-id>` wrapper when it is marked as the reveal-opacity owner (see
 * {@link SVG_REVEAL_OPACITY_OWNER_ATTRIBUTE}'s doc — a revealing object-Noise-
 * Gradient dissolve internalizes its `revealPaint` underlay into this SAME
 * wrapper, which is why the wrapper, not the inner filtered-content element,
 * must own opacity so the pair fades as one object); otherwise a {@link
 * hasSubtreeCarrier} node's (group, Blend, or frame) subtree carrier, or an
 * ordinary node's own paint element. Playback writes sampled opacity here
 * instead of always using `findPaintTarget` so a group's or frame's animated
 * opacity actually composites over its children, matching `CanvasShell.tsx`
 * `SceneNode`'s render contract: the carrier is the node's own `<g
 * data-node-id>`'s first `[data-render-part]` descendant in document order (it
 * wraps the node's own paint element and every child), so first-match
 * `querySelector` resolves to it correctly even when nested groups exist
 * deeper in the subtree.
 *
 * The reveal-owner check comes FIRST and is keyed off the marker attribute,
 * not "does a reveal-underlay element exist": an object-NG dissolve's
 * `revealPaint` can resolve to nothing renderable (e.g. every gradient stop
 * drops out) while STILL moving opacity to the wrapper in the renderer (see
 * `SceneNode`'s `reveal` branch in `CanvasShell.tsx`) — checking for an
 * underlay element instead would miss that case and let this function fall
 * through to the inner paint element, double-applying opacity onto the wrong
 * one.
 */
const findOpacityTarget = (
	group: Element,
	node: VectorNode,
): SVGElement | null => {
	if (group.getAttribute(SVG_REVEAL_OPACITY_OWNER_ATTRIBUTE) === "true") {
		return group as SVGElement;
	}
	return hasSubtreeCarrier(node)
		? findSubtreeCarrier(group)
		: findPaintTarget(group);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const motionGrammarDuplicateData = (
	node: VectorNode,
): MotionGrammarDuplicateData | null => {
	const duplicate = node.data?.motionGrammarDuplicate;
	if (!isRecord(duplicate)) return null;
	return typeof duplicate.sourceNodeId === "string"
		? { sourceNodeId: duplicate.sourceNodeId }
		: null;
};

const markPlaybackDuplicateGroup = (
	group: Element,
	duplicateNodeId: string,
): void => {
	group.setAttribute(SVG_NODE_ID_ATTRIBUTE, duplicateNodeId);
	group.setAttribute(PLAYBACK_DUPLICATE_NODE_ATTRIBUTE, "true");
	group.setAttribute("pointer-events", "none");
};

const remapDuplicateGroupNodeIds = (
	group: Element,
	sourceNode: VectorNode,
	duplicateNode: VectorNode,
	isRoot = true,
): void => {
	const target = isRoot
		? group
		: group.querySelector(svgNodeSelector(sourceNode.id));
	if (target) markPlaybackDuplicateGroup(target, duplicateNode.id);
	const sourceChildren = sourceNode.children ?? [];
	const duplicateChildren = duplicateNode.children ?? [];
	for (const [index, sourceChild] of sourceChildren.entries()) {
		const duplicateChild = duplicateChildren[index];
		if (!duplicateChild) continue;
		remapDuplicateGroupNodeIds(group, sourceChild, duplicateChild, false);
	}
};

const ensurePresentationDuplicateGroup = (
	root: Element,
	sourceScene: SceneDocument,
	duplicateNode: VectorNode,
): void => {
	if (findGroup(root, duplicateNode.id)) return;
	const duplicate = motionGrammarDuplicateData(duplicateNode);
	if (!duplicate) return;
	const sourceNode = findNode(sourceScene, duplicate.sourceNodeId);
	if (!sourceNode) return;
	const sourceGroup = findGroup(root, sourceNode.id);
	const parent = sourceGroup?.parentNode;
	if (!sourceGroup || !parent) return;
	const clone = sourceGroup.cloneNode(true) as Element;
	remapDuplicateGroupNodeIds(clone, sourceNode, duplicateNode);
	parent.insertBefore(clone, sourceGroup);
};

const ensurePresentationDuplicateGroupsForNodes = (
	root: Element,
	sourceScene: SceneDocument,
	nodes: readonly VectorNode[],
): void => {
	for (const node of nodes) {
		if (motionGrammarDuplicateData(node)) {
			ensurePresentationDuplicateGroup(root, sourceScene, node);
			continue;
		}
		if (node.children) {
			ensurePresentationDuplicateGroupsForNodes(
				root,
				sourceScene,
				node.children,
			);
		}
	}
};

const ensurePresentationDuplicateGroups = (
	root: Element,
	sourceScene: SceneDocument,
	presentationScene: SceneDocument,
): void => {
	for (const layer of presentationScene.layers) {
		ensurePresentationDuplicateGroupsForNodes(root, sourceScene, layer.nodes);
	}
};

const removeStalePlaybackDuplicateGroups = (
	root: Element,
	currentNodeIds: ReadonlySet<string>,
): void => {
	for (const group of root.querySelectorAll(
		`[${PLAYBACK_DUPLICATE_NODE_ATTRIBUTE}="true"]`,
	)) {
		const nodeId = group.getAttribute(SVG_NODE_ID_ATTRIBUTE);
		if (!nodeId || !currentNodeIds.has(nodeId)) group.remove();
	}
};

/**
 * The path element(s) that carry the node's animated geometry. A single-paint node
 * marks its own `<path>` as the paint target; a multi-paint (stacked) node marks a
 * wrapping `<g>` whose `<path>` layers all share one geometry, so every layer needs
 * the sampled `d`. Returns an empty list for non-path paint targets.
 */
const findPathPaintTargets = (group: Element): readonly SVGPathElement[] => {
	const target = findPaintTarget(group);
	if (!target) return [];
	if (target.tagName.toLowerCase() === "path")
		return [target as SVGPathElement];
	return [...target.querySelectorAll<SVGPathElement>("path")];
};

type CachedNodeDom = {
	readonly group: SVGGElement;
	readonly image: SVGImageElement | null;
	readonly node: VectorNode;
	readonly opacityTarget: SVGElement | null;
	readonly paths: readonly SVGPathElement[];
	readonly pattern: SVGPatternElement | null;
};

const nodeDomCacheByRoot = new WeakMap<Element, Map<string, CachedNodeDom>>();

const cachedNodeDom = (
	root: Element,
	node: VectorNode,
): CachedNodeDom | null => {
	let cache = nodeDomCacheByRoot.get(root);
	if (!cache) {
		cache = new Map();
		nodeDomCacheByRoot.set(root, cache);
	}
	const cached = cache.get(node.id);
	if (
		cached &&
		cached.node === node &&
		cached.group.isConnected &&
		root.contains(cached.group)
	) {
		addFrameDiagnosticCount("svg.domCacheHit");
		return cached;
	}
	const group = findGroup(root, node.id);
	if (!group) {
		cache.delete(node.id);
		return null;
	}
	const next: CachedNodeDom = {
		group,
		image: group.querySelector<SVGImageElement>("pattern image"),
		node,
		opacityTarget: findOpacityTarget(group, node),
		paths: findPathPaintTargets(group),
		pattern: group.querySelector<SVGPatternElement>("pattern"),
	};
	cache.set(node.id, next);
	addFrameDiagnosticCount("svg.domCacheMiss");
	return next;
};

const setAttributeIfChanged = (
	target: Element,
	name: string,
	value: string,
): void => {
	if (target.getAttribute(name) === value) {
		addFrameDiagnosticCount("svg.attributeWriteSkipped");
		return;
	}
	target.setAttribute(name, value);
	addFrameDiagnosticCount("svg.attributeWrite");
};

// Lower than the render bridge's deviceScale (2): playback re-rasters every frame
// on the main thread, so trade a little crispness for frame budget.
const PLAYBACK_MESH_SCALE = 1;

/**
 * Imperatively swaps a node's mesh `<pattern><image>` to a freshly rasterized mesh
 * during playback (React is bypassed, so the rest-render pattern is patched in
 * place). The tile box tracks the mesh bounds (points can move); the image stays
 * at tile-local `0,0`, matching the renderer's `<pattern>` contract.
 */
const applyMeshImage = (dom: CachedNodeDom, image: MeshImage): void => {
	const { pattern, image: img } = dom;
	if (!pattern || !img) return;
	setAttributeIfChanged(pattern, "x", String(image.bounds.x));
	setAttributeIfChanged(pattern, "y", String(image.bounds.y));
	setAttributeIfChanged(pattern, "width", String(image.bounds.width));
	setAttributeIfChanged(pattern, "height", String(image.bounds.height));
	setAttributeIfChanged(img, "width", String(image.bounds.width));
	setAttributeIfChanged(img, "height", String(image.bounds.height));
	setAttributeIfChanged(img, "href", image.dataUrl);
};

/**
 * Imperatively writes a node's sampled pose onto its rendered SVG group. Transform
 * goes on the group; the absolute effective opacity is written on the opacity
 * target — the paint element for an ordinary node, or the subtree carrier for a
 * {@link hasSubtreeCarrier} node (group, Blend, or frame; see `findOpacityTarget`)
 * so a group's or frame's opacity actually composites over its children instead
 * of landing on a shape that renders as a sibling of, not an ancestor of, those
 * children — because a group multiplier can't represent a rise above a sub-1
 * base or a reveal from a zero base under CSS clamping. An animated path also
 * rewrites its `d` on every paint layer. This bypasses React so playback never
 * re-renders the canvas.
 */
const applyNodePose = (
	root: Element,
	scene: SceneDocument,
	motion: MotionDocument,
	frame: number,
	nodeId: string,
): void => {
	const node = findNode(scene, nodeId);
	if (!node) return;
	const dom = cachedNodeDom(root, node);
	if (!dom) return;
	const transform = effectiveTransform(node, motion, frame);
	setAttributeIfChanged(
		dom.group,
		"transform",
		matrixToSvg(matrixFromTransform(transform)),
	);
	if (dom.opacityTarget) {
		setAttributeIfChanged(
			dom.opacityTarget,
			"opacity",
			String(effectiveOpacity(node, motion, frame)),
		);
	}
	if (node.geometry.kind === "path") {
		const shape = effectiveShape(node, motion, frame);
		if (shape) {
			const data = aeShapeToSvgPath(shape);
			for (const path of dom.paths) {
				setAttributeIfChanged(path, "d", data);
			}
		}
	}
	const mesh = effectiveMesh(node, motion, frame);
	if (mesh) {
		const image = rasterizeMeshToImage(mesh, PLAYBACK_MESH_SCALE);
		if (image) applyMeshImage(dom, image);
	}
};

/** Restores a node's rendered group to its rest pose when it stops animating. */
const resetNodePose = (
	root: Element,
	scene: SceneDocument,
	nodeId: string,
): void => {
	const node = findNode(scene, nodeId);
	if (!node) return;
	const dom = cachedNodeDom(root, node);
	if (!dom) return;
	setAttributeIfChanged(
		dom.group,
		"transform",
		matrixToSvg(matrixFromTransform(node.transform)),
	);
	if (dom.opacityTarget) {
		setAttributeIfChanged(
			dom.opacityTarget,
			"opacity",
			String(node.style.opacity),
		);
	}
	if (node.geometry.kind === "path") {
		const data = pathDataForGeometry(node.geometry);
		if (data) {
			for (const path of dom.paths) {
				setAttributeIfChanged(path, "d", data);
			}
		}
	}
	const restMesh = node.style.fills?.[0];
	if (restMesh?.kind === "mesh-gradient") {
		const image = rasterizeMeshToImage(restMesh, PLAYBACK_MESH_SCALE);
		if (image) applyMeshImage(dom, image);
	}
};

/**
 * Writes a grammar-sampled `stroke-dashoffset` onto every path paint target,
 * defensively setting `stroke-dasharray` too when the element does not already
 * carry one from its last React render. Live `play()` freezes the reactive SVG
 * render (`presentationFrame` holds still while playing — see
 * `resolveCanvasPresentationFrame` in `widgets/canvas-shell/model/presentation.ts`),
 * so a dash-marching technique like `stroke-draw-on` only ever reaches the DOM
 * through this imperative overlay; scrub still renders it through the normal
 * React path via `strokePresentation`. No-ops when the node has no dash array,
 * mirroring `strokePresentation`'s own gate — an offset is meaningless without a
 * pattern to march through.
 */
const applyStrokeDashPose = (
	paths: readonly SVGPathElement[],
	style: VectorNode["style"],
): void => {
	const dashArray = style.strokeDash;
	if (!dashArray || dashArray.length === 0) return;
	const dasharrayValue = dashArray.join(" ");
	const dashoffsetValue = String(style.strokeDashoffset ?? 0);
	for (const path of paths) {
		if (!path.hasAttribute("stroke-dasharray")) {
			setAttributeIfChanged(path, "stroke-dasharray", dasharrayValue);
		}
		setAttributeIfChanged(path, "stroke-dashoffset", dashoffsetValue);
	}
};

const applyPresentationNodePose = (root: Element, node: VectorNode): void => {
	const dom = cachedNodeDom(root, node);
	if (!dom) return;
	setAttributeIfChanged(
		dom.group,
		"transform",
		matrixToSvg(matrixFromTransform(node.transform)),
	);
	if (dom.opacityTarget) {
		setAttributeIfChanged(
			dom.opacityTarget,
			"opacity",
			String(node.style.opacity),
		);
	}
	if (node.geometry.kind === "path") {
		const data = pathDataForGeometry(node.geometry);
		const pathTargets = dom.paths;
		if (data) {
			for (const path of pathTargets) {
				setAttributeIfChanged(path, "d", data);
			}
		}
		applyStrokeDashPose(pathTargets, node.style);
	}
	const mesh = node.style.fills?.[0];
	if (mesh?.kind === "mesh-gradient") {
		const image = rasterizeMeshToImage(mesh, PLAYBACK_MESH_SCALE);
		if (image) applyMeshImage(dom, image);
	}
};

const applyPresentationScenePose = (
	root: Element,
	sourceScene: SceneDocument,
	presentationScene: SceneDocument,
	touched: ReadonlySet<string>,
): Set<string> => {
	const nodes = allNodes(presentationScene);
	const current = new Set(nodes.map((node) => node.id));
	ensurePresentationDuplicateGroups(root, sourceScene, presentationScene);
	removeStalePlaybackDuplicateGroups(root, current);
	for (const nodeId of touched) {
		if (!current.has(nodeId)) resetNodePose(root, sourceScene, nodeId);
	}
	for (const node of nodes) applyPresentationNodePose(root, node);
	return current;
};

const applyPose = (
	root: Element,
	frame: number,
	touched: ReadonlySet<string>,
): Set<string> => {
	const scene = useSceneStore.getState().document;
	const motion = useMotionStore.getState().document;
	const grammarBindings = useMotionGrammarStore.getState().document.bindings;
	// Duplicate generators also synthesize presentation-only nodes, so playback must
	// take the rich-scene path when they are present even without grammar bindings.
	// Effect-expression bindings drive only the recipe filter, which the frozen-React
	// shell cannot rebuild per rAF frame, so they do not need this path (the look is
	// scrub-live and reproduced faithfully by the SVG export).
	const hasDuplicateGenerators = (scene.duplicateGenerators?.length ?? 0) > 0;
	// Effect-based gate (not mere camera presence): a resident identity + trackless
	// camera with no cuts stays on the fast path, so the just-in-time camera on a
	// flat 2D document never degrades node-only playback. Frame-independent — it
	// keys off "any cut for this artboard", a superset of "cut at this frame".
	const hasSceneCamera = sceneCameraAffectsPlayback(
		scene,
		motion,
		scene.artboard.id,
	);
	if (grammarBindings.length > 0 || hasDuplicateGenerators || hasSceneCamera) {
		return applyPresentationScenePose(
			root,
			scene,
			samplePlaybackPresentationScene({
				scene,
				motion,
				frame,
				grammarBindings,
			}),
			touched,
		);
	}
	const current = new Set(animatedNodeIds(motion));
	removeStalePlaybackDuplicateGroups(root, current);
	for (const nodeId of touched) {
		if (!current.has(nodeId)) resetNodePose(root, scene, nodeId);
	}
	for (const nodeId of current) {
		applyNodePose(root, scene, motion, frame, nodeId);
	}
	return current;
};

const applyAtPlayhead = (marker: Element | null, touched: TouchedRef): void => {
	const root = rootFrom(marker);
	if (!root) return;
	touched.current = applyPose(
		root,
		useTransportStore.getState().currentFrame,
		touched.current,
	);
};

/**
 * Headless canvas driver, auto-discovered by the canvas shell. It owns three jobs
 * that all stay off React's render path: the rAF playback loop, imperative pose
 * application on scrub/edit, and auto-keyframe capture of scene edits. It renders
 * only a hidden marker used to scope DOM queries to this canvas instance.
 */
function PlaybackDriver({ selection }: PlaybackDriverProps) {
	const markerRef = useRef<HTMLDivElement>(null);
	const touchedRef = useRef<Set<string>>(new Set());
	const selectedNodeIdsRef = useRef<readonly string[]>(selection.nodeIds);
	const rafRef = useRef<number | null>(null);
	const lastTimeRef = useRef<number | null>(null);

	useLayoutEffect(() => {
		selectedNodeIdsRef.current = selection.nodeIds;
	}, [selection.nodeIds]);

	// Re-apply the paused pose after every render so a canvas re-render (selection,
	// viewport, scene edit) can never leave a stale base pose on screen.
	useLayoutEffect(() => {
		if (useTransportStore.getState().isPlaying) return;
		applyAtPlayhead(markerRef.current, touchedRef);
	});

	// Reflect scrub + keyframe edits while paused, without re-rendering the canvas.
	useEffect(() => {
		const onChange = (): void => {
			if (useTransportStore.getState().isPlaying) return;
			applyAtPlayhead(markerRef.current, touchedRef);
		};
		const unsubscribeMotion = useMotionStore.subscribe(onChange);
		const unsubscribeGrammar = useMotionGrammarStore.subscribe(onChange);
		const unsubscribeTransport = useTransportStore.subscribe((state, prev) => {
			if (state.currentFrame !== prev.currentFrame) onChange();
		});
		return () => {
			unsubscribeMotion();
			unsubscribeGrammar();
			unsubscribeTransport();
		};
	}, []);

	// rAF transport loop. Advancing the frame is the only per-frame store write.
	useEffect(() => {
		const stop = (): void => {
			if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
			lastTimeRef.current = null;
		};
		const tick = (timestamp: number): void => {
			if (document.visibilityState === "hidden") {
				stop();
				return;
			}
			const transport = useTransportStore.getState();
			setFrameDiagnosticGauge("transport.frame", transport.currentFrame);
			setFrameDiagnosticGauge("transport.rafTimestamp", timestamp);
			const motion = useMotionStore.getState().document;
			if (lastTimeRef.current === null) lastTimeRef.current = timestamp;
			else
				recordFramePhase(
					"transport.rafInterval",
					timestamp - lastTimeRef.current,
				);
			const deltaSeconds =
				(timestamp - lastTimeRef.current) / MILLIS_PER_SECOND;
			lastTimeRef.current = timestamp;
			const { frame, ended } = advanceFrame(
				transport.currentFrame,
				deltaSeconds,
				{
					fps: motion.fps,
					durationFrames: motion.durationFrames,
					loop: transport.loop,
				},
			);
			const finishTransport = beginFramePhase("transport.advance");
			transport.setFrame(frame);
			finishTransport();
			const root = rootFrom(markerRef.current);
			if (root) {
				const finishPose = beginFramePhase("motion.applyPose");
				touchedRef.current = applyPose(root, frame, touchedRef.current);
				finishPose();
			}
			if (ended) {
				transport.pause();
				return;
			}
			rafRef.current = requestAnimationFrame(tick);
		};
		const start = (): void => {
			if (document.visibilityState === "hidden" || rafRef.current !== null)
				return;
			lastTimeRef.current = null;
			rafRef.current = requestAnimationFrame(tick);
		};
		const onVisibilityChange = (): void => {
			if (document.visibilityState === "hidden") stop();
			else if (useTransportStore.getState().isPlaying) start();
		};
		const unsubscribe = useTransportStore.subscribe((state, prev) => {
			if (state.isPlaying && !prev.isPlaying) start();
			if (!state.isPlaying && prev.isPlaying) stop();
		});
		if (useTransportStore.getState().isPlaying) start();
		document.addEventListener("visibilitychange", onVisibilityChange);
		return () => {
			stop();
			unsubscribe();
			document.removeEventListener("visibilitychange", onVisibilityChange);
		};
	}, []);

	// Auto-keyframe: a scene edit becomes motion keys at the playhead frame.
	useEffect(
		() =>
			useSceneStore.subscribe((state, prev) => {
				// Compound plans own their matching motion writes. Ignore both the
				// in-flight scene mutation and an abort that restores its base document.
				if (
					state.transaction?.meta.compoundId != null ||
					prev.transaction?.meta.compoundId != null
				) {
					return;
				}
				// Never auto-key during playback. The loop only advances the frame, but a
				// host edit (e.g. Inspector) landing mid-play would otherwise mint a key at
				// the live, rounded playhead and pollute motion history. Mirrors the
				// layout/scrub reflectors above, which both guard on isPlaying.
				if (useTransportStore.getState().isPlaying) return;
				if (state.document === prev.document) return;
				// Skip scene undo/redo replays: those move an existing history entry
				// between stacks (same object identity), unlike a fresh authoring edit.
				// Auto-keying them would silently mutate the separate motion history.
				const undone =
					prev.undoStack.length > 0 &&
					state.redoStack.at(-1) === prev.undoStack.at(-1);
				const redone =
					prev.redoStack.length > 0 &&
					state.undoStack.at(-1) === prev.redoStack.at(-1);
				if (undone || redone) return;
				const transport = useTransportStore.getState();
				const motion = useMotionStore.getState().document;
				const commands = collectAutoKeyCommands({
					previous: prev.document,
					next: state.document,
					motion,
					currentFrame: transport.currentFrame,
					recording: transport.recording,
					selectedNodeIds: selectedNodeIdsRef.current,
				});
				for (const command of commands)
					useMotionStore.getState().apply(command);
			}),
		[],
	);

	// Restore base poses if the driver unmounts (canvas teardown).
	useEffect(() => {
		const touched = touchedRef;
		const marker = markerRef;
		return () => {
			const root = rootFrom(marker.current);
			if (!root) return;
			const scene = useSceneStore.getState().document;
			for (const nodeId of touched.current) resetNodePose(root, scene, nodeId);
			touched.current = new Set();
		};
	}, []);

	return <div ref={markerRef} className="hidden" aria-hidden="true" />;
}

// Structural mirror of the canvas registry OverlayProps. Features cannot import
// the widget-layer registry types; the host passes a compatible superset.
type MotionOverlayProps = {
	readonly document: SceneDocument;
	readonly selection: {
		readonly primary: string | null;
	};
	readonly viewport: {
		readonly zoom: number;
	};
};

const PERCENT = 100;
const PATH_STROKE = "#f4c430";
const PATH_STROKE_WIDTH = 1.5;
const ANCHOR_PX = 7;
const ANCHOR_STROKE_WIDTH = 1.5;
const ANCHOR_STROKE = "#191817";
const ANCHOR_FILL = "#f4c430";
const PARTIAL_FILL = "#7a6a1d";
const ROVING_FILL = "#f4f1dd";
const TANGENT_FILL = "#ffffff";
const TANGENT_PX = 6;
const SPEED_DOT_PX = 2.5;
const MAX_SPEED_DOTS = 180;
// Sample density (frames between trace points). Coarse enough to stay cheap on a
// long timeline, fine enough that an eased segment reads as a curve, not a chord.
const PATH_POLYLINE_STEP = 2;

const screenScale = (zoom: number): number =>
	Number.isFinite(zoom) && zoom > 0 ? zoom / PERCENT : 1;

const polylinePoints = (
	points: readonly { readonly x: number; readonly y: number }[],
): string => points.map((point) => `${point.x},${point.y}`).join(" ");

/**
 * Direct spatial motion-path chrome for the primary selected node. Anchor drags
 * write paired X/Y values; tangent drags write only spatial metadata. Shift
 * constrains an anchor/handle, Alt breaks tangent continuity, double-click toggles
 * auto tangents, and Alt-double-click toggles/distributes an interior roving key.
 */
function MotionPathOverlay({
	document,
	selection,
	viewport,
}: MotionOverlayProps) {
	const motion = useMotionStore((state) => state.document);
	const drag = useRef<{
		readonly kind: "anchor" | "in" | "out";
		readonly frame: number;
		readonly origin: { readonly x: number; readonly y: number };
	} | null>(null);
	const node = findNode(document, selection.primary);
	if (!node) return null;

	const path = buildMotionPath(node, motion, PATH_POLYLINE_STEP);
	if (path.anchors.length < 2) return null;
	const relationResolution = resolveMotionRelations({ sampledScene: document });
	const structuralParentId = relationResolution.structuralParentNodeIdById.get(
		node.id,
	);
	const pathToArtboard = structuralParentId
		? (relationResolution.worldMatrixByNodeId.get(structuralParentId) ??
			IDENTITY_MATRIX)
		: IDENTITY_MATRIX;
	const artboardToPath = invertMatrix(pathToArtboard);
	if (!artboardToPath) return null;

	const scale = screenScale(viewport.zoom);
	const anchorRadius = ANCHOR_PX / scale / 2;
	const tangentRadius = TANGENT_PX / scale / 2;
	const speedDotRadius = SPEED_DOT_PX / scale / 2;
	const firstFrame = path.anchors[0]?.frame ?? 0;
	const lastFrame = path.anchors.at(-1)?.frame ?? firstFrame;
	const speedDotStep = Math.max(
		1,
		Math.ceil((lastFrame - firstFrame - 1) / MAX_SPEED_DOTS),
	);
	const speedDots: {
		readonly frame: number;
		readonly x: number;
		readonly y: number;
	}[] = [];
	for (
		let frame = firstFrame + speedDotStep;
		frame < lastFrame;
		frame += speedDotStep
	) {
		const sample = samplePositionPath(motion, node.id, frame);
		if (!sample) continue;
		const point = applyMatrixToPoint(pathToArtboard, sample.position);
		speedDots.push({ frame, x: point.x, y: point.y });
	}
	const pointFromEvent = (
		event: ReactPointerEvent<SVGSVGElement>,
	): { readonly x: number; readonly y: number } | null => {
		const matrix = event.currentTarget.getScreenCTM();
		if (!matrix) return null;
		const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
			matrix.inverse(),
		);
		return applyMatrixToPoint(artboardToPath, { x: point.x, y: point.y });
	};
	const constrain = (
		value: { readonly x: number; readonly y: number },
		origin: { readonly x: number; readonly y: number },
		shiftKey: boolean,
	): { readonly x: number; readonly y: number } => {
		if (!shiftKey) return value;
		const dx = value.x - origin.x;
		const dy = value.y - origin.y;
		if (drag.current?.kind === "anchor") {
			return Math.abs(dx) >= Math.abs(dy)
				? { x: value.x, y: origin.y }
				: { x: origin.x, y: value.y };
		}
		const distance = Math.hypot(dx, dy);
		const angle =
			Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
		return {
			x: origin.x + Math.cos(angle) * distance,
			y: origin.y + Math.sin(angle) * distance,
		};
	};
	const startDrag = (
		event: ReactPointerEvent<SVGElement>,
		kind: "anchor" | "in" | "out",
		frame: number,
		origin: { readonly x: number; readonly y: number },
	): void => {
		event.preventDefault();
		event.stopPropagation();
		drag.current = { kind, frame, origin };
		event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
	};
	const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
		const active = drag.current;
		if (!active) return;
		const raw = pointFromEvent(event);
		if (!raw) return;
		const point = constrain(raw, active.origin, event.shiftKey);
		if (active.kind === "anchor") {
			useMotionStore
				.getState()
				.apply(upsertPositionKeyframe(node.id, active.frame, point));
			return;
		}
		useMotionStore
			.getState()
			.apply(
				setPositionPathTangent(
					node.id,
					active.frame,
					active.kind,
					{ x: point.x - active.origin.x, y: point.y - active.origin.y },
					{ breakContinuity: event.altKey },
				),
			);
	};
	const endDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
		if (!drag.current) return;
		drag.current = null;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
	};
	const activateAnchor = (
		event: ReactMouseEvent<SVGRectElement>,
		anchor: (typeof path.anchors)[number],
	): void => {
		event.preventDefault();
		event.stopPropagation();
		const store = useMotionStore.getState();
		if (!anchor.spatialMode) {
			store.apply(
				enablePositionPath(
					node.id,
					path.anchors.map((item) => ({
						frame: item.frame,
						position: { x: item.x, y: item.y },
					})),
				),
			);
			return;
		}
		if (event.altKey) {
			store.beginTransaction(`motion-path-roving:${node.id}`, "Set roving key");
			store.apply(setPositionPathRoving(node.id, anchor.frame, !anchor.roving));
			store.apply(distributeRovingPositionKeys(node.id));
			store.commit();
			return;
		}
		store.apply(
			setPositionPathSpatialMode(
				node.id,
				anchor.frame,
				anchor.spatialMode === "auto" ? "corner" : "auto",
			),
		);
	};

	return (
		<svg
			className="absolute inset-0 h-full w-full"
			viewBox={`0 0 ${document.artboard.width} ${document.artboard.height}`}
			onPointerMove={onPointerMove}
			onPointerUp={endDrag}
			onPointerCancel={endDrag}
			aria-hidden="true"
		>
			<polyline
				points={polylinePoints(
					path.polyline.map((point) =>
						applyMatrixToPoint(pathToArtboard, point),
					),
				)}
				fill="none"
				stroke={PATH_STROKE}
				strokeWidth={PATH_STROKE_WIDTH}
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeDasharray="4 3"
				vectorEffect="non-scaling-stroke"
			/>
			{speedDots.map((point) => (
				<circle
					key={`speed-dot:${point.frame}`}
					cx={point.x}
					cy={point.y}
					r={speedDotRadius}
					fill={PATH_STROKE}
					pointerEvents="none"
				/>
			))}
			{path.anchors.map((anchor, index) => {
				const anchorPoint = applyMatrixToPoint(pathToArtboard, anchor);
				const shownInTangent =
					anchor.inTangent &&
					(anchor.inTangent.x !== 0 || anchor.inTangent.y !== 0)
						? anchor.inTangent
						: anchor.spatialMode !== undefined &&
								anchor.spatialMode !== "auto" &&
								index > 0
							? { x: -32 / scale, y: 0 }
							: null;
				const shownOutTangent =
					anchor.outTangent &&
					(anchor.outTangent.x !== 0 || anchor.outTangent.y !== 0)
						? anchor.outTangent
						: anchor.spatialMode !== undefined &&
								anchor.spatialMode !== "auto" &&
								index < path.anchors.length - 1
							? { x: 32 / scale, y: 0 }
							: null;
				const inPoint = shownInTangent
					? applyMatrixToPoint(pathToArtboard, {
							x: anchor.x + shownInTangent.x,
							y: anchor.y + shownInTangent.y,
						})
					: null;
				const outPoint = shownOutTangent
					? applyMatrixToPoint(pathToArtboard, {
							x: anchor.x + shownOutTangent.x,
							y: anchor.y + shownOutTangent.y,
						})
					: null;
				return (
					<g key={anchor.frame}>
						{shownInTangent && inPoint ? (
							<>
								<line
									x1={anchorPoint.x}
									y1={anchorPoint.y}
									x2={inPoint.x}
									y2={inPoint.y}
									stroke={PATH_STROKE}
									strokeWidth={1}
									vectorEffect="non-scaling-stroke"
								/>
								<circle
									cx={inPoint.x}
									cy={inPoint.y}
									r={tangentRadius}
									fill={TANGENT_FILL}
									stroke={ANCHOR_STROKE}
									strokeWidth={ANCHOR_STROKE_WIDTH}
									vectorEffect="non-scaling-stroke"
									pointerEvents="all"
									onPointerDown={(event) =>
										startDrag(event, "in", anchor.frame, {
											x: anchor.x,
											y: anchor.y,
										})
									}
								/>
							</>
						) : null}
						{shownOutTangent && outPoint ? (
							<>
								<line
									x1={anchorPoint.x}
									y1={anchorPoint.y}
									x2={outPoint.x}
									y2={outPoint.y}
									stroke={PATH_STROKE}
									strokeWidth={1}
									vectorEffect="non-scaling-stroke"
								/>
								<circle
									cx={outPoint.x}
									cy={outPoint.y}
									r={tangentRadius}
									fill={TANGENT_FILL}
									stroke={ANCHOR_STROKE}
									strokeWidth={ANCHOR_STROKE_WIDTH}
									vectorEffect="non-scaling-stroke"
									pointerEvents="all"
									onPointerDown={(event) =>
										startDrag(event, "out", anchor.frame, {
											x: anchor.x,
											y: anchor.y,
										})
									}
								/>
							</>
						) : null}
						{/* biome-ignore lint/a11y/noStaticElementInteractions: SVG path anchors are direct-manipulation canvas handles; equivalent precise controls live in Inspector. */}
						<rect
							x={anchorPoint.x - anchorRadius}
							y={anchorPoint.y - anchorRadius}
							width={anchorRadius * 2}
							height={anchorRadius * 2}
							transform={`rotate(45 ${anchorPoint.x} ${anchorPoint.y})`}
							fill={
								anchor.roving
									? ROVING_FILL
									: anchor.hasX && anchor.hasY
										? ANCHOR_FILL
										: PARTIAL_FILL
							}
							stroke={ANCHOR_STROKE}
							strokeWidth={ANCHOR_STROKE_WIDTH}
							vectorEffect="non-scaling-stroke"
							pointerEvents="all"
							onPointerDown={(event) =>
								startDrag(event, "anchor", anchor.frame, {
									x: anchor.x,
									y: anchor.y,
								})
							}
							onDoubleClick={(event) => activateAnchor(event, anchor)}
						/>
					</g>
				);
			})}
		</svg>
	);
}

/** Numbered exact-key correspondence preview; index zero is the morph seam. */
function MorphCorrespondenceOverlay({
	document,
	selection,
	viewport,
}: MotionOverlayProps) {
	const [selectedVertex, setSelectedVertex] = useState(0);
	const [preview, setPreview] = useState<"seam" | "winding" | "repair" | null>(
		null,
	);
	const motion = useMotionStore((state) => state.document);
	const frame = useTransportStore((state) => state.currentFrame);
	const node = findNode(document, selection.primary);
	if (node?.geometry.kind !== "path") return null;
	const track = motion.tracks.find(
		(candidate) =>
			candidate.target.nodeId === node.id &&
			candidate.target.property === "pathShape",
	);
	const keyIndex =
		track?.keyframes.findIndex((key) => key.time === frame) ?? -1;
	const keyframe = keyIndex >= 0 ? track?.keyframes[keyIndex] : undefined;
	if (!isValidPathShape(keyframe?.value)) return null;
	const adjacentKey =
		track?.keyframes[keyIndex + 1] ?? track?.keyframes[keyIndex - 1];
	const adjacentShape = isValidPathShape(adjacentKey?.value)
		? adjacentKey.value
		: null;
	const targetVertexCount = Math.max(
		keyframe.value.vertices.length,
		adjacentShape?.vertices.length ?? 0,
	);
	const repairedCurrent =
		preview === "repair"
			? repairMorphShapeVertexCount(keyframe.value, targetVertexCount)
			: keyframe.value;
	const repairedAdjacent =
		preview === "repair" && adjacentShape
			? repairMorphShapeVertexCount(adjacentShape, targetVertexCount)
			: adjacentShape;
	const displayShape =
		preview === "seam"
			? (rotateMorphFirstVertex(repairedCurrent, selectedVertex) ??
				repairedCurrent)
			: preview === "winding"
				? reverseMorphWinding(repairedCurrent)
				: repairedCurrent;
	const displaySelectedVertex = preview === "seam" ? 0 : selectedVertex;
	const scale = screenScale(viewport.zoom);
	const transform =
		resolveMotionRelations({
			sampledScene: document,
		}).structuralWorldMatrixByNodeId.get(node.id) ??
		matrixFromTransform(node.transform);
	const pointFor = (vertex: readonly [number, number]) =>
		applyMatrixToPoint(transform, { x: vertex[0], y: vertex[1] });
	return (
		<>
			<div className="pointer-events-auto absolute top-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-md border border-white/10 bg-surface-raised/95 p-1 text-ui shadow-lg backdrop-blur-xl">
				<span className="px-1 text-fg-muted">
					Vertex {selectedVertex} · frame {keyframe.time}
					{adjacentKey ? ` ↔ ${adjacentKey.time}` : ""}
				</span>
				<button
					type="button"
					disabled={!keyframe.value.closed}
					onPointerEnter={() => setPreview("seam")}
					onPointerLeave={() => setPreview(null)}
					onClick={() =>
						track &&
						useMotionStore
							.getState()
							.apply(
								setPathMorphFirstVertex(
									track.id,
									keyframe.time,
									selectedVertex,
								),
							)
					}
					className="h-6 rounded border border-white/10 bg-white/[0.035] px-2 text-fg-secondary disabled:opacity-40"
				>
					Set first
				</button>
				<button
					type="button"
					onPointerEnter={() => setPreview("winding")}
					onPointerLeave={() => setPreview(null)}
					onClick={() =>
						track &&
						useMotionStore
							.getState()
							.apply(reversePathMorphKeyWinding(track.id, keyframe.time))
					}
					className="h-6 rounded border border-white/10 bg-white/[0.035] px-2 text-fg-secondary"
				>
					Reverse
				</button>
				<button
					type="button"
					disabled={!track || targetVertexCount < 2}
					onPointerEnter={() => setPreview("repair")}
					onPointerLeave={() => setPreview(null)}
					onClick={() =>
						track &&
						useMotionStore.getState().apply(repairPathMorphTopology(track.id))
					}
					className="h-6 rounded border border-white/10 bg-white/[0.035] px-2 text-fg-secondary disabled:opacity-40"
				>
					Repair count
				</button>
			</div>
			<svg
				className="pointer-events-none absolute inset-0 h-full w-full"
				viewBox={`0 0 ${document.artboard.width} ${document.artboard.height}`}
				aria-hidden="true"
			>
				{repairedAdjacent?.vertices.map((vertex, index) => {
					const point = pointFor(vertex);
					const currentVertex = displayShape.vertices[index];
					const currentPoint = currentVertex ? pointFor(currentVertex) : null;
					return (
						// biome-ignore lint/suspicious/noArrayIndexKey: Adjacent morph index is the correspondence identity.
						<g key={`adjacent:${index}`}>
							{currentPoint ? (
								<line
									x1={currentPoint.x}
									y1={currentPoint.y}
									x2={point.x}
									y2={point.y}
									stroke="#7dd3fc"
									strokeWidth={1}
									strokeDasharray="3 3"
									vectorEffect="non-scaling-stroke"
								/>
							) : null}
							<circle
								cx={point.x}
								cy={point.y}
								r={4 / scale}
								fill="none"
								stroke="#7dd3fc"
								strokeWidth={1}
								vectorEffect="non-scaling-stroke"
							/>
						</g>
					);
				})}
				{displayShape.vertices.map((vertex, index) => {
					const point = pointFor(vertex);
					const radius =
						(index === 0 ? 8 : index === displaySelectedVertex ? 7 : 6) / scale;
					return (
						// biome-ignore lint/suspicious/noArrayIndexKey: Morph vertex index is the durable correspondence identity.
						<g key={`${index}:${vertex[0]}:${vertex[1]}`}>
							<circle
								cx={point.x}
								cy={point.y}
								r={radius}
								fill={index === 0 ? "#f4c430" : "#191817"}
								stroke={index === displaySelectedVertex ? "#7dd3fc" : "#ffffff"}
								strokeWidth={index === displaySelectedVertex ? 2 : 1}
								vectorEffect="non-scaling-stroke"
								pointerEvents="all"
								className="cursor-pointer"
								onPointerDown={(event) => {
									event.preventDefault();
									event.stopPropagation();
									setSelectedVertex(index);
								}}
							/>
							<text
								x={point.x}
								y={point.y}
								fill={index === 0 ? "#191817" : "#ffffff"}
								fontSize={8 / scale}
								textAnchor="middle"
								dominantBaseline="central"
							>
								{index}
							</text>
						</g>
					);
				})}
			</svg>
		</>
	);
}

/**
 * Editor "Preview interactions" DOM driver (Interactive Motion program,
 * T3-S4). Headless like `PlaybackDriver` (renders only a hidden marker) and
 * un-gated (runs under every tool — the canvas pointer wiring in
 * `CanvasShell.tsx` is what actually swallows tool input while preview is
 * on). Owns ONE job: the interaction-engine rAF tick loop, active only while
 * `useTransportStore`'s `interactionPreview` is `true`. Ticking calls
 * `transport.setFrame(frame)` for every advanced frame — `PlaybackDriver`'s
 * OWN existing "reflect scrub + keyframe edits while paused" subscription
 * (guarded on `!isPlaying`, which stays `false` throughout preview) already
 * re-applies keyframed pose at that new frame, so this driver does not
 * duplicate `applyPose`; it only drives the frame the other driver reacts to.
 *
 * `"set-prop"` output events are NOT handled here: they only ever arise from
 * `handleEvent` (a click/hover dispatch), never from `tick` (confirmed —
 * `createInteractionEngine`'s `tick` only advances the frame/reports
 * clip-lifecycle events, it never runs an action), so applying them lives
 * next to the dispatch call itself
 * (`dispatchActiveInteractionPreviewEvent` in `interaction-preview.ts`,
 * called from `CanvasShell.tsx`'s pointer handlers) rather than here.
 *
 * The engine instance itself is written to `useInteractionPreviewEngineStore`
 * (a plain Zustand store in `interaction-preview.ts`) so the canvas pointer
 * wiring — a different component — can dispatch into the SAME live engine
 * without prop drilling.
 */
function InteractionPreviewDriver() {
	const engineRef = useRef<InteractionEngine | null>(null);
	const sourceSignatureRef = useRef<string | null>(null);
	const rafRef = useRef<number | null>(null);
	const lastTimeRef = useRef<number | null>(null);

	// Build (or rebuild, when interactions/clips/fps/duration changed) the
	// engine whenever preview turns on, and tear it down when it turns off —
	// mirrors `PlaybackDriver`'s start/stop rAF subscription below, plus the
	// rebuild-on-source-change requirement this session adds.
	useEffect(() => {
		const pauseLoop = (): void => {
			if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
			lastTimeRef.current = null;
		};
		const teardown = (): void => {
			pauseLoop();
			engineRef.current = null;
			sourceSignatureRef.current = null;
			useInteractionPreviewEngineStore.getState().setEngine(null);
		};
		const ensureEngine = (): InteractionEngine => {
			const source = readInteractionPreviewSource();
			const signature = interactionPreviewSourceSignature(source);
			if (engineRef.current && sourceSignatureRef.current === signature) {
				return engineRef.current;
			}
			const engine = buildInteractionPreviewEngine(source);
			// Preserve the playhead across a build/rebuild: entering preview must
			// not jump the frame, and a mid-preview rebuild (an interaction edited
			// live via the inspector's remove button) should not reset playback
			// position either.
			engine.seek(useTransportStore.getState().currentFrame);
			engineRef.current = engine;
			sourceSignatureRef.current = signature;
			useInteractionPreviewEngineStore.getState().setEngine(engine);
			return engine;
		};
		const tick = (timestamp: number): void => {
			if (document.visibilityState === "hidden") {
				pauseLoop();
				return;
			}
			const transport = useTransportStore.getState();
			if (!transport.interactionPreview) {
				teardown();
				return;
			}
			const engine = ensureEngine();
			if (lastTimeRef.current === null) lastTimeRef.current = timestamp;
			const deltaSeconds =
				(timestamp - lastTimeRef.current) / MILLIS_PER_SECOND;
			lastTimeRef.current = timestamp;
			const result = engine.tick(deltaSeconds);
			useTransportStore.getState().setFrame(result.frame);
			rafRef.current = requestAnimationFrame(tick);
		};
		const start = (): void => {
			if (document.visibilityState === "hidden" || rafRef.current !== null)
				return;
			lastTimeRef.current = null;
			ensureEngine();
			rafRef.current = requestAnimationFrame(tick);
		};
		const onVisibilityChange = (): void => {
			if (document.visibilityState === "hidden") pauseLoop();
			else if (useTransportStore.getState().interactionPreview) start();
		};
		const unsubscribe = useTransportStore.subscribe((state, prev) => {
			if (state.interactionPreview && !prev.interactionPreview) start();
			if (!state.interactionPreview && prev.interactionPreview) teardown();
		});
		if (useTransportStore.getState().interactionPreview) start();
		document.addEventListener("visibilitychange", onVisibilityChange);
		return () => {
			teardown();
			unsubscribe();
			document.removeEventListener("visibilitychange", onVisibilityChange);
		};
	}, []);

	return null;
}

export const overlays = [
	{
		// Headless driver: must run under every tool so playback / pose application
		// never depend on the active tool. Intentionally un-gated.
		id: "motion-playback",
		Component: PlaybackDriver,
	},
	{
		// Headless driver, un-gated for the same reason as motion-playback — see
		// `InteractionPreviewDriver`'s JSDoc.
		id: "interaction-preview",
		Component: InteractionPreviewDriver,
	},
	{
		// Visible motion-path chrome, gated to the Motion Path tool like the pen /
		// shape overlays gate to their tools. Without this the trajectory surfaced
		// under every tool whenever a node had >=2 position keys, crowding the
		// canvas; the host filters overlays by `tool === activeTool`.
		id: "motion-path",
		tool: "motion-path",
		Component: MotionPathOverlay,
	},
	{
		id: "motion-morph-correspondence",
		tool: "direct-select",
		Component: MorphCorrespondenceOverlay,
	},
];
