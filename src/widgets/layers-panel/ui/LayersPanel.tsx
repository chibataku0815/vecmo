import type { Icon } from "@phosphor-icons/react";
import {
	ArrowDown,
	ArrowUp,
	Camera,
	CaretDown,
	CaretRight,
	Circle,
	CirclesThree,
	ClipboardText,
	Copy,
	Crosshair,
	Eye,
	EyeSlash,
	FilmStrip,
	Intersect,
	LineSegment,
	Lock,
	LockOpen,
	MagnifyingGlass,
	Path,
	PencilSimple,
	Plus,
	Polygon,
	Rows,
	Shapes,
	Square,
	SquaresFour,
	Stack,
	StackSimple,
	Star,
	TextT,
	Trash,
	X,
} from "@phosphor-icons/react";
import {
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	commitLinkedInstanceCompanions,
	commitLinkedInstancePlan,
} from "@/entities/component-motion/model/plan-linked-instance";
import { removeTrack } from "@/entities/motion/model/commands";
import { useMotionStore } from "@/entities/motion/model/store";
import { removeGrammarBinding } from "@/entities/motion-grammar/model/commands";
import { useMotionGrammarStore } from "@/entities/motion-grammar/model/store";
import type { SceneCommand } from "@/entities/scene/model/command";
import { createDefaultLayerNode } from "@/entities/scene/model/factory";
import { createAppendNodeCommand } from "@/entities/scene/model/node-commands";
import {
	readSceneCameraAuthoringState,
	type SceneCameraAuthoringSelection,
	type SceneCameraAuthoringState,
} from "@/entities/scene/model/scene-camera-authoring";
import { findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	ArtboardRole,
	SceneLayer,
	VectorNode,
	VectorNodeKind,
} from "@/entities/scene/model/types";
import { BlenderLinkAssetSection } from "@/features/blender-link/ui/BlenderLinkAssetSection";
import { isRasterImagePlacementFile } from "@/features/import/model/image-placement";
import { createLocalImageFilePlacementPlan } from "@/features/import/model/local-image-file";
import { useSelectionStore } from "@/features/selection/model/store";
import {
	type SelectedObjectUndoPlan,
	selectedObjectWorkflowTransactionCoalesceKey,
	useSelectedObjectRenameRequestStore,
} from "@/features/structure-actions";
import { useEditorChromeStore } from "@/shared/editor-chrome/model/store";
import { usePanelResize } from "@/shared/editor-chrome/model/use-panel-resize";
import { cn } from "@/shared/lib/cn";
import { createId } from "@/shared/lib/id";
import { ContextMenu, type ContextMenuGroup } from "@/shared/ui/ContextMenu";
import { PanelResizeHandle } from "@/shared/ui/PanelResizeHandle";
import {
	type ArtboardRowStatusBadgeId,
	artboardRoleOptions,
	createMoveArtboardRowCommand,
	createRemoveArtboardRowCommand,
	createSetArtboardRoleRowCommand,
	getArtboardRowRoleOption,
	getArtboardRowStatusBadges,
	planDuplicateArtboardRowCommand,
} from "../model/artboard-actions";
import {
	type AssetLibraryActionAvailability,
	type AssetLibraryCommandPlan,
	type AssetLibraryComponentEntry,
	type AssetLibraryImageEntry,
	type AssetLibraryReadModel,
	type AssetLibraryStyleEntry,
	type AssetLibraryStyleSwatch,
	planApplyStyleAsset,
	planCreateComponentAsset,
	planCreateStyleAsset,
	planDeleteComponentAsset,
	planDeleteImageAsset,
	planDeleteStyleAsset,
	planPlaceComponentAsset,
	planPlaceImageAsset,
	planRenameSceneAsset,
	readAssetLibrary,
} from "../model/assets-panel";
import { rowIndentPx } from "../model/drop-target";
import {
	layerMoveTargetIndex,
	type MoveDirection,
	nodeMoveTargetIndex,
} from "../model/reorder";
import {
	createLayerPanelRenameCommand,
	createMoveLayerRowCommand,
	createMoveNodeRowCommand,
	createToggleLayerLockedRowCommand,
	type LayerPanelRenameTarget,
	type LayerPanelSelectionPlan,
	planDeleteNodeRowAction,
	planFocusArtboardRowAction,
	planReleaseRowMaskAction,
	planToggleLayerVisibilityRowAction,
	planToggleNodeLockedRowAction,
	planToggleNodeVisibilityRowAction,
	planUseRowAsMaskAction,
} from "../model/row-actions";
import {
	type ArtboardLayerPanelRow,
	artboardLayerRowId,
	artboardRowId,
	canDeleteLayerPanelNodeRow,
	filterArtboardLayerPanelRows,
	flattenArtboardLayerPanelRows,
	type LayerPanelArtboardRow,
	type LayerPanelFilteredRowsEmptyState,
	type LayerPanelLayerRow,
	type LayerPanelNodeRoleBadgeId,
	type LayerPanelNodeRoleId,
	type LayerPanelNodeRow,
	rangeNodeIds,
} from "../model/rows";
import {
	cleanupLayerWorkflowSelection,
	type LayerWorkflowActionId,
	type LayerWorkflowActionPlan,
	type LayerWorkflowIssue,
	planLayerWorkflowActions,
} from "../model/workflow-actions";
import { useLayerWorkflowClipboardStore } from "../model/workflow-clipboard";
import { AssetNodePreview } from "./AssetNodePreview";
import {
	type LayerDropIndicator,
	type LayerRowDragProps,
	useLayerDrag,
} from "./use-layer-drag";

type EditingTarget = LayerPanelRenameTarget;
type PanelMode = "layers" | "assets";
type AssetViewMode = "grid" | "list";

/**
 * Renders the drop affordance one row owns during a drag: a depth-indented accent
 * line for an above/below insert, or a ring for nesting inside a container. The
 * line's left inset reuses {@link rowIndentPx}, so it sits exactly where a row at
 * the resolved depth would — that indent is what distinguishes reorder from nest.
 */
function DropIndicatorOverlay({
	indicator,
}: {
	readonly indicator: LayerDropIndicator;
}) {
	if (indicator.kind === "inside") {
		return (
			<div className="pointer-events-none absolute inset-0 z-10 rounded ring-1 ring-accent" />
		);
	}
	return (
		<div
			className="pointer-events-none absolute right-1 z-10 h-0.5 rounded-full bg-accent"
			style={{
				left: rowIndentPx("node", indicator.depth),
				top: indicator.kind === "before" ? -1 : undefined,
				bottom: indicator.kind === "after" ? -1 : undefined,
			}}
		/>
	);
}

/**
 * Click-intent for a node row, kept distinct per modifier instead of a single
 * `additive` boolean: Shift is a render-order range extend, while Cmd/Ctrl is a
 * single-item toggle. Collapsing them (the prior behavior) made range selection
 * impossible — Shift+Click behaved identically to Cmd+Click.
 */
type NodeSelectIntent = {
	readonly shift: boolean;
	readonly toggle: boolean;
};

type WorkflowActionReport = {
	readonly status: "success" | "warning" | "error";
	readonly title: string;
	readonly detail?: string;
	readonly issues: readonly LayerWorkflowIssue[];
};

const workflowActionButtons = [
	{ id: "duplicate", label: "Duplicate", IconComponent: Shapes },
	{ id: "delete", label: "Delete", IconComponent: Trash },
	{ id: "group", label: "Group", IconComponent: Stack },
	{ id: "ungroup", label: "Ungroup", IconComponent: StackSimple },
	{ id: "component-source", label: "Save object", IconComponent: Stack },
	{ id: "component-instance", label: "Place copy", IconComponent: Copy },
	{
		id: "component-detach",
		label: "Detach copy",
		IconComponent: StackSimple,
	},
	{ id: "copy", label: "Copy", IconComponent: Copy },
	{ id: "paste", label: "Paste", IconComponent: ClipboardText },
] as const satisfies readonly {
	readonly id: LayerWorkflowActionId;
	readonly label: string;
	readonly IconComponent: Icon;
}[];

const geometryIcons = {
	rect: Square,
	ellipse: Circle,
	line: LineSegment,
	polygon: Polygon,
	star: Star,
	path: Path,
	text: TextT,
	image: Shapes,
} satisfies Record<VectorNodeKind, Icon>;

const nodeRoleIcons = {
	...geometryIcons,
	frame: Square,
	group: Stack,
	mesh: Shapes,
	video: FilmStrip,
	"external-asset": Shapes,
	blend: CirclesThree,
} satisfies Record<LayerPanelNodeRoleId, Icon>;

const nodeRoleBadgeLabels = {
	frame: "frame",
	group: "group",
	"clips-content": "clip",
	mesh: "mesh",
	"mask-source": "mask",
	"masked-content": "masked",
	"component-source": "saved",
	"component-instance": "copy",
	blend: "blend",
} satisfies Record<LayerPanelNodeRoleBadgeId, string>;

const artboardStatusIcons = {
	current: Square,
	empty: Circle,
	hidden: EyeSlash,
	locked: Lock,
	selected: Crosshair,
} satisfies Record<ArtboardRowStatusBadgeId, Icon>;

const chipColorForNode = (node: VectorNode): string => {
	if (node.style.fill !== "none") return node.style.fill;
	if (node.style.stroke !== "none") return node.style.stroke;
	return "transparent";
};

const issueTone = (
	issues: readonly LayerWorkflowIssue[],
): WorkflowActionReport["status"] => {
	if (issues.some((issue) => issue.severity === "error")) return "error";
	if (issues.length > 0) return "warning";
	return "success";
};

const reportClassName = (status: WorkflowActionReport["status"]): string => {
	if (status === "success") return "border-accent/30 text-accent-fg";
	if (status === "warning") return "border-warn/35 text-warn-fg";
	return "border-danger/35 text-danger-fg";
};

const formatCount = (count: number, noun: string): string =>
	`${count} ${noun}${count === 1 ? "" : "s"}`;

const nodeRoleBadgeClassName = (
	id: LayerPanelNodeRoleBadgeId,
	effectiveLocked: boolean,
): string =>
	cn(
		"rounded border px-0.5 font-medium text-ui leading-3",
		id === "frame" || id === "group" || id === "mesh"
			? "border-white/10 bg-black/15 text-fg-muted"
			: "border-white/8 bg-black/15 text-fg-subtle",
		id === "clips-content" && "border-warn/30 text-warn-fg",
		id === "mask-source" && "border-accent/30 text-accent-fg",
		id === "masked-content" && "border-warn/30 text-warn",
		id === "component-source" &&
			"border-accent/35 bg-accent-surface text-accent-fg",
		id === "component-instance" && "border-white/10 text-fg-muted",
		effectiveLocked && "border-warn/35 text-warn",
	);

const successDetail = (plan: LayerWorkflowActionPlan): string => {
	if (!plan.enabled) return "";
	if (plan.id === "copy")
		return `Copied ${formatCount(plan.copiedNodeCount, "node")}`;
	if (plan.id === "group") return "Grouped selection";
	if (plan.id === "ungroup") {
		return `Selected ${formatCount(plan.selectNodeIds.length, "child")}`;
	}
	if (plan.id === "component-source") return "Saved object asset";
	if (plan.id === "component-instance") return "Selected placed copy";
	if (plan.id === "component-detach") return "Detached placed copy";
	if (plan.id === "duplicate") {
		return `Duplicated ${formatCount(plan.selectNodeIds.length, "node")}`;
	}
	if (plan.id === "delete") return "Deleted selection";
	return `Pasted ${formatCount(plan.selectNodeIds.length, "node")}`;
};

const emptyStateLabel = (
	state: LayerPanelFilteredRowsEmptyState | null,
): string => {
	if (state === "no-current-artboard") return "No current artboard";
	if (state === "no-search-results") return "No matches";
	if (state === "no-selection") return "No selection";
	if (state === "no-focused-selection") return "Selection hidden by filters";
	return "No rows";
};

type ExpandButtonProps = {
	readonly id: string;
	readonly expanded: boolean;
	readonly disabled: boolean;
	readonly onToggle: (id: string) => void;
};

function ExpandButton({ id, expanded, disabled, onToggle }: ExpandButtonProps) {
	if (disabled) return <span className="size-3.5" aria-hidden="true" />;
	const IconComponent = expanded ? CaretDown : CaretRight;

	return (
		<button
			type="button"
			aria-label={expanded ? "Collapse" : "Expand"}
			title={expanded ? "Collapse" : "Expand"}
			className="grid size-3.5 place-items-center rounded text-fg-muted transition hover:bg-white/[0.08] hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
			onClick={() => onToggle(id)}
		>
			<IconComponent aria-hidden="true" size={9} />
		</button>
	);
}

type PanelToggleButtonProps = {
	readonly label: string;
	readonly pressed: boolean;
	readonly IconComponent: Icon;
	readonly onClick: () => void;
};

function PanelToggleButton({
	label,
	pressed,
	IconComponent,
	onClick,
}: PanelToggleButtonProps) {
	return (
		<button
			type="button"
			aria-label={label}
			aria-pressed={pressed}
			title={label}
			className={cn(
				"grid size-5 place-items-center rounded border text-fg-muted transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
				pressed
					? "border-accent/45 bg-accent-surface text-accent-fg"
					: "border-white/8 bg-black/18 hover:border-white/18 hover:text-fg-secondary",
			)}
			onClick={onClick}
		>
			<IconComponent
				aria-hidden="true"
				size={11}
				weight={pressed ? "fill" : "regular"}
			/>
		</button>
	);
}

type RowActionButtonProps = {
	readonly label: string;
	readonly pressed?: boolean;
	readonly IconComponent: Icon;
	readonly onClick: () => void;
	readonly disabled?: boolean;
	readonly ariaDisabled?: boolean;
	readonly danger?: boolean;
};

function RowActionButton({
	label,
	pressed,
	IconComponent,
	onClick,
	disabled = false,
	ariaDisabled = false,
	danger = false,
}: RowActionButtonProps) {
	const unavailable = disabled || ariaDisabled;
	return (
		<button
			type="button"
			aria-label={label}
			aria-pressed={pressed}
			aria-disabled={unavailable}
			title={label}
			disabled={disabled}
			className={cn(
				"grid size-[18px] place-items-center rounded border text-fg-muted transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
				unavailable
					? "cursor-not-allowed border-white/6 bg-black/15 text-fg-subtle opacity-35"
					: pressed
						? "border-white/10 bg-white/[0.055] text-fg-secondary"
						: danger
							? "border-white/6 bg-black/15 text-fg-muted hover:border-danger/35 hover:text-danger-fg"
							: "border-white/6 bg-black/15 text-fg-subtle hover:border-white/16 hover:text-fg-secondary",
			)}
			onClick={onClick}
		>
			<IconComponent
				aria-hidden="true"
				size={10}
				weight={pressed ? "fill" : "regular"}
			/>
		</button>
	);
}

type WorkflowButtonProps = {
	readonly label: string;
	readonly IconComponent: Icon;
	readonly plan: LayerWorkflowActionPlan;
	readonly onClick: () => void;
};

function WorkflowButton({
	label,
	IconComponent,
	plan,
	onClick,
}: WorkflowButtonProps) {
	const disabledIssue = plan.disabledReason;
	const unavailable = !plan.enabled;
	const title =
		unavailable && disabledIssue ? `${label}: ${disabledIssue.message}` : label;
	const destructive = plan.id === "delete";

	return (
		<button
			type="button"
			aria-label={title}
			aria-disabled={unavailable}
			title={title}
			className={cn(
				"grid size-[18px] place-items-center rounded border border-white/10 bg-black/18 text-fg-muted transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
				unavailable
					? "cursor-not-allowed opacity-45 hover:border-white/10 hover:text-fg-muted"
					: destructive
						? "hover:border-danger/45 hover:text-danger-fg"
						: "hover:border-accent/45 hover:text-accent-fg",
			)}
			onClick={onClick}
		>
			<IconComponent aria-hidden="true" size={10} />
		</button>
	);
}

type AssetLibraryViewProps = {
	readonly library: AssetLibraryReadModel;
	readonly viewMode: AssetViewMode;
	readonly createComponentAction: AssetLibraryActionAvailability;
	readonly createStyleAction: AssetLibraryActionAvailability;
	readonly styleApplyReason: string | null;
	readonly onViewModeChange: (viewMode: AssetViewMode) => void;
	readonly onChooseImageFile: () => void;
	readonly onCreateComponent: () => void;
	readonly onCreateStyle: () => void;
	readonly onPlaceImage: (assetId: string) => void;
	readonly onPlaceComponent: (symbolId: string) => void;
	readonly onApplyStyle: (presetId: string) => void;
	readonly onDeleteImage: (assetId: string) => void;
	readonly onRenameAsset: (assetId: string, name: string) => void;
	readonly onDeleteComponent: (symbolId: string) => void;
	readonly onDeleteStyle: (presetId: string) => void;
	readonly onLocateNode: (nodeId: string) => void;
};

function AssetSection({
	label,
	count,
	children,
}: {
	readonly label: string;
	readonly count: number;
	readonly children: ReactNode;
}) {
	return (
		<section className="space-y-1">
			<div className="flex h-5 items-center justify-between px-1 text-fg-muted text-ui">
				<span className="font-medium">{label}</span>
				<span className="font-mono">{count}</span>
			</div>
			<div className="space-y-1">{children}</div>
		</section>
	);
}

function AssetUsagePill({
	count,
	label,
}: {
	readonly count: number;
	readonly label: string;
}) {
	return (
		<span
			className={cn(
				"rounded border px-1 py-0.5 font-mono text-ui",
				count > 0
					? "border-accent/35 bg-accent-surface text-accent-fg"
					: "border-white/8 bg-black/12 text-fg-muted",
			)}
			title={`${count} ${label}`}
		>
			{count}
		</span>
	);
}

function AssetHubActionButton({
	label,
	disabledLabel,
	IconComponent,
	disabled = false,
	tone = "default",
	onClick,
}: {
	readonly label: string;
	readonly disabledLabel?: string;
	readonly IconComponent: Icon;
	readonly disabled?: boolean;
	readonly tone?: "default" | "primary";
	readonly onClick: () => void;
}) {
	return (
		<button
			type="button"
			aria-label={disabled && disabledLabel ? disabledLabel : label}
			aria-disabled={disabled}
			title={disabled && disabledLabel ? disabledLabel : label}
			className={cn(
				"flex h-6 w-full min-w-0 flex-1 items-center justify-center gap-1 rounded border px-1.5 text-ui transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
				disabled
					? "cursor-not-allowed border-white/6 bg-black/12 text-fg-subtle opacity-45"
					: tone === "primary"
						? "border-accent/45 bg-accent-surface text-accent-fg hover:border-accent hover:bg-accent-surface/90"
						: "border-white/8 bg-black/18 text-fg-muted hover:border-accent/35 hover:text-accent-fg",
			)}
			onClick={onClick}
		>
			<IconComponent aria-hidden="true" size={11} />
			<span className="truncate">{label}</span>
		</button>
	);
}

function AssetActionBar({
	createComponentAction,
	createStyleAction,
	onChooseImageFile,
	onCreateComponent,
	onCreateStyle,
}: {
	readonly createComponentAction: AssetLibraryActionAvailability;
	readonly createStyleAction: AssetLibraryActionAvailability;
	readonly onChooseImageFile: () => void;
	readonly onCreateComponent: () => void;
	readonly onCreateStyle: () => void;
}) {
	return (
		<div className="space-y-1">
			<AssetHubActionButton
				label="Save object"
				disabled={!createComponentAction.enabled}
				disabledLabel={
					createComponentAction.enabled
						? "Save selected object to Document assets"
						: createComponentAction.reason
				}
				IconComponent={Stack}
				tone="primary"
				onClick={onCreateComponent}
			/>
			<div className="grid grid-cols-2 gap-1">
				<AssetHubActionButton
					label="Import image"
					IconComponent={Shapes}
					onClick={onChooseImageFile}
				/>
				<AssetHubActionButton
					label="Save style"
					disabled={!createStyleAction.enabled}
					disabledLabel={
						createStyleAction.enabled
							? "Save selected style to Document assets"
							: `Save style: ${createStyleAction.reason}`
					}
					IconComponent={Circle}
					onClick={onCreateStyle}
				/>
			</div>
		</div>
	);
}

function AssetViewModeToggle({
	viewMode,
	onViewModeChange,
}: {
	readonly viewMode: AssetViewMode;
	readonly onViewModeChange: (viewMode: AssetViewMode) => void;
}) {
	return (
		<div className="flex items-center justify-end gap-0.5">
			<PanelToggleButton
				label="Grid view"
				pressed={viewMode === "grid"}
				IconComponent={SquaresFour}
				onClick={() => onViewModeChange("grid")}
			/>
			<PanelToggleButton
				label="List view"
				pressed={viewMode === "list"}
				IconComponent={Rows}
				onClick={() => onViewModeChange("list")}
			/>
		</div>
	);
}

function AssetTileGrid({ children }: { readonly children: ReactNode }) {
	return (
		<div
			className="grid gap-1"
			style={{ gridTemplateColumns: "repeat(auto-fit, minmax(118px, 1fr))" }}
		>
			{children}
		</div>
	);
}

function AssetTile({
	preview,
	name,
	meta,
	usage,
	actions,
	extra,
}: {
	readonly preview: ReactNode;
	readonly name: ReactNode;
	readonly meta: string;
	readonly usage: ReactNode;
	readonly actions: ReactNode;
	readonly extra?: ReactNode;
}) {
	return (
		<div className="min-w-0 rounded border border-white/8 bg-black/16 p-1">
			<div
				className="grid min-h-24 overflow-hidden rounded border border-white/8 bg-surface-sunken"
				style={{ aspectRatio: "4 / 3" }}
			>
				{preview}
			</div>
			<div className="mt-1 min-w-0">
				{name}
				<div className="mt-0.5 truncate text-fg-muted text-ui leading-3">
					{meta}
				</div>
				<div className="mt-1 flex items-center justify-between gap-1">
					{usage}
					<div className="flex shrink-0 items-center gap-0.5">{actions}</div>
				</div>
			</div>
			{extra}
		</div>
	);
}

function AssetNameInput({
	entry,
	onRename,
}: {
	readonly entry: AssetLibraryImageEntry;
	readonly onRename: (assetId: string, name: string) => void;
}) {
	return (
		<input
			key={`${entry.id}:${entry.name}`}
			defaultValue={entry.name}
			aria-label={`Rename asset ${entry.name}`}
			className="h-4 w-full rounded border border-transparent bg-transparent px-0.5 font-medium text-fg-secondary text-ui leading-3 outline-none focus:border-accent/45 focus:bg-black/20"
			onBlur={(event) => onRename(entry.id, event.currentTarget.value)}
			onKeyDown={(event) => {
				if (event.key === "Enter") event.currentTarget.blur();
				if (event.key === "Escape") {
					event.currentTarget.value = entry.name;
					event.currentTarget.blur();
				}
			}}
		/>
	);
}

function ImageAssetPreview({
	entry,
}: {
	readonly entry: AssetLibraryImageEntry;
}) {
	const [previewFailed, setPreviewFailed] = useState(false);
	const showPreview = Boolean(entry.previewHref) && !previewFailed;

	return (
		<div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded border border-white/8 bg-surface-sunken">
			{showPreview ? (
				<img
					src={entry.previewHref}
					alt=""
					className="size-full object-cover"
					loading="lazy"
					onError={() => setPreviewFailed(true)}
				/>
			) : (
				<Shapes aria-hidden="true" size={16} className="text-fg-muted" />
			)}
		</div>
	);
}

function ImageAssetVisualPreview({
	entry,
}: {
	readonly entry: AssetLibraryImageEntry;
}) {
	const [previewFailed, setPreviewFailed] = useState(false);
	const showPreview = Boolean(entry.previewHref) && !previewFailed;
	return (
		<div className="grid size-full place-items-center text-fg-muted">
			{showPreview ? (
				<img
					src={entry.previewHref}
					alt=""
					className="size-full object-contain"
					loading="lazy"
					onError={() => setPreviewFailed(true)}
				/>
			) : (
				<Shapes aria-hidden="true" size={24} />
			)}
		</div>
	);
}

function ImageAssetRow({
	entry,
	onPlace,
	onLocate,
	onDelete,
	onRename,
}: {
	readonly entry: AssetLibraryImageEntry;
	readonly onPlace: (assetId: string) => void;
	readonly onLocate: (nodeId: string) => void;
	readonly onDelete: (assetId: string) => void;
	readonly onRename: (assetId: string, name: string) => void;
}) {
	const firstUsageNodeId = entry.usageNodeIds[0];
	const deleteLabel =
		entry.usageCount > 0
			? `Delete asset ${entry.name}: remove uses first`
			: `Delete asset ${entry.name}`;
	return (
		<>
			<div className="grid min-h-12 grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-1 rounded border border-white/8 bg-black/16 px-1 py-1">
				<ImageAssetPreview entry={entry} />
				<div className="min-w-0">
					<AssetNameInput entry={entry} onRename={onRename} />
					<div className="mt-0.5 truncate text-fg-muted text-ui leading-3">
						{entry.assetKind} / {entry.dimensionsLabel} / {entry.sourceKind}
					</div>
					<div className="mt-1 flex items-center gap-1">
						<AssetUsagePill count={entry.usageCount} label="uses" />
						<span className="truncate text-fg-subtle text-ui">
							{entry.usageCount > 0 ? "used" : "unused"}
						</span>
					</div>
				</div>
				<div className="flex items-center gap-0.5">
					<RowActionButton
						label={
							firstUsageNodeId
								? `Select first use of ${entry.name}`
								: `${entry.name} has no uses`
						}
						IconComponent={Crosshair}
						disabled={!firstUsageNodeId}
						onClick={() => {
							if (firstUsageNodeId) onLocate(firstUsageNodeId);
						}}
					/>
					<RowActionButton
						label={`Place asset ${entry.name}`}
						IconComponent={Plus}
						onClick={() => onPlace(entry.id)}
					/>
					<RowActionButton
						label={deleteLabel}
						IconComponent={Trash}
						disabled={entry.usageCount > 0}
						danger
						onClick={() => onDelete(entry.id)}
					/>
				</div>
			</div>
			{entry.asset.kind === "model-3d" ? (
				<BlenderLinkAssetSection asset={entry.asset} />
			) : null}
		</>
	);
}

function ImageAssetTile({
	entry,
	onPlace,
	onLocate,
	onDelete,
	onRename,
}: {
	readonly entry: AssetLibraryImageEntry;
	readonly onPlace: (assetId: string) => void;
	readonly onLocate: (nodeId: string) => void;
	readonly onDelete: (assetId: string) => void;
	readonly onRename: (assetId: string, name: string) => void;
}) {
	const firstUsageNodeId = entry.usageNodeIds[0];
	const deleteLabel =
		entry.usageCount > 0
			? `Delete asset ${entry.name}: remove uses first`
			: `Delete asset ${entry.name}`;
	return (
		<AssetTile
			preview={<ImageAssetVisualPreview entry={entry} />}
			name={<AssetNameInput entry={entry} onRename={onRename} />}
			meta={`${entry.assetKind} / ${entry.dimensionsLabel} / ${entry.sourceKind}`}
			usage={<AssetUsagePill count={entry.usageCount} label="uses" />}
			actions={
				<>
					<RowActionButton
						label={
							firstUsageNodeId
								? `Select first use of ${entry.name}`
								: `${entry.name} has no uses`
						}
						IconComponent={Crosshair}
						disabled={!firstUsageNodeId}
						onClick={() => {
							if (firstUsageNodeId) onLocate(firstUsageNodeId);
						}}
					/>
					<RowActionButton
						label={`Place asset ${entry.name}`}
						IconComponent={Plus}
						onClick={() => onPlace(entry.id)}
					/>
					<RowActionButton
						label={deleteLabel}
						IconComponent={Trash}
						disabled={entry.usageCount > 0}
						danger
						onClick={() => onDelete(entry.id)}
					/>
				</>
			}
			extra={
				entry.asset.kind === "model-3d" ? (
					<BlenderLinkAssetSection asset={entry.asset} />
				) : null
			}
		/>
	);
}

function ComponentAssetPreview({
	entry,
}: {
	readonly entry: AssetLibraryComponentEntry;
}) {
	return (
		<div
			className={cn(
				"relative grid size-10 shrink-0 place-items-center overflow-hidden rounded border bg-surface-sunken",
				entry.sourceNodeKind ? "border-white/8" : "border-warn/35 text-warn-fg",
			)}
		>
			<Stack aria-hidden="true" size={17} className="text-fg-muted" />
			<span className="absolute right-0.5 bottom-0.5 rounded border border-white/8 bg-surface-raised/90 px-0.5 font-mono text-fg-muted text-ui leading-3">
				{entry.usageCount}
			</span>
		</div>
	);
}

function ComponentAssetVisualPreview({
	entry,
	imageHrefByAssetId,
}: {
	readonly entry: AssetLibraryComponentEntry;
	readonly imageHrefByAssetId: ReadonlyMap<string, string>;
}) {
	if (!entry.sourceNode || !entry.previewBounds) {
		return (
			<div className="grid size-full place-items-center text-warn-fg">
				<Stack aria-hidden="true" size={24} />
			</div>
		);
	}
	return (
		<AssetNodePreview
			node={entry.sourceNode}
			bounds={entry.previewBounds}
			imageHrefByAssetId={imageHrefByAssetId}
			label={entry.name}
		/>
	);
}

function ComponentAssetRow({
	entry,
	onPlace,
	onLocate,
	onDelete,
}: {
	readonly entry: AssetLibraryComponentEntry;
	readonly onPlace: (symbolId: string) => void;
	readonly onLocate: (nodeId: string) => void;
	readonly onDelete: (symbolId: string) => void;
}) {
	const firstInstanceNodeId = entry.instanceNodeIds[0];
	return (
		<div className="grid min-h-12 grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-1 rounded border border-white/8 bg-black/16 px-1 py-1">
			<ComponentAssetPreview entry={entry} />
			<div className="min-w-0">
				<div className="truncate font-medium text-fg-secondary text-ui leading-3">
					{entry.name}
				</div>
				<div className="mt-0.5 truncate text-fg-muted text-ui leading-3">
					Saved from {entry.sourceNodeName}
				</div>
				<div className="mt-1 flex items-center gap-1">
					<AssetUsagePill count={entry.usageCount} label="placements" />
					<span className="truncate text-fg-subtle text-ui">
						{entry.usageCount > 0 ? "placed" : "ready to place"}
					</span>
				</div>
			</div>
			<div className="flex items-center gap-0.5">
				<RowActionButton
					label={
						firstInstanceNodeId
							? `Select first placed copy of ${entry.name}`
							: `${entry.name} has no placed copies`
					}
					IconComponent={Crosshair}
					disabled={!firstInstanceNodeId}
					onClick={() => {
						if (firstInstanceNodeId) onLocate(firstInstanceNodeId);
					}}
				/>
				<RowActionButton
					label={`Place saved object ${entry.name}`}
					IconComponent={Plus}
					onClick={() => onPlace(entry.id)}
				/>
				<RowActionButton
					label={`Delete stored object ${entry.name}`}
					IconComponent={Trash}
					danger
					onClick={() => onDelete(entry.id)}
				/>
			</div>
		</div>
	);
}

function ComponentAssetTile({
	entry,
	imageHrefByAssetId,
	onPlace,
	onLocate,
	onDelete,
}: {
	readonly entry: AssetLibraryComponentEntry;
	readonly imageHrefByAssetId: ReadonlyMap<string, string>;
	readonly onPlace: (symbolId: string) => void;
	readonly onLocate: (nodeId: string) => void;
	readonly onDelete: (symbolId: string) => void;
}) {
	const firstInstanceNodeId = entry.instanceNodeIds[0];
	return (
		<AssetTile
			preview={
				<ComponentAssetVisualPreview
					entry={entry}
					imageHrefByAssetId={imageHrefByAssetId}
				/>
			}
			name={entry.name}
			meta={`Saved from ${entry.sourceNodeName}`}
			usage={<AssetUsagePill count={entry.usageCount} label="placements" />}
			actions={
				<>
					<RowActionButton
						label={
							firstInstanceNodeId
								? `Select first placed copy of ${entry.name}`
								: `${entry.name} has no placed copies`
						}
						IconComponent={Crosshair}
						disabled={!firstInstanceNodeId}
						onClick={() => {
							if (firstInstanceNodeId) onLocate(firstInstanceNodeId);
						}}
					/>
					<RowActionButton
						label={`Place saved object ${entry.name}`}
						IconComponent={Plus}
						onClick={() => onPlace(entry.id)}
					/>
					<RowActionButton
						label={`Delete stored object ${entry.name}`}
						IconComponent={Trash}
						danger
						onClick={() => onDelete(entry.id)}
					/>
				</>
			}
		/>
	);
}

const swatchBackground = (
	swatch: AssetLibraryStyleSwatch,
): string | undefined => {
	if (swatch.colors.length === 0) return undefined;
	if (swatch.colors.length === 1) return swatch.colors[0];
	return `linear-gradient(135deg, ${swatch.colors.join(", ")})`;
};

function StyleSwatchTile({
	swatch,
}: {
	readonly swatch: AssetLibraryStyleSwatch;
}) {
	const background = swatchBackground(swatch);
	return (
		<div
			className="grid min-w-0 flex-1 place-items-center overflow-hidden border-white/8 border-r last:border-r-0"
			title={swatch.label}
			style={background ? { background } : undefined}
		>
			{background ? null : swatch.kind === "empty" ? (
				<TextT aria-hidden="true" size={13} className="text-fg-muted" />
			) : (
				<Circle aria-hidden="true" size={12} className="text-fg-muted" />
			)}
		</div>
	);
}

function StyleAssetPreview({
	entry,
}: {
	readonly entry: AssetLibraryStyleEntry;
}) {
	return (
		<div className="flex size-10 shrink-0 overflow-hidden rounded border border-white/8 bg-surface-sunken">
			{entry.swatches.slice(0, 3).map((swatch) => (
				<StyleSwatchTile key={`${entry.id}:${swatch.id}`} swatch={swatch} />
			))}
		</div>
	);
}

function StyleAssetVisualPreview({
	entry,
}: {
	readonly entry: AssetLibraryStyleEntry;
}) {
	return (
		<div className="flex size-full overflow-hidden">
			{entry.swatches.slice(0, 3).map((swatch) => (
				<StyleSwatchTile
					key={`${entry.id}:visual:${swatch.id}`}
					swatch={swatch}
				/>
			))}
		</div>
	);
}

function StyleAssetRow({
	entry,
	applyReason,
	onApply,
	onDelete,
}: {
	readonly entry: AssetLibraryStyleEntry;
	readonly applyReason: string | null;
	readonly onApply: (presetId: string) => void;
	readonly onDelete: (presetId: string) => void;
}) {
	return (
		<div className="grid min-h-12 grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-1 rounded border border-white/8 bg-black/16 px-1 py-1">
			<StyleAssetPreview entry={entry} />
			<div className="min-w-0">
				<div className="truncate font-medium text-fg-secondary text-ui leading-3">
					{entry.name}
				</div>
				<div className="mt-0.5 truncate text-fg-muted text-ui leading-3">
					{entry.payloadLabel}
				</div>
			</div>
			<div className="flex items-center gap-0.5">
				<span className="rounded border border-white/8 px-1 py-0.5 text-fg-muted text-ui">
					{entry.styleKind}
				</span>
				<RowActionButton
					label={
						applyReason
							? `Apply ${entry.name}: ${applyReason}`
							: `Apply style ${entry.name}`
					}
					IconComponent={PencilSimple}
					ariaDisabled={applyReason !== null}
					onClick={() => onApply(entry.id)}
				/>
				<RowActionButton
					label={`Delete style ${entry.name}`}
					IconComponent={Trash}
					danger
					onClick={() => onDelete(entry.id)}
				/>
			</div>
		</div>
	);
}

function StyleAssetTile({
	entry,
	applyReason,
	onApply,
	onDelete,
}: {
	readonly entry: AssetLibraryStyleEntry;
	readonly applyReason: string | null;
	readonly onApply: (presetId: string) => void;
	readonly onDelete: (presetId: string) => void;
}) {
	return (
		<AssetTile
			preview={<StyleAssetVisualPreview entry={entry} />}
			name={entry.name}
			meta={`${entry.payloadLabel} / ${entry.styleKind}`}
			usage={
				<span className="rounded border border-white/8 px-1 py-0.5 text-fg-muted text-ui">
					{entry.styleKind}
				</span>
			}
			actions={
				<>
					<RowActionButton
						label={
							applyReason
								? `Apply ${entry.name}: ${applyReason}`
								: `Apply style ${entry.name}`
						}
						IconComponent={PencilSimple}
						ariaDisabled={applyReason !== null}
						onClick={() => onApply(entry.id)}
					/>
					<RowActionButton
						label={`Delete style ${entry.name}`}
						IconComponent={Trash}
						danger
						onClick={() => onDelete(entry.id)}
					/>
				</>
			}
		/>
	);
}

function AssetSectionEmpty({
	IconComponent,
	title,
	detail,
}: {
	readonly IconComponent: Icon;
	readonly title: string;
	readonly detail: string;
}) {
	return (
		<div className="grid min-h-10 grid-cols-[40px_minmax(0,1fr)] items-center gap-1 rounded border border-white/8 bg-black/12 px-1 py-1">
			<div className="grid size-10 place-items-center rounded border border-dashed border-white/10 bg-surface-sunken text-fg-subtle">
				<IconComponent aria-hidden="true" size={15} />
			</div>
			<div className="min-w-0">
				<div className="truncate font-medium text-fg-muted text-ui leading-3">
					{title}
				</div>
				<div className="mt-0.5 truncate text-fg-subtle text-ui leading-3">
					{detail}
				</div>
			</div>
		</div>
	);
}

function AssetLibraryScope({ totalCount }: { readonly totalCount: number }) {
	const totalLabel = `${totalCount} saved asset${totalCount === 1 ? "" : "s"}`;
	return (
		<div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1 rounded border border-white/8 bg-black/18 px-2 py-1.5 text-ui">
			<Shapes aria-hidden="true" size={12} className="text-fg-muted" />
			<div className="min-w-0">
				<div className="truncate font-medium text-fg-secondary leading-3">
					Document assets
				</div>
				<div className="mt-0.5 truncate text-fg-subtle leading-3">
					Saved in this project
				</div>
			</div>
			<span
				className="rounded border border-white/8 bg-surface-sunken px-1 py-0.5 text-fg-muted leading-3"
				title={totalLabel}
			>
				{totalCount}
			</span>
		</div>
	);
}

function AssetLibraryEmptyState() {
	return (
		<div className="space-y-1">
			<div className="rounded border border-white/8 bg-black/18 px-2 py-1.5 text-ui">
				<div className="flex items-center gap-1 font-medium text-fg-secondary">
					<Shapes aria-hidden="true" size={12} />
					No saved assets
				</div>
			</div>
			<AssetSectionEmpty
				IconComponent={Shapes}
				title="Media and runtime assets"
				detail="Imported image, video, 3D, code, and Program Surface files"
			/>
			<AssetSectionEmpty
				IconComponent={Stack}
				title="Stored objects"
				detail="Reusable canvas objects"
			/>
			<AssetSectionEmpty
				IconComponent={Circle}
				title="Styles"
				detail="Saved paint and type"
			/>
		</div>
	);
}

function AssetLibraryView({
	library,
	viewMode,
	createComponentAction,
	createStyleAction,
	styleApplyReason,
	onViewModeChange,
	onChooseImageFile,
	onCreateComponent,
	onCreateStyle,
	onPlaceImage,
	onPlaceComponent,
	onApplyStyle,
	onDeleteImage,
	onRenameAsset,
	onDeleteComponent,
	onDeleteStyle,
	onLocateNode,
}: AssetLibraryViewProps) {
	const imageHrefByAssetId = new Map<string, string>();
	for (const entry of library.images) {
		if (entry.previewHref) imageHrefByAssetId.set(entry.id, entry.previewHref);
	}
	if (library.totalCount === 0) {
		return (
			<div className="space-y-2">
				<AssetLibraryScope totalCount={library.totalCount} />
				<AssetActionBar
					createComponentAction={createComponentAction}
					createStyleAction={createStyleAction}
					onChooseImageFile={onChooseImageFile}
					onCreateComponent={onCreateComponent}
					onCreateStyle={onCreateStyle}
				/>
				<AssetLibraryEmptyState />
			</div>
		);
	}

	return (
		<div className="space-y-2">
			<AssetLibraryScope totalCount={library.totalCount} />
			<div className="space-y-1">
				<AssetActionBar
					createComponentAction={createComponentAction}
					createStyleAction={createStyleAction}
					onChooseImageFile={onChooseImageFile}
					onCreateComponent={onCreateComponent}
					onCreateStyle={onCreateStyle}
				/>
				<AssetViewModeToggle
					viewMode={viewMode}
					onViewModeChange={onViewModeChange}
				/>
			</div>
			<AssetSection
				label="Media and runtime assets"
				count={library.images.length}
			>
				{library.images.length > 0 ? (
					viewMode === "grid" ? (
						<AssetTileGrid>
							{library.images.map((entry) => (
								<ImageAssetTile
									key={entry.id}
									entry={entry}
									onPlace={onPlaceImage}
									onLocate={onLocateNode}
									onDelete={onDeleteImage}
									onRename={onRenameAsset}
								/>
							))}
						</AssetTileGrid>
					) : (
						library.images.map((entry) => (
							<ImageAssetRow
								key={entry.id}
								entry={entry}
								onPlace={onPlaceImage}
								onLocate={onLocateNode}
								onDelete={onDeleteImage}
								onRename={onRenameAsset}
							/>
						))
					)
				) : (
					<AssetSectionEmpty
						IconComponent={Shapes}
						title="No media assets"
						detail="Imported image, video, 3D, code, and Program Surface assets appear here"
					/>
				)}
			</AssetSection>
			<AssetSection label="Stored objects" count={library.components.length}>
				{library.components.length > 0 ? (
					viewMode === "grid" ? (
						<AssetTileGrid>
							{library.components.map((entry) => (
								<ComponentAssetTile
									key={entry.id}
									entry={entry}
									imageHrefByAssetId={imageHrefByAssetId}
									onPlace={onPlaceComponent}
									onLocate={onLocateNode}
									onDelete={onDeleteComponent}
								/>
							))}
						</AssetTileGrid>
					) : (
						library.components.map((entry) => (
							<ComponentAssetRow
								key={entry.id}
								entry={entry}
								onPlace={onPlaceComponent}
								onLocate={onLocateNode}
								onDelete={onDeleteComponent}
							/>
						))
					)
				) : (
					<AssetSectionEmpty
						IconComponent={Stack}
						title="No stored objects"
						detail="Saved objects appear here"
					/>
				)}
			</AssetSection>
			<AssetSection label="Styles" count={library.styles.length}>
				{library.styles.length > 0 ? (
					viewMode === "grid" ? (
						<AssetTileGrid>
							{library.styles.map((entry) => (
								<StyleAssetTile
									key={entry.id}
									entry={entry}
									applyReason={styleApplyReason}
									onApply={onApplyStyle}
									onDelete={onDeleteStyle}
								/>
							))}
						</AssetTileGrid>
					) : (
						library.styles.map((entry) => (
							<StyleAssetRow
								key={entry.id}
								entry={entry}
								applyReason={styleApplyReason}
								onApply={onApplyStyle}
								onDelete={onDeleteStyle}
							/>
						))
					)
				) : (
					<AssetSectionEmpty
						IconComponent={Circle}
						title="No styles"
						detail="Saved paint and type appear here"
					/>
				)}
			</AssetSection>
		</div>
	);
}

function WorkflowReport({
	report,
	onDismiss,
}: {
	readonly report: WorkflowActionReport;
	readonly onDismiss: () => void;
}) {
	const visibleIssues = report.issues.slice(0, 2);

	return (
		<div
			aria-live="polite"
			className={`mx-1 mt-1 rounded border bg-black/24 px-1.5 py-0.5 text-ui ${reportClassName(report.status)}`}
		>
			<div className="flex items-start justify-between gap-1.5">
				<div className="min-w-0">
					<div className="truncate font-medium">{report.title}</div>
					{report.detail ? (
						<div className="mt-0.5 truncate text-fg-muted">{report.detail}</div>
					) : null}
				</div>
				<button
					type="button"
					aria-label="Dismiss workflow report"
					title="Dismiss"
					className="grid size-3.5 shrink-0 place-items-center rounded border border-white/10 bg-white/5 text-fg-secondary hover:text-white"
					onClick={onDismiss}
				>
					<X aria-hidden="true" size={9} />
				</button>
			</div>
			{visibleIssues.length > 0 ? (
				<ul className="mt-1 space-y-0.5">
					{visibleIssues.map((issue, index) => (
						<li
							key={`${issue.source}:${issue.code}:${issue.sourceId ?? issue.layerId ?? index}`}
							className="rounded border border-white/8 bg-white/[0.035] px-1 py-0.5 text-fg-secondary"
						>
							<span className="font-mono text-fg-muted text-ui">
								{issue.severity} / {issue.code}
							</span>
							<span className="mt-0.5 block leading-3.5">{issue.message}</span>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}

type MoveRowButtonProps = {
	readonly label: string;
	readonly direction: MoveDirection;
	readonly disabled: boolean;
	readonly onClick: () => void;
};

function MoveRowButton({
	label,
	direction,
	disabled,
	onClick,
}: MoveRowButtonProps) {
	const IconComponent = direction === "up" ? ArrowUp : ArrowDown;

	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			disabled={disabled}
			className={cn(
				"grid size-[18px] place-items-center rounded border border-white/6 bg-black/15 text-fg-subtle transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
				disabled
					? "cursor-not-allowed opacity-35"
					: "hover:border-white/16 hover:text-fg-secondary",
			)}
			onClick={onClick}
		>
			<IconComponent aria-hidden="true" size={10} />
		</button>
	);
}

type RenameInputProps = {
	readonly target: EditingTarget;
	readonly onChange: (value: string) => void;
	readonly onCommit: (target: EditingTarget) => void;
	readonly onKeyDown: (
		event: KeyboardEvent<HTMLInputElement>,
		target: EditingTarget,
	) => void;
};

function RenameInput({
	target,
	onChange,
	onCommit,
	onKeyDown,
}: RenameInputProps) {
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
		inputRef.current?.select();
	}, []);

	return (
		<input
			ref={inputRef}
			type="text"
			value={target.value}
			aria-label="Row name"
			onChange={(event) => onChange(event.currentTarget.value)}
			onBlur={() => onCommit(target)}
			onFocus={(event) => event.currentTarget.select()}
			onKeyDown={(event) => onKeyDown(event, target)}
			className="h-[18px] min-w-0 flex-1 rounded border border-accent/45 bg-black/35 px-1 text-fg text-ui outline-none"
		/>
	);
}

type LayerRowProps = {
	readonly row: LayerPanelLayerRow;
	readonly editing: EditingTarget | null;
	readonly onToggleExpanded: (id: string) => void;
	readonly onBeginRename: (
		kind: EditingTarget["kind"],
		id: string,
		name: string,
	) => void;
	readonly onRenameValueChange: (value: string) => void;
	readonly onCommitRename: (target: EditingTarget) => void;
	readonly onRenameKeyDown: (
		event: KeyboardEvent<HTMLInputElement>,
		target: EditingTarget,
	) => void;
	readonly canMoveUp: boolean;
	readonly canMoveDown: boolean;
	readonly onMove: (layerId: string, direction: MoveDirection) => void;
	readonly onToggleVisibility: (layer: SceneLayer) => void;
	readonly onToggleLocked: (layer: SceneLayer) => void;
	readonly dragProps: LayerRowDragProps;
	readonly dropIndicator: LayerDropIndicator | null;
};

function LayerRow({
	row,
	editing,
	onToggleExpanded,
	onBeginRename,
	onRenameValueChange,
	onCommitRename,
	onRenameKeyDown,
	canMoveUp,
	canMoveDown,
	onMove,
	onToggleVisibility,
	onToggleLocked,
	dragProps,
	dropIndicator,
}: LayerRowProps) {
	const layer = row.layer;
	const layerEditing =
		editing?.kind === "layer" && editing.id === layer.id ? editing : null;
	const menuGroups: readonly ContextMenuGroup[] = [
		{
			id: "edit",
			items: [
				{
					id: "rename",
					label: "Rename",
					icon: PencilSimple,
					onSelect: () => onBeginRename("layer", layer.id, layer.name),
				},
			],
		},
		{
			id: "state",
			items: [
				{
					id: "visibility",
					label: layer.visible ? "Hide" : "Show",
					icon: layer.visible ? EyeSlash : Eye,
					onSelect: () => onToggleVisibility(layer),
				},
				{
					id: "lock",
					label: layer.locked ? "Unlock" : "Lock",
					icon: layer.locked ? LockOpen : Lock,
					onSelect: () => onToggleLocked(layer),
				},
			],
		},
	];

	return (
		<ContextMenu label={`${layer.name} actions`} groups={menuGroups}>
			<div
				{...dragProps}
				className={cn(
					"relative grid h-6 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-0.5 rounded border px-1 transition",
					layer.visible
						? "border-white/8 bg-white/[0.035]"
						: "border-white/6 border-dashed bg-black/20 opacity-65",
					layer.locked &&
						"border-warn/35 shadow-[inset_3px_0_0_var(--color-warn)]",
				)}
				style={{
					paddingLeft:
						row.depth > 0 ? rowIndentPx("layer", row.depth) : undefined,
				}}
			>
				{dropIndicator ? (
					<DropIndicatorOverlay indicator={dropIndicator} />
				) : null}
				<ExpandButton
					id={row.rowId}
					expanded={row.expanded}
					disabled={!row.hasChildren}
					onToggle={onToggleExpanded}
				/>
				{layerEditing ? (
					<RenameInput
						target={layerEditing}
						onChange={onRenameValueChange}
						onCommit={onCommitRename}
						onKeyDown={onRenameKeyDown}
					/>
				) : (
					<button
						type="button"
						className="min-w-0 truncate px-1 text-left font-medium text-fg-secondary text-ui uppercase tracking-[0.06em] transition hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
						title={layer.name}
						onClick={() => onToggleExpanded(row.rowId)}
						onDoubleClick={() => onBeginRename("layer", layer.id, layer.name)}
					>
						{layer.name}
					</button>
				)}
				<div className="flex items-center gap-0.5">
					<MoveRowButton
						label="Move layer up"
						direction="up"
						disabled={!canMoveUp}
						onClick={() => onMove(layer.id, "up")}
					/>
					<MoveRowButton
						label="Move layer down"
						direction="down"
						disabled={!canMoveDown}
						onClick={() => onMove(layer.id, "down")}
					/>
					<RowActionButton
						label={`${layer.visible ? "Hide" : "Show"} layer ${layer.name}`}
						pressed={layer.visible}
						IconComponent={layer.visible ? Eye : EyeSlash}
						onClick={() => onToggleVisibility(layer)}
					/>
					<RowActionButton
						label={`${layer.locked ? "Unlock" : "Lock"} layer ${layer.name}`}
						pressed={layer.locked}
						IconComponent={layer.locked ? Lock : LockOpen}
						onClick={() => onToggleLocked(layer)}
					/>
				</div>
			</div>
		</ContextMenu>
	);
}

type NodeRowProps = {
	readonly row: LayerPanelNodeRow;
	readonly editing: EditingTarget | null;
	readonly onToggleExpanded: (id: string) => void;
	readonly onSelectNode: (nodeId: string, intent: NodeSelectIntent) => void;
	readonly onBeginRename: (
		kind: EditingTarget["kind"],
		id: string,
		name: string,
	) => void;
	readonly onRenameValueChange: (value: string) => void;
	readonly onCommitRename: (target: EditingTarget) => void;
	readonly onRenameKeyDown: (
		event: KeyboardEvent<HTMLInputElement>,
		target: EditingTarget,
	) => void;
	readonly reorderContext?: {
		readonly layerId: string;
		readonly siblings: readonly VectorNode[];
	};
	readonly onMove: (
		layerId: string,
		nodeId: string,
		direction: MoveDirection,
	) => void;
	readonly onToggleVisibility: (node: VectorNode) => void;
	readonly onToggleLocked: (node: VectorNode) => void;
	readonly onDeleteNode: (row: LayerPanelNodeRow) => void;
	readonly selectedNodeIds: readonly string[];
	readonly onUseAsMask: (row: LayerPanelNodeRow) => void;
	readonly onReleaseMask: (row: LayerPanelNodeRow) => void;
	readonly dragProps: LayerRowDragProps;
	readonly dropIndicator: LayerDropIndicator | null;
};

function NodeRow({
	row,
	editing,
	onToggleExpanded,
	onSelectNode,
	onBeginRename,
	onRenameValueChange,
	onCommitRename,
	onRenameKeyDown,
	reorderContext,
	onMove,
	onToggleVisibility,
	onToggleLocked,
	onDeleteNode,
	selectedNodeIds,
	onUseAsMask,
	onReleaseMask,
	dragProps,
	dropIndicator,
}: NodeRowProps) {
	const node = row.node;
	const hasChildren = row.hasChildren;
	const expanded = row.expanded;
	const selected = row.selected;
	const primary = row.primary;
	const effectiveVisible = row.effectiveVisible;
	const effectiveLocked = row.effectiveLocked;
	const IconComponent = nodeRoleIcons[row.role.id] ?? Shapes;
	const chipColor = chipColorForNode(node);
	const roleBadges = row.role.badges;
	const nodeEditing =
		editing?.kind === "node" && editing.id === node.id ? editing : null;
	const deletesSelection = selected && selectedNodeIds.length > 1;
	const canMoveUp =
		reorderContext !== undefined &&
		nodeMoveTargetIndex(reorderContext.siblings, node.id, "up") !== null;
	const canMoveDown =
		reorderContext !== undefined &&
		nodeMoveTargetIndex(reorderContext.siblings, node.id, "down") !== null;
	const canDelete = canDeleteLayerPanelNodeRow(row);
	// "Use as Mask" needs a second selected node to clip; "Release Mask" only makes
	// sense once this node is a mask source (the badge the panel already computes).
	const isMaskSource = roleBadges.some((badge) => badge.id === "mask-source");
	const canUseAsMask = selectedNodeIds.some((nodeId) => nodeId !== node.id);
	const maskItems = [
		...(canUseAsMask
			? [
					{
						id: "use-as-mask",
						label: "Use as Mask",
						icon: Intersect,
						onSelect: () => onUseAsMask(row),
					},
				]
			: []),
		...(isMaskSource
			? [
					{
						id: "release-mask",
						label: "Release Mask",
						icon: X,
						onSelect: () => onReleaseMask(row),
					},
				]
			: []),
	];
	const menuGroups: readonly ContextMenuGroup[] = [
		{
			id: "edit",
			items: [
				{
					id: "rename",
					label: "Rename",
					icon: PencilSimple,
					onSelect: () => onBeginRename("node", node.id, node.name),
				},
			],
		},
		{
			id: "state",
			items: [
				{
					id: "visibility",
					label: node.visible ? "Hide" : "Show",
					icon: node.visible ? EyeSlash : Eye,
					onSelect: () => onToggleVisibility(node),
				},
				{
					id: "lock",
					label: node.locked ? "Unlock" : "Lock",
					icon: node.locked ? LockOpen : Lock,
					onSelect: () => onToggleLocked(node),
				},
			],
		},
		...(maskItems.length > 0 ? [{ id: "mask", items: maskItems }] : []),
		{
			id: "danger",
			items: [
				{
					id: "delete",
					label: deletesSelection ? "Delete Selection" : "Delete",
					icon: Trash,
					danger: true,
					disabled: !canDelete,
					onSelect: () => onDeleteNode(row),
				},
			],
		},
	];

	return (
		<ContextMenu label={`${node.name} actions`} groups={menuGroups}>
			<div {...dragProps} className="relative">
				{dropIndicator ? (
					<DropIndicatorOverlay indicator={dropIndicator} />
				) : null}
				<div
					className={cn(
						"group/row grid h-6 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-0.5 rounded border pr-1 transition",
						primary
							? "border-accent/70 bg-accent-surface text-accent-fg"
							: selected
								? "border-accent/35 bg-accent-surface text-accent-fg"
								: "border-white/8 bg-white/[0.035] text-fg-secondary hover:border-white/16 hover:bg-white/[0.065]",
						!effectiveVisible && "border-dashed opacity-55",
						effectiveLocked &&
							"border-warn/35 shadow-[inset_3px_0_0_var(--color-warn)]",
					)}
					style={{ paddingLeft: rowIndentPx("node", row.depth) }}
				>
					<ExpandButton
						id={node.id}
						expanded={expanded}
						disabled={!hasChildren}
						onToggle={onToggleExpanded}
					/>
					{nodeEditing ? (
						<RenameInput
							target={nodeEditing}
							onChange={onRenameValueChange}
							onCommit={onCommitRename}
							onKeyDown={onRenameKeyDown}
						/>
					) : (
						<button
							type="button"
							className={cn(
								"grid min-w-0 items-center gap-0.5 rounded px-1 py-0.5 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
								roleBadges.length > 0
									? "grid-cols-[auto_auto_auto_minmax(0,1fr)]"
									: "grid-cols-[auto_auto_minmax(0,1fr)]",
							)}
							title={`${node.name} (${row.role.label})${node.motionParent ? ` · motion parent ${node.motionParent.parentNodeId}` : ""}${node.transformConstraint ? ` · constraint source ${node.transformConstraint.sourceNodeId}` : ""}${node.propertyRelations?.length ? ` · ${node.propertyRelations.length} property relation(s)` : ""}`}
							onClick={(event) =>
								onSelectNode(node.id, {
									shift: event.shiftKey,
									toggle: event.metaKey || event.ctrlKey,
								})
							}
							onDoubleClick={() => onBeginRename("node", node.id, node.name)}
						>
							<IconComponent
								aria-hidden="true"
								size={10}
								weight={primary ? "duotone" : "regular"}
								className={cn(
									"text-fg-muted",
									selected && "text-accent-fg",
									effectiveLocked && "text-warn",
								)}
							/>
							<span
								className="size-1.5 rounded-[2px] border border-black/35 shadow-inner"
								style={{
									backgroundColor: chipColor,
									backgroundImage:
										chipColor === "transparent"
											? "linear-gradient(135deg, transparent 45%, rgba(255,255,255,0.55) 45%, rgba(255,255,255,0.55) 55%, transparent 55%)"
											: undefined,
								}}
							/>
							{roleBadges.length > 0 ? (
								<span className="flex min-w-0 items-center gap-0.5 overflow-hidden">
									{roleBadges.map((badge) => (
										<span
											key={badge.id}
											className={nodeRoleBadgeClassName(
												badge.id,
												effectiveLocked,
											)}
											title={badge.label}
										>
											{nodeRoleBadgeLabels[badge.id]}
										</span>
									))}
								</span>
							) : null}
							<span
								className={cn(
									"flex min-w-0 items-center gap-0.5 text-ui leading-3.5",
									!effectiveVisible && "line-through",
								)}
							>
								<span className="min-w-0 truncate">{node.name}</span>
								{node.motionParent ? (
									<span
										className="shrink-0 rounded border border-accent/25 bg-accent-surface px-0.5 font-mono text-accent-fg"
										title={`Motion parent: ${node.motionParent.parentNodeId}`}
									>
										rig
									</span>
								) : null}
								{node.transformConstraint ? (
									<span
										className="shrink-0 rounded border border-accent/25 bg-accent-surface px-0.5 font-mono text-accent-fg"
										title={`Constraint source: ${node.transformConstraint.sourceNodeId}`}
									>
										con
									</span>
								) : null}
								{node.propertyRelations?.length ? (
									<span
										className="shrink-0 rounded border border-white/10 bg-white/[0.035] px-0.5 font-mono text-fg-muted"
										title={`${node.propertyRelations.length} property relation(s)`}
									>
										prop
									</span>
								) : null}
							</span>
						</button>
					)}
					<div className="flex items-center gap-0.5">
						<MoveRowButton
							label="Move node up"
							direction="up"
							disabled={!canMoveUp}
							onClick={() => {
								if (!reorderContext) return;
								onMove(reorderContext.layerId, node.id, "up");
							}}
						/>
						<MoveRowButton
							label="Move node down"
							direction="down"
							disabled={!canMoveDown}
							onClick={() => {
								if (!reorderContext) return;
								onMove(reorderContext.layerId, node.id, "down");
							}}
						/>
						<RowActionButton
							label={`${node.visible ? "Hide" : "Show"} node ${node.name}`}
							pressed={node.visible}
							IconComponent={node.visible ? Eye : EyeSlash}
							onClick={() => onToggleVisibility(node)}
						/>
						<RowActionButton
							label={`${node.locked ? "Unlock" : "Lock"} node ${node.name}`}
							pressed={node.locked}
							IconComponent={node.locked ? Lock : LockOpen}
							onClick={() => onToggleLocked(node)}
						/>
						<RowActionButton
							label={
								deletesSelection
									? `Delete ${selectedNodeIds.length} selected nodes`
									: canDelete
										? `Delete node ${node.name}`
										: `Cannot delete protected node ${node.name}`
							}
							IconComponent={Trash}
							disabled={!canDelete}
							danger
							onClick={() => onDeleteNode(row)}
						/>
					</div>
				</div>
			</div>
		</ContextMenu>
	);
}

type ArtboardRowProps = {
	readonly row: LayerPanelArtboardRow;
	readonly editing: EditingTarget | null;
	readonly onToggleExpanded: (id: string) => void;
	readonly onFocusArtboard: (
		row: LayerPanelArtboardRow,
		additive: boolean,
	) => void;
	readonly onBeginRename: (
		kind: EditingTarget["kind"],
		id: string,
		name: string,
	) => void;
	readonly onRenameValueChange: (value: string) => void;
	readonly onCommitRename: (target: EditingTarget) => void;
	readonly onRenameKeyDown: (
		event: KeyboardEvent<HTMLInputElement>,
		target: EditingTarget,
	) => void;
	readonly onDuplicateArtboard: (row: LayerPanelArtboardRow) => void;
	readonly onRemoveArtboard: (row: LayerPanelArtboardRow) => void;
	readonly onMoveArtboard: (
		row: LayerPanelArtboardRow,
		direction: MoveDirection,
	) => void;
	readonly onSetArtboardRole: (
		row: LayerPanelArtboardRow,
		role: ArtboardRole,
	) => void;
};

function ArtboardRow({
	row,
	editing,
	onToggleExpanded,
	onFocusArtboard,
	onBeginRename,
	onRenameValueChange,
	onCommitRename,
	onRenameKeyDown,
	onDuplicateArtboard,
	onRemoveArtboard,
	onMoveArtboard,
	onSetArtboardRole,
}: ArtboardRowProps) {
	const artboardEditing =
		editing?.kind === "artboard" && editing.id === row.artboardId
			? editing
			: null;
	const statusBadges = getArtboardRowStatusBadges(row);
	const roleOption = getArtboardRowRoleOption(row);
	const menuGroups: readonly ContextMenuGroup[] = [
		{
			id: "focus",
			items: [
				{
					id: "focus",
					label: row.current ? "Current artboard" : "Set current",
					icon: Crosshair,
					disabled: row.current,
					onSelect: () => onFocusArtboard(row, false),
				},
			],
		},
		{
			id: "edit",
			items: [
				{
					id: "rename",
					label: "Rename",
					icon: PencilSimple,
					onSelect: () =>
						onBeginRename("artboard", row.artboardId, row.artboard.name),
				},
				{
					id: "duplicate",
					label: "Duplicate",
					icon: Copy,
					onSelect: () => onDuplicateArtboard(row),
				},
			],
		},
		{
			id: "role",
			items: artboardRoleOptions.map((option) => ({
				id: `role-${option.role}`,
				label: `Mark as ${option.label}`,
				icon: Square,
				disabled: option.role === roleOption.role,
				onSelect: () => onSetArtboardRole(row, option.role),
			})),
		},
		{
			id: "order",
			items: [
				{
					id: "move-up",
					label: "Move up",
					icon: ArrowUp,
					disabled: !row.canMoveUp,
					onSelect: () => onMoveArtboard(row, "up"),
				},
				{
					id: "move-down",
					label: "Move down",
					icon: ArrowDown,
					disabled: !row.canMoveDown,
					onSelect: () => onMoveArtboard(row, "down"),
				},
			],
		},
		{
			id: "danger",
			items: [
				{
					id: "remove",
					label: "Remove",
					icon: Trash,
					danger: true,
					disabled: !row.canRemove,
					onSelect: () => onRemoveArtboard(row),
				},
			],
		},
	];

	return (
		<ContextMenu label={`${row.artboard.name} actions`} groups={menuGroups}>
			<div
				className={cn(
					"grid h-6 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-0.5 rounded border px-1 transition",
					row.current
						? "border-accent/65 bg-accent-surface text-accent-fg"
						: row.selected
							? "border-accent/30 bg-accent-surface text-accent-fg"
							: "border-white/10 bg-black/20 text-fg-secondary hover:border-white/18 hover:bg-white/[0.055]",
					!row.visible && "border-dashed opacity-65",
					row.locked &&
						"border-warn/35 shadow-[inset_3px_0_0_var(--color-warn)]",
				)}
			>
				<ExpandButton
					id={row.rowId}
					expanded={row.expanded}
					disabled={!row.hasChildren}
					onToggle={onToggleExpanded}
				/>
				{artboardEditing ? (
					<RenameInput
						target={artboardEditing}
						onChange={onRenameValueChange}
						onCommit={onCommitRename}
						onKeyDown={onRenameKeyDown}
					/>
				) : (
					<button
						type="button"
						className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-1 rounded px-1 py-0.5 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
						title={row.artboard.name}
						onClick={(event) =>
							onFocusArtboard(
								row,
								event.shiftKey || event.metaKey || event.ctrlKey,
							)
						}
						onDoubleClick={() =>
							onBeginRename("artboard", row.artboardId, row.artboard.name)
						}
					>
						<Square
							aria-hidden="true"
							size={10}
							weight={row.current ? "duotone" : "regular"}
							className={cn(
								"text-fg-muted",
								row.current && "text-accent-fg",
								row.locked && "text-warn",
							)}
						/>
						<span className="min-w-0 truncate font-medium text-ui leading-3.5">
							{row.artboard.name}
						</span>
					</button>
				)}
				<div className="flex items-center gap-0.5">
					<span
						className={cn(
							"max-w-14 truncate rounded border px-1 py-0.5 font-medium text-ui leading-3",
							roleOption.role === "scene"
								? "border-white/10 bg-black/15 text-fg-muted"
								: "border-warn/35 bg-warn-surface text-warn-fg",
						)}
						title={roleOption.description}
					>
						{roleOption.shortLabel}
					</span>
					{statusBadges.map((badge) => {
						const IconComponent = artboardStatusIcons[badge.id];
						return (
							<span
								key={badge.id}
								className={cn(
									"grid size-[18px] place-items-center rounded border border-white/6 bg-black/15 text-fg-muted",
									badge.id === "current" &&
										"border-accent/30 bg-accent-surface text-accent-fg",
									badge.id === "locked" && "text-warn",
									badge.id === "selected" && "text-accent-fg",
								)}
								title={badge.label}
							>
								<IconComponent
									aria-hidden="true"
									size={badge.id === "current" ? 8 : 10}
									weight={badge.id === "current" ? "fill" : "regular"}
								/>
							</span>
						);
					})}
					<RowActionButton
						label={`Rename artboard ${row.artboard.name}`}
						IconComponent={PencilSimple}
						onClick={() =>
							onBeginRename("artboard", row.artboardId, row.artboard.name)
						}
					/>
					<span
						className={cn(
							"rounded border border-white/10 px-1 py-0.5 text-ui",
							row.selectedNodeCount > 0 ? "text-accent-fg" : "text-fg-muted",
						)}
						title={`${row.nodeCount} nodes`}
					>
						{row.selectedNodeCount > 0
							? `${row.selectedNodeCount}/${row.nodeCount}`
							: row.nodeCount}
					</span>
					<MoveRowButton
						label="Move artboard up"
						direction="up"
						disabled={!row.canMoveUp}
						onClick={() => onMoveArtboard(row, "up")}
					/>
					<MoveRowButton
						label="Move artboard down"
						direction="down"
						disabled={!row.canMoveDown}
						onClick={() => onMoveArtboard(row, "down")}
					/>
					<RowActionButton
						label={`Duplicate artboard ${row.artboard.name}`}
						IconComponent={Copy}
						onClick={() => onDuplicateArtboard(row)}
					/>
					<RowActionButton
						label={
							row.canRemove
								? `Remove artboard ${row.artboard.name}`
								: "Cannot remove final artboard"
						}
						IconComponent={Trash}
						disabled={!row.canRemove}
						danger
						onClick={() => onRemoveArtboard(row)}
					/>
				</div>
			</div>
		</ContextMenu>
	);
}

const cameraRigIdFromSelection = (
	selection: SceneCameraAuthoringSelection | null,
): string | null => {
	if (!selection) return null;
	if ("cameraRigId" in selection) return selection.cameraRigId ?? null;
	return null;
};

function SceneCameraLayerRows({
	state,
	selection,
	onSelect,
	selectedNodeIds,
	onSelectNode,
}: {
	readonly state: SceneCameraAuthoringState;
	readonly selection: SceneCameraAuthoringSelection | null;
	readonly onSelect: (selection: SceneCameraAuthoringSelection) => void;
	readonly selectedNodeIds: readonly string[];
	readonly onSelectNode: (nodeId: string, additive?: boolean) => void;
}) {
	if (state.cameras.length === 0 && state.controllers.length === 0) return null;
	const selectedCameraRigId = cameraRigIdFromSelection(selection);
	const generalControllers = state.controllers.filter(
		(controller) =>
			!state.cameras.some(
				(camera) =>
					camera.bodyController?.id === controller.node.id ||
					camera.targetController?.id === controller.node.id,
			),
	);
	const selectCamera = (cameraRigId: string): void => {
		onSelect({ kind: "camera-rig", cameraRigId });
	};
	const selectTarget = (cameraRigId: string): void => {
		onSelect({ kind: "camera-target", cameraRigId });
	};
	const selectController = (
		nodeId: string,
		cameraRigId: string | undefined,
		role: "body" | "target" | "free",
	): void => {
		onSelect({
			kind: "motion-controller",
			nodeId,
			...(cameraRigId ? { cameraRigId } : {}),
			role,
		});
	};

	return (
		<section className="mb-1 rounded border border-white/8 bg-black/12">
			<div className="flex h-5 items-center justify-between border-white/8 border-b px-1.5 text-ui">
				<div className="flex min-w-0 items-center gap-1 font-medium text-fg-muted">
					<Camera aria-hidden="true" size={10} />
					<span className="truncate">Cameras & controllers</span>
				</div>
				<span className="font-mono text-fg-subtle">
					{state.cameras.length + generalControllers.length}
				</span>
			</div>
			<div className="space-y-0.5 p-1">
				{state.cameras.map((camera) => {
					const selected = selectedCameraRigId === camera.rig.id;
					const bodyController = camera.bodyController;
					const targetController = camera.targetController;
					const targetLabel =
						camera.targetNode?.name ?? targetController?.name ?? "Target point";
					return (
						<div key={camera.rig.id} className="space-y-0.5">
							<button
								type="button"
								aria-pressed={selected}
								title={camera.rig.name}
								onClick={() => selectCamera(camera.rig.id)}
								className={cn(
									"grid h-6 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1 rounded border px-1.5 text-left text-ui transition",
									selected || camera.active
										? "border-accent/35 bg-accent-surface text-accent-fg"
										: "border-white/6 bg-black/16 text-fg-muted hover:border-white/14 hover:text-fg-secondary",
								)}
							>
								<Camera aria-hidden="true" size={11} />
								<span className="min-w-0 truncate">{camera.rig.name}</span>
								<span className="font-mono text-fg-subtle">
									{camera.active ? "active" : camera.rig.projection.kind}
								</span>
							</button>
							<button
								type="button"
								aria-pressed={
									selection?.kind === "camera-target" &&
									selection.cameraRigId === camera.rig.id
								}
								title={targetLabel}
								onClick={() => selectTarget(camera.rig.id)}
								className={cn(
									"ml-4 grid h-5 w-[calc(100%-1rem)] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1 rounded border px-1.5 text-left text-ui transition",
									selection?.kind === "camera-target" &&
										selection.cameraRigId === camera.rig.id
										? "border-accent/35 bg-accent-surface text-accent-fg"
										: "border-white/6 bg-black/12 text-fg-subtle hover:border-white/14 hover:text-fg-secondary",
								)}
							>
								<Crosshair aria-hidden="true" size={10} />
								<span className="min-w-0 truncate">{targetLabel}</span>
								<span className="font-mono text-fg-subtle">target</span>
							</button>
							{bodyController ? (
								<button
									type="button"
									aria-pressed={
										selection?.kind === "motion-controller" &&
										selection.nodeId === bodyController.id
									}
									title={bodyController.name}
									onClick={() =>
										selectController(bodyController.id, camera.rig.id, "body")
									}
									className={cn(
										"ml-4 grid h-5 w-[calc(100%-1rem)] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1 rounded border px-1.5 text-left text-ui transition",
										selection?.kind === "motion-controller" &&
											selection.nodeId === bodyController.id
											? "border-accent/35 bg-accent-surface text-accent-fg"
											: "border-white/6 bg-black/12 text-fg-subtle hover:border-white/14 hover:text-fg-secondary",
									)}
								>
									<Circle aria-hidden="true" size={8} />
									<span className="min-w-0 truncate">
										{bodyController.name}
									</span>
									<span className="font-mono text-fg-subtle">body</span>
								</button>
							) : null}
							{targetController ? (
								<button
									type="button"
									aria-pressed={
										selection?.kind === "motion-controller" &&
										selection.nodeId === targetController.id
									}
									title={targetController.name}
									onClick={() =>
										selectController(
											targetController.id,
											camera.rig.id,
											"target",
										)
									}
									className={cn(
										"ml-4 grid h-5 w-[calc(100%-1rem)] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1 rounded border px-1.5 text-left text-ui transition",
										selection?.kind === "motion-controller" &&
											selection.nodeId === targetController.id
											? "border-accent/35 bg-accent-surface text-accent-fg"
											: "border-white/6 bg-black/12 text-fg-subtle hover:border-white/14 hover:text-fg-secondary",
									)}
								>
									<Circle aria-hidden="true" size={8} />
									<span className="min-w-0 truncate">
										{targetController.name}
									</span>
									<span className="font-mono text-fg-subtle">null</span>
								</button>
							) : null}
						</div>
					);
				})}
				{generalControllers.map((controller) => (
					<button
						key={controller.node.id}
						type="button"
						aria-pressed={selectedNodeIds.includes(controller.node.id)}
						title={controller.node.name}
						onClick={(event) =>
							onSelectNode(
								controller.node.id,
								event.metaKey || event.ctrlKey || event.shiftKey,
							)
						}
						className={cn(
							"grid h-5 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1 rounded border px-1.5 text-left text-ui transition",
							selectedNodeIds.includes(controller.node.id)
								? "border-accent/35 bg-accent-surface text-accent-fg"
								: "border-white/6 bg-black/12 text-fg-subtle hover:border-white/14 hover:text-fg-secondary",
						)}
					>
						<Circle aria-hidden="true" size={8} />
						<span className="min-w-0 truncate">{controller.node.name}</span>
						<span className="font-mono text-fg-subtle">null</span>
					</button>
				))}
			</div>
		</section>
	);
}

export function LayersPanel() {
	const layersResize = usePanelResize("left");
	const document = useSceneStore((state) => state.document);
	const applySceneCommand = useSceneStore((state) => state.apply);
	const applyMotionCommand = useMotionStore((state) => state.apply);
	const applyGrammarCommand = useMotionGrammarStore((state) => state.apply);
	const grammarBindings = useMotionGrammarStore(
		(state) => state.document.bindings,
	);
	const selectedNodeIds = useSelectionStore((state) => state.nodeIds);
	const primaryNodeId = useSelectionStore((state) => state.primary);
	const sceneCameraSelection = useSelectionStore((state) => state.sceneCamera);
	const selectNode = useSelectionStore((state) => state.selectNode);
	const selectSceneCamera = useSelectionStore(
		(state) => state.selectSceneCamera,
	);
	const setSelection = useSelectionStore((state) => state.setSelection);
	const renameRequest = useSelectedObjectRenameRequestStore(
		(state) => state.request,
	);
	const consumeRenameRequest = useSelectedObjectRenameRequestStore(
		(state) => state.consumeRenameRequest,
	);
	const [panelMode, setPanelMode] = useState<PanelMode>("layers");
	const clipboardPayload = useLayerWorkflowClipboardStore(
		(state) => state.payload,
	);
	const setClipboardPayload = useLayerWorkflowClipboardStore(
		(state) => state.setPayload,
	);
	const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const [editing, setEditing] = useState<EditingTarget | null>(null);
	const [workflowReport, setWorkflowReport] =
		useState<WorkflowActionReport | null>(null);
	const [searchQuery, setSearchQuery] = useState("");
	const [currentArtboardOnly, setCurrentArtboardOnly] = useState(false);
	const [focusSelectedOnly, setFocusSelectedOnly] = useState(false);
	const [assetViewMode, setAssetViewMode] = useState<AssetViewMode>("grid");
	const cancelRenameRef = useRef(false);
	const imageImportInputRef = useRef<HTMLInputElement | null>(null);
	// Range-select pivot for Shift+Click. Panel-local and ephemeral (render-order
	// UI state with no domain meaning), so it lives in a ref — not the selection
	// store (that would leak a widget concern into a feature) and not useState
	// (moving the pivot must not re-render; it is read only at the next click).
	const anchorNodeIdRef = useRef<string | null>(null);
	const revealFilteredRows = searchQuery.trim().length > 0 || focusSelectedOnly;
	const basePanelRows = useMemo(
		() =>
			flattenArtboardLayerPanelRows(document, {
				collapsedIds: revealFilteredRows ? [] : collapsedIds,
				selectedNodeIds,
				primaryNodeId,
			}),
		[
			collapsedIds,
			document,
			primaryNodeId,
			revealFilteredRows,
			selectedNodeIds,
		],
	);
	const panelRowResult = useMemo(
		() =>
			filterArtboardLayerPanelRows(basePanelRows, {
				searchQuery,
				currentArtboardOnly,
				focusSelected: focusSelectedOnly,
				selectedNodeIds,
			}),
		[
			basePanelRows,
			currentArtboardOnly,
			focusSelectedOnly,
			searchQuery,
			selectedNodeIds,
		],
	);
	const panelRows = panelRowResult.rows;
	const sceneCameraState = useMemo(
		() => readSceneCameraAuthoringState(document),
		[document],
	);
	// Pointer drag-and-drop for reorder/reparent. Disabled while the panel shows a
	// filtered view (search / focus-selected): filtered rows are a screen sweep,
	// not tree order, so a structural index would resolve ambiguously.
	const layerDrag = useLayerDrag({
		rows: panelRows,
		layers: document.layers,
		selectedNodeIds,
		enabled: !revealFilteredRows,
		applyCommand: applySceneCommand,
		onGrabUnselected: (nodeId) => {
			selectNode(nodeId, false);
			anchorNodeIdRef.current = nodeId;
		},
	});
	const dropIndicatorFor = (
		row: ArtboardLayerPanelRow,
	): LayerDropIndicator | null =>
		layerDrag.indicator?.anchorRowId === row.rowId ? layerDrag.indicator : null;
	// Click-to-select with Figma/macOS modifier semantics. A plain const (not a
	// memoized callback) so it always closes over the LIVE post-filter `panelRows`;
	// a stale closure would resolve a range against the wrong rows. Shift extends a
	// range from a fixed pivot, Cmd/Ctrl toggles one node. The pivot only moves on
	// plain-click and toggle — never on a successful range extend — which is the
	// entire no-snowball guarantee for consecutive Shift+clicks. `primary` is passed
	// explicitly as the clicked target so an upward Shift+click focuses the clicked
	// node, not the bottom-most row of the resulting span.
	const handleSelectNode = (nodeId: string, intent: NodeSelectIntent): void => {
		// A completed drag fires a trailing click on the grabbed row; swallow it so
		// the drag does not also mutate selection.
		if (layerDrag.consumeDragClick()) return;
		if (intent.shift) {
			// Seed the pivot from the live primary on first use, so an opening
			// Shift+click EXTENDS the existing selection instead of destroying it
			// (the editor always boots with a selection). Pinning the resolved
			// anchor is what keeps the pivot fixed: `?? primaryNodeId` WITHOUT the
			// write-back would snowball, since primary moves to the target each
			// click. A stale/absent pivot makes the range null → single-select.
			const anchor = anchorNodeIdRef.current ?? primaryNodeId;
			const range = rangeNodeIds(panelRows, anchor, nodeId);
			if (range) {
				anchorNodeIdRef.current = anchor;
				setSelection(range, nodeId);
				return;
			}
			selectNode(nodeId, false);
			anchorNodeIdRef.current = nodeId;
			return;
		}
		if (intent.toggle) {
			selectNode(nodeId, true);
			anchorNodeIdRef.current = nodeId;
			return;
		}
		selectNode(nodeId, false);
		anchorNodeIdRef.current = nodeId;
	};
	const layerById = useMemo(
		() => new Map(document.layers.map((layer) => [layer.id, layer])),
		[document.layers],
	);
	const workflowPlans = useMemo(
		() =>
			planLayerWorkflowActions({
				document,
				selectedNodeIds,
				primaryNodeId,
				clipboardPayload,
				grammarBindings,
			}),
		[
			clipboardPayload,
			document,
			grammarBindings,
			primaryNodeId,
			selectedNodeIds,
		],
	);
	const assetLibrary = useMemo(() => readAssetLibrary(document), [document]);
	const createComponentAssetAction = useMemo(
		() =>
			planCreateComponentAsset(
				document,
				selectedNodeIds,
				primaryNodeId,
				grammarBindings,
			),
		[document, grammarBindings, primaryNodeId, selectedNodeIds],
	);
	const createStyleAssetAction = useMemo(
		() => planCreateStyleAsset(document, selectedNodeIds, primaryNodeId),
		[document, primaryNodeId, selectedNodeIds],
	);
	const styleApplyReason = useMemo(
		() =>
			selectedNodeIds.some((nodeId) => findNode(document, nodeId))
				? null
				: "Select nodes to style",
		[document, selectedNodeIds],
	);
	const selectionCleanup = useMemo(
		() =>
			cleanupLayerWorkflowSelection(document, {
				selectedNodeIds,
				primaryNodeId,
			}),
		[document, primaryNodeId, selectedNodeIds],
	);

	useEffect(() => {
		if (
			selectionCleanup.removedNodeIds.length === 0 &&
			selectionCleanup.primaryNodeId === primaryNodeId
		) {
			return;
		}
		setSelection(selectionCleanup.nodeIds, selectionCleanup.primaryNodeId);
	}, [primaryNodeId, selectionCleanup, setSelection]);

	useEffect(() => {
		if (!renameRequest) return;
		const node = findNode(document, renameRequest.nodeId);
		consumeRenameRequest(renameRequest.requestId);
		if (!node) return;

		const expandedRows = flattenArtboardLayerPanelRows(document, {
			collapsedIds: [],
			selectedNodeIds,
			primaryNodeId,
		});
		const row = expandedRows.find(
			(item): item is LayerPanelNodeRow =>
				item.kind === "node" && item.nodeId === renameRequest.nodeId,
		);

		setPanelMode("layers");
		setSearchQuery("");
		setCurrentArtboardOnly(false);
		setFocusSelectedOnly(false);
		setSelection([node.id], node.id);
		if (row) {
			setCollapsedIds((current) => {
				const next = new Set(current);
				if (row.artboardId) {
					next.delete(artboardRowId(row.artboardId));
					next.delete(artboardLayerRowId(row.artboardId, row.layerId));
				} else {
					next.delete(row.layerId);
				}
				for (const parentId of row.parentIds) next.delete(parentId);
				return next;
			});
		}
		cancelRenameRef.current = false;
		setEditing({
			kind: "node",
			id: node.id,
			value: node.name,
			originalValue: node.name,
		});
	}, [
		consumeRenameRequest,
		document,
		primaryNodeId,
		renameRequest,
		selectedNodeIds,
		setSelection,
	]);

	// Rename the primary selected node from anywhere: F2 (free) or Mod+R. Reads
	// the latest selection/document via getState so it subscribes once. Mod+R must
	// preventDefault or the browser reloads. Skipped while typing in a field.
	useEffect(() => {
		const onKeyDown = (event: globalThis.KeyboardEvent): void => {
			// The shortcut-help overlay is modal: suppress rename keys while open.
			if (useEditorChromeStore.getState().shortcutHelpOpen) return;
			const target = event.target;
			if (
				target instanceof HTMLElement &&
				(target.isContentEditable ||
					target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.tagName === "SELECT")
			) {
				return;
			}
			const isRenameKey =
				event.key === "F2" ||
				((event.metaKey || event.ctrlKey) &&
					!event.altKey &&
					!event.shiftKey &&
					event.key.toLowerCase() === "r");
			if (!isRenameKey) return;
			const primary = useSelectionStore.getState().primary;
			if (!primary) return;
			const node = findNode(useSceneStore.getState().document, primary);
			if (!node) return;
			event.preventDefault();
			useSelectedObjectRenameRequestStore.getState().requestRename({
				kind: "start-node-rename",
				nodeId: node.id,
				currentName: node.name,
				commit: {
					kind: "scene.rename-node",
					nodeId: node.id,
					valueParameter: "name",
				},
			});
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	const toggleExpanded = (id: string): void => {
		setCollapsedIds((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const selectionSnapshot = {
		nodeIds: selectedNodeIds,
		primaryNodeId,
	} as const;
	const applySelectionPlan = (plan: LayerPanelSelectionPlan | null): void => {
		if (!plan) return;
		setSelection(plan.nodeIds, plan.primaryNodeId);
	};

	const focusArtboard = (
		row: LayerPanelArtboardRow,
		additive: boolean,
	): void => {
		const plan = planFocusArtboardRowAction(row, selectionSnapshot, {
			additive,
		});
		applySceneCommand(plan.command);
		applySelectionPlan(plan.selection);
	};

	const applySelectedObjectSceneCommands = (
		commands: readonly SceneCommand[],
		transaction: SelectedObjectUndoPlan,
	): void => {
		const sceneStore = useSceneStore.getState();
		if (commands.length === 0) return;
		if (commands.length === 1) {
			for (const command of commands) sceneStore.apply(command);
			return;
		}
		sceneStore.beginTransaction(
			selectedObjectWorkflowTransactionCoalesceKey(transaction),
			transaction.label,
		);
		for (const command of commands) sceneStore.apply(command);
		sceneStore.commit();
	};

	const duplicateArtboard = (row: LayerPanelArtboardRow): void => {
		const plan = planDuplicateArtboardRowCommand(document, row, {
			nodeIds: selectedNodeIds,
			primaryNodeId,
		});
		if (!plan) return;
		applySceneCommand(plan.command);
		setSelection(plan.selectNodeIds, plan.primaryNodeId);
	};

	const removeArtboard = (row: LayerPanelArtboardRow): void => {
		const command = createRemoveArtboardRowCommand(document, row);
		if (!command) return;
		applySceneCommand(command);
	};

	const moveArtboard = (
		row: LayerPanelArtboardRow,
		direction: MoveDirection,
	): void => {
		const command = createMoveArtboardRowCommand(document, row, direction);
		if (!command) return;
		applySceneCommand(command);
	};

	const setArtboardRole = (
		row: LayerPanelArtboardRow,
		role: ArtboardRole,
	): void => {
		const command = createSetArtboardRoleRowCommand(document, row, role);
		if (!command) return;
		applySceneCommand(command);
	};

	const placeImageAsset = (assetId: string): void => {
		const plan = planPlaceImageAsset(document, assetId);
		if (!plan) return;
		applySceneCommand(plan.command);
		setSelection([plan.selectNodeId], plan.selectNodeId);
	};

	const placeComponentAsset = (symbolId: string): void => {
		const plan = planPlaceComponentAsset(document, symbolId, grammarBindings);
		if (!plan) return;
		commitLinkedInstancePlan(
			plan.linkedInstance,
			{
				scene: applySceneCommand,
				motion: applyMotionCommand,
				grammar: applyGrammarCommand,
			},
			createId("asset-instance"),
		);
		setSelection([plan.selectNodeId], plan.selectNodeId);
	};

	const runAssetCommandPlan = (
		plan: AssetLibraryCommandPlan,
		title: string,
		detail?: string,
	): void => {
		const commands = plan.commands ?? (plan.command ? [plan.command] : []);
		const needsCompound =
			commands.length > 1 ||
			Boolean(plan.linkedInstanceCompanions) ||
			Boolean(plan.removeMotionNodeIds?.length) ||
			Boolean(plan.removeGrammarTargetNodeIds?.length);
		const compoundId = needsCompound ? createId("asset-action") : undefined;
		const before = useSceneStore.getState().document;
		const beforeMotion = useMotionStore.getState().document;
		const beforeGrammar = useMotionGrammarStore.getState().document;
		if (commands.length > 1 && compoundId) {
			const sceneStore = useSceneStore.getState();
			sceneStore.beginTransaction(
				`asset-action:${compoundId}`,
				title,
				compoundId,
			);
			for (const command of commands) sceneStore.apply(command);
			sceneStore.commit();
		} else {
			for (const command of commands) {
				applySceneCommand(compoundId ? { ...command, compoundId } : command);
			}
		}
		if (plan.linkedInstanceCompanions) {
			commitLinkedInstanceCompanions(
				plan.linkedInstanceCompanions,
				{ motion: applyMotionCommand, grammar: applyGrammarCommand },
				compoundId ?? createId("asset-action"),
			);
		}
		if (plan.removeMotionNodeIds?.length) {
			const deletedNodeIds = new Set(plan.removeMotionNodeIds);
			const tracks = useMotionStore
				.getState()
				.document.tracks.filter((track) =>
					deletedNodeIds.has(track.target.nodeId),
				);
			for (const track of tracks) {
				const command = removeTrack(track.id);
				applyMotionCommand(compoundId ? { ...command, compoundId } : command);
			}
		}
		if (plan.removeGrammarTargetNodeIds?.length) {
			const deletedNodeIds = new Set(plan.removeGrammarTargetNodeIds);
			const bindings = useMotionGrammarStore
				.getState()
				.document.bindings.filter((binding) =>
					binding.targetIds.some((nodeId) => deletedNodeIds.has(nodeId)),
				);
			for (const binding of bindings) {
				const command = removeGrammarBinding(binding.id);
				applyGrammarCommand(compoundId ? { ...command, compoundId } : command);
			}
		}
		const changed =
			useSceneStore.getState().document !== before ||
			useMotionStore.getState().document !== beforeMotion ||
			useMotionGrammarStore.getState().document !== beforeGrammar;
		if (plan.selectNodeIds) {
			setSelection(plan.selectNodeIds, plan.primaryNodeId);
		}
		setWorkflowReport({
			status: changed ? "success" : "warning",
			title: changed ? title : "Asset action had no effect",
			...(detail ? { detail } : {}),
			issues: [],
		});
	};

	const runAssetAvailability = (
		action: AssetLibraryActionAvailability,
		title: string,
	): void => {
		if (!action.enabled) {
			setWorkflowReport({
				status: "warning",
				title: `${title} unavailable`,
				detail: action.reason,
				issues: [],
			});
			return;
		}
		runAssetCommandPlan(action.plan, `${title} complete`);
	};

	const chooseImageFile = (): void => {
		imageImportInputRef.current?.click();
	};

	const importImageAsset = async (file: File): Promise<void> => {
		if (!isRasterImagePlacementFile(file.name, file.type)) {
			setWorkflowReport({
				status: "error",
				title: "Image import unsupported",
				detail: "Use PNG, JPEG, or WebP.",
				issues: [],
			});
			return;
		}
		try {
			const plan = await createLocalImageFilePlacementPlan(
				useSceneStore.getState().document,
				file,
			);
			if (!plan) {
				setWorkflowReport({
					status: "error",
					title: "Image import unavailable",
					detail: "No editable scene layer is available.",
					issues: [],
				});
				return;
			}
			runAssetCommandPlan(
				{
					command: plan.command,
					selectNodeIds: [plan.nodeId],
					primaryNodeId: plan.nodeId,
				},
				"Image imported",
				plan.sourceName,
			);
			setPanelMode("assets");
		} catch (error) {
			setWorkflowReport({
				status: "error",
				title: "Image import failed",
				detail:
					error instanceof Error
						? error.message
						: "The selected image could not be imported.",
				issues: [],
			});
		}
	};

	const applyStyleAsset = (presetId: string): void => {
		runAssetAvailability(
			planApplyStyleAsset(document, presetId, selectedNodeIds, primaryNodeId),
			"Apply style",
		);
	};

	const deleteImageAsset = (assetId: string): void => {
		runAssetAvailability(
			planDeleteImageAsset(document, assetId),
			"Delete asset",
		);
	};

	const renameSceneAsset = (assetId: string, name: string): void => {
		const asset = assetLibrary.images.find((entry) => entry.id === assetId);
		if (!asset || name.trim() === asset.name) return;
		runAssetAvailability(
			planRenameSceneAsset(document, assetId, name),
			"Rename asset",
		);
	};

	const deleteComponentAsset = (symbolId: string): void => {
		runAssetAvailability(
			planDeleteComponentAsset(document, symbolId),
			"Delete stored object",
		);
	};

	const deleteStyleAsset = (presetId: string): void => {
		runAssetAvailability(
			planDeleteStyleAsset(document, presetId),
			"Delete style",
		);
	};

	const locateAssetNode = (nodeId: string): void => {
		setSelection([nodeId], nodeId);
		setPanelMode("layers");
		setWorkflowReport({
			status: "success",
			title: "Asset usage selected",
			issues: [],
		});
	};

	const beginRename = (
		kind: EditingTarget["kind"],
		id: string,
		name: string,
	): void => {
		cancelRenameRef.current = false;
		setEditing({ kind, id, value: name, originalValue: name });
	};

	const updateRenameValue = (value: string): void => {
		setEditing((current) => (current ? { ...current, value } : current));
	};

	const commitRename = (target: EditingTarget): void => {
		if (cancelRenameRef.current) {
			cancelRenameRef.current = false;
			setEditing(null);
			return;
		}

		const command = createLayerPanelRenameCommand(basePanelRows, target);
		if (command) applySceneCommand(command);
		setEditing(null);
	};

	const handleRenameKeyDown = (
		event: KeyboardEvent<HTMLInputElement>,
		_target: EditingTarget,
	): void => {
		if (event.key === "Enter") {
			event.preventDefault();
			event.currentTarget.blur();
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			cancelRenameRef.current = true;
			event.currentTarget.blur();
		}
	};

	const toggleLayerVisibility = (layer: SceneLayer): void => {
		const plan = planToggleLayerVisibilityRowAction(layer, selectionSnapshot);
		applySceneCommand(plan.command);
		applySelectionPlan(plan.selection);
	};

	const toggleLayerLocked = (layer: SceneLayer): void => {
		applySceneCommand(createToggleLayerLockedRowCommand(layer));
	};

	const toggleNodeVisibility = (node: VectorNode): void => {
		const plan = planToggleNodeVisibilityRowAction(
			document,
			node,
			selectionSnapshot,
		);
		if (!plan) return;
		applySelectedObjectSceneCommands(plan.commands, plan.transaction);
		applySelectionPlan(plan.hiddenSelection);
	};

	const toggleNodeLocked = (node: VectorNode): void => {
		const plan = planToggleNodeLockedRowAction(document, node);
		if (!plan) return;
		applySelectedObjectSceneCommands(plan.commands, plan.transaction);
	};

	const moveLayer = (layerId: string, direction: MoveDirection): void => {
		const command = createMoveLayerRowCommand(
			document.layers,
			layerId,
			direction,
		);
		if (!command) return;
		applySceneCommand(command);
	};

	const moveNode = (
		layerId: string,
		nodeId: string,
		direction: MoveDirection,
	): void => {
		const command = createMoveNodeRowCommand(
			document.layers,
			layerId,
			nodeId,
			direction,
		);
		if (!command) return;
		applySceneCommand(command);
	};

	const useNodeAsMask = (row: LayerPanelNodeRow): void => {
		const command = planUseRowAsMaskAction(row, selectionSnapshot);
		if (!command) return;
		applySceneCommand(command);
	};

	const releaseNodeMask = (row: LayerPanelNodeRow): void => {
		applySceneCommand(planReleaseRowMaskAction(row));
	};

	const runWorkflowAction = (
		label: string,
		plan: LayerWorkflowActionPlan,
	): void => {
		if (!plan.enabled) {
			setWorkflowReport({
				status: issueTone(plan.issues),
				title: `${label} unavailable`,
				issues: plan.issues,
			});
			return;
		}

		if (plan.id === "copy") {
			setClipboardPayload(plan.payload);
			setWorkflowReport({
				status: issueTone(plan.issues),
				title: "Clipboard updated",
				detail: successDetail(plan),
				issues: plan.issues,
			});
			return;
		}

		if ("linkedInstance" in plan && plan.linkedInstance) {
			commitLinkedInstancePlan(
				plan.linkedInstance,
				{
					scene: applySceneCommand,
					motion: applyMotionCommand,
					grammar: applyGrammarCommand,
				},
				createId("instance"),
			);
		} else {
			applySceneCommand(plan.command);
		}
		setSelection(plan.selectNodeIds);
		setWorkflowReport({
			status: issueTone(plan.issues),
			title: `${label} complete`,
			detail: successDetail(plan),
			issues: plan.issues,
		});
	};

	const deleteNode = (row: LayerPanelNodeRow): void => {
		if (row.selected && selectedNodeIds.length > 1) {
			runWorkflowAction("Delete", workflowPlans.delete);
			return;
		}
		const plan = planDeleteNodeRowAction(document, row, selectionSnapshot);
		if (!plan) return;
		applySceneCommand(plan.command);
		applySelectionPlan(plan.selection);
	};

	const nodeReorderContext = (
		row: LayerPanelNodeRow,
	):
		| {
				readonly layerId: string;
				readonly siblings: readonly VectorNode[];
		  }
		| undefined => {
		if (row.parentIds.length > 0) return undefined;
		const layer = layerById.get(row.layerId);
		if (!layer) return undefined;
		return { layerId: layer.id, siblings: layer.nodes };
	};

	const renderPanelRow = (row: ArtboardLayerPanelRow) => {
		if (row.kind === "artboard") {
			return (
				<ArtboardRow
					key={row.rowId}
					row={row}
					editing={editing}
					onToggleExpanded={toggleExpanded}
					onFocusArtboard={focusArtboard}
					onBeginRename={beginRename}
					onRenameValueChange={updateRenameValue}
					onCommitRename={commitRename}
					onRenameKeyDown={handleRenameKeyDown}
					onDuplicateArtboard={duplicateArtboard}
					onRemoveArtboard={removeArtboard}
					onMoveArtboard={moveArtboard}
					onSetArtboardRole={setArtboardRole}
				/>
			);
		}

		if (row.kind === "layer") {
			return (
				<LayerRow
					key={row.rowId}
					row={row}
					editing={editing}
					onToggleExpanded={toggleExpanded}
					onBeginRename={beginRename}
					onRenameValueChange={updateRenameValue}
					onCommitRename={commitRename}
					onRenameKeyDown={handleRenameKeyDown}
					canMoveUp={
						layerMoveTargetIndex(document.layers, row.layerId, "up") !== null
					}
					canMoveDown={
						layerMoveTargetIndex(document.layers, row.layerId, "down") !== null
					}
					onMove={moveLayer}
					onToggleVisibility={toggleLayerVisibility}
					onToggleLocked={toggleLayerLocked}
					dragProps={layerDrag.rowDragProps(row)}
					dropIndicator={dropIndicatorFor(row)}
				/>
			);
		}

		return (
			<NodeRow
				key={row.rowId}
				row={row}
				editing={editing}
				onToggleExpanded={toggleExpanded}
				onSelectNode={handleSelectNode}
				onBeginRename={beginRename}
				onRenameValueChange={updateRenameValue}
				onCommitRename={commitRename}
				onRenameKeyDown={handleRenameKeyDown}
				reorderContext={nodeReorderContext(row)}
				onMove={moveNode}
				onToggleVisibility={toggleNodeVisibility}
				onToggleLocked={toggleNodeLocked}
				onDeleteNode={deleteNode}
				selectedNodeIds={selectedNodeIds}
				onUseAsMask={useNodeAsMask}
				onReleaseMask={releaseNodeMask}
				dragProps={layerDrag.rowDragProps(row)}
				dropIndicator={dropIndicatorFor(row)}
			/>
		);
	};

	const scopedRowCount = Math.max(panelRowResult.scopedRowCount, 1);
	const rowCountLabel =
		panelRowResult.visibleRowCount === panelRowResult.scopedRowCount
			? String(panelRowResult.visibleRowCount)
			: `${panelRowResult.visibleRowCount}/${scopedRowCount}`;
	const rowCountTitle = `${panelRowResult.visibleRowCount} visible rows of ${panelRowResult.scopedRowCount} in scope. ${panelRowResult.totalRowCount} total rows.`;

	return (
		<aside className="layers-panel relative flex min-w-0 flex-col overflow-hidden rounded-md border border-white/10 bg-surface-raised/88 shadow-2xl shadow-black/35 backdrop-blur-xl">
			<input
				ref={imageImportInputRef}
				type="file"
				accept="image/png,image/jpeg,image/webp"
				className="sr-only"
				tabIndex={-1}
				onChange={(event) => {
					const file = event.currentTarget.files?.[0];
					event.currentTarget.value = "";
					if (file) void importImageAsset(file);
				}}
			/>
			<div className="flex h-6 items-center justify-between border-white/10 border-b px-1.5">
				<div className="flex items-center gap-0.5 text-ui">
					<button
						type="button"
						aria-pressed={panelMode === "layers"}
						className={cn(
							"flex h-5 items-center gap-1 rounded border px-1.5 text-ui transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
							panelMode === "layers"
								? "border-accent/45 bg-accent-surface text-accent-fg"
								: "border-white/8 bg-black/18 text-fg-muted hover:border-white/18 hover:text-fg-secondary",
						)}
						onClick={() => setPanelMode("layers")}
					>
						<Rows aria-hidden="true" size={10} />
						Layers
					</button>
					<button
						type="button"
						aria-pressed={panelMode === "assets"}
						className={cn(
							"flex h-5 items-center gap-1 rounded border px-1.5 text-ui transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
							panelMode === "assets"
								? "border-accent/45 bg-accent-surface text-accent-fg"
								: "border-white/8 bg-black/18 text-fg-muted hover:border-white/18 hover:text-fg-secondary",
						)}
						onClick={() => setPanelMode("assets")}
					>
						<Shapes aria-hidden="true" size={10} />
						Assets
					</button>
				</div>
				<div className="flex items-center gap-0.5">
					{panelMode === "layers" ? (
						<>
							<button
								type="button"
								aria-label="Add layer"
								title="Add layer"
								className="grid size-[18px] place-items-center rounded border border-white/10 bg-black/18 text-fg-muted transition hover:border-accent/45 hover:text-accent-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
								onClick={() => {
									const node = createDefaultLayerNode();
									applySceneCommand(
										createAppendNodeCommand(node, { label: "Add layer" }),
									);
									setSelection([node.id], node.id);
								}}
							>
								<Plus aria-hidden="true" size={10} />
							</button>
							{workflowActionButtons.map(({ id, label, IconComponent }) => (
								<WorkflowButton
									key={id}
									label={label}
									IconComponent={IconComponent}
									plan={workflowPlans[id]}
									onClick={() => runWorkflowAction(label, workflowPlans[id])}
								/>
							))}
						</>
					) : null}
					<span className="ml-0.5 rounded border border-white/10 px-1 py-0.5 text-fg-muted text-ui">
						{panelMode === "layers"
							? document.layers.length
							: assetLibrary.totalCount}
					</span>
				</div>
			</div>
			{panelMode === "layers" ? (
				<>
					<div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 border-white/10 border-b px-1 py-1">
						<label className="relative min-w-0">
							<MagnifyingGlass
								aria-hidden="true"
								size={10}
								className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-1.5 text-fg-muted"
							/>
							<input
								type="search"
								value={searchQuery}
								placeholder="Search"
								aria-label="Search layers"
								className="h-5 w-full rounded border border-white/8 bg-black/22 pr-5 pl-5 text-fg text-ui outline-none transition placeholder:text-fg-subtle focus:border-accent/55"
								onChange={(event) => setSearchQuery(event.currentTarget.value)}
							/>
							{searchQuery.length > 0 ? (
								<button
									type="button"
									aria-label="Clear layer search"
									title="Clear search"
									className="-translate-y-1/2 absolute top-1/2 right-1 grid size-3.5 place-items-center rounded text-fg-muted hover:bg-white/[0.08] hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
									onClick={() => setSearchQuery("")}
								>
									<X aria-hidden="true" size={9} />
								</button>
							) : null}
						</label>
						<div className="flex items-center gap-0.5">
							<PanelToggleButton
								label="Current artboard only"
								pressed={currentArtboardOnly}
								IconComponent={Square}
								onClick={() => setCurrentArtboardOnly((current) => !current)}
							/>
							<PanelToggleButton
								label={`Focus selected (${selectedNodeIds.length})`}
								pressed={focusSelectedOnly}
								IconComponent={Crosshair}
								onClick={() => setFocusSelectedOnly((current) => !current)}
							/>
							<span
								className="min-w-[26px] rounded border border-white/10 px-1 py-0.5 text-center text-fg-muted text-ui"
								title={rowCountTitle}
							>
								{rowCountLabel}
							</span>
						</div>
					</div>
					{workflowReport ? (
						<WorkflowReport
							report={workflowReport}
							onDismiss={() => setWorkflowReport(null)}
						/>
					) : null}
					<div className="layers-scroll-region chrome-scrollbar-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden p-1">
						<SceneCameraLayerRows
							state={sceneCameraState}
							selection={sceneCameraSelection}
							onSelect={selectSceneCamera}
							selectedNodeIds={selectedNodeIds}
							onSelectNode={selectNode}
						/>
						{panelRows.length > 0 ? (
							panelRows.map(renderPanelRow)
						) : (
							<div className="rounded border border-white/8 bg-black/18 px-2 py-2 text-center text-fg-muted text-ui">
								{emptyStateLabel(panelRowResult.emptyState)}
							</div>
						)}
					</div>
				</>
			) : (
				<>
					{workflowReport ? (
						<WorkflowReport
							report={workflowReport}
							onDismiss={() => setWorkflowReport(null)}
						/>
					) : null}
					<div className="layers-scroll-region chrome-scrollbar-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-1">
						<AssetLibraryView
							library={assetLibrary}
							viewMode={assetViewMode}
							createComponentAction={createComponentAssetAction}
							createStyleAction={createStyleAssetAction}
							styleApplyReason={styleApplyReason}
							onViewModeChange={setAssetViewMode}
							onChooseImageFile={chooseImageFile}
							onCreateComponent={() =>
								runAssetAvailability(createComponentAssetAction, "Save object")
							}
							onCreateStyle={() =>
								runAssetAvailability(createStyleAssetAction, "Save style")
							}
							onPlaceImage={placeImageAsset}
							onPlaceComponent={placeComponentAsset}
							onApplyStyle={applyStyleAsset}
							onDeleteImage={deleteImageAsset}
							onRenameAsset={renameSceneAsset}
							onDeleteComponent={deleteComponentAsset}
							onDeleteStyle={deleteStyleAsset}
							onLocateNode={locateAssetNode}
						/>
					</div>
				</>
			)}
			<PanelResizeHandle panelName="Layers" {...layersResize} />
		</aside>
	);
}
