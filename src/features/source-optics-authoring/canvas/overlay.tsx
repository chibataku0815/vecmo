import { selectCurrentArtboard } from "@/entities/scene/model/selectors";
import { buildSourceOpticsPresentation } from "@/entities/scene/model/source-optics";
import type { SceneDocument } from "@/entities/scene/model/types";

type OverlayProps = {
	readonly document: SceneDocument;
	readonly selection: {
		readonly nodeIds: readonly string[];
		readonly primary: string | null;
	};
	readonly viewport: { readonly zoom: number };
};

const PERCENT = 100;
const GUIDE = "#64d2ff";
const GUIDE_SECONDARY = "#ff7ab6";
const GUIDE_FILL = "#f7f4eb";

function SourceOpticsOverlay({ document, selection, viewport }: OverlayProps) {
	const artboard = selectCurrentArtboard(document);
	const presentation = buildSourceOpticsPresentation(
		document,
		artboard.id,
		"editor-svg",
	);
	const selectedId = selection.primary ?? selection.nodeIds[0];
	if (!selectedId) return null;
	const selectedPlan = presentation.nodePlans[selectedId];
	const source = selectedPlan?.source;
	const target = selectedPlan?.target;
	if (!source && !target) return null;
	const scale = Math.max(viewport.zoom / PERCENT, 0.001);
	const strokeWidth = 1.25 / scale;
	const sourcePlan =
		source ??
		presentation.sourcePlans.find(
			(candidate) => candidate.rigId === target?.rigId,
		);
	if (!sourcePlan) return null;
	const responsePlans = source
		? presentation.targetPlans.filter(
				(candidate) => candidate.rigId === source.rigId,
			)
		: target
			? [target]
			: [];
	return (
		<svg
			className="pointer-events-none absolute inset-0 h-full w-full"
			viewBox={`0 0 ${artboard.width} ${artboard.height}`}
			aria-hidden="true"
		>
			<ellipse
				cx={sourcePlan.sourceCenter.x}
				cy={sourcePlan.sourceCenter.y}
				rx={Math.max(sourcePlan.bloom.radiusX, 1)}
				ry={Math.max(sourcePlan.bloom.radiusY ?? sourcePlan.bloom.radiusX, 1)}
				fill="none"
				stroke={GUIDE}
				strokeOpacity={0.55}
				strokeWidth={strokeWidth}
				strokeDasharray={`${4 / scale} ${3 / scale}`}
			/>
			{sourcePlan.rays.map((ray) => {
				const radians = (ray.angle * Math.PI) / 180;
				const dx = Math.cos(radians) * ray.length;
				const dy = Math.sin(radians) * ray.length;
				return (
					<line
						key={ray.id}
						x1={sourcePlan.sourceCenter.x - dx * ray.oppositeSideRatio}
						y1={sourcePlan.sourceCenter.y - dy * ray.oppositeSideRatio}
						x2={sourcePlan.sourceCenter.x + dx}
						y2={sourcePlan.sourceCenter.y + dy}
						stroke={GUIDE_SECONDARY}
						strokeOpacity={0.72}
						strokeWidth={Math.max(strokeWidth, ray.width / 4)}
					/>
				);
			})}
			{responsePlans.map((response) => (
				<g key={response.binding.id}>
					<line
						x1={response.sourceCenter.x}
						y1={response.sourceCenter.y}
						x2={response.targetCenter.x}
						y2={response.targetCenter.y}
						stroke={GUIDE}
						strokeOpacity={0.65}
						strokeWidth={strokeWidth}
						strokeDasharray={`${5 / scale} ${4 / scale}`}
					/>
					<circle
						cx={response.targetCenter.x}
						cy={response.targetCenter.y}
						r={5 / scale}
						fill={GUIDE_FILL}
						stroke={GUIDE}
						strokeWidth={strokeWidth}
					/>
				</g>
			))}
			<circle
				cx={sourcePlan.sourceCenter.x}
				cy={sourcePlan.sourceCenter.y}
				r={6 / scale}
				fill={GUIDE_FILL}
				stroke={GUIDE_SECONDARY}
				strokeWidth={strokeWidth}
			/>
		</svg>
	);
}

export const overlay = {
	id: "source-optics-authoring",
	paintOrder: 24,
	Component: SourceOpticsOverlay,
};
