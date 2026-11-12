// Document Vault › the "one at a time" view (owner, 2026-11): the same
// documents as the list (same filters, same order), one per page, the page
// shown LARGE so you can read it without opening it. Swipe sideways to move
// through them; "Open" shows the real file, "…" the details sheet.
//
// What's drawn, best first (all signed by the screen in one batch):
//   1. the document's PREVIEW (`previewPathFor`, ~1240 px, written at upload
//      since 2026-11 — readable),
//   2. an image document's own file (≤2048 px — readable),
//   3. the small list thumbnail (320 px — older PDFs; legible headlines only,
//      so the card says "open to read it all"),
//   4. a typed tile (category glyph).
import { useMemo, useState } from 'react'
import { FlatList, StyleSheet, useWindowDimensions, View, type ViewToken } from 'react-native'
import { Image } from 'expo-image'
import { ExternalLink, FileText, MoreHorizontal } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { formatDay } from '@/lib/format'
import type { FamilyDocument } from '@/lib/types'
import { fonts, radius, sp, useTheme } from '@/theme/theme'
import { CAT_COLOR, CAT_LUCIDE, docPicture, formatBytes } from './docUtils'
import type { TKey } from '@/lib/i18n'

export function DocCards({
  docs,
  urls,
  ownerName,
  opening,
  onOpen,
  onEdit,
}: {
  docs: FamilyDocument[]
  /** Signed URLs by storage path (previews, image files, thumbs). */
  urls: Record<string, string>
  /** Owner's first name, or null when filtered to one person. */
  ownerName: (doc: FamilyDocument) => string | null
  opening: string | null
  onOpen: (doc: FamilyDocument) => void
  onEdit: (doc: FamilyDocument) => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const { width, height } = useWindowDimensions()
  const pageW = Math.min(width, 720)
  const cardW = pageW - sp.lg * 2
  // A page is portrait (A4 ≈ 1 : 1.41); never taller than ~58% of the screen
  // so the title, the buttons and the dock stay in view.
  const pictureH = Math.min(cardW * 1.38, height * 0.58)
  const [index, setIndex] = useState(0)
  // FlatList wants ONE identity for this for its whole life.
  const [onViewable] = useState(() => ({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0]
    if (first?.index != null) setIndex(first.index)
  })
  const key = useMemo(() => docs.map((d) => d.id).join(','), [docs])

  return (
    <View style={{ marginHorizontal: -sp.lg, marginTop: sp.lg }}>
      <FlatList
        key={key}
        data={docs}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(d) => d.id}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        getItemLayout={(_, i) => ({ length: pageW, offset: pageW * i, index: i })}
        initialNumToRender={2}
        windowSize={3}
        style={{ width: pageW, alignSelf: 'center' }}
        renderItem={({ item }) => (
          <View style={{ width: pageW, paddingHorizontal: sp.lg }}>
            <DocCard
              doc={item}
              urls={urls}
              pictureH={pictureH}
              owner={ownerName(item)}
              opening={opening === item.id}
              onOpen={() => onOpen(item)}
              onEdit={() => onEdit(item)}
            />
          </View>
        )}
      />
      {docs.length > 1 ? (
        <View style={s.counter}>
          <Txt style={{ fontFamily: fonts.semibold, fontSize: 13, color: c.textMuted }}>{t('docs.cardOf', { n: index + 1, total: docs.length })}</Txt>
        </View>
      ) : null}
    </View>
  )
}

function DocCard({
  doc,
  urls,
  pictureH,
  owner,
  opening,
  onOpen,
  onEdit,
}: {
  doc: FamilyDocument
  urls: Record<string, string>
  pictureH: number
  owner: string | null
  opening: boolean
  onOpen: () => void
  onEdit: () => void
}) {
  const { c } = useTheme()
  const { t } = useI18n()
  const pic = docPicture(doc, urls)
  const Icon = CAT_LUCIDE[doc.category] ?? FileText
  const tint = CAT_COLOR[doc.category] ?? c.textMuted
  return (
    <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
      {/* the page: white like paper in both themes, the document fitted whole */}
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={t('docs.openDoc', { name: doc.title })} style={[s.paper, { height: pictureH }]}>
        <View style={s.placeholder}>
          <Icon size={34} color="#B8BCC6" />
        </View>
        {pic ? (
          <Image
            source={{ uri: pic.uri, cacheKey: pic.cacheKey }}
            recyclingKey={pic.cacheKey}
            cachePolicy="memory-disk"
            contentFit={pic.sharp ? 'contain' : 'cover'}
            contentPosition="top"
            transition={150}
            style={StyleSheet.absoluteFill}
            accessibilityIgnoresInvertColors
          />
        ) : null}
        {pic && !pic.sharp ? (
          <View style={s.lowRes}>
            <Txt style={{ color: '#fff', fontSize: 12, fontFamily: fonts.semibold }}>{t('docs.openToRead')}</Txt>
          </View>
        ) : null}
      </Pressable>

      <View style={{ padding: sp.md, gap: sp.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={[s.chip, { backgroundColor: tint + '22' }]}>
            <Icon size={12} color={tint} />
            <Txt style={{ fontSize: 12, fontFamily: fonts.semibold, color: tint }}>{t(`docCat.${doc.category}` as TKey)}</Txt>
          </View>
          <Txt variant="faint" numberOfLines={1} style={{ flex: 1, fontSize: 12.5 }}>
            {owner ? `${owner} · ` : ''}
            {formatDay(doc.created_at.slice(0, 10))} · {formatBytes(doc.size_bytes)}
          </Txt>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
          <Txt style={{ flex: 1, fontFamily: fonts.display, fontSize: 20, lineHeight: 25 }} numberOfLines={2}>
            {doc.title}
          </Txt>
          <Pressable
            onPress={onEdit}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('docs.more', { name: doc.title })}
            style={({ pressed }) => [s.round, { backgroundColor: c.surface, opacity: pressed ? 0.6 : 1 }]}
          >
            <MoreHorizontal size={18} color={c.text} />
          </Pressable>
          <Pressable
            onPress={onOpen}
            disabled={opening}
            accessibilityRole="button"
            style={({ pressed }) => [s.open, { backgroundColor: c.action, opacity: opening ? 0.5 : pressed ? 0.85 : 1 }]}
          >
            <ExternalLink size={15} color={c.onAction} />
            <Txt style={{ color: c.onAction, fontFamily: fonts.semibold, fontSize: 14.5 }}>{t('docs.openBtn')}</Txt>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  card: { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  paper: { backgroundColor: '#FFFFFF', overflow: 'hidden' },
  placeholder: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  lowRes: { position: 'absolute', bottom: 10, alignSelf: 'center', backgroundColor: 'rgba(20,20,26,0.62)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  round: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  open: { height: 40, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, borderRadius: 20 },
  counter: { alignItems: 'center', marginTop: sp.sm },
})
