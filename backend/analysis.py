# -*- coding: utf-8 -*-
"""
分析ロジック
- 長期トレンド判定（30/60/120/180/365日）
- 株価の30日移動平均線の極小値（底値）判定
  移動平均線が下降→上昇に転換し、かつ下に凸になっているタイミングを検出する。
  生の終値は日々のノイズが大きく、底値判定が不安定になりやすいため、
  30日移動平均線というなめらかにした曲線の上で極小値を探す方式にしている。
- 総合スコアリング（-100〜100）と判定ラベル

React版(App.jsx)のcomputeSignalと同じ考え方をPythonに移植したもの。
フロント・バックで判定基準がズレないよう、ロジックを変更する場合は
両方に反映してください。
"""

from typing import List, Optional, Dict, Any

SMA_WINDOW = 30  # 移動平均の日数


def period_trend(prices: List[float], window: int) -> Optional[float]:
    """期間の始値に対する終値の変化率(%)"""
    n = len(prices)
    if n < window + 1:
        return None
    start = prices[n - window - 1]
    end = prices[-1]
    if start == 0:
        return None
    return (end - start) / start * 100


def simple_moving_average(prices: List[float], window: int = SMA_WINDOW) -> List[Optional[float]]:
    """
    単純移動平均(SMA)を計算する。
    pricesと同じ長さのリストを返し、window日分のデータが
    まだ揃っていない先頭部分は None を入れる（グラフ描画側で穴として扱う）。
    """
    n = len(prices)
    sma: List[Optional[float]] = [None] * n
    running_sum = 0.0
    for i in range(n):
        running_sum += prices[i]
        if i >= window:
            running_sum -= prices[i - window]
        if i >= window - 1:
            sma[i] = round(running_sum / window, 2)
    return sma


def detect_local_minimum(sma: List[Optional[float]], lookback: int = 20) -> Dict[str, Any]:
    """
    30日移動平均線(sma)の直近lookback日分の中で最小値を取る点が、
    - 直近3日以内に発生していて
    - その前後で下降→上昇に転換している（または下に凸）
    場合に「底値」と判定する。

    生の株価ではなく移動平均線に対して判定することで、
    日々の小さな上下（ノイズ）を谷だと誤判定するのを防いでいる。
    """
    # SMAはwindow日分そろうまでNoneが続くので、有効な値だけを取り出す
    valid = [(i, v) for i, v in enumerate(sma) if v is not None]
    if len(valid) < lookback + 3:
        return {"is_bottom": False, "min_idx": None, "days_since_min": None, "min_price": None, "curvature": None}

    recent = valid[-lookback:]  # [(元のインデックス, 値), ...]
    recent_values = [v for _, v in recent]

    min_pos = min(range(len(recent_values)), key=lambda i: recent_values[i])
    min_idx_original = recent[min_pos][0]  # sma配列全体の中でのインデックス（フロントとの互換のため）
    days_since_min = len(recent) - 1 - min_pos
    is_recent = days_since_min <= 3

    before = recent_values[min_pos] - recent_values[min_pos - 2] if min_pos >= 2 else None
    after = recent_values[min_pos + 2] - recent_values[min_pos] if min_pos <= len(recent_values) - 3 else None

    was_falling = before < 0 if before is not None else True
    now_rising = after > 0 if after is not None else False

    curvature = None
    if 2 <= min_pos <= len(recent_values) - 3:
        curvature = recent_values[min_pos - 2] - 2 * recent_values[min_pos] + recent_values[min_pos + 2]
    is_convex_down = curvature > 0 if curvature is not None else now_rising

    is_bottom = is_recent and was_falling and (now_rising or is_convex_down)

    return {
        "is_bottom": is_bottom,
        # min_idxは「移動平均線(sma)配列全体」の中でのインデックス。
        # 生の価格配列(prices)とインデックスが対応しているので、
        # フロント側で底値の点をグラフ上にハイライトする際もそのまま使える。
        "min_idx": min_idx_original,
        "days_since_min": days_since_min,
        "min_price": recent_values[min_pos],
        "curvature": curvature,
    }


def compute_signal(prices: List[float]) -> Dict[str, Any]:
    """トレンド・底値判定・総合スコアをまとめて返す"""
    trends = {
        "d30": period_trend(prices, 30),
        "d60": period_trend(prices, 60),
        "d120": period_trend(prices, 120),
        "d180": period_trend(prices, 180),
        "d365": period_trend(prices, 365),
    }
    sma30 = simple_moving_average(prices, SMA_WINDOW)
    bottom = detect_local_minimum(sma30)

    score = 0
    if trends["d365"] is not None:
        score += 15 if trends["d365"] < 0 else -5
    if trends["d180"] is not None:
        score += 15 if trends["d180"] < 0 else -5
    if trends["d120"] is not None:
        score += 10 if trends["d120"] < 5 else -5
    if trends["d60"] is not None:
        score += 5 if -8 < trends["d60"] < 8 else 0
    if trends["d30"] is not None:
        score += 15 if trends["d30"] > 0 else -10
    if bottom["is_bottom"]:
        score += 35

    score = max(-100, min(100, score))

    if bottom["is_bottom"] and score >= 40:
        verdict = "買い時"
    elif score >= 20:
        verdict = "注目"
    elif score < -10:
        verdict = "割高"
    else:
        verdict = "様子見"

    return {"trends": trends, "bottom": bottom, "score": score, "verdict": verdict, "sma30": sma30}
