import {
	createLocalStorageTextAdapter,
	readLocalStorageTextSync,
	type TextPersistenceClearResult,
	type TextPersistenceSaveResult,
} from "@/shared/lib/persistence";
import {
	advanceBindingEpochForRelink,
	editorSessionStorageKey,
	PRODUCTION_LINK_REGISTRY_SUFFIX,
} from "./session";

/**
 * Working-copy-scoped map from a durable `linkId` to this machine's binding for
 * it. This is the deliberate other half of the linked-production contract: the
 * SceneDocument carries the logical link, and the absolute local path lives
 * only here, in browser-local storage fenced to one Working Copy.
 *
 * That split is what makes the failure modes honest. Opening the same project
 * on another machine finds no entry and must say "Relink required" instead of
 * resurrecting a path that cannot exist there, and a portable backup or cloud
 * revision can never carry a filesystem location out of this browser.
 *
 * It is session state, not document state: nothing here goes through the Scene
 * command bus, appears in undo history, or participates in serialization.
 */
export type ProductionLinkBinding = {
	/**
	 * Opaque local handle for the bound source. It is a token rather than a bare
	 * path so a future File System Access handle can replace the representation
	 * without changing this contract or any consumer.
	 */
	readonly localPathToken: string;
	/**
	 * Digest observed when this binding was last confirmed. Comparing it against
	 * the document's link digest is how drift becomes visible; per S0a it carries
	 * per-saved-file semantics, so inequality means "re-saved", not "changed".
	 */
	readonly sourceDigest?: string;
	readonly lastBoundAt?: number;
};

export type ProductionLinkRegistry = ReadonlyMap<string, ProductionLinkBinding>;

const REGISTRY_VERSION = 1 as const;

type SerializedRegistry = {
	readonly version: typeof REGISTRY_VERSION;
	readonly bindings: Readonly<Record<string, ProductionLinkBinding>>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const registryStorageKey = (): string =>
	editorSessionStorageKey(PRODUCTION_LINK_REGISTRY_SUFFIX);

const registryAdapter = () =>
	createLocalStorageTextAdapter({ key: registryStorageKey() });

const parseBinding = (value: unknown): ProductionLinkBinding | null => {
	if (!isRecord(value)) return null;
	const { localPathToken, sourceDigest, lastBoundAt } = value;
	if (typeof localPathToken !== "string" || localPathToken.length === 0) {
		return null;
	}
	if (sourceDigest !== undefined && typeof sourceDigest !== "string") {
		return null;
	}
	if (lastBoundAt !== undefined && !Number.isFinite(lastBoundAt)) return null;
	return {
		localPathToken,
		...(typeof sourceDigest === "string" ? { sourceDigest } : {}),
		...(typeof lastBoundAt === "number" ? { lastBoundAt } : {}),
	};
};

const parseRegistry = (serialized: string): ProductionLinkRegistry => {
	try {
		const value: unknown = JSON.parse(serialized);
		if (!isRecord(value) || value.version !== REGISTRY_VERSION) {
			return new Map();
		}
		if (!isRecord(value.bindings)) return new Map();
		const bindings = new Map<string, ProductionLinkBinding>();
		for (const [linkId, candidate] of Object.entries(value.bindings)) {
			const binding = parseBinding(candidate);
			if (linkId.length > 0 && binding) bindings.set(linkId, binding);
		}
		return bindings;
	} catch {
		// A corrupt registry degrades to "nothing is bound", which fails closed
		// into an explicit relink rather than into a fabricated binding.
		return new Map();
	}
};

const serializeRegistry = (registry: ProductionLinkRegistry): string =>
	JSON.stringify({
		version: REGISTRY_VERSION,
		bindings: Object.fromEntries(registry),
	} satisfies SerializedRegistry);

/**
 * Reads the whole registry synchronously. A caller has to compare the existing
 * binding before deciding whether a write is a relink, so this read cannot be
 * deferred behind a promise.
 */
export const readProductionLinkRegistry = (): ProductionLinkRegistry => {
	const serialized = readLocalStorageTextSync({ key: registryStorageKey() });
	return serialized === null ? new Map() : parseRegistry(serialized);
};

/** Returns this machine's binding for one link, or `null` when unbound. */
export const readProductionLinkBinding = (
	linkId: string,
): ProductionLinkBinding | null =>
	readProductionLinkRegistry().get(linkId) ?? null;

const writeRegistry = (
	registry: ProductionLinkRegistry,
): Promise<TextPersistenceSaveResult> =>
	registryAdapter().save(serializeRegistry(registry));

/**
 * Binds or rebinds one link to a local source. Pointing an existing link at a
 * different source advances the editor binding epoch first, so companion work
 * and any other result authorized against the previous binding is rejected
 * rather than applied to the new one. The epoch moves before the write, which
 * makes a failed write fail closed.
 */
export const bindProductionLink = (
	linkId: string,
	binding: ProductionLinkBinding,
): Promise<TextPersistenceSaveResult> => {
	const registry = new Map(readProductionLinkRegistry());
	const previous = registry.get(linkId);
	if (previous && previous.localPathToken !== binding.localPathToken) {
		advanceBindingEpochForRelink();
	}
	registry.set(linkId, binding);
	return writeRegistry(registry);
};

/**
 * Removes one link's local binding and advances the binding epoch, because an
 * unlinked source must not leave an earlier authorization live. Unbinding an
 * absent link is a no-op and leaves the fence untouched.
 */
export const unbindProductionLink = (
	linkId: string,
): Promise<TextPersistenceSaveResult> | null => {
	const registry = new Map(readProductionLinkRegistry());
	if (!registry.delete(linkId)) return null;
	advanceBindingEpochForRelink();
	return writeRegistry(registry);
};

/** Drops every local binding for this Working Copy without touching the document. */
export const clearProductionLinkRegistry =
	(): Promise<TextPersistenceClearResult> => registryAdapter().clear();
