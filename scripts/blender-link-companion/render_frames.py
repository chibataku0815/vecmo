"""Headless RGBA frame-sequence render job for the production-link companion (S4-B).

Run:
    blender --background --factory-startup --python-exit-code 1 \
        <source.blend> --python render_frames.py -- --job <job.json>

The job file carries frame range, size, fps, codec, seed, render settings, an
optional sampled Vecmo camera, and per-frame published-control values. The
report file it writes back carries one entry per rendered frame. Digests are NOT
computed here: `scripts/blender-link-render-job.ts` hashes the bytes so the whole
pipeline keeps a single digest convention.

Five disciplines are load-bearing here:

1. **The source `.blend` is never written.** `assert_no_save_operators()` and
   `assert_destination_is_outside_source_dir()` are carried over verbatim from
   `export_glb.py`, because Blender's `save_as_mainfile` writes a `.blend1`
   sibling and "render near the source" is one refactor away from mutating the
   user's workspace. S0a measured that a re-saved `.blend` is not byte-identical,
   so a stray save would move `sourceDigest` and invalidate every artifact built
   from that file.

2. **Blender never numbers a frame.** Every output path is computed here and
   assigned in full, with `use_file_extension = False`, and each frame is
   rendered with `write_still=True` rather than `render_animation`. Blender's
   `#`-padding, `frame_start` offset, and file-extension appending are three
   independent off-by-one sources; not using any of them deletes the class of bug
   instead of testing for it. The reported `blenderFrame` is read back from
   `scene.frame_current` AFTER the seek, so the report states what was actually
   evaluated rather than what was requested.

3. **Frames are rendered strictly ascending from the first frame.** A simulation
   or a cache reached by an ascending walk has a different depsgraph history than
   one reached by a jump, so a cold run and a warm run must walk identically or
   their frame hashes differ for a reason that is about traversal rather than
   about the render.

4. **Every render setting is explicitly pinned.** An unpinned default is an
   unhashed input: `renderSettingsDigest` would claim two builds are the same
   request while Blender quietly produced different pixels.

5. **Nothing is inferred about what could not be applied.** A seed that matched
   no particle system, a control whose binding did not resolve, and an absent
   camera are all recorded as observed facts in the report. The companion turns
   those into diagnostics; this script never substitutes a value nobody authored.

WebP note carried forward from S0c: Blender's `ImageFormatSettings` for
`file_format='WEBP'` exposes no `use_lossless` boolean on this build, only
`quality` (0-100). `quality=100` was empirically verified bit-exact against PNG
for every pixel with non-zero alpha, and independently cross-checked against the
standalone `cwebp -lossless` CLI. That is a fragile API surface, so the effective
setting is echoed into the report and must be re-verified on any Blender upgrade.
"""

from __future__ import annotations

import json
import os
import sys
import time

import bpy
from mathutils import Matrix, Vector

JOB_VERSION = 1

# S0a: blenderPoint = sceneUnitsPerPixel * M * vecmoPoint, with
# M = [[1,0,0],[0,0,1],[0,-1,0]] -- Vecmo (x, y, z) -> Blender (x, z, -y), det=+1.
AXIS_MATRIX_ROWS = ((1.0, 0.0, 0.0), (0.0, 0.0, 1.0), (0.0, -1.0, 0.0))

# Pinned render settings. Each of these is a hashed build input upstream.
RESOLUTION_PERCENTAGE = 100
COLOR_MODE = "RGBA"
COLOR_DEPTH_8 = "8"
WEBP_QUALITY_LOSSLESS = 100
PNG_COMPRESSION = 15
USE_STAMP = False
USE_FILE_EXTENSION = False
USE_OVERWRITE = True
USE_PLACEHOLDER = False

CODEC_FORMATS = {"webp-lossless": "WEBP", "png": "PNG"}
CODEC_SUFFIXES = {"webp-lossless": ".webp", "png": ".png"}
FRAME_NAME_DIGITS = 5


def script_args() -> list[str]:
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1 :]


def job_path() -> str:
    args = script_args()
    if "--job" not in args:
        raise SystemExit("render_frames.py requires --job <path>")
    return os.path.abspath(args[args.index("--job") + 1])


def assert_no_save_operators() -> None:
    """Fail closed if this file ever grows a `.blend` save call site."""
    with open(__file__, "r", encoding="utf-8") as handle:
        source = handle.read()
    needles = ("wm." + "save_", "ops." + "wm.save", "bpy.ops." + "wm.save")
    for needle in needles:
        if needle in source:
            raise SystemExit(
                f"render_frames.py must not contain a {needle!r} call site"
            )


def assert_destination_is_outside_source_dir(destination_dir: str) -> None:
    source = bpy.data.filepath
    if not source:
        return
    source_dir = os.path.realpath(os.path.dirname(os.path.abspath(source)))
    if os.path.realpath(destination_dir) == source_dir:
        raise SystemExit(
            "render_frames.py refuses to write frames into the source directory"
        )


def to_blender_point(vec: dict, scale: float) -> Vector:
    row0, row1, row2 = AXIS_MATRIX_ROWS
    x, y, z = float(vec["x"]), float(vec["y"]), float(vec["z"])
    return Vector(
        (
            scale * (row0[0] * x + row0[1] * y + row0[2] * z),
            scale * (row1[0] * x + row1[1] * y + row1[2] * z),
            scale * (row2[0] * x + row2[1] * y + row2[2] * z),
        )
    )


def to_blender_direction(vec: dict) -> Vector:
    return to_blender_point(vec, 1.0)


def look_at_matrix(position: Vector, target: Vector, up: Vector) -> Matrix:
    """Blender camera basis: -Z forward, +Y up."""
    forward = (target - position).normalized()
    right = forward.cross(up).normalized()
    true_up = right.cross(forward).normalized()
    basis = Matrix(
        (
            (right.x, true_up.x, -forward.x, position.x),
            (right.y, true_up.y, -forward.y, position.y),
            (right.z, true_up.z, -forward.z, position.z),
            (0.0, 0.0, 0.0, 1.0),
        )
    )
    return basis


def apply_render_settings(scene, job: dict) -> dict:
    codec = job["codec"]
    if codec not in CODEC_FORMATS:
        raise SystemExit(f"render_frames.py rejects unknown codec {codec!r}")
    render = scene.render
    render.resolution_x = int(job["width"])
    render.resolution_y = int(job["height"])
    render.resolution_percentage = RESOLUTION_PERCENTAGE
    render.fps = int(round(float(job["fps"])))
    render.fps_base = render.fps / float(job["fps"])
    render.film_transparent = bool(job.get("filmTransparent", True))
    render.use_stamp = USE_STAMP
    render.use_file_extension = USE_FILE_EXTENSION
    render.use_overwrite = USE_OVERWRITE
    render.use_placeholder = USE_PLACEHOLDER

    image = render.image_settings
    image.file_format = CODEC_FORMATS[codec]
    image.color_mode = COLOR_MODE
    image.color_depth = COLOR_DEPTH_8
    if codec == "webp-lossless":
        image.quality = WEBP_QUALITY_LOSSLESS
    else:
        image.compression = PNG_COMPRESSION

    # The view transform is a legally declared value in the manifest, so it is
    # set here rather than inherited from whatever the source happened to save.
    view_transform = job.get("viewTransform")
    if view_transform:
        scene.view_settings.view_transform = view_transform

    return {
        "fileFormat": image.file_format,
        "colorMode": image.color_mode,
        "colorDepth": image.color_depth,
        "webpQuality": image.quality if codec == "webp-lossless" else None,
        "pngCompression": image.compression if codec == "png" else None,
        "filmTransparent": render.film_transparent,
        "viewTransform": scene.view_settings.view_transform,
        "displayDevice": scene.display_settings.display_device,
        "engine": render.engine,
        "resolutionX": render.resolution_x,
        "resolutionY": render.resolution_y,
        "resolutionPercentage": render.resolution_percentage,
        "fps": render.fps,
        "fpsBase": render.fps_base,
        "useStamp": render.use_stamp,
        "useFileExtension": render.use_file_extension,
    }


# Modifier types whose result depends on accumulated state rather than on the
# current frame alone. A package containing any of these cannot be claimed
# reproducible without measuring it.
STATEFUL_MODIFIER_TYPES = frozenset(
    {
        "PARTICLE_SYSTEM",
        "CLOTH",
        "SOFT_BODY",
        "FLUID",
        "COLLISION",
        "DYNAMIC_PAINT",
        "EXPLODE",
        "OCEAN",
    }
)
SIMULATION_NODE_TYPES = frozenset(
    {"GeometryNodeSimulationInput", "GeometryNodeSimulationOutput"}
)


def scan_simulation_features(scene) -> list[dict]:
    """Every state-carrying feature in the scene, scanned UNCONDITIONALLY.

    This must not be gated on whether a seed was requested. The absence of a
    seed request says nothing about whether the scene simulates, and deriving a
    `reproducible` claim from it would make the claim fail OPEN — a scene full of
    particles would be called reproducible precisely because nobody asked for a
    seed. The companion's own `resolveOutputProfile` routes particle systems,
    physics, and simulation nodes INTO this profile, so those are the expected
    inputs here, not the exotic ones.
    """
    features = []
    for obj in scene.objects:
        for modifier in getattr(obj, "modifiers", []):
            modifier_type = getattr(modifier, "type", "")
            if modifier_type in STATEFUL_MODIFIER_TYPES:
                features.append(
                    {
                        "kind": "stateful-modifier",
                        "owner": obj.name,
                        "modifier": modifier.name,
                        "modifierType": modifier_type,
                    }
                )
            group = getattr(modifier, "node_group", None)
            if group is None:
                continue
            for node in group.nodes:
                if node.bl_idname in SIMULATION_NODE_TYPES:
                    features.append(
                        {
                            "kind": "geometry-nodes-simulation-zone",
                            "owner": obj.name,
                            "modifier": modifier.name,
                            "node": node.bl_idname,
                        }
                    )
                    break
        if getattr(obj, "rigid_body", None) is not None:
            features.append({"kind": "rigid-body", "owner": obj.name})
        if getattr(obj, "soft_body", None) is not None:
            features.append({"kind": "soft-body", "owner": obj.name})
    return features


def apply_seed(scene, seed) -> dict:
    """Applies the job seed where the scene actually exposes one.

    Returns an honest record: a seed that matched nothing is reported as matching
    nothing, never as applied.
    """
    if seed is None:
        return {"requested": None, "particleSystems": []}
    applied = []
    for obj in scene.objects:
        for modifier in getattr(obj, "modifiers", []):
            particle_system = getattr(modifier, "particle_system", None)
            if particle_system is None:
                continue
            particle_system.seed = int(seed)
            applied.append(f"{obj.name}/{modifier.name}")
    return {"requested": int(seed), "particleSystems": applied}


def configure_camera(scene, camera_job: dict):
    """Creates the job's camera and makes it the scene camera.

    `sensor_fit` is set BEFORE `angle_y`: the `angle_y` setter derives the lens
    from whichever sensor axis the fit currently names, so the reverse order
    silently computes the horizontal solution. S0a measured that passing Vecmo's
    `focalLengthMm` instead of the vertical FOV lands 1.5x off (38.601mm vs
    25.734mm, 50 deg becoming 34.538 deg), so no focal length is accepted here at
    all.
    """
    data = bpy.data.cameras.new("VecmoShotCamera")
    data.sensor_fit = "VERTICAL"
    data.angle_y = float(camera_job["verticalFovRadians"])
    aperture = camera_job.get("aperture")
    if aperture:
        data.dof.use_dof = True
        data.dof.aperture_fstop = float(aperture["fStop"])
    obj = bpy.data.objects.new("VecmoShotCamera", data)
    scene.collection.objects.link(obj)
    scene.camera = obj
    return obj


def apply_camera_pose(camera_object, pose: dict, scale: float) -> None:
    position = to_blender_point(pose["position"], scale)
    target = to_blender_point(pose["target"], scale)
    up = to_blender_direction(pose.get("up", {"x": 0.0, "y": -1.0, "z": 0.0}))
    camera_object.matrix_world = look_at_matrix(position, target, up)


def resolve_control_owner(scene, binding: dict):
    owner_type = binding["ownerType"]
    owner_name = binding["ownerName"]
    if owner_type == "SCENE":
        return scene if scene.name == owner_name else bpy.data.scenes.get(owner_name)
    return bpy.data.objects.get(owner_name)


def apply_controls(resolved_controls, index: int) -> None:
    for owner, property_name, values in resolved_controls:
        owner[property_name] = float(values[index])


def frame_file_name(index: int, suffix: str) -> str:
    return f"frame-{index:0{FRAME_NAME_DIGITS}d}{suffix}"


def main() -> None:
    assert_no_save_operators()
    job = json.load(open(job_path(), "r", encoding="utf-8"))
    if job.get("jobVersion") != JOB_VERSION:
        raise SystemExit("render_frames.py rejects an unknown job version")

    output_directory = os.path.abspath(job["outputDirectory"])
    assert_destination_is_outside_source_dir(output_directory)
    os.makedirs(output_directory, exist_ok=True)

    scene = bpy.context.scene
    settings = apply_render_settings(scene, job)
    simulation_features = scan_simulation_features(scene)
    seed_record = apply_seed(scene, job.get("seed"))

    frame_start = int(job["frameStart"])
    frame_count = int(job["frameCount"])
    if frame_count <= 0:
        raise SystemExit("render_frames.py requires a positive frameCount")
    suffix = CODEC_SUFFIXES[job["codec"]]

    camera_job = job.get("camera")
    camera_object = configure_camera(scene, camera_job) if camera_job else None
    camera_scale = float(camera_job["sceneUnitsPerPixel"]) if camera_job else 1.0
    camera_poses = (camera_job.get("posesByIndex") or []) if camera_job else []
    if camera_object and len(camera_poses) not in (0, frame_count):
        raise SystemExit("render_frames.py requires one camera pose per frame")

    resolved_controls = []
    unresolved_controls = []
    for control in job.get("controls", []):
        binding = control["binding"]
        owner = resolve_control_owner(scene, binding)
        values = control["valuesByIndex"]
        if owner is None or len(values) != frame_count:
            unresolved_controls.append(binding)
            continue
        resolved_controls.append((owner, binding["propertyName"], values))

    frames = []
    for index in range(frame_count):
        requested_frame = frame_start + index
        # `frame_set` rather than assigning `frame_current`: only the former
        # re-evaluates the depsgraph, and rendering an unevaluated frame is the
        # exact shape of "frame f shows something other than f".
        scene.frame_set(requested_frame)
        observed_frame = scene.frame_current
        if observed_frame != requested_frame:
            raise SystemExit(
                "render_frames.py observed a frame seek that did not land: "
                f"requested {requested_frame}, current {observed_frame}"
            )
        apply_controls(resolved_controls, index)
        if camera_object and camera_poses:
            apply_camera_pose(camera_object, camera_poses[index], camera_scale)

        file_name = frame_file_name(index, suffix)
        destination = os.path.join(output_directory, file_name)
        scene.render.filepath = destination
        started = time.monotonic()
        bpy.ops.render.render(write_still=True)
        elapsed_ms = int((time.monotonic() - started) * 1000)
        if not os.path.exists(destination) or os.path.getsize(destination) == 0:
            raise SystemExit(
                f"render_frames.py produced no bytes for frame index {index}"
            )
        frames.append(
            {
                "index": index,
                "blenderFrame": observed_frame,
                "fileName": file_name,
                "byteLength": os.path.getsize(destination),
            }
        )
        # Progress leaves on stdout as one JSON object per line so the companion
        # can stream it without parsing Blender's own chatter.
        print(
            "VECMO-PROGRESS "
            + json.dumps(
                {
                    "index": index,
                    "blenderFrame": observed_frame,
                    "elapsedMs": elapsed_ms,
                }
            ),
            flush=True,
        )

    report = {
        "jobVersion": JOB_VERSION,
        "frameStart": frame_start,
        "frameCount": frame_count,
        "codec": job["codec"],
        "width": int(job["width"]),
        "height": int(job["height"]),
        "settings": settings,
        "seed": seed_record,
        "simulationFeatures": simulation_features,
        "camera": {
            "applied": bool(camera_object),
            "poseCount": len(camera_poses),
            "sensorFit": camera_object.data.sensor_fit if camera_object else None,
            "angleYRadians": camera_object.data.angle_y if camera_object else None,
            "lensMm": camera_object.data.lens if camera_object else None,
            "axisMatrixRows": [list(row) for row in AXIS_MATRIX_ROWS],
        },
        "controls": {
            "resolvedCount": len(resolved_controls),
            "unresolved": unresolved_controls,
        },
        "frames": frames,
    }
    with open(os.path.abspath(job["reportPath"]), "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, sort_keys=True)


main()
