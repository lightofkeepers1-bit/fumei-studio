# Fumei Studio — Handoff 狀態盤點

**最後更新**：2026-04-23
**當前版本**：`APP_VERSION = '5.26.1'`（live + origin/main 一致）
**上線日**：2026 年 4 月底（禮拜一）
**Session 紀錄原則**：每次改動都要把進度寫進這份 HANDOFF（使用者要求）

---

## 📅 Session 改動紀錄

### 2026-04-23 — v5.20.1 → v5.26.1（16 commits）

**🪙 點數結構系列**
- `03a3d58` 第一輪簡化（除三AI發想都 1 點）→ 發現賠本回滾
- `66ff83b` 話題掃描點數 revert 回原狀（PTT ⚡3、時事 ⚡2、其他 ⚡1）
- `9072378` 時事反應從話題掃描帶入 → ⚡1（因話題已搜尋過）
- `481f928` 改判定規則：**話題有內容 = 1 點，空白 = 2 點**（不管來源）
- `ea5cc65` 今天發什麼回歸 ⚡2（永遠要跑 Sonnet 兩段）
- `9ea0801` 改寫按鈕：扣 ⚡1 點 + Sonnet → Haiku + UI 加 ⚡1 badge
  - 修掉「改寫免費但 Sonnet 燒錢連點 6 次淨虧 NT$4+」的漏洞

**🎨 UX 小改進系列**
- `134de83` 今天發什麼：話題框有內容時，以該主題為聚焦方向發想
- `3d96715` 話題框有內容時，自動隱藏「時事反應」選項（避免 UX 混亂）
- `d6593ae` 話題框加 ✕ 清除按鈕（有內容才顯示）
- `7735aa6` 方向卡殘留問題：按新產腳本自動收起 + ✕ 手動關閉
- `4a9c65c` 修 F5 版本號先顯示 v5.16.5 殘影（HTML hardcoded fallback 拿掉）
- `a4447ba` F5 強制捲回頁首（關掉瀏覽器 scroll restoration）

**🔍 話題掃描強化**
- `e8ffe8f` 加每日 blacklist（localStorage 按日期+分類記 30 個）+ 不足 6 題自動補齊
- `f9da43d` 角色切換 safeguard：切到不同角色時清掉掃描結果 + toast 提示

**💬 Modal 體驗**
- `c1d422e` 方向卡二次確認 + genScript loadTxt 殘留文字 bug 修
- `22acc78` 二次確認改用 custom modal（粉色風格、ESC/Enter 支援、backdrop blur）
  - `window.showConfirmModal()` 通用函式，之後其他確認場景都可用

### 最終點數規則（v5.26.1）
| 功能 | 點數 |
|---|---|
| 話題掃描・職場/日常 | ⚡1 |
| 話題掃描・今日時事 | ⚡2 |
| 話題掃描・PTT 熱門 | ⚡3 |
| 產腳本・時事反應 + 話題空白（要搜尋）| ⚡2 |
| 產腳本・時事反應 + 話題有內容 | ⚡1 |
| 產腳本・今天發什麼（兩階段各扣 1 點）| ⚡1 + ⚡1 |
| 產腳本・一般類型（職場/日常等）| ⚡1 |
| 改寫按鈕（6 種）| 各 ⚡1 |
| 三AI發想 | ⚡2 |
| 生圖 一般品質 | ⚡3 |
| 生圖 高品質 Pro | ⚡8 |

---

## ✅ 已完成（全部實測驗證過）

### 1. 點數系統全面 serverless 化
| 端點 | 狀態 | 實測 |
|---|---|---|
| `/api/redeem`（兌換碼） | ✅ Live | 401 / token 驗證正常 |
| `/api/checkin`（每日簽到） | ✅ Live | 401 / token 驗證正常 |
| `/api/adjust`（退點 + 邀請獎勵） | ✅ Live | 401 / token 驗證正常 |
| `/api/daily-bonus`（每日 cron） | ✅ Live | 401（Vercel cron 會帶 header） |
| `/api/guest-check`（訪客 + version 查詢） | ✅ Live | 200 JSON |

### 2. Firebase Admin SDK 整合
- `api/_lib/admin.js` 共享 init + ID token 驗證
- `package.json` 有 `firebase-admin: ^12.7.0`
- Vercel env var `FIREBASE_SERVICE_ACCOUNT` **已設定**（API 能驗 token = 證明）
- **Admin Private Key 已輪替**（使用者確認：產新 key + 更新 Vercel + 刪舊 key）

### 3. Firestore Rules 部署
- `firestore.rules` 檔已部署到 Firebase Console
- 實測 2 種違規寫入都 `403 PERMISSION_DENIED`：
  - 寫 `guest_credits` credits=1000（規則限 ≤20）→ 擋
  - 未認證讀 `/users/{uid}` → 擋

### 4. Pre-launch 安全批（commit `50a814f`）
- XSS escape
- CORS allowlist
- 錯誤上拋（不再 silent swallow）
- cron secret 從 hardcode 移除（`91e6608`）

### 5. UX / 品質批
- checkin modal 卡 disabled bug 修（`b1c0c92`）
- 點 logo 回首頁 + 移除 URL hash（`7545170`，使用者偏好乾淨網址）
- 今天發什麼 Step 1 prompt 簡化 + version badge（`bf4c83e`）
- 話題 hook 改具體句子避免「XX 型」模板（`fa6ad9e`）

### 6. 靜態頁 / SEO
- `/terms`、`/privacy`、`/payment-success` 都 200 OK
- `/sitemap.xml`、`/robots.txt` 都 200 OK
- `og-image.png` 已設

---

## ⚠️ 尚未完成 / 潛在問題

### A. 🟢 Dev 分支落後 main（5 commits）— **不用管**
**現況**：`origin/dev` 比 `origin/main` 少 5 個 commit
**使用者決定**（2026-04-22）：「目前還沒上線公布，任何改動都直接 main」→ dev 分支暫時不啟用
**什麼時候要處理**：正式上線公布後、要啟動 dev → main 測試流程時，再 `git checkout dev && git merge main && git push` 同步即可
**優先級**：🟢 低（延後到正式公布日再處理）

### B. 🔴 `api/checkout.js` Idempotency 漏洞（ECPay 開通前必修）
**位置**：`api/checkout.js:108-125`（notify 回呼處理）
**問題**：收到 ECPay 付款成功通知後，直接 `current + plan.points` 加點，**沒檢查 `fumei_purchase_${MerchantTradeNo}` 是否已存在**
**風險**：ECPay 會 retry webhook（5 次以上），同筆訂單可能重複加點 N 倍
**修法**：
```js
// line 111 後面加：
if (data?.[`fumei_purchase_${MerchantTradeNo}`]) {
  console.log('[checkout] 已處理過，跳過');
  return res.status(200).send('1|OK');
}
```
**優先級**：🔴 高（但僅在 ECPay 開通後生效，現在還沒串）

### C. 🟡 `TotalAmount` 驗證（防禦深度）
**位置**：`api/checkout.js` notify 處理
**現況**：只驗 `CheckMacValue`（涵蓋所有欄位，理論上 TotalAmount 竄改就會驗不過）
**建議加**：明確比對 `body.TotalAmount === String(PLANS[planKey].amount)`，多一層保險
**優先級**：🟡 低（CheckMacValue 已擋住 99% 情境，純 defence-in-depth）

### D. 🟢 `CRON_SECRET` env var（選做）
**現況**：`api/daily-bonus.js` 支援兩種觸發：
- Vercel 排程（header `x-vercel-cron: 1`）→ 不需 CRON_SECRET
- 手動 curl 觸發 → 需要 `Bearer ${CRON_SECRET}`
**影響**：若只靠排程，完全不用設。若想手動測 cron 要設。
**優先級**：🟢 低

### E. 🟢 產腳本品質（few-shot 範例）
使用者之前討論過但**暫未要求**，上線後視使用者反饋再做。

---

## 📊 Live 狀態健康檢查（最後實測 2026-04-22，v5.26.1 僅 app-layer 變動不影響 endpoint）

```
https://www.fumei-studio.com/                  → 200 (content-length 940527)
https://www.fumei-studio.com/terms             → 200
https://www.fumei-studio.com/privacy           → 200
https://www.fumei-studio.com/payment-success   → 200
https://www.fumei-studio.com/sitemap.xml       → 200
https://www.fumei-studio.com/robots.txt        → 200
https://www.fumei-studio.com/api/redeem        → 401 (auth working)
https://www.fumei-studio.com/api/checkin       → 401 (auth working)
https://www.fumei-studio.com/api/adjust        → 401 (auth working)
https://www.fumei-studio.com/api/daily-bonus   → 401 (auth working)
https://www.fumei-studio.com/api/guest-check   → 200 JSON
https://www.fumei-studio.com/api/checkout      → 405 (POST required)
APP_VERSION                                     → 5.26.1
Firestore rules                                 → 已部署（403 PERMISSION_DENIED 驗證）
Vercel FIREBASE_SERVICE_ACCOUNT env var        → 已設定
Firebase Admin key                             → 已輪替
```

---

## 🎯 上線前還要做的事（排優先）

- [ ] **無**（上線日已可直接上線。B/C 是 ECPay 開通後才要修）

## 🎯 正式公布後待辦

- [ ] Dev 分支同步回 main（A，正式公布啟動測試流程時才需要）
- [ ] ECPay 開通時：先修 checkout.js idempotency（B）+ TotalAmount 驗證（C）
- [ ] 視使用者反饋決定：產腳本品質提升（E）

## 📌 當前分支規則（2026-04-22）

**直接推 main，不走 dev**。
使用者明示：「目前還沒上線公布，所以任何改動都直接 main 就好了」。
正式公布後才會改成 dev → preview → main 的測試流程。

---

## 📁 Repo 結構

```
C:\Users\TingYihChang\Downloads\fumei-studio-repo\
├── index.html                 # SPA 主體 (~9000 lines, 940KB)
├── api/
│   ├── _lib/admin.js          # Firebase Admin SDK 共享 init
│   ├── redeem.js              # 兌換碼 serverless
│   ├── checkin.js             # 每日簽到 serverless
│   ├── adjust.js              # 退點 + 邀請獎勵 serverless
│   ├── daily-bonus.js         # 每日 cron (Vercel scheduled)
│   ├── checkout.js            # ECPay 付款（⚠️ idempotency 漏洞）
│   ├── guest-check.js         # 訪客點數 + version 查詢
│   ├── claude.js / gpt.js / gemini.js  # LLM proxy
│   ├── image.js               # 圖片生成
│   ├── news.js                # Google News RSS
│   └── ptt.js                 # PTT 看板抓取
├── firestore.rules            # 已部署到 Firebase Console
├── vercel.json                # cleanUrls + daily cron 排程
├── package.json
├── terms.html / privacy.html / payment-success.html
├── sitemap.xml / robots.txt / og-image.png
└── images/
```
