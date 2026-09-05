import { ArrowRight, ArrowSquareOut, Play } from "@phosphor-icons/react";
import { useMemo } from "react";
import { renderSceneSvgWithIssues } from "@/features/export/model/svg";
import { findReferenceFixture } from "@/features/reference-scenes/fixtures";
import { PUBLIC_REFERENCE_SCENES } from "@/features/reference-scenes/model/registry";
import { resolveReferenceScene } from "@/features/reference-scenes/model/resolve";
import {
	findTutorialContent,
	type TutorialContent,
} from "@/features/reference-scenes/model/tutorial-content";
import type {
	ReferenceSceneMeta,
	ReferenceSceneStatus,
} from "@/features/reference-scenes/model/types";
import { cn } from "@/shared/lib/cn";

type ReferenceSceneCard = {
	readonly meta: ReferenceSceneMeta;
	/** Raw SVG markup (not a data-URI) — rendered inline so filter effects
	 * (grain, blur, Analog Film grade) rasterize at device resolution instead
	 * of Chrome's 1x-then-upscale `<img src="data:image/svg+xml...">` path,
	 * which reads as mushy/blocky on a retina display. See {@link buildCard}. */
	readonly markup: string | null;
	/** The resolved scene's own artboard background, so a card's poster area
	 * never letterboxes against a mismatched chrome token — see {@link buildCard}. */
	readonly posterBackground: string | null;
	/** Tutorial goal/steps for this slug. `undefined` only if a registry entry
	 * somehow ships without a `TUTORIAL_CONTENT` match — `check:reference-scenes`
	 * gates this pairing, so cards render defensively rather than assuming it. */
	readonly tutorial: TutorialContent | undefined;
};

/**
 * Every poster on this page renders inline into ONE document, but the SVG
 * exporter mints ids that are stable per *document* (e.g. `vecmo-frame-visual-
 * recipe-<artboardId>`, `paint-<nodeId>-fill-0`), not per *render call* — the
 * three Analog Film reference scenes each carry an artboard named the same way
 * across renders, so their filter/pattern/clip ids collide. Left unprefixed,
 * the first poster's `<filter id="...">` (etc.) would win and the later
 * posters referencing the same id via `url(#...)` would pick up the first
 * poster's definition instead of their own — a silently wrong or blank poster,
 * not a rendering error.
 *
 * This prefixes every id definition and every fragment reference with the
 * scene's own slug so ids are unique per rendered card. It intentionally does
 * NOT touch `href="data:..."` (the mesh gradient's embedded PNG bitmap) —
 * only `#`-anchored fragment references are ids, a `data:` URL is unrelated
 * data that happens to also live in an `href` attribute.
 */
const namespaceSvgIds = (svg: string, slug: string): string =>
	svg
		.replaceAll(/\bid="([^"]+)"/g, (_match, id: string) => `id="${slug}-${id}"`)
		.replaceAll(
			/url\(#([^)]+)\)/g,
			(_match, id: string) => `url(#${slug}-${id})`,
		)
		.replaceAll(
			/\b(xlink:href|href)="#([^"]+)"/g,
			(_match, attr: string, id: string) => `${attr}="#${slug}-${id}"`,
		);

/**
 * Renders a reference scene to static SVG markup sampled at its `posterFrame`,
 * id-namespaced per {@link namespaceSvgIds} so it can be injected inline
 * alongside the other cards, and reads the resolved scene's own artboard
 * background alongside it. This reuses the editor's pure, store-free SVG
 * renderer so the poster is byte-faithful to what the scene shows in the
 * editor — no live canvas or sampler loop runs on the gallery. Returns null
 * markup/background if the fixture is missing or the render fails, so one bad
 * scene degrades to a placeholder instead of taking down the page.
 */
const buildCard = (meta: ReferenceSceneMeta): ReferenceSceneCard => {
	const tutorial = findTutorialContent(meta.slug);
	const fixture = findReferenceFixture(meta.slug);
	if (!fixture) return { meta, markup: null, posterBackground: null, tutorial };
	try {
		const resolved = resolveReferenceScene(fixture);
		const svg = renderSceneSvgWithIssues({
			scene: resolved.scene,
			motion: resolved.motion,
			frame: meta.posterFrame,
			grammarBindings: resolved.grammar.bindings,
		});
		return {
			meta,
			markup: namespaceSvgIds(svg.contents, meta.slug),
			posterBackground: resolved.scene.artboard.background,
			tutorial,
		};
	} catch {
		return { meta, markup: null, posterBackground: null, tutorial };
	}
};

/**
 * Canonical (extensionless) URL for an entry's export-result page. Cloudflare
 * asset serving treats `/foo` as the canonical form of `/foo.html` and 307s
 * the `.html` URL to it — linking the canonical form skips that redirect.
 */
const exportDemoHref = (meta: ReferenceSceneMeta): string =>
	`/tutorial-exports/${meta.exportDemo.replace(/\.html$/, "")}`;

const categoryChipClass = (category: string): string =>
	category === "Motion"
		? "border-accent/40 bg-accent/10 text-accent"
		: "border-hairline/15 bg-surface-raised text-fg-secondary";

/** Beta/internal get a status chip; public is the default and stays unbadged. */
function StatusChip({ status }: { readonly status: ReferenceSceneStatus }) {
	if (status === "public") return null;
	if (status === "beta") {
		return (
			<span className="rounded border border-warn/40 bg-warn-surface px-1.5 py-0.5 text-warn-fg text-xs">
				Beta
			</span>
		);
	}
	return (
		<span className="rounded border border-danger/40 bg-danger-surface px-1.5 py-0.5 text-danger-fg text-xs">
			Internal
		</span>
	);
}

/**
 * Renders the poster's SVG markup inline in the DOM (not `<img src="data:...">`)
 * so filter effects rasterize at device resolution. This is our own
 * exporter-generated markup — id-namespaced by {@link namespaceSvgIds}, never
 * user input — so `dangerouslySetInnerHTML` is safe here.
 */
function ReferenceScenePoster({ card }: { readonly card: ReferenceSceneCard }) {
	if (!card.markup) {
		return (
			<div className="flex h-full items-center justify-center text-fg-muted text-xs">
				Preview unavailable
			</div>
		);
	}
	return (
		<div
			aria-label={`${card.meta.title} preview`}
			className="h-full w-full transition-transform duration-200 motion-safe:group-hover:scale-[1.02] [&>svg]:h-full [&>svg]:w-full"
			role="img"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: our own exporter-generated SVG markup, not user input.
			dangerouslySetInnerHTML={{ __html: card.markup }}
		/>
	);
}

/** Shared neutral "raised chip" recipe for tutorial meta (step count, time). */
const metaChipClass =
	"rounded border border-hairline/15 bg-surface-raised px-1.5 py-0.5 text-fg-secondary text-xs";

const STEP_PREVIEW_COUNT = 3;

/**
 * The first registry entry rendered as a full-width featured card: a large
 * poster paired with a display headline, the tutorial's goal and meta chips,
 * a compact preview of its first steps, and a "Start tutorial" CTA. Featuring
 * the catalog's first entry (rather than hard-coding a slug) keeps the hero in
 * sync with whichever scene the registry authors choose to lead with.
 */
function FeaturedReferenceScene({
	card,
}: {
	readonly card: ReferenceSceneCard;
}) {
	const { meta, tutorial } = card;
	const remainingSteps = tutorial
		? tutorial.steps.length - STEP_PREVIEW_COUNT
		: 0;
	return (
		<div className="group grid overflow-hidden rounded-xl border border-hairline/10 bg-surface transition-colors duration-200 hover:border-accent/45 lg:grid-cols-5">
			<a
				className="contents"
				href={`/editor?ref=${encodeURIComponent(meta.slug)}`}
			>
				<div
					className="aspect-video overflow-hidden lg:aspect-auto lg:col-span-3"
					style={
						card.posterBackground
							? { background: card.posterBackground }
							: undefined
					}
				>
					<ReferenceScenePoster card={card} />
				</div>
				<div className="flex flex-col justify-center gap-4 p-6 pb-0 lg:col-span-2 lg:p-8 lg:pb-0">
					<div className="flex items-center gap-2">
						<span
							className={cn(
								"rounded border px-1.5 py-0.5 text-xs",
								categoryChipClass(meta.category),
							)}
						>
							{meta.category}
						</span>
						<StatusChip status={meta.status} />
					</div>
					<h2 className="text-3xl text-fg tracking-tight lg:text-4xl">
						{meta.title}
					</h2>
					<p className="text-base text-fg-secondary leading-relaxed">
						{meta.summary}
					</p>
					{tutorial ? (
						<>
							<p className="text-fg-secondary text-sm leading-relaxed">
								{tutorial.goal}
							</p>
							<div className="flex items-center gap-2">
								<span className={metaChipClass}>
									~{tutorial.estimatedMinutes} min
								</span>
								<span className={metaChipClass}>
									{tutorial.steps.length} steps
								</span>
							</div>
							<ol className="grid gap-1 text-fg-muted text-xs">
								{tutorial.steps
									.slice(0, STEP_PREVIEW_COUNT)
									.map((step, index) => (
										<li key={step.title} className="flex gap-1.5">
											<span className="text-fg-subtle">{index + 1}.</span>
											<span>{step.title}</span>
										</li>
									))}
								{remainingSteps > 0 ? (
									<li className="text-fg-subtle">
										…and {remainingSteps} more{" "}
										{remainingSteps === 1 ? "step" : "steps"}
									</li>
								) : null}
							</ol>
						</>
					) : null}
				</div>
			</a>
			<div className="col-span-full flex flex-wrap items-center gap-2 p-6 pt-4 lg:col-span-2 lg:col-start-4 lg:p-8 lg:pt-4">
				<a
					className="inline-flex h-9 w-fit items-center gap-1.5 rounded-md border border-accent/45 bg-accent-surface px-3.5 font-medium text-accent-fg text-sm transition-colors duration-200 group-hover:border-accent"
					href={`/editor?ref=${encodeURIComponent(meta.slug)}`}
				>
					<Play aria-hidden="true" size={14} weight="fill" />
					Start tutorial
				</a>
				<a
					className="inline-flex h-9 w-fit items-center gap-1.5 rounded-md border border-hairline/15 bg-surface-raised px-3.5 font-medium text-fg-secondary text-sm transition-colors duration-200 hover:border-accent/45 hover:text-fg"
					href={exportDemoHref(meta)}
					rel="noopener noreferrer"
					target="_blank"
				>
					<ArrowSquareOut aria-hidden="true" size={14} />
					View export result
				</a>
			</div>
			<p className="col-span-full px-6 pb-6 text-fg-muted text-xs lg:col-span-2 lg:col-start-4 lg:px-8 lg:pb-8">
				The export result is the scene's real exported code — an HTML + JS pair
				— running unmodified.
			</p>
		</div>
	);
}

function ReferenceSceneCardItem({
	card,
}: {
	readonly card: ReferenceSceneCard;
}) {
	const { meta, tutorial } = card;
	return (
		<div className="group grid gap-3 overflow-hidden rounded-lg border border-hairline/10 bg-surface p-3 transition-colors duration-200 hover:border-accent/45">
			<a
				className="grid gap-3"
				href={`/editor?ref=${encodeURIComponent(meta.slug)}`}
			>
				<div
					className="aspect-video overflow-hidden rounded-md border border-hairline/10"
					style={
						card.posterBackground
							? { background: card.posterBackground }
							: undefined
					}
				>
					<ReferenceScenePoster card={card} />
				</div>
				<div className="grid gap-1.5 px-1">
					<div className="flex items-center justify-between gap-2">
						<h3 className="font-medium text-fg">{meta.title}</h3>
						<StatusChip status={meta.status} />
					</div>
					<p className="text-fg-secondary text-xs leading-relaxed line-clamp-2">
						{meta.summary}
					</p>
					{tutorial ? (
						<p className="text-fg-muted text-xs">
							{tutorial.steps.length} steps · ~{tutorial.estimatedMinutes} min
						</p>
					) : null}
				</div>
			</a>
			<div className="mt-1 flex items-center justify-between gap-2 px-1 pb-1">
				<span
					className={cn(
						"rounded border px-1.5 py-0.5 text-xs",
						categoryChipClass(meta.category),
					)}
				>
					{meta.category}
				</span>
				<div className="flex items-center gap-3">
					<a
						className="inline-flex items-center gap-1 text-fg-muted text-xs transition-colors duration-200 hover:text-accent"
						href={exportDemoHref(meta)}
						rel="noopener noreferrer"
						target="_blank"
					>
						View export result
						<ArrowSquareOut aria-hidden="true" size={11} />
					</a>
					<a
						className="inline-flex items-center gap-1 text-fg-secondary text-xs transition-colors duration-200 hover:text-accent"
						href={`/editor?ref=${encodeURIComponent(meta.slug)}`}
					>
						Start tutorial
						<ArrowRight aria-hidden="true" size={11} />
					</a>
				</div>
			</div>
		</div>
	);
}

/**
 * Public tutorial gallery (`/tutorials`). Each entry is a real, open-ready
 * vector + motion scene paired with a built-in step guide (goal, honest time
 * estimate, ordered steps) sourced from
 * `features/reference-scenes/model/tutorial-content`. The registry's first
 * entry leads as a full-width featured card (currently the Grainy gradient
 * orb); the remaining entries fill a thumbnail-forward grid. Opening a scene
 * in the editor is a `/editor?ref=<slug>` handoff that loads an ephemeral
 * session with its own in-editor guide panel (`widgets/tutorial-guide`) — the
 * user's own document is untouched.
 */
export function TutorialsPage() {
	const cards = useMemo<readonly ReferenceSceneCard[]>(
		() => PUBLIC_REFERENCE_SCENES.map(buildCard),
		[],
	);
	const [featured, ...rest] = cards;

	return (
		<main className="h-svh overflow-y-auto bg-surface-sunken text-fg text-sm">
			<header className="sticky top-0 z-20 flex h-12 items-center justify-between border-hairline/10 border-b bg-surface/95 px-5 text-xs backdrop-blur">
				<a className="font-medium text-fg" href="/">
					Vecmo
				</a>
				<nav className="flex items-center gap-4 text-fg-muted">
					<a className="text-fg" href="/tutorials">
						Tutorials
					</a>
					<a className="hover:text-fg" href="/updates">
						Updates
					</a>
					<a
						className="inline-flex h-7 items-center rounded-md border border-hairline/10 bg-surface-raised px-2.5 text-fg-secondary hover:border-accent/45 hover:text-fg"
						href="/editor"
					>
						Open editor
					</a>
				</nav>
			</header>

			<section className="mx-auto grid max-w-5xl gap-10 px-5 py-12">
				<div className="grid gap-3">
					<p className="text-fg-muted text-xs uppercase tracking-widest">
						Tutorials
					</p>
					<h1 className="font-medium text-3xl text-fg tracking-tight sm:text-4xl">
						Learn the editor by rebuilding real scenes
					</h1>
					<p className="max-w-2xl text-base text-fg-secondary leading-relaxed">
						Each scene opens in the editor with a built-in step guide, so you
						learn a capability by actually using the tool that built it — not by
						reading about it.
					</p>
				</div>

				{featured ? <FeaturedReferenceScene card={featured} /> : null}

				<ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{rest.map((card) => (
						<li key={card.meta.slug}>
							<ReferenceSceneCardItem card={card} />
						</li>
					))}
				</ul>

				<p className="border-hairline/10 border-t pt-6 text-fg-muted text-xs">
					{cards.length} reference {cards.length === 1 ? "scene" : "scenes"} ·
					More scenes coming.
				</p>
			</section>
		</main>
	);
}
