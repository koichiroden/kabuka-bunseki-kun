# -*- coding: utf-8 -*-
"""
分析ロジック
- 長期トレンド判定（30/60/120/180/365日）
- 株価曲線の極小値（底値）判定
  一階差分がマイナス→プラスに転換し、かつ二階差分が正（下に凸）
- 総合スコアリング（-100〜100）と判定ラベル

React版(App.jsx)のcomputeSignalと同じ考え方をPythonに移植したもの。
フロント・バックで判定基準がズレないよう、ロジックを変更する場合は
両方に反映してください。
"""

from typing import List, Optional, Dict, Any


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


def detect_local_minimum(prices: List[float], lookback: int = 14) -> Dict[str, Any]:
    """
    直近lookback日の中で最小値を取る点が、
    - 直近3日以内に発生していて
    - その前後で下降→上昇に転換している（または下に凸）
    場合に「底値」と判定する。
    """
    n = len(prices)
    if n < lookback + 3:
        return {"is_bottom": False, "min_idx": None, "days_since_min": None, "min_price": None}

    recent = prices[n - lookback:]
    min_idx = min(range(len(recent)), key=lambda i: recent[i])
    days_since_min = len(recent) - 1 - min_idx
    is_recent = days_since_min <= 3

    before = recent[min_idx] - recent[min_idx - 2] if min_idx >= 2 else None
    after = recent[min_idx + 2] - recent[min_idx] if min_idx <= len(recent) - 3 else None

    was_falling = before < 0 if before is not None else True
    now_rising = after > 0 if after is not None else False

    curvature = None
    if 2 <= min_idx <= len(recent) - 3:
        curvature = recent[min_idx - 2] - 2 * recent[min_idx] + recent[min_idx + 2]
    is_convex_down = curvature > 0 if curvature is not None else now_rising

    is_bottom = is_recent and was_falling and (now_rising or is_convex_down)

    return {
        "is_bottom": is_bottom,
        "min_idx": min_idx,
        "days_since_min": days_since_min,
        "min_price": recent[min_idx],
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
    bottom = detect_local_minimum(prices)

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

    return {"trends": trends, "bottom": bottom, "score": score, "verdict": verdict}
