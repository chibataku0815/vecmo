/**
 * Provider-neutral contract for one externally produced 3D source that Vecmo
 * links instead of owning. The first adapter is Blender, but nothing in the
 * durable shape is Blender-specific beyond the allowlisted binding descriptor.
 *
 * Two disciplines are load-bearing here:
 * - The durable document never carries a filesystem path, pairing token, or
 *   executable expression. Local path identity lives only in the working-copy
 *   registry owned by `entities/editor-session`.
 * - Every field is parsed field-by-field before it reaches `SceneDocument`.
 *   Cloud restore, portable backup, and the agent's asset upsert all reach the
 *   scene asset normalizer with unvalidated data, so the static type of an
 *   incoming link is a claim, never a guarantee.
 */

/** V1 is the only contract this build accepts; a future bump is explicit. */
export const EXTERNAL_PRODUCTION_LINK_CONTRACT_VERSION = 1 as const;

const MAX_TEXT_LENGTH = 256;
const MAX_NAME_LENGTH = 128;
const MAX_PUBLISHED_CONTROLS = 128;
/** A vertical field of view is a strictly positive angle below a half turn. */
const MAX_VERTICAL_FOV_RADIANS = Math.PI;

const digestPattern = /^(?:sha256:)?[a-f0-9]{64}$/iu;
const controlIdPattern = /^[a-z][a-z0-9_-]{0,63}$/iu;
/**
 * Custom property names are dictionary keys, not data paths. Rejecting `.`,
 * `[`, and quoting characters is what keeps an allowlisted descriptor from
 * smuggling `objects["x"].modifiers[0].strength` through a structural field.
 */
const bindingPropertyNamePattern = /^[a-z_][a-z0-9_]{0,63}$/iu;
const FIRST_PRINTABLE_CODE_POINT = 0x20;
const DELETE_CODE_POINT = 0x7f;

/**
 * Blender datablock names legitimately contain dots and spaces (`Cube.001`),
 * so only the characters that would let a name escape a dictionary lookup are
 * rejected: brackets, quotes, and slashes, plus control characters.
 */
const UNSAFE_NAME_CHARACTERS: ReadonlySet<string> = new Set([
	"[",
	"]",
	'"',
	"'",
	"\\",
	"/",
]);

const hasControlCharacter = (value: string): boolean =>
	[...value].some((character) => {
		const codePoint = character.codePointAt(0) ?? FIRST_PRINTABLE_CODE_POINT;
		return (
			codePoint < FIRST_PRINTABLE_CODE_POINT || codePoint === DELETE_CODE_POINT
		);
	});

const hasUnsafeNameCharacter = (value: string): boolean =>
	hasControlCharacter(value) ||
	[...value].some((character) => UNSAFE_NAME_CHARACTERS.has(character));
const windowsAbsolutePathPattern = /^[a-z]:[\\/]/iu;

export type BlenderBindingOwnerType = "OBJECT" | "SCENE";

/**
 * The only descriptor shape a linked production may publish. It names an owner
 * and a property; resolving it is a dictionary lookup in the adapter, never an
 * evaluated data path and never Python.
 */
export type AllowlistedBindingDescriptor = {
	readonly kind: "custom-property";
	readonly ownerType: BlenderBindingOwnerType;
	readonly ownerName: string;
	readonly propertyName: string;
};

export type PublishedControlUnit =
	| "scalar"
	| "degrees"
	| "scene-unit"
	| "frames";

/**
 * One author-published numeric control. V1 is finite numbers only; boolean,
 * enum, color, and vector wait for demonstrated need.
 *
 * `rangeDeclared` and `defaultIsAmbiguous` exist because Blender's
 * `id_properties_ui().as_dict()` fabricates a plus/minus FLT_MAX range and a
 * `0.0` default for undeclared custom properties. Without those flags a
 * consumer cannot tell an authored constraint from an API-invented one, so a
 * fabricated bound must never silently become a UI constraint or a fallback.
 */
export type PublishedControl = {
	readonly id: string;
	readonly label: string;
	readonly valueType: "number";
	readonly unit: PublishedControlUnit;
	readonly defaultValue: number;
	readonly min?: number;
	readonly max?: number;
	readonly rangeDeclared: boolean;
	readonly defaultIsAmbiguous: boolean;
	readonly blenderBinding: AllowlistedBindingDescriptor;
};

/**
 * One authored static value for a published control. It is the Scene-owned half
 * of a control's state: the constant an author sets when the control carries no
 * keyframes, and the base a keyframed control falls back to outside its track.
 *
 * Keyframes deliberately do NOT live here. Timeline data is Motion-owned
 * (`MotionDocument.productionControlTracks`), and the same `controlId` resolves
 * both halves, so a control edit is one intent even when it spans two stores.
 */
export type ProductionControlValue = {
	readonly controlId: string;
	readonly value: number;
};

/**
 * `rendered-rgba-sequence` is reserved in the union from the start so the
 * frozen contract does not have to change when the rendered path lands. It
 * parses as a valid declaration today and is typed-unsupported at runtime.
 */
export type ExternalProductionOutputProfile =
	| "interactive-glb"
	| "rendered-rgba-sequence";

export type ExternalProductionSource = {
	/** Display label only. A filesystem path never becomes durable document data. */
	readonly displayName: string;
	/**
	 * Closure digest over the source graph, not the `.blend` bytes alone. S0a
	 * measured that re-saving a `.blend` is not byte-identical, so this carries
	 * per-saved-file semantics rather than content identity: equality proves the
	 * same saved file, inequality does not prove different meaning.
	 */
	readonly sourceDigest?: string;
	/** Opaque adapter-scoped selector, such as a scene name inside the source. */
	readonly sceneSelector?: string;
};

export type ExternalProductionFrameContract = {
	readonly fps: number;
	readonly durationFrames: number;
	readonly blenderFrameStart: number;
};

/**
 * Vecmo's shot camera is authoritative. `verticalFovRadians` is the canonical
 * optic, never a focal length: Vecmo's `focalLengthMm` is derived from a fixed
 * 36mm sensor convention and is not a physical lens value. `sensorFit` is
 * pinned to `VERTICAL` so the producing side matches that axis, and
 * `sceneUnitsPerPixel` is required because Vecmo world units are scene pixels.
 */
export type ExternalProductionCameraContract = {
	readonly mode: "vecmo-shot-camera";
	readonly sceneCameraRigId: string;
	readonly verticalFovRadians: number;
	readonly sceneUnitsPerPixel: number;
	readonly sensorFit: "VERTICAL";
	/**
	 * Physical f-stop only, produced by an explicit conversion. Vecmo's
	 * `apertureStrength` is a defocus contrast multiplier and never belongs here.
	 */
	readonly aperture?: { readonly fStop: number };
};

export type ExternalProductionLink = {
	readonly contractVersion: typeof EXTERNAL_PRODUCTION_LINK_CONTRACT_VERSION;
	readonly adapter: "blender";
	readonly linkId: string;
	readonly source: ExternalProductionSource;
	readonly frame: ExternalProductionFrameContract;
	readonly camera: ExternalProductionCameraContract;
	readonly outputProfile: ExternalProductionOutputProfile;
	readonly controls: readonly PublishedControl[];
	/**
	 * Authored static control values. Absent on every link written before this
	 * field existed, and absent again whenever no control has been given a value,
	 * so a legacy document round-trips byte-identically and its build key does not
	 * move just because the contract grew.
	 */
	readonly values?: readonly ProductionControlValue[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

const isPositiveFinite = (value: unknown): value is number =>
	isFiniteNumber(value) && value > 0;

const isSafeInteger = (value: unknown): value is number =>
	typeof value === "number" && Number.isSafeInteger(value);

const isPositiveInteger = (value: unknown): value is number =>
	isSafeInteger(value) && value > 0;

const normalizedString = (
	value: unknown,
	maxLength: number,
): string | undefined => {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 && trimmed.length <= maxLength
		? trimmed
		: undefined;
};

/** Bounded datablock-style name that cannot escape a dictionary lookup. */
const normalizedSafeName = (value: unknown): string | undefined => {
	const name = normalizedString(value, MAX_NAME_LENGTH);
	return name && !hasUnsafeNameCharacter(name) ? name : undefined;
};

/** Bounded human-readable text. Display-only, so punctuation stays legal. */
const normalizedDisplayText = (value: unknown): string | undefined => {
	const text = normalizedString(value, MAX_TEXT_LENGTH);
	return text && !hasControlCharacter(text) ? text : undefined;
};

/**
 * Rejects anything that reads as a filesystem location. The link contract is
 * the durable half of the design; local path identity stays in the working-copy
 * registry, so the source label may never leak one.
 */
const isPathFreeLabel = (label: string): boolean =>
	!label.includes("\\") &&
	!label.startsWith("/") &&
	!label.startsWith("~") &&
	!label.includes("/") &&
	!windowsAbsolutePathPattern.test(label) &&
	!/^\w+:/u.test(label);

const parseSourceDisplayName = (value: unknown): string | undefined => {
	const label = normalizedDisplayText(value);
	return label && isPathFreeLabel(label) ? label : undefined;
};

const parseSourceDigest = (value: unknown): string | undefined => {
	const digest = normalizedString(value, MAX_TEXT_LENGTH)?.toLowerCase();
	return digest && digestPattern.test(digest) ? digest : undefined;
};

const parseBindingDescriptor = (
	value: unknown,
): AllowlistedBindingDescriptor | null => {
	if (!isRecord(value) || value.kind !== "custom-property") return null;
	if (value.ownerType !== "OBJECT" && value.ownerType !== "SCENE") return null;
	const ownerName = normalizedSafeName(value.ownerName);
	const propertyName = normalizedString(value.propertyName, MAX_NAME_LENGTH);
	if (!ownerName || !propertyName) return null;
	if (!bindingPropertyNamePattern.test(propertyName)) return null;
	return {
		kind: "custom-property",
		ownerType: value.ownerType,
		ownerName,
		propertyName,
	};
};

const parsePublishedControlUnit = (
	value: unknown,
): PublishedControlUnit | null => {
	switch (value) {
		case "scalar":
		case "degrees":
		case "scene-unit":
		case "frames":
			return value;
		default:
			return null;
	}
};

const parsePublishedControl = (value: unknown): PublishedControl | null => {
	if (!isRecord(value) || value.valueType !== "number") return null;
	const id = normalizedString(value.id, MAX_NAME_LENGTH);
	if (!id || !controlIdPattern.test(id)) return null;
	const label = normalizedDisplayText(value.label);
	if (!label) return null;
	const unit = parsePublishedControlUnit(value.unit);
	if (!unit) return null;
	if (!isFiniteNumber(value.defaultValue)) return null;
	if (
		typeof value.rangeDeclared !== "boolean" ||
		typeof value.defaultIsAmbiguous !== "boolean"
	) {
		return null;
	}
	const { min, max } = value;
	if (min !== undefined && !isFiniteNumber(min)) return null;
	if (max !== undefined && !isFiniteNumber(max)) return null;
	if (isFiniteNumber(min) && isFiniteNumber(max) && min > max) return null;
	// A fabricated range must not reject an honest default, so the containment
	// rule applies only where the author actually declared the bounds.
	if (value.rangeDeclared) {
		if (isFiniteNumber(min) && value.defaultValue < min) return null;
		if (isFiniteNumber(max) && value.defaultValue > max) return null;
	}
	const blenderBinding = parseBindingDescriptor(value.blenderBinding);
	if (!blenderBinding) return null;
	return {
		id,
		label,
		valueType: "number",
		unit,
		defaultValue: value.defaultValue,
		...(isFiniteNumber(min) ? { min } : {}),
		...(isFiniteNumber(max) ? { max } : {}),
		rangeDeclared: value.rangeDeclared,
		defaultIsAmbiguous: value.defaultIsAmbiguous,
		blenderBinding,
	};
};

const parsePublishedControls = (
	value: unknown,
): readonly PublishedControl[] | null => {
	if (!Array.isArray(value) || value.length > MAX_PUBLISHED_CONTROLS) {
		return null;
	}
	const controls: PublishedControl[] = [];
	const seen = new Set<string>();
	for (const candidate of value) {
		const control = parsePublishedControl(candidate);
		if (!control || seen.has(control.id)) return null;
		seen.add(control.id);
		controls.push(control);
	}
	return controls;
};

/**
 * Whether one authored value is admissible for a declared control. The range is
 * enforced only where the author actually declared it: Blender fabricates a
 * plus/minus FLT_MAX bound for undeclared custom properties, and rejecting
 * against a fabricated bound would turn an API artefact into a document law.
 */
export const isProductionControlValueInRange = (
	control: PublishedControl,
	value: number,
): boolean => {
	if (!isFiniteNumber(value)) return false;
	if (!control.rangeDeclared) return true;
	if (isFiniteNumber(control.min) && value < control.min) return false;
	if (isFiniteNumber(control.max) && value > control.max) return false;
	return true;
};

/**
 * Parses authored static values against the controls the same link declares.
 * A value for an unknown control id, a duplicated control id, a non-finite
 * number, or a number outside a DECLARED range rejects the whole link: a
 * half-accepted value set is exactly the state that would let a stale control
 * silently drive a build.
 *
 * The result is sorted by control id and an empty set collapses to `undefined`,
 * so the canonical form (and therefore the build key) does not depend on the
 * order a UI happened to write values in.
 */
const parseProductionControlValues = (
	value: unknown,
	controls: readonly PublishedControl[],
): readonly ProductionControlValue[] | null | undefined => {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.length > MAX_PUBLISHED_CONTROLS) {
		return null;
	}
	const controlById = new Map(controls.map((control) => [control.id, control]));
	const parsed: ProductionControlValue[] = [];
	const seen = new Set<string>();
	for (const candidate of value) {
		if (!isRecord(candidate)) return null;
		const controlId = normalizedString(candidate.controlId, MAX_NAME_LENGTH);
		if (!controlId || seen.has(controlId)) return null;
		const control = controlById.get(controlId);
		if (!control) return null;
		if (!isFiniteNumber(candidate.value)) return null;
		if (!isProductionControlValueInRange(control, candidate.value)) return null;
		seen.add(controlId);
		parsed.push({ controlId, value: candidate.value });
	}
	if (parsed.length === 0) return undefined;
	// Code-unit order, not locale order: this array feeds a build-key digest that
	// the browser and the Bun companion must derive identically.
	parsed.sort((left, right) =>
		left.controlId === right.controlId
			? 0
			: left.controlId < right.controlId
				? -1
				: 1,
	);
	return parsed;
};

const parseSource = (value: unknown): ExternalProductionSource | null => {
	if (!isRecord(value)) return null;
	const displayName = parseSourceDisplayName(value.displayName);
	if (!displayName) return null;
	const sourceDigest = parseSourceDigest(value.sourceDigest);
	if (value.sourceDigest !== undefined && !sourceDigest) return null;
	const sceneSelector = normalizedSafeName(value.sceneSelector);
	if (value.sceneSelector !== undefined && !sceneSelector) return null;
	return {
		displayName,
		...(sourceDigest ? { sourceDigest } : {}),
		...(sceneSelector ? { sceneSelector } : {}),
	};
};

const parseFrameContract = (
	value: unknown,
): ExternalProductionFrameContract | null => {
	if (!isRecord(value)) return null;
	if (!isPositiveFinite(value.fps)) return null;
	if (!isPositiveInteger(value.durationFrames)) return null;
	// Blender timelines may legitimately start at or below zero.
	if (!isSafeInteger(value.blenderFrameStart)) return null;
	return {
		fps: value.fps,
		durationFrames: value.durationFrames,
		blenderFrameStart: value.blenderFrameStart,
	};
};

const parseAperture = (
	value: unknown,
): ExternalProductionCameraContract["aperture"] | null => {
	if (!isRecord(value) || !isPositiveFinite(value.fStop)) return null;
	return { fStop: value.fStop };
};

const parseCameraContract = (
	value: unknown,
): ExternalProductionCameraContract | null => {
	if (!isRecord(value)) return null;
	if (value.mode !== "vecmo-shot-camera") return null;
	if (value.sensorFit !== "VERTICAL") return null;
	const sceneCameraRigId = normalizedSafeName(value.sceneCameraRigId);
	if (!sceneCameraRigId) return null;
	if (
		!isPositiveFinite(value.verticalFovRadians) ||
		value.verticalFovRadians >= MAX_VERTICAL_FOV_RADIANS
	) {
		return null;
	}
	if (!isPositiveFinite(value.sceneUnitsPerPixel)) return null;
	const aperture =
		value.aperture === undefined ? undefined : parseAperture(value.aperture);
	if (value.aperture !== undefined && !aperture) return null;
	return {
		mode: "vecmo-shot-camera",
		sceneCameraRigId,
		verticalFovRadians: value.verticalFovRadians,
		sceneUnitsPerPixel: value.sceneUnitsPerPixel,
		sensorFit: "VERTICAL",
		...(aperture ? { aperture } : {}),
	};
};

const parseOutputProfile = (
	value: unknown,
): ExternalProductionOutputProfile | null => {
	switch (value) {
		case "interactive-glb":
		case "rendered-rgba-sequence":
			return value;
		default:
			return null;
	}
};

/**
 * Durable-document gate for a linked production. It returns a canonical link or
 * `null`; there is no partial acceptance, because a half-trusted contract is
 * exactly the state that lets a forged binding descriptor reach an adapter.
 */
export function parseExternalProductionLink(
	value: unknown,
): ExternalProductionLink | null {
	if (!isRecord(value)) return null;
	if (value.contractVersion !== EXTERNAL_PRODUCTION_LINK_CONTRACT_VERSION) {
		return null;
	}
	if (value.adapter !== "blender") return null;
	const linkId = normalizedSafeName(value.linkId);
	if (!linkId) return null;
	const source = parseSource(value.source);
	if (!source) return null;
	const frame = parseFrameContract(value.frame);
	if (!frame) return null;
	const camera = parseCameraContract(value.camera);
	if (!camera) return null;
	const outputProfile = parseOutputProfile(value.outputProfile);
	if (!outputProfile) return null;
	const controls = parsePublishedControls(value.controls);
	if (!controls) return null;
	const values = parseProductionControlValues(value.values, controls);
	if (values === null) return null;
	return {
		contractVersion: EXTERNAL_PRODUCTION_LINK_CONTRACT_VERSION,
		adapter: "blender",
		linkId,
		source,
		frame,
		camera,
		outputProfile,
		controls,
		...(values ? { values } : {}),
	};
}

/** Authored static value for one control, or the declared default when unset. */
export const productionControlStaticValue = (
	link: ExternalProductionLink,
	controlId: string,
): number | undefined => {
	const control = link.controls.find((candidate) => candidate.id === controlId);
	if (!control) return undefined;
	const authored = link.values?.find(
		(candidate) => candidate.controlId === controlId,
	);
	return authored ? authored.value : control.defaultValue;
};

/**
 * Read-time gate for consumers that act on a link's contents. The command bus
 * normalizes every write, but `isSceneDocument` only shallow-checks `assets`,
 * so a cloud restore or portable backup can seat an unvalidated object on an
 * asset without passing through a command. Anything that resolves a binding
 * descriptor, launches an adapter, or derives a build key must re-parse here
 * rather than trust the declared type.
 *
 * Reading a single discriminant — such as comparing `outputProfile` to decide
 * a fail-closed fidelity issue — does not need this and should not pay for it
 * inside a per-frame render path.
 */
export const resolveExternalProductionLink = (
	asset: { readonly production?: unknown } | null | undefined,
): ExternalProductionLink | null =>
	asset ? parseExternalProductionLink(asset.production) : null;
