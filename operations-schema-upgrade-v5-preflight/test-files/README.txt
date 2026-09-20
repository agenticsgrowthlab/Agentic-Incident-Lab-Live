Synthetic ACH preflight files. They contain no real customer account data and must not be transmitted to a live ACH network.

01-valid-synthetic-ach.ach — expected PASS
02-error-invalid-routing-check-digit.ach — expected FAIL: ROUTING_CHECK_DIGIT
03-error-batch-credit-total-mismatch.ach — expected FAIL: BATCH_CREDIT_TOTAL
