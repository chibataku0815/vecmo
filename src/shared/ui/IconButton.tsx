import type { Icon } from "@phosphor-icons/react";
import { cn } from "@/shared/lib/cn";
import { Tooltip, type TooltipSide } from "@/shared/ui/Tooltip";

type IconButtonProps = {
	icon: Icon;
	label: string;
	active?: boolean;
	disabled?: boolean;
	size?: "default" | "compact";
	tooltipSide?: TooltipSide;
	onClick?: () => void;
};

export function IconButton({
	icon: Icon,
	label,
	active = false,
	disabled = false,
	size = "default",
	tooltipSide = "top",
	onClick,
}: IconButtonProps) {
	const buttonSizeClass = size === "compact" ? "size-7" : "size-8";
	const iconSize = size === "compact" ? 14 : 15;
	return (
		<Tooltip label={label} side={tooltipSide} disabled={disabled}>
			<button
				type="button"
				aria-label={label}
				aria-pressed={active || undefined}
				disabled={disabled}
				onClick={onClick}
				className={cn(
					"grid shrink-0 place-items-center rounded-md border text-ui leading-none",
					buttonSizeClass,
					active
						? "border-accent bg-accent-surface text-accent-fg"
						: "border-hairline/8 bg-hairline/5 text-fg-secondary hover:border-hairline/20 hover:bg-hairline/10 hover:text-fg",
					disabled && "cursor-not-allowed opacity-45",
				)}
			>
				<Icon aria-hidden="true" size={iconSize} weight="regular" />
			</button>
		</Tooltip>
	);
}
