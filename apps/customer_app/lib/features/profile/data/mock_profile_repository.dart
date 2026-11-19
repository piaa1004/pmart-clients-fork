import 'dart:typed_data';

import 'package:pmart_core/pmart_core.dart';

import '../domain/profile.dart';
import 'profile_repository.dart';

/// 목 프로필. 저장한 번호는 서버처럼 가려서 돌려준다.
final class MockProfileRepository implements ProfileRepository {
  MockProfileRepository({this.latency = const Duration(milliseconds: 200)});

  final Duration latency;

  /// 등록된 휴대폰 번호(숫자). 서버처럼 가린 값과 본인용 원래 값을 같이 돌려준다(customer 0.7.0 — BR-32).
  String? phone;

  /// 번호 확인(OCTOMO)됨 — 번호를 바꾸면 다시 false.
  bool phoneVerified = false;

  /// 다음 연락처 저장을 400(옛 서버처럼)으로 만든다.
  bool rejectPhone = false;

  /// 새로 가입한 계정처럼 이름이 비어 있다.
  String? nickname;

  /// 로그인 제공자(Google) 프로필. 기본은 없음(카카오·네이버 목 로그인처럼). 테스트에서 채운다.
  String? name;
  String? email;
  bool? emailVerified;
  String? profileImageUrl;

  /// `GET /me/profile-image` 가 돌려줄 사진. null 이면 사본 없음(404).
  Uint8List? imageBytes;
  int imageReads = 0;
  int _version = 1;

  /// 다음 변경을 501(미구현)로 만든다.
  bool unsupported = false;

  final changeKeys = <String>[];

  Future<void> _wait() => Future<void>.delayed(latency);

  static String mask(String digits) => digits.length < 7
      ? '***'
      : '${digits.substring(0, 3)}-****-${digits.substring(digits.length - 4)}';

  @override
  Future<Profile> get() async {
    await _wait();
    return Profile(
      accountId: 'acct-mock-1',
      version: _version,
      nickname: nickname,
      phoneMasked: phone == null ? null : mask(phone!),
      phone: phone,
      phoneVerified: phoneVerified,
      name: name,
      email: email,
      emailVerified: emailVerified,
      profileImageUrl: profileImageUrl,
    );
  }

  @override
  Future<Uint8List?> profileImage() async {
    await _wait();
    imageReads++;
    return imageBytes;
  }

  @override
  Future<ProfileChangeOutcome> changeProfile({
    String? nickname,
    String? phone,
    required int expectedVersion,
    required IdempotencyKey key,
  }) async {
    await _wait();
    changeKeys.add(key.value);
    if (unsupported) {
      return profileChangeFailure(const UnknownResultFailure(httpStatus: 501));
    }
    if (expectedVersion != _version) {
      return const ProfileChangeRejected(ProblemCode.versionConflict);
    }
    // 0.7.0: 휴대폰 01X 10~11자리(하이픈은 서버가 뗀다), 빈 값이면 지운다. 그 밖은 400 VALIDATION_FAILED.
    if (phone != null) {
      final digits = PhoneInput.normalize(phone);
      if (rejectPhone || (digits.isNotEmpty && !PhoneInput.valid(digits))) {
        return const ProfileChangeRejected(ProblemCode.validationFailed);
      }
      final next = digits.isEmpty ? null : digits;
      if (next != this.phone) phoneVerified = false;
      this.phone = next;
    }
    if (nickname != null) this.nickname = nickname;
    _version++;
    return const ProfileChangeApplied();
  }

  @override
  Future<ProfileChangeOutcome> change(String requestId) async {
    await _wait();
    return const ProfileChangeApplied();
  }
}
