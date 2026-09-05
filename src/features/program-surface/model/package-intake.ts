import { parseProgramSurfaceManifest } from "@/entities/scene/model/program-surface";
import type { ProgramSurfaceManifestV1 } from "@/entities/scene/model/types";
import {
	inspectProgramSurfaceBundleV1,
	PROGRAM_SURFACE_V1_MAX_BUNDLE_BYTES,
} from "./bundle-static-gate";

/**
 * The manual V1 container stays separate from generic JSON import. Keeping its
 * file contract here prevents the Top Bar from becoming a second package parser.
 */
export const programSurfacePackageMimeType =
	"application/vnd.vecmo.program-surface+json";
export const programSurfacePackageExtension = ".vecmo-program-surface.json";
export const programSurfacePackageAccept = `${programSurfacePackageExtension},${programSurfacePackageMimeType}`;

/** Maximum decoded JavaScript bundle size admitted by the manual V1 workflow. */
export const PROGRAM_SURFACE_MAX_DECODED_BUNDLE_BYTES =
	PROGRAM_SURFACE_V1_MAX_BUNDLE_BYTES;

const PROGRAM_SURFACE_MAX_BASE64_BUNDLE_LENGTH =
	4 * Math.ceil(PROGRAM_SURFACE_MAX_DECODED_BUNDLE_BYTES / 3);
const PROGRAM_SURFACE_PACKAGE_CONTAINER_OVERHEAD_BYTES = 128 * 1024;
const PROGRAM_SURFACE_MAX_PACKAGE_BYTES =
	PROGRAM_SURFACE_MAX_BASE64_BUNDLE_LENGTH +
	PROGRAM_SURFACE_PACKAGE_CONTAINER_OVERHEAD_BYTES;
const PROGRAM_SURFACE_MAX_INPUTS = 64;
const PROGRAM_SURFACE_MAX_NAME_LENGTH = 128;
const PROGRAM_SURFACE_PACKAGE_KIND = "vecmo-program-surface-package";
const PROGRAM_SURFACE_PACKAGE_SCHEMA_VERSION = 1;
const PROGRAM_SURFACE_BUNDLE_MIME_TYPE = "text/javascript";
const canonicalBase64Pattern =
	/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

export type ProgramSurfacePackageIntakeErrorCode =
	| "program-surface-package-unsupported"
	| "program-surface-package-too-large"
	| "program-surface-package-read-failed"
	| "program-surface-package-encoding-invalid"
	| "program-surface-package-json-invalid"
	| "program-surface-package-shape-invalid"
	| "program-surface-package-manifest-invalid"
	| "program-surface-package-portability-invalid"
	| "program-surface-package-bundle-invalid"
	| "program-surface-package-bundle-too-large"
	| "program-surface-package-static-bundle-required"
	| "program-surface-package-digest-mismatch"
	| "program-surface-package-hash-unavailable";

export type ProgramSurfacePackageIntakeError = {
	readonly code: ProgramSurfacePackageIntakeErrorCode;
	readonly message: string;
};

/**
 * An inert, byte-verified package candidate. Possession of this value does not
 * approve, evaluate, compile, or otherwise execute the bundled JavaScript.
 */
export type VerifiedManualProgramSurfacePackage = {
	readonly name: string;
	readonly sourceName: string;
	readonly sourceFormat: typeof programSurfacePackageMimeType;
	readonly manifest: ProgramSurfaceManifestV1;
	readonly source: {
		readonly kind: "data-url";
		readonly dataUrl: string;
	};
	readonly bundleByteLength: number;
	readonly verifiedCompiledDigest: `sha256:${string}`;
};

export type ManualProgramSurfacePackageIntakeResult =
	| {
			readonly status: "accepted";
			readonly package: VerifiedManualProgramSurfacePackage;
	  }
	| {
			readonly status: "rejected";
			readonly sourceName: string;
			readonly sourceFormat: typeof programSurfacePackageMimeType;
			readonly error: ProgramSurfacePackageIntakeError;
	  };

type ManualProgramSurfacePackageContainer = {
	readonly name: string;
	readonly manifest: unknown;
	readonly bundleBase64: string;
};

type DecodedBundle = {
	readonly bytes: Uint8Array;
	readonly sourceText: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactlyKeys = (
	value: Record<string, unknown>,
	expectedKeys: readonly string[],
): boolean => {
	const keys = Object.keys(value);
	return (
		keys.length === expectedKeys.length &&
		expectedKeys.every((key) => Object.hasOwn(value, key))
	);
};

const normalizedBoundedText = (
	value: unknown,
	maxLength: number,
): string | undefined => {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim();
	return normalized.length > 0 &&
		normalized.length <= maxLength &&
		!normalized.includes("\u0000")
		? normalized
		: undefined;
};

const sourceNameForFile = (file: File): string =>
	normalizedBoundedText(file.name, PROGRAM_SURFACE_MAX_NAME_LENGTH) ??
	"Program Surface package";

const rejection = (
	sourceName: string,
	error: ProgramSurfacePackageIntakeError,
): ManualProgramSurfacePackageIntakeResult => ({
	status: "rejected",
	sourceName,
	sourceFormat: programSurfacePackageMimeType,
	error,
});

const intakeError = (
	code: ProgramSurfacePackageIntakeErrorCode,
	message: string,
): ProgramSurfacePackageIntakeError => ({ code, message });

const isSupportedProgramSurfacePackageFile = (file: File): boolean => {
	const name = file.name.trim().toLowerCase();
	const mimeType = file.type.trim().toLowerCase();
	return (
		name.endsWith(programSurfacePackageExtension) ||
		mimeType === programSurfacePackageMimeType
	);
};

const parsePackageContainer = (
	value: unknown,
):
	| {
			readonly status: "valid";
			readonly container: ManualProgramSurfacePackageContainer;
	  }
	| {
			readonly status: "invalid";
			readonly error: ProgramSurfacePackageIntakeError;
	  } => {
	if (
		!isRecord(value) ||
		!hasExactlyKeys(value, [
			"kind",
			"schemaVersion",
			"name",
			"manifest",
			"bundle",
		])
	) {
		return {
			status: "invalid",
			error: intakeError(
				"program-surface-package-shape-invalid",
				"The Program Surface package uses an unsupported container shape.",
			),
		};
	}
	if (
		value.kind !== PROGRAM_SURFACE_PACKAGE_KIND ||
		value.schemaVersion !== PROGRAM_SURFACE_PACKAGE_SCHEMA_VERSION
	) {
		return {
			status: "invalid",
			error: intakeError(
				"program-surface-package-shape-invalid",
				"The Program Surface package version is not supported.",
			),
		};
	}
	const name = normalizedBoundedText(
		value.name,
		PROGRAM_SURFACE_MAX_NAME_LENGTH,
	);
	if (!name || !isRecord(value.bundle)) {
		return {
			status: "invalid",
			error: intakeError(
				"program-surface-package-shape-invalid",
				"The Program Surface package is missing required metadata.",
			),
		};
	}
	const bundle = value.bundle;
	if (
		!hasExactlyKeys(bundle, ["encoding", "mimeType", "data"]) ||
		bundle.encoding !== "base64" ||
		bundle.mimeType !== PROGRAM_SURFACE_BUNDLE_MIME_TYPE ||
		typeof bundle.data !== "string"
	) {
		return {
			status: "invalid",
			error: intakeError(
				"program-surface-package-shape-invalid",
				"The Program Surface package bundle declaration is invalid.",
			),
		};
	}
	return {
		status: "valid",
		container: {
			name,
			manifest: value.manifest,
			bundleBase64: bundle.data,
		},
	};
};

const decodeBundle = (
	base64: string,
):
	| { readonly status: "valid"; readonly bundle: DecodedBundle }
	| {
			readonly status: "invalid";
			readonly error: ProgramSurfacePackageIntakeError;
	  } => {
	if (
		base64.length === 0 ||
		base64.length > PROGRAM_SURFACE_MAX_BASE64_BUNDLE_LENGTH
	) {
		return {
			status: "invalid",
			error: intakeError(
				"program-surface-package-bundle-too-large",
				"The Program Surface bundle exceeds the 8 MiB decoded JavaScript limit.",
			),
		};
	}
	if (!canonicalBase64Pattern.test(base64)) {
		return {
			status: "invalid",
			error: intakeError(
				"program-surface-package-bundle-invalid",
				"The Program Surface bundle must use canonical base64 data.",
			),
		};
	}

	const paddingLength = base64.endsWith("==")
		? 2
		: base64.endsWith("=")
			? 1
			: 0;
	const decodedLength = (base64.length / 4) * 3 - paddingLength;
	if (
		!Number.isSafeInteger(decodedLength) ||
		decodedLength <= 0 ||
		decodedLength > PROGRAM_SURFACE_MAX_DECODED_BUNDLE_BYTES
	) {
		return {
			status: "invalid",
			error: intakeError(
				"program-surface-package-bundle-too-large",
				"The Program Surface bundle exceeds the 8 MiB decoded JavaScript limit.",
			),
		};
	}

	let binary = "";
	let canonicalBase64 = "";
	try {
		binary = globalThis.atob(base64);
		canonicalBase64 = globalThis.btoa(binary);
	} catch {
		return {
			status: "invalid",
			error: intakeError(
				"program-surface-package-bundle-invalid",
				"The Program Surface bundle could not be decoded.",
			),
		};
	}
	if (binary.length !== decodedLength || canonicalBase64 !== base64) {
		return {
			status: "invalid",
			error: intakeError(
				"program-surface-package-bundle-invalid",
				"The Program Surface bundle must use canonical base64 data.",
			),
		};
	}

	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	try {
		return {
			status: "valid",
			bundle: {
				bytes,
				sourceText: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
			},
		};
	} catch {
		return {
			status: "invalid",
			error: intakeError(
				"program-surface-package-encoding-invalid",
				"The Program Surface bundle must be valid UTF-8 JavaScript.",
			),
		};
	}
};

/**
 * Manual V1 and the opaque iframe host intentionally share one compiled-bundle
 * policy. The gate remains stricter than the server's source-graph admission:
 * a portable package is one closed emitted module, not an import graph.
 */
const staticBrowserBundleError = (
	sourceText: string,
): ProgramSurfacePackageIntakeError | undefined =>
	inspectProgramSurfaceBundleV1(sourceText).status === "accepted"
		? undefined
		: intakeError(
				"program-surface-package-static-bundle-required",
				"The Program Surface bundle is outside the V1 static parent-clocked execution profile.",
			);

const canonicalDigest = (digest: string): `sha256:${string}` =>
	`sha256:${digest
		.trim()
		.toLowerCase()
		.replace(/^sha256:/u, "")}` as `sha256:${string}`;

const sha256Digest = async (
	bytes: Uint8Array,
): Promise<`sha256:${string}` | undefined> => {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) return undefined;
	const exactBytes = new Uint8Array(bytes.byteLength);
	exactBytes.set(bytes);
	const digest = await subtle.digest("SHA-256", exactBytes.buffer);
	const hex = Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
	return `sha256:${hex}` as `sha256:${string}`;
};

const manifestHasBoundedInputs = (manifest: unknown): boolean => {
	if (!isRecord(manifest)) return false;
	return (
		!Array.isArray(manifest.inputs) ||
		manifest.inputs.length <= PROGRAM_SURFACE_MAX_INPUTS
	);
};

/**
 * Reads one user-selected V1 package into an inert candidate. The function
 * never imports, compiles, evaluates, creates a Blob URL for, or persists the
 * bundle. It returns only bounded diagnostics so package source cannot leak
 * into the import report.
 */
export async function readManualProgramSurfacePackage(
	file: File,
): Promise<ManualProgramSurfacePackageIntakeResult> {
	const sourceName = sourceNameForFile(file);
	if (!isSupportedProgramSurfacePackageFile(file)) {
		return rejection(
			sourceName,
			intakeError(
				"program-surface-package-unsupported",
				"Choose a Program Surface package file.",
			),
		);
	}
	if (
		!Number.isSafeInteger(file.size) ||
		file.size <= 0 ||
		file.size > PROGRAM_SURFACE_MAX_PACKAGE_BYTES
	) {
		return rejection(
			sourceName,
			intakeError(
				"program-surface-package-too-large",
				"The Program Surface package is larger than the manual V1 limit.",
			),
		);
	}

	let packageText: string;
	try {
		const packageBytes = new Uint8Array(await file.arrayBuffer());
		packageText = new TextDecoder("utf-8", { fatal: true }).decode(
			packageBytes,
		);
	} catch {
		return rejection(
			sourceName,
			intakeError(
				"program-surface-package-read-failed",
				"The Program Surface package could not be read as UTF-8 JSON.",
			),
		);
	}

	let packageValue: unknown;
	try {
		packageValue = JSON.parse(packageText) as unknown;
	} catch {
		return rejection(
			sourceName,
			intakeError(
				"program-surface-package-json-invalid",
				"The Program Surface package is not valid JSON.",
			),
		);
	}
	const container = parsePackageContainer(packageValue);
	if (container.status === "invalid") {
		return rejection(sourceName, container.error);
	}
	if (!manifestHasBoundedInputs(container.container.manifest)) {
		return rejection(
			sourceName,
			intakeError(
				"program-surface-package-manifest-invalid",
				"The Program Surface manifest has too many inputs or is invalid.",
			),
		);
	}
	const parsedManifest = parseProgramSurfaceManifest(
		container.container.manifest,
	);
	if (parsedManifest.status === "invalid") {
		return rejection(
			sourceName,
			intakeError(
				"program-surface-package-manifest-invalid",
				"The Program Surface manifest is not valid for manual V1 import.",
			),
		);
	}
	if (parsedManifest.manifest.source.portability !== "self-contained") {
		return rejection(
			sourceName,
			intakeError(
				"program-surface-package-portability-invalid",
				"Manual V1 import requires a self-contained Program Surface package.",
			),
		);
	}

	const decodedBundle = decodeBundle(container.container.bundleBase64);
	if (decodedBundle.status === "invalid") {
		return rejection(sourceName, decodedBundle.error);
	}
	const bundlePolicyError = staticBrowserBundleError(
		decodedBundle.bundle.sourceText,
	);
	if (bundlePolicyError) return rejection(sourceName, bundlePolicyError);

	let verifiedCompiledDigest: `sha256:${string}` | undefined;
	try {
		verifiedCompiledDigest = await sha256Digest(decodedBundle.bundle.bytes);
	} catch {
		return rejection(
			sourceName,
			intakeError(
				"program-surface-package-hash-unavailable",
				"This browser could not verify the Program Surface bundle digest.",
			),
		);
	}
	if (!verifiedCompiledDigest) {
		return rejection(
			sourceName,
			intakeError(
				"program-surface-package-hash-unavailable",
				"This browser could not verify the Program Surface bundle digest.",
			),
		);
	}
	if (
		canonicalDigest(parsedManifest.manifest.runtime.compiledDigest) !==
			verifiedCompiledDigest ||
		canonicalDigest(parsedManifest.manifest.source.snapshotDigest) !==
			verifiedCompiledDigest
	) {
		return rejection(
			sourceName,
			intakeError(
				"program-surface-package-digest-mismatch",
				"The Program Surface bundle does not match both declared SHA-256 digests.",
			),
		);
	}

	return {
		status: "accepted",
		package: {
			name: container.container.name,
			sourceName,
			sourceFormat: programSurfacePackageMimeType,
			manifest: parsedManifest.manifest,
			source: {
				kind: "data-url",
				dataUrl: `data:${PROGRAM_SURFACE_BUNDLE_MIME_TYPE};base64,${container.container.bundleBase64}`,
			},
			bundleByteLength: decodedBundle.bundle.bytes.byteLength,
			verifiedCompiledDigest,
		},
	};
}
