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
  let type: String  // "sent" | "ack"
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
    // Show the "sent!" confirmation immediately — the network call is
    // best-effort from here on, same as everywhere else pings are sent.
    writeStatus(
      WidgetStatus(type: "sent", emoji: emoji, label: message, name: nil, until: Date().addingTimeInterval(3)))
    WidgetCenter.shared.reloadTimelines(ofKind: "NudgesWidget")

    let token = widgetToken()
    if !token.isEmpty, let url = URL(string: NUDGE_ENDPOINT) {
      let recipients = highPriority ? [] : loadRecipients()
      var req = URLRequest(url: url)
      req.httpMethod = "POST"
      req.setValue("application/json", forHTTPHeaderField: "Content-Type")
      let body: [String: Any] = [
        "token": token, "kind": kind, "emoji": emoji, "message": message,
        "recipients": recipients, "high_priority": highPriority,
      ]
      req.httpBody = try? JSONSerialization.data(withJSONObject: body)
      _ = try? await URLSession.shared.data(for: req)
    }
    return .result()
  }
}

// ── Timeline ─────────────────────────────────────────────────────────────────
struct NudgesEntry: TimelineEntry {
  let date: Date
  let members: [NudgeMember]
  let presets: [NudgePreset]
  let selected: [String]
  let hasToken: Bool
  let status: WidgetStatus?
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
  status: nil)

func currentNudges() -> NudgesEntry {
  NudgesEntry(
    date: Date(),
    members: loadMembers(),
    presets: loadPresets(),
    selected: loadRecipients(),
    hasToken: !widgetToken().isEmpty,
    status: loadStatus())
}

struct NudgesProvider: TimelineProvider {
  func placeholder(in context: Context) -> NudgesEntry { sampleNudges }
  func getSnapshot(in context: Context, completion: @escaping (NudgesEntry) -> Void) {
    completion(context.isPreview && loadPresets().isEmpty ? sampleNudges : currentNudges())
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<NudgesEntry>) -> Void) {
    let now = currentNudges()
    if let status = now.status {
      // Two entries: the confirmation now, then the plain list at `until` — iOS
      // itself flips between them at that wall-clock time, no process needed.
      let reverted = NudgesEntry(
        date: status.until, members: now.members, presets: now.presets, selected: now.selected,
        hasToken: now.hasToken, status: nil)
      completion(Timeline(entries: [now, reverted], policy: .atEnd))
    } else {
      completion(Timeline(entries: [now], policy: .never))
    }
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
    }
    .padding(.horizontal, 8)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

struct NudgesWidgetView: View {
  var entry: NudgesEntry
  @Environment(\.widgetFamily) var family
  private var theme: WarmHearth { appTheme() }

  private var presetCount: Int {
    switch family {
    case .systemSmall: return 2
    case .systemMedium: return 3
    default: return 6
    }
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
        VStack(spacing: 5) {
          ForEach(Array(entry.presets.prefix(presetCount))) { p in
            Button(
              intent: SendNudgeIntent(kind: p.kind, emoji: p.emoji, message: p.label, highPriority: p.highPriority)
            ) {
              HStack(spacing: 6) {
                Text(p.emoji)
                Text(p.label).font(.caption).fontWeight(.medium).foregroundStyle(theme.text).lineLimit(1)
                Spacer(minLength: 0)
              }
              .padding(.horizontal, 10).padding(.vertical, 8)
              .frame(maxWidth: .infinity, alignment: .leading)
              .background(p.highPriority ? theme.expense.opacity(0.14) : theme.card)
              .overlay(
                RoundedRectangle(cornerRadius: 10)
                  .stroke(p.highPriority ? theme.expense.opacity(0.55) : Color.clear, lineWidth: 1))
              .clipShape(RoundedRectangle(cornerRadius: 10))
            }
            .buttonStyle(.plain)
          }
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
  }
}

struct NudgesWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "NudgesWidget", provider: NudgesProvider()) { entry in
      NudgesWidgetView(entry: entry)
        .containerBackground(appTheme().bg, for: .widget)
    }
    .configurationDisplayName("Nudges")
    .description("Send a household nudge from your Home Screen.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}
