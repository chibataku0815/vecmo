import { castDraft, current, type Draft } from "immer";
import { createId } from "@/shared/lib/id";
import {
	type StrokeWidthProfileStop,
	validateStrokeWidthProfile,
} from "@/shared/stroke/width-profile";
import {
	type EffectInfluenceRecipe,
	type EffectMaskSource,
	normalizeVisualRecipe,
	type VisualRecipe,
} from "@/shared/vec-core";
import {
	createExternalSceneAssetNode,
	createImageAssetNode,
	createProgramSurfaceAssetNode,
	createVideoAssetNode,
	imageDataWithCropMetadata,
	normalizeImageBounds,
} from "./assets";
import { createAudioAsset } from "./audio";
import type { SceneCommand } from "./command";
import {
	pruneDraftComponentPropBindings,
	synchronizeSharedColorComponentPropsFromNodeStyle,
	synchronizeSharedNumberComponentPropsFromNode,
} from "./component-prop-commands";
import { type MotionConflictView, readComponentProps } from "./component-props";
import { resolveCornerRadii } from "./corner-geometry";
import {
	pruneEffectFieldRecipeIdentities,
	remapEffectFieldRecipeIdentities,
} from "./effect-field-identity";
import { cloneSceneDocument, createNode } from "./factory";
import { remapClonedMotionParentBindings } from "./motion-relations";
import {
	graphWithObjectNoiseGradientTexture,
	isObjectNoiseGradientScopedLook,
	objectNoiseGradientScopedLook,
	objectNoiseGradientScopedLookForNode,
	objectNoiseGradientScopedLookId,
	objectNoiseGradientTextureFromRecipe,
	replaceObjectNoiseGradientScopedLook,
	scopedLookGraphOverlayForNode,
	visualRecipeWithoutParticleMaterial,
} from "./noise-gradient-look";
import {
	objectPathBlurScopedLook,
	objectPathBlurScopedLookId,
} from "./path-blur-look";
import {
	isProductionControlValueInRange,
	type ProductionControlValue,
	parseExternalProductionLink,
} from "./production-link";
import { parseProgramSurfaceAsset } from "./program-surface";
import {
	applyEffectIntentPatch,
	type EffectIntentDraft,
	normalizeEffectIntent,
} from "./recipe-resolve";
import {
	clampTextBoxBounds,
	getGeometryBounds,
	getNodeLocalBounds,
	type Matrix2D,
	matrixFromTransform,
	normalizeTextContent,
	normalizeTextResizeMode,
	normalizeTextStyle,
	resizedTextBoundsForGeometry,
	textBoundsForContent,
	transformFromMatrix,
} from "./rendering";
import { type ReparentTarget, resolveInsertIndex } from "./reparent";
import { pruneScopedLookTargets } from "./scoped-look-prune";
import {
	findDraftLayer,
	findDraftLayerByNodeId,
	findDraftNode,
	isFrameNode,
	isTopLevelSceneNode,
	normalizeArtboardRole,
	selectNodeArtboardMapping,
} from "./selectors";
import { sourceOpticsRigsForArtboard } from "./source-optics";
import {
	pruneSourceOpticsRigs,
	remapSourceOpticsRigsForDuplicate,
} from "./source-optics-commands";
import type {
	Artboard,
	AudioAsset,
	AudioAssetSource,
	AudioTrack,
	Bounds,
	CameraSpacePolicy,
	ComponentInstanceBinding,
	ComponentNodeBinding,
	ComponentNodeOverride,
	CornerRadii,
	EffectIntent,
	ExternalSceneAsset,
	ExternalSceneAssetCapability,
	ExternalSceneAssetFormat,
	ExternalSceneAssetKind,
	ExternalSceneAssetSource,
	ImageAsset,
	ImageAssetSource,
	NodeGeometry,
	NodeStyle,
	Paint,
	ProgramSurfaceAsset,
	ProgramSurfaceFallback,
	RevealPaint,
	SceneAsset,
	SceneAssetFidelityIssue,
	SceneDocument,
	SceneLayer,
	SceneMediaSource,
	ScopedEffectLook,
	StylePreset,
	TextResizeMode,
	TextStyle,
	Transform,
	Vec2,
	VectorNode,
	VideoAsset,
	VideoAssetSource,
} from "./types";

/**
 * Transform edit payload used by scene commands and canvas writer adapters.
 * Matrix patches preserve the node anchor while direct transform patches allow
 * inspector-style scalar edits to remain undoable through the same command bus.
 */
export type NodeTransformPatch = {
	readonly matrix?: Matrix2D;
	readonly transform?: Partial<Transform>;
};

export type NodeStylePatch = Partial<
	Pick<
		NodeStyle,
		| "fill"
		| "stroke"
		| "strokeWidth"
		| "opacity"
		| "fills"
		| "strokes"
		| "effects"
		| "blendMode"
		| "strokeAlign"
		| "strokeDash"
		| "strokeDashoffset"
		| "strokeCap"
		| "strokeJoin"
		| "strokeMiterLimit"
		| "strokeSoftness"
	>
> & {
	/**
	 * `undefined` leaves {@link NodeStyle.strokeWidthProfile} unchanged, `null`
	 * clears it, and an array sets it. An array that fails
	 * {@link validateStrokeWidthProfile} is silently dropped from the patch —
	 * callers that need loud feedback on invalid stops (the agent command
	 * surface) validate before building this patch.
	 */
	readonly strokeWidthProfile?: readonly StrokeWidthProfileStop[] | null;
};

export type TextStylePatch = Partial<TextStyle>;

export type TextNodePatch = {
	readonly text?: string;
	readonly bounds?: Bounds;
	readonly mode?: TextResizeMode;
	readonly style?: TextStylePatch;
};

export type TextBoxResizePatch = {
	readonly bounds?: Bounds;
	readonly mode?: TextResizeMode;
};

/**
 * Metadata for append commands that originate from external vector imports.
 * The scene command intentionally accepts plain scene layers instead of import
 * feature types so entities remain independent from parser/UI feature code.
 */
export type AppendImportedLayersOptions = {
	readonly sourceName?: string;
	readonly sourceFormat?: string;
};

/**
 * Scene-shaped import payload accepted by the entity command bridge. This type
 * mirrors parser payloads structurally without importing feature-owned import
 * contracts into the scene entity layer.
 */
export type AppendImportedScenePayload = {
	readonly layers: readonly SceneLayer[];
	readonly artboards?: readonly Artboard[];
	/**
	 * Optional document-local assets emitted by import adapters. Entity commands
	 * merge them beside imported image nodes so export does not see missing assets.
	 */
	readonly assets?: readonly SceneAsset[];
	readonly currentArtboardId?: string;
	readonly sourceName?: string;
	readonly sourceFormat?: string;
	readonly issues?: readonly unknown[];
};

/**
 * Import append options for UI bridges that need to preserve parser metadata
 * while optionally avoiding an editor focus change.
 */
export type AppendImportedScenePayloadOptions = AppendImportedLayersOptions & {
	readonly select?: boolean;
};

export type AppendNodeOptions = {
	readonly layerId?: string;
	readonly label?: string;
};

/**
 * Input for adding an editable image node and its document-local asset in one
 * scene command. Callers provide already-minted ids so UI bridges can select the
 * node after applying the command without coupling to entity id generation.
 */
export type PlaceImageNodeInput = {
	readonly assetId: string;
	readonly nodeId: string;
	readonly name: string;
	readonly bounds: Bounds;
	readonly source: ImageAssetSource;
	readonly artboardId?: string;
	readonly mimeType?: string;
	readonly width?: number;
	readonly height?: number;
	readonly crop?: Bounds;
};

/** Placement destination options shared with generic append-node commands. */
export type PlaceImageNodeOptions = AppendNodeOptions;

/**
 * Input for adding an editable video-backed media node and document-local asset
 * in one scene command. The node uses image geometry for rectangular placement.
 */
export type PlaceVideoNodeInput = {
	readonly assetId: string;
	readonly nodeId: string;
	readonly name: string;
	readonly bounds: Bounds;
	readonly source: VideoAssetSource;
	readonly artboardId?: string;
	readonly mimeType?: string;
	readonly width?: number;
	readonly height?: number;
	readonly durationSeconds?: number;
};

/** Placement destination options shared with image/video media placement. */
export type PlaceVideoNodeOptions = AppendNodeOptions;

/**
 * Input for safely placing an externally generated code/3D scene asset. The
 * resulting node is a rectangular placement/preview handle; this command never
 * executes agent-authored code.
 */
export type PlaceExternalSceneAssetInput = {
	readonly assetId: string;
	readonly nodeId: string;
	readonly kind: ExternalSceneAssetKind;
	readonly name: string;
	readonly bounds: Bounds;
	readonly source: ExternalSceneAssetSource;
	readonly artboardId?: string;
	readonly format?: ExternalSceneAssetFormat;
	readonly mimeType?: string;
	readonly width?: number;
	readonly height?: number;
	readonly preview?: ExternalSceneAsset["preview"];
	readonly capabilities?: readonly ExternalSceneAssetCapability[];
	readonly issues?: ExternalSceneAsset["issues"];
};

/** Placement destination options shared with image/video/external asset placement. */
export type PlaceExternalSceneAssetOptions = AppendNodeOptions;

/**
 * Only the 3D external kind can carry a linked production. The format is
 * deliberately not part of the gate: a `rendered-rgba-sequence` link legitimately
 * has no GLB/GLTF payload yet.
 */
const LINKED_PRODUCTION_ASSET_KIND =
	"model-3d" satisfies ExternalSceneAssetKind;

export type LinkProductionOptions = {
	readonly label?: string;
	readonly coalesceKey?: string;
};

export type UnlinkProductionOptions = LinkProductionOptions;

/**
 * `compoundId` joins the existing cross-store undo coordinator so a control
 * gesture that touches both the Scene value and a Motion keyframe reverts as one
 * intent.
 */
export type SetProductionControlValueOptions = LinkProductionOptions & {
	readonly compoundId?: string;
};

/**
 * Input for placing one inert, manifest-validated Program Surface. Its source
 * remains document data only; this command never approves, loads, or executes
 * the program.
 */
export type PlaceProgramSurfaceAssetInput = {
	readonly assetId: string;
	readonly nodeId: string;
	readonly name: string;
	readonly bounds: Bounds;
	readonly source: SceneMediaSource;
	readonly manifest: unknown;
	readonly artboardId?: string;
	readonly mimeType?: string;
	readonly issues?: readonly SceneAssetFidelityIssue[];
};

export type PlaceProgramSurfaceAssetOptions = AppendNodeOptions;

/** Additive metadata patch; invalid next manifests are rejected atomically. */
export type ProgramSurfaceAssetPatch = {
	readonly name?: string;
	readonly source?: SceneMediaSource;
	readonly manifest?: unknown;
	readonly mimeType?: string | null;
	readonly issues?: readonly SceneAssetFidelityIssue[] | null;
};

export type UpdateProgramSurfaceAssetOptions = {
	readonly label?: string;
	readonly coalesceKey?: string;
};

/**
 * A command-bus-owned fallback assignment seam. It deliberately accepts only
 * an existing distinct image asset; approval and host execution remain
 * session-local concerns in the Program Surface feature.
 */
export type AssignProgramSurfaceFallbackOptions =
	UpdateProgramSurfaceAssetOptions;

/** Full metadata input used when one existing image placement changes surface. */
export type ReplaceProgramSurfaceAssetInput = Omit<
	PlaceProgramSurfaceAssetInput,
	"nodeId" | "bounds" | "artboardId"
>;

export type ReplaceProgramSurfaceAssetOptions = UpdateImagePlacementOptions & {
	readonly bounds?: Bounds;
};

/** Editable image placement fields that can change without replacing bytes. */
export type ImagePlacementPatch = {
	readonly bounds?: Bounds;
	readonly crop?: Bounds | null;
};

/** History metadata for image placement edits and drag-style coalescing. */
export type UpdateImagePlacementOptions = {
	readonly label?: string;
	readonly coalesceKey?: string;
};

/** Optional placement edits to apply while swapping an image node's asset. */
export type ReplaceImageAssetOptions = UpdateImagePlacementOptions & {
	readonly bounds?: Bounds;
	readonly crop?: Bounds | null;
};

/**
 * User-editable artboard fields accepted by artboard commands. The id is
 * intentionally excluded because renaming and resizing must not invalidate node
 * ownership references.
 */
export type ArtboardPatch = Partial<
	Pick<
		Artboard,
		| "name"
		| "role"
		| "position"
		| "width"
		| "height"
		| "background"
		| "fills"
		| "fps"
		| "durationFrames"
	>
> & {
	/** `undefined` preserves; `null` explicitly clears the declaration. */
	readonly cameraSpacePolicy?: CameraSpacePolicy | null;
};

export type EffectIntentTarget =
	| { readonly scope: "scene" }
	| { readonly scope: "current-artboard" }
	| { readonly scope: "default-artboard" }
	| { readonly scope: "artboard"; readonly artboardId: string };

/**
 * Sparse vec-core side-car edit. Omitted slots are preserved, while `null`
 * clears that slot and may remove the whole optional side-car when no payload
 * remains.
 */
export type EffectIntentPatch = EffectIntentDraft;

export type UpdateEffectIntentOptions = {
	readonly label?: string;
	readonly coalesceKey?: string;
};

/** Options controlling where a new artboard is inserted and focused. */
export type AddArtboardOptions = {
	readonly label?: string;
	readonly select?: boolean;
	readonly toIndex?: number;
};

/** Inputs for deterministic artboard creation planning. */
export type AddArtboardPlanOptions = {
	readonly id?: string;
	readonly name?: string;
	readonly position?: Vec2;
	readonly width?: number;
	readonly height?: number;
	readonly background?: string;
	readonly fps?: number;
	readonly durationFrames?: number;
	readonly toIndex?: number;
};

/**
 * Snapshot-scoped artboard creation plan. The artboard object is ready for
 * {@link createAddArtboardCommand}, while `toIndex` records the clamped insertion
 * slot that produced the deterministic plan.
 */
export type AddArtboardPlan = {
	readonly artboard: Artboard;
	readonly toIndex: number;
};

/**
 * Options for deterministic artboard duplication. Optional id/name values are
 * treated as bases and still receive suffixes when they would collide.
 */
export type DuplicateArtboardOptions = {
	readonly id?: string;
	readonly name?: string;
	readonly label?: string;
	readonly select?: boolean;
	readonly toIndex?: number;
	readonly offset?: Vec2;
	readonly duplicateContents?: boolean;
};

/** Options for choosing the destination that receives focus and node ownership. */
export type RemoveArtboardOptions = {
	readonly fallbackArtboardId?: string;
	readonly label?: string;
};

/** Options shared by scalar artboard edits and drag-style coalesced updates. */
export type UpdateArtboardOptions = {
	readonly label?: string;
	readonly coalesceKey?: string;
};

/** One top-level node clone that should be inserted beside its source root. */
export type DuplicateArtboardContentInsertion = {
	readonly layerId: string;
	readonly sourceRootNodeId: string;
	readonly node: VectorNode;
};

/**
 * Pure duplicate-content plan shared by commands and future UI bridges. It lets
 * callers derive the duplicated root ids from a scene snapshot before applying
 * the command, while the command still owns the actual document mutation.
 */
export type DuplicateArtboardContentsPlan = {
	readonly layerInsertions: readonly DuplicateArtboardContentInsertion[];
	readonly newRootNodeIds: readonly string[];
	readonly idMap: Readonly<Record<string, string>>;
};

/** Selection snapshot captured before applying an artboard duplicate command. */
export type DuplicateArtboardSelectionInput = {
	readonly nodeIds: readonly string[];
	readonly primaryNodeId?: string | null;
};

/**
 * Post-duplicate node selection for UI bridges. `mappedNodeIds` documents which
 * source ids received cloned ids, while `droppedNodeIds` explains which selected
 * ids were cleared because they would point outside the duplicated artboard.
 */
export type DuplicateArtboardSelectionPlan = {
	readonly nodeIds: readonly string[];
	readonly primaryNodeId: string | null;
	readonly mappedNodeIds: Readonly<Record<string, string>>;
	readonly droppedNodeIds: readonly string[];
};

/**
 * Complete artboard duplicate plan, including shell placement and optional
 * content clones. The result is snapshot-scoped: callers that use
 * `contents.newRootNodeIds` for selection should apply the matching command
 * before other scene edits can change ids or artboard ordering.
 */
export type DuplicateArtboardPlan = {
	readonly duplicate: Artboard;
	readonly toIndex: number;
	readonly contents: DuplicateArtboardContentsPlan;
};

const clampFinite = (value: number, fallback: number): number =>
	Number.isFinite(value) ? value : fallback;

const clampOpacity = (opacity: number): number =>
	Math.min(1, Math.max(0, clampFinite(opacity, 1)));

const clampNonNegative = (value: number): number =>
	Math.max(0, clampFinite(value, 0));

const clampUnit = (value: number): number =>
	Math.min(1, Math.max(0, clampFinite(value, 0)));

const clampPositiveWithFallback = (value: number, fallback: number): number => {
	const finite = clampFinite(value, fallback);
	return finite > 0 ? finite : fallback;
};

const normalizeStrokeDash = (
	strokeDash: readonly number[],
): readonly number[] =>
	strokeDash
		.map((value) => clampNonNegative(value))
		.filter((value) => value > 0);

const normalizedName = (name: string): string | null => {
	const trimmed = name.trim();
	return trimmed.length > 0 ? trimmed : null;
};

const isValidTargetIndex = (length: number, targetIndex: number): boolean =>
	Number.isInteger(targetIndex) && targetIndex >= 0 && targetIndex < length;

const DEFAULT_ARTBOARD_POSITION: Vec2 = { x: 0, y: 0 };
const DUPLICATED_ARTBOARD_GAP = 80;

const clampPositive = (value: number): number | null =>
	Number.isFinite(value) && value > 0 ? value : null;

const clampPositiveInteger = (value: number): number | null => {
	const positive = clampPositive(value);
	return positive === null ? null : Math.max(1, Math.round(positive));
};

const normalizedBackground = (background: string): string | null => {
	const trimmed = background.trim();
	return trimmed.length > 0 && trimmed !== "none" ? trimmed : null;
};

const normalizeArtboardPosition = (
	position: Vec2 | undefined,
	fallback: Vec2 = DEFAULT_ARTBOARD_POSITION,
): Vec2 => ({
	x: clampFinite(position?.x ?? fallback.x, fallback.x),
	y: clampFinite(position?.y ?? fallback.y, fallback.y),
});

const materializeArtboard = (
	artboard: Artboard,
	positionFallback?: Vec2,
): Artboard => ({
	...artboard,
	position: normalizeArtboardPosition(artboard.position, positionFallback),
});

const sameVec2 = (left: Vec2 | undefined, right: Vec2 | undefined): boolean => {
	const normalizedLeft = normalizeArtboardPosition(left);
	const normalizedRight = normalizeArtboardPosition(right);
	return (
		Object.is(normalizedLeft.x, normalizedRight.x) &&
		Object.is(normalizedLeft.y, normalizedRight.y)
	);
};

const sameSerializable = (left: unknown, right: unknown): boolean =>
	JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

const sameArtboard = (left: Artboard, right: Artboard): boolean =>
	left.id === right.id &&
	left.name === right.name &&
	normalizeArtboardRole(left) === normalizeArtboardRole(right) &&
	sameVec2(left.position, right.position) &&
	Object.is(left.width, right.width) &&
	Object.is(left.height, right.height) &&
	left.background === right.background &&
	sameSerializable(left.fills, right.fills) &&
	Object.is(left.fps, right.fps) &&
	Object.is(left.durationFrames, right.durationFrames) &&
	left.cameraSpacePolicy === right.cameraSpacePolicy &&
	sameSerializable(left.effectIntent, right.effectIntent) &&
	sameSerializable(left.sourceOpticsRigs, right.sourceOpticsRigs);

const readArtboardValues = (document: SceneDocument): readonly Artboard[] => {
	const collectionDefault = document.artboards?.find(
		(artboard) => artboard.id === document.artboard.id,
	);
	const defaultArtboard = materializeArtboard(
		document.artboard,
		collectionDefault?.position,
	);
	const byId = new Map<string, Artboard>([
		[defaultArtboard.id, defaultArtboard],
	]);

	for (const artboard of document.artboards ?? []) {
		if (byId.has(artboard.id)) continue;
		byId.set(artboard.id, materializeArtboard(artboard));
	}

	return [...byId.values()];
};

const materializeDraftArtboards = (
	document: Draft<SceneDocument>,
): Draft<Artboard>[] => {
	const artboards = cloneSceneDocument(readArtboardValues(document));
	document.artboard = castDraft(
		cloneSceneDocument(artboards[0] ?? document.artboard),
	);
	document.artboards = castDraft(artboards);
	return document.artboards as Draft<Artboard>[];
};

const findArtboardValue = (
	document: SceneDocument,
	artboardId: string,
): Artboard | undefined =>
	readArtboardValues(document).find((artboard) => artboard.id === artboardId);

const patchArtboardValue = (
	artboard: Artboard,
	patch: ArtboardPatch,
): Artboard => {
	let next = cloneSceneDocument(artboard);
	let changed = false;

	if (patch.name !== undefined) {
		const name = normalizedName(patch.name);
		if (name && name !== next.name) {
			next = { ...next, name };
			changed = true;
		}
	}
	if (patch.role !== undefined) {
		const role = normalizeArtboardRole({ role: patch.role });
		if (role !== normalizeArtboardRole(next)) {
			next = { ...next, role };
			changed = true;
		}
	}
	if (patch.position !== undefined) {
		const position = normalizeArtboardPosition(patch.position, next.position);
		if (!sameVec2(next.position, position)) {
			next = { ...next, position };
			changed = true;
		}
	}
	if (patch.width !== undefined) {
		const width = clampPositive(patch.width);
		if (width !== null && !Object.is(width, next.width)) {
			next = { ...next, width };
			changed = true;
		}
	}
	if (patch.height !== undefined) {
		const height = clampPositive(patch.height);
		if (height !== null && !Object.is(height, next.height)) {
			next = { ...next, height };
			changed = true;
		}
	}
	if (patch.background !== undefined) {
		const background = normalizedBackground(patch.background);
		if (background && background !== next.background) {
			next = { ...next, background };
			changed = true;
		}
		if (background && patch.fills === undefined) {
			const fills = [{ kind: "solid", color: background }] as const;
			if (!sameSerializable(fills, next.fills)) {
				next = { ...next, fills };
				changed = true;
			}
		}
	}
	if (patch.fills !== undefined) {
		if (!sameSerializable(patch.fills, next.fills)) {
			next = { ...next, fills: cloneSceneDocument(patch.fills) };
			changed = true;
		}
	}
	if (patch.fps !== undefined) {
		const fps = clampPositiveInteger(patch.fps);
		if (fps !== null && !Object.is(fps, next.fps)) {
			next = { ...next, fps };
			changed = true;
		}
	}
	if (patch.durationFrames !== undefined) {
		const durationFrames = clampPositiveInteger(patch.durationFrames);
		if (
			durationFrames !== null &&
			!Object.is(durationFrames, next.durationFrames)
		) {
			next = { ...next, durationFrames };
			changed = true;
		}
	}
	if (patch.cameraSpacePolicy !== undefined) {
		if (patch.cameraSpacePolicy === null) {
			if (next.cameraSpacePolicy !== undefined) {
				next = { ...next, cameraSpacePolicy: undefined };
				changed = true;
			}
		} else if (patch.cameraSpacePolicy !== next.cameraSpacePolicy) {
			next = { ...next, cameraSpacePolicy: patch.cameraSpacePolicy };
			changed = true;
		}
	}

	return changed ? next : artboard;
};

const normalizeNewArtboard = (artboard: Artboard): Artboard | null => {
	const id = normalizedName(artboard.id);
	const width = clampPositive(artboard.width);
	const height = clampPositive(artboard.height);
	const background = normalizedBackground(artboard.background);
	const fps = clampPositiveInteger(artboard.fps);
	const durationFrames = clampPositiveInteger(artboard.durationFrames);
	if (!id || !width || !height || !background || !fps || !durationFrames) {
		return null;
	}
	const name = normalizedName(artboard.name) ?? id;
	const role = normalizeArtboardRole(artboard);
	const effectIntent = normalizeEffectIntent(artboard.effectIntent);
	const sourceOpticsRigs = sourceOpticsRigsForArtboard(artboard);

	return {
		id,
		name,
		...(role !== "scene" ? { role } : {}),
		position: normalizeArtboardPosition(artboard.position),
		width,
		height,
		background,
		...(artboard.fills !== undefined
			? { fills: cloneSceneDocument(artboard.fills) }
			: {}),
		fps,
		durationFrames,
		...(artboard.cameraSpacePolicy !== undefined
			? { cameraSpacePolicy: artboard.cameraSpacePolicy }
			: {}),
		...(effectIntent ? { effectIntent } : {}),
		...(sourceOpticsRigs.length > 0
			? { sourceOpticsRigs: cloneSceneDocument(sourceOpticsRigs) }
			: {}),
	};
};

const removeArtboardFromSequence = (
	document: Draft<SceneDocument>,
	artboardId: string,
): void => {
	const sequence = document.sequence;
	if (!sequence) return;
	const items = sequence.items.filter((item) => item.artboardId !== artboardId);
	if (items.length === sequence.items.length) return;
	sequence.items = castDraft(items);
};

const uniqueValue = (
	existingValues: ReadonlySet<string>,
	baseValue: string,
	suffixSeparator: string,
): string => {
	if (!existingValues.has(baseValue)) return baseValue;
	let suffix = 2;
	let candidate = `${baseValue}${suffixSeparator}${suffix}`;
	while (existingValues.has(candidate)) {
		suffix += 1;
		candidate = `${baseValue}${suffixSeparator}${suffix}`;
	}
	return candidate;
};

const uniqueValueOrdinal = (
	value: string,
	baseValue: string,
	suffixSeparator: string,
): number => {
	if (value === baseValue) return 1;
	const suffix = Number(value.slice(`${baseValue}${suffixSeparator}`.length));
	return Number.isInteger(suffix) && suffix > 1 ? suffix : 1;
};

const clampArtboardInsertIndex = (
	length: number,
	targetIndex: number | undefined,
): number => {
	if (targetIndex === undefined || !Number.isInteger(targetIndex))
		return length;
	return Math.min(length, Math.max(1, targetIndex));
};

const clampArtboardReorderIndex = (
	length: number,
	targetIndex: number,
): number | null => {
	if (!Number.isInteger(targetIndex) || length <= 1) return null;
	return Math.min(length - 1, Math.max(1, targetIndex));
};

const reassignNodeArtboard = (
	nodes: Draft<readonly VectorNode[]>,
	fromArtboardId: string,
	toArtboardId: string,
): void => {
	for (const node of nodes) {
		if (node.artboardId === fromArtboardId) node.artboardId = toArtboardId;
		if (node.children) {
			reassignNodeArtboard(node.children, fromArtboardId, toArtboardId);
		}
	}
};

const collectSceneNodeIds = (
	nodes: readonly VectorNode[],
	output: string[] = [],
): string[] => {
	for (const node of nodes) {
		output.push(node.id);
		if (node.children) collectSceneNodeIds(node.children, output);
	}
	return output;
};

const uniqueDuplicateNodeId = (
	usedIds: Set<string>,
	sourceNodeId: string,
	targetArtboardId: string,
): string => {
	const nextId = uniqueValue(
		usedIds,
		`${sourceNodeId}-${targetArtboardId}`,
		"-",
	);
	usedIds.add(nextId);
	return nextId;
};

const cloneNodeForDuplicatedArtboard = (
	node: VectorNode,
	targetArtboardId: string,
	options: {
		readonly usedIds: Set<string>;
		readonly idMap: Map<string, string>;
	},
): VectorNode => {
	const cloned = cloneSceneDocument(node);
	const nextId = uniqueDuplicateNodeId(
		options.usedIds,
		node.id,
		targetArtboardId,
	);
	options.idMap.set(node.id, nextId);
	const children = node.children?.map((child) =>
		cloneNodeForDuplicatedArtboard(child, targetArtboardId, options),
	);
	const { component: _component, children: _children, ...rest } = cloned;
	const component = remapDuplicatedComponentBinding(
		cloned.component,
		options.idMap,
	);

	return {
		...rest,
		id: nextId,
		artboardId: targetArtboardId,
		...(component ? { component } : {}),
		...(children ? { children } : {}),
	};
};

const remapDuplicatedComponentOverride = (
	override: ComponentNodeOverride,
	idMap: ReadonlyMap<string, string>,
): ComponentNodeOverride => {
	const instanceNodeId = idMap.get(override.instanceNodeId);
	return instanceNodeId ? { ...override, instanceNodeId } : override;
};

const remapDuplicatedInstanceBinding = (
	binding: ComponentInstanceBinding,
	idMap: ReadonlyMap<string, string>,
): ComponentInstanceBinding => ({
	...binding,
	sourceToInstanceNodeIds: Object.fromEntries(
		Object.entries(binding.sourceToInstanceNodeIds).map(
			([sourceNodeId, instanceNodeId]) => [
				sourceNodeId,
				idMap.get(instanceNodeId) ?? instanceNodeId,
			],
		),
	),
	...(binding.overrides
		? {
				overrides: binding.overrides.map((override) =>
					remapDuplicatedComponentOverride(override, idMap),
				),
			}
		: {}),
});

const remapDuplicatedComponentBinding = (
	component: ComponentNodeBinding | undefined,
	idMap: ReadonlyMap<string, string>,
): ComponentNodeBinding | undefined => {
	if (!component) return undefined;
	if (component.kind === "source") return undefined;
	return remapDuplicatedInstanceBinding(component, idMap);
};

const emptyDuplicateArtboardContentsPlan =
	(): DuplicateArtboardContentsPlan => ({
		layerInsertions: [],
		newRootNodeIds: [],
		idMap: {},
	});

/**
 * Plans deep node clones for a duplicated artboard without mutating the scene.
 * Top-level roots owned by the source artboard are cloned into their same layers
 * immediately after the source roots, and every descendant id/artboard reference
 * is remapped to the duplicated artboard.
 */
export function planDuplicateArtboardContents(
	document: SceneDocument,
	sourceArtboardId: string,
	targetArtboardId: string,
): DuplicateArtboardContentsPlan {
	const ownership = selectNodeArtboardMapping(document);
	const usedIds = new Set(
		collectSceneNodeIds(document.layers.flatMap((layer) => layer.nodes)),
	);
	const idMap = new Map<string, string>();
	const layerInsertions: DuplicateArtboardContentInsertion[] = [];

	for (const layer of document.layers) {
		for (const node of layer.nodes) {
			if (ownership.byNodeId[node.id] !== sourceArtboardId) continue;
			layerInsertions.push({
				layerId: layer.id,
				sourceRootNodeId: node.id,
				node: cloneNodeForDuplicatedArtboard(node, targetArtboardId, {
					usedIds,
					idMap,
				}),
			});
		}
	}

	const remappedInsertions = layerInsertions.map((insertion) => ({
		...insertion,
		node:
			remapClonedMotionParentBindings([insertion.node], idMap).nodes[0] ??
			insertion.node,
	}));

	return {
		layerInsertions: remappedInsertions,
		newRootNodeIds: remappedInsertions.map((insertion) => insertion.node.id),
		idMap: Object.fromEntries(idMap.entries()),
	};
}

/**
 * Remaps the current node selection after an artboard duplicate. The planner
 * only keeps selected nodes that belonged to the duplicated source artboard and
 * received cloned ids; every other selected id is dropped so UI bridges do not
 * leave a source-artboard selection active while focus moves to the duplicate.
 */
export function planDuplicateArtboardSelection(
	document: SceneDocument,
	sourceArtboardId: string,
	contents: DuplicateArtboardContentsPlan,
	selection: DuplicateArtboardSelectionInput,
): DuplicateArtboardSelectionPlan {
	const ownership = selectNodeArtboardMapping(document);
	const mappedNodeIds: Record<string, string> = {};
	const droppedNodeIds: string[] = [];
	const nextNodeIds: string[] = [];
	const seenNextIds = new Set<string>();

	for (const nodeId of selection.nodeIds) {
		const nextNodeId =
			ownership.byNodeId[nodeId] === sourceArtboardId
				? contents.idMap[nodeId]
				: undefined;
		if (!nextNodeId) {
			droppedNodeIds.push(nodeId);
			continue;
		}
		mappedNodeIds[nodeId] = nextNodeId;
		if (seenNextIds.has(nextNodeId)) continue;
		seenNextIds.add(nextNodeId);
		nextNodeIds.push(nextNodeId);
	}

	const mappedPrimary =
		selection.primaryNodeId === null || selection.primaryNodeId === undefined
			? undefined
			: mappedNodeIds[selection.primaryNodeId];

	return {
		nodeIds: nextNodeIds,
		primaryNodeId: mappedPrimary ?? nextNodeIds.at(-1) ?? null,
		mappedNodeIds,
		droppedNodeIds,
	};
}

const importLabel = (options: AppendImportedLayersOptions): string => {
	if (options.sourceName) return `Import ${options.sourceName}`;
	if (options.sourceFormat) return `Import ${options.sourceFormat}`;
	return "Import scene";
};

type ImportedArtboardMerge = {
	readonly artboards: readonly Artboard[];
	readonly remappedArtboardIds: ReadonlyMap<string, string>;
};

const currentOrDefaultArtboardId = (document: SceneDocument): string => {
	const artboards = readArtboardValues(document);
	const current = artboards.find(
		(artboard) => artboard.id === document.currentArtboardId,
	);
	return current?.id ?? artboards[0]?.id ?? document.artboard.id;
};

/**
 * Plans a new top-level artboard beside the current/default artboard without
 * touching the scene. UI bridges use this to show and then apply the exact id,
 * name, pasteboard position, and insertion slot that the command will commit.
 */
export function planAddArtboard(
	document: SceneDocument,
	options: AddArtboardPlanOptions = {},
): AddArtboardPlan | null {
	const artboardsBefore = readArtboardValues(document);
	const currentArtboardId = currentOrDefaultArtboardId(document);
	const current =
		artboardsBefore.find((artboard) => artboard.id === currentArtboardId) ??
		artboardsBefore[0] ??
		document.artboard;
	const currentPosition = normalizeArtboardPosition(current.position);
	const existingIds = new Set(
		artboardsBefore.map(
			(artboard) => normalizedName(artboard.id) ?? artboard.id,
		),
	);
	const existingNames = new Set(
		artboardsBefore.map(
			(artboard) => normalizedName(artboard.name) ?? artboard.name,
		),
	);
	const idBase = normalizedName(options.id ?? "") ?? "artboard";
	const nameBase = normalizedName(options.name ?? "") ?? "Artboard";
	const background = options.background ?? current.background;
	const fills =
		options.background === undefined
			? current.fills
			: ([{ kind: "solid", color: background }] as const);
	const artboard = normalizeNewArtboard({
		id: uniqueValue(existingIds, idBase, "-"),
		name: uniqueValue(existingNames, nameBase, " "),
		position: options.position ?? {
			x: currentPosition.x + current.width + DUPLICATED_ARTBOARD_GAP,
			y: currentPosition.y,
		},
		width: options.width ?? current.width,
		height: options.height ?? current.height,
		background,
		...(fills !== undefined ? { fills } : {}),
		fps: options.fps ?? current.fps,
		durationFrames: options.durationFrames ?? current.durationFrames,
	});
	if (!artboard) return null;

	return {
		artboard,
		toIndex: clampArtboardInsertIndex(artboardsBefore.length, options.toIndex),
	};
}

const normalizeImportedArtboards = (
	document: SceneDocument,
	importedArtboards: readonly Artboard[],
): ImportedArtboardMerge => {
	const reservedIds = new Set(
		readArtboardValues(document).map((artboard) => artboard.id),
	);
	const seenSourceIds = new Set<string>();
	const remappedArtboardIds = new Map<string, string>();
	const artboards: Artboard[] = [];

	for (const importedArtboard of importedArtboards) {
		const normalized = normalizeNewArtboard(importedArtboard);
		if (!normalized || seenSourceIds.has(normalized.id)) continue;
		seenSourceIds.add(normalized.id);

		const id = uniqueValue(reservedIds, normalized.id, "-");
		reservedIds.add(id);
		remappedArtboardIds.set(normalized.id, id);
		artboards.push(id === normalized.id ? normalized : { ...normalized, id });
	}

	return { artboards, remappedArtboardIds };
};

const resolveImportedFocusArtboardId = (
	document: SceneDocument,
	currentArtboardId: string | undefined,
	merge: ImportedArtboardMerge,
): string => {
	const normalizedCurrentArtboardId =
		currentArtboardId === undefined ? null : normalizedName(currentArtboardId);
	if (normalizedCurrentArtboardId) {
		const remapped = merge.remappedArtboardIds.get(normalizedCurrentArtboardId);
		if (remapped) return remapped;

		const existing = findArtboardValue(document, normalizedCurrentArtboardId);
		if (existing && merge.artboards.length === 0) return existing.id;
	}

	return merge.artboards[0]?.id ?? currentOrDefaultArtboardId(document);
};

const resolveImportedNodeArtboardId = (
	artboardId: string | undefined,
	remappedArtboardIds: ReadonlyMap<string, string>,
	validArtboardIds: ReadonlySet<string>,
	fallbackArtboardId: string,
): string => {
	const normalizedArtboardId =
		artboardId === undefined ? null : normalizedName(artboardId);
	if (!normalizedArtboardId) return fallbackArtboardId;
	return (
		remappedArtboardIds.get(normalizedArtboardId) ??
		(validArtboardIds.has(normalizedArtboardId)
			? normalizedArtboardId
			: fallbackArtboardId)
	);
};

const assignImportedNodeArtboards = (
	nodes: readonly VectorNode[],
	remappedArtboardIds: ReadonlyMap<string, string>,
	validArtboardIds: ReadonlySet<string>,
	fallbackArtboardId: string,
	inheritedArtboardId: string = fallbackArtboardId,
): readonly VectorNode[] =>
	nodes.map((node) => {
		const artboardId = resolveImportedNodeArtboardId(
			node.artboardId,
			remappedArtboardIds,
			validArtboardIds,
			inheritedArtboardId,
		);
		return {
			...node,
			artboardId,
			...(node.children
				? {
						children: assignImportedNodeArtboards(
							node.children,
							remappedArtboardIds,
							validArtboardIds,
							fallbackArtboardId,
							artboardId,
						),
					}
				: {}),
		};
	});

const layersWithResolvedImportedArtboards = (
	layers: readonly SceneLayer[],
	remappedArtboardIds: ReadonlyMap<string, string>,
	validArtboardIds: ReadonlySet<string>,
	fallbackArtboardId: string,
): readonly SceneLayer[] =>
	layers.map((layer) => ({
		...layer,
		nodes: assignImportedNodeArtboards(
			layer.nodes,
			remappedArtboardIds,
			validArtboardIds,
			fallbackArtboardId,
		),
	}));

const sameBounds = (left: Bounds, right: Bounds): boolean =>
	Object.is(left.x, right.x) &&
	Object.is(left.y, right.y) &&
	Object.is(left.width, right.width) &&
	Object.is(left.height, right.height);

const writeEffectIntentPatch = (
	target: Draft<{ effectIntent?: EffectIntent }>,
	patch: EffectIntentPatch,
): void => {
	const nextIntent = applyEffectIntentPatch(target.effectIntent, patch);
	if (sameSerializable(target.effectIntent, nextIntent)) return;
	if (nextIntent) {
		target.effectIntent = castDraft(nextIntent);
		return;
	}
	delete target.effectIntent;
};

const effectIntentTargetArtboardId = (
	document: SceneDocument,
	target: EffectIntentTarget,
): string | null => {
	switch (target.scope) {
		case "scene":
			return null;
		case "current-artboard":
			return currentOrDefaultArtboardId(document);
		case "default-artboard":
			return document.artboard.id;
		case "artboard":
			return normalizedName(target.artboardId);
	}
};

const findDraftArtboardEffectIntentTargets = (
	document: Draft<SceneDocument>,
	target: EffectIntentTarget,
): Draft<Artboard>[] => {
	const artboardId = effectIntentTargetArtboardId(document, target);
	if (!artboardId) return [];
	if (!findArtboardValue(document, artboardId)) return [];

	const targets: Draft<Artboard>[] = [];
	if (document.artboard.id === artboardId) {
		targets.push(document.artboard);
	}
	const collectionArtboard = document.artboards?.find(
		(artboard) => artboard.id === artboardId,
	);
	if (
		collectionArtboard &&
		!targets.some((artboard) => artboard === collectionArtboard)
	) {
		targets.push(collectionArtboard);
	}
	return targets;
};

const sameTextStyle = (left: TextStyle, right: TextStyle): boolean =>
	left.fontFamily === right.fontFamily &&
	Object.is(left.fontSize, right.fontSize) &&
	Object.is(left.lineHeight, right.lineHeight) &&
	left.align === right.align &&
	Object.is(left.fontWeight, right.fontWeight) &&
	Object.is(left.letterSpacing, right.letterSpacing) &&
	(left.italic ?? false) === (right.italic ?? false) &&
	(left.underline ?? false) === (right.underline ?? false);

const normalizeImageAsset = (asset: ImageAsset): ImageAsset | null => {
	const id = normalizedName(asset.id);
	if (!id) return null;
	return {
		...asset,
		id,
		name: normalizedName(asset.name) ?? id,
	};
};

const normalizeVideoAsset = (asset: VideoAsset): VideoAsset | null => {
	const id = normalizedName(asset.id);
	if (!id) return null;
	return {
		...asset,
		id,
		name: normalizedName(asset.name) ?? id,
	};
};

const normalizeAudioAsset = (asset: AudioAsset): AudioAsset | null => {
	const id = normalizedName(asset.id);
	if (!id) return null;
	return {
		...asset,
		id,
		name: normalizedName(asset.name) ?? id,
	};
};

/**
 * Canonicalizes an external asset and re-derives its linked-production contract
 * from scratch. The static type of `production` is a claim, not a guarantee:
 * cloud restore, portable backup, and the agent's asset upsert all reach this
 * function with unvalidated data, so an unparseable link is dropped rather than
 * trusted. Everything else about the asset is preserved unchanged.
 */
const normalizeExternalSceneAsset = (
	asset: ExternalSceneAsset,
): ExternalSceneAsset | null => {
	const id = normalizedName(asset.id);
	if (!id) return null;
	const { production: declaredProduction, ...rest } = asset;
	const production = parseExternalProductionLink(declaredProduction);
	return {
		...rest,
		id,
		name: normalizedName(asset.name) ?? id,
		...(production ? { production } : {}),
	};
};

/** Returns a canonical Program Surface asset or rejects the whole metadata edit. */
const normalizeProgramSurfaceAsset = (
	asset: unknown,
): ProgramSurfaceAsset | null => {
	const parsed = parseProgramSurfaceAsset(asset);
	return parsed.status === "valid" ? parsed.asset : null;
};

const normalizeSceneAsset = (asset: SceneAsset): SceneAsset | null => {
	switch (asset.kind) {
		case "image":
			return normalizeImageAsset(asset);
		case "video":
			return normalizeVideoAsset(asset);
		case "audio":
			return normalizeAudioAsset(asset);
		case "external-scene":
		case "model-3d":
		case "code-module":
			return normalizeExternalSceneAsset(asset);
		case "program-surface":
			return normalizeProgramSurfaceAsset(asset);
	}
};

const materializeDraftAssets = (
	document: Draft<SceneDocument>,
): Draft<SceneAsset>[] => {
	if (!document.assets) document.assets = castDraft([] as SceneAsset[]);
	return document.assets as Draft<SceneAsset>[];
};

const findDraftAssetIndex = (
	assets: readonly Draft<SceneAsset>[],
	assetId: string,
): number => assets.findIndex((asset) => asset.id === assetId);

const appendSceneAssetIfMissing = (
	document: Draft<SceneDocument>,
	asset: SceneAsset,
): void => {
	const assets = materializeDraftAssets(document);
	if (findDraftAssetIndex(assets, asset.id) >= 0) return;
	assets.push(castDraft(cloneSceneDocument(asset)));
};

const upsertSceneAsset = (
	document: Draft<SceneDocument>,
	asset: SceneAsset,
): void => {
	const assets = materializeDraftAssets(document);
	const index = findDraftAssetIndex(assets, asset.id);
	if (index < 0) {
		assets.push(castDraft(cloneSceneDocument(asset)));
		return;
	}
	if (sameSerializable(assets[index], asset)) return;
	assets[index] = castDraft(cloneSceneDocument(asset));
};

const paintReferencesSceneAsset = (paint: Paint, assetId: string): boolean =>
	paint.kind === "image-reference" && paint.assetId === assetId;

const stylePresetReferencesSceneAsset = (
	preset: StylePreset,
	assetId: string,
): boolean => {
	const paints = [
		...(preset.appearance?.fills ?? []),
		...(preset.appearance?.strokes ?? []),
	];
	return paints.some((paint) => paintReferencesSceneAsset(paint, assetId));
};

const nodeReferencesSceneAsset = (
	node: VectorNode,
	assetId: string,
): boolean => {
	if (node.geometry.kind === "image" && node.geometry.assetId === assetId) {
		return true;
	}
	const paints = [...(node.style.fills ?? []), ...(node.style.strokes ?? [])];
	if (paints.some((paint) => paintReferencesSceneAsset(paint, assetId))) {
		return true;
	}
	return (
		node.children?.some((child) => nodeReferencesSceneAsset(child, assetId)) ??
		false
	);
};

const documentReferencesSceneAsset = (
	document: SceneDocument,
	assetId: string,
): boolean =>
	document.layers.some((layer) =>
		layer.nodes.some((node) => nodeReferencesSceneAsset(node, assetId)),
	) ||
	(document.stylePresets?.some((preset) =>
		stylePresetReferencesSceneAsset(preset, assetId),
	) ??
		false) ||
	(document.assets?.some(
		(asset) =>
			asset.kind === "program-surface" &&
			asset.manifest.fallback?.assetId === assetId,
	) ??
		false) ||
	// Audio assets are never referenced by node geometry (S5a has no audio
	// node); an `AudioTrack` sidecar is the only referencing structure, so it
	// must be checked explicitly here for the same fail-closed removal
	// behavior video/image assets already get through this shared scan.
	(document.audioTracks?.some((track) => track.assetId === assetId) ?? false);

/** Creates or replaces one same-kind asset-library entry. */
export function createUpsertSceneAssetCommand(asset: SceneAsset): SceneCommand {
	const normalized = normalizeSceneAsset(asset);
	return {
		type: "scene/upsert-asset",
		label: "Save asset",
		run: (draft) => {
			if (!normalized) return;
			const existing = draft.assets?.find(
				(entry) => entry.id === normalized.id,
			);
			if (existing && existing.kind !== normalized.kind) return;
			upsertSceneAsset(draft, normalized);
		},
	};
}

/** Removes any unreferenced asset kind through the common reference scan. */
export function createRemoveUnusedSceneAssetCommand(
	assetId: string,
): SceneCommand {
	const normalizedAssetId = normalizedName(assetId);
	return {
		type: "scene/remove-unused-asset",
		label: "Delete asset",
		run: (draft) => {
			if (
				!normalizedAssetId ||
				documentReferencesSceneAsset(draft, normalizedAssetId)
			)
				return;
			const assets = draft.assets;
			if (!assets?.some((asset) => asset.id === normalizedAssetId)) return;
			draft.assets = castDraft(
				assets.filter((asset) => asset.id !== normalizedAssetId),
			);
		},
	};
}

/** Places an existing library asset as one ordinary rectangular media node. */
export function createPlaceExistingSceneAssetCommand(
	input: {
		readonly assetId: string;
		readonly nodeId: string;
		readonly bounds: Bounds;
		readonly artboardId?: string;
		readonly name?: string;
	},
	options: AppendNodeOptions = {},
): SceneCommand {
	const assetId = normalizedName(input.assetId);
	const nodeId = normalizedName(input.nodeId);
	const bounds = normalizeImageBounds(input.bounds);
	return {
		type: "scene/place-existing-asset",
		label: options.label ?? "Place asset",
		run: (draft) => {
			if (!assetId || !nodeId || !bounds || findDraftNode(draft, nodeId))
				return;
			const asset = draft.assets?.find((entry) => entry.id === assetId);
			if (!asset) return;
			const target = options.layerId
				? draft.layers.find((layer) => layer.id === options.layerId)
				: draft.layers.at(-1);
			if (!target) return;
			const node = createNode(
				"image",
				{ kind: "image", bounds, assetId },
				{ name: normalizedName(input.name ?? "") ?? asset.name },
			);
			target.nodes.push(
				castDraft({
					...node,
					id: nodeId,
					...(input.artboardId ? { artboardId: input.artboardId } : {}),
				}),
			);
		},
	};
}

const writeImageCropMetadata = (
	node: Draft<VectorNode>,
	crop: Bounds | null | undefined,
): void => {
	const nextData = imageDataWithCropMetadata(node.data, crop);
	if (sameSerializable(node.data, nextData)) return;
	if (nextData) {
		node.data = castDraft(nextData);
		return;
	}
	delete node.data;
};

const insertDuplicateArtboardContents = (
	document: Draft<SceneDocument>,
	contents: DuplicateArtboardContentsPlan,
): void => {
	if (contents.layerInsertions.length === 0) return;
	const insertionsByLayer = new Map<
		string,
		Map<string, DuplicateArtboardContentInsertion>
	>();

	for (const insertion of contents.layerInsertions) {
		const layerInsertions =
			insertionsByLayer.get(insertion.layerId) ??
			new Map<string, DuplicateArtboardContentInsertion>();
		layerInsertions.set(insertion.sourceRootNodeId, insertion);
		insertionsByLayer.set(insertion.layerId, layerInsertions);
	}

	for (const layer of document.layers) {
		const layerInsertions = insertionsByLayer.get(layer.id);
		if (!layerInsertions) continue;
		for (let index = layer.nodes.length - 1; index >= 0; index -= 1) {
			const sourceNode = layer.nodes[index];
			if (!sourceNode) continue;
			const insertion = layerInsertions.get(sourceNode.id);
			if (!insertion) continue;
			layer.nodes.splice(
				index + 1,
				0,
				castDraft(cloneSceneDocument(insertion.node)),
			);
		}
	}
};

const collectSubtreeNodeIds = (
	node: VectorNode | Draft<VectorNode>,
	output: Set<string>,
): void => {
	output.add(node.id);
	for (const child of node.children ?? []) {
		collectSubtreeNodeIds(child, output);
	}
};

/**
 * Drops removed node ids from scoped-look targets, Effect Field object/group
 * routes, and SVG matte references across every scene/artboard side-car. Shared
 * fields that lose their final assignment are removed; a linked assignment
 * whose field source disappears keeps its inline fallback snapshot.
 */
const pruneDraftEffectTargets = (
	draft: Draft<SceneDocument>,
	removedNodeIds: ReadonlySet<string>,
): void => {
	if (removedNodeIds.size === 0) return;
	const shouldDropTarget = (nodeId: string): boolean =>
		removedNodeIds.has(nodeId);
	const targets: Draft<{ effectIntent?: EffectIntent }>[] = [
		draft,
		draft.artboard,
		...(draft.artboards ?? []),
	];
	for (const target of targets) {
		const intent = target.effectIntent;
		if (!intent) continue;
		const prunedScopedLookTargets = pruneScopedLookTargets(
			target.effectIntent?.scopedLooks,
			shouldDropTarget,
		);
		const sourceScopedLooks =
			prunedScopedLookTargets ?? target.effectIntent?.scopedLooks;
		const scopedLooks = sourceScopedLooks?.map((look): ScopedEffectLook => {
			if (look.kind !== "visual-recipe-overlay" || !look.influenceRecipe) {
				return look;
			}
			const result = pruneEffectFieldRecipeIdentities(look.influenceRecipe, {
				shouldRemoveTarget: (effectTarget) =>
					(effectTarget.scope === "object" || effectTarget.scope === "group") &&
					effectTarget.id !== undefined &&
					removedNodeIds.has(effectTarget.id),
				shouldRemoveMatteRef: shouldDropTarget,
				removeUnreferencedFields: true,
			});
			const hasRecipePayload =
				result.recipe.assignments.length > 0 ||
				(result.recipe.fields?.length ?? 0) > 0;
			if (hasRecipePayload) {
				return { ...look, influenceRecipe: result.recipe };
			}
			const { influenceRecipe: _removedInfluenceRecipe, ...withoutRecipe } =
				look;
			return withoutRecipe;
		});
		const influenceResult = intent.influenceRecipe
			? pruneEffectFieldRecipeIdentities(intent.influenceRecipe, {
					shouldRemoveTarget: (effectTarget) =>
						(effectTarget.scope === "object" ||
							effectTarget.scope === "group") &&
						effectTarget.id !== undefined &&
						removedNodeIds.has(effectTarget.id),
					shouldRemoveMatteRef: shouldDropTarget,
					removeUnreferencedFields: true,
				})
			: null;
		const influenceRecipe =
			influenceResult &&
			(influenceResult.recipe.assignments.length > 0 ||
				(influenceResult.recipe.fields?.length ?? 0) > 0)
				? influenceResult.recipe
				: null;
		writeEffectIntentPatch(target, {
			influenceRecipe,
			scopedLooks: scopedLooks && scopedLooks.length > 0 ? scopedLooks : null,
		});
	}
	const artboards: Draft<Artboard>[] = [
		draft.artboard,
		...(draft.artboards ?? []),
	];
	for (const artboard of artboards) {
		const sourceOpticsRigs = pruneSourceOpticsRigs(
			artboard.sourceOpticsRigs,
			removedNodeIds,
		);
		if (sourceOpticsRigs) {
			artboard.sourceOpticsRigs = castDraft(
				cloneSceneDocument(sourceOpticsRigs),
			);
		} else {
			delete artboard.sourceOpticsRigs;
		}
	}
};

const removeDeletableDraftNodes = (
	nodes: Draft<VectorNode[]>,
	targetIds: ReadonlySet<string>,
	ancestorsUnlocked: boolean,
	removedNodeIds: Set<string>,
): void => {
	for (let index = nodes.length - 1; index >= 0; index -= 1) {
		const node = nodes[index];
		if (!node?.visible) continue;
		const unlocked = ancestorsUnlocked && !node.locked;
		if (unlocked && targetIds.has(node.id)) {
			collectSubtreeNodeIds(node, removedNodeIds);
			nodes.splice(index, 1);
			continue;
		}
		if (node.children) {
			removeDeletableDraftNodes(
				castDraft(node.children),
				targetIds,
				unlocked,
				removedNodeIds,
			);
		}
	}
};

const materializeSourceOwnedNodeArtboards = (
	document: Draft<SceneDocument>,
	sourceArtboardId: string,
): void => {
	const ownership = selectNodeArtboardMapping(document);
	const visit = (nodes: Draft<readonly VectorNode[]>): void => {
		for (const node of nodes) {
			if (
				ownership.byNodeId[node.id] === sourceArtboardId &&
				node.artboardId !== sourceArtboardId
			) {
				node.artboardId = sourceArtboardId;
			}
			if (node.children) visit(node.children);
		}
	};

	for (const layer of document.layers) {
		visit(layer.nodes);
	}
};

const nodeWithResolvedInsertionArtboard = (
	document: SceneDocument,
	node: VectorNode,
	inheritedArtboardId?: string,
): VectorNode => {
	const explicitArtboardId =
		node.artboardId && findArtboardValue(document, node.artboardId)
			? node.artboardId
			: undefined;
	const artboardId =
		explicitArtboardId ??
		inheritedArtboardId ??
		currentOrDefaultArtboardId(document);
	const children = node.children?.map((child) =>
		nodeWithResolvedInsertionArtboard(document, child, artboardId),
	);
	return {
		...node,
		artboardId,
		...(children ? { children } : {}),
	};
};

/**
 * Rebuilds a duplicated scoped look's id when its identity embeds the single
 * target node id (`object-path-blur:<nodeId>` / `object-noise-gradient:<nodeId>`),
 * so the "id mirrors the owned target" invariant survives the duplicate.
 * Selection-scoped looks keep their authored id, which carries no node ids.
 */
const duplicatedScopedLookId = (
	look: ScopedEffectLook,
	targetNodeIds: readonly string[],
): string => {
	const soleTargetId = targetNodeIds.length === 1 ? targetNodeIds[0] : null;
	if (!soleTargetId || look.kind !== "look-graph-overlay") return look.id;
	if (look.source === "object-path-blur") {
		return objectPathBlurScopedLookId(soleTargetId);
	}
	if (look.source === "object-noise-gradient") {
		return objectNoiseGradientScopedLookId(soleTargetId);
	}
	return look.id;
};

const collectEffectFieldStackItemIds = (
	source: EffectMaskSource,
	output: Set<string>,
): void => {
	if (source.kind !== "stack") return;
	for (const item of source.items) {
		output.add(item.id);
		collectEffectFieldStackItemIds(item.source, output);
	}
};

const duplicatedEffectFieldIdentityMap = (
	ids: Iterable<string>,
	artboardId: string,
): ReadonlyMap<string, string> =>
	new Map([...ids].map((id) => [id, `${id}:copy:${artboardId}`]));

/** Deep-clones one artboard-owned field recipe without retaining source-node ids. */
const remapDuplicatedArtboardInfluenceRecipe = (
	recipe: EffectInfluenceRecipe,
	idMap: Readonly<Record<string, string>>,
	sourceOwnedNodeIds: ReadonlySet<string>,
	targetArtboardId: string,
): EffectInfluenceRecipe | null => {
	const stackItemIds = new Set<string>();
	for (const assignment of recipe.assignments) {
		collectEffectFieldStackItemIds(assignment.influence.source, stackItemIds);
	}
	for (const field of recipe.fields ?? []) {
		collectEffectFieldStackItemIds(field.source, stackItemIds);
	}
	const nodeIdMap = new Map(Object.entries(idMap));
	const remappedRecipe = remapEffectFieldRecipeIdentities(recipe, {
		assignmentIds: duplicatedEffectFieldIdentityMap(
			recipe.assignments.map((assignment) => assignment.id),
			targetArtboardId,
		),
		fieldIds: duplicatedEffectFieldIdentityMap(
			(recipe.fields ?? []).map((field) => field.id),
			targetArtboardId,
		),
		targetIds: nodeIdMap,
		matteRefIds: nodeIdMap,
		stackItemIds: duplicatedEffectFieldIdentityMap(
			stackItemIds,
			targetArtboardId,
		),
	}).recipe;
	const duplicatedNodeIds = new Set(Object.values(idMap));
	const pruned = pruneEffectFieldRecipeIdentities(remappedRecipe, {
		shouldRemoveTarget: (target) =>
			(target.scope === "object" || target.scope === "group") &&
			target.id !== undefined &&
			!duplicatedNodeIds.has(target.id),
		shouldRemoveMatteRef: (refId) => sourceOwnedNodeIds.has(refId),
		removeUnreferencedFields: true,
	}).recipe;
	return pruned.assignments.length > 0 || (pruned.fields?.length ?? 0) > 0
		? pruned
		: null;
};

/**
 * Remaps artboard scoped looks and Effect Field identities onto duplicated
 * content node ids. Targets that were not cloned stay on the source artboard
 * and are dropped so the duplicate never holds cross-artboard references. With
 * `duplicateContents: false` all object/group routes and scoped looks drop while
 * scene/layer routes remain independent copies.
 */
const remapDuplicatedArtboardEffectIntent = (
	effectIntent: EffectIntent | undefined,
	idMap: Readonly<Record<string, string>>,
	sourceOwnedNodeIds: ReadonlySet<string>,
	targetArtboardId: string,
): EffectIntent | undefined => {
	if (!effectIntent) return effectIntent;
	const remappedInfluenceRecipe = effectIntent.influenceRecipe
		? remapDuplicatedArtboardInfluenceRecipe(
				effectIntent.influenceRecipe,
				idMap,
				sourceOwnedNodeIds,
				targetArtboardId,
			)
		: null;
	const remappedLooks = effectIntent.scopedLooks?.flatMap(
		(look): ScopedEffectLook[] => {
			const targetNodeIds = look.targetNodeIds.flatMap((nodeId) => {
				const duplicatedId = idMap[nodeId];
				return duplicatedId ? [duplicatedId] : [];
			});
			if (targetNodeIds.length === 0) return [];
			const influenceRecipe =
				look.kind === "visual-recipe-overlay" && look.influenceRecipe
					? remapDuplicatedArtboardInfluenceRecipe(
							look.influenceRecipe,
							idMap,
							sourceOwnedNodeIds,
							targetArtboardId,
						)
					: null;
			if (look.kind === "visual-recipe-overlay") {
				const { influenceRecipe: _sourceInfluenceRecipe, ...withoutInfluence } =
					look;
				return [
					{
						...withoutInfluence,
						id: duplicatedScopedLookId(look, targetNodeIds),
						targetNodeIds,
						...(influenceRecipe ? { influenceRecipe } : {}),
					},
				];
			}
			return [
				{
					...look,
					id: duplicatedScopedLookId(look, targetNodeIds),
					targetNodeIds,
				},
			];
		},
	);
	const {
		influenceRecipe: _sourceInfluenceRecipe,
		scopedLooks: _sourceScopedLooks,
		...withoutRemappedSlots
	} = effectIntent;
	const next: EffectIntent = {
		...withoutRemappedSlots,
		...(remappedInfluenceRecipe
			? { influenceRecipe: remappedInfluenceRecipe }
			: {}),
		...(remappedLooks && remappedLooks.length > 0
			? { scopedLooks: remappedLooks }
			: {}),
	};
	return Object.keys(next).length > 0 ? next : undefined;
};

/**
 * Plans an artboard duplicate without mutating the scene. The same helper backs
 * the command path and future Inspector/Layers bridges that need deterministic
 * ids for post-command selection focus.
 */
export function planDuplicateArtboard(
	document: SceneDocument,
	sourceArtboardId: string,
	options: DuplicateArtboardOptions = {},
): DuplicateArtboardPlan | null {
	const artboardsBefore = readArtboardValues(document);
	const sourceIndex = artboardsBefore.findIndex(
		(artboard) => artboard.id === sourceArtboardId,
	);
	const source = artboardsBefore[sourceIndex];
	if (!source) return null;

	const existingIds = new Set(
		artboardsBefore.map(
			(artboard) => normalizedName(artboard.id) ?? artboard.id,
		),
	);
	const existingNames = new Set(
		artboardsBefore.map(
			(artboard) => normalizedName(artboard.name) ?? artboard.name,
		),
	);
	const duplicateIdBase =
		normalizedName(options.id ?? "") ?? `${source.id}-copy`;
	const duplicateId = uniqueValue(existingIds, duplicateIdBase, "-");
	const duplicateNameBase =
		normalizedName(options.name ?? "") ?? `${source.name} copy`;
	const duplicateName = uniqueValue(existingNames, duplicateNameBase, " ");
	const duplicateOrdinal = uniqueValueOrdinal(
		duplicateId,
		duplicateIdBase,
		"-",
	);
	const offset = options.offset ?? {
		x: (source.width + DUPLICATED_ARTBOARD_GAP) * duplicateOrdinal,
		y: 0,
	};
	const duplicate = normalizeNewArtboard({
		...source,
		id: duplicateId,
		name: duplicateName,
		position: {
			x: normalizeArtboardPosition(source.position).x + offset.x,
			y: normalizeArtboardPosition(source.position).y + offset.y,
		},
	});
	if (!duplicate) return null;

	const defaultToIndex = Math.min(
		sourceIndex + duplicateOrdinal,
		artboardsBefore.length,
	);
	const toIndex = clampArtboardInsertIndex(
		artboardsBefore.length,
		options.toIndex ?? defaultToIndex,
	);
	const contents =
		options.duplicateContents === false
			? emptyDuplicateArtboardContentsPlan()
			: planDuplicateArtboardContents(document, sourceArtboardId, duplicate.id);
	const ownership = selectNodeArtboardMapping(document);
	const sourceOwnedNodeIds = new Set(
		Object.entries(ownership.byNodeId).flatMap(([nodeId, artboardId]) =>
			artboardId === sourceArtboardId ? [nodeId] : [],
		),
	);

	const effectIntent = remapDuplicatedArtboardEffectIntent(
		duplicate.effectIntent,
		contents.idMap,
		sourceOwnedNodeIds,
		duplicate.id,
	);
	const sourceOpticsRigs = remapSourceOpticsRigsForDuplicate(
		duplicate.sourceOpticsRigs,
		contents.idMap,
	);
	const {
		effectIntent: _sourceEffectIntent,
		sourceOpticsRigs: _sourceOpticsRigs,
		...duplicateShell
	} = duplicate;

	return {
		duplicate: {
			...duplicateShell,
			...(effectIntent ? { effectIntent } : {}),
			...(sourceOpticsRigs ? { sourceOpticsRigs } : {}),
		},
		toIndex,
		contents,
	};
}

/**
 * Appends imported layers through the scene command bus. Layers are cloned before
 * entering the document so parser-owned payload objects never become live scene
 * references, preserving the POJO document contract and one-undo import unit.
 */
export function createAppendImportedLayersCommand(
	layers: readonly SceneLayer[],
	options: AppendImportedLayersOptions = {},
): SceneCommand {
	return {
		type: "scene/append-imported-layers",
		label: importLabel(options),
		run: (draft) => {
			if (layers.length === 0) return;
			draft.layers.push(...castDraft(cloneSceneDocument(layers)));
		},
	};
}

/**
 * Appends a full parser payload through one scene command. Imported artboards
 * are normalized and de-duplicated against the live document, imported node
 * ownership is remapped to valid artboard ids, and optional focus moves through
 * `currentArtboardId` without exposing parser feature types to widgets.
 */
export function createAppendImportedScenePayloadCommand(
	payload: AppendImportedScenePayload,
	options: AppendImportedScenePayloadOptions = {},
): SceneCommand {
	return {
		type: "scene/append-imported-scene-payload",
		label: importLabel({
			sourceName: options.sourceName ?? payload.sourceName,
			sourceFormat: options.sourceFormat ?? payload.sourceFormat,
		}),
		run: (draft) => {
			const merge = normalizeImportedArtboards(draft, payload.artboards ?? []);
			const focusArtboardId = resolveImportedFocusArtboardId(
				draft,
				payload.currentArtboardId,
				merge,
			);

			if (merge.artboards.length > 0) {
				const artboards = materializeDraftArtboards(draft);
				artboards.push(...castDraft(cloneSceneDocument(merge.artboards)));
			}

			const validArtboardIds = new Set(
				readArtboardValues(draft).map((artboard) => artboard.id),
			);
			if (payload.layers.length > 0) {
				draft.layers.push(
					...castDraft(
						cloneSceneDocument(
							layersWithResolvedImportedArtboards(
								payload.layers,
								merge.remappedArtboardIds,
								validArtboardIds,
								focusArtboardId,
							),
						),
					),
				);
			}
			for (const asset of payload.assets ?? []) {
				upsertSceneAsset(draft, asset);
			}

			if (
				(options.select ?? true) &&
				(payload.currentArtboardId !== undefined || merge.artboards.length > 0)
			) {
				draft.currentArtboardId = focusArtboardId;
			}
		},
	};
}

/**
 * Appends a pre-minted node to a scene layer through the shared command bus.
 * The default target is the top rendered layer so canvas authoring tools can
 * create visible nodes without depending on another feature's add-node helper.
 */
export function createAppendNodeCommand(
	node: VectorNode,
	options: AppendNodeOptions = {},
): SceneCommand {
	return {
		type: "scene/append-node",
		label: options.label ?? "Add node",
		coalesceKey: `scene/append-node:${node.id}`,
		run: (draft) => {
			if (draft.layers.length === 0) return;
			if (findDraftNode(draft, node.id)) return;
			const target = options.layerId
				? draft.layers.find((layer) => layer.id === options.layerId)
				: draft.layers[draft.layers.length - 1];
			if (!target) return;
			target.nodes.push(
				castDraft(
					cloneSceneDocument(nodeWithResolvedInsertionArtboard(draft, node)),
				),
			);
		},
	};
}

/**
 * Removes selected canvas-editable nodes as one undoable scene edit. The
 * visible/unlocked policy matches transform and arrange actions: protected
 * structure-panel selections stay inert while deleting a selected parent removes
 * its subtree as normal document content. Removed subtree ids are also pruned
 * from scoped-look targets so object-scoped effects never outlive their nodes.
 */
export function createDeleteNodesCommand(
	nodeIds: readonly string[],
): SceneCommand {
	const targetIds = new Set(nodeIds);
	return {
		type: "scene/delete-nodes",
		label: "Delete nodes",
		run: (draft) => {
			if (targetIds.size === 0) return;
			const allDraftNodes: Draft<VectorNode>[] = [];
			const collectDraftNodes = (nodes: Draft<VectorNode[]>): void => {
				for (const node of nodes) {
					allDraftNodes.push(node);
					if (node.children) collectDraftNodes(castDraft(node.children));
				}
			};
			for (const layer of draft.layers)
				collectDraftNodes(castDraft(layer.nodes));
			const selectedRemovalIds = new Set<string>();
			const collectSelectedRemovalIds = (node: Draft<VectorNode>): void => {
				selectedRemovalIds.add(node.id);
				for (const child of node.children ?? [])
					collectSelectedRemovalIds(child);
			};
			for (const targetId of targetIds) {
				const target = findDraftNode(draft, targetId);
				if (target) collectSelectedRemovalIds(target);
			}
			const deletableTargetIds = new Set(targetIds);
			for (const targetId of targetIds) {
				const target = findDraftNode(draft, targetId);
				if (!target) continue;
				const subtreeIds = new Set<string>();
				const collectSubtreeIds = (node: Draft<VectorNode>): void => {
					subtreeIds.add(node.id);
					for (const child of node.children ?? []) collectSubtreeIds(child);
				};
				collectSubtreeIds(target);
				const hasExternalMotionChild = allDraftNodes.some(
					(node) =>
						!subtreeIds.has(node.id) &&
						!selectedRemovalIds.has(node.id) &&
						Boolean(
							(node.motionParent &&
								subtreeIds.has(node.motionParent.parentNodeId)) ||
								(node.transformConstraint &&
									subtreeIds.has(node.transformConstraint.sourceNodeId)) ||
								node.propertyRelations?.some((relation) =>
									subtreeIds.has(relation.sourceNodeId),
								),
						),
				);
				if (hasExternalMotionChild) return;
			}
			const removedNodeIds = new Set<string>();
			for (const layer of draft.layers) {
				if (!layer.visible || layer.locked) continue;
				removeDeletableDraftNodes(
					castDraft(layer.nodes),
					deletableTargetIds,
					true,
					removedNodeIds,
				);
			}
			pruneDraftComponentPropBindings(draft, removedNodeIds);
			pruneDraftEffectTargets(draft, removedNodeIds);
		},
	};
}

/**
 * Recursively replaces a node in a draft node array with `replacement` at the
 * SAME index, preserving z-order among its siblings. Searches top-level nodes
 * first, then descends into `children` (mirrors {@link removeDeletableDraftNodes}'s
 * traversal), so a match found deeper in the tree still keeps its position
 * among its own siblings rather than moving to the end of some other list.
 * Returns whether a replacement happened, so the caller can stop scanning
 * further layers once found.
 */
const replaceDraftNodeInPlace = (
	nodes: Draft<VectorNode[]>,
	nodeId: string,
	replacement: VectorNode,
): boolean => {
	const index = nodes.findIndex((node) => node.id === nodeId);
	if (index >= 0) {
		nodes.splice(index, 1, castDraft(cloneSceneDocument(replacement)));
		return true;
	}
	for (const node of nodes) {
		if (
			node.children &&
			replaceDraftNodeInPlace(castDraft(node.children), nodeId, replacement)
		) {
			return true;
		}
	}
	return false;
};

/**
 * Replaces one node with another at the same layer index, as a single
 * undoable edit. This is the non-destructive primitive sketch-to-shape
 * recognition relies on: converting a freehand sketch to a clean rect/ellipse/
 * line is one command, so a single undo atomically restores the original
 * sketch rather than unwinding a separate delete-then-insert pair. A no-op
 * when `nodeId` is not found in the document.
 */
export function createReplaceNodeCommand(
	nodeId: string,
	replacement: VectorNode,
): SceneCommand {
	return {
		type: "scene/replace-node",
		label: "Convert to shape",
		run: (draft) => {
			for (const layer of draft.layers) {
				if (
					replaceDraftNodeInPlace(castDraft(layer.nodes), nodeId, replacement)
				) {
					return;
				}
			}
		},
	};
}

/**
 * Places an editable image node plus its document-local asset in one undoable
 * scene edit. The command deliberately preserves an existing asset with the same
 * id, leaving intentional source swaps to `createReplaceImageAssetCommand`.
 */
export function createPlaceImageNodeCommand(
	input: PlaceImageNodeInput,
	options: PlaceImageNodeOptions = {},
): SceneCommand {
	const assetId = normalizedName(input.assetId);
	const nodeId = normalizedName(input.nodeId);
	const bounds = normalizeImageBounds(input.bounds);
	const name = normalizedName(input.name) ?? "Image";
	const created =
		assetId && nodeId && bounds
			? createImageAssetNode({
					assetId,
					nodeId,
					name,
					bounds,
					source: input.source,
					artboardId: input.artboardId,
					mimeType: input.mimeType,
					width: input.width,
					height: input.height,
					crop: input.crop,
				})
			: null;

	return {
		type: "scene/place-image-node",
		label: options.label ?? "Place image",
		coalesceKey: created
			? `scene/place-image-node:${created.node.id}`
			: undefined,
		run: (draft) => {
			if (!created || draft.layers.length === 0) return;
			if (findDraftNode(draft, created.node.id)) return;
			const target = options.layerId
				? draft.layers.find((layer) => layer.id === options.layerId)
				: draft.layers[draft.layers.length - 1];
			if (!target) return;
			appendSceneAssetIfMissing(draft, created.asset);
			target.nodes.push(castDraft(cloneSceneDocument(created.node)));
		},
	};
}

/**
 * Removes an unused image asset from the document library. Referenced assets are
 * intentionally left in place so existing image nodes and image-reference paints
 * never turn into missing media by deleting metadata alone.
 */
export function createRemoveUnusedImageAssetCommand(
	assetId: string,
	options: { readonly label?: string } = {},
): SceneCommand {
	const normalizedAssetId = normalizedName(assetId);
	return {
		type: "scene/remove-unused-image-asset",
		label: options.label ?? "Delete image asset",
		run: (draft) => {
			if (
				!normalizedAssetId ||
				documentReferencesSceneAsset(draft, normalizedAssetId)
			) {
				return;
			}
			const assets = draft.assets;
			if (
				!assets?.some(
					(asset) => asset.kind === "image" && asset.id === normalizedAssetId,
				)
			) {
				return;
			}
			draft.assets = castDraft(
				assets.filter(
					(asset) => asset.kind !== "image" || asset.id !== normalizedAssetId,
				),
			);
		},
	};
}

/**
 * Places an editable video-backed media node plus its document-local asset in
 * one undoable scene edit. Pixel renderers sample the asset into frame images;
 * the scene node itself stays a normal rectangular media placement.
 */
export function createPlaceVideoNodeCommand(
	input: PlaceVideoNodeInput,
	options: PlaceVideoNodeOptions = {},
): SceneCommand {
	const assetId = normalizedName(input.assetId);
	const nodeId = normalizedName(input.nodeId);
	const bounds = normalizeImageBounds(input.bounds);
	const name = normalizedName(input.name) ?? "Video";
	const created =
		assetId && nodeId && bounds
			? createVideoAssetNode({
					assetId,
					nodeId,
					name,
					bounds,
					source: input.source,
					artboardId: input.artboardId,
					mimeType: input.mimeType,
					width: input.width,
					height: input.height,
					durationSeconds: input.durationSeconds,
				})
			: null;

	return {
		type: "scene/place-video-node",
		label: options.label ?? "Place video",
		coalesceKey: created
			? `scene/place-video-node:${created.node.id}`
			: undefined,
		run: (draft) => {
			if (!created || draft.layers.length === 0) return;
			if (findDraftNode(draft, created.node.id)) return;
			const target = options.layerId
				? draft.layers.find((layer) => layer.id === options.layerId)
				: draft.layers[draft.layers.length - 1];
			if (!target) return;
			const normalizedAsset = normalizeVideoAsset(created.asset);
			if (!normalizedAsset) return;
			appendSceneAssetIfMissing(draft, normalizedAsset);
			target.nodes.push(castDraft(cloneSceneDocument(created.node)));
		},
	};
}

/**
 * Default authored gain for a newly placed `AudioTrack` (S5a): unity, i.e. no
 * gain change from the decoded source.
 */
const AUDIO_TRACK_DEFAULT_GAIN_DB = 0;

const materializeDraftAudioTracks = (
	document: Draft<SceneDocument>,
): Draft<AudioTrack>[] => {
	if (!document.audioTracks) {
		document.audioTracks = castDraft([] as AudioTrack[]);
	}
	return document.audioTracks as Draft<AudioTrack>[];
};

const findDraftAudioTrackIndex = (
	tracks: readonly Draft<AudioTrack>[],
	trackId: string,
): number => tracks.findIndex((track) => track.id === trackId);

/**
 * Canonicalizes one `AudioTrack`. `offsetFrames` is rounded but left signed (it
 * may legitimately be negative); `outFrames` is dropped unless it trims a
 * strictly positive window after `inFrames`, matching how other optional trim
 * pairs in this file resolve to "no trim" rather than an invalid range.
 */
const normalizeAudioTrack = (track: AudioTrack): AudioTrack | null => {
	const id = normalizedName(track.id);
	const assetId = normalizedName(track.assetId);
	if (!id || !assetId) return null;
	const offsetFrames = Number.isFinite(track.offsetFrames)
		? Math.round(track.offsetFrames)
		: 0;
	const inFrames =
		track.inFrames !== undefined && Number.isFinite(track.inFrames)
			? Math.max(0, Math.round(track.inFrames))
			: undefined;
	const rawOutFrames =
		track.outFrames !== undefined && Number.isFinite(track.outFrames)
			? Math.round(track.outFrames)
			: undefined;
	const outFrames =
		rawOutFrames !== undefined && rawOutFrames > (inFrames ?? 0)
			? rawOutFrames
			: undefined;
	const gainDb = Number.isFinite(track.gainDb)
		? track.gainDb
		: AUDIO_TRACK_DEFAULT_GAIN_DB;
	return {
		id,
		assetId,
		offsetFrames,
		...(inFrames !== undefined ? { inFrames } : {}),
		...(outFrames !== undefined ? { outFrames } : {}),
		gainDb,
		muted: Boolean(track.muted),
	};
};

/**
 * Input for embedding one audio asset (S5a). Audio never places a scene
 * node — geometry, selection, and transform do not apply to it — so unlike
 * image/video this only appends a document-local asset library entry.
 * Pairing it with a frame-anchored placement is a separate
 * `scene/upsert-audio-track` command, so importing an asset and scheduling it
 * remain two undoable edits, matching how other asset libraries and their
 * placements stay decoupled.
 */
export type AddAudioAssetInput = {
	readonly assetId: string;
	readonly name: string;
	readonly source: AudioAssetSource;
	readonly mimeType?: string;
	readonly durationSeconds?: number;
	readonly sampleRate?: number;
	readonly channels?: number;
};

/** Embeds one audio asset in the document's asset library in one undoable edit. */
export function createAddAudioAssetCommand(
	input: AddAudioAssetInput,
	options: { readonly label?: string } = {},
): SceneCommand {
	const assetId = normalizedName(input.assetId);
	const name = normalizedName(input.name) ?? "Audio";
	const created = assetId
		? createAudioAsset({
				assetId,
				name,
				source: input.source,
				mimeType: input.mimeType,
				durationSeconds: input.durationSeconds,
				sampleRate: input.sampleRate,
				channels: input.channels,
			})
		: null;

	return {
		type: "scene/add-audio-asset",
		label: options.label ?? "Add audio",
		coalesceKey: created ? `scene/add-audio-asset:${created.id}` : undefined,
		run: (draft) => {
			if (!created) return;
			const normalized = normalizeAudioAsset(created);
			if (!normalized) return;
			appendSceneAssetIfMissing(draft, normalized);
		},
	};
}

/**
 * Creates or replaces one frame-anchored `AudioTrack` (S5a) in one undoable
 * edit, matching `createUpsertSceneAssetCommand`'s create-or-replace-by-id
 * shape. Does not validate that `assetId` currently resolves — an authored
 * track referencing a not-yet-added asset id is valid document state; preview
 * and export both resolve audibility read-only at their own time.
 */
export function createUpsertAudioTrackCommand(
	track: AudioTrack,
	options: { readonly label?: string } = {},
): SceneCommand {
	const normalized = normalizeAudioTrack(track);
	return {
		type: "scene/upsert-audio-track",
		label: options.label ?? "Place audio",
		coalesceKey: normalized
			? `scene/upsert-audio-track:${normalized.id}`
			: undefined,
		run: (draft) => {
			if (!normalized) return;
			const tracks = materializeDraftAudioTracks(draft);
			const index = findDraftAudioTrackIndex(tracks, normalized.id);
			if (index < 0) {
				tracks.push(castDraft(cloneSceneDocument(normalized)));
				return;
			}
			if (sameSerializable(tracks[index], normalized)) return;
			tracks[index] = castDraft(cloneSceneDocument(normalized));
		},
	};
}

/**
 * Removes one `AudioTrack` by id (S5a). The referenced audio asset is left in
 * the library untouched, mirroring how removing a video/image node never
 * deletes its asset — `scene/remove-unused-asset` is the separate, explicit
 * asset-library cleanup step and already refuses to drop an asset any
 * remaining `AudioTrack` still references.
 */
export function createRemoveAudioTrackCommand(
	trackId: string,
	options: { readonly label?: string } = {},
): SceneCommand {
	const normalizedTrackId = normalizedName(trackId);
	return {
		type: "scene/remove-audio-track",
		label: options.label ?? "Remove audio",
		run: (draft) => {
			if (!normalizedTrackId || !draft.audioTracks?.length) return;
			if (!draft.audioTracks.some((track) => track.id === normalizedTrackId)) {
				return;
			}
			draft.audioTracks = castDraft(
				draft.audioTracks.filter((track) => track.id !== normalizedTrackId),
			);
		},
	};
}

/**
 * Places an externally generated code/3D scene asset as a rectangular preview or
 * placeholder node. It stores source/capability/fidelity metadata but never
 * evaluates the asset payload.
 */
export function createPlaceExternalSceneAssetCommand(
	input: PlaceExternalSceneAssetInput,
	options: PlaceExternalSceneAssetOptions = {},
): SceneCommand {
	const assetId = normalizedName(input.assetId);
	const nodeId = normalizedName(input.nodeId);
	const bounds = normalizeImageBounds(input.bounds);
	const name = normalizedName(input.name) ?? "External asset";
	const created =
		assetId && nodeId && bounds
			? createExternalSceneAssetNode({
					assetId,
					nodeId,
					kind: input.kind,
					name,
					bounds,
					source: input.source,
					artboardId: input.artboardId,
					format: input.format,
					mimeType: input.mimeType,
					width: input.width,
					height: input.height,
					preview: input.preview,
					capabilities: input.capabilities,
					issues: input.issues,
				})
			: null;

	return {
		type: "scene/place-external-asset",
		label: options.label ?? "Place external asset",
		coalesceKey: created
			? `scene/place-external-asset:${created.node.id}`
			: undefined,
		run: (draft) => {
			if (!created || draft.layers.length === 0) return;
			if (findDraftNode(draft, created.node.id)) return;
			const target = options.layerId
				? draft.layers.find((layer) => layer.id === options.layerId)
				: draft.layers[draft.layers.length - 1];
			if (!target) return;
			const normalizedAsset = normalizeExternalSceneAsset(created.asset);
			if (!normalizedAsset) return;
			appendSceneAssetIfMissing(draft, normalizedAsset);
			target.nodes.push(castDraft(cloneSceneDocument(created.node)));
		},
	};
}

/**
 * Places a validated Program Surface declaration as one ordinary rectangular
 * scene object. The Scene command bus owns this durable write; local digest
 * approval and all runtime work remain outside the document.
 */
export function createPlaceProgramSurfaceAssetCommand(
	input: PlaceProgramSurfaceAssetInput,
	options: PlaceProgramSurfaceAssetOptions = {},
): SceneCommand {
	const assetId = normalizedName(input.assetId);
	const nodeId = normalizedName(input.nodeId);
	const bounds = normalizeImageBounds(input.bounds);
	const name = normalizedName(input.name) ?? "Program Surface";
	const created =
		assetId && nodeId && bounds
			? createProgramSurfaceAssetNode({
					assetId,
					nodeId,
					name,
					bounds,
					source: input.source,
					manifest: input.manifest,
					artboardId: input.artboardId,
					mimeType: input.mimeType,
					issues: input.issues,
				})
			: null;

	return {
		type: "scene/place-program-surface-asset",
		label: options.label ?? "Place Program Surface",
		coalesceKey: created
			? `scene/place-program-surface-asset:${created.node.id}`
			: undefined,
		run: (draft) => {
			if (!created || draft.layers.length === 0) return;
			if (findDraftNode(draft, created.node.id)) return;
			const target = options.layerId
				? draft.layers.find((layer) => layer.id === options.layerId)
				: draft.layers[draft.layers.length - 1];
			if (!target) return;
			appendSceneAssetIfMissing(draft, created.asset);
			target.nodes.push(castDraft(cloneSceneDocument(created.node)));
		},
	};
}

/**
 * Atomically updates Program Surface metadata through the Scene command bus.
 * An invalid manifest, source portability mismatch, or self-referencing
 * fallback leaves the existing durable declaration untouched.
 */
export function createUpdateProgramSurfaceAssetCommand(
	assetId: string,
	patch: ProgramSurfaceAssetPatch,
	options: UpdateProgramSurfaceAssetOptions = {},
): SceneCommand {
	const normalizedAssetId = normalizedName(assetId);
	return {
		type: "scene/update-program-surface-asset",
		label: options.label ?? "Update Program Surface",
		coalesceKey: options.coalesceKey,
		run: (draft) => {
			if (!normalizedAssetId) return;
			const existing = draft.assets?.find(
				(asset): asset is Draft<ProgramSurfaceAsset> =>
					asset.kind === "program-surface" && asset.id === normalizedAssetId,
			);
			if (!existing) return;
			const name =
				patch.name === undefined ? existing.name : normalizedName(patch.name);
			if (!name) return;
			const next = normalizeProgramSurfaceAsset({
				id: existing.id,
				kind: "program-surface",
				name,
				source: patch.source ?? existing.source,
				manifest: patch.manifest ?? existing.manifest,
				...(patch.mimeType === null
					? {}
					: patch.mimeType !== undefined
						? { mimeType: patch.mimeType }
						: existing.mimeType
							? { mimeType: existing.mimeType }
							: {}),
				...(patch.issues === null
					? {}
					: patch.issues !== undefined
						? { issues: patch.issues }
						: existing.issues
							? { issues: existing.issues }
							: {}),
			});
			if (!next) return;
			upsertSceneAsset(draft, next);
		},
	};
}

/**
 * Assigns a raster fallback through the Scene command bus without granting any
 * local execution authority. A fallback-less Program Surface therefore remains
 * importable and inert until an author selects an existing distinct image.
 */
export function createAssignProgramSurfaceFallbackCommand(
	assetId: string,
	fallback: ProgramSurfaceFallback,
	options: AssignProgramSurfaceFallbackOptions = {},
): SceneCommand {
	const normalizedAssetId = normalizedName(assetId);
	const normalizedFallbackAssetId = normalizedName(fallback.assetId);
	const frame =
		fallback.frame === undefined
			? undefined
			: Number.isSafeInteger(fallback.frame) && fallback.frame >= 0
				? fallback.frame
				: undefined;
	const hasInvalidFrame = fallback.frame !== undefined && frame === undefined;
	return {
		type: "scene/assign-program-surface-fallback",
		label: options.label ?? "Assign Program Surface fallback",
		coalesceKey: options.coalesceKey,
		run: (draft) => {
			if (
				!normalizedAssetId ||
				!normalizedFallbackAssetId ||
				hasInvalidFrame ||
				normalizedFallbackAssetId === normalizedAssetId
			) {
				return;
			}
			const existing = draft.assets?.find(
				(asset): asset is Draft<ProgramSurfaceAsset> =>
					asset.kind === "program-surface" && asset.id === normalizedAssetId,
			);
			const fallbackAsset = draft.assets?.find(
				(asset) => asset.id === normalizedFallbackAssetId,
			);
			if (!existing || fallbackAsset?.kind !== "image") return;
			const next = normalizeProgramSurfaceAsset({
				id: existing.id,
				kind: "program-surface",
				name: existing.name,
				source: existing.source,
				manifest: {
					...existing.manifest,
					fallback: {
						assetId: normalizedFallbackAssetId,
						...(frame !== undefined ? { frame } : {}),
					},
				},
				...(existing.mimeType ? { mimeType: existing.mimeType } : {}),
				...(existing.issues ? { issues: existing.issues } : {}),
			});
			if (!next) return;
			upsertSceneAsset(draft, next);
		},
	};
}

/**
 * Attaches or replaces the linked-production contract on one existing 3D asset.
 * It is deliberately a dedicated command rather than a generic asset upsert, so
 * the durable link can never arrive as an unvalidated blob: an unparseable
 * contract leaves the previous state untouched instead of half-applying.
 *
 * Asset identity, placement nodes, and every other asset field are preserved;
 * only `production` changes, which keeps relinking free of node churn.
 */
export function createLinkProductionCommand(
	assetId: string,
	production: unknown,
	options: LinkProductionOptions = {},
): SceneCommand {
	const normalizedAssetId = normalizedName(assetId);
	const parsedProduction = parseExternalProductionLink(production);
	return {
		type: "scene/link-production",
		label: options.label ?? "Link production source",
		coalesceKey: options.coalesceKey,
		run: (draft) => {
			if (!normalizedAssetId || !parsedProduction) return;
			const existing = draft.assets?.find(
				(asset): asset is Draft<ExternalSceneAsset> =>
					asset.kind === LINKED_PRODUCTION_ASSET_KIND &&
					asset.id === normalizedAssetId,
			);
			if (!existing) return;
			const next = normalizeExternalSceneAsset({
				...(cloneSceneDocument(existing) as ExternalSceneAsset),
				production: parsedProduction,
			});
			if (!next) return;
			upsertSceneAsset(draft, next);
		},
	};
}

/**
 * Removes the linked-production contract while keeping the asset and every
 * placement intact, so an unlinked source degrades to an ordinary imported 3D
 * asset instead of disappearing from the scene.
 */
export function createUnlinkProductionCommand(
	assetId: string,
	options: UnlinkProductionOptions = {},
): SceneCommand {
	const normalizedAssetId = normalizedName(assetId);
	return {
		type: "scene/unlink-production",
		label: options.label ?? "Unlink production source",
		coalesceKey: options.coalesceKey,
		run: (draft) => {
			if (!normalizedAssetId) return;
			const existing = draft.assets?.find(
				(asset): asset is Draft<ExternalSceneAsset> =>
					asset.kind === LINKED_PRODUCTION_ASSET_KIND &&
					asset.id === normalizedAssetId,
			);
			if (!existing?.production) return;
			const { production: _removed, ...rest } = cloneSceneDocument(
				existing,
			) as ExternalSceneAsset;
			const next = normalizeExternalSceneAsset(rest);
			if (!next) return;
			upsertSceneAsset(draft, next);
		},
	};
}

/**
 * Sets the authored static value of one published control.
 *
 * It is a dedicated command rather than a re-link, because a relink replaces the
 * whole contract: routing a value edit through `scene/link-production` would let
 * a stale controls array or a stale camera block ride along with a number the
 * user dragged. The command upserts into `values`, keeps the array canonically
 * sorted, and writes nothing when the value is unchanged — a zero-patch run adds
 * no history entry, so scrubbing back to the current value does not consume an
 * Undo step.
 *
 * Pass `compoundId` when the same gesture also writes a Motion keyframe for the
 * control; the existing cross-store coordinator then reverts both halves as one
 * intent. No new undo machinery is introduced here.
 */
export function createSetProductionControlValueCommand(
	assetId: string,
	controlId: string,
	value: number,
	options: SetProductionControlValueOptions = {},
): SceneCommand {
	const normalizedAssetId = normalizedName(assetId);
	const normalizedControlId = normalizedName(controlId);
	return {
		type: "scene/set-production-control-value",
		label: options.label ?? "Set production control",
		coalesceKey: options.coalesceKey,
		...(options.compoundId ? { compoundId: options.compoundId } : {}),
		run: (draft) => {
			if (!normalizedAssetId || !normalizedControlId) return;
			if (!Number.isFinite(value)) return;
			const existing = draft.assets?.find(
				(asset): asset is Draft<ExternalSceneAsset> =>
					asset.kind === LINKED_PRODUCTION_ASSET_KIND &&
					asset.id === normalizedAssetId,
			);
			if (!existing) return;
			const link = parseExternalProductionLink(existing.production);
			if (!link) return;
			const control = link.controls.find(
				(candidate) => candidate.id === normalizedControlId,
			);
			if (!control) return;
			if (!isProductionControlValueInRange(control, value)) return;
			const previous = link.values?.find(
				(candidate) => candidate.controlId === normalizedControlId,
			);
			if (previous && Object.is(previous.value, value)) return;
			const values: readonly ProductionControlValue[] = [
				...(link.values ?? []).filter(
					(candidate) => candidate.controlId !== normalizedControlId,
				),
				{ controlId: normalizedControlId, value },
			];
			// Re-parse rather than hand-assemble: the parser owns canonical ordering
			// and range admission, so there is exactly one definition of a valid link.
			const nextLink = parseExternalProductionLink({ ...link, values });
			if (!nextLink) return;
			const next = normalizeExternalSceneAsset({
				...(cloneSceneDocument(existing) as ExternalSceneAsset),
				production: nextLink,
			});
			if (!next) return;
			upsertSceneAsset(draft, next);
		},
	};
}

/**
 * Swaps an existing image placement to a new validated Program Surface asset.
 * The former asset remains available for undo/history and can be removed later
 * only when no node, paint, preset, or Program Surface fallback references it.
 */
export function createReplaceProgramSurfaceAssetCommand(
	nodeId: string,
	input: ReplaceProgramSurfaceAssetInput,
	options: ReplaceProgramSurfaceAssetOptions = {},
): SceneCommand {
	const assetId = normalizedName(input.assetId);
	const name = normalizedName(input.name) ?? "Program Surface";
	const normalizedBounds =
		options.bounds === undefined
			? undefined
			: normalizeImageBounds(options.bounds);
	return {
		type: "scene/replace-program-surface-asset",
		label: options.label ?? "Replace Program Surface",
		coalesceKey: options.coalesceKey,
		run: (draft) => {
			if (!assetId) return;
			const node = findDraftNode(draft, nodeId);
			if (node?.geometry.kind !== "image") return;
			const created = createProgramSurfaceAssetNode({
				assetId,
				nodeId: node.id,
				name,
				bounds: normalizedBounds ?? node.geometry.bounds,
				source: input.source,
				manifest: input.manifest,
				artboardId: node.artboardId,
				mimeType: input.mimeType,
				issues: input.issues,
			});
			if (!created) return;
			upsertSceneAsset(draft, created.asset);
			if (node.geometry.assetId !== created.asset.id) {
				node.geometry.assetId = created.asset.id;
			}
			if (
				normalizedBounds &&
				!sameBounds(node.geometry.bounds, normalizedBounds)
			) {
				node.geometry.bounds = normalizedBounds;
			}
		},
	};
}

/**
 * Deletes only an unreferenced Program Surface declaration. Its named raster
 * fallback is protected by the same reference scan used for ordinary images.
 */
export function createRemoveUnusedProgramSurfaceAssetCommand(
	assetId: string,
	options: { readonly label?: string } = {},
): SceneCommand {
	const normalizedAssetId = normalizedName(assetId);
	return {
		type: "scene/remove-unused-program-surface-asset",
		label: options.label ?? "Delete Program Surface",
		run: (draft) => {
			if (
				!normalizedAssetId ||
				documentReferencesSceneAsset(draft, normalizedAssetId)
			) {
				return;
			}
			const assets = draft.assets;
			if (
				!assets?.some(
					(asset) =>
						asset.kind === "program-surface" && asset.id === normalizedAssetId,
				)
			) {
				return;
			}
			draft.assets = castDraft(
				assets.filter(
					(asset) =>
						asset.kind !== "program-surface" || asset.id !== normalizedAssetId,
				),
			);
		},
	};
}

/**
 * Replaces the document asset used by an existing image node and optionally
 * updates its editable bounds/crop metadata. Missing or non-image nodes are
 * no-ops so optimistic UI controls cannot corrupt unrelated geometry.
 */
export function createReplaceImageAssetCommand(
	nodeId: string,
	asset: ImageAsset,
	options: ReplaceImageAssetOptions = {},
): SceneCommand {
	const normalizedAsset = normalizeImageAsset(asset);
	const normalizedBounds =
		options.bounds === undefined
			? undefined
			: normalizeImageBounds(options.bounds);

	return {
		type: "scene/replace-image-asset",
		label: options.label ?? "Replace image",
		coalesceKey: options.coalesceKey,
		run: (draft) => {
			if (!normalizedAsset) return;
			const node = findDraftNode(draft, nodeId);
			if (node?.geometry.kind !== "image") return;
			upsertSceneAsset(draft, normalizedAsset);
			if (node.geometry.assetId !== normalizedAsset.id) {
				node.geometry.assetId = normalizedAsset.id;
			}
			if (
				normalizedBounds &&
				!sameBounds(node.geometry.bounds, normalizedBounds)
			) {
				node.geometry.bounds = normalizedBounds;
			}
			if (options.crop !== undefined) {
				writeImageCropMetadata(node, options.crop);
			}
		},
	};
}

/**
 * Updates editable image placement metadata without replacing the asset. Bounds
 * live on image geometry; crop stays in node data to avoid a scene schema break.
 */
export function createUpdateImagePlacementCommand(
	nodeId: string,
	patch: ImagePlacementPatch,
	options: UpdateImagePlacementOptions = {},
): SceneCommand {
	const normalizedBounds =
		patch.bounds === undefined ? undefined : normalizeImageBounds(patch.bounds);

	return {
		type: "scene/update-image-placement",
		label: options.label ?? "Edit image placement",
		coalesceKey: options.coalesceKey,
		run: (draft) => {
			const node = findDraftNode(draft, nodeId);
			if (node?.geometry.kind !== "image") return;
			if (
				normalizedBounds &&
				!sameBounds(node.geometry.bounds, normalizedBounds)
			) {
				node.geometry.bounds = normalizedBounds;
			}
			if (patch.crop !== undefined) {
				writeImageCropMetadata(node, patch.crop);
			}
		},
	};
}

/**
 * Adds a validated artboard definition to the additive artboard collection.
 * The legacy `document.artboard` stays first and authoritative, so inserted
 * artboards clamp to index 1 or later while optional selection updates
 * `currentArtboardId` in the same undoable command.
 */
export function createAddArtboardCommand(
	artboard: Artboard,
	options: AddArtboardOptions = {},
): SceneCommand {
	return {
		type: "scene/add-artboard",
		label: options.label ?? "Add artboard",
		run: (draft) => {
			const nextArtboard = normalizeNewArtboard(artboard);
			if (!nextArtboard) return;
			if (findArtboardValue(draft, nextArtboard.id)) return;

			const artboards = materializeDraftArtboards(draft);
			const toIndex = clampArtboardInsertIndex(
				artboards.length,
				options.toIndex,
			);
			artboards.splice(toIndex, 0, castDraft(cloneSceneDocument(nextArtboard)));
			if (options.select ?? true) draft.currentArtboardId = nextArtboard.id;
		},
	};
}

/**
 * Updates one artboard through the scene command bus. Edits to the default
 * artboard synchronize `document.artboard` and its collection entry so legacy
 * readers and multi-artboard readers observe the same committed values.
 */
export function createUpdateArtboardCommand(
	artboardId: string,
	patch: ArtboardPatch,
	options: UpdateArtboardOptions = {},
): SceneCommand {
	return {
		type: "scene/update-artboard",
		label: options.label ?? "Edit artboard",
		coalesceKey: options.coalesceKey,
		run: (draft) => {
			const current = findArtboardValue(draft, artboardId);
			if (!current) return;
			const next = patchArtboardValue(current, patch);
			if (sameArtboard(current, next)) return;

			const artboards = materializeDraftArtboards(draft);
			const targetIndex = artboards.findIndex(
				(artboard) => artboard.id === artboardId,
			);
			if (targetIndex < 0) return;
			artboards[targetIndex] = castDraft(cloneSceneDocument(next));
			if (draft.artboard.id === artboardId) {
				draft.artboard = castDraft(cloneSceneDocument(next));
			}
			if (normalizeArtboardRole(next) !== "scene") {
				removeArtboardFromSequence(draft, artboardId);
			}
		},
	};
}

/**
 * Sets editor focus to an existing artboard. Missing or stale ids are no-ops so
 * Layers, Inspector, and import UI bridges can optimistically request focus
 * without creating invalid `currentArtboardId` history entries.
 */
export function createSetCurrentArtboardCommand(
	artboardId: string,
	options: { readonly label?: string } = {},
): SceneCommand {
	return {
		type: "scene/set-current-artboard",
		label: options.label ?? "Set current artboard",
		run: (draft) => {
			const nextArtboardId = normalizedName(artboardId);
			if (!nextArtboardId || !findArtboardValue(draft, nextArtboardId)) return;
			if (draft.currentArtboardId === nextArtboardId) return;
			draft.currentArtboardId = nextArtboardId;
		},
	};
}

/**
 * Duplicates an artboard definition and, by default, its owned top-level content
 * roots with deep node id remapping. The shell and content insertions land in one
 * command-bus entry so undo/redo treats the artboard copy as one user action.
 */
export function createDuplicateArtboardCommand(
	sourceArtboardId: string,
	options: DuplicateArtboardOptions = {},
): SceneCommand {
	return {
		type: "scene/duplicate-artboard",
		label: options.label ?? "Duplicate artboard",
		run: (draft) => {
			const plan = planDuplicateArtboard(draft, sourceArtboardId, options);
			if (!plan) return;

			const artboards = materializeDraftArtboards(draft);
			artboards.splice(
				plan.toIndex,
				0,
				castDraft(cloneSceneDocument(plan.duplicate)),
			);
			materializeSourceOwnedNodeArtboards(draft, sourceArtboardId);
			insertDuplicateArtboardContents(draft, plan.contents);
			if (options.select ?? true) draft.currentArtboardId = plan.duplicate.id;
		},
	};
}

/**
 * Removes an artboard while preserving a valid default/current fallback. The
 * final artboard is protected, and nodes explicitly assigned to the removed
 * artboard are reassigned to the chosen fallback instead of keeping stale ids.
 */
export function createRemoveArtboardCommand(
	artboardId: string,
	options: RemoveArtboardOptions = {},
): SceneCommand {
	return {
		type: "scene/remove-artboard",
		label: options.label ?? "Remove artboard",
		run: (draft) => {
			const artboards = readArtboardValues(draft);
			const removeIndex = artboards.findIndex(
				(artboard) => artboard.id === artboardId,
			);
			if (removeIndex < 0 || artboards.length <= 1) return;

			const remaining = artboards.filter(
				(artboard) => artboard.id !== artboardId,
			);
			const requestedFallback = remaining.find(
				(artboard) => artboard.id === options.fallbackArtboardId,
			);
			const neighborFallback =
				remaining[Math.min(removeIndex, remaining.length - 1)] ?? remaining[0];
			const fallback = requestedFallback ?? neighborFallback;
			if (!fallback) return;

			const removesDefault = draft.artboard.id === artboardId;
			const nextDefault = removesDefault
				? fallback
				: materializeArtboard(
						draft.artboard,
						artboards.find((artboard) => artboard.id === draft.artboard.id)
							?.position,
					);
			const ordered = [
				nextDefault,
				...remaining.filter((artboard) => artboard.id !== nextDefault.id),
			];
			const remainingIds = new Set(ordered.map((artboard) => artboard.id));
			const currentArtboardId = draft.currentArtboardId;
			const nextCurrentArtboardId =
				currentArtboardId && remainingIds.has(currentArtboardId)
					? currentArtboardId
					: currentArtboardId === artboardId
						? fallback.id
						: nextDefault.id;

			draft.artboard = castDraft(cloneSceneDocument(nextDefault));
			draft.artboards = castDraft(cloneSceneDocument(ordered));
			draft.currentArtboardId = nextCurrentArtboardId;
			removeArtboardFromSequence(draft, artboardId);
			for (const layer of draft.layers) {
				reassignNodeArtboard(layer.nodes, artboardId, fallback.id);
			}
		},
	};
}

/**
 * Reorders non-default artboards inside the additive collection. The default
 * artboard remains first to match the Stage A selector contract; out-of-range
 * indexes clamp to the nearest valid non-default slot.
 */
export function createReorderArtboardCommand(
	artboardId: string,
	toIndex: number,
): SceneCommand {
	return {
		type: "scene/reorder-artboard",
		label: "Reorder artboard",
		run: (draft) => {
			if (draft.artboard.id === artboardId) return;
			const artboardsBefore = readArtboardValues(draft);
			const clampedToIndex = clampArtboardReorderIndex(
				artboardsBefore.length,
				toIndex,
			);
			if (clampedToIndex === null) return;
			const fromIndex = artboardsBefore.findIndex(
				(artboard) => artboard.id === artboardId,
			);
			if (fromIndex < 0 || fromIndex === clampedToIndex) return;

			const artboards = materializeDraftArtboards(draft);
			const [artboard] = artboards.splice(fromIndex, 1);
			if (!artboard) return;
			artboards.splice(clampedToIndex, 0, artboard);
		},
	};
}

/**
 * Adds one empty top-level layer. The entity owner mints the id when callers do
 * not provide one so GUI and headless adapters share the same durable shape.
 */
export function createAddLayerCommand(
	options: {
		readonly id?: string;
		readonly name?: string;
		readonly toIndex?: number;
	} = {},
): SceneCommand {
	return {
		type: "scene/add-layer",
		label: "Add layer",
		run: (draft) => {
			const id = options.id ?? createId("layer");
			if (draft.layers.some((layer) => layer.id === id)) return;
			const name = normalizedName(options.name ?? "") ?? "Layer";
			const layer: SceneLayer = {
				id,
				name,
				visible: true,
				locked: false,
				nodes: [],
			};
			const toIndex =
				options.toIndex === undefined
					? draft.layers.length
					: Math.min(
							draft.layers.length,
							Math.max(0, Math.round(options.toIndex)),
						);
			draft.layers.splice(toIndex, 0, castDraft(layer));
		},
	};
}

/** Applies the editable layer metadata as one undoable structural edit. */
export function createUpdateLayerCommand(
	layerId: string,
	patch: {
		readonly name?: string;
		readonly visible?: boolean;
		readonly locked?: boolean;
	},
): SceneCommand {
	return {
		type: "scene/update-layer",
		label: "Edit layer",
		run: (draft) => {
			const layer = findDraftLayer(draft, layerId);
			if (!layer) return;
			if (patch.name !== undefined) {
				const name = normalizedName(patch.name);
				if (name) layer.name = name;
			}
			if (patch.visible !== undefined) layer.visible = patch.visible;
			if (patch.locked !== undefined) layer.locked = patch.locked;
		},
	};
}

/**
 * Removes one layer while preserving its node ids and dependent references by
 * moving its top-level nodes into an explicit or adjacent fallback layer. The
 * final layer is never removed.
 */
export function createRemoveLayerCommand(
	layerId: string,
	fallbackLayerId?: string,
): SceneCommand {
	return {
		type: "scene/remove-layer",
		label: "Remove layer",
		run: (draft) => {
			if (draft.layers.length <= 1) return;
			const sourceIndex = draft.layers.findIndex(
				(layer) => layer.id === layerId,
			);
			if (sourceIndex < 0) return;
			const source = draft.layers[sourceIndex];
			if (!source) return;
			const fallback = fallbackLayerId
				? draft.layers.find(
						(layer) => layer.id === fallbackLayerId && layer.id !== layerId,
					)
				: draft.layers.find((layer) => layer.id !== layerId);
			if (!fallback) return;
			fallback.nodes.push(...source.nodes);
			draft.layers.splice(sourceIndex, 1);
		},
	};
}

/**
 * Reorders a top-level layer to its final array index. Missing layer ids and
 * out-of-range target indexes are safe no-ops so stale panel state cannot corrupt
 * document structure.
 */
export function createReorderLayerCommand(
	layerId: string,
	toIndex: number,
): SceneCommand {
	return {
		type: "scene/reorder-layer",
		label: "Reorder layer",
		run: (draft) => {
			if (!isValidTargetIndex(draft.layers.length, toIndex)) return;
			const fromIndex = draft.layers.findIndex((layer) => layer.id === layerId);
			if (fromIndex < 0 || fromIndex === toIndex) return;
			const [layer] = draft.layers.splice(fromIndex, 1);
			if (!layer) return;
			draft.layers.splice(toIndex, 0, layer);
		},
	};
}

/**
 * Reorders a top-level node within a single layer. Parent/child node reorder is
 * intentionally outside this command; group-aware reparenting needs its own
 * parent-id contract once nested layer UX is designed.
 */
export function createReorderNodeWithinLayerCommand(
	layerId: string,
	nodeId: string,
	toIndex: number,
): SceneCommand {
	return {
		type: "scene/reorder-node-within-layer",
		label: "Reorder node",
		run: (draft) => {
			const layer = findDraftLayer(draft, layerId);
			if (!layer || !isValidTargetIndex(layer.nodes.length, toIndex)) return;
			const fromIndex = layer.nodes.findIndex((node) => node.id === nodeId);
			if (fromIndex < 0 || fromIndex === toIndex) return;
			const [node] = layer.nodes.splice(fromIndex, 1);
			if (!node) return;
			layer.nodes.splice(toIndex, 0, node);
		},
	};
}

/**
 * Recursively collects a draft subtree's node ids (including the node itself),
 * mirroring {@link collectSceneNodeIds} for the cycle and de-descendant guards.
 */
const collectDraftSubtreeIds = (
	node: Draft<VectorNode>,
	output: Set<string>,
): void => {
	output.add(node.id);
	if (node.children) {
		for (const child of node.children) collectDraftSubtreeIds(child, output);
	}
};

type DraftNodeLocation = {
	readonly array: Draft<VectorNode[]>;
	readonly index: number;
	readonly layer: Draft<SceneLayer>;
	readonly parentNode: Draft<VectorNode> | null;
};

/**
 * Finds a draft node and the container that holds it: the mutable sibling array,
 * the node's index within it, the owning layer, and the immediate parent (null
 * for a top-level node). This is the missing primitive reparenting needs — node
 * removal and the source-context guards share one traversal.
 */
const locateDraftNode = (
	draft: Draft<SceneDocument>,
	nodeId: string,
): DraftNodeLocation | null => {
	const visit = (
		array: Draft<VectorNode[]>,
		layer: Draft<SceneLayer>,
		parentNode: Draft<VectorNode> | null,
	): DraftNodeLocation | null => {
		for (let index = 0; index < array.length; index += 1) {
			const node = array[index];
			if (!node) continue;
			if (node.id === nodeId) return { array, index, layer, parentNode };
			if (node.children) {
				const nested = visit(castDraft(node.children), layer, node);
				if (nested) return nested;
			}
		}
		return null;
	};
	for (const layer of draft.layers) {
		const found = visit(layer.nodes, layer, null);
		if (found) return found;
	}
	return null;
};

/** Assigns each node a document-order ordinal so multi-source removal is deterministic. */
const buildNodeDocumentOrder = (
	draft: Draft<SceneDocument>,
): Map<string, number> => {
	const order = new Map<string, number>();
	let ordinal = 0;
	const visit = (nodes: Draft<readonly VectorNode[]>): void => {
		for (const node of nodes) {
			order.set(node.id, ordinal);
			ordinal += 1;
			if (node.children) visit(node.children);
		}
	};
	for (const layer of draft.layers) visit(layer.nodes);
	return order;
};

/**
 * Moves one node to a new parent/layer/index. Delegates to the batch primitive
 * so single and multi drags share one guarded body and commit as one undo entry.
 */
export function createReparentNodeCommand(
	nodeId: string,
	target: ReparentTarget,
): SceneCommand {
	return createReparentNodesCommand([nodeId], target);
}

/**
 * Moves a set of nodes to a new parent (`targetParentNodeId === null` selects the
 * layer's top level), layer, and index — the group-aware reparent the
 * {@link createReorderNodeWithinLayerCommand} JSDoc deferred. Transforms and
 * keyframes are left untouched (no-rebake): the sampler reads node-local
 * transforms and the renderer composes parents, so a pure splice is lossless
 * across the whole timeline. Artboard assignment travels with each node and
 * resolves through the existing parent-inheritance selector, so no rebind is
 * needed. Every guard fails closed to a silent no-op, which the store's
 * empty-patch early-return turns into "no history entry" — stale panel state can
 * never corrupt the document.
 */
export function createReparentNodesCommand(
	nodeIds: readonly string[],
	target: ReparentTarget,
): SceneCommand {
	return {
		type: "scene/reparent-nodes",
		label: "Move layer",
		run: (draft) => {
			// 1. Resolve the destination array first; reject a locked destination.
			const destLayer = findDraftLayer(draft, target.targetLayerId);
			if (!destLayer || destLayer.locked) return;
			let destArray: Draft<VectorNode[]>;
			if (target.targetParentNodeId === null) {
				destArray = destLayer.nodes;
			} else {
				const destParent = findDraftNode(draft, target.targetParentNodeId);
				if (!destParent || destParent.locked) return;
				if (!destParent.children) {
					// Only a frame can gain a children array on demand; a pure leaf
					// cannot receive children.
					if (!isFrameNode(destParent)) return;
					destParent.children = [];
				}
				destArray = castDraft(destParent.children);
			}

			// 2. Resolve survivors: drop locked / stale / cycle / descendant-of-
			//    another-dragged ids. Subtrees include self, so the cycle guard also
			//    rejects a self-drop.
			const requested = new Set(nodeIds);
			const subtrees = new Map<string, ReadonlySet<string>>();
			for (const id of requested) {
				const loc = locateDraftNode(draft, id);
				if (!loc) continue;
				const node = loc.array[loc.index];
				if (!node) continue;
				const subtree = new Set<string>();
				collectDraftSubtreeIds(node, subtree);
				subtrees.set(id, subtree);
			}
			const ridesInsideAnother = (id: string): boolean => {
				for (const [other, subtree] of subtrees) {
					if (other !== id && subtree.has(id)) return true;
				}
				return false;
			};
			const survivors: string[] = [];
			for (const id of subtrees.keys()) {
				const loc = locateDraftNode(draft, id);
				if (!loc) continue;
				const node = loc.array[loc.index];
				if (!node || node.locked || loc.layer.locked) continue;
				if (ridesInsideAnother(id)) continue;
				if (
					target.targetParentNodeId !== null &&
					subtrees.get(id)?.has(target.targetParentNodeId)
				) {
					continue;
				}
				survivors.push(id);
			}
			if (survivors.length === 0) return;

			// 3. Capture each survivor's ORIGINAL index in the destination array
			//    (pre-removal) so the insert index can compensate for nodes pulled
			//    out below the gap — clamping alone would land them one slot low.
			const movedOriginalDestIndices: number[] = [];
			for (const id of survivors) {
				const loc = locateDraftNode(draft, id);
				if (!loc) continue;
				const sameParent =
					(loc.parentNode?.id ?? null) === target.targetParentNodeId;
				if (sameParent && loc.layer.id === target.targetLayerId) {
					movedOriginalDestIndices.push(loc.index);
				}
			}

			// 4. Remove survivors in document order, collecting detached subtrees.
			const documentOrder = buildNodeDocumentOrder(draft);
			const ordered = [...survivors].sort(
				(a, b) => (documentOrder.get(a) ?? 0) - (documentOrder.get(b) ?? 0),
			);
			const detached: Draft<VectorNode>[] = [];
			for (const id of ordered) {
				const loc = locateDraftNode(draft, id);
				if (!loc) continue;
				const [node] = loc.array.splice(loc.index, 1);
				if (node) detached.push(node);
			}
			if (detached.length === 0) return;

			// 5. Insert the block contiguously at the single-source-of-truth index.
			const insertIndex = resolveInsertIndex(
				target.toIndex,
				movedOriginalDestIndices,
				destArray.length,
			);
			destArray.splice(insertIndex, 0, ...detached);
		},
	};
}

/**
 * Updates node transform data through the scene command bus. Locked or hidden
 * nodes are deliberately ignored because direct manipulation must not mutate
 * state that canvas hit testing cannot pick.
 */
export function createUpdateNodeTransformCommand(
	nodeId: string,
	patch: NodeTransformPatch,
	options: {
		readonly label?: string;
		readonly coalesceKey?: string;
		readonly grammarTargetNodeIds?: ReadonlySet<string>;
		readonly motion?: MotionConflictView;
	} = {},
): SceneCommand {
	return {
		type: "scene/update-node-transform",
		label: options.label ?? "Update node transform",
		coalesceKey: options.coalesceKey,
		run: (draft) => {
			const layer = findDraftLayerByNodeId(draft, nodeId);
			const node = findDraftNode(draft, nodeId);
			if (
				!node ||
				!layer?.visible ||
				layer.locked ||
				!node.visible ||
				node.locked
			) {
				return;
			}
			const beforeTransform = current(node.transform) as Transform;
			const beforeOpacity = node.style.opacity;
			if (patch.matrix) {
				node.transform = transformFromMatrix(
					patch.matrix,
					node.transform.anchor,
				);
			}
			if (patch.transform) {
				node.transform = {
					...node.transform,
					...patch.transform,
				};
			}
			if (
				!synchronizeSharedNumberComponentPropsFromNode(
					draft,
					nodeId,
					{
						rotation: beforeTransform.rotation,
						opacity: beforeOpacity,
					},
					{
						grammarTargetNodeIds: options.grammarTargetNodeIds,
						motion: options.motion,
					},
				)
			) {
				node.transform = castDraft(beforeTransform);
			}
		},
	};
}

/**
 * Replaces one node's geometry without changing its identity, style, transform,
 * hierarchy, or relationship metadata. Kind changes are deliberately rejected;
 * conversions need a named planner because dependent motion/property contracts
 * may differ by geometry kind.
 */
export function createUpdateNodeGeometryCommand(
	nodeId: string,
	geometry: NodeGeometry,
): SceneCommand {
	return {
		type: "scene/update-node-geometry",
		label: "Edit geometry",
		run: (draft) => {
			const node = findDraftNode(draft, nodeId);
			if (!node || node.geometry.kind !== geometry.kind) return;
			if (
				geometry.kind === "image" &&
				!(draft.assets ?? []).some((asset) => asset.id === geometry.assetId)
			)
				return;
			node.geometry = castDraft(cloneSceneDocument(geometry));
		},
	};
}

/**
 * Moves the node's rotate/scale pivot (`transform.anchor`) to its geometry
 * centre. The default anchor is the local origin `{0,0}`, so a bound or
 * keyframed `transform.rotation` orbits that origin instead of spinning the node
 * in place; centring the anchor makes rotation pivot about the node's own
 * centre. At rotation 0 the anchor cancels in the render matrix, so this never
 * shifts the node — it only changes the pivot. The centre is read from the live
 * geometry, so callers (incl. agents) need no bounds knowledge.
 */
export function createCenterNodeAnchorCommand(
	nodeId: string,
	options: {
		readonly label?: string;
		readonly coalesceKey?: string;
	} = {},
): SceneCommand {
	return {
		type: "scene/center-node-anchor",
		label: options.label ?? "Center node pivot",
		coalesceKey: options.coalesceKey,
		run: (draft) => {
			const layer = findDraftLayerByNodeId(draft, nodeId);
			const node = findDraftNode(draft, nodeId);
			if (
				!node ||
				!layer?.visible ||
				layer.locked ||
				!node.visible ||
				node.locked
			) {
				return;
			}
			const bounds = getNodeLocalBounds(node);
			node.transform = {
				...node.transform,
				anchor: {
					x: bounds.x + bounds.width / 2,
					y: bounds.y + bounds.height / 2,
				},
			};
		},
	};
}

/**
 * Updates paint-related node style fields through the scene command bus.
 * Callers pass only committed, user-approved values; draft input state should
 * stay in the widget until validation succeeds. Set `preservesPaintIndices`
 * only for a typed edit that replaces values in place; arbitrary full-array
 * writers remain conservative so index-addressed shared colors cannot be
 * silently retargeted by an undetectable reorder.
 */
export function createUpdateNodeStyleCommand(
	nodeId: string,
	patch: NodeStylePatch,
	options: {
		readonly preservesPaintIndices?: boolean;
		readonly grammarTargetNodeIds?: ReadonlySet<string>;
		readonly motion?: MotionConflictView;
	} = {},
): SceneCommand {
	return {
		type: "scene/update-node-style",
		label: "Update node style",
		run: (draft) => {
			const node = findDraftNode(draft, nodeId);
			if (!node) return;
			const beforeStyle = current(node.style) as NodeStyle;
			const beforeRotation = node.transform.rotation;
			const changesPaint =
				patch.fill !== undefined ||
				patch.stroke !== undefined ||
				patch.fills !== undefined ||
				patch.strokes !== undefined;
			if (patch.opacity !== undefined && changesPaint) {
				const props = readComponentProps(draft);
				const hasSharedOpacity = props.some(
					(prop) =>
						prop.type === "number" &&
						prop.bindings.some(
							(binding) =>
								binding.kind === "bindable" &&
								binding.nodeId === nodeId &&
								binding.propertyId === "style.opacity",
						),
				);
				const hasSharedColor = props.some(
					(prop) =>
						prop.type === "color" &&
						prop.bindings.some(
							(binding) =>
								binding.kind === "style-color" && binding.nodeId === nodeId,
						),
				);
				if (hasSharedOpacity && hasSharedColor) return;
			}
			if (patch.fill !== undefined) node.style.fill = patch.fill;
			if (patch.stroke !== undefined) node.style.stroke = patch.stroke;
			if (patch.strokeWidth !== undefined) {
				node.style.strokeWidth = clampNonNegative(patch.strokeWidth);
			}
			if (patch.opacity !== undefined) {
				node.style.opacity = clampOpacity(patch.opacity);
			}
			if (patch.fills !== undefined) node.style.fills = castDraft(patch.fills);
			if (patch.strokes !== undefined) {
				node.style.strokes = castDraft(patch.strokes);
			}
			if (patch.effects !== undefined) {
				node.style.effects = castDraft(patch.effects);
			}
			if (patch.blendMode !== undefined) node.style.blendMode = patch.blendMode;
			if (patch.strokeAlign !== undefined) {
				node.style.strokeAlign = patch.strokeAlign;
			}
			if (patch.strokeDash !== undefined) {
				node.style.strokeDash = castDraft(
					normalizeStrokeDash(patch.strokeDash),
				);
			}
			if (patch.strokeDashoffset !== undefined) {
				node.style.strokeDashoffset = patch.strokeDashoffset;
			}
			if (patch.strokeCap !== undefined) node.style.strokeCap = patch.strokeCap;
			if (patch.strokeJoin !== undefined) {
				node.style.strokeJoin = patch.strokeJoin;
			}
			if (patch.strokeMiterLimit !== undefined) {
				node.style.strokeMiterLimit = clampPositiveWithFallback(
					patch.strokeMiterLimit,
					4,
				);
			}
			if (patch.strokeSoftness !== undefined) {
				// Only `blurRadius` is authored in this tier; a normalized `0`/missing
				// radius clears the bucket so `0` stroke blur stays byte-identical to a
				// node that never carried softness (and keeps documents clean).
				const blurRadius = clampNonNegative(
					patch.strokeSoftness?.blurRadius ?? 0,
				);
				node.style.strokeSoftness = blurRadius > 0 ? { blurRadius } : undefined;
			}
			if (patch.strokeWidthProfile !== undefined) {
				// `null` clears the profile (mirrors the `crop: Bounds | null` clear
				// convention elsewhere in this file); a non-null array only commits
				// when it satisfies the shared contract, so a caller that skipped its
				// own pre-validation cannot corrupt the document — it just silently
				// keeps the previous profile instead.
				if (patch.strokeWidthProfile === null) {
					node.style.strokeWidthProfile = undefined;
				} else if (
					validateStrokeWidthProfile(patch.strokeWidthProfile) === null
				) {
					node.style.strokeWidthProfile = castDraft(patch.strokeWidthProfile);
				}
			}
			if (
				!synchronizeSharedNumberComponentPropsFromNode(
					draft,
					nodeId,
					{
						rotation: beforeRotation,
						opacity: beforeStyle.opacity,
					},
					{
						grammarTargetNodeIds: options.grammarTargetNodeIds,
						motion: options.motion,
					},
				)
			) {
				node.style = castDraft(beforeStyle);
				return;
			}
			if (
				changesPaint &&
				!synchronizeSharedColorComponentPropsFromNodeStyle(
					draft,
					nodeId,
					beforeStyle,
					{
						allowUnboundPaintChanges: options.preservesPaintIndices === true,
					},
				)
			) {
				node.style = castDraft(beforeStyle);
			}
		},
	};
}

/**
 * Renames a node while refusing empty names. The command is intentionally a
 * no-op for missing nodes so optimistic panel edits can race safely with future
 * document operations.
 */
export function createRenameNodeCommand(
	nodeId: string,
	name: string,
): SceneCommand {
	return {
		type: "scene/rename-node",
		label: "Rename node",
		run: (draft) => {
			const nextName = normalizedName(name);
			if (!nextName) return;
			const node = findDraftNode(draft, nodeId);
			if (!node) return;
			node.name = nextName;
		},
	};
}

/**
 * Renames the document itself. `document.name` drives export filenames, PDF
 * `/Title` metadata, and the AI agent's document context, so it rides the same
 * undoable command bus as every other edit. Empty/whitespace names and no-op
 * renames mutate nothing, so Immer emits no patches and no history entry.
 */
export function createRenameDocumentCommand(name: string): SceneCommand {
	return {
		type: "scene/rename-document",
		label: "Rename document",
		run: (draft) => {
			const nextName = normalizedName(name);
			if (!nextName) return;
			if (draft.name === nextName) return;
			draft.name = nextName;
		},
	};
}

/**
 * Sets node visibility. Hidden nodes stay in the document graph but are omitted
 * by canvas rendering and hit testing.
 */
export function createSetNodeVisibilityCommand(
	nodeId: string,
	visible: boolean,
): SceneCommand {
	return {
		type: "scene/set-node-visibility",
		label: visible ? "Show node" : "Hide node",
		run: (draft) => {
			const node = findDraftNode(draft, nodeId);
			if (!node) return;
			node.visible = visible;
		},
	};
}

/**
 * Options for {@link createConvertNodeNoiseGradientToScopedLookGraphCommand}.
 * `revealPaint` is payload (the second color/gradient the dissolve reveals),
 * not authoring metadata, but sits alongside `label`/`coalesceKey` here rather
 * than a fourth positional parameter — the same shape
 * `UseNodeAsMaskOptions`/`options.kind` already uses for a single optional
 * payload field on a command factory.
 */
export type ConvertNoiseGradientToScopedLookGraphOptions =
	UpdateEffectIntentOptions & {
		readonly revealPaint?: RevealPaint;
		/**
		 * Opts into re-author refresh semantics instead of the default
		 * preserve-or-create behavior. Only `scene/author-object-noise-gradient`
		 * (the AI-iteration entry point, via `write.ts`) sets this — the
		 * Inspector's "Open Graph" action (`tool-controls.ts`,
		 * `noise-gradient-editing.ts`) never does, so its preserve-an-existing-
		 * graph contract (never strip a user's Look-workspace customizations or an
		 * authored `revealPaint` just because Open Graph was clicked again) stays
		 * exactly as it was. When true AND an object-Noise-Gradient scoped look
		 * already owns this node: if its particle grain node is still present,
		 * the existing graph structure (and any other node the user has since
		 * added/rewired in the Look workspace) is preserved, but the grain node's
		 * `texture` is recomputed from the node's CURRENT recipe (this run's fresh
		 * `setRecipe` write already landed by the time `write.ts` sequences this
		 * command) and its `revealPaint` is set to `options.revealPaint` verbatim
		 * — including clearing it when omitted, reset-style like every other
		 * revealPaint write in this feature. If the grain node was deleted by the
		 * user, there is nothing to refresh in place, so this falls back to the
		 * fresh declarative `scopedLook`. With no existing look, this behaves like
		 * a normal fresh build.
		 */
		readonly refreshFromRecipe?: boolean;
	};

/**
 * Converts one node-local Noise Gradient particle material into a scoped Look
 * Graph overlay owned by the node's artboard. The graph receives the node's
 * current particle texture as its `SourceGraphic` transform, and the node recipe
 * has the consumed particle material disabled so the dissolve does not render
 * twice. If another scoped graph overlay already owns the same target, the
 * command leaves the node untouched because render and authoring would disagree
 * about which overlay wins.
 *
 * Without `options.refreshFromRecipe`, an existing object-Noise-Gradient
 * overlay for this node wins outright (`existing ?? scopedLook`) — this is the
 * Inspector "Open Graph" contract: re-opening an already-converted node's graph
 * must never overwrite whatever the user has since built in the Look
 * workspace. See {@link ConvertNoiseGradientToScopedLookGraphOptions}'s doc for
 * the refresh branch's exact resolution order.
 */
export function createConvertNodeNoiseGradientToScopedLookGraphCommand(
	nodeId: string,
	options: ConvertNoiseGradientToScopedLookGraphOptions = {},
): SceneCommand {
	return {
		type: "scene/convert-node-noise-gradient-to-scoped-look-graph",
		label: options.label ?? "Convert Noise Gradient to scoped effect",
		coalesceKey: options.coalesceKey,
		run: (draft) => {
			const node = findDraftNode(draft, nodeId);
			if (!node) return;
			const artboardId = selectNodeArtboardMapping(draft).byNodeId[node.id];
			if (!artboardId) return;
			const scopedLook = objectNoiseGradientScopedLook(
				artboardId,
				node,
				options.revealPaint,
			);
			if (!scopedLook) return;
			const artboardDraftForExisting = findDraftArtboardEffectIntentTargets(
				draft,
				{ scope: "artboard", artboardId },
			)[0];
			const existingLook = objectNoiseGradientScopedLookForNode(
				artboardDraftForExisting?.effectIntent?.scopedLooks,
				node.id,
			);
			// Three DECIDED-2 cases, in order: (1) refresh requested + existing look
			// + its grain node still present -> in-place refresh (preserves any
			// other user-added graph node); (2) refresh requested + existing look
			// but grain node deleted -> declarative fallback to the fresh
			// `scopedLook`, NOT the stale unrefreshed `existingLook`; (3) refresh not
			// requested (or no existing look at all) -> today's preserve-or-create
			// (`existingLook ?? scopedLook`).
			const resolvedLook = (() => {
				if (!options.refreshFromRecipe || !existingLook) {
					return existingLook ?? scopedLook;
				}
				const refreshedGraph = graphWithObjectNoiseGradientTexture(
					existingLook,
					objectNoiseGradientTextureFromRecipe(
						normalizeVisualRecipe(node.recipe),
					),
					{ revealPaint: options.revealPaint ?? null },
				);
				return refreshedGraph
					? { ...existingLook, lookGraph: refreshedGraph }
					: scopedLook;
			})();
			let converted = false;
			for (const artboard of findDraftArtboardEffectIntentTargets(draft, {
				scope: "artboard",
				artboardId,
			})) {
				const currentScopedLooks = artboard.effectIntent?.scopedLooks;
				const existingOverlay = scopedLookGraphOverlayForNode(
					currentScopedLooks,
					node.id,
				);
				if (
					existingOverlay &&
					!isObjectNoiseGradientScopedLook(existingOverlay)
				) {
					continue;
				}
				writeEffectIntentPatch(artboard, {
					scopedLooks: replaceObjectNoiseGradientScopedLook(
						currentScopedLooks,
						node.id,
						resolvedLook,
					),
				});
				converted = true;
			}
			if (!converted) return;
			const currentRecipe = normalizeVisualRecipe(node.recipe);
			const nextRecipe = visualRecipeWithoutParticleMaterial(currentRecipe);
			if (nextRecipe) node.recipe = castDraft(nextRecipe);
		},
	};
}

/**
 * Adds a Path Blur scoped Look Graph overlay targeting one object. Unlike the
 * frame-level Path Blur node (which blurs the whole artboard), this owns a
 * standalone graph scoped to a single node, rendered via an isolated GPU crop
 * compositor rather than the frame raster pipeline. Refuses if the node is
 * already owned by any scoped Look Graph overlay — one target node can only be
 * owned by one scoped-look-graph-overlay at a time, and this is a one-shot
 * "add" action rather than an update to an existing overlay (guide/param edits
 * go through the scoped overlay's own update command instead).
 */
export function createAddObjectPathBlurCommand(
	nodeId: string,
	options: UpdateEffectIntentOptions = {},
): SceneCommand {
	return {
		type: "scene/add-object-path-blur",
		label: options.label ?? "Add Path Blur to object",
		coalesceKey: options.coalesceKey,
		run: (draft) => {
			const node = findDraftNode(draft, nodeId);
			if (!node) return;
			// MVP scope: the isolated GPU crop compositor reads the node's own
			// `transform` as artboard-root space, which only holds for a top-level
			// node (not nested inside a group) — see `isTopLevelSceneNode`.
			if (!isTopLevelSceneNode(draft, node.id)) return;
			const artboardId = selectNodeArtboardMapping(draft).byNodeId[node.id];
			if (!artboardId) return;
			const scopedLook = objectPathBlurScopedLook(artboardId, node);
			if (!scopedLook) return;
			for (const artboard of findDraftArtboardEffectIntentTargets(draft, {
				scope: "artboard",
				artboardId,
			})) {
				const currentScopedLooks = artboard.effectIntent?.scopedLooks;
				if (scopedLookGraphOverlayForNode(currentScopedLooks, node.id))
					continue;
				writeEffectIntentPatch(artboard, {
					scopedLooks: [...(currentScopedLooks ?? []), scopedLook],
				});
			}
		},
	};
}

/**
 * Sets (or clears) a node's inline vec-core visual recipe ("look"). A `null`
 * recipe removes the field so an all-neutral look does not persist as data. The
 * recipe is a plain POJO the SVG renderers read via `resolveNodeRecipe`; this
 * keeps look authoring on the same undoable command bus as every other node edit.
 */
export function createUpdateNodeRecipeCommand(
	nodeId: string,
	recipe: VisualRecipe | null,
): SceneCommand {
	return {
		type: "scene/update-node-recipe",
		label: "Edit look",
		run: (draft) => {
			const node = findDraftNode(draft, nodeId);
			if (!node) return;
			if (recipe === null) {
				node.recipe = undefined;
				return;
			}
			node.recipe = castDraft(recipe);
		},
	};
}

/**
 * Sets or clears scene/artboard vec-core effect intent through the command bus.
 * This is the frame-level side-car seam for O5/O6/O7: use `scene` for a
 * document fallback, `current-artboard`/`default-artboard` for editor-focused
 * frame edits, or an explicit artboard id for deterministic export/motion work.
 */
export function createUpdateEffectIntentCommand(
	target: EffectIntentTarget,
	patch: EffectIntentPatch,
	options: UpdateEffectIntentOptions = {},
): SceneCommand {
	return {
		type: "scene/update-effect-intent",
		label: options.label ?? "Edit frame look",
		coalesceKey: options.coalesceKey,
		run: (draft) => {
			if (target.scope === "scene") {
				writeEffectIntentPatch(draft, patch);
				return;
			}
			for (const artboard of findDraftArtboardEffectIntentTargets(
				draft,
				target,
			)) {
				writeEffectIntentPatch(artboard, patch);
			}
		},
	};
}

/**
 * Sets node lock state. Locked nodes can remain selected from structure panels,
 * but canvas handlers must treat them as non-transformable.
 */
export function createSetNodeLockedCommand(
	nodeId: string,
	locked: boolean,
): SceneCommand {
	return {
		type: "scene/set-node-locked",
		label: locked ? "Lock node" : "Unlock node",
		run: (draft) => {
			const node = findDraftNode(draft, nodeId);
			if (!node) return;
			node.locked = locked;
		},
	};
}

/**
 * Renames a layer by id while refusing empty names. Layer commands live beside
 * node commands because both are document-structure edits that must remain
 * undoable through the same scene store.
 */
export function createRenameLayerCommand(
	layerId: string,
	name: string,
): SceneCommand {
	return {
		type: "scene/rename-layer",
		label: "Rename layer",
		run: (draft) => {
			const nextName = normalizedName(name);
			if (!nextName) return;
			const layer = findDraftLayer(draft, layerId);
			if (!layer) return;
			layer.name = nextName;
		},
	};
}

/**
 * Sets layer visibility. Canvas rendering and hit testing treat hidden layers as
 * a structural visibility boundary for all child nodes.
 */
export function createSetLayerVisibilityCommand(
	layerId: string,
	visible: boolean,
): SceneCommand {
	return {
		type: "scene/set-layer-visibility",
		label: visible ? "Show layer" : "Hide layer",
		run: (draft) => {
			const layer = findDraftLayer(draft, layerId);
			if (!layer) return;
			layer.visible = visible;
		},
	};
}

/**
 * Sets layer lock state. Canvas handlers should exclude nodes in locked layers
 * from direct manipulation while panels may still select them structurally.
 */
export function createSetLayerLockedCommand(
	layerId: string,
	locked: boolean,
): SceneCommand {
	return {
		type: "scene/set-layer-locked",
		label: locked ? "Lock layer" : "Unlock layer",
		run: (draft) => {
			const layer = findDraftLayer(draft, layerId);
			if (!layer) return;
			layer.locked = locked;
		},
	};
}

/**
 * Renames the layer that owns a node. This keeps layer-panel workflows from
 * depending on layer array positions while group children are still evolving.
 */
export function createRenameOwningLayerCommand(
	nodeId: string,
	name: string,
): SceneCommand {
	return {
		type: "scene/rename-owning-layer",
		label: "Rename layer",
		run: (draft) => {
			const nextName = normalizedName(name);
			if (!nextName) return;
			const layer = findDraftLayerByNodeId(draft, nodeId);
			if (!layer) return;
			layer.name = nextName;
		},
	};
}

/**
 * Sets visibility on the layer that owns a node. Layer visibility is structural:
 * when false, all child nodes are non-renderable regardless of their own flag.
 */
export function createSetOwningLayerVisibilityCommand(
	nodeId: string,
	visible: boolean,
): SceneCommand {
	return {
		type: "scene/set-owning-layer-visibility",
		label: visible ? "Show layer" : "Hide layer",
		run: (draft) => {
			const layer = findDraftLayerByNodeId(draft, nodeId);
			if (!layer) return;
			layer.visible = visible;
		},
	};
}

/**
 * Sets lock state on the layer that owns a node. Feature handlers should treat
 * nodes in locked layers the same as locked nodes for direct canvas edits.
 */
export function createSetOwningLayerLockedCommand(
	nodeId: string,
	locked: boolean,
): SceneCommand {
	return {
		type: "scene/set-owning-layer-locked",
		label: locked ? "Lock layer" : "Unlock layer",
		run: (draft) => {
			const layer = findDraftLayerByNodeId(draft, nodeId);
			if (!layer) return;
			layer.locked = locked;
		},
	};
}

/**
 * Updates rounded-rectangle radius without changing the geometry kind. Non-rect
 * nodes are ignored so Inspector controls can be wired defensively.
 */
export function createUpdateRectCornerRadiusCommand(
	nodeId: string,
	cornerRadius: number,
): SceneCommand {
	return {
		type: "scene/update-rect-corner-radius",
		label: "Update corner radius",
		run: (draft) => {
			const node = findDraftNode(draft, nodeId);
			if (node?.geometry.kind !== "rect") return;
			node.geometry.cornerRadius = clampNonNegative(cornerRadius);
			// Setting a uniform radius collapses any per-corner override.
			node.geometry.cornerRadii = undefined;
		},
	};
}

/**
 * Updates a rect's per-corner radii from a partial patch (merged over the
 * resolved current radii). When all four corners end up equal the geometry
 * collapses back to the uniform `cornerRadius` form, keeping the canonical
 * single-value representation for downstream consumers. Non-rect nodes ignored.
 */
export function createUpdateRectCornerRadiiCommand(
	nodeId: string,
	patch: Partial<CornerRadii>,
	options: { readonly label?: string } = {},
): SceneCommand {
	return {
		type: "scene/update-rect-corner-radii",
		label: options.label ?? "Update corner radius",
		run: (draft) => {
			const node = findDraftNode(draft, nodeId);
			if (node?.geometry.kind !== "rect") return;
			const current = resolveCornerRadii(node.geometry);
			const next: CornerRadii = {
				tl: clampNonNegative(patch.tl ?? current.tl),
				tr: clampNonNegative(patch.tr ?? current.tr),
				br: clampNonNegative(patch.br ?? current.br),
				bl: clampNonNegative(patch.bl ?? current.bl),
			};
			if (next.tl === next.tr && next.tr === next.br && next.br === next.bl) {
				node.geometry.cornerRadius = next.tl;
				node.geometry.cornerRadii = undefined;
			} else {
				node.geometry.cornerRadii = next;
			}
		},
	};
}

/**
 * Updates whole-shape corner smoothing (squircle, `0..1`) on a roundable
 * primitive (rect/star/polygon). Other kinds are ignored so controls can be
 * wired defensively.
 */
export function createUpdateCornerSmoothingCommand(
	nodeId: string,
	smoothing: number,
): SceneCommand {
	return {
		type: "scene/update-corner-smoothing",
		label: "Update corner smoothing",
		run: (draft) => {
			const node = findDraftNode(draft, nodeId);
			if (!node) return;
			const kind = node.geometry.kind;
			if (kind !== "rect" && kind !== "star" && kind !== "polygon") return;
			node.geometry.cornerSmoothing = clampUnit(smoothing);
		},
	};
}

/**
 * Updates the uniform corner rounding of a star or polygon. Non star/polygon
 * nodes are ignored.
 */
export function createUpdatePolygonStarCornerRadiusCommand(
	nodeId: string,
	cornerRadius: number,
): SceneCommand {
	return {
		type: "scene/update-polygon-star-corner-radius",
		label: "Update corner radius",
		run: (draft) => {
			const node = findDraftNode(draft, nodeId);
			if (!node) return;
			const kind = node.geometry.kind;
			if (kind !== "star" && kind !== "polygon") return;
			node.geometry.cornerRadius = clampNonNegative(cornerRadius);
		},
	};
}

/**
 * Updates the authored text box independently from text content edits. Area
 * text keeps the requested fixed box so users can intentionally create overflow;
 * point text resolves back to its natural content bounds and omits `mode` for
 * legacy document compatibility.
 */
export function createResizeTextBoxCommand(
	nodeId: string,
	patch: TextBoxResizePatch,
	options: { readonly label?: string } = {},
): SceneCommand {
	return {
		type: "scene/resize-text-box",
		label: options.label ?? "Resize text box",
		run: (draft) => {
			const layer = findDraftLayerByNodeId(draft, nodeId);
			const node = findDraftNode(draft, nodeId);
			if (
				node?.geometry.kind !== "text" ||
				!layer?.visible ||
				layer.locked ||
				!node.visible ||
				node.locked
			) {
				return;
			}
			const currentMode = normalizeTextResizeMode(node.geometry.mode);
			const nextMode =
				patch.mode === undefined
					? currentMode
					: normalizeTextResizeMode(patch.mode);
			const style = normalizeTextStyle(node.geometry.style);
			const sourceBounds = patch.bounds ?? node.geometry.bounds;
			const nextBounds =
				nextMode === "point"
					? textBoundsForContent(
							{ x: sourceBounds.x, y: sourceBounds.y },
							normalizeTextContent(node.geometry.text),
							style,
						)
					: clampTextBoxBounds(sourceBounds, style);
			const modeChanged = currentMode !== nextMode;
			const boundsChanged = !sameBounds(node.geometry.bounds, nextBounds);
			if (!modeChanged && !boundsChanged) return;
			if (modeChanged) {
				if (nextMode === "point") {
					delete node.geometry.mode;
				} else {
					node.geometry.mode = nextMode;
				}
			}
			if (boundsChanged) node.geometry.bounds = nextBounds;
		},
	};
}

/**
 * Updates text content, bounds, and typography as a single undoable edit. When
 * bounds are omitted, the command recomputes a deterministic natural text box
 * from the patched content/style while preserving the existing local origin.
 */
export function createUpdateTextNodeCommand(
	nodeId: string,
	patch: TextNodePatch,
	options: {
		readonly label?: string;
		readonly resizeBounds?: boolean;
	} = {},
): SceneCommand {
	return {
		type: "scene/update-text-node",
		label: options.label ?? "Edit text",
		run: (draft) => {
			const node = findDraftNode(draft, nodeId);
			if (node?.geometry.kind !== "text") return;
			const currentText = normalizeTextContent(node.geometry.text);
			const currentStyle = normalizeTextStyle(node.geometry.style);
			const currentMode = normalizeTextResizeMode(node.geometry.mode);
			const nextText =
				patch.text === undefined
					? currentText
					: normalizeTextContent(patch.text);
			const nextMode =
				patch.mode === undefined
					? currentMode
					: normalizeTextResizeMode(patch.mode);
			const nextStyle =
				patch.style === undefined
					? currentStyle
					: normalizeTextStyle({ ...currentStyle, ...patch.style });
			const textChanged = node.geometry.text !== nextText;
			const modeChanged = currentMode !== nextMode;
			const styleChanged = !sameTextStyle(currentStyle, nextStyle);
			const shouldResize = options.resizeBounds ?? true;
			const nextBounds =
				patch.bounds ??
				(shouldResize && (textChanged || modeChanged || styleChanged)
					? nextMode === "area"
						? node.geometry.bounds
						: resizedTextBoundsForGeometry(
								node.geometry.bounds,
								nextText,
								nextStyle,
								nextMode,
							)
					: undefined);
			const boundsChanged = nextBounds
				? !sameBounds(node.geometry.bounds, nextBounds)
				: false;
			if (!textChanged && !modeChanged && !styleChanged && !boundsChanged)
				return;
			if (textChanged) node.geometry.text = nextText;
			if (modeChanged) {
				if (nextMode === "point") {
					delete node.geometry.mode;
				} else {
					node.geometry.mode = nextMode;
				}
			}
			if (styleChanged) node.geometry.style = nextStyle;
			if (boundsChanged && nextBounds) node.geometry.bounds = nextBounds;
		},
	};
}

/**
 * Updates the string content of an existing text node without changing legacy
 * caller behavior. Existing callers that omit bounds keep the current text box;
 * style-aware callers may opt into typography changes through the same command.
 */
export function createUpdateTextNodeContentCommand(
	nodeId: string,
	text: string,
	options: { readonly bounds?: Bounds; readonly style?: TextStylePatch } = {},
): SceneCommand {
	return createUpdateTextNodeCommand(
		nodeId,
		{
			text,
			bounds: options.bounds,
			style: options.style,
		},
		{
			label: "Edit text",
			resizeBounds: options.bounds === undefined && options.style !== undefined,
		},
	);
}

/**
 * Transparent, stroke-free style for a frame container. A frame's children move
 * into its subtree, so the frame's own `rect` paints nothing until the deferred
 * Layers/Canvas bridge renders frame chrome: `fill`/`stroke` `"none"` resolve to
 * empty paints in both the canvas (`canvasPaint`) and SVG exporter, so wrapping a
 * selection never drops a destructive opaque box over the content it replaced.
 */
const FRAME_BACKGROUND_STYLE = {
	fill: "none",
	stroke: "none",
	strokeWidth: 0,
	opacity: 1,
} as const satisfies NodeStyle;

const frameTransformPoint = (point: Vec2, matrix: Matrix2D): Vec2 => ({
	x: matrix.a * point.x + matrix.c * point.y + matrix.e,
	y: matrix.b * point.x + matrix.d * point.y + matrix.f,
});

/**
 * Axis-aligned union of the given nodes' transformed geometry bounds, in the
 * shared layer/artboard coordinate space. This is the frame box: children keep
 * their own transforms, so a frame anchored with an identity transform leaves the
 * wrapped content exactly where it was.
 */
const frameBoundsForNodes = (nodes: readonly VectorNode[]): Bounds => {
	const xs: number[] = [];
	const ys: number[] = [];
	for (const node of nodes) {
		const bounds = getGeometryBounds(node.geometry);
		const matrix = matrixFromTransform(node.transform);
		const corners: readonly Vec2[] = [
			{ x: bounds.x, y: bounds.y },
			{ x: bounds.x + bounds.width, y: bounds.y },
			{ x: bounds.x, y: bounds.y + bounds.height },
			{ x: bounds.x + bounds.width, y: bounds.y + bounds.height },
		];
		for (const corner of corners) {
			const point = frameTransformPoint(corner, matrix);
			xs.push(point.x);
			ys.push(point.y);
		}
	}
	if (xs.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
	const minX = Math.min(...xs);
	const minY = Math.min(...ys);
	return {
		x: minX,
		y: minY,
		width: Math.max(...xs) - minX,
		height: Math.max(...ys) - minY,
	};
};

/**
 * Builds a serializable frame container node. The supplied children are already
 * detached plain nodes (the command JSON-clones them out of the draft), so they
 * are assigned directly. `artboardId` is set only when the planner resolved a
 * single owning artboard, which keeps the wrapped children on that artboard
 * instead of letting the new top-level frame fall back to the current artboard.
 */
const createFrameNode = (input: {
	readonly frameNodeId: string;
	readonly children: readonly VectorNode[];
	readonly name: string;
	readonly clipsContent: boolean;
	readonly artboardId?: string;
}): VectorNode => ({
	id: input.frameNodeId,
	name: input.name,
	...(input.artboardId ? { artboardId: input.artboardId } : {}),
	geometry: {
		kind: "rect",
		bounds: frameBoundsForNodes(input.children),
		cornerRadius: 0,
	},
	transform: {
		position: { x: 0, y: 0 },
		rotation: 0,
		scale: { x: 1, y: 1 },
		anchor: { x: 0, y: 0 },
	},
	style: { ...FRAME_BACKGROUND_STYLE },
	visible: true,
	locked: false,
	frame: { kind: "frame", clipsContent: input.clipsContent },
	children: input.children,
});

/**
 * Wraps top-level nodes from one layer in a new frame container as one undoable
 * scene edit. The command re-reads the draft at run time so the child payload
 * reflects the latest scene data, computes the frame box from live child bounds,
 * removes the original top-level sources, and inserts the frame at the first
 * source slot — preserving child order and child transforms (the frame keeps an
 * identity transform, so wrapped content does not move).
 *
 * One command is one Immer patch set is one undo entry; the inverse is
 * {@link createUnframeNodeCommand}. The planner
 * (`buildFrameNodesCommand`) owns selection eligibility and protection rules; this
 * factory stays a deterministic mutation that no-ops on a stale/invalid draft.
 */
export function createFrameNodesCommand(options: {
	readonly layerId: string;
	readonly frameNodeId: string;
	readonly sourceNodeIds: readonly string[];
	readonly name?: string;
	readonly clipsContent?: boolean;
	readonly artboardId?: string;
}): SceneCommand {
	return {
		type: "scene/frame-nodes",
		label: "Wrap in frame",
		run: (draft) => {
			const layer = draft.layers.find((item) => item.id === options.layerId);
			if (!layer) return;
			if (findDraftNode(draft, options.frameNodeId)) return;

			const sourceIds = [...new Set(options.sourceNodeIds)];
			if (sourceIds.length === 0) return;

			const sourceEntries = sourceIds
				.map((nodeId) => ({
					nodeId,
					index: layer.nodes.findIndex((node) => node.id === nodeId),
				}))
				.filter(
					(
						entry,
					): entry is { readonly nodeId: string; readonly index: number } =>
						entry.index >= 0,
				);
			if (sourceEntries.length !== sourceIds.length) return;

			const orderedEntries = [...sourceEntries].sort(
				(left, right) => left.index - right.index,
			);
			const firstIndex = orderedEntries[0]?.index;
			if (firstIndex === undefined) return;

			const children: VectorNode[] = [];
			for (const entry of orderedEntries) {
				const node = layer.nodes[entry.index];
				if (!node) return;
				children.push(cloneSceneDocument<VectorNode>(node));
			}

			const frameNode = createFrameNode({
				frameNodeId: options.frameNodeId,
				children,
				name: options.name ?? "Frame",
				clipsContent: options.clipsContent ?? true,
				artboardId: options.artboardId,
			});

			for (const entry of orderedEntries.toReversed()) {
				layer.nodes.splice(entry.index, 1);
			}
			layer.nodes.splice(firstIndex, 0, castDraft(frameNode));
		},
	};
}

/**
 * Replaces a top-level frame node with its current children — the inverse of
 * {@link createFrameNodesCommand}. Children are cloned out of the draft before
 * insertion so the scene graph stays plain and child ids and transforms survive
 * unchanged. The command no-ops (recording no undo entry) unless the target is an
 * actual frame node, so group/ungroup and other container nodes stay out of
 * scope; a frame that has lost all children unframes to nothing by dropping the
 * empty wrapper. The dropped frame id is pruned from scoped-look targets since
 * it permanently leaves the document (children keep their ids and targets).
 */
export function createUnframeNodeCommand(options: {
	readonly layerId: string;
	readonly frameNodeId: string;
}): SceneCommand {
	return {
		type: "scene/unframe-node",
		label: "Unframe",
		run: (draft) => {
			const layer = draft.layers.find((item) => item.id === options.layerId);
			if (!layer) return;

			const frameIndex = layer.nodes.findIndex(
				(node) => node.id === options.frameNodeId,
			);
			const frameNode = frameIndex >= 0 ? layer.nodes[frameIndex] : undefined;
			if (frameNode?.frame?.kind !== "frame") return;

			if (frameNode.children?.length) {
				const children = cloneSceneDocument(frameNode.children);
				layer.nodes.splice(frameIndex, 1, ...castDraft(children));
			} else {
				layer.nodes.splice(frameIndex, 1);
			}
			pruneDraftComponentPropBindings(draft, new Set([options.frameNodeId]));
			pruneDraftEffectTargets(draft, new Set([options.frameNodeId]));
		},
	};
}
