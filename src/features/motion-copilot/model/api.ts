import type {
	AgentMotionPlanPayload,
	PlanConversationSummary,
	PlanningContextProjection,
} from "@/entities/agent/model/agent-plan-schema";

/**
 * Client transport for the native motion prompt-to-plan port (Creator 2, C2-L3).
 * Follows the repo convention: discriminated result kinds, an injectable
 * `AbortController`/`signal`, and no throw across the boundary — every failure is a
 * typed result the composer renders as an honest state. Provider credentials never
 * reach here; this only speaks to the same-origin Worker route.
 */

export const AGENT_PLAN_ENDPOINT = "/api/agent/plan" as const;

export type MotionPlanRequestInput = {
	readonly planId: string;
	readonly intent: string;
	readonly projection: PlanningContextProjection;
	readonly contextRevision: string;
	/** Prior browser-side compile issues, attached on the one bounded repair re-send. */
	readonly repairIssues?: readonly string[];
	/** Compact follow-up conversation summary (prior intents + current track state). */
	readonly conversation?: PlanConversationSummary;
	readonly signal?: AbortSignal;
};

/**
 * Discriminated transport outcome. `ok` carries the structurally-validated
 * candidate the Worker returned (the browser still runs semantic validation before
 * apply). Every other kind is an honest non-mutating state; the document is never
 * touched on a non-`ok` result.
 */
export type MotionPlanTransportResult =
	| {
			readonly kind: "ok";
			readonly plan: AgentMotionPlanPayload;
			readonly remaining?: number;
			/** Provider-reaching calls the Worker made (1, or 2 after a C2-L5 auto-retry). */
			readonly providerAttempts?: number;
	  }
	| { readonly kind: "unauthenticated" }
	| { readonly kind: "disabled" }
	/** Signed in but without an active paid Creator entitlement (C2-R2). */
	| { readonly kind: "plan_required" }
	| {
			readonly kind: "quota_exceeded";
			readonly limit?: number;
			/** Which quota window tripped (C2-R3), for an honest per-window message. */
			readonly window?: "day" | "month";
	  }
	| { readonly kind: "invalid"; readonly issues: readonly string[] }
	| {
			readonly kind: "provider_failure";
			readonly message: string;
			readonly providerAttempts?: number;
	  }
	| { readonly kind: "aborted" };

const numberOrUndefined = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

const isMotionPlanPayload = (
	value: unknown,
): value is AgentMotionPlanPayload => {
	if (!value || typeof value !== "object") return false;
	const commands = (value as { readonly motionCommands?: unknown })
		.motionCommands;
	return Array.isArray(commands);
};

/**
 * Sends one planning request to the Worker and maps the response to a typed
 * result. `credentials: "same-origin"` carries the auth cookie; the caller owns
 * the `AbortController` and passes its `signal` for cancellation and retry.
 */
export async function requestMotionPlan(
	input: MotionPlanRequestInput,
): Promise<MotionPlanTransportResult> {
	let response: Response;
	try {
		response = await fetch(AGENT_PLAN_ENDPOINT, {
			method: "POST",
			credentials: "same-origin",
			headers: {
				"content-type": "application/json",
				accept: "application/json",
			},
			body: JSON.stringify({
				planId: input.planId,
				intent: input.intent,
				projection: input.projection,
				contextRevision: input.contextRevision,
				...(input.repairIssues && input.repairIssues.length > 0
					? { repair: { previousIssues: [...input.repairIssues] } }
					: {}),
				...(input.conversation ? { conversation: input.conversation } : {}),
			}),
			signal: input.signal,
		});
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			return { kind: "aborted" };
		}
		return {
			kind: "provider_failure",
			message: "The planning service could not be reached.",
		};
	}

	if (response.status === 401) return { kind: "unauthenticated" };
	if (response.status === 404) return { kind: "disabled" };

	let body: unknown = null;
	try {
		body = await response.json();
	} catch {
		body = null;
	}

	if (
		response.status === 403 &&
		(body as { readonly error?: unknown })?.error === "agent_plan_plan_required"
	) {
		return { kind: "plan_required" };
	}
	if (response.status === 429) {
		const limit = (body as { readonly limit?: unknown })?.limit;
		const window = (body as { readonly window?: unknown })?.window;
		return {
			kind: "quota_exceeded",
			...(typeof limit === "number" ? { limit } : {}),
			...(window === "day" || window === "month" ? { window } : {}),
		};
	}
	if (response.status === 400) {
		const issues = (body as { readonly issues?: unknown })?.issues;
		return {
			kind: "invalid",
			issues: Array.isArray(issues) ? issues.map(String) : [],
		};
	}
	const providerAttempts = numberOrUndefined(
		(body as { readonly providerAttempts?: unknown })?.providerAttempts,
	);

	if (!response.ok) {
		return {
			kind: "provider_failure",
			message: "The motion plan could not be generated. Try again.",
			...(providerAttempts !== undefined ? { providerAttempts } : {}),
		};
	}

	const plan = (body as { readonly plan?: unknown })?.plan;
	if (!isMotionPlanPayload(plan)) {
		return {
			kind: "provider_failure",
			message: "The planning service returned an unexpected response.",
			...(providerAttempts !== undefined ? { providerAttempts } : {}),
		};
	}
	const remaining = numberOrUndefined(
		(body as { readonly remaining?: unknown })?.remaining,
	);
	return {
		kind: "ok",
		plan,
		...(remaining !== undefined ? { remaining } : {}),
		...(providerAttempts !== undefined ? { providerAttempts } : {}),
	};
}
