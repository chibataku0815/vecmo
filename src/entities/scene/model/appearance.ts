import { castDraft, type Draft } from "immer";
import type { SceneCommand } from "./command";
import {
	findDraftLayerByNodeId,
	findDraftNode,
	selectArtboardIdForNode,
} from "./selectors";
import type { SceneDocument, VectorNode } from "./types";

export type ImportedAppearanceEffectMetadata = {
	readonly kind: string;
	readonly value: string;
	readonly ref?: string;
	readonly sourcePath?: string;
};

export type ImportedPaintEntryMetadata = {
	readonly source: string;
	readonly ref?: string;
	readonly fallback: string;
	readonly sourcePath?: string;
	readonly unsupported?: boolean;
};

export type ImportedPaintMetadata = {
	readonly fill?: ImportedPaintEntryMetadata;
	readonly stroke?: ImportedPaintEntryMetadata;
};

export type ImportedCompoundPathMetadata = {
	readonly source: string;
	readonly fillRule?: string;
	readonly subpathCount?: number;
	readonly subpathIndex?: number;
	readonly sourcePath?: string;
};

export type ImportedOpacityGroupMetadata = {
	readonly source: string;
	readonly opacity: number;
	readonly flattenedTo: "node-opacity";
	readonly ref?: string;
	readonly sourcePath?: string;
};

export type ImportedClipMaskRelationKind = "clip-path" | "mask" | "soft-mask";

export type ImportedClipMaskFallback = "unclipped-vector";

export type AppearanceMaskRelationKind = ImportedClipMaskRelationKind;

export type AppearanceMaskRelationFallback = ImportedClipMaskFallback;

export type AppearanceMaskRelationOrigin = "imported" | "native";
export type AppearanceMaskChannel =
	| "alpha"
	| "luminance"
	| "red"
	| "green"
	| "blue";
export type AppearanceMaskSourceSampling = "pre-effects" | "post-effects";
export type AppearanceMaskCoordinateSpace = "artboard";

/**
 * Additive object-mask settings owned by a native/imported mask relation. These
 * values describe how a content node consumes its mask source; they are not node
 * style fields and must not be duplicated into frame Effect Layer state.
 */
export type AppearanceMaskRelationSettings = {
	readonly featherRadius?: number;
	readonly expand?: number;
	readonly opacity?: number;
	readonly invert?: boolean;
	readonly channel?: AppearanceMaskChannel;
	readonly sourceSampling?: AppearanceMaskSourceSampling;
	readonly coordinateSpace?: AppearanceMaskCoordinateSpace;
};

export type AppearanceMaskRelationMetadata = {
	readonly id: string;
	readonly kind: AppearanceMaskRelationKind;
	readonly origin: AppearanceMaskRelationOrigin;
	readonly affectedNodeIds: readonly string[];
	readonly fallback: AppearanceMaskRelationFallback;
	readonly value?: string;
	readonly maskNodeId?: string;
	readonly ref?: string;
	readonly sourcePath?: string;
	readonly settings?: AppearanceMaskRelationSettings;
};

export type AppearanceMetadata = {
	readonly maskRelations?: readonly AppearanceMaskRelationMetadata[];
};

export type AppearanceMaskRelationInput = {
	readonly id?: string;
	readonly kind: AppearanceMaskRelationKind;
	readonly origin?: AppearanceMaskRelationOrigin;
	readonly affectedNodeIds?: readonly string[];
	readonly fallback?: AppearanceMaskRelationFallback;
	readonly value?: string;
	readonly maskNodeId?: string;
	readonly ref?: string;
	readonly sourcePath?: string;
	readonly settings?: AppearanceMaskRelationSettings;
};

export type SetNodeMaskRelationOptions = {
	readonly label?: string;
	readonly coalesceKey?: string;
};

export const MASK_RELATION_FEATHER_PROPERTY_ID =
	"appearance.mask.featherRadius" as const;
export const MASK_RELATION_OPACITY_PROPERTY_ID =
	"appearance.mask.opacity" as const;
export const MASK_RELATION_EXPAND_PROPERTY_ID =
	"appearance.mask.expand" as const;
export const MASK_RELATION_INVERT_PROPERTY_ID =
	"appearance.mask.invert" as const;

/**
 * Stable code/agent property ids for native object-mask settings. `featherRadius`
 * (>=0 px), `opacity` (0..1), and `expand` (signed px choke/spread) are scalar;
 * `invert` is a boolean encoded as a number on the write command (0 = off,
 * nonzero = on) so the single `scene/set-mask-relation-property` shape covers all.
 */
export const MASK_RELATION_PROPERTY_IDS = [
	MASK_RELATION_FEATHER_PROPERTY_ID,
	MASK_RELATION_OPACITY_PROPERTY_ID,
	MASK_RELATION_EXPAND_PROPERTY_ID,
	MASK_RELATION_INVERT_PROPERTY_ID,
] as const;

export type MaskRelationPropertyId =
	(typeof MASK_RELATION_PROPERTY_IDS)[number];

export type ImportedClipMaskRelationMetadata = {
	readonly id?: string;
	readonly kind: ImportedClipMaskRelationKind;
	readonly value: string;
	readonly affectedNodeIds: readonly string[];
	readonly fallback: ImportedClipMaskFallback;
	readonly ref?: string;
	readonly sourcePath?: string;
};

export type ImportedAppearanceMetadata = {
	readonly effects: readonly ImportedAppearanceEffectMetadata[];
	readonly opacityGroups: readonly ImportedOpacityGroupMetadata[];
	readonly clipMaskRelations?: readonly ImportedClipMaskRelationMetadata[];
	readonly paint?: ImportedPaintMetadata;
	readonly compoundPath?: ImportedCompoundPathMetadata;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const stringField = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined;

const booleanField = (value: unknown): boolean | undefined =>
	typeof value === "boolean" ? value : undefined;

const numberField = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

const nonNegativeNumberField = (value: unknown): number | undefined => {
	const number = numberField(value);
	return number === undefined ? undefined : Math.max(0, number);
};

const stringArrayField = (value: unknown): readonly string[] =>
	Array.isArray(value)
		? value.filter(
				(entry): entry is string =>
					typeof entry === "string" && entry.length > 0,
			)
		: [];

const sortedUniqueStrings = (values: readonly string[]): readonly string[] =>
	[...new Set(values.filter((value) => value.length > 0))].sort();

const relationIdPart = (value: string | undefined): string => {
	const normalized = value
		?.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return normalized && normalized.length > 0 ? normalized : "source";
};

const hashString = (value: string): string => {
	let hash = 2_166_136_261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16_777_619);
	}
	return (hash >>> 0).toString(36);
};

const appearanceMaskRelationOrigin = (
	value: unknown,
): AppearanceMaskRelationOrigin =>
	value === "imported" || value === "native" ? value : "native";

const isEmptyRecord = (value: object): boolean =>
	Object.keys(value).length === 0;

const appearanceMaskRelationSettings = (
	value: unknown,
): AppearanceMaskRelationSettings | undefined => {
	if (!isRecord(value)) return undefined;
	const featherRadius = nonNegativeNumberField(value.featherRadius);
	const expand = numberField(value.expand);
	const opacity = nonNegativeNumberField(value.opacity);
	const invert = booleanField(value.invert);
	const channel =
		value.channel === "alpha" ||
		value.channel === "luminance" ||
		value.channel === "red" ||
		value.channel === "green" ||
		value.channel === "blue"
			? value.channel
			: undefined;
	const sourceSampling =
		value.sourceSampling === "pre-effects" ||
		value.sourceSampling === "post-effects"
			? value.sourceSampling
			: undefined;
	const coordinateSpace =
		value.coordinateSpace === "artboard" ? "artboard" : undefined;
	const settings: AppearanceMaskRelationSettings = {
		...(featherRadius !== undefined ? { featherRadius } : {}),
		...(expand !== undefined ? { expand } : {}),
		...(opacity !== undefined ? { opacity: Math.min(1, opacity) } : {}),
		...(invert !== undefined ? { invert } : {}),
		...(channel !== undefined ? { channel } : {}),
		...(sourceSampling !== undefined ? { sourceSampling } : {}),
		...(coordinateSpace !== undefined ? { coordinateSpace } : {}),
	};
	return isEmptyRecord(settings) ? undefined : settings;
};

const maskRelationSettingsOmitting = (
	settings: AppearanceMaskRelationSettings | undefined,
	key: keyof AppearanceMaskRelationSettings,
): AppearanceMaskRelationSettings | undefined => {
	if (!settings) return undefined;
	const next: AppearanceMaskRelationSettings = {
		...(key !== "featherRadius" && settings.featherRadius !== undefined
			? { featherRadius: settings.featherRadius }
			: {}),
		...(key !== "expand" && settings.expand !== undefined
			? { expand: settings.expand }
			: {}),
		...(key !== "opacity" && settings.opacity !== undefined
			? { opacity: settings.opacity }
			: {}),
		...(key !== "invert" && settings.invert !== undefined
			? { invert: settings.invert }
			: {}),
		...(key !== "channel" && settings.channel !== undefined
			? { channel: settings.channel }
			: {}),
		...(key !== "sourceSampling" && settings.sourceSampling !== undefined
			? { sourceSampling: settings.sourceSampling }
			: {}),
		...(key !== "coordinateSpace" && settings.coordinateSpace !== undefined
			? { coordinateSpace: settings.coordinateSpace }
			: {}),
	};
	return isEmptyRecord(next) ? undefined : next;
};

const maskRelationSettingsMerged = (
	settings: AppearanceMaskRelationSettings | undefined,
	patch: Partial<AppearanceMaskRelationSettings>,
): AppearanceMaskRelationSettings | undefined => {
	const next = { ...(settings ?? {}), ...patch };
	return isEmptyRecord(next) ? undefined : next;
};

/**
 * Applies one scalar property write to a mask relation's additive `settings`
 * bucket. Each property clears its key when set to its no-op default
 * (`featherRadius`/`expand` -> 0, `opacity` -> 1, `invert` -> off) so a relation
 * with all-default settings serializes identically to one with none, preserving
 * the hard-mask baseline. `expand` is signed; `opacity` clamps to `0..1`;
 * `invert` reads the numeric value as a boolean.
 */
const maskRelationSettingsWithProperty = (
	settings: AppearanceMaskRelationSettings | undefined,
	propertyId: MaskRelationPropertyId,
	value: number,
): AppearanceMaskRelationSettings | undefined => {
	if (!Number.isFinite(value)) return settings;
	switch (propertyId) {
		case MASK_RELATION_FEATHER_PROPERTY_ID:
			return value > 0
				? maskRelationSettingsMerged(settings, { featherRadius: value })
				: maskRelationSettingsOmitting(settings, "featherRadius");
		case MASK_RELATION_OPACITY_PROPERTY_ID: {
			const clamped = Math.min(1, Math.max(0, value));
			return clamped < 1
				? maskRelationSettingsMerged(settings, { opacity: clamped })
				: maskRelationSettingsOmitting(settings, "opacity");
		}
		case MASK_RELATION_EXPAND_PROPERTY_ID:
			return value !== 0
				? maskRelationSettingsMerged(settings, { expand: value })
				: maskRelationSettingsOmitting(settings, "expand");
		case MASK_RELATION_INVERT_PROPERTY_ID:
			return value !== 0
				? maskRelationSettingsMerged(settings, { invert: true })
				: maskRelationSettingsOmitting(settings, "invert");
		default:
			// Defensive: an unrecognized id leaves settings untouched rather than
			// stripping the bucket (the typed union makes this unreachable in TS).
			return settings;
	}
};

const nativeAppearanceRecord = (
	node: Pick<VectorNode, "data">,
): Record<string, unknown> | undefined => {
	const rawAppearance = node.data?.appearance;
	return isRecord(rawAppearance) ? rawAppearance : undefined;
};

const appearanceRecord = (
	node: Pick<VectorNode, "data">,
): Record<string, unknown> | undefined => {
	const rawAppearance = node.data?.importAppearance;
	return isRecord(rawAppearance) ? rawAppearance : undefined;
};

const importedEffectEntry = (
	value: unknown,
): ImportedAppearanceEffectMetadata | undefined => {
	if (!isRecord(value)) return undefined;
	const kind = stringField(value.kind);
	const effectValue = stringField(value.value);
	if (!kind || !effectValue) return undefined;
	return {
		kind,
		value: effectValue,
		...(stringField(value.ref) ? { ref: stringField(value.ref) } : {}),
		...(stringField(value.sourcePath)
			? { sourcePath: stringField(value.sourcePath) }
			: {}),
	};
};

const importedPaintEntry = (
	value: unknown,
): ImportedPaintEntryMetadata | undefined => {
	if (!isRecord(value)) return undefined;
	const source = stringField(value.source);
	const fallback = stringField(value.fallback);
	if (!source || !fallback) return undefined;
	return {
		source,
		...(stringField(value.ref) ? { ref: stringField(value.ref) } : {}),
		fallback,
		...(stringField(value.sourcePath)
			? { sourcePath: stringField(value.sourcePath) }
			: {}),
		...(booleanField(value.unsupported) !== undefined
			? { unsupported: booleanField(value.unsupported) }
			: {}),
	};
};

const importedPaint = (value: unknown): ImportedPaintMetadata | undefined => {
	if (!isRecord(value)) return undefined;
	const fill = importedPaintEntry(value.fill);
	const stroke = importedPaintEntry(value.stroke);
	if (!fill && !stroke) return undefined;
	return {
		...(fill ? { fill } : {}),
		...(stroke ? { stroke } : {}),
	};
};

const importedCompoundPath = (
	value: unknown,
): ImportedCompoundPathMetadata | undefined => {
	if (!isRecord(value)) return undefined;
	const source = stringField(value.source);
	if (!source) return undefined;
	return {
		source,
		...(stringField(value.fillRule)
			? { fillRule: stringField(value.fillRule) }
			: {}),
		...(numberField(value.subpathCount) !== undefined
			? { subpathCount: numberField(value.subpathCount) }
			: {}),
		...(numberField(value.subpathIndex) !== undefined
			? { subpathIndex: numberField(value.subpathIndex) }
			: {}),
		...(stringField(value.sourcePath)
			? { sourcePath: stringField(value.sourcePath) }
			: {}),
	};
};

const importedOpacityGroup = (
	value: unknown,
): ImportedOpacityGroupMetadata | undefined => {
	if (!isRecord(value)) return undefined;
	const source = stringField(value.source);
	const opacity = numberField(value.opacity);
	if (!source || opacity === undefined) return undefined;
	return {
		source,
		opacity,
		flattenedTo: "node-opacity",
		...(stringField(value.ref) ? { ref: stringField(value.ref) } : {}),
		...(stringField(value.sourcePath)
			? { sourcePath: stringField(value.sourcePath) }
			: {}),
	};
};

const uniqueByKey = <Value>(
	values: readonly Value[],
	keyFor: (value: Value) => string,
): readonly Value[] => {
	const seen = new Set<string>();
	const result: Value[] = [];
	for (const value of values) {
		const key = keyFor(value);
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(value);
	}
	return result;
};

const uniqueStrings = (values: readonly string[]): readonly string[] =>
	uniqueByKey(values, (value) => value);

const effectKey = (effect: ImportedAppearanceEffectMetadata): string =>
	[effect.kind, effect.value, effect.ref ?? "", effect.sourcePath ?? ""].join(
		"\u0000",
	);

const opacityGroupKey = (group: ImportedOpacityGroupMetadata): string =>
	[
		group.source,
		String(group.opacity),
		group.ref ?? "",
		group.sourcePath ?? "",
		group.flattenedTo,
	].join("\u0000");

const clipMaskRelationKey = (
	relation: ImportedClipMaskRelationMetadata,
): string =>
	[
		relation.kind,
		relation.value,
		relation.ref ?? "",
		relation.sourcePath ?? "",
		relation.fallback,
		...relation.affectedNodeIds,
	].join("\u0000");

const clipMaskRelationSourceKey = (
	relation: ImportedClipMaskRelationMetadata,
): string =>
	[
		relation.kind,
		relation.value,
		relation.ref ?? "",
		relation.sourcePath ?? "",
		relation.fallback,
	].join("\u0000");

/**
 * Identifies imported clipping and masking effect kinds that future native mask
 * UI can treat as relations instead of generic dropped-effect diagnostics.
 */
export function isImportedClipMaskKind(
	kind: string,
): kind is ImportedClipMaskRelationKind {
	return kind === "clip-path" || kind === "mask" || kind === "soft-mask";
}

/**
 * Mints a stable relation id from source locators and affected targets. The id
 * is deterministic across import/export passes and remains optional in stored
 * data so older documents can be normalized without a schema migration.
 */
export function createAppearanceMaskRelationId(
	input: AppearanceMaskRelationInput,
): string {
	const affectedNodeIds = sortedUniqueStrings(input.affectedNodeIds ?? []);
	const seed = [
		input.origin ?? "native",
		input.kind,
		input.value ?? "",
		input.maskNodeId ?? "",
		input.ref ?? "",
		input.sourcePath ?? "",
		...affectedNodeIds,
	].join("\u0000");
	const primary = input.ref ?? input.maskNodeId ?? input.value ?? input.kind;
	return `mask-rel-${relationIdPart(input.kind)}-${relationIdPart(primary)}-${hashString(seed)}`;
}

/**
 * Normalizes one native/imported mask relation into the authoring seam. A
 * relation may point at source metadata (`value`/`ref`/`sourcePath`) or a native
 * scene mask node (`maskNodeId`); in both cases `affectedNodeIds` are editable
 * scene nodes that report/export UI can target directly.
 */
export function createAppearanceMaskRelationMetadata(
	input: AppearanceMaskRelationInput,
): AppearanceMaskRelationMetadata | undefined {
	if (!isImportedClipMaskKind(input.kind)) return undefined;
	const value = stringField(input.value);
	const maskNodeId = stringField(input.maskNodeId);
	if (!value && !maskNodeId) return undefined;
	const origin = input.origin ?? "native";
	const affectedNodeIds = uniqueStrings(input.affectedNodeIds ?? []);
	const settings = appearanceMaskRelationSettings(input.settings);
	return {
		id:
			stringField(input.id) ??
			createAppearanceMaskRelationId({ ...input, origin }),
		kind: input.kind,
		origin,
		affectedNodeIds,
		fallback: "unclipped-vector",
		...(value ? { value } : {}),
		...(maskNodeId ? { maskNodeId } : {}),
		...(stringField(input.ref) ? { ref: stringField(input.ref) } : {}),
		...(stringField(input.sourcePath)
			? { sourcePath: stringField(input.sourcePath) }
			: {}),
		...(settings ? { settings } : {}),
	};
}

const appearanceMaskRelation = (
	value: unknown,
): AppearanceMaskRelationMetadata | undefined => {
	if (!isRecord(value)) return undefined;
	const kind = stringField(value.kind);
	if (!kind || !isImportedClipMaskKind(kind)) return undefined;
	const id = stringField(value.id);
	const relationValue = stringField(value.value);
	const maskNodeId = stringField(value.maskNodeId);
	const ref = stringField(value.ref);
	const sourcePath = stringField(value.sourcePath);
	const settings = appearanceMaskRelationSettings(value.settings);
	return createAppearanceMaskRelationMetadata({
		kind,
		origin: appearanceMaskRelationOrigin(value.origin),
		affectedNodeIds: stringArrayField(value.affectedNodeIds),
		...(id ? { id } : {}),
		...(relationValue ? { value: relationValue } : {}),
		...(maskNodeId ? { maskNodeId } : {}),
		...(ref ? { ref } : {}),
		...(sourcePath ? { sourcePath } : {}),
		...(settings ? { settings } : {}),
	});
};

const appearanceMaskRelationsFrom = (
	value: unknown,
): readonly AppearanceMaskRelationMetadata[] =>
	Array.isArray(value)
		? value.flatMap((entry) => {
				const relation = appearanceMaskRelation(entry);
				return relation ? [relation] : [];
			})
		: [];

const appearanceMaskRelationKey = (
	relation: AppearanceMaskRelationMetadata,
): string => relation.id;

const preserveMaskRelationSettings = (
	next: AppearanceMaskRelationMetadata,
	existingRelations: readonly AppearanceMaskRelationMetadata[],
): AppearanceMaskRelationMetadata => {
	if (next.settings) return next;
	const existingSettings = existingRelations.find(
		(relation) => relation.id === next.id,
	)?.settings;
	return existingSettings ? { ...next, settings: existingSettings } : next;
};

const withoutMaskRelationSettings = (
	relation: AppearanceMaskRelationMetadata,
): AppearanceMaskRelationMetadata => {
	return {
		id: relation.id,
		kind: relation.kind,
		origin: relation.origin,
		affectedNodeIds: relation.affectedNodeIds,
		fallback: relation.fallback,
		...(relation.value ? { value: relation.value } : {}),
		...(relation.maskNodeId ? { maskNodeId: relation.maskNodeId } : {}),
		...(relation.ref ? { ref: relation.ref } : {}),
		...(relation.sourcePath ? { sourcePath: relation.sourcePath } : {}),
	};
};

const importedClipMaskRelationToAppearance = (
	relation: ImportedClipMaskRelationMetadata,
): AppearanceMaskRelationMetadata | undefined =>
	createAppearanceMaskRelationMetadata({
		kind: relation.kind,
		origin: "imported",
		affectedNodeIds: relation.affectedNodeIds,
		value: relation.value,
		...(relation.id ? { id: relation.id } : {}),
		...(relation.ref ? { ref: relation.ref } : {}),
		...(relation.sourcePath ? { sourcePath: relation.sourcePath } : {}),
	});

/**
 * Formats one mask relation source for deterministic import/export reports.
 * Native relations prefer the scene mask node id; imported relations prefer the
 * original source reference so source-file review remains possible.
 */
export function maskRelationSourceLabel(
	relation: AppearanceMaskRelationMetadata,
): string {
	const source =
		relation.ref ?? relation.maskNodeId ?? relation.value ?? relation.id;
	return `${relation.kind}:${source}`;
}

/** Returns stable source labels for a compact dropped-mask report string. */
export function maskRelationSourceSummary(
	relations: readonly AppearanceMaskRelationMetadata[],
): string {
	return sortedUniqueStrings(relations.map(maskRelationSourceLabel)).join(", ");
}

/**
 * Returns the editable scene targets affected by one or more mask relations.
 * The fallback id keeps legacy imported documents attributable even when old
 * metadata did not store `affectedNodeIds`.
 */
export function affectedNodeIdsForMaskRelations(
	relations: readonly AppearanceMaskRelationMetadata[],
	fallbackNodeId?: string,
): readonly string[] {
	const ids = sortedUniqueStrings(
		relations.flatMap((relation) => relation.affectedNodeIds),
	);
	return ids.length > 0 ? ids : fallbackNodeId ? [fallbackNodeId] : [];
}

/**
 * Builds normalized clip/mask relation metadata from imported effect data.
 * `affectedNodeIds` are scene node ids, not source SVG/PDF ids, so authoring UI
 * can attach remediation controls directly to editable nodes.
 */
export function createImportedClipMaskRelationMetadata(
	metadata: ImportedAppearanceEffectMetadata & {
		readonly id?: string;
		readonly affectedNodeIds: readonly string[];
	},
): ImportedClipMaskRelationMetadata | undefined {
	if (!isImportedClipMaskKind(metadata.kind)) return undefined;
	const relation = createAppearanceMaskRelationMetadata({
		kind: metadata.kind,
		origin: "imported",
		affectedNodeIds: metadata.affectedNodeIds,
		value: metadata.value,
		...(metadata.id ? { id: metadata.id } : {}),
		...(metadata.ref ? { ref: metadata.ref } : {}),
		...(metadata.sourcePath ? { sourcePath: metadata.sourcePath } : {}),
	});
	if (!relation?.value) return undefined;
	return {
		id: relation.id,
		kind: relation.kind,
		value: relation.value,
		affectedNodeIds: relation.affectedNodeIds,
		fallback: relation.fallback,
		...(relation.ref ? { ref: relation.ref } : {}),
		...(relation.sourcePath ? { sourcePath: relation.sourcePath } : {}),
	};
}

const importedClipMaskRelation = (
	value: unknown,
): ImportedClipMaskRelationMetadata | undefined => {
	if (!isRecord(value)) return undefined;
	const kind = stringField(value.kind);
	const relationValue = stringField(value.value);
	if (!kind || !isImportedClipMaskKind(kind) || !relationValue) {
		return undefined;
	}
	return createImportedClipMaskRelationMetadata({
		id: stringField(value.id),
		kind,
		value: relationValue,
		affectedNodeIds: stringArrayField(value.affectedNodeIds),
		...(stringField(value.ref) ? { ref: stringField(value.ref) } : {}),
		...(stringField(value.sourcePath)
			? { sourcePath: stringField(value.sourcePath) }
			: {}),
	});
};

const effectsFrom = (
	value: unknown,
): readonly ImportedAppearanceEffectMetadata[] =>
	Array.isArray(value)
		? value.flatMap((entry) => {
				const effect = importedEffectEntry(entry);
				return effect ? [effect] : [];
			})
		: [];

const opacityGroupsFrom = (
	value: unknown,
): readonly ImportedOpacityGroupMetadata[] =>
	Array.isArray(value)
		? value.flatMap((entry) => {
				const group = importedOpacityGroup(entry);
				return group ? [group] : [];
			})
		: [];

const clipMaskRelationsFrom = (
	value: unknown,
): readonly ImportedClipMaskRelationMetadata[] =>
	Array.isArray(value)
		? value.flatMap((entry) => {
				const relation = importedClipMaskRelation(entry);
				return relation ? [relation] : [];
			})
		: [];

/**
 * Reads imported effect metadata from both the normalized `importAppearance`
 * seam and the legacy `importEffects` key. Import/export adapters use this
 * helper so clip paths, masks, filters, soft masks, and blend modes keep one
 * typed fallback contract while older documents remain readable.
 */
export function readImportedEffects(
	node: Pick<VectorNode, "data">,
): readonly ImportedAppearanceEffectMetadata[] {
	const appearance = appearanceRecord(node);
	return uniqueByKey(
		[
			...effectsFrom(appearance?.effects),
			...effectsFrom(node.data?.importEffects),
		],
		effectKey,
	);
}

/**
 * Reads imported opacity-group metadata that was flattened into node opacity.
 * The scene model still renders the flattened value, while reports can explain
 * that group compositing may differ from the source document.
 */
export function readImportedOpacityGroups(
	node: Pick<VectorNode, "data">,
): readonly ImportedOpacityGroupMetadata[] {
	return uniqueByKey(
		opacityGroupsFrom(appearanceRecord(node)?.opacityGroups),
		opacityGroupKey,
	);
}

/**
 * Reads imported clipping/mask relations as authoring metadata. Normalized
 * relation data wins, while legacy imported effects are still projected into
 * relation objects using the node id as the affected editable target.
 */
export function readImportedClipMaskRelations(
	node: Pick<VectorNode, "data"> & Partial<Pick<VectorNode, "id">>,
): readonly ImportedClipMaskRelationMetadata[] {
	const appearance = appearanceRecord(node);
	const affectedNodeIds = node.id ? [node.id] : [];
	return uniqueByKey(
		[
			...clipMaskRelationsFrom(appearance?.clipMaskRelations),
			...readImportedEffects(node).flatMap((effect) => {
				const relation = createImportedClipMaskRelationMetadata({
					...effect,
					affectedNodeIds,
				});
				return relation ? [relation] : [];
			}),
		],
		clipMaskRelationSourceKey,
	);
}

/**
 * Reads the native mask authoring seam and projects imported relation metadata
 * into the same shape. Future UI should consume this helper instead of parsing
 * `node.data` buckets directly.
 */
export function readAppearanceMaskRelations(
	node: Pick<VectorNode, "data"> & Partial<Pick<VectorNode, "id">>,
): readonly AppearanceMaskRelationMetadata[] {
	return uniqueByKey(
		[
			...appearanceMaskRelationsFrom(
				nativeAppearanceRecord(node)?.maskRelations,
			),
			...readImportedClipMaskRelations(node).flatMap((relation) => {
				const appearanceRelation =
					importedClipMaskRelationToAppearance(relation);
				return appearanceRelation ? [appearanceRelation] : [];
			}),
		],
		appearanceMaskRelationKey,
	);
}

/**
 * Normalizes optional authoring appearance metadata for storage under
 * `node.data.appearance`. This is intentionally additive: documents without the
 * bucket remain valid, and import metadata stays in `importAppearance`.
 */
export function createAppearanceMetadataData(
	metadata: AppearanceMetadata,
): Record<string, unknown> | undefined {
	const maskRelations = uniqueByKey(
		(metadata.maskRelations ?? []).flatMap((relation) => {
			const normalized = appearanceMaskRelation(relation);
			return normalized ? [normalized] : [];
		}),
		appearanceMaskRelationKey,
	);
	const result: Record<string, unknown> = {};
	if (maskRelations.length > 0) result.maskRelations = maskRelations;
	return Object.keys(result).length > 0 ? result : undefined;
}

const sameSerializable = (left: unknown, right: unknown): boolean =>
	JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

const writeNativeMaskRelations = (
	node: Draft<VectorNode>,
	relations: readonly AppearanceMaskRelationMetadata[],
): void => {
	const data = node.data ? { ...node.data } : {};
	const nextAppearance = createAppearanceMetadataData({
		maskRelations: relations,
	});
	if (nextAppearance) {
		data.appearance = nextAppearance;
	} else {
		delete data.appearance;
	}
	const nextData = Object.keys(data).length > 0 ? data : undefined;
	if (sameSerializable(node.data, nextData)) return;
	if (nextData) {
		node.data = castDraft(nextData);
	} else {
		delete node.data;
	}
};

const editableDraftNode = (
	draft: Draft<SceneDocument>,
	nodeId: string,
): Draft<VectorNode> | undefined => {
	const layer = findDraftLayerByNodeId(draft, nodeId);
	if (!layer?.visible || layer.locked) return undefined;
	const node = findDraftNode(draft, nodeId);
	if (!node?.visible || node.locked) return undefined;
	return node;
};

/**
 * Creates an undoable command that attaches or updates one native mask relation
 * on the target node. The relation is stored as optional metadata only; renderers
 * and importers keep their current schema while future mask UI can connect to
 * this command boundary.
 */
export function createSetNodeMaskRelationCommand(
	nodeId: string,
	input: Omit<AppearanceMaskRelationInput, "origin" | "affectedNodeIds"> & {
		readonly affectedNodeIds?: readonly string[];
	},
	options: SetNodeMaskRelationOptions = {},
): SceneCommand {
	return {
		type: "scene/set-node-mask-relation",
		label: options.label ?? "Set mask relation",
		...(options.coalesceKey ? { coalesceKey: options.coalesceKey } : {}),
		run: (draft) => {
			const node = editableDraftNode(draft, nodeId);
			if (!node) return;
			const relation = createAppearanceMaskRelationMetadata({
				...input,
				origin: "native",
				affectedNodeIds: uniqueStrings([
					nodeId,
					...(input.affectedNodeIds ?? []),
				]),
			});
			if (!relation) return;
			const existingRelations = appearanceMaskRelationsFrom(
				nativeAppearanceRecord(node)?.maskRelations,
			);
			const nextRelation = preserveMaskRelationSettings(
				relation,
				existingRelations,
			);
			writeNativeMaskRelations(
				node,
				uniqueByKey(
					[
						...existingRelations.filter(
							(existing) => existing.id !== nextRelation.id,
						),
						nextRelation,
					],
					appearanceMaskRelationKey,
				),
			);
		},
	};
}

/**
 * Creates an undoable command that removes one native mask relation from a node.
 * Imported relation metadata is intentionally untouched so source fidelity
 * reporting remains stable after native authoring experiments.
 */
export function createRemoveNodeMaskRelationCommand(
	nodeId: string,
	relationId: string,
	options: SetNodeMaskRelationOptions = {},
): SceneCommand {
	return {
		type: "scene/remove-node-mask-relation",
		label: options.label ?? "Remove mask relation",
		...(options.coalesceKey ? { coalesceKey: options.coalesceKey } : {}),
		run: (draft) => {
			const node = editableDraftNode(draft, nodeId);
			if (!node) return;
			const existingRelations = appearanceMaskRelationsFrom(
				nativeAppearanceRecord(node)?.maskRelations,
			);
			const nextRelations = existingRelations.filter(
				(relation) => relation.id !== relationId,
			);
			if (nextRelations.length === existingRelations.length) return;
			writeNativeMaskRelations(node, nextRelations);
		},
	};
}

/**
 * Creates an undoable command that edits a scalar property on one native mask
 * relation. The command preserves the relation id and only changes the additive
 * `settings` bucket, so renderers, code tools, and future Effect Layer proxy
 * controls can all address the same relation without creating a second state
 * owner.
 */
export function createSetMaskRelationPropertyCommand(
	contentNodeId: string,
	relationId: string,
	propertyId: MaskRelationPropertyId,
	value: number,
	options: SetNodeMaskRelationOptions = {},
): SceneCommand {
	return {
		type: "scene/set-mask-relation-property",
		label: options.label ?? "Edit mask relation",
		...(options.coalesceKey ? { coalesceKey: options.coalesceKey } : {}),
		run: (draft) => {
			// Finite-only: `expand` is signed (negative = erode/choke), so the
			// per-property setter owns clamping/clearing rather than a blanket
			// non-negative gate here.
			if (!Number.isFinite(value)) return;
			const node = editableDraftNode(draft, contentNodeId);
			if (!node) return;
			const existingRelations = appearanceMaskRelationsFrom(
				nativeAppearanceRecord(node)?.maskRelations,
			);
			let changed = false;
			const nextRelations = existingRelations.map((relation) => {
				if (relation.id !== relationId) return relation;
				changed = true;
				const settings = maskRelationSettingsWithProperty(
					relation.settings,
					propertyId,
					value,
				);
				return settings
					? { ...relation, settings }
					: withoutMaskRelationSettings(relation);
			});
			if (!changed) return;
			writeNativeMaskRelations(node, nextRelations);
		},
	};
}

/**
 * Edits the durable matte behavior that is not a scalar bindable property:
 * alpha/luminance channel, pre/post-effect source sampling, and coordinate space.
 */
export function createSetMaskRelationBehaviorCommand(
	contentNodeId: string,
	relationId: string,
	patch: Partial<
		Pick<
			AppearanceMaskRelationSettings,
			"channel" | "sourceSampling" | "coordinateSpace"
		>
	>,
	options: SetNodeMaskRelationOptions = {},
): SceneCommand {
	return {
		type: "scene/set-mask-relation-behavior",
		label: options.label ?? "Edit matte behavior",
		...(options.coalesceKey ? { coalesceKey: options.coalesceKey } : {}),
		run: (draft) => {
			const node = editableDraftNode(draft, contentNodeId);
			if (!node) return;
			const relations = appearanceMaskRelationsFrom(
				nativeAppearanceRecord(node)?.maskRelations,
			);
			let changed = false;
			const next = relations.map((relation) => {
				if (relation.id !== relationId) return relation;
				changed = true;
				const settings = appearanceMaskRelationSettings({
					...(relation.settings ?? {}),
					...patch,
				});
				return settings
					? { ...relation, settings }
					: withoutMaskRelationSettings(relation);
			});
			if (changed) writeNativeMaskRelations(node, next);
		},
	};
}

export type UseNodeAsMaskOptions = {
	readonly label?: string;
	/** Relation kind to author. Defaults to `clip-path` (Illustrator clip mask). */
	readonly kind?: AppearanceMaskRelationKind;
	readonly settings?: AppearanceMaskRelationSettings;
	readonly coalesceKey?: string;
};

/**
 * Authors a Figma/Illustrator-style "use as mask" relation in one undoable
 * command: the `maskNodeId` shape becomes the mask for the given sibling content
 * nodes. The relation is written as additive native metadata onto each masked
 * content node (mirroring {@link createSetNodeMaskRelationCommand}); the document
 * geometry/schema is untouched, so renderers and importers keep their contract
 * while the render descriptor can represent the mask.
 *
 * Scope is deliberately sibling-only: the mask source and every content target
 * must be TOP-LEVEL nodes in the same editable layer. Cross-layer, nested, or
 * locked/hidden targets are skipped so the relation never points outside the
 * coordinate space the mask can actually clip. The command no-ops when the mask
 * source is not an editable top-level node or when no valid content remains, so
 * optimistic selection state cannot corrupt the document.
 */
export function createUseNodeAsMaskCommand(
	maskNodeId: string,
	contentNodeIds: readonly string[],
	options: UseNodeAsMaskOptions = {},
): SceneCommand {
	const kind = options.kind ?? "clip-path";
	return {
		type: "scene/use-node-as-mask",
		label: options.label ?? "Use as mask",
		...(options.coalesceKey ? { coalesceKey: options.coalesceKey } : {}),
		run: (draft) => {
			const maskNode = editableDraftNode(draft, maskNodeId);
			if (!maskNode) return;
			const maskArtboardId = selectArtboardIdForNode(
				draft as unknown as SceneDocument,
				maskNodeId,
			);
			const sourceSubtreeIds = new Set<string>();
			const collectSourceSubtree = (node: Draft<VectorNode>): void => {
				sourceSubtreeIds.add(node.id);
				for (const child of node.children ?? []) collectSourceSubtree(child);
			};
			collectSourceSubtree(maskNode);

			const targets = uniqueStrings(contentNodeIds).filter((contentNodeId) => {
				if (sourceSubtreeIds.has(contentNodeId)) return false;
				const content = editableDraftNode(draft, contentNodeId);
				return (
					content !== undefined &&
					selectArtboardIdForNode(
						draft as unknown as SceneDocument,
						contentNodeId,
					) === maskArtboardId
				);
			});
			if (targets.length === 0) return;

			for (const contentNodeId of targets) {
				const node = editableDraftNode(draft, contentNodeId);
				if (!node) continue;
				const relation = createAppearanceMaskRelationMetadata({
					kind,
					origin: "native",
					maskNodeId,
					affectedNodeIds: [contentNodeId],
					...(options.settings ? { settings: options.settings } : {}),
				});
				if (!relation) continue;
				const existingRelations = appearanceMaskRelationsFrom(
					nativeAppearanceRecord(node)?.maskRelations,
				);
				const nextRelation = preserveMaskRelationSettings(
					relation,
					existingRelations,
				);
				writeNativeMaskRelations(
					node,
					uniqueByKey(
						[
							...existingRelations.filter(
								(existing) => existing.id !== nextRelation.id,
							),
							nextRelation,
						],
						appearanceMaskRelationKey,
					),
				);
			}
		},
	};
}

export type ReleaseMaskOptions = {
	readonly label?: string;
	readonly coalesceKey?: string;
};

/**
 * Releases a "use as mask" relation in one undoable command: removes every NATIVE
 * mask relation that targets `maskNodeId` from all top-level content nodes, so the
 * source paints as ordinary geometry again and its former content renders
 * unclipped. The inverse of {@link createUseNodeAsMaskCommand}.
 *
 * Geometry is never mutated — only the additive relation metadata is cleared — so
 * the whole release is a single, lossless undo entry. Imported relation metadata
 * is intentionally left intact (source-fidelity reporting), mirroring
 * {@link createRemoveNodeMaskRelationCommand}. Unlike the per-relation commands it
 * does NOT apply the editable guard to content: a node that was masked while
 * editable but later locked must still be releasable, and clearing metadata on a
 * locked node changes no geometry. No-ops (produces no history) when nothing
 * references the source.
 */
export function createReleaseMaskCommand(
	maskNodeId: string,
	options: ReleaseMaskOptions = {},
): SceneCommand {
	return {
		type: "scene/release-mask",
		label: options.label ?? "Release mask",
		...(options.coalesceKey ? { coalesceKey: options.coalesceKey } : {}),
		run: (draft) => {
			const releaseFromNode = (node: Draft<VectorNode>): void => {
				const existingRelations = appearanceMaskRelationsFrom(
					nativeAppearanceRecord(node)?.maskRelations,
				);
				if (existingRelations.length > 0) {
					const nextRelations = existingRelations.filter(
						(relation) => relation.maskNodeId !== maskNodeId,
					);
					if (nextRelations.length !== existingRelations.length)
						writeNativeMaskRelations(node, nextRelations);
				}
				for (const child of node.children ?? []) releaseFromNode(child);
			};
			for (const layer of draft.layers) {
				for (const node of layer.nodes) releaseFromNode(node);
			}
		},
	};
}

/**
 * Reads imported paint fallback metadata from normalized appearance data or the
 * legacy `importPaint` key. Normalized entries win per paint role so future
 * parsers can repair metadata without breaking older imports.
 */
export function readImportedPaint(
	node: Pick<VectorNode, "data">,
): ImportedPaintMetadata | undefined {
	const appearancePaint = importedPaint(appearanceRecord(node)?.paint);
	const legacyPaint = importedPaint(node.data?.importPaint);
	const fill = appearancePaint?.fill ?? legacyPaint?.fill;
	const stroke = appearancePaint?.stroke ?? legacyPaint?.stroke;
	if (!fill && !stroke) return undefined;
	return {
		...(fill ? { fill } : {}),
		...(stroke ? { stroke } : {}),
	};
}

/**
 * Reads imported compound-path fallback metadata from normalized appearance data
 * or the legacy `importCompoundPath` key. The value is report-only until the
 * scene model grows a native compound-path contract.
 */
export function readImportedCompoundPath(
	node: Pick<VectorNode, "data">,
): ImportedCompoundPathMetadata | undefined {
	return (
		importedCompoundPath(appearanceRecord(node)?.compoundPath) ??
		importedCompoundPath(node.data?.importCompoundPath)
	);
}

/**
 * Returns the complete normalized imported-appearance payload for a node. Empty
 * or malformed data collapses to empty arrays/undefined optional fields so
 * renderers and report builders never branch on unknown object shapes.
 */
export function readImportedAppearance(
	node: Pick<VectorNode, "data">,
): ImportedAppearanceMetadata {
	const effects = readImportedEffects(node);
	const opacityGroups = readImportedOpacityGroups(node);
	const clipMaskRelations = readImportedClipMaskRelations(node);
	const paint = readImportedPaint(node);
	const compoundPath = readImportedCompoundPath(node);
	return {
		effects,
		opacityGroups,
		...(clipMaskRelations.length > 0 ? { clipMaskRelations } : {}),
		...(paint ? { paint } : {}),
		...(compoundPath ? { compoundPath } : {}),
	};
}

/**
 * Normalizes imported appearance metadata to a POJO suitable for `node.data`.
 * Callers may continue writing legacy keys for compatibility; this helper owns
 * the forward-looking aggregate shape that future clip-mask UI can read.
 */
export function createImportedAppearanceMetadataData(metadata: {
	readonly effects?: readonly ImportedAppearanceEffectMetadata[];
	readonly opacityGroups?: readonly ImportedOpacityGroupMetadata[];
	readonly clipMaskRelations?: readonly ImportedClipMaskRelationMetadata[];
	readonly paint?: ImportedPaintMetadata;
	readonly compoundPath?: ImportedCompoundPathMetadata;
}): Record<string, unknown> | undefined {
	const effects = uniqueByKey(
		(metadata.effects ?? []).flatMap((effect) => {
			const normalized = importedEffectEntry(effect);
			return normalized ? [normalized] : [];
		}),
		effectKey,
	);
	const opacityGroups = uniqueByKey(
		(metadata.opacityGroups ?? []).flatMap((group) => {
			const normalized = importedOpacityGroup(group);
			return normalized ? [normalized] : [];
		}),
		opacityGroupKey,
	);
	const clipMaskRelations = uniqueByKey(
		(metadata.clipMaskRelations ?? []).flatMap((relation) => {
			const normalized = importedClipMaskRelation(relation);
			return normalized ? [normalized] : [];
		}),
		clipMaskRelationKey,
	);
	const paint = importedPaint(metadata.paint);
	const compoundPath = importedCompoundPath(metadata.compoundPath);
	const result: Record<string, unknown> = {};
	if (effects.length > 0) result.effects = effects;
	if (opacityGroups.length > 0) result.opacityGroups = opacityGroups;
	if (clipMaskRelations.length > 0) {
		result.clipMaskRelations = clipMaskRelations;
	}
	if (paint) result.paint = paint;
	if (compoundPath) result.compoundPath = compoundPath;
	return Object.keys(result).length > 0 ? result : undefined;
}
