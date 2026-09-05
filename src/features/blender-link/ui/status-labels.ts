import type { BlenderLinkState } from "../model/workflow";

/** Exactly the state table's own vocabulary; nothing here reinterprets a state. */
export const blenderLinkStateLabel = (state: BlenderLinkState): string => {
	switch (state) {
		case "disconnected":
			return "Disconnected";
		case "relink-required":
			return "Relink required";
		case "inspecting":
			return "Inspecting";
		case "stale":
			return "Stale";
		case "building":
			return "Building";
		case "ready":
			return "Ready";
		case "failed":
			return "Failed";
	}
};

export const shortDigest = (digest: string | undefined): string => {
	if (!digest) return "—";
	const normalized = digest.replace(/^sha256:/u, "");
	return normalized.length <= 12
		? normalized
		: `${normalized.slice(0, 8)}…${normalized.slice(-4)}`;
};
