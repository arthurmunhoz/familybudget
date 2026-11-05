// Printable cards — the reusable format behind "Luggage tag" (and the next
// ones: an emergency card for a kid's backpack, a pet ID card, a wallet
// contact card…). A template is DATA: its physical size, how many fit on a
// sheet, the fields the family fills in, and the component that draws it.
// `PrintableEditor` turns any template into the full tool — live preview,
// colour picker, "fill from a family member", saved draft, print, save image.
//
// To add one: write its card component (fixed colours — it's a printed
// artifact, it must look the same in dark mode), add a template here, give it
// a route under app/calc/ that renders <PrintableEditor template={…} />, and a
// tile in the Utilities hub. Field labels go through i18n like everything else.
import type { ComponentType } from 'react'
import type { KeyboardTypeOptions, TextInputProps } from 'react-native'

import type { TKey } from '@/lib/i18n'

import { LuggageTagCard } from './LuggageTagCard'

export type PrintValues = Record<string, string>

export interface PrintableField {
  key: string
  label: TKey
  placeholder?: TKey
  multiline?: boolean
  keyboardType?: KeyboardTypeOptions
  autoCapitalize?: TextInputProps['autoCapitalize']
  textContentType?: TextInputProps['textContentType']
  autoComplete?: TextInputProps['autoComplete']
  /** Where "fill from a family member" can take this value from. */
  from?: 'name' | 'email' | 'phone'
}

export interface PrintableCardProps {
  values: PrintValues
  /** The card's accent (band) colour, chosen by the user. */
  color: string
  /** Rendered width in points; the card scales everything from it. */
  width: number
  /** Field/heading label as it should be PRINTED (may be bilingual). */
  label: (key: TKey) => string
}

export interface PrintableTemplate {
  /** Also the draft's storage key — don't rename once shipped. */
  id: string
  title: TKey
  intro: TKey
  widthIn: number
  heightIn: number
  perPage: number
  fields: PrintableField[]
  /** At least one of these must be filled before printing. */
  required: string[]
  Card: ComponentType<PrintableCardProps>
}

/** Band colours offered for every card: saturated enough to read as a colour
 *  when printed on cheap paper, each paired with white or ink by pickOn(). */
export const CARD_COLORS = ['#1F6F8B', '#C2603F', '#2F7A57', '#6B4FA0', '#D9A21B', '#26231F']

export const LUGGAGE_TAG: PrintableTemplate = {
  id: 'luggage-tag',
  title: 'calc.tool.tag',
  intro: 'tag.intro',
  // Portrait tag with a punch hole: fits a standard luggage-tag sleeve when
  // trimmed, or loops through a strap on its own once laminated/taped.
  widthIn: 2.75,
  heightIn: 4.75,
  perPage: 2,
  required: ['name', 'phone'],
  fields: [
    { key: 'name', label: 'tag.name', autoCapitalize: 'words', textContentType: 'name', autoComplete: 'name', from: 'name' },
    { key: 'phone', label: 'tag.phone', keyboardType: 'phone-pad', textContentType: 'telephoneNumber', autoComplete: 'tel', from: 'phone' },
    { key: 'email', label: 'tag.email', keyboardType: 'email-address', autoCapitalize: 'none', textContentType: 'emailAddress', autoComplete: 'email', from: 'email' },
    { key: 'address', label: 'tag.address', placeholder: 'tag.addressHint', multiline: true, autoCapitalize: 'words', textContentType: 'fullStreetAddress', autoComplete: 'street-address' },
    { key: 'destination', label: 'tag.destination', placeholder: 'tag.destinationHint', multiline: true },
    { key: 'flight', label: 'tag.flight', placeholder: 'tag.flightHint', autoCapitalize: 'characters' },
  ],
  Card: LuggageTagCard,
}
