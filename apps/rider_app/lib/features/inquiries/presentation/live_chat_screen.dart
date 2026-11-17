import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../../delivery/domain/delivery.dart';
import '../../delivery/presentation/delivery_texts.dart' show clockText;
import '../data/live_chat.dart';

/// 실시간 채팅 상담(배송과 상관없는 것). 3초마다 새 메시지를 확인한다.
/// 실서버는 아직 경로가 없어 "준비 중" 안내와 문의 남기기로 이어 준다.
class LiveChatScreen extends ConsumerStatefulWidget {
  const LiveChatScreen({super.key});

  @override
  ConsumerState<LiveChatScreen> createState() => _LiveChatScreenState();
}

class _LiveChatScreenState extends ConsumerState<LiveChatScreen> {
  final _input = TextEditingController();
  Timer? _poll;
  List<SupportMessage> _messages = const [];
  bool _unavailable = false;
  bool _failed = false;
  bool _sending = false;

  /// 지원센터가 상담을 닫았다 — 다음 말은 새 상담.
  bool _closed = false;
  IdempotencyKey? _pendingKey;
  String? _pendingText;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
    _poll = Timer.periodic(const Duration(seconds: 3), (_) => _load());
  }

  @override
  void dispose() {
    _poll?.cancel();
    _input.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    // 닫힌 상담은 새로 보내기 전까지 다시 읽지 않는다(남은 말을 그대로 둔다).
    if (_closed) return;
    try {
      final list = await ref.read(liveChatRepositoryProvider).messages();
      if (mounted) {
        setState(() {
          _messages = list;
          _failed = false;
        });
      }
    } on LiveChatClosed catch (c) {
      if (mounted) {
        setState(() {
          if (c.messages.isNotEmpty) _messages = c.messages;
          _closed = true;
          _failed = false;
        });
      }
    } on SupportThreadUnavailable {
      _poll?.cancel();
      if (mounted) setState(() => _unavailable = true);
    } on PmartFailure {
      if (mounted) setState(() => _failed = true);
    }
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || _sending) return;
    // 보내지 못한 같은 글은 같은 키로 다시 보낸다.
    final key = text == _pendingText && _pendingKey != null
        ? _pendingKey!
        : IdempotencyKey.generate();
    _pendingKey = key;
    _pendingText = text;
    setState(() => _sending = true);
    try {
      await ref.read(liveChatRepositoryProvider).send(text, key: key);
      _pendingKey = null;
      _pendingText = null;
      _input.clear();
      // 닫힌 뒤 보낸 말은 새 상담이다 — 지난 말을 비우고 다시 읽는다.
      if (_closed) {
        setState(() {
          _closed = false;
          _messages = const [];
        });
      }
      await _load();
    } on LiveChatClosed {
      // 보내는 사이 닫혔다 — 같은 글을 다시 보내면 새 상담으로 간다(새 키).
      _pendingKey = null;
      if (mounted) setState(() => _closed = true);
    } on SupportThreadUnavailable {
      if (mounted) setState(() => _unavailable = true);
    } on PmartFailure {
      if (mounted) setState(() => _failed = true);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      backgroundColor: RiderColors.gap,
      appBar: riderDarkBar(context, title: l10n.liveChatTitle),
      body: _unavailable
          ? Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                key: const ValueKey('live-chat-unavailable'),
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(
                    Icons.support_agent,
                    size: 48,
                    color: RiderColors.sub,
                  ),
                  const SizedBox(height: 12),
                  Text(
                    l10n.liveChatUnavailable,
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 15, height: 1.5),
                  ),
                  const SizedBox(height: 16),
                  RiderButton(
                    label: l10n.inqNew,
                    onPressed: () =>
                        context.pushReplacement('/my/inquiries/new'),
                  ),
                ],
              ),
            )
          : Column(
              children: [
                Expanded(
                  child: ListView(
                    key: const ValueKey('live-chat-messages'),
                    reverse: true,
                    padding: const EdgeInsets.all(12),
                    children: [
                      for (final m in _messages.reversed) _Bubble(message: m),
                      if (_messages.isEmpty)
                        Padding(
                          padding: const EdgeInsets.all(24),
                          child: Text(
                            l10n.liveChatIntro,
                            key: const ValueKey('live-chat-connecting'),
                            textAlign: TextAlign.center,
                            style: const TextStyle(color: RiderColors.sub),
                          ),
                        ),
                    ],
                  ),
                ),
                if (_closed)
                  Padding(
                    padding: const EdgeInsets.all(8),
                    child: Text(
                      l10n.liveChatClosed,
                      key: const ValueKey('live-chat-closed'),
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: RiderColors.sub),
                    ),
                  ),
                if (_failed)
                  Padding(
                    padding: const EdgeInsets.all(8),
                    child: Text(
                      l10n.liveChatFailed,
                      style: const TextStyle(color: RiderColors.danger),
                    ),
                  ),
                SafeArea(
                  top: false,
                  child: Container(
                    color: Colors.white,
                    padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
                    child: Row(
                      children: [
                        Expanded(
                          child: TextField(
                            key: const ValueKey('live-chat-input'),
                            controller: _input,
                            maxLength: 1000,
                            minLines: 1,
                            maxLines: 4,
                            decoration: InputDecoration(
                              hintText: l10n.liveChatHint,
                              counterText: '',
                              border: const OutlineInputBorder(),
                              isDense: true,
                            ),
                          ),
                        ),
                        IconButton(
                          key: const ValueKey('live-chat-send'),
                          onPressed: _sending ? null : _send,
                          icon: const Icon(
                            Icons.send,
                            color: RiderColors.primary,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message});

  final SupportMessage message;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final mine = message.sender == SupportSender.rider;
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Column(
        crossAxisAlignment: mine
            ? CrossAxisAlignment.end
            : CrossAxisAlignment.start,
        children: [
          if (!mine)
            Padding(
              padding: const EdgeInsets.only(left: 4, bottom: 2),
              child: Text(
                l10n.supportCenter,
                style: const TextStyle(fontSize: 12, color: RiderColors.sub),
              ),
            ),
          Container(
            key: ValueKey('live-msg-${message.id}'),
            margin: const EdgeInsets.only(bottom: 4),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
            constraints: const BoxConstraints(maxWidth: 280),
            decoration: BoxDecoration(
              color: mine ? RiderColors.primary : Colors.white,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(
              message.text,
              style: TextStyle(
                fontSize: 15,
                height: 1.4,
                color: mine ? Colors.white : RiderColors.ink,
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(bottom: 8, left: 4, right: 4),
            child: Text(
              clockText(message.at),
              style: const TextStyle(fontSize: 11, color: RiderColors.hint),
            ),
          ),
        ],
      ),
    );
  }
}
