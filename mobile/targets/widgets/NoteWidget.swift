import WidgetKit
import SwiftUI
import UIKit

// ── Recado (hand-drawn note) widget ──────────────────────────────────────────
// Shows the LATEST drawn note this member received (migrations 112/113), like a
// sheet of paper stuck on the Home Screen. It fetches for itself with the
// per-device widget token (api/widget.ts ?action=note) and keeps the picture's
// bytes in the App Group container, so it still shows offline and a new note
// replaces it without anyone opening the app. Tap → the app opens that note
// full screen (oneroof:///?note=<id>, the same route a note push uses).

private let NOTE_KIND = "NoteWidget"

/// The widget's own strings: the device language, since the extension has no
/// access to the app's dictionaries (pt / es / en).
func wLang() -> String {
  let c = Locale.current.language.languageCode?.identifier ?? "en"
  return c == "pt" || c == "es" ? c : "en"
}
private func nT(_ key: String, _ name: String = "") -> String {
  let l = wLang()
  switch key {
  case "from": return l == "en" ? "From \(name)" : "De \(name)"
  case "drew": return l == "pt" ? "\(name) desenhou um recado" : l == "es" ? "\(name) dibujó una nota" : "\(name) drew you a note"
  case "view": return l == "pt" ? "Ver recado" : l == "es" ? "Ver nota" : "View note"
  case "reply": return l == "pt" ? "Responder" : l == "es" ? "Responder" : "Reply"
  case "emptyTitle": return l == "pt" ? "Nenhum recado ainda" : l == "es" ? "Aún no hay notas" : "No notes yet"
  case "emptyHint": return l == "pt" ? "Desenhe um para a família" : l == "es" ? "Dibuja una para la familia" : "Draw one for the family"
  case "name": return l == "pt" ? "Recado" : l == "es" ? "Nota" : "Note"
  case "desc": return l == "pt" ? "O último recado à mão que você recebeu." : l == "es" ? "La última nota a mano que recibiste." : "The latest hand-drawn note you received."
  default: return key
  }
}

struct NoteInfo: Codable {
  let id: String
  let from: String
  let createdAt: String
  let imageUrl: String?
}
private struct NoteResponse: Codable { let note: NoteInfo? }

private func noteDir() -> URL? {
  FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: APP_GROUP)?.appendingPathComponent("note-widget", isDirectory: true)
}
private func noteImageFile(_ id: String) -> URL? { noteDir()?.appendingPathComponent("\(id).jpg") }

private func loadCachedNote() -> NoteInfo? {
  guard let raw = groupDefaults()?.string(forKey: "note_widget"), let d = raw.data(using: .utf8) else { return nil }
  return try? JSONDecoder().decode(NoteInfo.self, from: d)
}
private func saveCachedNote(_ n: NoteInfo?) {
  guard let n, let d = try? JSONEncoder().encode(n), let s = String(data: d, encoding: .utf8) else {
    groupDefaults()?.removeObject(forKey: "note_widget")
    return
  }
  groupDefaults()?.set(s, forKey: "note_widget")
}

/// Widgets are refused images past a pixel budget, and a 1080-wide PNG is far
/// more than a 170pt tile needs: keep an ~700px JPEG.
private func downsample(_ data: Data, maxSide: CGFloat = 700) -> Data? {
  guard let img = UIImage(data: data) else { return nil }
  let scale = min(1, maxSide / max(img.size.width, img.size.height))
  let size = CGSize(width: img.size.width * scale, height: img.size.height * scale)
  let fmt = UIGraphicsImageRendererFormat()
  fmt.scale = 1
  fmt.opaque = true
  let out = UIGraphicsImageRenderer(size: size, format: fmt).image { ctx in
    UIColor(red: 1, green: 0.984, blue: 0.949, alpha: 1).setFill()
    ctx.fill(CGRect(origin: .zero, size: size))
    img.draw(in: CGRect(origin: .zero, size: size))
  }
  return out.jpegData(compressionQuality: 0.85)
}

/// nil = couldn't ask (offline, no token) → keep what we have. `.some(nil)` =
/// the server says there is no note.
private func fetchNote() async -> NoteInfo?? {
  let token = widgetToken()
  guard !token.isEmpty, let url = URL(string: WIDGET_ENDPOINT) else { return nil }
  var req = URLRequest(url: url)
  req.httpMethod = "POST"
  req.setValue("application/json", forHTTPHeaderField: "Content-Type")
  req.httpBody = try? JSONSerialization.data(withJSONObject: ["action": "note", "token": token])
  guard
    let (data, resp) = try? await URLSession.shared.data(for: req),
    (resp as? HTTPURLResponse)?.statusCode == 200,
    let r = try? JSONDecoder().decode(NoteResponse.self, from: data)
  else { return nil }
  return .some(r.note)
}

private func ensureImage(_ note: NoteInfo) async {
  guard let file = noteImageFile(note.id), !FileManager.default.fileExists(atPath: file.path),
        let s = note.imageUrl, let url = URL(string: s),
        let (data, resp) = try? await URLSession.shared.data(from: url),
        (resp as? HTTPURLResponse)?.statusCode == 200,
        let small = downsample(data), let dir = noteDir()
  else { return }
  try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  // One note at a time: drop the previous picture.
  if let old = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) {
    for f in old where f.lastPathComponent != file.lastPathComponent { try? FileManager.default.removeItem(at: f) }
  }
  try? small.write(to: file, options: .atomic)
}

struct NoteEntry: TimelineEntry {
  let date: Date
  let note: NoteInfo?
  let image: UIImage?
  var sample = false
}

private func buildNote() async -> NoteEntry {
  var note = loadCachedNote()
  if let fresh = await fetchNote() {
    note = fresh
    saveCachedNote(fresh)
  }
  var image: UIImage?
  if let note {
    await ensureImage(note)
    if let f = noteImageFile(note.id), let d = try? Data(contentsOf: f) { image = UIImage(data: d) }
  }
  return NoteEntry(date: Date(), note: note, image: image)
}

struct NoteProvider: TimelineProvider {
  func placeholder(in context: Context) -> NoteEntry {
    NoteEntry(date: Date(), note: NoteInfo(id: "", from: "Sam", createdAt: "", imageUrl: nil), image: nil, sample: true)
  }
  func getSnapshot(in context: Context, completion: @escaping (NoteEntry) -> Void) {
    if context.isPreview { completion(placeholder(in: context)); return }
    Task { completion(await buildNote()) }
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<NoteEntry>) -> Void) {
    Task {
      let e = await buildNote()
      completion(Timeline(entries: [e], policy: .after(Date().addingTimeInterval(15 * 60))))
    }
  }
}

private func noteAgo(_ iso: String) -> String {
  let f = ISO8601DateFormatter()
  f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  let f2 = ISO8601DateFormatter()
  guard let d = f.date(from: iso) ?? f2.date(from: iso) else { return "" }
  let r = RelativeDateTimeFormatter()
  r.unitsStyle = .short
  return r.localizedString(for: d, relativeTo: Date())
}

/// Ruled paper with a scribble — the placeholder and the "no picture yet" face.
private struct PaperSketch: View {
  var body: some View {
    GeometryReader { g in
      let w = g.size.width, h = g.size.height
      ZStack {
        W_PAPER
        ForEach(1..<6, id: \.self) { i in
          Rectangle().fill(Color(hex: "E9DFCB")).frame(height: 1).position(x: w / 2, y: h * CGFloat(i) / 6)
        }
        Image(systemName: "heart").font(.system(size: min(w, h) * 0.26, weight: .semibold)).foregroundStyle(Color(hex: "E4554A"))
          .position(x: w * 0.3, y: h * 0.42)
        Image(systemName: "scribble").font(.system(size: min(w, h) * 0.3, weight: .semibold)).foregroundStyle(W_INK)
          .position(x: w * 0.66, y: h * 0.46)
      }
    }
  }
}

private struct Sheet: View {
  let entry: NoteEntry
  var body: some View {
    ZStack(alignment: .top) {
      if let img = entry.image {
        W_PAPER
        Image(uiImage: img).resizable().scaledToFill()
      } else {
        PaperSketch()
      }
      // Washi tape, as on the wall in the app.
      RoundedRectangle(cornerRadius: 2).fill(Color(hex: "F6C7B8").opacity(0.92)).frame(width: 52, height: 15).rotationEffect(.degrees(-3)).offset(y: -3)
    }
    .clipped()
  }
}

struct NoteWidgetView: View {
  let entry: NoteEntry
  @Environment(\.widgetFamily) var family

  private var open: URL { URL(string: entry.note.map { "oneroof:///?note=\($0.id)" } ?? "oneroof:///notes")! }

  var body: some View {
    Group {
      if entry.note == nil {
        empty
      } else if family == .systemSmall {
        small
      } else {
        wide
      }
    }
    .widgetURL(open)
    .containerBackground(for: .widget) { WGradient(WG.kraft) }
  }

  private var caption: String {
    guard let n = entry.note else { return "" }
    let ago = entry.sample ? "" : noteAgo(n.createdAt)
    return ago.isEmpty ? nT("from", n.from) : "\(nT("from", n.from)) · \(ago)"
  }

  private var small: some View {
    ZStack(alignment: .bottomLeading) {
      Sheet(entry: entry)
      Text(caption)
        .font(.system(size: 11.5, weight: .semibold, design: .rounded))
        .foregroundStyle(W_INK_SOFT)
        .lineLimit(1)
        .padding(.horizontal, 9).padding(.vertical, 4)
        .background(Capsule().fill(W_PAPER.opacity(0.92)))
        .padding(10)
    }
  }

  private var wide: some View {
    GeometryReader { g in
      HStack(spacing: 0) {
        Sheet(entry: entry).frame(width: g.size.width * (family == .systemLarge ? 1 : 0.44), height: family == .systemLarge ? g.size.height * 0.68 : g.size.height)
        if family != .systemLarge { side.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading) }
      }
      .overlay(alignment: .bottom) {
        if family == .systemLarge { side.frame(height: g.size.height * 0.32) }
      }
    }
  }

  private var side: some View {
    VStack(alignment: .leading, spacing: 3) {
      if let n = entry.note {
        Text(entry.sample ? " " : noteAgo(n.createdAt))
          .font(.system(size: 11.5, weight: .semibold, design: .rounded)).foregroundStyle(W_INK_SOFT)
        Text(nT("drew", n.from))
          .font(.system(size: 16, weight: .heavy, design: .rounded)).foregroundStyle(W_INK)
          .lineLimit(2).minimumScaleFactor(0.8)
      }
      Spacer(minLength: 4)
      HStack(spacing: 8) {
        Link(destination: open) { pill(nT("view"), filled: true) }
        Link(destination: URL(string: "oneroof:///draw-note")!) { pill(nT("reply"), filled: false) }
      }
    }
    .padding(14)
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func pill(_ text: String, filled: Bool) -> some View {
    Text(text)
      .font(.system(size: 12.5, weight: .bold, design: .rounded))
      .foregroundStyle(filled ? W_PAPER : W_INK)
      .lineLimit(1)
      .padding(.horizontal, 12).padding(.vertical, 7)
      .background(Capsule().fill(filled ? W_INK : W_INK.opacity(0.1)))
  }

  private var empty: some View {
    VStack(spacing: 6) {
      Image(systemName: "pencil.and.scribble").font(.system(size: 30, weight: .semibold)).foregroundStyle(W_INK)
      Text(nT("emptyTitle")).font(.system(size: 15, weight: .heavy, design: .rounded)).foregroundStyle(W_INK).multilineTextAlignment(.center)
      Text(nT("emptyHint")).font(.system(size: 12, weight: .medium, design: .rounded)).foregroundStyle(W_INK_SOFT).multilineTextAlignment(.center)
    }
    .padding(14)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

struct NoteWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: NOTE_KIND, provider: NoteProvider()) { entry in
      NoteWidgetView(entry: entry)
    }
    .configurationDisplayName(nT("name"))
    .description(nT("desc"))
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    .contentMarginsDisabled()
  }
}
