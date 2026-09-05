import type { CSSProperties } from "react";
import { cn } from "@/shared/lib/cn";
import { Tooltip, TooltipProvider } from "@/shared/ui/Tooltip";
import type { IpadCommandAction } from "./IpadQuickMenu";

/**
 * iPad-scale command-button recipe, mirrored verbatim from
 * `ipadCommandButtonClass` in `IpadQuickMenu.tsx` (kept in sync by hand since
 * that helper is not exported) so the Conversion HUD reads as the same
 * touch-target family as the rest of the iPad command chrome.
 */
const conversionHudButtonClass = ({
	active = false,
	danger = false,
	enabled = true,
}: {
	readonly active?: boolean;
	readonly danger?: boolean;
	readonly enabled?: boolean;
}): string =>
	cn(
		"grid h-12 min-w-0 place-items-center gap-0.5 rounded-md border px-1 text-ui transition",
		active
			? "border-accent bg-accent-surface text-accent-fg"
			: danger
				? "border-danger/30 bg-danger-surface/45 text-danger-fg"
				: "border-hairline/10 bg-hairline/5 text-fg-secondary",
		enabled
			? "hover:border-accent/40 hover:bg-accent-surface/55 hover:text-accent-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
			: "cursor-not-allowed opacity-45",
	);

/**
 * Transient, canvas-local conversion cluster (iPad Pencil-motion loop L5):
 * once a freehand Pencil stroke commits, this floats next to the stroke and
 * offers its available conversions — Draw on / Make shape / Perform / Discard
 * — without requiring a tool switch to Select first. Purely presentational:
 * every action's `onClick` (built by the caller) already carries its full
 * effect, so this component only renders the cluster at the given `style`
 * and asks the host to dismiss it once an action has run.
 */
export function IpadConversionHud({
	actions,
	onDismiss,
	style,
}: {
	readonly actions: readonly IpadCommandAction[];
	readonly onDismiss: () => void;
	readonly style: CSSProperties;
}) {
	if (actions.length === 0) return null;

	return (
		<TooltipProvider>
			<div
				className="pointer-events-auto absolute flex items-center gap-1 rounded-lg border border-hairline/10 bg-surface-raised/96 p-1.5 text-fg shadow-2xl shadow-scrim/45 backdrop-blur-xl"
				onPointerDown={(event) => event.stopPropagation()}
				style={style}
			>
				{actions.map(
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
								aria-label={label}
								aria-pressed={active || undefined}
								aria-disabled={!enabled}
								className={conversionHudButtonClass({
									active,
									danger,
									enabled,
								})}
								onClick={() => {
									if (!enabled) return;
									onClick();
									onDismiss();
								}}
							>
								<IconComponent aria-hidden="true" size={18} />
								<span className="block max-w-full truncate">{label}</span>
							</button>
						</Tooltip>
					),
				)}
			</div>
		</TooltipProvider>
	);
}
