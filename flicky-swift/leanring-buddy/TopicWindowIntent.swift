import Foundation

/// Local presentation intent; does not authorize payments, applications, or cancellation.
enum TopicWindowIntent: Hashable {
    case subscriptions, credit, account, shopping

    static func parse(_ question: String) -> Set<Self> {
        let text = question.lowercased().replacingOccurrences(of: "’", with: "'")
        func matches(_ pattern: String) -> Bool { text.range(of: pattern, options: .regularExpression) != nil }
        guard !matches(#"\b(don't|do not|never)\s+(?:\w+\s+){0,3}(open|show|display|bring|pop)\b"#),
              !matches(#"\b(open|visit|navigate|go to)\b.*\b(website|site|https|sofi|wells fargo)\b"#) else { return [] }
        var result = Set<Self>()
        if matches(#"\b(subscriptions?|subscribed|renewals?|recurring charges|netflix|spotify|icloud|hulu|disney plus)\b"#) { result.insert(.subscriptions) }
        if matches(#"\b(credit|loans?|borrowing|borrow|financing|apr)\b"#) || CreditBorrowingRequest.parse(question) != nil {
            result.insert(.credit)
        }
        if matches(#"\b(my|our|the)\s+(bank\s+|checking\s+|savings\s+)?(accounts?|balance|dashboard)\b|\b(account overview|account dashboard|safe to spend)\b"#) {
            result.insert(.account)
        }
        if matches(#"\b(shopping cart|shopping basket|cart|basket|shopping list)\b"#) { result.insert(.shopping) }
        return result
    }
}
