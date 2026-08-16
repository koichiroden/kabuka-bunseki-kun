import React, { useState, useEffect, useMemo } from "react";

/* =========================================================
   株価分析くん
   - 日経225 / 日経グロース の主要銘柄をセクター別に分析
   - 配当利回り、長期トレンド(30/60/120/180/365日)、
     株価曲線の極小値（底値）判定を行うダッシュボード
   - バックエンド(Flask + yfinance + GitHub Actions)が
     日々生成した実データをAPI経由で取得して表示する。
     分析ロジック(トレンド判定・底値検出)はバックエンド側の
     analysis.py で計算済みのものをそのまま使う。
========================================================= */

// バックエンドAPIのベースURL。
// Renderにデプロイしたら、そのURLに書き換えてください。
// 例: "https://kabuka-bunseki-kun-api.onrender.com"
const API_BASE_URL = "https://kabuka-bunseki-kun-api.onrender.com";

function formatDateShort(dateStr) {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatDateFull(dateStr) {
  const d = new Date(dateStr);
  const week = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}(${week})`;
}

// APIから取得したstocks.jsonの1銘柄分を、UIが使いやすい形に整形する。
// dates は文字列("YYYY-MM-DD")のまま保持し、表示時にDateへ変換する。
function normalizeStock(raw) {
  return {
    code: raw.code,
    name: raw.name,
    index: raw.index,
    sector: raw.sector,
    dates: raw.dates,
    prices: raw.prices,
    sma30: raw.sma30 || null,
    sma90: raw.sma90 || null,
    granvilleSignals: raw.granvilleSignals || null,
    latestPrice: raw.latestPrice,
    dividendYield: raw.dividendYield,
    signal: {
      trends: raw.signal.trends,
      bottom: {
        isBottom: raw.signal.bottom.is_bottom,
        minIdx: raw.signal.bottom.min_idx,
        daysSinceMin: raw.signal.bottom.days_since_min,
        minPrice: raw.signal.bottom.min_price,
      },
      score: raw.signal.score,
      verdict: raw.signal.verdict,
    },
  };
}

// APIから全銘柄データを取得するフック
function useStockData() {
  const [state, setState] = useState({
    status: "loading", // "loading" | "success" | "error"
    stocks: [],
    generatedAt: null,
    errorMessage: "",
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/stocks?t=${Date.now()}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`APIエラー: ステータス ${res.status}`);
        }
        const json = await res.json();
        if (cancelled) return;
        const stocks = (json.stocks || []).map(normalizeStock);
        setState({
          status: "success",
          stocks,
          generatedAt: json.generatedAt || null,
          errorMessage: "",
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: "error",
          stocks: [],
          generatedAt: null,
          errorMessage: err.message || "データの取得に失敗しました。",
        });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

// ---------- UI サブコンポーネント ----------

function Sparkline({
  prices,
  dates,
  sma30,
  sma90,
  highlightIdx,
  granvilleSignals,
  width = 220,
  height = 56,
  showAxis = false,
}) {
  const n = prices.length;
  const sliceLen = Math.min(180, n);
  const offset = n - sliceLen;
  const slice = prices.slice(offset);
  const dateSlice = dates ? dates.slice(offset) : null;
  const sma30Slice = sma30 ? sma30.slice(offset) : null;
  const sma90Slice = sma90 ? sma90.slice(offset) : null;

  // 移動平均線も含めて、グラフのY軸の範囲(min/max)を決める
  // （移動平均だけが極端に外れて見切れないようにするため）
  const sma30Values = sma30Slice ? sma30Slice.filter((v) => v !== null && v !== undefined) : [];
  const sma90Values = sma90Slice ? sma90Slice.filter((v) => v !== null && v !== undefined) : [];
  const allValues = [...slice, ...sma30Values, ...sma90Values];
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;
  const axisHeight = showAxis ? 18 : 0;
  const plotHeight = height - axisHeight;
  const stepX = width / (slice.length - 1);

  const toY = (v) => plotHeight - ((v - min) / range) * (plotHeight - 8) - 4;

  const pts = slice.map((p, i) => [i * stepX, toY(p)]);
  const path = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

  // 移動平均線のパスを作る共通処理。データが無い(null)区間は線をいったん切る。
  function buildSmaPath(smaSlice) {
    if (!smaSlice) return "";
    let path = "";
    let started = false;
    smaSlice.forEach((v, i) => {
      if (v === null || v === undefined) {
        started = false;
        return;
      }
      const x = i * stepX;
      path += `${started ? "L" : "M"}${x.toFixed(1)},${toY(v).toFixed(1)} `;
      started = true;
    });
    return path;
  }

  const sma30Path = buildSmaPath(sma30Slice);
  const sma90Path = buildSmaPath(sma90Slice);

  // ハイライト（底値点）: highlightIdxはprices全体でのインデックス→sliceに変換
  let hlPoint = null;
  let hlDate = null;
  if (highlightIdx !== undefined && highlightIdx !== null) {
    const sliceIdx = highlightIdx - offset;
    if (sliceIdx >= 0 && sliceIdx < slice.length) {
      hlPoint = pts[sliceIdx];
      hlDate = dateSlice ? dateSlice[sliceIdx] : null;
    }
  }

  // 期間内で「買い」「売り」と明確に判定された日を、それぞれの座標で保持する
  const granvilleSlice = granvilleSignals ? granvilleSignals.slice(offset) : null;
  const buyMarkers = [];
  const sellMarkers = [];
  if (granvilleSlice) {
    granvilleSlice.forEach((sig, i) => {
      if (sig === "buy") buyMarkers.push(pts[i]);
      else if (sig === "sell") sellMarkers.push(pts[i]);
    });
  }

  const [hoverIdx, setHoverIdx] = React.useState(null);

  function handleMove(clientX, rect) {
    const relX = clientX - rect.left;
    const idx = Math.round((relX / rect.width) * (slice.length - 1));
    setHoverIdx(Math.max(0, Math.min(slice.length - 1, idx)));
  }

  const hoverPoint = hoverIdx !== null ? pts[hoverIdx] : null;
  const hoverPrice = hoverIdx !== null ? slice[hoverIdx] : null;
  const hoverDate = hoverIdx !== null && dateSlice ? dateSlice[hoverIdx] : null;

  // 軸: 開始日・中間・最新日の3点だけラベルを出す
  const axisLabels =
    showAxis && dateSlice
      ? [0, Math.floor((dateSlice.length - 1) / 2), dateSlice.length - 1].map((i) => ({
          x: i * stepX,
          label: formatDateShort(dateSlice[i]),
        }))
      : [];

  return (
    <div
      className="sparkline-wrap"
      style={{ width }}
      onMouseMove={(e) => handleMove(e.clientX, e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => setHoverIdx(null)}
      onTouchStart={(e) => handleMove(e.touches[0].clientX, e.currentTarget.getBoundingClientRect())}
      onTouchMove={(e) => handleMove(e.touches[0].clientX, e.currentTarget.getBoundingClientRect())}
      onTouchEnd={() => setTimeout(() => setHoverIdx(null), 1200)}
    >
      <svg width={width} height={height} className="sparkline" viewBox={`0 0 ${width} ${height}`}>
        {sma90Path && (
          <path
            d={sma90Path}
            fill="none"
            stroke="#7C9CFF"
            strokeWidth="1.3"
            strokeDasharray="6,3"
            opacity="0.8"
          />
        )}

        {sma30Path && (
          <path
            d={sma30Path}
            fill="none"
            stroke="#F0A857"
            strokeWidth="1.3"
            strokeDasharray="3,2"
            opacity="0.85"
          />
        )}

        <path d={path} fill="none" stroke="var(--line-color, #4FD1C5)" strokeWidth="1.6" />

        {hoverPoint && (
          <>
            <line
              x1={hoverPoint[0]}
              y1="0"
              x2={hoverPoint[0]}
              y2={plotHeight}
              stroke="#3A4753"
              strokeWidth="1"
              strokeDasharray="2,2"
            />
            <circle cx={hoverPoint[0]} cy={hoverPoint[1]} r="3" fill="#E8EDF2" />
          </>
        )}

        {hlPoint && (
          <>
            <circle cx={hlPoint[0]} cy={hlPoint[1]} r="6" fill="none" stroke="#F0A857" strokeWidth="1.4" opacity="0.6">
              <animate attributeName="r" values="4;9;4" dur="2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.7;0.05;0.7" dur="2s" repeatCount="indefinite" />
            </circle>
            <circle cx={hlPoint[0]} cy={hlPoint[1]} r="3.2" fill="#F0A857" />
          </>
        )}

        {buyMarkers.map(([x, y], i) => (
          <circle
            key={`buy-${i}`}
            cx={x}
            cy={y}
            r="2.6"
            fill="#3DDC84"
            stroke="#0B0F14"
            strokeWidth="0.6"
          />
        ))}

        {sellMarkers.map(([x, y], i) => (
          <circle
            key={`sell-${i}`}
            cx={x}
            cy={y}
            r="2.6"
            fill="#E85D5D"
            stroke="#0B0F14"
            strokeWidth="0.6"
          />
        ))}

        {showAxis &&
          axisLabels.map((a, i) => (
            <text
              key={i}
              x={a.x}
              y={height - 3}
              fontSize="9"
              fill="#8A9AA8"
              textAnchor={i === 0 ? "start" : i === axisLabels.length - 1 ? "end" : "middle"}
            >
              {a.label}
            </text>
          ))}
      </svg>

      {hoverPoint && hoverDate && (
        <div
          className="sparkline-tooltip"
          style={{ left: Math.min(Math.max(hoverPoint[0], 40), width - 40) }}
        >
          <div className="sparkline-tooltip__date">{formatDateFull(hoverDate)}</div>
          <div className="sparkline-tooltip__price mono">¥{hoverPrice.toLocaleString()}</div>
        </div>
      )}

      {hlPoint && hlDate && !hoverPoint && (
        <div className="sparkline-caption">底値: {formatDateShort(hlDate)}</div>
      )}
    </div>
  );
}

function TrendChip({ label, value }) {
  if (value === null || value === undefined) {
    return (
      <div className="trend-chip trend-chip--flat">
        <span className="trend-chip__label">{label}</span>
        <span className="trend-chip__value">—</span>
      </div>
    );
  }
  const isUp = value > 0;
  const cls = isUp ? "trend-chip--up" : value < 0 ? "trend-chip--down" : "trend-chip--flat";
  return (
    <div className={`trend-chip ${cls}`}>
      <span className="trend-chip__label">{label}</span>
      <span className="trend-chip__value">
        {isUp ? "▲" : value < 0 ? "▼" : "―"} {Math.abs(value).toFixed(1)}%
      </span>
    </div>
  );
}

function VerdictBadge({ verdict }) {
  const map = {
    "買い時": "badge--buy",
    "注目": "badge--watch",
    "様子見": "badge--neutral",
    "割高": "badge--high",
  };
  return <span className={`badge ${map[verdict] || "badge--neutral"}`}>{verdict}</span>;
}

// 銘柄全体の「買い」「売り」シグナル件数（それぞれ最大5件）を示す
// 小さなインジケーター。1件もない場合は何も表示しない。
function GranvilleSummary({ granvilleSignals }) {
  if (!granvilleSignals) return null;
  const buyCount = granvilleSignals.filter((s) => s === "buy").length;
  const sellCount = granvilleSignals.filter((s) => s === "sell").length;
  if (buyCount === 0 && sellCount === 0) return null;

  return (
    <div className="granville-summary">
      {buyCount > 0 && (
        <span className="granville-summary__item granville-summary__item--buy">
          🟢 買い×{buyCount}
        </span>
      )}
      {sellCount > 0 && (
        <span className="granville-summary__item granville-summary__item--sell">
          🔴 売り×{sellCount}
        </span>
      )}
    </div>
  );
}

function StockCard({ stock, onOpen }) {
  const { signal, granvilleSignals } = stock;
  // min_idxはバックエンド側で、30日移動平均線の配列全体における
  // 絶対インデックスとして計算済みなので、そのまま使える。
  const bottomIdxGlobal = signal.bottom.isBottom ? signal.bottom.minIdx : null;

  return (
    <button className="stock-card" onClick={() => onOpen(stock)}>
      <div className="stock-card__top">
        <div>
          <div className="stock-card__name">{stock.name}</div>
          <div className="stock-card__meta">
            {stock.code} ・ {stock.sector}
          </div>
        </div>
        <div className="stock-card__badges">
          <VerdictBadge verdict={signal.verdict} />
        </div>
      </div>

      <div className="stock-card__body">
        <Sparkline
          prices={stock.prices}
          dates={stock.dates}
          sma30={stock.sma30}
          sma90={stock.sma90}
          highlightIdx={signal.bottom.isBottom ? bottomIdxGlobal : null}
          granvilleSignals={granvilleSignals}
        />
        <div className="stock-card__stats">
          <div className="stat">
            <span className="stat__label">株価</span>
            <span className="stat__value mono">¥{stock.latestPrice.toLocaleString()}</span>
          </div>
          <div className="stat">
            <span className="stat__label">配当利回り</span>
            <span className="stat__value mono">{stock.dividendYield.toFixed(1)}%</span>
          </div>
        </div>
      </div>

      <GranvilleSummary granvilleSignals={granvilleSignals} />

      <div className="stock-card__trends">
        <TrendChip label="30日" value={signal.trends.d30} />
        <TrendChip label="60日" value={signal.trends.d60} />
        <TrendChip label="120日" value={signal.trends.d120} />
        <TrendChip label="180日" value={signal.trends.d180} />
        <TrendChip label="365日" value={signal.trends.d365} />
      </div>

      {signal.bottom.isBottom && (
        <div className="stock-card__bottom-flag">
          底値シグナル検知（{signal.bottom.daysSinceMin}日前に極小値）
        </div>
      )}
    </button>
  );
}

// 「買いシグナルの日に1株買い、売りシグナルの日に1株売っていたら
// 最新日時点でどうなっているか」のバックテスト結果を表示するセクション。
function DetailModal({ stock, onClose }) {
  if (!stock) return null;
  const { signal, granvilleSignals } = stock;

  // granvilleSignalsはバックエンド側ですでに「買い/売りそれぞれ最大5日」に
  // 絞り込み済み（候補が5日未満ならその件数のまま）なので、
  // 単純に配列全体をカウントすればよい
  const buyCount = granvilleSignals ? granvilleSignals.filter((s) => s === "buy").length : 0;
  const sellCount = granvilleSignals ? granvilleSignals.filter((s) => s === "sell").length : 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <div className="modal__name">{stock.name}</div>
            <div className="modal__meta">
              {stock.code} ・ {stock.index} ・ {stock.sector}
            </div>
          </div>
          <button className="modal__close" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>

        <div className="modal__hero">
          <Sparkline
            prices={stock.prices}
            dates={stock.dates}
            sma30={stock.sma30}
            sma90={stock.sma90}
            highlightIdx={signal.bottom.isBottom ? signal.bottom.minIdx : null}
            granvilleSignals={granvilleSignals}
            width={320}
            height={130}
            showAxis
          />
          <div className="modal__legend">
            <span className="modal__legend-item">
              <span className="modal__legend-swatch modal__legend-swatch--price" />
              株価
            </span>
            <span className="modal__legend-item">
              <span className="modal__legend-swatch modal__legend-swatch--sma30" />
              30日移動平均線
            </span>
            <span className="modal__legend-item">
              <span className="modal__legend-swatch modal__legend-swatch--sma90" />
              90日移動平均線
            </span>
            <span className="modal__legend-item">
              <span className="modal__legend-dot modal__legend-dot--buy" />
              買いシグナル
            </span>
            <span className="modal__legend-item">
              <span className="modal__legend-dot modal__legend-dot--sell" />
              売りシグナル
            </span>
          </div>
          <div className="modal__price-row">
            <span className="mono modal__price">¥{stock.latestPrice.toLocaleString()}</span>
            <VerdictBadge verdict={signal.verdict} />
          </div>
        </div>

        <div className="modal__section">
          <div className="modal__section-title">配当利回り</div>
          <div className="modal__dividend mono">{stock.dividendYield.toFixed(2)}%</div>
        </div>

        <div className="modal__section">
          <div className="modal__section-title">長期トレンド判定（期間変化率）</div>
          <div className="modal__trend-grid">
            <TrendChip label="30日" value={signal.trends.d30} />
            <TrendChip label="60日" value={signal.trends.d60} />
            <TrendChip label="120日" value={signal.trends.d120} />
            <TrendChip label="180日" value={signal.trends.d180} />
            <TrendChip label="365日" value={signal.trends.d365} />
          </div>
        </div>

        <div className="modal__section">
          <div className="modal__section-title">グランビルの法則による買い時/売り時シグナル</div>
          {buyCount > 0 || sellCount > 0 ? (
            <>
              <div className="granville__detail-grid">
                <div className="granville__detail-item">
                  <span className="granville__detail-label">🟢 買いシグナル</span>
                  <span className="granville__detail-value">{buyCount}日</span>
                </div>
                <div className="granville__detail-item">
                  <span className="granville__detail-label">🔴 売りシグナル</span>
                  <span className="granville__detail-value">{sellCount}日</span>
                </div>
              </div>
              <p className="modal__explain">
                この銘柄の全期間の中で、判定基準に一致した候補日のうち
                「シグナルの強さスコア」が高い順に、買い・売りそれぞれ最大5日を
                グラフ上に緑（買い）・赤（売り）の点で示しています。
                現在の表示期間（最大180日）の外にある場合は、グラフには映りません。
              </p>
            </>
          ) : (
            <p className="modal__explain">
              この銘柄では、判定基準に一致する候補日が見つからなかったため、
              シグナリングを行っていません。
            </p>
          )}
        </div>

        <div className="modal__section">
          <div className="modal__section-title">底値（極小値）判定</div>
          <p className="modal__explain">
            {signal.bottom.isBottom
              ? `直近${signal.bottom.daysSinceMin}日前に、30日移動平均線が底（下降から上昇に転換し、下に凸）を迎えたことを検知しました。日々の細かな値動きではなく、ならした移動平均線で判定しているため、一時的な急落・急騰による誤検知が起きにくくなっています。反発の初期段階の可能性があります。`
              : "直近では30日移動平均線の極小値（底値）は検出されていません。下降トレンドが継続しているか、すでに反発が進行している状態です。"}
          </p>
        </div>

        <div className="modal__section">
          <div className="modal__section-title">総合スコア</div>
          <div className="modal__score-bar">
            <div
              className="modal__score-fill"
              style={{
                width: `${(signal.score + 100) / 2}%`,
                background:
                  signal.score >= 40 ? "#4FD1C5" : signal.score >= 10 ? "#F0A857" : "#E85D5D",
              }}
            />
          </div>
          <div className="modal__score-label mono">{signal.score} / 100</div>
        </div>
      </div>
    </div>
  );
}

function AlertBanner({ buyList, onJump }) {
  if (buyList.length === 0) return null;
  return (
    <div className="alert-banner">
      <div className="alert-banner__icon">◆</div>
      <div className="alert-banner__text">
        <strong>{buyList.length}銘柄</strong>が買い時シグナルを検知しました：
        <span className="alert-banner__names">
          {buyList.map((s) => s.name).join("・")}
        </span>
      </div>
      <button className="alert-banner__btn" onClick={onJump}>
        確認する
      </button>
    </div>
  );
}

// サイト最上部に置く、グランビルの法則（買い/売りシグナル）の解説パネル。
// 実データではなく、説明用に手作りしたサンプルグラフを使う。
function GranvilleExplainerSample() {
  // サンプル用の株価っぽい折れ線（実データではなく説明用のダミー座標）
  const pricePath =
    "M0,70 L20,66 L40,72 L60,60 L80,64 L100,52 L120,56 L140,44 L160,48 L180,36 " +
    "L200,40 L220,30 L240,34 L260,24 L280,28 L300,20";
  const sma30Path =
    "M20,68 L40,68 L60,66 L80,63 L100,58 L120,54 L140,50 L160,46 L180,42 " +
    "L200,40 L220,37 L240,34 L260,31 L280,29 L300,26";
  const sma90Path = "M60,72 L120,66 L180,54 L240,42 L300,32";

  return (
    <div className="explainer">
      <div className="explainer__top">
        <div className="explainer__text">
          <h2 className="explainer__title">🟢🔴 買い時/売り時シグナルの見方</h2>
          <p className="explainer__body">
            各銘柄について、<strong>90日移動平均線（長期・青の点線）</strong>・
            <strong>30日移動平均線（中期・アンバーの点線）</strong>・
            <strong>日々の株価（短期・ティール色の実線）</strong>の3本が、
            それぞれ「上昇↗／横ばい→／下降↘」のどちらを向いているかを
            日ごとにチェックしています。
          </p>
          <p className="explainer__body">
            この3方向の組み合わせ（3×3×3＝27通り）のうち、グランビルの法則を
            参考にした判定表に一致する<strong>15パターン</strong>
            （買いパターン7通り・売りパターン8通り）だけを候補とします。
            表にない残り12通りのあいまいな組み合わせは、無理に判定せず
            候補にも入れません。
          </p>
        </div>

        <div className="explainer__sample">
          <svg viewBox="0 0 300 90" className="explainer__svg">
            <path d={sma90Path} fill="none" stroke="#7C9CFF" strokeWidth="1.6" strokeDasharray="6,3" opacity="0.8" />
            <path d={sma30Path} fill="none" stroke="#F0A857" strokeWidth="1.6" strokeDasharray="3,2" opacity="0.85" />
            <path d={pricePath} fill="none" stroke="#4FD1C5" strokeWidth="2" />

            <circle cx="100" cy="52" r="4" fill="#3DDC84" stroke="#0B0F14" strokeWidth="0.8" />
            <circle cx="180" cy="36" r="4" fill="#3DDC84" stroke="#0B0F14" strokeWidth="0.8" />
            <circle cx="60" cy="60" r="4" fill="#E85D5D" stroke="#0B0F14" strokeWidth="0.8" />
            <circle cx="140" cy="44" r="4" fill="#E85D5D" stroke="#0B0F14" strokeWidth="0.8" />
          </svg>
          <div className="explainer__sample-legend">
            <span className="explainer__legend-item">
              <span className="modal__legend-swatch modal__legend-swatch--price" />
              株価
            </span>
            <span className="explainer__legend-item">
              <span className="modal__legend-swatch modal__legend-swatch--sma30" />
              30日線
            </span>
            <span className="explainer__legend-item">
              <span className="modal__legend-swatch modal__legend-swatch--sma90" />
              90日線
            </span>
            <span className="explainer__legend-item">
              <span className="modal__legend-dot modal__legend-dot--buy" />
              買い
            </span>
            <span className="explainer__legend-item">
              <span className="modal__legend-dot modal__legend-dot--sell" />
              売り
            </span>
          </div>
          <p className="explainer__sample-caption">
            ※ 上図は説明用のサンプルです。実際のグラフとは異なります。
          </p>
        </div>
      </div>

      <div className="explainer__detail-grid">
        <div className="explainer__detail-card">
          <div className="explainer__detail-card-title">① 何パターンで判定しているか</div>
          <p className="explainer__detail-card-body">
            長期・中期・短期それぞれ3方向（上昇/横ばい/下降）の組み合わせ
            27通りのうち、あらかじめ指定された<strong>15パターン</strong>
            （買い時7パターン・売り時8パターン）だけを判定に使っています。
            残り12パターンは、根拠があいまいなため判定対象に含めていません。
          </p>
        </div>
        <div className="explainer__detail-card">
          <div className="explainer__detail-card-title">② スコアはどう算出されるか</div>
          <p className="explainer__detail-card-body">
            上記15パターンに一致した日について、<strong>長期・中期・短期
            それぞれの変化率(%)の絶対値を合計</strong>した値を
            「シグナルの強さスコア」とします。3つの時間軸すべてで
            値動きがはっきりしている日ほど、スコアが高くなります。
          </p>
        </div>
        <div className="explainer__detail-card">
          <div className="explainer__detail-card-title">③ どの基準でシグナリングされるか</div>
          <p className="explainer__detail-card-body">
            銘柄ごとに、買い候補・売り候補それぞれをスコアが高い順に並べ、
            <strong>最大5日まで</strong>を実際のシグナルとして表示します。
            候補が5日に満たない場合は、無理に5日へ水増しせず、
            <strong>実際にある件数（0〜4日）だけ</strong>をそのまま表示します。
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------- メインアプリ ----------

export default function App() {
  const { status, stocks: dataset, generatedAt, errorMessage } = useStockData();
  const [indexFilter, setIndexFilter] = useState("すべて");
  const [sectorFilter, setSectorFilter] = useState("すべて");
  const [sortKey, setSortKey] = useState("score");
  const [selected, setSelected] = useState(null);
  const listRef = React.useRef(null);

  const indexes = ["すべて", "日経225", "日経グロース"];
  const sectors = useMemo(() => {
    const filtered = indexFilter === "すべて" ? dataset : dataset.filter((s) => s.index === indexFilter);
    return ["すべて", ...Array.from(new Set(filtered.map((s) => s.sector)))];
  }, [dataset, indexFilter]);

  const buyList = useMemo(
    () => dataset.filter((s) => s.signal.verdict === "買い時"),
    [dataset]
  );

  const filtered = useMemo(() => {
    let list = dataset;
    if (indexFilter !== "すべて") list = list.filter((s) => s.index === indexFilter);
    if (sectorFilter !== "すべて") list = list.filter((s) => s.sector === sectorFilter);
    list = [...list].sort((a, b) => {
      if (sortKey === "score") return b.signal.score - a.signal.score;
      if (sortKey === "dividend") return b.dividendYield - a.dividendYield;
      if (sortKey === "price") return b.latestPrice - a.latestPrice;
      return 0;
    });
    return list;
  }, [dataset, indexFilter, sectorFilter, sortKey]);

  if (status === "loading") {
    return (
      <div className="app">
        <style>{STYLES}</style>
        <div className="state-screen">
          <div className="state-screen__spinner" />
          <p>株価データを読み込んでいます…</p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="app">
        <style>{STYLES}</style>
        <div className="state-screen">
          <p className="state-screen__error-title">データを取得できませんでした</p>
          <p className="state-screen__error-detail">{errorMessage}</p>
          <p className="state-screen__error-hint">
            APIサーバーが起動中（Renderの無料プランはスリープ復帰に30秒ほどかかることがあります）か、
            URL設定をご確認ください。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <style>{STYLES}</style>

      <header className="app-header">
        <div className="app-header__title">
          <span className="app-header__mark">株</span>
          <div>
            <h1>株価分析くん</h1>
            <p>日経銘柄の配当と底値タイミングを毎日チェック</p>
          </div>
        </div>
      </header>

      <GranvilleExplainerSample />

      <AlertBanner
        buyList={buyList}
        onJump={() => listRef.current?.scrollIntoView({ behavior: "smooth" })}
      />

      <div className="filter-bar">
        <div className="filter-group">
          <span className="filter-group__label">市場</span>
          <div className="chip-row">
            {indexes.map((idx) => (
              <button
                key={idx}
                className={`chip ${indexFilter === idx ? "chip--active" : ""}`}
                onClick={() => {
                  setIndexFilter(idx);
                  setSectorFilter("すべて");
                }}
              >
                {idx}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-group">
          <span className="filter-group__label">セクター</span>
          <div className="chip-row chip-row--wrap">
            {sectors.map((sec) => (
              <button
                key={sec}
                className={`chip chip--sm ${sectorFilter === sec ? "chip--active" : ""}`}
                onClick={() => setSectorFilter(sec)}
              >
                {sec}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-group">
          <span className="filter-group__label">並び替え</span>
          <div className="chip-row">
            <button
              className={`chip chip--sm ${sortKey === "score" ? "chip--active" : ""}`}
              onClick={() => setSortKey("score")}
            >
              おすすめ度
            </button>
            <button
              className={`chip chip--sm ${sortKey === "dividend" ? "chip--active" : ""}`}
              onClick={() => setSortKey("dividend")}
            >
              配当利回り
            </button>
            <button
              className={`chip chip--sm ${sortKey === "price" ? "chip--active" : ""}`}
              onClick={() => setSortKey("price")}
            >
              株価
            </button>
          </div>
        </div>
      </div>

      <main className="stock-grid" ref={listRef}>
        {filtered.map((s) => (
          <StockCard key={s.code} stock={s} onOpen={setSelected} />
        ))}
        {filtered.length === 0 && <p className="empty-state">該当する銘柄がありません。</p>}
      </main>

      <footer className="app-footer">
        <p>
          最終更新: {generatedAt ? formatDateFull(generatedAt) : "取得中"}
          （平日のTSE引け後に自動更新されます）
        </p>
      </footer>

      <DetailModal stock={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

// ---------- スタイル ----------
const STYLES = `
:root {
  --bg: #0B0F14;
  --card: #141A21;
  --card-border: #1F2830;
  --text: #E8EDF2;
  --text-dim: #8A9AA8;
  --teal: #4FD1C5;
  --amber: #F0A857;
  --red: #E85D5D;
}

* { box-sizing: border-box; }

.app {
  min-height: 100vh;
  background: var(--bg);
  color: var(--text);
  font-family: "Zen Kaku Gothic New", "Noto Sans JP", -apple-system, sans-serif;
  padding-bottom: 40px;
}

.mono { font-family: "JetBrains Mono", "SF Mono", monospace; }

.app-header {
  padding: 24px 16px 16px;
  border-bottom: 1px solid var(--card-border);
}

.app-header__title {
  display: flex;
  align-items: center;
  gap: 14px;
}

.app-header__mark {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: 10px;
  background: linear-gradient(160deg, var(--teal), #2E9E93);
  color: #06121A;
  font-weight: 700;
  font-size: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.app-header h1 {
  font-size: 20px;
  margin: 0;
  letter-spacing: 0.02em;
}

.app-header p {
  margin: 2px 0 0;
  font-size: 12.5px;
  color: var(--text-dim);
}

.explainer {
  margin: 16px 16px 0;
  background: var(--card);
  border: 1px solid var(--card-border);
  border-radius: 14px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.explainer__top {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

@media (min-width: 640px) {
  .explainer__top {
    flex-direction: row;
    align-items: center;
  }
}

.explainer__text {
  flex: 1.2;
}

.explainer__title {
  font-size: 15px;
  margin: 0 0 8px;
}

.explainer__body {
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--text);
  margin: 0 0 8px;
}

.explainer__body--sub {
  color: var(--text-dim);
}

.explainer__sample {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.explainer__svg {
  width: 100%;
  max-width: 300px;
  height: auto;
}

.explainer__sample-legend {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
}

.explainer__legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  color: var(--text-dim);
}

.explainer__sample-caption {
  font-size: 10px;
  color: var(--text-dim);
  margin: 0;
}

.explainer__detail-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--card-border);
}

@media (min-width: 640px) {
  .explainer__detail-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

.explainer__detail-card {
  background: rgba(255,255,255,0.03);
  border-radius: 10px;
  padding: 12px;
}

.explainer__detail-card-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--teal);
  margin-bottom: 6px;
}

.explainer__detail-card-body {
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-dim);
  margin: 0;
}

.alert-banner {
  margin: 14px 16px 0;
  background: linear-gradient(90deg, rgba(240,168,87,0.16), rgba(240,168,87,0.04));
  border: 1px solid rgba(240,168,87,0.4);
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.alert-banner__icon {
  color: var(--amber);
  font-size: 16px;
}

.alert-banner__text {
  flex: 1;
  font-size: 13px;
  line-height: 1.5;
}

.alert-banner__names {
  color: var(--amber);
  margin-left: 4px;
}

.alert-banner__btn {
  background: var(--amber);
  color: #251505;
  border: none;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.filter-bar {
  padding: 16px 16px 4px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.filter-group__label {
  display: block;
  font-size: 11px;
  color: var(--text-dim);
  margin-bottom: 6px;
  letter-spacing: 0.05em;
}

.chip-row {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.chip-row--wrap {
  flex-wrap: wrap;
  overflow-x: visible;
}

.chip {
  flex-shrink: 0;
  background: var(--card);
  border: 1px solid var(--card-border);
  color: var(--text-dim);
  border-radius: 999px;
  padding: 7px 14px;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
}

.chip--sm { font-size: 12px; padding: 6px 12px; }

.chip--active {
  background: rgba(79,209,197,0.12);
  border-color: var(--teal);
  color: var(--teal);
}

.stock-grid {
  padding: 18px 16px 0;
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

@media (min-width: 640px) {
  .stock-grid { grid-template-columns: 1fr 1fr; }
}

.stock-card {
  text-align: left;
  background: var(--card);
  border: 1px solid var(--card-border);
  border-radius: 14px;
  padding: 14px;
  cursor: pointer;
  color: inherit;
  font: inherit;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: border-color 0.15s ease, transform 0.1s ease;
}

.stock-card:active { transform: scale(0.99); }
.stock-card:hover { border-color: #2A3742; }

.stock-card__top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}

.stock-card__badges {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.stock-card__name { font-size: 15px; font-weight: 600; }
.stock-card__meta { font-size: 11.5px; color: var(--text-dim); margin-top: 2px; }

.stock-card__body {
  display: flex;
  align-items: center;
  gap: 12px;
}

.sparkline { flex-shrink: 0; }

.sparkline-wrap {
  position: relative;
  flex-shrink: 0;
  touch-action: pan-y;
}

.sparkline-tooltip {
  position: absolute;
  top: -2px;
  transform: translateX(-50%);
  background: #1F2830;
  border: 1px solid #2A3742;
  border-radius: 8px;
  padding: 4px 8px;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  z-index: 5;
}

.sparkline-tooltip__date {
  font-size: 10px;
  color: var(--text-dim);
}

.sparkline-tooltip__price {
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
}

.sparkline-caption {
  font-size: 10px;
  color: var(--amber);
  text-align: center;
  margin-top: 2px;
}

.stock-card__stats {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}

.stat { display: flex; justify-content: space-between; font-size: 12.5px; }
.stat__label { color: var(--text-dim); }
.stat__value { font-size: 13.5px; }

.stock-card__trends {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.trend-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  background: rgba(255,255,255,0.03);
  border-radius: 8px;
  padding: 5px 7px;
  min-width: 46px;
}

.trend-chip__label { font-size: 9.5px; color: var(--text-dim); }
.trend-chip__value { font-size: 11px; font-weight: 600; }

.trend-chip--up .trend-chip__value { color: var(--teal); }
.trend-chip--down .trend-chip__value { color: var(--red); }
.trend-chip--flat .trend-chip__value { color: var(--text-dim); }

.stock-card__bottom-flag {
  font-size: 11.5px;
  color: var(--amber);
  background: rgba(240,168,87,0.08);
  border-radius: 8px;
  padding: 6px 8px;
}

.badge {
  font-size: 11.5px;
  font-weight: 700;
  padding: 5px 10px;
  border-radius: 999px;
  white-space: nowrap;
}

.badge--buy { background: rgba(79,209,197,0.16); color: var(--teal); }
.badge--watch { background: rgba(240,168,87,0.16); color: var(--amber); }
.badge--neutral { background: rgba(138,154,168,0.14); color: var(--text-dim); }
.badge--high { background: rgba(232,93,93,0.16); color: var(--red); }

.granville-summary {
  display: flex;
  gap: 8px;
  padding: 0 14px 4px;
  flex-wrap: wrap;
}

.granville-summary__item {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 999px;
}

.granville-summary__item--buy { background: rgba(61,220,132,0.14); color: #3DDC84; }
.granville-summary__item--sell { background: rgba(232,93,93,0.14); color: var(--red); }

.granville__detail-grid {
  display: flex;
  gap: 10px;
  margin: 10px 0;
  flex-wrap: wrap;
}

.granville__detail-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: rgba(255,255,255,0.03);
  border-radius: 8px;
  padding: 6px 10px;
  min-width: 90px;
}

.granville__detail-label {
  font-size: 10px;
  color: var(--text-dim);
}

.granville__detail-value {
  font-size: 12.5px;
  font-weight: 600;
}

.empty-state {
  grid-column: 1 / -1;
  text-align: center;
  color: var(--text-dim);
  padding: 40px 0;
  font-size: 13px;
}

.state-screen {
  min-height: 70vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  text-align: center;
}

.state-screen__spinner {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 3px solid var(--card-border);
  border-top-color: var(--teal);
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.state-screen p {
  font-size: 13px;
  color: var(--text-dim);
  margin: 0;
}

.state-screen__error-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--red);
}

.state-screen__error-detail {
  font-size: 12.5px;
}

.state-screen__error-hint {
  font-size: 11.5px;
  max-width: 280px;
  line-height: 1.6;
}

.app-footer {
  padding: 20px 16px 0;
}

.app-footer p {
  font-size: 11px;
  color: var(--text-dim);
  text-align: center;
  line-height: 1.6;
}

/* Modal */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  display: flex;
  align-items: flex-end;
  z-index: 50;
}

@media (min-width: 640px) {
  .modal-backdrop { align-items: center; justify-content: center; }
}

.modal {
  background: var(--card);
  border: 1px solid var(--card-border);
  border-radius: 18px 18px 0 0;
  width: 100%;
  max-width: 480px;
  max-height: 88vh;
  overflow-y: auto;
  padding: 20px;
}

@media (min-width: 640px) {
  .modal { border-radius: 18px; }
}

.modal__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
}

.modal__name { font-size: 17px; font-weight: 700; }
.modal__meta { font-size: 12px; color: var(--text-dim); margin-top: 3px; }

.modal__close {
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 16px;
  cursor: pointer;
  padding: 4px;
}

.modal__hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 12px 0;
  border-bottom: 1px solid var(--card-border);
  margin-bottom: 16px;
}

.modal__price-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.modal__price { font-size: 20px; font-weight: 700; }

.modal__section { margin-bottom: 18px; }

.modal__section-title {
  font-size: 11.5px;
  color: var(--text-dim);
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}

.modal__dividend { font-size: 22px; font-weight: 700; color: var(--teal); }

.modal__trend-grid {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.modal__legend {
  display: flex;
  gap: 14px;
  margin-bottom: 8px;
}

.modal__legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-dim);
}

.modal__legend-swatch {
  width: 14px;
  height: 2px;
  border-radius: 1px;
}

.modal__legend-swatch--price {
  background: var(--teal);
}

.modal__legend-swatch--sma30 {
  background: repeating-linear-gradient(
    90deg,
    var(--amber) 0px,
    var(--amber) 3px,
    transparent 3px,
    transparent 5px
  );
}

.modal__legend-swatch--sma90 {
  background: repeating-linear-gradient(
    90deg,
    #7c9cff 0px,
    #7c9cff 4px,
    transparent 4px,
    transparent 7px
  );
}

.modal__legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.modal__legend-dot--buy { background: #3DDC84; }
.modal__legend-dot--sell { background: var(--red); }

.modal__explain {
  font-size: 13px;
  line-height: 1.7;
  color: var(--text);
  margin: 0;
}

.modal__score-bar {
  height: 8px;
  background: rgba(255,255,255,0.06);
  border-radius: 999px;
  overflow: hidden;
}

.modal__score-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.3s ease;
}

.modal__score-label {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-dim);
  text-align: right;
}
`;
