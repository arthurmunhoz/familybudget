// A single pet's details — an editable screen. Reached only via the pencil on
// a pet card, so the fields are editable in place (via the shared PetEditor):
// no separate "edit" step. Below the editor: that pet's event history
// (read-only) and a delete-pet action.
import { Alert, Pressable, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'

import { AppHeader, Loader, Screen, Txt } from '@/components/ui'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import { formatDay } from '@/lib/format'
import { track } from '@/lib/analytics'
import { supabase } from '@/lib/supabase'
import type { Pet, PetEvent } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'
import { TYPE_ICON } from './petUi'
import { PetEditor } from './PetEditor'

export default function PetProfile({ petId }: { petId: string }) {
  const { c } = useTheme()
  const { t } = useI18n()

  const {
    data: { pet, events } = { pet: null, events: [] },
    loading,
    revalidate: load,
  } = useCachedQuery<{ pet: Pet | null; events: PetEvent[] }>(`pet:${petId}`, async () => {
    const [petRes, evRes] = await Promise.all([
      supabase.from('pets').select('*').eq('id', petId).single(),
      supabase
        .from('pet_events')
        .select('*')
        .eq('pet_id', petId)
        .order('event_date', { ascending: false }),
    ])
    return {
      pet: (petRes.data as Pet | null) ?? null,
      events: (evRes.data ?? []) as PetEvent[],
    }
  })

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
    <Screen scroll header={<AppHeader title={pet.name} onBack={goBack} />}>
      <View style={{ gap: sp.xl, paddingTop: sp.sm }}>
        {/* editable fields */}
        <PetEditor pet={pet} onSaved={load} />

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
  )
}
