// Birthday page for one family member (/family/birthday?email=…), opened from
// the birthday row or the "turns N in X days" card on Family.
//
//   • Countdown to the next birthday + the age being turned.
//   • On-device facts (lib/birthday.ts): days of life and the next thousand-day
//     milestone, sign, the moon that night, generation. (Birthstone and birth
//     flower were tried and dropped, 2026-11 — filler next to the rest.)
//   • Their birth YEAR (lib/birthYear.ts, bundled data — no network): the
//     main events of that year and famous people born in it. Per DAY was
//     tried first and swapped for the year at the user's request (2026-11):
//     "what was the world like when you were born" tells a better story.
//
// Event text is Wikipedia's (CC BY-SA): keep the credit line, and every item
// opens its article.
import { useMemo, type ReactNode } from 'react'
import { View } from 'react-native'
import { Pressable } from '@/components/Pressable'
import { useLocalSearchParams } from 'expo-router'
import { Image } from 'expo-image'
import * as WebBrowser from 'expo-web-browser'
import { ChevronRight } from 'lucide-react-native'

import { AppHeader, Card, Screen, Txt } from '@/components/ui'
import { Skeleton } from '@/components/Skeleton'
import { BirthdayCake } from '@/components/BirthdayCake'
import { useAuth } from '@/lib/auth'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import { useToday } from '@/hooks/useToday'
import type { TKey } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import type { MemberProfile } from '@/lib/types'
import {
  MOON_EMOJI,
  ZODIAC_EMOJI,
  daysAlive,
  generation,
  moonPhase,
  nextBirthday,
  nextMilestone,
  zodiacSign,
} from '@/lib/birthday'
import { birthYearFacts, type YearEvent, type YearPerson } from '@/lib/birthYear'
import { fonts, radius, sp, useTheme } from '@/theme/theme'

const LOCALE: Record<string, string> = { en: 'en-US', es: 'es-ES', pt: 'pt-BR' }

function dateFmt(isoDate: string, locale: string, opts: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(locale, opts)
}

export default function Birthday() {
  const { c } = useTheme()
  const { t, lang } = useI18n()
  const { profiles } = useAuth()
  const today = useToday()
  const { email } = useLocalSearchParams<{ email: string }>()
  const locale = LOCALE[lang] ?? 'en-US'

  const member = profiles.find((p) => p.email === email)
  const { data: profile, loading } = useCachedQuery<MemberProfile | null>(`family:birthday:${email}`, async () => {
    const { data } = await supabase.from('member_profiles').select('*').eq('email', email).maybeSingle()
    return (data as MemberProfile | null) ?? null
  })
  const birth = profile?.birthday ?? null

  const facts = useMemo(() => {
    if (!birth) return null
    const year = Number(birth.slice(0, 4))
    return {
      year,
      next: nextBirthday(birth, today),
      alive: daysAlive(birth, today),
      milestone: nextMilestone(birth, today),
      sign: zodiacSign(birth),
      moon: moonPhase(birth),
      gen: generation(year),
    }
  }, [birth, today])

  const name = member?.display_name ?? ''
  const first = name.trim().split(/\s+/)[0] ?? ''
  const header = <AppHeader title={t('birthday.title')} />

  if (loading && !profile) {
    return (
      <Screen scroll header={header}>
        <PageSkeleton />
      </Screen>
    )
  }
  if (!birth || !facts) {
    return (
      <Screen header={header}>
        <Txt variant="muted">{t('birthday.none', { name: first })}</Txt>
      </Screen>
    )
  }

  const { next, year } = facts
  const isToday = next.inDays === 0
  const num = (n: number) => n.toLocaleString(locale)
  const world = birthYearFacts(year, lang)

  return (
    <Screen scroll header={header}>
      <View style={{ gap: sp.md }}>
        {/* Countdown — the app's own glass card and a drawn cake (the user
            found the 🎂 emoji on an orange gradient "too generic"). */}
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: sp.md }}>
          <BirthdayCake size={92} candles={Math.min(5, Math.max(1, Math.round(next.turning / 10)))} />
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Txt style={{ fontFamily: fonts.display, fontSize: 24, lineHeight: 29, color: c.text }}>
              {isToday
                ? t('birthday.turnsToday', { name: first, age: next.turning })
                : t('birthday.turns', { name: first, age: next.turning })}
            </Txt>
            <Txt style={{ color: c.accent, fontSize: 15, fontFamily: fonts.semibold }}>
              {isToday ? t('birthday.today') : t('birthday.inDays', { count: next.inDays })}
            </Txt>
            {!isToday ? (
              <Txt variant="muted" style={{ fontSize: 13 }}>
                {dateFmt(next.date, locale, { weekday: 'long', day: 'numeric', month: 'long' })}
              </Txt>
            ) : null}
          </View>
        </Card>
        <Txt variant="faint" style={{ fontSize: 12, marginTop: -sp.xs, paddingHorizontal: sp.xs }}>
          {t('birthday.born')}:{' '}
          {dateFmt(birth, locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </Txt>

        {/* Days of life + milestone */}
        <View style={{ flexDirection: 'row', gap: sp.md }}>
          <Stat label={t('birthday.daysAlive')} value={num(facts.alive)} />
          <Stat
            label={t('birthday.milestone')}
            value={num(facts.milestone.days)}
            sub={dateFmt(facts.milestone.date, locale, { day: 'numeric', month: 'short', year: 'numeric' })}
          />
        </View>

        {/* On-device facts */}
        <Card style={{ gap: 0, paddingVertical: sp.xs }}>
          <FactRow emoji={ZODIAC_EMOJI[facts.sign]} label={t('birthday.sign')} value={t(`zodiac.${facts.sign}` as TKey)} />
          <FactRow emoji={MOON_EMOJI[facts.moon]} label={t('birthday.moon')} value={t(`moon.${facts.moon}` as TKey)} />
          <FactRow emoji="👥" label={t('birthday.generation')} value={t(`gen.${facts.gen}` as TKey)} last />
        </Card>

        {/* The year they were born */}
        {world.events.length ? (
          <Section title={t('birthday.thatYear', { year })}>
            {world.events.map((e, i) => (
              <EventRow key={i} event={e} first={i === 0} />
            ))}
          </Section>
        ) : null}

        {world.people.length ? (
          <Section title={t('birthday.bornThatYear', { year })}>
            {world.people.map((p, i) => (
              <PersonRow key={`${p.name}-${i}`} person={p} first={i === 0} />
            ))}
          </Section>
        ) : null}

        {world.events.length || world.people.length ? (
          <Txt variant="faint" style={{ textAlign: 'center', fontSize: 11 }}>
            {t('birthday.source')}
          </Txt>
        ) : null}
      </View>
    </Screen>
  )
}

/** The whole page while the member's profile loads — same blocks, same sizes
 *  (countdown, two stats, the facts card). */
function PageSkeleton() {
  return (
    <View style={{ gap: sp.md }}>
      <Skeleton style={{ height: 124, borderRadius: radius.lg }} />
      <View style={{ flexDirection: 'row', gap: sp.md }}>
        <Skeleton style={{ flex: 1, height: 84, borderRadius: radius.lg }} />
        <Skeleton style={{ flex: 1, height: 84, borderRadius: radius.lg }} />
      </View>
      <Card style={{ gap: 0, paddingVertical: sp.xs }}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingVertical: 12 }}>
            <Skeleton style={{ width: 24, height: 24, borderRadius: 12 }} />
            <Skeleton style={{ width: 90, height: 12 }} />
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Skeleton style={{ width: 80, height: 14 }} />
            </View>
          </View>
        ))}
      </Card>
    </View>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const { c } = useTheme()
  return (
    <Card style={{ flex: 1, gap: 2 }}>
      <Txt variant="faint" style={{ fontSize: 12 }}>
        {label}
      </Txt>
      <Txt style={{ fontFamily: fonts.display, fontSize: 24, color: c.text }}>{value}</Txt>
      {sub ? (
        <Txt variant="faint" style={{ fontSize: 12 }}>
          {sub}
        </Txt>
      ) : null}
    </Card>
  )
}

function FactRow({ emoji, label, value, last }: { emoji: string; label: string; value: string; last?: boolean }) {
  const { c } = useTheme()
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: sp.md,
        paddingVertical: 11,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.border,
      }}
    >
      <Txt style={{ fontSize: 20, width: 28, textAlign: 'center' }}>{emoji}</Txt>
      <Txt style={{ color: c.textMuted, fontSize: 14 }}>{label}</Txt>
      <Txt style={{ flex: 1, textAlign: 'right', fontSize: 15, fontFamily: fonts.semibold }} numberOfLines={1}>
        {value}
      </Txt>
    </View>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card style={{ gap: 0, paddingVertical: sp.sm }}>
      <Txt variant="label" style={{ textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: sp.xs }}>
        {title}
      </Txt>
      {children}
    </Card>
  )
}

const open = (url: string | null) => (url ? () => void WebBrowser.openBrowserAsync(url) : undefined)

/** Commons serves drawings (logos, flags, symbols) as .svg.png / .png and
 *  photos as .jpg. Cropping a logo to fill a square cut "The Simpsons" down to
 *  "e Simpso", so graphics are shown WHOLE, inset on a light tile, and only
 *  photos fill the frame. */
function isGraphic(uri: string): boolean {
  return /\.(svg\.png|png|gif)(\?|$)/i.test(uri)
}

function Thumb({ uri }: { uri: string }) {
  const graphic = isGraphic(uri)
  return (
    <View
      style={{
        width: 56,
        height: 56,
        borderRadius: 12,
        overflow: 'hidden',
        // Light even in dark mode: logos are drawn for a white page.
        backgroundColor: graphic ? '#FFFFFF' : 'transparent',
        padding: graphic ? 6 : 0,
      }}
    >
      <Image
        source={{ uri }}
        style={{ width: '100%', height: '100%' }}
        contentFit={graphic ? 'contain' : 'cover'}
        contentPosition={graphic ? 'center' : { top: '20%' }}
        transition={150}
      />
    </View>
  )
}

/** One of the year's events: its picture (a free Commons image, see the
 *  build script) beside the text, which already leads with its date
 *  ("January 7 – …"). Text-only rows read as a wall, so the picture leads. */
function EventRow({ event, first }: { event: YearEvent; first: boolean }) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={open(event.url)}
      disabled={!event.url}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: sp.md,
        paddingVertical: 10,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: c.border,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {event.photo ? (
        <Thumb uri={event.photo} />
      ) : (
        <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: c.accentSoft }} />
      )}
      <Txt style={{ flex: 1, fontSize: 14, lineHeight: 20 }} numberOfLines={4}>
        {event.text}
      </Txt>
      {event.url ? <ChevronRight size={16} color={c.textFaint} /> : null}
    </Pressable>
  )
}

/** A famous person born the same year: photo, name, one-line description. */
function PersonRow({ person, first }: { person: YearPerson; first: boolean }) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={open(person.url)}
      disabled={!person.url}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: sp.md,
        paddingVertical: 9,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: c.border,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View
        style={{
          width: 46,
          height: 46,
          borderRadius: 23,
          overflow: 'hidden',
          backgroundColor: c.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {person.photo ? (
          <Image
            source={{ uri: person.photo }}
            style={{ width: '100%', height: '100%' }}
            contentFit="cover"
            contentPosition={{ top: '15%' }}
            transition={150}
          />
        ) : (
          <Txt style={{ fontFamily: fonts.display, fontSize: 18, color: c.textMuted }}>
            {person.name.charAt(0)}
          </Txt>
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={{ fontSize: 15, fontFamily: fonts.semibold }} numberOfLines={1}>
          {person.name}
        </Txt>
        {person.desc ? (
          <Txt variant="faint" numberOfLines={1} style={{ fontSize: 12 }}>
            {person.desc}
          </Txt>
        ) : null}
      </View>
      {person.url ? <ChevronRight size={16} color={c.textFaint} /> : null}
    </Pressable>
  )
}
