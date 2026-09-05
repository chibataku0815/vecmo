"""S0a spike fixture generator.

Run:
    blender --background --factory-startup --python-exit-code 1 \
        --python make_test_blend.py -- --out generated/spike-source.blend

Creates a deliberately small source: one cube with a Principled BSDF (non
default base color + metallic), one area light, two numeric custom properties
(`impactFrame` with UI min/max on the Scene, `heroLift` without UI metadata on
the object), one boolean custom property that inspect.py must reject as a
published-control candidate, and a short Z-location animation over frames 1..48.

This script is the only script in the spike that writes a .blend, and it only
ever writes to the `--out` path it is given (spike-owned `generated/`).
"""

from __future__ import annotations

import os
import sys

import bpy

CUBE_NAME = "SpikeHero"
LIGHT_NAME = "SpikeKey"
MATERIAL_NAME = "SpikeHeroMaterial"
ACTION_FRAME_START = 1
ACTION_FRAME_END = 48
SCENE_FPS = 24
IMPACT_FRAME_DEFAULT = 60.0
IMPACT_FRAME_MIN = 0.0
IMPACT_FRAME_MAX = 240.0
HERO_LIFT_DEFAULT = 0.35
BASE_COLOR = (0.184, 0.541, 0.855, 1.0)
METALLIC = 0.75
ROUGHNESS = 0.28


def script_args() -> list[str]:
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1 :]


def out_path() -> str:
    args = script_args()
    if "--out" not in args:
        raise SystemExit("make_test_blend.py requires --out <path>")
    return os.path.abspath(args[args.index("--out") + 1])


def clear_scene() -> None:
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh, do_unlink=True)
    for material in list(bpy.data.materials):
        bpy.data.materials.remove(material, do_unlink=True)


def set_socket(node, name: str, value) -> None:
    socket = node.inputs.get(name)
    if socket is None:
        raise SystemExit(f"Principled BSDF has no input named {name!r}")
    socket.default_value = value


def build_material():
    material = bpy.data.materials.new(MATERIAL_NAME)
    material.use_nodes = True
    principled = next(
        (node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"),
        None,
    )
    if principled is None:
        raise SystemExit("factory Principled BSDF node missing")
    set_socket(principled, "Base Color", BASE_COLOR)
    set_socket(principled, "Metallic", METALLIC)
    set_socket(principled, "Roughness", ROUGHNESS)
    return material


def build_cube():
    bpy.ops.mesh.primitive_cube_add(size=2.0, location=(0.0, 0.0, 0.0))
    cube = bpy.context.active_object
    cube.name = CUBE_NAME
    cube.data.name = f"{CUBE_NAME}Mesh"
    cube.data.materials.append(build_material())
    return cube


def build_light():
    bpy.ops.object.light_add(type="AREA", location=(3.0, -3.0, 5.0))
    light = bpy.context.active_object
    light.name = LIGHT_NAME
    light.data.name = f"{LIGHT_NAME}Data"
    light.data.energy = 240.0
    light.data.size = 2.5
    return light


def animate_cube(cube) -> None:
    keys = ((ACTION_FRAME_START, 0.0), (24, 3.0), (ACTION_FRAME_END, 0.5))
    for frame, z_value in keys:
        cube.location.z = z_value
        cube.keyframe_insert(data_path="location", index=2, frame=frame)


def add_custom_properties(scene, cube) -> None:
    scene["impactFrame"] = IMPACT_FRAME_DEFAULT
    scene.id_properties_ui("impactFrame").update(
        min=IMPACT_FRAME_MIN,
        max=IMPACT_FRAME_MAX,
        default=IMPACT_FRAME_DEFAULT,
        description="Frame at which the hero impact lands.",
    )
    cube["heroLift"] = HERO_LIFT_DEFAULT
    # Deliberately no id_properties_ui update: exercises the "no UI range" branch.
    cube["spikeDebugFlag"] = True
    # Deliberately boolean: inspect.py must reject it as a numeric control
    # candidate even though `isinstance(True, int)` is True in Python.


def main() -> None:
    destination = out_path()
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    scene = bpy.context.scene
    clear_scene()
    cube = build_cube()
    build_light()
    animate_cube(cube)
    scene.name = "SpikeScene"
    scene.render.fps = SCENE_FPS
    scene.render.fps_base = 1.0
    scene.frame_start = ACTION_FRAME_START
    scene.frame_end = ACTION_FRAME_END
    scene.frame_set(ACTION_FRAME_START)
    add_custom_properties(scene, cube)
    bpy.ops.wm.save_as_mainfile(filepath=destination, compress=False)
    print(f"[make_test_blend] wrote {os.path.basename(destination)}")


main()
