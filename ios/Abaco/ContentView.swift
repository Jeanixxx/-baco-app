import Foundation
import LocalAuthentication
import SwiftUI
import UIKit
import WebKit

final class BiometricSecurity: ObservableObject {
    private static let preferenceKey = "abaco.biometricLockEnabled"

    @Published private(set) var lockEnabled: Bool
    @Published private(set) var isLocked: Bool
    @Published private(set) var availability: String

    private weak var webView: WKWebView?
    private var promptActive = false

    init() {
        let enabled = UserDefaults.standard.bool(forKey: Self.preferenceKey)
        lockEnabled = enabled
        isLocked = enabled
        availability = Self.currentAvailability()
    }

    func makeBridgeScript() -> WKUserScript {
        let availabilityValue = Self.javascriptString(availability)
        let enabledValue = lockEnabled ? "true" : "false"
        let source = """
        (() => {
          window.__abacoBiometricAvailability = \(availabilityValue);
          window.__abacoBiometricEnabled = \(enabledValue);
          window.AndroidBridge = {
            biometricAvailability: () => window.__abacoBiometricAvailability || "unavailable",
            biometricLockEnabled: () => window.__abacoBiometricEnabled === true,
            setBiometricLock: (enabled) => window.webkit.messageHandlers.abacoSecurity.postMessage({enabled: !!enabled})
          };
        })();
        """
        return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    func attach(webView: WKWebView) {
        self.webView = webView
        publishBridgeState()
    }

    func setBiometricLock(_ enabled: Bool) {
        guard enabled else {
            lockEnabled = false
            isLocked = false
            UserDefaults.standard.set(false, forKey: Self.preferenceKey)
            notify(mode: "disable", success: true, message: "")
            return
        }

        availability = Self.currentAvailability()
        guard availability == "available" else {
            let message = availability == "none_enrolled"
                ? "Configura Face ID o Touch ID en los ajustes del dispositivo y vuelve a intentarlo."
                : "La biometría no está disponible en este momento."
            notify(mode: "enable", success: false, message: message)
            return
        }
        authenticate(mode: "enable")
    }

    func scenePhaseDidChange(_ phase: ScenePhase) {
        switch phase {
        case .inactive, .background:
            if lockEnabled && !promptActive {
                isLocked = true
            }
        case .active:
            availability = Self.currentAvailability()
            publishBridgeState()
            if lockEnabled && isLocked {
                authenticate(mode: "unlock")
            }
        @unknown default:
            break
        }
    }

    func retryUnlock() {
        guard lockEnabled && isLocked else { return }
        authenticate(mode: "unlock")
    }

    private func authenticate(mode: String) {
        guard !promptActive else { return }
        let context = LAContext()
        let policy: LAPolicy = mode == "unlock"
            ? .deviceOwnerAuthentication
            : .deviceOwnerAuthenticationWithBiometrics
        var evaluationError: NSError?
        guard context.canEvaluatePolicy(policy, error: &evaluationError) else {
            let message = evaluationError?.localizedDescription
                ?? "Configura Face ID o Touch ID en los ajustes del dispositivo."
            if mode == "enable" {
                isLocked = false
                notify(mode: mode, success: false, message: message)
            } else {
                isLocked = true
            }
            return
        }

        promptActive = true
        context.evaluatePolicy(
            policy,
            localizedReason: mode == "enable"
                ? "Confirma tu identidad para proteger Ábaco."
                : "Confirma tu identidad para volver a Ábaco."
        ) { [weak self] success, error in
            DispatchQueue.main.async {
                guard let self else { return }
                self.promptActive = false
                if success {
                    if mode == "enable" {
                        self.lockEnabled = true
                        UserDefaults.standard.set(true, forKey: Self.preferenceKey)
                    }
                    self.isLocked = false
                    self.notify(mode: mode, success: true, message: "")
                } else if mode == "enable" {
                    self.isLocked = false
                    self.notify(
                        mode: mode,
                        success: false,
                        message: error?.localizedDescription ?? "No se pudo confirmar la identidad."
                    )
                } else {
                    self.isLocked = true
                }
            }
        }
    }

    private func publishBridgeState() {
        guard let webView else { return }
        let availabilityValue = Self.javascriptString(availability)
        let enabledValue = lockEnabled ? "true" : "false"
        webView.evaluateJavaScript(
            "window.__abacoBiometricAvailability = \(availabilityValue); window.__abacoBiometricEnabled = \(enabledValue); window.stitchRender?.();",
            completionHandler: nil
        )
    }

    private func notify(mode: String, success: Bool, message: String) {
        guard let webView else { return }
        let modeValue = Self.javascriptString(mode)
        let messageValue = Self.javascriptString(message)
        let availabilityValue = Self.javascriptString(availability)
        let enabledValue = lockEnabled ? "true" : "false"
        webView.evaluateJavaScript(
            """
            window.__abacoBiometricAvailability = \(availabilityValue);
            window.__abacoBiometricEnabled = \(enabledValue);
            window.onNativeBiometricResult?.(\(modeValue), \(success ? "true" : "false"), \(messageValue));
            """,
            completionHandler: nil
        )
    }

    private static func currentAvailability() -> String {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            guard let biometricError = error as? LAError else { return "unavailable" }
            switch biometricError.code {
            case .biometryNotEnrolled, .passcodeNotSet:
                return "none_enrolled"
            case .biometryNotAvailable:
                return "no_hardware"
            default:
                return "unavailable"
            }
        }
        return "available"
    }

    private static func javascriptString(_ value: String) -> String {
        guard
            let data = try? JSONSerialization.data(withJSONObject: value, options: .fragmentsAllowed),
            let result = String(data: data, encoding: .utf8)
        else {
            return "\"\""
        }
        return result
    }
}

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var security = BiometricSecurity()

    var body: some View {
        ZStack {
            AbacoWebView(security: security)
                .ignoresSafeArea()

            if security.isLocked {
                Color(uiColor: .systemBackground)
                    .ignoresSafeArea()
                    .overlay {
                        VStack(spacing: 16) {
                            Image(systemName: "faceid")
                                .font(.system(size: 42, weight: .regular))
                                .foregroundStyle(Color.accentColor)
                            Text("Ábaco bloqueado")
                                .font(.title2.weight(.semibold))
                            Text("Confirma tu identidad para continuar.")
                                .font(.body)
                                .foregroundStyle(.secondary)
                            Button(action: security.retryUnlock) {
                                Label("Desbloquear", systemImage: "lock.open")
                                    .frame(minWidth: 150)
                            }
                            .buttonStyle(.borderedProminent)
                        }
                        .padding(28)
                    }
                    .transition(.opacity)
                    .zIndex(1)
            }
        }
        .background(Color(uiColor: .systemBackground))
        .animation(.easeInOut(duration: 0.18), value: security.isLocked)
        .onAppear {
            security.scenePhaseDidChange(scenePhase)
        }
        .onChange(of: scenePhase) { phase in
            security.scenePhaseDidChange(phase)
        }
    }
}

private struct AbacoWebView: UIViewRepresentable {
    @ObservedObject var security: BiometricSecurity

    func makeCoordinator() -> Coordinator {
        Coordinator(security: security)
    }

    func makeUIView(context: Context) -> WKWebView {
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: "abacoSecurity")
        contentController.addUserScript(security.makeBridgeScript())

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = contentController
        configuration.websiteDataStore = .default()

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = UIColor.systemBackground
        webView.scrollView.contentInsetAdjustmentBehavior = .never

        if let url = Bundle.main.url(forResource: "index", withExtension: "html") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        } else {
            webView.loadHTMLString(
                "<html><body style='font:16px -apple-system;text-align:center;padding:40px'>No se encontró la interfaz de Ábaco.</body></html>",
                baseURL: nil
            )
        }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        private let security: BiometricSecurity

        init(security: BiometricSecurity) {
            self.security = security
        }

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard
                message.name == "abacoSecurity",
                let body = message.body as? [String: Any],
                let enabled = body["enabled"] as? Bool
            else {
                return
            }
            DispatchQueue.main.async { [weak self] in
                self?.security.setBiometricLock(enabled)
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            security.attach(webView: webView)
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }
            if url.isFileURL {
                decisionHandler(.allow)
            } else if url.scheme == "http" || url.scheme == "https" {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
            } else {
                decisionHandler(.cancel)
            }
        }
    }
}
