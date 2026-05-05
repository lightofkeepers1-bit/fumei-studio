# Next-session 入口 — Fumei Studio (post 2026-05-05 session)

我 Ting-Yih Chang。專案 `C:\Users\TingYihChang\Downloads\for COde\fumei-studio`（GitHub `lightofkeepers1-bit/fumei-studio`，Vercel project `prj_E5KR7TSrbDrTqbSfuyDQXLOF05ir` team `team_XQN059pVh3vdCsa08gHx2gtn`）。

> **Concision rule**：本 doc ≤ 100 行。Standing rules 已在 memory（`MEMORY.md`），不重述。HANDOFF.md ≤50 行/entry，老 entries archive。

---

## ⭐ 0. 下 session 主軸（看你選）

### 路線 A — 做教授看的簡報（user 已要求）
**直接讀 `PRESENTATION_HANDOFF.md`**（在 repo 根目錄）。那份 doc 全 context 自包含，不用再 dig 其他 HANDOFF。
- 用途：正式場合演講等級 PPT/Slides
- 風格：普通人 + 技術人都看得懂，目標讓人覺得「這系統太厲害了」
- 結構建議在 doc 第 9 章（15 min / 5 min 兩個版本）
- 視覺：粉色系 match 產品 + 大量截圖 + 一張架構圖 + live demo

### 路線 B — 繼續開發
讀本 doc + HANDOFF.md (~line 12-50 today's entry)（5 min），然後問 user 走哪條：
| Item | 內容 | 預估 |
|---|---|---|
| **Phase B** | admin.html 整合進 index.html admin 區塊（內嵌 panel） | 半天 |
| **Phase C 前置** | Meta App Review 材料：Data Deletion endpoint + 示範影片腳本 | 1-2 hr |
| **HANDOFF archive** | 2026-04-23 / 2026-05-04 老 entries 搬到 HANDOFF_archive.md | 30 min |
| **ADMIN_UIDS env var** | 提醒 user 去 Vercel + Firebase Console 設 admin uid（生圖 30/min bypass） | 5 min |

---

## 1. Live 狀態（last verified 2026-05-05）

**Prod (`main 4eb20e7`)** — APP_VERSION 5.35.0
- https://www.fumei-studio.com → 200
- /admin → admin only (ADMIN_EMAILS env var = `lightofkeepers1@gmail.com`)
- 4 粉專 token 在 `fb_user_pages/{admin_uid}` Firestore
- Composite index `fb_posts (user_uid↑, posted_at↓)` 已建
- 生圖 rate limit 30/min（admin via ADMIN_UIDS env var bypass，env var 還沒設）

**本 session 已 ship 改動**（v5.33.0 → v5.35.0）：
1. ✅ Phase A admin bridge merge prod (eb5973a)
2. ✅ Bridge「跳回首頁」修法 5 commits 找到 3 層 root cause（看 PRESENTATION_HANDOFF.md 故事 2）
3. ✅ 「換別的話題 ⚡1」按鈕（Stage 1 結果區重抽不同話題）
4. ✅ 「多風格範例 ⚡1」按鈕（同話題 6 個不同 vibe：感性/厭世/打氣/觀察/短句/晚安）
5. ✅ 生圖 rate limit 10→30/min + ADMIN_UIDS bypass

---

## 2. 重要 file references

| 檔 | 用途 |
|---|---|
| `PRESENTATION_HANDOFF.md` | **教授簡報用 handoff（本 session 新建）** |
| `index.html` | SPA 主體 (~9000+ lines, 940KB) |
| `index.html:6657-6691` | sendScriptToFb / openFbAdminBridge bridge 函式 |
| `index.html:5836-5847` | regenerateTodayTopic（換別的話題） |
| `index.html:5849-6002` | showMultiStyleExamples（多風格範例） |
| `index.html:1632-1640` | onAuthStateChanged + `_suppressAuthCallbackUI` 抑制窗口 |
| `index.html:2741-2749` | 「換別的話題」+「多風格範例」按鈕 HTML |
| `admin.html` | FB 發文後台（~600 lines, Firebase Auth gate） |
| `api/adjust.js:201-369` | 5 個 fb sub-actions + admin gate |
| `api/_lib/fb.js` | Meta Graph API helper |
| `api/image.js:24+131-140` | rate limit 30/min + ADMIN_UIDS bypass |
| `fb-poster/pages.json` | 4 page tokens（gitignored，60 天有效，本機絕對路徑） |

---

## 3. 禁區（標準 fumei-studio rules）

- ❌ 直接動 prod main（除非 user 明示）— 預設走 feature branch + preview
- ❌ 修 git config（user.email/name 用 `git -c user.email=...` 一次性 inline）
- ❌ commit pages.json / .env / FB token 到 repo（gitignored 但檢查）
- ❌ 改原本 user-facing 流程（一般 user UI 必須跟前一版一樣，admin gate 是底線）
- ❌ 砍 admin gate 4 行（Phase 2 多用戶要等 Meta App Review 通過）
- ❌ 跳 Vercel hobby 12 functions 上限（5 個 fb endpoints 已合進 adjust.js）
- ✅ 改動前 git checkout -b feat/xxx 開分支（user 偏好直接 main 也可，看狀況）
- ✅ Test on preview 後才 merge prod
- ✅ Rollback：`git reset --hard prod-stable-pre-bridge` 或 Vercel UI promote 舊 deployment
- ✅ Live 後第一件事：問 user 看效果再做下一步

---

## 4. Meta / FB 相關狀態

- **Dev account** (2026-05-04 切): `lightofkeepers2@hotmail.com`
- **Meta App ID**: `1522117856153893`
- **Meta App Secret**: `28116905dca208f6b7ef8d624bdc480d`
- **App 模式**: Development（未 App Review，只能 admin 自己用）
- **Token 60 天**：page token non-expiring 但 user token 60 天 → 屆時重跑 `python social_poster.py setup all`

---

## 5. 一條龍 Roadmap（已對齊）

```
Phase A ✅ admin only 主站<->後台橋接 (本 session 收尾 prod)
Phase B 🟡 admin.html 整合進 index.html (admin gate)
Phase C 🔴 Meta App Review + OAuth → 多用戶 + 點數扣費 (1-3 月)
Phase D 🔴 IG 整合
Phase E 🔴 Cron 自動排程發文 (Pro 訂閱核心)
```

---

讀完 → 問 user：「要做簡報 (路線 A 讀 PRESENTATION_HANDOFF.md) 還是繼續開發 (路線 B)？」
