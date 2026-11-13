// A budget's own icon (migration 108, owner 2026-11-13): an emoji, picked when
// creating the budget or in "Name and icon"; shown on a soft neutral tile.
export const BUDGET_ICONS = ['💰', '🏠', '🛒', '✈️', '🏖️', '🚗', '🎓', '🐾', '💼', '🎉', '🍽️', '👶', '💊', '🎁', '🛠️', '📦']

export function budgetIcon(b: { icon?: string | null } | null | undefined): string {
  return b?.icon || '💰'
}
