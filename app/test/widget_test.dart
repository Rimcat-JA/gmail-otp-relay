import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:otp_relay/data.dart';
import 'package:otp_relay/main.dart';

const _url = 'https://script.google.com/macros/s/AKfycbxEXAMPLE/exec?key=secret';

class _MemoryStore extends AccountStore {
  _MemoryStore(this.accounts);

  List<Account> accounts;

  @override
  Future<List<Account>> load() async => [...accounts];

  @override
  Future<void> save(List<Account> accounts) async => this.accounts = [...accounts];
}

RelayApi _apiReturning(Object body, {int status = 200}) => RelayApi(
      client: MockClient((req) async => http.Response.bytes(
            utf8.encode(body is String ? body : jsonEncode(body)),
            status,
            headers: {'content-type': 'application/json; charset=utf-8'},
          )),
    );

void main() {
  group('validateConnectionUrl', () {
    test('accepts an /exec URL with a key', () => expect(validateConnectionUrl(_url), isNull));
    test('rejects http', () => expect(validateConnectionUrl('http://example.com/exec?key=a'), isNotNull));
    test('rejects a missing key', () => expect(validateConnectionUrl('https://script.google.com/macros/s/x/exec'), isNotNull));
    test('rejects /dev', () => expect(validateConnectionUrl('https://script.google.com/macros/s/x/dev?key=a'), isNotNull));
  });

  group('RelayApi', () {
    test('parses codes', () async {
      final now = DateTime.now().millisecondsSinceEpoch;
      final result = await _apiReturning({
        'ok': true,
        'account': '仕事用',
        'codes': [
          {'id': 'm1', 'code': '482913', 'sender': 'Amazon', 'receivedAt': now},
        ],
      }).fetch(_url);
      expect(result.account, '仕事用');
      expect(result.codes.single.code, '482913');
      expect(result.codes.single.account, '仕事用');
    });

    test('reports a wrong key', () async {
      expect(
        () => _apiReturning({'ok': false, 'error': 'unauthorized'}).fetch(_url),
        throwsA(isA<RelayException>().having((e) => e.message, 'message', contains('キー'))),
      );
    });

    test('reports an HTML response (web app not public)', () async {
      expect(
        () => _apiReturning('<html>Sign in</html>').fetch(_url),
        throwsA(isA<RelayException>().having((e) => e.message, 'message', contains('全員'))),
      );
    });
  });

  testWidgets('shows an empty state without accounts', (tester) async {
    await tester.pumpWidget(OtpRelayApp(api: _apiReturning({'ok': true}), store: _MemoryStore([])));
    await tester.pumpAndSettle();
    expect(find.text('アカウントが登録されていません'), findsOneWidget);
  });

  testWidgets('lists codes newest first and copies on tap', (tester) async {
    final now = DateTime.now().millisecondsSinceEpoch;
    final api = _apiReturning({
      'ok': true,
      'account': 'me@example.com',
      'codes': [
        {'id': 'b', 'code': '111111', 'sender': 'Old', 'receivedAt': now - 3600 * 1000},
        {'id': 'a', 'code': '222222', 'sender': 'New', 'receivedAt': now - 60 * 1000},
      ],
    });
    final copied = <String>[];
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
      if (call.method == 'Clipboard.setData') copied.add((call.arguments as Map)['text'] as String);
      return null;
    });

    await tester.pumpWidget(OtpRelayApp(api: api, store: _MemoryStore([Account(url: _url, label: '')])));
    await tester.pumpAndSettle();

    final newer = tester.getTopLeft(find.text('222222'));
    final older = tester.getTopLeft(find.text('111111'));
    expect(newer.dy, lessThan(older.dy));
    expect(find.textContaining('New · me@example.com'), findsOneWidget);

    await tester.tap(find.text('222222'));
    await tester.pump();
    expect(copied, ['222222']);
    expect(find.text('222222 をコピーしました'), findsOneWidget);

    // 定期更新のタイマーを止めてからテストを終える
    await tester.pumpWidget(const SizedBox());
  });
}
