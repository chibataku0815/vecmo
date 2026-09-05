import type { ImportIssue } from "./types";

const SVG_SOURCE_FORMAT = "svg";
const AI_SOURCE_FORMAT = "ai";
const READABLE_HEAD_BYTES = 4096;

export type ImportFileRoute = "svg" | "ai" | "unsupported";

export type ImportFileDescriptor = {
	readonly name: string;
	readonly type?: string;
	readonly bytes: Uint8Array;
};

export type ClientImportFile =
	| {
			readonly kind: "svg";
			readonly sourceName: string;
			readonly sourceFormat: typeof SVG_SOURCE_FORMAT;
			readonly text: string;
	  }
	| {
			readonly kind: "ai";
			readonly sourceName: string;
			readonly sourceFormat: typeof AI_SOURCE_FORMAT;
			readonly bytes: Uint8Array;
	  }
	| {
			readonly kind: "unsupported";
			readonly sourceName: string;
			readonly sourceFormat: "unknown";
			readonly issues: readonly ImportIssue[];
	  };

const decoder = new TextDecoder("utf-8", { fatal: false });

const extensionFor = (name: string): string => {
	const extension = name.trim().toLowerCase().split(".").at(-1);
	return extension && extension !== name.toLowerCase() ? extension : "";
};

const textHead = (bytes: Uint8Array): string =>
	decoder.decode(bytes.slice(0, READABLE_HEAD_BYTES));

const startsWithAscii = (bytes: Uint8Array, text: string): boolean => {
	if (bytes.length < text.length) return false;
	for (let index = 0; index < text.length; index += 1) {
		if (bytes[index] !== text.charCodeAt(index)) return false;
	}
	return true;
};

const looksLikeSvg = (head: string): boolean =>
	/<svg(?:\s|>)/i.test(head) || /<\?xml[\s\S]*<svg(?:\s|>)/i.test(head);

const unsupportedIssue = (sourceName: string): ImportIssue => ({
	severity: "error",
	code: "import.unsupported-file-type",
	message: "Only SVG and PDF-compatible .ai files can be imported here.",
	source: sourceName,
});

/**
 * Routes a browser-selected file to the pure parser boundary. It combines file
 * extension, MIME type, and lightweight content sniffing so the UI can reject
 * unsupported files visibly without leaking browser File APIs into parser code.
 */
export function routeImportFile({
	name,
	type,
	bytes,
}: ImportFileDescriptor): ImportFileRoute {
	const extension = extensionFor(name);
	const mime = type?.toLowerCase() ?? "";
	const head = textHead(bytes);

	if (extension === "svg" || mime === "image/svg+xml" || looksLikeSvg(head)) {
		return "svg";
	}

	if (
		extension === "ai" ||
		mime === "application/postscript" ||
		startsWithAscii(bytes, "%PDF-")
	) {
		return "ai";
	}

	return "unsupported";
}

/**
 * Reads a browser File once and returns parser-ready data. SVG text is decoded
 * at the client boundary; `.ai` stays bytes so PDF-compatible analysis remains
 * independent from browser APIs and can be tested as pure logic.
 */
export async function readImportFile(file: File): Promise<ClientImportFile> {
	const sourceName = file.name || "Untitled import";
	const bytes = new Uint8Array(await file.arrayBuffer());
	const route = routeImportFile({ name: sourceName, type: file.type, bytes });

	if (route === "svg") {
		return {
			kind: "svg",
			sourceName,
			sourceFormat: SVG_SOURCE_FORMAT,
			text: decoder.decode(bytes),
		};
	}

	if (route === "ai") {
		return {
			kind: "ai",
			sourceName,
			sourceFormat: AI_SOURCE_FORMAT,
			bytes,
		};
	}

	return {
		kind: "unsupported",
		sourceName,
		sourceFormat: "unknown",
		issues: [unsupportedIssue(sourceName)],
	};
}
