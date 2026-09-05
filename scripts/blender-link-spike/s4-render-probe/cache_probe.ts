/**
 * S4-C probe: rendered frame packages in the production artifact cache.
 *
 * Observes, rather than asserts:
 *   - a real 120-frame manifest admitted as ONE identity holding N object URLs;
 *   - frame addressing by package-local index through the cache;
 *   - **eviction actually firing** under a small budget override, with the freed
 *     bytes and evicted keys recorded;
 *   - quota exhaustion when everything else is pinned (the state that used to be
 *     silent: `evictToBudget` returned having freed nothing and said nothing);
 *   - the per-build-key ceiling refusing an oversized package BEFORE any object
 *     URL is allocated;
 *   - the last-good stale gate: preview allowed, exact export blocked;
 *   - link identity and control identity surviving a GLB <-> rendered profile
 *     switch, with the build key correctly MOVING across it.
 *
 * Run: bun scripts/blender-link-spike/s4-render-probe/cache_probe.ts <manifest.json> <link.json>
 */

import {
	deriveProductionBuildKey,
	deriveProductionBuildKeyFields,
	desiredBuildKeyForAsset,
	type ProductionBuildEnvironment,
} from "../../../src/entities/scene/model/production-artifacts";
import {
	parseProductionFramePackageManifest,
	productionFramePackageByteLength,
	productionFramePackageFrameAt,
	productionFramePackageUsage,
} from "../../../src/entities/scene/model/production-frame-package";
import { parseExternalProductionLink } from "../../../src/entities/scene/model/production-link";
import { createProductionArtifactCache } from "../../../src/features/blender-link/model/artifact-cache";

const manifestPath = Bun.argv[2];
const linkPath = Bun.argv[3];

const parsed = parseProductionFramePackageManifest(
	JSON.parse(await Bun.file(manifestPath).text()),
);
if (!parsed.ok) throw new Error(`manifest rejected: ${parsed.code}`);
const manifest = parsed.manifest;
const link = parseExternalProductionLink(
	JSON.parse(await Bun.file(linkPath).text()),
);
if (!link) throw new Error("link rejected");

const results: Record<string, unknown> = {};

/** Frame bytes are synthesized to the manifest's own declared lengths: this
 * probe is about cache accounting, not about pixels. */
const framesFor = (m: typeof manifest): Uint8Array[] =>
	m.frames.map((frame) => new Uint8Array(frame.byteLength));

const identity = { linkId: manifest.linkId, buildKey: manifest.buildKey };
const packageBytes = productionFramePackageByteLength(manifest);

// --- 1. Admit one real package, address a frame by index -------------------
{
	const cache = createProductionArtifactCache({ byteBudget: 64 * 1024 * 1024 });
	const admitted = cache.admitFramePackage({
		identity,
		manifest,
		frames: framesFor(manifest),
		mimeType: "image/webp",
	});
	const fetched = admitted.ok ? cache.getFramePackage(identity) : null;
	const index = 60;
	results.admitRealPackage = {
		ok: admitted.ok,
		packageBytes,
		frameHrefCount: admitted.ok ? admitted.entry.frameHrefs.length : 0,
		declaredFrameCount: manifest.frameCount,
		hrefCountEqualsFrameCount:
			admitted.ok && admitted.entry.frameHrefs.length === manifest.frameCount,
		distinctHrefs: admitted.ok ? new Set(admitted.entry.frameHrefs).size : 0,
		cacheTotalBytes: cache.totalBytes(),
		totalBytesEqualsPackageBytes: cache.totalBytes() === packageBytes,
		// Frame addressing: index 60 -> blenderFrame 61, and the href at the same
		// index is the one the manifest's entry 60 names.
		addressedIndex: index,
		addressedBlenderFrame: productionFramePackageFrameAt(manifest, index)
			?.blenderFrame,
		addressedHrefIsDistinct:
			fetched?.frameHrefs[index] !== fetched?.frameHrefs[index + 1],
		roundTripped: Boolean(fetched),
	};
	cache.dispose();
}

// --- 2. Eviction actually fires -------------------------------------------
{
	// Budget deliberately sized to hold ONE package but not two.
	const cache = createProductionArtifactCache({
		byteBudget: Math.floor(packageBytes * 1.5),
	});
	const first = { linkId: manifest.linkId, buildKey: `${"a".repeat(63)}1` };
	const second = { linkId: manifest.linkId, buildKey: `${"b".repeat(63)}2` };
	cache.admitFramePackage({
		identity: first,
		manifest: { ...manifest, buildKey: first.buildKey },
		frames: framesFor(manifest),
		mimeType: "image/webp",
	});
	const bytesAfterFirst = cache.totalBytes();
	const secondResult = cache.admitFramePackage({
		identity: second,
		manifest: { ...manifest, buildKey: second.buildKey },
		frames: framesFor(manifest),
		mimeType: "image/webp",
	});
	results.evictionFires = {
		budget: Math.floor(packageBytes * 1.5),
		bytesAfterFirst,
		secondAdmitted: secondResult.ok,
		firstStillResident: cache.getFramePackage(first) !== null,
		secondResident: cache.getFramePackage(second) !== null,
		bytesAfterSecond: cache.totalBytes(),
		// The observation the plan asks for: admitting the second package evicted
		// the first, and the cache stayed inside its budget.
		evictionObserved: secondResult.ok && cache.getFramePackage(first) === null,
		withinBudget: cache.totalBytes() <= Math.floor(packageBytes * 1.5),
	};
	cache.dispose();
}

// --- 3. Quota exhausted: everything else is pinned -------------------------
{
	const cache = createProductionArtifactCache({
		byteBudget: Math.floor(packageBytes * 1.5),
	});
	const pinnedIdentity = {
		linkId: manifest.linkId,
		buildKey: `${"c".repeat(63)}3`,
	};
	const incoming = { linkId: manifest.linkId, buildKey: `${"d".repeat(63)}4` };
	cache.admitFramePackage({
		identity: pinnedIdentity,
		manifest: { ...manifest, buildKey: pinnedIdentity.buildKey },
		frames: framesFor(manifest),
		mimeType: "image/webp",
	});
	cache.pin([pinnedIdentity]);
	const refused = cache.admitFramePackage({
		identity: incoming,
		manifest: { ...manifest, buildKey: incoming.buildKey },
		frames: framesFor(manifest),
		mimeType: "image/webp",
	});
	results.quotaExhausted = {
		expected: "production-cache-quota-exhausted",
		actual: refused.ok ? "ADMITTED" : refused.code,
		pass: !refused.ok && refused.code === "production-cache-quota-exhausted",
		pinnedSurvived: cache.getFramePackage(pinnedIdentity) !== null,
		bytesUnchanged: cache.totalBytes() === packageBytes,
	};
	cache.dispose();
}

// --- 4. Per-build-key ceiling refuses before allocating --------------------
{
	const cache = createProductionArtifactCache({
		byteBudget: 512 * 1024 * 1024,
		framePackageByteBudget: Math.floor(packageBytes / 2),
	});
	const refused = cache.admitFramePackage({
		identity,
		manifest,
		frames: framesFor(manifest),
		mimeType: "image/webp",
	});
	results.perKeyCeiling = {
		expected: "production-cache-package-exceeds-key-budget",
		actual: refused.ok ? "ADMITTED" : refused.code,
		pass:
			!refused.ok &&
			refused.code === "production-cache-package-exceeds-key-budget",
		nothingAllocated: cache.totalBytes() === 0,
	};
	cache.dispose();
}

// --- 5. Incomplete package refused ----------------------------------------
{
	const cache = createProductionArtifactCache({
		byteBudget: 512 * 1024 * 1024,
	});
	const short = cache.admitFramePackage({
		identity,
		manifest,
		frames: framesFor(manifest).slice(0, manifest.frameCount - 1),
		mimeType: "image/webp",
	});
	const wrongBytes = cache.admitFramePackage({
		identity,
		manifest,
		frames: framesFor(manifest).map(() => new Uint8Array(1)),
		mimeType: "image/webp",
	});
	results.incompletePackage = {
		shortExpected: "production-cache-package-incomplete",
		shortActual: short.ok ? "ADMITTED" : short.code,
		byteMismatchExpected: "production-cache-package-incomplete",
		byteMismatchActual: wrongBytes.ok ? "ADMITTED" : wrongBytes.code,
		pass:
			!short.ok &&
			short.code === "production-cache-package-incomplete" &&
			!wrongBytes.ok &&
			wrongBytes.code === "production-cache-package-incomplete",
		nothingAllocated: cache.totalBytes() === 0,
	};
	cache.dispose();
}

// --- 6. Last-good stale: preview allowed, exact export blocked -------------
{
	const exact = productionFramePackageUsage({
		manifest,
		desiredBuildKey: manifest.buildKey,
	});
	const stale = productionFramePackageUsage({
		manifest,
		desiredBuildKey: `${"e".repeat(63)}5`,
	});
	const notReproducible = productionFramePackageUsage({
		manifest: { ...manifest, reproducible: false },
		desiredBuildKey: manifest.buildKey,
	});
	results.staleUsageGate = {
		currentBuild: exact.status,
		lastGoodStale: stale.status === "preview-only" ? stale.code : "exact",
		notReproducible:
			notReproducible.status === "preview-only"
				? notReproducible.code
				: "exact",
		pass:
			exact.status === "exact" &&
			stale.status === "preview-only" &&
			stale.code === "frame-package-stale-exact-export-blocked" &&
			notReproducible.status === "preview-only" &&
			notReproducible.code === "frame-package-not-reproducible",
	};
}

// --- 7. Identity across a GLB <-> rendered profile switch ------------------
{
	const environment: ProductionBuildEnvironment = {
		blenderVersion: "5.2.0",
		environmentDigest: "1".repeat(64),
		renderSettingsDigest: "2".repeat(64),
		sourceDigest: "3".repeat(64),
	};
	// Real published controls, so the control-identity comparison is not vacuous:
	// the probe fixture declares none, and comparing two empty lists proves
	// nothing about whether profile affects control identity.
	const controls = [
		{
			id: "swirl",
			label: "Swirl",
			valueType: "number" as const,
			unit: "scalar" as const,
			defaultValue: 0.5,
			min: 0,
			max: 1,
			rangeDeclared: true,
			defaultIsAmbiguous: false,
			blenderBinding: {
				kind: "custom-property" as const,
				ownerType: "OBJECT" as const,
				ownerName: "GNReaction",
				propertyName: "swirl",
			},
		},
		{
			id: "burst",
			label: "Burst",
			valueType: "number" as const,
			unit: "frames" as const,
			defaultValue: 12,
			rangeDeclared: false,
			defaultIsAmbiguous: true,
			blenderBinding: {
				kind: "custom-property" as const,
				ownerType: "SCENE" as const,
				ownerName: "Scene",
				propertyName: "burst",
			},
		},
	];
	const withControls = {
		...link,
		controls,
		values: [{ controlId: "swirl", value: 0.75 }],
	};
	const renderedLink = {
		...withControls,
		outputProfile: "rendered-rgba-sequence" as const,
	};
	const glbLink = {
		...withControls,
		outputProfile: "interactive-glb" as const,
	};
	const renderedKey = await deriveProductionBuildKey(renderedLink, environment);
	const glbKey = await deriveProductionBuildKey(glbLink, environment);
	const renderedIdentity = await desiredBuildKeyForAsset(
		{ production: renderedLink },
		null,
		environment,
	);
	const glbIdentity = await desiredBuildKeyForAsset(
		{ production: glbLink },
		null,
		environment,
	);
	const renderedFields = await deriveProductionBuildKeyFields(
		renderedLink,
		environment,
	);
	const glbFields = await deriveProductionBuildKeyFields(glbLink, environment);
	results.profileSwitchIdentity = {
		// The link survives the switch...
		linkIdPreserved: renderedIdentity?.linkId === glbIdentity?.linkId,
		linkId: renderedIdentity?.linkId,
		// ...the control identity survives it (declared controls are untouched by
		// profile, and (linkId, controlId) is the whole identity)...
		controlIdsPreserved:
			JSON.stringify(renderedLink.controls.map((c) => c.id)) ===
			JSON.stringify(glbLink.controls.map((c) => c.id)),
		controlIds: renderedLink.controls.map((c) => c.id),
		controlCount: renderedLink.controls.length,
		// The strong form: the digest covering declared controls, their bindings,
		// AND their authored static values is IDENTICAL across the switch, while
		// the profile field differs. Control identity is profile-independent by
		// derivation, not by inspection of two empty lists.
		publishedControlDigestPreserved:
			renderedFields?.publishedControlDigest ===
			glbFields?.publishedControlDigest,
		publishedControlDigest: renderedFields?.publishedControlDigest,
		cameraDigestPreserved:
			renderedFields?.cameraDigest === glbFields?.cameraDigest,
		frameContractPreserved:
			renderedFields?.frameContract === glbFields?.frameContract,
		outputProfileDiffers:
			renderedFields?.outputProfile !== glbFields?.outputProfile,
		// ...and the ARTIFACT identity correctly moves, because `outputProfile` is
		// one of the ten hashed build-key fields. Same link, different build.
		buildKeyMoves: renderedKey !== glbKey,
		renderedKeyDerived: Boolean(renderedIdentity),
		glbKeyDerived: Boolean(glbIdentity),
		// Before the S4-C widening, the rendered profile derived NO key at all,
		// which read as Disconnected rather than as a rebuildable Stale.
		bothProfilesDeriveAKey: Boolean(renderedIdentity && glbIdentity),
		pass:
			renderedIdentity?.linkId === glbIdentity?.linkId &&
			renderedFields?.publishedControlDigest ===
				glbFields?.publishedControlDigest &&
			renderedFields?.cameraDigest === glbFields?.cameraDigest &&
			renderedFields?.frameContract === glbFields?.frameContract &&
			renderedKey !== glbKey &&
			Boolean(renderedIdentity && glbIdentity),
	};
}

const failures = Object.entries(results).filter(
	([, value]) =>
		typeof value === "object" &&
		value !== null &&
		(value as { pass?: boolean }).pass === false,
);
console.log(
	JSON.stringify({ results, failureCount: failures.length }, null, 2),
);
if (failures.length > 0) process.exitCode = 1;
