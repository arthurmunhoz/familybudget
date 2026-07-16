// The info rows for a member (rendered inside Family's card, in a scroll view so
// only the rows scroll). Every filled member_profiles field gets a related icon;
// the phone row has a call button — but NOT on your own card. Long-pressing a
// measured field (height/weight/shoe) or blood type opens the conversion sheet.
import { Linking, Pressable, View } from 'react-native'
import {
  AlertTriangle,
  Cake,
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

// Which fields support the long-press conversion / compatibility sheet.
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
}

export function MemberDetails({
  member,
  profile,
  isMe,
  onConvert,
}: {
  member: Member
  profile: MemberProfile | undefined
  isMe: boolean
  onConvert: (kind: ConvertKind, raw: string, label: string) => void
}) {
  const { t } = useI18n()
  const { c } = useTheme()
  const today = todayISO()
  const age = ageOf(profile?.birthday ?? null, today)

  const items: Item[] = []
  if (profile?.birthday) {
    items.push({
      icon: Cake,
      label: t('family.birthday'),
      value:
        formatDay(profile.birthday) + (age != null ? ` · ${t('family.yrs', { years: age })}` : ''),
    })
  }
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

  if (items.length === 0) {
    return <Txt variant="muted">{t('family.empty')}</Txt>
  }

  const anyConvertible = items.some((it) => it.convert)

  return (
    <View>
      {anyConvertible ? (
        <Txt variant="faint" style={{ marginBottom: 4 }}>
          {t('family.convertHint')}
        </Txt>
      ) : null}
      {items.map((it, i) => {
        const Icon = it.icon
        return (
          <Pressable
            key={it.label}
            onLongPress={
              it.convert ? () => onConvert(it.convert!.kind, it.convert!.raw, it.label) : undefined
            }
            delayLongPress={300}
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
            <Txt
              style={{ flex: 1, fontSize: 14, fontWeight: '500', textAlign: 'right' }}
              numberOfLines={2}
            >
              {it.value}
            </Txt>
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
          </Pressable>
        )
      })}
    </View>
  )
}
