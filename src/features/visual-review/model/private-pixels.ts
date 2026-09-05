import {
	type FrozenVisualReviewSource,
	freezeVisualReviewSource,
	type VisualReviewCaptureFailure,
	type VisualReviewDiagnosticOutcome,
	type VisualReviewFidelity,
	type VisualReviewTechnicalManifest,
	visualReviewSourceKey,
} from "./contracts";

const MAX_PRIVATE_PIXEL_RAW_BYTES = 256 * 1024 * 1024;

class PrivatePixelMemoryBudgetError extends Error {}

const assertPrivatePixelBudget = (width: number, height: number): void => {
	if (width * height * 4 > MAX_PRIVATE_PIXEL_RAW_BYTES) {
		throw new PrivatePixelMemoryBudgetError(
			"The decoded review image exceeds the 256 MiB raw-pixel budget.",
		);
	}
};

const privatePixelId = (): string => {
	if (typeof globalThis.crypto?.randomUUID === "function") {
		return globalThis.crypto.randomUUID();
	}
	return `review-pixel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

type SanitizedPrivatePixels = {
	readonly blob: Blob;
	readonly width: number;
	readonly height: number;
};

const encodeFreshPng = async (
	source: CanvasImageSource,
	width: number,
	height: number,
): Promise<Blob | null> => {
	if (typeof globalThis.document !== "undefined") {
		const canvas = globalThis.document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext("2d", { alpha: true });
		if (!context) return null;
		context.clearRect(0, 0, width, height);
		context.drawImage(source, 0, 0, width, height);
		return await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
	}
	if (typeof globalThis.OffscreenCanvas === "function") {
		const canvas = new globalThis.OffscreenCanvas(width, height);
		const context = canvas.getContext("2d", { alpha: true });
		if (!context) return null;
		context.clearRect(0, 0, width, height);
		context.drawImage(source, 0, 0, width, height);
		return await canvas.convertToBlob({ type: "image/png" });
	}
	return null;
};

const sanitizePrivatePixels = async (
	input: Blob,
): Promise<SanitizedPrivatePixels | null> => {
	if (typeof globalThis.createImageBitmap === "function") {
		try {
			const bitmap = await globalThis.createImageBitmap(input, {
				imageOrientation: "from-image",
			});
			try {
				assertPrivatePixelBudget(bitmap.width, bitmap.height);
				const blob = await encodeFreshPng(bitmap, bitmap.width, bitmap.height);
				return blob
					? { blob, width: bitmap.width, height: bitmap.height }
					: null;
			} finally {
				bitmap.close();
			}
		} catch (error) {
			if (error instanceof PrivatePixelMemoryBudgetError) throw error;
			// Safari can reject specific image formats here; Image.decode below is
			// the browser-owned fallback and is still re-encoded before retention.
		}
	}
	if (
		typeof globalThis.Image === "undefined" ||
		typeof globalThis.URL?.createObjectURL !== "function"
	) {
		return null;
	}
	const transientUrl = globalThis.URL.createObjectURL(input);
	try {
		const image = new globalThis.Image();
		image.decoding = "async";
		image.src = transientUrl;
		await image.decode();
		const width = image.naturalWidth || image.width;
		const height = image.naturalHeight || image.height;
		assertPrivatePixelBudget(width, height);
		const blob = await encodeFreshPng(image, width, height);
		return blob ? { blob, width, height } : null;
	} finally {
		globalThis.URL.revokeObjectURL(transientUrl);
	}
};

/**
 * Session-owned image bytes. Source bytes are decoded and re-encoded into a
 * fresh PNG, removing filename/path and embedded source metadata such as EXIF.
 * Disposal revokes the only preview URL and releases the Blob reference.
 */
export class PrivateVisualReviewImage {
	readonly id: string;
	readonly width: number;
	readonly height: number;
	readonly mimeType: string;
	readonly byteSize: number;
	readonly privacy = "metadata-stripped" as const;

	#blob: Blob | null;
	#objectUrl: string | null;

	constructor({
		id,
		blob,
		objectUrl,
		width,
		height,
	}: {
		readonly id: string;
		readonly blob: Blob;
		readonly objectUrl: string;
		readonly width: number;
		readonly height: number;
	}) {
		this.id = id;
		this.#blob = blob;
		this.#objectUrl = objectUrl;
		this.width = width;
		this.height = height;
		this.mimeType = blob.type || "application/octet-stream";
		this.byteSize = blob.size;
	}

	/** A revocable session URL containing no filename or filesystem path. */
	get objectUrl(): string | null {
		return this.#objectUrl;
	}

	get disposed(): boolean {
		return this.#blob === null;
	}

	/** Idempotently releases all private pixel ownership held by this resource. */
	dispose(): void {
		if (this.#objectUrl) globalThis.URL.revokeObjectURL(this.#objectUrl);
		this.#objectUrl = null;
		this.#blob = null;
	}
}

export type PrivateVisualReviewImageResult =
	| { readonly status: "ready"; readonly image: PrivateVisualReviewImage }
	| { readonly status: "failed"; readonly failure: VisualReviewCaptureFailure };

/**
 * Converts File/Blob input into an anonymous, session-only PNG. The source is
 * never retained: decoded pixels are re-encoded so embedded metadata is not
 * merely hidden from the UI but absent from the owned bytes.
 */
export async function createPrivateVisualReviewImage(
	input: Blob,
): Promise<PrivateVisualReviewImageResult> {
	if (
		typeof globalThis.URL?.createObjectURL !== "function" ||
		input.size <= 0
	) {
		return {
			status: "failed",
			failure: {
				code: input.size <= 0 ? "blank_frame" : "capture_unsupported",
				message:
					input.size <= 0
						? "The selected review image is empty."
						: "This runtime cannot create private review URLs.",
				retryable: false,
			},
		};
	}
	try {
		const sanitized = await sanitizePrivatePixels(input);
		if (!sanitized) {
			return {
				status: "failed",
				failure: {
					code: "encode_failed",
					message:
						"Private review requires metadata-stripped pixel re-encoding, which failed in this runtime.",
					retryable: false,
				},
			};
		}
		if (sanitized.width <= 0 || sanitized.height <= 0) {
			return {
				status: "failed",
				failure: {
					code: "invalid_dimensions",
					message: "The selected review image has invalid dimensions.",
					retryable: false,
				},
			};
		}
		const objectUrl = globalThis.URL.createObjectURL(sanitized.blob);
		return {
			status: "ready",
			image: new PrivateVisualReviewImage({
				id: privatePixelId(),
				blob: sanitized.blob,
				objectUrl,
				width: sanitized.width,
				height: sanitized.height,
			}),
		};
	} catch (error) {
		return {
			status: "failed",
			failure: {
				code:
					error instanceof PrivatePixelMemoryBudgetError
						? "memory_budget_exceeded"
						: "decode_failed",
				message:
					error instanceof PrivatePixelMemoryBudgetError
						? error.message
						: "The selected review image could not be decoded.",
				retryable: false,
			},
		};
	}
}

export type PrivateVisualReviewPacketInput = {
	readonly sourceKey: string;
	readonly master: PrivateVisualReviewImage;
	readonly fidelity: VisualReviewFidelity;
	readonly diagnostics?: ReadonlyMap<string, PrivateVisualReviewImage>;
	readonly diagnosticOutcomes?: readonly VisualReviewDiagnosticOutcome[];
	readonly technicalManifest?: VisualReviewTechnicalManifest | null;
};

/**
 * One side of a comparison. Pixel resources and technical metadata stay behind
 * this non-serializable session object; critic UI receives neutral A/B labels.
 */
export class PrivateVisualReviewPacket {
	readonly id: string;
	readonly sourceKey: string;
	readonly master: PrivateVisualReviewImage;
	readonly fidelity: VisualReviewFidelity;
	readonly diagnosticOutcomes: readonly VisualReviewDiagnosticOutcome[];
	readonly technicalManifest: VisualReviewTechnicalManifest | null;

	readonly #diagnostics: ReadonlyMap<string, PrivateVisualReviewImage>;
	#disposed = false;

	constructor(input: PrivateVisualReviewPacketInput) {
		this.id = privatePixelId();
		this.sourceKey = input.sourceKey;
		this.master = input.master;
		this.fidelity = input.fidelity;
		this.#diagnostics = new Map(input.diagnostics ?? []);
		this.diagnosticOutcomes = Object.freeze([
			...(input.diagnosticOutcomes ?? []),
		]);
		this.technicalManifest = input.technicalManifest ?? null;
	}

	get disposed(): boolean {
		return this.#disposed;
	}

	/** Resolves an optional diagnostic, falling back to the baseline master. */
	imageForDiagnostic(diagnosticId: string | null): PrivateVisualReviewImage {
		if (!diagnosticId) return this.master;
		return this.#diagnostics.get(diagnosticId) ?? this.master;
	}

	/** Releases every unique image resource exactly once. */
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		const resources = new Set<PrivateVisualReviewImage>([
			this.master,
			...this.#diagnostics.values(),
		]);
		for (const resource of resources) resource.dispose();
	}
}

/** Creates a packet for a local reference or fallback candidate import. */
export async function createImportedVisualReviewPacket({
	blob,
	sourceKey,
}: {
	readonly blob: Blob;
	readonly sourceKey: string;
}): Promise<
	| { readonly status: "ready"; readonly packet: PrivateVisualReviewPacket }
	| { readonly status: "failed"; readonly failure: VisualReviewCaptureFailure }
> {
	const image = await createPrivateVisualReviewImage(blob);
	if (image.status === "failed") return image;
	return {
		status: "ready",
		packet: new PrivateVisualReviewPacket({
			sourceKey,
			master: image.image,
			fidelity: {
				status: "capture-only",
				renderer: "local-raster-import",
				issues: [],
			},
		}),
	};
}

/**
 * Imports candidate pixels and creates a matching immutable, session-only
 * source identity. Blob immutability makes that generated revision genuinely
 * frozen for the lifetime of the packet.
 */
export async function createLocalCandidateVisualReviewPacket(
	blob: Blob,
): Promise<
	| {
			readonly status: "ready";
			readonly packet: PrivateVisualReviewPacket;
			readonly source: FrozenVisualReviewSource;
	  }
	| { readonly status: "failed"; readonly failure: VisualReviewCaptureFailure }
> {
	const image = await createPrivateVisualReviewImage(blob);
	if (image.status === "failed") return image;
	const source = freezeVisualReviewSource({
		sceneRevision: `session-pixels:${privatePixelId()}`,
		artboardId: "session-local-candidate",
		frame: 0,
		width: image.image.width,
		height: image.image.height,
		pixelRatio: 1,
	});
	if (!source) {
		image.image.dispose();
		return {
			status: "failed",
			failure: {
				code: "invalid_dimensions",
				message: "The imported candidate could not form a frozen source.",
				retryable: false,
			},
		};
	}
	return {
		status: "ready",
		source,
		packet: new PrivateVisualReviewPacket({
			sourceKey: visualReviewSourceKey(source),
			master: image.image,
			fidelity: {
				status: "capture-only",
				renderer: "local-raster-import",
				issues: [],
			},
		}),
	};
}
