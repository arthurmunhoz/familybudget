#!/usr/bin/env python3
"""Synthesises the family games' sound effects (original, no samples).

    python3 scripts/make-game-sounds.py

Writes mono 16-bit 44.1 kHz WAVs to assets/sounds/games/, picked up via
require() in src/apps/games/feedback.ts.

v2 (2026-11, owner: "improve all of them"). Instead of bare sine beeps:
  * FM bells for chimes (a carrier modulated by an inharmonic partner — the
    classic "real bell / glockenspiel" timbre),
  * Karplus-Strong plucked strings and a marimba-style tone for taps and pops
    (natural attack, woody decay),
  * a small Schroeder room reverb so nothing sounds dry and boxy,
  * notes from one key (C major pentatonic) so sounds that overlap agree,
  * every sound loudness-matched (RMS) per role, peak-limited, de-clicked.
Phone speakers can't play deep bass, so impacts keep their weight in the
150 Hz – 2 kHz range rather than below 100 Hz.
"""
import math
import os
import random
import struct
import wave

RATE = 44100
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'sounds', 'games')
random.seed(11)
TAU = 2 * math.pi


def hz(n):  # MIDI note → Hz
    return 440.0 * 2 ** ((n - 69) / 12)


# C major pentatonic
C5, D5, E5, G5, A5, C6, D6, E6, G6, A6, C7 = (hz(n) for n in (72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96))
G4, A4, C4, E4 = hz(67), hz(69), hz(60), hz(64)


def silence(dur):
    return [0.0] * int(RATE * dur)


def env_ad(t, attack, decay):
    return (min(1.0, t / attack) if attack > 0 else 1.0) * math.exp(-t / decay)


def bell(freq, dur, vol=0.5, ratio=3.5, index=2.2, decay=0.6):
    """FM bell: modulator at an inharmonic ratio, index falling over time."""
    out = []
    for i in range(int(RATE * dur)):
        t = i / RATE
        a = env_ad(t, 0.002, decay)
        idx = index * math.exp(-t / (decay * 0.5))
        out.append(vol * a * math.sin(TAU * freq * t + idx * math.sin(TAU * freq * ratio * t)))
    return out


def marimba(freq, dur=0.35, vol=0.5):
    """Woody bar: fundamental + 4th partial (~3.9x), fast-damped, a tiny thump."""
    out = []
    for i in range(int(RATE * dur)):
        t = i / RATE
        s = math.sin(TAU * freq * t) * math.exp(-t / 0.16)
        s += 0.35 * math.sin(TAU * freq * 3.93 * t) * math.exp(-t / 0.03)
        s += 0.25 * math.sin(TAU * freq * 0.5 * t) * math.exp(-t / 0.02)
        out.append(vol * min(1.0, t / 0.001) * s)
    return out


def pluck(freq, dur=0.5, vol=0.6, bright=0.5):
    """Karplus-Strong plucked string (bright 0 = muted … 1 = ringing)."""
    n = max(2, int(RATE / freq))
    buf = [random.uniform(-1, 1) for _ in range(n)]
    out = []
    decay = 0.990 + 0.009 * bright
    for i in range(int(RATE * dur)):
        v = buf[i % n]
        buf[i % n] = decay * 0.5 * (v + buf[(i + 1) % n])
        out.append(vol * v)
    return out


def noise(dur, vol=0.3, decay=0.05, lp=0.2, hp=0.0, attack=0.0005):
    """Filtered noise burst: one-pole low-pass, optional one-pole high-pass."""
    out, l, hprev, xprev = [], 0.0, 0.0, 0.0
    for i in range(int(RATE * dur)):
        t = i / RATE
        l += lp * (random.uniform(-1, 1) - l)
        y = l
        if hp:
            hprev = hp * (hprev + y - xprev)
            xprev = y
            y = hprev
        out.append(vol * y * env_ad(t, attack, decay))
    return out


def tone(freq, dur, vol=0.5, attack=0.004, decay=0.2, bend=0.0, harm=(1.0, 0.3, 0.1)):
    out, ph = [], 0.0
    for i in range(int(RATE * dur)):
        t = i / RATE
        ph += TAU * freq * (1 + bend * t / dur) / RATE
        s = sum(a * math.sin(ph * (k + 1)) for k, a in enumerate(harm)) / sum(harm)
        out.append(vol * env_ad(t, attack, decay) * s)
    return out


def mix(*tracks, offsets=None):
    offsets = offsets or [0.0] * len(tracks)
    length = max(int(o * RATE) + len(t) for t, o in zip(tracks, offsets))
    buf = [0.0] * length
    for t, o in zip(tracks, offsets):
        s0 = int(o * RATE)
        for i, v in enumerate(t):
            buf[s0 + i] += v
    return buf


def reverb(x, wet=0.18, room=0.78, tail=0.6):
    """Small Schroeder room: 4 parallel damped combs + 2 series allpasses."""
    x = x + silence(tail)
    out = [0.0] * len(x)
    for d in (1116, 1188, 1277, 1356):
        buf = [0.0] * d
        f = 0.0
        for i, v in enumerate(x):
            y = buf[i % d]
            f = y * 0.8 + f * 0.2
            buf[i % d] = v + f * room
            out[i] += y * 0.25
    for d in (556, 441):
        buf = [0.0] * d
        for i, v in enumerate(out):
            b = buf[i % d]
            buf[i % d] = v + b * 0.5
            out[i] = -v + b
    return [a + wet * b for a, b in zip(x, out)]


def finish(samples, rms_target, fade=0.03):
    """Loudness-match (RMS of the loud part), soft-limit peaks, fade the tail,
    and trim trailing near-silence."""
    peak = max(abs(s) for s in samples) or 1.0
    loud = [s for s in samples if abs(s) > peak * 0.1] or samples
    rms = math.sqrt(sum(s * s for s in loud) / len(loud)) or 1.0
    g = rms_target / rms
    out = [math.tanh(s * g * 1.1) / 1.1 for s in samples]
    m = max(abs(s) for s in out)
    if m > 0.92:
        out = [s * 0.92 / m for s in out]
    end = len(out)
    while end > 0 and abs(out[end - 1]) < 0.002:
        end -= 1
    out = out[: max(end, 1)]
    n = int(RATE * fade)
    for i in range(min(n, len(out))):
        out[-1 - i] *= i / n
    return out


def save(name, samples, rms):
    samples = finish(samples, rms)
    os.makedirs(OUT, exist_ok=True)
    with wave.open(os.path.join(OUT, name + '.wav'), 'w') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, s)) * 32767)) for s in samples))


# Loudness per role: UI taps sit low, events in the middle, payoffs on top.
UI, EVENT, BIG = 0.10, 0.17, 0.22

# ── UI ─────────────────────────────────────────────────────────────────────
# A tap on any game button: a soft, low felt "tock" — barely there (owner,
# 2026-11: the bright G6 marimba tick read as shrill). A rounded sine with a
# hint of octave, a 2 ms rise so it never clicks, gone in ~60 ms, plus a
# whisper of dark noise for the touch of a fingertip.
def felt(freq, dur=0.07, vol=0.5):
    out = []
    for i in range(int(RATE * dur)):
        t = i / RATE
        s = math.sin(TAU * freq * t) * math.exp(-t / 0.022)
        s += 0.18 * math.sin(TAU * freq * 2 * t) * math.exp(-t / 0.008)
        out.append(vol * min(1.0, t / 0.002) * s)
    return out


save('tap', mix(felt(hz(66), 0.07, 0.5), noise(0.01, 0.12, 0.003, 0.08)), UI * 0.55)
# 'pop' (someone joined / switched team) is made further down, with vibe().
# Ready: two marimba notes going up.
save('ready', reverb(mix(marimba(G5, 0.3, 0.5), marimba(C6, 0.4, 0.55), offsets=[0, 0.08]), 0.14), EVENT * 0.8)
# Your turn: a soft bell with a gentle shimmer.
save('turn', reverb(mix(bell(A5, 1.1, 0.5, ratio=3.01, index=1.4, decay=0.45), bell(A6, 0.6, 0.12, ratio=2.0, index=0.8, decay=0.2)), 0.22, tail=0.8), EVENT)

# ── hangman ────────────────────────────────────────────────────────────────
# Letter found: a bright glockenspiel pair.
save('hit', reverb(mix(bell(E6, 0.7, 0.45, ratio=3.5, index=1.8, decay=0.3), bell(G6, 0.8, 0.4, ratio=3.5, index=1.8, decay=0.32), offsets=[0, 0.07]), 0.18), EVENT)
# Wrong letter: a soft wooden knock (a piece of the house moves).
save('miss', reverb(mix(marimba(C4, 0.3, 0.6), pluck(G4 / 2, 0.25, 0.4, 0.1), noise(0.05, 0.3, 0.015, 0.25)), 0.1), EVENT * 0.85)

# ── moments ────────────────────────────────────────────────────────────────
# Game starts: plucked arpeggio up the pentatonic.
save('start', reverb(mix(*[pluck(f, 0.6, 0.45, 0.45) for f in (C5, E5, G5, C6, E6)], offsets=[0, 0.07, 0.14, 0.21, 0.28]), 0.2, tail=0.7), EVENT)
# Round won: bell arpeggio + sparkle on top + a warm low root.
win = [bell(f, 0.9, 0.32, ratio=3.5, index=1.6, decay=0.4) for f in (C6, E6, G6, C7)]
sparkle = [bell(f, 0.4, 0.12, ratio=4.2, index=1.0, decay=0.12) for f in (E6 * 2, G6 * 2, C7 * 2)]
save('win', reverb(mix(tone(C5, 1.0, 0.25, 0.02, 0.5), *win, *sparkle, offsets=[0, 0, 0.08, 0.16, 0.24, 0.38, 0.46, 0.54]), 0.24, tail=0.9), BIG)
# Round lost: a gentle descending minor phrase on muted plucks — sad, not harsh.
save('lose', reverb(mix(pluck(A4, 0.6, 0.5, 0.2), pluck(G4, 0.6, 0.5, 0.2), pluck(E4, 0.9, 0.55, 0.15), offsets=[0, 0.2, 0.4]), 0.22, tail=0.8), EVENT)
# Game over / trophy: a full bell chord swelling, with a sparkle cascade.
chord = [bell(f, 1.8, 0.24, ratio=3.5, index=1.4, decay=0.9) for f in (C5, G5, C6, E6, G6)]
casc = [bell(f, 0.35, 0.1, ratio=4.0, index=1.0, decay=0.12) for f in (C7, A6 * 2, G6 * 2, E6 * 2, C7 * 2)]
save('trophy', reverb(mix(*chord, *casc, offsets=[0, 0.04, 0.08, 0.12, 0.16, 0.3, 0.38, 0.46, 0.54, 0.62]), 0.28, tail=1.2), BIG)


# ── battleship ─────────────────────────────────────────────────────────────
def whoosh(dur=0.5):
    """An airy whoosh that brightens as the missile approaches."""
    out, l = [], 0.0
    for i in range(int(RATE * dur)):
        t = i / RATE
        l += (0.04 + 0.4 * (t / dur)) * (random.uniform(-1, 1) - l)
        out.append(0.6 * l * math.sin(math.pi * min(1.0, t / dur)) ** 1.3)
    return out


save('whoosh', whoosh(), EVENT * 0.7)


def bloop():
    """A bubble: a short sine whose pitch rises fast."""
    out, ph = [], 0.0
    for i in range(int(RATE * 0.16)):
        t = i / RATE
        ph += TAU * (300 + 900 * (t / 0.16)) / RATE
        out.append(0.5 * math.sin(ph) * env_ad(t, 0.002, 0.05))
    return out


# Splash: the instant crack of the surface, a bloop, a fizz of spray.
save('splash', reverb(mix(noise(0.02, 1.0, 0.006, 0.9), bloop(), noise(0.45, 0.45, 0.14, 0.5, hp=0.8, attack=0.01), offsets=[0, 0.01, 0.0]), 0.16), EVENT)


def crackle(dur, vol, density=0.03):
    out = [0.0] * int(RATE * dur)
    for i in range(len(out)):
        if random.random() < density * (1 - i / len(out)) ** 2:
            for k in range(min(60, len(out) - i)):
                out[i + k] += vol * random.uniform(-1, 1) * math.exp(-k / 9)
    return out


def svf_lowpass(x, cut, q=0.6):
    """Chamberlin state-variable low-pass; cut(t) gives the cutoff in Hz."""
    low = band = 0.0
    out = []
    for i, v in enumerate(x):
        f = 2 * math.sin(math.pi * min(cut(i / RATE), RATE / 6) / RATE)
        low += f * band
        high = v - low - q * band
        band += f * high
        out.append(low)
    return out


def explosion(seed=7):
    """v4 (owner: v3 "too metallic — it needs layers, deeper", 2026-11).
    ONE fixed explosion (fixed seed) so every hit sounds the same. Layers:
      1. a deep thump (120 → 38 Hz) driven into saturation, so its harmonics
         carry the weight on a phone speaker,
      2. the main blast: noise whose low-pass closes from 3 kHz to 160 Hz,
      3. two smaller secondary blasts + thumps at 110 and 260 ms (the
         "ba-BOOM-boom" roll of a real explosion),
      4. a long low rumble (resonant 200 Hz low-pass) that rolls on ~1 s,
      5. a soft, dark crackle of debris.
    No metallic partials."""
    random.seed(seed)
    n = int(RATE * 1.8)

    def thump(f0, f1, decay, vol, drive=2.6):
        out, ph = [], 0.0
        for i in range(n):
            t = i / RATE
            ph += TAU * (f1 + (f0 - f1) * math.exp(-t / 0.09)) / RATE
            out.append(vol * math.tanh(drive * math.sin(ph) * env_ad(t, 0.002, decay)))
        return out

    def blast(c0, c1, decay, vol, q=0.55):
        x = svf_lowpass([random.uniform(-1, 1) for _ in range(n)], lambda t: c1 + (c0 - c1) * math.exp(-t / 0.12), q=q)
        return [v * vol * env_ad(i / RATE, 0.003, decay) for i, v in enumerate(x)]

    rumble = svf_lowpass([random.uniform(-1, 1) for _ in range(n)], lambda t: 200, q=1.1)
    rumble = [v * 1.5 * env_ad(i / RATE, 0.06, 0.8) for i, v in enumerate(rumble)]
    debris = svf_lowpass(crackle(1.2, 0.3, 0.015), lambda t: 1400, q=0.7)
    x = mix(
        noise(0.012, 0.6, 0.004, 0.55),            # soft attack edge
        thump(120, 38, 0.38, 1.0),
        blast(3000, 160, 0.42, 1.5),
        thump(95, 36, 0.28, 0.55), blast(1800, 140, 0.32, 0.8),
        thump(80, 34, 0.30, 0.4), blast(1300, 130, 0.36, 0.55),
        rumble,
        debris,
        offsets=[0, 0, 0.002, 0.11, 0.11, 0.26, 0.26, 0.03, 0.2],
    )
    return [math.tanh(1.35 * v) for v in x]


BOOM = explosion()
save('boom', reverb(BOOM, 0.25, room=0.86, tail=1.0), BIG)


def groan(dur=1.3):
    """Hull bending: a low metallic tone sliding down with a slow wobble."""
    out, ph = [], 0.0
    for i in range(int(RATE * dur)):
        t = i / RATE
        f = 210 - 90 * (t / dur) + 6 * math.sin(TAU * 5 * t)
        ph += TAU * f / RATE
        s = math.sin(ph) + 0.5 * math.sin(2.01 * ph) + 0.3 * math.sin(3.03 * ph)
        out.append(0.22 * s * env_ad(t, 0.12, 0.6))
    return out


# A ship sinks: the SAME boom as a hit, then the hull groans and bubbles rise.
random.seed(5)
bubbles = [tone(300 + random.random() * 500, 0.08, 0.22, 0.002, 0.03, bend=0.8, harm=(1,)) for _ in range(10)]
save('sink', reverb(mix(BOOM, groan(), *bubbles, offsets=[0, 0.6] + [0.9 + i * 0.085 for i in range(10)]), 0.25, room=0.86, tail=1.0), BIG)


def vibe(freq, dur=0.9, vol=0.5):
    """Soft vibraphone-like note: sine partials 1x/4x/10x, gentle attack, slow tremolo."""
    out = []
    for i in range(int(RATE * dur)):
        t = i / RATE
        s = math.sin(TAU * freq * t) * math.exp(-t / 0.45)
        s += 0.18 * math.sin(TAU * freq * 4 * t) * math.exp(-t / 0.12)
        s += 0.05 * math.sin(TAU * freq * 10 * t) * math.exp(-t / 0.04)
        out.append(vol * min(1.0, t / 0.006) * s * (1 - 0.12 * math.sin(TAU * 5.5 * t)))
    return out


# Someone joined / you entered (owner didn't like the plucked-string "pop"):
# a soft, warm two-note "plim" going up a fifth.
save('pop', reverb(mix(vibe(C5, 0.7, 0.5), vibe(G5, 0.9, 0.5), offsets=[0, 0.09]), 0.16, tail=0.6), UI * 1.2)

# ── quiz ───────────────────────────────────────────────────────────────────
def saw_chord(freqs, dur, vol=0.4, decay=0.25):
    """Bright buzzy chord (band-limited saw via the first harmonics) — a
    friendly game-show buzzer, not an alarm."""
    out = []
    for i in range(int(RATE * dur)):
        t = i / RATE
        s = 0.0
        for f in freqs:
            for k in range(1, 7):
                s += math.sin(TAU * f * k * t) / k
        out.append(vol * env_ad(t, 0.003, decay) * s / (len(freqs) * 2.4))
    return out


# Buzzer: someone hit the button first — a short, bright major chord blast.
save('buzzer', reverb(mix(saw_chord((C5, E5, G5), 0.45, 0.6, 0.22), marimba(C6, 0.2, 0.3)), 0.12), BIG * 0.9)
# Right answer: "ding-ding!" — two vibraphone notes up an octave + sparkle.
save('correct', reverb(mix(vibe(G5, 0.8, 0.55), vibe(G6, 1.0, 0.5), bell(D6 * 2, 0.4, 0.12, 4.2, 1.0, 0.12), offsets=[0, 0.11, 0.2]), 0.2, tail=0.7), EVENT * 1.1)
# Wrong answer: a soft two-note "bwomp" down a minor third — clear, not mean.
save('wrong', reverb(mix(tone(E4, 0.28, 0.5, 0.004, 0.12, bend=-0.08, harm=(1, 0.5, 0.25, 0.12)),
                         tone(hz(61), 0.42, 0.5, 0.004, 0.16, bend=-0.1, harm=(1, 0.5, 0.25, 0.12)), offsets=[0, 0.16]), 0.12), EVENT)
# Countdown tick (last seconds): a dry woodblock.
save('tick', mix(marimba(hz(84), 0.07, 0.5), noise(0.008, 0.3, 0.003, 0.8)), UI * 0.9)

print('wrote', sorted(os.listdir(OUT)))

# ── applause ───────────────────────────────────────────────────────────────
# The results screen. v1 (six clappers, sharp 14 ms clicks in a big room)
# sounded like firecrackers popping on the floor (owner, 2026-11-13). Real
# applause is a CROWD: ~30 people, each clap a soft slap whose colour comes
# from the cupped hands — a resonance somewhere in 700 Hz–2 kHz (cupped =
# lower, flat = higher) over some broadband noise, a ~0.5 ms rise and a
# ~6–10 ms decay. So many of them overlap that they blur into a "rain"; a
# quiet noise bed under it fills the gaps. Swell in, hold, die away, small
# room only — a big reverb is what made v1 read as bangs.
def biquad_bp(freq, q):
    w = TAU * freq / RATE
    alpha = math.sin(w) / (2 * q)
    b0, b2 = alpha, -alpha
    a0, a1, a2 = 1 + alpha, -2 * math.cos(w), 1 - alpha
    return b0 / a0, b2 / a0, a1 / a0, a2 / a0


def clap(rnd, res, vol):
    dur = 0.045
    b0, b2, a1, a2 = biquad_bp(res, rnd.uniform(2.0, 3.5))
    x1 = x2 = y1 = y2 = 0.0
    decay = rnd.uniform(0.006, 0.010)
    out = []
    for i in range(int(RATE * dur)):
        t = i / RATE
        x = rnd.uniform(-1, 1) * (min(1.0, t / 0.0005)) * math.exp(-t / decay)
        y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1 = x1, x
        y2, y1 = y1, y
        out.append(vol * (y * 2.2 + x * 0.35))   # the hand resonance + a little raw slap
    return out


def applause(dur=3.0, people=30, seed=7):
    rnd = random.Random(seed)
    n = int(RATE * dur)
    buf = [0.0] * (n + RATE)

    def swell(t):
        return min(1.0, t / 0.35) ** 1.5 * (1.0 if t < dur - 1.3 else max(0.0, (dur - t) / 1.3) ** 1.6)

    for _ in range(people):
        res = rnd.uniform(700, 2000)
        pace = rnd.uniform(3.6, 5.2)          # claps per second
        loud = rnd.uniform(0.35, 1.0) * (0.55 if rnd.random() < 0.5 else 1.0)  # near and far
        t = rnd.uniform(0.0, 0.3)
        while t < dur:
            g = swell(t)
            if g > 0.02:
                c = clap(rnd, res * rnd.uniform(0.94, 1.06), loud * g * rnd.uniform(0.75, 1.0))
                k = int(t * RATE)
                for i, v in enumerate(c):
                    buf[k + i] += v
            t += (1.0 / pace) * rnd.uniform(0.85, 1.15)
    # the blur between claps: band-limited noise following the same swell
    b0, b2, a1, a2 = biquad_bp(1300, 0.7)
    x1 = x2 = y1 = y2 = 0.0
    for i in range(n):
        x = rnd.uniform(-1, 1)
        y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1 = x1, x
        y2, y1 = y1, y
        buf[i] += 0.22 * y * swell(i / RATE)
    return buf


save('applause', reverb(applause(), 0.08, room=0.5, tail=0.3), BIG * 0.85)
