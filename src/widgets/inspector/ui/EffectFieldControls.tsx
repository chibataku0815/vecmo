import { useMemo, useState } from "react";
import {
	EFFECT_FIELD_TARGET_DESCRIPTORS,
	type EffectFieldTargetDescriptor,
} from "@/entities/scene/model/effect-field-routing";
import { isTopLevelSceneNode } from "@/entities/scene/model/selectors";
import { useSceneStore } from "@/entities/scene/model/store";
import type { SceneDocument } from "@/entities/scene/model/types";
import {
	commitNodeEffectFieldCommand,
	createLinkNodeEffectFieldCommand,
	createRemoveNodeEffectFieldCommand,
	createSetNodeEffectFieldModeCommand,
	createUnlinkNodeEffectFieldCommand,
	createUpdateNodeEffectFieldInfluenceCommand,
	createUpdateNodeEffectFieldSourceCommand,
	EFFECT_FIELD_AUTHORING_MODES,
	nodeEffectFieldEditingState,
	useEffectFieldEditorStore,
} from "@/features/effect-authoring/model";
import { useToolSelectionStore } from "@/features/tool-selection/model/store";
import {
	scalarEffectFieldMeshPointAt,
	setScalarEffectFieldMeshPointValue,
} from "@/shared/effect-field";

const modeLabels = {
	contourGradient: "Contour",
	linearGradient: "Linear",
	radialGradient: "Radial",
	rect: "Rect",
	fieldMesh: "Mesh",
} as const;

const fieldTargets = EFFECT_FIELD_TARGET_DESCRIPTORS.filter((descriptor) =>
	descriptor.targetScopes.some(
		(scope) => scope === "object" || scope === "group",
	),
);

const controlClass =
	"h-6 min-w-0 rounded border border-hairline/10 bg-surface-sunken px-1.5 text-ui text-fg outline-none focus:border-accent disabled:cursor-not-allowed disabled:text-fg-subtle";
const buttonClass =
	"h-6 rounded border border-hairline/10 bg-hairline/5 px-1.5 text-ui text-fg-muted hover:bg-hairline/10 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40";
const activeButtonClass = "border-accent bg-accent-surface text-accent-fg";

function NumberControl({
	label,
	value,
	min,
	max,
	step = 0.01,
	disabled,
	onCommit,
}: {
	readonly label: string;
	readonly value: number;
	readonly min?: number;
	readonly max?: number;
	readonly step?: number;
	readonly disabled?: boolean;
	readonly onCommit: (value: number) => void;
}) {
	return (
		<label className="grid min-w-0 grid-cols-[4.5rem_1fr] items-center gap-1 text-ui text-fg-muted">
			<span className="truncate">{label}</span>
			<input
				key={`${label}:${value}`}
				type="number"
				defaultValue={value}
				min={min}
				max={max}
				step={step}
				disabled={disabled}
				className={controlClass}
				onKeyDown={(event) => {
					if (event.key === "Enter") event.currentTarget.blur();
				}}
				onBlur={(event) => {
					const next = Number(event.currentTarget.value);
					if (Number.isFinite(next)) onCommit(next);
				}}
			/>
		</label>
	);
}

const descriptorDisabled = (
	descriptor: EffectFieldTargetDescriptor,
): boolean => {
	const status = descriptor.support["editor-svg"].status;
	return (
		Boolean(descriptor.disabledReason) ||
		(status !== "native" && status !== "approximated")
	);
};

const descriptorLimitLabel = (
	descriptor: EffectFieldTargetDescriptor,
): string | null => {
	if (descriptor.disabledReason) return "unsupported";
	const status = descriptor.support["editor-svg"].status;
	return status === "native" || status === "approximated" ? null : status;
};

export function EffectFieldControls({
	document,
	nodeId,
}: {
	readonly document: SceneDocument;
	readonly nodeId: string;
}) {
	const descriptorId = useEffectFieldEditorStore((state) => state.descriptorId);
	const setDescriptorId = useEffectFieldEditorStore(
		(state) => state.setDescriptorId,
	);
	const meshPointSelection = useEffectFieldEditorStore(
		(state) => state.meshPoint,
	);
	const noticeKey = `${nodeId}:${descriptorId}`;
	const [noticeState, setNoticeState] = useState<{
		readonly key: string;
		readonly message: string;
	} | null>(null);
	const notice = noticeState?.key === noticeKey ? noticeState.message : null;
	const setNotice = (message: string | null): void =>
		setNoticeState(message === null ? null : { key: noticeKey, message });
	const state = useMemo(
		() => nodeEffectFieldEditingState(document, nodeId, descriptorId),
		[descriptorId, document, nodeId],
	);
	const assignment = state.assignment;
	const source = state.source;
	const run = (
		result: Parameters<typeof commitNodeEffectFieldCommand>[0],
		activateCanvas = false,
	): boolean => {
		if (result.kind === "blocked") {
			setNotice(result.reason);
			return false;
		}
		setNotice(null);
		const changed = commitNodeEffectFieldCommand(result);
		if ((changed || result.kind === "unchanged") && activateCanvas) {
			useToolSelectionStore.getState().setActiveTool("effect");
		}
		return changed;
	};
	const updateSource = (
		next: Parameters<typeof createUpdateNodeEffectFieldSourceCommand>[3],
	): boolean =>
		run(
			createUpdateNodeEffectFieldSourceCommand(
				useSceneStore.getState().document,
				nodeId,
				descriptorId,
				next,
			),
		);
	const updateInfluence = (
		patch: Parameters<typeof createUpdateNodeEffectFieldInfluenceCommand>[3],
	): boolean =>
		run(
			createUpdateNodeEffectFieldInfluenceCommand(
				useSceneStore.getState().document,
				nodeId,
				descriptorId,
				patch,
			),
		);
	const meshPoint =
		source?.kind === "fieldMesh" &&
		meshPointSelection?.nodeId === nodeId &&
		meshPointSelection.fieldId ===
			(state.field?.id ?? assignment?.fieldId ?? assignment?.id)
			? scalarEffectFieldMeshPointAt(
					source.fieldMesh,
					meshPointSelection.row,
					meshPointSelection.col,
				)
			: null;

	return (
		<div className="space-y-1">
			<label className="grid grid-cols-[4.5rem_1fr] items-center gap-1 text-ui text-fg-muted">
				<span>Target</span>
				<select
					value={descriptorId}
					className={controlClass}
					onChange={(event) => setDescriptorId(event.currentTarget.value)}
				>
					{fieldTargets.map((descriptor) => (
						<option
							key={descriptor.id}
							value={descriptor.id}
							disabled={descriptorDisabled(descriptor)}
						>
							{descriptor.label}
							{descriptorLimitLabel(descriptor)
								? ` — ${descriptorLimitLabel(descriptor)}`
								: ""}
						</option>
					))}
				</select>
			</label>

			<div className="grid grid-cols-5 gap-1">
				{EFFECT_FIELD_AUTHORING_MODES.map((mode) => (
					<button
						key={mode}
						type="button"
						disabled={Boolean(state.blockedReason)}
						className={`${buttonClass} ${source?.kind === mode ? activeButtonClass : ""}`}
						onClick={() =>
							run(
								createSetNodeEffectFieldModeCommand(
									useSceneStore.getState().document,
									nodeId,
									descriptorId,
									mode,
								),
								true,
							)
						}
					>
						{modeLabels[mode]}
					</button>
				))}
			</div>

			{assignment ? (
				<>
					<div className="grid grid-cols-2 gap-1">
						<label className="flex h-6 items-center gap-1 rounded border border-hairline/10 px-1.5 text-ui text-fg-muted">
							<input
								type="checkbox"
								checked={assignment.influence.enabled}
								onChange={(event) =>
									updateInfluence({ enabled: event.currentTarget.checked })
								}
							/>
							Enabled
						</label>
						<label className="flex h-6 items-center gap-1 rounded border border-hairline/10 px-1.5 text-ui text-fg-muted">
							<input
								type="checkbox"
								checked={assignment.influence.invert}
								onChange={(event) =>
									updateInfluence({ invert: event.currentTarget.checked })
								}
							/>
							Invert
						</label>
					</div>
					<NumberControl
						label="Strength"
						value={assignment.influence.strength}
						min={0}
						max={1}
						onCommit={(value) => updateInfluence({ strength: value })}
					/>
					<NumberControl
						label="Feather"
						value={assignment.influence.featherRadius}
						min={0}
						max={1}
						onCommit={(value) => updateInfluence({ featherRadius: value })}
					/>
					<label className="grid grid-cols-[4.5rem_1fr] items-center gap-1 text-ui text-fg-muted">
						<span>Falloff</span>
						<select
							value={assignment.influence.falloff.kind}
							className={controlClass}
							onChange={(event) =>
								updateInfluence({
									falloff: {
										kind: event.currentTarget
											.value as typeof assignment.influence.falloff.kind,
									},
								})
							}
						>
							<option value="linear">Linear</option>
							<option value="smoothstep">Smoothstep</option>
							<option value="gamma">Gamma</option>
							<option value="threshold">Threshold</option>
						</select>
					</label>
					<div className="grid grid-cols-2 gap-1">
						<NumberControl
							label="Input min"
							value={assignment.influence.falloff.inputMin}
							min={0}
							max={1}
							onCommit={(value) =>
								updateInfluence({ falloff: { inputMin: value } })
							}
						/>
						<NumberControl
							label="Input max"
							value={assignment.influence.falloff.inputMax}
							min={0}
							max={1}
							onCommit={(value) =>
								updateInfluence({ falloff: { inputMax: value } })
							}
						/>
					</div>
					{assignment.influence.falloff.kind === "gamma" ? (
						<NumberControl
							label="Gamma"
							value={assignment.influence.falloff.gamma}
							min={0.01}
							max={8}
							onCommit={(value) =>
								updateInfluence({ falloff: { gamma: value } })
							}
						/>
					) : null}
					{assignment.influence.falloff.kind === "threshold" ? (
						<NumberControl
							label="Softness"
							value={assignment.influence.falloff.softness}
							min={0}
							max={1}
							onCommit={(value) =>
								updateInfluence({ falloff: { softness: value } })
							}
						/>
					) : null}

					{source?.kind === "contourGradient" ? (
						<>
							<NumberControl
								label="Width"
								value={source.width}
								min={0.001}
								max={1}
								onCommit={(value) => updateSource({ ...source, width: value })}
							/>
							<label className="grid grid-cols-[4.5rem_1fr] items-center gap-1 text-ui text-fg-muted">
								<span>Side</span>
								<select
									value={source.side}
									className={controlClass}
									onChange={(event) =>
										updateSource({
											...source,
											side: event.currentTarget.value as typeof source.side,
										})
									}
								>
									<option value="inside">Inside</option>
									<option value="outside">Outside</option>
									<option value="both">Both</option>
								</select>
							</label>
						</>
					) : null}

					{source?.kind === "linearGradient" ? (
						<div className="grid grid-cols-2 gap-1">
							{(["x1", "y1", "x2", "y2"] as const).map((key) => (
								<NumberControl
									key={key}
									label={key.toUpperCase()}
									value={source[key]}
									min={0}
									max={1}
									onCommit={(value) =>
										updateSource({ ...source, [key]: value })
									}
								/>
							))}
						</div>
					) : null}

					{source?.kind === "radialGradient" ? (
						<div className="grid grid-cols-2 gap-1">
							{(["cx", "cy", "rx", "ry", "rotation"] as const).map((key) => (
								<NumberControl
									key={key}
									label={key.toUpperCase()}
									value={source[key]}
									min={key === "rotation" ? -Math.PI : 0}
									max={key === "rotation" ? Math.PI : 1}
									onCommit={(value) =>
										updateSource({ ...source, [key]: value })
									}
								/>
							))}
						</div>
					) : null}

					{source?.kind === "rect" ? (
						<div className="grid grid-cols-2 gap-1">
							{(
								[
									"x",
									"y",
									"width",
									"height",
									"cornerRadius",
									"rotation",
								] as const
							).map((key) => (
								<NumberControl
									key={key}
									label={key}
									value={source[key]}
									min={key === "rotation" ? -Math.PI : 0}
									max={key === "rotation" ? Math.PI : 1}
									onCommit={(value) =>
										updateSource({ ...source, [key]: value })
									}
								/>
							))}
						</div>
					) : null}

					{source?.kind === "fieldMesh" ? (
						<div className="space-y-1 rounded border border-hairline/10 bg-surface-sunken p-1.5 text-ui text-fg-muted">
							<div className="flex items-center justify-between">
								<span>Mesh</span>
								<span className="font-mono text-fg-subtle">
									{source.fieldMesh.cols}×{source.fieldMesh.rows}
								</span>
							</div>
							{meshPoint && meshPointSelection ? (
								<NumberControl
									label={`P ${meshPointSelection.col + 1},${meshPointSelection.row + 1}`}
									value={meshPoint.value}
									min={0}
									max={1}
									onCommit={(value) =>
										updateSource({
											...source,
											fieldMesh: setScalarEffectFieldMeshPointValue(
												source.fieldMesh,
												meshPointSelection.row,
												meshPointSelection.col,
												value,
											),
										})
									}
								/>
							) : (
								<div className="text-fg-subtle">
									Select a canvas point to edit its value. Double-click a patch
									to subdivide; Delete removes interior lines.
								</div>
							)}
						</div>
					) : null}

					<label className="grid grid-cols-[4.5rem_1fr] items-center gap-1 text-ui text-fg-muted">
						<span>Shared</span>
						<select
							value={assignment.fieldId ?? ""}
							className={controlClass}
							onChange={(event) => {
								const fieldId = event.currentTarget.value;
								run(
									fieldId
										? createLinkNodeEffectFieldCommand(
												useSceneStore.getState().document,
												nodeId,
												descriptorId,
												fieldId,
											)
										: createUnlinkNodeEffectFieldCommand(
												useSceneStore.getState().document,
												nodeId,
												descriptorId,
											),
								);
							}}
						>
							<option value="">Inline snapshot</option>
							{state.compatibleFields.map((field) => (
								<option key={field.id} value={field.id}>
									{field.label}
								</option>
							))}
						</select>
					</label>

					<div className="grid grid-cols-2 gap-1">
						<button
							type="button"
							disabled={!isTopLevelSceneNode(document, nodeId)}
							className={buttonClass}
							onClick={() =>
								useToolSelectionStore.getState().setActiveTool("effect")
							}
						>
							Edit on canvas
						</button>
						<button
							type="button"
							className={buttonClass}
							onClick={() =>
								run(
									createRemoveNodeEffectFieldCommand(
										useSceneStore.getState().document,
										nodeId,
										descriptorId,
									),
								)
							}
						>
							Remove
						</button>
					</div>
				</>
			) : null}

			<div className="rounded border border-hairline/10 bg-surface-sunken px-1.5 py-1 text-ui text-fg-subtle">
				{notice ??
					state.blockedReason ??
					`${state.descriptor?.support["editor-svg"].status ?? "unsupported"} · ${state.sourceOrigin ?? "no field"}`}
			</div>
			{state.routeIssues.slice(0, 2).map((issue) => (
				<div key={issue} className="text-ui text-danger-fg">
					{issue}
				</div>
			))}
		</div>
	);
}
