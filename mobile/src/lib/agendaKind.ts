// What a Home "today" card IS, read from its data — so a vet visit gets the
// pet look (paw/stethoscope + the pet's photo), a flight gets the travel look,
// and so on. Pure: no React, no Supabase (pinned by __tests__/agendaKind.test.ts).
//
// Order of decision:
//  1. the event's own `kind` (birthday / anniversary / renewal) wins;
//  2. a household pet named in the title/notes, or a pet-care word (vet,
//     groom…) → 'pet';
//  3. keyword groups, first match wins: health, school, travel, sport, meal,
//     work (school before work so "reunião de pais" isn't a work meeting);
//  4. otherwise a plain 'event'.
// Matching is accent- and case-insensitive and on whole words; a keyword that
// ends in '*' matches as a word prefix ("veterin*" → veterinário, veterinaria).
import type { EventKind } from './types'

export type AgendaKind =
  | 'pet'
  | 'birthday'
  | 'anniversary'
  | 'renewal'
  | 'health'
  | 'school'
  | 'sport'
  | 'travel'
  | 'meal'
  | 'work'
  | 'event'

/** Finer icon hint inside a kind (vet vs vaccine vs grooming…). */
export type AgendaIcon =
  | 'paw'
  | 'stethoscope'
  | 'syringe'
  | 'scissors'
  | 'pill'
  | 'cake'
  | 'heart'
  | 'renew'
  | 'school'
  | 'sport'
  | 'plane'
  | 'meal'
  | 'work'
  | 'calendar'

export type AgendaClass = {
  kind: AgendaKind
  icon: AgendaIcon
  /** The household pet named in the text, if any (also set on a pet's birthday). */
  petId: string | null
  /** The member named in the text (first name), if any — used for birthdays. */
  memberEmail: string | null
}

/** Lower-case, strip accents, everything that isn't a letter/digit → space. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Keywords are written already normalized (no accents). '*' = prefix match.
const PET_VET = ['vet', 'vets', 'veterin*', 'vet clinic']
const PET_VACCINE = ['antirrabica', 'antirabica', 'rabies', 'v8', 'v10', 'giardia', 'leishmaniose']
const PET_GROOM = ['groom*', 'tosa', 'banho e tosa', 'banho tosa', 'peluqueria canina', 'peluqueria de perros', 'pet shop', 'petshop']
const PET_PILL = ['vermifug*', 'desparasit*', 'antipulga*', 'flea*', 'heartworm', 'dewormer', 'deworm*', 'bravecto', 'nexgard', 'simparic']
const PET_OTHER = ['dog walk*', 'passeador', 'paseador', 'adestra*', 'castra*', 'neuter*', 'spay*', 'canil', 'kennel', 'creche canina', 'daycare canino', 'pet sitter', 'petsitter', 'cuidador de pet*']

const HEALTH_VACCINE = ['vacina*', 'vaccin*', 'vacuna*', 'flu shot', 'booster']
const HEALTH_PILL = ['farmacia', 'pharmacy', 'drugstore', 'remedio', 'medication', 'medicamento*', 'receita', 'prescription', 'receta']
const HEALTH = [
  'doctor', 'dr', 'dra', 'doutor*', 'medic*', 'consulta', 'cita medica', 'clinic*', 'hospital', 'exame*', 'checkup', 'check up',
  'dentist*', 'odonto*', 'ortodont*', 'orthodont*', 'pediatr*', 'physio*', 'fisio*', 'terapia', 'therapy', 'therapist', 'terapeuta',
  'psicolog*', 'psychol*', 'psiquiatr*', 'psychiatr*', 'nutricionist*', 'nutritionist', 'dermato*', 'ginecolog*', 'gyneco*', 'gyn',
  'cardiolog*', 'oftalmo*', 'ophthalm*', 'optometr*', 'eye exam', 'mamografia', 'mammogram', 'ultrassom', 'ultrasound', 'ecografia',
  'blood test', 'exame de sangue', 'analisis de sangre', 'laboratorio', 'lab test', 'surgery', 'cirurgia', 'cirugia',
]
const SCHOOL = [
  'school', 'escola', 'escuela', 'colegio', 'aula', 'aulas', 'class', 'classes', 'clase', 'clases', 'teacher', 'professor*', 'profe',
  'maestra', 'maestro', 'reuniao de pais', 'reunion de padres', 'parent teacher', 'pta', 'homework', 'licao de casa', 'tarea',
  'prova', 'provas', 'quiz', 'faculdade', 'universidad*', 'university', 'college', 'campus', 'kindergarten', 'preschool', 'creche',
  'guarderia', 'daycare', 'jardim de infancia', 'tutor*', 'formatura', 'graduation', 'graduacion', 'matricula', 'enrollment',
  'field trip', 'excursao escolar', 'excursion escolar', 'curso', 'course', 'workshop', 'oficina de', 'seminario', 'seminar',
]
const TRAVEL = [
  'flight', 'flights', 'voo', 'voos', 'vuelo', 'vuelos', 'airport', 'aeroporto', 'aeropuerto', 'trip', 'viagem', 'viaje', 'travel*',
  'viajar', 'hotel', 'airbnb', 'check in', 'checkin', 'check out', 'checkout', 'embarque', 'boarding', 'cruise', 'cruzeiro', 'crucero',
  'vacation', 'ferias', 'vacaciones', 'road trip', 'passport', 'passaporte', 'pasaporte', 'train', 'trem', 'tren', 'bus trip',
  'rodoviaria', 'layover', 'roadtrip',
]
const SPORT = [
  'gym', 'academia', 'treino', 'training', 'workout', 'entreno', 'entrenamiento', 'futebol', 'soccer', 'football', 'futbol', 'fut',
  'natacao', 'swim*', 'natacion', 'piscina', 'yoga', 'pilates', 'run', 'running', 'corrida', 'correr', 'marathon', 'maratona',
  'maraton', 'tennis', 'tenis', 'padel', 'basket*', 'basquete', 'baloncesto', 'volei', 'volleyball', 'voleibol', 'ballet', 'bale',
  'dance', 'danca', 'danza', 'judo', 'karate', 'jiu jitsu', 'jiujitsu', 'taekwondo', 'capoeira', 'crossfit', 'bike', 'cycling',
  'ciclismo', 'pedal', 'spinning', 'hike', 'hiking', 'trilha', 'senderismo', 'golf', 'surf', 'skate', 'baseball', 'beisebol',
  'softball', 'hockey', 'jogo', 'partido', 'match', 'game day', 'practice', 'tournament', 'torneio', 'torneo', 'personal trainer',
]
const MEAL = [
  'dinner', 'jantar', 'janta', 'cena', 'lunch', 'almoco', 'almuerzo', 'breakfast', 'cafe da manha', 'desayuno', 'brunch',
  'restaurant*', 'restaurante', 'churrasco', 'bbq', 'barbecue', 'asado', 'pizza', 'sushi', 'happy hour', 'cafe com', 'coffee with',
  'picnic', 'piquenique', 'potluck', 'feijoada', 'jantarzinho', 'reservation', 'reserva no', 'comida', 'meal',
]
const WORK = [
  'meeting', 'meetings', 'reuniao', 'reunioes', 'reunion', 'call', 'ligacao', 'llamada', 'work', 'trabalho', 'trabajo', 'office',
  'escritorio', 'oficina', 'standup', 'stand up', 'one on one', '1 1', '1on1', 'interview', 'entrevista', 'deadline', 'prazo',
  'client', 'clients', 'cliente', 'clientes', 'presentation', 'apresentacao', 'presentacion', 'zoom', 'teams', 'webinar',
  'conference', 'conferencia', 'kickoff', 'sprint', 'review', 'demo', 'plantao', 'turno', 'shift', 'expediente',
]

type Rule = { kind: AgendaKind; icon: AgendaIcon; words: readonly string[] }

// Pet-care words: checked only after pet NAMES, before the human groups.
const PET_RULES: Rule[] = [
  { kind: 'pet', icon: 'syringe', words: PET_VACCINE },
  { kind: 'pet', icon: 'scissors', words: PET_GROOM },
  { kind: 'pet', icon: 'pill', words: PET_PILL },
  { kind: 'pet', icon: 'stethoscope', words: PET_VET },
  { kind: 'pet', icon: 'paw', words: PET_OTHER },
]

const RULES: Rule[] = [
  { kind: 'health', icon: 'syringe', words: HEALTH_VACCINE },
  { kind: 'health', icon: 'pill', words: HEALTH_PILL },
  { kind: 'health', icon: 'stethoscope', words: HEALTH },
  { kind: 'school', icon: 'school', words: SCHOOL },
  { kind: 'travel', icon: 'plane', words: TRAVEL },
  { kind: 'sport', icon: 'sport', words: SPORT },
  { kind: 'meal', icon: 'meal', words: MEAL },
  { kind: 'work', icon: 'work', words: WORK },
]

/** Whole-word (or word-prefix, for 'stem*') match of one keyword in `padded`
 *  — normalized text with a space on each side. */
function hasWord(padded: string, kw: string): boolean {
  if (kw.endsWith('*')) return padded.includes(` ${kw.slice(0, -1)}`)
  return padded.includes(` ${kw} `)
}

function matchRule(padded: string, rules: Rule[]): Rule | null {
  for (const r of rules) if (r.words.some((w) => hasWord(padded, w))) return r
  return null
}

/** The first name in `names` (normalized, whole word) found in the text. */
function findNamed<T>(padded: string, items: readonly T[], nameOf: (t: T) => string): T | null {
  // Longest names first, so "Ana Clara" beats "Ana".
  const sorted = [...items]
    .map((it) => ({ it, n: normalizeText(nameOf(it)) }))
    .filter((x) => x.n.length >= 2)
    .sort((a, b) => b.n.length - a.n.length)
  for (const { it, n } of sorted) if (padded.includes(` ${n} `)) return it
  return null
}

export type ClassifyInput = {
  title: string
  notes?: string | null
  location?: string | null
  kind?: EventKind | null
}

/** Pet-care event types (pet_events.type) → the icon for a pet "due" card. */
export function petTypeIcon(type: string | null | undefined): AgendaIcon {
  switch (type) {
    case 'vet':
      return 'stethoscope'
    case 'vaccine':
      return 'syringe'
    case 'medication':
      return 'pill'
    case 'grooming':
      return 'scissors'
    default:
      return 'paw'
  }
}

/** Decide what a today card is. `pets` = the household's pets; `members` =
 *  household members with a display name (matched by FIRST name, only to put a
 *  face on a birthday/anniversary — an event's owner is its member otherwise). */
export function classifyAgenda(
  ev: ClassifyInput,
  pets: readonly { id: string; name: string }[] = [],
  members: readonly { email: string; name: string }[] = [],
): AgendaClass {
  const text = [ev.title, ev.notes ?? '', ev.location ?? ''].join(' ')
  const padded = ` ${normalizeText(text)} `
  const titlePadded = ` ${normalizeText(ev.title)} `
  const pet = findNamed(padded, pets, (p) => p.name)
  const petId = pet?.id ?? null

  if (ev.kind === 'birthday' || ev.kind === 'anniversary') {
    // Whose day it is: a pet named in the TITLE, else a member's first name.
    const titlePet = findNamed(titlePadded, pets, (p) => p.name)
    const member = titlePet ? null : findNamed(titlePadded, members, (m) => m.name.trim().split(/\s+/)[0] ?? '')
    return {
      kind: ev.kind,
      icon: ev.kind === 'birthday' ? 'cake' : 'heart',
      petId: titlePet?.id ?? null,
      memberEmail: member?.email ?? null,
    }
  }
  if (ev.kind === 'renewal') return { kind: 'renewal', icon: 'renew', petId, memberEmail: null }

  if (pet) {
    const hint = matchRule(padded, PET_RULES) ?? matchRule(padded, RULES.slice(0, 3))
    return { kind: 'pet', icon: hint?.icon ?? 'paw', petId, memberEmail: null }
  }
  const petWord = matchRule(padded, PET_RULES)
  if (petWord) return { kind: 'pet', icon: petWord.icon, petId: null, memberEmail: null }

  const r = matchRule(padded, RULES)
  if (r) return { kind: r.kind, icon: r.icon, petId: null, memberEmail: null }
  return { kind: 'event', icon: 'calendar', petId: null, memberEmail: null }
}
