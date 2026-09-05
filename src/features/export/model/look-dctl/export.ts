import { svgIdSegment } from "@/entities/scene/model/effect-filter";
import type { LookGraphOwnerRef } from "@/entities/scene/model/look-graph";
import { compileLookGraph } from "@/entities/scene/model/look-graph-compile";
import { resolveFrameEffectIntent } from "@/entities/scene/model/recipe-resolve";
import {
	findArtboardById,
	selectCurrentArtboard,
} from "@/entities/scene/model/selectors";
import type { SceneDocument } from "@/entities/scene/model/types";
import { lowerLookGraphToDctl } from "./lower";
import type { LookDctlReport } from "./types";

/** Structurally compatible with `features/export/adapters/download.ts`'s `DownloadableTextAsset`. */
export type LookDctlExportAsset = {
	readonly fileName: string;
	readonly mimeType: string;
	readonly contents: string;
};

export type LookDctlExportOptions = {
	/** Artboard to export the Look from. Omitted/invalid falls back to the editor-focused artboard. */
	readonly artboardId?: string | null;
	/**
	 * S5 "expose all numeric parameters" export option. Default `false`
	 * (hero params only — the pre-S5 behavior): each eligible baked payload
	 * field also becomes a `DEFINE_UI_PARAMS` slider. See
	 * `look-dctl/params.ts`'s `exposableNumber` for which fields qualify.
	 */
	readonly exposeAllParams?: boolean;
};

export type LookDctlExportResult =
	| {
			readonly ok: true;
			readonly asset: LookDctlExportAsset;
			readonly report: LookDctlReport;
	  }
	| { readonly ok: false; readonly reason: string };

const DCTL_MIME_TYPE = "text/plain";

/**
 * Resolves the effective Look Graph for a scene/artboard and lowers it to a
 * downloadable `.dctl` asset. Mirrors `resolveFrameEffectIntent`'s
 * artboard-then-scene precedence (the same resolution `appendFrameLookFilter`
 * in `features/export/model/svg.ts` uses) so "the Look this exports" always
 * matches "the Look the SVG/canvas path renders" for the same frame.
 */
export function exportLookAsDctl(
	scene: SceneDocument,
	options: LookDctlExportOptions = {},
): LookDctlExportResult {
	const resolved = resolveFrameEffectIntent(scene, options.artboardId);
	const graph = resolved.lookGraph;
	if (!graph) {
		return {
			ok: false,
			reason:
				"The current frame has no Look graph to export. Add a Look node (Grade, Posterize, Colorama, …) to this artboard or scene before exporting a DCTL.",
		};
	}
	const artboard =
		findArtboardById(scene, resolved.artboardId) ??
		selectCurrentArtboard(scene);
	const owner: LookGraphOwnerRef =
		resolved.lookGraphSource === "artboard"
			? { scope: "artboard", artboardId: resolved.artboardId }
			: { scope: "scene" };
	const plan = compileLookGraph(graph, {
		owner,
		bounds: { x: 0, y: 0, width: artboard.width, height: artboard.height },
	});
	const { source, report } = lowerLookGraphToDctl(graph, plan, {
		owner,
		exposeAllParams: options.exposeAllParams ?? false,
	});
	return {
		ok: true,
		asset: {
			fileName: `vecmo-look-${svgIdSegment(resolved.artboardId)}.dctl`,
			mimeType: DCTL_MIME_TYPE,
			contents: source,
		},
		report,
	};
}
