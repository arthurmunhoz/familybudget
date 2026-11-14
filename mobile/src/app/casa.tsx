// oneroof://casa?code=K7P4QX — what the Modo Casa device's QR opens: straight
// to the Modo Casa screen with the pairing sheet and the code filled in.
import { Redirect, useLocalSearchParams } from 'expo-router'

export default function CasaLink() {
  const { code } = useLocalSearchParams<{ code?: string }>()
  return <Redirect href={code ? `/casa-mode?pair=${encodeURIComponent(code)}` : '/casa-mode'} />
}
