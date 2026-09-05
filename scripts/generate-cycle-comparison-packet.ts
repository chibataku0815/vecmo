import { mkdir, writeFile } from "node:fs/promises";
import { createCycleCandidateFixture } from "@/entities/motion-grammar/model/cycle-candidate-fixture";
import { buildCycleComparisonPacket } from "@/entities/motion-grammar/model/cycle-comparison-packet";
import {
	parseMotionGrammarLayer,
	serializeMotionGrammarLayer,
} from "@/entities/motion-grammar/model/parse";

const outputPath =
	process.argv[2] ?? "artifacts/cycle-comparison-packet-20260716.json";
const fixture = createCycleCandidateFixture();
const packet = buildCycleComparisonPacket({
	source: fixture.source,
	scene: fixture.scene,
	motion: fixture.motion,
	bindings: fixture.bindings,
	binding: fixture.binding,
	pathNodeId: fixture.pathNodeId,
	artboardId: fixture.scene.artboard.id,
});

const positionResidual =
	packet.status === "ready"
		? Math.max(
				0,
				...packet.frames.flatMap((frame) => {
					const referenceById = new Map([
						[fixture.binding.targetIds[0], frame.reference.head.point],
						[fixture.binding.targetIds[1], frame.reference.headDot.point],
					]);
					return frame.candidatePoses.flatMap((pose) => {
						const reference = referenceById.get(pose.nodeId);
						return reference
							? [
									Math.hypot(
										pose.position.x - reference.x,
										pose.position.y - reference.y,
									),
								]
							: [];
					});
				}),
			)
		: null;
const artifact =
	packet.status === "ready"
		? {
				...packet,
				fixture: {
					pathNodeId: fixture.pathNodeId,
					bodyNodeId: fixture.binding.targetIds[0],
					headDotNodeId: fixture.binding.targetIds[1],
					pathLength: fixture.source.pathLength,
				},
				summary: {
					positionResidual,
					criticalFrameCount: packet.frames.length,
					bake: "unsupported",
				},
			}
		: packet;

await mkdir(outputPath.slice(0, outputPath.lastIndexOf("/")) || ".", {
	recursive: true,
});
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

const serializedLayer = serializeMotionGrammarLayer(fixture.bindings);
const parsedLayer = parseMotionGrammarLayer(serializedLayer);
const parsedBinding = parsedLayer.bindings[0];
const persistencePacket = {
	status:
		parsedLayer.issues.length === 0 &&
		JSON.stringify(parsedBinding?.roleMap) ===
			JSON.stringify(fixture.binding.roleMap)
			? "ready"
			: "blocked",
	storageLayer: "motion-grammar",
	issueCodes: parsedLayer.issues.map((issue) => issue.code),
	roleMapRoundTrip:
		JSON.stringify(parsedBinding?.roleMap) ===
		JSON.stringify(fixture.binding.roleMap),
	serializedBindingId: serializedLayer.bindings[0]?.id ?? null,
};
const persistencePath = outputPath.replace(/\.json$/u, "-persistence.json");
await writeFile(
	persistencePath,
	`${JSON.stringify(persistencePacket, null, 2)}\n`,
	"utf8",
);
console.log(`Wrote ${outputPath}`);
console.log(`Wrote ${persistencePath}`);
console.log(`status=${packet.status}`);
console.log(`positionResidual=${positionResidual}`);
console.log(`persistence=${persistencePacket.status}`);
