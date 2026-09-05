"""S0c probe 3 (Blender half): determinism measurement.

Renders the SAME frame twice, each in a FRESH Blender process (called
externally, once per invocation -- this script only builds+renders ONE run;
the shell driver invokes it twice per variant), for two variants:

  - "static": a lit, non-animated cube -- no motion blur.
  - "motionblur": the same animated cube from probe1 (rotating between frame
    1 and 2) with motion blur enabled, rendered at the mid-motion frame.

Also renders a "motionblur_noblur_check" variant (same scene/frame, blur
forced off) so probe3_determinism_compare.py can confirm the "motionblur"
variant actually produced a nonzero blur delta rather than landing on a
vacuously static shutter sample.

Each render saves BOTH PNG (8-bit) and WEBP (quality=100) from the SAME
render result, so determinism is checked for both formats, not just PNG.

Usage (note the required `--` before script args, Blender convention):
  /opt/homebrew/bin/blender --background --factory-startup --python \
    scripts/blender-link-spike/color-probe/probe3_determinism_blender.py -- \
    <static|motionblur|motionblur_noblur_check> <output_basename>

Byte-comparison and per-pixel delta happen OUTSIDE this script, in
probe3_determinism_compare.py (pure python3), across the pairs of files this
script produces.
"""

from __future__ import annotations

import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
GENERATED = os.path.join(HERE, "generated")
os.makedirs(GENERATED, exist_ok=True)

RESOLUTION = 320


def build_static_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0, -1))
    plane = bpy.context.active_object
    mat = bpy.data.materials.new("StaticFloorMat")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.6, 0.6, 0.6, 1.0)
    plane.data.materials.append(mat)

    bpy.ops.mesh.primitive_cube_add(size=1.2, location=(0, 0, 0.5))
    cube = bpy.context.active_object
    cmat = bpy.data.materials.new("StaticCubeMat")
    cmat.use_nodes = True
    cbsdf = cmat.node_tree.nodes.get("Principled BSDF")
    cbsdf.inputs["Base Color"].default_value = (0.8, 0.2, 0.1, 1.0)
    cbsdf.inputs["Roughness"].default_value = 0.35
    cube.data.materials.append(cmat)

    bpy.ops.object.light_add(type="SUN", location=(2, -2, 4))
    sun = bpy.context.active_object
    sun.data.energy = 3.0

    bpy.ops.object.camera_add(location=(4, -4, 2.2), rotation=(1.1, 0, 0.78))
    camera = bpy.context.active_object
    scene.camera = camera

    scene.frame_start = 1
    scene.frame_end = 1
    scene.frame_current = 1
    scene.render.use_motion_blur = False
    scene.render.engine = "BLENDER_EEVEE"
    # NOTE: scene.render.use_stamp=False does NOT suppress Blender's embedded
    # PNG tEXt metadata (Date, RenderTime, etc.) on this build when writing
    # via Image.save_render() -- verified empirically (see
    # probe3_determinism_compare.py's "static"/"motionblur" fileByteIdentical
    # results, which are still false for this exact reason). Kept here
    # anyway since it is still the semantically-correct setting to request
    # and may matter on other builds/paths (e.g. bpy.ops.render.render's own
    # write_still=True codepath, not used here); PNG determinism must be
    # judged on decoded pixel bytes (pixelDataByteIdentical), not whole-file
    # bytes. WebP output, in contrast, was empirically found to embed NO
    # such metadata chunk at all (single VP8L RIFF chunk, no EXIF/XMP), which
    # is why the WebP comparison achieves true whole-file byte identity.
    scene.render.use_stamp = False


def build_motionblur_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0, -1))
    plane = bpy.context.active_object
    mat = bpy.data.materials.new("MbFloorMat")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.6, 0.6, 0.6, 1.0)
    plane.data.materials.append(mat)

    bpy.ops.mesh.primitive_cube_add(size=1.2, location=(0, 0, 0.5))
    cube = bpy.context.active_object
    cmat = bpy.data.materials.new("MbCubeMat")
    cmat.use_nodes = True
    cbsdf = cmat.node_tree.nodes.get("Principled BSDF")
    cbsdf.inputs["Base Color"].default_value = (0.8, 0.2, 0.1, 1.0)
    cbsdf.inputs["Roughness"].default_value = 0.35
    cube.data.materials.append(cmat)

    cube.rotation_euler = (0, 0, 0)
    cube.keyframe_insert(data_path="rotation_euler", frame=1)
    cube.rotation_euler = (0, 0, 1.2)
    cube.keyframe_insert(data_path="rotation_euler", frame=2)

    bpy.ops.object.light_add(type="SUN", location=(2, -2, 4))
    sun = bpy.context.active_object
    sun.data.energy = 3.0

    bpy.ops.object.camera_add(location=(4, -4, 2.2), rotation=(1.1, 0, 0.78))
    camera = bpy.context.active_object
    scene.camera = camera
    camera.data.dof.use_dof = True
    camera.data.dof.focus_distance = 5.0
    camera.data.dof.aperture_fstop = 1.4
    camera.data.dof.focus_object = cube

    scene.frame_start = 1
    scene.frame_end = 2
    scene.frame_current = 2
    scene.render.use_motion_blur = True
    if hasattr(scene.render, "motion_blur_shutter"):
        scene.render.motion_blur_shutter = 0.5
    scene.render.engine = "BLENDER_EEVEE"
    # NOTE: scene.render.use_stamp=False does NOT suppress Blender's embedded
    # PNG tEXt metadata (Date, RenderTime, etc.) on this build when writing
    # via Image.save_render() -- verified empirically (see
    # probe3_determinism_compare.py's "static"/"motionblur" fileByteIdentical
    # results, which are still false for this exact reason). Kept here
    # anyway since it is still the semantically-correct setting to request
    # and may matter on other builds/paths (e.g. bpy.ops.render.render's own
    # write_still=True codepath, not used here); PNG determinism must be
    # judged on decoded pixel bytes (pixelDataByteIdentical), not whole-file
    # bytes. WebP output, in contrast, was empirically found to embed NO
    # such metadata chunk at all (single VP8L RIFF chunk, no EXIF/XMP), which
    # is why the WebP comparison achieves true whole-file byte identity.
    scene.render.use_stamp = False


def main() -> None:
    argv = sys.argv
    try:
        dash_idx = argv.index("--")
        args = argv[dash_idx + 1 :]
    except ValueError:
        args = []

    if len(args) != 2:
        raise SystemExit(
            "usage: blender ... --python probe3_determinism_blender.py -- "
            "<static|motionblur|motionblur_noblur_check> <output_basename>"
        )
    variant, out_basename = args
    if variant == "static":
        build_static_scene()
    elif variant == "motionblur":
        build_motionblur_scene()
    elif variant == "motionblur_noblur_check":
        # Sanity check requested in review: confirm the "motionblur" variant
        # actually produced blur (i.e. the sampled shutter interval was not
        # accidentally static), by rendering the SAME scene/frame with
        # use_motion_blur forced OFF. A nonzero pixel delta against the
        # "motionblur" render proves the blur path was live, not vacuous.
        build_motionblur_scene()
        bpy.context.scene.render.use_motion_blur = False
    else:
        raise SystemExit(f"unknown variant: {variant}")

    scene = bpy.context.scene
    scene.render.resolution_x = RESOLUTION
    scene.render.resolution_y = RESOLUTION
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False

    bpy.ops.render.render(write_still=False)
    render_result = bpy.data.images["Render Result"]

    png_path = os.path.join(GENERATED, f"{out_basename}.png")
    webp_path = os.path.join(GENERATED, f"{out_basename}.webp")

    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.color_mode = "RGBA"
    render_result.save_render(png_path, scene=scene)

    scene.render.image_settings.file_format = "WEBP"
    scene.render.image_settings.quality = 100
    scene.render.image_settings.color_mode = "RGBA"
    render_result.save_render(webp_path, scene=scene)

    print(
        f"DETERMINISM_RENDER_DONE variant={variant} png={png_path} webp={webp_path}"
    )


if __name__ == "__main__":
    main()
