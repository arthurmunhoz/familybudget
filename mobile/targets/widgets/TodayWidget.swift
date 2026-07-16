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
  -> (temp: Double, unit: String, code: Int, alertKind: String?)?
{
  let s =
    "https://api.open-meteo.com/v1/forecast?latitude=\(lat)&longitude=\(lon)"
    + "&current=temperature_2m,weather_code"
    + "&daily=weather_code,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,wind_gusts_10m_max"
    + "&temperature_unit=\(unit)&wind_speed_unit=kmh&timezone=auto&forecast_days=1"
  guard
    let url = URL(string: s),
    let (data, _) = try? await URLSession.shared.data(from: url),
    let r = try? JSONDecoder().decode(OMResponse.self, from: data),
    let cur = r.current
  else { return nil }
  let unitStr = r.current_units?.temperature_2m ?? (unit == "celsius" ? "°C" : "°F")
  return (cur.temperature_2m.rounded(), unitStr, cur.weather_code, dayAlert(r.daily, unit))
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
  var items: [TodayItem]?

  if let lat = cfg?.lat, let lon = cfg?.lon,
    let w = await fetchWeather(lat: lat, lon: lon, unit: cfg?.unit ?? "fahrenheit")
  {
    temp = w.temp
    unitStr = w.unit
    code = w.code
    alertKind = w.alertKind
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
  }
  if items == nil { items = cache?.items ?? snap?.items }

  saveTodayCache(
    TodayCache(
      day: today, items: items, temp: temp, unit: unitStr, code: code, alertKind: alertKind))

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
    emptyLabel: base?.emptyLabel ?? "Nothing today")
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
struct TodayWidgetView: View {
  var entry: TodayEntry
  @Environment(\.widgetFamily) var family

  private var maxItems: Int {
    switch family {
    case .systemSmall: return 3
    case .systemMedium: return 4
    default: return 7
    }
  }
  private var isSmall: Bool { family == .systemSmall }

  var body: some View {
    if let info = entry.info {
      VStack(alignment: .leading, spacing: isSmall ? 6 : 8) {
        HStack(alignment: .top) {
          VStack(alignment: .leading, spacing: 0) {
            Text(info.todayLabel.uppercased())
              .font(.system(size: 10, weight: .bold))
              .foregroundStyle(.secondary)
            Text(isSmall ? info.dateShort : info.dateLong)
              .font(.system(size: isSmall ? 15 : 18, weight: .bold))
              .lineLimit(1)
              .minimumScaleFactor(0.7)
          }
          Spacer(minLength: 4)
          if let temp = info.temp {
            VStack(alignment: .trailing, spacing: 0) {
              HStack(spacing: 3) {
                Image(systemName: weatherSymbol(info.code ?? -1))
                  .font(.system(size: 14))
                  .symbolRenderingMode(.multicolor)
                Text("\(Int(temp))\(info.unit ?? "°")")
                  .font(.system(size: isSmall ? 14 : 16, weight: .bold))
              }
              if !isSmall, let city = info.city {
                Text(city).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
              }
            }
          }
        }

        // Weather alert (rain / storm / extreme temp / wind) — mirrors the app's
        // Today card banner. Medium/large only (small has no room).
        if !isSmall, let alert = info.alert {
          HStack(spacing: 6) {
            Image(systemName: alertSymbol(info.alertKind ?? ""))
              .symbolRenderingMode(.multicolor)
              .font(.system(size: 13))
            Text(alert).font(.caption2).lineLimit(2)
            Spacer(minLength: 0)
          }
          .padding(.horizontal, 8)
          .padding(.vertical, 6)
          .background(Color.accentColor.opacity(0.15))
          .clipShape(RoundedRectangle(cornerRadius: 8))
        }

        if info.items.isEmpty {
          // Center the empty message (with a small glyph) so the widget reads as
          // intentionally "clear day" instead of a top-stuck label + blank space.
          Spacer(minLength: 0)
          VStack(spacing: 6) {
            Image(systemName: "checkmark.circle").font(.title3).foregroundStyle(.secondary)
            Text(info.emptyLabel)
              .font(.caption)
              .foregroundStyle(.secondary)
              .multilineTextAlignment(.center)
          }
          .frame(maxWidth: .infinity)
          Spacer(minLength: 0)
        } else {
          VStack(alignment: .leading, spacing: isSmall ? 5 : 6) {
            ForEach(Array(info.items.prefix(maxItems).enumerated()), id: \.offset) { _, item in
              HStack(spacing: 6) {
                Text(item.emoji).font(.system(size: isSmall ? 13 : 15))
                Text(item.title)
                  .font(.system(size: isSmall ? 12 : 13, weight: .medium))
                  .lineLimit(1)
                if !isSmall, let sub = item.subtitle {
                  Text("· \(sub)")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                }
                Spacer(minLength: 0)
              }
            }
          }
          Spacer(minLength: 0)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    } else {
      VStack(spacing: 4) {
        Image(systemName: "calendar").foregroundStyle(.secondary)
        Text("Open One Roof").font(.caption).foregroundStyle(.secondary)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }
}

struct TodayWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "TodayWidget", provider: TodayProvider()) { entry in
      TodayWidgetView(entry: entry)
        .containerBackground(.fill.tertiary, for: .widget)
    }
    .configurationDisplayName("Today")
    .description("Today's agenda and weather at a glance.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}
