import WidgetKit
import SwiftUI

// The main app writes this JSON array into the shared App Group under "budgets"
// (see mobile/src/lib/widget.ts). The widget renders the first one for now;
// budget selection (a configurable widget) is the next step.
struct BudgetInfo: Codable {
  let id: String
  let name: String
  let period: String
  let balance: Double
  let income: Double
  let spent: Double
  let currency: String
}

let APP_GROUP = "group.com.oneroof.app"

func loadBudgets() -> [BudgetInfo] {
  guard
    let defaults = UserDefaults(suiteName: APP_GROUP),
    let raw = defaults.string(forKey: "budgets"),
    let data = raw.data(using: .utf8),
    let list = try? JSONDecoder().decode([BudgetInfo].self, from: data)
  else { return [] }
  return list
}

func money(_ v: Double, _ symbol: String) -> String {
  let rounded = (v).rounded()
  let n = NumberFormatter()
  n.numberStyle = .decimal
  n.maximumFractionDigits = 0
  let num = n.string(from: NSNumber(value: rounded)) ?? "\(Int(rounded))"
  return symbol + num
}

struct BudgetEntry: TimelineEntry {
  let date: Date
  let budget: BudgetInfo?
}

struct BudgetProvider: TimelineProvider {
  private let sample = BudgetInfo(
    id: "", name: "Our Home Budget", period: "monthly",
    balance: 1240, income: 3200, spent: 1960, currency: "$")

  func placeholder(in context: Context) -> BudgetEntry {
    BudgetEntry(date: Date(), budget: sample)
  }

  func getSnapshot(in context: Context, completion: @escaping (BudgetEntry) -> Void) {
    let b = context.isPreview ? sample : loadBudgets().first
    completion(BudgetEntry(date: Date(), budget: b))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<BudgetEntry>) -> Void) {
    let entry = BudgetEntry(date: Date(), budget: loadBudgets().first)
    let next = Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date().addingTimeInterval(3600)
    completion(Timeline(entries: [entry], policy: .after(next)))
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
    StaticConfiguration(kind: "BudgetWidget", provider: BudgetProvider()) { entry in
      if #available(iOS 17.0, *) {
        BudgetWidgetView(entry: entry)
          .containerBackground(.fill.tertiary, for: .widget)
      } else {
        BudgetWidgetView(entry: entry).padding()
      }
    }
    .configurationDisplayName("Budget")
    .description("Your household budget at a glance.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

@main
struct OneRoofWidgets: WidgetBundle {
  var body: some Widget {
    BudgetWidget()
  }
}
