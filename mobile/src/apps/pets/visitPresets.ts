// Quick picks for the vet-visit and vaccine forms (VisitForm): names are i18n
// KEYS (resolved with t()), and vaccines depend on the species. A pick only
// fills the title — anything can still be typed.

/** Vaccine name keys per species; anything else gets the common one. */
export function vaccineKeys(species: string | null): string[] {
  if (species === 'dog') return ['pets.vax.rabies', 'pets.vax.dhpp', 'pets.vax.lepto', 'pets.vax.bordetella', 'pets.vax.flu']
  if (species === 'cat') return ['pets.vax.rabies', 'pets.vax.fvrcp', 'pets.vax.felv']
  return ['pets.vax.rabies']
}

export const VISIT_KEYS = ['pets.visitKind.checkup', 'pets.visitKind.followup', 'pets.visitKind.dental', 'pets.visitKind.sick']

/** "Next" choices in days. Vaccines are boosted yearly or every 3 years;
 *  visits come back in weeks or months. */
export function nextChoices(type: 'vet' | 'vaccine'): { days: number; key: string }[] {
  return type === 'vaccine'
    ? [
        { days: 21, key: 'pets.next.3w' },
        { days: 365, key: 'pets.next.1y' },
        { days: 1095, key: 'pets.next.3y' },
      ]
    : [
        { days: 14, key: 'pets.next.2w' },
        { days: 183, key: 'pets.next.6m' },
        { days: 365, key: 'pets.next.1y' },
      ]
}
