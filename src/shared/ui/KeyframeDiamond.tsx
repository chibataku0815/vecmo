import { Diamond } from "@phosphor-icons/react";
import { cn } from "@/shared/lib/cn";

/**
 * Tri-state keyframe toggle for an inspector control's `action` slot: a filled
 * diamond when a key sits at the current frame, an outlined warn diamond when the
 * param is animated but the playhead is between keys, and a dim diamond when it is
 * not animated. Clicking toggles a key at the playhead — the `aria-label`/`title`
 * spells out add vs remove so the same control's opposite actions never surprise.
 * Purely presentational: it owns no state and makes no product decision.
 */
export function KeyframeDiamond({
	keyed,
	animated,
	disabled = false,
	label,
	onToggle,
}: {
	readonly keyed: boolean;
	readonly animated: boolean;
	readonly disabled?: boolean;
	/** Human label of the param, woven into the add/remove tooltip. */
	readonly label: string;
	readonly onToggle: () => void;
}) {
	const title = keyed
		? `Remove ${label} keyframe at the playhead`
		: `Add ${label} keyframe at the playhead`;
	return (
		<button
			type="button"
			aria-label={title}
			aria-pressed={keyed}
			title={title}
			disabled={disabled}
			onClick={onToggle}
			className={cn(
				"grid size-6 place-items-center rounded-md border transition disabled:cursor-not-allowed disabled:opacity-45",
				keyed
					? "border-accent bg-accent-surface text-accent-fg"
					: animated
						? "border-warn/45 bg-warn-surface text-warn hover:border-warn/70"
						: "border-white/10 bg-black/20 text-fg-muted hover:border-white/20 hover:text-white",
			)}
		>
			<Diamond
				aria-hidden="true"
				size={11}
				weight={keyed ? "fill" : "regular"}
			/>
		</button>
	);
}
