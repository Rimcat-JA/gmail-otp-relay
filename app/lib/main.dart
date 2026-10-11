import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'data.dart';

void main() => runApp(const OtpRelayApp());

/// これより古いコードは期限切れの可能性が高いので薄く表示する。
const _freshFor = Duration(minutes: 10);
const _refreshEvery = Duration(seconds: 15);

class OtpRelayApp extends StatelessWidget {
  const OtpRelayApp({super.key, this.api, this.store});

  final RelayApi? api;
  final AccountStore? store;

  @override
  Widget build(BuildContext context) {
    const seed = Color(0xFF2A6FDB);
    return MaterialApp(
      title: '認証コード',
      debugShowCheckedModeBanner: false,
      locale: const Locale('ja'),
      supportedLocales: const [Locale('ja'), Locale('en')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      theme: ThemeData(colorSchemeSeed: seed, useMaterial3: true),
      darkTheme: ThemeData(colorSchemeSeed: seed, brightness: Brightness.dark, useMaterial3: true),
      home: HomePage(api: api ?? RelayApi(), store: store ?? AccountStore()),
    );
  }
}

class HomePage extends StatefulWidget {
  const HomePage({super.key, required this.api, required this.store});

  final RelayApi api;
  final AccountStore store;

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> with WidgetsBindingObserver {
  List<Account> _accounts = [];
  List<OtpCode> _codes = [];
  final Map<String, String> _errors = {};
  bool _loaded = false;
  bool _refreshing = false;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _reloadAccounts();
    _startTimer();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _refresh();
      _startTimer();
    } else if (state == AppLifecycleState.paused) {
      _timer?.cancel();
    }
  }

  void _startTimer() {
    _timer?.cancel();
    _timer = Timer.periodic(_refreshEvery, (_) => _refresh());
  }

  Future<void> _reloadAccounts() async {
    final accounts = await widget.store.load();
    if (!mounted) return;
    setState(() {
      _accounts = accounts;
      _loaded = true;
    });
    await _refresh();
  }

  Future<void> _refresh() async {
    if (_refreshing || _accounts.isEmpty) return;
    _refreshing = true;
    try {
      final results = await Future.wait(_accounts.map((a) async {
        try {
          return (a, await widget.api.fetch(a.url), null);
        } on RelayException catch (e) {
          return (a, null, e.message);
        }
      }));
      if (!mounted) return;

      var labelsChanged = false;
      final codes = <OtpCode>[];
      _errors.clear();
      for (final (account, result, error) in results) {
        if (result != null) {
          codes.addAll(result.codes);
          if (result.account.isNotEmpty && result.account != account.label) {
            account.label = result.account;
            labelsChanged = true;
          }
        } else {
          _errors[account.url] = error!;
        }
      }
      codes.sort((a, b) => b.receivedAt.compareTo(a.receivedAt));
      setState(() => _codes = codes);
      if (labelsChanged) await widget.store.save(_accounts);
    } finally {
      _refreshing = false;
    }
  }

  Future<void> _openAccounts() async {
    await Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => AccountsPage(api: widget.api, store: widget.store),
    ));
    await _reloadAccounts();
  }

  void _copy(OtpCode code) {
    Clipboard.setData(ClipboardData(text: code.code));
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(
        content: Text('${code.code} をコピーしました'),
        duration: const Duration(seconds: 2),
      ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('認証コード'),
        actions: [
          IconButton(
            tooltip: 'アカウント',
            icon: const Icon(Icons.manage_accounts_outlined),
            onPressed: _openAccounts,
          ),
        ],
      ),
      body: !_loaded
          ? const Center(child: CircularProgressIndicator())
          : _accounts.isEmpty
              ? _EmptyState(
                  icon: Icons.mark_email_unread_outlined,
                  title: 'アカウントが登録されていません',
                  message: 'Apps Script の sendAppLink() を実行すると、Telegram に接続 URL が届きます。それを追加してください。',
                  action: FilledButton.icon(
                    onPressed: _openAccounts,
                    icon: const Icon(Icons.add),
                    label: const Text('アカウントを追加'),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _refresh,
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
                    physics: const AlwaysScrollableScrollPhysics(),
                    children: [
                      for (final a in _accounts)
                        if (_errors[a.url] != null) _ErrorBanner(label: a.label, message: _errors[a.url]!),
                      if (_codes.isEmpty)
                        const Padding(
                          padding: EdgeInsets.only(top: 96),
                          child: _EmptyState(
                            icon: Icons.inbox_outlined,
                            title: 'まだコードはありません',
                            message: '認証コードのメールが届くと、1 分以内にここに表示されます。下に引っ張ると更新します。',
                          ),
                        ),
                      for (final (i, c) in _codes.indexed)
                        _CodeCard(code: c, highlight: i == 0, onTap: () => _copy(c)),
                    ],
                  ),
                ),
    );
  }
}

class _CodeCard extends StatelessWidget {
  const _CodeCard({required this.code, required this.highlight, required this.onTap});

  final OtpCode code;
  final bool highlight;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final fresh = DateTime.now().difference(code.receivedAt) < _freshFor;
    final emphasized = highlight && fresh;
    return Opacity(
      opacity: fresh ? 1 : 0.5,
      child: Card(
        elevation: 0,
        color: emphasized ? scheme.primaryContainer : scheme.surfaceContainerHighest,
        margin: const EdgeInsets.symmetric(vertical: 6),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 12, 16),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        code.code,
                        style: TextStyle(
                          fontSize: emphasized ? 36 : 28,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 4,
                          fontFeatures: const [FontFeature.tabularFigures()],
                          color: emphasized ? scheme.onPrimaryContainer : scheme.onSurface,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '${code.sender} · ${code.account} · ${_relative(code.receivedAt)}',
                        style: Theme.of(context).textTheme.bodySmall,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                Icon(Icons.copy_rounded, color: scheme.primary),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

String _relative(DateTime t) {
  final d = DateTime.now().difference(t);
  if (d.inMinutes < 1) return 'たった今';
  if (d.inHours < 1) return '${d.inMinutes}分前';
  if (d.inDays < 1) return '${d.inHours}時間前';
  return '${d.inDays}日前';
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.label, required this.message});

  final String label;
  final String message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      elevation: 0,
      color: scheme.errorContainer,
      margin: const EdgeInsets.symmetric(vertical: 6),
      child: ListTile(
        leading: Icon(Icons.error_outline, color: scheme.onErrorContainer),
        title: Text(label.isEmpty ? 'アカウント' : label, style: TextStyle(color: scheme.onErrorContainer)),
        subtitle: Text(message, style: TextStyle(color: scheme.onErrorContainer)),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.icon, required this.title, required this.message, this.action});

  final IconData icon;
  final String title;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 56, color: theme.colorScheme.outline),
            const SizedBox(height: 16),
            Text(title, style: theme.textTheme.titleMedium, textAlign: TextAlign.center),
            const SizedBox(height: 8),
            Text(message, style: theme.textTheme.bodyMedium, textAlign: TextAlign.center),
            if (action != null) ...[const SizedBox(height: 24), action!],
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// アカウント管理
// ---------------------------------------------------------------------------

class AccountsPage extends StatefulWidget {
  const AccountsPage({super.key, required this.api, required this.store});

  final RelayApi api;
  final AccountStore store;

  @override
  State<AccountsPage> createState() => _AccountsPageState();
}

class _AccountsPageState extends State<AccountsPage> {
  List<Account> _accounts = [];

  @override
  void initState() {
    super.initState();
    widget.store.load().then((a) {
      if (mounted) setState(() => _accounts = a);
    });
  }

  Future<void> _add() async {
    final account = await showDialog<Account>(
      context: context,
      builder: (_) => _AddAccountDialog(api: widget.api, existing: _accounts),
    );
    if (account == null) return;
    setState(() => _accounts = [..._accounts, account]);
    await widget.store.save(_accounts);
  }

  Future<void> _remove(Account account) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('アカウントを削除'),
        content: Text('「${account.label}」をこの端末から削除しますか？\nGmail 側の監視は止まりません。'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('キャンセル')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('削除')),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _accounts = _accounts.where((a) => a.url != account.url).toList());
    await widget.store.save(_accounts);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('アカウント')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _add,
        icon: const Icon(Icons.add),
        label: const Text('追加'),
      ),
      body: _accounts.isEmpty
          ? const _EmptyState(
              icon: Icons.link,
              title: '接続 URL を追加してください',
              message: 'Gmail アカウントごとに 1 つずつ追加できます。',
            )
          : ListView(
              padding: const EdgeInsets.only(bottom: 96),
              children: [
                for (final a in _accounts)
                  ListTile(
                    leading: const Icon(Icons.alternate_email),
                    title: Text(a.label.isEmpty ? '(名前なし)' : a.label),
                    subtitle: Text(_maskedHost(a.url)),
                    trailing: IconButton(
                      tooltip: '削除',
                      icon: const Icon(Icons.delete_outline),
                      onPressed: () => _remove(a),
                    ),
                  ),
              ],
            ),
    );
  }
}

String _maskedHost(String url) {
  final uri = Uri.tryParse(url);
  if (uri == null) return '';
  final id = uri.pathSegments.length > 2 ? uri.pathSegments[2] : '';
  final shortId = id.length > 10 ? '${id.substring(0, 6)}…${id.substring(id.length - 4)}' : id;
  return '${uri.host} · $shortId';
}

class _AddAccountDialog extends StatefulWidget {
  const _AddAccountDialog({required this.api, required this.existing});

  final RelayApi api;
  final List<Account> existing;

  @override
  State<_AddAccountDialog> createState() => _AddAccountDialogState();
}

class _AddAccountDialogState extends State<_AddAccountDialog> {
  final _controller = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _paste() async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    final text = data?.text?.trim();
    if (text != null && text.isNotEmpty) setState(() => _controller.text = text);
  }

  Future<void> _submit() async {
    final url = _controller.text.trim();
    final invalid = validateConnectionUrl(url);
    if (invalid != null) return setState(() => _error = invalid);
    if (widget.existing.any((a) => a.url == url)) return setState(() => _error = 'この URL はすでに追加されています');

    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await widget.api.fetch(url);
      if (!mounted) return;
      Navigator.pop(context, Account(url: url, label: result.account));
    } on RelayException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('アカウントを追加'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Telegram に届いた接続 URL を貼り付けてください。'),
          const SizedBox(height: 16),
          TextField(
            controller: _controller,
            enabled: !_busy,
            minLines: 2,
            maxLines: 4,
            keyboardType: TextInputType.url,
            autocorrect: false,
            decoration: InputDecoration(
              border: const OutlineInputBorder(),
              hintText: 'https://script.google.com/macros/s/…/exec?key=…',
              errorText: _error,
              errorMaxLines: 4,
            ),
          ),
          const SizedBox(height: 8),
          TextButton.icon(
            onPressed: _busy ? null : _paste,
            icon: const Icon(Icons.content_paste),
            label: const Text('クリップボードから貼り付け'),
          ),
        ],
      ),
      actions: [
        TextButton(onPressed: _busy ? null : () => Navigator.pop(context), child: const Text('キャンセル')),
        FilledButton(
          onPressed: _busy ? null : _submit,
          child: _busy
              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : const Text('接続して追加'),
        ),
      ],
    );
  }
}
