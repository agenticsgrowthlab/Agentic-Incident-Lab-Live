# Payment Idempotency and Replay Control Standard
Type: Control

Every payment initiation must carry a stable idempotency key through retries and processor handoffs. A retry may reuse the original key only when the original request represents the same business instruction. Systems must not generate a new key merely because the outcome is unknown.

Bulk replay requires documented scope, a reconciled population, an accountable approver, and an audit event recording who approved the replay. High-severity incidents require human approval before retry rules, routing, or posting behavior changes.
