import type { TooltipPositionerProps } from "@base-ui/react/tooltip";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";

export type TooltipSide = NonNullable<TooltipPositionerProps["side"]>;
export type TooltipAlign = NonNullable<TooltipPositionerProps["align"]>;

export type TooltipProviderProps = {
	readonly children: ReactNode;
};

export type TooltipProps = {
	readonly label: ReactNode;
	readonly children: ReactElement;
	readonly side?: TooltipSide;
	readonly align?: TooltipAlign;
	readonly disabled?: boolean;
};

const POPUP_CLASS =
	"z-50 max-w-64 origin-[var(--transform-origin)] select-none whitespace-normal break-words rounded-md border border-white/20 bg-surface/98 px-2 py-1.5 text-fg text-ui leading-3 shadow-2xl shadow-black/70 outline-none backdrop-blur-xl transition duration-100 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[instant]:transition-none data-[starting-style]:scale-95 data-[starting-style]:opacity-0";

const POSITIONER_CLASS = "z-50 outline-none";

const hasVisibleLabel = (label: ReactNode): boolean => {
	if (typeof label === "string") return label.trim().length > 0;
	return label !== null && label !== undefined && label !== false;
};

/**
 * Shared delay group for compact editor-chrome tooltips.
 *
 * Base UI owns hover/focus timing across adjacent controls without rendering an
 * extra layout box, so rails and bars can opt in without changing dimensions.
 */
export function TooltipProvider({ children }: TooltipProviderProps) {
	return (
		<BaseTooltip.Provider delay={450} closeDelay={60} timeout={300}>
			{children}
		</BaseTooltip.Provider>
	);
}

/**
 * Compact tokenized tooltip for icon-only editor chrome.
 *
 * The trigger is rendered as the supplied child element, while the popup is
 * portaled and collision-aware so hover/focus help never pushes toolbar layout.
 */
export function Tooltip({
	label,
	children,
	side = "top",
	align = "center",
	disabled = false,
}: TooltipProps) {
	if (disabled || !hasVisibleLabel(label)) return children;

	return (
		<BaseTooltip.Root>
			<BaseTooltip.Trigger render={children} />
			<BaseTooltip.Portal>
				<BaseTooltip.Positioner
					className={POSITIONER_CLASS}
					side={side}
					align={align}
					sideOffset={6}
					collisionPadding={8}
					collisionAvoidance={{
						side: "flip",
						align: "shift",
						fallbackAxisSide: "end",
					}}
				>
					<BaseTooltip.Popup className={POPUP_CLASS}>{label}</BaseTooltip.Popup>
				</BaseTooltip.Positioner>
			</BaseTooltip.Portal>
		</BaseTooltip.Root>
	);
}
