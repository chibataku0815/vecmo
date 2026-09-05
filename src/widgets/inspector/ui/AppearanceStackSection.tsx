import {
	ArrowDown,
	ArrowUp,
	Eye,
	EyeSlash,
	Plus,
	Trash,
} from "@phosphor-icons/react";
import {
	componentPropStyleColorTargetOwners,
	readComponentProps,
} from "@/entities/scene/model/component-props";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import {
	type AppearanceStackRow,
	appearanceStackView,
	commitAddAppearanceItem,
	commitAppearanceItemColor,
	commitRemoveAppearanceItem,
	commitReorderAppearanceItem,
	commitToggleAppearanceItem,
} from "../model/appearance-stack";
import { sharedColorOwnershipConflictForInspector } from "../model/shared-color-ownership";

/**
 * Compact appearance-stack editor for a single selected node: lists every fill and
 * stroke as a row with a visibility toggle, an inline solid-color swatch, reorder
 * controls, and delete, plus an add button per role. Rich gradient/image/mesh
 * detail editing stays in the primary-paint controls above; this surface owns list
 * management so authoring more than one fill/stroke (and seeing it render) is
 * possible without touching JSON or the import report.
 */

const HEX3_PATTERN = /^#[0-9a-fA-F]{3}$/;
const HEX6_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Normalizes a stored color to the `#rrggbb` a native color input requires. */
const toColorInputValue = (color: string): string => {
	if (HEX6_PATTERN.test(color)) return color;
	if (HEX3_PATTERN.test(color)) {
		return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
	}
	return "#000000";
};

const iconButtonClass =
	"grid size-4 shrink-0 place-items-center rounded text-fg-muted transition hover:bg-white/10 hover:text-fg disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent";

const reorderTouchesBoundIndex = (
	boundIndices: ReadonlySet<number>,
	from: number,
	to: number,
): boolean => {
	const start = Math.min(from, to);
	const end = Math.max(from, to);
	return [...boundIndices].some((index) => index >= start && index <= end);
};

function AppearanceRow({
	node,
	row,
	count,
	boundIndices,
	colorConflictReasons,
}: {
	readonly node: VectorNode;
	readonly row: AppearanceStackRow;
	readonly count: number;
	readonly boundIndices: ReadonlySet<number>;
	readonly colorConflictReasons: ReadonlyMap<number, string>;
}) {
	const colorConflictReason = colorConflictReasons.get(row.index);
	const colorLocked = colorConflictReason !== undefined;
	const moveUpLocked = reorderTouchesBoundIndex(
		boundIndices,
		row.index,
		row.index - 1,
	);
	const moveDownLocked = reorderTouchesBoundIndex(
		boundIndices,
		row.index,
		row.index + 1,
	);
	const deleteLocked = [...boundIndices].some((index) => index >= row.index);
	return (
		<div className="flex items-center gap-1 rounded border border-white/8 bg-black/15 px-1 py-0.5">
			<button
				type="button"
				title={row.visible ? "Hide" : "Show"}
				aria-label={row.visible ? "Hide" : "Show"}
				onClick={() =>
					commitToggleAppearanceItem(node.id, row.role, row.index, !row.visible)
				}
				className={iconButtonClass}
			>
				{row.visible ? (
					<Eye aria-hidden="true" size={11} />
				) : (
					<EyeSlash aria-hidden="true" size={11} />
				)}
			</button>
			{row.solidColor !== null ? (
				<input
					type="color"
					title={colorConflictReason ?? "Color"}
					disabled={colorLocked}
					value={toColorInputValue(row.solidColor)}
					onChange={(event) =>
						commitAppearanceItemColor(
							node.id,
							row.role,
							row.index,
							event.currentTarget.value,
						)
					}
					className="size-3.5 shrink-0 cursor-pointer rounded border border-white/15 bg-transparent p-0 disabled:cursor-not-allowed disabled:opacity-40"
				/>
			) : (
				<span
					aria-hidden="true"
					className="size-3.5 shrink-0 rounded border border-white/15"
					style={{ background: row.previewColor }}
				/>
			)}
			<span
				className={`min-w-0 flex-1 truncate text-ui ${row.visible ? "text-fg" : "text-fg-subtle line-through"}`}
			>
				{row.kindLabel}
			</span>
			{colorLocked ? (
				<span
					title={colorConflictReason}
					className="shrink-0 text-danger-fg text-ui"
				>
					Conflict
				</span>
			) : null}
			<button
				type="button"
				title={
					moveUpLocked ? "Shared color owns an affected paint index" : "Move up"
				}
				aria-label="Move up"
				disabled={row.index === 0 || moveUpLocked}
				onClick={() =>
					commitReorderAppearanceItem(
						node.id,
						row.role,
						row.index,
						row.index - 1,
					)
				}
				className={iconButtonClass}
			>
				<ArrowUp aria-hidden="true" size={11} />
			</button>
			<button
				type="button"
				title={
					moveDownLocked
						? "Shared color owns an affected paint index"
						: "Move down"
				}
				aria-label="Move down"
				disabled={row.index === count - 1 || moveDownLocked}
				onClick={() =>
					commitReorderAppearanceItem(
						node.id,
						row.role,
						row.index,
						row.index + 1,
					)
				}
				className={iconButtonClass}
			>
				<ArrowDown aria-hidden="true" size={11} />
			</button>
			<button
				type="button"
				title={
					deleteLocked
						? "Shared color owns this or a following paint index"
						: "Delete"
				}
				aria-label="Delete"
				disabled={deleteLocked}
				onClick={() => commitRemoveAppearanceItem(node.id, row.role, row.index)}
				className={iconButtonClass}
			>
				<Trash aria-hidden="true" size={11} />
			</button>
		</div>
	);
}

function AppearanceRoleList({
	node,
	paintRole,
	rows,
	boundIndices,
	colorConflictReasons,
}: {
	readonly node: VectorNode;
	readonly paintRole: "fill" | "stroke";
	readonly rows: readonly AppearanceStackRow[];
	readonly boundIndices: ReadonlySet<number>;
	readonly colorConflictReasons: ReadonlyMap<number, string>;
}) {
	const addLocked = [...boundIndices].some((index) => index >= rows.length);
	return (
		<div className="space-y-0.5">
			<div className="flex h-4 items-center justify-between">
				<span className="text-fg-muted text-ui">
					{paintRole === "fill" ? "Fills" : "Strokes"}
				</span>
				<button
					type="button"
					title={
						addLocked
							? "A stale shared-color address would be retargeted"
							: paintRole === "fill"
								? "Add fill"
								: "Add stroke"
					}
					aria-label={paintRole === "fill" ? "Add fill" : "Add stroke"}
					disabled={addLocked}
					onClick={() => commitAddAppearanceItem(node.id, paintRole)}
					className={iconButtonClass}
				>
					<Plus aria-hidden="true" size={11} />
				</button>
			</div>
			{rows.map((row) => (
				<AppearanceRow
					key={row.id}
					node={node}
					row={row}
					count={rows.length}
					boundIndices={boundIndices}
					colorConflictReasons={colorConflictReasons}
				/>
			))}
		</div>
	);
}

/** Renders the fill and stroke stack editors for one node. */
export function AppearanceStackSection({
	document,
	node,
}: {
	readonly document: SceneDocument;
	readonly node: VectorNode;
}) {
	const view = appearanceStackView(node);
	const props = readComponentProps(document);
	const bindingIndices = (role: "fill" | "stroke"): ReadonlySet<number> =>
		new Set(
			props.flatMap((prop) =>
				prop.type === "color"
					? prop.bindings.flatMap((binding) =>
							binding.kind === "style-color" &&
							binding.nodeId === node.id &&
							binding.role === role
								? [binding.paintIndex ?? 0]
								: [],
						)
					: [],
			),
		);
	const colorConflictReasons = (
		role: "fill" | "stroke",
	): ReadonlyMap<number, string> =>
		new Map(
			[...bindingIndices(role)].flatMap((index) => {
				const binding = {
					kind: "style-color",
					nodeId: node.id,
					role,
					paintIndex: index,
				} as const;
				const owners = componentPropStyleColorTargetOwners(document, binding);
				const conflict = sharedColorOwnershipConflictForInspector(
					document,
					binding,
					owners.length === 1 ? owners[0]?.id : undefined,
				);
				return conflict ? ([[index, conflict.reason]] as const) : [];
			}),
		);
	return (
		<div className="space-y-1.5 border-white/8 border-t pt-1.5">
			<AppearanceRoleList
				node={node}
				paintRole="fill"
				rows={view.fills}
				boundIndices={bindingIndices("fill")}
				colorConflictReasons={colorConflictReasons("fill")}
			/>
			<AppearanceRoleList
				node={node}
				paintRole="stroke"
				rows={view.strokes}
				boundIndices={bindingIndices("stroke")}
				colorConflictReasons={colorConflictReasons("stroke")}
			/>
		</div>
	);
}
