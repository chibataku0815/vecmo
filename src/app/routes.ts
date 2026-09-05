import { type AppExtensionPage, appExtensions } from "./extensions";

/** Routes the open-core editor owns on its own. */
export type AppRouteKind = "editor" | "updates" | "tutorials";

export type CoreAppRoute =
	| { readonly kind: "editor"; readonly pathname: "/editor" }
	| { readonly kind: "updates"; readonly pathname: "/updates" }
	| { readonly kind: "tutorials"; readonly pathname: "/tutorials" };

/** A route contributed by `src/app/ext/*`; `name` is the extension's own kind. */
export type ExtensionAppRoute = {
	readonly kind: "extension";
	readonly name: string;
	readonly pathname: string;
	readonly component: AppExtensionPage;
};

export type AppRoute = CoreAppRoute | ExtensionAppRoute;

const ROUTES = {
	editor: { kind: "editor", pathname: "/editor" },
	updates: { kind: "updates", pathname: "/updates" },
	tutorials: { kind: "tutorials", pathname: "/tutorials" },
} as const satisfies Record<AppRouteKind, CoreAppRoute>;

const normalizePathname = (value: string): string => {
	const withoutQuery = value.split(/[?#]/, 1)[0] ?? "/";
	if (withoutQuery.length <= 1) return "/";
	return withoutQuery.endsWith("/") ? withoutQuery.slice(0, -1) : withoutQuery;
};

/**
 * Owns the SPA route contract that keeps commercial/public surfaces additive.
 * Extension routes win over core ones, and the unmatched fallback (`/` and any
 * unknown path) is the extension home when one is registered — otherwise the
 * local editor, which is what the public build ships.
 */
export function resolveAppRoute(pathname: string): AppRoute {
	const normalized = normalizePathname(pathname);
	const extension = appExtensions.routes.find(
		(route) => route.pathname === normalized,
	);
	if (extension) {
		return {
			kind: "extension",
			name: extension.kind,
			pathname: extension.pathname,
			component: extension.component,
		};
	}
	if (normalized === ROUTES.editor.pathname) return ROUTES.editor;
	if (normalized === ROUTES.updates.pathname) return ROUTES.updates;
	if (normalized === ROUTES.tutorials.pathname) return ROUTES.tutorials;
	const home = appExtensions.home;
	if (!home) return ROUTES.editor;
	return {
		kind: "extension",
		name: home.kind,
		pathname: normalized,
		component: home.component,
	};
}
