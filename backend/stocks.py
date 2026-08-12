# -*- coding: utf-8 -*-
"""
銘柄マスタ
- code: yfinance用ティッカーは "{code}.T" になる（東証）
- index: "日経225" or "日経グロース"
- sector: 日本語のセクター表示名（フィルタ用）

必要に応じて銘柄を追加・削除してください。100銘柄程度までは
yfinanceの無料取得でも実用的な速度で動きます。
"""

STOCKS = [
    # --- 日経225 ---
    {"code": "7203", "name": "トヨタ自動車", "index": "日経225", "sector": "メーカー（自動車）"},
    {"code": "6758", "name": "ソニーグループ", "index": "日経225", "sector": "メーカー（電機）"},
    {"code": "6501", "name": "日立製作所", "index": "日経225", "sector": "メーカー（電機）"},
    {"code": "7267", "name": "ホンダ", "index": "日経225", "sector": "メーカー（自動車）"},
    {"code": "9432", "name": "NTT", "index": "日経225", "sector": "通信"},
    {"code": "9433", "name": "KDDI", "index": "日経225", "sector": "通信"},
    {"code": "9984", "name": "ソフトバンクグループ", "index": "日経225", "sector": "通信"},
    {"code": "4568", "name": "第一三共", "index": "日経225", "sector": "医療・製薬"},
    {"code": "4502", "name": "武田薬品工業", "index": "日経225", "sector": "医療・製薬"},
    {"code": "4523", "name": "エーザイ", "index": "日経225", "sector": "医療・製薬"},
    {"code": "8306", "name": "三菱UFJフィナンシャル・グループ", "index": "日経225", "sector": "金融"},
    {"code": "8316", "name": "三井住友フィナンシャルグループ", "index": "日経225", "sector": "金融"},
    {"code": "8058", "name": "三菱商事", "index": "日経225", "sector": "商社"},
    {"code": "8031", "name": "三井物産", "index": "日経225", "sector": "商社"},
    {"code": "9020", "name": "JR東日本", "index": "日経225", "sector": "運輸・鉄道"},
    {"code": "9022", "name": "JR東海", "index": "日経225", "sector": "運輸・鉄道"},
    {"code": "2914", "name": "JT", "index": "日経225", "sector": "食品"},
    {"code": "2502", "name": "アサヒグループHD", "index": "日経225", "sector": "食品"},
    {"code": "9983", "name": "ファーストリテイリング", "index": "日経225", "sector": "小売"},
    {"code": "3382", "name": "セブン&アイ・HD", "index": "日経225", "sector": "小売"},

    # --- 日経グロース ---
    {"code": "4477", "name": "BASE", "index": "日経グロース", "sector": "IT・通信"},
    {"code": "4485", "name": "JTOWER", "index": "日経グロース", "sector": "IT・通信"},
    {"code": "4382", "name": "HEROZ", "index": "日経グロース", "sector": "IT・通信"},
    {"code": "4443", "name": "Sansan", "index": "日経グロース", "sector": "IT・通信"},
    {"code": "4592", "name": "サンバイオ", "index": "日経グロース", "sector": "医療・バイオ"},
    {"code": "4587", "name": "ペプチドリーム", "index": "日経グロース", "sector": "医療・バイオ"},
    {"code": "7342", "name": "ウェルスナビ", "index": "日経グロース", "sector": "金融・フィンテック"},
    {"code": "4478", "name": "フリー", "index": "日経グロース", "sector": "IT・通信"},
    {"code": "3092", "name": "ZOZO", "index": "日経グロース", "sector": "小売・EC"},
    {"code": "6027", "name": "弁護士ドットコム", "index": "日経グロース", "sector": "IT・通信"},
]


def ticker_symbol(code: str) -> str:
    """東証銘柄コードをyfinance用ティッカーに変換"""
    return f"{code}.T"
