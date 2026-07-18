// Split a bill by item — a One Roof Plus feature (gated in SplitBill). The bill
// itself (line items + tax) comes ONLY from a photo scan (/api/scan-bill) and is
// READ-ONLY: no manual add, edit, or typing of bill data. You take a picture,
// the AI lists the items and tax, then you add the people, tap who had each item,
// and pick a tip — it apportions tax + tip by each person's share. (A mis-scanned
// line can be dropped with ✕; re-scan to redo the whole bill.)
import { useRef, useState } from 'react'
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { router } from 'expo-router'
import { Camera, X } from 'lucide-react-native'

import { Btn, Card, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { useAuth } from '@/lib/auth'
import { formatMoney } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { radius, sp, useTheme } from '@/theme/theme'

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? ''

import {
  Avatar,
  Divider,
  MiniInput,
  PercentPicker,
  ResultRow,
  colorFor,
  firstName,
  num,
} from './shared'
import { KEYBOARD_DONE_ID } from '@/components/keyboardDoneId'

type BillItem = { id: string; name: string; price: string; people: string[] }

export function ItemSplit() {
  const { c } = useTheme()
  const { t } = useI18n()
  const { profiles } = useAuth()
  const idRef = useRef(1)
  const nextId = () => `it-${idRef.current++}`

  // Items are populated only by a scan (no manual add) — start empty.
  const [items, setItems] = useState<BillItem[]>([])
  const [tax, setTax] = useState('')
  const [tip, setTip] = useState('')
  // Tip can be a flat amount or a % of the (pre-tax) subtotal.
  const [tipMode, setTipMode] = useState<'amount' | 'percent'>('percent')
  const [tipPct, setTipPct] = useState(20)
  const [people, setPeople] = useState<string[]>([])
  const [nameInput, setNameInput] = useState('')
  const [scanning, setScanning] = useState(false)

  // Quick-add chips for the signed-in user's household members (not yet added).
  const memberNames = profiles
    .map((p) => p.display_name?.trim() || p.email)
    .filter((n): n is string => !!n)
  const suggestions = memberNames.filter((n) => !people.includes(n))

  // Bill scan: pick/capture a photo, resize + base64, POST to the deployed
  // scan-bill endpoint, then fill the item list (+ tax/tip) with the result.
  async function scanBill(fromCamera: boolean) {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      Alert.alert(t('bill.scanFailed'))
      return
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 })
    if (result.canceled || !result.assets[0]) return

    setScanning(true)
    try {
      const ctx = ImageManipulator.manipulate(result.assets[0].uri).resize({ width: 1200 })
      const ref = await ctx.renderAsync()
      const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true })
      if (!out.base64) throw new Error('no base64')

      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      const res = await fetch(`${API_BASE}/api/scan-bill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ image: out.base64, media_type: 'image/jpeg' }),
      })
      const json = await res.json()
      if (!res.ok) {
        // Free households hit a monthly scan cap — offer Plus instead of erroring.
        if (json.reason === 'monthly_cap') {
          Alert.alert(t('bill.scanLimitReached'), json.error ?? '', [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('settings.getPlus'), onPress: () => router.push('/paywall') },
          ])
          return
        }
        throw new Error(json.error ?? t('bill.scanFailed'))
      }

      const scanned: BillItem[] = (json.items ?? [])
        .filter((it: { name?: string; price?: number }) => it && typeof it.name === 'string')
        .map((it: { name: string; price: number }) => ({
          id: nextId(),
          name: it.name,
          price: Number.isFinite(it.price) ? String(it.price) : '',
          people: [],
        }))
      if (scanned.length === 0) {
        Alert.alert(t('bill.scanFailed'))
        return
      }
      setItems(scanned)
      if (Number.isFinite(json.tax) && json.tax > 0) setTax(String(json.tax))
      if (Number.isFinite(json.tip) && json.tip > 0) {
        setTipMode('amount')
        setTip(String(json.tip))
      }
    } catch (err) {
      Alert.alert(err instanceof Error ? err.message : t('bill.scanFailed'))
    } finally {
      setScanning(false)
    }
  }

  function startScan() {
    Alert.alert(t('bill.takePhoto'), t('bill.scanTip'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('bill.scanCamera'), onPress: () => scanBill(true) },
      { text: t('bill.scanLibrary'), onPress: () => scanBill(false) },
    ])
  }

  function addPerson(name: string) {
    const n = name.trim()
    if (!n || people.includes(n)) return
    setPeople((p) => [...p, n])
    setNameInput('')
  }
  function removePerson(name: string) {
    setPeople((p) => p.filter((x) => x !== name))
    setItems((its) => its.map((it) => ({ ...it, people: it.people.filter((x) => x !== name) })))
  }
  function toggle(id: string, name: string) {
    setItems((its) =>
      its.map((it) =>
        it.id !== id
          ? it
          : {
              ...it,
              people: it.people.includes(name)
                ? it.people.filter((x) => x !== name)
                : [...it.people, name],
            },
      ),
    )
  }
  const removeItem = (id: string) => setItems((its) => its.filter((it) => it.id !== id))

  const itemsSubtotal = items.reduce((s, it) => s + num(it.price), 0)
  const tipAmount = tipMode === 'percent' ? (itemsSubtotal * tipPct) / 100 : num(tip)
  const extras = num(tax) + tipAmount
  const assignedSubtotal = items
    .filter((it) => it.people.length > 0)
    .reduce((s, it) => s + num(it.price), 0)
  const unassignedCount = items.filter((it) => it.people.length === 0 && num(it.price) > 0).length

  function personTotal(name: string) {
    const base = items
      .filter((it) => it.people.includes(name))
      .reduce((s, it) => s + num(it.price) / it.people.length, 0)
    const share = assignedSubtotal > 0 ? (base / assignedSubtotal) * extras : 0
    return base + share
  }
  const countFor = (name: string) => items.filter((it) => it.people.includes(name)).length

  return (
    <View style={{ gap: sp.xl }}>
      {/* Scan a bill photo → line items (Claude vision, deployed endpoint) */}
      <Btn
        title={scanning ? t('bill.scanning') : t('bill.takePhoto')}
        onPress={startScan}
        variant="secondary"
        loading={scanning}
        disabled={scanning}
        style={{ flexDirection: 'row' }}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: -sp.md }}>
        <Camera size={14} color={c.textFaint} />
        <Txt variant="faint">{t('bill.scanHint')}</Txt>
      </View>

      {/* who's splitting */}
      <View>
        <Txt variant="label" style={{ color: c.textFaint }}>
          {t('bill.people')}
        </Txt>
        <View style={styles.peopleWrap}>
          {people.map((p) => (
            <Pressable
              key={p}
              onPress={() => removePerson(p)}
              style={[styles.personChip, { backgroundColor: c.card, borderColor: c.border }]}
            >
              <Avatar name={p} sm />
              <Txt style={{ fontWeight: '600', color: c.text }}>{firstName(p)}</Txt>
              <X size={14} color={c.textFaint} />
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: sp.sm, marginTop: sp.sm }}>
          <TextInput
            inputAccessoryViewID={KEYBOARD_DONE_ID}
            value={nameInput}
            onChangeText={setNameInput}
            onSubmitEditing={() => addPerson(nameInput)}
            placeholder={t('bill.addName')}
            placeholderTextColor={c.textFaint}
            returnKeyType="done"
            style={{
              flex: 1,
              backgroundColor: c.surface,
              borderRadius: radius.md,
              paddingHorizontal: sp.md,
              paddingVertical: 12,
              fontSize: 16,
              color: c.text,
            }}
          />
          <Pressable
            onPress={() => addPerson(nameInput)}
            style={[styles.addBtn, { backgroundColor: c.surface }]}
          >
            <Txt style={{ fontSize: 22, fontWeight: '700', color: c.textMuted }}>+</Txt>
          </Pressable>
        </View>
        {suggestions.length > 0 && (
          <View style={{ marginTop: sp.sm }}>
            <Txt variant="faint" style={{ marginBottom: 6 }}>
              {t('bill.fromHousehold')}
            </Txt>
            <View style={styles.peopleWrap}>
              {suggestions.map((n) => (
                <Pressable
                  key={n}
                  onPress={() => addPerson(n)}
                  style={[styles.suggestChip, { backgroundColor: c.surface, borderColor: c.border }]}
                >
                  <Avatar name={n} sm />
                  <Txt style={{ fontWeight: '600', color: c.textMuted }}>{firstName(n)}</Txt>
                  <Txt style={{ fontSize: 16, fontWeight: '700', color: c.textFaint }}>+</Txt>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </View>

      {/* items */}
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <Txt variant="label" style={{ color: c.textFaint }}>
            {t('bill.items')}
          </Txt>
          {unassignedCount > 0 && (
            <Txt style={{ fontSize: 13, fontWeight: '600', color: '#d97706' }}>
              {t('bill.unassignedWarn', { count: unassignedCount })}
            </Txt>
          )}
        </View>
        {items.length === 0 ? (
          <Card style={{ marginTop: sp.sm }}>
            <Txt variant="muted">{t('bill.scanEmpty')}</Txt>
          </Card>
        ) : (
        <View style={{ gap: sp.sm, marginTop: sp.sm }}>
          {items.map((it) => {
            const unassigned = it.people.length === 0
            const shared = it.people.length > 1
            return (
              <View
                key={it.id}
                style={[
                  styles.itemCard,
                  {
                    backgroundColor: c.card,
                    borderColor: unassigned && people.length > 0 ? 'rgba(217,119,6,0.5)' : c.border,
                  },
                ]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
                  <Txt
                    style={{ flex: 1, fontSize: 16, fontWeight: '600', color: c.text }}
                    numberOfLines={1}
                  >
                    {it.name}
                  </Txt>
                  <Txt style={{ fontWeight: '600', fontVariant: ['tabular-nums'], color: c.text }}>
                    {formatMoney(num(it.price))}
                  </Txt>
                  <Pressable onPress={() => removeItem(it.id)} hitSlop={6} style={{ paddingHorizontal: 2 }}>
                    <X size={18} color={c.textFaint} />
                  </Pressable>
                </View>
                {people.length > 0 && (
                  <View style={styles.assignWrap}>
                    {people.map((p) => {
                      const on = it.people.includes(p)
                      return (
                        <Pressable
                          key={p}
                          onPress={() => toggle(it.id, p)}
                          style={[
                            styles.assignChip,
                            { backgroundColor: on ? colorFor(p) : c.surface },
                          ]}
                        >
                          <Txt style={{ fontSize: 12, fontWeight: '600', color: on ? '#ffffff' : c.textMuted }}>
                            {firstName(p)}
                          </Txt>
                        </Pressable>
                      )
                    })}
                    {unassigned ? (
                      <Txt variant="faint" style={{ alignSelf: 'center' }}>
                        {t('bill.tapWho')}
                      </Txt>
                    ) : shared ? (
                      <Txt variant="faint" style={{ marginLeft: 'auto', alignSelf: 'center' }}>
                        {t('bill.splitWays', { count: it.people.length })} ·{' '}
                        {formatMoney(num(it.price) / it.people.length)}
                      </Txt>
                    ) : null}
                  </View>
                )}
              </View>
            )
          })}
        </View>
        )}
      </View>

      {/* tax / tip / total */}
      <Card>
        <ResultRow label={t('bill.subtotal')} value={formatMoney(itemsSubtotal)} />
        <View style={styles.lineRow}>
          <Txt variant="muted">{t('bill.tax')}</Txt>
          <Txt
            style={{ width: 96, textAlign: 'right', fontWeight: '600', fontVariant: ['tabular-nums'], color: c.text }}
          >
            {formatMoney(num(tax))}
          </Txt>
        </View>
        <View style={{ paddingVertical: 3 }}>
          <View style={styles.lineRow}>
            <Txt variant="muted">{t('bill.tip')}</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.sm }}>
              <View style={[styles.toggle, { backgroundColor: c.surface }]}>
                {(['percent', 'amount'] as const).map((m) => {
                  const active = tipMode === m
                  return (
                    <Pressable
                      key={m}
                      onPress={() => setTipMode(m)}
                      style={[styles.toggleBtn, active && { backgroundColor: c.accent }]}
                    >
                      <Txt style={{ fontSize: 14, fontWeight: '700', color: active ? '#ffffff' : c.textMuted }}>
                        {m === 'percent' ? '%' : '$'}
                      </Txt>
                    </Pressable>
                  )
                })}
              </View>
              {tipMode === 'amount' ? (
                <MiniInput value={tip} onChangeText={setTip} placeholder="0.00" />
              ) : (
                <Txt
                  style={{ width: 96, textAlign: 'right', fontWeight: '600', fontVariant: ['tabular-nums'], color: c.text }}
                >
                  {formatMoney(tipAmount)}
                </Txt>
              )}
            </View>
          </View>
          {tipMode === 'percent' && (
            <PercentPicker value={tipPct} onChange={setTipPct} presets={[18, 20, 22]} />
          )}
        </View>
        <Divider />
        <ResultRow label={t('bill.billTotal')} value={formatMoney(itemsSubtotal + extras)} strong />
      </Card>

      {/* per-person */}
      <View>
        <Txt variant="label" style={{ color: c.textFaint }}>
          {t('bill.each')}
        </Txt>
        {people.length === 0 ? (
          <Card style={{ marginTop: sp.sm }}>
            <Txt variant="muted">{t('bill.noPeople')}</Txt>
          </Card>
        ) : (
          <Card style={{ marginTop: sp.sm, padding: 0, overflow: 'hidden' }}>
            {people.map((p, i) => (
              <View
                key={p}
                style={[
                  styles.personTotalRow,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.surface2 },
                ]}
              >
                <Avatar name={p} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt style={{ fontWeight: '600', color: c.text }} numberOfLines={1}>
                    {p}
                  </Txt>
                  <Txt variant="faint">{t('bill.itemsCount', { count: countFor(p) })}</Txt>
                </View>
                <Txt style={{ fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'], color: c.text }}>
                  {formatMoney(personTotal(p))}
                </Txt>
              </View>
            ))}
          </Card>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  peopleWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: sp.sm, marginTop: sp.sm },
  personChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: 4,
    paddingRight: sp.sm,
    paddingVertical: 4,
  },
  addBtn: {
    width: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    paddingLeft: 4,
    paddingRight: sp.sm,
    paddingVertical: 4,
  },
  itemCard: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: sp.md,
  },
  assignWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: sp.md,
  },
  assignChip: {
    borderRadius: radius.pill,
    paddingHorizontal: sp.md,
    paddingVertical: 5,
  },
  addItemBtn: {
    marginTop: sp.sm,
    borderRadius: radius.md,
    paddingVertical: 10,
    alignItems: 'center',
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  toggle: { flexDirection: 'row', borderRadius: radius.sm, padding: 2 },
  toggleBtn: { borderRadius: radius.sm - 2, paddingHorizontal: 10, paddingVertical: 2 },
  personTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: sp.md,
    paddingHorizontal: sp.lg,
    paddingVertical: sp.md,
  },
})
