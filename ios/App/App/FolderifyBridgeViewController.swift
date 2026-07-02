import UIKit
import WebKit
import Capacitor

// Capacitor's bridge VC, subclassed to do two things the default one can't:
//   1. Register our app-embedded FolderifyLibrary plugin (app-target plugins are
//      NOT auto-discovered — they must be registered explicitly in capacitorDidLoad).
//   2. Install the media:// and cover:// scheme handlers on the WebView config
//      BEFORE the WKWebView is created (webViewConfiguration(for:)).
//
// Wired in via Main.storyboard: the Bridge View Controller scene's Custom Class is
// set to FolderifyBridgeViewController with module "App".
class FolderifyBridgeViewController: CAPBridgeViewController {

    // Keep strong references — WKWebViewConfiguration does not retain scheme handlers.
    private let mediaHandler = MediaSchemeHandler()
    private let coverHandler = CoverSchemeHandler()

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(FolderifyLibraryPlugin())
        bridge?.registerPluginInstance(FolderifyNowPlayingPlugin())
    }

    override open func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        // 'media' and 'cover' are custom schemes (not WebKit-reserved), so registering
        // handlers for them is allowed. Must happen before the WKWebView is built.
        configuration.setURLSchemeHandler(mediaHandler, forURLScheme: "media")
        configuration.setURLSchemeHandler(coverHandler, forURLScheme: "cover")
        return configuration
    }
}
