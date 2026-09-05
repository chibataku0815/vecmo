import { create } from "zustand";
import type { GestureTransaction } from "@/entities/scene/model/gesture-transaction";
import type { Bounds } from "@/entities/scene/model/types";

export type TextEditSessionSource = "new" | "existing";

/**
 * Transient canvas text edit draft. The scene keeps only committed text; this
 * session lets the overlay commit or discard drafts without mutating the scene
 * until the user exits editing.
 */
export type TextEditSession = {
	readonly nodeId: string;
	readonly originalText: string;
	readonly draftText: string;
	readonly source: TextEditSessionSource;
	readonly transaction?: GestureTransaction;
};

export type TextCreationPreview = {
	readonly artboardId: string;
	readonly bounds: Bounds;
};

type TextEditStore = {
	readonly session: TextEditSession | null;
	readonly creationPreview: TextCreationPreview | null;
	readonly start: (session: TextEditSession) => void;
	readonly setDraft: (text: string) => void;
	readonly setCreationPreview: (preview: TextCreationPreview | null) => void;
	readonly clear: () => void;
};

const EXTERNAL_COMMIT_POINTER_TTL_MS = 750;

type ExternalCommitPointer = {
	readonly pointerId: number;
	readonly timeStamp: number;
	readonly expiresAt: number;
};

const externalCommitPointers = new WeakSet<PointerEvent>();
let externalCommitPointer: ExternalCommitPointer | null = null;

const currentTime = (): number => globalThis.performance?.now?.() ?? Date.now();

/**
 * Marks the native pointer event that committed an active text edit from outside
 * the textarea. The Type tool consumes the same event later in bubbling phase so
 * one click cannot both finish editing and create another text node.
 */
export function markExternalTextCommitPointer(event: PointerEvent): void {
	externalCommitPointers.add(event);
	externalCommitPointer = {
		expiresAt: currentTime() + EXTERNAL_COMMIT_POINTER_TTL_MS,
		pointerId: event.pointerId,
		timeStamp: event.timeStamp,
	};
}

/**
 * Returns whether this pointer event was already used to leave text editing.
 * The result is destructive so repeated handler paths cannot accidentally keep
 * suppressing unrelated work.
 */
export function consumeExternalTextCommitPointer(event: PointerEvent): boolean {
	if (externalCommitPointers.has(event)) {
		externalCommitPointers.delete(event);
		externalCommitPointer = null;
		return true;
	}
	const pointer = externalCommitPointer;
	if (!pointer) return false;
	if (currentTime() > pointer.expiresAt) {
		externalCommitPointer = null;
		return false;
	}
	if (
		pointer.pointerId !== event.pointerId ||
		pointer.timeStamp !== event.timeStamp
	) {
		return false;
	}
	externalCommitPointer = null;
	return true;
}

/** Feature-local store for in-place canvas text editing state. */
export const useTextEditStore = create<TextEditStore>()((set) => ({
	session: null,
	creationPreview: null,
	start: (session) => set({ session }),
	setDraft: (text) =>
		set((state) =>
			state.session
				? { session: { ...state.session, draftText: text } }
				: state,
		),
	setCreationPreview: (creationPreview) => set({ creationPreview }),
	clear: () => set({ creationPreview: null, session: null }),
}));
