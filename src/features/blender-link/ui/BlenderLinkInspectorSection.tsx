import { ArrowClockwise, Hammer, LinkSimple } from "@phosphor-icons/react";
import { externalSceneAssetForGeometry } from "@/entities/scene/model/assets";
import type {
	ExternalSceneAsset,
	SceneDocument,
	VectorNode,
} from "@/entities/scene/model/types";
import { cn } from "@/shared/lib/cn";
import { blenderLinkStateLabel, shortDigest } from "./status-labels";
import { useBlenderLinkController } from "./use-blender-link-controller";

const controlButton =
	"flex min-w-0 items-center justify-center gap-1 rounded-md border border-hairline bg-surface px-1.5 py-1 text-fg-secondary text-ui transition hover:bg-surface-light hover:text-fg disabled:cursor-not-allowed disabled:opacity-45";

const primaryControlButton =
	"border-accent/60 bg-accent-surface text-accent-fg hover:bg-accent-surface/80 hover:text-accent-fg";

function Readout({
	label,
	value,
}: {
	readonly label: string;
	readonly value: string;
}) {
	return (
		<div className="flex h-6 min-w-0 items-center justify-between gap-2 rounded-md border border-hairline bg-surface-sunken px-1.5 text-ui">
			<span className="text-fg-muted">{label}</span>
			<span
				className="min-w-0 truncate font-mono text-fg-secondary"
				title={value}
			>
				{value}
			</span>
		</div>
	);
}

/**
 * Compact Inspector readout for a placement of a linked Blender production.
 * Reuses `useBlenderLinkController`/`blenderLinkWorkflow()` — the Assets panel
 * owns discovery/pairing/bind; this section only ever reads status and issues
 * Rebuild/Refresh, so there is exactly one place a companion transaction can
 * originate from per link, not two independently-tracked ones.
 */
export function BlenderLinkInspectorSection({
	document,
	node,
}: {
	readonly document: SceneDocument;
	readonly node: VectorNode;
}) {
	if (node.geometry.kind !== "image") return null;
	const asset = externalSceneAssetForGeometry(document, node.geometry);
	if (asset?.kind !== "model-3d" || !asset.production) return null;
	return <BlenderLinkInspectorReadout asset={asset} />;
}

function BlenderLinkInspectorReadout({
	asset,
}: {
	readonly asset: ExternalSceneAsset;
}) {
	const { link, entry, connected, pending, refresh, rebuild } =
		useBlenderLinkController(asset);
	if (!link) return null;
	const state = entry?.state ?? "relink-required";
	const needsRelink = state === "relink-required";

	return (
		<section className="border-hairline/70 border-b px-1.5 pb-1.5 last:border-b-0">
			<div className="sticky top-0 z-20 -mx-1.5 mb-1.5 flex h-6 items-center justify-between gap-1 border-hairline/70 border-b bg-surface-raised/96 px-1.5 text-fg-secondary text-ui backdrop-blur-xl">
				<div className="flex min-w-0 items-center gap-1 font-medium">
					<LinkSimple aria-hidden="true" size={12} />
					<span className="truncate">Linked production (internal)</span>
				</div>
				<span className="font-mono text-fg-subtle text-ui">
					{blenderLinkStateLabel(state)}
				</span>
			</div>
			<div className="space-y-1.5">
				<Readout label="Source" value={link.source.displayName} />
				<div className="grid grid-cols-2 gap-1">
					<Readout
						label="Digest"
						value={shortDigest(entry?.observedSourceDigest)}
					/>
					<Readout
						label="Build key"
						value={shortDigest(entry?.resolved?.buildKey)}
					/>
				</div>
				{needsRelink ? (
					<p className="text-fg-muted text-ui">
						No local source binding in this working copy. Resolve it from the
						Assets panel's Blender Scene section (pick the source offer again,
						same link id).
					</p>
				) : (
					<div className="flex items-center gap-1">
						<button
							type="button"
							disabled={pending !== null || !connected}
							onClick={() => void refresh()}
							className={cn(controlButton, "flex-1")}
						>
							<ArrowClockwise aria-hidden="true" size={12} />
							Refresh
						</button>
						<button
							type="button"
							disabled={pending !== null || !connected}
							onClick={() => void rebuild()}
							className={cn(controlButton, primaryControlButton, "flex-1")}
						>
							<Hammer aria-hidden="true" size={12} />
							Rebuild
						</button>
					</div>
				)}
			</div>
		</section>
	);
}
