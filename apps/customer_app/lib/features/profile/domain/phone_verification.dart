import 'package:flutter/foundation.dart';

/// 휴대폰 번호 확인(customer 0.9.0 — OCTOMO). 고객이 [sendTo] 로 [text] 를 **직접 문자로 보내고**,
/// "보냈어요"를 누르면 서버가 OCTOMO 로 받았는지 확인한다. 우리는 문자를 보내지 않는다.
/// 번호 소유만 확인한다(이름·나이 확인 아님 — 주류 성인 확인에 쓰지 않는다).
@immutable
class PhoneVerificationStart {
  const PhoneVerificationStart({
    required this.verificationId,
    required this.sendTo,
    required this.text,
    required this.expiresAt,
    required this.phoneMasked,
    this.maxAttempts,
  });

  final String verificationId;

  /// 받는 번호(OCTOMO 대표번호, 예 1666-3538).
  final String sendTo;

  /// 보낼 본문(숫자 6자리) — 고치면 확인되지 않는다.
  final String text;
  final DateTime expiresAt;
  final String phoneMasked;
  final int? maxAttempts;

  @override
  String toString() => 'PhoneVerificationStart($verificationId)';
}

enum PhoneVerificationState { pending, verified, failed, expired }

enum PhoneVerificationFailure { tooManyAttempts, phoneChanged }

@immutable
class PhoneVerificationStatus {
  const PhoneVerificationStatus({
    required this.verificationId,
    required this.state,
    required this.remainingAttempts,
    required this.expiresAt,
    this.failureReason,
    this.verifiedAt,
  });

  final String verificationId;
  final PhoneVerificationState state;
  final int remainingAttempts;
  final DateTime expiresAt;
  final PhoneVerificationFailure? failureReason;
  final DateTime? verifiedAt;
}

/// 서버 오류 코드(계약 설명 — Problem `code`).
abstract final class PhoneVerificationCode {
  static const phoneRequired = 'PHONE_REQUIRED';
  static const phoneNotSupported = 'PHONE_NOT_SUPPORTED';
  static const tooManyVerifications = 'TOO_MANY_VERIFICATIONS';
}
