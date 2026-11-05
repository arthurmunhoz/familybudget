// The info rows for a member (rendered inside Family's card, in a scroll view so
// only the rows scroll). Every filled member_profiles field gets a related icon;
// the phone row has a call button — but NOT on your own card. A measured field
// (height/weight/shoe) or blood type gets a "?" button next to its value that
// opens the conversion / compatibility sheet — only when the stored value is
// actually parseable (canConvert), so legacy unit-less free text just has no "?".
import { Linking, View } from 'react-native'
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
import { useTheme, sp } from '@/theme/theme'
import { BirthdayCake } from '@/components/BirthdayCake'
import { Txt } from '@/components/ui'
import type { MemberProfile } from '@/lib/types'
import { ageOf, FIELDS, type Member } from './familyShared'
import { canConvert, displayValue, type ConvertKind } from './units'

// iOS Phone-app green, so the call button reads as "call" at a glance.
const CALL_GREEN = '#34C759'

const FIELD_ICON: Partial<Record<keyof MemberProfile, LucideIcon>> = {
  phone: Phone,
  blood_type: Droplet,
  height: Ruler,
  weight: Scale,
  shoe_size: Footprints,
  pants_size: PersonStanding,
  shirt_size: Shirt,
  allergies: AlertTriangle,
  notes: StickyNote,
}

// Which fields get the "?" → conversion / compatibility sheet.
const CONVERT_KIND: Partial<Record<keyof MemberProfile, ConvertKind>> = {
  height: 'height',
  weight: 'weight',
  shoe_size: 'shoe',
  blood_type: 'blood',
}

interface Item {
  icon: LucideIcon
  label: string
  value: string
  phone?: string
  convert?: { kind: ConvertKind; raw: string }
  /** Whole row opens something (birthday → the Birthday page). */
  onPress?: () => void
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
  /** Tapping the birthday row opens the Birthday page. */
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
    items.push({
      icon: FIELD_ICON[key] ?? StickyNote,
      label: t(labelKey),
      value:
        key === 'phone'
          ? formatPhone(raw)
          : kind === 'shoe'
            ? displayValue('shoe', raw)
            : raw,
      ...(key === 'phone' ? { phone: raw } : {}),
      ...(kind && canConvert(kind, raw) ? { convert: { kind, raw } } : {}),
    })
  }

  function call(rawPhone: string) {
    const dialable = rawPhone.trim().replace(/[^\d+]/g, '')
    if (dialable) void Linking.openURL(`tel:${dialable}`)
  }

  if (items.length === 0 && !profile?.birthday) {
    return <Txt variant="muted">{t('family.empty')}</Txt>
  }

  const birthday = profile?.birthday ?? null

  return (
    <View>
      {/* Birthday: one row that is both the field and the way into the
          Birthday page (merged from a separate "Alex turns 40" card above the
          info, at the user's request). */}
      {birthday ? (
        <Pressable
          onPress={onBirthday}
          disabled={!onBirthday}
          accessibilityRole="button"
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: sp.md,
            paddingVertical: 14,
            borderBottomWidth: items.length ? 1 : 0,
            borderBottomColor: c.border,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <BirthdayCake size={52} />
          {/* Label, then the date as the headline, then the invitation. The
              countdown ("turns 40 in 228 days") lives on the Birthday page —
              the user wanted the row to state the field, not the statistic. */}
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <Txt style={{ color: c.textMuted, fontSize: 13 }}>{t('family.birthday')}</Txt>
            <Txt style={{ color: c.text, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>
              {formatDay(birthday)}
              {age != null ? ` · ${t('family.yrs', { years: age })}` : ''}
            </Txt>
            {onBirthday ? (
              <Txt style={{ color: c.accent, fontSize: 12, fontWeight: '600' }} numberOfLines={1}>
                {t('birthday.tapForFacts')}
              </Txt>
            ) : null}
          </View>
          {onBirthday ? <ChevronRight size={16} color={c.accent} /> : null}
        </Pressable>
      ) : null}

      {items.map((it, i) => {
        const Icon = it.icon
        // The whole row is the target — the birthday row opens the Birthday
        // page, and a convertible field (the "?") opens its conversion sheet.
        // The "?" alone was a 22pt target, too small to hit reliably.
        const onRow =
          it.onPress ?? (it.convert ? () => onConvert(it.convert!.kind, it.convert!.raw, it.label) : undefined)
        const Row = onRow ? Pressable : View
        return (
          <Row
            key={it.label}
            onPress={onRow}
            accessibilityRole={onRow ? 'button' : undefined}
            accessibilityLabel={it.convert ? `${t('family.fieldDetails')}: ${it.label}` : undefined}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: sp.md,
              paddingVertical: 10,
              borderBottomWidth: i < items.length - 1 ? 1 : 0,
              borderBottomColor: c.border,
            }}
          >
            <View
              style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: c.surface,
              }}
            >
              <Icon size={16} color={c.accent} />
            </View>
            <Txt style={{ color: c.textMuted, fontSize: 13 }}>{it.label}</Txt>
            {/* Value and its "?" ride together, right-aligned, so the button sits
                against the value rather than drifting to the row's edge. */}
            <View
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: 6,
              }}
            >
              <Txt
                style={{ flexShrink: 1, fontSize: 14, fontWeight: '500', textAlign: 'right' }}
                numberOfLines={2}
              >
                {it.value}
              </Txt>
              {it.convert ? (
                // Just the cue now — the row itself handles the tap.
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: c.accentSoft,
                  }}
                >
                  <CircleHelp size={14} color={c.accent} />
                </View>
              ) : null}
            </View>
            {it.phone && !isMe ? (
              <Pressable
                onPress={() => call(it.phone!)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`${t('family.call')} ${member.display_name}`}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  alignItems: 'center',
                  justifyContent: 'center',
                  // iOS Phone-app green (soft tint + vivid glyph), not the clay accent.
                  backgroundColor: 'rgba(52,199,89,0.16)',
                }}
              >
                <Phone size={15} color={CALL_GREEN} />
              </Pressable>
            ) : null}
            {it.onPress ? <ChevronRight size={16} color={c.textFaint} /> : null}
          </Row>
        )
      })}
    </View>
  )
}
