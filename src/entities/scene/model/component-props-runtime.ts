import {
	type BindablePropertySource,
	bindablePropertyById,
} from "./bindable-property";
import {
	bindableBindingTargetKey,
	type ComponentPropSharedNumberOwnershipView,
	componentPropBindingAnimatedConflict,
	componentPropSharedNumberOwnershipConflicts,
	componentPropSharedNumberValueIssues,
	componentPropStyleColorValueIssues,
	componentStyleOverrideClaimsColorTarget,
	isSharedNumberPropertyId,
	type MotionConflictView,
	readComponentProps,
	styleColorBindingTargetKey,
} from "./component-props";
import { findNode } from "./selectors";
import type {
	ComponentPropBinding,
	ComponentPropBindingBindable,
	ComponentPropDefinition,
	ComponentPropType,
	SceneDocument,
} from "./types";

/**
 * Pure component-prop RUNTIME compiler: resolves a document's authored
 * `componentProps` bindings into concrete write instructions against a
 * specific (already-projected or live) scene document. Originally built for
 * export (`buildComponentPropsExport`/`buildComponentPropsManifest`, still the
 * primary caller via the `features/export/model/component-props-export.ts`
 * re-export shim so every existing export call site keeps working unchanged);
 * also consumed directly by the editor's Interactive Motion preview
 * (`features/motion/model/interaction-preview.ts`) to resolve a `set-prop`
 * interaction action's `propName` into the same node-id + field-path
 * instruction shape, so the editor's live preview and every exported runtime
 * apply a `set-prop` action through IDENTICAL binding resolution — no
 * duplicated binding semantics between the editor and the shipped runtimes.
 *
 * Lives in `entities/scene/model` (not `features/export/model`, where it
 * originated) because it has no export-specific dependency: every import here
 * is entity-layer (`bindable-property.ts`, `component-props.ts`, `selectors.ts`,
 * `types.ts`). Moving it down let the editor-preview feature (which must not
 * import `features/export`, since features cannot import other features) reuse
 * it without duplicating `compileBinding`'s resolution rules.
 */

/**
 * One runtime-executable write instruction for a single component-prop binding,
 * resolved against a SPECIFIC (already-projected) scene document. Every variant
 * addresses its target by node id plus a fixed field path so the standalone
 * runtime (`RUNTIME_PLAYER_SOURCE` in `code.ts`, plain JS, no scene traversal
 * helpers available) can apply it with a node-id lookup and a couple of property
 * writes — it never re-derives eligibility, paint-stack legacy/rich indexing, or
 * bindable-property source semantics at runtime. All of that domain knowledge is
 * baked in here, at export time, once.
 *
 * `scene-field` covers `bindable` bindings whose descriptor source is
 * `scene-property` (`transform.*`, `style.opacity`, `geometry.cornerRadius`, …) —
 * the only `bindable` source kind whose runtime write is a plain nested-number-set
 * with no clamping/normalization/side-effects to reproduce (see
 * `bindablePropertySupportsRuntimeWrite` for why `effect-capability` sources are
 * excluded).
 *
 * `style-color-legacy`/`style-color-paint` split `style-color` bindings by the
 * same legacy-vs-rich-paint-list distinction `readAppearanceStack` already
 * resolves for the inspector: a node with no rich `fills`/`strokes` array stores
 * its single paint as a flat string (`node.style.fill`/`.stroke`); a node with a
 * rich list stores it as `node.style.fills[index].color`/`.strokes[index].color`.
 * Resolving which shape applies is export-time work so the runtime never needs
 * `readAppearanceStack`'s normalization logic.
 *
 * `text-content` covers `text-content` bindings: `node.geometry.text` is read
 * fresh every render call by the runtime's text renderer (verified: no baked
 * word-wrap/layout field depends on the original string), so a plain string
 * overwrite is sufficient.
 */
export type ComponentPropApplierInstruction =
	| {
			readonly kind: "scene-field";
			readonly nodeId: string;
			readonly fieldPath: readonly string[];
	  }
	| {
			readonly kind: "style-color-legacy";
			readonly nodeId: string;
			readonly field: "fill" | "stroke";
	  }
	| {
			readonly kind: "style-color-paint";
			readonly nodeId: string;
			readonly role: "fills" | "strokes";
			readonly index: number;
	  }
	| {
			readonly kind: "text-content";
			readonly nodeId: string;
	  };

/** One item the runtime exposes as `player.propSchema`. */
export type ComponentPropExportSchemaEntry = {
	readonly name: string;
	readonly type: ComponentPropType;
	readonly defaultValue: ComponentPropDefinition["defaultValue"];
	readonly min?: number;
	readonly max?: number;
	readonly step?: number;
	/**
	 * False when no binding for this prop produced a runtime-applicable
	 * instruction (every binding was dropped or the prop's own binding kind is
	 * not runtime-writable — currently only `text-content` bindings are always
	 * writable when present; a `number`/`color` prop with zero surviving
	 * instructions is still schema-visible but inert). `player.setProps` still
	 * accepts and stores the value (so a host reading `player.props` back sees
	 * what it set) but the value cannot move the render output.
	 */
	readonly supported: boolean;
};

/** One prop's compiled applier list, keyed by schema entry name. */
export type ComponentPropApplierEntry = {
	readonly name: string;
	readonly instructions: readonly ComponentPropApplierInstruction[];
};

/**
 * Reason one binding produced no runtime applier instruction, for the export
 * report. `"runtime-unsupported-source"` covers every fidelity-driven drop
 * (an `effect-capability`-sourced `bindable`, a non-solid `style-color`
 * target, or a `text-content` binding whose node is not actually a text
 * node) — text mutation itself is NOT a source of drops (confirmed
 * runtime-safe; see `applierForTextContent`), so there is no separate
 * text-specific reason. `"animated-conflict"` is checked FIRST, before the
 * fidelity checks that produce `"runtime-unsupported-source"` — a binding
 * whose target node+property already has a keyframe track is dropped for
 * that specific, more actionable reason even when it would otherwise have
 * compiled a valid instruction (see `compileBinding`). Shared values add
 * `number-contract-invalid` and `number-prop-peer-unsupported` so one broken
 * Rotation/Opacity binding drops its whole fan-out instead of partially moving
 * a component.
 */
export type ComponentPropExportIssueReason =
	| "node-pruned"
	| "runtime-unsupported-source"
	| "animated-conflict"
	| "ownership-conflict"
	| "color-default-invalid"
	| "default-pixel-mismatch"
	| "color-prop-peer-unsupported"
	| "number-contract-invalid"
	| "number-prop-peer-unsupported";

export type ComponentPropExportIssue = {
	readonly propName: string;
	readonly propId: string;
	readonly binding: ComponentPropBinding;
	readonly reason: ComponentPropExportIssueReason;
};

/** Runtime-usable component-prop payload block plus the export-time diagnostic trail. */
export type ComponentPropsExportResult = {
	readonly schema: readonly ComponentPropExportSchemaEntry[];
	readonly appliers: readonly ComponentPropApplierEntry[];
	readonly issues: readonly ComponentPropExportIssue[];
};

/**
 * A `bindable` component prop is only runtime-writable when its target
 * bindable-property descriptor declares native standalone-runtime support.
 * `scene-property`-sourced descriptors (`NATIVE_SCALAR_SUPPORT`,
 * `CORNER_RADIUS_SUPPORT` when `motionRuntimeJs` is `"native"`) are plain
 * node-field writes with no side effects. `effect-capability`-sourced
 * descriptors are declared `motionRuntimeJs: "side-car-only"` in the registry
 * itself (`effect-capabilities.ts`) — the canonical value lives in
 * `node.recipe`, addressed by a `RecipeControlPath` whose writer
 * (`updateRecipeControl`) clamps to the control's spec range and can trigger
 * secondary "activation" writes (e.g. setting `texture.material.angle` also
 * flips `fieldMode` to `"linear"`). Reproducing that generically in the plain-JS
 * standalone runtime would either skip those semantics (a silent correctness
 * gap) or require porting a large validated-write module into
 * `RUNTIME_PLAYER_SOURCE`, which has no imports. Both are out of scope for this
 * slice, so effect-capability-sourced bindings degrade honestly: schema-listed,
 * `supported:false`, reported as `runtime-unsupported-source`.
 */
function bindablePropertySupportsRuntimeWrite(propertyId: string): boolean {
	const descriptor = bindablePropertyById(propertyId);
	if (!descriptor) return false;
	if (descriptor.source.kind !== "scene-property") return false;
	return descriptor.support.motionRuntimeJs === "native";
}

const scenePropertyFieldPath = (
	path: Extract<
		BindablePropertySource,
		{ readonly kind: "scene-property" }
	>["path"],
): readonly string[] => path.split(".");

/**
 * Resolves one `bindable` binding into zero or one `scene-field` instruction.
 * Returns `null` (no issue — the binding target is fine, it is just not a
 * runtime-writable source) paired with a boolean the caller uses to decide
 * `supported`; the caller is responsible for turning "no instruction" into a
 * typed issue with the right reason.
 */
function applierForBindable(
	binding: Extract<ComponentPropBinding, { readonly kind: "bindable" }>,
): ComponentPropApplierInstruction | null {
	if (!bindablePropertySupportsRuntimeWrite(binding.propertyId)) return null;
	const descriptor = bindablePropertyById(binding.propertyId);
	if (descriptor?.source.kind !== "scene-property") return null;
	return {
		kind: "scene-field",
		nodeId: binding.nodeId,
		fieldPath: scenePropertyFieldPath(descriptor.source.path),
	};
}

/**
 * Resolves one `style-color` binding against the PROJECTED document's node,
 * choosing the legacy-flat-color vs. rich-paint-list instruction shape the same
 * way `readAppearanceStack`/`styleColorTargetIssue` already do (index 0 with no
 * rich list => legacy synthesized item; otherwise the array index). This
 * duplicates that indexing decision rather than importing `readAppearanceStack`
 * because the runtime does not need `AppearanceStack`'s full display shape —
 * only which of the two storage forms to write to — and this keeps the applier
 * builder's only appearance-stack dependency at read-only shape inspection.
 */
function applierForStyleColor(
	document: SceneDocument,
	binding: Extract<ComponentPropBinding, { readonly kind: "style-color" }>,
): ComponentPropApplierInstruction | null {
	const node = findNode(document, binding.nodeId);
	if (!node) return null;
	const role = binding.role === "fill" ? "fills" : "strokes";
	const paintIndex = binding.paintIndex ?? 0;
	const list = node.style[role];
	if (!list) {
		return {
			kind: "style-color-legacy",
			nodeId: binding.nodeId,
			field: binding.role,
		};
	}
	const paint = list[paintIndex];
	if (paint?.kind !== "solid") return null;
	return {
		kind: "style-color-paint",
		nodeId: binding.nodeId,
		role,
		index: paintIndex,
	};
}

/**
 * Resolves one `text-content` binding. Text mutation is confirmed runtime-safe:
 * `RUNTIME_PLAYER_SOURCE`'s `renderText` reads `geometry.text` fresh on every
 * render call (splits on `\n`, no cached/baked layout field derived from the
 * original string), so an overwrite of the payload's `geometry.text` string is
 * sufficient — this is the ONE binding kind whose runtime applier never degrades
 * for a fidelity reason (only for a missing/pruned node).
 */
function applierForTextContent(
	binding: Extract<ComponentPropBinding, { readonly kind: "text-content" }>,
): ComponentPropApplierInstruction {
	return { kind: "text-content", nodeId: binding.nodeId };
}

/**
 * Compiles ONE binding into an applier instruction or a typed drop reason,
 * checking node survival against the PROJECTED document first (a binding target
 * pruned by `projectSceneForExport` — e.g. a hidden node excluded from a
 * web-embed/production profile — must drop with `"node-pruned"`, never silently
 * vanish or throw at runtime), then a conflicting keyframe track (the SAME
 * `componentPropBindingAnimatedConflict` check `entities/scene/model
 * /component-props.ts` uses for its authoring-time warning — this call site is
 * the ENFORCING gate, since it always resolves against the final `motion`
 * document being shipped, unlike the authoring check which can go stale if a
 * track is added after the binding). A conflict drops the binding with
 * `"animated-conflict"` before the fidelity checks below run, even if the
 * binding would otherwise have compiled a valid instruction — see
 * `ComponentPropExportIssueReason`'s JSDoc.
 */
export function compileBinding(
	document: SceneDocument,
	motion: MotionConflictView,
	binding: ComponentPropBinding,
): ComponentPropApplierInstruction | ComponentPropExportIssueReason {
	const node = findNode(document, binding.nodeId);
	if (!node) return "node-pruned";
	if (componentPropBindingAnimatedConflict(binding, motion) !== undefined) {
		return "animated-conflict";
	}
	if (binding.kind === "bindable") {
		return applierForBindable(binding) ?? "runtime-unsupported-source";
	}
	if (binding.kind === "style-color") {
		return (
			applierForStyleColor(document, binding) ?? "runtime-unsupported-source"
		);
	}
	if (node.geometry.kind !== "text") return "runtime-unsupported-source";
	return applierForTextContent(binding);
}

const isInstruction = (
	value: ComponentPropApplierInstruction | ComponentPropExportIssueReason,
): value is ComponentPropApplierInstruction => typeof value !== "string";

/**
 * Compiles one component prop's binding list into its runtime instructions plus
 * any drop issues, resolved against `document` (callers pass the PROJECTED
 * scene — the same scene object that ends up in the payload — so pruned-node
 * detection matches what the shipped runtime will actually see) and `motion`
 * (callers pass the PROJECTED motion document for the same reason, so an
 * animated-conflict drop matches the keyframe tracks the shipped payload
 * actually carries).
 */
function compileComponentProp(
	document: SceneDocument,
	motion: MotionConflictView,
	prop: ComponentPropDefinition,
	ambiguousStyleColorTargets: ReadonlySet<string>,
	numberOwnershipDocument: ComponentPropSharedNumberOwnershipView,
): {
	readonly schema: ComponentPropExportSchemaEntry;
	readonly applier: ComponentPropApplierEntry;
	readonly issues: readonly ComponentPropExportIssue[];
} {
	const colorValueIssues = componentPropStyleColorValueIssues(prop, (nodeId) =>
		findNode(document, nodeId),
	);
	const colorDefaultInvalid = colorValueIssues.some(
		(issue) => issue.kind === "default-invalid",
	);
	const mismatchedColorTargets = new Set(
		colorValueIssues.flatMap((issue) =>
			issue.kind === "default-invalid"
				? []
				: [styleColorBindingTargetKey(issue.binding)],
		),
	);
	let compiled: Array<{
		readonly binding: ComponentPropBinding;
		readonly result:
			| ComponentPropApplierInstruction
			| ComponentPropExportIssueReason;
	}> = prop.bindings.map((binding) => ({
		binding,
		result:
			binding.kind === "style-color" &&
			ambiguousStyleColorTargets.has(styleColorBindingTargetKey(binding))
				? ("ownership-conflict" as const)
				: binding.kind === "style-color" && colorDefaultInvalid
					? ("color-default-invalid" as const)
					: binding.kind === "style-color" &&
							mismatchedColorTargets.has(styleColorBindingTargetKey(binding))
						? ("default-pixel-mismatch" as const)
						: compileBinding(document, motion, binding),
	}));
	if (
		prop.type === "color" &&
		compiled.some((entry) => !isInstruction(entry.result))
	) {
		compiled = compiled.map((entry) => ({
			...entry,
			result: isInstruction(entry.result)
				? ("color-prop-peer-unsupported" as const)
				: entry.result,
		}));
	}
	const sharedNumberBindings = prop.bindings.filter(
		(binding): binding is ComponentPropBindingBindable =>
			binding.kind === "bindable" &&
			isSharedNumberPropertyId(binding.propertyId),
	);
	if (sharedNumberBindings.length > 0) {
		const propertyId = sharedNumberBindings[0]?.propertyId;
		const invalidContract =
			prop.type !== "number" ||
			sharedNumberBindings.length !== prop.bindings.length ||
			!propertyId ||
			!isSharedNumberPropertyId(propertyId) ||
			sharedNumberBindings.some((binding) => binding.propertyId !== propertyId);
		const explicitReasons = new Map<string, ComponentPropExportIssueReason>();
		if (!invalidContract) {
			for (const binding of sharedNumberBindings) {
				if (
					componentPropSharedNumberOwnershipConflicts(
						numberOwnershipDocument,
						binding,
						prop.id,
					).length > 0
				) {
					explicitReasons.set(
						bindableBindingTargetKey(binding),
						"ownership-conflict",
					);
				}
			}
			for (const issue of componentPropSharedNumberValueIssues(prop, (nodeId) =>
				findNode(document, nodeId),
			)) {
				if (
					issue.kind === "range-contract-invalid" ||
					issue.kind === "default-out-of-range"
				) {
					for (const binding of sharedNumberBindings) {
						explicitReasons.set(
							bindableBindingTargetKey(binding),
							"number-contract-invalid",
						);
					}
				} else {
					explicitReasons.set(
						bindableBindingTargetKey(issue.binding),
						"default-pixel-mismatch",
					);
				}
			}
		}
		const hasBindingFailure = compiled.some(
			(entry) => !isInstruction(entry.result),
		);
		if (invalidContract || explicitReasons.size > 0 || hasBindingFailure) {
			compiled = compiled.map((entry) => {
				if (entry.binding.kind !== "bindable") {
					return { ...entry, result: "number-contract-invalid" as const };
				}
				const explicit = explicitReasons.get(
					bindableBindingTargetKey(entry.binding),
				);
				if (explicit) return { ...entry, result: explicit };
				if (!isInstruction(entry.result)) return entry;
				return {
					...entry,
					result: invalidContract
						? ("number-contract-invalid" as const)
						: ("number-prop-peer-unsupported" as const),
				};
			});
		}
	}
	const instructions = compiled
		.map((entry) => entry.result)
		.filter(isInstruction);
	const issues: ComponentPropExportIssue[] = compiled
		.filter(
			(
				entry,
			): entry is typeof entry & {
				readonly result: ComponentPropExportIssueReason;
			} => !isInstruction(entry.result),
		)
		.map((entry) => ({
			propName: prop.name,
			propId: prop.id,
			binding: entry.binding,
			reason: entry.result,
		}));
	return {
		schema: {
			name: prop.name,
			type: prop.type,
			defaultValue: prop.defaultValue,
			...(typeof prop.min === "number" ? { min: prop.min } : {}),
			...(typeof prop.max === "number" ? { max: prop.max } : {}),
			...(typeof prop.step === "number" ? { step: prop.step } : {}),
			supported: instructions.length > 0,
		},
		applier: { name: prop.name, instructions },
		issues,
	};
}

const ambiguousStyleColorTargetKeys = (
	props: readonly ComponentPropDefinition[],
	ownershipDocument: Pick<SceneDocument, "layers">,
): ReadonlySet<string> => {
	const counts = new Map<string, number>();
	for (const prop of props) {
		for (const binding of prop.bindings) {
			if (binding.kind !== "style-color") continue;
			const key = styleColorBindingTargetKey(binding);
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
	}
	const conflicts = new Set(
		[...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key),
	);
	for (const prop of props) {
		for (const binding of prop.bindings) {
			if (
				binding.kind === "style-color" &&
				componentStyleOverrideClaimsColorTarget(ownershipDocument, binding)
			) {
				conflicts.add(styleColorBindingTargetKey(binding));
			}
		}
	}
	return conflicts;
};

/**
 * Builds the runtime-usable `componentProps` payload block (schema + compiled
 * applier instructions) plus a typed issue trail, from a document's authored
 * `componentProps` library resolved against the PROJECTED scene and PROJECTED
 * motion document that will actually ship in this export (so pruned-node
 * drops and animated-conflict drops are accurate for the profile being
 * built). Pure and side-effect-free: safe to call once per export regardless
 * of profile, matching every other `project*ForExport` helper in this
 * feature. `ownershipDocument` is the unprojected source when export
 * optimization strips component-instance metadata: target survival still uses
 * `document`, while shared-color and Shared values ownership must remain
 * profile-stable.
 */
export function buildComponentPropsExport(
	document: SceneDocument,
	motion: MotionConflictView,
	ownershipDocument: ComponentPropSharedNumberOwnershipView = document,
): ComponentPropsExportResult {
	const props = readComponentProps(document);
	const ambiguousTargets = ambiguousStyleColorTargetKeys(
		props,
		ownershipDocument,
	);
	const numberOwnershipDocument: ComponentPropSharedNumberOwnershipView = {
		componentProps: ownershipDocument.componentProps,
		layers: ownershipDocument.layers,
		nativeExpressionBindings: ownershipDocument.nativeExpressionBindings,
		grammarTargetNodeIds:
			ownershipDocument.grammarTargetNodeIds ??
			new Set(
				motion.grammar?.bindings.flatMap((binding) => binding.targetIds) ?? [],
			),
	};
	const compiled = props.map((prop) =>
		compileComponentProp(
			document,
			motion,
			prop,
			ambiguousTargets,
			numberOwnershipDocument,
		),
	);
	return {
		schema: compiled.map((entry) => entry.schema),
		appliers: compiled.map((entry) => entry.applier),
		issues: compiled.flatMap((entry) => entry.issues),
	};
}

/**
 * One binding's manifest row: which node it targets and whether ANY runtime
 * can apply it. `reason` is present exactly when `supported` is `false`,
 * naming why this SPECIFIC binding was dropped (mirrors the payload-side
 * `ComponentPropExportIssue.reason` for the same binding — this is the
 * diagnostic-manifest surface for the same fact, kept per-binding rather than
 * on the prop-level schema entry because one prop can carry multiple
 * bindings with different drop reasons).
 */
export type ExportComponentPropManifestBinding = {
	readonly kind: ComponentPropBinding["kind"];
	readonly nodeId: string;
	readonly supported: boolean;
	readonly reason?: ComponentPropExportIssueReason;
};

/**
 * Per-runtime-family applicability for one prop. Both currently-shipping
 * runtime families read the SAME `componentProps.appliers` instruction format
 * compiled by `compileComponentProp` (see `webgl-player-runtime.ts`'s
 * `applyComponentPropInstruction`, ported line-for-line from
 * `RUNTIME_PLAYER_SOURCE`'s), so a prop is "native" in one family if and only
 * if it is "native" in the other — there is currently no binding kind
 * supported in exactly one runtime family. This type stays a per-runtime
 * record (not a single shared flag) because that invariant is a fact about
 * the current two runtimes, not a structural guarantee a THIRD future runtime
 * family must uphold.
 */
export type ExportComponentPropRuntimeSupport = {
	readonly motionCodeSvg: "native" | "unsupported";
	readonly webglPlayer: "native" | "unsupported";
};

/** One prop's manifest row: schema fields, its bindings, and per-runtime support. */
export type ExportComponentPropManifestEntry = {
	readonly id: string;
	readonly name: string;
	readonly type: ComponentPropType;
	readonly defaultValue: ComponentPropDefinition["defaultValue"];
	readonly min?: number;
	readonly max?: number;
	readonly step?: number;
	readonly bindings: readonly ExportComponentPropManifestBinding[];
	readonly runtimeSupport: ExportComponentPropRuntimeSupport;
};

/**
 * Diagnostic/tooling manifest for the document's `componentProps` library,
 * paired with (not a replacement for) the runtime-consumed `componentProps`
 * payload block `buildComponentPropsExport` produces. Where that block is the
 * MINIMAL instruction set a runtime executes, this manifest is the fuller
 * per-prop/per-binding/per-runtime-family picture a host, docs generator, or
 * MCP tool needs to introspect what an export supports without re-deriving it
 * from the applier instructions. Mirrors `ExportEffectCapabilitiesManifest`'s
 * shape and versioning convention (`effect-fidelity.ts`).
 */
export type ExportComponentPropsManifest = {
	readonly included: true;
	readonly contractVersion: 1;
	readonly propCount: number;
	readonly props: readonly ExportComponentPropManifestEntry[];
};

/**
 * Resolves one binding into its manifest row, reusing `compileBinding` (the
 * SAME resolution `compileComponentProp` uses for the runtime applier list)
 * so a binding's `supported` flag — and, when `false`, its `reason` — here
 * can never diverge from whether it actually produced a runtime instruction
 * and why not, including an animated-conflict drop, which resolves
 * `supported:false` + `reason:"animated-conflict"` here exactly like every
 * other drop reason resolves its own code.
 */
/**
 * Builds the `componentProps` diagnostic manifest from a document's authored
 * prop library resolved against the PROJECTED scene and PROJECTED motion
 * document (matching `buildComponentPropsExport`'s projected-document
 * contract, so a manifest built alongside a specific export's payload
 * reports the same pruned/dropped/animated-conflict bindings that payload's
 * `issues` trail reports). Every prop currently gets the SAME
 * `runtimeSupport` value in both runtime families — see
 * {@link ExportComponentPropRuntimeSupport}'s JSDoc for why that is a fact
 * about the current runtimes, not hard-coded here as an assumption: it is
 * derived per-prop from whether the prop compiled at least one applier
 * instruction, independently for each family (identically today because both
 * families execute the same instruction format). Pass the unprojected source
 * as `ownershipDocument` when the projected document has stripped component
 * metadata, matching {@link buildComponentPropsExport}.
 */
export function buildComponentPropsManifest(
	document: SceneDocument,
	motion: MotionConflictView,
	ownershipDocument: ComponentPropSharedNumberOwnershipView = document,
): ExportComponentPropsManifest {
	const props = readComponentProps(document);
	const ambiguousTargets = ambiguousStyleColorTargetKeys(
		props,
		ownershipDocument,
	);
	const numberOwnershipDocument: ComponentPropSharedNumberOwnershipView = {
		componentProps: ownershipDocument.componentProps,
		layers: ownershipDocument.layers,
		nativeExpressionBindings: ownershipDocument.nativeExpressionBindings,
		grammarTargetNodeIds:
			ownershipDocument.grammarTargetNodeIds ??
			new Set(
				motion.grammar?.bindings.flatMap((binding) => binding.targetIds) ?? [],
			),
	};
	const entries = props.map((prop): ExportComponentPropManifestEntry => {
		const compiled = compileComponentProp(
			document,
			motion,
			prop,
			ambiguousTargets,
			numberOwnershipDocument,
		);
		const bindings = prop.bindings.map((binding) => {
			const issue = compiled.issues.find(
				(candidate) => candidate.binding === binding,
			);
			return issue
				? {
						kind: binding.kind,
						nodeId: binding.nodeId,
						supported: false as const,
						reason: issue.reason,
					}
				: {
						kind: binding.kind,
						nodeId: binding.nodeId,
						supported: true as const,
					};
		});
		const supported = compiled.schema.supported;
		const tier: "native" | "unsupported" = supported ? "native" : "unsupported";
		return {
			id: prop.id,
			name: prop.name,
			type: prop.type,
			defaultValue: prop.defaultValue,
			...(typeof prop.min === "number" ? { min: prop.min } : {}),
			...(typeof prop.max === "number" ? { max: prop.max } : {}),
			...(typeof prop.step === "number" ? { step: prop.step } : {}),
			bindings,
			runtimeSupport: { motionCodeSvg: tier, webglPlayer: tier },
		};
	});
	return {
		included: true,
		contractVersion: 1,
		propCount: entries.length,
		props: entries,
	};
}
