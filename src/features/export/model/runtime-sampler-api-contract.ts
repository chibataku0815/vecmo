import type { RuntimeSamplerApi } from "./runtime-sampler-api";

/**
 * Compile-time-only proof that each runtime-sampler bundler entry satisfies
 * {@link RuntimeSamplerApi} — the contract `code.ts`'s embedded player depends
 * on when it calls `RUNTIME_SAMPLER.buildScene*` unconditionally. A generic
 * type parameter constrained to `extends RuntimeSamplerApi` fails to compile
 * at the point of instantiation if the argument does not satisfy it, so a
 * missing/mismatched export in an entry is a `tsc -b` failure here, not a
 * `TypeError` at render.
 *
 * This file is intentionally never imported by anything (not even the entries
 * themselves — importing it FROM an entry would make the entry import this
 * module, which imports `RuntimeSamplerApi`'s `typeof import(...)` types that
 * resolve back through the entry, an unnecessary cycle). `import type`/`type`
 * declarations erase completely, so nothing here reaches a bundled sampler;
 * `tsc -b`'s project-wide `include` still type-checks it.
 */
type SatisfiesRuntimeSamplerApi<_Module extends RuntimeSamplerApi> = true;

export type FullEntrySatisfiesRuntimeSamplerApi = SatisfiesRuntimeSamplerApi<
	typeof import("./runtime-sampler-entry")
>;

export type CoreEntrySatisfiesRuntimeSamplerApi = SatisfiesRuntimeSamplerApi<
	typeof import("./runtime-sampler-core-entry")
>;

export type LeanEntrySatisfiesRuntimeSamplerApi = SatisfiesRuntimeSamplerApi<
	typeof import("./runtime-sampler-lean-entry")
>;

export type FlatEntrySatisfiesRuntimeSamplerApi = SatisfiesRuntimeSamplerApi<
	typeof import("./runtime-sampler-flat-entry")
>;
