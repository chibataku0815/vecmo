import type {
	MotionGrammarCatalogEntry,
	MotionGrammarParamSpec,
	MotionGrammarTechniqueId,
} from "./types";

/**
 * Technique catalog. It records all 18 glammer-derived technique ids as the
 * contract surface. Entries can be implemented for parsing/evaluation before
 * their production authoring profile is ready for the editor UI.
 */

/** Default master period (frames) for one stagger cycle — lab time-delay ≈ 90f. */
export const TIME_DELAY_PERIOD_DEFAULT = 90;
/** Default per-target stagger (frames) between successive wavefront members. */
export const TIME_DELAY_STAGGER_DEFAULT = 4;
/** Range Selector window start (percent) — 0 = the wavefront begins at the first target. */
export const WAVEFRONT_RANGE_START_DEFAULT = 0;
/** Range Selector window end (percent) — 100 = the wavefront ends at the last target. */
export const WAVEFRONT_RANGE_END_DEFAULT = 100;
/** Range Selector shape index — 0 = linear (the identity wavefront); see WAVEFRONT_SHAPES. */
export const WAVEFRONT_RANGE_SHAPE_DEFAULT = 0;
/** Default opacity falloff between consecutive temporal afterimage echoes. */
export const PERIODIC_AFTERIMAGE_DECAY_DEFAULT = 0.62;
/** Default frame spacing between temporal afterimage echoes. */
export const PERIODIC_AFTERIMAGE_DELAY_DEFAULT = 5;
/** Default number of temporal afterimage echoes in the pure echo plan. */
export const PERIODIC_AFTERIMAGE_COPIES_DEFAULT = 3;
/** Default orbit radius for cyclic path travel, in scene units. */
export const CYCLIC_PATH_RADIUS_DEFAULT = 32;
/** Default phase spacing between targets traveling the same cyclic path. */
export const CYCLIC_PATH_PHASE_STEP_DEFAULT = 45;
/** Default global phase offset for cyclic path progress, in degrees. */
export const CYCLIC_PATH_PHASE_OFFSET_DEFAULT = 0;
/** Default frame at which the closed-lap phrase begins. */
export const CYCLIC_PATH_PHASE_START_FRAME_DEFAULT = 0;
/** Default direct whip budget before the derived crawl remainder. */
export const CYCLIC_PATH_WHIP_DURATION_DEFAULT = 18;
/** Default fraction of one lap consumed by the direct whip span. */
export const CYCLIC_PATH_WHIP_SPAN_FRACTION_DEFAULT = 0.35;
/** Default normal offset from a sampled path point, in scene units. */
export const CYCLIC_PATH_OFFSET_DEFAULT = 0;
/** Default tangent orientation mode: 0 keeps authored rotation, 1 follows tangent. */
export const CYCLIC_PATH_ORIENT_TO_TANGENT_DEFAULT = 0;
/** Default additive rotation after tangent orientation, in degrees. */
export const CYCLIC_PATH_ORIENTATION_OFFSET_DEFAULT = 0;
/** Fraction of a closed path occupied by the moving Cycle stroke window. */
export const CYCLIC_PATH_WINDOW_FRACTION_DEFAULT = 0.18;
/** Head-dot lead along the Cycle path, expressed as a lap fraction. */
export const CYCLIC_PATH_HEAD_LAG_FRACTION_DEFAULT = 0.04;
/** Default random pulse period (frames) before the deterministic fire order repeats. */
export const RANDOM_PULSE_PERIOD_DEFAULT = 72;
/** Default frame gap between targets in the deterministic random pulse order. */
export const RANDOM_PULSE_CADENCE_DEFAULT = 2;
/** Default visible pulse width for one random-field target. */
export const RANDOM_PULSE_WIDTH_DEFAULT = 18;
/** Default opacity floor for one random-field target. */
export const RANDOM_PULSE_OPACITY_FLOOR_DEFAULT = 0.45;
/** Default period (frames) for one two-source interference cycle. */
export const RING_WAVE_PERIOD_DEFAULT = 96;
/** Default radial distance (px) between interference wave crests. */
export const RING_WAVE_WAVELENGTH_DEFAULT = 72;
/** Default scale lift applied at an interference crest. */
export const RING_WAVE_SCALE_AMPLITUDE_DEFAULT = 0.16;
/** Default opacity floor applied at an interference trough. */
export const RING_WAVE_OPACITY_FLOOR_DEFAULT = 0.55;
/** Default ring centre X coordinate for the orbit/dodge relation. */
export const RING_WAVE_CENTER_X_DEFAULT = 320;
/** Default ring centre Y coordinate for the orbit/dodge relation. */
export const RING_WAVE_CENTER_Y_DEFAULT = 180;
/** Default base ring radius before pulse/proximity response. */
export const RING_WAVE_RING_RADIUS_DEFAULT = 110;
/** Default radial pulse amplitude in scene pixels. */
export const RING_WAVE_PULSE_RADIUS_DEFAULT = 14;
/** Default orbit radius of the passing driver. */
export const RING_WAVE_DRIVER_ORBIT_RADIUS_DEFAULT = 48;
/** Default follower phase step in degrees. */
export const RING_WAVE_PHASE_STEP_DEGREES_DEFAULT = 28;
/** Default radial dodge strength. */
export const RING_WAVE_RADIAL_PUSH_DEFAULT = 30;
/** Default tangential dodge strength. */
export const RING_WAVE_TANGENTIAL_SLIDE_DEFAULT = 16;
/** Default proximity falloff distance. */
export const RING_WAVE_FALLOFF_DISTANCE_DEFAULT = 150;
/** Default proximity falloff exponent. */
export const RING_WAVE_FALLOFF_EXPONENT_DEFAULT = 2;
/** Default minimum distance used to avoid a singular dodge response. */
export const RING_WAVE_MIN_DISTANCE_DEFAULT = 12;
/** Default period (frames) for a layout-to-ring arrangement cycle. */
export const ARRANGEMENT_TRANSITION_PERIOD_DEFAULT = 120;
/** Default radius (px) used by the arrangement transition target ring. */
export const ARRANGEMENT_TRANSITION_RADIUS_DEFAULT = 48;
/** Default scale lift applied while the arrangement transition is fully displaced. */
export const ARRANGEMENT_TRANSITION_SCALE_AMPLITUDE_DEFAULT = 0.08;
/** Native Arrangement gather phase fraction. */
export const ARRANGEMENT_GATHER_FRACTION_DEFAULT = 0.28;
/** Native Arrangement stage-hold phase fraction. */
export const ARRANGEMENT_HOLD_FRACTION_DEFAULT = 0.12;
/** Native Arrangement shared turn, in degrees around the authored pivot. */
export const ARRANGEMENT_SHARED_TURN_DEGREES_DEFAULT = 180;
/** Native Arrangement source-to-pivot gather lobe depth. */
export const ARRANGEMENT_LOBE_DEPTH_DEFAULT = 0.72;
/** Default period (frames) for one merge/split cycle. */
export const MERGE_SPLIT_PERIOD_DEFAULT = 96;
/** Default fraction of each node-to-centroid vector consumed at full merge. */
export const MERGE_SPLIT_STRENGTH_DEFAULT = 1;
/** Default scale factor applied at full merge. */
export const MERGE_SPLIT_SCALE_FLOOR_DEFAULT = 0.6;
/** Default opacity factor applied at full merge. */
export const MERGE_SPLIT_OPACITY_FLOOR_DEFAULT = 0.7;
/** Fraction of the loop spent gathering members into the core. */
export const MERGE_SPLIT_GATHER_FRACTION_DEFAULT = 0.26;
/** Fraction of the loop spent holding the absorbed mass. */
export const MERGE_SPLIT_HOLD_FRACTION_DEFAULT = 0.2;
/** Fraction of the loop spent returning members to their rotating seats. */
export const MERGE_SPLIT_RETURN_FRACTION_DEFAULT = 0.42;
/** Frame stagger between each member's gather/return clip. */
export const MERGE_SPLIT_STAGGER_FRAMES_DEFAULT = 6;
/** Full-ring seat rotation over one master period, in degrees. */
export const MERGE_SPLIT_RING_TURN_DEGREES_DEFAULT = 180;
/** Return overshoot coefficient around the authored seat. */
export const MERGE_SPLIT_RETURN_OVERSHOOT_DEFAULT = 0.08;
/** Maximum relative area gain of the derived core at full absorption. */
export const MERGE_SPLIT_CORE_SCALE_GAIN_DEFAULT = 0.9;
/** Default period (frames) for one count-growth reveal cycle. */
export const COUNT_GROWTH_PERIOD_DEFAULT = 120;
/** Default duration (frames) for one target's grow-in ramp. */
export const COUNT_GROWTH_GROW_FRAMES_DEFAULT = 12;
/** Default scale factor before a count-growth target is revealed. */
export const COUNT_GROWTH_SCALE_FLOOR_DEFAULT = 0.25;
/** Default opacity factor before a count-growth target is revealed. */
export const COUNT_GROWTH_OPACITY_FLOOR_DEFAULT = 0.05;
/** Fraction of one count-growth period used to open the master lattice breath. */
export const COUNT_GROWTH_BREATH_OPEN_FRACTION_DEFAULT = 0.28;
/** Fraction of one count-growth period held at the open lattice state. */
export const COUNT_GROWTH_BREATH_HOLD_FRACTION_DEFAULT = 0.24;
/** Radial expansion multiplier at the open lattice state. */
export const COUNT_GROWTH_BREATH_RADIUS_SCALE_DEFAULT = 1.2;
/** Artboard-local X offset for the derived lattice centre. */
export const COUNT_GROWTH_CENTER_OFFSET_X_DEFAULT = 0;
/** Artboard-local Y offset for the derived lattice centre. */
export const COUNT_GROWTH_CENTER_OFFSET_Y_DEFAULT = 0;
/** Shared rotation in degrees applied during the master lattice breath. */
export const COUNT_GROWTH_ROTATION_DEGREES_DEFAULT = 180;
/** Edge-role rail amplitude in artboard-local units. */
export const COUNT_GROWTH_EDGE_RAIL_AMPLITUDE_DEFAULT = 18;
/** Frame stagger between group-local entrance envelopes. */
export const COUNT_GROWTH_GROUP_STAGGER_FRAMES_DEFAULT = 4;
/** Default delay used by followers when sampling a leader's previous pose. */
export const FOLLOW_THROUGH_DELAY_DEFAULT = 6;
/** Default loop period for the derivative-aware follow-through expression. */
export const FOLLOW_THROUGH_PERIOD_DEFAULT = 120;
/** Default follower response amount applied to the delayed lead delta. */
export const FOLLOW_THROUGH_RESPONSE_DEFAULT = 0.35;
/** Default settle horizon used by velocity-seeded follow-through. */
export const FOLLOW_THROUGH_SETTLE_FRAMES_DEFAULT = 36;
/** Default decay rate for the velocity-seeded residual. */
export const FOLLOW_THROUGH_DECAY_DEFAULT = 0.12;
/** Default finite-difference lookback used to derive exit velocity. */
export const FOLLOW_THROUGH_VELOCITY_LOOKBACK_DEFAULT = 2;
/** Default rotation response per velocity unit. */
export const FOLLOW_THROUGH_ROTATION_RESPONSE_DEFAULT = 0.08;
/** Default tangent look-ahead used by the auto-orient sampler. */
export const AUTO_ORIENT_LOOKAHEAD_DEFAULT = 1;
/** Default cycle length for the 2D-projected tumble sampler. */
export const PLANAR_TUMBLE_PERIOD_DEFAULT = 60;
/** Default per-target phase offset for ordered tumble cascades. */
export const PLANAR_TUMBLE_PHASE_STAGGER_DEFAULT = 4;
/** Default side-on projected width floor for tumble, never true 3D depth. */
export const PLANAR_TUMBLE_MIN_PROJECTION_DEFAULT = 0.22;
/** Default additive rotation used to sell the projected tumble in 2D. */
export const PLANAR_TUMBLE_TILT_DEFAULT = 16;
/** Default cycle length for the lateral shear-split approximation. */
export const SHEAR_SPLIT_PERIOD_DEFAULT = 48;
/** Default maximum lateral split distance in scene pixels. */
export const SHEAR_SPLIT_DISTANCE_DEFAULT = 28;
/** Default counter-rotation used while split members separate. */
export const SHEAR_SPLIT_ROTATION_DEFAULT = 8;
/** Default look-ahead for sampling target velocity in parallax. */
export const SIZE_SPEED_PARALLAX_LOOKAHEAD_DEFAULT = 2;
/** Default multiplier from sampled velocity to additive parallax offset. */
export const SIZE_SPEED_PARALLAX_OFFSET_DEFAULT = 0.35;
/** Default scale boost applied per pixel/frame of sampled speed. */
export const SIZE_SPEED_PARALLAX_SCALE_DEFAULT = 0.015;
/** Default cap for speed-driven scale boost. */
export const SIZE_SPEED_PARALLAX_MAX_SCALE_DEFAULT = 0.45;
/** Shared-wave period for the reusable screen-space Parallax expression. */
export const PARALLAX_PERIOD_DEFAULT = 96;
/** Fraction of the period used for the downward part of the common wave. */
export const PARALLAX_DESCENT_FRACTION_DEFAULT = 0.46;
/** Screen-space direction of the common wave, in degrees. */
export const PARALLAX_AXIS_DEGREES_DEFAULT = 90;
/** Near-role amplitude in screen pixels. */
export const PARALLAX_NEAR_AMPLITUDE_DEFAULT = 34;
/** Mid-role amplitude in screen pixels. */
export const PARALLAX_MID_AMPLITUDE_DEFAULT = 22;
/** Far-role amplitude in screen pixels. */
export const PARALLAX_FAR_AMPLITUDE_DEFAULT = 12;
/** Frame phase offset shared by every depth role. */
export const PARALLAX_PHASE_OFFSET_FRAMES_DEFAULT = 0;
/** Default strength for mirrored inverse scale response. */
export const MIRROR_SYMMETRIC_SCALE_STRENGTH_DEFAULT = 1;
/** Default shared-pulse period for the reusable Symmetry expression. */
export const SYMMETRY_PULSE_PERIOD_DEFAULT = 120;
/** Default rise duration for the reusable Symmetry expression. */
export const SYMMETRY_PULSE_RISE_FRAMES_DEFAULT = 28;
/** Default held peak duration for the reusable Symmetry expression. */
export const SYMMETRY_PULSE_HOLD_FRAMES_DEFAULT = 24;
/** Default outer-pair translation coefficient in scene pixels. */
export const SYMMETRY_OUTER_TRANSLATION_DEFAULT = 36;
/** Default inner-pair translation coefficient in scene pixels. */
export const SYMMETRY_INNER_TRANSLATION_DEFAULT = 18;
/** Default scale coefficient for outer roles. */
export const SYMMETRY_OUTER_SCALE_DEFAULT = 0.18;
/** Default scale coefficient for inner roles. */
export const SYMMETRY_INNER_SCALE_DEFAULT = 0.1;
/** Default center scale coefficient. */
export const SYMMETRY_CENTER_SCALE_DEFAULT = 0.12;
/** Default center rotation coefficient in degrees. */
export const SYMMETRY_CENTER_ROTATION_DEFAULT = 18;
/** Default strength for relation-vector rotation response. */
export const BOOLEAN_DIFFERENCE_ROTATION_STRENGTH_DEFAULT = 1;
/** Default strength for inverse driver/follower scale proportion. */
export const INVERSE_PROPORTION_STRENGTH_DEFAULT = 1;
/** Inverse Proportion mode: legacy reciprocal scale (0) or tangent-anchor relation (1). */
export const INVERSE_PROPORTION_MODE_DEFAULT = 0;
/** Default tangent-anchor X coordinate in artboard-local units. */
export const INVERSE_PROPORTION_ANCHOR_X_DEFAULT = 0;
/** Default tangent-anchor Y coordinate in artboard-local units. */
export const INVERSE_PROPORTION_ANCHOR_Y_DEFAULT = 0;
/** Default relation axis X component. */
export const INVERSE_PROPORTION_AXIS_X_DEFAULT = 1;
/** Default relation axis Y component. */
export const INVERSE_PROPORTION_AXIS_Y_DEFAULT = 0;
/** Default total of driver and follower radii, excluding clearance. */
export const INVERSE_PROPORTION_RADIUS_SUM_DEFAULT = 128;
/** Default visible gap between the two tangent circles. */
export const INVERSE_PROPORTION_CLEARANCE_DEFAULT = 0;
/** Default response amount for ordered neighbor displacement. */
export const REACTIVE_NEIGHBOR_RESPONSE_DEFAULT = 0.5;
/** Default sweep length (frames) for one noise-wipe reveal/dissolve. */
export const NOISE_WIPE_DURATION_FRAMES_DEFAULT = 36;
/** Default wipe direction in degrees (0 = →, clockwise in screen space). */
export const NOISE_WIPE_ANGLE_DEFAULT = 0;
/** Default normalized transition-band width along the wipe field. */
export const NOISE_WIPE_SOFTNESS_DEFAULT = 0.35;
/** Default noise-perturbation blend atop the directional ramp (0 = clean wipe). */
export const NOISE_WIPE_NOISE_WEIGHT_DEFAULT = 0.4;
/** Default reveal direction: 0 = reveal-in, 1 = dissolve-out. */
export const NOISE_WIPE_MODE_DEFAULT = 0;

// Collision Bounce — see `docs/knowledge/bounce-canonical-representation.md`
// for the parameter schema tables these defaults/ranges/enum options encode
// verbatim, and `ballistic-bounce.ts` for the enum value consts
// (`AUTHORING_MODE_*`, `SUPPORT_MODE_*`, `STRETCH_VELOCITY_LINK_*`,
// `SUPPORT_PIN_MODE_*`, `FRONT_SPEED_SHAPE_*`, `SETTLE_BUDGET_MODE_*`) shared
// with the sampler.
/** `authoringMode` default: 0 = duration-first (designer). */
export const COLLISION_BOUNCE_AUTHORING_MODE_DEFAULT = 0;
/** Default target total duration (frames) for duration-first mode. */
export const COLLISION_BOUNCE_TOTAL_DURATION_FRAMES_DEFAULT = 120;
/** Default bounce count (N) for duration-first mode. */
export const COLLISION_BOUNCE_BOUNCES_DEFAULT = 3;
/** Default restitution (e); physical `e<=1`, no super-elastic default. */
export const COLLISION_BOUNCE_BOUNCINESS_DEFAULT = 0.6;
/** Default per-contact hold (frames); 0 = no dwell beyond the pinned instant. */
export const COLLISION_BOUNCE_CONTACT_HOLD_FRAMES_DEFAULT = 0;
/** Default collision-normal axis, degrees. */
export const COLLISION_BOUNCE_TRAVEL_AXIS_DEGREES_DEFAULT = 90;
/** `supportMode` default: 0 = floor-line (works with zero roles). */
export const COLLISION_BOUNCE_SUPPORT_MODE_DEFAULT = 0;
/** Default floor-line boundary position along the travel axis. */
export const COLLISION_BOUNCE_FLOOR_OFFSET_PX_DEFAULT = 0;
/** `settleReturnMode` default: 0 = on-support (v1 terminal behavior, unchanged). */
export const COLLISION_BOUNCE_SETTLE_RETURN_MODE_DEFAULT = 0;
/** Default contact-plane inset (px) from the support center/floor-line; 0 = contact at the raw geometric reference (v1 behavior). Mode-0(on-support)-only note: `dropHeightPx` is ignored for H0 in return-to-rest mode, where geometry (`restDistancePx + anticipationLiftPx`) always wins the excursion height. */
export const COLLISION_BOUNCE_CONTACT_OFFSET_PX_DEFAULT = 0;
/** Default fall height (px) for physics-first mode. */
export const COLLISION_BOUNCE_DROP_HEIGHT_PX_DEFAULT = 320;
/** Default constant acceleration (px/frame^2) for physics-first mode. */
export const COLLISION_BOUNCE_GRAVITY_PX_PER_FRAME2_DEFAULT = 0.9;
/** Default initial launch/transfer velocity (px/frame) for physics-first mode. */
export const COLLISION_BOUNCE_INITIAL_VELOCITY_PX_DEFAULT = 0;
/** Default apex-height stop threshold (px) for physics-first mode's bounce-count derivation. */
export const COLLISION_BOUNCE_STOP_THRESHOLD_PX_DEFAULT = 2;
/** Default anticipation wind-up span (frames), shared by both authoring modes. */
export const COLLISION_BOUNCE_ANTICIPATION_FRAMES_DEFAULT = 6;
/** Default anticipation lift distance (px); 0 = no wind-up displacement. */
export const COLLISION_BOUNCE_ANTICIPATION_LIFT_PX_DEFAULT = 0;
/** Default launch gain; 1.0 = no dramatic-launch boost over pure restitution. */
export const COLLISION_BOUNCE_LAUNCH_GAIN_DEFAULT = 1.0;
/** Default maximum squash at support-pinned contact. */
export const COLLISION_BOUNCE_CONTACT_SQUASH_DEFAULT = 0.72;
/** Default post-contact release stretch. */
export const COLLISION_BOUNCE_POST_STRETCH_DEFAULT = 1.35;
/** `stretchVelocityLink` default: 1 = velocity-linked continuous envelope (Attempt014 win). */
export const COLLISION_BOUNCE_STRETCH_VELOCITY_LINK_DEFAULT = 1;
/** Default tangential/radial area-compensation blend. */
export const COLLISION_BOUNCE_AREA_COMPENSATION_DEFAULT = 1;
/** `supportPinMode` default: 1 = distributed contact-window correction. */
export const COLLISION_BOUNCE_SUPPORT_PIN_MODE_DEFAULT = 1;
/** Default per-target phase step (frames) for full-phrase propagation. */
export const COLLISION_BOUNCE_PHASE_STEP_FRAMES_DEFAULT = 3;
/** `frontSpeedShape` default: 0 = uniform per-target cadence. */
export const COLLISION_BOUNCE_FRONT_SPEED_SHAPE_DEFAULT = 0;
/** Default energy falloff across ordered targets; 0 = no falloff. */
export const COLLISION_BOUNCE_ENERGY_FALLOFF_DEFAULT = 0;
/** `settleBudgetMode` default: 1 = allocate a settle-tail reservation. */
export const COLLISION_BOUNCE_SETTLE_BUDGET_MODE_DEFAULT = 1;

const TIME_DELAY_PARAMS: readonly MotionGrammarParamSpec[] = [
	{
		key: "staggerFrames",
		label: "Stagger",
		default: TIME_DELAY_STAGGER_DEFAULT,
		min: 0,
		max: 60,
		step: 1,
	},
	{
		key: "periodFrames",
		label: "Period",
		default: TIME_DELAY_PERIOD_DEFAULT,
		min: 1,
		max: 600,
		step: 1,
	},
	// Range Selector — shapes the per-target wavefront. The defaults (0 / 100 /
	// linear) are the identity selector, so an unauthored binding keeps the prior
	// uniform `index * stagger`. Real-node ordered sets only.
	{
		key: "rangeStart",
		label: "Range Start",
		default: WAVEFRONT_RANGE_START_DEFAULT,
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "rangeEnd",
		label: "Range End",
		default: WAVEFRONT_RANGE_END_DEFAULT,
		min: 0,
		max: 100,
		step: 1,
	},
	{
		key: "rangeShape",
		label: "Range Shape",
		default: WAVEFRONT_RANGE_SHAPE_DEFAULT,
		min: 0,
		max: 3,
		step: 1,
		// The selection value is a per-target time-offset (0 = fires first, 1 =
		// fires last), so these describe how the wave sweeps the ordered set.
		// `Window` is the only one that is not a sweep: it splits the set into an
		// in-range cohort (late) and an out-of-range cohort (early) via Range
		// Start/End — for staggering a sub-range, not a single wave.
		options: [
			{ value: 0, label: "Linear (front to back)" },
			{ value: 3, label: "Smooth (eased)" },
			{ value: 2, label: "Reverse (back to front)" },
			{ value: 1, label: "Window (sub-range)" },
		],
	},
];

/**
 * Offset has a distinct conveyor law; it must not inherit Time Delay's
 * range-selector controls. The first profile version keeps `staggerFrames` for
 * backwards-compatible bindings, while semantic-version 2 uses the explicit
 * subcycle, active-window, unit, easing, and duplicate-override contract.
 */
const TIME_OFFSET_PARAMS: readonly MotionGrammarParamSpec[] = [
	{
		key: "periodFrames",
		label: "Period",
		default: TIME_DELAY_PERIOD_DEFAULT,
		min: 1,
		max: 600,
		step: 1,
	},
	{
		key: "staggerFrames",
		label: "Legacy Stagger",
		default: TIME_DELAY_STAGGER_DEFAULT,
		min: 0,
		max: 60,
		step: 1,
	},
	{
		key: "subcycleFrames",
		label: "Subcycle",
		default: 30,
		min: 1,
		max: 600,
		step: 1,
	},
	{
		key: "activeFrames",
		label: "Active Window",
		default: 18,
		min: 1,
		max: 600,
		step: 1,
	},
	{
		key: "spacing",
		label: "Slot Spacing",
		default: 62,
		min: 0.001,
		max: 2000,
		step: 0.1,
	},
	{
		key: "sourceCoordinateScale",
		label: "Source Coordinate Scale",
		default: 1,
		min: 0.001,
		max: 1000,
		step: 0.001,
	},
	...Array.from({ length: 5 }, (_, index) => ({
		key: `slotValue${index + 1}`,
		label: `Slot ${index + 1} Radius`,
		default: [0, 15.9, 28.85, 15.9, 0][index] ?? 0,
		min: 0,
		max: 1000,
		step: 0.01,
	})),
	{
		key: "overrideSlot",
		label: "Override Slot",
		default: 3,
		min: 0,
		max: 4,
		step: 1,
	},
	{
		key: "overrideDup",
		label: "Override Duplicate",
		default: 1,
		min: 0,
		max: 2,
		step: 1,
	},
	{
		key: "overrideValue",
		label: "Override Radius",
		default: 18.5,
		min: 0,
		max: 1000,
		step: 0.01,
	},
	{
		key: "sourceValueScale",
		label: "Source Value Scale",
		default: 1,
		min: 0.001,
		max: 1000,
		step: 0.001,
	},
	{
		key: "radiusAnchorSceneUnits",
		label: "Radius Anchor",
		default: 52,
		min: 0.001,
		max: 1000,
		step: 0.1,
	},
	{
		key: "visibilityCutoffSourceUnits",
		label: "Visibility Cutoff",
		default: 0.01,
		min: 0,
		max: 1000,
		step: 0.001,
	},
	{
		key: "easingP1X",
		label: "Easing P1 X",
		default: 0.58,
		min: 0,
		max: 1,
		step: 0.001,
	},
	{
		key: "easingP1Y",
		label: "Easing P1 Y",
		default: 0.057,
		min: 0,
		max: 1,
		step: 0.001,
	},
	{
		key: "easingP2X",
		label: "Easing P2 X",
		default: 0.415,
		min: 0,
		max: 1,
		step: 0.001,
	},
	{
		key: "easingP2Y",
		label: "Easing P2 Y",
		default: 0.93,
		min: 0,
		max: 1,
		step: 0.001,
	},
];

const PERIODIC_AFTERIMAGE_PARAMS: readonly MotionGrammarParamSpec[] = [
	{
		key: "copies",
		label: "Copies",
		default: PERIODIC_AFTERIMAGE_COPIES_DEFAULT,
		min: 0,
		max: 12,
		step: 1,
	},
	{
		key: "delayFrames",
		label: "Delay",
		default: PERIODIC_AFTERIMAGE_DELAY_DEFAULT,
		min: 1,
		max: 90,
		step: 1,
	},
	{
		key: "decay",
		label: "Decay",
		default: PERIODIC_AFTERIMAGE_DECAY_DEFAULT,
		min: 0,
		max: 1,
		step: 0.01,
	},
	{
		key: "periodFrames",
		label: "Period",
		default: TIME_DELAY_PERIOD_DEFAULT,
		min: 1,
		max: 600,
		step: 1,
	},
];

const CYCLIC_PATH_TRAVEL_PARAMS: readonly MotionGrammarParamSpec[] = [
	{
		key: "periodFrames",
		label: "Period",
		default: TIME_DELAY_PERIOD_DEFAULT,
		min: 1,
		max: 600,
		step: 1,
	},
	{
		key: "phaseOffsetDegrees",
		label: "Phase Offset",
		default: CYCLIC_PATH_PHASE_OFFSET_DEFAULT,
		min: -360,
		max: 360,
		step: 1,
	},
	{
		key: "phaseStartFrame",
		label: "Phase Start",
		default: CYCLIC_PATH_PHASE_START_FRAME_DEFAULT,
		min: 0,
		max: 600,
		step: 1,
	},
	{
		key: "whipDurationFrames",
		label: "Whip Duration",
		default: CYCLIC_PATH_WHIP_DURATION_DEFAULT,
		min: 1,
		max: 599,
		step: 1,
	},
	{
		key: "whipSpanFraction",
		label: "Whip Span",
		default: CYCLIC_PATH_WHIP_SPAN_FRACTION_DEFAULT,
		min: 0.01,
		max: 0.99,
		step: 0.01,
	},
	{
		key: "radius",
		label: "Radius",
		default: CYCLIC_PATH_RADIUS_DEFAULT,
		min: 0,
		max: 512,
		step: 1,
	},
	{
		key: "phaseStepDegrees",
		label: "Phase",
		default: CYCLIC_PATH_PHASE_STEP_DEFAULT,
		min: -360,
		max: 360,
		step: 1,
	},
	{
		key: "pathOffsetPx",
		label: "Path Offset",
		default: CYCLIC_PATH_OFFSET_DEFAULT,
		min: -512,
		max: 512,
		step: 1,
	},
	{
		key: "orientToTangent",
		label: "Orient",
		default: CYCLIC_PATH_ORIENT_TO_TANGENT_DEFAULT,
		min: 0,
		max: 1,
		step: 1,
		options: [
			{ value: 0, label: "Off" },
			{ value: 1, label: "On" },
		],
	},
	{
		key: "orientationOffsetDegrees",
		label: "Orient Offset",
		default: CYCLIC_PATH_ORIENTATION_OFFSET_DEFAULT,
		min: -360,
		max: 360,
		step: 1,
	},
	{
		key: "windowFraction",
		label: "Stroke Window",
		default: CYCLIC_PATH_WINDOW_FRACTION_DEFAULT,
		min: 0.01,
		max: 0.95,
		step: 0.01,
	},
	{
		key: "headLagFraction",
		label: "Head Dot Lag",
		default: CYCLIC_PATH_HEAD_LAG_FRACTION_DEFAULT,
		min: -0.5,
		max: 0.5,
		step: 0.01,
	},
];

const RANDOM_PULSE_PARAMS: readonly MotionGrammarParamSpec[] = [
	{
		key: "periodFrames",
		label: "Period",
		default: RANDOM_PULSE_PERIOD_DEFAULT,
		min: 1,
		max: 600,
		step: 1,
	},
	{
		key: "cadenceFrames",
		label: "Cadence",
		default: RANDOM_PULSE_CADENCE_DEFAULT,
		min: 1,
		max: 60,
		step: 1,
	},
	{
		key: "pulseFrames",
		label: "Pulse",
		default: RANDOM_PULSE_WIDTH_DEFAULT,
		min: 1,
		max: 120,
		step: 1,
	},
	{
		key: "scaleAmplitude",
		label: "Scale",
		default: 0.22,
		min: 0,
		max: 2,
		step: 0.01,
	},
	{
		key: "opacityFloor",
		label: "Floor",
		default: 0.45,
		min: 0,
		max: 1,
		step: 0.05,
	},
];

const RING_WAVE_PARAMS: readonly MotionGrammarParamSpec[] = [
	{
		key: "periodFrames",
		label: "Period",
		default: RING_WAVE_PERIOD_DEFAULT,
		min: 1,
		max: 600,
		step: 1,
	},
	{
		key: "wavelengthPx",
		label: "Length",
		default: RING_WAVE_WAVELENGTH_DEFAULT,
		min: 1,
		max: 400,
		step: 1,
	},
	{
		key: "scaleAmplitude",
		label: "Scale",
		default: RING_WAVE_SCALE_AMPLITUDE_DEFAULT,
		min: 0,
		max: 2,
		step: 0.01,
	},
	{
		key: "opacityFloor",
		label: "Floor",
		default: RING_WAVE_OPACITY_FLOOR_DEFAULT,
		min: 0,
		max: 1,
		step: 0.05,
	},
	{
		key: "centerX",
		label: "Center X",
		default: RING_WAVE_CENTER_X_DEFAULT,
		min: -4000,
		max: 4000,
		step: 1,
	},
	{
		key: "centerY",
		label: "Center Y",
		default: RING_WAVE_CENTER_Y_DEFAULT,
		min: -4000,
		max: 4000,
		step: 1,
	},
	{
		key: "ringRadius",
		label: "Ring Radius",
		default: RING_WAVE_RING_RADIUS_DEFAULT,
		min: 1,
		max: 2000,
		step: 1,
	},
	{
		key: "pulseRadius",
		label: "Pulse Radius",
		default: RING_WAVE_PULSE_RADIUS_DEFAULT,
		min: -400,
		max: 400,
		step: 1,
	},
	{
		key: "driverOrbitRadius",
		label: "Driver Orbit",
		default: RING_WAVE_DRIVER_ORBIT_RADIUS_DEFAULT,
		min: 0,
		max: 1000,
		step: 1,
	},
	{
		key: "phaseStepDegrees",
		label: "Phase Step",
		default: RING_WAVE_PHASE_STEP_DEGREES_DEFAULT,
		min: -360,
		max: 360,
		step: 1,
	},
	{
		key: "radialPush",
		label: "Radial Push",
		default: RING_WAVE_RADIAL_PUSH_DEFAULT,
		min: -1000,
		max: 1000,
		step: 1,
	},
	{
		key: "tangentialSlide",
		label: "Tangential Slide",
		default: RING_WAVE_TANGENTIAL_SLIDE_DEFAULT,
		min: -1000,
		max: 1000,
		step: 1,
	},
	{
		key: "falloffDistance",
		label: "Falloff",
		default: RING_WAVE_FALLOFF_DISTANCE_DEFAULT,
		min: 1,
		max: 2000,
		step: 1,
	},
	{
		key: "falloffExponent",
		label: "Falloff Exponent",
		default: RING_WAVE_FALLOFF_EXPONENT_DEFAULT,
		min: 0.1,
		max: 8,
		step: 0.1,
	},
	{
		key: "minDistance",
		label: "Minimum Distance",
		default: RING_WAVE_MIN_DISTANCE_DEFAULT,
		min: 0,
		max: 1000,
		step: 1,
	},
];

const ARRANGEMENT_TRANSITION_PARAMS: readonly MotionGrammarParamSpec[] = [
	{
		key: "phaseStartFrame",
		label: "Start",
		default: 0,
		min: -600,
		max: 600,
		step: 1,
	},
	{
		key: "periodFrames",
		label: "Period",
		default: ARRANGEMENT_TRANSITION_PERIOD_DEFAULT,
		min: 1,
		max: 600,
		step: 1,
	},
	{
		key: "radiusPx",
		label: "Radius",
		default: ARRANGEMENT_TRANSITION_RADIUS_DEFAULT,
		min: 0,
		max: 600,
		step: 1,
	},
	{
		key: "angleOffset",
		label: "Offset",
		default: 0,
		min: -180,
		max: 180,
		step: 1,
	},
	{
		key: "scaleAmplitude",
		label: "Scale",
		default: ARRANGEMENT_TRANSITION_SCALE_AMPLITUDE_DEFAULT,
		min: 0,
		max: 2,
		step: 0.01,
	},
	{
		key: "gatherFraction",
		label: "Gather",
		default: ARRANGEMENT_GATHER_FRACTION_DEFAULT,
		min: 0.05,
		max: 0.8,
		step: 0.01,
	},
	{
		key: "holdFraction",
		label: "Stage hold",
		default: ARRANGEMENT_HOLD_FRACTION_DEFAULT,
		min: 0,
		max: 0.7,
		step: 0.01,
	},
	{
		key: "sharedTurnDegrees",
		label: "Turn",
		default: ARRANGEMENT_SHARED_TURN_DEGREES_DEFAULT,
		min: -720,
		max: 720,
		step: 1,
	},
	{
		key: "lobeDepth",
		label: "Lobe",
		default: ARRANGEMENT_LOBE_DEPTH_DEFAULT,
		min: 0.05,
		max: 1,
		step: 0.01,
	},
];

const MERGE_SPLIT_PARAMS: readonly MotionGrammarParamSpec[] = [
	{
		key: "periodFrames",
		label: "Period",
		default: MERGE_SPLIT_PERIOD_DEFAULT,
		min: 1,
		max: 600,
		step: 1,
	},
	{
		key: "strength",
		label: "Strength",
		default: MERGE_SPLIT_STRENGTH_DEFAULT,
		min: 0,
		max: 1.5,
		step: 0.05,
	},
	{
		key: "scaleFloor",
		label: "Size",
		default: MERGE_SPLIT_SCALE_FLOOR_DEFAULT,
		min: 0.05,
		max: 1,
		step: 0.05,
	},
	{
		key: "opacityFloor",
		label: "Floor",
		default: MERGE_SPLIT_OPACITY_FLOOR_DEFAULT,
		min: 0,
		max: 1,
		step: 0.05,
	},
	{
		key: "gatherFraction",
		label: "Gather",
		default: MERGE_SPLIT_GATHER_FRACTION_DEFAULT,
		min: 0.05,
		max: 0.7,
		step: 0.01,
	},
	{
		key: "holdFraction",
		label: "Hold",
		default: MERGE_SPLIT_HOLD_FRACTION_DEFAULT,
		min: 0,
		max: 0.7,
		step: 0.01,
	},
	{
		key: "returnFraction",
		label: "Return",
		default: MERGE_SPLIT_RETURN_FRACTION_DEFAULT,
		min: 0.05,
		max: 0.9,
		step: 0.01,
	},
	{
		key: "staggerFrames",
		label: "Stagger",
		default: MERGE_SPLIT_STAGGER_FRAMES_DEFAULT,
		min: 0,
		max: 120,
		step: 1,
	},
	{
		key: "ringTurnDegrees",
		label: "Ring Turn",
		default: MERGE_SPLIT_RING_TURN_DEGREES_DEFAULT,
		min: -720,
		max: 720,
		step: 1,
	},
	{
		key: "returnOvershoot",
		label: "Overshoot",
		default: MERGE_SPLIT_RETURN_OVERSHOOT_DEFAULT,
		min: 0,
		max: 0.5,
		step: 0.01,
	},
	{
		key: "coreScaleGain",
		label: "Core Gain",
		default: MERGE_SPLIT_CORE_SCALE_GAIN_DEFAULT,
		min: 0,
		max: 3,
		step: 0.05,
	},
];

const COUNT_GROWTH_PARAMS: readonly MotionGrammarParamSpec[] = [
	{
		key: "periodFrames",
		label: "Period",
		default: COUNT_GROWTH_PERIOD_DEFAULT,
		min: 1,
		max: 600,
		step: 1,
	},
	{
		key: "growFrames",
		label: "Grow",
		default: COUNT_GROWTH_GROW_FRAMES_DEFAULT,
		min: 1,
		max: 120,
		step: 1,
	},
	{
		key: "scaleFloor",
		label: "Size",
		default: COUNT_GROWTH_SCALE_FLOOR_DEFAULT,
		min: 0.05,
		max: 1,
		step: 0.05,
	},
	{
		key: "opacityFloor",
		label: "Floor",
		default: COUNT_GROWTH_OPACITY_FLOOR_DEFAULT,
		min: 0,
		max: 1,
		step: 0.05,
	},
	{
		key: "breathOpenFraction",
		label: "Open",
		default: COUNT_GROWTH_BREATH_OPEN_FRACTION_DEFAULT,
		min: 0.05,
		max: 0.7,
		step: 0.01,
	},
	{
		key: "breathHoldFraction",
		label: "Hold",
		default: COUNT_GROWTH_BREATH_HOLD_FRACTION_DEFAULT,
		min: 0,
		max: 0.7,
		step: 0.01,
	},
	{
		key: "breathRadiusScale",
		label: "Radius",
		default: COUNT_GROWTH_BREATH_RADIUS_SCALE_DEFAULT,
		min: 1,
		max: 3,
		step: 0.05,
	},
	{
		key: "centerOffsetX",
		label: "Center X",
		default: COUNT_GROWTH_CENTER_OFFSET_X_DEFAULT,
		min: -1024,
		max: 1024,
		step: 1,
	},
	{
		key: "centerOffsetY",
		label: "Center Y",
		default: COUNT_GROWTH_CENTER_OFFSET_Y_DEFAULT,
		min: -1024,
		max: 1024,
		step: 1,
	},
	{
		key: "rotationDegrees",
		label: "Turn",
		default: COUNT_GROWTH_ROTATION_DEGREES_DEFAULT,
		min: -720,
		max: 720,
		step: 1,
	},
	{
		key: "edgeRailAmplitude",
		label: "Edge Rail",
		default: COUNT_GROWTH_EDGE_RAIL_AMPLITUDE_DEFAULT,
		min: -256,
		max: 256,
		step: 1,
	},
	{
		key: "groupStaggerFrames",
		label: "Stagger",
		default: COUNT_GROWTH_GROUP_STAGGER_FRAMES_DEFAULT,
		min: 0,
		max: 60,
		step: 1,
	},
];

const FOLLOW_THROUGH_PARAMS: readonly MotionGrammarParamSpec[] = [
	{
		key: "periodFrames",
		label: "Period",
		default: FOLLOW_THROUGH_PERIOD_DEFAULT,
		min: 1,
		max: 600,
		step: 1,
	},
	{
		key: "delayFrames",
		label: "Delay",
		default: FOLLOW_THROUGH_DELAY_DEFAULT,
		min: 0,
		max: 90,
		step: 1,
	},
	{
		key: "response",
		label: "Response",
		default: FOLLOW_THROUGH_RESPONSE_DEFAULT,
		min: 0,
		max: 1.5,
		step: 0.05,
	},
	{
		key: "settleFrames",
		label: "Settle",
		default: FOLLOW_THROUGH_SETTLE_FRAMES_DEFAULT,
		min: 1,
		max: 180,
		step: 1,
	},
	{
		key: "decay",
		label: "Decay",
		default: FOLLOW_THROUGH_DECAY_DEFAULT,
		min: 0,
		max: 1,
		step: 0.01,
	},
	{
		key: "velocityLookback",
		label: "Velocity Lookback",
		default: FOLLOW_THROUGH_VELOCITY_LOOKBACK_DEFAULT,
		min: 1,
		max: 12,
		step: 1,
	},
	{
		key: "rotationResponse",
		label: "Rotation Response",
		default: FOLLOW_THROUGH_ROTATION_RESPONSE_DEFAULT,
		min: -1,
		max: 1,
		step: 0.01,
	},
];

const AUTO_ORIENT_PARAMS: readonly MotionGrammarParamSpec[] = [
	{
		key: "lookAheadFrames",
		label: "Look",
		default: AUTO_ORIENT_LOOKAHEAD_DEFAULT,
		min: 1,
		max: 30,
		step: 1,
	},
	{
		key: "angleOffset",
		label: "Offset",
		default: 0,
		min: -180,
		max: 180,
		step: 1,
	},
];

const PLANAR_TUMBLE_PARAMS: readonly MotionGrammarParamSpec[] = [
	{
		key: "periodFrames",
		label: "Period",
		default: PLANAR_TUMBLE_PERIOD_DEFAULT,
		min: 1,
		max: 600,
		step: 1,
	},
	{
		key: "phaseStaggerFrames",
		label: "Phase",
		default: PLANAR_TUMBLE_PHASE_STAGGER_DEFAULT,
		min: 0,
		max: 90,
		step: 1,
	},
	{
		key: "minProjection",
		label: "Projection",
		default: PLANAR_TUMBLE_MIN_PROJECTION_DEFAULT,
		min: 0.05,
		max: 1,
		step: 0.01,
	},
	{
		key: "tiltDegrees",
		label: "Tilt",
		default: PLANAR_TUMBLE_TILT_DEFAULT,
		min: 0,
		max: 45,
		step: 1,
	},
];

const SHEAR_SPLIT_PARAMS: readonly MotionGrammarParamSpec[] = [
	{
		key: "periodFrames",
		label: "Period",
		default: SHEAR_SPLIT_PERIOD_DEFAULT,
		min: 1,
		max: 600,
		step: 1,
	},
	{
		key: "splitDistance",
		label: "Distance",
		default: SHEAR_SPLIT_DISTANCE_DEFAULT,
		min: 0,
		max: 400,
		step: 1,
	},
	{
		key: "rotationDegrees",
		label: "Angle",
		default: SHEAR_SPLIT_ROTATION_DEFAULT,
		min: 0,
		max: 45,
		step: 1,
	},
];

const SIZE_SPEED_PARALLAX_PARAMS: readonly MotionGrammarParamSpec[] = [
	{
		key: "periodFrames",
		label: "Period",
		default: PARALLAX_PERIOD_DEFAULT,
		min: 1,
		max: 600,
		step: 1,
	},
	{
		key: "descentFraction",
		label: "Descent",
		default: PARALLAX_DESCENT_FRACTION_DEFAULT,
		min: 0.1,
		max: 0.9,
		step: 0.01,
	},
	{
		key: "axisDegrees",
		label: "Axis",
		default: PARALLAX_AXIS_DEGREES_DEFAULT,
		min: -360,
		max: 360,
		step: 1,
	},
	{
		key: "nearAmplitude",
		label: "Near",
		default: PARALLAX_NEAR_AMPLITUDE_DEFAULT,
		min: -512,
		max: 512,
		step: 1,
	},
	{
		key: "midAmplitude",
		label: "Mid",
		default: PARALLAX_MID_AMPLITUDE_DEFAULT,
		min: -512,
		max: 512,
		step: 1,
	},
	{
		key: "farAmplitude",
		label: "Far",
		default: PARALLAX_FAR_AMPLITUDE_DEFAULT,
		min: -512,
		max: 512,
		step: 1,
	},
	{
		key: "phaseOffsetFrames",
		label: "Phase",
		default: PARALLAX_PHASE_OFFSET_FRAMES_DEFAULT,
		min: -600,
		max: 600,
		step: 1,
	},
	{
		key: "lookAheadFrames",
		label: "Look",
		default: SIZE_SPEED_PARALLAX_LOOKAHEAD_DEFAULT,
		min: 1,
		max: 30,
		step: 1,
	},
	{
		key: "offsetMultiplier",
		label: "Offset",
		default: SIZE_SPEED_PARALLAX_OFFSET_DEFAULT,
		min: 0,
		max: 4,
		step: 0.05,
	},
	{
		key: "scalePerSpeed",
		label: "Scale",
		default: SIZE_SPEED_PARALLAX_SCALE_DEFAULT,
		min: 0,
		max: 0.2,
		step: 0.001,
	},
	{
		key: "maxScaleBoost",
		label: "Max",
		default: SIZE_SPEED_PARALLAX_MAX_SCALE_DEFAULT,
		min: 0,
		max: 2,
		step: 0.01,
	},
];

const MIRROR_SYMMETRIC_SCALE_PARAMS: readonly MotionGrammarParamSpec[] = [
	{
		key: "periodFrames",
		label: "Period",
		default: SYMMETRY_PULSE_PERIOD_DEFAULT,
		min: 1,
		max: 600,
		step: 1,
	},
	{
		key: "riseFrames",
		label: "Rise",
		default: SYMMETRY_PULSE_RISE_FRAMES_DEFAULT,
		min: 1,
		max: 300,
		step: 1,
	},
	{
		key: "holdFrames",
		label: "Hold",
		default: SYMMETRY_PULSE_HOLD_FRAMES_DEFAULT,
		min: 0,
		max: 300,
		step: 1,
	},
	{
		key: "outerTranslation",
		label: "Outer Spread",
		default: SYMMETRY_OUTER_TRANSLATION_DEFAULT,
		min: -512,
		max: 512,
		step: 1,
	},
	{
		key: "innerTranslation",
		label: "Inner Spread",
		default: SYMMETRY_INNER_TRANSLATION_DEFAULT,
		min: -512,
		max: 512,
		step: 1,
	},
	{
		key: "outerScale",
		label: "Outer Scale",
		default: SYMMETRY_OUTER_SCALE_DEFAULT,
		min: -1,
		max: 2,
		step: 0.01,
	},
	{
		key: "innerScale",
		label: "Inner Scale",
		default: SYMMETRY_INNER_SCALE_DEFAULT,
		min: -1,
		max: 2,
		step: 0.01,
	},
	{
		key: "centerScale",
		label: "Center Scale",
		default: SYMMETRY_CENTER_SCALE_DEFAULT,
		min: -1,
		max: 2,
		step: 0.01,
	},
	{
		key: "centerRotationDegrees",
		label: "Center Turn",
		default: SYMMETRY_CENTER_ROTATION_DEFAULT,
		min: -360,
		max: 360,
		step: 1,
	},
];

const BOOLEAN_DIFFERENCE_ROTATION_PARAMS: readonly MotionGrammarParamSpec[] = [
	{
		key: "strength",
		label: "Rotation",
		default: BOOLEAN_DIFFERENCE_ROTATION_STRENGTH_DEFAULT,
		min: 0,
		max: 2,
		step: 0.05,
	},
];

const INVERSE_PROPORTION_LINK_PARAMS: readonly MotionGrammarParamSpec[] = [
	{
		key: "mode",
		label: "Relation Mode",
		default: INVERSE_PROPORTION_MODE_DEFAULT,
		min: 0,
		max: 1,
		step: 1,
		options: [
			{ value: 0, label: "Reciprocal scale (legacy)" },
			{ value: 1, label: "Tangent anchor" },
		],
	},
	{
		key: "strength",
		label: "Strength",
		default: INVERSE_PROPORTION_STRENGTH_DEFAULT,
		min: 0,
		max: 2,
		step: 0.05,
	},
	{
		key: "anchorX",
		label: "Anchor X",
		default: INVERSE_PROPORTION_ANCHOR_X_DEFAULT,
		min: -4000,
		max: 4000,
		step: 1,
	},
	{
		key: "anchorY",
		label: "Anchor Y",
		default: INVERSE_PROPORTION_ANCHOR_Y_DEFAULT,
		min: -4000,
		max: 4000,
		step: 1,
	},
	{
		key: "axisX",
		label: "Axis X",
		default: INVERSE_PROPORTION_AXIS_X_DEFAULT,
		min: -1,
		max: 1,
		step: 0.01,
	},
	{
		key: "axisY",
		label: "Axis Y",
		default: INVERSE_PROPORTION_AXIS_Y_DEFAULT,
		min: -1,
		max: 1,
		step: 0.01,
	},
	{
		key: "radiusSum",
		label: "Radius Sum",
		default: INVERSE_PROPORTION_RADIUS_SUM_DEFAULT,
		min: 0.01,
		max: 4000,
		step: 1,
	},
	{
		key: "clearance",
		label: "Clearance",
		default: INVERSE_PROPORTION_CLEARANCE_DEFAULT,
		min: 0,
		max: 2000,
		step: 1,
	},
];

const REACTIVE_NEIGHBOR_DISPLACEMENT_PARAMS: readonly MotionGrammarParamSpec[] =
	[
		{
			key: "response",
			label: "Response",
			default: REACTIVE_NEIGHBOR_RESPONSE_DEFAULT,
			min: 0,
			max: 2,
			step: 0.05,
		},
	];

const NOISE_WIPE_PARAMS: readonly MotionGrammarParamSpec[] = [
	{
		key: "durationFrames",
		label: "Duration",
		default: NOISE_WIPE_DURATION_FRAMES_DEFAULT,
		min: 1,
		max: 600,
		step: 1,
	},
	{
		key: "angle",
		label: "Angle",
		default: NOISE_WIPE_ANGLE_DEFAULT,
		min: -180,
		max: 180,
		step: 1,
	},
	{
		key: "softness",
		label: "Softness",
		default: NOISE_WIPE_SOFTNESS_DEFAULT,
		min: 0,
		max: 1,
		step: 0.01,
	},
	{
		key: "noiseWeight",
		label: "Noise",
		default: NOISE_WIPE_NOISE_WEIGHT_DEFAULT,
		min: 0,
		max: 1,
		step: 0.01,
	},
	{
		key: "mode",
		label: "Direction",
		default: NOISE_WIPE_MODE_DEFAULT,
		min: 0,
		max: 1,
		step: 1,
		options: [
			{ value: 0, label: "Reveal in" },
			{ value: 1, label: "Dissolve out" },
		],
	},
];

const COLLISION_BOUNCE_PARAMS: readonly MotionGrammarParamSpec[] = [
	{
		key: "authoringMode",
		label: "Authoring Mode",
		default: COLLISION_BOUNCE_AUTHORING_MODE_DEFAULT,
		min: 0,
		max: 1,
		step: 1,
		options: [
			{ value: 0, label: "Duration-first" },
			{ value: 1, label: "Physics-first" },
		],
	},
	{
		key: "totalDurationFrames",
		label: "Duration",
		default: COLLISION_BOUNCE_TOTAL_DURATION_FRAMES_DEFAULT,
		min: 6,
		max: 600,
		step: 1,
	},
	{
		key: "bounces",
		label: "Bounces",
		default: COLLISION_BOUNCE_BOUNCES_DEFAULT,
		min: 1,
		max: 12,
		step: 1,
	},
	{
		key: "bounciness",
		label: "Bounciness",
		default: COLLISION_BOUNCE_BOUNCINESS_DEFAULT,
		min: 0.05,
		max: 0.95,
		step: 0.01,
	},
	{
		key: "contactHoldFrames",
		label: "Contact Hold",
		default: COLLISION_BOUNCE_CONTACT_HOLD_FRAMES_DEFAULT,
		min: 0,
		max: 8,
		step: 1,
	},
	{
		key: "travelAxisDegrees",
		label: "Travel Axis",
		default: COLLISION_BOUNCE_TRAVEL_AXIS_DEGREES_DEFAULT,
		min: -180,
		max: 180,
		step: 1,
	},
	{
		key: "supportMode",
		label: "Support",
		default: COLLISION_BOUNCE_SUPPORT_MODE_DEFAULT,
		min: 0,
		max: 1,
		step: 1,
		options: [
			{ value: 0, label: "Floor line" },
			{ value: 1, label: "Radial from support" },
		],
	},
	{
		key: "floorOffsetPx",
		label: "Floor Offset",
		default: COLLISION_BOUNCE_FLOOR_OFFSET_PX_DEFAULT,
		min: -4000,
		max: 4000,
		step: 1,
	},
	{
		key: "settleReturnMode",
		label: "Settle Return",
		default: COLLISION_BOUNCE_SETTLE_RETURN_MODE_DEFAULT,
		min: 0,
		max: 1,
		step: 1,
		options: [
			{ value: 0, label: "On support" },
			{ value: 1, label: "Return to rest" },
		],
	},
	{
		key: "contactOffsetPx",
		label: "Contact Offset",
		default: COLLISION_BOUNCE_CONTACT_OFFSET_PX_DEFAULT,
		min: 0,
		max: 4000,
		step: 1,
	},
	{
		key: "dropHeightPx",
		label: "Drop Height",
		default: COLLISION_BOUNCE_DROP_HEIGHT_PX_DEFAULT,
		min: 1,
		max: 4000,
		step: 1,
	},
	{
		key: "gravityPxPerFrame2",
		label: "Gravity",
		default: COLLISION_BOUNCE_GRAVITY_PX_PER_FRAME2_DEFAULT,
		min: 0.05,
		max: 80,
		step: 0.01,
	},
	{
		key: "initialVelocityPx",
		label: "Initial Velocity",
		default: COLLISION_BOUNCE_INITIAL_VELOCITY_PX_DEFAULT,
		min: -400,
		max: 400,
		step: 1,
	},
	{
		key: "stopThresholdPx",
		label: "Stop Threshold",
		default: COLLISION_BOUNCE_STOP_THRESHOLD_PX_DEFAULT,
		min: 0.5,
		max: 50,
		step: 0.5,
	},
	{
		key: "anticipationFrames",
		label: "Anticipation",
		default: COLLISION_BOUNCE_ANTICIPATION_FRAMES_DEFAULT,
		min: 0,
		max: 30,
		step: 1,
	},
	{
		key: "anticipationLiftPx",
		label: "Anticipation Lift",
		default: COLLISION_BOUNCE_ANTICIPATION_LIFT_PX_DEFAULT,
		min: 0,
		max: 400,
		step: 1,
	},
	{
		key: "launchGain",
		label: "Launch Gain",
		default: COLLISION_BOUNCE_LAUNCH_GAIN_DEFAULT,
		min: 1.0,
		max: 4.0,
		step: 0.05,
	},
	{
		key: "contactSquash",
		label: "Contact Squash",
		default: COLLISION_BOUNCE_CONTACT_SQUASH_DEFAULT,
		min: 0.4,
		max: 1.0,
		step: 0.01,
	},
	{
		key: "postStretch",
		label: "Post Stretch",
		default: COLLISION_BOUNCE_POST_STRETCH_DEFAULT,
		min: 1.0,
		max: 2.0,
		step: 0.01,
	},
	{
		key: "stretchVelocityLink",
		label: "Stretch Link",
		default: COLLISION_BOUNCE_STRETCH_VELOCITY_LINK_DEFAULT,
		min: 0,
		max: 1,
		step: 1,
		options: [
			{ value: 0, label: "Poses" },
			{ value: 1, label: "Envelope" },
		],
	},
	{
		key: "areaCompensation",
		label: "Area Compensation",
		default: COLLISION_BOUNCE_AREA_COMPENSATION_DEFAULT,
		min: 0,
		max: 1,
		step: 0.05,
	},
	{
		key: "supportPinMode",
		label: "Support Pin",
		default: COLLISION_BOUNCE_SUPPORT_PIN_MODE_DEFAULT,
		min: 0,
		max: 1,
		step: 1,
		options: [
			{ value: 0, label: "Single frame" },
			{ value: 1, label: "Distributed" },
		],
	},
	{
		key: "phaseStepFrames",
		label: "Phase Step",
		default: COLLISION_BOUNCE_PHASE_STEP_FRAMES_DEFAULT,
		min: 0,
		max: 30,
		step: 1,
	},
	{
		key: "frontSpeedShape",
		label: "Front Speed Shape",
		default: COLLISION_BOUNCE_FRONT_SPEED_SHAPE_DEFAULT,
		min: 0,
		max: 2,
		step: 1,
		options: [
			{ value: 0, label: "Uniform" },
			{ value: 1, label: "Eased" },
			{ value: 2, label: "Accelerating" },
		],
	},
	{
		key: "energyFalloff",
		label: "Energy Falloff",
		default: COLLISION_BOUNCE_ENERGY_FALLOFF_DEFAULT,
		min: 0,
		max: 1,
		step: 0.05,
	},
	{
		key: "settleBudgetMode",
		label: "Settle Budget",
		default: COLLISION_BOUNCE_SETTLE_BUDGET_MODE_DEFAULT,
		min: 0,
		max: 1,
		step: 1,
		options: [
			{ value: 0, label: "Clamp" },
			{ value: 1, label: "Allocate" },
		],
	},
];

const STROKE_DRAW_ON_PARAMS: readonly MotionGrammarParamSpec[] = [
	{
		key: "durationFrames",
		label: "Duration",
		default: 30,
		min: 1,
		max: 600,
		step: 1,
	},
	{
		key: "reverse",
		label: "Reverse",
		default: 0,
		min: 0,
		max: 1,
		step: 1,
		options: [
			{ value: 0, label: "Draw on" },
			{ value: 1, label: "Draw off" },
		],
	},
	{
		key: "dashLength",
		label: "Path length",
		default: 0,
		min: 0,
		max: 100000,
		step: 1,
	},
];

export const MOTION_GRAMMAR_CATALOG: readonly MotionGrammarCatalogEntry[] = [
	{
		id: "time-delay",
		label: "Time Delay",
		family: "temporal-placement",
		status: "implemented",
		minTargets: 2,
		usesSeed: false,
		params: TIME_DELAY_PARAMS,
	},
	{
		id: "time-offset-propagation",
		label: "Time Offset",
		family: "temporal-placement",
		status: "implemented",
		minTargets: 2,
		usesSeed: false,
		params: TIME_OFFSET_PARAMS,
	},
	{
		id: "periodic-afterimage",
		label: "Afterimage",
		family: "temporal-placement",
		status: "implemented",
		minTargets: 1,
		usesSeed: false,
		params: PERIODIC_AFTERIMAGE_PARAMS,
	},
	{
		id: "cyclic-path-travel",
		label: "Cycle",
		family: "temporal-placement",
		status: "implemented",
		minTargets: 1,
		usesSeed: false,
		params: CYCLIC_PATH_TRAVEL_PARAMS,
	},
	{
		id: "noise-wipe",
		label: "Noise Wipe",
		family: "temporal-placement",
		status: "implemented",
		minTargets: 1,
		usesSeed: false,
		params: NOISE_WIPE_PARAMS,
	},
	{
		id: "stroke-draw-on",
		label: "Draw On",
		family: "temporal-placement",
		status: "implemented",
		minTargets: 1,
		usesSeed: false,
		params: STROKE_DRAW_ON_PARAMS,
	},
	{
		id: "random-phase-pulse",
		label: "Random Pulse",
		family: "swarm-field",
		status: "implemented",
		minTargets: 1,
		usesSeed: true,
		params: RANDOM_PULSE_PARAMS,
	},
	{
		id: "ring-wave-interference",
		label: "Interference",
		family: "swarm-field",
		status: "implemented",
		minTargets: 3,
		usesSeed: false,
		params: RING_WAVE_PARAMS,
	},
	{
		id: "arrangement-transition",
		label: "Arrangement",
		family: "swarm-field",
		status: "implemented",
		minTargets: 3,
		usesSeed: false,
		params: ARRANGEMENT_TRANSITION_PARAMS,
	},
	{
		id: "merge-split-cycle",
		label: "Merge / Split",
		family: "swarm-field",
		status: "implemented",
		minTargets: 3,
		usesSeed: false,
		params: MERGE_SPLIT_PARAMS,
	},
	{
		id: "count-growth",
		label: "Count Growth",
		family: "swarm-field",
		status: "implemented",
		minTargets: 1,
		usesSeed: false,
		params: COUNT_GROWTH_PARAMS,
	},
	{
		id: "mirror-symmetric-scale",
		label: "Symmetry",
		family: "relational-constraint",
		status: "implemented",
		minTargets: 2,
		usesSeed: false,
		params: MIRROR_SYMMETRIC_SCALE_PARAMS,
	},
	{
		id: "boolean-difference-rotation",
		label: "Difference",
		family: "relational-constraint",
		status: "implemented",
		minTargets: 2,
		usesSeed: false,
		params: BOOLEAN_DIFFERENCE_ROTATION_PARAMS,
	},
	{
		id: "inverse-proportion-link",
		label: "Inverse Proportion",
		family: "relational-constraint",
		status: "implemented",
		minTargets: 2,
		usesSeed: false,
		params: INVERSE_PROPORTION_LINK_PARAMS,
	},
	{
		id: "reactive-neighbor-displacement",
		label: "Linkage",
		family: "relational-constraint",
		status: "implemented",
		minTargets: 2,
		usesSeed: false,
		params: REACTIVE_NEIGHBOR_DISPLACEMENT_PARAMS,
	},
	{
		id: "lag-follow-through",
		label: "Follow-through",
		family: "relational-constraint",
		status: "implemented",
		minTargets: 2,
		usesSeed: false,
		params: FOLLOW_THROUGH_PARAMS,
	},
	{
		id: "planar-solid-tumble",
		label: "2D to 3D",
		family: "spatial-dimensional",
		status: "implemented",
		minTargets: 1,
		usesSeed: false,
		params: PLANAR_TUMBLE_PARAMS,
	},
	{
		id: "shear-split",
		label: "Split",
		family: "spatial-dimensional",
		status: "implemented",
		minTargets: 2,
		usesSeed: false,
		params: SHEAR_SPLIT_PARAMS,
	},
	{
		id: "auto-orient-along-path",
		label: "Auto-orient",
		family: "spatial-dimensional",
		status: "implemented",
		minTargets: 1,
		usesSeed: false,
		params: AUTO_ORIENT_PARAMS,
	},
	{
		id: "size-speed-parallax",
		label: "Parallax",
		family: "spatial-dimensional",
		status: "implemented",
		minTargets: 3,
		usesSeed: false,
		params: SIZE_SPEED_PARALLAX_PARAMS,
	},
	{
		id: "collision-bounce",
		label: "Collision Bounce",
		family: "relational-constraint",
		status: "implemented",
		minTargets: 1,
		usesSeed: false,
		params: COLLISION_BOUNCE_PARAMS,
	},
];

const AUTHORABLE_TECHNIQUE_IDS = [
	"time-delay",
	"time-offset-propagation",
	"periodic-afterimage",
	"cyclic-path-travel",
	"noise-wipe",
	"stroke-draw-on",
	"collision-bounce",
	"random-phase-pulse",
	"count-growth",
	"mirror-symmetric-scale",
	"lag-follow-through",
	"ring-wave-interference",
	"merge-split-cycle",
	"size-speed-parallax",
	"inverse-proportion-link",
	"arrangement-transition",
	"boolean-difference-rotation",
	"reactive-neighbor-displacement",
	"planar-solid-tumble",
	"shear-split",
	"auto-orient-along-path",
] as const satisfies readonly MotionGrammarTechniqueId[];

export function findCatalogEntry(
	id: string,
): MotionGrammarCatalogEntry | undefined {
	return MOTION_GRAMMAR_CATALOG.find((entry) => entry.id === id);
}

/** Technique ids with implemented catalog/evaluator support. */
export function implementedTechniqueIds(): readonly MotionGrammarTechniqueId[] {
	return MOTION_GRAMMAR_CATALOG.filter(
		(entry) => entry.status === "implemented",
	).map((entry) => entry.id);
}

/** Technique ids currently promoted to the production authoring UI. */
export function authorableTechniqueIds(): readonly MotionGrammarTechniqueId[] {
	return AUTHORABLE_TECHNIQUE_IDS.filter(
		(id) => findCatalogEntry(id)?.status === "implemented",
	);
}
