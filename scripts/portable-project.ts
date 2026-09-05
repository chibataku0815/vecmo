import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MotionDocument } from "../src/entities/motion/model/types";
import type { MotionGrammarStoreDocument } from "../src/entities/motion-grammar/model/command";
import type { SceneDocument } from "../src/entities/scene/model/types";
import {
	projectBackupFileName,
	serializeProjectBackup,
} from "../src/features/project-backup/model/project-backup";

export type PortableProjectArtifact = {
	readonly fileName: string;
	readonly contents: string;
	readonly byteLength: number;
};

/** Canonical portable envelope shared by artifact generators and Agent scripts. */
export function createPortableProjectArtifact(input: {
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly grammar?: MotionGrammarStoreDocument;
	readonly savedAt?: string;
	readonly fileName?: string;
}): PortableProjectArtifact {
	const contents = serializeProjectBackup(input.scene, input.motion, {
		...(input.grammar ? { grammar: input.grammar } : {}),
		...(input.savedAt ? { savedAt: input.savedAt } : {}),
	});
	return {
		fileName: input.fileName ?? projectBackupFileName(input.scene.name),
		contents,
		byteLength: new TextEncoder().encode(contents).byteLength,
	};
}

/** Writes one canonical `.vecmo-backup.json` without producing diagnostic side files. */
export async function writePortableProjectArtifact(input: {
	readonly outputDirectory: string;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly grammar?: MotionGrammarStoreDocument;
	readonly savedAt?: string;
	readonly fileName?: string;
}): Promise<PortableProjectArtifact & { readonly absolutePath: string }> {
	const artifact = createPortableProjectArtifact(input);
	const outputDirectory = path.resolve(input.outputDirectory);
	await mkdir(outputDirectory, { recursive: true });
	const absolutePath = path.join(outputDirectory, artifact.fileName);
	await writeFile(absolutePath, artifact.contents, "utf8");
	return { ...artifact, absolutePath };
}
