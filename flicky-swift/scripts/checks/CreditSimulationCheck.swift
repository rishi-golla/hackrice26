import Foundation
import AppKit
import SwiftUI

@main
struct CreditSimulationCheck {
    @MainActor static func main() async throws {
        precondition(TopicWindowIntent.parse("What subscriptions do I have?") == [.subscriptions])
        precondition(TopicWindowIntent.parse("When does Netflix renew?") == [.subscriptions])
        precondition(TopicWindowIntent.parse("How can I improve my credit score?") == [.credit])
        precondition(TopicWindowIntent.parse("What is my account balance?") == [.account])
        precondition(TopicWindowIntent.parse("Put milk and bread in my shopping cart") == [.shopping])
        precondition(TopicWindowIntent.parse("Show my account and subscriptions") == [.account, .subscriptions])
        precondition(TopicWindowIntent.parse("Don't open the credit window").isEmpty)
        precondition(TopicWindowIntent.parse("Open SoFi's website for loans").isEmpty)
        precondition(TopicWindowIntent.parse("Who won the game?").isEmpty)
        precondition(CreditBankCard.banks.count == 4)
        precondition(Set(CreditBankCard.banks.map(\.id)).count == 4)
        for bank in CreditBankCard.banks {
            precondition(bank.exampleAPR(scoreText: "850", requestedRate: nil) == bank.minimumAPR)
            precondition(bank.exampleAPR(scoreText: "300", requestedRate: nil) == bank.maximumAPR)
            precondition(bank.exampleAPR(scoreText: "720", requestedRate: nil)! > bank.exampleAPR(scoreText: "800", requestedRate: nil)!)
            for invalid in ["", "299", "851", "720.0", "abc"] {
                precondition(bank.exampleAPR(scoreText: invalid, requestedRate: nil) == nil)
            }
            precondition(bank.exampleAPR(scoreText: "720", requestedRate: 8) == 8)
        }
        let borrowing = CreditBorrowingRequest.parse("I need $8,000 for 36 months at 8 percent")
        precondition(borrowing == CreditBorrowingRequest(principalCents: 800_000, months: 36, annualRatePercent: 8))
        precondition(CreditBorrowingRequest.parse("I need eight thousand for thirty-six months")?.principalCents == 800_000)
        precondition(CreditBorrowingRequest.parse("I need eight thousand for thirty-six months")?.months == 36)
        precondition(CreditBorrowingRequest.parse("I need five thousand")?.principalCents == 500_000)
        precondition(CreditBorrowingRequest.parse("I need 5k for 3 years at 7.5%") ==
                     CreditBorrowingRequest(principalCents: 500_000, months: 36, annualRatePercent: 7.5))
        precondition(CreditBorrowingRequest.parse("Show me credit options") != nil)
        precondition(CreditBorrowingRequest.parse("A loan for 36 months") == CreditBorrowingRequest(months: 36))
        for question in ["My balance is $5,000", "Can I afford a $5,000 laptop?", "I need a laptop for $5,000",
                         "I need to save $5,000", "Don't open credit options", "Open SoFi's website for a loan"] {
            precondition(CreditBorrowingRequest.parse(question) == nil, question)
        }
        let requestStore = CreditSimulationStore()
        requestStore.borrowingRequest = borrowing
        requestStore.updateContext(accountKey: "new-account", snapshot: nil)
        precondition(requestStore.borrowingRequest == nil)
        requestStore.borrowingRequest = borrowing
        requestStore.resetSession()
        precondition(requestStore.borrowingRequest == nil)
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
        precondition(CreditDemoEntry.accepts("000-12-3456"))
        precondition(CreditDemoEntry.accepts("000123456"))
        for invalid in ["", "123-45-6789", "000-12-345", "000-12-34567", "000-ab-cdef"] {
            precondition(!CreditDemoEntry.accepts(invalid))
        }
        print("PASS: demo entry accepts only dummy numbers beginning with 000")
        if CommandLine.arguments.contains("--render") {
            _ = NSApplication.shared
            let outputDirectory = URL(fileURLWithPath: CommandLine.arguments.last!)
            try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)
            let assets = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("leanring-buddy/Assets.xcassets")
            for bank in CreditBankCard.banks {
                let folder = assets.appendingPathComponent(bank.logo + ".imageset")
                let files = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
                guard let file = files.first(where: { ["svg", "png"].contains($0.pathExtension) }),
                      let logo = NSImage(contentsOf: file) else { preconditionFailure("Missing logo: \(bank.logo)") }
                logo.setName(NSImage.Name(bank.logo))
            }
            for (name, size, populated, bank) in [("credit-empty", NSSize(width: 560, height: 650), false, "sofi"),
                ("credit-results", NSSize(width: 560, height: 650), true, "sofi"),
                ("credit-amex", NSSize(width: 560, height: 650), true, "amex"),
                ("credit-usbank", NSSize(width: 560, height: 650), true, "usbank"),
                ("credit-amex-compact", NSSize(width: 500, height: 600), true, "amex"),
                ("credit-usbank-compact", NSSize(width: 500, height: 600), true, "usbank"),
                ("credit-sofi-compact", NSSize(width: 500, height: 600), true, "sofi"),
                ("credit-wells", NSSize(width: 560, height: 650), true, "wells"),
                ("credit-compact", NSSize(width: 500, height: 600), true, "wells"),
                ("credit-request", NSSize(width: 560, height: 650), true, "sofi"),
                ("credit-request-compact", NSSize(width: 500, height: 600), true, "wells")] {
                let previewStore = CreditSimulationStore(directory: directory.appendingPathComponent(name))
                previewStore.updateContext(accountKey: "ui-fixture", snapshot: fixture)
                if populated { previewStore.run(input: input, save: false) }
                if name.hasPrefix("credit-request") { previewStore.borrowingRequest = borrowing }
                let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: false)
                let hosting = NSHostingView(rootView: CreditSimulationView(store: previewStore, onRefresh: {}, onSources: {}, onClose: {}, initiallyShowsBanks: populated, initiallySelectedBank: bank))
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
