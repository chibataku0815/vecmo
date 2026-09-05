export type HistoryAvailability = {
	readonly canUndo: boolean;
	readonly canRedo: boolean;
};

export type HistoryPort = {
	readonly read: () => HistoryAvailability;
	readonly undo: () => void;
	readonly redo: () => void;
	readonly subscribe?: (listener: () => void) => () => void;
};
