#!/usr/bin/env python3
"""S0c task 6: consolidate all color-probe evidence files into a single
evidence/S0C-REPORT.json (eevee verdict, alpha conventions per format,
determinism results, size table, codec recommendation).

Run with plain python3, no Blender, after all probe1-probe7 evidence files
already exist:
  python3 scripts/blender-link-spike/color-probe/probe6_consolidate_report.py
"""

from __future__ import annotations

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
EVIDENCE = os.path.join(HERE, "evidence")


def load(name: str) -> dict:
    with open(os.path.join(EVIDENCE, name)) as f:
        return json.load(f)


def main() -> None:
    probe1 = load("probe1-eevee-stop-condition.json")
    probe2_blender = load("probe2-alpha-blender-read.json")
    probe2_external = load("probe2-alpha-external-png-parse.json")
    probe3 = load("probe3-determinism.json")
    probe4 = load("probe4-frame-cost-and-storage.json")
    probe4_fidelity = load("probe4-webp-fidelity-check.json")
    probe7_transform = load("probe7-display-transform.json")
    probe7_chunks = load("probe7-png-color-chunks.json")
    probe7_webp_riff = load("probe7-webp-riff-chunks.json")
    probe5 = load("probe5-codec-candidate-verdict.json")

    report = {
        "scope": (
            "S0c color/alpha/determinism/codec falsification probes, "
            "owned exclusively by this agent under "
            "scripts/blender-link-spike/color-probe/. Does not touch "
            "scripts/blender-link-spike/ root (S0a: inspect/buildkey/camera)."
        ),
        "planRef": "docs/plans/active/blender-vecmo-integrated-motion-plan.html#s0",
        "blenderVersion": probe1["blenderVersion"],
        "blenderInvocation": "/opt/homebrew/bin/blender --background --factory-startup",

        "1_eeveeHeadlessStopCondition": {
            "stopConditionRef": probe1["planStopConditionRef"],
            "availableRenderEngines": probe1["availableRenderEngines"],
            "eeveeSucceeded": probe1["eeveeHeadlessMotionBlurDofSucceeded"],
            "cyclesFallbackSucceeded": probe1["cyclesFallbackSucceeded"],
            "stopConditionTriggered": probe1["stopConditionTriggered"],
            "verdict": probe1["verdictSummary"],
            "eeveeEngine": probe1["eevee"]["engine"],
            "eeveeElapsedSeconds": probe1["eevee"]["elapsedSeconds"],
            "cyclesDeviceUsed": probe1["cycles"].get("cyclesDeviceUsed"),
            "cyclesElapsedSeconds": probe1["cycles"]["elapsedSeconds"],
        },

        "2_alphaConvention": {
            "methodology": (
                "Rendered the same 50%-emission-strength red surface at "
                "Alpha=1.0 ('full') and Alpha=0.5 ('half') over "
                "film_transparent=True, saved to PNG (8-bit) and OpenEXR "
                "(32-bit float linear) from the SAME render result, then "
                "compared full-vs-half R channel: straight alpha => "
                "unchanged RGB; premultiplied alpha => RGB scaled by alpha "
                "in linear space."
            ),
            "png": {
                "verdict_asReadByBpy": probe2_blender["verdictPerFormat_asReadByBpy"]["png"]["verdict"],
                "verdict_externalRawFileBytes": probe2_external["verdict"],
                "crossCheckAgrees": (
                    probe2_blender["verdictPerFormat_asReadByBpy"]["png"]["verdict"]
                    == probe2_external["verdict"]
                ),
                "fullR": probe2_external["fullR_raw8bit"],
                "halfR": probe2_external["halfR_raw8bit"],
                "halfAlpha": probe2_external["halfAlpha_raw8bit"],
            },
            "openExr": {
                "verdict_asReadByBpy": probe2_blender["verdictPerFormat_asReadByBpy"]["exr"]["verdict"],
                "fullR": probe2_blender["verdictPerFormat_asReadByBpy"]["exr"]["fullR"],
                "halfR": probe2_blender["verdictPerFormat_asReadByBpy"]["exr"]["halfR"],
                "halfAlpha": probe2_blender["verdictPerFormat_asReadByBpy"]["exr"]["halfAlpha"],
                "note": "halfR == fullR * halfAlpha exactly (0.25 == 0.5*0.5): confirms premultiplied/associated alpha.",
            },
            "conclusion": (
                "PNG output = STRAIGHT alpha (cross-checked two independent "
                "ways: Blender's own linearizing image reader, and a "
                "from-scratch external PNG byte parser with zero color "
                "management). OpenEXR output = PREMULTIPLIED/associated "
                "alpha. These are DIFFERENT conventions from the SAME "
                "render result -- any pipeline step that treats one file "
                "format's bytes with the other format's compositing "
                "formula will reproduce the historical 2a-a^2 double-"
                "composite class of bug documented in "
                "src/features/export/adapters/video.ts:462-469."
            ),
        },

        "2b_displayTransformAndColorLegalValues": {
            "planRef": (
                "S0c bullet 2 / Exit criterion: primaries, EOTF, view "
                "transform, alpha mode, SDR-only, frame addressability must "
                "be declared as manifest LEGAL VALUES, not buried in "
                "renderSettingsDigest."
            ),
            "defaultViewTransform": probe7_transform["defaultState_usedByProbes_1_3_4"]["viewTransform"],
            "defaultDisplayDevice": probe7_transform["defaultState_usedByProbes_1_3_4"]["displayDevice"],
            "ocioConfigPath": probe7_transform["defaultState_usedByProbes_1_3_4"]["ocioEnvVar"],
            "viewTransformVsDisplayDeviceFinding": probe7_transform["viewTransformVsDisplayDeviceDistinction"]["finding"],
            "primaries": {
                "measured_cHRM": probe7_chunks["cHRM_decoded"],
                "matchesBt709SrgbReference": probe7_chunks["cHRM_matchesBt709SrgbReference"],
                "conclusion": "BT.709/sRGB primaries and D65 white point, confirmed from the actual cHRM chunk bytes of a rendered PNG (not assumed from the format name).",
            },
            "eotf": {
                "sRGBChunkPresent": probe7_chunks["sRGB_chunk"] is not None,
                "sRGBRenderingIntent": probe7_chunks["sRGB_chunk"],
                "gAMA_impliedGammaExponent": probe7_chunks["gAMA_impliesGammaExponent"],
                "conclusion": (
                    "sRGB chunk present (readers should use the exact sRGB "
                    "piecewise transfer function); gAMA chunk present as a "
                    "compatibility fallback implying ~2.2 gamma. Display "
                    "Device='sRGB' for every PNG this spike rendered "
                    "(constant across both the AgX and Standard View "
                    "Transform settings used in different probes -- see "
                    "viewTransformVsDisplayDeviceFinding)."
                ),
            },
            "sdrOnly": {
                "hdrSignalingChunksPresent": probe7_chunks["hdrSignalingChunksPresent"],
                "bitDepth": probe7_chunks["ihdrBitDepth"],
                "conclusion": probe7_chunks["sdrOnlyEvidence"],
            },
            "colorManagementInconsistencyAcrossThisSpike": (
                "probe2 (alpha convention) forced View Transform='Standard' "
                "explicitly, to keep straight-vs-premultiplied arithmetic "
                "exact. probe1/probe3/probe4 used the factory-default View "
                "Transform ('AgX', a filmic-like tone-mapping curve). This "
                "does NOT invalidate any conclusion in this report: alpha "
                "is a separate channel the View Transform never touches "
                "(so probe2's alpha verdict stands), and Display "
                "Device='sRGB' identically in every case (so the final "
                "encoded transfer function / primaries this section "
                "declares apply uniformly). It DOES mean the absolute RGB "
                "pixel VALUES in probe1/3/4 are AgX-tonemapped and not "
                "directly numerically comparable to probe2's plain-gamma "
                "values -- stated explicitly here rather than left as a "
                "silent trap for whoever reads this next."
            ),
        },

        "2c_perFormatLegalValuesTable": {
            "purpose": (
                "The 'primaries'/'eotf'/'sdrOnly' fields in 2b above were "
                "measured from a PNG only. This table makes each output "
                "format's legal color values explicit side by side, "
                "including the ones this spike's own recommended V1 "
                "candidate (WebP) and the alpha-convention EXR CANNOT "
                "declare in their own bytes -- per S0c bullet 2's explicit "
                "requirement, those must then be manifest-declared instead "
                "of silently assumed."
            ),
            "png": {
                "primaries": "BT.709/sRGB (measured, cHRM chunk)",
                "eotf": "sRGB piecewise transfer function (sRGB chunk present; gAMA~2.2 fallback)",
                "referred": "Display-referred (post view-transform, post Display Device encode)",
                "bounded": "SDR, 0..1 range, 8-bit-per-channel (no HDR-signaling chunks present)",
                "alphaConvention": "Straight (measured, probe2, two independent methods)",
                "declaresOwnColorMetadata": True,
            },
            "openExr": {
                "primaries": "BT.709 (bpy colorspaceName='Linear Rec.709' on load, per probe2-alpha-blender-read.json)",
                "eotf": "Linear (scene-referred light values, no display transfer function applied)",
                "referred": "Scene-referred (pre view-transform, pre Display Device encode -- NOT the same referred-space as PNG)",
                "bounded": "UNBOUNDED / not SDR-clamped: 32-bit float, values may exceed 1.0 (HDR-range-capable even though this spike's own test values stayed within 0..1)",
                "alphaConvention": "Premultiplied/associated (measured, probe2: halfR == fullR * halfAlpha exactly)",
                "declaresOwnColorMetadata": (
                    "Partial -- OpenEXR format supports chromaticities/whiteLuminance "
                    "attributes, but this spike did not verify whether Blender's EXR "
                    "writer actually populates them; bpy's own colorspaceName read "
                    "('Linear Rec.709') is a strong signal but was not independently "
                    "cross-checked against the raw EXR header the way PNG's cHRM/gAMA/"
                    "sRGB chunks were byte-parsed externally. Flagged as unverified, "
                    "not asserted true."
                ),
                "trapThisRowGuardsAgainst": (
                    "A consumer that reads BOTH PNG and EXR outputs from this pipeline "
                    "and applies the SAME referred-space assumption (e.g. clamps EXR "
                    "to 0..1 assuming display-referred, or applies straight-alpha "
                    "compositing to EXR's premultiplied values) will silently corrupt "
                    "output -- this is the display-referred/scene-referred and "
                    "bounded/unbounded pairing, in addition to the already-documented "
                    "alpha-convention pairing, that S0c bullet 2 exists to force into "
                    "the open."
                ),
            },
            "webpLossless": {
                "riffChunkEvidence": {
                    "allSamplesAgreeNoColorMetadata": probe7_webp_riff["allSamplesAgree"],
                    "samplesChecked": [s["path"] for s in probe7_webp_riff["samples"]],
                    "conclusion": probe7_webp_riff["conclusion"],
                },
                "primaries": "NOT self-declared (no ICCP chunk) -- inherited from the SAME Display Device='sRGB' pipeline that produced the PNG, per probe7-webp-riff-chunks.json's two-sample RIFF walk (a 320x320 opaque frame and a 1920x1080 real-alpha frame, both a bare VP8L chunk, zero color-metadata chunks)",
                "eotf": "NOT self-declared (no EXIF/XMP color-metadata chunk) -- same inheritance as primaries",
                "referred": "Display-referred (bit-exact copy of the PNG's display-referred RGBA values, confirmed lossless where alpha != 0, per probe4-webp-fidelity-check.json)",
                "bounded": "SDR, 0..1 range, 8-bit-per-channel (inherited from source; WebP-lossless via Blender's writer is 8-bit RGBA only, no 16-bit path found in ImageFormatSettings RNA)",
                "alphaConvention": "Straight (bit-exact inheritance from the source PNG's straight-alpha RGBA, confirmed for every visually-relevant pixel)",
                "declaresOwnColorMetadata": False,
                "manifestObligation": (
                    "Because WebP's own bytes declare NOTHING about primaries/EOTF "
                    "(verified on two independent samples, not assumed), the S0c "
                    "manifest's legal-value set for a WebP-lossless output profile "
                    "MUST explicitly state primaries=BT.709/sRGB and eotf=sRGB, "
                    "carried over from the Display Device setting of the render that "
                    "produced it -- a consumer relying on 'browsers assume sRGB for "
                    "untagged images' is relying on an ambient default, not a "
                    "manifest-legal contract, which is exactly the renderSettingsDigest-"
                    "burial failure mode this bullet exists to prevent."
                ),
            },
        },

        "3_determinism": {
            "static": {
                "fileByteIdentical": probe3["static"]["fileByteIdentical"],
                "pixelDataByteIdentical": probe3["static"]["pixelDataByteIdentical"],
            },
            "motionblur": {
                "fileByteIdentical": probe3["motionblur"]["fileByteIdentical"],
                "pixelDataByteIdentical": probe3["motionblur"]["pixelDataByteIdentical"],
            },
            "staticWebp": {
                "fileByteIdentical": probe3["staticWebp"]["fileByteIdentical"],
            },
            "motionblurWebp": {
                "fileByteIdentical": probe3["motionblurWebp"]["fileByteIdentical"],
            },
            "motionBlurLivenessCheck": {
                "blurConfirmedLive": probe3["motionBlurLivenessCheck"]["blurConfirmedLive"],
                "differingByteCount": probe3["motionBlurLivenessCheck"]["differingByteCount"],
                "maxPerChannelDelta_0to255": probe3["motionBlurLivenessCheck"]["maxPerChannelDelta_0to255"],
                "note": (
                    "Confirms the 'motionblur' determinism result is not "
                    "vacuous: rendering the same scene/frame with motion "
                    "blur forced off produces a materially different image "
                    "(8317 differing bytes, max per-channel delta 160/255), "
                    "proving the stochastic motion-blur sampling path was "
                    "genuinely exercised in the determinism test above."
                ),
            },
            "conclusion": (
                "PNG: both variants are PIXEL-DATA byte-identical across "
                "fresh, separate Blender processes (0 differing decoded "
                "RGBA bytes in either case). The only whole-file byte "
                "difference is Blender's own embedded 'Date'/'RenderTime' "
                "tEXt metadata (render wall-clock time), which "
                "scene.render.use_stamp=False does NOT suppress on this "
                "build (verified empirically, contrary to the initial "
                "assumption) -- so PNG determinism must be judged on "
                "decoded pixel bytes, not whole-file bytes. WebP: BOTH "
                "variants are fully WHOLE-FILE byte-identical across fresh "
                "processes -- stronger than PNG's result, because Blender's "
                "WEBP writer embeds no metadata chunk at all (verified by "
                "walking the RIFF container: a single VP8L chunk, no EXIF/"
                "XMP). The motion-blur variant's determinism claim was "
                "further confirmed non-vacuous via the liveness check "
                "above. No non-determinism was found anywhere in this "
                "spike's renders on this machine/build."
            ),
        },

        "4_frameCostAndStorage": {
            "resolution": probe4["resolution"],
            "framesRendered": probe4["frameCount"],
            "benchmarkEnvelopeFrames": probe4["benchmarkEnvelopeFrames"],
            "png": {
                "meanBytesPerFrame": probe4["png"]["sizeBytesStats"]["mean"],
                "minBytesPerFrame": probe4["png"]["sizeBytesStats"]["min"],
                "maxBytesPerFrame": probe4["png"]["sizeBytesStats"]["max"],
                "extrapolated120FrameTotalMB": probe4["png"]["extrapolated120FrameTotalMB"],
            },
            "webpQuality100": {
                "meanBytesPerFrame": probe4["webp"]["sizeBytesStats"]["mean"],
                "minBytesPerFrame": probe4["webp"]["sizeBytesStats"]["min"],
                "maxBytesPerFrame": probe4["webp"]["sizeBytesStats"]["max"],
                "extrapolated120FrameTotalMB": probe4["webp"]["extrapolated120FrameTotalMB"],
                "sizeRatioVsPng": probe4["webpToPngSizeRatioMean"],
                "losslessVerification": probe4_fidelity["verdict"],
                "bitExactWhereVisuallyRelevant": probe4_fidelity["bitExactLosslessWhereVisuallyRelevant"],
                "independentCliCrossCheckAgrees": probe4_fidelity[
                    "independentCwebpCliCrossCheck"
                ].get("bitExactLosslessWhereVisuallyRelevant"),
            },
            "meanRenderSecondsPerFrame": probe4["renderTimeSecondsStats"]["mean"],
            "comparisonTable": [
                {"format": "PNG (8-bit RGBA)", "meanKB": round(probe4["png"]["sizeBytesStats"]["mean"] / 1024, 1), "120frameMB": round(probe4["png"]["extrapolated120FrameTotalMB"], 1)},
                {"format": "WebP lossless (quality=100)", "meanKB": round(probe4["webp"]["sizeBytesStats"]["mean"] / 1024, 1), "120frameMB": round(probe4["webp"]["extrapolated120FrameTotalMB"], 1)},
            ],
        },

        "5_codecRecommendation": {
            "v1Candidate": probe5["recommendation"]["v1Candidate"],
            "v1Rationale": probe5["recommendation"]["v1Rationale"],
            "runnerUp": probe5["recommendation"]["runnerUp"],
            "runnerUpRationale": probe5["recommendation"]["runnerUpRationale"],
            "hardGateNote": probe5["hardGate_frameAddressability"]["rule"],
            "fullAnalysisFile": "evidence/probe5-codec-candidate-verdict.json",
        },

        "stopConditionsTriggered": {
            "eeveeHeadlessMotionBlurDof": probe1["stopConditionTriggered"],
        },
        "overallRuntimeStatus": (
            "Blocked"
            if probe1["stopConditionTriggered"]
            else "Ready (S0c falsification probes complete; VP9/WebM candidate "
                 "requires a follow-up empirical encode+decode probe before "
                 "it can be promoted past runner-up status)"
        ),
    }

    out_path = os.path.join(EVIDENCE, "S0C-REPORT.json")
    with open(out_path, "w") as f:
        json.dump(report, f, indent=2, sort_keys=True)
    print("S0C_REPORT_JSON=" + out_path)
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
