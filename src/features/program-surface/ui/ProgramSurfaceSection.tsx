import {
	ArrowClockwise,
	Check,
	Code,
	LinkSimple,
	Power,
	Warning,
	X,
} from "@phosphor-icons/react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import {
	getEditorSessionDescriptor,
	subscribeEditorSessionDescriptor,
} from "@/entities/editor-session/model/session";
import {
	type ProgramSurfaceFallbackReadState,
	programSurfaceAssetForGeometry,
	programSurfaceAssetReadModel,
} from "@/entities/scene/model/assets";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	ProgramSurfaceAsset,
	SceneDocument,
	VectorNode,
} from "@/entities/scene/model/types";
import { cn } from "@/shared/lib/cn";
import {
	createProgramSurfaceBridgeClient,
	type ProgramSurfaceBridgeClient,
	type ProgramSurfaceBridgeClientSnapshot,
} from "../model/bridge-client";
import {
	approveBoundProgramSurfaceBridgeCandidate,
	type ProgramSurfaceBridgeCandidateApprovalResult,
} from "../model/bridge-workflow";
import {
	assignProgramSurfaceFallback,
	type ProgramSurfaceFallbackAssignmentResult,
	type ProgramSurfaceFallbackCandidate,
	programSurfaceFallbackCandidates,
} from "../model/fallback-assignment";
import {
	type ProgramSurfaceProbeResolution,
	programSurfaceLocalApprovalRegistry,
} from "../model/local-approval";
import {
	type ProgramSurfaceRuntimeStatus,
	programSurfaceRuntimeStatusRegistry,
} from "../model/runtime-status";

type Feedback = {
	readonly tone: "neutral" | "success" | "warning";
	readonly message: string;
};

const controlButton =
	"flex min-w-0 items-center justify-center gap-1 rounded-md border border-hairline bg-surface px-1.5 py-1 text-fg-secondary text-ui transition hover:bg-surface-light hover:text-fg disabled:cursor-not-allowed disabled:opacity-45";

const primaryControlButton =
	"border-accent/60 bg-accent-surface text-accent-fg hover:bg-accent-surface/80 hover:text-accent-fg";

const warningControlButton =
	"border-warn/50 bg-warn-surface text-warn-fg hover:bg-warn-surface/80 hover:text-warn-fg";

const shortDigest = (digest: string | undefined): string => {
	if (!digest) return "—";
	const normalized = digest.replace(/^sha256:/u, "");
	return normalized.length <= 12
		? normalized
		: `${normalized.slice(0, 8)}…${normalized.slice(-4)}`;
};

const runtimeLabel = (status: ProgramSurfaceRuntimeStatus | null): string => {
	if (!status) return "No mounted host";
	switch (status.kind) {
		case "booting":
			return "Host booting";
		case "live":
			return "Live";
		case "fallback":
			return `Fallback: ${status.code}`;
		case "disposed":
			return "Host disposed";
		default:
			return "Host state unavailable";
	}
};

const bridgeStatusLabel = (
	status: ProgramSurfaceBridgeClientSnapshot["buildStatus"],
): string => {
	switch (status) {
		case "bound-clean":
			return "Bound; waiting for a build";
		case "building":
			return "Building";
		case "candidate-awaiting-approval":
			return "Candidate awaiting approval";
		case "active-last-known-good":
			return "Bridge last-known-good available";
		case "build-failed-last-known-good":
			return "Build failed; bridge last-known-good remains";
		default:
			return "Not bound";
	}
};

/**
 * Keeps transient execution feedback aligned with the entity-owned fallback
 * read model. A ready fallback is safe to identify by its Inspector option
 * name; every other state is represented by the renderer's placeholder rather
 * than by a misleading declaration claim.
 */
export const programSurfaceFallbackContinuityMessage = (
	state: ProgramSurfaceFallbackReadState,
	assetId: string | undefined,
	candidates: readonly ProgramSurfaceFallbackCandidate[],
): string => {
	if (state !== "ready") {
		return "The deterministic placeholder remains in use.";
	}
	const fallbackName = candidates.find(
		(candidate) => candidate.id === assetId,
	)?.name;
	const fallbackIdentity = fallbackName ?? assetId;
	return fallbackIdentity
		? `The raster fallback “${fallbackIdentity}” remains available.`
		: "The ready raster fallback remains available.";
};

/**
 * Derives feedback from the durable document at the point an asynchronous
 * action settles. It never trusts a fallback state captured before a bridge or
 * digest verification yielded to the event loop.
 */
export const programSurfaceFallbackContinuityForDocument = (
	document: Pick<SceneDocument, "assets">,
	assetId: string,
): string => {
	const readModel = programSurfaceAssetReadModel(document, assetId);
	return programSurfaceFallbackContinuityMessage(
		readModel.fallback.state,
		readModel.fallback.assetId,
		programSurfaceFallbackCandidates(document, assetId),
	);
};

const currentProgramSurfaceFallbackContinuity = (assetId: string): string =>
	programSurfaceFallbackContinuityForDocument(
		useSceneStore.getState().document,
		assetId,
	);

const localApprovalFeedback = (
	result: ProgramSurfaceProbeResolution,
	fallbackContinuity: string,
): Feedback =>
	result.status === "approved"
		? {
				tone: "success",
				message:
					"Approved for this editor session. The canvas host may now attempt an isolated render.",
			}
		: {
				tone: "warning",
				message: `Local approval was not granted. ${fallbackContinuity}`,
			};

const bridgeApprovalFeedback = (
	result: ProgramSurfaceBridgeCandidateApprovalResult,
	fallbackContinuity: string,
): Feedback =>
	result.status === "approved"
		? {
				tone: "success",
				message:
					"The exact bridge candidate is approved for this editor session. Canvas liveness remains a separate host state.",
			}
		: {
				tone: "warning",
				message: `Bridge approval did not complete. The document was not granted live execution authority. ${fallbackContinuity}`,
			};

const fallbackStateLabel = (state: ProgramSurfaceFallbackReadState): string => {
	switch (state) {
		case "ready":
			return "Ready";
		case "not-declared":
			return "Required — not declared";
		case "missing":
			return "Required — image missing";
		case "invalid":
			return "Required — image invalid";
		case "not-required":
			return "Unavailable";
		default:
			return "Unavailable";
	}
};

const fallbackStateMessage = (
	state: ProgramSurfaceFallbackReadState,
	assetId: string | undefined,
	candidateCount: number,
): string => {
	const candidateHint =
		candidateCount === 0
			? "Add or retain a usable image asset before assigning a fallback."
			: "Choose a distinct usable image below to assign the fallback.";
	switch (state) {
		case "ready":
			return "A distinct raster fallback is ready. Local approval and host eligibility remain separate checks.";
		case "not-declared":
			return `No raster fallback is declared. ${candidateHint}`;
		case "missing":
			return `The declared fallback${assetId ? ` “${assetId}”` : ""} is unavailable. ${candidateHint}`;
		case "invalid":
			return `The declared fallback${assetId ? ` “${assetId}”` : ""} is not a usable image. ${candidateHint}`;
		case "not-required":
			return "The Program Surface declaration is unavailable, so no fallback can be assigned.";
		default:
			return "The fallback state is unavailable.";
	}
};

const fallbackAssignmentFeedback = (
	result: ProgramSurfaceFallbackAssignmentResult,
	candidates: readonly { readonly id: string; readonly name: string }[],
): Feedback => {
	if (result.status === "assigned") {
		const name = candidates.find(
			(candidate) => candidate.id === result.fallbackAssetId,
		)?.name;
		return {
			tone: "success",
			message: `${name ?? "The selected image"} is now the declared raster fallback. Local approval remains separate.`,
		};
	}
	if (result.status === "unchanged") {
		return {
			tone: "neutral",
			message: "That image is already the declared raster fallback.",
		};
	}
	return {
		tone: "warning",
		message:
			result.reason === "scene-busy"
				? "Finish the current scene edit before assigning a Program Surface fallback."
				: "The fallback assignment could not be applied. Recheck the selected Program Surface and image.",
	};
};

function Readout({
	label,
	value,
}: {
	readonly label: string;
	readonly value: string;
}) {
	return (
		<div className="flex h-6 min-w-0 items-center justify-between gap-2 rounded-md border border-hairline bg-surface-sunken px-1.5 text-ui">
			<span className="text-fg-muted">{label}</span>
			<span
				className="min-w-0 truncate font-mono text-fg-secondary"
				title={value}
			>
				{value}
			</span>
		</div>
	);
}

function FeedbackNotice({ feedback }: { readonly feedback: Feedback | null }) {
	if (!feedback) return null;
	return (
		<p
			className={cn(
				"rounded-md border px-1.5 py-1 text-ui",
				feedback.tone === "success"
					? "border-accent/45 bg-accent-surface text-accent-fg"
					: feedback.tone === "warning"
						? "border-warn/45 bg-warn-surface text-warn-fg"
						: "border-hairline bg-surface-sunken text-fg-secondary",
			)}
		>
			{feedback.message}
		</p>
	);
}

function BridgeControls({
	assetId,
	bridgeClient,
	snapshot,
	onFeedback,
}: {
	readonly assetId: string;
	readonly bridgeClient: ProgramSurfaceBridgeClient;
	readonly snapshot: ProgramSurfaceBridgeClientSnapshot;
	readonly onFeedback: (feedback: Feedback) => void;
}) {
	const [pairingToken, setPairingToken] = useState("");
	const [selectedManifestId, setSelectedManifestId] = useState<string | null>(
		null,
	);
	const [pendingAction, setPendingAction] = useState<
		"discover" | "pair" | "bind" | "approve" | "disconnect" | null
	>(null);
	const bridgeIsDevOnly = import.meta.env.DEV;
	const currentTarget = getEditorSessionDescriptor();
	const isCurrentAssetBound = snapshot.binding?.assetId === assetId;
	const candidate = snapshot.candidate;
	const candidateCanApprove =
		candidate !== undefined &&
		isCurrentAssetBound &&
		candidate.assetId === assetId &&
		candidate.manifestId === snapshot.binding?.manifestId;

	useEffect(() => {
		if (
			selectedManifestId !== null &&
			snapshot.manifests.some((manifest) => manifest.id === selectedManifestId)
		) {
			return;
		}
		setSelectedManifestId(null);
	}, [selectedManifestId, snapshot.manifests]);

	const discover = async (): Promise<void> => {
		setPendingAction("discover");
		try {
			const result = await bridgeClient.discover();
			onFeedback(
				result.status === "available"
					? {
							tone: "neutral",
							message:
								"Local bridge discovered. Enter the terminal-issued pairing token to continue.",
						}
					: { tone: "warning", message: result.reason },
			);
		} finally {
			setPendingAction(null);
		}
	};

	const pair = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
		event.preventDefault();
		if (!pairingToken.trim()) return;
		setPendingAction("pair");
		try {
			await bridgeClient.pair({
				pairingToken,
				target: currentTarget,
			});
			onFeedback({
				tone: "neutral",
				message:
					"Paired locally. Choose one discovered Program Surface source before binding this asset.",
			});
		} catch {
			onFeedback({
				tone: "warning",
				message:
					"Local bridge pairing did not complete. Start a new discovery before retrying.",
			});
		} finally {
			// The transport discards its copy after hello; do the same for the UI draft.
			setPairingToken("");
			setPendingAction(null);
		}
	};

	const bind = async (): Promise<void> => {
		if (!selectedManifestId) return;
		setPendingAction("bind");
		try {
			await bridgeClient.bind({
				assetId,
				manifestId: selectedManifestId,
				target: currentTarget,
			});
			onFeedback({
				tone: "neutral",
				message:
					"This existing Program Surface is bound locally. A successful build still requires an explicit candidate approval.",
			});
		} catch {
			onFeedback({
				tone: "warning",
				message:
					"The bridge could not bind this asset to the selected local source.",
			});
		} finally {
			setPendingAction(null);
		}
	};

	const approveCandidate = async (): Promise<void> => {
		if (!candidateCanApprove) return;
		setPendingAction("approve");
		try {
			onFeedback(
				bridgeApprovalFeedback(
					await approveBoundProgramSurfaceBridgeCandidate({
						client: bridgeClient,
					}),
					currentProgramSurfaceFallbackContinuity(assetId),
				),
			);
		} catch {
			onFeedback({
				tone: "warning",
				message: `Bridge approval ended unexpectedly. ${currentProgramSurfaceFallbackContinuity(assetId)}`,
			});
		} finally {
			setPendingAction(null);
		}
	};

	const disconnect = (): void => {
		setPendingAction("disconnect");
		try {
			bridgeClient.close();
			onFeedback({
				tone: "neutral",
				message:
					"Local bridge disconnected. Existing session approval remains revocable until the editor binding changes.",
			});
		} finally {
			setPendingAction(null);
		}
	};

	if (!bridgeIsDevOnly) {
		return (
			<p className="text-fg-subtle text-ui">
				The local VS Code bridge is available only in the Vite development
				editor.
			</p>
		);
	}

	return (
		<div className="space-y-1.5">
			<div className="grid grid-cols-2 gap-1">
				<Readout label="Bridge" value={snapshot.phase} />
				<Readout
					label="Build"
					value={bridgeStatusLabel(snapshot.buildStatus)}
				/>
			</div>
			<Readout
				label="Bridge LKG"
				value={snapshot.lastKnownGood ? "Available (not host live)" : "None"}
			/>

			{snapshot.phase === "idle" ||
			snapshot.phase === "closed" ||
			snapshot.phase === "failed" ? (
				<button
					type="button"
					disabled={pendingAction !== null}
					onClick={() => void discover()}
					className={cn(controlButton, "w-full")}
				>
					<ArrowClockwise aria-hidden="true" size={12} />
					Discover local bridge
				</button>
			) : null}

			{snapshot.phase === "ready-to-pair" ? (
				<form className="space-y-1" onSubmit={(event) => void pair(event)}>
					<label className="block min-w-0">
						<span className="mb-0.5 block text-fg-muted text-ui">
							Pairing token
						</span>
						<input
							type="password"
							autoComplete="off"
							spellCheck={false}
							value={pairingToken}
							onChange={(event) => setPairingToken(event.currentTarget.value)}
							placeholder="Terminal-issued token"
							className="h-6 w-full rounded-md border border-hairline bg-surface-sunken px-1.5 font-mono text-fg text-ui outline-none transition placeholder:text-fg-subtle focus:border-accent/70"
						/>
					</label>
					<button
						type="submit"
						disabled={
							pendingAction !== null || pairingToken.trim().length === 0
						}
						className={cn(controlButton, primaryControlButton, "w-full")}
					>
						<LinkSimple aria-hidden="true" size={12} />
						Pair locally
					</button>
				</form>
			) : null}

			{snapshot.phase === "paired" && !snapshot.binding ? (
				<div className="space-y-1">
					<p className="text-fg-muted text-ui">
						Choose one local source to bind to this existing asset.
					</p>
					<div className="space-y-1">
						{snapshot.manifests.map((manifest) => {
							const selected = manifest.id === selectedManifestId;
							return (
								<button
									key={manifest.id}
									type="button"
									aria-pressed={selected}
									onClick={() => setSelectedManifestId(manifest.id)}
									className={cn(
										"flex min-h-6 w-full min-w-0 items-center rounded-md border px-1.5 py-1 text-left text-ui transition",
										selected
											? "border-accent/60 bg-accent-surface text-accent-fg"
											: "border-hairline bg-surface text-fg-secondary hover:bg-surface-light hover:text-fg",
									)}
								>
									<span className="min-w-0 truncate">{manifest.name}</span>
								</button>
							);
						})}
					</div>
					<button
						type="button"
						disabled={pendingAction !== null || selectedManifestId === null}
						onClick={() => void bind()}
						className={cn(controlButton, primaryControlButton, "w-full")}
					>
						<LinkSimple aria-hidden="true" size={12} />
						Bind this asset
					</button>
				</div>
			) : null}

			{(snapshot.phase === "paired" || snapshot.phase === "binding") &&
			!snapshot.binding ? (
				<button
					type="button"
					disabled={pendingAction !== null}
					onClick={disconnect}
					className={cn(controlButton, "w-full")}
				>
					<Power aria-hidden="true" size={12} />
					Disconnect bridge
				</button>
			) : null}

			{snapshot.binding ? (
				<div className="space-y-1">
					<Readout
						label="Bound asset"
						value={
							isCurrentAssetBound
								? "Current selection"
								: "Another Program Surface"
						}
					/>
					{candidateCanApprove ? (
						<div className="space-y-1">
							<div className="grid grid-cols-2 gap-1">
								<Readout
									label="Candidate"
									value={shortDigest(candidate.identity.compiledDigest)}
								/>
								<Readout
									label="Bundle"
									value={`${candidate.byteLength} bytes`}
								/>
							</div>
							<button
								type="button"
								disabled={pendingAction !== null}
								onClick={() => void approveCandidate()}
								className={cn(controlButton, warningControlButton, "w-full")}
							>
								<Check aria-hidden="true" size={12} />
								Approve exact candidate
							</button>
						</div>
					) : null}
					<button
						type="button"
						disabled={pendingAction !== null}
						onClick={disconnect}
						className={cn(controlButton, "w-full")}
					>
						<Power aria-hidden="true" size={12} />
						Disconnect bridge
					</button>
				</div>
			) : null}

			{snapshot.diagnostics.length > 0 ? (
				<div className="space-y-0.5 rounded-md border border-warn/45 bg-warn-surface px-1.5 py-1 text-warn-fg text-ui">
					{[
						...new Set(
							snapshot.diagnostics.map((diagnostic) => diagnostic.code),
						),
					].map((code) => (
						<p key={code}>{code}</p>
					))}
				</div>
			) : null}
			{snapshot.error ? (
				<p className="rounded-md border border-warn/45 bg-warn-surface px-1.5 py-1 text-warn-fg text-ui">
					{snapshot.error}
				</p>
			) : null}
			{snapshot.notice ? (
				<p className="rounded-md border border-hairline bg-surface-sunken px-1.5 py-1 text-fg-secondary text-ui">
					{snapshot.notice}
				</p>
			) : null}
		</div>
	);
}

/**
 * Inspector surface for one selected Program Surface image placement. It owns
 * only local controls and reads: fallback assignment and bridge approval each
 * route through their narrow command-bus feature action, while host liveness
 * comes from the independent runtime registry. Neither bridge data nor
 * approval data is written directly here.
 */
export function ProgramSurfaceSection({
	document,
	node,
}: {
	readonly document: SceneDocument;
	readonly node: VectorNode;
}) {
	if (node.geometry.kind !== "image") return null;
	const asset = programSurfaceAssetForGeometry(document, node.geometry);
	if (!asset) return null;
	return (
		<ProgramSurfaceInspectorSection
			key={asset.id}
			document={document}
			nodeId={node.id}
			asset={asset}
		/>
	);
}

function ProgramSurfaceInspectorSection({
	document,
	nodeId,
	asset,
}: {
	readonly document: SceneDocument;
	readonly nodeId: string;
	readonly asset: ProgramSurfaceAsset;
}) {
	const bridgeClientRef = useRef<ProgramSurfaceBridgeClient | null>(null);
	let bridgeClient = bridgeClientRef.current;
	if (!bridgeClient) {
		bridgeClient = createProgramSurfaceBridgeClient();
		bridgeClientRef.current = bridgeClient;
	}
	const [bridgeSnapshot, setBridgeSnapshot] =
		useState<ProgramSurfaceBridgeClientSnapshot>(() => bridgeClient.snapshot());
	const [, setApprovalRevision] = useState(0);
	const [, setRuntimeRevision] = useState(0);
	const [feedback, setFeedback] = useState<Feedback | null>(null);
	const [localApprovalPending, setLocalApprovalPending] = useState(false);
	const [selectedFallbackAssetId, setSelectedFallbackAssetId] = useState("");
	const fallbackSelectId = useId();
	const fallbackDescriptionId = useId();

	useEffect(() => {
		setBridgeSnapshot(bridgeClient.snapshot());
		const unsubscribe = bridgeClient.subscribe(() => {
			setBridgeSnapshot(bridgeClient.snapshot());
		});
		const unsubscribeSession = subscribeEditorSessionDescriptor(
			(descriptor) => {
				bridgeClient.invalidateIfTargetChanged(descriptor);
			},
		);
		return () => {
			unsubscribe();
			unsubscribeSession();
			bridgeClient.close();
		};
	}, [bridgeClient]);

	useEffect(
		() =>
			programSurfaceLocalApprovalRegistry.subscribe(() => {
				setApprovalRevision((revision) => revision + 1);
			}),
		[],
	);

	useEffect(
		() =>
			programSurfaceRuntimeStatusRegistry.subscribe(() => {
				setRuntimeRevision((revision) => revision + 1);
			}),
		[],
	);

	const readModel = programSurfaceAssetReadModel(
		document,
		asset.id,
		programSurfaceLocalApprovalRegistry.approvals(),
	);
	const localReceipt = programSurfaceLocalApprovalRegistry.receiptFor(asset.id);
	const runtime = programSurfaceRuntimeStatusRegistry.statusFor(
		asset.id,
		nodeId,
	);
	const canApproveManual =
		asset.source.kind === "data-url" &&
		asset.manifest.source.portability === "self-contained";
	const fallbackCandidates = programSurfaceFallbackCandidates(
		document,
		asset.id,
	);
	const currentFallbackAssetId =
		readModel.fallback.state === "ready"
			? (readModel.fallback.assetId ?? "")
			: "";
	const selectedFallbackIsAvailable = fallbackCandidates.some(
		(candidate) => candidate.id === selectedFallbackAssetId,
	);
	const currentFallbackIsAvailable = fallbackCandidates.some(
		(candidate) => candidate.id === currentFallbackAssetId,
	);
	const canAssignFallback =
		selectedFallbackIsAvailable &&
		selectedFallbackAssetId !== currentFallbackAssetId;
	useEffect(() => {
		setSelectedFallbackAssetId(
			currentFallbackIsAvailable ? currentFallbackAssetId : "",
		);
	}, [currentFallbackAssetId, currentFallbackIsAvailable]);

	const approveManual = async (): Promise<void> => {
		setLocalApprovalPending(true);
		try {
			setFeedback(
				localApprovalFeedback(
					await programSurfaceLocalApprovalRegistry.approve(asset),
					currentProgramSurfaceFallbackContinuity(asset.id),
				),
			);
		} catch {
			setFeedback({
				tone: "warning",
				message: `Local approval did not complete. ${currentProgramSurfaceFallbackContinuity(asset.id)}`,
			});
		} finally {
			setLocalApprovalPending(false);
		}
	};

	const revoke = (): void => {
		programSurfaceLocalApprovalRegistry.revoke(asset.id);
		setFeedback({
			tone: "neutral",
			message: `Local execution approval was revoked. ${currentProgramSurfaceFallbackContinuity(asset.id)}`,
		});
	};

	const assignFallback = (): void => {
		if (!selectedFallbackIsAvailable) return;
		setFeedback(
			fallbackAssignmentFeedback(
				assignProgramSurfaceFallback(asset.id, selectedFallbackAssetId),
				fallbackCandidates,
			),
		);
	};

	return (
		<section className="border-hairline/70 border-b px-1.5 pb-1.5 last:border-b-0">
			<div className="sticky top-0 z-20 -mx-1.5 mb-1.5 flex h-6 items-center justify-between gap-1 border-hairline/70 border-b bg-surface-raised/96 px-1.5 text-fg-secondary text-ui backdrop-blur-xl">
				<div className="flex min-w-0 items-center gap-1 font-medium">
					<Code aria-hidden="true" size={12} />
					<span className="truncate">Program Surface</span>
				</div>
				<span className="font-mono text-fg-subtle text-ui">
					{asset.manifest.source.portability}
				</span>
			</div>

			<div className="space-y-1.5">
				<div className="grid grid-cols-2 gap-1">
					<Readout label="Runtime" value={asset.manifest.runtime.kind} />
					<Readout
						label="Digest"
						value={shortDigest(asset.manifest.runtime.compiledDigest)}
					/>
				</div>
				<div className="grid grid-cols-2 gap-1">
					<Readout label="Editor" value={asset.manifest.delivery.editor} />
					<Readout label="SVG/PDF" value={asset.manifest.delivery.svgPdf} />
				</div>
				<div className="grid grid-cols-2 gap-1">
					<Readout label="Player" value={asset.manifest.delivery.webglPlayer} />
					<Readout label="Video" value={asset.manifest.delivery.video} />
				</div>
				<Readout label="Host" value={runtimeLabel(runtime)} />

				<div
					className={cn(
						"space-y-1 rounded-md border p-1.5",
						readModel.fallback.state === "ready"
							? "border-accent/35 bg-accent-surface/35"
							: "border-warn/45 bg-warn-surface",
					)}
				>
					<div className="flex items-center justify-between gap-1 text-ui">
						<span className="font-medium text-fg-secondary">
							Raster fallback
						</span>
						<span
							className={cn(
								"text-right",
								readModel.fallback.state === "ready"
									? "text-accent-fg"
									: "text-warn-fg",
							)}
						>
							{fallbackStateLabel(readModel.fallback.state)}
						</span>
					</div>
					<p
						id={fallbackDescriptionId}
						role="status"
						aria-live="polite"
						className={cn(
							"text-ui",
							readModel.fallback.state === "ready"
								? "text-fg-muted"
								: "text-warn-fg",
						)}
					>
						{fallbackStateMessage(
							readModel.fallback.state,
							readModel.fallback.assetId,
							fallbackCandidates.length,
						)}
					</p>
					<label className="block min-w-0" htmlFor={fallbackSelectId}>
						<span className="mb-0.5 block text-fg-muted text-ui">
							Choose existing image
						</span>
						<select
							id={fallbackSelectId}
							value={selectedFallbackAssetId}
							disabled={fallbackCandidates.length === 0}
							aria-invalid={readModel.fallback.state !== "ready"}
							aria-describedby={fallbackDescriptionId}
							onChange={(event) =>
								setSelectedFallbackAssetId(event.currentTarget.value)
							}
							className="h-6 w-full rounded-md border border-hairline bg-surface-sunken px-1.5 text-fg text-ui outline-none transition focus:border-accent/70 disabled:cursor-not-allowed disabled:opacity-45"
						>
							<option value="" disabled>
								{fallbackCandidates.length === 0
									? "No usable image assets available"
									: "Choose an image fallback"}
							</option>
							{fallbackCandidates.map((candidate) => (
								<option key={candidate.id} value={candidate.id}>
									{candidate.name} ({candidate.id})
								</option>
							))}
						</select>
					</label>
					<button
						type="button"
						disabled={!canAssignFallback}
						onClick={assignFallback}
						className={cn(controlButton, primaryControlButton, "w-full")}
					>
						<Check aria-hidden="true" size={12} />
						Assign selected fallback
					</button>
					<p className="text-fg-subtle text-ui">
						Only distinct usable image assets are listed. Assignment does not
						approve or execute the surface.
					</p>
				</div>

				<div className="space-y-1 rounded-md border border-hairline bg-surface-sunken p-1.5">
					<div className="flex items-center justify-between gap-1 text-fg-secondary text-ui">
						<span className="font-medium">Local execution</span>
						<span className="text-fg-subtle">
							{localReceipt
								? `Approved (${localReceipt.source})`
								: "Not approved"}
						</span>
					</div>
					{canApproveManual ? (
						<button
							type="button"
							disabled={localApprovalPending}
							onClick={() => void approveManual()}
							className={cn(controlButton, primaryControlButton, "w-full")}
						>
							<Check aria-hidden="true" size={12} />
							Approve self-contained bundle
						</button>
					) : (
						<p className="text-fg-muted text-ui">
							Reference-only source needs the explicit local bridge candidate
							flow.
						</p>
					)}
					{localReceipt ? (
						<button
							type="button"
							onClick={revoke}
							className={cn(controlButton, "w-full")}
						>
							<X aria-hidden="true" size={12} />
							Revoke local approval
						</button>
					) : null}
				</div>

				<div className="space-y-1 rounded-md border border-hairline bg-surface-sunken p-1.5">
					<div className="flex items-center gap-1 text-fg-secondary text-ui">
						<LinkSimple aria-hidden="true" size={12} />
						<span className="font-medium">Local VS Code bridge</span>
					</div>
					<BridgeControls
						assetId={asset.id}
						bridgeClient={bridgeClient}
						snapshot={bridgeSnapshot}
						onFeedback={setFeedback}
					/>
				</div>

				{readModel.issues.length > 0 ? (
					<div className="space-y-0.5 rounded-md border border-warn/45 bg-warn-surface px-1.5 py-1 text-warn-fg text-ui">
						<Warning aria-hidden="true" size={12} />
						{readModel.issues.slice(0, 2).map((issue) => (
							<p key={issue.code}>{issue.code}</p>
						))}
					</div>
				) : null}
				<FeedbackNotice feedback={feedback} />
			</div>
		</section>
	);
}
