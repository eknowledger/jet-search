# Architecture diagrams

The architecture pictures in the docs are drawn with [rough.js](https://roughjs.com/) (MIT) so they look hand drawn, and are saved as PNG files with a transparent background. The PNGs are committed, so you only need to regenerate them when a diagram changes.

## Regenerate

```
npm install
npm run diagrams
```

This needs Google Chrome. The script looks for it in the default macOS location. Set the `CHROME` environment variable to use another browser binary, for example `CHROME=/usr/bin/google-chrome npm run diagrams`. Chrome is started headless with its own temporary profile, so a running Chrome is not affected.

To draw only some diagrams, pass their names: `npm run diagrams -- smoke`.

Each diagram produces two files in `docs/assets/`: `arch-<name>-dark.png` (light strokes and text, for dark pages) and `arch-<name>-light.png` (dark strokes and text, for light pages). The images are drawn at twice the pixel size for sharp text. The output is stable: running the command twice gives the same files.

The command prints a warning and exits with an error when text is wider than its box or a shape is drawn outside the canvas. Fix the sizes or positions and run it again.

## Add a diagram

Edit `diagrams.mjs`. A diagram is a name, a canvas size, a seed and a list of items with explicit positions in pixels:

```js
const flow = diagram("flow", { width: 600, height: 300, seed: 3 }, [
	group("frame", { label: "Plugin", around: ["a", "b"] }),
	box("a", { x: 60, y: 90, w: 180, h: 80, title: "Query", sub: ["Shift-Shift"] }),
	box("b", { x: 360, y: 90, w: 180, h: 80, title: "Engine", accent: true }),
	cylinder("db", { x: 380, y: 210, w: 140, h: 80, title: "Index" }),
	arrow("a", "b", { label: "keys" }),
	arrow("b", "db", { dashed: true }),
	note("hint", { x: 60, y: 280, text: "dashed: in the background" }),
]);
```

Then add it to the `diagrams` list at the end of the file and run `npm run diagrams`. Use the name in the docs as `assets/arch-flow-dark.png` and `assets/arch-flow-light.png`.

The building blocks are in `lib.mjs`:

- `box(id, { x, y, w, h, title, sub, rounded, accent })` is a rectangle with a title and small subtitle lines.
- `cylinder(id, { x, y, w, h, title, sub, accent })` is a store.
- `group(id, { label, around, pad })` is a dashed frame around other shapes. Use `x, y, w, h` instead of `around` for a fixed frame.
- `arrow(from, to, { fromSide, toSide, fromAt, toAt, elbow, dashed, label, accent, both })` connects two shapes by id. Sides are `l`, `r`, `t` and `b`. By default the sides are chosen from the layout.
- `note(id, { x, y, text, align, size, muted })` is plain text.

Every shape needs an id that is unique inside its diagram. The id also decides how that shape is sketched, so renaming a shape changes its jitter but adding a shape does not change the others. Change the diagram `seed` to get a different sketch of the whole picture.

## How it works

`render.mjs` builds one HTML page per diagram and theme. The page contains the rough.js bundle, the code of `lib.mjs` and the diagram data, and draws an inline SVG. Headless Chrome opens the page once to check the layout and once to take the screenshot, with the window sized to the diagram.

## Font licence

The text uses Excalifont, the font used by Excalidraw, designed by Jan Filipek and licensed under the SIL Open Font License 1.1. The font files (Latin and Latin Extended subsets) and the licence text are in `fonts/`, copied from the Excalidraw repository at `packages/excalidraw/fonts/Excalifont`. The licence applies to the font files only, not to the diagrams made with them.
