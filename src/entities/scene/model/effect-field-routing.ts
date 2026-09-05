import {
	type EffectInfluence,
	type EffectInfluenceAssignment,
	type EffectInfluenceRecipe,
	type EffectInfluenceRecipeDraft,
	type EffectMaskSource,
	type EffectMaskSourceKind,
	type EffectMaskSpace,
	type EffectSlotRef,
	type EffectTargetRef,
	type EffectTargetScope,
	normalizeEffectInfluenceRecipe,
} from "@/shared/vec-core";

/** Stable product surfaces on which an Effect Field route may be consumed. */
export type EffectFieldRenderSurface =
	| "editor-svg"
	| "svg-export"
	| "worker-svg"
	| "runtime-svg"
	| "webgl"
	| "webgpu"
	| "webm-capture";

/** Honest support vocabulary shared by field compilers and renderer adapters. */
export type EffectFieldFidelityStatus =
	| "native"
	| "approximated"
	| "capture-only"
	| "side-car-only"
	| "deferred"
	| "unsupported";

export type EffectFieldFidelity = {
	readonly status: EffectFieldFidelityStatus;
	readonly reason?: string;
};

/** How a normalized matte changes the registered owner. */
export type EffectFieldRouteOperator =
	| "alpha-multiply"
	| "effect-wet-mix"
	| "mask-feather"
	| "stroke-softness"
	| "silhouette-alpha-softness";

export type EffectFieldOutwardPaddingRule =
	| { readonly kind: "none" }
	| { readonly kind: "blur-radius" }
	| { readonly kind: "owner-defined" };

/**
 * Stable, renderer-neutral descriptor for one field-routable owner. New owners
 * register here; the routing compiler does not branch on artwork or effect names.
 */
export type EffectFieldTargetDescriptor = {
	readonly id: string;
	readonly effectPath: string;
	readonly label: string;
	readonly owner:
		| "node-style"
		| "node-effect"
		| "look"
		| "mask-relation"
		| "presentation";
	readonly targetScopes: readonly EffectTargetScope[];
	readonly coordinateSpaces: readonly EffectMaskSpace[];
	readonly unit: "normalized" | "scene-px";
	readonly range: readonly [number, number];
	readonly neutralValue: number;
	readonly operator: EffectFieldRouteOperator;
	readonly eligibleSourceKinds: readonly EffectMaskSourceKind[];
	readonly outwardPadding: EffectFieldOutwardPaddingRule;
	readonly keyframable: boolean;
	readonly support: Readonly<
		Record<EffectFieldRenderSurface, EffectFieldFidelity>
	>;
	readonly disabledReason?: string;
};

export type EffectFieldTargetRegistryIssue = {
	readonly code: "duplicate-descriptor-id" | "duplicate-effect-path";
	readonly value: string;
};

export type EffectFieldTargetRegistry = {
	readonly descriptors: readonly EffectFieldTargetDescriptor[];
	readonly byId: ReadonlyMap<string, EffectFieldTargetDescriptor>;
	readonly byPath: ReadonlyMap<string, EffectFieldTargetDescriptor>;
	readonly issues: readonly EffectFieldTargetRegistryIssue[];
};

const FIELD_SOURCE_KINDS = [
	"fullFrame",
	"rect",
	"ellipse",
	"polygon",
	"linearGradient",
	"radialGradient",
	"contourGradient",
	"fieldMesh",
	"proceduralNoise",
	"stack",
] as const satisfies readonly EffectMaskSourceKind[];

const effectFieldSourceTree = (
	source: EffectMaskSource,
): readonly EffectMaskSource[] =>
	source.kind === "stack"
		? [
				source,
				...source.items.flatMap((item) =>
					item.enabled && item.strength > 0
						? effectFieldSourceTree(item.source)
						: [],
				),
			]
		: [source];

const effectFieldInfluenceTree = (
	influence: EffectInfluence,
): readonly EffectInfluence[] =>
	influence.source.kind === "stack"
		? [
				influence,
				...influence.source.items.flatMap((item) =>
					item.enabled && item.strength > 0
						? effectFieldInfluenceTree(item)
						: [],
				),
			]
		: [influence];

const NATIVE_SVG_SUPPORT = {
	"editor-svg": { status: "native" },
	"svg-export": { status: "native" },
	"worker-svg": { status: "native" },
	"runtime-svg": {
		status: "side-car-only",
		reason:
			"the generated standalone runtime sampler must be regenerated before it can consume the new route",
	},
	webgl: {
		status: "deferred",
		reason: "the direct GPU display-list path has no field-matte pass",
	},
	webgpu: { status: "native" },
	"webm-capture": {
		status: "capture-only",
		reason:
			"the route is preserved through the SVG capture path rather than a native video effect",
	},
} as const satisfies Readonly<
	Record<EffectFieldRenderSurface, EffectFieldFidelity>
>;

const DEFERRED_OWNER_SUPPORT = {
	"editor-svg": {
		status: "deferred",
		reason: "the canonical owner is registered but has no field adapter",
	},
	"svg-export": {
		status: "deferred",
		reason: "the canonical owner is registered but has no field adapter",
	},
	"worker-svg": {
		status: "deferred",
		reason: "the canonical owner is registered but has no field adapter",
	},
	"runtime-svg": {
		status: "side-car-only",
		reason: "the route remains serialized without a standalone runtime adapter",
	},
	webgl: {
		status: "deferred",
		reason: "the direct GPU display-list path has no field-matte pass",
	},
	webgpu: {
		status: "deferred",
		reason: "the canonical owner has no generic GPU effect-island adapter",
	},
	"webm-capture": {
		status: "deferred",
		reason:
			"capture cannot claim a route that the presentation renderer cannot apply",
	},
} as const satisfies Readonly<
	Record<EffectFieldRenderSurface, EffectFieldFidelity>
>;

const APPROXIMATED_SVG_SUPPORT = {
	"editor-svg": {
		status: "approximated",
		reason: "the canonical owner uses Vecmo's SVG glow approximation",
	},
	"svg-export": {
		status: "approximated",
		reason: "the canonical owner uses Vecmo's SVG glow approximation",
	},
	"worker-svg": {
		status: "approximated",
		reason: "the canonical owner uses Vecmo's SVG glow approximation",
	},
	"runtime-svg": {
		status: "side-car-only",
		reason:
			"the generated standalone runtime sampler must be regenerated before it can consume the new route",
	},
	webgl: {
		status: "deferred",
		reason: "the direct GPU display-list path has no field-matte pass",
	},
	webgpu: {
		status: "approximated",
		reason:
			"the canonical owner uses the bounded GPU effect-island approximation",
	},
	"webm-capture": {
		status: "capture-only",
		reason:
			"the route is preserved through the SVG capture path rather than a native video effect",
	},
} as const satisfies Readonly<
	Record<EffectFieldRenderSurface, EffectFieldFidelity>
>;

/** Built-in descriptors point only at existing canonical owners. */
export const EFFECT_FIELD_TARGET_DESCRIPTORS = [
	{
		id: "style.opacity",
		effectPath: "style.opacity",
		label: "Opacity",
		owner: "node-style",
		targetScopes: ["object", "group"],
		coordinateSpaces: ["target", "objectBoundingBox"],
		unit: "normalized",
		range: [0, 1],
		neutralValue: 1,
		operator: "alpha-multiply",
		eligibleSourceKinds: FIELD_SOURCE_KINDS,
		outwardPadding: { kind: "none" },
		keyframable: true,
		support: NATIVE_SVG_SUPPORT,
	},
	{
		id: "style.effects.layer-blur",
		effectPath: "style.effects.layer-blur",
		label: "Layer blur wet mix",
		owner: "node-effect",
		targetScopes: ["object", "group"],
		coordinateSpaces: ["target", "objectBoundingBox"],
		unit: "normalized",
		range: [0, 1],
		neutralValue: 1,
		operator: "effect-wet-mix",
		eligibleSourceKinds: FIELD_SOURCE_KINDS,
		outwardPadding: { kind: "blur-radius" },
		keyframable: true,
		support: NATIVE_SVG_SUPPORT,
	},
	{
		id: "recipe.glow.bloom",
		effectPath: "recipe.glow.bloom",
		label: "Glow wet mix",
		owner: "look",
		targetScopes: ["object", "group"],
		coordinateSpaces: ["target", "objectBoundingBox"],
		unit: "normalized",
		range: [0, 1],
		neutralValue: 1,
		operator: "effect-wet-mix",
		eligibleSourceKinds: FIELD_SOURCE_KINDS,
		outwardPadding: { kind: "owner-defined" },
		keyframable: true,
		support: APPROXIMATED_SVG_SUPPORT,
	},
	{
		id: "appearance.mask.featherRadius",
		effectPath: "appearance.mask.featherRadius",
		label: "Mask feather",
		owner: "mask-relation",
		targetScopes: ["object", "group"],
		coordinateSpaces: ["target", "objectBoundingBox"],
		unit: "scene-px",
		range: [0, 1_000_000],
		neutralValue: 0,
		operator: "mask-feather",
		eligibleSourceKinds: FIELD_SOURCE_KINDS,
		outwardPadding: { kind: "owner-defined" },
		keyframable: false,
		support: DEFERRED_OWNER_SUPPORT,
	},
	{
		id: "style.strokeSoftness.blurRadius",
		effectPath: "style.strokeSoftness.blurRadius",
		label: "Stroke softness",
		owner: "node-style",
		targetScopes: ["object", "group"],
		coordinateSpaces: ["target", "objectBoundingBox"],
		unit: "scene-px",
		range: [0, 1_000_000],
		neutralValue: 0,
		operator: "stroke-softness",
		eligibleSourceKinds: FIELD_SOURCE_KINDS,
		outwardPadding: { kind: "owner-defined" },
		keyframable: false,
		support: DEFERRED_OWNER_SUPPORT,
	},
	{
		id: "appearance.silhouetteAlphaSoftness",
		effectPath: "appearance.silhouetteAlphaSoftness",
		label: "Silhouette alpha softness",
		owner: "presentation",
		targetScopes: ["object", "group"],
		coordinateSpaces: ["target", "objectBoundingBox"],
		unit: "scene-px",
		range: [0, 1_000_000],
		neutralValue: 0,
		operator: "silhouette-alpha-softness",
		eligibleSourceKinds: FIELD_SOURCE_KINDS,
		outwardPadding: { kind: "owner-defined" },
		keyframable: false,
		support: DEFERRED_OWNER_SUPPORT,
		disabledReason:
			"no canonical silhouette-alpha softness owner exists in the scene model",
	},
] as const satisfies readonly EffectFieldTargetDescriptor[];

/**
 * Builds an immutable lookup and removes every ambiguous descriptor from both
 * maps. Duplicate ids and duplicate paths therefore never acquire a first-wins
 * meaning.
 */
export function createEffectFieldTargetRegistry(
	descriptors: readonly EffectFieldTargetDescriptor[] = EFFECT_FIELD_TARGET_DESCRIPTORS,
): EffectFieldTargetRegistry {
	const idCounts = new Map<string, number>();
	const pathCounts = new Map<string, number>();
	for (const descriptor of descriptors) {
		idCounts.set(descriptor.id, (idCounts.get(descriptor.id) ?? 0) + 1);
		pathCounts.set(
			descriptor.effectPath,
			(pathCounts.get(descriptor.effectPath) ?? 0) + 1,
		);
	}
	const issues: EffectFieldTargetRegistryIssue[] = [];
	for (const [value, count] of idCounts) {
		if (count > 1) issues.push({ code: "duplicate-descriptor-id", value });
	}
	for (const [value, count] of pathCounts) {
		if (count > 1) issues.push({ code: "duplicate-effect-path", value });
	}
	const byId = new Map<string, EffectFieldTargetDescriptor>();
	const byPath = new Map<string, EffectFieldTargetDescriptor>();
	for (const descriptor of descriptors) {
		if (
			idCounts.get(descriptor.id) !== 1 ||
			pathCounts.get(descriptor.effectPath) !== 1
		) {
			continue;
		}
		byId.set(descriptor.id, descriptor);
		byPath.set(descriptor.effectPath, descriptor);
	}
	return { descriptors, byId, byPath, issues };
}

export const EFFECT_FIELD_TARGET_REGISTRY = createEffectFieldTargetRegistry();

export type EffectFieldRouteIssueCode =
	| "duplicate-assignment-id"
	| "duplicate-field-id"
	| "duplicate-active-route"
	| "unknown-target-descriptor"
	| "ambiguous-target-descriptor"
	| "target-id-missing"
	| "target-scope-unsupported"
	| "field-reference-missing"
	| "field-reference-ambiguous"
	| "source-kind-unsupported"
	| "source-space-unsupported";

export type EffectFieldRouteIssue = {
	readonly code: EffectFieldRouteIssueCode;
	readonly assignmentId?: string;
	readonly fieldId?: string;
	readonly routeKey?: string;
	readonly detail: string;
};

export type EffectFieldRoutePlan = {
	readonly assignmentId: string;
	readonly fieldId?: string;
	readonly target: EffectTargetRef;
	readonly effect: EffectSlotRef;
	readonly descriptorId: string;
	readonly operator: EffectFieldRouteOperator;
	readonly source: EffectMaskSource;
	readonly sourceOrigin: "shared-field" | "inline" | "inline-fallback";
	readonly influence: EffectInfluence;
	readonly surface: EffectFieldRenderSurface;
	readonly fidelity: EffectFieldFidelity;
	readonly routeKey: string;
};

export type EffectFieldRoutingPlan = {
	readonly routes: readonly EffectFieldRoutePlan[];
	readonly issues: readonly EffectFieldRouteIssue[];
};

export type CompileEffectFieldRoutesOptions = {
	readonly surface: EffectFieldRenderSurface;
	readonly registry?: EffectFieldTargetRegistry;
	readonly target?: EffectTargetRef;
};

const targetKey = (target: EffectTargetRef): string =>
	`${target.scope}:${target.id ?? ""}`;

const sameTarget = (left: EffectTargetRef, right: EffectTargetRef): boolean =>
	left.scope === right.scope && left.id === right.id;

const descriptorForSlot = (
	registry: EffectFieldTargetRegistry,
	slot: EffectSlotRef,
): EffectFieldTargetDescriptor | "ambiguous" | null => {
	const matches = new Set<EffectFieldTargetDescriptor>();
	const byId = registry.byId.get(slot.id);
	const byPath = registry.byPath.get(slot.path);
	if (byId) matches.add(byId);
	if (byPath) matches.add(byPath);
	if (matches.size > 1) return "ambiguous";
	return [...matches][0] ?? null;
};

const routeFidelity = (
	descriptor: EffectFieldTargetDescriptor,
	surface: EffectFieldRenderSurface,
	assignment: EffectInfluenceAssignment,
	sourceOrigin: EffectFieldRoutePlan["sourceOrigin"],
	source: EffectMaskSource,
): EffectFieldFidelity => {
	if (descriptor.disabledReason) {
		return { status: "unsupported", reason: descriptor.disabledReason };
	}
	const base = descriptor.support[surface];
	if (base.status === "native" || base.status === "approximated") {
		const sources = effectFieldSourceTree(source);
		const influences = effectFieldInfluenceTree({
			...assignment.influence,
			source,
		});
		const approximationReasons = [
			...(base.status === "approximated" && base.reason ? [base.reason] : []),
			...(sourceOrigin === "inline-fallback"
				? [
						"the linked field was unavailable, so the last valid inline snapshot was rendered",
					]
				: []),
			...(influences.some((influence) => influence.falloff.kind !== "linear")
				? ["non-linear falloff is sampled into an SVG transfer table"]
				: []),
			...(sources.some((candidate) => candidate.kind === "contourGradient")
				? ["the contour distance ramp is sampled into SVG morphology shells"]
				: []),
			...(sources.some((candidate) => candidate.kind === "fieldMesh")
				? ["the editable field mesh is rasterized at bounded review resolution"]
				: []),
		];
		if (approximationReasons.length === 0) return base;
		return {
			status: "approximated",
			reason: approximationReasons.join("; "),
		};
	}
	return base;
};

const countsBy = <T>(
	values: readonly T[],
	key: (value: T) => string,
): ReadonlyMap<string, number> => {
	const counts = new Map<string, number>();
	for (const value of values) {
		const id = key(value);
		counts.set(id, (counts.get(id) ?? 0) + 1);
	}
	return counts;
};

/**
 * Resolves every active assignment into a typed route. Ambiguous ids and
 * duplicate target/slot routes are rejected as sets; assignment order is never
 * used as hidden priority.
 */
export function compileEffectFieldRoutes(
	recipeDraft:
		| EffectInfluenceRecipeDraft
		| EffectInfluenceRecipe
		| null
		| undefined,
	options: CompileEffectFieldRoutesOptions,
): EffectFieldRoutingPlan {
	const recipe = normalizeEffectInfluenceRecipe(recipeDraft ?? undefined);
	if (!recipe.enabled) return { routes: [], issues: [] };
	const registry = options.registry ?? EFFECT_FIELD_TARGET_REGISTRY;
	const issues: EffectFieldRouteIssue[] = [];
	const activeAssignments = recipe.assignments.filter(
		(assignment) =>
			assignment.influence.enabled &&
			assignment.influence.strength > 0 &&
			(!options.target || sameTarget(assignment.target, options.target)),
	);
	const assignmentCounts = countsBy(
		activeAssignments,
		(assignment) => assignment.id,
	);
	const fieldCounts = countsBy(recipe.fields ?? [], (field) => field.id);
	for (const [assignmentId, count] of assignmentCounts) {
		if (count > 1) {
			issues.push({
				code: "duplicate-assignment-id",
				assignmentId,
				detail: `active assignment id "${assignmentId}" occurs ${count} times`,
			});
		}
	}
	for (const [fieldId, count] of fieldCounts) {
		if (count > 1) {
			issues.push({
				code: "duplicate-field-id",
				fieldId,
				detail: `field id "${fieldId}" occurs ${count} times`,
			});
		}
	}

	const candidates: EffectFieldRoutePlan[] = [];
	for (const assignment of activeAssignments) {
		if (assignmentCounts.get(assignment.id) !== 1) continue;
		if (
			assignment.target.scope !== "scene" &&
			assignment.target.scope !== "selection" &&
			assignment.target.id === undefined
		) {
			issues.push({
				code: "target-id-missing",
				assignmentId: assignment.id,
				detail: `${assignment.target.scope} field targets require an explicit id`,
			});
			continue;
		}
		const descriptor = descriptorForSlot(registry, assignment.effect);
		if (!descriptor) {
			issues.push({
				code: "unknown-target-descriptor",
				assignmentId: assignment.id,
				detail: `no field target matches slot "${assignment.effect.id}" at "${assignment.effect.path}"`,
			});
			continue;
		}
		if (descriptor === "ambiguous") {
			issues.push({
				code: "ambiguous-target-descriptor",
				assignmentId: assignment.id,
				detail: `slot id and path resolve to different field targets`,
			});
			continue;
		}
		if (!descriptor.targetScopes.includes(assignment.target.scope)) {
			issues.push({
				code: "target-scope-unsupported",
				assignmentId: assignment.id,
				detail: `${descriptor.id} cannot target ${assignment.target.scope}`,
			});
			continue;
		}
		let source = assignment.influence.source;
		let sourceOrigin: EffectFieldRoutePlan["sourceOrigin"] = "inline";
		if (assignment.fieldId) {
			const fields = (recipe.fields ?? []).filter(
				(field) => field.id === assignment.fieldId,
			);
			if (fields.length === 1 && fields[0]) {
				source = fields[0].source;
				sourceOrigin = "shared-field";
			} else {
				sourceOrigin = "inline-fallback";
				issues.push({
					code:
						fields.length === 0
							? "field-reference-missing"
							: "field-reference-ambiguous",
					assignmentId: assignment.id,
					fieldId: assignment.fieldId,
					detail:
						fields.length === 0
							? `linked field "${assignment.fieldId}" is missing; inline fallback retained`
							: `linked field "${assignment.fieldId}" is duplicated; inline fallback retained`,
				});
			}
		}
		const sourceTree = effectFieldSourceTree(source);
		const unsupportedSource = sourceTree.find(
			(candidate) => !descriptor.eligibleSourceKinds.includes(candidate.kind),
		);
		if (unsupportedSource) {
			issues.push({
				code: "source-kind-unsupported",
				assignmentId: assignment.id,
				detail: `${descriptor.id} does not accept ${unsupportedSource.kind}`,
			});
			continue;
		}
		const unsupportedSpace = sourceTree.find(
			(candidate) => !descriptor.coordinateSpaces.includes(candidate.space),
		)?.space;
		if (unsupportedSpace) {
			issues.push({
				code: "source-space-unsupported",
				assignmentId: assignment.id,
				detail: `${descriptor.id} cannot resolve ${unsupportedSpace} coordinates`,
			});
			continue;
		}
		const routeKey = [
			targetKey(assignment.target),
			descriptor.id,
			...(descriptor.owner === "mask-relation" ? [assignment.effect.id] : []),
		].join("|");
		candidates.push({
			assignmentId: assignment.id,
			...(assignment.fieldId ? { fieldId: assignment.fieldId } : {}),
			target: assignment.target,
			effect: assignment.effect,
			descriptorId: descriptor.id,
			operator: descriptor.operator,
			source,
			sourceOrigin,
			influence: { ...assignment.influence, source },
			surface: options.surface,
			fidelity: routeFidelity(
				descriptor,
				options.surface,
				assignment,
				sourceOrigin,
				source,
			),
			routeKey,
		});
	}

	const routeCounts = countsBy(candidates, (route) => route.routeKey);
	for (const [routeKey, count] of routeCounts) {
		if (count <= 1) continue;
		issues.push({
			code: "duplicate-active-route",
			routeKey,
			detail: `${count} active assignments address the same target and slot`,
		});
	}
	return {
		routes: candidates.filter((route) => routeCounts.get(route.routeKey) === 1),
		issues,
	};
}

/** Convenience selector for a node/group target without introducing first-match semantics. */
export function compileEffectFieldRoutesForNode(
	recipe: EffectInfluenceRecipeDraft | EffectInfluenceRecipe | null | undefined,
	nodeId: string,
	surface: EffectFieldRenderSurface,
): EffectFieldRoutingPlan {
	const objectPlan = compileEffectFieldRoutes(recipe, {
		surface,
		target: { scope: "object", id: nodeId },
	});
	const groupPlan = compileEffectFieldRoutes(recipe, {
		surface,
		target: { scope: "group", id: nodeId },
	});
	const candidates = [...objectPlan.routes, ...groupPlan.routes];
	const descriptorCounts = countsBy(candidates, (route) => route.descriptorId);
	const crossScopeIssues = [...descriptorCounts.entries()].flatMap(
		([descriptorId, count]): EffectFieldRouteIssue[] =>
			count > 1
				? [
						{
							code: "duplicate-active-route",
							routeKey: `${nodeId}|${descriptorId}`,
							detail:
								`${count} object/group routes address ${descriptorId} ` +
								`on node "${nodeId}"; none was applied`,
						},
					]
				: [],
	);
	return {
		routes: candidates.filter(
			(route) => descriptorCounts.get(route.descriptorId) === 1,
		),
		issues: [...objectPlan.issues, ...groupPlan.issues, ...crossScopeIssues],
	};
}
