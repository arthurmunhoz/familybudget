/**
 * Home "today" card types (lib/agendaKind.ts): what a calendar event IS, read
 * from its title/notes/place in pt/en/es, accent- and case-insensitive.
 */
import { classifyAgenda, normalizeText, petTypeIcon } from '@/lib/agendaKind'
import type { EventKind } from '@/lib/types'

const pets = [
  { id: 'p1', name: 'Aninha' },
  { id: 'p2', name: 'Lola' },
]
const members = [
  { email: 'ana@x.com', name: 'Ana Souza' },
  { email: 'sam@x.com', name: 'Sam' },
]
const k = (title: string, extra: { notes?: string; location?: string; kind?: EventKind } = {}) =>
  classifyAgenda({ title, ...extra }, pets, members)

describe('normalizeText', () => {
  it('strips accents, case and punctuation', () => {
    expect(normalizeText('Reunião  de PAIS!')).toBe('reuniao de pais')
    expect(normalizeText('Almuerzo—Cumpleaños')).toBe('almuerzo cumpleanos')
  })
})

describe('classifyAgenda', () => {
  it('a named pet makes it a pet card, with that pet and a fitting icon', () => {
    expect(k('Aninha Vet')).toEqual({ kind: 'pet', icon: 'stethoscope', petId: 'p1', memberEmail: null })
    expect(k('aninha', { notes: 'vacina antirrábica' })).toMatchObject({ kind: 'pet', icon: 'syringe', petId: 'p1' })
    expect(k('Banho e tosa da LOLA')).toMatchObject({ kind: 'pet', icon: 'scissors', petId: 'p2' })
    expect(k('Passeio com a Lola')).toMatchObject({ kind: 'pet', icon: 'paw', petId: 'p2' })
    expect(k('Vacina da Aninha')).toMatchObject({ kind: 'pet', icon: 'syringe', petId: 'p1' })
  })

  it('pet-care words alone are a pet card without a pet', () => {
    expect(k('Veterinário 10h')).toMatchObject({ kind: 'pet', icon: 'stethoscope', petId: null })
    expect(k('Peluquería canina')).toMatchObject({ kind: 'pet', icon: 'scissors' })
    expect(k('Dog groomer')).toMatchObject({ kind: 'pet', icon: 'scissors' })
  })

  it('does not see a pet name inside another word', () => {
    expect(k('Lolapalooza tickets')).toMatchObject({ kind: 'event', petId: null })
  })

  it('the event kind wins for birthdays/anniversaries/renewals', () => {
    expect(k('Aniversário da Ana', { kind: 'birthday' })).toEqual({
      kind: 'birthday',
      icon: 'cake',
      petId: null,
      memberEmail: 'ana@x.com',
    })
    expect(k('Lola birthday', { kind: 'birthday' })).toMatchObject({ kind: 'birthday', petId: 'p2', memberEmail: null })
    expect(k('Bodas Sam & Ana', { kind: 'anniversary' })).toMatchObject({ kind: 'anniversary', icon: 'heart' })
    expect(k('Seguro do carro', { kind: 'renewal' })).toMatchObject({ kind: 'renewal', icon: 'renew' })
    expect(k('Cumpleaños de Tía', { kind: 'birthday' })).toMatchObject({ kind: 'birthday', memberEmail: null })
  })

  it('health in three languages', () => {
    expect(k('Dentista')).toMatchObject({ kind: 'health', icon: 'stethoscope' })
    expect(k('Consulta médica')).toMatchObject({ kind: 'health' })
    expect(k('Dr. Silva')).toMatchObject({ kind: 'health' })
    expect(k('Pediatrician checkup')).toMatchObject({ kind: 'health' })
    expect(k('Vacuna de la gripe')).toMatchObject({ kind: 'health', icon: 'syringe' })
    expect(k('Pick up at pharmacy')).toMatchObject({ kind: 'health', icon: 'pill' })
  })

  it('school before work ("reunião de pais")', () => {
    expect(k('Reunião de pais')).toMatchObject({ kind: 'school' })
    expect(k('Reunión de padres')).toMatchObject({ kind: 'school' })
    expect(k('Escola - apresentação')).toMatchObject({ kind: 'school' })
    expect(k('Clase de inglés')).toMatchObject({ kind: 'school' })
  })

  it('sport, travel, meal, work', () => {
    expect(k('Futebol do Pedro')).toMatchObject({ kind: 'sport' })
    expect(k('Natación')).toMatchObject({ kind: 'sport' })
    expect(k('Gym')).toMatchObject({ kind: 'sport' })
    expect(k('Voo para Lisboa')).toMatchObject({ kind: 'travel', icon: 'plane' })
    expect(k('Flight AA123')).toMatchObject({ kind: 'travel' })
    expect(k('Vuelo a Madrid')).toMatchObject({ kind: 'travel' })
    expect(k('Jantar', { location: 'Outback' })).toMatchObject({ kind: 'meal' })
    expect(k('Almuerzo con Sam')).toMatchObject({ kind: 'meal' })
    expect(k('Dinner at Mom’s')).toMatchObject({ kind: 'meal' })
    expect(k('Reunião com cliente')).toMatchObject({ kind: 'work' })
    expect(k('Team meeting')).toMatchObject({ kind: 'work', icon: 'work' })
    expect(k('Reunión de trabajo')).toMatchObject({ kind: 'work' })
  })

  it('the place line counts too', () => {
    expect(k('Check', { location: 'Tampa International Airport' })).toMatchObject({ kind: 'travel' })
  })

  it('falls back to a plain event', () => {
    expect(k('Pegar encomenda')).toEqual({ kind: 'event', icon: 'calendar', petId: null, memberEmail: null })
    expect(k('')).toMatchObject({ kind: 'event' })
    expect(classifyAgenda({ title: 'Aninha Vet' })).toMatchObject({ kind: 'pet', petId: null })
  })

  it('maps pet_events types to icons', () => {
    expect(petTypeIcon('vet')).toBe('stethoscope')
    expect(petTypeIcon('vaccine')).toBe('syringe')
    expect(petTypeIcon('medication')).toBe('pill')
    expect(petTypeIcon('grooming')).toBe('scissors')
    expect(petTypeIcon('other')).toBe('paw')
  })
})
