# -*- coding: utf-8 -*-
"""
株価分析くん - データ取得バッチ

yfinanceで日経225・日経グロースの主要銘柄の
- 過去365日分の終値
- 配当利回り
を取得し、分析ロジック(analysis.py)を適用して
backend/data/stocks.json に書き出す。

このスクリプトはGitHub Actionsから平日のTSE引け後に自動実行される想定。
ローカルで手動実行して動作確認もできる:
    cd backend
    pip install -r requirements.txt
    python fetch_data.py
"""

import json
import time
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

import yfinance as yf
from curl_cffi import requests as curl_requests

from stocks import STOCKS, ticker_symbol
from analysis import compute_signal

JST = timezone(timedelta(hours=9))
OUTPUT_PATH = Path(__file__).parent / "data" / "stocks.json"

# yfinanceのレート制限対策：1銘柄ごとに間隔を空ける（秒）
REQUEST_INTERVAL_SEC = 1.2

# Yahoo Finance側のボット対策(TLSフィンガープリント判定)を回避するため、
# ブラウザに偽装したセッション(curl_cffi)をyfinanceに渡す。
# 通常のrequestsセッションだとJSONではなくエラーページが返ってきて
# 「Expecting value: line 1 column 1 (char 0)」のようなエラーになることがある。
_session = curl_requests.Session(impersonate="chrome")


def fetch_one(stock: dict) -> dict | None:
    """1銘柄分のデータを取得して分析結果付きのdictを返す。失敗時はNone。"""
    symbol = ticker_symbol(stock["code"])
    try:
        ticker = yf.Ticker(symbol, session=_session)

        # 過去400日分の日足を取得（土日・祝日を除いた営業日ベースで365日以上確保するため余裕を持たせる）
        hist = ticker.history(period="400d", interval="1d")
        if hist.empty:
            print(f"  [WARN] {symbol}: 価格データが空です。スキップします。", file=sys.stderr)
            return None

        closes = hist["Close"].dropna()
        if len(closes) < 30:
            print(f"  [WARN] {symbol}: データが{len(closes)}日分しかありません。スキップします。", file=sys.stderr)
            return None

        # 直近365営業日分に切り詰め
        closes = closes.tail(365)
        prices = [round(float(p), 1) for p in closes.tolist()]
        dates = [d.strftime("%Y-%m-%d") for d in closes.index.tolist()]

        # 配当利回り取得（info辞書のキーはyfinanceのバージョンで変わることがあるため複数試す）
        dividend_yield = 0.0
        try:
            info = ticker.info
            dy = info.get("dividendYield") or info.get("trailingAnnualDividendYield")
            if dy:
                # yfinanceのバージョンによって 0.031 (比率) か 3.1 (%) かが異なるため正規化
                dividend_yield = dy * 100 if dy < 1 else dy
        except Exception as e:
            print(f"  [WARN] {symbol}: 配当利回り取得に失敗しました ({e})", file=sys.stderr)

        signal = compute_signal(prices)

        return {
            "code": stock["code"],
            "name": stock["name"],
            "index": stock["index"],
            "sector": stock["sector"],
            "dates": dates,
            "prices": prices,
            "latestPrice": prices[-1],
            "dividendYield": round(dividend_yield, 2),
            "sma30": signal["sma30"],
            "sma90": signal["sma90"],
            "granvilleSignals": signal["granvilleSignals"],
            "signal": {
                "trends": signal["trends"],
                "bottom": signal["bottom"],
                "score": signal["score"],
                "verdict": signal["verdict"],
            },
        }
    except Exception as e:
        print(f"  [ERROR] {symbol}: 取得中にエラーが発生しました ({e})", file=sys.stderr)
        return None


def main():
    print(f"株価分析くん: データ取得を開始します ({len(STOCKS)}銘柄)")
    results = []
    failed = []

    for i, stock in enumerate(STOCKS, start=1):
        print(f"[{i}/{len(STOCKS)}] {stock['name']} ({stock['code']}) を取得中...")
        data = fetch_one(stock)
        if data is not None:
            results.append(data)
        else:
            failed.append(stock["code"])
        time.sleep(REQUEST_INTERVAL_SEC)

    output = {
        "generatedAt": datetime.now(JST).isoformat(),
        "stocks": results,
        "failedCodes": failed,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    buy_list = [s["name"] for s in results if s["signal"]["verdict"] == "買い時"]
    print(f"\n完了: {len(results)}銘柄取得成功, {len(failed)}銘柄失敗")
    if failed:
        print(f"失敗した銘柄コード: {failed}")
    if buy_list:
        print(f"買い時シグナル検知: {', '.join(buy_list)}")
    print(f"出力先: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
