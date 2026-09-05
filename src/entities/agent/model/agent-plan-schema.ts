import { z } from "zod";

import {
	EASING_PRESETS,
	MOTION_TIMING_TEMPLATES,
} from "@/entities/motion/model/easing";
import { TEXT_ANIMATOR_PRESET_IDS } from "@/entities/motion/model/text-animator";
import {
	CAMERA_RIG_ANIMATABLE_PROPERTIES,
	SCALAR_ANIMATABLE_PROPERTIES,
} from "@/entities/motion/model/types";
import { EXPR_MAX_SOURCE_LENGTH } from "@/shared/expr-dsl";
import type { AgentMotionCommand } from "./types";

/**
 * Structural schema set for the native prompt-to-plan transport (Creator 2,
 * C2-L3). This module is deliberately React/zustand-free so it can be imported by
 * BOTH the browser and the Cloudflare Worker — the same dual-use precedent as
 * `bridge-protocol.ts` (already imported by `worker/agent-bridge/session.ts`);
 * `check-architecture.ts` permits `worker/ -> src/entities`.
 *
 * One source, two uses:
 *  1. {@link narrowMotionCommands} is the Worker's STRUCTURAL narrow — it accepts
 *     raw provider JSON only when every field the motion compiler
 *     (`entities/agent/model/write.ts` `compileAgentMotionCommand`) dereferences
 *     WITHOUT a presence guard is present and correctly typed. The Worker never
 *     runs the semantic compiler (it has no live document); the browser does,
 *     through `validateAgentCommandPlan`. The narrow's only job is to guarantee
 *     raw provider JSON can never crash the non-total compile switch.
 *  2. {@link motionPlanToolJsonSchema} is the provider-facing tool `input_schema`
 *     (Anthropic tool-use), derived from the same zod schema so the two can never
 *     drift.
 *
 * SCOPE (binding decision, recorded in the progress ledger): only motion commands
 * whose compile branch reads simple scalar/id/enum fields are accepted here.
 * Commands carrying heavy nested engine payloads — camera cuts
 * (`CameraCutSegment`), automation tracks (`AutomationTrack`), look-node owner
 * keyframes (`AgentLookGraphOwner`), source-optics targets, path-morph, and
 * snapshot-valued keyframes (pathShape/meshPaint/fillGradient) — are intentionally
 * OUT of the first provider schema. A prompt that needs them yields a typed
 * `unsupported` result (never a silent downgrade); the union can be widened in a
 * later loop. This is faithful to the contract's own "typed unsupported issue"
 * pattern and to "keep minimal".
 */

/**
 * The single canonical list of motion command `type` discriminants this transport
 * accepts. It is the source for (a) the zod discriminated union below, (b) the
 * provider tool JSON schema, and (c) the projection's "authorable motion command
 * kinds" capability descriptor — so all three can never drift apart. Every entry
 * here has a fully-validated zod branch in {@link agentMotionCommandSchema}, and
 * the union member it names is a real {@link AgentMotionCommand} `type`.
 */
export const ACCEPTED_MOTION_COMMAND_TYPES = [
	"motion/upsert-keyframe",
	"motion/set-keyframe-easing",
	"motion/retime-keyframe",
	"motion/remove-keyframe",
	"motion/remove-track",
	"motion/set-bindable-keyframe",
	"motion/enable-position-path",
	"motion/update-position-path-key",
	"motion/retime-position-path-key",
	"motion/upsert-production-control-keyframe",
	"motion/remove-production-control-keyframe",
	"motion/retime-production-control-keyframe",
	"motion/set-camera-channel-expression",
	"motion/remove-camera-channel-expression",
	"motion/set-text-animator-offset-expression",
	"motion/remove-text-animator-offset-expression",
	"motion/upsert-camera-keyframe",
	"motion/upsert-camera-vector-keyframes",
	"motion/remove-camera-keyframe",
	"motion/remove-camera-track",
	"motion/remove-camera-rig-tracks",
	"motion/retime-camera-keyframe",
	"motion/set-camera-keyframe-easing",
	"motion/apply-text-animator",
	"motion/remove-text-animator",
	"motion/set-text-animator-enabled",
	"motion/apply-clip-timing-template",
	"motion/create-clip",
	"motion/rename-clip",
	"motion/trim-clip",
	"motion/assign-clip-tracks",
	"motion/reorder-clip",
	"motion/delete-clip",
	"motion/propagate-to-instances",
] as const satisfies readonly AgentMotionCommand["type"][];

export type AcceptedMotionCommandType =
	(typeof ACCEPTED_MOTION_COMMAND_TYPES)[number];

/** Hard cap on commands in one provider plan (the Worker rejects anything larger). */
export const MAX_MOTION_COMMANDS_PER_PLAN = 64;

const finite = z.number().finite();
const frame = finite;
const trackId = z.string().min(1);
const nodeId = z.string().min(1);

const vec2 = z.strictObject({ x: finite, y: finite });

/** Mirror of {@link AgentKeyframeEasing} (compiled by `compileKeyframeEasing`). */
const keyframeEasing = z.discriminatedUnion("kind", [
	z.strictObject({
		kind: z.literal("template"),
		templateId: z.enum(MOTION_TIMING_TEMPLATES.map((template) => template.id)),
	}),
	z.strictObject({
		kind: z.literal("preset"),
		preset: z.enum([...EASING_PRESETS]),
	}),
	z.strictObject({
		kind: z.literal("custom"),
		x1: finite,
		y1: finite.optional(),
		x2: finite,
		y2: finite.optional(),
	}),
]);

const positionPathSpatialMode = z.enum(["corner", "continuous", "auto"]);

const positionPathKey = z.strictObject({
	frame,
	position: vec2,
	inTangent: vec2.optional(),
	outTangent: vec2.optional(),
	spatialMode: positionPathSpatialMode.optional(),
	roving: z.boolean().optional(),
});

/**
 * Discriminated union over the accepted command `type`s. Each branch makes
 * required exactly the fields its compile branch reads unguarded, and `strictObject`
 * rejects unknown keys so a malformed provider object cannot smuggle a field the
 * compiler would later trust. Scalar keyframe values are `z.number()` only:
 * snapshot-valued properties are out of scope (see the module header).
 */
export const agentMotionCommandSchema = z.discriminatedUnion("type", [
	z.strictObject({
		type: z.literal("motion/upsert-keyframe"),
		nodeId,
		property: z.enum([...SCALAR_ANIMATABLE_PROPERTIES]),
		frame,
		value: finite,
		easing: keyframeEasing.optional(),
	}),
	z.strictObject({
		type: z.literal("motion/set-keyframe-easing"),
		trackId,
		frame,
		easing: keyframeEasing,
	}),
	z.strictObject({
		type: z.literal("motion/retime-keyframe"),
		trackId,
		fromFrame: frame,
		toFrame: frame,
	}),
	z.strictObject({
		type: z.literal("motion/remove-keyframe"),
		trackId,
		frame,
	}),
	z.strictObject({
		type: z.literal("motion/remove-track"),
		trackId,
	}),
	z.strictObject({
		type: z.literal("motion/set-bindable-keyframe"),
		nodeId,
		propertyId: z.string().min(1),
		frame,
		value: finite,
	}),
	z.strictObject({
		type: z.literal("motion/enable-position-path"),
		nodeId,
		keys: z.array(positionPathKey).min(1).max(256),
	}),
	z.strictObject({
		type: z.literal("motion/update-position-path-key"),
		nodeId,
		frame,
		inTangent: vec2.optional(),
		outTangent: vec2.optional(),
		spatialMode: positionPathSpatialMode.optional(),
		roving: z.boolean().optional(),
	}),
	z.strictObject({
		type: z.literal("motion/retime-position-path-key"),
		nodeId,
		fromFrame: frame,
		toFrame: frame,
	}),
	z.strictObject({
		type: z.literal("motion/upsert-camera-keyframe"),
		cameraRigId: z.string().min(1),
		property: z.enum([...CAMERA_RIG_ANIMATABLE_PROPERTIES]),
		frame,
		value: finite,
	}),
	z.strictObject({
		type: z.literal("motion/upsert-production-control-keyframe"),
		linkId: z.string().min(1),
		controlId: z.string().min(1),
		frame,
		value: finite,
	}),
	z.strictObject({
		type: z.literal("motion/remove-production-control-keyframe"),
		linkId: z.string().min(1),
		controlId: z.string().min(1),
		frame,
	}),
	z.strictObject({
		type: z.literal("motion/retime-production-control-keyframe"),
		linkId: z.string().min(1),
		controlId: z.string().min(1),
		fromFrame: frame,
		toFrame: frame,
	}),
	z.strictObject({
		type: z.literal("motion/set-camera-channel-expression"),
		cameraRigId: z.string().min(1),
		channel: z.enum([...CAMERA_RIG_ANIMATABLE_PROPERTIES]),
		expression: z.string().min(1).max(EXPR_MAX_SOURCE_LENGTH),
	}),
	z.strictObject({
		type: z.literal("motion/remove-camera-channel-expression"),
		cameraRigId: z.string().min(1),
		channel: z.enum([...CAMERA_RIG_ANIMATABLE_PROPERTIES]),
	}),
	z.strictObject({
		type: z.literal("motion/set-text-animator-offset-expression"),
		bindingId: z.string().min(1),
		selectorIndex: z.int().nonnegative(),
		expression: z.string().min(1).max(EXPR_MAX_SOURCE_LENGTH),
	}),
	z.strictObject({
		type: z.literal("motion/remove-text-animator-offset-expression"),
		bindingId: z.string().min(1),
		selectorIndex: z.int().nonnegative(),
	}),
	z.strictObject({
		type: z.literal("motion/upsert-camera-vector-keyframes"),
		cameraRigId: z.string().min(1),
		kind: z.enum(["body", "target", "bodyRotation"]),
		frame,
		value: z
			.strictObject({
				x: finite.optional(),
				y: finite.optional(),
				z: finite.optional(),
			})
			.refine(
				(record) =>
					record.x !== undefined ||
					record.y !== undefined ||
					record.z !== undefined,
				{ message: "at least one of x/y/z must be present" },
			),
	}),
	z.strictObject({
		type: z.literal("motion/remove-camera-keyframe"),
		cameraRigId: z.string().min(1),
		property: z.enum([...CAMERA_RIG_ANIMATABLE_PROPERTIES]),
		frame,
	}),
	z.strictObject({
		type: z.literal("motion/remove-camera-track"),
		cameraRigId: z.string().min(1),
		property: z.enum([...CAMERA_RIG_ANIMATABLE_PROPERTIES]),
	}),
	z.strictObject({
		type: z.literal("motion/remove-camera-rig-tracks"),
		cameraRigId: z.string().min(1),
	}),
	z.strictObject({
		type: z.literal("motion/retime-camera-keyframe"),
		trackId,
		fromFrame: frame,
		toFrame: frame,
	}),
	z.strictObject({
		type: z.literal("motion/set-camera-keyframe-easing"),
		trackId,
		frame,
		easing: keyframeEasing,
	}),
	z.strictObject({
		type: z.literal("motion/apply-text-animator"),
		nodeId,
		preset: z.enum([...TEXT_ANIMATOR_PRESET_IDS]),
		target: z.enum(["live-text", "outline-group"]).optional(),
		durationFrames: finite.optional(),
	}),
	z.strictObject({
		type: z.literal("motion/remove-text-animator"),
		nodeId,
	}),
	z.strictObject({
		type: z.literal("motion/set-text-animator-enabled"),
		nodeId,
		enabled: z.boolean(),
	}),
	z.strictObject({
		type: z.literal("motion/apply-clip-timing-template"),
		clipId: z.string().min(1),
		templateId: z.enum(MOTION_TIMING_TEMPLATES.map((template) => template.id)),
	}),
	z.strictObject({
		type: z.literal("motion/create-clip"),
		clip: z.strictObject({
			id: z.string().min(1).optional(),
			name: z.string(),
			startFrame: frame,
			durationFrames: finite,
			trackIds: z.array(trackId).max(256).optional(),
		}),
	}),
	z.strictObject({
		type: z.literal("motion/rename-clip"),
		clipId: z.string().min(1),
		name: z.string(),
	}),
	z.strictObject({
		type: z.literal("motion/trim-clip"),
		clipId: z.string().min(1),
		startFrame: frame,
		durationFrames: finite,
	}),
	z.strictObject({
		type: z.literal("motion/assign-clip-tracks"),
		clipId: z.string().min(1),
		trackIds: z.array(trackId).max(256),
	}),
	z.strictObject({
		type: z.literal("motion/reorder-clip"),
		clipId: z.string().min(1),
		toIndex: z.int(),
	}),
	z.strictObject({
		type: z.literal("motion/delete-clip"),
		clipId: z.string().min(1),
	}),
	z.strictObject({
		type: z.literal("motion/propagate-to-instances"),
		sourceNodeIds: z.array(nodeId).max(256).optional(),
	}),
]);

/**
 * The provider's forced tool output. `motionCommands` may be empty when the
 * request cannot be served by the accepted command set; `unsupported` then carries
 * the honest reason so the client surfaces a typed unsupported issue instead of a
 * silent downgrade. `rationale` is an optional short human-readable plan summary.
 *
 * `clarification` (Creator 2, C2-L5, design §4.2) is the ONE blocking question the
 * model may ask when two interpretations would change the visible result or destroy
 * existing work: it returns empty `motionCommands` + `clarification.question`. This
 * is a purely additive optional field on the SAME structural narrow — it widens no
 * command kind (the accepted union {@link agentMotionCommandSchema} is untouched, so
 * the DEC-17 envelope stands) and remains inline-able for the tool JSON schema.
 */
export const motionPlanSchema = z.strictObject({
	motionCommands: z
		.array(agentMotionCommandSchema)
		.max(MAX_MOTION_COMMANDS_PER_PLAN),
	unsupported: z
		.strictObject({ reason: z.string().min(1).max(600) })
		.optional(),
	clarification: z
		.strictObject({ question: z.string().min(1).max(600) })
		.optional(),
	rationale: z.string().max(1200).optional(),
});

export type AgentMotionPlanPayload = z.infer<typeof motionPlanSchema>;

/**
 * Bounded planning-context projection built by the browser and forwarded to the
 * provider. Every collection is size-capped so a large document cannot inflate the
 * request; the Worker validates the shape but never trusts it semantically (it has
 * no live document). Contains no raw path/paint source — ids, counts, names, and
 * numeric timing only.
 */
export const planningContextProjectionSchema = z.strictObject({
	document: z.strictObject({
		name: z.string().max(200),
		artboardCount: z.int().nonnegative(),
		layerCount: z.int().nonnegative(),
		nodeCount: z.int().nonnegative(),
		motionTrackCount: z.int().nonnegative(),
		fps: finite,
		durationFrames: finite,
	}),
	artboard: z.strictObject({
		id: z.string().min(1),
		name: z.string().max(200),
		width: finite,
		height: finite,
		fps: finite,
		durationFrames: finite,
		cameraSpacePolicy: z.string().max(64).optional(),
	}),
	selection: z.strictObject({
		nodeIds: z.array(z.string().min(1)).max(200),
		primaryNodeId: z.string().min(1).optional(),
	}),
	nodes: z
		.array(
			z.strictObject({
				id: z.string().min(1),
				name: z.string().max(200),
				kind: z.string().max(64),
			}),
		)
		.max(400),
	tracks: z
		.array(
			z.strictObject({
				id: z.string().min(1),
				targetNodeId: z.string().min(1).optional(),
				property: z.string().max(64),
				keyframeCount: z.int().nonnegative(),
				maxKeyframeFrame: finite,
			}),
		)
		.max(200),
	cameras: z.strictObject({
		count: z.int().nonnegative(),
		activeRigIds: z.array(z.string().min(1)).max(50),
		rigs: z
			.array(
				z.strictObject({ id: z.string().min(1), name: z.string().max(200) }),
			)
			.max(50),
	}),
	playheadFrame: finite,
	capabilities: z.strictObject({
		motionCommandTypes: z.array(z.string().max(80)).max(100),
		timingTemplateIds: z.array(z.string().max(80)).max(100),
	}),
});

export type PlanningContextProjection = z.infer<
	typeof planningContextProjectionSchema
>;

/** Repair context attached on the single bounded re-send (client-owned). */
export const planRepairContextSchema = z.strictObject({
	previousIssues: z.array(z.string().max(600)).max(32),
});

/** Caps on the follow-up conversation summary (client-owned, Worker-bounded). */
export const MAX_CONVERSATION_INTENTS = 16;
export const MAX_CONVERSATION_TRACKS = 80;
export const MAX_CONVERSATION_KEYFRAMES = 128;
/** One fewer than the keyframe cap: N keys yield at most N−1 inter-key segments. */
export const MAX_CONVERSATION_SEGMENTS = 127;

/**
 * Compact, transient conversation summary carried on a FOLLOW-UP planning request
 * (Creator 2, C2-L4). It is NOT durable state and NOT a diff engine: it gives the
 * provider (a) the user's prior accepted intents and (b) the CURRENT — i.e.
 * post-manual-edit — keyframe state of the tracks earlier plans touched, so the
 * model computes a bounded DELTA against reality instead of replaying its own
 * previous proposal. Every collection is capped so a long session cannot inflate
 * the request; values are scalar-only (snapshot tracks are out of C2 scope).
 */
export const planConversationSummarySchema = z.strictObject({
	priorIntents: z
		.array(z.string().min(1).max(2000))
		.max(MAX_CONVERSATION_INTENTS),
	affectedTracks: z
		.array(
			z.strictObject({
				trackId,
				targetNodeId: z.string().min(1).optional(),
				property: z.string().max(64),
				keyframes: z
					.array(
						z.strictObject({
							frame,
							value: finite.optional(),
							easing: z.string().max(64).optional(),
						}),
					)
					.max(MAX_CONVERSATION_KEYFRAMES),
				/**
				 * Ordered inter-key segment labels (Creator 2, C2-L5) so the provider can
				 * resolve relative follow-up references ("the final settle", "the last
				 * bump") unambiguously. Each segment spans one pair of consecutive
				 * keyframes; the LAST carries `final:true`. Frame spans + ordering + a
				 * final marker only — NO semantic role name (rise/overshoot/settle cannot
				 * be inferred from numbers; that stays the model's reading).
				 */
				segments: z
					.array(
						z.strictObject({
							index: z.int().nonnegative(),
							fromFrame: frame,
							toFrame: frame,
							final: z.literal(true).optional(),
						}),
					)
					.max(MAX_CONVERSATION_SEGMENTS)
					.optional(),
			}),
		)
		.max(MAX_CONVERSATION_TRACKS),
});

export type PlanConversationSummary = z.infer<
	typeof planConversationSummarySchema
>;

/** Request envelope for `POST /api/agent/plan`. Stateless: no session id. */
export const agentPlanRequestSchema = z.strictObject({
	planId: z
		.string()
		.min(8)
		.max(128)
		.regex(/^[A-Za-z0-9._:-]+$/),
	intent: z.string().trim().min(1).max(2000),
	projection: planningContextProjectionSchema,
	contextRevision: z.string().min(1).max(200),
	repair: planRepairContextSchema.optional(),
	conversation: planConversationSummarySchema.optional(),
});

export type AgentPlanRequestBody = z.infer<typeof agentPlanRequestSchema>;

/** Result of validating an already-JSON-parsed request body. */
export type ParseAgentPlanRequestResult =
	| { readonly ok: true; readonly body: AgentPlanRequestBody }
	| { readonly ok: false; readonly issues: readonly string[] };

const zodIssues = (error: z.ZodError): readonly string[] =>
	error.issues.map((issue) => {
		const path = issue.path.join(".");
		return path ? `${path}: ${issue.message}` : issue.message;
	});

/** Validates the request envelope; typed failure instead of a throw. */
export function parseAgentPlanRequest(
	body: unknown,
): ParseAgentPlanRequestResult {
	const parsed = agentPlanRequestSchema.safeParse(body);
	if (parsed.success) return { ok: true, body: parsed.data };
	return { ok: false, issues: zodIssues(parsed.error) };
}

/** Result of the Worker's structural narrow of provider output. */
export type NarrowMotionPlanResult =
	| { readonly ok: true; readonly payload: AgentMotionPlanPayload }
	| { readonly ok: false; readonly issues: readonly string[] };

/**
 * The Worker's only trust boundary on provider output. Structural, not semantic:
 * it proves the payload is a bounded array of known-discriminant, correctly-shaped
 * motion commands (plus the optional `unsupported`/`rationale`) so raw provider
 * JSON never reaches the browser's non-total compile switch. Returns typed issues
 * rather than throwing.
 */
export function narrowMotionPlan(value: unknown): NarrowMotionPlanResult {
	const parsed = motionPlanSchema.safeParse(value);
	if (parsed.success) return { ok: true, payload: parsed.data };
	return { ok: false, issues: zodIssues(parsed.error) };
}

/**
 * Anthropic tool `input_schema` for the forced plan tool. Inlined (no `$ref`)
 * because the tool-use input schema is consumed directly by the provider. Built
 * once at module load from the same zod schema as {@link narrowMotionPlan}.
 */
export const motionPlanToolJsonSchema = z.toJSONSchema(motionPlanSchema, {
	reused: "inline",
});
