import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const errors: string[] = [];
type ProductionAuthorization =
	| "user_accepted_scope"
	| "user_authorized_candidate";

if (args.includes("--help") || args.includes("-h")) {
	printUsage();
	process.exit(0);
}

if (args.length !== 1) {
	errors.push("Provide exactly one motion-production brief path.");
} else {
	preflight(args[0]);
}

if (errors.length > 0) {
	console.error("Motion-production preflight failed.");
	for (const error of errors) console.error(`- ${error}`);
	console.error(
		"Repair the recorded motion contract before mutating scene or motion data. This sensor does not grant aesthetic acceptance.",
	);
	process.exit(1);
}

console.log("Motion-production preflight passed.");
console.log(
	"Recorded source selection, motion/visual-kit admission, causal lock, and active scene-camera declaration passed; silent motion review remains required.",
);

/**
 * Verifies recorded motion-production boundaries without inferring motion
 * quality. It guards contract consistency; the user still judges the silent
 * motion packet and the live-editor runbook still owns target verification.
 */
function preflight(briefArgument: string): void {
	const briefPath = resolveRepoPath(briefArgument, "motion-production brief");
	if (!briefPath) return;
	const briefSource = readMarkdown(briefPath, "motion-production brief");
	if (!briefSource) return;
	const brief = parseFrontMatter(briefSource, toRepoPath(briefPath));
	if (!brief) return;

	requireFrontMatterValues(brief, toRepoPath(briefPath), [
		"motion_sample_id",
		"status",
		"motion_lane",
		"motion_kit",
		"motion_kit_scope",
		"visual_kit",
		"producer",
		"review_authority",
	]);
	const productionAuthorization = resolveProductionAuthorization(
		brief,
		toRepoPath(briefPath),
	);
	if (brief.get("status") !== "brief") {
		errors.push(`${toRepoPath(briefPath)}: status must be "brief".`);
	}
	if (brief.get("motion_lane") !== "motion-production") {
		errors.push(
			`${toRepoPath(briefPath)}: motion_lane must be "motion-production". Use motion foundation while the law, timing, carrier continuity, or camera policy is still open.`,
		);
	}
	if (brief.get("review_authority") !== "user") {
		errors.push(
			`${toRepoPath(briefPath)}: review_authority must be "user"; a producer cannot accept its own motion.`,
		);
	}

	requireSections(briefSource, toRepoPath(briefPath), [
		"Purpose",
		"Causal Concept",
		"Motion Lock",
		"Motion Evidence Packet",
		"Review Contract",
		"Capability Escape Hatch",
		"Producer Declaration",
	]);
	requireLabeledValues(briefSource, toRepoPath(briefPath), [
		"Feature / motion goal",
		"Viewer sentence",
		"Sample boundary",
		"Intent altitude",
		"Construction recipe hypotheses",
		"Commonality",
		"Force",
		"Base point",
		"Role chain",
		"Five-field beat brief",
		"Motion thesis",
		"Signature law",
		"Permitted motion axis",
		"Camera-space declaration",
		"Frozen visual boundary",
		"Forbidden motion work",
		"Silent overview clip",
		"Critical transition",
		"Terminal pose",
		"Contact sheet",
		"Silent review packet",
		"Final acceptance authority",
		"Missing capability",
		"If discovered during production",
		"Producer declaration",
	]);

	const finalAuthority = labeledValue(
		briefSource,
		"Final acceptance authority",
	);
	if (finalAuthority !== "user") {
		errors.push(
			`${toRepoPath(briefPath)}: "Final acceptance authority" must be "user".`,
		);
	}
	const capabilityAction = labeledValue(
		briefSource,
		"If discovered during production",
	);
	if (!capabilityAction?.includes("capability_blocked")) {
		errors.push(
			`${toRepoPath(briefPath)}: the capability escape hatch must explicitly use "capability_blocked".`,
		);
	}

	const cameraSpace = labeledValue(briefSource, "Camera-space declaration");
	if (!isCameraSpaceDeclaration(cameraSpace)) {
		errors.push(
			`${toRepoPath(briefPath)}: "Camera-space declaration" must be exactly "screen_2d" or "active_scene_camera:<stable-camera-id>".`,
		);
	}
	validateSaasNarrativeContract({
		brief,
		briefPath,
		briefSource,
		productionAuthorization,
	});

	const motionKitValue = brief.get("motion_kit");
	if (!motionKitValue || isPlaceholder(motionKitValue)) return;
	const motionKitPath = resolveRepoPath(motionKitValue, "motion kit");
	if (!motionKitPath) return;
	const motionKitSource = readMarkdown(motionKitPath, "motion kit");
	if (!motionKitSource) return;
	const motionKit = parseFrontMatter(
		motionKitSource,
		toRepoPath(motionKitPath),
	);
	if (!motionKit) return;

	validateMotionKit({
		brief,
		briefPath,
		briefSource,
		cameraSpace,
		motionKit,
		motionKitPath,
		motionKitSource,
		productionAuthorization,
	});
}

function validateMotionKit(input: {
	brief: Map<string, string>;
	briefPath: string;
	briefSource: string;
	cameraSpace: string | undefined;
	motionKit: Map<string, string>;
	motionKitPath: string;
	motionKitSource: string;
	productionAuthorization: ProductionAuthorization;
}): void {
	const {
		brief,
		briefPath,
		briefSource,
		cameraSpace,
		motionKit,
		motionKitPath,
		motionKitSource,
		productionAuthorization,
	} = input;
	const motionKitLabel = toRepoPath(motionKitPath);

	requireFrontMatterValues(motionKit, motionKitLabel, [
		"motion_kit_id",
		"status",
		"source_motion_selection_card",
		"linked_visual_kit",
		"accepted_scope",
		"approval_evidence",
		"frozen_intent_altitude",
		"frozen_motion_law",
		"frozen_camera_space",
		"frozen_permitted_axes",
	]);
	if (productionAuthorization === "user_accepted_scope") {
		requireFrontMatterValues(brief, toRepoPath(briefPath), [
			"motion_kit_approval_id",
			"visual_kit_approval_id",
		]);
		requireFrontMatterValues(motionKit, motionKitLabel, ["user_approval_id"]);
	} else {
		requireFrontMatterValues(brief, toRepoPath(briefPath), [
			"candidate_authorization_id",
			"motion_kit_candidate_authorization_id",
			"visual_kit_candidate_authorization_id",
		]);
		requireFrontMatterValues(motionKit, motionKitLabel, [
			"candidate_authorization_id",
		]);
	}
	requireSections(motionKitSource, motionKitLabel, [
		"Motion Thesis",
		"Reference Selection Evidence",
		"Camera And Continuity",
		"Scope And Freeze",
		"User Decision",
	]);
	requireLabeledValues(motionKitSource, motionKitLabel, [
		"Intent altitude",
		"Motion thesis",
		"Signature law",
		"Viewer sentence",
		"Commonality",
		"Force",
		"Base point",
		"Role chain",
		"Reference role",
		"Motion quality nucleus carried forward",
		"Authored distinction carried forward",
		"Construction signature",
		"Native ownership / permitted reduction",
		"Intentional loss boundary",
		"Camera-space policy",
		"Carrier continuity",
		"Load-bearing phrase",
		"Permitted motion axes",
		"Forbidden substitute",
		"Included behaviours",
		"Excluded uses",
		"Frozen visual boundary",
		"User disposition",
		"User decision note",
		"Acceptance date",
	]);
	const isSaasBrandProduct =
		brief.get("motion_story_lane") === "saas_brand_product";
	if (isSaasBrandProduct) {
		requireLabeledValues(motionKitSource, motionKitLabel, [
			"Source evidence packet",
			"Source translation ledger",
			"Reference visual nucleus carried forward",
			"Source world-state chain carried forward",
			"Source UI signal and causal role carried forward",
			"Source camera relation carried forward",
			"Source continuity grammar carried forward",
			"Source-to-original invariants carried forward",
			"Forbidden generic substitutes carried forward",
		]);
		assertEqual(
			labeledValue(motionKitSource, "Source evidence packet"),
			brief.get("source_reference_packet"),
			`${motionKitLabel}: "Source evidence packet" must exactly match ${toRepoPath(briefPath)} source_reference_packet.`,
		);
		assertEqual(
			labeledValue(motionKitSource, "Source translation ledger"),
			brief.get("source_translation_ledger"),
			`${motionKitLabel}: "Source translation ledger" must exactly match ${toRepoPath(briefPath)} source_translation_ledger.`,
		);
	}

	if (productionAuthorization === "user_accepted_scope") {
		if (motionKit.get("status") !== "user_accepted") {
			errors.push(
				`${motionKitLabel}: status must be "user_accepted" before ordinary motion production.`,
			);
		}
		if (labeledValue(motionKitSource, "User disposition") !== "accepted") {
			errors.push(
				`${motionKitLabel}: "User disposition" must be "accepted" before ordinary motion production.`,
			);
		}
		assertEqual(
			brief.get("motion_kit_approval_id"),
			motionKit.get("user_approval_id"),
			`${toRepoPath(briefPath)}: motion_kit_approval_id must exactly match ${motionKitLabel} user_approval_id.`,
		);
	} else {
		if (motionKit.get("status") !== "user_authorized_candidate") {
			errors.push(
				`${motionKitLabel}: status must be "user_authorized_candidate" for a candidate test; do not misreport it as user acceptance.`,
			);
		}
		if (labeledValue(motionKitSource, "User disposition") !== "pending") {
			errors.push(
				`${motionKitLabel}: "User disposition" must remain "pending" for a candidate test.`,
			);
		}
		assertEqual(
			brief.get("candidate_authorization_id"),
			motionKit.get("candidate_authorization_id"),
			`${toRepoPath(briefPath)}: candidate_authorization_id must exactly match ${motionKitLabel} candidate_authorization_id.`,
		);
		assertEqual(
			brief.get("motion_kit_candidate_authorization_id"),
			motionKit.get("candidate_authorization_id"),
			`${toRepoPath(briefPath)}: motion_kit_candidate_authorization_id must exactly match ${motionKitLabel} candidate_authorization_id.`,
		);
	}
	assertEqual(
		brief.get("motion_kit_scope"),
		motionKit.get("accepted_scope"),
		`${toRepoPath(briefPath)}: motion_kit_scope must exactly match ${motionKitLabel} accepted_scope; do not broaden an approval by implication.`,
	);
	assertEqual(
		labeledValue(briefSource, "Intent altitude"),
		motionKit.get("frozen_intent_altitude"),
		`${toRepoPath(briefPath)}: "Intent altitude" must exactly match ${motionKitLabel} frozen_intent_altitude.`,
	);
	assertEqual(
		labeledValue(briefSource, "Signature law"),
		motionKit.get("frozen_motion_law"),
		`${toRepoPath(briefPath)}: "Signature law" must exactly match ${motionKitLabel} frozen_motion_law.`,
	);
	assertEqual(
		labeledValue(briefSource, "Permitted motion axis"),
		motionKit.get("frozen_permitted_axes"),
		`${toRepoPath(briefPath)}: "Permitted motion axis" must exactly match ${motionKitLabel} frozen_permitted_axes.`,
	);
	assertEqual(
		cameraSpace,
		motionKit.get("frozen_camera_space"),
		`${toRepoPath(briefPath)}: "Camera-space declaration" must exactly match ${motionKitLabel} frozen_camera_space.`,
	);
	assertEqual(
		labeledValue(briefSource, "Frozen visual boundary"),
		labeledValue(motionKitSource, "Frozen visual boundary"),
		`${toRepoPath(briefPath)}: "Frozen visual boundary" must exactly match ${motionKitLabel}.`,
	);

	validateLinkedVisualKit({
		brief,
		briefPath,
		motionKit,
		motionKitPath,
		productionAuthorization,
	});
	const activeSceneCameraRequired = validateMotionSelection(
		motionKit,
		motionKitPath,
		motionKitSource,
		brief.get("source_reference_packet"),
		brief.get("source_translation_ledger"),
	);
	if (activeSceneCameraRequired) {
		const frozenCameraSpace = motionKit.get("frozen_camera_space");
		if (!isActiveSceneCameraDeclaration(frozenCameraSpace)) {
			errors.push(
				`${motionKitLabel}: frozen_camera_space must be "active_scene_camera:<stable-camera-id>" for a camera-required SaaS motion source.`,
			);
		}
		if (!isActiveSceneCameraDeclaration(cameraSpace)) {
			errors.push(
				`${toRepoPath(briefPath)}: "Camera-space declaration" must be "active_scene_camera:<stable-camera-id>" for a camera-required SaaS motion source.`,
			);
		}
	}
}

function validateLinkedVisualKit(input: {
	brief: Map<string, string>;
	briefPath: string;
	motionKit: Map<string, string>;
	motionKitPath: string;
	productionAuthorization: ProductionAuthorization;
}): void {
	const {
		brief,
		briefPath,
		motionKit,
		motionKitPath,
		productionAuthorization,
	} = input;
	const motionKitLabel = toRepoPath(motionKitPath);
	const visualKitValue = motionKit.get("linked_visual_kit");
	if (!visualKitValue || isPlaceholder(visualKitValue)) return;

	assertEqual(
		brief.get("visual_kit"),
		visualKitValue,
		`${toRepoPath(briefPath)}: visual_kit must exactly match ${motionKitLabel} linked_visual_kit.`,
	);
	const visualKitPath = resolveRepoPath(visualKitValue, "linked visual kit");
	if (!visualKitPath) return;
	const visualKitSource = readMarkdown(visualKitPath, "linked visual kit");
	if (!visualKitSource) return;
	const visualKit = parseFrontMatter(
		visualKitSource,
		toRepoPath(visualKitPath),
	);
	if (!visualKit) return;

	requireFrontMatterValues(visualKit, toRepoPath(visualKitPath), [
		"visual_kit_id",
		"status",
		"accepted_scope",
	]);
	if (productionAuthorization === "user_accepted_scope") {
		requireFrontMatterValues(visualKit, toRepoPath(visualKitPath), [
			"user_approval_id",
		]);
		if (visualKit.get("status") !== "user_accepted") {
			errors.push(
				`${toRepoPath(visualKitPath)}: linked visual kit must be "user_accepted" before ordinary motion production.`,
			);
		}
		assertEqual(
			brief.get("visual_kit_approval_id"),
			visualKit.get("user_approval_id"),
			`${toRepoPath(briefPath)}: visual_kit_approval_id must exactly match ${toRepoPath(visualKitPath)} user_approval_id.`,
		);
	} else {
		requireFrontMatterValues(visualKit, toRepoPath(visualKitPath), [
			"candidate_authorization_id",
		]);
		if (visualKit.get("status") !== "user_authorized_candidate") {
			errors.push(
				`${toRepoPath(visualKitPath)}: linked visual kit must be "user_authorized_candidate" for a candidate test; it is not a visual pass.`,
			);
		}
		if (labeledValue(visualKitSource, "User disposition") !== "pending") {
			errors.push(
				`${toRepoPath(visualKitPath)}: "User disposition" must remain "pending" for a candidate test.`,
			);
		}
		assertEqual(
			brief.get("candidate_authorization_id"),
			visualKit.get("candidate_authorization_id"),
			`${toRepoPath(briefPath)}: candidate_authorization_id must exactly match ${toRepoPath(visualKitPath)} candidate_authorization_id.`,
		);
		assertEqual(
			brief.get("visual_kit_candidate_authorization_id"),
			visualKit.get("candidate_authorization_id"),
			`${toRepoPath(briefPath)}: visual_kit_candidate_authorization_id must exactly match ${toRepoPath(visualKitPath)} candidate_authorization_id.`,
		);
	}
}

function resolveProductionAuthorization(
	brief: Map<string, string>,
	briefLabel: string,
): ProductionAuthorization {
	const value = brief.get("production_authorization") ?? "user_accepted_scope";
	if (
		value === "user_accepted_scope" ||
		value === "user_authorized_candidate"
	) {
		return value;
	}
	errors.push(
		`${briefLabel}: production_authorization must be "user_accepted_scope" or "user_authorized_candidate".`,
	);
	return "user_accepted_scope";
}

function validateSaasNarrativeContract(input: {
	brief: Map<string, string>;
	briefPath: string;
	briefSource: string;
	productionAuthorization: ProductionAuthorization;
}): void {
	const { brief, briefPath, briefSource, productionAuthorization } = input;
	const storyLane = brief.get("motion_story_lane");
	if (!storyLane) return;
	if (storyLane !== "saas_brand_product") {
		errors.push(
			`${toRepoPath(briefPath)}: motion_story_lane must be "saas_brand_product" when supplied.`,
		);
		return;
	}
	requireFrontMatterValues(brief, toRepoPath(briefPath), [
		"source_reference_packet",
		"source_translation_ledger",
	]);
	requireSections(briefSource, toRepoPath(briefPath), [
		"SaaS Narrative Contract",
	]);
	requireSections(briefSource, toRepoPath(briefPath), [
		"Reference Fidelity Map",
	]);
	requireLabeledValues(briefSource, toRepoPath(briefPath), [
		"Input action and visible text",
		"Product state chain",
		"Causal UI evidence",
		"Camera narrative",
		"Camera-caused input/result relation",
		"Terminal product state",
		"Opening-still review state",
		"Explicit reject conditions",
		"Source evidence packet",
		"Source translation ledger",
		"Reference visual nucleus carried forward",
		"Source world-state chain carried forward",
		"Original world-state chain",
		"Source UI signal and causal role carried forward",
		"Original UI signal and causal state transition",
		"Source camera relation carried forward",
		"Original camera-caused relation",
		"Source opening-world and hierarchy relation",
		"Original opening-world equivalent",
		"Source camera crossing and hierarchy handoff",
		"Original camera crossing and hierarchy handoff",
		"Source terminal grammar",
		"Original terminal grammar",
		"Translation loss / capability boundary",
		"Forbidden generic substitutes carried forward",
		"Three-frame proof plan",
	]);
	const stateChain = labeledValue(briefSource, "Product state chain");
	if (!stateChain?.includes("->")) {
		errors.push(
			`${toRepoPath(briefPath)}: "Product state chain" must state a causal transition with "->".`,
		);
	}
	if (
		labeledValue(briefSource, "Opening-still review state") !==
		"user_review_required"
	) {
		errors.push(
			`${toRepoPath(briefPath)}: "Opening-still review state" must be "user_review_required"; a producer cannot self-accept candidate pixels.`,
		);
	}
	assertEqual(
		labeledValue(briefSource, "Source evidence packet"),
		brief.get("source_reference_packet"),
		`${toRepoPath(briefPath)}: "Source evidence packet" must exactly match source_reference_packet.`,
	);
	assertEqual(
		labeledValue(briefSource, "Source translation ledger"),
		brief.get("source_translation_ledger"),
		`${toRepoPath(briefPath)}: "Source translation ledger" must exactly match source_translation_ledger.`,
	);
	const originalWorldStateChain = labeledValue(
		briefSource,
		"Original world-state chain",
	);
	if (!originalWorldStateChain?.includes("->")) {
		errors.push(
			`${toRepoPath(briefPath)}: "Original world-state chain" must state a coherent transition with "->".`,
		);
	}
	const threeFrameProofPlan = labeledValue(
		briefSource,
		"Three-frame proof plan",
	);
	if (!threeFrameProofPlan?.includes("user_review_required")) {
		errors.push(
			`${toRepoPath(briefPath)}: "Three-frame proof plan" must retain user_review_required for a SaaS candidate.`,
		);
	}
	if (productionAuthorization === "user_authorized_candidate") {
		const candidateId = brief.get("candidate_authorization_id");
		if (!candidateId || isPlaceholder(candidateId)) {
			errors.push(
				`${toRepoPath(briefPath)}: SaaS candidate lane requires a non-placeholder candidate_authorization_id.`,
			);
		}
	}
}

function validateMotionSelection(
	motionKit: Map<string, string>,
	motionKitPath: string,
	motionKitSource: string,
	expectedSourceReferencePacket: string | undefined,
	expectedSourceTranslationLedger: string | undefined,
): boolean {
	const value = motionKit.get("source_motion_selection_card");
	if (!value || isPlaceholder(value)) return false;
	const selectionPath = resolveRepoPath(value, "motion source selection card");
	if (!selectionPath) return false;
	const selectionSource = readMarkdown(
		selectionPath,
		"motion source selection card",
	);
	if (!selectionSource) return false;
	const selection = parseFrontMatter(
		selectionSource,
		toRepoPath(selectionPath),
	);
	if (!selection) return false;
	const selectionLabel = toRepoPath(selectionPath);

	requireFrontMatterValues(selection, selectionLabel, [
		"motion_selection_id",
		"motion_selection_status",
		"source_url_or_user_asset",
		"source_kind",
		"motion_reference_role",
		"review_scope",
		"motion_complexity_disposition",
		"motion_primary_disposition",
		"classification",
		"motion_specificity_disposition",
		"camera_requirement",
		"selection_decision",
		"user_disposition",
		"next_permitted_action",
	]);
	requireSections(selectionSource, selectionLabel, [
		"Motion Quality Nucleus",
		"Visual-Motion Admission",
		"Camera–Composition Admission",
		"Representation Audit",
		"Phrase Complexity And Direction",
		"Motion Specificity Audit",
		"Classification",
		"User Gate",
	]);
	requireLabeledValues(selectionSource, selectionLabel, [
		"Active-camera playback evidence",
		"Viewer sentence",
		"Load-bearing observations",
		"Motion quality nucleus",
		"Excluded generic readings",
		"No-copy / no-reproduction boundary",
		"Minimum first proof",
		"First-read visual hierarchy in motion",
		"Authored visual-temporal distinction",
		"Generic replacement and visible loss",
		"Quality that must not be substituted",
		"Fixed anchor or source mass",
		"Repeated or relational carrier field",
		"Camera-caused relation change",
		"Ambient-wallpaper replacement and visible loss",
		"Current native owners",
		"Required representation not currently owned",
		"Permitted reduction",
		"Loss boundary",
		"Forbidden substitute",
		"Phrase complexity",
		"Primary motion quality",
		"Allowed calibration contribution",
		"Camera-space boundary",
		"Geometry / object escalation boundary",
		"First-read temporal hierarchy",
		"Authored distinction",
		"Exchangeability test",
		"Generic motion read to avoid",
		"Decision evidence",
		"User note",
		"Next permitted action",
	]);
	const requiresSourceFrameEvidence =
		Boolean(expectedSourceReferencePacket) &&
		!isPlaceholder(expectedSourceReferencePacket ?? "");
	if (requiresSourceFrameEvidence) {
		requireFrontMatterValues(selection, selectionLabel, [
			"reference_evidence_status",
			"source_reference_packet",
			"source_frame_count",
			"source_translation_ledger",
		]);
		requireSections(selectionSource, selectionLabel, [
			"Source Frame Evidence",
			"Source-to-Original Translation Admission",
		]);
		requireLabeledValues(selectionSource, selectionLabel, [
			"Reference evidence status",
			"Source reference packet",
			"Source frame count",
			"Reference visual nucleus",
			"Source world-state chain",
			"Source UI signal and causal role",
			"Source camera-caused compositional relation",
			"Source terminal world state",
			"Forbidden generic substitutes",
			"Translation ledger",
			"Translation disposition",
			"Source opening-world and hierarchy",
			"Original opening-world equivalent",
			"Source camera crossing and hierarchy handoff",
			"Original camera crossing and hierarchy handoff",
			"Source terminal grammar",
			"Original terminal grammar",
			"Forbidden semantic proxy",
		]);
		validateSourceFrameEvidence({
			selection,
			selectionLabel,
			selectionSource,
			expectedSourceReferencePacket: expectedSourceReferencePacket ?? "",
			expectedSourceTranslationLedger: expectedSourceTranslationLedger ?? "",
		});
	}

	if (selection.get("motion_selection_status") !== "candidate_direction") {
		errors.push(
			`${selectionLabel}: motion_selection_status must be "candidate_direction" before a motion kit can consume it.`,
		);
	}
	if (!isAllowedRole(selection.get("motion_reference_role"))) {
		errors.push(
			`${selectionLabel}: motion_reference_role must be full_motion_direction, construction_calibration, timing_calibration, or camera_calibration.`,
		);
	}
	if (selection.get("camera_requirement") !== "active_scene_camera_required") {
		errors.push(
			`${selectionLabel}: camera_requirement must be "active_scene_camera_required" for the SaaS brand/product motion lane.`,
		);
	}
	if (
		labeledValue(selectionSource, "Camera-space boundary") !==
		"active scene camera"
	) {
		errors.push(
			`${selectionLabel}: "Camera-space boundary" must be exactly "active scene camera" for the SaaS brand/product motion lane.`,
		);
	}
	if (
		selection.get("classification") !== "direct_native" &&
		selection.get("classification") !== "bounded_native_approximation"
	) {
		errors.push(
			`${selectionLabel}: classification must be direct_native or bounded_native_approximation before production.`,
		);
	}
	if (selection.get("motion_specificity_disposition") !== "distinct") {
		errors.push(
			`${selectionLabel}: motion_specificity_disposition must be "distinct" before a motion kit can consume it.`,
		);
	}
	if (
		selection.get("motion_complexity_disposition") ===
		"complex_choreography_rejected"
	) {
		errors.push(
			`${selectionLabel}: a complex_choreography_rejected source cannot enter a motion kit.`,
		);
	}
	if (
		selection.get("motion_primary_disposition") === "effect_sequence_rejected"
	) {
		errors.push(
			`${selectionLabel}: an effect_sequence_rejected source cannot enter a motion kit.`,
		);
	}
	if (selection.get("user_disposition") !== "selected") {
		errors.push(
			`${selectionLabel}: user_disposition must be "selected" before a motion kit can consume it.`,
		);
	}

	const role = selection.get("motion_reference_role");
	const decision = selection.get("selection_decision");
	const calibrationAdmission =
		(role === "construction_calibration" ||
			role === "timing_calibration" ||
			role === "camera_calibration") &&
		decision === "prepare_motion_concept_brief";
	if (decision !== "present_as_motion_candidate" && !calibrationAdmission) {
		errors.push(
			`${selectionLabel}: selection_decision must be "present_as_motion_candidate" before a motion kit can consume it; only a construction, timing, or camera calibration may instead use "prepare_motion_concept_brief".`,
		);
	}
	if (
		selection.get("source_kind") === "agent_found_with_user_permission" &&
		selection.get("motion_primary_disposition") !== "law_first"
	) {
		errors.push(
			`${selectionLabel}: an agent-found source must be "law_first" unless the user supplied an explicit choreography-primary direction.`,
		);
	}

	const motionKitLabel = toRepoPath(motionKitPath);
	const referenceRole = labeledValue(motionKitSource, "Reference role");
	if (referenceRole !== role) {
		errors.push(
			`${motionKitLabel}: "Reference role" must exactly match ${selectionLabel} motion_reference_role.`,
		);
	}

	return selection.get("camera_requirement") === "active_scene_camera_required";
}

function validateSourceFrameEvidence(input: {
	selection: Map<string, string>;
	selectionLabel: string;
	selectionSource: string;
	expectedSourceReferencePacket: string;
	expectedSourceTranslationLedger: string;
}): void {
	const {
		selection,
		selectionLabel,
		selectionSource,
		expectedSourceReferencePacket,
		expectedSourceTranslationLedger,
	} = input;
	if (selection.get("reference_evidence_status") !== "source_frames_observed") {
		errors.push(
			`${selectionLabel}: reference_evidence_status must be "source_frames_observed" before a SaaS candidate can enter a motion kit.`,
		);
	}
	assertEqual(
		selection.get("source_reference_packet"),
		expectedSourceReferencePacket,
		`${selectionLabel}: source_reference_packet must exactly match the SaaS brief source_reference_packet.`,
	);
	assertEqual(
		selection.get("source_translation_ledger"),
		expectedSourceTranslationLedger,
		`${selectionLabel}: source_translation_ledger must exactly match the SaaS brief source_translation_ledger.`,
	);
	assertEqual(
		labeledValue(selectionSource, "Reference evidence status"),
		selection.get("reference_evidence_status"),
		`${selectionLabel}: "Reference evidence status" must exactly match reference_evidence_status.`,
	);
	assertEqual(
		labeledValue(selectionSource, "Source reference packet"),
		selection.get("source_reference_packet"),
		`${selectionLabel}: "Source reference packet" must exactly match source_reference_packet.`,
	);
	assertEqual(
		labeledValue(selectionSource, "Source frame count"),
		selection.get("source_frame_count"),
		`${selectionLabel}: "Source frame count" must exactly match source_frame_count.`,
	);
	const frameCount = Number(selection.get("source_frame_count"));
	if (!Number.isInteger(frameCount) || frameCount < 4) {
		errors.push(
			`${selectionLabel}: source_frame_count must be an integer of at least 4 for a SaaS candidate.`,
		);
	}
	for (const label of [
		"Relevant playback evidence",
		"Active-camera playback evidence",
		"Source camera-caused compositional relation",
	]) {
		const evidence = labeledValue(selectionSource, label)?.toLowerCase() ?? "";
		if (
			/unobserved|not observed|not claimed|source text|case-study prose/.test(
				evidence,
			)
		) {
			errors.push(
				`${selectionLabel}: "${label}" must state observed source playback, not an unobserved or text-only substitute.`,
			);
		}
	}

	const packetValue = selection.get("source_reference_packet");
	if (!packetValue || isPlaceholder(packetValue)) return;
	const packetPath = resolveRepoPath(
		packetValue,
		"motion source-frame evidence packet",
	);
	if (!packetPath) return;
	const packetSource = readMarkdown(
		packetPath,
		"motion source-frame evidence packet",
	);
	if (!packetSource) return;
	const packet = parseFrontMatter(packetSource, toRepoPath(packetPath));
	if (!packet) return;
	const packetLabel = toRepoPath(packetPath);
	requireFrontMatterValues(packet, packetLabel, [
		"reference_evidence_id",
		"status",
		"source_url",
		"source_capture_policy",
		"source_frame_count",
	]);
	requireSections(packetSource, packetLabel, [
		"Playback Observation",
		"Four-Frame World Map",
		"Candidate Constraint",
	]);
	requireLabeledValues(packetSource, packetLabel, [
		"Playback observed",
		"Observed source window",
		"Source visual nucleus",
		"Source world-state chain",
		"Source UI signal and causal role",
		"Source camera-caused compositional relation",
		"Source terminal world state",
		"Source continuity grammar",
		"Source hierarchy evolution",
		"No-copy boundary",
		"Frame 1",
		"Frame 2",
		"Frame 3",
		"Frame 4",
		"Original adaptation boundary",
		"Forbidden generic substitutes",
		"Blocked reason",
	]);
	if (packet.get("status") !== "source_frames_observed") {
		errors.push(
			`${packetLabel}: status must be "source_frames_observed" before a SaaS candidate can enter a motion kit.`,
		);
	}
	if (
		packet.get("source_capture_policy") !== "transient-local-inspection-only"
	) {
		errors.push(
			`${packetLabel}: source_capture_policy must be "transient-local-inspection-only"; do not commit source pixels.`,
		);
	}
	if (labeledValue(packetSource, "Playback observed") !== "yes") {
		errors.push(
			`${packetLabel}: "Playback observed" must be "yes" for source_frames_observed.`,
		);
	}
	assertEqual(
		packet.get("source_frame_count"),
		selection.get("source_frame_count"),
		`${packetLabel}: source_frame_count must exactly match ${selectionLabel}.`,
	);
	validateSourceTranslationLedger({
		selection,
		selectionLabel,
		selectionSource,
		expectedSourceReferencePacket,
		expectedSourceTranslationLedger,
	});
}

/**
 * Rejects SaaS candidates that name observed source frames but never translate
 * the source's world, hierarchy, camera handoff, and terminal grammar into
 * original equivalents. This records coverage only; pixel review remains a
 * human authority and cannot be inferred by preflight.
 */
function validateSourceTranslationLedger(input: {
	selection: Map<string, string>;
	selectionLabel: string;
	selectionSource: string;
	expectedSourceReferencePacket: string;
	expectedSourceTranslationLedger: string;
}): void {
	const {
		selection,
		selectionLabel,
		selectionSource,
		expectedSourceReferencePacket,
		expectedSourceTranslationLedger,
	} = input;
	assertEqual(
		labeledValue(selectionSource, "Translation ledger"),
		selection.get("source_translation_ledger"),
		`${selectionLabel}: "Translation ledger" must exactly match source_translation_ledger.`,
	);
	if (
		labeledValue(selectionSource, "Translation disposition") !==
		"translation_contract_complete"
	) {
		errors.push(
			`${selectionLabel}: "Translation disposition" must be "translation_contract_complete" before a SaaS candidate can enter a motion kit. Use translation_capability_blocked and stop when a load-bearing source relation has no original equivalent.`,
		);
	}
	const ledgerValue = selection.get("source_translation_ledger");
	if (!ledgerValue || isPlaceholder(ledgerValue)) return;
	const ledgerPath = resolveRepoPath(
		ledgerValue,
		"motion source-to-original translation ledger",
	);
	if (!ledgerPath) return;
	const ledgerSource = readMarkdown(
		ledgerPath,
		"motion source-to-original translation ledger",
	);
	if (!ledgerSource) return;
	const ledger = parseFrontMatter(ledgerSource, toRepoPath(ledgerPath));
	if (!ledger) return;
	const ledgerLabel = toRepoPath(ledgerPath);
	requireFrontMatterValues(ledger, ledgerLabel, [
		"translation_ledger_id",
		"status",
		"source_reference_packet",
		"review_authority",
	]);
	requireSections(ledgerSource, ledgerLabel, [
		"Source Grammar Atoms",
		"Original Equivalents",
		"Construction Routing",
		"Translation Boundary",
		"Translation Triptych",
	]);
	requireLabeledValues(ledgerSource, ledgerLabel, [
		"Opening world and hierarchy",
		"State/message form and causal role",
		"Camera crossing and hierarchy handoff",
		"Result-world carrier",
		"Terminal grammar",
		"Continuity grammar",
		"Original opening-world equivalent",
		"Original state/message equivalent",
		"Original camera crossing and hierarchy handoff",
		"Original result-world carrier",
		"Original terminal grammar",
		"Preserved source-to-original invariants",
		"Image-world carrier classification",
		"Construction route",
		"Original image provenance",
		"Pixel-object import plan records",
		"Depth-plane strategy",
		"Native construction boundary",
		"Manual reconstruction prohibition",
		"No-copy boundary",
		"Forbidden semantic proxy",
		"Native owner or bounded original reduction",
		"Translation loss boundary",
		"Blocked reason",
		"Opening checkpoint",
		"Passage checkpoint",
		"Terminal checkpoint",
		"Transient source/candidate review plan",
		"Failure condition",
	]);
	if (ledger.get("status") !== "translation_contract_complete") {
		errors.push(
			`${ledgerLabel}: status must be "translation_contract_complete" before a SaaS candidate can enter a motion kit.`,
		);
	}
	if (ledger.get("review_authority") !== "user") {
		errors.push(
			`${ledgerLabel}: review_authority must be "user"; a translation ledger cannot self-accept candidate pixels.`,
		);
	}
	assertEqual(
		ledger.get("source_reference_packet"),
		expectedSourceReferencePacket,
		`${ledgerLabel}: source_reference_packet must exactly match the SaaS brief source_reference_packet.`,
	);
	assertEqual(
		ledgerValue,
		expectedSourceTranslationLedger,
		`${selectionLabel}: source_translation_ledger must exactly match the SaaS brief source_translation_ledger.`,
	);
	validateImageWorldConstructionRouting({
		ledger,
		ledgerLabel,
		ledgerSource,
	});
}

/**
 * Requires an explicit economical representation for source-derived visual
 * worlds. It validates the record and compact pixel-object command plans; it
 * cannot judge the generated image, infer semantic depth layers, or accept
 * candidate pixels.
 */
function validateImageWorldConstructionRouting(input: {
	ledger: Map<string, string>;
	ledgerLabel: string;
	ledgerSource: string;
}): void {
	const { ledger, ledgerLabel, ledgerSource } = input;
	const classification = labeledValue(
		ledgerSource,
		"Image-world carrier classification",
	);
	const route = labeledValue(ledgerSource, "Construction route");
	const provenance = labeledValue(ledgerSource, "Original image provenance");
	const planRecords = labeledValue(
		ledgerSource,
		"Pixel-object import plan records",
	);

	if (classification !== "none" && classification !== "present") {
		errors.push(
			`${ledgerLabel}: "Image-world carrier classification" must be "none" or "present".`,
		);
		return;
	}

	if (classification === "none") {
		if (route !== "not_applicable") {
			errors.push(
				`${ledgerLabel}: an image-world classification of "none" requires "Construction route" to be "not_applicable".`,
			);
		}
		if (provenance !== "not_applicable" || planRecords !== "not_applicable") {
			errors.push(
				`${ledgerLabel}: an image-world classification of "none" requires original-image provenance and pixel-object plan records to be "not_applicable".`,
			);
		}
		return;
	}

	if (route === "capability_blocked") {
		if (ledger.get("status") !== "translation_capability_blocked") {
			errors.push(
				`${ledgerLabel}: a "capability_blocked" image-world route requires status "translation_capability_blocked" and must stop candidate work.`,
			);
		}
		return;
	}
	if (route !== "pixel_object_import") {
		errors.push(
			`${ledgerLabel}: a present image-world must use "pixel_object_import" or "capability_blocked"; do not hand-reconstruct it with bespoke vectors.`,
		);
		return;
	}
	if (
		provenance !== "original_generated_image" &&
		provenance !== "user_owned_or_authorized_image"
	) {
		errors.push(
			`${ledgerLabel}: "Original image provenance" must be "original_generated_image" or "user_owned_or_authorized_image" when the construction route is "pixel_object_import".`,
		);
	}
	if (!planRecords || planRecords === "not_applicable") {
		errors.push(
			`${ledgerLabel}: a pixel-object image-world route requires one or more repo-relative plan records emitted by scripts/pixel-art-object-plan.ts.`,
		);
		return;
	}

	for (const record of planRecords.split(",").map((value) => value.trim())) {
		if (!record) {
			errors.push(
				`${ledgerLabel}: "Pixel-object import plan records" cannot contain an empty path.`,
			);
			continue;
		}
		const planPath = resolveRepoPath(record, "pixel-object import plan record");
		if (!planPath) continue;
		const planSource = readMarkdown(
			planPath,
			"pixel-object import plan record",
		);
		if (!planSource) continue;
		validatePixelObjectPlanRecord(planSource, toRepoPath(planPath));
	}
}

function validatePixelObjectPlanRecord(source: string, label: string): void {
	let plan: unknown;
	try {
		plan = JSON.parse(source);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		errors.push(
			`${label}: pixel-object import plan must be valid JSON (${detail}).`,
		);
		return;
	}
	if (!isRecord(plan) || !Array.isArray(plan.sceneCommands)) {
		errors.push(
			`${label}: pixel-object import plan must contain a sceneCommands array.`,
		);
		return;
	}
	const [command] = plan.sceneCommands;
	if (
		plan.sceneCommands.length !== 1 ||
		!isRecord(command) ||
		command.type !== "scene/append-pixel-art-objects" ||
		!isRecord(command.pixelArt)
	) {
		errors.push(
			`${label}: each pixel-object import plan record must contain exactly one "scene/append-pixel-art-objects" command with an indexed pixelArt payload. Generate it with scripts/pixel-art-object-plan.ts.`,
		);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAllowedRole(value: string | undefined): boolean {
	return (
		value === "full_motion_direction" ||
		value === "construction_calibration" ||
		value === "timing_calibration" ||
		value === "camera_calibration"
	);
}

function isCameraSpaceDeclaration(value: string | undefined): boolean {
	return (
		value === "screen_2d" || /^active_scene_camera:[^<>\s]+$/.test(value ?? "")
	);
}

function isActiveSceneCameraDeclaration(value: string | undefined): boolean {
	return /^active_scene_camera:[^<>\s]+$/.test(value ?? "");
}

function assertEqual(
	actual: string | undefined,
	expected: string | undefined,
	error: string,
): void {
	if (!actual || !expected || actual !== expected) errors.push(error);
}

function requireFrontMatterValues(
	frontMatter: Map<string, string>,
	label: string,
	keys: string[],
): void {
	for (const key of keys) {
		const value = frontMatter.get(key);
		if (!value || isPlaceholder(value)) {
			errors.push(
				`${label}: front matter "${key}" is required and cannot be a placeholder.`,
			);
		}
	}
}

function requireSections(
	source: string,
	label: string,
	sections: string[],
): void {
	for (const section of sections) {
		if (!source.includes(`## ${section}`)) {
			errors.push(`${label}: missing required "## ${section}" section.`);
		}
	}
}

function requireLabeledValues(
	source: string,
	label: string,
	labels: string[],
): void {
	for (const expectedLabel of labels) {
		const value = labeledValue(source, expectedLabel);
		if (!value || isPlaceholder(value)) {
			errors.push(
				`${label}: "${expectedLabel}" is required and cannot be a placeholder.`,
			);
		}
	}
}

function labeledValue(source: string, label: string): string | undefined {
	const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = source.match(
		new RegExp(`^-\\s*\\*\\*${escapedLabel}:\\*\\*\\s*(.+)$`, "m"),
	);
	return match?.[1]?.trim();
}

function parseFrontMatter(
	source: string,
	label: string,
): Map<string, string> | undefined {
	const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
	if (!match) {
		errors.push(`${label}: missing YAML front matter.`);
		return undefined;
	}
	const frontMatter = new Map<string, string>();
	for (const line of match[1].split(/\r?\n/)) {
		if (!line.trim() || line.trimStart().startsWith("#")) continue;
		const separator = line.indexOf(":");
		if (separator < 1) continue;
		frontMatter.set(
			line.slice(0, separator).trim(),
			line.slice(separator + 1).trim(),
		);
	}
	return frontMatter;
}

function resolveRepoPath(value: string, kind: string): string | undefined {
	if (isPlaceholder(value)) {
		errors.push(`${kind}: path is required and cannot be a placeholder.`);
		return undefined;
	}
	const resolved = path.resolve(repoRoot, value);
	if (resolved !== repoRoot && !resolved.startsWith(`${repoRoot}${path.sep}`)) {
		errors.push(`${kind}: path must stay inside this repository.`);
		return undefined;
	}
	if (!existsSync(resolved)) {
		errors.push(`${kind}: file does not exist: ${value}`);
		return undefined;
	}
	return resolved;
}

function readMarkdown(filePath: string, kind: string): string | undefined {
	try {
		return readFileSync(filePath, "utf8");
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		errors.push(`${kind}: could not read ${toRepoPath(filePath)} (${detail}).`);
		return undefined;
	}
}

function toRepoPath(filePath: string): string {
	return path.relative(repoRoot, filePath) || ".";
}

function isPlaceholder(value: string): boolean {
	const normalized = value.trim();
	return (
		normalized.length === 0 ||
		/^<[^>]+>$/.test(normalized) ||
		normalized === "..." ||
		normalized.toLowerCase() === "tbd"
	);
}

function printUsage(): void {
	console.log(`Usage: bun run motion:preflight -- <motion-production-brief.md>

Validates recorded motion admission, linked visual-kit authorization, causal locks, active scene-camera declaration, and camera-composition evidence.
It does not judge timing, pixels, a connected editor, or user acceptance.`);
}
