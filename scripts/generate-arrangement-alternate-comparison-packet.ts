import { mkdir, writeFile } from "node:fs/promises";
import { createArrangementAlternateCandidateFixture } from "@/entities/motion-grammar/model/arrangement-alternate-candidate-fixture";
import { buildArrangementComparisonPacket } from "@/entities/motion-grammar/model/arrangement-comparison-packet";
import {
	parseMotionGrammarLayer,
	serializeMotionGrammarLayer,
} from "@/entities/motion-grammar/model/parse";

const outputPath =
	process.argv[2] ??
	"artifacts/arrangement-alternate-comparison-packet-20260716.json";
const fixture = createArrangementAlternateCandidateFixture();
const packet = buildArrangementComparisonPacket({
	source: fixture.source,
	scene: fixture.scene,
	motion: fixture.motion,
	bindings: fixture.bindings,
	binding: fixture.binding,
	sourceSnapshotId: fixture.source.sourceSnapshot.id,
	destinationSnapshotId: fixture.source.destinationSnapshot.id,
	artboardId: fixture.scene.artboard.id,
});

const maxPositionResidual =
	packet.status === "ready"
		? Math.max(
				0,
				...packet.frames.flatMap((frame) => {
					const referenceById = new Map(
						frame.reference.targets.map((target) => [
							target.sourceNodeId,
							target.position,
						]),
					);
					return frame.candidatePoses.map((pose) => {
						const reference = referenceById.get(pose.nodeId);
						return reference
							? Math.hypot(
									pose.position.x - reference.x,
									pose.position.y - reference.y,
								)
							: Number.POSITIVE_INFINITY;
					});
				}),
			)
		: null;
const artifact =
	packet.status === "ready"
		? {
				...packet,
				fixture: {
					memberCount: fixture.binding.targetIds.length,
					sourceSnapshotId: fixture.source.sourceSnapshot.id,
					destinationSnapshotId: fixture.source.destinationSnapshot.id,
				},
				summary: {
					maxPositionResidual,
					criticalFrameCount: packet.frames.length,
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
		JSON.stringify(parsedBinding?.arrangementMapping) ===
			JSON.stringify(fixture.binding.arrangementMapping)
			? "ready"
			: "blocked",
	storageLayer: "motion-grammar",
	issueCodes: parsedLayer.issues.map((issue) => issue.code),
	arrangementMappingRoundTrip:
		JSON.stringify(parsedBinding?.arrangementMapping) ===
		JSON.stringify(fixture.binding.arrangementMapping),
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
console.log(`maxPositionResidual=${maxPositionResidual}`);
console.log(`persistence=${persistencePacket.status}`);
