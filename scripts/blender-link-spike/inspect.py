"""S0a read-only Blender source inspector.

Run:
    blender --background --factory-startup --python-exit-code 1 \
        <source.blend> --python inspect.py -- --out <manifest.json>

Guarantee (stated exactly as design §7 requires): this script never saves over
the user's file. Headless Python always mutates in-memory datablocks, so the
honest guarantee is "no save operator is ever called", not "nothing changes".
`assert_no_save_operators()` below re-checks that this module contains no
`bpy.ops.wm` save-operator call site at all.

The emitted manifest carries no absolute path, no source bytes, and no Python
expression. `assert_no_path_leak()` fails the run if any path fragment or the
OS username reaches the manifest.
"""

from __future__ import annotations

import getpass
import hashlib
import json
import os
import platform
import sys

import bpy

MANIFEST_VERSION = 1
GENERIC_PATH_ROOTS = frozenset(
    {"/", "/Users", "/home", "/private", "/tmp", "/var", "/opt", "/mnt", "/media"}
)
MIN_LEAK_FRAGMENT_LENGTH = 6
# FLT_MAX: Blender's "no range declared" sentinel in id_properties_ui().
FLOAT32_SENTINEL = 3.0e38
FILEPATH_COLLECTIONS = (
    "images",
    "libraries",
    "sounds",
    "movieclips",
    "fonts",
    "cache_files",
    "texts",
    "volumes",
)
PROCEDURAL_TEXTURE_NODE_TYPES = frozenset(
    {
        "TEX_BRICK",
        "TEX_CHECKER",
        "TEX_GRADIENT",
        "TEX_MAGIC",
        "TEX_MUSGRAVE",
        "TEX_NOISE",
        "TEX_VORONOI",
        "TEX_WAVE",
        "TEX_WHITE_NOISE",
        "TEX_SKY",
        "TEX_GABOR",
    }
)
IMAGE_TEXTURE_NODE_TYPES = frozenset({"TEX_IMAGE", "TEX_ENVIRONMENT"})
PHYSICS_MODIFIER_TYPES = frozenset(
    {"CLOTH", "SOFT_BODY", "FLUID", "DYNAMIC_PAINT", "COLLISION", "OCEAN", "EXPLODE"}
)
SIMULATION_NODE_TYPES = frozenset({"SIMULATION_INPUT", "SIMULATION_OUTPUT"})


def script_args() -> list[str]:
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1 :]


def out_path() -> str:
    args = script_args()
    if "--out" not in args:
        raise SystemExit("inspect.py requires --out <path>")
    return os.path.abspath(args[args.index("--out") + 1])


def assert_no_save_operators() -> None:
    """Fail closed if this file ever grows a save call site.

    The forbidden needles are assembled at runtime so this guard cannot match
    its own source text.
    """
    with open(__file__, "r", encoding="utf-8") as handle:
        source = handle.read()
    needles = ("wm." + "save_", "ops." + "wm.save", "bpy.ops." + "wm.save")
    for needle in needles:
        if needle in source:
            raise SystemExit(f"inspect.py must not contain a {needle!r} call site")


def sha256_file(path: str) -> str | None:
    try:
        with open(path, "rb") as handle:
            return hashlib.sha256(handle.read()).hexdigest()
    except OSError:
        return None


def is_bool(value) -> bool:
    return isinstance(value, bool)


def is_numeric(value) -> bool:
    return isinstance(value, (int, float)) and not is_bool(value)


def numeric_property_ui(datablock, key: str) -> dict:
    """Report a UI range only when the author actually declared one.

    Blender 5.2's `id_properties_ui(key).as_dict()` always returns
    min/max/soft_min/soft_max/default, filling them with the float32 limits
    (+/-FLT_MAX) and a 0.0 default when nothing was authored. An adapter that
    trusts those keys verbatim would publish a bogus [-3.4e38, 3.4e38] range
    and a default that contradicts the property's own value. The sentinel
    comparison below is the only way to tell "declared" from "absent".
    """
    try:
        raw = datablock.id_properties_ui(key).as_dict()
    except (TypeError, KeyError, AttributeError):
        return {"uiMetadataPresent": False, "rangeDeclared": False}
    declared: dict = {}
    for field in ("min", "max", "soft_min", "soft_max"):
        value = raw.get(field)
        if is_numeric(value) and abs(float(value)) < FLOAT32_SENTINEL:
            declared[field] = float(value)
    range_declared = "min" in declared or "max" in declared
    result: dict = {
        "uiMetadataPresent": True,
        "rangeDeclared": range_declared,
        **declared,
    }
    default = raw.get("default")
    if is_numeric(default):
        result["default"] = float(default)
        # Blender reports 0.0 for an undeclared default, which is
        # indistinguishable from an authored 0.0.
        result["defaultIsAmbiguous"] = not range_declared
    return result


def control_candidates() -> tuple[list[dict], list[dict]]:
    accepted: list[dict] = []
    rejected: list[dict] = []
    owners: list[tuple[str, object]] = [("Scene", bpy.context.scene)]
    owners.extend(("Object", obj) for obj in bpy.data.objects)
    owners.extend(("Material", mat) for mat in bpy.data.materials)
    owners.extend(("NodeTree", tree) for tree in bpy.data.node_groups)
    for owner_type, owner in owners:
        for key in sorted(owner.keys()):
            if key.startswith("_"):
                continue
            value = owner[key]
            entry = {
                "name": key,
                "ownerType": owner_type,
                "ownerName": owner.name,
            }
            if is_numeric(value):
                candidate = dict(entry)
                candidate["type"] = "int" if isinstance(value, int) else "float"
                candidate["value"] = float(value)
                candidate.update(numeric_property_ui(owner, key))
                accepted.append(candidate)
                continue
            rejected.append(
                {
                    **entry,
                    "type": "boolean" if is_bool(value) else type(value).__name__,
                    "reason": "boolean-not-v1-numeric"
                    if is_bool(value)
                    else "non-numeric-or-addon-group",
                }
            )
    accepted.sort(key=lambda item: (item["ownerType"], item["ownerName"], item["name"]))
    rejected.sort(key=lambda item: (item["ownerType"], item["ownerName"], item["name"]))
    return accepted, rejected


def object_inventory() -> dict:
    counts: dict[str, int] = {}
    for obj in bpy.data.objects:
        counts[obj.type] = counts.get(obj.type, 0) + 1
    return {
        "total": len(bpy.data.objects),
        "countsByType": dict(sorted(counts.items())),
        "meshCount": len(bpy.data.meshes),
        "materialCount": len(bpy.data.materials),
        "actionCount": len(bpy.data.actions),
    }


def has_drivers() -> bool:
    for collection_name in dir(bpy.data):
        if collection_name.startswith("_"):
            continue
        try:
            collection = getattr(bpy.data, collection_name)
        except AttributeError:
            continue
        if not hasattr(collection, "__iter__"):
            continue
        try:
            items = list(collection)
        except TypeError:
            continue
        for item in items:
            animation = getattr(item, "animation_data", None)
            if animation is not None and len(getattr(animation, "drivers", ())) > 0:
                return True
            node_tree = getattr(item, "node_tree", None)
            node_animation = getattr(node_tree, "animation_data", None)
            if (
                node_animation is not None
                and len(getattr(node_animation, "drivers", ())) > 0
            ):
                return True
    return False


def texture_signals() -> dict:
    procedural = 0
    image_based = 0
    for tree_owner in list(bpy.data.materials) + list(bpy.data.worlds):
        tree = getattr(tree_owner, "node_tree", None)
        if tree is None:
            continue
        for node in tree.nodes:
            if node.type in PROCEDURAL_TEXTURE_NODE_TYPES:
                procedural += 1
            elif node.type in IMAGE_TEXTURE_NODE_TYPES:
                image_based += 1
    return {
        "proceduralTextureNodeCount": procedural,
        "imageTextureNodeCount": image_based,
        "usesProceduralTexturesOnly": procedural > 0 and image_based == 0,
    }


def gltf_signals() -> dict:
    has_particles = any(len(obj.particle_systems) > 0 for obj in bpy.data.objects)
    has_physics = any(
        modifier.type in PHYSICS_MODIFIER_TYPES
        for obj in bpy.data.objects
        for modifier in obj.modifiers
    ) or any(getattr(obj, "rigid_body", None) is not None for obj in bpy.data.objects)
    has_simulation_nodes = any(
        node.type in SIMULATION_NODE_TYPES
        for tree in bpy.data.node_groups
        for node in tree.nodes
    )
    has_shape_keys = any(
        getattr(mesh, "shape_keys", None) is not None for mesh in bpy.data.meshes
    )
    has_nla = any(
        getattr(obj.animation_data, "nla_tracks", None)
        and len(obj.animation_data.nla_tracks) > 0
        for obj in bpy.data.objects
        if obj.animation_data is not None
    )
    signals = {
        "hasParticleSystems": has_particles,
        "hasPhysics": has_physics,
        "hasSimulationNodes": has_simulation_nodes,
        "hasDrivers": has_drivers(),
        "hasShapeKeys": has_shape_keys,
        "hasNla": has_nla,
        "unknownSignals": [],
    }
    signals.update(texture_signals())
    return signals


def external_dependencies() -> dict:
    digests: list[str] = []
    missing = 0
    packed = 0
    for collection_name in FILEPATH_COLLECTIONS:
        collection = getattr(bpy.data, collection_name, None)
        if collection is None:
            continue
        for item in collection:
            raw = getattr(item, "filepath", "")
            if not raw:
                continue
            if getattr(item, "packed_file", None) is not None:
                packed += 1
                continue
            if getattr(item, "source", None) in {"GENERATED", "VIEWER"}:
                continue
            resolved = bpy.path.abspath(raw, library=getattr(item, "library", None))
            digest = sha256_file(resolved)
            if digest is None:
                missing += 1
                continue
            digests.append(digest)
    return {
        "count": len(digests) + missing,
        "resolvedCount": len(digests),
        "missingCount": missing,
        "packedCount": packed,
        "contentDigests": sorted(digests),
    }


def enabled_addons() -> list[str]:
    try:
        return sorted(
            addon.module for addon in bpy.context.preferences.addons if addon.module
        )
    except (AttributeError, TypeError):
        return []


def color_management(scene) -> dict:
    view = scene.view_settings
    display = scene.display_settings
    return {
        "displayDevice": display.display_device,
        "viewTransform": view.view_transform,
        "look": view.look,
        "exposure": round(float(view.exposure), 6),
        "gamma": round(float(view.gamma), 6),
        "sequencerColorspace": scene.sequencer_colorspace_settings.name,
    }


def render_settings(scene) -> dict:
    render = scene.render
    return {
        "engine": render.engine,
        "resolutionX": render.resolution_x,
        "resolutionY": render.resolution_y,
        "resolutionPercentage": render.resolution_percentage,
        "pixelAspectX": round(float(render.pixel_aspect_x), 6),
        "pixelAspectY": round(float(render.pixel_aspect_y), 6),
        "filmTransparent": bool(render.film_transparent),
        "useMotionBlur": bool(getattr(render, "use_motion_blur", False)),
        "colorManagement": color_management(scene),
    }


def build_manifest() -> dict:
    scene = bpy.context.scene
    accepted, rejected = control_candidates()
    return {
        "manifestVersion": MANIFEST_VERSION,
        "blender": {
            "versionString": bpy.app.version_string,
            "version": list(bpy.app.version),
            "buildDate": bpy.app.build_date.decode("utf-8", "replace"),
            "buildHash": bpy.app.build_hash.decode("utf-8", "replace"),
            "buildPlatform": bpy.app.build_platform.decode("utf-8", "replace"),
        },
        "host": {
            "platform": platform.system(),
            "machine": platform.machine(),
            "pythonVersion": platform.python_version(),
        },
        "environment": {
            "factoryStartup": "--factory-startup" in sys.argv,
            "enabledAddons": enabled_addons(),
        },
        "scene": {
            "name": scene.name,
            "fps": float(scene.render.fps) / float(scene.render.fps_base or 1.0),
            "fpsNumerator": scene.render.fps,
            "fpsDenominator": round(float(scene.render.fps_base), 6),
            "frameStart": scene.frame_start,
            "frameEnd": scene.frame_end,
            "frameStep": scene.frame_step,
            "durationFrames": scene.frame_end - scene.frame_start + 1,
            "sceneCount": len(bpy.data.scenes),
            "hasActiveCamera": scene.camera is not None,
        },
        "render": render_settings(scene),
        "publishedControlCandidates": accepted,
        "rejectedControlCandidates": rejected,
        "objectInventory": object_inventory(),
        "gltfSignals": gltf_signals(),
        "linkedLibraryCount": len(bpy.data.libraries),
        "externalDependencies": external_dependencies(),
    }


def leak_fragments() -> list[str]:
    fragments: set[str] = set()
    source = bpy.data.filepath
    if source:
        for base in {os.path.abspath(source), os.path.realpath(source)}:
            fragments.add(base)
            current = os.path.dirname(base)
            while current and current not in GENERIC_PATH_ROOTS:
                fragments.add(current)
                parent = os.path.dirname(current)
                if parent == current:
                    break
                current = parent
    try:
        fragments.add(getpass.getuser())
    except Exception:
        pass
    home = os.path.expanduser("~")
    if home and home not in GENERIC_PATH_ROOTS:
        fragments.add(home)
    return sorted(
        fragment
        for fragment in fragments
        if len(fragment) >= MIN_LEAK_FRAGMENT_LENGTH
        and fragment not in GENERIC_PATH_ROOTS
    )


def assert_no_path_leak(serialized: str) -> None:
    for fragment in leak_fragments():
        if fragment in serialized:
            raise SystemExit(
                f"manifest leaked a path fragment of length {len(fragment)}"
            )


def main() -> None:
    assert_no_save_operators()
    destination = out_path()
    manifest = build_manifest()
    serialized = json.dumps(manifest, sort_keys=True, indent=2) + "\n"
    assert_no_path_leak(serialized)
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    with open(destination, "w", encoding="utf-8") as handle:
        handle.write(serialized)
    print(f"[inspect] wrote {os.path.basename(destination)}")


main()
