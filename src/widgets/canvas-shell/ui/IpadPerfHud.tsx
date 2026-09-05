import { useEffect, useState } from "react";
import type {
	IpadPerfCaptureController,
	IpadPerfSnapshot,
} from "@/widgets/canvas-shell/model/ipad-perf-capture";

const formatMs = (value: number): string => value.toFixed(1);
const formatSeconds = (value: number): string => (value / 1_000).toFixed(0);

const laneSummary = (record: IpadPerfSnapshot["pointerByLane"]): string =>
	Object.entries(record)
		.filter(([, value]) => (value ?? 0) > 0)
		.map(([lane, value]) => `${lane}:${value}`)
		.join(" ");

/**
 * Debug-only iPad frame/input HUD. It subscribes to the capture controller's
 * throttled snapshots and never drives a frame loop of its own.
 */
export function IpadPerfHud({
	controller,
}: {
	readonly controller: IpadPerfCaptureController;
}) {
	const [snapshot, setSnapshot] = useState<IpadPerfSnapshot>(() =>
		controller.getSnapshot(),
	);
	const [copied, setCopied] = useState(false);

	useEffect(() => controller.subscribe(setSnapshot), [controller]);

	const copy = () => {
		void controller.copySummary().then(() => {
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1_200);
		});
	};

	const metadata = snapshot.metadata;
	return (
		<div
			aria-hidden="true"
			style={{
				position: "absolute",
				right: 8,
				top: 8,
				zIndex: 70,
				pointerEvents: "auto",
				fontFamily: "monospace",
				fontSize: 11,
				lineHeight: 1.45,
				color: "#e8f5e9",
				background: "rgba(0, 0, 0, 0.68)",
				padding: "6px 8px",
				borderRadius: 3,
				whiteSpace: "pre-wrap",
				wordBreak: "break-word",
				maxWidth: "calc(100vw - 16px)",
			}}
			data-ipad-perf-hud="active"
		>
			<div>{`ipad perf ${formatSeconds(snapshot.elapsedMs)}s ${snapshot.activeGesture ?? "idle"}`}</div>
			<div>{`frame avg ${formatMs(snapshot.avgFrameMs)}ms last ${formatMs(snapshot.lastFrameMs)}ms max ${formatMs(snapshot.maxFrameMs)}ms`}</div>
			<div>{`slow >20/${snapshot.framesOver20Ms} >33/${snapshot.framesOver33Ms} >50/${snapshot.framesOver50Ms} of ${snapshot.frames}`}</div>
			<div>{`pointer ${snapshot.pointerEvents} ${laneSummary(snapshot.pointerByLane)}`}</div>
			<div>{`viewport writes ${snapshot.viewportWrites} hover writes ${snapshot.hoverWrites}`}</div>
			<div>{`long tasks ${snapshot.longTaskCount} ${formatMs(snapshot.longTaskMs)}ms max ${formatMs(snapshot.maxLongTaskMs)}ms`}</div>
			<div>{`render ${metadata?.renderPath ?? "unknown"} gpuArtboards ${metadata?.activeGpuArtboards ?? 0} nodes ${metadata?.topLevelNodeCount ?? 0}`}</div>
			<button
				type="button"
				onClick={copy}
				style={{
					marginTop: 4,
					border: "1px solid rgba(255,255,255,0.28)",
					borderRadius: 3,
					background: "rgba(255,255,255,0.08)",
					color: "inherit",
					font: "inherit",
					padding: "2px 6px",
				}}
			>
				{copied ? "Copied" : "Copy JSON"}
			</button>
		</div>
	);
}
