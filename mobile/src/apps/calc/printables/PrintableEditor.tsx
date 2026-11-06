// The whole printable-card tool, driven by a template (see templates.ts):
// live preview on top, band colour, "fill from a family member", the fields,
// and Print / Save image docked at the bottom.
//
// The draft is kept per DEVICE (AsyncStorage), so next trip the tag is already
// filled in. It never leaves the phone — nothing here touches Supabase except
// reading household members' phones for the quick-fill.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, StyleSheet, useWindowDimensions, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Localization from 'expo-localization'
import { router } from 'expo-router'
import { Check } from 'lucide-react-native'

import { Pressable } from '@/components/Pressable'
import { Field, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { useAuth } from '@/lib/auth'
import { DICTS, type TKey } from '@/lib/i18n'
import { formatPhone } from '@/lib/phone'
import { fetchMemberPhones } from '@/lib/pings'
import { pickOn } from '@/theme/contrast'
import { fonts, radius, sp, useTheme } from '@/theme/theme'

import { Avatar, firstName } from '../shared'
import { WizardScreen } from '../wizard'
import { NeedsUpdateError, printCard, shareCard } from './printing'
import { CARD_COLORS, type PrintableTemplate, type PrintValues } from './templates'

const draftKey = (id: string) => `oneroof-printable:${id}`

interface Draft {
  values: PrintValues
  color: string
}

export function PrintableEditor({ template }: { template: PrintableTemplate }) {
  const { c } = useTheme()
  const { t, lang } = useI18n()
  const { profile, profiles } = useAuth()
  const { width: screenW } = useWindowDimensions()
  const cardRef = useRef<View>(null)

  const [values, setValues] = useState<PrintValues>({})
  const [color, setColor] = useState(CARD_COLORS[0])
  const [loaded, setLoaded] = useState(false)
  const [phones, setPhones] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<'print' | 'share' | null>(null)

  useEffect(() => {
    fetchMemberPhones().then(setPhones).catch(() => {})
  }, [])

  // Load the saved draft; a first visit starts from the signed-in member.
  useEffect(() => {
    let alive = true
    AsyncStorage.getItem(draftKey(template.id))
      .then((raw) => {
        if (!alive) return
        const d: Draft | null = raw ? JSON.parse(raw) : null
        if (d) {
          setValues(d.values ?? {})
          if (d.color) setColor(d.color)
        } else if (profile) {
          setValues({ name: profile.display_name ?? '', email: profile.email ?? '' })
        }
      })
      .catch(() => {})
      .finally(() => alive && setLoaded(true))
    return () => {
      alive = false
    }
  }, [template.id, profile])

  // The phone isn't on the profile; fill it once it arrives if still blank.
  useEffect(() => {
    if (!loaded || !profile?.email || !phones[profile.email]) return
    setValues((v) => (v.phone || v.email !== profile.email ? v : { ...v, phone: phones[profile.email] }))
  }, [loaded, phones, profile?.email])

  useEffect(() => {
    if (!loaded) return
    const id = setTimeout(() => {
      void AsyncStorage.setItem(draftKey(template.id), JSON.stringify({ values, color } satisfies Draft))
    }, 400)
    return () => clearTimeout(id)
  }, [values, color, loaded, template.id])

  const set = (k: string, s: string) => setValues((v) => ({ ...v, [k]: s }))

  function fillFrom(email: string, name: string) {
    setValues((v) => {
      const out = { ...v }
      for (const f of template.fields) {
        if (f.from === 'name') out[f.key] = name
        if (f.from === 'email') out[f.key] = email
        if (f.from === 'phone') out[f.key] = phones[email] ?? ''
      }
      return out
    })
  }

  // Printed labels: the app's language, with English alongside — a tag is read
  // by whoever finds the bag, often in another country.
  const printLabel = useCallback(
    (key: TKey) => (lang === 'en' ? DICTS.en[key] : `${t(key)} · ${DICTS.en[key]}`),
    [lang, t],
  )

  const ready = template.required.every((k) => (values[k] ?? '').trim())
  const previewW = Math.min(screenW - sp.lg * 2 - 80, 250)
  const members = useMemo(
    () => profiles.map((p) => ({ email: p.email, name: p.display_name?.trim() || p.email })),
    [profiles],
  )

  async function run(kind: 'print' | 'share') {
    if (!ready) {
      Alert.alert(t('printable.missingTitle'), t('printable.missingBody'))
      return
    }
    setBusy(kind)
    try {
      if (kind === 'print') {
        await printCard(cardRef, {
          widthIn: template.widthIn,
          heightIn: template.heightIn,
          perPage: template.perPage,
          caption: t('printable.cutHint'),
        })
      } else {
        await shareCard(cardRef, template, t(template.title))
      }
    } catch (err) {
      if (err instanceof NeedsUpdateError) Alert.alert(t('printable.needsUpdate'))
      // Cancelling the print dialog rejects on some platforms; that's not an error.
      else if (!/cancel/i.test(String(err))) Alert.alert(t('printable.failed'), __DEV__ ? String(err) : undefined)
    } finally {
      setBusy(null)
    }
  }

  const Card = template.Card
  const exit = () => (router.canGoBack() ? router.back() : router.replace('/calc'))

  return (
    <WizardScreen
      title={t(template.title)}
      steps={1}
      index={0}
      onBack={exit}
      hideProgress
      primary={{ label: t('printable.print'), onPress: () => void run('print'), loading: busy === 'print', disabled: !!busy }}
      secondary={{ label: t('printable.saveImage'), onPress: () => void run('share'), disabled: !!busy }}
    >
      {/* The screen header already names the tool, so no second title — just
          what it's for, in a readable size (user feedback 2026-11). */}
      <Txt style={{ fontSize: 17, lineHeight: 24, color: c.textMuted, marginBottom: sp.md }}>{t(template.intro)}</Txt>

      <View style={[styles.stage, { backgroundColor: c.surface }]}>
        {/* The shadow lives on an OUTER view so the snapshot (taken of the
            inner one) is just the card, with clean transparent corners. */}
        <View style={styles.shadow}>
          <View ref={cardRef} collapsable={false}>
            <Card values={values} color={color} width={previewW} label={printLabel} />
          </View>
        </View>
      </View>

      <View style={styles.swatches}>
        {CARD_COLORS.map((col) => {
          const on = col === color
          return (
            <Pressable
              key={col}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={t('printable.color')}
              onPress={() => setColor(col)}
              style={[styles.swatch, { backgroundColor: col, borderColor: on ? c.text : 'transparent' }]}
            >
              {on ? <Check size={16} color={pickOn(col)} strokeWidth={3} /> : null}
            </Pressable>
          )
        })}
      </View>

      {members.length > 0 ? (
        <View style={{ marginBottom: sp.lg }}>
          <Txt variant="label" style={{ marginBottom: sp.sm }}>
            {t('printable.fillFrom')}
          </Txt>
          <View style={styles.wrap}>
            {members.map((m) => {
              const on = (values.name ?? '') === m.name
              return (
                <Pressable
                  key={m.email}
                  onPress={() => fillFrom(m.email, m.name)}
                  style={[
                    styles.member,
                    { backgroundColor: on ? c.accentSoft : c.card, borderColor: on ? c.action : c.border },
                  ]}
                >
                  <Avatar name={m.name} sm />
                  <Txt style={{ fontFamily: fonts.semibold, color: c.text }}>{firstName(m.name)}</Txt>
                </Pressable>
              )
            })}
          </View>
        </View>
      ) : null}

      <View style={{ gap: sp.md }}>
        {template.fields.map((f) => (
          <Field
            key={f.key}
            label={template.required.includes(f.key) ? `${t(f.label)} *` : t(f.label)}
            value={values[f.key] ?? ''}
            onChangeText={(s) => set(f.key, s)}
            // Tidy a phone into its country's format on leaving the field, so
            // the field shows what the card will print.
            onBlur={
              f.keyboardType === 'phone-pad'
                ? () => set(f.key, formatPhone(values[f.key] ?? '', Localization.getLocales()[0]?.regionCode ?? null))
                : undefined
            }
            placeholder={f.placeholder ? t(f.placeholder) : undefined}
            multiline={f.multiline}
            keyboardType={f.keyboardType}
            autoCapitalize={f.autoCapitalize}
            textContentType={f.textContentType}
            autoComplete={f.autoComplete}
            style={f.multiline ? { minHeight: 72, textAlignVertical: 'top' } : undefined}
          />
        ))}
      </View>
      <Txt variant="faint" style={{ marginTop: sp.md }}>
        {t('printable.privacy')}
      </Txt>
    </WizardScreen>
  )
}

const styles = StyleSheet.create({
  stage: {
    borderRadius: radius.lg,
    paddingVertical: sp.xl,
    alignItems: 'center',
    marginBottom: sp.lg,
  },
  shadow: {
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
    borderRadius: 18,
  },
  swatches: { flexDirection: 'row', justifyContent: 'center', gap: sp.md, marginBottom: sp.xl },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm },
  member: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: 4,
    paddingRight: sp.md,
    paddingVertical: 4,
  },
})
