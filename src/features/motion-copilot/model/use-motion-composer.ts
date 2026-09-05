import { useCallback, useRef, useState } from "react";

import { useMotionCopilotPlanSession } from "@/entities/agent/model/plan-session";
import type { AgentCommandPlanRequest } from "@/entities/agent/model/types";
import { requestMotionPlan } from "./api";
import {
	buildConversationSummary,
	buildPlanningContextProjection,
	type ComposerSelectionContext,
} from "./planning-context";

/**
 * The native prompt composer workflow over the C2-L3 transport. Owns the prompt
 * text, an honest planning state machine, and an `AbortController` for cancel and
 * one bounded repair re-send. It never imports `features/agent`: when the Worker
 * returns a candidate, the hook hands the built {@link AgentCommandPlanRequest} to
 * the injected `onPlanReady`, and the widget (which may compose both features)
 * runs `validateAgentCommandPlan` + records the proposal into the Loop 2 panel.
 * No document write happens here on any path.
 */

export type MotionComposerStatus =
	| { readonly kind: "idle" }
	| { readonly kind: "planning" }
	| { readonly kind: "unsupported"; readonly reason: string }
	/**
	 * The provider asked ONE blocking question (design §4.2, C2-L5): two readings
	 * would change the visible result or destroy existing work. No document write;
	 * the user answers by refining the prompt and re-submitting.
	 */
	| { readonly kind: "clarification"; readonly question: string }
	| {
			readonly kind: "quota_exceeded";
			readonly limit?: number;
			readonly window?: "day" | "month";
	  }
	| { readonly kind: "unauthenticated" }
	/** Signed in but without an active paid Creator entitlement (C2-R2). */
	| { readonly kind: "plan_required" }
	| { readonly kind: "disabled" }
	| { readonly kind: "invalid"; readonly issues: readonly string[] }
	| { readonly kind: "provider_unavailable"; readonly message: string }
	| { readonly kind: "no_context" };

export type MotionComposerDeps = {
	/** Live selection + playhead, read by the widget from the features it composes. */
	readonly getSelectionContext: () => ComposerSelectionContext;
	/**
	 * Hands a validated-candidate plan to the widget for semantic validation and
	 * Loop 2 recording. `isRepair` marks the single bounded repair re-send.
	 * `contextRevision` is the revision the projection was BUILT against — the
	 * widget stamps it onto the plan session so a document change during the
	 * provider round-trip is caught as staleness (C2-L4).
	 */
	readonly onPlanReady: (
		request: AgentCommandPlanRequest,
		meta: {
			readonly rationale?: string;
			readonly isRepair: boolean;
			readonly contextRevision: string;
		},
	) => void;
};

export type MotionComposerSubmitOptions = {
	/** Prior compile issues to attach; presence marks this as the bounded repair round. */
	readonly repairIssues?: readonly string[];
	/**
	 * Replan with an explicit intent instead of the current prompt text (C2-L4
	 * stale-card Replan): re-sends the SAME intent against a FRESH projection. Also
	 * mirrored into the prompt box so the composer reflects what is being planned.
	 */
	readonly intentOverride?: string;
};

export type MotionComposer = {
	readonly prompt: string;
	readonly setPrompt: (value: string) => void;
	readonly status: MotionComposerStatus;
	readonly remaining: number | null;
	readonly submit: (options?: MotionComposerSubmitOptions) => void;
	readonly cancel: () => void;
	/** Clears a terminal status back to idle without touching the prompt text. */
	readonly dismiss: () => void;
};

const newPlanId = (): string => `plan-${crypto.randomUUID()}`;

export function useMotionComposer(deps: MotionComposerDeps): MotionComposer {
	const [prompt, setPrompt] = useState("");
	const [status, setStatus] = useState<MotionComposerStatus>({ kind: "idle" });
	const [remaining, setRemaining] = useState<number | null>(null);
	const controllerRef = useRef<AbortController | null>(null);
	// Monotonic generation so a late response from a superseded/aborted request is
	// ignored — the transport never throws, so this is the staleness guard.
	const generationRef = useRef(0);

	const cancel = useCallback(() => {
		generationRef.current += 1;
		controllerRef.current?.abort();
		controllerRef.current = null;
		setStatus({ kind: "idle" });
	}, []);

	const dismiss = useCallback(() => {
		setStatus({ kind: "idle" });
	}, []);

	const submit = useCallback(
		(options?: MotionComposerSubmitOptions) => {
			const intent = (options?.intentOverride ?? prompt).trim();
			if (intent.length === 0) return;
			// Reflect a replan's intent in the prompt box so the surface is honest
			// about what it is planning.
			if (options?.intentOverride !== undefined) setPrompt(intent);

			const built = buildPlanningContextProjection(deps.getSelectionContext());
			if (!built) {
				setStatus({ kind: "no_context" });
				return;
			}

			controllerRef.current?.abort();
			const controller = new AbortController();
			controllerRef.current = controller;
			generationRef.current += 1;
			const generation = generationRef.current;
			const isRepair = (options?.repairIssues?.length ?? 0) > 0;
			const planId = newPlanId();
			setStatus({ kind: "planning" });

			// Follow-up: carry the accepted-delta thread so the provider computes a
			// bounded DELTA against the CURRENT document (including manual Graph edits),
			// never a replay of the original proposal. Empty thread → undefined → the
			// first-turn request behaves exactly as C2-L3.
			const conversation = buildConversationSummary(
				useMotionCopilotPlanSession.getState().history,
			);

			void requestMotionPlan({
				planId,
				intent,
				projection: built.projection,
				contextRevision: built.contextRevision,
				repairIssues: options?.repairIssues,
				...(conversation ? { conversation } : {}),
				signal: controller.signal,
			}).then((result) => {
				if (generation !== generationRef.current) return; // superseded/cancelled
				controllerRef.current = null;

				if (result.kind === "aborted") return;
				if (result.kind === "ok" && typeof result.remaining === "number") {
					setRemaining(result.remaining);
				}

				switch (result.kind) {
					case "ok": {
						const commands = result.plan.motionCommands;
						if (commands.length === 0) {
							// A blocking question is more specific than "unsupported": surface it
							// first (design §4.2). The provider returns empty commands + a
							// clarification question when two readings would change the result.
							if (result.plan.clarification) {
								setStatus({
									kind: "clarification",
									question: result.plan.clarification.question,
								});
								return;
							}
							setStatus({
								kind: "unsupported",
								reason:
									result.plan.unsupported?.reason ??
									"This request can't be expressed as native motion commands yet.",
							});
							return;
						}
						setStatus({ kind: "idle" });
						deps.onPlanReady(
							{ planId, intent, motionCommands: commands },
							{
								rationale: result.plan.rationale,
								isRepair,
								contextRevision: built.contextRevision,
							},
						);
						return;
					}
					case "unauthenticated":
						setStatus({ kind: "unauthenticated" });
						return;
					case "plan_required":
						setStatus({ kind: "plan_required" });
						return;
					case "disabled":
						setStatus({ kind: "disabled" });
						return;
					case "quota_exceeded":
						setStatus({
							kind: "quota_exceeded",
							limit: result.limit,
							window: result.window,
						});
						return;
					case "invalid":
						setStatus({ kind: "invalid", issues: result.issues });
						return;
					case "provider_failure":
						setStatus({
							kind: "provider_unavailable",
							message: result.message,
						});
						return;
				}
			});
		},
		[prompt, deps],
	);

	return { prompt, setPrompt, status, remaining, submit, cancel, dismiss };
}
