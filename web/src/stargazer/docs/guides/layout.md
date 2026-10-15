---
title: Layout
group: Features
order: 9
---

# Layout

Layout sizes and places a group of nodes so that it fills the window and reflows when the window resizes. Use it for menus, heads-up displays, panels and page frames. Game objects usually don't need it. You place those by setting `transform.x` and `transform.y`.

Layout is opt-in. You build a tree of containers such as {@link Row}, {@link Column} and {@link Box}, give it to a {@link LayoutRoot}, and add the root to a scene. The engine then measures and places the tree to fill the visible area, and does it again after every resize. Nothing runs until you add a `LayoutRoot`.

Each parent tells its children the minimum and maximum size they may take. Each child reports the size it wants within those limits. Then each parent places its children. All sizes and positions are in world units.

## Basic usage

This example fills the screen with a column: a title bar at the top, a footer at the bottom, and a body that takes the height left over.

```ts
import { LayoutRoot, Column, Expanded } from '@src/stargazer'

const root = new LayoutRoot()
root.setContent(
  new Column({
    gap: 16,
    crossAxisAlign: 'stretch',
    children: [
      titleBar, // nodes you built
      new Expanded({ child: body }),
      footer,
    ],
  }),
)
host.engine.tree.root.add(root)
```

The root fills the visible world rect of the view that places it. That is the camera's view, unless the root sits under a {@link Layer} with a space of its own. When the canvas resizes, the layout runs again and the column follows. `crossAxisAlign: 'stretch'` makes each child as wide as the column.

To fill a fixed region instead of the view, pass a `bounds` function. The root calls it on every layout pass.

```ts
new LayoutRoot({ bounds: () => myRegionRect })
```

[`setContent`](/module/layout/layoutroot#setcontent) replaces any earlier content. The old content is removed from the tree but not destroyed.

### Rows and columns

A `Row` places its children left to right, and a `Column` places them top to bottom. Each child takes its own size along that direction, called the main axis. The other direction is the cross axis.

```ts
new Row({
  gap: 12,
  crossAxisAlign: 'center',
  children: [avatar, label, badge],
})
```

A row or column takes these options:

| Option           | Default   | Values                                                                             |
| ---------------- | --------- | ---------------------------------------------------------------------------------- |
| `gap`            | `0`       | Space between neighboring children                                                 |
| `mainAxisAlign`  | `'start'` | `'start'`, `'center'`, `'end'`, `'spaceBetween'`, `'spaceAround'`, `'spaceEvenly'` |
| `crossAxisAlign` | `'start'` | `'start'`, `'center'`, `'end'`, `'stretch'`                                        |

`mainAxisAlign` decides where the leftover space on the main axis goes. `crossAxisAlign` places each child on the cross axis. `'stretch'` makes every child fill the cross axis.

### Grow a child

To make a child take the leftover space, wrap it in {@link Expanded}. Several expanded children split the space by their `flex` weight, which is `1` by default. {@link Spacer} is empty space that grows the same way. Use it to push neighbors apart.

```ts
new Row({
  children: [
    logo,
    new Spacer(), // pushes the button to the right edge
    playButton,
  ],
})

new Row({
  children: [
    new Expanded({ child: left, flex: 2 }), // two thirds
    new Expanded({ child: right, flex: 1 }), // one third
  ],
})
```

{@link Flexible} takes a `child`, a `flex` weight and a `fit` option. Rows and columns give each flexible child exactly its share of the space, whatever its `fit`. In practice `Flexible` lays out the same as `Expanded`.

### Boxes and spacing

`Box` holds one child. It has an optional fixed `width` and `height` and optional `padding`. The child gets the whole interior inside the padding. Without a `width` or `height`, the box takes the child's size plus the padding on that axis.

{@link SizedBox} is a box of a fixed size. Without a child, it reserves empty space. {@link Padding} adds space around a child.

```ts
import { Box, SizedBox, Padding, edgeInsets } from '@src/stargazer'

new Box({ width: 480, padding: edgeInsets(24), child: content })
new SizedBox({ width: 96, height: 96, child: icon })
new Padding({ insets: edgeInsets(8, 16), child: label })
```

{@link edgeInsets} builds the padding the way CSS shorthand does:

- `edgeInsets(16)` sets all four edges to 16.
- `edgeInsets(8, 16)` sets top and bottom to 8, left and right to 16.
- `edgeInsets(4, 8, 12, 16)` sets top, right, bottom and left in that order.

### Place a child in a larger area

{@link Align} fills the space its parent offers and places one child inside it. `alignX` and `alignY` take `'start'`, `'center'`, `'end'` or `'stretch'`, and default to `'center'`. {@link Center} is `Align` with both set to `'center'`.

```ts
new Center({ child: board })
new Align({ alignX: 'end', alignY: 'start', child: closeButton })
```

{@link AspectRatio} fits the largest box with a given width-to-height `ratio` into the offered space, and places the child in that box. A ratio of 1 keeps a board square as the window changes shape. `alignX` and `alignY` place the box and default to `'center'`.

```ts
new AspectRatio({ ratio: 1, child: board })
```

### Stack and Scaffold

{@link Stack} puts its children on top of each other in one box. It draws them in child order, so the last child is on top. `alignX` and `alignY` place every child and default to `'start'`. By default the stack is the size of its largest child. With `fit: 'expand'` it fills the space its parent offers.

{@link Scaffold} is a page frame. It has an optional `header`, a `content` area that fills the height between, an optional `footer`, and an optional `gap`.

```ts
new Stack({
  alignX: 'end',
  alignY: 'start',
  children: [thumbnail, unreadBadge],
})

new Scaffold({
  header: titleBar,
  content: new Center({ child: board }),
  footer: toolbar,
})
```

### Text, shapes and animations in a layout

{@link TextNode}, {@link ShapeNode} and {@link LottieNode} work as layout children without a wrapper.

```ts
new Row({
  gap: 8,
  crossAxisAlign: 'center',
  children: [
    new ShapeNode({ geometry: { kind: 'circle', radius: 12 }, fill: '#4c8' }),
    new TextNode({ text: 'Online', fontSize: 24, color: '#fff' }),
  ],
})
```

A `TextNode` measures the width of its widest line and the height of all its lines. It then uses its `align` and `baseline` to place the text inside the box it gets. A `ShapeNode` keeps its own size, a circle's diameter or a rect's `width` and `height`, and sits centered in its box unless the rect has `centered: false`. A `LottieNode` takes the full size of the box it gets.

Changing a `TextNode`'s `text` does not start a layout pass. Call [`root.requestLayout()`](/module/layout/layoutroot#requestlayout) after you change it when the new size matters.

### Change a layout

Change a layout through its containers' methods. They keep the existing nodes, so running tweens and other state on those nodes survive. Each call schedules one layout pass on the next frame.

```ts
row.add(child)
row.insert(1, child)
row.remove(child)
row.setChildren([a, b, c])
box.setChild(child)
```

`Row` and `Column` have all four list methods. `Stack` has `add` and `remove`. `Box`, `SizedBox` and `Padding` have `setChild`. Removed children are not destroyed.

Container options such as `gap`, `width` or `alignX` are plain fields. After you set one, call [`markLayoutDirty()`](/module/layout/layoutnode#marklayoutdirty) on that container.

```ts
row.gap = 24
row.markLayoutDirty()
```

### Animate inside a layout

Tween the transform, not the layout. A layout pass never reads `transform` as input, so a tween of `x`, `y`, `scaleX` or `scaleY` causes no layout work. A change to a layout size causes a new pass. To make a card pop, tween its scale, not its width.

```ts
await card.tween({ scaleX: 1.1, scaleY: 1.1 }, { duration: 0.15 })
```

The next layout pass writes `x` and `y` again, so a tween of position inside a layout holds only until the next resize or change.

## Advanced usage

This section covers the root's bounds, freeform content inside a layout, custom layout nodes, and how the pass runs.

### Root bounds and views

[`LayoutRootOptions`](/module/layout/layoutrootoptions) has three fields:

- `bounds` is a function that returns the world rect to fill. Without it, the root fills the visible world rect of its view.
- `camera` is the view whose visible rect the root fills when `bounds` is not set.
- `id` is the node id. It defaults to `'layout-root'`.

Without `camera`, the root uses the view that places it. Under a `Layer` with space `'screen'`, one unit is one CSS pixel and the root fills the canvas. Under a frame layer, the frame is fitted into the canvas, and the visible rect is the frame plus any extra area around it when the canvas has a different shape. See [Scene graph](/guides/scene) for layers and [Camera](/guides/camera) for the visible world rect.

### Freeform content in a layout

Some content positions itself, such as a physics field or a grid drawn from its own geometry. You can keep it inside a layout in two ways.

The first way is to add a node that does not implement {@link Measurable} to a `Row`, `Column` or `Stack`. The container skips it. The node still draws, culls and receives pointer events, but stays where its own `transform` puts it.

The second way is {@link LayoutBuilder}. It takes a place in the layout like any other child, and reports the rect it gets to an `onLayout` callback. The rect is in world coordinates, so content anywhere in the scene can use it.

```ts
import { LayoutBuilder, Center, AspectRatio } from '@src/stargazer'

const field = new LayoutBuilder({ onLayout: (rect) => board.fit(rect) })
root.setContent(
  new Center({ child: new AspectRatio({ ratio: 1, child: field }) }),
)
```

The builder reuses the rect object on every pass, so copy the fields you want to keep. [`contentRect`](/module/layout/layoutbuilder#contentrect) holds the rect from the last pass.

A `LayoutBuilder` fills a box only when its parent gives it an exact size, as a `LayoutRoot`, `AspectRatio` or `Expanded` does. Otherwise it takes the minimum size, which is 0 in a row or column. A bare builder in a row or column therefore has no size. On an unbounded axis it also logs a warning. Wrap it in `Expanded`, `AspectRatio` or `SizedBox`, or give it a fixed `width` and `height`.

### Align without a layout tree

{@link alignWithin} places a box inside a rect without any layout tree. It returns the top-left point. Use it for a node, a rect of your own, or an HTML overlay.

```ts
import { alignWithin } from '@src/stargazer'

const { x, y } = alignWithin(rightMargin, 120, 48, 'center', 'center')
badge.transform.x = x
badge.transform.y = y
```

`'stretch'` acts like `'start'` here, because the function returns only a point. {@link alignOffset} does the same for one axis.

### Write a layout-aware node

A node takes part in layout when it implements {@link Measurable}. That means three members:

- `measuredSize` is a `{ w, h }` object that the node creates once and reuses.
- `measure(constraints)` writes the node's size into `measuredSize` and returns it.
- `arrange(x, y, w, h)` places the node at `x`, `y` in its parent's space, with final size `w` by `h`.

Extend {@link LayoutNode} for a container. It creates `measuredSize` and adds `markLayoutDirty()`, which walks up to the root and schedules a pass.

```ts
import { LayoutNode, BoxConstraints, type Size } from '@src/stargazer'

class FixedBox extends LayoutNode {
  constructor(
    private w: number,
    private h: number,
  ) {
    super('fixed-box')
  }
  measure(c: BoxConstraints): Size {
    this.measuredSize.w = c.constrainW(this.w)
    this.measuredSize.h = c.constrainH(this.h)
    return this.measuredSize
  }
  arrange(x: number, y: number, w: number, h: number): void {
    this.transform.x = x
    this.transform.y = y
    this.boundsOverride = { x: 0, y: 0, width: w, height: h }
  }
}
```

A {@link BoxConstraints} holds `minW`, `maxW`, `minH` and `maxH`. A maximum can be `Infinity`. On such an axis the node must size to its content and must not use the maximum. `constrainW` and `constrainH` clamp a value into range.

Follow these rules in a custom node:

- In `arrange`, write only `transform.x` and `transform.y`. Never write scale.
- Set `boundsOverride` to the arranged box, so culling and hit tests use the right area.
- Call `markLayoutDirty()` whenever something that affects your size changes.
- Copy a child's `measuredSize` into local variables right after `measure`. A later `measure` call on that child overwrites it.
- Don't keep the constraints object you receive. The parent reuses it for the next child.

Moving a node in `arrange` repaints nothing. If what a node draws depends on its size, call `markNeedsPaint()` from `arrange` when the size changes.

### When the pass runs

A `LayoutRoot` registers itself with the engine when you add it to a scene that belongs to an engine. It runs a pass only when it is marked dirty. These events mark it dirty:

- the root is added to a scene
- `setContent` or `requestLayout` is called
- the engine emits `resize`
- a container's list method or `markLayoutDirty` runs

The pass runs once per frame at most, after every node's `onUpdate` and before world transforms are computed. Positions written in `arrange` therefore show on the same frame. The pass also runs while the engine is paused. The root clears its dirty flag before it measures, so a `markLayoutDirty` call during a pass schedules another pass on the next frame. A pass allocates no memory.

### Limits

These are the limits of the layout system:

- A `Row` or `Column` with an `Expanded`, `Flexible` or `Spacer` child needs a bounded size on its main axis. Under an unbounded axis it throws an error. A `LayoutRoot` always gives its content a bounded size.
- An `AspectRatio` needs at least one bounded axis, or it throws an error.
- A node that reports a size of `Infinity` or `NaN` makes the root throw an error that names the node.
- Sizing is a single pass. A container can't size its children to match the widest one.
- A `TextNode` does not wrap its text to fit a width.
- There is no scrolling or clipping. Content that is larger than its box overflows.
- A `LayoutBuilder` does not size to the content that reads its rect. That content lives outside the layout, so only your `onLayout` callback keeps the two in step.

## See also

- {@link LayoutRoot}: the node that runs a layout and fills the view
- {@link Row}: children left to right
- {@link Column}: children top to bottom
- {@link LayoutBuilder}: a layout slot for freeform content
- {@link LayoutNode}: base class for your own containers
- {@link BoxConstraints}: the size limits a parent passes to a child
- [Scene graph](/guides/scene): the node tree that layout builds on, and layers
- [Camera](/guides/camera): the view whose visible rect a root fills
- [Text](/guides/text): `TextNode` options
- [Animation](/guides/animation): tweens and cancellation
