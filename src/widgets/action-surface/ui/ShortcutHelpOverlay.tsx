import { X } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useEditorChromeStore } from "@/shared/editor-chrome/model/store";
import { cn } from "@/shared/lib/cn";
import {
	buildShortcutReference,
	type ShortcutEntry,
} from "../model/shortcut-reference";

// The reference is derived from static registry/tool metadata, so it is built
// once at module load rather than on every render.
const SHORTCUT_SECTIONS = buildShortcutReference();

function KeyCombo({ keys }: { readonly keys: string }) {
	return (
		<span className="shrink-0 rounded border border-white/10 px-1.5 py-0.5 font-mono text-fg-muted text-ui">
			{keys}
		</span>
	);
}

function ShortcutRow({ entry }: { readonly entry: ShortcutEntry }) {
	return (
		<div className="flex items-center justify-between gap-3 py-0.5">
			<span className="min-w-0 truncate text-fg text-ui">{entry.label}</span>
			<KeyCombo keys={entry.keys} />
		</div>
	);
}

/**
 * Figma-style keyboard-shortcut cheat sheet. Opens with `?` (or the top-bar
 * help button) and lists every active editor shortcut, grouped by category.
 * Acts as a modal: while open the global dispatchers gate on `shortcutHelpOpen`,
 * so the only keys that act are this overlay's Escape and the `?` toggle.
 */
export function ShortcutHelpOverlay() {
	const open = useEditorChromeStore((state) => state.shortcutHelpOpen);
	const setOpen = useEditorChromeStore((state) => state.setShortcutHelpOpen);
	const closeRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (!open) return;
		closeRef.current?.focus();
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopImmediatePropagation();
				setOpen(false);
			}
		};
		window.addEventListener("keydown", onKeyDown, { capture: true });
		return () =>
			window.removeEventListener("keydown", onKeyDown, { capture: true });
	}, [open, setOpen]);

	if (!open) return null;

	// Portal to the document body so the fixed overlay is positioned against the
	// viewport: ancestors of the action-surface set `backdrop-filter`/`transform`,
	// which would otherwise become the containing block and clip the modal.
	return createPortal(
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="shortcut-help-title"
			className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<button
				type="button"
				aria-label="Close keyboard shortcuts"
				tabIndex={-1}
				className="absolute inset-0 cursor-default bg-black/55 backdrop-blur-sm"
				onClick={() => setOpen(false)}
			/>
			<div
				className={cn(
					"relative flex max-h-[86svh] w-[min(calc(100vw-32px),880px)] flex-col",
					"overflow-hidden rounded-xl border border-white/10 bg-surface-raised/97 shadow-2xl shadow-black/50 backdrop-blur-xl",
				)}
			>
				<header className="flex h-10 items-center justify-between border-white/10 border-b px-3.5">
					<h2 id="shortcut-help-title" className="font-medium text-fg text-ui">
						Keyboard shortcuts
					</h2>
					<div className="flex items-center gap-2">
						<span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-fg-muted text-ui">
							?
						</span>
						<button
							ref={closeRef}
							type="button"
							aria-label="Close keyboard shortcuts"
							onClick={() => setOpen(false)}
							className="grid size-6 place-items-center rounded text-fg-muted hover:bg-white/5 hover:text-fg"
						>
							<X aria-hidden="true" size={13} />
						</button>
					</div>
				</header>

				<div className="overflow-auto p-3.5">
					<div className="columns-1 gap-x-6 sm:columns-2 lg:columns-3">
						{SHORTCUT_SECTIONS.map((section) => (
							<section key={section.id} className="mb-4 break-inside-avoid">
								<h3 className="pb-1 font-medium text-fg-muted text-ui uppercase tracking-[0.08em]">
									{section.title}
								</h3>
								<div>
									{section.entries.map((entry) => (
										<ShortcutRow
											key={`${section.id}:${entry.label}`}
											entry={entry}
										/>
									))}
								</div>
							</section>
						))}
					</div>
				</div>
			</div>
		</div>,
		document.body,
	);
}
