import Foundation
import AppKit
import SwiftUI

@main
struct CreditSimulationCheck {
    @MainActor static func main() async throws {
        let input = try CreditSimulationInput.parse(score: "720", amount: "10000.01", income: "5000", debt: "250.50", wellsFargoCustomer: true)
        precondition(input.principalCents == 1_000_001 && input.monthlyDebtCents == 25_050)
        for score in ["299", "851", "720.5", "", "123-45-6789", "7e2"] {
            do { _ = try CreditSimulationInput.parse(score: score, amount: "10000", income: "5000", debt: "0", wellsFargoCustomer: false); preconditionFailure(score) } catch {}
        }
        for amount in ["999.99", "100000.01", "nan", "inf", "1e4", "-1000", "1000.001", "1,000", "99999999999999999"] {
            do { _ = try CreditSimulationInput.parse(score: "700", amount: amount, income: "5000", debt: "0", wellsFargoCustomer: false); preconditionFailure(amount) } catch {}
        }
        for income in ["0", "-1", "1000000.01"] {
            do { _ = try CreditSimulationInput.parse(score: "700", amount: "10000", income: income, debt: "0", wellsFargoCustomer: false); preconditionFailure(income) } catch {}
        }
        let zero = try CreditSimulationEngine.payments(principalCents: 100_000, annualRatePercent: 0, months: 36)
        precondition(zero.total == 100_000 && zero.monthly == 2778 && zero.final == 2770)
        let example = try CreditSimulationEngine.payments(principalCents: 3_000_000, annualRatePercent: 7.38, months: 36)
        precondition(example.monthly == 93153, "Matches the lender's independent $30,000 payment example")
        for rate in [Double.nan, .infinity, -1, 101] {
            do { _ = try CreditSimulationEngine.payments(principalCents: 100_000, annualRatePercent: rate, months: 36); preconditionFailure("Invalid rate") } catch {}
        }
        let fixture = FinancialInsights(balanceCents: 123456, safeToSpendCents: 40056, upcomingBills: [], expectedIncome: [],
            recentDepositsCents: 500000, recentWithdrawalsCents: 125000, accountNickname: "UI fixture", accountLast4: nil,
            accountType: nil, rewardsPoints: nil, asOf: Date())
        let context = CreditNessieContext(snapshot: fixture)
        let run = try CreditSimulationEngine.simulate(input: input, nessie: context, save: false)
        precondition(run.scenarios.count == 4 && run.reference.hasPrefix("SIM-") && run.nessie != nil)
        for scenario in run.scenarios {
            precondition(scenario.totalPaymentCents == scenario.monthlyPaymentCents * (scenario.months - 1) + scenario.finalPaymentCents)
            precondition(scenario.interestCents == scenario.totalPaymentCents - input.principalCents)
            precondition(abs(scenario.debtToIncomePercent - Double(input.monthlyDebtCents + scenario.monthlyPaymentCents) / 500000 * 100) < 0.0001)
        }
        let later = try CreditSimulationEngine.simulate(input: input, nessie: context, save: false, now: Date().addingTimeInterval(301))
        precondition(later.nessie == nil && later.scenarios == run.scenarios)
        var smaller = input; smaller.principalCents = 999_999
        let smallerRun = try CreditSimulationEngine.simulate(input: smaller, nessie: nil, save: false)
        precondition(smallerRun.scenarios.count == 3)
        var noRelationship = input; noRelationship.wellsFargoCustomer = false
        let noRelationshipRun = try CreditSimulationEngine.simulate(input: noRelationship, nessie: nil, save: false)
        precondition(noRelationshipRun.scenarios.count == 3)
        for score in 300..<850 {
            precondition(CreditSimulationEngine.modeledRate(score: score, minimum: 7.38, maximum: 35.49) >= CreditSimulationEngine.modeledRate(score: score + 1, minimum: 7.38, maximum: 35.49))
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("flicky-credit-check-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = CreditSimulationStore(directory: directory)
        store.updateContext(accountKey: "fixture-a", snapshot: fixture)
        store.run(input: input, save: false)
        precondition(!FileManager.default.fileExists(atPath: directory.path))
        store.run(input: input, save: true)
        store.select("wells-36")
        precondition(store.result?.selectedScenarioID == "wells-36")
        store.select("unknown")
        precondition(store.result?.selectedScenarioID == "wells-36")
        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        precondition(files.count == 1)
        let permissions = try FileManager.default.attributesOfItem(atPath: files[0].path)[.posixPermissions] as? NSNumber
        precondition(permissions?.intValue == 0o600)
        let savedText = try String(contentsOf: files[0], encoding: .utf8)
        precondition(!savedText.contains("fixture-a") && !savedText.lowercased().contains("ssn"))
        let restored = CreditSimulationStore(directory: directory)
        restored.updateContext(accountKey: "fixture-a", snapshot: nil)
        precondition(restored.runs.count == 1 && restored.runs[0].selectedScenarioID == "wells-36")
        restored.updateContext(accountKey: "fixture-b", snapshot: nil)
        precondition(restored.runs.isEmpty && restored.result == nil)
        restored.updateContext(accountKey: "fixture-a", snapshot: nil)
        for _ in 0..<35 { restored.run(input: input, save: true) }
        precondition(restored.runs.count == 30)
        restored.clearHistory()
        precondition(restored.runs.isEmpty && !FileManager.default.fileExists(atPath: files[0].path))
        try Data("broken".utf8).write(to: files[0])
        let corrupted = CreditSimulationStore(directory: directory)
        corrupted.updateContext(accountKey: "fixture-a", snapshot: nil)
        precondition(corrupted.runs.isEmpty && corrupted.message != nil)
        corrupted.clearHistory()
        precondition(corrupted.message == nil)
        print("PASS: input boundaries, independent amortization example, zero-rate rounding, totals, score monotonicity, lender conditions, stale evidence, selection, opt-in persistence, permissions, account isolation, history limit and corrupt-file recovery")
        if CommandLine.arguments.contains("--render") {
            _ = NSApplication.shared
            let outputDirectory = URL(fileURLWithPath: CommandLine.arguments.last!)
            try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)
            for (name, size, populated) in [("credit-empty", NSSize(width: 780, height: 820), false),
                ("credit-results", NSSize(width: 780, height: 820), true),
                ("credit-compact", NSSize(width: 640, height: 650), true)] {
                let previewStore = CreditSimulationStore(directory: directory.appendingPathComponent(name))
                previewStore.updateContext(accountKey: "ui-fixture", snapshot: fixture)
                if populated { previewStore.run(input: input, save: false) }
                let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: false)
                let hosting = NSHostingView(rootView: CreditSimulationView(store: previewStore, onRefresh: {}, onSources: {}, onClose: {}))
                hosting.sizingOptions = []
                window.contentView = hosting
                window.orderFront(nil)
                try await Task.sleep(for: .milliseconds(250))
                hosting.layoutSubtreeIfNeeded()
                precondition(hosting.bounds.size == size)
                guard let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else { preconditionFailure("No render") }
                hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
                try bitmap.representation(using: .png, properties: [:])!.write(to: outputDirectory.appendingPathComponent(name + ".png"))
                window.orderOut(nil)
            }
            print("PASS: native fixture renders at standard and compact panel sizes")
        }
    }
}
