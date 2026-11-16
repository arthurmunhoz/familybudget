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
  let income: Color
  /// Foreground on an accent-filled control — mirrors the app's `onAccent`
  /// token. White fails on the lighter dark-mode accent (3.0:1), so that one
  /// takes dark ink instead.
  let onAccent: Color
}

let lightTheme = WarmHearth(
  bg: Color(hex: "F2F2F3"), card: Color(hex: "FFFFFF"), text: Color(hex: "1E1E22"),
  textMuted: Color(hex: "6E6E75"), accent: Color(hex: "c2603f"), expense: Color(hex: "cf5a4c"),
  income: Color(hex: "3c7d58"), onAccent: Color(hex: "ffffff"))

let darkTheme = WarmHearth(
  bg: Color(hex: "17171A"), card: Color(hex: "222226"), text: Color(hex: "F2F2F4"),
  textMuted: Color(hex: "A2A2AA"), accent: Color(hex: "da7a5b"), expense: Color(hex: "e07a6a"),
  income: Color(hex: "6fb58a"), onAccent: Color(hex: "1b1a18"))

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

// Two deep-link capsules (Scan / Add) for the Budget widget (medium/large):
// Scan a soft green tile with ink, Add solid accent green with white ink.
struct AddEntryButtons: View {
  let budgetId: String
  let monthId: String
  var addLabel: String = "Add"
  var body: some View {
    HStack(spacing: 6) {
      Link(destination: addEntryURL(budgetId: budgetId, monthId: monthId, scan: true) ?? URL(string: "oneroof:///")!) {
        capsuleLabel("Scan", "camera.fill")
          .foregroundStyle(wInk())
          .wTile(WG.budget, radius: 18)
      }
      Link(destination: addEntryURL(budgetId: budgetId, monthId: monthId, scan: false) ?? URL(string: "oneroof:///")!) {
        capsuleLabel(addLabel, "plus")
          .foregroundStyle(Color.white)
          .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(wAccent(WG.budget)))
      }
    }
  }

  private func capsuleLabel(_ title: String, _ symbol: String) -> some View {
    HStack(spacing: 4) {
      Image(systemName: symbol).font(.system(size: 11, weight: .bold))
      Text(title)
        .font(.system(size: 12, weight: .bold, design: .rounded))
        .lineLimit(1)
        .minimumScaleFactor(0.8)
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 7)
    .padding(.horizontal, 6)
  }
}

// One stat row on the soft panel: label left, amount right (Received / Spent).
// The amount is coloured by meaning, as in the app (income green, expense red).
struct BudgetStat: View {
  let label: String
  let value: String
  var color: Color = wInk()
  var body: some View {
    HStack(spacing: 6) {
      Text(label)
        .font(.system(size: 13, weight: .medium, design: .rounded))
        .foregroundStyle(wInkSoft())
        .lineLimit(1)
      Spacer(minLength: 4)
      Text(value)
        .font(.system(size: 13, weight: .bold, design: .rounded))
        .monospacedDigit()
        .foregroundStyle(color)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
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
    Group {
      if let b = entry.budget {
        switch family {
        case .systemSmall: summary(b)
        case .systemMedium: header(b, buttons: true)
        default: large(b)
        }
      } else {
        VStack(spacing: 6) {
          Image(systemName: "wallet.pass").font(.system(size: 22, weight: .semibold))
          Text("Open One Roof").font(.system(size: 12, weight: .semibold, design: .rounded))
        }
        .foregroundStyle(wInkSoft())
      }
    }
    // Nothing here may fall back to SwiftUI's .primary (it follows the DEVICE
    // appearance): the default on the soft wash is the theme's ink.
    .foregroundStyle(wInk())
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  /// Spent ÷ income, 0 when nothing came in yet.
  private func spentRatio(_ b: BudgetInfo) -> Double {
    b.income > 0 ? max(0, b.spent / b.income) : 0
  }

  /// "NAME · PERIOD" when the pair is short enough for one kicker line.
  private func kicker(_ b: BudgetInfo) -> String {
    let both = b.name + " · " + b.period
    return b.period.isEmpty || both.count > 22 ? b.name : both
  }

  /// The small tile, and the left half of the wider ones: name, the balance
  /// very large, what the number is, then how much of the income is spent.
  private func summary(_ b: BudgetInfo) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      WKicker(kicker(b), color: wAccent(WG.budget))
      WBig(money(b.balance, b.currency), size: family == .systemSmall ? 32 : 34,
           color: b.balance < 0 ? appTheme().expense : wInk())
        .padding(.top, 4)
      Text("balance")
        .font(.system(size: 12, weight: .medium, design: .rounded))
        .foregroundStyle(wInkSoft())
        .lineLimit(1)
      Spacer(minLength: 6)
      WProgress(spentRatio(b), fill: wAccent(WG.budget), track: wAccent(WG.budget).opacity(0.2))
      Text("spent \(Int((spentRatio(b) * 100).rounded()))%")
        .font(.system(size: 12, weight: .semibold, design: .rounded))
        .foregroundStyle(wInkSoft())
        .lineLimit(1)
        .padding(.top, 5)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  /// Medium, and the top of large: the summary on the left half, the darker
  /// Received / Spent panel on the right (carrying Scan / Add on medium).
  private func header(_ b: BudgetInfo, buttons: Bool) -> some View {
    HStack(alignment: .top, spacing: 12) {
      summary(b)
      VStack(spacing: 8) {
        BudgetStat(label: "Received", value: money(b.income, b.currency), color: appTheme().income)
        BudgetStat(label: "Spent", value: money(b.spent, b.currency), color: appTheme().expense)
        if buttons {
          Spacer(minLength: 0)
          if let mid = b.monthId {
            AddEntryButtons(budgetId: b.id, monthId: mid)
          }
        }
      }
      .padding(10)
      .frame(maxWidth: .infinity, maxHeight: buttons ? .infinity : nil, alignment: .top)
      .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color(hex: WG.budget[1]).opacity(wDark() ? 0.18 : 0.1)))
    }
  }

  private func large(_ b: BudgetInfo) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      header(b, buttons: false)
        .frame(height: 104)
      if let entries = b.entries, !entries.isEmpty {
        WKicker("Latest entries", color: wAccent(WG.budget))
          .padding(.top, 14)
        VStack(spacing: 7) {
          ForEach(Array(entries.prefix(6).enumerated()), id: \.offset) { _, e in
            let isIncome = e.type == "income"
            HStack(spacing: 8) {
              Text(e.emoji).font(.system(size: 14))
              Text(e.label)
                .font(.system(size: 14, weight: .medium, design: .rounded))
                .foregroundStyle(wInk())
                .lineLimit(1)
              Spacer(minLength: 6)
              Text((isIncome ? "+" : "") + money(e.amount, b.currency))
                .font(.system(size: 14, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(isIncome ? appTheme().income : wInk())
                .lineLimit(1)
            }
          }
        }
        .padding(.top, 8)
      }
      Spacer(minLength: 8)
      if let mid = b.monthId {
        AddEntryButtons(budgetId: b.id, monthId: mid, addLabel: "Add Entry")
      }
    }
  }
}

struct BudgetWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: "BudgetWidget", intent: SelectBudgetIntent.self, provider: BudgetProvider()) { entry in
      BudgetWidgetView(entry: entry)
        // A pale wash of the Budget app's green over the app's card colour
        // (follows the APP's light/dark choice, not the device's).
        .containerBackground(for: .widget) { WSoft(WG.budget) }
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
    PetCareWidget()
    NoteWidget()
    ListsWidget()
  }
}
