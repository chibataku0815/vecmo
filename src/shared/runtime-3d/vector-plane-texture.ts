import type {
	Runtime3dFidelityIssue,
	Runtime3dFrame,
	Runtime3dVectorPlane,
} from "./types";

export type Runtime3dVectorPlaneSvgResolver = (
	plane: Runtime3dVectorPlane,
) => Promise<string | null> | string | null;

const textureHash = (value: string): string => {
	let hash = 2_166_136_261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16_777_619);
	}
	return (hash >>> 0).toString(36);
};

const rasterFailure = (
	plane: Runtime3dVectorPlane,
	detail?: string,
): Runtime3dFidelityIssue => ({
	code: "runtime-3d-vector-plane-raster-failed",
	severity: "error",
	message: detail
		? `The selected vector subtree could not become a Babylon texture plane: ${detail}`
		: "The selected vector subtree produced no browser-rasterizable SVG texture; its existing 2D fallback remains visible.",
	artboardId: plane.artboardId,
	nodeId: plane.sourceNodeId,
});

/**
 * Materializes vector-plane SVG textures outside entities and Babylon. The
 * caller supplies the owning browser raster seam; failed planes stay absent so
 * existing SVG content can remain the exact fallback.
 */
export async function materializeRuntime3dVectorPlaneTextures(
	frame: Runtime3dFrame,
	resolveSvg: Runtime3dVectorPlaneSvgResolver,
): Promise<Runtime3dFrame> {
	if (frame.vectorPlanes.length === 0) return frame;
	const results = await Promise.all(
		frame.vectorPlanes.map(
			async (
				plane,
			): Promise<{
				readonly plane: Runtime3dVectorPlane;
				readonly issue: Runtime3dFidelityIssue | null;
			}> => {
				try {
					const svg = await resolveSvg(plane);
					if (!svg) {
						return { plane, issue: rasterFailure(plane) };
					}
					return {
						plane: {
							...plane,
							texture: {
								kind: "svg-data-url" as const,
								uri: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
								cacheKey: `${plane.nodeId}:${svg.length}:${textureHash(svg)}`,
							},
						},
						issue: null,
					};
				} catch (error) {
					return {
						plane,
						issue: rasterFailure(
							plane,
							error instanceof Error ? error.message : String(error),
						),
					};
				}
			},
		),
	);
	const vectorPlanes: Runtime3dVectorPlane[] = results.map(
		(result) => result.plane,
	);
	const issues = [
		...frame.issues,
		...results.flatMap(({ issue }) => (issue ? [issue] : [])),
	];
	return { ...frame, vectorPlanes, issues };
}
