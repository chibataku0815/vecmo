import {
	type Shortcut,
	type ShortcutPlatform,
	shortcutLabel,
	shortcutMatchingSignatures,
	shortcutSignature,
} from "./shortcuts";

export type ActionAvailability =
	| { readonly enabled: true }
	| { readonly enabled: false; readonly reason: string };

export type ActionGroup = {
	readonly id: string;
	readonly label: string;
};

export type ActionShortcutScope =
	| { readonly kind: "editor-global" }
	| { readonly kind: "local"; readonly id: string }
	| { readonly kind: "modal-root"; readonly modalId: string }
	| {
			readonly kind: "modal-local";
			readonly modalId: string;
			readonly id: string;
	  };

export type ActionDefinition<
	TContext,
	TRuntime,
	TId extends string = string,
> = {
	readonly id: TId;
	readonly label: string;
	readonly group: ActionGroup;
	readonly shortcut?: Shortcut;
	readonly shortcutAliases?: readonly Shortcut[];
	readonly shortcutScope?: ActionShortcutScope;
	/**
	 * Explicit opt-in for one shortcut signature legitimately resolving to more than one
	 * action in the same scope (e.g. a px nudge and a grid-cell step both bound to a bare
	 * arrow key, gated by mutually exclusive availability). `createActionRegistry` still
	 * rejects a duplicate signature unless every action that holds it — the ones already
	 * registered and the incoming one — sets this. Runtime dispatch resolves the ambiguity
	 * by taking the first registered sharer whose availability is enabled.
	 */
	readonly sharesShortcut?: boolean;
	readonly allowInEditable?: boolean;
	readonly keywords?: readonly string[];
	readonly availability?: (context: TContext) => ActionAvailability;
	readonly checked?: (context: TContext) => boolean;
	readonly execute: (runtime: TRuntime, context: TContext) => void;
};

export type ActionRegistry<
	TContext,
	TRuntime,
	TAction extends ActionDefinition<TContext, TRuntime>,
> = {
	readonly actions: readonly TAction[];
	readonly byId: ReadonlyMap<TAction["id"], TAction>;
};

export type ActionListItem<
	TContext,
	TRuntime,
	TAction extends ActionDefinition<TContext, TRuntime>,
> = {
	readonly action: TAction;
	readonly availability: ActionAvailability;
	readonly checked: boolean;
};

export type ActionGroupResult<
	TContext,
	TRuntime,
	TAction extends ActionDefinition<TContext, TRuntime>,
> = {
	readonly group: ActionGroup;
	readonly items: readonly ActionListItem<TContext, TRuntime, TAction>[];
};

export type ActionProjection = {
	readonly id: string;
	readonly label: string;
	readonly group: ActionGroup;
	readonly availability: ActionAvailability;
	readonly checked: boolean;
	readonly shortcutLabel: string | null;
	readonly shortcutLabels: readonly string[];
	readonly tooltip: string;
	readonly searchableText: string;
};

const available = { enabled: true } as const satisfies ActionAvailability;
const globalScope = { kind: "editor-global" } as const;

/** Returns every action shortcut with the primary shortcut first. */
export function actionShortcuts(action: {
	readonly shortcut?: Shortcut;
	readonly shortcutAliases?: readonly Shortcut[];
}): readonly Shortcut[] {
	return [
		...(action.shortcut ? [action.shortcut] : []),
		...(action.shortcutAliases ?? []),
	];
}

const scopeSignature = (scope: ActionShortcutScope): string => {
	switch (scope.kind) {
		case "editor-global":
			return scope.kind;
		case "local":
			return `${scope.kind}:${JSON.stringify(scope.id)}`;
		case "modal-root":
			return `${scope.kind}:${JSON.stringify(scope.modalId)}`;
		case "modal-local":
			return `${scope.kind}:${JSON.stringify([scope.modalId, scope.id])}`;
	}
};

/**
 * Builds an immutable registry and rejects ambiguity inside one effective scope — unless
 * every action holding the colliding signature (the existing owner(s) and the incoming
 * action) has set `sharesShortcut`, in which case all of them are kept as sharers in
 * registration order for runtime dispatch to pick between by availability.
 */
export function createActionRegistry<
	TContext,
	TRuntime,
	TAction extends ActionDefinition<TContext, TRuntime>,
>(actions: readonly TAction[]): ActionRegistry<TContext, TRuntime, TAction> {
	const byId = new Map<TAction["id"], TAction>();
	/** Registration-order sharers of one collision key, and whether every one of them opted in. */
	type ShortcutClaim = {
		readonly ownerIds: readonly TAction["id"][];
		readonly allSharing: boolean;
	};
	const shortcuts = new Map<string, ShortcutClaim>();

	for (const action of actions) {
		if (byId.has(action.id))
			throw new Error(`Duplicate action id: ${action.id}`);
		byId.set(action.id, action);
		const scope = scopeSignature(action.shortcutScope ?? globalScope);
		for (const shortcut of actionShortcuts(action)) {
			for (const signature of shortcutMatchingSignatures(shortcut)) {
				const collisionKey = `${scope}::${signature}`;
				const claim = shortcuts.get(collisionKey);
				if (claim === undefined) {
					shortcuts.set(collisionKey, {
						ownerIds: [action.id],
						allSharing: action.sharesShortcut === true,
					});
					continue;
				}
				const canShare = claim.allSharing && action.sharesShortcut === true;
				if (!canShare) {
					throw new Error(
						`Duplicate action shortcut ${shortcutSignature(shortcut)} in ${scope} for ${claim.ownerIds.join(", ")} and ${action.id}`,
					);
				}
				shortcuts.set(collisionKey, {
					ownerIds: [...claim.ownerIds, action.id],
					allSharing: true,
				});
			}
		}
	}

	return { actions: [...actions], byId };
}

export function actionAvailability<TContext, TRuntime>(
	action: ActionDefinition<TContext, TRuntime>,
	context: TContext,
): ActionAvailability {
	return action.availability?.(context) ?? available;
}

export function actionEnabled<TContext, TRuntime>(
	action: ActionDefinition<TContext, TRuntime>,
	context: TContext,
): boolean {
	return actionAvailability(action, context).enabled;
}

export function projectAction<TContext, TRuntime>(
	action: ActionDefinition<TContext, TRuntime>,
	context: TContext,
	platform: ShortcutPlatform,
): ActionProjection {
	const primaryShortcutLabel = action.shortcut
		? shortcutLabel(action.shortcut, platform)
		: null;
	const shortcutLabels = actionShortcuts(action).map((shortcut) =>
		shortcutLabel(shortcut, platform),
	);
	const searchableText = [
		action.id,
		action.label,
		action.group.label,
		...shortcutLabels,
		...(action.keywords ?? []),
	]
		.join(" ")
		.toLowerCase();
	return {
		id: action.id,
		label: action.label,
		group: action.group,
		availability: actionAvailability(action, context),
		checked: action.checked?.(context) ?? false,
		shortcutLabel: primaryShortcutLabel,
		shortcutLabels,
		tooltip:
			shortcutLabels.length > 0
				? `${action.label} (${shortcutLabels.join(", ")})`
				: action.label,
		searchableText,
	};
}

/** Menu, help, tooltip, and palette surfaces all project from this same list. */
export function projectActions<TContext, TRuntime>(
	actions: readonly ActionDefinition<TContext, TRuntime>[],
	context: TContext,
	platform: ShortcutPlatform,
): readonly ActionProjection[] {
	return actions.map((action) => projectAction(action, context, platform));
}

const searchableText = <TContext, TRuntime>(
	action: ActionDefinition<TContext, TRuntime>,
	platform: ShortcutPlatform,
): string =>
	[
		action.id,
		action.label,
		action.group.label,
		...actionShortcuts(action).map((shortcut) =>
			shortcutLabel(shortcut, platform),
		),
		...(action.keywords ?? []),
	]
		.join(" ")
		.toLowerCase();

export function searchActionItems<
	TContext,
	TRuntime,
	TAction extends ActionDefinition<TContext, TRuntime>,
>(
	actions: readonly TAction[],
	context: TContext,
	query: string,
	platform: ShortcutPlatform,
): readonly ActionListItem<TContext, TRuntime, TAction>[] {
	const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	return actions
		.filter((action) => {
			if (tokens.length === 0) return true;
			const text = searchableText(action, platform);
			return tokens.every((token) => text.includes(token));
		})
		.map((action) => ({
			action,
			availability: actionAvailability(action, context),
			checked: action.checked?.(context) ?? false,
		}));
}

export function groupActionItems<
	TContext,
	TRuntime,
	TAction extends ActionDefinition<TContext, TRuntime>,
>(
	items: readonly ActionListItem<TContext, TRuntime, TAction>[],
): readonly ActionGroupResult<TContext, TRuntime, TAction>[] {
	const groups = new Map<
		string,
		ActionGroupResult<TContext, TRuntime, TAction>
	>();
	for (const item of items) {
		const current = groups.get(item.action.group.id);
		groups.set(item.action.group.id, {
			group: item.action.group,
			items: current ? [...current.items, item] : [item],
		});
	}
	return [...groups.values()];
}

export function searchActionGroups<
	TContext,
	TRuntime,
	TAction extends ActionDefinition<TContext, TRuntime>,
>(
	actions: readonly TAction[],
	context: TContext,
	query: string,
	platform: ShortcutPlatform,
): readonly ActionGroupResult<TContext, TRuntime, TAction>[] {
	return groupActionItems(searchActionItems(actions, context, query, platform));
}

export function executeAction<
	TContext,
	TRuntime,
	TAction extends ActionDefinition<TContext, TRuntime>,
>(
	registry: ActionRegistry<TContext, TRuntime, TAction>,
	id: TAction["id"],
	runtime: TRuntime,
	context: TContext,
): boolean {
	const action = registry.byId.get(id);
	if (!action || !actionEnabled(action, context)) return false;
	action.execute(runtime, context);
	return true;
}

/** Re-authorizes a projected item against current context before execution. */
export function executeActionItem<
	TContext,
	TRuntime,
	TAction extends ActionDefinition<TContext, TRuntime>,
>(
	item: ActionListItem<TContext, TRuntime, TAction>,
	runtime: TRuntime,
	context: TContext,
): boolean {
	if (!actionEnabled(item.action, context)) return false;
	item.action.execute(runtime, context);
	return true;
}
