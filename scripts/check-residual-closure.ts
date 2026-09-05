import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Guards the residual-closure register. This is intentionally a repository
 * planning sensor, not a product or acceptance state: it makes incomplete
 * evidence and external/user boundaries explicit without treating either as
 * a passing visual verdict.
 */

const REGISTER_PATH = "docs/progress/residual-closure-register.json";
const TERMINAL_STATES = new Set([
	"evidence_closed",
	"capability_blocked",
	"authority_pending",
	"environment_pending",
]);
const REQUIRED_STUDY_IDS = new Set([
	"offset",
	"time-delay",
	"random",
	"count-growth",
	"afterimage",
	"interference",
	"arrangement",
	"merge-and-split",
	"symmetry",
	"difference",
	"inverse-proportion",
	"follow-through",
	"linkage",
	"two-d-to-three-d",
	"auto-orient",
	"parallax",
	"split",
	"cycle",
]);

type TerminalState =
	| "evidence_closed"
	| "capability_blocked"
	| "authority_pending"
	| "environment_pending";

type ResidualRecord = {
	readonly id?: unknown;
	readonly studyId?: unknown;
	readonly owner?: unknown;
	readonly boundary?: unknown;
	readonly summary?: unknown;
	readonly status?: unknown;
	readonly userAccepted?: unknown;
	readonly evidencePaths?: unknown;
	readonly nextAction?: unknown;
	readonly resumptionCondition?: unknown;
	readonly authority?: unknown;
	readonly requiredAction?: unknown;
	readonly dossier?: unknown;
	readonly rejectedSurrogate?: unknown;
};

type Register = {
	readonly version?: unknown;
	readonly studies?: unknown;
	readonly systems?: unknown;
};

let failed = false;

const fail = (message: string): void => {
	failed = true;
	console.error(`✗ residual-closure: ${message}`);
};

const nonBlankString = (value: unknown): value is string =>
	typeof value === "string" && value.trim().length > 0;

const safeRelativePath = (value: string): boolean => {
	if (path.isAbsolute(value)) return false;
	const parts = value.split(/[\\/]/u);
	return !parts.some((part) => part === ".." || part.length === 0);
};

const verifyPath = (recordId: string, label: string, value: unknown): void => {
	if (!nonBlankString(value)) {
		fail(`${recordId} requires a non-empty ${label}.`);
		return;
	}
	if (!safeRelativePath(value)) {
		fail(`${recordId} ${label} must be a repository-relative path: ${value}`);
		return;
	}
	if (!existsSync(path.resolve(process.cwd(), value))) {
		fail(`${recordId} ${label} does not exist: ${value}`);
	}
};

const verifyEvidencePaths = (recordId: string, value: unknown): number => {
	if (!Array.isArray(value)) {
		fail(`${recordId} evidencePaths must be an array.`);
		return 0;
	}
	for (const evidencePath of value) {
		verifyPath(recordId, "evidence path", evidencePath);
	}
	return value.length;
};

const validateRecord = (
	record: unknown,
	category: "study" | "system",
	seenIds: Set<string>,
	coveredStudies: Set<string>,
	statusCounts: Map<TerminalState, number>,
): void => {
	if (!record || typeof record !== "object") {
		fail(`${category} record must be an object.`);
		return;
	}
	const value = record as ResidualRecord;
	if (!nonBlankString(value.id)) {
		fail(`${category} record has no id.`);
		return;
	}
	const id = value.id;
	if (seenIds.has(id)) fail(`duplicate residual id: ${id}`);
	seenIds.add(id);
	for (const [field, fieldValue] of [
		["owner", value.owner],
		["boundary", value.boundary],
		["summary", value.summary],
	] as const) {
		if (!nonBlankString(fieldValue))
			fail(`${id} requires a non-empty ${field}.`);
	}
	if (value.userAccepted !== false) {
		fail(
			`${id} must explicitly retain userAccepted: false; this register cannot accept visuals.`,
		);
	}
	if (!nonBlankString(value.status) || !TERMINAL_STATES.has(value.status)) {
		fail(`${id} has an invalid terminal status.`);
		return;
	}
	const status = value.status as TerminalState;
	statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
	const evidenceCount = verifyEvidencePaths(id, value.evidencePaths);

	if (category === "study") {
		if (
			!nonBlankString(value.studyId) ||
			!REQUIRED_STUDY_IDS.has(value.studyId)
		) {
			fail(`${id} must name one of the canonical 18 study ids.`);
		} else {
			coveredStudies.add(value.studyId);
		}
	} else if (value.studyId !== undefined) {
		fail(`${id} is a system residual and must not claim a studyId.`);
	}

	switch (status) {
		case "evidence_closed":
			if (evidenceCount === 0) {
				fail(`${id} cannot be evidence_closed without retained evidence.`);
			}
			break;
		case "environment_pending":
			if (!nonBlankString(value.nextAction)) {
				fail(`${id} environment_pending requires nextAction.`);
			}
			if (!nonBlankString(value.resumptionCondition)) {
				fail(`${id} environment_pending requires resumptionCondition.`);
			}
			break;
		case "authority_pending":
			if (!nonBlankString(value.authority)) {
				fail(`${id} authority_pending requires authority.`);
			}
			if (!nonBlankString(value.requiredAction)) {
				fail(`${id} authority_pending requires requiredAction.`);
			}
			break;
		case "capability_blocked":
			verifyPath(id, "dossier", value.dossier);
			if (!nonBlankString(value.rejectedSurrogate)) {
				fail(`${id} capability_blocked requires rejectedSurrogate.`);
			}
			if (!nonBlankString(value.resumptionCondition)) {
				fail(`${id} capability_blocked requires resumptionCondition.`);
			}
			break;
	}
};

const parseRegister = (): Register | null => {
	if (!existsSync(REGISTER_PATH)) {
		// The public open-source tree ships without docs/progress/ (internal
		// records stay in the private deployment repo): treat absence as a
		// no-op pass rather than a failure.
		console.log(
			`Notice: ${REGISTER_PATH} not found; skipping residual-closure check.`,
		);
		process.exit(0);
	}
	try {
		const parsed: unknown = JSON.parse(readFileSync(REGISTER_PATH, "utf8"));
		if (!parsed || typeof parsed !== "object") {
			fail("register root must be an object.");
			return null;
		}
		return parsed as Register;
	} catch (error) {
		fail(
			`register is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
		return null;
	}
};

const register = parseRegister();
if (register) {
	if (register.version !== 1) fail("register version must be 1.");
	const seenIds = new Set<string>();
	const coveredStudies = new Set<string>();
	const statusCounts = new Map<TerminalState, number>();
	if (!Array.isArray(register.studies)) {
		fail("studies must be an array.");
	} else {
		for (const record of register.studies) {
			validateRecord(record, "study", seenIds, coveredStudies, statusCounts);
		}
	}
	if (!Array.isArray(register.systems)) {
		fail("systems must be an array.");
	} else {
		for (const record of register.systems) {
			validateRecord(record, "system", seenIds, coveredStudies, statusCounts);
		}
	}
	for (const studyId of REQUIRED_STUDY_IDS) {
		if (!coveredStudies.has(studyId)) {
			fail(`canonical study has no residual classification: ${studyId}`);
		}
	}
	for (const studyId of coveredStudies) {
		if (!REQUIRED_STUDY_IDS.has(studyId)) {
			fail(`unknown study id in register: ${studyId}`);
		}
	}
	if (!failed) {
		const summary = [...TERMINAL_STATES]
			.map((status) => `${status}=${statusCounts.get(status) ?? 0}`)
			.join(", ");
		console.log(`Residual-closure register passed (${summary}).`);
	}
}

if (failed) process.exit(1);
