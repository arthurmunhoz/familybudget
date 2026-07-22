// A single pet's details — an editable screen. Reached only via the pencil on
// a pet card, so the fields are editable in place (via the shared PetEditor):
// no separate "edit" step. Below the editor: that pet's event history
// (read-only) and a delete-pet action.
import { useRef, useState } from 'react'
import { Alert, Animated, Pressable, StyleSheet, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Scale, Trash2 } from 'lucide-react-native'

import { AppHeader, Loader, Screen, Txt } from '@/components/ui'
import { Toast, type ToastData } from '@/components/Toast'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import { formatDay, todayISO } from '@/lib/format'
import { track } from '@/lib/analytics'
import { supabase } from '@/lib/supabase'
import type { Pet, PetEvent, PetWeight } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'
import { TYPE_ICON } from './petUi'
import { PetEditor } from './PetEditor'

export default function PetProfile({ petId }: { petId: string }) {
  const { c } = useTheme()
  const { t } = useI18n()

  const [toast, setToast] = useState<ToastData | null>(null)
  // Drives the pet photo's collapse as the page scrolls (JS-driven — it
  // animates a height, which the native driver can't do).
  const scrollY = useRef(new Animated.Value(0)).current
  const [newWeight, setNewWeight] = useState('')
  const [savingWeight, setSavingWeight] = useState(false)

  const {
    data: { pet, events, weights } = { pet: null, events: [], weights: [] },
    loading,
    revalidate: load,
  } = useCachedQuery<{ pet: Pet | null; events: PetEvent[]; weights: PetWeight[] }>(
    `pet:${petId}`,
    async () => {
      const [petRes, evRes, wRes] = await Promise.all([
        supabase.from('pets').select('*').eq('id', petId).single(),
        supabase
          .from('pet_events')
          .select('*')
          .eq('pet_id', petId)
          .order('event_date', { ascending: false }),
        supabase
          .from('pet_weights')
          .select('*')
          .eq('pet_id', petId)
          .order('measured_on', { ascending: false }),
      ])
      return {
        pet: (petRes.data as Pet | null) ?? null,
        events: (evRes.data ?? []) as PetEvent[],
        weights: (wRes.data ?? []) as PetWeight[],
      }
    },
  )

  async function addWeight() {
    const value = Number(newWeight.replace(',', '.'))
    if (!pet || savingWeight || !value || value <= 0) return
    setSavingWeight(true)
    const { error } = await supabase
      .from('pet_weights')
      .insert({ pet_id: pet.id, weight: value, measured_on: todayISO() })
    setSavingWeight(false)
    if (error) {
      Alert.alert(t('pets.saveFailed'))
      return
    }
    track('pet.weight_logged', { pet: pet.name, weight: value })
    setNewWeight('')
    load()
  }

  async function removeWeight(w: PetWeight) {
    await supabase.from('pet_weights').delete().eq('id', w.id)
    load()
  }

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
          track('pet.deleted', { name: pet.name })
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

  return (
    <View style={{ flex: 1 }}>
      <Screen
        scroll
        header={<AppHeader title={pet.name} onBack={goBack} />}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: false,
        })}
      >
      <View style={{ gap: sp.xl, paddingTop: sp.sm }}>
        {/* editable fields */}
        <PetEditor
          pet={pet}
          scrollY={scrollY}
          onSaved={(name) => {
            load()
            setToast({ emoji: '🐾', text: t('pets.savedToast', { name: name ?? pet.name }) })
          }}
        />

        {/* Everything below the editor is its own record of the pet, not part
            of the form — a rule keeps Save from looking attached to it. */}
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />

        {/* weight log — quick to update at a vet visit */}
        <View style={{ gap: sp.sm, marginTop: -sp.sm }}>
          <Txt
            style={{
              fontSize: 12,
              fontWeight: '600',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              color: c.textFaint,
            }}
          >
            {t('petcare.weightLog')}
          </Txt>
          <View style={{ flexDirection: 'row', gap: sp.sm }}>
            <TextInput
              value={newWeight}
              onChangeText={setNewWeight}
              placeholder={t('petcare.weightHint')}
              placeholderTextColor={c.textFaint}
              keyboardType="decimal-pad"
              style={{
                flex: 1,
                backgroundColor: c.surface,
                borderRadius: radius.md,
                paddingHorizontal: sp.md,
                paddingVertical: 10,
                fontSize: 16,
                color: c.text,
              }}
            />
            <Pressable
              onPress={addWeight}
              disabled={savingWeight || !newWeight.trim()}
              style={{
                paddingHorizontal: sp.lg,
                borderRadius: radius.md,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: c.accent,
                opacity: savingWeight || !newWeight.trim() ? 0.5 : 1,
              }}
            >
              <Txt style={{ color: c.onAccent, fontWeight: '700' }}>{t('common.add')}</Txt>
            </Pressable>
          </View>
          {weights.map((w) => (
            <View
              key={w.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: sp.md,
                backgroundColor: c.surface,
                borderRadius: radius.md,
                paddingHorizontal: sp.lg,
                paddingVertical: sp.sm,
              }}
            >
              <Scale size={16} color={c.textMuted} />
              <Txt style={{ flex: 1, fontWeight: '500' }}>{String(w.weight)}</Txt>
              <Txt variant="faint">{formatDay(w.measured_on)}</Txt>
              <Pressable onPress={() => void removeWeight(w)} hitSlop={8} accessibilityLabel={t('common.delete')}>
                <Trash2 size={15} color={c.textFaint} />
              </Pressable>
            </View>
          ))}
        </View>

        {/* event history (read-only) */}
        {events.length > 0 && (
          <View style={{ gap: sp.sm }}>
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

        <Pressable onPress={deletePet} style={{ paddingVertical: 12, alignItems: 'center' }}>
          <Txt style={{ color: c.expense, fontWeight: '600' }}>{t('pets.deletePet')}</Txt>
        </Pressable>
      </View>
      </Screen>
      <Toast data={toast} />
    </View>
  )
}
