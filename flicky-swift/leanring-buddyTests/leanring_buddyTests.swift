//
//  leanring_buddyTests.swift
//  leanring-buddyTests
//
//  Created by thorfinn on 3/2/26.
//

import Testing
@testable import leanring_buddy

struct leanring_buddyTests {

    @Test func firstPermissionRequestUsesSystemPromptOnly() async throws {
        let presentationDestination = WindowPositionManager.permissionRequestPresentationDestination(
            hasPermissionNow: false,
            hasAttemptedSystemPrompt: false
        )

        #expect(presentationDestination == .systemPrompt)
    }

    @Test func repeatedPermissionRequestOpensSystemSettings() async throws {
        let presentationDestination = WindowPositionManager.permissionRequestPresentationDestination(
            hasPermissionNow: false,
            hasAttemptedSystemPrompt: true
        )

        #expect(presentationDestination == .systemSettings)
    }

    @Test func knownGrantedScreenRecordingPermissionSkipsTheGate() async throws {
        let shouldTreatPermissionAsGranted = WindowPositionManager.shouldTreatScreenRecordingPermissionAsGrantedForSessionLaunch(
            hasScreenRecordingPermissionNow: false,
            hasPreviouslyConfirmedScreenRecordingPermission: true
        )

        #expect(shouldTreatPermissionAsGranted)
    }

    @Test func simulationChargesOneTimePurchaseAndPreservesBaselineGoal() async throws {
        let profile = SimulationProfile(
            id: "test",
            displayName: "Test User",
            archetype: "Steady Saver",
            monthlyIncomeCents: 100_000,
            monthlyEssentialCents: 30_000,
            monthlyDiscretionaryCents: 50_000,
            liquidSavingsCents: 0,
            openingBalanceCents: 0,
            closingBalanceCents: 0,
            transactions: []
        )

        let projection = NessieSimulationCalculator.projection(
            for: profile,
            purchaseCents: 18_000,
            discretionaryReductionCents: 0,
            goalCents: 60_000
        )

        #expect(profile.monthlySurplusCents == 20_000)
        #expect(projection.baselineGoalMonth == 3)
        #expect(projection.scenarioGoalMonth == 4)
        #expect(projection.baselineEndBalanceCents == 60_000)
        #expect(projection.scenarioEndBalanceCents == 42_000)
    }

    @Test func simulationClampsMonthlyReductionToDiscretionarySpending() async throws {
        let profile = SimulationProfile(
            id: "test",
            displayName: "Test User",
            archetype: "Steady Saver",
            monthlyIncomeCents: 100_000,
            monthlyEssentialCents: 30_000,
            monthlyDiscretionaryCents: 50_000,
            liquidSavingsCents: 100_000,
            openingBalanceCents: 100_000,
            closingBalanceCents: 100_000,
            transactions: []
        )

        let projection = NessieSimulationCalculator.projection(
            for: profile,
            purchaseCents: 0,
            discretionaryReductionCents: 80_000,
            goalCents: 0
        )

        #expect(projection.effectiveReductionCents == 50_000)
        #expect(projection.scenarioMonthlySurplusCents == 70_000)
    }

    @Test func percentileUsesMidpointForTies() async throws {
        let percentile = NessieSimulationCalculator.percentile(value: 20, among: [10, 20, 20, 30])
        #expect(percentile == 37.5)
    }

    @Test func undefinedMetricDenominatorsStayUndefined() async throws {
        let profile = SimulationProfile(
            id: "edge",
            displayName: "Edge Case",
            archetype: "No Income",
            monthlyIncomeCents: 0,
            monthlyEssentialCents: 0,
            monthlyDiscretionaryCents: 10_000,
            liquidSavingsCents: -5_000,
            openingBalanceCents: -5_000,
            closingBalanceCents: -5_000,
            transactions: []
        )

        let metrics = NessieSimulationCalculator.metrics(for: profile)
        #expect(metrics.monthlySurplusCents == -10_000)
        #expect(metrics.savingsRate == nil)
        #expect(metrics.emergencyCoverageMonths == nil)
    }

}
