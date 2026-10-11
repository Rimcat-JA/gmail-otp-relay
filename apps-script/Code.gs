/**
 * Gmail OTP Relay — Google Apps Script 本体
 *
 * Gmail を読み取り専用で 1 分ごとに確認し、認証コードだけを抜き出して
 *   1. Telegram Bot で自分のチャットに通知する
 *   2. iOS / Android アプリ向けに最近のコードを API (doGet) で返す
 *
 * エディタから実行する関数:
 *   showTelegramChatId() … Bot に話しかけた後に実行し、chat_id を調べる
 *   setup()              … 設定を確認し、1 分ごとのトリガーを作り、テスト通知を送る
 *   sendAppLink()        … ウェブアプリとしてデプロイした後に実行し、アプリ用の接続 URL を Telegram に送る
 *   testExtract()        … 直近のメールでコード抽出を試す (通知は送らない)
 *   stop()               … トリガーを削除して監視を止める
 *
 * スクリプト プロパティ (プロジェクトの設定 → スクリプト プロパティ):
 *   TELEGRAM_BOT_TOKEN  必須  BotFather で発行されたトークン
 *   TELEGRAM_CHAT_ID    必須  通知先のチャット ID
 *   ACCOUNT_LABEL       任意  通知に表示するアカウント名 (省略時は Gmail アドレス)
 *   INCLUDE_SENDERS     任意  キーワードがなくても対象にする送信元 (カンマ区切り、アドレスかドメイン)
 *   EXCLUDE_SENDERS     任意  常に無視する送信元 (カンマ区切り、アドレスかドメイン)。追加リストより優先
 *   EXTRA_KEYWORDS      任意  判定に使うキーワードを追加 (カンマ区切り)
 *   WEB_APP_URL         任意  ウェブアプリの URL (…/exec)。自動取得できない場合だけ設定
 */

// ---------------------------------------------------------------------------
// 設定値
// ---------------------------------------------------------------------------

/** これより古いメールは通知しない (初回実行時や遅延時の大量通知を防ぐ) */
const MAX_AGE_MINUTES = 15;
/** アプリ向けに保持するコードの件数と期間 */
const RECENT_CODES_LIMIT = 30;
const RECENT_CODES_TTL_HOURS = 24;
/** 重複通知を防ぐために覚えておくメール ID の件数 */
const SEEN_IDS_LIMIT = 300;

/** これを含むメールだけを認証コードのメールとみなす */
const STRONG_KEYWORDS = [
  '認証', 'ワンタイム', '確認コード', '確認番号', 'セキュリティコード', 'ログインコード',
  'パスコード', '本人確認', '検証コード', '承認コード', '2段階', '二段階', '2要素', '二要素',
  'verification', 'verify', 'one-time', 'one time', 'otp', 'passcode', 'security code',
  'login code', 'log-in code', 'sign-in code', 'sign in code', 'confirmation code',
  'authentication code', 'auth code', 'access code', '2fa', 'two-factor', 'two factor',
  'your code', 'pin code',
];

/** コードの位置を探すときだけ使う (これだけでは対象にしない) */
const WEAK_KEYWORDS = ['code', 'コード', '番号', 'pin'];

// ---------------------------------------------------------------------------
// エディタから実行する関数
// ---------------------------------------------------------------------------

function setup() {
  const conf = loadConfig_();
  if (!conf.botToken || !conf.chatId) {
    throw new Error('スクリプト プロパティに TELEGRAM_BOT_TOKEN と TELEGRAM_CHAT_ID を設定してください。');
  }
  const label = accountLabel_();

  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'checkMail')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('checkMail').timeBased().everyMinutes(1).create();

  const props = PropertiesService.getScriptProperties();
  props.setProperty('LAST_TS', String(Math.floor(Date.now() / 1000)));
  if (!props.getProperty('API_KEY')) props.setProperty('API_KEY', newApiKey_());

  sendTelegram_(conf, '✅ <b>Gmail OTP Relay</b> の監視を開始しました\nアカウント: ' + escapeHtml_(label));
  console.log('セットアップ完了: ' + label + ' を 1 分ごとに確認します。');
}

function stop() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'checkMail')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  console.log('監視を停止しました。');
}

function showTelegramChatId() {
  const token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  if (!token) throw new Error('先にスクリプト プロパティに TELEGRAM_BOT_TOKEN を設定してください。');
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getUpdates', { muteHttpExceptions: true });
  const data = JSON.parse(res.getContentText());
  if (!data.ok) throw new Error('Telegram API エラー: ' + data.description);
  const chats = {};
  (data.result || []).forEach((u) => {
    const msg = u.message || u.edited_message || u.channel_post;
    if (msg && msg.chat) chats[msg.chat.id] = msg.chat.username || msg.chat.title || msg.chat.first_name || '';
  });
  const ids = Object.keys(chats);
  if (!ids.length) {
    console.log('メッセージが見つかりません。Telegram で Bot に何か送ってから、もう一度実行してください。');
    return;
  }
  ids.forEach((id) => console.log('chat_id: ' + id + '  (' + chats[id] + ')'));
}

function sendAppLink() {
  const conf = loadConfig_();
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('API_KEY');
  if (!key) {
    key = newApiKey_();
    props.setProperty('API_KEY', key);
  }
  const url = props.getProperty('WEB_APP_URL') || ScriptApp.getService().getUrl();
  if (!url) throw new Error('先に「デプロイ → 新しいデプロイ → ウェブアプリ」でデプロイしてください。');
  if (/\/dev$/.test(url)) {
    throw new Error('取得した URL が /dev で終わっています。デプロイ画面の /exec で終わる URL をスクリプト プロパティ WEB_APP_URL に設定してください。');
  }
  const link = url + '?key=' + key;
  sendTelegram_(conf,
    '📱 <b>アプリ用の接続 URL</b> (' + escapeHtml_(accountLabel_()) + ')\n' +
    'アプリの「アカウントを追加」に貼り付けてください。\n\n<code>' + escapeHtml_(link) + '</code>');
  console.log('接続 URL を Telegram に送りました。');
}

function testExtract() {
  const conf = loadConfig_();
  const list = gmailApi_('messages?maxResults=10&q=' + encodeURIComponent('-in:sent -in:chats -in:drafts'));
  (list.messages || []).forEach((m) => {
    const mail = readMessage_(m.id);
    const code = detectCode_(mail, conf);
    console.log((code ? '✔ ' + code : '— なし') + '  |  ' + mail.senderName + '  |  ' + mail.subject);
  });
}

// ---------------------------------------------------------------------------
// トリガー本体
// ---------------------------------------------------------------------------

function checkMail() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  const props = PropertiesService.getScriptProperties();
  const nowSec = Math.floor(Date.now() / 1000);
  const lastTs = Number(props.getProperty('LAST_TS')) || nowSec - MAX_AGE_MINUTES * 60;
  const seen = JSON.parse(props.getProperty('SEEN_IDS') || '[]');
  const recent = JSON.parse(props.getProperty('RECENT_CODES') || '[]');
  try {
    const conf = loadConfig_();
    // Gmail の検索インデックスの遅れを見込んで 5 分重ねて検索し、処理済みの ID は飛ばす
    const q = 'after:' + (lastTs - 300) + ' -in:sent -in:chats -in:drafts';
    const list = gmailApi_('messages?maxResults=30&q=' + encodeURIComponent(q));
    const ids = (list.messages || []).map((m) => m.id).filter((id) => seen.indexOf(id) === -1).reverse();

    ids.forEach((id) => {
      seen.push(id);
      const mail = readMessage_(id);
      if (Date.now() - mail.receivedAt > MAX_AGE_MINUTES * 60 * 1000) return;
      const code = detectCode_(mail, conf);
      if (!code) return;

      recent.unshift({ id: id, code: code, sender: mail.senderName, receivedAt: mail.receivedAt });
      try {
        sendTelegram_(conf, '🔑 <code>' + escapeHtml_(code) + '</code>\n' +
          escapeHtml_(mail.senderName) + ' · ' + escapeHtml_(accountLabel_()));
      } catch (err) {
        console.error('Telegram への送信に失敗: ' + err);
      }
    });
    props.setProperty('LAST_TS', String(nowSec));
  } finally {
    const cutoff = Date.now() - RECENT_CODES_TTL_HOURS * 3600 * 1000;
    props.setProperty('SEEN_IDS', JSON.stringify(seen.slice(-SEEN_IDS_LIMIT)));
    props.setProperty('RECENT_CODES', JSON.stringify(
      recent.filter((c) => c.receivedAt >= cutoff).slice(0, RECENT_CODES_LIMIT)));
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// アプリ向け API: GET <ウェブアプリURL>?key=<API_KEY>
// ---------------------------------------------------------------------------

function doGet(e) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('API_KEY');
  const given = (e && e.parameter && e.parameter.key) || '';
  if (!key || given !== key) return json_({ ok: false, error: 'unauthorized' });

  const cutoff = Date.now() - RECENT_CODES_TTL_HOURS * 3600 * 1000;
  const codes = JSON.parse(props.getProperty('RECENT_CODES') || '[]').filter((c) => c.receivedAt >= cutoff);
  return json_({ ok: true, account: accountLabel_(), codes: codes, serverTime: Date.now() });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// コード検出 (純粋関数。test/extract.test.js からも呼ばれる)
// ---------------------------------------------------------------------------

/**
 * mail: { subject, body, senderAddress } / conf: { includeSenders, excludeSenders, extraKeywords }
 * 対象外か、コードが見つからなければ null を返す。
 */
function detectCode_(mail, conf) {
  if (senderMatches_(mail.senderAddress, conf.excludeSenders)) return null;
  const forced = senderMatches_(mail.senderAddress, conf.includeSenders);
  return extractCode_(mail.subject, mail.body, { forced: forced, extraKeywords: conf.extraKeywords });
}

function extractCode_(subject, body, opts) {
  opts = opts || {};
  const extra = opts.extraKeywords || [];
  const text = cleanText_(normalizeText_((subject || '') + '\n' + (body || '')));
  const lower = text.toLowerCase();

  const strong = STRONG_KEYWORDS.concat(extra);
  const isOtpMail = strong.some((kw) => lower.indexOf(kw) !== -1);
  if (!isOtpMail && !opts.forced) return null;

  const spans = [];
  strong.concat(WEAK_KEYWORDS).forEach((kw) => {
    for (let i = lower.indexOf(kw); i !== -1; i = lower.indexOf(kw, i + 1)) {
      spans.push([i, i + kw.length]);
    }
  });

  const candidates = findCandidates_(text);
  let best = null;
  candidates.forEach((c) => {
    let d = Infinity;
    spans.forEach(([ks, ke]) => {
      if (c.start >= ke) d = Math.min(d, c.start - ke);
      else if (c.end <= ks) d = Math.min(d, (ks - c.end) * 1.5 + 5);
    });
    if (d === Infinity) {
      if (!opts.forced) return;
      d = 1000 + c.start / 100; // キーワードがない場合は先に出てくる数字を優先
    } else if (d > 300 && !opts.forced) {
      return;
    }
    d += c.penalty;
    if (!best || d < best.score) best = { value: c.value, score: d };
  });
  return best ? best.value : null;
}

function findCandidates_(text) {
  const out = [];
  const push = (m, value, penalty) => out.push({ value: value, start: m.index, end: m.index + m[0].length, penalty: penalty });
  let m;

  // Google 形式: G-123456
  const reG = /(?<![0-9A-Za-z])G-(\d{6})(?![0-9A-Za-z])/g;
  while ((m = reG.exec(text))) push(m, m[1], 0);

  // 区切り付き: 123 456 / 123-456
  const reSplit = /(?<![0-9A-Za-z\-\/.,:])(\d{3})[ \-](\d{3})(?![0-9A-Za-z]|[\-\/.,:]\d)/g;
  while ((m = reSplit.exec(text))) push(m, m[1] + m[2], 3);

  // 4〜8 桁の数字 (金額・日付・時刻・郵便番号・電話番号の一部は除く)
  const reNum = /(?<![0-9A-Za-z\-\/.,:#¥$€£〒©@])(\d{4,8})(?![0-9A-Za-z]|[\-\/.,:]\d|\s?(?:年|月|日|円|時|分|秒|件|名|個|%|歳|回|号|ドル|pt|ポイント|yen))/g;
  while ((m = reNum.exec(text))) {
    if (text.charAt(m.index - 1) === '-' && /G$/.test(text.slice(0, m.index - 1))) continue;
    const yearLike = m[1].length === 4 && /^(19|20)\d\d$/.test(m[1]);
    push(m, m[1], yearLike ? 40 : 0);
  }

  // 英数字混在 (例: X7K2QP)。大文字と数字の両方を含むものだけ
  const reAlnum = /(?<![0-9A-Za-z\-])([A-Z0-9]{6,8})(?![0-9A-Za-z\-])/g;
  while ((m = reAlnum.exec(text))) {
    if (/[A-Z]/.test(m[1]) && /\d/.test(m[1])) push(m, m[1], 25);
  }
  return out;
}

/** 全角英数字・記号を半角に、改行以外の空白を 1 つにまとめる */
function normalizeText_(s) {
  return s
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[－―‐−]/g, '-')
    .replace(/￥/g, '¥')
    .replace(/％/g, '%')
    .replace(/[　 \t ]+/g, ' ');
}

/** URL・メールアドレスなど、数字を含むがコードではない部分を消す */
function cleanText_(s) {
  return s
    .replace(/https?:\/\/[^\s<>"')]+/gi, ' ')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, ' ')
    .slice(0, 8000);
}

function senderMatches_(address, list) {
  if (!address || !list || !list.length) return false;
  const addr = address.toLowerCase();
  const domain = addr.split('@')[1] || '';
  return list.some((entry) => {
    if (entry.indexOf('@') !== -1) return addr === entry;
    return domain === entry || domain.endsWith('.' + entry);
  });
}

function htmlToText_(html) {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table|td)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/gi, '&');
}

/** "Amazon <no-reply@amazon.co.jp>" → { name: 'Amazon', address: 'no-reply@amazon.co.jp' } */
function parseFrom_(from) {
  const m = (from || '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const address = (m ? m[2] : from || '').trim().toLowerCase();
  const name = (m && m[1].trim()) || address.split('@')[1] || address;
  return { name: name, address: address };
}

// ---------------------------------------------------------------------------
// Gmail API (読み取り専用スコープで直接呼ぶ)
// ---------------------------------------------------------------------------

function gmailApi_(path) {
  const res = UrlFetchApp.fetch('https://gmail.googleapis.com/gmail/v1/users/me/' + path, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('Gmail API ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  }
  return JSON.parse(res.getContentText());
}

function readMessage_(id) {
  const msg = gmailApi_('messages/' + id + '?format=full');
  const headers = msg.payload.headers || [];
  const from = parseFrom_(headerValue_(headers, 'From'));
  const parts = { plain: [], html: [] };
  collectParts_(msg.payload, parts);
  const body = parts.plain.length ? parts.plain.join('\n') : htmlToText_(parts.html.join('\n'));
  return {
    id: id,
    subject: headerValue_(headers, 'Subject'),
    body: body || msg.snippet || '',
    senderName: from.name,
    senderAddress: from.address,
    receivedAt: Number(msg.internalDate),
  };
}

function collectParts_(part, out) {
  if (!part) return;
  if (part.parts) part.parts.forEach((p) => collectParts_(p, out));
  const type = (part.mimeType || '').toLowerCase();
  if (!part.body || !part.body.data || part.filename) return;
  if (type === 'text/plain') out.plain.push(decodeBody_(part));
  else if (type === 'text/html') out.html.push(decodeBody_(part));
}

/** 本文は元の文字コードのまま返ることがあるので、UTF-8 で崩れたら宣言された charset で読み直す */
function decodeBody_(part) {
  const bytes = Utilities.base64DecodeWebSafe(part.body.data);
  const utf8 = Utilities.newBlob(bytes).getDataAsString('UTF-8');
  const m = (headerValue_(part.headers || [], 'Content-Type') || '').match(/charset="?([^";\s]+)"?/i);
  const charset = m ? m[1] : '';
  if (!charset || /^utf-?8$/i.test(charset) || !/[�\u001B]/.test(utf8)) return utf8;
  try {
    return Utilities.newBlob(bytes).getDataAsString(charset);
  } catch (err) {
    return utf8;
  }
}

function headerValue_(headers, name) {
  const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

// ---------------------------------------------------------------------------
// 設定・Telegram
// ---------------------------------------------------------------------------

function loadConfig_() {
  const p = PropertiesService.getScriptProperties();
  const list = (key) => (p.getProperty(key) || '')
    .split(/[,、\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  return {
    botToken: (p.getProperty('TELEGRAM_BOT_TOKEN') || '').trim(),
    chatId: (p.getProperty('TELEGRAM_CHAT_ID') || '').trim(),
    includeSenders: list('INCLUDE_SENDERS'),
    excludeSenders: list('EXCLUDE_SENDERS'),
    extraKeywords: list('EXTRA_KEYWORDS'),
  };
}

function accountLabel_() {
  const p = PropertiesService.getScriptProperties();
  const label = p.getProperty('ACCOUNT_LABEL');
  if (label) return label;
  let email = p.getProperty('ACCOUNT_EMAIL');
  if (!email) {
    email = gmailApi_('profile').emailAddress;
    p.setProperty('ACCOUNT_EMAIL', email);
  }
  return email;
}

function sendTelegram_(conf, html) {
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + conf.botToken + '/sendMessage', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ chat_id: conf.chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
    muteHttpExceptions: true,
  });
  const data = JSON.parse(res.getContentText());
  if (!data.ok) throw new Error('Telegram API エラー: ' + data.description);
}

function escapeHtml_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function newApiKey_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}
