import { Popover } from "@base-ui/react/popover";
import { CaretUp } from "@phosphor-icons/react";
import { useState } from "react";
import { useColorPickToolStore } from "@/features/color-pick/model/tool-state";
import { useDrawStore } from "@/features/draw/model/draw-store";
import type { ShapeKind } from "@/features/draw/model/shape";
import {
	SHAPE_TOOL_VARIANTS,
	shapeToolVariant,
} from "@/features/draw/model/shape-variants";
import { useToolSelectionStore } from "@/features/tool-selection/model/store";
import {
	type EditorTool,
	getEditorTool,
	type ToolId,
} from "@/features/tool-selection/model/tools";
import { shortcutLabel } from "@/shared/actions";
import { cn } from "@/shared/lib/cn";
import { Tooltip, TooltipProvider } from "@/shared/ui/Tooltip";
import {
	TOOL_RAIL_TOOL_IDS,
	type ToolActivation,
	toolReachability,
} from "../model/tool-reachability";

const activationMatches = (
	activation: ToolActivation,
	activeTool: string,
	shapeKind: string,
): boolean => {
	if (activation.shapeKind) {
		return (
			activeTool === activation.toolId && shapeKind === activation.shapeKind
		);
	}
	return activeTool === activation.toolId;
};

const toolTooltipLabel = (tool: EditorTool): string => {
	const reachability = toolReachability(tool.id);
	const shortcut = reachability.shortcut
		? ` (${shortcutLabel(reachability.shortcut)})`
		: "";
	if (reachability.kind === "unavailable") {
		return `${tool.label}${shortcut}. ${reachability.reason}`;
	}
	return `${tool.label}${shortcut}`;
};

/** Shared chrome so the shape flyout trigger/variants match plain tool buttons. */
const toolButtonClass = (active: boolean, enabled = true): string =>
	cn(
		"grid size-7 place-items-center rounded-md border text-ui transition",
		active
			? "border-accent bg-accent-surface text-accent-fg"
			: "border-hairline/8 bg-hairline/5 text-fg-secondary hover:border-hairline/20 hover:bg-hairline/10 hover:text-fg",
		!enabled &&
			"cursor-not-allowed border-hairline/8 bg-hairline/5 text-fg-subtle hover:border-hairline/8 hover:bg-hairline/5 hover:text-fg-subtle",
	);

type ToolButtonProps = {
	readonly tool: EditorTool;
	readonly active: boolean;
	readonly onActivate: () => void;
};

function ToolButton({ tool, active, onActivate }: ToolButtonProps) {
	const reachability = toolReachability(tool.id);
	const enabled = reachability.kind === "activatable";
	const label = toolTooltipLabel(tool);
	const Icon = tool.Icon;

	return (
		<Tooltip label={label} side="right">
			<span className="inline-grid">
				<button
					type="button"
					aria-label={label}
					aria-disabled={!enabled}
					onClick={() => {
						if (!enabled) return;
						onActivate();
					}}
					className={toolButtonClass(active, enabled)}
				>
					<Icon
						aria-hidden="true"
						size={14}
						weight={active ? "duotone" : "regular"}
					/>
				</button>
			</span>
		</Tooltip>
	);
}

type ShapeToolFlyoutProps = {
	readonly activeTool: ToolId;
	readonly shapeKind: ShapeKind;
	readonly setShapeKind: (kind: ShapeKind) => void;
	readonly setActiveTool: (tool: ToolId) => void;
};

/**
 * The grouped shape tool: one rail slot showing the current shape kind, with a
 * flyout to switch primitives. Clicking the trigger activates the shape tool
 * (keeping the current kind) and reveals the flyout; picking a variant sets the
 * kind and activates the tool. The `R` shortcut cycles the same kind state, so
 * the rail selection and the keyboard cycle stay in sync.
 */
function ShapeToolFlyout({
	activeTool,
	shapeKind,
	setShapeKind,
	setActiveTool,
}: ShapeToolFlyoutProps) {
	const [open, setOpen] = useState(false);
	const active = activeTool === "shape";
	const current = shapeToolVariant(shapeKind);
	const CurrentIcon = current.Icon;
	const shortcut = shortcutLabel({ key: "r" });
	const triggerLabel = `Shape — ${current.label} (${shortcut} to cycle)`;

	return (
		<Popover.Root open={open} onOpenChange={setOpen} modal={false}>
			<Popover.Trigger
				type="button"
				aria-label={triggerLabel}
				title={triggerLabel}
				onClick={() => setActiveTool("shape")}
				className={cn(toolButtonClass(active), "relative")}
			>
				<CurrentIcon
					aria-hidden="true"
					size={14}
					weight={active ? "duotone" : "regular"}
				/>
				<CaretUp
					aria-hidden="true"
					size={7}
					weight="fill"
					className="pointer-events-none absolute right-0.5 bottom-0.5 opacity-60"
				/>
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Positioner
					align="center"
					side="top"
					sideOffset={8}
					collisionPadding={8}
					className="z-50 outline-none"
				>
					<Popover.Popup className="flex items-center gap-0.5 rounded-lg border border-white/10 bg-surface-raised/95 p-1 shadow-2xl shadow-black/45 outline-none backdrop-blur-xl">
						{SHAPE_TOOL_VARIANTS.map((variant) => {
							const VariantIcon = variant.Icon;
							const selected = active && shapeKind === variant.kind;
							return (
								<button
									key={variant.kind}
									type="button"
									aria-label={variant.label}
									aria-pressed={selected}
									title={variant.label}
									onClick={() => {
										setShapeKind(variant.kind);
										setActiveTool("shape");
										setOpen(false);
									}}
									className={toolButtonClass(selected)}
								>
									<VariantIcon
										aria-hidden="true"
										size={14}
										weight={selected ? "duotone" : "regular"}
									/>
								</button>
							);
						})}
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}

export function ToolRail() {
	"use memo";

	const activeTool = useToolSelectionStore((state) => state.activeTool);
	const setActiveTool = useToolSelectionStore((state) => state.setActiveTool);
	const shapeKind = useDrawStore((state) => state.shapeKind);
	const setShapeKind = useDrawStore((state) => state.setShapeKind);
	const sampledColor = useColorPickToolStore((state) =>
		state.lastSample?.pick.kind === "picked"
			? state.lastSample.pick.candidate.color
			: null,
	);

	return (
		<TooltipProvider>
			<aside className="tool-rail flex items-center gap-0.5 rounded-lg border border-white/10 bg-surface-raised/90 p-1 shadow-2xl shadow-black/45 backdrop-blur-xl">
				{TOOL_RAIL_TOOL_IDS.map((toolId) => {
					if (toolId === "shape") {
						return (
							<div key="shape" className="relative">
								<ShapeToolFlyout
									activeTool={activeTool}
									shapeKind={shapeKind}
									setShapeKind={setShapeKind}
									setActiveTool={setActiveTool}
								/>
							</div>
						);
					}

					const tool = getEditorTool(toolId);
					const reachability = toolReachability(tool.id);
					const active =
						reachability.kind === "activatable" &&
						activationMatches(reachability.activation, activeTool, shapeKind);

					return (
						<div key={tool.id} className="relative">
							<ToolButton
								tool={tool}
								active={active}
								onActivate={() => {
									if (reachability.kind !== "activatable") return;
									if (reachability.activation.shapeKind) {
										setShapeKind(reachability.activation.shapeKind);
									}
									setActiveTool(reachability.activation.toolId);
								}}
							/>
							{tool.id === "eyedropper" && sampledColor ? (
								<span
									aria-hidden="true"
									className="pointer-events-none absolute right-0.5 bottom-0.5 size-2 rounded-full border border-surface bg-surface"
									style={{ backgroundColor: sampledColor }}
								/>
							) : null}
						</div>
					);
				})}
			</aside>
		</TooltipProvider>
	);
}
