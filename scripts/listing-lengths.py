#!/usr/bin/env python3
"""Check every field of mobile/STORE-LISTING-pt-es.md against the store limits.

    python3 scripts/listing-lengths.py
Each '### Field (limit)' heading is followed by a ``` block; the block is the field.
"""
import re, sys
src = open('mobile/STORE-LISTING-pt-es.md', encoding='utf-8').read()
bad = 0
for m in re.finditer(r'^### (.+?) \((\d+)[^)]*\)\n+```\n(.*?)\n```', src, re.M | re.S):
    name, limit, text = m.group(1), int(m.group(2)), m.group(3)
    n = len(text)
    extra = ''
    if 'sin espacios' in m.group(0) or 'sem espaços' in m.group(0):
        if ' ' in text: extra = '  <- has spaces'
    flag = 'OK ' if n <= limit and not extra else 'BAD'
    bad += flag == 'BAD'
    print(f'{flag} {name:28} {n:5}/{limit}{extra}')
sys.exit(1 if bad else 0)
