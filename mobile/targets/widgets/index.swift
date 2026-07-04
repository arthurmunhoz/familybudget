import WidgetKit
import SwiftUI
import AppIntents

// ── Shared ───────────────────────────────────────────────────────────────────
let APP_GROUP = "group.com.oneroof.app"

func groupDefaults() -> UserDefaults? { UserDefaults(suiteName: APP_GROUP) }

func money(_ v: Double, _ symbol: String) -> String {
  let n = NumberFormatter()
  n.numberStyle = .decimal
  n.maximumFractionDigits = 0
  let num = n.string(from: NSNumber(value: v.rounded())) ?? "\(Int(v.rounded()))"
  return symbol + num
}

// The app writes this JSON array into the App Group under "budgets"
// (see mobile/src/lib/widget.ts).
struct BudgetInfo: Codable, Identifiable {
  let id: String
  let name: String
  let period: String
  let balance: Double
  let income: Double
  let spent: Double
  let currency: String
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
  id: "", name: "Our Home Budget", period: "monthly",
  balance: 1240, income: 3200, spent: 1960, currency: "$")

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
    let entry = BudgetEntry(date: Date(), budget: resolve(configuration))
    let next = Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date().addingTimeInterval(3600)
    return Timeline(entries: [entry], policy: .after(next))
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
      VStack(alignment: .leading, spacing: 6) {
        HStack(spacing: 6) {
          Image(systemName: "creditcard").font(.caption)
          Text(b.name).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        Spacer(minLength: 0)
        Text("balance").font(.caption2).foregroundStyle(.secondary)
        Text(money(b.balance, b.currency))
          .font(.system(size: family == .systemSmall ? 28 : 34, weight: .semibold))
          .foregroundStyle(b.balance >= 0 ? Color.green : Color.red)
          .minimumScaleFactor(0.6)
          .lineLimit(1)
        if family != .systemSmall {
          HStack(spacing: 18) {
            VStack(alignment: .leading, spacing: 1) {
              Text("received").font(.caption2).foregroundStyle(.secondary)
              Text(money(b.income, b.currency)).font(.subheadline)
            }
            VStack(alignment: .leading, spacing: 1) {
              Text("spent").font(.caption2).foregroundStyle(.secondary)
              Text(money(b.spent, b.currency)).font(.subheadline)
            }
          }
          .padding(.top, 2)
        }
      }
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
    .description("Pick a budget to show its balance.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

// ── Bundle ───────────────────────────────────────────────────────────────────
@main
struct OneRoofWidgets: WidgetBundle {
  var body: some Widget {
    BudgetWidget()
  }
}
