// Turning a printable card on screen into an image and onto paper.
//
// ONE source of truth for the artwork: the card is a normal RN view, rendered
// in the preview; we snapshot THAT view (react-native-view-shot) at print
// resolution and either hand the PNG to the share sheet (which is where "Save
// Image" lives on iOS — no photo-library permission needed) or wrap it in a
// tiny HTML page sized in real inches and send that to the native print
// dialog (expo-print → UIPrintInteractionController / Android print service).
// No second HTML rendering of the card that could drift from the preview.
//
// All three native modules are loaded LAZILY: they were added after builds
// that are already on people's phones, and a static import of a module the
// running binary lacks throws at import and takes the whole route down (see
// mobile/CLAUDE.md, "Don't statically import a native module…"). Without them
// the screen still renders and edits; print/save explain that an update is
// needed.
import type { RefObject } from 'react'
import type { View } from 'react-native'

type ViewShot = typeof import('react-native-view-shot')
type ExpoPrint = typeof import('expo-print')
type ExpoSharing = typeof import('expo-sharing')

function loadViewShot(): ViewShot | null {
  try {
    return require('react-native-view-shot') as ViewShot
  } catch {
    return null
  }
}
function loadPrint(): ExpoPrint | null {
  try {
    return require('expo-print') as ExpoPrint
  } catch {
    return null
  }
}
function loadSharing(): ExpoSharing | null {
  try {
    return require('expo-sharing') as ExpoSharing
  } catch {
    return null
  }
}

/** Print resolution for the snapshot. 300 dpi is what a home printer can
 *  actually lay down; more just makes a bigger file. */
const DPI = 300

export class NeedsUpdateError extends Error {}

export interface PrintSpec {
  widthIn: number
  heightIn: number
  /** Copies laid out on one sheet (e.g. a tag for each bag). */
  perPage: number
  /** Small line under the cards ("Cut along the dashed line"). */
  caption: string
}

async function snapshot(ref: RefObject<View | null>, widthIn: number, heightIn: number, result: 'base64' | 'tmpfile') {
  const shot = loadViewShot()
  if (!shot || !ref.current) throw new NeedsUpdateError()
  return shot.captureRef(ref, {
    format: 'png',
    quality: 1,
    result,
    width: Math.round(widthIn * DPI),
    height: Math.round(heightIn * DPI),
  })
}

/** Open the system print dialog with `perPage` copies of the card at its real
 *  physical size, each inside a dashed cut guide. */
export async function printCard(ref: RefObject<View | null>, spec: PrintSpec): Promise<void> {
  const print = loadPrint()
  if (!print) throw new NeedsUpdateError()
  const b64 = await snapshot(ref, spec.widthIn, spec.heightIn, 'base64')
  await print.printAsync({ html: cardSheetHtml(b64, spec) })
}

/** Snapshot the card to a PNG and open the share sheet (Save Image, AirDrop,
 *  Messages, Files…). */
export async function shareCard(
  ref: RefObject<View | null>,
  spec: Pick<PrintSpec, 'widthIn' | 'heightIn'>,
  dialogTitle: string,
): Promise<void> {
  const sharing = loadSharing()
  if (!sharing) throw new NeedsUpdateError()
  const uri = await snapshot(ref, spec.widthIn, spec.heightIn, 'tmpfile')
  const file = uri.startsWith('file://') ? uri : `file://${uri}`
  const opts = { mimeType: 'image/png', UTI: 'public.png', dialogTitle }
  try {
    await sharing.shareAsync(file, opts)
  } catch (err) {
    // iOS refuses to present the share sheet while another controller is
    // still animating away — right after closing the print dialog, the first
    // tap failed every time on the simulator. One retry once it has settled.
    if (/cancel/i.test(String(err))) throw err
    await new Promise((r) => setTimeout(r, 700))
    await sharing.shareAsync(file, opts)
  }
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The printed sheet. Exported for tests — sizes MUST be in inches, or the
 *  card prints at whatever size the WebView felt like. */
export function cardSheetHtml(base64Png: string, spec: PrintSpec): string {
  const w = `${spec.widthIn}in`
  const h = `${spec.heightIn}in`
  const card = `<div class="cut"><img src="data:image/png;base64,${base64Png}" /></div>`
  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
<style>
  @page { margin: 0.5in; }
  html, body { margin: 0; padding: 0; }
  .sheet { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.35in; padding-top: 0.25in; }
  .cut { border: 1px dashed #9a948d; border-radius: 0.14in; padding: 0.06in; }
  img { display: block; width: ${w}; height: ${h}; border-radius: 0.1in; }
  p { font: 9pt -apple-system, Roboto, sans-serif; color: #8a8580; text-align: center; margin-top: 0.2in; }
</style></head><body>
<div class="sheet">${Array.from({ length: Math.max(1, spec.perPage) }, () => card).join('')}</div>
<p>${esc(spec.caption)}</p>
</body></html>`
}
