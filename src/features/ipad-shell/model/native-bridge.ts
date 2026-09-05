export type NativeHostReadyMessage = {
	readonly kind: "native-host-ready";
	readonly editorURL: string;
	readonly webGPUProbeRequired: boolean;
};

export type NativeWebCapabilityProbeMessage = {
	readonly kind: "native-web-capability-probe";
	readonly version: number;
	readonly hasPointerEvent: boolean;
	readonly hasWebGPU: boolean;
	readonly userAgent: string;
};

export type NativeProjectBackupOpenedMessage = {
	readonly kind: "native-project-backup-opened";
	readonly fileName: string;
	readonly contents: string;
};

export type NativeProjectBackupOpenFailedMessage = {
	readonly kind: "native-project-backup-open-failed";
	readonly reason: string;
};

export type NativeProjectBackupOpenCancelledMessage = {
	readonly kind: "native-project-backup-open-cancelled";
};

export type NativeProjectBackupShareReadyMessage = {
	readonly kind: "native-project-backup-share-ready";
	readonly fileName: string;
};

export type NativeProjectBackupShareFailedMessage = {
	readonly kind: "native-project-backup-share-failed";
	readonly reason: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

export function isNativeHostReadyMessage(
	value: unknown,
): value is NativeHostReadyMessage {
	if (!isRecord(value)) return false;
	return (
		value.kind === "native-host-ready" &&
		typeof value.editorURL === "string" &&
		typeof value.webGPUProbeRequired === "boolean"
	);
}

export function isNativeWebCapabilityProbeMessage(
	value: unknown,
): value is NativeWebCapabilityProbeMessage {
	if (!isRecord(value)) return false;
	return (
		value.kind === "native-web-capability-probe" &&
		isFiniteNumber(value.version) &&
		typeof value.hasPointerEvent === "boolean" &&
		typeof value.hasWebGPU === "boolean" &&
		typeof value.userAgent === "string"
	);
}

export function isNativeProjectBackupOpenedMessage(
	value: unknown,
): value is NativeProjectBackupOpenedMessage {
	if (!isRecord(value)) return false;
	return (
		value.kind === "native-project-backup-opened" &&
		typeof value.fileName === "string" &&
		typeof value.contents === "string"
	);
}

export function isNativeProjectBackupOpenFailedMessage(
	value: unknown,
): value is NativeProjectBackupOpenFailedMessage {
	if (!isRecord(value)) return false;
	return (
		value.kind === "native-project-backup-open-failed" &&
		typeof value.reason === "string"
	);
}

export function isNativeProjectBackupOpenCancelledMessage(
	value: unknown,
): value is NativeProjectBackupOpenCancelledMessage {
	if (!isRecord(value)) return false;
	return value.kind === "native-project-backup-open-cancelled";
}

export function isNativeProjectBackupShareReadyMessage(
	value: unknown,
): value is NativeProjectBackupShareReadyMessage {
	if (!isRecord(value)) return false;
	return (
		value.kind === "native-project-backup-share-ready" &&
		typeof value.fileName === "string"
	);
}

export function isNativeProjectBackupShareFailedMessage(
	value: unknown,
): value is NativeProjectBackupShareFailedMessage {
	if (!isRecord(value)) return false;
	return (
		value.kind === "native-project-backup-share-failed" &&
		typeof value.reason === "string"
	);
}
