/**
 * Re-export shim: the component-prop runtime compiler (`compileBinding`,
 * `buildComponentPropsExport`, `buildComponentPropsManifest`, and their
 * types) moved to `entities/scene/model/component-props-runtime.ts` (T3-S4,
 * Interaction Preview mode) because it has no export-specific dependency and
 * the editor's Interactive Motion preview needs the SAME binding resolution
 * `features/motion` (a feature) cannot import from `features/export` (another
 * feature — features must not import features). Every existing export call
 * site (`code.ts`, `webgl-player.ts`, `webgl-player-runtime.ts`,
 * `interactions-export.ts`, `widgets/top-bar/model/export-report.ts`) keeps
 * importing from this path unchanged.
 */
export {
	buildComponentPropsExport,
	buildComponentPropsManifest,
	type ComponentPropApplierEntry,
	type ComponentPropApplierInstruction,
	type ComponentPropExportIssue,
	type ComponentPropExportIssueReason,
	type ComponentPropExportSchemaEntry,
	type ComponentPropsExportResult,
	compileBinding,
	type ExportComponentPropManifestBinding,
	type ExportComponentPropManifestEntry,
	type ExportComponentPropRuntimeSupport,
	type ExportComponentPropsManifest,
} from "@/entities/scene/model/component-props-runtime";
