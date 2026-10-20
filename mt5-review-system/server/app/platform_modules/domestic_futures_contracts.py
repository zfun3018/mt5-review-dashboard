from __future__ import annotations

import re


_CANONICAL_PRODUCT_CODES = {
    # Most domestic futures already use the common product code as-is.
    "IF": "IF",
    "IC": "IC",
    "IM": "IM",
    "IH": "IH",
    "RB": "RB",
    "HC": "HC",
    "CU": "CU",
    "AL": "AL",
    "ZN": "ZN",
    "NI": "NI",
    "SN": "SN",
    "AU": "AU",
    "AG": "AG",
    "FU": "FU",
    "BU": "BU",
    "RU": "RU",
    "SC": "SC",
    "TA": "PTA",
    "MA": "MA",
    "PP": "PP",
    "L": "PE",
    "V": "PVC",
    "J": "J",
    "JM": "JM",
    "I": "I",
    "M": "M",
    "Y": "Y",
    "P": "P",
    "C": "C",
    "SR": "SR",
    "CF": "CF",
    "OI": "OI",
    "RM": "RM",
    "AP": "AP",
}


def contract_display(symbol: str) -> dict[str, str]:
    """Return the source code plus the domestic futures common contract name."""
    original = str(symbol or "").strip()
    normalized = original.upper()
    match = re.match(r"([A-Z]+)", normalized)
    product_code = match.group(1) if match else normalized
    contract_match = re.fullmatch(r"([A-Z]+)(\d{3,4})", normalized)
    product_name = _CANONICAL_PRODUCT_CODES.get(product_code, product_code or normalized)
    contract_name = normalized or product_name
    if contract_match:
        contract_name = f"{product_name}{contract_match.group(2)}"
    return {
        "symbol": original,
        "product_code": product_code,
        "product_name": product_name,
        "contract_name": contract_name,
    }
