export type {
	ActionAvailability,
	ActionDefinition,
	ActionGroup,
	ActionGroupResult,
	ActionListItem,
	ActionRegistry,
	RegistryInputResolution,
} from "./model/registry";
export {
	actionAvailability,
	actionEnabled,
	actionShortcuts,
	createActionRegistry,
	executeAction,
	executeActionItem,
	groupActionItems,
	resolveRegistryInput,
	searchActionGroups,
	searchActionItems,
} from "./model/registry";
export type {
	ActionShortcut,
	NormalizedShortcut,
	ShortcutKeyboardEvent,
	ShortcutModifier,
	ShortcutPlatform,
} from "./model/shortcuts";
export {
	isEditableKeyboardTarget,
	keyboardInputSnapshot,
	localShortcutScopeValue,
	localShortcutSignatures,
	normalizeShortcut,
	normalizeShortcutKey,
	resolveShortcutPlatform,
	shortcutLabel,
	shortcutMatchesEvent,
	shortcutSignature,
	shouldHandleActionShortcut,
} from "./model/shortcuts";
