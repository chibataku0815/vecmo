import { mkdir, writeFile } from "node:fs/promises";
import { createCountGrowthCandidateFixture } from "@/entities/motion-grammar/model/count-growth-candidate-fixture";
import { buildCountGrowthComparisonPacket } from "@/entities/motion-grammar/model/count-growth-comparison-packet";
import {
	parseMotionGrammarLayer,
	serializeMotionGrammarLayer,
} from "@/entities/motion-grammar/model/parse";

const sameNumberRecord = (
	left: Readonly<Record<string, number>> | undefined,
	right: Readonly<Record<string, number>> | undefined,
): boolean => {
	if (!left || !right) return left === right;
	const leftKeys = Object.keys(left).sort();
	const rightKeys = Object.keys(right).sort();
	return (
		leftKeys.length === rightKeys.length &&
		leftKeys.every(
			(key, index) => key === rightKeys[index] && left[key] === right[key],
		)
	);
};

const outputPath =
	process.argv[2] ??
	"artifacts/count-growth-candidate-comparison-packet-20260716.json";
const fixture = createCountGrowthCandidateFixture();
const packet = buildCountGrowthComparisonPacket({
	source: fixture.source,
	scene: fixture.scene,
	motion: fixture.motion,
	bindings: fixture.bindings,
	binding: fixture.binding,
	artboardId: fixture.scene.artboard.id,
});

await mkdir(outputPath.slice(0, outputPath.lastIndexOf("/")) || ".", {
	recursive: true,
});
await writeFile(outputPath, `${JSON.stringify(packet, null, 2)}\n`, "utf8");

const serializedLayer = serializeMotionGrammarLayer(fixture.bindings);
const parsedLayer = parseMotionGrammarLayer(serializedLayer);
const parsedBinding = parsedLayer.bindings[0];
const roleMapRoundTrip =
	JSON.stringify(parsedBinding?.roleMap) ===
	JSON.stringify(fixture.binding.roleMap);
const parameterRoundTrip = sameNumberRecord(
	parsedBinding?.parameters,
	fixture.binding.parameters,
);
const persistencePacket = {
	status:
		parsedLayer.issues.length === 0 && roleMapRoundTrip && parameterRoundTrip
			? "ready"
			: "blocked",
	storageLayer: "motion-grammar",
	issueCodes: parsedLayer.issues.map((issue) => issue.code),
	roleMapRoundTrip,
	parameterRoundTrip,
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
