/**
 * Recipes: route cards the person saved to run again ("Save as recipe").
 * Stored in this browser only; a recipe is the same draft (actions or the
 * sentence), re-planned and re-quoted from scratch when it is used. Nothing
 * runs on its own.
 */
import { useSyncExternalStore } from "react";

import type { RouteCard } from "@elyia/core/api/agent";

import { isRouteCard } from "./events";
import type { SignSource } from "./useCardSign";

export const RECIPES_KEY = "elyia.ely.recipes.v1";
const MAX = 12;

export interface Recipe {
  readonly id: string;
  readonly title: string;
  readonly source: SignSource;
  readonly card: RouteCard;
  readonly savedAt: number;
}

type Rec = Readonly<Record<string, unknown>>;
const isRec = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value);

export function parseRecipes(raw: string | null): Recipe[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter((entry): entry is Rec => isRec(entry) && typeof entry.id === "string" && typeof entry.title === "string" && typeof entry.savedAt === "number" && isRec(entry.source) && isRouteCard(entry.card))
      .filter((entry) => {
        const source = entry.source as Rec;
        return (source.kind === "text" && typeof source.text === "string") || (source.kind === "actions" && Array.isArray(source.actions) && typeof source.sentence === "string");
      })
      .map((entry) => ({ id: entry.id as string, title: (entry.title as string).slice(0, 120), source: entry.source as unknown as SignSource, card: entry.card as RouteCard, savedAt: entry.savedAt as number }))
      .slice(0, MAX);
  } catch {
    return [];
  }
}

let cache: Recipe[] | null = null;
const listeners = new Set<() => void>();

function read(): Recipe[] {
  if (cache) return cache;
  try {
    cache = parseRecipes(typeof localStorage === "undefined" ? null : localStorage.getItem(RECIPES_KEY));
  } catch {
    cache = [];
  }
  return cache;
}

export function saveRecipe(input: { readonly title: string; readonly source: SignSource; readonly card: RouteCard }): void {
  const key = JSON.stringify(input.source);
  const next = [{ id: `r_${Date.now().toString(36)}`, title: input.title, source: input.source, card: input.card, savedAt: Date.now() }, ...read().filter((recipe) => JSON.stringify(recipe.source) !== key)].slice(0, MAX);
  cache = next;
  try {
    localStorage.setItem(RECIPES_KEY, JSON.stringify(next));
  } catch {
    // memory only
  }
  for (const listener of listeners) listener();
}

export function removeRecipe(id: string): void {
  cache = read().filter((recipe) => recipe.id !== id);
  try {
    localStorage.setItem(RECIPES_KEY, JSON.stringify(cache));
  } catch {
    // memory only
  }
  for (const listener of listeners) listener();
}

export function useRecipes(): readonly Recipe[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read,
    () => [],
  );
}
