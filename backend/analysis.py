# -*- coding: utf-8 -*-
"""
分析ロジック
- 長期トレンド判定（30/60/120/180/365日の変化率）
- 株価の30日移動平均線の極小値（底値）判定
  移動平均線が下降→上昇に転換し、かつ下に凸になっているタイミングを検出する。
  生の終値は日々のノイズが大きく、底値判定が不安定になりやすいため、
  30日移動平均線というなめらかにした曲線の上で極小値を探す方式にしている。
- グランビルの法則を参考にした買い時/売り時判定
  90日移動平均線（長期）・30日移動平均線（中期）・日々の株価（短期/日次）
  それぞれの向き（上昇/横ばい/下降）の組み合わせから判定する。
- 総合スコアリング（-100〜100）と判定ラベル

React版(App.jsx)のcomputeSignalと同じ考え方をPythonに移植したもの。
フロント・バックで判定基準がズレないよう、ロジックを変更する場合は
両方に反映してください。
"""

from typing import List, Optional, Dict, Any

SMA_WINDOW = 30       # 中期移動平均（底値判定・グランビルの中期トレンドに使用）
SMA_LONG_WINDOW = 90  # 長期移動平均（グランビルの長期トレンドに使用）


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


def simple_moving_average(prices: List[float], window: int) -> List[Optional[float]]:
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


def trend_direction(
    series: List[Optional[float]], lookback: int, flat_threshold_pct: float = 0.5
) -> Optional[str]:
    """
    seriesの「直近の値」と「lookback本前の値」を比較して、
    "up"（↗上昇）/ "flat"（→横ばい）/ "down"（↘下降）のいずれかを返す。
    Noneが混じっていても、有効な値だけを見て判定する。
    変化率の絶対値が flat_threshold_pct 未満なら「横ばい」とみなす。
    """
    valid = [v for v in series if v is not None]
    if len(valid) < lookback + 1:
        return None
    latest = valid[-1]
    past = valid[-1 - lookback]
    if past == 0:
        return None
    change_pct = (latest - past) / past * 100
    if change_pct > flat_threshold_pct:
        return "up"
    if change_pct < -flat_threshold_pct:
        return "down"
    return "flat"


# グランビルの法則を参考にした、90日(長期)・30日(中期)・日次(短期)の
# トレンドの向きの組み合わせから「買い/売り」を判定するテーブル。
# ユーザー提供の判定表をそのまま反映したもの。
# キーは (90日トレンド, 30日トレンド, 日次トレンド) の3つ組。
GRANVILLE_TABLE: Dict[tuple, str] = {
    ("up", "up", "up"): "buy",
    ("up", "up", "flat"): "buy",
    ("up", "flat", "up"): "buy",
    ("flat", "up", "up"): "buy",
    ("flat", "up", "flat"): "buy",
    ("down", "up", "up"): "buy",
    ("down", "up", "flat"): "buy",
    ("up", "down", "down"): "sell",
    ("up", "down", "flat"): "sell",
    ("flat", "down", "down"): "sell",
    ("down", "up", "down"): "sell",
    ("down", "flat", "down"): "sell",
    ("down", "down", "up"): "sell",
    ("down", "down", "flat"): "sell",
    ("down", "down", "down"): "sell",
}


def classify_granville(
    trend90: Optional[str], trend30: Optional[str], trend_daily: Optional[str]
) -> Dict[str, Any]:
    """
    90日・30日・日次それぞれのトレンド方向から、グランビルの法則を参考にした
    「買い/売り/様子見」判定を返す。

    注意: ユーザー指定の判定表は、3つの向き(上昇/横ばい/下降)の組み合わせ
    27通りのうち15通りだけを定義したものなので、表にない残り12通りについては
    「上昇・下降のシグナル数が多い方」で多数決判定するフォールバックを実装している
    （同数の場合は"様子見"）。この部分は判定表に無い組み合わせを補うための
    Claudeの判断による拡張なので、必要に応じて GRANVILLE_TABLE に
    明示的な組み合わせを追記して上書きしてください。
    """
    if trend90 is None or trend30 is None or trend_daily is None:
        return {"trend90": trend90, "trend30": trend30, "trendDaily": trend_daily, "verdict": None}

    key = (trend90, trend30, trend_daily)
    if key in GRANVILLE_TABLE:
        verdict = GRANVILLE_TABLE[key]
    else:
        ups = key.count("up")
        downs = key.count("down")
        if ups > downs:
            verdict = "buy"
        elif downs > ups:
            verdict = "sell"
        else:
            verdict = "hold"

    return {"trend90": trend90, "trend30": trend30, "trendDaily": trend_daily, "verdict": verdict}


def compute_signal(prices: List[float]) -> Dict[str, Any]:
    """トレンド・底値判定・グランビル判定・総合スコアをまとめて返す"""
    trends = {
        "d30": period_trend(prices, 30),
        "d60": period_trend(prices, 60),
        "d120": period_trend(prices, 120),
        "d180": period_trend(prices, 180),
        "d365": period_trend(prices, 365),
    }
    sma30 = simple_moving_average(prices, SMA_WINDOW)
    sma90 = simple_moving_average(prices, SMA_LONG_WINDOW)
    bottom = detect_local_minimum(sma30)

    # グランビルの法則向けのトレンド方向判定
    # - 長期(90日線): 直近10営業日での傾き
    # - 中期(30日線): 直近5営業日での傾き
    # - 日次(短期): 生の株価の直近2営業日での傾き
    trend90 = trend_direction(sma90, lookback=10)
    trend30 = trend_direction(sma30, lookback=5)
    trend_daily = trend_direction(prices, lookback=2, flat_threshold_pct=0.3)
    granville = classify_granville(trend90, trend30, trend_daily)

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

    return {
        "trends": trends,
        "bottom": bottom,
        "score": score,
        "verdict": verdict,
        "sma30": sma30,
        "sma90": sma90,
        "granville": granville,
    }
