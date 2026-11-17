import 'package:dio/dio.dart';
import 'package:pmart_api_delivery_dispatch/pmart_api_delivery_dispatch.dart';
import 'package:pmart_api_rider/pmart_api_rider.dart' as rd;
import 'package:pmart_core/pmart_core.dart';

import '../../delivery/data/trip_repository.dart' show rememberOfferTrip;

import '../../../shared/providers.dart' show sourceSystem;
import '../../delivery/domain/delivery.dart' show recoveryPurposeFrom;
import '../domain/offer_list.dart';

abstract interface class OfferRepository {
  /// 내 활성 제안(state 생략 = SENT 이면서 만료 전). 실패는 [PmartFailure].
  Future<OfferList> activeOffers();

  /// `POST /offers/{id}/responses`. 같은 키 재전송은 같은 판정을 돌려줘야 한다.
  Future<OfferOutcome> respond(
    String offerId, {
    required bool accept,
    RejectReason? reason,
    required IdempotencyKey key,
  });

  /// `GET /offers/{id}` — 상세를 열었음을 서버가 기록한다. 상세를 연 뒤 응답 없이 만료되면
  /// 거절 횟수에 들어간다(백엔드 안내 2026-11-13 §3).
  Future<void> openDetail(String offerId);
}

/// 운행 상태·배차 설정(rider-service).
abstract interface class DutyRepository {
  Future<OperatingState> state();

  /// 실패는 [PmartFailure](403 계정 제한, 409 진행 배송 있음 등).
  Future<OperatingState> setState({
    required bool onDuty,
    required bool newDispatch,
    required int expectedVersion,
    String? mfcId,
    required IdempotencyKey key,
  });

  Future<DispatchMode> dispatchMode();

  /// 배차 설정(모드·하나씩 배달하기).
  Future<DispatchSettingsView> settings();

  Future<DispatchSettingsView> setSettings({
    required DispatchMode mode,
    required bool oneAtATime,
    required int expectedVersion,
    required IdempotencyKey key,
  });
}

/// 실서버 구현(`GET /offers`, listMyOffers).
final class ApiOfferRepository implements OfferRepository {
  ApiOfferRepository(Dio dio)
    : _offers = PmartApiDeliveryDispatch(dio: dio).getOffersApi();

  final OffersApi _offers;

  @override
  Future<OfferList> activeOffers() async {
    final res = await pmartGuard(() => _offers.listMyOffers());
    final body = res.data;
    if (body == null) {
      throw const ContractViolationFailure('listMyOffers 본문 없음');
    }
    // 카드·상세·수락 뒤 배송 화면이 쓸 주문 요약·좌표·소요를 기억한다.
    for (final o in body.items ?? const <Offer>[]) {
      if ((o.deliveryId, o.summary) case (final id?, final s?)) {
        rememberOfferTrip(id, s);
      }
    }
    return offerListFromContract(body);
  }

  @override
  Future<OfferOutcome> respond(
    String offerId, {
    required bool accept,
    RejectReason? reason,
    required IdempotencyKey key,
  }) async {
    try {
      final res = await pmartGuard(
        () => _offers.respondToOffer(
          offerId: offerId,
          idempotencyKey: key.value,
          xSourceSystem: sourceSystem,
          respondToOfferRequest: RespondToOfferRequest(
            response: accept
                ? RespondToOfferRequestResponseEnum.ACCEPT
                : RespondToOfferRequestResponseEnum.REJECT,
            rejectReason: switch (reason) {
              RejectReason.tooFar =>
                RespondToOfferRequestRejectReasonEnum.TOO_FAR,
              RejectReason.overCapacity =>
                RespondToOfferRequestRejectReasonEnum.OVER_CAPACITY,
              RejectReason.personal =>
                RespondToOfferRequestRejectReasonEnum.PERSONAL,
              RejectReason.other => RespondToOfferRequestRejectReasonEnum.OTHER,
              null => null,
            },
            // 단말 시각은 참고값이다. 판정은 서버 수신 시각.
            respondedAt: DateTime.now().toUtc(),
          ),
          extra: commandOptions(key).extra,
        ),
      );
      final r = res.data;
      return r == null ? const OfferUnknown() : offerOutcomeFromContract(r);
    } on UnknownResultFailure {
      return const OfferUnknown();
    } on ProblemFailure catch (f) {
      if (f.problem.code == ProblemCode.idempotencyConflict &&
          f.problem.retryable) {
        return const OfferUnknown();
      }
      rethrow;
    }
  }

  @override
  Future<void> openDetail(String offerId) async {
    await pmartGuard(() => _offers.getOffer(offerId: offerId));
  }
}

final class ApiDutyRepository implements DutyRepository {
  ApiDutyRepository(Dio dio) : _me = rd.PmartApiRider(dio: dio).getMeApi();

  final rd.MeApi _me;

  @override
  Future<OperatingState> state() async {
    final res = await pmartGuard(() => _me.getMyOperatingState());
    return operatingStateFromContract(
      res.data ??
          (throw const ContractViolationFailure('OperatingState 본문 없음')),
    );
  }

  @override
  Future<OperatingState> setState({
    required bool onDuty,
    required bool newDispatch,
    required int expectedVersion,
    String? mfcId,
    required IdempotencyKey key,
  }) async {
    final res = await pmartGuard(
      () => _me.setMyOperatingState(
        idempotencyKey: key.value,
        xSourceSystem: sourceSystem,
        xExpectedVersion: expectedVersion,
        operatingStateRequest: rd.OperatingStateRequest(
          status: onDuty
              ? rd.OperatingStatus.ON_DUTY
              : rd.OperatingStatus.OFF_DUTY,
          newDispatchEnabled: onDuty && newDispatch,
          mfcId: mfcId,
        ),
        extra: commandOptions(key, expectedVersion: expectedVersion).extra,
      ),
    );
    return operatingStateFromContract(
      res.data ?? (throw UnknownResultFailure(requestId: key.value)),
    );
  }

  @override
  Future<DispatchMode> dispatchMode() async {
    final res = await pmartGuard(() => _me.getMyDispatchSettings());
    return res.data?.dispatchMode ==
            rd.DispatchSettingsDispatchModeEnum.AI_RECOMMENDED
        ? DispatchMode.aiRecommended
        : DispatchMode.normal;
  }

  @override
  Future<DispatchSettingsView> settings() async {
    final res = await pmartGuard(() => _me.getMyDispatchSettings());
    return dispatchSettingsFromContract(
      res.data ??
          (throw const ContractViolationFailure('DispatchSettings 본문 없음')),
    );
  }

  @override
  Future<DispatchSettingsView> setSettings({
    required DispatchMode mode,
    required bool oneAtATime,
    required int expectedVersion,
    required IdempotencyKey key,
  }) async {
    final res = await pmartGuard(
      () => _me.setMyDispatchSettings(
        idempotencyKey: key.value,
        xSourceSystem: sourceSystem,
        xExpectedVersion: expectedVersion,
        dispatchSettings: rd.DispatchSettings(
          oneAtATime: oneAtATime,
          dispatchMode: mode == DispatchMode.aiRecommended
              ? rd.DispatchSettingsDispatchModeEnum.AI_RECOMMENDED
              : rd.DispatchSettingsDispatchModeEnum.NORMAL,
        ),
        extra: commandOptions(key, expectedVersion: expectedVersion).extra,
      ),
    );
    return dispatchSettingsFromContract(
      res.data ?? (throw UnknownResultFailure(requestId: key.value)),
    );
  }
}

DispatchSettingsView dispatchSettingsFromContract(rd.DispatchSettings s) =>
    DispatchSettingsView(
      mode: s.dispatchMode == rd.DispatchSettingsDispatchModeEnum.AI_RECOMMENDED
          ? DispatchMode.aiRecommended
          : DispatchMode.normal,
      oneAtATime: s.oneAtATime ?? false,
      version: s.version ?? 0,
    );

OperatingState operatingStateFromContract(rd.OperatingState s) =>
    OperatingState(
      onDuty: s.status == rd.OperatingStatus.ON_DUTY,
      newDispatchEnabled: s.newDispatchEnabled ?? false,
      version: s.version ?? 0,
      activeDeliveryCount: s.activeDeliveryCount ?? 0,
      mfcId: s.mfcId,
    );

OfferOutcome offerOutcomeFromContract(OfferResponseResult r) =>
    switch (r.outcome) {
      OfferResponseResultOutcomeEnum.ASSIGNED => OfferAssigned(
        deliveryId: r.deliveryId,
        assignmentId: r.assignmentId,
      ),
      OfferResponseResultOutcomeEnum.REJECTED => OfferRejected(
        consecutiveRejections: r.consecutiveRejections,
        rejectionNotice: r.rejectionNotice ?? false,
      ),
      OfferResponseResultOutcomeEnum.LATE => OfferLate(switch (r.lateReason) {
        OfferResponseResultLateReasonEnum.EXPIRED => LateReason.expired,
        OfferResponseResultLateReasonEnum.ALREADY_ASSIGNED =>
          LateReason.alreadyAssigned,
        OfferResponseResultLateReasonEnum.ORDER_CANCELLED =>
          LateReason.orderCancelled,
        OfferResponseResultLateReasonEnum.INELIGIBLE => LateReason.ineligible,
        null => LateReason.unknown,
      }),
    };

/// 계약에 required 가 없어 모든 필드가 nullable 이다. 핵심 값이 없으면 빈 목록으로 메우지 않는다.
OfferList offerListFromContract(ListMyOffers200Response body) {
  final items = body.items;
  if (items == null) {
    throw const ContractViolationFailure('listMyOffers.items 없음');
  }
  return OfferList(
    offers: [
      for (final o in items)
        OfferItem(
          offerId:
              o.offerId ??
              (throw const ContractViolationFailure('Offer.offerId 없음')),
          remainingSec: o.remainingSec,
          expiresAt: o.expiresAt,
          deliveryId: o.deliveryId,
          dropAreaLabel: o.summary?.dropAreaLabel,
          estimatedFee: o.summary?.estimatedFee,
          distanceKm: o.summary?.distanceKm,
          weightG: o.summary?.weightG,
          containsAlcohol: o.summary?.containsAlcohol,
          mfcId: o.summary?.mfcId,
          pickupDistanceKm: o.summary?.pickupDistanceKm,
          pickupEtaSeconds: o.summary?.pickupEtaSeconds,
          bagCount: o.summary?.bagCount,
          mode: deliveryModeFromWire(o.summary?.deliveryMode?.value),
          bundleId: o.bundleId,
          bundleSize: o.bundleSize,
          stopSequence: o.stopSequence,
          recovery: recoveryPurposeFrom(
            type: o.deliveryType?.value,
            purpose: o.purpose?.value,
          ),
        ),
    ],
    pollAfter: switch (body.pollAfterSec) {
      final int s => Duration(seconds: s),
      null => null,
    },
    serverTime: body.serverTime,
  );
}

DeliveryMode? deliveryModeFromWire(String? w) => switch (w) {
  'SINGLE' => DeliveryMode.single,
  'BUNDLED' => DeliveryMode.bundled,
  'SCHEDULED' => DeliveryMode.scheduled,
  _ => null,
};
