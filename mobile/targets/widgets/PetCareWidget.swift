import WidgetKit
import SwiftUI
import AppIntents
import UIKit

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

// ── Done flash (same mechanism as the Nudges "Sent!" confirmation) ──────────
// The intent writes a short-lived status; the timeline shows it now and a
// reverted entry at `until` — iOS flips between them at that wall-clock time.
struct PetCareStatus: Codable {
  let title: String
  /** The pet whose task was marked — only the widget instance showing this pet
   *  plays the flash (two per-dog widgets: the other must stay put). */
  let petId: String
  let until: Date
}

func loadPetCareStatus() -> PetCareStatus? {
  guard
    let raw = groupDefaults()?.string(forKey: "petcare_status"),
    let data = raw.data(using: .utf8),
    let status = try? JSONDecoder().decode(PetCareStatus.self, from: data),
    status.until > Date()
  else { return nil }
  return status
}

func writePetCareStatus(_ status: PetCareStatus) {
  if let data = try? JSONEncoder().encode(status), let s = String(data: data, encoding: .utf8) {
    groupDefaults()?.set(s, forKey: "petcare_status")
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
    var doneTitle = "Done"
    var donePetId = ""
    if var state = loadPetCare() {
      for p in state.pets.indices {
        for t in state.pets[p].daily.indices where state.pets[p].daily[t].id == taskId {
          doneTitle = state.pets[p].daily[t].title
          donePetId = state.pets[p].id
          state.pets[p].daily[t].done = true
        }
      }
      savePetCare(PetCareState(day: today, pets: state.pets))
    }
    // Flash the confirmation for a beat before settling on the next task.
    writePetCareStatus(PetCareStatus(title: doneTitle, petId: donePetId, until: Date().addingTimeInterval(2.5)))
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
  var status: PetCareStatus? = nil
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
    // Mid-flash: render instantly from the just-updated local snapshot (a live
    // fetch here would hold the confirmation behind a network round-trip); the
    // .atEnd revert triggers a fresh timeline — and the fetch — right after.
    if let status = loadPetCareStatus() {
      let state = normalized(loadPetCare(), today: today)
      // Same primary resolution as the view: the configured pet, else the first.
      let primaryId = state?.pets.first { $0.id == configuration.pet?.id }?.id ?? state?.pets.first?.id
      if status.petId == primaryId {
        let now = PetCareEntry(date: Date(), state: state, selectedId: configuration.pet?.id, status: status)
        let reverted = PetCareEntry(date: status.until, state: state, selectedId: configuration.pet?.id)
        return Timeline(entries: [now, reverted], policy: .atEnd)
      }
    }
    let live = await fetchPetCare(day: today)
    if let live { savePetCare(live) }
    let state = live ?? normalized(loadPetCare(), today: today)
    let entry = PetCareEntry(date: Date(), state: state, selectedId: configuration.pet?.id)
    return Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(30 * 60)))
  }
}


// ── Views ────────────────────────────────────────────────────────────────────
// Design language: the pet's PHOTO (mirrored by the app as a small base64
// thumbnail, "petcare_photo_<id>") or an initial-letter tile — never stock
// symbols — and rounded-square surfaces with room to breathe.

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

func petPhotoImage(_ id: String) -> UIImage? {
  // The app downloads each photo into the shared container as a real file —
  // the reliable way to hand a widget an image.
  if let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: APP_GROUP) {
    let file = dir.appendingPathComponent("petcare_photo_\(id).jpg")
    if let img = UIImage(contentsOfFile: file.path) { return img }
  }
  // Legacy fallback: a base64 string in the app-group defaults.
  guard
    let b64 = groupDefaults()?.string(forKey: "petcare_photo_\(id)"),
    let data = Data(base64Encoded: b64)
  else { return nil }
  return UIImage(data: data)
}

/// The pet as a rounded square: their photo, or their initial on a soft tint.
struct PetPhotoTile: View {
  let pet: PetCarePetW
  let corner: CGFloat
  let theme: WarmHearth

  var body: some View {
    GeometryReader { geo in
      if let img = petPhotoImage(pet.id) {
        Image(uiImage: img)
          .resizable()
          .aspectRatio(contentMode: .fill)
          .frame(width: geo.size.width, height: geo.size.height)
          .clipShape(RoundedRectangle(cornerRadius: corner))
      } else {
        RoundedRectangle(cornerRadius: corner)
          .fill(theme.accent.opacity(0.15))
          .overlay(
            Text(String(pet.name.prefix(1)).uppercased())
              .font(.system(size: geo.size.height * 0.4, weight: .semibold, design: .rounded))
              .foregroundStyle(theme.accent)
          )
      }
    }
  }
}

/// Fixed-size variant for list headers.
struct PetPhotoBadge: View {
  let pet: PetCarePetW
  let size: CGFloat
  let theme: WarmHearth

  var body: some View {
    PetPhotoTile(pet: pet, corner: size * 0.32, theme: theme)
      .frame(width: size, height: size)
  }
}

/// The 2.5s "task done" confirmation — a green beat before the next task.
struct DoneFlashTile: View {
  let status: PetCareStatus

  var body: some View {
    VStack(spacing: 8) {
      Image(systemName: "checkmark.circle.fill")
        .font(.system(size: 32, weight: .semibold))
        .foregroundStyle(.white)
      Text(status.title)
        .font(.system(size: 14, weight: .semibold, design: .rounded))
        .foregroundStyle(.white)
        .multilineTextAlignment(.center)
        .lineLimit(2)
        .minimumScaleFactor(0.8)
    }
    .padding(12)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.green)
    .clipShape(RoundedRectangle(cornerRadius: 16))
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
        // Identity caption + the action, which IS the widget.
        VStack(alignment: .leading, spacing: 8) {
          HStack(spacing: 6) {
            PetPhotoBadge(pet: primary, size: 20, theme: theme)
            Text(primary.name).font(.caption).fontWeight(.semibold).foregroundStyle(theme.textMuted).lineLimit(1)
            Spacer(minLength: 0)
            if overdueCount(primary) > 0 { Circle().fill(theme.expense).frame(width: 7, height: 7) }
          }
          if let status = entry.status {
            DoneFlashTile(status: status)
          } else if let task = nextUndone(primary) {
            Button(intent: MarkTaskDoneIntent(taskId: task.id)) {
              VStack(alignment: .leading, spacing: 4) {
                Text("Next up").font(.system(size: 10, weight: .medium)).foregroundStyle(.white.opacity(0.7))
                Text(task.title)
                  .font(.system(size: 17, weight: .semibold, design: .rounded))
                  .foregroundStyle(.white)
                  .lineLimit(2)
                  .minimumScaleFactor(0.8)
                Spacer(minLength: 0)
                HStack(spacing: 5) {
                  Image(systemName: "checkmark.circle").font(.system(size: 13, weight: .semibold))
                  Text("Tap when done").font(.system(size: 10, weight: .medium))
                }
                .foregroundStyle(.white.opacity(0.85))
              }
              .padding(12)
              .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
              .background(theme.accent)
              .clipShape(RoundedRectangle(cornerRadius: 16))
            }
            .buttonStyle(.plain)
          } else {
            AllDoneTile(pet: primary, theme: theme)
          }
        }
      case .systemMedium:
        // One pet only: the photo on the left, the next task as a matching
        // rounded square on the right (the whole tile marks it done).
        HStack(spacing: 12) {
          PetPhotoTile(pet: primary, corner: 18, theme: theme)
            .aspectRatio(1, contentMode: .fit)
          if let status = entry.status {
            DoneFlashTile(status: status)
          } else if let task = nextUndone(primary) {
            Button(intent: MarkTaskDoneIntent(taskId: task.id)) {
              VStack(alignment: .leading, spacing: 5) {
                Text(primary.name.uppercased())
                  .font(.system(size: 10, weight: .semibold))
                  .kerning(0.8)
                  .foregroundStyle(theme.textMuted)
                Text(task.title)
                  .font(.system(size: 19, weight: .semibold, design: .rounded))
                  .foregroundStyle(theme.text)
                  .lineLimit(2)
                  .minimumScaleFactor(0.8)
                Spacer(minLength: 0)
                HStack(spacing: 6) {
                  Image(systemName: "checkmark.circle").font(.system(size: 14, weight: .semibold))
                  Text("Tap when done").font(.system(size: 11, weight: .medium))
                }
                .foregroundStyle(theme.accent)
              }
              .padding(14)
              .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
              .background(theme.card)
              .clipShape(RoundedRectangle(cornerRadius: 18))
            }
            .buttonStyle(.plain)
          } else {
            AllDoneTile(pet: primary, theme: theme, named: true)
          }
        }
      default:
        // Large: every pet gets an airy block — photo, name, status, and the
        // day's tasks as clean text rows. Only overdue routines earn a line.
        VStack(alignment: .leading, spacing: 14) {
          ForEach(state.pets.prefix(3)) { p in
            VStack(alignment: .leading, spacing: 8) {
              HStack(spacing: 10) {
                PetPhotoBadge(pet: p, size: 34, theme: theme)
                Text(p.name)
                  .font(.system(size: 16, weight: .semibold, design: .rounded))
                  .foregroundStyle(theme.text)
                Spacer(minLength: 0)
                if overdueCount(p) > 0 {
                  Text("\(overdueCount(p)) overdue")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(theme.expense)
                } else if nextUndone(p) == nil && !p.daily.isEmpty {
                  Text("All done")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.green)
                }
              }
              ForEach(p.daily.prefix(4)) { task in
                HStack(spacing: 9) {
                  if task.done {
                    Image(systemName: "checkmark.circle.fill").font(.system(size: 16)).foregroundStyle(.green)
                  } else {
                    Button(intent: MarkTaskDoneIntent(taskId: task.id)) {
                      Image(systemName: "circle").font(.system(size: 16)).foregroundStyle(theme.accent)
                    }
                    .buttonStyle(.plain)
                  }
                  Text(task.title)
                    .font(.system(size: 13))
                    .strikethrough(task.done)
                    .foregroundStyle(task.done ? theme.textMuted : theme.text)
                    .lineLimit(1)
                  Spacer(minLength: 4)
                  if let by = task.doneBy {
                    Text(by).font(.system(size: 11)).foregroundStyle(theme.textMuted)
                  }
                }
              }
              ForEach(p.routines.filter { $0.dueIn < 0 }.prefix(1)) { r in
                Text("\(r.title) · \(dueLabel(r.dueIn))")
                  .font(.system(size: 11, weight: .medium))
                  .foregroundStyle(theme.expense)
              }
            }
            if p.id != state.pets.prefix(3).last?.id {
              Divider()
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

/// Quiet "nothing left to do" card, shared by small and medium.
struct AllDoneTile: View {
  let pet: PetCarePetW
  let theme: WarmHearth
  var named: Bool = false

  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      if named {
        Text(pet.name.uppercased())
          .font(.system(size: 10, weight: .semibold))
          .kerning(0.8)
          .foregroundStyle(theme.textMuted)
      }
      Spacer(minLength: 0)
      Image(systemName: "checkmark.circle.fill").font(.system(size: 22)).foregroundStyle(.green)
      Text(pet.daily.isEmpty ? "No routine yet" : "All done today")
        .font(.system(size: 14, weight: .semibold, design: .rounded))
        .foregroundStyle(theme.text)
      if let urgent = pet.routines.first, urgent.dueIn <= 0 {
        Text("\(urgent.title) · \(dueLabel(urgent.dueIn))")
          .font(.system(size: 11))
          .foregroundStyle(theme.expense)
          .lineLimit(1)
      }
      Spacer(minLength: 0)
    }
    .padding(14)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .background(theme.card)
    .clipShape(RoundedRectangle(cornerRadius: 18))
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
