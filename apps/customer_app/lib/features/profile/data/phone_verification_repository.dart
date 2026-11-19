import 'package:dio/dio.dart';
import 'package:pmart_api_customer/pmart_api_customer.dart' as api;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart' show sourceSystem;
import '../domain/phone_verification.dart';

/// 휴대폰 번호 확인(customer 0.9.0, phone-verifications 태그). 실패는 [PmartFailure].
abstract interface class PhoneVerificationRepository {
  /// `POST /me/phone-verifications` — 프로필에 저장된 번호로 시작(본문 없음). 같은 [key] 재전송은 같은 결과.
  Future<PhoneVerificationStart> start({required IdempotencyKey key});

  /// `POST /me/phone-verifications/{id}/confirmations` — 고객이 "보냈어요"를 누를 때만(자동 반복 금지 —
  /// 조회마다 OCTOMO 월 한도가 준다). 끝난 확인은 서버가 그 상태를 돌려준다(재전송 안전).
  Future<PhoneVerificationStatus> confirm(
    String verificationId, {
    required IdempotencyKey key,
  });
}

final class ApiPhoneVerificationRepository
    implements PhoneVerificationRepository {
  ApiPhoneVerificationRepository(Dio dio)
    : _api = api.PmartApiCustomer(dio: dio).getPhoneVerificationsApi();

  final api.PhoneVerificationsApi _api;

  @override
  Future<PhoneVerificationStart> start({required IdempotencyKey key}) async {
    final res = await pmartGuard(
      () => _api.startPhoneVerification(
        idempotencyKey: key.value,
        xSourceSystem: sourceSystem,
        extra: commandOptions(key).extra,
      ),
    );
    final s = res.data ?? (throw UnknownResultFailure(requestId: key.value));
    return PhoneVerificationStart(
      verificationId: s.verificationId,
      sendTo: s.sendTo,
      text: s.text,
      expiresAt: s.expiresAt,
      phoneMasked: s.phoneMasked,
      maxAttempts: s.maxAttempts,
    );
  }

  @override
  Future<PhoneVerificationStatus> confirm(
    String verificationId, {
    required IdempotencyKey key,
  }) async {
    final res = await pmartGuard(
      () => _api.confirmPhoneVerification(
        verificationId: verificationId,
        idempotencyKey: key.value,
        xSourceSystem: sourceSystem,
        extra: commandOptions(key).extra,
      ),
    );
    return phoneVerificationFromContract(
      res.data ?? (throw UnknownResultFailure(requestId: key.value)),
    );
  }
}

PhoneVerificationStatus phoneVerificationFromContract(
  api.PhoneVerification v,
) => PhoneVerificationStatus(
  verificationId: v.verificationId,
  state: switch (v.state) {
    api.PhoneVerificationStateEnum.PENDING => PhoneVerificationState.pending,
    api.PhoneVerificationStateEnum.VERIFIED => PhoneVerificationState.verified,
    api.PhoneVerificationStateEnum.FAILED => PhoneVerificationState.failed,
    api.PhoneVerificationStateEnum.EXPIRED => PhoneVerificationState.expired,
  },
  remainingAttempts: v.remainingAttempts,
  expiresAt: v.expiresAt,
  failureReason: switch (v.failureReason) {
    api.PhoneVerificationFailureReasonEnum.TOO_MANY_ATTEMPTS =>
      PhoneVerificationFailure.tooManyAttempts,
    api.PhoneVerificationFailureReasonEnum.PHONE_CHANGED =>
      PhoneVerificationFailure.phoneChanged,
    _ => null,
  },
  verifiedAt: v.verifiedAt,
);

/// 목: 시작하면 대표번호·6자리, "보냈어요"는 [arriveAfter] 번째 확인부터 VERIFIED(그 전은 PENDING·횟수 감소).
final class MockPhoneVerificationRepository
    implements PhoneVerificationRepository {
  MockPhoneVerificationRepository({
    this.latency = const Duration(milliseconds: 200),
    DateTime Function()? now,
    this.onVerified,
  }) : now = now ?? DateTime.now;

  final Duration latency;
  final DateTime Function() now;

  /// 확인되면 부른다(목 프로필의 phoneVerified 를 켜는 데 쓴다).
  final void Function()? onVerified;

  /// 몇 번째 "보냈어요"에 문자가 도착한 것으로 볼지(1 = 첫 번에).
  int arriveAfter = 1;

  /// 다음 시작을 이 코드로 거절한다(예 PHONE_NOT_SUPPORTED).
  String? rejectStart;

  /// 다음 확인을 503 으로(OCTOMO 장애 — 횟수 줄지 않음).
  bool confirmUnavailableOnce = false;

  int starts = 0;
  int confirms = 0;
  final _attempts = <String, int>{};
  final _remaining = <String, int>{};
  final _expires = <String, DateTime>{};
  final _verified = <String>{};
  static const maxAttempts = 5;

  Future<void> _wait() => Future<void>.delayed(latency);

  @override
  Future<PhoneVerificationStart> start({required IdempotencyKey key}) async {
    await _wait();
    if (rejectStart case final code?) {
      rejectStart = null;
      throw ProblemFailure(Problem(status: 400, code: code));
    }
    starts++;
    final id = 'pv-$starts';
    _attempts[id] = 0;
    _remaining[id] = maxAttempts;
    _expires[id] = now().toUtc().add(const Duration(minutes: 10));
    return PhoneVerificationStart(
      verificationId: id,
      sendTo: '1666-3538',
      text: (482913 + starts).toString(),
      expiresAt: _expires[id]!,
      phoneMasked: '010-****-5678',
      maxAttempts: maxAttempts,
    );
  }

  @override
  Future<PhoneVerificationStatus> confirm(
    String verificationId, {
    required IdempotencyKey key,
  }) async {
    await _wait();
    confirms++;
    if (confirmUnavailableOnce) {
      confirmUnavailableOnce = false;
      throw const UnknownResultFailure(httpStatus: 503);
    }
    final expires = _expires[verificationId] ?? now().toUtc();
    PhoneVerificationStatus status(
      PhoneVerificationState s, {
      PhoneVerificationFailure? reason,
    }) => PhoneVerificationStatus(
      verificationId: verificationId,
      state: s,
      remainingAttempts: _remaining[verificationId] ?? 0,
      expiresAt: expires,
      failureReason: reason,
      verifiedAt: s == PhoneVerificationState.verified ? now().toUtc() : null,
    );
    if (_verified.contains(verificationId)) {
      return status(PhoneVerificationState.verified);
    }
    if (!now().toUtc().isBefore(expires)) {
      return status(PhoneVerificationState.expired);
    }
    final n = (_attempts[verificationId] ?? 0) + 1;
    _attempts[verificationId] = n;
    if (n >= arriveAfter) {
      _verified.add(verificationId);
      onVerified?.call();
      return status(PhoneVerificationState.verified);
    }
    final left = (_remaining[verificationId] ?? maxAttempts) - 1;
    _remaining[verificationId] = left;
    if (left <= 0) {
      return status(
        PhoneVerificationState.failed,
        reason: PhoneVerificationFailure.tooManyAttempts,
      );
    }
    return status(PhoneVerificationState.pending);
  }
}
