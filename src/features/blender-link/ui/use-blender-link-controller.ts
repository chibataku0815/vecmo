import { useCallback, useEffect, useMemo, useState } from "react";
import {
	readProductionLinkBinding,
	unbindProductionLink,
} from "@/entities/editor-session/model/production-link-registry";
import {
	createLinkProductionCommand,
	createUnlinkProductionCommand,
} from "@/entities/scene/model/node-commands";
import { resolveExternalProductionLink } from "@/entities/scene/model/production-link";
import type {
	ProductionLinkDiscoveryRecord,
	ProductionLinkSourceOffer,
} from "@/entities/scene/model/production-link-protocol";
import { useSceneStore } from "@/entities/scene/model/store";
import type { ExternalSceneAsset } from "@/entities/scene/model/types";
import { createBlenderCompanionClient } from "../model/companion-client";
import {
	createInitialProductionLink,
	resolvePerspectiveCameraContract,
} from "../model/link-authoring";
import { type BlenderLinkEntry, blenderLinkWorkflow } from "../model/workflow";

type PendingAction =
	| "discover"
	| "connect"
	| "bind"
	| "refresh"
	| "rebuild"
	| "unlink"
	| null;

export type BlenderLinkFeedback = {
	readonly tone: "neutral" | "success" | "warning";
	readonly message: string;
};

/**
 * Single controller shared by the Assets panel affordance and the Inspector
 * section, so both surfaces drive the exact same feature store and neither
 * accidentally becomes a second owner of connection or link state. Ephemeral
 * UI-only state (the discovery listing, the pairing token draft, the chosen
 * source offer) lives here, in the widget-facing layer; every durable write
 * still goes through a Scene command, and every companion transaction still
 * goes through `blenderLinkWorkflow()`.
 */
export function useBlenderLinkController(asset: ExternalSceneAsset) {
	const workflow = blenderLinkWorkflow();
	// `workflow.snapshot()` deliberately mints a fresh array/object on every
	// call (see its own doc comment), so it cannot serve as a `getSnapshot`
	// for `useSyncExternalStore` directly — that hook requires a referentially
	// stable result between renders when nothing changed, and a fresh object
	// every time trips React's "getSnapshot should be cached" infinite-loop
	// guard. A revision counter plus a memoized read (the same pattern
	// `ExternalAssetRuntimePreviewLayer` already uses for the resolver) is the
	// bridge between the two.
	const [revision, setRevision] = useState(0);
	useEffect(
		() => workflow.subscribe(() => setRevision((current) => current + 1)),
		[workflow],
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `revision` is a deliberate extra dependency so a workflow emit re-reads the snapshot.
	const snapshot = useMemo(() => workflow.snapshot(), [workflow, revision]);
	const link = resolveExternalProductionLink(asset);
	const entry: BlenderLinkEntry | undefined = link
		? snapshot.entries.find((candidate) => candidate.linkId === link.linkId)
		: undefined;

	const [discovery, setDiscovery] =
		useState<ProductionLinkDiscoveryRecord | null>(null);
	const [pairingToken, setPairingToken] = useState("");
	const [selectedSourceToken, setSelectedSourceToken] = useState<string | null>(
		null,
	);
	const [pending, setPending] = useState<PendingAction>(null);
	const [feedback, setFeedback] = useState<BlenderLinkFeedback | null>(null);

	// Once connected, any asset that already carries a durable link plus a
	// working-copy registry binding from an earlier session is rebound
	// automatically. Without this, reopening the same desktop would leave every
	// previously linked asset stuck at Disconnected until the user re-picked a
	// source offer it had already chosen once.
	useEffect(() => {
		if (!snapshot.connected || !link || entry) return;
		const binding = readProductionLinkBinding(link.linkId);
		if (!binding) return;
		void workflow.bindLink({
			assetId: asset.id,
			linkId: link.linkId,
			localPathToken: binding.localPathToken,
		});
	}, [snapshot.connected, link, entry, asset.id, workflow]);

	const discover = useCallback(async (): Promise<void> => {
		setPending("discover");
		try {
			const record = await createBlenderCompanionClient().discover();
			setDiscovery(record);
			setFeedback(
				record
					? {
							tone: "neutral",
							message:
								"Companion discovered. Enter its pairing token to connect.",
						}
					: {
							tone: "warning",
							message: "No local Blender companion found on the loopback port.",
						},
			);
		} finally {
			setPending(null);
		}
	}, []);

	const connect = useCallback(async (): Promise<void> => {
		const token = pairingToken.trim();
		if (!token) return;
		setPending("connect");
		try {
			const ok = await workflow.connect({ pairingToken: token });
			setFeedback(
				ok
					? { tone: "success", message: "Paired with the local companion." }
					: {
							tone: "warning",
							message: "Pairing did not complete. Re-run discovery and retry.",
						},
			);
		} finally {
			setPairingToken("");
			setPending(null);
		}
	}, [pairingToken, workflow]);

	const linkNow = useCallback(async (): Promise<void> => {
		if (!selectedSourceToken || !discovery) return;
		const offer = discovery.sources.find(
			(candidate) => candidate.localPathToken === selectedSourceToken,
		);
		if (!offer) return;
		const cameraResolution = resolvePerspectiveCameraContract(
			useSceneStore.getState().document,
			asset.id,
		);
		if (!cameraResolution.ok) {
			setFeedback({ tone: "warning", message: cameraResolution.reason });
			return;
		}
		const initialLink = createInitialProductionLink({
			camera: cameraResolution.contract,
			sourceOffer: offer,
			fps: cameraResolution.fps,
			durationFrames: cameraResolution.durationFrames,
		});
		setPending("bind");
		try {
			const before = useSceneStore.getState().document;
			useSceneStore.getState().apply(
				createLinkProductionCommand(asset.id, initialLink, {
					label: "Link Blender scene",
				}),
			);
			if (useSceneStore.getState().document === before) {
				setFeedback({
					tone: "warning",
					message: "The scene rejected this link contract.",
				});
				return;
			}
			const result = await workflow.bindLink({
				assetId: asset.id,
				linkId: initialLink.linkId,
				localPathToken: offer.localPathToken,
			});
			// `bindLink` can land on "relink-required" as a silent failure path
			// (the companion rejected the bind, most often because a stale local
			// registry entry advanced the binding epoch mid-request and fenced the
			// session that had just paired against the previous one) — that is
			// not success and must not be reported as "Bound".
			const bound = result.state === "ready" || result.state === "stale";
			setFeedback(
				bound
					? {
							tone: "success",
							message: "Bound. Rebuild to produce the first artifact.",
						}
					: {
							tone: "warning",
							message: `Binding did not complete (${result.failureCode ?? result.state}). If this repeats, Disconnect and pair again.`,
						},
			);
		} finally {
			setPending(null);
		}
	}, [selectedSourceToken, discovery, asset.id, workflow]);

	// "Relink required" means the durable link contract survived (same
	// linkId, still on the asset) but this working copy has no local-path
	// registry entry for it — a second working copy, a cleared registry, or a
	// fork that did not inherit the entry. Recovering is just re-running the
	// same bind the initial link used, against the *existing* linkId: no new
	// link contract, no document mutation at all.
	const relink = useCallback(async (): Promise<void> => {
		if (!link || !selectedSourceToken || !discovery) return;
		const offer = discovery.sources.find(
			(candidate) => candidate.localPathToken === selectedSourceToken,
		);
		if (!offer) return;
		setPending("bind");
		try {
			const result = await workflow.bindLink({
				assetId: asset.id,
				linkId: link.linkId,
				localPathToken: offer.localPathToken,
			});
			// See the matching comment in `linkNow`: "relink-required" is a
			// silent-failure outcome of this same call, not a variant of success.
			const bound = result.state === "ready" || result.state === "stale";
			setFeedback(
				bound
					? {
							tone: "success",
							message: "Relinked to the local source.",
						}
					: {
							tone: "warning",
							message: `Relink did not complete (${result.failureCode ?? result.state}). If this repeats, Disconnect and pair again.`,
						},
			);
		} finally {
			setPending(null);
		}
	}, [link, selectedSourceToken, discovery, asset.id, workflow]);

	const refresh = useCallback(async (): Promise<void> => {
		if (!link) return;
		setPending("refresh");
		try {
			await workflow.refresh(link.linkId);
		} finally {
			setPending(null);
		}
	}, [link, workflow]);

	const rebuild = useCallback(async (): Promise<void> => {
		if (!link) return;
		setPending("rebuild");
		try {
			await workflow.rebuild(link.linkId);
		} finally {
			setPending(null);
		}
	}, [link, workflow]);

	// An unlink (or any other epoch-advancing local change) fences off the
	// companion session that was paired before it, since that pairing's target
	// tuple no longer matches. The workflow has no way to silently re-pair for
	// the user, so this is the explicit escape hatch: drop the stale session
	// and let Discover/Connect run again against the current fence.
	const disconnect = useCallback((): void => {
		workflow.disconnect();
		setFeedback({
			tone: "neutral",
			message: "Disconnected. Discover and pair again to reconnect.",
		});
	}, [workflow]);

	const unlink = useCallback((): void => {
		if (!link) return;
		setPending("unlink");
		try {
			useSceneStore.getState().apply(
				createUnlinkProductionCommand(asset.id, {
					label: "Unlink Blender scene",
				}),
			);
			void unbindProductionLink(link.linkId);
			// `unbindProductionLink` advances the binding epoch, and the fence
			// check on every companion message compares against the *whole*
			// session's paired target — not just this link's. A session paired
			// before this epoch advance would fail every later message with an
			// opaque rejection, so the stale session is dropped here rather than
			// left looking connected while unable to do anything.
			if (snapshot.connected) workflow.disconnect();
			setFeedback({
				tone: "neutral",
				message: snapshot.connected
					? "Unlinked and disconnected (the epoch advanced). Discover and pair again to continue."
					: "Unlinked. The placement keeps its last-produced artifact.",
			});
		} finally {
			setPending(null);
		}
	}, [link, asset.id, snapshot.connected, workflow]);

	return {
		connected: snapshot.connected,
		link,
		entry,
		discovery,
		pairingToken,
		setPairingToken,
		selectedSourceToken,
		setSelectedSourceToken,
		pending,
		feedback,
		discover,
		connect,
		disconnect,
		linkNow,
		relink,
		refresh,
		rebuild,
		unlink,
	} as const;
}

export type { ProductionLinkSourceOffer };
