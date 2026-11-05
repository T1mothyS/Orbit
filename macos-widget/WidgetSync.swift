import Foundation
import WidgetKit

@main
struct WidgetSync {
    static func main() {
        let arguments = CommandLine.arguments
        guard arguments.count == 3,
              let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: arguments[1]) else {
            exit(1)
        }
        let file = container.appendingPathComponent("orbit-today.json")
        do {
            switch arguments[2] {
            case "write":
                var bytes = Data()
                while bytes.count <= 32768 {
                    guard let chunk = try FileHandle.standardInput.read(upToCount: 32769 - bytes.count), !chunk.isEmpty else { break }
                    bytes.append(chunk)
                }
                guard !bytes.isEmpty, bytes.count <= 32768 else { exit(1) }
                try bytes.write(to: file, options: .atomic)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
            case "clear":
                if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
            default:
                exit(1)
            }
            WidgetCenter.shared.reloadTimelines(ofKind: "OrbitToday")
        } catch {
            exit(1)
        }
    }
}
