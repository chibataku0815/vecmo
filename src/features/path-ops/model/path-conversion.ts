/**
 * Re-exports the pure geometry<->polygon conversion helpers from
 * `entities/scene/model/path-boolean/path-conversion.ts`. Moved down to the
 * entities layer alongside the rest of the boolean engine (Wave B2,
 * agent-parity slice B6) so `entities/agent/model/write.ts` can compile
 * `scene/apply-path-operation` agent commands without a features->entities
 * import (a hard Feature-Sliced layer violation). This module stays as the
 * stable import path for existing callers in this feature (`command.ts`'s
 * shim, `finishing.ts`, and the sibling test files) so no relative import
 * needed to change.
 */
export type {
	PathConversionResult,
	PathOpPoint,
	PathOpPolygon,
	PolygonConversionResult,
} from "@/entities/scene/model/path-boolean/path-conversion";
export {
	compoundPathGeometryFromContours,
	ellipseToPathGeometry,
	geometryToPathGeometry,
	hardCornerVertices,
	pathGeometryFromPoints,
	pathShapeToPolyline,
	polygonToPathGeometry,
	rectToPathGeometry,
	sourceToOperationPolygon,
} from "@/entities/scene/model/path-boolean/path-conversion";
