#!/usr/bin/env bun

import { writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { objectifyPixelArtRaster } from "../src/features/pixel-object-import/model/objectify";

type CliOptions = {
	readonly input: string;
	readonly output?: string;
	readonly name: string;
	readonly origin: { readonly x: number; readonly y: number };
	readonly pixelSize: number;
	readonly logicalLongEdge: number;
	readonly paletteSize: number;
	readonly artboardId?: string;
};

const option = (name: string): string | undefined => {
	const prefix = `--${name}=`;
	const inline = process.argv.find((value) => value.startsWith(prefix));
	if (inline) return inline.slice(prefix.length);
	const index = process.argv.indexOf(`--${name}`);
	return index >= 0 ? process.argv[index + 1] : undefined;
};

const requiredOption = (name: string): string => {
	const value = option(name)?.trim();
	if (!value) throw new Error(`Missing --${name}.`);
	return value;
};

const boundedIntegerOption = (
	name: string,
	fallback: number,
	minimum: number,
	maximum: number,
): number => {
	const raw = option(name);
	if (raw === undefined) return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < minimum || value > maximum) {
		throw new Error(
			`--${name} must be an integer from ${minimum} through ${maximum}.`,
		);
	}
	return value;
};

const originOption = (): CliOptions["origin"] => {
	const raw = option("origin") ?? "0,0";
	const [x, y, extra] = raw.split(",").map(Number);
	if (extra !== undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
		throw new Error(
			"--origin must be two finite numbers separated by a comma.",
		);
	}
	return { x: x ?? 0, y: y ?? 0 };
};

const parseOptions = (): CliOptions => {
	const input = requiredOption("input");
	const output = option("out")?.trim();
	const artboardId = option("artboard")?.trim();
	const requestedName =
		option("name")?.trim() ||
		`${path.basename(input, path.extname(input))} pixel objects`;
	if (requestedName.length > 160) {
		throw new Error("--name must be 160 characters or fewer.");
	}
	return {
		input,
		...(output ? { output } : {}),
		name: requestedName,
		origin: originOption(),
		pixelSize: boundedIntegerOption("pixel-size", 8, 1, 32),
		logicalLongEdge: boundedIntegerOption("long-edge", 64, 16, 128),
		paletteSize: boundedIntegerOption("palette", 16, 2, 32),
		...(artboardId ? { artboardId } : {}),
	};
};

const main = async (): Promise<void> => {
	const options = parseOptions();
	const decoded = await sharp(options.input)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const rasterData = new Uint8ClampedArray(decoded.data.length);
	rasterData.set(decoded.data);
	const result = objectifyPixelArtRaster(
		{
			width: decoded.info.width,
			height: decoded.info.height,
			data: rasterData,
		},
		{
			sourceName: options.name,
			origin: options.origin,
			pixelSize: options.pixelSize,
			logicalLongEdge: options.logicalLongEdge,
			paletteSize: options.paletteSize,
			...(options.artboardId ? { artboardId: options.artboardId } : {}),
		},
	);
	if (!result.ok) throw new Error(`${result.code}: ${result.message}`);

	const plan = {
		intent:
			"Insert a generated pixel-art candidate as compact native editable objects.",
		sceneCommands: [
			{
				type: "scene/append-pixel-art-objects",
				pixelArt: result.indexedSource,
			},
		],
	};
	const json = `${JSON.stringify(plan, null, 2)}\n`;
	if (options.output) {
		await writeFile(options.output, json, "utf8");
	} else {
		process.stdout.write(json);
	}
	process.stderr.write(`${JSON.stringify(result.diagnostics)}\n`);
};

await main();
