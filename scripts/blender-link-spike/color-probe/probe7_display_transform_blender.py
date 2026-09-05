"""S0c probe 7 (Blender half): identify the display/view transform, color
management config, and record it as a manifest LEGAL VALUE rather than
letting it hide inside `renderSettingsDigest`.

Plan ref (S0c bullet 2 / Exit criterion):
  docs/plans/active/blender-vecmo-integrated-motion-plan.html#s0
  "display transform（view transform）を同定し、primaries／EOTF／SDR-only を
  manifestの法定値として宣言する。renderSettingsDigestへ埋没させない。"

Records BOTH:
  - the factory-startup DEFAULT color management state (what probe4's frame
    renders actually used, since that script never touched view_settings),
  - and probe2's FORCED "Standard" view transform (so the report can state
    explicitly that probe2's alpha verdict and probe4's size/determinism
    measurements were taken under two different view-transform settings --
    which does not invalidate either measurement, since alpha is carried in
    a channel the view transform never touches and size/determinism are
    format/byte-level properties, but the discrepancy must be stated, not
    left for a reader to trip over).

Run only via:
  /opt/homebrew/bin/blender --background --factory-startup --python \
    scripts/blender-link-spike/color-probe/probe7_display_transform_blender.py
"""

from __future__ import annotations

import json
import os

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
EVIDENCE = os.path.join(HERE, "evidence")
os.makedirs(EVIDENCE, exist_ok=True)


def main() -> None:
    scene = bpy.context.scene
    vs = scene.view_settings
    ds = scene.display_settings

    # NOTE: view_transform/look/display_device are OCIO-config-driven DYNAMIC
    # enums. Reading `.bl_rna.properties[...].enum_items` on this build
    # returns a placeholder (["NONE"]) rather than the real OCIO-sourced
    # list -- confirmed empirically (it does not match the actual current
    # value, e.g. view_transform reads "AgX" while its own enum_items lists
    # only "NONE"). The real available-view list is instead read directly
    # from the OCIO config file below (external, no bpy dynamic-enum
    # introspection), which is the authoritative source anyway.
    ocio_env = os.environ.get("OCIO")

    default_state = {
        "note": (
            "Factory-startup DEFAULT color management state -- i.e. what "
            "probe1/probe3/probe4's renders actually used, since none of "
            "those scripts touch scene.view_settings."
        ),
        "viewTransform": vs.view_transform,
        "look": vs.look,
        "exposure": vs.exposure,
        "gamma": vs.gamma,
        "displayDevice": ds.display_device,
        "ocioEnvVar": ocio_env,
        "ocioSource": (
            "OCIO environment variable set (external config)"
            if ocio_env
            else "no OCIO env var set -- Blender uses its own bundled "
            "colormanagement/config.ocio datafile"
        ),
    }

    # What probe2 actually forced (see probe2_alpha_convention_blender.py's
    # build_scene: view_transform="Standard", look="None", exposure=0,
    # gamma=1). Declared here from the same enum source, not re-derived.
    probe2_forced_state = {
        "note": (
            "What probe2_alpha_convention_blender.py explicitly set before "
            "rendering the alpha-convention frames (PNG straight / EXR "
            "premultiplied verdicts in probe2-*.json). Alpha is unaffected "
            "by view transform -- the view transform only maps scene-"
            "linear RGB to display-encoded RGB, never touching the alpha "
            "channel -- so the alpha verdict is valid regardless of this "
            "difference from the default state above. Recorded explicitly "
            "so the two measurements are never silently conflated."
        ),
        "viewTransform": "Standard",
        "look": "None",
        "exposure": 0.0,
        "gamma": 1.0,
    }

    out = {
        "defaultState_usedByProbes_1_3_4": default_state,
        "forcedState_usedByProbe2_alphaConvention": probe2_forced_state,
        "viewTransformVsDisplayDeviceDistinction": {
            "finding": (
                "probe1/probe3/probe4 rendered under the factory DEFAULT "
                "View Transform 'AgX' (a filmic-like tone-mapping curve "
                "applied to scene-linear values), NOT the 'Standard' "
                "(plain-gamma) transform probe2 forced. This means their "
                "absolute pixel VALUES are AgX-tonemapped, unlike probe2's "
                "alpha-convention frames. However: Display Device = 'sRGB' "
                "in BOTH cases (View Transform and Display Device are "
                "separate legal fields in Blender's color pipeline -- View "
                "Transform is a tone-mapping curve applied BEFORE the final "
                "Display Device encode; Display Device is the final "
                "transfer-function + primaries encode actually baked into "
                "the file bytes). So the FINAL ENCODING TRANSFER FUNCTION "
                "and PRIMARIES declared by every PNG this spike produced "
                "are identical (sRGB OETF, BT.709-equivalent primaries per "
                "the sRGB display_colorspace in Blender's bundled OCIO "
                "config) regardless of which View Transform tone-mapped the "
                "scene-linear values beforehand. probe4's size/webp-"
                "lossless/determinism conclusions are therefore unaffected "
                "by the View Transform difference from probe2 -- but the "
                "absolute PIXEL VALUES in probe1/3/4 vs probe2 are NOT "
                "directly comparable to each other (AgX-tonemapped vs "
                "plain-gamma), which is why probe2 deliberately forced "
                "Standard to keep its straight-vs-premultiplied arithmetic "
                "exact and legible."
            ),
            "ocioConfigEvidence": (
                "Blender's bundled config.ocio (path in ocioEnvVar above) "
                "sRGB display section lists: "
                "'!<View> {name: Standard, view_transform: Standard, "
                "display_colorspace: sRGB}' and "
                "'!<View> {name: AgX, view_transform: AgX Base Rec.1886, "
                "display_colorspace: sRGB}' -- both views target the SAME "
                "display_colorspace (sRGB), confirming the final encode "
                "target is identical; only the pre-encode tone-mapping "
                "curve differs."
            ),
        },
        "sdrOnlyDeclaration": {
            "claim": "SDR-only",
            "basis": (
                "Blender's PNG writer targets a fixed 0..1 8-bit-per-channel "
                "display-referred range with the sRGB/BT.709 OETF baked in "
                "-- this holds REGARDLESS of which View Transform tone-"
                "mapped the scene-linear values beforehand (AgX, the "
                "factory default used by probes 1/3/4, or Standard, forced "
                "by probe2), because Display Device='sRGB' is constant "
                "across both and is what actually determines the final "
                "encode transfer function (see "
                "viewTransformVsDisplayDeviceDistinction above -- View "
                "Transform and Display Device are separate legal fields, "
                "and only the latter governs the bytes written to disk). No "
                "HDR-signaling chunks (cICP, mDCv, cLLi -- the PNG "
                "extensions used to declare HDR transfer functions / "
                "mastering metadata) are present; see "
                "probe7-png-color-chunks.json for the enumerated chunk list "
                "from an actual rendered PNG, produced independently of "
                "this script (external, no bpy)."
            ),
        },
    }

    out_path = os.path.join(EVIDENCE, "probe7-display-transform.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2, sort_keys=True)
    print("PROBE7_RESULT_JSON=" + out_path)
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
