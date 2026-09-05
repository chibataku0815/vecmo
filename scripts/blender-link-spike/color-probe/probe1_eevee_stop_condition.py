"""S0c probe 1: headless EEVEE (and Cycles fallback) stop-condition check.

Builds a tiny scene (emissive plane + cube + camera), enables motion blur AND
depth-of-field, renders 1 frame at 640x360 PNG under `blender --background
--factory-startup`. Records whether EEVEE succeeds (GPU path) and whether
Cycles succeeds as a fallback. This is a PLAN STOP CONDITION per
docs/plans/active/blender-vecmo-integrated-motion-plan.html#s0 (S0c / Stop):
"headless EEVEE/GPU が --background で motion blur+DOF render に使えない".

Run only via:
  /opt/homebrew/bin/blender --background --factory-startup --python \
    scripts/blender-link-spike/color-probe/probe1_eevee_stop_condition.py

Writes evidence/probe1-eevee-stop-condition.json and, on success, PNGs under
generated/.
"""

from __future__ import annotations

import json
import os
import sys
import time
import traceback

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
GENERATED = os.path.join(HERE, "generated")
EVIDENCE = os.path.join(HERE, "evidence")
os.makedirs(GENERATED, exist_ok=True)
os.makedirs(EVIDENCE, exist_ok=True)


def build_scene() -> None:
    """Clear the factory-startup scene and build: emissive plane, cube, camera."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    # Emissive plane (acts as an area-ish light + a flat surface for alpha/color
    # probes elsewhere; here it just needs to exist and emit).
    bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0, -1))
    plane = bpy.context.active_object
    plane.name = "EmissivePlane"
    mat = bpy.data.materials.new("EmissiveMat")
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    emission = nt.nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = (1.0, 0.6, 0.2, 1.0)
    emission.inputs["Strength"].default_value = 3.0
    output = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    plane.data.materials.append(mat)

    # Cube, animated (rotation) so motion blur has something to blur.
    bpy.ops.mesh.primitive_cube_add(size=1.2, location=(0, 0, 0.5))
    cube = bpy.context.active_object
    cube.name = "MotionCube"
    cube.rotation_euler = (0, 0, 0)
    cube.keyframe_insert(data_path="rotation_euler", frame=1)
    cube.rotation_euler = (0, 0, 1.2)
    cube.keyframe_insert(data_path="rotation_euler", frame=2)
    # Blender 5.x moved actions to a layered layer/strip/channelbag model, so
    # `action.fcurves` no longer exists directly; walk the layered structure
    # if present, otherwise fall back to the legacy flat `fcurves` attribute.
    # Interpolation mode is not essential to this smoke test (only affects how
    # smooth the motion-blur delta is), so failures here are non-fatal.
    try:
        action = cube.animation_data.action if cube.animation_data else None
        fcurves = []
        if action is not None:
            if hasattr(action, "fcurves"):
                fcurves = list(action.fcurves)
            elif hasattr(action, "layers"):
                for layer in action.layers:
                    for strip in layer.strips:
                        for channelbag in getattr(strip, "channelbags", []):
                            fcurves.extend(channelbag.fcurves)
        for fcurve in fcurves:
            for kp in fcurve.keyframe_points:
                kp.interpolation = "LINEAR"
    except Exception as exc:  # non-fatal; recorded for evidence completeness
        print(f"NOTE: interpolation-mode set skipped: {type(exc).__name__}: {exc}")

    # Camera
    bpy.ops.object.camera_add(location=(4, -4, 2.2), rotation=(1.1, 0, 0.78))
    camera = bpy.context.active_object
    camera.name = "ProbeCamera"
    scene.camera = camera
    camera.data.dof.use_dof = True
    camera.data.dof.focus_distance = 5.0
    camera.data.dof.aperture_fstop = 1.4
    camera.data.dof.focus_object = cube

    scene.frame_start = 1
    scene.frame_end = 2
    scene.frame_current = 2  # mid-motion frame so blur has a delta to sample

    scene.render.resolution_x = 640
    scene.render.resolution_y = 360
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.render.use_motion_blur = True
    if hasattr(scene.render, "motion_blur_shutter"):
        scene.render.motion_blur_shutter = 0.5


def list_available_engines() -> list[str]:
    try:
        items = bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items
        return [item.identifier for item in items]
    except Exception:
        return []


def try_render(engine_id: str, out_name: str, extra: dict) -> dict:
    """Attempt to set `engine_id` and render 1 frame; return a result record."""
    scene = bpy.context.scene
    record: dict = {"engine": engine_id, "attempted": True}
    t0 = time.time()
    try:
        scene.render.engine = engine_id
    except Exception as exc:  # engine identifier not recognized on this build
        record["succeeded"] = False
        record["stage"] = "set_engine"
        record["error"] = f"{type(exc).__name__}: {exc}"
        record["traceback"] = traceback.format_exc()
        record["elapsedSeconds"] = time.time() - t0
        return record

    record["engineAfterSet"] = scene.render.engine

    # GPU device probe (Cycles-specific; EEVEE always uses the GPU backend
    # implicitly via the platform's graphics API, e.g. Metal on macOS).
    if engine_id == "CYCLES":
        try:
            prefs = bpy.context.preferences.addons["cycles"].preferences
            prefs.compute_device_type = "METAL"
            prefs.get_devices()
            gpu_devices = [
                d.name for d in prefs.devices if d.type == "METAL"
            ]
            record["cyclesComputeDeviceType"] = prefs.compute_device_type
            record["cyclesGpuDevicesFound"] = gpu_devices
            if gpu_devices:
                scene.cycles.device = "GPU"
                for d in prefs.devices:
                    d.use = d.type == "METAL"
            else:
                scene.cycles.device = "CPU"
            record["cyclesDeviceUsed"] = scene.cycles.device
        except Exception as exc:
            record["cyclesGpuProbeError"] = f"{type(exc).__name__}: {exc}"

    out_path = os.path.join(GENERATED, out_name)
    scene.render.filepath = out_path
    try:
        bpy.ops.render.render(write_still=True)
        record["succeeded"] = os.path.isfile(out_path)
        record["stage"] = "render"
        record["outputPath"] = out_path
        record["outputFileSizeBytes"] = (
            os.path.getsize(out_path) if os.path.isfile(out_path) else None
        )
    except Exception as exc:
        record["succeeded"] = False
        record["stage"] = "render"
        record["error"] = f"{type(exc).__name__}: {exc}"
        record["traceback"] = traceback.format_exc()
    record["elapsedSeconds"] = time.time() - t0
    record.update(extra)
    return record


def main() -> None:
    build_scene()
    available_engines = list_available_engines()

    results = []

    eevee_candidates = ["BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"]
    eevee_result = None
    for candidate in eevee_candidates:
        if candidate in available_engines:
            eevee_result = try_render(
                candidate,
                "probe1-eevee-motionblur-dof.png",
                {"dofEnabled": True, "motionBlurEnabled": True, "resolution": [640, 360]},
            )
            break
    if eevee_result is None:
        eevee_result = {
            "engine": None,
            "attempted": False,
            "succeeded": False,
            "stage": "engine_not_found",
            "note": (
                "Neither BLENDER_EEVEE_NEXT nor BLENDER_EEVEE present in "
                "available render engines on this build."
            ),
        }
    results.append(eevee_result)

    cycles_result = try_render(
        "CYCLES",
        "probe1-cycles-motionblur-dof.png",
        {"dofEnabled": True, "motionBlurEnabled": True, "resolution": [640, 360]},
    )
    results.append(cycles_result)

    eevee_ok = bool(eevee_result.get("succeeded"))
    cycles_ok = bool(cycles_result.get("succeeded"))

    stop_condition_triggered = not eevee_ok
    verdict = {
        "planStopConditionRef": (
            "docs/plans/active/blender-vecmo-integrated-motion-plan.html#s0 "
            "S0c Stop: 'headless EEVEE/GPU が --background で motion blur+DOF "
            "render に使えない'"
        ),
        "blenderVersion": bpy.app.version_string,
        "availableRenderEngines": available_engines,
        "eevee": eevee_result,
        "cycles": cycles_result,
        "eeveeHeadlessMotionBlurDofSucceeded": eevee_ok,
        "cyclesFallbackSucceeded": cycles_ok,
        "stopConditionTriggered": stop_condition_triggered,
        "verdictSummary": (
            "PASS: headless EEVEE renders motion blur + DOF successfully; no stop condition."
            if eevee_ok
            else (
                "STOP CONDITION TRIGGERED: headless EEVEE failed motion blur+DOF render. "
                + (
                    "Cycles fallback succeeded (usable as GPU/CPU render path substitute)."
                    if cycles_ok
                    else "Cycles fallback ALSO failed; no headless render path confirmed."
                )
            )
        ),
    }

    out_json = os.path.join(EVIDENCE, "probe1-eevee-stop-condition.json")
    with open(out_json, "w") as f:
        json.dump(verdict, f, indent=2, sort_keys=True)
    print("PROBE1_RESULT_JSON=" + out_json)
    print(json.dumps(verdict, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
