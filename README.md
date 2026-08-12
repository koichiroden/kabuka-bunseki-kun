# 株価分析くん(これで動いた)

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

### 4. フロントエンドのAPI URLを設定する

`frontend/StockAnalyzerApp.jsx` の冒頭にある以下の行を、
Renderで発行された実際のURLに書き換えてください。

```js
const API_BASE_URL = "https://YOUR-RENDER-APP.onrender.com";
```

書き換えたら、このファイルの中身をClaudeのアーティファクトとして
貼り付ければ、実データを表示するアプリとしてスマホからも使えます。

### 5. 動作確認

- ブラウザで `https://あなたのAPI/api/health` を開き、
  `"dataExists": true` になっていればデータ取得は成功しています。
- `https://あなたのAPI/api/stocks` を開くと、生データ（JSON）が見られます。

## 銘柄の追加・削除

`backend/stocks.py` の `STOCKS` リストを編集してください。
コードは4桁の証券コード（東証）を指定します。

## 判定ロジックを調整したい場合

`backend/analysis.py` の `compute_signal()` 内のスコア加減点を編集してください。
フロントエンド側は分析結果をそのまま表示するだけなので、
判定基準を変えたい場合はこのファイルだけ直せば反映されます。

## 今後の拡張候補

- メール通知（買い時銘柄が見つかったら `fetch_data.py` の最後にSMTP送信処理を追加）
- 銘柄数を増やす場合は `REQUEST_INTERVAL_SEC` を調整してyfinanceのレート制限を回避
- 配当利回りの取得元をより正確なものに変更したい場合は、
  `fetch_data.py` の `dividend_yield` 計算部分を調整
