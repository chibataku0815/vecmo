export type CodeSafeTextFontOption = {
	readonly id: string;
	readonly label: string;
	readonly value: string;
	readonly description: string;
};

/**
 * Font-family stacks that remain meaningful in generated SVG/HTML/React code
 * without requiring project-specific font files. Labels are UI-facing; values
 * are the exact CSS/SVG `font-family` strings persisted in scene text style.
 */
export const CODE_SAFE_TEXT_FONT_OPTIONS = [
	{
		id: "inter-system",
		label: "Inter / System Sans",
		value: "Inter, system-ui, sans-serif",
		description: "Current editor default with a stable sans-serif fallback.",
	},
	{
		id: "system-ui",
		label: "System UI",
		value:
			'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
		description: "Native app-like UI text across modern platforms.",
	},
	{
		id: "web-sans",
		label: "Web Sans",
		value: "Arial, Helvetica, sans-serif",
		description: "Broad browser-safe sans-serif stack for exported code.",
	},
	{
		id: "web-serif",
		label: "Web Serif",
		value: 'Georgia, "Times New Roman", serif',
		description: "Broad browser-safe serif stack for exported code.",
	},
	{
		id: "code-mono",
		label: "Code Mono",
		value: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
		description: "Monospace stack for labels that should read like code.",
	},
	{
		id: "japanese-ui",
		label: "Japanese UI Sans",
		value: '"Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif',
		description: "System-oriented Japanese sans-serif stack for code export.",
	},
] as const satisfies readonly CodeSafeTextFontOption[];

export const DEFAULT_CODE_SAFE_TEXT_FONT_FAMILY =
	CODE_SAFE_TEXT_FONT_OPTIONS[0].value;

const codeSafeTextFontFamilies = new Set<string>(
	CODE_SAFE_TEXT_FONT_OPTIONS.map((option) => option.value),
);

/**
 * Accepts only the exact font-family stacks this editor can safely emit into
 * generated code. Imported legacy text may still carry arbitrary font strings,
 * but new Inspector edits intentionally stay inside this curated set.
 */
export function normalizeCodeSafeTextFontFamily(input: string): string | null {
	const value = input.trim();
	return codeSafeTextFontFamilies.has(value) ? value : null;
}

export function isCodeSafeTextFontFamily(input: string): boolean {
	return normalizeCodeSafeTextFontFamily(input) !== null;
}
