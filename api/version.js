// api/version.js — 回傳當前部署的版本資訊
// Vercel 會自動注入 VERCEL_GIT_* 這幾個環境變數（每次 deploy 都更新）
// 前端 fetch 這支 endpoint 顯示 footer 版本號，方便 debug 時對齊版本
// 本機跑（無 VERCEL 環境）時會顯示 'local'

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.fumei-studio.com');
  res.setHeader('Cache-Control', 'public, max-age=60');  // 快取 1 分鐘（下次 deploy 最多延遲 1 分鐘才更新）
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sha  = process.env.VERCEL_GIT_COMMIT_SHA || 'local';
  const ref  = process.env.VERCEL_GIT_COMMIT_REF || '';
  const msg  = process.env.VERCEL_GIT_COMMIT_MESSAGE || '';
  const env  = process.env.VERCEL_ENV || 'development';   // production / preview / development

  return res.status(200).json({
    sha:      sha.slice(0, 7),       // 短 SHA（7 字）
    shaFull:  sha,
    branch:   ref,
    message:  msg.split('\n')[0].slice(0, 80),
    env,
    deployedAt: process.env.VERCEL_DEPLOYMENT_CREATED_AT || '',
  });
}
