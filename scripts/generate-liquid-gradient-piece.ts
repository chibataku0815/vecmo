/**
 * Generates "LIQUID GRADIENT" (piece #2): two counter-rotating rings of
 * spiral "blade" shapes around one SHARED centre near the frame middle,
 * finished with the real Demo 1 GPU chain (blur -> wave-warp -> colorama ->
 * deep-glow) so an alpha-indexed cyclic palette ramp reads as concentric
 * iridescent chrome arcs sweeping through a vortex, with a genuine black
 * hole at the shared centre — the LP copy area. This is a one-off
 * motion-art artifact generator, not a product runtime: it builds the
 * scene/motion documents as plain typed literals, runs them through the
 * maintained WebGL export path, and writes the returned assets to disk for
 * inspection.
 *
 * v2: replaced the v1 hand-drawn liquid-chrome ribbon content (ribbons/
 * ribbonShape, ripped by ribbon-per-stripe stacking) — user-rejected — with
 * star geometry driven through wave-warp/colorama, now that both nodes are
 * real GPU passes (see `src/shared/gpu-lens/surface.ts`) instead of a
 * stand-in flow/blur/deep-glow chain.
 *
 * v3: corrected against the actual reference title card and its Demo 1
 * tutorial transcript, which contradicted several v2 guesses. The success
 * criterion is the frame's BACKGROUND only (title copy is excluded):
 * - Colorama now reads `inputPhase: "alpha"` instead of luminance, so the
 *   ramp indexes the blurred stars' silhouette alpha, not a synthetic
 *   full-frame luminance field. The full-frame `field` rect is deleted
 *   entirely — with an opaque background there is no longer any need to feed
 *   colorama a manufactured luminance range, and a rect would defeat the
 *   alpha read by covering the frame with alpha 1 everywhere. (The `field`
 *   DIAGNOSTIC EXPORT VARIANT — the raw pre-colorama blur/wave-warp output —
 *   is kept; it is a different concept from the deleted rect node.)
 * - The background is pure black (`#000000`), not a near-black navy: the
 *   reference's entire centre is flat black, the copy area.
 * - The composition is two large stars, mostly off-frame, in the top-left
 *   and bottom-right corners (point-symmetric about the artboard centre),
 *   not three fully-on-frame stars — matching the reference's corner-swept
 *   ribbon clusters instead of a centred starburst.
 * - Wave Warp's `width` (wavelength) was 260, corrected to 70 per the
 *   transcript; `height`/`direction` also corrected.
 * - Blur radius corrected to 80 (the transcript's literal Fast Box Blur
 *   value) now that the composition has open negative space to blur into.
 *
 * v4: closed the remaining gap to the reference after a first browser
 * verification pass confirmed v3's structure (black frame, black centre, two
 * mirrored corner clusters) but found three content gaps:
 * - More nested ribbons: arms 6 -> 10 per star, `innerR` narrowed to ~0.22 of
 *   `outerR` so arms stay slender spikes — each blurred arm reads as roughly
 *   one nested alpha contour band once colorama re-colours it.
 * - Curved sweep: {@link starPath} now takes a `curlDegrees` param and sweeps
 *   each vertex's angle proportional to its radius (see the function's own
 *   comment for why this is baked into geometry rather than a post effect).
 * - More coverage: `outerR` raised (560 -> 760, 480 -> 660) with centres
 *   unchanged, pushing the corner-to-tip reach from roughly a quarter of the
 *   frame width to roughly 40% of it, matching the reference more closely
 *   while the centre band stays pure black (non-negotiable: the LP copy
 *   area).
 * - Bluer palette: {@link VIVID_COLORAMA_STOPS} rebalanced to be cobalt-
 *   dominant (the v3 ramp read too violet overall).
 *
 * v5: a second browser verification pass confirmed v4's palette family
 * (black frame, mirrored corner clusters, chrome-ish banding) but found the
 * clusters read as parallel streaks rather than the reference's complete
 * pointed lens/leaf shapes, and the banding read as rainbow stripes rather
 * than blue chrome:
 * - Complete lens arms: v4 pushed the stars' centres far outside the frame
 *   and made `outerR` large enough that only each arm's straight mid-section
 *   crossed the frame — both the pointed base and the pointed tip were
 *   off-canvas. Pulling the centres in close to the corners and shrinking
 *   `outerR` (see the {@link STARS} comment for the reach arithmetic) fits a
 *   whole arm — base to tip — inside the frame, fanned around the corner.
 * - Weighted palette: {@link VIVID_COLORAMA_STOPS}/{@link BRAND_COLORAMA_STOPS}
 *   moved from even `k/7` spacing to explicit weighted offsets — most of the
 *   ramp given to the dominant hue (blue / mid green), with the accent and
 *   near-white core compressed into a thin band near the top. Evenly spaced
 *   stops spread every hue equally across a ribbon's alpha-contour width,
 *   which reads as rainbow stripes; the reference's ribbons ARE banded
 *   across their width (this part was already structurally correct), but
 *   the offsets — not the hues — are what make banding read as chrome
 *   instead of a rainbow.
 * - Sharper specular cores: `deep-glow` threshold lowered (0.6 -> 0.5) and
 *   intensity raised (0.18 -> 0.32) so the now-thin near-white core actually
 *   blooms, while radius stays small (0.22) and chroma stays 0 — a tight
 *   core hit, not a luminance/saturation wash (barred by project
 *   constraints).
 *
 * v6: the palette weighting from v5 was confirmed correct and untouched, but
 * v5's coverage fix overshot — the two arm clusters now ran continuously
 * through the frame centre, erasing the black copy-area corridor, because
 * v5's reach check only verified the corner-aligned diagonal, not the actual
 * corner-to-frame-centre distance. The tension is complete-lens-arms (which
 * wants a wide `outerR`/`innerR` gap) versus a black centre (which wants
 * short arms): resolved by making arms shorter and stubbier (`innerR` raised
 * to 0.30 of `outerR`, was ~0.22) and more strongly curled (`curlDegrees`
 * +-80, was +-55) so they wrap around their own corner instead of pointing at
 * the frame centre, with `arms` raised 10 -> 12 to keep the cluster dense
 * despite the shorter arms. See the {@link STARS} comment for the corrected
 * frame-centre reach arithmetic. One structural fact confirmed while
 * diagnosing this: with `inputPhase: "alpha"`, a star's fill RGB (the
 * black->white radial gradient) has zero effect on the coloured result —
 * colour depends only on the blurred alpha silhouette — so arm SHAPE is the
 * only lever on where colour appears; the fill exists solely for the
 * `-field` diagnostic variant, which has no colorama stage.
 *
 * v7: two fixes, geometry (centres/outerR/curlDegrees from v6 kept as-is —
 * the corner-hugging composition and black corridor are correct):
 * - Dim ribbons: with `inputPhase: "alpha"`, how far up the palette a pixel
 *   reaches depends entirely on its blurred alpha. v6's twelve thin arms
 *   under an 80px blur never let alpha recover near 1 anywhere, so the frame
 *   only sampled the ramp's dark bottom. Fewer, wider arms (`arms` 12 -> 8,
 *   `innerR` 0.30 -> 0.25 of `outerR`) plus a lighter blur (`BLUR_RADIUS`
 *   80 -> 50, a deliberate deviation from the transcript's literal value —
 *   see that constant's comment for why) let arm cores hold high alpha so
 *   colorama actually reaches the palette's bright stops.
 * - Ramp wrap trap: {@link VIVID_COLORAMA_STOPS}/{@link BRAND_COLORAMA_STOPS}
 *   moved their terminal stop from offset 1.0 to 0.97 — terminating exactly
 *   at 1.0 made `rampAt`'s interior segment loop cover the full [0,1) range
 *   itself, bypassing the wraparound cross-fade back to stop 0 entirely and
 *   turning the wrap into a hard cut (see the TRAP comments on those stops).
 *
 * v8: found scrubbing past frame 0 (a single static frame is not enough to
 * verify a colorama node — its output depends on time-varying params, not
 * just the source it reads): the black surround was turning solid blue
 * (vivid) / solid green (brand) for most of the loop, destroying the black
 * copy-area corridor. Root cause is structural, not a tuning miss — with
 * `inputPhase: "alpha"`, the fully-transparent surround (alpha 0) samples
 * the ramp at exactly `rampAt(fract(phase))`, so animating `colorama.phase`
 * drives the ENTIRE background through the palette over the clip; the
 * surround is black only at the single instant phase is exactly 0. The
 * `colorama.phase` `rampTrack` is removed entirely; `phase` is now a static
 * `0` in the payload (see the TRAP comment there). `wave-warp.phase` (2
 * whole turns) and both stars' `spinTrack`s are unchanged — they already
 * carry all of this piece's motion, matching the transcript's Demo 1 (whose
 * only animated parameters are Wave Warp speed and layer rotation; a moving
 * Colorama phase belongs to its Demos 3/4, which read a luminance ramp off
 * an opaque solid with no transparent surround to flood).
 *
 * v9: v8's requested loop-closure sanity check surfaced a second, smaller
 * defect: `wavePhaseAt` computed `2 * t / (DURATION_FRAMES - 1)`, which hits
 * exactly `2.0` turns at the terminal frame — the FULL total, not one
 * increment short — making that frame read identical to frame 0 after the
 * shader's `fract()` wrap (a held duplicate frame), unlike {@link spinTrack},
 * which already used the correct one-increment-short convention. Fixed by
 * changing the denominator to `DURATION_FRAMES` (`WAVE_PHASE_TURNS * t /
 * DURATION_FRAMES`), and the `rampTrack` doc comment now states the shared
 * convention explicitly, naming both failure modes that have actually
 * shipped in this file, so it cannot silently drift again.
 *
 * v10: user feedback against the reference — every tuning round through v9
 * kept two independent per-corner stars, and the reference's circular swirl
 * was structurally unreachable from that model no matter how it was tuned.
 * The reference's ribbons are concentric arcs, every one a segment of a
 * large circle about ONE SHARED centre near the frame middle — a vortex.
 * Two stars in two different corners each curl their own arms about their
 * OWN centre; there is no tuning of arm count, curl angle, or radius that
 * turns two independent radial bursts into one shared circular sweep. A
 * single big star centred there would ALSO be wrong on its own terms: it is
 * filled through the middle, and with `inputPhase: "alpha"` a filled centre
 * is alpha 1 — the palette's brightest stop — while the reference's centre
 * is black; the shape needs a genuine hole, not just a small `innerR`.
 *
 * `starPath`/`StarSpec`/`STARS`/`starNode` are deleted entirely and replaced
 * with `bladePath`/`RingSpec`/`RINGS`/`bladeNode`: independent "blade" shapes
 * (pointed lenses swept in polar coordinates, so angular position is a
 * function of radius — the spiral) arranged around one shared ring centre,
 * none of which reach that centre, so the combined shape is a genuine
 * annulus with a black hole in the middle. Two rings (7 blades / +110deg
 * span / +1 turn, and 5 blades / -90deg span / offset 26deg / -1 turn)
 * share the same centre and rotate in opposite directions, producing real
 * interference between the two sweeps instead of a single clean pinwheel.
 * See the `RINGS`/`bladePath`/`bladeNode` comments for the construction and
 * reach arithmetic. Every other system — `inputPhase: "alpha"`, the static
 * `colorama.phase`, the weighted palette stops, wave-warp, blur, deep-glow,
 * and the `rampTrack`/`spinTrack` loop convention — carries over unchanged;
 * only the geometry model that feeds them changed.
 *
 * v11: v10's single ring was structurally still wrong, even though it fixed
 * the shared-centre vortex problem — it did not read as CIRCULAR. Each blade
 * spanned `innerR=340` to `outerR=1050` (radius roughly tripling) over only
 * 110deg of arc: that is RADIAL-dominant travel, and a radial-dominant
 * spiral reads as a straight diagonal streak inside a frame-sized window —
 * you only see a small slice of the huge radial run, regardless of how large
 * the arc's absolute angular span is. Curvature only reads when a blade's
 * travel is CIRCUMFERENTIAL-dominant: large angular sweep, small radial
 * growth (see the `bladePath` comment's "CIRCUMFERENTIAL vs RADIAL
 * dominance" note). Fixed by replacing the one all-encompassing ring with
 * THREE rings stacked radially (each spanning only 140-210px in radius
 * while sweeping 170-200deg), still sharing one centre and still
 * alternating rotation direction ring-to-ring for the counter-sweep
 * interference. Separately, wave-warp `height` dropped 200 -> 110: 200px of
 * displacement, on top of the 50px blur, was enough by itself to smear
 * blade alpha across the black centre corridor — see the black-centre check
 * in the `RINGS` comment, verified arithmetically rather than assumed,
 * since this corridor has now been lost and recovered twice.
 *
 * v12: GENERAL RULE, hit repeatedly by this file under different geometry —
 * first the v7 star arms (12 thin arms under an 80px blur), now v11's blade
 * rings (each blade tapering to a point at both ends via
 * `halfWidthDeg * sin(PI * t)`, crushed by the 50px blur): under
 * `inputPhase: "alpha"`, whatever the geometry, its blurred alpha must still
 * PEAK NEAR 1 somewhere, or colorama's upper palette stops are simply
 * unreachable and the image goes flat and monochrome (blue only here — the
 * magenta stop at 0.80 and the near-white core at 0.90 never got sampled).
 * Thin shapes plus a wide blur is the recurring way to lose it; this v12
 * pass fixes this occurrence by thickening every blade's `halfWidthDeg`
 * (11/10/9 -> 17/15/13) and widening each ring's radial span so adjacent
 * rings overlap (closing v11's radial gaps as a side effect) — see the
 * `RINGS` comment for the full arithmetic, including a re-derived
 * black-centre check (innerR dropped 420 -> 400, margin narrows from
 * ≈196.8px to ≈176.8px but stays comfortable) and a re-confirmed
 * circumferential-dominance check (still ≈6.9:1 arc-to-radial at r≈500).
 *
 * v13: TWO INDEPENDENT LEVERS, named explicitly because this file has now
 * overshot in both directions by conflating them. RADIAL thickness
 * (`outerR - innerR`) controls whether a blade's blurred alpha PEAKS AT 1
 * anywhere — too thin (v11) and the upper palette stops are unreachable, the
 * flat-monochrome failure v12 fixed. ANGULAR width and spacing
 * (`halfWidthDeg` vs. blade count / span) controls how much BLACK SURVIVES
 * BETWEEN ribbons — too wide (v12's fix, which widened `halfWidthDeg` right
 * alongside the radial thickening) and, combined with three radially
 * overlapping rings, adjacent rings fill each other's angular gaps and the
 * union reads as a near-solid saturated wash, the opposite failure. Tuning
 * one axis to fix the other is what caused both rounds. v13 only narrows
 * `halfWidthDeg` (17/15/13 -> 10/9/8), leaving every radial bound, blade
 * count, arc span, and rotation exactly as v12 left them — see the `RINGS`
 * comment for the arithmetic confirming the core still saturates (full
 * blade width ≈174px at r≈500, still >2*BLUR_RADIUS) while the gap between
 * blades is now wide enough (≈274px at r≈500) to stay black.
 *
 * v14: THIRD LEVER, named alongside the radial-thickness (v12) and
 * angular-width (v13) ones because narrowing `halfWidthDeg` in v13 did NOT
 * restore the black — still a saturated wash. The reason: shape alpha is
 * BINARY (1 inside, 0 outside), so overlapping shapes do not blend — they
 * just fill. `halfWidthDeg` only sets how much angle ONE blade occupies;
 * with 27 blades (7/9/11) across three radially-overlapping rings, nearly
 * every point in the annulus was covered by at least one blade regardless
 * of each blade's own width, so the UNION stayed near-saturated and
 * narrowing individual blades barely moved it. The lever that actually
 * controls union coverage is total blade COUNT (and how lightly rings
 * overlap), not width — cut hard here (7/9/11 -> 4/5/6, ring overlaps
 * trimmed from 100-240px to 60px) to bring per-ring coverage down to
 * ≈18-20% and ring-overlap union down to ≈35% (see the `RINGS` comment for
 * the coverage arithmetic). Also re-verified the peak-alpha check this
 * round changed the tightest case (ring A's inner edge): the brief's
 * `halfWidthDeg: 8` there left only a ≈12px saturated core against the
 * 50px blur, so ring A's `halfWidthDeg` is raised to 9 (≈26px core) per
 * the brief's own stated fallback, since this exact failure mode (v7, v12)
 * has now hit this file more than once.
 *
 * v15: FOURTH LEVER, and the one that finally resolves the v12-v14
 * tug-of-war between radial thickness, angular width, and blade count.
 * Black centre and circular arcs were both correct after v14, but the
 * field panel still measured peak alpha at only ≈0.65 — landing on the
 * violet stop (0.66) and leaving magenta (0.80) and the near-white core
 * (0.90) unreachable, the direct cause of a still-monochrome-blue result.
 * The missing variable: `BLUR_RADIUS` itself caps peak alpha independently
 * of coverage — a shape only saturates to alpha 1 if its width exceeds the
 * blur kernel's width (~`2*BLUR_RADIUS + 1`), and at `BLUR_RADIUS: 50` the
 * ~101px kernel was wider than several blades' effective width, especially
 * at ring A's inner edge. Every prior round (v12-v14) tuned blade
 * width/count instead, which always traded alpha against coverage — wider
 * blades raise alpha but cost black, narrower blades protect black but
 * lose alpha. `BLUR_RADIUS` doesn't have that trade-off: shrinking the
 * kernel (50 -> 30, ~61px) buys alpha headroom for every blade at once,
 * for free, and even IMPROVES the black-centre margin (less inward
 * encroachment from a smaller kernel). `halfWidthDeg` nudged up slightly
 * (9/7/6 -> 10/9/8) for additional saturation margin now that the kernel
 * is smaller. See the `RINGS` and `BLUR_RADIUS` comments for the full v15
 * arithmetic.
 *
 * v16: last structural fix — black centre, circular arcs, and peak alpha
 * were all correct after v15, but the ribbons had a tight zig-zag/ric-rac
 * chevron texture instead of the reference's smooth undulation. Cause:
 * wave-warp `width` (wavelength) and `height` (displacement) are RATIOS to
 * the shape being warped, not absolute pixel values, and the transcript's
 * literals (`width: 70`, calibrated for a 1080px-wide comp with one
 * enormous star) do not transplant across a change of shape scale. A blade
 * here is only ~140px wide (see `RINGS`), so a 70px wavelength put roughly
 * two full wave periods across a single blade, scalloping it into a
 * sawtooth instead of bending it, and `height: 110` — near a full blade
 * width — shredded rather than undulated. Fixed by preserving the RATIO:
 * `width` raised 70 -> 220 (longer than a blade's width, so a blade bends
 * as one whole unit) and `height` dropped 110 -> 60 (~40% of blade width).
 * See the `WAVE_WARP_PAYLOAD` comment for the full reasoning and the
 * `RINGS` comment for the resulting (further-improved) black-centre check.
 *
 * v17: REFRAMES EVERYTHING ABOVE. A higher-resolution look at the reference
 * revealed a mechanism v11-v16 missed entirely: a SINGLE ribbon contains
 * MULTIPLE full palette traversals (navy -> blue -> violet -> magenta ->
 * cream -> navy, repeating), and each wide band has a DARK CORE at its
 * centre with the iridescent bands concentrated at its EDGES. Under
 * `inputPhase: "alpha"`, that is exactly what `repetitions > 1` produces: a
 * blade's saturated alpha PLATEAU (alpha ~1 at its core) maps to
 * `fract(1 * repetitions)` = 0 = stop 0 = DARK — the reference's dark band
 * cores — while the blurred EDGE, where alpha ramps 0->1, traverses the
 * whole palette once per repetition, producing the stacked chrome bands
 * along each edge. `COLORAMA_REPETITIONS` had been left at 1 since v3 on
 * the reasoning that a single traversal already reads as a full sweep — that
 * reasoning was the actual bug. Raised to 3, with both palettes rewritten as
 * one full chrome cycle, dark at BOTH ends (see `VIVID_COLORAMA_STOPS`/
 * `BRAND_COLORAMA_STOPS`).
 *
 * This INVERTS the v12-v15 constraint: wide blades and a wide blur are now
 * REQUIRED, not something to avoid — the chrome banding lives in the
 * blurred edge gradient, so that gradient needs room, and a saturated core
 * is now DESIRABLE (a dark band centre) rather than the bug it was when
 * `repetitions` was 1. Blade counts dropped hard (two rings, 3+4 blades) and
 * `halfWidthDeg` rose to the high 20s (see `RINGS`), while `BLUR_RADIUS`
 * rose 30 -> 70 (see that constant's comment) so the multi-cycle edge ramp
 * is wide enough to read as bands rather than being compressed into hard
 * pixel-scale banding.
 *
 * v18: the v17 mechanism was confirmed correct (dark band cores, repeating
 * blue/magenta/pink/cream cycles along the edges) — but BAND FREQUENCY was
 * still wrong: fine topographic contour lines / oil-slick moiré instead of
 * the reference's broad smooth bands. The explicit relation, stated plainly
 * because it is what makes this tunable rather than guessed at:
 *
 *     band width ≈ (edge-gradient span) / (COLORAMA_REPETITIONS * stop count)
 *
 * where edge-gradient span ≈ `2 * BLUR_RADIUS` (the region where alpha ramps
 * 0->1, the only place any banding is visible — see v17). At v17's
 * `BLUR_RADIUS: 70` / `repetitions: 3` / 9 stops, band width was
 * ~140 / (3*9) ≈ 5px; the reference measures ~17px per band. Fixed by
 * widening the gradient (`BLUR_RADIUS` 70 -> 170, ~340px span) AND dropping
 * a repetition (`COLORAMA_REPETITIONS` 3 -> 2), landing on
 * ~340 / (2*9) ≈ 19px — matching the reference. `RINGS`' radial bands were
 * pushed outward to compensate for the much wider blur spill (see that
 * comment), which also changed how the black centre is guaranteed to stay
 * black: it is no longer purely "geometry does not reach here" but "alpha
 * near 0 maps back to stop 0 regardless" (see the `RINGS` comment's v18
 * note on this).
 *
 * v19: CORRECTS v17's premise on the record, and reverses v18 as a direct
 * consequence. v18's `BLUR_RADIUS: 170` dissolved ribbon SHAPE entirely into
 * soft colour haze — an overshoot that prompted studying the reference
 * again, which revealed v17's core claim was wrong: a single ribbon's
 * cross-section is symmetric and runs ONE palette traversal out and back
 * around its alpha peak (dark navy -> blue -> violet -> magenta -> pink ->
 * cream -> pale core -> cream -> pink -> magenta -> violet -> blue -> dark
 * navy), not several repeated cycles. What v17 read as one ribbon repeating
 * was actually the NEXT ribbon over doing its own single cycle.
 * `COLORAMA_REPETITIONS` returns to 1 (see that constant's comment for the
 * full correction).
 *
 * This also resolves a confound that had been silently distorting every
 * `repetitions: 1` round since v3: those rounds looked flat and monochrome
 * NOT because `repetitions: 1` was wrong, but because their blades were
 * always too thin for alpha to actually climb past the blue stops (the same
 * peak-alpha failure that hit v7, v12, and v15). `repetitions: 1` and
 * "blades wide enough for alpha to genuinely peak near 1" had never
 * actually been tried together — v19 is that combination: `RINGS` shrinks
 * back down to blades sized so alpha JUST barely saturates (a thin bright
 * core, not a wide plateau) and `BLUR_RADIUS` drops 170 -> 90 to match. See
 * the `RINGS` comment's v19 saturation check and re-derived black-centre
 * check for the resulting proportions.
 *
 * v20: THE MISATTRIBUTION, the single most useful thing this file has
 * learned, stated plainly because v11-v19 all quietly assumed the opposite.
 * Every one of those rounds tried to produce the fine ribbon striation by
 * tuning BLADE geometry (count, width, radial thickness) and the alpha
 * pipeline around it (blur, repetitions). None of them produced it, because
 * that is not where it comes from. In the transcript's Demo 1, the source
 * shape is ONE broad, soft star, and the many thin nested striations are
 * produced by WAVE-WARP at a short wavelength with large amplitude, folding
 * that smooth alpha field back over itself. Broad soft shapes supply the
 * smooth gradient and circular arrangement; wave-warp supplies the fine
 * ribbon striations; alpha colorama colours the folds. None of the blade
 * geometry or alpha-pipeline tuning across v11-v19 was the wrong instinct in
 * isolation, but it was solving for structure that lives in a different
 * system entirely.
 *
 * This reframes v16's "scalloping" diagnosis, which was correct AT THE TIME
 * and wrong as a GENERAL rule. v16 found that the transcript's `width: 70`
 * scalloped blades that were then only ~140px wide, comparable to the
 * wavelength, and concluded the fix was widening `width` to exceed the
 * shape. Generalising that into "avoid short wavelengths on this shape
 * family" is what sent v16-v19 chasing structure in the wrong variable: the
 * same short wavelength that chops a shape of COMPARABLE width folds a shape
 * an ORDER OF MAGNITUDE wider into fine nested ribbons — which is exactly
 * the structure wanted. `WAVE_WARP_PAYLOAD` is restored to the transcript's
 * literals (`width` 220 -> 70, `height` 60 -> 200); `RINGS`' blades widen
 * again (this time explicitly to be far wider than the wavelength, not to
 * hold multiple palette cycles or protect a thin core) so the wave folds
 * rather than scallops; `BLUR_RADIUS` drops (90 -> 60) since its job is now
 * only "smooth the field enough to fold cleanly", not carry banding
 * structure; `COLORAMA_REPETITIONS` stays 1 (folding, not repetition, is
 * what multiplies the visible bands now). See `WAVE_WARP_PAYLOAD`, `RINGS`,
 * and `BLUR_RADIUS` for the full arithmetic.
 *
 * v21: v20's wave-folding fix WORKED — fine striations with chrome leading
 * edges confirmed the diagnosis — but coverage collapsed: ribbons only
 * appeared at the extreme left/right edges, most of the frame empty black.
 * Cause was a conflict introduced across v17-v20, not a new bug: the
 * `innerR - height - blur` black-centre formula (see `RINGS`) is a
 * conservative LOWER bound (alpha falls off gradually with blur, not as a
 * cliff edge), but it had been treated as a hard constraint, pushed further
 * out every round to "protect" it, until ring A's `innerR` reached 560 —
 * against a ring-centre-to-frame-corner distance of only ~800px — and ring
 * B started at 900, almost entirely off-frame. The reference's actual dark
 * centre is only ~250-300px in radius and carries faint dark-blue
 * structure, not a large pure-black hole; this file had been protecting a
 * bigger, blacker hole than the reference has. The formula is retired as a
 * hard constraint (see `RINGS` for where it's kept as historical record);
 * the centre now relies on alpha simply being low there mapping to stop 0,
 * verified visually rather than by that arithmetic. Rings pulled inward
 * (innerR 560/900 -> 330/620) and a THIRD ring added (900-1400, 5 blades)
 * to fill the frame the first two no longer cover alone.
 *
 * v22: v21 overcorrected — pulling rings inward to fill the frame also
 * erased the dark centre corridor, and part of the geometry (ring C
 * entirely, ring B's outer half) was placed where the FRAME could not
 * reach it at all. The single number that constrains every radius in this
 * file, and had never been written down until now: from the shared ring
 * centre (700, 380), the farthest point anywhere in the 1280x720 frame is
 * the (0,0) corner, at distance sqrt(700^2 + 380^2) ≈ 796.5px (a rectangle
 * is convex, so the farthest point from any interior centre is always a
 * vertex — no other point in the frame can exceed this). Any ring geometry
 * beyond ≈796.5px is invisible, and any dark-centre budget has to be carved
 * out of that same ≈796.5px, not treated as a separate, independent
 * allowance — v21 treated them as independent and lost both: rings pushed
 * in far enough to fill the frame left no room for a dark centre, and rings
 * previously pushed out far enough to protect a dark centre had landed
 * beyond ≈796.5px, contributing nothing. Fixed by shrinking wave-warp
 * `height` (200 -> 140, see `WAVE_WARP_PAYLOAD`) to shrink the inward-spill
 * budget a dark centre costs, and re-fitting all three rings inside the
 * ≈796.5px bound (520-760 / 660-920 / 800-1100) rather than choosing radii
 * independently of that bound. See the `RINGS` comment for the corner-
 * distance re-derivation (all four corners, not just the closest one), the
 * dark-centre arithmetic, and the check on ring C's reach given wave-warp's
 * inward displacement.
 *
 * v23: the governing measurement this time, which explains the empty
 * top/bottom chased across v21-v22 without ever naming its actual cause:
 * from the shared ring centre (700, 380), the frame's left/right edges
 * average ~640px away but its top/bottom edges average only ~360px away —
 * the frame is 16:9, not square. A CIRCULAR ring has the same reach in
 * every direction, so any ring wide enough to leave a dark centre
 * (`innerR` above ~400) necessarily clears the top/bottom edges entirely
 * while still intersecting the frame on the left and right — which is
 * exactly what v21 and v22 both produced. Lowering `innerR` to reach
 * top/bottom would route ribbons back through the middle and destroy the
 * dark centre; the two goals are incompatible for a circle. Ring geometry
 * in a non-square frame has to be ELLIPTICAL, not circular — fixed by
 * {@link RING_ASPECT_Y} (0.72), baked into {@link bladePath}'s polar ->
 * cartesian conversion (y only), turning every ring into a wide ellipse.
 * `RINGS`' `innerR`/`outerR` values are unchanged from v22 — they are now
 * elliptical (x-axis) bounds rather than circular ones. See
 * `RING_ASPECT_Y`'s own comment for why this is baked into geometry rather
 * than a transform, and the accepted "breathing" consequence of squashing
 * before rotation rather than after; see the `RINGS` comment for the
 * re-derived vertical/horizontal reach arithmetic.
 *
 * v24: THE GOVERNING DISTINCTION that resolves an apparent contradiction
 * between v16 and v20 — wave-warp `width` (wavelength) must be read against
 * the RIBBON's own length, not the field's overall size. v20 was right that
 * wave-warp folds a broad field and that the fold IS the fine-ribbon
 * structure; it did not specify what "broad" was relative to. The inherited
 * `width: 70` put a wave period every 70px ACROSS each ribbon's width,
 * chopping it into short comb teeth (fine texture, but the WRONG grain
 * direction) instead of sweeping the ribbon's whole length into a gentle
 * arc — the reference's fine striations run ALONG a ribbon's length, not
 * across it. A wavelength short relative to the ribbon serrates it
 * (v16's finding, and this round's bug); one comparable to the ribbon's
 * visible length bends it into a sweep instead. Fixed by raising
 * `WAVE_WARP_PAYLOAD.width` 70 -> 500 (comparable to a ribbon's length) and
 * `height` 140 -> 180 (keeping the fold deep enough at the new wavelength).
 * Fine grain WITHIN a ribbon now comes from blade COUNT instead (`RINGS`,
 * 3/4/5 -> 6/8/10 blades, `halfWidthDeg` roughly halved) — more, thinner
 * ribbons running along their own length, not fewer, fatter ones chopped
 * across by a short wave. See `WAVE_WARP_PAYLOAD` and `RINGS` for the full
 * arithmetic (saturation/gap check and re-derived black-centre check).
 *
 * v25: v24's 24-blade version merged into one solid mass, and the previous
 * several rounds had been nudging one variable at a time and oscillating
 * between too sparse and too merged. This round derives every parameter
 * from a direct measurement of the reference instead. THE STRUCTURAL RULE,
 * worth recording because it cost several rounds: RADIALLY OVERLAPPING
 * rings destroy angular gaps regardless of per-ring blade spacing, because
 * one ring's blades land in another ring's gaps and the UNION of coverage
 * closes even though each ring individually still has open gaps. Fixed by
 * deleting ring C and choosing the remaining two rings' radial bands
 * (500-740, 760-1050) to be non-overlapping, so each ring's own gaps
 * survive. Separately, THE THREE-WAY CONSTRAINT that ties the numbers
 * together, also worth recording so it isn't tuned as three independent
 * knobs again: band width sets the target `BLUR_RADIUS`; that same
 * `BLUR_RADIUS` sets the minimum blade width needed for a saturated core to
 * exist at all; and it also sets the minimum gap width needed for black to
 * survive between blades. `BLUR_RADIUS` dropped 60 -> 55, derived backward
 * from a measured ~12px band-width target (see `BLUR_RADIUS` for the
 * derivation), and `RINGS`' blade widths/spacing were chosen to satisfy the
 * saturation and gap constraints against that same 55. See `BLUR_RADIUS`
 * and `RINGS` for the full arithmetic, including an internal ambiguity in
 * how "edge-gradient span" has been defined across rounds, surfaced rather
 * than silently resolved.
 *
 * v26: v25's own gap-spacing arithmetic predicted ~262px angular gaps at
 * r=600, but the rendered `-field` panel showed a smooth continuous annulus
 * with no blade structure at all — the arithmetic and the render disagreed.
 * Every parameter round since v22 (ring radii, blade counts, `halfWidthDeg`,
 * `arcSpanDeg`) had been reasoning from arithmetic plus the FULLY-PROCESSED
 * render, never from the raw source geometry itself — nobody had looked at
 * the blade polygons directly since the ring-of-blades model replaced the
 * star in v10. Fixed the blind spot first: added a fourth `-raw` diagnostic
 * variant (`buildRawLookGraph`, `source -> output` with no blur/wave-warp/
 * colorama/deep-glow) so the authored geometry is visible with zero
 * processing. Simultaneously tested a specific hypothesis about WHY the
 * arithmetic might not match the shape: `arcSpanDeg: +200`/`-180` sweeps
 * over half a turn of angle while the radius grows only 240px/290px,
 * producing a very long, tightly-wound spiral per blade (arc length
 * integrated over the polar curve, verified independently via Simpson's
 * rule: ring A ≈2178px of arc against 240px of radial extent, ring B
 * ≈2858px against 290px — both roughly 9-10x their radial span) that
 * plausibly self-overlaps or overlaps its neighbours in ways the
 * fixed-radius angular-gap calculation does not model. Dropped both rings'
 * `arcSpanDeg` magnitude sharply (200 -> 70, -180 -> -60; re-verified same
 * way: ring A arc length drops to ≈795px, ring B to ≈992px, both closer to
 * 3x their radial extent) so each blade reads as a short, clearly separated
 * arc rather than a wound spiral. See `RINGS` for the full arithmetic. This
 * is a simultaneous test of two variables (the raw panel is diagnostic, the
 * arc-span change is a hypothesis), not a confirmed fix — the raw panel is
 * what settles which one, if either, was the actual cause.
 *
 * v27: the `-raw` panel settled it immediately — the blades were never thin
 * lenses. They are fat crescent SLABS, roughly 200px thick. The v26
 * arc-span hypothesis was wrong (kept anyway: the shortened spans give
 * clean discrete arcs, which is independently correct); the real problem
 * was blade WIDTH relative to the blur kernel, and it had been invisible
 * because nobody had looked at the raw geometry since the ring-of-blades
 * model replaced the star in v10 — every round from v22 on tuned spacing,
 * counts, and radii against an imagined thin-lens shape that was never what
 * was actually authored. This also resolves the band-width-convention
 * ambiguity flagged in v25 (v18's "edge-gradient span ≈ 2*BLUR_RADIUS"
 * reading vs. v19's implied "≈ BLUR_RADIUS" reading) — in favour of v18.
 * THE BAR-BLUR MODEL, written out explicitly because it should have been
 * from the start: for a bar of width W under a box blur of kernel width
 * K = 2*BLUR_RADIUS + 1, if W > K the bar renders as a saturated PLATEAU of
 * width W-K at alpha 1, flanked by a RAMP of width K on each side (this is
 * where all banding lives); the total visible BUNDLE spans W+K; and the
 * band width within a ramp is K / (`COLORAMA_REPETITIONS` * stop count).
 * Solved against the reference's measured ~275px bundle, ~15px bands, and a
 * thin bright core: 15px band -> K = 15 * 9 = 135 -> `BLUR_RADIUS`
 * (K-1)/2 = 67 (55 -> 67); thin core -> W just above K -> W ≈ 140px. The
 * PREVIOUS `halfWidthDeg: 10` gave W ≈ 209px at r=600 — half again too fat,
 * with a ≈98px flat saturated plateau consuming most of each ribbon's
 * width. That is exactly the mechanism behind the flat bright washes every
 * round since ~v17 kept re-encountering under different names (peak-alpha
 * failure, coverage/saturation tug-of-war, merged annulus): THE GRADIENT IS
 * THE SUBJECT, and a blade much wider than the kernel renders mostly as
 * flat plateau, not gradient, no matter how the surrounding parameters are
 * tuned. `halfWidthDeg` and blade counts are re-derived from this model in
 * `RINGS`, and `BLUR_RADIUS` from it directly. Note this is a case where
 * MORE blur was the fix, not less — counter to what a "too flat" symptom
 * would naively suggest — because what actually changed is the width-to-
 * kernel RATIO, not the kernel size in isolation.
 *
 * v28: a one-variable-at-a-time error in v27 — `BLUR_RADIUS` was raised
 * (55 -> 67, widening the kernel K = 2*BLUR_RADIUS+1 to 135) AND
 * `halfWidthDeg` was narrowed in the SAME round (ring A 10 -> 7, ring B
 * 8 -> 5.5). The two changes fought each other: a wider kernel needs a
 * WIDER blade to still exceed it and produce any saturated plateau at all;
 * narrowing the blade at the same moment moved most of each blade's
 * squashed, tapered length below the new, larger kernel, where W < K means
 * there is no plateau and peak alpha caps at W/K instead of reaching 1.
 * Visible result: the vivid panel showed blue/violet/pink with no cream or
 * white core — alpha never reached the 0.80/0.90 stops. THE COUPLING, worth
 * recording plainly because it is what caused this: blade width and blur
 * radius are NOT independent knobs. The kernel sets the minimum blade width
 * for any saturated core to exist at all, so raising the blur REQUIRES
 * widening the blade (or reducing blade count to compensate in gap space),
 * never narrowing it — changing both in opposite directions at once cancels
 * out and reads as "the palette top is unreachable", which is exactly the
 * PEAK-ALPHA FAILURE first hit in v7 (thin star arms) and again in v12
 * (thin ring blades), now reached a third time by a third route (blur/width
 * decoupling instead of raw thinness). Fix: keep `BLUR_RADIUS` at 67 (it
 * correctly targets ~15px bands and was never the problem) and restore
 * `halfWidthDeg` to its pre-v27 values, reducing blade COUNT instead so the
 * now much-wider bundles still leave black gaps. See `RINGS` for the full
 * re-derived saturation/gap arithmetic.
 *
 * v29 (S5 step 2): a real engine-level scare turned out to be a measurement
 * blind spot, not a bug — worth recording plainly because it nearly sent
 * this file chasing a WebGL rendering fix that didn't exist. The `-field`
 * panel's blur appeared completely absent when measured via RGB luminance
 * (a canvas readback scanning for pixels between 4% and 96% luminance found
 * ZERO). The actual cause: `getImageData` returns STRAIGHT (un-premultiplied)
 * alpha, and this file's blade fill is uniform solid white — dividing a
 * blurred edge's premultiplied RGB by its own (also blurred) alpha exactly
 * cancels the fade back out, so straight RGB stays ~(255,255,255) everywhere
 * alpha > 0 and drops to 0 only exactly where alpha == 0. RGB luminance on a
 * uniform-color fill is a hard binary step NO MATTER HOW SMOOTHLY ALPHA
 * ITSELF IS BLURRED — the gradient lives entirely in the alpha channel,
 * invisible to RGB. This is a real, general trap, not specific to this
 * incident: it is why `compareLuma()` (in `compareHtml`, RGB-based) is only
 * ever valid on the `vivid`/`brand` panels, where colorama's
 * `inputPhase:"alpha"` makes RGB alpha-DEPENDENT — never on `field`/`raw`,
 * whose fills are uniform. `compareAlpha()` was added to `compareHtml`
 * specifically to measure `field`/`raw` correctly, reading `data[i*4+3]`
 * directly; both functions now carry a comment stating which panels they
 * are valid for and why, so this is not re-discoverable the hard way again.
 * Once measured correctly (alpha, not luminance), the REAL diagnosis
 * emerged: field-panel peak alpha was 0.643 with 0% saturated pixels
 * against a >0.9 target — nothing saturates, so the palette's pink (0.68),
 * cream (0.80), and near-white (0.90) stops were unreachable BY
 * CONSTRUCTION, regardless of how any other parameter was tuned. Root cause
 * of the low peak alpha: v28's saturation arithmetic evaluated `halfWidthDeg`
 * at one representative radius, but `bladePath` tapers width by `sin(pi*t)`
 * along the blade's length (full width only at the radial midpoint, 0 at
 * both ends) and `RING_ASPECT_Y` squashes it further off the x-axis — so
 * the true saturated core was far smaller than that single-radius estimate
 * implied. Fix, ONE variable per the plan's discipline: `halfWidthDeg` only
 * — ring A 10 -> 16, ring B 8 -> 13 (roughly 1/0.643 ≈ 1.56x, deliberately
 * overshooting into a small saturated plateau, which is what actually
 * produces the reference's thin bright core). `BLUR_RADIUS`, blade counts,
 * ring radii, `arcSpanDeg`, wave-warp, and both palettes are unchanged; the
 * resulting gap loss from wider bundles is deliberately left unmeasured and
 * uncompensated this round, to be addressed as its own separate step. See
 * `RINGS` for the full re-derived arithmetic.
 *
 * v30: the bar-blur model's `K = 2*BLUR_RADIUS + 1` is a BOX-kernel
 * approximation of a filter that is actually GAUSSIAN — `blurPrimitives`
 * emits `feGaussianBlur` with `stdDeviation = radius/2`, not a box blur.
 * The distinction matters for exactly the claim the model rests on: a box
 * kernel CLAMPS (once blade width W exceeds K, the excess is a flat plateau
 * at alpha 1); a Gaussian kernel does not clamp — peak alpha only
 * APPROACHES 1 ASYMPTOTICALLY as W grows past the kernel. So "W > K
 * guarantees a saturated plateau" was never strictly true, and this is part
 * of why v28's arithmetic predicted a 74px saturated core (from W > K) when
 * the v29 alpha measurement found 0% saturated. The v29->v30 measurement
 * confirms the asymptotic (not clamped) shape directly: widening
 * `halfWidthDeg` 1.6x (10 -> 16) raised peak alpha only 1.29x (0.643 ->
 * 0.8275), a sub-linear response consistent with a Gaussian curve, not a
 * box-kernel clamp that would have jumped straight to 1.0 once W crossed K.
 * Still 0% saturated at 0.8275 — cream (0.80) is only just reachable, near-
 * white (0.90) is not. Same lever again, still the one variable this whole
 * S5 sequence has been isolating: ring A `halfWidthDeg` 16 -> 22, ring B
 * 13 -> 18. `BLUR_RADIUS`, blade counts, ring radii, `arcSpanDeg`, wave-warp,
 * and both palettes stay unchanged again. See `RINGS` for the full note.
 *
 * v31 (TASK 2 REWRITE): supersedes v10-v30's entire blade-ring geometry
 * model, on explicit instruction: follow the Demo 1 transcript's actual
 * steps literally, now that `bend-warp` exists as a real GPU node (added
 * specifically to close this gap — see
 * docs/product-knowledge/colorama-wave-warp-look-nodes.md). The transcript
 * authors ONE star, then duplicates/mirrors the whole warped composition in
 * a precomp; this generator cannot precompose, so the mirror is authored as
 * a second star instead, sharing the one full-frame Look chain (both stars
 * are processed together — blur/wave-warp/colorama/bend-warp/deep-glow all
 * see both at once, not two separately-warped copies — see `buildScene`).
 * `bladePath`, `RingSpec`, `RINGS`, `RING_ASPECT_Y`, `bladeNode`, and
 * `BLADES` are deleted entirely; `starPath`/`StarSpec`/`STARS`/`starNode`
 * replace them — a PLAIN star polygon (alternating outer/inner-radius
 * vertices, straight edges, no curl, no polar-swept construction), matching
 * the transcript's actual source shape instead of this file's own derived
 * annulus-of-blades model. v10's original objection to a per-corner-star
 * model — "two stars curl about two different centres, which cannot become
 * one shared circular sweep" — no longer applies: the circular sweep in the
 * reference was never baked into star geometry in the transcript either, it
 * comes from `bend-warp`'s arc bend (Demo 1 step 8, AE Warp), which now
 * exists and is added to the chain (`colorama -> bend-warp -> deep-glow`,
 * static, no keyframe track — the transcript's Warp setting is fixed, not
 * animated; see `BEND_WARP_PAYLOAD`). `BLUR_RADIUS` and wave-warp's
 * `height`/`width` are rescaled from the transcript's literal 1080-wide-comp
 * values by the same ×0.67 factor v25 established (1280/1920 ≈ 0.67): blur
 * 80 -> 54, wave-warp height 200 -> 133, width 70 -> 47; `direction` (35)
 * and `waveType` (semicircle) are unchanged. Colorama (stops, `phase: 0`
 * static, `repetitions: 1`, `inputPhase: "alpha"`, `mix: 1`) and deep-glow
 * are UNCHANGED from v30 — neither is geometry-dependent. The `-field`
 * diagnostic export variant stays `source -> blur -> wave-warp -> output`
 * (no bend-warp — it is still the pre-colorama alpha diagnostic, and
 * bend-warp is a pure remap with no effect on alpha statistics that
 * `compareAlpha()` would need to see through); `-raw` stays `source ->
 * output` only. The v10-v30 history above remains as the record of the
 * blade-ring model's own tuning methodology (the bar-blur model, the
 * alpha-vs-luminance measurement discipline, the one-variable-at-a-time
 * protocol) — real, transferable lessons — but no longer describes the
 * current geometry; every `{@link RINGS}`/`{@link bladePath}`/
 * `{@link bladeNode}` cross-reference above is now a dangling pointer to
 * deleted code, left as-is rather than rewritten, since the prose around
 * each one is still an accurate historical record of a decision actually
 * made. See `STARS` for the reach arithmetic confirming both stars occupy
 * their own half of the frame while a tip can sweep the exact frame centre
 * at certain rotation phases (not fully excluded — see that comment for the
 * honest numbers, not a rounded-off claim of a clean gap).
 *
 * v32: a browser check of v31 found two remaining gaps against the
 * reference, both fixed by parameters only — chain topology untouched.
 * (1) COVERAGE: the two `outerR:420` stars filled nearly the whole frame,
 * leaving no dominant black field or clear corridor. Fixed by shrinking both
 * stars (`outerR` 420 -> 300, `innerR` 150 -> 100) and pulling their centres
 * inward from the corners ((330,240)/(950,480) -> (260,170)/(1020,550)) —
 * see `STARS`' updated reach arithmetic, which now shows `outerR` is LESS
 * than the star-to-frame-centre distance, so the corridor is permanently
 * black rather than only usually black between periodic tip sweeps (v31's
 * actual behaviour, stated honestly in that round's own arithmetic). (2)
 * EDGE SMEAR: the bottom of the frame showed a smeared band where
 * `bend-warp`'s arc dragged content past the frame edge into its clamp
 * (bend-warp clamps out-of-bounds samples to the edge texel — a repeat
 * smear — unlike `wave-warp`'s pin/taper, see the GLSL comments in
 * `src/shared/gpu-lens/surface.ts`). Fixed by lowering `bend` 0.7 -> 0.5,
 * which pulls less content past the edge in the first place. Blur, wave-warp
 * (height/width/direction/phase ramp), colorama, deep-glow, both palettes,
 * and all four export panels are unchanged.
 *
 * v33 (BAND-COUNT correction): a full-res browser review of v32 rejected the
 * result correctly — it rendered as dozens of thin parallel streaks
 * (brushed-metal / speed-line texture) instead of the reference's 5-8 BROAD
 * satin ribbons (wide dark-blue bodies, 60-150px at reference scale, with
 * thin cream/white highlight edges). THREE contributors, all fixed this
 * round, all parameters — chain topology and palettes untouched:
 * (1) ARM COUNT/SIZE: `STARS`' `arms` 8 -> 5 (fewer, wider arm-edge bands
 * per star) and `outerR`/`innerR` 300/100 -> 460/150 (more radius for each
 * edge's gradient to spread across) — see `STARS`' updated reach arithmetic
 * for the resulting, now much tighter frame-centre margin (~5.3px, down
 * from v32's ~124.85px — flagged plainly there, not glossed over).
 * (2) FINE RIPPLE: `WAVE_WARP_PAYLOAD`'s `width` (wavelength) 47 -> 380 — a
 * DEPARTURE from the v31 literal-transcript rescale, not a further scale
 * tweak (see that constant's own v33 comment) — since a 47px wavelength was
 * superimposing its own fine ripple onto the alpha field on top of the arm
 * edges, independently multiplying band count; `height` raised 133 -> 150
 * to keep the (now much broader) bend visible at the longer wavelength.
 * (3) GRADIENT WIDTH: `BLUR_RADIUS` 54 -> 60, widening the gradient body
 * between each edge's dark core and bright highlight. `bend` also raised
 * 0.5 -> 0.6 (longer sweep, `distortionH` unchanged at 1.0) per the task
 * spec, orthogonal to the band-count fix. Expected result: each star
 * contributes ~5 arm-edge bands per cluster instead of ~16 (8 arms x 2
 * edges), each spanning tens of px instead of a few — broad colour bodies
 * with thin bright cores, not brushed metal.
 *
 * v34: TWO fixes, one in `src/shared/gpu-lens/surface.ts` (a shared GPU
 * node, not this file), one here. (1) `FRAGMENT_SHADER_BEND_WARP`'s
 * out-of-bounds sample handling changed from clamp-to-edge to
 * reveal-transparency (`outColor = vec4(0.0)` outside [0,1] on either axis):
 * a full-res browser check found the clamp producing a visible streaky
 * smear of repeated edge-texel colour wherever the arc bend dragged content
 * past the frame — AE's Warp reveals empty space beyond the source layer,
 * it never smears the boundary outward. See that shader's own doc comment
 * in `surface.ts` for the fix. (2) That fix exposed a follow-on defect
 * HERE: `deep-glow` (screen blend) was blooming pale washes into the
 * newly-transparent regions. The faithful fix is also the simpler one — the
 * transcript's Demo 1 chain has NO glow at all (glow only appears in Demos
 * 2/4/5); `deep-glow` was a leftover assumption never actually specified by
 * the transcript this file claims to follow. Removed entirely: the node,
 * its edge, and its tuning constant (formerly `DEEP_GLOW_THRESHOLD`, see the
 * retired comment above `COLORAMA_REPETITIONS`). Chain is now `source ->
 * blur -> wave-warp -> colorama -> bend-warp -> output`. `field`/`raw`
 * panels are unaffected (neither ever included deep-glow).
 *
 * v36: another `src/shared/gpu-lens/surface.ts` node addition, not a
 * generator-only tune — bend-warp gains a `scale` param (0.25..4, default
 * 1, keyframeable), full plumbing (type/normalize/param-catalog/
 * `withLookNodeParam`/GPU-adapter/shader/uniform wiring), reusing the
 * already-shared `uScale` uniform name. A browser check of v35 found the
 * warped sheet's own boundaries visible in-frame (a jagged diagonal cut
 * top-right, a large black arc under the sheet's curved bottom edge) — in
 * AE this never shows because the warped precomp is scaled up and
 * positioned so its edges sit outside the comp, and `scale` is the
 * equivalent zoom applied directly in the shader (this node has no precomp
 * of its own). Used here at `scale: 1.35` (see `BEND_WARP_PAYLOAD`);
 * nothing else in this file's chain, geometry, or parameters changed.
 *
 * v37: `scale: 1.35` from v36 was insufficient — a browser check still
 * showed the sheet's own curved bottom boundary in frame. Root cause: the
 * zoom margin and the warp displacement are COUPLED, and v36 never checked
 * the inequality between them (margin (1-1/1.35)/2 ≈ 12.96% vs. worst-case
 * displacement max(0.6*0.4, 1.0*0.25) = 25% — displacement exceeded margin
 * by ~12 points). `scale`/`bend`/`distortionH` raised/lowered together
 * (1.35->1.6, 0.6->0.45, 1.0->0.7) so the inequality holds with a thin but
 * positive margin (~0.75 points) — see the governing inequality now
 * recorded as a comment on `BEND_WARP_PAYLOAD` itself, so this coupling
 * cannot be silently violated again by tuning one of the three fields
 * without the others.
 *
 * The final palette is a user decision, so this emits BOTH a reference-
 * faithful vivid palette and a brand-keyed palette as two complete asset
 * sets, plus a third diagnostic-only `-field` variant (the chain with
 * colorama/bend-warp/deep-glow removed, i.e. the raw pre-colorama
 * blur/wave-warp output) and a fourth diagnostic-only `-raw` variant
 * (`source -> output` only, the authored star polygons with zero
 * processing), and a side-by-side `compare.html` — with an FNV-1a canvas
 * hash, a Rec.709 luminance-percentile readout, and an alpha-percentile
 * readout — for the frame-0 static review, so palette traversal is a
 * measurement rather than a guess.
 *
 * Usage:
 *   bun run scripts/generate-liquid-gradient-piece.ts
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { withSegmentEasing } from "@/entities/motion/model/easing";
import type {
	KeyframeTrack,
	LookNodeParamTrack,
	MotionDocument,
} from "@/entities/motion/model/types";
import { sceneNeedsGpuSurface } from "@/entities/scene/model/gpu-raster-adapter";
import {
	type LookGraph,
	type LookGraphOwnerRef,
	lookGraphPortId,
	normalizeLookGraph,
} from "@/entities/scene/model/look-graph";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";
import { createExportBundle } from "@/features/export/model/bundle";
import { exportOptimizationOptionsForProfile } from "@/features/export/model/optimization";
import { createWebglPlayerExportAssets } from "@/features/export/model/webgl-player";
import type { AePoint, AeShape } from "@/shared/glammer/ae-shape";
import type { AeKeyframe } from "@/shared/glammer/keyframe-track";

const SLUG = "liquid-gradient-02";
const outputDirectory = path.join(process.cwd(), `artifacts/${SLUG}`);

const ARTBOARD_ID = "liquid-gradient-artboard";
const ARTBOARD_WIDTH = 1280;
const ARTBOARD_HEIGHT = 720;
const ARTBOARD_FPS = 30;
const DURATION_FRAMES = 360;

/**
 * Background — pure black, matching the reference exactly: the whole centre
 * of the title card is flat `#000000` (the LP copy area), not a near-black
 * navy. Also used for the QA/compare page chrome background.
 */
const BLACK = "#000000";

const identityTransform = {
	position: { x: 0, y: 0 },
	rotation: 0,
	scale: { x: 1, y: 1 },
	anchor: { x: 0, y: 0 },
} as const;

// --- Star geometry (v31) --------------------------------------------------
// Replaces v10-v30's blade-ring model entirely (see the v31 top-of-file
// history entry for why: bend-warp — the transcript's actual source of the
// circular sweep — now exists, so the source shape can go back to being the
// transcript's own plain star instead of this file's derived
// annulus-of-blades). The transcript authors ONE broad star, then
// duplicates/mirrors the whole warped composition in a precomp; this
// generator has no precompose step, so the mirror twin is authored as a
// second, independent star instead, and BOTH are pushed through the one
// shared full-frame Look chain together (not two separately-warped copies —
// see `buildScene`).

/**
 * A plain star polygon around the LOCAL origin: `arms * 2` vertices
 * alternating between `outerR` (tip) and `innerR` (valley), straight edges
 * (zero in/out tangents), no curl, no polar sweep — deliberately the
 * simplest possible star, matching the transcript's actual source shape
 * (Demo 1 step 1) rather than this file's own v4-v9 curled-arm or v10-v30
 * swept-blade constructions. The first tip sits at -90deg (straight up);
 * the choice is arbitrary since both stars rotate continuously through the
 * whole loop (see `spinTrack`).
 */
const starPath = (arms: number, outerR: number, innerR: number): AeShape => {
	const pointCount = arms * 2;
	const vertices: AePoint[] = [];
	for (let i = 0; i < pointCount; i += 1) {
		const angleDeg = -90 + (360 * i) / pointCount;
		const radius = i % 2 === 0 ? outerR : innerR;
		const theta = (angleDeg * Math.PI) / 180;
		vertices.push([radius * Math.cos(theta), radius * Math.sin(theta)]);
	}
	const zero: AePoint = [0, 0];
	return {
		type: "Shape",
		closed: true,
		vertices,
		inTangents: vertices.map(() => zero),
		outTangents: vertices.map(() => zero),
	};
};

type StarSpec = {
	readonly id: string;
	readonly arms: number;
	readonly outerR: number;
	readonly innerR: number;
	readonly cx: number;
	readonly cy: number;
	/** Total rotation across the 360-frame loop, degrees (sign = direction). */
	readonly totalDegrees: number;
};

/**
 * REACH ARITHMETIC (declared before drawing, per this file's own
 * one-variable/verify-the-numbers discipline — see the retired `RINGS`
 * history for why that discipline exists). `star-b` is the exact 180-degree
 * point reflection of `star-a` through the frame centre (640, 360):
 * `(640*2-230, 360*2-140) = (1050, 580)`, confirmed — so every distance
 * below mirrors exactly between the two stars.
 *
 * v33 (band-count correction): a full-res browser review of v32 found the
 * output was dozens of thin parallel streaks (brushed-metal), not the
 * reference's 5-8 BROAD ribbons per cluster — a band-COUNT problem, not a
 * coverage one. Two of the three contributors were geometric: 8 arms ->
 * fewer, wider ones (5), and `outerR`/`innerR` widened (300/100 -> 460/150)
 * so each arm-edge gradient has more radius to spread across (the other
 * contributor, wave-warp's fine ripple, is fixed in `WAVE_WARP_PAYLOAD`, not
 * here). Centres nudged slightly further into the corners (260,170)/
 * (1020,550) -> (230,140)/(1050,580) to compensate for the larger `outerR`
 * eating back into the corridor margin below.
 *
 * - Distance star-a centre (230,140) -> frame centre (640,360): dx=410,
 *   dy=220, dist = sqrt(410^2+220^2) = sqrt(216500) ~= 465.30px. `outerR`
 *   (460px) is LESS than this by only ~5.30px — a MUCH thinner margin than
 *   v32's ~124.85px. No tip reaches the frame centre at f0 rotation, but
 *   this is a razor-thin, not comfortable, margin: worth flagging plainly
 *   rather than rounding it up to "safe", since `outerR` growing further in
 *   a future round would cross this within a handful of pixels.
 * - Distance star-a centre -> nearest frame corner (0,0): dx=-230, dy=-140,
 *   dist = sqrt(72500) ~= 269.26px, well under `outerR` (460px) -> tips
 *   overlap that corner by ~190.74px (off-frame, fine — wider overlap than
 *   v32's ~11px since the star grew).
 * - Distance star-a centre -> top edge (y=0): 140px; `outerR` (460) crosses
 *   it by ~320px. -> left edge (x=0): 230px; crossed by ~230px.
 * - Distance star-a centre -> bottom edge (y=720): 580px; -> right edge
 *   (x=1280): 1050px. `outerR` (460) reaches NEITHER — star-a still stays
 *   clear of the bottom-right, where star-b lives, with ~120px/~590px of
 *   margin respectively.
 * - By the point-reflection above, star-b's numbers mirror exactly.
 *
 * Net: both stars still sit inside their own quadrant with a genuinely black
 * (if now much narrower) diagonal corridor between them, and a wider
 * off-frame overlap at their own corner than v32 had.
 */
const STARS: readonly StarSpec[] = [
	{
		id: "star-a",
		arms: 5,
		outerR: 460,
		innerR: 150,
		cx: 230,
		cy: 140,
		totalDegrees: 720, // +2 turns
	},
	{
		id: "star-b",
		// Mirror twin (point reflection of star-a through the frame centre).
		// Counter-rotation (-2 turns vs. +2) is what gives the mirrored
		// reading — see the task spec and the reach-arithmetic comment above.
		arms: 5,
		outerR: 460,
		innerR: 150,
		cx: 1050,
		cy: 580,
		totalDegrees: -720, // -2 turns
	},
];

const starNodeId = (star: StarSpec): string => `${star.id}-node`;

const starNode = (star: StarSpec): VectorNode => ({
	id: starNodeId(star),
	name: star.id,
	geometry: {
		kind: "path",
		shape: starPath(star.arms, star.outerR, star.innerR),
	},
	transform: { ...identityTransform, position: { x: star.cx, y: star.cy } },
	style: {
		fill: "none",
		stroke: "none",
		strokeWidth: 0,
		opacity: 1,
		fills: [
			// Solid white: colorama's `inputPhase: "alpha"` + `mix: 1` (see
			// `buildLookGraph`) overwrites fill RGB entirely downstream — only
			// the shape's blurred ALPHA footprint drives the final colour. This
			// is still what the `-field` diagnostic export variant (no colorama
			// stage) actually shows.
			{ kind: "solid", color: "#ffffff" },
		],
	},
	visible: true,
	locked: false,
});

// --- Look graph: blur -> wave-warp -> colorama -> bend-warp ---------------
// Mirrors the AE recipe order exactly. Both wave-warp and colorama are the
// real GPU passes now (see docs/product-knowledge/colorama-wave-warp-look-nodes.md);
// this piece is their first real authored use, not another probe scene.
// v34 removed `deep-glow` from the end of this chain — see that version's
// top-of-file history entry and the retired comment above
// `COLORAMA_REPETITIONS` for why.

const edge = (fromNode: string, toNode: string) => ({
	from: {
		nodeId: fromNode,
		portId: lookGraphPortId(fromNode, "output", "image"),
	},
	to: { nodeId: toNode, portId: lookGraphPortId(toNode, "input", "image") },
});

/**
 * v17 REWRITE: a higher-resolution look at the reference showed a SINGLE
 * ribbon contains MULTIPLE full palette traversals (navy -> blue -> violet
 * -> magenta -> cream -> navy, repeating), with a DARK CORE at each wide
 * band's centre. That is exactly what alpha-driven colorama produces with
 * `repetitions > 1` (see `COLORAMA_REPETITIONS` and the v17 top-of-file
 * history entry): a blade's saturated alpha plateau maps to
 * `fract(1 * repetitions)` = 0 = stop 0 = dark, while the blurred edge ramp
 * (alpha 0->1) traverses the whole ramp once per repetition. So this ramp is
 * now ONE FULL CYCLE, dark at BOTH ends (`{@link BLACK}`-adjacent near-black
 * navy at 0 and a matching deep navy bridge at 0.97) so every repetition of
 * the cycle is bounded by a dark seam on both sides — that seam is what
 * separates the reference's stacked bands from each other. In order: near-
 * black navy (surround/dark core) -> electric blue -> bright blue -> violet
 * -> magenta -> pink -> pale cream -> near-white (thin specular) -> deep
 * navy (bridges back to stop 0). See the TRAP comment on the terminal stop
 * for why it must stay strictly below 1.0.
 */
const VIVID_COLORAMA_STOPS = [
	{ offset: 0, color: "#05060f" }, // near-black navy — surround AND dark core
	{ offset: 0.12, color: "#1b2fd6" }, // electric blue
	{ offset: 0.26, color: "#4a6cff" }, // bright blue
	{ offset: 0.4, color: "#8f5fe8" }, // violet
	{ offset: 0.55, color: "#d95bd0" }, // magenta
	{ offset: 0.68, color: "#ff9ec4" }, // pink
	{ offset: 0.8, color: "#ffe9a8" }, // pale cream
	{ offset: 0.9, color: "#fff8e0" }, // near-white — thin specular
	// TRAP: this terminal offset must stay strictly below 1.0. `rampAt` (see
	// `src/shared/gpu-lens/surface.ts`) resolves every `t` that falls inside
	// an authored [previousOffset, offset] segment via its interior loop; if
	// the last offset is exactly 1.0, that loop already covers the FULL
	// [0,1) range, so the loop's post-hoc wraparound cross-fade back to
	// stop[0] never runs (it is dead code) and the last-stop -> first-stop
	// transition becomes a hard cut instead of a blend. 0.97 leaves a real
	// [0.97, 1.0) wraparound segment for that cross-fade to blend through.
	{ offset: 0.97, color: "#0a0a2a" }, // deep navy — bridges back to stop 0
];

/**
 * Brand-keyed ramp, same v17 shape as {@link VIVID_COLORAMA_STOPS}: dark at
 * both ends (a near-black deep-green surround/core, bridging back through a
 * matching deep-green stop at 0.97) with a full traversal through the brand
 * hue family — deep green -> mid green -> yellow-green -> acid -> pale
 * acid -> pale cream -> near-white specular — in between, so multiple
 * `repetitions` of this ramp produce the same stacked-band structure as
 * vivid, in brand hues instead of blue/magenta/cream.
 */
const BRAND_COLORAMA_STOPS = [
	{ offset: 0, color: "#04120a" }, // near-black deep green — surround AND dark core
	{ offset: 0.12, color: "#136a35" }, // deep green
	{ offset: 0.26, color: "#2f9c4e" }, // mid green
	{ offset: 0.4, color: "#7bbf3f" }, // yellow-green
	{ offset: 0.55, color: "#c8f24a" }, // acid
	{ offset: 0.68, color: "#e9ffb0" }, // pale acid
	{ offset: 0.8, color: "#f5ffe0" }, // pale cream
	{ offset: 0.9, color: "#fffef2" }, // near-white — thin specular
	// TRAP: same terminal-offset rule as `VIVID_COLORAMA_STOPS` — this must
	// stay strictly below 1.0 or `rampAt`'s wraparound cross-fade back to
	// stop[0] is bypassed and the wrap becomes a hard cut. See that ramp's
	// comment for the mechanism.
	{ offset: 0.97, color: "#0a2012" }, // deep green — bridges back to stop 0
];

// v31: retired the entire v7-v27 blur history above (it was derived against
// the deleted blade-ring geometry and no longer applies) in favour of a
// direct rescale of the transcript's own literal (Fast Box Blur radius 80,
// Demo 1 step 4) from its 1080-wide comp to this file's 1280-wide frame:
// 80 * (1280/1920) ≈ 80 * 0.67 ≈ 54.
//
// v33: raised 54 -> 60. A full-res browser review found the piece rendering
// as dozens of thin parallel streaks (brushed-metal) instead of the
// reference's 5-8 broad satin ribbons — a band-COUNT problem. Widening the
// blur widens the gradient body between each arm edge's dark core and its
// bright edge, one of three contributors fixed this round alongside arm
// count/radius (`STARS`) and wave-warp wavelength (below) — see the v33
// top-of-file history entry for the full three-part diagnosis.
const BLUR_RADIUS = 60;
const BLUR_PAYLOAD = {
	kind: "blur" as const,
	radius: BLUR_RADIUS,
	radiusY: BLUR_RADIUS,
};

// v31: retired the v2-v25 wave-warp history above (also derived against the
// deleted blade-ring geometry) in favour of a literal-transcript rescale of
// Demo 1 step 5's Wave Warp (semicircle, height 200, width 70, direction
// ~35deg, edges pinned) by the same ×0.67 comp-width factor as `BLUR_RADIUS`.
//
// v33: `width`/`height` raised sharply, 47/133 -> 380/150 — a deliberate
// DEPARTURE from the literal-transcript scaling, not a further scale-factor
// tweak. The v31 literal rescale put a wave period every ~47px, which
// superimposes a fine ripple onto the alpha field ON TOP OF the arm edges
// themselves, multiplying the visible edge/band count well past what arm
// geometry alone produces — one of the three contributors to v32's
// brushed-metal look (see the v33 top-of-file history entry). A wavelength
// far longer than any single ribbon's width (380px, comparable to a whole
// arm's span) bends the arms into a broad, slow undulation without adding
// any new fine structure; `height` raised 133 -> 150 to keep the bend
// visible at the new, much longer wavelength. `direction`/`waveType` stay
// the transcript's literals. `phase` stays a static `0` in the payload; the
// actual travel comes from the `lookNodeTracks` `rampTrack` below (unchanged
// mechanism/convention from every prior version).
const WAVE_WARP_PAYLOAD = {
	kind: "wave-warp" as const,
	waveType: "semicircle" as const,
	height: 150,
	width: 380,
	direction: 35,
	phase: 0,
};

// Static — the transcript's Warp (Demo 1 step 8, AE "Warp" effect, Arc
// style) is a fixed setting, not animated: `bend` arcs the folded ribbon
// field into the reference's large curved sweep; `distortionH: 1.0` (AE
// Horizontal Distortion ~100) adds the diagonal shear that reads as the
// sweep's travel direction. `distortionV` stays 0 — the transcript's Warp
// has no vertical distortion. See
// docs/product-knowledge/colorama-wave-warp-look-nodes.md.
//
// v32: `bend` lowered 0.7 -> 0.5 (was AE Bend ~70, now ~50) — the browser
// check found the arc bend was dragging content past the BOTTOM frame edge
// far enough that bend-warp's edge-clamp (not a pin/taper like wave-warp —
// see that node's own comment in `src/shared/gpu-lens/surface.ts`) produced
// a visible smeared band of repeated edge-texel colour.
//
// v33: raised again, 0.5 -> 0.6, alongside the band-count fixes above —
// `distortionH` stays 1.0 for a longer sweep, per the task spec.
//
// v36: `scale: 1.35` added, alongside the node's new `scale` param (see
// `src/shared/gpu-lens/surface.ts`). A browser check of v35 (after v34's
// clamp -> reveal-transparency fix) found the warped sheet's own boundaries
// visible in-frame — a jagged diagonal cut top-right, a large black arc
// under the sheet's curved bottom edge. In AE this never shows because the
// warped precomp is scaled up and positioned so its edges sit outside the
// comp; `scale` is the equivalent zoom, applied here directly since this
// node has no precomp of its own to scale.
// v37: `scale` alone was insufficient by construction — a browser check of
// v36 still showed the bottom black arc (the warped sheet's own curved
// boundary), because the zoom margin never covered the maximum warp
// displacement. The coupling, worth recording as the governing inequality
// for any future change to these four fields together:
//
//   (1 - 1/scale) / 2  >=  max(bend * 0.4, distortionH * 0.25, distortionV * 0.25)
//
// left side = the zoom margin per edge (half the fraction of the frame
// `scale` pulls in from each side); right side = the largest displacement
// any of the three warp params can push a point past its own edge (arc's
// 0.4 coefficient and each shear's 0.25 coefficient are the same constants
// as `FRAGMENT_SHADER_BEND_WARP` in `src/shared/gpu-lens/surface.ts`). At
// v36 (scale 1.35, bend 0.6): margin = (1-1/1.35)/2 ≈ 12.96%, displacement =
// max(0.6*0.4, 1.0*0.25) = max(24%, 25%) = 25% — displacement exceeded
// margin by ~12 points, so the sheet boundary necessarily entered frame.
// v37 raises `scale` and lowers `bend`/`distortionH` together so the
// inequality holds: margin = (1-1/1.6)/2 = 18.75%, displacement =
// max(0.45*0.4, 0.7*0.25, 0*0.25) = max(18%, 17.5%, 0%) = 18% — margin
// exceeds displacement by only ~0.75 points, a thin but real margin, not a
// comfortable one; flagged plainly rather than rounded up to "safe", same
// discipline as `STARS`' reach arithmetic.
const BEND_WARP_PAYLOAD = {
	kind: "bend-warp" as const,
	bend: 0.45,
	distortionH: 0.7,
	distortionV: 0,
	scale: 1.6,
};

// v34: `deep-glow` and its tuning (this comment/`DEEP_GLOW_THRESHOLD`,
// formerly here) are REMOVED — a v34 browser check found deep-glow blooming
// pale washes into the reveal-transparency regions bend-warp's v34 shader
// fix (see `src/shared/gpu-lens/surface.ts`) introduced, screen-blending its
// glow over the newly-transparent alpha-0 pixels. The faithful fix is the
// simple one: the transcript's Demo 1 chain has NO glow at all (glow only
// appears in Demos 2/4/5) — deep-glow here was a leftover assumption from
// before this file's Demo 1 rewrite (v31), never actually specified. See
// `buildLookGraph` for the resulting chain.

// Colorama reads `inputPhase: "alpha"` (a blurred silhouette, not a
// synthetic full-frame luminance sweep). v3-v16 kept this at 1, reasoning
// that a single ramp traversal already reads as a full sweep across each
// ribbon's alpha falloff. v17 changed this to 3, on the premise (see that
// version's top-of-file history entry) that a higher-resolution look at the
// reference showed a SINGLE ribbon containing MULTIPLE full palette
// traversals with a dark core at each band's centre — that `repetitions > 1`
// mechanism (saturated alpha maps to `fract(1 * repetitions)` = 0 = stop 0
// = dark; the blurred edge traverses the palette once per repetition) is
// real and correct under `inputPhase: "alpha"`, but v17's READING of the
// reference was wrong (see v19 below): what looked like one ribbon
// repeating was actually adjacent ribbons each doing their own single
// cycle.
//
// v18: dropped 3 -> 2 while still operating on v17's (incorrect) premise,
// tuning band width via `BLUR_RADIUS` * `repetitions` — see that comment
// for the formula. Superseded by v19's correction below, not because the
// FORMULA was wrong (it wasn't — band width really is edge-gradient span /
// (repetitions * stop count)), but because `repetitions` itself should
// never have been raised above 1 in the first place.
//
// v19: CORRECTED back to 1. Studying the reference again: a single ribbon's
// cross-section is symmetric and runs ONE traversal out and back around its
// alpha peak (dark navy -> blue -> violet -> magenta -> pink -> cream ->
// pale core -> cream -> pink -> magenta -> violet -> blue -> dark navy) —
// not several repeated cycles. What v17 mistook for repetition was simply
// the NEXT ribbon over doing its own cycle. Separately, and this is worth
// recording because the two variables were confounded across v3-v16: every
// earlier `repetitions: 1` round looked flat and monochrome not because
// `repetitions` was the wrong value, but because those rounds' blades were
// too thin for alpha to actually climb past the blue stops (the v7/v12/v15
// peak-alpha failure mode). The untried combination — repetitions 1 AND
// blades wide enough for alpha to genuinely peak near 1 — is what v19
// actually implements (see `RINGS`' saturation check for the resulting
// thin bright core).
//
// v20: kept at 1 — the misattribution corrected this round (see the v20
// top-of-file history entry) is about where the ribbon STRIATION comes from
// (wave-warp folding, not blade geometry), not about how many palette
// traversals sit inside one fold. One traversal per fold is still right;
// wave-warp's folding is what multiplies the visible band count now, not
// `repetitions`.
const COLORAMA_REPETITIONS = 1;

const buildLookGraph = (
	coloramaStops: typeof VIVID_COLORAMA_STOPS,
): LookGraph => {
	const graph = normalizeLookGraph({
		nodes: [
			{ id: "source", kind: "source" },
			{ id: "blur", kind: "blur", payload: BLUR_PAYLOAD },
			{ id: "wave-warp", kind: "wave-warp", payload: WAVE_WARP_PAYLOAD },
			{
				id: "colorama",
				kind: "colorama",
				payload: {
					kind: "colorama",
					stops: coloramaStops,
					// TRAP, must stay static: with `inputPhase: "alpha"`, the
					// transparent surround (alpha 0) samples the ramp at
					// `rampAt(fract(0 * repetitions + phase)) === rampAt(phase)` —
					// i.e. the surround's colour IS whatever colour `phase` is
					// currently pointing at. It reads as black only when phase is
					// exactly 0. Animating this phase (as an earlier pass did, via
					// a `lookNodeTracks` rampTrack) drives the ENTIRE background
					// through the palette over the clip — a solid blue/green wash
					// mid-loop that destroys the black copy-area corridor for most
					// of the timeline, not just frame 0. This is why the transcript
					// never animates Colorama phase in Demo 1 (alpha-driven, no
					// stable surround to lose); the phase-shift expression belongs
					// to Demos 3/4, which drive Colorama from a luminance ramp on
					// an opaque solid, where a moving phase has no transparent
					// surround to flood. All motion here comes from `wave-warp`'s
					// phase ramp and the two stars' `spinTrack`s instead.
					phase: 0,
					repetitions: COLORAMA_REPETITIONS,
					// Alpha-indexed: the blurred stars' silhouette alpha drives the
					// ramp, and the output is opaque, so the fully-transparent
					// surround resolves to stop 0 (black) instead of vanishing. See
					// docs/product-knowledge/colorama-wave-warp-look-nodes.md.
					inputPhase: "alpha",
					mix: 1,
				},
			},
			{
				id: "bend-warp",
				kind: "bend-warp",
				payload: BEND_WARP_PAYLOAD,
			},
			{ id: "output", kind: "output" },
		],
		edges: [
			edge("source", "blur"),
			edge("blur", "wave-warp"),
			edge("wave-warp", "colorama"),
			edge("colorama", "bend-warp"),
			edge("bend-warp", "output"),
		],
		outputNodeId: "output",
	});
	if (!graph) throw new Error("LIQUID GRADIENT Look graph is invalid.");
	return graph;
};

/**
 * Diagnostic-only chain: source -> blur -> wave-warp -> output, i.e. the real
 * chain (as of v34: `blur -> wave-warp -> colorama -> bend-warp`, no
 * deep-glow — see the retired comment above `COLORAMA_REPETITIONS`) with
 * colorama/bend-warp removed. Shares {@link BLUR_PAYLOAD} and
 * {@link WAVE_WARP_PAYLOAD} with {@link buildLookGraph} so the field this
 * exposes is exactly what colorama sees in the real chain, not an
 * approximation of it. Deliberately stops before `bend-warp` (unlike task
 * spec's silence would otherwise leave ambiguous): bend-warp is a pure
 * geometric remap with no effect on alpha VALUES (only their screen
 * position), so it has nothing to add to this pre-colorama alpha
 * diagnostic and would only make the panel harder to read against the raw
 * geometry.
 */
const buildFieldLookGraph = (): LookGraph => {
	const graph = normalizeLookGraph({
		nodes: [
			{ id: "source", kind: "source" },
			{ id: "blur", kind: "blur", payload: BLUR_PAYLOAD },
			{ id: "wave-warp", kind: "wave-warp", payload: WAVE_WARP_PAYLOAD },
			{ id: "output", kind: "output" },
		],
		edges: [
			edge("source", "blur"),
			edge("blur", "wave-warp"),
			edge("wave-warp", "output"),
		],
		outputNodeId: "output",
	});
	if (!graph) {
		throw new Error("LIQUID GRADIENT field-diagnostic Look graph is invalid.");
	}
	return graph;
};

/**
 * v26 diagnostic: source -> output only, no blur/wave-warp/colorama/deep-glow
 * — the blade polygons exactly as authored, with no processing at all. Added
 * because every parameter round since v22 (ring radii, blade counts,
 * `halfWidthDeg`, `arcSpanDeg`) had been reasoning from arithmetic and the
 * rendered (fully-processed) result, never from the raw source geometry
 * itself — and the arithmetic and the render disagreed (v25's ~262px gap
 * calculation predicted separated blades; the render showed a smooth
 * continuous annulus with none). This settles in one look whether the
 * blades are actually N separated lenses or whether the authored geometry
 * itself is not what the arithmetic assumes (e.g. self-overlapping or
 * enclosing area from an overly long `arcSpanDeg` — see the v26 top-of-file
 * history entry).
 */
const buildRawLookGraph = (): LookGraph => {
	const graph = normalizeLookGraph({
		nodes: [
			{ id: "source", kind: "source" },
			{ id: "output", kind: "output" },
		],
		edges: [edge("source", "output")],
		outputNodeId: "output",
	});
	if (!graph) {
		throw new Error("LIQUID GRADIENT raw-diagnostic Look graph is invalid.");
	}
	return graph;
};

// --- Scene assembly -------------------------------------------------------

const buildScene = (id: string, lookGraph: LookGraph): SceneDocument => ({
	schemaVersion: 1,
	id,
	name: "LIQUID GRADIENT",
	artboard: {
		id: ARTBOARD_ID,
		name: "LIQUID GRADIENT",
		width: ARTBOARD_WIDTH,
		height: ARTBOARD_HEIGHT,
		background: BLACK,
		fps: ARTBOARD_FPS,
		durationFrames: DURATION_FRAMES,
		cameraSpacePolicy: "screen_2d",
		effectIntent: { lookGraph },
	},
	layers: [
		{
			id: "liquid-gradient-layer",
			name: "Liquid Gradient",
			visible: true,
			locked: false,
			nodes: STARS.map((star) => starNode(star)),
		},
	],
});

// --- Motion: ring spins + keyframed look-node phase ramps ------------------

const ARTBOARD_OWNER: LookGraphOwnerRef = {
	scope: "artboard",
	artboardId: ARTBOARD_ID,
};

type RawKey = { readonly time: number; readonly value: number };

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

/** Applies exact linear easing (zero influence both sides) across a key chain. */
const withLinearEasing = (rawKeys: readonly RawKey[]): AeKeyframe<number>[] => {
	const keys: AeKeyframe<number>[] = rawKeys.map((key) => ({
		time: key.time,
		value: key.value,
	}));
	for (let i = 0; i < keys.length; i += 1) {
		const left = keys[i];
		const right = i + 1 < keys.length ? keys[i + 1] : undefined;
		const eased = withSegmentEasing(left, right, "linear");
		keys[i] = eased.left;
		if (right && eased.right) keys[i + 1] = eased.right;
	}
	return keys;
};

/**
 * A pure constant-velocity spin: two keys, start and the loop's last frame.
 * Same convention as {@link rampTrack}: frame `DURATION_FRAMES - 1` carries
 * `totalDegrees * (DURATION_FRAMES - 1) / DURATION_FRAMES` — one increment
 * short of the full `totalDegrees` — NOT `totalDegrees` itself. Putting the
 * full value at frame 359 makes 359 read identical to frame 0 (720 deg ≡ 0
 * deg) — a duplicate frame at the loop point — and drops the per-frame speed
 * to `totalDegrees / 359` instead of the intended `totalDegrees / 360`. With
 * the one-increment-short terminal key, the f359 -> f0 step is exactly one
 * uniform increment, matching how every other node in this file loops.
 */
const spinTrack = (nodeId: string, totalDegrees: number): KeyframeTrack => ({
	id: `${nodeId}-rotation`,
	target: { nodeId, property: "rotation" },
	keyframes: withLinearEasing([
		{ time: 0, value: 0 },
		{
			time: DURATION_FRAMES - 1,
			value: (totalDegrees * (DURATION_FRAMES - 1)) / DURATION_FRAMES,
		},
	]),
});

// One `spinTrack` per star, each spinning about its OWN centre (unlike the
// retired blade-ring model, there is no shared ring centre here — see the
// `STARS` reach-arithmetic comment for why two independently-centred,
// counter-rotating stars are the right model once `bend-warp` supplies the
// circular-sweep read instead of the geometry).
const tracks: KeyframeTrack[] = STARS.map((star) =>
	spinTrack(starNodeId(star), star.totalDegrees),
);

const KEYFRAME_STEP = 30;

/**
 * Monotonic look-node phase driver: samples every `KEYFRAME_STEP` frames from
 * t=0, plus an explicit terminal key at frame `DURATION_FRAMES - 1` carrying
 * `valueAt(DURATION_FRAMES - 1)`.
 *
 * SHARED CONVENTION — binding on every monotonic driver in this file (star
 * rotation via {@link spinTrack} and wave-warp phase via this helper alike):
 * `valueAt` must be shaped so that `valueAt(DURATION_FRAMES - 1)` equals
 * `total * (DURATION_FRAMES - 1) / DURATION_FRAMES` — one uniform increment
 * short of the full `total` — never anything else. Two failure modes have
 * each actually shipped in this file at different points:
 * 1. Terminal key = the FULL `total` (e.g. `2 * t / (DURATION_FRAMES - 1)`,
 *    which hits exactly `total` at `t = DURATION_FRAMES - 1`). This makes
 *    frame `DURATION_FRAMES - 1` read identical to frame 0 after the
 *    shader's `fract()`/mod-360 wrap (a whole `total` ≡ 0 either way) — a
 *    duplicate held frame at the loop point. This is what `wavePhaseAt` did
 *    before this comment was written: `2 * t / (DURATION_FRAMES - 1)` hit
 *    `2.0` turns exactly at `t = 359`, identical to frame 0's `0` turns.
 * 2. Terminal key = `valueAt(0)` (piece #1's cyclic-oscillator `lookTrack`
 *    convention, snapping the last key back to the first). For a one-way
 *    ramp like `wave-warp.phase` or star rotation, this reverses the
 *    entire ramp's travel in a single frame instead of closing it.
 * The one-increment-short terminal key avoids both: the loop closes with a
 * genuinely uniform per-frame step across the f(DURATION_FRAMES-1) -> f0
 * wrap, matching the shader's `fract(phase)` contract
 * (`docs/product-knowledge/colorama-wave-warp-look-nodes.md`) without either
 * a duplicate frame or a reversed one.
 *
 * Only used for `wave-warp.phase` now — `colorama.phase` must stay static
 * under `inputPhase: "alpha"` (see the TRAP comment on that payload in
 * `buildLookGraph`), so it is never driven through this helper.
 */
const rampTrack = (
	lookNodeId: string,
	paramKey: string,
	valueAt: (t: number) => number,
): LookNodeParamTrack => {
	const raw: RawKey[] = [];
	for (let t = 0; t < DURATION_FRAMES - 1; t += KEYFRAME_STEP) {
		raw.push({ time: t, value: round3(valueAt(t)) });
	}
	raw.push({
		time: DURATION_FRAMES - 1,
		value: round3(valueAt(DURATION_FRAMES - 1)),
	});
	return {
		id: `look-${lookNodeId}-${paramKey}`,
		target: { owner: ARTBOARD_OWNER, lookNodeId, paramKey },
		keyframes: withLinearEasing(raw),
	};
};

/** Total wave-warp phase travel across the clip, in turns. */
const WAVE_PHASE_TURNS = 2;

const wavePhaseAt = (t: number): number =>
	(WAVE_PHASE_TURNS * t) / DURATION_FRAMES;

const lookNodeTracks: LookNodeParamTrack[] = [
	rampTrack("wave-warp", "phase", wavePhaseAt),
];

const totalKeyframeCount =
	tracks.reduce((sum, track) => sum + track.keyframes.length, 0) +
	lookNodeTracks.reduce((sum, track) => sum + track.keyframes.length, 0);

// Motion is identical across all three export variants (vivid/brand/field) —
// only the look graph's node set and the colorama stops differ between
// scenes. `wave-warp` exists in all three variants' graphs (including the
// diagnostic `field` graph), so this track always has a matching target.
const motion: MotionDocument = {
	schemaVersion: 1,
	fps: ARTBOARD_FPS,
	durationFrames: DURATION_FRAMES,
	clips: [],
	tracks,
	lookNodeTracks,
};

// --- Per-variant export ------------------------------------------------

type ExportVariant = {
	readonly key: "vivid" | "brand" | "field" | "raw";
	readonly label: string;
	readonly fileStem: string;
	readonly lookGraph: LookGraph;
};

// The hand-written "(xN repetitions)" suffix has gone stale three times now
// (v17 said x3 when it meant x3, then the label was never updated for v18's
// x2, and would have been wrong a third time for v19's x1 had this stayed
// hand-written). Deriving it from `COLORAMA_REPETITIONS` instead means it
// cannot drift out of sync with the actual payload again.
const repetitionsLabel = (repetitions: number): string =>
	`x${repetitions} repetition${repetitions === 1 ? "" : "s"}`;

const VARIANTS: readonly ExportVariant[] = [
	{
		key: "vivid",
		label: `Vivid — navy / electric blue / bright blue / violet / magenta / pink / cream / near-white / navy (${repetitionsLabel(COLORAMA_REPETITIONS)})`,
		fileStem: `${SLUG}-vivid`,
		lookGraph: buildLookGraph(VIVID_COLORAMA_STOPS),
	},
	{
		key: "brand",
		label: `Brand — deep green / mid green / yellow-green / acid / pale acid / cream / near-white / deep green (${repetitionsLabel(COLORAMA_REPETITIONS)})`,
		fileStem: `${SLUG}-brand`,
		lookGraph: buildLookGraph(BRAND_COLORAMA_STOPS),
	},
	{
		key: "field",
		label: "Field — pre-colorama blur/wave-warp output",
		fileStem: `${SLUG}-field`,
		lookGraph: buildFieldLookGraph(),
	},
	{
		key: "raw",
		label: "Raw — source geometry only",
		fileStem: `${SLUG}-raw`,
		lookGraph: buildRawLookGraph(),
	},
];

// Delivery profile: the gallery contract ships self-contained artifact code,
// not an editable/pretty bundle ("editable" was a 623KB/184KB-gz dev default).
const optimization = exportOptimizationOptionsForProfile("motion-artifact");

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });

const written: { fileName: string; byteLength: number }[] = [];

/** Same full-bleed, timer-fallback QA page as before, one per palette variant. */
const writeQaPage = (fileStem: string): void => {
	const qaPage = [
		"<!doctype html>",
		'<html lang="en">',
		"  <head>",
		'    <meta charset="utf-8" />',
		'    <meta name="viewport" content="width=device-width, initial-scale=1" />',
		"    <title>LIQUID GRADIENT QA</title>",
		"    <style>",
		`      html, body { margin: 0; width: 100%; min-height: 100%; background: ${BLACK}; }`,
		"      body { min-height: 100vh; display: grid; place-items: center; overflow: hidden; }",
		`      #player { width: 100vw; aspect-ratio: ${ARTBOARD_WIDTH} / ${ARTBOARD_HEIGHT}; overflow: hidden; }`,
		`      @media (min-aspect-ratio: ${ARTBOARD_WIDTH}/${ARTBOARD_HEIGHT}) { #player { width: auto; height: 100vh; } }`,
		"      #player > canvas { display: block; width: 100%; height: auto; }",
		"    </style>",
		"  </head>",
		"  <body>",
		'    <div id="player" aria-label="LIQUID GRADIENT QA player"></div>',
		'    <script type="module">',
		`      import { mountVectorMotionWebglPlayer } from "./${fileStem}.webgl-player.js";`,
		'      const container = document.getElementById("player");',
		"      const player = await mountVectorMotionWebglPlayer(container, { autoplay: true, loop: true });",
		"      window.player = player;",
		"      window.qaReady = true;",
		"      // Some embedded review panes suppress requestAnimationFrame entirely,",
		"      // freezing the player's own clock. Detect a dead rAF and fall back to",
		"      // a timer-driven seek loop so the motion stays reviewable there.",
		"      let rafFired = false;",
		"      requestAnimationFrame(() => { rafFired = true; });",
		"      setTimeout(() => {",
		"        if (rafFired) return;",
		"        player.pause();",
		"        let frame = player.frame;",
		"        window.qaTimerFallback = setInterval(() => {",
		"          if (window.qaHoldSeek) return;",
		"          frame = (frame + 1) % player.durationFrames;",
		"          void player.seekFrame(frame);",
		"        }, 1000 / 30);",
		"      }, 400);",
		"    </script>",
		"  </body>",
		"</html>",
		"",
	].join("\n");
	const filePath = path.join(outputDirectory, `${fileStem}.qa.html`);
	writeFileSync(filePath, qaPage);
	written.push({
		fileName: `${fileStem}.qa.html`,
		byteLength: Buffer.byteLength(qaPage, "utf8"),
	});
};

for (const variant of VARIANTS) {
	const scene = buildScene(`${SLUG}-${variant.key}`, variant.lookGraph);
	// v26: the `raw` variant is `source -> output` ONLY (no blur/wave-warp/
	// colorama/deep-glow) by design — it exists to show the authored geometry
	// with zero GPU raster processing — so it must NOT select a GPU surface.
	// Every other variant exists specifically to exercise the GPU raster path,
	// so the assertion inverts for it: `raw` asserts the ABSENCE of a GPU
	// surface, everything else still asserts its PRESENCE.
	const needsGpuSurface = sceneNeedsGpuSurface(scene);
	if (variant.key === "raw" ? needsGpuSurface : !needsGpuSurface) {
		throw new Error(
			variant.key === "raw"
				? `LIQUID GRADIENT "raw" scene unexpectedly selected a GPU surface — it should be pure source geometry.`
				: `LIQUID GRADIENT "${variant.key}" scene did not select a GPU surface.`,
		);
	}
	const bundle = createExportBundle({
		scene,
		motion,
		currentFrame: 0,
		artboardScope: "current",
	});
	const assets = createWebglPlayerExportAssets(bundle, [], {
		optimization,
		fileStem: variant.fileStem,
		scene,
	});
	for (const asset of assets) {
		if (!("contents" in asset)) continue;
		const filePath = path.join(outputDirectory, asset.fileName);
		writeFileSync(filePath, asset.contents);
		written.push({
			fileName: asset.fileName,
			byteLength: Buffer.byteLength(asset.contents, "utf8"),
		});
	}
	writeQaPage(variant.fileStem);
}

// --- compare.html: all four variants side by side, autoplay off, frame 0 --
// The static frame the user reviews before any motion — same FNV-1a
// canvas-hash shape as scripts/generate-look-node-probe.ts's probe.html, so
// the palettes (and the diagnostic field/raw panels) can be compared
// numerically as well as visually. `compareLuma()` reads RGB-based Rec.709
// luminance off the field panel — valid ONLY on `vivid`/`brand` (see its own
// in-file comment for the v29 straight-alpha trap); `compareAlpha()` reads
// the alpha channel directly and is the correct tool for `field`/`raw`.

const compareHtml = [
	"<!doctype html>",
	'<html lang="en">',
	"  <head>",
	'    <meta charset="utf-8" />',
	'    <meta name="viewport" content="width=device-width, initial-scale=1" />',
	"    <title>LIQUID GRADIENT palette compare</title>",
	"    <style>",
	`      html, body { margin: 0; background: ${BLACK}; color: #eee; font: 12px/1.4 monospace; }`,
	"      body { padding: 16px; }",
	"      .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; max-width: 2100px; }",
	"      .cell { background: #000; border: 1px solid #333; }",
	"      .cell h2 { margin: 0; padding: 6px 10px; font-size: 12px; font-weight: normal; color: #9cf; border-bottom: 1px solid #333; }",
	`      .canvas-wrap { width: 100%; aspect-ratio: ${ARTBOARD_WIDTH} / ${ARTBOARD_HEIGHT}; overflow: hidden; }`,
	"      .canvas-wrap canvas { display: block; width: 100%; height: 100%; }",
	"      #status { margin-top: 12px; white-space: pre-wrap; }",
	"    </style>",
	"  </head>",
	"  <body>",
	'    <div class="grid">',
	'      <section class="cell" data-variant="vivid">',
	`        <h2>${VARIANTS[0].label}</h2>`,
	'        <div class="canvas-wrap" id="wrap-vivid"></div>',
	"      </section>",
	'      <section class="cell" data-variant="brand">',
	`        <h2>${VARIANTS[1].label}</h2>`,
	'        <div class="canvas-wrap" id="wrap-brand"></div>',
	"      </section>",
	'      <section class="cell" data-variant="field">',
	`        <h2>${VARIANTS[2].label}</h2>`,
	'        <div class="canvas-wrap" id="wrap-field"></div>',
	"      </section>",
	'      <section class="cell" data-variant="raw">',
	`        <h2>${VARIANTS[3].label}</h2>`,
	'        <div class="canvas-wrap" id="wrap-raw"></div>',
	"      </section>",
	"    </div>",
	'    <div id="status">loading…</div>',
	'    <script type="module">',
	`      import { mountVectorMotionWebglPlayer as mountVivid } from "./${VARIANTS[0].fileStem}.webgl-player.js";`,
	`      import { mountVectorMotionWebglPlayer as mountBrand } from "./${VARIANTS[1].fileStem}.webgl-player.js";`,
	`      import { mountVectorMotionWebglPlayer as mountField } from "./${VARIANTS[2].fileStem}.webgl-player.js";`,
	`      import { mountVectorMotionWebglPlayer as mountRaw } from "./${VARIANTS[3].fileStem}.webgl-player.js";`,
	"",
	"      const mountOptions = { autoplay: false, loop: false };",
	"      const [vivid, brand, field, raw] = await Promise.all([",
	'        mountVivid(document.getElementById("wrap-vivid"), mountOptions),',
	'        mountBrand(document.getElementById("wrap-brand"), mountOptions),',
	'        mountField(document.getElementById("wrap-field"), mountOptions),',
	'        mountRaw(document.getElementById("wrap-raw"), mountOptions),',
	"      ]);",
	"",
	"      const players = { vivid, brand, field, raw };",
	"      window.comparePlayers = players;",
	"",
	"      // Reads back the player's WebGL canvas via a 2-D canvas drawImage and",
	"      // returns the RGBA Uint8ClampedArray plus its pixel count. Shared by",
	"      // the FNV-1a hash and the field-panel luminance stats below.",
	"      function readPixels(key) {",
	'        const wrap = document.getElementById("wrap-" + key);',
	'        const source = wrap && wrap.querySelector("canvas");',
	"        if (!source || source.width === 0 || source.height === 0) return null;",
	'        const readback = document.createElement("canvas");',
	"        readback.width = source.width;",
	"        readback.height = source.height;",
	'        const ctx = readback.getContext("2d");',
	"        ctx.drawImage(source, 0, 0);",
	"        return ctx.getImageData(0, 0, readback.width, readback.height).data;",
	"      }",
	"",
	"      // Cheap deterministic hash: FNV-1a over the RGBA bytes — same shape as",
	"      // scripts/generate-look-node-probe.ts's probeHash, so variants compare",
	"      // numerically instead of by eye.",
	"      function fnv1a(bytes) {",
	"        let hash = 0x811c9dc5;",
	"        for (let i = 0; i < bytes.length; i += 1) {",
	"          hash ^= bytes[i];",
	"          hash = Math.imul(hash, 0x01000193);",
	"        }",
	'        return (hash >>> 0).toString(16).padStart(8, "0");',
	"      }",
	"",
	"      function hashPlayer(key) {",
	"        const data = readPixels(key);",
	"        return data ? fnv1a(data) : null;",
	"      }",
	"",
	"      window.compareHash = function compareHash() {",
	"        return {",
	'          vivid: hashPlayer("vivid"),',
	'          brand: hashPlayer("brand"),',
	'          field: hashPlayer("field"),',
	'          raw: hashPlayer("raw"),',
	"        };",
	"      };",
	"",
	"      function round4(value) {",
	"        return Math.round(value * 10000) / 10000;",
	"      }",
	"",
	"      // v29 TRAP, do not re-learn this the hard way: `compareLuma()` is RGB-",
	"      // based (Rec.709 luminance from data[i*4..i*4+2]) and NEVER reads alpha",
	"      // (data[i*4+3]). `getImageData` returns STRAIGHT (un-premultiplied)",
	"      // alpha — dividing a blurred edge's premultiplied RGB by its own",
	"      // (also blurred) alpha exactly cancels the fade back out. For a",
	"      // UNIFORM-COLOR fill (the `field`/`raw` panels' solid-white blades),",
	"      // straight RGB stays ~(255,255,255) everywhere alpha > 0 and drops to 0",
	"      // only exactly where alpha == 0 — a hard binary step in RGB no matter",
	"      // how smoothly alpha itself is blurred. `compareLuma()` is therefore",
	'      // ONLY valid on `vivid`/`brand` (colorama\'s `inputPhase:"alpha"` makes',
	"      // RGB alpha-DEPENDENT there) — NEVER on `field`/`raw`, whose gradient",
	"      // lives entirely in alpha and is invisible to RGB luminance. Use",
	"      // `compareAlpha()` below for `field`/`raw`. This distinction cost a",
	"      // full engine-level investigation (v29) before the measurement, not a",
	"      // rendering bug, was found to be the cause of an apparently-binary read.",
	"      window.compareLuma = function compareLuma() {",
	'        const data = readPixels("field");',
	"        if (!data) return null;",
	"        const count = data.length / 4;",
	"        const luma = new Float32Array(count);",
	"        let sum = 0;",
	"        let min = Infinity;",
	"        let max = -Infinity;",
	"        for (let i = 0; i < count; i += 1) {",
	"          const r = data[i * 4] / 255;",
	"          const g = data[i * 4 + 1] / 255;",
	"          const b = data[i * 4 + 2] / 255;",
	"          const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;",
	"          luma[i] = y;",
	"          sum += y;",
	"          if (y < min) min = y;",
	"          if (y > max) max = y;",
	"        }",
	"        luma.sort();",
	"        const percentile = (p) => {",
	"          const index = Math.min(",
	"            luma.length - 1,",
	"            Math.max(0, Math.round(p * (luma.length - 1))),",
	"          );",
	"          return luma[index];",
	"        };",
	"        return {",
	"          min: round4(min),",
	"          max: round4(max),",
	"          mean: round4(sum / count),",
	"          p05: round4(percentile(0.05)),",
	"          p50: round4(percentile(0.5)),",
	"          p95: round4(percentile(0.95)),",
	"        };",
	"      };",
	"",
	"      // v29: the alpha-channel counterpart to `compareLuma()`, reading",
	"      // data[i*4+3] directly — the ONLY correct way to measure blur/warp",
	"      // gradient quality on `field`/`raw`, whose uniform-color fills hide",
	"      // that gradient from RGB (see the TRAP comment on `compareLuma()`",
	"      // above). Also valid on `vivid`/`brand` (alpha exists there too), but",
	"      // has nothing extra to say once colorama has recolored by alpha —",
	"      // `compareLuma()` is the more informative read post-colorama. Pass the",
	'      // panel key explicitly; defaults to "field" since that is what every',
	"      // round's saturation/band-width tuning has targeted. Saturated/dark",
	"      // thresholds (0.96 / 0.04) match the 4%/96% convention already used",
	"      // throughout this file's investigation comments.",
	"      window.compareAlpha = function compareAlpha(key) {",
	'        const data = readPixels(key || "field");',
	"        if (!data) return null;",
	"        const count = data.length / 4;",
	"        const alpha = new Float32Array(count);",
	"        let saturated = 0;",
	"        let dark = 0;",
	"        for (let i = 0; i < count; i += 1) {",
	"          const a = data[i * 4 + 3] / 255;",
	"          alpha[i] = a;",
	"          if (a > 0.96) saturated += 1;",
	"          else if (a < 0.04) dark += 1;",
	"        }",
	"        alpha.sort();",
	"        const percentile = (p) => {",
	"          const index = Math.min(",
	"            alpha.length - 1,",
	"            Math.max(0, Math.round(p * (alpha.length - 1))),",
	"          );",
	"          return alpha[index];",
	"        };",
	"        const gradient = count - saturated - dark;",
	"        return {",
	"          max: round4(alpha[alpha.length - 1]),",
	"          p99: round4(percentile(0.99)),",
	"          p95: round4(percentile(0.95)),",
	"          p50: round4(percentile(0.5)),",
	"          pctSaturated: round4((saturated / count) * 100),",
	"          pctGradient: round4((gradient / count) * 100),",
	"          pctDark: round4((dark / count) * 100),",
	"        };",
	"      };",
	"",
	"      window.compareSeek = function compareSeek(frame) {",
	"        return Promise.all([",
	"          vivid.seekFrame(frame),",
	"          brand.seekFrame(frame),",
	"          field.seekFrame(frame),",
	"          raw.seekFrame(frame),",
	"        ]);",
	"      };",
	"",
	"      window.compareReady = window.compareSeek(0).then(() => {",
	'        document.getElementById("status").textContent =',
	'          "ready — frame 0. window.compareSeek(frame) / window.compareHash() / window.compareLuma() / window.compareAlpha(key)";',
	"        return true;",
	"      });",
	"    </script>",
	"  </body>",
	"</html>",
	"",
].join("\n");

writeFileSync(path.join(outputDirectory, "compare.html"), compareHtml);
written.push({
	fileName: "compare.html",
	byteLength: Buffer.byteLength(compareHtml, "utf8"),
});

console.log(`Generated ${path.relative(process.cwd(), outputDirectory)}.`);
for (const file of written) {
	console.log(`  ${file.fileName} — ${file.byteLength} bytes`);
}
console.log(
	`Total keyframes across ${tracks.length + lookNodeTracks.length} tracks: ${totalKeyframeCount}`,
);
