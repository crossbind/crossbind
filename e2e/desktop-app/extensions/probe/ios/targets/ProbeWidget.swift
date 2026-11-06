import SwiftUI
import WidgetKit

// The probe's widget, which shows what the app's probe wrote into the App Group the two share.
struct ProbeEntry: TimelineEntry {
    let date: Date
    let text: String
}

struct ProbeProvider: TimelineProvider {
    func placeholder(in context: Context) -> ProbeEntry { ProbeEntry(date: Date(), text: "probe") }

    func getSnapshot(in context: Context, completion: @escaping (ProbeEntry) -> Void) { completion(entry()) }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ProbeEntry>) -> Void) {
        completion(Timeline(entries: [entry()], policy: .never))
    }

    private func entry() -> ProbeEntry {
        let group = Bundle.main.object(forInfoDictionaryKey: "CrossbindAppGroup") as? String
        let text = group.flatMap { UserDefaults(suiteName: $0)?.string(forKey: "probe") } ?? "none"
        return ProbeEntry(date: Date(), text: text)
    }
}

@main
struct ProbeWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "probe", provider: ProbeProvider()) { entry in
            // iOS 17 draws a widget's background itself, from the one its view names.
            if #available(iOSApplicationExtension 17.0, *) {
                Text(entry.text).containerBackground(.background, for: .widget)
            } else {
                Text(entry.text)
            }
        }
        .configurationDisplayName("Probe")
    }
}
