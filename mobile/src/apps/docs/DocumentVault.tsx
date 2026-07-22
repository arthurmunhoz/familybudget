// Document Vault — the module's main screen (RN port of the PWA DocumentVault).
// Documents grouped by category, each row showing a title + a category type
// icon. Tapping a row opens the file via a signed URL in the in-app browser;
// the pencil opens the details sheet (rename / recategorise / delete). The bottom
// bar picks a file (images + PDF only) → shows the UploadSheet.
import { useEffect, useMemo, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { PDFDocument } from 'pdf-lib'
import { File } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import * as LocalAuthentication from 'expo-local-authentication'
import * as WebBrowser from 'expo-web-browser'
import { router } from 'expo-router'
import { ChevronRight, FileText, Lock, Pencil } from 'lucide-react-native'

import { AppHeader, EmptyState, Loader, NewItemButton, Txt } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { usePlus } from '@/lib/plus'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { formatDay } from '@/lib/format'
import { getSignedUrl } from '@/lib/signedUrls'
import { track } from '@/lib/analytics'
import { supabase } from '@/lib/supabase'
import type { DocCategory, FamilyDocument } from '@/lib/types'
import { biometricAvailable, isVaultLockEnabled, setVaultLockEnabled } from '@/lib/vaultLock'
import { radius, sp, useTheme } from '@/theme/theme'
import { CATEGORIES, CAT_LUCIDE, formatBytes } from './docUtils'
import UploadSheet, { type PickedFile } from './UploadSheet'
import EditSheet from './EditSheet'

const MAX_SIZE = 20 * 1024 * 1024 // bucket limit
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif']

// The scanner is a native TurboModule whose spec calls getEnforcing() AT IMPORT,
// which THROWS — crashing the whole route — when the native binary lacks it
// (Expo Go, or before a native rebuild). A static top-level import therefore
// takes the screen down on load. Requiring it lazily inside try/catch turns that
// into a graceful `null`, so callers fall back to a plain camera capture.
type Scanner = {
  scanDocument: (opts: {
    croppedImageQuality?: number
  }) => Promise<{ scannedImages?: string[]; status: string }>
}
function loadScanner(): Scanner | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('react-native-document-scanner-plugin').default as Scanner
  } catch {
    return null
  }
}

export default function DocumentVault() {
  const { c } = useTheme()
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
        promptMessage: t('vault.lockTitle'),
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

  async function pickFile() {
    if (picking || !profile) return
    // The Document Vault is free to use — only the Face ID lock is Plus.
    setPicking(true)
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'application/pdf'],
        copyToCacheDirectory: true,
        multiple: false,
      })
      if (result.canceled || !result.assets[0]) return
      const asset = result.assets[0]
      const initialSize = asset.size ?? new File(asset.uri).size ?? 0
      if (initialSize > MAX_SIZE) {
        Alert.alert(t('docs.tooBig', { size: formatBytes(initialSize) }))
        return
      }
      const rawExt = (asset.name.split('.').pop() ?? '').toLowerCase()
      const isImage = (asset.mimeType?.startsWith('image/') ?? false) || IMAGE_EXTS.includes(rawExt)
      // The bucket only accepts image/* + application/pdf, so when the picker
      // doesn't report a type, infer it from the extension.
      let uri = asset.uri
      let ext = rawExt || (isImage ? 'jpg' : 'pdf')
      let mime =
        asset.mimeType ||
        (ext === 'pdf' ? 'application/pdf' : `image/${ext === 'jpg' ? 'jpeg' : ext}`)
      // Downscale big photos before upload (cap the long edge ~2048px, re-encode
      // JPEG) — keeps the vault light and uploads fast. Only for images clearly
      // over ~0.6MB, so small screenshots and all PDFs upload untouched (avoids
      // upscaling / needless recompression). Falls back to the original on error.
      if (isImage && initialSize > 600 * 1024) {
        try {
          const ref = await ImageManipulator.manipulate(asset.uri).resize({ width: 2048 }).renderAsync()
          const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 })
          uri = out.uri
          ext = 'jpg'
          mime = 'image/jpeg'
        } catch {
          /* keep the original file if manipulation fails */
        }
      }
      // Read the (possibly downscaled) file's bytes for upload (SDK 56 File API).
      const buffer = await new File(uri).arrayBuffer()
      const bytes = new Uint8Array(buffer)
      const size = bytes.byteLength
      setPending({ name: asset.name, uri, size, bytes, mime, ext })
    } catch {
      Alert.alert(t('docs.uploadFailed'))
    } finally {
      setPicking(false)
    }
  }

  // Shared tail for a captured/scanned image: downscale (2048px long edge, JPEG)
  // then hand off to the UploadSheet — the user names it there (default title
  // comes from `name`). Same path a file-picked image already takes.
  async function uploadImageUri(uri: string) {
    setPicking(true)
    try {
      const ref = await ImageManipulator.manipulate(uri).resize({ width: 2048 }).renderAsync()
      const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 })
      const buffer = await new File(out.uri).arrayBuffer()
      const bytes = new Uint8Array(buffer)
      setPending({
        name: `${t('docs.scanName')}.jpg`,
        uri: out.uri,
        size: bytes.byteLength,
        bytes,
        mime: 'image/jpeg',
        ext: 'jpg',
      })
    } catch {
      Alert.alert(t('docs.uploadFailed'))
    } finally {
      setPicking(false)
    }
  }

  // Build a single multi-page PDF from the scanned page images — each page
  // downscaled + JPEG-compressed, then embedded (pdf-lib, pure JS). One document
  // with N pages, rather than N separate rows.
  async function uploadPagesAsPdf(uris: string[]) {
    setPicking(true)
    try {
      const pdf = await PDFDocument.create()
      for (const uri of uris) {
        const ref = await ImageManipulator.manipulate(uri).resize({ width: 2048 }).renderAsync()
        const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 })
        const bytes = new Uint8Array(await new File(out.uri).arrayBuffer())
        const img = await pdf.embedJpg(bytes)
        const page = pdf.addPage([img.width, img.height])
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height })
      }
      const pdfBytes = await pdf.save()
      if (pdfBytes.byteLength > MAX_SIZE) {
        Alert.alert(t('docs.tooBig', { size: formatBytes(pdfBytes.byteLength) }))
        return
      }
      setPending({
        name: `${t('docs.scanName')}.pdf`,
        uri: '',
        size: pdfBytes.byteLength,
        bytes: pdfBytes,
        mime: 'application/pdf',
        ext: 'pdf',
      })
    } catch {
      Alert.alert(t('docs.uploadFailed'))
    } finally {
      setPicking(false)
    }
  }

  // Scan a document with the OS document scanner (VisionKit on iOS): live edge
  // detection, auto-capture, and perspective-corrected crop, across as many
  // pages as the user captures. One page → a JPEG image; multiple → one PDF.
  async function scanDocument() {
    if (picking || !profile) return
    // Native module absent (Expo Go, or before a native rebuild) — degrade to a
    // plain camera capture so the feature still works, minus edge detection.
    const scanner = loadScanner()
    if (!scanner) return takePhoto()
    let images: string[]
    try {
      const { scannedImages, status } = await scanner.scanDocument({ croppedImageQuality: 100 })
      if (status !== 'success' || !scannedImages?.length) return // user cancelled
      images = scannedImages
    } catch {
      return takePhoto()
    }
    if (images.length === 1) await uploadImageUri(images[0])
    else await uploadPagesAsPdf(images)
  }

  // Fallback capture when the document scanner's native module isn't available.
  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) {
      Alert.alert(t('docs.cameraDenied'))
      return
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 1 })
    if (result.canceled || !result.assets[0]) return
    await uploadImageUri(result.assets[0].uri)
  }

  // The "Add document" button offers both paths — scan a document (auto-cropped),
  // or pick an existing file (image/PDF). Alert chooser matches the scan flows.
  function startAdd() {
    if (picking || !profile) return
    Alert.alert(t('docs.addDoc'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('docs.scanDoc'), onPress: scanDocument },
      { text: t('docs.chooseFile'), onPress: pickFile },
    ])
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
          await supabase.storage.from('documents').remove([doc.file_path])
          await supabase.from('documents').delete().eq('id', doc.id)
          track('doc.deleted', { title: doc.title, category: doc.category })
          setEditing(null)   // the sheet is open on the row we just removed
          load()
        },
      },
    ])
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <View style={{ paddingHorizontal: sp.lg }}>
        <AppHeader title={t('docs.title')} />
      </View>

      {/* Face ID lock toggle — only where the device supports biometrics */}
      {canLock ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: sp.md,
            marginHorizontal: sp.lg,
            marginBottom: sp.md,
            paddingHorizontal: sp.md,
            paddingVertical: 10,
            borderRadius: radius.md,
            backgroundColor: c.card,
          }}
        >
          <Lock size={20} color={lockOn ? c.accent : c.textFaint} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt style={{ fontWeight: '600' }}>{t('vault.lockTitle')}</Txt>
            <Txt variant="faint">{t('vault.lockDesc')}</Txt>
          </View>
          <Switch
            value={lockOn}
            onValueChange={toggleLock}
            trackColor={{ true: c.accent }}
            accessibilityLabel={lockOn ? t('vault.disableLock') : t('vault.enableLock')}
          />
        </View>
      ) : null}

      {/* person filter — only for households with more than one member (nothing
          to narrow otherwise). Everyone · each member · Shared. */}
      {profiles.length > 1 ? (
        <>
          <Txt variant="label" style={{ paddingHorizontal: sp.lg, paddingBottom: 4 }}>
            {t('docs.owner')}
          </Txt>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0, flexShrink: 0 }}
            contentContainerStyle={{
              paddingHorizontal: sp.lg,
              gap: sp.sm,
              paddingBottom: sp.sm,
              alignItems: 'center',
            }}
          >
            <FilterChip active={person === 'all'} onPress={() => setPerson('all')}>
              {t('common.everyone')}
            </FilterChip>
            {profiles.map((p) => (
              <FilterChip key={p.email} active={person === p.email} onPress={() => setPerson(p.email)}>
                {nameOf(p.email)}
              </FilterChip>
            ))}
            <FilterChip active={person === 'shared'} onPress={() => setPerson('shared')}>
              {t('docs.shared')}
            </FilterChip>
          </ScrollView>
        </>
      ) : null}

      {/* category filter — flexGrow:0 stops the horizontal ScrollView from
          filling the parent's height (which would stretch the chips tall);
          alignItems:center keeps each chip at its natural height. */}
      <Txt variant="label" style={{ paddingHorizontal: sp.lg, paddingBottom: 4 }}>
        {t('docs.type')}
      </Txt>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, flexShrink: 0 }}
        contentContainerStyle={{
          paddingHorizontal: sp.lg,
          gap: sp.sm,
          paddingBottom: sp.md,
          alignItems: 'center',
        }}
      >
        <FilterChip active={filter === 'all'} onPress={() => setFilter('all')}>
          {t('common.all')}
        </FilterChip>
        {CATEGORIES.map((cat) => (
          <FilterChip key={cat.id} active={filter === cat.id} onPress={() => setFilter(cat.id)}>
            {cat.icon} {t(`docCat.${cat.id}` as TKey)}
          </FilterChip>
        ))}
      </ScrollView>

      {loading ? (
        <Loader />
      ) : visible.length === 0 ? (
        <EmptyState title={t('docs.empty')} subtitle={t('docs.emptyHint')} />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: sp.md, gap: sp.lg }}
        >
          {groups.map((group) => (
            <View key={group.cat} style={{ gap: sp.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                <Txt
                  variant="label"
                  style={{ textTransform: 'uppercase', letterSpacing: 0.5, color: c.textFaint }}
                >
                  {CATEGORIES.find((cat) => cat.id === group.cat)?.icon}{' '}
                  {t(`docCat.${group.cat}` as TKey)}
                </Txt>
                <View style={{ height: 1, flex: 1, backgroundColor: c.border }} />
                <Txt variant="faint">{group.docs.length}</Txt>
              </View>
              {group.docs.map((doc) => (
                <DocRow
                  key={doc.id}
                  doc={doc}
                  ownerName={person === 'all' ? nameOf(doc.owner_email) : null}
                  opening={opening === doc.id}
                  onOpen={() => openDoc(doc)}
                  onEdit={() => setEditing(doc)}
                />
              ))}
            </View>
          ))}
        </ScrollView>
      )}

      {/* Bottom action — in NORMAL flow (not an absolute overlay), so the doc
          list ends AT the button instead of scrolling underneath it. The branch
          above is flex:1, so this stays pinned to the bottom in every state. */}
      <NewItemButton label={t('docs.addDoc')} onPress={startAdd} loading={picking} />

      {pending && profile && (
        <UploadSheet
          file={pending}
          profile={profile}
          profiles={profiles}
          defaultCategory={filter !== 'all' ? filter : 'other'}
          defaultOwner={profile.email}
          onClose={() => setPending(null)}
          onSaved={() => {
            setPending(null)
            load()
          }}
        />
      )}

      {editing && (
        <EditSheet
          doc={editing}
          profiles={profiles}
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

function DocRow({
  doc,
  ownerName,
  opening,
  onOpen,
  onEdit,
}: {
  doc: FamilyDocument
  /** Owner's first name, shown in the subtitle only in the "Everyone" view. */
  ownerName?: string | null
  opening: boolean
  onOpen: () => void
  onEdit: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const Icon = CAT_LUCIDE[doc.category] ?? FileText
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: sp.md,
        backgroundColor: c.card,
        borderRadius: radius.md,
        paddingHorizontal: sp.lg,
        paddingVertical: sp.md,
        opacity: opening ? 0.6 : 1,
      }}
    >
      <Pressable
        onPress={onOpen}
        style={{ flexDirection: 'row', alignItems: 'center', gap: sp.md, flex: 1, minWidth: 0 }}
      >
        <Icon size={20} color={c.textMuted} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt style={{ fontWeight: '500' }} numberOfLines={1}>
            {doc.title}
          </Txt>
          <Txt variant="faint" numberOfLines={1}>
            {ownerName ? `${ownerName} · ` : ''}
            {formatDay(doc.created_at.slice(0, 10))} · {formatBytes(doc.size_bytes)}
          </Txt>
        </View>
      </Pressable>
      {/* Two trailing controls that must not read as one: the pencil is a real
          BUTTON (bordered, raised off the card) going to the details sheet; the
          chevron is the flat affordance for the row's own tap. Giving the
          pencil a box is what separates them — as two bare glyphs side by side
          they looked like a single control. */}
      <Pressable
        onPress={onEdit}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('common.editName', { name: doc.title })}
        style={({ pressed }) => [
          {
            width: 34,
            height: 34,
            borderRadius: radius.md,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
            backgroundColor: c.surface,
            alignItems: 'center',
            justifyContent: 'center',
            // Lifts it off the card so it reads as pressable rather than
            // decorative — the "floating" the chevron deliberately lacks.
            shadowColor: '#000',
            shadowOpacity: 0.12,
            shadowRadius: 3,
            shadowOffset: { width: 0, height: 1 },
            elevation: 2,
          },
          pressed && { opacity: 0.6 },
        ]}
      >
        <Pencil size={16} color={c.text} />
      </Pressable>
      {/* Opens the document, same as the row body — a chevron that did nothing
          when tapped would be a lie about what it points at. */}
      <Pressable onPress={onOpen} hitSlop={8} accessibilityLabel={t('common.openName', { name: doc.title })}>
        <ChevronRight size={20} color={c.textFaint} />
      </Pressable>
    </View>
  )
}

function FilterChip({
  active,
  onPress,
  children,
}: {
  active: boolean
  onPress: () => void
  children: React.ReactNode
}) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: radius.pill,
        backgroundColor: active ? c.accent : c.surface,
      }}
    >
      <Txt style={{ color: active ? c.onAccent : c.textMuted, fontWeight: '600', fontSize: 14 }}>
        {children}
      </Txt>
    </Pressable>
  )
}
