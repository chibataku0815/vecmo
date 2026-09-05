import { cn } from "@/shared/lib/cn";

export type EditorHandleState =
	| "idle"
	| "hover"
	| "active"
	| "sub-selected"
	| "disabled";

type EditorHandleProps = {
	readonly x: number;
	readonly y: number;
	readonly state?: EditorHandleState;
	readonly radius?: number;
};

const stateClass: Record<EditorHandleState, string> = {
	idle: "fill-overlay-handle stroke-overlay-ink",
	hover: "fill-overlay-accent-line stroke-overlay-handle-deep",
	active: "fill-overlay-accent stroke-overlay-handle-deep",
	"sub-selected": "fill-overlay-warn stroke-overlay-ink",
	disabled: "fill-overlay-handle-disabled stroke-overlay-ink opacity-45",
};

export function EditorHandle({
	x,
	y,
	state = "idle",
	radius = 5,
}: EditorHandleProps) {
	return (
		<circle
			cx={x}
			cy={y}
			r={radius}
			className={cn("stroke-2", stateClass[state])}
			vectorEffect="non-scaling-stroke"
		/>
	);
}
