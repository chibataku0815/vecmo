import { useMemo } from "react";
import { createEditorVisualReviewSession } from "../model/editor-capture";
import { VisualReviewDetachedWorkspace } from "./VisualReviewWorkspace";

/** Detached editor composition that freezes its source once per open session. */
export function EditorVisualReviewWorkspace({
	onClose,
}: {
	readonly onClose: () => void;
}) {
	const session = useMemo(() => createEditorVisualReviewSession(), []);
	return (
		<VisualReviewDetachedWorkspace
			open
			plan={session?.plan}
			captureAdapter={session?.captureAdapter}
			onClose={onClose}
		/>
	);
}
