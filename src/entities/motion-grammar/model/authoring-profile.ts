import type { MotionTimingTemplateId } from "@/entities/motion/model/easing";
import { MOTION_EXPRESSION_VERSION_PARAM_KEY } from "./expression-definition";
import {
	findActiveVersionedMotionExpressionDefinition,
	motionExpressionBindingState,
} from "./expression-registry";
import type {
	MotionGrammarBinding,
	MotionGrammarParamSpec,
	MotionGrammarTechniqueId,
} from "./types";
import { motionGrammarParameterSpecsForBinding } from "./versioned-expression-binding";

export type MotionGrammarAuthoringProfileKind =
	| "master-instances"
	| "source-followers"
	| "presentation-duplicates"
	| "baked-tracks";

export type MotionGrammarAuthoringTimelineMode =
	| "trackless-expression"
	| "scalar-tracks"
	| "presentation-only";

export type MotionGrammarAuthoringBakePolicy =
	| "explicit-command"
	| "not-supported";

export type MotionGrammarAuthoringExpansionMode =
	| "live-only"
	| "editable-motion"
	| "editable-nodes"
	| "specialized-artifacts";

export type MotionGrammarAuthoringExpansionCapability = {
	readonly mode: MotionGrammarAuthoringExpansionMode;
	readonly label: string;
	readonly actionLabel: string;
	readonly previewLabel: string;
	readonly description: string;
	readonly outputSummary: string;
};

export type MotionGrammarAuthoringParameterRole =
	| "timing"
	| "layout"
	| "motion"
	| "look"
	| "debug";

export type MotionGrammarAuthoringInstanceKind =
	| "master"
	| "body"
	| "satellite"
	| "source"
	| "follower"
	| "artifact";

/**
 * Durable role-slot target category. Scene nodes are editable document objects,
 * generated scene nodes are support objects owned by a technique, and
 * presentation artifacts are runtime-only draw products such as Afterimage
 * echoes that must not be treated as layer-panel nodes.
 */
export type MotionGrammarAuthoringInstanceReference =
	| {
			readonly kind: "scene-node";
			readonly nodeId: string;
	  }
	| {
			readonly kind: "generated-scene-node";
			readonly nodeId: string;
	  }
	| {
			readonly kind: "presentation-artifact";
			readonly artifactId: string;
			readonly sourceNodeId?: string;
			readonly lifecycle: "clip-local" | "runtime-evaluated";
	  };

export type MotionGrammarAuthoringParameterSpec = MotionGrammarParamSpec & {
	readonly role: MotionGrammarAuthoringParameterRole;
	readonly advanced?: boolean;
};

export type MotionGrammarAuthoringParameterGroup = {
	readonly id: string;
	readonly label: string;
	readonly intent: string;
	readonly parameters: readonly MotionGrammarAuthoringParameterSpec[];
};

export type MotionGrammarAuthoringInstanceDescriptor = {
	readonly index: number;
	readonly slotId: string;
	readonly reference: MotionGrammarAuthoringInstanceReference;
	readonly nodeId: string;
	readonly role: string;
	readonly roleLabel: string;
	readonly kind: MotionGrammarAuthoringInstanceKind;
	readonly editable: boolean;
	readonly replaceable: boolean;
	readonly sourceProfileIndex?: number;
	readonly delayFrames?: number;
	readonly offset?: {
		readonly x: number;
		readonly y: number;
	};
};

export type MotionGrammarAuthoringLookHookDescriptor = {
	readonly id: string;
	readonly label: string;
	readonly capabilityId: string;
	readonly targetScope: "node" | "artboard" | "scene";
	readonly targetRoleId?: string;
	readonly parameterKey?: string;
	readonly outputChannel?: "recipeOverride";
};

/**
 * Semantic timing vocabulary consumed by an expression/profile authoring surface.
 * `parameterKeys` names the numeric controls this template explains; the template
 * id itself is code-owned and not serialized into `MotionGrammarBinding`.
 */
export type MotionGrammarAuthoringTimingTemplateDescriptor = {
	readonly templateId: MotionTimingTemplateId;
	readonly role: string;
	readonly note: string;
	readonly parameterKeys?: readonly string[];
};

/** Declarative non-numeric profile editor projected into the generic Inspector. */
export type MotionGrammarAuthoringProfileControl = {
	readonly kind: "random-pulse-envelope";
	readonly label: string;
	readonly description: string;
};

export type MotionGrammarAuthoringProfileDescriptor = {
	readonly bindingId: string;
	readonly techniqueId: MotionGrammarTechniqueId;
	readonly label: string;
	readonly summary: string;
	readonly kind: MotionGrammarAuthoringProfileKind;
	readonly timeline: {
		readonly mode: MotionGrammarAuthoringTimelineMode;
		readonly bakePolicy: MotionGrammarAuthoringBakePolicy;
		readonly clipLabel?: string;
		/**
		 * Binding parameter that must stay synchronized with the authoring clip's
		 * duration. Omitted profiles can still trim clips without semantic retiming.
		 */
		readonly durationParameterKey?: string;
	};
	readonly expansion: MotionGrammarAuthoringExpansionCapability;
	readonly parameterGroups: readonly MotionGrammarAuthoringParameterGroup[];
	readonly profileControls?: readonly MotionGrammarAuthoringProfileControl[];
	/** Optional binding-level seed control; unlike numeric parameters this writes `MotionGrammarBinding.seed`. */
	readonly seedControl?: MotionGrammarAuthoringParameterSpec;
	readonly instances: readonly MotionGrammarAuthoringInstanceDescriptor[];
	readonly lookHooks?: readonly MotionGrammarAuthoringLookHookDescriptor[];
	readonly timingTemplates?: readonly MotionGrammarAuthoringTimingTemplateDescriptor[];
	readonly recipeRoles?: readonly string[];
	/**
	 * Explicit role-slot list for future replacement/map UI. Kept alongside
	 * `instances` while existing Inspector surfaces still consume the legacy name.
	 */
	readonly roleSlots: readonly MotionGrammarAuthoringInstanceDescriptor[];
};

export type MotionGrammarAuthoringParameterPatchIssueCode =
	| "unknown-parameter"
	| "non-finite-parameter"
	| "clamped-parameter";

export type MotionGrammarAuthoringParameterPatchIssue = {
	readonly code: MotionGrammarAuthoringParameterPatchIssueCode;
	readonly key: string;
	readonly message: string;
};

export type MotionGrammarAuthoringParameterPatchResult = {
	readonly parameters: Readonly<Record<string, number>>;
	readonly changed: boolean;
	readonly issues: readonly MotionGrammarAuthoringParameterPatchIssue[];
};

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

const clamp = (value: number, min: number, max: number): number =>
	Math.min(Math.max(value, min), max);

const catalogSpecsByKey = (
	binding: MotionGrammarBinding,
): Map<string, MotionGrammarParamSpec> => {
	const specs = new Map<string, MotionGrammarParamSpec>();
	for (const spec of motionGrammarParameterSpecsForBinding(binding)) {
		specs.set(spec.key, spec);
	}
	return specs;
};

const descriptorSpecsByKey = (
	descriptor: MotionGrammarAuthoringProfileDescriptor | undefined,
): Map<string, MotionGrammarParamSpec> => {
	const specs = new Map<string, MotionGrammarParamSpec>();
	for (const group of descriptor?.parameterGroups ?? []) {
		for (const spec of group.parameters) specs.set(spec.key, spec);
	}
	return specs;
};

/**
 * Semantic profiles are complete only for an active versioned expression. A
 * legacy binding may also have a profile descriptor, but its historical catalog
 * controls remain part of its durable contract. Merge those controls so a newer
 * Inspector profile cannot make existing legacy parameters unreachable.
 */
const authoringSpecsByKey = (
	binding: MotionGrammarBinding,
	descriptor: MotionGrammarAuthoringProfileDescriptor | undefined,
): Map<string, MotionGrammarParamSpec> => {
	if (
		motionExpressionBindingState(binding.techniqueId, binding.parameters) ===
		"unsupported"
	) {
		return new Map();
	}
	const catalogSpecs = catalogSpecsByKey(binding);
	if (
		findActiveVersionedMotionExpressionDefinition(
			binding.techniqueId,
			binding.parameters,
		)
	) {
		return descriptor ? descriptorSpecsByKey(descriptor) : catalogSpecs;
	}
	for (const [key, spec] of descriptorSpecsByKey(descriptor)) {
		catalogSpecs.set(key, spec);
	}
	return catalogSpecs;
};

/**
 * Returns the parameter keys a semantic authoring surface is allowed to mutate.
 * A semantic profile is its complete authoring surface. Generic/legacy
 * bindings instead use their binding-aware catalog contract, which keeps a
 * legacy technique id from exposing parameters for a newer versioned law.
 */
export function motionGrammarAuthoringParameterKeys({
	binding,
	descriptor,
}: {
	readonly binding: MotionGrammarBinding;
	readonly descriptor?: MotionGrammarAuthoringProfileDescriptor;
}): readonly string[] {
	const keys = new Set<string>(authoringSpecsByKey(binding, descriptor).keys());
	// The expression version rides as a reserved binding parameter; it is never an
	// authorable control and must not surface in the Inspector.
	keys.delete(MOTION_EXPRESSION_VERSION_PARAM_KEY);
	return [...keys];
}

/**
 * Normalizes an AI/UI-authored numeric parameter patch against the binding's
 * declared authoring surface. Unknown keys are rejected instead of being written
 * into the durable binding, while known numeric values are clamped to their
 * declared authoring envelope.
 */
export function normalizeMotionGrammarAuthoringParameterPatch({
	binding,
	descriptor,
	patch,
}: {
	readonly binding: MotionGrammarBinding;
	readonly descriptor?: MotionGrammarAuthoringProfileDescriptor;
	readonly patch: Readonly<Record<string, unknown>>;
}): MotionGrammarAuthoringParameterPatchResult {
	const specs = authoringSpecsByKey(binding, descriptor);

	const parameters: Record<string, number> = {};
	const issues: MotionGrammarAuthoringParameterPatchIssue[] = [];
	let changed = false;
	for (const [key, value] of Object.entries(patch)) {
		// The reserved expression-version key is runtime-managed, never authorable:
		// drop it silently rather than reporting it as an unknown parameter.
		if (key === MOTION_EXPRESSION_VERSION_PARAM_KEY) continue;
		const spec = specs.get(key);
		if (!spec) {
			issues.push({
				code: "unknown-parameter",
				key,
				message: `Motion grammar parameter "${key}" is not exposed by the authoring profile.`,
			});
			continue;
		}
		if (!isFiniteNumber(value)) {
			issues.push({
				code: "non-finite-parameter",
				key,
				message: `Motion grammar parameter "${key}" must be a finite number.`,
			});
			continue;
		}
		const nextValue = clamp(value, spec.min, spec.max);
		if (nextValue !== value) {
			issues.push({
				code: "clamped-parameter",
				key,
				message: `Motion grammar parameter "${key}" was clamped to ${nextValue}.`,
			});
		}
		parameters[key] = nextValue;
		if (binding.parameters[key] !== nextValue) changed = true;
	}
	return { parameters, changed, issues };
}
