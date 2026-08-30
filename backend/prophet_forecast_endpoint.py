# -*- coding: utf-8 -*-
"""
株価売り時くん — Prophetベース予測エンドポイント

株価分析くんの既存Flaskアプリに追加するBlueprint。
分析くんがすでに生成している data/stocks.json (dates/prices/sma30/sma90) を学習データとして使い、
Prophetで「今日〜購入日+6ヶ月」の価格分布(tile10/25/50/75/90)を予測する。

なぜProphetか（GBMからの変更点）:
  以前のGBM(幾何ブラウン運動)モデルは、direct180日騰落率を一定のドリフトとして
  そのまま複利で将来に引き延ばすだけだったため、「トレンドが今後半年間まったく
  同じペースで続く」という前提が強すぎ、tile90ですら一方向に流れてしまう問題があった。

  Prophetは変化点検出(changepoint detection)により将来のトレンド自体の不確実性も
  推定するため、predictive_samples()で得られるサンプル群には
    - トレンド変化点の不確実性（トレンドが今後も同じ傾きで続くとは限らない）
    - 観測ノイズ(残差)の不確実性
  の両方が反映される。これにより、長期になるほどtile10〜90の帯が
  現実的に広がり、必ずしも一方向に収束しない予測になる。

説明変数(regressor)としてのSMA30/SMA90:
  分析くんがすでに計算済みのSMA30(中期線)・SMA90(長期線)を、生の終値(y)とは別に
  Prophetの外部説明変数(add_regressor)として渡している。これにより、
  「移動平均線からの乖離が大きい状態から、平均線に収束していく力」のような
  グランビルの法則的な値動きの性質もモデルに反映される。

  【重要な制約】add_regressorは「将来の説明変数の値」も必要とするが、
  SMA30/90は本来「将来の終値」に依存する値なので、未来の正確な値は原理上わからない。
  この実装では簡易的に「直近の実測SMA値を将来も横ばいで据え置く」という
  仮定を置いている(下記 build_future_regressors 参照)。これは近似であり、
  実際にトレンドが大きく動いた場合はこの仮定がズレる点に注意。
  より厳密にするなら、SMA自体も別途時系列予測するか、regressorを使わない
  設計に戻すことも検討の余地がある。

エンドポイント:
  GET /api/forecast?ticker=7203&buy_date=2026-08-20

  戻り値:
  {
    "ticker": "7203",
    "dates": ["2026-08-31", "2026-09-01", ...],   # 今日の翌営業日〜購入日+6ヶ月
    "p10": [...], "p25": [...], "p50": [...], "p75": [...], "p90": [...]
  }

注意:
  Prophetのモデル学習(fit)はリクエストのたびに毎回実行しており、銘柄1件あたり
  数秒程度かかる。アクセス頻度が高い場合は、銘柄コード単位で結果を
  一定時間(例:1日)キャッシュすることを推奨する。
  また、Render等の無料プランではProphetのビルド(cmdstanのコンパイル)に
  時間がかかり、ビルドがタイムアウトする可能性がある点に注意。
"""

import json
from pathlib import Path
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from flask import Blueprint, request, jsonify
from prophet import Prophet

forecast_bp = Blueprint("forecast", __name__)

DATA_PATH = Path(__file__).parent / "data" / "stocks.json"

REGRESSOR_COLUMNS = ["sma30", "sma90"]


def load_stock_series(ticker: str):
    if not DATA_PATH.exists():
        return None
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    for s in data.get("stocks", []):
        if s["code"] == ticker:
            return s
    return None


def add_months(d: datetime, months: int) -> datetime:
    month = d.month - 1 + months
    year = d.year + month // 12
    month = month % 12 + 1
    day = min(d.day, 28)  # 月末日のズレを避けるための簡易対応
    return datetime(year, month, day)


def build_future_regressors(future_dates, last_known: dict) -> pd.DataFrame:
    """
    将来のSMA30/90は本来わからないため、直近の実測値を横ばいで据え置く簡易近似。
    (詳細はモジュールdocstring参照)
    """
    out = {"ds": future_dates}
    for col in REGRESSOR_COLUMNS:
        out[col] = [last_known[col]] * len(future_dates)
    return pd.DataFrame(out)


@forecast_bp.route("/api/forecast", methods=["GET"])
def forecast():
    ticker = request.args.get("ticker", "").strip()
    buy_date_str = request.args.get("buy_date", "").strip()

    if not ticker or not buy_date_str:
        return jsonify({"error": "ticker と buy_date は必須です"}), 400

    try:
        buy_date = datetime.strptime(buy_date_str, "%Y-%m-%d")
    except ValueError:
        return jsonify({"error": "buy_date は YYYY-MM-DD 形式で指定してください"}), 400

    stock = load_stock_series(ticker)
    if stock is None:
        return jsonify({"error": f"銘柄コード {ticker} のデータが見つかりません"}), 404

    dates = stock["dates"]
    prices = stock["prices"]
    sma30 = stock.get("sma30")
    sma90 = stock.get("sma90")
    if len(prices) < 60 or not sma30 or not sma90:
        return jsonify({"error": "学習に十分な価格・移動平均データがありません"}), 422

    df = pd.DataFrame({
        "ds": pd.to_datetime(dates),
        "y": prices,
        "sma30": sma30,
        "sma90": sma90,
    })
    # SMA30/90は先頭部分がNone(データ不足で未計算)なので、regressorとして使える行だけに絞る
    df = df.dropna(subset=REGRESSOR_COLUMNS).reset_index(drop=True)
    if len(df) < 60:
        return jsonify({"error": "移動平均が計算済みの学習データが不足しています"}), 422

    # 週次・年次の季節性は個別株の日足データには不要かつ過学習の原因になりやすいため無効化し、
    # トレンドの変化点検出(changepoint)・残差(誤差項)・SMA regressorの3つで予測する。
    m = Prophet(
        weekly_seasonality=False,
        yearly_seasonality=False,
        daily_seasonality=False,
        interval_width=0.8,
    )
    for col in REGRESSOR_COLUMNS:
        m.add_regressor(col)
    m.fit(df)

    last_actual_date = df["ds"].max()
    last_known = {col: float(df[col].iloc[-1]) for col in REGRESSOR_COLUMNS}

    target_date = add_months(buy_date, 6)
    if target_date <= last_actual_date:
        target_date = last_actual_date + timedelta(days=1)

    future_dates = pd.bdate_range(
        start=last_actual_date + timedelta(days=1), end=target_date
    )
    future_df = build_future_regressors(future_dates, last_known)

    samples = m.predictive_samples(future_df)
    yhat_samples = samples["yhat"]  # shape: (len(future_df), サンプル数)

    percentiles = {10: [], 25: [], 50: [], 75: [], 90: []}
    for i in range(len(future_df)):
        row_samples = yhat_samples[i, :]
        for p in percentiles:
            percentiles[p].append(round(float(np.percentile(row_samples, p)), 1))

    return jsonify({
        "ticker": ticker,
        "dates": [d.strftime("%Y-%m-%d") for d in future_dates],
        "p10": percentiles[10],
        "p25": percentiles[25],
        "p50": percentiles[50],
        "p75": percentiles[75],
        "p90": percentiles[90],
    })


# 既存の app.py 側での登録例:
#   from prophet_forecast_endpoint import forecast_bp
#   app.register_blueprint(forecast_bp)
