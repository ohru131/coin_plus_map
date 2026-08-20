# GitHub ActionsとGitHub Pagesの運用

このリポジトリには、品質検査用の`CI`と、手動デプロイ用の`Deploy GitHub Pages`という2つのワークフローが含まれます。CIは`main`へのpushとpull requestで型検査・本番ビルドを実行します。Pagesデプロイは、店舗データと地図認証の公開条件を確認したうえで手動実行に限定しています。

## 初回設定

GitHub PagesはActionsワークフローで公開する方式を選択してください。GitHubの公式手順では、**Settings → Pages → Source → GitHub Actions**を選択します。[1]

次に、リポジトリの**Settings → Secrets and variables → Actions**で、以下のRepository secretを追加します。

| Secret名                   | 内容                                       | 注意事項                                                                                     |
| -------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `VITE_GOOGLE_MAPS_API_KEY` | Google Maps JavaScript API用のブラウザキー | GitHub PagesのURLをHTTPリファラーとして制限し、Maps JavaScript APIのみを有効化してください。 |

> GitHub Pagesは公開インターネット上で提供されます。外部公開用の地図キーは、HTTPリファラーとAPIで必ず制限してください。秘密鍵やサーバー用トークンをこのsecretへ設定してはいけません。[2]

## デプロイ手順

1. GitHubの**Actions**タブから**Deploy GitHub Pages**を選びます。
2. **Run workflow**を選択します。通常は`refresh_store_data`を有効にして、公式COIN+データから対象4地域の店舗JSONを生成します。
3. 完了後、ジョブ出力の`page_url`または**Settings → Pages**から公開URLを確認します。

デプロイ時、ワークフローは公式の店舗データを取得し、対象地域のみを抽出したバージョン付きJSONをPagesアーティファクトに含めます。マニフェストの`datasetPath`もPagesの相対パスに更新されるため、Manusのストレージプロキシには依存しません。

## ワークフロー一覧

| ファイル                             | 起動条件                               | 役割                                                                |
| ------------------------------------ | -------------------------------------- | ------------------------------------------------------------------- |
| `.github/workflows/ci.yml`           | `main`へのpush、pull request、手動実行 | `pnpm check`と`pnpm build`を実行します。                            |
| `.github/workflows/deploy-pages.yml` | 手動実行                               | 店舗データ生成、Pages向けビルド、アーティファクト公開を実行します。 |

GitHub Pagesのデプロイには、`pages: write`および`id-token: write`の権限、Pagesアーティファクトのアップロード、`deploy-pages`アクションが必要です。ワークフローはこれらの公式要件に沿って設定されています。[3]

## References

[1]: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site "GitHub Docs: Configuring a publishing source for your GitHub Pages site"
[2]: https://developers.google.com/maps/api-security-best-practices "Google Maps Platform: API Security Best Practices"
[3]: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages "GitHub Docs: Using custom workflows with GitHub Pages"
