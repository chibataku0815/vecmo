# Export Number Syntax Safety (PDF/SVG)

Date: 2026-07-06.
Status: internal (export correctness fix).

## Summary

The static **PDF** and **SVG** exporters serialize every numeric operand
(coordinates, stroke widths, dash phase, gradient stops, and so on) through a
small `formatNumber` helper. That helper rounded to 6 decimals and then returned
`String(rounded)`. For any magnitude `|value| >= 1e21`, JavaScript's `String`
(and `Number.prototype.toFixed`) switch to exponent notation — for example
`"1e+21"`.

PDF number syntax (ISO 32000-1) forbids exponent notation in content-stream
tokens, so a single operand that large produced an **invalid PDF** that
conforming readers reject. SVG tolerates exponents, but the two formatters are
deliberately kept byte-identical, so both were fixed the same way.

The formatter now detects the `|value| >= 1e21` case and emits a plain-decimal
integer via `BigInt` (every double that large is integer-valued, so precision
below the decimal point is already gone). All smaller values keep their exact
prior output — the fix is additive and touches only the pathological tail.

## What Changed For Users

- Nothing user-visible in normal use. This is a robustness fix: an export whose
  geometry ever reached an extreme coordinate (a degenerate transform or an
  overflow upstream) previously could emit a corrupt PDF; it now stays
  syntactically valid.

## Manual Verification

1. In `src/features/export/model/pdf.ts` and `src/features/export/model/svg.ts`,
   confirm `formatNumber` returns `BigInt(rounded).toString()` for
   `|rounded| >= 1e21`, and that the two copies are still byte-identical.
2. Sanity check the boundary: `String(1e21)` is `"1e+21"` (exponent) while
   `BigInt(1e21).toString()` is `"1000000000000000000000"` (plain decimal).
3. Values below the threshold are unchanged: `formatNumber(1.5)` stays `"1.5"`,
   and `formatNumber(1e20)` stays `"100000000000000000000"`.

## What Is Still Intentionally Limited

- The fix does **not** clamp or reject extreme coordinates — it only guarantees a
  syntactically valid token. A coordinate of 1e21 document units is still far
  outside any real artboard; producing sane geometry at that scale is an upstream
  concern, not the serializer's.
- The two `formatNumber` copies remain **intentionally duplicated** (`pdf.ts` and
  `svg.ts`), not shared. Any future change to one must be mirrored byte-for-byte
  in the other.
