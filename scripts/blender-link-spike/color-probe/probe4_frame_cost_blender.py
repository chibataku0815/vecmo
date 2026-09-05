"""S0c probe 4 (Blender half): per-frame render cost + storage measurement.

Renders 10 frames (1..10) of an animated scene at 1920x1080 RGBA, saving the
SAME computed render result (one render call per frame, no re-render) to
both PNG (8-bit) and WebP (quality=100, the closest bpy exposes to
"lossless" -- see note below) so the size comparison is apples-to-apples.

IMPORTANT FINDING recorded here: Blender's `ImageFormatSettings` for
file_format='WEBP' exposes only `quality` (0-100, lossy) and `compression`
(encoder effort/speed tradeoff) -- there is NO `use_lossless` /
`webp_lossless` boolean anywhere in its RNA properties on this build. So
"WebP lossless" is requested via quality=100, which is libwebp's
near-lossless-at-max-quality behavior, not a guaranteed bit-exact lossless
mode. `probe4_webp_fidelity_check.py` (external, uses Pillow) verifies
empirically whether quality=100 output is in fact pixel-identical to the
PNG for a sample frame.

Run only via:
  /opt/homebrew/bin/blender --background --factory-startup --python \
    scripts/blender-link-spike/color-probe/probe4_frame_cost_blender.py
"""

from __future__ import annotations

import json
import os
import time

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
GENERATED = os.path.join(HERE, "generated")
EVIDENCE = os.path.join(HERE, "evidence")
os.makedirs(GENERATED, exist_ok=True)
os.makedirs(EVIDENCE, exist_ok=True)

WIDTH, HEIGHT = 1920, 1080
FRAME_COUNT = 10
BENCHMARK_ENVELOPE_FRAMES = 120  # per plan input: "既存... 120-frame benchmark envelope"


def build_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, -1))
    plane = bpy.context.active_object
    mat = bpy.data.materials.new("Frame4FloorMat")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.15, 0.15, 0.18, 1.0)
    plane.data.materials.append(mat)

    bpy.ops.mesh.primitive_ico_sphere_add(radius=0.9, location=(0, 0, 0.8))
    sphere = bpy.context.active_object
    smat = bpy.data.materials.new("Frame4SphereMat")
    smat.use_nodes = True
    sbsdf = smat.node_tree.nodes.get("Principled BSDF")
    sbsdf.inputs["Base Color"].default_value = (0.9, 0.35, 0.15, 1.0)
    sbsdf.inputs["Roughness"].default_value = 0.25
    sbsdf.inputs["Metallic"].default_value = 0.6
    sphere.data.materials.append(smat)

    sphere.rotation_euler = (0, 0, 0)
    sphere.location = (-2.0, 0, 0.8)
    sphere.keyframe_insert(data_path="location", frame=1)
    sphere.keyframe_insert(data_path="rotation_euler", frame=1)
    sphere.location = (2.0, 0, 0.8)
    sphere.rotation_euler = (0, 0, 6.28318)
    sphere.keyframe_insert(data_path="location", frame=FRAME_COUNT)
    sphere.keyframe_insert(data_path="rotation_euler", frame=FRAME_COUNT)

    bpy.ops.object.light_add(type="AREA", location=(2, -2, 4))
    light = bpy.context.active_object
    light.data.energy = 400.0
    light.data.size = 3.0

    bpy.ops.object.camera_add(location=(0, -6.5, 2.0), rotation=(1.35, 0, 0))
    camera = bpy.context.active_object
    scene.camera = camera

    scene.frame_start = 1
    scene.frame_end = FRAME_COUNT
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = WIDTH
    scene.render.resolution_y = HEIGHT
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.use_motion_blur = False
    # NOTE: use_stamp=False does NOT actually suppress PNG's embedded Date/
    # RenderTime tEXt metadata on this Blender build (verified in
    # probe3_determinism_blender.py/probe3_determinism_compare.py) -- kept
    # here anyway as the semantically-correct setting, but PNG file sizes
    # below include a few dozen bytes of per-frame-varying metadata that do
    # not affect the pixel content or the size comparison's conclusions.
    # WebP output was independently confirmed to embed no such metadata.
    scene.render.use_stamp = False


def main() -> None:
    build_scene()
    scene = bpy.context.scene

    per_frame = []
    for frame in range(1, FRAME_COUNT + 1):
        scene.frame_current = frame
        t0 = time.time()
        bpy.ops.render.render(write_still=False)
        render_elapsed = time.time() - t0
        render_result = bpy.data.images["Render Result"]

        png_path = os.path.join(GENERATED, f"probe4-frame-{frame:03d}.png")
        webp_path = os.path.join(GENERATED, f"probe4-frame-{frame:03d}.webp")

        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_depth = "8"
        scene.render.image_settings.color_mode = "RGBA"
        t1 = time.time()
        render_result.save_render(png_path, scene=scene)
        png_save_elapsed = time.time() - t1

        scene.render.image_settings.file_format = "WEBP"
        scene.render.image_settings.quality = 100
        scene.render.image_settings.color_mode = "RGBA"
        t2 = time.time()
        render_result.save_render(webp_path, scene=scene)
        webp_save_elapsed = time.time() - t2

        per_frame.append(
            {
                "frame": frame,
                "renderElapsedSeconds": render_elapsed,
                "pngPath": png_path,
                "pngSizeBytes": os.path.getsize(png_path),
                "pngSaveElapsedSeconds": png_save_elapsed,
                "webpPath": webp_path,
                "webpSizeBytes": os.path.getsize(webp_path),
                "webpSaveElapsedSeconds": webp_save_elapsed,
            }
        )

    png_sizes = [f["pngSizeBytes"] for f in per_frame]
    webp_sizes = [f["webpSizeBytes"] for f in per_frame]
    render_times = [f["renderElapsedSeconds"] for f in per_frame]

    def stats(values: list[float]) -> dict:
        return {
            "mean": sum(values) / len(values),
            "min": min(values),
            "max": max(values),
            "sum": sum(values),
        }

    png_stats = stats(png_sizes)
    webp_stats = stats(webp_sizes)
    render_time_stats = stats(render_times)

    out = {
        "resolution": [WIDTH, HEIGHT],
        "frameCount": FRAME_COUNT,
        "benchmarkEnvelopeFrames": BENCHMARK_ENVELOPE_FRAMES,
        "webpLosslessCaveat": (
            "bpy ImageFormatSettings for WEBP exposes only `quality` (lossy, "
            "0-100) and `compression` (encoder effort); there is no "
            "`use_lossless` boolean on this Blender build. quality=100 was "
            "used as the closest available setting. Empirical lossless "
            "verification is in probe4_webp_fidelity_check.py (external, "
            "Pillow-based)."
        ),
        "perFrame": per_frame,
        "png": {
            "sizeBytesStats": png_stats,
            "extrapolated120FrameTotalBytes": png_stats["mean"] * BENCHMARK_ENVELOPE_FRAMES,
            "extrapolated120FrameTotalMB": (
                png_stats["mean"] * BENCHMARK_ENVELOPE_FRAMES / (1024 * 1024)
            ),
        },
        "webp": {
            "sizeBytesStats": webp_stats,
            "extrapolated120FrameTotalBytes": webp_stats["mean"] * BENCHMARK_ENVELOPE_FRAMES,
            "extrapolated120FrameTotalMB": (
                webp_stats["mean"] * BENCHMARK_ENVELOPE_FRAMES / (1024 * 1024)
            ),
        },
        "renderTimeSecondsStats": render_time_stats,
        "webpToPngSizeRatioMean": webp_stats["mean"] / png_stats["mean"],
    }

    out_path = os.path.join(EVIDENCE, "probe4-frame-cost-and-storage.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2, sort_keys=True)
    print("PROBE4_RESULT_JSON=" + out_path)
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
