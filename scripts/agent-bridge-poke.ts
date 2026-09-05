#!/usr/bin/env bun

import type { AgentCommandPlanRequest } from "../src/entities/agent/model/types";
import { forwardLivePlan } from "./agent-bridge-forward";

/**
 * Manual driver for the live bridge: connects as an agent through the discovery
 * file and forwards an append-rectangle plan to the open editor, exercising the
 * exact path the MCP `apply_edit_plan_live` tool uses. Pass `--validate` for a
 * non-mutating review. Use it to hand-verify the browser round trip: run the
 * relay + dev server, open the editor, run this, approve in the banner.
 */
const op = process.argv.includes("--validate") ? "validate" : "apply";

const pokePlan: AgentCommandPlanRequest = {
	planId: "poke-append-rect",
	intent: "Append a poke-test rectangle to the default layer.",
	sceneCommands: [
		{
			type: "scene/append-node",
			node: {
				name: "Poke Rect",
				style: { fill: "#2ec4b6" },
				geometry: {
					kind: "rect",
					bounds: { x: 80, y: 80, width: 160, height: 110 },
					cornerRadius: 8,
				},
			},
		},
	],
	includeValidation: false,
};

process.stdout.write(`poking live editor (${op})…\n`);
const outcome = await forwardLivePlan(op, pokePlan);
if (!outcome.ok) {
	process.stderr.write(`bridge error [${outcome.code}]: ${outcome.error}\n`);
	process.exit(1);
}

const result = outcome.result;
process.stdout.write(
	`result: applied=${result.applied} changed=${result.changed} ` +
		`approved=${result.approved} ready=${result.ready}\n`,
);
if (result.blockedReason) {
	process.stdout.write(`blocked: ${result.blockedReason}\n`);
}
const affected =
	result.affected.map((target) => target.id ?? target.kind).join(", ") ||
	"(none)";
process.stdout.write(`affected: ${affected}\n`);

const targetLabel = (target: { id?: string; kind: string }): string =>
	target.id ?? target.kind;

for (const step of result.plan.steps) {
	const stepAffected = step.affected.map(targetLabel).join(", ") || "(none)";
	process.stdout.write(`step ${step.id} [${step.status}]: ${stepAffected}\n`);
}

// Index-aligned with the request's command array for that store: one
// committed target per successfully compiled command, in request order.
for (const applied of result.appliedCommands) {
	const appliedAffected =
		applied.affected.map(targetLabel).join(", ") || "(none)";
	process.stdout.write(
		`applied ${applied.store} (${applied.commandCount} cmds): ${appliedAffected}\n`,
	);
}

process.exit(0);
