# COIN+ ストアマップ

京都市・大阪市・茨木市・高槻市にある**COIN+利用可能店舗**を、検索・ジャンル・地図から探せるスマートフォン対応Webアプリです。店舗データは公式のCOIN+店舗検索を基にしたスナップショットを利用し、地図表示、現在地のエリア判定、Google Mapsへの遷移を提供します。[1]

> **対象データの基準日：2026-08-18**。掲載内容は更新タイミングにより公式情報と差異が生じる可能性があるため、利用前に公式ページでもご確認ください。

## 主な機能

| 機能 | 内容 |
|---|---|
| キーワード検索 | 店舗名・住所・ジャンルでリアルタイムに検索します。 |
| エリア・ジャンル絞り込み | 京都市・大阪市・茨木市・高槻市を選択でき、7つのジャンルを複数選択できます。 |
| ジャンル別件数 | 現在のエリア・キーワード条件に合う店舗数をジャンルボタンに表示します。 |
| 現在地連動 | 現在地を地図に表示し、対象地域内では市区の絞り込みを自動選択します。 |
| 地図ピン | 検索結果の先頭100件をジャンル別の色で表示します。近接するピンはクラスタに集約されます。 |
| 地図範囲連動 | 地図を動かすと、表示範囲内の店舗だけが一覧に表示されます。 |
| 店舗詳細 | ピンの吹き出しと詳細モーダルから、住所・ジャンルを確認できます。 |
| Google Maps連携 | 店舗の地図検索、または現在地からの徒歩経路をGoogle Mapsで開けます。 |

## データとキャッシュ

店舗データ本体は、バージョン付きJSONとして外部静的ストレージから配信します。アプリ起動時には小さな更新マニフェストだけを確認し、同一バージョンではブラウザの**Cache Storage**に保存済みの店舗JSONを再利用します。そのため、通常の再訪時に全店舗JSONを再取得しません。

| 項目 | 現在の構成 |
|---|---|
| 更新情報 | `client/public/store-data-manifest.json` |
| 店舗データ | マニフェストの`datasetPath`が指すバージョン付きJSON |
| 端末キャッシュ | `coinplus-store-dataset-v1`（Cache Storage） |
| localStorage | 小さな更新マニフェストのみを保存 |
| 詳細な更新手順 | [`data_update_guide.md`](./data_update_guide.md) |

## 技術構成

| 分類 | 使用技術 |
|---|---|
| UI | React 19、TypeScript、Tailwind CSS 4 |
| ビルド | Vite 7 |
| 地図 | Google Maps JavaScript API |
| 地図クラスタリング | `@googlemaps/markerclusterer` |
| アイコン | Lucide React |
| パッケージ管理 | pnpm |

## ローカル起動

Node.jsとpnpmを用意した後、以下のコマンドで依存関係を導入して開発サーバーを起動します。

```bash
pnpm install
pnpm dev
```

開発サーバーの起動後、ターミナルに表示されるローカルURLをブラウザで開いてください。型検査および本番ビルドは、次のコマンドで実行できます。

| コマンド | 用途 |
|---|---|
| `pnpm dev` | 開発サーバーを起動します。 |
| `pnpm check` | TypeScriptの型検査を実行します。 |
| `pnpm build` | 本番用のフロントエンドとサーバーバンドルを作成します。 |
| `pnpm start` | ビルド済みアプリを起動します。 |

## プロジェクト構成

```text
client/
  public/
    store-data-manifest.json  # 店舗JSONのバージョン情報
  src/
    pages/Home.tsx            # 検索、店舗一覧、地図、ピンの主な実装
    components/Map.tsx        # Google Mapsの初期化
data_update_guide.md          # 店舗JSONの更新・キャッシュ運用手順
map_pin_verification_notes.md # 地図ピン機能の確認記録
```

## 店舗データの更新

新しい店舗データを反映する際は、新しいファイル名のJSONを外部静的ストレージへ登録し、`store-data-manifest.json`の`version`、`updatedAt`、`datasetPath`、`sourceSnapshot`を更新します。アプリは変更された`datasetPath`を検出すると新JSONを一度だけ取得し、古い店舗データのキャッシュを削除します。詳細は[`data_update_guide.md`](./data_update_guide.md)を参照してください。

## 留意事項

本アプリはCOIN+の公式アプリではありません。店舗情報の正確性・最新性は、必ず[公式のCOIN+店舗検索ページ][1]で確認してください。Google Mapsを本プロジェクトの実行環境以外で利用する場合は、別途Google Maps JavaScript APIの認証設定が必要になることがあります。[2]

## License

MIT

## References

[1]: https://coinplus.jp/storesearch/all.html?region=%E9%96%A2%E8%A5%BF "COIN+ 店舗検索（関西）"
[2]: https://developers.google.com/maps/documentation/javascript "Google Maps JavaScript API documentation"
