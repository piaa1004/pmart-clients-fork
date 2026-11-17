import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_api_case/pmart_api_case.dart' as cs;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart';

/// 배송과 상관없는 라이더 문의 유형(case-service 가 라이더에게 받는 4가지 — 백엔드 회신 2026-11-16).
enum InquiryKind { settlement, account, appError, other }

enum InquiryState { received, answered, unknown }

@immutable
class InquiryReply {
  const InquiryReply({required this.body, required this.at});
  final String body;
  final DateTime? at;
}

/// 라이더 문의 한 건(지원센터 답변 포함).
@immutable
class RiderInquiry {
  const RiderInquiry({
    required this.id,
    required this.kind,
    required this.title,
    required this.body,
    required this.state,
    required this.createdAt,
    this.replies = const [],
  });

  final String id;
  final InquiryKind kind;
  final String title;
  final String body;
  final InquiryState state;
  final DateTime createdAt;
  final List<InquiryReply> replies;
}

/// `POST/GET /inquiries`(라이더 토큰 — 본인 것만). `orderId` 는 보내지 않는다(배송 건은 도움요청).
abstract interface class InquiryRepository {
  /// 최근 순.
  Future<List<RiderInquiry>> list();
  Future<RiderInquiry> get(String id);

  /// 같은 키 재전송은 같은 문의다.
  Future<RiderInquiry> create(
    InquiryKind kind, {
    required String title,
    required String body,
    required IdempotencyKey key,
  });
}

cs.InquiryCategory _toWire(InquiryKind k) => switch (k) {
  InquiryKind.settlement => cs.InquiryCategory.SETTLEMENT,
  InquiryKind.account => cs.InquiryCategory.ACCOUNT,
  InquiryKind.appError => cs.InquiryCategory.APP_ERROR,
  InquiryKind.other => cs.InquiryCategory.OTHER,
};

InquiryKind _fromWire(cs.InquiryCategory c) => switch (c) {
  cs.InquiryCategory.SETTLEMENT => InquiryKind.settlement,
  cs.InquiryCategory.ACCOUNT => InquiryKind.account,
  cs.InquiryCategory.APP_ERROR => InquiryKind.appError,
  _ => InquiryKind.other,
};

InquiryState _state(cs.InquiryStatus s) => switch (s.value) {
  'ANSWERED' || 'CLOSED' => InquiryState.answered,
  'RECEIVED' => InquiryState.received,
  _ => InquiryState.unknown,
};

/// 목록 한 줄(본문·답변 없음 — 상세에서 읽는다).
RiderInquiry inquirySummaryFromContract(cs.InquirySummary i) => RiderInquiry(
  id: i.inquiryId,
  kind: _fromWire(i.category),
  title: i.title ?? '',
  body: '',
  state: _state(i.status),
  createdAt: i.createdAt,
);

/// 계약 → 화면 모델. 지원센터 답변만 보인다(라이더 본인 글은 본문).
RiderInquiry inquiryFromContract(cs.Inquiry i) => RiderInquiry(
  id: i.inquiryId,
  kind: _fromWire(i.category),
  title: i.title ?? '',
  body: i.body,
  state: _state(i.status),
  createdAt: i.createdAt,
  replies: [
    // 라이더가 이어 쓴 줄(authorType RIDER, case 0.21.0)은 답변이 아니다 — 지원센터 답만.
    for (final r in i.replies)
      if (r.body != null &&
          r.authorType != cs.InquiryAllOfRepliesAuthorTypeEnum.RIDER)
        InquiryReply(body: r.body!, at: r.createdAt),
  ],
);

final class ApiInquiryRepository implements InquiryRepository {
  ApiInquiryRepository(Dio dio)
    : _api = cs.PmartApiCase(dio: dio).getInquiriesApi();

  final cs.InquiriesApi _api;

  @override
  Future<List<RiderInquiry>> list() async {
    final res = await pmartGuard(() => _api.listInquiries());
    return [
      for (final i in res.data?.items ?? const <cs.InquirySummary>[])
        inquirySummaryFromContract(i),
    ];
  }

  @override
  Future<RiderInquiry> get(String id) async {
    final res = await pmartGuard(() => _api.getInquiry(inquiryId: id));
    return inquiryFromContract(
      res.data ?? (throw const ContractViolationFailure('Inquiry 본문 없음')),
    );
  }

  @override
  Future<RiderInquiry> create(
    InquiryKind kind, {
    required String title,
    required String body,
    required IdempotencyKey key,
  }) async {
    final res = await pmartGuard(
      () => _api.createInquiry(
        idempotencyKey: key.value,
        xSourceSystem: sourceSystem,
        createInquiryRequest: cs.CreateInquiryRequest(
          category: _toWire(kind),
          title: title,
          body: body,
        ),
        extra: commandOptions(key).extra,
      ),
    );
    return inquiryFromContract(
      res.data ?? (throw const ContractViolationFailure('Inquiry 본문 없음')),
    );
  }
}

/// 목: 남긴 문의는 [answerAfter] 뒤 지원센터 답변이 달린다.
final class MockInquiryRepository implements InquiryRepository {
  MockInquiryRepository({
    this.latency = const Duration(milliseconds: 300),
    DateTime Function()? clock,
  }) : clock = clock ?? DateTime.now;

  final Duration latency;
  final DateTime Function() clock;
  static const answerAfter = Duration(seconds: 15);

  final _items = <RiderInquiry>[];
  final _byKey = <String, String>{};

  RiderInquiry _advance(RiderInquiry i) {
    if (i.state == InquiryState.received &&
        clock().difference(i.createdAt) >= answerAfter) {
      final answered = RiderInquiry(
        id: i.id,
        kind: i.kind,
        title: i.title,
        body: i.body,
        state: InquiryState.answered,
        createdAt: i.createdAt,
        replies: [
          InquiryReply(
            body: '안녕하세요, PMart 지원센터입니다. 확인해서 처리했어요. 더 궁금한 점은 다시 남겨 주세요.',
            at: i.createdAt.add(answerAfter),
          ),
        ],
      );
      _items[_items.indexWhere((x) => x.id == i.id)] = answered;
      return answered;
    }
    return i;
  }

  @override
  Future<List<RiderInquiry>> list() async {
    await Future<void>.delayed(latency);
    return [for (final i in _items.reversed) _advance(i)];
  }

  @override
  Future<RiderInquiry> get(String id) async {
    await Future<void>.delayed(latency);
    final i = _items.where((x) => x.id == id).firstOrNull;
    if (i == null) {
      throw const ProblemFailure(Problem(status: 404, code: 'NOT_FOUND'));
    }
    return _advance(i);
  }

  @override
  Future<RiderInquiry> create(
    InquiryKind kind, {
    required String title,
    required String body,
    required IdempotencyKey key,
  }) async {
    await Future<void>.delayed(latency);
    final existing = _byKey[key.value];
    if (existing != null) return get(existing);
    final i = RiderInquiry(
      id: 'inq-${_items.length + 1}',
      kind: kind,
      title: title,
      body: body,
      state: InquiryState.received,
      createdAt: clock(),
    );
    _items.add(i);
    _byKey[key.value] = i.id;
    return i;
  }
}

final _mockInquiries = Provider<MockInquiryRepository>(
  (_) => MockInquiryRepository(),
);

final inquiryRepositoryProvider = Provider<InquiryRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => ref.watch(_mockInquiries),
    PmartEnv.local => ApiInquiryRepository(ref.watch(dioProvider)),
  },
);

final inquiriesProvider = FutureProvider.autoDispose<List<RiderInquiry>>(
  (ref) => ref.watch(inquiryRepositoryProvider).list(),
);

final inquiryProvider = FutureProvider.autoDispose.family<RiderInquiry, String>(
  (ref, id) => ref.watch(inquiryRepositoryProvider).get(id),
);
