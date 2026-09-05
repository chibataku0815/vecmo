import { Diamond } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import {
	findSourceOpticsTrack,
	removeSourceOpticsKeyframe,
	removeSourceOpticsTrack,
	snapMotionFrame,
	upsertSourceOpticsKeyframe,
} from "@/entities/motion/model/commands";
import { effectiveSourceOpticsParameter } from "@/entities/motion/model/sampler";
import { useMotionStore } from "@/entities/motion/model/store";
import {
	findArtboardById,
	findNode,
	selectCurrentArtboard,
	selectNodeArtboardMapping,
} from "@/entities/scene/model/selectors";
import {
	type SourceOpticsParameterTarget,
	sourceOpticsRigsForArtboard,
	sourceOpticsTargetHasMicrostructure,
} from "@/entities/scene/model/source-optics";
import {
	createAddSourceOpticsRigCommand,
	createBindSourceOpticsResponseCommand,
	createRemoveSourceOpticsRigCommand,
	createUnbindSourceOpticsResponseCommand,
	createUpdateSourceOpticsResponseCommand,
	createUpdateSourceOpticsRigCommand,
	type SourceOpticsResponsePatch,
	type SourceOpticsRigPatch,
} from "@/entities/scene/model/source-optics-commands";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	SceneDocument,
	SourceOpticsResponseBinding,
	SourceOpticsRigContract,
} from "@/entities/scene/model/types";
import { useTransportStore } from "@/features/motion/model/transport-store";

const controlClass =
	"h-6 min-w-0 rounded border border-hairline/10 bg-surface-sunken px-1.5 text-ui text-fg outline-none focus:border-accent disabled:cursor-not-allowed disabled:text-fg-subtle";
const buttonClass =
	"h-6 rounded border border-hairline/10 bg-hairline/5 px-1.5 text-ui text-fg-muted hover:bg-hairline/10 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40";

const formatControlValue = (value: number): string =>
	String(Number(value.toFixed(4)));

function NumberControl({
	label,
	value,
	min = 0,
	max,
	step = 0.1,
	target,
	onCommit,
}: {
	readonly label: string;
	readonly value: number;
	readonly min?: number;
	readonly max?: number;
	readonly step?: number;
	readonly target: SourceOpticsParameterTarget;
	readonly onCommit: (value: number) => void;
}) {
	const motion = useMotionStore((state) => state.document);
	const currentFrame = useTransportStore((state) => state.currentFrame);
	const recording = useTransportStore((state) => state.recording);
	const track = findSourceOpticsTrack(motion, target);
	const frame = snapMotionFrame(currentFrame, motion.durationFrames);
	const animated = (track?.keyframes.length ?? 0) > 0;
	const keyedAtFrame =
		track?.keyframes.some((keyframe) => keyframe.time === frame) ?? false;
	const sampledValue = effectiveSourceOpticsParameter(
		motion,
		target,
		value,
		frame,
	);
	const commit = (next: number): void => {
		if (recording || animated) {
			useMotionStore
				.getState()
				.apply(upsertSourceOpticsKeyframe(target, frame, next));
			return;
		}
		onCommit(next);
	};
	return (
		<div className="grid min-w-0 grid-cols-[4.5rem_1fr_1.25rem] items-center gap-1 text-ui text-fg-muted">
			<span className="truncate">{label}</span>
			<input
				key={`${label}:${sampledValue}:${track?.id ?? "static"}`}
				aria-label={label}
				type="number"
				defaultValue={formatControlValue(sampledValue)}
				min={min}
				max={max}
				step={step}
				className={controlClass}
				onKeyDown={(event) => {
					if (event.key === "Enter") event.currentTarget.blur();
				}}
				onBlur={(event) => {
					const next = Number(event.currentTarget.value);
					if (Number.isFinite(next)) commit(next);
				}}
			/>
			<button
				type="button"
				aria-label={
					keyedAtFrame ? `Remove ${label} keyframe` : `Add ${label} keyframe`
				}
				title={
					keyedAtFrame
						? `Remove keyframe at ${frame}f`
						: `Add keyframe at ${frame}f`
				}
				className={`grid size-5 place-items-center rounded text-fg-subtle hover:bg-hairline/10 hover:text-fg ${
					animated ? "text-accent-fg" : ""
				}`}
				onClick={() =>
					useMotionStore
						.getState()
						.apply(
							keyedAtFrame
								? removeSourceOpticsKeyframe(target, frame)
								: upsertSourceOpticsKeyframe(target, frame, sampledValue),
						)
				}
			>
				<Diamond size={11} weight={keyedAtFrame ? "fill" : "regular"} />
			</button>
		</div>
	);
}

const rigTarget = (
	artboardId: string,
	rigId: string,
	parameterId: string,
): SourceOpticsParameterTarget => ({
	kind: "rig",
	artboardId,
	rigId,
	parameterId,
});

const rayTarget = (
	artboardId: string,
	rigId: string,
	rayId: string,
	parameterId: string,
): SourceOpticsParameterTarget => ({
	kind: "ray",
	artboardId,
	rigId,
	rayId,
	parameterId,
});

const bindingTarget = (
	artboardId: string,
	rigId: string,
	bindingId: string,
	parameterId: string,
): SourceOpticsParameterTarget => ({
	kind: "binding",
	artboardId,
	rigId,
	bindingId,
	parameterId,
});

const removeSourceOpticsAnimations = (
	predicate: (target: SourceOpticsParameterTarget) => boolean,
	label: string,
): void => {
	const store = useMotionStore.getState();
	const trackIds = (store.document.sourceOpticsTracks ?? [])
		.filter((track) => predicate(track.target))
		.map((track) => track.id);
	if (trackIds.length === 0) return;
	store.beginTransaction(`source-optics-animation:${label}`, label);
	for (const trackId of trackIds) store.apply(removeSourceOpticsTrack(trackId));
	store.commit();
};

function Toggle({
	label,
	checked,
	onChange,
}: {
	readonly label: string;
	readonly checked: boolean;
	readonly onChange: (checked: boolean) => void;
}) {
	return (
		<label className="flex h-6 items-center justify-between gap-2 text-ui text-fg-muted">
			<span>{label}</span>
			<input
				type="checkbox"
				checked={checked}
				onChange={(event) => onChange(event.currentTarget.checked)}
			/>
		</label>
	);
}

const applyRigPatch = (
	artboardId: string,
	rigId: string,
	patch: SourceOpticsRigPatch,
): void => {
	useSceneStore.getState().apply(
		createUpdateSourceOpticsRigCommand(artboardId, rigId, patch, {
			coalesceKey: `source-optics:${rigId}`,
		}),
	);
};

const applyResponsePatch = (
	artboardId: string,
	rigId: string,
	bindingId: string,
	patch: SourceOpticsResponsePatch,
): void => {
	useSceneStore
		.getState()
		.apply(
			createUpdateSourceOpticsResponseCommand(
				artboardId,
				rigId,
				bindingId,
				patch,
				{ coalesceKey: `source-optics-response:${bindingId}` },
			),
		);
};

function SourceRigControls({
	artboardId,
	rig,
}: {
	readonly artboardId: string;
	readonly rig: SourceOpticsRigContract;
}) {
	const firstRay = rig.rays?.[0];
	return (
		<div className="space-y-1">
			<Toggle
				label="Enabled"
				checked={rig.enabled}
				onChange={(enabled) => applyRigPatch(artboardId, rig.id, { enabled })}
			/>
			<div className="truncate text-ui text-fg-subtle">
				Core stays on the selected node
			</div>
			<Toggle
				label="Bloom"
				checked={rig.bloom.enabled}
				onChange={(enabled) =>
					applyRigPatch(artboardId, rig.id, { bloom: { enabled } })
				}
			/>
			<NumberControl
				label="Bloom X"
				value={rig.bloom.radiusX}
				target={rigTarget(artboardId, rig.id, "source-optics.bloom.radius-x")}
				onCommit={(radiusX) =>
					applyRigPatch(artboardId, rig.id, { bloom: { radiusX } })
				}
			/>
			{rig.bloom.radiusY === undefined ? (
				<button
					type="button"
					className={buttonClass}
					onClick={() =>
						applyRigPatch(artboardId, rig.id, {
							bloom: { radiusY: rig.bloom.radiusX },
						})
					}
				>
					Unlink bloom axes
				</button>
			) : (
				<>
					<NumberControl
						label="Bloom Y"
						value={rig.bloom.radiusY}
						target={rigTarget(
							artboardId,
							rig.id,
							"source-optics.bloom.radius-y",
						)}
						onCommit={(radiusY) =>
							applyRigPatch(artboardId, rig.id, { bloom: { radiusY } })
						}
					/>
					<button
						type="button"
						className={buttonClass}
						onClick={() => {
							removeSourceOpticsAnimations(
								(target) =>
									target.kind === "rig" &&
									target.artboardId === artboardId &&
									target.rigId === rig.id &&
									target.parameterId === "source-optics.bloom.radius-y",
								"Link bloom axes",
							);
							applyRigPatch(artboardId, rig.id, {
								bloom: { radiusY: null },
							});
						}}
					>
						Link bloom axes
					</button>
				</>
			)}
			<NumberControl
				label="Bloom mix"
				value={rig.bloom.intensity}
				target={rigTarget(artboardId, rig.id, "source-optics.bloom.intensity")}
				min={0}
				max={8}
				step={0.05}
				onCommit={(intensity) =>
					applyRigPatch(artboardId, rig.id, { bloom: { intensity } })
				}
			/>
			<NumberControl
				label="Threshold"
				value={rig.bloom.threshold}
				target={rigTarget(artboardId, rig.id, "source-optics.bloom.threshold")}
				max={1}
				step={0.01}
				onCommit={(threshold) =>
					applyRigPatch(artboardId, rig.id, { bloom: { threshold } })
				}
			/>
			{firstRay ? (
				<>
					<Toggle
						label="Ray"
						checked={firstRay.enabled}
						onChange={(enabled) =>
							applyRigPatch(artboardId, rig.id, {
								rays: (rig.rays ?? []).map((ray, index) =>
									index === 0 ? { ...ray, enabled } : ray,
								),
							})
						}
					/>
					<NumberControl
						label="Ray angle"
						value={firstRay.angle}
						target={rayTarget(
							artboardId,
							rig.id,
							firstRay.id,
							"source-optics.ray.angle",
						)}
						max={360}
						step={1}
						onCommit={(angle) =>
							applyRigPatch(artboardId, rig.id, {
								rays: (rig.rays ?? []).map((ray, index) =>
									index === 0 ? { ...ray, angle } : ray,
								),
							})
						}
					/>
					<NumberControl
						label="Ray length"
						value={firstRay.length}
						target={rayTarget(
							artboardId,
							rig.id,
							firstRay.id,
							"source-optics.ray.length",
						)}
						onCommit={(length) =>
							applyRigPatch(artboardId, rig.id, {
								rays: (rig.rays ?? []).map((ray, index) =>
									index === 0 ? { ...ray, length } : ray,
								),
							})
						}
					/>
					<NumberControl
						label="Ray width"
						value={firstRay.width}
						target={rayTarget(
							artboardId,
							rig.id,
							firstRay.id,
							"source-optics.ray.width",
						)}
						onCommit={(width) =>
							applyRigPatch(artboardId, rig.id, {
								rays: (rig.rays ?? []).map((ray, index) =>
									index === 0 ? { ...ray, width } : ray,
								),
							})
						}
					/>
					<NumberControl
						label="Ray mix"
						value={firstRay.intensity}
						target={rayTarget(
							artboardId,
							rig.id,
							firstRay.id,
							"source-optics.ray.intensity",
						)}
						min={0}
						max={8}
						step={0.05}
						onCommit={(intensity) =>
							applyRigPatch(artboardId, rig.id, {
								rays: (rig.rays ?? []).map((ray, index) =>
									index === 0 ? { ...ray, intensity } : ray,
								),
							})
						}
					/>
					<NumberControl
						label="Ray falloff"
						value={firstRay.falloff}
						target={rayTarget(
							artboardId,
							rig.id,
							firstRay.id,
							"source-optics.ray.falloff",
						)}
						max={1}
						step={0.01}
						onCommit={(falloff) =>
							applyRigPatch(artboardId, rig.id, {
								rays: (rig.rays ?? []).map((ray, index) =>
									index === 0 ? { ...ray, falloff } : ray,
								),
							})
						}
					/>
					<NumberControl
						label="Ray reverse"
						value={firstRay.oppositeSideRatio}
						target={rayTarget(
							artboardId,
							rig.id,
							firstRay.id,
							"source-optics.ray.opposite-side-ratio",
						)}
						max={1}
						step={0.01}
						onCommit={(oppositeSideRatio) =>
							applyRigPatch(artboardId, rig.id, {
								rays: (rig.rays ?? []).map((ray, index) =>
									index === 0 ? { ...ray, oppositeSideRatio } : ray,
								),
							})
						}
					/>
				</>
			) : null}
			{rig.atmosphere ? (
				<>
					<Toggle
						label="Atmosphere"
						checked={rig.atmosphere.enabled}
						onChange={(enabled) =>
							applyRigPatch(artboardId, rig.id, {
								atmosphere: { enabled },
							})
						}
					/>
					<NumberControl
						label="Atmos mix"
						value={rig.atmosphere.mix}
						target={rigTarget(
							artboardId,
							rig.id,
							"source-optics.atmosphere.mix",
						)}
						min={0}
						max={1}
						step={0.01}
						onCommit={(mix) =>
							applyRigPatch(artboardId, rig.id, { atmosphere: { mix } })
						}
					/>
					<NumberControl
						label="Atmos falloff"
						value={rig.atmosphere.falloff}
						target={rigTarget(
							artboardId,
							rig.id,
							"source-optics.atmosphere.falloff",
						)}
						max={1}
						step={0.01}
						onCommit={(falloff) =>
							applyRigPatch(artboardId, rig.id, {
								atmosphere: { falloff },
							})
						}
					/>
					<NumberControl
						label="Spill reach"
						value={rig.atmosphere.reach}
						target={rigTarget(
							artboardId,
							rig.id,
							"source-optics.atmosphere.reach",
						)}
						onCommit={(reach) =>
							applyRigPatch(artboardId, rig.id, {
								atmosphere: { reach },
							})
						}
					/>
				</>
			) : null}
			{rig.lens ? (
				<>
					<Toggle
						label="Lens"
						checked={rig.lens.enabled}
						onChange={(enabled) =>
							applyRigPatch(artboardId, rig.id, { lens: { enabled } })
						}
					/>
					<NumberControl
						label="Lens mix"
						value={rig.lens.mix}
						target={rigTarget(artboardId, rig.id, "source-optics.lens.mix")}
						max={1}
						step={0.01}
						onCommit={(mix) =>
							applyRigPatch(artboardId, rig.id, { lens: { mix } })
						}
					/>
					<NumberControl
						label="Lens chroma"
						value={rig.lens.chroma}
						target={rigTarget(artboardId, rig.id, "source-optics.lens.chroma")}
						onCommit={(chroma) =>
							applyRigPatch(artboardId, rig.id, { lens: { chroma } })
						}
					/>
					<NumberControl
						label="Lens reach"
						value={rig.lens.reach}
						target={rigTarget(artboardId, rig.id, "source-optics.lens.reach")}
						onCommit={(reach) =>
							applyRigPatch(artboardId, rig.id, { lens: { reach } })
						}
					/>
				</>
			) : null}
			<div className="text-ui text-fg-subtle">
				{rig.responses.length} target response
				{rig.responses.length === 1 ? "" : "s"}
			</div>
			<button
				type="button"
				className={buttonClass}
				onClick={() => {
					removeSourceOpticsAnimations(
						(target) =>
							target.artboardId === artboardId && target.rigId === rig.id,
						"Remove source optics",
					);
					useSceneStore
						.getState()
						.apply(createRemoveSourceOpticsRigCommand(artboardId, rig.id));
				}}
			>
				Remove rig
			</button>
		</div>
	);
}

function ResponseControls({
	artboardId,
	rig,
	binding,
	hasExistingMicrostructure,
}: {
	readonly artboardId: string;
	readonly rig: SourceOpticsRigContract;
	readonly binding: SourceOpticsResponseBinding;
	readonly hasExistingMicrostructure: boolean;
}) {
	const surface = binding.surface;
	const diffusion = binding.diffusion;
	return (
		<div className="space-y-1">
			<div className="truncate text-ui text-fg-subtle">Source: {rig.name}</div>
			<Toggle
				label="Enabled"
				checked={binding.enabled}
				onChange={(enabled) =>
					applyResponsePatch(artboardId, rig.id, binding.id, { enabled })
				}
			/>
			{surface ? (
				<>
					<NumberControl
						label="Surface"
						value={surface.amount}
						target={bindingTarget(
							artboardId,
							rig.id,
							binding.id,
							"source-optics.surface.amount",
						)}
						max={1}
						step={0.01}
						onCommit={(amount) =>
							applyResponsePatch(artboardId, rig.id, binding.id, {
								surface: { amount },
							})
						}
					/>
					<NumberControl
						label="Surface soft"
						value={surface.softness}
						target={bindingTarget(
							artboardId,
							rig.id,
							binding.id,
							"source-optics.surface.softness",
						)}
						onCommit={(softness) =>
							applyResponsePatch(artboardId, rig.id, binding.id, {
								surface: { softness },
							})
						}
					/>
					<NumberControl
						label="Surface width"
						value={surface.width}
						target={bindingTarget(
							artboardId,
							rig.id,
							binding.id,
							"source-optics.surface.width",
						)}
						onCommit={(width) =>
							applyResponsePatch(artboardId, rig.id, binding.id, {
								surface: { width },
							})
						}
					/>
				</>
			) : null}
			{diffusion ? (
				<>
					<NumberControl
						label="Diffusion"
						value={diffusion.amount}
						target={bindingTarget(
							artboardId,
							rig.id,
							binding.id,
							"source-optics.diffusion.amount",
						)}
						max={1}
						step={0.01}
						onCommit={(amount) =>
							applyResponsePatch(artboardId, rig.id, binding.id, {
								diffusion: { amount },
							})
						}
					/>
					<NumberControl
						label="Depth"
						value={diffusion.depth}
						target={bindingTarget(
							artboardId,
							rig.id,
							binding.id,
							"source-optics.diffusion.depth",
						)}
						onCommit={(depth) =>
							applyResponsePatch(artboardId, rig.id, binding.id, {
								diffusion: { depth },
							})
						}
					/>
					<NumberControl
						label="Diffuse soft"
						value={diffusion.softness}
						target={bindingTarget(
							artboardId,
							rig.id,
							binding.id,
							"source-optics.diffusion.softness",
						)}
						onCommit={(softness) =>
							applyResponsePatch(artboardId, rig.id, binding.id, {
								diffusion: { softness },
							})
						}
					/>
				</>
			) : null}
			<button
				type="button"
				className={buttonClass}
				onClick={() => {
					if (binding.edge) {
						removeSourceOpticsAnimations(
							(target) =>
								target.kind === "binding" &&
								target.bindingId === binding.id &&
								target.parameterId.startsWith("source-optics.edge."),
							"Remove Source Optics edge animation",
						);
					}
					applyResponsePatch(artboardId, rig.id, binding.id, {
						edge: binding.edge
							? null
							: { amount: 0.22, width: surface?.width ?? 8, softness: 2 },
					});
				}}
			>
				{binding.edge ? "Disable edge" : "Enable edge"}
			</button>
			{binding.edge ? (
				<>
					<NumberControl
						label="Edge"
						value={binding.edge.amount}
						max={1}
						step={0.01}
						target={bindingTarget(
							artboardId,
							rig.id,
							binding.id,
							"source-optics.edge.amount",
						)}
						onCommit={(amount) =>
							applyResponsePatch(artboardId, rig.id, binding.id, {
								edge: { amount },
							})
						}
					/>
					<NumberControl
						label="Edge width"
						value={binding.edge.width}
						target={bindingTarget(
							artboardId,
							rig.id,
							binding.id,
							"source-optics.edge.width",
						)}
						onCommit={(width) =>
							applyResponsePatch(artboardId, rig.id, binding.id, {
								edge: { width },
							})
						}
					/>
					<NumberControl
						label="Edge soft"
						value={binding.edge.softness}
						target={bindingTarget(
							artboardId,
							rig.id,
							binding.id,
							"source-optics.edge.softness",
						)}
						onCommit={(softness) =>
							applyResponsePatch(artboardId, rig.id, binding.id, {
								edge: { softness },
							})
						}
					/>
				</>
			) : null}
			<button
				type="button"
				className={buttonClass}
				disabled={!binding.microstructure && !hasExistingMicrostructure}
				onClick={() => {
					if (binding.microstructure) {
						removeSourceOpticsAnimations(
							(target) =>
								target.kind === "binding" &&
								target.bindingId === binding.id &&
								target.parameterId === "source-optics.microstructure.amount",
							"Remove Source Optics texture animation",
						);
					}
					applyResponsePatch(artboardId, rig.id, binding.id, {
						microstructure: binding.microstructure ? null : { amount: 0.25 },
					});
				}}
			>
				{binding.microstructure
					? "Disable texture coupling"
					: "Couple existing texture"}
			</button>
			{!hasExistingMicrostructure ? (
				<div className="text-ui text-fg-subtle">
					Add object texture before coupling microstructure.
				</div>
			) : null}
			{binding.microstructure ? (
				<NumberControl
					label="Texture mix"
					value={binding.microstructure.amount}
					target={bindingTarget(
						artboardId,
						rig.id,
						binding.id,
						"source-optics.microstructure.amount",
					)}
					max={1}
					step={0.01}
					onCommit={(amount) =>
						applyResponsePatch(artboardId, rig.id, binding.id, {
							microstructure: { amount },
						})
					}
				/>
			) : null}
			<button
				type="button"
				className={buttonClass}
				onClick={() => {
					if (binding.spectral) {
						removeSourceOpticsAnimations(
							(target) =>
								target.kind === "binding" &&
								target.bindingId === binding.id &&
								target.parameterId.startsWith("source-optics.spectral."),
							"Remove Source Optics spectral animation",
						);
					}
					applyResponsePatch(artboardId, rig.id, binding.id, {
						spectral: binding.spectral ? null : { amount: 0.12, offset: 2 },
					});
				}}
			>
				{binding.spectral ? "Disable spectral" : "Enable spectral"}
			</button>
			{binding.spectral ? (
				<>
					<NumberControl
						label="Spectral mix"
						value={binding.spectral.amount}
						target={bindingTarget(
							artboardId,
							rig.id,
							binding.id,
							"source-optics.spectral.amount",
						)}
						max={1}
						step={0.01}
						onCommit={(amount) =>
							applyResponsePatch(artboardId, rig.id, binding.id, {
								spectral: { amount },
							})
						}
					/>
					<NumberControl
						label="Spectral px"
						value={binding.spectral.offset}
						target={bindingTarget(
							artboardId,
							rig.id,
							binding.id,
							"source-optics.spectral.offset",
						)}
						onCommit={(offset) =>
							applyResponsePatch(artboardId, rig.id, binding.id, {
								spectral: { offset },
							})
						}
					/>
				</>
			) : null}
			<button
				type="button"
				className={buttonClass}
				onClick={() => {
					removeSourceOpticsAnimations(
						(target) =>
							target.kind === "binding" && target.bindingId === binding.id,
						"Remove Source Optics response animation",
					);
					useSceneStore
						.getState()
						.apply(
							createUnbindSourceOpticsResponseCommand(
								artboardId,
								rig.id,
								binding.id,
							),
						);
				}}
			>
				Unbind response
			</button>
		</div>
	);
}

/** Compact source/target authoring projection for one selected node. */
export function SourceOpticsControls({
	document,
	nodeId,
}: {
	readonly document: SceneDocument;
	readonly nodeId: string;
}) {
	const [selectedRigId, setSelectedRigId] = useState<string>("");
	const state = useMemo(() => {
		const artboardId = selectNodeArtboardMapping(document).byNodeId[nodeId];
		const artboard =
			findArtboardById(document, artboardId) ?? selectCurrentArtboard(document);
		const rigs = sourceOpticsRigsForArtboard(artboard);
		const sourceRig = rigs.find((rig) => rig.sourceNodeId === nodeId) ?? null;
		const bound =
			rigs.flatMap((rig) =>
				rig.responses
					.filter((binding) => binding.targetNodeId === nodeId)
					.map((binding) => ({ rig, binding })),
			)[0] ?? null;
		const selectedNode = findNode(document, nodeId);
		return {
			artboard,
			rigs,
			sourceRig,
			bound,
			hasExistingMicrostructure: selectedNode
				? sourceOpticsTargetHasMicrostructure(selectedNode)
				: false,
		};
	}, [document, nodeId]);
	if (!findNode(document, nodeId)) return null;
	if (state.sourceRig) {
		return (
			<SourceRigControls artboardId={state.artboard.id} rig={state.sourceRig} />
		);
	}
	if (state.bound) {
		return (
			<ResponseControls
				artboardId={state.artboard.id}
				rig={state.bound.rig}
				binding={state.bound.binding}
				hasExistingMicrostructure={state.hasExistingMicrostructure}
			/>
		);
	}
	const eligible = state.rigs.filter(
		(rig) => rig.enabled && rig.sourceNodeId !== nodeId,
	);
	const rigId = eligible.some((rig) => rig.id === selectedRigId)
		? selectedRigId
		: (eligible[0]?.id ?? "");
	return (
		<div className="space-y-1">
			<button
				type="button"
				className={buttonClass}
				onClick={() =>
					useSceneStore
						.getState()
						.apply(createAddSourceOpticsRigCommand(state.artboard.id, nodeId))
				}
			>
				Use selected node as source
			</button>
			{eligible.length > 0 ? (
				<>
					<label className="grid grid-cols-[4.5rem_1fr] items-center gap-1 text-ui text-fg-muted">
						<span>Source</span>
						<select
							value={rigId}
							className={controlClass}
							onChange={(event) => setSelectedRigId(event.currentTarget.value)}
						>
							{eligible.map((rig) => (
								<option key={rig.id} value={rig.id}>
									{rig.name}
								</option>
							))}
						</select>
					</label>
					<button
						type="button"
						className={buttonClass}
						disabled={!rigId}
						onClick={() =>
							useSceneStore
								.getState()
								.apply(
									createBindSourceOpticsResponseCommand(
										state.artboard.id,
										rigId,
										nodeId,
									),
								)
						}
					>
						Bind light response
					</button>
				</>
			) : (
				<div className="text-ui text-fg-subtle">
					No other source rig on this artboard.
				</div>
			)}
		</div>
	);
}
