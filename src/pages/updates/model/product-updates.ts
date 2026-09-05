export type ProductUpdateStatus = "public" | "beta" | "internal";

export type ProductUpdateSourceRef = {
	readonly path: string;
	readonly heading: string;
};

export type ProductUpdateClaim = {
	readonly id: string;
	readonly publicText: string;
	readonly source: ProductUpdateSourceRef;
};

export type ProductUpdateDetail = {
	readonly label: string;
	readonly value: string;
};

export type ProductUpdateEntry = {
	readonly slug: string;
	readonly category: string;
	readonly date: string;
	readonly status: ProductUpdateStatus;
	readonly title: string;
	readonly summary: string;
	readonly canonicalSources: readonly ProductUpdateSourceRef[];
	readonly highlights: readonly ProductUpdateClaim[];
	readonly workflow: readonly ProductUpdateClaim[];
	readonly beforeAfter: readonly ProductUpdateDetail[];
	readonly details: readonly ProductUpdateDetail[];
	readonly whyItMatters: readonly ProductUpdateClaim[];
	readonly limits: readonly ProductUpdateClaim[];
};

const timeDelaySource = {
	path: "docs/product-knowledge/time-delay-motion-system.md",
	heading: "Summary",
} as const satisfies ProductUpdateSourceRef;

const afterimageSource = {
	path: "docs/product-knowledge/afterimage-motion-system.md",
	heading: "Summary",
} as const satisfies ProductUpdateSourceRef;

const timelineWorkspaceSource = {
	path: "docs/product-knowledge/timeline-motion-workspace.md",
	heading: "What changed?",
} as const satisfies ProductUpdateSourceRef;

const projectBackupSource = {
	path: "docs/product-knowledge/current-capabilities.md",
	heading: "16. Backup",
} as const satisfies ProductUpdateSourceRef;

const noiseGradientSource = {
	path: "docs/product-knowledge/noise-gradient.md",
	heading: "What Changed?",
} as const satisfies ProductUpdateSourceRef;

const lookGraphParticleDissolveSource = {
	path: "docs/product-knowledge/look-graph-particle-dissolve.md",
	heading: "What changed?",
} as const satisfies ProductUpdateSourceRef;

const blendToolSource = {
	path: "docs/product-knowledge/current-capabilities.md",
	heading: "3. Tools",
} as const satisfies ProductUpdateSourceRef;

const repeatTransformSource = {
	path: "docs/product-knowledge/repeat-transform.md",
	heading: "Summary",
} as const satisfies ProductUpdateSourceRef;

const gridBentoLayoutSource = {
	path: "docs/product-knowledge/grid-bento-layout-authoring.md",
	heading: "Grid and Bento Layout Authoring",
} as const satisfies ProductUpdateSourceRef;

const editorNewProjectSource = {
	path: "docs/product-knowledge/editor-new-project.md",
	heading: "What changed?",
} as const satisfies ProductUpdateSourceRef;

const motionCodeRuntimeSource = {
	path: "docs/product-knowledge/motion-code-runtime-export.md",
	heading: "What Users Can Do Now",
} as const satisfies ProductUpdateSourceRef;

const visualReviewSource = {
	path: "docs/product-knowledge/visual-review.md",
	heading: "Summary",
} as const satisfies ProductUpdateSourceRef;

const effectFieldSource = {
	path: "docs/product-knowledge/effect-field.md",
	heading: "Summary",
} as const satisfies ProductUpdateSourceRef;

const anisotropicBlurSource = {
	path: "docs/product-knowledge/axis-aligned-anisotropic-blur.md",
	heading: "Summary",
} as const satisfies ProductUpdateSourceRef;

const multiEditorSessionsSource = {
	path: "docs/product-knowledge/multi-editor-sessions.md",
	heading: "Summary",
} as const satisfies ProductUpdateSourceRef;

const generalMotionRelationshipsSource = {
	path: "docs/product-knowledge/general-motion-relationships.md",
	heading: "What changed?",
} as const satisfies ProductUpdateSourceRef;

const transformPropertyConstraintsSource = {
	path: "docs/product-knowledge/transform-and-property-constraints.md",
	heading: "What changed?",
} as const satisfies ProductUpdateSourceRef;

const directSpatialMotionPathsSource = {
	path: "docs/product-knowledge/direct-spatial-motion-paths.md",
	heading: "What changed?",
} as const satisfies ProductUpdateSourceRef;

const travelingLayerMattesSource = {
	path: "docs/product-knowledge/traveling-layer-mattes.md",
	heading: "What changed?",
} as const satisfies ProductUpdateSourceRef;

const morphTopologySource = {
	path: "docs/product-knowledge/morph-topology-correspondence.md",
	heading: "What changed?",
} as const satisfies ProductUpdateSourceRef;

const transitionPhraseTimingSource = {
	path: "docs/product-knowledge/multi-role-transition-phrase-timing.md",
	heading: "What changed?",
} as const satisfies ProductUpdateSourceRef;

const agentDotMatrixSource = {
	path: "docs/product-knowledge/agent-dot-matrix-authoring.md",
	heading: "Summary",
} as const satisfies ProductUpdateSourceRef;

const aiPixelObjectImportSource = {
	path: "docs/product-knowledge/ai-pixel-object-import.md",
	heading: "Summary",
} as const satisfies ProductUpdateSourceRef;

const sharedColorControlsSource = {
	path: "docs/product-knowledge/shared-color-controls.md",
	heading: "What changed?",
} as const satisfies ProductUpdateSourceRef;

export const PRODUCT_UPDATES = [
	{
		slug: "shared-color-controls",
		category: "Design",
		date: "2026-07-13",
		status: "beta",
		title: "Recolor a visual system from one control",
		summary:
			"Shared colors keep selected solid fills synchronized in the editor and preserve the same controllable prop in Motion Component exports.",
		canonicalSources: [sharedColorControlsSource],
		highlights: [
			{
				id: "shared-colors.atomic",
				publicText:
					"Create one shared color from multiple selected objects and change every bound leading solid fill together in one undoable edit.",
				source: sharedColorControlsSource,
			},
		],
		workflow: [
			{
				id: "shared-colors.workflow",
				publicText:
					"Select objects with unanimated solid fills, click plus in Inspector Shared colors, then edit the resulting color row with the standard picker.",
				source: {
					path: "docs/product-knowledge/shared-color-controls.md",
					heading: "How does the user operate it?",
				},
			},
		],
		beforeAfter: [
			{
				label: "Before",
				value: "Repeated palette colors had to be edited object by object.",
			},
			{
				label: "Now",
				value:
					"One document color driver updates every bound fill and remains host-controllable after export.",
			},
		],
		details: [
			{ label: "Creation", value: "Selected unanimated leading solid fills" },
			{ label: "Editing", value: "Atomic and undoable" },
			{ label: "Export", value: "Existing SVG/WebGL component props" },
		],
		whyItMatters: [
			{
				id: "shared-colors.why",
				publicText:
					"Palette systems stay coherent while the artwork remains ordinary editable vector paint.",
				source: sharedColorControlsSource,
			},
		],
		limits: [
			{
				id: "shared-colors.limit",
				publicText:
					"V1 creates bindings only for unanimated leading solid fills; gradients, strokes, effect colors, binding repair, and animated-target composition are not included.",
				source: {
					path: "docs/product-knowledge/shared-color-controls.md",
					heading: "What is still intentionally limited?",
				},
			},
		],
	},
	{
		slug: "transform-and-property-constraints",
		category: "Motion",
		date: "2026-07-13",
		status: "beta",
		title: "Follow only the motion channels you need",
		summary:
			"Partial transform constraints and numeric property relations coordinate secondary motion without copied keys or full parenting.",
		canonicalSources: [transformPropertyConstraintsSource],
		highlights: [
			{
				id: "constraints.partial-transform",
				publicText:
					"Follow Position, Rotation, or Scale at an explicit strength in local or world space while preserving the target's independent channels.",
				source: transformPropertyConstraintsSource,
			},
			{
				id: "constraints.property-map",
				publicText:
					"Map registered numeric properties such as opacity or corner geometry with scale, offset, and clamp.",
				source: transformPropertyConstraintsSource,
			},
		],
		workflow: [
			{
				id: "constraints.workflow",
				publicText:
					"Select a target and configure its source, channels, space, strength, offset, or property mapping in Inspector Constraints.",
				source: transformPropertyConstraintsSource,
			},
		],
		beforeAfter: [
			{
				label: "Before",
				value: "Shared motion required full parenting or copied keys.",
			},
			{
				label: "Now",
				value:
					"A target can inherit only the channels or numeric value relationship it needs.",
			},
		],
		details: [
			{ label: "Transform", value: "Position, Rotation, Scale" },
			{ label: "Blend", value: "0–100% strength" },
			{ label: "Space", value: "Local or world" },
			{ label: "Properties", value: "Registry-backed numeric mappings" },
		],
		whyItMatters: [
			{
				id: "constraints.why",
				publicText:
					"Lead-and-follow systems remain compact and editable without turning every relationship into a full rig hierarchy.",
				source: transformPropertyConstraintsSource,
			},
		],
		limits: [
			{
				id: "constraints.limit",
				publicText:
					"V1 is same-artboard and single-source; IK, weighted multi-parenting, simulation, and arbitrary expressions remain separate capabilities.",
				source: {
					path: "docs/product-knowledge/transform-and-property-constraints.md",
					heading: "Boundaries",
				},
			},
		],
	},
	{
		slug: "multi-role-transition-phrase-timing",
		category: "Motion",
		date: "2026-07-13",
		status: "beta",
		title: "Shape a whole transition phrase at once",
		summary:
			"One semantic timing choice can now synchronize every authored segment in a selected multi-role motion-system clip.",
		canonicalSources: [transitionPhraseTimingSource],
		highlights: [
			{
				id: "phrase-timing.transaction",
				publicText:
					"Apply one supported departure/arrival template across clip member tracks in a single undo step while preserving keys and role identity.",
				source: transitionPhraseTimingSource,
			},
		],
		workflow: [
			{
				id: "phrase-timing.workflow",
				publicText:
					"Select a motion-system clip in the Timeline, then choose Phrase timing in its Inspector motion pane.",
				source: transitionPhraseTimingSource,
			},
		],
		beforeAfter: [
			{
				label: "Before",
				value: "Related segments needed repeated timing edits.",
			},
			{
				label: "Now",
				value: "Clip membership provides one transactional timing boundary.",
			},
		],
		details: [
			{ label: "Scope", value: "All clip member segments" },
			{ label: "Write", value: "One Motion command" },
			{ label: "Delivery", value: "Ordinary shared track sampler" },
		],
		whyItMatters: [
			{
				id: "phrase-timing.why",
				publicText:
					"Outgoing, handoff, incoming, and residual roles can feel like one causal beat without an opaque transition preset.",
				source: transitionPhraseTimingSource,
			},
		],
		limits: [
			{
				id: "phrase-timing.limit",
				publicText:
					"The command synchronizes representable segment easing; it does not invent anticipation, rebound, or profile-only physics.",
				source: {
					path: "docs/product-knowledge/multi-role-transition-phrase-timing.md",
					heading: "Limits",
				},
			},
		],
	},
	{
		slug: "morph-topology-correspondence",
		category: "Motion",
		date: "2026-07-13",
		status: "beta",
		title: "Repair and direct path morph correspondence",
		summary:
			"Path animation can repair unequal vertex counts and author seam, winding, and vertex correspondence directly on the canvas.",
		canonicalSources: [morphTopologySource],
		highlights: [
			{
				id: "morph-topology.repair",
				publicText:
					"Repair smaller path keys with exact cubic subdivisions, then change first vertex or winding without changing the key's visible curve.",
				source: morphTopologySource,
			},
			{
				id: "morph-topology.honest",
				publicText:
					"Incompatible topology still holds with a typed issue instead of silently guessing a nearest-point mapping.",
				source: morphTopologySource,
			},
		],
		workflow: [
			{
				id: "morph-topology.workflow",
				publicText:
					"Select an animated path at an exact shape key, then use Direct Select ghosts, correspondence lines, vertex selection, and previews to repair counts or change seam and winding.",
				source: morphTopologySource,
			},
		],
		beforeAfter: [
			{ label: "Before", value: "Unequal path keys could only hold." },
			{
				label: "Now",
				value:
					"Keys can be repaired to one explicit index correspondence while remaining ordinary editable path snapshots.",
			},
		],
		details: [
			{ label: "Repair", value: "Exact cubic subdivision" },
			{ label: "Pairing", value: "Ordered vertex index" },
			{ label: "Seam", value: "Closed-path first vertex" },
			{ label: "Delivery", value: "Shared pathShape sampler" },
		],
		whyItMatters: [
			{
				id: "morph-topology.why",
				publicText:
					"Logo, icon, and abstract shape changes can be corrected at their real correspondence instead of hidden behind frame baking.",
				source: morphTopologySource,
			},
		],
		limits: [
			{
				id: "morph-topology.limit",
				publicText:
					"Repair aligns counts but does not infer semantic feature matches; first-vertex rotation is closed-path only.",
				source: {
					path: "docs/product-knowledge/morph-topology-correspondence.md",
					heading: "Limits",
				},
			},
		],
	},
	{
		slug: "traveling-layer-mattes",
		category: "Motion",
		date: "2026-07-13",
		status: "beta",
		title: "Drive multiple reveals with one moving matte",
		summary:
			"One same-artboard vector source can act as an alpha, luminance, or RGB-channel matte for nested and cross-layer consumers while keeping one editable identity.",
		canonicalSources: [travelingLayerMattesSource],
		highlights: [
			{
				id: "traveling-matte.reference",
				publicText:
					"Animate or controller-parent one matte source and every linked consumer follows it without copied geometry or position keys.",
				source: travelingLayerMattesSource,
			},
			{
				id: "traveling-matte.channel",
				publicText:
					"Inspector exposes alpha, luminance, red, green, blue, source sampling intent, invert, blur, opacity, and signed expand on the durable relation.",
				source: travelingLayerMattesSource,
			},
		],
		workflow: [
			{
				id: "traveling-matte.workflow",
				publicText:
					"Use any visible vector source in the same artboard as a mask, choose the channel in a consumer's Appearance, then animate the shared source normally.",
				source: {
					path: "docs/product-knowledge/traveling-layer-mattes.md",
					heading: "How to use it",
				},
			},
		],
		beforeAfter: [
			{
				label: "Before",
				value:
					"Native masks exposed silhouette softness but not matte channel intent.",
			},
			{
				label: "Now",
				value:
					"The same reference relation carries alpha/luminance and pre/post-effect semantics across shared consumers.",
			},
		],
		details: [
			{
				label: "Channels",
				value: "Alpha, solid luminance / red / green / blue",
			},
			{ label: "Space", value: "Same-artboard, cross-layer and nested" },
			{ label: "Motion", value: "Keys, spatial paths, controllers" },
			{ label: "Delivery", value: "Shared SVG mask plan" },
		],
		whyItMatters: [
			{
				id: "traveling-matte.why",
				publicText:
					"Peels, wipes, windows, and coordinated reveals remain compact relations instead of duplicated consumer animation.",
				source: travelingLayerMattesSource,
			},
		],
		limits: [
			{
				id: "traveling-matte.limit",
				publicText:
					"Post-effect and pixel-derived gradient/image/video channel sources remain typed-unrepresented; direct GPU and PDF support remain limited.",
				source: {
					path: "docs/product-knowledge/traveling-layer-mattes.md",
					heading: "Fidelity and limits",
				},
			},
		],
	},
	{
		slug: "direct-spatial-motion-paths",
		category: "Motion",
		date: "2026-07-13",
		status: "beta",
		title: "Shape motion directly on the canvas",
		summary:
			"Position keys follow an editable cubic route with exact tangents and speed dots, while sampled Value/Speed Graphs shape temporal timing separately.",
		canonicalSources: [directSpatialMotionPathsSource],
		highlights: [
			{
				id: "spatial-path.direct",
				publicText:
					"Drag paired position stops and incoming or outgoing tangents with the Motion Path tool while temporal easing remains a separate timing decision.",
				source: directSpatialMotionPathsSource,
			},
			{
				id: "spatial-path.delivery",
				publicText:
					"Canvas preview, controllers, camera projection, export, and Motion / Code playback consume the same cubic path sampler.",
				source: directSpatialMotionPathsSource,
			},
			{
				id: "spatial-path.graph",
				publicText:
					"Expanded Timeline mode reads sampled Value or Speed and edits all four temporal cubic handles without conflating them with spatial tangents.",
				source: directSpatialMotionPathsSource,
			},
		],
		workflow: [
			{
				id: "spatial-path.workflow",
				publicText:
					"Select an object with two or more position stops, run Enable direct spatial path, then use Motion Path or Inspector to reshape, smooth, rove, or remove the route.",
				source: {
					path: "docs/product-knowledge/direct-spatial-motion-paths.md",
					heading: "What can a user do now?",
				},
			},
		],
		beforeAfter: [
			{
				label: "Before",
				value: "The canvas displayed an X/Y trajectory but could not edit it.",
			},
			{
				label: "Now",
				value:
					"The same trajectory has draggable stops, independent spatial tangents, and explicit continuity and roving behavior.",
			},
		],
		details: [
			{ label: "Values", value: "Paired X/Y tracks" },
			{ label: "Geometry", value: "Artboard-space cubic tangents" },
			{ label: "Modes", value: "Corner, continuous, automatic" },
			{
				label: "Timing",
				value: "Exact cubic Value/Speed Graph and roving frames",
			},
		],
		whyItMatters: [
			{
				id: "spatial-path.why",
				publicText:
					"Arcs, swings, asymmetric turns, and controller travel stay compact and editable instead of being approximated by dense per-frame position keys.",
				source: directSpatialMotionPathsSource,
			},
		],
		limits: [
			{
				id: "spatial-path.limit",
				publicText:
					"This beta is 2D and frame-based; 3D paths, follow-path orientation, and path-based motion blur are separate capabilities.",
				source: {
					path: "docs/product-knowledge/direct-spatial-motion-paths.md",
					heading: "Still intentionally limited",
				},
			},
		],
	},
	{
		slug: "general-motion-relationships",
		category: "Motion",
		date: "2026-07-13",
		status: "beta",
		title: "Rig scattered objects with one controller",
		summary:
			"Motion controllers can now drive objects across the layer tree without regrouping them or copying the controller's keys into every child.",
		canonicalSources: [generalMotionRelationshipsSource],
		highlights: [
			{
				id: "motion-relations.keep-world",
				publicText:
					"Create and bind a controller at the current frame without making selected artwork jump, then animate it with the existing transform and keyframe workflow.",
				source: generalMotionRelationshipsSource,
			},
			{
				id: "motion-relations.delivery",
				publicText:
					"Canvas preview, SVG/PDF, Worker still export, and Motion / Code playback consume the same exact presentation-only affine result, including rotated non-uniform-scale shear.",
				source: generalMotionRelationshipsSource,
			},
		],
		workflow: [
			{
				id: "motion-relations.workflow",
				publicText:
					"Select artwork and run Create motion controller, or select existing children plus a primary controller and run Parent selection to primary controller; Inspector handles reassignment, selection jumps, and detach.",
				source: {
					path: "docs/product-knowledge/general-motion-relationships.md",
					heading: "How to use it",
				},
			},
		],
		beforeAfter: [
			{
				label: "Before",
				value:
					"Shared transform motion required structural regrouping or duplicated child keys.",
			},
			{
				label: "Now",
				value:
					"One typed controller relation drives independent objects while their layer structure and local motion stay editable.",
			},
		],
		details: [
			{ label: "Space", value: "Same-artboard affine 2D" },
			{ label: "Bind / detach", value: "Keep current world pose" },
			{
				label: "Authoring",
				value: "Command palette, Layers, Inspector, canvas",
			},
			{ label: "Delivery", value: "Shared preview and runtime sampler" },
		],
		whyItMatters: [
			{
				id: "motion-relations.why",
				publicText:
					"Character parts, logo systems, mechanical rigs, transitions, and abstract motion can share one motion hub without sacrificing z-order or editability.",
				source: generalMotionRelationshipsSource,
			},
		],
		limits: [
			{
				id: "motion-relations.limit",
				publicText:
					"This beta is same-artboard affine 2D; authored skew, weighted multi-parenting, IK, and cross-artboard controllers remain separate capabilities.",
				source: {
					path: "docs/product-knowledge/general-motion-relationships.md",
					heading: "Still intentionally limited",
				},
			},
		],
	},
	{
		slug: "agent-dot-matrix-authoring",
		category: "Authoring",
		date: "2026-07-13",
		status: "beta",
		title: "Build editable circle-cell studies from one pattern",
		summary:
			"Agent-authored circle-cell studies can now start from one bounded occupancy grid instead of a loose batch of unrelated primitives.",
		canonicalSources: [agentDotMatrixSource],
		highlights: [
			{
				id: "agent-dot-matrix.native-path",
				publicText:
					"Each active cell becomes a circular Bezier contour inside one selectable compound path, so normal scene, export, save, motion, and undo paths continue to apply.",
				source: agentDotMatrixSource,
			},
			{
				id: "agent-dot-matrix.discipline",
				publicText:
					"One occupancy pattern, cell size, gap, and appearance keep visible experiments in a coherent motif while empty cells preserve intentional negative space.",
				source: agentDotMatrixSource,
			},
		],
		workflow: [
			{
				id: "agent-dot-matrix.workflow",
				publicText:
					"An agent opens an explicit clean scene or artboard, writes a small #/. pattern, applies it with scene/append-dot-matrix, then treats the returned path id as the object for selection, transforms, and motion.",
				source: {
					path: "docs/product-knowledge/agent-dot-matrix-authoring.md",
					heading: "Agent Workflow",
				},
			},
		],
		beforeAfter: [
			{
				label: "Before",
				value:
					"Agents had only low-level primitive commands for both technical diagnostics and visible circle-cell construction.",
			},
			{
				label: "Now",
				value:
					"An explicit clean scene can receive one bounded compound-path construction with a shared circle-cell rule and internal negative space.",
			},
		],
		details: [
			{ label: "Cells", value: "Circular Bezier subpaths" },
			{ label: "Pattern", value: "Rectangular #/. occupancy grid" },
			{ label: "Limits", value: "64 × 64, up to 1,024 active cells" },
			{ label: "Mutation", value: "One scene command and undo step" },
		],
		whyItMatters: [
			{
				id: "agent-dot-matrix.why",
				publicText:
					"Constraining visible experiments to one motif and spacing law reduces accidental primitive soup without pretending to automate visual judgement.",
				source: agentDotMatrixSource,
			},
		],
		limits: [
			{
				id: "agent-dot-matrix.limit",
				publicText:
					"The command does not paint cells in the editor, vary individual cell styles, generate art direction, or issue an aesthetic pass.",
				source: {
					path: "docs/product-knowledge/agent-dot-matrix-authoring.md",
					heading: "Limits",
				},
			},
		],
	},
	{
		slug: "codex-pixel-art-objects",
		category: "Authoring",
		date: "2026-07-13",
		status: "beta",
		title: "Turn generated pixel art into editable objects",
		summary:
			"Codex can now redraw a visual reference as pixel art and insert a compact native object group through the live editor bridge.",
		canonicalSources: [aiPixelObjectImportSource],
		highlights: [
			{
				id: "pixel-objects.native-lowering",
				publicText:
					"A generated candidate becomes square-grid compound paths instead of one placed bitmap or one scene node per pixel.",
				source: aiPixelObjectImportSource,
			},
			{
				id: "pixel-objects.palette",
				publicText:
					"Palette reduction protects small chromatic accents, while disconnected same-color regions share bounded editable paths without changing indexed pixels.",
				source: aiPixelObjectImportSource,
			},
		],
		workflow: [
			{
				id: "pixel-objects.workflow",
				publicText:
					"Give Codex a reference, review the generated pixel-art candidate, validate the compact plan against an explicit live editor, and apply it as one undoable scene transaction.",
				source: {
					path: "docs/product-knowledge/ai-pixel-object-import.md",
					heading: "Operational Setup",
				},
			},
		],
		beforeAfter: [
			{
				label: "Before",
				value:
					"Generated references stayed flattened or required manual rebuilding.",
			},
			{
				label: "Now",
				value:
					"A compact indexed candidate becomes a selectable, transformable, motion-ready native group.",
			},
		],
		details: [
			{ label: "Grid", value: "Up to 128 × 128" },
			{ label: "Palette", value: "Up to 32 colors" },
			{ label: "Nodes", value: "Up to 256 region paths" },
			{ label: "Mutation", value: "One scene transaction" },
		],
		whyItMatters: [
			{
				id: "pixel-objects.why",
				publicText:
					"Existing photos, material studies, sketches, and generated references can become reusable motion carriers without rebuilding every colored cluster by hand.",
				source: aiPixelObjectImportSource,
			},
		],
		limits: [
			{
				id: "pixel-objects.limit",
				publicText:
					"V1 does not infer named body parts, linked animation cels, or a native indexed-pixel editing mode.",
				source: {
					path: "docs/product-knowledge/ai-pixel-object-import.md",
					heading: "Boundary-Test Matrix",
				},
			},
		],
	},
	{
		slug: "parallel-editor-sessions",
		category: "Workflow",
		date: "2026-07-12",
		status: "public",
		title: "Open projects in independent editors",
		summary:
			"Projects and revisions can open in isolated editor tabs with separate local recovery copies and explicit cloud writer ownership.",
		canonicalSources: [multiEditorSessionsSource],
		highlights: [
			{
				id: "multi-editor.working-copy",
				publicText:
					"Each editor restores its own scene, motion, and motion-grammar snapshot instead of sharing one browser autosave slot.",
				source: multiEditorSessionsSource,
			},
			{
				id: "multi-editor.writer",
				publicText:
					"One editor writes a cloud project at a time; other editors stay in review mode until an explicit takeover or copy save.",
				source: multiEditorSessionsSource,
			},
		],
		workflow: [
			{
				id: "multi-editor.workflow",
				publicText:
					"Choose Open new editor from Projects, keep parallel work visible in separate tabs, and use the Writer or Review control when the same cloud project is open twice.",
				source: {
					path: "docs/product-knowledge/multi-editor-sessions.md",
					heading: "User workflow",
				},
			},
		],
		beforeAfter: [
			{
				label: "Before",
				value: "Editor tabs could overwrite one local autosave slot.",
			},
			{
				label: "Now",
				value: "Every editor has an isolated, reload-stable working copy.",
			},
		],
		details: [
			{
				label: "Local recovery",
				value: "Atomic project snapshot per working copy",
			},
			{
				label: "Cloud safety",
				value: "Single writer plus revision and binding fences",
			},
			{
				label: "Agent targeting",
				value: "Explicit editor identity when multiple editors connect",
			},
		],
		whyItMatters: [
			{
				id: "multi-editor.why",
				publicText:
					"Comparison, reference, and experimental work can remain open together without serializing every check through one editor runtime.",
				source: multiEditorSessionsSource,
			},
		],
		limits: [
			{
				id: "multi-editor.limit",
				publicText:
					"Editors are independent working copies, not real-time collaborative cursors or shared live state.",
				source: {
					path: "docs/product-knowledge/multi-editor-sessions.md",
					heading: "Limits",
				},
			},
		],
	},
	{
		slug: "metadata-blind-visual-review",
		category: "Workflow",
		date: "2026-07-11",
		status: "beta",
		title: "Judge pixels before implementation facts",
		summary:
			"A detached, session-only Visual Review workspace compares a frozen Vecmo still with local reference pixels and withholds technical metadata until the critic locks a visual verdict.",
		canonicalSources: [visualReviewSource],
		highlights: [
			{
				id: "visual-review.frozen-capture",
				publicText:
					"The current artboard and frame are frozen by content revision and captured through the SVG + GPU still compositor; source changes and degraded output block the packet.",
				source: visualReviewSource,
			},
			{
				id: "visual-review.private-blind",
				publicText:
					"Local references are metadata-stripped and session-only, while randomized A/B roles and renderer facts stay hidden until verdict lock.",
				source: visualReviewSource,
			},
		],
		workflow: [
			{
				id: "visual-review.workflow",
				publicText:
					"Open Visual review, import reference pixels, capture the frozen candidate, compare Fit/100%/probe views with blink or swipe, then lock one largest visible residual before revealing technical facts.",
				source: {
					path: "docs/product-knowledge/visual-review.md",
					heading: "How To Use",
				},
			},
		],
		beforeAfter: [
			{
				label: "Before",
				value:
					"Node counts, delivery facts, implementation effort, and candidate identity could contaminate the first visual read.",
			},
			{
				label: "After",
				value:
					"The critic sees normalized pixels first and technical evidence only after committing a visible residual.",
			},
		],
		details: [
			{ label: "Views", value: "Fit, 100%, optional selected-edge probe" },
			{ label: "Compare", value: "Side by side, blink, swipe" },
			{ label: "Privacy", value: "Session-only, metadata-stripped pixels" },
			{ label: "Authority", value: "Final aesthetic acceptance remains human" },
		],
		whyItMatters: [
			{
				id: "visual-review.why",
				publicText:
					"Technical success can prove that a frame was captured correctly without being allowed to inflate the visual-quality judgement.",
				source: visualReviewSource,
			},
		],
		limits: [
			{
				id: "visual-review.limit.verification",
				publicText:
					"The workflow remains beta until browser, GPU, and 4K verification is authorized; it does not persist reviews or issue an automatic aesthetic pass.",
				source: {
					path: "docs/product-knowledge/visual-review.md",
					heading: "What Is Still Intentionally Limited?",
				},
			},
		],
	},
	{
		slug: "effect-field-authoring",
		category: "Effects",
		date: "2026-07-11",
		status: "beta",
		title: "Draw where an existing property applies",
		summary:
			"Effect Field separates reusable Contour, Linear, or Mesh geometry from the canonical property it controls, starting with object opacity, Layer blur wet mix, and Glow wet mix.",
		canonicalSources: [effectFieldSource],
		highlights: [
			{
				id: "effect-field.generic-authoring",
				publicText:
					"Inspector and the E tool author field geometry, response, and shared identity without creating an artwork-specific material or preset.",
				source: effectFieldSource,
			},
			{
				id: "effect-field.strict-routing",
				publicText:
					"Registry-owned routing rejects duplicate, unknown, and ambiguous owners instead of silently applying the first match.",
				source: effectFieldSource,
			},
		],
		workflow: [
			{
				id: "effect-field.workflow",
				publicText:
					"Select a top-level object, choose Opacity, an existing Layer blur, or an existing Glow in Inspector → Effect Field, choose Contour, Linear, or Mesh, then edit it numerically or with the E tool.",
				source: {
					path: "docs/product-knowledge/effect-field.md",
					heading: "How To Use",
				},
			},
		],
		beforeAfter: [
			{
				label: "Before",
				value:
					"Each localized effect risked inventing its own mask editor and ownership rules.",
			},
			{
				label: "After",
				value:
					"One field can be edited once and routed only to registered canonical properties.",
			},
		],
		details: [
			{ label: "Fields", value: "Contour, Linear, Mesh" },
			{
				label: "Live targets",
				value: "Opacity, Layer blur wet mix, Glow wet mix",
			},
			{
				label: "SVG fidelity",
				value: "Native routes with typed approximations",
			},
			{ label: "Authority", value: "No material preset or aesthetic score" },
		],
		whyItMatters: [
			{
				id: "effect-field.why",
				publicText:
					"Spatial control becomes reusable infrastructure while art direction remains an explicit human and critic decision.",
				source: effectFieldSource,
			},
		],
		limits: [
			{
				id: "effect-field.limit",
				publicText:
					"Standalone runtime, direct WebGL, cross-document clipboard, and 4K performance remain deferred or unverified; mask feather and stroke softness are not live targets yet.",
				source: {
					path: "docs/product-knowledge/effect-field.md",
					heading: "Fidelity And Limits",
				},
			},
		],
	},
	{
		slug: "axis-aligned-anisotropic-blur",
		category: "Effects",
		date: "2026-07-11",
		status: "beta",
		title: "Shape Gaussian blur independently on X and Y",
		summary:
			"Layer blur and Look Graph Blur can unlink X and Y radii while linked mode preserves the legacy isotropic document form.",
		canonicalSources: [anisotropicBlurSource],
		highlights: [
			{
				id: "anisotropic-blur.link",
				publicText:
					"Link X / Y switches between one isotropic radius and independent axis-aligned Gaussian radii.",
				source: anisotropicBlurSource,
			},
			{
				id: "anisotropic-blur.motion-safety",
				publicText:
					"Relinking a Look blur warns before removing its Y animation and keeps scene and motion undo coupled.",
				source: anisotropicBlurSource,
			},
		],
		workflow: [
			{
				id: "anisotropic-blur.workflow",
				publicText:
					"Enable Layer blur or add Look Graph Blur, turn off Link X / Y, and set each radius; relink to return to the single-radius representation.",
				source: {
					path: "docs/product-knowledge/axis-aligned-anisotropic-blur.md",
					heading: "How To Use",
				},
			},
		],
		beforeAfter: [
			{ label: "Before", value: "Gaussian blur used one isotropic radius." },
			{
				label: "After",
				value:
					"X and Y can be shaped independently without pretending to be arbitrary-angle motion blur.",
			},
		],
		details: [
			{ label: "Model", value: "radius = X, optional radiusY = Y" },
			{ label: "Render", value: "SVG feGaussianBlur x y" },
			{ label: "Link", value: "Omitted Y preserves legacy isotropic data" },
			{ label: "Scope", value: "Layer blur and Look Graph Blur" },
		],
		whyItMatters: [
			{
				id: "anisotropic-blur.why",
				publicText:
					"A controllable asymmetric softness primitive adds material range while keeping the feature's optical claim precise.",
				source: anisotropicBlurSource,
			},
		],
		limits: [
			{
				id: "anisotropic-blur.limit",
				publicText:
					"The blur axis cannot rotate, background blur has no independent Y radius, and browser/export parity smoke remains unverified.",
				source: {
					path: "docs/product-knowledge/axis-aligned-anisotropic-blur.md",
					heading: "Limits",
				},
			},
		],
	},
	{
		slug: "motion-code-runtime-integration",
		category: "Motion",
		date: "2026-07-13",
		status: "beta",
		title: "One player contract across camera, sequence, and WebGL",
		summary:
			"Motion / Code exports now keep one host timeline and one camera-aware player API across SVG, WebGL, and scene-sequence playback.",
		canonicalSources: [motionCodeRuntimeSource],
		highlights: [
			{
				id: "motion-code-runtime.frame-scope",
				publicText:
					"Committed snapshots and sampled events identify both the global player frame and the active scene-sequence item, artboard, and local frame.",
				source: motionCodeRuntimeSource,
			},
			{
				id: "motion-code-runtime.renderer-parity",
				publicText:
					"Adding a GPU effect changes the renderer without changing mount, camera, hook, request-status, or cleanup semantics.",
				source: {
					path: "docs/product-knowledge/webgl-player-export.md",
					heading: "What Users Can Do Now",
				},
			},
			{
				id: "motion-code-runtime.compound-paths",
				publicText:
					"Compound paths keep every disjoint contour and hole in SVG runtime playback instead of collapsing to the first shape.",
				source: motionCodeRuntimeSource,
			},
		],
		workflow: [
			{
				id: "motion-code-runtime.workflow",
				publicText:
					"Export Motion / Code, await mountVectorMotion(), then drive seekFrame(), seekProgress(), or progress and read the committed camera and frame scope from the same player.",
				source: motionCodeRuntimeSource,
			},
		],
		beforeAfter: [
			{
				label: "Before",
				value:
					"Scene sequences and GPU-selected output could expose different player and React integration behavior.",
			},
			{
				label: "After",
				value:
					"SVG and WebGL exports share one async mount contract, one global timeline, and one generated React lifecycle.",
			},
		],
		details: [
			{ label: "Player API", value: "Runtime manifest contract v2" },
			{ label: "Path fidelity", value: "Compound contours and fill rules" },
			{
				label: "Sequence timing",
				value: "Global host frame plus active-artboard local frame",
			},
			{
				label: "React updates",
				value: "Latest callbacks and mutable controls without player remount",
			},
		],
		whyItMatters: [
			{
				id: "motion-code-runtime.why.integration",
				publicText:
					"Host applications can integrate camera-aware motion once and keep that code when a project adds scene cuts or GPU-only visual effects.",
				source: motionCodeRuntimeSource,
			},
		],
		limits: [
			{
				id: "motion-code-runtime.limit.interactions",
				publicText:
					"Authored interaction clips remain disabled during scene-sequence playback because those clip windows are artboard-local.",
				source: {
					path: "docs/product-knowledge/motion-code-runtime-export.md",
					heading: "What Is Still Intentionally Limited",
				},
			},
		],
	},
	{
		slug: "editor-new-project",
		category: "Workspace",
		date: "2026-07-03",
		status: "public",
		title: "New project is visible in the editor",
		summary:
			"Start a blank editable project from the top-left editor chrome or the Cloud projects popover, with the existing save/backup guard still protecting current work.",
		canonicalSources: [editorNewProjectSource],
		highlights: [
			{
				id: "editor-new-project.top-bar",
				publicText:
					"The top-left editor chrome now shows a labeled New project action beside the document chip on desktop, instead of relying on an unlabeled plus icon.",
				source: editorNewProjectSource,
			},
			{
				id: "editor-new-project.cloud-menu",
				publicText:
					"The Cloud projects popover also includes Projects > New project, so the creation path is available from the same place users browse saved projects.",
				source: {
					path: "docs/product-knowledge/editor-new-project.md",
					heading: "How does the user operate it?",
				},
			},
		],
		workflow: [
			{
				id: "editor-new-project.workflow",
				publicText:
					"Click New project in the top-left chrome, or open Cloud projects and choose Projects > New project.",
				source: {
					path: "docs/product-knowledge/editor-new-project.md",
					heading: "How does the user operate it?",
				},
			},
		],
		beforeAfter: [
			{
				label: "Before",
				value:
					"Starting fresh depended on recognizing an icon-only plus button or leaving the editor for project management.",
			},
			{
				label: "After",
				value:
					"New project is named directly in the editor chrome and repeated inside the project popover.",
			},
		],
		details: [
			{ label: "Surface", value: "Top-left editor chrome" },
			{ label: "Secondary path", value: "Cloud projects > Projects" },
			{
				label: "Protection",
				value:
					"Uses the existing replacement guard for unsaved cloud work and local-only documents",
			},
		],
		whyItMatters: [
			{
				id: "editor-new-project.why.core-flow",
				publicText:
					"Creating a new document is a core editor workflow, so it now appears as a named action where users start working.",
				source: editorNewProjectSource,
			},
		],
		limits: [
			{
				id: "editor-new-project.limit.templates",
				publicText:
					"New project still starts from the standard blank document; template selection and multiple local document slots are not part of this update.",
				source: {
					path: "docs/product-knowledge/editor-new-project.md",
					heading: "What is still intentionally limited?",
				},
			},
		],
	},
	{
		slug: "grid-bento-layout-authoring",
		category: "Authoring",
		date: "2026-07-02",
		status: "beta",
		title: "Grid and bento layouts",
		summary:
			"Wrap selected objects or same-parent children into an editable grid layout frame, tune columns, rows, gaps, padding, bento presets, child Fit/Fill modes, nested cell hosts, and responsive variants with automatic width breakpoints, and drive the same edits through MCP.",
		canonicalSources: [gridBentoLayoutSource],
		highlights: [
			{
				id: "grid-bento.layout-frame",
				publicText:
					"Wrap in grid layout turns selected top-level objects or same-parent children into a frame that stores grid layout intent and materializes children into cells.",
				source: gridBentoLayoutSource,
			},
			{
				id: "grid-bento.inspector",
				publicText:
					"Selecting a frame exposes grid enablement; selecting a layout frame exposes compact Inspector controls for Auto/Base/variant mode, width breakpoints, flow, columns, rows, gaps, padding, presets, intentional overlap, cell clearing, span-preserving cell packing, and reapply. Auto mode highlights and edits the width-resolved variant target when one matches; otherwise the base layout remains the edit target without forcing manual selection. Selecting a layout child exposes cell position, span, and Fit/Fill controls, and deeper descendants expose Cell Host controls for the direct layout-managed item.",
				source: gridBentoLayoutSource,
			},
			{
				id: "grid-bento.overlay",
				publicText:
					"Selecting a layout frame, one of its direct children, or a descendant inside a layout-managed item shows a canvas grid overlay with edge and corner span handles; multi-selection keeps handles on the primary host, highlights the other selected cells, moves selected host cells together when the primary body is dragged, resizes selected host cells together when a primary span handle is dragged, clamps new selected-cell overlaps unless Overlap is enabled, outlines existing selected-cell conflicts, and writes source layout intent rather than motion-sampled presentation geometry.",
				source: gridBentoLayoutSource,
			},
			{
				id: "grid-bento.select-tool-drag",
				publicText:
					"Dragging a layout-managed child with the Select tool moves its cell placement in the same gesture that selects it, even when it was not already selected, and preserves the child's authored rotation instead of snapping it upright.",
				source: gridBentoLayoutSource,
			},
			{
				id: "grid-bento.select-tool-nudge",
				publicText:
					"Arrow keys move a selected layout-managed child one cell per press, Shift included, clamped to the grid with the same auto-row downward growth a drag allows.",
				source: gridBentoLayoutSource,
			},
		],
		workflow: [
			{
				id: "grid-bento.workflow",
				publicText:
					"Select sibling objects, run Wrap in grid layout from the action surface, then refine the selected layout frame in the Inspector.",
				source: gridBentoLayoutSource,
			},
		],
		beforeAfter: [
			{
				label: "Before",
				value:
					"Bento compositions required manually resizing and aligning every object.",
			},
			{
				label: "After",
				value:
					"A single layout frame records the grid intent and rearranges children through undoable scene commands.",
			},
		],
		details: [
			{ label: "Presets", value: "Uniform, Hero Left, Hero Top, Mosaic" },
			{
				label: "MCP",
				value:
					"`apply_scene_commands` layout frame commands, including `parentNodeId`, allowOverlap, single or batch child placement `fit`, pack layout frame, same-batch create-then-edit, reapply, `observe_document`/`run_validation` layout health, and `list_layers` source/expected bounds drift metadata",
			},
			{
				label: "Placement",
				value:
					"Zero-based cells with span counts, Fit/Fill modes, and Cell Host editing for nested descendants",
			},
			{
				label: "Motion",
				value:
					"Canvas, export, and generated runtimes use the resolved layout as the motion rest scene; x/y keyframes ride on the current cell while other sampled motion composes over it",
			},
		],
		whyItMatters: [
			{
				id: "grid-bento.why.structure",
				publicText:
					"Grid and bento frames make structured dashboard, gallery, and composition layouts reachable without leaving the vector editor.",
				source: gridBentoLayoutSource,
			},
		],
		limits: [
			{
				id: "grid-bento.limit.handles",
				publicText:
					"Responsive variants use frame-width breakpoints, nested creation is same-parent only, and canvas/export presentation resolves stored layout intent without mutating the source document.",
				source: gridBentoLayoutSource,
			},
			{
				id: "grid-bento.limit.materialization",
				publicText:
					"Layout-managed box content is materialized as axis-aligned cells when unrotated; a rotated box child and every non-box vector instead use the authored cell fit mode, which preserves rotation.",
				source: gridBentoLayoutSource,
			},
		],
	},
	{
		slug: "repeat-transform",
		category: "Authoring",
		date: "2026-07-02",
		status: "public",
		title: "Transform again",
		summary:
			"Repeat the last committed object transform or duplicate spacing from the command palette, canvas menu, or Mod+D.",
		canonicalSources: [repeatTransformSource],
		highlights: [
			{
				id: "repeat-transform.memory",
				publicText:
					"Vecmo remembers the last committed move, rotate, resize, nudge, flip, Inspector transform edit, or duplicate spacing as a session-only Transform again operation.",
				source: repeatTransformSource,
			},
			{
				id: "repeat-transform.duplicate",
				publicText:
					"Duplicating a selection seeds a repeatable duplicate-transform, so repeated Transform again commands create evenly spaced copies from the newest selected copy.",
				source: repeatTransformSource,
			},
		],
		workflow: [
			{
				id: "repeat-transform.workflow",
				publicText:
					"Select objects, transform or duplicate once, then run Transform again from Mod+D, the command palette, or the canvas menu.",
				source: repeatTransformSource,
			},
		],
		beforeAfter: [
			{
				label: "Before",
				value:
					"Repeated spacing or repeated rotations required manual duplicate and transform steps.",
			},
			{
				label: "After",
				value:
					"One shortcut chains the same transform or duplicate spacing as a single undoable edit per repeat.",
			},
		],
		details: [
			{ label: "Shortcut", value: "Mod+D" },
			{
				label: "Duplicate entry points",
				value: "Command palette, canvas/layer menus, selection quick action",
			},
			{ label: "Surfaces", value: "Command palette and canvas menu" },
		],
		whyItMatters: [
			{
				id: "repeat-transform.why.patterns",
				publicText:
					"Step-and-repeat is a core vector-authoring workflow for grids, radial arrangements, repeated offsets, and quick layout exploration.",
				source: repeatTransformSource,
			},
		],
		limits: [
			{
				id: "repeat-transform.limit.option-drag",
				publicText:
					"Direct Option-drag duplicate is not wired yet; repeatable duplicate spacing starts from Duplicate selection.",
				source: repeatTransformSource,
			},
		],
	},
	{
		slug: "blend-tool",
		category: "Authoring",
		date: "2026-07-01",
		status: "beta",
		title: "Blend tool",
		summary:
			"Blend creates Illustrator-style intermediate vector objects between two or more compatible sources, with ordered source stops, sampled path morphing, replaceable spines, and generated step children.",
		canonicalSources: [blendToolSource],
		highlights: [
			{
				id: "blend-tool.tool",
				publicText:
					"The ToolRail and `W` shortcut expose Blend; select two or more compatible objects and press Make, click a source and target on the canvas, or append another source by clicking it while a Blend is selected.",
				source: blendToolSource,
			},
			{
				id: "blend-tool.attachment",
				publicText:
					"Clicking a specific anchor or endpoint registers that point as the source's Blend attachment, so default spines, generated step placement, spine orientation, endpoint drags, and closed-contour morph correspondence run anchor-to-anchor; body clicks keep Illustrator's center registration.",
				source: blendToolSource,
			},
			{
				id: "blend-tool.stops",
				publicText:
					"Blend stops are editable in place: clicking a new source inserts it where its registration point projects onto the spine, and the Stops row reorders or removes stops without releasing the Blend — removed objects return to the layer untouched.",
				source: blendToolSource,
			},
			{
				id: "blend-tool.morph-quality",
				publicText:
					"Sampled morphs between closed shapes align winding direction and either the clicked source anchors or the best sampling seam before interpolating, so star-to-circle blends rotate cleanly and anchor-to-anchor circle blends can pinch instead of turning into center-based capsules.",
				source: blendToolSource,
			},
			{
				id: "blend-tool.compound-paths",
				publicText:
					"Compound paths blend: outer contours morph into each other, holes pair up by position (a donut blends into a donut), and a hole with no partner closes or opens in place instead of snapping away.",
				source: blendToolSource,
			},
			{
				id: "blend-tool.gradient-stops",
				publicText:
					"Gradients with different stop counts now blend smoothly: both ramps are resampled at the union of their stop offsets, so a two-stop fill tweens into a five-stop rainbow without snapping halfway. Solid fills blending against a gradient are promoted to a flat gradient first, so the ramp fades in gradually.",
				source: blendToolSource,
			},
			{
				id: "blend-tool.structure",
				publicText:
					"Blend stores a normal scene container with editable source-stop children and locked generated intermediate children, so Layers can show the relationship directly.",
				source: blendToolSource,
			},
			{
				id: "blend-tool.spacing",
				publicText:
					"The Blend options strip supports specified steps, specified distance, and smooth color spacing, matching the core Illustrator blend modes.",
				source: blendToolSource,
			},
			{
				id: "blend-tool.spine",
				publicText:
					"Select a Blend plus a same-layer line, path, or shape to replace the spine; generated steps can stay page-oriented or align to the spine tangent, and the selected Blend spine can be reshaped and sub-selected on canvas.",
				source: blendToolSource,
			},
			{
				id: "blend-tool.stacking",
				publicText:
					"Reverse and Front/Back controls separate interpolation direction from paint stacking order, matching the two core Illustrator Blend reversals.",
				source: blendToolSource,
			},
			{
				id: "blend-tool.presentation",
				publicText:
					"Canvas and export presentation regenerate Blend steps from ordered source-stop children and the authored spine, keeping rendered output current after source or spine edits.",
				source: blendToolSource,
			},
		],
		workflow: [
			{
				id: "blend-tool.workflow.make",
				publicText:
					"Select two or more compatible top-level vector objects, switch to Blend, and press Make in the tool options strip.",
				source: blendToolSource,
			},
			{
				id: "blend-tool.workflow.click",
				publicText:
					"With Blend active, click the first object and then the second object to create the relationship from the canvas; with that Blend selected, click another compatible object to append it as the next stop.",
				source: blendToolSource,
			},
			{
				id: "blend-tool.workflow.manage",
				publicText:
					"Use the Blend options strip to switch spacing mode, edit spacing values, orient to page or spine, replace or clear the spine, click straight or path spine segments to insert anchors, drag spine endpoints/anchors/segments/handles on canvas, delete valid selected spine anchors, reset selected spine handles, reverse the source-stop order or front/back paint order, expand the generated result, or release the relationship back to source stops.",
				source: blendToolSource,
			},
		],
		beforeAfter: [
			{
				label: "Before",
				value:
					"Users had to duplicate and manually interpolate objects one by one.",
			},
			{
				label: "After",
				value:
					"One Blend relationship creates the in-between objects and keeps the source-stop-driven result visible in canvas and export presentation.",
			},
		],
		details: [
			{ label: "Shortcut", value: "W" },
			{ label: "Status", value: "Beta" },
			{
				label: "Spacing UI",
				value: "Specified steps, specified distance, smooth color",
			},
			{ label: "Spine", value: "Replaceable and directly editable" },
			{
				label: "Layer role",
				value: "Blend container with source stops and generated steps",
			},
		],
		whyItMatters: [
			{
				id: "blend-tool.why.authoring",
				publicText:
					"Intermediate objects are a core vector-authoring operation, so Blend moves repeated shape transitions out of manual duplication.",
				source: blendToolSource,
			},
			{
				id: "blend-tool.why.structure",
				publicText:
					"Keeping source stops inside a typed scene container gives future motion/export work a real authoring relationship instead of anonymous duplicated shapes.",
				source: blendToolSource,
			},
		],
		limits: [
			{
				id: "blend-tool.limit.compatibility",
				publicText:
					"Blend currently accepts two or more visible, unlocked, same-layer, same-artboard leaf vector sources; mixed primitive and mismatched simple path spans generate sampled path-morph intermediates.",
				source: blendToolSource,
			},
			{
				id: "blend-tool.limit.spine",
				publicText:
					"Arbitrary stop insertion/reordering, compound paths, text, images, effects, vec-core looks, mesh paints, and image-reference paints remain outside this beta slice.",
				source: blendToolSource,
			},
		],
	},
	{
		slug: "noise-gradient-tool-particle-dissolve",
		category: "Authoring",
		date: "2026-06-29",
		status: "public",
		title: "Noise Gradient gets a canvas tool",
		summary:
			"Noise Gradient can now be steered directly on the canvas, with an Open Graph path for advanced object-scoped node editing.",
		canonicalSources: [noiseGradientSource, lookGraphParticleDissolveSource],
		highlights: [
			{
				id: "noise-gradient-tool.axis",
				publicText:
					"The ToolRail and `N` shortcut expose a Noise Gradient Tool that previews direct controls without mutating the document.",
				source: noiseGradientSource,
			},
			{
				id: "noise-gradient-tool.drag",
				publicText:
					"Circular follows the object's contour, Linear shows draggable field-line endpoints plus center/whole-field move, Option symmetric resize, invert, fit, direction cue, Shift snapping, and matching Inspector endpoint/invert/fit controls, Field Mesh exposes editable density points, the diamond handle adjusts Extent, and the first edit enables the effect in the same undo step if needed.",
				source: noiseGradientSource,
			},
			{
				id: "noise-gradient-tool.object-graph",
				publicText:
					"Open Graph converts or reuses the selected object's scoped Noise Gradient graph, while Open Existing Graph opens any scoped graph that already owns that object.",
				source: noiseGradientSource,
			},
			{
				id: "noise-gradient-tool.graph-preset",
				publicText:
					"Look Graph now separates Film Grain from Particle Dissolve, with Particle Dissolve sharing the same Circular, Linear, and Field Mesh lowering instead of silently becoming plain grain.",
				source: lookGraphParticleDissolveSource,
			},
		],
		workflow: [
			{
				id: "noise-gradient-tool.workflow.select",
				publicText:
					"Select an object, then press `N` or choose Noise Gradient.",
				source: noiseGradientSource,
			},
			{
				id: "noise-gradient-tool.workflow.drag",
				publicText:
					"Use Circular for contour dissolve, switch to Linear to drag endpoints, Option-resize symmetrically, or move/invert/fit the field, switch to Mesh to drag density points or scrub selected-point Density, drag the diamond handle for Extent, and use Inspector for Softness, Motion, endpoint precision, and presets.",
				source: noiseGradientSource,
			},
			{
				id: "noise-gradient-tool.workflow.graph",
				publicText:
					"Press Open Graph or Open Existing Graph in the Noise Gradient tool strip for object-scoped node editing, or add Particle Dissolve from Starter for a frame-pixel dissolve node.",
				source: noiseGradientSource,
			},
		],
		beforeAfter: [
			{
				label: "Before",
				value:
					"Noise Gradient field shape and direction were mixed into an Inspector angle workflow, and graph texture mode could collapse particle intent into film grain.",
			},
			{
				label: "After",
				value:
					"Object Noise Gradient has non-mutating canvas controls, an Extent handle, editable Field Mesh density points, a compact exact-value strip, and Open Graph / Open Existing Graph routes into object-scoped node editing.",
			},
		],
		details: [
			{ label: "Shortcut", value: "N" },
			{
				label: "Object workflow",
				value: "Noise Gradient Tool + Open Graph / Open Existing Graph",
			},
			{
				label: "Graph workflow",
				value: "Starter -> Particle Dissolve",
			},
			{ label: "Export tier", value: "SVG-filter approximation" },
		],
		whyItMatters: [
			{
				id: "noise-gradient-tool.why.direct",
				publicText:
					"Field shape, direction, and reach are spatial choices, so aiming them on the artwork stays fast while Open Graph remains the explicit advanced path.",
				source: noiseGradientSource,
			},
			{
				id: "noise-gradient-tool.why.scope",
				publicText:
					"Object Noise Gradient and frame Look Graph Particle Dissolve stay separate scopes while sharing the same render semantics.",
				source: lookGraphParticleDissolveSource,
			},
		],
		limits: [
			{
				id: "noise-gradient-tool.limit.object-material",
				publicText:
					"Open Graph is tool-entered for selected-object Noise Gradient; the workspace does not yet have a general browser for every arbitrary scoped overlay.",
				source: noiseGradientSource,
			},
			{
				id: "noise-gradient-tool.limit.raster",
				publicText:
					"WebM and sequence raster capture keep the particle dissolve visible and preserve Linear and Field Mesh density fields; PDF reports Noise Gradient as requiring a future local-raster tier, and high-fidelity particle character remains a later renderer upgrade.",
				source: noiseGradientSource,
			},
		],
	},
	{
		slug: "project-backup-motion-grammar-bindings",
		category: "Productivity",
		date: "2026-06-23",
		status: "public",
		title: "Project backups restore motion systems",
		summary:
			"Backup files now include motion-grammar bindings, so Time Delay and other semantic motion systems reopen with their live behavior.",
		canonicalSources: [
			projectBackupSource,
			{
				path: "docs/project-backup-motion-grammar-sidecar-plan.md",
				heading: "Direction",
			},
		],
		highlights: [
			{
				id: "project-backup.grammar",
				publicText:
					"Top-bar Backup now saves scene, motion, and motion-grammar bindings in one JSON file.",
				source: projectBackupSource,
			},
			{
				id: "project-backup.restore-full",
				publicText:
					"Full backup restore replaces scene, motion, and grammar bindings together.",
				source: projectBackupSource,
			},
			{
				id: "project-backup.legacy-time-delay",
				publicText:
					"Older Time Delay master-instance backup captures can be imported and recover their grammar binding plus the missing Analog Film frame look.",
				source: projectBackupSource,
			},
		],
		workflow: [
			{
				id: "project-backup.workflow.save",
				publicText:
					"Click `Backup` in the top bar to download the project JSON.",
				source: projectBackupSource,
			},
			{
				id: "project-backup.workflow.restore",
				publicText:
					"Click `Import` and choose a backup JSON to restore the project.",
				source: projectBackupSource,
			},
			{
				id: "project-backup.workflow.scrub",
				publicText:
					"After restoring a motion-system backup, scrub or play the Timeline to see the live grammar behavior.",
				source: projectBackupSource,
			},
		],
		beforeAfter: [
			{
				label: "Before",
				value:
					"Project backup restored scene and motion but could leave grammar-driven motion systems inert.",
			},
			{
				label: "After",
				value:
					"Grammar bindings round-trip with the backup, and legacy Time Delay captures regain their film grain and color-fringe look.",
			},
		],
		details: [
			{ label: "Format", value: "Project backup JSON" },
			{ label: "Included side-cars", value: "Scene, motion, grammar" },
			{ label: "Legacy reader", value: "Time Delay master-instances capture" },
			{ label: "Entry point", value: "Top-bar Import / Backup" },
		],
		whyItMatters: [
			{
				id: "project-backup.why.motion-systems",
				publicText:
					"Semantic motion systems are authored as project state, so portable backups must carry their bindings too.",
				source: {
					path: "docs/project-backup-motion-grammar-sidecar-plan.md",
					heading: "Problem",
				},
			},
			{
				id: "project-backup.why.offline",
				publicText:
					"The offline backup path remains useful even without account or cloud sync.",
				source: projectBackupSource,
			},
		],
		limits: [
			{
				id: "project-backup.limit.scene-only",
				publicText:
					"Scene-only JSON imports still preserve the current motion and grammar side-cars.",
				source: projectBackupSource,
			},
			{
				id: "project-backup.limit.materialization",
				publicText:
					"Baking grammar into ordinary scene and keyframe data remains a separate motion-grammar materialization milestone.",
				source: {
					path: "docs/project-backup-motion-grammar-sidecar-plan.md",
					heading: "Follow-Up",
				},
			},
		],
	},
	{
		slug: "time-delay-motion-system",
		category: "Motion",
		date: "2026-06-22",
		status: "public",
		title: "Time Delay motion system",
		summary:
			"Time Delay is now authored as one semantic motion clip while master objects stay editable on the workspace, and its Analog Film finish carries into still export.",
		canonicalSources: [
			timeDelaySource,
			{
				path: "docs/motion-workspace-materialization-contract.md",
				heading: "Fixed Intent",
			},
			{
				path: "docs/motion-system-clip-editor-plan.md",
				heading: "Fixed Product Understanding",
			},
		],
		highlights: [
			{
				id: "time-delay.clip-entry",
				publicText:
					"`Time Delay expansion` is the Timeline entry for the whole motion system.",
				source: timeDelaySource,
			},
			{
				id: "time-delay.master-objects",
				publicText:
					"Master objects can be selected from the clip Inspector and edited as normal scene objects.",
				source: {
					path: "docs/product-knowledge/time-delay-motion-system.md",
					heading: "Inspector Behavior",
				},
			},
			{
				id: "time-delay.clip-timing",
				publicText:
					"Clip duration and period frames stay aligned while editing in clip mode.",
				source: {
					path: "docs/product-knowledge/time-delay-motion-system.md",
					heading: "How To Use",
				},
			},
			{
				id: "time-delay.trackless",
				publicText:
					"The default authoring model stays trackless, avoiding per-dot X/Y/Scale keyframe rows.",
				source: {
					path: "docs/product-knowledge/time-delay-motion-system.md",
					heading: "Timeline Behavior",
				},
			},
			{
				id: "time-delay.export-film-look",
				publicText:
					"SVG and PNG-derived still output preserve the frame-level Analog Film grain, grade, and chromatic edge.",
				source: {
					path: "docs/product-knowledge/time-delay-motion-system.md",
					heading: "What Users Can Do Now",
				},
			},
		],
		workflow: [
			{
				id: "time-delay.workflow.select-clip",
				publicText: "Select `Time Delay expansion` in the Timeline.",
				source: {
					path: "docs/product-knowledge/time-delay-motion-system.md",
					heading: "How To Use",
				},
			},
			{
				id: "time-delay.workflow.retime",
				publicText:
					"Edit `Start`, `Duration`, and Time Delay parameters in Inspector.",
				source: {
					path: "docs/product-knowledge/time-delay-motion-system.md",
					heading: "Inspector Behavior",
				},
			},
			{
				id: "time-delay.workflow.master",
				publicText:
					"Use `Master objects -> Select` when you need to restyle or replace the source objects.",
				source: {
					path: "docs/product-knowledge/time-delay-motion-system.md",
					heading: "How To Use",
				},
			},
			{
				id: "time-delay.workflow.scrub",
				publicText:
					"Scrub or play the Timeline to review the delayed generated motion.",
				source: {
					path: "docs/product-knowledge/time-delay-motion-system.md",
					heading: "What Users Can Do Now",
				},
			},
		],
		beforeAfter: [
			{
				label: "Before",
				value:
					"Delay behavior read like many object-level scalar rows or preview-only output.",
			},
			{
				label: "After",
				value:
					"One motion-system clip controls timing; master objects remain normal editable scene nodes, and exported stills keep the film finish.",
			},
		],
		details: [
			{ label: "Scope", value: "Time Delay motion-system authoring" },
			{ label: "Timeline", value: "Trackless expression clip" },
			{ label: "Editable objects", value: "5 bound master objects" },
			{ label: "Generated result", value: "10 profile components" },
			{ label: "Still export", value: "Analog Film SVG-filter approximation" },
			{ label: "Primary controls", value: "Start, Duration, Period, Stagger" },
			{ label: "Manual check", value: "Clip mode, master selection, scrub" },
		],
		whyItMatters: [
			{
				id: "time-delay.why.noise",
				publicText:
					"Users can reason about a motion system without scanning repeated keyframe rows.",
				source: {
					path: "docs/product-knowledge/time-delay-motion-system.md",
					heading: "Timeline Behavior",
				},
			},
			{
				id: "time-delay.why.objects",
				publicText:
					"Visual design stays object-first: color, shape, and vec-core look are edited on real workspace objects.",
				source: {
					path: "docs/product-knowledge/time-delay-motion-system.md",
					heading: "What Users Can Do Now",
				},
			},
			{
				id: "time-delay.why.export",
				publicText:
					"The same semantic motion model drives live scrubbing and future materialization paths.",
				source: {
					path: "docs/motion-workspace-materialization-contract.md",
					heading: "Architecture Rules",
				},
			},
		],
		limits: [
			{
				id: "time-delay.limit.one-technique",
				publicText:
					"This hardened public entry currently covers Time Delay; other grammar techniques will get equivalent entries as their authoring surfaces mature.",
				source: {
					path: "docs/product-knowledge/time-delay-motion-system.md",
					heading: "Known Limits",
				},
			},
			{
				id: "time-delay.limit.bake",
				publicText:
					"Full scalar keyframe editing is intentionally behind explicit bake/materialization.",
				source: {
					path: "docs/product-knowledge/time-delay-motion-system.md",
					heading: "Known Limits",
				},
			},
		],
	},
	{
		slug: "afterimage-motion-system",
		category: "Motion",
		date: "2026-06-22",
		status: "beta",
		title: "Afterimage motion system",
		summary:
			"Afterimage is being tuned as a Glammer Master Rotation Echo profile with editable orbit dots and runtime echo artifacts.",
		canonicalSources: [
			afterimageSource,
			{
				path: "docs/motion-system-clip-editor-plan.md",
				heading: "Fixed Product Understanding",
			},
			{
				path: "docs/motion-workspace-materialization-contract.md",
				heading: "Architecture Rules",
			},
		],
		highlights: [
			{
				id: "afterimage.clip-entry",
				publicText:
					"`Afterimage` is the Timeline entry for the Master Rotation Echo motion system.",
				source: afterimageSource,
			},
			{
				id: "afterimage.presentation-duplicates",
				publicText:
					"Runtime echo tails are presentation artifacts; the two orbit dots remain the real editable scene objects.",
				source: afterimageSource,
			},
			{
				id: "afterimage.clip-timing",
				publicText:
					"Clip `Start` and `Duration` are edited from the selected clip, and the clip range stays aligned to the echo period.",
				source: {
					path: "docs/product-knowledge/afterimage-motion-system.md",
					heading: "What Users Can Do Now",
				},
			},
			{
				id: "afterimage.clip-local-time",
				publicText:
					"Echoes use clip-local time, and the live duplicates are inactive outside the clip range.",
				source: {
					path: "docs/product-knowledge/afterimage-motion-system.md",
					heading: "What Users Can Do Now",
				},
			},
		],
		workflow: [
			{
				id: "afterimage.workflow.create",
				publicText:
					"Create an `Afterimage` system from the Inspector Motion section.",
				source: {
					path: "docs/product-knowledge/afterimage-motion-system.md",
					heading: "What Users Can Do Now",
				},
			},
			{
				id: "afterimage.workflow.select-clip",
				publicText: "Select the `Afterimage` clip in the Timeline.",
				source: {
					path: "docs/product-knowledge/afterimage-motion-system.md",
					heading: "What Users Can Do Now",
				},
			},
			{
				id: "afterimage.workflow.retime",
				publicText:
					"Edit `Start`, `Duration`, and profile parameters such as loop frames, sweep frames, echo delay, tail copies, fade, orbit radius, dot radius, and easing.",
				source: {
					path: "docs/product-knowledge/afterimage-motion-system.md",
					heading: "Summary",
				},
			},
			{
				id: "afterimage.workflow.source",
				publicText:
					"Use `Source objects -> Select` to jump from the clip back to the real editable orbit dots.",
				source: {
					path: "docs/product-knowledge/afterimage-motion-system.md",
					heading: "What Users Can Do Now",
				},
			},
		],
		beforeAfter: [
			{
				label: "Before",
				value:
					"Afterimage read like a generic grammar parameter set or preview-only output.",
			},
			{
				label: "After",
				value:
					"One motion-system clip controls the circular master rotation profile; orbit dots remain normal editable scene nodes.",
			},
		],
		details: [
			{ label: "Scope", value: "Afterimage Master Rotation Echo authoring" },
			{ label: "Timeline", value: "Trackless motion-system clip" },
			{ label: "Editable objects", value: "2 real orbit dots in Layers" },
			{
				label: "Generated result",
				value: "Runtime circular echo tails",
			},
			{
				label: "Primary controls",
				value: "Start, Duration, Loop, Sweep, Delay, Tail, Orbit, Ease",
			},
			{
				label: "Manual check",
				value: "Clip mode, source selection, circular tail visual parity",
			},
		],
		whyItMatters: [
			{
				id: "afterimage.why.noise",
				publicText:
					"Users reason about an echo system without scanning a keyframe row per duplicate.",
				source: {
					path: "docs/product-knowledge/afterimage-motion-system.md",
					heading: "Summary",
				},
			},
			{
				id: "afterimage.why.objects",
				publicText:
					"Visual design stays object-first: color, shape, and look are edited on the real source objects.",
				source: {
					path: "docs/product-knowledge/afterimage-motion-system.md",
					heading: "What Users Can Do Now",
				},
			},
		],
		limits: [
			{
				id: "afterimage.limit.bake",
				publicText:
					"Echoes remain live presentation duplicates by default; explicit bake is the path to materialized clone nodes and scalar tracks.",
				source: {
					path: "docs/product-knowledge/afterimage-motion-system.md",
					heading: "Known Limits",
				},
			},
			{
				id: "afterimage.limit.shared-contract",
				publicText:
					"Afterimage remains beta until browser visual smoke proves the same circular rotating dot shape and tail behavior as the Glammer reference.",
				source: {
					path: "docs/product-knowledge/afterimage-motion-system.md",
					heading: "Known Limits",
				},
			},
		],
	},
	{
		slug: "timeline-mode-workspace",
		category: "Workspace",
		date: "2026-06-22",
		status: "public",
		title: "Timeline workspace mode",
		summary:
			"Working the timeline seriously now has a dedicated docked mode: a tall, full-width, resizable timeline that reserves its own space so panels never overlap the motion surface.",
		canonicalSources: [
			timelineWorkspaceSource,
			{
				path: "docs/timeline-mode-spec.md",
				heading:
					"Decided architecture (frozen — design the HOW, not the WHETHER)",
			},
		],
		highlights: [
			{
				id: "timeline-mode.dock",
				publicText:
					"A maximize button docks the timeline full-width and reserves space, so the layers, inspector, and tool rail clear it with no overlap.",
				source: timelineWorkspaceSource,
			},
			{
				id: "timeline-mode.resizable",
				publicText:
					"Drag the divider at the top edge to resize the docked height; the height persists across reloads.",
				source: {
					path: "docs/product-knowledge/timeline-motion-workspace.md",
					heading: "How does the user operate it?",
				},
			},
			{
				id: "timeline-mode.canvas-visible",
				publicText:
					"The canvas camera stays fixed when you show, hide, expand, restore, or resize the timeline; use Fit when you want the artboard centered in the remaining workspace.",
				source: timelineWorkspaceSource,
			},
			{
				id: "timeline-mode.peek-preserved",
				publicText:
					"The compact peek timeline is untouched; the mode is opt-in, so quick scrubs never trigger the big layout.",
				source: {
					path: "docs/product-knowledge/timeline-motion-workspace.md",
					heading: "What can the user do now?",
				},
			},
		],
		workflow: [
			{
				id: "timeline-mode.workflow.enter",
				publicText:
					"Click the expand icon just right of the `Timeline` label in the timeline header to enter the mode (it also reveals the timeline if hidden).",
				source: {
					path: "docs/product-knowledge/timeline-motion-workspace.md",
					heading: "How does the user operate it?",
				},
			},
			{
				id: "timeline-mode.workflow.resize",
				publicText:
					"Drag the divider at the top edge of the dock to set a comfortable height; it is keyboard-operable when focused.",
				source: {
					path: "docs/product-knowledge/timeline-motion-workspace.md",
					heading: "How does the user operate it?",
				},
			},
			{
				id: "timeline-mode.workflow.reset",
				publicText: "Double-click the divider to reset to the default height.",
				source: {
					path: "docs/product-knowledge/timeline-motion-workspace.md",
					heading: "How does the user operate it?",
				},
			},
			{
				id: "timeline-mode.workflow.exit",
				publicText:
					"Click the restore icon, or hide the timeline with `Mod+Shift+T`, to return to the compact peek.",
				source: {
					path: "docs/product-knowledge/timeline-motion-workspace.md",
					heading: "How does the user operate it?",
				},
			},
		],
		beforeAfter: [
			{
				label: "Before",
				value:
					"Serious timeline work meant a short floating strip that panels overlapped and the tool rail bled through.",
			},
			{
				label: "After",
				value:
					"A docked, full-width timeline reserves space; panels and the tool rail clear it and the height is yours to set.",
			},
		],
		details: [
			{ label: "Scope", value: "Motion timeline workspace ergonomics" },
			{ label: "Default height", value: "460px" },
			{
				label: "Height range",
				value: "220px up to min(900px, 62% of viewport)",
			},
			{ label: "Persistence", value: "Saved per browser" },
			{ label: "Reset", value: "Double-click the divider" },
			{
				label: "Manual check",
				value: "Open and resize, confirm zero overlap and stable zoom/pan",
			},
		],
		whyItMatters: [
			{
				id: "timeline-mode.why.room",
				publicText:
					"Serious keyframe and clip work gets room to breathe instead of fighting panel overlap in a cramped strip.",
				source: timelineWorkspaceSource,
			},
			{
				id: "timeline-mode.why.canvas",
				publicText:
					"Keeping timeline layout changes separate from the canvas camera preserves visual focus, while explicit Fit remains available when you want to use the remaining workspace.",
				source: timelineWorkspaceSource,
			},
			{
				id: "timeline-mode.why.additive",
				publicText:
					"Quick glances stay fast because the compact peek is preserved, so the mode is purely additive.",
				source: {
					path: "docs/product-knowledge/timeline-motion-workspace.md",
					heading: "What can the user do now?",
				},
			},
		],
		limits: [
			{
				id: "timeline-mode.limit.zoom",
				publicText:
					"Time-axis zoom is not in this release; the frame ruler still fits the whole duration to the available width.",
				source: {
					path: "docs/product-knowledge/timeline-motion-workspace.md",
					heading: "What is still intentionally limited?",
				},
			},
			{
				id: "timeline-mode.limit.followups",
				publicText:
					"A dedicated keyboard shortcut for the mode, per-track row heights, and a sticky ruler are planned follow-ups.",
				source: {
					path: "docs/product-knowledge/timeline-motion-workspace.md",
					heading: "What is still intentionally limited?",
				},
			},
		],
	},
] as const satisfies readonly ProductUpdateEntry[];

export const PRIMARY_PRODUCT_UPDATE = PRODUCT_UPDATES[0];
