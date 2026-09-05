import { chmod, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Discovery handshake for the local agent ⇄ editor bridge. The relay binds an
 * ephemeral loopback port (so concurrent worktrees never collide) and records
 * the chosen port + token here. The MCP server / poke CLI read this file to find
 * the relay; the Vite dev middleware reads it to tell the browser which port to
 * dial. The file is gitignored and cleared on relay shutdown.
 */
export type BridgeDiscovery = {
	readonly port: number;
	readonly token: string;
	readonly pid: number;
	readonly protocol: number;
	readonly startedAt: string;
};

const DISCOVERY_FILENAME = ".vma-agent-bridge";

export const bridgeDiscoveryPath = (): string =>
	process.env.VMA_AGENT_BRIDGE_DISCOVERY_PATH
		? path.resolve(process.env.VMA_AGENT_BRIDGE_DISCOVERY_PATH)
		: path.resolve(process.cwd(), DISCOVERY_FILENAME);

export const writeBridgeDiscovery = async (
	info: BridgeDiscovery,
): Promise<void> => {
	await writeFile(bridgeDiscoveryPath(), `${JSON.stringify(info, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	await chmod(bridgeDiscoveryPath(), 0o600);
};

export const readBridgeDiscovery =
	async (): Promise<BridgeDiscovery | null> => {
		try {
			const raw = await readFile(bridgeDiscoveryPath(), "utf8");
			const value = JSON.parse(raw) as Partial<BridgeDiscovery>;
			if (typeof value.port !== "number" || typeof value.token !== "string") {
				return null;
			}
			return {
				port: value.port,
				token: value.token,
				pid: typeof value.pid === "number" ? value.pid : 0,
				protocol: typeof value.protocol === "number" ? value.protocol : 0,
				startedAt: typeof value.startedAt === "string" ? value.startedAt : "",
			};
		} catch {
			return null;
		}
	};

export const clearBridgeDiscovery = async (): Promise<void> => {
	try {
		await unlink(bridgeDiscoveryPath());
	} catch {
		// The discovery file is already absent; nothing to clear.
	}
};
