// Vercel serverless: turn a family member's free-text note into a household
// "ping" — {kind, emoji, message}. Used by the Pings sheet's "just type it"
// box. Auth: the caller must send a valid Supabase JWT (don't burn AI credits
// for strangers). Uses a small/fast model — this is a trivial mapping task.
//
// `?action=assistant` (folded in here because api/ is at Vercel Hobby's
// 12-function cap): the Home's "ask anything" bar. The model ONLY parses the
// request into an intent ({add_items | agenda | unknown} + slots); the app
// then carries it out with the user's OWN Supabase session, so RLS stays the
// boundary and nothing here writes household data with the service role.
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

// Abuse ceiling only (migration 083) — NOT a product quota, and deliberately
// separate from the scanners' ai_scan_allowed free_monthly_cap. A household
// typing nudges all day wouldn't come close to this; it exists so a leaked JWT
// can't run up an AI bill. Metering problems fail OPEN — a real nudge is never
// blocked because the counter misbehaved.
const DAILY_CAP = 200
const HAIKU_RATE = { in: 1 / 1e6, out: 5 / 1e6 } // $/token, claude-haiku-4-5
function estCost(usage: any): number {
  const input = (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0)
  return input * HAIKU_RATE.in + (usage?.output_tokens ?? 0) * HAIKU_RATE.out
}

const KINDS = ['help', 'omw', 'late', 'dinner', 'grab', 'love', 'custom'] as const

const PING_SCHEMA = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: [...KINDS],
      description:
        "Closest ping kind: help=needs a hand, omw=on my way/heading home, late=running late, dinner=food/meal is ready, grab=asking someone to buy or bring something, love=affection or checking in, custom=anything else.",
    },
    emoji: { type: 'string', description: 'A single emoji that fits the message.' },
    message: {
      type: 'string',
      description:
        'A short household ping, at most ~6 words, in the SAME language as the input note. No quotes, no trailing punctuation.',
    },
  },
  required: ['kind', 'emoji', 'message'],
  additionalProperties: false,
}

// The Home assistant's parse: one structured-output call, no tools. "" / [] / 0
// stand in for "not given" so every field can stay required/non-null. The app
// carries each intent out itself (lib/assistant.ts) with the user's session.
const INTENTS = [
  'add_items',
  'list_items',
  'find_items',
  'check_items',
  'remove_items',
  'agenda',
  'add_event',
  'move_event',
  'remove_event',
  'edit_event',
  'find_event',
  'list_money',
  'fix_money',
  'remove_money',
  'pet_done',
  'pet_log',
  'pet_next',
  'pet_weight',
  'family_update',
  'birthdays',
  'where_is',
  'nudge_seen',
  'move_items',
  'clear_checked',
  'uncheck_items',
  'weather',
  'better_deal',
  'open_document',
  'day_summary',
  'add_money',
  'money_summary',
  'send_nudge',
  'pets_due',
  'family_info',
  'start_game',
  'undo_last',
  'open_app',
  'split_bill',
  'discount',
  'app_help',
  'unknown',
] as const
const APPS = ['calendar', 'shopping', 'budget', 'pets', 'pings', 'location', 'family', 'docs', 'calc', 'frame', 'games', 'settings', '']
const GAMES = ['hangman', 'battleship', 'quiz', '']
const TOPICS = ['games', 'hangman', 'battleship', 'quiz', 'plus', 'families', 'roof', 'casa', 'other', '']
const RECURRENCES = ['none', 'daily', 'weekly', 'monthly', 'yearly']
const EVENT_KINDS = ['event', 'birthday', 'anniversary', 'renewal', 'other']
const PET_EVENT_TYPES = ['vet', 'vaccine', 'medication', 'grooming', 'other', '']
const PET_VIEWS = ['due', 'routine', 'overdue']
const FIELDS = ['phone', 'blood_type', 'height', 'weight', 'shoe_size', 'pants_size', 'shirt_size', 'allergies', 'birthday', '']
const ASSISTANT_SCHEMA = {
  type: 'object',
  properties: {
    intent: {
      type: 'string',
      enum: [...INTENTS],
      description: [
        'add_items = put things on a list — the household\'s lists are for anything: groceries at a store, chores ("tarefas"), a trip, school ("prova"). "põe estudar o capítulo 3 na lista de tarefas" is add_items with store "Tarefas". Running OUT of something is add_items: "acabou o leite", "o leite acabou", "we\'re out of milk", "se acabó la leche", "não tem mais café" → add it.',
        'move_items = move items that are already on a list to another list ("passa o leite pro Costco").',
        'clear_checked = clear / delete the done (checked) items from the lists or one list ("limpa os feitos", "limpa os comprados do Costco").',
        'uncheck_items = put a done item back as still to do ("desmarca o leite", "o leite eu não comprei ainda").',
        'list_items = asks what is on the lists (all of them, or one list).',
        'find_items = asks whether specific things are on the list ("is there coconut water on the list?", "tem leite na lista?").',
        'check_items = STATES items were bought / done ("já comprei o leite", "terminei a redação"). A question is never check_items, and "acabou o X" (ran out) is add_items, not check_items.',
        'remove_items = take items off the shopping list. ONLY shopping-list items: never when the user talks about a gasto / despesa / lançamento / expense / charge, or names a place that is not in KNOWN STORES but was just logged as an expense — that is remove_money.',
        'agenda = asks what is on the calendar for a day.',
        'add_event = schedule something on the calendar, including repeating events ("natação toda terça às 18h") and special dates (birthdays, anniversaries, renewals). A pet\'s vet / vaccine / grooming appointment on a FUTURE day (tomorrow or later: "agenda o veterinário da Lola sexta às 10") is add_event too, titled with the care and the pet ("Veterinário Lola"); the same thing TODAY or in the past is pet_log.',
        'edit_event = change an EXISTING event other than its day/time: rename it, set its place or a note, add or remove a reminder ("me lembra 1h antes do dentista", "põe o endereço na reunião").',
        'find_event = asks WHEN a named event is ("quando é o próximo dentista?", "when is Ana\'s recital?").',
        'move_event = move / reschedule / postpone an EXISTING calendar event to another day or time ("muda o dentista para amanhã", "muda o dentista do Pedro para sexta", "move it to Friday at 3", "passa a reunião de hoje pra quinta"). Never add_event or agenda for these. The day it is moved TO goes in new_date; `date` is only the day it is on NOW and stays "" unless that day is said ("a reunião de hoje" → today; "o dentista para sexta" → date ""). Needs a move word (muda, passa, move, adia, remarca, reschedule): a name with a day/time and no such word ("dentista sexta às 15h") is add_event, even when an event with that name exists.',
        'remove_event = delete / cancel / take off an EXISTING calendar event ("remove unha do calendário", "cancela o dentista de amanhã", "cancela a consulta da Ana amanhã", "delete the meeting"). Never remove_items for these: remove_items is only for shopping-list items.',
        'add_money = record money spent or received ("gastei 50 no mercado", "recebi o salário 3000").',
        'money_summary = asks how much was spent / is left / the balance — in total or in ONE category or on one thing ("quanto gastei com mercado esse mês?").',
        'list_money = asks to SEE the expenses/income themselves, as a list — "quais foram os últimos gastos?", "quais foram meus gastos esse mês?", "mostra os gastos de hoje", "what did I spend on this week?". "Quais foram / quais são / mostra / lista" = list_money; "quanto" = money_summary.',
        'fix_money = correct an expense/income already logged: a new total ("era 45, não 54", "muda o último gasto para 30"), or something to add or take off ("esqueci a gorjeta, foram mais 12", "põe 10% de gorjeta no gasto do restaurante", "faltou somar 8 reais", "tira 5 do último gasto"). Corrections usually follow an add_money earlier in the conversation: that entry is the one meant.',
        'remove_money = delete an expense/income already logged ("apaga o último gasto", "remove o gasto do Uber", "apaga esse gasto do Ford\'s Garage"). Spoken "pagar/paga o gasto" is a transcription slip of "apagar": nobody pays an expense they already logged, so it is remove_money.',
        'send_nudge = send a message to family members ("avisa o Léo que chego 19h"); set urgent for help / emergency.',
        'nudge_seen = asks who has seen / read the asker\'s latest nudge ("quem viu meu aviso?").',
        'pets_due = asks about the pets\' CARE ROUTINE or what is left: what a pet needs / what is due or left today ("o que a Lola precisa hoje?", "o que falta para os pets hoje?", "what\'s next for Chloe?", "a Chloe já comeu?") — daily routine items not done yet count; the whole routine ("quais são as rotinas da Lola?", "what is Chloe\'s routine?") is pet_view routine; anything late / overdue ("algum cuidado atrasado?", "tem algo atrasado dos cachorros?") is pet_view overdue.',
        'pet_done = STATES a pet routine task was done ("já dei comida pra Lola", "passeei com a Chloe"). A question is pets_due.',
        'pet_log = RECORD a vet visit, vaccine, medication or grooming a pet of PETS had TODAY or on a past day — logging it, not scheduling it: "a Chloe tomou a antirrábica hoje, próxima em 1 ano", "a Lola tomou vacina hoje", "registra uma consulta da Lola", and also "marca uma consulta da Chloe (para) hoje" (said at the vet: marca = note it down). A pet named + today / a past day / no day → pet_log, never add_event; only a FUTURE day makes it add_event.',
        'pet_next = asks WHEN a pet\'s next vaccine / vet / medication / grooming / care is due ("quando é a próxima vacina da Lola?", "quais os próximos cuidados das cachorras?", "what care is coming up for the pets?").',
        'pet_weight = record a pet\'s weight ("a Lola está com 8 kg").',
        'family_info = asks a stored detail about a family member (shoe size, blood type, allergies, phone, birthday...).',
        'family_update = CHANGE a stored detail of a family member ("o Léo agora calça 34", "meu telefone mudou para ...").',
        'birthdays = asks about the coming birthdays / anniversaries in the family.',
        'where_is = asks where a family member is, or whether they arrived somewhere ("onde está a Ana?", "o Léo já chegou na escola?").',
        'weather = asks about the weather / rain / temperature for a day ("vai chover amanhã?").',
        'better_deal = compare package prices to see which is cheaper per unit ("2 L por 8 ou 3 L por 11, qual compensa?").',
        'open_document = open a stored family document ("abre o passaporte do Léo", "mostra o seguro do carro").',
        'day_summary = asks for an overview of the day ("resumo do meu dia", "o que tenho hoje no geral?"). A plain "what is on the calendar" is agenda.',
        'undo_last = asks to UNDO / take back what was just done ("desfaz isso", "desfaz", "volta atrás", "cancela o que você fez", "undo that", "deshaz eso"). Never remove_items / remove_event for these.',
        'start_game = wants to PLAY / start / open a room / create a match of a game — any phrasing: "começar um jogo de forca", "abre uma sala de batalha naval", "cria uma partida de perguntas e tortadas", "inicia uma partida de", "bora jogar", "vamos jogar", "quero jogar", "joga comigo", "uma rodada de", "let\'s play hangman", "start a battleship game", "open a quiz room", "empezar una partida de ahorcado", "abre una sala de", "vamos a jugar". The game may be named loosely ("o jogo da torta", "o da casinha", "o dos barcos"). With no game named, game "". Questions ABOUT a game (rules, which games exist) are app_help.',
        'open_app = asks to open a part of the app.',
        'split_bill = split a bill / restaurant check / total among people ("divide 58,71 em 3", "split the check").',
        'discount = the price after a percentage off ("quanto fica 80 com 30% de desconto").',
        'app_help = asks about One Roof ITSELF: what it can do, what a part or feature is, which games there are, how a game or feature works ("quais jogos tem no app?", "como funciona a forca?", "explica a batalha naval", "o que o Plus dá?", "o que você sabe fazer?"). Answered from the APP GUIDE.',
        'unknown = anything else.',
      ].join(' '),
    },
    items: {
      type: 'array',
      items: { type: 'string' },
      description:
        'add_items: each product as its own short item, capitalised, in the language the user said it ("Leite", "Óleo de cozinha"); keep a quantity the user said in the label ("2 Leites", "Ovos (30)"). ' +
        'move_items: the EXACT labels from OPEN ITEMS being moved. uncheck_items: the items as the user said them. ' +
        'pet_done: the EXACT task names from PET TASKS that were done (for the pet named). ' +
        'find_items / check_items / remove_items: the EXACT labels from OPEN ITEMS that the user means — match by meaning in any language ' +
        '("coconut water" = "Agua de coco 🥥", "milk" = "Leite integral"); [] when nothing on the list matches. Empty otherwise.',
    },
    store: {
      type: 'string',
      description:
        'List intents (for move_items: the list to move TO): the LIST named — a store ("Costco") or any list ("Tarefas", "Viagem") — matched to KNOWN STORES (the household\'s lists) when it is the same one (return that exact spelling), else as written. A generic list ("lista de compras", "shopping list", "a lista", "mercado" without a name) is no particular list: return "". "" when none was named.',
    },
    scope: {
      type: 'string',
      enum: ['me', 'all', 'person'],
      description: 'agenda: me = the asker, all = everyone/the family, person = one named member. Default me.',
    },
    person: {
      type: 'string',
      description:
        'agenda (scope=person) / send_nudge (recipient) / family_info + family_update (whose detail) / add_event (whose event) / where_is (who) / open_document (whose document): a member name exactly as in MEMBERS. "" = the asker for family_info, family_update and add_event, everyone for send_nudge, any member for open_document. ' +
        'move_event / remove_event / edit_event / find_event: WHOSE event the request names ("o dentista do Pedro" → "Pedro", "Sam\'s dentist" → "Sam", "a consulta da Ana" → "Ana") — the MEMBERS spelling when it is a member, else the first name EXACTLY as said (a child may not be a member — "Dentista Pedro" owned by Arthur is still person "Pedro"); NEVER replace the named person with the event\'s owner shown after the last "·". That name then stays out of `title`. "" when no one is named. ' +
        'money_summary / list_money (whose money): the ASKER\'s name for "meus gastos" / "quanto eu gastei" / "my expenses", the member named (MEMBERS spelling) for "gastos da Ana" / "Ana\'s"; "" for the whole household ("nossos", "da casa", "quanto gastamos", or no owner said).',
    },
    date: {
      type: 'string',
      description:
        'agenda / add_event / add_money / pet_log (the day it happened) / weather / day_summary: the day as YYYY-MM-DD resolved from TODAY ("amanhã", "sexta", "dia 12"). TODAY when no day was named. ' +
        'add_event for a birthday/anniversary: the next (or given) date of it. ' +
        'money_summary / list_money: a day INSIDE the period asked about — TODAY for the current one (the default); ' +
        '"mês passado" / "last month" = the same day one month back (2026-11-09 → 2026-10-09); "semana passada" = TODAY − 7; ' +
        '"ontem" = TODAY − 1; "em setembro" = the 15th of that month. A follow-up like "e no mês anterior?" goes one period back from the period of the previous answer. ' +
        'edit_event / find_event: the day the event is on when said, else "". ' +
        'move_event: the day the event is on NOW when the user said it (or it is clear from the conversation); "" when not said — never TODAY by default (the app finds the event itself). ' +
        'remove_event: the day the event is on when the user said one (or it is clear from the conversation); "" when not said.',
    },
    date_end: {
      type: 'string',
      description:
        'add_event: the LAST day of a multi-day event ("de sexta a domingo"); same as `date` otherwise. ' +
        'agenda: the LAST day (YYYY-MM-DD) when the question covers a period, not a day: "this month" → last day of this month, ' +
        '"this week" → the coming Sunday, "next weeks" / "próximas semanas" → 21 days after TODAY, "next 10 days" → TODAY + 10. ' +
        'For a period that includes today, `date` is TODAY (what is still coming). Same as `date` for a single day.',
    },
    time: {
      type: 'string',
      description: 'add_event: start time as HH:MM (24h) when said. move_event: the NEW start time when said ("para sexta às 10h" → "10:00", "move it to 3pm" → "15:00"). Else "".',
    },
    end_time: {
      type: 'string',
      description: 'add_event: end time as HH:MM (24h) when said, or start + the duration said ("das 14 às 16" → 16:00, "por 2 horas" from 14:00 → 16:00). "" otherwise.',
    },
    recurrence: {
      type: 'string',
      enum: RECURRENCES,
      description: 'add_event: how it repeats ("toda terça" = weekly, "todo dia" = daily, "todo mês" = monthly). Birthdays and anniversaries are yearly. none otherwise.',
    },
    event_kind: {
      type: 'string',
      enum: EVENT_KINDS,
      description: 'add_event: birthday / anniversary / renewal (insurance, passport, subscription expiring) / other special date; event for an ordinary appointment.',
    },
    location: { type: 'string', description: 'add_event / edit_event: the place or address said. "" otherwise.' },
    notes: { type: 'string', description: 'add_event / edit_event: a note the user asked to attach. "" otherwise.' },
    reminder: {
      type: 'number',
      description:
        'add_event / edit_event: minutes before to remind (60 = "1h antes", 1440 = "um dia antes", 0 = "na hora"). -1 when no reminder was mentioned; -2 when the user asked to REMOVE the reminder (edit_event).',
    },
    new_title: {
      type: 'string',
      description: 'edit_event: the new name when renaming. fix_money: the corrected description when it changed. "" otherwise.',
    },
    new_date: {
      type: 'string',
      description:
        'move_event: the day to move it TO, YYYY-MM-DD resolved from TODAY ("amanhã" = TODAY+1, "o próximo dia" = the day after `date`). Same as `date` when only the time changes. ' +
        'pet_log: the NEXT due date when said ("próxima em 1 ano" = `date` + 1 year, so 2026-11-09 → 2027-11-09; "reforço em 21 dias" = `date` + 21 days). "" otherwise.',
    },
    title: {
      type: 'string',
      description:
        'add_event: the event title ("Dentista", "Aniversário da Ana"). move_event / remove_event / edit_event / find_event: the event as the user names it, or as named earlier in the conversation for "it"/"that" ("" when it is the only one on that day). add_money: what it was ("Mercado", "Salário"). fix_money / remove_money: which entry, as said ("Uber", "Ford\'s Garage"), or as logged earlier in the conversation for "esse/that one"; "" = the last one the asker logged. Never "gorjeta"/"tip" or the correction itself. money_summary / list_money: a specific thing spent on that is NOT a category ("quanto gastei de Uber?" → "Uber", "farmácia"), else "". pet_log: what it was ("Antirrábica", "Consulta"). where_is: the place asked about ("o Léo já chegou na escola?" → "escola", "casa"), else "". open_document: the document meant, matched to DOCUMENTS by meaning in ANY language ("seguro da moto" / "motorcycle insurance" → "Insurance card (motorcycle) - front"); when several are the same thing in parts (front/back, page 1/2), the part they share ("Insurance card (motorcycle)"); not in DOCUMENTS → as said ("passaporte"). send_nudge: the message to send, in the user language, first person, short ("Chego às 19h"). "" otherwise.',
    },
    ref: {
      type: 'string',
      description:
        'move_event / remove_event / edit_event / find_event: the ref ("v3") of the event meant, from UPCOMING EVENTS (each line ends with whose it is) — including one named earlier in the conversation. When SEVERAL listed events fit (two "Dentista" for different people) and the request does not say whose or which day, "" (the app asks which). ' +
        'fix_money / remove_money: the ref ("e1") of the entry meant, from RECENT ENTRIES ("esse gasto" = the one just logged). "" when it is not listed or not sure.',
    },
    amount: {
      type: 'number',
      description: 'add_money: the amount. fix_money: the new TOTAL only when the user gave the final value ("era 45"); 0 when they said what to add or take off (that goes in delta / tip_pct) or only the description changed. pet_weight: the weight. split_bill: the bill total. discount: the original price. 0 otherwise.',
    },
    people: { type: 'number', description: 'split_bill: how many people share it (whole number). 0 when not said.' },
    split_mode: {
      type: 'string',
      enum: ['even', 'items', ''],
      description:
        'split_bill: even = "igual / equally / em partes iguais"; items = "por item / by what each ordered / per product"; ' +
        '"" when the user did not say how (the app then asks).',
    },
    tip_pct: {
      type: 'number',
      description: 'split_bill: tip percent when said ("com 20% de gorjeta"). fix_money: a tip percent to add on top of the logged value ("põe 10% de gorjeta"). Else 0.',
    },
    delta: {
      type: 'number',
      description: 'fix_money: an amount to ADD to the logged value ("esqueci a gorjeta de 12" = 12, "faltou 8" = 8), negative to take off ("tira 5" = -5). 0 otherwise.',
    },
    percent: { type: 'number', description: 'discount: the percent off (30 for "30%"). 0 otherwise.' },
    money_range: {
      type: 'string',
      enum: ['period', 'day', 'week', 'month'],
      description:
        'money_summary / list_money: the time span the user named, around `date`: day = "hoje" / "ontem" / "dia 5" / "today"; ' +
        'week = "essa semana" / "semana passada"; month = "esse mês" / "mês passado" / "em setembro"; ' +
        'period = no span named (the budget\'s own current period). add_money and everything else: period.',
    },
    money_type: {
      type: 'string',
      enum: ['expense', 'income', 'all'],
      description:
        'add_money: spent = expense, received = income. money_summary / list_money: expense for "gastos / despesas / quanto gastei / expenses", ' +
        'income for "receitas / entradas / o que entrou / income", all for "lançamentos / movimentações / entries" or the balance.',
    },
    budget: {
      type: 'string',
      description: 'add_money / money_summary / list_money: the budget named, matched to KNOWN BUDGETS (exact spelling). "" when none.',
    },
    category: {
      type: 'string',
      description: 'money_summary / list_money: the id from CATEGORIES when the user named a spending category ("mercado" = groceries, "restaurante" = dining). "" otherwise.',
    },
    pet_event_type: {
      type: 'string',
      enum: PET_EVENT_TYPES,
      description: 'pet_log / pet_next: vet = consultation/check-up, vaccine (any shot: antirrábica/rabies, V8/V10, gripe), medication (pills, flea/worm treatment), grooming (bath/haircut at a groomer), other. "" = any (pet_next).',
    },
    value: {
      type: 'string',
      description: 'family_update: the new value as said, with its unit when said ("34", "1,20 m", "O+", a phone number); birthday as YYYY-MM-DD. "" otherwise.',
    },
    urgent: { type: 'boolean', description: 'send_nudge: true for an emergency / asking for help / "urgente". false otherwise.' },
    deals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          price: { type: 'number' },
          size: { type: 'number' },
          label: { type: 'string', description: 'The option as said, short ("2 L por 8").' },
        },
        required: ['price', 'size', 'label'],
        additionalProperties: false,
      },
      description: 'better_deal: each option compared — its price and its size/quantity in the SAME unit across options (convert 500 g to 0.5 when the other is in kg). [] otherwise.',
    },
    pet: {
      type: 'string',
      description: 'pets_due / pet_done / pet_log / pet_next / pet_weight: the pet named, exactly as in PETS (fix transcription slips: "Cloe" = "Chloe"). "" = all pets ("os pets", "os bichos", "the pets"). ' +
        'pets_due / pet_next naming several pets ("a rotina da Lola e da Chloe"): all of them, comma-separated ("Lola, Chloe"). ' +
        'A species instead of a name ("as cachorras", "os cachorros", "the dogs", "los gatos"): every pet of that species in PETS, comma-separated, names only.',
    },
    pet_view: {
      type: 'string',
      enum: PET_VIEWS,
      description:
        'pets_due: due = what is still left / needed / next today (the default); routine = the whole routine asked for ("quais são as rotinas", "what is the routine", "cuál es la rutina"); overdue = only what is late ("atrasado", "overdue", "late", "vencido"). due for every other intent.',
    },
    field: { type: 'string', enum: FIELDS, description: 'family_info / family_update: which detail. "" otherwise.' },
    app: { type: 'string', enum: APPS, description: 'open_app: which part (budget = money, calc = utilities, frame = the photo frame / porta-retrato / slideshow, shopping = lists). "" otherwise.' },
    game: {
      type: 'string',
      enum: GAMES,
      description: 'start_game: which game — hangman (forca), battleship (batalha naval), quiz (Perguntas & Tortadas / buzzer quiz / perguntas / quiz / torta). "" otherwise.',
    },
    topic: {
      type: 'string',
      enum: TOPICS,
      description:
        'app_help: what it is about — games (which games / games in general), hangman (forca), battleship (batalha naval), quiz (Perguntas & Tortadas / buzzer quiz / perguntas / torta), plus, families (several families per account), roof (the voice assistant), casa (Modo Casa / home mode / using the app on a tablet or screen at home), other. "" otherwise.',
    },
    gap: {
      type: 'string',
      description:
        'unknown ONLY: what the user wanted, rewritten as a short generic task in ENGLISH for the app developers ' +
        '("move an event to another day", "set a medication reminder for a pet", "ask the weather"). ' +
        'ANONYMISE: no names, places, stores, amounts, dates, times or any personal detail. "" for every other intent.',
    },
    reply: {
      type: 'string',
      description:
        'agenda over a period: a short phrase naming it in the user language ("este mês", "this week", "nas próximas 3 semanas"). ' +
        'find_items: one short sentence in the user language answering the question, naming the store each match is on ' +
        '("Sim — Agua de coco está na lista do Costco.", "No, there is no coconut water on the list."). ' +
        'app_help: 1–3 short sentences in the user language answering from the APP GUIDE only (never invent a feature). Asked which games there are: name them and offer to explain the rules ("Quer que eu explique as regras de algum?"). Asked how ONE game works: one sentence on the idea — the app shows the full rules under it. ' +
        'unknown: one short, friendly sentence in the user language saying what you can do (shopping lists, calendar, money, nudges, pets, family details, where someone is, weather, documents, splitting a bill, discounts, and questions about the app and its games). "" otherwise.',
    },
  },
  required: [
    'intent',
    'items',
    'store',
    'scope',
    'person',
    'date',
    'date_end',
    'time',
    'end_time',
    'recurrence',
    'event_kind',
    'location',
    'notes',
    'reminder',
    'new_title',
    'new_date',
    'title',
    'amount',
    'people',
    'split_mode',
    'tip_pct',
    'delta',
    'percent',
    'money_type',
    'money_range',
    'budget',
    'category',
    'pet_event_type',
    'value',
    'urgent',
    'deals',
    'pet',
    'pet_view',
    'field',
    'app',
    'game',
    'topic',
    'gap',
    'reply',
    'ref',
  ],
  additionalProperties: false,
}

// The same slots grouped by area: the model fills only the group of the
// intent it picked instead of all ~37 fields every time (shorter answer,
// less cross-talk between areas). Same descriptions as the flat schema;
// flattenGrouped() turns it back into the flat answer, so the app never
// sees the difference. Groups are the only optional keys (limit is 24).
// DEFAULT since 2026-11-09: eval 56/56 vs flat 54–56/56, ~45% fewer output
// tokens, and flat once ran past max_tokens (truncated JSON). Set Vercel env
// ASSISTANT_SCHEMA=flat to fall back.
const TOP = ['intent', 'date', 'person', 'title', 'ref', 'reply', 'gap']
const GROUPS: Record<string, { keys: string[]; for: string; note?: string }> = {
  shop: { keys: ['items', 'store'], for: 'add_items, move_items, clear_checked, uncheck_items, list_items, find_items, check_items, remove_items' },
  cal: {
    keys: ['scope', 'date_end', 'time', 'end_time', 'recurrence', 'event_kind', 'location', 'notes', 'reminder', 'new_title', 'new_date'],
    for: 'agenda, add_event, edit_event, find_event, move_event, remove_event',
  },
  money: {
    keys: ['title', 'amount', 'money_type', 'money_range', 'budget', 'category', 'new_title', 'delta', 'tip_pct'],
    for: 'add_money, money_summary, list_money, fix_money, remove_money',
  },
  calc: { keys: ['amount', 'people', 'split_mode', 'tip_pct', 'percent', 'deals'], for: 'split_bill, discount, better_deal' },
  pet: {
    keys: ['pet', 'pet_view', 'items', 'pet_event_type', 'new_date', 'amount'],
    for: 'pets_due, pet_done, pet_log, pet_next, pet_weight',
    note: 'Any shot (antirrábica, V10, rabies) is pet_event_type "vaccine", never "medication".',
  },
  family: { keys: ['field', 'value'], for: 'family_info, family_update' },
  nudge: { keys: ['urgent'], for: 'send_nudge' },
  open: { keys: ['app'], for: 'open_app' },
  game: { keys: ['game'], for: 'start_game' },
  help: { keys: ['topic'], for: 'app_help' },
}
const flatProps = ASSISTANT_SCHEMA.properties as Record<string, unknown>
const pick = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, flatProps[k]]))
const GROUPED_SCHEMA = {
  type: 'object',
  properties: {
    ...pick(TOP),
    ...Object.fromEntries(
      Object.entries(GROUPS).map(([g, def]) => [
        g,
        {
          type: 'object',
          description: `REQUIRED when intent is one of: ${def.for}. Omit for every other intent.${def.note ? ` ${def.note}` : ''}`,
          properties: pick(def.keys),
          required: def.keys,
          additionalProperties: false,
        },
      ]),
    ),
  },
  required: TOP,
  additionalProperties: false,
}

/** Grouped answer → the flat shape (the intent's own group wins a shared key). */
export function flattenGrouped(raw: any): Record<string, any> {
  const flat: Record<string, any> = {}
  for (const k of TOP) flat[k] = raw?.[k]
  const own = Object.entries(GROUPS).find(([, d]) => d.for.split(', ').includes(raw?.intent))?.[0]
  for (const g of Object.keys(GROUPS).filter((g) => g !== own).concat(own ? [own] : [])) {
    if (!raw?.[g] || typeof raw[g] !== 'object') continue
    // The model often fills groups that aren't the intent's: those only fill a
    // gap and never overwrite (review 2026-11-14 — another group's title beat
    // the top-level one). The intent's own group (merged last) wins, except an
    // empty string never wipes a value already set (money.title "" vs a
    // top-level title the model filled instead) — an empty value in the own
    // group DOES clear what another group filled ("move_event date "" = not
    // said" must beat an agenda group's today).
    const mine = g === own
    for (const [k, v] of Object.entries(raw[g])) {
      if (mine ? v !== '' || !TOP.includes(k) || flat[k] === undefined : flat[k] === undefined || flat[k] === '') flat[k] = v
    }
  }
  return flat
}
const HAIKU_55 = { id: 'claude-haiku-5-5', in: 0.1 / 1e6, out: 0.5 / 1e6 }
const ASSISTANT_CAP = 300
// Product quota (migration 089): free households get this many assistant
// requests per MEMBER per calendar month; Plus (and the signup trial) is
// unlimited. Separate from ASSISTANT_CAP, the per-household daily abuse ceiling.
const ASSISTANT_FREE_MONTHLY = 5

const str = (v: unknown, max = 60) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const strList = (v: unknown, n = 30, len = 80) =>
  Array.isArray(v) ? v.map((x) => str(x, len)).filter(Boolean).slice(0, n) : []

/** Log something the assistant couldn't do (migration 088). Best-effort:
 *  it must never fail the request. Old rows (>90 days) are pruned here. */
async function recordGap(
  db: any,
  household: string | null,
  g: { kind: 'unknown' | 'failed'; intent?: string; reason?: string; summary?: string; lang?: string },
) {
  if (!db) return
  try {
    await db.from('assistant_gaps').insert({
      household_id: household,
      kind: g.kind,
      intent: (g.intent ?? '').slice(0, 40),
      reason: (g.reason ?? '').slice(0, 40),
      summary: (g.summary ?? '').slice(0, 160),
      lang: (g.lang ?? '').slice(0, 8),
    })
    await db
      .from('assistant_gaps')
      .delete()
      .lt('created_at', new Date(Date.now() - 90 * 86_400_000).toISOString())
  } catch {
    /* logging must never break the assistant */
  }
}

/** "Lola (dog), Aninha (dog)": the names the model returns, with the species
 *  when the app sent them (`petKinds`: "Lola = dog"). */
function petsLine(body: any): string {
  const names = strList(body?.pets, 15)
  const kinds = new Map<string, string>()
  for (const k of strList(body?.petKinds, 15)) {
    const [name, kind] = k.split('=').map((x) => x.trim())
    if (name && kind) kinds.set(name, kind)
  }
  return names.map((n) => (kinds.get(n) ? `${n} (${kinds.get(n)})` : n)).join(', ') || '(none)'
}

/** The request's context block (what the model may match against). */
const LANG_NAME: Record<string, string> = { pt: 'Portuguese (Brazil)', en: 'English', es: 'Spanish' }

function buildContext(body: any, today: string): string {
  return [
    `TODAY: ${today} (${str(body?.weekday, 20)})`,
    `APP LANGUAGE: ${LANG_NAME[str(body?.lang, 8)] ?? 'Portuguese (Brazil)'}`,
    `KNOWN STORES (the household's lists — stores or any list): ${strList(body?.stores).join(', ') || '(none yet)'}`,
    `MEMBERS: ${strList(body?.members, 15).join(', ') || '(unknown)'}`,
    `KNOWN BUDGETS: ${strList(body?.budgets, 15).join(', ') || '(none)'}`,
    // "Lola (dog)" when the app sends species — "as cachorras" = every dog.
    `PETS: ${petsLine(body)}`,
    `DOCUMENTS: ${strList(body?.documents, 60, 120).join(' | ') || '(none)'}`,
    // Each pet's routine, "Lola: Comida, Passeio" — pet_done returns these names.
    `PET TASKS: ${strList(body?.petTasks, 20, 300).join(' | ') || '(none)'}`,
    // Spending categories as "id = name" (built-ins + the household's own).
    `CATEGORIES: ${strList(body?.categories, 60).join(', ') || '(defaults)'}`,
    // What's still to buy, as "label @ store" — so questions and "I bought…"
    // resolve to real items whatever language either side is in.
    `OPEN ITEMS: ${strList(body?.openItems, 120).join(' | ') || '(the list is empty)'}`,
    // The latest money entries and the coming events, each with a short ref
    // ("e1", "v3") the model returns so the app acts on exactly that row.
    `RECENT ENTRIES: ${strList(body?.recentEntries, 12, 120).join(' | ') || '(none)'}`,
    `UPCOMING EVENTS: ${strList(body?.events, 40, 120).join(' | ') || '(none)'}`,
    `ASKER: ${str(body?.me, 40) || '(unknown)'}`,
  ].join('\n')
}

// What the assistant may say about the app itself (app_help). Keep it TRUE:
// the model answers from this and nothing else.
const APP_GUIDE =
  'APP GUIDE (One Roof — answer app_help from this only): ' +
  'Home: today\'s agenda and the assistant (typed, the mic, or "Oi Casa" (pt) / "Oye Casa" (es) / "Hey Roof" (en) by voice, a Plus feature). ' +
  'Apps: Calendar (events, birthdays, reminders; Google/Apple Calendar sync on Plus), Money (budgets, expenses and income, AI receipt scan), ' +
  'Lists (shared live; for groceries by store or anything — chores, a trip, school), Pets (daily routines, vet visits, vaccines, reminders), Documents (family vault; Face ID lock on Plus), ' +
  'Family (each member\'s profile: birthday, phone, sizes, allergies), Utilities (split a bill evenly or by item, better deal per unit, discount, printable cards, photo frame), ' +
  'Nudges (one-tap messages to the family, urgent ones too), Location (family map, places with arrival alerts, safety radius; iPhone only), Games. ' +
  'GAMES — played live, each person on their own phone, in two teams (Orange and Purple); someone opens a room in Games, the others join and tap ready, the host starts: ' +
  '1) Hangman (Forca): one team picks a word from a category (the hint), the other team guesses letters, one person per turn; each wrong letter adds a piece of the house; ' +
  'guessing the word scores for the guessers, a finished house scores for the word team; teams swap every round. You can also SEND a hangman to one person to solve on their own. ' +
  '2) Battleship (Batalha naval): each team hides its fleet on its own sea; on your turn aim at the other team\'s sea and Fire; a hit shoots again, a miss passes the turn; sink the whole fleet to win. ' +
  '3) Perguntas & Tortadas (in Portuguese; "Buzzer quiz" in English): the same question shows on every phone; first to press the buzzer answers by voice or typing; a wrong answer is out for that question and the others can try; each right answer is a point for the team — and the losing side takes a cream pie in the face on screen (the one who got it wrong, or the other team when someone gets it right). ' +
  'PLUS (One Roof Plus): unlimited AI scans, calendar sync, split by item, several and private budgets, up to 12 members (free: 4), Face ID on documents, the Roof voice, the assistant without a monthly limit, creating another family. ' +
  'MODO CASA (Home Mode): a spare device at home (an old phone, a tablet, a screen) becomes the family hub — the day, lists, pets, the money behind a PIN, and Roof by voice. Open one-roof-app.vercel.app on it and pair it from the phone: Settings › Modo Casa › Pair a device (type the code it shows or scan its QR). 30 days of everything free from the first device; then, without Plus, it only shows the day; Plus unlocks Roof, actions, the budget and more devices. ' +
  'FAMILIES: one account can be in up to 3 families (join with an invite code, free; create another needs a paid Plus).'

const SYSTEM =
  'You turn one request (typed, or spoken and transcribed — expect transcription slips) into a structured intent ' +
  'for a family organiser app. The household speaks Portuguese, English or Spanish, often mixing them. ' +
  'Never invent items or stores the user did not mean; for items already on the list, return their exact labels. ' +
  'The REQUEST may follow up on earlier turns: resolve "those", "it", "the first one", "remove the eggs", ' +
  '"and tomorrow?", "e para a Lola?" against the conversation, keeping whatever the user did not change ' +
  '(same store, same pet, same person, same period). Read the request in context: a word that makes no sense for ' +
  'the domain is usually a slip ("pagar o gasto" = "apagar o gasto"), and a follow-up about something just logged, ' +
  'scheduled or added stays in that same feature (an expense just logged is fixed/removed as money, never as a list item). ' +
  '"The user language" means the language the REQUEST is clearly written in; when the request is a word or two, a filler, ' +
  'a fragment, or could be either language, it means the APP LANGUAGE — and every reply is then in the APP LANGUAGE ' +
  '(the answer is read aloud in that language\'s voice). ' +
  'Spoken requests are sometimes CUT OFF mid-phrase ("marca uma consulta da", "add milk to the"): never fill the missing part ' +
  'with a guess — keep the intent and leave the slot that was cut off empty ("" / []), so the app asks.\n\n' +
  APP_GUIDE

export type SchemaVariant = 'flat' | 'grouped'

/** Parse one request. Pure apart from the model call: no auth, no metering,
 *  no logging — `assistant()` wraps it for the app, scripts/assistant-eval
 *  calls it directly. Returns the sanitised flat answer the app reads. */
export async function parseAssistant(
  body: any,
  variant: SchemaVariant = 'flat',
  client: Anthropic = new Anthropic(),
): Promise<{ out: Record<string, any>; gap: string; usage: any }> {
  const text = str(body?.text, 400)
  const today = /^\d{4}-\d{2}-\d{2}$/.test(body?.today ?? '') ? body.today : new Date().toISOString().slice(0, 10)
  const context = buildContext(body, today)
  // The conversation so far (the sheet keeps it while it's open): each turn is
  // what was asked and a one-line account of what the app answered, so a
  // follow-up ("remove the milk", "and tomorrow?", "e a Lola?") can lean on it.
  const history = (Array.isArray(body?.history) ? body.history : [])
    .slice(-6)
    .map((h: any) => ({ q: str(h?.q, 300), a: str(h?.a, 600) }))
    .filter((h: { q: string }) => h.q)
  const convo = history.length
    ? `EARLIER IN THIS CONVERSATION (oldest first):\n${history
        .map((h: { q: string; a: string }) => `User: ${h.q}\nApp: ${h.a || '(done)'}`)
        .join('\n')}\n\n`
    : ''
  const response = await client.messages.create({
    model: HAIKU_55.id,
    max_tokens: 1000,
    // A slot-filling parse: no reasoning needed, and thinking would be most
    // of the bill. Disabled is accepted on Haiku 5.5 at effort <= high.
    thinking: { type: 'disabled' },
    system: SYSTEM,
    messages: [{ role: 'user', content: `${context}\n\n${convo}REQUEST: ${text}` }],
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: variant === 'grouped' ? GROUPED_SCHEMA : ASSISTANT_SCHEMA },
    },
  } as any)
  const block = response.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('no_answer')
  const raw = JSON.parse(block.text)
  const p = variant === 'grouped' ? flattenGrouped(raw) : raw
  const intent = (INTENTS as readonly string[]).includes(p.intent) ? p.intent : 'unknown'
  const iso = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : today)
  const out = {
    intent,
    items: strList(p.items),
    store: str(p.store),
    scope: ['me', 'all', 'person'].includes(p.scope) ? p.scope : 'me',
    person: str(p.person),
    // remove_event without a day searches the coming weeks, so keep "".
    // Finding an existing event without a day searches the coming weeks, so keep "".
    date:
      ['remove_event', 'edit_event', 'find_event'].includes(intent) && !(typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date))
        ? ''
        : iso(p.date),
    // Never before the start; capped at ~3 months so a stray answer can't
    // ask the phone to expand a year of recurring events.
    date_end: (() => {
      const start = iso(p.date)
      const end = typeof p.date_end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date_end) ? p.date_end : start
      const cap = new Date(start + 'T12:00:00Z')
      cap.setUTCDate(cap.getUTCDate() + 92)
      const capIso = cap.toISOString().slice(0, 10)
      return end < start ? start : end > capIso ? capIso : end
    })(),
    time: typeof p.time === 'string' && /^\d{1,2}:\d{2}$/.test(p.time) ? p.time.padStart(5, '0') : '',
    end_time: typeof p.end_time === 'string' && /^\d{1,2}:\d{2}$/.test(p.end_time) ? p.end_time.padStart(5, '0') : '',
    recurrence: RECURRENCES.includes(p.recurrence) ? p.recurrence : 'none',
    event_kind: EVENT_KINDS.includes(p.event_kind) ? p.event_kind : 'event',
    location: str(p.location, 160),
    notes: str(p.notes, 300),
    reminder: typeof p.reminder === 'number' && isFinite(p.reminder) && p.reminder >= -2 && p.reminder <= 40320 ? Math.round(p.reminder) : -1,
    new_title: str(p.new_title, 140),
    new_date: typeof p.new_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.new_date) ? p.new_date : '',
    title: str(p.title, 140),
    amount: typeof p.amount === 'number' && isFinite(p.amount) && p.amount > 0 ? Math.round(p.amount * 100) / 100 : 0,
    people: typeof p.people === 'number' && p.people >= 1 && p.people <= 50 ? Math.floor(p.people) : 0,
    split_mode: p.split_mode === 'even' || p.split_mode === 'items' ? p.split_mode : '',
    tip_pct: typeof p.tip_pct === 'number' && p.tip_pct > 0 && p.tip_pct <= 100 ? p.tip_pct : 0,
    delta: typeof p.delta === 'number' && isFinite(p.delta) && Math.abs(p.delta) <= 1e6 ? Math.round(p.delta * 100) / 100 : 0,
    percent: typeof p.percent === 'number' && p.percent > 0 && p.percent < 100 ? p.percent : 0,
    // 'all' only means something to money_summary / list_money (an older app
    // reads anything but 'income' as expense, which is right for add_money).
    money_type: p.money_type === 'income' ? 'income' : p.money_type === 'all' ? 'all' : 'expense',
    money_range: ['day', 'week', 'month'].includes(p.money_range) ? p.money_range : 'period',
    budget: str(p.budget),
    category: str(p.category, 60),
    pet_event_type: PET_EVENT_TYPES.includes(p.pet_event_type) ? p.pet_event_type : '',
    value: str(p.value, 80),
    urgent: p.urgent === true,
    deals: (Array.isArray(p.deals) ? p.deals : [])
      .filter((d: any) => typeof d?.price === 'number' && d.price > 0 && typeof d?.size === 'number' && d.size > 0)
      .slice(0, 6)
      .map((d: any) => ({ price: d.price, size: d.size, label: str(d.label, 40) })),
    pet: str(p.pet, 120),
    pet_view: PET_VIEWS.includes(p.pet_view) ? p.pet_view : 'due',
    field: FIELDS.includes(p.field) ? p.field : '',
    app: APPS.includes(p.app) ? p.app : '',
    game: GAMES.includes(p.game) ? p.game : '',
    topic: TOPICS.includes(p.topic) ? p.topic : '',
    reply: str(p.reply, intent === 'app_help' ? 420 : 240),
    ref: typeof p.ref === 'string' && /^[ev]\d{1,2}$/.test(p.ref) ? p.ref : '',
  }
  return { out, gap: intent === 'unknown' ? str(p.gap, 160) : '', usage: response.usage }
}

async function assistant(body: any, db: any, household: string | null, res: any, email: string, quota: any) {
  try {
    const { out, gap, usage } = await parseAssistant(body, process.env.ASSISTANT_SCHEMA === 'flat' ? 'flat' : 'grouped')
    // Count it, and tell the app where the member stands (free plan only).
    let q: { plus: true } | { used: number; cap: number } | null = null
    if (db && quota) {
      try {
        const { data: n } = await db.rpc('assistant_use', { p_email: email })
        q = quota.plus ? { plus: true } : { used: typeof n === 'number' ? n : (quota.used ?? 0) + 1, cap: ASSISTANT_FREE_MONTHLY }
      } catch {
        /* a counting failure must not lose a good answer */
      }
    }
    if (db && household) {
      const u: any = usage
      const cost =
        ((u?.input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0)) * HAIKU_55.in + (u?.output_tokens ?? 0) * HAIKU_55.out
      try {
        await db.rpc('ai_light_record', { p_household: household, p_kind: 'assistant', p_cost: cost })
      } catch {
        /* metering write failure must not break a good response */
      }
    }
    if (out.intent === 'unknown') {
      // The model's anonymised rewrite only — never `text` (see migration 088).
      await recordGap(db, household, { kind: 'unknown', summary: gap, lang: str(body?.lang, 8) })
    }
    return res.status(200).json(q ? { ...out, quota: q } : out)
  } catch (err: any) {
    if (err instanceof Anthropic.APIError && /credit balance|billing/i.test(err.message ?? '')) {
      return res.status(502).json({ error: 'out_of_credits' })
    }
    return res.status(502).json({ error: 'failed' })
  }
}

// ── Roof's voice ─────────────────────────────────────────────────────────────
// Chosen by ear in a blind test (owner, 2026-11-12): Thalita Multilingual —
// standard-tier price, and being multilingual it says "Roof" properly.
const ROOF_VOICES: Record<string, string> = {
  pt: 'pt-BR-ThalitaMultilingualNeural',
  en: 'en-US-AvaMultilingualNeural',
  es: 'es-MX-DaliaMultilingualNeural',
}
const XML_LANG: Record<string, string> = { pt: 'pt-BR', en: 'en-US', es: 'es-MX' }
const SPEAK_MAX = 400 // characters per reply — Roof keeps it short
const VOICE_DAILY_CAP = 400 // per household per day, abuse ceiling
const VOICE_USD_PER_CHAR = 16 / 1e6 // Azure neural, pay-as-you-go estimate

function speakable(raw: string): string {
  return raw
    .replace(/[\p{Extended_Pictographic}️‍]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SPEAK_MAX)
}
const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

async function speak(body: any, supabaseUrl: string, email: string, res: any) {
  const key = process.env.AZURE_SPEECH_KEY
  const region = process.env.AZURE_SPEECH_REGION || 'eastus'
  if (!key) return res.status(503).json({ error: 'voice_off' })
  const text = speakable(typeof body?.text === 'string' ? body.text : '')
  if (!text) return res.status(400).json({ error: 'Missing text' })
  const lang = ROOF_VOICES[body?.lang] ? body.lang : 'pt'

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return res.status(503).json({ error: 'voice_off' })
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const { data: caller } = await db.from('allowed_users').select('household_id').eq('email', email).maybeSingle()
  const household: string | null = caller?.household_id ?? null
  if (!household) return res.status(403).json({ error: 'no_household' })
  // Plus gate: an explicit "no" blocks; spoken replies cost real money per call.
  const { data: plus, error: plusErr } = await db.rpc('household_is_plus', { p_household: household })
  // Fails CLOSED: the voice is a paid Azure call, so a broken plan check
  // must not hand it to everyone.
  if (plusErr || plus !== true) return res.status(plusErr ? 503 : 402).json({ error: plusErr ? 'plan_check' : 'plus_required' })
  const { data: gate, error: gateErr } = await db.rpc('ai_light_allowed', { p_household: household, p_kind: 'voice', p_cap: VOICE_DAILY_CAP })
  if (!gateErr && gate && gate.allowed === false) return res.status(429).json({ error: 'paused' })

  const ssml =
    `<speak version='1.0' xml:lang='${XML_LANG[lang]}' xmlns='http://www.w3.org/2001/10/synthesis'>` +
    `<voice name='${ROOF_VOICES[lang]}'><lang xml:lang='${XML_LANG[lang]}'>${xmlEscape(text)}</lang></voice></speak>`
  try {
    const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'oneroof',
      },
      body: ssml,
    })
    if (!r.ok) return res.status(502).json({ error: 'voice_failed' })
    const audio = Buffer.from(await r.arrayBuffer()).toString('base64')
    try {
      await db.rpc('ai_light_record', { p_household: household, p_kind: 'voice', p_cost: text.length * VOICE_USD_PER_CHAR })
    } catch {
      /* metering never breaks a good reply */
    }
    return res.status(200).json({ audio, format: 'mp3' })
  } catch {
    return res.status(502).json({ error: 'voice_failed' })
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
  if (!supabaseUrl || !anonKey || !token) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  })
  if (!userRes.ok) return res.status(401).json({ error: 'Unauthorized' })
  const email = (await userRes.json())?.email
  if (!email) return res.status(401).json({ error: 'Unauthorized' })

  const isAssistant = req.query?.action === 'assistant'

  // The app reports an understood-but-failed request: intent + reason code
  // ONLY (no text ever comes here). Needs no AI, so it skips the AI checks.
  if (req.query?.action === 'assistant-gap') {
    const serviceKeyGap = process.env.SUPABASE_SERVICE_ROLE_KEY
    const dbGap = serviceKeyGap ? createClient(supabaseUrl, serviceKeyGap, { auth: { persistSession: false } }) : null
    let hh: string | null = null
    if (dbGap) {
      const { data: caller } = await dbGap.from('allowed_users').select('household_id').eq('email', email).maybeSingle()
      hh = caller?.household_id ?? null
    }
    const code = (v: unknown) => (typeof v === 'string' && /^[a-z_]{1,40}$/.test(v) ? v : '')
    await recordGap(dbGap, hh, { kind: 'failed', intent: code(req.body?.intent), reason: code(req.body?.reason), lang: code(req.body?.lang) })
    return res.status(200).json({ ok: true })
  }

  // Roof's spoken replies (owner, 2026-11): text → Azure neural voice (MP3,
  // base64). Plus only (the signup trial counts). Lives here because the
  // Vercel plan is at its function cap. Metered as kind 'voice'.
  if (req.query?.action === 'speak') return speak(req.body, supabaseUrl, email, res)

  const { text } = req.body ?? {}
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Missing text' })
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'AI pings are not configured.' })
  }

  // Cost metering (best-effort, fails OPEN). Resolves the caller's household
  // server-side and checks the service-role-only ceiling before spending.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const db = serviceKey ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } }) : null
  let household: string | null = null
  if (db) {
    try {
      const { data: caller } = await db
        .from('allowed_users')
        .select('household_id')
        .eq('email', email)
        .maybeSingle()
      household = caller?.household_id ?? null
      if (household) {
        const { data: gate, error: gateErr } = await db.rpc('ai_light_allowed', {
          p_household: household,
          p_kind: isAssistant ? 'assistant' : 'nudge',
          p_cap: isAssistant ? ASSISTANT_CAP : DAILY_CAP,
        })
        // Only an EXPLICIT "no" blocks; an RPC error leaves the feature working.
        if (!gateErr && gate && gate.allowed === false) {
          if (isAssistant) return res.status(429).json({ error: 'paused' })
          return res.status(429).json({ error: 'AI nudges are paused for now — try a preset.' })
        }
      }
    } catch {
      /* metering must never block a legitimate nudge */
    }
  }

  if (isAssistant) {
    // Free plan: 5 a month per member. Only an EXPLICIT "no" blocks — an RPC
    // error (or the migration not applied yet) leaves the assistant working.
    let quota: any = null
    if (db && household) {
      try {
        const { data, error } = await db.rpc('assistant_quota', { p_household: household, p_email: email, p_cap: ASSISTANT_FREE_MONTHLY })
        if (!error && data) quota = data
      } catch {
        /* fail open */
      }
    }
    if (quota && quota.allowed === false && quota.reason !== 'no_household') {
      return res.status(402).json({ error: 'assistant_limit', used: quota.used ?? ASSISTANT_FREE_MONTHLY, cap: ASSISTANT_FREE_MONTHLY })
    }
    return assistant(req.body, db, household, res, email, quota)
  }

  try {
    const client = new Anthropic()
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                'Convert this short note from a family member into a household "ping" —',
                'a quick ping the rest of the household will see on their phones.',
                'Pick the closest kind, a fitting single emoji, and a concise message',
                'in the SAME language as the note.',
                '',
                `Note: ${text.trim().slice(0, 280)}`,
              ].join('\n'),
            },
          ],
        },
      ],
      output_config: {
        format: { type: 'json_schema', schema: PING_SCHEMA },
      },
    })

    if (db && household) {
      try {
        await db.rpc('ai_light_record', {
          p_household: household,
          p_kind: 'nudge',
          p_cost: estCost(response.usage),
        })
      } catch {
        /* metering write failure must not break a good response */
      }
    }

    const block = response.content.find((b) => b.type === 'text')
    if (!block || block.type !== 'text') {
      return res.status(502).json({ error: 'Could not build the ping.' })
    }
    const parsed = JSON.parse(block.text)
    return res.status(200).json({
      kind: typeof parsed.kind === 'string' ? parsed.kind : 'custom',
      emoji: (typeof parsed.emoji === 'string' && parsed.emoji.trim()) || '📣',
      message: (typeof parsed.message === 'string' && parsed.message.trim()) || text.trim(),
    })
  } catch (err: any) {
    if (err instanceof Anthropic.APIError && /credit balance|billing/i.test(err.message ?? '')) {
      return res.status(502).json({ error: 'AI is paused — out of credits.' })
    }
    return res.status(502).json({ error: 'Could not build the ping — try a preset.' })
  }
}
