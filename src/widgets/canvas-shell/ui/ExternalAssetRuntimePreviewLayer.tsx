import { useCallback, useEffect, useMemo, useState } from "react";
import {
	externalSceneAssetForGeometry,
	hrefForExternalSceneAsset,
} from "@/entities/scene/model/assets";
import {
	type Matrix2D,
	matrixFromTransform,
} from "@/entities/scene/model/rendering";
import { compileRuntime3dFrame } from "@/entities/scene/model/runtime-3d";
import type {
	Bounds,
	ExternalSceneAsset,
	SceneDocument,
	Vec2,
	VectorNode,
} from "@/entities/scene/model/types";
import { blenderLinkWorkflow } from "@/features/blender-link/model/workflow";
import type { Camera } from "@/features/viewport/model/camera";
import type { BabylonRuntimeSurface } from "@/shared/babylon";
import { cn } from "@/shared/lib/cn";
import type { Runtime3dFrame } from "@/shared/runtime-3d/types";
import { materializeRuntime3dVectorPlaneTextures } from "@/shared/runtime-3d/vector-plane-texture";
import {
	BabylonRuntimePreviewCanvas,
	type BabylonRuntimePreviewStatus,
} from "./BabylonRuntimePreviewCanvas";

type PreviewArtboard = {
	readonly id: string;
	readonly position: Vec2;
};

type PreviewTarget = {
	readonly id: string;
	readonly asset: ExternalSceneAsset;
	readonly bounds: Bounds;
	readonly matrix: Matrix2D;
	readonly opacity: number;
};

type RuntimePreviewKind = "code" | "model";

type RuntimeStatus = "loading" | "ready" | "error";

const identityMatrix: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

const translateMatrix = (x: number, y: number): Matrix2D => ({
	a: 1,
	b: 0,
	c: 0,
	d: 1,
	e: x,
	f: y,
});

const multiplyMatrix = (left: Matrix2D, right: Matrix2D): Matrix2D => ({
	a: left.a * right.a + left.c * right.b,
	b: left.b * right.a + left.d * right.b,
	c: left.a * right.c + left.c * right.d,
	d: left.b * right.c + left.d * right.d,
	e: left.a * right.e + left.c * right.f + left.e,
	f: left.b * right.e + left.d * right.f + left.f,
});

const viewportMatrix = (camera: Camera): Matrix2D => {
	const scale = camera.zoom / 100;
	const rotation = camera.rotation ?? 0;
	const cos = Math.cos(rotation);
	const sin = Math.sin(rotation);
	return {
		a: cos * scale,
		b: sin * scale,
		c: -sin * scale,
		d: cos * scale,
		e: camera.panX,
		f: camera.panY,
	};
};

const cssMatrix = (matrix: Matrix2D): string =>
	`matrix(${matrix.a}, ${matrix.b}, ${matrix.c}, ${matrix.d}, ${matrix.e}, ${matrix.f})`;

const isRuntimePreviewAsset = (
	asset: ExternalSceneAsset,
): RuntimePreviewKind | null => {
	if (
		asset.kind === "model-3d" &&
		(asset.format === "glb" || asset.format === "gltf")
	) {
		return "model";
	}
	if (
		asset.kind === "code-module" &&
		(asset.format === "html" || asset.format === "module")
	) {
		return "code";
	}
	return null;
};

const sourceIdentity = (asset: ExternalSceneAsset): string => {
	const raw =
		asset.source.kind === "data-url" ? asset.source.dataUrl : asset.source.href;
	if (raw.length <= 160) return raw;
	return `${raw.length}:${raw.slice(0, 80)}:${raw.slice(-80)}`;
};

const sourceCacheKey = (asset: ExternalSceneAsset): string =>
	[
		asset.id,
		asset.kind,
		asset.format ?? "",
		asset.source.kind,
		sourceIdentity(asset),
	].join("\0");

const decodeDataUrlText = (dataUrl: string): string | null => {
	const comma = dataUrl.indexOf(",");
	if (comma < 0) return null;
	const header = dataUrl.slice(0, comma).toLowerCase();
	const payload = dataUrl.slice(comma + 1);
	try {
		return header.includes(";base64")
			? atob(payload)
			: decodeURIComponent(payload);
	} catch {
		return null;
	}
};

const escapeHtmlAttribute = (value: string): string =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");

const inlineScriptString = (value: string): string =>
	JSON.stringify(value)
		.replaceAll("<", "\\u003c")
		.replaceAll(">", "\\u003e")
		.replaceAll("&", "\\u0026")
		.replaceAll("\u2028", "\\u2028")
		.replaceAll("\u2029", "\\u2029");

const sandboxSourceForCodeAsset = (
	asset: ExternalSceneAsset,
): { readonly src?: string; readonly srcDoc?: string } | null => {
	const href = hrefForExternalSceneAsset(asset);
	if (!href) return null;
	if (asset.source.kind === "reference") {
		if (asset.format === "module") {
			return {
				srcDoc: [
					"<!doctype html>",
					'<html><head><meta charset="utf-8" />',
					"<style>html,body{margin:0;width:100%;height:100%;background:transparent;color:#dce8ff;font:10px ui-monospace,monospace;overflow:hidden}#root{width:100%;height:100%}</style>",
					'</head><body><div id="root"></div>',
					`<script type="module" src="${escapeHtmlAttribute(href)}"></script>`,
					"</body></html>",
				].join(""),
			};
		}
		return { src: href };
	}
	const text = decodeDataUrlText(href);
	if (!text) return null;
	if (asset.format === "module") {
		return {
			srcDoc: [
				"<!doctype html>",
				'<html><head><meta charset="utf-8" />',
				"<style>html,body{margin:0;width:100%;height:100%;background:transparent;color:#dce8ff;font:10px ui-monospace,monospace;overflow:hidden}#root{width:100%;height:100%}</style>",
				'</head><body><div id="root"></div>',
				'<script type="module">',
				`const source = URL.createObjectURL(new Blob([${inlineScriptString(text)}], { type: "text/javascript" }));`,
				"try { await import(source); } finally { URL.revokeObjectURL(source); }",
				"</script></body></html>",
			].join(""),
		};
	}
	return { srcDoc: text };
};

const collectTargets = ({
	artboards,
	document,
	nodeArtboardIds,
}: {
	readonly artboards: readonly PreviewArtboard[];
	readonly document: SceneDocument;
	readonly nodeArtboardIds: Readonly<Record<string, string>>;
}): readonly PreviewTarget[] => {
	const artboardById = new Map(
		artboards.map((artboard) => [artboard.id, artboard]),
	);
	const targets: PreviewTarget[] = [];
	const visit = (node: VectorNode, parentMatrix: Matrix2D): void => {
		const nodeMatrix = multiplyMatrix(
			parentMatrix,
			matrixFromTransform(node.transform),
		);
		if (node.visible && node.geometry.kind === "image") {
			const asset = externalSceneAssetForGeometry(document, node.geometry);
			const kind = asset ? isRuntimePreviewAsset(asset) : null;
			const artboardId = nodeArtboardIds[node.id];
			const artboard = artboardId ? artboardById.get(artboardId) : undefined;
			if (asset && kind && artboard) {
				const artboardMatrix = translateMatrix(
					artboard.position.x,
					artboard.position.y,
				);
				const boundsMatrix = translateMatrix(
					node.geometry.bounds.x,
					node.geometry.bounds.y,
				);
				targets.push({
					id: node.id,
					asset,
					bounds: node.geometry.bounds,
					matrix: multiplyMatrix(
						artboardMatrix,
						multiplyMatrix(nodeMatrix, boundsMatrix),
					),
					opacity: node.style.opacity,
				});
			}
		}
		for (const child of node.children ?? []) visit(child, nodeMatrix);
	};
	for (const layer of document.layers) {
		if (!layer.visible) continue;
		for (const node of layer.nodes) visit(node, identityMatrix);
	}
	return targets;
};

function PreviewStatusBadge({
	kind,
	status,
}: {
	readonly kind: RuntimePreviewKind;
	readonly status: RuntimeStatus;
}) {
	return (
		<div className="absolute top-1 left-1 rounded border border-white/15 bg-black/55 px-1 py-0.5 font-mono text-ui text-white/80 leading-none">
			{kind === "model" ? "GLB" : "CODE"} · {status}
		</div>
	);
}

/**
 * Surfaces `runtime-3d-linked-production-stale` on the canvas itself, next to
 * the existing status badge, rather than inventing a second overlay system.
 * The last-known-good artifact keeps rendering underneath; this only makes it
 * visibly not the desired build.
 */
function PreviewStaleBadge() {
	return (
		<div className="absolute top-1 right-1 rounded border border-warn/60 bg-black/55 px-1 py-0.5 font-mono text-ui text-warn-fg leading-none">
			STALE
		</div>
	);
}

function CodeAssetSandboxPreview({
	asset,
}: {
	readonly asset: ExternalSceneAsset;
}) {
	const [status, setStatus] = useState<RuntimeStatus>("loading");
	const source = useMemo(() => sandboxSourceForCodeAsset(asset), [asset]);
	useEffect(() => {
		setStatus(source ? "loading" : "error");
	}, [source]);
	if (!source) {
		return <PreviewStatusBadge kind="code" status="error" />;
	}
	return (
		<>
			<iframe
				key={sourceCacheKey(asset)}
				title={`${asset.name} sandbox preview`}
				className="h-full w-full border-0 bg-transparent"
				sandbox="allow-scripts"
				src={source.src}
				srcDoc={source.srcDoc}
				onLoad={() => setStatus("ready")}
				onError={() => setStatus("error")}
			/>
			<PreviewStatusBadge kind="code" status={status} />
		</>
	);
}

export function ExternalAssetRuntimePreviewLayer({
	artboards,
	camera,
	disabledVectorPlaneArtboardIds,
	document,
	frame,
	nodeArtboardIds,
	onPickerChange,
	onVectorPlaneConsumptionChange,
	renderIsolatedNodeSvg,
	resolveDocumentAtFrame,
	subscribePlayback,
	viewportSize,
}: {
	readonly artboards: readonly PreviewArtboard[];
	readonly camera: Camera;
	readonly disabledVectorPlaneArtboardIds: ReadonlySet<string>;
	readonly document: SceneDocument;
	readonly frame: number;
	readonly nodeArtboardIds: Readonly<Record<string, string>>;
	readonly onPickerChange: (
		picker: BabylonRuntimeSurface["pickNodeAtClientPoint"] | null,
	) => void;
	readonly onVectorPlaneConsumptionChange: (nodeIds: readonly string[]) => void;
	readonly renderIsolatedNodeSvg: (
		nodeId: string,
		bounds: Bounds,
		sampledScene?: SceneDocument,
		rasterSafe?: boolean,
	) => Promise<string | null>;
	readonly resolveDocumentAtFrame: (frame: number) => SceneDocument;
	readonly subscribePlayback: (
		cb: (frame: number, playing: boolean) => void,
	) => () => void;
	readonly viewportSize: { readonly width: number; readonly height: number };
}) {
	const targets = useMemo(
		() => collectTargets({ artboards, document, nodeArtboardIds }),
		[artboards, document, nodeArtboardIds],
	);
	// The workflow is allocated only once a document actually links a production,
	// so an ordinary project never pays for a companion cache or socket, and the
	// compile path stays byte-identical while no resolver exists.
	const hasLinkedProduction = Boolean(
		document.assets?.some(
			(asset) => asset.kind === "model-3d" && asset.production !== undefined,
		),
	);
	const [linkedProductionRevision, setLinkedProductionRevision] = useState(0);
	// The resolver closure reads live workflow state, so a completed build would
	// otherwise reach the canvas only on the next unrelated re-render. This
	// counter is what turns an admitted artifact into a recompiled frame.
	useEffect(() => {
		if (!hasLinkedProduction) return;
		return blenderLinkWorkflow().subscribe(() => {
			setLinkedProductionRevision((revision) => revision + 1);
		});
	}, [hasLinkedProduction]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the revision is a deliberate extra dependency — a new workflow revision must mint a new resolver identity, or the frame memos below keep the previous closure and an admitted artifact never recompiles.
	const resolveProductionArtifact = useMemo(
		() => (hasLinkedProduction ? blenderLinkWorkflow().resolver() : undefined),
		[hasLinkedProduction, linkedProductionRevision],
	);
	const runtime3dFrame = useMemo(
		() =>
			compileRuntime3dFrame({
				scene: document,
				frame,
				...(resolveProductionArtifact ? { resolveProductionArtifact } : {}),
				viewport: {
					width: viewportSize.width,
					height: viewportSize.height,
					dpr: typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
					scale: camera.zoom / 100,
					panX: camera.panX,
					panY: camera.panY,
					rotation: camera.rotation ?? 0,
				},
			}),
		[
			camera,
			document,
			frame,
			resolveProductionArtifact,
			viewportSize.height,
			viewportSize.width,
		],
	);
	const materializeRuntimeFrame = useCallback(
		(runtimeFrame: Runtime3dFrame, sampledScene: SceneDocument) => {
			const admittedFrame =
				disabledVectorPlaneArtboardIds.size === 0
					? runtimeFrame
					: {
							...runtimeFrame,
							vectorPlanes: runtimeFrame.vectorPlanes.filter(
								(plane) =>
									!disabledVectorPlaneArtboardIds.has(plane.artboardId),
							),
						};
			return materializeRuntime3dVectorPlaneTextures(admittedFrame, (plane) =>
				renderIsolatedNodeSvg(
					plane.sourceNodeId,
					plane.rasterBounds,
					sampledScene,
					true,
				),
			);
		},
		[disabledVectorPlaneArtboardIds, renderIsolatedNodeSvg],
	);
	const prepareRuntimeFrame = useCallback(
		(runtimeFrame: Runtime3dFrame) =>
			materializeRuntimeFrame(runtimeFrame, document),
		[document, materializeRuntimeFrame],
	);
	const resolveRuntimeFrame = useCallback(
		(playbackFrame: number) => {
			const sampledScene = resolveDocumentAtFrame(playbackFrame);
			return materializeRuntimeFrame(
				compileRuntime3dFrame({
					scene: sampledScene,
					frame: playbackFrame,
					...(resolveProductionArtifact ? { resolveProductionArtifact } : {}),
					viewport: {
						width: viewportSize.width,
						height: viewportSize.height,
						dpr:
							typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
						scale: camera.zoom / 100,
						panX: camera.panX,
						panY: camera.panY,
						rotation: camera.rotation ?? 0,
					},
				}),
				sampledScene,
			);
		},
		[
			camera.panX,
			camera.panY,
			camera.rotation,
			camera.zoom,
			materializeRuntimeFrame,
			resolveDocumentAtFrame,
			resolveProductionArtifact,
			viewportSize.height,
			viewportSize.width,
		],
	);
	const runtimeSourceKey = runtime3dFrame.placements
		.map((placement) => placement.source.cacheKey)
		.concat(
			runtime3dFrame.vectorPlanes.map(
				(plane) =>
					`${plane.nodeId}:${plane.rasterBounds.x}:${plane.rasterBounds.y}:${plane.rasterBounds.width}:${plane.rasterBounds.height}`,
			),
		)
		.join("\0");
	const [babylonState, setBabylonState] = useState<{
		readonly sourceKey: string;
		readonly status: BabylonRuntimePreviewStatus;
	}>({ sourceKey: runtimeSourceKey, status: "loading" });
	const babylonStatus =
		babylonState.sourceKey === runtimeSourceKey
			? babylonState.status
			: "loading";
	const handleBabylonStatus = useCallback(
		(status: BabylonRuntimePreviewStatus) =>
			setBabylonState({ sourceKey: runtimeSourceKey, status }),
		[runtimeSourceKey],
	);
	const useBabylon =
		runtime3dFrame.placements.length > 0 && babylonStatus !== "error";
	const runtimePlacementNodeIds = new Set(
		runtime3dFrame.placements.map((placement) => placement.nodeId),
	);
	const staleLinkedProductionNodeIds = new Set(
		runtime3dFrame.issues
			.filter((issue) => issue.code === "runtime-3d-linked-production-stale")
			.map((issue) => issue.nodeId)
			.filter((nodeId): nodeId is string => Boolean(nodeId)),
	);
	const viewMatrix = viewportMatrix(camera);
	if (targets.length === 0) return null;
	return (
		<div
			className="pointer-events-none absolute inset-0 z-[2] overflow-hidden"
			data-runtime-3d-issue-count={runtime3dFrame.issues.length}
			data-runtime-3d-status={babylonStatus}
		>
			{useBabylon ? (
				<BabylonRuntimePreviewCanvas
					frame={runtime3dFrame}
					onPickerChange={onPickerChange}
					onStatus={handleBabylonStatus}
					onVectorPlaneConsumptionChange={onVectorPlaneConsumptionChange}
					prepareFrame={prepareRuntimeFrame}
					resolveFrame={resolveRuntimeFrame}
					subscribePlayback={subscribePlayback}
				/>
			) : null}
			{targets.map((target) => {
				const kind = isRuntimePreviewAsset(target.asset);
				if (!kind) return null;
				const modelReady =
					kind === "model" &&
					runtimePlacementNodeIds.has(target.id) &&
					babylonStatus === "ready";
				const matrix = multiplyMatrix(viewMatrix, target.matrix);
				return (
					<div
						key={`${target.id}-${sourceCacheKey(target.asset)}`}
						className={cn(
							"absolute overflow-hidden rounded-[3px]",
							!modelReady && "bg-black/10 ring-1 ring-white/10",
						)}
						style={{
							height: target.bounds.height,
							opacity: target.opacity,
							transform: cssMatrix(matrix),
							transformOrigin: "0 0",
							width: target.bounds.width,
						}}
					>
						{kind === "model" ? (
							<>
								<PreviewStatusBadge
									kind="model"
									status={
										runtimePlacementNodeIds.has(target.id)
											? babylonStatus
											: "error"
									}
								/>
								{staleLinkedProductionNodeIds.has(target.id) ? (
									<PreviewStaleBadge />
								) : null}
							</>
						) : (
							<CodeAssetSandboxPreview asset={target.asset} />
						)}
					</div>
				);
			})}
		</div>
	);
}
