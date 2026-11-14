// The assistant answering about One Roof itself (`app_help`, 2026-11): the
// model's short answer, then — for the games — the real rules from the app's
// own strings (never the model's words) and a way to open Games; for Plus,
// several families and Roof, a button to the screen that explains it.
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { BellRing, ChevronDown, ChevronRight, House, Ship } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import { Headline } from './AnswerViews'
import { GradientBox } from './GradientBox'
import type { Gradient } from './palette'

type Game = 'hangman' | 'battleship' | 'quiz'

const GAMES: { id: Game; name: TKey; icon: typeof House; colors: Gradient; rules: TKey[] }[] = [
  {
    id: 'hangman',
    name: 'games.hangman',
    icon: House,
    colors: ['#FB923C', '#EA580C'],
    rules: ['games.how.step1', 'games.how.step2', 'games.how.step3', 'games.how.pointGuess', 'games.how.pointHouse', 'games.how.swap'],
  },
  {
    id: 'battleship',
    name: 'games.battleship',
    icon: Ship,
    colors: ['#38BDF8', '#2563EB'],
    rules: ['games.bs.how1', 'games.bs.how2', 'games.bs.howAim', 'games.bs.howHit', 'games.bs.howMiss', 'games.bs.howWin'],
  },
  {
    id: 'quiz',
    name: 'games.quiz',
    icon: BellRing,
    colors: ['#A78BFA', '#7C3AED'],
    rules: ['games.quiz.how1', 'games.quiz.howFirst', 'games.quiz.how2', 'games.quiz.howWrong', 'games.quiz.howWin'],
  },
]

const LINK: Record<string, { label: TKey; route: string }> = {
  plus: { label: 'ask.helpSeePlus', route: '/paywall' },
  families: { label: 'ask.helpFamilies', route: '/families' },
  roof: { label: 'ask.helpRoof', route: '/settings' },
  casa: { label: 'ask.helpCasa', route: '/casa-mode' },
}

export function HelpView({ topic, text, onOpen }: { topic: string; text: string; onOpen: (route: string) => void }) {
  const { c } = useTheme()
  const { t } = useI18n()
  const one = GAMES.find((g) => g.id === topic)
  const [open, setOpen] = useState<Game | null>(one?.id ?? null)
  const isGames = topic === 'games' || !!one
  const link = LINK[topic]

  return (
    <View style={{ gap: sp.md }}>
      {text ? <Headline text={text} /> : null}
      {isGames ? (
        <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
          {(one ? [one] : GAMES).map((g, i) => {
            const expanded = open === g.id
            return (
              <View key={g.id} style={i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border } : null}>
                <Pressable
                  onPress={() => setOpen(expanded ? null : g.id)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  style={({ pressed }) => [s.row, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <GradientBox colors={g.colors} radius={11} style={s.tile}>
                    <g.icon size={18} color="#fff" />
                  </GradientBox>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt style={{ fontFamily: fonts.semibold, color: c.text }}>{t(g.name)}</Txt>
                    {expanded ? null : (
                      <Txt variant="faint" style={{ fontSize: 12.5 }}>
                        {t('ask.helpSeeRules')}
                      </Txt>
                    )}
                  </View>
                  {expanded ? <ChevronDown size={18} color={c.textFaint} /> : <ChevronRight size={18} color={c.textFaint} />}
                </Pressable>
                {expanded ? (
                  <View style={s.rules}>
                    {g.rules.map((k, n) => (
                      <View key={k} style={{ flexDirection: 'row', gap: sp.sm }}>
                        <View style={[s.num, { backgroundColor: g.colors[0] + '2E' }]}>
                          <Txt style={{ fontSize: 11.5, fontFamily: fonts.semibold, color: g.colors[1] }}>{n + 1}</Txt>
                        </View>
                        <Txt style={{ flex: 1, fontSize: 14.5, lineHeight: 20, color: c.text }}>{t(k)}</Txt>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            )
          })}
        </View>
      ) : null}
      {isGames || link ? (
        <Pressable
          onPress={() => onOpen(isGames ? '/games' : link.route)}
          accessibilityRole="button"
          style={({ pressed }) => [s.open, { backgroundColor: c.action, opacity: pressed ? 0.85 : 1 }]}
        >
          <Txt style={{ color: c.onAction, fontFamily: fonts.semibold, fontSize: 15 }}>{t(isGames ? 'ask.openGames' : link.label)}</Txt>
        </Pressable>
      ) : null}
    </View>
  )
}

const s = StyleSheet.create({
  card: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: sp.md, paddingVertical: 12 },
  tile: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  rules: { paddingHorizontal: sp.md, paddingBottom: sp.md, gap: 10 },
  num: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginTop: -1 },
  open: { height: 48, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
})
