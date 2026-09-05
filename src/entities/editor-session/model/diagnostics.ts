export type EditorDiagnosticEvent = {
	readonly at: string;
	readonly event:
		| "session-created"
		| "session-rebound"
		| "session-relinked"
		| "working-copy-restored"
		| "working-copy-fallback"
		| "writer-mode-changed";
	readonly workingCopyId?: string;
	readonly projectId?: string | null;
	readonly mode?: string;
};

const MAX_EVENTS = 80;
const events: EditorDiagnosticEvent[] = [];

/** Records identity and lifecycle metadata only; authored content is excluded. */
export const recordEditorDiagnostic = (
	event: Omit<EditorDiagnosticEvent, "at">,
): void => {
	events.push({ ...event, at: new Date().toISOString() });
	if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
};

/** Returns an immutable snapshot suitable for a support report. */
export const getEditorDiagnostics = (): readonly EditorDiagnosticEvent[] =>
	events.map((event) => ({ ...event }));

Reflect.set(globalThis, "__vmaEditorDiagnostics", getEditorDiagnostics);
