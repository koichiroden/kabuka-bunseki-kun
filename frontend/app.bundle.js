(() => {
  // component_body_named.jsx
  var { useState, useEffect, useMemo } = React;
  var API_BASE_URL = "https://kabuka-bunseki-kun-api.onrender.com";
  function formatDateShort(dateStr) {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  function formatDateFull(dateStr) {
    const d = new Date(dateStr);
    const week = ["\u65E5", "\u6708", "\u706B", "\u6C34", "\u6728", "\u91D1", "\u571F"][d.getDay()];
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}(${week})`;
  }
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
          minPrice: raw.signal.bottom.min_price
        },
        score: raw.signal.score,
        verdict: raw.signal.verdict
      }
    };
  }
  function useStockData() {
    const [state, setState] = useState({
      status: "loading",
      // "loading" | "success" | "error"
      stocks: [],
      generatedAt: null,
      errorMessage: ""
    });
    useEffect(() => {
      let cancelled = false;
      async function load() {
        try {
          const res = await fetch(`${API_BASE_URL}/api/stocks?t=${Date.now()}`, {
            cache: "no-store"
          });
          if (!res.ok) {
            throw new Error(`API\u30A8\u30E9\u30FC: \u30B9\u30C6\u30FC\u30BF\u30B9 ${res.status}`);
          }
          const json = await res.json();
          if (cancelled) return;
          const stocks = (json.stocks || []).map(normalizeStock);
          setState({
            status: "success",
            stocks,
            generatedAt: json.generatedAt || null,
            errorMessage: ""
          });
        } catch (err) {
          if (cancelled) return;
          setState({
            status: "error",
            stocks: [],
            generatedAt: null,
            errorMessage: err.message || "\u30C7\u30FC\u30BF\u306E\u53D6\u5F97\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002"
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
  function Sparkline({
    prices,
    dates,
    sma30,
    sma90,
    highlightIdx,
    granvilleSignals,
    width = 220,
    height = 56,
    showAxis = false
  }) {
    const n = prices.length;
    const sliceLen = Math.min(180, n);
    const offset = n - sliceLen;
    const slice = prices.slice(offset);
    const dateSlice = dates ? dates.slice(offset) : null;
    const sma30Slice = sma30 ? sma30.slice(offset) : null;
    const sma90Slice = sma90 ? sma90.slice(offset) : null;
    const sma30Values = sma30Slice ? sma30Slice.filter((v) => v !== null && v !== void 0) : [];
    const sma90Values = sma90Slice ? sma90Slice.filter((v) => v !== null && v !== void 0) : [];
    const allValues = [...slice, ...sma30Values, ...sma90Values];
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const range = max - min || 1;
    const axisHeight = showAxis ? 18 : 0;
    const plotHeight = height - axisHeight;
    const stepX = width / (slice.length - 1);
    const toY = (v) => plotHeight - (v - min) / range * (plotHeight - 8) - 4;
    const pts = slice.map((p, i) => [i * stepX, toY(p)]);
    const path = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    function buildSmaPath(smaSlice) {
      if (!smaSlice) return "";
      let path2 = "";
      let started = false;
      smaSlice.forEach((v, i) => {
        if (v === null || v === void 0) {
          started = false;
          return;
        }
        const x = i * stepX;
        path2 += `${started ? "L" : "M"}${x.toFixed(1)},${toY(v).toFixed(1)} `;
        started = true;
      });
      return path2;
    }
    const sma30Path = buildSmaPath(sma30Slice);
    const sma90Path = buildSmaPath(sma90Slice);
    let hlPoint = null;
    let hlDate = null;
    if (highlightIdx !== void 0 && highlightIdx !== null) {
      const sliceIdx = highlightIdx - offset;
      if (sliceIdx >= 0 && sliceIdx < slice.length) {
        hlPoint = pts[sliceIdx];
        hlDate = dateSlice ? dateSlice[sliceIdx] : null;
      }
    }
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
      const idx = Math.round(relX / rect.width * (slice.length - 1));
      setHoverIdx(Math.max(0, Math.min(slice.length - 1, idx)));
    }
    const hoverPoint = hoverIdx !== null ? pts[hoverIdx] : null;
    const hoverPrice = hoverIdx !== null ? slice[hoverIdx] : null;
    const hoverDate = hoverIdx !== null && dateSlice ? dateSlice[hoverIdx] : null;
    const axisLabels = showAxis && dateSlice ? [0, Math.floor((dateSlice.length - 1) / 2), dateSlice.length - 1].map((i) => ({
      x: i * stepX,
      label: formatDateShort(dateSlice[i])
    })) : [];
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "sparkline-wrap",
        style: { width },
        onMouseMove: (e) => handleMove(e.clientX, e.currentTarget.getBoundingClientRect()),
        onMouseLeave: () => setHoverIdx(null),
        onTouchStart: (e) => handleMove(e.touches[0].clientX, e.currentTarget.getBoundingClientRect()),
        onTouchMove: (e) => handleMove(e.touches[0].clientX, e.currentTarget.getBoundingClientRect()),
        onTouchEnd: () => setTimeout(() => setHoverIdx(null), 1200)
      },
      /* @__PURE__ */ React.createElement("svg", { width, height, className: "sparkline", viewBox: `0 0 ${width} ${height}` }, sma90Path && /* @__PURE__ */ React.createElement(
        "path",
        {
          d: sma90Path,
          fill: "none",
          stroke: "#7C9CFF",
          strokeWidth: "1.3",
          strokeDasharray: "6,3",
          opacity: "0.8"
        }
      ), sma30Path && /* @__PURE__ */ React.createElement(
        "path",
        {
          d: sma30Path,
          fill: "none",
          stroke: "#F0A857",
          strokeWidth: "1.3",
          strokeDasharray: "3,2",
          opacity: "0.85"
        }
      ), /* @__PURE__ */ React.createElement("path", { d: path, fill: "none", stroke: "var(--line-color, #4FD1C5)", strokeWidth: "1.6" }), hoverPoint && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
        "line",
        {
          x1: hoverPoint[0],
          y1: "0",
          x2: hoverPoint[0],
          y2: plotHeight,
          stroke: "#3A4753",
          strokeWidth: "1",
          strokeDasharray: "2,2"
        }
      ), /* @__PURE__ */ React.createElement("circle", { cx: hoverPoint[0], cy: hoverPoint[1], r: "3", fill: "#E8EDF2" })), hlPoint && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: hlPoint[0], cy: hlPoint[1], r: "6", fill: "none", stroke: "#F0A857", strokeWidth: "1.4", opacity: "0.6" }, /* @__PURE__ */ React.createElement("animate", { attributeName: "r", values: "4;9;4", dur: "2s", repeatCount: "indefinite" }), /* @__PURE__ */ React.createElement("animate", { attributeName: "opacity", values: "0.7;0.05;0.7", dur: "2s", repeatCount: "indefinite" })), /* @__PURE__ */ React.createElement("circle", { cx: hlPoint[0], cy: hlPoint[1], r: "3.2", fill: "#F0A857" })), buyMarkers.map(([x, y], i) => /* @__PURE__ */ React.createElement(
        "circle",
        {
          key: `buy-${i}`,
          cx: x,
          cy: y,
          r: "2.6",
          fill: "#3DDC84",
          stroke: "#0B0F14",
          strokeWidth: "0.6"
        }
      )), sellMarkers.map(([x, y], i) => /* @__PURE__ */ React.createElement(
        "circle",
        {
          key: `sell-${i}`,
          cx: x,
          cy: y,
          r: "2.6",
          fill: "#E85D5D",
          stroke: "#0B0F14",
          strokeWidth: "0.6"
        }
      )), showAxis && axisLabels.map((a, i) => /* @__PURE__ */ React.createElement(
        "text",
        {
          key: i,
          x: a.x,
          y: height - 3,
          fontSize: "9",
          fill: "#8A9AA8",
          textAnchor: i === 0 ? "start" : i === axisLabels.length - 1 ? "end" : "middle"
        },
        a.label
      ))),
      hoverPoint && hoverDate && /* @__PURE__ */ React.createElement(
        "div",
        {
          className: "sparkline-tooltip",
          style: { left: Math.min(Math.max(hoverPoint[0], 40), width - 40) }
        },
        /* @__PURE__ */ React.createElement("div", { className: "sparkline-tooltip__date" }, formatDateFull(hoverDate)),
        /* @__PURE__ */ React.createElement("div", { className: "sparkline-tooltip__price mono" }, "\xA5", hoverPrice.toLocaleString())
      ),
      hlPoint && hlDate && !hoverPoint && /* @__PURE__ */ React.createElement("div", { className: "sparkline-caption" }, "\u5E95\u5024: ", formatDateShort(hlDate))
    );
  }
  function TrendChip({ label, value }) {
    if (value === null || value === void 0) {
      return /* @__PURE__ */ React.createElement("div", { className: "trend-chip trend-chip--flat" }, /* @__PURE__ */ React.createElement("span", { className: "trend-chip__label" }, label), /* @__PURE__ */ React.createElement("span", { className: "trend-chip__value" }, "\u2014"));
    }
    const isUp = value > 0;
    const cls = isUp ? "trend-chip--up" : value < 0 ? "trend-chip--down" : "trend-chip--flat";
    return /* @__PURE__ */ React.createElement("div", { className: `trend-chip ${cls}` }, /* @__PURE__ */ React.createElement("span", { className: "trend-chip__label" }, label), /* @__PURE__ */ React.createElement("span", { className: "trend-chip__value" }, isUp ? "\u25B2" : value < 0 ? "\u25BC" : "\u2015", " ", Math.abs(value).toFixed(1), "%"));
  }
  function VerdictBadge({ verdict }) {
    const map = {
      "\u8CB7\u3044\u6642": "badge--buy",
      "\u6CE8\u76EE": "badge--watch",
      "\u69D8\u5B50\u898B": "badge--neutral",
      "\u5272\u9AD8": "badge--high"
    };
    return /* @__PURE__ */ React.createElement("span", { className: `badge ${map[verdict] || "badge--neutral"}` }, verdict);
  }
  function GranvilleSummary({ granvilleSignals }) {
    if (!granvilleSignals) return null;
    const buyCount = granvilleSignals.filter((s) => s === "buy").length;
    const sellCount = granvilleSignals.filter((s) => s === "sell").length;
    if (buyCount === 0 && sellCount === 0) return null;
    return /* @__PURE__ */ React.createElement("div", { className: "granville-summary" }, buyCount > 0 && /* @__PURE__ */ React.createElement("span", { className: "granville-summary__item granville-summary__item--buy" }, "\u{1F7E2} \u8CB7\u3044\xD7", buyCount), sellCount > 0 && /* @__PURE__ */ React.createElement("span", { className: "granville-summary__item granville-summary__item--sell" }, "\u{1F534} \u58F2\u308A\xD7", sellCount));
  }
  function StockCard({ stock, onOpen }) {
    const { signal, granvilleSignals } = stock;
    const bottomIdxGlobal = signal.bottom.isBottom ? signal.bottom.minIdx : null;
    return /* @__PURE__ */ React.createElement("button", { className: "stock-card", onClick: () => onOpen(stock) }, /* @__PURE__ */ React.createElement("div", { className: "stock-card__top" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "stock-card__name" }, stock.name), /* @__PURE__ */ React.createElement("div", { className: "stock-card__meta" }, stock.code, " \u30FB ", stock.sector)), /* @__PURE__ */ React.createElement("div", { className: "stock-card__badges" }, /* @__PURE__ */ React.createElement(VerdictBadge, { verdict: signal.verdict }))), /* @__PURE__ */ React.createElement("div", { className: "stock-card__body" }, /* @__PURE__ */ React.createElement(
      Sparkline,
      {
        prices: stock.prices,
        dates: stock.dates,
        sma30: stock.sma30,
        sma90: stock.sma90,
        highlightIdx: signal.bottom.isBottom ? bottomIdxGlobal : null,
        granvilleSignals
      }
    ), /* @__PURE__ */ React.createElement("div", { className: "stock-card__stats" }, /* @__PURE__ */ React.createElement("div", { className: "stat" }, /* @__PURE__ */ React.createElement("span", { className: "stat__label" }, "\u682A\u4FA1"), /* @__PURE__ */ React.createElement("span", { className: "stat__value mono" }, "\xA5", stock.latestPrice.toLocaleString())), /* @__PURE__ */ React.createElement("div", { className: "stat" }, /* @__PURE__ */ React.createElement("span", { className: "stat__label" }, "\u914D\u5F53\u5229\u56DE\u308A"), /* @__PURE__ */ React.createElement("span", { className: "stat__value mono" }, stock.dividendYield.toFixed(1), "%")))), /* @__PURE__ */ React.createElement(GranvilleSummary, { granvilleSignals }), /* @__PURE__ */ React.createElement("div", { className: "stock-card__trends" }, /* @__PURE__ */ React.createElement(TrendChip, { label: "30\u65E5", value: signal.trends.d30 }), /* @__PURE__ */ React.createElement(TrendChip, { label: "60\u65E5", value: signal.trends.d60 }), /* @__PURE__ */ React.createElement(TrendChip, { label: "120\u65E5", value: signal.trends.d120 }), /* @__PURE__ */ React.createElement(TrendChip, { label: "180\u65E5", value: signal.trends.d180 }), /* @__PURE__ */ React.createElement(TrendChip, { label: "365\u65E5", value: signal.trends.d365 })), signal.bottom.isBottom && /* @__PURE__ */ React.createElement("div", { className: "stock-card__bottom-flag" }, "\u5E95\u5024\u30B7\u30B0\u30CA\u30EB\u691C\u77E5\uFF08", signal.bottom.daysSinceMin, "\u65E5\u524D\u306B\u6975\u5C0F\u5024\uFF09"));
  }
  function DetailModal({ stock, onClose }) {
    if (!stock) return null;
    const { signal, granvilleSignals } = stock;
    const buyCount = granvilleSignals ? granvilleSignals.filter((s) => s === "buy").length : 0;
    const sellCount = granvilleSignals ? granvilleSignals.filter((s) => s === "sell").length : 0;
    return /* @__PURE__ */ React.createElement("div", { className: "modal-backdrop", onClick: onClose }, /* @__PURE__ */ React.createElement("div", { className: "modal", onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("div", { className: "modal__header" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "modal__name" }, stock.name), /* @__PURE__ */ React.createElement("div", { className: "modal__meta" }, stock.code, " \u30FB ", stock.index, " \u30FB ", stock.sector)), /* @__PURE__ */ React.createElement("button", { className: "modal__close", onClick: onClose, "aria-label": "\u9589\u3058\u308B" }, "\u2715")), /* @__PURE__ */ React.createElement("div", { className: "modal__hero" }, /* @__PURE__ */ React.createElement(
      Sparkline,
      {
        prices: stock.prices,
        dates: stock.dates,
        sma30: stock.sma30,
        sma90: stock.sma90,
        highlightIdx: signal.bottom.isBottom ? signal.bottom.minIdx : null,
        granvilleSignals,
        width: 320,
        height: 130,
        showAxis: true
      }
    ), /* @__PURE__ */ React.createElement("div", { className: "modal__legend" }, /* @__PURE__ */ React.createElement("span", { className: "modal__legend-item" }, /* @__PURE__ */ React.createElement("span", { className: "modal__legend-swatch modal__legend-swatch--price" }), "\u682A\u4FA1"), /* @__PURE__ */ React.createElement("span", { className: "modal__legend-item" }, /* @__PURE__ */ React.createElement("span", { className: "modal__legend-swatch modal__legend-swatch--sma30" }), "30\u65E5\u79FB\u52D5\u5E73\u5747\u7DDA"), /* @__PURE__ */ React.createElement("span", { className: "modal__legend-item" }, /* @__PURE__ */ React.createElement("span", { className: "modal__legend-swatch modal__legend-swatch--sma90" }), "90\u65E5\u79FB\u52D5\u5E73\u5747\u7DDA"), /* @__PURE__ */ React.createElement("span", { className: "modal__legend-item" }, /* @__PURE__ */ React.createElement("span", { className: "modal__legend-dot modal__legend-dot--buy" }), "\u8CB7\u3044\u30B7\u30B0\u30CA\u30EB"), /* @__PURE__ */ React.createElement("span", { className: "modal__legend-item" }, /* @__PURE__ */ React.createElement("span", { className: "modal__legend-dot modal__legend-dot--sell" }), "\u58F2\u308A\u30B7\u30B0\u30CA\u30EB")), /* @__PURE__ */ React.createElement("div", { className: "modal__price-row" }, /* @__PURE__ */ React.createElement("span", { className: "mono modal__price" }, "\xA5", stock.latestPrice.toLocaleString()), /* @__PURE__ */ React.createElement(VerdictBadge, { verdict: signal.verdict }))), /* @__PURE__ */ React.createElement("div", { className: "modal__section" }, /* @__PURE__ */ React.createElement("div", { className: "modal__section-title" }, "\u914D\u5F53\u5229\u56DE\u308A"), /* @__PURE__ */ React.createElement("div", { className: "modal__dividend mono" }, stock.dividendYield.toFixed(2), "%")), /* @__PURE__ */ React.createElement("div", { className: "modal__section" }, /* @__PURE__ */ React.createElement("div", { className: "modal__section-title" }, "\u9577\u671F\u30C8\u30EC\u30F3\u30C9\u5224\u5B9A\uFF08\u671F\u9593\u5909\u5316\u7387\uFF09"), /* @__PURE__ */ React.createElement("div", { className: "modal__trend-grid" }, /* @__PURE__ */ React.createElement(TrendChip, { label: "30\u65E5", value: signal.trends.d30 }), /* @__PURE__ */ React.createElement(TrendChip, { label: "60\u65E5", value: signal.trends.d60 }), /* @__PURE__ */ React.createElement(TrendChip, { label: "120\u65E5", value: signal.trends.d120 }), /* @__PURE__ */ React.createElement(TrendChip, { label: "180\u65E5", value: signal.trends.d180 }), /* @__PURE__ */ React.createElement(TrendChip, { label: "365\u65E5", value: signal.trends.d365 }))), /* @__PURE__ */ React.createElement("div", { className: "modal__section" }, /* @__PURE__ */ React.createElement("div", { className: "modal__section-title" }, "\u30B0\u30E9\u30F3\u30D3\u30EB\u306E\u6CD5\u5247\u306B\u3088\u308B\u8CB7\u3044\u6642/\u58F2\u308A\u6642\u30B7\u30B0\u30CA\u30EB"), buyCount > 0 || sellCount > 0 ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "granville__detail-grid" }, /* @__PURE__ */ React.createElement("div", { className: "granville__detail-item" }, /* @__PURE__ */ React.createElement("span", { className: "granville__detail-label" }, "\u{1F7E2} \u8CB7\u3044\u30B7\u30B0\u30CA\u30EB"), /* @__PURE__ */ React.createElement("span", { className: "granville__detail-value" }, buyCount, "\u65E5")), /* @__PURE__ */ React.createElement("div", { className: "granville__detail-item" }, /* @__PURE__ */ React.createElement("span", { className: "granville__detail-label" }, "\u{1F534} \u58F2\u308A\u30B7\u30B0\u30CA\u30EB"), /* @__PURE__ */ React.createElement("span", { className: "granville__detail-value" }, sellCount, "\u65E5"))), /* @__PURE__ */ React.createElement("p", { className: "modal__explain" }, "\u3053\u306E\u9298\u67C4\u306E\u5168\u671F\u9593\u306E\u4E2D\u3067\u3001\u5224\u5B9A\u57FA\u6E96\u306B\u4E00\u81F4\u3057\u305F\u5019\u88DC\u65E5\u306E\u3046\u3061 \u300C\u30B7\u30B0\u30CA\u30EB\u306E\u5F37\u3055\u30B9\u30B3\u30A2\u300D\u304C\u9AD8\u3044\u9806\u306B\u3001\u8CB7\u3044\u30FB\u58F2\u308A\u305D\u308C\u305E\u308C\u6700\u59275\u65E5\u3092 \u30B0\u30E9\u30D5\u4E0A\u306B\u7DD1\uFF08\u8CB7\u3044\uFF09\u30FB\u8D64\uFF08\u58F2\u308A\uFF09\u306E\u70B9\u3067\u793A\u3057\u3066\u3044\u307E\u3059\u3002 \u73FE\u5728\u306E\u8868\u793A\u671F\u9593\uFF08\u6700\u5927180\u65E5\uFF09\u306E\u5916\u306B\u3042\u308B\u5834\u5408\u306F\u3001\u30B0\u30E9\u30D5\u306B\u306F\u6620\u308A\u307E\u305B\u3093\u3002")) : /* @__PURE__ */ React.createElement("p", { className: "modal__explain" }, "\u3053\u306E\u9298\u67C4\u3067\u306F\u3001\u5224\u5B9A\u57FA\u6E96\u306B\u4E00\u81F4\u3059\u308B\u5019\u88DC\u65E5\u304C\u898B\u3064\u304B\u3089\u306A\u304B\u3063\u305F\u305F\u3081\u3001 \u30B7\u30B0\u30CA\u30EA\u30F3\u30B0\u3092\u884C\u3063\u3066\u3044\u307E\u305B\u3093\u3002")), /* @__PURE__ */ React.createElement("div", { className: "modal__section" }, /* @__PURE__ */ React.createElement("div", { className: "modal__section-title" }, "\u5E95\u5024\uFF08\u6975\u5C0F\u5024\uFF09\u5224\u5B9A"), /* @__PURE__ */ React.createElement("p", { className: "modal__explain" }, signal.bottom.isBottom ? `\u76F4\u8FD1${signal.bottom.daysSinceMin}\u65E5\u524D\u306B\u300130\u65E5\u79FB\u52D5\u5E73\u5747\u7DDA\u304C\u5E95\uFF08\u4E0B\u964D\u304B\u3089\u4E0A\u6607\u306B\u8EE2\u63DB\u3057\u3001\u4E0B\u306B\u51F8\uFF09\u3092\u8FCE\u3048\u305F\u3053\u3068\u3092\u691C\u77E5\u3057\u307E\u3057\u305F\u3002\u65E5\u3005\u306E\u7D30\u304B\u306A\u5024\u52D5\u304D\u3067\u306F\u306A\u304F\u3001\u306A\u3089\u3057\u305F\u79FB\u52D5\u5E73\u5747\u7DDA\u3067\u5224\u5B9A\u3057\u3066\u3044\u308B\u305F\u3081\u3001\u4E00\u6642\u7684\u306A\u6025\u843D\u30FB\u6025\u9A30\u306B\u3088\u308B\u8AA4\u691C\u77E5\u304C\u8D77\u304D\u306B\u304F\u304F\u306A\u3063\u3066\u3044\u307E\u3059\u3002\u53CD\u767A\u306E\u521D\u671F\u6BB5\u968E\u306E\u53EF\u80FD\u6027\u304C\u3042\u308A\u307E\u3059\u3002` : "\u76F4\u8FD1\u3067\u306F30\u65E5\u79FB\u52D5\u5E73\u5747\u7DDA\u306E\u6975\u5C0F\u5024\uFF08\u5E95\u5024\uFF09\u306F\u691C\u51FA\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002\u4E0B\u964D\u30C8\u30EC\u30F3\u30C9\u304C\u7D99\u7D9A\u3057\u3066\u3044\u308B\u304B\u3001\u3059\u3067\u306B\u53CD\u767A\u304C\u9032\u884C\u3057\u3066\u3044\u308B\u72B6\u614B\u3067\u3059\u3002")), /* @__PURE__ */ React.createElement("div", { className: "modal__section" }, /* @__PURE__ */ React.createElement("div", { className: "modal__section-title" }, "\u7DCF\u5408\u30B9\u30B3\u30A2"), /* @__PURE__ */ React.createElement("div", { className: "modal__score-bar" }, /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "modal__score-fill",
        style: {
          width: `${(signal.score + 100) / 2}%`,
          background: signal.score >= 40 ? "#4FD1C5" : signal.score >= 10 ? "#F0A857" : "#E85D5D"
        }
      }
    )), /* @__PURE__ */ React.createElement("div", { className: "modal__score-label mono" }, signal.score, " / 100"))));
  }
  function AlertBanner({ buyList, onJump }) {
    if (buyList.length === 0) return null;
    return /* @__PURE__ */ React.createElement("div", { className: "alert-banner" }, /* @__PURE__ */ React.createElement("div", { className: "alert-banner__icon" }, "\u25C6"), /* @__PURE__ */ React.createElement("div", { className: "alert-banner__text" }, /* @__PURE__ */ React.createElement("strong", null, buyList.length, "\u9298\u67C4"), "\u304C\u8CB7\u3044\u6642\u30B7\u30B0\u30CA\u30EB\u3092\u691C\u77E5\u3057\u307E\u3057\u305F\uFF1A", /* @__PURE__ */ React.createElement("span", { className: "alert-banner__names" }, buyList.map((s) => s.name).join("\u30FB"))), /* @__PURE__ */ React.createElement("button", { className: "alert-banner__btn", onClick: onJump }, "\u78BA\u8A8D\u3059\u308B"));
  }
  function GranvilleExplainerSample() {
    const pricePath = "M0,70 L20,66 L40,72 L60,60 L80,64 L100,52 L120,56 L140,44 L160,48 L180,36 L200,40 L220,30 L240,34 L260,24 L280,28 L300,20";
    const sma30Path = "M20,68 L40,68 L60,66 L80,63 L100,58 L120,54 L140,50 L160,46 L180,42 L200,40 L220,37 L240,34 L260,31 L280,29 L300,26";
    const sma90Path = "M60,72 L120,66 L180,54 L240,42 L300,32";
    return /* @__PURE__ */ React.createElement("div", { className: "explainer" }, /* @__PURE__ */ React.createElement("div", { className: "explainer__top" }, /* @__PURE__ */ React.createElement("div", { className: "explainer__text" }, /* @__PURE__ */ React.createElement("h2", { className: "explainer__title" }, "\u{1F7E2}\u{1F534} \u8CB7\u3044\u6642/\u58F2\u308A\u6642\u30B7\u30B0\u30CA\u30EB\u306E\u898B\u65B9"), /* @__PURE__ */ React.createElement("p", { className: "explainer__body" }, "\u5404\u9298\u67C4\u306B\u3064\u3044\u3066\u3001", /* @__PURE__ */ React.createElement("strong", null, "90\u65E5\u79FB\u52D5\u5E73\u5747\u7DDA\uFF08\u9577\u671F\u30FB\u9752\u306E\u70B9\u7DDA\uFF09"), "\u30FB", /* @__PURE__ */ React.createElement("strong", null, "30\u65E5\u79FB\u52D5\u5E73\u5747\u7DDA\uFF08\u4E2D\u671F\u30FB\u30A2\u30F3\u30D0\u30FC\u306E\u70B9\u7DDA\uFF09"), "\u30FB", /* @__PURE__ */ React.createElement("strong", null, "\u65E5\u3005\u306E\u682A\u4FA1\uFF08\u77ED\u671F\u30FB\u30C6\u30A3\u30FC\u30EB\u8272\u306E\u5B9F\u7DDA\uFF09"), "\u306E3\u672C\u304C\u3001 \u305D\u308C\u305E\u308C\u300C\u4E0A\u6607\u2197\uFF0F\u6A2A\u3070\u3044\u2192\uFF0F\u4E0B\u964D\u2198\u300D\u306E\u3069\u3061\u3089\u3092\u5411\u3044\u3066\u3044\u308B\u304B\u3092 \u65E5\u3054\u3068\u306B\u30C1\u30A7\u30C3\u30AF\u3057\u3066\u3044\u307E\u3059\u3002"), /* @__PURE__ */ React.createElement("p", { className: "explainer__body" }, "\u3053\u306E3\u65B9\u5411\u306E\u7D44\u307F\u5408\u308F\u305B\uFF083\xD73\xD73\uFF1D27\u901A\u308A\uFF09\u306E\u3046\u3061\u3001\u30B0\u30E9\u30F3\u30D3\u30EB\u306E\u6CD5\u5247\u3092 \u53C2\u8003\u306B\u3057\u305F\u5224\u5B9A\u8868\u306B\u4E00\u81F4\u3059\u308B", /* @__PURE__ */ React.createElement("strong", null, "15\u30D1\u30BF\u30FC\u30F3"), "\uFF08\u8CB7\u3044\u30D1\u30BF\u30FC\u30F37\u901A\u308A\u30FB\u58F2\u308A\u30D1\u30BF\u30FC\u30F38\u901A\u308A\uFF09\u3060\u3051\u3092\u5019\u88DC\u3068\u3057\u307E\u3059\u3002 \u8868\u306B\u306A\u3044\u6B8B\u308A12\u901A\u308A\u306E\u3042\u3044\u307E\u3044\u306A\u7D44\u307F\u5408\u308F\u305B\u306F\u3001\u7121\u7406\u306B\u5224\u5B9A\u305B\u305A \u5019\u88DC\u306B\u3082\u5165\u308C\u307E\u305B\u3093\u3002")), /* @__PURE__ */ React.createElement("div", { className: "explainer__sample" }, /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 300 90", className: "explainer__svg" }, /* @__PURE__ */ React.createElement("path", { d: sma90Path, fill: "none", stroke: "#7C9CFF", strokeWidth: "1.6", strokeDasharray: "6,3", opacity: "0.8" }), /* @__PURE__ */ React.createElement("path", { d: sma30Path, fill: "none", stroke: "#F0A857", strokeWidth: "1.6", strokeDasharray: "3,2", opacity: "0.85" }), /* @__PURE__ */ React.createElement("path", { d: pricePath, fill: "none", stroke: "#4FD1C5", strokeWidth: "2" }), /* @__PURE__ */ React.createElement("circle", { cx: "100", cy: "52", r: "4", fill: "#3DDC84", stroke: "#0B0F14", strokeWidth: "0.8" }), /* @__PURE__ */ React.createElement("circle", { cx: "180", cy: "36", r: "4", fill: "#3DDC84", stroke: "#0B0F14", strokeWidth: "0.8" }), /* @__PURE__ */ React.createElement("circle", { cx: "60", cy: "60", r: "4", fill: "#E85D5D", stroke: "#0B0F14", strokeWidth: "0.8" }), /* @__PURE__ */ React.createElement("circle", { cx: "140", cy: "44", r: "4", fill: "#E85D5D", stroke: "#0B0F14", strokeWidth: "0.8" })), /* @__PURE__ */ React.createElement("div", { className: "explainer__sample-legend" }, /* @__PURE__ */ React.createElement("span", { className: "explainer__legend-item" }, /* @__PURE__ */ React.createElement("span", { className: "modal__legend-swatch modal__legend-swatch--price" }), "\u682A\u4FA1"), /* @__PURE__ */ React.createElement("span", { className: "explainer__legend-item" }, /* @__PURE__ */ React.createElement("span", { className: "modal__legend-swatch modal__legend-swatch--sma30" }), "30\u65E5\u7DDA"), /* @__PURE__ */ React.createElement("span", { className: "explainer__legend-item" }, /* @__PURE__ */ React.createElement("span", { className: "modal__legend-swatch modal__legend-swatch--sma90" }), "90\u65E5\u7DDA"), /* @__PURE__ */ React.createElement("span", { className: "explainer__legend-item" }, /* @__PURE__ */ React.createElement("span", { className: "modal__legend-dot modal__legend-dot--buy" }), "\u8CB7\u3044"), /* @__PURE__ */ React.createElement("span", { className: "explainer__legend-item" }, /* @__PURE__ */ React.createElement("span", { className: "modal__legend-dot modal__legend-dot--sell" }), "\u58F2\u308A")), /* @__PURE__ */ React.createElement("p", { className: "explainer__sample-caption" }, "\u203B \u4E0A\u56F3\u306F\u8AAC\u660E\u7528\u306E\u30B5\u30F3\u30D7\u30EB\u3067\u3059\u3002\u5B9F\u969B\u306E\u30B0\u30E9\u30D5\u3068\u306F\u7570\u306A\u308A\u307E\u3059\u3002"))), /* @__PURE__ */ React.createElement("div", { className: "explainer__detail-grid" }, /* @__PURE__ */ React.createElement("div", { className: "explainer__detail-card" }, /* @__PURE__ */ React.createElement("div", { className: "explainer__detail-card-title" }, "\u2460 \u4F55\u30D1\u30BF\u30FC\u30F3\u3067\u5224\u5B9A\u3057\u3066\u3044\u308B\u304B"), /* @__PURE__ */ React.createElement("p", { className: "explainer__detail-card-body" }, "\u9577\u671F\u30FB\u4E2D\u671F\u30FB\u77ED\u671F\u305D\u308C\u305E\u308C3\u65B9\u5411\uFF08\u4E0A\u6607/\u6A2A\u3070\u3044/\u4E0B\u964D\uFF09\u306E\u7D44\u307F\u5408\u308F\u305B 27\u901A\u308A\u306E\u3046\u3061\u3001\u3042\u3089\u304B\u3058\u3081\u6307\u5B9A\u3055\u308C\u305F", /* @__PURE__ */ React.createElement("strong", null, "15\u30D1\u30BF\u30FC\u30F3"), "\uFF08\u8CB7\u3044\u66427\u30D1\u30BF\u30FC\u30F3\u30FB\u58F2\u308A\u66428\u30D1\u30BF\u30FC\u30F3\uFF09\u3060\u3051\u3092\u5224\u5B9A\u306B\u4F7F\u3063\u3066\u3044\u307E\u3059\u3002 \u6B8B\u308A12\u30D1\u30BF\u30FC\u30F3\u306F\u3001\u6839\u62E0\u304C\u3042\u3044\u307E\u3044\u306A\u305F\u3081\u5224\u5B9A\u5BFE\u8C61\u306B\u542B\u3081\u3066\u3044\u307E\u305B\u3093\u3002 \u5404\u30D1\u30BF\u30FC\u30F3\u306E\u610F\u5473\u306F\u4E0B\u306E\u4E00\u89A7\u3067\u78BA\u8A8D\u3067\u304D\u307E\u3059\u3002")), /* @__PURE__ */ React.createElement("div", { className: "explainer__detail-card" }, /* @__PURE__ */ React.createElement("div", { className: "explainer__detail-card-title" }, "\u2461 \u30B9\u30B3\u30A2\u306F\u3069\u3046\u7B97\u51FA\u3055\u308C\u308B\u304B"), /* @__PURE__ */ React.createElement("p", { className: "explainer__detail-card-body" }, "\u4E0A\u8A1815\u30D1\u30BF\u30FC\u30F3\u306B\u4E00\u81F4\u3057\u305F\u65E5\u306B\u3064\u3044\u3066\u3001", /* @__PURE__ */ React.createElement("strong", null, "\u9577\u671F\u30FB\u4E2D\u671F\u30FB\u77ED\u671F \u305D\u308C\u305E\u308C\u306E\u5909\u5316\u7387(%)\u306E\u7D76\u5BFE\u5024\u3092\u5408\u8A08"), "\u3057\u305F\u5024\u3092 \u300C\u30B7\u30B0\u30CA\u30EB\u306E\u5F37\u3055\u30B9\u30B3\u30A2\u300D\u3068\u3057\u307E\u3059\u30023\u3064\u306E\u6642\u9593\u8EF8\u3059\u3079\u3066\u3067 \u5024\u52D5\u304D\u304C\u306F\u3063\u304D\u308A\u3057\u3066\u3044\u308B\u65E5\u307B\u3069\u3001\u30B9\u30B3\u30A2\u304C\u9AD8\u304F\u306A\u308A\u307E\u3059\u3002")), /* @__PURE__ */ React.createElement("div", { className: "explainer__detail-card" }, /* @__PURE__ */ React.createElement("div", { className: "explainer__detail-card-title" }, "\u2462 \u3069\u306E\u57FA\u6E96\u3067\u30B7\u30B0\u30CA\u30EA\u30F3\u30B0\u3055\u308C\u308B\u304B"), /* @__PURE__ */ React.createElement("p", { className: "explainer__detail-card-body" }, "\u9298\u67C4\u3054\u3068\u306B\u3001\u8CB7\u3044\u5019\u88DC\u30FB\u58F2\u308A\u5019\u88DC\u305D\u308C\u305E\u308C\u3092\u30B9\u30B3\u30A2\u304C\u9AD8\u3044\u9806\u306B\u4E26\u3079\u3001", /* @__PURE__ */ React.createElement("strong", null, "\u6700\u59275\u65E5\u307E\u3067"), "\u3092\u5B9F\u969B\u306E\u30B7\u30B0\u30CA\u30EB\u3068\u3057\u3066\u8868\u793A\u3057\u307E\u3059\u3002 \u5019\u88DC\u304C5\u65E5\u306B\u6E80\u305F\u306A\u3044\u5834\u5408\u306F\u3001\u7121\u7406\u306B5\u65E5\u3078\u6C34\u5897\u3057\u305B\u305A\u3001", /* @__PURE__ */ React.createElement("strong", null, "\u5B9F\u969B\u306B\u3042\u308B\u4EF6\u6570\uFF080\u301C4\u65E5\uFF09\u3060\u3051"), "\u3092\u305D\u306E\u307E\u307E\u8868\u793A\u3057\u307E\u3059\u3002"))), /* @__PURE__ */ React.createElement("details", { className: "explainer__patterns" }, /* @__PURE__ */ React.createElement("summary", { className: "explainer__patterns-summary" }, "15\u30D1\u30BF\u30FC\u30F3\u305D\u308C\u305E\u308C\u306E\u610F\u5473\u3092\u898B\u308B\uFF08\u9577\u671F\u30FB\u4E2D\u671F\u30FB\u77ED\u671F\u306E\u5411\u304D\u5225\uFF09"), /* @__PURE__ */ React.createElement("div", { className: "explainer__patterns-block" }, /* @__PURE__ */ React.createElement("div", { className: "explainer__patterns-block-title" }, "\u{1F7E2} \u8CB7\u3044\u30D1\u30BF\u30FC\u30F3\uFF087\u901A\u308A\uFF09"), /* @__PURE__ */ React.createElement("table", { className: "explainer__patterns-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "\u9577\u671F"), /* @__PURE__ */ React.createElement("th", null, "\u4E2D\u671F"), /* @__PURE__ */ React.createElement("th", null, "\u77ED\u671F"), /* @__PURE__ */ React.createElement("th", null, "\u610F\u5473"))), /* @__PURE__ */ React.createElement("tbody", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, "\u2197"), /* @__PURE__ */ React.createElement("td", null, "\u2197"), /* @__PURE__ */ React.createElement("td", null, "\u2197"), /* @__PURE__ */ React.createElement("td", null, "\u9577\u671F\u30FB\u4E2D\u671F\u30FB\u77ED\u671F\u3059\u3079\u3066\u4E0A\u6607\u3002\u6700\u3082\u5F37\u3044\u8CB7\u3044\u74B0\u5883")), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, "\u2197"), /* @__PURE__ */ React.createElement("td", null, "\u2197"), /* @__PURE__ */ React.createElement("td", null, "\u2192"), /* @__PURE__ */ React.createElement("td", null, "\u9577\u671F\u30FB\u4E2D\u671F\u304C\u4E0A\u6607\u3002\u77ED\u671F\u306F\u4E00\u670D\u3060\u304C\u4E0A\u6607\u30C8\u30EC\u30F3\u30C9\u7DAD\u6301")), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, "\u2197"), /* @__PURE__ */ React.createElement("td", null, "\u2192"), /* @__PURE__ */ React.createElement("td", null, "\u2197"), /* @__PURE__ */ React.createElement("td", null, "\u9577\u671F\u4E0A\u6607\uFF0B\u77ED\u671F\u4E0A\u6607\u3002\u4E2D\u671F\u7DDA\u306E\u4E0A\u6607\u8EE2\u63DB\u3092\u5F85\u3064\u6BB5\u968E")), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, "\u2192"), /* @__PURE__ */ React.createElement("td", null, "\u2197"), /* @__PURE__ */ React.createElement("td", null, "\u2197"), /* @__PURE__ */ React.createElement("td", null, "\u4E2D\u671F\u30FB\u77ED\u671F\u304C\u4E0A\u6607\u3002\u9577\u671F\u306F\u65B9\u5411\u611F\u306A\u3057\u3060\u304C\u8CB7\u3044\u512A\u52E2")), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, "\u2192"), /* @__PURE__ */ React.createElement("td", null, "\u2197"), /* @__PURE__ */ React.createElement("td", null, "\u2192"), /* @__PURE__ */ React.createElement("td", null, "\u4E2D\u671F\u4E0A\u6607\u3002\u9577\u671F\u306F\u6A2A\u3070\u3044\u3067\u3001\u77ED\u671F\u3082\u5927\u304D\u304F\u5D29\u308C\u3066\u3044\u306A\u3044")), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, "\u2198"), /* @__PURE__ */ React.createElement("td", null, "\u2197"), /* @__PURE__ */ React.createElement("td", null, "\u2197"), /* @__PURE__ */ React.createElement("td", null, "\u9577\u671F\u306F\u4E0B\u964D\u3060\u304C\u3001\u4E2D\u671F\u30FB\u77ED\u671F\u304C\u4E0A\u6607\u3002\u4E0A\u6607\u8EE2\u63DB\u306E\u521D\u52D5\u5019\u88DC")), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, "\u2198"), /* @__PURE__ */ React.createElement("td", null, "\u2197"), /* @__PURE__ */ React.createElement("td", null, "\u2192"), /* @__PURE__ */ React.createElement("td", null, "\u9577\u671F\u4E0B\u964D\u306E\u4E2D\u3067\u4E2D\u671F\u4E0A\u6607\u3002\u53CD\u8EE2\u3092\u78BA\u8A8D\u3059\u308B\u6BB5\u968E"))))), /* @__PURE__ */ React.createElement("div", { className: "explainer__patterns-block" }, /* @__PURE__ */ React.createElement("div", { className: "explainer__patterns-block-title" }, "\u{1F534} \u58F2\u308A\u30D1\u30BF\u30FC\u30F3\uFF088\u901A\u308A\uFF09"), /* @__PURE__ */ React.createElement("table", { className: "explainer__patterns-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "\u9577\u671F"), /* @__PURE__ */ React.createElement("th", null, "\u4E2D\u671F"), /* @__PURE__ */ React.createElement("th", null, "\u77ED\u671F"), /* @__PURE__ */ React.createElement("th", null, "\u610F\u5473"))), /* @__PURE__ */ React.createElement("tbody", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, "\u2197"), /* @__PURE__ */ React.createElement("td", null, "\u2198"), /* @__PURE__ */ React.createElement("td", null, "\u2198"), /* @__PURE__ */ React.createElement("td", null, "\u9577\u671F\u4E0A\u6607\u3067\u3082\u4E2D\u671F\u30FB\u77ED\u671F\u304C\u4E0B\u964D\u3002\u8ABF\u6574\u30FB\u4E0B\u964D\u8EE2\u63DB\u3092\u8B66\u6212")), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, "\u2197"), /* @__PURE__ */ React.createElement("td", null, "\u2198"), /* @__PURE__ */ React.createElement("td", null, "\u2192"), /* @__PURE__ */ React.createElement("td", null, "\u9577\u671F\u306F\u4E0A\u6607\u3060\u304C\u4E2D\u671F\u4E0B\u964D\u3002\u623B\u308A\u58F2\u308A\u3092\u8B66\u6212")), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, "\u2192"), /* @__PURE__ */ React.createElement("td", null, "\u2198"), /* @__PURE__ */ React.createElement("td", null, "\u2198"), /* @__PURE__ */ React.createElement("td", null, "\u4E2D\u671F\u30FB\u77ED\u671F\u304C\u4E0B\u964D\u3002\u9577\u671F\u3082\u65B9\u5411\u611F\u306A\u3057\u3067\u8CB7\u3044\u306B\u304F\u3044")), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, "\u2198"), /* @__PURE__ */ React.createElement("td", null, "\u2197"), /* @__PURE__ */ React.createElement("td", null, "\u2198"), /* @__PURE__ */ React.createElement("td", null, "\u9577\u671F\u4E0B\u964D\uFF0B\u77ED\u671F\u4E0B\u964D\u3002\u4E2D\u671F\u4E0A\u6607\u3067\u3082\u62BC\u3057\u623B\u3055\u308C\u3066\u3044\u308B")), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, "\u2198"), /* @__PURE__ */ React.createElement("td", null, "\u2192"), /* @__PURE__ */ React.createElement("td", null, "\u2198"), /* @__PURE__ */ React.createElement("td", null, "\u9577\u671F\u4E0B\u964D\uFF0B\u77ED\u671F\u4E0B\u964D\u3002\u4E2D\u671F\u7DDA\u3082\u6A2A\u3070\u3044\u3067\u5F31\u3044")), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, "\u2198"), /* @__PURE__ */ React.createElement("td", null, "\u2198"), /* @__PURE__ */ React.createElement("td", null, "\u2197"), /* @__PURE__ */ React.createElement("td", null, "\u9577\u671F\u30FB\u4E2D\u671F\u4E0B\u964D\u3002\u77ED\u671F\u4E0A\u6607\u306F\u5358\u306A\u308B\u623B\u308A\u306E\u53EF\u80FD\u6027")), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, "\u2198"), /* @__PURE__ */ React.createElement("td", null, "\u2198"), /* @__PURE__ */ React.createElement("td", null, "\u2192"), /* @__PURE__ */ React.createElement("td", null, "\u9577\u671F\u30FB\u4E2D\u671F\u3068\u3082\u4E0B\u964D\u3002\u77ED\u671F\u306F\u4E00\u670D")), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, "\u2198"), /* @__PURE__ */ React.createElement("td", null, "\u2198"), /* @__PURE__ */ React.createElement("td", null, "\u2198"), /* @__PURE__ */ React.createElement("td", null, "\u9577\u671F\u30FB\u4E2D\u671F\u30FB\u77ED\u671F\u3059\u3079\u3066\u4E0B\u964D\u3002\u6700\u3082\u5F37\u3044\u58F2\u308A\u74B0\u5883"))))), /* @__PURE__ */ React.createElement("p", { className: "explainer__patterns-note" }, "\u2197\uFF1D\u4E0A\u6607\u3000\u2192\uFF1D\u6A2A\u3070\u3044\u3000\u2198\uFF1D\u4E0B\u964D\u3002\u9577\u671F\uFF1D90\u65E5\u79FB\u52D5\u5E73\u5747\u7DDA\u3001\u4E2D\u671F\uFF1D30\u65E5\u79FB\u52D5\u5E73\u5747\u7DDA\u3001 \u77ED\u671F\uFF1D\u65E5\u3005\u306E\u682A\u4FA1\u306E\u5411\u304D\u3092\u8868\u3057\u307E\u3059\u3002")));
  }
  function App() {
    const { status, stocks: dataset, generatedAt, errorMessage } = useStockData();
    const [indexFilter, setIndexFilter] = useState("\u3059\u3079\u3066");
    const [sectorFilter, setSectorFilter] = useState("\u3059\u3079\u3066");
    const [sortKey, setSortKey] = useState("score");
    const [selected, setSelected] = useState(null);
    const listRef = React.useRef(null);
    const indexes = ["\u3059\u3079\u3066", "\u65E5\u7D4C225", "\u65E5\u7D4C\u30B0\u30ED\u30FC\u30B9"];
    const sectors = useMemo(() => {
      const filtered2 = indexFilter === "\u3059\u3079\u3066" ? dataset : dataset.filter((s) => s.index === indexFilter);
      return ["\u3059\u3079\u3066", ...Array.from(new Set(filtered2.map((s) => s.sector)))];
    }, [dataset, indexFilter]);
    const buyList = useMemo(
      () => dataset.filter((s) => s.signal.verdict === "\u8CB7\u3044\u6642"),
      [dataset]
    );
    const filtered = useMemo(() => {
      let list = dataset;
      if (indexFilter !== "\u3059\u3079\u3066") list = list.filter((s) => s.index === indexFilter);
      if (sectorFilter !== "\u3059\u3079\u3066") list = list.filter((s) => s.sector === sectorFilter);
      list = [...list].sort((a, b) => {
        if (sortKey === "score") return b.signal.score - a.signal.score;
        if (sortKey === "dividend") return b.dividendYield - a.dividendYield;
        if (sortKey === "price") return b.latestPrice - a.latestPrice;
        return 0;
      });
      return list;
    }, [dataset, indexFilter, sectorFilter, sortKey]);
    if (status === "loading") {
      return /* @__PURE__ */ React.createElement("div", { className: "app" }, /* @__PURE__ */ React.createElement("style", null, STYLES), /* @__PURE__ */ React.createElement("div", { className: "state-screen" }, /* @__PURE__ */ React.createElement("div", { className: "state-screen__spinner" }), /* @__PURE__ */ React.createElement("p", null, "\u682A\u4FA1\u30C7\u30FC\u30BF\u3092\u8AAD\u307F\u8FBC\u3093\u3067\u3044\u307E\u3059\u2026")));
    }
    if (status === "error") {
      return /* @__PURE__ */ React.createElement("div", { className: "app" }, /* @__PURE__ */ React.createElement("style", null, STYLES), /* @__PURE__ */ React.createElement("div", { className: "state-screen" }, /* @__PURE__ */ React.createElement("p", { className: "state-screen__error-title" }, "\u30C7\u30FC\u30BF\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F"), /* @__PURE__ */ React.createElement("p", { className: "state-screen__error-detail" }, errorMessage), /* @__PURE__ */ React.createElement("p", { className: "state-screen__error-hint" }, "API\u30B5\u30FC\u30D0\u30FC\u304C\u8D77\u52D5\u4E2D\uFF08Render\u306E\u7121\u6599\u30D7\u30E9\u30F3\u306F\u30B9\u30EA\u30FC\u30D7\u5FA9\u5E30\u306B30\u79D2\u307B\u3069\u304B\u304B\u308B\u3053\u3068\u304C\u3042\u308A\u307E\u3059\uFF09\u304B\u3001 URL\u8A2D\u5B9A\u3092\u3054\u78BA\u8A8D\u304F\u3060\u3055\u3044\u3002")));
    }
    return /* @__PURE__ */ React.createElement("div", { className: "app" }, /* @__PURE__ */ React.createElement("style", null, STYLES), /* @__PURE__ */ React.createElement("header", { className: "app-header" }, /* @__PURE__ */ React.createElement("div", { className: "app-header__title" }, /* @__PURE__ */ React.createElement("span", { className: "app-header__mark" }, "\u682A"), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h1", null, "\u682A\u4FA1\u5206\u6790\u304F\u3093"), /* @__PURE__ */ React.createElement("p", null, "\u65E5\u7D4C\u9298\u67C4\u306E\u914D\u5F53\u3068\u5E95\u5024\u30BF\u30A4\u30DF\u30F3\u30B0\u3092\u6BCE\u65E5\u30C1\u30A7\u30C3\u30AF")))), /* @__PURE__ */ React.createElement(GranvilleExplainerSample, null), /* @__PURE__ */ React.createElement(
      AlertBanner,
      {
        buyList,
        onJump: () => listRef.current?.scrollIntoView({ behavior: "smooth" })
      }
    ), /* @__PURE__ */ React.createElement("div", { className: "filter-bar" }, /* @__PURE__ */ React.createElement("div", { className: "filter-group" }, /* @__PURE__ */ React.createElement("span", { className: "filter-group__label" }, "\u5E02\u5834"), /* @__PURE__ */ React.createElement("div", { className: "chip-row" }, indexes.map((idx) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: idx,
        className: `chip ${indexFilter === idx ? "chip--active" : ""}`,
        onClick: () => {
          setIndexFilter(idx);
          setSectorFilter("\u3059\u3079\u3066");
        }
      },
      idx
    )))), /* @__PURE__ */ React.createElement("div", { className: "filter-group" }, /* @__PURE__ */ React.createElement("span", { className: "filter-group__label" }, "\u30BB\u30AF\u30BF\u30FC"), /* @__PURE__ */ React.createElement("div", { className: "chip-row chip-row--wrap" }, sectors.map((sec) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: sec,
        className: `chip chip--sm ${sectorFilter === sec ? "chip--active" : ""}`,
        onClick: () => setSectorFilter(sec)
      },
      sec
    )))), /* @__PURE__ */ React.createElement("div", { className: "filter-group" }, /* @__PURE__ */ React.createElement("span", { className: "filter-group__label" }, "\u4E26\u3073\u66FF\u3048"), /* @__PURE__ */ React.createElement("div", { className: "chip-row" }, /* @__PURE__ */ React.createElement(
      "button",
      {
        className: `chip chip--sm ${sortKey === "score" ? "chip--active" : ""}`,
        onClick: () => setSortKey("score")
      },
      "\u304A\u3059\u3059\u3081\u5EA6"
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: `chip chip--sm ${sortKey === "dividend" ? "chip--active" : ""}`,
        onClick: () => setSortKey("dividend")
      },
      "\u914D\u5F53\u5229\u56DE\u308A"
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: `chip chip--sm ${sortKey === "price" ? "chip--active" : ""}`,
        onClick: () => setSortKey("price")
      },
      "\u682A\u4FA1"
    )))), /* @__PURE__ */ React.createElement("main", { className: "stock-grid", ref: listRef }, filtered.map((s) => /* @__PURE__ */ React.createElement(StockCard, { key: s.code, stock: s, onOpen: setSelected })), filtered.length === 0 && /* @__PURE__ */ React.createElement("p", { className: "empty-state" }, "\u8A72\u5F53\u3059\u308B\u9298\u67C4\u304C\u3042\u308A\u307E\u305B\u3093\u3002")), /* @__PURE__ */ React.createElement("footer", { className: "app-footer" }, /* @__PURE__ */ React.createElement("p", null, "\u6700\u7D42\u66F4\u65B0: ", generatedAt ? formatDateFull(generatedAt) : "\u53D6\u5F97\u4E2D", "\uFF08\u5E73\u65E5\u306ETSE\u5F15\u3051\u5F8C\u306B\u81EA\u52D5\u66F4\u65B0\u3055\u308C\u307E\u3059\uFF09")), /* @__PURE__ */ React.createElement(DetailModal, { stock: selected, onClose: () => setSelected(null) }));
  }
  var STYLES = `
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

.explainer__patterns {
  margin-top: 4px;
  border-top: 1px solid var(--card-border);
  padding-top: 12px;
}

.explainer__patterns-summary {
  cursor: pointer;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--teal);
  list-style: none;
}

.explainer__patterns-summary::-webkit-details-marker {
  display: none;
}

.explainer__patterns-summary::before {
  content: "\u25B6 ";
  font-size: 10px;
}

.explainer__patterns[open] .explainer__patterns-summary::before {
  content: "\u25BC ";
}

.explainer__patterns-block {
  margin-top: 12px;
}

.explainer__patterns-block-title {
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 6px;
}

.explainer__patterns-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.explainer__patterns-table th {
  text-align: left;
  color: var(--text-dim);
  font-weight: 600;
  padding: 4px 6px;
  border-bottom: 1px solid var(--card-border);
}

.explainer__patterns-table td {
  padding: 5px 6px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  color: var(--text);
}

.explainer__patterns-table td:nth-child(1),
.explainer__patterns-table td:nth-child(2),
.explainer__patterns-table td:nth-child(3) {
  text-align: center;
  font-family: "JetBrains Mono", monospace;
  width: 28px;
  color: var(--text-dim);
}

.explainer__patterns-note {
  font-size: 10px;
  color: var(--text-dim);
  margin: 10px 0 0;
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
  var root = ReactDOM.createRoot(document.getElementById("root"));
  root.render(React.createElement(App));
})();
