import {
	composeMatrix,
	IDENTITY_MATRIX,
	invertMatrix,
	type Matrix2D,
	matrixFromTransform,
	transformWithPresentationMatrix,
} from "./rendering";
import {
	applyPropertyRelationsToScene,
	constrainedMatrix,
	convertConstraintMatrixSpace,
	type SceneConstraintIssueCode,
} from "./scene-constraints";
import { selectArtboardIdForNode } from "./selectors";
import type {
	AffineMatrix2D,
	MotionParentBinding,
	SceneDocument,
	VectorNode,
} from "./types";

export type MotionRelationIssueCode =
	| "motion-parent-missing"
	| "motion-parent-self"
	| "motion-parent-cycle"
	| "motion-parent-cross-artboard"
	| "motion-parent-bind-matrix-invalid"
	| "motion-parent-local-singular"
	| "motion-parent-render-parent-singular"
	| "motion-parent-detach-requires-motion-write"
	| SceneConstraintIssueCode;

export type MotionRelationIssue = {
	readonly code: MotionRelationIssueCode;
	readonly severity: "warning" | "error";
	readonly message: string;
	readonly nodeId: string;
	readonly parentNodeId?: string;
};

export type MotionRelationResolution = {
	/** Sampled structural world matrices before motion-parent replacement. */
	readonly structuralWorldMatrixByNodeId: ReadonlyMap<string, Matrix2D>;
	/** Final world matrices after valid motion-parent relations are composed. */
	readonly worldMatrixByNodeId: ReadonlyMap<string, Matrix2D>;
	/** Matrices relative to the structural render parent used by nested SVG/DOM. */
	readonly renderLocalMatrixByNodeId: ReadonlyMap<string, Matrix2D>;
	readonly structuralParentNodeIdById: ReadonlyMap<string, string>;
	readonly issues: readonly MotionRelationIssue[];
};

export type MotionParentBindingPlan =
	| {
			readonly status: "ready";
			readonly nodeId: string;
			readonly binding: MotionParentBinding;
	  }
	| {
			readonly status: "blocked";
			readonly nodeId: string;
			readonly issues: readonly MotionRelationIssue[];
	  };

export type MotionRelationRemapResult = {
	readonly nodes: readonly VectorNode[];
	readonly droppedNodeIds: readonly string[];
};

type NodeIndex = {
	readonly nodeById: ReadonlyMap<string, VectorNode>;
	readonly parentNodeIdById: ReadonlyMap<string, string>;
	readonly localMatrixByNodeId: ReadonlyMap<string, Matrix2D>;
	readonly structuralWorldById: ReadonlyMap<string, Matrix2D>;
};

const finiteMatrix = (matrix: AffineMatrix2D): boolean =>
	Number.isFinite(matrix.a) &&
	Number.isFinite(matrix.b) &&
	Number.isFinite(matrix.c) &&
	Number.isFinite(matrix.d) &&
	Number.isFinite(matrix.e) &&
	Number.isFinite(matrix.f);

const sameMatrix = (left: Matrix2D, right: Matrix2D): boolean =>
	Math.abs(left.a - right.a) <= 1e-9 &&
	Math.abs(left.b - right.b) <= 1e-9 &&
	Math.abs(left.c - right.c) <= 1e-9 &&
	Math.abs(left.d - right.d) <= 1e-9 &&
	Math.abs(left.e - right.e) <= 1e-9 &&
	Math.abs(left.f - right.f) <= 1e-9;

const issue = (
	code: MotionRelationIssueCode,
	message: string,
	nodeId: string,
	parentNodeId?: string,
): MotionRelationIssue => ({
	code,
	severity:
		code === "motion-parent-missing" ||
		code === "motion-parent-render-parent-singular"
			? "warning"
			: "error",
	message,
	nodeId,
	...(parentNodeId ? { parentNodeId } : {}),
});

const buildNodeIndex = (scene: SceneDocument): NodeIndex => {
	const nodeById = new Map<string, VectorNode>();
	const parentNodeIdById = new Map<string, string>();
	const localMatrixByNodeId = new Map<string, Matrix2D>();
	const structuralWorldById = new Map<string, Matrix2D>();

	const visit = (
		node: VectorNode,
		parentWorld: Matrix2D,
		parentNodeId: string | null,
	): void => {
		nodeById.set(node.id, node);
		if (parentNodeId) parentNodeIdById.set(node.id, parentNodeId);
		const local = matrixFromTransform(node.transform);
		const world = composeMatrix(parentWorld, local);
		localMatrixByNodeId.set(node.id, local);
		structuralWorldById.set(node.id, world);
		for (const child of node.children ?? []) visit(child, world, node.id);
	};

	for (const layer of scene.layers) {
		for (const node of layer.nodes) visit(node, IDENTITY_MATRIX, null);
	}
	return {
		nodeById,
		parentNodeIdById,
		localMatrixByNodeId,
		structuralWorldById,
	};
};

const invalidMotionBindingNodes = (
	scene: SceneDocument,
	index: NodeIndex,
	issues: MotionRelationIssue[],
): ReadonlySet<string> => {
	const invalid = new Set<string>();
	for (const node of index.nodeById.values()) {
		const binding = node.motionParent;
		if (!binding) continue;
		const parent = index.nodeById.get(binding.parentNodeId);
		if (!parent) {
			invalid.add(node.id);
			issues.push(
				issue(
					"motion-parent-missing",
					`Motion parent "${binding.parentNodeId}" for node "${node.id}" is missing.`,
					node.id,
					binding.parentNodeId,
				),
			);
			continue;
		}
		if (binding.parentNodeId === node.id) {
			invalid.add(node.id);
			issues.push(
				issue(
					"motion-parent-self",
					`Node "${node.id}" cannot be its own motion parent.`,
					node.id,
					binding.parentNodeId,
				),
			);
			continue;
		}
		const nodeArtboardId = selectArtboardIdForNode(scene, node.id);
		const parentArtboardId = selectArtboardIdForNode(scene, parent.id);
		if (
			nodeArtboardId !== undefined &&
			parentArtboardId !== undefined &&
			nodeArtboardId !== parentArtboardId
		) {
			invalid.add(node.id);
			issues.push(
				issue(
					"motion-parent-cross-artboard",
					`Node "${node.id}" and motion parent "${parent.id}" belong to different artboards.`,
					node.id,
					parent.id,
				),
			);
			continue;
		}
		if (!finiteMatrix(binding.bindMatrix)) {
			invalid.add(node.id);
			issues.push(
				issue(
					"motion-parent-bind-matrix-invalid",
					`Motion parent bind matrix for node "${node.id}" must contain only finite values.`,
					node.id,
					parent.id,
				),
			);
		}
	}
	for (const node of index.nodeById.values()) {
		const constraint = node.transformConstraint;
		if (!constraint) continue;
		const source = index.nodeById.get(constraint.sourceNodeId);
		if (!source) {
			invalid.add(node.id);
			issues.push(
				issue(
					"constraint-source-missing",
					`Transform constraint source "${constraint.sourceNodeId}" is missing.`,
					node.id,
					constraint.sourceNodeId,
				),
			);
			continue;
		}
		if (source.id === node.id) {
			invalid.add(node.id);
			issues.push(
				issue(
					"constraint-self",
					`Node "${node.id}" cannot constrain itself.`,
					node.id,
					source.id,
				),
			);
			continue;
		}
		if (node.motionParent) {
			invalid.add(node.id);
			issues.push(
				issue(
					"constraint-target-conflict",
					`Node "${node.id}" cannot be both motion-parented and transform-constrained.`,
					node.id,
					source.id,
				),
			);
			continue;
		}
		if (
			selectArtboardIdForNode(scene, node.id) !==
			selectArtboardIdForNode(scene, source.id)
		) {
			invalid.add(node.id);
			issues.push(
				issue(
					"constraint-cross-artboard",
					"Transform constraints must stay inside one artboard.",
					node.id,
					source.id,
				),
			);
		}
	}

	const state = new Map<string, "visiting" | "done">();
	const stack: string[] = [];
	const visit = (nodeId: string): void => {
		if (state.get(nodeId) === "done" || invalid.has(nodeId)) return;
		if (state.get(nodeId) === "visiting") {
			const start = stack.lastIndexOf(nodeId);
			const cycle = start >= 0 ? stack.slice(start) : [nodeId];
			for (const cycleNodeId of cycle) invalid.add(cycleNodeId);
			const hasConstraint = cycle.some(
				(cycleNodeId) =>
					index.nodeById.get(cycleNodeId)?.transformConstraint !== undefined,
			);
			issues.push(
				issue(
					hasConstraint ? "constraint-cycle" : "motion-parent-cycle",
					`${hasConstraint ? "Transform relation" : "Motion parent"} cycle includes ${cycle.map((id) => `"${id}"`).join(", ")}.`,
					nodeId,
				),
			);
			return;
		}
		state.set(nodeId, "visiting");
		stack.push(nodeId);
		const node = index.nodeById.get(nodeId);
		const dependencies = [
			node?.motionParent?.parentNodeId,
			node?.transformConstraint?.sourceNodeId,
		].filter((candidate): candidate is string => Boolean(candidate));
		for (const dependencyId of dependencies) {
			if (index.nodeById.has(dependencyId)) visit(dependencyId);
		}
		stack.pop();
		state.set(nodeId, "done");
	};
	for (const nodeId of index.nodeById.keys()) visit(nodeId);
	return invalid;
};

/**
 * Resolves general 2D motion-parent relations independently of scene cameras.
 * `restScene` supplies each node's unanimated local matrix while `sampledScene`
 * supplies the frame-local transform after ordinary keyframes/grammar. A valid
 * relation replaces structural world placement with
 * `parentWorld * bindMatrix * localMotionDelta`, preserving child-local motion
 * without duplicating controller keys into child tracks.
 */
export function resolveMotionRelations({
	restScene,
	sampledScene,
}: {
	readonly restScene?: SceneDocument;
	readonly sampledScene: SceneDocument;
}): MotionRelationResolution {
	const rest = buildNodeIndex(restScene ?? sampledScene);
	const sampled = buildNodeIndex(sampledScene);
	const issues: MotionRelationIssue[] = [];
	const invalid = invalidMotionBindingNodes(sampledScene, sampled, issues);
	const worldMatrixByNodeId = new Map<string, Matrix2D>();

	const resolveWorld = (nodeId: string): Matrix2D => {
		const cached = worldMatrixByNodeId.get(nodeId);
		if (cached) return cached;
		const node = sampled.nodeById.get(nodeId);
		if (!node) return IDENTITY_MATRIX;
		const structuralParentId = sampled.parentNodeIdById.get(nodeId);
		const structuralParentWorld = structuralParentId
			? resolveWorld(structuralParentId)
			: IDENTITY_MATRIX;
		const sampledLocal =
			sampled.localMatrixByNodeId.get(nodeId) ?? IDENTITY_MATRIX;
		const structuralFallback = composeMatrix(
			structuralParentWorld,
			sampledLocal,
		);
		const binding = node.motionParent;
		let baseWorld = structuralFallback;
		if (binding && !invalid.has(nodeId)) {
			const restLocal = rest.localMatrixByNodeId.get(nodeId) ?? sampledLocal;
			const inverseRestLocal = invertMatrix(restLocal);
			if (!inverseRestLocal) {
				issues.push(
					issue(
						"motion-parent-local-singular",
						`Rest transform for motion-parented node "${nodeId}" is singular.`,
						nodeId,
						binding.parentNodeId,
					),
				);
				worldMatrixByNodeId.set(nodeId, structuralFallback);
				return structuralFallback;
			}
			const localMotionDelta = composeMatrix(inverseRestLocal, sampledLocal);
			baseWorld = composeMatrix(
				composeMatrix(resolveWorld(binding.parentNodeId), binding.bindMatrix),
				localMotionDelta,
			);
		}
		const constraint = node.transformConstraint;
		if (!constraint || invalid.has(nodeId)) {
			worldMatrixByNodeId.set(nodeId, baseWorld);
			return baseWorld;
		}
		const sourceLocal =
			sampled.localMatrixByNodeId.get(constraint.sourceNodeId) ??
			IDENTITY_MATRIX;
		const sourceStructuralParentId = sampled.parentNodeIdById.get(
			constraint.sourceNodeId,
		);
		const sourceStructuralParentWorld = sourceStructuralParentId
			? resolveWorld(sourceStructuralParentId)
			: IDENTITY_MATRIX;
		const sourceInDestination = convertConstraintMatrixSpace({
			matrix:
				constraint.sourceSpace === "world"
					? resolveWorld(constraint.sourceNodeId)
					: sourceLocal,
			from: constraint.sourceSpace,
			to: constraint.destinationSpace,
			structuralParentWorld:
				constraint.sourceSpace === "local" &&
				constraint.destinationSpace === "world"
					? sourceStructuralParentWorld
					: structuralParentWorld,
		});
		const baseInDestination = convertConstraintMatrixSpace({
			matrix: baseWorld,
			from: "world",
			to: constraint.destinationSpace,
			structuralParentWorld,
		});
		if (!sourceInDestination || !baseInDestination) {
			issues.push(
				issue(
					"constraint-space-singular",
					`Transform constraint for node "${nodeId}" cannot convert through a singular structural parent.`,
					nodeId,
					constraint.sourceNodeId,
				),
			);
			worldMatrixByNodeId.set(nodeId, baseWorld);
			return baseWorld;
		}
		const constrained = constrainedMatrix(
			baseInDestination,
			sourceInDestination,
			constraint,
			node.transform.anchor,
		);
		const world =
			constraint.destinationSpace === "world"
				? constrained
				: composeMatrix(structuralParentWorld, constrained);
		worldMatrixByNodeId.set(nodeId, world);
		return world;
	};

	for (const nodeId of sampled.nodeById.keys()) resolveWorld(nodeId);

	const renderLocalMatrixByNodeId = new Map<string, Matrix2D>();
	for (const [nodeId, world] of worldMatrixByNodeId) {
		const structuralParentId = sampled.parentNodeIdById.get(nodeId);
		const parentWorld = structuralParentId
			? (worldMatrixByNodeId.get(structuralParentId) ?? IDENTITY_MATRIX)
			: IDENTITY_MATRIX;
		const inverseParent = invertMatrix(parentWorld);
		if (!inverseParent) {
			issues.push(
				issue(
					"motion-parent-render-parent-singular",
					`Structural render parent for node "${nodeId}" is singular.`,
					nodeId,
					structuralParentId,
				),
			);
			renderLocalMatrixByNodeId.set(
				nodeId,
				sampled.localMatrixByNodeId.get(nodeId) ?? IDENTITY_MATRIX,
			);
			continue;
		}
		renderLocalMatrixByNodeId.set(nodeId, composeMatrix(inverseParent, world));
	}

	return {
		structuralWorldMatrixByNodeId: sampled.structuralWorldById,
		worldMatrixByNodeId,
		renderLocalMatrixByNodeId,
		structuralParentNodeIdById: sampled.parentNodeIdById,
		issues,
	};
}

const applyResolvedNode = (
	node: VectorNode,
	resolution: MotionRelationResolution,
	stripBindings: boolean,
): VectorNode => {
	const children = node.children?.map((child) =>
		applyResolvedNode(child, resolution, stripBindings),
	);
	const childrenChanged =
		children?.some((child, index) => child !== node.children?.[index]) ?? false;
	const matrix = resolution.renderLocalMatrixByNodeId.get(node.id);
	const transformChanged = Boolean(
		matrix && !sameMatrix(matrix, matrixFromTransform(node.transform)),
	);
	const bindingChanged =
		stripBindings &&
		(node.motionParent !== undefined ||
			node.transformConstraint !== undefined ||
			node.propertyRelations !== undefined);
	if (!childrenChanged && !transformChanged && !bindingChanged) return node;
	const {
		motionParent: _motionParent,
		transformConstraint: _transformConstraint,
		propertyRelations: _propertyRelations,
		...withoutBinding
	} = node;
	return {
		...(stripBindings ? withoutBinding : node),
		...(matrix && transformChanged
			? {
					transform: transformWithPresentationMatrix(
						matrix,
						node.transform.anchor,
					),
				}
			: {}),
		...(childrenChanged && children ? { children } : {}),
	};
};

/**
 * Materializes resolved relation matrices into a read-only presentation scene.
 * `stripBindings` is for downstream adapters that would otherwise evaluate the
 * already-materialized relation a second time; it never mutates source data.
 */
export function applyMotionRelationsToScene({
	restScene,
	sampledScene,
	stripBindings = false,
}: {
	readonly restScene?: SceneDocument;
	readonly sampledScene: SceneDocument;
	readonly stripBindings?: boolean;
}): {
	readonly scene: SceneDocument;
	readonly resolution: MotionRelationResolution;
} {
	const propertyPresentation = applyPropertyRelationsToScene(sampledScene);
	const resolved = resolveMotionRelations({
		restScene,
		sampledScene: propertyPresentation.scene,
	});
	const resolution: MotionRelationResolution = {
		...resolved,
		issues: [...propertyPresentation.issues, ...resolved.issues],
	};
	const layers = propertyPresentation.scene.layers.map((layer) => {
		const nodes = layer.nodes.map((node) =>
			applyResolvedNode(node, resolution, stripBindings),
		);
		return nodes.every((node, index) => node === layer.nodes[index])
			? layer
			: { ...layer, nodes };
	});
	const scene = layers.every(
		(layer, index) => layer === propertyPresentation.scene.layers[index],
	)
		? propertyPresentation.scene
		: { ...propertyPresentation.scene, layers };
	return { scene, resolution };
}

const prospectiveCycle = (
	scene: SceneDocument,
	nodeId: string,
	parentNodeId: string,
): boolean => {
	const index = buildNodeIndex(scene);
	const visited = new Set<string>();
	let current: string | undefined = parentNodeId;
	while (current) {
		if (current === nodeId) return true;
		if (visited.has(current)) return true;
		visited.add(current);
		current = index.nodeById.get(current)?.motionParent?.parentNodeId;
	}
	return false;
};

/**
 * Validates the graph/scope part of a prospective motion-parent assignment.
 * Command writers use this before mutation so invalid relations fail closed
 * instead of relying on the presentation fallback.
 */
export function validateMotionParentTarget(
	scene: SceneDocument,
	nodeId: string,
	parentNodeId: string,
): readonly MotionRelationIssue[] {
	const index = buildNodeIndex(scene);
	const node = index.nodeById.get(nodeId);
	const parent = index.nodeById.get(parentNodeId);
	const issues: MotionRelationIssue[] = [];
	if (!node || !parent) {
		issues.push(
			issue(
				"motion-parent-missing",
				!node
					? `Motion-parent child "${nodeId}" is missing.`
					: `Motion parent "${parentNodeId}" is missing.`,
				nodeId,
				parentNodeId,
			),
		);
		return issues;
	}
	if (nodeId === parentNodeId) {
		issues.push(
			issue(
				"motion-parent-self",
				`Node "${nodeId}" cannot be its own motion parent.`,
				nodeId,
				parentNodeId,
			),
		);
	}
	if (node.transformConstraint) {
		issues.push(
			issue(
				"constraint-target-conflict",
				`Node "${nodeId}" must remove its transform constraint before adding a full motion parent.`,
				nodeId,
				parentNodeId,
			),
		);
	}
	const childArtboardId = selectArtboardIdForNode(scene, nodeId);
	const parentArtboardId = selectArtboardIdForNode(scene, parentNodeId);
	if (
		childArtboardId !== undefined &&
		parentArtboardId !== undefined &&
		childArtboardId !== parentArtboardId
	) {
		issues.push(
			issue(
				"motion-parent-cross-artboard",
				`Node "${nodeId}" and motion parent "${parentNodeId}" belong to different artboards.`,
				nodeId,
				parentNodeId,
			),
		);
	}
	if (prospectiveCycle(scene, nodeId, parentNodeId)) {
		issues.push(
			issue(
				"motion-parent-cycle",
				`Binding "${nodeId}" to "${parentNodeId}" would create a motion-parent cycle.`,
				nodeId,
				parentNodeId,
			),
		);
	}
	return issues;
}

/**
 * Plans a keep-world binding at the supplied sampled frame. The bind matrix is
 * factored before the child's current local-motion delta, so applying the new
 * relation preserves the visible pose while future child-local keys still work.
 */
export function planMotionParentBinding({
	restScene,
	sampledScene,
	nodeId,
	parentNodeId,
}: {
	readonly restScene: SceneDocument;
	readonly sampledScene: SceneDocument;
	readonly nodeId: string;
	readonly parentNodeId: string;
}): MotionParentBindingPlan {
	const rest = buildNodeIndex(restScene);
	const sampled = buildNodeIndex(sampledScene);
	const node = sampled.nodeById.get(nodeId);
	const parent = sampled.nodeById.get(parentNodeId);
	const blocked = validateMotionParentTarget(restScene, nodeId, parentNodeId);
	if (blocked.length > 0 || !node || !parent) {
		return { status: "blocked", nodeId, issues: blocked };
	}

	const resolution = resolveMotionRelations({ restScene, sampledScene });
	const childWorld = resolution.worldMatrixByNodeId.get(nodeId);
	const parentWorld = resolution.worldMatrixByNodeId.get(parentNodeId);
	const restLocal = rest.localMatrixByNodeId.get(nodeId);
	const sampledLocal = sampled.localMatrixByNodeId.get(nodeId);
	const inverseParent = parentWorld ? invertMatrix(parentWorld) : null;
	const inverseRest = restLocal ? invertMatrix(restLocal) : null;
	if (
		!childWorld ||
		!parentWorld ||
		!sampledLocal ||
		!inverseParent ||
		!inverseRest
	) {
		return {
			status: "blocked",
			nodeId,
			issues: [
				issue(
					"motion-parent-local-singular",
					`Motion parent bind for node "${nodeId}" requires invertible child and parent transforms.`,
					nodeId,
					parentNodeId,
				),
			],
		};
	}
	const localMotionDelta = composeMatrix(inverseRest, sampledLocal);
	const inverseLocalMotionDelta = invertMatrix(localMotionDelta);
	if (!inverseLocalMotionDelta) {
		return {
			status: "blocked",
			nodeId,
			issues: [
				issue(
					"motion-parent-local-singular",
					`Current local motion for node "${nodeId}" is singular and cannot be bound without a visible jump.`,
					nodeId,
					parentNodeId,
				),
			],
		};
	}
	return {
		status: "ready",
		nodeId,
		binding: {
			parentNodeId,
			bindMatrix: composeMatrix(
				composeMatrix(inverseParent, childWorld),
				inverseLocalMotionDelta,
			),
		},
	};
}

const remapMotionParentNode = (
	node: VectorNode,
	idMap: ReadonlyMap<string, string>,
	droppedNodeIds: string[],
): VectorNode => {
	const children = node.children?.map((child) =>
		remapMotionParentNode(child, idMap, droppedNodeIds),
	);
	const binding = node.motionParent;
	const remappedParentId = binding
		? idMap.get(binding.parentNodeId)
		: undefined;
	if (binding && !remappedParentId) droppedNodeIds.push(node.id);
	const constraint = node.transformConstraint;
	const remappedConstraintSourceId = constraint
		? idMap.get(constraint.sourceNodeId)
		: undefined;
	if (constraint && !remappedConstraintSourceId) droppedNodeIds.push(node.id);
	const propertyRelations = node.propertyRelations?.flatMap((relation) => {
		const remappedSourceNodeId = idMap.get(relation.sourceNodeId);
		if (!remappedSourceNodeId) {
			droppedNodeIds.push(node.id);
			return [];
		}
		return [{ ...relation, sourceNodeId: remappedSourceNodeId }];
	});
	const {
		motionParent: _motionParent,
		transformConstraint: _transformConstraint,
		propertyRelations: _propertyRelations,
		children: _children,
		...rest
	} = node;
	return {
		...rest,
		...(binding && remappedParentId
			? {
					motionParent: {
						...binding,
						parentNodeId: remappedParentId,
					},
				}
			: {}),
		...(constraint && remappedConstraintSourceId
			? {
					transformConstraint: {
						...constraint,
						sourceNodeId: remappedConstraintSourceId,
					},
				}
			: {}),
		...(propertyRelations && propertyRelations.length > 0
			? { propertyRelations }
			: {}),
		...(children ? { children } : {}),
	};
};

/**
 * Remaps target-owned motion-parent, transform-constraint, and property-relation
 * source ids after a self-contained clone. External references are removed so
 * paste/artboard duplication cannot retain hidden source-document links.
 */
export function remapClonedMotionParentBindings(
	nodes: readonly VectorNode[],
	idMap: ReadonlyMap<string, string>,
): MotionRelationRemapResult {
	const droppedNodeIds: string[] = [];
	return {
		nodes: nodes.map((node) =>
			remapMotionParentNode(node, idMap, droppedNodeIds),
		),
		droppedNodeIds,
	};
}

/**
 * Reattaches source relation metadata to an already-materialized presentation
 * tree. Render adapters ignore the metadata and consume the resolved transform;
 * authoring overlays can still inspect parent identity without evaluating it a
 * second time.
 */
export function restoreMotionParentBindings(
	sourceScene: SceneDocument,
	presentationScene: SceneDocument,
): SceneDocument {
	const source = buildNodeIndex(sourceScene).nodeById;
	const restoreNode = (node: VectorNode): VectorNode => {
		const sourceNode = source.get(node.id);
		const sourceBinding = sourceNode?.motionParent;
		const sourceConstraint = sourceNode?.transformConstraint;
		const sourcePropertyRelations = sourceNode?.propertyRelations;
		const children = node.children?.map(restoreNode);
		const childrenChanged =
			children?.some((child, index) => child !== node.children?.[index]) ??
			false;
		if (
			!childrenChanged &&
			sourceBinding === node.motionParent &&
			sourceConstraint === node.transformConstraint &&
			sourcePropertyRelations === node.propertyRelations
		)
			return node;
		const {
			motionParent: _motionParent,
			transformConstraint: _transformConstraint,
			propertyRelations: _propertyRelations,
			children: _children,
			...rest
		} = node;
		return {
			...rest,
			...(sourceBinding ? { motionParent: sourceBinding } : {}),
			...(sourceConstraint ? { transformConstraint: sourceConstraint } : {}),
			...(sourcePropertyRelations
				? { propertyRelations: sourcePropertyRelations }
				: {}),
			...(children ? { children } : {}),
		};
	};
	const layers = presentationScene.layers.map((layer) => {
		const nodes = layer.nodes.map(restoreNode);
		return nodes.every((node, index) => node === layer.nodes[index])
			? layer
			: { ...layer, nodes };
	});
	return layers.every(
		(layer, index) => layer === presentationScene.layers[index],
	)
		? presentationScene
		: { ...presentationScene, layers };
}
