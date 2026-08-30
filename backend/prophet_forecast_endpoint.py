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
  の両方が反映される。

2つのモデルを選べる理由:
  SMA30/90を説明変数(add_regressor)として加えると、予測が移動平均線に
  引っ張られて滑らかになる一方、日々の値動きの荒さ(ノイズ)への反応が鈍り、
  短期的な予測精度が落ちる場合があることが分かった。
  そこで、性質の異なる2つのモデルを両方計算して返し、フロントエンド側で
  ユーザーが選べるようにしている。

  - "noise" (ノイズ/ランダム性重視モデル):
      SMA regressorを使わず、生の終値だけで学習。changepoint_prior_scaleを
      高め(0.5)にして、Prophet自身のトレンド変化点検出をより柔軟にし、
      日々の値動きの荒さ・急な転換にも反応しやすくしている。
  - "trend" (トレンド重視モデル):
      SMA30/90をregressorとして追加し、changepoint_prior_scaleを
      低め(0.05, Prophetのデフォルト)にして、移動平均線に沿った
      滑らかで方向性の出やすい予測にしている。
      【制約】将来のSMA30/90は本来わからないため、直近の実測値を
      横ばいで据え置く簡易近似を置いている(fit_and_forecast参照)。

エンドポイント:
  GET /api/forecast?ticker=7203&buy_date=2026-08-20

  戻り値:
  {
    "ticker": "7203",
    "noise": { "dates":[...], "p10":[...], "p25":[...], "p50":[...], "p75":[...], "p90":[...] },
    "trend": { "dates":[...], "p10":[...], "p25":[...], "p50":[...], "p75":[...], "p90":[...] }
  }

注意:
  1回のリクエストでモデルを2つ学習するため、以前より応答時間がやや長くなる
  (銘柄1件あたり数秒〜十数秒程度)。アクセス頻度が高い場合は、銘柄コード単位で
  結果を一定時間(例:1日)キャッシュすることを推奨する。
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

MODEL_CONFIGS = {
    "noise": {"use_regressors": False, "changepoint_prior_scale": 0.5},
    "trend": {"use_regressors": True, "changepoint_prior_scale": 0.05},
}


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


def fit_and_forecast(df_full: pd.DataFrame, future_dates, config: dict) -> dict:
    """
    df_full: ds/y/sma30/sma90 を含むフルの学習データフレーム(dropna前)
    config: MODEL_CONFIGSの1エントリ
    """
    if config["use_regressors"]:
        # SMA30/90は先頭部分がNone(データ不足で未計算)なので、regressorとして使える行だけに絞る
        df = df_full.dropna(subset=REGRESSOR_COLUMNS).reset_index(drop=True)
    else:
        df = df_full[["ds", "y"]].dropna().reset_index(drop=True)

    if len(df) < 60:
        return None

    m = Prophet(
        weekly_seasonality=False,
        yearly_seasonality=False,
        daily_seasonality=False,
        interval_width=0.8,
        changepoint_prior_scale=config["changepoint_prior_scale"],
    )

    future_df = pd.DataFrame({"ds": future_dates})
    if config["use_regressors"]:
        for col in REGRESSOR_COLUMNS:
            m.add_regressor(col)
        # 将来のSMA30/90は本来わからないため、直近の実測値を横ばいで据え置く簡易近似
        last_known = {col: float(df[col].iloc[-1]) for col in REGRESSOR_COLUMNS}
        for col in REGRESSOR_COLUMNS:
            future_df[col] = last_known[col]
        m.fit(df[["ds", "y"] + REGRESSOR_COLUMNS])
    else:
        m.fit(df[["ds", "y"]])

    samples = m.predictive_samples(future_df)
    yhat_samples = samples["yhat"]  # shape: (len(future_df), サンプル数)

    percentiles = {10: [], 25: [], 50: [], 75: [], 90: []}
    for i in range(len(future_df)):
        row_samples = yhat_samples[i, :]
        for p in percentiles:
            percentiles[p].append(round(float(np.percentile(row_samples, p)), 1))

    return {
        "dates": [d.strftime("%Y-%m-%d") for d in future_dates],
        "p10": percentiles[10],
        "p25": percentiles[25],
        "p50": percentiles[50],
        "p75": percentiles[75],
        "p90": percentiles[90],
    }


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
    if len(prices) < 60:
        return jsonify({"error": "学習に十分な価格データがありません"}), 422

    df_full = pd.DataFrame({
        "ds": pd.to_datetime(dates),
        "y": prices,
        "sma30": sma30 if sma30 else [None] * len(prices),
        "sma90": sma90 if sma90 else [None] * len(prices),
    })

    last_actual_date = df_full["ds"].max()
    target_date = add_months(buy_date, 6)
    if target_date <= last_actual_date:
        target_date = last_actual_date + timedelta(days=1)
    future_dates = pd.bdate_range(
        start=last_actual_date + timedelta(days=1), end=target_date
    )

    results = {}
    for model_key, config in MODEL_CONFIGS.items():
        result = fit_and_forecast(df_full, future_dates, config)
        if result is None:
            return jsonify({"error": f"モデル({model_key})の学習に十分なデータがありません"}), 422
        results[model_key] = result

    return jsonify({
        "ticker": ticker,
        "noise": results["noise"],
        "trend": results["trend"],
    })


# 既存の app.py 側での登録例:
#   from prophet_forecast_endpoint import forecast_bp
#   app.register_blueprint(forecast_bp)
