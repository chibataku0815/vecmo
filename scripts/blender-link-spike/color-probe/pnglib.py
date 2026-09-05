#!/usr/bin/env python3
"""Shared, dependency-free PNG reader used across S0c color-probe scripts.

Supports only what this spike's own renders produce: 8-bit RGBA,
non-interlaced. Not a general-purpose PNG library.
"""

from __future__ import annotations

import struct
import zlib

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def paeth_predictor(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def decode_png_rgba8(path: str) -> dict:
    """Returns {"width", "height", "pixels": bytearray of len w*h*4}."""
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
        offset += 8 + length + 4
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
            f"{path}: only 8-bit RGBA non-interlaced PNGs supported; got {ihdr}"
        )

    raw = zlib.decompress(b"".join(idat_chunks))
    width, height = ihdr["width"], ihdr["height"]
    bpp = 4
    stride = width * bpp

    prev_row = bytearray(stride)
    out = bytearray(width * height * bpp)
    pos = 0
    for y in range(height):
        filter_type = raw[pos]
        pos += 1
        row = bytearray(raw[pos : pos + stride])
        pos += stride

        if filter_type == 0:
            pass
        elif filter_type == 1:
            for i in range(stride):
                a = row[i - bpp] if i >= bpp else 0
                row[i] = (row[i] + a) & 0xFF
        elif filter_type == 2:
            for i in range(stride):
                row[i] = (row[i] + prev_row[i]) & 0xFF
        elif filter_type == 3:
            for i in range(stride):
                a = row[i - bpp] if i >= bpp else 0
                b = prev_row[i]
                row[i] = (row[i] + ((a + b) // 2)) & 0xFF
        elif filter_type == 4:
            for i in range(stride):
                a = row[i - bpp] if i >= bpp else 0
                b = prev_row[i]
                c = prev_row[i - bpp] if i >= bpp else 0
                row[i] = (row[i] + paeth_predictor(a, b, c)) & 0xFF
        else:
            raise ValueError(f"{path}: unknown filter type {filter_type}")

        out[y * stride : (y + 1) * stride] = row
        prev_row = row

    return {"width": width, "height": height, "pixels": out}
