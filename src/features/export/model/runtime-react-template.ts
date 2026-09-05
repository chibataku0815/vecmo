export type RuntimeReactPropField = {
	readonly name: string;
	readonly type: "number" | "color" | "text";
};

export type RuntimeReactPropsModel =
	| {
			readonly kind: "named";
			readonly fields: readonly RuntimeReactPropField[];
	  }
	| { readonly kind: "record" };

export type RuntimeReactTemplateInput = {
	readonly runtimeFileName: string;
	readonly sourceExpression: string;
	readonly ariaLabel: string;
	readonly propsModel: RuntimeReactPropsModel;
};

const INTERACTION_CALLBACKS = [
	{ prop: "onClipStart", event: "clipStart", payload: "clipId: string" },
	{ prop: "onClipEnd", event: "clipEnd", payload: "clipId: string" },
	{ prop: "onEnded", event: "ended", payload: "" },
	{
		prop: "onStateChange",
		event: "stateChange",
		payload: 'state: "idle" | "playing-clip" | "paused"',
	},
] as const;

const namedPropsShape = (fields: readonly RuntimeReactPropField[]): string =>
	fields
		.map(
			(field) =>
				`\treadonly ${field.name}?: ${field.type === "number" ? "number" : "string"};`,
		)
		.join("\n");

const namedPropsLines = (
	fields: readonly RuntimeReactPropField[],
	indent: number,
): string =>
	fields.map((field) => `${"\t".repeat(indent)}${field.name},`).join("\n");

const componentPropsTemplate = (
	model: RuntimeReactPropsModel,
): {
	readonly typeFields: string;
	readonly destructuredFields: string;
	readonly refAndEffect: string;
	readonly mountOption: string;
	readonly applyLatest: string;
} => {
	if (model.kind === "record") {
		return {
			typeFields:
				"\treadonly initialProps?: Readonly<Record<string, unknown>>;\n",
			destructuredFields: "\tinitialProps,\n",
			refAndEffect: `\tconst componentPropsRef = useRef(initialProps ?? {});
\tcomponentPropsRef.current = initialProps ?? {};

\tuseEffect(() => {
\t\tplayerRef.current?.setProps(componentPropsRef.current);
\t}, [initialProps]);

`,
			mountOption: "\n\t\t\tprops: componentPropsRef.current,",
			applyLatest: "\n\t\t\tplayer.setProps(componentPropsRef.current);",
		};
	}

	if (model.fields.length === 0) {
		return {
			typeFields: "",
			destructuredFields: "",
			refAndEffect: "",
			mountOption: "",
			applyLatest: "",
		};
	}

	const names = model.fields.map((field) => field.name);
	return {
		typeFields: `${namedPropsShape(model.fields)}\n`,
		destructuredFields: `${namedPropsLines(model.fields, 1)}\n`,
		refAndEffect: `\tconst componentPropsRef = useRef({
${namedPropsLines(model.fields, 2)}
\t});
\tcomponentPropsRef.current = {
${namedPropsLines(model.fields, 2)}
\t};

\tuseEffect(() => {
\t\tplayerRef.current?.setProps(componentPropsRef.current);
\t}, [${names.join(", ")}]);

`,
		mountOption: "\n\t\t\tprops: componentPropsRef.current,",
		applyLatest: "\n\t\t\tplayer.setProps(componentPropsRef.current);",
	};
};

/**
 * Generates the renderer-neutral React lifecycle used by SVG and WebGL
 * exports. Renderer selection changes only the imported runtime module and
 * payload source; callback relays, mutable controls, cleanup, and snapshot
 * subscription remain one contract.
 */
export function createRuntimeReactComponentContents({
	runtimeFileName,
	sourceExpression,
	ariaLabel,
	propsModel,
}: RuntimeReactTemplateInput): string {
	const props = componentPropsTemplate(propsModel);
	const interactionTypeFields = INTERACTION_CALLBACKS.map(
		({ prop, event, payload }) =>
			`\treadonly ${prop}?: (event: { readonly kind: "${event}"${payload ? `; readonly ${payload}` : ""} }) => void;`,
	).join("\n");
	const interactionParameters = INTERACTION_CALLBACKS.map(
		({ prop }) => `\t${prop},`,
	).join("\n");
	const callbackNames = [
		"onReady",
		"onError",
		"onFrameSampled",
		"onFrameRendered",
		...INTERACTION_CALLBACKS.map(({ prop }) => prop),
	].join(", ");
	const subscriptions = INTERACTION_CALLBACKS.map(
		({ prop, event }) =>
			`\t\t\tunsubscribers.push(player.on("${event}", (event) => callbacksRef.current.${prop}?.(event)));`,
	).join("\n");

	return `import { useEffect, useRef, useSyncExternalStore, type CSSProperties } from "react";
import { mountVectorMotion, type FrameRenderedEvent, type FrameSampleEvent, type RuntimeCameraOverride, type VectorMotionFrameSnapshot, type VectorMotionPlayer as RuntimeVectorMotionPlayer } from "./${runtimeFileName}";

export type VectorMotionPlayer = RuntimeVectorMotionPlayer;

const subscribeToNothing = () => () => {};
const getNullSnapshot = () => null;

export const useVectorMotionSnapshot = (player: VectorMotionPlayer | null): VectorMotionFrameSnapshot | null =>
\tuseSyncExternalStore(
\t\tplayer ? player.subscribe : subscribeToNothing,
\t\tplayer ? player.getSnapshot : getNullSnapshot,
\t\tgetNullSnapshot,
\t);

export type VectorMotionProps = {
\treadonly autoplay?: boolean;
\treadonly loop?: boolean;
\treadonly frame?: number;
\treadonly playbackRate?: number;
\t/** Structural mount option. Changing it recreates the runtime instance. */
\treadonly interactive?: boolean;
${props.typeFields}\treadonly initialCameraOverrides?: readonly { readonly cameraRigId: string; readonly override: RuntimeCameraOverride }[];
\treadonly initialActiveCameraOverride?: string | null;
\treadonly className?: string;
\treadonly style?: CSSProperties;
\treadonly onReady?: (player: VectorMotionPlayer) => void;
\treadonly onError?: (error: unknown) => void;
\treadonly onFrameSampled?: (event: FrameSampleEvent) => void;
\treadonly onFrameRendered?: (event: FrameRenderedEvent) => void;
${interactionTypeFields}
};

export function VectorMotion({
\tautoplay = true,
\tloop = true,
\tframe,
\tplaybackRate,
\tinteractive = true,
${props.destructuredFields}\tinitialCameraOverrides,
\tinitialActiveCameraOverride,
\tclassName,
\tstyle,
\tonReady,
\tonError,
\tonFrameSampled,
\tonFrameRendered,
${interactionParameters}
}: VectorMotionProps) {
\tconst containerRef = useRef<HTMLDivElement | null>(null);
\tconst playerRef = useRef<VectorMotionPlayer | null>(null);
\tconst callbacksRef = useRef({ ${callbackNames} });
\tcallbacksRef.current = { ${callbackNames} };
\tconst runtimePropsRef = useRef({ autoplay, loop, frame, playbackRate });
\truntimePropsRef.current = { autoplay, loop, frame, playbackRate };
\tconst initialCameraOverridesRef = useRef(initialCameraOverrides);
\tconst initialActiveCameraOverrideRef = useRef(initialActiveCameraOverride);

${props.refAndEffect}\tuseEffect(() => {
\t\tconst container = containerRef.current;
\t\tif (!container) return;
\t\tlet disposed = false;
\t\tlet mounted: VectorMotionPlayer | null = null;
\t\tconst unsubscribers: Array<() => void> = [];
\t\tvoid mountVectorMotion(container, {
\t\t\tsource: ${sourceExpression},
\t\t\tautoplay: false,
\t\t\tloop: runtimePropsRef.current.loop,
\t\t\t...(runtimePropsRef.current.frame !== undefined ? { frame: runtimePropsRef.current.frame } : {}),
\t\t\t...(runtimePropsRef.current.playbackRate !== undefined ? { playbackRate: runtimePropsRef.current.playbackRate } : {}),
\t\t\tinteractions: interactive,
\t\t\tcameraOverrides: initialCameraOverridesRef.current,
\t\t\tactiveCameraOverride: initialActiveCameraOverrideRef.current,
\t\t\tonFrameSampled: (event) => callbacksRef.current.onFrameSampled?.(event),
\t\t\tonFrameRendered: (event) => callbacksRef.current.onFrameRendered?.(event),${props.mountOption}
\t\t}).then(async (player) => {
\t\t\tif (disposed) {
\t\t\t\tplayer.destroy();
\t\t\t\treturn;
\t\t\t}
\t\t\tmounted = player;
\t\t\tplayerRef.current = player;${props.applyLatest}
\t\t\tplayer.setLoop(runtimePropsRef.current.loop);
\t\t\tplayer.setPlaybackRate(runtimePropsRef.current.playbackRate ?? 1);
\t\t\tif (runtimePropsRef.current.frame !== undefined && player.frame !== runtimePropsRef.current.frame) {
\t\t\t\tawait player.seekFrame(runtimePropsRef.current.frame);
\t\t\t}
\t\t\tif (disposed) return;
\t\t\tif (runtimePropsRef.current.autoplay) player.play();
${subscriptions}
\t\t\tcallbacksRef.current.onReady?.(player);
\t\t}).catch((error) => {
\t\t\tif (!disposed) callbacksRef.current.onError?.(error);
\t\t});
\t\treturn () => {
\t\t\tdisposed = true;
\t\t\tplayerRef.current = null;
\t\t\tfor (const unsubscribe of unsubscribers) unsubscribe();
\t\t\tmounted?.destroy();
\t\t};
\t}, [interactive]);

\tuseEffect(() => {
\t\tconst player = playerRef.current;
\t\tif (!player) return;
\t\tif (autoplay) player.play();
\t\telse player.pause();
\t}, [autoplay]);

\tuseEffect(() => {
\t\tplayerRef.current?.setLoop(loop);
\t}, [loop]);

\tuseEffect(() => {
\t\tplayerRef.current?.setPlaybackRate(playbackRate ?? 1);
\t}, [playbackRate]);

\tuseEffect(() => {
\t\tif (frame !== undefined && playerRef.current?.frame !== frame) {
\t\t\tvoid playerRef.current?.seekFrame(frame);
\t\t}
\t}, [frame]);

\treturn (
\t\t<div
\t\t\tref={containerRef}
\t\t\tclassName={className}
\t\t\tstyle={style}
\t\t\taria-label={${JSON.stringify(ariaLabel)}}
\t\t/>
\t);
}

export default VectorMotion;
`;
}
