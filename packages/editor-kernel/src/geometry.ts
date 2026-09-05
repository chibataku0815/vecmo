export type Point = { readonly x: number; readonly y: number };
export type Bounds = Point & {
	readonly width: number;
	readonly height: number;
};
export type Insets = {
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
	readonly left: number;
};
export type Camera = {
	readonly zoom: number;
	readonly panX: number;
	readonly panY: number;
	readonly rotation?: number;
};
export type Affine = {
	readonly a: number;
	readonly b: number;
	readonly c: number;
	readonly d: number;
	readonly e: number;
	readonly f: number;
};

export const clampNumber = (
	value: number,
	minimum: number,
	maximum: number,
): number => Math.min(maximum, Math.max(minimum, value));

const rotationOf = (camera: Pick<Camera, "rotation">): number =>
	typeof camera.rotation === "number" && Number.isFinite(camera.rotation)
		? camera.rotation
		: 0;

const rotate = (point: Point, rotation: number): Point => {
	if (rotation === 0) return point;
	const cos = Math.cos(rotation);
	const sin = Math.sin(rotation);
	return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
};

const inverseRotate = (point: Point, rotation: number): Point => {
	if (rotation === 0) return point;
	const cos = Math.cos(rotation);
	const sin = Math.sin(rotation);
	return {
		x: point.x * cos + point.y * sin,
		y: -point.x * sin + point.y * cos,
	};
};

export function worldToScreen(camera: Camera, world: Point): Point {
	const scale = camera.zoom / 100;
	const rotated = rotate(world, rotationOf(camera));
	return {
		x: rotated.x * scale + camera.panX,
		y: rotated.y * scale + camera.panY,
	};
}

export function screenToWorld(camera: Camera, screen: Point): Point {
	const scale = camera.zoom / 100;
	return inverseRotate(
		{
			x: (screen.x - camera.panX) / scale,
			y: (screen.y - camera.panY) / scale,
		},
		rotationOf(camera),
	);
}

export function transformCameraAtPoint(
	camera: Camera,
	nextZoom: number,
	nextRotation: number,
	anchor: Point,
	zoomRange: { readonly minimum: number; readonly maximum: number },
): Camera {
	const zoom = clampNumber(nextZoom, zoomRange.minimum, zoomRange.maximum);
	const world = screenToWorld(camera, anchor);
	const rotated = rotate(world, nextRotation);
	const scale = zoom / 100;
	return {
		zoom,
		panX: anchor.x - rotated.x * scale,
		panY: anchor.y - rotated.y * scale,
		rotation: nextRotation,
	};
}

export function zoomCameraAtPoint(
	camera: Camera,
	nextZoom: number,
	anchor: Point,
	zoomRange: { readonly minimum: number; readonly maximum: number },
): Camera {
	return transformCameraAtPoint(
		camera,
		nextZoom,
		rotationOf(camera),
		anchor,
		zoomRange,
	);
}

export function applyAffine(matrix: Affine, point: Point): Point {
	return {
		x: matrix.a * point.x + matrix.c * point.y + matrix.e,
		y: matrix.b * point.x + matrix.d * point.y + matrix.f,
	};
}

export function multiplyAffine(left: Affine, right: Affine): Affine {
	return {
		a: left.a * right.a + left.c * right.b,
		b: left.b * right.a + left.d * right.b,
		c: left.a * right.c + left.c * right.d,
		d: left.b * right.c + left.d * right.d,
		e: left.a * right.e + left.c * right.f + left.e,
		f: left.b * right.e + left.d * right.f + left.f,
	};
}

const safeCoordinate = (value: number): number =>
	Number.isFinite(value) ? value : 0;
const safeLength = (value: number): number =>
	Number.isFinite(value) ? Math.max(1, value) : 1;
const safeInset = (value: number): number =>
	Number.isFinite(value) ? Math.max(0, value) : 0;

export function normalizeBounds(bounds: Bounds): Bounds {
	return {
		x: safeCoordinate(bounds.x),
		y: safeCoordinate(bounds.y),
		width: safeLength(bounds.width),
		height: safeLength(bounds.height),
	};
}

export function unionBounds(boundsList: readonly Bounds[]): Bounds | null {
	if (boundsList.length === 0) return null;
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const item of boundsList) {
		const bounds = normalizeBounds(item);
		minX = Math.min(minX, bounds.x);
		minY = Math.min(minY, bounds.y);
		maxX = Math.max(maxX, bounds.x + bounds.width);
		maxY = Math.max(maxY, bounds.y + bounds.height);
	}
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function fitBounds(
	boundsInput: Bounds,
	frame: {
		readonly width: number;
		readonly height: number;
		readonly insets: Insets;
	},
	options: {
		readonly minimumZoom: number;
		readonly maximumZoom: number;
		readonly padding: number;
		readonly insetScale?: Insets;
	},
): Camera {
	const bounds = normalizeBounds(boundsInput);
	const width = safeLength(frame.width);
	const height = safeLength(frame.height);
	const insetScaleInput = options.insetScale ?? {
		top: 1,
		right: 1,
		bottom: 1,
		left: 1,
	};
	const insetScale = {
		top: safeInset(insetScaleInput.top),
		right: safeInset(insetScaleInput.right),
		bottom: safeInset(insetScaleInput.bottom),
		left: safeInset(insetScaleInput.left),
	};
	const insets = {
		top: safeInset(frame.insets.top),
		right: safeInset(frame.insets.right),
		bottom: safeInset(frame.insets.bottom),
		left: safeInset(frame.insets.left),
	};
	const padding = safeInset(options.padding);
	const usableWidth = Math.max(
		1,
		width -
			insets.left * insetScale.left -
			insets.right * insetScale.right -
			padding * 2,
	);
	const usableHeight = Math.max(
		1,
		height -
			insets.top * insetScale.top -
			insets.bottom * insetScale.bottom -
			padding * 2,
	);
	const zoom = clampNumber(
		Math.floor(
			Math.min(usableWidth / bounds.width, usableHeight / bounds.height) * 100,
		),
		options.minimumZoom,
		options.maximumZoom,
	);
	const scale = zoom / 100;
	const center = {
		x: bounds.x + bounds.width / 2,
		y: bounds.y + bounds.height / 2,
	};
	const anchor = {
		x: width / 2 + (insets.left - insets.right) / 2,
		y: height / 2 + (insets.top - insets.bottom) / 2,
	};
	return {
		zoom,
		panX: Math.round(anchor.x - center.x * scale),
		panY: Math.round(anchor.y - center.y * scale),
	};
}
