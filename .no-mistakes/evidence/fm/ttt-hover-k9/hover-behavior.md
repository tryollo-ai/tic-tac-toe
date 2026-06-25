# Square hover: background-only, no lift

Verified end-to-end in the running app (`npm run dev`) by claiming the X seat in a
vs-AI room and hovering a playable cell via real Chrome DevTools mouse movement
(triggers the genuine `:hover` pseudo-class).

## Screenshots

- `01-board-resting.png` - board at rest, all nine cells share the same dark surface.
- `02-board-hover-center.png` - center cell (Square 5) hovered: its background
  lightens to `#2f405c` while it stays in place, flush with its row neighbors. No
  lift, translate, or scale.

## Computed styles while the center cell is hovered

```json
{
  "hoveredBackground": "rgb(47, 64, 92)",   // = #2f405c, hover background applied
  "transform": "none",                       // no translateY/scale -> cell does not move
  "transitionProperty": "background, box-shadow",  // transform dropped from transition
  "transitionDuration": "0.18s, 0.15s",      // background transition lengthened to 0.18s
  "middleRowTops": [381, 381, 381]           // hovered cell top == its left/right neighbors
}
```

The identical `middleRowTops` for the three middle-row cells (the center being the
hovered one) is the direct "stays put" proof: hovering does not shift the cell
vertically. `transform: none` and a transition list without `transform` confirm the
`translateY(-2px)` lift and `:active` translate reset were removed, leaving only the
animated background color change. The `.winning` pop animation and cell color tokens
are unchanged.
