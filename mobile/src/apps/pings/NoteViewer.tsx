// Full-screen view of a hand-drawn note (migration 112). Opens from the note's
// card on the Home: the sheet floats in over a dimmed screen, with who sent
// it and when, and — for one sent to me — the same "Got it" as any nudge.
// "Save" downloads the PNG and opens the system share sheet, whose "Save
// Image" (iOS) / save-to-gallery (Android) puts it in the photos — the same
// route the printables use, so no photo-library module is needed.
/* eslint-disable @typescript-eslint/no-require-imports -- expo-sharing loaded lazily (older binaries) */
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Animated, Modal, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { Download, ThumbsUp, X } from 'lucide-react-native'
import { File, Paths } from 'expo-file-system'

import { Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { APP_GRADIENT } from '@/components/home/palette'
import { useI18n } from '@/hooks/useI18n'
import { haptic } from '@/apps/games/feedback'
import { fonts, sp } from '@/theme/theme'

export function NoteViewer({
  url,
  title,
  sub,
  onClose,
  onGotIt,
}: {
  url: string
  title: string
  sub: string
  onClose: () => void
  /** Present for a note sent to me: acknowledges it and closes. */
  onGotIt?: () => void
}) {
  const { t } = useI18n()
  const insets = useSafeAreaInsets()
  const [pop] = useState(() => new Animated.Value(0))
  const [saving, setSaving] = useState(false)
  async function save() {
    if (saving) return
    setSaving(true)
    try {
      const sharing = require('expo-sharing') as typeof import('expo-sharing')
      const res = await fetch(url)
      if (!res.ok) throw new Error(String(res.status))
      const file = new File(Paths.cache, `recado-${Date.now()}.png`)
      if (file.exists) file.delete()
      file.create()
      file.write(new Uint8Array(await res.arrayBuffer()))
      haptic('light')
      await sharing.shareAsync(file.uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: t('notes.save') })
    } catch {
      Alert.alert(t('notes.saveFailed'))
    }
    setSaving(false)
  }
  // The sheet takes the note's own shape, as big as the space allows.
  const [ratio, setRatio] = useState(0.72)
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  const onBox = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout
    setBox({ w: width, h: height })
  }
  const sheetSize = box ? (box.w / box.h > ratio ? { width: box.h * ratio, height: box.h } : { width: box.w, height: box.w / ratio }) : null
  useEffect(() => {
    haptic('light')
    Animated.spring(pop, {
      toValue: 1,
      useNativeDriver: true,
      damping: 15,
      stiffness: 150,
    }).start()
  }, [pop])

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View
        style={[
          styles.backdrop,
          {
            paddingTop: insets.top + sp.sm,
            paddingBottom: insets.bottom + sp.md,
          },
        ]}
      >
        <View style={styles.head}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt style={styles.title} numberOfLines={1}>
              {title}
            </Txt>
            <Txt style={styles.sub} numberOfLines={1}>
              {sub}
            </Txt>
          </View>
          <Pressable
            onPress={() => void save()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('notes.save')}
            style={styles.saveBtn}
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Download size={17} color="#fff" strokeWidth={2.4} />}
            <Txt style={{ color: '#fff', fontFamily: fonts.semibold, fontSize: 14.5 }}>{t('notes.save')}</Txt>
          </Pressable>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.close')} style={styles.close}>
            <X size={20} color="#fff" />
          </Pressable>
        </View>

        <View
          style={{
            flex: 1,
            marginHorizontal: sp.lg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onLayout={onBox}
        >
          {sheetSize ? (
            <Animated.View
              style={[
                styles.sheet,
                sheetSize,
                {
                  opacity: pop,
                  transform: [
                    {
                      scale: pop.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.86, 1],
                      }),
                    },
                    {
                      rotate: pop.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['-4deg', '-1deg'],
                      }),
                    },
                  ],
                },
              ]}
            >
              <Image
                source={{ uri: url }}
                style={{ flex: 1 }}
                contentFit="contain"
                transition={180}
                accessibilityLabel={title}
                onLoad={(e) => e.source.width && e.source.height && setRatio(e.source.width / e.source.height)}
              />
            </Animated.View>
          ) : null}
        </View>

        {onGotIt ? (
          <Pressable
            onPress={() => {
              haptic('success')
              onGotIt()
            }}
            accessibilityRole="button"
            accessibilityLabel={t('pings.gotIt')}
            style={{ alignSelf: 'stretch', marginHorizontal: sp.lg }}
          >
            <GradientBox colors={APP_GRADIENT.pings} radius={22} style={styles.gotIt}>
              <ThumbsUp size={18} strokeWidth={2.4} color="#fff" />
              <Txt
                style={{
                  color: '#fff',
                  fontFamily: fonts.semibold,
                  fontSize: 16.5,
                }}
              >
                {t('pings.gotIt')}
              </Txt>
            </GradientBox>
          </Pressable>
        ) : null}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20,16,12,0.92)', gap: sp.lg },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    paddingHorizontal: sp.lg,
  },
  title: { color: '#fff', fontFamily: fonts.display, fontSize: 22 },
  sub: { color: 'rgba(255,255,255,0.7)', fontSize: 14, marginTop: 2 },
  saveBtn: {
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  close: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: {
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#FFFBF2',
  },
  gotIt: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
})
