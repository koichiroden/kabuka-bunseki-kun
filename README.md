# 株価分析くん

日経225・日経グロースの主要銘柄について、配当利回りと長期トレンド（30/60/120/180/365日）、
株価曲線の底値（極小値）を毎日自動で分析するツールです。

## 全体構成

```
kabuka-bunseki-kun/
├── backend/
│   ├── stocks.py           # 銘柄マスタ（コード・セクター・市場区分）
│   ├── analysis.py         # トレンド判定・底値検出ロジック
│   ├── fetch_data.py       # yfinanceでデータ取得→分析→JSON生成
│   ├── app.py              # Flask API（生成済みJSONを配信するだけ）
│   ├── requirements.txt
│   └── data/stocks.json    # 自動生成される（初回はまだ無い）
├── frontend/
│   └── StockAnalyzerApp.jsx  # React製フロントエンド（Claudeのアーティファクトと同じもの）
├── .github/workflows/update_data.yml  # 平日15:40 JSTに自動でデータ更新
└── render.yaml              # Renderへのデプロイ設定
```

## セットアップ手順

### 1. GitHubリポジトリを作る

1. GitHubで新規リポジトリを作成（例: `kabuka-bunseki-kun`）
2. このフォルダ一式をpushする

```bash
cd kabuka-bunseki-kun
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/あなたのユーザー名/kabuka-bunseki-kun.git
git push -u origin main
```

### 2. GitHub Actionsでデータを生成する

pushすると `.github/workflows/update_data.yml` が登録されますが、
まだ一度もデータが無い状態なので、手動で1回実行します。

1. GitHubのリポジトリページ → 「Actions」タブ
2. 左側の「株価データ更新」ワークフローを選択
3. 右側の「Run workflow」ボタンを押す
4. 数分待つと `backend/data/stocks.json` がコミットされます

以降は平日15:40 JST（東証の引け後）に自動で実行されます。

### 3. Renderにバックエンドをデプロイする

1. [Render](https://render.com) にサインアップ（GitHubアカウントでログイン可能）
2. 「New +」→「Blueprint」を選択
3. さきほどのGitHubリポジトリを連携する
4. `render.yaml` の設定が自動で読み込まれ、`kabuka-bunseki-kun-api` というWebサービスが作成される
5. デプロイ完了後、発行されたURL（例: `https://kabuka-bunseki-kun-api.onrender.com`）をコピー

> 無料プランは15分間アクセスが無いとスリープします。次回アクセス時に
> 起動するまで30秒ほどかかることがありますが、動作上の問題はありません。

### 4. フロントエンドをRenderに静的サイトとしてデプロイする

Claudeのアーティファクト（プレビュー機能）は、セキュリティ上の理由で
外部API（RenderのバックエンドAPIなど）への通信がブロックされることがあります。
そのため、フロントエンドも本物のWebページとしてRenderにデプロイし、
スマホから直接そのURLを開く方式にしています。

`frontend/index.html` は、ビルド不要（Babel Standaloneでブラウザ内変換）の
1ファイル完結型のページです。すでに `API_BASE_URL` に
バックエンドのURLが設定済みなので、そのままデプロイできます。

1. Renderのダッシュボードに戻り、「New +」→「Blueprint」を選択
2. 同じGitHubリポジトリを選ぶ（`render.yaml` が更新されているので自動検知されます）
3. `kabuka-bunseki-kun-frontend` という Static Site が追加候補として表示されるので、
   内容を確認して「Apply」

デプロイが終わると、`https://kabuka-bunseki-kun-frontend-xxxx.onrender.com` のような
URLが発行されます。これをスマホのブラウザで開き、「ホーム画面に追加」しておけば、
アプリのように使えます。

> バックエンドのURLを変更した場合は、`frontend/index.html` 内の
> `const API_BASE_URL = "..."` を書き換えてから再度pushしてください。
> `autoDeploy: true` なので、pushするだけで自動的に再デプロイされます。

### 5. 動作確認

- ブラウザで `https://あなたのAPI/api/health` を開き、
  `"dataExists": true` になっていればデータ取得は成功しています。
- `https://あなたのAPI/api/stocks` を開くと、生データ（JSON）が見られます。
- `https://あなたのフロントエンドURL` を開き、実際の銘柄カードが表示されれば成功です。

## フロントエンドのコードを更新したとき

`frontend/app.bundle.js` を更新して差し替えたときは、`frontend/index.html` の
`<script src="app.bundle.js?v=3"></script>` の `v=3` の数字を必ず1つ増やしてください
（`v=4`, `v=5`...）。これを忘れると、ブラウザやRenderのCDNが古いバージョンの
`app.bundle.js` をキャッシュしたままになり、変更が反映されないことがあります。

## 銘柄の追加・削除

`backend/stocks.py` の `STOCKS` リストを編集してください。
コードは4桁の証券コード（東証）を指定します。

## 判定ロジックを調整したい場合

`backend/analysis.py` の `compute_signal()` 内のスコア加減点を編集してください。
フロントエンド側は分析結果をそのまま表示するだけなので、
判定基準を変えたい場合はこのファイルだけ直せば反映されます。

底値（極小値）の判定は、生の終値ではなく **30日移動平均線** に対して行っています
（`simple_moving_average()` → `detect_local_minimum()`）。日々の細かい値動き
（ノイズ）による誤検知を減らすためです。移動平均の日数を変えたい場合は
`analysis.py` 冒頭の `SMA_WINDOW = 30` を書き換えてください。

## グランビルの法則による買い時/売り時判定

`analysis.py` の `classify_granville()` で、90日移動平均線（長期）・
30日移動平均線（中期）・日々の株価（短期/日次）それぞれの向き
（上昇/横ばい/下降）の組み合わせから、買い時/売り時を判定しています。

- 判定テーブル（`GRANVILLE_TABLE`）は、3方向×3方向×3方向＝27通りの
  組み合わせのうち、あらかじめ指定された15通りだけを定義したものです。
  残り12通りの組み合わせについては、「上昇・下降のシグナル数が多い方」で
  多数決するフォールバック処理を実装しています（同数の場合は様子見）。
  この部分は判定表に明示されていない組み合わせを補うための拡張なので、
  挙動を変えたい場合は `GRANVILLE_TABLE` に該当の組み合わせを追記して
  上書きしてください。
- 各トレンドの「上昇/横ばい/下降」は、`trend_direction()` が
  「直近の値」と「N営業日前の値」を比較して判定しています
  （長期=10営業日前、中期=5営業日前、短期/日次=2営業日前と比較）。
  この比較日数や、横ばいとみなす変化率のしきい値（デフォルト0.5%、
  日次のみ0.3%）は `compute_signal()` 内で調整できます。
- フロントエンドでは、グラフ右端（最新日）の点が緑なら「買い時」、
  赤なら「売り時」のシグナルとして表示されます。

## 今後の拡張候補

- メール通知（買い時銘柄が見つかったら `fetch_data.py` の最後にSMTP送信処理を追加）
- 銘柄数を増やす場合は `REQUEST_INTERVAL_SEC` を調整してyfinanceのレート制限を回避
- 配当利回りの取得元をより正確なものに変更したい場合は、
  `fetch_data.py` の `dividend_yield` 計算部分を調整
