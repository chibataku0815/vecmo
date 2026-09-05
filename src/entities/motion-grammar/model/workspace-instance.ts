import { createNode } from "@/entities/scene/model/factory";
import { findLayerByNodeId, findNode } from "@/entities/scene/model/selectors";
import type {
	Artboard,
	Bounds,
	SceneDocument,
	SceneLayer,
	VectorNode,
} from "@/entities/scene/model/types";
import type { AePoint, AeShape } from "@/shared/glammer/ae-shape";
import { createId } from "@/shared/lib/id";
import { findCatalogEntry } from "./catalog";
import {
	COUNT_GROWTH_ARM_ROLE,
	COUNT_GROWTH_CORE_ROLE,
	COUNT_GROWTH_EDGE_ROLE,
} from "./count-growth-v1";
import type { MotionGrammarBinding, MotionGrammarTechniqueId } from "./types";
import { createMotionGrammarNewBindingDefaults } from "./versioned-expression-binding";

export const MOTION_GRAMMAR_WORKSPACE_ROLE_DATA_KEY =
	"motionGrammarWorkspaceRole";

export type MotionGrammarWorkspaceRoleKey = string;

export type MotionGrammarWorkspaceRoleData = {
	readonly kind: "motion-grammar-workspace-role";
	readonly schemaVersion: 1;
	readonly bindingId: string;
	readonly techniqueId: MotionGrammarTechniqueId;
	readonly role: MotionGrammarWorkspaceRoleKey;
	readonly roleLabel: string;
	readonly generated: boolean;
	readonly replaceable: boolean;
};

export type MotionGrammarWorkspaceInstanceNode = {
	readonly node: VectorNode;
	readonly role: MotionGrammarWorkspaceRoleKey;
	readonly roleLabel: string;
};

export type MotionGrammarWorkspaceInstancePlan =
	| {
			readonly status: "blocked";
			readonly reason: string;
	  }
	| {
			readonly status: "ready";
			readonly techniqueId: MotionGrammarTechniqueId;
			readonly binding: MotionGrammarBinding;
			readonly layerId?: string;
			readonly generatedNodes: readonly MotionGrammarWorkspaceInstanceNode[];
			readonly roleMap: Readonly<Record<string, string>>;
			readonly selectedSourceNodeIds: readonly string[];
			readonly nextSelectionNodeIds: readonly string[];
	  };

type WorkspaceRoleTone =
	| "artifact"
	| "constraint"
	| "echo"
	| "field"
	| "follower"
	| "member"
	| "path"
	| "source"
	| "spatial";

type WorkspaceRoleShape = "ellipse" | "path" | "rect";

type WorkspaceLayout =
	| "ordered-row"
	| "paired"
	| "ring"
	| "single"
	| "split"
	| "stack"
	| "triangle";

type MotionGrammarWorkspaceRoleRecipe = {
	readonly key: MotionGrammarWorkspaceRoleKey;
	readonly label: string;
	readonly kind: WorkspaceRoleShape;
	readonly tone: WorkspaceRoleTone;
	readonly sizeScale?: number;
};

type MotionGrammarWorkspaceRecipe = {
	readonly layout: WorkspaceLayout;
	readonly roles: readonly MotionGrammarWorkspaceRoleRecipe[];
	readonly repeatRoleLabel?: string;
	readonly repeatRoleKey?: MotionGrammarWorkspaceRoleKey;
	readonly repeatKind?: WorkspaceRoleShape;
	readonly repeatTone?: WorkspaceRoleTone;
};

const role = (
	techniqueId: MotionGrammarTechniqueId,
	key: string,
	label: string,
	kind: WorkspaceRoleShape,
	tone: WorkspaceRoleTone,
	options: { readonly sizeScale?: number } = {},
): MotionGrammarWorkspaceRoleRecipe => ({
	key: `${techniqueId}:${key}`,
	label,
	kind,
	tone,
	...options,
});

/**
 * Technique-specific workspace recipes. These are not generic missing-target
 * placeholders: each slot names the semantic object role the preset needs in
 * the workspace so replacement can preserve the motion structure.
 */
const MOTION_GRAMMAR_WORKSPACE_RECIPES = {
	"time-delay": {
		layout: "ordered-row",
		repeatRoleLabel: "delayed target",
		repeatKind: "ellipse",
		repeatTone: "follower",
		roles: [
			role("time-delay", "driver", "delay driver", "rect", "source"),
			role("time-delay", "follower", "delayed follower", "ellipse", "follower"),
		],
	},
	"random-phase-pulse": {
		layout: "single",
		repeatRoleLabel: "pulse cell",
		repeatKind: "ellipse",
		repeatTone: "field",
		roles: [
			role("random-phase-pulse", "cell", "pulse cell", "ellipse", "field"),
		],
	},
	"mirror-symmetric-scale": {
		layout: "ordered-row",
		repeatRoleLabel: "symmetric member",
		repeatKind: "ellipse",
		repeatTone: "constraint",
		roles: [
			role(
				"mirror-symmetric-scale",
				"outer-left",
				"outer left",
				"ellipse",
				"constraint",
			),
			role(
				"mirror-symmetric-scale",
				"outer-right",
				"outer right",
				"ellipse",
				"constraint",
			),
			role(
				"mirror-symmetric-scale",
				"inner-left",
				"inner left",
				"ellipse",
				"constraint",
			),
			role(
				"mirror-symmetric-scale",
				"inner-right",
				"inner right",
				"ellipse",
				"constraint",
			),
			role("mirror-symmetric-scale", "center", "center", "ellipse", "source"),
		],
	},
	"time-offset-propagation": {
		layout: "ordered-row",
		repeatRoleLabel: "offset slot",
		repeatKind: "ellipse",
		repeatTone: "follower",
		roles: [
			role(
				"time-offset-propagation",
				"slot-1",
				"offset slot 1",
				"ellipse",
				"follower",
			),
			role(
				"time-offset-propagation",
				"slot-2",
				"offset slot 2",
				"ellipse",
				"follower",
			),
			role(
				"time-offset-propagation",
				"slot-3",
				"offset slot 3",
				"ellipse",
				"follower",
			),
			role(
				"time-offset-propagation",
				"slot-4",
				"offset slot 4",
				"ellipse",
				"follower",
			),
			role(
				"time-offset-propagation",
				"slot-5",
				"offset slot 5",
				"ellipse",
				"follower",
			),
		],
	},
	"ring-wave-interference": {
		layout: "triangle",
		repeatRoleLabel: "ring follower",
		repeatRoleKey: "ring-wave-interference:follower",
		repeatKind: "ellipse",
		repeatTone: "field",
		roles: [
			role(
				"ring-wave-interference",
				"driver",
				"orbit driver",
				"ellipse",
				"source",
			),
			role(
				"ring-wave-interference",
				"follower",
				"ring follower",
				"ellipse",
				"field",
			),
			role("ring-wave-interference", "center", "field center", "rect", "field"),
		],
	},
	"planar-solid-tumble": {
		layout: "single",
		repeatRoleLabel: "tumble solid",
		repeatKind: "rect",
		repeatTone: "spatial",
		roles: [
			role("planar-solid-tumble", "solid", "tumble solid", "rect", "spatial", {
				sizeScale: 1.15,
			}),
		],
	},
	"boolean-difference-rotation": {
		layout: "paired",
		repeatRoleLabel: "difference operand",
		repeatKind: "ellipse",
		repeatTone: "artifact",
		roles: [
			role(
				"boolean-difference-rotation",
				"cutter",
				"boolean cutter",
				"ellipse",
				"source",
			),
			role(
				"boolean-difference-rotation",
				"target",
				"difference target",
				"rect",
				"artifact",
				{ sizeScale: 1.1 },
			),
		],
	},
	"inverse-proportion-link": {
		layout: "paired",
		repeatRoleLabel: "inverse follower",
		repeatKind: "ellipse",
		repeatTone: "constraint",
		roles: [
			role(
				"inverse-proportion-link",
				"driver",
				"scale driver",
				"ellipse",
				"source",
			),
			role(
				"inverse-proportion-link",
				"follower",
				"inverse follower",
				"ellipse",
				"constraint",
			),
		],
	},
	"arrangement-transition": {
		layout: "triangle",
		repeatRoleLabel: "arrangement member",
		repeatKind: "ellipse",
		repeatTone: "member",
		roles: [
			role(
				"arrangement-transition",
				"source",
				"arrangement source",
				"rect",
				"source",
			),
			role(
				"arrangement-transition",
				"member-a",
				"arrangement member A",
				"ellipse",
				"member",
			),
			role(
				"arrangement-transition",
				"member-b",
				"arrangement member B",
				"rect",
				"follower",
			),
		],
	},
	"shear-split": {
		layout: "split",
		repeatRoleLabel: "split layer",
		repeatKind: "rect",
		repeatTone: "spatial",
		roles: [
			role("shear-split", "source", "shear source", "rect", "source"),
			role("shear-split", "layer", "split layer", "rect", "spatial"),
		],
	},
	"merge-split-cycle": {
		layout: "ring",
		repeatRoleLabel: "merge member",
		repeatRoleKey: "merge-split-cycle:member",
		repeatKind: "ellipse",
		repeatTone: "member",
		roles: [
			role("merge-split-cycle", "core", "merge core", "ellipse", "source", {
				sizeScale: 1.15,
			}),
			role(
				"merge-split-cycle",
				"member",
				"merge member 1",
				"ellipse",
				"member",
			),
		],
	},
	"count-growth": {
		layout: "stack",
		repeatRoleLabel: "count member",
		repeatRoleKey: "count-growth:member",
		repeatKind: "rect",
		repeatTone: "member",
		roles: [
			role(
				"count-growth",
				COUNT_GROWTH_CORE_ROLE,
				"count core",
				"ellipse",
				"source",
			),
			role(
				"count-growth",
				COUNT_GROWTH_ARM_ROLE,
				"count arm",
				"ellipse",
				"field",
			),
			role(
				"count-growth",
				COUNT_GROWTH_EDGE_ROLE,
				"count edge",
				"ellipse",
				"constraint",
			),
		],
	},
	"periodic-afterimage": {
		layout: "single",
		repeatRoleLabel: "echo source",
		repeatKind: "rect",
		repeatTone: "echo",
		roles: [
			role("periodic-afterimage", "source", "echo source", "rect", "echo", {
				sizeScale: 1.1,
			}),
		],
	},
	"cyclic-path-travel": {
		layout: "paired",
		repeatRoleLabel: "path body",
		repeatKind: "ellipse",
		repeatTone: "path",
		roles: [
			role("cyclic-path-travel", "body", "path body", "ellipse", "path"),
			role("cyclic-path-travel", "path", "motion path", "path", "path", {
				sizeScale: 1.45,
			}),
		],
	},
	"auto-orient-along-path": {
		layout: "single",
		repeatRoleLabel: "orienting object",
		repeatKind: "rect",
		repeatTone: "path",
		roles: [
			role(
				"auto-orient-along-path",
				"object",
				"orienting object",
				"rect",
				"path",
			),
		],
	},
	"size-speed-parallax": {
		layout: "ordered-row",
		repeatRoleLabel: "near parallax layer",
		repeatRoleKey: "size-speed-parallax:near",
		repeatKind: "ellipse",
		repeatTone: "spatial",
		roles: [
			role("size-speed-parallax", "near", "near layer", "ellipse", "spatial"),
			role("size-speed-parallax", "mid", "mid layer", "ellipse", "spatial"),
			role("size-speed-parallax", "far", "far layer", "ellipse", "spatial"),
		],
	},
	"reactive-neighbor-displacement": {
		layout: "paired",
		repeatRoleLabel: "reactive neighbor",
		repeatKind: "ellipse",
		repeatTone: "constraint",
		roles: [
			role(
				"reactive-neighbor-displacement",
				"driver",
				"reactive driver",
				"rect",
				"source",
			),
			role(
				"reactive-neighbor-displacement",
				"neighbor",
				"reactive neighbor",
				"ellipse",
				"constraint",
			),
		],
	},
	"lag-follow-through": {
		layout: "ordered-row",
		repeatRoleLabel: "follow-through follower",
		repeatRoleKey: "lag-follow-through:follower",
		repeatKind: "ellipse",
		repeatTone: "follower",
		roles: [
			role(
				"lag-follow-through",
				"leader",
				"follow-through leader",
				"rect",
				"source",
			),
			role(
				"lag-follow-through",
				"follower",
				"follow-through follower",
				"ellipse",
				"follower",
			),
		],
	},
	// Unused placeholder: noise-wipe seeds/animates the selected target's own
	// recipe (see NoiseWipeTechniqueModule) and never calls
	// createMotionGrammarWorkspaceInstancePlan, so this row is never read. It
	// exists only because MOTION_GRAMMAR_WORKSPACE_RECIPES is a total record over
	// MotionGrammarTechniqueId.
	"noise-wipe": {
		layout: "single",
		repeatRoleLabel: "noise-wipe target",
		repeatKind: "rect",
		repeatTone: "field",
		roles: [role("noise-wipe", "target", "noise-wipe target", "rect", "field")],
	},
	// Draw-on applies its grammar binding directly to an already-committed path
	// node; it never calls createMotionGrammarWorkspaceInstancePlan, so this row is
	// never read. It exists only because MOTION_GRAMMAR_WORKSPACE_RECIPES is a
	// total record over MotionGrammarTechniqueId (mirrors the noise-wipe row).
	"stroke-draw-on": {
		layout: "single",
		repeatRoleLabel: "draw-on stroke",
		repeatKind: "rect",
		repeatTone: "field",
		roles: [
			role("stroke-draw-on", "stroke", "draw-on stroke", "rect", "field"),
		],
	},
	// Mirrors cyclic-path-travel's body/path split: `subject` repeats per
	// selected/generated bounce body, `support` is the shared optional
	// collision-receiver guide (see collision-bounce-v1.ts's `support` role;
	// only `supportMode: radial-from-support` reads it — `floor-line` ignores
	// the generated node and works from `travelAxisDegrees`/`floorOffsetPx`
	// alone, per bounce-canonical-representation.md).
	"collision-bounce": {
		layout: "paired",
		repeatRoleLabel: "bounce subject",
		repeatKind: "ellipse",
		repeatTone: "member",
		roles: [
			role(
				"collision-bounce",
				"subject",
				"bounce subject",
				"ellipse",
				"member",
			),
			role(
				"collision-bounce",
				"support",
				"bounce support",
				"rect",
				"constraint",
				{
					sizeScale: 1.3,
				},
			),
		],
	},
} as const satisfies Readonly<
	Record<MotionGrammarTechniqueId, MotionGrammarWorkspaceRecipe>
>;

const ROLE_TONE_STYLES = {
	artifact: { fill: "#ff5a5f", stroke: "#191817", strokeWidth: 4 },
	constraint: { fill: "#7aa2ff", stroke: "#191817", strokeWidth: 4 },
	echo: { fill: "#b68cff", stroke: "#191817", strokeWidth: 4 },
	field: { fill: "#73d13d", stroke: "#191817", strokeWidth: 4 },
	follower: { fill: "#ff7a90", stroke: "#191817", strokeWidth: 4 },
	member: { fill: "#f4c430", stroke: "#191817", strokeWidth: 4 },
	path: { fill: "#4cc9f0", stroke: "#191817", strokeWidth: 4 },
	source: { fill: "#2ec4b6", stroke: "#191817", strokeWidth: 4 },
	spatial: { fill: "#ffb000", stroke: "#191817", strokeWidth: 4 },
} as const satisfies Readonly<
	Record<
		WorkspaceRoleTone,
		{
			readonly fill: string;
			readonly stroke: string;
			readonly strokeWidth: number;
		}
	>
>;

const currentArtboard = (scene: SceneDocument): Artboard =>
	(scene.artboards ?? [scene.artboard]).find(
		(artboard) => artboard.id === scene.currentArtboardId,
	) ??
	scene.artboards?.[0] ??
	scene.artboard;

const editableLayer = (
	scene: SceneDocument,
	selectedNodeIds: readonly string[],
): SceneLayer | undefined => {
	for (const nodeId of selectedNodeIds) {
		const layer = findLayerByNodeId(scene, nodeId);
		if (layer?.visible && !layer.locked) return layer;
	}
	return [...scene.layers]
		.reverse()
		.find((layer) => layer.visible && !layer.locked);
};

const uniqueExistingSelection = (
	scene: SceneDocument,
	selectedNodeIds: readonly string[],
): readonly string[] => {
	const existing: string[] = [];
	const seen = new Set<string>();
	for (const nodeId of selectedNodeIds) {
		if (seen.has(nodeId)) continue;
		if (!findNode(scene, nodeId)) continue;
		seen.add(nodeId);
		existing.push(nodeId);
	}
	return existing;
};

const normalizedLayoutOffset = ({
	layout,
	roleCount,
	roleIndex,
}: {
	readonly layout: WorkspaceLayout;
	readonly roleCount: number;
	readonly roleIndex: number;
}): { readonly x: number; readonly y: number } => {
	if (roleCount <= 1 || layout === "single") return { x: 0, y: 0 };
	switch (layout) {
		case "ordered-row":
			return { x: roleIndex - (roleCount - 1) / 2, y: 0 };
		case "paired":
			return { x: roleIndex === 0 ? -0.75 : 0.75, y: 0 };
		case "split":
			return {
				x: roleIndex % 2 === 0 ? -0.8 : 0.8,
				y: roleIndex > 1 ? 0.65 : 0,
			};
		case "stack": {
			const offset = roleIndex - (roleCount - 1) / 2;
			return { x: offset * 0.45, y: offset * 0.32 };
		}
		case "triangle":
			if (roleCount === 3) {
				return [
					{ x: -0.95, y: 0.35 },
					{ x: 0.1, y: -0.75 },
					{ x: 0.85, y: 0.45 },
				][roleIndex];
			}
			break;
		case "ring":
			break;
	}
	const angle = -Math.PI / 2 + (roleIndex / roleCount) * Math.PI * 2;
	return { x: Math.cos(angle), y: Math.sin(angle) };
};

const clamp = (value: number, min: number, max: number): number =>
	Math.max(min, Math.min(max, value));

const roleBounds = ({
	artboard,
	layout,
	role,
	roleCount,
	roleIndex,
}: {
	readonly artboard: Artboard;
	readonly layout: WorkspaceLayout;
	readonly role: MotionGrammarWorkspaceRoleRecipe;
	readonly roleCount: number;
	readonly roleIndex: number;
}): Bounds => {
	const baseSize = Math.max(56, Math.min(104, artboard.width / 8));
	const size = baseSize * (role.sizeScale ?? 1);
	const centerX = artboard.width * 0.5;
	const centerY = artboard.height * 0.56;
	const offset = normalizedLayoutOffset({ layout, roleCount, roleIndex });
	const spread = baseSize * (roleCount > 3 ? 1.35 : 1.55);
	return {
		x: clamp(
			centerX + offset.x * spread - size / 2,
			32,
			artboard.width - size - 32,
		),
		y: clamp(
			centerY + offset.y * spread - size / 2,
			32,
			artboard.height - size - 32,
		),
		width: size,
		height: size,
	};
};

const PATH_KAPPA = 0.5522847498307936;

const pathShapeForBounds = (bounds: Bounds): AeShape => {
	const rx = Math.max(bounds.width / 2, 1);
	const ry = Math.max(bounds.height / 2, 1);
	const cx = bounds.x + bounds.width / 2;
	const cy = bounds.y + bounds.height / 2;
	const kx = rx * PATH_KAPPA;
	const ky = ry * PATH_KAPPA;
	const point = (x: number, y: number): AePoint => [x, y];
	return {
		type: "Shape",
		closed: true,
		vertices: [
			point(cx + rx, cy),
			point(cx, cy + ry),
			point(cx - rx, cy),
			point(cx, cy - ry),
		],
		inTangents: [point(0, -ky), point(kx, 0), point(0, ky), point(-kx, 0)],
		outTangents: [point(0, ky), point(-kx, 0), point(0, -ky), point(kx, 0)],
	};
};

const roleRecipeAt = ({
	recipe,
	roleIndex,
	techniqueId,
}: {
	readonly recipe: MotionGrammarWorkspaceRecipe;
	readonly roleIndex: number;
	readonly techniqueId: MotionGrammarTechniqueId;
}): MotionGrammarWorkspaceRoleRecipe => {
	const defined = recipe.roles[roleIndex];
	if (defined) return defined;
	const ordinal = roleIndex + 1;
	const labelBase = recipe.repeatRoleLabel ?? "motion target";
	return {
		key: recipe.repeatRoleKey ?? `${techniqueId}:target-${ordinal}`,
		label: `${labelBase} ${ordinal}`,
		kind: recipe.repeatKind ?? "rect",
		tone: recipe.repeatTone ?? "member",
	};
};

/** Resolves a stored workspace-role key to its current display label. */
export function motionGrammarWorkspaceRoleLabel(
	techniqueId: MotionGrammarTechniqueId,
	roleKeyOrLabel: string,
): string {
	if (techniqueId === "time-delay") {
		const match = /^time-delay:dot-(\d+):(body|satellite)$/.exec(
			roleKeyOrLabel,
		);
		if (match) return `dot ${match[1]} ${match[2]}`;
	}
	const recipe = MOTION_GRAMMAR_WORKSPACE_RECIPES[techniqueId];
	const defined = recipe.roles.find((role) => role.key === roleKeyOrLabel);
	if (defined) return defined.label;
	const repeatPrefix = `${techniqueId}:target-`;
	if (roleKeyOrLabel.startsWith(repeatPrefix)) {
		const ordinal = Number(roleKeyOrLabel.slice(repeatPrefix.length));
		if (Number.isInteger(ordinal) && ordinal > 0) {
			return `${recipe.repeatRoleLabel ?? "motion target"} ${ordinal}`;
		}
	}
	return roleKeyOrLabel;
}

const createRoleNode = ({
	artboard,
	bindingId,
	layout,
	role,
	roleCount,
	roleIndex,
	techniqueId,
}: {
	readonly artboard: Artboard;
	readonly bindingId: string;
	readonly layout: WorkspaceLayout;
	readonly role: MotionGrammarWorkspaceRoleRecipe;
	readonly roleCount: number;
	readonly roleIndex: number;
	readonly techniqueId: MotionGrammarTechniqueId;
}): VectorNode => {
	const bounds = roleBounds({ artboard, layout, role, roleCount, roleIndex });
	const style = ROLE_TONE_STYLES[role.tone];
	const node =
		role.kind === "ellipse"
			? createNode(
					"ellipse",
					{ kind: "ellipse", bounds },
					{
						name: role.label,
						style,
					},
				)
			: role.kind === "path"
				? createNode(
						"path",
						{ kind: "path", shape: pathShapeForBounds(bounds) },
						{
							name: role.label,
							style: {
								...style,
								fill: "transparent",
								strokeWidth: Math.max(2, style.strokeWidth),
							},
						},
					)
				: createNode(
						"rect",
						{
							kind: "rect",
							bounds,
							cornerRadius: Math.min(18, bounds.width * 0.16),
						},
						{
							name: role.label,
							style,
						},
					);
	const roleData: MotionGrammarWorkspaceRoleData = {
		kind: "motion-grammar-workspace-role",
		schemaVersion: 1,
		bindingId,
		techniqueId,
		role: role.key,
		roleLabel: role.label,
		generated: true,
		replaceable: true,
	};
	return {
		...node,
		artboardId: artboard.id,
		data: {
			...node.data,
			[MOTION_GRAMMAR_WORKSPACE_ROLE_DATA_KEY]: roleData,
		},
	};
};

/**
 * Plans a concrete role-bearing workspace system for a motion preset. Selected
 * scene nodes become leading roles; missing required roles are generated as
 * editable, replaceable scene nodes. If the selection already supplies every
 * role, the plan still creates the semantic binding and role map instead of
 * falling back to generic target application.
 */
export function createMotionGrammarWorkspaceInstancePlan({
	techniqueId,
	scene,
	selectedNodeIds,
	bindingId = createId("motion-binding"),
}: {
	readonly techniqueId: MotionGrammarTechniqueId;
	readonly scene: SceneDocument;
	readonly selectedNodeIds: readonly string[];
	readonly bindingId?: string;
}): MotionGrammarWorkspaceInstancePlan {
	const entry = findCatalogEntry(techniqueId);
	if (entry?.status !== "implemented") {
		return {
			status: "blocked",
			reason: "Selected motion preset is not implemented.",
		};
	}
	const recipe = MOTION_GRAMMAR_WORKSPACE_RECIPES[techniqueId];
	if (!recipe) {
		return {
			status: "blocked",
			reason: "This motion preset does not have a workspace system yet.",
		};
	}
	if (scene.layers.length === 0) {
		return {
			status: "blocked",
			reason: "Scene has no editable layer for a motion workspace system.",
		};
	}
	const selectedSourceNodeIds = uniqueExistingSelection(scene, selectedNodeIds);
	const initialDefaults = createMotionGrammarNewBindingDefaults(
		techniqueId,
		selectedSourceNodeIds,
	);
	if (initialDefaults.status === "blocked") return initialDefaults;
	const roleCount = Math.max(
		entry.minTargets,
		recipe.roles.length,
		selectedSourceNodeIds.length,
	);
	const layer = editableLayer(scene, selectedSourceNodeIds);
	if (!layer) {
		return {
			status: "blocked",
			reason: "No visible unlocked layer can receive the motion system.",
		};
	}

	const artboard = currentArtboard(scene);
	const generatedNodes: MotionGrammarWorkspaceInstanceNode[] = [];
	const targetIds = [...selectedSourceNodeIds];
	const roleMap: Record<string, string> = {};

	for (let index = 0; index < roleCount; index += 1) {
		const role = roleRecipeAt({ recipe, roleIndex: index, techniqueId });
		const selectedNodeId = selectedSourceNodeIds[index];
		if (selectedNodeId) {
			roleMap[selectedNodeId] = role.key;
			continue;
		}
		const node = createRoleNode({
			artboard,
			bindingId,
			layout: recipe.layout,
			role,
			roleCount,
			roleIndex: index,
			techniqueId,
		});
		generatedNodes.push({
			node,
			role: role.key,
			roleLabel: role.label,
		});
		targetIds.push(node.id);
		roleMap[node.id] = role.key;
	}

	const bindingDefaults = createMotionGrammarNewBindingDefaults(
		techniqueId,
		targetIds,
	);
	if (bindingDefaults.status === "blocked") return bindingDefaults;
	const binding: MotionGrammarBinding = {
		id: bindingId,
		techniqueId,
		targetIds,
		roleMap: bindingDefaults.roleMap ?? roleMap,
		parameters: bindingDefaults.parameters,
		effectBinding: { kind: "none" },
	};

	return {
		status: "ready",
		techniqueId,
		binding,
		layerId: layer.id,
		generatedNodes,
		roleMap: bindingDefaults.roleMap ?? roleMap,
		selectedSourceNodeIds,
		nextSelectionNodeIds: targetIds,
	};
}
