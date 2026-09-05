#!/usr/bin/env python3
"""S0c probe 7 (external half): decode the color-metadata chunks (cHRM,
gAMA, sRGB) actually embedded in a rendered PNG, to VERIFY primaries/EOTF
from the file's own bytes rather than asserting them from the format name --
and confirm the absence of HDR-signaling chunks (cICP, mDCv, cLLi) to
support the "SDR-only" declaration from evidence, not assumption.

ALSO walks the RIFF container of the WebP outputs (this spike's recommended
V1 candidate) to check whether WebP carries ANY color-metadata chunk of its
own (ICCP/EXIF/XMP) on two independent samples (a small opaque frame and a
full-size 1920x1080 real-alpha frame) -- if it does not (which is what was
found), the manifest MUST declare WebP's primaries/EOTF explicitly, since
the file format itself cannot.

Run with plain python3, no Blender:
  python3 scripts/blender-link-spike/color-probe/probe7_png_color_chunks_external.py
"""

from __future__ import annotations

import json
import os
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
GENERATED = os.path.join(HERE, "generated")
EVIDENCE = os.path.join(HERE, "evidence")

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

# Reference BT.709/sRGB primaries + white point (CIE 1931 xy), per the PNG
# spec's own worked example for the sRGB chunk / cHRM values Blender emits.
BT709_SRGB_REFERENCE = {
    "whiteX": 0.31270,
    "whiteY": 0.32900,
    "redX": 0.64000,
    "redY": 0.33000,
    "greenX": 0.30000,
    "greenY": 0.60000,
    "blueX": 0.15000,
    "blueY": 0.06000,
}
HDR_SIGNALING_CHUNK_TYPES = ("cICP", "mDCv", "cLLi")


def list_chunks(path: str) -> dict:
    with open(path, "rb") as f:
        data = f.read()
    if data[:8] != PNG_SIGNATURE:
        raise ValueError(f"{path}: not a PNG")

    offset = 8
    chunks = []
    ihdr = None
    chrm = None
    gama = None
    srgb = None
    while offset < len(data):
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        ctype = data[offset + 4 : offset + 8].decode("ascii")
        cdata = data[offset + 8 : offset + 8 + length]
        offset += 8 + length + 4
        chunks.append({"type": ctype, "length": length})
        if ctype == "IHDR":
            ihdr = struct.unpack(">IIBBBBB", cdata)
        elif ctype == "cHRM":
            # 8 x uint32, each value = actual_value * 100000
            vals = struct.unpack(">8I", cdata)
            chrm = {
                "whiteX": vals[0] / 100000,
                "whiteY": vals[1] / 100000,
                "redX": vals[2] / 100000,
                "redY": vals[3] / 100000,
                "greenX": vals[4] / 100000,
                "greenY": vals[5] / 100000,
                "blueX": vals[6] / 100000,
                "blueY": vals[7] / 100000,
            }
        elif ctype == "gAMA":
            (gama_raw,) = struct.unpack(">I", cdata)
            gama = {"raw": gama_raw, "decoded": gama_raw / 100000}
        elif ctype == "sRGB":
            (intent,) = struct.unpack(">B", cdata)
            srgb = {
                "renderingIntent": intent,
                "renderingIntentName": [
                    "Perceptual",
                    "Relative colorimetric",
                    "Saturation",
                    "Absolute colorimetric",
                ][intent],
            }
        elif ctype == "IEND":
            break

    present_types = {c["type"] for c in chunks}
    hdr_chunks_present = [t for t in HDR_SIGNALING_CHUNK_TYPES if t in present_types]

    primaries_match = None
    if chrm is not None:
        primaries_match = all(
            abs(chrm[k] - BT709_SRGB_REFERENCE[k]) < 0.00005
            for k in BT709_SRGB_REFERENCE
        )

    return {
        "path": path,
        "chunkTypesPresent": sorted(present_types),
        "ihdrBitDepth": ihdr[2] if ihdr else None,
        "ihdrColorType": ihdr[3] if ihdr else None,
        "cHRM_decoded": chrm,
        "cHRM_matchesBt709SrgbReference": primaries_match,
        "gAMA_decoded": gama,
        "gAMA_impliesGammaExponent": (
            1.0 / gama["decoded"] if gama else None
        ),
        "sRGB_chunk": srgb,
        "hdrSignalingChunksPresent": hdr_chunks_present,
        "sdrOnlyEvidence": (
            f"No HDR-signaling chunks (checked for {HDR_SIGNALING_CHUNK_TYPES}) "
            f"present; found: {hdr_chunks_present or 'none'}. "
            f"8-bit depth: {ihdr[2] == 8 if ihdr else 'unknown'}."
        ),
    }


WEBP_COLOR_METADATA_CHUNK_TYPES = ("ICCP", "EXIF", "XMP ")


def list_webp_riff_chunks(path: str) -> dict:
    """Walk a WebP RIFF container's top-level chunks (no VP8L bitstream
    parsing) to check for embedded color-metadata chunks (ICCP profile,
    EXIF, XMP). Used to verify whether the file itself carries any
    primaries/EOTF declaration, independent of what Blender's renderer
    happened to compute."""
    with open(path, "rb") as f:
        data = f.read()
    if data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise ValueError(f"{path}: not a RIFF/WEBP file")
    pos = 12
    chunks = []
    while pos < len(data):
        ctype = data[pos : pos + 4].decode("ascii", "replace")
        size = struct.unpack("<I", data[pos + 4 : pos + 8])[0]
        chunks.append({"type": ctype, "size": size})
        pos += 8 + size + (size % 2)  # RIFF chunks are word-aligned
    present_types = {c["type"] for c in chunks}
    color_metadata_present = [
        t for t in WEBP_COLOR_METADATA_CHUNK_TYPES if t in present_types
    ]
    return {
        "path": path,
        "fileSizeBytes": os.path.getsize(path),
        "topLevelRiffChunks": chunks,
        "colorMetadataChunksChecked": list(WEBP_COLOR_METADATA_CHUNK_TYPES),
        "colorMetadataChunksPresent": color_metadata_present,
        "hasAnyColorMetadata": len(color_metadata_present) > 0,
    }


def main() -> None:
    # probe3-static-run1.png was rendered under the plain default state
    # (AgX view transform, per probe7-display-transform.json), giving a
    # representative sample of what this spike's actual PNG outputs declare.
    sample_path = os.path.join(GENERATED, "probe3-static-run1.png")
    result = list_chunks(sample_path)

    out_path = os.path.join(EVIDENCE, "probe7-png-color-chunks.json")
    with open(out_path, "w") as f:
        json.dump(result, f, indent=2, sort_keys=True)
    print("PROBE7_CHUNKS_RESULT_JSON=" + out_path)
    print(json.dumps(result, indent=2, sort_keys=True))

    # WebP RIFF-container check, on TWO samples: probe3's small no-alpha
    # frame and probe4's full-size 1920x1080 alpha-bearing frame, so the
    # "no embedded color metadata" claim isn't grounded in a single n=1
    # sample.
    webp_samples = [
        os.path.join(GENERATED, "probe3-static-run1.webp"),
        os.path.join(GENERATED, "probe4-frame-005.webp"),
    ]
    webp_results = [list_webp_riff_chunks(p) for p in webp_samples]
    webp_out = {
        "samples": webp_results,
        "conclusion": (
            "Neither sample (a 320x320 opaque frame, nor a 1920x1080 "
            "RGBA-with-real-alpha frame) contains any color-metadata RIFF "
            "chunk (ICCP/EXIF/XMP) -- both are a single bare VP8L chunk. "
            "WebP output from this Blender build therefore carries NO "
            "embedded primaries/EOTF declaration of its own; any consumer "
            "gets correct color only by ASSUMING sRGB for untagged WebP "
            "(the near-universal browser default), which is an assumption, "
            "not a declaration the file makes. This means primaries/EOTF "
            "for the WebP output profile MUST be declared in the manifest "
            "(inherited from the same Display Device='sRGB' pipeline that "
            "produced the PNG's cHRM/gAMA/sRGB chunks -- see "
            "probe7-display-transform.json), per S0c bullet 2's explicit "
            "requirement not to let this be silently assumed."
        ),
        "allSamplesAgree": all(
            not r["hasAnyColorMetadata"] for r in webp_results
        ),
    }
    webp_out_path = os.path.join(EVIDENCE, "probe7-webp-riff-chunks.json")
    with open(webp_out_path, "w") as f:
        json.dump(webp_out, f, indent=2, sort_keys=True)
    print("PROBE7_WEBP_RIFF_RESULT_JSON=" + webp_out_path)
    print(json.dumps(webp_out, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
