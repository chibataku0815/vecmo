export type GestureState<TIdentity, TCoalescingIdentity> = {
	readonly identity: TIdentity;
	readonly coalescingIdentity: TCoalescingIdentity;
	readonly phase: "active" | "committed" | "aborted";
	readonly updateCount: number;
};

export type GestureTransition<TIdentity, TCoalescingIdentity> =
	| {
			readonly accepted: true;
			readonly state: GestureState<TIdentity, TCoalescingIdentity>;
	  }
	| {
			readonly accepted: false;
			readonly reason: "stale" | "already-terminal";
			readonly state: GestureState<TIdentity, TCoalescingIdentity>;
	  };

export function beginGesture<TIdentity, TCoalescingIdentity>(
	identity: TIdentity,
	coalescingIdentity: TCoalescingIdentity,
): GestureState<TIdentity, TCoalescingIdentity> {
	return { identity, coalescingIdentity, phase: "active", updateCount: 0 };
}

const transition = <TIdentity, TCoalescingIdentity>(
	state: GestureState<TIdentity, TCoalescingIdentity>,
	identity: TIdentity,
	phase: GestureState<TIdentity, TCoalescingIdentity>["phase"],
): GestureTransition<TIdentity, TCoalescingIdentity> => {
	if (!Object.is(state.identity, identity)) {
		return { accepted: false, reason: "stale", state };
	}
	if (state.phase !== "active") {
		return { accepted: false, reason: "already-terminal", state };
	}
	return {
		accepted: true,
		state: {
			...state,
			phase,
			updateCount:
				phase === "active" ? state.updateCount + 1 : state.updateCount,
		},
	};
};

export function updateGesture<TIdentity, TCoalescingIdentity>(
	state: GestureState<TIdentity, TCoalescingIdentity>,
	identity: TIdentity,
): GestureTransition<TIdentity, TCoalescingIdentity> {
	return transition(state, identity, "active");
}

export function commitGesture<TIdentity, TCoalescingIdentity>(
	state: GestureState<TIdentity, TCoalescingIdentity>,
	identity: TIdentity,
): GestureTransition<TIdentity, TCoalescingIdentity> {
	return transition(state, identity, "committed");
}

export function abortGesture<TIdentity, TCoalescingIdentity>(
	state: GestureState<TIdentity, TCoalescingIdentity>,
	identity: TIdentity,
): GestureTransition<TIdentity, TCoalescingIdentity> {
	return transition(state, identity, "aborted");
}
