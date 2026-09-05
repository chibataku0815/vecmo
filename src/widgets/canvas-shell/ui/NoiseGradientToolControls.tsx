import { type CSSProperties, useRef } from "react";
import {
	beginGestureTransaction,
	commitGestureTransaction,
	type GestureTransaction,
} from "@/entities/scene/model/gesture-transaction";
import type { SceneDocument } from "@/entities/scene/model/types";
import {
	commitNoiseGradientToolAngle,
	commitNoiseGradientToolExtent,
	commitNoiseGradientToolFieldMeshDensity,
	noiseGradientToolControlState,
} from "@/features/noise-gradient/model/tool-controls";
import { ScrubSlider } from "@/shared/ui/ScrubSlider";

type NoiseGradientToolControlsProps = {
	readonly document: SceneDocument;
	readonly selection: {
		readonly nodeIds: readonly string[];
		readonly primary: string | null;
		readonly sub?:
			| {
					readonly nodeId: string;
					readonly kind: "noise-field-mesh-point";
					readonly row: number;
					readonly col: number;
			  }
			| {
					readonly nodeId: string;
					readonly kind: string;
			  }
			| null;
	};
	readonly style: CSSProperties;
};

type NoiseFieldMeshSub = Extract<
	NonNullable<NoiseGradientToolControlsProps["selection"]["sub"]>,
	{ readonly kind: "noise-field-mesh-point" }
>;

const isNoiseFieldMeshSub = (
	sub: NoiseGradientToolControlsProps["selection"]["sub"],
): sub is NoiseFieldMeshSub =>
	sub?.kind === "noise-field-mesh-point" &&
	typeof (sub as { readonly row?: unknown }).row === "number" &&
	typeof (sub as { readonly col?: unknown }).col === "number";

const ANGLE_LABEL = "Edit Noise Gradient angle";
const EXTENT_LABEL = "Edit Noise Gradient extent";
const DENSITY_LABEL = "Edit Noise Gradient mesh density";

function percent(value: number): string {
	return `${Math.round(value)}%`;
}

export function NoiseGradientToolControls({
	document,
	selection,
	style,
}: NoiseGradientToolControlsProps) {
	const angleGestureRef = useRef<GestureTransaction | null>(null);
	const extentGestureRef = useRef<GestureTransaction | null>(null);
	const densityGestureRef = useRef<GestureTransaction | null>(null);
	const state = noiseGradientToolControlState(document, selection);
	if (!state?.editable) return null;
	const linearMode = state.fieldMode === "linear";
	const meshMode = state.fieldMode === "mesh";
	const sub = selection.sub;
	const fieldMesh = state.texture.material.fieldMesh;
	const selectedFieldPoint =
		meshMode &&
		isNoiseFieldMeshSub(sub) &&
		sub.nodeId === state.nodeId &&
		fieldMesh
			? fieldMesh.points[sub.row * fieldMesh.cols + sub.col]
			: null;
	const showExtent = !meshMode || !selectedFieldPoint;

	return (
		<div
			className="pointer-events-auto absolute z-30 w-56 rounded-md border border-white/10 bg-surface-raised/90 p-1 text-fg shadow-xl shadow-black/30 backdrop-blur-xl"
			onPointerDown={(event) => event.stopPropagation()}
			onPointerMove={(event) => event.stopPropagation()}
			onPointerUp={(event) => event.stopPropagation()}
			style={style}
		>
			<div className="space-y-1">
				{linearMode ? (
					<ScrubSlider
						label="Angle"
						value={state.angle}
						min={0}
						max={360}
						neutral={0}
						step={1}
						unit="°"
						onScrubStart={() => {
							angleGestureRef.current = beginGestureTransaction(
								`noise-gradient-tool:${state.nodeId}:angle`,
								ANGLE_LABEL,
							);
						}}
						onScrub={(next) => commitNoiseGradientToolAngle(state.nodeId, next)}
						onScrubEnd={() => {
							if (angleGestureRef.current) {
								commitGestureTransaction(angleGestureRef.current);
								angleGestureRef.current = null;
							}
						}}
						onCommitValue={(next) =>
							commitNoiseGradientToolAngle(state.nodeId, next)
						}
					/>
				) : null}
				{showExtent ? (
					<ScrubSlider
						label="Extent"
						value={state.extent * 100}
						min={0}
						max={100}
						neutral={90}
						step={1}
						unit="%"
						disabled={!state.editable}
						format={percent}
						onScrubStart={() => {
							extentGestureRef.current = beginGestureTransaction(
								`noise-gradient-tool:${state.nodeId}:extent`,
								EXTENT_LABEL,
							);
						}}
						onScrub={(next) =>
							commitNoiseGradientToolExtent(state.nodeId, next / 100)
						}
						onScrubEnd={() => {
							if (extentGestureRef.current) {
								commitGestureTransaction(extentGestureRef.current);
								extentGestureRef.current = null;
							}
						}}
						onCommitValue={(next) =>
							commitNoiseGradientToolExtent(state.nodeId, next / 100)
						}
					/>
				) : null}
				{meshMode && selectedFieldPoint ? (
					<ScrubSlider
						label="Density"
						value={selectedFieldPoint.density * 100}
						min={0}
						max={100}
						neutral={50}
						step={1}
						unit="%"
						format={percent}
						onScrubStart={() => {
							if (!isNoiseFieldMeshSub(sub)) return;
							densityGestureRef.current = beginGestureTransaction(
								`noise-gradient-tool:${state.nodeId}:mesh-density:${sub.row}:${sub.col}`,
								DENSITY_LABEL,
							);
						}}
						onScrub={(next) => {
							if (!isNoiseFieldMeshSub(sub)) return;
							commitNoiseGradientToolFieldMeshDensity(
								state.nodeId,
								sub.row,
								sub.col,
								next / 100,
							);
						}}
						onScrubEnd={() => {
							if (densityGestureRef.current) {
								commitGestureTransaction(densityGestureRef.current);
								densityGestureRef.current = null;
							}
						}}
						onCommitValue={(next) => {
							if (!isNoiseFieldMeshSub(sub)) return;
							commitNoiseGradientToolFieldMeshDensity(
								state.nodeId,
								sub.row,
								sub.col,
								next / 100,
							);
						}}
					/>
				) : null}
			</div>
		</div>
	);
}
