import WidgetKit
import SwiftUI
import AppIntents

// ── Shared ───────────────────────────────────────────────────────────────────
let APP_GROUP = "group.com.oneroof.app"

/// The one action-dispatched widget endpoint (api/widget.ts): ?action=nudge |
/// today | budget. Authenticated with the per-device widget token, since the
/// extension has no Supabase session. NOTE: NudgesWidget deliberately still
/// posts to the legacy /api/widget-nudge URL (rewritten onto the same function)
/// because that path is baked into shipped App Store builds.
let WIDGET_ENDPOINT = "https://one-roof-app.vercel.app/api/widget"

func groupDefaults() -> UserDefaults? { UserDefaults(suiteName: APP_GROUP) }
// widgetToken() lives in NudgesWidget.swift (same target).

// "Warm Hearth" tokens, ported 1:1 from mobile/src/theme/theme.ts. The app's
// theme is a MANUAL, persisted choice (Settings → Appearance), independent of
// the system light/dark setting — so widgets must read the app's own choice
// (mirrored into "widget_theme" by mobile/src/lib/widget.ts) rather than use
// SwiftUI's system-appearance-following semantic colors like .primary/.secondary.
extension Color {
  init(hex: String) {
    var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if s.hasPrefix("#") { s.removeFirst() }
    var v: UInt64 = 0
    Scanner(string: s).scanHexInt64(&v)
    self.init(
      red: Double((v >> 16) & 0xFF) / 255,
      green: Double((v >> 8) & 0xFF) / 255,
      blue: Double(v & 0xFF) / 255)
  }
}

struct WarmHearth {
  let bg: Color
  let card: Color
  let text: Color
  let textMuted: Color
  let accent: Color
  let expense: Color
}

let lightTheme = WarmHearth(
  bg: Color(hex: "fbf6f0"), card: Color(hex: "ffffff"), text: Color(hex: "2b2521"),
  textMuted: Color(hex: "8c8076"), accent: Color(hex: "c2603f"), expense: Color(hex: "cf5a4c"))

let darkTheme = WarmHearth(
  bg: Color(hex: "1b1714"), card: Color(hex: "262019"), text: Color(hex: "f3ebe0"),
  textMuted: Color(hex: "a89c8e"), accent: Color(hex: "da7a5b"), expense: Color(hex: "e07a6a"))

/** The app's manually-chosen Light/Dark, mirrored into the App Group — NOT the
 *  device's system appearance. Defaults light (matches the app's own default). */
func appTheme() -> WarmHearth {
  groupDefaults()?.string(forKey: "widget_theme") == "dark" ? darkTheme : lightTheme
}

func money(_ v: Double, _ symbol: String) -> String {
  let n = NumberFormatter()
  n.numberStyle = .decimal
  n.maximumFractionDigits = 0
  let num = n.string(from: NSNumber(value: v.rounded())) ?? "\(Int(v.rounded()))"
  return symbol + num
}

// Deep link into the app's entry flow for a budget's current period. Mirrors the
// in-app route /budget/<id>/<monthId>?add=1 (or ?scan=1).
func addEntryURL(budgetId: String, monthId: String, scan: Bool) -> URL? {
  URL(string: "oneroof:///budget/\(budgetId)/\(monthId)?\(scan ? "scan" : "add")=1")
}

/// One line of the large tile's "Latest entries" list.
struct BudgetEntryRow: Codable {
  let emoji: String
  let label: String
  let amount: Double
  let type: String   // "income" | "expense"
}

// The app writes this JSON array into the App Group under "budgets"
// (see mobile/src/lib/widget.ts). The live fetch (?action=budget) returns the
// SAME shape, so both decode into this — the App Group copy just has no
// `entries`, hence the optional.
struct BudgetInfo: Codable, Identifiable {
  let id: String
  let monthId: String?   // current period → deep-link target for add/scan
  let name: String
  let period: String
  let balance: Double
  let income: Double
  let spent: Double
  let currency: String
  let entries: [BudgetEntryRow]?
}

private struct BudgetResponse: Codable {
  let budget: BudgetInfo?
}

/// Fresh stats + latest entries for one budget, straight from the server on the
/// widget's own timeline — so an entry added by ANOTHER member shows up without
/// anyone opening the app. Falls back to the App Group snapshot on any failure.
func fetchBudget(id: String?, day: String) async -> BudgetInfo? {
  let token = widgetToken()
  guard !token.isEmpty, let url = URL(string: WIDGET_ENDPOINT) else { return nil }
  var req = URLRequest(url: url)
  req.httpMethod = "POST"
  req.setValue("application/json", forHTTPHeaderField: "Content-Type")
  var body: [String: Any] = ["action": "budget", "token": token, "day": day]
  if let id { body["budgetId"] = id }
  req.httpBody = try? JSONSerialization.data(withJSONObject: body)
  guard
    let (data, resp) = try? await URLSession.shared.data(for: req),
    (resp as? HTTPURLResponse)?.statusCode == 200,
    let r = try? JSONDecoder().decode(BudgetResponse.self, from: data)
  else { return nil }
  return r.budget
}

func loadBudgets() -> [BudgetInfo] {
  guard
    let raw = groupDefaults()?.string(forKey: "budgets"),
    let data = raw.data(using: .utf8),
    let list = try? JSONDecoder().decode([BudgetInfo].self, from: data)
  else { return [] }
  return list
}

private let sampleBudget = BudgetInfo(
  id: "", monthId: "sample", name: "Our Home Budget", period: "monthly",
  balance: 1240, income: 3200, spent: 1960, currency: "$",
  entries: [
    BudgetEntryRow(emoji: "🛒", label: "Groceries — Publix", amount: 84, type: "expense"),
    BudgetEntryRow(emoji: "⛽", label: "Gas", amount: 45, type: "expense"),
    BudgetEntryRow(emoji: "💰", label: "Paycheck", amount: 2400, type: "income"),
    BudgetEntryRow(emoji: "🍽️", label: "Dinner out", amount: 62, type: "expense"),
    BudgetEntryRow(emoji: "💊", label: "Pharmacy", amount: 18, type: "expense"),
    BudgetEntryRow(emoji: "📺", label: "Netflix", amount: 16, type: "expense"),
  ])

// Two small deep-link action buttons (Scan / Add) — shared by the Budget widget
// (medium/large) and the Quick Add widget.
struct AddEntryButtons: View {
  let budgetId: String
  let monthId: String
  var addLabel: String = "Add"
  var body: some View {
    HStack(spacing: 8) {
      Link(destination: addEntryURL(budgetId: budgetId, monthId: monthId, scan: true) ?? URL(string: "oneroof:///")!) {
        Label("Scan", systemImage: "camera.fill")
          .font(.caption).fontWeight(.semibold)
          .frame(maxWidth: .infinity)
          .padding(.vertical, 8)
          .background(Color.secondary.opacity(0.16))
          .clipShape(RoundedRectangle(cornerRadius: 10))
      }
      Link(destination: addEntryURL(budgetId: budgetId, monthId: monthId, scan: false) ?? URL(string: "oneroof:///")!) {
        Label(addLabel, systemImage: "plus")
          .font(.caption).fontWeight(.semibold)
          .lineLimit(1)
          .frame(maxWidth: .infinity)
          .padding(.vertical, 8)
          .foregroundStyle(.white)
          .background(Color.accentColor)
          .clipShape(RoundedRectangle(cornerRadius: 10))
      }
    }
  }
}

// A "received ↓ / spent ↑" stat block (right-aligned by default; left on small).
struct BudgetStat: View {
  let label: String
  let value: String
  let symbol: String
  let color: Color
  var align: HorizontalAlignment = .trailing
  var body: some View {
    VStack(alignment: align, spacing: 1) {
      Text(label).font(.caption2).foregroundStyle(.secondary)
      HStack(spacing: 2) {
        Image(systemName: symbol).font(.system(size: 10, weight: .bold)).foregroundStyle(color)
        Text(value).font(.subheadline).minimumScaleFactor(0.7).lineLimit(1)
      }
    }
  }
}

// ── Budget selection (configurable widget) ──────────────────────────────────
struct BudgetEntity: AppEntity {
  let id: String
  let name: String

  static var typeDisplayRepresentation: TypeDisplayRepresentation { "Budget" }
  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
  static var defaultQuery = BudgetQuery()
}

struct BudgetQuery: EntityQuery {
  func entities(for identifiers: [String]) async throws -> [BudgetEntity] {
    loadBudgets().filter { identifiers.contains($0.id) }.map { BudgetEntity(id: $0.id, name: $0.name) }
  }
  func suggestedEntities() async throws -> [BudgetEntity] {
    loadBudgets().map { BudgetEntity(id: $0.id, name: $0.name) }
  }
  func defaultResult() async -> BudgetEntity? {
    loadBudgets().first.map { BudgetEntity(id: $0.id, name: $0.name) }
  }
}

struct SelectBudgetIntent: WidgetConfigurationIntent {
  static var title: LocalizedStringResource { "Select budget" }
  static var description: IntentDescription { "Choose which budget to show." }

  @Parameter(title: "Budget") var budget: BudgetEntity?
  init() {}
}

struct BudgetEntry: TimelineEntry {
  let date: Date
  let budget: BudgetInfo?
}

struct BudgetProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> BudgetEntry {
    BudgetEntry(date: Date(), budget: sampleBudget)
  }

  func snapshot(for configuration: SelectBudgetIntent, in context: Context) async -> BudgetEntry {
    let picked = resolve(configuration)
    return BudgetEntry(date: Date(), budget: context.isPreview && picked == nil ? sampleBudget : picked)
  }

  func timeline(for configuration: SelectBudgetIntent, in context: Context) async -> Timeline<BudgetEntry> {
    // App Group first (names/ids for the picker + an offline fallback), then
    // refresh it from the server so the balance and entries are actually live.
    let picked = resolve(configuration)
    let live = await fetchBudget(id: picked?.id, day: isoDay(Date()))
    let entry = BudgetEntry(date: Date(), budget: live ?? picked)
    return Timeline(entries: [entry], policy: .after(nextHourBoundary()))
  }

  private func resolve(_ configuration: SelectBudgetIntent) -> BudgetInfo? {
    let all = loadBudgets()
    if let sel = configuration.budget, let match = all.first(where: { $0.id == sel.id }) { return match }
    return all.first
  }
}

struct BudgetWidgetView: View {
  var entry: BudgetEntry
  @Environment(\.widgetFamily) var family

  var body: some View {
    if let b = entry.budget {
      VStack(alignment: .leading, spacing: 8) {
        HStack(spacing: 6) {
          Image(systemName: "creditcard").font(.caption)
          Text(b.name).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        Spacer(minLength: 0)
        if family == .systemSmall {
          // Narrow tile: received/spent up top, balance pinned to the bottom —
          // it's the biggest number, so it reads last and sits nearest the edge.
          HStack(spacing: 12) {
            BudgetStat(label: "received", value: money(b.income, b.currency), symbol: "arrow.down", color: .green, align: .leading)
            BudgetStat(label: "spent", value: money(b.spent, b.currency), symbol: "arrow.up", color: .red, align: .leading)
            Spacer(minLength: 0)
          }
          VStack(alignment: .leading, spacing: 1) {
            Text("balance").font(.caption2).foregroundStyle(.secondary)
            Text(money(b.balance, b.currency))
              .font(.system(size: 26, weight: .semibold))
              .foregroundStyle(b.balance >= 0 ? Color.green : Color.red)
              .minimumScaleFactor(0.6)
              .lineLimit(1)
          }
        } else {
          // Wide tile: balance on the left; received/spent stacked on the right.
          HStack(alignment: .bottom, spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
              Text("balance").font(.caption2).foregroundStyle(.secondary)
              Text(money(b.balance, b.currency))
                .font(.system(size: family == .systemLarge ? 40 : 34, weight: .semibold))
                .foregroundStyle(b.balance >= 0 ? Color.green : Color.red)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 6) {
              BudgetStat(label: "received", value: money(b.income, b.currency), symbol: "arrow.down", color: .green)
              BudgetStat(label: "spent", value: money(b.spent, b.currency), symbol: "arrow.up", color: .red)
            }
          }
          // Large has the room for the period's latest entries; Medium doesn't
          // (it's ~155pt tall and already carries the stats + both actions).
          if family == .systemLarge, let entries = b.entries, !entries.isEmpty {
            Divider().padding(.top, 6)
            Text("Latest entries")
              .font(.system(size: 9, weight: .bold))
              .kerning(0.7)
              .foregroundStyle(.secondary)
              .padding(.top, 4)
            VStack(spacing: 3) {
              ForEach(Array(entries.prefix(6).enumerated()), id: \.offset) { _, e in
                HStack(spacing: 7) {
                  Text(e.emoji).font(.system(size: 13))
                  Text(e.label).font(.system(size: 13)).lineLimit(1)
                  Spacer(minLength: 4)
                  Text((e.type == "income" ? "+" : "−") + money(e.amount, b.currency))
                    .font(.system(size: 13, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(e.type == "income" ? Color.green : Color.red)
                }
              }
            }
            .padding(.top, 2)
          }

          // On the tall Large size, push the buttons to the bottom.
          if family == .systemLarge { Spacer(minLength: 0) }
          if let mid = b.monthId {
            AddEntryButtons(budgetId: b.id, monthId: mid, addLabel: "Add Entry")
              .padding(.top, 6)
          }
        }
      }
      .padding(.vertical, 6)
      // Small trims its side padding (into the widget's own margin) so the
      // balance figure gets more room; the wider sizes keep the 6pt inset.
      .padding(.horizontal, family == .systemSmall ? -6 : 6)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    } else {
      VStack(spacing: 4) {
        Image(systemName: "creditcard").foregroundStyle(.secondary)
        Text("Open One Roof").font(.caption).foregroundStyle(.secondary)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }
}

struct BudgetWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: "BudgetWidget", intent: SelectBudgetIntent.self, provider: BudgetProvider()) { entry in
      BudgetWidgetView(entry: entry)
        .containerBackground(.fill.tertiary, for: .widget)
    }
    .configurationDisplayName("Budget")
    .description("Pick a budget to show its balance and quick-add entries.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

// ── Bundle ───────────────────────────────────────────────────────────────────
@main
struct OneRoofWidgets: WidgetBundle {
  var body: some Widget {
    BudgetWidget()
    NudgesWidget()
    TodayWidget()
    QuickAddWidget()
  }
}
