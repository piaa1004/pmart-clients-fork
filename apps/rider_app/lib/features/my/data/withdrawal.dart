import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_api_rider/pmart_api_rider.dart' as rd;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart';
import '../../offers/presentation/offer_controllers.dart';

enum WithdrawalState { pending, completed, rejected, unknown }

/// 탈퇴할 수 없는 사유(rider-service 0.6.0 `WithdrawalBlocker` — 백엔드 회신 2026-11-17).
enum WithdrawalBlocker {
  activeDelivery,
  unconfirmedEarning,
  earningAdjustment,
  openHelpRequest,
  restrictionReview,
  other,
}

typedef WithdrawalStatus = ({
  WithdrawalState state,
  List<WithdrawalBlocker> blockers,
});

WithdrawalBlocker blockerFromWire(String s) => switch (s) {
  'ACTIVE_DELIVERY' => WithdrawalBlocker.activeDelivery,
  'UNCONFIRMED_EARNING' => WithdrawalBlocker.unconfirmedEarning,
  'EARNING_ADJUSTMENT_PENDING' => WithdrawalBlocker.earningAdjustment,
  'OPEN_HELP_REQUEST' => WithdrawalBlocker.openHelpRequest,
  'RESTRICTION_REVIEW' => WithdrawalBlocker.restrictionReview,
  _ => WithdrawalBlocker.other,
};

/// 409 INVALID_STATE 의 막는 사유(problem `details` = `[{field: blockers, reason: <코드>}]`).
class WithdrawalBlockedFailure implements Exception {
  const WithdrawalBlockedFailure(this.blockers);
  final List<WithdrawalBlocker> blockers;
}

/// 계정 탈퇴(rider-service `POST /riders/me/withdrawals` → `GET …/{requestId}`).
/// 진행 중 배송·미정산 수행료·제한 조사 중이면 서버가 409 INVALID_STATE 로 거절한다.
abstract interface class WithdrawalRepository {
  /// 접수되면 requestId. 같은 키 재전송은 같은 신청이다.
  Future<String> request({String? reason, required IdempotencyKey key});
  Future<WithdrawalStatus> status(String requestId);
}

final class ApiWithdrawalRepository implements WithdrawalRepository {
  ApiWithdrawalRepository(Dio dio)
    : _me = rd.PmartApiRider(dio: dio).getMeApi();

  final rd.MeApi _me;

  @override
  Future<String> request({String? reason, required IdempotencyKey key}) async {
    final Response<rd.CreateMyWithdrawal202Response> res;
    try {
      res = await pmartGuard(
        () => _me.createMyWithdrawal(
          idempotencyKey: key.value,
          xSourceSystem: sourceSystem,
          createMyWithdrawalRequest: rd.CreateMyWithdrawalRequest(
            reason: reason == null || reason.trim().isEmpty
                ? null
                : reason.trim(),
          ),
          extra: commandOptions(key).extra,
        ),
      );
    } on ProblemFailure catch (f) {
      // 막힘: 409 INVALID_STATE + details[{field: blockers, reason: 코드}].
      if (f.problem.status == 409) {
        throw WithdrawalBlockedFailure([
          for (final d in f.problem.details)
            if (d.field == 'blockers' && d.reason != null)
              blockerFromWire(d.reason!),
        ]);
      }
      rethrow;
    }
    final body =
        res.data ?? (throw const ContractViolationFailure('탈퇴 응답 본문 없음'));
    return body.requestId;
  }

  @override
  Future<WithdrawalStatus> status(String requestId) async {
    final res = await pmartGuard(
      () => _me.getMyWithdrawal(requestId: requestId),
    );
    return (
      state: switch (res.data?.state?.value) {
        'PENDING' => WithdrawalState.pending,
        'COMPLETED' => WithdrawalState.completed,
        'REJECTED' => WithdrawalState.rejected,
        _ => WithdrawalState.unknown,
      },
      blockers: [
        for (final b in res.data?.blockers ?? const <rd.WithdrawalBlocker>[])
          blockerFromWire(b.value),
      ],
    );
  }
}

/// 목: 진행 중 배송이 있으면 409, 아니면 바로 완료.
final class MockWithdrawalRepository implements WithdrawalRepository {
  MockWithdrawalRepository({required this.busy, this.notImplemented = false});

  final bool Function() busy;

  /// 서버에 탈퇴 기능이 없는 상태(501)를 흉내 낸다(시험용).
  final bool notImplemented;
  final _done = <String>{};

  @override
  Future<String> request({String? reason, required IdempotencyKey key}) async {
    await Future<void>.delayed(Duration.zero);
    if (notImplemented) {
      throw const UnknownResultFailure(httpStatus: 501);
    }
    if (busy()) {
      throw const WithdrawalBlockedFailure([WithdrawalBlocker.activeDelivery]);
    }
    _done.add(key.value);
    return key.value;
  }

  @override
  Future<WithdrawalStatus> status(String requestId) async => (
    state: _done.contains(requestId)
        ? WithdrawalState.completed
        : WithdrawalState.unknown,
    blockers: const <WithdrawalBlocker>[],
  );
}

final withdrawalRepositoryProvider = Provider<WithdrawalRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => MockWithdrawalRepository(
      busy: () =>
          ref.read(mockOfferRepositoryProvider).assignedDeliveries.isNotEmpty,
    ),
    PmartEnv.local => ApiWithdrawalRepository(ref.watch(dioProvider)),
  },
);
