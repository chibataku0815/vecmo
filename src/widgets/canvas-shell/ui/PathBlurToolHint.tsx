import type { CSSProperties } from "react";
import { createAddObjectPathBlurCommand } from "@/entities/scene/model/node-commands";
import { useSceneStore } from "@/entities/scene/model/store";
import { createInsertLookGraphNodeCommand } from "@/features/look-authoring/model/look-graph-commands";
import { useEditorChromeStore } from "@/shared/editor-chrome/model/store";

export type PathBlurHintTarget =
	| { readonly mode: "frame"; readonly artboardId: string }
	| { readonly mode: "object"; readonly nodeId: string };

type PathBlurToolHintProps = {
	readonly target: PathBlurHintTarget;
	readonly style: CSSProperties;
};

const FRAME_HINT_LINE =
	"Path Blur はアートボード全体（すべてのオブジェクト）にかかる効果です。";
const FRAME_ADD_LABEL = "このアートボードに Path Blur を追加";
const OBJECT_HINT_LINE = "選択したオブジェクトだけに Path Blur をかけます。";
const OBJECT_ADD_LABEL = "選択オブジェクトに Path Blur を追加";
const OPEN_WORKSPACE_LABEL = "Look workspace で編集";

/**
 * Adds a `path-blur` node to the artboard's frame Look in one undoable command.
 * The insert is non-destructive: `createInsertLookGraphNodeCommand` materializes
 * the artboard's currently resolved Look (e.g. an Analog Film recipe) into an
 * explicit graph before appending path-blur, so authored look state is preserved
 * rather than clobbered. Reads the live document at click time and only applies a
 * `ready` command result (the union's other kinds carry no command).
 */
const addPathBlurToArtboard = (artboardId: string): void => {
	const document = useSceneStore.getState().document;
	const result = createInsertLookGraphNodeCommand(
		document,
		{ scope: "artboard", artboardId },
		"path-blur",
		{ label: "Add Path Blur" },
	);
	if (result.kind === "ready") useSceneStore.getState().apply(result.command);
};

/** Adds a scoped Path Blur overlay targeting one selected object. */
const addPathBlurToObject = (nodeId: string): void => {
	useSceneStore
		.getState()
		.apply(createAddObjectPathBlurCommand(nodeId, { label: "Add Path Blur" }));
};

/**
 * On-canvas hint shown when the Path Blur tool is active and the current
 * target (the whole artboard, or — when exactly one eligible object is
 * selected — that object; see `pathBlurHintTarget` in CanvasShell) has no
 * path-blur node yet. The tool no longer auto-seeds the frame-wide effect on
 * activation — that silently blurred every object — so this hint is the
 * explicit, one-click opt-in. Presentational, mirroring
 * {@link NoiseGradientToolControls}: `pointer-events-auto` over the
 * pointer-events-none world overlay, with pointer events stopped so a click on
 * the chip never starts a canvas gesture.
 */
export function PathBlurToolHint({ target, style }: PathBlurToolHintProps) {
	const isObject = target.mode === "object";
	return (
		<div
			className="pointer-events-auto absolute z-30 w-64 rounded-md border border-white/10 bg-surface-raised/90 p-2 text-fg shadow-xl shadow-black/30 backdrop-blur-xl"
			onPointerDown={(event) => event.stopPropagation()}
			onPointerMove={(event) => event.stopPropagation()}
			onPointerUp={(event) => event.stopPropagation()}
			style={style}
		>
			<p className="mb-2 text-ui leading-4 text-fg-secondary">
				{isObject ? OBJECT_HINT_LINE : FRAME_HINT_LINE}
			</p>
			<div className="space-y-1">
				<button
					type="button"
					className="w-full rounded-[3px] bg-accent px-2 py-1 text-center font-semibold text-accent-fg text-ui leading-4"
					onClick={() =>
						target.mode === "object"
							? addPathBlurToObject(target.nodeId)
							: addPathBlurToArtboard(target.artboardId)
					}
				>
					{isObject ? OBJECT_ADD_LABEL : FRAME_ADD_LABEL}
				</button>
				<button
					type="button"
					className="w-full rounded-[3px] border border-fg-secondary/60 bg-surface-light/80 px-2 py-1 text-center font-medium text-ink text-ui leading-4"
					onClick={() => useEditorChromeStore.getState().toggleLookWorkspace()}
				>
					{OPEN_WORKSPACE_LABEL}
				</button>
			</div>
		</div>
	);
}
