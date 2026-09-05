import { Camera, Eye, Lock, UploadSimple, X } from "@phosphor-icons/react";
import {
	type ChangeEvent,
	type PointerEvent as ReactPointerEvent,
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useStore } from "zustand";
import {
	captureVisualReviewPacket,
	createImportedVisualReviewPacket,
	createLocalCandidateVisualReviewPacket,
	createVisualReviewPlan,
	type FrozenVisualReviewSource,
	type PrivateVisualReviewImage,
	type PrivateVisualReviewPacket,
	type VisualReviewCaptureAdapter,
	type VisualReviewCaptureFailure,
	type VisualReviewComparisonMode,
	type VisualReviewCriticTerminal,
	type VisualReviewDiagnosticSpec,
	type VisualReviewPlan,
	type VisualReviewProbeView,
	type VisualReviewSessionStoreApi,
	type VisualReviewSide,
	visualReviewSessionStore,
} from "@/features/visual-review";
import { cn } from "@/shared/lib/cn";
import { DetachedWindow } from "@/shared/ui/DetachedWindow";
import { IconButton } from "@/shared/ui/IconButton";
import { TooltipProvider } from "@/shared/ui/Tooltip";

type WorkspaceSize = {
	readonly width: number;
	readonly height: number;
};

type ReviewImageTransform = {
	readonly scale: number;
	readonly offsetX: number;
	readonly offsetY: number;
};

const buttonClass =
	"rounded-md border border-hairline/10 bg-hairline/5 px-2 py-1 text-ui text-fg-secondary hover:border-hairline/20 hover:bg-hairline/10 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40";
const activeButtonClass =
	"border-accent bg-accent-surface text-accent-fg hover:border-accent hover:bg-accent-surface hover:text-accent-fg";

const terminalLabels: Readonly<Record<VisualReviewCriticTerminal, string>> = {
	visual_reject: "Visual reject",
	retry_one_residual: "Retry one residual",
	user_review_ready: "User review ready",
	critic_uncertain: "Critic uncertain",
};

const terminalOrder = [
	"visual_reject",
	"retry_one_residual",
	"user_review_ready",
	"critic_uncertain",
] as const satisfies readonly VisualReviewCriticTerminal[];

const compareModes = [
	["side-by-side", "Side by side"],
	["blink", "Blink"],
	["swipe", "Swipe"],
] as const satisfies readonly (readonly [VisualReviewComparisonMode, string])[];

const planSignature = (plan: VisualReviewPlan): string =>
	[
		plan.sourceKey,
		...plan.views.map((view) =>
			view.role === "probe"
				? `${view.id}:${view.rect.x},${view.rect.y},${view.rect.width},${view.rect.height}`
				: view.id,
		),
		...plan.diagnostics.map((diagnostic) => diagnostic.id),
	].join("|");

const localReferenceKey = (): string => {
	const id = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36);
	return `session-reference:${id}`;
};

const captureFailure = (
	code: VisualReviewCaptureFailure["code"],
	message: string,
): VisualReviewCaptureFailure => ({ code, message, retryable: false });

const expectedCaptureDimensions = (
	source: FrozenVisualReviewSource,
): WorkspaceSize => ({
	width: Math.max(1, Math.round(source.width * source.pixelRatio)),
	height: Math.max(1, Math.round(source.height * source.pixelRatio)),
});

function useElementSize(ref: RefObject<HTMLElement | null>): WorkspaceSize {
	const [size, setSize] = useState<WorkspaceSize>({ width: 1, height: 1 });
	useEffect(() => {
		const element = ref.current;
		if (!element || typeof ResizeObserver === "undefined") return;
		const update = () => {
			const rect = element.getBoundingClientRect();
			setSize({
				width: Math.max(1, rect.width),
				height: Math.max(1, rect.height),
			});
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(element);
		return () => observer.disconnect();
	}, [ref]);
	return size;
}

const imageTransform = ({
	image,
	container,
	view,
	zoom,
	pan,
}: {
	readonly image: PrivateVisualReviewImage;
	readonly container: WorkspaceSize;
	readonly view: VisualReviewPlan["views"][number];
	readonly zoom: number;
	readonly pan: { readonly x: number; readonly y: number };
}): ReviewImageTransform => {
	const focus =
		view.role === "probe"
			? {
					x: (view.rect.x + view.rect.width / 2) * image.width,
					y: (view.rect.y + view.rect.height / 2) * image.height,
					width: view.rect.width * image.width,
					height: view.rect.height * image.height,
				}
			: {
					x: image.width / 2,
					y: image.height / 2,
					width: image.width,
					height: image.height,
				};
	const baseScale =
		view.role === "actual-pixel"
			? 1
			: Math.min(
					container.width / Math.max(1, focus.width),
					container.height / Math.max(1, focus.height),
				);
	const scale = Math.max(0.001, baseScale * zoom);
	return {
		scale,
		offsetX: container.width / 2 - focus.x * scale + pan.x,
		offsetY: container.height / 2 - focus.y * scale + pan.y,
	};
};

function ReviewImageLayer({
	image,
	view,
	container,
	zoom,
	pan,
}: {
	readonly image: PrivateVisualReviewImage;
	readonly view: VisualReviewPlan["views"][number];
	readonly container: WorkspaceSize;
	readonly zoom: number;
	readonly pan: { readonly x: number; readonly y: number };
}) {
	const transform = imageTransform({ image, container, view, zoom, pan });
	if (!image.objectUrl) return null;
	return (
		<img
			alt=""
			aria-hidden="true"
			draggable={false}
			src={image.objectUrl}
			className="pointer-events-none absolute left-0 top-0 max-w-none select-none"
			style={{
				width: image.width,
				height: image.height,
				transform: `matrix(${transform.scale}, 0, 0, ${transform.scale}, ${transform.offsetX}, ${transform.offsetY})`,
				transformOrigin: "0 0",
			}}
		/>
	);
}

function useSharedPan({
	pan,
	onPan,
}: {
	readonly pan: { readonly x: number; readonly y: number };
	readonly onPan: (pan: { readonly x: number; readonly y: number }) => void;
}) {
	const drag = useRef<{
		readonly pointerId: number;
		readonly x: number;
		readonly y: number;
		readonly panX: number;
		readonly panY: number;
	} | null>(null);
	const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		event.currentTarget.setPointerCapture(event.pointerId);
		drag.current = {
			pointerId: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			panX: pan.x,
			panY: pan.y,
		};
	};
	const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		const active = drag.current;
		if (!active || active.pointerId !== event.pointerId) return;
		onPan({
			x: active.panX + event.clientX - active.x,
			y: active.panY + event.clientY - active.y,
		});
	};
	const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (drag.current?.pointerId !== event.pointerId) return;
		drag.current = null;
	};
	return {
		onPointerDown,
		onPointerMove,
		onPointerUp: onPointerEnd,
		onPointerCancel: onPointerEnd,
	};
}

function SingleReviewPane({
	label,
	image,
	view,
	zoom,
	pan,
	onPan,
	className,
}: {
	readonly label: "A" | "B";
	readonly image: PrivateVisualReviewImage;
	readonly view: VisualReviewPlan["views"][number];
	readonly zoom: number;
	readonly pan: { readonly x: number; readonly y: number };
	readonly onPan: (pan: { readonly x: number; readonly y: number }) => void;
	readonly className?: string;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const size = useElementSize(ref);
	const panHandlers = useSharedPan({ pan, onPan });
	return (
		<div
			ref={ref}
			className={cn(
				"relative min-h-0 overflow-hidden rounded-md border border-hairline/10 bg-surface-sunken touch-none",
				className,
			)}
			{...panHandlers}
		>
			<ReviewImageLayer
				image={image}
				view={view}
				container={size}
				zoom={zoom}
				pan={pan}
			/>
			<div className="pointer-events-none absolute left-2 top-2 rounded border border-hairline/10 bg-surface/90 px-1.5 py-1 text-ui font-medium text-fg">
				{label}
			</div>
		</div>
	);
}

function SwipeReviewPane({
	imageA,
	imageB,
	view,
	zoom,
	pan,
	onPan,
	swipePercent,
}: {
	readonly imageA: PrivateVisualReviewImage;
	readonly imageB: PrivateVisualReviewImage;
	readonly view: VisualReviewPlan["views"][number];
	readonly zoom: number;
	readonly pan: { readonly x: number; readonly y: number };
	readonly onPan: (pan: { readonly x: number; readonly y: number }) => void;
	readonly swipePercent: number;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const size = useElementSize(ref);
	const panHandlers = useSharedPan({ pan, onPan });
	return (
		<div
			ref={ref}
			className="relative min-h-0 overflow-hidden rounded-md border border-hairline/10 bg-surface-sunken touch-none"
			{...panHandlers}
		>
			<ReviewImageLayer
				image={imageB}
				view={view}
				container={size}
				zoom={zoom}
				pan={pan}
			/>
			<div
				className="pointer-events-none absolute inset-0 overflow-hidden"
				style={{ clipPath: `inset(0 ${100 - swipePercent}% 0 0)` }}
			>
				<ReviewImageLayer
					image={imageA}
					view={view}
					container={size}
					zoom={zoom}
					pan={pan}
				/>
			</div>
			<div
				aria-hidden="true"
				className="pointer-events-none absolute bottom-0 top-0 w-px bg-accent"
				style={{ left: `${swipePercent}%` }}
			/>
			<div className="pointer-events-none absolute left-2 top-2 rounded border border-hairline/10 bg-surface/90 px-1.5 py-1 text-ui font-medium text-fg">
				A
			</div>
			<div className="pointer-events-none absolute right-2 top-2 rounded border border-hairline/10 bg-surface/90 px-1.5 py-1 text-ui font-medium text-fg">
				B
			</div>
		</div>
	);
}

const packetForRole = (
	role: VisualReviewSide,
	referencePacket: PrivateVisualReviewPacket,
	candidatePacket: PrivateVisualReviewPacket,
): PrivateVisualReviewPacket =>
	role === "reference" ? referencePacket : candidatePacket;

function PixelComparison({
	store,
}: {
	readonly store: VisualReviewSessionStoreApi;
}) {
	const state = useStore(store);
	const plan = state.plan;
	const reference = state.referencePacket;
	const candidate = state.candidatePacket;
	const view = plan?.views.find((entry) => entry.id === state.activeViewId);
	if (!plan || !reference || !candidate || !view) return null;
	const packetA = packetForRole(state.sideOrder.a, reference, candidate);
	const packetB = packetForRole(state.sideOrder.b, reference, candidate);
	const imageA = packetA.imageForDiagnostic(state.activeDiagnosticId);
	const imageB = packetB.imageForDiagnostic(state.activeDiagnosticId);
	const onPan = store.getState().setPan;
	if (state.comparisonMode === "blink") {
		return (
			<SingleReviewPane
				label={state.blinkSide === "a" ? "A" : "B"}
				image={state.blinkSide === "a" ? imageA : imageB}
				view={view}
				zoom={state.zoom}
				pan={state.pan}
				onPan={onPan}
				className="h-full"
			/>
		);
	}
	if (state.comparisonMode === "swipe") {
		return (
			<SwipeReviewPane
				imageA={imageA}
				imageB={imageB}
				view={view}
				zoom={state.zoom}
				pan={state.pan}
				onPan={onPan}
				swipePercent={state.swipePercent}
			/>
		);
	}
	return (
		<div className="grid min-h-0 grid-cols-2 gap-2">
			<SingleReviewPane
				label="A"
				image={imageA}
				view={view}
				zoom={state.zoom}
				pan={state.pan}
				onPan={onPan}
			/>
			<SingleReviewPane
				label="B"
				image={imageB}
				view={view}
				zoom={state.zoom}
				pan={state.pan}
				onPan={onPan}
			/>
		</div>
	);
}

function ImportButton({
	label,
	inputRef,
	disabled,
}: {
	readonly label: string;
	readonly inputRef: RefObject<HTMLInputElement | null>;
	readonly disabled: boolean;
}) {
	return (
		<button
			type="button"
			className={cn(buttonClass, "inline-flex items-center gap-1.5")}
			disabled={disabled}
			onClick={() => inputRef.current?.click()}
		>
			<UploadSimple aria-hidden="true" size={13} />
			{label}
		</button>
	);
}

export type VisualReviewWorkspaceProps = {
	readonly store?: VisualReviewSessionStoreApi;
	readonly plan?: VisualReviewPlan;
	readonly captureAdapter?: VisualReviewCaptureAdapter;
	readonly onClose?: () => void;
	readonly className?: string;
};

/**
 * Pixel-first review workspace. The setup stage may name source roles, but once
 * both packets are ready the comparison surface exposes only randomized A/B
 * pixels until a critic verdict has been locked.
 */
export function VisualReviewWorkspace({
	store = visualReviewSessionStore,
	plan: suppliedPlan,
	captureAdapter,
	onClose,
	className,
}: VisualReviewWorkspaceProps) {
	const state = useStore(store);
	const referenceInput = useRef<HTMLInputElement>(null);
	const candidateInput = useRef<HTMLInputElement>(null);
	const [importBusy, setImportBusy] = useState<VisualReviewSide | null>(null);
	const [terminal, setTerminal] =
		useState<VisualReviewCriticTerminal>("visual_reject");
	const [confidence, setConfidence] = useState<"low" | "medium" | "high">(
		"medium",
	);
	const [residual, setResidual] = useState("");
	const [referenceImportError, setReferenceImportError] = useState<
		string | null
	>(null);
	const suppliedSignature = useMemo(
		() => (suppliedPlan ? planSignature(suppliedPlan) : null),
		[suppliedPlan],
	);

	useEffect(() => {
		if (!suppliedPlan) return;
		const current = store.getState().plan;
		if (!current || planSignature(current) !== suppliedSignature) {
			store.getState().setPlan(suppliedPlan);
		}
	}, [store, suppliedPlan, suppliedSignature]);

	const importReference = useCallback(
		async (file: File) => {
			setImportBusy("reference");
			try {
				setReferenceImportError(null);
				const result = await createImportedVisualReviewPacket({
					blob: file,
					sourceKey: localReferenceKey(),
				});
				if (result.status === "failed") {
					setReferenceImportError(result.failure.message);
					return;
				}
				store.getState().setReferencePacket(result.packet);
			} finally {
				setImportBusy(null);
			}
		},
		[store],
	);

	const importCandidate = useCallback(
		async (file: File) => {
			setImportBusy("candidate");
			try {
				const existingPlan = store.getState().plan;
				if (existingPlan) {
					const result = await createImportedVisualReviewPacket({
						blob: file,
						sourceKey: existingPlan.sourceKey,
					});
					if (result.status === "failed") {
						store.getState().setCaptureFailure(result.failure);
						return;
					}
					const expected = expectedCaptureDimensions(existingPlan.source);
					if (
						result.packet.master.width !== expected.width ||
						result.packet.master.height !== expected.height
					) {
						result.packet.dispose();
						store
							.getState()
							.setCaptureFailure(
								captureFailure(
									"invalid_dimensions",
									"Imported candidate dimensions do not match the frozen source.",
								),
							);
						return;
					}
					store.getState().setCandidatePacket(result.packet, "local-import");
					return;
				}

				const result = await createLocalCandidateVisualReviewPacket(file);
				if (result.status === "failed") {
					store.getState().setCaptureFailure(result.failure);
					return;
				}
				const localPlan = createVisualReviewPlan({
					source: result.source,
					probes: [],
				});
				if (localPlan.status === "blocked") {
					result.packet.dispose();
					store
						.getState()
						.setCaptureFailure(
							captureFailure("capture_unsupported", localPlan.failure.message),
						);
					return;
				}
				store.getState().setPlan(localPlan.plan);
				store.getState().setCandidatePacket(result.packet, "local-import");
			} finally {
				setImportBusy(null);
			}
		},
		[store],
	);

	const handleFileChange = useCallback(
		(side: VisualReviewSide, event: ChangeEvent<HTMLInputElement>) => {
			const file = event.currentTarget.files?.[0];
			event.currentTarget.value = "";
			if (!file) return;
			void (side === "reference"
				? importReference(file)
				: importCandidate(file));
		},
		[importCandidate, importReference],
	);

	const captureCandidate = useCallback(async () => {
		const current = store.getState();
		if (!current.plan) {
			store
				.getState()
				.setCaptureFailure(
					captureFailure(
						"capture_unsupported",
						"No frozen capture plan exists.",
					),
				);
			return;
		}
		if (!captureAdapter) {
			store
				.getState()
				.setCaptureFailure(
					captureFailure(
						"capture_unsupported",
						"No native capture adapter is connected; import candidate pixels instead.",
					),
				);
			return;
		}
		if (!store.getState().beginCapture()) return;
		const result = await captureVisualReviewPacket({
			plan: current.plan,
			adapter: captureAdapter,
		});
		if (result.status === "failed") {
			store.getState().setCaptureFailure(result.failure);
			return;
		}
		store.getState().setCandidatePacket(result.packet, result.status);
	}, [captureAdapter, store]);

	const lockVerdict = () => {
		if (
			store.getState().lockVerdict({
				terminal,
				largestVisibleResidual: residual,
				confidence,
			})
		) {
			setResidual("");
		}
	};

	const pixelReady =
		state.phase === "ready_pixel_only" ||
		state.phase === "verdict_locked" ||
		state.phase === "metadata_revealed";
	const activeView = state.plan?.views.find(
		(view) => view.id === state.activeViewId,
	);
	const actualPixelSizesDiffer =
		activeView?.role === "actual-pixel" &&
		state.referencePacket !== null &&
		state.candidatePacket !== null &&
		(state.referencePacket.master.width !==
			state.candidatePacket.master.width ||
			state.referencePacket.master.height !==
				state.candidatePacket.master.height);
	useEffect(() => {
		if (actualPixelSizesDiffer && state.comparisonMode !== "side-by-side") {
			store.getState().setComparisonMode("side-by-side");
		}
	}, [actualPixelSizesDiffer, state.comparisonMode, store]);
	const renderedDiagnosticIds = new Set(
		state.candidatePacket?.diagnosticOutcomes
			.filter((outcome) => outcome.status === "rendered")
			.map((outcome) => outcome.diagnostic.id) ?? [],
	);

	return (
		<TooltipProvider>
			<section
				aria-label="Visual review workspace"
				className={cn(
					"flex h-full min-h-0 w-full flex-col bg-surface text-ui text-fg",
					className,
				)}
			>
				<input
					ref={referenceInput}
					type="file"
					accept="image/*"
					className="hidden"
					onChange={(event) => handleFileChange("reference", event)}
				/>
				<input
					ref={candidateInput}
					type="file"
					accept="image/*"
					className="hidden"
					onChange={(event) => handleFileChange("candidate", event)}
				/>

				<header className="flex h-11 shrink-0 items-center gap-2 border-b border-hairline/10 px-3">
					<div className="min-w-0 flex-1">
						<div className="font-medium text-fg">Visual Review</div>
						<div className="truncate text-fg-subtle">
							{pixelReady ? "Pixel-only first read" : "Private session setup"}
						</div>
					</div>
					<button
						type="button"
						className={buttonClass}
						onClick={() => {
							setReferenceImportError(null);
							store.getState().resetSession();
						}}
					>
						Reset
					</button>
					{onClose ? (
						<IconButton
							icon={X}
							label="Close visual review"
							onClick={onClose}
						/>
					) : null}
				</header>

				{!pixelReady ? (
					<div className="grid min-h-0 flex-1 place-items-center overflow-auto p-4">
						<div className="grid w-full max-w-2xl gap-3 rounded-md border border-hairline/10 bg-surface-raised p-3">
							<div className="grid grid-cols-2 gap-3">
								<div className="rounded-md border border-hairline/10 bg-surface-sunken p-3">
									<div className="font-medium text-fg">Reference pixels</div>
									<div className="mb-3 mt-1 text-fg-subtle">
										Local only. Filename and path are discarded.
									</div>
									<ImportButton
										label={
											state.referencePacket
												? "Replace reference"
												: "Import reference"
										}
										inputRef={referenceInput}
										disabled={importBusy !== null}
									/>
								</div>
								<div className="rounded-md border border-hairline/10 bg-surface-sunken p-3">
									<div className="font-medium text-fg">Candidate pixels</div>
									<div className="mb-3 mt-1 text-fg-subtle">
										Capture the frozen source or import the exact-size result.
									</div>
									<div className="flex flex-wrap gap-2">
										<button
											type="button"
											className={cn(
												buttonClass,
												"inline-flex items-center gap-1.5",
											)}
											disabled={
												!state.plan || state.capture.status === "capturing"
											}
											onClick={() => void captureCandidate()}
										>
											<Camera aria-hidden="true" size={13} />
											Capture
										</button>
										<ImportButton
											label={
												state.candidatePacket
													? "Replace candidate"
													: "Import candidate"
											}
											inputRef={candidateInput}
											disabled={importBusy !== null}
										/>
									</div>
								</div>
							</div>
							<div className="flex flex-wrap items-center gap-2 text-fg-muted">
								<span>
									Views: Fit · 100% ·{" "}
									{state.plan?.views.filter((view) => view.role === "probe")
										.length ?? 0}{" "}
									probe
								</span>
								<span className="text-fg-subtle">·</span>
								<span>
									Diagnostics: {state.plan?.diagnostics.length ?? 0} optional
								</span>
							</div>
							{state.capture.status === "blocked" ? (
								<div className="rounded-md border border-danger/30 bg-danger-surface px-2 py-1.5 text-danger-fg">
									{state.capture.failure.code}: {state.capture.failure.message}
								</div>
							) : null}
							{referenceImportError ? (
								<div className="rounded-md border border-danger/30 bg-danger-surface px-2 py-1.5 text-danger-fg">
									{referenceImportError}
								</div>
							) : null}
							{state.capture.status === "capturing" ? (
								<div className="rounded-md border border-accent/30 bg-accent-surface px-2 py-1.5 text-accent-fg">
									Capturing one frozen revision…
								</div>
							) : null}
							{state.capture.status === "degraded" ? (
								<div className="rounded-md border border-danger/30 bg-danger-surface px-2 py-1.5 text-danger-fg">
									The baseline capture is not native-equivalent. Review is
									blocked; recapture or import exact pixels.
								</div>
							) : null}
						</div>
					</div>
				) : (
					<>
						<div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-hairline/10 px-3 py-2">
							{state.plan?.views.map((view) => (
								<button
									key={view.id}
									type="button"
									className={cn(
										buttonClass,
										state.activeViewId === view.id && activeButtonClass,
									)}
									onClick={() => store.getState().setActiveView(view.id)}
								>
									{view.role === "fit"
										? "Fit"
										: view.role === "actual-pixel"
											? "100%"
											: view.label}
								</button>
							))}
							<div className="mx-1 h-4 w-px bg-hairline/10" />
							{compareModes.map(([mode, label]) => (
								<button
									key={mode}
									type="button"
									className={cn(
										buttonClass,
										state.comparisonMode === mode && activeButtonClass,
									)}
									disabled={actualPixelSizesDiffer && mode !== "side-by-side"}
									title={
										actualPixelSizesDiffer && mode !== "side-by-side"
											? "Different source resolutions require side-by-side at 100%."
											: undefined
									}
									onClick={() => store.getState().setComparisonMode(mode)}
								>
									{label}
								</button>
							))}
							{state.comparisonMode === "blink" ? (
								<>
									<button
										type="button"
										className={cn(
											buttonClass,
											state.blinkSide === "a" && activeButtonClass,
										)}
										onClick={() => store.getState().setBlinkSide("a")}
									>
										A
									</button>
									<button
										type="button"
										className={cn(
											buttonClass,
											state.blinkSide === "b" && activeButtonClass,
										)}
										onClick={() => store.getState().setBlinkSide("b")}
									>
										B
									</button>
								</>
							) : null}
							<div className="ml-auto flex items-center gap-1">
								<button
									type="button"
									className={buttonClass}
									onClick={() => store.getState().setZoom(state.zoom / 1.25)}
								>
									−
								</button>
								<span className="w-10 text-center text-fg-muted">
									{Math.round(state.zoom * 100)}%
								</span>
								<button
									type="button"
									className={buttonClass}
									onClick={() => store.getState().setZoom(state.zoom * 1.25)}
								>
									+
								</button>
								<button
									type="button"
									className={buttonClass}
									onClick={() => store.getState().resetNavigation()}
								>
									Center
								</button>
							</div>
						</div>

						{renderedDiagnosticIds.size > 0 ? (
							<div className="flex shrink-0 items-center gap-1 border-b border-hairline/10 px-3 py-1.5">
								<button
									type="button"
									className={cn(
										buttonClass,
										state.activeDiagnosticId === null && activeButtonClass,
									)}
									onClick={() => store.getState().setActiveDiagnostic(null)}
								>
									Baseline
								</button>
								{state.plan?.diagnostics.map((diagnostic, index) =>
									renderedDiagnosticIds.has(diagnostic.id) ? (
										<button
											key={diagnostic.id}
											type="button"
											className={cn(
												buttonClass,
												state.activeDiagnosticId === diagnostic.id &&
													activeButtonClass,
											)}
											onClick={() =>
												store.getState().setActiveDiagnostic(diagnostic.id)
											}
										>
											{state.phase === "metadata_revealed"
												? diagnostic.label
												: `D${index + 1}`}
										</button>
									) : null,
								)}
							</div>
						) : null}

						{state.comparisonMode === "swipe" ? (
							<div className="flex shrink-0 items-center gap-2 px-3 py-1.5">
								<span className="text-fg-subtle">A</span>
								<input
									type="range"
									min={0}
									max={100}
									value={state.swipePercent}
									aria-label="Swipe position"
									className="min-w-0 flex-1 accent-accent"
									onChange={(event) =>
										store
											.getState()
											.setSwipePercent(Number(event.currentTarget.value))
									}
								/>
								<span className="text-fg-subtle">B</span>
							</div>
						) : null}

						<div className="min-h-0 flex-1 p-2">
							<PixelComparison store={store} />
						</div>

						<div className="grid shrink-0 gap-2 border-t border-hairline/10 bg-surface-raised px-3 py-2">
							{state.phase === "ready_pixel_only" ? (
								<>
									<div className="flex flex-wrap gap-1">
										{terminalOrder.map((value) => (
											<button
												key={value}
												type="button"
												className={cn(
													buttonClass,
													terminal === value && activeButtonClass,
												)}
												onClick={() => setTerminal(value)}
											>
												{terminalLabels[value]}
											</button>
										))}
										<div className="ml-auto flex gap-1">
											{(["low", "medium", "high"] as const).map((value) => (
												<button
													key={value}
													type="button"
													className={cn(
														buttonClass,
														confidence === value && activeButtonClass,
													)}
													onClick={() => setConfidence(value)}
												>
													{value}
												</button>
											))}
										</div>
									</div>
									<div className="flex gap-2">
										<textarea
											value={residual}
											rows={2}
											placeholder="Largest visible residual (required)"
											className="min-w-0 flex-1 resize-none rounded-md border border-hairline/10 bg-surface-sunken px-2 py-1.5 text-ui text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
											onChange={(event) =>
												setResidual(event.currentTarget.value)
											}
										/>
										<button
											type="button"
											className={cn(
												buttonClass,
												"inline-flex items-center gap-1.5 self-stretch",
											)}
											disabled={residual.trim().length === 0}
											onClick={lockVerdict}
										>
											<Lock aria-hidden="true" size={13} />
											Lock verdict
										</button>
									</div>
								</>
							) : state.verdict ? (
								<div className="flex items-start gap-3">
									<div className="min-w-0 flex-1">
										<div className="font-medium text-fg">
											{terminalLabels[state.verdict.terminal]} ·{" "}
											{state.verdict.confidence}
										</div>
										<div className="mt-1 text-fg-muted">
											{state.verdict.largestVisibleResidual}
										</div>
									</div>
									{state.phase === "verdict_locked" ? (
										<button
											type="button"
											className={cn(
												buttonClass,
												"inline-flex items-center gap-1.5",
											)}
											onClick={() => store.getState().revealMetadata()}
										>
											<Eye aria-hidden="true" size={13} />
											Reveal technical facts
										</button>
									) : null}
								</div>
							) : null}

							{state.phase === "metadata_revealed" && state.candidatePacket ? (
								<div className="grid grid-cols-2 gap-2 border-t border-hairline/10 pt-2 text-fg-muted">
									<div>
										A ={" "}
										{state.sideOrder.a === "candidate"
											? "Candidate"
											: "Reference"}
										<br />B ={" "}
										{state.sideOrder.b === "candidate"
											? "Candidate"
											: "Reference"}
									</div>
									<div>
										Candidate renderer:{" "}
										{state.candidatePacket.fidelity.renderer}
										<br />
										Fidelity: {state.candidatePacket.fidelity.status}
										{state.candidatePacket.technicalManifest ? (
											<>
												<br />
												Frame: {state.candidatePacket.technicalManifest.frame}
											</>
										) : null}
									</div>
								</div>
							) : null}
						</div>
					</>
				)}
			</section>
		</TooltipProvider>
	);
}

export type VisualReviewDetachedWorkspaceProps = VisualReviewWorkspaceProps & {
	readonly open: boolean;
	readonly disposeOnClose?: boolean;
};

/** Controlled detached host that disposes private pixels when closed. */
export function VisualReviewDetachedWorkspace({
	open,
	store = visualReviewSessionStore,
	disposeOnClose = true,
	onClose,
	...workspaceProps
}: VisualReviewDetachedWorkspaceProps) {
	useEffect(() => {
		if (!open && disposeOnClose) store.getState().disposeSession();
	}, [disposeOnClose, open, store]);
	useEffect(
		() => () => {
			if (disposeOnClose) store.getState().disposeSession();
		},
		[disposeOnClose, store],
	);
	if (!open) return null;
	const close = () => {
		if (disposeOnClose) store.getState().disposeSession();
		onClose?.();
	};
	return (
		<DetachedWindow
			title="Vecmo Visual Review"
			features="popup=yes,width=1440,height=900"
			onClose={close}
		>
			<VisualReviewWorkspace
				{...workspaceProps}
				store={store}
				onClose={close}
			/>
		</DetachedWindow>
	);
}

/** Convenience helper for a host that owns raw source/probe inputs. */
export function createVisualReviewWorkspacePlan({
	source,
	probes,
	diagnostics,
}: {
	readonly source: FrozenVisualReviewSource;
	readonly probes: readonly VisualReviewProbeView[];
	readonly diagnostics?: readonly VisualReviewDiagnosticSpec[];
}): VisualReviewPlan | null {
	const result = createVisualReviewPlan({ source, probes, diagnostics });
	return result.status === "ready" ? result.plan : null;
}
