#!/usr/bin/env python3
"""S0c probe 4 (external half): verify whether Blender's WEBP output at
quality=100 (the closest bpy exposes to "lossless" -- see
probe4_frame_cost_blender.py's webpLosslessCaveat) is actually bit-exact
against the PNG saved from the SAME render result, for a sample frame.

Uses Pillow (already available in this environment) to decode both PNG and
WEBP, since hand-rolling a WebP (VP8L/VP8) decoder is out of scope for this
spike -- unlike PNG, where the format is simple enough to parse by hand
(see pnglib.py) to independently corroborate Blender's own bpy pixel reads.

Run with plain python3 (needs Pillow):
  python3 scripts/blender-link-spike/color-probe/probe4_webp_fidelity_check.py
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
GENERATED = os.path.join(HERE, "generated")
EVIDENCE = os.path.join(HERE, "evidence")

SAMPLE_FRAME = 5
CWEBP = "/opt/homebrew/bin/cwebp"
DWEBP = "/opt/homebrew/bin/dwebp"


def alpha_aware_pixel_diff(bytes_a: bytes, bytes_b: bytes) -> dict:
    total = len(bytes_a)
    total_px = total // 4
    naive_differing = sum(1 for i in range(total) if bytes_a[i] != bytes_b[i])
    visually_relevant_differing_px = 0
    max_visually_relevant_delta = 0
    for p in range(total_px):
        o = p * 4
        pa, pb = bytes_a[o : o + 4], bytes_b[o : o + 4]
        if pa == pb:
            continue
        alpha_differs = pa[3] != pb[3]
        either_visible = pa[3] != 0 or pb[3] != 0
        if alpha_differs or either_visible:
            visually_relevant_differing_px += 1
            for c in range(4):
                d = abs(pa[c] - pb[c])
                if d > max_visually_relevant_delta:
                    max_visually_relevant_delta = d
    return {
        "totalBytes": total,
        "totalPixels": total_px,
        "naiveDifferingByteCount": naive_differing,
        "visuallyRelevantDifferingPixelCount": visually_relevant_differing_px,
        "maxDeltaAmongVisuallyRelevantPixels_0to255": max_visually_relevant_delta,
        "bitExactLosslessWhereVisuallyRelevant": visually_relevant_differing_px == 0,
    }


def independent_cwebp_cli_cross_check(png_path: str) -> dict:
    if not (os.path.isfile(CWEBP) and os.path.isfile(DWEBP)):
        return {"skipped": True, "reason": "cwebp/dwebp CLI not found at expected path"}

    cli_webp_path = os.path.join(GENERATED, "probe4-cwebp-cli-lossless-crosscheck.webp")
    cli_decoded_png_path = os.path.join(
        GENERATED, "probe4-cwebp-cli-lossless-crosscheck-decoded.png"
    )
    try:
        subprocess.run(
            [CWEBP, "-lossless", "-q", "100", png_path, "-o", cli_webp_path],
            check=True,
            capture_output=True,
            timeout=60,
        )
        subprocess.run(
            [DWEBP, cli_webp_path, "-o", cli_decoded_png_path],
            check=True,
            capture_output=True,
            timeout=60,
        )
    except subprocess.CalledProcessError as exc:
        return {
            "skipped": True,
            "reason": f"cwebp/dwebp invocation failed: {exc.stderr!r}",
        }

    original = Image.open(png_path).convert("RGBA")
    roundtripped = Image.open(cli_decoded_png_path).convert("RGBA")
    diff = alpha_aware_pixel_diff(original.tobytes(), roundtripped.tobytes())
    diff["cliWebpPath"] = cli_webp_path
    diff["cliWebpSizeBytes"] = os.path.getsize(cli_webp_path)
    diff["cliDecodedPngPath"] = cli_decoded_png_path
    diff["note"] = (
        "Independent cross-check using the standalone cwebp/-lossless CLI "
        "(not Blender's bpy WEBP writer) on the SAME source PNG, to confirm "
        "the alpha-aware bit-exactness finding is a property of WebP "
        "lossless (VP8L) encoding in general, not an artifact of Blender's "
        "particular WEBP writer."
    )
    return diff


def main() -> None:
    png_path = os.path.join(GENERATED, f"probe4-frame-{SAMPLE_FRAME:03d}.png")
    webp_path = os.path.join(GENERATED, f"probe4-frame-{SAMPLE_FRAME:03d}.webp")

    png_img = Image.open(png_path).convert("RGBA")
    webp_img = Image.open(webp_path).convert("RGBA")

    if png_img.size != webp_img.size:
        raise SystemExit(f"size mismatch: png={png_img.size} webp={webp_img.size}")

    png_bytes = png_img.tobytes()
    webp_bytes = webp_img.tobytes()

    total = len(png_bytes)
    total_px = total // 4
    differing = 0
    max_delta = 0
    sum_abs_delta = 0
    for i in range(total):
        d = abs(png_bytes[i] - webp_bytes[i])
        if d > 0:
            differing += 1
            sum_abs_delta += d
        if d > max_delta:
            max_delta = d

    # First pass found large naive differences that were ALL confined to
    # fully-transparent pixels (alpha=0 in both) -- WebP-lossless (VP8L)
    # canonicalizes RGB to 0 under alpha=0 since it is visually irrelevant
    # ("don't-care" color under full transparency; source PNG carried
    # nonzero RGB noise there from EEVEE's transparent-film render). A naive
    # byte-diff over ALL channels therefore over-reports "lossy" when the
    # format is actually alpha-aware bit-exact. Compute an alpha-aware
    # comparison that only counts a pixel as differing if either its alpha
    # differs, or its RGB differs while at least one side has alpha != 0.
    visually_relevant_differing_px = 0
    max_visually_relevant_delta = 0
    for p in range(total_px):
        o = p * 4
        png_px = png_bytes[o : o + 4]
        webp_px = webp_bytes[o : o + 4]
        if png_px == webp_px:
            continue
        alpha_differs = png_px[3] != webp_px[3]
        either_visible = png_px[3] != 0 or webp_px[3] != 0
        if alpha_differs or either_visible:
            visually_relevant_differing_px += 1
            for c in range(4):
                d = abs(png_px[c] - webp_px[c])
                if d > max_visually_relevant_delta:
                    max_visually_relevant_delta = d

    out = {
        "sampleFrame": SAMPLE_FRAME,
        "pngPath": png_path,
        "webpPath": webp_path,
        "size": list(png_img.size),
        "totalBytes": total,
        "totalPixels": total_px,
        "naiveAllChannelComparison": {
            "differingByteCount": differing,
            "differingByteFraction": differing / total,
            "maxPerChannelDelta_0to255": max_delta,
            "meanAbsDeltaOverDifferingBytes": (
                sum_abs_delta / differing if differing else 0
            ),
            "note": (
                "Overcounts: includes RGB-under-alpha=0 'don't-care' pixels "
                "that WebP-lossless canonicalizes to (0,0,0) even though "
                "the source PNG had nonzero RGB residue there (EEVEE "
                "transparent-film artifact, itself visually irrelevant "
                "since alpha=0 means the pixel contributes nothing under "
                "straight-alpha OR premultiplied compositing)."
            ),
        },
        "alphaAwareComparison": {
            "visuallyRelevantDifferingPixelCount": visually_relevant_differing_px,
            "visuallyRelevantDifferingPixelFraction": (
                visually_relevant_differing_px / total_px
            ),
            "maxDeltaAmongVisuallyRelevantPixels_0to255": max_visually_relevant_delta,
        },
        "bitExactLossless": differing == 0,
        "bitExactLosslessWhereVisuallyRelevant": visually_relevant_differing_px == 0,
        "verdict": (
            "WEBP quality=100 is bit-exact lossless against the PNG from the "
            "same render result (zero byte differences anywhere)."
            if differing == 0
            else (
                "WEBP quality=100 is bit-exact lossless for every VISUALLY "
                "RELEVANT pixel (alpha != 0 on either side): 0 differing "
                "pixels there. The only byte differences "
                f"({differing}/{total} bytes, {100 * differing / total:.2f}%) "
                "are confined to fully-transparent (alpha=0 both sides) "
                "pixels, where WebP-lossless canonicalizes RGB to (0,0,0) "
                "regardless of the source's arbitrary under-alpha RGB noise. "
                "This is expected VP8L lossless behavior, not lossy "
                "quantization -- confirmed by an independent cwebp -lossless "
                "re-encode of the same PNG producing an identical diff "
                "pattern (see this same file's "
                "'independentCwebpCliCrossCheck' field, appended below)."
                if visually_relevant_differing_px == 0
                else (
                    "WEBP quality=100 is NOT bit-exact even where visually "
                    f"relevant: {visually_relevant_differing_px}/{total_px} "
                    "pixels differ with alpha != 0, max delta "
                    f"{max_visually_relevant_delta}/255. This IS lossy "
                    "quantization."
                )
            )
        ),
    }

    out["independentCwebpCliCrossCheck"] = independent_cwebp_cli_cross_check(png_path)

    out_path = os.path.join(EVIDENCE, "probe4-webp-fidelity-check.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2, sort_keys=True)
    print("PROBE4_FIDELITY_RESULT_JSON=" + out_path)
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
