import UIKit

// The probe's share extension, which takes text and links from the share sheet and hands nothing back.
class ProbeShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        extensionContext?.completeRequest(returningItems: nil)
    }
}
