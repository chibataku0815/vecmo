import { mkdir, writeFile } from "node:fs/promises";
import {
	parseMotionGrammarLayer,
	serializeMotionGrammarLayer,
} from "@/entities/motion-grammar/model/parse";
import { createRandomPulseCandidateFixture } from "@/entities/motion-grammar/model/random-pulse-candidate-fixture";
import { buildRandomPulseComparisonPacket } from "@/entities/motion-grammar/model/random-pulse-comparison-packet";

const outputPath =
	process.argv[2] ??
	"artifacts/random-pulse-candidate-comparison-packet-20260716.json";
const fixture = createRandomPulseCandidateFixture();
const packet = buildRandomPulseComparisonPacket({
	source: fixture.source,
	scene: fixture.scene,
	motion: fixture.motion,
	bindings: fixture.bindings,
	binding: fixture.binding,
	roleMappings: fixture.roleMappings,
	artboardId: fixture.scene.artboard.id,
});

await mkdir(outputPath.slice(0, outputPath.lastIndexOf("/")) || ".", {
	recursive: true,
});
await writeFile(
	`${outputPath}`,
	`${JSON.stringify(packet, null, 2)}\n`,
	"utf8",
);
const serializedLayer = serializeMotionGrammarLayer(fixture.bindings);
const parsedLayer = parseMotionGrammarLayer(serializedLayer);
const parsedBinding = parsedLayer.bindings[0];
const persistencePacket = {
	status:
		parsedLayer.issues.length === 0 &&
		JSON.stringify(parsedBinding?.randomPulseProfile) ===
			JSON.stringify(fixture.binding.randomPulseProfile)
			? "ready"
			: "blocked",
	storageLayer: "motion-grammar",
	issueCodes: parsedLayer.issues.map((issue) => issue.code),
	profileRoundTrip:
		JSON.stringify(parsedBinding?.randomPulseProfile) ===
		JSON.stringify(fixture.binding.randomPulseProfile),
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
console.log(`persistence=${persistencePacket.status}`);
