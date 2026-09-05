#!/usr/bin/env python3
"""S0c probe 2 (external half): minimal, dependency-free PNG parser that
reads the raw file bytes of the PNGs produced by
`probe2_alpha_convention_blender.py` WITHOUT any color management, to
cross-check that script's bpy-side read (which linearizes on load and could
in principle mask what the file itself stores).

Implements just enough of the PNG spec to read an 8-bit RGBA, non-interlaced
image: chunk parsing, zlib inflate (via the stdlib `zlib` module), and
scanline defilter (filter types 0-4: None/Sub/Up/Average/Paeth). No PNG
library is used.

Run with plain python3, no Blender:
  python3 scripts/blender-link-spike/color-probe/probe2_alpha_convention_external_png_parse.py
"""

from __future__ import annotations

import json
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
GENERATED = os.path.join(HERE, "generated")
EVIDENCE = os.path.join(HERE, "evidence")

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def paeth_predictor(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def read_png_rgba8(path: str) -> dict:
    with open(path, "rb") as f:
        data = f.read()

    if data[:8] != PNG_SIGNATURE:
        raise ValueError(f"{path}: not a PNG (bad signature)")

    offset = 8
    idat_chunks = []
    ihdr = None
    while offset < len(data):
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        ctype = data[offset + 4 : offset + 8].decode("ascii")
        cdata = data[offset + 8 : offset + 8 + length]
        offset += 8 + length + 4  # skip CRC
        if ctype == "IHDR":
            (
                width,
                height,
                bit_depth,
                color_type,
                compression,
                filter_method,
                interlace,
            ) = struct.unpack(">IIBBBBB", cdata)
            ihdr = {
                "width": width,
                "height": height,
                "bitDepth": bit_depth,
                "colorType": color_type,
                "compression": compression,
                "filterMethod": filter_method,
                "interlace": interlace,
            }
        elif ctype == "IDAT":
            idat_chunks.append(cdata)
        elif ctype == "IEND":
            break

    if ihdr is None:
        raise ValueError(f"{path}: missing IHDR")
    if ihdr["bitDepth"] != 8 or ihdr["colorType"] != 6 or ihdr["interlace"] != 0:
        raise ValueError(
            f"{path}: this minimal parser only supports 8-bit RGBA "
            f"non-interlaced PNGs; got {ihdr}"
        )

    raw = zlib.decompress(b"".join(idat_chunks))
    width, height = ihdr["width"], ihdr["height"]
    bpp = 4  # bytes per pixel for 8-bit RGBA
    stride = width * bpp

    prev_row = bytearray(stride)
    rows: list[bytearray] = []
    pos = 0
    for _ in range(height):
        filter_type = raw[pos]
        pos += 1
        row = bytearray(raw[pos : pos + stride])
        pos += stride

        if filter_type == 0:  # None
            pass
        elif filter_type == 1:  # Sub
            for i in range(stride):
                a = row[i - bpp] if i >= bpp else 0
                row[i] = (row[i] + a) & 0xFF
        elif filter_type == 2:  # Up
            for i in range(stride):
                row[i] = (row[i] + prev_row[i]) & 0xFF
        elif filter_type == 3:  # Average
            for i in range(stride):
                a = row[i - bpp] if i >= bpp else 0
                b = prev_row[i]
                row[i] = (row[i] + ((a + b) // 2)) & 0xFF
        elif filter_type == 4:  # Paeth
            for i in range(stride):
                a = row[i - bpp] if i >= bpp else 0
                b = prev_row[i]
                c = prev_row[i - bpp] if i >= bpp else 0
                row[i] = (row[i] + paeth_predictor(a, b, c)) & 0xFF
        else:
            raise ValueError(f"{path}: unknown filter type {filter_type}")

        rows.append(row)
        prev_row = row

    cx, cy = width // 2, height // 2
    row = rows[cy]
    px_offset = cx * bpp
    r, g, b, a = row[px_offset : px_offset + 4]

    return {
        "path": path,
        "ihdr": ihdr,
        "centerPixelRGBA_rawFileBytes_0to255": [r, g, b, a],
        "centerPixelRGBA_rawFileBytes_normalized": [
            r / 255.0,
            g / 255.0,
            b / 255.0,
            a / 255.0,
        ],
    }


def main() -> None:
    full_path = os.path.join(GENERATED, "probe2-alpha-full.png")
    half_path = os.path.join(GENERATED, "probe2-alpha-half.png")

    full = read_png_rgba8(full_path)
    half = read_png_rgba8(half_path)

    full_r = full["centerPixelRGBA_rawFileBytes_0to255"][0]
    half_r = half["centerPixelRGBA_rawFileBytes_0to255"][0]
    half_a = half["centerPixelRGBA_rawFileBytes_0to255"][3]

    # If straight: raw R byte should match between full and half (alpha only
    # differs). If premultiplied: raw R byte in half should be roughly
    # full_r * (half_a/255) IN SRGB-ENCODED SPACE, which is only an
    # approximation since premultiplication happens in linear space before
    # sRGB encoding -- but a same-byte match is the clean signal either way.
    straight_dist = abs(half_r - full_r)
    approx_premult_encoded_half_r = full_r * (half_a / 255.0)
    premult_dist = abs(half_r - approx_premult_encoded_half_r)
    verdict = "straight" if straight_dist <= 2 else (
        "premultiplied" if premult_dist < straight_dist else "inconclusive"
    )

    out = {
        "method": (
            "Pure-Python PNG chunk parse + zlib inflate + scanline defilter, "
            "no color management applied at all -- reads the literal stored "
            "byte values, exactly as any external decoder (browser <img>, "
            "WebCodecs, etc.) would see them."
        ),
        "full": full,
        "half": half,
        "fullR_raw8bit": full_r,
        "halfR_raw8bit": half_r,
        "halfAlpha_raw8bit": half_a,
        "distanceIfStraightHypothesis": straight_dist,
        "distanceIfPremultipliedHypothesis_approx": premult_dist,
        "verdict": verdict,
    }

    out_path = os.path.join(EVIDENCE, "probe2-alpha-external-png-parse.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2, sort_keys=True)
    print("PROBE2_EXTERNAL_RESULT_JSON=" + out_path)
    print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
