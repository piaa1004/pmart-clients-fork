import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:pmart_api_customer/pmart_api_customer.dart' as api;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart' show sourceSystem;
import '../domain/profile.dart';

/// 본인 프로필·연락처 변경(customer-service profile 태그).
abstract interface class ProfileRepository {
  /// `GET /me`. 실패는 [PmartFailure] 로 던진다.
  Future<Profile> get();

  /// `POST /me/profile-changes {nickname?, phone?}`. 바뀐 항목만 보낸다.
  /// 결과 불명은 같은 [key] 재전송·[change] 짝 조회로 해소한다.
  Future<ProfileChangeOutcome> changeProfile({
    String? nickname,
    String? phone,
    required int expectedVersion,
    required IdempotencyKey key,
  });

  /// `GET /me/profile-changes/{requestId}` 짝 조회.
  Future<ProfileChangeOutcome> change(String requestId);

  /// `GET /me/profile-image` — 로그인 제공자 사진의 서버 사본(본인 토큰 필요, ADR-0024).
  /// 사본이 아직 없으면(404) null. 그 밖의 실패는 [PmartFailure] 로 던진다.
  Future<Uint8List?> profileImage();
}

final class ApiProfileRepository implements ProfileRepository {
  ApiProfileRepository(Dio dio)
    : _api = api.PmartApiCustomer(dio: dio).getProfileApi();

  final api.ProfileApi _api;

  @override
  Future<Profile> get() async {
    final res = await pmartGuard(() => _api.getMyProfile());
    final p = res.data ?? (throw const ContractViolationFailure('프로필 본문 없음'));
    return profileFromContract(p);
  }

  @override
  Future<Uint8List?> profileImage() async {
    try {
      final res = await pmartGuard(() => _api.getMyProfileImage());
      final bytes = res.data;
      return (bytes == null || bytes.isEmpty) ? null : bytes;
    } on ProblemFailure catch (f) {
      if (f.problem.status == 404 || f.problem.code == ProblemCode.notFound) {
        return null;
      }
      rethrow;
    }
  }

  @override
  Future<ProfileChangeOutcome> changeProfile({
    String? nickname,
    String? phone,
    required int expectedVersion,
    required IdempotencyKey key,
  }) async {
    try {
      final res = await pmartGuard(
        () => _api.changeMyProfile(
          idempotencyKey: key.value,
          xSourceSystem: sourceSystem,
          xExpectedVersion: expectedVersion,
          changeMyProfileRequest: api.ChangeMyProfileRequest(
            nickname: nickname,
            phone: phone,
          ),
          extra: commandOptions(key, expectedVersion: expectedVersion).extra,
        ),
      );
      return profileChangeFromContract(res.data, key.value);
    } on PmartFailure catch (f) {
      return profileChangeFailure(f);
    }
  }

  @override
  Future<ProfileChangeOutcome> change(String requestId) async {
    final res = await pmartGuard(
      () => _api.getMyProfileChange(requestId: requestId),
    );
    return profileChangeFromContract(res.data, requestId);
  }
}

ProfileChangeOutcome profileChangeFromContract(
  api.ChangeMyProfile200Response? r,
  String requestId,
) => switch (r?.status) {
  api.ChangeMyProfile200ResponseStatusEnum.APPLIED =>
    const ProfileChangeApplied(),
  api.ChangeMyProfile200ResponseStatusEnum.ACCEPTED => ProfileChangePending(
    r!.requestId,
  ),
  api.ChangeMyProfile200ResponseStatusEnum.REJECTED => ProfileChangeRejected(
    r!.nextAction ?? ProblemCode.domainRejected,
  ),
  _ => const ProfileChangeUnknown(),
};

/// 501 은 "아직 지원하지 않음"이 확정된 응답이다(변경 요청의 5xx 라도 결과 불명으로 두지 않는다).
ProfileChangeOutcome profileChangeFailure(PmartFailure f) => switch (f) {
  UnknownResultFailure(:final httpStatus, :final problem)
      when httpStatus == 501 || problem?.code == 'UNSUPPORTED_ACTION' =>
    const ProfileChangeUnsupported(),
  UnknownResultFailure() => const ProfileChangeUnknown(),
  ProblemFailure(:final problem) => ProfileChangeRejected(problem.code),
  _ => const ProfileChangeUnknown(),
};

/// 계약 `Profile` → 화면 모델. 빈 문자열은 "없음"(null)으로 둔다(Google 값은 없을 수 있다).
Profile profileFromContract(api.Profile p) {
  String? text(String? v) => (v == null || v.trim().isEmpty) ? null : v;
  return Profile(
    accountId:
        p.accountId ?? (throw const ContractViolationFailure('accountId 없음')),
    version: p.version ?? (throw const ContractViolationFailure('version 없음')),
    nickname: p.nickname,
    phoneMasked: p.phoneMasked,
    phone: text(p.phone),
    phoneVerified: p.phoneVerified ?? false,
    name: text(p.name),
    email: text(p.email),
    emailVerified: p.emailVerified,
    profileImageUrl: text(p.profileImageUrl),
  );
}
