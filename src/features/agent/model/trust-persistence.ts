import {
	createLocalStorageTextAdapter,
	readLocalStorageTextSync,
} from "@/shared/lib/persistence";

/**
 * Persistence for the editor-side "auto-apply trust" toggle (see
 * `approval-store.ts`'s `autoApplyEdits`). Follows the same versioned-key,
 * hydrate-never-throws codec convention as `shared/lib/panel-width` rather than
 * zustand's `persist` middleware, which this codebase does not use.
 */
export const AGENT_BRIDGE_TRUST_STORAGE_KEY =
	"vector-motion-author:agent-bridge-trust:v1";

const agentBridgeTrustAdapter = createLocalStorageTextAdapter({
	key: AGENT_BRIDGE_TRUST_STORAGE_KEY,
});

/**
 * Parses a persisted payload into the trust flag. NEVER throws: malformed
 * JSON, a non-boolean payload, or missing storage all fall back to `false` (ask
 * every time) — a throw here would white-screen the SPA on reload, since this
 * runs synchronously at store creation.
 */
export function hydrateAutoApplyEdits(raw: string | null): boolean {
	if (raw === null) return false;
	try {
		const parsed: unknown = JSON.parse(raw);
		return typeof parsed === "boolean" ? parsed : false;
	} catch {
		return false;
	}
}

/** Synchronous read used to seed the store at creation time (avoids a post-mount flash of the default). */
export function readPersistedAutoApplyEdits(): boolean {
	return hydrateAutoApplyEdits(
		readLocalStorageTextSync({ key: AGENT_BRIDGE_TRUST_STORAGE_KEY }),
	);
}

/** Serializes the trust flag for persistence. */
export function serializeAutoApplyEdits(enabled: boolean): string {
	return JSON.stringify(enabled);
}

/**
 * Write-through persist of the trust flag. A boolean toggle has no debounce
 * need (unlike panel-width drag), so this writes directly on every change.
 */
export function persistAutoApplyEdits(enabled: boolean): void {
	void agentBridgeTrustAdapter.save(serializeAutoApplyEdits(enabled));
}
