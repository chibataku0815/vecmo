/**
 * Triggers a browser download of in-memory text as a file. Kept generic (no
 * domain types) so any feature can hand off "save this string as a file"
 * without re-implementing the Blob/anchor dance or leaking it into model code.
 */
export function downloadTextFile(
	fileName: string,
	mimeType: string,
	contents: string,
): void {
	const blob = new Blob([contents], { type: mimeType });
	const url = URL.createObjectURL(blob);
	try {
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = fileName;
		anchor.rel = "noopener";
		document.body.append(anchor);
		anchor.click();
		anchor.remove();
	} finally {
		URL.revokeObjectURL(url);
	}
}

/** Reads a browser-selected file as UTF-8 text. */
export async function readFileAsText(file: File): Promise<string> {
	return await file.text();
}
