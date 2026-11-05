import Foundation

// The probe's Swift, which swiftc compiles apart from its other sources and apple.mm reaches through probe-Swift.h: a C
// function, as C++ calls one, and a class of Objective-C's, as Objective-C++ makes one.
@_cdecl("probe_swift_sum")
public func probeSwiftSum(_ a: Int32, _ b: Int32) -> Int32 { a + b }

@objc public final class ProbeSwift: NSObject {
    @objc public func greeting() -> String { "swift" }
}
