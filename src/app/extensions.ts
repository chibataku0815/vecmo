import type { ComponentType, LazyExoticComponent } from "react";

/**
 * Route extension seam for the open-core split.
 *
 * The public (AGPL) core ships `src/app/ext/` empty: it contains the editor,
 * tutorials, and updates routes only. The private overlay drops a
 * `register.ts` into `src/app/ext/<name>/` to add the commercial routes
 * (projects, checkout, admin, legal) and the marketing home page, so no public
 * source file names a private page.
 */
export type AppExtensionPage = LazyExoticComponent<ComponentType>;

export type AppExtensionRoute = {
	readonly pathname: string;
	readonly kind: string;
	readonly component: AppExtensionPage;
};

export type AppExtensionHome = {
	readonly kind: string;
	readonly component: AppExtensionPage;
};

export type AppExtensionRegistry = {
	routes: AppExtensionRoute[];
	home?: AppExtensionHome;
};

type AppExtensionModule = {
	readonly registerAppExtensions: (registry: AppExtensionRegistry) => void;
};

// `@vecmo-ext` is a Vite alias. The public build points it at `src/app/ext`
// (empty apart from `.gitkeep`); a private overlay build points it at its own
// extension directory without modifying this tree.
const extensionModules = import.meta.glob<AppExtensionModule>(
	"@vecmo-ext/**/register.ts",
	{ eager: true },
);

const registry: AppExtensionRegistry = { routes: [] };
for (const module of Object.values(extensionModules)) {
	module.registerAppExtensions(registry);
}

/** Resolved at module load; the registry is fixed for the lifetime of the app. */
export const appExtensions: Readonly<AppExtensionRegistry> = registry;
