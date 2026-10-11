/**
 * @/components/Pressable — the Android "stuck disabled" workaround.
 *
 * On Android (RN 0.85, New Architecture) an update to `disabled` on an
 * EXISTING view can be lost: the native view stays enabled=false while the
 * button looks enabled, and finger taps are dropped (Onboarding's Continue,
 * 2026-10-11). The wrapper keys on `disabled`, so every flip mounts a fresh
 * native view that is created with the right state. These tests pin exactly
 * that: a flip replaces the host view, anything else keeps it.
 */
import React from 'react'
import { Text } from 'react-native'
import { act, create, type ReactTestInstance } from 'react-test-renderer'

import { Pressable } from '@/components/Pressable'

function hostView(root: ReactTestInstance): ReactTestInstance {
  // The innermost host node carrying our testID — what Fabric would mount.
  const all = root.findAll((n) => n.props.testID === 'btn' && typeof n.type === 'string')
  return all[all.length - 1]
}

function render(props: { disabled?: boolean; onPress?: () => void; label?: string }) {
  return (
    <Pressable testID="btn" disabled={props.disabled} onPress={props.onPress}>
      <Text>{props.label ?? 'Continue'}</Text>
    </Pressable>
  )
}

describe('Pressable (Android disabled-flip workaround)', () => {
  it('mounts a NEW native view when disabled flips true → false', () => {
    let r!: ReturnType<typeof create>
    act(() => {
      r = create(render({ disabled: true }))
    })
    const before = hostView(r.root)
    act(() => r.update(render({ disabled: false })))
    const after = hostView(r.root)
    expect(after).not.toBe(before)
    expect(after.props.accessibilityState).toEqual(expect.objectContaining({ disabled: false }))
  })

  it('and again false → true (busy flags)', () => {
    let r!: ReturnType<typeof create>
    act(() => {
      r = create(render({ disabled: false }))
    })
    const before = hostView(r.root)
    act(() => r.update(render({ disabled: true })))
    expect(hostView(r.root)).not.toBe(before)
  })

  it('keeps the same view across ordinary re-renders (no remount churn)', () => {
    let r!: ReturnType<typeof create>
    act(() => {
      r = create(render({ disabled: false, label: 'a' }))
    })
    const before = hostView(r.root)
    act(() => r.update(render({ disabled: false, label: 'b' })))
    expect(hostView(r.root)).toBe(before)
  })

  it('every Pressable with a `disabled` prop in src/ is the wrapper, not react-native\'s', () => {
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')
    const root = path.resolve(__dirname, '../src')
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.tsx$/.test(e.name) && !p.endsWith(path.join('components', 'Pressable.tsx'))) {
          const s = fs.readFileSync(p, 'utf8')
          const usesDisabled = /<Pressable\b[^>]*\bdisabled=/s.test(s)
          const importsRN = /import\s*\{[^}]*\bPressable\b[^}]*\}\s*from\s*'react-native'/s.test(s)
          if (usesDisabled && importsRN) offenders.push(path.relative(root, p))
        }
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })
})
