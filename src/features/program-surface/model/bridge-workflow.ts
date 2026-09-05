import {
	captureEditorBindingFence,
	isEditorBindingFenceCurrent,
} from "@/entities/editor-session/model/session";
import { createUpdateProgramSurfaceAssetCommand } from "@/entities/scene/model/node-commands";
import {
	PROGRAM_SURFACE_BRIDGE_MAX_APPROVED_BUNDLE_BYTES,
	PROGRAM_SURFACE_COMPILED_ENTRY,
	type ProgramSurfaceBridgeApprovedBundleMessage,
	type ProgramSurfaceBridgeEditorTarget,
	type ProgramSurfaceBuildIdentity,
	serializeProgramSurfaceBridgeManifest,
} from "@/entities/scene/model/program-surface-bridge-protocol";
import { useSceneStore } from "@/entities/scene/model/store";
import type {
	ProgramSurfaceAsset,
	SceneDocument,
} from "@/entities/scene/model/types";
import type {
	ProgramSurfaceBridgeCandidateSnapshot,
	ProgramSurfaceBridgeClient,
} from "./bridge-client";
import { inspectProgramSurfaceBundleV1 } from "./bundle-static-gate";
import {
	type ProgramSurfaceLocalApprovalRegistry,
	type ProgramSurfacePreparedBridgeApproval,
	programSurfaceBridgeReferenceHref,
	programSurfaceLocalApprovalRegistry,
} from "./local-approval";

const MAX_BUNDLE_BYTES = PROGRAM_SURFACE_BRIDGE_MAX_APPROVED_BUNDLE_BYTES;
const MAX_BASE64_CHARACTERS = 4 * Math.ceil(MAX_BUNDLE_BYTES / 3);
const canonicalBase64Pattern =
	/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
let bridgeApprovalTransactionSequence = 0;

export type ProgramSurfaceBridgeCandidateApprovalResult =
	| {
			readonly status: "approved";
			readonly assetId: string;
			readonly compiledDigest: string;
	  }
	| {
			readonly status: "rejected";
			readonly code:
				| "bridge-not-bound"
				| "bridge-candidate-stale"
				| "editor-binding-stale"
				| "asset-missing"
				| "fallback-invalid"
				| "candidate-identity-invalid"
				| "bundle-invalid"
				| "bundle-hash-unavailable"
				| "bundle-digest-mismatch"
				| "scene-command-rejected"
				| "local-approval-rejected";
			readonly message: string;
	  };

type DecodedBridgeBundle = {
	readonly bundleText: string;
	readonly bytes: Uint8Array;
};

const rejected = (
	code: Extract<
		ProgramSurfaceBridgeCandidateApprovalResult,
		{ readonly status: "rejected" }
	>["code"],
	message: string,
): ProgramSurfaceBridgeCandidateApprovalResult => ({
	status: "rejected",
	code,
	message,
});

const targetFromFence = (
	fence: ReturnType<typeof captureEditorBindingFence>,
): ProgramSurfaceBridgeEditorTarget => {
	return {
		editorInstanceId: fence.editorInstanceId,
		workingCopyId: fence.workingCopyId,
		bindingEpoch: fence.bindingEpoch,
	};
};

const sameTarget = (
	left: ProgramSurfaceBridgeEditorTarget,
	right: ProgramSurfaceBridgeEditorTarget,
): boolean =>
	left.editorInstanceId === right.editorInstanceId &&
	left.workingCopyId === right.workingCopyId &&
	left.bindingEpoch === right.bindingEpoch;

const sameIdentity = (
	left: ProgramSurfaceBuildIdentity,
	right: ProgramSurfaceBuildIdentity,
): boolean =>
	left.manifestDigest === right.manifestDigest &&
	left.inputDigest === right.inputDigest &&
	left.compiledDigest === right.compiledDigest &&
	left.generation === right.generation;

const sha256 = async (bytes: Uint8Array): Promise<string | null> => {
	if (typeof globalThis.crypto?.subtle?.digest !== "function") return null;
	try {
		const exactBytes = new Uint8Array(bytes.byteLength);
		exactBytes.set(bytes);
		const digest = await globalThis.crypto.subtle.digest(
			"SHA-256",
			exactBytes.buffer,
		);
		return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
			byte.toString(16).padStart(2, "0"),
		).join("")}`;
	} catch {
		return null;
	}
};

const canonicalBase64Bytes = (base64: string): Uint8Array | null => {
	if (
		base64.length === 0 ||
		base64.length > MAX_BASE64_CHARACTERS ||
		!canonicalBase64Pattern.test(base64)
	) {
		return null;
	}
	const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
	const byteLength = (base64.length / 4) * 3 - padding;
	if (
		!Number.isSafeInteger(byteLength) ||
		byteLength <= 0 ||
		byteLength > MAX_BUNDLE_BYTES
	) {
		return null;
	}
	try {
		const binary = globalThis.atob(base64);
		if (binary.length !== byteLength || globalThis.btoa(binary) !== base64) {
			return null;
		}
		return Uint8Array.from(
			binary,
			(character) => character.codePointAt(0) ?? 0,
		);
	} catch {
		return null;
	}
};

const decodeApprovedBundle = (bundle: {
	readonly encoding: "base64";
	readonly mimeType: "text/javascript";
	readonly data: string;
}): DecodedBridgeBundle | null => {
	if (bundle.encoding !== "base64" || bundle.mimeType !== "text/javascript") {
		return null;
	}
	const bytes = canonicalBase64Bytes(bundle.data);
	if (!bytes || typeof TextDecoder === "undefined") return null;
	try {
		return {
			bytes,
			bundleText: new TextDecoder("utf-8", {
				fatal: true,
				ignoreBOM: true,
			}).decode(bytes),
		};
	} catch {
		return null;
	}
};

const candidateIdentityIssue = (
	candidate: ProgramSurfaceBridgeCandidateSnapshot,
): string | null => {
	if (
		candidate.manifest.runtime.entry !== PROGRAM_SURFACE_COMPILED_ENTRY ||
		candidate.manifest.source.portability !== "reference-only" ||
		!candidate.manifest.fallback ||
		candidate.identity.compiledDigest !==
			candidate.manifest.runtime.compiledDigest ||
		candidate.identity.inputDigest !== candidate.manifest.source.snapshotDigest
	) {
		return "The Program Surface bridge candidate does not carry one self-consistent reference-only manifest identity.";
	}
	return null;
};

const currentBoundAsset = (
	document: SceneDocument,
	candidate: ProgramSurfaceBridgeCandidateSnapshot,
): ProgramSurfaceAsset | null => {
	const asset = document.assets?.find(
		(entry) => entry.id === candidate.assetId,
	);
	if (asset?.kind !== "program-surface") return null;
	const fallbackId = candidate.manifest.fallback?.assetId;
	if (!fallbackId || fallbackId === asset.id) return null;
	const fallback = document.assets?.find((entry) => entry.id === fallbackId);
	return fallback?.kind === "image" ? asset : null;
};

const candidateManifestDigest = async (
	candidate: ProgramSurfaceBridgeCandidateSnapshot,
): Promise<string | null> => {
	if (typeof TextEncoder === "undefined") return null;
	try {
		return sha256(
			new TextEncoder().encode(
				serializeProgramSurfaceBridgeManifest(candidate.manifest),
			),
		);
	} catch {
		return null;
	}
};

const bridgeAssetForCandidate = (
	existing: ProgramSurfaceAsset,
	candidate: ProgramSurfaceBridgeCandidateSnapshot,
	referenceHref: string,
): ProgramSurfaceAsset => ({
	...existing,
	source: { kind: "reference", href: referenceHref },
	manifest: candidate.manifest,
	mimeType: "text/javascript",
});

const programSurfaceAssetSnapshot = (asset: ProgramSurfaceAsset): string =>
	JSON.stringify(asset);

const abortBridgeApprovalTransaction = (coalesceKey: string): void => {
	const store = useSceneStore.getState();
	if (store.transaction?.coalesceKey === coalesceKey) {
		store.abortTransaction();
	}
};

/**
 * Confirms that this workflow's exact Scene command, rather than a coincidental
 * later mutation, is durably represented in history. A different open
 * transaction is allowed: it began after this entry and must never be aborted
 * by this workflow.
 */
const hasCommittedBridgeUpdate = (
	transactionKey: string,
	assetId: string,
	referenceHref: string,
	candidateManifestSnapshot: string,
): boolean => {
	const state = useSceneStore.getState();
	if (state.transaction?.coalesceKey === transactionKey) return false;
	const asset = state.document.assets?.find(
		(entry): entry is ProgramSurfaceAsset =>
			entry.kind === "program-surface" && entry.id === assetId,
	);
	return Boolean(
		asset &&
			asset.source.kind === "reference" &&
			asset.source.href === referenceHref &&
			asset.mimeType === "text/javascript" &&
			serializeProgramSurfaceBridgeManifest(asset.manifest) ===
				candidateManifestSnapshot &&
			state.undoStack.some(
				(entry) => entry.meta.coalesceKey === transactionKey,
			),
	);
};

/**
 * The only browser bridge path that changes durable Program Surface metadata.
 * It begins from an existing explicitly bound asset; this V1 path never creates
 * assets or placements from a local workspace. It stages verified bridge bytes
 * in local approval before opening one Scene transaction, so a failed approval
 * cannot leave reference metadata or an undo entry behind.
 */
export const approveBoundProgramSurfaceBridgeCandidate = async ({
	approvalRegistry = programSurfaceLocalApprovalRegistry,
	client,
}: {
	readonly client: ProgramSurfaceBridgeClient;
	readonly approvalRegistry?: ProgramSurfaceLocalApprovalRegistry;
}): Promise<ProgramSurfaceBridgeCandidateApprovalResult> => {
	const initial = client.snapshot();
	const candidate = initial.candidate;
	const binding = initial.binding;
	if (
		!candidate ||
		!binding ||
		candidate.assetId !== binding.assetId ||
		candidate.manifestId !== binding.manifestId
	) {
		return rejected(
			"bridge-not-bound",
			"Select one explicitly bound Program Surface candidate before approving it.",
		);
	}
	const candidateIssue = candidateIdentityIssue(candidate);
	if (candidateIssue)
		return rejected("candidate-identity-invalid", candidateIssue);
	const fence = captureEditorBindingFence();
	const target = targetFromFence(fence);
	if (!client.isBoundToTarget(target)) {
		return rejected(
			"editor-binding-stale",
			"The bridge target does not match the current editor instance, working copy, and binding epoch.",
		);
	}
	approvalRegistry.bindSession(target);
	const manifestDigest = await candidateManifestDigest(candidate);
	if (!manifestDigest) {
		return rejected(
			"bundle-hash-unavailable",
			"This browser cannot verify the Program Surface candidate manifest identity.",
		);
	}
	if (manifestDigest !== candidate.identity.manifestDigest) {
		return rejected(
			"candidate-identity-invalid",
			"The Program Surface candidate manifest does not match the bridge identity.",
		);
	}
	if (!isEditorBindingFenceCurrent(fence) || !client.isBoundToTarget(target)) {
		return rejected(
			"editor-binding-stale",
			"The editor binding changed before Program Surface candidate approval began.",
		);
	}

	let approvedBundle: ProgramSurfaceBridgeApprovedBundleMessage;
	try {
		approvedBundle = await client.approveCandidate(candidate.identity);
	} catch {
		return rejected(
			"bridge-candidate-stale",
			"The Program Surface bridge candidate changed or closed before it could deliver the approved bundle.",
		);
	}
	if (
		approvedBundle.sessionId !== initial.sessionId ||
		approvedBundle.bindingId !== binding.bindingId ||
		approvedBundle.assetId !== binding.assetId ||
		!sameTarget(approvedBundle.target, target) ||
		!sameIdentity(approvedBundle.identity, candidate.identity)
	) {
		return rejected(
			"bridge-candidate-stale",
			"The Program Surface bridge bundle did not match the exact approved candidate and binding.",
		);
	}
	const decoded = decodeApprovedBundle(approvedBundle.bundle);
	if (!decoded) {
		return rejected(
			"bundle-invalid",
			"The Program Surface bridge bundle is not canonical base64 UTF-8 within the V1 byte boundary.",
		);
	}

	let prepared: ProgramSurfacePreparedBridgeApproval | null = null;
	try {
		if (
			inspectProgramSurfaceBundleV1(decoded.bundleText).status === "rejected"
		) {
			return rejected(
				"bundle-invalid",
				"The Program Surface bridge bundle is outside the V1 static parent-clocked execution profile.",
			);
		}
		const actualCompiledDigest = await sha256(decoded.bytes);
		if (!actualCompiledDigest) {
			return rejected(
				"bundle-hash-unavailable",
				"This browser cannot verify the Program Surface compiled bundle digest.",
			);
		}
		if (actualCompiledDigest !== candidate.identity.compiledDigest) {
			return rejected(
				"bundle-digest-mismatch",
				"The Program Surface bridge bundle does not match the candidate compiled digest.",
			);
		}
		const finalCandidateIssue = candidateIdentityIssue(candidate);
		if (finalCandidateIssue) {
			return rejected("candidate-identity-invalid", finalCandidateIssue);
		}
		const finalManifestDigest = await candidateManifestDigest(candidate);
		if (finalManifestDigest !== candidate.identity.manifestDigest) {
			return rejected(
				"candidate-identity-invalid",
				"The Program Surface candidate manifest changed after bundle delivery.",
			);
		}

		const beforePreparation = useSceneStore.getState().document;
		const existingBeforePreparation = currentBoundAsset(
			beforePreparation,
			candidate,
		);
		if (!existingBeforePreparation) {
			const actual = beforePreparation.assets?.find(
				(entry) => entry.id === candidate.assetId,
			);
			return rejected(
				actual?.kind === "program-surface"
					? "fallback-invalid"
					: "asset-missing",
				actual?.kind === "program-surface"
					? "The Program Surface candidate fallback must be an existing non-self image asset."
					: "The explicit Program Surface asset no longer exists in the current scene.",
			);
		}
		const referenceHref = programSurfaceBridgeReferenceHref(
			candidate.identity.compiledDigest,
		);
		if (!referenceHref) {
			return rejected(
				"candidate-identity-invalid",
				"The Program Surface candidate compiled digest cannot form an inert bridge reference.",
			);
		}
		const candidateManifestSnapshot = serializeProgramSurfaceBridgeManifest(
			candidate.manifest,
		);
		const existingSnapshot = programSurfaceAssetSnapshot(
			existingBeforePreparation,
		);
		const proposed = bridgeAssetForCandidate(
			existingBeforePreparation,
			candidate,
			referenceHref,
		);
		const preparation = await approvalRegistry.prepareBridgeApproval(proposed, {
			sessionId: approvedBundle.sessionId,
			bindingId: approvedBundle.bindingId,
			target: approvedBundle.target,
			assetId: proposed.id,
			identity: approvedBundle.identity,
			bundleText: decoded.bundleText,
			bytes: decoded.bytes,
		});
		if (preparation.status !== "prepared") {
			return rejected("local-approval-rejected", preparation.message);
		}
		const preparedApproval = preparation.prepared;
		prepared = preparedApproval;

		// There is intentionally no await below: the prepared local receipt and the
		// one Scene transaction must either commit together or both be discarded.
		if (
			!isEditorBindingFenceCurrent(fence) ||
			!client.isBoundToTarget(target)
		) {
			return rejected(
				"editor-binding-stale",
				"The editor binding changed before the Program Surface metadata update.",
			);
		}
		if (
			candidateIdentityIssue(candidate) ||
			serializeProgramSurfaceBridgeManifest(candidate.manifest) !==
				candidateManifestSnapshot
		) {
			return rejected(
				"bridge-candidate-stale",
				"The Program Surface candidate changed while local approval was being prepared.",
			);
		}
		const before = useSceneStore.getState().document;
		const existing = currentBoundAsset(before, candidate);
		if (!existing) {
			const actual = before.assets?.find(
				(entry) => entry.id === candidate.assetId,
			);
			return rejected(
				actual?.kind === "program-surface"
					? "fallback-invalid"
					: "asset-missing",
				actual?.kind === "program-surface"
					? "The Program Surface candidate fallback must be an existing non-self image asset."
					: "The explicit Program Surface asset no longer exists in the current scene.",
			);
		}
		if (programSurfaceAssetSnapshot(existing) !== existingSnapshot) {
			return rejected(
				"bridge-candidate-stale",
				"The Program Surface asset changed while local approval was being prepared.",
			);
		}
		const expected = bridgeAssetForCandidate(
			existing,
			candidate,
			referenceHref,
		);
		if (
			programSurfaceAssetSnapshot(expected) !==
			programSurfaceAssetSnapshot(proposed)
		) {
			return rejected(
				"bridge-candidate-stale",
				"The Program Surface bridge update no longer matches the prepared candidate.",
			);
		}
		const store = useSceneStore.getState();
		if (store.transaction) {
			return rejected(
				"scene-command-rejected",
				"Finish the active scene edit before approving a Program Surface bridge candidate.",
			);
		}
		const transactionKey = `program-surface:bridge-approval:${++bridgeApprovalTransactionSequence}`;
		let transactionOpen = false;
		let localApprovalCommitted = false;
		const rollbackLocalApproval = (): void => {
			if (!localApprovalCommitted) return;
			localApprovalCommitted = false;
			approvalRegistry.rollbackCommittedBridgeApproval(preparedApproval);
		};
		const finalizeLocalApproval = (): void => {
			if (!localApprovalCommitted) return;
			localApprovalCommitted = false;
			// Durable Scene state has already committed when this runs. A registry
			// cleanup failure must not reclassify that completed operation as rejected.
			try {
				approvalRegistry.finalizeCommittedBridgeApproval(preparedApproval);
			} catch {
				// The concrete registry is synchronous and non-throwing; this preserves
				// durable/local agreement even for an injected registry implementation.
			}
		};
		const abortAndRollback = (): void => {
			try {
				abortBridgeApprovalTransaction(transactionKey);
			} finally {
				transactionOpen = false;
				rollbackLocalApproval();
			}
		};
		const hasDurableCommit = (): boolean =>
			hasCommittedBridgeUpdate(
				transactionKey,
				existing.id,
				referenceHref,
				candidateManifestSnapshot,
			);
		try {
			store.beginTransaction(
				transactionKey,
				"Approve Program Surface bridge candidate",
			);
			transactionOpen = true;
			if (
				useSceneStore.getState().transaction?.coalesceKey !== transactionKey
			) {
				transactionOpen = false;
				return rejected(
					"scene-command-rejected",
					"The Program Surface bridge transaction lost ownership before its scene command could apply.",
				);
			}
			store.apply(
				createUpdateProgramSurfaceAssetCommand(
					existing.id,
					{
						source: { kind: "reference", href: referenceHref },
						manifest: candidate.manifest,
						mimeType: "text/javascript",
					},
					{ label: "Approve Program Surface bridge candidate" },
				),
			);
			const after = useSceneStore.getState().document;
			if (after === before) {
				abortBridgeApprovalTransaction(transactionKey);
				transactionOpen = false;
				return rejected(
					"scene-command-rejected",
					"The Program Surface bridge metadata update was rejected by the scene command contract.",
				);
			}
			const updated = after.assets?.find(
				(entry): entry is ProgramSurfaceAsset =>
					entry.kind === "program-surface" && entry.id === existing.id,
			);
			if (
				updated?.source.kind !== "reference" ||
				updated.source.href !== referenceHref ||
				updated.mimeType !== "text/javascript" ||
				serializeProgramSurfaceBridgeManifest(updated.manifest) !==
					candidateManifestSnapshot
			) {
				abortBridgeApprovalTransaction(transactionKey);
				transactionOpen = false;
				return rejected(
					"scene-command-rejected",
					"The Program Surface scene command did not preserve the exact approved bridge manifest.",
				);
			}
			const sceneCommittedDuringApply = hasDurableCommit();
			if (
				!sceneCommittedDuringApply &&
				useSceneStore.getState().transaction?.coalesceKey !== transactionKey
			) {
				transactionOpen = false;
				return rejected(
					"scene-command-rejected",
					"The Program Surface bridge transaction lost ownership while its scene command was applying.",
				);
			}
			const localResolution = approvalRegistry.commitPreparedBridgeApproval(
				preparedApproval,
				updated,
			);
			if (localResolution.status !== "approved") {
				abortAndRollback();
				return rejected("local-approval-rejected", localResolution.message);
			}
			localApprovalCommitted = true;
			if (hasDurableCommit()) {
				transactionOpen = false;
				finalizeLocalApproval();
				return {
					status: "approved",
					assetId: updated.id,
					compiledDigest: updated.manifest.runtime.compiledDigest,
				};
			}
			if (
				useSceneStore.getState().transaction?.coalesceKey !== transactionKey
			) {
				abortAndRollback();
				return rejected(
					"scene-command-rejected",
					"The Program Surface bridge transaction lost ownership before it could commit.",
				);
			}
			try {
				store.commit();
			} catch {
				if (!hasDurableCommit()) {
					abortAndRollback();
					return rejected(
						"scene-command-rejected",
						"The Program Surface bridge transaction could not commit safely.",
					);
				}
				// Zustand sets committed state before notifying subscribers. A throwing
				// observer is therefore still a completed approval only when the exact
				// command and durable asset predicate both remain true.
			}
			if (!hasDurableCommit()) {
				abortAndRollback();
				return rejected(
					"scene-command-rejected",
					"The Program Surface bridge transaction did not commit its durable update.",
				);
			}
			transactionOpen = false;
			finalizeLocalApproval();
			return {
				status: "approved",
				assetId: updated.id,
				compiledDigest: updated.manifest.runtime.compiledDigest,
			};
		} catch {
			abortAndRollback();
			return rejected(
				"scene-command-rejected",
				"The Program Surface bridge transaction could not complete safely.",
			);
		} finally {
			if (transactionOpen) {
				abortAndRollback();
			}
		}
	} finally {
		if (prepared) approvalRegistry.discardPreparedBridgeApproval(prepared);
		// No raw bridge bytes leave this workflow. The registry keeps only a
		// verified private string after a successful commit; this transient buffer
		// can be zeroed on every outcome, including static-gate rejection.
		decoded.bytes.fill(0);
	}
};
