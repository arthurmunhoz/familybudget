// Bottom sheet for picking the home city, opened from the Hub's Today card when
// no city is set yet ("Set city"). The keyboard comes up with it so you can type
// straight away — the point is to set a city in one tap without a trip to
// Settings. Settings' Weather section still owns the fuller job (seeing current
// conditions, changing the city, removing it).
//
// Keyboard: the sheet sits ON TOP of the keyboard (and on Android above the
// navigation bar) via useSheetLift. This used to be a KeyboardAvoidingView,
// iOS-only, on the assumption that Android shrinks the modal's window by
// itself; under edge-to-edge it doesn't, and the whole sheet (field included)
// stayed behind the keyboard.
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { ChevronRight, CloudSun, MapPin, Search, X } from 'lucide-react-native'

import { Txt } from './ui'
import { GradientBox } from './home/GradientBox'
import { useI18n } from '../hooks/useI18n'
import { useBottomGap } from '../hooks/useBottomGap'
import { useSheetLift } from '../hooks/useSheetLift'
import { fonts, sp, useTheme } from '../theme/theme'
import { saveHomeLocation, searchCities, type HomeLocation } from '../lib/weather'
import type { TKey } from '../lib/i18n'

export function CityPickerSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n()
  const { c } = useTheme()
  const bottomGap = useBottomGap(sp.lg)
  const { lift, room, clearOfBars, onRootLayout } = useSheetLift()
  const inputRef = useRef<TextInput>(null)
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<HomeLocation[]>([])
  const [searching, setSearching] = useState(false)
  const [msg, setMsg] = useState<TKey | null>(null)

  // Live debounced autocomplete — same contract as the Weather section in
  // Settings (searchCities ignores queries under 2 chars).
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setSuggestions([])
      setSearching(false)
      setMsg(null)
      return
    }
    setSearching(true)
    let active = true
    const id = setTimeout(async () => {
      const results = await searchCities(q)
      if (!active) return
      setSuggestions(results)
      setSearching(false)
      setMsg(results.length === 0 ? 'settings.cityNotFound' : null)
    }, 300)
    return () => {
      active = false
      clearTimeout(id)
    }
  }, [query])

  async function pick(loc: HomeLocation) {
    await saveHomeLocation(loc)
    onSaved()
  }

  const SKY: [string, string] = ['#4FA3F7', '#3567D6']

  return (
    <Modal
      visible
      animationType="slide"
      transparent
      onRequestClose={onClose}
      // `autoFocus` alone works on iOS, but on Android it fires before the
      // modal's window is on screen, so the field never gets focus and the
      // keyboard doesn't come up. Focusing once the modal is shown does.
      onShow={() => inputRef.current?.focus()}
    >
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onLayout={onRootLayout}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessible={false} />
        <View
          style={{
            // Against what the keyboard leaves, so the sheet never grows behind it.
            maxHeight: room * 0.88,
            marginBottom: lift,
            backgroundColor: c.sheet,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingTop: sp.lg,
          }}
        >
          {/* 2026-11 restyle: the weather tile in sky blue, a big title with
              what it's for faded under it, a round close. */}
          <View style={s_.head}>
            <GradientBox colors={SKY} radius={16} style={s_.tile}>
              <CloudSun size={24} color="#fff" />
            </GradientBox>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt style={{ fontFamily: fonts.display, fontSize: 26, lineHeight: 31, color: c.text }}>
                {t('settings.homeCity')}
              </Txt>
              <Txt style={{ fontFamily: fonts.display, fontSize: 16, lineHeight: 21, color: c.textFaint }}>
                {t('settings.homeCityHint')}
              </Txt>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              style={[s_.close, { backgroundColor: c.surface }]}
            >
              <X size={16} color={c.textMuted} />
            </Pressable>
          </View>

          {/* keyboardShouldPersistTaps: a suggestion must be tappable while the
              keyboard is still up, otherwise the first tap only dismisses it. */}
          <ScrollView
            // flexShrink so the suggestions yield to the sheet's max height
            // once the keyboard has taken half the screen.
            style={{ flexGrow: 0, flexShrink: 1 }}
            contentContainerStyle={{
              paddingHorizontal: sp.lg,
              paddingTop: sp.md,
              // iOS with no keyboard: clear the home indicator. Otherwise the
              // sheet already sits above the keyboard / navigation bar.
              paddingBottom: clearOfBars ? sp.lg : bottomGap,
              gap: sp.md,
            }}
            keyboardShouldPersistTaps="handled"
          >
            {/* the search as a capsule, like the ask bar */}
            <View style={[s_.search, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Search size={18} color={c.textMuted} />
              <TextInput
                ref={inputRef}
                value={query}
                onChangeText={setQuery}
                placeholder={t('settings.cityPlaceholder')}
                placeholderTextColor={c.textFaint}
                autoFocus
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="search"
                onSubmitEditing={() => {
                  if (suggestions[0]) void pick(suggestions[0])
                }}
                style={{ flex: 1, fontSize: 16, fontFamily: fonts.body, color: c.text, paddingVertical: 0 }}
              />
              {searching ? <ActivityIndicator size="small" color={c.textMuted} /> : null}
            </View>

            {suggestions.length > 0 ? (
              <View style={[s_.card, { backgroundColor: c.card, borderColor: c.border }]}>
                {suggestions.map((s, i) => {
                  const [city, ...rest] = s.city.split(',')
                  return (
                    <Pressable
                      key={`${s.lat},${s.lon}`}
                      onPress={() => void pick(s)}
                      style={({ pressed }) => [
                        s_.row,
                        { borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: c.border, opacity: pressed ? 0.6 : 1 },
                      ]}
                    >
                      <View style={[s_.pin, { backgroundColor: SKY[0] + '22' }]}>
                        <MapPin size={16} color={SKY[1]} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Txt style={{ fontFamily: fonts.display, fontSize: 16.5, color: c.text }} numberOfLines={1}>
                          {city.trim()}
                        </Txt>
                        {rest.length ? (
                          <Txt variant="faint" style={{ fontSize: 12.5 }} numberOfLines={1}>
                            {rest.join(',').trim()}
                          </Txt>
                        ) : null}
                      </View>
                      <ChevronRight size={17} color={c.textFaint} />
                    </Pressable>
                  )
                })}
              </View>
            ) : searching ? null : msg ? (
              <Txt variant="faint" style={{ textAlign: 'center' }}>
                {t(msg)}
              </Txt>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const s_ = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: sp.md, paddingHorizontal: sp.lg },
  tile: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 52,
    paddingHorizontal: sp.md,
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
  },
  card: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: sp.md, paddingVertical: 11 },
  pin: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
})
