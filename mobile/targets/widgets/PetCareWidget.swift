import WidgetKit
import SwiftUI
import AppIntents
import UIKit

// ── Pet Care widget ──────────────────────────────────────────────────────────
// Small: the selected pet (avatar, name, "2 of 4 today"), a progress bar and
//        the next two routine rows — tap an open row to mark it done.
// Medium: the pet + progress on a darker left panel; up to four rows on the right.
// Large: a mini Pet Care page — the selected pet's whole routine, what is
//        coming up, and the other pets with their next task.
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

/// Pets for the "Edit Widget" picker.
///
/// The App Group snapshot is written only by the app's Pet Care SCREEN and by
/// this widget's own timeline — so it can be missing or empty exactly when iOS
/// runs the picker (fresh install, or the screen never opened on this device).
/// That left the picker blank, and — worse — made `entities(for:)` fail to
/// resolve an ALREADY-SAVED choice, so iOS dropped the selection and the widget
/// silently fell back to the first pet: "changing the pet doesn't stick".
///
/// The widget has its own token and can fetch for itself, so never depend on
/// another screen having run. Cache the result so the picker pays this once.
func petsForPicker() async -> [PetCarePetW] {
  let cached = loadPetCare()?.pets ?? []
  if !cached.isEmpty { return cached }
  if let live = await fetchPetCare(day: isoDay(Date())) {
    savePetCare(live)
    return live.pets
  }
  return []
}

struct PetQuery: EntityQuery {
  func entities(for identifiers: [String]) async throws -> [PetEntity] {
    await petsForPicker().filter { identifiers.contains($0.id) }.map { PetEntity(id: $0.id, name: $0.name) }
  }
  func suggestedEntities() async throws -> [PetEntity] {
    await petsForPicker().map { PetEntity(id: $0.id, name: $0.name) }
  }
  func defaultResult() async -> PetEntity? {
    await petsForPicker().first.map { PetEntity(id: $0.id, name: $0.name) }
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
// The SOFT look (Kit.swift): a pale wash of the Pets orange with the theme's
// ink for text; the orange itself is kept for marks (ticks, progress, icons).
// The pet is a ROUND avatar — their photo (mirrored by the app into the shared
// container, "petcare_photo_<id>") or their emoji on a soft peach circle —
// then name + "2 of 4 today", a progress bar, and the routine as check rows.

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

/// The success green of the "done" beat and the all-done card. Deliberately
/// NOT the Pets orange: finishing is its own colour — a soft wash with a
/// deeper green for the tick and title. Fixed hexes, not the system `.green`.
private func petDoneWash() -> Color { Color(hex: "1F9E68").opacity(wDark() ? 0.3 : 0.16) }
private func petDoneInk() -> Color { Color(hex: wDark() ? "6FD3A4" : "17805A") }
/// Overdue: a soft red chip with a deeper red for its text / icon.
private func petOverdueWash() -> Color { Color(hex: "E4554A").opacity(wDark() ? 0.32 : 0.16) }
private func petOverdueInk() -> Color { Color(hex: wDark() ? "FF9A90" : "C0392B") }
/// The Pets wash a step stronger than the background (same as `.wTile`).
private func petTileWash() -> Color { Color(hex: WG.pets[1]).opacity(wDark() ? 0.3 : 0.14) }
/// A quieter panel wash (medium's left panel, large's other-pets card).
private func petPanelWash() -> Color { Color(hex: WG.pets[1]).opacity(wDark() ? 0.18 : 0.1) }

private func doneCount(_ pet: PetCarePetW) -> Int { pet.daily.filter { $0.done }.count }

private func petProgress(_ pet: PetCarePetW) -> Double {
  pet.daily.isEmpty ? 0 : Double(doneCount(pet)) / Double(pet.daily.count)
}

/// "2 of 4 today" — or the empty-routine wording when there is nothing to count.
private func countLabel(_ pet: PetCarePetW) -> String {
  pet.daily.isEmpty ? "No routine yet" : "\(doneCount(pet)) of \(pet.daily.count) today"
}

/// The rows a size has room for. Everything in routine order when it fits;
/// otherwise the open tasks first, so what is left to do is never hidden.
private func visibleTasks(_ pet: PetCarePetW, max: Int) -> [PetCareTaskW] {
  if pet.daily.count <= max { return pet.daily }
  return Array((pet.daily.filter { !$0.done } + pet.daily.filter { $0.done }).prefix(max))
}

/// The pet as a circle: their photo, or their emoji on the Pets wash.
struct PetAvatar: View {
  let pet: PetCarePetW
  let size: CGFloat

  var body: some View {
    ZStack {
      if let img = petPhotoImage(pet.id) {
        Image(uiImage: img)
          .resizable()
          .aspectRatio(contentMode: .fill)
          .frame(width: size, height: size)
          .clipShape(Circle())
      } else {
        Circle().fill(petTileWash())
        if pet.emoji.isEmpty {
          Text(String(pet.name.prefix(1)).uppercased())
            .font(.system(size: size * 0.46, weight: .heavy, design: .rounded))
            .foregroundStyle(wAccent(WG.pets))
        } else {
          Text(pet.emoji).font(.system(size: size * 0.56))
        }
      }
    }
    .frame(width: size, height: size)
    .overlay(Circle().strokeBorder(wAccent(WG.pets).opacity(0.35), lineWidth: 1.5))
  }
}

/// Name over "2 of 4 today".
private struct PetNameBlock: View {
  let pet: PetCarePetW
  var nameSize: CGFloat = 16

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      WBig(pet.name, size: nameSize, color: wInk())
      Text(countLabel(pet))
        .font(.system(size: 12, weight: .medium, design: .rounded))
        .foregroundStyle(wInkSoft())
        .lineLimit(1)
        .minimumScaleFactor(0.8)
    }
  }
}

/// One routine row. Open rows are the mark-done button; done rows are dimmed
/// and inert.
private struct PetTaskRow: View {
  let task: PetCareTaskW
  var showDoneBy: Bool = false
  var fontSize: CGFloat = 13
  var check: CGFloat = 20

  private var label: some View {
    HStack(spacing: 8) {
      WCheck(done: task.done, color: wAccent(WG.pets), tick: .white, size: check)
      Text(task.title)
        .font(.system(size: fontSize, weight: .semibold, design: .rounded))
        .foregroundStyle(task.done ? wInkSoft() : wInk())
        .lineLimit(1)
        .minimumScaleFactor(0.85)
      Spacer(minLength: 0)
      if showDoneBy, let by = task.doneBy {
        Text(by)
          .font(.system(size: 11, weight: .medium, design: .rounded))
          .foregroundStyle(wInkSoft())
          .lineLimit(1)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  var body: some View {
    if task.done {
      label
    } else {
      Button(intent: MarkTaskDoneIntent(taskId: task.id)) { label }
        .buttonStyle(.plain)
    }
  }
}

/// The 2.5s "task done" confirmation — a green beat before the next task.
struct DoneFlashTile: View {
  let status: PetCareStatus

  var body: some View {
    VStack(spacing: 6) {
      Image(systemName: "checkmark.circle.fill")
        .font(.system(size: 30, weight: .heavy))
        .foregroundStyle(petDoneInk())
      Text(status.title)
        .font(.system(size: 14, weight: .heavy, design: .rounded))
        .foregroundStyle(petDoneInk())
        .multilineTextAlignment(.center)
        .lineLimit(2)
        .minimumScaleFactor(0.8)
    }
    .padding(10)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(petDoneWash())
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
  }
}

/// "Nothing left to do" — the soft green success card, shared by small and medium:
/// a big tick, the pet's name, the all-done line, and a routine that is due.
struct AllDoneTile: View {
  let pet: PetCarePetW
  var named: Bool = true

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Image(systemName: "checkmark.circle.fill")
        .font(.system(size: 30, weight: .heavy))
        .foregroundStyle(petDoneInk())
      Spacer(minLength: 2)
      if named { WBig(pet.name, size: 17, color: wInk()) }
      Text(pet.daily.isEmpty ? "No routine yet" : "All done today")
        .font(.system(size: named ? 12 : 15, weight: named ? .semibold : .heavy, design: .rounded))
        .foregroundStyle(petDoneInk())
        .lineLimit(1)
        .minimumScaleFactor(0.8)
      if let urgent = pet.routines.first, urgent.dueIn <= 0 {
        Text("\(urgent.title) · \(dueLabel(urgent.dueIn))")
          .font(.system(size: 11, weight: .bold, design: .rounded))
          .foregroundStyle(wInkSoft())
          .lineLimit(1)
          .minimumScaleFactor(0.8)
      }
    }
    .padding(12)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .background(petDoneWash())
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
  }
}

/// A small chip: `solid` is the overdue one (soft red), otherwise a Pets tile.
private struct PetChip: View {
  let text: String
  var icon: String? = nil
  var solid: Bool = false

  var body: some View {
    HStack(spacing: 3) {
      if let icon { Image(systemName: icon).font(.system(size: 9, weight: .heavy)) }
      Text(text).font(.system(size: 10.5, weight: .bold, design: .rounded)).lineLimit(1)
    }
    .foregroundStyle(solid ? petOverdueInk() : wInk())
    .padding(.horizontal, 8)
    .padding(.vertical, 4)
    .background(Capsule().fill(solid ? petOverdueWash() : petTileWash()))
  }
}

/// Medium's stronger-wash left panel lives in the container background so it bleeds
/// to the widget's edges; the content column in the view is sized to match.
private let PET_MEDIUM_PANEL: CGFloat = 0.38

struct PetCareBackground: View {
  @Environment(\.widgetFamily) var family

  var body: some View {
    ZStack(alignment: .leading) {
      WSoft(WG.pets)
      if family == .systemMedium {
        GeometryReader { geo in
          petPanelWash().frame(width: geo.size.width * PET_MEDIUM_PANEL)
        }
      }
    }
  }
}

struct PetCareWidgetView: View {
  var entry: PetCareEntry
  @Environment(\.widgetFamily) var family
  @Environment(\.widgetContentMargins) var margins

  var body: some View {
    if let state = entry.state, !state.pets.isEmpty {
      let primary = state.pets.first { $0.id == entry.selectedId } ?? state.pets[0]
      switch family {
      case .systemSmall: small(primary)
      case .systemMedium: medium(primary)
      default: large(primary, others: state.pets.filter { $0.id != primary.id })
      }
    } else {
      // No snapshot yet (signed out, or the app has never mirrored any pets).
      VStack(spacing: 8) {
        Image(systemName: "pawprint.fill")
          .font(.system(size: 26, weight: .bold))
          .foregroundStyle(wAccent(WG.pets))
          .frame(width: 52, height: 52)
          .wTile(WG.pets, radius: 26)
        Text("Open One Roof")
          .font(.system(size: 13, weight: .heavy, design: .rounded))
          .foregroundStyle(wInk())
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }

  // Small: identity, progress, the next two rows.
  @ViewBuilder
  private func small(_ pet: PetCarePetW) -> some View {
    if entry.status == nil, nextUndone(pet) == nil {
      AllDoneTile(pet: pet)
    } else {
      VStack(alignment: .leading, spacing: 7) {
        HStack(spacing: 8) {
          PetAvatar(pet: pet, size: 32)
          PetNameBlock(pet: pet, nameSize: 15)
          Spacer(minLength: 0)
          if overdueCount(pet) > 0 {
            Image(systemName: "exclamationmark.circle.fill")
              .font(.system(size: 14, weight: .bold))
              .foregroundStyle(petOverdueInk())
          }
        }
        if let status = entry.status {
          DoneFlashTile(status: status)
        } else {
          WProgress(petProgress(pet), fill: wAccent(WG.pets), track: wAccent(WG.pets).opacity(0.2))
          Spacer(minLength: 0)
          ForEach(visibleTasks(pet, max: 2)) { task in
            PetTaskRow(task: task)
          }
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
  }

  // Medium: the pet on the stronger-wash left panel, up to four rows on the right.
  private func medium(_ pet: PetCarePetW) -> some View {
    GeometryReader { geo in
      let full = geo.size.width + margins.leading + margins.trailing
      let gap: CGFloat = 14
      let leftW = max(60, full * PET_MEDIUM_PANEL - margins.leading - gap)
      HStack(alignment: .top, spacing: gap * 2) {
        VStack(alignment: .leading, spacing: 6) {
          HStack(alignment: .top, spacing: 0) {
            PetAvatar(pet: pet, size: 40)
            Spacer(minLength: 0)
            if overdueCount(pet) > 0 {
              Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(petOverdueInk())
            }
          }
          PetNameBlock(pet: pet, nameSize: 16)
          Spacer(minLength: 0)
          WProgress(petProgress(pet), fill: wAccent(WG.pets), track: wAccent(WG.pets).opacity(0.2))
        }
        .frame(width: leftW, alignment: .leading)

        if let status = entry.status {
          DoneFlashTile(status: status)
        } else if nextUndone(pet) == nil {
          AllDoneTile(pet: pet)
        } else {
          VStack(alignment: .leading, spacing: 0) {
            ForEach(visibleTasks(pet, max: 4)) { task in
              PetTaskRow(task: task, fontSize: 14)
              Spacer(minLength: 0)
            }
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
      }
    }
  }

  // Large: identity + progress across the top, the whole routine, what is
  // coming up, then the household's other pets with their next task.
  private func large(_ pet: PetCarePetW, others: [PetCarePetW]) -> some View {
    let shownOthers = Array(others.prefix(2))
    let maxRows = shownOthers.isEmpty ? 6 : (shownOthers.count == 1 ? 5 : 4)
    let rows = visibleTasks(pet, max: maxRows)
    let maxRoutines = shownOthers.isEmpty ? (rows.count <= 4 ? 3 : 2) : 1
    // Other pets on show: only what is overdue earns a line (as before).
    let routines = Array((shownOthers.isEmpty ? pet.routines : pet.routines.filter { $0.dueIn < 0 }).prefix(maxRoutines))

    return VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 10) {
        PetAvatar(pet: pet, size: 42)
        PetNameBlock(pet: pet, nameSize: 17)
        Spacer(minLength: 0)
        if overdueCount(pet) > 0 {
          PetChip(text: "\(overdueCount(pet)) overdue", icon: "exclamationmark", solid: true)
        } else if nextUndone(pet) == nil && !pet.daily.isEmpty {
          PetChip(text: "All done", icon: "checkmark")
        }
      }
      WProgress(petProgress(pet), fill: wAccent(WG.pets), track: wAccent(WG.pets).opacity(0.2))

      VStack(alignment: .leading, spacing: 7) {
        ForEach(rows) { task in
          PetTaskRow(task: task, showDoneBy: true, fontSize: 14)
        }
      }

      if !routines.isEmpty {
        VStack(alignment: .leading, spacing: 5) {
          WKicker("Coming up", color: wAccent(WG.pets))
          ForEach(routines) { r in
            HStack(spacing: 6) {
              Text(r.title)
                .font(.system(size: 12.5, weight: .semibold, design: .rounded))
                .foregroundStyle(r.dueIn <= 0 ? wInk() : wInkSoft())
                .lineLimit(1)
              Spacer(minLength: 4)
              if r.dueIn < 0 {
                PetChip(text: dueLabel(r.dueIn), solid: true)
              } else {
                Text(dueLabel(r.dueIn))
                  .font(.system(size: 11.5, weight: r.dueIn == 0 ? .heavy : .medium, design: .rounded))
                  .foregroundStyle(r.dueIn == 0 ? wInk() : wInkSoft())
              }
            }
          }
        }
      }

      Spacer(minLength: 0)

      if !shownOthers.isEmpty {
        VStack(spacing: 6) {
          ForEach(shownOthers) { p in
            HStack(spacing: 8) {
              PetAvatar(pet: p, size: 26)
              VStack(alignment: .leading, spacing: 0) {
                WBig(p.name, size: 13, color: wInk())
                Text(overdueCount(p) > 0 ? "\(countLabel(p)) · \(overdueCount(p)) overdue" : countLabel(p))
                  .font(.system(size: 10.5, weight: .medium, design: .rounded))
                  .foregroundStyle(wInkSoft())
                  .lineLimit(1)
              }
              Spacer(minLength: 4)
              if let next = nextUndone(p) {
                Button(intent: MarkTaskDoneIntent(taskId: next.id)) {
                  HStack(spacing: 5) {
                    WCheck(done: false, color: wAccent(WG.pets), tick: .white, size: 15)
                    Text(next.title)
                      .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                      .foregroundStyle(wInk())
                      .lineLimit(1)
                  }
                  .padding(.horizontal, 8)
                  .padding(.vertical, 5)
                  .wTile(WG.pets, radius: 12)
                }
                .buttonStyle(.plain)
                .frame(maxWidth: 150, alignment: .trailing)
              } else if !p.daily.isEmpty {
                PetChip(text: "All done", icon: "checkmark")
              }
            }
          }
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(petPanelWash()))
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

struct PetCareWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: "PetCareWidget", intent: SelectPetIntent.self, provider: PetCareProvider()) { entry in
      PetCareWidgetView(entry: entry)
        .containerBackground(for: .widget) { PetCareBackground() }
    }
    .configurationDisplayName("Pet Care")
    .description("Mark the next care task done — feeding, walks, meds.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}
