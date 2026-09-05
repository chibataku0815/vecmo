import { mkdir, writeFile } from "node:fs/promises";
import { buildFollowThroughComparisonPacket } from "@/entities/motion-grammar/model/follow-through-comparison-packet";
import { buildFollowThroughLeadAdapterContractPacket } from "@/entities/motion-grammar/model/follow-through-lead-adapter-contract";
import { FOLLOW_THROUGH_CONSTRUCTION_FIXTURE } from "@/entities/motion-grammar/model/follow-through-reference-oracle";
import { INTERFERENCE_CONSTRUCTION_FIXTURE } from "@/entities/motion-grammar/model/interference-candidate-fixture";
import { buildInterferenceComparisonPacket } from "@/entities/motion-grammar/model/interference-comparison-packet";
import { MERGE_SPLIT_CONSTRUCTION_FIXTURE } from "@/entities/motion-grammar/model/merge-split-candidate-fixture";
import { buildMergeSplitComparisonPacket } from "@/entities/motion-grammar/model/merge-split-comparison-packet";
import { buildParallaxComparisonPacket } from "@/entities/motion-grammar/model/parallax-comparison-packet";
import { PARALLAX_CONSTRUCTION_FIXTURE } from "@/entities/motion-grammar/model/parallax-reference-oracle";
import { buildSymmetryComparisonPacket } from "@/entities/motion-grammar/model/symmetry-comparison-packet";
import { SYMMETRY_CONSTRUCTION_FIXTURE } from "@/entities/motion-grammar/model/symmetry-reference-oracle";

const outputDirectory = process.argv[2] ?? "artifacts";
const suffix = "candidate-comparison-packet-20260716.json";

const packets = {
	interference: buildInterferenceComparisonPacket(
		INTERFERENCE_CONSTRUCTION_FIXTURE,
	),
	"merge-split": buildMergeSplitComparisonPacket(
		MERGE_SPLIT_CONSTRUCTION_FIXTURE,
	),
	symmetry: buildSymmetryComparisonPacket({
		source: SYMMETRY_CONSTRUCTION_FIXTURE,
	}),
	parallax: buildParallaxComparisonPacket({
		source: PARALLAX_CONSTRUCTION_FIXTURE,
	}),
	"follow-through": buildFollowThroughComparisonPacket({
		source: FOLLOW_THROUGH_CONSTRUCTION_FIXTURE,
	}),
} as const;

const followThroughAdapterContract =
	buildFollowThroughLeadAdapterContractPacket();

await mkdir(outputDirectory, { recursive: true });
for (const [name, packet] of Object.entries(packets)) {
	const outputPath = `${outputDirectory}/${name}-${suffix}`;
	await writeFile(outputPath, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
	console.log(`Wrote ${outputPath}`);
	console.log(`${name}=${packet.status}`);
}

const adapterContractPath = `${outputDirectory}/follow-through-lead-adapter-contract-20260716.json`;
await writeFile(
	adapterContractPath,
	`${JSON.stringify(followThroughAdapterContract, null, 2)}\n`,
	"utf8",
);
console.log(`Wrote ${adapterContractPath}`);
console.log(
	`follow-through-lead-adapter=${followThroughAdapterContract.status}`,
);

if (
	Object.values(packets).some((packet) => packet.status !== "ready") ||
	followThroughAdapterContract.status !== "ready"
) {
	process.exitCode = 1;
}
