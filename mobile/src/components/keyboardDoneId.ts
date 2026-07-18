/** Ties a TextInput to the keyboard "Done" bar (see KeyboardDone.tsx).
 *
 *  Lives in its own dependency-free module on purpose: KeyboardDone.tsx imports
 *  `Txt` from ui.tsx, and ui.tsx's `Field` needs this id — importing it from
 *  KeyboardDone directly would make ui ⇄ KeyboardDone circular. */
export const KEYBOARD_DONE_ID = 'oneroof-keyboard-done'
