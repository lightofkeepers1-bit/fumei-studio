// api/_lib/admin.js — Firebase Admin SDK 共享初始化
// 用於繞過 Firestore rules 進行點數操作（兌換、簽到等）

import admin from 'firebase-admin';

let _app;

export function getAdmin() {
  if (_app) return _app;
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT env var not set');
    let creds;
    try {
      creds = JSON.parse(raw);
    } catch (e) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON: ' + e.message);
    }
    _app = admin.initializeApp({
      credential: admin.credential.cert(creds),
    });
  } else {
    _app = admin.app();
  }
  return _app;
}

export function getFirestore() {
  getAdmin();
  return admin.firestore();
}

// 驗證使用者 Firebase ID token，回傳 decoded token（含 uid、email）
// 失敗拋 Error
export async function verifyIdToken(idToken) {
  if (!idToken) throw new Error('Missing ID token');
  getAdmin();
  return admin.auth().verifyIdToken(idToken);
}

// 從 request 取出 ID token（Authorization: Bearer xxx）
export function getIdTokenFromReq(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}
