# Look Graph workspace — Looks and Nodes palette

Status: `beta` (graph authoring surface; Frame Looks render through the broad
frame pipeline, while Object Looks render through scoped overlays).

Updated: 2026-07-03.

## 1. What changed?

The Look Graph workspace palette now separates complete treatments from graph
primitives:

- **Looks** add complete, editable visual treatments.
- **Nodes** add one graph primitive to the currently open graph.

The previous `Starter`, `Core`, and `Advanced` palette modes were removed from
the user-facing UI. Those labels exposed implementation maturity instead of the
decision a user is trying to make.

Inside **Looks**, users choose a target:

- **Object** targets selected object silhouettes or object-scoped overlays.
- **Frame** targets the whole frame/current broad graph scope.

Search is scoped to the active tab. Searching while `Looks` is active returns
Look recipes only; searching while `Nodes` is active returns graph primitives
only. This prevents recipe rows and node rows from appearing in one mixed result
list.

Analog Film is available as an Object Look. It applies the canonical
frame-level Analog Film recipe through an artboard scoped overlay clipped to the
selected object silhouettes, preserving the same optical renderer used by broad
frame Analog Film. Inspector and Look workspace share the same feature-level
Analog Film selection command/state model.

Most graph recipes are also available as Object Looks. They create a
`selection-look-graph` scoped overlay for the selected objects, using the same
editable graph nodes as their Frame variants. Soft Glow, Particle Dissolve,
Duotone Poster, Flow Glow, Print Poster, LED Glow, Glyph Poster, and
Surveillance Feed can target either Object or Frame. Noise Background remains
Frame-only because its generator-background semantics are not clearly
object-silhouette preserving.

Frame Looks still expand into normal editable Look Graph nodes in one undoable
command.

Nodes are grouped by effect domain: Color & Tone, Light & Focus, Texture,
Distort & Motion, and Build. The palette no longer hides graph primitives behind
a separate `Advanced` mode.

The rest of the workspace behavior remains: graph navigation, node insertion
after the selected serial node or selected serial wire, direct wire selection and
disconnect, object-scoped Noise Gradient graph editing, node layout drag, and
right-side node controls.

## 2. What can the user do now?

- Open **Looks**, choose **Object**, and apply Analog Film or graph-backed
  object Looks to selected objects without changing their node-local material
  recipes.
- After applying a graph-backed Object Look, the workspace opens that scoped
  object graph so the inserted nodes can be edited immediately.
- Object Look rows marked **On** remove that Object Look from the selected
  objects when clicked again; rows marked **Part** apply the Look to the missing
  selected objects.
- Graph-backed Object Look rows expose a pencil action when active, opening that
  scoped graph without toggling the Look off.
- Open **Looks**, choose **Frame**, and add a complete editable frame recipe.
- Open **Nodes** and add a single graph primitive without recipe rows appearing
  in the same list.
- Search within the current tab without crossing between recipes and nodes.
- Use target/tooltips to understand whether a Look affects selected objects or
  the broad frame/current graph scope.
- See blocked Object rows when the selected objects already belong to another
  object graph Look; the palette does not silently fight existing scoped graph
  ownership.
- Keep using selection-aware graph insertion: selected serial node means "after
  this"; selected serial wire means "on this connection".
- Open a selected object's scoped Noise Gradient graph from the Noise Gradient
  Tool and continue editing it as an object-scoped graph.

## 3. How does the user operate it?

1. Open the Look Graph workspace.
2. Use **Looks** when the goal is a finished treatment; use **Nodes** when the
   goal is one graph building block.
3. In **Looks**, use **Object** when selected objects should receive the
   treatment, or **Frame** when the broad frame/current graph scope should receive
   it.
4. In **Nodes**, choose a primitive from the domain category and insert it into
   the active graph.
5. Search within the active tab for intent terms such as `film`, `bloom`,
   `gradient`, `particle`, `halftone`, `scanline`, `matte`, or `flow`.

## 4. What should a reviewer manually verify?

Repository rules require skipping test-like verification unless explicitly
requested. When manual browser verification is allowed, open `/editor`, open the
Look Graph workspace, and confirm:

1. The palette modes are **Looks** and **Nodes** only.
2. **Looks** shows **Object** and **Frame** target controls.
3. With a selected object, **Object** shows Analog Film and graph-backed Object
   Looks. Applying Analog Film creates the same selected-object overlay
   reflected in Inspector; applying a graph-backed Look creates a
   `selection-look-graph` scoped overlay and opens that scoped graph in the
   workspace. Active graph-backed Object Looks expose a pencil action that
   reopens that scoped graph.
4. With **Frame** selected, Frame recipe rows insert editable graph nodes as
   before.
5. **Nodes** shows graph primitives grouped by domain and does not show recipe
   rows.
6. Search results stay inside the active tab.
7. Old `Starter`, `Core`, and `Advanced` labels do not appear in the Look Graph
   palette.

## 5. What is still intentionally limited?

- Noise Background is Frame-only until its object-silhouette semantics are
  designed clearly.
- User-owned `Recent`, `Saved`, and `Favorites` are still future work.
- A static author-owned `Recommended` section is intentionally not added. If
  recommendations are added, they should come from user behavior or explicit user
  saving/favoriting, not from fixed product labels.
- Large thumbnails or gallery chrome are intentionally avoided so the editor
  remains compact and work-focused.
