import {
	type ActionAvailability,
	type ActionDefinition,
	type ActionGroup,
	type ActionGroupResult,
	type ActionListItem,
	type ActionRegistry,
	actionAvailability,
	actionEnabled,
	actionInputCandidates,
	actionShortcuts,
	createActionRegistry as createKernelActionRegistry,
	executeAction,
	executeActionItem,
	groupActionItems,
	type InputResolution,
	resolveInput,
	searchActionGroups as searchKernelActionGroups,
	searchActionItems as searchKernelActionItems,
} from "@motion-surface/editor-kernel";
import {
	keyboardInputSnapshot,
	localShortcutSignatures,
	resolveShortcutPlatform,
	type ShortcutKeyboardEvent,
	type ShortcutPlatform,
	vecmoShortcutBinding,
} from "./shortcuts";

export type {
	ActionAvailability,
	ActionDefinition,
	ActionGroup,
	ActionGroupResult,
	ActionListItem,
	ActionRegistry,
};

export {
	actionAvailability,
	actionEnabled,
	actionShortcuts,
	executeAction,
	executeActionItem,
	groupActionItems,
};

/** Binds Vecmo's explicit physical fallbacks before Kernel collision checks. */
export function createActionRegistry<
	TContext,
	TRuntime,
	TAction extends ActionDefinition<TContext, TRuntime>,
>(actions: readonly TAction[]): ActionRegistry<TContext, TRuntime, TAction> {
	return createKernelActionRegistry(
		actions.map(
			(action) =>
				({
					...action,
					...(action.shortcut
						? { shortcut: vecmoShortcutBinding(action.shortcut) }
						: {}),
					...(action.shortcutAliases
						? {
								shortcutAliases:
									action.shortcutAliases.map(vecmoShortcutBinding),
							}
						: {}),
				}) as TAction,
		),
	);
}

/** Preserves shortcut-label palette search through an injected browser platform. */
export function searchActionItems<
	TContext,
	TRuntime,
	TAction extends ActionDefinition<TContext, TRuntime>,
>(
	actions: readonly TAction[],
	context: TContext,
	query: string,
	platform: ShortcutPlatform = resolveShortcutPlatform(),
): readonly ActionListItem<TContext, TRuntime, TAction>[] {
	return searchKernelActionItems(actions, context, query, platform);
}

export function searchActionGroups<
	TContext,
	TRuntime,
	TAction extends ActionDefinition<TContext, TRuntime>,
>(
	actions: readonly TAction[],
	context: TContext,
	query: string,
	platform: ShortcutPlatform = resolveShortcutPlatform(),
): readonly ActionGroupResult<TContext, TRuntime, TAction>[] {
	return searchKernelActionGroups(actions, context, query, platform);
}

export type RegistryInputResolution<TAction> = InputResolution<TAction>;

/**
 * Vecmo first-consumer adapter for the Kernel input resolver. DOM inspection is
 * completed before the structural snapshot crosses into the shared package.
 */
export function resolveRegistryInput<
	TContext,
	TRuntime,
	TAction extends ActionDefinition<TContext, TRuntime>,
>(
	registry: ActionRegistry<TContext, TRuntime, TAction>,
	event: ShortcutKeyboardEvent,
	context: TContext,
	options: { readonly modalRootActionIds?: readonly TAction["id"][] } = {},
): RegistryInputResolution<TAction> {
	const candidates = (actions: readonly TAction[]) =>
		actionInputCandidates<TContext, TRuntime, TAction, TAction>(
			actions,
			context,
			(action) => action,
			vecmoShortcutBinding,
		);
	const global = {
		id: "editor-global",
		depth: 0,
		eligible: true,
		actions: candidates(registry.actions),
	};
	const declaredLocalShortcuts = localShortcutSignatures(event);
	const locals =
		declaredLocalShortcuts.length > 0
			? [
					{
						id: "browser-local",
						depth: 1,
						eligible: true,
						actions: [],
						claimedShortcutSignatures: declaredLocalShortcuts,
					},
				]
			: [];
	const modalActionIds = options.modalRootActionIds;
	const modal = modalActionIds
		? {
				id: "top-modal",
				locals: [],
				root: {
					id: "top-modal-root",
					depth: 0,
					eligible: true,
					actions: candidates(
						modalActionIds.flatMap((id) => {
							const action = registry.byId.get(id);
							return action ? [action] : [];
						}),
					),
				},
			}
		: undefined;
	return resolveInput<TAction>({
		input: keyboardInputSnapshot(event),
		global,
		locals,
		...(modal ? { modal } : {}),
	});
}
