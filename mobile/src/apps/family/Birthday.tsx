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
import { StyleSheet, View } from 'react-native'
import { Pressable } from '@/components/Pressable'
import { useLocalSearchParams } from 'expo-router'
import { Image } from 'expo-image'
import * as WebBrowser from 'expo-web-browser'
import { ChevronRight, Flag, HeartPulse, type LucideIcon } from 'lucide-react-native'

import { AppHeader, Screen, Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { APP_GRADIENT, CARD_GRADIENT, type Gradient } from '@/components/home/palette'
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
import { fonts, sp, useTheme } from '@/theme/theme'

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
        {/* Countdown — a gradient card like the Home's "Today" cards, with the
            drawn cake on a glass disc (the 🎂 emoji read "too generic"). */}
        <GradientBox colors={CARD_GRADIENT.birthday} radius={28} style={{ padding: 20, flexDirection: 'row', alignItems: 'center', gap: sp.md }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt style={styles.onKicker} numberOfLines={1}>
              {isToday ? t('birthday.today') : dateFmt(next.date, locale, { weekday: 'long', day: 'numeric', month: 'long' })}
            </Txt>
            <Txt style={{ fontFamily: fonts.display, fontSize: 27, lineHeight: 32, color: '#fff', marginTop: 4 }}>
              {isToday
                ? t('birthday.turnsToday', { name: first, age: next.turning })
                : t('birthday.turns', { name: first, age: next.turning })}
            </Txt>
            {!isToday ? (
              <View style={styles.onPill}>
                <Txt style={{ color: '#fff', fontFamily: fonts.semibold, fontSize: 14 }}>
                  {t('birthday.inDays', { count: next.inDays })}
                </Txt>
              </View>
            ) : null}
          </View>
          <View style={styles.cakeDisc}>
            <BirthdayCake size={70} candles={Math.min(5, Math.max(1, Math.round(next.turning / 10)))} />
          </View>
        </GradientBox>
        <Txt variant="faint" style={{ fontSize: 12.5, paddingHorizontal: sp.xs }}>
          {t('birthday.born')}:{' '}
          {dateFmt(birth, locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </Txt>

        {/* Days of life + milestone */}
        <View style={{ flexDirection: 'row', gap: sp.md }}>
          <Stat Icon={HeartPulse} colors={APP_GRADIENT.calendar} label={t('birthday.daysAlive')} value={num(facts.alive)} />
          <Stat
            Icon={Flag}
            colors={APP_GRADIENT.pings}
            label={t('birthday.milestone')}
            value={num(facts.milestone.days)}
            sub={dateFmt(facts.milestone.date, locale, { day: 'numeric', month: 'short', year: 'numeric' })}
          />
        </View>

        {/* On-device facts */}
        <View style={{ flexDirection: 'row', gap: sp.md }}>
          <Fact emoji={ZODIAC_EMOJI[facts.sign]} label={t('birthday.sign')} value={t(`zodiac.${facts.sign}` as TKey)} />
          <Fact emoji={MOON_EMOJI[facts.moon]} label={t('birthday.moon')} value={t(`moon.${facts.moon}` as TKey)} />
          <Fact emoji="👥" label={t('birthday.generation')} value={t(`gen.${facts.gen}` as TKey)} />
        </View>

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

/** The page's surface for tiles and lists — opaque card + hairline, no
 *  elevation (Android smears it under a translucent fill). */
function useTile() {
  const { c } = useTheme()
  return { backgroundColor: c.card, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border }
}

/** The whole page while the member's profile loads — same blocks, same sizes
 *  (countdown, two stats, three facts). */
function PageSkeleton() {
  return (
    <View style={{ gap: sp.md }}>
      <Skeleton style={{ height: 150, borderRadius: 28 }} />
      <View style={{ flexDirection: 'row', gap: sp.md }}>
        <Skeleton style={{ flex: 1, height: 116, borderRadius: 20 }} />
        <Skeleton style={{ flex: 1, height: 116, borderRadius: 20 }} />
      </View>
      <View style={{ flexDirection: 'row', gap: sp.md }}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} style={{ flex: 1, height: 108, borderRadius: 20 }} />
        ))}
      </View>
    </View>
  )
}

function Stat({ Icon, colors, label, value, sub }: { Icon: LucideIcon; colors: Gradient; label: string; value: string; sub?: string }) {
  const { c } = useTheme()
  const tile = useTile()
  return (
    <View style={[tile, { flex: 1, padding: 14, gap: 10 }]}>
      <GradientBox colors={colors} radius={10} style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={16} color="#fff" strokeWidth={2.2} />
      </GradientBox>
      <View>
        <Txt style={{ fontFamily: fonts.display, fontSize: 24, lineHeight: 29, color: c.text }} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Txt>
        <Txt style={{ color: c.textMuted, fontSize: 12.5 }} numberOfLines={2}>
          {label}
          {sub ? ` · ${sub}` : ''}
        </Txt>
      </View>
    </View>
  )
}

function Fact({ emoji, label, value }: { emoji: string; label: string; value: string }) {
  const { c } = useTheme()
  const tile = useTile()
  return (
    <View style={[tile, { flex: 1, padding: 12, gap: 8 }]}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
        <Txt style={{ fontSize: 19 }}>{emoji}</Txt>
      </View>
      <View>
        <Txt style={{ fontFamily: fonts.semibold, fontSize: 14.5, lineHeight: 18 }} numberOfLines={2}>
          {value}
        </Txt>
        <Txt style={{ color: c.textMuted, fontSize: 11.5, marginTop: 2 }} numberOfLines={1}>
          {label}
        </Txt>
      </View>
    </View>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { c } = useTheme()
  const tile = useTile()
  return (
    <View style={{ gap: sp.sm, marginTop: sp.sm }}>
      <Txt style={[styles.kicker, { color: c.textMuted }]}>{title}</Txt>
      <View style={[tile, { paddingHorizontal: 14, paddingVertical: 4 }]}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  kicker: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase', paddingHorizontal: sp.xs },
  onKicker: { color: 'rgba(255,255,255,0.85)', fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase' },
  onPill: {
    alignSelf: 'flex-start',
    marginTop: sp.md,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  cakeDisc: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
})

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
