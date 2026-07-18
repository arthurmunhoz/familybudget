import WidgetKit
import SwiftUI
import AppIntents

// ── Pet Care widget ──────────────────────────────────────────────────────────
// Small: the selected pet + one BIG button that marks the next undone daily
//        task done (the action is the point — the pet identity is a caption).
// Medium: the small content on the left; the OTHER pets on the right, each with
//        its own next task + done button (mark all the breakfasts from one place).
// Large: a mini Pet Care page — every pet's checklist + most urgent routines.
//
// Data: the app mirrors a snapshot into the App Group ("petcare"); the widget
// re-fetches live state from api/widget?action=petcare on its own timeline, so
// another member's check-off shows up without this phone opening the app. When
// someone marks a task done anywhere, the server silent-pushes every other
// member's device and backgroundNotifications.ts reloads this widget — that's
// the "my wife's widget updates ASAP" path. Marks from THIS widget are
// optimistic: the intent rewrites the snapshot locally, reloads, and delivers
// the POST over a background URLSession (same mechanism as NudgesWidget).

struct PetCareTaskW: Codable, Identifiable {
  let id: String
  let title: String
  let icon: String
  var done: Bool
  var doneBy: String?
}

struct PetCareRoutineW: Codable, Identifiable {
  let id: String
  let title: String
  let icon: String
  let dueIn: Int
}

struct PetCarePetW: Codable, Identifiable {
  let id: String
  let name: String
  let emoji: String
  var daily: [PetCareTaskW]
  let routines: [PetCareRoutineW]
}

struct PetCareState: Codable {
  let day: String
  var pets: [PetCarePetW]
}

/// Routine-task icon ids → SF Symbols. KEEP IN SYNC with CARE_ICONS in
/// mobile/src/apps/pets/petUi.tsx (same ids → Lucide in the app).
func careSymbol(_ icon: String) -> String {
  switch icon {
  case "bowl": return "fork.knife"
  case "walk": return "figure.walk"
  case "treat": return "gift"
  case "pill": return "pills"
  case "bath": return "shower"
  case "nails": return "scissors"
  case "teeth": return "sparkles"
  default: return "pawprint"
  }
}

// isoDay(_:) is shared from TodayWidget.swift (same target).

func loadPetCare() -> PetCareState? {
  guard
    let raw = groupDefaults()?.string(forKey: "petcare"),
    let data = raw.data(using: .utf8),
    let state = try? JSONDecoder().decode(PetCareState.self, from: data)
  else { return nil }
  return state
}

func savePetCare(_ state: PetCareState) {
  if let data = try? JSONEncoder().encode(state), let s = String(data: data, encoding: .utf8) {
    groupDefaults()?.set(s, forKey: "petcare")
  }
}

/// Fresh per-pet state straight from the server on the widget's own timeline.
func fetchPetCare(day: String) async -> PetCareState? {
  let token = widgetToken()
  guard !token.isEmpty, let url = URL(string: WIDGET_ENDPOINT) else { return nil }
  var req = URLRequest(url: url)
  req.httpMethod = "POST"
  req.setValue("application/json", forHTTPHeaderField: "Content-Type")
  req.httpBody = try? JSONSerialization.data(withJSONObject: [
    "action": "petcare", "token": token, "day": day,
  ])
  guard
    let (data, resp) = try? await URLSession.shared.data(for: req),
    (resp as? HTTPURLResponse)?.statusCode == 200,
    let state = try? JSONDecoder().decode(PetCareState.self, from: data)
  else { return nil }
  return state
}

// Background delivery for mark-done (same file-staged upload as NudgeSender —
// a plain in-memory task would be dropped when the extension suspends).
final class PetCareSender: NSObject, URLSessionTaskDelegate {
  static let shared = PetCareSender()

  private lazy var session: URLSession = {
    let cfg = URLSessionConfiguration.background(withIdentifier: "com.oneroof.widget.petcare")
    cfg.sharedContainerIdentifier = APP_GROUP
    cfg.sessionSendsLaunchEvents = false
    cfg.isDiscretionary = false
    return URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
  }()

  func send(body: [String: Any]) {
    guard
      let url = URL(string: WIDGET_ENDPOINT),
      let data = try? JSONSerialization.data(withJSONObject: body),
      let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: APP_GROUP)
    else { return }
    let sweepBefore = Date().addingTimeInterval(-60)
    if let existing = try? FileManager.default.contentsOfDirectory(
      at: dir, includingPropertiesForKeys: [.contentModificationDateKey]) {
      for f in existing where f.lastPathComponent.hasPrefix("petcare-") {
        let mod = (try? f.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
        if let mod, mod < sweepBefore { try? FileManager.default.removeItem(at: f) }
      }
    }
    let file = dir.appendingPathComponent("petcare-\(UUID().uuidString).json")
    do { try data.write(to: file) } catch { return }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    let task = session.uploadTask(with: req, fromFile: file)
    task.taskDescription = file.path
    task.resume()
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if let path = task.taskDescription { try? FileManager.default.removeItem(atPath: path) }
  }
}

// Mark one task done. Optimistic: rewrite the snapshot so the widget re-renders
// to the NEXT undone task instantly (iOS re-renders only after perform()
// returns), then let the background session deliver the POST — the server then
// silent-pushes the rest of the household.
struct MarkTaskDoneIntent: AppIntent {
  static var title: LocalizedStringResource { "Mark done" }

  @Parameter(title: "Task") var taskId: String
  init() {}
  init(taskId: String) { self.taskId = taskId }

  func perform() async throws -> some IntentResult {
    let today = isoDay(Date())
    if var state = loadPetCare() {
      for p in state.pets.indices {
        for t in state.pets[p].daily.indices where state.pets[p].daily[t].id == taskId {
          state.pets[p].daily[t].done = true
        }
      }
      savePetCare(PetCareState(day: today, pets: state.pets))
    }
    WidgetCenter.shared.reloadTimelines(ofKind: "PetCareWidget")

    let token = widgetToken()
    if !token.isEmpty {
      PetCareSender.shared.send(body: [
        "action": "petcare-done", "token": token, "taskId": taskId, "day": today,
      ])
    }
    return .result()
  }
}

// ── Pet selection (configurable widget) ──────────────────────────────────────
struct PetEntity: AppEntity {
  let id: String
  let name: String

  static var typeDisplayRepresentation: TypeDisplayRepresentation { "Pet" }
  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
  static var defaultQuery = PetQuery()
}

struct PetQuery: EntityQuery {
  func entities(for identifiers: [String]) async throws -> [PetEntity] {
    (loadPetCare()?.pets ?? []).filter { identifiers.contains($0.id) }.map { PetEntity(id: $0.id, name: $0.name) }
  }
  func suggestedEntities() async throws -> [PetEntity] {
    (loadPetCare()?.pets ?? []).map { PetEntity(id: $0.id, name: $0.name) }
  }
  func defaultResult() async -> PetEntity? {
    (loadPetCare()?.pets ?? []).first.map { PetEntity(id: $0.id, name: $0.name) }
  }
}

struct SelectPetIntent: WidgetConfigurationIntent {
  static var title: LocalizedStringResource { "Select pet" }
  static var description: IntentDescription { "Choose which pet to show." }

  @Parameter(title: "Pet") var pet: PetEntity?
  init() {}
}

// ── Timeline ─────────────────────────────────────────────────────────────────
struct PetCareEntry: TimelineEntry {
  let date: Date
  let state: PetCareState?
  let selectedId: String?
}

private let samplePetCare = PetCareState(
  day: "2026-01-01",
  pets: [
    PetCarePetW(
      id: "sample", name: "Lola", emoji: "🐶",
      daily: [
        PetCareTaskW(id: "1", title: "Morning walk", icon: "walk", done: true, doneBy: "Sam"),
        PetCareTaskW(id: "2", title: "Breakfast", icon: "bowl", done: true, doneBy: "Sam"),
        PetCareTaskW(id: "3", title: "Dinner", icon: "bowl", done: false, doneBy: nil),
        PetCareTaskW(id: "4", title: "Evening walk", icon: "walk", done: false, doneBy: nil),
      ],
      routines: [
        PetCareRoutineW(id: "5", title: "Flea treatment", icon: "pill", dueIn: -2),
        PetCareRoutineW(id: "6", title: "Bath", icon: "bath", dueIn: 5),
      ])
  ])

/// Snapshot fallback: a checklist from an earlier day must not pass off its
/// checkmarks as today's — reset them (same stale-day rule as the Today widget).
func normalized(_ state: PetCareState?, today: String) -> PetCareState? {
  guard var s = state else { return nil }
  if s.day != today {
    for p in s.pets.indices {
      for t in s.pets[p].daily.indices {
        s.pets[p].daily[t].done = false
        s.pets[p].daily[t].doneBy = nil
      }
    }
  }
  return s
}

struct PetCareProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> PetCareEntry {
    PetCareEntry(date: Date(), state: samplePetCare, selectedId: nil)
  }

  func snapshot(for configuration: SelectPetIntent, in context: Context) async -> PetCareEntry {
    let today = isoDay(Date())
    let state = normalized(loadPetCare(), today: today)
    return PetCareEntry(
      date: Date(),
      state: context.isPreview && state == nil ? samplePetCare : state,
      selectedId: configuration.pet?.id)
  }

  func timeline(for configuration: SelectPetIntent, in context: Context) async -> Timeline<PetCareEntry> {
    let today = isoDay(Date())
    let live = await fetchPetCare(day: today)
    if let live { savePetCare(live) }
    let state = live ?? normalized(loadPetCare(), today: today)
    let entry = PetCareEntry(date: Date(), state: state, selectedId: configuration.pet?.id)
    return Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(30 * 60)))
  }
}

// ── Views ────────────────────────────────────────────────────────────────────
func nextUndone(_ pet: PetCarePetW) -> PetCareTaskW? {
  pet.daily.first { !$0.done }
}

func overdueCount(_ pet: PetCarePetW) -> Int {
  pet.routines.filter { $0.dueIn < 0 }.count
}

func dueLabel(_ dueIn: Int) -> String {
  if dueIn < 0 { return "\(-dueIn)d overdue" }
  if dueIn == 0 { return "due today" }
  return "in \(dueIn)d"
}

/// The identity caption + big action button — the whole small widget, and the
/// left half of medium.
struct PetActionPane: View {
  let pet: PetCarePetW
  let theme: WarmHearth

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 4) {
        Text(pet.emoji).font(.system(size: 13))
        Text(pet.name).font(.caption).fontWeight(.semibold).foregroundStyle(theme.textMuted).lineLimit(1)
        Spacer(minLength: 0)
        if overdueCount(pet) > 0 {
          Circle().fill(theme.expense).frame(width: 7, height: 7)
        }
      }
      if let task = nextUndone(pet) {
        // The action IS the widget: one tap marks this task done and the pane
        // advances to the next undone task.
        Button(intent: MarkTaskDoneIntent(taskId: task.id)) {
          VStack(spacing: 6) {
            Image(systemName: careSymbol(task.icon)).font(.system(size: 24, weight: .semibold))
            Text(task.title)
              .font(.system(size: 13, weight: .semibold))
              .multilineTextAlignment(.center)
              .lineLimit(2)
              .minimumScaleFactor(0.8)
            Text("Tap when done").font(.system(size: 9)).opacity(0.75)
          }
          .foregroundStyle(.white)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .background(theme.accent)
          .clipShape(RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
      } else {
        VStack(spacing: 6) {
          Image(systemName: "checkmark.circle.fill").font(.system(size: 26)).foregroundStyle(.green)
          Text(pet.daily.isEmpty ? "No routine yet" : "All done today")
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(theme.textMuted)
          if let urgent = pet.routines.first, urgent.dueIn <= 0 {
            Text("\(urgent.title) · \(dueLabel(urgent.dueIn))")
              .font(.system(size: 10))
              .foregroundStyle(theme.expense)
              .lineLimit(1)
          }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
      }
    }
  }
}

struct PetCareWidgetView: View {
  var entry: PetCareEntry
  @Environment(\.widgetFamily) var family

  var body: some View {
    let theme = appTheme()
    if let state = entry.state, !state.pets.isEmpty {
      let primary = state.pets.first { $0.id == entry.selectedId } ?? state.pets[0]
      switch family {
      case .systemSmall:
        PetActionPane(pet: primary, theme: theme)
      case .systemMedium:
        HStack(spacing: 10) {
          PetActionPane(pet: primary, theme: theme)
            .frame(maxWidth: .infinity)
          Divider()
          // The other pets: mark each one's next task from the same widget.
          VStack(alignment: .leading, spacing: 8) {
            let others = state.pets.filter { $0.id != primary.id }
            if others.isEmpty {
              // Single-pet household: the right half shows the routines instead.
              ForEach(primary.routines.prefix(3)) { r in
                HStack(spacing: 6) {
                  Image(systemName: careSymbol(r.icon)).font(.system(size: 11)).foregroundStyle(theme.textMuted)
                  Text(r.title).font(.system(size: 12)).foregroundStyle(theme.text).lineLimit(1)
                  Spacer(minLength: 2)
                  Text(dueLabel(r.dueIn))
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(r.dueIn <= 0 ? theme.expense : theme.textMuted)
                }
              }
            } else {
              ForEach(others.prefix(3)) { p in
                HStack(spacing: 6) {
                  Text(p.emoji).font(.system(size: 13))
                  VStack(alignment: .leading, spacing: 0) {
                    Text(p.name).font(.system(size: 11, weight: .semibold)).foregroundStyle(theme.text).lineLimit(1)
                    Text(nextUndone(p)?.title ?? "All done")
                      .font(.system(size: 10))
                      .foregroundStyle(theme.textMuted)
                      .lineLimit(1)
                  }
                  Spacer(minLength: 2)
                  if let task = nextUndone(p) {
                    Button(intent: MarkTaskDoneIntent(taskId: task.id)) {
                      Image(systemName: "circle")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(theme.accent)
                    }
                    .buttonStyle(.plain)
                  } else {
                    Image(systemName: "checkmark.circle.fill")
                      .font(.system(size: 18))
                      .foregroundStyle(.green)
                  }
                }
              }
            }
            Spacer(minLength: 0)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
      default:
        // Large: a mini Pet Care page — every pet's checklist + urgent routines.
        VStack(alignment: .leading, spacing: 8) {
          HStack(spacing: 5) {
            Image(systemName: "pawprint").font(.caption)
            Text("Pet Care").font(.caption).foregroundStyle(theme.textMuted)
          }
          ForEach(state.pets.prefix(3)) { p in
            VStack(alignment: .leading, spacing: 4) {
              HStack(spacing: 5) {
                Text(p.emoji).font(.system(size: 13))
                Text(p.name).font(.system(size: 13, weight: .bold)).foregroundStyle(theme.text)
                Spacer(minLength: 0)
                if overdueCount(p) > 0 {
                  Text("\(overdueCount(p)) overdue")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(theme.expense)
                } else if nextUndone(p) == nil && !p.daily.isEmpty {
                  Text("all done")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.green)
                }
              }
              ForEach(p.daily.prefix(4)) { task in
                HStack(spacing: 7) {
                  if task.done {
                    Image(systemName: "checkmark.circle.fill").font(.system(size: 15)).foregroundStyle(.green)
                  } else {
                    Button(intent: MarkTaskDoneIntent(taskId: task.id)) {
                      Image(systemName: "circle").font(.system(size: 15)).foregroundStyle(theme.accent)
                    }
                    .buttonStyle(.plain)
                  }
                  Text(task.title)
                    .font(.system(size: 12))
                    .strikethrough(task.done)
                    .foregroundStyle(task.done ? theme.textMuted : theme.text)
                    .lineLimit(1)
                  Spacer(minLength: 2)
                  if let by = task.doneBy { Text(by).font(.system(size: 9)).foregroundStyle(theme.textMuted) }
                }
              }
              ForEach(p.routines.filter { $0.dueIn <= 3 }.prefix(2)) { r in
                HStack(spacing: 7) {
                  Image(systemName: careSymbol(r.icon)).font(.system(size: 11)).foregroundStyle(theme.textMuted)
                  Text(r.title).font(.system(size: 11)).foregroundStyle(theme.textMuted).lineLimit(1)
                  Spacer(minLength: 2)
                  Text(dueLabel(r.dueIn))
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(r.dueIn <= 0 ? theme.expense : theme.textMuted)
                }
              }
            }
          }
          Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      }
    } else {
      VStack(spacing: 4) {
        Image(systemName: "pawprint").foregroundStyle(.secondary)
        Text("Open One Roof").font(.caption).foregroundStyle(.secondary)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }
}

struct PetCareWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: "PetCareWidget", intent: SelectPetIntent.self, provider: PetCareProvider()) { entry in
      PetCareWidgetView(entry: entry)
        .containerBackground(appTheme().bg, for: .widget)
    }
    .configurationDisplayName("Pet Care")
    .description("Mark the next care task done — feeding, walks, meds.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}
