import {
	BINDABLE_PROPERTY_DESCRIPTORS,
	type BindablePropertyDescriptor,
	type BindablePropertySupportMatrix,
} from "@/entities/scene/model/bindable-property";

/**
 * One bindable-property entry in the export manifest. It serializes the code-
 * addressable authoring contract — the stable id, its source, whether it is
 * keyframable/expression-bindable/agent-writable, and how each runtime/export
 * surface carries it — without storing any executable code. Effect-sourced
 * entries carry `effectCapabilityId`, pointing back to the effect-capabilities
 * manifest instead of duplicating its usage report.
 */
export type ExportBindablePropertyManifestEntry = {
	readonly id: string;
	readonly label: string;
	readonly sourceKind: BindablePropertyDescriptor["source"]["kind"];
	readonly scenePropertyPath?: string;
	readonly effectCapabilityId?: string;
	readonly duplicateChannel?: string;
	readonly keyframeChannel?: string;
	readonly keyframable: boolean;
	readonly expressionBindable: boolean;
	readonly agentWritable: boolean;
	readonly support: BindablePropertySupportMatrix;
};

/**
 * Deterministic manifest of the bindable-property registry for generated bundle/
 * runtime metadata. Code and runtime consumers read it to learn which properties
 * are addressable by id and how faithfully each surface carries them (native /
 * approximated / side-car-only / capture-only / unsupported), so authored intent
 * is never silently assumed to be fully supported.
 */
export type ExportBindablePropertiesManifest = {
	readonly included: true;
	readonly contractVersion: 1;
	readonly propertyCount: number;
	readonly keyframablePropertyCount: number;
	readonly agentWritablePropertyCount: number;
	readonly effectCapabilityPropertyIds: readonly string[];
	readonly properties: readonly ExportBindablePropertyManifestEntry[];
};

const manifestEntryForDescriptor = (
	descriptor: BindablePropertyDescriptor,
): ExportBindablePropertyManifestEntry => {
	const source = descriptor.source;
	return {
		id: descriptor.id,
		label: descriptor.label,
		sourceKind: source.kind,
		...(source.kind === "scene-property"
			? { scenePropertyPath: source.path }
			: {}),
		...(source.kind === "effect-capability"
			? { effectCapabilityId: source.capabilityId }
			: {}),
		...(source.kind === "duplicate-generator"
			? { duplicateChannel: source.channel }
			: {}),
		...(descriptor.keyframeChannel
			? { keyframeChannel: descriptor.keyframeChannel.property }
			: {}),
		keyframable: descriptor.control.keyframable,
		expressionBindable: descriptor.control.expressionBindable,
		agentWritable: descriptor.control.agentWritable,
		support: descriptor.support,
	};
};

/**
 * Builds the bindable-property manifest from the registry. The output is static
 * and deterministic (the registry does not depend on document content), so every
 * export reports the same code-native authoring contract and fidelity matrix.
 */
export function createExportBindablePropertiesManifest(): ExportBindablePropertiesManifest {
	const properties = BINDABLE_PROPERTY_DESCRIPTORS.map(
		manifestEntryForDescriptor,
	);
	return {
		included: true,
		contractVersion: 1,
		propertyCount: properties.length,
		keyframablePropertyCount: properties.filter(
			(property) => property.keyframable,
		).length,
		agentWritablePropertyCount: properties.filter(
			(property) => property.agentWritable,
		).length,
		effectCapabilityPropertyIds: properties
			.filter((property) => property.sourceKind === "effect-capability")
			.map((property) => property.id),
		properties,
	};
}
