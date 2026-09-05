#!/usr/bin/env bun

import { createHash } from "node:crypto";
import {
	chmod,
	mkdir,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type SessionManifest = {
	readonly name: string;
	readonly pid: number;
	readonly cwd: string;
	readonly branch: string;
	readonly mode: "local" | "production-cloud";
	readonly devPort: number;
	readonly inspectorPort: number;
	readonly discoveryPath: string;
	readonly startedAt: string;
};

const sessionDirectory = path.join(
	os.tmpdir(),
	"vector-motion-author",
	"dev-sessions",
);

const safeName = (value: string): string => {
	const name = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
	if (!name) throw new Error("Session name is required.");
	return name;
};

const manifestPath = (name: string): string =>
	path.join(sessionDirectory, `${safeName(name)}.json`);

const isSessionManifest = (value: unknown): value is SessionManifest => {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Readonly<Record<string, unknown>>;
	return (
		typeof candidate.name === "string" &&
		typeof candidate.pid === "number" &&
		Number.isInteger(candidate.pid) &&
		typeof candidate.cwd === "string" &&
		typeof candidate.branch === "string" &&
		(candidate.mode === "local" || candidate.mode === "production-cloud") &&
		typeof candidate.devPort === "number" &&
		Number.isInteger(candidate.devPort) &&
		typeof candidate.inspectorPort === "number" &&
		Number.isInteger(candidate.inspectorPort) &&
		typeof candidate.discoveryPath === "string" &&
		typeof candidate.startedAt === "string"
	);
};

const readManifest = async (file: string): Promise<SessionManifest | null> => {
	try {
		const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
		return isSessionManifest(parsed) ? parsed : null;
	} catch {
		return null;
	}
};

const processAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

const listSessions = async (): Promise<void> => {
	await mkdir(sessionDirectory, { recursive: true, mode: 0o700 });
	const files = (await readdir(sessionDirectory)).filter((file) =>
		file.endsWith(".json"),
	);
	const sessions = (
		await Promise.all(
			files.map((file) => readManifest(path.join(sessionDirectory, file))),
		)
	).filter((entry): entry is SessionManifest => entry !== null);
	process.stdout.write(
		`${JSON.stringify(
			sessions.map(({ discoveryPath: _secretPath, ...session }) => ({
				...session,
				status: processAlive(session.pid) ? "running" : "stale",
				url: `http://localhost:${session.devPort}/editor`,
			})),
			null,
			2,
		)}\n`,
	);
};

const stopSession = async (name: string): Promise<void> => {
	const file = manifestPath(name);
	const manifest = await readManifest(file);
	if (!manifest) throw new Error(`Session "${name}" was not found.`);
	if (processAlive(manifest.pid)) process.kill(manifest.pid, "SIGTERM");
	await rm(file, { force: true });
};

const execInSession = async (
	name: string,
	command: readonly string[],
): Promise<void> => {
	const manifest = await readManifest(manifestPath(name));
	if (!manifest || !processAlive(manifest.pid)) {
		throw new Error(`Session "${name}" is not running.`);
	}
	if (command.length === 0) {
		throw new Error("Session exec requires a command after --.");
	}
	const child = Bun.spawn(command, {
		cwd: manifest.cwd,
		env: {
			...process.env,
			VMA_AGENT_BRIDGE_DISCOVERY_PATH: manifest.discoveryPath,
		},
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	process.exitCode = await child.exited;
};

const hashOffset = (value: string): number =>
	Number.parseInt(
		createHash("sha256").update(value).digest("hex").slice(0, 6),
		16,
	) % 1200;

const currentBranch = (): string => {
	const result = Bun.spawnSync(["git", "branch", "--show-current"], {
		cwd: process.cwd(),
	});
	return result.exitCode === 0
		? result.stdout.toString().trim() || "detached"
		: "unknown";
};

const startSession = async (
	nameValue: string,
	mode: SessionManifest["mode"],
): Promise<void> => {
	const name = safeName(nameValue);
	await mkdir(sessionDirectory, { recursive: true, mode: 0o700 });
	const file = manifestPath(name);
	const existing = await readManifest(file);
	if (existing && processAlive(existing.pid)) {
		throw new Error(`Session "${name}" is already running.`);
	}
	let offset = hashOffset(`${process.cwd()}:${name}`);
	const manifests = (
		await Promise.all(
			(
				await readdir(sessionDirectory)
			)
				.filter((entry) => entry.endsWith(".json"))
				.map((entry) => readManifest(path.join(sessionDirectory, entry))),
		)
	).filter(
		(entry): entry is SessionManifest =>
			entry !== null && processAlive(entry.pid),
	);
	while (
		manifests.some(
			(entry) =>
				entry.devPort === 5400 + offset ||
				entry.inspectorPort === 9600 + offset,
		)
	) {
		offset = (offset + 1) % 1200;
	}
	const devPort = 5400 + offset;
	const inspectorPort = 9600 + offset;
	const discoveryPath = path.join(sessionDirectory, `${name}.bridge.json`);
	const env = {
		...process.env,
		VMA_DEV_INSTANCE: name,
		VMA_DEV_PORT: String(devPort),
		VMA_INSPECTOR_PORT: String(inspectorPort),
		VMA_AGENT_BRIDGE_DISCOVERY_PATH: discoveryPath,
	};
	const relay = Bun.spawn(["bun", "scripts/agent-bridge-relay.ts"], {
		cwd: process.cwd(),
		env,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	const manifest: SessionManifest = {
		name,
		pid: process.pid,
		cwd: process.cwd(),
		branch: currentBranch(),
		mode,
		devPort,
		inspectorPort,
		discoveryPath,
		startedAt: new Date().toISOString(),
	};
	await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, {
		mode: 0o600,
	});
	await chmod(file, 0o600);
	const dev = Bun.spawn(
		mode === "production-cloud"
			? ["bun", "scripts/dev-production-cloud.ts"]
			: ["bun", "run", "dev"],
		{
			cwd: process.cwd(),
			env,
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		},
	);
	let shuttingDown = false;
	const shutdown = async (): Promise<void> => {
		if (shuttingDown) return;
		shuttingDown = true;
		relay.kill();
		dev.kill();
		await Promise.all([
			rm(file, { force: true }),
			rm(discoveryPath, { force: true }),
		]);
	};
	process.on("SIGINT", () => void shutdown());
	process.on("SIGTERM", () => void shutdown());
	process.stdout.write(
		`Session ${name}: http://localhost:${devPort}/editor (${mode})\n`,
	);
	await Promise.race([dev.exited, relay.exited]);
	await shutdown();
};

const [command = "list", name, ...flags] = process.argv.slice(2);
if (command === "list") {
	await listSessions();
} else if (command === "stop") {
	if (!name) throw new Error("Usage: bun run session -- stop <name>");
	await stopSession(name);
} else if (command === "start") {
	if (!name) throw new Error("Usage: bun run session -- start <name>");
	await startSession(
		name,
		flags.includes("--production-cloud") ? "production-cloud" : "local",
	);
} else if (command === "exec") {
	if (!name)
		throw new Error("Usage: bun run session -- exec <name> -- <command>");
	await execInSession(name, flags[0] === "--" ? flags.slice(1) : flags);
} else {
	throw new Error(
		"Usage: bun run session -- start <name> | list | stop <name> | exec <name> -- <command>",
	);
}
