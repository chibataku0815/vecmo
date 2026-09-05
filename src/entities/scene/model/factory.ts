import { createId } from "@/shared/lib/id";
import type {
	NodeGeometry,
	NodeStyle,
	Transform,
	VectorNode,
	VectorNodeKind,
} from "./types";
import { IDENTITY_TRANSFORM } from "./types";

const defaultStyle: NodeStyle = {
	fill: "#ebe7dd",
	stroke: "#191817",
	strokeWidth: 1,
	opacity: 1,
};

/**
 * Creates a serializable scene node with a minted id. Feature streams should use
 * this factory so node defaults remain consistent across tools.
 */
export function createNode(
	kind: VectorNodeKind,
	geometry: NodeGeometry,
	options: {
		readonly name?: string;
		readonly style?: Partial<NodeStyle>;
		readonly transform?: Partial<Transform>;
	} = {},
): VectorNode {
	if (geometry.kind !== kind) {
		throw new Error(`Geometry kind ${geometry.kind} does not match ${kind}.`);
	}

	return {
		id: createId("node"),
		name: options.name ?? `${kind} node`,
		geometry,
		transform: {
			...IDENTITY_TRANSFORM,
			...options.transform,
		},
		style: {
			...defaultStyle,
			...options.style,
		},
		visible: true,
		locked: false,
	};
}

const DEFAULT_LAYER_RECT_GEOMETRY = {
	kind: "rect",
	bounds: { x: 80, y: 80, width: 200, height: 160 },
	cornerRadius: 0,
} as const;

export function createDefaultLayerNode(): VectorNode {
	return createNode("rect", DEFAULT_LAYER_RECT_GEOMETRY, {
		name: "Rectangle",
	});
}

export function cloneSceneDocument<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}
