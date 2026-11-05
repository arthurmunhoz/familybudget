#!/usr/bin/env python3
"""Build src/data/birthYears.json — "the world the year you were born" for the
Family Birthday page. Run once in a while (the past doesn't change much):

    python3 mobile/scripts/build-birth-years.py            # ~15-25 min

Why a bundled file instead of live queries: "famous people born in 1989" is a
24 s Wikidata query and "events of 1989" times out outright, so neither can run
when someone opens the page. Bundled, the page opens instantly, works offline,
and nothing about the user (not even the year) leaves the phone.

Per year, per language (en / es / pt):
  * PEOPLE (Wikidata, CC0): humans born that year, ranked by sitelink count
    (how many Wikipedias have an article on them) with athletes at half weight
    — the user asked for movie stars, singers, scientists and presidents, and
    sport is where obscure-but-linked people pile up. Name, short description,
    photo (Commons) and article link in each language.
  * EVENTS (Wikipedia year articles, CC BY-SA — the page credits Wikipedia):
    the curated "Events" list of that language's "<year>" article. An item is
    ranked by the fame (sitelinks) of the EVENT article it links — one with a
    date of its own in Wikidata, like "Apollo 11"), other articles at 60% and
    places (anything with coordinates) at 15% — so "Europe" or a city can't
    outrank the event itself. Picked greedily so one story can't take two
    slots.

Standard library only.
"""
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'src', 'data', 'birthYears.json')
UA = 'OneRoof-build (https://one-roof-app.vercel.app)'
LANGS = ['en', 'es', 'pt']
YEARS = range(1925, 2026)
PEOPLE_PER_YEAR = 10
EVENTS_PER_YEAR = 7
EVENTS_HEADINGS = {'en': 'Events', 'es': 'Acontecimientos', 'pt': 'Eventos'}


CACHE_DIR = os.path.join(HERE, '.cache', 'birth-years')


def cached(key, fn):
    """Disk-cache a network result (scripts/.cache is gitignored) so tuning the
    ranking doesn't re-download ~300 articles and re-run slow SPARQL."""
    import hashlib
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, hashlib.sha1(key.encode()).hexdigest() + '.json')
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    val = fn()
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(val, f)
    return val


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def get(url, params=None, as_json=True, tries=6):
    if params:
        url += ('&' if '?' in url else '?') + urllib.parse.urlencode(params)
    return cached('GET ' + url, lambda: _get(url, as_json, tries))


def _get(url, as_json, tries):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Api-User-Agent': UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read().decode('utf-8')
            return json.loads(body) if as_json else body
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(2 * (i + 1))
        except Exception:
            time.sleep(2 * (i + 1))
    raise RuntimeError(f'GET failed: {url[:120]}')


def sparql(query, tries=5):
    return cached('SPARQL ' + query, lambda: _sparql(query, tries))


def _sparql(query, tries):
    data = urllib.parse.urlencode({'query': query, 'format': 'json'}).encode()
    for i in range(tries):
        try:
            req = urllib.request.Request(
                'https://query.wikidata.org/sparql',
                data=data,
                headers={'User-Agent': UA, 'Accept': 'application/sparql-results+json'},
            )
            with urllib.request.urlopen(req, timeout=75) as r:
                return json.loads(r.read().decode('utf-8'))['results']['bindings']
        except Exception as e:
            log('  sparql retry', i + 1, str(e)[:80])
            time.sleep(5 * (i + 1))
    raise RuntimeError('SPARQL failed')


def qid(uri):
    return uri.rsplit('/', 1)[-1]


# ---------------------------------------------------------------- people --

def famous_people():
    """{year: [(qid, sitelinks)]}. Three passes because one threshold can't fit
    every era: 60+ Wikipedias is plenty of people for 1960, while someone born
    in 2012 with 12 is already notable (and a lower threshold over all years
    times out)."""
    passes = [(1925, 2024, 60), (1995, 2024, 35), (2008, 2024, 18)]
    by_year = {}
    for lo, hi, th in passes:
        log(f'people {lo}-{hi} >= {th} sitelinks')
        try:
            rows = sparql(f"""SELECT ?p ?y ?links WHERE {{
  ?p wikibase:sitelinks ?links . hint:Prior hint:rangeSafe true .
  FILTER(?links >= {th})
  ?p wdt:P31 wd:Q5 ; wdt:P569 ?dob .
  BIND(YEAR(?dob) AS ?y)
  FILTER(?y >= {lo} && ?y <= {hi})
}}""")
        except RuntimeError:
            # The low-threshold pass sits right at WDQS's 60 s limit. Losing it
            # only thins the most recent years; don't lose the whole build.
            log(f'  skipped people pass {lo}-{hi}')
            continue
        for r in rows:
            y, q, n = int(r['y']['value']), qid(r['p']['value']), int(r['links']['value'])
            by_year.setdefault(y, {})[q] = n
    return {y: sorted(d.items(), key=lambda x: -x[1]) for y, d in by_year.items()}


def flags(qids, cls):
    """Which of `qids` are instances (via P106 occupation or P31) of `cls`."""
    out = set()
    qids = sorted(qids)
    for i in range(0, len(qids), 400):
        chunk = ' '.join('wd:' + q for q in qids[i:i + 400])
        prop = 'wdt:P106/wdt:P279*' if cls == 'Q2066131' else 'wdt:P31/wdt:P279*'
        for r in sparql(f'SELECT DISTINCT ?i WHERE {{ VALUES ?i {{ {chunk} }} ?i {prop} wd:{cls} . }}'):
            out.add(qid(r['i']['value']))
    return out


def entities(qids):
    """labels / descriptions / sitelinks / P18 for qids, 50 per call."""
    out = {}
    qids = sorted(qids)
    for i in range(0, len(qids), 50):
        j = get('https://www.wikidata.org/w/api.php', {
            'action': 'wbgetentities', 'format': 'json', 'ids': '|'.join(qids[i:i + 50]),
            'props': 'labels|descriptions|sitelinks|claims', 'languages': '|'.join(LANGS),
            'sitefilter': '|'.join(l + 'wiki' for l in LANGS),
        })
        out.update(j.get('entities', {}))
    return out


def commons_thumb(filename, width=160):
    return 'https://commons.wikimedia.org/wiki/Special:FilePath/' + urllib.parse.quote(filename.replace(' ', '_')) + f'?width={width}'


def build_people():
    by_year = famous_people()
    cand = {y: [q for q, _ in lst[:30]] for y, lst in by_year.items()}
    all_q = {q for lst in cand.values() for q in lst}
    log('athlete flags for', len(all_q))
    athletes = flags(all_q, 'Q2066131')
    links = {q: n for lst in by_year.values() for q, n in lst}
    picked = {}
    for y, lst in cand.items():
        ranked = sorted(lst, key=lambda q: -(links[q] * (0.5 if q in athletes else 1)))
        picked[y] = ranked[:PEOPLE_PER_YEAR]
    need = {q for lst in picked.values() for q in lst}
    log('entity data for', len(need))
    ent = entities(need)
    out = {}
    for y, lst in picked.items():
        people = []
        for q in lst:
            e = ent.get(q)
            if not e:
                continue
            labels = {l: e.get('labels', {}).get(l, {}).get('value') for l in LANGS}
            if not any(labels.values()):
                continue
            img = None
            for c in e.get('claims', {}).get('P18', []):
                v = c.get('mainsnak', {}).get('datavalue', {}).get('value')
                if v:
                    img = v
                    break
            people.append({
                'q': q,
                'n': labels,
                'd': {l: e.get('descriptions', {}).get(l, {}).get('value') for l in LANGS},
                'w': {l: e.get('sitelinks', {}).get(l + 'wiki', {}).get('title') for l in LANGS},
                'i': commons_thumb(img) if img else None,
                'f': links[q],
            })
        out[y] = people
    return out


# ---------------------------------------------------------------- events --

class ItemsParser(HTMLParser):
    """Collect list items of ONE section (the year article's Events section)
    as (text, [linked titles]). Nested lists (en: a date bullet with several
    events under it) become one item per child, prefixed with the parent's
    own text (the date)."""

    def __init__(self, heading):
        super().__init__(convert_charrefs=True)
        self.heading = heading
        self.in_section = False
        self.section_depth = 0
        self.h2 = False
        self.h2_text = ''
        self.stack = []  # open <li>: {'text': [...], 'links': [...], 'has_children': bool}
        self.items = []
        self.skip = 0  # inside <sup> (citations) or <style>

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'section':
            if self.in_section:
                self.section_depth += 1
            return
        if tag == 'h2':
            self.h2, self.h2_text = True, ''
            return
        if not self.in_section:
            return
        if tag in ('sup', 'style', 'figure'):
            self.skip += 1
        elif tag == 'li':
            if self.stack:
                self.stack[-1]['has_children'] = True
            self.stack.append({'text': [], 'links': [], 'has_children': False})
        elif tag == 'a' and self.stack and not self.skip:
            href = a.get('href', '')
            if a.get('rel') == 'mw:WikiLink' and href.startswith('./'):
                title = urllib.parse.unquote(href[2:].split('#')[0])
                self.stack[-1]['links'].append(title)

    def handle_endtag(self, tag):
        if tag == 'h2':
            self.h2 = False
            if self.h2_text.strip() == self.heading:
                self.in_section, self.section_depth = True, 0
            elif self.in_section:
                self.in_section = False
            return
        if tag == 'section' and self.in_section:
            if self.section_depth == 0:
                self.in_section = False
            else:
                self.section_depth -= 1
            return
        if not self.in_section:
            return
        if tag in ('sup', 'style', 'figure'):
            self.skip = max(0, self.skip - 1)
        elif tag == 'li' and self.stack:
            node = self.stack.pop()
            own = re.sub(r'\s+', ' ', ''.join(node['text'])).strip()
            # A parent bullet is usually just a date ("January 7") over
            # several child events, but pt/es often give it an event of its
            # own too ("1 de janeiro – entra em vigor…" + sub-bullets). Emit
            # it whenever it says more than a date; its links stay its own.
            if node['has_children'] and len(DATE_PREFIX.sub('', own)) < 25:
                return
            prefix = ''
            if self.stack:
                parent = re.sub(r'\s+', ' ', ''.join(self.stack[-1]['text'])).strip()
                m = DATE_PREFIX.match(parent)
                prefix = (m.group(0).strip(' –-:') + ' – ') if m else ''
            self.items.append(((prefix + own).strip(), node['links']))

    def handle_data(self, data):
        if self.h2:
            self.h2_text += data
            return
        if not self.in_section or self.skip or not self.stack:
            return
        self.stack[-1]['text'].append(data)


MONTHS = {
    'en': 'january|february|march|april|may|june|july|august|september|october|november|december',
    'es': 'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre',
    'pt': 'janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro',
}


# A leading date in any of the three languages: "January 7", "7 de enero",
# "1.º de janeiro", followed by its separator.
DATE_PREFIX = re.compile(r'^\s*(\d{1,2}(\.?º)? de [^\s–:-]+|[A-Z][a-z]+ \d{1,2})\s*[–:-]?\s*', re.I)


def is_date_title(t, lang):
    t = t.replace('_', ' ').lower()
    return bool(re.fullmatch(r'\d{1,4}( (a\.c\.|bc))?', t) or re.search(MONTHS[lang], t) and re.search(r'\d', t))


def year_events(lang, year):
    body = get(f'https://{lang}.wikipedia.org/api/rest_v1/page/html/{year}', as_json=False)
    if not body:
        return []
    p = ItemsParser(EVENTS_HEADINGS[lang])
    p.feed(body)
    out = []
    for text, links in p.items:
        text = re.sub(r'\[\d+\]', '', text).strip()
        if len(text) < 25:
            continue
        out.append((text, [l for l in dict.fromkeys(links) if not is_date_title(l, lang)]))
    return out


def title_qids(lang, titles):
    out = {}
    titles = sorted(titles)  # stable batches, so the disk cache actually hits
    for i in range(0, len(titles), 50):
        j = get(f'https://{lang}.wikipedia.org/w/api.php', {
            'action': 'query', 'format': 'json', 'prop': 'pageprops', 'ppprop': 'wikibase_item',
            'redirects': 1, 'titles': '|'.join(t.replace('_', ' ') for t in titles[i:i + 50]),
        })
        q = j.get('query', {})
        back = {}
        for n in q.get('normalized', []) + q.get('redirects', []):
            back[n['to']] = back.get(n['from'], n['from'])
        for pg in q.get('pages', {}).values():
            w = pg.get('pageprops', {}).get('wikibase_item')
            if w:
                orig = back.get(pg['title'], pg['title'])
                out[orig.replace(' ', '_')] = w
                out[pg['title'].replace(' ', '_')] = w
    return out


def sitelink_counts(qids):
    out = {}
    qids = sorted(qids)
    for i in range(0, len(qids), 400):
        chunk = ' '.join('wd:' + q for q in qids[i:i + 400])
        for r in sparql(f'SELECT ?i ?n WHERE {{ VALUES ?i {{ {chunk} }} ?i wikibase:sitelinks ?n . }}'):
            out[qid(r['i']['value'])] = int(r['n']['value'])
    return out


def with_props(qids, props):
    """Which of `qids` have any of the direct properties `props` (cheap: no
    property paths, so it doesn't time out over ~50k ids)."""
    out = set()
    qids = sorted(qids)
    path = '|'.join('wdt:' + p for p in props)
    for i in range(0, len(qids), 400):
        chunk = ' '.join('wd:' + q for q in qids[i:i + 400])
        for r in sparql(f'SELECT DISTINCT ?i WHERE {{ VALUES ?i {{ {chunk} }} ?i {path} [] . }}'):
            out.add(qid(r['i']['value']))
    return out


def page_thumbs(lang, titles):
    """title -> thumbnail URL, FREE images only (pilicense=free). A
    Wikipedia lead image is often a non-free fair-use file — a logo, a film
    poster, The Simpsons — which can't be shipped inside an app; free ones live
    on Commons and can."""
    out = {}
    titles = sorted(titles)
    for i in range(0, len(titles), 50):
        j = get(f'https://{lang}.wikipedia.org/w/api.php', {
            'action': 'query', 'format': 'json', 'prop': 'pageimages', 'piprop': 'thumbnail',
            'pithumbsize': 160, 'pilicense': 'free', 'redirects': 1,
            'titles': '|'.join(t.replace('_', ' ') for t in titles[i:i + 50]),
        })
        q = (j or {}).get('query', {})
        back = {}
        for n in q.get('normalized', []) + q.get('redirects', []):
            back[n['to']] = back.get(n['from'], n['from'])
        for pg in q.get('pages', {}).values():
            src = pg.get('thumbnail', {}).get('source')
            if src:
                src = src.split('?')[0]  # drop the ?utm_source=… tracking suffix
                orig = back.get(pg['title'], pg['title'])
                out[orig.replace(' ', '_')] = src
                out[pg['title'].replace(' ', '_')] = src
    return out


def build_events():
    jobs = [(lang, y) for y in YEARS for lang in LANGS]
    log('fetching', len(jobs), 'year articles')
    with ThreadPoolExecutor(4) as ex:
        raw = dict(zip(jobs, ex.map(lambda j: year_events(*j), jobs)))
    # titles -> qids, per language
    t2q = {}
    for lang in LANGS:
        titles = {t for (l, _), items in raw.items() if l == lang for _, links in items for t in links}
        log(lang, 'resolving', len(titles), 'titles')
        t2q[lang] = title_qids(lang, titles)
    all_q = {q for d in t2q.values() for q in d.values()}
    log('sitelinks for', len(all_q))
    counts = sitelink_counts(all_q)
    # What an item is ABOUT decides its rank, not how famous everything it
    # mentions is. Ranking by the most-linked article (even rarity-weighted)
    # crowned whatever PLACE an item mentioned — "Europe", "Alice Springs" —
    # and buried the Berlin Wall and the Moon landing. Wikidata tells the kinds
    # apart cheaply: an EVENT article has a date of its own (point in time,
    # start time, publication, launch), a PLACE has coordinates.
    log('event / place flags')
    events_q = with_props(all_q, ['P585', 'P580', 'P577', 'P619'])
    places_q = with_props(all_q, ['P625'])

    def weight(lang, t):
        # Events count in full, other articles at 60%, places at 15% — not
        # zero: "World Trade Center" has coordinates and still carries 9/11,
        # and "Berlin Wall" has no date of its own and carries 1989.
        q = t2q[lang].get(t)
        if not q:
            return 0.0
        n = float(counts.get(q, 0))
        if q in events_q:
            return n
        return n * (0.15 if q in places_q else 0.6)

    picked = {}
    for (lang, y), items in raw.items():
        # Greedy, so one story can't fill the list: once an item is picked its
        # articles are "used" and stop counting for the rest (1987 had two
        # Iran–Contra items, both carried by Reagan).
        used = set()
        remaining = list(enumerate(items))
        top = []
        while remaining and len(top) < EVENTS_PER_YEAR:
            def score(entry):
                _, (_, links) = entry
                ws = [(weight(lang, t), t) for t in links if t not in used]
                return max(ws) if ws else (0.0, None)
            best = max(remaining, key=lambda e: score(e)[0])
            sc, title = score(best)
            if sc <= 0 and top:
                break
            # Thumbnail candidates: EVENT articles first, then the rest by
            # weight — Iran–Contra should show the affair, not Reagan's
            # portrait just because he's the most-linked thing in the item.
            def is_event(t):
                return t2q[lang].get(t) in events_q
            cands = [
                t
                for _, _, t in sorted(
                    ((is_event(t), weight(lang, t), t) for t in best[1][1] if weight(lang, t) > 0),
                    reverse=True,
                )
            ][:3]
            top.append((best[0], best[1][0], title, cands))
            used.update(best[1][1])
            remaining.remove(best)
        top.sort(key=lambda s: s[0])  # back to calendar order
        picked[(lang, y)] = top

    # One free image per event — the first candidate article that has one.
    log('event thumbnails')
    thumbs = {}
    for lang in LANGS:
        titles = {t for (l, _), top in picked.items() if l == lang for *_, cands in top for t in cands}
        thumbs[lang] = page_thumbs(lang, titles)
    out = {}
    for (lang, y), top in picked.items():
        out.setdefault(y, {})[lang] = [
            {
                't': text,
                'u': f'https://{lang}.m.wikipedia.org/wiki/{urllib.parse.quote(title)}' if title else None,
                'i': next((thumbs[lang][t] for t in cands if t in thumbs[lang]), None),
            }
            for _, text, title, cands in top
        ]
    return out


def main():
    people = build_people()
    events = build_events()
    data = {}
    for y in YEARS:
        data[str(y)] = {'p': people.get(y, []), 'e': events.get(y, {})}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    log('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB')


if __name__ == '__main__':
    main()
