import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart';
import '../../offers/presentation/offer_controllers.dart'
    show mockOfferRepositoryProvider;
import '../data/delivery_repository.dart';
import '../data/mock_delivery_repository.dart';
import '../domain/delivery.dart';

/// 앱 목 모드: 제안을 수락한 배송만 진행 목록에 보인다.
final _mockDelivery = Provider<MockDeliveryRepository>(
  (ref) => MockDeliveryRepository(
    demoBundle: true,
    visible: (id) =>
        ref.read(mockOfferRepositoryProvider).assignedDeliveries.contains(id),
  ),
);

final deliveryRepositoryProvider = Provider<DeliveryRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => ref.watch(_mockDelivery),
    PmartEnv.local => ApiDeliveryRepository(ref.watch(dioProvider)),
  },
);

final handoverRepositoryProvider = Provider<HandoverRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => ref.watch(_mockDelivery),
    PmartEnv.local => ApiHandoverRepository(ref.watch(dioProvider)),
  },
);

final assignmentCancelRepositoryProvider = Provider<AssignmentCancelRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => ref.watch(_mockDelivery),
    PmartEnv.local => ApiAssignmentCancelRepository(ref.watch(dioProvider)),
  },
);

/// 지원센터 상담 대화. 실서버는 계약이 없어 "준비 중"(백엔드 요청 §11).
final supportThreadRepositoryProvider = Provider<SupportThreadRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => ref.watch(_mockDelivery),
    PmartEnv.local => ApiSupportThreadRepository(ref.watch(dioProvider)),
  },
);

final evidenceUploaderProvider = Provider<EvidenceUploader>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => ref.watch(_mockDelivery),
    PmartEnv.local => ApiEvidenceUploader(ref.watch(dioProvider)),
  },
);

/// 라이더 ID. BR-02(라이더 로그인) 전에는 목 라이더다.
final currentRiderIdProvider = Provider<String>(
  (_) => MockDeliveryRepository.riderId,
);

/// 현장 큐 저장소. 실서버는 기기 보안 저장소(앱이 꺼져도 남는다).
/// 목 모드는 메모리 — 목 배송 데이터가 실행마다 새로 시작하므로, 지난 실행의 명령이
/// 새 목 데이터에 다시 보내져 거절(INVALID_STATE)되지 않게 한다.
final fieldQueueStoreProvider = Provider<SecureKeyValueStore>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => MemoryKeyValueStore(),
    PmartEnv.local => ref.watch(secureStoreProvider),
  },
);

/// 라이더 현장 큐(수행 명령). 같은 키로 다시 보낸다.
final riderQueueProvider = Provider<FieldQueue>(
  (ref) => FieldQueue(ref.watch(fieldQueueStoreProvider), name: 'rider'),
);

final deliveryProvider = FutureProvider.autoDispose
    .family<DeliveryView, String>(
      (ref, id) => ref.watch(deliveryRepositoryProvider).get(id),
    );

final myActiveDeliveriesProvider =
    FutureProvider.autoDispose<List<DeliveryView>>(
      (ref) => ref.watch(deliveryRepositoryProvider).myActive(),
    );

/// 전달지(개인정보). autoDispose — 화면을 나가면 메모리에서 지운다.
final dropInfoProvider = FutureProvider.autoDispose.family<DropInfo, String>(
  (ref, id) => ref.watch(deliveryRepositoryProvider).dropInfo(id),
);

final deliveryQueueProvider = FutureProvider.autoDispose
    .family<List<QueueItem>, String>(
      (ref, id) async => [
        for (final i in await ref.watch(riderQueueProvider).items())
          if (i.targetId == id) i,
      ],
    );

@immutable
class DeliveryFlowState {
  const DeliveryFlowState({
    this.packages = const {},
    this.lastScan,
    this.lastRejectCode,
    this.photoRef,
    this.uploading = false,
    this.uploadFailed = false,
    this.contacts = const [],
    this.photo,
  });

  /// 마지막으로 찍은 사진(메모리에만 — 기사가 다시 찍기 전에 확인한다).
  final LocalPhoto? photo;

  final Map<String, PackageHandover> packages;
  final ScanVerdict? lastScan;
  final String? lastRejectCode;

  /// 업로드에 성공한 사진 참조. 이것이 있어야 전달 완료를 누를 수 있다.
  final String? photoRef;
  final bool uploading;
  final bool uploadFailed;

  /// 고객 연락 기록(전달 실패 등록에 쓴다).
  final List<ContactAttempt> contacts;

  PackageHandover phaseOf(String packageId) =>
      packages[packageId] ??
      PackageHandover(packageId: packageId, phase: HandoverPhase.waiting);

  List<String> get handoverIds => [
    for (final p in packages.values)
      if (p.phase == HandoverPhase.handedOver && p.handoverId != null)
        p.handoverId!,
  ];

  DeliveryFlowState copyWith({
    Map<String, PackageHandover>? packages,
    ScanVerdict? lastScan,
    String? Function()? lastRejectCode,
    String? photoRef,
    bool? uploading,
    bool? uploadFailed,
    List<ContactAttempt>? contacts,
    LocalPhoto? photo,
    bool clearPhotoRef = false,
  }) => DeliveryFlowState(
    photo: photo ?? this.photo,
    packages: packages ?? this.packages,
    lastScan: lastScan ?? this.lastScan,
    lastRejectCode: lastRejectCode != null
        ? lastRejectCode()
        : this.lastRejectCode,
    photoRef: clearPhotoRef ? null : (photoRef ?? this.photoRef),
    uploading: uploading ?? this.uploading,
    uploadFailed: uploadFailed ?? this.uploadFailed,
    contacts: contacts ?? this.contacts,
  );
}

final deliveryFlowProvider = NotifierProvider.autoDispose
    .family<DeliveryFlowController, DeliveryFlowState, String>(
      DeliveryFlowController.new,
    );

class DeliveryFlowController extends Notifier<DeliveryFlowState> {
  DeliveryFlowController(this.deliveryId);

  final String deliveryId;

  /// 포장별 승인·커밋 키. 결과가 확정될 때까지 같은 키로만 다시 보낸다.
  final _authKeys = <String, IdempotencyKey>{};
  final _commitKeys = <String, IdempotencyKey>{};
  final _auths = <String, HandoverAuthorized>{};

  @override
  DeliveryFlowState build() => const DeliveryFlowState();

  HandoverRepository get _handovers => ref.read(handoverRepositoryProvider);

  void _setPhase(
    String pkg,
    HandoverPhase phase, {
    String? handoverId,
    String? code,
  }) {
    if (!ref.mounted) return;
    state = state.copyWith(
      packages: {
        ...state.packages,
        pkg: PackageHandover(
          packageId: pkg,
          phase: phase,
          handoverId: handoverId,
          rejectCode: code,
        ),
      },
    );
  }

  /// 재진입 시 포장마다 서버 판정을 조회해 화면을 맞춘다.
  Future<void> hydrate(DeliveryView d) async {
    for (final pkg in d.packageIds) {
      if (state.packages.containsKey(pkg)) continue;
      await resolve(pkg, fromHydrate: true);
    }
  }

  /// 포장 QR 스캔. 다른 배송·중복·읽기 실패는 서버에 보내기 전에 막고 사유를 보인다.
  Future<ScanVerdict> scan(DeliveryView d, String code) async {
    final pkg = packageIdFromQr(code);
    final ScanVerdict verdict;
    if (pkg == null) {
      verdict = ScanVerdict.unreadable;
    } else if (!d.packageIds.contains(pkg)) {
      verdict = ScanVerdict.otherDelivery;
    } else if (state.phaseOf(pkg).phase != HandoverPhase.waiting &&
        state.phaseOf(pkg).phase != HandoverPhase.rejected) {
      // 진행 중·확인 중·완료인 포장을 다시 찍어 새 인계를 만들지 않는다.
      verdict = ScanVerdict.duplicate;
    } else {
      verdict = ScanVerdict.accepted;
    }
    state = state.copyWith(lastScan: verdict, lastRejectCode: () => null);
    if (verdict == ScanVerdict.accepted) await _handover(d, pkg!, code.trim());
    return verdict;
  }

  Future<void> _handover(DeliveryView d, String pkg, String code) async {
    final rider = ref.read(currentRiderIdProvider);
    _setPhase(pkg, HandoverPhase.authorizing);
    final authKey = _authKeys[pkg] ??= IdempotencyKey.generate();
    HandoverStep step = const HandoverUnknown();
    for (var i = 0; i < 3 && step is HandoverUnknown; i++) {
      step = await _handovers.authorize(
        pkg,
        riderId: rider,
        deliveryId: d.deliveryId,
        scannedCode: code,
        key: authKey,
      );
    }
    switch (step) {
      case HandoverAuthorized():
        _auths[pkg] = step;
      case HandoverRejected(:final code):
        _authKeys.remove(pkg);
        _setPhase(pkg, HandoverPhase.rejected, code: code);
        if (ref.mounted) state = state.copyWith(lastRejectCode: () => code);
        return;
      default:
        // 승인 여부를 모른다. 판정 조회로 확인한다.
        _setPhase(pkg, HandoverPhase.checking);
        await resolve(pkg);
        return;
    }
    await _commit(pkg);
  }

  Future<void> _commit(String pkg) async {
    final auth = _auths[pkg];
    if (auth == null) return;
    _setPhase(pkg, HandoverPhase.committing);
    final key = _commitKeys[pkg] ??= IdempotencyKey.generate();
    HandoverStep step = const HandoverUnknown();
    for (var i = 0; i < 3 && step is HandoverUnknown; i++) {
      step = await _handovers.commit(
        pkg,
        authorizationId: auth.authorizationId,
        fenceVersion: auth.fenceVersion,
        riderId: ref.read(currentRiderIdProvider),
        key: key,
      );
    }
    switch (step) {
      case HandoverCommitted(:final handoverId):
        _setPhase(pkg, HandoverPhase.handedOver, handoverId: handoverId);
      case HandoverRejected(:final code):
        _setPhase(pkg, HandoverPhase.rejected, code: code);
        if (ref.mounted) state = state.copyWith(lastRejectCode: () => code);
      default:
        _setPhase(pkg, HandoverPhase.checking);
        await resolve(pkg);
    }
  }

  /// 인계 판정 조회(`handover-resolution`). 시간이 지났다고 원상복구하지 않는다.
  Future<void> resolve(String pkg, {bool fromHydrate = false}) async {
    try {
      final r = await _handovers.resolution(pkg);
      switch (r.verdict) {
        case HandoverVerdict.handedOver:
          _setPhase(pkg, HandoverPhase.handedOver, handoverId: r.handoverId);
        case HandoverVerdict.stopped:
          _setPhase(pkg, HandoverPhase.stopped);
        case HandoverVerdict.inProgress:
          _setPhase(pkg, HandoverPhase.checking);
        case HandoverVerdict.unknown:
          if (!fromHydrate) _setPhase(pkg, HandoverPhase.checking);
      }
    } on PmartFailure {
      if (!fromHydrate) _setPhase(pkg, HandoverPhase.checking);
    }
  }

  /// "다시 확인": 먼저 판정을 조회하고, 아직 진행 중이면 같은 키로 커밋을 다시 보낸다(새 인계를 만들지 않는다).
  Future<void> checkAgain(String pkg) async {
    await resolve(pkg);
    if (state.phaseOf(pkg).phase == HandoverPhase.checking &&
        _auths.containsKey(pkg) &&
        _commitKeys.containsKey(pkg)) {
      await _commit(pkg);
    }
  }

  // -------------------------------------------------------------- 수행 명령

  Future<void> _send(String kind, Map<String, Object?> payload) async {
    final queue = ref.read(riderQueueProvider);
    await queue.enqueue(
      kind: kind,
      targetId: deliveryId,
      payload: {
        'occurredAt': DateTime.now().toUtc().toIso8601String(),
        ...payload,
      },
    );
    await sync();
  }

  /// 전송 대기·확인 중을 같은 키로 보내고, 접수분은 배송 상태로 확정을 확인한다.
  Future<void> sync() async {
    final repo = ref.read(deliveryRepositoryProvider);
    final queue = ref.read(riderQueueProvider);
    await queue.flush(repo.send);
    await queue.confirm((item) async {
      try {
        final d = await repo.get(item.targetId);
        return _reached(item.kind, d.state)
            ? ConfirmResult.applied
            : ConfirmResult.pending;
      } on PmartFailure {
        return ConfirmResult.unknown;
      }
    });
    if (!ref.mounted) return;
    ref
      ..invalidate(deliveryProvider(deliveryId))
      ..invalidate(deliveryQueueProvider(deliveryId));
  }

  static bool _reached(String kind, ExecutionState s) {
    const order = [
      ExecutionState.assigned,
      ExecutionState.arrivedAtStore,
      ExecutionState.pickedUp,
      ExecutionState.arrivedAtCustomer,
      ExecutionState.completed,
    ];
    final target = switch (kind) {
      DeliveryCommandKind.storeArrival => ExecutionState.arrivedAtStore,
      DeliveryCommandKind.pickup => ExecutionState.pickedUp,
      DeliveryCommandKind.customerArrival => ExecutionState.arrivedAtCustomer,
      DeliveryCommandKind.completion => ExecutionState.completed,
      _ => ExecutionState.failureReported,
    };
    if (target == ExecutionState.failureReported) {
      return s == ExecutionState.failureReported || s == ExecutionState.failed;
    }
    final i = order.indexOf(s);
    return i >= 0 && i >= order.indexOf(target);
  }

  Future<void> arriveAtStore() =>
      _send(DeliveryCommandKind.storeArrival, const {});

  /// 픽업 완료는 서버가 확정한 인계(handoverIds)가 있어야 한다.
  Future<void> pickup() =>
      _send(DeliveryCommandKind.pickup, {'handoverIds': state.handoverIds});

  Future<void> arriveAtCustomer() =>
      _send(DeliveryCommandKind.customerArrival, const {});

  /// 사진 올리기 키. 같은 사진을 다시 올릴 때만 같은 키다(새로 찍으면 새 키).
  IdempotencyKey? _photoKey;
  LocalPhoto? _photo;

  /// 증빙 사진 올리기. 성공해야 전달 완료·전달 실패를 보낼 수 있다.
  /// [photo] 가 null 이면 마지막으로 찍은 사진을 같은 키로 다시 올린다.
  Future<void> uploadPhoto([LocalPhoto? photo]) async {
    if (photo != null) {
      _photo = photo;
      _photoKey = IdempotencyKey.generate();
    }
    final current = _photo ?? (bytes: Uint8List(0), filename: 'evidence.jpg');
    final key = _photoKey ??= IdempotencyKey.generate();
    // 새로 찍었으면 이전 사진 참조는 더 쓰지 않는다(미리보기와 올린 사진이 달라지지 않게).
    state = state.copyWith(
      uploading: true,
      uploadFailed: false,
      photo: photo,
      clearPhotoRef: photo != null,
    );
    try {
      final ref0 = await ref
          .read(evidenceUploaderProvider)
          .upload(deliveryId, current, key: key);
      if (ref.mounted) state = state.copyWith(uploading: false, photoRef: ref0);
    } on PmartFailure {
      if (ref.mounted) {
        state = state.copyWith(uploading: false, uploadFailed: true);
      }
    }
  }

  /// 고객 연락 한 번을 기록한다(전화를 걸고 결과를 고른다).
  void recordContact({required bool answered}) {
    state = state.copyWith(
      contacts: [
        ...state.contacts,
        ContactAttempt(attemptedAt: DateTime.now().toUtc(), answered: answered),
      ],
    );
  }

  Future<void> complete(CompletionMethod method, Placement placement) {
    final photo = state.photoRef;
    if (photo == null) return Future.value();
    return _send(DeliveryCommandKind.completion, {
      'method': method == CompletionMethod.face ? 'FACE' : 'CONTACTLESS',
      'photoRefs': [photo],
      'takenAt': DateTime.now().toUtc().toIso8601String(),
      'placement': switch (placement) {
        Placement.handedToCustomer => 'HANDED_TO_CUSTOMER',
        Placement.frontDoor => 'FRONT_DOOR',
        Placement.securityOffice => 'SECURITY_OFFICE',
        Placement.deliveryBox => 'DELIVERY_BOX',
        Placement.other => 'OTHER',
      },
    });
  }

  /// 전달 실패 알리기. 사진과(고객 사유면) 연락 기록 2회 이상이 필요하다 — 서버가 최종 판정한다.
  /// 운영자가 확정하기 전까지 배송은 진행 중(FAILURE_REPORTED)이다.
  Future<void> reportFailure(FailureReason reason, {String? detail}) =>
      _send(DeliveryCommandKind.failure, {
        'reason': switch (reason) {
          FailureReason.customerAbsent => 'CUSTOMER_ABSENT',
          FailureReason.addressError => 'ADDRESS_ERROR',
          FailureReason.unreachable => 'UNREACHABLE',
          FailureReason.refused => 'REFUSED',
          FailureReason.damaged => 'DAMAGED',
          FailureReason.riderIncident => 'RIDER_INCIDENT',
          FailureReason.other => 'OTHER',
        },
        'detail': ?detail,
        'evidenceRefs': [?state.photoRef],
        'contactAttempts': [
          for (final c in state.contacts)
            {
              'attemptedAt': c.attemptedAt.toIso8601String(),
              'answered': c.answered,
            },
        ],
      });
}

/// 전달 불가 사유 → 지원센터 대화를 열 때의 도움요청 유형.
HelpCategory helpCategoryForFailure(FailureReason r) => switch (r) {
  FailureReason.customerAbsent ||
  FailureReason.unreachable ||
  FailureReason.refused => HelpCategory.customerUnreachable,
  FailureReason.addressError => HelpCategory.addressIssue,
  FailureReason.damaged => HelpCategory.goodsIssue,
  FailureReason.riderIncident => HelpCategory.accident,
  FailureReason.other => HelpCategory.other,
};

/// 연락 기록이 2회 이상 필요한 고객 사유(백엔드 안내 2026-11-13 §3).
bool needsContactAttempts(FailureReason r) => switch (r) {
  FailureReason.customerAbsent ||
  FailureReason.unreachable ||
  FailureReason.addressError ||
  FailureReason.refused => true,
  _ => false,
};

/// 지원센터에 보낸 도움요청 한 건.
@immutable
class HelpTicket {
  const HelpTicket({
    required this.key,
    required this.category,
    required this.sentAt,
    this.detail,
    this.state,
    this.caseId,
  });

  /// 요청 ID(= 멱등 키). 같은 요청을 다시 보낼 때만 같은 키다.
  final IdempotencyKey key;
  final HelpCategory category;
  final String? detail;
  final DateTime sentAt;

  /// 처리 상태. null 이면 아직 접수 확인 전.
  final HelpState? state;

  /// 지원센터(사건함) 접수번호 — 사건이 열린 뒤에만.
  final String? caseId;

  HelpTicket withStatus(HelpStatusView s) => HelpTicket(
    key: key,
    category: category,
    sentAt: sentAt,
    detail: detail,
    state: s.state,
    caseId: s.caseId ?? caseId,
  );
}

@immutable
class HelpFlowState {
  const HelpFlowState({this.tickets = const [], this.sending = false});

  /// 이 배송에서 보낸 도움요청(오래된 것부터).
  final List<HelpTicket> tickets;
  final bool sending;

  HelpTicket? get last => tickets.lastOrNull;

  /// 마지막 도움요청의 처리 상태. null 이면 아직 보내지 않았다.
  HelpState? get state => last?.state;
  IdempotencyKey? get key => last?.key;
  HelpCategory? get category => last?.category;
  int get sentCount => tickets.length;
}

/// 배송별 도움요청 기록. 배송 화면·지원센터 화면을 오가도 남는다(앱을 끄면 지워진다 —
/// 라이더용 도움요청 목록 API 가 없다, 백엔드 요청 중).
final helpFlowProvider =
    NotifierProvider.family<HelpFlowController, HelpFlowState, String>(
      HelpFlowController.new,
    );

/// 도움요청 → 지원센터(delivery-execution 기록 → case-service RIDER_HELP 사건 → 백오피스 사건함).
/// 새로 보낼 때마다 새 요청(새 키)이다. 접수 결과를 모르는 같은 내용만 같은 키로 다시 보낸다
/// (사건이 두 번 생기지 않게). 처리된 뒤에도 다른 도움요청을 보낼 수 있다.
class HelpFlowController extends Notifier<HelpFlowState> {
  HelpFlowController(this.deliveryId);

  final String deliveryId;

  @override
  HelpFlowState build() => const HelpFlowState();

  Future<void> send(
    HelpCategory category, {
    String? detail,
    List<String>? evidenceRefs,
  }) async {
    if (state.sending) return;
    final text = detail?.trim();
    final note = text == null || text.isEmpty ? null : text;
    final last = state.last;
    final retry =
        last != null &&
        last.state == HelpState.unknown &&
        last.category == category &&
        last.detail == note;
    final ticket = retry
        ? last
        : HelpTicket(
            key: IdempotencyKey.generate(),
            category: category,
            detail: note,
            sentAt: DateTime.now(),
          );
    final others = retry
        ? state.tickets.sublist(0, state.tickets.length - 1)
        : state.tickets;
    state = HelpFlowState(tickets: [...others, ticket], sending: true);
    final repo = ref.read(deliveryRepositoryProvider);
    var sent = false;
    for (var i = 0; i < 3 && !sent; i++) {
      try {
        await repo.requestHelp(
          deliveryId,
          category,
          detail: note,
          evidenceRefs: evidenceRefs,
          key: ticket.key,
        );
        sent = true;
      } on UnknownResultFailure {
        continue;
      } on PmartFailure {
        break;
      }
    }
    if (!ref.mounted) return;
    // 접수 응답을 끝내 못 받았어도 상태 조회로 확인한다(새 요청을 만들지 않는다).
    final s = await repo.helpStatus(deliveryId, ticket.key);
    if (ref.mounted) _replace(ticket.withStatus(s), sending: false);
  }

  /// 아직 처리되지 않은 도움요청의 상태를 다시 조회한다.
  Future<void> refresh() async {
    final repo = ref.read(deliveryRepositoryProvider);
    // 앱을 다시 켰으면 보낸 도움요청을 서버 목록에서 되찾는다(execution 0.7.0).
    if (state.tickets.isEmpty && !state.sending) {
      try {
        final records = await repo.helpRequests(deliveryId);
        if (!ref.mounted) return;
        if (state.tickets.isEmpty && records.isNotEmpty) {
          state = HelpFlowState(
            tickets: [
              for (final r in records)
                HelpTicket(
                  key: IdempotencyKey(r.requestId),
                  category: r.category,
                  detail: r.detail,
                  sentAt: r.sentAt,
                  state: r.state,
                  caseId: r.caseId,
                ),
            ],
          );
        }
      } on PmartFailure {
        // 목록을 못 읽으면 빈 목록으로 단정하지 않는다 — 다음에 다시.
      }
      return;
    }
    for (final t in state.tickets) {
      if (t.state == HelpState.resolved) continue;
      final s = await repo.helpStatus(deliveryId, t.key);
      if (!ref.mounted) return;
      _replace(t.withStatus(s));
    }
  }

  void _replace(HelpTicket t, {bool? sending}) {
    state = HelpFlowState(
      tickets: [
        for (final x in state.tickets) x.key.value == t.key.value ? t : x,
      ],
      sending: sending ?? state.sending,
    );
  }
}

/// 대화 한 줄기 = 도움요청 한 건.
typedef SupportThreadId = ({String deliveryId, String requestId});

@immutable
class SupportThreadState {
  const SupportThreadState({
    this.messages = const [],
    this.loaded = false,
    this.unavailable = false,
    this.failed = false,
    this.sending = false,
  });

  final List<SupportMessage> messages;
  final bool loaded;

  /// 실서버: 대화 API 가 없다.
  final bool unavailable;

  /// 마지막 조회·보내기가 실패했다(빈 대화로 보이지 않게 구분한다).
  final bool failed;
  final bool sending;

  SupportThreadState copyWith({
    List<SupportMessage>? messages,
    bool? loaded,
    bool? unavailable,
    bool? failed,
    bool? sending,
  }) => SupportThreadState(
    messages: messages ?? this.messages,
    loaded: loaded ?? this.loaded,
    unavailable: unavailable ?? this.unavailable,
    failed: failed ?? this.failed,
    sending: sending ?? this.sending,
  );
}

final supportThreadProvider = NotifierProvider.autoDispose
    .family<SupportThreadController, SupportThreadState, SupportThreadId>(
      SupportThreadController.new,
    );

/// 지원센터 상담 대화. 보내지 못한 같은 글을 다시 보낼 때만 같은 키다.
class SupportThreadController extends Notifier<SupportThreadState> {
  SupportThreadController(this.id);

  final SupportThreadId id;
  IdempotencyKey? _pendingKey;
  String? _pendingText;

  @override
  SupportThreadState build() => const SupportThreadState();

  SupportThreadRepository get _repo =>
      ref.read(supportThreadRepositoryProvider);

  /// 대화와 처리 상태를 새로 받는다.
  Future<void> load() async {
    try {
      final messages = await _repo.threadMessages(id.deliveryId, id.requestId);
      if (!ref.mounted) return;
      state = state.copyWith(messages: messages, loaded: true, failed: false);
    } on SupportThreadUnavailable {
      if (ref.mounted) state = state.copyWith(loaded: true, unavailable: true);
    } on PmartFailure {
      if (ref.mounted) state = state.copyWith(loaded: true, failed: true);
    }
    if (ref.mounted) {
      await ref.read(helpFlowProvider(id.deliveryId).notifier).refresh();
    }
  }

  /// 보냈으면 true.
  Future<bool> send(String text) async {
    final t = text.trim();
    if (t.isEmpty || state.sending) return false;
    final key = t == _pendingText && _pendingKey != null
        ? _pendingKey!
        : IdempotencyKey.generate();
    _pendingKey = key;
    _pendingText = t;
    state = state.copyWith(sending: true);
    try {
      await _repo.sendMessage(id.deliveryId, id.requestId, t, key: key);
      _pendingKey = null;
      _pendingText = null;
      if (!ref.mounted) return true;
      state = state.copyWith(sending: false);
      await load();
      return true;
    } on SupportThreadUnavailable {
      if (ref.mounted) {
        state = state.copyWith(sending: false, unavailable: true);
      }
      return false;
    } on PmartFailure {
      if (ref.mounted) state = state.copyWith(sending: false, failed: true);
      return false;
    }
  }
}
