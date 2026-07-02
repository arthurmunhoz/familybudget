// Split a bill by item: list each line item, add the people splitting, tap who
// had each item, then it apportions tax + tip by each person's share. The
// "scan a photo of the bill" flow (PWA → /api/scan-bill) is STUBBED on native
// for now — see scanComingSoon(). Items are entered/edited by hand instead.
import { useRef, useState } from 'react'
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native'
import { Camera, X } from 'lucide-react-native'

import { Btn, Card, Txt } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { useAuth } from '@/lib/auth'
import { formatMoney } from '@/lib/format'
import { radius, sp, useTheme } from '@/theme/theme'

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

type BillItem = { id: string; name: string; price: string; people: string[] }

export function ItemSplit() {
  const { c } = useTheme()
  const { t } = useI18n()
  const { profiles } = useAuth()
  const idRef = useRef(1)
  const nextId = () => `it-${idRef.current++}`

  const [items, setItems] = useState<BillItem[]>(() => [
    { id: 'it-0', name: '', price: '', people: [] },
  ])
  const [tax, setTax] = useState('')
  const [tip, setTip] = useState('')
  // Tip can be a flat amount or a % of the (pre-tax) subtotal.
  const [tipMode, setTipMode] = useState<'amount' | 'percent'>('percent')
  const [tipPct, setTipPct] = useState(20)
  const [people, setPeople] = useState<string[]>([])
  const [nameInput, setNameInput] = useState('')

  // Quick-add chips for the signed-in user's household members (not yet added).
  const memberNames = profiles
    .map((p) => p.display_name?.trim() || p.email)
    .filter((n): n is string => !!n)
  const suggestions = memberNames.filter((n) => !people.includes(n))

  function scanComingSoon() {
    Alert.alert(t('bill.takePhoto'), 'Scanning a bill from a photo is coming soon on the app. For now, add the items by hand below.')
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
  const setField = (id: string, field: 'name' | 'price', val: string) =>
    setItems((its) => its.map((it) => (it.id === id ? { ...it, [field]: val } : it)))
  const removeItem = (id: string) => setItems((its) => its.filter((it) => it.id !== id))
  const addItem = () => setItems((its) => [...its, { id: nextId(), name: '', price: '', people: [] }])

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
      {/* Scan stub */}
      <Btn
        title={t('bill.takePhoto')}
        onPress={scanComingSoon}
        variant="secondary"
        style={{ flexDirection: 'row' }}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: -sp.md }}>
        <Camera size={14} color={c.textFaint} />
        <Txt variant="faint">Photo scan coming soon — add items by hand below.</Txt>
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
                  <TextInput
                    value={it.name}
                    onChangeText={(v) => setField(it.id, 'name', v)}
                    placeholder={t('bill.itemName')}
                    placeholderTextColor={c.textFaint}
                    style={{ flex: 1, fontSize: 16, fontWeight: '600', color: c.text }}
                  />
                  <Txt variant="faint">$</Txt>
                  <MiniInput
                    value={it.price}
                    onChangeText={(v) => setField(it.id, 'price', v)}
                    placeholder="0.00"
                    width={68}
                  />
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
        <Pressable onPress={addItem} style={[styles.addItemBtn, { backgroundColor: c.surface }]}>
          <Txt style={{ fontSize: 14, fontWeight: '600', color: c.textMuted }}>{t('bill.addItem')}</Txt>
        </Pressable>
      </View>

      {/* tax / tip / total */}
      <Card>
        <ResultRow label={t('bill.subtotal')} value={formatMoney(itemsSubtotal)} />
        <View style={styles.lineRow}>
          <Txt variant="muted">{t('bill.tax')}</Txt>
          <MiniInput value={tax} onChangeText={setTax} placeholder="0.00" />
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
