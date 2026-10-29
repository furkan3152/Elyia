/**
 * The user's journeys and watched addresses, kept in this browser only
 * (`elyia.journeys`, `elyia.watched`): every route signed from a flow page
 * lands here with its references so /app/track can follow it. Planner
 * journeys also live on the API (by intent id); offline ones only here.
 * Storage may be blocked: reads then start empty and nothing breaks.
 */
import { useSyncExternalStore } from "react";
import type { NetworkKey } from "@elyia/core/networks";

import { readStorage, writeStorage } from "../../../app/state/storage";
import type { Layer } from "../../../topo/geometry/relief";

export const JOURNEYS_KEY = "elyia.journeys";
export const WATCHED_KEY = "elyia.watched";
const MAX_JOURNEYS = 40;
const MAX_WATCHED = 24;

export interface JourneyLeg {
  readonly stepId: string;
  readonly network: NetworkKey;
  /** `0x…` tx hash or `hc:nonce:<signer>:<nonce>`. */
  readonly reference: string;
  readonly label: string;
  readonly at: number;
}

export interface JourneyRecord {
  /** Local id ("j_…"), or the intent id for planner journeys. */
  readonly id: string;
  readonly source: "planner" | "offline";
  readonly intentId?: string;
  readonly routeId: string;
  readonly sentence: string;
  readonly createdAt: number;
  readonly layers: readonly Layer[];
  readonly legs: readonly JourneyLeg[];
}

export interface WatchedAddress {
  readonly address: string;
  readonly label: string;
  readonly addedAt: number;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const LAYERS = new Set<Layer>(["floor", "ridge", "summit"]);

function isLeg(value: unknown): value is JourneyLeg {
  const leg = value as JourneyLeg;
  return typeof leg === "object" && leg !== null && typeof leg.stepId === "string" && typeof leg.network === "string" && typeof leg.reference === "string" && typeof leg.label === "string" && typeof leg.at === "number";
}

/** Parses stored journeys, dropping anything malformed (storage is user-editable). */
export function parseJourneys(raw: string | null): JourneyRecord[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is JourneyRecord => {
        const record = item as JourneyRecord;
        return (
          typeof record === "object" && record !== null && typeof record.id === "string" && (record.source === "planner" || record.source === "offline") &&
          typeof record.routeId === "string" && typeof record.sentence === "string" && typeof record.createdAt === "number" &&
          Array.isArray(record.layers) && record.layers.every((layer) => LAYERS.has(layer)) && Array.isArray(record.legs) && record.legs.every(isLeg)
        );
      })
      .slice(0, MAX_JOURNEYS);
  } catch {
    return [];
  }
}

export function parseWatched(raw: string | null): WatchedAddress[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is WatchedAddress => {
      const entry = item as WatchedAddress;
      return typeof entry === "object" && entry !== null && typeof entry.address === "string" && ADDRESS.test(entry.address) && typeof entry.label === "string" && typeof entry.addedAt === "number";
    }).slice(0, MAX_WATCHED);
  } catch {
    return [];
  }
}

/** Inserts or replaces a journey (newest first), capped. */
export function upsertJourney(list: readonly JourneyRecord[], record: JourneyRecord): JourneyRecord[] {
  return [record, ...list.filter((item) => item.id !== record.id)].slice(0, MAX_JOURNEYS);
}

/** Adds a leg to a journey (a re-submitted reference replaces itself). */
export function addLeg(record: JourneyRecord, leg: JourneyLeg): JourneyRecord {
  return { ...record, legs: [...record.legs.filter((item) => item.reference !== leg.reference), leg] };
}

export function upsertWatched(list: readonly WatchedAddress[], entry: WatchedAddress): WatchedAddress[] {
  const address = entry.address.toLowerCase();
  return [{ ...entry, address }, ...list.filter((item) => item.address.toLowerCase() !== address)].slice(0, MAX_WATCHED);
}

/* ------------------------------------------------------------ the store */

type Listener = () => void;
const NO_JOURNEYS: JourneyRecord[] = [];
const NO_WATCHED: WatchedAddress[] = [];
const listeners = new Set<Listener>();
let journeys: JourneyRecord[] | null = null;
let watched: WatchedAddress[] | null = null;

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === JOURNEYS_KEY) journeys = parseJourneys(event.newValue);
    else if (event.key === WATCHED_KEY) watched = parseWatched(event.newValue);
    else return;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function getJourneys(): JourneyRecord[] {
  journeys ??= parseJourneys(readStorage(JOURNEYS_KEY));
  return journeys;
}

export function getWatched(): WatchedAddress[] {
  watched ??= parseWatched(readStorage(WATCHED_KEY));
  return watched;
}

export function saveJourney(record: JourneyRecord): void {
  journeys = upsertJourney(getJourneys(), record);
  writeStorage(JOURNEYS_KEY, JSON.stringify(journeys));
  emit();
}

export function forgetJourney(id: string): void {
  journeys = getJourneys().filter((item) => item.id !== id);
  writeStorage(JOURNEYS_KEY, JSON.stringify(journeys));
  emit();
}

export function watchAddress(address: string, label: string): void {
  watched = upsertWatched(getWatched(), { address, label: label.trim().slice(0, 32), addedAt: Date.now() });
  writeStorage(WATCHED_KEY, JSON.stringify(watched));
  emit();
}

export function unwatchAddress(address: string): void {
  watched = getWatched().filter((item) => item.address.toLowerCase() !== address.toLowerCase());
  writeStorage(WATCHED_KEY, JSON.stringify(watched));
  emit();
}

export function useJourneys(): readonly JourneyRecord[] {
  return useSyncExternalStore(subscribe, getJourneys, () => NO_JOURNEYS);
}

export function useWatched(): readonly WatchedAddress[] {
  return useSyncExternalStore(subscribe, getWatched, () => NO_WATCHED);
}
