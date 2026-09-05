"""Authors the S4 probe .blend in the SCRATCHPAD (never in the repo, never near a user source).

Exit-scene shape per plan section 8: one geometry-nodes reaction, EEVEE motion
blur, optical DOF, transparent alpha, 120 frames.

The frame-number bar is the whole point of this scene. It encodes the CURRENT
BLENDER FRAME NUMBER into the red channel of a flat emissive strip parented to
the camera:

  - Encoding is `linear = srgb_to_linear(blenderFrame / 255)`, so after the
    Standard view transform the written 8-bit red value is the frame number
    itself. A decoder therefore reads the producing side's own numbering, not a
    0-based counter. A bare counter could not distinguish "frame 5 is at index 5"
    from "every frame is off by a constant", which is exactly the F3 defect shape
    (Vecmo frame f sampling authored frame 2f) this probe has to rule out.

  - Keys are placed at HALF-FRAME offsets with CONSTANT interpolation. EEVEE's
    motion blur samples a shutter window centred on the frame, so a key placed
    at an integer frame would have the shutter straddle two different hold
    values and blend them. A key at n - 0.5 holds across the whole window.

  - The bar is parented to the camera, so it has zero relative motion (no motion
    blur on it) and a fixed screen position; being out of focus only softens its
    edges, and the decoder samples the uniform interior.
"""

from __future__ import annotations

import math
import os

import bpy
from mathutils import Matrix

OUT = os.environ["PROBE_BLEND_PATH"]

FRAME_START = 1
FRAME_COUNT = 120
WIDTH, HEIGHT = 640, 360
FPS = 24


def action_fcurves(action):
    """Blender 5.x slotted actions: `Action.fcurves` no longer exists."""
    if hasattr(action, "fcurves"):
        yield from action.fcurves
        return
    for layer in action.layers:
        for strip in layer.strips:
            for channelbag in strip.channelbags:
                yield from channelbag.fcurves


def srgb_to_linear(value: float) -> float:
    if value <= 0.04045:
        return value / 12.92
    return ((value + 0.055) / 1.055) ** 2.4


def clear() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def build_geometry_nodes_reaction():
    """A grid deformed by a travelling wave driven by Scene Time.

    Geometry nodes rather than a particle system on purpose: a seeded simulation
    would add cache and seed variables to the one comparison whose job is to
    isolate encode determinism.
    """
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 0))
    obj = bpy.context.active_object
    obj.name = "GNReaction"

    modifier = obj.modifiers.new("GeometryNodes", "NODES")
    tree = bpy.data.node_groups.new("ProbeReaction", "GeometryNodeTree")
    modifier.node_group = tree

    tree.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    tree.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    nodes, links = tree.nodes, tree.links

    group_in = nodes.new("NodeGroupInput")
    group_out = nodes.new("NodeGroupOutput")
    grid = nodes.new("GeometryNodeMeshGrid")
    grid.inputs["Size X"].default_value = 6.0
    grid.inputs["Size Y"].default_value = 6.0
    grid.inputs["Vertices X"].default_value = 64
    grid.inputs["Vertices Y"].default_value = 64

    position = nodes.new("GeometryNodeInputPosition")
    separate = nodes.new("ShaderNodeSeparateXYZ")
    scene_time = nodes.new("GeometryNodeInputSceneTime")

    # z = sin(x * 1.8 + seconds * 6.0) * 0.35
    scale_x = nodes.new("ShaderNodeMath")
    scale_x.operation = "MULTIPLY"
    scale_x.inputs[1].default_value = 1.8
    scale_t = nodes.new("ShaderNodeMath")
    scale_t.operation = "MULTIPLY"
    scale_t.inputs[1].default_value = 6.0
    add = nodes.new("ShaderNodeMath")
    add.operation = "ADD"
    sine = nodes.new("ShaderNodeMath")
    sine.operation = "SINE"
    amplitude = nodes.new("ShaderNodeMath")
    amplitude.operation = "MULTIPLY"
    amplitude.inputs[1].default_value = 0.35
    combine = nodes.new("ShaderNodeCombineXYZ")
    set_position = nodes.new("GeometryNodeSetPosition")

    links.new(grid.outputs["Mesh"], set_position.inputs["Geometry"])
    links.new(position.outputs["Position"], separate.inputs["Vector"])
    links.new(separate.outputs["X"], scale_x.inputs[0])
    links.new(scene_time.outputs["Seconds"], scale_t.inputs[0])
    links.new(scale_x.outputs["Value"], add.inputs[0])
    links.new(scale_t.outputs["Value"], add.inputs[1])
    links.new(add.outputs["Value"], sine.inputs[0])
    links.new(sine.outputs["Value"], amplitude.inputs[0])
    links.new(amplitude.outputs["Value"], combine.inputs["Z"])
    links.new(combine.outputs["Vector"], set_position.inputs["Offset"])
    links.new(set_position.outputs["Geometry"], group_out.inputs[0])

    material = bpy.data.materials.new("ProbeReactionMat")
    material.use_nodes = True
    bsdf = material.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.10, 0.45, 0.85, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.25
    bsdf.inputs["Metallic"].default_value = 0.4
    obj.data.materials.append(material)
    return obj


def build_fast_mover():
    """A rigidly keyframed sphere: guarantees observable object motion blur.

    The geometry-nodes deformation may or may not produce motion vectors, so a
    probe that relied on it alone could report "motion blur enabled" while
    measuring nothing.
    """
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.45, location=(-3.0, 0, 0.9))
    obj = bpy.context.active_object
    obj.name = "FastMover"
    bpy.ops.object.shade_smooth()
    material = bpy.data.materials.new("FastMoverMat")
    material.use_nodes = True
    bsdf = material.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.95, 0.35, 0.10, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.2
    obj.data.materials.append(material)

    obj.location = (-3.0, 0, 0.9)
    obj.keyframe_insert("location", frame=FRAME_START)
    obj.location = (3.0, 0, 0.9)
    obj.keyframe_insert("location", frame=FRAME_START + FRAME_COUNT - 1)
    for fcurve in action_fcurves(obj.animation_data.action):
        for keyframe in fcurve.keyframe_points:
            keyframe.interpolation = "LINEAR"
    return obj


def build_camera():
    data = bpy.data.cameras.new("ProbeCamera")
    data.sensor_fit = "VERTICAL"
    data.angle_y = math.radians(38.0)
    data.dof.use_dof = True
    data.dof.aperture_fstop = 1.8
    data.dof.focus_distance = 8.0
    obj = bpy.data.objects.new("ProbeCamera", data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = (0.0, -8.0, 2.6)
    obj.rotation_euler = (math.radians(76.0), 0.0, 0.0)
    bpy.context.scene.camera = obj
    return obj


def build_frame_number_bar(camera_object) -> None:
    """Emissive strip whose red channel is the current Blender frame number."""
    camera_data = camera_object.data
    distance = 1.0
    half_height = math.tan(camera_data.angle_y / 2.0) * distance
    aspect = WIDTH / HEIGHT
    half_width = half_height * aspect
    bar_half_height = half_height * 0.12

    bpy.ops.mesh.primitive_plane_add(size=2.0)
    bar = bpy.context.active_object
    bar.name = "FrameNumberBar"
    bar.parent = camera_object
    bar.parent_type = "OBJECT"
    # Identity parent inverse, so the bar's local transform IS camera-local:
    # +X right, +Y up, -Z forward. Deriving the inverse from `matrix_world`
    # would read a matrix the depsgraph has not re-evaluated since the camera
    # was placed.
    bar.matrix_parent_inverse = Matrix.Identity(4)
    # A default plane already lies in local XY with its normal along +Z, which
    # faces a camera looking down -Z. Rotating it would stand it edge-on.
    bar.location = (0.0, -(half_height - bar_half_height), -distance)
    bar.rotation_euler = (0.0, 0.0, 0.0)
    bar.scale = (half_width * 1.05, bar_half_height, 1.0)

    material = bpy.data.materials.new("FrameNumberBarMat")
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()
    emission = tree.nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = 1.0
    output = tree.nodes.new("ShaderNodeOutputMaterial")
    tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    bar.data.materials.append(material)

    color_input = emission.inputs["Color"]
    for index in range(FRAME_COUNT):
        blender_frame = FRAME_START + index
        encoded = srgb_to_linear(blender_frame / 255.0)
        color_input.default_value = (encoded, 0.0, 0.0, 1.0)
        # Half-frame key: the value must be constant across the whole motion-blur
        # shutter window centred on `blender_frame`.
        color_input.keyframe_insert("default_value", frame=blender_frame - 0.5)
    for fcurve in action_fcurves(material.node_tree.animation_data.action):
        for keyframe in fcurve.keyframe_points:
            keyframe.interpolation = "CONSTANT"


def main() -> None:
    clear()
    scene = bpy.context.scene
    scene.frame_start = FRAME_START
    scene.frame_end = FRAME_START + FRAME_COUNT - 1
    scene.render.fps = FPS
    scene.render.resolution_x = WIDTH
    scene.render.resolution_y = HEIGHT
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.film_transparent = True
    scene.render.use_motion_blur = True
    scene.render.motion_blur_shutter = 0.5
    scene.render.motion_blur_position = "CENTER"
    scene.view_settings.view_transform = "Standard"

    build_geometry_nodes_reaction()
    build_fast_mover()

    bpy.ops.object.light_add(type="AREA", location=(3, -4, 6))
    light = bpy.context.active_object
    light.data.energy = 900.0
    light.data.size = 4.0

    camera = build_camera()
    build_frame_number_bar(camera)

    # This is the ONLY save in the S4 work, it targets the scratchpad, and it
    # authors the probe fixture rather than touching any user source. Blender
    # writes a `.blend1` sibling next to it, which is why it lives here.
    bpy.ops.wm.save_as_mainfile(filepath=OUT)
    print(f"[probe] wrote {OUT}")


main()
