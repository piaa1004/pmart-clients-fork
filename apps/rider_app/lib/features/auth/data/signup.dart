import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_api_rider/pmart_api_rider.dart' as rd;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/mfc_directory.dart';
import '../../../shared/providers.dart';

/// 배달 수단 = rider-service `VehicleType`(E_BIKE·KICKBOARD 는 2026-11-16 계약 추가 — 수행료는 자전거와 같다).
enum Vehicle { motorcycle, bicycle, eBike, kickboard, car, walk }

/// 약관 한 줄. 본문은 약관 확정 뒤 서버·문서에서 받는다(지금은 제목만).
@immutable
class ConsentItem {
  const ConsentItem({required this.type, required this.required});

  final String type;
  final bool required;
}

/// 배달 지역 = MFC 지점(계약 `RiderSignupRequest.deliveryAreas[].mfcId`).
/// 지점 목록을 주는 경로가 계약에 없어 사용자가 준 26개 지점(목 코드)을 쓴다.
@immutable
class AreaOption {
  const AreaOption({
    required this.region,
    required this.mfcId,
    required this.name,
  });

  final MfcRegion region;
  final String mfcId;
  final String name;
}

/// 가입 입력(`POST /riders/signups` 본문 + 면허).
@immutable
class SignupDraft {
  const SignupDraft({
    this.consents = const {},
    this.phone = '',
    this.name = '',
    this.bankName,
    this.holderName = '',
    this.accountNumber = '',
    this.roadAddress = '',
    this.addressLabel = '',
    this.addressDetail = '',
    this.area,
    this.vehicle,
    this.licenseNumber = '',
    this.licenseChecked = false,
  });

  final Set<String> consents;
  final String phone;
  final String name;
  final String? bankName;
  final String holderName;
  final String accountNumber;

  /// 주소 검색에서 고른 도로명주소(직접 친 글자는 받지 않는다).
  final String roadAddress;

  /// 라이더가 고른 표기(도로명 또는 지번).
  final String addressLabel;
  final String addressDetail;
  final AreaOption? area;
  final Vehicle? vehicle;

  /// 운전면허 번호. 오토바이·자동차·킥보드는 필수, 그 밖은 선택. 넣었으면 중복 확인을 통과해야 한다.
  final String licenseNumber;
  final bool licenseChecked;

  SignupDraft copyWith({
    Set<String>? consents,
    String? phone,
    String? name,
    String? bankName,
    String? holderName,
    String? accountNumber,
    String? roadAddress,
    String? addressLabel,
    String? addressDetail,
    AreaOption? area,
    Vehicle? vehicle,
    String? licenseNumber,
    bool? licenseChecked,
  }) => SignupDraft(
    consents: consents ?? this.consents,
    phone: phone ?? this.phone,
    name: name ?? this.name,
    bankName: bankName ?? this.bankName,
    holderName: holderName ?? this.holderName,
    accountNumber: accountNumber ?? this.accountNumber,
    roadAddress: roadAddress ?? this.roadAddress,
    addressLabel: addressLabel ?? this.addressLabel,
    addressDetail: addressDetail ?? this.addressDetail,
    area: area ?? this.area,
    vehicle: vehicle ?? this.vehicle,
    licenseNumber: licenseNumber ?? this.licenseNumber,
    licenseChecked: licenseChecked ?? this.licenseChecked,
  );
}

String _compact(String s) => s.replaceAll(RegExp(r'\s'), '');

/// 예금주가 가입자 이름과 같은지(공백 무시). 실제 계좌 실명 확인은 서버·외부 기관 몫이다.
bool holderMatchesName(String holder, String name) =>
    _compact(holder).isNotEmpty && _compact(holder) == _compact(name);

/// 이름: 완성된 한글 글자(가~힣) 또는 영문, 2글자 이상. 자음·모음만 친 것(ㄱ·ㅏ 등)은 받지 않는다
/// (사용자 요청 2026-11-17). 띄어쓰기는 영문 이름 사이에만 허용.
final _namePattern = RegExp(r'^(?:[가-힣]+|[A-Za-z]+(?: [A-Za-z]+)*)$');

bool nameValid(String name) {
  final n = name.trim();
  return n.length >= 2 && _namePattern.hasMatch(n);
}

/// 자음·모음 낱자가 들어 있는지(한글 호환 자모·자모 블록).
bool hasLooseJamo(String s) => RegExp(r'[ᄀ-ᇿ㄰-㆏ꥠ-꥿ힰ-퟿]').hasMatch(s);

/// 운전면허가 필요한 수단(사용자 결정 2026-11-16: 오토바이·자동차·킥보드는 필수).
/// 자전거·전기자전거·도보는 선택 — 넣었으면 중복 확인까지 해야 한다.
bool licenseRequired(Vehicle? v) =>
    v == Vehicle.motorcycle || v == Vehicle.car || v == Vehicle.kickboard;

/// 운전면허 번호 형식(지역 2 · 연도 2 · 일련 6 · 검증 2 = 12자리, 하이픈 선택).
final licensePattern = RegExp(r'^\d{2}-?\d{2}-?\d{6}-?\d{2}$');

String normalizeLicense(String s) => s.replaceAll(RegExp(r'[^0-9]'), '');

/// 가입 화면에 쓰는 선택지(목).
abstract final class SignupOptions {
  static const consents = [
    ConsentItem(type: 'DELIVERY_AGENCY_CONTRACT', required: true),
    ConsentItem(type: 'PRIVACY_COLLECTION', required: true),
    ConsentItem(type: 'LOCATION_SERVICE', required: true),
    ConsentItem(type: 'PRIVACY_THIRD_PARTY', required: true),
    ConsentItem(type: 'MARKETING', required: false),
  ];

  static const banks = [
    '국민은행',
    '신한은행',
    '우리은행',
    '하나은행',
    '농협은행',
    '카카오뱅크',
    '토스뱅크',
  ];

  /// 권역별 지점(충청 7 · 강원 2 · 전라 4 · 경상 13). 이름순 — 같은 도시(대구·부산…)끼리 모인다.
  static Map<MfcRegion, List<AreaOption>> get areas => {
    for (final r in MfcRegion.values)
      r: [
        for (final b in mfcBranches.where((b) => b.region == r))
          AreaOption(region: r, mfcId: b.id, name: b.name),
      ]..sort((a, b) => a.name.compareTo(b.name)),
  };
}

/// 가입(`POST /riders/signups`). 서버가 프로필을 돌려주면 바로 운행할 수 있다(즉시 승인).
abstract interface class SignupRepository {
  Future<void> submit(SignupDraft draft);

  /// 운전면허 중복 확인(`POST /riders/license-checks`). true 면 쓸 수 있다.
  Future<bool> isLicenseAvailable(String licenseNumber);

  /// 휴대폰 번호 중복 확인("인증하기" — 본인인증이 아니라 중복만, 사용자 결정 2026-11-10).
  /// true 면 쓸 수 있다. null = 가입 전 확인 API 가 없다(실서버) — 가입 때 서버가 409 DUPLICATE_RIDER 로 거절한다.
  /// 백엔드 요청 중(handoff rider-app/2026-11-16-backend-trip-info-and-signup.md §14).
  Future<bool?> isPhoneAvailable(String phone);

  /// 정산 계좌 중복 확인("인증하기" — 실명·1원 인증이 아니라 다른 라이더가 등록했는지만).
  /// true 면 쓸 수 있다. null = 확인 API 가 없다(실서버) — 백엔드 요청 중(handoff §15).
  Future<bool?> isAccountAvailable(String bankName, String accountNumber);
}

/// 목 구현(휴대폰·계좌 중복도 흉내 낸다).
final class MockSignupRepository implements SignupRepository {
  MockSignupRepository({this.latency = const Duration(milliseconds: 400)});

  final Duration latency;
  SignupDraft? submitted;

  /// 이미 등록된 면허(시연용 가짜 번호).
  final registeredLicenses = <String>{'112233333344'};

  @override
  Future<void> submit(SignupDraft draft) async {
    await Future<void>.delayed(latency);
    submitted = draft;
    registeredPhones.add(draft.phone);
    if (draft.bankName != null && draft.accountNumber.isNotEmpty) {
      registeredAccounts.add('${draft.bankName}|${draft.accountNumber}');
    }
    if (draft.licenseNumber.isNotEmpty) {
      registeredLicenses.add(normalizeLicense(draft.licenseNumber));
    }
  }

  @override
  Future<bool> isLicenseAvailable(String licenseNumber) async {
    await Future<void>.delayed(latency);
    return !registeredLicenses.contains(normalizeLicense(licenseNumber));
  }

  /// 이미 가입한 휴대폰 번호(시연용 가짜 번호).
  final registeredPhones = <String>{'01011112222'};

  @override
  Future<bool?> isPhoneAvailable(String phone) async {
    await Future<void>.delayed(latency);
    return !registeredPhones.contains(phone);
  }

  /// 이미 다른 라이더가 등록한 계좌(시연용 가짜 — 은행|번호).
  final registeredAccounts = <String>{'국민은행|1111222233'};

  @override
  Future<bool?> isAccountAvailable(
    String bankName,
    String accountNumber,
  ) async {
    await Future<void>.delayed(latency);
    return !registeredAccounts.contains('$bankName|$accountNumber');
  }
}

/// 실서버 가입(rider-service). 라이더 토큰(Google 로그인)이 있어야 부를 수 있다.
///
/// - 같은 가입은 같은 멱등 키로 다시 보낸다(성공하면 새 키).
/// - 은행: 계약 `bankCode` 형식이 정해지지 않아 은행 이름을 그대로 보낸다 — 백엔드에 물음(handoff §16).
/// - 배달 지역 `mfcId` 는 서버 지점 목록(`GET /mfc-pickup-points`)의 CenterId 여야 한다 — 그 목록은
///   생성 클라이언트에 아직 없다(center-master 생성은 PC 1, handoff §16). 지금은 앱의 26개 지점 코드.
final class ApiSignupRepository implements SignupRepository {
  ApiSignupRepository(Dio dio)
    : _signup = rd.PmartApiRider(dio: dio).getSignupApi();

  final rd.SignupApi _signup;
  IdempotencyKey? _key;

  @override
  Future<void> submit(SignupDraft draft) async {
    final key = _key ??= IdempotencyKey.generate();
    final vehicle = draft.vehicle;
    final area = draft.area;
    if (vehicle == null || area == null) {
      throw const ContractViolationFailure('가입 입력이 끝나지 않았다');
    }
    await pmartGuard(
      () => _signup.createRiderSignup(
        idempotencyKey: key.value,
        xSourceSystem: sourceSystem,
        riderSignupRequest: rd.RiderSignupRequest(
          phone: draft.phone,
          name: draft.name.trim(),
          vehicleType: vehicleToContract(vehicle),
          licenseNumber: draft.licenseNumber.trim().isEmpty
              ? null
              : draft.licenseNumber.trim(),
          bankAccount: draft.bankName == null || draft.accountNumber.isEmpty
              ? null
              : rd.RiderSignupRequestBankAccount(
                  bankCode: draft.bankName!,
                  accountNumber: draft.accountNumber,
                  holderName: draft.holderName.trim(),
                ),
          residence: rd.RiderSignupRequestResidence(
            roadAddress: draft.roadAddress,
            detail: draft.addressDetail.trim(),
          ),
          deliveryAreas: [
            rd.RiderSignupRequestDeliveryAreasInner(mfcId: area.mfcId),
          ],
          consents: [
            for (final c in draft.consents)
              rd.RiderSignupRequestConsentsInner(consentType: c),
          ],
        ),
        extra: commandOptions(key).extra,
      ),
    );
    _key = null;
  }

  @override
  Future<bool> isLicenseAvailable(String licenseNumber) async {
    final res = await pmartGuard(
      () => _signup.checkRiderLicense(
        checkRiderLicenseRequest: rd.CheckRiderLicenseRequest(
          licenseNumber: licenseNumber.trim(),
        ),
      ),
    );
    return res.data?.available ??
        (throw const ContractViolationFailure('license-checks 본문 없음'));
  }

  /// 가입 전 확인 API 가 없다 — 가입 때 서버가 확인한다.
  @override
  Future<bool?> isPhoneAvailable(String phone) async => null;

  /// 확인 API 가 없다.
  @override
  Future<bool?> isAccountAvailable(
    String bankName,
    String accountNumber,
  ) async => null;
}

rd.VehicleType vehicleToContract(Vehicle v) => switch (v) {
  Vehicle.motorcycle => rd.VehicleType.MOTORCYCLE,
  Vehicle.bicycle => rd.VehicleType.BICYCLE,
  Vehicle.eBike => rd.VehicleType.E_BIKE,
  Vehicle.kickboard => rd.VehicleType.KICKBOARD,
  Vehicle.car => rd.VehicleType.CAR,
  Vehicle.walk => rd.VehicleType.WALK,
};

final signupRepositoryProvider = Provider<SignupRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => MockSignupRepository(),
    PmartEnv.local => ApiSignupRepository(ref.watch(dioProvider)),
  },
);
