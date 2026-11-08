// A member's info, laid straight onto the page under the photo (2026-11 redo, in
// the Home's language — no wrapping card). Birthday is a gradient card like the
// Home's "Today" cards; phone is a row with a call button (NOT on your own
// profile); the short measured fields are stat tiles in a two-column grid, each
// with its own gradient icon; allergies/notes are text blocks. A measured field
// (height/weight/shoe) or blood type opens the conversion / compatibility sheet
// on tap — only when the stored value is actually parseable (canConvert), so
// legacy unit-less free text just isn't tappable.
import { Linking, StyleSheet, View } from 'react-native'
import { Pressable } from '@/components/Pressable'
import {
  AlertTriangle,
  ChevronRight,
  CircleHelp,
  Droplet,
  Footprints,
  Phone,
  PersonStanding,
  Ruler,
  Scale,
  Shirt,
  StickyNote,
  type LucideIcon,
} from 'lucide-react-native'

import { formatPhone, formatDay, todayISO } from '@/lib/format'
import { useI18n } from '@/hooks/useI18n'
import { useTheme, sp, fonts } from '@/theme/theme'
import { BirthdayCake } from '@/components/BirthdayCake'
import { GradientBox } from '@/components/home/GradientBox'
import { APP_GRADIENT, CARD_GRADIENT, type Gradient } from '@/components/home/palette'
import { Txt } from '@/components/ui'
import type { MemberProfile } from '@/lib/types'
import { ageOf, FIELDS, type Member } from './familyShared'
import { canConvert, displayValue, type ConvertKind } from './units'
import { MemberToday } from './MemberToday'

// iOS Phone-app green, so the call button reads as "call" at a glance.
const CALL_GREEN = '#34C759'

// Each field gets its own icon AND its own colour, like the Home's app grid —
// so the page scans by colour instead of being a column of identical tiles.
export const FIELD_LOOK: Partial<Record<keyof MemberProfile, { icon: LucideIcon; colors: Gradient }>> = {
  phone: { icon: Phone, colors: APP_GRADIENT.budget },
  blood_type: { icon: Droplet, colors: APP_GRADIENT.calendar },
  height: { icon: Ruler, colors: APP_GRADIENT.location },
  weight: { icon: Scale, colors: APP_GRADIENT.pings },
  shoe_size: { icon: Footprints, colors: APP_GRADIENT.pets },
  pants_size: { icon: PersonStanding, colors: APP_GRADIENT.calc },
  shirt_size: { icon: Shirt, colors: APP_GRADIENT.family },
  allergies: { icon: AlertTriangle, colors: APP_GRADIENT.shopping },
  notes: { icon: StickyNote, colors: APP_GRADIENT.docs },
}

// Which fields get the conversion / compatibility sheet.
const CONVERT_KIND: Partial<Record<keyof MemberProfile, ConvertKind>> = {
  height: 'height',
  weight: 'weight',
  shoe_size: 'shoe',
  blood_type: 'blood',
}

// Free-text fields read as paragraphs, not tiles.
const LONG: (keyof MemberProfile)[] = ['allergies', 'notes']

interface Item {
  key: keyof MemberProfile
  icon: LucideIcon
  colors: Gradient
  label: string
  value: string
  convert?: { kind: ConvertKind; raw: string }
}

export function IconTile({ Icon, colors, size = 34 }: { Icon: LucideIcon; colors: Gradient; size?: number }) {
  return (
    <GradientBox
      colors={colors}
      radius={size * 0.32}
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon size={size * 0.5} color="#fff" strokeWidth={2.2} />
    </GradientBox>
  )
}

function Kicker({ text }: { text: string }) {
  const { c } = useTheme()
  return (
    <Txt
      style={{
        fontFamily: fonts.semibold,
        fontSize: 12,
        letterSpacing: 1.1,
        textTransform: 'uppercase',
        color: c.textMuted,
        marginTop: sp.sm,
      }}
    >
      {text}
    </Txt>
  )
}

export function MemberDetails({
  member,
  profile,
  isMe,
  onConvert,
  onBirthday,
}: {
  member: Member
  profile: MemberProfile | undefined
  isMe: boolean
  onConvert: (kind: ConvertKind, raw: string, label: string) => void
  /** Tapping the birthday card opens the Birthday page. */
  onBirthday?: () => void
}) {
  const { t } = useI18n()
  const { c } = useTheme()
  const today = todayISO()
  const age = ageOf(profile?.birthday ?? null, today)

  const items: Item[] = []
  for (const [key, labelKey] of FIELDS) {
    const v = profile?.[key]
    if (!v) continue
    const raw = String(v)
    const kind = CONVERT_KIND[key]
    const look = FIELD_LOOK[key] ?? { icon: StickyNote, colors: APP_GRADIENT.docs }
    items.push({
      key,
      icon: look.icon,
      colors: look.colors,
      label: t(labelKey),
      value: key === 'phone' ? formatPhone(raw) : kind === 'shoe' ? displayValue('shoe', raw) : raw,
      ...(kind && canConvert(kind, raw) ? { convert: { kind, raw } } : {}),
    })
  }

  const birthday = profile?.birthday ?? null
  if (items.length === 0 && !birthday) {
    return (
      <View style={{ gap: sp.md }}>
        <MemberToday email={member.email} firstName={member.display_name.trim().split(/\s+/)[0]} />
        <Txt variant="muted">{t('family.empty')}</Txt>
      </View>
    )
  }

  const phone = items.find((it) => it.key === 'phone')
  const stats = items.filter((it) => it.key !== 'phone' && !LONG.includes(it.key))
  const longs = items.filter((it) => LONG.includes(it.key))
  const rawPhone = profile?.phone ? String(profile.phone) : ''

  function call() {
    const dialable = rawPhone.trim().replace(/[^\d+]/g, '')
    if (dialable) void Linking.openURL(`tel:${dialable}`)
  }

  // Tiles sit on the page itself, so they need their own surface — opaque and
  // shadow-free (an Android `elevation` under a translucent fill smears).
  const tile = {
    backgroundColor: c.card,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
  }

  return (
    <View style={{ gap: sp.md }}>
      {birthday ? (
        <Pressable
          onPress={onBirthday}
          disabled={!onBirthday}
          accessibilityRole="button"
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
        >
          <GradientBox
            colors={CARD_GRADIENT.birthday}
            radius={24}
            style={{ padding: 18, flexDirection: 'row', alignItems: 'center', gap: sp.md }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12.5, fontFamily: fonts.semibold, letterSpacing: 0.6, textTransform: 'uppercase' }}>
                {t('family.birthday')}
              </Txt>
              <Txt style={{ color: '#fff', fontFamily: fonts.display, fontSize: 24, lineHeight: 29, marginTop: 4 }} numberOfLines={1}>
                {formatDay(birthday)}
              </Txt>
              {age != null ? (
                <Txt style={{ color: 'rgba(255,255,255,0.9)', fontSize: 14, fontFamily: fonts.semibold, marginTop: 2 }}>
                  {t('family.yrs', { years: age })}
                </Txt>
              ) : null}
              {onBirthday ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: sp.sm }}>
                  <Txt style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12.5, flexShrink: 1 }} numberOfLines={1}>
                    {t('birthday.tapForFacts')}
                  </Txt>
                  <ChevronRight size={14} color="rgba(255,255,255,0.8)" />
                </View>
              ) : null}
            </View>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
              <BirthdayCake size={48} />
            </View>
          </GradientBox>
        </Pressable>
      ) : null}

      <MemberToday email={member.email} firstName={member.display_name.trim().split(/\s+/)[0]} />

      {phone ? (
        <View style={[tile, { flexDirection: 'row', alignItems: 'center', gap: sp.md, padding: 14 }]}>
          <IconTile Icon={phone.icon} colors={phone.colors} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt style={{ color: c.textMuted, fontSize: 12.5 }}>{phone.label}</Txt>
            <Txt style={{ fontSize: 17, fontFamily: fonts.semibold, marginTop: 1 }} numberOfLines={1}>
              {phone.value}
            </Txt>
          </View>
          {!isMe ? (
            <Pressable
              onPress={call}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`${t('family.call')} ${member.display_name}`}
              style={({ pressed }) => ({
                height: 40,
                paddingHorizontal: 16,
                borderRadius: 20,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                backgroundColor: CALL_GREEN,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Phone size={15} color="#fff" strokeWidth={2.4} />
              <Txt style={{ color: '#fff', fontFamily: fonts.semibold, fontSize: 14.5 }}>{t('family.call')}</Txt>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {stats.length ? (
        <>
          <Kicker text={t('family.measures')} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.md }}>
            {stats.map((it) => {
              const onTile = it.convert ? () => onConvert(it.convert!.kind, it.convert!.raw, it.label) : undefined
              return (
                <Pressable
                  key={it.key}
                  onPress={onTile}
                  disabled={!onTile}
                  accessibilityRole={onTile ? 'button' : undefined}
                  accessibilityLabel={onTile ? `${t('family.fieldDetails')}: ${it.label}` : undefined}
                  style={({ pressed }) => [
                    tile,
                    {
                      flexBasis: '45%',
                      flexGrow: 1,
                      padding: 12,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <IconTile Icon={it.icon} colors={it.colors} size={36} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt style={{ fontFamily: fonts.display, fontSize: 19, lineHeight: 23 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                      {it.value}
                    </Txt>
                    <Txt style={{ color: c.textMuted, fontSize: 12 }} numberOfLines={1}>
                      {it.label}
                    </Txt>
                  </View>
                  {onTile ? (
                    <CircleHelp size={15} color={c.textFaint} style={{ position: 'absolute', top: 8, right: 8 }} />
                  ) : null}
                </Pressable>
              )
            })}
          </View>
        </>
      ) : null}

      {longs.map((it) => (
        <View key={it.key} style={{ gap: sp.sm }}>
          <Kicker text={it.label} />
          <View style={[tile, { flexDirection: 'row', gap: sp.md, padding: 14 }]}>
            <IconTile Icon={it.icon} colors={it.colors} size={32} />
            <Txt style={{ flex: 1, fontSize: 15, lineHeight: 21, paddingTop: 5 }}>{it.value}</Txt>
          </View>
        </View>
      ))}
    </View>
  )
}
