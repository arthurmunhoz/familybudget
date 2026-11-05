// Getting a file INTO the vault — shared by "Add document" and "Replace file"
// (EditSheet). Moved out of DocumentVault (2026-11) so both paths produce the
// same PickedFile the same way: a picked image/PDF, a camera photo, or a
// VisionKit scan (one page → JPEG, several → one PDF). Every function returns
// the file, or null when the user cancelled; failures alert and return null.
import { Alert } from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { PDFDocument } from 'pdf-lib'
import { File } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'

import type { TKey } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import { THUMB_WIDTH, formatBytes, thumbPathFor } from './docUtils'
import type { PickedFile } from './UploadSheet'

type T = (key: TKey, params?: Record<string, string | number>) => string

export const MAX_SIZE = 20 * 1024 * 1024 // bucket limit
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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-document-scanner-plugin').default as Scanner
  } catch {
    return null
  }
}

/** Choose an existing image or PDF. Big photos are downscaled (~2048px). */
export async function pickFile(t: T): Promise<PickedFile | null> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['image/*', 'application/pdf'],
      copyToCacheDirectory: true,
      multiple: false,
    })
    if (result.canceled || !result.assets[0]) return null
    const asset = result.assets[0]
    const initialSize = asset.size ?? new File(asset.uri).size ?? 0
    if (initialSize > MAX_SIZE) {
      Alert.alert(t('docs.tooBig', { size: formatBytes(initialSize) }))
      return null
    }
    const rawExt = (asset.name.split('.').pop() ?? '').toLowerCase()
    const isImage = (asset.mimeType?.startsWith('image/') ?? false) || IMAGE_EXTS.includes(rawExt)
    // The bucket only accepts image/* + application/pdf, so when the picker
    // doesn't report a type, infer it from the extension.
    let uri = asset.uri
    let ext = rawExt || (isImage ? 'jpg' : 'pdf')
    let mime = asset.mimeType || (ext === 'pdf' ? 'application/pdf' : `image/${ext === 'jpg' ? 'jpeg' : ext}`)
    // Downscale big photos (long edge ~2048px, JPEG) only when clearly over
    // ~0.6MB, so screenshots and PDFs upload untouched. Original on error.
    if (isImage && initialSize > 600 * 1024) {
      try {
        const ref = await ImageManipulator.manipulate(asset.uri).resize({ width: 2048 }).renderAsync()
        const done = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 })
        uri = done.uri
        ext = 'jpg'
        mime = 'image/jpeg'
      } catch {
        /* keep the original file if manipulation fails */
      }
    }
    const bytes = new Uint8Array(await new File(uri).arrayBuffer())
    return { name: asset.name, uri, size: bytes.byteLength, bytes, mime, ext, thumbUri: isImage ? uri : undefined }
  } catch {
    Alert.alert(t('docs.uploadFailed'))
    return null
  }
}

async function fromImage(uri: string, t: T): Promise<PickedFile | null> {
  try {
    const ref = await ImageManipulator.manipulate(uri).resize({ width: 2048 }).renderAsync()
    const done = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 })
    const bytes = new Uint8Array(await new File(done.uri).arrayBuffer())
    return {
      name: `${t('docs.scanName')}.jpg`,
      uri: done.uri,
      size: bytes.byteLength,
      bytes,
      mime: 'image/jpeg',
      ext: 'jpg',
      thumbUri: done.uri,
    }
  } catch {
    Alert.alert(t('docs.uploadFailed'))
    return null
  }
}

/** Several scanned pages → ONE multi-page PDF (pdf-lib, pure JS). */
async function fromPages(uris: string[], t: T): Promise<PickedFile | null> {
  try {
    const pdf = await PDFDocument.create()
    let firstPage: string | undefined
    for (const uri of uris) {
      const ref = await ImageManipulator.manipulate(uri).resize({ width: 2048 }).renderAsync()
      const done = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 })
      firstPage ??= done.uri
      const img = await pdf.embedJpg(new Uint8Array(await new File(done.uri).arrayBuffer()))
      const page = pdf.addPage([img.width, img.height])
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height })
    }
    const pdfBytes = await pdf.save()
    if (pdfBytes.byteLength > MAX_SIZE) {
      Alert.alert(t('docs.tooBig', { size: formatBytes(pdfBytes.byteLength) }))
      return null
    }
    return {
      name: `${t('docs.scanName')}.pdf`,
      uri: '',
      size: pdfBytes.byteLength,
      bytes: pdfBytes,
      mime: 'application/pdf',
      ext: 'pdf',
      thumbUri: firstPage,
    }
  } catch {
    Alert.alert(t('docs.uploadFailed'))
    return null
  }
}

/** Plain camera capture — the fallback when the scanner module is absent. */
async function takePhoto(t: T): Promise<PickedFile | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync()
  if (!perm.granted) {
    Alert.alert(t('docs.cameraDenied'))
    return null
  }
  const result = await ImagePicker.launchCameraAsync({ quality: 1 })
  if (result.canceled || !result.assets[0]) return null
  return fromImage(result.assets[0].uri, t)
}

/** Scan with the OS document scanner (VisionKit on iOS): edge detection,
 *  auto-capture, perspective-corrected crop. One page → JPEG; more → PDF. */
export async function scanDocument(t: T): Promise<PickedFile | null> {
  const scanner = loadScanner()
  if (!scanner) return takePhoto(t)
  let images: string[]
  try {
    const { scannedImages, status } = await scanner.scanDocument({ croppedImageQuality: 100 })
    if (status !== 'success' || !scannedImages?.length) return null // cancelled
    images = scannedImages
  } catch {
    return takePhoto(t)
  }
  return images.length === 1 ? fromImage(images[0], t) : fromPages(images, t)
}

/** Best-effort: a small JPEG of the document at its derived thumb path. Never
 *  throws — a missing thumbnail only means the list shows a placeholder. */
export async function uploadThumb(srcUri: string, filePath: string) {
  try {
    const ref = await ImageManipulator.manipulate(srcUri).resize({ width: THUMB_WIDTH }).renderAsync()
    const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.6 })
    const bytes = new Uint8Array(await new File(out.uri).arrayBuffer())
    await supabase.storage
      .from('documents')
      .upload(thumbPathFor(filePath), bytes, { contentType: 'image/jpeg', cacheControl: '604800' })
  } catch {
    /* no thumbnail — the list falls back */
  }
}

