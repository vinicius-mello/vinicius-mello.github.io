# obscnv

A GeoGebra-like interactive geometry tool where every construction is also visible, editable JavaScript. Click a tool and click on the canvas to build, like GeoGebra — but each click just writes a cell (`@m1 = Midpoint(@p1, @p2)`) into the editor, so the construction is never hidden behind the UI. Every object renders live on a canvas, free points are draggable, and dependent objects (midpoints, intersections, reflections, ...) recompute reactively — the same dependency-graph model [ObservableHQ](https://observablehq.com/) notebooks use, applied to geometric construction instead of general computation. No build step, no backend — open `index.html` and start building.

The underlying reactive-cell engine (`@name = expression`, blocks, generators, `Inputs` widgets) is general-purpose plumbing in service of that goal, not a product surface of its own — see [Cell syntax](#cell-syntax) if you need it, but [Geometry](#geometry) is the point of the tool. Everything below is also documented in-app: click **Help** in the toolbar (or press `F1`).

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

## Geometry

Any cell whose value is a point (`{x, y}`) or a tagged shape is drawn automatically — you never call a drawing function yourself for these. What you *can* do with the resulting dot depends on how it was constructed:

- **Free/constrained points** (`FreeHandle`, `FixedHandle`, `SegmentHandle`, `LineHandle`, `CircleHandle`) are draggable; dragging rewrites the cell's source in place.
- **Computed points** (anything else that evaluates to `{x, y}` — `Midpoint`, `Intersection`, `Reflect`, `Rotate`, or your own expressions) render the same way but read-only, exactly like GeoGebra's dependent objects: they follow their inputs, you don't drag them directly.

### Construction toolbar

The strip of buttons above the canvas (Select / Point / Segment / Line / Ray / Circle / Midpoint) builds cells by clicking instead of typing:

- **Point** — click empty canvas to drop a `FreeHandle` there.
- **Segment / Line / Ray / Circle / Midpoint** — click two existing points (draggable or computed) to construct between them. The first click highlights its point with a dashed ring; click it again to cancel, or click a second point to complete the construction.
- **Select** is the default tool — drag draggable points around, same as before the toolbar existed.

Every click just calls `varFromText` under the hood and loads the generated line into the editor, so what the toolbar builds is exactly the code from the sections below — nothing is hidden state.

### Draggable points

- `FreeHandle(x, y)` — a plain draggable point
- `FixedHandle(x, y)` — a point that can't be dragged
- `SegmentHandle(h1, h2, t)` — constrained to the segment between two points, draggable along it
- `LineHandle(h1, h2, t)` — constrained to the infinite line through two points
- `CircleHandle(center, boundary, angle)` — constrained to the circle defined by a center and a boundary point

```js
@p1 = FreeHandle(100, 100)
@p2 = FreeHandle(300, 200)
@mid = SegmentHandle(@p1, @p2, 0.5)
```

Dragging `@mid` along the segment rewrites its source in place; dragging `@p1` or `@p2` moves the endpoints and `@mid` recomputes reactively.

### Shapes

Return a tagged object that auto-draws; pass `{color, lineWidth, fill}` as the last argument to style it:

- `Segment(p1, p2, options)`, `Line(p1, p2, options)`, `Ray(p1, p2, options)` — `Line`/`Ray` extend to the edge of the canvas
- `Circle(center, boundaryOrRadius, options)` — second argument is either a point or a numeric radius
- `Polygon([p1, p2, ...], options)` — closed polygon through a list of points; `options.fill` fills it

```js
@tri = Polygon([@p1, @p2, @p3], {fill: 'rgba(15,139,141,0.12)'})
@circ = Circle(@p1, @p2)
```

### Constructions

Derived from existing points/shapes; points among these (`Midpoint`, `Reflect`, `Rotate`, `Intersection`) auto-draw as read-only dots, `Distance`/`Angle` are plain numbers, `Perpendicular`/`Parallel` return a `Line`:

- `Midpoint(p1, p2)`, `Distance(p1, p2)`, `Angle(p1, vertex, p2)` (degrees)
- `Reflect(point, line)`, `Rotate(point, center, angleDeg)`
- `Perpendicular(point, line)`, `Parallel(point, line)` — `line` accepts a `Line`/`Segment`/`Ray`
- `Intersection(line1, line2)` — line/segment/ray vs. line/segment/ray only; circle intersections aren't implemented yet

```js
@a = FreeHandle(0, 0)
@b = FreeHandle(200, 0)
@mid = Midpoint(@a, @b)
@perp = Perpendicular(@mid, Line(@a, @b))
```

For anything else, use the global `Canvas2D` API from any cell:

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

- The construction toolbar only covers Point/Segment/Line/Ray/Circle/Midpoint; there's no way yet to set an object's color/style or a custom label from the UI (edit the generated cell's `options` argument by hand for now).
- `Intersection` only handles line/segment/ray pairs; circle intersections aren't implemented.
- `Angle` returns a number; there's no visual angle-arc marker yet.
- `modules/inputs/style.css` is the package's un-namespaced source file (`__ns__` placeholders are meant to be replaced by a build step) and isn't wired up, so `Inputs` widgets render with browser-default styling rather than Observable's.
- No automated tests.
