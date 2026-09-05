import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
	imagePlacementForNode,
	programSurfaceAssetForGeometry,
	programSurfaceAssetReadModel,
} from "@/entities/scene/model/assets";
import { resolveSceneMaskPlan } from "@/entities/scene/model/mask-render";
import {
	flattenRenderableNodes,
	type NormalizedArtboard,
} from "@/entities/scene/model/selectors";
import type {
	ProgramSurfaceAsset,
	SceneDocument,
} from "@/entities/scene/model/types";
import {
	type ApprovedProgramSurfaceProbe,
	type ProgramSurfaceLocalApprovalRegistry,
	programSurfaceHostManifestProjection,
	programSurfaceLocalApprovalRegistry,
} from "@/features/program-surface/model/local-approval";
import {
	type ProgramSurfaceRuntimeStatus,
	type ProgramSurfaceRuntimeStatusRegistry,
	programSurfaceRuntimeStatusRegistry,
} from "@/features/program-surface/model/runtime-status";
import type { ProgramSurfaceHostTraceObserver } from "../model/program-surface-host-trace-diagnostics";
import type { ProgramSurfaceLiveFrameLeaseUpdate } from "../model/program-surface-live-frame-lease";
import {
	createProgramSurfaceProbeHost,
	type ProgramSurfaceHostStatus,
	type ProgramSurfaceProbeFrame,
	type ProgramSurfaceProbeHostTraceEvent,
} from "../model/program-surface-probe-host";

type ProgramSurfaceProbeCandidate = {
	readonly nodeId: string;
	readonly assetId: string;
	readonly artboardId: string;
};

type ResolvedProbe = {
	readonly candidate: ProgramSurfaceProbeCandidate;
	readonly contractKey: string;
	readonly probe: ApprovedProgramSurfaceProbe;
};

const sameCandidate = (
	left: ProgramSurfaceProbeCandidate | null | undefined,
	right: ProgramSurfaceProbeCandidate | null | undefined,
): boolean =>
	left?.nodeId === right?.nodeId &&
	left?.assetId === right?.assetId &&
	left?.artboardId === right?.artboardId;

const sourceKey = (asset: ProgramSurfaceAsset): string =>
	asset.source.kind === "data-url" ? asset.source.dataUrl : asset.source.href;

const hostContractKey = (asset: ProgramSurfaceAsset): string =>
	JSON.stringify([
		asset.id,
		programSurfaceHostManifestProjection(asset.manifest),
		asset.source.kind,
		sourceKey(asset),
	]);

const hasUnsupportedNodeComposition = (
	node: ReturnType<typeof flattenRenderableNodes>[number]["node"],
): boolean =>
	Boolean(
		node.children?.length ||
			node.style.effects?.length ||
			node.recipe ||
			node.recipeRef ||
			node.frame ||
			node.blend ||
			node.blendStep ||
			node.depthPlane ||
			node.motionParent ||
			node.transformConstraint ||
			node.propertyRelations?.length ||
			node.component,
	);

/**
 * Locates the one V1 composition case a DOM overlay can represent honestly.
 * Anything outside this exact configuration stays on the durable raster
 * fallback path; this component does not attempt partial z-order or effect
 * emulation.
 */
const findProbeCandidate = ({
	activeGpuArtboardIds,
	artboards,
	nodeArtboardIds,
	sceneDocument,
	selectedNodeIds,
}: {
	readonly activeGpuArtboardIds: ReadonlySet<string>;
	readonly artboards: readonly NormalizedArtboard[];
	readonly nodeArtboardIds: Readonly<Record<string, string>>;
	readonly sceneDocument: SceneDocument;
	readonly selectedNodeIds: readonly string[];
}): ProgramSurfaceProbeCandidate | null => {
	if (selectedNodeIds.length !== 1) return null;
	const entries = flattenRenderableNodes(sceneDocument);
	const entry = entries.find(
		(candidate) => candidate.node.id === selectedNodeIds[0],
	);
	if (entry?.parentIds.length !== 0) return null;
	if (!entry) return null;
	const { node } = entry;
	if (node.geometry.kind !== "image" || hasUnsupportedNodeComposition(node)) {
		return null;
	}
	if (node.style.blendMode !== undefined && node.style.blendMode !== "normal") {
		return null;
	}
	if (imagePlacementForNode(node)?.crop) return null;
	const asset = programSurfaceAssetForGeometry(sceneDocument, node.geometry);
	if (!asset) return null;
	const artboardId = nodeArtboardIds[node.id];
	const artboard = artboards.find((candidate) => candidate.id === artboardId);
	if (!artboard || activeGpuArtboardIds.has(artboard.id)) return null;
	// A frame/scene-level look can filter the entire artboard composite. A DOM
	// surface would sit outside that SVG filter, so any declared intent is a
	// strict composition blocker even when its current visual parameters happen
	// to be identity values.
	if (
		sceneDocument.effectIntent ||
		artboard.effectIntent ||
		artboard.sourceOpticsRigs?.length ||
		artboard.activeSceneCameraId ||
		(artboard.cameraSpacePolicy !== undefined &&
			artboard.cameraSpacePolicy !== "screen_2d")
	) {
		return null;
	}
	const maskPlan = resolveSceneMaskPlan(sceneDocument);
	if (
		maskPlan.consumedMaskNodeIds.has(node.id) ||
		(maskPlan.applicationsByContentNodeId.get(node.id)?.length ?? 0) > 0 ||
		maskPlan.defs.some(
			(definition) => nodeArtboardIds[definition.maskNodeId] === artboard.id,
		)
	) {
		return null;
	}
	const visibleRootNodes = entries.filter(
		(candidate) =>
			candidate.parentIds.length === 0 &&
			nodeArtboardIds[candidate.node.id] === artboard.id,
	);
	if (visibleRootNodes.at(-1)?.node.id !== node.id) return null;
	return { nodeId: node.id, assetId: asset.id, artboardId: artboard.id };
};

const browserVisible = (): boolean =>
	typeof document !== "undefined" && document.visibilityState !== "hidden";

export type ProgramSurfaceProbeLayerProps = {
	readonly sceneDocument: SceneDocument;
	readonly artboards: readonly NormalizedArtboard[];
	readonly nodeArtboardIds: Readonly<Record<string, string>>;
	readonly activeGpuArtboardIds: ReadonlySet<string>;
	/** V1 admits exactly one selected placement; other surfaces keep fallbacks. */
	readonly selectedNodeIds: readonly string[];
	/** Samples CanvasShell's canonical presentation at a requested transport frame. */
	readonly resolveFrame: (
		nodeId: string,
		frame: number,
	) => ProgramSurfaceProbeFrame | null;
	/** Reader-only transport subscription; the layer never advances playback. */
	readonly subscribePlayback: (
		listener: (frame: number, playing: boolean) => void,
	) => () => void;
	/** Enables SVG fallback suppression only for the current consumed host frame. */
	readonly onLiveFrameLeaseUpdate: (
		update: ProgramSurfaceLiveFrameLeaseUpdate,
	) => void;
	/**
	 * Optional development observer. It receives only source-free host lifecycle
	 * facts paired with this transient mount identity; it never controls a host.
	 */
	readonly onTrace?: ProgramSurfaceHostTraceObserver;
	readonly approvalRegistry?: ProgramSurfaceLocalApprovalRegistry;
	/** Read-only, non-persistent status source for Inspector diagnostics. */
	readonly runtimeStatusRegistry?: ProgramSurfaceRuntimeStatusRegistry;
};

/**
 * Browser-only adapter for the constrained V1 Program Surface proof. It owns
 * no scene state: candidate eligibility is read-only and host status only
 * toggles CanvasShell's fallback-pixel gate for the matching selected node.
 */
export function ProgramSurfaceProbeLayer({
	activeGpuArtboardIds,
	approvalRegistry = programSurfaceLocalApprovalRegistry,
	artboards,
	nodeArtboardIds,
	onLiveFrameLeaseUpdate,
	onTrace,
	resolveFrame,
	runtimeStatusRegistry = programSurfaceRuntimeStatusRegistry,
	sceneDocument,
	selectedNodeIds,
	subscribePlayback,
}: ProgramSurfaceProbeLayerProps) {
	const [approvalRevision, setApprovalRevision] = useState(0);
	const [pageVisible, setPageVisible] = useState(browserVisible);
	const [resolvedProbe, setResolvedProbe] = useState<ResolvedProbe | null>(
		null,
	);
	// An invalid sampled placement tears down the opaque iframe. The next valid
	// transport tick advances this epoch once, so React mounts a fresh host rather
	// than sending another frame to a deliberately failed instance.
	const [hostGeneration, setHostGeneration] = useState(0);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const iframeMountRef = useRef<HTMLDivElement | null>(null);
	const hostContainerRef = useRef<HTMLDivElement | null>(null);
	const hostMountIdRef = useRef(0);
	const latestPlaybackFrameRef = useRef<number | null>(null);
	const requestRenderRef = useRef<((frame: number) => void) | null>(null);
	const resolveFrameRef = useRef(resolveFrame);
	const hostAssetRef = useRef<ProgramSurfaceAsset | null>(null);
	const traceObserverRef = useRef(onTrace);
	const candidate = useMemo(
		() =>
			findProbeCandidate({
				activeGpuArtboardIds,
				artboards,
				nodeArtboardIds,
				sceneDocument,
				selectedNodeIds,
			}),
		[
			activeGpuArtboardIds,
			artboards,
			nodeArtboardIds,
			sceneDocument,
			selectedNodeIds,
		],
	);
	const candidateNodeId = candidate?.nodeId ?? null;
	const candidateAssetId = candidate?.assetId ?? null;
	const candidateArtboardId = candidate?.artboardId ?? null;
	const hostCandidate = useMemo<ProgramSurfaceProbeCandidate | null>(() => {
		if (
			candidateNodeId === null ||
			candidateAssetId === null ||
			candidateArtboardId === null
		) {
			return null;
		}
		return {
			nodeId: candidateNodeId,
			assetId: candidateAssetId,
			artboardId: candidateArtboardId,
		};
	}, [candidateArtboardId, candidateAssetId, candidateNodeId]);
	const approvalSnapshot = useMemo(
		() => ({
			revision: approvalRevision,
			approvals: approvalRegistry.approvals(),
		}),
		[approvalRegistry, approvalRevision],
	);
	const assetReadModel = useMemo(
		() =>
			candidate
				? programSurfaceAssetReadModel(
						sceneDocument,
						candidate.assetId,
						approvalSnapshot.approvals,
					)
				: null,
		[approvalSnapshot, candidate, sceneDocument],
	);
	// V1 activation requires a readable distinct raster fallback. When it is
	// absent or cannot resolve, the entity read model remains fallback-required,
	// the entity renderer retains its deterministic placeholder, and this narrow
	// live host stays ineligible.
	const hostEligible =
		assetReadModel?.status === "approved-for-host" &&
		assetReadModel.asset !== undefined;
	const approvedAsset = hostEligible ? (assetReadModel?.asset ?? null) : null;
	const approvedContractKey = approvedAsset
		? hostContractKey(approvedAsset)
		: null;
	const approvedProbe =
		hostEligible &&
		approvedContractKey !== null &&
		resolvedProbe?.contractKey === approvedContractKey &&
		sameCandidate(resolvedProbe?.candidate, hostCandidate)
			? resolvedProbe.probe
			: null;
	// Presentation callbacks change with pan/zoom/rotate. Keep the iframe mount
	// keyed to the approved candidate, then ask that same host for the latest
	// frame before paint rather than treating a viewport update as a teardown.
	useLayoutEffect(() => {
		resolveFrameRef.current = resolveFrame;
		const frame = latestPlaybackFrameRef.current;
		if (frame !== null) requestRenderRef.current?.(frame);
	}, [resolveFrame]);
	// Do not include a diagnostic callback in the host lifecycle effect. A
	// browser observer must never recreate an otherwise valid opaque iframe.
	useLayoutEffect(() => {
		traceObserverRef.current = onTrace;
	}, [onTrace]);
	useLayoutEffect(() => {
		hostAssetRef.current = approvedAsset;
	}, [approvedAsset]);

	useEffect(
		() =>
			approvalRegistry.subscribe(() => {
				setApprovalRevision((revision) => revision + 1);
			}),
		[approvalRegistry],
	);
	useEffect(() => {
		if (typeof document === "undefined") return;
		const updateVisibility = (): void => {
			setPageVisible(browserVisible());
		};
		updateVisibility();
		document.addEventListener("visibilitychange", updateVisibility);
		return () =>
			document.removeEventListener("visibilitychange", updateVisibility);
	}, []);
	useEffect(() => {
		let cancelled = false;
		const asset = hostAssetRef.current;
		if (!hostCandidate || !hostEligible || !approvedContractKey || !asset) {
			setResolvedProbe(null);
			return;
		}
		void approvalRegistry
			.resolve(asset)
			.then((resolution) => {
				if (cancelled) return;
				setResolvedProbe(
					resolution.status === "approved"
						? {
								candidate: hostCandidate,
								contractKey: approvedContractKey,
								probe: resolution.probe,
							}
						: null,
				);
			})
			.catch(() => {
				if (!cancelled) setResolvedProbe(null);
			});
		return () => {
			cancelled = true;
		};
	}, [approvalRegistry, approvedContractKey, hostCandidate, hostEligible]);
	// Clearing a no-longer-eligible lease must happen before paint; otherwise the
	// SVG fallback can be suppressed for one stale frame after revoke, selection,
	// or composition eligibility changes.
	useLayoutEffect(() => {
		// The explicit restart epoch participates in the mount identity. It is
		// advanced only after an invalid sampled frame so a fresh iframe is created
		// for a later valid tick, never reused after `pause()` tears it down.
		const mountId = Math.max(hostMountIdRef.current + 1, hostGeneration + 1);
		hostMountIdRef.current = mountId;
		const clearLiveFrameLease = (): void => {
			onLiveFrameLeaseUpdate({ kind: "clear", mountId });
		};
		if (!approvedProbe || !hostCandidate || !pageVisible) {
			clearLiveFrameLease();
			return;
		}
		const canvas = canvasRef.current;
		const iframeMount = iframeMountRef.current;
		const container = hostContainerRef.current;
		if (!canvas || !iframeMount || !container) {
			clearLiveFrameLease();
			return;
		}
		let active = true;
		let animationFrame: number | undefined;
		let latestRequestedFrame = 0;
		let pausedForInvalidFrame = false;
		let restartRequested = false;
		const isCurrentMount = (): boolean =>
			active && hostMountIdRef.current === mountId;
		const setLiveFromStatus = (status: ProgramSurfaceHostStatus): void => {
			if (!isCurrentMount()) return;
			const runtimeStatus: ProgramSurfaceRuntimeStatus =
				status.kind === "booting"
					? {
							assetId: hostCandidate.assetId,
							nodeId: hostCandidate.nodeId,
							kind: "booting",
						}
					: status.kind === "live"
						? {
								assetId: hostCandidate.assetId,
								nodeId: status.nodeId,
								kind: "live",
							}
						: status.kind === "fallback"
							? {
									assetId: hostCandidate.assetId,
									nodeId: status.nodeId ?? hostCandidate.nodeId,
									kind: "fallback",
									code: status.code,
								}
							: {
									assetId: hostCandidate.assetId,
									nodeId: status.nodeId ?? hostCandidate.nodeId,
									kind: "disposed",
								};
			runtimeStatusRegistry.publish(runtimeStatus);
			if (
				status.kind === "live" &&
				status.nodeId === hostCandidate.nodeId &&
				approvedProbe.assetId === hostCandidate.assetId
			) {
				onLiveFrameLeaseUpdate({
					kind: "live",
					lease: {
						mountId,
						nodeId: status.nodeId,
						assetId: hostCandidate.assetId,
						compiledDigest: approvedProbe.digest,
						contentKey: status.contentKey,
						sequence: status.sequence,
					},
				});
				return;
			}
			clearLiveFrameLease();
		};
		const forwardTrace = traceObserverRef.current
			? (event: ProgramSurfaceProbeHostTraceEvent): void => {
					traceObserverRef.current?.({ mountId, event });
				}
			: undefined;
		const host = createProgramSurfaceProbeHost({
			probe: approvedProbe,
			canvas,
			iframeMount,
			onStatus: setLiveFromStatus,
			...(forwardTrace ? { onTrace: forwardTrace } : {}),
		});
		const requestRender = (frame: number): void => {
			latestRequestedFrame = frame;
			if (!isCurrentMount() || animationFrame !== undefined) return;
			animationFrame = window.requestAnimationFrame(() => {
				animationFrame = undefined;
				if (!isCurrentMount()) return;
				const resolvedFrame = resolveFrameRef.current(
					hostCandidate.nodeId,
					latestRequestedFrame,
				);
				if (
					!resolvedFrame ||
					resolvedFrame.placement.nodeId !== hostCandidate.nodeId ||
					resolvedFrame.placement.artboardId !== hostCandidate.artboardId
				) {
					clearLiveFrameLease();
					if (!pausedForInvalidFrame) {
						pausedForInvalidFrame = true;
						host.pause();
					}
					return;
				}
				if (pausedForInvalidFrame) {
					// Do not retry while invalid. A later valid tick is the only restart
					// signal, and the effect remount gives it an immediate current-frame
					// callback through subscribePlayback.
					if (!restartRequested) {
						restartRequested = true;
						setHostGeneration((generation) => generation + 1);
					}
					return;
				}
				host.render(resolvedFrame);
			});
		};
		requestRenderRef.current = requestRender;
		const unsubscribe = subscribePlayback((frame) => {
			latestPlaybackFrameRef.current = frame;
			requestRender(frame);
		});
		const observer =
			typeof ResizeObserver === "undefined"
				? null
				: new ResizeObserver(() => requestRender(latestRequestedFrame));
		observer?.observe(container);
		return () => {
			active = false;
			if (animationFrame !== undefined) {
				window.cancelAnimationFrame(animationFrame);
			}
			observer?.disconnect();
			unsubscribe();
			host.dispose();
			if (requestRenderRef.current === requestRender) {
				requestRenderRef.current = null;
			}
			if (hostMountIdRef.current === mountId) {
				runtimeStatusRegistry.clear(
					hostCandidate.assetId,
					hostCandidate.nodeId,
				);
			}
			clearLiveFrameLease();
		};
	}, [
		approvedProbe,
		hostCandidate,
		hostGeneration,
		onLiveFrameLeaseUpdate,
		pageVisible,
		runtimeStatusRegistry,
		subscribePlayback,
	]);

	if (!approvedProbe || !hostCandidate || !pageVisible) return null;
	return (
		<div
			ref={hostContainerRef}
			className="pointer-events-none absolute inset-0 z-[3] overflow-hidden"
			aria-hidden="true"
		>
			<canvas ref={canvasRef} />
			<div ref={iframeMountRef} />
		</div>
	);
}
