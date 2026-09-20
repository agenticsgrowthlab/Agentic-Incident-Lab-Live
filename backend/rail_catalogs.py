from __future__ import annotations

RAIL_METADATA = {
    "fednow": {
        "name": "FedNow",
        "operator": "Federal Reserve Financial Services",
        "message_standard": "ISO 20022",
        "primary_value_messages": ["pacs.008", "pacs.004", "pacs.009"],
        "availability": "24x7x365",
        "transaction_limit_usd": 10_000_000,
        "settlement_model": "Immediate settlement in Federal Reserve master account / correspondent arrangement",
        "test_label": "ISO 20022 Message Test",
        "coverage_note": "All publicly documented FedNow codes found in the cited 2026 operating procedures are represented; the complete implementation-guide glossary is access-controlled and is not fabricated here.",
    },
    "fedwire": {
        "name": "FedWire",
        "operator": "Federal Reserve Financial Services",
        "message_standard": "ISO 20022",
        "primary_value_messages": ["pacs.008", "pacs.009", "pacs.004"],
        "availability": "Business-day / published operating schedule",
        "transaction_limit_usd": None,
        "settlement_model": "Real-time gross settlement in Federal Reserve accounts",
        "test_label": "ISO 20022 / Wire Message Test",
        "coverage_note": "Fedwire's complete ISO 20022 Error Code Glossary is available only in the access-controlled Technical Guide. Public code examples and public error families are included without inventing gated codes.",
    },
    "rtp": {
        "name": "RTP",
        "operator": "The Clearing House",
        "message_standard": "ISO 20022",
        "primary_value_messages": ["pacs.008", "pacs.009"],
        "availability": "24x7x365",
        "transaction_limit_usd": 10_000_000,
        "settlement_model": "Immediate final settlement using RTP prefunded model",
        "test_label": "ISO 20022 Message Test",
        "coverage_note": "Reject/reason codes are based on The Clearing House RTP Message Specification v5.0, June 2026, Appendix B.",
    },
}

FEDNOW_PUBLIC_CODES = [
    {"code":"F002","message":"pacs.002","category":"Fraud","title":"Sender negative-list match with send restriction","severity":"reject","public":True},
    {"code":"F008","message":"pacs.002","category":"Fraud","title":"Cumulative value threshold exceeded","severity":"reject","public":True},
    {"code":"F009","message":"pacs.002","category":"Fraud","title":"Velocity/count threshold exceeded","severity":"reject","public":True},
    {"code":"F101","message":"pacs.002","category":"Fraud","title":"Rejected by a configured fraud control","severity":"reject","public":True},
    {"code":"F004","message":"report/query","category":"Fraud","title":"Fraud-control timeout warning","severity":"warning","public":True},
    {"code":"F010","message":"report/query","category":"Fraud","title":"Fraud-control timeout warning","severity":"warning","public":True},
    {"code":"F011","message":"report/query","category":"Fraud","title":"Fraud-control timeout warning","severity":"warning","public":True},
    {"code":"E301","message":"admi.002","category":"Reporting","title":"Account Activity Details report request exceeds supported message count","severity":"reject","public":True},
]

FEDNOW_OPERATIONAL_CASES = [
    {"code":"FN-SIGNATURE","category":"Message validation","title":"Invalid, expired, or unrecognized message signature","severity":"reject"},
    {"code":"FN-SIZE","category":"Message validation","title":"Message size validation failure","severity":"reject"},
    {"code":"FN-XML","category":"Message validation","title":"Malformed XML / syntax validation failure","severity":"reject"},
    {"code":"FN-AUTH-SENDER","category":"Participant","title":"Sender is not authorized for the message","severity":"reject"},
    {"code":"FN-DUP-ID","category":"Message validation","title":"Duplicate Business Application Header message ID","severity":"reject"},
    {"code":"FN-SCHEMA","category":"Message validation","title":"FedNow ISO 20022 usage/schema rule failure","severity":"reject"},
    {"code":"FN-PARTICIPANT","category":"Participant","title":"Sending or receiving FI is not eligible/active for the transaction","severity":"reject"},
    {"code":"FN-FUTURE-DATE","category":"Business validation","title":"Future-dated instant payment","severity":"reject"},
    {"code":"FN-LIMIT","category":"Business validation","title":"Transaction exceeds service or participant-configured limit","severity":"reject"},
    {"code":"FN-TIMEOUT","category":"Processing","title":"Payment timeout clock exceeded / outcome requires status inquiry","severity":"exception"},
    {"code":"FN-STATUS-UNKNOWN","category":"Processing","title":"Payment status uncertain; pacs.028 / query required before resend","severity":"exception"},
    {"code":"FN-POSTING","category":"Posting","title":"Receiver accepted settlement but member posting confirmation is missing","severity":"exception"},
    {"code":"FN-RETURN","category":"Returns","title":"Payment return / return-request exception","severity":"exception"},
    {"code":"FN-LIQUIDITY","category":"Settlement","title":"Liquidity-management or settlement-position exception","severity":"exception"},
    {"code":"FN-RECON","category":"Reconciliation","title":"FedNow settlement, posting, and internal ledger mismatch","severity":"exception"},
]

FEDWIRE_PUBLIC_CODES = [
    {"code":"T125","message":"admi.002","category":"Technical","title":"Publicly documented example involving From Member ID / connection-owner mismatch","severity":"reject","public":True},
    {"code":"T505","message":"admi.002","category":"Technical","title":"Unable to open/read/parse received ISO 20022 message","severity":"reject","public":True},
]

FEDWIRE_ERROR_FAMILIES = [
    {"code":"T***","category":"Technical","title":"XML schema / Fedwire ISO 20022 usage-guideline technical error","severity":"reject"},
    {"code":"E***","category":"Business","title":"Fedwire business edit error family","severity":"reject"},
    {"code":"F***","category":"Business","title":"Fedwire business edit error family","severity":"reject"},
    {"code":"H***","category":"Business","title":"Fedwire business edit error family","severity":"reject"},
    {"code":"I***","category":"Business","title":"Fedwire business edit error family","severity":"reject"},
]

FEDWIRE_OPERATIONAL_CASES = [
    {"code":"FW-ENVELOPE","category":"Message validation","title":"Missing/invalid message envelope or Business Application Header","severity":"reject"},
    {"code":"FW-XML","category":"Message validation","title":"Malformed XML / schema failure","severity":"reject"},
    {"code":"FW-MSGSIZE","category":"Message validation","title":"Outbound ISO 20022 message exceeds 25,000-character published limit","severity":"reject"},
    {"code":"FW-UETR","category":"Message validation","title":"UETR does not match required UUID v4 pattern","severity":"reject"},
    {"code":"FW-SENDER","category":"Business validation","title":"Invalid or unauthorized Fedwire Sender","severity":"reject"},
    {"code":"FW-RECEIVER","category":"Business validation","title":"Invalid or unavailable Fedwire Receiver","severity":"reject"},
    {"code":"FW-DUP","category":"Duplicate control","title":"Copy Duplicate / Possible Duplicate handling exception","severity":"exception"},
    {"code":"FW-QUEUE","category":"Connectivity","title":"FedLine / service-provider queue or connectivity exception","severity":"exception"},
    {"code":"FW-ACK","category":"Processing","title":"Expected acknowledgement/advice missing","severity":"exception"},
    {"code":"FW-RETURN","category":"Returns","title":"pacs.004 payment return exception","severity":"exception"},
    {"code":"FW-INVESTIGATION","category":"Investigation","title":"camt.110 / camt.111 investigation workflow exception","severity":"exception"},
    {"code":"FW-REPORT-GAP","category":"Reconciliation","title":"Endpoint totals/details/gap report inconsistency","severity":"exception"},
    {"code":"FW-RECON","category":"Reconciliation","title":"Fedwire acknowledgement, settlement, and internal ledger mismatch","severity":"exception"},
]

RTP_PACS002_CODES = [
    ("AC02","Account","Debtor account number invalid or missing"),
    ("AC03","Account","Creditor account number invalid or missing"),
    ("AC04","Account","Account closed"),
    ("AC06","Account","Account blocked / posting prohibited"),
    ("AC11","Account","Creditor account currency invalid or missing"),
    ("AC13","Account","Debtor account type invalid"),
    ("AC14","Account","Creditor account type invalid"),
    ("AG01","Authorization","Transaction forbidden on this account / agent not authorized for pacs.008"),
    ("AG03","Authorization","Transaction/message type not supported or authorized"),
    ("AGNT","Agent","Incorrect agent"),
    ("AM02","Limit","Global transaction limit breach / SITL"),
    ("AM04","Liquidity","Insufficient prefunded balance"),
    ("AM09","Amount","Amount received is not amount expected"),
    ("AM12","Amount","Amount invalid or missing"),
    ("AM13","Limit","Payment type limit breach / STL"),
    ("AM14","Limit","Amount exceeds bank/client limit"),
    ("BE04","Party data","Creditor address missing or incorrect"),
    ("BE06","Party data","End customer not known / no longer exists"),
    ("BE07","Party data","Debtor address missing or incorrect"),
    ("BE10","Party data","Debtor country code missing or invalid"),
    ("BE11","Party data","Creditor country code missing or invalid"),
    ("BE16","Party data","Debtor identification missing or invalid"),
    ("BE17","Party data","Creditor identification missing or invalid"),
    ("DS24","Timeout","Waiting time expired / incomplete order"),
    ("DT04","Date","Future date not supported"),
    ("DUPL","Duplicate","Duplicate payment"),
    ("DS0H","Authorization","Signer not allowed / sender not linked to participant"),
    ("FF02","Syntax","Syntax error with narrative detail"),
    ("FF08","Identifier","End-to-End ID missing or invalid"),
    ("MD07","Customer","End customer deceased"),
    ("NARR","Business","Business rejection with narrative reason"),
    ("RC01","Routing","Bank identifier format incorrect"),
    ("RC02","Routing","Bank identifier invalid or missing"),
    ("RC03","Routing","Debtor FI identifier invalid or missing"),
    ("RC04","Routing","Creditor FI identifier invalid or missing"),
    ("SL03","Token","Token Service did not respond"),
    ("TM01","Timing","Invalid cutoff / no matching instruction"),
    ("TK01","Token","Invalid token"),
    ("TK02","Token","Sender token not found"),
    ("TK03","Token","Receiver token not found"),
    ("TK04","Token","Token expired"),
    ("TK05","Token","Token counterparty mismatch"),
    ("TK06","Token","Token value-limit violation"),
    ("TK07","Token","Single-use token already used"),
    ("TK08","Token","Token suspended"),
    ("NOAT","Account","Receiving account does not support/accept message type"),
    ("1100","Technical","Other technical reason; may clear on retry"),
    ("9909","System","RTP central switch/component malfunction"),
    ("9910","Participant","Instructed agent signed off"),
    ("9912","Connectivity","Recipient connection unavailable"),
    ("9934","Participant","Instructing agent signed off"),
    ("9946","Participant","Instructing agent suspended"),
    ("9947","Participant","Instructed agent suspended"),
    ("9948","System","RTP service suspended"),
    ("9952","Versioning","Message-version mapping incompatibility"),
    ("9953","Message validation","Missing FULL code"),
    ("9954","Message validation","Missing creditor-agent instructions for Zelle RFP"),
    ("9956","Funding","Instructing agent funding account suspended"),
    ("9957","Funding","Instructed agent funding account suspended"),
    ("9964","Participant","Invalid participant identification"),
]

RTP_OTHER_CODES = [
    ("pain.014","AC06","Account","Account blocked"),
    ("pain.014","AG01","Authorization","Transaction forbidden on account"),
    ("pain.014","AG03","Authorization","Transaction type not supported/authorized"),
    ("pain.014","AM09","Amount","Amount differs from expected/requested amount"),
    ("pain.014","AM14","Limit","Amount exceeds bank/client limit"),
    ("pain.014","BE04","Party data","Creditor address missing/incorrect"),
    ("pain.014","BE07","Party data","Debtor address missing/incorrect"),
    ("pain.014","CH11","Customer","Creditor identifier incorrect / creditor unknown"),
    ("pain.014","CUST","Customer","Requested by customer / payment will not be made"),
    ("pain.014","DS04","Business","Request for Payment rejected due to message-content concern"),
    ("pain.014","MD07","Customer","End customer deceased"),
    ("pain.014","NARR","Business","Business rejection with narrative reason"),
    ("pain.014","SL12","Preference","Debtor opted out of Request for Payment"),
    ("pain.014","1100","Other","Any other reason"),
    ("camt.056","AC03","Account","Invalid creditor account number"),
    ("camt.056","AM09","Amount","Wrong amount"),
    ("camt.056","CUST","Customer","Cancellation requested by customer"),
    ("camt.056","DS24","Timeout","Time-out"),
    ("camt.056","DUPL","Duplicate","Duplicate payment"),
    ("camt.056","FRAD","Fraud","Fraudulent origin / fraudulently induced"),
    ("camt.056","FRTR","Return request","Final response / repeat attempt after prior non-response"),
    ("camt.056","TECH","Technical","Technical problem caused erroneous transaction"),
    ("camt.056","UAPA","Authorization","Unauthorized payment"),
    ("camt.056","UPAY","Payment","Undue payment / paid through another channel or RFP warranty claim"),
    ("camt.056","WIAM","Indemnity","Wrong amount with indemnity"),
    ("camt.056","WICT","Indemnity","With indemnity - customer"),
    ("camt.056","WIDP","Indemnity","With indemnity - duplicate"),
    ("camt.056","WIFD","Indemnity","With indemnity - fraud"),
    ("camt.056","WIFT","Indemnity","Final response with indemnity"),
    ("camt.056","WITH","Indemnity","With indemnity - technical"),
    ("camt.029","AC04","Account","Closed account"),
    ("camt.029","AM04","Funds","Insufficient funds"),
    ("camt.029","ARDT","Return request","Already returned"),
    ("camt.029","CUST","Customer","Customer decision"),
    ("camt.029","LEGL","Legal","Legal/regulatory decision"),
    ("camt.029","NOAS","Customer","No answer from customer"),
    ("camt.029","NOOR","Original payment","No original transaction received"),
]

RTP_OPERATIONAL_CASES = [
    {"code":"RTP-RECON","category":"Reconciliation","title":"Prefunded settlement, payment status, and internal posting mismatch","severity":"exception"},
    {"code":"RTP-POSTING","category":"Posting","title":"Payment settled but receiver posting/availability confirmation is missing","severity":"exception"},
    {"code":"RTP-FUNDING-WARN","category":"Funding","title":"Available prefunded balance warning / breach notification","severity":"exception"},
    {"code":"RTP-CONNECTIVITY","category":"Connectivity","title":"Participant connection degradation or echo/sign-on exception","severity":"exception"},
    {"code":"RTP-STATUS","category":"Processing","title":"pacs.002 response/status not received within expected real-time window","severity":"exception"},
]

def catalog_for(rail: str) -> list[dict]:
    rail = rail.lower()
    if rail == "fednow":
        return FEDNOW_PUBLIC_CODES + FEDNOW_OPERATIONAL_CASES
    if rail == "fedwire":
        return FEDWIRE_PUBLIC_CODES + FEDWIRE_ERROR_FAMILIES + FEDWIRE_OPERATIONAL_CASES
    if rail == "rtp":
        pacs = [{"code":c,"message":"pacs.002","category":cat,"title":title,"severity":"reject","public":True} for c,cat,title in RTP_PACS002_CODES]
        other = [{"code":c,"message":msg,"category":cat,"title":title,"severity":"reason","public":True} for msg,c,cat,title in RTP_OTHER_CODES]
        return pacs + other + RTP_OPERATIONAL_CASES
    raise KeyError(rail)
