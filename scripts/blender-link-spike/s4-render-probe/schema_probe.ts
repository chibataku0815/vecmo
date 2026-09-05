/**
 * Negative-control probe for the S4-A frame-package hard gate.
 *
 * Takes the REAL 120-frame manifest produced by the probe render and mutates it
 * one defect at a time, asserting each defect produces its own typed code. A
 * gate that only ever sees well-formed input is a gate nobody has observed
 * working; this is the observation.
 *
 * Run: bun scripts/blender-link-spike/s4-render-probe/schema_probe.ts \
 *        <package dir>/manifest.json <link.json>
 *
 * The package it reads is produced by `blender-link-render-job.ts`; the frames
 * themselves are render output and deliberately do not live in the repo.
 */

import {
	admitProductionFramePackage,
	compareProductionFramePackages,
	parseProductionFramePackageManifest,
	productionFramePackageBlenderFrame,
	productionFramePackageByteLength,
	productionFramePackageFrameAt,
	verifyProductionFramePackageFrame,
} from "../../../src/entities/scene/model/production-frame-package";
import { parseExternalProductionLink } from "../../../src/entities/scene/model/production-link";

const manifestPath = Bun.argv[2];
const linkPath = Bun.argv[3];
const raw = JSON.parse(await Bun.file(manifestPath).text());
const link = parseExternalProductionLink(
	JSON.parse(await Bun.file(linkPath).text()),
);
if (!link) throw new Error("link did not parse");

const clone = (): MutableManifest =>
	JSON.parse(JSON.stringify(raw)) as MutableManifest;
const results: Record<string, unknown> = {};

/**
 * `MutableManifest` is deliberately loose: the whole point of each mutation is
 * to produce a shape the manifest type forbids, so a well-typed clone could not
 * express the defect being probed.
 */
type MutableManifest = Record<string, unknown> & {
	frames: Record<string, unknown>[];
	color: Record<string, unknown>;
	frameCount: number;
};

const record = (
	name: string,
	mutate: (m: MutableManifest) => void,
	expected: string,
) => {
	const candidate = clone();
	mutate(candidate);
	const parsed = parseProductionFramePackageManifest(candidate);
	const actual = parsed.ok ? "ACCEPTED" : parsed.code;
	results[name] = { expected, actual, pass: actual === expected };
};

// Baseline: the real manifest must pass its own gate.
const baseline = parseProductionFramePackageManifest(raw);
results.baseline = {
	expected: "ACCEPTED",
	actual: baseline.ok ? "ACCEPTED" : baseline.code,
	pass: baseline.ok,
};
if (!baseline.ok) throw new Error(`baseline rejected: ${baseline.code}`);

record(
	"missingFrame",
	(m) => {
		m.frames.splice(60, 1);
		m.frameCount -= 1;
	},
	"frame-package-frame-missing",
);
record(
	"partialTable",
	(m) => {
		m.frames.splice(60, 60);
	},
	"frame-package-frame-count-mismatch",
);
record(
	"duplicateFrame",
	(m) => {
		m.frames[61] = { ...m.frames[60] };
	},
	"frame-package-frame-duplicate",
);
record(
	"outOfOrderFrame",
	(m) => {
		const swap = m.frames[60];
		m.frames[60] = m.frames[61];
		m.frames[61] = swap;
	},
	"frame-package-frame-out-of-order",
);
record(
	"frameMappingOffsetByOne",
	(m) => {
		m.frames[60].blenderFrame += 1;
	},
	"frame-package-frame-mapping-invalid",
);
record(
	"absentColorDeclaration",
	(m) => {
		m.color = undefined;
	},
	"frame-package-color-declaration-invalid",
);
record(
	"absentViewTransform",
	(m) => {
		m.color.viewTransform = undefined;
	},
	"frame-package-color-declaration-invalid",
);
record(
	"unknownPrimaries",
	(m) => {
		m.color.colorPrimaries = "bt2020";
	},
	"frame-package-color-declaration-invalid",
);
// S0c measured both admitted codecs as straight-alpha, and Blender's WebP
// writer has no 16-bit path. A declaration that contradicts measured fact must
// reject rather than be recorded.
record(
	"premultipliedAlphaOnWebp",
	(m) => {
		m.color.alphaMode = "premultiplied";
	},
	"frame-package-color-declaration-invalid",
);
record(
	"sixteenBitOnWebp",
	(m) => {
		m.color.bitsPerChannel = 16;
	},
	"frame-package-color-declaration-invalid",
);
record(
	"unknownCodec",
	(m) => {
		m.codec = "vp9-webm";
	},
	"frame-package-codec-unsupported",
);
record(
	"absolutePathInFrameName",
	(m) => {
		m.frames[3].fileName = "/tmp/frame-00003.webp";
	},
	"frame-package-frame-entry-invalid",
);
record(
	"traversalInFrameName",
	(m) => {
		m.frames[3].fileName = "..frame.webp";
	},
	"frame-package-frame-entry-invalid",
);
record(
	"malformedDigest",
	(m) => {
		m.frames[7].digest = "sha256:deadbeef";
	},
	"frame-package-frame-entry-invalid",
);
record(
	"schemaVersionBump",
	(m) => {
		m.schemaVersion = 2;
	},
	"frame-package-schema-unsupported",
);
record(
	"emptyFramePayloadClaim",
	(m) => {
		m.frames[9].byteLength = 0;
	},
	"frame-package-frame-entry-invalid",
);

// Admission against the durable link.
const admitted = admitProductionFramePackage({
	manifest: baseline.manifest,
	link,
	desiredBuildKey: baseline.manifest.buildKey,
});
results.admissionWithCorrectKey = {
	expected: "admitted",
	actual: admitted.status,
	pass: admitted.status === "admitted",
};
const staleKey = `${"0".repeat(63)}1`;
const stale = admitProductionFramePackage({
	manifest: baseline.manifest,
	link,
	desiredBuildKey: staleKey,
});
results.admissionWithStaleKey = {
	expected: "frame-package-build-key-mismatch",
	actual: stale.status === "rejected" ? stale.code : "admitted",
	pass:
		stale.status === "rejected" &&
		stale.code === "frame-package-build-key-mismatch",
};
const wrongDuration = admitProductionFramePackage({
	manifest: baseline.manifest,
	link,
	desiredBuildKey: baseline.manifest.buildKey,
	frameContract: {
		...link.frame,
		durationFrames: link.frame.durationFrames + 1,
	},
});
results.admissionWithWrongDuration = {
	expected: "frame-package-frame-contract-mismatch",
	actual: wrongDuration.status === "rejected" ? wrongDuration.code : "admitted",
	pass:
		wrongDuration.status === "rejected" &&
		wrongDuration.code === "frame-package-frame-contract-mismatch",
};

// Cross-codec comparison must be incomparable, never a difference verdict.
const pngCandidate = clone();
pngCandidate.codec = "png";
const asPng = parseProductionFramePackageManifest(pngCandidate);
if (asPng.ok) {
	const comparison = compareProductionFramePackages(
		baseline.manifest,
		asPng.manifest,
	);
	results.crossCodecComparison = {
		expected: "incomparable",
		actual: comparison.status,
		pass: comparison.status === "incomparable",
	};
}

// Frame addressing: exact, and out of range is undefined rather than clamped.
results.addressing = {
	firstIndexBlenderFrame: productionFramePackageBlenderFrame(
		baseline.manifest,
		0,
	),
	lastIndexBlenderFrame: productionFramePackageBlenderFrame(
		baseline.manifest,
		baseline.manifest.frameCount - 1,
	),
	beyondLastIsUndefined:
		productionFramePackageFrameAt(
			baseline.manifest,
			baseline.manifest.frameCount,
		) === undefined,
	negativeIsUndefined:
		productionFramePackageFrameAt(baseline.manifest, -1) === undefined,
	fractionalIsUndefined:
		productionFramePackageFrameAt(baseline.manifest, 1.5) === undefined,
	totalByteLength: productionFramePackageByteLength(baseline.manifest),
};

// Byte-level admission of a real frame, and of a truncated one.
const directory = manifestPath.replace(/manifest\.json$/u, "");
const firstFrame = baseline.manifest.frames[0];
const bytes = new Uint8Array(
	await Bun.file(`${directory}${firstFrame.fileName}`).arrayBuffer(),
);
results.frameByteAdmission = {
	intact: (
		await verifyProductionFramePackageFrame({ bytes, frame: firstFrame })
	).status,
	truncated: (
		await verifyProductionFramePackageFrame({
			bytes: bytes.slice(0, bytes.byteLength - 1),
			frame: firstFrame,
		})
	).status,
	empty: (
		await verifyProductionFramePackageFrame({
			bytes: new Uint8Array(0),
			frame: firstFrame,
		})
	).status,
};

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
