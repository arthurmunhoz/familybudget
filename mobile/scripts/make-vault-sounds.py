#!/usr/bin/env python3
"""Synthesises the Documents vault's unlock sounds (original, no samples).

    python3 scripts/make-vault-sounds.py

Writes mono 16-bit 44.1 kHz WAVs to assets/sounds/vault/, played by
src/apps/docs/vaultFeedback.ts:
  dial   - the wheel turning: a ratchet of small metallic clicks
  clunk  - the bolts drawing back: a heavy, damped metal thud
  open   - the door swinging: a low, soft air swell with a faint hinge tone
Phone speakers can't play deep bass, so weight lives in 120 Hz - 2 kHz.
"""
import math
import os
import random
import struct
import wave

RATE = 44100
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'sounds', 'vault')
TAU = 2 * math.pi
random.seed(7)


def blank(dur):
    return [0.0] * int(RATE * dur)


def mix(dst, src, at):
    i0 = int(at * RATE)
    for i, v in enumerate(src):
        if i0 + i < len(dst):
            dst[i0 + i] += v


def lowpass(x, cutoff):
    a = 1 - math.exp(-TAU * cutoff / RATE)
    y, out = 0.0, []
    for v in x:
        y += a * (v - y)
        out.append(y)
    return out


def highpass(x, cutoff):
    lp = lowpass(x, cutoff)
    return [a - b for a, b in zip(x, lp)]


def click(vol=0.5, ring=3400):
    """One ratchet tooth: a noise tick plus a short metallic ring."""
    n = int(RATE * 0.045)
    out = []
    for i in range(n):
        t = i / RATE
        noise = (random.random() * 2 - 1) * math.exp(-t / 0.002)
        tone = math.sin(TAU * ring * t) * 0.6 + math.sin(TAU * ring * 1.47 * t) * 0.3
        out.append(vol * (noise * 0.7 + tone * math.exp(-t / 0.012)))
    return highpass(out, 600)


def reverb(x, wet=0.18):
    """A tiny Schroeder room so nothing sounds dry."""
    out = x + [0.0] * int(RATE * 0.35)
    for d, g in ((0.0297, 0.6), (0.0371, 0.55), (0.0411, 0.5), (0.0437, 0.45)):
        k = int(d * RATE)
        buf = [0.0] * len(out)
        for i in range(len(out)):
            buf[i] = (out[i] if i < len(x) else 0.0) + (buf[i - k] * g if i >= k else 0.0)
        out = [a + wet * b / 4 for a, b in zip(out, buf)]
    return out


def dial():
    out = blank(0.75)
    t, gap = 0.0, 0.085
    for k in range(8):
        mix(out, click(0.42 + 0.03 * (k % 2), 3200 + 260 * (k % 3)), t)
        t += gap
        gap *= 0.93
    return reverb(out)


def clunk():
    out = blank(0.6)
    n = int(RATE * 0.5)
    body = []
    for i in range(n):
        t = i / RATE
        thump = math.sin(TAU * (150 + 60 * math.exp(-t / 0.03)) * t) * math.exp(-t / 0.09)
        metal = (math.sin(TAU * 820 * t) * 0.5 + math.sin(TAU * 1290 * t) * 0.35 + math.sin(TAU * 1930 * t) * 0.2) * math.exp(-t / 0.07)
        noise = (random.random() * 2 - 1) * math.exp(-t / 0.012)
        body.append(0.75 * thump + 0.3 * metal + 0.5 * noise)
    mix(out, lowpass(body, 3200), 0)
    # the second bolt, a hair later and softer
    mix(out, [v * 0.55 for v in lowpass(body, 2600)], 0.07)
    return reverb(out, 0.22)


def door_open():
    """Heavy door swinging (owner, 2026-11-13: deeper, softer, fading out —
    v1's airy swell read as a hiss). A low body that slides down in pitch,
    a muffled air swell under it, and a long exponential tail."""
    dur = 1.6
    n = int(RATE * dur)
    noise = [random.random() * 2 - 1 for _ in range(n)]
    air = lowpass(lowpass(highpass(noise, 60), 320), 320)
    out = []
    for i in range(n):
        t = i / RATE
        rise = min(1.0, t / 0.25) ** 2
        fade = math.exp(-max(0.0, t - 0.3) / 0.42)
        f = 95 - 25 * min(1.0, t / dur)
        body = (math.sin(TAU * f * t) + 0.45 * math.sin(TAU * f * 2.01 * t) + 0.2 * math.sin(TAU * f * 3.02 * t)) * 0.35
        out.append((body + 2.2 * air[i]) * rise * fade)
    return reverb(lowpass(out, 700), 0.3)


def write(name, x, target_peak):
    peak = max(1e-9, max(abs(v) for v in x))
    g = target_peak / peak
    fade = int(RATE * 0.01)
    data = []
    for i, v in enumerate(x):
        f = min(1.0, (len(x) - i) / fade)
        data.append(struct.pack('<h', int(max(-1, min(1, v * g * f)) * 32767)))
    os.makedirs(OUT, exist_ok=True)
    with wave.open(os.path.join(OUT, f'{name}.wav'), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b''.join(data))


write('dial', dial(), 0.45)
write('clunk', clunk(), 0.6)
write('open', door_open(), 0.75)
print('vault sounds written to', os.path.normpath(OUT))
