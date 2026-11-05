// Discount: the original price on a PRICE TAG; pick a discount and the tag
// does what a shop's does — the original gets struck through (animated) and
// the sale price appears under it, with a "−20%" sticker and a green "you save"
// line. Under the tag, kept quiet: − / + around the % (type it for any value)
// and text-only quick picks.
// (2026-11 redesign: the old screen was an input, a row of chips and a
// separate "You pay" card, which read as a form rather than a price.)
import { useEffect, useRef, useState } from 'react'
import { Animated, StyleSheet, TextInput, View, type LayoutChangeEvent } from 'react-native'
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg'
import { Minus, Pencil, Plus, Tag } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { formatMoney } from '@/lib/format'
import { fonts, sp, useTheme } from '@/theme/theme'

import { num } from './shared'

const CHIPS = [10, 15, 20, 30, 50]
const TAG_H = 196
const NOTCH = 34 // width of the tag's pointed end

/** The tag, after a classic shop tag: a coloured card with a pointed end,
 *  white stitching inset from the edge, a white grommet and a looped brown
 *  string. Colour is the scheme's ACTION colour (deep enough for white text);
 *  a soft diagonal sheen keeps it from looking flat. The string loops into
 *  the LOOP gutter left of the tip, so the SVG is wider than the tag. */
const LOOP = 34

function TagShape({ width, fill }: { width: number; fill: string }) {
  const w = width
  const h = TAG_H
  const x0 = LOOP // the tip
  const n = x0 + NOTCH // where the straight edges start
  const r = 16
  const body = (i: number) =>
    `M ${n + i * 0.5} ${1 + i} H ${w - r - i} Q ${w - 1 - i} ${1 + i} ${w - 1 - i} ${r + i} V ${h - r - i} Q ${w - 1 - i} ${h - 1 - i} ${w - r - i} ${h - 1 - i} H ${n + i * 0.5} L ${x0 + 1 + i * 1.4} ${h / 2} Z`
  const hx = n - 4
  const hy = h / 2
  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.16} />
          <Stop offset="0.55" stopColor="#FFFFFF" stopOpacity={0} />
          <Stop offset="1" stopColor="#000000" stopOpacity={0.12} />
        </LinearGradient>
      </Defs>
      <Path d={body(0)} fill={fill} />
      <Path d={body(0)} fill="url(#sheen)" />
      {/* stitching */}
      <Path
        d={body(9)}
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity={0.9}
        strokeWidth={2}
        strokeDasharray="7 6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* string: a loop out of the grommet, back over the tip */}
      <Path
        d={`M ${hx - 2} ${hy - 4} C ${hx - 30} ${hy - 40}, ${4} ${hy - 70}, ${10} ${hy - 30} C ${14} ${hy - 4}, ${x0 + 6} ${hy + 2}, ${hx - 6} ${hy + 2}`}
        fill="none"
        stroke="#8A5A3B"
        strokeWidth={2.6}
        strokeLinecap="round"
      />
      {/* grommet */}
      <Circle cx={hx} cy={hy} r={11} fill="#FFFFFF" />
      <Circle cx={hx} cy={hy} r={11} fill="none" stroke="#000000" strokeOpacity={0.12} strokeWidth={1} />
      <Circle cx={hx} cy={hy} r={5} fill="#000000" fillOpacity={0.35} />
    </Svg>
  )
}

export function Discount() {
  const { c, dark } = useTheme()
  const { t } = useI18n()
  const [price, setPrice] = useState('')
  const [pct, setPct] = useState(20)
  const [custom, setCustom] = useState('')
  const [tagW, setTagW] = useState(0)
  const [priceW, setPriceW] = useState(0)
  // Width of the typed digits at the CURRENT size: a TextInput in a row
  // doesn't grow with its text, so "89.90" at 36pt was clipped to "9.90".
  const [digitsW, setDigitsW] = useState(0)

  const p = num(price)
  const save = (p * pct) / 100
  const final = Math.max(0, p - save)
  const hasDeal = p > 0 && pct > 0
  // In a shop the original price gets changed again and again, so it must be
  // easy to get back to: tap ANYWHERE on the tag (or the pencil) to edit it,
  // the old value comes pre-selected so typing replaces it, and while editing
  // it's shown big and un-struck — the sale price keeps updating below.
  const priceRef = useRef<TextInput>(null)
  const [editing, setEditing] = useState(false)
  const struck = hasDeal && !editing
  const strike = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(strike, { toValue: struck ? 1 : 0, duration: 260, useNativeDriver: true }).start()
  }, [struck, strike])

  // 0 → 1 as the deal appears: draws the strike line, fades the sale price in.
  const deal = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(deal, { toValue: hasDeal ? 1 : 0, duration: 320, useNativeDriver: true }).start()
  }, [hasDeal, deal])

  function pickChip(v: number) {
    setPct(v)
    setCustom('')
  }
  function onCustom(txt: string) {
    setCustom(txt)
    setPct(Math.min(100, num(txt)))
  }
  function adjust(delta: number) {
    setCustom('')
    setPct((cur) => Math.min(100, Math.max(0, Math.round(cur) + delta)))
  }

  // On the tag (an ACTION-coloured card): white text, a cream strike and a
  // cream sticker — red-on-red or the app's green would vanish here.
  const onTag = c.onAction
  const cream = '#FFE3A3'
  const ink = '#3A2416'

  return (
    <View style={{ gap: sp.lg }}>
      {/* ── The price tag ── */}
      <View
        onLayout={(e: LayoutChangeEvent) => setTagW(e.nativeEvent.layout.width)}
        // Room above for the sticker, which overhangs the tag's top edge.
        style={{
          height: TAG_H,
          transform: [{ rotate: '-1.5deg' }],
          marginTop: sp.xl,
          shadowColor: '#5A2E14',
          shadowOpacity: dark ? 0.4 : 0.14,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 8 },
        }}
      >
        {tagW ? (
          <TagShape width={tagW} fill={c.action} />
        ) : null}

        {/* the % sticker, slapped on the corner */}
        <Animated.View
          style={[
            styles.sticker,
            {
              backgroundColor: cream,
              opacity: deal,
              transform: [{ rotate: '12deg' }, { scale: deal.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
            },
          ]}
        >
          <Txt style={{ color: ink, fontFamily: fonts.display, fontSize: 18 }}>−{pct}%</Txt>
        </Animated.View>

        <Pressable
          onPress={() => priceRef.current?.focus()}
          accessible={false}
          style={{ flex: 1, paddingLeft: LOOP + NOTCH + 22, paddingRight: sp.xl, justifyContent: 'center', gap: 4 }}
        >
          <Txt variant="label" style={{ color: onTag, opacity: 0.8, textTransform: 'uppercase', letterSpacing: 0.8, fontSize: 11 }}>
            {t('calc.original')}
          </Txt>

          {/* the original price IS the input; the strike line is drawn over it */}
          <View style={{ alignSelf: 'flex-start' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Txt style={{ fontFamily: fonts.display, fontSize: struck ? 24 : 36, color: onTag, opacity: struck ? 0.75 : 1 }}>$</Txt>
              <TextInput
                ref={priceRef}
                value={price}
                onChangeText={setPrice}
                selectTextOnFocus
                onFocus={() => setEditing(true)}
                onBlur={() => setEditing(false)}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="rgba(255,255,255,0.55)"
                autoFocus
                style={{
                  width: Math.max(70, digitsW + 12),
                  paddingVertical: 0,
                  paddingHorizontal: 2,
                  fontFamily: fonts.display,
                  fontSize: struck ? 24 : 36,
                  color: onTag,
                  opacity: struck ? 0.75 : 1,
                }}
              />
              {!editing ? (
                <Pressable
                  onPress={() => priceRef.current?.focus()}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={t('calc.editPrice')}
                  style={styles.pencil}
                >
                  <Pencil size={13} color={onTag} />
                </Pressable>
              ) : null}
            </View>
            {/* invisible mirrors: the digits at the current size (sizes the
                input) and "$ + digits" at the struck size (sizes the line) */}
            <Txt
              onLayout={(e) => setDigitsW(e.nativeEvent.layout.width)}
              style={{ position: 'absolute', opacity: 0, fontFamily: fonts.display, fontSize: struck ? 24 : 36 }}
            >
              {price || '0.00'}
            </Txt>
            <Txt
              onLayout={(e) => setPriceW(e.nativeEvent.layout.width)}
              style={{ position: 'absolute', opacity: 0, fontFamily: fonts.display, fontSize: 24 }}
            >
              ${price || '0.00'}
            </Txt>
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: -4,
                top: '50%',
                width: priceW + 8,
                height: 3,
                borderRadius: 2,
                backgroundColor: cream,
                // scaleX from the LEFT: shift by half the width as it grows.
                transform: [
                  { translateX: strike.interpolate({ inputRange: [0, 1], outputRange: [-(priceW + 8) / 2, 0] }) },
                  { scaleX: strike },
                  { rotate: '-4deg' },
                ],
              }}
            />
          </View>

          {/* the sale price — mounted only with a deal, so an empty tag keeps
              the original price centred instead of a reserved blank band */}
          {hasDeal ? (
          <Animated.View
            style={{
              opacity: deal,
              transform: [{ translateY: deal.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
              gap: 6,
            }}
          >
            <Txt style={{ fontFamily: fonts.display, fontSize: 44, lineHeight: 50, color: onTag, fontVariant: ['tabular-nums'] }}>
              {formatMoney(final)}
            </Txt>
            <View style={[styles.savePill, { backgroundColor: 'rgba(255,255,255,0.18)' }]}>
              <Tag size={13} color={onTag} />
              <Txt style={{ fontSize: 13, fontFamily: fonts.semibold, color: onTag }}>
                {t('calc.savePill', { amount: formatMoney(save), pct })}
              </Txt>
            </View>
          </Animated.View>
          ) : null}
        </Pressable>
      </View>

      {/* ── Discount: deliberately quiet — the tag is the show. A − / + with
          the % in the middle (type it to set any value), then text-only quick
          picks; the active one gets a soft tint, not a filled block. ── */}
      <View style={{ alignItems: 'center', gap: sp.md, marginTop: sp.lg }}>
        <View style={styles.stepper}>
          <Pressable onPress={() => adjust(-1)} accessibilityLabel="−1%" hitSlop={8} style={[styles.stepBtn, { backgroundColor: c.sheet, borderColor: c.border }]}>
            <Minus size={18} color={c.textMuted} />
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', minWidth: 110, justifyContent: 'center' }}>
            <TextInput
              value={custom !== '' ? custom : String(pct)}
              onChangeText={onCustom}
              onFocus={() => setCustom(String(pct))}
              onBlur={() => setCustom('')}
              keyboardType="decimal-pad"
              selectTextOnFocus
              maxLength={4}
              style={{ fontFamily: fonts.display, fontSize: 34, color: c.text, textAlign: 'right', paddingVertical: 0, minWidth: 30 }}
            />
            <Txt style={{ fontFamily: fonts.display, fontSize: 22, color: c.text }}>%</Txt>
            <Txt style={{ fontSize: 13, color: c.textMuted, marginLeft: 6, letterSpacing: 1 }}>{t('calc.off')}</Txt>
          </View>
          <Pressable onPress={() => adjust(1)} accessibilityLabel="+1%" hitSlop={8} style={[styles.stepBtn, { backgroundColor: c.sheet, borderColor: c.border }]}>
            <Plus size={18} color={c.textMuted} />
          </Pressable>
        </View>

        {/* On a light track of its own: bare text straight on the wash had
            too little contrast (the wash is a saturated peach). */}
        <View style={[styles.track, { backgroundColor: c.card, borderColor: c.border }]}>
          {CHIPS.map((v) => {
            const active = pct === v
            return (
              <Pressable
                key={v}
                onPress={() => pickChip(v)}
                style={[styles.chip, active && [styles.chipOn, { backgroundColor: c.sheet }]]}
              >
                <Txt style={{ fontFamily: active ? fonts.semibold : fonts.medium, fontSize: 14, color: active ? c.accent : c.text }}>
                  {v}%
                </Txt>
              </Pressable>
            )
          })}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  sticker: {
    position: 'absolute',
    right: 10,
    top: -12,
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  pencil: {
    marginLeft: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  savePill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.lg,
  },
  stepBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#5A2E14',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  track: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
  },
  chipOn: {
    shadowColor: '#5A2E14',
    shadowOpacity: 0.12,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
})
