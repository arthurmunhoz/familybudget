// Photo frame — data: the family album (Supabase table `frame_photos`,
// migration 100, bytes in the `documents` bucket at <household>/frame/<uuid>.jpg),
// the LOCAL cache that makes the slideshow run offline, this device's own
// photos (never uploaded) and the per-device frame settings.
//
// Egress rule: a frame left on all day must not download the same photo
// hundreds of times. Every album photo is downloaded ONCE into
// Paths.document/frame-cache/<photo id>.jpg (document dir: iOS doesn't purge
// it under storage pressure the way it does the cache dir) and the slideshow
// only ever reads those files. The list itself is re-read on Realtime /
// foreground; a deleted photo's file is pruned on the next sync.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Directory, File, Paths } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'

import { getSignedUrls } from '@/lib/signedUrls'
import { supabase } from '@/lib/supabase'
import { limitKind, resizeTarget, UPLOAD_QUALITY, type FrameLimitKind } from './frameLogic'

const BUCKET = 'documents'

export interface FramePhoto {
  id: string
  path: string
  added_by: string | null
  member_email: string | null
  width: number | null
  height: number | null
  created_at: string
}

export interface FrameQuota {
  used: number
  cap: number
  plus: boolean
}

// ── album (server) ───────────────────────────────────────────────────────────

export async function fetchAlbum(): Promise<FramePhoto[]> {
  const { data, error } = await supabase
    .from('frame_photos')
    .select('id, path, added_by, member_email, width, height, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as FramePhoto[]
}

/** Server-side count + cap (frame_photo_quota, migration 100); null when the
 *  RPC isn't there or fails — callers fall back to the local count. */
export async function fetchQuota(): Promise<FrameQuota | null> {
  const { data, error } = await supabase.rpc('frame_photo_quota')
  if (error || !data) return null
  return data as FrameQuota
}

function randomUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    const v = ch === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** Resize to the album size and save as JPEG; returns the local file. */
async function shrink(uri: string, width: number, height: number): Promise<{ uri: string; width: number; height: number }> {
  const target = resizeTarget(width, height)
  const ctx = ImageManipulator.manipulate(uri)
  if (target) ctx.resize(target)
  const ref = await ctx.renderAsync()
  const saved = await ref.saveAsync({ format: SaveFormat.JPEG, compress: UPLOAD_QUALITY })
  return { uri: saved.uri, width: saved.width, height: saved.height }
}

export type AddResult = { added: number; limit: FrameLimitKind; failed: number }

/** Upload picked photos to the family album, one at a time (stops at the
 *  plan's limit — the trigger is the judge). Each uploaded file is also
 *  copied straight into this device's cache, so the uploader never downloads
 *  its own photos back. */
export async function addFamilyPhotos(
  householdId: string,
  assets: { uri: string; width: number; height: number }[],
  onProgress?: (done: number) => void,
): Promise<AddResult> {
  let added = 0
  let failed = 0
  for (const a of assets) {
    try {
      const small = await shrink(a.uri, a.width, a.height)
      const bytes = await new File(small.uri).arrayBuffer()
      const path = `${householdId}/frame/${randomUUID()}.jpg`
      const up = await supabase.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: 'image/jpeg', cacheControl: '604800' })
      if (up.error) throw up.error
      const { data, error } = await supabase
        .from('frame_photos')
        .insert({ path, width: small.width, height: small.height })
        .select('id')
        .single()
      if (error) {
        // The row was refused (limit or RLS): don't leave the bytes behind.
        await supabase.storage.from(BUCKET).remove([path])
        const kind = limitKind(error.message)
        if (kind) return { added, limit: kind, failed }
        throw error
      }
      try {
        const dest = cacheFile((data as { id: string }).id)
        if (!dest.exists) new File(small.uri).copySync(dest)
      } catch {
        // cache warm-up only; the next sync downloads it
      }
      added += 1
    } catch {
      failed += 1
    }
    onProgress?.(added + failed)
  }
  return { added, limit: null, failed }
}

/** Delete an album photo: the row first (RLS decides — own photo, or any if
 *  you're the owner), then its bytes and this device's cached copy. */
export async function deleteFamilyPhoto(photo: FramePhoto): Promise<boolean> {
  const { data, error } = await supabase.from('frame_photos').delete().eq('id', photo.id).select('id')
  if (error || !data?.length) return false
  await supabase.storage.from(BUCKET).remove([photo.path])
  try {
    const f = cacheFile(photo.id)
    if (f.exists) f.delete()
  } catch {
    // pruned on the next sync anyway
  }
  return true
}

export async function setPhotoTag(id: string, memberEmail: string | null): Promise<boolean> {
  const { data, error } = await supabase.from('frame_photos').update({ member_email: memberEmail }).eq('id', id).select('id')
  return !error && !!data?.length
}

// ── local cache ──────────────────────────────────────────────────────────────

function cacheDir(): Directory {
  const d = new Directory(Paths.document, 'frame-cache')
  if (!d.exists) d.create({ intermediates: true, idempotent: true })
  return d
}

export function cacheFile(id: string): File {
  return new File(cacheDir(), `${id}.jpg`)
}

/** Local file uri for a photo if it's already cached. */
export function cachedUri(id: string): string | null {
  try {
    const f = cacheFile(id)
    return f.exists && f.size > 0 ? f.uri : null
  } catch {
    return null
  }
}

const manifestKey = (householdId: string) => `frame:manifest:v1:${householdId}`

/** The last album list this device saw for that household — the slideshow's
 *  offline fallback. */
export async function loadManifest(householdId: string): Promise<FramePhoto[]> {
  try {
    const raw = await AsyncStorage.getItem(manifestKey(householdId))
    return raw ? (JSON.parse(raw) as FramePhoto[]) : []
  } catch {
    return []
  }
}

async function saveManifest(householdId: string, rows: FramePhoto[]) {
  try {
    await AsyncStorage.setItem(manifestKey(householdId), JSON.stringify(rows))
  } catch {
    // best effort
  }
}

let syncing: Promise<void> | null = null

/** Bring the cache in line with `rows`: download what's missing (ONCE, two
 *  at a time), delete files whose photo is gone. Calls `onFile` as each new
 *  file lands so the slideshow can add it without waiting for the rest. */
export function syncCache(householdId: string, rows: FramePhoto[], onFile?: (id: string) => void): Promise<void> {
  const run = async () => {
    await saveManifest(householdId, rows)
    const dir = cacheDir()
    const keep = new Set(rows.map((r) => `${r.id}.jpg`))
    for (const entry of dir.list()) {
      if (entry instanceof File && !keep.has(entry.name)) {
        try {
          entry.delete()
        } catch {
          // ignore
        }
      }
    }
    const missing = rows.filter((r) => !cachedUri(r.id))
    if (!missing.length) return
    const urls = await getSignedUrls(missing.map((r) => r.path))
    const queue = missing.slice()
    const worker = async () => {
      for (let r = queue.shift(); r; r = queue.shift()) {
        const url = urls[r.path]
        if (!url) continue
        const dest = cacheFile(r.id)
        try {
          await File.downloadFileAsync(url, dest, { idempotent: true })
          onFile?.(r.id)
        } catch {
          try {
            if (dest.exists) dest.delete() // never keep a half file
          } catch {
            // ignore
          }
        }
      }
    }
    await Promise.all([worker(), worker()])
  }
  // One sync at a time; a second caller waits for the running one and then
  // runs with ITS rows (the newer list).
  const next = (syncing ?? Promise.resolve()).then(run, run)
  syncing = next.finally(() => {
    if (syncing === next) syncing = null
  })
  return next
}

/** How much this device's album cache holds (bytes). */
export function cacheBytes(): number {
  try {
    return cacheDir()
      .list()
      .reduce((n, e) => n + (e instanceof File ? e.size : 0), 0)
  } catch {
    return 0
  }
}

// ── this device's photos (never uploaded) ────────────────────────────────────

export interface DevicePhoto {
  id: string
  width: number
  height: number
}

const DEVICE_KEY = 'frame:device:v1'

function deviceDir(): Directory {
  const d = new Directory(Paths.document, 'frame-device')
  if (!d.exists) d.create({ intermediates: true, idempotent: true })
  return d
}

export function deviceUri(id: string): string {
  return new File(deviceDir(), `${id}.jpg`).uri
}

export async function loadDevicePhotos(): Promise<DevicePhoto[]> {
  try {
    const raw = await AsyncStorage.getItem(DEVICE_KEY)
    const list = raw ? (JSON.parse(raw) as DevicePhoto[]) : []
    // Drop entries whose file went missing (app data restored without files…).
    return list.filter((p) => new File(deviceDir(), `${p.id}.jpg`).exists)
  } catch {
    return []
  }
}

async function saveDevicePhotos(list: DevicePhoto[]) {
  try {
    await AsyncStorage.setItem(DEVICE_KEY, JSON.stringify(list))
  } catch {
    // best effort
  }
}

/** Copy picked photos into the app's own folder (the picker's files are
 *  temporary), at the album size so a long slideshow stays light. Nothing
 *  leaves the device. */
export async function addDevicePhotos(assets: { uri: string; width: number; height: number }[]): Promise<DevicePhoto[]> {
  const list = await loadDevicePhotos()
  for (const a of assets) {
    try {
      const small = await shrink(a.uri, a.width, a.height)
      const id = randomUUID()
      new File(small.uri).copySync(new File(deviceDir(), `${id}.jpg`))
      list.unshift({ id, width: small.width, height: small.height })
    } catch {
      // skip that one
    }
  }
  await saveDevicePhotos(list)
  return list
}

export async function removeDevicePhoto(id: string): Promise<DevicePhoto[]> {
  const list = (await loadDevicePhotos()).filter((p) => p.id !== id)
  try {
    const f = new File(deviceDir(), `${id}.jpg`)
    if (f.exists) f.delete()
  } catch {
    // ignore
  }
  await saveDevicePhotos(list)
  return list
}

// ── settings (per device: each frame in the house can be set up its own way) ─

export type FrameSource = 'family' | 'device' | 'both'
export type NightStyle = 'dim' | 'off'

export interface FrameSettings {
  source: FrameSource
  /** Seconds each photo stays. */
  seconds: number
  /** Random order (each photo once per pass) vs. the album's order. */
  random: boolean
  clock: boolean
  nextEvent: boolean
  pets: boolean
  night: boolean
  nightStart: number // hour 0–23
  nightEnd: number
  nightStyle: NightStyle
  /** Turn the picture 90° — a phone (portrait-locked app) standing sideways. */
  rotated: boolean
}

export const DEFAULT_SETTINGS: FrameSettings = {
  source: 'family',
  seconds: 15,
  random: true,
  clock: true,
  nextEvent: true,
  pets: true,
  night: false,
  nightStart: 22,
  nightEnd: 7,
  nightStyle: 'dim',
  rotated: false,
}

const SETTINGS_KEY = 'frame:settings:v1'

export async function loadSettings(): Promise<FrameSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY)
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<FrameSettings>) } : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

export async function saveSettings(s: FrameSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    // best effort
  }
}

// ── the play order (per device, like the settings) ──────────────────────────
// Long-press + drag in the set-up grids (owner, 2026-11). Stored as ids per
// source; photos not in the list (just added) go first, newest first.
export interface FrameOrder {
  family: string[]
  device: string[]
}
const ORDER_KEY = 'frame:order:v1'

export async function loadOrder(): Promise<FrameOrder> {
  try {
    const raw = await AsyncStorage.getItem(ORDER_KEY)
    const o = raw ? (JSON.parse(raw) as Partial<FrameOrder>) : {}
    return { family: o.family ?? [], device: o.device ?? [] }
  } catch {
    return { family: [], device: [] }
  }
}

export async function saveOrder(o: FrameOrder): Promise<void> {
  try {
    await AsyncStorage.setItem(ORDER_KEY, JSON.stringify(o))
  } catch {
    // best effort — the grid just falls back to newest first
  }
}
