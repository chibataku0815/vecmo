/**
 * Pure tokenizer + precedence-climbing parser for the expression DSL.
 *
 * `parseExpression(source, allowedVars)` turns user text into a bounded
 * {@link ExpressionSource} (text + typed AST) or a typed {@link ParseError} carrying
 * a character span for inline Inspector display. It NEVER throws to the caller:
 * internal failures are raised as a private sentinel and converted to an error
 * result at the boundary, so the command bus can treat a bad expression as a no-op.
 *
 * Safety is structural: the grammar has no member access, indexing, assignment, or
 * statements, so a parsed AST cannot reference a host global. Identifiers are
 * validated against the caller-supplied `allowedVars` subset and the frozen builtin
 * names/arities, so an expression authored for Effect Code cannot read Duplicate-only
 * variables (or vice versa). Source length, token count, and nesting depth are all
 * bounded to keep parsing total.
 */

import {
	EXPR_CONTROL_FN_NAME,
	EXPR_CONTROL_ID_PATTERN,
	EXPR_FN_ARITY,
	EXPR_FN_NAMES,
	type ExprBinaryOp,
	type ExpressionSource,
	type ExprFnName,
	type ExprNode,
	type ExprVarName,
} from "./ast";
import type { ExprGrammarOptions } from "./serialize";

export type ParseError = {
	readonly kind: "error";
	readonly message: string;
	readonly span: { readonly start: number; readonly end: number };
};

export type ParseResult =
	| { readonly kind: "ok"; readonly expr: ExpressionSource }
	| ParseError;

/**
 * Longest expression text the parser accepts. Exported so transport schemas
 * (agent plan, MCP tool input) bound the same value the parser enforces rather
 * than re-declaring a second limit that could drift from it.
 */
export const EXPR_MAX_SOURCE_LENGTH = 2_000;
const MAX_SOURCE_LENGTH = EXPR_MAX_SOURCE_LENGTH;
const MAX_TOKENS = 512;
const MAX_DEPTH = 64;

type TokenType =
	| "number"
	| "ident"
	| "op"
	| "lparen"
	| "rparen"
	| "comma"
	/**
	 * Double-quoted text. It is tokenized generally but ACCEPTED only as the sole
	 * argument of `control(...)`; anywhere else it is a parse error, so the value
	 * grammar still has no string type.
	 */
	| "string";

type Token = {
	readonly type: TokenType;
	readonly text: string;
	readonly start: number;
	readonly end: number;
};

/** Private sentinel; carries a span so the boundary can build a {@link ParseError}. */
class ParseFailure {
	readonly message: string;
	readonly start: number;
	readonly end: number;
	constructor(message: string, start: number, end: number) {
		this.message = message;
		this.start = start;
		this.end = end;
	}
}

const fail = (message: string, start: number, end: number): never => {
	throw new ParseFailure(message, start, end);
};

const isDigit = (ch: string): boolean => ch >= "0" && ch <= "9";
const isIdentStart = (ch: string): boolean =>
	(ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
const isIdentChar = (ch: string): boolean => isIdentStart(ch) || isDigit(ch);
const isBinaryOp = (text: string): text is ExprBinaryOp =>
	text === "+" || text === "-" || text === "*" || text === "/";

const tokenize = (source: string): readonly Token[] => {
	const tokens: Token[] = [];
	let index = 0;
	while (index < source.length) {
		const ch = source[index] as string;
		if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
			index += 1;
			continue;
		}
		const start = index;
		if (isDigit(ch) || (ch === "." && isDigit(source[index + 1] ?? ""))) {
			index += 1;
			while (index < source.length && isDigit(source[index] as string))
				index += 1;
			if (source[index] === ".") {
				index += 1;
				while (index < source.length && isDigit(source[index] as string))
					index += 1;
			}
			tokens.push({
				type: "number",
				text: source.slice(start, index),
				start,
				end: index,
			});
			continue;
		}
		if (isIdentStart(ch)) {
			index += 1;
			while (index < source.length && isIdentChar(source[index] as string))
				index += 1;
			tokens.push({
				type: "ident",
				text: source.slice(start, index),
				start,
				end: index,
			});
			continue;
		}
		if (ch === '"') {
			// No escape sequences: the only legal string is a control id, and an
			// escape grammar would be surface area a control id can never need.
			index += 1;
			const contentStart = index;
			while (index < source.length && source[index] !== '"') index += 1;
			if (source[index] !== '"') {
				fail("Unterminated text.", start, source.length);
			}
			const text = source.slice(contentStart, index);
			index += 1;
			tokens.push({ type: "string", text, start, end: index });
			continue;
		}
		if (isBinaryOp(ch)) {
			index += 1;
			tokens.push({ type: "op", text: ch, start, end: index });
			continue;
		}
		if (ch === "(") {
			index += 1;
			tokens.push({ type: "lparen", text: ch, start, end: index });
			continue;
		}
		if (ch === ")") {
			index += 1;
			tokens.push({ type: "rparen", text: ch, start, end: index });
			continue;
		}
		if (ch === ",") {
			index += 1;
			tokens.push({ type: "comma", text: ch, start, end: index });
			continue;
		}
		fail(`Unexpected character "${ch}".`, start, start + 1);
	}
	if (tokens.length > MAX_TOKENS) {
		fail("Expression is too long.", 0, source.length);
	}
	return tokens;
};

const isFnName = (text: string): text is ExprFnName =>
	(EXPR_FN_NAMES as readonly string[]).includes(text);

const binaryPrecedence = (op: ExprBinaryOp): number =>
	op === "+" || op === "-" ? 1 : 2;

/**
 * Cursor-based recursive-descent parser. Binary operators climb precedence;
 * unary minus binds tighter than any binary op; calls validate the callee name
 * and arity against the frozen table.
 */
class Parser {
	private pos = 0;
	private readonly tokens: readonly Token[];
	private readonly allowedVars: readonly ExprVarName[];
	private readonly sourceLength: number;
	private readonly allowControlReferences: boolean;

	constructor(
		tokens: readonly Token[],
		allowedVars: readonly ExprVarName[],
		sourceLength: number,
		allowControlReferences: boolean,
	) {
		this.tokens = tokens;
		this.allowedVars = allowedVars;
		this.sourceLength = sourceLength;
		this.allowControlReferences = allowControlReferences;
	}

	private peek(): Token | undefined {
		return this.tokens[this.pos];
	}

	private next(): Token | undefined {
		const token = this.tokens[this.pos];
		this.pos += 1;
		return token;
	}

	private eofSpan(): { start: number; end: number } {
		return { start: this.sourceLength, end: this.sourceLength };
	}

	parse(): ExprNode {
		if (this.tokens.length === 0) {
			fail("Expression is empty.", 0, 0);
		}
		const node = this.parseBinary(0, 0);
		const trailing = this.peek();
		if (trailing) {
			fail(`Unexpected "${trailing.text}".`, trailing.start, trailing.end);
		}
		return node;
	}

	private guardDepth(depth: number, at: { start: number; end: number }): void {
		if (depth > MAX_DEPTH)
			fail("Expression is too deeply nested.", at.start, at.end);
	}

	private parseBinary(minPrec: number, depth: number): ExprNode {
		let left = this.parseUnary(depth);
		while (true) {
			const token = this.peek();
			if (token?.type !== "op" || !isBinaryOp(token.text)) break;
			const prec = binaryPrecedence(token.text);
			if (prec < minPrec) break;
			this.next();
			const right = this.parseBinary(prec + 1, depth + 1);
			left = { type: "binary", op: token.text, left, right };
		}
		return left;
	}

	private parseUnary(depth: number): ExprNode {
		const token = this.peek();
		if (token && token.type === "op" && token.text === "-") {
			this.next();
			this.guardDepth(depth, token);
			return { type: "unary", op: "-", operand: this.parseUnary(depth + 1) };
		}
		if (token && token.type === "op" && token.text === "+") {
			// Unary plus is a harmless no-op; consume and parse the operand.
			this.next();
			return this.parseUnary(depth + 1);
		}
		return this.parsePrimary(depth);
	}

	private parsePrimary(depth: number): ExprNode {
		const token = this.next();
		if (!token) {
			const span = this.eofSpan();
			return fail("Unexpected end of expression.", span.start, span.end);
		}
		this.guardDepth(depth, token);
		if (token.type === "number") {
			const value = Number(token.text);
			if (!Number.isFinite(value)) {
				fail(`Invalid number "${token.text}".`, token.start, token.end);
			}
			return { type: "num", value };
		}
		if (token.type === "ident") {
			return this.parseIdent(token, depth);
		}
		if (token.type === "lparen") {
			const inner = this.parseBinary(0, depth + 1);
			const close = this.next();
			if (close?.type !== "rparen") {
				const span = close ?? this.eofSpan();
				fail('Expected ")".', span.start, span.end);
			}
			return inner;
		}
		return fail(`Unexpected "${token.text}".`, token.start, token.end);
	}

	private parseIdent(token: Token, depth: number): ExprNode {
		const after = this.peek();
		if (after && after.type === "lparen") {
			return token.text === EXPR_CONTROL_FN_NAME
				? this.parseControl(token)
				: this.parseCall(token, depth);
		}
		if (token.text === EXPR_CONTROL_FN_NAME) {
			fail(
				'control() needs a quoted control id, as in control("hero_impact").',
				token.start,
				token.end,
			);
		}
		if (isFnName(token.text)) {
			fail(
				`"${token.text}" is a function and needs parentheses.`,
				token.start,
				token.end,
			);
		}
		if (!(this.allowedVars as readonly string[]).includes(token.text)) {
			fail(
				`"${token.text}" is not an available variable here.`,
				token.start,
				token.end,
			);
		}
		return { type: "var", name: token.text as ExprVarName };
	}

	/**
	 * `control("id")` — the only production that accepts text, and the only place
	 * a string token is legal. The id is validated against the published-control
	 * id grammar at authoring time, so an unresolvable reference is an authoring
	 * error before it can become a per-frame surprise.
	 */
	private parseControl(token: Token): ExprNode {
		if (!this.allowControlReferences) {
			fail("control() is not available here.", token.start, token.end);
		}
		this.next(); // consume "("
		const argument = this.next();
		if (argument?.type !== "string") {
			const span = argument ?? this.eofSpan();
			return fail(
				'control() takes one quoted control id, as in control("hero_impact").',
				span.start,
				span.end,
			);
		}
		if (!EXPR_CONTROL_ID_PATTERN.test(argument.text)) {
			fail(
				`"${argument.text}" is not a valid control id.`,
				argument.start,
				argument.end,
			);
		}
		const close = this.next();
		if (close?.type !== "rparen") {
			const span = close ?? this.eofSpan();
			fail('Expected ")".', span.start, span.end);
		}
		return { type: "control", controlId: argument.text };
	}

	private parseCall(token: Token, depth: number): ExprNode {
		if (!isFnName(token.text)) {
			fail(`Unknown function "${token.text}".`, token.start, token.end);
		}
		const fn = token.text as ExprFnName;
		this.next(); // consume "("
		const args: ExprNode[] = [];
		const closedImmediately = this.peek()?.type === "rparen";
		if (!closedImmediately) {
			args.push(this.parseBinary(0, depth + 1));
			while (this.peek()?.type === "comma") {
				this.next();
				args.push(this.parseBinary(0, depth + 1));
			}
		}
		const close = this.next();
		if (close?.type !== "rparen") {
			const span = close ?? this.eofSpan();
			fail('Expected ")".', span.start, span.end);
		}
		const arity = EXPR_FN_ARITY[fn];
		if (args.length !== arity) {
			fail(
				`${fn}() takes ${arity} argument${arity === 1 ? "" : "s"}, got ${args.length}.`,
				token.start,
				close?.end ?? token.end,
			);
		}
		return { type: "call", fn, args };
	}
}

/**
 * Parses user text into an {@link ExpressionSource}, validating identifiers against
 * `allowedVars` (the per-surface variable subset) and builtin names/arities. Returns
 * a typed result; never throws.
 */
export function parseExpression(
	source: string,
	allowedVars: readonly ExprVarName[],
	options: ExprGrammarOptions = {},
): ParseResult {
	if (source.length > MAX_SOURCE_LENGTH) {
		return {
			kind: "error",
			message: "Expression is too long.",
			span: { start: 0, end: source.length },
		};
	}
	try {
		const tokens = tokenize(source);
		const ast = new Parser(
			tokens,
			allowedVars,
			source.length,
			options.allowControlReferences === true,
		).parse();
		return { kind: "ok", expr: { source, ast } };
	} catch (error) {
		if (error instanceof ParseFailure) {
			return {
				kind: "error",
				message: error.message,
				span: { start: error.start, end: error.end },
			};
		}
		throw error;
	}
}
