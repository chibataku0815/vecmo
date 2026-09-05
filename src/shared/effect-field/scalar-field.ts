/**
 * Reusable scalar field modes for effects whose strength can be authored as a
 * contour-following field, a directional linear field, or an editable mesh.
 */
export type ScalarEffectFieldMode = "contour" | "linear" | "mesh";

/** One normalized control point in a scalar effect mesh. */
export type ScalarEffectFieldMeshPoint = {
	/** Normalized horizontal position in the effect bounds, 0 = left, 1 = right. */
	readonly x: number;
	/** Normalized vertical position in the effect bounds, 0 = top, 1 = bottom. */
	readonly y: number;
	/** Scalar effect intensity at this control point, clamped to [0, 1]. */
	readonly value: number;
};

/** Rectangular scalar effect mesh addressed by stable row/column coordinates. */
export type ScalarEffectFieldMesh = {
	/** Number of point rows in the scalar control grid. */
	readonly rows: number;
	/** Number of point columns in the scalar control grid. */
	readonly cols: number;
	readonly points: readonly ScalarEffectFieldMeshPoint[];
};

/** Smallest editable scalar mesh: four corner points forming one patch. */
export const SCALAR_EFFECT_FIELD_MESH_MIN_GRID = 2;

/** Upper bound that keeps direct canvas editing dense enough without becoming noisy. */
export const SCALAR_EFFECT_FIELD_MESH_MAX_GRID = 8;

const FIELD_MESH_INSERT_T_EPSILON = 0.001;

const clamp = (value: number, min: number, max: number): number =>
	Math.min(max, Math.max(min, value));

const clamp01 = (value: number): number => clamp(value, 0, 1);

const finiteNumber = (value: unknown, fallback: number): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;

const isObjectRecord = (
	value: unknown,
): value is Readonly<Record<string, unknown>> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const asRecord = (
	value: unknown,
): Readonly<Record<string, unknown>> | undefined =>
	isObjectRecord(value) ? value : undefined;

const clampFieldMeshInsertT = (t: number): number =>
	Math.min(
		1 - FIELD_MESH_INSERT_T_EPSILON,
		Math.max(FIELD_MESH_INSERT_T_EPSILON, t),
	);

/** Normalization knobs for adapting domain-specific scalar mesh payloads. */
export type NormalizeScalarEffectFieldMeshOptions = {
	/**
	 * Point property names that can carry the scalar value. This lets legacy
	 * payloads keep domain names such as `density` while sharing the same editor
	 * math as future effect-strength meshes.
	 */
	readonly valueKeys?: readonly string[];
	readonly minGrid?: number;
	readonly maxGrid?: number;
	readonly defaultValue?: number;
};

const scalarEffectFieldMeshValue = (
	record: Readonly<Record<string, unknown>> | undefined,
	fallback: number,
	valueKeys: readonly string[],
): number => {
	for (const key of valueKeys) {
		const value = record?.[key];
		if (typeof value === "number" && Number.isFinite(value)) return value;
	}
	return fallback;
};

/**
 * Normalizes a scalar effect-field mesh into a rectangular, clamped control grid.
 * Coordinates and values are normalized to [0, 1]; missing points fall back to
 * the supplied mesh and then to an even grid. It is intentionally value-key
 * agnostic so effects can store user-facing domain names without forking mesh
 * editing logic.
 */
export function normalizeScalarEffectFieldMesh(
	draft: unknown,
	fallback: ScalarEffectFieldMesh,
	options: NormalizeScalarEffectFieldMeshOptions = {},
): ScalarEffectFieldMesh {
	const record = asRecord(draft);
	const minGrid = options.minGrid ?? SCALAR_EFFECT_FIELD_MESH_MIN_GRID;
	const maxGrid = options.maxGrid ?? SCALAR_EFFECT_FIELD_MESH_MAX_GRID;
	const defaultValue = options.defaultValue ?? 0.5;
	const valueKeys = options.valueKeys ?? ["value"];
	const rows = Math.trunc(
		clamp(finiteNumber(record?.rows, fallback.rows), minGrid, maxGrid),
	);
	const cols = Math.trunc(
		clamp(finiteNumber(record?.cols, fallback.cols), minGrid, maxGrid),
	);
	const rawPoints = Array.isArray(record?.points)
		? record.points
		: fallback.points;
	const points: ScalarEffectFieldMeshPoint[] = [];
	for (let row = 0; row < rows; row += 1) {
		for (let col = 0; col < cols; col += 1) {
			const index = row * cols + col;
			const rawPoint = asRecord(rawPoints[index]);
			const fallbackPoint = fallback.points[index];
			points.push({
				x: clamp01(
					finiteNumber(
						rawPoint?.x,
						fallbackPoint?.x ?? (cols <= 1 ? 0 : col / (cols - 1)),
					),
				),
				y: clamp01(
					finiteNumber(
						rawPoint?.y,
						fallbackPoint?.y ?? (rows <= 1 ? 0 : row / (rows - 1)),
					),
				),
				value: clamp01(
					scalarEffectFieldMeshValue(
						rawPoint,
						fallbackPoint?.value ?? defaultValue,
						valueKeys,
					),
				),
			});
		}
	}
	return { rows, cols, points };
}

/** Row-major scalar mesh point lookup, or null when the address is outside. */
export function scalarEffectFieldMeshPointAt(
	fieldMesh: ScalarEffectFieldMesh,
	row: number,
	col: number,
): ScalarEffectFieldMeshPoint | null {
	return row < 0 || row >= fieldMesh.rows || col < 0 || col >= fieldMesh.cols
		? null
		: (fieldMesh.points[row * fieldMesh.cols + col] ?? null);
}

const withScalarEffectFieldMeshPoint = (
	fieldMesh: ScalarEffectFieldMesh,
	row: number,
	col: number,
	write: (point: ScalarEffectFieldMeshPoint) => ScalarEffectFieldMeshPoint,
): ScalarEffectFieldMesh => {
	const index = row * fieldMesh.cols + col;
	const current = scalarEffectFieldMeshPointAt(fieldMesh, row, col);
	if (!current) return fieldMesh;
	const points = fieldMesh.points.map((point, pointIndex) =>
		pointIndex === index ? write(point) : point,
	);
	return normalizeScalarEffectFieldMesh({ ...fieldMesh, points }, fieldMesh);
};

/**
 * Moves one scalar field-mesh point in normalized effect-bounds coordinates while
 * preserving rectangular topology.
 */
export function moveScalarEffectFieldMeshPoint(
	fieldMesh: ScalarEffectFieldMesh,
	row: number,
	col: number,
	point: { readonly x: number; readonly y: number },
): ScalarEffectFieldMesh {
	return withScalarEffectFieldMeshPoint(fieldMesh, row, col, (current) => ({
		...current,
		x: clamp01(finiteNumber(point.x, current.x)),
		y: clamp01(finiteNumber(point.y, current.y)),
	}));
}

/** Sets one scalar field-mesh control point's intensity value. */
export function setScalarEffectFieldMeshPointValue(
	fieldMesh: ScalarEffectFieldMesh,
	row: number,
	col: number,
	value: number,
): ScalarEffectFieldMesh {
	return withScalarEffectFieldMeshPoint(fieldMesh, row, col, (current) => ({
		...current,
		value: clamp01(finiteNumber(value, current.value)),
	}));
}

const interpolatedScalarEffectFieldMeshPoint = (
	a: ScalarEffectFieldMeshPoint,
	b: ScalarEffectFieldMeshPoint,
	t: number,
): ScalarEffectFieldMeshPoint => ({
	x: a.x + (b.x - a.x) * t,
	y: a.y + (b.y - a.y) * t,
	value: a.value + (b.value - a.value) * t,
});

/** Inserts a scalar control row between `afterRow` and `afterRow + 1`. */
export function insertScalarEffectFieldMeshRow(
	fieldMesh: ScalarEffectFieldMesh,
	afterRow: number,
	t: number,
): ScalarEffectFieldMesh {
	const { rows, cols, points } = fieldMesh;
	if (
		rows >= SCALAR_EFFECT_FIELD_MESH_MAX_GRID ||
		afterRow < 0 ||
		afterRow >= rows - 1
	) {
		return fieldMesh;
	}
	const clamped = clampFieldMeshInsertT(t);
	const at = (row: number, col: number): ScalarEffectFieldMeshPoint =>
		points[row * cols + col] ?? {
			x: cols <= 1 ? 0 : col / (cols - 1),
			y: rows <= 1 ? 0 : row / (rows - 1),
			value: 0.5,
		};
	const next: ScalarEffectFieldMeshPoint[] = [];
	for (let row = 0; row < rows; row += 1) {
		for (let col = 0; col < cols; col += 1) next.push(at(row, col));
		if (row === afterRow) {
			for (let col = 0; col < cols; col += 1) {
				next.push(
					interpolatedScalarEffectFieldMeshPoint(
						at(afterRow, col),
						at(afterRow + 1, col),
						clamped,
					),
				);
			}
		}
	}
	return normalizeScalarEffectFieldMesh(
		{ ...fieldMesh, rows: rows + 1, points: next },
		fieldMesh,
	);
}

/** Inserts a scalar control column between `afterCol` and `afterCol + 1`. */
export function insertScalarEffectFieldMeshColumn(
	fieldMesh: ScalarEffectFieldMesh,
	afterCol: number,
	t: number,
): ScalarEffectFieldMesh {
	const { rows, cols, points } = fieldMesh;
	if (
		cols >= SCALAR_EFFECT_FIELD_MESH_MAX_GRID ||
		afterCol < 0 ||
		afterCol >= cols - 1
	) {
		return fieldMesh;
	}
	const clamped = clampFieldMeshInsertT(t);
	const at = (row: number, col: number): ScalarEffectFieldMeshPoint =>
		points[row * cols + col] ?? {
			x: cols <= 1 ? 0 : col / (cols - 1),
			y: rows <= 1 ? 0 : row / (rows - 1),
			value: 0.5,
		};
	const next: ScalarEffectFieldMeshPoint[] = [];
	for (let row = 0; row < rows; row += 1) {
		for (let col = 0; col < cols; col += 1) {
			next.push(at(row, col));
			if (col === afterCol) {
				next.push(
					interpolatedScalarEffectFieldMeshPoint(
						at(row, afterCol),
						at(row, afterCol + 1),
						clamped,
					),
				);
			}
		}
	}
	return normalizeScalarEffectFieldMesh(
		{ ...fieldMesh, cols: cols + 1, points: next },
		fieldMesh,
	);
}

/** Removes one interior scalar-control row; boundary rows are retained. */
export function removeScalarEffectFieldMeshRow(
	fieldMesh: ScalarEffectFieldMesh,
	row: number,
): ScalarEffectFieldMesh {
	const { rows, cols, points } = fieldMesh;
	if (
		rows <= SCALAR_EFFECT_FIELD_MESH_MIN_GRID ||
		row <= 0 ||
		row >= rows - 1
	) {
		return fieldMesh;
	}
	return normalizeScalarEffectFieldMesh(
		{
			...fieldMesh,
			rows: rows - 1,
			points: points.filter((_, index) => Math.floor(index / cols) !== row),
		},
		fieldMesh,
	);
}

/** Removes one interior scalar-control column; boundary columns are retained. */
export function removeScalarEffectFieldMeshColumn(
	fieldMesh: ScalarEffectFieldMesh,
	col: number,
): ScalarEffectFieldMesh {
	const { cols, points } = fieldMesh;
	if (
		cols <= SCALAR_EFFECT_FIELD_MESH_MIN_GRID ||
		col <= 0 ||
		col >= cols - 1
	) {
		return fieldMesh;
	}
	return normalizeScalarEffectFieldMesh(
		{
			...fieldMesh,
			cols: cols - 1,
			points: points.filter((_, index) => index % cols !== col),
		},
		fieldMesh,
	);
}

/** Removes the interior row and/or column passing through a scalar mesh point. */
export function removeScalarEffectFieldMeshPointLines(
	fieldMesh: ScalarEffectFieldMesh,
	row: number,
	col: number,
): ScalarEffectFieldMesh {
	let next = fieldMesh;
	if (row > 0 && row < fieldMesh.rows - 1) {
		next = removeScalarEffectFieldMeshRow(next, row);
	}
	if (col > 0 && col < fieldMesh.cols - 1) {
		next = removeScalarEffectFieldMeshColumn(next, col);
	}
	return next;
}
