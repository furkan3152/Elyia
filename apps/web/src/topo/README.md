# src/topo: Elyia's drawn artifacts (Survey)

Every artifact is hand-drawn SVG, has its own accessible name, honours reduced
motion (OS setting or `html[data-motion=off]`: end state, no loops), pauses
off screen and in hidden tabs, and keeps its geometry in a pure module under
`./geometry` (node:test: `src/topo/__tests__/geometry.test.ts`). Living
catalog with sample data: **`/system`** (src/pages/kit/SystemPage.tsx).

```ts
import { Relief, Rope, RouteCard, HutStamp, Altimeter } from "../../topo";
import { Button, Panel, PanelHeader, Tag, LayerChip, WhereToInput } from "../../ui";
```

Layouts mount `<TopoDefs />` once (ink, rough and grain filters); the site and
app shells already do.

## Look (Survey)

- Fonts: Space Grotesk (`font-sans`, headings/body), IBM Plex Mono (`font-mono`, every number + captions), Instrument Serif italic (`font-map` / `.map-label`, map labels only).
- Tokens (tailwind names): `paper`, `paper-2`, `paper-3`, `card`, `ink`, `ink-2`, `ink-3`, `rule`, `contour`, `signal` (yellow highlight only), `accent` (glacier, the primary action), `floor`, `ridge`, `summit` (+ `summit-ink` for words), `up`, `down`, `warn` (+ `warn-ink`), `water`, `blaze-red`, `blaze-blue`. Alpha works: `bg-signal/40`.
- Sheets: `html[data-theme=day|night]`; `.el-day` / `.el-night` force a sheet on a subtree.
- Objects: 2 px ink border, hard shadow (`shadow-hard`, `shadow-hard-lg`), square corners; captions are `.caption` (mono micro-caps, " · ").
- Legacy class names (`bg-bg-1`, `text-text-0`, `violet`, `gold`, `mint`, `rose`, `sky`) still compile and map onto Survey tokens; new code uses Survey names.

## Artifacts

| Component | Key props | Notes |
|---|---|---|
| `MapSheet` | `label`, `elevation` (live slot), `titleBlock {name, scale?, date?, surveyor?, mode?}`, `furniture`, `ticks` | Frame with neat-line ticks. Furniture: `NorthArrow`, `ScaleBar {labels}`, `MapKey {items: {swatch,label}[]}` (+ `KeySwatch.line/fill/peak`), `TitleBlockBox`. |
| `Signpost` | `destination`, `eta`, `grade`, `direction`, `onClick` / `to`, `highlight` (yellow), `chosen`, `detail`, `index` | Pointed blade; swings in on a spring. Clickable = real button/link. |
| `SignpostCluster` | `blades`, `caption`, `label` | Blades on a pole, staggered. |
| `RouteCard` | `id`, `sentence`, `grade`, `steps: RouteStep[]` (`layer`, `toLayer?`, `action`, `venue`, `inOut`, `fee`, `eta`, `state: settled/climbing/next/waiting/failed`, `block?`, `time?`), `fees`, `signatures {done, needed, note?}`, `quote {expiresAt, boundTo?}`, `rules`, `binding`, `evidence`, `action`, `note`, `sample` | Elevation profile across bands, hut stamps on settled steps, log-book waypoints, perforated stub with live quote countdown. |
| `HutStamp` | `layer`, `state: settled/signed/refused`, `block`, `time`, `size`, `animate`, `delayMs`, `label` | Thump only on a real change: key it with `useChangeKey`. |
| `Barograph` | `feed` (`usePulseFeed()`; omit for a labelled sample), `sampleCadenceMs`, `speed`, `height`, `readout` | One transform per frame; trace rebuilt per block. |
| `Relief` | `holdings: ReliefHolding[]` (`id`, `symbol`, `usd`, `layer`, `side?`, `leverage?`, `note?`), `interval?`, `seed?`, `formatUsd`, `drawOn`, `regionLabels`, `furniture`, `onSelect`, `selectedId`, `minWidth` | Memoised `buildRelief` (~30 holdings in a few ms). Shorts = dashed basins, leverage = hatched cliffs. Pans sideways below `minWidth`. |
| `ElevationProfile` | `series: {t, value}[]`, `camps: {t, label}[]`, `label`, `caption`, `startLabel`, `endLabel`, `formatValue`, `height` | Measures its container; summit flag at ATH, valley at max drawdown; axis in its own gutter. |
| `Rope` | `side`, `entry`, `mark`, `liquidation?`, `stop?`, `takeProfit?`, `symbol`, `formatPrice`, `variant: full/compact` | Crevasse → anchor → climber → entry → flag. Frays < 10%, pulses (< 1 Hz) < 5%; climber glides. |
| `Windsock` | `fundingApr` (fraction, + = longs pay), `size`, `showLabel` | 5 stripes, one per 10% APR. |
| `Weather` | `weather: clear/few/overcast/storm`, `showLabel`, `detail` | From `weatherFromVolatility(vol, history)`. |
| `AvalancheBulletin` | `positions: ShockPosition[]`, `netWorth`, `driver`, `concentration`, `formatUsd`, `action(shock)`, `slider` | Shock −30…+30% through `applyShock`. Also `AvalanchePictogram {level}`. |
| `Blaze` | `grade` (1-6), `size`, `showGrade`, `label` | Yellow diamond / white-red-white / white-blue-white. |
| `ConditionSign` | `condition: open/caution/closed`, `reason`, `score`, `size` | From `conditionFromScore`. |
| `GuideLicence` | `agent`, `holder`, `markets`, `actions`, `limits: [label, value][]`, `validFrom`, `validUntil`, `now`, `revoked`, `footer`, `sample` | Punched days, scope stamp, VOID tear. |
| `RadioLog` | `entries: {id, at, from, to?, message, tone?, live?}[]`, `title`, `aside`, `footer`, `maxHeight` | Agent feed / Telegram preview. |
| `SummitRegister` | `rows: {id, when, entry, layer, amount?, direction?, proof?}[]`, `caption`, `empty` | Ruled log book. |
| `Altimeter` | `value` (formatted string), `label`, `variant: boxed/inline`, `size`, `markLatest` | Rolls only changed digits. |
| `ContourField`, `Grain` | `seed`, `strength` | Faint static ground; riso stipple overlay. |

Pure helpers (all exported from `src/topo`): `buildRelief`, `hillSigma`, `contourInterval`, `isolines`, `smoothPath`, `profileModel`, `maxDrawdown`, `ropeGeometry`, `ropeDistance`, `applyShock`, `windsock`, `weatherFromVolatility`, `avalancheLevel`, `gradeFor`, `blazeFor`, `conditionFromScore`, `digitDiff`, `routeProfile`, `bladePath`, barograph scheduler (`visibleTicks`, `tracePath`, `cadenceMs`).

## UI primitives (src/ui), Survey skin

`Button` / `ButtonLink` (`variant: primary | signpost | ink | solid-ink | danger | ghost | long | short`, `size xs-xl`, `loading` = contour loader, `grade`), `IconButton`, `Kbd`/`KbdCombo`, `Badge`, `Chip`, `Tag` (label tab), `LayerChip {layer, network?, variant}`, `GradeChip`, `Panel {variant: flat|raised|sheet|well, fold}`, `PanelHeader {ruled}`, `SectionHeader {parts, title, description}`, `Tabs`, `SegmentedControl`, `Input`, `WhereToInput`, `NumberField` (= `NumberInput`, `unit`), `Slider {gradeOf}`, `Toggle`, `Dialog`, `Sheet`, `toast` (radio message, `from`), `Tooltip`, `DataTable` (log book), `Skeleton` (contour placeholder), `EmptyState {scene, example, action}`, `ContourLoader`.

## Motion (src/motion)

`useReducedMotion`, `usePageVisible`, `useInView`, `useAutoPause` (`{ref, active, seen}`), `useChangeKey`, `useAnimationFrame`, `Reveal`, `runViewTransition`, tokens `DURATION` (90/150/240/420/1200), `EASE` (draw, spring), `cssVars`, `seededRandom`.

## Shell (src/app/shell)

`TopBar` (nav DECK · TRADE · PORTFOLIO · GUIDE + MORE, Where-to trigger, DAY/NIGHT, motion, wallet; margin strip with sheet label, `AltimeterHeads`, practice-wall chip), `MobileBar` (signpost tabs), `SiteHeader`, `SiteFooter` / `AppFooter` (title block), `WhereTo` (⌘K / Ctrl-K: pages, markets, sentences → `/app?intent=`), `sheets.ts` (`sheetLabel(routeId)`), `Page` / `PageHeader`.
