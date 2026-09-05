/** Compiles real TypeScript consumers against generated SVG and WebGL declarations. */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntimeTypesAsset } from "../src/features/export/model/runtime-player-declarations";

const directory = mkdtempSync(join(tmpdir(), "vecmo-runtime-types-"));

const compile = (name: string, declaration: string, consumer: string): void => {
	const moduleDirectory = join(directory, name);
	mkdirSync(moduleDirectory, { recursive: true });
	writeFileSync(join(moduleDirectory, "runtime.d.ts"), declaration);
	writeFileSync(join(moduleDirectory, "consumer.ts"), consumer);
	writeFileSync(
		join(moduleDirectory, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				strict: true,
				noEmit: true,
				target: "ES2022",
				module: "ESNext",
				moduleResolution: "Bundler",
				lib: ["ES2022", "DOM"],
			},
			files: ["consumer.ts"],
		}),
	);
	execFileSync(
		join(process.cwd(), "node_modules/.bin/tsc"),
		["-p", join(moduleDirectory, "tsconfig.json")],
		{ stdio: "pipe" },
	);
};

try {
	const svg = createRuntimeTypesAsset({
		runtimeFileName: "runtime.js",
		renderer: "svg",
		shared: false,
		embedded: true,
	});
	compile(
		"svg",
		svg.contents,
		`import { mount, mountVectorMotion, paletteManifest, type FrameSampleEvent, type RuntimeCameraState } from "./runtime.js";
declare const container: HTMLElement;
const player = await mountVectorMotion(container, { source: { kind: "embedded" }, onFrameSampled(event: FrameSampleEvent) { void event.camera; } });
const camera: RuntimeCameraState = player.getCameraState(); void camera;
await player.seekFrame(4.5); player.destroy();
void paletteManifest.color1;
const handle = mount(container, { reducedMotion: true, palette: { night: "#111" }, densityCenter: { x: 0.5, y: 0.5 } });
handle.play(); handle.pause(); handle.seek(0.5);
await handle.ready; handle.destroy();`,
	);

	const webgl = createRuntimeTypesAsset({
		runtimeFileName: "runtime.js",
		renderer: "webgl",
		shared: true,
		embedded: false,
	});
	compile(
		"webgl",
		webgl.contents,
		`import { mount, mountVectorMotion, type VectorMotionPlayer, type VectorMotionRuntimePayload } from "./runtime.js";
declare const container: HTMLElement;
declare const payload: VectorMotionRuntimePayload;
const player: VectorMotionPlayer = await mountVectorMotion(container, { source: { kind: "url", url: "./scene.json" } });
player.progress = 0.5; await player.setActiveCameraOverride(null); player.dispose();
const handle = mount(container, payload, { dpr: 2, autoplay: false });
handle.play(); handle.pause(); handle.seek(1);
await handle.ready; handle.destroy();`,
	);
	console.log("Runtime-player declaration consumer check passed.");
} finally {
	rmSync(directory, { recursive: true, force: true });
}
