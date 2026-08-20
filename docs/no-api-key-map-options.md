# APIキー不要の地図方式メモ

## OpenStreetMap標準タイル

OpenStreetMapの標準タイルはAPIキーを要求しないが、タイルサーバーは寄付で維持されており、可用性に保証はない。公開サイトで利用する場合は、可視の著作権表示、HTTPSの正しいタイルURL、通常のブラウザキャッシュ、HTTP Refererを保持することが必要である。大量取得、地図の事前読み込み、オフライン用ダウンロードは許可されない。通常の人による対話的な閲覧であれば許可例に含まれる。

ソース: https://operations.osmfoundation.org/policies/tiles/

## MapLibre GL JS

MapLibre GL JSは、ブラウザでベクタータイルを描画するオープンソースのTypeScript地図ライブラリであり、マーカー、ポップアップ、GeoJSON、クラスタリング、地図移動イベントを提供する。ライブラリ自体はAPIキーを必要としないが、利用するタイルまたはスタイル配信元の利用条件には従う必要がある。

ソース: https://www.maplibre.org/maplibre-gl-js/docs/

## 現プロジェクトへの示唆

GitHub PagesでAPIキーなしに公開するなら、Google MapsコンポーネントをMapLibre GL JSまたはLeafletへ置き換え、OpenStreetMap由来の地図タイルを使う構成が候補となる。現在のGoogle Mapsの住所ジオコーディングは外部API依存のため、全店舗の緯度経度を更新時に事前生成してJSONへ含める必要がある。
