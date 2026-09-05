import { PROGRAM_SURFACE_BRIDGE_MAX_APPROVED_BUNDLE_BYTES } from "@/entities/scene/model/program-surface-bridge-protocol";
import { inspectProgramSurfaceBundleStaticProfile } from "./static-profile";

/**
 * V1 executes only a deliberately small, parent-clocked module shape. This is
 * a conservative intake gate, not a substitute for the opaque-origin iframe
 * and CSP boundary used by the canvas host. A false positive is preferable to
 * silently granting a new execution capability to a persisted data URL.
 */

/** Shared V1 byte bound for portable and bridge-delivered compiled bundles. */
export const PROGRAM_SURFACE_V1_MAX_BUNDLE_BYTES =
	PROGRAM_SURFACE_BRIDGE_MAX_APPROVED_BUNDLE_BYTES;

export type ProgramSurfaceBundleStaticGateResult =
	| { readonly status: "accepted" }
	| {
			readonly status: "rejected";
			readonly code:
				| "bundle-empty"
				| "bundle-too-large"
				| "bundle-encoding-unavailable"
				| "parent-clocked-contract-missing"
				| "module-loading-forbidden"
				| "dynamic-code-forbidden"
				| "network-forbidden"
				| "worker-forbidden"
				| "self-scheduling-forbidden"
				| "ambient-browser-access-forbidden"
				| "nondeterminism-forbidden"
				| "credential-material-forbidden"
				| "shared-compiled-profile-rejected";
	  };

type ForbiddenRule = {
	readonly code: Extract<
		ProgramSurfaceBundleStaticGateResult,
		{ readonly status: "rejected" }
	>["code"];
	readonly pattern: RegExp;
};

const hasCreateProgramSurfaceExport = (source: string): boolean =>
	/\bexport\s+function\s+createProgramSurface\s*\(/u.test(source) ||
	/\bexport\s+(?:const|let|var)\s+createProgramSurface\s*=/u.test(source);

/**
 * These checks intentionally inspect comments and string literals too. A
 * rejected harmless label is recoverable through a revised bundle; accepting a
 * spelling that is later reached through dynamic property access is not.
 */
const forbiddenRules: readonly ForbiddenRule[] = [
	{
		code: "module-loading-forbidden",
		pattern: /\bimport\b/iu,
	},
	{
		code: "module-loading-forbidden",
		pattern: /\bnode\s*:/iu,
	},
	{
		code: "module-loading-forbidden",
		pattern: /\bexport\s*(?:\*|\{[\s\S]*?\}\s*from\b)/iu,
	},
	{
		code: "parent-clocked-contract-missing",
		pattern: /\bexport\s+default\b/iu,
	},
	{
		code: "dynamic-code-forbidden",
		pattern:
			/\b(?:eval|constructor|WebAssembly|require|module|exports|process|Buffer|__dirname|__filename)\b/iu,
	},
	{
		code: "dynamic-code-forbidden",
		// `Function` is a constructor identifier; lower-case `function` is the
		// required synchronous ESM declaration keyword for the V1 host factory.
		pattern: /\bFunction\b/u,
	},
	{
		code: "network-forbidden",
		pattern:
			/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|WebTransport|RTCPeerConnection|sendBeacon|importScripts|Image|Audio)\b/iu,
	},
	{
		code: "network-forbidden",
		pattern: /\b(?:https?|wss?):\/\//iu,
	},
	{
		code: "worker-forbidden",
		pattern: /\b(?:Worker|SharedWorker|ServiceWorker|OffscreenCanvas)\b/iu,
	},
	{
		code: "self-scheduling-forbidden",
		pattern:
			/\b(?:setTimeout|setInterval|setImmediate|requestAnimationFrame|requestIdleCallback|requestVideoFrameCallback|queueMicrotask|MessageChannel|BroadcastChannel|MutationObserver|ResizeObserver|IntersectionObserver|scheduler|Promise|async|await|Atomics|addEventListener|postMessage)\b/iu,
	},
	{
		code: "ambient-browser-access-forbidden",
		pattern:
			/\b(?:window|document|parent|top|opener|globalThis|localStorage|sessionStorage|indexedDB|caches|navigator|location|self)\b/iu,
	},
	{
		code: "nondeterminism-forbidden",
		pattern:
			/\b(?:Date|performance|Math\s*\.\s*random|crypto|getRandomValues)\b/iu,
	},
	{
		code: "credential-material-forbidden",
		pattern: /\b(?:api[_-]?key|authorization|private[_-]?key|password)\b/iu,
	},
];

/**
 * Checks a decoded V1 JavaScript bundle before it is approved or mounted. The
 * only accepted public entry point is a named synchronous
 * `createProgramSurface` export; rendering is then driven exclusively and
 * synchronously by the host's explicit render message. Promise/async source is
 * rejected so a bundle cannot install a microtask-driven loop between frames.
 */
export const inspectProgramSurfaceBundleV1 = (
	bundleText: string,
): ProgramSurfaceBundleStaticGateResult => {
	if (!bundleText.trim()) return { status: "rejected", code: "bundle-empty" };
	if (bundleText.includes("\u0000")) {
		return { status: "rejected", code: "shared-compiled-profile-rejected" };
	}
	if (typeof TextEncoder === "undefined") {
		return { status: "rejected", code: "bundle-encoding-unavailable" };
	}
	if (
		new TextEncoder().encode(bundleText).byteLength >
		PROGRAM_SURFACE_V1_MAX_BUNDLE_BYTES
	) {
		return { status: "rejected", code: "bundle-too-large" };
	}
	const sharedProfile = inspectProgramSurfaceBundleStaticProfile(bundleText);
	if (!sharedProfile.ok) {
		return { status: "rejected", code: "shared-compiled-profile-rejected" };
	}
	if (!hasCreateProgramSurfaceExport(bundleText)) {
		return {
			status: "rejected",
			code: "parent-clocked-contract-missing",
		};
	}
	for (const rule of forbiddenRules) {
		if (rule.pattern.test(bundleText)) {
			return { status: "rejected", code: rule.code };
		}
	}
	return { status: "accepted" };
};
