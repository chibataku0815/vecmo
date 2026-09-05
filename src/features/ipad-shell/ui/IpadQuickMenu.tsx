import { DotsSix, type Icon } from "@phosphor-icons/react";
import {
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useRef,
	useState,
} from "react";
import { Tooltip, TooltipProvider } from "@/shared/ui/Tooltip";

/** CanvasShell-resolved command surfaced in the rectangular or squeeze QuickMenu. */
export type IpadCommandAction = {
	readonly id: string;
	readonly label: string;
	readonly title: string;
	readonly IconComponent: Icon;
	readonly onClick: () => void;
	readonly active?: boolean;
	readonly enabled?: boolean;
	readonly danger?: boolean;
};

/** Open-position and Pencil metadata for the active iPad QuickMenu surface. */
export type IpadQuickMenuState = {
	readonly x: number;
	readonly y: number;
	readonly source: "quickbar" | "squeeze" | "touch";
	readonly pencil?: {
		readonly phase: string;
		readonly preferredAction: string;
		readonly rollAngle?: number | null;
	};
};

const IPAD_QUICK_MENU_WIDTH_PX = 300;
const IPAD_QUICK_MENU_HEIGHT_PX = 328;
const IPAD_QUICK_MENU_MAX_ACTIONS = 24;
const IPAD_QUICK_MENU_HOLD_MS = 260;
const IPAD_SQUEEZE_PALETTE_SIZE_PX = 316;
const IPAD_SQUEEZE_PALETTE_RADIUS_PX = 112;
const IPAD_SQUEEZE_ACTION_SIZE_PX = 74;
const IPAD_SQUEEZE_CENTER_SIZE_PX = 60;
const IPAD_SQUEEZE_CENTER_DEAD_ZONE_PX = 40;
const IPAD_SQUEEZE_ACTION_PRIORITY = [
	"tool-select",
	"tool-pencil",
	"tool-shape",
	"tool-gradient",
	"tool-noise-gradient",
	"tool-hand",
	"undo",
	"redo",
	"fit",
	"timeline",
	"appearance",
	"delete",
	"duplicate",
	"recovery",
] as const;
const IPAD_SQUEEZE_MENU_STORAGE_KEY =
	"vector-motion-author:ipad-squeeze-menu:v2";

const clampOverlayCoordinate = (
	value: number,
	size: number,
	contentSize: number,
	margin = 12,
): number => {
	if (size <= margin * 2) return Math.max(margin, value);
	const half = contentSize / 2;
	return Math.min(Math.max(value, margin + half), size - margin - half);
};

const angularDistance = (left: number, right: number): number => {
	const distance = Math.abs(left - right) % (Math.PI * 2);
	return Math.min(distance, Math.PI * 2 - distance);
};

const squeezeActionPriority = (action: IpadCommandAction): number => {
	// biome-ignore lint/complexity/useIndexOf: IPAD_SQUEEZE_ACTION_PRIORITY is a typed action-id union; action.id is a wider string, so indexOf() would not type-check.
	const index = IPAD_SQUEEZE_ACTION_PRIORITY.findIndex(
		(actionId) => actionId === action.id,
	);
	return index === -1 ? IPAD_SQUEEZE_ACTION_PRIORITY.length : index;
};

const squeezePaletteActions = (
	actions: readonly IpadCommandAction[],
	slotIds: readonly string[] = [],
): readonly IpadCommandAction[] =>
	[
		...slotIds
			.map((slotId) => actions.find((action) => action.id === slotId))
			.filter(
				(action): action is IpadCommandAction =>
					action !== undefined && action.enabled !== false,
			),
		...[...actions]
			.filter(
				(action) => action.enabled !== false && !slotIds.includes(action.id),
			)
			.sort((left, right) => {
				const priorityDelta =
					squeezeActionPriority(left) - squeezeActionPriority(right);
				if (priorityDelta !== 0) return priorityDelta;
				return left.label.localeCompare(right.label);
			}),
	].slice(0, 6);

const squeezePaletteCandidateActions = (
	actions: readonly IpadCommandAction[],
): readonly IpadCommandAction[] =>
	[...actions]
		.filter((action) => action.enabled !== false)
		.sort((left, right) => {
			const priorityDelta =
				squeezeActionPriority(left) - squeezeActionPriority(right);
			if (priorityDelta !== 0) return priorityDelta;
			return left.label.localeCompare(right.label);
		});

const readIpadSqueezeSlotIds = (): readonly string[] => {
	try {
		const raw = globalThis.localStorage?.getItem(IPAD_SQUEEZE_MENU_STORAGE_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((value): value is string => typeof value === "string");
	} catch {
		return [];
	}
};

const writeIpadSqueezeSlotIds = (slotIds: readonly string[]) => {
	try {
		globalThis.localStorage?.setItem(
			IPAD_SQUEEZE_MENU_STORAGE_KEY,
			JSON.stringify(slotIds.slice(0, 6)),
		);
	} catch {}
};

const safelyCapturePointer = (element: Element, pointerId: number): void => {
	if (!("setPointerCapture" in element)) return;
	try {
		element.setPointerCapture(pointerId);
	} catch {}
};

const safelyReleasePointer = (element: Element, pointerId: number): void => {
	if (
		!("hasPointerCapture" in element) ||
		!("releasePointerCapture" in element) ||
		!element.hasPointerCapture(pointerId)
	) {
		return;
	}
	try {
		element.releasePointerCapture(pointerId);
	} catch {}
};

const squeezePaletteActionPosition = (
	index: number,
	count: number,
): { readonly angle: number; readonly x: number; readonly y: number } => {
	const angle = -Math.PI / 2 + (index / Math.max(count, 1)) * Math.PI * 2;
	return {
		angle,
		x: Math.cos(angle) * IPAD_SQUEEZE_PALETTE_RADIUS_PX,
		y: Math.sin(angle) * IPAD_SQUEEZE_PALETTE_RADIUS_PX,
	};
};

const squeezePaletteLabelLines = (label: string): readonly string[] => {
	const words = label.trim().split(/\s+/).filter(Boolean);
	if (words.length <= 1) return [label];
	let bestIndex = 1;
	let bestScore = Number.POSITIVE_INFINITY;
	for (let index = 1; index < words.length; index += 1) {
		const first = words.slice(0, index).join(" ");
		const second = words.slice(index).join(" ");
		const score =
			Math.abs(first.length - second.length) +
			(first.length > 9 ? 8 : 0) +
			(second.length > 9 ? 8 : 0);
		if (score < bestScore) {
			bestIndex = index;
			bestScore = score;
		}
	}
	return [
		words.slice(0, bestIndex).join(" "),
		words.slice(bestIndex).join(" "),
	];
};

const rollAngleDegrees = (
	rollAngle: number | null | undefined,
): number | null =>
	typeof rollAngle === "number" && Number.isFinite(rollAngle)
		? (rollAngle * 180) / Math.PI
		: null;

const ipadCommandButtonClass = ({
	active = false,
	danger = false,
	enabled = true,
}: {
	readonly active?: boolean;
	readonly danger?: boolean;
	readonly enabled?: boolean;
}): string =>
	[
		"grid h-12 min-w-0 place-items-center gap-0.5 rounded-md border px-1 text-ui transition",
		active
			? "border-accent bg-accent-surface text-accent-fg"
			: danger
				? "border-danger/30 bg-danger-surface/45 text-danger-fg"
				: "border-hairline/10 bg-hairline/5 text-fg-secondary",
		enabled
			? "hover:border-accent/40 hover:bg-accent-surface/55 hover:text-accent-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
			: "cursor-not-allowed opacity-45",
	].join(" ");

export function IpadQuickMenu({
	actions,
	onClose,
	state,
	viewportSize,
}: {
	readonly actions: readonly IpadCommandAction[];
	readonly onClose: () => void;
	readonly state: IpadQuickMenuState;
	readonly viewportSize: { readonly width: number; readonly height: number };
}) {
	if (state.source === "squeeze") {
		return (
			<IpadSqueezePalette
				actions={actions}
				onClose={onClose}
				state={state}
				viewportSize={viewportSize}
			/>
		);
	}
	const left = clampOverlayCoordinate(
		state.x,
		viewportSize.width,
		IPAD_QUICK_MENU_WIDTH_PX,
	);
	const top = clampOverlayCoordinate(
		state.y,
		viewportSize.height,
		IPAD_QUICK_MENU_HEIGHT_PX,
	);
	const visibleActions = actions.slice(0, IPAD_QUICK_MENU_MAX_ACTIONS);

	return (
		<TooltipProvider>
			<div className="pointer-events-auto absolute inset-0 z-[46]">
				<button
					type="button"
					aria-label="Close quick menu"
					className="absolute inset-0 cursor-default bg-scrim/10"
					onClick={onClose}
				/>
				<div
					role="menu"
					aria-label="iPad quick menu"
					className="absolute grid w-[300px] grid-cols-4 gap-1 rounded-lg border border-hairline/10 bg-surface-raised/96 p-1.5 text-fg shadow-2xl shadow-scrim/45 backdrop-blur-xl"
					style={{
						left,
						top,
						transform: "translate(-50%, -50%)",
					}}
					onPointerDown={(event) => event.stopPropagation()}
				>
					{visibleActions.map(
						({
							id,
							label,
							title,
							IconComponent,
							onClick,
							active,
							enabled = true,
							danger,
						}) => (
							<Tooltip key={id} label={title} side="top">
								<button
									type="button"
									role="menuitemcheckbox"
									aria-label={label}
									aria-checked={active || undefined}
									aria-disabled={!enabled}
									className={ipadCommandButtonClass({
										active,
										danger,
										enabled,
									})}
									onClick={() => {
										if (!enabled) return;
										onClick();
										onClose();
									}}
								>
									<IconComponent aria-hidden="true" size={18} />
									<span className="block max-w-full truncate">{label}</span>
								</button>
							</Tooltip>
						),
					)}
				</div>
			</div>
		</TooltipProvider>
	);
}

function IpadSqueezePalette({
	actions,
	onClose,
	state,
	viewportSize,
}: {
	readonly actions: readonly IpadCommandAction[];
	readonly onClose: () => void;
	readonly state: IpadQuickMenuState;
	readonly viewportSize: { readonly width: number; readonly height: number };
}) {
	const [dragActionId, setDragActionId] = useState<string | null>(null);
	const [slotIds, setSlotIds] = useState(() => readIpadSqueezeSlotIds());
	const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
	const assignmentHoldTimerRef = useRef<number | null>(null);
	const visibleActions = squeezePaletteActions(actions, slotIds);
	const candidateActions = squeezePaletteCandidateActions(actions);
	const left = clampOverlayCoordinate(
		state.x,
		viewportSize.width,
		IPAD_SQUEEZE_PALETTE_SIZE_PX,
	);
	const top = clampOverlayCoordinate(
		state.y,
		viewportSize.height,
		IPAD_SQUEEZE_PALETTE_SIZE_PX,
	);
	const rollDegrees = rollAngleDegrees(state.pencil?.rollAngle);

	const clearAssignmentHoldTimer = () => {
		if (assignmentHoldTimerRef.current === null) return;
		window.clearTimeout(assignmentHoldTimerRef.current);
		assignmentHoldTimerRef.current = null;
	};

	useEffect(
		() => () => {
			if (assignmentHoldTimerRef.current === null) return;
			window.clearTimeout(assignmentHoldTimerRef.current);
			assignmentHoldTimerRef.current = null;
		},
		[],
	);

	const replaceSlotAction = (actionId: string) => {
		const nextSlotIds = visibleActions.map((action) =>
			action.id === editingSlotId ? actionId : action.id,
		);
		setSlotIds(nextSlotIds);
		writeIpadSqueezeSlotIds(nextSlotIds);
		setEditingSlotId(null);
	};

	const actionFromPointer = (
		event: ReactPointerEvent<HTMLDivElement>,
	): IpadCommandAction | null => {
		if (visibleActions.length === 0) return null;
		const rect = event.currentTarget.getBoundingClientRect();
		const centerX = rect.left + rect.width / 2;
		const centerY = rect.top + rect.height / 2;
		const dx = event.clientX - centerX;
		const dy = event.clientY - centerY;
		if (Math.hypot(dx, dy) < IPAD_SQUEEZE_CENTER_DEAD_ZONE_PX) return null;
		const angle = Math.atan2(dy, dx);
		let nearest = visibleActions[0] ?? null;
		let nearestDistance = Number.POSITIVE_INFINITY;
		for (const [index, action] of visibleActions.entries()) {
			const position = squeezePaletteActionPosition(
				index,
				visibleActions.length,
			);
			const distance = angularDistance(angle, position.angle);
			if (distance < nearestDistance) {
				nearest = action;
				nearestDistance = distance;
			}
		}
		return nearest;
	};

	const runAction = (action: IpadCommandAction | null) => {
		if (!action || action.enabled === false) return;
		action.onClick();
		onClose();
	};

	return (
		<TooltipProvider>
			<div className="pointer-events-auto absolute inset-0 z-[46]">
				<button
					type="button"
					aria-label="Close squeeze menu"
					className="absolute inset-0 cursor-default bg-scrim/10"
					onClick={onClose}
				/>
				<div
					role="menu"
					aria-label="Apple Pencil squeeze quick menu"
					className="absolute rounded-full border border-hairline/10 bg-surface-raised/96 text-fg shadow-2xl shadow-scrim/45 backdrop-blur-xl"
					style={{
						left,
						top,
						width: IPAD_SQUEEZE_PALETTE_SIZE_PX,
						height: IPAD_SQUEEZE_PALETTE_SIZE_PX,
						transform: "translate(-50%, -50%)",
					}}
					onPointerDown={(event) => {
						event.stopPropagation();
						safelyCapturePointer(event.currentTarget, event.pointerId);
						setDragActionId(actionFromPointer(event)?.id ?? null);
					}}
					onPointerMove={(event) => {
						event.stopPropagation();
						setDragActionId(actionFromPointer(event)?.id ?? null);
					}}
					onPointerUp={(event) => {
						event.stopPropagation();
						safelyReleasePointer(event.currentTarget, event.pointerId);
						const actionButton =
							event.target instanceof Element
								? event.target.closest("[data-squeeze-action='true']")
								: null;
						const action = actionButton ? null : actionFromPointer(event);
						setDragActionId(null);
						runAction(action);
					}}
					onPointerCancel={(event) => {
						event.stopPropagation();
						setDragActionId(null);
					}}
				>
					<div
						className="absolute left-1/2 top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-hairline/12 bg-surface-sunken/70 text-fg-secondary"
						style={{
							width: IPAD_SQUEEZE_CENTER_SIZE_PX,
							height: IPAD_SQUEEZE_CENTER_SIZE_PX,
						}}
					>
						<DotsSix aria-hidden="true" size={22} weight="bold" />
						{rollDegrees !== null ? (
							<span
								className="pointer-events-none absolute h-0.5 w-10 rounded-full bg-accent"
								style={{ transform: `rotate(${rollDegrees}deg)` }}
							/>
						) : null}
					</div>
					{visibleActions.map((action, index) => {
						const { id, label, title, IconComponent, onClick, active, danger } =
							action;
						const position = squeezePaletteActionPosition(
							index,
							visibleActions.length,
						);
						const highlighted = dragActionId === id || active === true;
						const labelLines = squeezePaletteLabelLines(label);
						const className = [
							"absolute flex flex-col items-center justify-center rounded-full border px-1.5 text-ui leading-none transition",
							highlighted
								? "border-accent bg-accent-surface text-accent-fg ring-1 ring-accent/35"
								: danger
									? "border-danger/35 bg-danger-surface/65 text-danger-fg"
									: "border-hairline/12 bg-surface-sunken/70 text-fg-secondary hover:border-accent/40 hover:bg-accent-surface/55 hover:text-accent-fg",
						].join(" ");
						return (
							<Tooltip key={id} label={title} side="top">
								<button
									type="button"
									data-squeeze-action="true"
									role="menuitemcheckbox"
									aria-label={label}
									aria-checked={active || undefined}
									className={className}
									style={{
										left: "50%",
										top: "50%",
										width: IPAD_SQUEEZE_ACTION_SIZE_PX,
										height: IPAD_SQUEEZE_ACTION_SIZE_PX,
										transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px))`,
									}}
									onPointerDown={(event) => {
										event.stopPropagation();
										clearAssignmentHoldTimer();
										assignmentHoldTimerRef.current = window.setTimeout(() => {
											setDragActionId(null);
											setEditingSlotId(id);
										}, IPAD_QUICK_MENU_HOLD_MS);
									}}
									onPointerUp={(event) => {
										event.stopPropagation();
										clearAssignmentHoldTimer();
									}}
									onPointerCancel={(event) => {
										event.stopPropagation();
										clearAssignmentHoldTimer();
									}}
									onClick={(event) => {
										event.stopPropagation();
										if (editingSlotId === id) return;
										onClick();
										onClose();
									}}
								>
									<span className="flex h-6 shrink-0 items-center justify-center">
										<IconComponent
											aria-hidden="true"
											size={22}
											weight={highlighted ? "duotone" : "regular"}
										/>
									</span>
									<span className="flex h-7 min-w-0 max-w-[4.5rem] flex-col items-center justify-center overflow-hidden text-center font-medium leading-3">
										{labelLines.map((line, lineIndex) => (
											<span
												// biome-ignore lint/suspicious/noArrayIndexKey: stable-order label lines from squeezePaletteLabelLines(); the index is the identity (lines never reorder).
												key={`${id}:${lineIndex}`}
												className="block max-w-full truncate"
											>
												{line}
											</span>
										))}
									</span>
								</button>
							</Tooltip>
						);
					})}
					{editingSlotId ? (
						<div
							className="absolute left-1/2 top-1/2 grid max-h-48 w-44 -translate-x-1/2 -translate-y-1/2 gap-1 overflow-y-auto rounded-lg border border-hairline/12 bg-surface-raised/98 p-1.5 shadow-2xl shadow-scrim/45"
							onPointerDown={(event) => event.stopPropagation()}
							onPointerUp={(event) => event.stopPropagation()}
						>
							{candidateActions.slice(0, 12).map((action) => {
								const IconComponent = action.IconComponent;
								return (
									<button
										key={action.id}
										type="button"
										className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-hairline/8 bg-hairline/5 px-2 text-fg-secondary text-ui hover:border-accent/35 hover:bg-accent-surface hover:text-accent-fg"
										onClick={() => replaceSlotAction(action.id)}
									>
										<IconComponent aria-hidden="true" size={15} />
										<span className="min-w-0 truncate">{action.label}</span>
									</button>
								);
							})}
						</div>
					) : null}
				</div>
			</div>
		</TooltipProvider>
	);
}
