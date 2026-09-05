"""Independent verifier for one rendered frame package (S4 probe).

Reads the WebP files with Pillow rather than with Blender, so the decode path is
not the same code that produced them. Checks, in order:

  1. every frame the manifest claims exists, with the claimed byte length and
     the claimed SHA-256 (re-hashed here from the file on disk);
  2. the frame-number bar decodes to the manifest's own `blenderFrame` for that
     index -- this is the frame-addressability gate, and it is checked against
     the PRODUCING side's numbering rather than a 0-based counter so a constant
     offset cannot pass;
  3. transparent alpha is actually present (a package with alpha=255 everywhere
     would satisfy every structural rule while having lost the exit-scene
     requirement);
  4. every decoded image is EXACTLY the size the manifest declares -- for a
     contract whose entire subject is exact frame delivery, a declared size the
     pixels do not have is the silent corruption class;
  5. motion blur is live (frames differ from each other).

Usage: python3 verify_frames.py <package dir> [<second package dir>]
"""

from __future__ import annotations

import hashlib
import json
import os
import sys

from PIL import Image

# The bar spans the bottom 12% of the frame; sample a band strictly inside it so
# defocus softening at its top edge cannot contaminate the reading.
BAR_BAND_TOP = 0.955
BAR_BAND_BOTTOM = 0.99
BAR_BAND_LEFT = 0.35
BAR_BAND_RIGHT = 0.65


def load_manifest(directory: str) -> dict:
    with open(os.path.join(directory, "manifest.json"), "r", encoding="utf-8") as fh:
        return json.load(fh)


def decode_frame_number(image: Image.Image) -> dict:
    width, height = image.size
    pixels = image.convert("RGBA").load()
    reds = []
    for y in range(int(height * BAR_BAND_TOP), int(height * BAR_BAND_BOTTOM)):
        for x in range(int(width * BAR_BAND_LEFT), int(width * BAR_BAND_RIGHT)):
            r, _g, _b, a = pixels[x, y]
            if a == 255:
                reds.append(r)
    if not reds:
        return {"decoded": None, "reason": "bar band carried no opaque pixels"}
    reds.sort()
    median = reds[len(reds) // 2]
    return {
        "decoded": median,
        "min": reds[0],
        "max": reds[-1],
        "sampleCount": len(reds),
        "uniform": reds[0] == reds[-1],
    }


def alpha_stats(image: Image.Image) -> dict:
    alpha = image.convert("RGBA").getchannel("A")
    histogram = alpha.histogram()
    total = sum(histogram)
    return {
        "fullyTransparentFraction": histogram[0] / total,
        "fullyOpaqueFraction": histogram[255] / total,
        "partialFraction": sum(histogram[1:255]) / total,
    }


def verify(directory: str) -> dict:
    manifest = load_manifest(directory)
    frames = manifest["frames"]
    results = {
        "directory": os.path.basename(directory),
        "frameCount": manifest["frameCount"],
        "declaredFrameCount": len(frames),
        "presentCount": 0,
        "digestMatchCount": 0,
        "byteLengthMatchCount": 0,
        "frameNumberChecks": [],
        "frameNumberMismatches": [],
        "sizeMatchCount": 0,
        "sizeMismatches": [],
        "barBandSpreadMax": 0,
        "totalBytes": 0,
    }
    alpha_samples = []
    distinct_digests = set()
    for entry in frames:
        file_path = os.path.join(directory, entry["fileName"])
        if not os.path.exists(file_path):
            results.setdefault("missing", []).append(entry["index"])
            continue
        results["presentCount"] += 1
        raw = open(file_path, "rb").read()
        results["totalBytes"] += len(raw)
        if len(raw) == entry["byteLength"]:
            results["byteLengthMatchCount"] += 1
        digest = hashlib.sha256(raw).hexdigest()
        distinct_digests.add(digest)
        if digest == entry["digest"]:
            results["digestMatchCount"] += 1

        image = Image.open(file_path)
        if image.size == (manifest["width"], manifest["height"]):
            results["sizeMatchCount"] += 1
        else:
            results["sizeMismatches"].append(
                {
                    "index": entry["index"],
                    "declared": [manifest["width"], manifest["height"]],
                    "decoded": list(image.size),
                }
            )
        decoded = decode_frame_number(image)
        if decoded["decoded"] is not None:
            # Recorded as a number rather than a `uniform` boolean: 120 medians
            # landing on 120 DISTINCT expected values is not luck, and the spread
            # is what makes that self-evident instead of an argument.
            results["barBandSpreadMax"] = max(
                results["barBandSpreadMax"], decoded["max"] - decoded["min"]
            )
        expected = entry["blenderFrame"]
        ok = decoded["decoded"] == expected
        if not ok:
            results["frameNumberMismatches"].append(
                {
                    "index": entry["index"],
                    "expectedBlenderFrame": expected,
                    "decoded": decoded,
                }
            )
        if entry["index"] in (0, len(frames) // 3, len(frames) // 2, len(frames) - 1):
            results["frameNumberChecks"].append(
                {
                    "index": entry["index"],
                    "expectedBlenderFrame": expected,
                    "decodedRed": decoded["decoded"],
                    "uniform": decoded.get("uniform"),
                    "match": ok,
                }
            )
        if entry["index"] % max(1, len(frames) // 8) == 0:
            alpha_samples.append(
                {"index": entry["index"], **alpha_stats(image)}
            )

    results["frameNumberMatchCount"] = len(frames) - len(
        results["frameNumberMismatches"]
    )
    results["distinctFrameDigests"] = len(distinct_digests)
    results["alphaSamples"] = alpha_samples
    results["allFrameSizesMatchManifest"] = len(results["sizeMismatches"]) == 0
    results["transparentAlphaPresent"] = all(
        sample["fullyTransparentFraction"] > 0.01 for sample in alpha_samples
    )
    return results


def main() -> None:
    directories = sys.argv[1:]
    if not directories:
        raise SystemExit("verify_frames.py requires at least one package directory")
    report = {"packages": [verify(directory) for directory in directories]}
    if len(directories) == 2:
        left = load_manifest(directories[0])
        right = load_manifest(directories[1])
        differing = [
            {
                "index": a["index"],
                "leftDigest": a["digest"],
                "rightDigest": b["digest"],
                "leftBytes": a["byteLength"],
                "rightBytes": b["byteLength"],
            }
            for a, b in zip(left["frames"], right["frames"])
            if a["digest"] != b["digest"]
        ]
        left_meta = {k: v for k, v in left.items() if k != "frames"}
        right_meta = {k: v for k, v in right.items() if k != "frames"}
        report["coldWarmComparison"] = {
            "manifestMetadataIdentical": left_meta == right_meta,
            "metadataDiffKeys": sorted(
                k for k in left_meta if left_meta[k] != right_meta.get(k)
            ),
            "differingFrameCount": len(differing),
            "differingFrames": differing[:10],
            "buildKeyIdentical": left["buildKey"] == right["buildKey"],
            "codecIdentical": left["codec"] == right["codec"],
        }
    print(json.dumps(report, indent=2, sort_keys=True))


main()
