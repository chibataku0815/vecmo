"""S0c probe 2 (Blender half): alpha convention measurement (straight vs
premultiplied), the "2a-a^2" precedent referenced in
docs/plans/active/blender-vecmo-integrated-motion-plan.html#s0 (S0c bullet 1)
and src/features/export/adapters/video.ts's documented double-composite bug.

Method: render the SAME emissive-red surface (Emission Strength 0.5, Base
Color black so no other light contribution) twice — once at Alpha=1.0
("full") and once at Alpha=0.5 ("half") — over a transparent film. Save each
render result to both PNG (8-bit RGBA) and OpenEXR (32-bit float linear).

Discriminator: if alpha is STRAIGHT, the stored RGB in "half" must match
"full" (color is independent of coverage). If alpha is PREMULTIPLIED, the
stored RGB in "half" must be roughly half (in LINEAR terms) of "full"'s RGB.
Because PNG is sRGB-encoded, "half the linear value" is NOT "half the 8-bit
code" — so we also decode the expected premultiplied 8-bit code via the sRGB
OETF and compare against measurement, rather than eyeballing raw bytes.

This script renders + reads pixels back INSIDE Blender via
`bpy.data.images.load` + `.pixels` only. A separate script
(`probe2_alpha_convention_external_png_parse.py`, no Blender/bpy dependency)
parses the PNG files' raw bytes externally (zlib inflate + scanline filter
reconstruction) to cross-check Blender's own read isn't silently
re-color-managing the numbers we report.

Run only via:
  /opt/homebrew/bin/blender --background --factory-startup --python \
    scripts/blender-link-spike/color-probe/probe2_alpha_convention_blender.py
"""

from __future__ import annotations

import json
import os

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
GENERATED = os.path.join(HERE, "generated")
EVIDENCE = os.path.join(HERE, "evidence")
os.makedirs(GENERATED, exist_ok=True)
os.makedirs(EVIDENCE, exist_ok=True)

RESOLUTION = 128
EMISSION_COLOR = (1.0, 0.0, 0.0)
EMISSION_STRENGTH = 0.5


def build_scene(alpha_value: float) -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, 0))
    plane = bpy.context.active_object
    plane.name = "AlphaProbePlane"
    plane.rotation_euler = (1.5707963, 0, 0)  # face +Y, toward camera below

    mat = bpy.data.materials.new(f"AlphaProbeMat_{alpha_value}")
    mat.use_nodes = True
    mat.blend_method = "BLEND"
    mat.surface_render_method = "BLENDED"
    mat.show_transparent_back = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    bsdf.inputs["Emission Color"].default_value = (
        EMISSION_COLOR[0],
        EMISSION_COLOR[1],
        EMISSION_COLOR[2],
        1.0,
    )
    bsdf.inputs["Emission Strength"].default_value = EMISSION_STRENGTH
    bsdf.inputs["Alpha"].default_value = alpha_value
    plane.data.materials.append(mat)

    bpy.ops.object.camera_add(location=(0, -3, 0), rotation=(1.5707963, 0, 0))
    camera = bpy.context.active_object
    scene.camera = camera

    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = RESOLUTION
    scene.render.resolution_y = RESOLUTION
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.filter_size = 0.0  # minimize anti-aliasing spread onto center px
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0


def srgb_encode(linear: float) -> float:
    if linear <= 0.0031308:
        return max(0.0, linear) * 12.92
    return 1.055 * (linear ** (1.0 / 2.4)) - 0.055


def render_and_save(alpha_value: float, tag: str) -> dict:
    build_scene(alpha_value)
    scene = bpy.context.scene
    bpy.ops.render.render(write_still=False)
    render_result = bpy.data.images["Render Result"]

    png_path = os.path.join(GENERATED, f"probe2-alpha-{tag}.png")
    exr_path = os.path.join(GENERATED, f"probe2-alpha-{tag}.exr")

    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.color_mode = "RGBA"
    render_result.save_render(png_path, scene=scene)

    scene.render.image_settings.file_format = "OPEN_EXR"
    scene.render.image_settings.color_depth = "32"
    scene.render.image_settings.exr_codec = "NONE"
    scene.render.image_settings.color_mode = "RGBA"
    render_result.save_render(exr_path, scene=scene)

    cx, cy = RESOLUTION // 2, RESOLUTION // 2

    def read_center_pixel(path: str) -> dict:
        img = bpy.data.images.load(path, check_existing=False)
        img.pixels[:]  # force load
        w, h = img.size
        idx = (cy * w + cx) * 4
        px = list(img.pixels[idx : idx + 4])
        info = {
            "path": path,
            "size": [w, h],
            "colorspaceName": img.colorspace_settings.name,
            "isFloat": img.is_float,
            "centerPixelRGBA_asReadByBpyPixels": px,
        }
        bpy.data.images.remove(img)
        return info

    png_read = read_center_pixel(png_path)
    exr_read = read_center_pixel(exr_path)

    return {
        "tag": tag,
        "alphaInput": alpha_value,
        "expectedEmissionLinear": [
            EMISSION_COLOR[0] * EMISSION_STRENGTH,
            EMISSION_COLOR[1] * EMISSION_STRENGTH,
            EMISSION_COLOR[2] * EMISSION_STRENGTH,
        ],
        "expectedEmissionSrgbEncodedIfStraightAlpha": [
            srgb_encode(EMISSION_COLOR[0] * EMISSION_STRENGTH),
            srgb_encode(EMISSION_COLOR[1] * EMISSION_STRENGTH),
            srgb_encode(EMISSION_COLOR[2] * EMISSION_STRENGTH),
        ],
        "expectedEmissionSrgbEncodedIfPremultiplied": [
            srgb_encode(EMISSION_COLOR[0] * EMISSION_STRENGTH * alpha_value),
            srgb_encode(EMISSION_COLOR[1] * EMISSION_STRENGTH * alpha_value),
            srgb_encode(EMISSION_COLOR[2] * EMISSION_STRENGTH * alpha_value),
        ],
        "png": png_read,
        "exr": exr_read,
    }


def main() -> None:
    full = render_and_save(1.0, "full")
    half = render_and_save(0.5, "half")

    def classify(full_rec: dict, half_rec: dict, fmt: str) -> dict:
        full_r = full_rec[fmt]["centerPixelRGBA_asReadByBpyPixels"][0]
        half_r = half_rec[fmt]["centerPixelRGBA_asReadByBpyPixels"][0]
        half_alpha = half_rec[fmt]["centerPixelRGBA_asReadByBpyPixels"][3]
        straight_dist = abs(half_r - full_r)
        # Premultiplied prediction depends on whether the format is linear
        # (EXR: multiply by raw alpha) or was sRGB-encoded before storage
        # (PNG, as read back by bpy which already linearizes on load — so the
        # comparison is done in the SAME linear space bpy handed us for both
        # formats; bpy always linearizes .pixels reads regardless of file).
        premult_expected_half_r = full_r * 0.5
        premult_dist = abs(half_r - premult_expected_half_r)
        verdict = "straight" if straight_dist < premult_dist else "premultiplied"
        return {
            "format": fmt,
            "fullR": full_r,
            "halfR": half_r,
            "halfAlpha": half_alpha,
            "distanceIfStraightHypothesis": straight_dist,
            "distanceIfPremultipliedHypothesis": premult_dist,
            "verdict": verdict,
        }

    png_verdict = classify(full, half, "png")
    exr_verdict = classify(full, half, "exr")

    out = {
        "note": (
            "bpy.data.images.load + .pixels ALWAYS returns Blender's internal "
            "linear float representation regardless of source file encoding "
            "(sRGB PNG bytes are decoded to linear on load unless colorspace "
            "is overridden). This means the 'png' verdict here characterizes "
            "what Blender's own PNG *reader* reconstructs, not the raw file "
            "bytes. The raw file-byte convention is checked independently by "
            "probe2_alpha_convention_external_png_parse.py."
        ),
        "resolution": RESOLUTION,
        "emissionColor": EMISSION_COLOR,
        "emissionStrength": EMISSION_STRENGTH,
        "full": full,
        "half": half,
        "verdictPerFormat_asReadByBpy": {
            "png": png_verdict,
            "exr": exr_verdict,
        },
    }

    out_path = os.path.join(EVIDENCE, "probe2-alpha-blender-read.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2, sort_keys=True)
    print("PROBE2_BLENDER_RESULT_JSON=" + out_path)
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
