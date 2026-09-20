from __future__ import annotations

import hashlib
import os
import re
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import psycopg
from fastapi import APIRouter, File, HTTPException, UploadFile
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from rail_catalogs import RAIL_METADATA, catalog_for

router = APIRouter(prefix="/api/rails", tags=["payment-rails"])

def _database_url() -> str:
    value = os.getenv("DATABASE_URL")
    if not value:
        raise RuntimeError("DATABASE_URL is not configured")
    return value

def _ensure_schema() -> None:
    with psycopg.connect(_database_url(), autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS rail_failure_catalog (
                    rail text NOT NULL,
                    code text NOT NULL,
                    message_type text NOT NULL DEFAULT '',
                    category text NOT NULL,
                    title text NOT NULL,
                    severity text NOT NULL,
                    public_documentation boolean NOT NULL DEFAULT false,
                    case_status text NOT NULL DEFAULT 'OPEN',
                    created_at timestamptz NOT NULL DEFAULT now(),
                    updated_at timestamptz NOT NULL DEFAULT now(),
                    PRIMARY KEY (rail, code, message_type)
                );
                CREATE TABLE IF NOT EXISTS rail_scenario_state (
                    rail text NOT NULL,
                    scenario text NOT NULL,
                    overall_status text NOT NULL,
                    success_rate numeric(6,2) NOT NULL,
                    transaction_count integer NOT NULL,
                    volume numeric(18,2) NOT NULL,
                    exception_count integer NOT NULL,
                    oldest_exception_seconds integer NOT NULL,
                    reconciliation_rate numeric(6,2) NOT NULL,
                    example_status text NOT NULL,
                    example_amount numeric(18,2) NOT NULL,
                    example_message_type text NOT NULL,
                    example_id text NOT NULL,
                    current_stage text NOT NULL,
                    updated_at timestamptz NOT NULL DEFAULT now(),
                    PRIMARY KEY (rail, scenario)
                );
                CREATE TABLE IF NOT EXISTS rail_test_runs (
                    id text PRIMARY KEY,
                    rail text NOT NULL,
                    filename text NOT NULL,
                    sha256 text NOT NULL,
                    message_id text,
                    message_type text,
                    passed boolean NOT NULL,
                    error_count integer NOT NULL,
                    warning_count integer NOT NULL,
                    result jsonb NOT NULL,
                    created_at timestamptz NOT NULL DEFAULT now()
                );
                CREATE INDEX IF NOT EXISTS rail_test_runs_message_idx
                    ON rail_test_runs (rail, message_id)
                    WHERE message_id IS NOT NULL;
            """)

SCENARIOS = {
    "fednow": {
        "healthy": ("HEALTHY", Decimal("99.98"), 2842, Decimal("6375000"), 2, 2, Decimal("99.93"), "SETTLED", Decimal("1250"), "pacs.008", "FN-260919-1042", "posting_confirmed"),
        "watch": ("WATCH", Decimal("98.41"), 3011, Decimal("7410000"), 27, 8, Decimal("98.72"), "PENDING STATUS", Decimal("1250"), "pacs.008", "FN-260919-1188", "status_inquiry"),
        "critical": ("CRITICAL", Decimal("86.20"), 3298, Decimal("8120000"), 181, 31, Decimal("87.55"), "REJECTED", Decimal("1250"), "pacs.008", "FN-260919-1297", "network_reject"),
    },
    "fedwire": {
        "healthy": ("HEALTHY", Decimal("99.96"), 864, Decimal("487500000"), 1, 42, Decimal("99.88"), "ACCEPTED", Decimal("275000"), "pacs.008", "FW-260919-1042", "settled"),
        "watch": ("WATCH", Decimal("97.92"), 903, Decimal("522100000"), 19, 211, Decimal("98.05"), "AWAITING ACK", Decimal("275000"), "pacs.008", "FW-260919-1188", "ack_pending"),
        "critical": ("CRITICAL", Decimal("84.60"), 917, Decimal("548400000"), 106, 512, Decimal("86.10"), "REJECTED", Decimal("275000"), "pacs.008", "FW-260919-1297", "business_reject"),
    },
    "rtp": {
        "healthy": ("HEALTHY", Decimal("99.99"), 4122, Decimal("9890000"), 1, 1, Decimal("99.97"), "ACCEPTED", Decimal("850"), "pacs.008", "RTP-260919-1042", "accepted"),
        "watch": ("WATCH", Decimal("98.73"), 4360, Decimal("10650000"), 32, 6, Decimal("98.91"), "TIMEOUT WATCH", Decimal("850"), "pacs.008", "RTP-260919-1188", "status_pending"),
        "critical": ("CRITICAL", Decimal("82.40"), 4511, Decimal("11120000"), 247, 19, Decimal("83.75"), "REJECTED", Decimal("850"), "pacs.008", "RTP-260919-1297", "switch_reject"),
    },
}

def _seed() -> None:
    _ensure_schema()
    with psycopg.connect(_database_url(), autocommit=True) as conn:
        with conn.cursor() as cur:
            for rail in ("fednow", "fedwire", "rtp"):
                for item in catalog_for(rail):
                    cur.execute(
                        """INSERT INTO rail_failure_catalog
                           (rail,code,message_type,category,title,severity,public_documentation)
                           VALUES (%s,%s,%s,%s,%s,%s,%s)
                           ON CONFLICT (rail,code,message_type) DO UPDATE SET
                             category=EXCLUDED.category,title=EXCLUDED.title,severity=EXCLUDED.severity,
                             public_documentation=EXCLUDED.public_documentation,updated_at=now()""",
                        (rail,item["code"],item.get("message") or "",item["category"],item["title"],item.get("severity","exception"),bool(item.get("public",False))),
                    )
                for scenario, row in SCENARIOS[rail].items():
                    cur.execute(
                        """INSERT INTO rail_scenario_state
                           (rail,scenario,overall_status,success_rate,transaction_count,volume,
                            exception_count,oldest_exception_seconds,reconciliation_rate,
                            example_status,example_amount,example_message_type,example_id,current_stage)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                           ON CONFLICT (rail,scenario) DO NOTHING""",
                        (rail, scenario, *row),
                    )

def _row(row: dict[str, Any]) -> dict[str, Any]:
    out = dict(row)
    for key, value in list(out.items()):
        if isinstance(value, Decimal): out[key] = float(value)
        elif isinstance(value, datetime): out[key] = value.isoformat()
    return out

@router.get("/catalog/{rail}")
def get_catalog(rail: str) -> dict[str, Any]:
    rail = rail.lower()
    if rail not in RAIL_METADATA: raise HTTPException(status_code=404, detail="Unknown rail")
    _seed()
    with psycopg.connect(_database_url(), row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute("""SELECT code,NULLIF(message_type,'') AS message_type,category,title,severity,public_documentation,case_status
                           FROM rail_failure_catalog WHERE rail=%s ORDER BY category,code,message_type""",(rail,))
            rows = [_row(r) for r in cur.fetchall()]
    return {"rail":rail,"metadata":RAIL_METADATA[rail],"count":len(rows),"cases":rows}

@router.get("/scenario/{rail}/{scenario}")
def get_scenario(rail: str, scenario: str) -> dict[str, Any]:
    rail, scenario = rail.lower(), scenario.lower()
    if rail not in RAIL_METADATA or scenario not in {"healthy","watch","critical"}:
        raise HTTPException(status_code=404, detail="Unknown rail or scenario")
    _seed()
    with psycopg.connect(_database_url(), row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM rail_scenario_state WHERE rail=%s AND scenario=%s",(rail,scenario))
            row = cur.fetchone()
    return {"metadata":RAIL_METADATA[rail],"snapshot":_row(row) if row else None}

@router.post("/reset/{rail}")
def reset_rail(rail: str) -> dict[str, Any]:
    rail = rail.lower()
    if rail not in RAIL_METADATA: raise HTTPException(status_code=404, detail="Unknown rail")
    _ensure_schema()
    with psycopg.connect(_database_url(), autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE rail_failure_catalog SET case_status='OPEN',updated_at=now() WHERE rail=%s",(rail,))
            cur.execute("DELETE FROM rail_scenario_state WHERE rail=%s",(rail,))
            cur.execute("DELETE FROM rail_test_runs WHERE rail=%s",(rail,))
    _seed()
    return {"rail":rail,"status":"reset","message":f"{RAIL_METADATA[rail]['name']} lab restored to original training state."}

def _local(tag: str) -> str:
    return tag.rsplit("}",1)[-1]

def _first(root: ET.Element, suffix: str) -> str | None:
    for elem in root.iter():
        if _local(elem.tag)==suffix and elem.text and elem.text.strip():
            return elem.text.strip()
    return None

def _message_type(root: ET.Element) -> str | None:
    msg = _first(root,"MsgDefIdr")
    if msg:
        parts=msg.split(".")
        if len(parts)>=2: return ".".join(parts[:2])
    mapping={"FIToFICstmrCdtTrf":"pacs.008","FICdtTrf":"pacs.009","PmtRtr":"pacs.004","FIToFIPmtStsRpt":"pacs.002"}
    for elem in root.iter():
        if _local(elem.tag) in mapping: return mapping[_local(elem.tag)]
    return None

def _amount_currency(root: ET.Element):
    for elem in root.iter():
        if _local(elem.tag) in {"IntrBkSttlmAmt","InstdAmt"} and elem.text:
            try: return Decimal(elem.text.strip()), elem.attrib.get("Ccy")
            except Exception: return None, elem.attrib.get("Ccy")
    return None, None

def _valid_uuid4(value: str | None) -> bool:
    return bool(value and re.fullmatch(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}",value))

def validate_xml(rail: str, raw: bytes):
    errors=[]; warnings=[]
    try: text=raw.decode("utf-8")
    except UnicodeDecodeError:
        return {"passed":False,"errors":[{"code":"ENCODING","message":"Message must be UTF-8 XML."}],"warnings":[]}
    if rail=="fedwire" and len(text)>25000:
        errors.append({"code":"FW-MSGSIZE","message":"Fedwire outbound ISO 20022 message exceeds the published 25,000-character limit."})
    try: xml_root=ET.fromstring(text)
    except ET.ParseError as exc:
        return {"passed":False,"errors":[{"code":"XML","message":f"Malformed XML: {exc}"}],"warnings":[]}
    message_type=_message_type(xml_root)
    message_id=_first(xml_root,"BizMsgIdr") or _first(xml_root,"MsgId")
    uetr=_first(xml_root,"UETR")
    amount,currency=_amount_currency(xml_root)
    if not message_type: errors.append({"code":"MESSAGE_TYPE","message":"Unable to identify a supported ISO 20022 message type."})
    if not message_id: errors.append({"code":"MESSAGE_ID","message":"Business/message identifier is missing."})
    if currency and currency!="USD": errors.append({"code":"CURRENCY","message":f"{RAIL_METADATA[rail]['name']} training flow expects USD; found {currency}."})
    if amount is not None and amount<=0: errors.append({"code":"AMOUNT","message":"Payment amount must be greater than zero."})
    limit=RAIL_METADATA[rail].get("transaction_limit_usd")
    if limit and amount is not None and amount>Decimal(str(limit)):
        errors.append({"code":"LIMIT","message":f"Amount exceeds the current ${limit:,.0f} transaction limit modeled for {RAIL_METADATA[rail]['name']}."})
    if rail=="fedwire":
        if message_type in {"pacs.008","pacs.009"} and not _valid_uuid4(uetr):
            errors.append({"code":"FW-UETR","message":"Fedwire value-message UETR is missing or does not match UUID v4 format."})
    elif rail=="fednow":
        warnings.append({"code":"SIGNATURE-NOT-VERIFIED","message":"Lab parses structure but does not cryptographically verify FedNow message signatures or participant keys."})
    elif rail=="rtp":
        if not _first(xml_root,"MsgDefIdr"):
            errors.append({"code":"RTP-BAH","message":"RTP test expects MsgDefIdr in the Business Application Header."})
    return {"passed":not errors,"errors":errors,"warnings":warnings,"message_type":message_type,"message_id":message_id,"uetr":uetr,"amount":float(amount) if amount is not None else None,"currency":currency}

@router.post("/message-test/{rail}")
async def message_test(rail: str, file: UploadFile = File(...)) -> dict[str, Any]:
    rail=rail.lower()
    if rail not in RAIL_METADATA: raise HTTPException(status_code=404, detail="Unknown rail")
    raw=await file.read()
    if not raw: raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(raw)>5*1024*1024: raise HTTPException(status_code=413, detail="Training file exceeds 5 MB limit")
    result=validate_xml(rail,raw)
    _ensure_schema()
    msg_id=result.get("message_id")
    if msg_id:
        with psycopg.connect(_database_url(), row_factory=dict_row) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM rail_test_runs WHERE rail=%s AND message_id=%s LIMIT 1",(rail,msg_id))
                if cur.fetchone():
                    result["passed"]=False
                    result["errors"].append({"code":"DUPLICATE_MESSAGE_ID","message":"This message identifier was already used in a prior lab test run."})
    result.update({
        "run_id":f"{rail.upper()}-{uuid.uuid4().hex[:10].upper()}",
        "rail":rail,"filename":file.filename or "message.xml","sha256":hashlib.sha256(raw).hexdigest(),
        "dry_run":True,"transmitted":False,"accounts_touched":False,
        "validated_at":datetime.now(timezone.utc).isoformat(),
        "validator_scope":"Structural and selected publicly documented business-rule checks; not operator certification or full XSD/proprietary-rule validation.",
    })
    with psycopg.connect(_database_url(), autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("""INSERT INTO rail_test_runs
                (id,rail,filename,sha256,message_id,message_type,passed,error_count,warning_count,result)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (result["run_id"],rail,result["filename"],result["sha256"],result.get("message_id"),result.get("message_type"),
                 result["passed"],len(result["errors"]),len(result["warnings"]),Jsonb(result)))
    return result
