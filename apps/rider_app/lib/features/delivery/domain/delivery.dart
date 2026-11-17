import 'package:flutter/foundation.dart';

/// 배송 수행 상태. GPS·버튼만으로 상태를 바꾸지 않는다(서버 확정).
enum ExecutionState {
  /// 배정이 풀렸다(배차취소·계정 제한 — 다른 라이더에게 재배차 대기).
  unassigned,
  assigned,
  arrivedAtStore,
  pickedUp,
  arrivedAtCustomer,

  /// 전달 실패를 알렸고 운영자 확정을 기다린다. 확정 전까지 배송은 진행 중이다.
  failureReported,
  completed,
  failed,
  suspended,
  returnInProgress,
  returnPickedUp,
  returnedToStore,
  cancelled,
  unknown;

  static ExecutionState fromWire(String? w) => switch (w) {
    'UNASSIGNED' => unassigned,
    'ASSIGNED' => assigned,
    'ARRIVED_AT_STORE' => arrivedAtStore,
    'PICKED_UP' => pickedUp,
    'ARRIVED_AT_CUSTOMER' => arrivedAtCustomer,
    'FAILURE_REPORTED' => failureReported,
    'COMPLETED' => completed,
    'FAILED' => failed,
    'SUSPENDED' => suspended,
    'RETURN_IN_PROGRESS' => returnInProgress,
    'RETURN_PICKED_UP' => returnPickedUp,
    'RETURNED_TO_STORE' => returnedToStore,
    'CANCELLED' => cancelled,
    _ => unknown,
  };
}

@immutable
class DeliveryView {
  const DeliveryView({
    required this.deliveryId,
    required this.version,
    required this.state,
    required this.packageIds,
    required this.handoverIds,
    this.orderId,
    this.mfcId,
    this.failureHelpRequestId,
    this.resumeRequestedAt,
    this.recovery,
    this.returnLines = const [],
    this.recoveryOrigin,
    this.mfcPhone,
  });

  /// 회수 배송(type RETURN)이면 목적 — 받는 곳(회수지) → 두는 곳(MFC). 일반 배송은 null.
  /// 반품 회수·오배송 회수는 문구만 다르고 단계는 같다(백엔드 요청 2026-11-17 회수 화면 한 벌).
  final RecoveryPurpose? recovery;

  /// 받을 품목(반품 회수 — claim 이 요청한 줄·수량). 이름은 주문 요약에서 붙인다.
  final List<ReturnItem> returnLines;

  /// 오배송 회수: 원래 놓은 곳(완료 때 기록).
  final RecoveryOrigin? recoveryOrigin;

  /// 지점 전화(서버 값, 등록 안 됐으면 null — 버튼을 숨긴다).
  final String? mfcPhone;

  bool get isRecovery => recovery != null;

  final String deliveryId;
  final int version;
  final ExecutionState state;
  final String? orderId;
  final String? mfcId;

  /// 전달 불가 등록이 함께 연 지원센터 대화(도움요청 ID, execution 0.14.0). 그 전 서버·등록이면 null.
  final String? failureHelpRequestId;

  /// 전달 재개 요청을 보낸 시각(운영자 반려 대기). 없으면 null.
  final DateTime? resumeRequestedAt;

  /// 이 배송의 포장. 포장마다 스캔해야 한다.
  final List<String> packageIds;

  /// 서버가 확정한 인계(HandoverFact). 픽업 완료에 전부 필요하다.
  final List<String> handoverIds;
}

/// 회수 배송 목적(문구만 바꾼다).
enum RecoveryPurpose { claimReturn, misdeliveryRecovery, other }

RecoveryPurpose? recoveryPurposeFrom({String? type, String? purpose}) {
  if (type != 'RETURN') return null;
  return switch (purpose) {
    'CLAIM_RETURN' => RecoveryPurpose.claimReturn,
    'MISDELIVERY_RECOVERY' => RecoveryPurpose.misdeliveryRecovery,
    _ => RecoveryPurpose.other,
  };
}

/// 회수할 품목 한 줄(이름은 주문 요약과 맞을 때만).
typedef ReturnItem = ({String? name, int qty});

/// 오배송 회수 — 원래 배송이 놓은 곳.
typedef RecoveryOrigin = ({String? placement, String? detail, int photoCount});

/// 회수지 연락처(`GET /deliveries/{id}/recovery-contact`). 전화는 늘 있고, 주소는 반품 회수만(오배송은 null).
/// 좌표는 배차 정보(`recovery.pickup`). 개인정보 — 디스크·로그에 남기지 않는다.
@immutable
class RecoveryContactView {
  const RecoveryContactView({
    required this.receiverPhone,
    this.receiverName,
    this.roadAddress,
    this.detailAddress,
    this.entranceMethod,
    this.entranceNote,
    this.lat,
    this.lng,
  });

  final String receiverPhone;
  final String? receiverName;
  final String? roadAddress;
  final String? detailAddress;
  final EntranceMethod? entranceMethod;
  final String? entranceNote;
  final double? lat;
  final double? lng;

  String? get addressLine => switch ((roadAddress, detailAddress)) {
    (final r?, final d?) when d.isNotEmpty => '$r $d',
    (final r?, _) => r,
    _ => null,
  };
}

/// 출입 방법(`DropInfo.entranceMethod`).
enum EntranceMethod { free, password, call, other }

/// 라이더용 전달지(`GET /deliveries/{id}/drop-info`, BR-24 회신). 픽업 뒤 ~ 전달 완료 전에만 열린다.
///
/// 개인정보다 — 디스크·로그에 남기지 않고, 화면을 나가면 메모리에서도 지운다(autoDispose provider).
/// 출입 메모는 공동현관 비밀번호일 수 있어 화면에만 보이고 복사·공유하지 않는다.
@immutable
class DropInfo {
  const DropInfo({
    required this.roadAddress,
    this.detailAddress = '',
    this.receiverName,
    this.receiverPhone,
    this.entranceMethod,
    this.entranceNote,
    this.deliveryNote,
    this.lat,
    this.lng,
  });

  final String roadAddress;

  /// 지도 핀(참고 좌표).
  final double? lat;
  final double? lng;
  final String detailAddress;
  final String? receiverName;

  /// 고객 전화번호 그대로(안심번호 없음 — 백엔드 2026-11-14).
  final String? receiverPhone;
  final EntranceMethod? entranceMethod;
  final String? entranceNote;

  /// 배송 요청사항.
  final String? deliveryNote;

  String get addressLine =>
      detailAddress.isEmpty ? roadAddress : '$roadAddress $detailAddress';
}

/// 전달지를 볼 수 없는 이유.
enum DropInfoUnavailable {
  /// 픽업 전·전달 완료 뒤(409 DROP_INFO_CLOSED).
  closed,

  /// 주문 사본이 없다(404 DROP_INFO_NOT_FOUND) — 지원센터 문의.
  notFound,
}

final class DropInfoUnavailableFailure implements Exception {
  const DropInfoUnavailableFailure(this.reason);

  final DropInfoUnavailable reason;
}

/// 고객 연락 기록(전달 실패 등록에 필요 — 고객 사유는 2회 이상). 서버는 통화 여부를 모른다(앱이 기록).
@immutable
class ContactAttempt {
  const ContactAttempt({required this.attemptedAt, required this.answered});

  final DateTime attemptedAt;
  final bool answered;
}

/// 포장 한 개의 인계 진행. 서버가 재고 차감까지 확정한 [handedOver] 만 인계 완료다.
enum HandoverPhase {
  waiting,
  authorizing,
  committing,
  handedOver,

  /// 결과를 모른다. 인계 판정 조회로만 해소한다(다시 스캔해 새 인계를 만들지 않는다).
  checking,
  rejected,

  /// 주문 취소 등으로 출고가 중지됐다.
  stopped,
}

@immutable
class PackageHandover {
  const PackageHandover({
    required this.packageId,
    required this.phase,
    this.handoverId,
    this.rejectCode,
  });

  final String packageId;
  final HandoverPhase phase;
  final String? handoverId;
  final String? rejectCode;
}

/// 스캔 결과(서버에 보내기 전 화면 대조 포함).
enum ScanVerdict { accepted, otherDelivery, duplicate, unreadable }

/// 인계 요청 결과.
@immutable
sealed class HandoverStep {
  const HandoverStep();
}

final class HandoverAuthorized extends HandoverStep {
  const HandoverAuthorized({
    required this.authorizationId,
    required this.fenceVersion,
  });

  final String authorizationId;
  final int fenceVersion;
}

final class HandoverCommitted extends HandoverStep {
  const HandoverCommitted(this.handoverId);

  final String handoverId;
}

final class HandoverRejected extends HandoverStep {
  const HandoverRejected(this.code);

  final String code;
}

final class HandoverUnknown extends HandoverStep {
  const HandoverUnknown();
}

/// 인계 판정 조회 결과.
enum HandoverVerdict { stopped, inProgress, handedOver, unknown }

@immutable
class HandoverResolutionView {
  const HandoverResolutionView({required this.verdict, this.handoverId});

  final HandoverVerdict verdict;
  final String? handoverId;
}

enum CompletionMethod { face, contactless }

enum Placement {
  handedToCustomer,
  frontDoor,
  securityOffice,
  deliveryBox,
  other,
}

enum FailureReason {
  customerAbsent,
  addressError,
  unreachable,
  refused,
  damaged,
  riderIncident,
  other,
}

abstract final class DeliveryCommandKind {
  static const storeArrival = 'store-arrival';
  static const pickup = 'pickup';
  static const customerArrival = 'customer-arrival';
  static const completion = 'completion';
  static const failure = 'failure';

  /// 회수: 회수지에서 받음(사진) → RETURN_PICKED_UP.
  static const returnPickup = 'return-pickup';

  /// 회수: MFC 반납 → RETURNED_TO_STORE.
  static const returnToStore = 'return-store-delivery';
}

abstract final class HandoverProblemCode {
  static const alreadyHandedOver = 'ALREADY_HANDED_OVER';
  static const packageInvalidated = 'PACKAGE_INVALIDATED';
  static const deliveryMismatch = 'DELIVERY_MISMATCH';
  static const fenceActive = 'FENCE_ACTIVE';
  static const handoverNotConfirmed = 'HANDOVER_NOT_CONFIRMED';
  static const evidenceRequired = 'EVIDENCE_REQUIRED';
  static const contactAttemptsRequired = 'CONTACT_ATTEMPTS_REQUIRED';
  static const handoverRiderMismatch = 'HANDOVER_RIDER_MISMATCH';
  static const photoInvalid = 'PHOTO_INVALID';
}

/// 도움요청 유형(지원센터 사건으로 이어진다).
enum HelpCategory {
  customerUnreachable,
  addressIssue,
  goodsIssue,
  photoUploadFailed,
  accident,
  appError,

  /// 점포 대기(포장이 늦음)
  storeWaiting,

  /// 상태 정정(잘못 누름 등)
  statusCorrection,
  other,

  /// 전달 불가 신고가 연 대화(execution 0.14.0 DELIVERY_FAILURE). 라이더가 고르는 유형이 아니다.
  deliveryFailure,
}

/// 도움요청 처리 상태. 접수 ≠ 해결.
enum HelpState { open, inProgress, resolved, unknown }

/// 도움요청 조회 결과(`GET /deliveries/{id}/help-requests/{requestId}`).
/// [caseId] 는 지원센터(사건함) 접수번호 — 사건이 열린 뒤에만 있다.
/// 상담원 처리 메모는 계약상 직원에게만 보여 라이더 앱은 받지 않는다.
typedef HelpStatusView = ({HelpState state, String? caseId});

/// 내가 보낸 도움요청 한 건(목록 조회).
typedef HelpRecord = ({
  String requestId,
  HelpCategory category,
  String? detail,
  DateTime sentAt,
  HelpState state,
  String? caseId,
});

/// 지원센터 대화에서 말한 쪽.
enum SupportSender { rider, agent }

/// 지원센터 대화 한 마디(도움요청 한 건에 딸림). 계약에 아직 없다 — 목에서만(백엔드 요청 §11).
@immutable
class SupportMessage {
  const SupportMessage({
    required this.id,
    required this.sender,
    required this.text,
    required this.at,
    this.masked = false,
  });

  final String id;
  final SupportSender sender;
  final String text;
  final DateTime at;

  /// 지원센터가 가린 메시지(개인정보 등 — 본문 없음).
  final bool masked;
}

/// 상담 대화를 쓸 수 없다(대화 API 를 부를 수 없는 환경).
final class SupportThreadUnavailable implements Exception {
  const SupportThreadUnavailable();
}

/// 배차취소 요청 결과. 접수(202)는 확정이 아니다 — 재배차는 서버가 진행한다.
enum CancelOutcome {
  /// 접수됨(픽업 전): 상품은 점포에 남고 다른 라이더에게 재배차된다.
  accepted,

  /// 픽업 뒤라 배차취소를 할 수 없다(422 PICKED_UP_CASE_REQUIRED) — 지원센터로 안내한다.
  pickedUpCaseRequired,

  /// 서버가 거절했다.
  rejected,

  /// 결과를 모른다. 같은 키로 다시 보낸다.
  unknown,
}
