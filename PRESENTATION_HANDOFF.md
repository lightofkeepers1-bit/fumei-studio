# Fumei Studio — 教授簡報 Handoff

**用途**：給下一個 session 拿來做正式場合演講等級的簡報。內容**普通人看得懂**，同時**展現系統的技術強度**，目標是讓人覺得「這個系統也太厲害了」。

**最後更新**：2026-05-05
**Live**：https://www.fumei-studio.com/
**Repo**：lightofkeepers1-bit/fumei-studio
**當前版本**：v5.35.0

---

## 1. 一句話講完這是什麼

Fumei Studio 是**給台灣社群創作者用的 AI 梗圖產文系統**。從「今天要發什麼話題」、「腳本怎麼寫」、「梗圖怎麼配」一路到「直接發到 FB 粉專」，一條龍包辦。

換成日常比喻：以前你要開 Google 找話題、ChatGPT 寫文、Midjourney 做圖、Meta Business Suite 發文——4 個工具切來切去。Fumei Studio 把這四件事整合成一個視窗、一條按鈕串起來，而且**懂台灣語境**（PTT 板、台灣時事、台灣口吻）。

---

## 2. 為什麼這個系統值得做（痛點）

| 現況 | Fumei Studio 解法 |
|---|---|
| 經營粉專每天要在 4 個工具切換 | SPA 整合所有流程 |
| 國外 AI 不懂台灣（節日、用詞、PTT 文化） | Gemini Pro + Google Search 搜台灣時事 + 7 大 PTT 板熱門 |
| AI 寫的文章長一樣（沒角色感） | 使用者設「角色」，三個 AI 都依角色語氣寫 |
| 創作工具與發文工具分離 | 一鍵橋接 Meta Graph API（Phase A 已 ship） |
| 工具碎片：複製貼上累積失誤 | 一個 SPA、一個帳號、一份點數 |

---

## 3. 系統架構（普通人 + 技術人都看得懂）

### 給普通人看（建築物比喻）

- **大廳**（前端 SPA）：使用者看到的整個網頁，像一棟大樓的大廳，所有功能都從這裡進去
- **櫃台**（Vercel Serverless API）：使用者按按鈕，後端臨時開個小窗口處理一次（用完關閉、不佔資源）
- **保險箱**（Firestore）：點數、角色設定、歷史紀錄都存在這
- **三個 AI 助理**：Claude（資深寫手）、GPT（多元意見）、Gemini（即時搜尋專家）—— 各擅長一塊，需要哪種找哪個
- **後台**（Admin Panel）：Admin 看得到的另一扇門，連到 Meta（FB）的 API，可以一鍵發文

### 給技術人看（Stack）

```
┌─ Frontend ─────────────────────────────────────┐
│ Vanilla JS SPA, ~9000+ 行 / 940 KB single file │
│ Firebase Auth (Google SSO)                     │
│ localStorage 同源橋接 (主站 ↔ admin 後台)      │
└─────────────────────────────────────────────────┘
            ↓ HTTPS + Bearer ID Token
┌─ Backend (Vercel Serverless) ──────────────────┐
│ Hobby tier 12 functions 上限 (constraint)       │
│ /api/claude  /api/gemini  /api/gpt              │
│ /api/image (KIE API)  /api/news (Google News)   │
│ /api/redeem  /api/checkin  /api/adjust         │
│ /api/daily-bonus (Cron 16:00)                   │
└─────────────────────────────────────────────────┘
            ↓ Firebase Admin SDK
┌─ Firestore ────────────────────────────────────┐
│ users/{uid}     ← 帳號資料 / 點數 / 歷史        │
│ guest_credits/  ← 訪客點數 (per fingerprint)    │
│ fb_user_pages/  ← Admin FB Page tokens          │
│ fb_posts/       ← FB 發文紀錄 (composite index) │
│ deleted_users/  ← 帳號刪除黑名單                │
└─────────────────────────────────────────────────┘
            ↓ Meta Graph API
┌─ External Services ────────────────────────────┐
│ Meta Graph (4 個粉專)                           │
│ KIE API (生圖, nano-banana 模型)                │
│ Anthropic / OpenAI / Google Generative AI      │
└─────────────────────────────────────────────────┘
```

### 核心架構選擇（值得在簡報講）

1. **Single-file SPA, no framework** — `index.html` 9000+ 行 vanilla JS。Bundle 簡單、deploy 快、debugging 不需 React DevTools。代價：大檔案 navigation 略費神。
2. **Multi-LLM Orchestration** — 不是「一個 AI 搞定全部」，而是 Claude Sonnet 創意 / Claude Haiku 整理 / GPT 多元視角 / Gemini Pro 搜尋。**模型分工像微服務**。
3. **Two-Stage Generation** — 先讓 AI 找話題＋3 個發文方向（Stage 1，便宜），User 選方向後才產完整腳本（Stage 2）。**節省 token、提升 user agency**。
4. **Serverless Credits with Atomic Transactions** — 兌換碼/簽到/邀請/購買/退款全部走 Firestore transaction，避免 race condition 雙花。
5. **Admin Bridge via localStorage** — 主站 ↔ admin 後台同源橋接，0 後端改動、0 一般 user 影響、admin gate 4 行 code 控制。

---

## 4. Live Features（已上線）

| 功能 | 描述 | 技術重點 |
|---|---|---|
| **三 AI 發想** | 同時跑 Claude/GPT/Gemini 比較三家視角 | 並行 fetch + Gemini Pro+Search 處理即時話題 |
| **今天發什麼** | 自動搜當日台灣時事 + 給 1 話題 + 3 方向 | Stage 1+2 + 7 天話題 blacklist 避免重複 |
| **多風格範例**（本 session ship） | 同話題給 6 個不同 vibe（感性/厭世幽默/打氣/觀察/短句/晚安）的範例 | Claude Haiku tool_use 結構化輸出 |
| **角色語氣化** | User 設「角色」，AI 全部跟著扮演 | character prompt 注入到 system prompt |
| **AI 一鍵生圖** | KIE API + 進度查詢 + 參考圖上傳 | rate limit (uid-key, 30/min) + KIE poll |
| **點數系統** | 兌換碼/簽到/邀請/購買/退款 + 雲端同步 | Firestore transaction + higher-wins race fix |
| **PTT/News 話題掃描** | 7 大 PTT 板 + Google News RSS 36hr 過濾 | bigram 去重 + 每日 blacklist |
| **Admin FB 一鍵發文**（Phase A） | 主站產文 → 點按鈕 → 後台 textarea 自動填 → 發 4 粉專 | localStorage 同源橋接 + Meta Graph API |
| **歷史紀錄** | 50 筆腳本 + 雲端同步多裝置 | 失敗紀錄保留（user 要求：扣了點就要存） |

---

## 5. 工程亮點故事（演講用）

### 故事 1 — Vercel Hobby 12 函式上限的優雅解法

加 5 個 FB endpoints → deploy 直接 ERROR：「超出 hobby tier 12 函式上限」。
- ❌ 升 Pro tier 一年 $240
- ✅ **5 個 endpoints 合進現有 `adjust.js` 改用 sub-action dispatch**

```js
// /api/adjust.js
if (action === 'fb_pages')      return handleFbPages(...);
if (action === 'fb_post')       return handleFbPost(...);
if (action === 'fb_history')    return handleFbHistory(...);
if (action === 'fb_disconnect') return handleFbDisconnect(...);
if (action === 'fb_setup_pages')return handleFbSetupPages(...);
```

**教訓**：constraint-driven design 反而帶出更乾淨的架構。

---

### 故事 2 — FB Bridge Debug Saga（5 個 commit 才修好的故事）

目標：Admin 在「✍️ 產腳本」tab 點「📢 用 Fumei 發」按鈕 → 新分頁開 admin 後台 → 自動把腳本內容填到發文 textarea。

| Commit | 改動 | 結果 |
|---|---|---|
| 1 | `<a href="/admin" target="_blank">` 用 native anchor | Preview 上原 tab 跳回首頁 |
| 2 | 加 `e.stopPropagation()` 擋 capture phase | 沒解 — capture phase 在 stop 之前就跑了 |
| 3 | 改 `window.open()` + `preventDefault()` 完全 JS 控制 | Preview popup 被擋 |
| 4 | merge prod 試 (preview vercel-live widget 干擾排除) | Click 完全沒反應 — root cause: 父層 `pointer-events:none` 繼承到 anchor |
| 5 | anchor 加 `pointer-events:auto` | Click fire 了，但**跳回首頁**還在 |
| 6 | 5 秒抑制 flag — `_suppressAuthCallbackUI` | ✅ 解了 |

**最終 Root Cause**：開新分頁時，admin.html init Firebase Auth → 跨 tab IndexedDB 同步 → 主站 tab 收到 `onAuthStateChanged` 兩次 callback (transient logout + re-login) → 主站邏輯：「登入成功跳回首頁」被誤觸發。

**教訓**：
- 多個獨立 root cause 疊加（vercel widget + pointer-events + 跨 tab Auth），要逐層剝除
- Browser 跨 tab Firebase Auth 同步是隱形的 — 沒人會在登入 callback 想到「另一個分頁」
- 5 秒 time window suppression 是最便宜可靠的解法

---

### 故事 3 — 多 LLM 角色分工

**問題**：直接叫 Claude Sonnet 用 tool_use 產結構化 JSON → 它會自己「優化」內容、改寫 user 原本的話、加禁止清單外的延伸。

**解法**：拆兩段
- **Stage 1（Sonnet, temperature=1.0）**：完全自由發想，保角色語氣
- **Stage 2（Haiku, temperature=0.2, tool_use）**：純格式化，把 Stage 1 文字塞進 JSON 欄位，**不改字**

System prompt for Stage 2:
> 你是純粹的資料格式化工具。你會收到一段已經寫好的梗圖發想文字，你唯一的工作是不改動內容、不重寫、不改風格，只把它拆解成結構化欄位填入。

**教訓**：LLM 像微服務 — 職責單一才不會走鐘。

---

### 故事 4 — 跨裝置簽到 Bug

**症狀**：手機簽到後，電腦 F5 每次都跳簽到 modal，但點下去「已簽到」。
**根因**：Server 寫 `fumei_checkin_last`，client 讀 `fumei_checkin_date` — **欄位名稱對不上**。
**修法**：對齊 + fallback 舊欄位防歷史資料誤判。
**教訓**：跨裝置 race + 命名不對齊是 distributed system 經典坑。

---

## 6. 數字（簡報用）

| 指標 | 數值 |
|---|---|
| Single-file SPA size | ~9000+ 行 / 940 KB |
| API endpoints | 12 (Vercel hobby 上限) |
| LLM models 整合 | 5 種（Claude Sonnet/Haiku, GPT-4o-mini, Gemini Pro+Search, Gemini Flash） |
| Firestore collections | 6 (users, guest_credits, fb_user_pages, fb_posts, deleted_users, blacklist) |
| Live since | 2026-04 末（4 月底禮拜一） |
| 本 session commits | 8 個（5.33.0 → 5.35.0） |
| 連線 FB 粉專 | 4 個（已 admin 試發 OK） |
| Bug 修復速度 | FB Bridge debug 6 commits 內找到並解決三層獨立 root cause |

---

## 7. Roadmap（簡報結尾用）

```
Phase A ✅ Admin-only 主站↔後台橋接          ← 本 session 完成 prod
Phase B 🟡 Admin 後台整合進主站 (規劃中)
Phase C 🔴 Meta App Review + OAuth 多用戶開放 (1-3 月)
Phase D 🔴 IG Business 整合
Phase E 🔴 Cron 自動排程發文 + AI 自選話題（Pro 訂閱核心）
```

---

## 8. 為什麼這系統「太厲害了」（演講收尾）

1. **個人專案做出企業級整合** — Auth + Serverless + 多 LLM + 第三方 API + 後台 + 點數系統 + 雲端同步，全套
2. **在免費 tier 跑 production traffic** — Vercel Hobby + Firebase Spark，零月費、可規模
3. **Real-world 痛點切入** — 台灣創作者跨工具切換 + 國外 AI 語境隔閡，產品定位明確
4. **已 live 不只是 demo** — 有 admin 真實發過貼文（Fumei 今天也很美粉專）
5. **Roadmap 不是 PPT 願景** — Phase A 已 ship、Phase E 願景明確（Pro 訂閱經濟模型）
6. **工程深度** — Stage 1+2 token-saving 設計、跨 tab Auth 修法、constraint-driven function 合併、跨裝置同步——任何一條都是面試 talking point

---

## 9. 簡報架構建議（給下個 session）

**15 分鐘版本**：
1. (1 min) Hook — 一張圖：四個工具切到一個 SPA
2. (2 min) 痛點 — 台灣創作者的日常
3. (3 min) Solution Overview — 三個 AI 助理 + 一鍵發文 demo screencap
4. (4 min) 技術架構 — 一張 stack 圖 + 三個關鍵 design choice
5. (3 min) 工程亮點故事 — 挑 1-2 個（推薦：FB Bridge 5 commit saga + 多 LLM 角色分工）
6. (1 min) Roadmap + Phase E 訂閱願景
7. (1 min) Q&A buffer

**5 分鐘 pitch 版本**：
1. 一句話 + 痛點（30s）
2. Live demo（2 min）— 從話題到發文一條龍
3. 一張架構圖 + 數字（1 min）
4. Roadmap 跟訂閱模式（1 min）
5. 收尾（30s）

---

## 10. Demo 動線（簡報實機操作）

1. 訪客體驗：丟「訪客體驗」進首頁 → 角色設定 → 三 AI 發想 → 看到 3 家 AI 不同切入
2. 登入版：「今天發什麼」搜 5 月 5 日台灣熱門話題 → 看到 1 話題 + 3 方向 + **6 風格範例（本 session ship）**
3. 選方向 → 產完整腳本 → 一鍵生圖 → 圖文整合
4. Admin 模式：點「📢 發到 FB 粉專」→ 新分頁開後台 → textarea 已自動填 → 發 4 粉專

---

## 11. 給下個 session 的指示

- 這份 doc 已包含全部 context，不需要再讀其他 HANDOFF.md
- 把上面內容整成 PowerPoint / Google Slides / Keynote 都行，使用者要正式場合演講等級
- 視覺風格建議：粉色系（match 產品）+ 大量截圖 + 系統架構圖
- 一定要有 live demo（不要全文字）
- 教授背景應該有技術，但簡報不要過度 jargon — 雙軌（普通人比喻 + 技術細節）

---

**Repo URL**：https://github.com/lightofkeepers1-bit/fumei-studio
**Live URL**：https://www.fumei-studio.com/
**版本**：v5.35.0（2026-05-05）
