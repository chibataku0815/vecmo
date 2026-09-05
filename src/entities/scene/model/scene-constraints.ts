import {
	composeMatrix,
	IDENTITY_MATRIX,
	invertMatrix,
	type Matrix2D,
	matrixFromTransform,
	transformFromMatrix,
} from "./rendering";
import { selectArtboardIdForNode } from "./selectors";
import type {
	PropertyRelation,
	RelationNumericProperty,
	SceneDocument,
	Transform,
	TransformConstraint,
	Vec2,
	VectorNode,
} from "./types";

export type SceneConstraintIssueCode =
	| "constraint-source-missing"
	| "constraint-self"
	| "constraint-cycle"
	| "constraint-cross-artboard"
	| "constraint-target-conflict"
	| "constraint-space-singular"
	| "property-relation-target-duplicate"
	| "property-relation-property-unsupported";

export type SceneConstraintIssue = {
	readonly code: SceneConstraintIssueCode;
	readonly severity: "warning" | "error";
	readonly message: string;
	readonly nodeId: string;
	readonly sourceNodeId?: string;
	readonly relationId?: string;
};

const issue = (
	code: SceneConstraintIssueCode,
	message: string,
	nodeId: string,
	options: {
		readonly sourceNodeId?: string;
		readonly relationId?: string;
	} = {},
): SceneConstraintIssue => ({
	code,
	severity: code === "constraint-source-missing" ? "warning" : "error",
	message,
	nodeId,
	...options,
});

const nodeMap = (scene: SceneDocument): ReadonlyMap<string, VectorNode> => {
	const result = new Map<string, VectorNode>();
	const visit = (node: VectorNode): void => {
		result.set(node.id, node);
		for (const child of node.children ?? []) visit(child);
	};
	for (const layer of scene.layers) for (const node of layer.nodes) visit(node);
	return result;
};

/** Reads one admitted scalar scene property without accepting arbitrary paths. */
export function relationNumericPropertyValue(
	node: VectorNode,
	property: RelationNumericProperty,
): number | null {
	switch (property) {
		case "style.opacity":
			return node.style.opacity;
		case "geometry.cornerRadius":
			return "cornerRadius" in node.geometry
				? (node.geometry.cornerRadius ?? 0)
				: null;
		case "geometry.cornerSmoothing":
			return "cornerSmoothing" in node.geometry
				? (node.geometry.cornerSmoothing ?? 0)
				: null;
	}
}

const withRelationNumericProperty = (
	node: VectorNode,
	property: RelationNumericProperty,
	value: number,
): VectorNode | null => {
	switch (property) {
		case "style.opacity":
			return { ...node, style: { ...node.style, opacity: value } };
		case "geometry.cornerRadius":
			return "cornerRadius" in node.geometry
				? {
						...node,
						geometry: { ...node.geometry, cornerRadius: Math.max(0, value) },
					}
				: null;
		case "geometry.cornerSmoothing":
			return "cornerSmoothing" in node.geometry
				? {
						...node,
						geometry: {
							...node.geometry,
							cornerSmoothing: Math.min(1, Math.max(0, value)),
						},
					}
				: null;
	}
};

const relationValue = (source: number, relation: PropertyRelation): number => {
	const transformed = source * relation.scale + relation.offset;
	return relation.clamp
		? Math.min(relation.clamp.max, Math.max(relation.clamp.min, transformed))
		: transformed;
};

/**
 * Resolves property relations into a presentation-only scene. Evaluation is by
 * target-property identity, so chains are deterministic and cycles fail closed
 * without mutating source values.
 */
export function applyPropertyRelationsToScene(scene: SceneDocument): {
	readonly scene: SceneDocument;
	readonly issues: readonly SceneConstraintIssue[];
} {
	const nodes = nodeMap(scene);
	const issues: SceneConstraintIssue[] = [];
	const relationByTarget = new Map<string, PropertyRelation>();
	for (const node of nodes.values()) {
		for (const relation of node.propertyRelations ?? []) {
			const key = `${node.id}:${relation.targetProperty}`;
			if (relationByTarget.has(key)) {
				issues.push(
					issue(
						"property-relation-target-duplicate",
						`Node "${node.id}" has more than one relation for "${relation.targetProperty}".`,
						node.id,
						{ sourceNodeId: relation.sourceNodeId, relationId: relation.id },
					),
				);
				continue;
			}
			relationByTarget.set(key, relation);
		}
	}
	const state = new Map<string, "visiting" | "done">();
	const values = new Map<string, number>();
	const resolve = (
		nodeId: string,
		property: RelationNumericProperty,
	): number | null => {
		const key = `${nodeId}:${property}`;
		const cached = values.get(key);
		if (cached !== undefined) return cached;
		const node = nodes.get(nodeId);
		if (!node) return null;
		const base = relationNumericPropertyValue(node, property);
		if (base === null) return null;
		const relation = relationByTarget.get(key);
		if (!relation) {
			values.set(key, base);
			return base;
		}
		if (state.get(key) === "visiting") {
			issues.push(
				issue(
					"constraint-cycle",
					`Property relation cycle reaches "${key}".`,
					nodeId,
					{ sourceNodeId: relation.sourceNodeId, relationId: relation.id },
				),
			);
			values.set(key, base);
			return base;
		}
		const source = nodes.get(relation.sourceNodeId);
		if (!source) {
			issues.push(
				issue(
					"constraint-source-missing",
					`Property relation source "${relation.sourceNodeId}" is missing.`,
					nodeId,
					{ sourceNodeId: relation.sourceNodeId, relationId: relation.id },
				),
			);
			values.set(key, base);
			return base;
		}
		if (
			selectArtboardIdForNode(scene, nodeId) !==
			selectArtboardIdForNode(scene, source.id)
		) {
			issues.push(
				issue(
					"constraint-cross-artboard",
					"Property relations must stay inside one artboard.",
					nodeId,
					{ sourceNodeId: source.id, relationId: relation.id },
				),
			);
			values.set(key, base);
			return base;
		}
		state.set(key, "visiting");
		const sourceValue = resolve(source.id, relation.sourceProperty);
		state.set(key, "done");
		if (sourceValue === null) {
			issues.push(
				issue(
					"property-relation-property-unsupported",
					`Source property "${relation.sourceProperty}" is not available on node "${source.id}".`,
					nodeId,
					{ sourceNodeId: source.id, relationId: relation.id },
				),
			);
			values.set(key, base);
			return base;
		}
		const resolved = relationValue(sourceValue, relation);
		values.set(key, resolved);
		return resolved;
	};

	const visit = (node: VectorNode): VectorNode => {
		let next = node;
		for (const relation of node.propertyRelations ?? []) {
			if (
				relationByTarget.get(`${node.id}:${relation.targetProperty}`) !==
				relation
			)
				continue;
			const value = resolve(node.id, relation.targetProperty);
			if (value === null) continue;
			const updated = withRelationNumericProperty(
				next,
				relation.targetProperty,
				value,
			);
			if (updated) next = updated;
		}
		const children = next.children?.map(visit);
		return children?.some((child, index) => child !== next.children?.[index])
			? { ...next, children }
			: next;
	};
	const layers = scene.layers.map((layer) => {
		const layerNodes = layer.nodes.map(visit);
		return layerNodes.some((node, index) => node !== layer.nodes[index])
			? { ...layer, nodes: layerNodes }
			: layer;
	});
	return {
		scene: layers.some((layer, index) => layer !== scene.layers[index])
			? { ...scene, layers }
			: scene,
		issues,
	};
}

const blend = (from: number, to: number, strength: number): number =>
	from + (to - from) * strength;
const blendVec = (from: Vec2, to: Vec2, strength: number): Vec2 => ({
	x: blend(from.x, to.x, strength),
	y: blend(from.y, to.y, strength),
});

/** Applies selected constraint channels after both matrices share one space. */
export function constrainedMatrix(
	baseMatrix: Matrix2D,
	sourceMatrix: Matrix2D,
	constraint: TransformConstraint,
	anchor: Vec2,
): Matrix2D {
	const base = transformFromMatrix(baseMatrix, anchor);
	const source = transformFromMatrix(sourceMatrix, anchor);
	const strength = Math.min(1, Math.max(0, constraint.strength));
	const offset = constraint.maintainOffset ? constraint.offset : undefined;
	const desired: Transform = {
		position: {
			x: source.position.x + (offset?.position?.x ?? 0),
			y: source.position.y + (offset?.position?.y ?? 0),
		},
		rotation: source.rotation + (offset?.rotation ?? 0),
		scale: {
			x: source.scale.x * (offset?.scale?.x ?? 1),
			y: source.scale.y * (offset?.scale?.y ?? 1),
		},
		anchor,
	};
	return matrixFromTransform({
		position: constraint.channels.includes("position")
			? blendVec(base.position, desired.position, strength)
			: base.position,
		rotation: constraint.channels.includes("rotation")
			? blend(base.rotation, desired.rotation, strength)
			: base.rotation,
		scale: constraint.channels.includes("scale")
			? blendVec(base.scale, desired.scale, strength)
			: base.scale,
		anchor,
	});
}

/** Captures a keep-pose offset between already-converted source/target matrices. */
export function transformConstraintOffsetForMatrices(
	targetMatrix: Matrix2D,
	sourceMatrix: Matrix2D,
	anchor: Vec2,
): NonNullable<TransformConstraint["offset"]> {
	const target = transformFromMatrix(targetMatrix, anchor);
	const source = transformFromMatrix(sourceMatrix, anchor);
	return {
		position: {
			x: target.position.x - source.position.x,
			y: target.position.y - source.position.y,
		},
		rotation: target.rotation - source.rotation,
		scale: {
			x: Math.abs(source.scale.x) > 1e-9 ? target.scale.x / source.scale.x : 1,
			y: Math.abs(source.scale.y) > 1e-9 ? target.scale.y / source.scale.y : 1,
		},
	};
}

/** Converts a matrix between structural local/world spaces for one target. */
export function convertConstraintMatrixSpace({
	matrix,
	from,
	to,
	structuralParentWorld = IDENTITY_MATRIX,
}: {
	readonly matrix: Matrix2D;
	readonly from: "local" | "world";
	readonly to: "local" | "world";
	readonly structuralParentWorld?: Matrix2D;
}): Matrix2D | null {
	if (from === to) return matrix;
	if (from === "local") return composeMatrix(structuralParentWorld, matrix);
	const inverse = invertMatrix(structuralParentWorld);
	return inverse ? composeMatrix(inverse, matrix) : null;
}
