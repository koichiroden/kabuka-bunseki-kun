# -*- coding: utf-8 -*-
"""
分析ロジック
- 長期トレンド判定（30/60/120/180/365日の変化率）
- 株価の30日移動平均線の極小値（底値）判定
  移動平均線が下降→上昇に転換し、かつ下に凸になっているタイミングを検出する。
  生の終値は日々のノイズが大きく、底値判定が不安定になりやすいため、
  30日移動平均線というなめらかにした曲線の上で極小値を探す方式にしている。
- グランビルの法則（8つの売買シグナル）に基づく買い時/売り時の検出
  1本の移動平均線（30日線）と現在値（株価）の位置関係・移動平均線自体の
  向きから、買い4パターン・売り4パターンの合計8パターンを判定する。
  一致した候補日のうち「シグナルの強さスコア」（移動平均線からの乖離率と
  直近の値動きの強さ）が高い順に、買い・売りそれぞれ最大5日までを実際の
  シグナルとして抽出する。どの日がどのパターンで検知されたかも記録する。
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


# ---------- グランビルの法則（8つの売買シグナル） ----------
#
# 一般に「グランビルの法則」と呼ばれるのは、1本の移動平均線と現在値（株価）の
# 位置関係・移動平均線自体の向きから、買い4パターン・売り4パターン、
# 合計8つの売買シグナルを見つける手法です。このアプリでは、移動平均線として
# 30日移動平均線（中期線）を採用しています。
#
# 【買いシグナル】
#   ①横ばい/上向きの移動平均線を、現在値が下から上に抜けたとき
#   ②上向きの移動平均線を、現在値が一時的に下抜けたとき（押し目買い）
#   ③上向きの移動平均線に現在値が接近し、抜けずに反発したとき
#   ④下向きの移動平均線から現在値が大きく下に離れたとき（自律反発狙い）
# 【売りシグナル】
#   ⑤横ばい/下向きの移動平均線を、現在値が一時的に上抜けたとき
#   ⑥下向きの移動平均線を、現在値が上から下に抜けたとき
#   ⑦下向きの移動平均線に現在値が接近し、抜けずに反落したとき
#   ⑧上向きの移動平均線から現在値が大きく上に離れたとき（自律反落狙い）

GRANVILLE_MA_WINDOW = SMA_WINDOW  # グランビル判定に使う移動平均線（30日線）
GRANVILLE_NEAR_PCT = 2.0   # ③⑦「移動平均線に接近した」とみなす乖離率のしきい値(%)
GRANVILLE_FAR_PCT = 8.0    # ④⑧「移動平均線から大きく離れた」とみなすしきい値(%)
GRANVILLE_MOMENTUM_LOOKBACK = 5  # ③⑦の「反発/反落」を見るための直近の日数
GRANVILLE_LONG_LOOKBACK = 15     # ①⑤の「横ばい」の文脈（底/天井どちら側か）を判断する日数

GRANVILLE_RULE_LABELS: Dict[int, str] = {
    1: "①横ばい/上向きの移動平均線を現在値が上抜けたとき",
    2: "②上向きの移動平均線を現在値が一時的に下抜けたとき（押し目買い）",
    3: "③上向きの移動平均線に接近し、抜けずに反発したとき",
    4: "④下向きの移動平均線から現在値が大きく下に離れたとき（自律反発狙い）",
    5: "⑤横ばい/下向きの移動平均線を現在値が一時的に上抜けたとき",
    6: "⑥下向きの移動平均線を現在値が下抜けたとき",
    7: "⑦下向きの移動平均線に接近し、抜けずに反落したとき",
    8: "⑧上向きの移動平均線から現在値が大きく上に離れたとき（自律反落狙い）",
}

TOP_SIGNAL_COUNT = 5  # 銘柄ごとに、買い/売りそれぞれ上位何日までシグナリングするか


def find_granville_candidates(
    prices: List[float], ma: List[Optional[float]]
) -> List[Dict[str, Any]]:
    """
    株価(prices)と移動平均線(ma)の関係から、グランビルの法則8パターンに
    一致する候補日をすべて洗い出す。

    各候補は {"index", "type"(buy/sell), "rule"(1〜8), "label", "score"} の形。
    「score」は、その日の乖離率(%)の絶対値とモメンタム(直近の値動きの強さ%)を
    足し合わせたもので、値が大きいほどシグナルの根拠が強いとみなす。
    """
    n = len(prices)
    ma_dir = trend_info_series(ma, lookback=5, flat_threshold_pct=0.3)
    # 短期の向きが「横ばい」のときに①（買い）と⑤（売り）のどちらの文脈かを
    # 判断するための、より長い期間で見た移動平均線の大局的な向き。
    # 「横ばい」は本来「下降から横ばいへ転じた（→そろそろ底）」のか
    # 「上昇から横ばいへ転じた（→そろそろ天井）」のかで意味が正反対なので、
    # この大局観で切り分ける。
    ma_dir_long = trend_info_series(ma, lookback=GRANVILLE_LONG_LOOKBACK, flat_threshold_pct=0.5)
    candidates: List[Dict[str, Any]] = []

    for i in range(1, n):
        if ma[i] is None or ma[i - 1] is None or ma_dir[i] is None:
            continue

        p, p_prev = prices[i], prices[i - 1]
        m, m_prev = ma[i], ma[i - 1]
        direction = ma_dir[i]["direction"]  # 移動平均線自体の向き: up/flat/down
        long_direction = ma_dir_long[i]["direction"] if ma_dir_long[i] is not None else None

        if m == 0:
            continue
        deviation_pct = (p - m) / m * 100  # 移動平均線からの乖離率(%): 正=上、負=下

        momentum_pct = None
        if i >= GRANVILLE_MOMENTUM_LOOKBACK:
            base = prices[i - GRANVILLE_MOMENTUM_LOOKBACK]
            if base != 0:
                momentum_pct = (p - base) / base * 100

        cross_up = p_prev < m_prev and p >= m    # 下から上へ移動平均線を突破
        cross_down = p_prev >= m_prev and p < m  # 上から下へ移動平均線を突破

        score = abs(deviation_pct) + (abs(momentum_pct) if momentum_pct is not None else 0)

        def add(verdict: str, rule: int) -> None:
            candidates.append(
                {
                    "index": i,
                    "type": verdict,
                    "rule": rule,
                    "label": GRANVILLE_RULE_LABELS[rule],
                    "score": score,
                }
            )

        # --- 買いシグナル ---
        if cross_up and (
            direction == "up" or (direction == "flat" and long_direction != "up")
        ):
            add("buy", 1)
        if direction == "up" and cross_down:
            add("buy", 2)
        if (
            direction == "up"
            and 0 < deviation_pct <= GRANVILLE_NEAR_PCT
            and momentum_pct is not None
            and momentum_pct > 0
        ):
            add("buy", 3)
        if direction == "down" and deviation_pct <= -GRANVILLE_FAR_PCT:
            add("buy", 4)

        # --- 売りシグナル ---
        if cross_up and (
            direction == "down" or (direction == "flat" and long_direction == "up")
        ):
            add("sell", 5)
        if direction == "down" and cross_down:
            add("sell", 6)
        if (
            direction == "down"
            and -GRANVILLE_NEAR_PCT <= deviation_pct < 0
            and momentum_pct is not None
            and momentum_pct < 0
        ):
            add("sell", 7)
        if direction == "up" and deviation_pct >= GRANVILLE_FAR_PCT:
            add("sell", 8)

    return candidates


def compute_granville_signals(
    prices: List[float], ma: List[Optional[float]]
) -> Dict[str, Any]:
    """
    グランビルの法則8パターンの候補日を洗い出し、買い・売りそれぞれ
    「シグナルの強さスコア」が高い順に最大 TOP_SIGNAL_COUNT 件までを抽出する。

    同じ日に複数のパターンが同時に該当した場合は、その日・その方向（買い/売り）
    についてスコアが最も高いパターン1つだけを採用する（1日に複数の理由が
    重複して表示されるのを防ぐため）。

    候補が TOP_SIGNAL_COUNT 件に満たない場合は、無理に件数を揃えたりはせず、
    実際に存在する件数（0〜4件）だけをそのままシグナルとする。

    戻り値:
      {
        "signals": pricesと同じ長さのリスト（各要素は "buy"/"sell"/None）
                   → グラフ上に点を打つ用
        "details": [{"index","type","rule","label","score"}, ...]
                   → 「いつ・なぜシグナリングされたか」を一覧表示する用
                     （日付順に並べ替え済み）
      }
    """
    n = len(prices)
    candidates = find_granville_candidates(prices, ma)

    # 同じ日・同じ方向の候補が複数ある場合は、スコア最大のものだけを残す
    best_by_key: Dict[tuple, Dict[str, Any]] = {}
    for c in candidates:
        key = (c["index"], c["type"])
        if key not in best_by_key or c["score"] > best_by_key[key]["score"]:
            best_by_key[key] = c

    by_type: Dict[str, List[Dict[str, Any]]] = {"buy": [], "sell": []}
    for c in best_by_key.values():
        by_type[c["type"]].append(c)

    kept: List[Dict[str, Any]] = []
    for verdict, items in by_type.items():
        items.sort(key=lambda c: c["score"], reverse=True)
        kept.extend(items[:TOP_SIGNAL_COUNT])

    kept.sort(key=lambda c: c["index"])

    signals: List[Optional[str]] = [None] * n
    for c in kept:
        signals[c["index"]] = c["type"]

    return {"signals": signals, "details": kept}


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
    granville = compute_granville_signals(prices, sma30)

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
        "granvilleSignals": granville["signals"],
        "granvilleSignalDetails": granville["details"],
    }
