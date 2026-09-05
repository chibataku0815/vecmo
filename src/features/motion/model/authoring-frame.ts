import { useEffect, useState } from "react";
import { useTransportStore } from "./transport-store";

/**
 * Reactive exact frame while paused/scrubbing, frozen during ordinary playback.
 * Large authoring surfaces use this projection; compact playhead/readout nodes
 * continue subscribing to the live transport frame directly.
 */
export function useAuthoringTransportFrame(): number {
	const [frame, setFrame] = useState(
		() => useTransportStore.getState().currentFrame,
	);
	useEffect(
		() =>
			useTransportStore.subscribe((state, previous) => {
				if (state.isPlaying) return;
				if (
					state.currentFrame !== previous.currentFrame ||
					state.isPlaying !== previous.isPlaying
				) {
					setFrame(state.currentFrame);
				}
			}),
		[],
	);
	return frame;
}
