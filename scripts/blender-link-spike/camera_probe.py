"""S0a camera-mapping probe, Blender side.

Run:
    blender --background --factory-startup --python-exit-code 1 \
        --python camera_probe.py -- --spec <spec.json> --out <out.json>

Builds a throwaway scene (no .blend is ever opened or saved), injects one
temporary camera under the Vecmo -> Blender axis mapping, and projects the
spec's probe points with `bpy_extras.object_utils.world_to_camera_view`.

Axis mapping (derived, documented as one matrix):

    Vecmo (right-handed, X right, Y down, Z scene-depth)
      -> Babylon  (x, -y, -z)          [src/shared/babylon/runtime.ts configureCamera]
      -> Blender  (x, -z_babylon, y_babylon) = (x, z_vecmo, -y_vecmo)

    M = [[1, 0,  0],
         [0, 0,  1],
         [0, -1, 0]]     det(M) = +1

    blenderPoint = sceneUnitsPerPixel * (M @ vecmoPoint)
"""

from __future__ import annotations

import json
import math
import os
import sys

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

DERIVED_AXIS_MATRIX_ROWS = ((1.0, 0.0, 0.0), (0.0, 0.0, 1.0), (0.0, -1.0, 0.0))
BASIS_TOLERANCE = 1e-6
CAMERA_NAME = "VecmoShotCameraProbe"

# Mutable so `--axis-rows` can drive the harness's negative control: feeding a
# different proper rotation must leave every per-point delta inside tolerance
# (the deltas are rotation-invariant) while the absolute axis assertions in
# camera-probe.ts reject it.
AXIS_MATRIX_ROWS = DERIVED_AXIS_MATRIX_ROWS


def script_args() -> list[str]:
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1 :]


def arg_value(flag: str) -> str:
    args = script_args()
    if flag not in args:
        raise SystemExit(f"camera_probe.py requires {flag} <path>")
    return os.path.abspath(args[args.index(flag) + 1])


def to_blender(vec: dict, scale: float) -> Vector:
    x, y, z = float(vec["x"]), float(vec["y"]), float(vec["z"])
    row0, row1, row2 = AXIS_MATRIX_ROWS
    return Vector(
        (
            scale * (row0[0] * x + row0[1] * y + row0[2] * z),
            scale * (row1[0] * x + row1[1] * y + row1[2] * z),
            scale * (row2[0] * x + row2[1] * y + row2[2] * z),
        )
    )


def to_blender_direction(vec: dict) -> Vector:
    return to_blender(vec, 1.0)


def clear_scene() -> None:
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def look_at_matrix(position: Vector, target: Vector, up: Vector) -> Matrix:
    forward = (target - position).normalized()
    z_axis = -forward
    x_axis = up.cross(z_axis)
    if x_axis.length < BASIS_TOLERANCE:
        raise SystemExit("camera up vector is parallel to the view direction")
    x_axis.normalize()
    y_axis = z_axis.cross(x_axis)
    # mathutils.Matrix takes ROWS; the basis vectors are COLUMNS, hence the
    # explicit per-component transpose below.
    return Matrix(
        (
            (x_axis.x, y_axis.x, z_axis.x, position.x),
            (x_axis.y, y_axis.y, z_axis.y, position.y),
            (x_axis.z, y_axis.z, z_axis.z, position.z),
            (0.0, 0.0, 0.0, 1.0),
        )
    )


def effective_fov(camera_object, scene) -> dict:
    """Vertical/horizontal FOV read back from the actual render frame."""
    corners = camera_object.data.view_frame(scene=scene)
    depth = abs(corners[0].z) or 1.0
    xs = [corner.x for corner in corners]
    ys = [corner.y for corner in corners]
    return {
        "verticalFovRadians": 2.0 * math.atan((max(ys) - min(ys)) / 2.0 / depth),
        "horizontalFovRadians": 2.0 * math.atan((max(xs) - min(xs)) / 2.0 / depth),
    }


def probe_frames(scene, frame_spec: dict) -> list[dict]:
    blender_frame_start = int(frame_spec["blenderFrameStart"])
    duration = int(frame_spec["durationFrames"])
    scene.frame_start = blender_frame_start
    scene.frame_end = blender_frame_start + duration - 1
    results: list[dict] = []
    for vecmo_frame in frame_spec["vecmoFrames"]:
        expected = blender_frame_start + int(vecmo_frame)
        scene.frame_set(expected)
        results.append(
            {
                "vecmoFrame": int(vecmo_frame),
                "expectedBlenderFrame": expected,
                "observedBlenderFrame": scene.frame_current,
                "identity": scene.frame_current == expected,
            }
        )
    return results


def apply_axis_override() -> None:
    args = script_args()
    if "--axis-rows" not in args:
        return
    rows = json.loads(args[args.index("--axis-rows") + 1])
    if len(rows) != 3 or any(len(row) != 3 for row in rows):
        raise SystemExit("--axis-rows requires a 3x3 matrix")
    global AXIS_MATRIX_ROWS
    AXIS_MATRIX_ROWS = tuple(tuple(float(value) for value in row) for row in rows)


def main() -> None:
    apply_axis_override()
    spec_path = arg_value("--spec")
    out_path = arg_value("--out")
    with open(spec_path, "r", encoding="utf-8") as handle:
        spec = json.load(handle)

    scale = float(spec["sceneUnitsPerPixel"])
    camera_spec = spec["camera"]
    vertical_fov = math.radians(float(camera_spec["verticalFovDegrees"]))

    scene = bpy.context.scene
    clear_scene()
    scene.render.resolution_x = int(spec["resolution"]["width"])
    scene.render.resolution_y = int(spec["resolution"]["height"])
    scene.render.resolution_percentage = 100
    scene.render.pixel_aspect_x = 1.0
    scene.render.pixel_aspect_y = 1.0

    camera_data = bpy.data.cameras.new(CAMERA_NAME)
    camera_data.type = "PERSP"
    # sensor_fit must be set BEFORE angle_y so the setter uses sensor_height.
    camera_data.sensor_fit = "VERTICAL"
    camera_data.angle_y = vertical_fov
    camera_data.clip_start = float(camera_spec["near"]) * scale
    camera_data.clip_end = float(camera_spec["far"]) * scale
    camera_object = bpy.data.objects.new(CAMERA_NAME, camera_data)
    scene.collection.objects.link(camera_object)
    scene.camera = camera_object

    position = to_blender(camera_spec["position"], scale)
    target = to_blender(camera_spec["target"], scale)
    up = to_blender_direction(camera_spec["up"]).normalized()
    forward = (target - position).normalized()
    camera_object.matrix_world = look_at_matrix(position, target, up)
    bpy.context.view_layer.update()

    basis_forward = camera_object.matrix_world.to_3x3() @ Vector((0.0, 0.0, -1.0))
    basis_error = (basis_forward - forward).length
    if basis_error > BASIS_TOLERANCE:
        raise SystemExit(f"camera basis transpose error: {basis_error}")
    basis_up = camera_object.matrix_world.to_3x3() @ Vector((0.0, 1.0, 0.0))

    if abs(scene.render.pixel_aspect_x - scene.render.pixel_aspect_y) > 1e-12:
        raise SystemExit("non-square pixel aspect invalidates the probe")

    points: list[dict] = []
    for entry in spec["probePoints"]:
        world = to_blender(entry["point"], scale)
        projected = world_to_camera_view(scene, camera_object, world)
        points.append(
            {
                "id": entry["id"],
                "blenderWorld": [world.x, world.y, world.z],
                "u": projected.x,
                "v": projected.y,
                "cameraDepth": projected.z,
                "behindCamera": projected.z <= 0.0,
            }
        )

    payload = {
        "probeVersion": 1,
        "blenderVersion": bpy.app.version_string,
        "axisMatrixRows": [list(row) for row in AXIS_MATRIX_ROWS],
        "axisOverridden": AXIS_MATRIX_ROWS != DERIVED_AXIS_MATRIX_ROWS,
        "sceneUnitsPerPixel": scale,
        "resolution": {
            "width": scene.render.resolution_x,
            "height": scene.render.resolution_y,
            "pixelAspectX": scene.render.pixel_aspect_x,
            "pixelAspectY": scene.render.pixel_aspect_y,
        },
        "cameraReadback": {
            "sensorFit": camera_data.sensor_fit,
            "sensorWidthMm": camera_data.sensor_width,
            "sensorHeightMm": camera_data.sensor_height,
            "lensMm": camera_data.lens,
            "angleXRadians": camera_data.angle_x,
            "angleYRadians": camera_data.angle_y,
            "requestedVerticalFovRadians": vertical_fov,
            "angleYRoundTripError": abs(camera_data.angle_y - vertical_fov),
            "effectiveFromViewFrame": effective_fov(camera_object, scene),
            "basisForwardError": basis_error,
            "basisUp": [basis_up.x, basis_up.y, basis_up.z],
            "clipStart": camera_data.clip_start,
            "clipEnd": camera_data.clip_end,
        },
        "points": points,
        "frameMapping": probe_frames(scene, spec["frame"]),
    }

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, sort_keys=True, indent=2) + "\n")
    print(f"[camera_probe] wrote {os.path.basename(out_path)}")


main()
