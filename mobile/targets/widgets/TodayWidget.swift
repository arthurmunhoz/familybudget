import WidgetKit
import SwiftUI

// Home-Screen "Today" widget — mirrors the app's Hub info card: today's date,
// current weather, and today's agenda (calendar events + pet-care due). The app
// (mobile/src/components/TodaySection.tsx via lib/widget.ts) writes the JSON
// under the App Group key "today". Read-only; tapping opens the app.
// APP_GROUP / groupDefaults() are declared in index.swift (same target).

struct TodayItem: Codable {
  let emoji: String
  let title: String
  let subtitle: String?
}

struct TodayInfo: Codable {
  let todayLabel: String
  let dateLong: String
  let dateShort: String
  let temp: Double?
  let unit: String?
  let code: Int?
  let city: String?
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

private let sampleToday = TodayInfo(
  todayLabel: "Today",
  dateLong: "Wed, Jul 9",
  dateShort: "Wed 9",
  temp: 72,
  unit: "°F",
  code: 2,
  city: "Austin",
  items: [
    TodayItem(emoji: "🎂", title: "Mom's birthday", subtitle: "turns 58"),
    TodayItem(emoji: "🐾", title: "Bella — vet checkup", subtitle: "due"),
    TodayItem(emoji: "🎸", title: "Guitar lesson", subtitle: "5:00 PM"),
  ],
  emptyLabel: "Nothing today")

// ── Timeline ─────────────────────────────────────────────────────────────────
struct TodayEntry: TimelineEntry {
  let date: Date
  let info: TodayInfo?
}

struct TodayProvider: TimelineProvider {
  func placeholder(in context: Context) -> TodayEntry {
    TodayEntry(date: Date(), info: sampleToday)
  }
  func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
    let info = loadToday()
    completion(TodayEntry(date: Date(), info: context.isPreview && info == nil ? sampleToday : info))
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
    let entry = TodayEntry(date: Date(), info: loadToday())
    // Refresh at the top of the next hour so the date/agenda stay current.
    let next = Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date().addingTimeInterval(3600)
    completion(Timeline(entries: [entry], policy: .after(next)))
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
                Image(systemName: weatherSymbol(info.code ?? -1)).font(.system(size: 14))
                Text("\(Int(temp))\(info.unit ?? "°")")
                  .font(.system(size: isSmall ? 14 : 16, weight: .bold))
              }
              if !isSmall, let city = info.city {
                Text(city).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
              }
            }
          }
        }

        if info.items.isEmpty {
          Text(info.emptyLabel).font(.caption).foregroundStyle(.secondary)
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
