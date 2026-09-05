import type {
	AgentBridgeErrorMessage,
	AgentBridgeObserveRequest,
	AgentBridgeObserveResult,
	AgentBridgePreviewCaptureRequest,
	AgentBridgePreviewCaptureResult,
	AgentBridgePreviewObserveResult,
	AgentBridgeProjectSaveRequest,
	AgentBridgeProjectSaveResult,
	AgentBridgeRequestMessage,
	AgentBridgeResponseMessage,
	AgentBridgeResponseResult,
} from "@/entities/agent/model/bridge-protocol";
import type {
	AgentCommandPlanApplyRequest,
	AgentCommandPlanApproval,
	AgentCommandPlanRequest,
	AgentCommandPlanResult,
} from "@/entities/agent/model/types";

/**
 * Editor-side handling of a single bridge request. The transport (WebSocket
 * client) owns framing and routing; this function owns the *decision*: a
 * `validate` or `observe` op never mutates and never prompts, while an `apply`
 * op runs a non-mutating review, asks a human to approve through the injected
 * callback, and only then applies through the command bus.
 *
 * Dependencies are injected so the editor wiring binds them to the live
 * `review-apply.ts` functions and the approval banner, while tests bind fakes.
 */
export type AgentBridgeDispatchDeps = {
	readonly validate: (
		request: AgentCommandPlanRequest,
	) => AgentCommandPlanResult;
	readonly apply: (
		request: AgentCommandPlanApplyRequest,
	) => AgentCommandPlanResult;
	readonly requestApproval: (
		review: AgentCommandPlanResult,
		request: AgentCommandPlanRequest,
	) => Promise<AgentCommandPlanApproval>;
	readonly requestProjectSaveApproval?: (
		request: AgentBridgeProjectSaveRequest,
	) => Promise<AgentCommandPlanApproval>;
	readonly saveProject?: (
		request: AgentBridgeProjectSaveRequest,
		approval: AgentCommandPlanApproval,
	) => Promise<AgentBridgeProjectSaveResult>;
	/**
	 * Read-only live-document observation (B2). Always required — unlike
	 * `saveProject`, `observe` has no separate opt-in wiring or approval
	 * surface, so both bridge connections must supply it.
	 */
	readonly observe: (
		request: AgentBridgeObserveRequest,
	) => AgentBridgeObserveResult;
	/**
	 * Read-only native artboard capture (Phase D). Both are optional because the
	 * capability is built and injected from the app layer (it reaches into the
	 * widget capture engine); when absent the ops return a fail-closed
	 * "unavailable" error rather than a silent no-op. Neither prompts for
	 * approval — they never write the document. `observePreview` is a stateless
	 * readiness read; `capturePreview` drives the begin/capture/end session.
	 */
	readonly observePreview?: () => AgentBridgePreviewObserveResult;
	readonly capturePreview?: (
		request: AgentBridgePreviewCaptureRequest,
	) => Promise<AgentBridgePreviewCaptureResult>;
	/**
	 * Optional editor-side notification when an apply is blocked before approval
	 * (an invalid document, or a plan that would itself orphan motion). Without
	 * it the human gets no signal that an agent edit silently bounced.
	 */
	readonly notifyBlocked?: (review: AgentCommandPlanResult) => void;
};

const response = (
	id: string,
	result: AgentBridgeResponseResult,
): AgentBridgeResponseMessage => ({ kind: "response", id, result });

export async function dispatchAgentBridgeRequest(
	message: AgentBridgeRequestMessage,
	deps: AgentBridgeDispatchDeps,
): Promise<AgentBridgeResponseMessage | AgentBridgeErrorMessage> {
	try {
		if (message.op === "save-project") {
			if (!deps.saveProject || !deps.requestProjectSaveApproval) {
				return {
					kind: "error",
					id: message.id,
					code: "agent.project-save-unavailable",
					message: "The live editor did not register a project save handler.",
				};
			}
			const approval = await deps.requestProjectSaveApproval(message.request);
			return response(
				message.id,
				await deps.saveProject(message.request, approval),
			);
		}
		if (message.op === "observe") {
			// Read-only: no store writes, no undo entry, no transaction, no
			// approval prompt — mirrors `validate` below, minus the plan review.
			return response(message.id, deps.observe(message.request));
		}
		if (message.op === "preview-observe") {
			// Read-only capture-readiness read; no approval prompt.
			if (!deps.observePreview) {
				return {
					kind: "error",
					id: message.id,
					code: "agent.preview-capture-unavailable",
					message:
						"The live editor did not register a preview capture capability.",
				};
			}
			return response(message.id, deps.observePreview());
		}
		if (message.op === "preview-capture") {
			// Read-only committed-still capture (begin/capture/end); no approval
			// prompt, no document mutation. The capability owns transport restore.
			if (!deps.capturePreview) {
				return {
					kind: "error",
					id: message.id,
					code: "agent.preview-capture-unavailable",
					message:
						"The live editor did not register a preview capture capability.",
				};
			}
			return response(message.id, await deps.capturePreview(message.request));
		}
		// `validate` and `apply` share one request/result shape (both review an
		// AgentCommandPlanRequest), so they narrow together here — a plain
		// `never`-typed exhaustiveness assertion cannot key off `op` below
		// because this shared-shape member's own discriminant is itself a
		// two-literal union, not a single literal.
		if (message.op === "validate" || message.op === "apply") {
			if (message.op === "validate") {
				return response(message.id, deps.validate(message.request));
			}
			// message.op === "apply": review without mutating first.
			const review = deps.validate(message.request);
			// If the plan can't apply (command errors, nothing to do), return the
			// review with its real blocking issues instead of prompting a human to
			// approve something that would be rejected anyway.
			if (!review.ready) {
				deps.notifyBlocked?.(review);
				return response(message.id, review);
			}
			const approval = await deps.requestApproval(review, message.request);
			return response(message.id, deps.apply({ ...message.request, approval }));
		}
		// Fail closed: every `AgentBridgeOp` member is handled above
		// (save-project, observe, preview-observe, preview-capture, validate,
		// apply). A bridge op added to the union without a matching branch here
		// must return a typed error rather than silently fall through to the
		// mutating `apply` path by default.
		return {
			kind: "error",
			id: message.id,
			code: "agent.bridge-unknown-op",
			message: `Unrecognized bridge op "${message.op}".`,
		};
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return {
			kind: "error",
			id: message.id,
			code: "agent.bridge-dispatch-failed",
			message: detail,
		};
	}
}
