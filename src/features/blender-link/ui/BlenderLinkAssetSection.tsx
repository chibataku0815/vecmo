import {
	ArrowClockwise,
	ArrowsClockwise,
	Hammer,
	LinkSimple,
	X,
} from "@phosphor-icons/react";
import type { ExternalSceneAsset } from "@/entities/scene/model/types";
import type { BlenderLinkState } from "@/features/blender-link/model/workflow";
import { cn } from "@/shared/lib/cn";
import { blenderLinkStateLabel, shortDigest } from "./status-labels";
import { useBlenderLinkController } from "./use-blender-link-controller";

const controlButton =
	"flex min-w-0 items-center justify-center gap-1 rounded-md border border-hairline bg-surface px-1.5 py-1 text-fg-secondary text-ui transition hover:bg-surface-light hover:text-fg disabled:cursor-not-allowed disabled:opacity-45";

const primaryControlButton =
	"border-accent/60 bg-accent-surface text-accent-fg hover:bg-accent-surface/80 hover:text-accent-fg";

const warningControlButton =
	"border-warn/50 bg-warn-surface text-warn-fg hover:bg-warn-surface/80 hover:text-warn-fg";

const chipToneClass = (state: BlenderLinkState | undefined): string => {
	switch (state) {
		case "ready":
			return "border-accent/45 bg-accent-surface text-accent-fg";
		case "stale":
		case "building":
		case "inspecting":
			return "border-warn/45 bg-warn-surface text-warn-fg";
		case "failed":
		case "relink-required":
			return "border-danger/45 bg-danger-surface text-danger-fg";
		default:
			return "border-hairline bg-surface-sunken text-fg-secondary";
	}
};

/**
 * Assets-panel affordance for one `model-3d` external asset: internal-only,
 * kept minimal per S1-D. It never renders a filesystem path — only the
 * companion-issued display name and the digests the workflow already
 * verified.
 */
export function BlenderLinkAssetSection({
	asset,
}: {
	readonly asset: ExternalSceneAsset;
}) {
	const controller = useBlenderLinkController(asset);
	const {
		connected,
		link,
		entry,
		discovery,
		pairingToken,
		setPairingToken,
		selectedSourceToken,
		setSelectedSourceToken,
		pending,
		feedback,
		discover,
		connect,
		disconnect,
		linkNow,
		relink,
		refresh,
		rebuild,
		unlink,
	} = controller;

	const state = entry?.state ?? (link ? "relink-required" : undefined);
	const needsRelink =
		Boolean(link) && (state === "relink-required" || state === undefined);

	return (
		<div className="mt-1 space-y-1 rounded-md border border-hairline bg-surface-sunken p-1.5">
			<div className="flex items-center justify-between gap-1 text-fg-secondary text-ui">
				<span className="flex items-center gap-1">
					<LinkSimple aria-hidden="true" size={12} />
					<span className="font-medium">Link Blender Scene (internal)</span>
				</span>
				{connected ? (
					<button
						type="button"
						disabled={pending !== null}
						onClick={disconnect}
						title="Drop the companion session (needed after Unlink advances the binding epoch, or if Refresh/Rebuild keep failing)"
						className="shrink-0 text-fg-muted text-ui underline decoration-dotted underline-offset-2 transition hover:text-fg-secondary disabled:cursor-not-allowed disabled:opacity-45"
					>
						Disconnect
					</button>
				) : null}
			</div>

			{link ? (
				<div className="space-y-1">
					<div className="flex items-center justify-between gap-1 text-ui">
						<span className="min-w-0 truncate text-fg-muted">
							{link.source.displayName}
						</span>
						<span
							className={cn(
								"shrink-0 rounded border px-1 py-0.5 font-medium",
								chipToneClass(state),
							)}
						>
							{state ? blenderLinkStateLabel(state) : "Unknown"}
						</span>
					</div>
					<div className="grid grid-cols-2 gap-1 text-ui">
						<div className="rounded-md border border-hairline bg-surface px-1.5 py-1">
							<div className="text-fg-muted">Source digest</div>
							<div className="truncate font-mono text-fg-secondary">
								{shortDigest(entry?.observedSourceDigest)}
							</div>
						</div>
						<div className="rounded-md border border-hairline bg-surface px-1.5 py-1">
							<div className="text-fg-muted">Build key</div>
							<div className="truncate font-mono text-fg-secondary">
								{shortDigest(entry?.resolved?.buildKey)}
							</div>
						</div>
					</div>
					<div className="flex items-center gap-1">
						<button
							type="button"
							disabled={pending !== null || !connected || needsRelink}
							onClick={() => void refresh()}
							className={cn(controlButton, "flex-1")}
						>
							<ArrowClockwise aria-hidden="true" size={12} />
							Refresh
						</button>
						<button
							type="button"
							disabled={pending !== null || !connected || needsRelink}
							onClick={() => void rebuild()}
							className={cn(controlButton, primaryControlButton, "flex-1")}
						>
							<Hammer aria-hidden="true" size={12} />
							Rebuild
						</button>
						<button
							type="button"
							disabled={pending !== null}
							onClick={unlink}
							className={cn(controlButton, warningControlButton)}
						>
							<X aria-hidden="true" size={12} />
							Unlink
						</button>
					</div>
				</div>
			) : null}

			{!connected ? (
				// Shown regardless of `link`: reconnecting the companion after a
				// reload is a per-session concern, not a per-asset one. Gating this
				// behind "not yet linked" would strand an already-linked asset with
				// no path back to Ready after every page reload.
				<div className="space-y-1">
					<button
						type="button"
						disabled={pending !== null}
						onClick={() => void discover()}
						className={cn(controlButton, "w-full")}
					>
						<ArrowClockwise aria-hidden="true" size={12} />
						Discover companion
					</button>
					{discovery ? (
						<div className="space-y-1">
							<label className="block min-w-0">
								<span className="mb-0.5 block text-fg-muted text-ui">
									Pairing token
								</span>
								<input
									type="password"
									autoComplete="off"
									spellCheck={false}
									value={pairingToken}
									onChange={(event) =>
										setPairingToken(event.currentTarget.value)
									}
									placeholder="Terminal-issued token"
									className="h-6 w-full rounded-md border border-hairline bg-surface px-1.5 font-mono text-fg text-ui outline-none transition placeholder:text-fg-subtle focus:border-accent/70"
								/>
							</label>
							<button
								type="button"
								disabled={pending !== null || pairingToken.trim().length === 0}
								onClick={() => void connect()}
								className={cn(controlButton, primaryControlButton, "w-full")}
							>
								<LinkSimple aria-hidden="true" size={12} />
								Connect
							</button>
						</div>
					) : null}
				</div>
			) : !link ? (
				<div className="space-y-1">
					<label className="block min-w-0">
						<span className="mb-0.5 block text-fg-muted text-ui">
							Source offer
						</span>
						<select
							value={selectedSourceToken ?? ""}
							onChange={(event) =>
								setSelectedSourceToken(event.currentTarget.value || null)
							}
							disabled={!discovery || discovery.sources.length === 0}
							className="h-6 w-full rounded-md border border-hairline bg-surface px-1.5 text-fg text-ui outline-none transition focus:border-accent/70 disabled:cursor-not-allowed disabled:opacity-45"
						>
							<option value="">
								{discovery && discovery.sources.length > 0
									? "Choose a source"
									: "No sources offered"}
							</option>
							{discovery?.sources.map((offer) => (
								<option key={offer.localPathToken} value={offer.localPathToken}>
									{offer.displayName}
								</option>
							))}
						</select>
					</label>
					<button
						type="button"
						disabled={pending !== null || !selectedSourceToken}
						onClick={() => void linkNow()}
						className={cn(controlButton, primaryControlButton, "w-full")}
					>
						<ArrowsClockwise aria-hidden="true" size={12} />
						Bind and link
					</button>
				</div>
			) : needsRelink ? (
				<div className="space-y-1">
					<p className="text-fg-muted text-ui">
						This working copy has no local source binding for this link (a fresh
						copy, or a cleared registry). Pick the source again to resolve it —
						the placement and its link id are unchanged.
					</p>
					<label className="block min-w-0">
						<span className="mb-0.5 block text-fg-muted text-ui">
							Source offer
						</span>
						<select
							value={selectedSourceToken ?? ""}
							onChange={(event) =>
								setSelectedSourceToken(event.currentTarget.value || null)
							}
							disabled={!discovery || discovery.sources.length === 0}
							className="h-6 w-full rounded-md border border-hairline bg-surface px-1.5 text-fg text-ui outline-none transition focus:border-accent/70 disabled:cursor-not-allowed disabled:opacity-45"
						>
							<option value="">
								{discovery && discovery.sources.length > 0
									? "Choose a source"
									: "No sources offered"}
							</option>
							{discovery?.sources.map((offer) => (
								<option key={offer.localPathToken} value={offer.localPathToken}>
									{offer.displayName}
								</option>
							))}
						</select>
					</label>
					<button
						type="button"
						disabled={pending !== null || !selectedSourceToken}
						onClick={() => void relink()}
						className={cn(controlButton, primaryControlButton, "w-full")}
					>
						<ArrowsClockwise aria-hidden="true" size={12} />
						Relink
					</button>
				</div>
			) : null}

			{feedback ? (
				<p
					className={cn(
						"rounded-md border px-1.5 py-1 text-ui",
						feedback.tone === "success"
							? "border-accent/45 bg-accent-surface text-accent-fg"
							: feedback.tone === "warning"
								? "border-warn/45 bg-warn-surface text-warn-fg"
								: "border-hairline bg-surface text-fg-secondary",
					)}
				>
					{feedback.message}
				</p>
			) : null}
		</div>
	);
}
