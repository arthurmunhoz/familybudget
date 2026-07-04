import WidgetKit
import SwiftUI
import AppIntents

// Interactive Home-Screen widget: send a household nudge without opening the app.
// The app (mobile/src/app/pings.tsx via lib/widget.ts) writes into the App Group:
//   "widget_token"   — the per-device send token (migration 045)
//   "nudge_members"  — JSON [{email,name}] the person selector can target
//   "nudge_presets"  — JSON [{kind,emoji,label}] the sendable presets
// The widget owns "widget_recipients" (JSON [email]) — the current selection,
// empty = everyone. Tapping a preset POSTs to /api/widget-nudge.
// APP_GROUP / groupDefaults() are declared in index.swift (same target).

let NUDGE_ENDPOINT = "https://one-roof-app.vercel.app/api/widget-nudge"

struct NudgeMember: Codable, Identifiable {
  let email: String
  let name: String
  var id: String { email }
}

struct NudgePreset: Codable, Identifiable {
  let kind: String
  let emoji: String
  let label: String
  var id: String { kind }
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

// Send a nudge to the currently selected recipients (or everyone). "help" always
// goes to everyone — enforced here and again server-side.
struct SendNudgeIntent: AppIntent {
  static var title: LocalizedStringResource { "Send nudge" }

  @Parameter(title: "Kind") var kind: String
  @Parameter(title: "Emoji") var emoji: String
  @Parameter(title: "Message") var message: String
  init() {}
  init(kind: String, emoji: String, message: String) {
    self.kind = kind
    self.emoji = emoji
    self.message = message
  }

  func perform() async throws -> some IntentResult {
    let token = widgetToken()
    guard !token.isEmpty, let url = URL(string: NUDGE_ENDPOINT) else { return .result() }
    let recipients = kind == "help" ? [] : loadRecipients()
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    let body: [String: Any] = [
      "token": token, "kind": kind, "emoji": emoji, "message": message, "recipients": recipients,
    ]
    req.httpBody = try? JSONSerialization.data(withJSONObject: body)
    _ = try? await URLSession.shared.data(for: req)
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
}

private let sampleNudges = NudgesEntry(
  date: Date(),
  members: [
    NudgeMember(email: "a@x.com", name: "Patricia"),
    NudgeMember(email: "b@x.com", name: "Alex"),
  ],
  presets: [
    NudgePreset(kind: "help", emoji: "🆘", label: "Need help"),
    NudgePreset(kind: "omw", emoji: "🚗", label: "On my way"),
    NudgePreset(kind: "dinner", emoji: "🍽️", label: "Dinner's ready"),
    NudgePreset(kind: "grab", emoji: "🛒", label: "Grab something"),
  ],
  selected: [],
  hasToken: true)

func currentNudges() -> NudgesEntry {
  NudgesEntry(
    date: Date(),
    members: loadMembers(),
    presets: loadPresets(),
    selected: loadRecipients(),
    hasToken: !widgetToken().isEmpty)
}

struct NudgesProvider: TimelineProvider {
  func placeholder(in context: Context) -> NudgesEntry { sampleNudges }
  func getSnapshot(in context: Context, completion: @escaping (NudgesEntry) -> Void) {
    completion(context.isPreview && loadPresets().isEmpty ? sampleNudges : currentNudges())
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<NudgesEntry>) -> Void) {
    completion(Timeline(entries: [currentNudges()], policy: .never))
  }
}

// ── Views ────────────────────────────────────────────────────────────────────
struct NudgeChip: View {
  let title: String
  let active: Bool
  var body: some View {
    Text(title)
      .font(.caption2).fontWeight(.semibold)
      .lineLimit(1)
      .padding(.horizontal, 9).padding(.vertical, 5)
      .background(active ? Color.accentColor : Color.secondary.opacity(0.18))
      .foregroundStyle(active ? Color.white : Color.primary)
      .clipShape(Capsule())
  }
}

struct NudgesWidgetView: View {
  var entry: NudgesEntry
  @Environment(\.widgetFamily) var family

  private var presetCount: Int {
    switch family {
    case .systemSmall: return 2
    case .systemMedium: return 3
    default: return 6
    }
  }

  var body: some View {
    if !entry.hasToken || entry.presets.isEmpty {
      VStack(spacing: 4) {
        Image(systemName: "bell.badge").foregroundStyle(.secondary)
        Text("Open One Roof").font(.caption).foregroundStyle(.secondary)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    } else {
      VStack(spacing: 6) {
        if family != .systemSmall && !entry.members.isEmpty {
          HStack(spacing: 5) {
            Button(intent: ToggleRecipientIntent(email: "")) {
              NudgeChip(title: "All", active: entry.selected.isEmpty)
            }
            .buttonStyle(.plain)
            ForEach(entry.members) { m in
              Button(intent: ToggleRecipientIntent(email: m.email)) {
                NudgeChip(title: firstName(m.name), active: entry.selected.contains(m.email))
              }
              .buttonStyle(.plain)
            }
          }
          .frame(maxWidth: .infinity)
        }
        VStack(spacing: 5) {
          ForEach(Array(entry.presets.prefix(presetCount))) { p in
            Button(intent: SendNudgeIntent(kind: p.kind, emoji: p.emoji, message: p.label)) {
              HStack(spacing: 6) {
                Text(p.emoji)
                Text(p.label).font(.caption).fontWeight(.medium).lineLimit(1)
                Spacer(minLength: 0)
              }
              .padding(.horizontal, 10).padding(.vertical, 8)
              .frame(maxWidth: .infinity, alignment: .leading)
              .background(p.kind == "help" ? Color.red.opacity(0.14) : Color.secondary.opacity(0.14))
              .overlay(
                RoundedRectangle(cornerRadius: 10)
                  .stroke(p.kind == "help" ? Color.red.opacity(0.55) : Color.clear, lineWidth: 1))
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
        .containerBackground(.fill.tertiary, for: .widget)
    }
    .configurationDisplayName("Nudges")
    .description("Send a household nudge from your Home Screen.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}
