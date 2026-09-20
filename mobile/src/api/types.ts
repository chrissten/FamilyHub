export interface User {
  id: number;
  username: string;
  display_name: string;
  color_hex: string;
  is_admin: boolean;
}

export interface CalendarEvent {
  id: number;
  title: string;
  description?: string;
  location?: string;
  /** True UTC instant (ISO 8601 with offset/Z) — convert to device-local for display. */
  start_time: string;
  end_time: string;
  all_day: boolean;
  /** IANA zone the event is anchored to, e.g. "America/New_York". */
  timezone: string;
  conflict: boolean;
  owner_id: number;
  owner: User;
  attendees: User[];
  series_id?: string | null;
  series_until?: string | null;
}

export interface GroceryList {
  id: number;
  name: string;
  is_public: boolean;
  owner: User;
}

export interface GroceryCategory {
  id: number;
  name: string;
  sort_order: number;
  list_id: number;
}

export interface GroceryItem {
  id: number;
  name: string;
  quantity?: string;
  checked: boolean;
  category_id: number;
  added_by: User;
  checked_by?: User | null;
}

export interface TodoList {
  id: number;
  name: string;
  is_public: boolean;
  owner: User;
}

export interface TodoItem {
  id: number;
  text: string;
  checked: boolean;
  list_id: number;
  added_by: User;
  checked_by?: User | null;
}

export interface Freezer {
  id: number;
  name: string;
}

export interface FreezerItem {
  id: number;
  name: string;
  quantity?: string | null;
  quantity_unit?: string | null;
  count: number;
  date_purchased?: string | null;
  expiration_date?: string | null;
  freezer_id: number;
  added_by: User;
}

/** Canonical ingredient (app/models.py Ingredient) — the join point that lets a recipe,
 *  the freezer and the pantry agree that they mean the same thing. */
export interface Ingredient {
  id: number;
  name: string;
  category?: string | null;
  is_staple: boolean;
}

export interface RecipeIngredient {
  id: number;
  /** The original written line, always what gets shown to the cook. */
  raw_text: string;
  quantity?: number | null;
  unit?: string | null;
  name: string;
  prep_note?: string | null;
  optional: boolean;
  sort_order: number;
  /** null when the name couldn't be resolved to a canonical ingredient. */
  ingredient?: Ingredient | null;
}

export interface RecipeStep {
  id: number;
  step_number: number;
  text: string;
}

/** Card/list view — no ingredients or steps, matching RecipeSummaryOut. */
export interface RecipeSummary {
  id: number;
  title: string;
  description?: string | null;
  servings?: number | null;
  prep_minutes?: number | null;
  cook_minutes?: number | null;
  source_type: string;
  source_url?: string | null;
  source_name?: string | null;
  image_url?: string | null;
  is_public: boolean;
  owner: User;
  tag_names: string[];
}

export interface Recipe extends RecipeSummary {
  notes?: string | null;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  image_ids: number[];
}

/** Body for creating/updating a recipe. `steps` is plain strings and `ingredients`
 *  carries the parsed shape the server expects (see RecipeCreate in app/schemas.py). */
export interface RecipeInput {
  title: string;
  description?: string | null;
  servings?: number | null;
  prep_minutes?: number | null;
  cook_minutes?: number | null;
  notes?: string | null;
  source_type?: 'manual' | 'url' | 'photo' | 'text';
  source_url?: string | null;
  source_name?: string | null;
  image_url?: string | null;
  is_public?: boolean;
  tags?: string[];
  ingredients?: Array<{
    raw_text: string;
    quantity?: number | null;
    unit?: string | null;
    name: string;
    prep_note?: string | null;
    optional?: boolean;
  }>;
  steps?: string[];
  /** Claims photos stashed during import so they attach to the saved recipe. */
  scan_token?: string | null;
}

/** An extracted, not-yet-saved recipe (RecipeDraftOut in app/schemas.py). Review it,
 *  then POST it back via createRecipe — passing scan_token so uploaded photos attach. */
export interface RecipeDraft {
  title: string;
  description?: string | null;
  servings?: number | null;
  prep_minutes?: number | null;
  cook_minutes?: number | null;
  tags: string[];
  ingredients: Array<{
    raw_text: string;
    quantity?: number | null;
    unit?: string | null;
    name: string;
    canonical_name?: string;
    prep_note?: string | null;
    optional?: boolean;
  }>;
  steps: string[];
  source_url?: string | null;
  source_name?: string | null;
  image_url?: string | null;
  scan_token?: string | null;
}

/** Result of pushing recipe ingredients onto a grocery list. */
export interface ToGroceryResult {
  added: number;
  merged: number;
  names: string[];
  list_id: number;
}

export interface PantryItem {
  id: number;
  location: 'pantry' | 'fridge';
  quantity?: string | null;
  low: boolean;
  ingredient: Ingredient;
  added_by: User;
}

/** One recipe ranked against what's in the kitchen (RecipeMatchOut in app/schemas.py). */
export interface RecipeMatch {
  recipe: RecipeSummary;
  have: MatchIngredient[];
  missing: MatchIngredient[];
  /** Never resolved to a canonical ingredient, so we can't say either way — these hold
   *  a recipe back rather than being silently assumed present. */
  unknown: MatchIngredient[];
  optional_missing: MatchIngredient[];
  shortfall: number;
  can_make: boolean;
  bucket: 'ready' | 'one' | 'several';
}

export interface MatchIngredient {
  id: number;
  raw_text: string;
  name: string;
  optional: boolean;
  ingredient?: Ingredient | null;
}
