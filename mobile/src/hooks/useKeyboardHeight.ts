// Current keyboard height, 0 when hidden.
//
// Why not KeyboardAvoidingView: inside a RN <Modal> the modal is a separate
// native view hierarchy, so KAV's measurements are unreliable and a bottom sheet
// ends up only partially clearing the keyboard. Reading the real height and
// shifting the sheet by exactly that much is deterministic — the whole drawer
// moves up, which is what you actually want from a bottom sheet.
//
// Uses the `will` events on iOS so the sheet animates in step with the keyboard
// rather than snapping after it has already appeared.
import { useEffect, useState } from 'react'
import { Keyboard, Platform } from 'react-native'

export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const show = Keyboard.addListener(showEvent, (e) => setHeight(e.endCoordinates?.height ?? 0))
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  return height
}
