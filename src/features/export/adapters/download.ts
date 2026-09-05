import type { ExportBundle } from "../model/bundle";

export type DownloadableTextAsset = {
	readonly fileName: string;
	readonly mimeType: string;
	readonly contents: string;
};

const ZIP_MIME_TYPE = "application/zip";
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;
const ZIP_DOS_DATE_1980_01_01 = 0x0021;
const textEncoder = new TextEncoder();

const crcTable = (() => {
	const table = new Uint32Array(256);
	for (let index = 0; index < table.length; index += 1) {
		let value = index;
		for (let bit = 0; bit < 8; bit += 1) {
			value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
		}
		table[index] = value >>> 0;
	}
	return table;
})();

const crc32 = (bytes: Uint8Array): number => {
	let value = 0xffffffff;
	for (const byte of bytes) {
		value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
	}
	return (value ^ 0xffffffff) >>> 0;
};

const writeZipHeaderNumber = (
	view: DataView,
	offset: number,
	bytes: 2 | 4,
	value: number,
): number => {
	if (bytes === 2) {
		view.setUint16(offset, value, true);
		return offset + 2;
	}
	view.setUint32(offset, value, true);
	return offset + 4;
};

const createZipHeader = (
	byteLength: number,
	fill: (view: DataView) => void,
): Uint8Array<ArrayBuffer> => {
	const header = new Uint8Array(byteLength);
	fill(new DataView(header.buffer));
	return header;
};

const blobBytes = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy;
};

const assertZipSize = (value: number): void => {
	if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
		throw new Error("ZIP export is too large for the browser archive writer.");
	}
};

const assertZipShort = (value: number): void => {
	if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) {
		throw new Error(
			"ZIP export has too many files or a file name is too long.",
		);
	}
};

/**
 * Creates a no-compression ZIP blob for browser downloads. This keeps generated
 * runtime assets as separate files for hosting while avoiding a burst of download
 * prompts when Motion / Code emits split data and shared runtime output.
 */
export function createTextAssetArchiveBlob(
	assets: readonly DownloadableTextAsset[],
): Blob {
	const chunks: BlobPart[] = [];
	const centralDirectory: Uint8Array<ArrayBuffer>[] = [];
	let offset = 0;

	for (const asset of assets) {
		const fileName = blobBytes(textEncoder.encode(asset.fileName));
		const contents = blobBytes(textEncoder.encode(asset.contents));
		const checksum = crc32(contents);
		assertZipShort(fileName.byteLength);
		assertZipSize(offset);
		assertZipSize(contents.byteLength);
		const localOffset = offset;
		const localHeader = createZipHeader(30 + fileName.byteLength, (view) => {
			let cursor = 0;
			cursor = writeZipHeaderNumber(view, cursor, 4, 0x04034b50);
			cursor = writeZipHeaderNumber(view, cursor, 2, 10);
			cursor = writeZipHeaderNumber(view, cursor, 2, ZIP_UTF8_FLAG);
			cursor = writeZipHeaderNumber(view, cursor, 2, ZIP_STORE_METHOD);
			cursor = writeZipHeaderNumber(view, cursor, 2, 0);
			cursor = writeZipHeaderNumber(view, cursor, 2, ZIP_DOS_DATE_1980_01_01);
			cursor = writeZipHeaderNumber(view, cursor, 4, checksum);
			cursor = writeZipHeaderNumber(view, cursor, 4, contents.byteLength);
			cursor = writeZipHeaderNumber(view, cursor, 4, contents.byteLength);
			cursor = writeZipHeaderNumber(view, cursor, 2, fileName.byteLength);
			writeZipHeaderNumber(view, cursor, 2, 0);
		});
		localHeader.set(fileName, 30);
		chunks.push(localHeader, contents);
		offset += localHeader.byteLength + contents.byteLength;

		const centralHeader = createZipHeader(46 + fileName.byteLength, (view) => {
			let cursor = 0;
			cursor = writeZipHeaderNumber(view, cursor, 4, 0x02014b50);
			cursor = writeZipHeaderNumber(view, cursor, 2, 20);
			cursor = writeZipHeaderNumber(view, cursor, 2, 10);
			cursor = writeZipHeaderNumber(view, cursor, 2, ZIP_UTF8_FLAG);
			cursor = writeZipHeaderNumber(view, cursor, 2, ZIP_STORE_METHOD);
			cursor = writeZipHeaderNumber(view, cursor, 2, 0);
			cursor = writeZipHeaderNumber(view, cursor, 2, ZIP_DOS_DATE_1980_01_01);
			cursor = writeZipHeaderNumber(view, cursor, 4, checksum);
			cursor = writeZipHeaderNumber(view, cursor, 4, contents.byteLength);
			cursor = writeZipHeaderNumber(view, cursor, 4, contents.byteLength);
			cursor = writeZipHeaderNumber(view, cursor, 2, fileName.byteLength);
			cursor = writeZipHeaderNumber(view, cursor, 2, 0);
			cursor = writeZipHeaderNumber(view, cursor, 2, 0);
			cursor = writeZipHeaderNumber(view, cursor, 2, 0);
			cursor = writeZipHeaderNumber(view, cursor, 2, 0);
			cursor = writeZipHeaderNumber(view, cursor, 4, 0);
			writeZipHeaderNumber(view, cursor, 4, localOffset);
		});
		centralHeader.set(fileName, 46);
		centralDirectory.push(centralHeader);
	}

	const centralDirectoryOffset = offset;
	assertZipShort(centralDirectory.length);
	for (const entry of centralDirectory) {
		chunks.push(entry);
		offset += entry.byteLength;
	}
	const centralDirectorySize = offset - centralDirectoryOffset;
	assertZipSize(centralDirectoryOffset);
	assertZipSize(centralDirectorySize);
	const endRecord = createZipHeader(22, (view) => {
		let cursor = 0;
		cursor = writeZipHeaderNumber(view, cursor, 4, 0x06054b50);
		cursor = writeZipHeaderNumber(view, cursor, 2, 0);
		cursor = writeZipHeaderNumber(view, cursor, 2, 0);
		cursor = writeZipHeaderNumber(view, cursor, 2, centralDirectory.length);
		cursor = writeZipHeaderNumber(view, cursor, 2, centralDirectory.length);
		cursor = writeZipHeaderNumber(view, cursor, 4, centralDirectorySize);
		cursor = writeZipHeaderNumber(view, cursor, 4, centralDirectoryOffset);
		writeZipHeaderNumber(view, cursor, 2, 0);
	});
	chunks.push(endRecord);

	return new Blob(chunks, { type: ZIP_MIME_TYPE });
}

export function downloadBlob(
	fileName: string,
	mimeType: string,
	blob: Blob,
): void {
	const outputBlob =
		blob.type === mimeType ? blob : blob.slice(0, blob.size, mimeType);
	const url = URL.createObjectURL(outputBlob);
	try {
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = fileName;
		anchor.rel = "noopener";
		document.body.append(anchor);
		anchor.click();
		anchor.remove();
	} finally {
		window.setTimeout(() => URL.revokeObjectURL(url), 0);
	}
}

export function downloadAsset(asset: DownloadableTextAsset): void {
	downloadBlob(
		asset.fileName,
		asset.mimeType,
		new Blob([asset.contents], { type: asset.mimeType }),
	);
}

export function downloadAssets(assets: readonly DownloadableTextAsset[]): void {
	for (const asset of assets) downloadAsset(asset);
}

export function downloadTextAssetArchive(
	fileName: string,
	assets: readonly DownloadableTextAsset[],
): void {
	downloadBlob(fileName, ZIP_MIME_TYPE, createTextAssetArchiveBlob(assets));
}

/**
 * Browser adapter for the deterministic export bundle. Generation stays pure in
 * `model/*`; this adapter is only responsible for turning already-built assets
 * into downloads during the user's click gesture.
 */
export function downloadExportBundle(bundle: ExportBundle): void {
	downloadAssets(bundle.assets);
}
