import { constants } from "node:fs";
import { lstat, open, unlink } from "node:fs/promises";
import path from "node:path";
import { PROGRAM_SURFACE_BRIDGE_PROTOCOL_VERSION } from "../src/entities/scene/model/program-surface-bridge-protocol";

/** Token-free V2 record used only to let a local Vite editor find a companion. */
export type ProgramSurfaceBridgeDiscoveryV2 = {
	readonly protocol: typeof PROGRAM_SURFACE_BRIDGE_PROTOCOL_VERSION;
	readonly bridgeId: string;
	readonly port: number;
	readonly editorOrigin: string;
	readonly startedAt: string;
	readonly pid: number;
};

const DISCOVERY_FILENAME = ".vma-program-surface-bridge";
const MAX_DISCOVERY_BYTES = 8 * 1024;
const discoveryKeys = new Set([
	"protocol",
	"bridgeId",
	"port",
	"editorOrigin",
	"startedAt",
	"pid",
]);

export const programSurfaceBridgeDiscoveryPath = (override?: string): string =>
	override
		? path.resolve(override)
		: process.env.VMA_PROGRAM_SURFACE_BRIDGE_DISCOVERY_PATH
			? path.resolve(process.env.VMA_PROGRAM_SURFACE_BRIDGE_DISCOVERY_PATH)
			: path.resolve(process.cwd(), DISCOVERY_FILENAME);

const isSafeDiscovery = (
	value: unknown,
): value is ProgramSurfaceBridgeDiscoveryV2 => {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		Object.keys(record).length === discoveryKeys.size &&
		Object.keys(record).every((key) => discoveryKeys.has(key)) &&
		record.protocol === PROGRAM_SURFACE_BRIDGE_PROTOCOL_VERSION &&
		typeof record.bridgeId === "string" &&
		record.bridgeId.length > 0 &&
		typeof record.port === "number" &&
		Number.isSafeInteger(record.port) &&
		record.port > 0 &&
		record.port <= 65535 &&
		typeof record.editorOrigin === "string" &&
		record.editorOrigin.length > 0 &&
		typeof record.startedAt === "string" &&
		record.startedAt.length > 0 &&
		typeof record.pid === "number" &&
		Number.isSafeInteger(record.pid) &&
		record.pid > 0
	);
};

const hasPrivateMode = (mode: number): boolean => (mode & 0o077) === 0;

/**
 * Reads a record only when it is a regular owner-private file. A malformed or
 * insecure record behaves as absent so the Vite endpoint never leaks it.
 */
export const readProgramSurfaceBridgeDiscovery = async (
	override?: string,
): Promise<ProgramSurfaceBridgeDiscoveryV2 | null> => {
	let handle: Awaited<ReturnType<typeof open>> | null = null;
	try {
		const location = programSurfaceBridgeDiscoveryPath(override);
		handle = await open(location, constants.O_RDONLY | constants.O_NOFOLLOW);
		const stats = await handle.stat();
		if (
			!stats.isFile() ||
			!hasPrivateMode(stats.mode) ||
			stats.size > MAX_DISCOVERY_BYTES
		) {
			return null;
		}
		const parsed = JSON.parse(await handle.readFile("utf8")) as unknown;
		if (!isSafeDiscovery(parsed)) return null;
		return {
			protocol: parsed.protocol,
			bridgeId: parsed.bridgeId,
			port: parsed.port,
			editorOrigin: parsed.editorOrigin,
			startedAt: parsed.startedAt,
			pid: parsed.pid,
		};
	} catch {
		return null;
	} finally {
		if (handle) {
			try {
				await handle.close();
			} catch {
				// The descriptor is already closed or invalid; treat it as absent.
			}
		}
	}
};

/**
 * Writes a token-free 0600 record without following an existing discovery
 * symlink. The bridge id is later used to avoid deleting another process's
 * record during shutdown.
 */
export const writeProgramSurfaceBridgeDiscovery = async (
	info: ProgramSurfaceBridgeDiscoveryV2,
	override?: string,
): Promise<void> => {
	const location = programSurfaceBridgeDiscoveryPath(override);
	const flags =
		constants.O_WRONLY |
		constants.O_CREAT |
		constants.O_EXCL |
		constants.O_NOFOLLOW;
	const handle = await open(location, flags, 0o600);
	try {
		await handle.chmod(0o600);
		await handle.writeFile(`${JSON.stringify(info)}\n`, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
};

/** Removes only the discovery record written by this exact bridge instance. */
export const clearProgramSurfaceBridgeDiscovery = async (
	bridgeId: string,
	override?: string,
): Promise<void> => {
	const location = programSurfaceBridgeDiscoveryPath(override);
	let handle: Awaited<ReturnType<typeof open>> | null = null;
	try {
		handle = await open(location, constants.O_RDONLY | constants.O_NOFOLLOW);
		const openedStats = await handle.stat();
		if (
			!openedStats.isFile() ||
			!hasPrivateMode(openedStats.mode) ||
			openedStats.size > MAX_DISCOVERY_BYTES
		) {
			return;
		}
		const parsed = JSON.parse(await handle.readFile("utf8")) as unknown;
		if (!isSafeDiscovery(parsed) || parsed.bridgeId !== bridgeId) return;
		const pathStats = await lstat(location);
		if (
			!pathStats.isFile() ||
			pathStats.dev !== openedStats.dev ||
			pathStats.ino !== openedStats.ino
		) {
			return;
		}
		await unlink(location);
	} catch {
		// Another shutdown or a user cleanup won the race; no action is needed.
	} finally {
		if (handle) {
			try {
				await handle.close();
			} catch {
				// The descriptor is already closed or invalid; no action is needed.
			}
		}
	}
};
