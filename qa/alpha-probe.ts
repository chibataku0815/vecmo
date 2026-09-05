import type { MotionDocument } from "@/entities/motion/model/types";
import type { SceneDocument } from "@/entities/scene/model/types";
import { captureRasterStillFrame } from "@/features/export/adapters/video";
import type { ExportIssue } from "@/features/export/model/issues";

import v1Repro from "./fixtures/alpha-probe/v1-repro.json";
import v2Control from "./fixtures/alpha-probe/v2-control.json";
import v3NoLook from "./fixtures/alpha-probe/v3-no-look.json";
import v4BlurOnly from "./fixtures/alpha-probe/v4-blur-only.json";
import v5OpaqueFull from "./fixtures/alpha-probe/v5-opaque-full.json";
import v6Gradient from "./fixtures/alpha-probe/v6-gradient.json";
import v7GpuIdentity from "./fixtures/alpha-probe/v7-gpu-identity.json";

/**
 * Throwaway, dev-only QA harness (numeric alpha-readback baseline for the
 * transparent-background raster export regression — see
 * `scripts/generate-alpha-probe-fixtures.ts` for the fixture set). Not part
 * of the product build: nothing links here, and no `vite.config.ts` build
 * entry references it. Drives the real `captureRasterStillFrame` export path
 * (`src/features/export/adapters/video.ts`) against six scene fixtures and
 * reports per-variant alpha-channel histograms + PNG sha256, both into
 * `<pre id="result">` and via `window.runAlphaProbe()` for console use.
 */

// Unique marker so a caller can confirm the served page is THIS worktree's
// copy (port-collision trap — other worktrees' dev servers can shadow this
// one on a reused port).
const WORKTREE_MARKER = "gpu-look-alpha-2026-07-31";

type FixturePayload = {
	readonly label: string;
	readonly frame: number;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
};

const FIXTURES: readonly [string, FixturePayload][] = [
	["v1-repro", v1Repro as FixturePayload],
	["v2-control", v2Control as FixturePayload],
	["v3-no-look", v3NoLook as FixturePayload],
	["v4-blur-only", v4BlurOnly as FixturePayload],
	["v5-opaque-full", v5OpaqueFull as FixturePayload],
	["v6-gradient", v6Gradient as FixturePayload],
	["v7-gpu-identity", v7GpuIdentity as FixturePayload],
];

type AlphaHistogramEntry = { readonly alpha: number; readonly count: number };

type VariantResult = {
	readonly key: string;
	readonly label: string;
	readonly frame: number;
	readonly width: number;
	readonly height: number;
	readonly completedPassIds: readonly string[];
	readonly alphaZero: number;
	readonly alphaPartial: number;
	readonly alphaOpaque: number;
	readonly partialMin: number | null;
	readonly partialMax: number | null;
	readonly partialMean: number | null;
	readonly topPartialAlphaValues: readonly AlphaHistogramEntry[];
	readonly pngSha256: string;
	/** `captureRasterStillFrame`'s own reported issues (e.g. `vec-core-recipe-svg-approximated`) — diff these against a post-fix run. */
	readonly issues: readonly ExportIssue[];
	readonly error?: string;
};

type ProbeReport = {
	readonly worktreeMarker: string;
	readonly generatedAt: string;
	readonly variants: readonly VariantResult[];
};

const statusElement = document.getElementById("status");
const resultElement = document.getElementById("result");

const setStatus = (text: string): void => {
	if (statusElement) statusElement.textContent = text;
};

const appendStatus = (text: string): void => {
	if (statusElement)
		statusElement.textContent = `${statusElement.textContent}\n${text}`;
};

const sha256Hex = async (bytes: ArrayBuffer): Promise<string> => {
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
};

/**
 * Decodes a captured still PNG back into straight-alpha pixel data via
 * `createImageBitmap` + an alpha-preserving 2D canvas (`{ alpha: true }`),
 * exactly mirroring the capture path's own canvas contract so the readback
 * cannot itself introduce a compositing step the capture path didn't have.
 */
const readPixelsFromPng = async (
	blob: Blob,
	width: number,
	height: number,
): Promise<Uint8ClampedArray> => {
	const bitmap = await createImageBitmap(blob);
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d", { alpha: true });
	if (!context)
		throw new Error("This browser cannot create a readback canvas.");
	context.drawImage(bitmap, 0, 0);
	bitmap.close();
	return context.getImageData(0, 0, width, height).data;
};

const TOP_PARTIAL_ALPHA_COUNT = 8;

const summarizeAlpha = (
	pixels: Uint8ClampedArray,
): {
	alphaZero: number;
	alphaPartial: number;
	alphaOpaque: number;
	partialMin: number | null;
	partialMax: number | null;
	partialMean: number | null;
	topPartialAlphaValues: AlphaHistogramEntry[];
} => {
	let alphaZero = 0;
	let alphaPartial = 0;
	let alphaOpaque = 0;
	let partialMin = 256;
	let partialMax = -1;
	let partialSum = 0;
	const partialCounts = new Map<number, number>();
	for (let i = 3; i < pixels.length; i += 4) {
		const a = pixels[i] ?? 0;
		if (a === 0) {
			alphaZero += 1;
		} else if (a === 255) {
			alphaOpaque += 1;
		} else {
			alphaPartial += 1;
			partialSum += a;
			if (a < partialMin) partialMin = a;
			if (a > partialMax) partialMax = a;
			partialCounts.set(a, (partialCounts.get(a) ?? 0) + 1);
		}
	}
	const topPartialAlphaValues = Array.from(partialCounts.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, TOP_PARTIAL_ALPHA_COUNT)
		.map(([alpha, count]) => ({ alpha, count }));
	return {
		alphaZero,
		alphaPartial,
		alphaOpaque,
		partialMin: alphaPartial > 0 ? partialMin : null,
		partialMax: alphaPartial > 0 ? partialMax : null,
		partialMean: alphaPartial > 0 ? partialSum / alphaPartial : null,
		topPartialAlphaValues,
	};
};

const runVariant = async (
	key: string,
	fixture: FixturePayload,
): Promise<VariantResult> => {
	try {
		const result = await captureRasterStillFrame({
			scene: fixture.scene,
			motion: fixture.motion,
			frame: fixture.frame,
		});
		const [pixels, pngBytes] = await Promise.all([
			readPixelsFromPng(result.blob, result.width, result.height),
			result.blob.arrayBuffer(),
		]);
		const histogram = summarizeAlpha(pixels);
		const pngSha256 = await sha256Hex(pngBytes);
		return {
			key,
			label: fixture.label,
			frame: fixture.frame,
			width: result.width,
			height: result.height,
			completedPassIds: result.completedPassIds,
			...histogram,
			pngSha256,
			issues: result.issues,
		};
	} catch (error) {
		return {
			key,
			label: fixture.label,
			frame: fixture.frame,
			width: 0,
			height: 0,
			completedPassIds: [],
			alphaZero: 0,
			alphaPartial: 0,
			alphaOpaque: 0,
			partialMin: null,
			partialMax: null,
			partialMean: null,
			topPartialAlphaValues: [],
			pngSha256: "",
			issues: [],
			error: error instanceof Error ? error.message : String(error),
		};
	}
};

const runAlphaProbe = async (): Promise<ProbeReport> => {
	const variants: VariantResult[] = [];
	for (const [key, fixture] of FIXTURES) {
		setStatus(`capturing ${key}…`);
		const result = await runVariant(key, fixture);
		appendStatus(
			result.error
				? `${key}: ERROR — ${result.error}`
				: `${key}: zero=${result.alphaZero} partial=${result.alphaPartial} opaque=${result.alphaOpaque}`,
		);
		variants.push(result);
	}
	return {
		worktreeMarker: WORKTREE_MARKER,
		generatedAt: new Date().toISOString(),
		variants,
	};
};

declare global {
	interface Window {
		runAlphaProbe: () => Promise<ProbeReport>;
	}
}
window.runAlphaProbe = runAlphaProbe;

const main = async (): Promise<void> => {
	setStatus(`loading… (${WORKTREE_MARKER})`);
	const report = await runAlphaProbe();
	if (resultElement)
		resultElement.textContent = JSON.stringify(report, null, 2);
	setStatus(`probe-ready (${WORKTREE_MARKER})`);
	document.title = "alpha-probe-ready";
};

void main();
