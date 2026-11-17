import WidgetKit
import SwiftUI
import AppIntents

// ── Lists (shopping) widget ──────────────────────────────────────────────────
// The household's OPEN shopping items, the fullest list first, tickable right
// on the Home Screen. Fetches for itself (api/widget.ts ?action=lists) and
// ticks through ?action=list-check — the same write as the app, so Realtime
// moves the item on every phone. A tick here is reversible in the app (the
// item goes to "bought"), so there is no undo window like Nudges has.
// Soft look (2026-11-15): a pale wash of the Lists yellow, ink text, the
// orange only on the circles and icons.

private let LISTS_KIND = "ListsWidget"

private func lT(_ key: String, _ n: Int = 0) -> String {
  let l = wLang()
  switch key {
  case "general": return l == "pt" ? "Lista" : l == "es" ? "Lista" : "List"
  case "items": return l == "pt" ? (n == 1 ? "1 item" : "\(n) itens") : l == "es" ? (n == 1 ? "1 artículo" : "\(n) artículos") : (n == 1 ? "1 item" : "\(n) items")
  case "more": return l == "pt" ? "mais \(n)" : l == "es" ? "\(n) más" : "\(n) more"
  case "doneTitle": return l == "pt" ? "Tudo comprado" : l == "es" ? "Todo comprado" : "All bought"
  case "doneHint": return l == "pt" ? "Nada na lista" : l == "es" ? "Nada en la lista" : "Nothing on the list"
  case "auto": return l == "pt" ? "A mais cheia" : l == "es" ? "La más llena" : "Fullest list"
  case "name": return l == "pt" ? "Listas" : l == "es" ? "Listas" : "Lists"
  case "desc": return l == "pt" ? "O que falta comprar, para riscar daqui. Segure para escolher a lista." : l == "es" ? "Lo que falta comprar, para tachar desde aquí. Mantén pulsado para elegir la lista." : "What's left to buy, tick it off from here. Hold to pick a list."
  default: return key
  }
}

struct ListItem: Codable, Identifiable { let id: String; let label: String }
struct ListGroup: Codable, Identifiable {
  let id: String
  let name: String?
  let count: Int
  let items: [ListItem]
}
struct ListRef: Codable { let id: String; let name: String }
/// `all` = every list of the household (the picker); absent from an older server.
struct ListsInfo: Codable {
  let total: Int
  let lists: [ListGroup]
  var all: [ListRef]? = nil
}

private func loadCachedLists() -> ListsInfo? {
  guard let raw = groupDefaults()?.string(forKey: "lists_widget"), let d = raw.data(using: .utf8) else { return nil }
  return try? JSONDecoder().decode(ListsInfo.self, from: d)
}
private func saveCachedLists(_ v: ListsInfo) {
  if let d = try? JSONEncoder().encode(v), let s = String(data: d, encoding: .utf8) { groupDefaults()?.set(s, forKey: "lists_widget") }
}

@discardableResult
private func fetchLists(check itemId: String? = nil) async -> ListsInfo? {
  let token = widgetToken()
  guard !token.isEmpty, let url = URL(string: WIDGET_ENDPOINT) else { return nil }
  var req = URLRequest(url: url)
  req.httpMethod = "POST"
  req.setValue("application/json", forHTTPHeaderField: "Content-Type")
  var body: [String: Any] = ["action": itemId == nil ? "lists" : "list-check", "token": token]
  if let itemId { body["itemId"] = itemId }
  req.httpBody = try? JSONSerialization.data(withJSONObject: body)
  guard
    let (data, resp) = try? await URLSession.shared.data(for: req),
    (resp as? HTTPURLResponse)?.statusCode == 200,
    let r = try? JSONDecoder().decode(ListsInfo.self, from: data)
  else { return nil }
  saveCachedLists(r)
  return r
}

/// Tick one item. The cached list drops it at once, so the widget redraws
/// without it even before (or without) the server's answer.
struct CheckListItemIntent: AppIntent {
  static var title: LocalizedStringResource = "Check item"
  static var isDiscoverable: Bool = false
  @Parameter(title: "Item") var itemId: String
  init() {}
  init(itemId: String) { self.itemId = itemId }
  func perform() async throws -> some IntentResult {
    if let cur = loadCachedLists() {
      let lists = cur.lists.compactMap { g -> ListGroup? in
        guard g.items.contains(where: { $0.id == itemId }) else { return g }
        let left = g.items.filter { $0.id != itemId }
        return g.count <= 1 ? nil : ListGroup(id: g.id, name: g.name, count: g.count - 1, items: left)
      }
      saveCachedLists(ListsInfo(total: max(0, cur.total - 1), lists: lists, all: cur.all))
    }
    await fetchLists(check: itemId)
    return .result()
  }
}

// ── Which list (configurable widget) ────────────────────────────────────────
// "auto" = the fullest list (what the widget always showed); "general" = items
// with no list; anything else is a list id.
private let LIST_AUTO = "auto"
private let LIST_GENERAL = "general"

struct ListEntity: AppEntity {
  let id: String
  let name: String

  static var typeDisplayRepresentation: TypeDisplayRepresentation { "List" }
  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
  static var defaultQuery = ListQuery()
}

/// Lists for the "Edit Widget" picker. Never the cache alone: it can be empty
/// exactly when iOS runs the picker (see PetCare's petsForPicker).
private func listsForPicker() async -> [ListEntity] {
  var info = loadCachedLists()
  if info?.all == nil { info = await fetchLists() ?? info }
  var out = [ListEntity(id: LIST_AUTO, name: lT("auto"))]
  if let all = info?.all {
    out += all.map { ListEntity(id: $0.id, name: $0.name) }
  } else {
    // Older server: only the lists that have something open.
    out += (info?.lists ?? []).filter { !$0.id.isEmpty }.map { ListEntity(id: $0.id, name: $0.name ?? lT("general")) }
  }
  out.append(ListEntity(id: LIST_GENERAL, name: lT("general")))
  return out
}

struct ListQuery: EntityQuery {
  func entities(for identifiers: [String]) async throws -> [ListEntity] {
    await listsForPicker().filter { identifiers.contains($0.id) }
  }
  func suggestedEntities() async throws -> [ListEntity] { await listsForPicker() }
  func defaultResult() async -> ListEntity? { ListEntity(id: LIST_AUTO, name: lT("auto")) }
}

struct SelectListIntent: WidgetConfigurationIntent {
  static var title: LocalizedStringResource { "Select list" }
  static var description: IntentDescription { "Choose which list to show." }

  @Parameter(title: "List") var list: ListEntity?
  init() {}
}

struct ListsEntry: TimelineEntry {
  let date: Date
  let info: ListsInfo?
  /// The list this widget was set to (nil = the fullest one).
  var pick: ListEntity? = nil
}

private let sampleLists = ListsInfo(total: 8, lists: [
  ListGroup(id: "s", name: "Market", count: 6, items: ["Milk", "Coffee", "Eggs", "Bread", "Rice", "Apples"].enumerated().map { ListItem(id: "s\($0.offset)", label: $0.element) }),
  ListGroup(id: "p", name: "Pharmacy", count: 2, items: []),
])

struct ListsProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> ListsEntry { ListsEntry(date: Date(), info: sampleLists) }
  func snapshot(for configuration: SelectListIntent, in context: Context) async -> ListsEntry {
    if context.isPreview { return placeholder(in: context) }
    return ListsEntry(date: Date(), info: loadCachedLists(), pick: picked(configuration))
  }
  func timeline(for configuration: SelectListIntent, in context: Context) async -> Timeline<ListsEntry> {
    let fresh = await fetchLists()
    let e = ListsEntry(date: Date(), info: fresh ?? loadCachedLists(), pick: picked(configuration))
    return Timeline(entries: [e], policy: .after(Date().addingTimeInterval(15 * 60)))
  }
  private func picked(_ configuration: SelectListIntent) -> ListEntity? {
    guard let l = configuration.list, l.id != LIST_AUTO else { return nil }
    return l
  }
}

struct ListsWidgetView: View {
  let entry: ListsEntry
  @Environment(\.widgetFamily) var family

  /// The group id the widget was set to ("" = items with no list), nil = fullest.
  private var pickId: String? { entry.pick.map { $0.id == LIST_GENERAL ? "" : $0.id } }
  private var first: ListGroup? {
    let lists = entry.info?.lists ?? []
    if let pickId { return lists.first { $0.id == pickId } }
    return lists.first
  }
  private var others: [ListGroup] {
    let shown = first?.id
    return (entry.info?.lists ?? []).filter { $0.id != shown }
  }
  /// A tap outside the tick circles opens THIS list in the app.
  private var openURL: URL {
    let id = pickId ?? first?.id ?? ""
    return URL(string: id.isEmpty ? "oneroof:///shopping" : "oneroof:///shopping?store=\(id)")!
  }

  var body: some View {
    Group {
      if let g = first {
        switch family {
        case .systemSmall: small(g)
        case .systemMedium: medium(g)
        default: large(g)
        }
      } else {
        done
      }
    }
    .widgetURL(openURL)
    .containerBackground(for: .widget) { WSoft(WG.shopping) }
  }

  private func title(_ g: ListGroup) -> String { g.name ?? lT("general") }

  private func row(_ it: ListItem, size: CGFloat = 13.5) -> some View {
    Button(intent: CheckListItemIntent(itemId: it.id)) {
      HStack(spacing: 8) {
        Circle().strokeBorder(wAccent(WG.shopping), lineWidth: 2).frame(width: 19, height: 19)
        Text(it.label).font(.system(size: size, weight: .semibold, design: .rounded)).foregroundStyle(wInk()).lineLimit(1)
        Spacer(minLength: 0)
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }

  private func head(_ g: ListGroup, big: Bool = false) -> some View {
    HStack(alignment: .firstTextBaseline) {
      Text(title(g)).font(.system(size: big ? 19 : 16, weight: .heavy, design: .rounded)).foregroundStyle(wInk()).lineLimit(1).minimumScaleFactor(0.7)
      Spacer(minLength: 4)
      Text(lT("items", g.count)).font(.system(size: 12, weight: .semibold, design: .rounded)).foregroundStyle(wInkSoft()).lineLimit(1)
    }
  }

  private func small(_ g: ListGroup) -> some View {
    VStack(alignment: .leading, spacing: 7) {
      head(g)
      ForEach(g.items.prefix(3)) { row($0) }
      Spacer(minLength: 0)
      if g.count > 3 {
        Text(lT("more", g.count - 3)).font(.system(size: 12, weight: .semibold, design: .rounded)).foregroundStyle(wInkSoft())
      }
    }
    .padding(14)
  }

  private func medium(_ g: ListGroup) -> some View {
    HStack(spacing: 0) {
      VStack(alignment: .leading, spacing: 2) {
        Image(systemName: "cart.fill").font(.system(size: 20, weight: .semibold)).foregroundStyle(wAccent(WG.shopping))
        Text(title(g)).font(.system(size: 18, weight: .heavy, design: .rounded)).foregroundStyle(wInk()).lineLimit(2).minimumScaleFactor(0.7).padding(.top, 4)
        Text(lT("items", g.count)).font(.system(size: 12, weight: .semibold, design: .rounded)).foregroundStyle(wInkSoft())
        Spacer(minLength: 0)
        if let o = others.first {
          Text("\(title(o)) · \(o.count)").font(.system(size: 12, weight: .semibold, design: .rounded)).foregroundStyle(wInkSoft()).lineLimit(1)
        }
      }
      .padding(14)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .background(Color(hex: WG.shopping[1]).opacity(wDark() ? 0.18 : 0.1))
      .frame(width: 118)

      LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible())], alignment: .leading, spacing: 9) {
        ForEach(g.items.prefix(6)) { row($0, size: 13) }
      }
      .padding(.horizontal, 14)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }

  private func large(_ g: ListGroup) -> some View {
    VStack(alignment: .leading, spacing: 9) {
      head(g, big: true)
      ForEach(g.items.prefix(others.isEmpty ? 9 : 6)) { row($0, size: 14.5) }
      if g.count > g.items.prefix(others.isEmpty ? 9 : 6).count {
        Text(lT("more", g.count - (others.isEmpty ? min(9, g.items.count) : min(6, g.items.count))))
          .font(.system(size: 12, weight: .semibold, design: .rounded)).foregroundStyle(wInkSoft())
      }
      Spacer(minLength: 0)
      if !others.isEmpty {
        Rectangle().fill(wInkSoft().opacity(0.25)).frame(height: 1)
        ForEach(others.prefix(3)) { o in
          HStack {
            Text(title(o)).font(.system(size: 13.5, weight: .bold, design: .rounded)).foregroundStyle(wInk()).lineLimit(1)
            Spacer()
            Text(lT("items", o.count)).font(.system(size: 12, weight: .semibold, design: .rounded)).foregroundStyle(wInkSoft())
          }
        }
      }
    }
    .padding(16)
  }

  private var done: some View {
    VStack(spacing: 6) {
      Image(systemName: "checkmark.circle.fill").font(.system(size: 34, weight: .semibold)).foregroundStyle(wAccent(WG.shopping))
      Text(lT("doneTitle")).font(.system(size: 16, weight: .heavy, design: .rounded)).foregroundStyle(wInk())
      Text(entry.pick?.name ?? lT("doneHint")).lineLimit(1).font(.system(size: 12, weight: .semibold, design: .rounded)).foregroundStyle(wInkSoft())
    }
    .padding(14)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

struct ListsWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: LISTS_KIND, intent: SelectListIntent.self, provider: ListsProvider()) { entry in
      ListsWidgetView(entry: entry)
    }
    .configurationDisplayName(lT("name"))
    .description(lT("desc"))
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    .contentMarginsDisabled()
  }
}
