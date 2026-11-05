import Foundation
import SwiftUI
import WidgetKit

private let widgetKind = "OrbitToday"

struct TodayTask: Decodable {
    let title: String
    let time: String
    let completed: Bool
}

struct TodaySnapshot: Decodable {
    let date: String
    let generatedAt: Double
    let validUntil: Double
    let remaining: Int
    let completed: Int
    let items: [TodayTask]
}

struct TodayEntry: TimelineEntry {
    let date: Date
    let snapshot: TodaySnapshot?
    var current: TodaySnapshot? {
        guard let snapshot, snapshot.validUntil > date.timeIntervalSince1970 * 1000 else { return nil }
        return snapshot
    }
}

struct TodayProvider: TimelineProvider {
    private func entry() -> TodayEntry {
        let now = Date()
        guard let group = Bundle.main.object(forInfoDictionaryKey: "OrbitAppGroup") as? String,
              let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group),
              let bytes = try? Data(contentsOf: container.appendingPathComponent("orbit-today.json")),
              bytes.count <= 32768,
              let snapshot = try? JSONDecoder().decode(TodaySnapshot.self, from: bytes) else {
            return TodayEntry(date: now, snapshot: nil)
        }
        return TodayEntry(date: now, snapshot: snapshot)
    }

    func placeholder(in context: Context) -> TodayEntry { TodayEntry(date: Date(), snapshot: nil) }
    func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) { completion(entry()) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
        let value = entry()
        let now = value.date
        var entries = [value]
        if let snapshot = value.current {
            let stale = Date(timeIntervalSince1970: snapshot.generatedAt / 1000 + 45 * 60)
            let midnight = Date(timeIntervalSince1970: snapshot.validUntil / 1000)
            if stale > now && stale < midnight { entries.append(TodayEntry(date: stale, snapshot: snapshot)) }
            entries.append(TodayEntry(date: midnight, snapshot: snapshot))
        }
        completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(15 * 60))))
    }
}

struct TodayWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: TodayEntry
    private var rows: Int {
        switch family {
        case .systemSmall: 2
        case .systemLarge: 6
        default: 3
        }
    }
    private let todayLink = URL(string: "orbit-today://open")!

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                Label("Orbit", systemImage: "circle.dashed")
                    .font(.caption.weight(.semibold))
                Spacer(minLength: 4)
                Text(entry.current?.date ?? "今日").font(.caption2).foregroundStyle(.secondary)
            }
            if let snapshot = entry.current {
                Text("\(snapshot.remaining) 项未完成").font(.headline).lineLimit(1)
                if family == .systemLarge {
                    let total = snapshot.remaining + snapshot.completed
                    if total > 0 {
                        ProgressView(value: Double(snapshot.completed), total: Double(total))
                            .accessibilityLabel("已完成 \(snapshot.completed) 项，共 \(total) 项")
                    }
                }
                if snapshot.items.isEmpty {
                    Text("今日暂无待办").font(.caption).foregroundStyle(.secondary)
                }
                ForEach(Array(snapshot.items.prefix(rows).enumerated()), id: \.offset) { _, task in
                    HStack(spacing: 6) {
                        Image(systemName: task.completed ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(.secondary).accessibilityHidden(true)
                        if !task.time.isEmpty {
                            Text(task.time).monospacedDigit().foregroundStyle(.secondary)
                        }
                        Text(task.title).lineLimit(1).privacySensitive()
                    }
                    .font(.caption)
                    .accessibilityElement(children: .combine)
                    .accessibilityValue(task.completed ? "已完成" : "待办")
                }
            } else {
                Text("打开 Orbit 同步").font(.headline)
                Text("登录后显示今日待办").font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if let snapshot = entry.snapshot {
                let synced = Date(timeIntervalSince1970: snapshot.generatedAt / 1000)
                let stale = entry.date.timeIntervalSince(synced) > 45 * 60 || entry.current == nil
                HStack(spacing: 3) {
                    Text("更新")
                    Text(synced, style: .time)
                    if stale { Text("· 可能过期") }
                }
                .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .widgetURL(todayLink)
        .containerBackground(.background, for: .widget)
    }
}

@main
struct OrbitTodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: widgetKind, provider: TodayProvider()) { entry in
            TodayWidgetView(entry: entry)
        }
        .configurationDisplayName("Orbit 今日待办")
        .description("查看今日待办、执行时间与完成进度。")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
