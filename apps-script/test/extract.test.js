// Code.gs のコード検出部分を Node で検証する: node apps-script/test/extract.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), ctx);

const conf = (o = {}) => ({ includeSenders: [], excludeSenders: [], extraKeywords: [], ...o });
const detect = (subject, body, senderAddress = 'no-reply@example.com', c = conf()) =>
  ctx.detectCode_({ subject, body, senderAddress }, c);

const cases = [
  // [説明, 期待値, 件名, 本文, 送信元, 設定]
  ['日本語の認証コード', '482913', '【Amazon】認証コード', 'お客様の認証コードは 482913 です。このコードは10分間有効です。'],
  ['全角数字', '582014', 'ログインのご確認', 'ワンタイムパスワード：５８２０１４\n有効期限は2026年10月12日 15:30までです。'],
  ['Google 形式', '123456', 'G-123456 is your Google verification code', ''],
  ['英語・コードが先', '904211', 'Your code', '904211 is your verification code. Do not share it.'],
  ['区切り付き', '381204', 'Microsoft account security code', 'Security code: 381 204'],
  ['金額・日付・URLを無視', '7741', '本人確認のお願い', 'ご注文金額 12,800円 (2026/10/12)\nhttps://example.com/verify?id=99887766\n確認コード: 7741'],
  ['電話番号を無視', '650021', 'Verify your login', 'Call 03-1234-5678 if this was not you.\nYour verification code is 650021.'],
  ['英数字コード', 'X7K2QP', 'Sign-in code', 'Enter this one-time code to sign in: X7K2QP'],
  ['HTML 由来のテキスト', '330198', 'Verification', ctx.htmlToText_('<html><head><style>.a{color:#123456}</style></head><body><p>Your code</p><td><b>330198</b></td><p>© 2026 Example Inc.</p></body></html>')],
  ['キーワードなしは対象外', null, '今週のお知らせ', '会員番号 55667788 のお客様へ。セールは 10/20 まで。'],
  ['ニュースレターの年号', null, 'Newsletter', 'Thanks for reading. © 2026 Example'],
  ['除外リスト', null, '認証コード', '認証コードは 112233 です', 'promo@shop.example.com', conf({ excludeSenders: ['example.com'] })],
  ['追加リスト (キーワードなし)', '445566', 'お知らせ', 'ログイン用の数字: 445566', 'auth@bank.example.jp', conf({ includeSenders: ['bank.example.jp'] })],
  ['除外が追加より優先', null, '認証コード', '認証コードは 112233 です', 'a@x.jp', conf({ includeSenders: ['a@x.jp'], excludeSenders: ['x.jp'] })],
  ['追加キーワード', '908172', 'ご利用のお知らせ', 'ログイン用番号は 908172 です', 'a@y.jp', conf({ extraKeywords: ['ログイン用番号'] })],
  ['アドレス指定は完全一致', '112233', '認証コード', '認証コードは 112233 です', 'other@x.jp', conf({ excludeSenders: ['a@x.jp'] })],
];

let failed = 0;
for (const [name, expected, subject, body, sender, c] of cases) {
  const got = detect(subject, body, sender, c);
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (expected ${expected}, got ${got})`);
}

assert.deepStrictEqual(
  JSON.parse(JSON.stringify(ctx.parseFrom_('"Amazon.co.jp" <Account-Update@amazon.co.jp>'))),
  { name: 'Amazon.co.jp', address: 'account-update@amazon.co.jp' });
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(ctx.parseFrom_('no-reply@accounts.google.com'))),
  { name: 'accounts.google.com', address: 'no-reply@accounts.google.com' });

if (failed) {
  console.error(`\n${failed} case(s) failed`);
  process.exit(1);
}
console.log('\nall cases passed');
