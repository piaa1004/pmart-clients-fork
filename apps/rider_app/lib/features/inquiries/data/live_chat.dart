import 'package:dio/dio.dart';
import 'package:flutter/widgets.dart' show Locale;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_api_case/pmart_api_case.dart' as cs;
import 'package:pmart_core/pmart_core.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/providers.dart';
import '../../delivery/domain/delivery.dart' show SupportMessage, SupportSender;

/// 배송과 상관없는 실시간 채팅 상담(마이페이지 → 지원센터 문의 → 실시간 채팅 상담, 사용자 요청 2026-11-17).
///
/// 실서버는 "문의 한 건 = 대화방"(case 0.21.0, 백엔드 회신 2026-11-17 §2): 첫 말이 문의(`POST /inquiries`,
/// 분류 기타)를 열고, 그 뒤는 `POST /inquiries/{id}/messages`, 새 말은 `GET …/messages?after=<seq>`.
/// 닫힌 문의에 쓰면 409 INQUIRY_CLOSED → [LiveChatClosed](다음 말은 새 문의로).
abstract interface class LiveChatRepository {
  /// 오래된 것부터.
  Future<List<SupportMessage>> messages();

  /// 같은 키 재전송은 같은 메시지다.
  Future<void> send(String text, {required IdempotencyKey key});
}

/// 지원센터가 상담(문의)을 닫았다 — 다음 말은 새 상담으로 시작한다.
final class LiveChatClosed implements Exception {
  const LiveChatClosed([this.messages = const []]);

  /// 닫히기 전까지 오간 말(화면에 남겨 둔다).
  final List<SupportMessage> messages;
}

final class ApiLiveChatRepository implements LiveChatRepository {
  ApiLiveChatRepository(Dio dio, {required this.title})
    : _api = cs.PmartApiCase(dio: dio).getInquiriesApi();

  final cs.InquiriesApi _api;

  /// 새 상담(문의)의 제목.
  final String title;

  String? _inquiryId;
  SupportMessage? _first;
  final _items = <SupportMessage>[];
  int? _after;

  @override
  Future<List<SupportMessage>> messages() async {
    final id = _inquiryId;
    if (id == null) return const [];
    final res = await pmartGuard(
      () => _api.listInquiryMessages(inquiryId: id, after: _after),
    );
    final body = res.data;
    for (final m in body?.items ?? const <cs.InquiryMessage>[]) {
      if (_items.any((x) => x.id == m.messageId)) continue;
      _items.add(
        SupportMessage(
          id: m.messageId,
          sender: m.senderType == cs.InquiryMessageSenderTypeEnum.RIDER
              ? SupportSender.rider
              : SupportSender.agent,
          text: m.body,
          at: m.createdAt,
        ),
      );
      _after = m.seq;
    }
    final list = [?_first, ..._items];
    if (body?.status.value == 'CLOSED') {
      _reset();
      throw LiveChatClosed(list);
    }
    return list;
  }

  void _reset() {
    _inquiryId = null;
    _first = null;
    _items.clear();
    _after = null;
  }

  @override
  Future<void> send(String text, {required IdempotencyKey key}) async {
    final id = _inquiryId;
    if (id == null) {
      // 첫 말 = 새 문의(처음 내용은 문의 본문 — 메시지 목록에는 없다).
      final res = await pmartGuard(
        () => _api.createInquiry(
          idempotencyKey: key.value,
          xSourceSystem: sourceSystem,
          createInquiryRequest: cs.CreateInquiryRequest(
            category: cs.InquiryCategory.OTHER,
            title: title,
            body: text,
          ),
          extra: commandOptions(key).extra,
        ),
      );
      final i =
          res.data ?? (throw const ContractViolationFailure('Inquiry 본문 없음'));
      _inquiryId = i.inquiryId;
      _first = SupportMessage(
        id: 'inquiry-${i.inquiryId}',
        sender: SupportSender.rider,
        text: i.body,
        at: i.createdAt,
      );
      return;
    }
    try {
      await pmartGuard(
        () => _api.postInquiryMessage(
          inquiryId: id,
          idempotencyKey: key.value,
          xSourceSystem: sourceSystem,
          postInquiryMessageRequest: cs.PostInquiryMessageRequest(body: text),
          extra: commandOptions(key).extra,
        ),
      );
    } on ProblemFailure catch (f) {
      if (f.problem.code == 'INQUIRY_CLOSED') {
        _reset();
        throw const LiveChatClosed();
      }
      rethrow;
    }
  }
}

/// 목: 처음 열면 [greetAfter] 뒤 상담원 인사, 라이더가 말하면 [replyAfter] 뒤 답장.
final class MockLiveChatRepository implements LiveChatRepository {
  MockLiveChatRepository({DateTime Function()? clock})
    : clock = clock ?? DateTime.now;

  final DateTime Function() clock;
  static const greetAfter = Duration(seconds: 3);
  static const replyAfter = Duration(seconds: 4);

  DateTime? _openedAt;
  final _items = <SupportMessage>[];
  final _keys = <String>{};
  int _answered = 0;
  int _seq = 0;

  SupportMessage _msg(SupportSender s, String text, DateTime at) =>
      SupportMessage(id: 'live-${++_seq}', sender: s, text: text, at: at);

  void _advance() {
    final now = clock();
    final opened = _openedAt ??= now;
    if (_items.every((m) => m.sender != SupportSender.agent) &&
        now.difference(opened) >= greetAfter) {
      _items.add(
        _msg(
          SupportSender.agent,
          '안녕하세요, PMart 지원센터 실시간 상담입니다. 무엇을 도와드릴까요?',
          opened.add(greetAfter),
        ),
      );
    }
    final rider = _items.where((m) => m.sender == SupportSender.rider).toList();
    if (rider.length > _answered) {
      final last = rider.last;
      if (now.difference(last.at) >= replyAfter) {
        _answered = rider.length;
        _items.add(
          _msg(
            SupportSender.agent,
            _answered == 1
                ? '확인해 볼게요. 잠시만 기다려 주세요.'
                : '안내드린 내용으로 처리했어요. 더 궁금한 점 있으세요?',
            last.at.add(replyAfter),
          ),
        );
      }
    }
  }

  @override
  Future<List<SupportMessage>> messages() async {
    await Future<void>.delayed(Duration.zero);
    _advance();
    return List.unmodifiable(_items);
  }

  @override
  Future<void> send(String text, {required IdempotencyKey key}) async {
    await Future<void>.delayed(Duration.zero);
    if (!_keys.add(key.value)) return;
    _advance();
    _items.add(_msg(SupportSender.rider, text, clock()));
  }
}

final _mockLiveChat = Provider<MockLiveChatRepository>(
  (_) => MockLiveChatRepository(),
);

final liveChatRepositoryProvider = Provider<LiveChatRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => ref.watch(_mockLiveChat),
    PmartEnv.local => ApiLiveChatRepository(
      ref.watch(dioProvider),
      title: lookupAppLocalizations(const Locale('ko')).liveChatTitle,
    ),
  },
);
