import type { SceneDocument, Vec2 } from "@/entities/scene/model/types";
import {
	applyPickedColorToSelection,
	type ColorPickApplyResult,
	type ColorPickSubSelection,
} from "../model/apply-color";
import {
	type ColorPickPaintRole,
	type ColorPickResult,
	pickSceneColorCandidate,
} from "../model/color-pick";
import { useColorPickToolStore } from "../model/tool-state";

type CanvasPoint = {
	readonly x: number;
	readonly y: number;
};

type PointerContext = {
	readonly point: CanvasPoint;
	readonly hitNodeId: string | null;
	readonly event: PointerEvent;
};

type HostApi = {
	readonly getDoc: () => SceneDocument;
	readonly selection: {
		readonly nodeIds: readonly string[];
		readonly primary: string | null;
		readonly sub?: ColorPickSubSelection;
	};
};

type EyedropperToolHandler = {
	readonly id: string;
	readonly tool: "eyedropper";
	readonly onPointerDown: (context: PointerContext, api: HostApi) => void;
};

const targetRoleFromEvent = (event: PointerEvent): ColorPickPaintRole =>
	event.shiftKey || event.altKey ? "stroke" : "fill";

const recordSample = (
	point: Vec2,
	targetRole: ColorPickPaintRole,
	pick: ColorPickResult,
	application: ColorPickApplyResult | null,
): void => {
	useColorPickToolStore.getState().setLastSample({
		point,
		targetRole,
		pick,
		application,
	});
};

const onPointerDown = (context: PointerContext, api: HostApi): void => {
	if (context.event.button !== 0) return;
	context.event.preventDefault();

	const targetRole = targetRoleFromEvent(context.event);
	const pick = pickSceneColorCandidate(api.getDoc(), context.point, {
		preferredRole: targetRole,
	});
	if (pick.kind !== "picked") {
		recordSample(context.point, targetRole, pick, null);
		return;
	}

	const application = applyPickedColorToSelection(
		pick.candidate,
		api.selection,
		{
			targetRole,
		},
	);
	recordSample(context.point, targetRole, pick, application);
};

export const handler: EyedropperToolHandler = {
	id: "color-pick-eyedropper",
	tool: "eyedropper",
	onPointerDown,
};
