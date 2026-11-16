// Native side of the Safari Web Extension. Safari routes runtime.connectNative()/sendNativeMessage() of the extension to
// this handler inside the container app, never to another program. Linkwache does not use it: the Safari build of the
// extension checks links against the server directly (POST /api/v1/check), see docs/DESKTOP.md "Safari".
// Forwarding to the desktop app would need a shared App Group or a local socket, both of which require a signing team
// and would make the free, unsigned build impossible. The handler therefore only answers that it is not supported.
import Foundation
import SafariServices

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let response = NSExtensionItem()
        let payload: [String: Any] = ["type": "unsupported", "reason": "safari-container-only"]
        response.userInfo = [SFExtensionMessageKey: payload]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
