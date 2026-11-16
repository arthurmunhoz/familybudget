import WidgetKit
import SwiftUI

// Home-Screen "Today" widget — mirrors the app's Hub info card: today's date,
// current weather, and today's agenda (calendar events + pet-care due).
//
// This widget REFRESHES ITSELF; it does not depend on the app being opened:
//   • the date is derived from Date() at render (never a string baked by the app)
//   • the weather is fetched straight from Open-Meteo (public, keyless) using the
//     home coords the app mirrors into the App Group under "today_cfg"
//   • the agenda is fetched from /api/widget-today with the per-device widget
//     token — the same auth trick NudgesWidget.swift uses, since the extension
//     has no Supabase session
// The app's own snapshot ("today", written by TodaySection.tsx) is now only a
// fallback, and is used ONLY if it describes the current day.
// APP_GROUP / groupDefaults() are declared in index.swift (same target).

// The endpoint is WIDGET_ENDPOINT (index.swift) — one action-dispatched
// function for every widget; see api/widget.ts.

struct TodayItem: Codable {
  let emoji: String
  let title: String
  let subtitle: String?
}

/// The app-written snapshot (fallback only). `day` is optional so a payload
/// written by an older build still decodes.
struct TodayInfo: Codable {
  let todayLabel: String
  let day: String?
  let dateLong: String
  let dateShort: String
  let temp: Double?
  let unit: String?
  let code: Int?
  let city: String?
  let alert: String?
  let alertKind: String?
  let items: [TodayItem]
  let emptyLabel: String
}

/// Written by lib/widget.ts syncTodayConfig — what the widget needs to go and
/// get fresh data on its own.
struct TodayConfig: Codable {
  let locale: String
  let unit: String
  let lat: Double?
  let lon: Double?
  let city: String?
  let alerts: [String: String]
}

/// Last successful fetch, so a refresh with no connection doesn't blank the card.
struct TodayCache: Codable {
  let day: String
  let items: [TodayItem]?
  let temp: Double?
  let unit: String?
  let code: Int?
  let alertKind: String?
  /// Open-Meteo `is_day` at fetch time. Optional: caches written before the
  /// sky look have no such key and must still decode.
  let isDay: Bool?
}

/// What the view actually renders (assembled fresh on every timeline reload).
struct TodayRender {
  let todayLabel: String
  let dateLong: String
  let dateShort: String
  let temp: Double?
  let unit: String?
  let code: Int?
  let city: String?
  let alert: String?
  let alertKind: String?
  let items: [TodayItem]
  let emptyLabel: String
  /// nil when unknown → the view falls back to roughlyDay().
  var isDay: Bool? = nil
}

func loadToday() -> TodayInfo? {
  guard
    let raw = groupDefaults()?.string(forKey: "today"),
    let data = raw.data(using: .utf8),
    let info = try? JSONDecoder().decode(TodayInfo.self, from: data)
  else { return nil }
  return info
}

func loadTodayConfig() -> TodayConfig? {
  guard
    let raw = groupDefaults()?.string(forKey: "today_cfg"),
    let data = raw.data(using: .utf8),
    let cfg = try? JSONDecoder().decode(TodayConfig.self, from: data)
  else { return nil }
  return cfg
}

func loadTodayCache() -> TodayCache? {
  guard
    let raw = groupDefaults()?.string(forKey: "today_live"),
    let data = raw.data(using: .utf8),
    let c = try? JSONDecoder().decode(TodayCache.self, from: data)
  else { return nil }
  return c
}

func saveTodayCache(_ c: TodayCache) {
  guard let data = try? JSONEncoder().encode(c), let s = String(data: data, encoding: .utf8)
  else { return }
  groupDefaults()?.set(s, forKey: "today_live")
}

// ── Dates ────────────────────────────────────────────────────────────────────
/// The device's local day as YYYY-MM-DD (matches the app's todayISO()).
func isoDay(_ d: Date) -> String {
  let f = DateFormatter()
  f.locale = Locale(identifier: "en_US_POSIX")
  f.dateFormat = "yyyy-MM-dd"
  return f.string(from: d)
}

/// Localized ("Wed, Jul 9" / "Wed 9") using the app's chosen language, not the
/// device's — the app mirrors its locale into today_cfg.
func dateStrings(_ date: Date, _ localeId: String) -> (long: String, short: String) {
  let loc = Locale(identifier: localeId)
  let f = DateFormatter()
  f.locale = loc
  f.setLocalizedDateFormatFromTemplate("EEEMMMd")
  let g = DateFormatter()
  g.locale = loc
  g.setLocalizedDateFormatFromTemplate("EEEd")
  return (f.string(from: date), g.string(from: date))
}

/// The next :00. Midnight is always an hour boundary, so scheduling here means
/// the date flips exactly at midnight AND the weather refreshes hourly.
func nextHourBoundary() -> Date {
  Calendar.current.nextDate(
    after: Date(), matching: DateComponents(minute: 0, second: 0), matchingPolicy: .nextTime)
    ?? Date().addingTimeInterval(3600)
}

// ── Fetching ─────────────────────────────────────────────────────────────────
private struct OMResponse: Codable {
  struct Current: Codable {
    let temperature_2m: Double
    let weather_code: Int
    let is_day: Int?
  }
  struct CurrentUnits: Codable { let temperature_2m: String? }
  struct Daily: Codable {
    let weather_code: [Int]?
    let apparent_temperature_max: [Double]?
    let apparent_temperature_min: [Double]?
    let precipitation_probability_max: [Int]?
    let wind_gusts_10m_max: [Double]?
  }
  let current: Current?
  let current_units: CurrentUnits?
  let daily: Daily?
}

/// Mirrors fetchDayAlert() in mobile/src/lib/weather.ts — same priority order and
/// thresholds (thunder > heavy snow > heat > cold > wind > rain). Keep in sync.
private func dayAlert(_ d: OMResponse.Daily?, _ unit: String) -> String? {
  guard let d else { return nil }
  let code = d.weather_code?.first ?? 0
  let pop = d.precipitation_probability_max?.first ?? 0
  let gust = d.wind_gusts_10m_max?.first ?? 0
  let hot: Double = unit == "celsius" ? 37 : 99
  let cold: Double = unit == "celsius" ? 0 : 32
  if code >= 95 { return "thunder" }
  if code == 75 || code == 77 || code == 86 { return "snow" }
  if let tHi = d.apparent_temperature_max?.first, tHi >= hot { return "heat" }
  if let tLo = d.apparent_temperature_min?.first, tLo <= cold { return "cold" }
  if gust >= 55 { return "wind" }
  if pop >= 60 { return "rain" }
  return nil
}

private func fetchWeather(lat: Double, lon: Double, unit: String) async
  -> (temp: Double, unit: String, code: Int, alertKind: String?, isDay: Bool?)?
{
  let s =
    "https://api.open-meteo.com/v1/forecast?latitude=\(lat)&longitude=\(lon)"
    + "&current=temperature_2m,weather_code,is_day"
    + "&daily=weather_code,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,wind_gusts_10m_max"
    + "&temperature_unit=\(unit)&wind_speed_unit=kmh&timezone=auto&forecast_days=1"
  guard
    let url = URL(string: s),
    let (data, _) = try? await URLSession.shared.data(from: url),
    let r = try? JSONDecoder().decode(OMResponse.self, from: data),
    let cur = r.current
  else { return nil }
  let unitStr = r.current_units?.temperature_2m ?? (unit == "celsius" ? "°C" : "°F")
  return (cur.temperature_2m.rounded(), unitStr, cur.weather_code, dayAlert(r.daily, unit), cur.is_day.map { $0 == 1 })
}

private struct AgendaResponse: Codable {
  let day: String
  let items: [TodayItem]
}

private func fetchAgenda(token: String, day: String, locale: String) async -> [TodayItem]? {
  guard let url = URL(string: WIDGET_ENDPOINT) else { return nil }
  var req = URLRequest(url: url)
  req.httpMethod = "POST"
  req.setValue("application/json", forHTTPHeaderField: "Content-Type")
  req.httpBody = try? JSONSerialization.data(
    withJSONObject: ["action": "today", "token": token, "day": day, "locale": locale])
  guard
    let (data, resp) = try? await URLSession.shared.data(for: req),
    (resp as? HTTPURLResponse)?.statusCode == 200,
    let r = try? JSONDecoder().decode(AgendaResponse.self, from: data)
  else { return nil }
  return r.items
}

/// Assemble the card: live data where we can get it, last-good cache next, and
/// the app's snapshot last — the latter two only when they describe TODAY, so we
/// never present yesterday's agenda as today's.
func buildToday() async -> TodayRender? {
  let base = loadToday()
  let cfg = loadTodayConfig()
  if base == nil && cfg == nil { return nil }

  let localeId = cfg?.locale ?? "en-US"
  let now = Date()
  let today = isoDay(now)
  let (long, short) = dateStrings(now, localeId)

  var temp: Double?
  var unitStr: String?
  var code: Int?
  var alertKind: String?
  var isDay: Bool?
  var items: [TodayItem]?

  if let lat = cfg?.lat, let lon = cfg?.lon,
    let w = await fetchWeather(lat: lat, lon: lon, unit: cfg?.unit ?? "fahrenheit")
  {
    temp = w.temp
    unitStr = w.unit
    code = w.code
    alertKind = w.alertKind
    isDay = w.isDay
  }

  let token = groupDefaults()?.string(forKey: "widget_token") ?? ""
  if !token.isEmpty {
    items = await fetchAgenda(token: token, day: today, locale: localeId)
  }

  let cached = loadTodayCache()
  let cache = cached?.day == today ? cached : nil
  let snap = base?.day == today ? base : nil

  if temp == nil {
    temp = cache?.temp ?? snap?.temp
    unitStr = cache?.unit ?? snap?.unit
    code = cache?.code ?? snap?.code
    alertKind = cache?.alertKind ?? snap?.alertKind
    isDay = cache?.isDay
  }
  if items == nil { items = cache?.items ?? snap?.items }

  saveTodayCache(
    TodayCache(
      day: today, items: items, temp: temp, unit: unitStr, code: code, alertKind: alertKind,
      isDay: isDay))

  return TodayRender(
    todayLabel: base?.todayLabel ?? "Today",
    dateLong: long,
    dateShort: short,
    temp: temp,
    unit: unitStr,
    code: code,
    city: cfg?.city ?? base?.city,
    alert: alertKind.flatMap { cfg?.alerts[$0] },
    alertKind: alertKind,
    items: items ?? [],
    emptyLabel: base?.emptyLabel ?? "Nothing today",
    isDay: isDay)
}

// Weather-alert kind → SF Symbol (matches lib/weather.ts WeatherAlertKind).
func alertSymbol(_ kind: String) -> String {
  switch kind {
  case "thunder": return "cloud.bolt.rain.fill"
  case "snow": return "cloud.snow.fill"
  case "heat": return "thermometer.sun.fill"
  case "cold": return "thermometer.snowflake"
  case "wind": return "wind"
  default: return "cloud.rain.fill" // rain
  }
}

// WMO weather code → SF Symbol (matches lib/weather.ts weatherIcon).
func weatherSymbol(_ code: Int) -> String {
  switch code {
  case 0: return "sun.max.fill"
  case 1, 2: return "cloud.sun.fill"
  case 3: return "cloud.fill"
  case 45, 48: return "cloud.fog.fill"
  case 51...57: return "cloud.drizzle.fill"
  case 61...67, 80...82: return "cloud.rain.fill"
  case 71...77, 85, 86: return "cloud.snow.fill"
  case 95...99: return "cloud.bolt.rain.fill"
  default: return "cloud.fill"
  }
}

private let sampleToday = TodayRender(
  todayLabel: "Today",
  dateLong: "Wed, Jul 9",
  dateShort: "Wed 9",
  temp: 72,
  unit: "°F",
  code: 2,
  city: "Austin",
  alert: "Rain likely today — grab an umbrella.",
  alertKind: "rain",
  items: [
    TodayItem(emoji: "🎂", title: "Mom's birthday", subtitle: "turns 58"),
    TodayItem(emoji: "🐾", title: "Bella — vet checkup", subtitle: "due"),
    TodayItem(emoji: "🎸", title: "Guitar lesson", subtitle: "5:00 PM"),
  ],
  emptyLabel: "Nothing today")

// ── Timeline ─────────────────────────────────────────────────────────────────
struct TodayEntry: TimelineEntry {
  let date: Date
  let info: TodayRender?
}

struct TodayProvider: TimelineProvider {
  func placeholder(in context: Context) -> TodayEntry {
    TodayEntry(date: Date(), info: sampleToday)
  }
  func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
    if context.isPreview {
      completion(TodayEntry(date: Date(), info: sampleToday))
      return
    }
    Task { completion(TodayEntry(date: Date(), info: await buildToday())) }
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
    Task {
      let render = await buildToday()
      // Refetch on the hour; midnight is an hour boundary, so the date turns
      // over on time even if nobody opens the app.
      completion(
        Timeline(
          entries: [TodayEntry(date: Date(), info: render)], policy: .after(nextHourBoundary())))
    }
  }
}

// ── View ─────────────────────────────────────────────────────────────────────
// The 2026-11 look (see Kit.swift): the weather sky carries the date and the
// temperature in white; the agenda sits on a neutral appTheme() surface (medium
// / large) or straight on the sky (small). No SwiftUI semantic colours — they
// follow the DEVICE appearance, not the app's manual theme.

/// Fallback header when there is no weather (no home city / fetch failed).
private let TODAY_NO_WEATHER = ["3E7BFA", "5B4CF0"]
private let TODAY_PAD: CGFloat = 14

/// The header backdrop: the sky for the current weather, else the gradient.
private struct TodaySky: View {
  let info: TodayRender?
  let date: Date
  var body: some View {
    if let info, info.temp != nil, let code = info.code {
      SkyScene(kind: skyKind(code: code, isDay: info.isDay ?? roughlyDay(date)))
    } else {
      WGradient(TODAY_NO_WEATHER)
    }
  }
}

/// Row bar colour. The agenda payload carries no colour or kind of its own, so
/// the only signal is the emoji the server picked: pet care wears the Pets hue,
/// everything else the app's accent.
private func todayBarColor(_ item: TodayItem) -> Color {
  if item.emoji == "🐾" { return Color(hex: WG.pets[1]) }
  return appTheme().accent
}

private func tempText(_ info: TodayRender) -> String? {
  guard let t = info.temp else { return nil }
  return "\(Int(t))\(info.unit ?? "°")"
}

/// One agenda row on the neutral surface: colour bar, title, time/who.
private struct TodayRow: View {
  let item: TodayItem
  var body: some View {
    let theme = appTheme()
    let sub = (item.subtitle ?? "").isEmpty ? nil : item.subtitle
    HStack(alignment: .center, spacing: 8) {
      RoundedRectangle(cornerRadius: 1.5, style: .continuous)
        .fill(todayBarColor(item))
        .frame(width: 3, height: sub == nil ? 16 : 28)
      VStack(alignment: .leading, spacing: 1) {
        Text(item.title)
          .font(.system(size: 13, weight: .semibold, design: .rounded))
          .foregroundStyle(theme.text)
          .lineLimit(1)
          .minimumScaleFactor(0.85)
        if let sub {
          Text(sub)
            .font(.system(size: 11.5, weight: .medium, design: .rounded))
            .foregroundStyle(theme.textMuted)
            .lineLimit(1)
            .minimumScaleFactor(0.85)
        }
      }
      Spacer(minLength: 0)
    }
    .frame(height: TodayRow.height, alignment: .center)
  }
  static let height: CGFloat = 32
  static let gap: CGFloat = 6
}

/// The agenda on the neutral surface; shows as many rows as actually fit (up to
/// `maxRows`) and a muted "+N" footer when there are more.
private struct TodayAgenda: View {
  let info: TodayRender
  let maxRows: Int
  let footer: Bool
  var body: some View {
    let theme = appTheme()
    GeometryReader { geo in
      let footerH: CGFloat = 16
      let avail = geo.size.height
      let fitAll = Int((avail + TodayRow.gap) / (TodayRow.height + TodayRow.gap))
      let wantAll = min(maxRows, info.items.count)
      let needsFooter = footer && (info.items.count > min(wantAll, fitAll))
      let fit = needsFooter
        ? Int((avail - footerH + TodayRow.gap) / (TodayRow.height + TodayRow.gap)) : fitAll
      let n = max(1, min(wantAll, fit))
      let more = info.items.count - n
      if info.items.isEmpty {
        VStack(spacing: 6) {
          Image(systemName: "checkmark.circle")
            .font(.system(size: 20, weight: .semibold))
            .foregroundStyle(theme.textMuted)
          Text(info.emptyLabel)
            .font(.system(size: 12, weight: .medium, design: .rounded))
            .foregroundStyle(theme.textMuted)
            .multilineTextAlignment(.center)
            .lineLimit(2)
            .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        VStack(alignment: .leading, spacing: TodayRow.gap) {
          ForEach(Array(info.items.prefix(n).enumerated()), id: \.offset) { _, item in
            TodayRow(item: item)
          }
          if footer && more > 0 {
            Text("+\(more)")
              .font(.system(size: 11.5, weight: .semibold, design: .rounded))
              .foregroundStyle(theme.textMuted)
              .lineLimit(1)
              .padding(.leading, 11)
          }
          Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      }
    }
  }
}

/// Date kicker + big temperature (or the date large, with no weather) + the
/// one-line condition / alert. White on the sky.
private struct TodayHeader: View {
  let info: TodayRender
  let longDate: Bool
  let bigSize: CGFloat
  let noteLines: Int

  var body: some View {
    let date = longDate ? info.dateLong : info.dateShort
    VStack(alignment: .leading, spacing: 1) {
      if let t = tempText(info) {
        WKicker(date)
        WBig(t, size: bigSize)
      } else {
        WKicker(info.todayLabel)
        WBig(date, size: bigSize * 0.76)
      }
      Spacer(minLength: 4)
      note
    }
    .shadow(color: .black.opacity(0.18), radius: 2, x: 0, y: 1)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  /// The alert sentence when there is one, else the weather glyph + city.
  @ViewBuilder private var note: some View {
    if let alert = info.alert, !alert.isEmpty {
      noteLine(alertSymbol(info.alertKind ?? ""), alert)
    } else if info.temp != nil, let code = info.code {
      noteLine(weatherSymbol(code), info.city ?? "")
    } else if let city = info.city, !city.isEmpty {
      noteLine("mappin.and.ellipse", city)
    }
  }

  private func noteLine(_ symbol: String, _ text: String) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 5) {
      Image(systemName: symbol)
        .font(.system(size: 11, weight: .bold))
        .foregroundStyle(.white)
      if !text.isEmpty {
        Text(text)
          .font(.system(size: 11.5, weight: .semibold, design: .rounded))
          .foregroundStyle(.white.opacity(0.95))
          .lineLimit(noteLines)
          .minimumScaleFactor(0.8)
      }
    }
  }
}

struct TodayWidgetView: View {
  var entry: TodayEntry
  @Environment(\.widgetFamily) var family

  var body: some View {
    if let info = entry.info {
      switch family {
      case .systemSmall: small(info)
      case .systemMedium: medium(info)
      default: large(info)
      }
    } else {
      VStack(spacing: 6) {
        Image(systemName: "calendar")
          .font(.system(size: 22, weight: .bold))
          .foregroundStyle(.white)
        Text("Open One Roof")
          .font(.system(size: 13, weight: .semibold, design: .rounded))
          .foregroundStyle(.white)
          .lineLimit(1)
          .minimumScaleFactor(0.7)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(WGradient(TODAY_NO_WEATHER))
    }
  }

  // Small: the sky is the whole widget (it is the container background).
  private func small(_ info: TodayRender) -> some View {
    VStack(alignment: .leading, spacing: 1) {
      if let t = tempText(info) {
        WKicker(info.dateShort)
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          WBig(t, size: 34)
          if let kind = info.alertKind {
            Image(systemName: alertSymbol(kind))
              .font(.system(size: 12, weight: .bold))
              .foregroundStyle(.white.opacity(0.95))
          }
        }
      } else {
        WKicker(info.todayLabel)
        WBig(info.dateShort, size: 26)
      }
      Spacer(minLength: 4)
      if let next = info.items.first {
        let more = info.items.count - 1
        let sub = (next.subtitle ?? "").isEmpty ? nil : next.subtitle
        let line = [sub, more > 0 ? "+\(more)" : nil].compactMap { $0 }.joined(separator: " · ")
        Text(next.title)
          .font(.system(size: 13, weight: .semibold, design: .rounded))
          .foregroundStyle(.white)
          .lineLimit(1)
          .minimumScaleFactor(0.8)
        if !line.isEmpty {
          Text(line)
            .font(.system(size: 11.5, weight: .medium, design: .rounded))
            .foregroundStyle(.white.opacity(0.8))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
        }
      } else {
        Text(info.emptyLabel)
          .font(.system(size: 12, weight: .semibold, design: .rounded))
          .foregroundStyle(.white.opacity(0.85))
          .lineLimit(2)
          .minimumScaleFactor(0.8)
      }
    }
    .shadow(color: .black.opacity(0.18), radius: 2, x: 0, y: 1)
    .padding(TODAY_PAD)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  // Medium: sky on the left ~42%, agenda on the neutral surface on the right.
  private func medium(_ info: TodayRender) -> some View {
    GeometryReader { geo in
      HStack(spacing: 0) {
        TodayHeader(info: info, longDate: true, bigSize: 34, noteLines: 2)
          .padding(TODAY_PAD)
          .frame(width: geo.size.width * 0.42)
          .frame(maxHeight: .infinity)
          .background(TodaySky(info: info, date: entry.date))
          .clipped()
        TodayAgenda(info: info, maxRows: 3, footer: false)
          .padding(.horizontal, TODAY_PAD)
          .padding(.vertical, 12)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .background(appTheme().card)
      }
    }
  }

  // Large: sky across the top ~42%, agenda below.
  private func large(_ info: TodayRender) -> some View {
    GeometryReader { geo in
      VStack(spacing: 0) {
        TodayHeader(info: info, longDate: true, bigSize: 42, noteLines: 1)
          .padding(16)
          .frame(height: geo.size.height * 0.42)
          .frame(maxWidth: .infinity)
          .background(TodaySky(info: info, date: entry.date))
          .clipped()
        TodayAgenda(info: info, maxRows: 5, footer: true)
          .padding(.horizontal, 16)
          .padding(.vertical, 12)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .background(appTheme().card)
      }
    }
  }
}

/// Small: the sky itself. Medium / large: the neutral surface (their two halves
/// are drawn edge to edge by the view, since content margins are disabled).
private struct TodayBackdrop: View {
  let entry: TodayEntry
  @Environment(\.widgetFamily) var family
  var body: some View {
    if entry.info == nil {
      WGradient(TODAY_NO_WEATHER)
    } else if family == .systemSmall {
      TodaySky(info: entry.info, date: entry.date)
    } else {
      appTheme().card
    }
  }
}

struct TodayWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "TodayWidget", provider: TodayProvider()) { entry in
      TodayWidgetView(entry: entry)
        .containerBackground(for: .widget) { TodayBackdrop(entry: entry) }
    }
    .configurationDisplayName("Today")
    .description("Today's agenda and weather at a glance.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    // The view pads itself, so the sky and the neutral half reach the edges.
    .contentMarginsDisabled()
  }
}
