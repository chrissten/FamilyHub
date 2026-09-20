import type { Recipe } from '../api/types';

export interface PendingRecipeForm {
  /** null when creating a new recipe. */
  recipe: Recipe | null;
}

let pending: PendingRecipeForm | null = null;

/** Stashes the recipe the form route needs before navigating to it. expo-router params
 *  are URL-based and can't carry a nested object, so this mirrors the approach in
 *  src/calendar/formState.ts rather than inventing a second one. */
export function setPendingRecipeForm(payload: PendingRecipeForm): void {
  pending = payload;
}

export function takePendingRecipeForm(): PendingRecipeForm | null {
  const value = pending;
  pending = null;
  return value;
}

/** Ingredients and steps are edited as plain text, one per line — the same shape the
 *  web form uses, and the same shape the server parses back into structured rows. */
export function recipeToText(recipe: Recipe | null): { ingredients: string; steps: string } {
  if (!recipe) return { ingredients: '', steps: '' };
  return {
    ingredients: recipe.ingredients.map(i => i.raw_text).join('\n'),
    steps: recipe.steps.map(s => s.text).join('\n'),
  };
}

export function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.trim().replace(/\s+/g, ' '))
    .filter(line => line.length > 0);
}

/** Total time shown on a card, or null when the recipe records neither prep nor cook. */
export function totalMinutes(recipe: { prep_minutes?: number | null; cook_minutes?: number | null }): number | null {
  if (recipe.prep_minutes == null && recipe.cook_minutes == null) return null;
  return (recipe.prep_minutes ?? 0) + (recipe.cook_minutes ?? 0);
}
