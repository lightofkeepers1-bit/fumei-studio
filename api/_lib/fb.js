// api/_lib/fb.js — Meta Graph API helper (FB Page posting)
// 集中放 FB API 呼叫, 統一錯誤處理 (不洩露 URL/token)

const GRAPH = 'https://graph.facebook.com/v19.0';

export class FBError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'FBError';
    this.status = status;
    this.code = code;
  }
}

async function handle(r) {
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.error?.message || `FB API status ${r.status}`;
    throw new FBError(msg, r.status, data?.error?.code);
  }
  return data;
}

// 純文字 (or 排程文字)
export async function postText(pageId, accessToken, message, scheduledAt = null) {
  const body = new URLSearchParams({ message, access_token: accessToken });
  if (scheduledAt) {
    body.append('published', 'false');
    body.append('scheduled_publish_time', String(scheduledAt));
  }
  const r = await fetch(`${GRAPH}/${pageId}/feed`, { method: 'POST', body });
  return handle(r);
}

// 帶圖貼文 (image_url 必須是 public https URL, FB 自己 fetch)
export async function postPhoto(pageId, accessToken, imageUrl, caption = '', scheduledAt = null) {
  const body = new URLSearchParams({
    url: imageUrl,
    caption,
    access_token: accessToken,
  });
  if (scheduledAt) {
    body.append('published', 'false');
    body.append('scheduled_publish_time', String(scheduledAt));
  }
  const r = await fetch(`${GRAPH}/${pageId}/photos`, { method: 'POST', body });
  return handle(r);
}

// 直接 multipart 上傳 Buffer 到 FB（不需要圖床；node 18+ 有原生 FormData/Blob）
export async function postPhotoBuffer(pageId, accessToken, photoBuffer, mimeType, caption = '', scheduledAt = null) {
  const fd = new FormData();
  fd.append('source', new Blob([photoBuffer], { type: mimeType || 'image/jpeg' }), 'photo.jpg');
  if (caption) fd.append('caption', caption);
  fd.append('access_token', accessToken);
  if (scheduledAt) {
    fd.append('published', 'false');
    fd.append('scheduled_publish_time', String(scheduledAt));
  }
  const r = await fetch(`${GRAPH}/${pageId}/photos`, { method: 'POST', body: fd });
  return handle(r);
}

// 多圖貼文：先把每張上傳為 unpublished photo 拿 photo_id，再用 attached_media 創建一篇 feed 貼文
// photos: [{ buffer, mimeType }]
export async function postMultiPhotos(pageId, accessToken, photos, message = '', scheduledAt = null) {
  if (!Array.isArray(photos) || photos.length < 2) {
    throw new FBError('postMultiPhotos 至少 2 張', 400);
  }
  const photoIds = [];
  for (const p of photos) {
    const fd = new FormData();
    fd.append('source', new Blob([p.buffer], { type: p.mimeType || 'image/jpeg' }), 'photo.jpg');
    fd.append('published', 'false');
    fd.append('access_token', accessToken);
    const r = await fetch(`${GRAPH}/${pageId}/photos`, { method: 'POST', body: fd });
    const data = await handle(r);
    if (!data.id) throw new FBError('Photo upload no id', 500);
    photoIds.push(data.id);
  }
  const body = new URLSearchParams();
  if (message) body.append('message', message);
  body.append('access_token', accessToken);
  body.append('attached_media', JSON.stringify(photoIds.map(id => ({ media_fbid: id }))));
  if (scheduledAt) {
    body.append('published', 'false');
    body.append('scheduled_publish_time', String(scheduledAt));
  }
  const r = await fetch(`${GRAPH}/${pageId}/feed`, { method: 'POST', body });
  return handle(r);
}

// 刪除貼文 (含排程未發布的)
export async function deletePost(postId, accessToken) {
  const r = await fetch(
    `${GRAPH}/${postId}?access_token=${encodeURIComponent(accessToken)}`,
    { method: 'DELETE' }
  );
  return handle(r);
}

// 驗證 token 是否還有效 (給 admin UI 用, 不耗 quota)
export async function verifyToken(accessToken) {
  const r = await fetch(
    `${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(accessToken)}`
  );
  if (!r.ok) return { valid: false };
  const data = await r.json();
  return { valid: true, id: data.id, name: data.name };
}
