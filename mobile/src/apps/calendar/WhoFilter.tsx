// "Whose events" in the Calendar's Day view (2026-11): one button ("Showing:
// Everyone ▾") instead of a row of chips, so a big family with long names still
// fits. The sheet has the written views — Everyone (me included), My
// events — and then each other member as a checkbox:
// pick one or several to see only theirs. Ticking a person leaves the written
// views; picking a written view clears the people.
import { useState } from 'react'
import { Modal, ScrollView, StyleSheet, View } from 'react-native'
import { Check, ChevronDown, Users } from 'lucide-react-native'

import { APP_GRADIENT } from '@/components/home/palette'
import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useI18n } from '@/hooks/useI18n'
import { fonts, radius, sp, useTheme } from '@/theme/theme'

/** ['all'] | ['me'] | the emails of the members picked */
export type WhoSel = string[]
const PRESETS = ['all', 'me'] as const
/** Calendar red — the button reads as a control, not a caption (owner, 2026-11-25). */
const TINT = APP_GRADIENT.calendar[1]

export interface WhoMember {
  email: string
  name: string
  color: string
}

const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n

export function WhoFilter({
  value,
  members,
  onChange,
}: {
  value: WhoSel
  /** everyone but me */
  members: WhoMember[]
  onChange: (v: WhoSel) => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const bottomGap = useBottomGap(sp.lg)
  const [open, setOpen] = useState(false)

  const preset = value.length === 1 && (PRESETS as readonly string[]).includes(value[0]) ? value[0] : null
  const picked = preset ? [] : value
  const presetLabel = { all: t('calendar.filterAll'), me: t('calendar.filterMine') }
  const label = preset
    ? presetLabel[preset as keyof typeof presetLabel]
    : picked.length <= 2
      ? picked.map((e) => firstName(members.find((m) => m.email === e)?.name ?? e)).join(` ${t('home.and')} `)
      : t('calendar.filterPeopleCount', { n: picked.length })
  const dots = preset ? [] : members.filter((m) => picked.includes(m.email)).slice(0, 3)
  // anything but "everyone" hides events → the button is filled so it's obvious
  const filtered = preset !== 'all'

  function toggle(email: string) {
    const next = picked.includes(email) ? picked.filter((e) => e !== email) : [...picked, email]
    onChange(next.length ? next : ['all'])
  }

  const presetHint = { all: t('calendar.filterAllHint'), me: t('calendar.filterMineHint') }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${t('calendar.filterShowing')}: ${label}`}
        style={({ pressed }) => [
          s.btn,
          filtered
            ? { backgroundColor: TINT, borderColor: TINT }
            : { backgroundColor: TINT + '14', borderColor: TINT + '8C' },
          { opacity: pressed ? 0.75 : 1 },
        ]}
      >
        <Users size={16} color={filtered ? '#fff' : TINT} strokeWidth={2.2} />
        <Txt style={{ fontSize: 13.5, fontFamily: fonts.body, color: filtered ? 'rgba(255,255,255,0.85)' : c.textMuted }}>
          {t('calendar.filterShowing')}
        </Txt>
        {dots.map((m) => (
          <View key={m.email} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: m.color, borderWidth: 1, borderColor: '#fff' }} />
        ))}
        <Txt numberOfLines={1} style={{ flexShrink: 1, fontSize: 14.5, fontFamily: fonts.semibold, color: filtered ? '#fff' : c.text }}>
          {label}
        </Txt>
        <View style={[s.chev, { backgroundColor: filtered ? 'rgba(255,255,255,0.25)' : TINT }]}>
          <ChevronDown size={14} color="#fff" strokeWidth={2.8} />
        </View>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: c.sheet,
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
              paddingTop: sp.sm,
              paddingBottom: bottomGap,
              maxHeight: '80%',
            }}
          >
            <View style={{ alignItems: 'center', paddingBottom: sp.sm }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: c.border }} />
            </View>
            <Txt style={{ fontFamily: fonts.semibold, fontSize: 16, textAlign: 'center', paddingBottom: sp.sm }}>
              {t('calendar.filterTitle')}
            </Txt>
            <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: sp.lg }}>
              {PRESETS.map((p, i) => {
                const on = preset === p
                return (
                  <Pressable
                    key={p}
                    onPress={() => {
                      onChange([p])
                      setOpen(false)
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    style={({ pressed }) => [s.row, { borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: c.border, opacity: pressed ? 0.6 : 1 }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Txt style={{ fontSize: 16, color: on ? c.accent : c.text, fontFamily: on ? fonts.semibold : fonts.body }}>
                        {presetLabel[p]}
                      </Txt>
                      <Txt variant="faint" style={{ fontSize: 12.5 }}>
                        {presetHint[p]}
                      </Txt>
                    </View>
                    {on ? <Check size={18} color={c.accent} strokeWidth={2.5} /> : null}
                  </Pressable>
                )
              })}

              {members.length ? (
                <Txt style={[s.section, { color: c.textMuted }]}>{t('calendar.filterPeople')}</Txt>
              ) : null}
              {members.map((m, i) => {
                const on = picked.includes(m.email)
                return (
                  <Pressable
                    key={m.email}
                    onPress={() => toggle(m.email)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    style={({ pressed }) => [s.row, { borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: c.border, opacity: pressed ? 0.6 : 1 }]}
                  >
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: m.color, marginRight: sp.md }} />
                    <Txt numberOfLines={1} style={{ flex: 1, fontSize: 16, color: c.text, fontFamily: on ? fonts.semibold : fonts.body }}>
                      {m.name}
                    </Txt>
                    <View
                      style={[
                        s.box,
                        on ? { backgroundColor: c.accent, borderColor: c.accent } : { borderColor: c.textFaint },
                      ]}
                    >
                      {on ? <Check size={14} color="#fff" strokeWidth={3} /> : null}
                    </View>
                  </Pressable>
                )
              })}
            </ScrollView>
            {picked.length ? (
              <Pressable
                onPress={() => setOpen(false)}
                accessibilityRole="button"
                style={({ pressed }) => [s.done, { backgroundColor: c.accent, opacity: pressed ? 0.8 : 1 }]}
              >
                <Txt style={{ color: '#fff', fontFamily: fonts.semibold, fontSize: 15.5 }}>{t('calendar.filterDone')}</Txt>
              </Pressable>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  )
}

const s = StyleSheet.create({
  btn: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 38,
    paddingLeft: 13,
    paddingRight: 5,
    borderRadius: 19,
    borderWidth: 1.5,
  },
  chev: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginLeft: 2 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingVertical: 6 },
  section: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginTop: sp.lg,
    marginBottom: 2,
  },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  done: { marginHorizontal: sp.lg, marginTop: sp.md, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
})
