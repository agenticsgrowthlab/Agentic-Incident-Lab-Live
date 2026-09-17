# ACH Processor Timeout Runbook
Type: Runbook

When processor timeouts rise above 5% for five minutes, stop exponential retry amplification before traffic exceeds downstream capacity. Preserve original idempotency keys and transaction correlation identifiers. Route new eligible traffic to a verified healthy processor path only after a human incident commander approves the change. Do not replay ambiguous requests until posting status is reconciled.

Monitor processor latency, error rate, retry volume, oldest queued message, dead-letter volume, and successful acknowledgements. Escalate to Payments Engineering and the processor operations contact. Customer communications should distinguish a delayed payment from a failed or duplicated payment.
