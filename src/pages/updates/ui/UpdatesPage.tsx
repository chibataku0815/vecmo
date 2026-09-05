import {
	ArrowSquareOut,
	CalendarBlank,
	Check,
	FlowArrow,
	Play,
} from "@phosphor-icons/react";
import { useEffect } from "react";
import { useInPageAnchorScroll } from "@/shared/lib/in-page-anchor";
import {
	PRODUCT_UPDATES,
	type ProductUpdateClaim,
	type ProductUpdateDetail,
	type ProductUpdateEntry,
	type ProductUpdateStatus,
} from "../model/product-updates";

const ARTICLE_SECTIONS = [
	{ id: "what-changed", label: "What changed" },
	{ id: "workflow", label: "Workflow" },
	{ id: "before-after", label: "Before / After" },
	{ id: "details", label: "Details" },
	{ id: "why-it-matters", label: "Why it matters" },
	{ id: "limits", label: "Current limits" },
	{ id: "sources", label: "Sources" },
] as const;

/**
 * Slug of the entry whose hand-built editor mockup (`TimelinePreview`) is
 * accurate. The mockup is Time-Delay-specific (it names Time Delay dots, the
 * Time Delay expansion clip, and Stagger), so it must never be rendered for any
 * other update or it would misrepresent that feature.
 */
const PREVIEW_UPDATE_SLUG = "time-delay-motion-system";

/**
 * Only `public` updates reach the public `/updates` page. The content model
 * carries `beta`/`internal` entries too; gating here keeps the page from
 * leaking pre-release work even though the status field is shown as a badge.
 */
const PUBLIC_UPDATES: readonly ProductUpdateEntry[] = PRODUCT_UPDATES.filter(
	(update) => update.status === "public",
);

const categoryAnchor = (category: string): string =>
	`category-${category.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;

const updatesByCategory = Array.from(
	PUBLIC_UPDATES.reduce((groups, update) => {
		const entries = groups.get(update.category) ?? [];
		groups.set(update.category, [...entries, update]);
		return groups;
	}, new Map<string, ProductUpdateEntry[]>()),
	([category, entries]) => ({ category, entries }),
).sort((left, right) => left.category.localeCompare(right.category));

const statusLabel = (status: ProductUpdateStatus): string => {
	switch (status) {
		case "public":
			return "Public";
		case "beta":
			return "Beta";
		case "internal":
			return "Internal";
	}
};

function InlineClaim({ text }: { readonly text: string }) {
	const parts: Array<{
		readonly key: string;
		readonly text: string;
		readonly code: boolean;
	}> = [];
	const pattern = /`([^`]+)`/g;
	let cursor = 0;
	for (const match of text.matchAll(pattern)) {
		const index = match.index ?? cursor;
		if (index > cursor) {
			parts.push({
				key: `${cursor}:text:${text.slice(cursor, index)}`,
				text: text.slice(cursor, index),
				code: false,
			});
		}
		const codeText = match[1] ?? "";
		parts.push({
			key: `${index}:code:${codeText}`,
			text: codeText,
			code: true,
		});
		cursor = index + match[0].length;
	}
	if (cursor < text.length) {
		parts.push({
			key: `${cursor}:text:${text.slice(cursor)}`,
			text: text.slice(cursor),
			code: false,
		});
	}
	return (
		<>
			{parts.map((part) => {
				if (part.code) {
					return (
						<code
							className="rounded border border-hairline/10 bg-surface-sunken px-1 font-mono text-fg-secondary"
							key={part.key}
						>
							{part.text}
						</code>
					);
				}
				return <span key={part.key}>{part.text}</span>;
			})}
		</>
	);
}

function ClaimList({
	claims,
}: {
	readonly claims: readonly ProductUpdateClaim[];
}) {
	return (
		<ul className="grid gap-2.5">
			{claims.map((claim) => (
				<li
					className="grid grid-cols-[1.1rem_minmax(0,1fr)] gap-2.5 border-hairline/10 border-t pt-2.5 text-sm text-fg-secondary leading-relaxed"
					key={claim.id}
				>
					<Check aria-hidden="true" className="mt-1 text-accent-fg" size={14} />
					<span>
						<InlineClaim text={claim.publicText} />
					</span>
				</li>
			))}
		</ul>
	);
}

function DetailRows({
	details,
}: {
	readonly details: readonly ProductUpdateDetail[];
}) {
	return (
		<div className="grid border-hairline/10 border-t">
			{details.map((detail) => (
				<div
					className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 border-hairline/10 border-b py-2.5 text-sm"
					key={detail.label}
				>
					<span className="font-medium text-fg-muted">{detail.label}</span>
					<span className="text-fg-secondary leading-relaxed">
						{detail.value}
					</span>
				</div>
			))}
		</div>
	);
}

function UpdatesDirectory({ activeSlug }: { readonly activeSlug: string }) {
	return (
		<section className="mx-auto grid max-w-5xl gap-4 px-5 pt-10 lg:grid-cols-[minmax(11rem,0.26fr)_1fr]">
			<div className="rounded-lg border border-hairline/10 bg-surface p-4">
				<p className="mb-3 text-sm font-medium text-fg">Categories</p>
				<div className="flex flex-wrap gap-2">
					{updatesByCategory.map((group) => (
						<a
							className="inline-flex h-7 items-center gap-1.5 rounded-md border border-hairline/10 bg-surface-raised px-2.5 text-xs text-fg-secondary hover:border-accent/45 hover:text-fg"
							href={`#${categoryAnchor(group.category)}`}
							key={group.category}
						>
							<span>{group.category}</span>
							<span className="text-fg-muted">{group.entries.length}</span>
						</a>
					))}
				</div>
			</div>
			<div className="rounded-lg border border-hairline/10 bg-surface p-4">
				<div className="mb-3 flex items-center justify-between gap-3">
					<p className="text-sm font-medium text-fg">All updates</p>
					<span className="text-xs text-fg-muted">
						{PUBLIC_UPDATES.length} entries
					</span>
				</div>
				<div className="grid gap-4">
					{updatesByCategory.map((group) => (
						<section
							className="grid gap-2"
							id={categoryAnchor(group.category)}
							key={group.category}
						>
							<h2 className="text-xs font-medium text-fg-muted">
								{group.category}
							</h2>
							{group.entries.map((update) => {
								const active = update.slug === activeSlug;
								return (
									<a
										className={`grid gap-1 rounded-md border px-3 py-2.5 ${
											active
												? "border-accent/45 bg-accent-surface text-accent-fg"
												: "border-hairline/10 bg-surface-raised text-fg-secondary hover:border-accent/45 hover:text-fg"
										}`}
										href={`#${update.slug}`}
										key={update.slug}
									>
										<span className="flex flex-wrap items-center gap-2">
											<span className="text-sm font-medium">
												{update.title}
											</span>
											<span className="rounded border border-hairline/10 bg-surface px-1.5 text-xs text-fg-muted">
												{statusLabel(update.status)}
											</span>
											<span className="text-xs text-fg-muted">
												{update.date}
											</span>
										</span>
										<span className="text-sm text-fg-secondary leading-relaxed">
											{update.summary}
										</span>
									</a>
								);
							})}
						</section>
					))}
				</div>
			</div>
		</section>
	);
}

function ArticleContents({ slug }: { readonly slug: string }) {
	return (
		<nav
			aria-label="Article contents"
			className="mb-8 rounded-lg border border-hairline/10 bg-surface p-4"
		>
			<p className="mb-2.5 text-sm font-medium text-fg">On this page</p>
			<div className="grid gap-1 sm:grid-cols-2">
				{ARTICLE_SECTIONS.map((section) => (
					<a
						className="rounded border border-transparent px-2 py-1 text-sm text-fg-secondary hover:border-accent/35 hover:bg-accent-surface hover:text-accent-fg"
						href={`#${slug}-${section.id}`}
						key={section.id}
					>
						{section.label}
					</a>
				))}
			</div>
		</nav>
	);
}

function TimelinePreview() {
	const rows = [
		{ label: "dot 1", left: "4%", width: "34%" },
		{ label: "dot 2", left: "11%", width: "34%" },
		{ label: "dot 3", left: "18%", width: "34%" },
		{ label: "dot 4", left: "25%", width: "34%" },
		{ label: "dot 5", left: "32%", width: "34%" },
	] as const;

	return (
		<div className="grid min-h-96 overflow-hidden rounded-lg border border-hairline/12 bg-surface text-ui text-fg lg:grid-cols-[minmax(8rem,0.24fr)_1fr_minmax(9rem,0.28fr)] lg:grid-rows-[2rem_1fr_7rem]">
			<div className="flex items-center gap-1.5 border-hairline/10 border-b bg-surface-raised px-2 lg:col-span-3">
				<span className="size-2 rounded bg-accent" />
				<span className="font-medium text-fg">Vecmo</span>
				<span className="text-fg-muted">Updates / Motion</span>
			</div>
			<div className="hidden border-hairline/10 border-r bg-surface-raised/70 p-2 lg:block">
				<p className="mb-2 font-medium text-fg-secondary">Layers</p>
				<div className="space-y-1">
					{["Time Delay dot 1", "Time Delay dot 2", "Time Delay dot 3"].map(
						(layer) => (
							<div
								className="flex items-center gap-1 rounded border border-hairline/8 bg-surface px-1.5 py-1 text-fg-muted"
								key={layer}
							>
								<span className="size-1.5 rounded-full bg-ink" />
								<span className="truncate">{layer}</span>
							</div>
						),
					)}
					<div className="rounded border border-accent/35 bg-accent-surface px-1.5 py-1 text-accent-fg">
						Time Delay expansion
					</div>
				</div>
			</div>
			<div className="relative min-h-72 overflow-hidden bg-surface-light">
				<div className="absolute inset-0 opacity-55 checkerboard" />
				<div className="absolute top-10 left-1/2 h-44 w-72 -translate-x-1/2 rounded border border-ink/10 bg-surface-light shadow-2xl" />
				<div className="absolute top-24 left-1/2 flex -translate-x-1/2 items-end gap-2">
					{[0, 1, 2, 3, 4].map((item) => (
						<span
							className="block rounded-full border border-accent/45 bg-ink shadow-lg shadow-accent/25"
							key={item}
							style={{
								width: `${22 + item * 2}px`,
								height: `${22 + item * 2}px`,
								transform: `translateY(${Math.abs(item - 2) * -8}px)`,
							}}
						/>
					))}
				</div>
				<div className="absolute right-1/4 bottom-20 h-14 w-7 rounded-full border border-accent/45 bg-ink shadow-lg shadow-accent/25" />
			</div>
			<div className="hidden border-hairline/10 border-l bg-surface-raised/70 p-2 lg:block">
				<p className="mb-2 font-medium text-fg-secondary">Inspector</p>
				<div className="mb-2 rounded border border-accent/25 bg-accent-surface/45 p-1.5">
					<p className="truncate text-fg">Time Delay expansion</p>
					<p className="text-fg-muted">clip / 90f</p>
				</div>
				<div className="space-y-1">
					{[
						["Start", "0"],
						["Duration", "90"],
						["Period", "90"],
						["Stagger", "4"],
					].map(([label, value]) => (
						<div
							className="flex items-center justify-between border-hairline/10 border-b py-1 text-fg-muted"
							key={label}
						>
							<span>{label}</span>
							<span className="font-mono text-fg-secondary">{value}</span>
						</div>
					))}
				</div>
				<div className="mt-2 rounded border border-hairline/10 bg-surface px-1.5 py-1 text-fg-secondary">
					Master objects
				</div>
			</div>
			<div className="border-hairline/10 border-t bg-surface-raised p-2 lg:col-span-3">
				<div className="mb-2 flex items-center justify-between text-fg-muted">
					<span>Motion system timeline</span>
					<span>18 / 180 30fps</span>
				</div>
				<div className="grid gap-1">
					{rows.map((row) => (
						<div
							className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2"
							key={row.label}
						>
							<span className="text-fg-muted">{row.label}</span>
							<div className="relative h-3 rounded bg-surface-sunken">
								<div
									className="absolute top-0 bottom-0 rounded border border-accent/50 bg-accent-surface"
									style={{ left: row.left, width: row.width }}
								/>
								<div className="absolute top-0 bottom-0 left-[28%] w-px bg-danger" />
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

/**
 * One full update article in a single readable reading column. The optional
 * Time-Delay editor mockup is rendered as a full-width figure only for the entry
 * whose slug matches {@link PREVIEW_UPDATE_SLUG}; every other update omits it.
 */
function UpdateArticle({
	update,
	withPreview,
}: {
	readonly update: ProductUpdateEntry;
	readonly withPreview: boolean;
}) {
	return (
		<article
			className="mx-auto max-w-3xl scroll-mt-16 px-5 py-12"
			id={update.slug}
		>
			<div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
				<span className="inline-flex items-center gap-1 rounded border border-hairline/10 bg-surface px-2 py-1">
					<FlowArrow aria-hidden="true" size={12} />
					Update / {update.category}
				</span>
				<span className="inline-flex items-center gap-1 rounded border border-hairline/10 bg-surface px-2 py-1">
					<CalendarBlank aria-hidden="true" size={12} />
					{update.date}
				</span>
				<span className="rounded border border-accent/35 bg-accent-surface px-2 py-1 text-accent-fg">
					{statusLabel(update.status)}
				</span>
			</div>

			<h1 className="mb-3 text-2xl font-medium text-fg lg:text-3xl">
				{update.title}
			</h1>
			<p className="mb-6 text-base text-fg-secondary leading-relaxed">
				{update.summary}
			</p>

			<div className="mb-8 flex flex-wrap gap-2.5">
				<a
					className="inline-flex h-9 items-center gap-1.5 rounded-md border border-accent/45 bg-accent-surface px-3.5 text-sm font-medium text-accent-fg hover:border-accent"
					href="/editor"
				>
					<Play aria-hidden="true" size={15} weight="fill" />
					Open editor
				</a>
				<a
					className="inline-flex h-9 items-center gap-1.5 rounded-md border border-hairline/10 bg-surface px-3.5 text-sm text-fg-secondary hover:border-accent/45 hover:text-fg"
					href={`#${update.slug}-details`}
				>
					<ArrowSquareOut aria-hidden="true" size={15} />
					Jump to details
				</a>
			</div>

			{withPreview ? (
				<figure className="mb-8">
					<TimelinePreview />
					<figcaption className="mt-2 text-xs text-fg-muted">
						Illustrative editor view of the motion-system clip and its master
						objects.
					</figcaption>
				</figure>
			) : null}

			<ArticleContents slug={update.slug} />

			<section className="mb-10" id={`${update.slug}-what-changed`}>
				<h2 className="mb-3 text-lg font-medium text-fg">What changed</h2>
				<ClaimList claims={update.highlights} />
			</section>

			<section className="mb-10" id={`${update.slug}-workflow`}>
				<h2 className="mb-3 text-lg font-medium text-fg">Workflow</h2>
				<ClaimList claims={update.workflow} />
			</section>

			<section
				className="mb-10 grid gap-8 border-hairline/10 border-t pt-8 sm:grid-cols-2"
				id={`${update.slug}-details`}
			>
				<div id={`${update.slug}-before-after`}>
					<h2 className="mb-3 text-lg font-medium text-fg">Before / After</h2>
					<DetailRows details={update.beforeAfter} />
				</div>
				<div id={`${update.slug}-details-table`}>
					<h2 className="mb-3 text-lg font-medium text-fg">Details</h2>
					<DetailRows details={update.details} />
				</div>
			</section>

			<section className="mb-10 grid gap-8 border-hairline/10 border-t pt-8 sm:grid-cols-2">
				<div id={`${update.slug}-why-it-matters`}>
					<h2 className="mb-3 text-lg font-medium text-fg">Why it matters</h2>
					<ClaimList claims={update.whyItMatters} />
				</div>
				<div id={`${update.slug}-limits`}>
					<h2 className="mb-3 text-lg font-medium text-fg">Current limits</h2>
					<ClaimList claims={update.limits} />
				</div>
			</section>

			<footer
				className="border-hairline/10 border-t pt-8 text-fg-muted"
				id={`${update.slug}-sources`}
			>
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div>
						<p className="text-sm font-medium text-fg-secondary">
							Source of truth
						</p>
						<p className="text-xs">
							Public copy is derived from product-knowledge docs.
						</p>
					</div>
					<div className="flex flex-wrap gap-2">
						{update.canonicalSources.map((source) => (
							<span
								className="rounded border border-hairline/10 bg-surface px-2 py-1 text-xs"
								key={`${source.path}:${source.heading}`}
								title={source.path}
							>
								{source.heading}
							</span>
						))}
					</div>
				</div>
			</footer>
		</article>
	);
}

export function UpdatesPage() {
	useEffect(() => {
		const previousTitle = document.title;
		document.title = "Product updates - Vecmo";
		return () => {
			document.title = previousTitle;
		};
	}, []);

	const activeSlug = PUBLIC_UPDATES[0]?.slug ?? "";
	const scrollRef = useInPageAnchorScroll<HTMLElement>();

	return (
		<main
			className="h-svh overflow-y-auto bg-surface-sunken text-sm text-fg"
			ref={scrollRef}
		>
			<header className="sticky top-0 z-20 flex h-12 items-center justify-between border-hairline/10 border-b bg-surface/95 px-5 text-xs backdrop-blur">
				<a className="font-medium text-fg" href="/">
					Vecmo
				</a>
				<nav className="flex items-center gap-3 text-fg-muted">
					<a className="hover:text-fg" href="/">
						Home
					</a>
					<a className="hover:text-fg" href="/tutorials">
						Tutorials
					</a>
					<a
						className="inline-flex h-7 items-center gap-1 rounded border border-accent/45 bg-accent-surface px-2.5 font-medium text-accent-fg hover:border-accent"
						href="/editor"
					>
						<Play aria-hidden="true" size={13} weight="fill" />
						Open editor
					</a>
				</nav>
			</header>

			<UpdatesDirectory activeSlug={activeSlug} />

			<div className="divide-y divide-hairline/10">
				{PUBLIC_UPDATES.map((update) => (
					<UpdateArticle
						key={update.slug}
						update={update}
						withPreview={update.slug === PREVIEW_UPDATE_SLUG}
					/>
				))}
			</div>
		</main>
	);
}
