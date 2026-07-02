// Document Vault — the module's main screen (RN port of the PWA DocumentVault).
// Documents grouped by category, each row showing a title + a category type
// icon. Tapping a row opens the file via a signed URL in the in-app browser;
// the pencil edits the row; the X deletes (with an Alert confirm). The bottom
// bar picks a file (images + PDF only) → shows the UploadSheet.
import { useMemo, useState } from 'react'
import { Alert, Pressable, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import * as WebBrowser from 'expo-web-browser'
import { FileText, Pencil, Plus, X } from 'lucide-react-native'

import { AppHeader, Btn, EmptyState, Loader, Txt } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { useCachedQuery } from '@/hooks/useCachedQuery'
import { useI18n } from '@/hooks/useI18n'
import type { TKey } from '@/lib/i18n'
import { formatDay } from '@/lib/format'
import { getSignedUrl } from '@/lib/signedUrls'
import { supabase } from '@/lib/supabase'
import type { DocCategory, FamilyDocument } from '@/lib/types'
import { radius, sp, useTheme } from '@/theme/theme'
import { CATEGORIES, CAT_LUCIDE, formatBytes } from './docUtils'
import UploadSheet, { type PickedFile } from './UploadSheet'
import EditSheet from './EditSheet'

const MAX_SIZE = 20 * 1024 * 1024 // bucket limit
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif']

export default function DocumentVault() {
  const { c } = useTheme()
  const { t } = useI18n()
  const { profile, profiles } = useAuth()

  const [filter, setFilter] = useState<DocCategory | 'all'>('all')

  const [pending, setPending] = useState<PickedFile | null>(null)
  const [editing, setEditing] = useState<FamilyDocument | null>(null)
  const [picking, setPicking] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)

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

  // Documents that match the active category filter.
  const visible = useMemo(
    () => (filter === 'all' ? docs : docs.filter((d) => d.category === filter)),
    [docs, filter],
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

  async function openDoc(doc: FamilyDocument) {
    if (opening) return
    setOpening(doc.id)
    const url = await getSignedUrl(doc.file_path)
    setOpening(null)
    if (!url) {
      Alert.alert(t('docs.openFailed'))
      return
    }
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
          load()
        },
      },
    ])
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <View style={{ paddingHorizontal: sp.lg }}>
        <AppHeader title={t('docs.title')} right={<FileText size={22} color={c.accent} />} />
      </View>

      {/* category filter — flexGrow:0 stops the horizontal ScrollView from
          filling the parent's height (which would stretch the chips tall);
          alignItems:center keeps each chip at its natural height. */}
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
          contentContainerStyle={{ paddingHorizontal: sp.lg, paddingBottom: 120, gap: sp.lg }}
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
                  opening={opening === doc.id}
                  onOpen={() => openDoc(doc)}
                  onEdit={() => setEditing(doc)}
                  onDelete={() => removeDoc(doc)}
                />
              ))}
            </View>
          ))}
        </ScrollView>
      )}

      {/* bottom action bar */}
      <SafeAreaView edges={['bottom']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <View style={{ paddingHorizontal: sp.lg, paddingTop: sp.sm, paddingBottom: sp.sm }}>
          <Btn
            title={t('docs.addDoc')}
            onPress={pickFile}
            loading={picking}
          />
        </View>
      </SafeAreaView>

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
        />
      )}
    </SafeAreaView>
  )
}

function DocRow({
  doc,
  opening,
  onOpen,
  onEdit,
  onDelete,
}: {
  doc: FamilyDocument
  opening: boolean
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
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
            {formatDay(doc.created_at.slice(0, 10))} · {formatBytes(doc.size_bytes)}
          </Txt>
        </View>
      </Pressable>
      <Pressable onPress={onEdit} hitSlop={8} accessibilityLabel={t('common.editName', { name: doc.title })}>
        <Pencil size={18} color={c.textFaint} />
      </Pressable>
      <Pressable onPress={onDelete} hitSlop={8} accessibilityLabel={t('common.deleteName', { name: doc.title })}>
        <X size={18} color={c.textFaint} />
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
      <Txt style={{ color: active ? '#fff' : c.textMuted, fontWeight: '600', fontSize: 14 }}>
        {children}
      </Txt>
    </Pressable>
  )
}
