import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";
import type { Icon } from "@phosphor-icons/react";
import { Fragment, type ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

/**
 * Headless right-click context menu, the first Base UI consumer in the editor.
 *
 * Base UI provides the behavior (cursor-anchored positioning via Floating UI,
 * roving focus, keyboard navigation, `role="menu"`/`menuitem`, focus return,
 * outside-click and Escape dismissal); this wrapper only applies the editor's
 * design tokens and exposes a flat, data-driven API so callers describe actions
 * instead of composing primitives. Lives in `shared/ui` next to `IconButton` as a
 * generic primitive with no product decisions.
 */

export type ContextMenuItem = {
	readonly id: string;
	readonly label: string;
	readonly icon?: Icon;
	readonly onSelect: () => void;
	readonly disabled?: boolean;
	/** Renders the item in the danger tone (e.g. destructive delete). */
	readonly danger?: boolean;
};

/** A run of items rendered together; groups are visually separated. */
export type ContextMenuGroup = {
	readonly id: string;
	readonly items: readonly ContextMenuItem[];
};

export type ContextMenuProps = {
	readonly groups: readonly ContextMenuGroup[];
	/** Accessible name for the menu surface. */
	readonly label?: string;
	/** The right-click target. Rendered transparently (no extra layout box). */
	readonly children: ReactNode;
};

const POPUP_CLASS =
	"z-50 min-w-[168px] origin-[var(--transform-origin)] rounded-md border border-white/12 bg-surface-raised/95 p-1 text-fg text-ui shadow-2xl shadow-black/50 outline-none backdrop-blur-xl transition data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0";

const POSITIONER_CLASS = "z-50 outline-none";

const ITEM_CLASS =
	"flex cursor-default select-none items-center gap-2 rounded px-2 py-1 text-left text-fg-secondary outline-none transition data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent-surface data-[highlighted]:text-accent-fg";

const DANGER_ITEM_CLASS =
	"text-danger-fg data-[highlighted]:bg-danger-surface data-[highlighted]:text-danger-fg";

export function ContextMenu({ groups, label, children }: ContextMenuProps) {
	const populated = groups.filter((group) => group.items.length > 0);

	// The Root + Trigger always mount so this component reliably OWNS right-click
	// within its children (Base UI suppresses the native menu). The menu surface is
	// rendered only when there are items, so a consumer with dynamic groups — e.g.
	// the canvas, whose actions depend on async selection state — never leaks the
	// native browser menu on the first right-click before its groups populate.
	return (
		<BaseContextMenu.Root>
			<BaseContextMenu.Trigger className="contents">
				{children}
			</BaseContextMenu.Trigger>
			{populated.length === 0 ? null : (
				<BaseContextMenu.Portal>
					<BaseContextMenu.Positioner
						className={POSITIONER_CLASS}
						sideOffset={2}
					>
						<BaseContextMenu.Popup className={POPUP_CLASS} aria-label={label}>
							{populated.map((group, groupIndex) => (
								<Fragment key={group.id}>
									{groupIndex > 0 ? (
										<BaseContextMenu.Separator className="my-1 h-px bg-white/10" />
									) : null}
									{group.items.map((item) => {
										const IconComponent = item.icon;
										return (
											<BaseContextMenu.Item
												key={item.id}
												disabled={item.disabled}
												onClick={item.onSelect}
												className={cn(
													ITEM_CLASS,
													item.danger && DANGER_ITEM_CLASS,
												)}
											>
												{IconComponent ? (
													<IconComponent aria-hidden="true" size={11} />
												) : null}
												<span className="min-w-0 flex-1 truncate">
													{item.label}
												</span>
											</BaseContextMenu.Item>
										);
									})}
								</Fragment>
							))}
						</BaseContextMenu.Popup>
					</BaseContextMenu.Positioner>
				</BaseContextMenu.Portal>
			)}
		</BaseContextMenu.Root>
	);
}
