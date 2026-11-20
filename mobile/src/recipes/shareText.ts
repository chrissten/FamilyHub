import type { Recipe } from '../api/types';

/** Plain-text rendering of a recipe, for email and the system share sheet. Mirrors
 *  recipe_to_text() in app/recipe_share.py so both platforms email the same thing. */
export function recipeToText(recipe: Recipe, link?: string | null): string {
  const lines: string[] = [recipe.title];
  const meta = [
    recipe.servings ? `Serves ${recipe.servings}` : null,
    recipe.prep_minutes ? `${recipe.prep_minutes} min prep` : null,
    recipe.cook_minutes ? `${recipe.cook_minutes} min cook` : null,
  ].filter(Boolean).join('  |  ');
  if (meta) lines.push(meta);
  if (recipe.tag_names.length) lines.push(recipe.tag_names.join(', '));
  if (recipe.description) lines.push('', recipe.description);

  lines.push('', 'INGREDIENTS');
  if (recipe.ingredients.length) {
    for (const item of recipe.ingredients) lines.push(`- ${item.raw_text}${item.optional ? ' (optional)' : ''}`);
  } else {
    lines.push('(none listed)');
  }

  if (recipe.steps.length) {
    lines.push('', 'METHOD');
    recipe.steps.forEach((step, i) => lines.push(`${i + 1}. ${step.text}`));
  }
  if (recipe.notes) lines.push('', 'NOTES', recipe.notes);

  const source = [recipe.source_name, recipe.source_url].filter(Boolean).join(' - ');
  if (source) lines.push('', `Source: ${source}`);
  if (link) lines.push('', `View online: ${link}`);
  lines.push('', 'Shared from FamilyHub');
  return lines.join('\n');
}

export function recipeMailto(recipe: Recipe, link?: string | null): string {
  return `mailto:?subject=${encodeURIComponent(recipe.title)}&body=${encodeURIComponent(recipeToText(recipe, link))}`;
}
