# Vercel へのデプロイ手順

## 全体の形

```
ブラウザ                     Vercel
─────────                    ────────────────────────────────
index.html          ──┐
briefing.html         │  静的ファイル（そのまま配信）
interview.html        │
dashboard.html      ──┘
assets/css, assets/js

         │ fetch('/api/chat')
         ▼
                        api/chat.js        ┐
                        api/interview.js   │ サーバーレス関数（Node.js）
                        api/health.js      │ ANTHROPIC_API_KEY はここだけが持つ
                        api/_claude.js     ┘
                                 │
                                 ▼
                        api.anthropic.com
```

**APIキーはブラウザに一切渡らない。** 環境変数からサーバー側だけが読む。

ナレッジ（`assets/js/knowledge.js`）と面接設問（`assets/js/interview-data.js`）は、
ブラウザとサーバーの**両方から同じファイルを読んでいる**。
末尾に `module.exports` の分岐を置いてあり、ブラウザでは実行されない。
定義が2箇所に分かれて片方だけ古くなる、という事故を防ぐため。

---

## 手順

### 1. リポジトリを Vercel に接続

1. [vercel.com/new](https://vercel.com/new) を開く
2. GitHub の `Saiko-Seiko/faq-ai` を選ぶ
3. Framework Preset は **Other**（自動検出のままでよい）
4. Build Command / Output Directory は**空のまま**
   （ビルド不要。ルート直下の HTML をそのまま配信する）

### 2. 環境変数を設定

Project Settings → Environment Variables

| Name | Value | 対象 |
|---|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Production / Preview / Development |

> この変数が未設定でもサイトは動く。その場合はライブモードが選べなくなり、
> **デモモードのみ**になる（画面にもその旨が出る）。

設定後は **Redeploy** が必要（環境変数は既存のデプロイに遡って反映されない）。

### 3. 動作確認

デプロイ後のURLで、順に確認する。

- [ ] `/` — トップが表示される
- [ ] `/api/health` — `{"ok":true,"configured":true,...}` が返る
      （`configured:false` なら環境変数が未反映。Redeploy する）
- [ ] `/briefing` — 右上が「デモモード」。チャットが答える
- [ ] 右上のボタン → **ライブモード**を選べる（選べない場合は上の health を確認）
- [ ] ライブモードで質問 → 回答が返る
- [ ] `/interview?token=demo-tanaka` — 面接が最後まで進む
- [ ] `/dashboard` — 候補者が並び、合否ボタンが押せる
- [ ] `/_selftest.html` — 48項目すべて OK になる

`cleanUrls` を有効にしているので、URLは `.html` なしで届く
（`/briefing`、`/interview?token=...`）。`.html` 付きでも自動で転送される。

---

## 手元で動かす

### ビルド無しで見るだけ

`index.html` をブラウザで直接開く。デモモードで全画面が動く。
（`/api` が無いのでライブモードは選べない）

### サーバー側も含めて動かす

```bash
npm install -g vercel
npm install
vercel dev
```

`vercel dev` は `.env.local` を読む。手元で試すときは：

```
ANTHROPIC_API_KEY=sk-ant-...
```

`.env*` は `.gitignore` 済み。**キーをコミットしないこと。**

---

## 料金について

- **静的配信とデモモード** … Anthropic への通信が発生しないので、API料金は0円
- **ライブモード** … 1リクエストごとに従量課金

費用を抑えるための作りにしてある点：

- 会社説明会のチャットは `effort: 'low'`（資料を引くだけなので深く考えさせない）
- ナレッジを含むシステムプロンプトに**プロンプトキャッシュ**を効かせている
  （毎回同じ内容なので、2回目以降は入力側の費用と待ち時間が下がる）
- 面接の評価だけ `effort: 'high'`（人の選考に関わるため、ここは精度を優先）

クライアントに費用感を聞かれたら、想定の月間問い合わせ件数を伺ってから見積もる。

---

## 公開範囲についての注意

このデモは**誰でもURLを知っていれば見られる**状態になる。

- 検索避けとして `X-Robots-Tag: noindex, nofollow` を全ページに付けている
- 登場する会社・候補者はすべて架空なので、個人情報の流出は起きない
- ただし**ライブモードは誰でも使えてしまう**（＝API料金が発生する）

商談用に短期間出すだけなら現状で問題ないが、長く公開する場合は次のどちらかを検討する。

1. Vercel の **Deployment Protection**（Vercel Authentication）を有効にする
2. `ANTHROPIC_API_KEY` を外し、デモモードのみで公開する

---

## 本番導入で追加になるもの

デモに入っていない、見積もりの対象。

1. データベース（面接記録の保存先。いまは閲覧者のブラウザ内のみ）
2. 候補者URLの発行（認証・期限・使い切り）とメール送信
3. 人事ダッシュボードのログイン認証と操作ログ
4. ナレッジを人事の方が更新できる画面
5. 動画の配信（いまはプレースホルダー）
6. 個人情報の保存期間・削除方針と、応募者への同意取得の文面
