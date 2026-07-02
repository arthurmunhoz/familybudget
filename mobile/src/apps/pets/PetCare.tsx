// Pet Care — the module's main screen. A horizontal carousel of pet cards
// (photo/emoji + name + species/breed + age); tapping a card filters the events
// below to that pet. "Coming up" surfaces next-due reminders (overdue vs
// upcoming) with a "✓ Done" re-log button; "History" lists every logged event.
// The bottom bar adds a new event (or the first pet). Pet add/edit and event
// add/edit are bottom-sheet modals.
import { useMemo, useState } from 'react'
import { Alert, Pressable, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Image } from 'expo-image'
import { Check, PawPrint, Pencil, Plus, X } from 'lucide-react-native'

import { AppHeader, Btn, EmptyState, Loader, Txt } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { addDaysISO, daysBetweenISO, formatDay, todayISO } from '@/lib/format'
import { reminderEvents } from '@/lib/petCare'
import { getSignedUrls } from '@/lib/signedUrls'
import { supabase } from '@/lib/supabase'
import type { Pet, PetEvent } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'
import { ageInMonths, speciesEmoji } from './petMeta'
import { TYPE_ICON } from './petUi'
import PetForm from './PetForm'
import EventForm, { type EventDraft } from './EventForm'

const emptyDraft: EventDraft = {
  pet: '',
  type: 'medication',
  title: '',
  date: todayISO(),
  nextDue: '',
  notes: '',
}

export default function PetCare() {
  const { c } = useTheme()
  const { t } = useI18n()
  const { profile } = useAuth()

  const [petFilter, setPetFilter] = useState<string>('all')

  const [showPetForm, setShowPetForm] = useState(false)
  const [showEventForm, setShowEventForm] = useState(false)
  const [editingEvent, setEditingEvent] = useState<PetEvent | null>(null)
  const [draft, setDraft] = useState<EventDraft>(emptyDraft)

  const {
    data: { pets, events, petPhotoUrls } = { pets: [], events: [], petPhotoUrls: {} },
    loading,
    revalidate: load,
  } = useCachedQuery<{ pets: Pet[]; events: PetEvent[]; petPhotoUrls: Record<string, string> }>(
    'pets',
    async () => {
      const [petsRes, eventsRes] = await Promise.all([
        supabase.from('pets').select('*').order('name'),
        supabase.from('pet_events').select('*').order('event_date', { ascending: false }),
      ])
      const petRows = (petsRes.data ?? []) as Pet[]
      const eventRows = (eventsRes.data ?? []) as PetEvent[]
      const paths = petRows.map((p) => p.photo_path).filter(Boolean) as string[]
      let photoUrls: Record<string, string> = {}
      if (paths.length) {
        const byPath = await getSignedUrls(paths)
        photoUrls = Object.fromEntries(
          petRows
            .filter((p) => p.photo_path && byPath[p.photo_path])
            .map((p) => [p.id, byPath[p.photo_path as string]]),
        )
      }
      return { pets: petRows, events: eventRows, petPhotoUrls: photoUrls }
    },
  )

  const petById = useMemo(() => Object.fromEntries(pets.map((p) => [p.id, p])), [pets])

  const visible = useMemo(
    () => (petFilter === 'all' ? events : events.filter((e) => e.pet_id === petFilter)),
    [events, petFilter],
  )

  const reminders = useMemo(() => reminderEvents(visible), [visible])

  function dueLabel(due: string): { text: string; overdue: boolean } {
    const days = daysBetweenISO(todayISO(), due)
    if (days < 0) return { text: t('pets.overdue', { days: -days }), overdue: true }
    if (days === 0) return { text: t('pets.dueToday'), overdue: true }
    if (days <= 30) return { text: t('pets.inDays', { days }), overdue: false }
    return { text: formatDay(due), overdue: false }
  }

  function openNewEvent() {
    setEditingEvent(null)
    setDraft({
      ...emptyDraft,
      pet: petFilter !== 'all' ? petFilter : (pets[0]?.id ?? ''),
      date: todayISO(),
    })
    setShowEventForm(true)
  }

  // "I did this again" — open a NEW event copying the original but dated today,
  // rolling next-due forward by the previous interval.
  function logAgain(ev: PetEvent) {
    setEditingEvent(null)
    const interval = ev.next_due ? daysBetweenISO(ev.event_date, ev.next_due) : 0
    setDraft({
      pet: ev.pet_id,
      type: ev.type,
      title: ev.title,
      date: todayISO(),
      nextDue: interval > 0 ? addDaysISO(todayISO(), interval) : '',
      notes: ev.notes ?? '',
    })
    setShowEventForm(true)
  }

  function openEditEvent(ev: PetEvent) {
    setEditingEvent(ev)
    setDraft({
      pet: ev.pet_id,
      type: ev.type,
      title: ev.title,
      date: ev.event_date,
      nextDue: ev.next_due ?? '',
      notes: ev.notes ?? '',
    })
    setShowEventForm(true)
  }

  function removeEvent(event: PetEvent) {
    const pet = petById[event.pet_id]
    Alert.alert(
      t('pets.deleteConfirm', { title: event.title, pet: pet?.name ?? '' }),
      undefined,
      [
        { text: t('common.close'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            await supabase.from('pet_events').delete().eq('id', event.id)
            await load()
          },
        },
      ],
    )
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <View style={{ paddingHorizontal: sp.lg }}>
        <AppHeader
          title={t('pets.title')}
          right={
            <PawPrint size={22} color={c.accent} />
          }
        />
      </View>

      {loading ? (
        <Loader />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* pet carousel */}
          {pets.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: sp.lg, paddingVertical: sp.sm, gap: sp.md }}
            >
              {pets.map((p) => {
                const m = p.birthday ? ageInMonths(p.birthday, todayISO()) : null
                const age =
                  m == null || m < 0
                    ? null
                    : m < 12
                      ? t('pets.ageMo', { months: m })
                      : t('pets.ageY', { years: Math.floor(m / 12) })
                const sub = [p.species ? t(`pets.species.${p.species}` as TKey) : null, p.breed]
                  .filter(Boolean)
                  .join(' · ')
                const selected = petFilter === p.id
                return (
                  <View
                    key={p.id}
                    style={{
                      width: 144,
                      borderRadius: radius.lg,
                      backgroundColor: c.card,
                      overflow: 'hidden',
                      borderWidth: 2,
                      borderColor: selected ? c.accent : 'transparent',
                    }}
                  >
                    <Pressable onPress={() => setPetFilter(selected ? 'all' : p.id)}>
                      <View
                        style={{
                          height: 96,
                          width: '100%',
                          backgroundColor: c.surface,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {petPhotoUrls[p.id] ? (
                          <Image
                            source={{ uri: petPhotoUrls[p.id] }}
                            style={{ height: 96, width: 144 }}
                            contentFit="cover"
                          />
                        ) : (
                          <Txt style={{ fontSize: 44 }}>{p.emoji || speciesEmoji(p.species)}</Txt>
                        )}
                      </View>
                      <View style={{ padding: sp.md }}>
                        <Txt style={{ fontWeight: '700' }} numberOfLines={1}>
                          {p.name}
                        </Txt>
                        {sub ? (
                          <Txt variant="faint" numberOfLines={1}>
                            {sub}
                          </Txt>
                        ) : null}
                        {age ? <Txt variant="muted">{age}</Txt> : null}
                      </View>
                    </Pressable>
                    <Pressable
                      onPress={() => router.push(`/pets/${p.id}`)}
                      accessibilityLabel={`${t('pets.details')}: ${p.name}`}
                      hitSlop={6}
                      style={{
                        position: 'absolute',
                        right: 8,
                        top: 8,
                        height: 32,
                        width: 32,
                        borderRadius: 16,
                        backgroundColor: 'rgba(0,0,0,0.45)',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Pencil size={14} color="#fff" />
                    </Pressable>
                  </View>
                )
              })}
              {/* add-pet card */}
              <Pressable
                onPress={() => setShowPetForm(true)}
                style={{
                  width: 96,
                  borderRadius: radius.lg,
                  borderWidth: 2,
                  borderStyle: 'dashed',
                  borderColor: c.surface2,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  paddingVertical: 12,
                }}
              >
                <Plus size={24} color={c.textFaint} />
                <Txt variant="label" style={{ color: c.textFaint }}>
                  {t('pets.addPet')}
                </Txt>
              </Pressable>
            </ScrollView>
          )}

          <View style={{ paddingHorizontal: sp.lg, gap: sp.lg, marginTop: sp.sm }}>
            {/* Coming up */}
            {reminders.length > 0 && (
              <View style={{ gap: sp.sm }}>
                <SectionTitle>{t('pets.comingUp')}</SectionTitle>
                {reminders.map((e) => {
                  const due = dueLabel(e.next_due!)
                  const Icon = TYPE_ICON[e.type]
                  const pet = petById[e.pet_id]
                  return (
                    <View
                      key={e.id}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: sp.md,
                        backgroundColor: c.surface,
                        borderRadius: radius.sm,
                        borderLeftWidth: 4,
                        borderLeftColor: due.overdue ? c.expense : c.accent,
                        paddingVertical: 10,
                        paddingHorizontal: sp.md,
                      }}
                    >
                      <Icon size={20} color={c.textMuted} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Txt style={{ fontWeight: '500' }} numberOfLines={1}>
                          {e.title}
                        </Txt>
                        <Txt variant="faint" numberOfLines={1}>
                          {pet?.emoji} {pet?.name} · {t('pets.lastDone')} {formatDay(e.event_date)}
                        </Txt>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 6 }}>
                        <View
                          style={{
                            borderRadius: radius.pill,
                            paddingHorizontal: 10,
                            paddingVertical: 4,
                            backgroundColor: due.overdue ? c.expense : c.card,
                          }}
                        >
                          <Txt
                            style={{
                              fontSize: 12,
                              fontWeight: '700',
                              color: due.overdue ? '#fff' : c.textMuted,
                            }}
                          >
                            {due.text}
                          </Txt>
                        </View>
                        {due.overdue && (
                          <Pressable
                            onPress={() => logAgain(e)}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 4,
                              borderRadius: radius.pill,
                              backgroundColor: c.accent,
                              paddingHorizontal: 12,
                              paddingVertical: 4,
                            }}
                          >
                            <Check size={14} color="#fff" strokeWidth={2.5} />
                            <Txt style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>
                              {t('pets.markDone')}
                            </Txt>
                          </Pressable>
                        )}
                      </View>
                    </View>
                  )
                })}
              </View>
            )}

            {/* History / empty states */}
            {pets.length === 0 ? (
              <View style={{ marginTop: sp.xxl }}>
                <EmptyState title={t('pets.noPets')} subtitle={t('pets.noPetsHint')} />
              </View>
            ) : visible.length === 0 ? (
              <View style={{ marginTop: sp.xxl }}>
                <EmptyState title={t('pets.noEvents')} subtitle={t('pets.noEventsHint')} />
              </View>
            ) : (
              <View style={{ gap: sp.sm }}>
                <SectionTitle>{t('pets.history')}</SectionTitle>
                {visible.map((e) => {
                  const Icon = TYPE_ICON[e.type]
                  const pet = petById[e.pet_id]
                  return (
                    <View
                      key={e.id}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'flex-start',
                        gap: sp.md,
                        backgroundColor: c.card,
                        borderRadius: radius.md,
                        paddingHorizontal: sp.lg,
                        paddingVertical: sp.md,
                      }}
                    >
                      <Pressable
                        onPress={() => openEditEvent(e)}
                        style={{ flexDirection: 'row', gap: sp.md, flex: 1, minWidth: 0 }}
                      >
                        <Icon size={20} color={c.textMuted} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Txt style={{ fontWeight: '500' }} numberOfLines={1}>
                            {e.title}
                          </Txt>
                          <Txt variant="faint">
                            {pet?.emoji} {pet?.name} · {formatDay(e.event_date)}
                            {e.next_due ? ` · ${t('pets.next')} ${formatDay(e.next_due)}` : ''}
                          </Txt>
                          {e.notes ? (
                            <Txt variant="muted" style={{ marginTop: 4 }}>
                              {e.notes}
                            </Txt>
                          ) : null}
                        </View>
                      </Pressable>
                      <Pressable
                        onPress={() => removeEvent(e)}
                        hitSlop={8}
                        accessibilityLabel={t('common.deleteName', { name: e.title })}
                      >
                        <X size={18} color={c.textFaint} />
                      </Pressable>
                    </View>
                  )
                })}
              </View>
            )}
          </View>
        </ScrollView>
      )}

      {/* bottom action bar */}
      <SafeAreaView edges={['bottom']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <View style={{ paddingHorizontal: sp.lg, paddingTop: sp.sm, paddingBottom: sp.sm }}>
          <Btn
            title={pets.length === 0 ? t('pets.addPetBtn') : t('pets.newEventBtn')}
            onPress={() => (pets.length === 0 ? setShowPetForm(true) : openNewEvent())}
          />
        </View>
      </SafeAreaView>

      {showPetForm && (
        <PetForm
          pet={null}
          onClose={() => setShowPetForm(false)}
          onSaved={() => {
            setShowPetForm(false)
            load()
          }}
        />
      )}

      {showEventForm && profile && (
        <EventForm
          pets={pets}
          draft={draft}
          setDraft={setDraft}
          editingEvent={editingEvent}
          addedBy={profile.email}
          onClose={() => {
            setShowEventForm(false)
            setEditingEvent(null)
          }}
          onSaved={() => {
            setShowEventForm(false)
            setEditingEvent(null)
            load()
          }}
          onDelete={removeEvent}
        />
      )}
    </SafeAreaView>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  const { c } = useTheme()
  return (
    <Txt
      style={{
        fontSize: 12,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        color: c.textFaint,
      }}
    >
      {children}
    </Txt>
  )
}
