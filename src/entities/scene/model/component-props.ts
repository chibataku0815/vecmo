import type {
	AnimatableProperty,
	MotionDocument,
} from "@/entities/motion/model/types";
import { normalizeHex } from "@/shared/color";
import { createId } from "@/shared/lib/id";
import { readAppearanceStack } from "./appearance-stack";
import { bindablePropertyById } from "./bindable-property";
import type {
	ComponentPropBinding,
	ComponentPropBindingBindable,
	ComponentPropBindingStyleColor,
	ComponentPropDefinition,
	ComponentPropType,
	ComponentPropValue,
	SceneDocument,
	VectorNode,
} from "./types";
import { COMPONENT_PROP_TYPES } from "./types";

/**
 * Pure component-prop model for editor authoring, Agent writes, Motion
 * Component export, and runtime compilation. This file owns the
 * document-scoped prop-library contract (read, normalize, mint, bind, validate)
 * as side-effect-free helpers so the command bus, the agent write boundary, and
 * runtime compilers share one normalization and one binding-eligibility seam.
 * Nothing here mutates a live document; `component-prop-commands.ts` wraps
 * these helpers to produce undoable Immer patches.
 *
 * Read helpers live here, never in `selectors.ts`, matching the
 * `style-presets.ts` convention: keeps the shared `scene/model` directory free
 * of cross-stream merge collisions.
 */

const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Names a component prop cannot take: JS reserved words (a prop name becomes a
 * destructurable object key / JSX prop identifier at the host boundary a later
 * export slice generates) plus the current `WebglPlayerOptions`/
 * `WebglPlayerOverlayOptions`/`WebglPlayer` public option and method names
 * (`frame`, `loop`, `autoplay`, `playbackRate`, `transparentBackground`, `fit`,
 * `position`, `pointerEvents`, `zIndex`, `progress`, `durationFrames`, `fps`,
 * `duration`, `play`, `pause`, `seek`), the common React/DOM wrapper-prop
 * names a future component wrapper is likely to reserve (`children`, `key`,
 * `ref`, `className`, `style`, `id`), and the generated React wrapper's
 * Interactive Motion surface (T3-S3): `interactive` (the `options.interactions`
 * opt-out prop) and `onClipStart`/`onClipEnd`/`onEnded`/`onStateChange` (the
 * `player.on(...)` event-callback props) — see `reactComponentContents` in
 * `features/export/model/code.ts`. Kept here (not derived from the player
 * module) because this slice ships no runtime/wrapper yet — the list is a
 * documented, hand-curated denylist an export slice should extend rather than
 * replace if it adds new reserved wrapper options.
 */
export const COMPONENT_PROP_RESERVED_NAMES = [
	// JS/TS reserved words relevant to an identifier used as an object key or
	// JSX prop.
	"break",
	"case",
	"catch",
	"class",
	"const",
	"continue",
	"debugger",
	"default",
	"delete",
	"do",
	"else",
	"export",
	"extends",
	"false",
	"finally",
	"for",
	"function",
	"if",
	"import",
	"in",
	"instanceof",
	"new",
	"null",
	"return",
	"super",
	"switch",
	"this",
	"throw",
	"true",
	"try",
	"typeof",
	"var",
	"void",
	"while",
	"with",
	"yield",
	"let",
	"static",
	"await",
	"async",
	"enum",
	"implements",
	"interface",
	"package",
	"private",
	"protected",
	"public",
	// WebglPlayerOptions / WebglPlayerOverlayOptions / WebglPlayer public surface
	// (features/export/model/webgl-player-runtime.ts) — the closest existing
	// precedent for a Vecmo player's public option/method names.
	"frame",
	"loop",
	"autoplay",
	"playbackRate",
	"transparentBackground",
	"fit",
	"position",
	"pointerEvents",
	"zIndex",
	"progress",
	"durationFrames",
	"fps",
	"duration",
	"play",
	"pause",
	"seek",
	// Common React/DOM wrapper-prop names a future component wrapper reserves.
	"children",
	"key",
	"ref",
	"className",
	"style",
	"id",
	// Generated React wrapper's Interactive Motion surface (T3-S3): the
	// `interactive` opt-out prop and the `player.on(...)` event-callback props.
	"interactive",
	"onClipStart",
	"onClipEnd",
	"onEnded",
	"onStateChange",
] as const;

const reservedNameSet = new Set<string>(COMPONENT_PROP_RESERVED_NAMES);

/** Reason a component-prop `name` was refused, for typed agent issues and inline validation UI. */
export type ComponentPropNameIssue =
	| { readonly kind: "blank" }
	| { readonly kind: "invalid-identifier" }
	| { readonly kind: "reserved"; readonly name: string }
	| { readonly kind: "collision"; readonly name: string };

/**
 * Validates a candidate prop name against the identifier grammar, the reserved
 * denylist, and case-sensitive uniqueness within `existingProps` (excluding
 * `excludeId`, so renaming a prop to its own current name is not a
 * self-collision). Returns `null` when the name is valid.
 */
export function validateComponentPropName(
	name: string,
	existingProps: readonly ComponentPropDefinition[],
	excludeId?: string,
): ComponentPropNameIssue | null {
	if (name.length === 0) return { kind: "blank" };
	if (!IDENTIFIER_PATTERN.test(name)) return { kind: "invalid-identifier" };
	if (reservedNameSet.has(name)) return { kind: "reserved", name };
	const collides = existingProps.some(
		(prop) => prop.id !== excludeId && prop.name === name,
	);
	if (collides) return { kind: "collision", name };
	return null;
}

const isComponentPropType = (value: unknown): value is ComponentPropType =>
	COMPONENT_PROP_TYPES.includes(value as ComponentPropType);

/**
 * Reason a component-prop binding target was refused, carrying enough detail
 * for a typed agent issue message without re-deriving the check.
 */
export type ComponentPropBindingIssue =
	| { readonly kind: "node-missing"; readonly nodeId: string }
	| {
			readonly kind: "type-mismatch";
			readonly propType: ComponentPropType;
			readonly bindingKind: ComponentPropBinding["kind"];
	  }
	| {
			readonly kind: "bindable-property-unknown";
			readonly propertyId: string;
	  }
	| {
			readonly kind: "bindable-property-not-numeric";
			readonly propertyId: string;
	  }
	| {
			readonly kind: "bindable-property-not-eligible";
			readonly propertyId: string;
			readonly nodeId: string;
	  }
	| {
			readonly kind: "style-color-not-solid";
			readonly nodeId: string;
			readonly role: "fill" | "stroke";
			readonly paintKind: string;
	  }
	| { readonly kind: "text-content-not-text-node"; readonly nodeId: string }
	| {
			/**
			 * A `bindable`/`style-color` binding targets a node+property that ALSO
			 * has a keyframe track. Both write the same scene field every render:
			 * the motion sampler's interpolated value and the component prop's
			 * `setProps` write race for the same frame, and the sampler runs last
			 * (see `presentation.ts`), so the prop write is silently invisible at
			 * runtime. v1 rejects this combination outright rather than attempting
			 * additive-offset semantics (out of scope) — see
			 * `componentPropBindingAnimatedConflict`'s JSDoc for the exact track
			 * lookup and why this check is authoring-time best-effort only.
			 */
			readonly kind: "binding-animated-conflict";
			readonly nodeId: string;
			readonly property: AnimatableProperty;
	  };

/**
 * Minimal motion-document view component-prop compilation needs: read-only
 * access to keyframe tracks, interaction clips, and the optional serialized
 * Motion Grammar layer used as a conservative ownership fallback. Kept narrow
 * (not the full
 * `MotionDocument`) so callers document exactly what they read, matching this
 * file's `findNodeById`-injection philosophy for
 * `resolveComponentPropBindingIssue`. Every real caller already holds a full
 * `MotionDocument` (see `AgentDocumentContext.motion` in `read-only.ts`), so
 * widening this `Pick` needs no call-site changes.
 */
export type MotionConflictView = Pick<
	MotionDocument,
	"tracks" | "clips" | "grammar"
>;

/**
 * Paint-valued animatable properties whose keyframe track would identically
 * override a `style-color` binding's write. Deliberately excludes
 * `pathShape` (geometry, not paint) even though it shares the snapshot-valued
 * `AnimatableProperty` family in `entities/motion/model/types.ts` — a
 * `style-color` binding can never target geometry, so a `pathShape` track is
 * never a candidate conflict for it.
 */
const PAINT_ANIMATABLE_PROPERTIES = [
	"fillGradient",
	"meshPaint",
] as const satisfies readonly AnimatableProperty[];

/**
 * Resolves whether `motion` already has a keyframe track for `nodeId` +
 * `property` — the same `{nodeId, property}` addressing `KeyframeTrack.target`
 * uses, and the same shape `findTrackByTarget` in
 * `entities/motion/model/commands.ts` looks up (not imported directly since
 * it is unexported there; this is a read-only equivalent, not a second
 * implementation of track mutation).
 *
 * This check is BEST-EFFORT at authoring time: a track can be added to the
 * node+property AFTER a binding is authored (motion authoring and
 * component-prop authoring are independent workflows with no ordering
 * constraint), so a `null` result here is not a durable guarantee — only the
 * export-time compiler (`component-props-export.ts`) is the enforcing gate,
 * since it always resolves against the final document being shipped.
 */
function hasConflictingKeyframeTrack(
	motion: MotionConflictView,
	nodeId: string,
	property: AnimatableProperty,
): boolean {
	return motion.tracks.some(
		(track) =>
			track.target.nodeId === nodeId && track.target.property === property,
	);
}

/**
 * Resolves the single `AnimatableProperty` a `bindable`/`style-color` binding
 * would conflict on, or `undefined` when there is no conflicting keyframe
 * track. This is the ONE canonical `binding -> conflicting property` mapping:
 * `resolveComponentPropBindingIssue` (authoring pre-check, below) and
 * `component-props-export.ts`'s applier compiler (the enforcing export-time
 * gate) both call this so the two layers can never disagree on which bindings
 * collide with motion.
 *
 * `bindable` maps `propertyId` to its `AnimatableProperty` keyframe channel
 * the SAME way `motion/set-bindable-keyframe`'s compiler does
 * (`bindablePropertyById(propertyId).keyframeChannel?.property`, see
 * `entities/agent/model/write.ts`) — a `propertyId` with no `keyframeChannel`
 * (e.g. an `effect-capability` source) can never collide with a
 * `KeyframeTrack`, since those side-car values live outside
 * `MotionDocument.tracks` entirely, so it resolves to no conflict rather than
 * a false positive. A `style-color` binding checks
 * `PAINT_ANIMATABLE_PROPERTIES` (`fillGradient`/`meshPaint`) only for the
 * node's primary fill slot because those tracks sample index 0 (see
 * `presentation.ts`). Stroke and secondary fill bindings remain independent.
 * A document can pass through
 * an intermediate state where the binding's SOLID precondition and the
 * track's gradient/mesh precondition are not simultaneously sample-valid —
 * the binding-vs-track conflict is still worth flagging early since the
 * track's mere presence on the node is the useful signal, independent of
 * which one currently wins at sample time.
 */
export function componentPropBindingAnimatedConflict(
	binding: ComponentPropBinding,
	motion: MotionConflictView,
): AnimatableProperty | undefined {
	if (binding.kind === "bindable") {
		const channel = bindablePropertyById(binding.propertyId)?.keyframeChannel;
		if (!channel) return undefined;
		return hasConflictingKeyframeTrack(motion, binding.nodeId, channel.property)
			? channel.property
			: undefined;
	}
	if (binding.kind === "style-color") {
		if (binding.role !== "fill" || (binding.paintIndex ?? 0) !== 0) {
			return undefined;
		}
		return PAINT_ANIMATABLE_PROPERTIES.find((property) =>
			hasConflictingKeyframeTrack(motion, binding.nodeId, property),
		);
	}
	return undefined;
}

/**
 * Resolves whether `propertyId` is a valid `bindable` target for `node`: it
 * must exist in the `bindable-property.ts` registry, be numeric-valued (the
 * only value kind `scene/set-bindable-property` currently accepts, mirrored
 * from `sceneSetAvailability` in `entities/agent/model/read-only.ts`), target
 * the `"node"` scope, and be eligible for `node`'s current geometry kind
 * (`bindablePropertiesForGeometryKind` already encodes the `any-node`/
 * `geometry`/`effect-capability` eligibility rules; `duplicate-generator`
 * eligibility never includes the `"node"` target scope so it is excluded by
 * the scope check first). This is the single seam agent commands and a later
 * UI use so the two surfaces cannot diverge on what "a bindable number prop
 * can target this node" means.
 */
function bindablePropertyEligibleForNode(
	propertyId: string,
	node: VectorNode,
): ComponentPropBindingIssue | null {
	const descriptor = bindablePropertyById(propertyId);
	if (!descriptor) {
		return { kind: "bindable-property-unknown", propertyId };
	}
	if (descriptor.control.valueKind !== "number") {
		return { kind: "bindable-property-not-numeric", propertyId };
	}
	if (!descriptor.targetScopes.some((scope) => scope === "node")) {
		return {
			kind: "bindable-property-not-eligible",
			propertyId,
			nodeId: node.id,
		};
	}
	if (descriptor.eligibility.kind === "geometry") {
		const eligible = descriptor.eligibility.geometryKinds.some(
			(kind) => kind === node.geometry.kind,
		);
		if (!eligible) {
			return {
				kind: "bindable-property-not-eligible",
				propertyId,
				nodeId: node.id,
			};
		}
	}
	return null;
}

/**
 * Resolves whether a `style-color` binding's target paint slot exists and is a
 * SOLID paint. Reuses `readAppearanceStack` (the same normalized read the
 * appearance-stack editor UI uses) so the legacy-flat-color-as-index-0
 * synthesis and rich `fills`/`strokes` array indexing stay byte-identical to
 * what an artist sees in the Inspector — this helper never re-derives that
 * indexing itself. An out-of-range `paintIndex` resolves to "not solid" (there
 * is no paint kind to report) rather than a separate issue kind, since the
 * caller-facing distinction ("nothing there" vs. "something there but not
 * solid") is not actionable differently for a v1 binding refusal.
 */
function styleColorTargetIssue(
	node: VectorNode,
	role: "fill" | "stroke",
	paintIndex: number,
): ComponentPropBindingIssue | null {
	const stack = readAppearanceStack(node);
	const items = role === "fill" ? stack.fills : stack.strokes;
	const item = items[paintIndex];
	if (item?.paint.kind !== "solid") {
		return {
			kind: "style-color-not-solid",
			nodeId: node.id,
			role,
			paintKind: item?.paint.kind ?? "none",
		};
	}
	return null;
}

/**
 * Resolves one binding's node + type-compatibility + target-eligibility +
 * motion-conflict in one pass, returning the first violated condition
 * (checked in the order: node exists, binding kind matches `propType`,
 * target-specific eligibility, then — only once the target itself is
 * otherwise valid — whether a keyframe track already animates that same
 * target) or `null` when the binding is valid. `findNodeById` is injected
 * instead of imported directly so this stays independent of `selectors.ts`'s
 * live-vs-draft document distinction — command bodies pass `findDraftNode`,
 * agent pre-checks pass `findNode`.
 *
 * `motion` is optional and omitting it simply skips the conflict check (every
 * existing caller keeps working unchanged); callers that DO have a motion
 * document in scope should always pass it — see `MotionConflictView`'s JSDoc
 * for why this check is authoring-time best-effort regardless.
 */
export function resolveComponentPropBindingIssue(
	propType: ComponentPropType,
	binding: ComponentPropBinding,
	findNodeById: (nodeId: string) => VectorNode | undefined,
	motion?: MotionConflictView,
): ComponentPropBindingIssue | null {
	const node = findNodeById(binding.nodeId);
	if (!node) return { kind: "node-missing", nodeId: binding.nodeId };

	const animatedConflictIssue = (): ComponentPropBindingIssue | null => {
		if (!motion) return null;
		const property = componentPropBindingAnimatedConflict(binding, motion);
		return property
			? { kind: "binding-animated-conflict", nodeId: binding.nodeId, property }
			: null;
	};

	if (propType === "number" && binding.kind === "bindable") {
		const eligibility = bindablePropertyEligibleForNode(
			binding.propertyId,
			node,
		);
		return eligibility ?? animatedConflictIssue();
	}
	if (propType === "color" && binding.kind === "style-color") {
		const eligibility = styleColorTargetIssue(
			node,
			binding.role,
			binding.paintIndex ?? 0,
		);
		return eligibility ?? animatedConflictIssue();
	}
	if (propType === "text" && binding.kind === "text-content") {
		if (node.geometry.kind !== "text") {
			return { kind: "text-content-not-text-node", nodeId: node.id };
		}
		return null;
	}
	return {
		kind: "type-mismatch",
		propType,
		bindingKind: binding.kind,
	};
}

const isValidDefaultValue = (
	type: ComponentPropType,
	value: unknown,
): value is ComponentPropValue => {
	if (!isRecord(value) || value.type !== type) return false;
	if (type === "number") return Number.isFinite(value.value);
	return typeof value.value === "string";
};

const normalizeComponentPropBinding = (
	value: unknown,
): ComponentPropBinding | null => {
	if (!isRecord(value) || typeof value.kind !== "string") return null;
	const nodeId = typeof value.nodeId === "string" ? value.nodeId.trim() : "";
	if (nodeId.length === 0) return null;
	if (value.kind === "bindable") {
		const propertyId =
			typeof value.propertyId === "string" ? value.propertyId.trim() : "";
		return propertyId.length > 0
			? { kind: "bindable", nodeId, propertyId }
			: null;
	}
	if (value.kind === "style-color") {
		if (value.role !== "fill" && value.role !== "stroke") return null;
		if (
			value.paintIndex !== undefined &&
			(typeof value.paintIndex !== "number" ||
				!Number.isInteger(value.paintIndex) ||
				value.paintIndex < 0)
		) {
			return null;
		}
		return {
			kind: "style-color",
			nodeId,
			role: value.role,
			...(value.paintIndex === undefined
				? {}
				: { paintIndex: Number(value.paintIndex) }),
		};
	}
	return value.kind === "text-content"
		? { kind: "text-content", nodeId }
		: null;
};

const componentPropBindingIdentity = (
	binding: ComponentPropBinding,
): string => {
	if (binding.kind === "bindable") {
		return `bindable:${binding.nodeId}:${binding.propertyId}`;
	}
	if (binding.kind === "style-color") {
		return `style-color:${binding.nodeId}:${binding.role}:${binding.paintIndex ?? 0}`;
	}
	return `text-content:${binding.nodeId}`;
};

/**
 * Reads the document's component-prop library as a normalized array. Legacy
 * documents that omit `componentProps` read as empty; malformed entries (bad
 * id/name, type/defaultValue mismatch, unresolvable id-shape) are dropped so
 * downstream readers never branch on a partially valid prop. This intentionally
 * does NOT re-validate bindings against a live scene (a node referenced by a
 * binding may have been deleted since); binding resolution against a specific
 * scene snapshot is `resolveComponentPropBindingIssue`'s job, called by
 * commands/agent writes at mutation time.
 */
export function readComponentProps(
	document: Pick<SceneDocument, "componentProps">,
): readonly ComponentPropDefinition[] {
	const props = document.componentProps;
	if (!props || props.length === 0) return [];
	const seenIds = new Set<string>();
	const result: ComponentPropDefinition[] = [];
	for (const prop of props) {
		const normalized = normalizeComponentPropDefinition(prop);
		if (!normalized || seenIds.has(normalized.id)) continue;
		seenIds.add(normalized.id);
		result.push(normalized);
	}
	return result;
}

/**
 * Normalizes a single component-prop record: trims id/name, validates the
 * type/defaultValue pairing, and drops any binding whose `kind` is
 * incompatible with `type` (a defensive normalization — well-formed callers
 * never produce a mismatched binding because `resolveComponentPropBindingIssue`
 * already enforces it at write time, but a hand-edited or legacy-migrated
 * document could). Returns `null` when the record has a blank id/name or an
 * invalid type/defaultValue pairing.
 */
export function normalizeComponentPropDefinition(
	prop: unknown,
): ComponentPropDefinition | null {
	if (!isRecord(prop)) return null;
	const id = typeof prop.id === "string" ? prop.id.trim() : "";
	const name = typeof prop.name === "string" ? prop.name.trim() : "";
	if (id.length === 0 || name.length === 0) return null;
	if (!isComponentPropType(prop.type)) return null;
	if (!isValidDefaultValue(prop.type, prop.defaultValue)) return null;

	const compatibleBindingKind: ComponentPropBinding["kind"] =
		prop.type === "number"
			? "bindable"
			: prop.type === "color"
				? "style-color"
				: "text-content";
	const seenBindings = new Set<string>();
	const bindings = (Array.isArray(prop.bindings) ? prop.bindings : [])
		.map(normalizeComponentPropBinding)
		.filter((binding): binding is ComponentPropBinding => binding !== null)
		.filter((binding) => binding.kind === compatibleBindingKind)
		.filter((binding) => {
			const identity = componentPropBindingIdentity(binding);
			if (seenBindings.has(identity)) return false;
			seenBindings.add(identity);
			return true;
		});

	return {
		id,
		name,
		type: prop.type,
		defaultValue: prop.defaultValue,
		...(typeof prop.min === "number" && Number.isFinite(prop.min)
			? { min: prop.min }
			: {}),
		...(typeof prop.max === "number" && Number.isFinite(prop.max)
			? { max: prop.max }
			: {}),
		...(typeof prop.step === "number" && Number.isFinite(prop.step)
			? { step: prop.step }
			: {}),
		bindings,
	};
}

/** Stable document-wide address for one color-prop paint-slot binding. */
export function styleColorBindingTargetKey(
	binding: ComponentPropBindingStyleColor,
): string {
	return `${binding.nodeId}:${binding.role}:${binding.paintIndex ?? 0}`;
}

/** Returns every normalized color prop that currently owns one paint slot. */
export function componentPropStyleColorTargetOwners(
	document: Pick<SceneDocument, "componentProps">,
	binding: ComponentPropBindingStyleColor,
): readonly ComponentPropDefinition[] {
	const targetKey = styleColorBindingTargetKey(binding);
	return readComponentProps(document).filter(
		(prop) =>
			prop.type === "color" &&
			prop.bindings.some(
				(candidate) =>
					candidate.kind === "style-color" &&
					styleColorBindingTargetKey(candidate) === targetKey,
			),
	);
}

/**
 * Reports whether component-instance override metadata already claims the
 * fill/stroke role containing a proposed shared-color address. Style overrides
 * store whole legacy fields or paint arrays rather than durable paint-item ids,
 * so any override of that role conflicts with a document-level color driver.
 */
export function componentStyleOverrideClaimsColorTarget(
	document: Pick<SceneDocument, "layers">,
	binding: ComponentPropBindingStyleColor,
): boolean {
	const roleClaimed = (node: VectorNode): boolean => {
		const instance = node.component;
		if (instance?.kind === "instance") {
			for (const override of instance.overrides ?? []) {
				if (
					override.kind !== "style" ||
					override.instanceNodeId !== binding.nodeId
				) {
					continue;
				}
				if (
					binding.role === "fill"
						? override.style.fill !== undefined ||
							override.style.fills !== undefined
						: override.style.stroke !== undefined ||
							override.style.strokes !== undefined
				) {
					return true;
				}
			}
		}
		return node.children?.some(roleClaimed) ?? false;
	};
	return document.layers.some((layer) => layer.nodes.some(roleClaimed));
}

/** Typed competing-owner state for one shared-color paint address. */
export type ComponentPropStyleColorOwnershipConflictKind =
	| "component-override"
	| "duplicate-color-prop"
	| "component-override-and-duplicate-color-prop";

/** Classifies every competing owner of one proposed shared-color address. */
export function componentPropStyleColorOwnershipConflictKind(
	document: Pick<SceneDocument, "componentProps" | "layers">,
	binding: ComponentPropBindingStyleColor,
	excludePropId?: string,
): ComponentPropStyleColorOwnershipConflictKind | null {
	const overrideConflict = componentStyleOverrideClaimsColorTarget(
		document,
		binding,
	);
	const targetKey = styleColorBindingTargetKey(binding);
	const duplicateColorProp = readComponentProps(document).some(
		(prop) =>
			prop.id !== excludePropId &&
			prop.type === "color" &&
			prop.bindings.some(
				(candidate) =>
					candidate.kind === "style-color" &&
					styleColorBindingTargetKey(candidate) === targetKey,
			),
	);
	if (overrideConflict && duplicateColorProp) {
		return "component-override-and-duplicate-color-prop";
	}
	if (overrideConflict) return "component-override";
	if (duplicateColorProp) return "duplicate-color-prop";
	return null;
}

/**
 * True when any proposed paint slot is already owned by another color prop or
 * its role is claimed by component-instance override metadata. A paint address
 * has one driver: either overlap would make editor pixels, reset behavior, and
 * runtime output depend on write order.
 */
export function componentPropStyleColorOwnershipConflict(
	document: Pick<SceneDocument, "componentProps" | "layers">,
	bindings: readonly ComponentPropBindingStyleColor[],
	excludePropId?: string,
): boolean {
	return bindings.some(
		(binding) =>
			componentPropStyleColorOwnershipConflictKind(
				document,
				binding,
				excludePropId,
			) !== null,
	);
}

/** Native scalar property ids admitted by Shared values V1. */
export const SHARED_NUMBER_PROPERTY_IDS = [
	"transform.rotation",
	"style.opacity",
] as const;

export type SharedNumberPropertyId =
	(typeof SHARED_NUMBER_PROPERTY_IDS)[number];

const sharedNumberPropertyIdSet = new Set<string>(SHARED_NUMBER_PROPERTY_IDS);

/** Narrows a bindable-property id to the Shared values V1 contract. */
export function isSharedNumberPropertyId(
	propertyId: string,
): propertyId is SharedNumberPropertyId {
	return sharedNumberPropertyIdSet.has(propertyId);
}

/** Stable document-wide address for one number-prop native scalar binding. */
export function bindableBindingTargetKey(
	binding: ComponentPropBindingBindable,
): string {
	return `${binding.nodeId}:${binding.propertyId}`;
}

/** Returns every normalized number prop that currently owns one scalar address. */
export function componentPropBindableTargetOwners(
	document: Pick<SceneDocument, "componentProps">,
	binding: ComponentPropBindingBindable,
): readonly ComponentPropDefinition[] {
	const targetKey = bindableBindingTargetKey(binding);
	return readComponentProps(document).filter(
		(prop) =>
			prop.type === "number" &&
			prop.bindings.some(
				(candidate) =>
					candidate.kind === "bindable" &&
					bindableBindingTargetKey(candidate) === targetKey,
			),
	);
}

/** Competing writer kinds that make a Shared values V1 address ambiguous. */
export type ComponentPropSharedNumberOwnershipConflictKind =
	| "duplicate-number-prop"
	| "native-expression"
	| "property-relation"
	| "motion-parent"
	| "transform-constraint"
	| "motion-grammar"
	| "component-override";

export type ComponentPropSharedNumberOwnershipView = Pick<
	SceneDocument,
	"componentProps" | "layers" | "nativeExpressionBindings"
> & {
	/** Node ids targeted by active Motion Grammar bindings, supplied by the owning layer. */
	readonly grammarTargetNodeIds?: ReadonlySet<string>;
};

const findNodeInOwnershipView = (
	document: Pick<SceneDocument, "layers">,
	nodeId: string,
): VectorNode | undefined => {
	const visit = (nodes: readonly VectorNode[]): VectorNode | undefined => {
		for (const node of nodes) {
			if (node.id === nodeId) return node;
			const child = node.children ? visit(node.children) : undefined;
			if (child) return child;
		}
		return undefined;
	};
	for (const layer of document.layers) {
		const node = visit(layer.nodes);
		if (node) return node;
	}
	return undefined;
};

/** True when instance override metadata writes the same Rotation/Opacity address. */
export function componentOverrideClaimsSharedNumberTarget(
	document: Pick<SceneDocument, "layers">,
	binding: ComponentPropBindingBindable,
): boolean {
	const claimsTarget = (node: VectorNode): boolean => {
		const instance = node.component;
		if (instance?.kind === "instance") {
			for (const override of instance.overrides ?? []) {
				if (override.instanceNodeId !== binding.nodeId) continue;
				if (
					binding.propertyId === "transform.rotation" &&
					override.kind === "transform" &&
					override.transform.rotation !== undefined
				) {
					return true;
				}
				if (
					binding.propertyId === "style.opacity" &&
					override.kind === "style" &&
					override.style.opacity !== undefined
				) {
					return true;
				}
			}
		}
		return node.children?.some(claimsTarget) ?? false;
	};
	return document.layers.some((layer) => layer.nodes.some(claimsTarget));
}

/**
 * Classifies every current Scene/grammar writer that competes with one Shared
 * values V1 address. Keyframe tracks are intentionally handled by
 * {@link componentPropBindingAnimatedConflict}, because MotionDocument is a
 * separate owner from this Scene-only view.
 */
export function componentPropSharedNumberOwnershipConflicts(
	document: ComponentPropSharedNumberOwnershipView,
	binding: ComponentPropBindingBindable,
	excludePropId?: string,
): readonly ComponentPropSharedNumberOwnershipConflictKind[] {
	if (!isSharedNumberPropertyId(binding.propertyId)) return [];
	const conflicts: ComponentPropSharedNumberOwnershipConflictKind[] = [];
	const targetKey = bindableBindingTargetKey(binding);
	const duplicate = readComponentProps(document).some(
		(prop) =>
			prop.id !== excludePropId &&
			prop.type === "number" &&
			prop.bindings.some(
				(candidate) =>
					candidate.kind === "bindable" &&
					bindableBindingTargetKey(candidate) === targetKey,
			),
	);
	if (duplicate) conflicts.push("duplicate-number-prop");
	if (
		document.nativeExpressionBindings?.some(
			(candidate) =>
				candidate.nodeId === binding.nodeId &&
				candidate.propertyId === binding.propertyId,
		)
	) {
		conflicts.push("native-expression");
	}
	const node = findNodeInOwnershipView(document, binding.nodeId);
	if (
		binding.propertyId === "style.opacity" &&
		node?.propertyRelations?.some(
			(relation) => relation.targetProperty === "style.opacity",
		)
	) {
		conflicts.push("property-relation");
	}
	if (binding.propertyId === "transform.rotation" && node?.motionParent) {
		conflicts.push("motion-parent");
	}
	if (
		binding.propertyId === "transform.rotation" &&
		node?.transformConstraint?.channels.includes("rotation")
	) {
		conflicts.push("transform-constraint");
	}
	if (document.grammarTargetNodeIds?.has(binding.nodeId)) {
		conflicts.push("motion-grammar");
	}
	if (componentOverrideClaimsSharedNumberTarget(document, binding)) {
		conflicts.push("component-override");
	}
	return conflicts;
}

/** Reads the canonical Scene value for a Shared values V1 binding. */
export function sharedNumberBindingValue(
	node: VectorNode,
	binding: ComponentPropBindingBindable,
): number | null {
	if (binding.propertyId === "transform.rotation") {
		return node.transform.rotation;
	}
	if (binding.propertyId === "style.opacity") return node.style.opacity;
	return null;
}

/**
 * Returns whether a Shared values V1 scalar satisfies the native bindable
 * property's finite/range contract. Rotation is intentionally unbounded;
 * Opacity is constrained to the editor's canonical 0–1 range.
 */
export function sharedNumberValueIsValid(
	propertyId: SharedNumberPropertyId,
	value: number,
): boolean {
	if (!Number.isFinite(value)) return false;
	const control = bindablePropertyById(propertyId)?.control;
	if (!control) return false;
	if (typeof control.min === "number" && value < control.min) return false;
	if (typeof control.max === "number" && value > control.max) return false;
	return true;
}

export type ComponentPropSharedNumberValueIssue =
	| {
			readonly kind: "range-contract-invalid";
			readonly propertyId: SharedNumberPropertyId;
	  }
	| {
			readonly kind: "default-out-of-range";
			readonly propertyId: SharedNumberPropertyId;
			readonly value: number;
	  }
	| {
			readonly kind: "default-target-mismatch";
			readonly binding: ComponentPropBindingBindable;
			readonly expected: number;
			readonly actual: number;
	  };

/**
 * Reports split-brain Shared values state: unsafe host range metadata, a
 * default outside the native property range, or editor pixels that do not
 * match the stored driver default.
 */
export function componentPropSharedNumberValueIssues(
	prop: ComponentPropDefinition,
	findNodeById: (nodeId: string) => VectorNode | undefined,
): readonly ComponentPropSharedNumberValueIssue[] {
	if (prop.type !== "number") return [];
	const bindings = prop.bindings.filter(
		(binding): binding is ComponentPropBindingBindable =>
			binding.kind === "bindable" &&
			isSharedNumberPropertyId(binding.propertyId),
	);
	if (bindings.length === 0) return [];
	const issues: ComponentPropSharedNumberValueIssue[] = [];
	for (const propertyId of new Set(
		bindings.map((binding) => binding.propertyId as SharedNumberPropertyId),
	)) {
		const descriptor = bindablePropertyById(propertyId);
		if (
			prop.min !== descriptor?.control.min ||
			prop.max !== descriptor?.control.max ||
			prop.step !== descriptor?.control.step
		) {
			issues.push({ kind: "range-contract-invalid", propertyId });
		}
		const value =
			prop.defaultValue.type === "number"
				? prop.defaultValue.value
				: Number.NaN;
		if (
			!Number.isFinite(value) ||
			(typeof descriptor?.control.min === "number" &&
				value < descriptor.control.min) ||
			(typeof descriptor?.control.max === "number" &&
				value > descriptor.control.max)
		) {
			issues.push({ kind: "default-out-of-range", propertyId, value });
		}
	}
	const expected =
		prop.defaultValue.type === "number" ? prop.defaultValue.value : Number.NaN;
	if (!Number.isFinite(expected)) return issues;
	for (const binding of bindings) {
		const node = findNodeById(binding.nodeId);
		if (!node) continue;
		const actual = sharedNumberBindingValue(node, binding);
		if (actual !== null && actual !== expected) {
			issues.push({
				kind: "default-target-mismatch",
				binding,
				expected,
				actual,
			});
		}
	}
	return issues;
}

/**
 * Stored color-driver value issue for an otherwise addressable solid target.
 * Missing/non-solid targets are intentionally left to
 * {@link resolveComponentPropBindingIssue}; this contract only detects the
 * split-brain states where a normalized prop default cannot be represented or
 * does not match the current paint pixels.
 */
export type ComponentPropStyleColorValueIssue =
	| { readonly kind: "default-invalid" }
	| {
			readonly kind: "target-color-invalid";
			readonly binding: ComponentPropBindingStyleColor;
	  }
	| {
			readonly kind: "default-target-mismatch";
			readonly binding: ComponentPropBindingStyleColor;
			readonly expected: string;
			readonly actual: string;
	  };

/**
 * Compares one color prop's canonical default with every currently resolvable
 * solid paint target. The result is pure and is shared by Inspector health and
 * export compilation so an old or hand-authored split-brain document cannot be
 * presented as a healthy driver in one surface and silently shipped by another.
 */
export function componentPropStyleColorValueIssues(
	prop: ComponentPropDefinition,
	findNodeById: (nodeId: string) => VectorNode | undefined,
): readonly ComponentPropStyleColorValueIssue[] {
	if (prop.type !== "color") return [];
	const rawDefault = prop.defaultValue.value;
	const expected =
		typeof rawDefault === "string" ? normalizeHex(rawDefault) : null;
	if (!expected) return [{ kind: "default-invalid" }];

	const issues: ComponentPropStyleColorValueIssue[] = [];
	for (const binding of prop.bindings) {
		if (binding.kind !== "style-color") continue;
		const node = findNodeById(binding.nodeId);
		if (!node) continue;
		const stack = readAppearanceStack(node);
		const items = binding.role === "fill" ? stack.fills : stack.strokes;
		const paint = items[binding.paintIndex ?? 0]?.paint;
		if (paint?.kind !== "solid") continue;
		const actual = normalizeHex(paint.color);
		if (!actual) {
			issues.push({ kind: "target-color-invalid", binding });
			continue;
		}
		if (actual !== expected) {
			issues.push({
				kind: "default-target-mismatch",
				binding,
				expected,
				actual,
			});
		}
	}
	return issues;
}

/** Finds a component prop by id from the normalized library, or undefined. */
export function findComponentProp(
	document: Pick<SceneDocument, "componentProps">,
	propId: string | null | undefined,
): ComponentPropDefinition | undefined {
	if (!propId) return undefined;
	return readComponentProps(document).find((prop) => prop.id === propId);
}

/** Options for minting a new component prop. Mirrors `CreateStylePresetOptions`'s shape. */
export type CreateComponentPropOptions = {
	readonly id?: string;
	readonly name: string;
	readonly type: ComponentPropType;
	readonly defaultValue: ComponentPropValue;
	readonly min?: number;
	readonly max?: number;
	readonly step?: number;
	readonly bindings?: readonly ComponentPropBinding[];
};

/**
 * Mints a normalized component prop against an existing library, id-collision-
 * free (a random suffix, not the deterministic name-suffixing
 * `createStylePreset` uses, because prop `name` must be a valid unique JS
 * identifier and silently suffixing it would surprise a host reading the
 * generated component's prop list — name collisions are refused, not
 * resolved). Returns `null` when the type/defaultValue pairing is invalid or
 * the name fails {@link validateComponentPropName}; callers that need the
 * specific refusal reason should call `validateComponentPropName` themselves
 * before minting (this is what the command factories and agent pre-checks do).
 */
export function createComponentProp(
	existingProps: readonly ComponentPropDefinition[],
	options: CreateComponentPropOptions,
): ComponentPropDefinition | null {
	if (!isValidDefaultValue(options.type, options.defaultValue)) return null;
	if (validateComponentPropName(options.name, existingProps) !== null) {
		return null;
	}
	const existingIds = new Set(existingProps.map((prop) => prop.id));
	let id = options.id?.trim() || createId("prop");
	while (existingIds.has(id)) id = createId("prop");

	return {
		id,
		name: options.name,
		type: options.type,
		defaultValue: options.defaultValue,
		...(typeof options.min === "number" ? { min: options.min } : {}),
		...(typeof options.max === "number" ? { max: options.max } : {}),
		...(typeof options.step === "number" ? { step: options.step } : {}),
		bindings: options.bindings ?? [],
	};
}
