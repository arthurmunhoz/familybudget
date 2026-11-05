// Document Vault — the module's main screen (2026-11 restyle in the Home's
// language): a big title with the count under it in faded type, round top-bar
// buttons (back; the Face ID lock as a toggle), owners and types as TILES
// instead of chip walls, each type's documents as ONE rounded card, and the
// add actions docked at the bottom — Scan (the camera art, like Money's scan
// button) and Choose file — on the bottom button's curve (useScreenCorner).
// Tapping a row opens the file (signed URL, in-app browser); "…" or a long
// press opens the details sheet (rename / recategorise / REPLACE the file /
// delete). Scanning and picking live in docPicker.
import { useEffect, useMemo, useState } from 'react'
import { Alert, ScrollView, StyleSheet, View } from 'react-native'
import { Pressable } from '@/components/Pressable'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as LocalAuthentication from 'expo-local-authentication'
import * as WebBrowser from 'expo-web-browser'
import { router } from 'expo-router'
import { Image } from 'expo-image'
import { ChevronLeft, FileText, FolderLock, House, Lock, LockOpen, MoreHorizontal, Upload, Users } from 'lucide-react-native'

import { EmptyState, Loader, Txt } from '@/components/ui'
import { GradientBox } from '@/components/home/GradientBox'
import { APP_GRADIENT } from '@/components/home/palette'
import { CameraArt } from '@/apps/budget/CameraArt'
import { useAuth } from '@/lib/auth'
import { usePlus } from '@/lib/plus'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import { useBottomGap } from '@/hooks/useBottomGap'
import { useScreenCorner } from '@/hooks/useScreenCorner'
import { platformKey, type TKey } from '@/lib/i18n'
import { formatDay } from '@/lib/format'
import { memberColor } from '@/lib/calendar'
import { getSignedUrl, getSignedUrls } from '@/lib/signedUrls'
import { track } from '@/lib/analytics'
import { supabase } from '@/lib/supabase'
import type { DocCategory, FamilyDocument } from '@/lib/types'
import { biometricAvailable, isVaultLockEnabled, setVaultLockEnabled } from '@/lib/vaultLock'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import { CATEGORIES, CAT_COLOR, CAT_LUCIDE, formatBytes, isImageDoc, thumbPathFor } from './docUtils'
import { pickFile, scanDocument } from './docPicker'
import UploadSheet, { type PickedFile } from './UploadSheet'
import EditSheet from './EditSheet'

export default function DocumentVault() {
  const { c, dark } = useTheme()
  const { t } = useI18n()
  const { profile, profiles } = useAuth()
  const { isPlus } = usePlus()

  const [filter, setFilter] = useState<DocCategory | 'all'>('all')
  // 'all' = everyone · a member email · 'shared' (household-owned docs).
  const [person, setPerson] = useState<string>('all')

  const [pending, setPending] = useState<PickedFile | null>(null)
  const [editing, setEditing] = useState<FamilyDocument | null>(null)
  const [picking, setPicking] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)

  // Opt-in Face ID lock (per user + device, like the PWA). The toggle only
  // shows where a biometric is available; enabling verifies with Face ID first.
  const [canLock, setCanLock] = useState(false)
  const [lockOn, setLockOn] = useState(false)
  const email = profile?.email ?? null
  useEffect(() => {
    let active = true
    biometricAvailable().then((v) => {
      if (active) setCanLock(v)
    })
    if (email) {
      isVaultLockEnabled(email).then((v) => {
        if (active) setLockOn(v)
      })
    }
    return () => {
      active = false
    }
  }, [email])

  async function toggleLock(next: boolean) {
    if (!email) return
    if (!next) {
      await setVaultLockEnabled(email, false)
      setLockOn(false)
      return
    }
    // The Face ID lock is a One Roof Plus feature.
    if (!isPlus) {
      router.push('/paywall')
      return
    }
    // Prove it's the owner before turning the lock on (mirrors the PWA).
    try {
      const r = await LocalAuthentication.authenticateAsync({
        promptMessage: t(platformKey('vault.lockTitle')),
        cancelLabel: t('common.cancel'),
      })
      if (!r.success) {
        Alert.alert(t('vault.enableFailed'))
        return
      }
    } catch {
      Alert.alert(t('vault.enableFailed'))
      return
    }
    await setVaultLockEnabled(email, true)
    setLockOn(true)
  }

  // Stale-while-revalidate: the last-loaded docs render instantly on return
  // (no loader flash); revalidate() refetches after a mutation.
  const {
    data: docs = [],
    loading,
    revalidate: load,
  } = useCachedQuery<FamilyDocument[]>('docs', async () => {
    const { data } = await supabase
      .from('documents')
      .select('*')
      .order('created_at', { ascending: false })
    return (data ?? []) as FamilyDocument[]
  })

  // Thumbnail URLs, one batched signing call for the whole list. Each doc asks
  // for its derived thumb; an IMAGE doc also asks for its own file, which is the
  // fallback for images uploaded before thumbnails existed (or from the PWA).
  // A path with no object simply comes back without a URL — that's how a
  // missing thumb is detected, so no `documents` column is needed.
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const thumbKey = docs.map((d) => d.id).join(',')
  useEffect(() => {
    if (!docs.length) return
    let active = true
    const paths = docs.flatMap((d) =>
      isImageDoc(d.mime_type, d.file_path) ? [thumbPathFor(d.file_path), d.file_path] : [thumbPathFor(d.file_path)],
    )
    getSignedUrls(paths)
      .then((urls) => {
        if (active) setThumbs(urls)
      })
      .catch(() => {})
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the doc ids, not the array identity
  }, [thumbKey])

  // Member first name for a doc's owner — used by the person chips and the row
  // subtitle. 'shared' is the sentinel owner for household-wide documents.
  const nameOf = (ownerEmail: string) => {
    if (ownerEmail === 'shared') return t('docs.shared')
    const p = profiles.find((x) => x.email === ownerEmail)
    return (p?.display_name || ownerEmail).trim().split(/\s+/)[0]
  }

  // Documents matching BOTH the active category and person filters.
  const visible = useMemo(
    () =>
      docs.filter(
        (d) =>
          (filter === 'all' || d.category === filter) &&
          (person === 'all' || d.owner_email === person),
      ),
    [docs, filter, person],
  )

  /** Grouped by category in the canonical order; only non-empty groups show.
   *  Each group's docs are sorted alphabetically by title. */
  const groups = useMemo(() => {
    const byCat = new Map<DocCategory, FamilyDocument[]>()
    for (const cat of CATEGORIES) byCat.set(cat.id, [])
    for (const d of visible) {
      if (!byCat.has(d.category)) byCat.set(d.category, [])
      byCat.get(d.category)!.push(d)
    }
    return [...byCat.entries()]
      .filter(([, list]) => list.length > 0)
      .map(([cat, list]) => ({
        cat,
        docs: [...list].sort((a, b) =>
          a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }),
        ),
      }))
  }, [visible])

  // Adding: scan (VisionKit) or choose a file — docPicker shares this with
  // EditSheet's "Replace file".
  async function add(how: 'scan' | 'file') {
    if (picking || !profile) return
    setPicking(true)
    try {
      const file = how === 'scan' ? await scanDocument(t) : await pickFile(t)
      if (file) setPending(file)
    } finally {
      setPicking(false)
    }
  }

  async function openDoc(doc: FamilyDocument) {
    if (opening) return
    setOpening(doc.id)
    const url = await getSignedUrl(doc.file_path)
    setOpening(null)
    if (!url) {
      Alert.alert(t('docs.openFailed'))
      return
    }
    track('doc.opened', { title: doc.title, category: doc.category })
    await WebBrowser.openBrowserAsync(url)
  }

  function removeDoc(doc: FamilyDocument) {
    Alert.alert(t('docs.deleteConfirm', { title: doc.title }), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await supabase.storage.from('documents').remove([doc.file_path, thumbPathFor(doc.file_path)])
          await supabase.from('documents').delete().eq('id', doc.id)
          track('doc.deleted', { title: doc.title, category: doc.category })
          setEditing(null)   // the sheet is open on the row we just removed
          load()
        },
      },
    ])
  }

  const corner = useScreenCorner()
  const bottomGap = useBottomGap(sp.xs)
  const memberEmails = profiles.map((p) => p.email)
  const countFor = (cat: DocCategory | 'all') =>
    docs.filter((d) => (cat === 'all' || d.category === cat) && (person === 'all' || d.owner_email === person)).length

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      {/* top bar: back, and the Face ID lock as a round toggle */}
      <View style={s.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          hitSlop={8}
          style={[s.round, { backgroundColor: c.card, borderColor: c.border }]}
        >
          <ChevronLeft size={22} color={c.text} />
        </Pressable>
        {canLock ? (
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: lockOn }}
            accessibilityLabel={lockOn ? t(platformKey('vault.disableLock')) : t(platformKey('vault.enableLock'))}
            accessibilityHint={t(platformKey('vault.lockDesc'))}
            onPress={() => toggleLock(!lockOn)}
            hitSlop={8}
            style={[
              s.round,
              lockOn ? { backgroundColor: c.action, borderColor: c.action } : { backgroundColor: c.card, borderColor: c.border },
            ]}
          >
            {lockOn ? <Lock size={18} color={c.onAction} /> : <LockOpen size={18} color={c.textMuted} />}
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <Loader />
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.lg }}>
          <Txt style={s.bigTitle}>{t('docs.title')}</Txt>
          <Txt style={[s.bigTitle, { color: c.textFaint }]}>
            {visible.length === 1 ? t('docs.countOne') : t('docs.countMany', { n: visible.length })}
          </Txt>

          {/* whose — only for households of more than one */}
          {profiles.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginHorizontal: -sp.lg, marginTop: sp.lg }}
              contentContainerStyle={{ paddingHorizontal: sp.lg, gap: sp.sm }}
            >
              <OwnerPill active={person === 'all'} label={t('common.everyone')} onPress={() => setPerson('all')}>
                <Users size={14} color="#fff" />
              </OwnerPill>
              {profiles.map((p) => {
                const tint = memberColor(p.email, memberEmails)
                return (
                  <OwnerPill
                    key={p.email}
                    active={person === p.email}
                    label={nameOf(p.email)}
                    tint={tint}
                    onPress={() => setPerson(p.email)}
                  >
                    <Txt style={{ color: '#fff', fontSize: 12, fontFamily: fonts.semibold }}>
                      {nameOf(p.email).charAt(0).toUpperCase()}
                    </Txt>
                  </OwnerPill>
                )
              })}
              <OwnerPill active={person === 'shared'} label={t('docs.shared')} tint="#3D9B5C" onPress={() => setPerson('shared')}>
                <House size={13} color="#fff" />
              </OwnerPill>
            </ScrollView>
          ) : null}

          {/* what kind — tiles with each type's count */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -sp.lg, marginTop: sp.md }}
            contentContainerStyle={{ paddingHorizontal: sp.lg, gap: 10 }}
          >
            <TypeTile
              label={t('common.all')}
              count={countFor('all')}
              active={filter === 'all'}
              onPress={() => setFilter('all')}
              icon={
                <GradientBox colors={APP_GRADIENT.docs} radius={10} style={s.tileIcon}>
                  <FolderLock size={16} color="#fff" />
                </GradientBox>
              }
            />
            {CATEGORIES.map((cat) => {
              const Icon = cat.Icon
              return (
                <TypeTile
                  key={cat.id}
                  label={t(`docCat.${cat.id}` as TKey)}
                  count={countFor(cat.id)}
                  active={filter === cat.id}
                  onPress={() => setFilter(cat.id)}
                  icon={
                    <View style={[s.tileIcon, { borderRadius: 10, backgroundColor: CAT_COLOR[cat.id] + '22' }]}>
                      <Icon size={16} color={CAT_COLOR[cat.id]} />
                    </View>
                  }
                />
              )
            })}
          </ScrollView>

          {visible.length === 0 ? (
            <EmptyState title={t('docs.empty')} subtitle={t('docs.emptyHint')} />
          ) : (
            groups.map((group) => {
              const Icon = CAT_LUCIDE[group.cat] ?? FileText
              return (
                <View key={group.cat}>
                  <View style={s.groupHead}>
                    <Icon size={14} color={CAT_COLOR[group.cat]} />
                    <Txt style={[s.groupLabel, { color: c.textMuted }]}>
                      {t(`docCat.${group.cat}` as TKey)} · {group.docs.length}
                    </Txt>
                  </View>
                  {/* the type's documents as ONE rounded card */}
                  <View style={[s.groupCard, { backgroundColor: c.card, borderColor: c.border }]}>
                    {group.docs.map((doc, i) => (
                      <DocRow
                        key={doc.id}
                        doc={doc}
                        first={i === 0}
                        ownerName={person === 'all' ? nameOf(doc.owner_email) : null}
                        thumbs={thumbs}
                        opening={opening === doc.id}
                        onOpen={() => openDoc(doc)}
                        onEdit={() => setEditing(doc)}
                      />
                    ))}
                  </View>
                </View>
              )
            })
          )}
        </ScrollView>
      )}

      {/* Add: Scan (the camera art) + Choose file, docked in normal flow so the
          list ends at them; outer bottom corners on the bottom button's curve. */}
      <View
        style={[
          s.dock,
          { paddingBottom: corner ? corner.bottom : bottomGap, paddingHorizontal: corner ? corner.side : sp.lg },
        ]}
      >
        <Pressable
          onPress={() => add('scan')}
          disabled={picking}
          accessibilityRole="button"
          accessibilityLabel={t('docs.scanDoc')}
          style={({ pressed }) => [
            s.dockBtn,
            {
              flex: 1,
              backgroundColor: c.card,
              borderColor: c.border,
              borderWidth: StyleSheet.hairlineWidth,
              borderBottomLeftRadius: corner?.radius ?? 18,
              opacity: picking ? 0.5 : pressed ? 0.75 : 1,
            },
          ]}
        >
          <CameraArt opacity={dark ? 0.55 : 0.24} />
          <Txt style={{ fontFamily: fonts.display, fontSize: 16 }}>{t('docs.scan')}</Txt>
        </Pressable>
        <Pressable
          onPress={() => add('file')}
          disabled={picking}
          accessibilityRole="button"
          accessibilityLabel={t('docs.chooseFile')}
          style={({ pressed }) => [
            s.dockBtn,
            {
              flex: 1,
              backgroundColor: c.action,
              borderBottomRightRadius: corner?.radius ?? 18,
              opacity: picking ? 0.5 : pressed ? 0.85 : 1,
            },
          ]}
        >
          <Upload size={18} color={c.onAction} />
          <Txt style={{ fontFamily: fonts.semibold, fontSize: 15.5, color: c.onAction }}>{t('docs.chooseFileShort')}</Txt>
        </Pressable>
      </View>

      {pending && profile && (
        <UploadSheet
          file={pending}
          profile={profile}
          profiles={profiles}
          defaultCategory={filter !== 'all' ? filter : 'other'}
          defaultOwner={person !== 'all' ? person : profile.email}
          onClose={() => setPending(null)}
          onSaved={() => {
            setPending(null)
            load()
          }}
        />
      )}

      {editing && profile && (
        <EditSheet
          doc={editing}
          profiles={profiles}
          householdId={profile.household_id}
          thumbUrl={thumbs[thumbPathFor(editing.file_path)] ?? (isImageDoc(editing.mime_type, editing.file_path) ? thumbs[editing.file_path] : undefined)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
          onDelete={() => removeDoc(editing)}
        />
      )}
    </SafeAreaView>
  )
}

/** One document in its type's card: thumbnail, title, whose · date · size,
 *  and "…" for the details. Tap opens; long-press also opens the details. */
function DocRow({
  doc,
  first,
  ownerName,
  thumbs,
  opening,
  onOpen,
  onEdit,
}: {
  doc: FamilyDocument
  first: boolean
  /** Owner's first name, shown in the subtitle only in the "Everyone" view. */
  ownerName?: string | null
  /** Signed URLs by storage path (thumbs + image fallbacks), from the screen. */
  thumbs: Record<string, string>
  opening: boolean
  onOpen: () => void
  onEdit: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  return (
    <View>
      {/* hairline between rows, inset past the thumbnail like the Home lists */}
      {!first ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: 74 }} /> : null}
      <View style={[s.row, { opacity: opening ? 0.6 : 1 }]}>
        <Pressable
          onPress={onOpen}
          onLongPress={onEdit}
          delayLongPress={400}
          style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, flex: 1, minWidth: 0 }}
        >
          <DocThumb doc={doc} thumbs={thumbs} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt style={{ fontFamily: fonts.medium, fontSize: 15.5 }} numberOfLines={1}>
              {doc.title}
            </Txt>
            <Txt variant="faint" numberOfLines={1} style={{ marginTop: 2 }}>
              {ownerName ? `${ownerName} · ` : ''}
              {formatDay(doc.created_at.slice(0, 10))} · {formatBytes(doc.size_bytes)}
            </Txt>
          </View>
        </Pressable>
        <Pressable
          onPress={onEdit}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('docs.more', { name: doc.title })}
          style={({ pressed }) => [s.more, { backgroundColor: c.surface }, pressed && { opacity: 0.6 }]}
        >
          <MoreHorizontal size={18} color={c.text} />
        </Pressable>
      </View>
    </View>
  )
}

const THUMB_W = 46
const THUMB_H = 60

/** The row's preview: the document's own thumbnail (portrait, like a page),
 *  else — for images with no thumb yet — the image itself, else a typed tile
 *  (category glyph + "PDF"). The tile is always drawn UNDER the image, so a
 *  slow or failed load shows the placeholder rather than an empty box.
 *  `cacheKey` is the storage path, which is content-addressed: the signed URL
 *  changes every 24 h, the bytes never do, so each thumb downloads once per
 *  device instead of once per token. Module scope — see GroupIcon. */
function DocThumb({ doc, thumbs }: { doc: FamilyDocument; thumbs: Record<string, string> }) {
  const { c } = useTheme()
  const Icon = CAT_LUCIDE[doc.category] ?? FileText
  const thumbPath = thumbPathFor(doc.file_path)
  const src = thumbs[thumbPath]
    ? { uri: thumbs[thumbPath], cacheKey: thumbPath }
    : isImageDoc(doc.mime_type, doc.file_path) && thumbs[doc.file_path]
      ? { uri: thumbs[doc.file_path], cacheKey: doc.file_path }
      : null
  const isPdf = doc.mime_type === 'application/pdf' || doc.file_path.toLowerCase().endsWith('.pdf')
  return (
    <View
      style={{
        width: THUMB_W,
        height: THUMB_H,
        borderRadius: 10,
        overflow: 'hidden',
        backgroundColor: c.surface,
        borderWidth: 1,
        borderColor: c.border,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
      }}
    >
      <Icon size={18} color={c.textFaint} />
      {isPdf ? (
        <Txt style={{ fontSize: 9, fontWeight: '700', letterSpacing: 0.5, color: c.textFaint }}>PDF</Txt>
      ) : null}
      {src ? (
        <Image
          source={src}
          recyclingKey={src.cacheKey}
          cachePolicy="memory-disk"
          contentFit="cover"
          contentPosition="top"
          transition={150}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          accessibilityIgnoresInvertColors
        />
      ) : null}
    </View>
  )
}

/** A person in the owner strip: avatar (their calendar colour) + name. */
function OwnerPill({
  active,
  label,
  tint,
  onPress,
  children,
}: {
  active: boolean
  label: string
  tint?: string
  onPress: () => void
  children: React.ReactNode
}) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[
        s.pill,
        {
          backgroundColor: active ? c.cardActive : c.card,
          borderColor: active ? c.action : c.border,
          borderWidth: active ? 2 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      <View style={[s.pillAvatar, { backgroundColor: tint ?? c.action }]}>{children}</View>
      <Txt style={{ fontFamily: fonts.semibold, fontSize: 14 }}>{label}</Txt>
    </Pressable>
  )
}

/** A document type as a tile: its icon, name and how many there are. */
function TypeTile({
  label,
  count,
  icon,
  active,
  onPress,
}: {
  label: string
  count: number
  icon: React.ReactNode
  active: boolean
  onPress: () => void
}) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        s.tile,
        {
          backgroundColor: c.card,
          borderColor: active ? c.action : c.border,
          borderWidth: active ? 2 : StyleSheet.hairlineWidth,
          opacity: count === 0 && !active ? 0.55 : pressed ? 0.7 : 1,
        },
      ]}
    >
      {icon}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'stretch' }}>
        <Txt style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 13 }} numberOfLines={1}>
          {label}
        </Txt>
        {count ? <Txt style={{ fontSize: 12, fontFamily: fonts.semibold, color: c.textMuted }}>{count}</Txt> : null}
      </View>
    </Pressable>
  )
}

const s = StyleSheet.create({
  topBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: sp.lg, paddingVertical: sp.sm },
  round: { width: 40, height: 40, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  bigTitle: { fontFamily: fonts.display, fontSize: 36, lineHeight: 42, letterSpacing: -0.8 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingLeft: 6, paddingRight: 14, borderRadius: radius.pill },
  pillAvatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  tile: { width: 100, height: 84, borderRadius: 20, padding: 11, justifyContent: 'space-between' },
  tileIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: sp.xl, marginBottom: sp.sm, paddingHorizontal: 2 },
  groupLabel: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase' },
  groupCard: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: sp.md, paddingHorizontal: sp.md, paddingVertical: 10 },
  more: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  dock: { flexDirection: 'row', gap: 10, paddingTop: sp.sm },
  dockBtn: {
    height: 56,
    borderRadius: 18,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
})
