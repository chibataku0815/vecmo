import { castDraft, current, type Draft } from "immer";
import { normalizeHex } from "@/shared/color";
import {
	applyAppearanceStackPatch,
	readAppearanceStack,
} from "./appearance-stack";
import { bindablePropertyById } from "./bindable-property";
import type { SceneCommand } from "./command";
import {
	bindableBindingTargetKey,
	type CreateComponentPropOptions,
	componentPropBindingAnimatedConflict,
	componentPropSharedNumberOwnershipConflicts,
	componentPropStyleColorOwnershipConflict,
	createComponentProp,
	isSharedNumberPropertyId,
	type MotionConflictView,
	normalizeComponentPropDefinition,
	readComponentProps,
	type SharedNumberPropertyId,
	sharedNumberBindingValue,
	sharedNumberValueIsValid,
	validateComponentPropName,
} from "./component-props";
import { cloneSceneDocument } from "./factory";
import { readInteractions } from "./interactions";
import { findDraftNode } from "./selectors";
import type {
	ComponentPropBindingBindable,
	ComponentPropBindingStyleColor,
	ComponentPropBindingTextContent,
	ComponentPropDefinition,
	NodeStyle,
	SceneDocument,
	VectorNode,
} from "./types";

/**
 * Undoable command bridge for the document component-prop library. Every
 * mutation here flows through the scene command bus so library edits and
 * Inspector shared-color writes are single Immer-patch entries with
 * one-gesture-one-undo semantics. The pure normalization, name-validation, and
 * binding-eligibility rules live in `component-props.ts`; these commands wire
 * them to the draft document and keep visible shared-color consumers aligned
 * with their stored prop default.
 */

const writePropLibrary = (
	draft: Draft<SceneDocument>,
	props: readonly ComponentPropDefinition[],
): void => {
	draft.componentProps = castDraft(cloneSceneDocument(props));
};

/**
 * Removes bindings whose addressed nodes permanently left the scene graph.
 * Empty definitions remain so Interaction `set-prop` names and host API schema
 * stay stable while honestly becoming unavailable until an author rebinds them.
 * Structural commands call this inside the same Scene transaction as removal.
 */
export function pruneDraftComponentPropBindings(
	draft: Draft<SceneDocument>,
	removedNodeIds: ReadonlySet<string>,
): void {
	if (removedNodeIds.size === 0) return;
	const props = readComponentProps(draft);
	let changed = false;
	const nextProps = props.map((prop) => {
		const bindings = prop.bindings.filter(
			(binding) => !removedNodeIds.has(binding.nodeId),
		);
		if (bindings.length === prop.bindings.length) return prop;
		changed = true;
		return { ...prop, bindings };
	});
	if (changed) writePropLibrary(draft, nextProps);
}

/** Cross-owner context accepted by Shared values number commands. */
export type SharedNumberCommandOptions = {
	readonly coalesceKey?: string;
	readonly grammarTargetNodeIds: ReadonlySet<string>;
	readonly motion: MotionConflictView;
};

type ComponentPropCommandOptions = {
	readonly label?: string;
	readonly grammarTargetNodeIds?: ReadonlySet<string>;
	readonly motion?: MotionConflictView;
};

type SharedNumberNodeUpdate = {
	readonly node: Draft<VectorNode>;
	rotation?: number;
	opacity?: number;
};

/** Pre-command scalar snapshot used to detect ordinary edits that need promotion. */
export type SharedNumberBeforeValues = {
	readonly rotation: number;
	readonly opacity: number;
};

function sharedNumberDescriptorMetadata(
	propertyId: SharedNumberPropertyId,
): Pick<ComponentPropDefinition, "min" | "max" | "step"> {
	const control = bindablePropertyById(propertyId)?.control;
	if (!control) return {};
	return {
		...(typeof control.min === "number" ? { min: control.min } : {}),
		...(typeof control.max === "number" ? { max: control.max } : {}),
		...(typeof control.step === "number" ? { step: control.step } : {}),
	};
}

function withSharedNumberDescriptorMetadata(
	prop: ComponentPropDefinition,
	propertyId: SharedNumberPropertyId,
): ComponentPropDefinition {
	return {
		id: prop.id,
		name: prop.name,
		type: prop.type,
		defaultValue: prop.defaultValue,
		...sharedNumberDescriptorMetadata(propertyId),
		bindings: prop.bindings,
	};
}

function homogeneousSharedNumberPropertyId(
	bindings: readonly ComponentPropBindingBindable[],
): SharedNumberPropertyId | null {
	if (bindings.length === 0) return null;
	const propertyId = bindings[0]?.propertyId;
	if (!propertyId || !isSharedNumberPropertyId(propertyId)) return null;
	return bindings.every((binding) => binding.propertyId === propertyId)
		? propertyId
		: null;
}

function sharedNumberNodeUpdates(
	draft: Draft<SceneDocument>,
	bindings: readonly ComponentPropBindingBindable[],
	value: number,
	options: {
		readonly excludePropId?: string;
		readonly grammarTargetNodeIds?: ReadonlySet<string>;
		readonly motion?: MotionConflictView;
		readonly requireMatchingCurrentValue?: boolean;
		readonly baseUpdates?: ReadonlyMap<string, SharedNumberNodeUpdate>;
	} = {},
): ReadonlyMap<string, SharedNumberNodeUpdate> | null {
	const propertyId = homogeneousSharedNumberPropertyId(bindings);
	if (!propertyId || !sharedNumberValueIsValid(propertyId, value)) return null;
	// Motion and Motion Grammar are external owners. A shared-number write is
	// only safe after callers prove they inspected both current owner sets.
	if (!options.motion || !options.grammarTargetNodeIds) return null;
	const updates = new Map(options.baseUpdates);
	const visited = new Set<string>();
	for (const binding of bindings) {
		const targetKey = bindableBindingTargetKey(binding);
		if (visited.has(targetKey)) continue;
		visited.add(targetKey);
		if (
			componentPropBindingAnimatedConflict(binding, options.motion) !==
				undefined ||
			componentPropSharedNumberOwnershipConflicts(
				{
					componentProps: draft.componentProps,
					layers: draft.layers,
					nativeExpressionBindings: draft.nativeExpressionBindings,
					...(options.grammarTargetNodeIds
						? { grammarTargetNodeIds: options.grammarTargetNodeIds }
						: {}),
				},
				binding,
				options.excludePropId,
			).length > 0
		) {
			return null;
		}
		const node = findDraftNode(draft, binding.nodeId);
		if (!node) return null;
		const actual = sharedNumberBindingValue(
			current(node) as VectorNode,
			binding,
		);
		if (
			actual === null ||
			(options.requireMatchingCurrentValue === true && actual !== value)
		) {
			return null;
		}
		const update = updates.get(binding.nodeId) ?? { node };
		if (propertyId === "transform.rotation") {
			if (update.rotation !== undefined && update.rotation !== value)
				return null;
			updates.set(binding.nodeId, { ...update, rotation: value });
		} else {
			if (update.opacity !== undefined && update.opacity !== value) return null;
			updates.set(binding.nodeId, { ...update, opacity: value });
		}
	}
	return updates;
}

function applySharedNumberNodeUpdates(
	updates: ReadonlyMap<string, SharedNumberNodeUpdate>,
): void {
	for (const update of updates.values()) {
		if (update.rotation !== undefined) {
			update.node.transform = {
				...update.node.transform,
				rotation: update.rotation,
			};
		}
		if (update.opacity !== undefined) {
			update.node.style = {
				...update.node.style,
				opacity: update.opacity,
			};
		}
	}
}

type SharedColorCommandOptions = {
	readonly coalesceKey?: string;
};

type SharedColorStyleUpdate = {
	readonly node: Draft<VectorNode>;
	readonly style: NodeStyle;
};

type SharedColorStyleSyncOptions = {
	/**
	 * Allows a command that is known to preserve paint indices to edit an
	 * unbound sibling slot in the same role. Generic full-style patches omit this
	 * and remain conservative because index-derived paint identity cannot prove
	 * that an arbitrary array rewrite was not a reorder.
	 */
	readonly allowUnboundPaintChanges?: boolean;
};

/**
 * Resolves every shared-color binding to a solid paint update before any draft
 * mutation occurs. The all-or-nothing preflight keeps the component-prop default
 * and the editor-visible scene from diverging when a bound paint was deleted or
 * changed to a gradient after the binding was authored.
 */
function sharedColorStyleUpdates(
	draft: Draft<SceneDocument>,
	bindings: readonly ComponentPropBindingStyleColor[],
	color: string,
	baseUpdates: ReadonlyMap<string, SharedColorStyleUpdate> = new Map(),
): ReadonlyMap<string, SharedColorStyleUpdate> | null {
	const updates = new Map(baseUpdates);
	const visitedBindings = new Set<string>();
	for (const binding of bindings) {
		const index = binding.paintIndex ?? 0;
		const key = `${binding.nodeId}:${binding.role}:${index}`;
		if (visitedBindings.has(key)) continue;
		visitedBindings.add(key);
		const node = findDraftNode(draft, binding.nodeId);
		if (!node) return null;
		const plainNode = current(node) as VectorNode;
		const existingUpdate = updates.get(binding.nodeId);
		const workingNode = existingUpdate
			? { ...plainNode, style: existingUpdate.style }
			: plainNode;
		const stack = readAppearanceStack(workingNode);
		const item =
			binding.role === "fill" ? stack.fills[index] : stack.strokes[index];
		if (item?.paint.kind !== "solid") return null;
		const style = applyAppearanceStackPatch(workingNode.style, {
			op: "update",
			role: binding.role,
			index,
			paint: { ...item.paint, color },
		});
		updates.set(binding.nodeId, { node, style });
	}
	return updates;
}

/**
 * Preserves component-prop ownership when a generic node-style command edits a
 * bound solid paint. A color-only change is promoted to the owning prop and all
 * of its consumers. Structural list changes, non-solid replacements, ambiguous
 * ownership, or conflicting colors fail closed so ordinary paint authoring
 * cannot silently detach or retarget a shared driver.
 *
 * Call this after mutating `node.style` but before the surrounding Scene command
 * returns. `beforeStyle` must be the plain pre-command style; `false` tells the
 * caller to restore it without committing any other shared-color mutation.
 */
export function synchronizeSharedColorComponentPropsFromNodeStyle(
	draft: Draft<SceneDocument>,
	nodeId: string,
	beforeStyle: NodeStyle,
	options: SharedColorStyleSyncOptions = {},
): boolean {
	const node = findDraftNode(draft, nodeId);
	if (!node) return false;
	const props = readComponentProps(draft);
	const affected = props.filter(
		(prop) =>
			prop.type === "color" &&
			prop.bindings.some(
				(binding) =>
					binding.kind === "style-color" && binding.nodeId === nodeId,
			),
	);
	if (affected.length === 0) return true;

	const afterNode = current(node) as VectorNode;
	const beforeNode = { ...afterNode, style: beforeStyle };
	const beforeStack = readAppearanceStack(beforeNode);
	const afterStack = readAppearanceStack(afterNode);
	const desiredColors = new Map<string, string>();
	const boundIndices = {
		fill: new Set<number>(),
		stroke: new Set<number>(),
	};
	for (const prop of affected) {
		for (const binding of prop.bindings) {
			if (binding.kind !== "style-color" || binding.nodeId !== nodeId) continue;
			boundIndices[binding.role].add(binding.paintIndex ?? 0);
		}
	}
	for (const role of ["fill", "stroke"] as const) {
		if (boundIndices[role].size === 0) continue;
		const beforeItems =
			role === "fill" ? beforeStack.fills : beforeStack.strokes;
		const afterItems = role === "fill" ? afterStack.fills : afterStack.strokes;
		if (beforeItems.length !== afterItems.length) return false;
		for (let index = 0; index < beforeItems.length; index += 1) {
			const previous = beforeItems[index]?.paint;
			const next = afterItems[index]?.paint;
			if (boundIndices[role].has(index)) {
				if (previous?.kind !== "solid" || next?.kind !== "solid") return false;
				continue;
			}
			if (
				!options.allowUnboundPaintChanges &&
				JSON.stringify(previous) !== JSON.stringify(next)
			) {
				return false;
			}
		}
	}

	for (const prop of affected) {
		const bindings = prop.bindings.filter(
			(binding): binding is ComponentPropBindingStyleColor =>
				binding.kind === "style-color",
		);
		if (componentPropStyleColorOwnershipConflict(draft, bindings, prop.id)) {
			return false;
		}
		for (const binding of bindings) {
			if (binding.nodeId !== nodeId) continue;
			const index = binding.paintIndex ?? 0;
			const beforeItems =
				binding.role === "fill" ? beforeStack.fills : beforeStack.strokes;
			const afterItems =
				binding.role === "fill" ? afterStack.fills : afterStack.strokes;
			const beforePaint = beforeItems[index]?.paint;
			const afterPaint = afterItems[index]?.paint;
			if (beforePaint?.kind !== "solid" || afterPaint?.kind !== "solid") {
				return false;
			}
			if (beforePaint.color === afterPaint.color) continue;
			const color = normalizeHex(afterPaint.color);
			if (!color) return false;
			const existing = desiredColors.get(prop.id);
			if (existing && existing !== color) return false;
			desiredColors.set(prop.id, color);
		}
	}

	const plans: Array<{
		readonly prop: ComponentPropDefinition;
		readonly color: string;
	}> = [];
	let plannedUpdates: ReadonlyMap<string, SharedColorStyleUpdate> = new Map();
	for (const prop of affected) {
		const color = desiredColors.get(prop.id);
		if (!color) continue;
		const bindings = prop.bindings.filter(
			(binding): binding is ComponentPropBindingStyleColor =>
				binding.kind === "style-color",
		);
		const nextUpdates = sharedColorStyleUpdates(
			draft,
			bindings,
			color,
			plannedUpdates,
		);
		if (!nextUpdates) return false;
		plannedUpdates = nextUpdates;
		plans.push({ prop, color });
	}
	let nextProps = props;
	for (const { prop, color } of plans) {
		nextProps = nextProps.map((candidate) =>
			candidate.id === prop.id
				? {
						...candidate,
						defaultValue: { type: "color", value: color },
					}
				: candidate,
		);
	}
	for (const update of plannedUpdates.values()) {
		update.node.style = castDraft(update.style);
	}
	if (desiredColors.size > 0) writePropLibrary(draft, nextProps);
	return true;
}

/**
 * Promotes an ordinary Rotation/Opacity edit to the owning document number prop
 * and every consumer. All bindings are resolved before mutation, so an
 * ambiguous owner, stale node, mixed property fan-out, or invalid native range
 * rejects the complete promotion without leaving a partially updated prop.
 */
export function synchronizeSharedNumberComponentPropsFromNode(
	draft: Draft<SceneDocument>,
	nodeId: string,
	beforeValues: SharedNumberBeforeValues,
	options: Partial<
		Pick<SharedNumberCommandOptions, "grammarTargetNodeIds" | "motion">
	> = {},
): boolean {
	const node = findDraftNode(draft, nodeId);
	if (!node) return false;
	const afterNode = current(node) as VectorNode;
	const desiredByProperty = new Map<SharedNumberPropertyId, number>();
	if (afterNode.transform.rotation !== beforeValues.rotation) {
		desiredByProperty.set("transform.rotation", afterNode.transform.rotation);
	}
	if (afterNode.style.opacity !== beforeValues.opacity) {
		desiredByProperty.set("style.opacity", afterNode.style.opacity);
	}
	if (desiredByProperty.size === 0) return true;

	const props = readComponentProps(draft);
	const affected = props.filter(
		(prop) =>
			prop.type === "number" &&
			prop.bindings.some(
				(binding) =>
					binding.kind === "bindable" &&
					binding.nodeId === nodeId &&
					isSharedNumberPropertyId(binding.propertyId) &&
					desiredByProperty.has(binding.propertyId),
			),
	);
	if (affected.length === 0) return true;
	// Motion Grammar lives in a separate store. Once a shared-number owner is
	// affected, callers must prove that they inspected that external owner set;
	// an omitted context is ambiguous and therefore fails closed.
	if (
		options.grammarTargetNodeIds === undefined ||
		options.motion === undefined
	) {
		return false;
	}

	let plannedUpdates: ReadonlyMap<string, SharedNumberNodeUpdate> = new Map();
	const nextById = new Map<string, ComponentPropDefinition>();
	for (const prop of affected) {
		const bindings = prop.bindings.filter(
			(binding): binding is ComponentPropBindingBindable =>
				binding.kind === "bindable",
		);
		if (bindings.length !== prop.bindings.length) return false;
		const propertyId = homogeneousSharedNumberPropertyId(bindings);
		if (!propertyId) return false;
		const value = desiredByProperty.get(propertyId);
		if (value === undefined) continue;
		const nextUpdates = sharedNumberNodeUpdates(draft, bindings, value, {
			excludePropId: prop.id,
			grammarTargetNodeIds: options.grammarTargetNodeIds,
			motion: options.motion,
			baseUpdates: plannedUpdates,
		});
		if (!nextUpdates) return false;
		plannedUpdates = nextUpdates;
		const normalized = normalizeComponentPropDefinition(
			withSharedNumberDescriptorMetadata(
				{ ...prop, defaultValue: { type: "number", value } },
				propertyId,
			),
		);
		if (!normalized) return false;
		nextById.set(prop.id, normalized);
	}

	if (nextById.size === 0) return true;
	applySharedNumberNodeUpdates(plannedUpdates);
	writePropLibrary(
		draft,
		props.map((prop) => nextById.get(prop.id) ?? prop),
	);
	return true;
}

/**
 * Adds a normalized, collision-free component prop to the document library. A
 * blank/invalid/reserved/colliding name, or a `defaultValue` whose `type`
 * does not match `options.type`, is a safe no-op (`createComponentProp`
 * returns `null`) rather than a stored malformed prop — callers that need the
 * specific refusal reason for a typed issue should call
 * `validateComponentPropName`/check the type pairing themselves before
 * dispatching (this is what the agent write boundary does).
 */
export function createAddComponentPropCommand(
	options: CreateComponentPropOptions,
	commandOptions: ComponentPropCommandOptions = {},
): SceneCommand {
	return {
		type: "scene/add-component-prop",
		label: commandOptions.label ?? "Add component prop",
		run: (draft) => {
			const props = readComponentProps(draft);
			let prop = createComponentProp(props, options);
			if (!prop) return;
			const numberBindings = prop.bindings.filter(
				(binding): binding is ComponentPropBindingBindable =>
					binding.kind === "bindable",
			);
			const hasSharedNumberBinding = numberBindings.some((binding) =>
				isSharedNumberPropertyId(binding.propertyId),
			);
			let numberUpdates: ReadonlyMap<string, SharedNumberNodeUpdate> =
				new Map();
			if (prop.type === "number" && hasSharedNumberBinding) {
				const propertyId = homogeneousSharedNumberPropertyId(numberBindings);
				const value =
					prop.defaultValue.type === "number"
						? prop.defaultValue.value
						: Number.NaN;
				if (!propertyId) return;
				const updates = sharedNumberNodeUpdates(draft, numberBindings, value, {
					grammarTargetNodeIds: commandOptions.grammarTargetNodeIds,
					motion: commandOptions.motion,
					requireMatchingCurrentValue: true,
				});
				if (!updates) return;
				numberUpdates = updates;
				const normalized = normalizeComponentPropDefinition(
					withSharedNumberDescriptorMetadata(prop, propertyId),
				);
				if (!normalized) return;
				prop = normalized;
			}
			const colorBindings = prop.bindings.filter(
				(binding): binding is ComponentPropBindingStyleColor =>
					binding.kind === "style-color",
			);
			if (
				prop.type === "color" &&
				componentPropStyleColorOwnershipConflict(draft, colorBindings)
			) {
				return;
			}
			const color =
				prop.type === "color" && colorBindings.length > 0
					? typeof prop.defaultValue.value === "string"
						? normalizeHex(prop.defaultValue.value)
						: null
					: null;
			if (prop.type === "color" && colorBindings.length > 0 && !color) return;
			const updates = color
				? sharedColorStyleUpdates(draft, colorBindings, color)
				: new Map<string, SharedColorStyleUpdate>();
			if (!updates) return;
			const storedProp = color
				? { ...prop, defaultValue: { type: "color", value: color } as const }
				: prop;
			writePropLibrary(draft, [...props, storedProp]);
			applySharedNumberNodeUpdates(numberUpdates);
			for (const update of updates.values()) {
				update.node.style = castDraft(update.style);
			}
		},
	};
}

/** Partial patch for `createUpdateComponentPropCommand`. `bindings`, when present, REPLACES the prop's full binding list rather than merging into it. */
export type ComponentPropUpdatePatch = Partial<
	Pick<
		ComponentPropDefinition,
		"name" | "defaultValue" | "min" | "max" | "step" | "bindings"
	>
>;

/**
 * Applies a partial patch to an existing component prop. A missing prop id is
 * a no-op. A `name` patch that fails {@link validateComponentPropName} (blank,
 * invalid identifier, reserved, or colliding with another prop) is dropped
 * from the patch rather than refusing the whole update, so a caller batching a
 * rename with other field changes still applies the valid parts — the agent
 * write boundary pre-checks the name separately and refuses the whole command
 * on an invalid name instead, matching its "typed issue instead of a partial
 * silent apply" convention. The merged result is re-normalized through
 * `normalizeComponentPropDefinition` so a `defaultValue`/`type` mismatch (type
 * itself is not patchable) or an incompatible `bindings` entry cannot corrupt
 * the stored prop; a patch that normalizes to an unchanged or invalid record
 * is a no-op.
 */
export function createUpdateComponentPropCommand(
	propId: string,
	patch: ComponentPropUpdatePatch,
	commandOptions: Omit<ComponentPropCommandOptions, "label"> = {},
): SceneCommand {
	return {
		type: "scene/update-component-prop",
		label: "Edit component prop",
		run: (draft) => {
			const props = readComponentProps(draft);
			const target = props.find((prop) => prop.id === propId);
			if (!target) return;

			const nameIssue =
				patch.name !== undefined
					? validateComponentPropName(patch.name, props, propId)
					: null;
			const nextName =
				nameIssue === null && patch.name ? patch.name : target.name;

			let normalized = normalizeComponentPropDefinition({
				...target,
				name: nextName,
				...(patch.defaultValue !== undefined
					? { defaultValue: patch.defaultValue }
					: {}),
				...(patch.min !== undefined ? { min: patch.min } : {}),
				...(patch.max !== undefined ? { max: patch.max } : {}),
				...(patch.step !== undefined ? { step: patch.step } : {}),
				...(patch.bindings !== undefined ? { bindings: patch.bindings } : {}),
			});
			if (!normalized) return;
			const numberBindings = normalized.bindings.filter(
				(binding): binding is ComponentPropBindingBindable =>
					binding.kind === "bindable",
			);
			const hasSharedNumberBinding = numberBindings.some((binding) =>
				isSharedNumberPropertyId(binding.propertyId),
			);
			let numberUpdates: ReadonlyMap<string, SharedNumberNodeUpdate> =
				new Map();
			if (normalized.type === "number" && hasSharedNumberBinding) {
				const propertyId = homogeneousSharedNumberPropertyId(numberBindings);
				if (!propertyId) return;
				normalized = withSharedNumberDescriptorMetadata(normalized, propertyId);
				if (patch.defaultValue !== undefined || patch.bindings !== undefined) {
					const value =
						normalized.defaultValue.type === "number"
							? normalized.defaultValue.value
							: Number.NaN;
					const updates = sharedNumberNodeUpdates(
						draft,
						numberBindings,
						value,
						{
							excludePropId: normalized.id,
							grammarTargetNodeIds: commandOptions.grammarTargetNodeIds,
							motion: commandOptions.motion,
							requireMatchingCurrentValue: patch.defaultValue === undefined,
						},
					);
					if (!updates) return;
					numberUpdates = updates;
				}
			}
			const colorBindings = normalized.bindings.filter(
				(binding): binding is ComponentPropBindingStyleColor =>
					binding.kind === "style-color",
			);
			if (
				normalized.type === "color" &&
				componentPropStyleColorOwnershipConflict(
					draft,
					colorBindings,
					normalized.id,
				)
			) {
				return;
			}
			const shouldSyncColor =
				normalized.type === "color" &&
				colorBindings.length > 0 &&
				(patch.defaultValue !== undefined || patch.bindings !== undefined);
			const color = shouldSyncColor
				? typeof normalized.defaultValue.value === "string"
					? normalizeHex(normalized.defaultValue.value)
					: null
				: null;
			if (shouldSyncColor && !color) return;
			const updates = color
				? sharedColorStyleUpdates(draft, colorBindings, color)
				: new Map<string, SharedColorStyleUpdate>();
			if (!updates) return;
			if (color) {
				normalized = {
					...normalized,
					defaultValue: { type: "color", value: color },
				};
			}
			const propChanged = JSON.stringify(target) !== JSON.stringify(normalized);
			const styleChanged = [...updates.values()].some(
				(update) =>
					JSON.stringify(current(update.node).style) !==
					JSON.stringify(update.style),
			);
			const numberChanged = [...numberUpdates.values()].some((update) => {
				const node = current(update.node) as VectorNode;
				return (
					(update.rotation !== undefined &&
						update.rotation !== node.transform.rotation) ||
					(update.opacity !== undefined &&
						update.opacity !== node.style.opacity)
				);
			});
			if (!propChanged && !styleChanged && !numberChanged) return;

			writePropLibrary(
				draft,
				props.map((prop) => (prop.id === propId ? normalized : prop)),
			);
			applySharedNumberNodeUpdates(numberUpdates);
			for (const update of updates.values()) {
				update.node.style = castDraft(update.style);
			}
		},
	};
}

/** Removes a component prop from the library. Missing ids are a no-op. */
export function createRemoveComponentPropCommand(propId: string): SceneCommand {
	return {
		type: "scene/remove-component-prop",
		label: "Remove component prop",
		run: (draft) => {
			const props = readComponentProps(draft);
			const target = props.find((prop) => prop.id === propId);
			if (!target) return;
			if (
				readInteractions(draft).some((interaction) =>
					interaction.actions.some(
						(action) =>
							action.kind === "set-prop" && action.propName === target.name,
					),
				)
			) {
				return;
			}
			writePropLibrary(
				draft,
				props.filter((prop) => prop.id !== propId),
			);
		},
	};
}

/**
 * Updates one text component prop and every bound text node in the same Scene
 * transaction. Missing/non-text targets or competing text-prop owners reject
 * the complete edit so stored defaults and visible content cannot diverge.
 */
export function createSetTextComponentPropCommand(
	propId: string,
	value: string,
	options: { readonly coalesceKey?: string } = {},
): SceneCommand {
	return {
		type: "scene/set-text-component-prop",
		label: "Edit shared text",
		coalesceKey: options.coalesceKey,
		run: (draft) => {
			const props = readComponentProps(draft);
			const prop = props.find((candidate) => candidate.id === propId);
			if (prop?.type !== "text") return;
			const bindings = prop.bindings.filter(
				(binding): binding is ComponentPropBindingTextContent =>
					binding.kind === "text-content",
			);
			if (bindings.length === 0 || bindings.length !== prop.bindings.length)
				return;
			for (const binding of bindings) {
				const node = findDraftNode(draft, binding.nodeId);
				if (node?.geometry.kind !== "text") return;
				const hasCompetingOwner = props.some(
					(candidate) =>
						candidate.id !== prop.id &&
						candidate.bindings.some(
							(other) =>
								other.kind === "text-content" &&
								other.nodeId === binding.nodeId,
						),
				);
				if (hasCompetingOwner) return;
			}
			const normalized = normalizeComponentPropDefinition({
				...prop,
				defaultValue: { type: "text", value },
			});
			if (!normalized) return;
			writePropLibrary(
				draft,
				props.map((candidate) =>
					candidate.id === prop.id ? normalized : candidate,
				),
			);
			for (const binding of bindings) {
				const node = findDraftNode(draft, binding.nodeId);
				if (node?.geometry.kind === "text") node.geometry.text = value;
			}
		},
	};
}

/**
 * Creates one Rotation/Opacity prop from equal existing Scene values. The
 * command never uses creation as an implicit "make these values equal" action:
 * mixed target values or any competing writer reject the complete edit.
 */
export function createAddSharedNumberComponentPropCommand(options: {
	readonly name: string;
	readonly propertyId: SharedNumberPropertyId;
	readonly value: number;
	readonly bindings: readonly ComponentPropBindingBindable[];
	readonly grammarTargetNodeIds: ReadonlySet<string>;
	readonly motion: MotionConflictView;
}): SceneCommand {
	return {
		type: "scene/add-shared-number-component-prop",
		label: "Create shared value",
		run: (draft) => {
			if (
				options.bindings.length === 0 ||
				options.bindings.some(
					(binding) => binding.propertyId !== options.propertyId,
				) ||
				!sharedNumberValueIsValid(options.propertyId, options.value)
			) {
				return;
			}
			const updates = sharedNumberNodeUpdates(
				draft,
				options.bindings,
				options.value,
				{
					grammarTargetNodeIds: options.grammarTargetNodeIds,
					motion: options.motion,
					requireMatchingCurrentValue: true,
				},
			);
			if (!updates) return;
			const props = readComponentProps(draft);
			const prop = createComponentProp(props, {
				name: options.name,
				type: "number",
				defaultValue: { type: "number", value: options.value },
				...sharedNumberDescriptorMetadata(options.propertyId),
				bindings: options.bindings,
			});
			if (!prop) return;
			writePropLibrary(draft, [...props, prop]);
			applySharedNumberNodeUpdates(updates);
		},
	};
}

/** Atomically writes one shared Rotation/Opacity value to its prop and targets. */
export function createSetSharedNumberComponentPropCommand(
	propId: string,
	value: number,
	options: SharedNumberCommandOptions,
): SceneCommand {
	return {
		type: "scene/set-shared-number-component-prop",
		label: "Edit shared value",
		...(options.coalesceKey ? { coalesceKey: options.coalesceKey } : {}),
		run: (draft) => {
			const props = readComponentProps(draft);
			const target = props.find((prop) => prop.id === propId);
			if (target?.type !== "number") return;
			const bindings = target.bindings.filter(
				(binding): binding is ComponentPropBindingBindable =>
					binding.kind === "bindable",
			);
			if (bindings.length !== target.bindings.length) return;
			const propertyId = homogeneousSharedNumberPropertyId(bindings);
			if (!propertyId || !sharedNumberValueIsValid(propertyId, value)) return;
			const updates = sharedNumberNodeUpdates(draft, bindings, value, {
				excludePropId: target.id,
				grammarTargetNodeIds: options.grammarTargetNodeIds,
				motion: options.motion,
			});
			if (!updates) return;
			const normalized = normalizeComponentPropDefinition(
				withSharedNumberDescriptorMetadata(
					{ ...target, defaultValue: { type: "number", value } },
					propertyId,
				),
			);
			if (!normalized) return;
			const nodeChanged = [...updates.values()].some((update) => {
				const node = current(update.node) as VectorNode;
				return (
					(update.rotation !== undefined &&
						update.rotation !== node.transform.rotation) ||
					(update.opacity !== undefined &&
						update.opacity !== node.style.opacity)
				);
			});
			if (
				!nodeChanged &&
				JSON.stringify(normalized) === JSON.stringify(target)
			) {
				return;
			}
			writePropLibrary(
				draft,
				props.map((prop) => (prop.id === propId ? normalized : prop)),
			);
			applySharedNumberNodeUpdates(updates);
		},
	};
}

/**
 * Creates a document color prop and binds it to existing solid paint slots in
 * one undoable Scene command. The chosen color is written to every target at
 * creation time so editor pixels, the stored default, and exported component
 * props begin from the same value.
 */
export function createAddSharedColorComponentPropCommand(options: {
	readonly name: string;
	readonly color: string;
	readonly bindings: readonly ComponentPropBindingStyleColor[];
}): SceneCommand {
	return {
		type: "scene/add-shared-color-component-prop",
		label: "Create shared color",
		run: (draft) => {
			const color = normalizeHex(options.color);
			if (!color || options.bindings.length === 0) return;
			const props = readComponentProps(draft);
			if (componentPropStyleColorOwnershipConflict(draft, options.bindings)) {
				return;
			}
			const updates = sharedColorStyleUpdates(draft, options.bindings, color);
			if (!updates) return;
			const prop = createComponentProp(props, {
				name: options.name,
				type: "color",
				defaultValue: { type: "color", value: color },
				bindings: options.bindings,
			});
			if (!prop) return;
			writePropLibrary(draft, [...props, prop]);
			for (const update of updates.values()) {
				update.node.style = castDraft(update.style);
			}
		},
	};
}

/**
 * Changes one document color prop and all of its solid paint targets atomically.
 * A stale or non-solid target rejects the complete edit instead of updating the
 * stored default while leaving one visible consumer behind.
 */
export function createSetSharedColorComponentPropCommand(
	propId: string,
	colorInput: string,
	options: SharedColorCommandOptions = {},
): SceneCommand {
	return {
		type: "scene/set-shared-color-component-prop",
		label: "Edit shared color",
		...(options.coalesceKey ? { coalesceKey: options.coalesceKey } : {}),
		run: (draft) => {
			const color = normalizeHex(colorInput);
			if (!color) return;
			const props = readComponentProps(draft);
			const target = props.find((prop) => prop.id === propId);
			if (target?.type !== "color") return;
			const bindings = target.bindings.filter(
				(binding): binding is ComponentPropBindingStyleColor =>
					binding.kind === "style-color",
			);
			if (bindings.length !== target.bindings.length) return;
			if (
				componentPropStyleColorOwnershipConflict(draft, bindings, target.id)
			) {
				return;
			}
			const updates = sharedColorStyleUpdates(draft, bindings, color);
			if (!updates) return;
			const normalized = normalizeComponentPropDefinition({
				...target,
				defaultValue: { type: "color", value: color },
			});
			if (!normalized) return;
			const propChanged = target.defaultValue.value !== color;
			const styleChanged = [...updates.values()].some(
				(update) =>
					JSON.stringify(current(update.node).style) !==
					JSON.stringify(update.style),
			);
			if (!propChanged && !styleChanged) return;
			writePropLibrary(
				draft,
				props.map((prop) => (prop.id === propId ? normalized : prop)),
			);
			for (const update of updates.values()) {
				update.node.style = castDraft(update.style);
			}
		},
	};
}
