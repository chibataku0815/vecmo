import { CaretDown, CaretUp, Check } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { findReferenceScene } from "@/features/reference-scenes/model/registry";
import type { TutorialContent } from "@/features/reference-scenes/model/tutorial-content";
import { useEditorChromeStore } from "@/shared/editor-chrome/model/store";
import { cn } from "@/shared/lib/cn";

/**
 * Floating, collapsible step guide shown only for a reference-scene editor
 * session (`/editor?ref=<slug>` — see `app/App.tsx::ReferenceEditorRoute`).
 * It turns the gallery's "open a real scene" handoff into an actual guided
 * tour: goal, honest time estimate, and an ordered, checkable step list
 * sourced from `features/reference-scenes/model/tutorial-content`.
 *
 * State is local `useState` only — the session is ephemeral by design (no
 * persistence hooks run in `ReferenceEditorRoute`), so "done" checks and the
 * collapsed/expanded state reset on reload, matching the reference scene
 * itself never being saved.
 *
 * Tutorial copy is loaded via a cancelled-guarded dynamic `import()` (mirrors
 * `useReferenceSceneLoad` in `app/App.tsx`) so the ~few KB of tutorial prose
 * never joins the main `/editor` bundle's static import graph — only opening
 * a reference pulls it in, same discipline as the reference fixtures
 * themselves.
 */

const useTutorialContent = (
	slug: string,
): TutorialContent | null | undefined => {
	// undefined = still loading, null = loaded but no content for this slug.
	const [content, setContent] = useState<TutorialContent | null | undefined>(
		undefined,
	);

	useEffect(() => {
		let cancelled = false;
		setContent(undefined);
		void import("@/features/reference-scenes/model/tutorial-content").then(
			({ findTutorialContent }) => {
				if (cancelled) return;
				setContent(findTutorialContent(slug) ?? null);
			},
		);
		return () => {
			cancelled = true;
		};
	}, [slug]);

	return content;
};

function CollapsedPill({
	title,
	doneCount,
	stepCount,
	onExpand,
}: {
	readonly title: string;
	readonly doneCount: number;
	readonly stepCount: number;
	readonly onExpand: () => void;
}) {
	return (
		<button
			type="button"
			aria-label={`Expand tutorial guide for ${title}`}
			aria-expanded={false}
			onClick={onExpand}
			className="tutorial-guide pointer-events-auto flex h-7 items-center gap-1.5 rounded-md border border-hairline/12 bg-surface-raised/92 px-2.5 text-fg-secondary text-ui shadow-2xl shadow-black/35 backdrop-blur-xl transition-colors duration-150 hover:border-accent/45 hover:text-fg"
		>
			<CaretUp aria-hidden="true" size={11} />
			<span className="font-medium">
				Tutorial · {doneCount}/{stepCount}
			</span>
		</button>
	);
}

function TutorialStepRow({
	index,
	title,
	detail,
	done,
	current,
	onToggle,
}: {
	readonly index: number;
	readonly title: string;
	readonly detail: string;
	readonly done: boolean;
	readonly current: boolean;
	readonly onToggle: () => void;
}) {
	return (
		<li>
			<button
				type="button"
				aria-pressed={done}
				onClick={onToggle}
				className={cn(
					"flex w-full items-start gap-2 rounded-md border border-transparent px-1.5 py-1.5 text-left transition-colors duration-150 hover:bg-white/[0.05]",
					current && !done && "border-accent/35 bg-accent-surface/40",
				)}
			>
				<span
					className={cn(
						"mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border text-ui",
						done
							? "border-accent/50 bg-accent-surface text-accent-fg"
							: "border-hairline/20 text-fg-muted",
					)}
				>
					{done ? (
						<Check aria-hidden="true" size={10} weight="bold" />
					) : (
						index + 1
					)}
				</span>
				<span className="min-w-0 flex-1">
					<span
						className={cn(
							"block font-medium text-xs leading-4",
							done ? "text-fg-muted line-through" : "text-fg",
						)}
					>
						{title}
					</span>
					<span className="mt-0.5 block text-fg-secondary text-xs leading-4">
						{detail}
					</span>
				</span>
			</button>
		</li>
	);
}

function TutorialGuideForSlug({ slug }: { readonly slug: string }) {
	const content = useTutorialContent(slug);
	const meta = findReferenceScene(slug);
	const [collapsed, setCollapsed] = useState(false);
	const [doneSteps, setDoneSteps] = useState<ReadonlySet<number>>(new Set());
	// Timeline Mode squeezes the Layers/Inspector/tool-rail into one thin band
	// above the full-width docked timeline, leaving no floating slot wide enough
	// for the full card (see the `.editor-grid.timeline-mode .tutorial-guide`
	// CSS). Collapsing to the pill on ENTERING that mode keeps the guide out of
	// the way by default; the user can still re-expand it (their choice), and
	// leaving the mode does not fight a collapse they set themselves.
	const timelineMode = useEditorChromeStore(
		(state) => state.timelineOpen && state.timelineExpanded,
	);
	useEffect(() => {
		if (timelineMode) setCollapsed(true);
	}, [timelineMode]);

	if (!content || !meta) return null;

	const stepCount = content.steps.length;
	const doneCount = doneSteps.size;
	const currentIndex = content.steps.findIndex(
		(_, index) => !doneSteps.has(index),
	);

	if (collapsed) {
		return (
			<CollapsedPill
				title={meta.title}
				doneCount={doneCount}
				stepCount={stepCount}
				onExpand={() => setCollapsed(false)}
			/>
		);
	}

	const toggleStep = (index: number): void => {
		setDoneSteps((current) => {
			const next = new Set(current);
			if (next.has(index)) next.delete(index);
			else next.add(index);
			return next;
		});
	};

	return (
		<div className="tutorial-guide pointer-events-auto flex w-72 flex-col overflow-hidden rounded-md border border-hairline/12 bg-surface-raised/92 text-fg shadow-2xl shadow-black/35 backdrop-blur-xl">
			<div className="flex shrink-0 items-center gap-2 border-hairline/10 border-b px-2.5 py-1.5">
				<div className="min-w-0 flex-1">
					<div className="text-fg-muted text-ui uppercase tracking-wide">
						Tutorial
					</div>
					<div className="truncate font-medium text-xs leading-4">
						{meta.title}
					</div>
				</div>
				<span className="shrink-0 text-fg-muted text-ui">
					~{content.estimatedMinutes} min
				</span>
				<button
					type="button"
					aria-label="Collapse tutorial guide"
					aria-expanded={true}
					onClick={() => setCollapsed(true)}
					className="grid size-6 shrink-0 place-items-center rounded text-fg-muted transition-colors duration-150 hover:bg-white/[0.08] hover:text-fg"
				>
					<CaretDown aria-hidden="true" size={12} />
				</button>
			</div>

			<p className="shrink-0 border-hairline/10 border-b px-2.5 py-1.5 text-fg-secondary text-xs leading-4">
				{content.goal}
			</p>

			<ol className="chrome-scrollbar-thin min-h-0 max-h-[min(48svh,420px)] flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-1 py-1">
				{content.steps.map((step, index) => (
					<TutorialStepRow
						key={step.title}
						index={index}
						title={step.title}
						detail={step.detail}
						done={doneSteps.has(index)}
						current={index === currentIndex}
						onToggle={() => toggleStep(index)}
					/>
				))}
			</ol>

			<div className="flex shrink-0 items-center justify-between gap-2 border-hairline/10 border-t px-2.5 py-1.5">
				<a
					href="/tutorials"
					className="text-fg-secondary text-ui transition-colors duration-150 hover:text-accent"
				>
					Back to tutorials
				</a>
				<span className="text-fg-muted text-ui">
					{doneCount}/{stepCount}
				</span>
			</div>
		</div>
	);
}

/**
 * Keying by `slug` remounts {@link TutorialGuideForSlug} whenever the reference
 * scene changes, which is the correct way to reset its local
 * collapsed/done-steps state on a fresh tutorial — no effect needed, and no
 * stale-checklist frame before an effect would have fired.
 */
export function TutorialGuide({ slug }: { readonly slug: string }) {
	return <TutorialGuideForSlug key={slug} slug={slug} />;
}
