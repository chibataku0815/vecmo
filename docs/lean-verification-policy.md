# Lean Verification Policy

このドキュメントは、**per-step で full gate を回す ceremony を置き換える**検証規律の正本です。
ただし `AGENTS.md` の testing opt-in が最優先であり、ユーザーが現在の task で明示的に
testing を依頼した場合だけ、この文書の test / test-like verification 手順を有効化します。
依頼がない場合は実行せず、省略した検証を報告します。kickoff ブリーフ・
`docs/codex-parallel-worktree-prompts.md`・`docs/parallel-status.md` は詳細 cadence が必要な
ときにこの文書を参照します。

このポリシーは検証の**頻度（cadence）と集中先（concentration）**を最適化するものであり、**static gate も architectural invariant も削除しません**（末尾 [不変条件](#不変条件削除しないもの) 参照）。

> このポリシーのコマンドはすべて**実測検証済み**（このリポジトリの checkout で再実行して確認）。worktree 汚染・`tsc --noEmit` の buildinfo 挙動・ゲート順序の load-bearing 性は推測ではなく観測に基づく。

---

## なぜ lean 化するのか（根拠）

実際にこのリポジトリで起きた文書破損リスクの欠陥は、**すべて adversarial review か seam/math reasoning で検出され、green の unit suite では一件も捕まらなかった**:

| 欠陥 | 場所 | 検出手段 | unit test が捕えなかった理由 |
| --- | --- | --- | --- |
| txn-teardown / 中断ジェスチャの cross-feature undo 破損 (f60667a) | host pointer pipeline（bezier 本体は無改変） | adversarial review | pointercancel/lostpointercapture/tool-switch で開きっぱなしの transaction は runtime 挙動。tsc/check:arch には構造的に不可視。どのテストも teardown を踏まない |
| autokey が isPlaying でゲートされない (6a30b32 に畳み込み) | transport subscription gate（overlay.tsx）。pure な `collectAutoKeyCommands` ではない | adversarial review | 修正は subscription gate にあり pure 関数にない。auto-keyframe/transport-store/subscription を import するテストが存在しない |
| `transformFromMatrix` の anchor≠0 逆変換不正 | FROZEN rendering.ts（dormant・anchor 編集解禁前に要修正） | seam/math reasoning | writer/renderer seam の数学推論で発覚。covering test なし |

一方、唯一 static gate が捕えた欠陥（Biome の `.gitignore` 不具合）は **tooling/hygiene** の問題で、文書破損リスクではない。これは「ゲートは無力」ではなく**分業の証拠** — static gate は tooling を、adversarial review/seam reasoning は文書破損ロジックを捕える。

結論: per-step の full-gate ceremony は、suite が実証的に捕えなかったバグを追って時間を溶かす。代わりに **(1) review/reasoning を文書破損 surface に集中させ、(2) unit test を pure な分岐ロジックに集中させ、(3) ゲートは merge 境界で 1 回だけ回す**。

> pure-logic テストは**bug detector ではなく silent regression guard**。matrix/bezier/sampler/easing/command-bus round-trip が緑であることは「無音の劣化が起きていない」ことを保証する。だからテストは価値があるが、新規バグの検出は review が担う。

---

## 3-Tier モデル

### Tier 1 — Inner loop（コーディング中・編集ごと）

**目的: 速い per-edit フィードバック。full gate は回さない。**

long-lived な watch プロセスを常駐させ、編集した module だけを scoped に回す:

| 用途 | コマンド | 備考 |
| --- | --- | --- |
| typecheck watch（UI/feature 編集） | `tsc -p tsconfig.app.json --noEmit --watch` | include=`src` のみ。worker に触れない。最速 |
| typecheck watch（worker/cross-layer 編集） | `tsc -b --watch` | 3 project refs 全て。worker や層跨ぎの型を触る時 |
| test watch（編集 module を scoped） | `bunx vitest --dir src/<layer>/<name>` | ディレクトリ単位。最も明示的 |
| 単発 scoped test | `bunx vitest run --dir src/<layer>/<name>` | テスト無しディレクトリは exit 1。緑にしたいなら `--passWithNoTests` |
| 単一ファイル test | `bunx vitest run <file>.test.ts` | `--dir` はファイル粒度を持たない。`vitest.config` の exclude で worktree は除外済み |
| scoped lint（任意） | `bunx biome check src/<layer>/<name>` / `bunx oxlint src/<layer>/<name>` | 数 ms。parallel-safe |

**やってはいけないこと:**
- **per-commit の full `bun run check` / `bun run build` を回さない**（それは merge gate の仕事）。
- **`--tsBuildInfoFile` フラグに inner-loop の増分性を期待しない** — 増分性は watch プロセスから得る。TS7 移行後もこの方針は、単発 `--noEmit` のフラグ運用ではなく常駐 watch にフィードバックを集中させるためのもの。
- **per-step の browser smoke を回さない**（[browser smoke](#browser-smoke-は-milestone-レベル) 参照）。

> **vitest の scoping は `vitest.config.ts` で修正済み。** かつてポジショナル形 `vitest run src/features/<name>` は `.claude/worktrees/*` 配下の同名ファイルにも substring マッチして暴走した（vitest は `.gitignore` を尊重しない／実測で 5 files・100 tests）。**この change で `vitest.config.ts` の `exclude` に `'**/.claude/**'` を追加**したため、ポジショナル形も `bun run test` も正しく repo 内に scope される。明示性のため inner loop では `--dir` 形を推奨する。

### Tier 2 — Merge gate（stream landing ごと・1 回）

**目的: これが本当のバー。merge 境界で 1 回だけ全部を回す。**

順序は load-bearing（`check:bundle` は dist/ が無いと exit 1）:

```
1. git rebase main
2. bun run check          # = biome check . && oxlint . && bun run check:arch && bun run check:tokens && bun run check:product-knowledge && bun run check:public-english && tsc -b（一体で扱う／分解しない）
3. bun run test           # = vitest run。vitest.config の exclude で worktree 非汚染（実測 12 files）
4. FROZEN 契約 diff（entities/scene types+store, entities/motion types, registry.ts HandlerApi/ToolHandler, selection+viewport stores の差分確認）
5. bun run build          # = tsc -b && vite build
6. bun run check:bundle   # dist/ の manifest を読む → 必ず build の後
7. merge（fast-forward 優先）
```

> **`bun run check` は一体で扱う。** サブコマンドを再列挙して `check:arch`（import 方向の構造不変条件 **+ command-bus 規律 + tool ownership**、後述）、`check:tokens`、`check:product-knowledge`、`check:public-english` を落とさないこと。

#### parallel safety

`tsc -b` と `bun run build` は worktree ごとに独自の `node_modules` と `dist/` を持つため、worktree 間で並列に走らせてもファイル破損リスクは無い（コストは CPU/IO 競合のみ）。ただし**同一 checkout 内**で一発の `tsc -b` と `tsc -b --watch` を同時に走らせない（buildinfo を共有するため）。汚染するのは歴史的に vitest だけ（config で修正済み）。lint/typecheck の scoped コマンドは元から current checkout 内に留まる。

### Tier 3 — Risk-weighted review（変更 surface に応じた review 深度）

**目的: adversarial review を文書破損 surface に集中させる。**

**最初に問う（surface 表より優先）:** *その変更は、document store（`useSceneStore`/`useMotionStore`）の transaction を開く・command bus 経由でドキュメント状態を書く・あるいは host の pointer/transaction lifecycle に触れるか?* — **YES なら import-additive かどうかに関係なく full adversarial review。** txn-teardown 欠陥は「import 的には additive な bezier」が host の teardown と相互作用して生まれた。additive-by-imports は transaction を開く feature を light pass に格下げ**しない**。

| 変更 surface | review 深度 |
| --- | --- |
| **FROZEN 契約**（entities/scene types+store, entities/motion types, registry.ts HandlerApi/ToolHandler, selection+viewport stores） | **full multi-agent adversarial review** + FROZEN diff |
| **host pipeline**（pointer lifecycle, transaction teardown, tool-switch / onDeactivate） | **full adversarial review**（txn-teardown 欠陥はここ） |
| **writer**（applyNodeTransform）・**undo/redo / command-bus**（apply/undo/redo, transaction, coalesce）・**rendering 逆変換**（rendering.ts の matrix↔transform seam） | **full adversarial review**（transformFromMatrix anchor 欠陥はここ） |
| **transport / subscription gate**（再生中の autokey など pure 関数の外でゲートされる挙動）・**document store の transaction を開く任意の feature** | **full adversarial review**（autokey 欠陥はここ） |
| `features/<name>/` で **feature import なし・FROZEN 不変・command bus/transaction surface に触れない** もの | **merge gate + light review 1 pass** |
| **docs / prompt / comment only** | readback / grep のみ。runtime test 不要 |

> **正直な但し書き:** 現状の authoring feature（transform / draw / bezier / motion）は**すべて** document transaction を開くため、全部 full review に入る。light pass の母集団は **viewport・guides・display-only パネル・docs** など document を書かない非変異 feature に限られる。**lean policy の速度効果は cadence（inner loop vs per-step）と test 集中から来る**のであって、review-weighting から来るのではない。review-weighting は「軽くする」より「重い review を本当に必要な surface に外さず当てる」ための装置。

---

## Test where bugs occur（テストの集中先）

### 集中する（high-ROI / inner-loop と merge gate の vitest ターゲット）

pure で分岐の多いロジックのみ:

- **geometry / matrix**: bezier hit-test、matrix round-trip、逆変換 fallback、anchor 挿入の subdivision identity（`src/features/bezier/model/geometry.test.ts`）
- **keyframe sampling / easing / interpolation**: linear/easeIn/easeOut/HOLD、endpoint clamp、topology-match vs mismatch のシェイプ補間、`unitBezierY` 単調性（`src/entities/motion/model/sampler.test.ts`, `easing.test.ts`, `src/shared/glammer/keyframe-track.test.ts`）
- **playback 数学**: `advanceFrame` の elapsed×fps、backgrounded tab の delta clamp、非ループ停止、ループ range-wrap（`src/entities/motion/model/playback.test.ts`）
- **command-bus round-trip**: Immer-patch undo/redo、transaction の 1 履歴への coalesce、同フレーム coalescing、plain-object 維持（draft proto leak なし）。scene と motion 両ストア（`src/entities/scene/model/store.test.ts`, `src/entities/motion/model/commands.test.ts`）
- **interaction-reducer**: pointer シーケンス → state（click-select / marquee / drag-move coalesce / Escape clear）（`src/features/selection/canvas/handler.test.ts` 等の handler test）
- **spatial predicate**: visible/unlocked selectable、locked 除外、marquee の layer 順

### 避ける（low-ROI / brittle・signal なし）

| カテゴリ | 理由 |
| --- | --- |
| React コンポーネント render テスト | 実装詳細に脆く、文書破損を捕えない（jsdom も未設定） |
| trivial な zustand setter/getter テスト | 値を入れて取り出すだけ。バグを捕えない |
| 構造 snapshot（`Object.keys` 等） | additive な変更で壊れる anti-additive。signal ゼロ（例: `registry.test.ts` → 型レベルチェック or FROZEN surface への grep に置換候補） |
| 定数の inline snapshot | frozen 定数の正当な変更で壊れる（例: `types.test.ts` → 退役候補） |
| golden-master snapshot | seed は元々変わる前提の hardcoded doc（例: `seed-scene.test.ts` → 削除 or topology を変える serialization round-trip に書き換え候補） |

> **raw な test count をバーにしない。** 「36 tests」「63 tests」のような絶対数は品質の指標ではない（test 数 ≠ 品質）。指標は集中先（上記カテゴリ）と round-trip/invariant の covering。

---

## Browser smoke は milestone レベル

browser smoke は**per-step ではなく milestone レベルの手動チェック**。merge gate ではプロダクト判断により廃止済み（`docs/parallel-status.md`: 静的ゲート + 敵対的レビュー + FROZEN diff が merge bar）。

milestone（機能群が動く段階）で一度、手動で:
artboard 表示 / panel toggle / timeline toggle / tool active / 選択更新（click + marquee）/ inspector 同期 / zoom out/in/fit / drag move-resize-rotate / undo-redo / locked-hidden。

stream チャットでは原則 `bun dev` / browser smoke / screenshot を行わない。例外は「対象 stream の問題がブラウザでしか切り分けられない」場合のみ。

---

## 機械化された guardrail（review に依存しない不変条件）

review は人が見落とせる。lean policy が additive feature の review を軽くする以上、**文書破損の二大経路は静的に強制する**。両方とも `scripts/check-architecture.ts`（`bun run check:arch` → `bun run check`）に組み込み済みで、merge gate で必ず走る（per-step ceremony ゼロ）:

1. **command-bus 規律**: 非 test の `src/features/**` で `useSceneStore`/`useMotionStore` を `setState(...)` / `getState().document = ...` で直接書く（command bus を迂回する）と fail。document store のみを identity で対象にするため、UI store（`useTransportStore.setFrame` 等）の setState は対象外。「単一 writer」を convention から machine-checked invariant に昇格させる。
2. **tool ownership（1 ToolId = 1 handler）**: `src/features/*/canvas/handler.ts` の `tool: "..."` 値登録を集計し、同一 ToolId を 2 つ以上の handler が登録すると fail。host は `handlers.find(h => h.tool === activeTool)` で**最初の一致だけ**を拾うため、二重登録は dead code + overlay 二重描画になる（transform/selection 衝突がまさにこれ。このチェックがあれば自動検出できた）。

> 既知の限界（許容）: どちらも literal な書き方を前提とする静的チェック。store の alias 経由（`const s = useSceneStore; s.setState(...)`）や tool を変数で登録する（`tool: SELECT_TOOL`）形は捕えない。完全な静的解析は目的ではなく、**現実的な経路**（直接 setState・literal な tool 二重登録）を外さないことが目的。alias 等の異常な書き方は review で見る。

---

## 不変条件（削除しないもの）

このポリシーは cadence と concentration を refine するもので、以下は**そのまま維持**:

- **static gate**: `bun run check`（biome + oxlint + check:arch + tsc -b）は merge gate で必ず回る。
- **production gate**: `bun run build`（tsc -b && vite build）+ `bun run check:bundle`。
- **architectural invariant**:
  - 単一 transform writer（`applyNodeTransform`）— geometry 変更は必ずここを経由（**command-bus 規律チェックで強制**）。
  - Immer-patch command-bus（`useSceneStore` apply/undo/redo + transaction/coalesce）。
  - FROZEN 契約 surface（entities/scene types+store, entities/motion types, registry.ts HandlerApi/ToolHandler, selection+viewport stores）— additive 以外の編集禁止、必要なら orchestrator にエスカレーション。
  - Feature-Sliced の下方向 import のみ・feature→feature 禁止（check:arch が強制）。
  - 1 ToolId = 1 handler（**tool ownership チェックで強制**）。

lean policy は「何を・いつ・どれだけ深く検証するか」を変えるだけで、これらの土台は崩さない。
