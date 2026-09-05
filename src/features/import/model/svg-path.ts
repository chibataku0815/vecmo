import type { BezierShape } from "@/entities/scene/model/types";
import type { AePoint } from "@/shared/glammer/ae-shape";
import type { ImportIssue } from "./types";

type Point = {
	readonly x: number;
	readonly y: number;
};

type MutableShape = {
	closed: boolean;
	readonly vertices: AePoint[];
	readonly inTangents: AePoint[];
	readonly outTangents: AePoint[];
};

type PathToken =
	| {
			readonly kind: "command";
			readonly command: string;
	  }
	| {
			readonly kind: "number";
			readonly value: number;
			readonly raw: string;
	  };

export type SvgPathParseContext = {
	readonly sourceName?: string;
	readonly ref?: string;
	readonly path?: string;
};

export type SvgPathParseResult = {
	readonly shapes: readonly BezierShape[];
	readonly issues: readonly ImportIssue[];
};

const pathTokenPattern =
	/[AaCcHhLlMmQqSsTtVvZz]|[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?/g;
const numberTokenPattern = /[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?/g;
const commandPattern = /^[AaCcHhLlMmQqSsTtVvZz]$/;
const supportedCommandPattern = /^[CcHhLlMmQqSsTtVvZz]$/;
const allLetterPattern = /[A-Za-z]/g;

const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const point = (x: number, y: number): Point => ({ x, y });
const pointToAe = ({ x, y }: Point): AePoint => [x, y];
const tangent = (from: Point, to: Point): AePoint => [
	to.x - from.x,
	to.y - from.y,
];
const reflect = (origin: Point, control: Point): Point => ({
	x: origin.x * 2 - control.x,
	y: origin.y * 2 - control.y,
});

const commandArity = (command: string): number => {
	switch (command.toUpperCase()) {
		case "H":
		case "V":
			return 1;
		case "M":
		case "L":
		case "T":
			return 2;
		case "S":
		case "Q":
			return 4;
		case "C":
			return 6;
		default:
			return 0;
	}
};

const makeIssue = (
	code: string,
	message: string,
	context: SvgPathParseContext,
	severity: ImportIssue["severity"] = "warning",
): ImportIssue => ({
	severity,
	code,
	message,
	source: context.sourceName,
	ref: context.ref,
	path: context.path,
});

const tokenizePathData = (pathData: string): readonly PathToken[] =>
	Array.from(pathData.matchAll(pathTokenPattern), ([token]) => {
		if (commandPattern.test(token)) {
			return { kind: "command", command: token } satisfies PathToken;
		}
		return {
			kind: "number",
			value: Number(token),
			raw: token,
		} satisfies PathToken;
	});

const unsupportedLettersIn = (pathData: string): readonly string[] => {
	const commands = new Set<string>();
	const commandOnlyText = pathData.replace(numberTokenPattern, " ");
	for (const [letter] of commandOnlyText.matchAll(allLetterPattern)) {
		if (!supportedCommandPattern.test(letter)) commands.add(letter);
	}
	return [...commands].sort();
};

/**
 * Converts the editable SVG path subset into one or more AeShape contours.
 * Multiple SVG subpaths become multiple shapes because the current scene path
 * geometry represents a single contour, not a compound path.
 */
export function svgPathDataToAeShapes(
	pathData: string,
	context: SvgPathParseContext = {},
): SvgPathParseResult {
	const issues: ImportIssue[] = [];
	const unsupportedLetters = unsupportedLettersIn(pathData);
	if (unsupportedLetters.length > 0) {
		issues.push(
			makeIssue(
				"svg.unsupported-path-command",
				`Unsupported SVG path command(s): ${unsupportedLetters.join(", ")}.`,
				context,
			),
		);
		return { shapes: [], issues };
	}

	const tokens = tokenizePathData(pathData);
	if (tokens.length === 0) {
		return {
			shapes: [],
			issues: [
				makeIssue(
					"svg.empty-path-data",
					"Path data did not contain any supported commands.",
					context,
				),
			],
		};
	}

	const shapes: BezierShape[] = [];
	let cursor = 0;
	let activeCommand: string | undefined;
	let current = point(0, 0);
	let subpathStart = point(0, 0);
	let shape: MutableShape | undefined;
	let previousCommand: string | undefined;
	let previousCubicControl: Point | undefined;
	let previousQuadraticControl: Point | undefined;

	const finalizeShape = () => {
		if (!shape) return;
		if (shape.vertices.length < 2) {
			issues.push(
				makeIssue(
					"svg.empty-path-subpath",
					"A path subpath had fewer than two points and was skipped.",
					context,
					"info",
				),
			);
			shape = undefined;
			return;
		}
		shapes.push({
			type: "Shape",
			closed: shape.closed,
			vertices: [...shape.vertices],
			inTangents: [...shape.inTangents],
			outTangents: [...shape.outTangents],
		});
		shape = undefined;
	};

	const moveTo = (to: Point) => {
		finalizeShape();
		shape = {
			closed: false,
			vertices: [pointToAe(to)],
			inTangents: [[0, 0]],
			outTangents: [[0, 0]],
		};
		current = to;
		subpathStart = to;
		previousCubicControl = undefined;
		previousQuadraticControl = undefined;
	};

	const appendCubic = (control1: Point, control2: Point, to: Point) => {
		if (!shape) {
			issues.push(
				makeIssue(
					"svg.path-command-before-move",
					"Path segment appeared before an initial move command.",
					context,
					"error",
				),
			);
			return;
		}

		const previousIndex = shape.vertices.length - 1;
		shape.outTangents[previousIndex] = tangent(current, control1);
		shape.vertices.push(pointToAe(to));
		shape.inTangents.push(tangent(to, control2));
		shape.outTangents.push([0, 0]);
		current = to;
	};

	const readNumber = (): number | undefined => {
		const token = tokens[cursor];
		if (token?.kind !== "number") return undefined;
		cursor += 1;
		return token.value;
	};

	const readPoint = (relative: boolean): Point | undefined => {
		const x = readNumber();
		const y = readNumber();
		if (x === undefined || y === undefined) return undefined;
		const raw = point(x, y);
		return relative ? add(current, raw) : raw;
	};

	const hasNumbersFor = (arity: number): boolean => {
		for (let index = 0; index < arity; index += 1) {
			if (tokens[cursor + index]?.kind !== "number") return false;
		}
		return true;
	};

	while (cursor < tokens.length) {
		const token = tokens[cursor];
		if (!token) break;

		if (token.kind === "command") {
			cursor += 1;
			activeCommand = token.command;
			if (activeCommand.toUpperCase() === "Z") {
				if (shape) {
					shape.closed = true;
					current = subpathStart;
					finalizeShape();
				}
				previousCommand = activeCommand;
				previousCubicControl = undefined;
				previousQuadraticControl = undefined;
				continue;
			}
		}

		if (!activeCommand) {
			issues.push(
				makeIssue(
					"svg.path-command-before-move",
					"Path data started with numeric values before a command.",
					context,
					"error",
				),
			);
			break;
		}

		const command = activeCommand;
		const commandName = command.toUpperCase();
		const relative = command === command.toLowerCase();
		const arity = commandArity(command);

		if (arity === 0 || !hasNumbersFor(arity)) {
			issues.push(
				makeIssue(
					"svg.invalid-path-data",
					`Path command ${command} did not have enough numeric parameters.`,
					context,
					"error",
				),
			);
			break;
		}

		if (commandName === "M") {
			const to = readPoint(relative);
			if (!to) break;
			moveTo(to);
			activeCommand = relative ? "l" : "L";
			previousCommand = command;
			continue;
		}

		if (commandName === "L") {
			const to = readPoint(relative);
			if (!to) break;
			appendCubic(current, to, to);
			previousCubicControl = undefined;
			previousQuadraticControl = undefined;
			previousCommand = command;
			continue;
		}

		if (commandName === "H") {
			const x = readNumber();
			if (x === undefined) break;
			const to = point(relative ? current.x + x : x, current.y);
			appendCubic(current, to, to);
			previousCubicControl = undefined;
			previousQuadraticControl = undefined;
			previousCommand = command;
			continue;
		}

		if (commandName === "V") {
			const y = readNumber();
			if (y === undefined) break;
			const to = point(current.x, relative ? current.y + y : y);
			appendCubic(current, to, to);
			previousCubicControl = undefined;
			previousQuadraticControl = undefined;
			previousCommand = command;
			continue;
		}

		if (commandName === "C") {
			const control1 = readPoint(relative);
			const control2 = readPoint(relative);
			const to = readPoint(relative);
			if (!control1 || !control2 || !to) break;
			appendCubic(control1, control2, to);
			previousCubicControl = control2;
			previousQuadraticControl = undefined;
			previousCommand = command;
			continue;
		}

		if (commandName === "S") {
			const control1 =
				previousCubicControl && previousCommand
					? ["C", "S"].includes(previousCommand.toUpperCase())
						? reflect(current, previousCubicControl)
						: current
					: current;
			const control2 = readPoint(relative);
			const to = readPoint(relative);
			if (!control2 || !to) break;
			appendCubic(control1, control2, to);
			previousCubicControl = control2;
			previousQuadraticControl = undefined;
			previousCommand = command;
			continue;
		}

		if (commandName === "Q") {
			const quadratic = readPoint(relative);
			const to = readPoint(relative);
			if (!quadratic || !to) break;
			const control1 = point(
				current.x + (2 / 3) * (quadratic.x - current.x),
				current.y + (2 / 3) * (quadratic.y - current.y),
			);
			const control2 = point(
				to.x + (2 / 3) * (quadratic.x - to.x),
				to.y + (2 / 3) * (quadratic.y - to.y),
			);
			appendCubic(control1, control2, to);
			previousCubicControl = undefined;
			previousQuadraticControl = quadratic;
			previousCommand = command;
			continue;
		}

		if (commandName === "T") {
			const quadratic =
				previousQuadraticControl && previousCommand
					? ["Q", "T"].includes(previousCommand.toUpperCase())
						? reflect(current, previousQuadraticControl)
						: current
					: current;
			const to = readPoint(relative);
			if (!to) break;
			const control1 = point(
				current.x + (2 / 3) * (quadratic.x - current.x),
				current.y + (2 / 3) * (quadratic.y - current.y),
			);
			const control2 = point(
				to.x + (2 / 3) * (quadratic.x - to.x),
				to.y + (2 / 3) * (quadratic.y - to.y),
			);
			appendCubic(control1, control2, to);
			previousCubicControl = undefined;
			previousQuadraticControl = quadratic;
			previousCommand = command;
		}
	}

	finalizeShape();

	return { shapes, issues };
}
