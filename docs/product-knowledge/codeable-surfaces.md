# Codeable Effect + Codeable Duplicate

Date: 2026-06-23.
Status: beta.

## Summary

A selected node can now drive its look and its duplication from a small, safe
expression language instead of fixed constants. Two surfaces ship together:

- **Effect Code** binds an expression-bindable Look control (Exposure, Contrast,
  Saturation, Grain, Noise scale, Glow, Glow radius, RGB split) to a formula such
  as `value + sin(time) * 0.5`.
- **Duplicate Code** turns one node into a parametric generator: a `Count`
  expression plus per-instance `X` / `Y` / `Rotation` expressions over the
  instance index.

The expressions are a deliberately small DSL (numbers, `+ - * /`, parentheses, and
the functions `sin cos abs min max floor mod clamp lerp smoothstep random`). The
text you type is parsed into a typed syntax tree and stored as plain document data
— no executable JavaScript is ever written into a document. The same evaluator runs
in the editor and is embedded into the exported runtime, so what you see is what
the exported code reproduces.

## What Changed?

- A new **Code** section appears in the inspector for a single selected node, with
  an Effect group and a Duplicate group.
- The scene document gained two additive, migration-free side-cars:
  `effectExpressionBindings` and `duplicateGenerators`. Legacy documents omit them
  and behave exactly as before.
- The on-canvas preview (scrub) evaluates these expressions every frame: an effect
  expression recolors/relights the node live, and a duplicate generator renders its
  instances. Playback also renders generated duplicate instances.
- Code export (`Motion Runtime`) embeds the expression evaluator and reproduces
  duplicate generators in the standalone HTML/JS player and in the per-frame SVG
  export. Effect looks reproduce faithfully in the editor and in the SVG export.

## What Can The User Do Now?

- Animate a Look control with a formula — e.g. set Exposure to `value + sin(time)`
  to pulse exposure, or Glow to `0.4 + 0.4 * sin(time * 2)`.
- Generate N copies of a node whose position and rotation are computed per copy —
  e.g. `Count = 8`, `X = i * 40`, `Rotation = i * 15` for a fanned-out row.
- Use `seed` and `random(seed + i)` to spread duplicates deterministically.
- Export the scene and reproduce the same motion and duplication outside the editor.

## How Does The User Operate It?

1. Select a single node.
2. In the inspector, open the **Code** section.
3. **Effect**: pick a parameter from the dropdown, type an expression in the
   Expression field, and press Enter (or blur). The bound expressions are listed
   below with a clear (×) control. Clearing the field unbinds the parameter.
   Available variables: `time`, `frame`, `value` (the parameter's prior constant).
4. **Duplicate**: type a `Count` expression (required) and optional `X` / `Y` /
   `Rotation` expressions, then press Enter. "Remove generator" clears it.
   Available variables: `i`, `count`, `seed`, `time`, `frame`.
5. Each edit is one undo step. Invalid expressions show an inline error and do not
   change the document.

## What Should A Reviewer Manually Verify?

- Binding Exposure to `value + sin(time)` animates the node's look while scrubbing.
- Setting `Count = 8`, `X = i * 50` shows eight offset instances on canvas during
  scrub and playback, with no change to the layer list (instances are not real
  scene nodes).
- One undo removes a binding or generator; redo restores it.
- A malformed expression (e.g. `value +`) shows an inline error and is a no-op.
- Exported `Motion Runtime` HTML reproduces the duplicate instances.

## What Is Still Intentionally Limited?

- Effect **looks** reproduce in the editor and the per-frame SVG export, but the
  standalone HTML/JS player reproduces motion, opacity, and duplicates only — recipe
  looks remain a side-car there (consistent with the effect-capability fidelity
  matrix). Porting the full filter pipeline into the standalone player is deferred.
- Duplicate channels are `Count`, `X`, `Y`, `Rotation`; per-instance scale, delay,
  and color are deferred. Generated instances are presentation-only (an explicit
  bake-to-nodes command is deferred).
- Effect Code is node-scoped (artboard/scene-scoped binding is deferred).
- The DSL is number-valued only; string/color expressions and a sandboxed
  JavaScript tier are deferred.
- During rAF playback the editor does not rebuild the look filter per frame, so an
  animated look updates on scrub and in the SVG export rather than mid-playback.
