import Foundation
import UIKit
import UniformTypeIdentifiers
import Capacitor

// The native half of window.api on iOS (see src/mobile/native-api.ts). Registered
// explicitly in FolderifyBridgeViewController.capacitorDidLoad() because app-embedded
// plugins are not auto-discovered by Capacitor.
//
//   pickFolder() -> { root, rootName }   present the folder picker + persist access
//   getLibrary() -> LibraryModel         scan the connected folder
//   forget()     -> void                 release access + clear the saved folder
//
// Media/cover bytes are served separately by the media:///cover:// scheme handlers.
@objc(FolderifyLibraryPlugin)
public class FolderifyLibraryPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "FolderifyLibraryPlugin"
    public let jsName = "FolderifyLibrary"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickFolder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getLibrary", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "forget", returnType: CAPPluginReturnPromise)
    ]

    /// The picker call in flight (resolved by the delegate callbacks).
    private var pendingPick: CAPPluginCall?

    // MARK: - pickFolder

    @objc func pickFolder(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            guard let presenter = self.bridge?.viewController else {
                call.reject("No view controller to present the folder picker")
                return
            }
            self.pendingPick = call
            // Open-in-place (asCopy defaults off) so we get a security-scoped folder URL.
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.folder])
            picker.delegate = self
            picker.allowsMultipleSelection = false
            presenter.present(picker, animated: true)
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pendingPick else { return }
        pendingPick = nil
        guard let url = urls.first else {
            call.resolve(["root": NSNull(), "rootName": NSNull()])
            return
        }
        if LibraryAccess.shared.connect(to: url) {
            call.resolve([
                "root": url.standardizedFileURL.path,
                "rootName": url.lastPathComponent
            ])
        } else {
            call.reject("Could not access the selected folder")
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pendingPick?.resolve(["root": NSNull(), "rootName": NSNull()])
        pendingPick = nil
    }

    // MARK: - getLibrary

    @objc func getLibrary(_ call: CAPPluginCall) {
        Task {
            guard let root = LibraryAccess.shared.ensureRoot() else {
                // No folder connected yet — empty model (renderer shows "connect a folder").
                call.resolve([
                    "root": NSNull(),
                    "rootName": NSNull(),
                    "playlists": [],
                    "tracks": [],
                    "scanning": false
                ])
                return
            }
            let (model, artwork) = await LibraryScanner.scan(root: root, rootName: root.lastPathComponent)
            LibraryAccess.shared.artworkById = artwork
            call.resolve(model)
        }
    }

    // MARK: - forget

    @objc func forget(_ call: CAPPluginCall) {
        LibraryAccess.shared.forget()
        call.resolve()
    }
}
