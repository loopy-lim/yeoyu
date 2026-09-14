// Phase 2 contract only. No WKWebView instantiated by this POC.
import Foundation
protocol BrowserSessionRegistry {
    func ensureSession(tabId: String)
    func load(tabId: String, url: URL)
    func close(tabId: String)
}
// A future Fabric UIView will own WKWebView; Rust receives serializable TabId metadata only.
