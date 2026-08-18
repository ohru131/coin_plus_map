# 店舗データ更新の運用手順

## 配信構成

アプリは毎回 `/store-data-manifest.json` を確認し、そこに書かれた `datasetPath` のみを店舗データとして読み込む。店舗JSONはブラウザのCache Storageに、**データURL単位**で保存する。マニフェストの `datasetPath` が変わらない限り、端末に保存済みのJSONを再利用する。

## 更新方法

1. 公式COIN+の店舗データを収集して、新しい日付または内容ハッシュを含むファイル名でJSONを作成する。例: `coinplus-stores-20260901.json`。
2. JSONを `/home/ubuntu/webdev-static-assets/` に置き、Webアプリ用のストレージへ登録する。
3. `client/public/store-data-manifest.json` の `version`、`updatedAt`、`datasetPath`、`sourceSnapshot` を新しい値へ更新する。
4. アプリをビルドして確認する。新しい`datasetPath`を検知した端末では一度だけ新JSONを取得し、古いCache Storageの店舗JSONを削除する。

## 検証結果

2026-08-18にブラウザで確認したところ、`coinplus-store-dataset-v1` には `coinplus-stores-20260818_95baed87.json` が1件だけ保存され、localStorageには小さな更新マニフェストだけが保持されている。店舗データ本体はlocalStorageには保存しない。

同じバージョンのマニフェストでアプリを再訪した際、Performance Resource Timingには店舗JSONのネットワーク取得が記録されなかった。Cache Storageに保存済みのJSONが再利用されていることを確認した。

同じ再訪では `store-data-manifest.json` の転送量は497 bytes、本文は197 bytesだった。再訪時にはこの小さな更新情報だけを確認し、約3 MBの店舗JSONは再取得しない。
