# -*- coding: utf-8 -*-
"""
分析ロジック
- 長期トレンド判定（30/60/120/180/365日の変化率）
- 株価の30日移動平均線の極小値（底値）判定
  移動平均線が下降→上昇に転換し、かつ下に凸になっているタイミングを検出する。
  生の終値は日々のノイズが大きく、底値判定が不安定になりやすいため、
  30日移動平均線というなめらかにした曲線の上で極小値を探す方式にしている。
- グランビルの法則を参考にした「明確に買い時/売り時だった日」の検出
  90日移動平均線（長期）・30日移動平均線（中期）・日々の株価（短期/日次）
  それぞれの向き（上昇/横ばい/下降）の組み合わせが、あらかじめ定義した
  判定表に一致する日だけを「買い」「売り」として抽出する（あいまいな
  組み合わせは無理に多数決で判定せず、マークしない）。
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


def trend_direction_series(
    series: List[Optional[float]], lookback: int, flat_threshold_pct: float = 0.5
) -> List[Optional[str]]:
    """
    seriesの「各時点」について、"その時点の値"と"そこからlookback本前(有効値ベース)の値"
    を比較し、"up"（↗上昇）/ "flat"（→横ばい）/ "down"（↘下降）を判定する。
    Noneが混じっていても、有効な値だけを数えてlookback本前を探す。
    データが足りない先頭部分はNoneのままになる。
    seriesと同じ長さのリストを返す。
    """
    n = len(series)
    result: List[Optional[str]] = [None] * n
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
            result[orig_idx] = "up"
        elif change_pct < -flat_threshold_pct:
            result[orig_idx] = "down"
        else:
            result[orig_idx] = "flat"

    return result


# グランビルの法則を参考にした、90日(長期)・30日(中期)・日次(短期)の
# トレンドの向きの組み合わせから「買い/売り」を判定するテーブル。
# ユーザー提供の判定表をそのまま反映したもの。
# キーは (90日トレンド, 30日トレンド, 日次トレンド) の3つ組。
#
# 注意: 3方向 × 3方向 × 3方向 = 27通りの組み合わせのうち、
# ここに定義されているのは明示的に指定された15通りだけ。
# 表にない残り12通りの組み合わせの日は「買い」でも「売り」でもない
# （＝グラフ上には何もマークしない）扱いとする。
# あいまいな組み合わせを多数決などで無理に買い/売りに分類しない、というのが
# 今回の設計方針（「基準に明確にひっかかる日だけを可視化したい」という要望のため）。
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


def compute_granville_signals(
    prices: List[float], sma30: List[Optional[float]], sma90: List[Optional[float]]
) -> List[Optional[str]]:
    """
    株価の全履歴について、日ごとに90日線・30日線・日次の向きの組み合わせを求め、
    GRANVILLE_TABLE に明確に定義されている「買い」「売り」の日だけを抽出する。
    表にない組み合わせの日はNone（マークしない）。
    pricesと同じ長さのリスト（各要素は "buy" / "sell" / None）を返す。
    """
    trend90_series = trend_direction_series(sma90, lookback=10)
    trend30_series = trend_direction_series(sma30, lookback=5)
    trend_daily_series = trend_direction_series(prices, lookback=2, flat_threshold_pct=0.3)

    n = len(prices)
    signals: List[Optional[str]] = [None] * n
    for i in range(n):
        t90, t30, td = trend90_series[i], trend30_series[i], trend_daily_series[i]
        if t90 is None or t30 is None or td is None:
            continue
        key = (t90, t30, td)
        if key in GRANVILLE_TABLE:
            signals[i] = GRANVILLE_TABLE[key]

    return signals


def simulate_granville_backtest(
    prices: List[float], dates: List[str], signals: List[Optional[str]]
) -> Dict[str, Any]:
    """
    「買い」シグナルの日に1株買い、「売り」シグナルの日に1株売っていたら、
    最新日時点でどうなっているかをシミュレーションする。

    FIFO（先入れ先出し）方式で買いと売りを順番にペアリングする:
    - 買いシグナルの時点で、未決済の「売り」（空売り）があれば、
      それを1件決済する（＝空売りの買い戻し）。無ければ新たに1株買って保有する。
    - 売りシグナルの時点で、未決済の「買い」（保有株）があれば、
      それを1件決済する（＝保有株の売却）。無ければ新たに1株空売りする。

    最終的に未決済の買い（保有株）や売り（空売り）が残っている場合は、
    最新日の株価で評価した含み損益も合わせて計算する。
    """
    buy_open: List[float] = []   # 未決済の買い建玉（購入価格のリスト）
    sell_open: List[float] = []  # 未決済の空売り建玉（売却価格のリスト）
    realized_pnl = 0.0
    buy_count = 0
    sell_count = 0
    first_trade_date: Optional[str] = None
    last_trade_date: Optional[str] = None

    for i, sig in enumerate(signals):
        if sig not in ("buy", "sell"):
            continue
        price = prices[i]
        date = dates[i] if i < len(dates) else None
        if first_trade_date is None:
            first_trade_date = date
        last_trade_date = date

        if sig == "buy":
            buy_count += 1
            if sell_open:
                # 空売りしていた分を買い戻して決済（利益 = 売った価格 - 買い戻した価格）
                sold_price = sell_open.pop(0)
                realized_pnl += sold_price - price
            else:
                buy_open.append(price)
        else:  # sell
            sell_count += 1
            if buy_open:
                # 保有していた株を売却して決済（利益 = 売った価格 - 買った価格）
                bought_price = buy_open.pop(0)
                realized_pnl += price - bought_price
            else:
                sell_open.append(price)

    latest_price = prices[-1] if prices else None
    position = len(buy_open) - len(sell_open)  # 正=保有株数、負=空売り株数

    unrealized_pnl = 0.0
    avg_price: Optional[float] = None
    if buy_open:
        avg_price = sum(buy_open) / len(buy_open)
        unrealized_pnl = (latest_price - avg_price) * len(buy_open)
    elif sell_open:
        avg_price = sum(sell_open) / len(sell_open)
        unrealized_pnl = (avg_price - latest_price) * len(sell_open)

    if position > 0:
        status = "holding"  # 買いが残っていて、まだ売っていない（保有中）
    elif position < 0:
        status = "shorting"  # 売りが残っていて、まだ買い戻していない（空売り中）
    else:
        status = "flat"  # ちょうど買いと売りが相殺され、ポジションなし

    return {
        "status": status,
        "position": position,
        "avgPrice": round(avg_price, 2) if avg_price is not None else None,
        "latestPrice": latest_price,
        "realizedPnl": round(realized_pnl, 2),
        "unrealizedPnl": round(unrealized_pnl, 2),
        "totalPnl": round(realized_pnl + unrealized_pnl, 2),
        "buyCount": buy_count,
        "sellCount": sell_count,
        "firstTradeDate": first_trade_date,
        "lastTradeDate": last_trade_date,
    }


def compute_signal(prices: List[float], dates: Optional[List[str]] = None) -> Dict[str, Any]:
    """トレンド・底値判定・グランビル判定・バックテスト・総合スコアをまとめて返す"""
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
    # datesが渡されなかった場合は空文字のダミー日付で代用する
    backtest = simulate_granville_backtest(prices, dates or [""] * len(prices), granville_signals)

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
        "backtest": backtest,
    }
