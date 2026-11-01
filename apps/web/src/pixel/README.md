# src/pixel: the Pixel Survey kit

Pixel art, topographic elevation, Ely the pixel ibex, strict symmetry. Ported
from the approved reference (`elyia-design/px/reference.html`) into strict
TypeScript. Living key with every piece in its states, on both sheets:
**`/system`** (`src/pages/kit`).

```ts
import { Ely, ElyLoader, ElyEmpty, PixelScene, PixelTerrain, PixelRope, Cards, Section } from "../../pixel";
```

## Rules (non-negotiable)

1. **One centre axis.** Build pages with the layout primitives below. 12 columns, 1200 px max, 24 px gutters. Section heads are centred: tag chip, headline, lede. Cards in a row are equal in width and height. Never 2/3 + 1/3.
2. **The pixel unit is 4 px.** Style A ("game button", chosen by the owner): no ink outlines and no black block shadows anywhere. Frames are `px-frame` / `px-frame-thin`: a 2 px tone line (`--rule`) drawn with box-shadow so the corners step. `px-drop` adds a translucent depth band inside the bottom edge, `px-drop-lg` a stronger tone line and deeper band. Buttons are `px-btn` + a tone (`px-btn-accent | -signal | -paper | -down | -up | -ink`): flat fill, 4 px stepped corners, 4 px bevel (light top-left, dark bottom-right), pressed inverts it. No radius, no blur.
3. **Every drawing is a canvas** through `PixelCanvas`: `image-rendering: pixelated`, an integer device-pixel scale at any DPR.
4. **Type:** Pixelify Sans (`font-display`) for headings and big numbers, Silkscreen (`font-tag`) for tags, labels and nav, IBM Plex Mono (`font-sans` / `font-mono`) for body and data.
5. **Ely speaks the state**, purposefully: loaders (`ElyLoader`), empty states (`ElyEmpty` / `EmptyState`), success, risk, Guide messages (`ElyToast`, used by every `toast()`).
6. **Motion** runs on one shared ticker, steps (`steps()` easing), pauses off screen and in hidden tabs, never flashes above 3 Hz; reduced motion (OS or the Motion switch) draws the end state.
7. **Focus** is a 4 px dashed sun outline. ▲ / ▼ always carry the sign, never colour alone. Canvases have `aria-label`s.

## Layout primitives (`layout.tsx`)

| Component | Props | Notes |
|---|---|---|
| `Page` | `width?: "wide" \| "narrow" \| "full"`, `className` | Centred sheet, 1200 / 800 / none, 24 px gutters. `app/shell/Page` re-exports it. |
| `Section` | `id?`, `tag?`, `title?`, `lede?`, `actions?`, `level?: 1 \| 2`, `seam?`, `className` | Centred head on the axis; a dashed pixel seam between sections. |
| `Grid` | `cols?: 1 \| 2 \| 3 \| 4 \| 6 \| 12`, `keep?`, `as?`, `className` | Equal spans on the 12-column grid; one column on phones unless `keep`. |
| `Cards` | `n?: 1-6`, `as?`, `className` | Equal cards; narrower screens use a divisor of n (4: 4/2/2, 3: 3/1/1, 6: 6/3/2/2); rows stretch to equal height; a short row stays centred. |
| `Split` | `mirrored?`, `align?: "stretch" \| "center"`, `className`, `children: [a, b]` | Exactly two equal halves (equal heights); `mirrored` aligns both to the axis. |

## Components

| Component | Props |
|---|---|
| `PixelCanvas` | `width`, `height`, `scale?` (fixed CSS px per pixel; omitted = fit the container), `pixelSize?` (fit: CSS px per pixel to aim for), `aspect?` (fit: height follows width), `contain?` (fixed art at the largest whole scale), `draw(ctx, {w, h, seconds, still})`, `animate?`, `fps?`, `endTime?`, `label?`, `decorative?`, `redrawKey?`, `night?` (draw as NIGHT regardless of the sheet), `halo?` (default true: NIGHT rim on `drawGrid` sprites), `className?`, `canvasClassName?`, `style?` |
| `Ely` | `state?: "idle" \| "climb" \| "summit" \| "worry" \| "sleep" \| "watch" \| "talk"`, `traits?: ElyTraits`, `size?` (CSS px height, default 88), `label?: string \| null`, `still?`, `className?` |
| `ElyLoader` | `label` (status text), `size?: "sm" \| "md" \| "lg"`, `hideLabel?`, `className?` |
| `ElyEmpty` | `title`, `description?`, `action?`, `compact?`, `className?` |
| `ElyToast` | `tone?: "info" \| "success" \| "warning" \| "error"`, `title`, `description?`, `from?`, `time?`, `action?: {label, onClick}`, `onDismiss?`, `pop?`, `className?` |
| `PixelScene` | `labels?: {summit, ridge, floor}`, `cycle?` (s, default 18), `feed?: BlockFeed \| null \| "pulse"` (default the live Elysium pulse, labelled sample while quiet), `night?` (default follows the sheet), `label?`, `hideCaption?`, `className?` |
| `PixelTerrain` | `holdings: TerrainHolding[]` (`id`, `label`, `usd`, `side?`, `rope?` %, `stable?`, `x?`, `y?`), `shock?` (%), `onSelect?`, `selectedId?`, `label?`, `formatUsd?`, `resolution?`, `aspect?`, `className?` |
| `PixelRope` | `side`, `entry`, `mark`, `liquidation?`, `stop?`, `takeProfit?`, `symbol?`, `formatPrice?`, `variant?: "full" \| "compact"`, `className?` |
| `PixelAltimeter` | `value` (formatted), `label`, `variant?: "boxed" \| "inline"`, `size?: "sm" \| "md" \| "lg"`, `markLatest?`, `className?` |
| `PixelProfile` | `series: {t, value}[]`, `camps?: {t, label}[]`, `label`, `height?` (pixels), `formatValue?`, `startLabel?`, `endLabel?`, `caption?`, `className?` |
| `PixelBarograph` | `feed?: BlockFeed \| null`, `sampleCadenceMs?`, `height?`, `readout?`, `label?`, `className?` |
| `PixelStamp` | `state?: "settled" \| "signed" \| "queued" \| "refused"`, `text?`, `detail?`, `size?`, `animate?`, `delayMs?`, `rotate?`, `label?`, `className?` |
| `HerdPortrait` | `id?` (1..3333; 0 = the unrevealed placeholder) or `member?`, `scale?` (default 4: 192 px), `fluid?`, `label?`, `className?` |
| `HerdCard` | `id`, `onSelect?(id)`, `selected?`, `className?` |
| `RarityBadge` | `rarity`, `className?` |
| `PixelGlyph` | `rows`, `frames?`, `fps?`, `scale?`, `palette?` (hex or `--token`), `label: string \| null`, `className?` |
| `TopoBackdrop` | `className?`. Mounted once in `SiteLayout` and `AppShell`. |

## Engine (pure, `__tests__/pixel.test.ts`)

- `ely.ts`: `makeEly(traits)` → 32 x 34 colour grid (mirrored, outlined), `mini(grid)` (16 x 17), `mirror`, `outline`, `elySprite` (memoised), catalogues `FURS`, `HORNS`, `EYES`, `MOUTHS`, `GEAR`, `LAYERS`.
- `topo.ts`: `rngOf`, `shade`, `topoField`, `drawTopo`, `bandOf`, `isContour`, `contourMask`, `fieldMax`.
- `terrain.ts`: `terrainModel(holdings, w, h, shock)` (the height field from holdings), `paintTerrain(ctx, model, seconds, palette)` (`DAY_TERRAIN` / `NIGHT_TERRAIN`: moonlit bands by NIGHT), `layoutTerrain`, `snappedBy`, `landBand`, `placeLabels` (labels clamped onto the map, never touching), `SAMPLE_TERRAIN`.
- `draw.ts`: `drawGrid`, `drawSilhouette`, `drawDisc`, `fixedScale`, `fitScale`, `withSpriteHalo(color, paint)` + `NIGHT_HALO` (#6E8C7E: by NIGHT every sprite drawn with `drawGrid` gets a one pixel moonlit rim outside its ink outline, 4.5:1 on the NIGHT card; PixelCanvas applies it from the painted sheet).
- `ticker.ts`: `createTicker(env)` (one rAF loop, per-subscriber fps cap, visibility, reduced motion); `useTicker.ts`: `sharedTicker()`, `usePixelLoop(element, draw(seconds, still), {fps, endTime, enabled, redrawKey})` (IntersectionObserver pause; still canvases repaint the end state only when their inputs change).
- `herd.ts`, `herdTraits.ts`, `herdArt.ts`, `herdLegends.ts`: The Herd (below).
- `scene.ts`, `states.ts`, `profile.ts`, `rope.ts`, `route.ts`, `glyphs.ts`, `blockTicks.ts`: the drawings behind the components.

## Re-skinned kit

`ui/*` keep their exports and props; they now draw pixel frames (Button, Panel, Tabs, SegmentedControl, Toggle, Slider, Input/Field, Badge, Chip, Tag, Kbd, Dialog, Sheet, Popover, Stat, DataTable, EmptyState → Ely hut, Toaster → ElyToast, Skeleton → dither, ContourLoader → pixel blocks). `topo/*` keep their props: Relief → PixelTerrain, Rope → PixelRope, ElevationProfile → PixelProfile, HutStamp → PixelStamp, Altimeter → PixelAltimeter, Barograph → PixelBarograph; Weather, Windsock, Blaze, AvalanchePictogram are pixel glyphs; RouteCard has a pixel profile with Ely on the live step; AvalancheBulletin carries Ely (worry at level 3+); GuideLicence is a pixel permit with punched days and Ely on watch.

## The Herd (NFT art, one source of truth)

3333 goats, 48 x 48 art: the mascot's own head (`paintElyHead` in `ely.ts`) on a neck and chest, over a seeded elevation map. The browser and the PNG generator (`packages/herd-art`) run the same code; the art uses only IEEE-exact maths (`+ - * /`, `sqrt`, integers; `dexp` instead of `Math.exp`), so every JS engine paints the generator's pixels bit for bit.

- `herdTraits.ts`: `HERD_TRAIT_TABLE` (9 categories in layer order: background, fur, horns, eyes, mouth, beard, headwear, neck, accessory; weights out of 1000), `HERD_CONFLICTS` (pairs that never share a goat, with reasons), `TRAIT_KEYS`, `TRAIT_LABELS`.
- `herdArt.ts`: `paintHerd(look, seed)` → 48 x 48 grid; `paintFigure`, `paintBackdrop`, `dexp`, `herdField`. Layers are outlined one by one (back, body, neck, head, front); night scenes get the moonlit rim (`NIGHT_HALO`), alpenglow a sun rim.
- `herdLegends.ts`: `HERD_LEGENDS`, the 15 hand-made 1/1s.
- `herd.ts`:
  - `herdMember(id)` → `{ id, name, traits[{key,label,name,share}], legend, odds, score, rank, rarity, grid, backdrop }` (memoised; art painted on first `grid` read).
  - `herdTraits()` → every category and option with live `count`, `share`, `tier`.
  - `drawHerd(canvas, id, scale = 1)` sizes and paints any canvas (`id` 0 = placeholder).
  - `herdMetadata(id, imageBase)` (ERC-721 JSON), `herdPlaceholderArt()`, `herdPlaceholderMetadata()`, `herdRoster()`, `herdLook(id)`, `rarityOfRank`, `herdLabel`, `nextHerdId`, `HERD_SIZE`, `HERD_SEED`, `RARITY_LABEL`, `RARITY_FILL`.
  - Roll: legend ids drawn first from `HERD_SEED`, then ids 1..3333 rolled in order (each category skips options conflicting with earlier picks; duplicate combinations re-rolled). Rarity score = sum over categories of 3333 / count; 1/1s rank 1..15; tiers by rank: legendary 15, epic 100, rare 333, uncommon 900, common 1985.
- Generator: `npm run herd:generate` (PNGs at 960 px, metadata, collection.json, rarity.json, provenance.json, placeholder; default out `/home/user/elyia-design/herd/out`), `npm run herd:gallery`, `npm run test:herd`.
