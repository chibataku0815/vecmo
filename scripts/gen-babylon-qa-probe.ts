import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Generates a self-contained binary glTF (`.glb`) material-probe scene used to
 * A/B the flag-gated Babylon PBR/IBL candidate against the Hemispheric/
 * Directional baseline (`src/shared/babylon/runtime.ts`, flag
 * `?babylonPbr=1` / `localStorage["vma:babylon-pbr"]`). No dependency is
 * added: the glTF 2.0 JSON chunk and the binary geometry chunk are both
 * hand-authored here, matching the existing hand-rolled encoders in
 * `scripts/gen-babylon-studio-env.ts` and
 * `scripts/generate-noise-gradient-cube-probe.ts`.
 *
 * The scene is a single row of UV spheres, one per material, so the only
 * variable between spheres is the PBR metallic-roughness response: metal at
 * three roughness values, dielectric at three roughness values, one emissive
 * sphere, and one alpha-blended transparent sphere. Every `baseColorFactor`
 * is achromatic mid-grey (0.5 linear) except where the probe spec calls for a
 * different value, so the A/B reads material response, not hue. This uses
 * only core PBR metallic-roughness: no `KHR_materials_*` extension.
 */

const OUTPUT_PATH = path.resolve(
	process.cwd(),
	"public/runtime-3d/qa-material-probe.glb",
);

/** UV-sphere tessellation. ~32x16 reads as smooth at the probe's on-screen size. */
const SPHERE_LONGITUDE_SEGMENTS = 32;
const SPHERE_LATITUDE_SEGMENTS = 16;
const SPHERE_RADIUS = 0.4;

/** Center-to-center X spacing between adjacent probe spheres, in scene units. */
const SPHERE_SPACING = 1.2;

/**
 * P6-B shadow-catcher ground plane, added only to this QA probe asset — never
 * to the product runtime path (`src/shared/babylon/runtime.ts` casts/receives
 * shadows only on real document GLB placement meshes; see the P6-B plan's
 * design decision 2). Sized off the sphere row's own geometry so the ground
 * scales automatically if the row spacing/count ever changes.
 */
const GROUND_MARGIN_RATIO = 1.2;
/** Ground depth (Z), expressed in sphere diameters, so it reads as a shallow catcher strip rather than an infinite floor. */
const GROUND_DEPTH_SPHERE_DIAMETERS = 2;
/** A thin box, not a zero-thickness plane, so its side faces have real (non-degenerate) winding and never backface-cull away. */
const GROUND_THICKNESS = 0.15;
const GROUND_BASE_COLOR = 0.6;
const GROUND_ROUGHNESS = 0.9;
const GROUND_METALLIC = 0;
const GROUND_NAME = "ground";

/** Shared achromatic mid-grey baseColor (linear) for every non-emissive material. */
const MID_GREY = 0.5;
/** Dark baseColor for the emissive material, so the emissive term reads clearly. */
const EMISSIVE_BASE_COLOR = 0.02;
/** Mid emissive strength: bright enough to read, not clipped. */
const EMISSIVE_STRENGTH = 0.5;
/** Fully rough emissive material so a specular highlight never competes with the glow. */
const EMISSIVE_ROUGHNESS = 1.0;
/** Alpha of the transparent probe's `BLEND` material. */
const TRANSPARENT_ALPHA = 0.35;

const GLB_MAGIC = 0x46546c67; // ASCII "glTF"
const GLB_VERSION = 2;
const GLB_JSON_CHUNK_TYPE = 0x4e4f534a; // ASCII "JSON"
const GLB_BIN_CHUNK_TYPE = 0x004e4942; // ASCII "BIN\0"
const GLB_HEADER_BYTE_LENGTH = 12;
const GLB_CHUNK_HEADER_BYTE_LENGTH = 8;
const GLB_CHUNK_ALIGNMENT = 4;
const GLB_JSON_PADDING_BYTE = 0x20; // ASCII space
const GLB_BIN_PADDING_BYTE = 0x00;

const VEC3_COMPONENT_COUNT = 3;

/** glTF accessor component type codes used by this probe. */
const ACCESSOR_COMPONENT_TYPE_FLOAT = 5126;
const ACCESSOR_COMPONENT_TYPE_UNSIGNED_SHORT = 5123;

/** glTF bufferView target codes. */
const ARRAY_BUFFER_TARGET = 34962;
const ELEMENT_ARRAY_BUFFER_TARGET = 34963;

type Vec3 = readonly [number, number, number];

type SphereGeometry = {
	readonly positions: readonly Vec3[];
	readonly normals: readonly Vec3[];
	readonly indices: readonly number[];
};

/**
 * Builds one radius-`SPHERE_RADIUS` UV sphere centered at the origin, using
 * the standard latitude/longitude grid (e.g. songho.ca/opengl/gl_sphere.html):
 * `(SPHERE_LATITUDE_SEGMENTS + 1)` rows from the north to the south pole,
 * `(SPHERE_LONGITUDE_SEGMENTS + 1)` columns per row (the seam column is
 * duplicated for a regular grid). Degenerate polar triangles are skipped
 * rather than emitted, since a sphere centered at the origin makes every
 * normal equal to the normalized position.
 */
const buildSphereGeometry = (): SphereGeometry => {
	const positions: Vec3[] = [];
	const normals: Vec3[] = [];
	for (let row = 0; row <= SPHERE_LATITUDE_SEGMENTS; row += 1) {
		const polarAngle = (row * Math.PI) / SPHERE_LATITUDE_SEGMENTS;
		const sinPolar = Math.sin(polarAngle);
		const cosPolar = Math.cos(polarAngle);
		for (let col = 0; col <= SPHERE_LONGITUDE_SEGMENTS; col += 1) {
			const azimuthAngle = (col * 2 * Math.PI) / SPHERE_LONGITUDE_SEGMENTS;
			const unit: Vec3 = [
				sinPolar * Math.cos(azimuthAngle),
				cosPolar,
				sinPolar * Math.sin(azimuthAngle),
			];
			normals.push(unit);
			positions.push([
				unit[0] * SPHERE_RADIUS,
				unit[1] * SPHERE_RADIUS,
				unit[2] * SPHERE_RADIUS,
			]);
		}
	}

	const indices: number[] = [];
	const columnsPerRow = SPHERE_LONGITUDE_SEGMENTS + 1;
	for (let row = 0; row < SPHERE_LATITUDE_SEGMENTS; row += 1) {
		for (let col = 0; col < SPHERE_LONGITUDE_SEGMENTS; col += 1) {
			const current = row * columnsPerRow + col;
			const next = current + columnsPerRow;
			// glTF requires counter-clockwise winding as seen from the outside
			// (the side the NORMAL attribute points toward). Vertex order here is
			// deliberately (current, current + 1, next) rather than the more
			// "obvious" (current, next, current + 1) grid-quad order: the latter
			// is wound clockwise-from-outside for this vertex layout (confirmed
			// by cross-product-vs-vertex-normal dot products at both a
			// mid-latitude and a polar triangle — both negative), which put every
			// triangle's declared front face on the sphere's INSIDE. WebGL's
			// default backface culling then discarded the correctly-facing near
			// side and kept the far (inside) side, whose still-correct outward
			// NORMAL attribute faces away from the camera — killing N·V and, with
			// it, PBR/IBL specular reflection (metals rendered black).
			if (row !== 0) {
				indices.push(current, current + 1, next);
			}
			if (row !== SPHERE_LATITUDE_SEGMENTS - 1) {
				indices.push(current + 1, next + 1, next);
			}
		}
	}

	return { positions, normals, indices };
};

type AxisBounds = { readonly min: number; readonly max: number };
type BoxBounds = {
	readonly x: AxisBounds;
	readonly y: AxisBounds;
	readonly z: AxisBounds;
};
type Axis = "x" | "y" | "z";

const axisCenter = (bounds: AxisBounds): number =>
	(bounds.min + bounds.max) / 2;
const axisHalfExtent = (bounds: AxisBounds): number =>
	(bounds.max - bounds.min) / 2;

/**
 * One axis-aligned box face: `normalAxis`/`normalSign` picks the fixed
 * coordinate and outward direction; `uAxis`/`vAxis` are the face's in-plane
 * tangent axes. Every entry below was chosen so that `uAxis × vAxis` (as
 * world-space unit vectors) equals the face's outward normal — see this
 * module's box-winding derivation. That is what makes the fixed vertex order
 * in `buildFaceVertices` (`-u-v, +u-v, +u+v, -u+v`) counter-clockwise as seen
 * from outside the box for every face, without per-face special-casing.
 */
type BoxFace = {
	readonly normalAxis: Axis;
	readonly normalSign: 1 | -1;
	readonly uAxis: Axis;
	readonly vAxis: Axis;
};

const BOX_FACES: readonly BoxFace[] = [
	{ normalAxis: "x", normalSign: 1, uAxis: "y", vAxis: "z" },
	{ normalAxis: "x", normalSign: -1, uAxis: "z", vAxis: "y" },
	{ normalAxis: "y", normalSign: 1, uAxis: "z", vAxis: "x" },
	{ normalAxis: "y", normalSign: -1, uAxis: "x", vAxis: "z" },
	{ normalAxis: "z", normalSign: 1, uAxis: "x", vAxis: "y" },
	{ normalAxis: "z", normalSign: -1, uAxis: "y", vAxis: "x" },
];

const unitVector = (axis: Axis, sign: 1 | -1): Vec3 => {
	const magnitude = sign;
	if (axis === "x") return [magnitude, 0, 0];
	if (axis === "y") return [0, magnitude, 0];
	return [0, 0, magnitude];
};

const vec3Cross = (a: Vec3, b: Vec3): Vec3 => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
];

const vec3Dot = (a: Vec3, b: Vec3): number =>
	a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const vec3Subtract = (a: Vec3, b: Vec3): Vec3 => [
	a[0] - b[0],
	a[1] - b[1],
	a[2] - b[2],
];

/**
 * Builds one axis-aligned box's geometry from its per-axis bounds, flat-
 * shaded (one normal per face, 4 duplicated vertices per face, 24 total).
 * Every triangle's winding is verified against its own face normal below
 * (`assertOutwardWinding`) using the same cross-product-vs-normal dot check
 * that diagnosed the earlier sphere winding bug (see `buildSphereGeometry`'s
 * comment): a regression here fails asset generation instead of silently
 * shipping inside-out shadow-catcher faces.
 */
const buildGroundBoxGeometry = (bounds: BoxBounds): SphereGeometry => {
	const positions: Vec3[] = [];
	const normals: Vec3[] = [];
	const indices: number[] = [];
	for (const face of BOX_FACES) {
		const normal = unitVector(face.normalAxis, face.normalSign);
		const normalCoordinate =
			face.normalSign > 0
				? bounds[face.normalAxis].max
				: bounds[face.normalAxis].min;
		const uCenter = axisCenter(bounds[face.uAxis]);
		const vCenter = axisCenter(bounds[face.vAxis]);
		const halfU = axisHalfExtent(bounds[face.uAxis]);
		const halfV = axisHalfExtent(bounds[face.vAxis]);
		const corner = (signU: 1 | -1, signV: 1 | -1): Vec3 => {
			const point: [number, number, number] = [0, 0, 0];
			const axisIndex: Record<Axis, number> = { x: 0, y: 1, z: 2 };
			point[axisIndex[face.normalAxis]] = normalCoordinate;
			point[axisIndex[face.uAxis]] = uCenter + signU * halfU;
			point[axisIndex[face.vAxis]] = vCenter + signV * halfV;
			return point;
		};
		const faceVertices: readonly Vec3[] = [
			corner(-1, -1),
			corner(1, -1),
			corner(1, 1),
			corner(-1, 1),
		];
		const baseIndex = positions.length;
		for (const vertex of faceVertices) {
			positions.push(vertex);
			normals.push(normal);
		}
		indices.push(
			baseIndex,
			baseIndex + 1,
			baseIndex + 2,
			baseIndex,
			baseIndex + 2,
			baseIndex + 3,
		);
	}
	return { positions, normals, indices };
};

/**
 * Fails asset generation if any triangle's geometric winding disagrees with
 * its declared vertex normal (dot product of the two must be positive). This
 * is the same check that previously caught the sphere mesh's inside-out
 * front faces (see `buildSphereGeometry`'s winding comment) — run here at
 * generation time instead of by eye, since a regression would silently
 * produce a shadow-catcher that fails to receive shadows on its topside.
 */
const assertOutwardWinding = (
	geometry: SphereGeometry,
	label: string,
): void => {
	const { positions, normals, indices } = geometry;
	for (
		let triangleIndex = 0;
		triangleIndex < indices.length;
		triangleIndex += 3
	) {
		const i0 = indices[triangleIndex];
		const i1 = indices[triangleIndex + 1];
		const i2 = indices[triangleIndex + 2];
		if (i0 === undefined || i1 === undefined || i2 === undefined) {
			throw new Error(`${label}: malformed triangle at index ${triangleIndex}`);
		}
		const p0 = positions[i0];
		const p1 = positions[i1];
		const p2 = positions[i2];
		const n0 = normals[i0];
		if (!p0 || !p1 || !p2 || !n0) {
			throw new Error(
				`${label}: missing vertex data for triangle ${triangleIndex / 3}`,
			);
		}
		const faceNormal = vec3Cross(vec3Subtract(p1, p0), vec3Subtract(p2, p0));
		if (vec3Dot(faceNormal, n0) <= 0) {
			throw new Error(
				`${label}: triangle ${triangleIndex / 3} is wound inward (face normal disagrees with vertex normal)`,
			);
		}
	}
};

/** Component-wise min/max across a flat `Vec3` list, required for the POSITION accessor. */
const vec3Bounds = (
	values: readonly Vec3[],
): { readonly min: Vec3; readonly max: Vec3 } => {
	const min: [number, number, number] = [Infinity, Infinity, Infinity];
	const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
	for (const value of values) {
		for (let axis = 0; axis < VEC3_COMPONENT_COUNT; axis += 1) {
			const component = value[axis];
			if (component === undefined) continue;
			if (component < min[axis]) min[axis] = component;
			if (component > max[axis]) max[axis] = component;
		}
	}
	return { min, max };
};

const scalarBounds = (
	values: readonly number[],
): { readonly min: number; readonly max: number } => ({
	min: Math.min(...values),
	max: Math.max(...values),
});

/** Pads `buffer` to a multiple of `GLB_CHUNK_ALIGNMENT` bytes using `fillByte`. */
const padToAlignment = (buffer: Buffer, fillByte: number): Buffer => {
	const remainder = buffer.byteLength % GLB_CHUNK_ALIGNMENT;
	if (remainder === 0) return buffer;
	const padding = Buffer.alloc(GLB_CHUNK_ALIGNMENT - remainder, fillByte);
	return Buffer.concat([buffer, padding]);
};

type MaterialSpec = {
	readonly name: string;
	readonly baseColor: readonly [number, number, number, number];
	readonly metallicFactor: number;
	readonly roughnessFactor: number;
	readonly emissiveFactor?: readonly [number, number, number];
	readonly alphaMode?: "BLEND";
};

/**
 * The eight probe materials, left to right: three metal roughness steps,
 * three dielectric roughness steps, one emissive, one alpha-blended
 * transparent dielectric. Order here is the order spheres are placed along X.
 */
const MATERIAL_SPECS: readonly MaterialSpec[] = [
	{
		name: "metal-rough-0.05",
		baseColor: [MID_GREY, MID_GREY, MID_GREY, 1],
		metallicFactor: 1,
		roughnessFactor: 0.05,
	},
	{
		name: "metal-rough-0.35",
		baseColor: [MID_GREY, MID_GREY, MID_GREY, 1],
		metallicFactor: 1,
		roughnessFactor: 0.35,
	},
	{
		name: "metal-rough-0.8",
		baseColor: [MID_GREY, MID_GREY, MID_GREY, 1],
		metallicFactor: 1,
		roughnessFactor: 0.8,
	},
	{
		name: "dielectric-rough-0.1",
		baseColor: [MID_GREY, MID_GREY, MID_GREY, 1],
		metallicFactor: 0,
		roughnessFactor: 0.1,
	},
	{
		name: "dielectric-rough-0.5",
		baseColor: [MID_GREY, MID_GREY, MID_GREY, 1],
		metallicFactor: 0,
		roughnessFactor: 0.5,
	},
	{
		name: "dielectric-rough-0.9",
		baseColor: [MID_GREY, MID_GREY, MID_GREY, 1],
		metallicFactor: 0,
		roughnessFactor: 0.9,
	},
	{
		name: "emissive",
		baseColor: [
			EMISSIVE_BASE_COLOR,
			EMISSIVE_BASE_COLOR,
			EMISSIVE_BASE_COLOR,
			1,
		],
		metallicFactor: 0,
		roughnessFactor: EMISSIVE_ROUGHNESS,
		emissiveFactor: [EMISSIVE_STRENGTH, EMISSIVE_STRENGTH, EMISSIVE_STRENGTH],
	},
	{
		name: "transparent",
		baseColor: [MID_GREY, MID_GREY, MID_GREY, TRANSPARENT_ALPHA],
		metallicFactor: 0,
		roughnessFactor: 0.15,
		alphaMode: "BLEND",
	},
];

const sphereGeometry = buildSphereGeometry();
const positionFloats = sphereGeometry.positions.flat();
const normalFloats = sphereGeometry.normals.flat();
const indexCount = sphereGeometry.indices.length;

const positionBuffer = Buffer.from(Float32Array.from(positionFloats).buffer);
const normalBuffer = Buffer.from(Float32Array.from(normalFloats).buffer);
const indexBuffer = Buffer.from(
	Uint16Array.from(sphereGeometry.indices).buffer,
);

const positionByteOffset = 0;
const normalByteOffset = positionBuffer.byteLength;
const indexByteOffset = normalByteOffset + normalBuffer.byteLength;

const positionBounds = vec3Bounds(sphereGeometry.positions);
const normalBounds = vec3Bounds(sphereGeometry.normals);
const indexBounds = scalarBounds(sphereGeometry.indices);

assertOutwardWinding(sphereGeometry, "sphere");

/**
 * Row occupancy along X, including sphere radius at both ends — the ground's
 * width is derived from this, not hand-picked, so it stays correct if the
 * sphere count/spacing ever changes.
 */
const rowOccupiedWidth =
	(MATERIAL_SPECS.length - 1) * SPHERE_SPACING + 2 * SPHERE_RADIUS;
const groundHalfWidth = (rowOccupiedWidth * GROUND_MARGIN_RATIO) / 2;
const groundHalfDepth = GROUND_DEPTH_SPHERE_DIAMETERS * SPHERE_RADIUS;
/**
 * Every probe sphere is centered at this glTF asset's local Y=0, in
 * conventional glTF Y-up space, so its local bottom sits at -radius and its
 * local top at +radius. The runtime's placement pipeline
 * (`toBabylonWorldMatrix` in `src/shared/babylon/runtime.ts`) negates the Y
 * (and Z) rows of every placement's world matrix as part of converting
 * Vecmo's Y-down authoring convention into Babylon's actual axes — for a
 * pure-scale placement matrix like this probe's, that negation mirrors the
 * whole loaded asset across Y. So the local face nearest the spheres'
 * rendered "underside" is this asset's local +Y boundary (`+SPHERE_RADIUS`),
 * not local -Y: placing the ground there is what makes it land as a floor
 * touching the spheres from below once rendered, instead of a ceiling
 * touching them from above.
 */
const groundNearY = SPHERE_RADIUS;
const groundFarY = groundNearY + GROUND_THICKNESS;

const groundGeometry = buildGroundBoxGeometry({
	x: { min: -groundHalfWidth, max: groundHalfWidth },
	y: { min: groundNearY, max: groundFarY },
	z: { min: -groundHalfDepth, max: groundHalfDepth },
});
assertOutwardWinding(groundGeometry, "ground");

const groundPositionFloats = groundGeometry.positions.flat();
const groundNormalFloats = groundGeometry.normals.flat();
const groundIndexCount = groundGeometry.indices.length;

const groundPositionBuffer = Buffer.from(
	Float32Array.from(groundPositionFloats).buffer,
);
const groundNormalBuffer = Buffer.from(
	Float32Array.from(groundNormalFloats).buffer,
);
const groundIndexBuffer = Buffer.from(
	Uint16Array.from(groundGeometry.indices).buffer,
);

/**
 * glTF requires an accessor's effective offset (bufferView + accessor
 * byteOffset) to be a multiple of its component size — 4 bytes for the
 * FLOAT position/normal accessors below. The sphere index buffer
 * (`UNSIGNED_SHORT`, 2 bytes/index) is not guaranteed to end on a 4-byte
 * boundary, so it is padded here before the ground's FLOAT buffers begin,
 * rather than relying on the sphere's current index count happening to be
 * even.
 */
const paddedIndexBuffer = padToAlignment(indexBuffer, GLB_BIN_PADDING_BYTE);
const groundPositionByteOffset = indexByteOffset + paddedIndexBuffer.byteLength;
const groundNormalByteOffset =
	groundPositionByteOffset + groundPositionBuffer.byteLength;
const groundIndexByteOffset =
	groundNormalByteOffset + groundNormalBuffer.byteLength;

const groundPositionBounds = vec3Bounds(groundGeometry.positions);
const groundNormalBounds = vec3Bounds(groundGeometry.normals);
const groundIndexBounds = scalarBounds(groundGeometry.indices);

const binChunk = Buffer.concat([
	positionBuffer,
	normalBuffer,
	paddedIndexBuffer,
	groundPositionBuffer,
	groundNormalBuffer,
	groundIndexBuffer,
]);

const sphereMaterials = MATERIAL_SPECS.map((spec) => ({
	name: spec.name,
	pbrMetallicRoughness: {
		baseColorFactor: spec.baseColor,
		metallicFactor: spec.metallicFactor,
		roughnessFactor: spec.roughnessFactor,
	},
	...(spec.emissiveFactor ? { emissiveFactor: spec.emissiveFactor } : {}),
	...(spec.alphaMode ? { alphaMode: spec.alphaMode } : {}),
}));

const groundMaterialIndex = sphereMaterials.length;
const groundMaterial = {
	name: GROUND_NAME,
	pbrMetallicRoughness: {
		baseColorFactor: [
			GROUND_BASE_COLOR,
			GROUND_BASE_COLOR,
			GROUND_BASE_COLOR,
			1,
		],
		metallicFactor: GROUND_METALLIC,
		roughnessFactor: GROUND_ROUGHNESS,
	},
};

const materials = [...sphereMaterials, groundMaterial];

const sphereMeshes = MATERIAL_SPECS.map((_spec, index) => ({
	primitives: [
		{
			attributes: { POSITION: 0, NORMAL: 1 },
			indices: 2,
			material: index,
		},
	],
}));

const groundMeshIndex = sphereMeshes.length;
const groundMesh = {
	primitives: [
		{
			attributes: { POSITION: 3, NORMAL: 4 },
			indices: 5,
			material: groundMaterialIndex,
		},
	],
};

const meshes = [...sphereMeshes, groundMesh];

/** Evenly spaced X positions, centered on the scene origin. */
const nodeXPositions = MATERIAL_SPECS.map(
	(_spec, index) => (index - (MATERIAL_SPECS.length - 1) / 2) * SPHERE_SPACING,
);

const sphereNodes = MATERIAL_SPECS.map((spec, index) => ({
	name: spec.name,
	mesh: index,
	translation: [nodeXPositions[index], 0, 0],
}));

const groundNode = {
	name: GROUND_NAME,
	mesh: groundMeshIndex,
};

const nodes = [...sphereNodes, groundNode];

const gltf = {
	asset: {
		version: "2.0",
		generator: "vector-motion-author gen-babylon-qa-probe",
	},
	scene: 0,
	scenes: [{ nodes: nodes.map((_node, index) => index) }],
	nodes,
	meshes,
	materials,
	accessors: [
		{
			bufferView: 0,
			byteOffset: 0,
			componentType: ACCESSOR_COMPONENT_TYPE_FLOAT,
			count: sphereGeometry.positions.length,
			type: "VEC3",
			min: positionBounds.min,
			max: positionBounds.max,
		},
		{
			bufferView: 1,
			byteOffset: 0,
			componentType: ACCESSOR_COMPONENT_TYPE_FLOAT,
			count: sphereGeometry.normals.length,
			type: "VEC3",
			min: normalBounds.min,
			max: normalBounds.max,
		},
		{
			bufferView: 2,
			byteOffset: 0,
			componentType: ACCESSOR_COMPONENT_TYPE_UNSIGNED_SHORT,
			count: indexCount,
			type: "SCALAR",
			min: [indexBounds.min],
			max: [indexBounds.max],
		},
		{
			bufferView: 3,
			byteOffset: 0,
			componentType: ACCESSOR_COMPONENT_TYPE_FLOAT,
			count: groundGeometry.positions.length,
			type: "VEC3",
			min: groundPositionBounds.min,
			max: groundPositionBounds.max,
		},
		{
			bufferView: 4,
			byteOffset: 0,
			componentType: ACCESSOR_COMPONENT_TYPE_FLOAT,
			count: groundGeometry.normals.length,
			type: "VEC3",
			min: groundNormalBounds.min,
			max: groundNormalBounds.max,
		},
		{
			bufferView: 5,
			byteOffset: 0,
			componentType: ACCESSOR_COMPONENT_TYPE_UNSIGNED_SHORT,
			count: groundIndexCount,
			type: "SCALAR",
			min: [groundIndexBounds.min],
			max: [groundIndexBounds.max],
		},
	],
	bufferViews: [
		{
			buffer: 0,
			byteOffset: positionByteOffset,
			byteLength: positionBuffer.byteLength,
			target: ARRAY_BUFFER_TARGET,
		},
		{
			buffer: 0,
			byteOffset: normalByteOffset,
			byteLength: normalBuffer.byteLength,
			target: ARRAY_BUFFER_TARGET,
		},
		{
			buffer: 0,
			byteOffset: indexByteOffset,
			byteLength: indexBuffer.byteLength,
			target: ELEMENT_ARRAY_BUFFER_TARGET,
		},
		{
			buffer: 0,
			byteOffset: groundPositionByteOffset,
			byteLength: groundPositionBuffer.byteLength,
			target: ARRAY_BUFFER_TARGET,
		},
		{
			buffer: 0,
			byteOffset: groundNormalByteOffset,
			byteLength: groundNormalBuffer.byteLength,
			target: ARRAY_BUFFER_TARGET,
		},
		{
			buffer: 0,
			byteOffset: groundIndexByteOffset,
			byteLength: groundIndexBuffer.byteLength,
			target: ELEMENT_ARRAY_BUFFER_TARGET,
		},
	],
	buffers: [{ byteLength: binChunk.byteLength }],
};

const jsonChunkData = padToAlignment(
	Buffer.from(JSON.stringify(gltf), "utf8"),
	GLB_JSON_PADDING_BYTE,
);
const binChunkData = padToAlignment(binChunk, GLB_BIN_PADDING_BYTE);

const buildChunk = (chunkType: number, data: Buffer): Buffer => {
	const header = Buffer.alloc(GLB_CHUNK_HEADER_BYTE_LENGTH);
	header.writeUInt32LE(data.byteLength, 0);
	header.writeUInt32LE(chunkType, 4);
	return Buffer.concat([header, data]);
};

const jsonChunk = buildChunk(GLB_JSON_CHUNK_TYPE, jsonChunkData);
const binaryChunk = buildChunk(GLB_BIN_CHUNK_TYPE, binChunkData);

const totalByteLength =
	GLB_HEADER_BYTE_LENGTH + jsonChunk.byteLength + binaryChunk.byteLength;
const header = Buffer.alloc(GLB_HEADER_BYTE_LENGTH);
header.writeUInt32LE(GLB_MAGIC, 0);
header.writeUInt32LE(GLB_VERSION, 4);
header.writeUInt32LE(totalByteLength, 8);

const glb = Buffer.concat([header, jsonChunk, binaryChunk]);

mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, glb);

console.log(`Wrote ${glb.byteLength} bytes to ${OUTPUT_PATH}`);
console.log(
	`Sphere: ${sphereGeometry.positions.length} vertices, ${indexCount} indices, ${materials.length} materials.`,
);
