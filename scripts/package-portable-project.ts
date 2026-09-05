#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
	deserializeMotionDocument,
	isMotionDocument,
} from "../src/entities/motion/model/serialization";
import type { MotionDocument } from "../src/entities/motion/model/types";
import {
	deserializeSceneDocument,
	isSceneDocument,
} from "../src/entities/scene/model/serialization";
import type { SceneDocument } from "../src/entities/scene/model/types";
import { writePortableProjectArtifact } from "./portable-project";

const [scenePath, motionPath, outputPath, savedAt] = process.argv.slice(2);
if (!scenePath || !motionPath || !outputPath) {
	throw new Error(
		"Usage: bun scripts/package-portable-project.ts <scene.json> <motion.json> <output.vecmo-backup.json> [savedAt]",
	);
}

const readScene = async (filePath: string): Promise<SceneDocument> => {
	const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
	if (isSceneDocument(parsed)) return parsed;
	if (typeof parsed === "string") {
		const result = deserializeSceneDocument(parsed);
		if (result.status === "ok") return result.document;
	}
	throw new Error(
		`Scene input is not a SceneDocument or scene envelope: ${filePath}`,
	);
};

const readMotion = async (filePath: string): Promise<MotionDocument> => {
	const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
	if (isMotionDocument(parsed)) return parsed;
	if (typeof parsed === "string") {
		const result = deserializeMotionDocument(parsed);
		if (result.status === "ok") return result.document;
	}
	throw new Error(
		`Motion input is not a MotionDocument or motion envelope: ${filePath}`,
	);
};

const absoluteOutputPath = path.resolve(outputPath);
const artifact = await writePortableProjectArtifact({
	outputDirectory: path.dirname(absoluteOutputPath),
	fileName: path.basename(absoluteOutputPath),
	scene: await readScene(path.resolve(scenePath)),
	motion: await readMotion(path.resolve(motionPath)),
	...(savedAt ? { savedAt } : {}),
});

console.log(
	JSON.stringify(
		{
			kind: "vector-motion-author.portable-project-artifact",
			path: artifact.absolutePath,
			fileName: artifact.fileName,
			byteLength: artifact.byteLength,
		},
		null,
		2,
	),
);
