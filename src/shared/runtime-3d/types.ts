export type Runtime3dVec3 = {
	readonly x: number;
	readonly y: number;
	readonly z: number;
};

export type Runtime3dVec2 = {
	readonly x: number;
	readonly y: number;
};

export type Runtime3dViewport = {
	readonly width: number;
	readonly height: number;
	readonly dpr: number;
};

export type Runtime3dEditorView = Runtime3dViewport & {
	readonly scale: number;
	readonly panX: number;
	readonly panY: number;
	readonly rotation: number;
};

export type Runtime3dCoordinateContract = {
	readonly handedness: "right-handed";
	readonly xAxis: "right";
	readonly yAxis: "down";
	readonly zAxis: "scene-depth";
	readonly fovAxis: "vertical";
};

type Runtime3dCameraBase = {
	readonly coordinates: Runtime3dCoordinateContract;
	readonly position: Runtime3dVec3;
	readonly target: Runtime3dVec3;
	readonly up: Runtime3dVec3;
	readonly near: number;
	readonly far: number;
	/**
	 * Sampled Vecmo camera-rig optics (`SceneCameraRigContract.projection`),
	 * carried through for the P6-C Babylon DOF candidate. All three are
	 * Vecmo-semantic, not physical-camera units — this type is the
	 * renderer-neutral runtime-3D contract, not the FROZEN scene schema:
	 * - `focusDistance`: scene units measured along the camera's forward axis
	 *   from `position` (i.e. `dot(point - position, normalize(target -
	 *   position))`), matching `nodeCameraDepthById` in
	 *   `entities/scene/model/scene-camera.ts`. It is NOT the same axis as a
	 *   placement's baked world Z (`Runtime3dPlacement.worldMatrix`'s
	 *   translation, which is the node's raw, camera-independent
	 *   `depthPlane.z`) — a renderer consuming both must convert explicitly.
	 * - `apertureStrength`: Vecmo's `aperture` strength multiplier (>= 0, 0 =
	 *   disabled), shaped through `Math.log1p` before use — never an f-stop.
	 * - `focalLengthMm`: authored or FOV-derived effective focal length in mm
	 *   against Vecmo's fixed 36mm sensor width convention
	 *   (`effectiveFocalLengthMm` in `scene-camera.ts`).
	 * Optional: absent/undefined means "no sampled rig" (orthographic rigs,
	 * or no active scene camera).
	 */
	readonly focusDistance?: number;
	readonly apertureStrength?: number;
	readonly focalLengthMm?: number;
};

export type Runtime3dCamera =
	| (Runtime3dCameraBase & {
			readonly kind: "orthographic";
			readonly halfWidth: number;
			readonly halfHeight: number;
			readonly zoom: number;
	  })
	| (Runtime3dCameraBase & {
			readonly kind: "perspective";
			readonly verticalFovRadians: number;
			readonly aspect: number;
	  });

/**
 * A loadable 3D model payload — the only source shape that existed before S4.
 * `variant` is an explicit discriminator rather than an inferred one so that
 * widening this union narrows `format` away from every consumer that reads it,
 * and the compiler (not a runtime guard) is what finds them.
 */
export type Runtime3dModelSource = {
	readonly variant: "model";
	readonly kind: "data-url" | "reference";
	readonly uri: string;
	readonly format: "glb" | "gltf";
	readonly cacheKey: string;
};

/**
 * ONE already-rendered RGBA frame out of a Blender frame package (S4-C).
 *
 * This carries the exact frame the runtime frame addresses, never the package:
 * `uri` is that one frame's object URL, resolved by INDEX from the package's
 * dense `frameHrefs` lane. There is deliberately no duration, loop policy, or
 * playback rate here — an adapter must not advance, loop, or interpolate a
 * frame package. Frame `f` shows manifest frame `f`, and out-of-range is a typed
 * issue upstream rather than a modulo wrap or a held last frame.
 *
 * `cacheKey` identifies the PACKAGE and is stable across frames (so a preview
 * surface does not report a reload every frame); `frameCacheKey` identifies this
 * one frame's texture and moves every frame.
 */
export type Runtime3dFrameSequenceSource = {
	readonly variant: "frame-sequence";
	readonly kind: "reference";
	/** Object URL of the EXACT frame this runtime frame addresses. */
	readonly uri: string;
	readonly mimeType: string;
	/** Package-local index this `uri` was addressed by. */
	readonly frameIndex: number;
	/** Blender-space frame `frameIndex` resolves to. Reported, never re-derived. */
	readonly blenderFrame: number;
	readonly frameCount: number;
	readonly width: number;
	readonly height: number;
	/** Build key of the package this frame came from (export report input). */
	readonly buildKey: string;
	/**
	 * Whether this package may back an EXACT export claim. False when the
	 * package is last-known-good rather than the desired build, or when the
	 * producing side could not claim reproducibility. It never hides pixels —
	 * it downgrades the claim, and `features/export` fails closed on it.
	 */
	readonly exact: boolean;
	/** Stable per-package identity; does NOT move per frame. */
	readonly cacheKey: string;
	/** Identity of this one frame's texture; moves every frame. */
	readonly frameCacheKey: string;
};

export type Runtime3dExternalSource =
	| Runtime3dModelSource
	| Runtime3dFrameSequenceSource;

export type Runtime3dWorldMatrix = readonly [
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
];

/**
 * Per-placement animation time for one linked Blender production (S2-B).
 *
 * Vecmo's document frame is the only delivery clock, so this carries an
 * already-resolved *evaluation* frame rather than a phase, a normalized ratio,
 * or a wall-clock time. Two fields are the minimum an adapter needs and the
 * maximum this contract is willing to state:
 *
 * - `frame` is in the SOURCE's Blender frame space (`blenderFrameStart +
 *   vecmoFrame`), already clamped to the link's duration window by the
 *   compiler. It is deliberately not a renderer frame: only the source's own
 *   frame space stays meaningful across both handoff modes (interactive GLB
 *   today, frame-addressed rendered sequence later).
 * - `fps` is the source `.blend`'s frame rate, which is the rate the artifact
 *   was produced at. An adapter needs it because glTF addresses animation in
 *   SECONDS, so `frame / fps` is the only honest conversion. Without it an
 *   adapter would have to assume a frame rate, which is exactly the class of
 *   guess this contract exists to remove.
 *
 * Renderer-specific frame units — notably the glTF loader's own
 * seconds-to-key-frame scaling — stay inside the adapter and never appear here.
 */
export type Runtime3dPlacementAnimation = {
	/** Blender-space evaluation frame, already clamped to the link window. */
	readonly frame: number;
	/** Source `.blend` frame rate the artifact was produced at. */
	readonly fps: number;
};

export type Runtime3dPlacement = {
	/** Unique id for this sampled runtime instance (crossfade copies included). */
	readonly nodeId: string;
	/** Durable Vecmo node id returned by renderer picking. */
	readonly sourceNodeId: string;
	readonly assetId: string;
	readonly artboardId: string;
	readonly source: Runtime3dExternalSource;
	/**
	 * Column-major 4x4 transform from a normalized, origin-centered model into
	 * the sampled presentation space consumed by this frame. The adapter may
	 * consume it, but must never persist it.
	 */
	readonly worldMatrix: Runtime3dWorldMatrix;
	readonly opacity: number;
	readonly visible: boolean;
	readonly pickable: boolean;
	/**
	 * Present only for a placement whose asset carries a verified
	 * `interactive-glb` production link. Absent everywhere else, which is what
	 * keeps every plain imported GLB — and every existing caller — on exactly
	 * the previous behavior: an adapter that finds no `animation` must not
	 * advance, start, or seek anything.
	 */
	readonly animation?: Runtime3dPlacementAnimation;
};

export type Runtime3dVectorPlaneTexture = {
	readonly kind: "svg-data-url";
	readonly uri: string;
	readonly cacheKey: string;
};

/**
 * One explicitly depth-authored vector subtree flattened through Vecmo's
 * existing browser SVG raster path. `texture` remains null in the DOM-free
 * entity compiler and is filled only by a browser-side frame adapter.
 */
export type Runtime3dVectorPlane = {
	readonly nodeId: string;
	readonly sourceNodeId: string;
	readonly artboardId: string;
	readonly worldMatrix: Runtime3dWorldMatrix;
	readonly opacity: number;
	readonly visible: boolean;
	readonly pickable: boolean;
	readonly rasterBounds: {
		readonly x: number;
		readonly y: number;
		readonly width: number;
		readonly height: number;
	};
	readonly texture: Runtime3dVectorPlaneTexture | null;
};

export type Runtime3dArtboardClip = {
	readonly artboardId: string;
	/**
	 * Clockwise artboard corners in the same sampled, Y-down presentation space
	 * as placement world matrices. The runtime converts them to renderer planes.
	 */
	readonly polygon: readonly [
		Runtime3dVec2,
		Runtime3dVec2,
		Runtime3dVec2,
		Runtime3dVec2,
	];
};

export type Runtime3dFidelityIssueCode =
	| "runtime-3d-active-camera-missing"
	| "runtime-3d-camera-controller-static-only"
	| "runtime-3d-camera-crossfade-sampled"
	| "runtime-3d-camera-far-invalid"
	| "runtime-3d-dof-degraded"
	| "runtime-3d-dof-unsupported"
	| "runtime-3d-environment-unavailable"
	| "runtime-3d-frame-clip-unsupported"
	/**
	 * The addressed package-local frame index falls outside the admitted
	 * package. Fail closed: the band draws nothing rather than holding a
	 * neighbouring frame, because a silently held frame is indistinguishable
	 * from correct playback on a slow-moving shot.
	 */
	| "runtime-3d-frame-package-frame-unavailable"
	/**
	 * The package renders, but its producing side could not claim it is
	 * reproducible, so it may not back an exact export claim.
	 */
	| "runtime-3d-frame-package-not-reproducible"
	/**
	 * A resolver was asked for this link's artifact and answered with a typed
	 * "nothing to show", rather than silently returning nothing. Before S4 this
	 * path returned a bare `null` and the band went dark with no issue at all.
	 */
	| "runtime-3d-linked-production-unavailable"
	| "runtime-3d-linked-production-stale"
	| "runtime-3d-model-blend-unsupported"
	| "runtime-3d-model-effects-unsupported"
	| "runtime-3d-model-mask-unsupported"
	| "runtime-3d-model-source-missing"
	| "runtime-3d-ssao-degraded"
	| "runtime-3d-svg-z-order-unsupported"
	| "runtime-3d-vector-plane-active-camera-required"
	| "runtime-3d-vector-plane-background-blur-unsupported"
	| "runtime-3d-vector-plane-blend-unsupported"
	| "runtime-3d-vector-plane-bounds-invalid"
	| "runtime-3d-vector-plane-camera-mismatch"
	| "runtime-3d-vector-plane-dof-sampled"
	| "runtime-3d-vector-plane-external-subtree-unsupported"
	| "runtime-3d-vector-plane-frame-clip-unsupported"
	| "runtime-3d-vector-plane-look-unsupported"
	| "runtime-3d-vector-plane-mask-unsupported"
	| "runtime-3d-vector-plane-nested-depth-unsupported"
	| "runtime-3d-vector-plane-nesting-unsupported"
	| "runtime-3d-vector-plane-raster-failed";

export type Runtime3dFidelityIssue = {
	readonly code: Runtime3dFidelityIssueCode;
	readonly severity: "info" | "warning" | "error";
	readonly message: string;
	readonly artboardId?: string;
	readonly assetId?: string;
	readonly nodeId?: string;
};

export type Runtime3dPickOutcome =
	| {
			readonly kind: "hit";
			readonly nodeId: string;
			readonly artboardId: string;
	  }
	| {
			readonly kind: "miss";
			readonly artboardId: string;
	  };

/**
 * Immutable, renderer-neutral frame contract. It is derived read state only:
 * Vecmo Scene/Motion remain authoritative and no runtime object may flow back.
 */
export type Runtime3dFrame = {
	readonly frame: number;
	readonly viewport: Runtime3dViewport;
	readonly camera: Runtime3dCamera;
	/**
	 * Static authored camera converted from Vecmo's right-handed, Y-down,
	 * vertical-FOV contract. The editor overlay renders the already-sampled
	 * presentation through `camera`; later camera parity may consume this.
	 */
	readonly sourceCamera?: Runtime3dCamera;
	readonly artboardClips: readonly Runtime3dArtboardClip[];
	readonly placements: readonly Runtime3dPlacement[];
	readonly vectorPlanes: readonly Runtime3dVectorPlane[];
	readonly issues: readonly Runtime3dFidelityIssue[];
};
