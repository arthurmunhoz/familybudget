import WidgetKit
import SwiftUI
import AppIntents

// Interactive Home-Screen widget: send a household nudge without opening the app.
// The app (mobile/src/app/pings.tsx via lib/widget.ts) writes into the App Group:
//   "widget_token"   — the per-device send token (migration 045)
//   "nudge_members"  — JSON [{email,name}] the person selector can target
//   "nudge_presets"  — JSON [{id,kind,emoji,label,highPriority}] the sendable presets
//   "widget_theme"   — "light" | "dark", the app's own Settings choice (index.swift's appTheme())
// The widget owns "widget_recipients" (JSON [email]) — the current selection,
// empty = everyone — and "widget_status" (see WidgetStatus below), which either
// side can write to flash a transient "sent!"/"seen by" confirmation.
// Tapping a preset POSTs to /api/widget-nudge.
// APP_GROUP / groupDefaults() / WarmHearth theme are declared in index.swift (same target).

let NUDGE_ENDPOINT = "https://one-roof-app.vercel.app/api/widget-nudge"

// How long "Sent · Undo" stays on screen — and, deliberately, how long the POST
// is HELD before it leaves the device. iOS fires a widget's button intent on a
// press-and-hold that's too short to raise the system context menu, so an
// accidental tap here would otherwise push a nudge to the whole family with no
// way back. A push can't be recalled once sent, so undo must PREVENT the send
// rather than delete the row after it: the upload task is scheduled with an
// `earliestBeginDate` this far out, and UndoNudgeIntent cancels it before it
// ever starts. Cost of the safety net: nudges land ~5s later than they used to.
let UNDO_SECONDS: TimeInterval = 5

// The upload is actually held a little LONGER than the button is shown. WidgetKit
// reverts to the preset list on a timeline entry dated `UNDO_SECONDS` out, and
// that refresh isn't punctual to the millisecond — without this grace, a tap on a
// briefly-stale Undo button would silently no-op (the task having already fired)
// while still looking like it cancelled. Undo is never a lie this way.
let UNDO_HOLD: TimeInterval = UNDO_SECONDS + 2.5

struct NudgeMember: Codable, Identifiable {
  let email: String
  let name: String
  var id: String { email }
}

struct NudgePreset: Codable, Identifiable {
  let id: String
  let kind: String
  let emoji: String
  let label: String
  let highPriority: Bool
}

// A transient confirmation shown in place of the list for a few seconds:
// "sent" right after a tap (written by SendNudgeIntent, below), or "ack"
// when someone acknowledges a nudge this device sent (written by the RN app's
// background push handler — see mobile/src/lib/widget.ts's writeAckStatus).
// `until` round-trips as epoch milliseconds (JS `Date.now()`-compatible) rather
// than Swift's default date encoding, since both sides write this key.
struct WidgetStatus: Codable {
  // "pending" = sent-but-still-cancellable (shows the Undo button; the POST is
  // held on-device until `until`), "sent" = confirmed/on its way, "ack" = someone
  // acknowledged a nudge this device sent.
  let type: String  // "pending" | "sent" | "ack"
  let emoji: String
  let label: String
  let name: String?
  let until: Date

  enum CodingKeys: String, CodingKey { case type, emoji, label, name, until }

  init(type: String, emoji: String, label: String, name: String?, until: Date) {
    self.type = type
    self.emoji = emoji
    self.label = label
    self.name = name
    self.until = until
  }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    type = try c.decode(String.self, forKey: .type)
    emoji = try c.decode(String.self, forKey: .emoji)
    label = try c.decode(String.self, forKey: .label)
    name = try c.decodeIfPresent(String.self, forKey: .name)
    until = Date(timeIntervalSince1970: (try c.decode(Double.self, forKey: .until)) / 1000)
  }

  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(type, forKey: .type)
    try c.encode(emoji, forKey: .emoji)
    try c.encode(label, forKey: .label)
    try c.encodeIfPresent(name, forKey: .name)
    try c.encode(until.timeIntervalSince1970 * 1000, forKey: .until)
  }
}

func loadMembers() -> [NudgeMember] {
  guard
    let raw = groupDefaults()?.string(forKey: "nudge_members"),
    let data = raw.data(using: .utf8),
    let list = try? JSONDecoder().decode([NudgeMember].self, from: data)
  else { return [] }
  return list
}

func loadPresets() -> [NudgePreset] {
  guard
    let raw = groupDefaults()?.string(forKey: "nudge_presets"),
    let data = raw.data(using: .utf8),
    let list = try? JSONDecoder().decode([NudgePreset].self, from: data)
  else { return [] }
  return list
}

func loadRecipients() -> [String] {
  guard
    let raw = groupDefaults()?.string(forKey: "widget_recipients"),
    let data = raw.data(using: .utf8),
    let list = try? JSONDecoder().decode([String].self, from: data)
  else { return [] }
  return list
}

func saveRecipients(_ r: [String]) {
  if let data = try? JSONEncoder().encode(r), let s = String(data: data, encoding: .utf8) {
    groupDefaults()?.set(s, forKey: "widget_recipients")
  }
}

func widgetToken() -> String {
  groupDefaults()?.string(forKey: "widget_token") ?? ""
}

func firstName(_ name: String) -> String {
  String(name.split(separator: " ").first ?? Substring(name))
}

// Only returns a status that hasn't expired yet — callers don't need to
// separately check `until`.
func loadStatus() -> WidgetStatus? {
  guard
    let raw = groupDefaults()?.string(forKey: "widget_status"),
    let data = raw.data(using: .utf8),
    let status = try? JSONDecoder().decode(WidgetStatus.self, from: data),
    status.until > Date()
  else { return nil }
  return status
}

func writeStatus(_ status: WidgetStatus) {
  if let data = try? JSONEncoder().encode(status), let s = String(data: data, encoding: .utf8) {
    groupDefaults()?.set(s, forKey: "widget_status")
  }
}

// ── Intents ──────────────────────────────────────────────────────────────────

// Toggle a recipient in the person selector. email "" = clear (send to everyone).
struct ToggleRecipientIntent: AppIntent {
  static var title: LocalizedStringResource { "Choose recipient" }

  @Parameter(title: "Email") var email: String
  init() {}
  init(email: String) { self.email = email }

  func perform() async throws -> some IntentResult {
    if email.isEmpty {
      saveRecipients([])
    } else {
      var cur = loadRecipients()
      if let i = cur.firstIndex(of: email) { cur.remove(at: i) } else { cur.append(email) }
      saveRecipients(cur)
    }
    return .result()
  }
}

// Fire-and-forget POST to the nudge endpoint over a BACKGROUND URLSession. This
// is what lets the "Sent!" confirmation feel instant: SendNudgeIntent.perform()
// returns the moment it writes the status (iOS only re-renders a widget AFTER the
// intent returns), and the system's background daemon still delivers the POST
// even once the extension is suspended. A plain URLSession.shared task fired
// without awaiting would be suspended along with the extension and might never
// reach the server.
final class NudgeSender: NSObject, URLSessionTaskDelegate {
  static let shared = NudgeSender()

  private lazy var session: URLSession = {
    let cfg = URLSessionConfiguration.background(withIdentifier: "com.oneroof.widget.nudge")
    // Required inside an app extension: lets the background daemon read the body
    // file and finish the upload outside the extension's own lifetime.
    cfg.sharedContainerIdentifier = APP_GROUP
    cfg.sessionSendsLaunchEvents = false
    cfg.isDiscretionary = false
    return URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
  }()

  /// Stages the POST and schedules it to leave the device after `delay`.
  /// Returns the staged file's path, which doubles as the task's identity for
  /// `cancel(path:)` — nil if it couldn't be staged.
  @discardableResult
  func send(body: [String: Any], delay: TimeInterval = 0) -> String? {
    guard
      let url = URL(string: NUDGE_ENDPOINT),
      let data = try? JSONSerialization.data(withJSONObject: body),
      let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: APP_GROUP)
    else { return nil }
    // Background uploads must be file-based (in-memory bodies are dropped when the
    // extension is suspended). Stage the JSON in the shared container, and first
    // sweep any stragglers from earlier sends the daemon already finished (the
    // completion delegate below only runs while the extension is still alive).
    let sweepBefore = Date().addingTimeInterval(-60)
    if let existing = try? FileManager.default.contentsOfDirectory(
      at: dir, includingPropertiesForKeys: [.contentModificationDateKey]) {
      for f in existing where f.lastPathComponent.hasPrefix("nudge-") {
        let mod = (try? f.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
        if let mod, mod < sweepBefore { try? FileManager.default.removeItem(at: f) }
      }
    }
    let file = dir.appendingPathComponent("nudge-\(UUID().uuidString).json")
    do { try data.write(to: file) } catch { return nil }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    let task = session.uploadTask(with: req, fromFile: file)
    task.taskDescription = file.path  // so the delegate can delete it
    // The daemon won't start the upload before this date, which is the whole
    // undo window: until then the nudge exists only as a staged file on disk.
    if delay > 0 { task.earliestBeginDate = Date().addingTimeInterval(delay) }
    task.resume()
    return file.path
  }

  /// Cancel a still-held upload staged by `send`. Reconstructing the background
  /// session by identifier reconnects to the same daemon-side session, so the
  /// task is findable even if the extension was torn down and relaunched between
  /// the send and the undo tap.
  func cancel(path: String) async {
    for task in await session.allTasks where task.taskDescription == path {
      task.cancel()
    }
    try? FileManager.default.removeItem(atPath: path)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if let path = task.taskDescription { try? FileManager.default.removeItem(atPath: path) }
  }
}

// Send a nudge to the currently selected recipients (or everyone). High-priority
// presets always go to everyone — enforced here and again server-side.
struct SendNudgeIntent: AppIntent {
  static var title: LocalizedStringResource { "Send nudge" }

  @Parameter(title: "Kind") var kind: String
  @Parameter(title: "Emoji") var emoji: String
  @Parameter(title: "Message") var message: String
  @Parameter(title: "High priority") var highPriority: Bool
  init() {}
  init(kind: String, emoji: String, message: String, highPriority: Bool) {
    self.kind = kind
    self.emoji = emoji
    self.message = message
    self.highPriority = highPriority
  }

  func perform() async throws -> some IntentResult {
    // Flash the "Sent!" confirmation the instant the button is tapped. iOS only
    // re-renders the widget AFTER perform() returns, so the send must NOT be
    // awaited here — awaiting a network round-trip (a cold Vercel function can
    // take a few seconds) would keep the old preset list on screen until it
    // finished, which is the "nothing happens for a while, then Sent!" lag.
    // Instead: write the status, return immediately, and let NudgeSender's
    // background URLSession deliver the POST even after the extension suspends.
    writeStatus(
      WidgetStatus(
        type: "pending", emoji: emoji, label: message, name: nil,
        until: Date().addingTimeInterval(UNDO_SECONDS)))

    let token = widgetToken()
    if !token.isEmpty {
      let recipients = highPriority ? [] : loadRecipients()
      // Held for UNDO_SECONDS — see the constant. Remember the staged file so
      // UndoNudgeIntent can find and cancel this exact upload.
      let path = NudgeSender.shared.send(
        body: [
          "token": token, "kind": kind, "emoji": emoji, "message": message,
          "recipients": recipients, "high_priority": highPriority,
        ], delay: UNDO_HOLD)
      if let path { groupDefaults()?.set(path, forKey: "pending_nudge") }
    }
    WidgetCenter.shared.reloadTimelines(ofKind: "NudgesWidget")
    return .result()
  }
}

// Cancel a nudge that's still inside its undo window. Because the upload hasn't
// left the device yet, this genuinely un-sends it — nothing was ever inserted
// server-side, so no push goes out and no row appears in anyone's app.
struct UndoNudgeIntent: AppIntent {
  static var title: LocalizedStringResource { "Undo nudge" }

  init() {}

  func perform() async throws -> some IntentResult {
    if let path = groupDefaults()?.string(forKey: "pending_nudge") {
      await NudgeSender.shared.cancel(path: path)
      groupDefaults()?.removeObject(forKey: "pending_nudge")
    }
    // Drop straight back to the preset list rather than flashing a "cancelled"
    // state — the list reappearing IS the confirmation.
    groupDefaults()?.removeObject(forKey: "widget_status")
    WidgetCenter.shared.reloadTimelines(ofKind: "NudgesWidget")
    return .result()
  }
}

// ── Nudge selection (configurable small widget) ──────────────────────────────
// The small widget shows a SINGLE nudge; this lets the user pick which one via
// the system "Edit Widget" long-press (same pattern as BudgetWidget's
// SelectBudgetIntent in index.swift). Medium/large keep showing the top-N grid
// and ignore this selection. The picker's options come straight from the
// presets the app already mirrored into the App Group ("nudge_presets").
struct NudgePresetEntity: AppEntity {
  let id: String
  let emoji: String
  let label: String

  static var typeDisplayRepresentation: TypeDisplayRepresentation { "Nudge" }
  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(emoji) \(label)") }
  static var defaultQuery = NudgePresetQuery()
}

struct NudgePresetQuery: EntityQuery {
  func entities(for identifiers: [String]) async throws -> [NudgePresetEntity] {
    loadPresets().filter { identifiers.contains($0.id) }
      .map { NudgePresetEntity(id: $0.id, emoji: $0.emoji, label: $0.label) }
  }
  func suggestedEntities() async throws -> [NudgePresetEntity] {
    loadPresets().map { NudgePresetEntity(id: $0.id, emoji: $0.emoji, label: $0.label) }
  }
  func defaultResult() async -> NudgePresetEntity? {
    loadPresets().first.map { NudgePresetEntity(id: $0.id, emoji: $0.emoji, label: $0.label) }
  }
}

struct SelectNudgeIntent: WidgetConfigurationIntent {
  static var title: LocalizedStringResource { "Select nudge" }
  static var description: IntentDescription { "Choose which nudge the small widget sends." }

  @Parameter(title: "Nudge") var preset: NudgePresetEntity?
  init() {}
}

// ── Timeline ─────────────────────────────────────────────────────────────────
struct NudgesEntry: TimelineEntry {
  let date: Date
  let members: [NudgeMember]
  let presets: [NudgePreset]
  let selected: [String]
  let hasToken: Bool
  let status: WidgetStatus?
  // The preset the user picked for the small widget (nil = default to the
  // first). Ignored by medium/large. Falls back to first if it was deleted.
  let pickedId: String?
}

private let sampleNudges = NudgesEntry(
  date: Date(),
  members: [
    NudgeMember(email: "a@x.com", name: "Patricia"),
    NudgeMember(email: "b@x.com", name: "Alex"),
  ],
  presets: [
    NudgePreset(id: "help", kind: "help", emoji: "🆘", label: "Need help", highPriority: true),
    NudgePreset(id: "omw", kind: "omw", emoji: "🚗", label: "On my way", highPriority: false),
    NudgePreset(id: "dinner", kind: "dinner", emoji: "🍽️", label: "Dinner's ready", highPriority: false),
    NudgePreset(id: "grab", kind: "grab", emoji: "🛒", label: "Grab something", highPriority: false),
  ],
  selected: [],
  hasToken: true,
  status: nil,
  pickedId: nil)

func currentNudges(pickedId: String?) -> NudgesEntry {
  NudgesEntry(
    date: Date(),
    members: loadMembers(),
    presets: loadPresets(),
    selected: loadRecipients(),
    hasToken: !widgetToken().isEmpty,
    status: loadStatus(),
    pickedId: pickedId)
}

struct NudgesProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> NudgesEntry { sampleNudges }

  func snapshot(for configuration: SelectNudgeIntent, in context: Context) async -> NudgesEntry {
    context.isPreview && loadPresets().isEmpty ? sampleNudges : currentNudges(pickedId: configuration.preset?.id)
  }

  func timeline(for configuration: SelectNudgeIntent, in context: Context) async -> Timeline<NudgesEntry> {
    let now = currentNudges(pickedId: configuration.preset?.id)
    if let status = now.status {
      // Two entries: the confirmation now, then the plain list at `until` — iOS
      // itself flips between them at that wall-clock time, no process needed.
      let reverted = NudgesEntry(
        date: status.until, members: now.members, presets: now.presets, selected: now.selected,
        hasToken: now.hasToken, status: nil, pickedId: now.pickedId)
      return Timeline(entries: [now, reverted], policy: .atEnd)
    }
    return Timeline(entries: [now], policy: .never)
  }
}

// ── Views ────────────────────────────────────────────────────────────────────
struct NudgeChip: View {
  let title: String
  let active: Bool
  let theme: WarmHearth
  var body: some View {
    Text(title)
      .font(.caption2).fontWeight(.semibold)
      .lineLimit(1)
      .padding(.horizontal, 9).padding(.vertical, 5)
      .background(active ? theme.accent : theme.card)
      .foregroundStyle(active ? Color.white : theme.textMuted)
      .clipShape(Capsule())
  }
}

// One preset as a big, centred tappable tile. The medium/large widgets lay these
// out 2-up in a grid (see nudgeGridRows) instead of thin full-width rows, so each
// target is larger and clearly separated left/right — a near-miss can no longer
// land on the neighbouring nudge and fire the wrong one.
struct NudgeTile: View {
  let preset: NudgePreset
  let theme: WarmHearth
  let prominent: Bool  // the small widget's single, oversized tile

  var body: some View {
    VStack(spacing: 4) {
      Text(preset.emoji).font(.system(size: prominent ? 36 : 22))
      Text(preset.label)
        .font(prominent ? .subheadline : .caption)
        .fontWeight(.medium)
        .foregroundStyle(theme.text)
        .lineLimit(2)
        .multilineTextAlignment(.center)
        .minimumScaleFactor(0.8)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .padding(.horizontal, 6).padding(.vertical, 8)
    .background(preset.highPriority ? theme.expense.opacity(0.14) : theme.card)
    .overlay(
      RoundedRectangle(cornerRadius: 12)
        .stroke(preset.highPriority ? theme.expense.opacity(0.55) : Color.clear, lineWidth: 1))
    .clipShape(RoundedRectangle(cornerRadius: 12))
  }
}

// Chunk presets into rows of `columns`, padding the final row with nils so every
// tile keeps an equal width (a lone last tile won't stretch full-bleed).
struct NudgeGridRow: Identifiable {
  let id: Int
  let cells: [NudgePreset?]
}

func nudgeGridRows(_ presets: [NudgePreset], columns: Int) -> [NudgeGridRow] {
  guard columns > 0 else { return [] }
  var rows: [NudgeGridRow] = []
  var idx = 0
  while idx < presets.count {
    let cells = (0..<columns).map { c -> NudgePreset? in
      let j = idx + c
      return j < presets.count ? presets[j] : nil
    }
    rows.append(NudgeGridRow(id: rows.count, cells: cells))
    idx += columns
  }
  return rows
}

struct NudgeConfirmationView: View {
  let status: WidgetStatus
  let theme: WarmHearth
  var body: some View {
    VStack(spacing: 6) {
      Text(status.emoji).font(.system(size: 30))
      Text(status.label)
        .font(.subheadline).fontWeight(.semibold)
        .foregroundStyle(theme.text)
        .lineLimit(2)
        .multilineTextAlignment(.center)
      HStack(spacing: 4) {
        Image(systemName: "checkmark.circle.fill").font(.caption)
        Text(status.type == "ack" ? "seen by \(status.name ?? "")" : "Sent")
          .font(.caption).fontWeight(.semibold)
      }
      .foregroundStyle(theme.accent)

      // Only while the upload is still held on-device. Once `until` passes the
      // timeline reverts to the list, so there's never a dead Undo on screen.
      if status.type == "pending" {
        Button(intent: UndoNudgeIntent()) {
          Text("Undo")
            .font(.caption).fontWeight(.bold)
            .foregroundStyle(theme.text)
            .padding(.horizontal, 14).padding(.vertical, 5)
            .background(Capsule().fill(theme.card))
        }
        .buttonStyle(.plain)
        .padding(.top, 2)
      }
    }
    .padding(.horizontal, 8)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

struct NudgesWidgetView: View {
  var entry: NudgesEntry
  @Environment(\.widgetFamily) var family
  private var theme: WarmHearth { appTheme() }

  // Small shows a single big tile; medium/large go 2-up.
  private var columns: Int { family == .systemSmall ? 1 : 2 }

  private var presetCount: Int {
    switch family {
    case .systemSmall: return 1
    case .systemMedium: return 4   // 2×2
    default: return 6              // 2×3
    }
  }

  // Small shows the single user-picked preset (falling back to the first, e.g.
  // when nothing's configured yet or the pick was deleted); medium/large show
  // the top-N in their existing order.
  private var visiblePresets: [NudgePreset] {
    if family == .systemSmall {
      if let id = entry.pickedId, let p = entry.presets.first(where: { $0.id == id }) { return [p] }
      return Array(entry.presets.prefix(1))
    }
    return Array(entry.presets.prefix(presetCount))
  }

  private var gridRows: [NudgeGridRow] {
    nudgeGridRows(visiblePresets, columns: columns)
  }

  var body: some View {
    if let status = entry.status {
      NudgeConfirmationView(status: status, theme: theme)
    } else if !entry.hasToken || entry.presets.isEmpty {
      VStack(spacing: 4) {
        Image(systemName: "bell.badge").foregroundStyle(theme.textMuted)
        Text("Open One Roof").font(.caption).foregroundStyle(theme.textMuted)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    } else {
      VStack(spacing: 6) {
        if family != .systemSmall && !entry.members.isEmpty {
          HStack(spacing: 5) {
            Button(intent: ToggleRecipientIntent(email: "")) {
              NudgeChip(title: "All", active: entry.selected.isEmpty, theme: theme)
            }
            .buttonStyle(.plain)
            ForEach(entry.members) { m in
              Button(intent: ToggleRecipientIntent(email: m.email)) {
                NudgeChip(title: firstName(m.name), active: entry.selected.contains(m.email), theme: theme)
              }
              .buttonStyle(.plain)
            }
          }
          .frame(maxWidth: .infinity)
        }
        VStack(spacing: 6) {
          ForEach(gridRows) { row in
            HStack(spacing: 6) {
              ForEach(Array(row.cells.enumerated()), id: \.offset) { _, cell in
                if let p = cell {
                  Button(
                    intent: SendNudgeIntent(kind: p.kind, emoji: p.emoji, message: p.label, highPriority: p.highPriority)
                  ) {
                    NudgeTile(preset: p, theme: theme, prominent: family == .systemSmall)
                  }
                  .buttonStyle(.plain)
                } else {
                  Color.clear.frame(maxWidth: .infinity, maxHeight: .infinity)
                }
              }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
          }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
  }
}

struct NudgesWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: "NudgesWidget", intent: SelectNudgeIntent.self, provider: NudgesProvider()) { entry in
      NudgesWidgetView(entry: entry)
        .containerBackground(appTheme().bg, for: .widget)
    }
    .configurationDisplayName("Nudges")
    .description("Send a household nudge from your Home Screen. Long-press the small widget to pick which nudge it sends.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}
