/**
 * Downscale a photo to keep the upload small and within vision-model limits.
 * Returns raw base64 (no data-URL prefix) and the media type.
 */
export async function fileToResizedBase64(
  file: File,
  maxDim = 1568,
): Promise<{ data: string; mediaType: string }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  return { data: dataUrl.split(',')[1], mediaType: 'image/jpeg' }
}
