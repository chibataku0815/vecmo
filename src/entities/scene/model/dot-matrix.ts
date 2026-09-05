import { createNode } from "./factory";
import { ellipseToPathGeometry } from "./path-boolean/path-conversion";
import type { NodeStyle, Vec2, VectorNode } from "./types";

const DOT_MATRIX_MAX_DIMENSION = 64;
const DOT_MATRIX_MAX_ACTIVE_CELLS = 1024;

/** Shared appearance subset intentionally available to every generated contour. */
export type DotMatrixStyle = Partial<
	Pick<NodeStyle, "fill" | "stroke" | "strokeWidth" | "opacity">
>;

/** Serializable construction input for one native circle-cell compound path. */
export type DotMatrixNodeSpec = {
	readonly name?: string;
	readonly origin: Vec2;
	/** `#` creates one circular contour and `.` preserves internal negative space. */
	readonly rows: readonly string[];
	readonly cellSize: number;
	readonly gap?: number;
	readonly style?: DotMatrixStyle;
};

/** Stable validation reasons returned before a malformed matrix reaches Scene. */
export type DotMatrixBuildIssueCode =
	| "empty-pattern"
	| "empty-row"
	| "non-rectangular-pattern"
	| "unsupported-cell"
	| "dimension-limit"
	| "active-cell-limit"
	| "no-active-cells"
	| "unbounded-negative-space"
	| "invalid-origin"
	| "invalid-cell-size"
	| "invalid-gap"
	| "coordinate-overflow"
	| "invalid-style";

/** One structural problem with a requested occupancy grid. */
export type DotMatrixBuildIssue = {
	readonly code: DotMatrixBuildIssueCode;
	readonly message: string;
};

/** Result of compiling a dot-matrix construction into one ordinary Scene path. */
export type DotMatrixBuildResult =
	| {
			readonly ok: true;
			readonly node: VectorNode;
			readonly activeCellCount: number;
			readonly issues: readonly [];
	  }
	| {
			readonly ok: false;
			readonly issues: readonly DotMatrixBuildIssue[];
	  };

const dotMatrixIssue = (
	code: DotMatrixBuildIssueCode,
	message: string,
): DotMatrixBuildIssue => ({ code, message });

const finitePoint = (point: Vec2): boolean =>
	Number.isFinite(point.x) && Number.isFinite(point.y);

const styleIssues = (
	style: DotMatrixStyle | undefined,
): DotMatrixBuildIssue[] => {
	if (!style) return [];
	const issues: DotMatrixBuildIssue[] = [];
	if (
		style.strokeWidth !== undefined &&
		(!Number.isFinite(style.strokeWidth) || style.strokeWidth < 0)
	) {
		issues.push(
			dotMatrixIssue(
				"invalid-style",
				"Dot-matrix strokeWidth must be finite and greater than or equal to zero.",
			),
		);
	}
	if (
		style.opacity !== undefined &&
		(!Number.isFinite(style.opacity) || style.opacity < 0 || style.opacity > 1)
	) {
		issues.push(
			dotMatrixIssue(
				"invalid-style",
				"Dot-matrix opacity must be finite and within 0..1.",
			),
		);
	}
	return issues;
};

/**
 * Builds one editable compound path whose contours are exact four-cubic circles
 * sampled from a bounded occupancy grid. A single path keeps transforms,
 * selection, hit testing, persistence, and undo on the ordinary leaf-node path;
 * it does not inherit the current group-descendant hit-test limitation.
 *
 * The helper deliberately accepts only one shared appearance and two cell
 * states so agent-authored studies begin with a disciplined motif, exact
 * spacing, and explicit internal negative space instead of primitive soup.
 */
export function buildDotMatrixNode(
	spec: DotMatrixNodeSpec,
): DotMatrixBuildResult {
	const issues: DotMatrixBuildIssue[] = [];
	const rowCount = spec.rows.length;
	const columnCount = spec.rows[0]?.length ?? 0;

	if (rowCount === 0) {
		issues.push(
			dotMatrixIssue("empty-pattern", "Dot-matrix rows must not be empty."),
		);
	}
	if (rowCount > 0 && columnCount === 0) {
		issues.push(
			dotMatrixIssue("empty-row", "Dot-matrix rows must not be empty."),
		);
	}
	if (spec.rows.some((row) => row.length !== columnCount)) {
		issues.push(
			dotMatrixIssue(
				"non-rectangular-pattern",
				"Dot-matrix rows must all have the same width.",
			),
		);
	}
	if (spec.rows.some((row) => /[^.#]/u.test(row))) {
		issues.push(
			dotMatrixIssue(
				"unsupported-cell",
				'Dot-matrix rows may contain only "#" and "." cells.',
			),
		);
	}
	if (
		rowCount > DOT_MATRIX_MAX_DIMENSION ||
		columnCount > DOT_MATRIX_MAX_DIMENSION
	) {
		issues.push(
			dotMatrixIssue(
				"dimension-limit",
				`Dot-matrix dimensions must not exceed ${DOT_MATRIX_MAX_DIMENSION} rows or columns.`,
			),
		);
	}
	if (!finitePoint(spec.origin)) {
		issues.push(
			dotMatrixIssue(
				"invalid-origin",
				"Dot-matrix origin coordinates must be finite.",
			),
		);
	}
	if (!Number.isFinite(spec.cellSize) || spec.cellSize <= 0) {
		issues.push(
			dotMatrixIssue(
				"invalid-cell-size",
				"Dot-matrix cellSize must be a finite number greater than zero.",
			),
		);
	}
	const gap = spec.gap ?? 0;
	if (!Number.isFinite(gap) || gap < 0) {
		issues.push(
			dotMatrixIssue(
				"invalid-gap",
				"Dot-matrix gap must be a finite number greater than or equal to zero.",
			),
		);
	}
	issues.push(...styleIssues(spec.style));
	if (issues.length > 0) return { ok: false, issues };

	const step = spec.cellSize + gap;
	const right = spec.origin.x + (columnCount - 1) * step + spec.cellSize;
	const bottom = spec.origin.y + (rowCount - 1) * step + spec.cellSize;
	if (
		!Number.isFinite(step) ||
		!Number.isFinite(right) ||
		!Number.isFinite(bottom)
	) {
		return {
			ok: false,
			issues: [
				dotMatrixIssue(
					"coordinate-overflow",
					"Dot-matrix derived bounds must remain finite after applying cell size and gap.",
				),
			],
		};
	}

	const occupiedCells = spec.rows.flatMap((row, rowIndex) =>
		[...row].flatMap((cell, columnIndex) =>
			cell === "#" ? [{ rowIndex, columnIndex }] : [],
		),
	);
	if (occupiedCells.length === 0) {
		issues.push(
			dotMatrixIssue(
				"no-active-cells",
				'Dot-matrix rows must contain at least one "#" cell.',
			),
		);
	}
	if (occupiedCells.length > DOT_MATRIX_MAX_ACTIVE_CELLS) {
		issues.push(
			dotMatrixIssue(
				"active-cell-limit",
				`Dot-matrix patterns must not exceed ${DOT_MATRIX_MAX_ACTIVE_CELLS} active cells.`,
			),
		);
	}
	const touchesTop = spec.rows[0]?.includes("#") ?? false;
	const touchesBottom = spec.rows.at(-1)?.includes("#") ?? false;
	const touchesLeft = spec.rows.some((row) => row.startsWith("#"));
	const touchesRight = spec.rows.some((row) => row.endsWith("#"));
	if (!touchesTop || !touchesBottom || !touchesLeft || !touchesRight) {
		issues.push(
			dotMatrixIssue(
				"unbounded-negative-space",
				"Dot-matrix occupied cells must touch the top, bottom, left, and right pattern boundaries so selection bounds preserve the authored grid footprint.",
			),
		);
	}
	if (issues.length > 0) return { ok: false, issues };

	const name = spec.name?.trim() || "Dot matrix";
	const contours = occupiedCells.map(
		({ rowIndex, columnIndex }) =>
			ellipseToPathGeometry({
				kind: "ellipse",
				bounds: {
					x: spec.origin.x + columnIndex * step,
					y: spec.origin.y + rowIndex * step,
					width: spec.cellSize,
					height: spec.cellSize,
				},
			}).shape,
	);
	const [shape, ...subpaths] = contours;
	if (!shape) {
		return {
			ok: false,
			issues: [
				dotMatrixIssue(
					"no-active-cells",
					'Dot-matrix rows must contain at least one "#" cell.',
				),
			],
		};
	}
	const baseNode = createNode(
		"path",
		{
			kind: "path",
			shape,
			...(subpaths.length > 0 ? { subpaths } : {}),
			fillRule: "nonzero",
		},
		{
			name,
			style: {
				fill: "#191817",
				stroke: "none",
				strokeWidth: 0,
				...spec.style,
			},
		},
	);
	const node: VectorNode = {
		...baseNode,
		data: {
			dotMatrix: {
				version: 1,
				origin: { ...spec.origin },
				rows: [...spec.rows],
				columns: columnCount,
				cellSize: spec.cellSize,
				gap,
				activeCellCount: occupiedCells.length,
			},
		},
	};

	return {
		ok: true,
		node,
		activeCellCount: occupiedCells.length,
		issues: [],
	};
}
