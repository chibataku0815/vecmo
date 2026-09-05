import { Check } from "@phosphor-icons/react";
import {
	type CSSProperties,
	type KeyboardEvent,
	useEffect,
	useLayoutEffect,
	useRef,
} from "react";
import {
	type Matrix2D,
	matrixFromTransform,
} from "@/entities/scene/model/rendering";
import { findArtboardById, findNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type { SceneDocument } from "@/entities/scene/model/types";
import { Tooltip, TooltipProvider } from "@/shared/ui/Tooltip";
import {
	markExternalTextCommitPointer,
	useTextEditStore,
} from "../model/text-edit-store";
import {
	cancelActiveTextEditing,
	commitActiveTextEditing,
	textDraftLayoutForGeometry,
} from "../model/text-node";
import {
	toggleActiveTextBold,
	toggleActiveTextItalic,
	toggleActiveTextUnderline,
} from "../model/text-typography";

type OverlayProps = {
	readonly document: SceneDocument;
	readonly selection: unknown;
	readonly viewport: { readonly zoom: number };
	readonly clearSelection: () => void;
};

const PERCENT = 100;

const isLightHex = (value: string): boolean => {
	const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu.exec(value);
	if (!match) return false;
	const [, r, g, b] = match;
	if (!r || !g || !b) return false;
	const red = Number.parseInt(r, 16);
	const green = Number.parseInt(g, 16);
	const blue = Number.parseInt(b, 16);
	return (red * 299 + green * 587 + blue * 114) / 1000 > 170;
};

const wrapperTransform = (transform: Matrix2D, scale: number): string =>
	`matrix(${transform.a}, ${transform.b}, ${transform.c}, ${transform.d}, ${transform.e * scale}, ${transform.f * scale})`;

const shouldClearFreshSelection = (
	session: ReturnType<typeof useTextEditStore.getState>["session"],
): boolean =>
	session?.source === "new" && session.draftText.trim().length === 0;

function TextOverlay({
	document: overlayDocument,
	viewport,
	clearSelection,
}: OverlayProps) {
	const document = useSceneStore((state) => state.document);
	const session = useTextEditStore((state) => state.session);
	const creationPreview = useTextEditStore((state) => state.creationPreview);
	const setDraft = useTextEditStore((state) => state.setDraft);
	const textAreaRef = useRef<HTMLTextAreaElement>(null);
	const node = session ? findNode(document, session.nodeId) : undefined;
	const textGeometry = node?.geometry.kind === "text" ? node.geometry : null;

	useEffect(
		() => () => {
			const activeSession = useTextEditStore.getState().session;
			commitActiveTextEditing();
			if (shouldClearFreshSelection(activeSession)) clearSelection();
		},
		[clearSelection],
	);

	useEffect(() => {
		if (!session || textGeometry) return;
		cancelActiveTextEditing();
		if (session.source === "new") clearSelection();
	}, [session, textGeometry, clearSelection]);

	useEffect(() => {
		if (!session) return;
		const textArea = textAreaRef.current;
		if (!textArea) return;
		textArea.focus();
		if (session.source === "new") textArea.select();
	}, [session]);

	useLayoutEffect(() => {
		if (!session) return;
		const commitBeforeExternalPointer = (event: PointerEvent) => {
			const textArea = textAreaRef.current;
			if (!textArea) return;
			const target = event.target;
			if (target instanceof Node && textArea.contains(target)) return;
			if (
				target instanceof Element &&
				target.closest("[data-text-edit-done]")
			) {
				return;
			}
			markExternalTextCommitPointer(event);
			const activeSession = useTextEditStore.getState().session;
			commitActiveTextEditing();
			if (shouldClearFreshSelection(activeSession)) clearSelection();
		};
		window.addEventListener("pointerdown", commitBeforeExternalPointer, {
			capture: true,
		});
		return () => {
			window.removeEventListener("pointerdown", commitBeforeExternalPointer, {
				capture: true,
			});
		};
	}, [session, clearSelection]);

	const scale = viewport.zoom / PERCENT;
	const previewArtboard = creationPreview
		? findArtboardById(overlayDocument, creationPreview.artboardId)
		: undefined;
	const overlayArtboardPosition = overlayDocument.artboard.position ?? {
		x: 0,
		y: 0,
	};
	const creationPreviewElement =
		creationPreview && previewArtboard ? (
			<div
				className="pointer-events-none absolute z-20 rounded-sm border border-overlay-accent-line bg-overlay-accent/10"
				style={{
					height: creationPreview.bounds.height * scale,
					left:
						(previewArtboard.position.x -
							overlayArtboardPosition.x +
							creationPreview.bounds.x) *
						scale,
					top:
						(previewArtboard.position.y -
							overlayArtboardPosition.y +
							creationPreview.bounds.y) *
						scale,
					width: creationPreview.bounds.width * scale,
				}}
			/>
		) : null;

	if (!session || !node || !textGeometry) return creationPreviewElement;

	const matrix = matrixFromTransform(node.transform);
	const draftLayout = textDraftLayoutForGeometry(
		textGeometry,
		session.draftText,
	);
	const wrapperStyle: CSSProperties = {
		transform: wrapperTransform(matrix, scale),
		transformOrigin: "0 0",
	};
	const lightText = isLightHex(node.style.fill);
	const textAreaStyle: CSSProperties = {
		backgroundColor: lightText
			? "rgba(25,24,23,0.9)"
			: "rgba(247,244,235,0.96)",
		color: node.style.fill === "none" ? "#191817" : node.style.fill,
		fontFamily: draftLayout.style.fontFamily,
		fontSize: draftLayout.style.fontSize * scale,
		fontStyle: draftLayout.style.italic ? "italic" : "normal",
		fontWeight: draftLayout.style.fontWeight,
		textDecoration: draftLayout.style.underline ? "underline" : "none",
		height: draftLayout.bounds.height * scale,
		left: draftLayout.bounds.x * scale,
		letterSpacing: `${draftLayout.style.letterSpacing * scale}px`,
		lineHeight: `${draftLayout.style.lineHeight * scale}px`,
		textAlign: draftLayout.style.align,
		top: draftLayout.bounds.y * scale,
		width: draftLayout.bounds.width * scale,
	};
	const doneButtonStyle: CSSProperties = {
		left: (draftLayout.bounds.x + draftLayout.bounds.width) * scale + 6,
		top: draftLayout.bounds.y * scale - 8,
	};

	const finishEditing = () => {
		const activeSession = useTextEditStore.getState().session;
		commitActiveTextEditing();
		if (shouldClearFreshSelection(activeSession)) clearSelection();
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		event.stopPropagation();
		if (event.key === "Escape") {
			event.preventDefault();
			finishEditing();
			return;
		}
		// Bold / italic / underline each toggle the node's style live: the textarea
		// re-derives its style from the node on the next render, so the change stays
		// in the same authoring gesture and is undoable. All three now render
		// end-to-end (canvas + SVG export read fontWeight / font-style /
		// text-decoration), so the keys reflect what the user sees.
		if (event.metaKey || event.ctrlKey) {
			if (event.key === "b" || event.key === "B") {
				event.preventDefault();
				toggleActiveTextBold();
				return;
			}
			if (event.key === "i" || event.key === "I") {
				event.preventDefault();
				toggleActiveTextItalic();
				return;
			}
			if (event.key === "u" || event.key === "U") {
				event.preventDefault();
				toggleActiveTextUnderline();
				return;
			}
		}
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			event.currentTarget.blur();
		}
	};

	return (
		<>
			{creationPreviewElement}
			<div
				className="pointer-events-none absolute inset-0 z-20"
				style={wrapperStyle}
			>
				<textarea
					ref={textAreaRef}
					aria-label="Edit text"
					value={session.draftText}
					spellCheck={false}
					onBlur={() => {
						const activeSession = useTextEditStore.getState().session;
						commitActiveTextEditing();
						if (shouldClearFreshSelection(activeSession)) clearSelection();
					}}
					onChange={(event) => setDraft(event.currentTarget.value)}
					onKeyDown={onKeyDown}
					onPointerDown={(event) => event.stopPropagation()}
					className="pointer-events-auto absolute resize-none overflow-hidden rounded-sm border border-accent px-1 py-0 font-sans outline-none shadow-lg shadow-black/25 selection:bg-accent/30"
					style={textAreaStyle}
				/>
				<TooltipProvider>
					<Tooltip label="Done editing" side="top">
						<button
							type="button"
							data-text-edit-done="true"
							aria-label="Done editing"
							title="Done editing"
							onClick={(event) => {
								event.preventDefault();
								event.stopPropagation();
								finishEditing();
							}}
							onPointerDown={(event) => {
								event.preventDefault();
								event.stopPropagation();
								finishEditing();
							}}
							className="pointer-events-auto absolute z-30 grid size-6 place-items-center rounded-sm border border-accent bg-accent text-accent-fg shadow-lg shadow-scrim/25 outline-none transition hover:bg-accent-strong focus-visible:ring-1 focus-visible:ring-accent"
							style={doneButtonStyle}
						>
							<Check aria-hidden="true" size={13} weight="bold" />
						</button>
					</Tooltip>
				</TooltipProvider>
			</div>
		</>
	);
}

export const overlay = {
	id: "text-canvas-authoring",
	tool: "type" as const,
	Component: TextOverlay,
};
