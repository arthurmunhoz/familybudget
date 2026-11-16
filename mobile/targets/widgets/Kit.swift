import SwiftUI
import WidgetKit

// ── The 2026-11 widget look ──────────────────────────────────────────────────
// Every widget wears its APP's gradient, exactly like the app's Home icons and
// cards (mobile/src/components/home/palette.ts — keep the hexes in step), with
// white type on it. Gradients are identity: they do NOT change with the app's
// light/dark choice. Only neutral surfaces (the agenda half of Today, list
// rows on a plain card) follow `appTheme()`.
//
// Build a widget from these pieces instead of inventing colours per file:
//   .containerBackground(for: .widget) { WGradient(WG.pets) }
//   WKicker("LOLA · TODAY"), WBig("R$ 1,240"), WProgress(0.5), WCheck(done:)
//   SkyScene(kind: skyKind(code:isDay:)) behind Today's header.

enum WG {
  static let calendar = ["FF5F6D", "FF2E63"]
  static let shopping = ["FFC93C", "FF9A1F"]
  static let budget = ["2BD99A", "0FA37F"]
  static let pets = ["FF9B6A", "F2603A"]
  static let pings = ["6E8BFF", "4A5BF5"]
  static let family = ["C083FF", "8B4DF2"]
  static let urgent = ["F0766A", "D2483C"]
  static let kraft = ["F8EBD6", "EDD7B4"]
}

/// Ink for text on the two LIGHT gradients (shopping yellow, kraft paper).
let W_INK = Color(hex: "2B2521")
let W_INK_SOFT = Color(hex: "6B5E52")
let W_PAPER = Color(hex: "FFFBF2")

struct WGradient: View {
  let colors: [String]
  init(_ colors: [String]) { self.colors = colors }
  var body: some View {
    LinearGradient(colors: colors.map { Color(hex: $0) }, startPoint: .topLeading, endPoint: .bottomTrailing)
  }
}

/// Small tracked uppercase label (the app's section-label voice).
struct WKicker: View {
  let text: String
  var color: Color = .white.opacity(0.9)
  init(_ text: String, color: Color = .white.opacity(0.9)) { self.text = text; self.color = color }
  var body: some View {
    Text(text.uppercased())
      .font(.system(size: 10.5, weight: .bold, design: .rounded))
      .tracking(0.8)
      .foregroundStyle(color)
      .lineLimit(1)
  }
}

/// The headline number / title: rounded, heavy, shrinks before it truncates.
struct WBig: View {
  let text: String
  var size: CGFloat = 30
  var color: Color = .white
  init(_ text: String, size: CGFloat = 30, color: Color = .white) { self.text = text; self.size = size; self.color = color }
  var body: some View {
    Text(text)
      .font(.system(size: size, weight: .heavy, design: .rounded))
      .foregroundStyle(color)
      .lineLimit(1)
      .minimumScaleFactor(0.6)
  }
}

/// A thin progress bar: white on a darker track of the gradient.
struct WProgress: View {
  let value: Double
  var fill: Color = .white
  var track: Color = .black.opacity(0.18)
  var height: CGFloat = 6
  init(_ value: Double, fill: Color = .white, track: Color = .black.opacity(0.18), height: CGFloat = 6) {
    self.value = value; self.fill = fill; self.track = track; self.height = height
  }
  var body: some View {
    GeometryReader { geo in
      ZStack(alignment: .leading) {
        Capsule().fill(track)
        Capsule().fill(fill).frame(width: max(height, geo.size.width * min(1, max(0, value))))
      }
    }
    .frame(height: height)
  }
}

/// The round tick of a checklist row: hollow when open, filled when done.
struct WCheck: View {
  let done: Bool
  var color: Color = .white
  /// The colour of the tick itself on a filled circle (the gradient's hue).
  var tick: Color = Color(hex: "F2603A")
  var size: CGFloat = 20
  var body: some View {
    ZStack {
      if done {
        Circle().fill(color)
        Image(systemName: "checkmark").font(.system(size: size * 0.5, weight: .heavy)).foregroundStyle(tick)
      } else {
        Circle().strokeBorder(color, lineWidth: 2)
      }
    }
    .frame(width: size, height: size)
  }
}

/// A frosted pill / tile on a gradient (buttons, chips).
struct WGlass: ViewModifier {
  var radius: CGFloat = 14
  var strength: Double = 0.2
  func body(content: Content) -> some View {
    content.background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(.white.opacity(strength)))
  }
}
extension View {
  func wGlass(radius: CGFloat = 14, strength: Double = 0.2) -> some View { modifier(WGlass(radius: radius, strength: strength)) }
}

// ── The weather sky (Today) ──────────────────────────────────────────────────
// The same eight skies as the app's Home header (home/WeatherScene +
// sceneKind.ts): a still picture — widgets can't animate — that changes with
// the weather code and day/night on every timeline refresh.

enum SkyKind { case clear, partly, cloudy, fog, rain, snow, storm, night, nightCloudy }

/// Mirror of `sceneFor` in mobile/src/components/home/sceneKind.ts.
func skyKind(code: Int, isDay: Bool) -> SkyKind {
  let night = !isDay
  if code >= 95 { return .storm }
  if (71...77).contains(code) || (85...86).contains(code) { return .snow }
  if (51...67).contains(code) || (80...82).contains(code) { return .rain }
  if code == 45 || code == 48 { return .fog }
  if code == 3 { return night ? .nightCloudy : .cloudy }
  if code == 1 || code == 2 { return night ? .nightCloudy : .partly }
  return night ? .night : .clear
}

/// Day/night without the API's `is_day` (older payloads): 6:00–18:59 is day.
func roughlyDay(_ date: Date = Date()) -> Bool {
  let h = Calendar.current.component(.hour, from: date)
  return h >= 6 && h < 19
}

private func skyColors(_ k: SkyKind, night: Bool) -> [String] {
  switch k {
  case .clear: return ["4F9BFF", "2E6BF0"]
  case .partly: return ["5AA2FA", "3D74E8"]
  case .cloudy: return ["7E93B4", "566A8C"]
  case .fog: return ["9AA5B5", "6F7B8D"]
  case .rain: return night ? ["2A3558", "161D38"] : ["5B7494", "34475F"]
  case .snow: return night ? ["3A4670", "202A4C"] : ["8FB0D6", "5F83B4"]
  case .storm: return ["3B3F5C", "1C1F33"]
  case .night: return ["27306A", "111838"]
  case .nightCloudy: return ["313A66", "171D3A"]
  }
}

private struct Cloud: View {
  var color: Color
  var body: some View {
    GeometryReader { g in
      let w = g.size.width, h = g.size.height
      ZStack {
        Capsule().fill(color).frame(width: w, height: h * 0.55).position(x: w * 0.5, y: h * 0.72)
        Circle().fill(color).frame(width: h * 0.8, height: h * 0.8).position(x: w * 0.36, y: h * 0.5)
        Circle().fill(color).frame(width: h * 0.62, height: h * 0.62).position(x: w * 0.62, y: h * 0.56)
      }
    }
  }
}

struct SkyScene: View {
  let kind: SkyKind
  var body: some View {
    GeometryReader { g in
      let w = g.size.width, h = g.size.height
      let s = min(w, h)
      let night = kind == .night || kind == .nightCloudy
      let dark = night || kind == .storm
      ZStack {
        LinearGradient(colors: skyColors(kind, night: night).map { Color(hex: $0) }, startPoint: .top, endPoint: .bottom)

        // Sun or moon, top right.
        if kind == .clear || kind == .partly {
          Circle().fill(Color(hex: "FFE08A").opacity(0.28)).frame(width: s * 0.86, height: s * 0.86).position(x: w - s * 0.2, y: s * 0.22)
          Circle().fill(Color(hex: "FFD45C").opacity(0.4)).frame(width: s * 0.6, height: s * 0.6).position(x: w - s * 0.2, y: s * 0.22)
          Circle().fill(Color(hex: "FFC93C")).frame(width: s * 0.38, height: s * 0.38).position(x: w - s * 0.2, y: s * 0.22)
        }
        if night {
          // Stars, then a crescent cut from a full moon.
          ForEach(0..<7, id: \.self) { i in
            let xs: [CGFloat] = [0.12, 0.3, 0.46, 0.58, 0.2, 0.7, 0.9]
            let ys: [CGFloat] = [0.2, 0.1, 0.3, 0.14, 0.44, 0.4, 0.5]
            Circle().fill(.white.opacity(0.75)).frame(width: 2.4, height: 2.4).position(x: w * xs[i], y: h * ys[i])
          }
          Circle().fill(Color(hex: "F3EBD2")).frame(width: s * 0.3, height: s * 0.3).position(x: w - s * 0.22, y: s * 0.22)
          Circle().fill(Color(hex: skyColors(kind, night: true)[0])).frame(width: s * 0.26, height: s * 0.26).position(x: w - s * 0.29, y: s * 0.18)
        }

        // Clouds.
        if kind == .partly {
          Cloud(color: .white.opacity(0.85)).frame(width: s * 0.62, height: s * 0.26).position(x: w - s * 0.44, y: s * 0.4)
        }
        if kind == .cloudy || kind == .fog || kind == .nightCloudy || kind == .rain || kind == .snow || kind == .storm {
          let c: Color = dark ? .white.opacity(0.2) : .white.opacity(kind == .rain ? 0.45 : 0.6)
          Cloud(color: c).frame(width: s * 0.8, height: s * 0.32).position(x: w - s * 0.42, y: s * 0.26)
          Cloud(color: c.opacity(0.7)).frame(width: s * 0.56, height: s * 0.22).position(x: w * 0.22, y: s * 0.42)
        }
        if kind == .fog {
          ForEach(0..<3, id: \.self) { i in
            Capsule().fill(.white.opacity(0.28)).frame(width: w * 0.8, height: 5).position(x: w * (0.42 + CGFloat(i) * 0.08), y: h * (0.52 + CGFloat(i) * 0.1))
          }
        }

        // What falls.
        if kind == .rain || kind == .storm {
          ForEach(0..<6, id: \.self) { i in
            Capsule().fill(Color(hex: "A9CCFF").opacity(0.9)).frame(width: 2.4, height: s * 0.09)
              .rotationEffect(.degrees(18))
              .position(x: w - s * (0.72 - CGFloat(i) * 0.11), y: s * (0.5 + CGFloat(i % 2) * 0.07))
          }
        }
        if kind == .storm {
          Image(systemName: "bolt.fill").font(.system(size: s * 0.2, weight: .bold)).foregroundStyle(Color(hex: "FFD45C"))
            .position(x: w - s * 0.3, y: s * 0.5)
        }
        if kind == .snow {
          ForEach(0..<7, id: \.self) { i in
            Circle().fill(.white.opacity(0.95)).frame(width: 4.5, height: 4.5)
              .position(x: w - s * (0.78 - CGFloat(i) * 0.1), y: s * (0.48 + CGFloat(i % 3) * 0.06))
          }
        }

        // Fade to the sky's own bottom colour so text over the lower half reads.
        LinearGradient(colors: [.clear, Color(hex: skyColors(kind, night: night)[1]).opacity(0.85)], startPoint: .center, endPoint: .bottom)
      }
    }
  }
}
