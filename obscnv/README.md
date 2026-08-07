# obscnv

A single-file, client-side reactive notebook in the spirit of [ObservableHQ](https://observablehq.com/), built on Observable's own open-source runtime, inspector and inputs packages. No build step, no backend — open `index.html` and start writing cells.

On top of the standard reactive-cell model it adds an interactive **geometry canvas**: cells whose value is a point can be dragged directly on screen, and dragging rewrites the cell's source live — a small GeoGebra-style layer bolted onto the notebook.

## Running it

The app uses native ES module imports, so it must be served over HTTP (not opened via `file://`):

```sh
python3 -m http.server 8000
# then open http://localhost:8000/index.html
```

Everything (Ace editor, jQuery, Sortable, Split.js, d3-require, and the vendored Observable packages under `modules/`) is bundled locally — no CDN or network access required at runtime.

## Cell syntax

Each cell in the editor is a single reactive definition, submitted with the **Update** button (or `Shift-Enter`):

| Form | Meaning |
|---|---|
| `@name = expression` | A plain reactive value, e.g. `@c = @a + @b` |
| `@name = { ...js... }` | A block body; use `return` for the cell's value |
| `@name = *{ ...js... }` | A generator block (backed by `Generators`), for streaming/async values over time |
| `@name = valueof Inputs.range([0, 100])` | A view cell: renders the [Inputs](https://github.com/observablehq/inputs) widget and exposes its live value as `@name` |
| `@name = undefined` | Deletes the cell |

Reference other cells anywhere in an expression with `@name`. `//` and `/* */` comments are stripped before parsing. Click the `···` handle on any cell to load it back into the editor for editing; drag it (via the same handle) to reorder cells in the list.

If a cell fails to compile (invalid JavaScript, or text not in `@name = ...` form), the error is shown in a banner under the toolbar and the previous state of the notebook is left untouched.

## Geometry: Handles and Canvas2D

A cell whose value is a point object is rendered as a draggable dot on the canvas above the editor. The point constructors:

- `FreeHandle(x, y)` — a plain draggable point
- `FixedHandle(x, y)` — a point that can't be dragged
- `SegmentHandle(h1, h2, t)` — constrained to the segment between two handles (or points), draggable along it
- `LineHandle(h1, h2, t)` — constrained to the infinite line through two handles
- `CircleHandle(center, boundary, angle)` — constrained to the circle defined by a center and a boundary point

```js
@p1 = FreeHandle(100, 100)
@p2 = FreeHandle(300, 200)
@mid = SegmentHandle(@p1, @p2, 0.5)
```

Dragging `@mid` along the segment rewrites its source in place; dragging `@p1` or `@p2` moves the endpoints and `@mid` recomputes reactively.

For custom drawing, use the global `Canvas2D` API from any cell:

- `Canvas2D.layer(name, (ctx, canvas, {width, height, dpr}) => {...})` — register a draw layer
- `Canvas2D.removeLayer(name)` / `Canvas2D.clearLayers()`
- `Canvas2D.setClearMode('auto' | 'manual')`, `Canvas2D.clear()`, `Canvas2D.render()`

`Canvas2DPresets` provides ready-made layers (`grid`, `segment`, `point`, `label`). The raw canvas and context are also available as `canvas` / `ctx`.

## Saving your work

The notebook autosaves to `localStorage` after every successful update, so reloading the page restores your last session. For a portable backup or to share a notebook, use **Save** (`Ctrl-S`) to download a `.js` file with all cells in dependency order, and **Open** (`Ctrl-F`) to load one back in.

## Project layout

- `index.html` — the entire app: markup, styles, and logic
- `modules/` — vendored Observable packages (`runtime`, `inspector`, `inputs`, `htl`, `generators`, `promises`, `isoformat`) plus `split` (Split.js as an ES module)
- `js/` — vendored non-module dependencies: Ace editor, jQuery, Sortable, d3-require
- `css/` — Observable's base inspector/syntax styling

## Known limitations

- `modules/inputs/style.css` is the package's un-namespaced source file (`__ns__` placeholders are meant to be replaced by a build step) and isn't wired up, so `Inputs` widgets render with browser-default styling rather than Observable's.
- No automated tests.
