import type { LookGraphNodeKind } from "@/entities/scene/model/look-graph";
import type { LookDctlEmitter } from "../types";
import { emitAsciiGlyph } from "./ascii-glyph";
import { emitBendWarp } from "./bend-warp";
import { emitBlockMosaic } from "./block-mosaic";
import { emitBlur } from "./blur";
import { emitChromaticFringe } from "./chromatic-fringe";
import { emitColorMap } from "./color-map";
import { emitColorama } from "./colorama";
import { emitCrtDisplay } from "./crt-display";
import { emitDisplace } from "./displace";
import { emitFindEdges } from "./find-edges";
import { emitFlow } from "./flow";
import { emitGrain } from "./grain";
import { emitHalftone } from "./halftone";
import { emitInterlace } from "./interlace";
import { emitKaleidoscope } from "./kaleidoscope";
import { emitLens } from "./lens";
import { emitOrderedDither } from "./ordered-dither";
import { emitPixelGrid } from "./pixel-grid";
import { emitPosterize } from "./posterize";
import { emitRiso } from "./riso";
import { emitScanline } from "./scanline";
import { emitSignalGlitch } from "./signal-glitch";
import { emitVhsColor } from "./vhs-color";
import { emitVhsNoise } from "./vhs-noise";
import { emitVhsTracking } from "./vhs-tracking";
import { emitWarp } from "./warp";
import { emitWaveWarp } from "./wave-warp";

/**
 * DCTL emitter registry: S1's pointwise pilot (`posterize`, `scanline`,
 * `color-map`, `colorama`) plus S2's uv-remap family (`warp`, `lens`,
 * `kaleidoscope`, `wave-warp`, `bend-warp`, `flow`, `displace`) and the
 * `chromatic-fringe` 3-tap gather, plus S3's gather family (`blur`,
 * `find-edges`, `halftone`, `pixel-grid`, `ordered-dither`, `ascii-glyph`,
 * `block-mosaic`, `riso`) and the pointwise `grain`, plus S4a's VHS pack
 * (`vhs-color` gather, `vhs-tracking` uv-remap, `vhs-noise` mostly-pointwise)
 * and S4b's CRT/glitch pack (`crt-display` single-tap uv-remap+pointwise,
 * `signal-glitch` 3-tap gather, `interlace` single-tap uv-remap+pointwise).
 * Every other {@link LookGraphNodeKind} — including `source` and `output`,
 * which the lowering pass handles as identity pass-throughs — has no entry
 * here and falls through to the lowering pass's commented pass-through path.
 */
export const lookDctlEmitters: Partial<
	Record<LookGraphNodeKind, LookDctlEmitter>
> = {
	posterize: emitPosterize,
	scanline: emitScanline,
	"color-map": emitColorMap,
	colorama: emitColorama,
	warp: emitWarp,
	lens: emitLens,
	kaleidoscope: emitKaleidoscope,
	"wave-warp": emitWaveWarp,
	"bend-warp": emitBendWarp,
	flow: emitFlow,
	displace: emitDisplace,
	"chromatic-fringe": emitChromaticFringe,
	blur: emitBlur,
	"find-edges": emitFindEdges,
	halftone: emitHalftone,
	"pixel-grid": emitPixelGrid,
	"ordered-dither": emitOrderedDither,
	"ascii-glyph": emitAsciiGlyph,
	"block-mosaic": emitBlockMosaic,
	riso: emitRiso,
	grain: emitGrain,
	"vhs-color": emitVhsColor,
	"vhs-tracking": emitVhsTracking,
	"vhs-noise": emitVhsNoise,
	"crt-display": emitCrtDisplay,
	"signal-glitch": emitSignalGlitch,
	interlace: emitInterlace,
};
