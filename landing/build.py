#!/usr/bin/env python3
"""Build the static marketing landing (EN at /, PT at /pt/, ES at /es/) plus
robots.txt, sitemap.xml and llms.txt.

    python3 landing/build.py

Writes ../index.html (Vite's landing entry — plain HTML, no JS bundle) and
../public/{pt,es}/index.html, ../public/{robots.txt,sitemap.xml,llms.txt}.
Change SITE once the custom domain is live, rebuild, deploy.
Copy lives in copy.py; every claim must trace to marketing/fact-sheet.md.
"""
import html, json, os, datetime
import re
from landing_copy import LANGS, ROOF_GROUPS
from icons import ICONS
from vs_copy import PAGES as VS_PAGES, CHECKED as VS_CHECKED
from edge_copy import EDGE, COLS as EDGE_COLS

SITE = 'https://getoneroof.app'
APP_STORE = 'https://apps.apple.com/app/id6786347512'
PLAY = 'https://play.google.com/store/apps/details?id=one.roof.family.organizer'
TIKTOK = 'https://www.tiktok.com/@one.roof.app'
# Google Analytics 4 measurement ID (G-XXXXXXX) and the Search Console HTML-tag
# token. Empty = left out of the page.
GA_ID = 'G-W56J5QPEWQ'
GSC_TOKEN = 'w0fLlOktfVKQIPp__9rQAWjTvj9Ot-h4h312r0FVedo'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TODAY = datetime.date.today().isoformat()
e = html.escape
LAZY = 'loading="lazy" '

CSS = open(os.path.join(os.path.dirname(__file__), 'landing.css')).read()

def jsonld(L):
    url = SITE + L['path']
    org = {'@type': 'Organization', '@id': SITE + '/#org', 'name': 'One Roof', 'url': SITE + '/',
           'logo': SITE + '/roof-icon-512.png', 'sameAs': [APP_STORE, PLAY, TIKTOK],
           'email': 'one.roof.family.organizer@gmail.com'}
    common = {'name': 'One Roof', 'applicationCategory': 'LifestyleApplication',
              'description': L['description'], 'inLanguage': ['en', 'es', 'pt-BR'],
              'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'USD'},
              'publisher': {'@id': SITE + '/#org'},
              'image': SITE + '/roof-icon-512.png',
              'screenshot': [SITE + f'/img/s-{L["lang"][:2]}-{k}.webp' for k in ('hero', 'calendar', 'lists', 'money')],
              'featureList': [f[1] for f in L['features']]}
    ios = {'@type': 'MobileApplication', '@id': SITE + '/#ios', **common, 'operatingSystem': 'iOS',
           'url': APP_STORE, 'installUrl': APP_STORE}
    android = {'@type': 'MobileApplication', '@id': SITE + '/#android', **common, 'operatingSystem': 'Android',
               'url': PLAY, 'installUrl': PLAY}
    page = {'@type': 'WebPage', '@id': url, 'url': url, 'name': L['title'], 'description': L['description'],
            'inLanguage': L['lang'], 'isPartOf': {'@type': 'WebSite', '@id': SITE + '/#site', 'name': 'One Roof', 'url': SITE + '/'},
            'about': [{'@id': SITE + '/#ios'}, {'@id': SITE + '/#android'}],
            'primaryImageOfPage': SITE + f'/img/og-{L["lang"][:2]}.jpg', 'dateModified': TODAY}
    faq = {'@type': 'FAQPage', '@id': url + '#faq', 'inLanguage': L['lang'],
           'mainEntity': [{'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in L['faq']]}
    return json.dumps({'@context': 'https://schema.org', '@graph': [org, page, ios, android, faq]}, ensure_ascii=False, indent=1)

# Vercel Web Analytics (owner, 2026-11-17): cookieless visit counts, turned on
# in the Vercel project; the script is served by Vercel from /_vercel/insights.
VERCEL_ANALYTICS = True

def analytics():
    out = ''
    if VERCEL_ANALYTICS:
        out += '<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};</script>\n<script defer src="/_vercel/insights/script.js"></script>\n'
    if GSC_TOKEN:
        out += f'<meta name="google-site-verification" content="{GSC_TOKEN}" />\n'
    if GA_ID:
        # GA4 with ad features off: no ad storage/personalization, no Google
        # signals. Store-badge clicks are sent as `download_click` {store, page_lang}.
        out += f'''<script async src="https://www.googletagmanager.com/gtag/js?id={GA_ID}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments)}}
gtag('consent','default',{{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'granted'}});
gtag('js',new Date());gtag('config','{GA_ID}',{{allow_google_signals:false,allow_ad_personalization_signals:false}});
document.addEventListener('click',function(e){{var a=e.target.closest&&e.target.closest('a[href]');if(!a)return;var h=a.href,s=h.indexOf('apps.apple.com')>-1?'app_store':h.indexOf('play.google.com')>-1?'google_play':h.indexOf('/casa')>-1?'modo_casa':h.indexOf('tiktok.com')>-1?'tiktok':null;if(s)gtag('event',s==='modo_casa'||s==='tiktok'?'outbound_click':'download_click',{{store:s,page_lang:document.documentElement.lang}})}});</script>
'''
    return out

# No emoji on the site (owner, 2026-11-16): the copy keeps its emoji as readable
# markers and the page body swaps each one for an inline SVG icon.
EMOJI = {'📅': 'calendar-days', '🛒': 'shopping-cart', '💰': 'wallet', '🎙': 'mic', '🐾': 'paw-print', '🎲': 'gamepad-2',
         '📣': 'bell', '📍': 'map-pin', '🗂': 'folder-lock', '📺': 'monitor', '🧮': 'calculator', '👪': 'users', '✏': 'pencil',
         '📱': 'smartphone', '✨': 'sparkles', '🔄': 'refresh-cw', '🏠': 'house', '🎯': 'target', '🏆': 'trophy', '🆘': 'siren',
         '🔒': 'lock', '🛂': 'book-user', '🪪': 'id-card', '🛡': 'shield-check', '➗': 'divide', '🧾': 'receipt', '⚖': 'scale',
         '🏷': 'tag', '🧳': 'luggage', '🖼': 'image', '🎂': 'cake', '👟': 'footprints', '🩸': 'droplet', '🍽': 'utensils',
         '❤': 'heart', '➤': 'send', '✓✓': 'check-check'}
_EMOJI_RE = re.compile('(' + '|'.join(re.escape(k) for k in sorted(EMOJI, key=len, reverse=True)) + ')\ufe0f?')
_ANY_EMOJI = re.compile('[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\ufe0f]')

def no_emoji(html_text):
    head, body = html_text.split('</head>', 1)
    body = _EMOJI_RE.sub(lambda m: f'<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">{ICONS[EMOJI[m.group(1)]]}</svg>', body)
    left = set(_ANY_EMOJI.findall(body)) - set('✦★')
    assert not left, f'emoji left on the page: {left}'
    return head + '</head>' + body

def app_strings(code):
    """Every 'key': "text" pair from the app's i18n file ({name} -> Sam)."""
    src = open(os.path.join(ROOT, 'mobile/src/lib/i18n', code + '.ts')).read()
    out = {}
    for m in re.finditer(r"""^\s*'([A-Za-z0-9_.]+)':\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')""", src, re.M):
        out[m.group(1)] = (m.group(2) if m.group(2) is not None else m.group(3)).replace("\\'", "'").replace('\\"', '"').replace('{name}', 'Sam')
    return out

def roof_examples(code):
    """roofEx.* strings from the app's i18n file -> {key: text} ({name} -> Sam)."""
    src = open(os.path.join(ROOT, 'mobile/src/lib/i18n', code + '.ts')).read()
    out = {}
    for m in re.finditer(r"""'roofEx\.([a-z]+\.\d+)':\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')""", src):
        out[m.group(1)] = (m.group(2) if m.group(2) is not None else m.group(3)).replace("\\'", "'").replace('\\"', '"').replace('{name}', 'Sam')
    return out

TINTS = ['#ef5a6f', '#f0a020', '#1fa873', '#6d63f5', '#f2793d', '#f2645a', '#d99a00']
KEYS = ['calendar', 'lists', 'money', 'roof', 'pets', 'games', 'notes']
FEAT = [0, 1, 2, 3, 4, 5, 12]  # index into L['features'] for each row
IDS = ['calendar', 'lists', 'budget', 'roof', 'pets', 'games', 'notes']

def page(L):
    url = SITE + L['path']
    short = L['lang'][:2]
    alts = '\n'.join(f'<link rel="alternate" hreflang="{x["lang"]}" href="{SITE + x["path"]}" />' for x in LANGS)
    alts += f'\n<link rel="alternate" hreflang="x-default" href="{SITE}/" />'
    langnav = ''.join(
        (f'<strong aria-current="page">{c}</strong>' if x is L else f'<a href="{x["path"]}" hreflang="{x["lang"]}" lang="{x["lang"]}" title="{n}">{c}</a>')
        for x, n, c in zip(LANGS, ['English', 'Português', 'Español'], ['EN', 'PT', 'ES']))
    langfoot = ' · '.join(
        (f'<strong>{n}</strong>' if x is L else f'<a href="{x["path"]}" hreflang="{x["lang"]}" lang="{x["lang"]}">{n}</a>')
        for x, n in zip(LANGS, ['English', 'Português', 'Español']))
    badges = f"""<div class="cta-row">
    <a href="{APP_STORE}" class="badge" rel="noopener"><img src="https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg" alt="Download on the App Store" width="156" height="52" /></a>
    <a href="{PLAY}&hl={L['play_hl']}" class="badge play" rel="noopener"><img src="https://play.google.com/intl/en_us/badges/static/images/badges/{L['play_badge']}_badge_web_generic.png" alt="Get it on Google Play" width="201" height="78" /></a>
  </div>"""
    A = L['alts']
    def phone(key, cls='', alt=None, eager=False):
        load = 'fetchpriority="high"' if eager else 'loading="lazy"'
        lg = 'en' if key == 'games' else short  # games has an English capture only
        return (f'<div class="phone {cls}"><img src="/img/s-{lg}-{key}.webp" alt="{e(A[key] if alt is None else alt)}" '
                f'width="600" height="1304" {load} decoding="async" /></div>')
    nav_ids = ['features', 'compare', 'faq']
    navlinks = ''.join(f'<a href="#{i}">{e(n)}</a>' for i, n in zip(nav_ids, L['nav']))
    facts = ''.join(f'<div><dt>{e(k)}</dt><dd>{e(v)}</dd></div>' for k, v in L['facts'])
    snaps = ''.join(f'<img class="snap {c}" src="/img/{f}.webp" alt="{e(A[k])}" width="440" height="550" loading="lazy" decoding="async" />'
                    for c, f, k in (('s1', 'pet-park', 'snap1'), ('s2', 'pet-beach', 'snap2')))
    aib = f'<span class="aib">✨ {e(L["ai"])}</span>'
    scanbox = f'<div class="scanbox"><span class="aib">✨ {e(L["ai"])}</span><h4>{e(L["scan"][0])}</h4><p>{e(L["scan"][1])}</p></div>'
    R = L['rcpt']
    rlines = ''.join(f'<div class="ln"><span>{e(it.upper())}</span><span>{pr.replace(".", R["dec"])}</span></div>'
                     for it, pr in zip(R['items'], ['4.99', '5.49', '8.99', '6.29', '1.47', '9.99']))
    rrows = ''.join(f'<div><span>{e(k)}</span><b>{e(v)}</b></div>' for k, v in R['rows'])
    scanart = (f'<div class="rcpt" role="img" aria-label="{e(L["scan_alt"])}"><div class="paper" aria-hidden="true"><div class="rh">{e(R["merchant"].upper())}</div>'
               f'<div class="rs">{e(R["date"])}</div><hr />{rlines}<hr /><div class="ln tot"><span>TOTAL</span><span>{R["total"]}</span></div><div class="bars"></div></div>'
               '<i class="beam"></i><i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i></div>'
               '<span class="spark k1" aria-hidden="true">✦</span><span class="spark k2" aria-hidden="true">✦</span><span class="spark k3" aria-hidden="true">✦</span>'
               f'<div class="result" aria-hidden="true"><p class="rf">✨ {e(R["filled"])}</p><p class="ra">{e(R["amount"])}</p>{rrows}</div>')
    aicards = ''.join(f'<article class="card"><span class="tile" aria-hidden="true">{em}</span><h3>{e(t)}</h3><p>{e(d)}</p></article>' for em, t, d in L['ai_cards'])
    T = L['art']
    def pop(cls, inner): return f'<div class="pop {cls}" aria-hidden="true">{inner}</div>'
    extra = {
      'pets': snaps, 'money': scanart,
      'calendar': pop('tr seg', ''.join(f'<span{" class=on" if i == T["view_on"] else ""}>{e(v)}</span>' for i, v in enumerate(T['views'])))
        + pop('mr ev', f'<b>{e(T["event"][0])}</b><small>{e(T["event"][1])}</small>')
        + pop('bl two', f'<i class="ic">🔄</i><span><b>{e(T["sync"][0])}</b><small>{e(T["sync"][1])}</small></span>'),
      'lists': pop('tr', f'✨ {e(T["kinds"])}')
        + pop('bl two slide', f'<i class="av">{e(T["added"][0])}</i><span><small>{e(T["added"][1])}</small><b class="hl">{e(T["added"][2])} <em>· {e(T["added"][3])}</em></b></span>'),
      'roof': pop('tl q', f'✨ {e(T["ask"][0])}') + pop('mr q', f'✨ {e(T["ask"][1])}')
        + pop('bl two', f'<i class="orb">🎙️</i><span><b>{e(T["talk"][0])}</b><small>{e(T["talk"][1])}</small></span>'),
      'games': pop('tr', f'🏠 {e(T["games"][0])}') + pop('ml', f'🎯 {e(T["games"][1])}') + pop('br', f'🏆 {e(T["games"][2])}')
        + '<div class="tiles" aria-hidden="true"><b>R</b><b>O</b><b class="gap"></b><b>F</b></div>',
      'notes': pop('tr two push', f'<img src="/roof-icon-192.png?v=2" alt="" width="34" height="34" loading="lazy" /><span><b>{e(T["push"][0])}</b><small>{e(T["push"][1])}</small></span>')
        + pop('bl tools', '<i style="background:#2b2521"></i><i style="background:#e0453a"></i><i style="background:#2d8fe0"></i><i style="background:#1fa873"></i><span>' + e(T['sendall']) + ' ➤</span>'),
    }
    noteart = (f'<div class="note" role="img" aria-label="{e(A["notes"])}"><p aria-hidden="true">{e(T["note"])}</p>'
               '<svg viewBox="0 0 120 60" aria-hidden="true"><path class="ink u" d="M8 12c18-8 36 6 54-2s30-4 50 0" /><path class="ink h" d="M60 54C30 36 34 16 48 16c7 0 11 5 12 9 1-4 5-9 12-9 14 0 18 20-12 38z" /></svg></div>')
    RX = roof_examples(L['i18n'])
    slides = [f'<li><b>{e(lab)}</b>' + ''.join(f'<q>{e(RX[f"{g}.{n}"])}</q>' for n in ns) + '</li>'
              for (g, ns), lab in zip(ROOF_GROUPS, L['roof_labels'])]
    hid = lambda x: x.replace('<li>', '<li aria-hidden="true">', 1)
    carousel = f'<div class="says" role="group" aria-label="{e(L["roof_aria"])}"><ul>{hid(slides[-1])}{"".join(slides)}{hid(slides[0])}</ul></div>'
    rows = ''
    for i, key in enumerate(KEYS):
        em, title, _ = L['features'][FEAT[i]]
        lead, pts = L['show'][i]
        lis = ''.join(f'<li>{e(x)}</li>' for x in (pts[:2] if key == 'money' else pts))
        rows += f"""<article class="row{' scan-row' if key == 'money' else ''}" id="{IDS[i]}" style="--tint:{TINTS[i]}">
  <div><span class="tile" aria-hidden="true">{em}</span>{aib if key in ('money', 'roof') else ''}
    <h3>{e(title)}</h3>
    <p>{e(lead)}</p>
    {carousel if key == 'roof' else f'<ul class="ticks">{lis}</ul>'}{scanbox if key == 'money' else ''}</div>
  <div class="row-art">{noteart if key == 'notes' else phone(key)}{extra.get(key, '')}</div>
</article>
"""
    AS = app_strings(L['i18n']); B = L['b']
    chip = lambda t, c='': f'<span class="chip2 {c}">{e(t)}</span>'
    bart = {
      'nudges': '<div class="chips2">' + chip('🆘 ' + AS['pings.preset.help'], 'hot') + ''.join(chip(AS['pings.preset.' + k]) for k in ('omw', 'dinner', 'love')) + chip('✓✓ ' + B['seen'], 'seen') + '</div>' + phone('nudges', 'peek'),
      'map': '<div class="chips2">' + chip('📍 ' + B['alerts']) + chip('🔒 ' + B['off'], 'seen') + '</div>' + phone('map', 'peek'),
      'docs': '<div class="fan" aria-hidden="true">' + ''.join(f'<div class="doc d{n}"><i>{ic}</i><b>{e(t)}</b><u></u><u></u></div>' for n, (ic, t) in enumerate(zip(['🛂', '🛡️', '🪪'], B['docs']))) + f'<span class="chip2 lock">🔒 {e(B["lock"])}</span></div>',
      'tools': '<div class="tools2" aria-hidden="true">' + ''.join(f'<div><i>{ic}</i><b>{e(AS["calc.tool." + k])}</b></div>' for ic, k in (('➗', 'even'), ('🧾', 'byItem'), ('⚖️', 'unit'), ('🏷️', 'discount'), ('🧳', 'tag'), ('🖼️', 'frame'))) + '</div>',
      'family': '<div class="pcard" aria-hidden="true"><div class="who"><i>S</i><b>Sam</b></div>' + ''.join(f'<div><span>{ic} {e(AS[k])}</span><b>{e(v)}</b></div>' for ic, k, v in zip(['🎂', '👟', '🩸'], ['family.birthday', 'family.shoeSize', 'family.bloodType'], B['vals'])) + '</div>',
      'widgets': ('<div class="wg" aria-hidden="true">'
                  f'<div class="w w1"><small>{e(B["today"])}</small><b>{e(B["ev"][0])}</b><b>{e(B["ev"][1])}</b></div>'
                  f'<div class="w w2"><small>{e(L["features"][6][1])}</small><span>{e(AS["pings.preset.omw"])}</span><span>{e(AS["pings.preset.dinner"])}</span></div>'
                  f'<div class="w w3"><small>{e(B["pets"])}</small><b class="ok">{e(B["care"][0])}</b><b>{e(B["care"][1])}</b></div></div>'),
    }
    cards = '\n'.join(
        f'<article class="bcard" id="{k}" style="--tint:{t}"><div class="bart">{bart[k]}</div><div class="bbody">'
        f'<span class="tile" aria-hidden="true">{L["features"][fi][0]}</span><h3>{e(L["features"][fi][1])}</h3><p>{e(lead)}</p>'
        f'<ul class="ticks">{"".join(f"<li>{e(x)}</li>" for x in pts)}</ul></div></article>'
        for fi, k, t, lead, pts in L['bento'])
    casa = L['features'][9]
    steps = ''.join(f'<li><h3>{e(t)}</h3><p>{e(d)}</p></li>' for t, d in L['how'])
    H = L['vs_head']
    th = ''.join(f'<th scope="col">{e(h)}</th>' for h in H)
    trs = '\n'.join(f'<tr><th scope="row">{e(a)}</th><td data-l="{e(H[1])}">{e(b)}</td><td data-l="{e(H[2])}">{e(c)}</td></tr>' for a, b, c in L['vs_rows'])
    chips = ''.join(f'<li>{e(c)}</li>' for c in L['privacy_chips'])
    faq = '\n'.join(f'<details{" open" if i == 0 else ""}><summary><h3>{e(q)}</h3></summary><p>{e(a)}</p></details>'
                    for i, (q, a) in enumerate(L['faq']))
    return f"""<!doctype html>
<html lang="{L['lang']}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<script>/* A paired Modo Casa screen (or the installed web app) lands here at "/": send it to the app. */try{{if(localStorage.getItem('casa.device')||matchMedia('(display-mode: standalone)').matches)location.replace('/casa'+location.search+location.hash)}}catch(e){{}}</script>
<title>{e(L['title'])}</title>
<meta name="description" content="{e(L['description'])}" />
<link rel="canonical" href="{url}" />
{alts}
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
<meta name="theme-color" content="#fbf6f0" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#1b1714" media="(prefers-color-scheme: dark)" />
<meta name="apple-itunes-app" content="app-id=6786347512" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="One Roof" />
<meta property="og:url" content="{url}" />
<meta property="og:locale" content="{L['locale']}" />
<meta property="og:title" content="{e(L['og_title'])}" />
<meta property="og:description" content="{e(L['description'])}" />
<meta property="og:image" content="{SITE}/img/og-{short}.jpg" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="{e(L['og_title'])}" />
<meta name="twitter:description" content="{e(L['description'])}" />
<meta name="twitter:image" content="{SITE}/img/og-{short}.jpg" />
{analytics()}<link rel="icon" type="image/png" href="/roof-icon-192.png?v=2" />
<link rel="apple-touch-icon" href="/roof-icon-180.png?v=2" />
<link rel="preload" as="image" href="/img/s-{short}-hero.webp" type="image/webp" fetchpriority="high" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Hanken+Grotesk:wght@400;600;700&family=Caveat:wght@700&display=swap" rel="stylesheet" />
<style>{CSS}</style>
<script type="application/ld+json">
{jsonld(L)}
</script>
</head>
<body>
<nav class="nav" aria-label="One Roof">
  <div class="wrap">
    <a class="brand" href="{L['path']}"><img src="/roof-icon-192.png?v=2" alt="" width="30" height="30" /> <span>One Roof</span></a>
    <span class="nav-links">{navlinks}</span>
    <span class="langs">{langnav}</span>
    <a class="btn" href="#download">{e(L['nav_cta'])}</a>
  </div>
</nav>

<header class="hero">
  <div class="wrap">
    <div class="hero-copy">
      <p class="pill"><img src="/roof-icon-192.png?v=2" alt="" width="22" height="22" /> {e(L['pill'])}</p>
      <h1 class="display">{L['h1_html']}</h1>
      <p class="tagline">{e(L['tagline'])}</p>
      {badges}
      <p class="free">{e(L['free_note'])}</p>
      <p class="casa-link">{e(L['casa_hint'])} <a href="/casa">{e(L['casa_cta'])} →</a></p>
    </div>
    <div class="hero-art">
      <svg class="seal" viewBox="0 0 120 120" role="img" aria-label="{e(L['seal_alt'])}"><defs><path id="ring" d="M60 60m-43 0a43 43 0 1 1 86 0a43 43 0 1 1-86 0" /></defs>
        <circle cx="60" cy="60" r="58" class="s0" /><circle cx="60" cy="60" r="30" class="s1" />
        <g class="spin"><text><textPath href="#ring" textLength="268">{e(L['seal'])}</textPath></text></g>
        <text x="60" y="71" text-anchor="middle" class="star">★</text></svg>
      {phone('pets', 'p0', '')}
      {phone('hero', 'p1', None, True)}
      {phone('money', 'p2', '')}
    </div>
  </div>
</header>

<main>
<section class="facts" aria-label="{e(L['facts_label'])}">
  <div class="wrap"><dl>{facts}</dl></div>
</section>

<section class="wrap" id="modo-casa">
  <div class="casa2">
    <div class="casa2-copy">
      <p class="eyebrow">{e(L['casa_eyebrow'])}</p>
      <h2 class="display">{e(casa[1])}</h2>
      <p>{e(casa[2])}</p>
      <a class="btn" href="/casa">{e(L['casa_cta'])} →</a>
    </div>
    <img class="casa2-art" src="/img/casa-table-{short}.webp" alt="{e(A['casa'])}" width="1600" height="1100" loading="lazy" decoding="async" />
  </div>
</section>

<section class="wrap" id="features">
  <div class="center">
    <h2 class="display">{e(L['feat_h2'])}</h2>
    <p class="sub">{e(L['feat_sub'])}</p>
  </div>
  <div class="rows">
{rows}  </div>
</section>

<section class="wrap flush" id="ai">
  <div class="aiband">
    <p class="eyebrow">✨ {e(L['ai'])}</p>
    <h2 class="display">{e(L['ai_h2'])}</h2>
    <p class="sub">{e(L['ai_sub'])}</p>
    <div class="grid">{aicards}</div>
  </div>
</section>

<section class="wrap" id="more">
  <h2 class="display">{e(L['more_h2'])}</h2>
  <p class="sub">{e(L['more_sub'])}</p>
  <div class="bento">
{cards}
  </div>
</section>

<section class="band" id="compare">
  <div class="wrap">
    <h2 class="display">{e(L['vs_h2'])}</h2>
    <p class="sub">{e(L['vs_sub'])}</p>
    {only_cards(L['lang'][:2])}
    {edge_matrix(L['lang'][:2])}
    {vs_links(L)}<p class="fine">{e(L['vs_note'])}</p>
  </div>
</section>

<section class="wrap center" id="how">
  <h2 class="display">{e(L['how_h2'])}</h2>
  <ol class="steps">{steps}</ol>
</section>

<section class="band privacy" id="privacy">
  <div class="wrap">
    <h2 class="display">{e(L['privacy_h2'])}</h2>
    <ul class="chips">{chips}</ul>
    <p class="sub">{e(L['privacy_text'])}</p>
  </div>
</section>

<section class="wrap" id="faq">
  <div class="faq-grid">
    <div><h2 class="display">{e(L['faq_h2'])}</h2></div>
    <div class="faq">
{faq}
    </div>
  </div>
</section>

<section class="wrap flush" id="story">
  <div class="story">
    <p class="eyebrow">{e(L['story_h2'])}</p>
    <p>{e(L['story_p'])}</p>
  </div>
</section>

<section class="wrap flush" id="download">
  <div class="final">
    <img class="icon" src="/roof-icon-192.png?v=2" alt="One Roof app icon" width="76" height="76" loading="lazy" />
    <h2 class="display">{e(L['cta_h2'])}</h2>
    {badges}
    <p class="free">{e(L['free_note'])}</p>
  </div>
</section>
</main>

<footer>
  <div class="wrap">
    <p>{langfoot}</p>
    <p><a href="/privacy.html">{e(L['privacy_link'])}</a> · <a href="/support.html">{e(L['support_link'])}</a> · {vs_foot(L)}<a href="{APP_STORE}">App Store</a> · <a href="{PLAY}">Google Play</a> · <a href="{TIKTOK}">TikTok</a></p>
    <p>{e(L['footer'])}</p>
  </div>
</footer>
</body>
</html>
"""

_MK = {'y': '<path d="M20 6 9 17l-5-5"/>', 'n': '<path d="M6 12h12"/>', 'p': '<path d="M20 6 9 17l-5-5"/>'}

def only_cards(code):
    D = EDGE[code]
    cards = ''.join(f'<article class="only" style="--tint:{t}"><span class="tile" aria-hidden="true">{em}</span><h4>{e(h)}</h4><p>{e(d)}</p></article>'
                    for em, t, h, d in D['only'])
    return f'<h3 class="edge-h">{e(D["only_h3"])}</h3>\n<div class="onlys">{cards}</div>'

def edge_matrix(code):
    D = EDGE[code]
    def cell(v, col):
        st, note = (v if isinstance(v, tuple) else (v, ''))
        label = {'y': D['yes'], 'n': D['no'], 'p': D['part']}[st]
        sm = f'<small>{e(note)}</small>' if note else ''
        return (f'<td data-l="{e(col)}" class="{st}"><span class="mk {st}" role="img" aria-label="{e(label)}">'
                f'<svg viewBox="0 0 24 24" aria-hidden="true">{_MK[st]}</svg></span>{sm}</td>')
    head = '<th scope="col"></th>' + ''.join(f'<th scope="col">{e(c)}</th>' for c in EDGE_COLS)
    body = '\n'.join('<tr><th scope="row">' + e(r[0]) + '</th>' + ''.join(cell(v, c) for v, c in zip(r[1:], EDGE_COLS)) + '</tr>' for r in D['rows'])
    return (f'<h3 class="edge-h">{e(D["matrix_h3"])}</h3>\n<div class="table-wrap mx"><table>\n<thead><tr>{head}</tr></thead>\n<tbody>\n{body}\n</tbody></table></div>'
            f'\n<p class="fine">{e(D["note"])}</p>')

def vs_links(L):
    return f'<p class="vs-links">{e(EDGE[L["lang"][:2]]["links"])} ' + ' · '.join(f'<a href="/vs/{P["slug"]}/">One Roof vs {e(P["name"])}</a>' for P in VS_PAGES) + '</p>\n    '

def vs_foot(L):
    if L['path'] != '/': return ''
    return ''.join(f'<a href="/vs/{P["slug"]}/">vs {e(P["name"])}</a> · ' for P in VS_PAGES)

def vs_page(P):
    L = LANGS[0]; url = f'{SITE}/vs/{P["slug"]}/'
    them, D = P['name'], EDGE['en']
    def mark(st, note, col):
        label = {'y': D['yes'], 'n': D['no'], 'p': D['part']}[st]
        sm = f'<small>{e(note)}</small>' if note else ''
        return (f'<td data-l="{e(col)}" class="{st}"><span class="mk {st}" role="img" aria-label="{e(label)}">'
                f'<svg viewBox="0 0 24 24" aria-hidden="true">{_MK[st]}</svg></span>{sm}</td>')
    def row(ic, f, t, u):
        win = u[0] != 'n' and t[0] == 'n'
        badge = '<em class="win-b">Only One Roof</em>' if win else ''
        return (f'<tr{" class=win" if win else ""}><th scope="row"><span class="fi">{ic}</span>{e(f)}{badge}</th>'
                + mark(*u, 'One Roof') + mark(*t, them) + '</tr>')
    # what only One Roof has first, then what both have, then where they're ahead
    rank = lambda r: 0 if (r[3][0] != 'n' and r[2][0] == 'n') else (2 if r[3][0] == 'n' else 1)
    trs = '\n'.join(row(*r) for r in sorted(P['rows'], key=rank))
    n = len(P['rows'])
    has = lambda i: sum(1 for r in P['rows'] if r[i][0] != 'n')
    def board(name, i, us):
        chips = ''.join(f'<li class="{r[i][0]}"><span class="fi">{r[0]}</span>{e(r[1])}</li>' for r in P['rows'])
        return (f'<div class="board{" us" if us else ""}"><p class="bname">{e(name)}</p>'
                f'<p class="bcount"><b>{has(i)}</b> of {n}</p>'
                f'<div class="bbar"><i style="width:{has(i) / n * 100:.0f}%"></i></div><ul class="bchips">{chips}</ul></div>')
    boards = board('One Roof', 3, True) + board(them, 2, False)
    faq = '\n'.join(f'<details{" open" if i == 0 else ""}><summary><h3>{e(q)}</h3></summary><p>{e(a)}</p></details>' for i, (q, a) in enumerate(P['faq']))
    src = ', '.join(f'<a href="{u}" rel="nofollow noopener">{e(t)}</a>' for t, u in P['sources'])
    others = ' · '.join(f'<a href="/vs/{Q["slug"]}/">One Roof vs {e(Q["name"])}</a>' for Q in VS_PAGES if Q is not P)
    ld = {'@context': 'https://schema.org', '@graph': [
        {'@type': 'WebPage', '@id': url, 'url': url, 'name': P['title'], 'description': P['description'], 'inLanguage': 'en',
         'isPartOf': {'@type': 'WebSite', '@id': SITE + '/#site', 'name': 'One Roof', 'url': SITE + '/'},
         'about': [{'@id': SITE + '/#ios'}, {'@id': SITE + '/#android'}], 'dateModified': TODAY},
        {'@type': 'BreadcrumbList', 'itemListElement': [
            {'@type': 'ListItem', 'position': 1, 'name': 'One Roof', 'item': SITE + '/'},
            {'@type': 'ListItem', 'position': 2, 'name': P['h1'], 'item': url}]},
        {'@type': 'FAQPage', '@id': url + '#faq', 'inLanguage': 'en',
         'mainEntity': [{'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in P['faq']]}]}
    badges = f"""<div class="cta-row">
    <a href="{APP_STORE}" class="badge" rel="noopener"><img src="https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg" alt="Download on the App Store" width="156" height="52" /></a>
    <a href="{PLAY}&hl=en_US" class="badge play" rel="noopener"><img src="https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png" alt="Get it on Google Play" width="201" height="78" /></a>
  </div>"""
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{e(P['title'])}</title>
<meta name="description" content="{e(P['description'])}" />
<link rel="canonical" href="{url}" />
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
<meta name="theme-color" content="#fbf6f0" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#1b1714" media="(prefers-color-scheme: dark)" />
<meta name="apple-itunes-app" content="app-id=6786347512" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="One Roof" />
<meta property="og:url" content="{url}" />
<meta property="og:locale" content="en_US" />
<meta property="og:title" content="{e(P['title'])}" />
<meta property="og:description" content="{e(P['description'])}" />
<meta property="og:image" content="{SITE}/img/og-en.jpg" />
<meta name="twitter:card" content="summary_large_image" />
{analytics()}<link rel="icon" type="image/png" href="/roof-icon-192.png?v=2" />
<link rel="apple-touch-icon" href="/roof-icon-180.png?v=2" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Hanken+Grotesk:wght@400;600;700&display=swap" rel="stylesheet" />
<style>{CSS}</style>
<script type="application/ld+json">
{json.dumps(ld, ensure_ascii=False, indent=1)}
</script>
</head>
<body>
<nav class="nav" aria-label="One Roof">
  <div class="wrap">
    <a class="brand" href="/"><img src="/roof-icon-192.png?v=2" alt="" width="30" height="30" /> <span>One Roof</span></a>
    <span class="nav-links"><a href="/#features">Features</a><a href="/#faq">FAQ</a></span>
    <a class="btn" href="#download">{e(L['nav_cta'])}</a>
  </div>
</nav>
<main>
<header class="wrap vs-head">
  <p class="crumbs"><a href="/">One Roof</a> › Compare</p>
  <h1 class="display">{e(P['h1'])}</h1>
  <p class="sub">{e(P['lead'])}</p>
  {badges}
  <p class="free">{e(L['free_note'])}</p>
</header>

<section class="band" id="compare">
  <div class="wrap">
    <h2 class="display">What each app covers</h2>
    <p class="sub">The same {n} things families ask for, checked in each app.</p>
    <div class="boards">{boards}</div>
    <p class="legend"><span><i class="lg y"></i>Has it</span><span><i class="lg p"></i>Partly</span><span><i class="lg n"></i>Not listed on {e(them)}'s site</span></p>
    {only_cards('en')}
    <h3 class="edge-h">Feature by feature</h3>
    <div class="table-wrap mx vsx"><table>
      <thead><tr><th scope="col">Feature</th><th scope="col">One Roof</th><th scope="col">{e(them)}</th></tr></thead>
      <tbody>
{trs}
      </tbody>
    </table></div>
    <div class="prices"><div class="us"><p class="bname">One Roof</p><p>{e(P['price'][1])}</p></div><div><p class="bname">{e(them)}</p><p>{e(P['price'][0])}</p></div></div>
    <p class="fine">{e(them)} details are from {src}, checked {VS_CHECKED}. "Not listed" means their site doesn't list it. Features and prices change; check their site for the latest.</p>
  </div>
</section>

<section class="wrap" id="pick">
  <h2 class="display">Which one fits your family?</h2>
  <div class="pick">
    <article><h3>{e(P['name'])} may suit you if…</h3><p>{e(P['pick_them'])}</p></article>
    <article class="us"><h3>One Roof may suit you if…</h3><p>{e(P['pick_us'])}</p></article>
  </div>
</section>

<section class="wrap" id="faq">
  <div class="faq-grid">
    <div><h2 class="display">Questions</h2></div>
    <div class="faq">
{faq}
    </div>
  </div>
</section>

<section class="wrap flush" id="download">
  <div class="final">
    <img class="icon" src="/roof-icon-192.png?v=2" alt="One Roof app icon" width="76" height="76" loading="lazy" />
    <h2 class="display">{e(L['cta_h2'])}</h2>
    {badges}
    <p class="free">{e(L['free_note'])}</p>
  </div>
</section>
</main>

<footer>
  <div class="wrap">
    <p>Also compare: {others} · <a href="/">One Roof home</a></p>
    <p><a href="/privacy.html">{e(L['privacy_link'])}</a> · <a href="/support.html">{e(L['support_link'])}</a> · <a href="{APP_STORE}">App Store</a> · <a href="{PLAY}">Google Play</a></p>
    <p>{e(P['name'])} is a trademark of its owner. One Roof is not affiliated with or endorsed by {e(P['name'])}.</p>
    <p>{e(L['footer'])}</p>
  </div>
</footer>
</body>
</html>
"""

def write(rel, text):
    p = os.path.join(ROOT, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, 'w').write(text); print('wrote', rel, len(text.encode()), 'bytes')

for L in LANGS:
    write('index.html' if L['path'] == '/' else f'public{L["path"]}index.html', no_emoji(page(L)))

for P in VS_PAGES:
    write(f'public/vs/{P["slug"]}/index.html', no_emoji(vs_page(P)))

write('public/robots.txt', f'''# One Roof — search engines and AI assistants are welcome on the public pages.
User-agent: *
Allow: /
Disallow: /casa
Disallow: /admin
Disallow: /join
Disallow: /api/

Sitemap: {SITE}/sitemap.xml
''')

urls = ''.join(f'''  <url>
    <loc>{SITE + L['path']}</loc>
    <lastmod>{TODAY}</lastmod>
{''.join(f'    <xhtml:link rel="alternate" hreflang="{x["lang"]}" href="{SITE + x["path"]}"/>{chr(10)}' for x in LANGS)}    <xhtml:link rel="alternate" hreflang="x-default" href="{SITE}/"/>
  </url>
''' for L in LANGS)
urls += ''.join(f'  <url><loc>{SITE}/{p}</loc><lastmod>{TODAY}</lastmod></url>\n' for p in ('privacy.html', 'support.html', *(f'vs/{P["slug"]}/' for P in VS_PAGES)))
write('public/sitemap.xml', f'''<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
{urls}</urlset>
''')

EN = LANGS[0]
feat = '\n'.join(f'- **{t}**: {d}' for _, t, d in EN['features'])
qa = '\n\n'.join(f'### {q}\n{a}' for q, a in EN['faq'])
write('public/llms.txt', f'''# One Roof

> {EN['faq'][0][1]}

- Website: {SITE}/ (also in Portuguese: {SITE}/pt/ and Spanish: {SITE}/es/)
- App Store (iPhone): {APP_STORE}
- Google Play (Android): {PLAY}
- Price: free to download; One Roof Plus is an optional subscription per household. Every new household gets 30 days of Plus included, no card needed; after that, on the free plan, some features have usage limits.
- Languages: English, Spanish, Portuguese.
- Made by an independent developer in Tampa, Florida, USA.

## Features
{feat}

## How it compares
Families often combine several apps: Cozi or TimeTree for a shared calendar, AnyList or OurGroceries for groceries, Life360 for location and a spreadsheet for the budget. One Roof combines a shared calendar, shopping lists, a household budget with receipt scanning, pet care, documents, nudges, family games, a voice assistant (Roof) and, on iPhone, a private family map, in one app with one plan per household. One Roof is not affiliated with those products.

## FAQ
{qa}

## Pages
- [Privacy policy]({SITE}/privacy.html)
- [Support]({SITE}/support.html)
{chr(10).join(f'- [One Roof vs {P["name"]}]({SITE}/vs/{P["slug"]}/)' for P in VS_PAGES)}
''')
