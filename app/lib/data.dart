import 'dart:async';
import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

/// Apps Script のウェブアプリ 1 つ (= Gmail アカウント 1 つ) への接続情報。
class Account {
  Account({required this.url, required this.label});

  /// `https://script.google.com/macros/s/…/exec?key=…` 形式の接続 URL。
  final String url;
  String label;

  Map<String, dynamic> toJson() => {'url': url, 'label': label};

  factory Account.fromJson(Map<String, dynamic> json) =>
      Account(url: json['url'] as String, label: (json['label'] as String?) ?? '');
}

class OtpCode {
  OtpCode({
    required this.id,
    required this.code,
    required this.sender,
    required this.account,
    required this.receivedAt,
  });

  final String id;
  final String code;
  final String sender;
  final String account;
  final DateTime receivedAt;
}

class FetchResult {
  FetchResult({required this.account, required this.codes});

  final String account;
  final List<OtpCode> codes;
}

class RelayException implements Exception {
  RelayException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// 接続 URL として受け付けられるかを調べ、問題があれば理由を返す。
String? validateConnectionUrl(String input) {
  final uri = Uri.tryParse(input.trim());
  if (uri == null || uri.scheme != 'https' || uri.host.isEmpty) {
    return 'https:// で始まる URL を入力してください';
  }
  if ((uri.queryParameters['key'] ?? '').isEmpty) {
    return 'URL に key が含まれていません。Telegram に届いた接続 URL をそのまま貼り付けてください';
  }
  if (uri.path.endsWith('/dev')) {
    return '/dev ではなく /exec で終わる URL が必要です';
  }
  return null;
}

class RelayApi {
  RelayApi({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;

  Future<FetchResult> fetch(String url) async {
    final http.Response res;
    try {
      res = await _client.get(Uri.parse(url.trim())).timeout(const Duration(seconds: 20));
    } on TimeoutException {
      throw RelayException('接続がタイムアウトしました');
    } catch (_) {
      throw RelayException('接続できませんでした。通信状態を確認してください');
    }
    if (res.statusCode != 200) {
      throw RelayException('サーバーエラー (${res.statusCode})');
    }

    final Object? data;
    try {
      data = jsonDecode(utf8.decode(res.bodyBytes));
    } on FormatException {
      throw RelayException('応答を読み取れません。ウェブアプリの「アクセスできるユーザー」が「全員」になっているか確認してください');
    }
    if (data is! Map<String, dynamic>) {
      throw RelayException('応答の形式が正しくありません');
    }
    if (data['ok'] != true) {
      throw RelayException(data['error'] == 'unauthorized'
          ? 'キーが正しくありません。最新の接続 URL を追加し直してください'
          : 'エラー: ${data['error']}');
    }

    final account = (data['account'] as String?) ?? '';
    final codes = ((data['codes'] as List?) ?? const [])
        .whereType<Map<String, dynamic>>()
        .map((c) => OtpCode(
              id: '${c['id']}',
              code: '${c['code']}',
              sender: (c['sender'] as String?) ?? '',
              account: account,
              receivedAt: DateTime.fromMillisecondsSinceEpoch((c['receivedAt'] as num).toInt()),
            ))
        .toList();
    return FetchResult(account: account, codes: codes);
  }
}

/// 接続 URL には API キーが含まれるので、端末のキーチェーン / Keystore に保存する。
class AccountStore {
  AccountStore({FlutterSecureStorage? storage}) : _storage = storage ?? const FlutterSecureStorage();

  static const _key = 'accounts';
  final FlutterSecureStorage _storage;

  Future<List<Account>> load() async {
    final raw = await _storage.read(key: _key);
    if (raw == null || raw.isEmpty) return [];
    return (jsonDecode(raw) as List).map((e) => Account.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<void> save(List<Account> accounts) =>
      _storage.write(key: _key, value: jsonEncode(accounts.map((a) => a.toJson()).toList()));
}
