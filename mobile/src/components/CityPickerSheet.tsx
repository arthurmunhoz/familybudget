// Bottom sheet for picking the home city, opened from the Hub's Today card when
// no city is set yet ("Set city"). The keyboard comes up with it so you can type
// straight away — the point is to set a city in one tap without a trip to
// Settings. Settings' Weather section still owns the fuller job (seeing current
// conditions, changing the city, removing it).
//
// Keyboard: the sheet sits ON TOP of the keyboard, with the lift MEASURED the
// way PetForm does it — compare the root's height now against its height with
// no keyboard and make up only what the platform didn't. This used to be a
// KeyboardAvoidingView, iOS-only, on the assumption that Android shrinks the
// modal's window by itself; under edge-to-edge it doesn't, and the whole sheet
// (field included) stayed behind the keyboard.
import { useEffect, useRef, useState } from 'react'
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  type TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MapPin, X } from 'lucide-react-native'

import { Field, Txt } from './ui'
import { useI18n } from '../hooks/useI18n'
import { useBottomGap } from '../hooks/useBottomGap'
import { useKeyboardHeight } from '../hooks/useKeyboardHeight'
import { radius, sp, useTheme } from '../theme/theme'
import { saveHomeLocation, searchCities, type HomeLocation } from '../lib/weather'
import type { TKey } from '../lib/i18n'

export function CityPickerSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n()
  const { c } = useTheme()
  const bottomGap = useBottomGap(sp.xl)
  const insets = useSafeAreaInsets()
  const win = useWindowDimensions()
  const kb = useKeyboardHeight()
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

  // How much of the modal the keyboard covers. Android reports the keyboard's
  // height ABOVE the navigation bar, but this edge-to-edge modal draws behind
  // that bar, so the keyboard's top edge is a nav bar higher still; iOS's
  // height is already measured from the screen's bottom edge. Whatever the
  // window itself gave up for the keyboard (`absorbed`) is subtracted, so a
  // device that does resize the modal doesn't get lifted twice.
  const [rootH, setRootH] = useState(0)
  const [restH, setRestH] = useState(0) // root height with no keyboard up
  const available = rootH || win.height
  const absorbed = restH ? Math.max(0, restH - available) : 0
  // Android's navigation bar, whatever the user has it set to (3 buttons,
  // gesture pill, hidden = 0). The sheet sits ABOVE it rather than padding its
  // content clear of it, so the bar never draws over the sheet itself. iOS's
  // home indicator is an overlay, so there the sheet keeps reaching the edge.
  const navBar = Platform.OS === 'android' ? insets.bottom : 0
  const covered = kb > 0 ? kb + navBar : 0
  const lift = Math.max(navBar, covered - absorbed)

  async function pick(loc: HomeLocation) {
    await saveHomeLocation(loc)
    onSaved()
  }

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
      <View
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height
          setRootH(h)
          if (kb === 0) setRestH(h)
        }}
      >
        <View
          style={{
            // Against what the keyboard leaves, so the sheet never grows
            // behind it.
            maxHeight: (available - lift) * 0.88,
            marginBottom: lift,
            backgroundColor: c.sheet,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: sp.lg,
              paddingTop: sp.lg,
              paddingBottom: sp.sm,
            }}
          >
            <Txt variant="h2">{t('settings.homeCity')}</Txt>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t('common.close')}>
              <X size={22} color={c.textMuted} />
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
              // iOS: clear the home indicator, except while the keyboard is up
              // (the sheet sits on it then). Android: the sheet is already
              // above the navigation bar or the keyboard, so just a margin.
              paddingBottom: kb > 0 || Platform.OS === 'android' ? sp.lg : bottomGap,
              gap: sp.md,
            }}
            keyboardShouldPersistTaps="handled"
          >
            <Field
              value={query}
              onChangeText={setQuery}
              placeholder={t('settings.cityPlaceholder')}
              ref={inputRef}
              autoFocus
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={() => {
                if (suggestions[0]) void pick(suggestions[0])
              }}
            />

            {suggestions.length > 0 ? (
              <View
                style={{
                  borderRadius: radius.md,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: c.border,
                  overflow: 'hidden',
                }}
              >
                {suggestions.map((s, i) => (
                  <Pressable
                    key={`${s.lat},${s.lon}`}
                    onPress={() => void pick(s)}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: sp.sm,
                      paddingHorizontal: sp.md,
                      paddingVertical: 12,
                      backgroundColor: pressed ? c.cardActive : c.card,
                      borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                      borderTopColor: c.border,
                    })}
                  >
                    <MapPin size={14} color={c.textMuted} />
                    <Txt numberOfLines={1} style={{ flex: 1 }}>
                      {s.city}
                    </Txt>
                  </Pressable>
                ))}
              </View>
            ) : searching ? (
              <Txt variant="faint">{t('settings.searchingCity')}</Txt>
            ) : msg ? (
              <Txt variant="faint">{t(msg)}</Txt>
            ) : (
              <Txt variant="faint">{t('settings.homeCityHint')}</Txt>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}
