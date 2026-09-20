from __future__ import annotations

import os
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import psycopg
from ach_return_catalog import ACH_RETURN_CODES
from ach_failure_catalog import ACH_FAILURE_CASES
from nacha_preflight import validate_nacha_bytes
from fastapi import APIRouter, File, HTTPException, UploadFile
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

router = APIRouter(prefix="/api/operations", tags=["operations"])


def _database_url() -> str:
    value = os.getenv("DATABASE_URL")
    if not value:
        raise RuntimeError("DATABASE_URL is not configured")
    return value


def _ensure_schema() -> None:
    with psycopg.connect(_database_url(), autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS operations_credit_unions (
                    id text PRIMARY KEY,
                    name text NOT NULL,
                    routing_number text,
                    status text NOT NULL DEFAULT 'active',
                    created_at timestamptz NOT NULL DEFAULT now()
                );

                CREATE TABLE IF NOT EXISTS ach_files (
                    id text PRIMARY KEY,
                    credit_union_id text NOT NULL REFERENCES operations_credit_unions(id),
                    file_id text NOT NULL,
                    effective_date date NOT NULL,
                    status text NOT NULL,
                    received_at timestamptz,
                    acknowledged_at timestamptz,
                    created_at timestamptz NOT NULL DEFAULT now()
                );

                CREATE TABLE IF NOT EXISTS ach_batches (
                    id text PRIMARY KEY,
                    file_id text NOT NULL REFERENCES ach_files(id),
                    batch_number integer NOT NULL,
                    sec_code text NOT NULL,
                    company_name text,
                    entry_count integer NOT NULL DEFAULT 0,
                    debit_total numeric(18,2) NOT NULL DEFAULT 0,
                    credit_total numeric(18,2) NOT NULL DEFAULT 0,
                    status text NOT NULL,
                    created_at timestamptz NOT NULL DEFAULT now()
                );

                CREATE TABLE IF NOT EXISTS ach_transactions (
                    id text PRIMARY KEY,
                    scenario text NOT NULL,
                    credit_union_id text NOT NULL REFERENCES operations_credit_unions(id),
                    file_id text REFERENCES ach_files(id),
                    batch_id text REFERENCES ach_batches(id),
                    trace_number text NOT NULL UNIQUE,
                    direction text NOT NULL,
                    amount numeric(18,2) NOT NULL,
                    sec_code text NOT NULL,
                    effective_date date NOT NULL,
                    odfi_routing text,
                    rdfi_routing text,
                    member_reference text,
                    current_stage text NOT NULL,
                    status text NOT NULL,
                    processor_code text,
                    processor_message text,
                    retry_count integer NOT NULL DEFAULT 0,
                    posting_status text NOT NULL,
                    settlement_status text NOT NULL,
                    reconciliation_status text NOT NULL,
                    return_code text,
                    queued_at timestamptz,
                    completed_at timestamptz,
                    created_at timestamptz NOT NULL DEFAULT now(),
                    updated_at timestamptz NOT NULL DEFAULT now()
                );

                CREATE TABLE IF NOT EXISTS ach_transaction_events (
                    id bigserial PRIMARY KEY,
                    transaction_id text NOT NULL REFERENCES ach_transactions(id) ON DELETE CASCADE,
                    sequence integer NOT NULL,
                    stage text NOT NULL,
                    status text NOT NULL,
                    event_time timestamptz NOT NULL,
                    source_system text,
                    correlation_id text,
                    response_code text,
                    message text,
                    raw_payload jsonb,
                    UNIQUE(transaction_id, sequence)
                );

                CREATE TABLE IF NOT EXISTS ach_reconciliation (
                    id text PRIMARY KEY,
                    transaction_id text NOT NULL REFERENCES ach_transactions(id) ON DELETE CASCADE,
                    expected_amount numeric(18,2) NOT NULL,
                    posted_amount numeric(18,2),
                    difference_amount numeric(18,2) NOT NULL DEFAULT 0,
                    status text NOT NULL,
                    reconciled_at timestamptz,
                    reason text,
                    created_at timestamptz NOT NULL DEFAULT now()
                );

                CREATE TABLE IF NOT EXISTS ach_returns (
                    id text PRIMARY KEY,
                    transaction_id text NOT NULL REFERENCES ach_transactions(id) ON DELETE CASCADE,
                    return_code text NOT NULL,
                    return_reason text,
                    received_at timestamptz NOT NULL,
                    status text NOT NULL,
                    created_at timestamptz NOT NULL DEFAULT now()
                );




                CREATE TABLE IF NOT EXISTS ach_preflight_runs (
                    id text PRIMARY KEY,
                    filename text NOT NULL,
                    sha256 text NOT NULL,
                    passed boolean NOT NULL,
                    error_count integer NOT NULL,
                    warning_count integer NOT NULL,
                    result jsonb NOT NULL,
                    created_at timestamptz NOT NULL DEFAULT now()
                );

                CREATE TABLE IF NOT EXISTS synthetic_accounts (
                    id text PRIMARY KEY,
                    credit_union_id text NOT NULL REFERENCES operations_credit_unions(id),
                    account_token text NOT NULL UNIQUE,
                    account_type text NOT NULL,
                    status text NOT NULL,
                    available_balance numeric(18,2) NOT NULL DEFAULT 0,
                    collected_balance numeric(18,2) NOT NULL DEFAULT 0,
                    accepts_ach boolean NOT NULL DEFAULT true,
                    authorization_state text NOT NULL DEFAULT 'ACTIVE',
                    stop_payment boolean NOT NULL DEFAULT false,
                    synthetic boolean NOT NULL DEFAULT true,
                    created_at timestamptz NOT NULL DEFAULT now(),
                    updated_at timestamptz NOT NULL DEFAULT now()
                );

                CREATE TABLE IF NOT EXISTS ach_preflight_cases (
                    id text PRIMARY KEY,
                    category text NOT NULL,
                    subtype text NOT NULL,
                    case_name text NOT NULL,
                    expected_resolution text NOT NULL,
                    case_status text NOT NULL DEFAULT 'OPEN',
                    synthetic boolean NOT NULL DEFAULT true,
                    created_at timestamptz NOT NULL DEFAULT now(),
                    updated_at timestamptz NOT NULL DEFAULT now()
                );

                CREATE TABLE IF NOT EXISTS ach_return_code_catalog (
                    code text PRIMARY KEY,
                    title text NOT NULL,
                    category text NOT NULL,
                    active_2026 boolean NOT NULL DEFAULT true,
                    effective_date date,
                    source_scope text NOT NULL DEFAULT 'Nacha return reason code'
                );

                CREATE TABLE IF NOT EXISTS ach_failure_cases (
                    id text PRIMARY KEY,
                    return_code text NOT NULL REFERENCES ach_return_code_catalog(code),
                    case_name text NOT NULL,
                    case_status text NOT NULL DEFAULT 'OPEN',
                    operational_state text NOT NULL DEFAULT 'RETURNED',
                    payment_outcome text NOT NULL DEFAULT 'RETURNED',
                    remediation_state text NOT NULL DEFAULT 'UNRESOLVED',
                    synthetic boolean NOT NULL DEFAULT true,
                    notes text,
                    created_at timestamptz NOT NULL DEFAULT now(),
                    updated_at timestamptz NOT NULL DEFAULT now()
                );

                CREATE TABLE IF NOT EXISTS operations_scenario_snapshots (
                    scenario text PRIMARY KEY,
                    overall_status text NOT NULL,
                    success_rate numeric(6,2) NOT NULL,
                    transaction_count integer NOT NULL,
                    processed_volume numeric(18,2) NOT NULL,
                    reconciliation_rate numeric(6,2) NOT NULL,
                    unreconciled_count integer NOT NULL,
                    unreconciled_amount numeric(18,2) NOT NULL,
                    pending_count integer NOT NULL,
                    failed_count integer NOT NULL,
                    oldest_pending_minutes integer NOT NULL,
                    example_transaction_id text NOT NULL REFERENCES ach_transactions(id),
                    updated_at timestamptz NOT NULL DEFAULT now()
                );
                """
            )


def _seed_data() -> dict[str, dict[str, Any]]:
    return {
        "healthy": {
            "cu": ("cu-pacific", "Pacific Community CU", "091000019"),
            "tx": "ACH-HEALTHY-1000",
            "trace": "091000012609191042",
            "status": "completed",
            "stage": "reconciliation",
            "processor_code": "00",
            "processor_message": "Accepted",
            "retry_count": 0,
            "posting": "posted",
            "settlement": "settled",
            "reconciliation": "balanced",
            "overall": "HEALTHY",
            "success": Decimal("99.84"),
            "count": 1245,
            "volume": Decimal("3820000.00"),
            "recon_rate": Decimal("99.60"),
            "unreconciled": 5,
            "unreconciled_amount": Decimal("12480.00"),
            "pending": 3,
            "failed": 2,
            "oldest": 4,
            "events": [
                (1, "channel", "received", "10:14:02", "Digital Banking", None, "Payment instruction received"),
                (2, "payment_platform", "validated", "10:14:03", "Payments Platform", "VAL-200", "Schema and account validations passed"),
                (3, "processor", "accepted", "10:14:04", "Processor", "00", "Processor accepted instruction"),
                (4, "odfi", "submitted", "10:14:08", "ODFI Gateway", "ACK", "Submitted to originating institution"),
                (5, "ach_operator", "delivered", "10:14:41", "ACH Operator", "ACK", "Entry delivered"),
                (6, "rdfi", "accepted", "10:15:07", "RDFI", "ACK", "Receiving institution accepted entry"),
                (7, "posting", "posted", "10:15:12", "Core", "POSTED", "Member account posted"),
                (8, "reconciliation", "balanced", "10:17:30", "Reconciliation", "MATCH", "Expected and posted amounts matched"),
            ],
        },
        "watch": {
            "cu": ("cu-coastal", "Coastal Federal CU", "322271724"),
            "tx": "ACH-WATCH-1000",
            "trace": "091000012609191188",
            "status": "delayed",
            "stage": "posting",
            "processor_code": "TMO",
            "processor_message": "Processor timeout; recovered after retry",
            "retry_count": 2,
            "posting": "pending",
            "settlement": "submitted",
            "reconciliation": "pending",
            "overall": "WATCH",
            "success": Decimal("96.42"),
            "count": 1318,
            "volume": Decimal("4110000.00"),
            "recon_rate": Decimal("97.18"),
            "unreconciled": 37,
            "unreconciled_amount": Decimal("86940.00"),
            "pending": 41,
            "failed": 12,
            "oldest": 29,
            "events": [
                (1, "channel", "received", "11:03:12", "Digital Banking", None, "Payment instruction received"),
                (2, "payment_platform", "validated", "11:03:13", "Payments Platform", "VAL-200", "Validation passed"),
                (3, "processor", "timeout", "11:04:13", "Processor", "TMO", "No acknowledgement within timeout window"),
                (4, "processor", "retry", "11:04:43", "Processor", "RETRY-1", "Automatic retry initiated"),
                (5, "processor", "retry", "11:05:44", "Processor", "RETRY-2", "Second retry initiated"),
                (6, "processor", "accepted", "11:06:11", "Processor", "00", "Instruction accepted after retry"),
                (7, "odfi", "submitted", "11:08:10", "ODFI Gateway", "ACK", "Submitted downstream"),
                (8, "ach_operator", "delivered", "11:09:02", "ACH Operator", "ACK", "Entry delivered"),
                (9, "rdfi", "accepted", "11:09:27", "RDFI", "ACK", "Entry accepted"),
                (10, "posting", "pending", "11:10:00", "Core", "PENDING", "Awaiting core posting confirmation"),
                (11, "reconciliation", "waiting", "11:10:01", "Reconciliation", "WAIT", "Cannot reconcile until posting confirms"),
            ],
        },
        "critical": {
            "cu": ("cu-summit", "Summit Credit Union", "322275261"),
            "tx": "ACH-CRITICAL-1000",
            "trace": "091000012609191297",
            "status": "failed",
            "stage": "processor",
            "processor_code": "TMO",
            "processor_message": "No acknowledgement after retry ceiling",
            "retry_count": 4,
            "posting": "blocked",
            "settlement": "not_settled",
            "reconciliation": "unreconciled",
            "overall": "CRITICAL",
            "success": Decimal("81.60"),
            "count": 1406,
            "volume": Decimal("4480000.00"),
            "recon_rate": Decimal("84.21"),
            "unreconciled": 222,
            "unreconciled_amount": Decimal("614380.00"),
            "pending": 184,
            "failed": 96,
            "oldest": 71,
            "events": [
                (1, "channel", "received", "12:16:04", "Digital Banking", None, "Payment instruction received"),
                (2, "payment_platform", "validated", "12:16:05", "Payments Platform", "VAL-200", "Validation passed"),
                (3, "processor", "timeout", "12:17:05", "Processor", "TMO", "No acknowledgement within timeout window"),
                (4, "processor", "retry", "12:17:35", "Processor", "RETRY-1", "Retry 1 initiated"),
                (5, "processor", "timeout", "12:18:35", "Processor", "TMO", "Retry 1 timed out"),
                (6, "processor", "retry", "12:19:05", "Processor", "RETRY-2", "Retry 2 initiated"),
                (7, "processor", "timeout", "12:20:05", "Processor", "TMO", "Retry 2 timed out"),
                (8, "processor", "failed", "12:20:31", "Processor", "RETRY-LIMIT", "Retry ceiling reached; transaction failed"),
                (9, "odfi", "not_sent", "12:20:31", "ODFI Gateway", "BLOCKED", "Submission blocked because processor did not accept transaction"),
                (10, "posting", "blocked", "12:20:32", "Core", "BLOCKED", "No accepted transaction to post"),
                (11, "reconciliation", "unbalanced", "12:20:32", "Reconciliation", "EXCEPTION", "Expected payment cannot be matched to a posted transaction"),
            ],
        },
    }


def _seed() -> None:
    _ensure_schema()
    base_date = datetime(2026, 9, 19, tzinfo=timezone.utc)

    with psycopg.connect(_database_url(), autocommit=True) as conn:
        with conn.cursor() as cur:
            # Synthetic account states used by the end-to-end banking simulator.
            synthetic_accounts = [
                ("acct-good", "cu-pacific", "PACIFIC-CHK-001", "checking", "OPEN", 5000, 5000, True, "ACTIVE", False),
                ("acct-low-funds", "cu-pacific", "PACIFIC-CHK-LOW", "checking", "OPEN", 50, 50, True, "ACTIVE", False),
                ("acct-uncollected", "cu-pacific", "PACIFIC-CHK-UNC", "checking", "OPEN", 1000, 25, True, "ACTIVE", False),
                ("acct-closed", "cu-coastal", "COASTAL-CHK-CLOSED", "checking", "CLOSED", 0, 0, False, "ACTIVE", False),
                ("acct-frozen", "cu-coastal", "COASTAL-CHK-FROZEN", "checking", "FROZEN", 2500, 2500, False, "ACTIVE", False),
                ("acct-nontransaction", "cu-summit", "SUMMIT-NONTRAN-001", "non_transaction", "OPEN", 10000, 10000, False, "ACTIVE", False),
                ("acct-stop", "cu-summit", "SUMMIT-CHK-STOP", "checking", "OPEN", 3200, 3200, True, "ACTIVE", True),
                ("acct-revoked", "cu-summit", "SUMMIT-CHK-REVOKED", "checking", "OPEN", 3200, 3200, True, "REVOKED", False),
            ]
            for row in synthetic_accounts:
                cur.execute(
                    """INSERT INTO synthetic_accounts
                    (id,credit_union_id,account_token,account_type,status,available_balance,collected_balance,
                     accepts_ach,authorization_state,stop_payment)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (id) DO UPDATE SET
                      status=EXCLUDED.status,
                      available_balance=EXCLUDED.available_balance,
                      collected_balance=EXCLUDED.collected_balance,
                      accepts_ach=EXCLUDED.accepts_ach,
                      authorization_state=EXCLUDED.authorization_state,
                      stop_payment=EXCLUDED.stop_payment,
                      updated_at=now()""",
                    row,
                )

            for item in ACH_FAILURE_CASES:
                cur.execute(
                    """INSERT INTO ach_preflight_cases
                    (id,category,subtype,case_name,expected_resolution)
                    VALUES (%s,%s,%s,%s,%s)
                    ON CONFLICT (id) DO UPDATE SET
                      category=EXCLUDED.category,
                      subtype=EXCLUDED.subtype,
                      case_name=EXCLUDED.case_name,
                      expected_resolution=EXCLUDED.expected_resolution,
                      updated_at=now()""",
                    (
                        item["id"],
                        item["category"],
                        item["subtype"],
                        item["name"],
                        item["expected_resolution"],
                    ),
                )

            for item in ACH_RETURN_CODES:
                cur.execute(
                    """INSERT INTO ach_return_code_catalog
                    (code,title,category,active_2026,effective_date)
                    VALUES (%s,%s,%s,%s,%s)
                    ON CONFLICT (code) DO UPDATE SET
                      title=EXCLUDED.title,
                      category=EXCLUDED.category,
                      active_2026=EXCLUDED.active_2026,
                      effective_date=EXCLUDED.effective_date""",
                    (
                        item["code"],
                        item["title"],
                        item["category"],
                        item.get("active_2026", True),
                        item.get("effective_date"),
                    ),
                )
                cur.execute(
                    """INSERT INTO ach_failure_cases
                    (id,return_code,case_name,case_status,operational_state,payment_outcome,remediation_state,synthetic,notes)
                    VALUES (%s,%s,%s,'OPEN','RETURNED','RETURNED','UNRESOLVED',true,%s)
                    ON CONFLICT (id) DO UPDATE SET
                      case_name=EXCLUDED.case_name,
                      notes=EXCLUDED.notes""",
                    (
                        f"CASE-{item['code']}",
                        item["code"],
                        f"{item['code']} · {item['title']}",
                        (
                            "Synthetic training case for current 2026 Nacha return reason code."
                            if item.get("active_2026", True)
                            else f"Future training case; effective {item.get('effective_date')}."
                        ),
                    ),
                )

            for scenario, data in _seed_data().items():
                cu_id, cu_name, routing = data["cu"]
                file_pk = f"FILE-{scenario.upper()}"
                batch_pk = f"BATCH-{scenario.upper()}"
                tx_id = data["tx"]

                cur.execute(
                    """INSERT INTO operations_credit_unions(id,name,routing_number)
                    VALUES (%s,%s,%s)
                    ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,routing_number=EXCLUDED.routing_number""",
                    (cu_id, cu_name, routing),
                )
                cur.execute(
                    """INSERT INTO ach_files(id,credit_union_id,file_id,effective_date,status,received_at,acknowledged_at)
                    VALUES (%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, acknowledged_at=EXCLUDED.acknowledged_at""",
                    (
                        file_pk,
                        cu_id,
                        f"SIM-{scenario.upper()}-260919",
                        base_date.date(),
                        "accepted" if scenario != "critical" else "exception",
                        base_date,
                        base_date,
                    ),
                )
                cur.execute(
                    """INSERT INTO ach_batches(id,file_id,batch_number,sec_code,company_name,entry_count,credit_total,status)
                    VALUES (%s,%s,1,'PPD','MEMBER PAYMENTS',1,1000,%s)
                    ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status""",
                    (batch_pk, file_pk, "processed" if scenario == "healthy" else "attention"),
                )
                cur.execute(
                    """INSERT INTO ach_transactions
                    (id,scenario,credit_union_id,file_id,batch_id,trace_number,direction,amount,sec_code,effective_date,
                     odfi_routing,rdfi_routing,member_reference,current_stage,status,processor_code,processor_message,
                     retry_count,posting_status,settlement_status,reconciliation_status,queued_at,completed_at,updated_at)
                    VALUES (%s,%s,%s,%s,%s,%s,'credit',1000,'PPD',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now())
                    ON CONFLICT (id) DO UPDATE SET
                     current_stage=EXCLUDED.current_stage,status=EXCLUDED.status,processor_code=EXCLUDED.processor_code,
                     processor_message=EXCLUDED.processor_message,retry_count=EXCLUDED.retry_count,
                     posting_status=EXCLUDED.posting_status,settlement_status=EXCLUDED.settlement_status,
                     reconciliation_status=EXCLUDED.reconciliation_status,updated_at=now()""",
                    (
                        tx_id,
                        scenario,
                        cu_id,
                        file_pk,
                        batch_pk,
                        data["trace"],
                        base_date.date(),
                        routing,
                        "121000358",
                        f"SIM-{scenario.upper()}-MEMBER-001",
                        data["stage"],
                        data["status"],
                        data["processor_code"],
                        data["processor_message"],
                        data["retry_count"],
                        data["posting"],
                        data["settlement"],
                        data["reconciliation"],
                        base_date,
                        base_date if scenario == "healthy" else None,
                    ),
                )

                cur.execute("DELETE FROM ach_transaction_events WHERE transaction_id=%s", (tx_id,))
                for seq, stage, status, hhmmss, source, code, message in data["events"]:
                    event_time = datetime.fromisoformat(f"2026-09-19T{hhmmss}+00:00")
                    cur.execute(
                        """INSERT INTO ach_transaction_events
                        (transaction_id,sequence,stage,status,event_time,source_system,correlation_id,response_code,message)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (
                            tx_id,
                            seq,
                            stage,
                            status,
                            event_time,
                            source,
                            f"corr-{scenario}-{seq:02d}",
                            code,
                            message,
                        ),
                    )

                cur.execute(
                    """INSERT INTO ach_reconciliation
                    (id,transaction_id,expected_amount,posted_amount,difference_amount,status,reconciled_at,reason)
                    VALUES (%s,%s,1000,%s,%s,%s,%s,%s)
                    ON CONFLICT (id) DO UPDATE SET
                      posted_amount=EXCLUDED.posted_amount,
                      difference_amount=EXCLUDED.difference_amount,
                      status=EXCLUDED.status,
                      reason=EXCLUDED.reason""",
                    (
                        f"RECON-{scenario.upper()}",
                        tx_id,
                        Decimal("1000.00") if scenario == "healthy" else None,
                        Decimal("0.00") if scenario == "healthy" else Decimal("1000.00"),
                        "balanced" if scenario == "healthy" else ("pending" if scenario == "watch" else "exception"),
                        base_date if scenario == "healthy" else None,
                        None
                        if scenario == "healthy"
                        else ("Waiting for posting confirmation" if scenario == "watch" else "Processor failure prevented posting"),
                    ),
                )

                cur.execute(
                    """INSERT INTO operations_scenario_snapshots
                    (scenario,overall_status,success_rate,transaction_count,processed_volume,reconciliation_rate,
                     unreconciled_count,unreconciled_amount,pending_count,failed_count,oldest_pending_minutes,
                     example_transaction_id,updated_at)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now())
                    ON CONFLICT (scenario) DO UPDATE SET
                     overall_status=EXCLUDED.overall_status,
                     success_rate=EXCLUDED.success_rate,
                     transaction_count=EXCLUDED.transaction_count,
                     processed_volume=EXCLUDED.processed_volume,
                     reconciliation_rate=EXCLUDED.reconciliation_rate,
                     unreconciled_count=EXCLUDED.unreconciled_count,
                     unreconciled_amount=EXCLUDED.unreconciled_amount,
                     pending_count=EXCLUDED.pending_count,
                     failed_count=EXCLUDED.failed_count,
                     oldest_pending_minutes=EXCLUDED.oldest_pending_minutes,
                     example_transaction_id=EXCLUDED.example_transaction_id,
                     updated_at=now()""",
                    (
                        scenario,
                        data["overall"],
                        data["success"],
                        data["count"],
                        data["volume"],
                        data["recon_rate"],
                        data["unreconciled"],
                        data["unreconciled_amount"],
                        data["pending"],
                        data["failed"],
                        data["oldest"],
                        tx_id,
                    ),
                )


def _jsonify(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def _row_json(row: dict[str, Any]) -> dict[str, Any]:
    return {key: _jsonify(value) for key, value in row.items()}


@router.post("/seed")
def seed_operations() -> dict[str, Any]:
    try:
        _seed()
        return {"status": "seeded", "scenarios": ["healthy", "watch", "critical"]}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


@router.get("/scenario/{scenario}")
def get_scenario(scenario: str) -> dict[str, Any]:
    if scenario not in {"healthy", "watch", "critical"}:
        raise HTTPException(status_code=404, detail="Unknown scenario")
    try:
        _seed()
        with psycopg.connect(_database_url(), row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT s.*, cu.name AS credit_union_name, t.trace_number, t.amount,
                              t.status AS transaction_status, t.current_stage, t.posting_status,
                              t.settlement_status, t.reconciliation_status, t.processor_code,
                              t.processor_message, t.retry_count
                       FROM operations_scenario_snapshots s
                       JOIN ach_transactions t ON t.id=s.example_transaction_id
                       JOIN operations_credit_unions cu ON cu.id=t.credit_union_id
                       WHERE s.scenario=%s""",
                    (scenario,),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(status_code=404, detail="Scenario not seeded")
                return _row_json(row)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


@router.get("/transactions/{transaction_id}")
def get_transaction(transaction_id: str) -> dict[str, Any]:
    try:
        _seed()
        with psycopg.connect(_database_url(), row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT t.*, cu.name AS credit_union_name, f.file_id AS ach_file_identifier,
                              b.batch_number, b.company_name,
                              r.expected_amount, r.posted_amount, r.difference_amount,
                              r.status AS recon_record_status, r.reason AS recon_reason
                       FROM ach_transactions t
                       JOIN operations_credit_unions cu ON cu.id=t.credit_union_id
                       LEFT JOIN ach_files f ON f.id=t.file_id
                       LEFT JOIN ach_batches b ON b.id=t.batch_id
                       LEFT JOIN ach_reconciliation r ON r.transaction_id=t.id
                       WHERE t.id=%s""",
                    (transaction_id,),
                )
                tx = cur.fetchone()
                if not tx:
                    raise HTTPException(status_code=404, detail="Transaction not found")

                cur.execute(
                    """SELECT sequence,stage,status,event_time,source_system,correlation_id,response_code,message
                       FROM ach_transaction_events
                       WHERE transaction_id=%s
                       ORDER BY sequence""",
                    (transaction_id,),
                )
                events = [_row_json(row) for row in cur.fetchall()]
                return {"transaction": _row_json(tx), "events": events}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


@router.get("/return-codes")
def list_return_codes() -> dict[str, Any]:
    try:
        _seed()
        with psycopg.connect(_database_url(), row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT c.code,c.title,c.category,c.active_2026,c.effective_date,
                              f.id AS failure_case_id,f.case_status,f.payment_outcome,f.remediation_state
                       FROM ach_return_code_catalog c
                       LEFT JOIN ach_failure_cases f ON f.return_code=c.code
                       ORDER BY
                         CASE WHEN c.code='R90' THEN 999 ELSE substring(c.code from 2)::int END"""
                )
                rows = [_row_json(r) for r in cur.fetchall()]
                return {
                    "active_2026_count": sum(1 for r in rows if r["active_2026"]),
                    "future_count": sum(1 for r in rows if not r["active_2026"]),
                    "return_codes": rows,
                }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


@router.get("/failure-lab")
def list_failure_lab() -> dict[str, Any]:
    try:
        _seed()
        with psycopg.connect(_database_url(), row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT id,category,subtype,case_name,expected_resolution,case_status
                       FROM ach_preflight_cases
                       ORDER BY category, subtype, id"""
                )
                cases = [_row_json(r) for r in cur.fetchall()]
                cur.execute(
                    """SELECT id,credit_union_id,account_token,account_type,status,
                              available_balance,collected_balance,accepts_ach,
                              authorization_state,stop_payment
                       FROM synthetic_accounts
                       ORDER BY id"""
                )
                accounts = [_row_json(r) for r in cur.fetchall()]
                return {
                    "failure_case_count": len(cases),
                    "failure_cases": cases,
                    "synthetic_accounts": accounts,
                }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


@router.post("/reset-lab")
def reset_failure_lab() -> dict[str, Any]:
    """Reset the synthetic ACH operations lab back to its original red/open training state."""
    try:
        _ensure_schema()
        with psycopg.connect(_database_url(), autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute("UPDATE ach_preflight_cases SET case_status='OPEN', updated_at=now()")
                cur.execute(
                    """UPDATE ach_failure_cases
                       SET case_status='OPEN',
                           operational_state='RETURNED',
                           payment_outcome='RETURNED',
                           remediation_state='UNRESOLVED',
                           updated_at=now()"""
                )
                cur.execute("DELETE FROM ach_returns")
                cur.execute("DELETE FROM ach_reconciliation")
                cur.execute("DELETE FROM ach_transaction_events")
                cur.execute("DELETE FROM operations_scenario_snapshots")
                cur.execute("DELETE FROM ach_transactions")
                cur.execute("DELETE FROM ach_batches")
                cur.execute("DELETE FROM ach_files")

        _seed()
        return {
            "status": "reset",
            "message": "Failure Lab restored to its original training state.",
            "active_return_cases": 70,
            "future_return_cases": 1,
            "additional_failure_cases": len(ACH_FAILURE_CASES),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


@router.post("/preflight")
async def preflight_nacha_file(file: UploadFile = File(...)) -> dict[str, Any]:
    """Dry-run a Nacha file. No network transmission and no account posting occurs."""
    try:
        raw = await file.read()
        if not raw:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")
        if len(raw) > 5 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Preflight file exceeds the 5 MB lab limit")

        result = validate_nacha_bytes(raw, file.filename or "uploaded.ach")
        _ensure_schema()
        with psycopg.connect(_database_url(), autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO ach_preflight_runs
                    (id,filename,sha256,passed,error_count,warning_count,result)
                    VALUES (%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (id) DO NOTHING""",
                    (
                        result["run_id"],
                        result["filename"],
                        result["sha256"],
                        result["passed"],
                        len(result["errors"]),
                        len(result["warnings"]),
                        Jsonb(result),
                    ),
                )
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc


@router.get("/preflight/history")
def preflight_history() -> list[dict[str, Any]]:
    try:
        _ensure_schema()
        with psycopg.connect(_database_url(), row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT id,filename,sha256,passed,error_count,warning_count,created_at
                       FROM ach_preflight_runs
                       ORDER BY created_at DESC
                       LIMIT 50"""
                )
                return [_row_json(row) for row in cur.fetchall()]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{type(exc).__name__}: {exc}") from exc
