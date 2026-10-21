from __future__ import annotations

import re


_PRODUCT_NAMES = {
    # China Financial Futures Exchange.
    "IF": "IF",
    "IC": "IC",
    "IM": "IM",
    "IH": "IH",
    # Shanghai Futures Exchange and INE.
    "RB": "螺纹钢",
    "HC": "热卷",
    "CU": "沪铜",
    "AL": "沪铝",
    "ZN": "沪锌",
    "NI": "沪镍",
    "SN": "沪锡",
    "AU": "沪金",
    "AG": "沪银",
    "FU": "燃油",
    "BU": "沥青",
    "RU": "橡胶",
    "SC": "原油",
    "BR": "丁二烯橡胶",
    "AO": "氧化铝",
    "EC": "集运指数",
    # Dalian Commodity Exchange.
    "TA": "PTA",
    "MA": "甲醇",
    "PP": "聚丙烯",
    "L": "PE",
    "V": "PVC",
    "J": "焦炭",
    "JM": "焦煤",
    "I": "铁矿石",
    "M": "豆粕",
    "Y": "豆油",
    "P": "棕榈油",
    "C": "玉米",
    "A": "豆一",
    "B": "豆二",
    "CS": "玉米淀粉",
    "JD": "鸡蛋",
    "EG": "乙二醇",
    "EB": "苯乙烯",
    "PG": "液化石油气",
    "LH": "生猪",
    "RR": "粳米",
    "FG": "玻璃",
    # Zhengzhou Commodity Exchange.
    "SR": "白糖",
    "CF": "棉花",
    "CY": "棉纱",
    "OI": "菜油",
    "RM": "菜粕",
    "AP": "苹果",
    "SA": "纯碱",
    "UR": "尿素",
    "PK": "花生",
    "PF": "短纤",
    "PX": "对二甲苯",
    "SH": "烧碱",
    "CJ": "红枣",
    "SF": "硅铁",
    "SM": "锰硅",
    "ZC": "动力煤",
}


def contract_display(symbol: str) -> dict[str, str]:
    """Return the source code plus the domestic futures common contract name."""
    original = str(symbol or "").strip()
    normalized = original.upper()
    match = re.match(r"([A-Z]+)", normalized)
    product_code = match.group(1) if match else normalized
    contract_match = re.fullmatch(r"([A-Z]+)(\d{3,4})", normalized)
    product_name = _PRODUCT_NAMES.get(product_code, product_code or normalized)
    contract_name = normalized or product_name
    if contract_match:
        contract_name = f"{product_name}{_expand_contract_month(contract_match.group(2))}"
    return {
        "symbol": original,
        "product_code": product_code,
        "product_name": product_name,
        "contract_name": contract_name,
    }


def _expand_contract_month(month_code: str) -> str:
    """Expand domestic futures' three-digit year/month code to YYYYMM."""
    return f"2{month_code}" if len(month_code) == 3 else month_code
