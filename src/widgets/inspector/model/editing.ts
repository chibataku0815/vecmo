/**
 * Barrel for the inspector editing model. `editing.ts` used to hold every inspector
 * domain (paint/gradient/mesh, shadow/blur, frame Look/graph, Noise Gradient,
 * typography/corner-radius, artboard CRUD) in one ~6000-line file; it now re-exports
 * the split domain modules so every existing `@/widgets/inspector/model/editing`
 * import keeps working unchanged. Add new inspector editing logic to the domain
 * module it belongs to (or `editing-shared.ts` for cross-domain primitives), not here.
 *
 * `editing-shared.ts` also exports internal transaction/command-bus plumbing
 * (`applyCommandsAsTransaction`, `uniqueNodeIds`, `shadowForNode`, and similar) so
 * the domain modules below can import it — those were never part of the intentional
 * public inspector editing surface, so they are re-exported here by explicit name
 * rather than `export *`, keeping this barrel's surface identical to the original
 * monolithic file's.
 */
export * from "./artboard-editing";
export type {
	AppearanceEditingState,
	AppearanceEditingValues,
	ArtboardInspectorMutation,
	ArtboardInspectorMutationAdapter,
	ArtboardInspectorMutationPatch,
	ArtboardInspectorMutationStatus,
	ArtboardInspectorNumberField,
	ArtboardInspectorState,
	ArtboardInspectorValues,
	DropShadowNumberField,
	FrameEffectInfluenceEditingValues,
	FrameEffectInfluenceMaskKind,
	FrameEffectInfluenceNumberField,
	GradientEditModel,
	GradientStopModel,
	ImagePaintEditModel,
	InspectorImageFit,
	InspectorPaintKind,
	MaskFeatherEditingState,
	MeshPaintEditModel,
	MeshPointEditModel,
	MeshSubSelectionLike,
	MixedValue,
	NodeColorField,
	PrimaryPaintRole,
	ShadowNumberField,
	StrokeOptionField,
	StrokeStyleKind,
	StrokeWidthProfileSelection,
	StyleNumberField,
	TextBoxEditingState,
	TextBoxEditingValues,
	TextEditingState,
	TextStyleEditingState,
	TextStyleEditingValues,
	TextStyleNumberField,
	TransformNumberField,
} from "./editing-shared";
export {
	artboardInspectorState,
	commitMaskRelationBehavior,
	commitMaskRelationFeather,
	commitMaskRelationSetting,
	commitNodeColor,
	commitSingleOpacity,
	commitSingleTransformNumber,
	formatInspectorNumber,
	INSPECTOR_BLEND_MODE_VALUES,
	INSPECTOR_IMAGE_FIT_VALUES,
	INSPECTOR_PAINT_KIND_VALUES,
	INSPECTOR_STROKE_ALIGN_VALUES,
	INSPECTOR_STROKE_CAP_VALUES,
	INSPECTOR_STROKE_JOIN_VALUES,
	MIXED_VALUE,
	maskFeatherEditingStateForNode,
	mixedValue,
	normalizeArtboardBackgroundInput,
	normalizeArtboardNameInput,
	normalizeArtboardNumberInput,
	normalizeColorInput,
	normalizeFontFamilyInput,
	normalizeTextAlignInput,
	parseNumericDraft,
	primaryNodeForInspector,
	rectCornerRadiusValue,
	rectNodeCount,
	sceneArtboardMutationAdapter,
	sceneNodeCount,
	selectedNodesForInspector,
	unavailableArtboardMutationAdapter,
} from "./editing-shared";
export * from "./frame-look-editing";
export * from "./noise-gradient-editing";
export * from "./paint-editing";
export * from "./shadow-blur-editing";
export * from "./typography-editing";
