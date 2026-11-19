import 'package:flutter/foundation.dart';
import 'package:pmart_core/pmart_core.dart' show AuthTokens;

enum SocialProvider { kakao, naver, apple, google }

/// 목 모드 로그인 화면의 제공자. Flutter 는 Android 만 개발해 애플 로그인 버튼은 두지 않는다(ADR-0002).
/// [SocialProvider.apple] 은 계약 enum 이라 남긴다.
const loginProviders = [
  SocialProvider.kakao,
  SocialProvider.naver,
  SocialProvider.google,
];

/// 실서버 제공자(auth 0.4.0, ADR-0071 — 카카오·네이버도 Google 과 같은 OIDC ID 토큰).
/// 카카오는 SDK idToken, 네이버는 OIDC(인가 코드+PKCE) id_token. 서버에 키 설정 전이면 422 CONFIG_REQUIRED → "준비 중".
const serverLoginProviders = [
  SocialProvider.kakao,
  SocialProvider.naver,
  SocialProvider.google,
];

/// CHECKOUT 이면 로그인 뒤 장바구니 병합 확인으로 돌아간다(일반 로그인은 자동 병합 없음).
enum LoginPurpose { general, checkout }

/// 로그인 시도 1회의 결과.
@immutable
sealed class LoginOutcome {
  const LoginOutcome();
}

/// 이용 가능 회원. 토큰은 저장 후 버린다(로그에 남기지 않는다).
final class LoginMember extends LoginOutcome {
  const LoginMember({
    required this.accountId,
    required this.tokens,
    this.newAccount = false,
    this.cartMergeConfirm = false,
  });

  final String accountId;
  final AuthTokens tokens;
  final bool newAccount;

  /// 서버가 장바구니 병합 확인을 요구함(purpose=CHECKOUT).
  final bool cartMergeConfirm;
}

/// 동의 대기(AUTH_CONSENT, auth 0.2.0 — CU-1). 토큰이 없다. 신규 가입이거나, 기존 회원이 필수 약관의
/// 현행 버전에 동의한 기록이 없을 때(약관이 바뀐 뒤 첫 로그인 — [newAccount] false = 재동의) 온다.
final class LoginNeedsConsent extends LoginOutcome {
  const LoginNeedsConsent({
    required this.authRequestId,
    required this.requiredConsents,
    this.optionalConsents = const [],
    this.newAccount = true,
    this.lastError,
  });

  final String authRequestId;

  /// 필수 항목 `TYPE:version`(BR-20 회신 — 형식 확정). 버전은 서버 값을 그대로 돌려보낸다(앱 상수 금지).
  final List<String> requiredConsents;

  /// 선택 항목 `TYPE:version`(예 MARKETING). 고객이 끈 것도 거부(false)로 보낸다.
  final List<String> optionalConsents;
  final bool newAccount;

  /// 직전 동의 완료가 화면에 머무는 사유로 거절됐다(예 REQUIRED_CONSENT_MISSING).
  final String? lastError;

  LoginNeedsConsent withError(String? code) => LoginNeedsConsent(
    authRequestId: authRequestId,
    requiredConsents: requiredConsents,
    optionalConsents: optionalConsents,
    newAccount: newAccount,
    lastError: code,
  );
}

/// 동의 항목 하나의 결정. [item] 은 서버가 준 `TYPE:version` 그대로다.
@immutable
final class ConsentDecision {
  const ConsentDecision(this.item, {required this.agreed});

  final String item;
  final bool agreed;

  String get type => item.split(':').first;

  String get version {
    final parts = item.split(':');
    return parts.length > 1 ? parts.sublist(1).join(':') : '';
  }
}

/// 실패가 잦아 잠시 제한됨(423 AUTH_RESTRICTED). 남은 시간은 서버 값.
final class LoginRestricted extends LoginOutcome {
  const LoginRestricted({this.retryAfterSeconds});

  final int? retryAfterSeconds;
}

/// 원인증 결과 확인 중. 같은 키 재전송 또는 authRequestId 조회로 해소한다.
final class LoginUnknown extends LoginOutcome {
  const LoginUnknown({this.authRequestId});

  final String? authRequestId;
}

/// 고객이 제공자 화면에서 취소함. 실패 횟수에 넣지 않는다(서버 판정). 원래 화면으로 돌아간다.
final class LoginCancelled extends LoginOutcome {
  const LoginCancelled();
}

/// 제공자 장애(PROVIDER_UNAVAILABLE). 다시 시도할 수 있다.
final class LoginProviderUnavailable extends LoginOutcome {
  const LoginProviderUnavailable();
}

/// 제공자 검증 실패(PROVIDER_REJECTED) 또는 구매 불가 계정 등.
final class LoginRejected extends LoginOutcome {
  const LoginRejected(this.code);

  final String code;
}

abstract final class AuthProblemCode {
  static const restricted = 'AUTH_RESTRICTED';
  static const providerRejected = 'PROVIDER_REJECTED';
  static const providerUnavailable = 'PROVIDER_UNAVAILABLE';
  static const requiredConsentMissing = 'REQUIRED_CONSENT_MISSING';

  /// 동의 완료 거절 — 로그인을 처음부터 다시 해야 하는 것(auth 0.2.0 완료 오류 표).
  static const forbidden = 'FORBIDDEN';
  static const invalidState = 'INVALID_STATE';
  static const consentVersionOutdated = 'CONSENT_VERSION_OUTDATED';
  static const restartLogin = {forbidden, invalidState, consentVersionOutdated};
  static const accountNotPurchasable = 'ACCOUNT_NOT_PURCHASABLE';

  /// 백엔드 안내(403)의 코드. 계약(422 ACCOUNT_NOT_PURCHASABLE)과 달라 확인 중(BR-27).
  static const accountNotAvailable = 'ACCOUNT_NOT_AVAILABLE';
  static const unsupported = 'UNSUPPORTED_ACTION';
  static const configRequired = 'CONFIG_REQUIRED';

  /// 앱 쪽 Google 설정 오류(서버 코드가 아니다).
  static const providerConfiguration = 'CLIENT_PROVIDER_CONFIGURATION';
}

/// 앱의 현재 로그인 상태.
@immutable
sealed class Session {
  const Session();
}

final class GuestSession extends Session {
  const GuestSession();
}

final class MemberSession extends Session {
  const MemberSession(this.accountId, {this.provider, this.accountLabel});

  final String accountId;

  /// 로그인한 제공자. 앱을 다시 켜서 복원한 세션은 모른다(null).
  final SocialProvider? provider;

  /// 제공자 SDK 가 알려 준 계정 표시(이메일 등). 이 기기 화면에만 보이고 저장·로그·서버 전송하지 않는다.
  final String? accountLabel;
}

/// 제공자 SDK 결과: 서버에 보낼 토큰과 화면 표시용 계정 이름.
@immutable
final class SocialCredential {
  const SocialCredential(this.token, {this.accountLabel});

  final String token;
  final String? accountLabel;

  /// 토큰·계정 값을 로그에 남기지 않는다.
  @override
  String toString() => 'SocialCredential(***)';
}
