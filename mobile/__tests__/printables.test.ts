/**
 * Printable cards (apps/calc/printables). The printed sheet must size each
 * card in real INCHES — anything else prints at whatever size the print
 * WebView picks — and every template field has a label in all 3 languages.
 */
import { cardSheetHtml } from '@/apps/calc/printables/printing'
import { LUGGAGE_TAG } from '@/apps/calc/printables/templates'
import { DICTS } from '@/lib/i18n'

describe('cardSheetHtml', () => {
  const html = cardSheetHtml('QUJD', { widthIn: 2.75, heightIn: 4.75, perPage: 2, caption: 'Cut <here> & "there"' })
  it('lays out perPage copies at physical size', () => {
    expect(html.match(/<img /g)).toHaveLength(2)
    expect(html).toContain('width: 2.75in; height: 4.75in')
    expect(html).toContain('data:image/png;base64,QUJD')
  })
  it('escapes the caption', () => {
    expect(html).toContain('Cut &lt;here&gt; &amp; &quot;there&quot;')
  })
})

describe('luggage tag template', () => {
  it('has every label in every language', () => {
    const keys = [
      LUGGAGE_TAG.title,
      LUGGAGE_TAG.intro,
      ...LUGGAGE_TAG.fields.flatMap((f) => [f.label, ...(f.placeholder ? [f.placeholder] : [])]),
      'tag.heading' as const,
      'tag.ifFound' as const,
    ]
    for (const lang of ['en', 'es', 'pt'] as const) {
      for (const k of keys) expect(DICTS[lang][k]).toBeTruthy()
    }
  })
  it('requires fields that exist', () => {
    const keys = LUGGAGE_TAG.fields.map((f) => f.key)
    for (const r of LUGGAGE_TAG.required) expect(keys).toContain(r)
  })
})
