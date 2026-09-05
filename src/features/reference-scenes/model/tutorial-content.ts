/**
 * User-facing tutorial copy for the `/tutorials` reference-scene gallery: a
 * "you will…" goal, an honest time estimate, and an ordered list of imperative
 * steps naming the exact editor UI the reader touches. This is rendered on the
 * public gallery page (`pages/tutorials`) AND inside the in-editor
 * `widgets/tutorial-guide` panel when a reference scene is opened, so the two
 * surfaces never drift apart.
 *
 * English-only (public-facing copy). Every step must name UI that exists in
 * the current build — tool names, panel section headers, field labels, and
 * shortcuts — verified against the live editor, not aspirational. `slug` is
 * the foreign key back to `../model/registry`'s `REFERENCE_SCENES`;
 * `scripts/check-reference-scenes.ts` enforces the FK is bidirectional and
 * that every entry has a real goal and enough real steps.
 *
 * Bundle discipline: this module must NOT be imported anywhere in the main
 * `/editor` bundle's static import graph. `pages/tutorials` imports it
 * statically (it is already its own lazy chunk), and the in-editor guide
 * panel reaches it only through a dynamic `import()` so a plain `/editor`
 * session never downloads tutorial copy.
 */
export type TutorialStep = {
	readonly title: string;
	readonly detail: string;
};

export type TutorialContent = {
	readonly slug: string;
	/** One-line "You will…" promise shown as the tutorial's goal. */
	readonly goal: string;
	/** Honest, small estimate in minutes — this is a short guided tour, not a course. */
	readonly estimatedMinutes: number;
	/** 4-8 imperative steps, each naming a real, reachable piece of UI. */
	readonly steps: readonly TutorialStep[];
};

export const TUTORIAL_CONTENT: readonly TutorialContent[] = [
	{
		slug: "grainy-gradient-orb",
		goal: "You will reshape a mesh-gradient glow and dial in its blur and grain.",
		estimatedMinutes: 4,
		steps: [
			{
				title: "Select the orb",
				detail:
					"Click the single rectangle on the canvas. The Inspector's Appearance section shows its fill as Gradient mesh, with a Mesh 9×9 / Points 81 readout.",
			},
			{
				title: "Switch to the Mesh tool",
				detail:
					"Press U (or click Mesh in the tool rail) to show the mesh grid overlay with its draggable point handles.",
			},
			{
				title: "Drag a mesh point",
				detail:
					"Drag one of the small circular handles to move a color anchor. The color field and the orb's soft edge update live as you drag.",
			},
			{
				title: "Select a mesh point's color",
				detail:
					"Click directly on a point handle to select it — the Appearance section adds a Point row with Color, X, Y, and Alpha fields for that anchor.",
			},
			{
				title: "Adjust the Layer blur",
				detail:
					"Back in Appearance, find the Layer blur row and change its Radius field to make the glow tighter or softer.",
			},
			{
				title: "Adjust Grain and Noise",
				detail:
					"Under the Look section's Texture group, drag the Grain slider to change how visible the grain is, and the Noise slider to change its scale.",
			},
			{
				title: "Return to your own document",
				detail:
					"Reload /editor without ?ref to bring back your own saved document, untouched.",
			},
		],
	},
	{
		slug: "grainy-dissolve-cover",
		goal: "You will see how one shared palette plus a gradient-geometry and field-direction change builds a two-plate grainy dissolve cover.",
		estimatedMinutes: 5,
		steps: [
			{
				title: "Read the four plates in the Layers panel",
				detail:
					"Open the Layers panel. Bottom to top: bgDeep and bgPink are full-bleed rectangles; sphereDeep and spherePink are circles at the same position and size. Each pink plate sits directly over its own deep plate.",
			},
			{
				title: "Compare the deep base plates",
				detail:
					"Select bgDeep, then sphereDeep. Both show the same violet-to-blue-violet gradient in the Inspector's Appearance section — bgDeep as Linear gradient, sphereDeep as Radial gradient. Same two colors, different gradient geometry.",
			},
			{
				title: "Compare the bright plates above them",
				detail:
					"Select bgPink, then spherePink. Both use the bright pink-to-violet palette — again Linear on the background, Radial on the sphere — sitting directly above their matching deep plate.",
			},
			{
				title: "Open the background's Noise Gradient",
				detail:
					"With bgPink selected, find the Noise Gradient toggle in the Look section. Its subtitle reads Scoped effect · on — this plate was converted to a scoped noise-gradient graph, not a plain solid fill.",
			},
			{
				title: "Read the background's Field direction",
				detail:
					"Still on bgPink, check the Field control and the Linear field row below it: the field runs diagonally, so the plate reads as barely dissolved near the top-right and heavily dissolved toward the bottom-left, revealing bgDeep beneath it.",
			},
			{
				title: "Compare the sphere's Field direction",
				detail:
					"Select spherePink and check its Field control: the Linear field here runs vertically instead of diagonally, so the sphere dissolves from mostly solid pink at the top to mostly deep violet at the bottom.",
			},
			{
				title: "Adjust Extent and Softness",
				detail:
					"With either pink plate selected, drag its Noise Gradient block's Extent and Softness fields to see how far the dissolve reaches and how hard or soft its speck edges are.",
			},
			{
				title: "Return to your own document",
				detail:
					"Reload /editor without ?ref to bring back your own saved document, untouched.",
			},
		],
	},
	{
		slug: "cycle-motion-system",
		goal: "You will play a looping orbit and retune its period, radius, and phase.",
		estimatedMinutes: 4,
		steps: [
			{
				title: "Open the Timeline and press Play",
				detail:
					"Open the Timeline panel and click Play. Watch each dot travel a closed loop and return to its start.",
			},
			{
				title: "Select one orbiting dot",
				detail:
					"Click a single dot on the canvas. The Inspector's Motion section shows Cycle with a Selected row naming that dot as one of 5 targets.",
			},
			{
				title: "Change the loop period",
				detail:
					"In the Timing group, change Period frames to speed up or slow down the whole loop.",
			},
			{
				title: "Change the orbit radius",
				detail:
					"In the Layout group, change Radius px to grow or shrink the orbit size — scrub the Timeline to see the new orbit.",
			},
			{
				title: "Change the phase stagger",
				detail:
					"Still in Layout, change Phase step deg to shift how far out of step each of the 5 dots travels relative to the next.",
			},
			{
				title: "Edit the dot's own appearance",
				detail:
					"With a dot selected, use the ordinary Transform and Appearance sections above Motion — it's still a normal editable object.",
			},
		],
	},
	{
		slug: "time-delay-motion-system",
		goal: "You will play a delayed replay wave and retime it from its one motion clip.",
		estimatedMinutes: 5,
		steps: [
			{
				title: "Open the Timeline and press Play",
				detail:
					"Open the Timeline panel and click Play. Five master dots drive a delayed replay across satellite dots, reading as one traveling wave.",
			},
			{
				title: "Select the Time Delay expansion clip",
				detail:
					"Click the Time Delay expansion clip in the Clips row. The Inspector switches to a Clip badge showing Start and Duration fields.",
			},
			{
				title: "Compare master vs. delayed instances",
				detail:
					"Read the Master objects row (5 live objects) and the Editable scene objects / Generated support objects rows below it — the masters are ordinary objects, the satellites are generated from the profile.",
			},
			{
				title: "Retime the whole system",
				detail:
					"Change Duration to retime the entire delayed replay; the clip range updates together with it.",
			},
			{
				title: "Tweak the delay parameters",
				detail:
					"In the Timing group, change Period frames, Stagger frames, and Instance delay; in Layout, change Instance spacing — then scrub the Timeline to see the new stagger.",
			},
			{
				title: "Jump to the master objects",
				detail:
					"Click Select next to Master objects to return to normal multi-object editing of the 5 master dots, then edit their fill or radius from the Appearance section.",
			},
			{
				title: "Reselect the clip",
				detail:
					"Click the Time Delay expansion clip again in the Clips row to return to the motion-system timing controls.",
			},
		],
	},
	{
		slug: "corner-radius-expansion",
		goal: "You will round corners three ways: uniform, per-corner, and iOS-style squircle.",
		estimatedMinutes: 3,
		steps: [
			{
				title: "Select the uniform-radius shape",
				detail:
					"Click the leftmost rounded rectangle. The Inspector's Appearance section shows a Radius px field.",
			},
			{
				title: "Change the uniform radius",
				detail:
					"Edit Radius px and watch all four corners round together on canvas.",
			},
			{
				title: "Switch a shape to per-corner",
				detail:
					"Click Per corner next to Radius px. Four fields — TL, TR, BL, BR — appear so each corner can round independently.",
			},
			{
				title: "Round one corner on canvas",
				detail:
					"With the shape selected, drag one of its inset corner handles toward the center; hold Alt/Option to round only that one corner.",
			},
			{
				title: "Select the squircle shape",
				detail:
					"Click the rightmost shape and find its Smoothing % field next to Radius px.",
			},
			{
				title: "Apply the iOS smoothing preset",
				detail:
					"Click the iOS button for a one-click 60% squircle blend, or drag Smoothing % to any value between a circular arc and the full superellipse.",
			},
		],
	},
	{
		slug: "signal-handoff",
		goal: "You will inspect one causal phrase built from an affine controller, a channel constraint, a traveling matte, and an ordered morph.",
		estimatedMinutes: 5,
		steps: [
			{
				title: "Play the complete handoff",
				detail:
					"Open the Timeline and press Play. The quiet wake yields to one moving aperture, which reveals and reshapes the forward signal before a deliberate hold.",
			},
			{
				title: "Inspect the constrained wake",
				detail:
					"Select Inherited wake in Layers. Inspector Constraints shows its source plus Position and Rotation channels without copied controller keys.",
			},
			{
				title: "Read the exact timing graph",
				detail:
					"Select a controller key, expand Timeline mode, and enable Graph. Switch between Value and Speed to see the asymmetric attack, overshoot, and braking tail sampled by export.",
			},
			{
				title: "Inspect matte and morph ownership",
				detail:
					"Select Main signal field to read its red-channel matte, then select Changing aperture at an exact path key with Direct Select to inspect correspondence lines and seam controls.",
			},
		],
	},
	{
		slug: "signal-handoff-material",
		goal: "You will inspect how one moving source wakes a receiver's surface, edge, diffusion, and grain after contact.",
		estimatedMinutes: 5,
		steps: [
			{
				title: "Play through the material wake",
				detail:
					"Open the Timeline and press Play. The receiving knot stays visually quiet during approach, then its material response rises as the aperture reaches it and settles into the hold.",
			},
			{
				title: "Select the receiving knot",
				detail:
					"Select Receiving knot in Layers. Its ordinary Appearance and object-scoped grain remain editable independently of the optical relationship.",
			},
			{
				title: "Inspect the one-source relationship",
				detail:
					"In Source Optics, read Changing aperture as the single source and Receiving knot as its only target; surface, diffusion, edge, and microstructure share that owner.",
			},
			{
				title: "Read the wake timing",
				detail:
					"In the Timeline, inspect the Source Optics parameter tracks around frames 46, 58, and 72 to see the response move from zero through overshoot into its settled state.",
			},
		],
	},
	{
		slug: "projected-solid-probe",
		goal: "You will inspect how one asymmetric profile becomes editable front, side, back, and source-facing edge carriers.",
		estimatedMinutes: 5,
		steps: [
			{
				title: "Read the silhouette at Fit",
				detail:
					"Fit the artboard in the canvas. Confirm that the clipped corner, bowed lower edge, amber side, recessed back, and cyan source-facing edge read as one payload without motion or camera polish.",
			},
			{
				title: "Inspect each generated carrier",
				detail:
					"In Layers, select Back — generated profile, Side — generated depth carrier, and Front — source profile snapshot. Each is an ordinary editable path with its own role and appearance.",
			},
			{
				title: "Inspect the regional source",
				detail:
					"Select Single material source, then inspect Source Optics. One rig owns regional front and side responses; there is no global frame glow or duplicated source.",
			},
			{
				title: "Confirm the editing boundary",
				detail:
					"Use Direct Select to move a front-profile point. The node remains editable, but generated sibling faces do not regenerate live; this is the explicit missing profile/axis/depth contract, not hidden behavior.",
			},
		],
	},
];

/** Looks up tutorial copy by slug — the FK back to `REFERENCE_SCENES`. */
export function findTutorialContent(slug: string): TutorialContent | undefined {
	return TUTORIAL_CONTENT.find((entry) => entry.slug === slug);
}
