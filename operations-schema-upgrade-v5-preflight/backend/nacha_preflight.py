from __future__ import annotations

import hashlib
import re
import uuid
from datetime import datetime, timezone
from typing import Any

COMMON_SEC_CODES = {
    "ARC","BOC","CCD","CIE","CTX","IAT","MTE","POP","POS","PPD","RCK","SHR","TEL","WEB","XCK"
}
CREDIT_CODES = {"21","22","23","24","31","32","33","34","41","42","43","44","51","52","53","54"}
DEBIT_CODES = {"26","27","28","29","36","37","38","39","46","47","48","49","55","56"}
VALID_TRANSACTION_CODES = CREDIT_CODES | DEBIT_CODES


def _issue(level: str, code: str, message: str, *, line: int | None = None,
           field: str | None = None, expected: str | None = None,
           actual: str | None = None) -> dict[str, Any]:
    return {
        "level": level,
        "code": code,
        "message": message,
        "line": line,
        "field": field,
        "expected": expected,
        "actual": actual,
    }


def _routing_valid(routing: str) -> bool:
    if not re.fullmatch(r"\d{9}", routing):
        return False
    digits = [int(x) for x in routing]
    return (
        3 * (digits[0] + digits[3] + digits[6])
        + 7 * (digits[1] + digits[4] + digits[7])
        + (digits[2] + digits[5] + digits[8])
    ) % 10 == 0


def _numeric(text: str) -> bool:
    return bool(text) and text.isdigit()


def validate_nacha_bytes(raw: bytes, filename: str = "upload.ach") -> dict[str, Any]:
    issues: list[dict[str, Any]] = []
    try:
        text = raw.decode("ascii")
    except UnicodeDecodeError:
        return {
            "run_id": f"PREFLIGHT-{uuid.uuid4().hex[:10].upper()}",
            "filename": filename,
            "sha256": hashlib.sha256(raw).hexdigest(),
            "passed": False,
            "errors": [_issue("error", "NON_ASCII", "ACH files must be single-byte ASCII for this validator.")],
            "warnings": [],
            "summary": {},
            "batches": [],
            "entries": [],
        }

    lines = text.splitlines()
    while lines and lines[-1] == "":
        lines.pop()

    if not lines:
        return {
            "run_id": f"PREFLIGHT-{uuid.uuid4().hex[:10].upper()}",
            "filename": filename,
            "sha256": hashlib.sha256(raw).hexdigest(),
            "passed": False,
            "errors": [_issue("error", "EMPTY_FILE", "The uploaded file is empty.")],
            "warnings": [],
            "summary": {},
            "batches": [],
            "entries": [],
        }

    for i, line in enumerate(lines, 1):
        if len(line) != 94:
            issues.append(_issue(
                "error", "RECORD_LENGTH",
                "Every ACH record must be exactly 94 characters.",
                line=i, field="record", expected="94 characters", actual=f"{len(line)} characters"
            ))

    # If lengths are bad, keep going only with safe fixed-width lines.
    safe = all(len(line) == 94 for line in lines)
    logical = [line for line in lines if not (len(line) == 94 and set(line) == {"9"})]

    if not logical or not logical[0].startswith("1"):
        issues.append(_issue("error", "FILE_HEADER_MISSING", "File must begin with a File Header (record type 1).", line=1))
    if not logical or not logical[-1].startswith("9"):
        issues.append(_issue("error", "FILE_CONTROL_MISSING", "File must end logically with a File Control (record type 9), followed only by optional 9-padding."))

    batches_out: list[dict[str, Any]] = []
    entries_out: list[dict[str, Any]] = []

    if safe and logical and logical[0].startswith("1"):
        fh = logical[0]
        if fh[1:3] != "01":
            issues.append(_issue("error", "PRIORITY_CODE", "Priority Code must be 01.", line=1, field="priority_code", expected="01", actual=fh[1:3]))
        if fh[34:37] != "094":
            issues.append(_issue("error", "RECORD_SIZE", "File Header Record Size must be 094.", line=1, field="record_size", expected="094", actual=fh[34:37]))
        if fh[37:39] != "10":
            issues.append(_issue("error", "BLOCKING_FACTOR", "File Header Blocking Factor must be 10.", line=1, field="blocking_factor", expected="10", actual=fh[37:39]))
        if fh[39] != "1":
            issues.append(_issue("error", "FORMAT_CODE", "File Header Format Code must be 1.", line=1, field="format_code", expected="1", actual=fh[39]))

    # Blocking/padding.
    if len(lines) % 10 != 0:
        issues.append(_issue(
            "error", "BLOCK_COUNT",
            "Physical record count must be a multiple of 10 (blocking factor 10).",
            expected="multiple of 10", actual=str(len(lines))
        ))

    # Parse batches.
    total_entries_addenda = 0
    file_hash = 0
    file_debit = 0
    file_credit = 0
    batch_count = 0
    idx = 1
    logical_end = len(logical) - 1  # file control index
    seen_traces: set[str] = set()

    while safe and idx < logical_end:
        line = logical[idx]
        line_no = lines.index(line) + 1 if line in lines else idx + 1
        if not line.startswith("5"):
            issues.append(_issue("error", "BATCH_HEADER_EXPECTED", "Expected a Batch Header record (type 5).", line=line_no, actual=line[:1]))
            idx += 1
            continue

        batch_count += 1
        bh = line
        service_class = bh[1:4]
        sec = bh[50:53]
        company_id = bh[40:50]
        odfi_id = bh[79:87]
        batch_number = bh[87:94]
        if service_class not in {"200","220","225"}:
            issues.append(_issue("error", "SERVICE_CLASS", "Unsupported/invalid Service Class Code.", line=line_no, field="service_class_code", actual=service_class))
        if sec.strip() not in COMMON_SEC_CODES:
            issues.append(_issue("error", "SEC_CODE", "SEC code is not recognized by this preflight validator.", line=line_no, field="sec_code", actual=sec))
        if not batch_number.isdigit():
            issues.append(_issue("error", "BATCH_NUMBER", "Batch Number must be numeric.", line=line_no, field="batch_number", actual=batch_number))

        idx += 1
        batch_entries_addenda = 0
        batch_hash = 0
        batch_debit = 0
        batch_credit = 0
        batch_entries = 0
        batch_addenda = 0

        while idx < logical_end and not logical[idx].startswith("8"):
            rec = logical[idx]
            rec_no = lines.index(rec) + 1 if rec in lines else idx + 1
            rtype = rec[:1]
            if rtype == "6":
                batch_entries += 1
                batch_entries_addenda += 1
                total_entries_addenda += 1
                tx_code = rec[1:3]
                routing = rec[3:12]
                account = rec[12:29].rstrip()
                amount_text = rec[29:39]
                trace = rec[79:94]
                amount = int(amount_text) if amount_text.isdigit() else 0

                if tx_code not in VALID_TRANSACTION_CODES:
                    issues.append(_issue("error", "TRANSACTION_CODE", "Transaction Code is not recognized by this validator.", line=rec_no, field="transaction_code", actual=tx_code))
                if not _routing_valid(routing):
                    issues.append(_issue("error", "ROUTING_CHECK_DIGIT", "Receiving DFI routing number fails the ABA check-digit test.", line=rec_no, field="receiving_dfi_routing", actual=routing))
                if not account:
                    issues.append(_issue("error", "ACCOUNT_REQUIRED", "DFI Account Number is required.", line=rec_no, field="account_number"))
                if not _numeric(amount_text):
                    issues.append(_issue("error", "AMOUNT_FORMAT", "Entry amount must be numeric cents.", line=rec_no, field="amount", actual=amount_text))
                if not re.fullmatch(r"\d{15}", trace):
                    issues.append(_issue("error", "TRACE_FORMAT", "Trace Number must be 15 numeric digits.", line=rec_no, field="trace_number", actual=trace))
                elif trace in seen_traces:
                    issues.append(_issue("error", "DUPLICATE_TRACE", "Trace Number is duplicated within the file.", line=rec_no, field="trace_number", actual=trace))
                else:
                    seen_traces.add(trace)
                if trace[:8] != odfi_id:
                    issues.append(_issue("warning", "TRACE_ODFI", "Trace Number ODFI prefix does not match the Batch Header ODFI Identification.", line=rec_no, field="trace_number", expected=odfi_id, actual=trace[:8]))

                if routing[:8].isdigit():
                    batch_hash += int(routing[:8])
                if tx_code in CREDIT_CODES:
                    batch_credit += amount
                elif tx_code in DEBIT_CODES:
                    batch_debit += amount

                entries_out.append({
                    "line": rec_no,
                    "batch_number": batch_number,
                    "trace_number": trace,
                    "routing_number": routing,
                    "account_token": account[-4:].rjust(len(account), "*") if account else "",
                    "transaction_code": tx_code,
                    "amount_cents": amount,
                    "status": "error" if any(x.get("line") == rec_no and x["level"] == "error" for x in issues) else "valid",
                })
            elif rtype == "7":
                batch_addenda += 1
                batch_entries_addenda += 1
                total_entries_addenda += 1
            else:
                issues.append(_issue("error", "RECORD_SEQUENCE", "Unexpected record inside batch.", line=rec_no, actual=rtype))
            idx += 1

        if idx >= logical_end or not logical[idx].startswith("8"):
            issues.append(_issue("error", "BATCH_CONTROL_MISSING", "Batch is missing its Batch Control record.", field="batch_number", actual=batch_number))
            break

        bc = logical[idx]
        bc_no = lines.index(bc) + 1 if bc in lines else idx + 1
        declared_count = int(bc[4:10]) if bc[4:10].isdigit() else -1
        declared_hash = int(bc[10:20]) if bc[10:20].isdigit() else -1
        declared_debit = int(bc[20:32]) if bc[20:32].isdigit() else -1
        declared_credit = int(bc[32:44]) if bc[32:44].isdigit() else -1
        declared_batch_no = bc[87:94]

        calc_hash = batch_hash % 10_000_000_000
        if bc[1:4] != service_class:
            issues.append(_issue("error", "BATCH_SERVICE_CLASS_MISMATCH", "Batch Control Service Class does not match Batch Header.", line=bc_no, expected=service_class, actual=bc[1:4]))
        if declared_count != batch_entries_addenda:
            issues.append(_issue("error", "BATCH_ENTRY_COUNT", "Batch Control Entry/Addenda Count does not match parsed records.", line=bc_no, expected=str(batch_entries_addenda), actual=str(declared_count)))
        if declared_hash != calc_hash:
            issues.append(_issue("error", "BATCH_ENTRY_HASH", "Batch Control Entry Hash does not match entry routing hash.", line=bc_no, expected=f"{calc_hash:010d}", actual=bc[10:20]))
        if declared_debit != batch_debit:
            issues.append(_issue("error", "BATCH_DEBIT_TOTAL", "Batch Control debit total does not match entries.", line=bc_no, expected=str(batch_debit), actual=str(declared_debit)))
        if declared_credit != batch_credit:
            issues.append(_issue("error", "BATCH_CREDIT_TOTAL", "Batch Control credit total does not match entries.", line=bc_no, expected=str(batch_credit), actual=str(declared_credit)))
        if bc[44:54] != company_id:
            issues.append(_issue("error", "COMPANY_ID_MISMATCH", "Batch Control Company Identification does not match Batch Header.", line=bc_no, expected=company_id, actual=bc[44:54]))
        if bc[79:87] != odfi_id:
            issues.append(_issue("error", "ODFI_ID_MISMATCH", "Batch Control ODFI Identification does not match Batch Header.", line=bc_no, expected=odfi_id, actual=bc[79:87]))
        if declared_batch_no != batch_number:
            issues.append(_issue("error", "BATCH_NUMBER_MISMATCH", "Batch Control Batch Number does not match Batch Header.", line=bc_no, expected=batch_number, actual=declared_batch_no))

        batches_out.append({
            "batch_number": batch_number,
            "sec_code": sec.strip(),
            "service_class_code": service_class,
            "entry_count": batch_entries,
            "addenda_count": batch_addenda,
            "calculated_entry_hash": f"{calc_hash:010d}",
            "debit_total_cents": batch_debit,
            "credit_total_cents": batch_credit,
        })

        file_hash += calc_hash
        file_debit += batch_debit
        file_credit += batch_credit
        idx += 1

    # File control.
    if safe and logical and logical[-1].startswith("9"):
        fc = logical[-1]
        fc_no = lines.index(fc) + 1 if fc in lines else len(logical)
        declared_batches = int(fc[1:7]) if fc[1:7].isdigit() else -1
        declared_blocks = int(fc[7:13]) if fc[7:13].isdigit() else -1
        declared_count = int(fc[13:21]) if fc[13:21].isdigit() else -1
        declared_hash = int(fc[21:31]) if fc[21:31].isdigit() else -1
        declared_debit = int(fc[31:43]) if fc[31:43].isdigit() else -1
        declared_credit = int(fc[43:55]) if fc[43:55].isdigit() else -1
        calc_hash = file_hash % 10_000_000_000
        actual_blocks = len(lines) // 10 if len(lines) % 10 == 0 else (len(lines) + 9) // 10

        checks = [
            ("FILE_BATCH_COUNT", declared_batches, batch_count, "File Control batch count does not match parsed batches."),
            ("FILE_BLOCK_COUNT", declared_blocks, actual_blocks, "File Control block count does not match physical 10-record blocks."),
            ("FILE_ENTRY_COUNT", declared_count, total_entries_addenda, "File Control Entry/Addenda Count does not match parsed records."),
            ("FILE_ENTRY_HASH", declared_hash, calc_hash, "File Control Entry Hash does not match batch hashes."),
            ("FILE_DEBIT_TOTAL", declared_debit, file_debit, "File Control debit total does not match batches."),
            ("FILE_CREDIT_TOTAL", declared_credit, file_credit, "File Control credit total does not match batches."),
        ]
        for code, actual, expected, message in checks:
            if actual != expected:
                issues.append(_issue("error", code, message, line=fc_no, expected=str(expected), actual=str(actual)))

    errors = [x for x in issues if x["level"] == "error"]
    warnings = [x for x in issues if x["level"] == "warning"]
    return {
        "run_id": f"PREFLIGHT-{uuid.uuid4().hex[:10].upper()}",
        "validated_at": datetime.now(timezone.utc).isoformat(),
        "filename": filename,
        "sha256": hashlib.sha256(raw).hexdigest(),
        "passed": not errors,
        "errors": errors,
        "warnings": warnings,
        "summary": {
            "physical_records": len(lines),
            "logical_records": len(logical),
            "batches": batch_count,
            "entries_and_addenda": total_entries_addenda,
            "debit_total_cents": file_debit,
            "credit_total_cents": file_credit,
        },
        "batches": batches_out,
        "entries": entries_out,
        "dry_run": True,
        "transmitted": False,
        "accounts_touched": False,
    }
