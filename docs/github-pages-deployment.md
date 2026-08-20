# GitHub ActionsとGitHub Pagesの運用

このリポジトリには、品質検査用の`CI`と、手動デプロイ用の`Deploy GitHub Pages`という2つのワークフローが含まれます。CIは`main`へのpushとpull requestで型検査・本番ビルドを実行します。Pagesデプロイは、公式店舗データの更新タイミングを利用者が管理できるよう手動実行に限定しています。

## 初回設定

GitHub PagesはActionsワークフローで公開する方式を選択してください。GitHubの公式手順では、**Settings → Pages → Source → GitHub Actions**を選択します。[1]

このアプリの地図表示は**Leaflet + OpenStreetMap標準タイル**で構成しているため、Google Maps JavaScript APIキーおよび`VITE_GOOGLE_MAPS_API_KEY`のRepository secretは不要です。地図の帰属表示はLeafletコンポーネントに含めています。OpenStreetMapの利用時は、表示する地図上に著作権表示を残してください。[2]

## デプロイ手順

1. GitHubの**Actions**タブから**Deploy GitHub Pages**を選びます。
2. **Run workflow**を選択します。通常は`refresh_store_data`を有効にして、公式COIN+データから対象4地域の店舗JSONを生成します。
3. 完了後、ジョブ出力の`page_url`または**Settings → Pages**から公開URLを確認します。

デプロイ時、ワークフローは公式の店舗データを取得し、対象地域のみを抽出したバージョン付きJSONをPagesアーティファクトに含めます。マニフェストの`datasetPath`もPagesの相対パスに更新されるため、Manusのストレージプロキシには依存しません。初回に表示する店舗ピンの住所座標は、ブラウザから国土地理院の住所検索サービスで取得し、端末のローカルストレージへ再利用用に保存します。[3]

## ワークフロー一覧

| ファイル                             | 起動条件                               | 役割                                                                |
| ------------------------------------ | -------------------------------------- | ------------------------------------------------------------------- |
| `.github/workflows/ci.yml`           | `main`へのpush、pull request、手動実行 | `pnpm check`と`pnpm build`を実行します。                            |
| `.github/workflows/deploy-pages.yml` | 手動実行                               | 店舗データ生成、Pages向けビルド、アーティファクト公開を実行します。 |

GitHub Pagesのデプロイには、`pages: write`および`id-token: write`の権限、Pagesアーティファクトのアップロード、`deploy-pages`アクションが必要です。ワークフローはこれらの公式要件に沿って設定されています。[4]

## References

[1]: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site "GitHub Docs: Configuring a publishing source for your GitHub Pages site"
[2]: https://www.openstreetmap.org/copyright "OpenStreetMap Copyright and License"
[3]: https://maps.gsi.go.jp/help/termsofuse.html "地理院地図｜利用規約"
[4]: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages "GitHub Docs: Using custom workflows with GitHub Pages"
