# 店舗JSONのキャッシュ評価メモ

## 現在の配信状況（2026-08-18確認）

店舗データは `/manus-storage/coinplus-stores-20260818_95baed87.json` から取得している。配信先の応答は CloudFront へリダイレクトされ、JSON本体のサイズは **3,010,864 bytes（約3.0 MB）**。本体は `ETag` と `Last-Modified` を返し、`Cache-Control: max-age=31536000` が付与されている。一方、アプリのプロキシ応答には `Cache-Control: no-store` が付いている。

## 参照した公式資料

- [MDN: HTTP caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching)
  - HTTPキャッシュはレスポンスを再利用する。`ETag` / `If-None-Match` による検証では、未更新時にレスポンス本体を送らない `304 Not Modified` を返せる。
  - `no-store` は保存を禁止する。更新確認をしながらキャッシュを活用するなら `no-cache` と検証子の利用が適する。
- [MDN: Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API)
  - `localStorage` は同一オリジンに永続化されるが、読み書きが同期的で、大きなデータの操作はUIをブロックし得る。
- [MDN: IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
  - IndexedDBは大量の構造化データ向けで、操作が非同期。インデックスを使った検索もできる。

## 初期評価

約3 MBの全店舗JSONを `localStorage` に毎回文字列で保存・読み出しする方式は、同期処理によるメインスレッド負荷とブラウザ容量制約の点で推奨しない。更新確認には、バージョン付きメタデータJSONとHTTPキャッシュ再検証を使い、オフライン対応や全件ローカル保存が必要になった場合はIndexedDBを検討する。
