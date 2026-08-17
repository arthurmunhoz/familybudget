// Position a picked photo inside a circle before it's assigned — pinch to zoom,
// drag to move. Built for the pet photo (a round hero), so the crop window is a
// CIRCLE rather than the OS picker's square "Move and Scale": what you frame is
// exactly what the app will show.
//
// The whole photo stays visible, dimmed, outside the circle — you're aiming, so
// you need to see what you're cutting off. That's two copies of the same image
// under one animated transform: the dim one on the stage, the bright one inside
// a clipped circular view.
//
// Geometry: `base` scales the image so it just COVERS the circle, `scale` is the
// user's zoom on top of that (>= 1, so the circle is never left uncovered), and
// the pan is clamped to whatever slack that leaves. The crop rect is then that
// same circle mapped back into source pixels — see `cropRect`.
//
// Gestures inside a RN <Modal> need their own <GestureHandlerRootView>: the
// app-root one doesn't reach a modal's separate native hierarchy (same note as
// DraggableList).
import { useState } from 'react'
import { Modal, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'

import { Btn, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { sp, useTheme } from '@/theme/theme'

/** Longest edge of the image we hand back — matches the pet photo upload. */
const OUTPUT_PX = 512
const MAX_ZOOM = 5

export interface CroppedPhoto {
  uri: string
  base64: string
}

function clamp(v: number, lo: number, hi: number): number {
  'worklet'
  return Math.min(Math.max(v, lo), hi)
}

/** The crop square in SOURCE pixels for a given zoom/pan.
 *
 *  `circle / (base * scale)` is the circle's diameter measured in source
 *  pixels; the origin is the image's centre less half of that, shifted back by
 *  the pan (which is in screen px, hence the same divisor). Exported for the
 *  arithmetic to be readable — it's the one part of this file that can be wrong
 *  in a way a screenshot won't show.
 */
export function cropRect(
  imgW: number,
  imgH: number,
  circle: number,
  base: number,
  scale: number,
  tx: number,
  ty: number,
) {
  const px = base * scale
  const size = Math.min(circle / px, imgW, imgH)
  const originX = clamp(imgW / 2 - size / 2 - tx / px, 0, Math.max(0, imgW - size))
  const originY = clamp(imgH / 2 - size / 2 - ty / px, 0, Math.max(0, imgH - size))
  return {
    originX: Math.round(originX),
    originY: Math.round(originY),
    width: Math.round(size),
    height: Math.round(size),
  }
}

export function PhotoCropper({
  uri,
  width,
  height,
  onCancel,
  onDone,
}: {
  uri: string
  /** Source pixel dimensions, straight off the picker asset. */
  width: number
  height: number
  onCancel: () => void
  onDone: (photo: CroppedPhoto) => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const insets = useSafeAreaInsets()
  const win = useWindowDimensions()
  const [busy, setBusy] = useState(false)

  // The circle, and the stage the dimmed photo lives on.
  const circle = Math.min(win.width - sp.lg * 2, win.height * 0.46)
  const stageH = Math.min(win.height * 0.6, circle + 160)
  // Cover the circle: the smaller edge of the image spans the diameter.
  const base = Math.max(circle / width, circle / height)
  const dispW = width * base
  const dispH = height * base

  const scale = useSharedValue(1)
  const savedScale = useSharedValue(1)
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const savedTx = useSharedValue(0)
  const savedTy = useSharedValue(0)

  /** How far the image may slide before the circle would show through. */
  const slack = (s: number) => {
    'worklet'
    return { x: Math.max(0, (dispW * s - circle) / 2), y: Math.max(0, (dispH * s - circle) / 2) }
  }

  /** Ease the photo back until it covers the circle again, and commit that as
   *  the resting position — `saved*` is what the crop is computed from, so it
   *  must never hold an out-of-bounds value. */
  const settle = () => {
    'worklet'
    const s = slack(scale.value)
    const nx = clamp(tx.value, -s.x, s.x)
    const ny = clamp(ty.value, -s.y, s.y)
    savedTx.value = nx
    savedTy.value = ny
    tx.value = withTiming(nx, { duration: 120 })
    ty.value = withTiming(ny, { duration: 120 })
  }

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      tx.value = savedTx.value + e.translationX
      ty.value = savedTy.value + e.translationY
    })
    .onEnd(settle)

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = clamp(savedScale.value * e.scale, 1, MAX_ZOOM)
    })
    .onEnd(() => {
      savedScale.value = scale.value
      settle()
    })

  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }))

  async function use() {
    if (busy) return
    setBusy(true)
    try {
      // The COMMITTED position, not the live one: a settle animation may still
      // be running, in which case tx/ty are mid-flight and saved* is the truth.
      const rect = cropRect(
        width,
        height,
        circle,
        base,
        savedScale.value,
        savedTx.value,
        savedTy.value,
      )
      const ctx = ImageManipulator.manipulate(uri).crop(rect).resize({ width: OUTPUT_PX })
      const ref = await ctx.renderAsync()
      const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true })
      if (!out.base64) throw new Error('no base64')
      onDone({ uri: out.uri, base64: out.base64 })
    } catch {
      // Framing failed for this image — hand back the untouched original rather
      // than dropping the photo the user just picked.
      onDone({ uri, base64: '' })
    }
    setBusy(false)
  }

  // Both copies are laid out centred on the same point, so one transform frames
  // both: the dim one on the stage, the bright one inside the clipped circle.
  const centred = {
    position: 'absolute' as const,
    width: dispW,
    height: dispH,
  }

  return (
    <Modal visible animationType="fade" onRequestClose={onCancel}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
          <View style={{ paddingHorizontal: sp.lg, paddingVertical: sp.md, gap: 2 }}>
            <Txt variant="title">{t('pets.cropTitle')}</Txt>
            <Txt variant="muted">{t('pets.cropHint')}</Txt>
          </View>

          <GestureDetector gesture={Gesture.Simultaneous(pan, pinch)}>
            <View
              style={{
                height: stageH,
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
            >
              {/* The whole photo, dimmed — what you're cutting off. */}
              <Animated.View
                style={[
                  { ...centred, left: (win.width - dispW) / 2, top: (stageH - dispH) / 2 },
                  imageStyle,
                ]}
                pointerEvents="none"
              >
                <Image
                  source={{ uri }}
                  style={{ width: '100%', height: '100%', opacity: 0.28 }}
                  contentFit="fill"
                />
              </Animated.View>

              {/* The crop, bright, clipped to the circle. */}
              <View
                style={{
                  width: circle,
                  height: circle,
                  borderRadius: circle / 2,
                  overflow: 'hidden',
                  borderWidth: 2,
                  borderColor: c.accent,
                }}
              >
                <Animated.View
                  style={[
                    { ...centred, left: (circle - dispW) / 2, top: (circle - dispH) / 2 },
                    imageStyle,
                  ]}
                  pointerEvents="none"
                >
                  <Image
                    source={{ uri }}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="fill"
                  />
                </Animated.View>
              </View>
            </View>
          </GestureDetector>

          <View
            style={{
              marginTop: 'auto',
              padding: sp.lg,
              paddingBottom: insets.bottom + sp.lg,
              gap: sp.md,
            }}
          >
            <Btn title={t('pets.cropUse')} onPress={use} loading={busy} />
            <Btn title={t('common.cancel')} variant="ghost" onPress={onCancel} />
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  )
}
