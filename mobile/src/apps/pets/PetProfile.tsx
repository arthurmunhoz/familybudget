// A single pet's profile: hero photo (or emoji), detail rows (only the filled-in
// ones), and that pet's event history. Edit opens the shared PetForm; delete
// removes the pet (and cascades its events server-side).
import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Image } from 'expo-image'
import { ChevronLeft, Pencil } from 'lucide-react-native'

import { Loader, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { formatDay, todayISO } from '@/lib/format'
import { getSignedUrl } from '@/lib/signedUrls'
import { supabase } from '@/lib/supabase'
import type { Pet, PetEvent } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'
import { ageInMonths, speciesEmoji } from './petMeta'
import { TYPE_ICON } from './petUi'
import PetForm from './PetForm'

export default function PetProfile({ petId }: { petId: string }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const [pet, setPet] = useState<Pet | null>(null)
  const [events, setEvents] = useState<PetEvent[]>([])
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)

  const load = useCallback(async () => {
    const [petRes, evRes] = await Promise.all([
      supabase.from('pets').select('*').eq('id', petId).single(),
      supabase
        .from('pet_events')
        .select('*')
        .eq('pet_id', petId)
        .order('event_date', { ascending: false }),
    ])
    const p = (petRes.data as Pet | null) ?? null
    setPet(p)
    setEvents((evRes.data ?? []) as PetEvent[])
    setPhotoUrl(p?.photo_path ? await getSignedUrl(p.photo_path) : null)
    setLoading(false)
  }, [petId])

  useEffect(() => {
    load()
  }, [load])

  function goBack() {
    if (router.canGoBack()) router.back()
    else router.replace('/pets')
  }

  function deletePet() {
    if (!pet) return
    Alert.alert(t('pets.deletePetConfirm', { name: pet.name }), undefined, [
      { text: t('common.close'), style: 'cancel' },
      {
        text: t('pets.deletePet'),
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('pets').delete().eq('id', pet.id)
          if (error) {
            Alert.alert(t('pets.deletePetFailed'))
            return
          }
          goBack()
        },
      },
    ])
  }

  if (loading || !pet) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <Loader />
      </SafeAreaView>
    )
  }

  // Detail rows, only the ones that are filled in.
  const rows: { label: string; value: string }[] = []
  if (pet.species) rows.push({ label: t('pets.species'), value: t(`pets.species.${pet.species}` as TKey) })
  if (pet.breed) rows.push({ label: t('pets.breed'), value: pet.breed })
  if (pet.birthday) {
    const m = ageInMonths(pet.birthday, todayISO())
    const age =
      m < 0 ? '' : m < 12 ? t('pets.ageMo', { months: m }) : t('pets.ageY', { years: Math.floor(m / 12) })
    rows.push({ label: t('pets.birthday'), value: formatDay(pet.birthday) + (age ? ` · ${age}` : '') })
  }
  if (pet.color) {
    rows.push({
      label: t('pets.color'),
      value: pet.color + (pet.color_secondary ? ` & ${pet.color_secondary}` : ''),
    })
  }
  if (pet.weight) rows.push({ label: t('pets.weight'), value: pet.weight })
  if (pet.length) rows.push({ label: t('pets.length'), value: pet.length })
  if (pet.microchip) rows.push({ label: t('pets.microchip'), value: pet.microchip })

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: sp.xxl }}>
        {/* hero photo */}
        <View>
          <View style={{ aspectRatio: 1, width: '100%', backgroundColor: c.surface }}>
            {photoUrl ? (
              <Image source={{ uri: photoUrl }} style={{ flex: 1 }} contentFit="cover" />
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Txt style={{ fontSize: 96 }}>{pet.emoji || speciesEmoji(pet.species)}</Txt>
              </View>
            )}
          </View>
          <SafeAreaView
            edges={['top']}
            style={{ position: 'absolute', left: 0, right: 0, top: 0 }}
            pointerEvents="box-none"
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                paddingHorizontal: sp.md,
                paddingTop: sp.sm,
              }}
            >
              <RoundBtn onPress={goBack} label={t('common.close')}>
                <ChevronLeft size={22} color="#fff" />
              </RoundBtn>
              <RoundBtn onPress={() => setEditing(true)} label={t('pets.edit')}>
                <Pencil size={16} color="#fff" />
              </RoundBtn>
            </View>
          </SafeAreaView>
        </View>

        {/* info card pulled up over the photo */}
        <View
          style={{
            marginTop: -24,
            minHeight: 320,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            backgroundColor: c.card,
            paddingHorizontal: sp.lg,
            paddingTop: sp.lg,
            paddingBottom: sp.xxl,
          }}
        >
          <Txt variant="title">
            {pet.species ? `${speciesEmoji(pet.species)} ` : ''}
            {pet.name}
          </Txt>

          {rows.length === 0 && !pet.notes ? (
            <Txt variant="faint" style={{ marginTop: sp.md }}>
              {t('pets.noInfo')}
            </Txt>
          ) : (
            <View style={{ marginTop: sp.md, gap: sp.sm }}>
              {rows.map((r) => (
                <Row key={r.label} label={r.label} value={r.value} />
              ))}
              {pet.notes ? <Row label={t('pets.petNotes')} value={pet.notes} /> : null}
            </View>
          )}

          {events.length > 0 && (
            <View style={{ marginTop: sp.xl, gap: sp.sm }}>
              <Txt
                style={{
                  fontSize: 12,
                  fontWeight: '600',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  color: c.textFaint,
                }}
              >
                {t('pets.history')}
              </Txt>
              {events.map((e) => {
                const Icon = TYPE_ICON[e.type]
                return (
                  <View
                    key={e.id}
                    style={{
                      flexDirection: 'row',
                      gap: sp.md,
                      backgroundColor: c.surface,
                      borderRadius: radius.md,
                      paddingHorizontal: sp.lg,
                      paddingVertical: sp.md,
                    }}
                  >
                    <Icon size={20} color={c.textMuted} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Txt style={{ fontWeight: '500' }} numberOfLines={1}>
                        {e.title}
                      </Txt>
                      <Txt variant="faint">
                        {formatDay(e.event_date)}
                        {e.next_due ? ` · ${t('pets.next')} ${formatDay(e.next_due)}` : ''}
                      </Txt>
                      {e.notes ? (
                        <Txt variant="muted" style={{ marginTop: 4 }}>
                          {e.notes}
                        </Txt>
                      ) : null}
                    </View>
                  </View>
                )
              })}
            </View>
          )}

          <Pressable onPress={deletePet} style={{ marginTop: sp.xl, paddingVertical: 12, alignItems: 'center' }}>
            <Txt style={{ color: c.expense, fontWeight: '600' }}>{t('pets.deletePet')}</Txt>
          </Pressable>
        </View>
      </ScrollView>

      {editing && (
        <PetForm
          pet={pet}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            load()
          }}
        />
      )}
    </View>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', gap: sp.md }}>
      <Txt variant="faint" style={{ width: 112 }}>
        {label}
      </Txt>
      <Txt style={{ flex: 1, color: c.text }}>{value}</Txt>
    </View>
  )
}

function RoundBtn({
  onPress,
  label,
  children,
}: {
  onPress: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      hitSlop={6}
      style={{
        height: 36,
        width: 36,
        borderRadius: 18,
        backgroundColor: 'rgba(0,0,0,0.45)',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </Pressable>
  )
}
