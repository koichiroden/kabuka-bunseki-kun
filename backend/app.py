# -*- coding: utf-8 -*-
"""
株価分析くん - Flask API

役割は「fetch_data.pyが生成したJSONを配信するだけ」のシンプルなもの。
リアルタイムでyfinanceを叩くのはRenderの無料プランではレート制限や
スリープ復帰の影響で不安定なため、事前生成したJSONを返す構成にしている。

エンドポイント:
  GET /api/stocks       -> data/stocks.json の中身をそのまま返す
  GET /api/health       -> 生存確認・最終更新日時の確認用
"""

import json
from pathlib import Path

from flask import Flask, jsonify
from flask_cors import CORS

app = Flask(__name__)
# フロントエンドを別ドメイン(Vercel等)でホストする想定なのでCORSを許可
CORS(app)

DATA_PATH = Path(__file__).parent / "data" / "stocks.json"


@app.get("/api/stocks")
def get_stocks():
    if not DATA_PATH.exists():
        return jsonify({"error": "データがまだ生成されていません。GitHub Actionsの実行をお待ちください。"}), 503
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    return jsonify(data)


@app.get("/api/health")
def health():
    exists = DATA_PATH.exists()
    generated_at = None
    if exists:
        with open(DATA_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        generated_at = data.get("generatedAt")
    return jsonify({"status": "ok", "dataExists": exists, "generatedAt": generated_at})


if __name__ == "__main__":
    # ローカル開発用。本番はgunicornで起動する（render.yaml参照）
    app.run(host="0.0.0.0", port=5000, debug=True)
