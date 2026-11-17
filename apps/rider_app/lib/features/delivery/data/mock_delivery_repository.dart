import 'package:dio/dio.dart';
import 'package:pmart_api_delivery_execution/pmart_api_delivery_execution.dart'
    as ex;
import 'package:pmart_core/pmart_core.dart';

import '../domain/delivery.dart';
import 'delivery_repository.dart';
import 'trip_repository.dart' show mockDropInfo, mockTrip;

/// 인계 커밋 응답 시연.
enum MockCommit { applied, unknownButApplied, unknownStillInProgress }

/// 목 구현. 배송 dlv-1(포장 2개)의 가게 도착 → 포장별 QR 인계 → 픽업 → 고객 도착 → 전달 완료를 흉내 낸다.
/// 인계는 fence(승인) → 커밋 두 단계이고, 커밋이 끝난 포장만 인계 완료다.
base class MockDeliveryRepository
    implements
        DeliveryRepository,
        HandoverRepository,
        EvidenceUploader,
        AssignmentCancelRepository,
        SupportThreadRepository {
  /// [seeded] 가 false 면 진행 중 배송 없이 시작한다(제안 화면 테스트용).
  /// [clock] 은 지원센터 진행(시간 기준)을 시험에서 움직이려고 바꾼다.
  MockDeliveryRepository({
    this.latency = const Duration(milliseconds: 300),
    bool seeded = true,
    this.visible,
    bool demoBundle = false,
    DateTime Function()? clock,
  }) : clock = clock ?? DateTime.now {
    if (!seeded) _deliveries.clear();
    if (demoBundle) {
      // 묶음 제안 2건(dlv-b1·b2)과 배달리스트 대기 2건(dlv-l1·l2).
      for (final (id, pkg) in [
        ('b1', 'pkg-3'),
        ('b2', 'pkg-4'),
        ('l1', 'pkg-5'),
        ('l2', 'pkg-6'),
      ]) {
        final n = id;
        _deliveries['dlv-$n'] = {
          'deliveryId': 'dlv-$n',
          'version': 1,
          'type': 'FORWARD',
          'orderId': mockTrip('dlv-$n').orderNo,
          'riderId': riderId,
          'mfcId': 'MFC-BSJ-01',
          'state': 'ASSIGNED',
          'packageIds': [pkg],
          'handoverIds': <String>[],
        };
        _packages[pkg] = {'state': 'SEALED'};
      }
    }
  }

  final Duration latency;
  final DateTime Function() clock;

  /// 진행 목록에 보일지(앱 목 모드: 제안을 수락한 배송만 보인다). null 이면 전부 보인다.
  final bool Function(String deliveryId)? visible;
  static const riderId = 'rider-mock-1';

  /// MFC 포장 라벨 QR 형식(BR-23).
  static String qrFor(String packageId, {int version = 1}) =>
      'PKG:$packageId:$version';

  /// 목 포장 라벨에 QR 과 함께 찍힌 숫자(스캔이 안 될 때 입력). 계약에 아직 없다(백엔드 요청 중).
  static const labelNumbers = <String, String>{
    'pkg-1': '1001',
    'pkg-2': '1002',
    'pkg-3': '1003',
    'pkg-4': '1004',
    'pkg-5': '1005',
    'pkg-6': '1006',
    'pkg-x': '1099',
  };

  /// 라벨 숫자 → QR 원문. 모르는 숫자는 null.
  static String? qrForLabelNumber(String digits) {
    final pkg = labelNumbers.entries
        .where((e) => e.value == digits.trim())
        .firstOrNull
        ?.key;
    return pkg == null ? null : qrFor(pkg);
  }

  final _deliveries = <String, Map<String, Object?>>{
    'dlv-1': {
      'deliveryId': 'dlv-1',
      'version': 1,
      'type': 'FORWARD',
      'orderId': '48213075',
      'riderId': riderId,
      'mfcId': 'MFC-BSJ-01',
      'state': 'ASSIGNED',
      'packageIds': ['pkg-1', 'pkg-2'],
      'handoverIds': <String>[],
    },
  };

  /// packageId → {state: SEALED|HANDED_OVER, fence: auth id?, handoverId?}
  final _packages = <String, Map<String, Object?>>{
    'pkg-1': {'state': 'SEALED'},
    'pkg-2': {'state': 'SEALED'},
    'pkg-x': {'state': 'SEALED', 'otherDelivery': true},
  };
  final _results = <String, HandoverStep>{};
  final _sent = <String>{};
  int _seq = 0;
  int _photo = 0;

  MockCommit commitMode = MockCommit.applied;

  /// 재포장으로 무효가 된 라벨(구 버전 QR).
  final invalidatedQrs = <String>{};

  /// 연결이 끊긴 상태(수행 명령이 서버에 닿지 않는다).
  bool offline = false;

  /// 다음 사진 업로드를 실패시킨다.
  bool uploadFails = false;

  /// 주문 취소로 출고가 중지된 포장.
  final stoppedPackages = <String>{};

  final sentKeys = <String>[];
  final commitKeys = <String>[];

  Future<void> _wait() => Future<void>.delayed(latency);

  Map<String, Object?> deliveryJson(String id) => _deliveries[id]!;

  @override
  Future<DeliveryView> get(String deliveryId) async {
    await _wait();
    final d = _deliveries[deliveryId];
    if (d == null) {
      throw const ProblemFailure(
        Problem(status: 404, code: ProblemCode.notFound),
      );
    }
    return deliveryFromContract(ex.DeliveryExecution.fromJson(d));
  }

  @override
  Future<List<DeliveryView>> myActive() async {
    await _wait();
    return [
          for (final d in _deliveries.values)
            deliveryFromContract(ex.DeliveryExecution.fromJson(d)),
        ]
        .where((d) => isActive(d.state))
        .where((d) => visible?.call(d.deliveryId) ?? true)
        .toList();
  }

  /// 전달지(가짜 값). 실제처럼 픽업 뒤 ~ 전달 완료 전에만 준다.
  @override
  Future<DropInfo> dropInfo(String deliveryId) async {
    await _wait();
    final state = _deliveries[deliveryId]?['state'];
    if (state != 'PICKED_UP' &&
        state != 'ARRIVED_AT_CUSTOMER' &&
        state != 'FAILURE_REPORTED') {
      throw const DropInfoUnavailableFailure(DropInfoUnavailable.closed);
    }
    return mockDropInfo(deliveryId);
  }

  // ---------------------------------------------------------------- 인계

  @override
  Future<HandoverStep> authorize(
    String packageId, {
    required String riderId,
    required String deliveryId,
    required String scannedCode,
    required IdempotencyKey key,
  }) async {
    await _wait();
    final previous = _results[key.value];
    if (previous != null) return previous;
    final p = _packages[packageId];
    final delivery = _deliveries[deliveryId]!;
    final HandoverStep step;
    if (p == null) {
      step = const HandoverRejected(ProblemCode.notFound);
    } else if (invalidatedQrs.contains(scannedCode)) {
      step = const HandoverRejected(HandoverProblemCode.packageInvalidated);
    } else if (!(delivery['packageIds']! as List).contains(packageId)) {
      step = const HandoverRejected(HandoverProblemCode.deliveryMismatch);
    } else if (p['state'] == 'HANDED_OVER') {
      step = const HandoverRejected(HandoverProblemCode.alreadyHandedOver);
    } else if (stoppedPackages.contains(packageId)) {
      step = const HandoverRejected('INVALID_STATE');
    } else {
      final auth = 'hoa-${++_seq}';
      p['fence'] = auth;
      step = HandoverAuthorized(authorizationId: auth, fenceVersion: 1);
    }
    _results[key.value] = step;
    return step;
  }

  @override
  Future<HandoverStep> commit(
    String packageId, {
    required String authorizationId,
    required int fenceVersion,
    required String riderId,
    required IdempotencyKey key,
  }) async {
    await _wait();
    commitKeys.add(key.value);
    final previous = _results[key.value];
    if (previous != null) return previous;
    final p = _packages[packageId]!;
    if (p['fence'] != authorizationId) {
      return const HandoverRejected('FENCE_VERSION_MISMATCH');
    }
    if (commitMode == MockCommit.unknownStillInProgress) {
      // 재고 응답 불명: fence 유지, 결과 모름.
      return const HandoverUnknown();
    }
    final handoverId = 'hof-$packageId';
    p
      ..['state'] = 'HANDED_OVER'
      ..['handoverId'] = handoverId
      ..remove('fence');
    final step = HandoverCommitted(handoverId);
    _results[key.value] = step;
    if (commitMode == MockCommit.unknownButApplied) {
      commitMode = MockCommit.applied;
      return const HandoverUnknown();
    }
    return step;
  }

  /// 불명이던 커밋을 서버가 나중에 확정했다.
  void settleInProgress() {
    for (final e in _packages.entries) {
      if (e.value['fence'] != null) {
        e.value
          ..['state'] = 'HANDED_OVER'
          ..['handoverId'] = 'hof-${e.key}'
          ..remove('fence');
      }
    }
    commitMode = MockCommit.applied;
  }

  @override
  Future<HandoverResolutionView> resolution(String packageId) async {
    await _wait();
    final p = _packages[packageId]!;
    if (stoppedPackages.contains(packageId)) {
      return const HandoverResolutionView(verdict: HandoverVerdict.stopped);
    }
    if (p['state'] == 'HANDED_OVER') {
      return HandoverResolutionView(
        verdict: HandoverVerdict.handedOver,
        handoverId: p['handoverId'] as String?,
      );
    }
    if (p['fence'] != null) {
      return const HandoverResolutionView(verdict: HandoverVerdict.inProgress);
    }
    return const HandoverResolutionView(verdict: HandoverVerdict.unknown);
  }

  // ---------------------------------------------------------------- 수행 명령

  @override
  Future<SendResult> send(QueueItem item) async {
    await _wait();
    sentKeys.add(item.id);
    if (offline) {
      return transitionFailureToSend(
        const UnknownResultFailure(transport: DioExceptionType.connectionError),
      );
    }
    if (_sent.contains(item.id)) return const SendAccepted();
    final d = _deliveries[item.targetId]!;
    String? reject;
    String? next;
    switch (item.kind) {
      case DeliveryCommandKind.storeArrival:
        next = d['state'] == 'ASSIGNED' ? 'ARRIVED_AT_STORE' : null;
      case DeliveryCommandKind.pickup:
        final ids = (item.payload['handoverIds']! as List)
            .cast<String>()
            .toSet();
        final need = {
          for (final pid in (d['packageIds']! as List).cast<String>())
            _packages[pid]?['handoverId'],
        };
        if (need.contains(null) || !ids.containsAll(need)) {
          reject = HandoverProblemCode.handoverNotConfirmed;
        } else {
          next = 'PICKED_UP';
          d['handoverIds'] = ids.toList();
        }
      case DeliveryCommandKind.customerArrival:
        next = d['state'] == 'PICKED_UP' ? 'ARRIVED_AT_CUSTOMER' : null;
      case DeliveryCommandKind.completion:
        final refs = (item.payload['photoRefs'] as List?) ?? const [];
        if (refs.isEmpty) {
          reject = HandoverProblemCode.evidenceRequired;
        } else {
          next = d['state'] == 'ARRIVED_AT_CUSTOMER' ? 'COMPLETED' : null;
        }
      case DeliveryCommandKind.failure:
        final refs = (item.payload['evidenceRefs'] as List?) ?? const [];
        final contacts = (item.payload['contactAttempts'] as List?) ?? const [];
        const customerReasons = {
          'CUSTOMER_ABSENT',
          'UNREACHABLE',
          'ADDRESS_ERROR',
          'REFUSED',
        };
        if (refs.isEmpty) {
          reject = HandoverProblemCode.evidenceRequired;
        } else if (customerReasons.contains(item.payload['reason']) &&
            contacts.length < 2) {
          reject = HandoverProblemCode.contactAttemptsRequired;
        } else if (d['state'] == 'PICKED_UP' ||
            d['state'] == 'ARRIVED_AT_CUSTOMER') {
          // 운영자 확정 전까지 진행 중(FAILURE_REPORTED). 반려되면 이 상태로 돌아간다.
          _beforeFailure[item.targetId] = d['state']! as String;
          next = 'FAILURE_REPORTED';
        }
    }
    if (reject != null) {
      return transitionFailureToSend(
        ProblemFailure(Problem(status: 422, code: reject)),
      );
    }
    if (next == null) {
      return transitionFailureToSend(
        const ProblemFailure(
          Problem(status: 409, code: ProblemCode.invalidState),
        ),
      );
    }
    _sent.add(item.id);
    d
      ..['state'] = next
      ..['version'] = (d['version']! as int) + 1;
    return const SendAccepted();
  }

  // ---------------------------------------------------------------- 배차취소

  final cancelKeys = <String>[];

  @override
  Future<CancelOutcome> cancel(
    String deliveryId, {
    required IdempotencyKey key,
  }) async {
    await _wait();
    cancelKeys.add(key.value);
    final d = _deliveries[deliveryId]!;
    if (d['state'] == 'CANCELLED') return CancelOutcome.accepted;
    // 픽업 뒤에는 배차취소가 아니라 지원센터 처리다.
    if (d['state'] != 'ASSIGNED' && d['state'] != 'ARRIVED_AT_STORE') {
      return CancelOutcome.pickedUpCaseRequired;
    }
    d
      ..['state'] = 'CANCELLED'
      ..['version'] = (d['version']! as int) + 1;
    return CancelOutcome.accepted;
  }

  // ---------------------------------------------------------------- 도움요청 · 지원센터 대화
  //
  // 목 진행(시간 기준, [clock]): 접수(OPEN) → [assignAfter] 뒤 상담원 배정(IN_PROGRESS, 접수번호,
  // 첫 인사) → 라이더가 말하면 [replyAfter] 뒤 답장 → 라이더 두 번째 말에 답한 뒤 처리 완료(RESOLVED).
  // 상담 대화는 계약에 없어 목에서만 있다(백엔드 요청 §11).

  static const assignAfter = Duration(seconds: 10);
  static const replyAfter = Duration(seconds: 4);

  /// 라이더가 대화에 이 말을 쓰면(고객과 다시 연락돼 전달할 수 있음) 상담원이 전달 불가를
  /// 반려한다(운영자 REJECT → 실패 등록 전 상태). 목 상담원 흉내다.
  static const resumeHint = '전달할 수 있어요';

  final _beforeFailure = <String, String>{};
  final _helpDelivery = <String, String>{};
  final _helpCategory = <String, HelpCategory>{};

  @override
  Future<List<HelpRecord>> helpRequests(String deliveryId) async {
    await _wait();
    return [
      for (final id in _helpAt.keys)
        if (_helpDelivery[id] == deliveryId)
          () {
            _advance(id);
            return (
              requestId: id,
              category: _helpCategory[id] ?? HelpCategory.other,
              detail: helpDetails[id],
              sentAt: _helpAt[id]!,
              state: _helpResolved.contains(id)
                  ? HelpState.resolved
                  : _helpCase.containsKey(id)
                  ? HelpState.inProgress
                  : HelpState.open,
              caseId: _helpCase[id],
            );
          }(),
    ];
  }

  final _helpAt = <String, DateTime>{};
  final _helpAnswered = <String, int>{};
  final _helpCase = <String, String>{};
  final _helpResolved = <String>{};
  final _threads = <String, List<SupportMessage>>{};
  final _threadKeys = <String>{};
  int _msgSeq = 0;

  /// 받은 도움요청 내용(시험 확인용).
  final helpDetails = <String, String?>{};

  /// 다음 도움요청 응답을 1회 잃는다(서버는 접수함).
  bool loseNextHelpResponse = false;

  @override
  Future<void> requestHelp(
    String deliveryId,
    HelpCategory category, {
    String? detail,
    List<String>? evidenceRefs,
    required IdempotencyKey key,
  }) async {
    await _wait();
    _helpAt.putIfAbsent(key.value, clock);
    _helpDelivery[key.value] = deliveryId;
    _helpCategory[key.value] = category;
    helpDetails[key.value] = detail;
    if (loseNextHelpResponse) {
      loseNextHelpResponse = false;
      throw UnknownResultFailure(requestId: key.value, httpStatus: 504);
    }
  }

  SupportMessage _msg(SupportSender sender, String text, DateTime at) =>
      SupportMessage(
        id: 'msg-${++_msgSeq}',
        sender: sender,
        text: text,
        at: at,
      );

  /// 시간이 지난 만큼 상담원 쪽 진행을 만든다.
  void _advance(String id) {
    final at = _helpAt[id];
    if (at == null) return;
    final now = clock();
    final thread = _threads.putIfAbsent(id, () => []);
    if (!_helpCase.containsKey(id) && now.difference(at) >= assignAfter) {
      _helpCase[id] = 'CS-${1001 + _helpCase.length}';
      thread.add(
        _msg(
          SupportSender.agent,
          '안녕하세요, PMart 지원센터입니다. 접수하신 건을 확인하고 있어요. '
          '상황을 조금 더 알려 주시겠어요?',
          at.add(assignAfter),
        ),
      );
    }
    // 아직 답하지 않은 라이더 메시지(상담원 배정 전에 쓴 것도 배정 뒤에 답한다).
    final riderMsgs = thread.where((m) => m.sender == SupportSender.rider);
    final riderSaid = riderMsgs.length;
    final last = riderMsgs.lastOrNull;
    final caseAt = at.add(assignAfter);
    final replyAt = last == null
        ? now
        : (last.at.isAfter(caseAt) ? last.at : caseAt).add(replyAfter);
    if (_helpCase.containsKey(id) &&
        !_helpResolved.contains(id) &&
        last != null &&
        riderSaid > (_helpAnswered[id] ?? 0) &&
        !now.isBefore(replyAt)) {
      _helpAnswered[id] = riderSaid;
      // 고객과 다시 연락돼 전달할 수 있다 → 전달 불가 반려(실패 등록 전 상태로).
      final deliveryId = _helpDelivery[id];
      final d = deliveryId == null ? null : _deliveries[deliveryId];
      if (last.text.contains(resumeHint) &&
          d != null &&
          d['state'] == 'FAILURE_REPORTED') {
        d
          ..['state'] =
              _beforeFailure.remove(deliveryId) ?? 'ARRIVED_AT_CUSTOMER'
          ..['version'] = (d['version']! as int) + 1;
        thread.add(
          _msg(
            SupportSender.agent,
            '확인했어요. 전달 불가를 반려했으니 고객에게 전달을 계속해 주세요.',
            replyAt,
          ),
        );
        return;
      }
      final reply = riderSaid >= 2
          ? '확인 후 처리했어요. 더 필요한 게 있으면 새 도움요청을 보내 주세요.'
          : '알려 주셔서 감사해요. 매장과 확인해서 바로 안내드릴게요.';
      thread.add(_msg(SupportSender.agent, reply, replyAt));
      if (riderSaid >= 2) _helpResolved.add(id);
    }
  }

  @override
  Future<HelpStatusView> helpStatus(
    String deliveryId,
    IdempotencyKey key,
  ) async {
    await _wait();
    final id = key.value;
    if (!_helpAt.containsKey(id)) {
      return (state: HelpState.unknown, caseId: null);
    }
    _advance(id);
    return (
      state: _helpResolved.contains(id)
          ? HelpState.resolved
          : _helpCase.containsKey(id)
          ? HelpState.inProgress
          : HelpState.open,
      caseId: _helpCase[id],
    );
  }

  @override
  Future<List<SupportMessage>> threadMessages(
    String deliveryId,
    String requestId,
  ) async {
    await _wait();
    _advance(requestId);
    return List.unmodifiable(_threads[requestId] ?? const []);
  }

  @override
  Future<void> sendMessage(
    String deliveryId,
    String requestId,
    String text, {
    required IdempotencyKey key,
  }) async {
    await _wait();
    // 같은 키 = 같은 메시지.
    if (!_threadKeys.add(key.value)) {
      return;
    }
    _advance(requestId);
    _threads
        .putIfAbsent(requestId, () => [])
        .add(_msg(SupportSender.rider, text, clock()));
  }

  // ---------------------------------------------------------------- 사진(BR-07)

  @override
  Future<String> upload(
    String deliveryId,
    LocalPhoto photo, {
    required IdempotencyKey key,
  }) async {
    await _wait();
    if (uploadFails) {
      uploadFails = false;
      throw const NetworkFailure(DioExceptionType.connectionTimeout);
    }
    return 'photo-${++_photo}';
  }
}
