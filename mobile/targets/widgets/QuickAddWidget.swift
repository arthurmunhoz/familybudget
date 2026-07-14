import WidgetKit
import SwiftUI

// Quick-add a money entry from the Home Screen: two buttons — Scan a receipt or
// Add manually — that deep-link into the app's entry flow for the default
// (first) budget's current period. Reads the same App Group "budgets" data the
// Budget widget uses. AddEntryButtons / BudgetInfo / loadBudgets() live in
// index.swift (same target). Widget chrome is English, matching the existing
// Budget/Nudges widgets (widgets aren't wired to the app's i18n).

struct QuickAddEntry: TimelineEntry {
  let date: Date
  let budget: BudgetInfo?
}

struct QuickAddProvider: TimelineProvider {
  func placeholder(in context: Context) -> QuickAddEntry {
    QuickAddEntry(date: Date(), budget: loadBudgets().first)
  }
  func getSnapshot(in context: Context, completion: @escaping (QuickAddEntry) -> Void) {
    completion(QuickAddEntry(date: Date(), budget: loadBudgets().first))
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<QuickAddEntry>) -> Void) {
    completion(Timeline(entries: [QuickAddEntry(date: Date(), budget: loadBudgets().first)], policy: .never))
  }
}

struct QuickAddWidgetView: View {
  var entry: QuickAddEntry
  var body: some View {
    if let b = entry.budget, let mid = b.monthId {
      VStack(alignment: .leading, spacing: 6) {
        HStack(spacing: 5) {
          Image(systemName: "creditcard").font(.caption2)
          Text(b.name).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
        }
        Spacer(minLength: 0)
        Text("balance").font(.caption2).foregroundStyle(.secondary)
        Text(money(b.balance, b.currency))
          .font(.system(size: 24, weight: .semibold))
          .foregroundStyle(b.balance >= 0 ? Color.green : Color.red)
          .minimumScaleFactor(0.6)
          .lineLimit(1)
        AddEntryButtons(budgetId: b.id, monthId: mid)
          .padding(.top, 4)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    } else {
      VStack(spacing: 4) {
        Image(systemName: "plus.circle").foregroundStyle(.secondary)
        Text("Open One Roof").font(.caption).foregroundStyle(.secondary)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }
}

struct QuickAddWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "QuickAddWidget", provider: QuickAddProvider()) { entry in
      QuickAddWidgetView(entry: entry)
        .containerBackground(.fill.tertiary, for: .widget)
    }
    .configurationDisplayName("Quick add")
    .description("Scan a receipt or add an expense from your Home Screen.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
