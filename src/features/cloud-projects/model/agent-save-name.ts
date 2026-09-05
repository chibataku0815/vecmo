import type { MotionDocument } from "@/entities/motion/model/types";
import { findCatalogEntry } from "@/entities/motion-grammar/model/catalog";
import type { MotionGrammarStoreDocument } from "@/entities/motion-grammar/model/command";
import {
	allNodes,
	selectCurrentArtboard,
	selectSceneArtboards,
} from "@/entities/scene/model/selectors";
import type { SceneDocument, VectorNode } from "@/entities/scene/model/types";

export type AgentCloudProjectSaveMode = "save" | "save-as-new" | "save-as-copy";

export type AgentCloudProjectNameInput = {
	readonly explicitName?: string;
	readonly intent?: string;
	readonly mode: AgentCloudProjectSaveMode;
	readonly activeProjectName?: string | null;
	readonly scene: SceneDocument;
	readonly motion: MotionDocument;
	readonly grammar: MotionGrammarStoreDocument;
};

const MAX_AGENT_PROJECT_NAME_LENGTH = 96;
const MAX_TEXT_WORDS = 8;

const GENERIC_NAME_KEYS = new Set([
	"",
	"untitled",
	"untitled project",
	"new project",
	"project",
	"scene",
	"document",
	"artboard",
	"artboard 1",
	"motion vector study",
	"motion poster 01",
	"motion poster square",
]);

const INTENT_PREFIX_PATTERN =
	/^(?:please\s+)?(?:save|persist|store|create|creating|make|making|build|building|author|authoring|design|designing|implement|implementing|apply|applying|add|adding|update|updating|revise|revising|refine|refining|generate|generating|produce|producing)\b\s*/iu;

const INTENT_SUFFIX_PATTERN =
	/\b(?:to|into|in|through|via)\s+(?:the\s+)?(?:cloud|cloud\s+project|live\s+editor|editor|mcp|agent\s+bridge)\.?$/iu;

const INTENT_STOP_WORDS = new Set([
	"a",
	"an",
	"and",
	"as",
	"cloud",
	"copy",
	"current",
	"document",
	"editor",
	"file",
	"live",
	"new",
	"now",
	"project",
	"save",
	"saved",
	"saving",
	"the",
	"to",
]);

const SMALL_TITLE_WORDS = new Set([
	"and",
	"as",
	"for",
	"in",
	"of",
	"on",
	"to",
	"with",
]);

const normalizeWhitespace = (value: string): string =>
	value.trim().replace(/\s+/gu, " ");

const normalizeCandidate = (
	value: string | null | undefined,
): string | null => {
	if (typeof value !== "string") return null;
	const normalized = normalizeWhitespace(value.replace(/[_-]+/gu, " "));
	return normalized.length > 0 ? normalized : null;
};

const comparableKey = (value: string): string =>
	normalizeWhitespace(
		value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " "),
	);

const isGenericName = (value: string | null | undefined): boolean => {
	if (!value) return true;
	return GENERIC_NAME_KEYS.has(comparableKey(value));
};

const meaningfulName = (value: string | null | undefined): string | null => {
	const normalized = normalizeCandidate(value);
	if (!normalized || isGenericName(normalized)) return null;
	return normalized;
};

const titleCaseReadable = (value: string): string => {
	const words = value.split(" ");
	const cased = words.map((word, index) => {
		if (/^v\d+/iu.test(word)) return word;
		if (/^[a-z][a-z0-9']*$/u.test(word)) {
			if (index > 0 && SMALL_TITLE_WORDS.has(word)) return word;
			return `${word.slice(0, 1).toLocaleUpperCase()}${word.slice(1)}`;
		}
		if (!/[A-Z]/u.test(word) || word !== word.toLocaleUpperCase()) return word;
		return `${word.slice(0, 1)}${word.slice(1).toLocaleLowerCase()}`;
	});
	return cased.join(" ");
};

const truncateName = (value: string): string => {
	if (value.length <= MAX_AGENT_PROJECT_NAME_LENGTH) return value;
	return value.slice(0, MAX_AGENT_PROJECT_NAME_LENGTH).replace(/\s+\S*$/u, "");
};

const cleanName = (value: string): string =>
	truncateName(titleCaseReadable(normalizeWhitespace(value))).trim();

const includesMeaning = (container: string, item: string): boolean => {
	const haystack = comparableKey(container);
	const needle = comparableKey(item);
	return needle.length > 0 && haystack.includes(needle);
};

const uniqueParts = (
	parts: readonly (string | null | undefined)[],
): string[] => {
	const names: string[] = [];
	for (const part of parts) {
		const name = meaningfulName(part);
		if (!name) continue;
		if (names.some((current) => includesMeaning(current, name))) continue;
		names.push(name);
	}
	return names;
};

const wordsForTitle = (value: string): string => {
	const words = comparableKey(value).split(" ").filter(Boolean);
	return words.slice(0, MAX_TEXT_WORDS).join(" ");
};

const textTitleFromNode = (node: VectorNode): string | null => {
	if (node.geometry.kind !== "text") return null;
	const text = wordsForTitle(node.geometry.text);
	return meaningfulName(text);
};

const primaryTextTitle = (nodes: readonly VectorNode[]): string | null => {
	const candidates = nodes
		.filter((node) => node.visible)
		.map(textTitleFromNode)
		.filter((value): value is string => value !== null)
		.sort((a, b) => b.length - a.length);
	return candidates[0] ?? null;
};

const primaryNodeName = (nodes: readonly VectorNode[]): string | null => {
	const candidates = nodes
		.filter((node) => node.visible)
		.map((node) => meaningfulName(node.name))
		.filter((value): value is string => value !== null)
		.filter((name) => !name.toLocaleLowerCase().startsWith("node "));
	return candidates[0] ?? null;
};

const geometrySummary = (nodes: readonly VectorNode[]): string | null => {
	const visibleNodes = nodes.filter((node) => node.visible);
	if (visibleNodes.length === 0) return null;
	const counts = new Map<string, number>();
	for (const node of visibleNodes) {
		counts.set(node.geometry.kind, (counts.get(node.geometry.kind) ?? 0) + 1);
	}
	const [kind, count] = [...counts.entries()].sort(
		(a, b) => b[1] - a[1],
	)[0] ?? ["vector", visibleNodes.length];
	const label =
		kind === "text"
			? "Type"
			: kind === "path"
				? "Path"
				: kind === "rect"
					? "Shape"
					: kind === "ellipse"
						? "Ellipse"
						: "Vector";
	return count > 1 ? `${label} scene` : label;
};

const grammarTitle = (
	grammar: MotionGrammarStoreDocument,
	motion: MotionDocument,
): string | null => {
	const binding = grammar.bindings[0];
	if (binding) {
		return meaningfulName(findCatalogEntry(binding.techniqueId)?.label);
	}
	const clip = motion.clips.find((candidate) => meaningfulName(candidate.name));
	if (clip) return meaningfulName(clip.name);
	if (
		motion.tracks.length > 0 ||
		(motion.lookNodeTracks?.length ?? 0) > 0 ||
		(motion.textAnimators?.length ?? 0) > 0 ||
		motion.automation !== undefined
	) {
		return "Motion";
	}
	return null;
};

const effectTitle = (scene: SceneDocument): string | null => {
	const artboard = selectCurrentArtboard(scene);
	const intent = artboard.effectIntent ?? scene.effectIntent;
	if (!intent) return null;
	if (intent.lookGraph) return "Look Graph";
	if (intent.scopedLooks && intent.scopedLooks.length > 0) return "Object Look";
	if (intent.effectLayerStack && intent.effectLayerStack.layers.length > 0) {
		return "Layered Look";
	}
	if (intent.visualRecipe) return "Frame Look";
	return null;
};

const documentTitle = (scene: SceneDocument): string | null => {
	const nodes = allNodes(scene);
	const sceneBoardNames = selectSceneArtboards(scene).map((artboard) =>
		meaningfulName(artboard.name),
	);
	return (
		meaningfulName(scene.name) ??
		meaningfulName(selectCurrentArtboard(scene).name) ??
		primaryTextTitle(nodes) ??
		sceneBoardNames.find((name): name is string => name !== null) ??
		primaryNodeName(nodes) ??
		geometrySummary(nodes)
	);
};

const hasMeaningfulIntentWords = (value: string): boolean =>
	comparableKey(value)
		.split(" ")
		.some((word) => word.length > 0 && !INTENT_STOP_WORDS.has(word));

const intentTitle = (
	intent: string | undefined,
	contentTitle: string | null,
): string | null => {
	const normalized = normalizeCandidate(intent);
	if (!normalized) return null;
	const withoutPrefix = normalized.replace(INTENT_PREFIX_PATTERN, "");
	const withoutSuffix = withoutPrefix.replace(INTENT_SUFFIX_PATTERN, "");
	const title = meaningfulName(withoutSuffix);
	if (!title || !hasMeaningfulIntentWords(title)) return null;
	if (contentTitle && !includesMeaning(title, contentTitle)) {
		return cleanName(`${contentTitle} ${title}`);
	}
	return cleanName(title);
};

const copyName = (name: string): string =>
	comparableKey(name).split(" ").at(-1) === "copy" ? name : `${name} copy`;

const derivedDocumentName = (
	scene: SceneDocument,
	motion: MotionDocument,
	grammar: MotionGrammarStoreDocument,
): string => {
	const title = documentTitle(scene);
	const parts = uniqueParts([
		title,
		grammarTitle(grammar, motion),
		effectTitle(scene),
	]);
	return cleanName(parts.length > 0 ? parts.join(" ") : "Untitled project");
};

/**
 * Resolves the default cloud-project name for MCP/live-agent saves. The live
 * editor owns this decision because it can combine the agent's intent with the
 * current scene, motion, grammar, and active cloud identity without expanding
 * the bridge or Worker request contracts.
 */
export function deriveAgentCloudProjectName({
	activeProjectName,
	explicitName,
	grammar,
	intent,
	mode,
	motion,
	scene,
}: AgentCloudProjectNameInput): string {
	const requested = meaningfulName(explicitName);
	if (requested) return cleanName(requested);

	const activeName = meaningfulName(activeProjectName);
	if (mode === "save" && activeName) return cleanName(activeName);

	const contentTitle = documentTitle(scene);
	const fromIntent = intentTitle(intent, contentTitle);
	const base = fromIntent ?? derivedDocumentName(scene, motion, grammar);
	const name = mode === "save-as-copy" ? copyName(base) : base;
	return cleanName(name);
}
