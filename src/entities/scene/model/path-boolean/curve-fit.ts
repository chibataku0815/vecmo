/**
 * Corner-preserving cubic re-fit for Boolean path output.
 *
 * The implementation now lives in `@/shared/geometry/curve-fit` so both path-ops
 * and the shape-builder feature can share one kernel without a feature-to-feature
 * import (banned by the architecture gate). This module re-exports it to keep
 * path-ops' existing import paths stable; behavior is unchanged.
 */
export {
	type CurveFitOptions,
	fitClosedContour,
	sourceIntersectionPoints,
} from "@/shared/geometry/curve-fit";
