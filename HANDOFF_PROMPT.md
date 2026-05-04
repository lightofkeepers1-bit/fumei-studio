# Next-session 入口 — Fumei Studio (post 2026-05-04 session)

我 Ting-Yih Chang。專案 `C:\Users\TingYihChang\Downloads\for COde\fumei-studio`（GitHub `lightofkeepers1-bit/fumei-studio`，Vercel project `prj_E5KR7TSrbDrTqbSfuyDQXLOF05ir` team `team_XQN059pVh3vdCsa08gHx2gtn`）。

> **Concision rule**：本 doc ≤ 100 行。Standing rules 已在 memory（`MEMORY.md`），不重述。HANDOFF.md ≤50 行/entry，老 entries archive。

---

## ⭐ 0. 下 session 主軸 — **decide feat/fb-bridge merge + 順手處理生圖 rate limit**

上 session 收尾完三件事：
1. ✅ Admin FB 發文系統收尾上線（4 粉專 token 進 Firestore + composite index 建好 + 第一篇試發 Fumei 今天也很美 OK）
2. ✅ Phase A 主站<->後台橋接（commit `c78fd91` on branch `feat/fb-bridge`，preview 部署 + 測試 5/5 通過，**未 merge**）
3. ✅ 跟 user 對齊一條龍 Roadmap (Phase A→E)

**Next session 第一步（依序）**：
1. 讀本 doc + HANDOFF.md (~line 12-65 today's entry)（5 min）
2. 問 user：**feat/fb-bridge 要 merge main 嗎？要不要先順手處理生圖 rate limit？**
3. 等 user 決定再做事

---

## 1. 候選方向（依優先序）

| Item | 內容 | 預估 |
|---|---|---|
| **(a) merge feat/fb-bridge → main** ⭐ | `git checkout main && git merge feat/fb-bridge --no-ff && git push` → Vercel 自動 deploy ~1 min。Live 即生效 | 2 min |
| **(b) 生圖 rate limit 放寬** ⭐ | `api/image.js:24+131-135`。建議：admin bypass + 抬 30/min。User 反映「貼沒幾張圖就不能用」 | 5-10 行 patch |
| **(c) Phase B 起草** | admin.html 整合進 index.html admin 區塊（內嵌 panel）。需評估 bundle 影響 | 半天 |
| **(d) Meta App Review 材料準備** | Phase C 前置：Data Deletion endpoint + 示範影片腳本 + 使用案例書面說明 | 1-2 hr |
| **(e) HANDOFF 老 entry archive** | 2026-04-23 那段佔半個檔，move to `HANDOFF_archive.md` | 30 min |

---

## 2. Live 狀態（last verified 2026-05-04）

**Prod (`main e697b54`)**
- https://www.fumei-studio.com → 200 / APP_VERSION 5.33.0
- /admin → admin only (ADMIN_EMAILS env var = `lightofkeepers1@gmail.com`)
- 4 粉專 token 在 `fb_user_pages/{admin_uid}` Firestore
- Composite index `fb_posts (user_uid↑, posted_at↓)` 已建
- 第一篇試發過 Fumei 今天也很美

**Preview (`feat/fb-bridge c78fd91`)**
- https://fumei-studio-git-feat-fb-bridge-lightofkeepers1-bits-projects.vercel.app
- 主站 admin 看到「📢 用 Fumei 發」（任務列）+「📢 發到 FB 粉專」（腳本結果）
- localStorage `fumei_fb_draft` 同源橋接（10 min 有效期）
- admin.html `applyDraftFromMainSite()` 自動填 master textarea

---

## 3. 重要 file references

| 檔 | 用途 |
|---|---|
| `index.html` | SPA 主體 (~9000+ lines, 940KB)。`window._isAdmin` gate logic 在 line 904-937 |
| `index.html:6650-6692` | `sendScriptToFb()` + `openFbAdminBridge()` 新加函式 |
| `admin.html` | FB 發文後台（~600 lines, Firebase Auth gate） |
| `admin.html:328-358` | `applyDraftFromMainSite()` 新加函式 |
| `api/adjust.js:201-369` | 5 個 fb sub-actions (`fb_pages` / `fb_post` / `fb_history` / `fb_disconnect` / `fb_setup_pages`)，admin gate 在 line 213-216 |
| `api/_lib/fb.js` | Meta Graph API helper（postText/postPhoto/排程） |
| `api/image.js:24+131-135` | rate limit (10/min per uid)，**user 反映太嚴** |
| `fb-poster/pages.json` | 4 個 page tokens（gitignored，60 天有效，本機絕對路徑） |
| `fb-poster/social_poster.py` | Token 生成 CLI (`python social_poster.py setup all`) |

---

## 4. 禁區（標準 fumei-studio rules）

- ❌ 直接動 prod main（除非 user 明示）— 預設走 feature branch + preview
- ❌ 修 git config（user.email/name 用 `git -c user.email=...` 一次性 inline）
- ❌ commit pages.json / .env / FB token 到 repo（gitignored 但檢查）
- ❌ 改原本 user-facing 流程（一般 user UI 必須跟前一版一樣，admin gate 是底線）
- ❌ 砍 admin gate 4 行（Phase 2 多用戶要等 Meta App Review 通過）
- ❌ 跳 Vercel hobby 12 functions 上限（5 個 fb endpoints 已合進 adjust.js）
- ✅ 改動前 git checkout -b feat/xxx 開分支
- ✅ Test on preview 後才 merge prod
- ✅ Rollback plan: Vercel deployments → Promote rollback candidate
- ✅ Live 後第一件事：問 user 看效果再做下一步

---

## 5. Meta / FB 相關狀態

- **新 dev account** (2026-05-04 切換): `lightofkeepers2@hotmail.com`
- **Meta App ID**: `1522117856153893`
- **Meta App Secret**: `28116905dca208f6b7ef8d624bdc480d`
- **App 模式**: Development（未 App Review，只能 admin 自己用）
- **Token 60 天到期管理**：page token 雖 non-expiring 但 user token 60 天失效 → 屆時重跑 `python social_poster.py setup all` 拿新 pages.json → admin 解除連結 + 重貼

---

## 6. 一條龍 Roadmap（已對齊）

```
Phase A: admin only 主站<->後台橋接 ⭐ ← 本 session 完成 (preview)，等 merge
Phase B: admin.html 整合進 index.html (admin gate)
Phase C: Meta App Review + OAuth → 多用戶 + 點數扣費 (1-3 月)
Phase D: IG 整合（IG Business + FB Page 連結）
Phase E: Cron 自動排程發文（vercel cron + AI 自選話題）= Pro 訂閱核心賣點
```

讀完 → 問 user 「feat/fb-bridge 要 merge 嗎？生圖 rate limit 要不要先處理？」
