import type { Colors } from '../theme';

/** Worst to best. Mirrors LEFTOVER_RATINGS in app/models.py; keep the two in step. */
export const LEFTOVER_RATINGS: Array<{ value: number; label: string }> = [
  { value: 1, label: 'No one ate the leftovers' },
  { value: 2, label: 'Leftovers were just okay' },
  { value: 3, label: 'Good the next day' },
  { value: 4, label: 'Preserves really well' },
];

export function leftoverLabel(rating: number | null | undefined): string | null {
  return LEFTOVER_RATINGS.find(r => r.value === rating)?.label ?? null;
}

/** Badge colours, red for "no one ate them" through green for "preserves really well". */
export function leftoverColors(rating: number, colors: Colors): { fg: string; bg: string } {
  if (rating <= 1) return { fg: colors.danger, bg: colors.dangerBg };
  if (rating === 2) return { fg: colors.warning, bg: colors.warningBg };
  if (rating === 3) return { fg: colors.primary, bg: colors.chip };
  return { fg: colors.success, bg: colors.successBg };
}
