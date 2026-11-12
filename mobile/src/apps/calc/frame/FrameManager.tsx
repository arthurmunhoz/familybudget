// Utilities → Photo frame: the set-up screen. Where the photos come from
// (the shared family album, this device's own photos, or both), the album
// grid (add several at once, delete your own — owners any —, tag who's in
// it, "12 of 30" against the plan), this device's photos (never uploaded),
// the slideshow / night settings (per device, so the kitchen tablet and the
// living-room one can differ) and a docked "Start the frame".
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Modal, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import { router, useFocusEffect } from 'expo-router'
import {
  CalendarDays,
  Clock,
  Images,
  Layers,
  MoonStar,
  PawPrint,
  Play,
  Plus,
  Shuffle,
  Smartphone,
  Sparkles,
  Sunrise,
  Sunset,
  Timer,
  Trash2,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react-native'

import { FormSection, RowIcon, SelectRow, ToggleRow } from '@/components/form'
import { GradientBox } from '@/components/home/GradientBox'
import { Pressable } from '@/components/Pressable'
import { TintButton } from '@/components/TintButton'
import { Txt } from '@/components/ui'
import { ToolTopBar } from '@/apps/calc/wizard'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useI18n } from '@/hooks/useI18n'
import { useAuth } from '@/lib/auth'
import type { TKey } from '@/lib/i18n'
import { usePlus } from '@/lib/plus'
import { getSignedUrls } from '@/lib/signedUrls'
import type { Profile } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import { FrameArt } from './FrameArt'
import { DraggableGrid } from '@/components/DraggableGrid'
import { applyOrder, FRAME_LIMIT_PLUS, frameLimit } from './frameLogic'
import {
  addDevicePhotos,
  addFamilyPhotos,
  cachedUri,
  DEFAULT_SETTINGS,
  deleteFamilyPhoto,
  deviceUri,
  loadDevicePhotos,
  loadOrder,
  loadSettings,
  removeDevicePhoto,
  saveSettings,
  saveOrder,
  type FrameOrder,
  setPhotoTag,
  type DevicePhoto,
  type FramePhoto,
  type FrameSettings,
  type FrameSource,
} from './frameStore'
import { FRAME_LOOK } from './look'
import { useFrameAlbum } from './useFrameAlbum'

const TINT = FRAME_LOOK.tint
const MAX_W = 760
const PICK_AT_ONCE = 30

const SOURCES: { id: FrameSource; icon: LucideIcon; title: TKey; sub: TKey }[] = [
  { id: 'family', icon: UsersRound, title: 'frame.source.family', sub: 'frame.source.familySub' },
  { id: 'device', icon: Smartphone, title: 'frame.source.device', sub: 'frame.source.deviceSub' },
  { id: 'both', icon: Layers, title: 'frame.source.both', sub: 'frame.source.bothSub' },
]

const SECONDS = [8, 15, 30, 60] as const
const HOURS = Array.from({ length: 24 }, (_, h) => h)

function hourLabel(h: number, locale: string): string {
  const d = new Date(2000, 0, 1, h, 0)
  return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
}

const LOCALE: Record<string, string> = { en: 'en-US', pt: 'pt-BR', es: 'es-ES' }

export function FrameManager() {
  const { c } = useTheme()
  const { t, lang } = useI18n()
  const { profile, profiles } = useAuth()
  const { isPlus, isFree } = usePlus()
  const { width } = useWindowDimensions()
  const bottomGap = useBottomGap(sp.md)
  const locale = LOCALE[lang] ?? 'en-US'

  const album = useFrameAlbum(profile?.household_id)
  const [settings, setSettings] = useState<FrameSettings>(DEFAULT_SETTINGS)
  const [device, setDevice] = useState<DevicePhoto[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<{ done: number; total: number; where: 'family' | 'device' } | null>(null)
  const [open, setOpen] = useState<FramePhoto | null>(null)
  // Play order, dragged in the grids (per device, like the settings).
  const [order, setOrder] = useState<FrameOrder>({ family: [], device: [] })
  const reorder = (patch: Partial<FrameOrder>) => {
    setOrder((cur) => {
      const next = { ...cur, ...patch }
      void saveOrder(next)
      return next
    })
  }

  useEffect(() => {
    void loadSettings().then(setSettings)
    void loadDevicePhotos().then(setDevice)
    void loadOrder().then(setOrder)
  }, [])
  // Coming back from the slideshow: pick up a rotation it saved.
  useFocusEffect(
    useCallback(() => {
      void loadSettings().then(setSettings)
    }, []),
  )

  const update = (patch: Partial<FrameSettings>) => {
    setSettings((cur) => {
      const next = { ...cur, ...patch }
      void saveSettings(next)
      return next
    })
  }

  // Thumbnails: this device's cached copy when it has one (no download);
  // otherwise a signed URL, cached on disk by expo-image under the PATH
  // (cacheKey), so a fresh token doesn't mean a fresh download.
  // Asked once per path: a path the server couldn't sign must not loop.
  const [asked] = useState(() => new Set<string>())
  useEffect(() => {
    const need = album.rows.filter((r) => !asked.has(r.path) && !cachedUri(r.id)).map((r) => r.path)
    if (!need.length) return
    need.forEach((p) => asked.add(p))
    void getSignedUrls(need).then((got) => setUrls((cur) => ({ ...cur, ...got })))
  }, [album.rows, asked])

  const used = album.quota?.used ?? album.rows.length
  const cap = album.quota?.cap ?? frameLimit(isPlus)
  const remaining = Math.max(0, cap - used)
  const nameOf = useCallback((email: string | null) => profiles.find((p) => p.email === email)?.display_name ?? null, [profiles])

  const contentW = Math.min(width, MAX_W) - sp.lg * 2
  const cols = contentW > 560 ? 5 : contentW > 380 ? 4 : 3
  const gap = sp.sm
  const tile = Math.floor((contentW - gap * (cols - 1)) / cols)
  // Hundreds of photos must not make the page endless: the grid shows about
  // three and a half rows (the half row says "there's more") and scrolls
  // inside (owner, 2026-11).
  const gridMaxH = tile * 3.5 + gap * 3

  const familyRows = useMemo(() => applyOrder(album.rows, order.family), [album.rows, order.family])
  const deviceRows = useMemo(() => applyOrder(device, order.device), [device, order.device])

  const usesFamily = settings.source !== 'device'
  const usesDevice = settings.source !== 'family'
  const playable = (usesFamily ? album.rows.length : 0) + (usesDevice ? device.length : 0)

  function upsell(kind: 'free' | 'plus') {
    if (kind === 'plus') {
      Alert.alert(t('frame.limitPlus', { n: FRAME_LIMIT_PLUS }))
      return
    }
    Alert.alert(t('frame.limitFree', { n: cap }), t('frame.albumPlusHint', { n: FRAME_LIMIT_PLUS }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('settings.getPlus'), onPress: () => router.push('/paywall') },
    ])
  }

  async function pick(limit: number): Promise<{ uri: string; width: number; height: number }[] | null> {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      Alert.alert(t('frame.permission'))
      return null
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: limit,
      orderedSelection: true,
      quality: 1,
    })
    if (res.canceled || !res.assets?.length) return null
    return res.assets.slice(0, limit).map((a) => ({ uri: a.uri, width: a.width, height: a.height }))
  }

  async function addToAlbum() {
    if (busy || !profile) return
    if (remaining <= 0) {
      upsell(isFree ? 'free' : 'plus')
      return
    }
    const assets = await pick(Math.min(remaining, PICK_AT_ONCE))
    if (!assets) return
    setBusy({ done: 0, total: assets.length, where: 'family' })
    const res = await addFamilyPhotos(profile.household_id, assets, (done) => setBusy({ done, total: assets.length, where: 'family' }))
    setBusy(null)
    await album.reload()
    if (res.limit) upsell(res.limit)
    else if (res.failed) Alert.alert(t('frame.addFailed', { count: res.failed, n: res.failed }))
  }

  async function addToDevice() {
    if (busy) return
    const assets = await pick(PICK_AT_ONCE)
    if (!assets) return
    setBusy({ done: 0, total: assets.length, where: 'device' })
    setDevice(await addDevicePhotos(assets))
    setBusy(null)
  }

  function askRemoveDevice(p: DevicePhoto) {
    Alert.alert(t('frame.removeDevice'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('frame.remove'), style: 'destructive', onPress: () => void removeDevicePhoto(p.id).then(setDevice) },
    ])
  }

  function start() {
    router.push('/calc/frame-show')
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <View style={[styles.column, { paddingHorizontal: sp.lg }]}>
        <ToolTopBar title="" />
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: sp.xxl * 2 }}>
        <View style={[styles.column, { paddingHorizontal: sp.lg }]}>
          <View style={styles.hero}>
            <View style={{ flex: 1 }}>
              <Txt style={styles.bigTitle}>{t('frame.title')}</Txt>
              <Txt style={[styles.subTitle, { color: c.textFaint }]}>{t('frame.subtitle')}</Txt>
            </View>
            <FrameArt size={104} />
          </View>

          <Txt style={[styles.sectionLabel, { color: c.textMuted }]}>{t('frame.source')}</Txt>
          <View style={styles.sources}>
            {SOURCES.map((s) => (
              <SourceTile key={s.id} source={s} on={settings.source === s.id} onPress={() => update({ source: s.id })} />
            ))}
          </View>

          {usesFamily ? (
            <View style={{ marginTop: sp.xl }}>
              <View style={styles.sectionHead}>
                <Txt style={[styles.sectionLabel, { color: c.textMuted, marginBottom: 0 }]}>{t('frame.album')}</Txt>
                <View style={[styles.countPill, { backgroundColor: TINT + '1F' }]}>
                  <Txt style={{ fontFamily: fonts.semibold, fontSize: 12, color: TINT }}>
                    {t('frame.albumCount', { used, cap })}
                  </Txt>
                </View>
              </View>
              {album.offline && !album.rows.length ? (
                <Txt variant="muted" style={{ marginBottom: sp.sm }}>
                  {t('frame.albumUnavailable')}
                </Txt>
              ) : null}
              <ScrollView style={{ maxHeight: gridMaxH }} nestedScrollEnabled showsVerticalScrollIndicator>
                <DraggableGrid
                  data={familyRows}
                  cols={cols}
                  size={tile}
                  gap={gap}
                  lead={1}
                  leading={<AddTile size={tile} busy={busy?.where === 'family' ? busy : null} onPress={addToAlbum} />}
                  onReorder={(ids) => reorder({ family: ids })}
                  renderItem={(p) => (
                    <PhotoTile
                      size={tile}
                      uri={cachedUri(p.id) ?? urls[p.path] ?? null}
                      cacheKey={p.path}
                      tagged={!!p.member_email}
                      onPress={() => setOpen(p)}
                    />
                  )}
                />
              </ScrollView>
              <Txt variant="faint" style={styles.note}>
                {t('frame.dragHint')} {t('frame.albumNote')}
                {isFree ? ` ${t('frame.albumPlusHint', { n: FRAME_LIMIT_PLUS })}` : ''}
              </Txt>
            </View>
          ) : null}

          {usesDevice ? (
            <View style={{ marginTop: sp.xl }}>
              <Txt style={[styles.sectionLabel, { color: c.textMuted }]}>{t('frame.device')}</Txt>
              <ScrollView style={{ maxHeight: gridMaxH }} nestedScrollEnabled showsVerticalScrollIndicator>
                <DraggableGrid
                  data={deviceRows}
                  cols={cols}
                  size={tile}
                  gap={gap}
                  lead={1}
                  leading={<AddTile size={tile} busy={busy?.where === 'device' ? busy : null} onPress={addToDevice} />}
                  onReorder={(ids) => reorder({ device: ids })}
                  renderItem={(p) => <PhotoTile size={tile} uri={deviceUri(p.id)} onPress={() => askRemoveDevice(p)} />}
                />
              </ScrollView>
              <Txt variant="faint" style={styles.note}>
                {t('frame.dragHint')} {t('frame.deviceNote')}
              </Txt>
            </View>
          ) : null}

          <View style={{ marginTop: sp.xl, gap: sp.lg }}>
            <FormSection title={t('frame.slideshow')}>
              <SelectRow
                label={t('frame.seconds')}
                icon={<RowIcon Icon={Timer} tint={TINT} />}
                value={String(settings.seconds)}
                options={SECONDS.map((s) => ({ value: String(s), label: s === 60 ? t('frame.minute') : t('frame.secondsN', { n: s }) }))}
                onChange={(v) => v && update({ seconds: Number(v) })}
              />
              <ToggleRow label={t('frame.random')} icon={<RowIcon Icon={Shuffle} tint={TINT} />} tint={TINT} value={settings.random} onValueChange={(v) => update({ random: v })} />
              <ToggleRow label={t('frame.clock')} icon={<RowIcon Icon={Clock} tint={TINT} />} tint={TINT} value={settings.clock} onValueChange={(v) => update({ clock: v })} />
              <ToggleRow
                label={t('frame.nextEvent')}
                icon={<RowIcon Icon={CalendarDays} tint={TINT} />}
                tint={TINT}
                value={settings.nextEvent}
                onValueChange={(v) => update({ nextEvent: v })}
              />
              <ToggleRow label={t('frame.pets')} icon={<RowIcon Icon={PawPrint} tint={TINT} />} tint={TINT} value={settings.pets} onValueChange={(v) => update({ pets: v })} />
            </FormSection>

            <FormSection title={t('frame.night')} footer={settings.night ? undefined : t('frame.nightHint')}>
              <ToggleRow label={t('frame.nightMode')} icon={<RowIcon Icon={MoonStar} tint={TINT} />} tint={TINT} value={settings.night} onValueChange={(v) => update({ night: v })} />
              {settings.night ? (
                <SelectRow
                  label={t('frame.nightFrom')}
                  icon={<RowIcon Icon={Sunset} tint={TINT} />}
                  value={String(settings.nightStart)}
                  options={HOURS.map((h) => ({ value: String(h), label: hourLabel(h, locale) }))}
                  onChange={(v) => v && update({ nightStart: Number(v) })}
                />
              ) : null}
              {settings.night ? (
                <SelectRow
                  label={t('frame.nightTo')}
                  icon={<RowIcon Icon={Sunrise} tint={TINT} />}
                  value={String(settings.nightEnd)}
                  options={HOURS.map((h) => ({ value: String(h), label: hourLabel(h, locale) }))}
                  onChange={(v) => v && update({ nightEnd: Number(v) })}
                />
              ) : null}
              {settings.night ? (
                <SelectRow
                  label={t('frame.nightStyle')}
                  icon={<RowIcon Icon={Sparkles} tint={TINT} />}
                  value={settings.nightStyle}
                  options={[
                    { value: 'dim', label: t('frame.nightDim') },
                    { value: 'off', label: t('frame.nightOff') },
                  ]}
                  onChange={(v) => v && update({ nightStyle: v })}
                />
              ) : null}
            </FormSection>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.column, { paddingHorizontal: sp.lg, paddingBottom: bottomGap, paddingTop: sp.sm }]}>
        {!playable ? (
          <Txt variant="faint" style={{ textAlign: 'center', marginBottom: sp.xs, fontSize: 12 }}>
            {t('frame.startHint')}
          </Txt>
        ) : null}
        <TintButton
          tint={TINT}
          colors={FRAME_LOOK.colors}
          title={t('frame.start')}
          icon={<Play size={18} color="#fff" fill="#fff" />}
          onPress={start}
          disabled={!playable}
        />
      </View>

      <PhotoSheet
        photo={open}
        me={profile}
        members={profiles}
        uri={open ? (cachedUri(open.id) ?? urls[open.path] ?? null) : null}
        nameOf={nameOf}
        locale={locale}
        onClose={() => setOpen(null)}
        onChanged={() => void album.reload()}
      />
    </SafeAreaView>
  )
}

function SourceTile({
  source,
  on,
  onPress,
}: {
  source: (typeof SOURCES)[number]
  on: boolean
  onPress: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const Icon = source.icon
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.sourceTile,
        {
          backgroundColor: on ? TINT + '14' : c.card,
          borderColor: on ? TINT : c.border,
          borderWidth: on ? 1.5 : StyleSheet.hairlineWidth,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      {on ? (
        <GradientBox colors={FRAME_LOOK.colors} radius={12} style={styles.sourceIcon}>
          <Icon size={18} color="#fff" />
        </GradientBox>
      ) : (
        <View style={[styles.sourceIcon, { borderRadius: 12, backgroundColor: c.surface2 }]}>
          <Icon size={18} color={c.textMuted} />
        </View>
      )}
      <Txt style={{ fontFamily: fonts.semibold, fontSize: 14, color: c.text }} numberOfLines={1}>
        {t(source.title)}
      </Txt>
      <Txt variant="faint" style={{ fontSize: 11.5 }} numberOfLines={2}>
        {t(source.sub)}
      </Txt>
    </Pressable>
  )
}

function AddTile({ size, busy, onPress }: { size: number; busy: { done: number; total: number } | null; onPress: () => void }) {
  const { t } = useI18n()
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t('frame.addPhotos')} onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
      <GradientBox colors={FRAME_LOOK.colors} radius={14} style={[styles.addTile, { width: size, height: size }]}>
        {busy ? (
          <Txt style={styles.addLabel} numberOfLines={3}>
            {t('frame.adding', { done: Math.min(busy.done + 1, busy.total), total: busy.total })}
          </Txt>
        ) : (
          <>
            <Plus size={26} color="#fff" strokeWidth={2.4} />
            <Txt style={styles.addLabel} numberOfLines={2}>
              {t('frame.addPhotos')}
            </Txt>
          </>
        )}
      </GradientBox>
    </Pressable>
  )
}

function PhotoTile({
  size,
  uri,
  cacheKey,
  tagged,
  onPress,
}: {
  size: number
  uri: string | null
  cacheKey?: string
  tagged?: boolean
  onPress: () => void
}) {
  const { c } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="imagebutton" style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
      <View style={{ width: size, height: size, borderRadius: 14, overflow: 'hidden', backgroundColor: c.surface2 }}>
        {uri ? (
          <Image
            source={cacheKey && !uri.startsWith('file:') ? { uri, cacheKey } : { uri }}
            style={{ width: size, height: size }}
            contentFit="cover"
            cachePolicy="disk"
            transition={200}
          />
        ) : (
          <View style={styles.thumbEmpty}>
            <Images size={20} color={c.textFaint} />
          </View>
        )}
        {tagged ? (
          <View style={styles.tagDot}>
            <UsersRound size={11} color="#fff" />
          </View>
        ) : null}
      </View>
    </Pressable>
  )
}

/** One album photo: big preview, who added it, who's in it (the birthday
 *  tag), delete. Tag/delete only for your own photo — or any, as owner. */
function PhotoSheet({
  photo,
  me,
  members,
  uri,
  nameOf,
  locale,
  onClose,
  onChanged,
}: {
  photo: FramePhoto | null
  me: Profile | null
  members: Profile[]
  uri: string | null
  nameOf: (email: string | null) => string | null
  locale: string
  onClose: () => void
  onChanged: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const bottomGap = useBottomGap(sp.lg)
  const { width, height } = useWindowDimensions()
  // The tag as picked in this sheet (optimistic), for THIS photo only.
  const [picked, setPicked] = useState<{ id: string; email: string | null } | null>(null)
  const [working, setWorking] = useState(false)
  const tag = photo && picked?.id === photo.id ? picked.email : (photo?.member_email ?? null)

  const mine = !!photo && !!me && photo.added_by === me.email
  const canEdit = mine || me?.role === 'owner'
  const by = photo ? (mine ? t('frame.addedByYou') : nameOf(photo.added_by)) : null
  const when = useMemo(
    () => (photo ? new Date(photo.created_at).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) : ''),
    [photo, locale],
  )
  const previewH = Math.min(height * 0.42, 420)
  const sheetW = Math.min(width, 620)

  async function pickTag(email: string | null) {
    if (!photo || !canEdit || working) return
    const prev = tag
    setPicked({ id: photo.id, email })
    const ok = await setPhotoTag(photo.id, email)
    if (!ok) {
      setPicked({ id: photo.id, email: prev })
      Alert.alert(t('frame.tagFailed'))
    } else onChanged()
  }

  function askDelete() {
    if (!photo) return
    Alert.alert(t('frame.deleteConfirm'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('frame.delete'),
        style: 'destructive',
        onPress: async () => {
          setWorking(true)
          const ok = await deleteFamilyPhoto(photo)
          setWorking(false)
          if (!ok) {
            Alert.alert(t('frame.deleteFailed'))
            return
          }
          onChanged()
          onClose()
        },
      },
    ])
  }

  return (
    <Modal visible={!!photo} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={styles.backdrop}>
        <Pressable onPress={() => {}} style={[styles.sheet, { backgroundColor: c.sheet, paddingBottom: bottomGap, width: sheetW }]}>
          <View style={styles.sheetHead}>
            <GradientBox colors={FRAME_LOOK.colors} radius={12} style={styles.sheetIcon}>
              <Images size={18} color="#fff" />
            </GradientBox>
            <View style={{ flex: 1 }}>
              <Txt style={{ fontFamily: fonts.display, fontSize: 20, color: c.text }} numberOfLines={1}>
                {by ? (mine ? by : t('frame.addedBy', { name: by })) : t('frame.album')}
              </Txt>
              <Txt variant="faint" style={{ fontSize: 13 }}>
                {when}
              </Txt>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t('frame.close')} onPress={onClose} hitSlop={8} style={[styles.round, { backgroundColor: c.surface2 }]}>
              <X size={18} color={c.text} />
            </Pressable>
          </View>

          <View style={[styles.preview, { height: previewH, backgroundColor: '#000' }]}>
            {uri ? (
              <Image
                source={photo && !uri.startsWith('file:') ? { uri, cacheKey: photo.path } : { uri }}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                cachePolicy="disk"
              />
            ) : null}
          </View>

          <Txt style={[styles.sectionLabel, { color: c.textMuted, marginTop: sp.lg, marginBottom: 6 }]}>{t('frame.whoIsIn')}</Txt>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.sm, paddingRight: sp.lg }}>
            <Chip label={t('frame.nobody')} on={!tag} disabled={!canEdit} onPress={() => void pickTag(null)} />
            {members.map((m) => (
              <Chip key={m.email} label={m.display_name} on={tag === m.email} disabled={!canEdit} onPress={() => void pickTag(m.email)} />
            ))}
          </ScrollView>
          <Txt variant="faint" style={{ fontSize: 12, marginTop: 6 }}>
            {t('frame.whoHint')}
          </Txt>

          {canEdit ? (
            <Pressable
              accessibilityRole="button"
              onPress={askDelete}
              disabled={working}
              style={({ pressed }) => [styles.deleteRow, { borderColor: c.border, opacity: pressed || working ? 0.6 : 1 }]}
            >
              <Trash2 size={18} color={c.expense} />
              <Txt style={{ fontFamily: fonts.semibold, color: c.expense, fontSize: 15 }}>{t('frame.delete')}</Txt>
            </Pressable>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function Chip({ label, on, disabled, onPress }: { label: string; on: boolean; disabled: boolean; onPress: () => void }) {
  const { c } = useTheme()
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on, disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: on ? TINT + '1F' : c.surface2,
          borderColor: on ? TINT : 'transparent',
          opacity: disabled && !on ? 0.5 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <Txt style={{ fontSize: 14, fontFamily: on ? fonts.semibold : fonts.medium, color: on ? TINT : c.text }}>{label}</Txt>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  column: { width: '100%', maxWidth: MAX_W, alignSelf: 'center' },
  hero: { flexDirection: 'row', alignItems: 'center', gap: sp.md, marginBottom: sp.lg },
  bigTitle: { fontFamily: fonts.display, fontSize: 36, lineHeight: 42, letterSpacing: -0.8 },
  subTitle: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28, letterSpacing: -0.4, marginTop: 2 },
  sectionLabel: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase', marginBottom: sp.md },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: sp.md },
  countPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  sources: { flexDirection: 'row', gap: sp.sm },
  sourceTile: { flex: 1, borderRadius: 20, padding: sp.md, gap: 4, minHeight: 112 },
  sourceIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  addTile: { alignItems: 'center', justifyContent: 'center', gap: 4, padding: 6 },
  addLabel: { color: '#fff', fontFamily: fonts.semibold, fontSize: 12.5, textAlign: 'center' },
  thumbEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tagDot: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: { fontSize: 12.5, marginTop: sp.sm, lineHeight: 17 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: sp.lg, paddingTop: sp.lg },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: sp.md, marginBottom: sp.md },
  sheetIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  round: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  preview: { borderRadius: 16, overflow: 'hidden' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5 },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: sp.sm,
    marginTop: sp.lg,
    height: 50,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
})
