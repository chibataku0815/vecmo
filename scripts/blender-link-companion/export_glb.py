"""Deterministic GLB export for the production-link companion.

Run:
    blender --background --factory-startup --python-exit-code 1 \
        <source.blend> --python export_glb.py -- --out <temp.glb>

Two disciplines are load-bearing here:

1. Nothing is written next to the user's source. The destination is a companion
   -chosen temporary path, and `assert_destination_is_outside_source_dir()`
   fails the run if it ever resolves into the source's own directory. That guard
   exists because Blender's `save_as_mainfile` writes a `.blend1` backup sibling
   next to whatever it saves, so "export near the source" is one refactor away
   from mutating the user's workspace. No save operator is called at all —
   `assert_no_save_operators()` re-checks that at runtime.

2. Every export setting is an explicit named constant. The glTF exporter's
   defaults have drifted across Blender releases, and an unpinned default is an
   unhashed input: the build key would claim two outputs are the same request
   while the exporter quietly produced different bytes. `+Y up` is pinned
   because glTF is a Y-up format and Blender is Z-up; modifiers are applied so
   the artifact is the evaluated mesh the author sees, not its unevaluated
   input.
"""

from __future__ import annotations

import os
import sys

import bpy

EXPORT_FORMAT = "GLB"
EXPORT_YUP = True
EXPORT_APPLY_MODIFIERS = True
EXPORT_ANIMATIONS = True
EXPORT_ANIMATION_MODE = "ACTIONS"
EXPORT_FRAME_RANGE = True
EXPORT_BAKE_ANIMATION = False
EXPORT_OPTIMIZE_ANIMATION_SIZE = False
EXPORT_FORCE_SAMPLING = False
EXPORT_MATERIALS = "EXPORT"
EXPORT_IMAGE_FORMAT = "AUTO"
EXPORT_CAMERAS = False
EXPORT_LIGHTS = False
EXPORT_EXTRAS = False
EXPORT_DRACO = False
EXPORT_NORMALS = True
EXPORT_TEXCOORDS = True
EXPORT_TANGENTS = False
EXPORT_SKINS = True
EXPORT_MORPH = True
USE_SELECTION = False
USE_VISIBLE = False
USE_RENDERABLE = False
USE_ACTIVE_COLLECTION = False
USE_ACTIVE_SCENE = True
CHECK_EXISTING = False


def script_args() -> list[str]:
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1 :]


def out_path() -> str:
    args = script_args()
    if "--out" not in args:
        raise SystemExit("export_glb.py requires --out <path>")
    return os.path.abspath(args[args.index("--out") + 1])


def assert_no_save_operators() -> None:
    """Fail closed if this file ever grows a `.blend` save call site."""
    with open(__file__, "r", encoding="utf-8") as handle:
        source = handle.read()
    needles = ("wm." + "save_", "ops." + "wm.save", "bpy.ops." + "wm.save")
    for needle in needles:
        if needle in source:
            raise SystemExit(f"export_glb.py must not contain a {needle!r} call site")


def assert_destination_is_outside_source_dir(destination: str) -> None:
    source = bpy.data.filepath
    if not source:
        return
    source_dir = os.path.realpath(os.path.dirname(os.path.abspath(source)))
    destination_dir = os.path.realpath(os.path.dirname(destination))
    if destination_dir == source_dir:
        raise SystemExit(
            "export_glb.py refuses to write an artifact into the source directory"
        )


def main() -> None:
    assert_no_save_operators()
    destination = out_path()
    assert_destination_is_outside_source_dir(destination)
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=destination,
        check_existing=CHECK_EXISTING,
        export_format=EXPORT_FORMAT,
        export_yup=EXPORT_YUP,
        export_apply=EXPORT_APPLY_MODIFIERS,
        export_animations=EXPORT_ANIMATIONS,
        export_animation_mode=EXPORT_ANIMATION_MODE,
        export_frame_range=EXPORT_FRAME_RANGE,
        export_bake_animation=EXPORT_BAKE_ANIMATION,
        export_optimize_animation_size=EXPORT_OPTIMIZE_ANIMATION_SIZE,
        export_force_sampling=EXPORT_FORCE_SAMPLING,
        export_materials=EXPORT_MATERIALS,
        export_image_format=EXPORT_IMAGE_FORMAT,
        export_cameras=EXPORT_CAMERAS,
        export_lights=EXPORT_LIGHTS,
        export_extras=EXPORT_EXTRAS,
        export_draco_mesh_compression_enable=EXPORT_DRACO,
        export_normals=EXPORT_NORMALS,
        export_texcoords=EXPORT_TEXCOORDS,
        export_tangents=EXPORT_TANGENTS,
        export_skins=EXPORT_SKINS,
        export_morph=EXPORT_MORPH,
        use_selection=USE_SELECTION,
        use_visible=USE_VISIBLE,
        use_renderable=USE_RENDERABLE,
        use_active_collection=USE_ACTIVE_COLLECTION,
        use_active_scene=USE_ACTIVE_SCENE,
    )
    if not os.path.exists(destination) or os.path.getsize(destination) == 0:
        raise SystemExit("export_glb.py produced no artifact bytes")
    print(f"[export] wrote {os.path.getsize(destination)} bytes")


main()
