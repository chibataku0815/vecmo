import {
	findGravityReviewEntry,
	GRAVITY_REVIEW_ENTRIES,
} from "@/features/gravity-review/model/catalog";
import { cn } from "@/shared/lib/cn";

const reviewHref = (slug: string): string =>
	`/editor?gravityReview=${encodeURIComponent(slug)}`;

/**
 * Ephemeral, chapter-local disclosure for the Gravity review route.
 *
 * The guide is intentionally a read model: it does not carry candidate data,
 * decision state, or a separate player. Timeline playback and scrubbing remain
 * the normal editor's live Scene/Motion behavior after portable-project restore.
 */
export function GravityReviewGuide({ slug }: { readonly slug: string }) {
	const entry = findGravityReviewEntry(slug);
	if (!entry) return null;

	return (
		<aside className="tutorial-guide pointer-events-auto flex w-80 flex-col gap-3 overflow-hidden rounded-md border border-hairline/12 bg-surface-raised/92 p-3 text-fg shadow-2xl shadow-black/35 backdrop-blur-xl">
			<header className="grid gap-1 border-hairline/10 border-b pb-2">
				<p className="text-fg-muted text-ui uppercase tracking-wide">
					Internal · review only
				</p>
				<h2 className="font-medium text-sm leading-5">
					Gravity · {entry.title}
				</h2>
				<p className="text-fg-secondary text-xs leading-4">
					{entry.coverage} · {entry.durationFrames} frames · {entry.fps} fps
				</p>
			</header>

			<dl className="grid gap-2 text-xs leading-4">
				<div>
					<dt className="text-fg-muted text-ui uppercase tracking-wide">
						Source
					</dt>
					<dd className="text-fg-secondary">{entry.nativeSurface}</dd>
				</div>
				<div>
					<dt className="text-fg-muted text-ui uppercase tracking-wide">
						Continuity
					</dt>
					<dd className="text-fg-secondary">{entry.continuity}</dd>
				</div>
				<div>
					<dt className="text-fg-muted text-ui uppercase tracking-wide">
						Finish residual
					</dt>
					<dd className="text-fg-secondary">{entry.residual}</dd>
				</div>
			</dl>

			<section className="grid gap-1.5 border-hairline/10 border-t pt-2 text-xs leading-4">
				<p className="font-medium text-warn-fg">{entry.status}</p>
				<p className="text-fg-secondary">
					approvalId: {entry.approvalId ?? "null"} · implementation
					authorization:{" "}
					{entry.implementationAuthorization.replaceAll("_", " ")}.
				</p>
				<p className="text-fg-muted">
					No producer acceptance is asserted. Source media and reconstructive
					data remain local review inputs; they are not copied into product
					source or public assets.
				</p>
			</section>

			<nav
				aria-label="Gravity review chapters"
				className="grid gap-1 border-hairline/10 border-t pt-2"
			>
				<p className="text-fg-muted text-ui uppercase tracking-wide">
					Chapter playlist
				</p>
				{GRAVITY_REVIEW_ENTRIES.map((chapter) => (
					<a
						key={chapter.slug}
						href={reviewHref(chapter.slug)}
						className={cn(
							"rounded px-1.5 py-1 text-xs leading-4 transition-colors hover:bg-white/[0.06] hover:text-fg",
							chapter.slug === slug
								? "bg-accent-surface text-accent-fg"
								: "text-fg-secondary",
						)}
					>
						{chapter.title} · {chapter.durationFrames}f
					</a>
				))}
			</nav>

			<p className="border-hairline/10 border-t pt-2 text-fg-muted text-ui leading-4">
				Available only from a local Vecmo development session; this endpoint is
				not part of the Cloudflare or public asset surface.
			</p>
		</aside>
	);
}
