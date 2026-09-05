import {
	bindProductionLink,
	readProductionLinkBinding,
} from "@/entities/editor-session/model/production-link-registry";
import {
	captureEditorBindingFence,
	isEditorBindingFenceCurrent,
} from "@/entities/editor-session/model/session";
import { useMotionStore } from "@/entities/motion/model/store";
import { createLinkProductionCommand } from "@/entities/scene/model/node-commands";
import {
	canonicalProductionJson,
	deriveProductionBuildKey,
	type ProductionArtifactIdentity,
	type ProductionBuildEnvironment,
	sameProductionArtifactIdentity,
} from "@/entities/scene/model/production-artifacts";
import { productionControlTrackDigestInput } from "@/entities/scene/model/production-control";
import { mimeTypeForFramePackageCodec } from "@/entities/scene/model/production-frame-package";
import {
	type ExternalProductionLink,
	resolveExternalProductionLink,
} from "@/entities/scene/model/production-link";
import {
	PRODUCTION_LINK_ARTIFACT_MIME_TYPE,
	type ProductionLinkDiagnostic,
	type ProductionLinkEditorTarget,
	type ProductionLinkInspectResultMessage,
} from "@/entities/scene/model/production-link-protocol";
import type { Runtime3dProductionArtifactResolver } from "@/entities/scene/model/runtime-3d";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	ExternalSceneAsset,
	SceneDocument,
} from "@/entities/scene/model/types";
import {
	createProductionArtifactCache,
	type ProductionArtifactCache,
} from "./artifact-cache";
import {
	type BlenderCompanionClient,
	createBlenderCompanionClient,
} from "./companion-client";

/**
 * Owns the visible lifecycle of every linked Blender production in this working
 * copy.
 *
 * Four rules define this module and each maps to a failure this design refuses
 * to hide:
 *
 * - The workflow NEVER writes `SceneDocument` directly. Every durable change
 *   goes through `scene/link-production` on the Scene command bus, so a linked
 *   source participates in undo exactly like any other authored edit.
 * - There is no filesystem watcher in V1. Drift becomes visible only through an
 *   explicit Refresh, which re-inspects the source; a watcher that silently
 *   re-derived state would make "when did this go stale" unanswerable.
 * - A completed build is admitted to the cache only after digest verification.
 *   The previous good artifact is retained and marked stale rather than
 *   discarded, so the canvas keeps showing something true about the past
 *   instead of nothing at all.
 * - The desired build key is derived, never stored. With no fresh inspect there
 *   is no desired key, and the honest state is Disconnected — not Ready and not
 *   Stale.
 */

/** Visible states, exactly as the design's state table enumerates them. */
export type BlenderLinkState =
	| "disconnected"
	| "relink-required"
	| "inspecting"
	| "stale"
	| "building"
	| "ready"
	| "failed";

export type BlenderLinkFailureCode =
	| "companion-unavailable"
	| "fence-stale"
	| "inspect-failed"
	| "build-failed"
	| "artifact-rejected"
	| "profile-unsupported"
	| "build-key-underivable"
	| "scene-command-rejected";

export type BlenderLinkEntry = {
	readonly linkId: string;
	readonly assetId: string;
	readonly state: BlenderLinkState;
	readonly displayName?: string;
	/** Derived from document link plus freshly inspected environment. */
	readonly desired?: ProductionArtifactIdentity;
	/** Verified and currently resolvable. */
	readonly resolved?: ProductionArtifactIdentity;
	/** Retained across drift so the canvas can stay visibly stale, not blank. */
	readonly lastKnownGood?: ProductionArtifactIdentity;
	readonly observedSourceDigest?: string;
	readonly diagnostics: readonly ProductionLinkDiagnostic[];
	readonly failureCode?: BlenderLinkFailureCode;
};

export type BlenderLinkSnapshot = {
	readonly connected: boolean;
	readonly entries: readonly BlenderLinkEntry[];
};

export type BlenderLinkWorkflow = {
	readonly snapshot: () => BlenderLinkSnapshot;
	readonly subscribe: (listener: () => void) => () => void;
	/**
	 * Synchronous, pure resolver handed to `compileRuntime3dFrame`. It performs
	 * a map lookup only: every derivation that needs WebCrypto already happened.
	 */
	readonly resolver: () => Runtime3dProductionArtifactResolver;
	readonly connect: (input: {
		readonly pairingToken: string;
	}) => Promise<boolean>;
	readonly bindLink: (input: {
		readonly assetId: string;
		readonly linkId: string;
		readonly localPathToken: string;
	}) => Promise<BlenderLinkEntry>;
	/** Explicit re-inspection. This is the only drift detector in V1. */
	readonly refresh: (linkId: string) => Promise<BlenderLinkEntry>;
	readonly rebuild: (linkId: string) => Promise<BlenderLinkEntry>;
	readonly disconnect: () => void;
	readonly dispose: () => void;
};

type MutableEntry = {
	linkId: string;
	assetId: string;
	state: BlenderLinkState;
	displayName?: string;
	desired?: ProductionArtifactIdentity;
	resolved?: ProductionArtifactIdentity;
	lastKnownGood?: ProductionArtifactIdentity;
	observedSourceDigest?: string;
	environment?: ProductionBuildEnvironment;
	diagnostics: readonly ProductionLinkDiagnostic[];
	failureCode?: BlenderLinkFailureCode;
};

const targetFromFence = (
	fence: ReturnType<typeof captureEditorBindingFence>,
): ProductionLinkEditorTarget => ({
	editorInstanceId: fence.editorInstanceId,
	workingCopyId: fence.workingCopyId,
	bindingEpoch: fence.bindingEpoch,
});

const linkedAssetById = (assetId: string): ExternalSceneAsset | null => {
	const asset = useSceneStore
		.getState()
		.document.assets?.find((entry) => entry.id === assetId);
	return asset?.kind === "model-3d" ? asset : null;
};

/**
 * Rebuilds the durable link from a fresh inspect. Vecmo remains authoritative
 * for the camera contract, so only source, frame, controls, and profile are
 * adopted from the producing side.
 */
const linkFromInspect = (
	current: ExternalProductionLink,
	inspect: ProductionLinkInspectResultMessage,
): ExternalProductionLink => ({
	...current,
	source: {
		...current.source,
		displayName: inspect.displayName,
		sourceDigest: inspect.sourceDigest,
	},
	frame: {
		fps: inspect.frame.fps,
		durationFrames: inspect.frame.durationFrames,
		blenderFrameStart: inspect.frame.blenderFrameStart,
	},
	outputProfile: inspect.outputProfile,
	controls: inspect.controls,
});

/**
 * Canonical, key-order-insensitive comparison. Plain `JSON.stringify` would
 * report a difference whenever the command bus re-emits the same contract in
 * its own field order — for instance when a first inspect adds `sourceDigest`
 * after an existing `sceneSelector` — and a successful write would then be
 * misreported as a rejected scene command.
 */
const sameLink = (
	left: ExternalProductionLink,
	right: ExternalProductionLink,
): boolean => canonicalProductionJson(left) === canonicalProductionJson(right);

export const createBlenderLinkWorkflow = ({
	cache = createProductionArtifactCache(),
	client = createBlenderCompanionClient(),
}: {
	readonly cache?: ProductionArtifactCache;
	readonly client?: BlenderCompanionClient;
} = {}): BlenderLinkWorkflow => {
	const listeners = new Set<() => void>();
	const entries = new Map<string, MutableEntry>();
	let connected = false;

	const emit = (): void => {
		// Both the resolved and the last-known-good identity are pinned, because
		// the resolver may still be handing the canvas the stale one. Evicting an
		// artifact the renderer is currently resolving to would revoke a live
		// object URL, which surfaces as an unexplained blank placement.
		cache.pin(
			[...entries.values()]
				.flatMap((entry) => [entry.resolved, entry.lastKnownGood])
				.filter((identity): identity is ProductionArtifactIdentity =>
					Boolean(identity),
				),
		);
		for (const listener of listeners) listener();
	};

	const publicEntry = (entry: MutableEntry): BlenderLinkEntry => ({
		linkId: entry.linkId,
		assetId: entry.assetId,
		state: entry.state,
		...(entry.displayName ? { displayName: entry.displayName } : {}),
		...(entry.desired ? { desired: entry.desired } : {}),
		...(entry.resolved ? { resolved: entry.resolved } : {}),
		...(entry.lastKnownGood ? { lastKnownGood: entry.lastKnownGood } : {}),
		...(entry.observedSourceDigest
			? { observedSourceDigest: entry.observedSourceDigest }
			: {}),
		diagnostics: entry.diagnostics,
		...(entry.failureCode ? { failureCode: entry.failureCode } : {}),
	});

	const requireEntry = (linkId: string): MutableEntry => {
		const entry = entries.get(linkId);
		if (!entry)
			throw new Error("This production link is not bound in this session.");
		return entry;
	};

	const fail = (
		entry: MutableEntry,
		failureCode: BlenderLinkFailureCode,
	): BlenderLinkEntry => {
		entry.state = "failed";
		entry.failureCode = failureCode;
		emit();
		return publicEntry(entry);
	};

	/**
	 * Recomputes the desired key and settles the visible state from it. This is
	 * the one place the Ready/Stale distinction is made, so a caller can never
	 * declare Ready without an identity match.
	 */
	const settleState = async (entry: MutableEntry): Promise<void> => {
		const asset = linkedAssetById(entry.assetId);
		const link = resolveExternalProductionLink(asset);
		if (!link || !entry.environment) {
			entry.state = "disconnected";
			entry.desired = undefined;
			return;
		}
		if (link.outputProfile !== "interactive-glb") {
			entry.state = "failed";
			entry.failureCode = "profile-unsupported";
			entry.desired = undefined;
			return;
		}
		// The Motion side-car is the other half of what the producing side is
		// asked to evaluate, so it belongs in the desired key: a control keyframe
		// edit must invalidate the artifact exactly like a static value edit
		// does. A document with no control tracks projects to `[]`, which is the
		// derivation's own default, so this leaves every existing key unchanged.
		const buildKey = await deriveProductionBuildKey(
			link,
			entry.environment,
			productionControlTrackDigestInput(
				useMotionStore.getState().document,
				link.linkId,
			),
		);
		if (!buildKey) {
			entry.state = "failed";
			entry.failureCode = "build-key-underivable";
			entry.desired = undefined;
			return;
		}
		entry.desired = { linkId: link.linkId, buildKey };
		const matches =
			sameProductionArtifactIdentity(entry.resolved, entry.desired) &&
			Boolean(entry.resolved && cache.get(entry.resolved));
		entry.state = matches ? "ready" : "stale";
	};

	const applyLink = (
		entry: MutableEntry,
		next: ExternalProductionLink,
	): boolean => {
		const asset = linkedAssetById(entry.assetId);
		const current = resolveExternalProductionLink(asset);
		if (!current) return false;
		if (sameLink(current, next)) return true;
		const before = useSceneStore.getState().document;
		useSceneStore.getState().apply(
			createLinkProductionCommand(entry.assetId, next, {
				label: "Update linked production",
			}),
		);
		const after = useSceneStore.getState().document;
		if (after === before) return false;
		const applied = resolveExternalProductionLink(
			linkedAssetById(entry.assetId),
		);
		return Boolean(applied && sameLink(applied, next));
	};

	const inspectInto = async (
		entry: MutableEntry,
		target: ProductionLinkEditorTarget,
	): Promise<boolean> => {
		entry.state = "inspecting";
		emit();
		let inspect: ProductionLinkInspectResultMessage;
		try {
			inspect = await client.inspect({ linkId: entry.linkId, target });
		} catch {
			fail(entry, "inspect-failed");
			return false;
		}
		entry.displayName = inspect.displayName;
		entry.diagnostics = inspect.diagnostics;
		entry.observedSourceDigest = inspect.sourceDigest;
		entry.environment = {
			blenderVersion: inspect.environment.blenderVersion,
			environmentDigest: inspect.environment.environmentDigest,
			renderSettingsDigest: inspect.environment.renderSettingsDigest,
			sourceDigest: inspect.sourceDigest,
		};
		// Stamp the observed digest onto the binding that already exists, and only
		// onto that one. Writing a fabricated `localPathToken: ""` when the read
		// came back empty looked harmless, but the registry reads a changed token
		// as a source rebind: it advanced the editor binding epoch in the middle
		// of this very call, and the fence check a few lines downstream then
		// failed the inspect that had just succeeded.
		const existingBinding = readProductionLinkBinding(entry.linkId);
		if (existingBinding) {
			void bindProductionLink(entry.linkId, {
				...existingBinding,
				sourceDigest: inspect.sourceDigest,
				lastBoundAt: Date.now(),
			});
		}
		const asset = linkedAssetById(entry.assetId);
		const current = resolveExternalProductionLink(asset);
		if (!current) {
			fail(entry, "inspect-failed");
			return false;
		}
		if (!applyLink(entry, linkFromInspect(current, inspect))) {
			fail(entry, "scene-command-rejected");
			return false;
		}
		return true;
	};

	return {
		snapshot: () => ({
			connected,
			entries: [...entries.values()].map(publicEntry),
		}),
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		/**
		 * A resolved artifact that no longer matches the desired key is still
		 * returned, flagged `stale`. The design keeps the last known good preview
		 * visible during Stale and Building instead of dropping the canvas back to
		 * the pre-link source, and the flag is what stops that from reading as
		 * Ready.
		 */
		resolver: () => (link) => {
			const entry = entries.get(link.linkId);
			// `null` keeps ONE meaning: this resolver has never heard of the link,
			// so it has no standing to say anything about it. Every case where the
			// resolver DOES own the link but has nothing to hand back is typed
			// below. Before S4 those cases also returned a bare `null` and the
			// band went dark with no issue emitted anywhere — a rendered link,
			// which is admitted by kind alone, hit that path on its very first
			// frame.
			if (!entry) return null;
			const identity = entry.resolved ?? entry.lastKnownGood;
			const rendered = link.outputProfile === "rendered-rgba-sequence";
			const missingCode = rendered
				? ("production-frame-package-missing" as const)
				: ("production-artifact-missing" as const);
			if (!identity) {
				return { kind: "unavailable", linkId: link.linkId, code: missingCode };
			}
			const stale = !sameProductionArtifactIdentity(identity, entry.desired);
			if (rendered) {
				const pkg = cache.getFramePackage(identity);
				if (!pkg) {
					return {
						kind: "unavailable",
						linkId: link.linkId,
						code: "production-frame-package-missing",
					};
				}
				return {
					kind: "frame-sequence",
					linkId: identity.linkId,
					buildKey: identity.buildKey,
					stale,
					frameHrefs: pkg.frameHrefs,
					// The manifest's own origin and count, never the link's. The
					// compiler converts a Blender-space frame to a package index with
					// these, so a package that disagrees with its link reports out of
					// range instead of drawing a shifted band.
					blenderFrameStart: pkg.manifest.blenderFrameStart,
					frameCount: pkg.manifest.frameCount,
					width: pkg.manifest.width,
					height: pkg.manifest.height,
					mimeType: mimeTypeForFramePackageCodec(pkg.manifest.codec),
					reproducible: pkg.manifest.reproducible,
				};
			}
			const cached = cache.get(identity);
			if (!cached) {
				return {
					kind: "unavailable",
					linkId: link.linkId,
					code: "production-artifact-missing",
				};
			}
			return {
				kind: "model",
				linkId: identity.linkId,
				buildKey: identity.buildKey,
				href: cached.href,
				stale,
			};
		},
		connect: async ({ pairingToken }) => {
			const discovery = await client.discover();
			if (!discovery) {
				connected = false;
				emit();
				return false;
			}
			try {
				await client.pair({
					pairingToken,
					target: targetFromFence(captureEditorBindingFence()),
				});
			} catch {
				connected = false;
				emit();
				return false;
			}
			connected = true;
			emit();
			return true;
		},
		bindLink: async ({ assetId, linkId, localPathToken }) => {
			const existing = entries.get(linkId);
			const entry: MutableEntry = existing ?? {
				linkId,
				assetId,
				state: "disconnected",
				diagnostics: [],
			};
			entry.assetId = assetId;
			entries.set(linkId, entry);
			if (!connected) {
				entry.state = "disconnected";
				emit();
				return publicEntry(entry);
			}
			// The registry write comes first and the fence is captured after it,
			// because pointing this link at a different source advances the epoch
			// synchronously inside the write. Capturing first would send the
			// companion an epoch this editor had already superseded.
			//
			// The other half of that ordering lives in the protocol: the companion
			// paired at whatever epoch was current when the user connected, so a
			// bind that legitimately carries a NEWER epoch has to be accepted and
			// re-stamped rather than refused. `productionLinkTargetIsCurrentOrNewer`
			// is that rule; without it the first relink of a live session was
			// unauthorizable for good, since the pairing token is single use and
			// no second session could be minted.
			await bindProductionLink(linkId, {
				localPathToken,
				lastBoundAt: Date.now(),
			});
			const fence = captureEditorBindingFence();
			const target = targetFromFence(fence);
			try {
				entry.displayName = await client.bind({
					linkId,
					localPathToken,
					target,
				});
			} catch {
				entry.state = "relink-required";
				emit();
				return publicEntry(entry);
			}
			if (!(await inspectInto(entry, target))) return publicEntry(entry);
			if (!isEditorBindingFenceCurrent(fence))
				return fail(entry, "fence-stale");
			await settleState(entry);
			emit();
			return publicEntry(entry);
		},
		refresh: async (linkId) => {
			const entry = requireEntry(linkId);
			if (!connected) {
				entry.state = "disconnected";
				emit();
				return publicEntry(entry);
			}
			if (!readProductionLinkBinding(linkId)) {
				entry.state = "relink-required";
				emit();
				return publicEntry(entry);
			}
			const fence = captureEditorBindingFence();
			const target = targetFromFence(fence);
			if (!client.isBoundToTarget(target)) return fail(entry, "fence-stale");
			if (!(await inspectInto(entry, target))) return publicEntry(entry);
			if (!isEditorBindingFenceCurrent(fence))
				return fail(entry, "fence-stale");
			await settleState(entry);
			emit();
			return publicEntry(entry);
		},
		rebuild: async (linkId) => {
			const entry = requireEntry(linkId);
			const asset = linkedAssetById(entry.assetId);
			const link = resolveExternalProductionLink(asset);
			if (!link || !entry.desired || !entry.environment) {
				return fail(entry, "build-key-underivable");
			}
			if (link.outputProfile !== "interactive-glb") {
				return fail(entry, "profile-unsupported");
			}
			const fence = captureEditorBindingFence();
			const target = targetFromFence(fence);
			if (!client.isBoundToTarget(target)) return fail(entry, "fence-stale");
			const desired = entry.desired;
			entry.state = "building";
			emit();
			let result: Awaited<ReturnType<BlenderCompanionClient["build"]>>;
			try {
				result = await client.build({
					linkId,
					buildKey: desired.buildKey,
					outputProfile: link.outputProfile,
					target,
				});
			} catch {
				return fail(entry, "build-failed");
			}
			let fetched: Awaited<ReturnType<BlenderCompanionClient["fetchArtifact"]>>;
			try {
				fetched = await client.fetchArtifact(result);
			} catch {
				// A transport-level failure here (a network drop, a CORS-preflight
				// rejection) must still resolve to a terminal, visible state. Leaving
				// this unguarded left the entry parked at "building" forever — an
				// honest-state violation this design otherwise refuses everywhere else.
				return fail(entry, "artifact-rejected");
			}
			if (fetched.status !== "verified") {
				return fail(entry, "artifact-rejected");
			}
			if (!isEditorBindingFenceCurrent(fence)) {
				fetched.artifact.bytes.fill(0);
				return fail(entry, "fence-stale");
			}
			cache.admit({
				identity: desired,
				bytes: fetched.artifact.bytes,
				artifactDigest: fetched.artifact.artifactDigest,
				mimeType: PRODUCTION_LINK_ARTIFACT_MIME_TYPE,
			});
			fetched.artifact.bytes.fill(0);
			entry.resolved = desired;
			entry.lastKnownGood = desired;
			entry.failureCode = undefined;
			await settleState(entry);
			emit();
			return publicEntry(entry);
		},
		disconnect: () => {
			client.close();
			connected = false;
			for (const entry of entries.values()) {
				// The last verified artifact is kept deliberately: a disconnected
				// editor may still show what it last proved, as visibly not-Ready.
				entry.state = "disconnected";
				entry.desired = undefined;
			}
			emit();
		},
		dispose: () => {
			client.close();
			cache.dispose();
			entries.clear();
			listeners.clear();
			connected = false;
		},
	};
};

let sharedWorkflow: BlenderLinkWorkflow | null = null;

/**
 * Process-wide workflow used by the canvas widget. It is lazily created so a
 * document that links nothing never allocates a cache or a socket.
 */
export const blenderLinkWorkflow = (): BlenderLinkWorkflow => {
	sharedWorkflow ??= createBlenderLinkWorkflow();
	return sharedWorkflow;
};

/**
 * The resolver an export surface must inject so a WebM/still resolves linked
 * production artifacts through the same entity contract the canvas uses (S3c
 * closes the S1-C editor-only deferral). Returns `undefined` — never a resolver
 * — for a document that links nothing, so an ordinary project still allocates
 * no cache and no socket, and `compileRuntime3dFrame` stays on its byte-identical
 * "no resolver injected" path.
 */
export const linkedProductionResolverForScene = (
	scene: SceneDocument,
): Runtime3dProductionArtifactResolver | undefined => {
	const linksProduction = scene.assets?.some(
		(asset) => asset.kind === "model-3d" && asset.production !== undefined,
	);
	return linksProduction ? blenderLinkWorkflow().resolver() : undefined;
};
