/**
 * The Pixel Survey kit: the pixel engine (pure, tested), the pixel
 * components and the layout primitives. API reference: ./README.md. Living
 * key: /system.
 *
 *   import { Ely, ElyLoader, PixelScene, PixelTerrain, Cards, Section } from "../../pixel";
 */

// engine (pure)
export * from "./ely";
export * from "./topo";
export * from "./draw";
export * from "./ticker";
export * from "./herd";
export * from "./terrain";
export * from "./scene";
export * from "./states";
export * from "./profile";
export * from "./rope";
export * from "./route";
export * from "./glyphs";
export { TickStore, type TickStoreOptions } from "./blockTicks";

// hooks
export { sharedTicker, usePixelLoop, type PixelLoopOptions } from "./useTicker";
export { useBlockTicks } from "./useBlockTicks";
export { tileMask, useContourTile } from "./useContourTile";

// components
export { PixelCanvas, type PixelCanvasProps, type PixelDrawInfo } from "./PixelCanvas";
export { PixelGlyph, type PixelGlyphProps } from "./PixelGlyph";
export { Ely, type ElyProps } from "./Ely";
export { ElyLoader, type ElyLoaderProps } from "./ElyLoader";
export { ElyEmpty, type ElyEmptyProps } from "./ElyEmpty";
export { ElyToast, type ElyToastProps, type ElyToastTone } from "./ElyToast";
export { PixelScene, type PixelSceneProps } from "./PixelScene";
export { PixelTerrain, type PixelTerrainProps } from "./PixelTerrain";
export { PixelRope, type PixelRopeProps } from "./PixelRope";
export { PixelAltimeter, type PixelAltimeterProps } from "./PixelAltimeter";
export { PixelProfile, type PixelProfileProps } from "./PixelProfile";
export { PixelBarograph, type PixelBarographProps } from "./PixelBarograph";
export { PixelStamp, type PixelStampProps, type PixelStampState } from "./PixelStamp";
export { HerdCard, HerdPortrait, RarityBadge, type HerdCardProps, type HerdPortraitProps } from "./Herd";
export { TopoBackdrop, type TopoBackdropProps } from "./TopoBackdrop";

// layout
export { Cards, Grid, Page, Section, Split, type CardsProps, type GridProps, type PageProps, type SectionProps, type SplitProps } from "./layout";
