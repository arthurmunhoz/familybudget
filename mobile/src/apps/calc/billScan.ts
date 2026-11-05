// Bill photo → line items, via the deployed /api/scan-bill (Claude vision).
// Moved out of the old ItemSplit form so the by-item wizard can drive the
// camera, the processing screen and the result as separate steps.
//
// The bill itself is READ-ONLY by design (owner decision): items, prices and
// tax come only from the scan. People can drop a misread line, or re-scan.
import * as ImagePicker from 'expo-image-picker'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'

import { supabase } from '@/lib/supabase'

import type { SplitItem } from './splitMath'

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? ''

export interface ScannedBill {
  items: SplitItem[]
  tax: number
  /** A tip already printed on the receipt, if any. */
  tip: number
}

/** Why a scan failed, so the screen can say something useful. */
export class ScanError extends Error {
  constructor(
    public reason: 'monthly_cap' | 'no_items' | 'failed',
    message?: string,
  ) {
    super(message ?? reason)
  }
}

/** Open the camera (or the library) and return the picked photo's uri, or
 *  null when the user cancelled or refused permission. */
export async function pickBillPhoto(fromCamera: boolean): Promise<string | null | 'denied'> {
  const perm = fromCamera
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!perm.granted) return 'denied'
  const result = fromCamera
    ? await ImagePicker.launchCameraAsync({ quality: 1 })
    : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 })
  if (result.canceled || !result.assets[0]) return null
  return result.assets[0].uri
}

let seq = 1

/** Resize + upload the photo and parse the reply. Each scan is metered per
 *  household server-side (free plans have a monthly cap). */
export async function scanBill(uri: string, signal?: AbortSignal): Promise<ScannedBill> {
  const ctx = ImageManipulator.manipulate(uri).resize({ width: 1200 })
  const ref = await ctx.renderAsync()
  const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true })
  if (!out.base64) throw new ScanError('failed')

  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  const res = await fetch(`${API_BASE}/api/scan-bill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ image: out.base64, media_type: 'image/jpeg' }),
    signal,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (json.reason === 'monthly_cap') throw new ScanError('monthly_cap', json.error)
    throw new ScanError('failed', json.error)
  }

  const items: SplitItem[] = (json.items ?? [])
    .filter((it: { name?: unknown }) => it && typeof it.name === 'string')
    .map((it: { name: string; price: number }) => ({
      id: `it-${seq++}`,
      name: it.name,
      price: Number.isFinite(it.price) ? it.price : 0,
      people: [],
    }))
  if (items.length === 0) throw new ScanError('no_items')
  return {
    items,
    tax: Number.isFinite(json.tax) && json.tax > 0 ? json.tax : 0,
    tip: Number.isFinite(json.tip) && json.tip > 0 ? json.tip : 0,
  }
}
