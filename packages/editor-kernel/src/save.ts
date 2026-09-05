export type RevisionedSaveState<TToken, TAttemptId> = {
	readonly currentToken: TToken;
	readonly cleanToken: TToken;
	readonly status: "clean" | "dirty" | "saving";
	readonly attempt: {
		readonly id: TAttemptId;
		readonly token: TToken;
	} | null;
};

export type RevisionedSaveTransition<TToken, TAttemptId> =
	| {
			readonly accepted: true;
			readonly state: RevisionedSaveState<TToken, TAttemptId>;
	  }
	| {
			readonly accepted: false;
			readonly reason: "stale-attempt";
			readonly state: RevisionedSaveState<TToken, TAttemptId>;
	  };

export function createRevisionedSaveState<TToken, TAttemptId>(
	token: TToken,
): RevisionedSaveState<TToken, TAttemptId> {
	return {
		currentToken: token,
		cleanToken: token,
		status: "clean",
		attempt: null,
	};
}

export function markRevisionChanged<TToken, TAttemptId>(
	state: RevisionedSaveState<TToken, TAttemptId>,
	token: TToken,
): RevisionedSaveState<TToken, TAttemptId> {
	return {
		...state,
		currentToken: token,
		status: state.attempt
			? "saving"
			: Object.is(token, state.cleanToken)
				? "clean"
				: "dirty",
	};
}

export function beginRevisionedSave<TToken, TAttemptId>(
	state: RevisionedSaveState<TToken, TAttemptId>,
	attemptId: TAttemptId,
): RevisionedSaveState<TToken, TAttemptId> {
	return {
		...state,
		status: "saving",
		attempt: { id: attemptId, token: state.currentToken },
	};
}

/** Resolves clean only when the saved token is still the caller's current token. */
export function resolveRevisionedSave<TToken, TAttemptId>(
	state: RevisionedSaveState<TToken, TAttemptId>,
	attemptId: TAttemptId,
): RevisionedSaveTransition<TToken, TAttemptId> {
	if (!state.attempt || !Object.is(state.attempt.id, attemptId)) {
		return { accepted: false, reason: "stale-attempt", state };
	}
	const savedToken = state.attempt.token;
	const clean = Object.is(savedToken, state.currentToken);
	return {
		accepted: true,
		state: {
			currentToken: state.currentToken,
			cleanToken: savedToken,
			status: clean ? "clean" : "dirty",
			attempt: null,
		},
	};
}

export function rejectRevisionedSave<TToken, TAttemptId>(
	state: RevisionedSaveState<TToken, TAttemptId>,
	attemptId: TAttemptId,
): RevisionedSaveTransition<TToken, TAttemptId> {
	if (!state.attempt || !Object.is(state.attempt.id, attemptId)) {
		return { accepted: false, reason: "stale-attempt", state };
	}
	return {
		accepted: true,
		state: { ...state, status: "dirty", attempt: null },
	};
}
