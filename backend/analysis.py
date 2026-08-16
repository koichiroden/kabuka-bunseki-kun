# -*- coding: utf-8 -*-
"""
分析ロジック
- 長期トレンド判定（30/60/120/180/365日の変化率）
- 株価の30日移動平均線の極小値（底値）判定
  移動平均線が下降→上昇に転換し、かつ下に凸になっているタイミングを検出する。
  生の終値は日々のノイズが大きく、底値判定が不安定になりやすいため、
  30日移動平均線というなめらかにした曲線の上で極小値を探す方式にしている。
- グランビルの法則を参考にした「買い時/売り時スコア」の算出と
  上位シグナルの抽出
  90日移動平均線（長期）・30日移動平均線（中期）・日々の株価（短期/日次）
  それぞれの向き（上昇/横ばい/下降）の組み合わせが、あらかじめ定義した
  判定表に一致する日を候補とし、その中から「シグナルの強さスコア」
  （3つの時間軸の変化率の絶対値の合計）が高い順に、買い・売りそれぞれ
  上位5日だけを実際のシグナルとして抽出する。候補が5日に満たない銘柄は
  その方向をシグナリングしない。
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


def trend_info_series(
    series: List[Optional[float]], lookback: int, flat_threshold_pct: float = 0.5
) -> List[Optional[Dict[str, Any]]]:
    """
    seriesの「各時点」について、"その時点の値"と"そこからlookback本前(有効値ベース)の値"
    を比較し、向き（"up"/"flat"/"down"）と、その変化率(%)の両方を求める。
    変化率はあとで「シグナルの強さ（スコア）」を計算するために使う
    （変化率の絶対値が大きいほど、その時間軸でのトレンドがはっきりしている、とみなす）。
    Noneが混じっていても、有効な値だけを数えてlookback本前を探す。
    seriesと同じ長さのリストを返す（各要素は {"direction":..., "changePct":...} かNone）。
    """
    n = len(series)
    result: List[Optional[Dict[str, Any]]] = [None] * n
    valid_positions = [i for i, v in enumerate(series) if v is not None]

    for pos_in_valid, orig_idx in enumerate(valid_positions):
        if pos_in_valid < lookback:
            continue
        past_orig_idx = valid_positions[pos_in_valid - lookback]
        past = series[past_orig_idx]
        cur = series[orig_idx]
        if past == 0:
            continue
        change_pct = (cur - past) / past * 100
        if change_pct > flat_threshold_pct:
            direction = "up"
        elif change_pct < -flat_threshold_pct:
            direction = "down"
        else:
            direction = "flat"
        result[orig_idx] = {"direction": direction, "changePct": change_pct}

    return result


# グランビルの法則を参考にした、90日(長期)・30日(中期)・日次(短期)の
# トレンドの向きの組み合わせから「買い/売り」を判定するテーブル。
# ユーザー提供の判定表をそのまま反映したもの。
# キーは (90日トレンド, 30日トレンド, 日次トレンド) の3つ組。
#
# 注意: 3方向 × 3方向 × 3方向 = 27通りの組み合わせのうち、
# ここに定義されているのは明示的に指定された15通り（買い7通り・売り8通り）だけ。
# 表にない残り12通りの組み合わせの日は「買い」でも「売り」でもない扱いとする。
# あいまいな組み合わせを多数決などで無理に買い/売りに分類しない、というのが
# 今回の設計方針。
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

TOP_SIGNAL_COUNT = 5  # 銘柄ごとに、買い/売りそれぞれ上位何日までシグナリングするか


def compute_granville_signals(
    prices: List[float], sma30: List[Optional[float]], sma90: List[Optional[float]]
) -> List[Optional[str]]:
    """
    株価の全履歴について、日ごとに90日線・30日線・日次の向きの組み合わせを求め、
    GRANVILLE_TABLE に明確に定義されている「買い」「売り」の候補日を洗い出したうえで、
    それぞれの「シグナルの強さスコア」（後述）が高い順に、買い・売りそれぞれ最大
    TOP_SIGNAL_COUNT件までを実際のシグナルとして残す。

    スコアは「90日線・30日線・日次それぞれの変化率(%)の絶対値の合計」。
    3つの時間軸すべてで値動きがはっきりしている日ほど、スコアが高くなる
    （＝より根拠が強い、と考える）。

    候補日がTOP_SIGNAL_COUNT件に満たない場合は、無理に5件に揃えたりはせず、
    実際に候補として存在する日（0〜4件）だけをそのままシグナルとする。
    候補が0件なら、その方向は結果としてシグナルなしになる。

    pricesと同じ長さのリスト（各要素は "buy" / "sell" / None）を返す。
    """
    info90 = trend_info_series(sma90, lookback=10)
    info30 = trend_info_series(sma30, lookback=5)
    info_daily = trend_info_series(prices, lookback=2, flat_threshold_pct=0.3)

    n = len(prices)
    candidates: Dict[str, List[tuple]] = {"buy": [], "sell": []}  # [(index, score), ...]

    for i in range(n):
        i90, i30, idaily = info90[i], info30[i], info_daily[i]
        if i90 is None or i30 is None or idaily is None:
            continue
        key = (i90["direction"], i30["direction"], idaily["direction"])
        verdict = GRANVILLE_TABLE.get(key)
        if verdict is None:
            continue
        score = abs(i90["changePct"]) + abs(i30["changePct"]) + abs(idaily["changePct"])
        candidates[verdict].append((i, score))

    signals: List[Optional[str]] = [None] * n
    for verdict, items in candidates.items():
        # items.sort + [:TOP_SIGNAL_COUNT] は、候補が5件未満でもそのまま
        # 全件（0〜4件）を残す。無理に5件へ水増しすることはない。
        items.sort(key=lambda pair: pair[1], reverse=True)
        for idx, _score in items[:TOP_SIGNAL_COUNT]:
            signals[idx] = verdict

    return signals


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
    granville_signals = compute_granville_signals(prices, sma30, sma90)

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
        "granvilleSignals": granville_signals,
    }
