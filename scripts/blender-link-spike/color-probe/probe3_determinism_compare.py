#!/usr/bin/env python3
"""S0c probe 3 (external half): byte-compare the determinism render pairs
produced by probe3_determinism_blender.py (two fresh-process runs per
variant), and if not byte-identical, compute the max per-pixel channel delta.

Run with plain python3, no Blender:
  python3 scripts/blender-link-spike/color-probe/probe3_determinism_compare.py
"""

from __future__ import annotations

import filecmp
import json
import os

from pnglib import decode_png_rgba8

HERE = os.path.dirname(os.path.abspath(__file__))
GENERATED = os.path.join(HERE, "generated")
EVIDENCE = os.path.join(HERE, "evidence")


def compare_webp_variant(variant: str) -> dict:
    run1 = os.path.join(GENERATED, f"probe3-{variant}-run1.webp")
    run2 = os.path.join(GENERATED, f"probe3-{variant}-run2.webp")
    file_byte_identical = filecmp.cmp(run1, run2, shallow=False)
    return {
        "variant": variant,
        "run1": run1,
        "run2": run2,
        "fileByteIdentical": file_byte_identical,
        "note": (
            "Unlike PNG (which still embeds a Date/RenderTime tEXt chunk "
            "even with use_stamp=False -- verified separately, see "
            "'static'/'motionblur' fileByteIdentical=false above), "
            "Blender's WEBP writer embeds no metadata chunk at all on this "
            "build (single VP8L RIFF chunk, no EXIF/XMP -- verified by "
            "walking the RIFF container). So there is nothing to confound "
            "a raw file-byte comparison here: fileByteIdentical directly "
            "answers the determinism question with no decode needed."
        ),
    }


def motion_blur_liveness_check() -> dict:
    """Confirm the 'motionblur' variant actually produced blur (nonzero
    delta vs the SAME scene/frame with blur forced off), so the determinism
    result above is not vacuously true because nothing moved during the
    sampled shutter window."""
    with_blur = os.path.join(GENERATED, "probe3-motionblur-run1.png")
    without_blur = os.path.join(GENERATED, "probe3-motionblur-noblur-check.png")
    img1 = decode_png_rgba8(with_blur)
    img2 = decode_png_rgba8(without_blur)
    p1, p2 = img1["pixels"], img2["pixels"]
    differing = sum(1 for i in range(len(p1)) if p1[i] != p2[i])
    max_delta = max((abs(p1[i] - p2[i]) for i in range(len(p1))), default=0)
    return {
        "withBlurPath": with_blur,
        "withoutBlurPath": without_blur,
        "differingByteCount": differing,
        "maxPerChannelDelta_0to255": max_delta,
        "blurConfirmedLive": differing > 0,
        "note": (
            "If differingByteCount were 0, the 'motionblur' variant's "
            "determinism result would be vacuous (nothing to be "
            "non-deterministic ABOUT, since the shutter sample landed on a "
            "static pose). A nonzero delta here proves the stochastic "
            "motion-blur sampling path was actually exercised."
        ),
    }


def compare_variant(variant: str) -> dict:
    run1 = os.path.join(GENERATED, f"probe3-{variant}-run1.png")
    run2 = os.path.join(GENERATED, f"probe3-{variant}-run2.png")

    file_byte_identical = filecmp.cmp(run1, run2, shallow=False)
    result = {
        "variant": variant,
        "run1": run1,
        "run2": run2,
        "fileByteIdentical": file_byte_identical,
        "note": (
            "fileByteIdentical compares the ENTIRE PNG file including "
            "metadata chunks. Blender embeds a wall-clock 'Date' tEXt chunk "
            "(render timestamp) that necessarily differs between two "
            "separate process runs even when the image content is "
            "identical, so fileByteIdentical=false does not by itself mean "
            "the render is non-deterministic. pixelDataByteIdentical "
            "(decoded RGBA bytes only, metadata stripped) is the "
            "determinism signal that matters."
        ),
    }
    # Always decode+compare pixel data directly, regardless of whole-file
    # comparison, since a false file-byte mismatch can be metadata-only.
    img1 = decode_png_rgba8(run1)
    img2 = decode_png_rgba8(run2)
    if img1["width"] != img2["width"] or img1["height"] != img2["height"]:
        result["error"] = "dimension mismatch between runs"
        return result
    p1, p2 = img1["pixels"], img2["pixels"]
    max_delta = 0
    max_delta_index = -1
    sum_abs_delta = 0
    differing_bytes = 0
    for i in range(len(p1)):
        d = abs(p1[i] - p2[i])
        if d > 0:
            differing_bytes += 1
            sum_abs_delta += d
        if d > max_delta:
            max_delta = d
            max_delta_index = i
    total_bytes = len(p1)
    result["pixelDataByteIdentical"] = differing_bytes == 0
    result["maxPerChannelDelta_0to255"] = max_delta
    result["maxDeltaByteIndex"] = max_delta_index if differing_bytes else -1
    result["differingByteCount"] = differing_bytes
    result["totalByteCount"] = total_bytes
    result["differingByteFraction"] = differing_bytes / total_bytes
    result["meanAbsDeltaOverDifferingBytes"] = (
        sum_abs_delta / differing_bytes if differing_bytes else 0
    )
    return result


def main() -> None:
    static_result = compare_variant("static")
    motionblur_result = compare_variant("motionblur")
    static_webp_result = compare_webp_variant("static")
    motionblur_webp_result = compare_webp_variant("motionblur")
    liveness = motion_blur_liveness_check()

    out = {
        "static": static_result,
        "motionblur": motionblur_result,
        "staticWebp": static_webp_result,
        "motionblurWebp": motionblur_webp_result,
        "motionBlurLivenessCheck": liveness,
        "summary": {
            "staticFileByteIdentical": static_result["fileByteIdentical"],
            "staticPixelDataByteIdentical": static_result["pixelDataByteIdentical"],
            "motionblurFileByteIdentical": motionblur_result["fileByteIdentical"],
            "motionblurPixelDataByteIdentical": motionblur_result[
                "pixelDataByteIdentical"
            ],
            "staticWebpFileByteIdentical": static_webp_result["fileByteIdentical"],
            "motionblurWebpFileByteIdentical": motionblur_webp_result[
                "fileByteIdentical"
            ],
            "motionBlurConfirmedLive": liveness["blurConfirmedLive"],
        },
    }

    out_path = os.path.join(EVIDENCE, "probe3-determinism.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2, sort_keys=True)
    print("PROBE3_RESULT_JSON=" + out_path)
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
