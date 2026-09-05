/**
 * Resolution of published production controls: the single place where a
 * control's Scene-owned static value and its Motion-owned keyframe track are
 * combined into one sampled number.
 *
 * Sampling lives here rather than in `entities/motion/model/presentation.ts` for
 * the same reason `numericCameraKeyframes` lives in `scene-camera.ts`: the owner
 * of the semantic owns the sampler, and presentation stays a composition layer
 * that never learns what a linked production is.
 *
 * Two disciplines are load-bearing:
 * - Resolution is PURE and derived from `(SceneDocument, MotionDocument, frame)`
 *   only, so the editor sampler and the exported runtime cannot diverge.
 * - An ambiguous or unknown control resolves to `undefined`, never to `0`. A
 *   fabricated zero would silently retime whatever depends on it.
 */

import type { MotionDocument } from "@/entities/motion/model/types";
import { expressionFrameTime } from "@/shared/expr-dsl";
import type { AeKeyframe } from "@/shared/glammer/keyframe-track";
import { sampleKeyframeTrack } from "@/shared/glammer/keyframe-track";
import {
	type ExternalProductionLink,
	productionControlStaticValue,
	resolveExternalProductionLink,
} from "./production-link";
import type { SceneDocument } from "./types";

const finite = (value: number): boolean => Number.isFinite(value);

/** Usable numeric keys for one published control, in track order. */
export const productionControlKeyframes = (
	motion: MotionDocument,
	linkId: string,
	controlId: string,
): readonly AeKeyframe<number>[] =>
	motion.productionControlTracks
		?.find(
			(track) =>
				track.target.linkId === linkId && track.target.controlId === controlId,
		)
		?.keyframes.filter(
			(keyframe) =>
				finite(keyframe.time) &&
				typeof keyframe.value === "number" &&
				finite(keyframe.value),
		) ?? [];

/**
 * Samples one published control at a frame. Keyframes win where they exist and
 * the authored static value is the fallback everywhere else — the same override
 * rule camera channels and node scalars already use, so a control behaves the
 * way every other numeric channel in the document behaves.
 */
export const sampleProductionControlValue = (
	motion: MotionDocument,
	linkId: string,
	controlId: string,
	frame: number,
	staticFallback: number,
): number => {
	const keyframes = productionControlKeyframes(motion, linkId, controlId);
	if (keyframes.length === 0) return staticFallback;
	const sampled = sampleKeyframeTrack([...keyframes], frame);
	return finite(sampled) ? sampled : staticFallback;
};

/** One linked production found on the scene, already strictly re-parsed. */
export type SceneProductionLinkEntry = {
	readonly assetId: string;
	readonly link: ExternalProductionLink;
};

/**
 * Every parseable linked production on the document. Assets reach the scene from
 * cloud restore and portable backup without passing a command, so each candidate
 * is re-parsed rather than trusted by declared type.
 */
export const sceneProductionLinks = (
	scene: SceneDocument,
): readonly SceneProductionLinkEntry[] =>
	(scene.assets ?? []).flatMap((asset) => {
		const link = resolveExternalProductionLink(
			asset as { readonly production?: unknown },
		);
		return link ? [{ assetId: asset.id, link }] : [];
	});

/** Discovery projection for one control, addressed by its owning link. */
export type PublishedControlProjection = {
	readonly assetId: string;
	readonly linkId: string;
	readonly controlId: string;
	readonly label: string;
	readonly unit: string;
	readonly staticValue: number;
	readonly defaultValue: number;
	readonly rangeDeclared: boolean;
	readonly defaultIsAmbiguous: boolean;
	readonly min?: number;
	readonly max?: number;
	readonly keyframeCount: number;
	/** False when another link publishes the same id, which makes `control()` fail closed. */
	readonly uniqueControlId: boolean;
};

/**
 * Flat, agent- and UI-facing projection of every published control. This is the
 * discovery surface the camera precedent calls for: controls are document-derived
 * and therefore cannot live in the compile-time bindable-property registry.
 */
export const publishedControlProjections = (
	scene: SceneDocument,
	motion: MotionDocument,
): readonly PublishedControlProjection[] => {
	const entries = sceneProductionLinks(scene);
	const occurrences = new Map<string, number>();
	for (const { link } of entries) {
		for (const control of link.controls) {
			occurrences.set(control.id, (occurrences.get(control.id) ?? 0) + 1);
		}
	}
	return entries.flatMap(({ assetId, link }) =>
		link.controls.map((control) => ({
			assetId,
			linkId: link.linkId,
			controlId: control.id,
			label: control.label,
			unit: control.unit,
			staticValue:
				productionControlStaticValue(link, control.id) ?? control.defaultValue,
			defaultValue: control.defaultValue,
			rangeDeclared: control.rangeDeclared,
			defaultIsAmbiguous: control.defaultIsAmbiguous,
			...(control.min !== undefined ? { min: control.min } : {}),
			...(control.max !== undefined ? { max: control.max } : {}),
			keyframeCount: productionControlKeyframes(motion, link.linkId, control.id)
				.length,
			uniqueControlId: (occurrences.get(control.id) ?? 0) === 1,
		})),
	);
};

/**
 * Resolves one control by `(linkId, controlId)`. Returns `undefined` when the
 * link or the control is absent, so a caller can report an unresolved reference
 * instead of substituting a number nobody authored.
 */
export const resolveProductionControlValue = (
	scene: SceneDocument,
	motion: MotionDocument,
	linkId: string,
	controlId: string,
	frame: number,
): number | undefined => {
	const entry = sceneProductionLinks(scene).find(
		({ link }) => link.linkId === linkId,
	);
	if (!entry) return undefined;
	const staticValue = productionControlStaticValue(entry.link, controlId);
	if (staticValue === undefined) return undefined;
	return sampleProductionControlValue(
		motion,
		linkId,
		controlId,
		frame,
		staticValue,
	);
};

/**
 * Resolver for expression `control("id")` references: a bare control id with no
 * link qualifier. An id published by more than one link is AMBIGUOUS and
 * resolves to `undefined` rather than picking a winner, because "the first link
 * wins" is a rule no author can see in the document.
 */
export type ProductionControlResolver = (
	controlId: string,
) => number | undefined;

/**
 * Frame-parameterized form. Sampling layers hold one of these for a document and
 * bind the frame per sampled frame, so the link scan and the id index are paid
 * once instead of once per frame.
 */
export type ProductionControlSampler = (
	controlId: string,
	frame: number,
) => number | undefined;

export const createProductionControlSampler = (
	scene: SceneDocument,
	motion: MotionDocument,
): ProductionControlSampler => {
	const entries = sceneProductionLinks(scene);
	if (entries.length === 0) return () => undefined;
	const linkById = new Map(entries.map(({ link }) => [link.linkId, link]));
	const linkIdsByControlId = new Map<string, string[]>();
	for (const { link } of entries) {
		for (const control of link.controls) {
			const owners = linkIdsByControlId.get(control.id) ?? [];
			owners.push(link.linkId);
			linkIdsByControlId.set(control.id, owners);
		}
	}
	return (controlId: string, frame: number): number | undefined => {
		const owners = linkIdsByControlId.get(controlId);
		const linkId = owners?.length === 1 ? owners[0] : undefined;
		const link = linkId ? linkById.get(linkId) : undefined;
		if (!link || !linkId) return undefined;
		const staticValue = productionControlStaticValue(link, controlId);
		if (staticValue === undefined) return undefined;
		return sampleProductionControlValue(
			motion,
			linkId,
			controlId,
			frame,
			staticValue,
		);
	};
};

/**
 * Frame context for expression seams whose evaluator is bundled into the
 * exported standalone runtime — today the Text Animator selector Offset.
 *
 * It lives HERE, next to the sampler, rather than next to the evaluator, for the
 * same reason `MotionPresentationInput.controls` is injected: the evaluator must
 * not import the linked-production contract, or every export profile would carry
 * a link parser the runtime never calls. Render bridges that hold both documents
 * (editor canvas, SVG exporter) build the context from this one place, so they
 * cannot disagree about what `control("id")` means.
 */
export const createExpressionFrameContext = (
	scene: SceneDocument,
	motion: MotionDocument,
	frame: number,
): {
	readonly time: number;
	readonly frame: number;
	readonly controls: ProductionControlResolver;
} => {
	const sampler = createProductionControlSampler(scene, motion);
	return {
		time: expressionFrameTime(frame, motion.fps),
		frame,
		controls: (controlId: string) => sampler(controlId, frame),
	};
};

/** Frame-bound resolver for one evaluation pass. */
export const createProductionControlResolver = (
	scene: SceneDocument,
	motion: MotionDocument,
	frame: number,
): ProductionControlResolver => {
	const sampler = createProductionControlSampler(scene, motion);
	return (controlId: string) => sampler(controlId, frame);
};

/**
 * Canonical POJO projection of one link's control tracks for the build key.
 * Easing rides along because it changes the value the producing side is asked to
 * evaluate between keys, so omitting it would let two visually different control
 * curves claim the same artifact.
 */
export type ProductionControlTrackDigestInput = readonly {
	readonly controlId: string;
	readonly keyframes: readonly {
		readonly time: number;
		readonly value: number;
		readonly inInterpolationType?: number;
		readonly outInterpolationType?: number;
		readonly outTemporalCurve?: {
			readonly x1: number;
			readonly y1: number;
			readonly x2: number;
			readonly y2: number;
		};
	}[];
}[];

export const productionControlTrackDigestInput = (
	motion: MotionDocument,
	linkId: string,
): ProductionControlTrackDigestInput =>
	(motion.productionControlTracks ?? [])
		.filter((track) => track.target.linkId === linkId)
		.map((track) => ({
			controlId: track.target.controlId,
			keyframes: track.keyframes
				.filter(
					(keyframe) =>
						finite(keyframe.time) && finite(keyframe.value as number),
				)
				.map((keyframe) => ({
					time: keyframe.time,
					value: keyframe.value,
					...(keyframe.inInterpolationType !== undefined
						? { inInterpolationType: keyframe.inInterpolationType }
						: {}),
					...(keyframe.outInterpolationType !== undefined
						? { outInterpolationType: keyframe.outInterpolationType }
						: {}),
					...(keyframe.outTemporalCurve
						? {
								outTemporalCurve: {
									x1: keyframe.outTemporalCurve.x1,
									y1: keyframe.outTemporalCurve.y1,
									x2: keyframe.outTemporalCurve.x2,
									y2: keyframe.outTemporalCurve.y2,
								},
							}
						: {}),
				})),
		}))
		// Code-unit order so the browser and the Bun companion hash the same bytes.
		.sort((left, right) =>
			left.controlId === right.controlId
				? 0
				: left.controlId < right.controlId
					? -1
					: 1,
		);
