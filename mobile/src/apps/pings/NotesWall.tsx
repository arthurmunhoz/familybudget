// "Recados" — the wall where hand-drawn notes live after they leave the Home
// (migration 113, owner 2026-11-15: a note used to be saved to the camera roll
// or lost). Sheets of paper taped to a wall, newest first; a heart keeps one
// for good. "New note" comes first (the Nudges screen's card opens THIS page,
// carrying the recipients picked there in `to`), then the wall with its
// filters: all / received / sent / kept. Tap a sheet → NoteViewer.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { Image } from 'expo-image'
import { ChevronLeft, Heart, Plus } from 'lucide-react-native'

import { Loader, Screen, Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { APP_GRADIENT } from '@/components/home/palette'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import { useAuth } from '@/lib/auth'
import { fetchWall, onNotesChange, removeNote, type Wall, type WallNote } from '@/lib/notes'
import { usePlus } from '@/lib/plus'
import { getSignedUrls } from '@/lib/signedUrls'
import { fonts, sp, useTheme } from '@/theme/theme'
import { NoteViewer } from './NoteViewer'
import { NoteArt } from './PingComposer'

type Filter = 'all' | 'received' | 'sent' | 'kept'
const FILTERS: Filter[] = ['all', 'received', 'sent', 'kept']
const PAPER = '#FFFBF2'
const TAPES = ['#F6C7B8', '#BFE0D4', '#F5E0A3', '#CBD3F2']
// A sheet's tilt and tape colour come from its id, so they never change
// between visits.
const seed = (id: string) => id.charCodeAt(0) + id.charCodeAt(id.length - 1)
const tilt = (id: string) => [-1.6, 1.1, -0.7, 1.7][seed(id) % 4]

const firstName = (n: string) => n.trim().split(/\s+/)[0]

export default function NotesWall() {
  const { c } = useTheme()
  const { t, lang } = useI18n()
  const { profile, profiles } = useAuth()
  const { isPlus } = usePlus()
  const { width } = useWindowDimensions()
  const me = profile?.email
  const { to } = useLocalSearchParams<{ to?: string }>()
  const draw = () => router.push({ pathname: '/draw-note', params: { to: typeof to === 'string' ? to : '' } })
  const { data, revalidate } = useCachedQuery<Wall>(`notes:wall:${profile?.household_id ?? ''}`, fetchWall)
  useFocusEffect(useCallback(() => void revalidate(), [revalidate]))
  useEffect(() => onNotesChange(() => void revalidate()), [revalidate])

  const [filter, setFilter] = useState<Filter>('all')
  const [viewing, setViewing] = useState<WallNote | null>(null)
  const [urls, setUrls] = useState<Record<string, string>>({})

  const favs = useMemo(() => new Set(data?.favs ?? []), [data])
  const notes = useMemo(() => {
    const all = data?.notes ?? []
    if (filter === 'received') return all.filter((n) => n.sender_email !== me)
    if (filter === 'sent') return all.filter((n) => n.sender_email === me)
    if (filter === 'kept') return all.filter((n) => favs.has(n.id))
    return all
  }, [data, filter, me, favs])

  const paths = (data?.notes ?? []).map((n) => n.image_path).join('|')
  useEffect(() => {
    const missing = paths ? paths.split('|').filter((p) => !urls[p]) : []
    if (!missing.length) return
    let alive = true
    void getSignedUrls(missing).then((m) => alive && setUrls((prev) => ({ ...prev, ...m })))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `urls` is the cache this effect fills
  }, [paths])

  const nameOf = useCallback(
    (email: string) => firstName(profiles.find((p) => p.email === email)?.display_name || email.split('@')[0]),
    [profiles],
  )
  const when = useCallback(
    (iso: string) => new Date(iso).toLocaleDateString(lang, { day: 'numeric', month: 'short' }),
    [lang],
  )
  const who = (n: WallNote) => (n.sender_email === me ? t('notes.wall.fromMe') : t('notes.wall.from', { name: nameOf(n.sender_email) }))

  const cols = width >= 760 ? 4 : 2
  const gap = sp.md
  const sheetW = (Math.min(width, 1100) - sp.lg * 2 - gap * (cols - 1)) / cols
  const total = data?.notes.length ?? 0
  const blue = APP_GRADIENT.pings

  return (
    <>
      <Screen
        scroll
        header={
          <View style={{ flexDirection: 'row', paddingVertical: sp.sm }}>
            <Pressable
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/pings'))}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('common.back')}
              style={({ pressed }) => [s.round, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}
            >
              <ChevronLeft size={22} color={c.text} />
            </Pressable>
          </View>
        }
      >
        <View style={{ gap: sp.lg, paddingBottom: sp.xxl }}>
          <View>
            <Txt style={{ fontFamily: fonts.display, fontSize: 36, lineHeight: 42, letterSpacing: -0.8, color: c.text }}>
              {t('notes.wall.title')}
            </Txt>
            <Txt style={{ fontFamily: fonts.display, fontSize: 20, lineHeight: 26, color: c.textFaint }}>
              {total === 0 ? t('notes.wall.none') : total === 1 ? t('notes.wall.one') : t('notes.wall.count', { n: String(total) })}
            </Txt>
          </View>

          {/* First thing on the page: draw a new one. */}
          <Pressable onPress={draw} accessibilityRole="button" accessibilityLabel={t('notes.wall.new')} style={({ pressed }) => ({ opacity: pressed ? 0.88 : 1 })}>
            <GradientBox colors={['#F8EBD6', '#EDD7B4']} radius={26} style={s.newCard}>
              <NoteArt size={84} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt style={{ fontFamily: fonts.display, fontSize: 22, lineHeight: 26, color: '#2B2521' }}>{t('notes.wall.new')}</Txt>
                <Txt style={{ fontSize: 14, lineHeight: 19, color: '#6B5E52', marginTop: 2 }}>{t('notes.wall.newSub')}</Txt>
              </View>
              <View style={s.plus}>
                <Plus size={22} color="#FFFBF2" strokeWidth={2.6} />
              </View>
            </GradientBox>
          </Pressable>

          {total > 0 ? (
            <Txt style={[s.label, { color: c.textMuted }]}>{t('notes.wall.section')}</Txt>
          ) : null}

          {total > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm }}>
              {FILTERS.map((f) => {
                const on = filter === f
                return (
                  <Pressable
                    key={f}
                    onPress={() => setFilter(f)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    style={[
                      s.chip,
                      { borderColor: on ? blue[1] : c.border, backgroundColor: on ? blue[1] + '1F' : c.card },
                    ]}
                  >
                    {f === 'kept' ? <Heart size={14} color={on ? blue[1] : c.textMuted} fill={on ? blue[1] : 'transparent'} /> : null}
                    <Txt style={{ fontFamily: fonts.semibold, fontSize: 14, color: on ? blue[1] : c.textMuted }}>
                      {t(`notes.wall.f.${f}`)}
                    </Txt>
                  </Pressable>
                )
              })}
            </View>
          ) : null}

          {!data ? (
            <Loader />
          ) : total === 0 ? (
            <View style={{ alignItems: 'center', gap: 6, paddingVertical: sp.xl }}>
              <Txt variant="h2" style={{ textAlign: 'center' }}>
                {t('notes.wall.emptyTitle')}
              </Txt>
              <Txt variant="muted" style={{ textAlign: 'center' }}>
                {t('notes.wall.emptyHint')}
              </Txt>
            </View>
          ) : notes.length === 0 ? (
            <Txt variant="muted" style={{ textAlign: 'center', paddingVertical: sp.xl }}>
              {filter === 'kept' ? t('notes.wall.noKept') : t('notes.wall.noneHere')}
            </Txt>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap, rowGap: sp.lg }}>
              {notes.map((n) => {
                const url = urls[n.image_path]
                return (
                  <Pressable
                    key={n.id}
                    onPress={() => setViewing(n)}
                    accessibilityRole="button"
                    accessibilityLabel={`${who(n)}, ${when(n.created_at)}`}
                    style={({ pressed }) => [{ width: sheetW, gap: 8, opacity: pressed ? 0.85 : 1 }]}
                  >
                    <View style={[s.sheet, { height: sheetW / 0.78, transform: [{ rotate: `${tilt(n.id)}deg` }] }]}>
                      {url ? <Image source={{ uri: url, cacheKey: n.image_path }} style={StyleSheet.absoluteFill} contentFit="cover" transition={160} /> : null}
                      <View style={[s.tape, { backgroundColor: TAPES[seed(n.id) % TAPES.length] }]} />
                      {favs.has(n.id) ? (
                        <View style={s.heart}>
                          <Heart size={14} color="#E4554A" fill="#E4554A" />
                        </View>
                      ) : null}
                    </View>
                    <View style={{ paddingHorizontal: 2 }}>
                      <Txt numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 14, color: c.text }}>
                        {who(n)}
                      </Txt>
                      <Txt numberOfLines={1} style={{ fontSize: 12.5, color: c.textMuted }}>
                        {when(n.created_at)}
                      </Txt>
                    </View>
                  </Pressable>
                )
              })}
            </View>
          )}

          {total > 0 && data?.canFavorite ? (
            <Txt variant="faint" style={{ textAlign: 'center', fontSize: 13, lineHeight: 18 }}>
              {isPlus ? t('notes.wall.keepPlus') : t('notes.wall.keepFree')}
            </Txt>
          ) : null}
        </View>
      </Screen>

      {viewing && urls[viewing.image_path] ? (
        <NoteViewer
          url={urls[viewing.image_path]}
          pingId={viewing.id}
          title={viewing.sender_email === me ? t('notes.youDrew') : t('notes.drew', { name: nameOf(viewing.sender_email) })}
          sub={when(viewing.created_at)}
          onClose={() => setViewing(null)}
          remove={{ mine: viewing.sender_email === me, run: () => removeNote(viewing, me) }}
        />
      ) : null}
    </>
  )
}

const s = StyleSheet.create({
  round: { width: 40, height: 40, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  newCard: { flexDirection: 'row', alignItems: 'center', gap: sp.md, borderRadius: 26, padding: sp.md, minHeight: 112 },
  plus: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#2B2521', alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 12.5, fontFamily: fonts.semibold, letterSpacing: 1, textTransform: 'uppercase', marginBottom: -sp.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1.5 },
  sheet: {
    borderRadius: 10,
    backgroundColor: PAPER,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60,40,20,0.14)',
  },
  tape: { position: 'absolute', top: -2, alignSelf: 'center', width: 54, height: 16, borderRadius: 2, opacity: 0.9, transform: [{ rotate: '-3deg' }] },
  heart: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
