import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_api_rider/pmart_api_rider.dart' as rd;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart';
import '../../offers/presentation/offer_controllers.dart';

enum WithdrawalState { pending, completed, rejected, unknown }

/// 탈퇴할 수 없는 사유(서버 `blockers` — 값 목록이 계약에 정해져 있지 않아 글자로 대략 나눈다).
enum WithdrawalBlocker { activeDelivery, unsettled, restrictionReview, other }

typedef WithdrawalStatus = ({
  WithdrawalState state,
  List<WithdrawalBlocker> blockers,
});

WithdrawalBlocker blockerFromWire(String s) {
  final u = s.toUpperCase();
  if (u.contains('DELIVER')) return WithdrawalBlocker.activeDelivery;
  if (u.contains('SETTLE') || u.contains('EARNING') || u.contains('PAY')) {
    return WithdrawalBlocker.unsettled;
  }
  if (u.contains('RESTRICT') || u.contains('REVIEW')) {
    return WithdrawalBlocker.restrictionReview;
  }
  return WithdrawalBlocker.other;
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
    final res = await pmartGuard(
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
        for (final b in res.data?.blockers ?? const <String>[])
          blockerFromWire(b),
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
      throw const ProblemFailure(
        Problem(status: 409, code: ProblemCode.invalidState),
      );
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
