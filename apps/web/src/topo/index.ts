/**
 * Elyia's drawn artifacts (Survey). Every artifact is hand-drawn SVG with
 * its geometry in a pure module (./geometry, node:test covered), its own
 * accessible name, motion that honours reduced motion, and live-data props.
 * API reference: ./README.md. Living catalog: /system.
 */
export { AvalancheBulletin, AvalanchePictogram, type AvalancheBulletinProps } from "./AvalancheBulletin";
export { Altimeter, type AltimeterProps } from "./Altimeter";
export { Barograph, type BarographProps } from "./Barograph";
export { Blaze, type BlazeProps } from "./Blaze";
export { ConditionSign, type ConditionSignProps } from "./ConditionSign";
export { ContourField, Grain, type ContourFieldProps, type GrainProps } from "./ContourField";
export { ElevationProfile, type ElevationProfileProps } from "./ElevationProfile";
export { GuideLicence, type GuideLicenceProps } from "./GuideLicence";
export { HutStamp, type HutStampProps, type HutStampState } from "./HutStamp";
export { KeySwatch } from "./keySwatch";
export { MapKey, MapSheet, NorthArrow, ScaleBar, TitleBlockBox, type MapKeyItem, type MapKeyProps, type MapSheetProps, type NorthArrowProps, type ScaleBarProps, type TitleBlock } from "./MapSheet";
export { RadioLog, type RadioEntry, type RadioLogProps, type RadioTone } from "./RadioLog";
export { Relief, type ReliefProps } from "./Relief";
export { Rope, type RopeProps } from "./Rope";
export { RouteCard, type RouteCardProps, type RouteEvidence, type RouteStep, type RouteStepState } from "./RouteCard";
export { Signpost, SignpostCluster, type SignpostClusterProps, type SignpostProps } from "./Signpost";
export { SummitRegister, type RegisterRow, type SummitRegisterProps } from "./SummitRegister";
export { TopoDefs } from "./TopoDefs";
export { Weather, type WeatherProps } from "./Weather";
export { Windsock, type WindsockProps } from "./Windsock";

export * from "./geometry/altimeter";
export * from "./geometry/barograph";
export * from "./geometry/conditions";
export * from "./geometry/profile";
export * from "./geometry/relief";
export * from "./geometry/rope";
export * from "./geometry/route";
export * from "./geometry/shock";
export { fieldAt, isolines, polygonArea, ringContains, sampleField, simplify, smoothPath, type Field, type Point, type Polyline } from "./geometry/contours";
