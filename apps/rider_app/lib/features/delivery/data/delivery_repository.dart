import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:pmart_api_delivery_execution/pmart_api_delivery_execution.dart'
    as ex;
import 'package:pmart_api_delivery_dispatch/pmart_api_delivery_dispatch.dart'
    as dp;
import 'package:pmart_api_mfc_fulfillment/pmart_api_mfc_fulfillment.dart' as mf;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart' show sourceSystem;
import '../domain/delivery.dart';

abstract interface class DeliveryRepository {
  Future<DeliveryView> get(String deliveryId);

  /// 진행 중 배송(`GET /riders/me/deliveries`). 실패는 [PmartFailure].
  Future<List<DeliveryView>> myActive();

  /// 큐에 저장된 수행 명령(가게 도착·픽업·고객 도착·전달 완료·실패)을 같은 키로 보낸다.
  Future<SendResult> send(QueueItem item);

  /// `GET /deliveries/{id}/drop-info`(BR-24). 볼 수 없는 단계면 [DropInfoUnavailableFailure].
  Future<DropInfo> dropInfo(String deliveryId);

  /// `POST /deliveries/{id}/help-requests`(202). 같은 키 재전송은 같은 접수다. 결과 불명이면 [UnknownResultFailure].
  Future<void> requestHelp(
    String deliveryId,
    HelpCategory category, {
    String? detail,
    List<String>? evidenceRefs,
    required IdempotencyKey key,
  });

  /// 도움요청 상태·지원센터 접수번호(requestId = 멱등 키). 아직 모르면 [HelpState.unknown].
  Future<HelpStatusView> helpStatus(String deliveryId, IdempotencyKey key);

  /// 이 배송에서 내가 보낸 도움요청(오래된 것부터, execution 0.7.0 `GET …/help-requests`).
  /// 앱을 다시 켜도 보낸 요청·대화가 남게 한다.
  Future<List<HelpRecord>> helpRequests(String deliveryId);

  /// 전달 재개 요청(`POST …/failures/resume-requests`, execution 0.14.0) — 전달 불가 등록 중에만.
  /// 되돌리는 것은 지원센터 반려이고, 결과는 배송 상태로 확인한다. 실패는 [PmartFailure].
  Future<void> requestFailureResume(
    String deliveryId, {
    String? note,
    required IdempotencyKey key,
  });

  /// 회수지 연락처·주소(`GET /deliveries/{id}/recovery-contact`) + 좌표(배차 `recovery.pickup`).
  Future<RecoveryContactView> recoveryContact(String deliveryId);
}

/// 지원센터 상담 대화(도움요청 한 건 = 대화 한 줄기). delivery-execution 0.6.0
/// `GET/POST /deliveries/{id}/help-requests/{requestId}/messages`(백엔드 회신 2026-11-16).
abstract interface class SupportThreadRepository {
  /// 오래된 것부터.
  Future<List<SupportMessage>> threadMessages(
    String deliveryId,
    String requestId,
  );

  /// 라이더가 한 마디 보낸다. 같은 키 재전송은 같은 메시지다.
  Future<void> sendMessage(
    String deliveryId,
    String requestId,
    String text, {
    required IdempotencyKey key,
  });
}

/// 실서버 대화. 처리 끝난(RESOLVED) 도움요청에 쓰면 409 HELP_REQUEST_CLOSED — 화면은 처리 완료로 보인다.
/// 메시지 내용은 로그에 남기지 않는다(pmartGuard 는 본문을 남기지 않는다).
final class ApiSupportThreadRepository implements SupportThreadRepository {
  ApiSupportThreadRepository(Dio dio)
    : _exec = ex.PmartApiDeliveryExecution(dio: dio).getExecutionApi();

  final ex.ExecutionApi _exec;

  @override
  Future<List<SupportMessage>> threadMessages(
    String deliveryId,
    String requestId,
  ) async {
    final res = await pmartGuard(
      () => _exec.listHelpRequestMessages(
        deliveryId: deliveryId,
        requestId: requestId,
      ),
    );
    return [
      for (final m in res.data?.items ?? const <ex.HelpMessage>[])
        supportMessageFromContract(m),
    ];
  }

  @override
  Future<void> sendMessage(
    String deliveryId,
    String requestId,
    String text, {
    required IdempotencyKey key,
  }) async {
    await pmartGuard(
      () => _exec.postHelpRequestMessage(
        deliveryId: deliveryId,
        requestId: requestId,
        idempotencyKey: key.value,
        xSourceSystem: sourceSystem,
        postHelpRequestMessageRequest: ex.PostHelpRequestMessageRequest(
          body: text,
        ),
        extra: commandOptions(key).extra,
      ),
    );
  }
}

/// 계약 메시지 → 화면 모델. 상담원 ID 는 라이더에게 오지 않는다("지원센터"로 보인다).
SupportMessage supportMessageFromContract(ex.HelpMessage m) => SupportMessage(
  id: m.messageId,
  sender: m.senderType == ex.HelpMessageSenderTypeEnum.RIDER
      ? SupportSender.rider
      : SupportSender.agent,
  text: m.body ?? '',
  at: m.createdAt,
  masked: m.masked == true || m.body == null,
);

/// 배차취소(delivery-dispatch `POST /deliveries/{id}/assignment-cancellations`). 수락 전 "거절"과 다른 행위다.
abstract interface class AssignmentCancelRepository {
  /// 같은 키 재전송은 같은 요청이다.
  Future<CancelOutcome> cancel(
    String deliveryId, {
    required IdempotencyKey key,
  });
}

abstract final class DispatchProblemCode {
  static const pickedUpCaseRequired = 'PICKED_UP_CASE_REQUIRED';
}

final class ApiAssignmentCancelRepository
    implements AssignmentCancelRepository {
  ApiAssignmentCancelRepository(Dio dio)
    : _deliveries = dp.PmartApiDeliveryDispatch(dio: dio).getDeliveriesApi();

  final dp.DeliveriesApi _deliveries;

  @override
  Future<CancelOutcome> cancel(
    String deliveryId, {
    required IdempotencyKey key,
  }) async {
    try {
      await pmartGuard(
        () => _deliveries.createAssignmentCancellation(
          deliveryId: deliveryId,
          idempotencyKey: key.value,
          xSourceSystem: sourceSystem,
          createAssignmentCancellationRequest:
              dp.CreateAssignmentCancellationRequest(
                requestedBy:
                    dp.CreateAssignmentCancellationRequestRequestedByEnum.RIDER,
                reason: dp
                    .CreateAssignmentCancellationRequestReasonEnum
                    .RIDER_UNABLE,
              ),
          extra: commandOptions(key).extra,
        ),
      );
      return CancelOutcome.accepted;
    } on ProblemFailure catch (f) {
      return f.problem.code == DispatchProblemCode.pickedUpCaseRequired
          ? CancelOutcome.pickedUpCaseRequired
          : CancelOutcome.rejected;
    } on UnknownResultFailure {
      return CancelOutcome.unknown;
    } on NetworkFailure {
      return CancelOutcome.unknown;
    }
  }
}

/// 포장 QR 인계(mfc-fulfillment).
abstract interface class HandoverRepository {
  Future<HandoverStep> authorize(
    String packageId, {
    required String riderId,
    required String deliveryId,
    required String scannedCode,
    required IdempotencyKey key,
  });

  Future<HandoverStep> commit(
    String packageId, {
    required String authorizationId,
    required int fenceVersion,
    required String riderId,
    required IdempotencyKey key,
  });

  Future<HandoverResolutionView> resolution(String packageId);
}

/// 찍은 사진(메모리). 파일로 남기지 않는다.
typedef LocalPhoto = ({Uint8List bytes, String filename});

/// 증빙 사진 올리기(`POST /deliveries/{id}/evidence-photos`, multipart). 같은 사진을 다시 올릴 때는 같은 키.
abstract interface class EvidenceUploader {
  /// 성공하면 `photoRef`. 실패는 [PmartFailure](422 PHOTO_INVALID, 503 저장소 장애 등).
  Future<String> upload(
    String deliveryId,
    LocalPhoto photo, {
    required IdempotencyKey key,
  });
}

/// 내가 올린 사진 다시 보기(백엔드 회신 2026-11-17 §3 — 새 API 없이):
/// 도움요청 상세 `evidenceRefs` → `GET /deliveries/{id}/evidence-photos/{photoRef}`(원본, 메모리에만).
abstract interface class EvidencePhotoViewer {
  /// 도움요청(전달 불가 신고가 연 대화 포함)에 함께 올린 사진 참조.
  Future<List<String>> requestPhotoRefs(String deliveryId, String requestId);

  /// 사진 원본. 디스크에 남기지 않는다(서버 `no-store`).
  Future<Uint8List> photo(String deliveryId, String photoRef);
}

final class ApiEvidencePhotoViewer implements EvidencePhotoViewer {
  ApiEvidencePhotoViewer(Dio dio)
    : _exec = ex.PmartApiDeliveryExecution(dio: dio).getExecutionApi();

  final ex.ExecutionApi _exec;

  @override
  Future<List<String>> requestPhotoRefs(
    String deliveryId,
    String requestId,
  ) async {
    final res = await pmartGuard(
      () => _exec.getHelpRequest(deliveryId: deliveryId, requestId: requestId),
    );
    return res.data?.evidenceRefs ?? const [];
  }

  @override
  Future<Uint8List> photo(String deliveryId, String photoRef) async {
    final res = await pmartGuard(
      () => _exec.getEvidencePhoto(deliveryId: deliveryId, photoRef: photoRef),
    );
    return res.data ??
        (throw const ContractViolationFailure('evidence-photo 본문 없음'));
  }
}

final class ApiEvidenceUploader implements EvidenceUploader {
  ApiEvidenceUploader(Dio dio)
    : _exec = ex.PmartApiDeliveryExecution(dio: dio).getExecutionApi();

  final ex.ExecutionApi _exec;

  @override
  Future<String> upload(
    String deliveryId,
    LocalPhoto photo, {
    required IdempotencyKey key,
  }) async {
    final res = await pmartGuard(
      () => _exec.uploadEvidencePhoto(
        deliveryId: deliveryId,
        idempotencyKey: key.value,
        xSourceSystem: sourceSystem,
        file: MultipartFile.fromBytes(photo.bytes, filename: photo.filename),
        extra: commandOptions(key).extra,
      ),
    );
    return res.data?.photoRef ??
        (throw const ContractViolationFailure('EvidencePhoto 본문 없음'));
  }
}

/// 포장 QR 원문에서 packageId 를 꺼낸다. 형식은 MFC 의 `PKG:<packageId>:<packageVersion>`(BR-23 회신 2026-11-14).
/// 마지막 `:` 로 나눠 앞은 packageId, 뒤는 정수 버전이다. 서버에는 원문 그대로 보낸다.
String? packageIdFromQr(String code) {
  final s = code.trim();
  if (!s.startsWith('PKG:')) return null;
  final cut = s.lastIndexOf(':');
  if (cut <= 4) return null;
  final id = s.substring(4, cut);
  if (id.isEmpty || int.tryParse(s.substring(cut + 1)) == null) return null;
  return id;
}

final class ApiDeliveryRepository implements DeliveryRepository {
  ApiDeliveryRepository(Dio dio)
    : _exec = ex.PmartApiDeliveryExecution(dio: dio).getExecutionApi(),
      _me = ex.PmartApiDeliveryExecution(dio: dio).getMeApi(),
      _returns = ex.PmartApiDeliveryExecution(dio: dio).getReturnsApi(),
      _dispatch = dp.PmartApiDeliveryDispatch(dio: dio).getDeliveriesApi();

  final ex.ExecutionApi _exec;
  final ex.MeApi _me;
  final ex.ReturnsApi _returns;
  final dp.DeliveriesApi _dispatch;

  @override
  Future<RecoveryContactView> recoveryContact(String deliveryId) async {
    final res = await pmartGuard(
      () => _returns.getRecoveryContact(deliveryId: deliveryId),
    );
    final c =
        res.data ??
        (throw const ContractViolationFailure('RecoveryContact 본문 없음'));
    // 좌표는 참고값 — 못 읽어도 연락처·주소는 보인다.
    dp.RecoveryInfoPickup? pin;
    try {
      pin = (await pmartGuard(
        () => _dispatch.getDeliveryDispatch(deliveryId: deliveryId),
      )).data?.recovery?.pickup;
    } on PmartFailure {
      pin = null;
    }
    return RecoveryContactView(
      receiverPhone: c.receiverPhone,
      receiverName: c.receiverName,
      roadAddress: c.roadAddress,
      detailAddress: c.detailAddress,
      entranceMethod: entranceMethodFrom(c.entranceMethod),
      entranceNote: c.entranceNote,
      lat: pin?.lat?.toDouble(),
      lng: pin?.lng?.toDouble(),
    );
  }

  @override
  Future<DeliveryView> get(String deliveryId) async {
    final res = await pmartGuard(
      () => _exec.getDeliveryExecution(deliveryId: deliveryId),
    );
    return deliveryFromContract(
      res.data ??
          (throw const ContractViolationFailure('DeliveryExecution 본문 없음')),
    );
  }

  @override
  Future<List<DeliveryView>> myActive() async {
    final res = await pmartGuard(() => _me.listMyDeliveries());
    return [
      for (final d in res.data?.items ?? const <ex.DeliveryExecution>[])
        deliveryFromContract(d),
    ].where((d) => isActive(d.state)).toList();
  }

  @override
  Future<SendResult> send(QueueItem item) async {
    final id = item.targetId;
    final p = item.payload;
    final key = item.id;
    final extra = commandOptions(item.key).extra;
    final occurredAt = DateTime.tryParse(p['occurredAt'] as String? ?? '');
    try {
      final res = await pmartGuard(
        () => switch (item.kind) {
          DeliveryCommandKind.storeArrival => _exec.reportStoreArrival(
            deliveryId: id,
            idempotencyKey: key,
            xSourceSystem: sourceSystem,
            transitionRequest: ex.TransitionRequest(occurredAt: occurredAt),
            extra: extra,
          ),
          DeliveryCommandKind.pickup => _exec.reportPickup(
            deliveryId: id,
            idempotencyKey: key,
            xSourceSystem: sourceSystem,
            reportPickupRequest: ex.ReportPickupRequest(
              occurredAt: occurredAt,
              handoverIds: (p['handoverIds']! as List).cast<String>(),
            ),
            extra: extra,
          ),
          DeliveryCommandKind.customerArrival => _exec.reportCustomerArrival(
            deliveryId: id,
            idempotencyKey: key,
            xSourceSystem: sourceSystem,
            transitionRequest: ex.TransitionRequest(occurredAt: occurredAt),
            extra: extra,
          ),
          DeliveryCommandKind.completion => _exec.reportCompletion(
            deliveryId: id,
            idempotencyKey: key,
            xSourceSystem: sourceSystem,
            completionRequest: completionRequestFromPayload(p),
            extra: extra,
          ),
          DeliveryCommandKind.returnPickup => _returns.reportReturnPickup(
            deliveryId: id,
            idempotencyKey: key,
            xSourceSystem: sourceSystem,
            // items 는 비운다 — 서버가 회수 요청 줄을 쓴다(계약 0.10.0).
            reportReturnPickupRequest: ex.ReportReturnPickupRequest(
              occurredAt: occurredAt,
              items: const [],
              evidenceRefs: (p['evidenceRefs']! as List).cast<String>(),
            ),
            extra: extra,
          ),
          DeliveryCommandKind.returnToStore =>
            _returns.reportReturnStoreDelivery(
              deliveryId: id,
              idempotencyKey: key,
              xSourceSystem: sourceSystem,
              reportReturnStoreDeliveryRequest:
                  ex.ReportReturnStoreDeliveryRequest(occurredAt: occurredAt),
              extra: extra,
            ),
          DeliveryCommandKind.failure => _exec.reportFailure(
            deliveryId: id,
            idempotencyKey: key,
            xSourceSystem: sourceSystem,
            reportFailureRequest: failureRequestFromPayload(p, occurredAt),
            extra: extra,
          ),
          _ => throw ArgumentError(item.kind),
        },
      );
      return switch (res.data?.status.value) {
        'APPLIED' => const SendApplied(),
        'ACCEPTED' => SendAccepted(resultId: res.data?.resultId),
        'REJECTED' => SendRejected(
          res.data?.nextAction ?? ProblemCode.domainRejected,
        ),
        _ => const SendUnknown(),
      };
    } on PmartFailure catch (f) {
      return transitionFailureToSend(f);
    }
  }

  @override
  Future<DropInfo> dropInfo(String deliveryId) async {
    try {
      final res = await pmartGuard(
        () => _exec.getDeliveryDropInfo(deliveryId: deliveryId),
      );
      final d =
          res.data ?? (throw const ContractViolationFailure('DropInfo 본문 없음'));
      return DropInfo(
        roadAddress: d.roadAddress,
        detailAddress: d.detailAddress,
        receiverName: d.receiverName,
        receiverPhone: d.receiverPhone,
        entranceMethod: entranceMethodFrom(d.entranceMethod?.value),
        entranceNote: d.entranceNote,
        deliveryNote: d.deliveryNote,
        lat: d.lat?.toDouble(),
        lng: d.lng?.toDouble(),
      );
    } on ProblemFailure catch (f) {
      if (f.problem.code == 'DROP_INFO_CLOSED') {
        throw const DropInfoUnavailableFailure(DropInfoUnavailable.closed);
      }
      if (f.problem.code == 'DROP_INFO_NOT_FOUND') {
        throw const DropInfoUnavailableFailure(DropInfoUnavailable.notFound);
      }
      rethrow;
    }
  }

  @override
  Future<void> requestHelp(
    String deliveryId,
    HelpCategory category, {
    String? detail,
    List<String>? evidenceRefs,
    required IdempotencyKey key,
  }) async {
    await pmartGuard(
      () => _exec.createHelpRequest(
        deliveryId: deliveryId,
        idempotencyKey: key.value,
        xSourceSystem: sourceSystem,
        createHelpRequestRequest: ex.CreateHelpRequestRequest(
          category: helpCategoryToContract(category),
          detail: detail,
          evidenceRefs: evidenceRefs,
        ),
        extra: commandOptions(key).extra,
      ),
    );
  }

  @override
  Future<HelpStatusView> helpStatus(
    String deliveryId,
    IdempotencyKey key,
  ) async {
    try {
      final res = await pmartGuard(
        () =>
            _exec.getHelpRequest(deliveryId: deliveryId, requestId: key.value),
      );
      return (
        state: helpStateFromWire(res.data?.state?.value),
        caseId: res.data?.caseId,
      );
    } on PmartFailure {
      return (state: HelpState.unknown, caseId: null);
    }
  }

  @override
  Future<List<HelpRecord>> helpRequests(String deliveryId) async {
    final res = await pmartGuard(
      () => _exec.listHelpRequests(deliveryId: deliveryId),
    );
    return [
      for (final h in res.data?.items ?? const <ex.HelpRequest>[])
        if (h.requestId case final id?)
          (
            requestId: id,
            category: helpCategoryFromWire(h.category),
            detail: h.detail,
            sentAt: h.createdAt ?? DateTime.now(),
            state: helpStateFromWire(h.state?.value),
            caseId: h.caseId,
          ),
    ];
  }

  @override
  Future<void> requestFailureResume(
    String deliveryId, {
    String? note,
    required IdempotencyKey key,
  }) async {
    await pmartGuard(
      () => _exec.requestFailureResume(
        deliveryId: deliveryId,
        idempotencyKey: key.value,
        xSourceSystem: sourceSystem,
        requestFailureResumeRequest: ex.RequestFailureResumeRequest(note: note),
        extra: commandOptions(key).extra,
      ),
    );
  }
}

HelpCategory helpCategoryFromWire(String? w) => HelpCategory.values.firstWhere(
  (c) => helpCategoryToContract(c).value == w,
  orElse: () => HelpCategory.other,
);

final class ApiHandoverRepository implements HandoverRepository {
  ApiHandoverRepository(Dio dio)
    : _handovers = mf.PmartApiMfcFulfillment(dio: dio).getHandoversApi();

  final mf.HandoversApi _handovers;

  @override
  Future<HandoverStep> authorize(
    String packageId, {
    required String riderId,
    required String deliveryId,
    required String scannedCode,
    required IdempotencyKey key,
  }) => _step(() async {
    final res = await _handovers.authorizePackageHandover(
      packageId: packageId,
      idempotencyKey: key.value,
      xSourceSystem: sourceSystem,
      authorizePackageHandoverRequest: mf.AuthorizePackageHandoverRequest(
        riderId: riderId,
        deliveryId: deliveryId,
        scannedCode: scannedCode,
        scannedAt: DateTime.now().toUtc(),
      ),
      extra: commandOptions(key).extra,
    );
    final a = res.data;
    if (a?.handoverAuthorizationId == null || a?.fenceVersion == null) {
      return const HandoverUnknown();
    }
    return HandoverAuthorized(
      authorizationId: a!.handoverAuthorizationId!,
      fenceVersion: a.fenceVersion!,
    );
  });

  @override
  Future<HandoverStep> commit(
    String packageId, {
    required String authorizationId,
    required int fenceVersion,
    required String riderId,
    required IdempotencyKey key,
  }) => _step(() async {
    final res = await _handovers.commitPackageHandover(
      packageId: packageId,
      idempotencyKey: key.value,
      xSourceSystem: sourceSystem,
      commitPackageHandoverRequest: mf.CommitPackageHandoverRequest(
        handoverAuthorizationId: authorizationId,
        fenceVersion: fenceVersion,
        riderId: riderId,
      ),
      extra: commandOptions(key).extra,
    );
    final r = res.data;
    // 재고 차감까지 확정(APPLIED)일 때만 인계 완료. UNKNOWN_RESULT 는 판정 조회로 해소한다.
    return switch (r?.status) {
      mf.HandoverCommitResultStatusEnum.APPLIED => HandoverCommitted(
        r!.handoverId,
      ),
      mf.HandoverCommitResultStatusEnum.REJECTED => HandoverRejected(
        r!.nextAction ?? ProblemCode.domainRejected,
      ),
      _ => const HandoverUnknown(),
    };
  });

  Future<HandoverStep> _step(Future<HandoverStep> Function() call) async {
    try {
      return await pmartGuard(call);
    } on UnknownResultFailure {
      return const HandoverUnknown();
    } on ProblemFailure catch (f) {
      if (f.problem.code == ProblemCode.idempotencyConflict &&
          f.problem.retryable) {
        return const HandoverUnknown();
      }
      return HandoverRejected(f.problem.code);
    }
  }

  @override
  Future<HandoverResolutionView> resolution(String packageId) async {
    final res = await pmartGuard(
      () => _handovers.getHandoverResolution(packageId: packageId),
    );
    final r = res.data;
    return HandoverResolutionView(
      verdict: switch (r?.verdict?.value) {
        'STOPPED' => HandoverVerdict.stopped,
        'HANDOVER_IN_PROGRESS' => HandoverVerdict.inProgress,
        'HANDED_OVER' => HandoverVerdict.handedOver,
        _ => HandoverVerdict.unknown,
      },
      handoverId: r?.handoverId,
    );
  }
}

EntranceMethod? entranceMethodFrom(String? w) => switch (w) {
  'FREE' => EntranceMethod.free,
  'PASSWORD' => EntranceMethod.password,
  'CALL' => EntranceMethod.call,
  'OTHER' => EntranceMethod.other,
  _ => null,
};

bool isActive(ExecutionState s) => switch (s) {
  ExecutionState.unassigned ||
  ExecutionState.completed ||
  ExecutionState.failed ||
  ExecutionState.cancelled ||
  ExecutionState.returnedToStore => false,
  _ => true,
};

SendResult transitionFailureToSend(PmartFailure f) => switch (f) {
  UnknownResultFailure(:final transport)
      when transport == DioExceptionType.connectionError =>
    const SendOffline(),
  UnknownResultFailure() => const SendUnknown(),
  NetworkFailure() => const SendOffline(),
  ProblemFailure(:final problem)
      when problem.code == ProblemCode.idempotencyConflict &&
          problem.retryable =>
    const SendUnknown(),
  ProblemFailure(:final problem) => SendRejected(problem.code),
  _ => const SendUnknown(),
};

ex.CompletionRequest completionRequestFromPayload(Map<String, Object?> p) =>
    ex.CompletionRequest(
      occurredAt: DateTime.tryParse(p['occurredAt'] as String? ?? ''),
      method: p['method'] == 'FACE'
          ? ex.CompletionRequestMethodEnum.FACE
          : ex.CompletionRequestMethodEnum.CONTACTLESS,
      evidence: ex.CompletionRequestAllOfEvidence(
        photoRefs: (p['photoRefs']! as List).cast<String>(),
        takenAt: DateTime.parse(p['takenAt']! as String),
        placement: ex.CompletionRequestAllOfEvidencePlacementEnum.values
            .firstWhere(
              (v) => v.value == p['placement'],
              orElse: () =>
                  ex.CompletionRequestAllOfEvidencePlacementEnum.OTHER,
            ),
      ),
    );

DeliveryView deliveryFromContract(ex.DeliveryExecution d) => DeliveryView(
  deliveryId:
      d.deliveryId ?? (throw const ContractViolationFailure('deliveryId 없음')),
  version: d.version ?? 0,
  state: ExecutionState.fromWire(d.state?.value),
  orderId: d.orderId,
  mfcId: d.mfcId,
  packageIds: d.packageIds ?? const [],
  handoverIds: d.handoverIds ?? const [],
  failureHelpRequestId: d.failure?.helpRequestId,
  resumeRequestedAt: d.failure?.resumeRequestedAt,
  recovery: recoveryPurposeFrom(type: d.type?.value, purpose: d.purpose?.value),
  returnLines: returnItemsFrom(d),
  recoveryOrigin: switch (d.recoveryOrigin) {
    final o? => (
      placement: o.placement,
      detail: o.placementDetail,
      photoCount: o.photoRefs?.length ?? 0,
    ),
    null => null,
  },
  mfcPhone: d.mfcPhone,
);

/// 받을 품목. 반품 회수는 `returnLines`(서버가 이름을 채운다 — execution 0.14.3, 짝짓지 않는다),
/// 반품 줄이 없는 회수(오배송·전달 실패 반납)는 원래 주문 품목 전부(백엔드 회신 2026-11-17).
/// 이름이 없으면 null — 화면은 "상품 n".
List<ReturnItem> returnItemsFrom(ex.DeliveryExecution d) {
  String? nameOf(String? name, String? option) {
    final s = [?name, ?option].join(' ').trim();
    return s.isEmpty ? null : s;
  }

  final lines = d.returnLines ?? const <ex.ReturnLine>[];
  if (lines.isNotEmpty) {
    return [
      for (final l in lines) (name: nameOf(l.name, l.optionLabel), qty: l.qty),
    ];
  }
  if (d.type?.value != 'RETURN') return const [];
  return [
    for (final i
        in d.orderSummary?.items ??
            const <ex.DeliveryExecutionOrderSummaryItemsInner>[])
      (name: nameOf(i.name, i.optionLabel), qty: i.qty ?? 0),
  ];
}

ex.HelpCategory helpCategoryToContract(HelpCategory c) => switch (c) {
  HelpCategory.customerUnreachable => ex.HelpCategory.CUSTOMER_UNREACHABLE,
  HelpCategory.addressIssue => ex.HelpCategory.ADDRESS_ISSUE,
  HelpCategory.goodsIssue => ex.HelpCategory.GOODS_ISSUE,
  HelpCategory.photoUploadFailed => ex.HelpCategory.PHOTO_UPLOAD_FAILED,
  HelpCategory.accident => ex.HelpCategory.ACCIDENT,
  HelpCategory.appError => ex.HelpCategory.APP_ERROR,
  HelpCategory.storeWaiting => ex.HelpCategory.STORE_WAITING,
  HelpCategory.statusCorrection => ex.HelpCategory.STATUS_CORRECTION,
  HelpCategory.other => ex.HelpCategory.OTHER,
  HelpCategory.deliveryFailure => ex.HelpCategory.DELIVERY_FAILURE,
};

/// 큐에 저장된 전달 실패 → 계약 본문. 사진(evidenceRefs)·연락 기록(contactAttempts)을 함께 보낸다.
ex.ReportFailureRequest failureRequestFromPayload(
  Map<String, Object?> p,
  DateTime? occurredAt,
) => ex.ReportFailureRequest(
  occurredAt: occurredAt,
  reason: ex.ReportFailureRequestReasonEnum.values.firstWhere(
    (r) => r.value == p['reason'],
    orElse: () => ex.ReportFailureRequestReasonEnum.OTHER,
  ),
  detail: p['detail'] as String?,
  evidenceRefs: ((p['evidenceRefs'] as List?) ?? const []).cast<String>(),
  goodsLocation: ex.ReportFailureRequestGoodsLocationEnum.WITH_RIDER,
  contactAttempts: [
    for (final a in (p['contactAttempts'] as List?) ?? const [])
      ex.ReportFailureRequestAllOfContactAttemptsInner(
        attemptedAt: DateTime.parse((a as Map)['attemptedAt']! as String),
        // 앱이 고객 번호로 건 일반 전화(execution 0.11.0 PHONE_CALL — 안심번호 없음).
        method: ex
            .ReportFailureRequestAllOfContactAttemptsInnerMethodEnum
            .PHONE_CALL,
        result: a['answered'] == true
            ? ex
                  .ReportFailureRequestAllOfContactAttemptsInnerResultEnum
                  .ANSWERED
            : ex
                  .ReportFailureRequestAllOfContactAttemptsInnerResultEnum
                  .NO_ANSWER,
      ),
  ],
);

HelpState helpStateFromWire(String? w) => switch (w) {
  'OPEN' => HelpState.open,
  'IN_PROGRESS' => HelpState.inProgress,
  'RESOLVED' => HelpState.resolved,
  _ => HelpState.unknown,
};
