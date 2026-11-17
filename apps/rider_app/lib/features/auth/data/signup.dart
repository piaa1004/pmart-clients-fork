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

/// 은행 선택지: 보이는 이름 + 보내는 코드.
typedef BankOption = ({String code, String name});

/// 가입 입력(`POST /riders/signups` 본문 + 면허).
@immutable
class SignupDraft {
  const SignupDraft({
    this.consents = const {},
    this.phone = '',
    this.name = '',
    this.bankName,
    this.bankCode,
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

  /// 금융결제원 은행 코드 3자리(서버로 보내는 값 — rider 0.7.0, 사용자 결정 2026-11-17).
  final String? bankCode;
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
    String? bankCode,
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
    bankCode: bankCode ?? this.bankCode,
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

  /// 목 은행 목록(금융결제원 코드). 실서버는 `GET /riders/bank-codes`.
  static const banks = <BankOption>[
    (code: '004', name: '국민은행'),
    (code: '088', name: '신한은행'),
    (code: '020', name: '우리은행'),
    (code: '081', name: '하나은행'),
    (code: '011', name: '농협은행'),
    (code: '090', name: '카카오뱅크'),
    (code: '092', name: '토스뱅크'),
  ];

  /// 약관 버전(약관 문서 작성 기준일). 서버는 버전 없는 동의를 기록하지 않는다(rider 회신 2026-11-17 §16-2).
  static const termsVersion = '2026-11-17';

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

  /// 휴대폰 번호 중복 확인("인증하기" — 본인인증이 아니라 중복만). `POST /riders/phone-checks`(rider 0.7.0).
  /// true 면 쓸 수 있다. null = 서버에 아직 그 경로가 없다(배포 전 404·405·501) — 가입 때 서버가 확인한다.
  Future<bool?> isPhoneAvailable(String phone);

  /// 정산 계좌 중복 확인(다른 라이더가 등록했는지만). `POST /riders/account-checks`(은행 코드 3자리).
  /// null = 서버에 아직 경로가 없다.
  Future<bool?> isAccountAvailable(String bankCode, String accountNumber);

  /// 은행 목록(이름·금융결제원 코드). `GET /riders/bank-codes`. 서버에 없으면 앱 목록.
  Future<List<BankOption>> banks();
}

/// 서버에 그 경로가 아직 없다(배포 전) — 확인을 "가입 때"로 미룬다. 실패를 통과로 바꾸지 않는다.
bool _notDeployed(PmartFailure f) => switch (f) {
  ProblemFailure(:final problem) => const {
    404,
    405,
    501,
  }.contains(problem.status),
  UnexpectedResponseFailure(:final httpStatus) => const {
    404,
    405,
    501,
  }.contains(httpStatus),
  UnknownResultFailure(:final httpStatus, :final problem) => const {
    404,
    405,
    501,
  }.contains(problem?.status ?? httpStatus),
  _ => false,
};

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
    if (draft.bankCode != null && draft.accountNumber.isNotEmpty) {
      registeredAccounts.add('${draft.bankCode}|${draft.accountNumber}');
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

  /// 이미 다른 라이더가 등록한 계좌(시연용 가짜 — 은행코드|번호, 국민 004).
  final registeredAccounts = <String>{'004|1111222233'};

  @override
  Future<bool?> isAccountAvailable(
    String bankCode,
    String accountNumber,
  ) async {
    await Future<void>.delayed(latency);
    return !registeredAccounts.contains('$bankCode|$accountNumber');
  }

  @override
  Future<List<BankOption>> banks() async => SignupOptions.banks;
}

/// 실서버 가입(rider-service 0.7.0). 라이더 토큰(Google 로그인)이 있어야 부를 수 있다.
///
/// - 같은 가입은 같은 멱등 키로 다시 보낸다(성공하면 새 키).
/// - 확인 경로(면허·번호·계좌)도 변경 요청 규칙대로 Idempotency-Key·X-Source-System 을 붙인다
///   (공통 인터셉터가 키 없는 POST 를 막는다 — 전에는 면허 확인이 서버로 나가지 않았다).
/// - 은행은 금융결제원 코드 3자리, 약관은 앱이 보여 준 버전([SignupOptions.termsVersion])을 보낸다.
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
          bankAccount: draft.bankCode == null || draft.accountNumber.isEmpty
              ? null
              : rd.RiderSignupRequestBankAccount(
                  bankCode: draft.bankCode!,
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
              rd.RiderSignupRequestConsentsInner(
                consentType: c,
                version: SignupOptions.termsVersion,
              ),
          ],
        ),
        extra: commandOptions(key).extra,
      ),
    );
    _key = null;
  }

  @override
  Future<bool> isLicenseAvailable(String licenseNumber) async {
    final key = IdempotencyKey.generate();
    final res = await pmartGuard(
      () => _signup.checkRiderLicense(
        checkRiderLicenseRequest: rd.CheckRiderLicenseRequest(
          licenseNumber: licenseNumber.trim(),
        ),
        extra: commandOptions(key).extra,
      ),
    );
    return res.data?.available ??
        (throw const ContractViolationFailure('license-checks 본문 없음'));
  }

  @override
  Future<bool?> isPhoneAvailable(String phone) async {
    final key = IdempotencyKey.generate();
    try {
      final res = await pmartGuard(
        () => _signup.checkRiderPhone(
          checkRiderPhoneRequest: rd.CheckRiderPhoneRequest(phone: phone),
          extra: commandOptions(key).extra,
        ),
      );
      return res.data?.available ??
          (throw const ContractViolationFailure('phone-checks 본문 없음'));
    } on PmartFailure catch (f) {
      if (_notDeployed(f)) return null;
      rethrow;
    }
  }

  @override
  Future<bool?> isAccountAvailable(
    String bankCode,
    String accountNumber,
  ) async {
    final key = IdempotencyKey.generate();
    try {
      final res = await pmartGuard(
        () => _signup.checkRiderAccount(
          checkRiderAccountRequest: rd.CheckRiderAccountRequest(
            bankCode: bankCode,
            accountNumber: accountNumber,
          ),
          extra: commandOptions(key).extra,
        ),
      );
      return res.data?.available ??
          (throw const ContractViolationFailure('account-checks 본문 없음'));
    } on PmartFailure catch (f) {
      if (_notDeployed(f)) return null;
      rethrow;
    }
  }

  @override
  Future<List<BankOption>> banks() async {
    try {
      final res = await pmartGuard(() => _signup.listBankCodes());
      final items = [
        for (final b
            in res.data?.items ??
                const <rd.ListBankCodes200ResponseItemsInner>[])
          (code: b.code, name: b.name),
      ];
      return items.isEmpty ? SignupOptions.banks : items;
    } on PmartFailure catch (f) {
      // 배포 전이면 앱 목록(같은 금융결제원 코드). 그 밖의 실패는 화면이 안내한다.
      if (_notDeployed(f)) return SignupOptions.banks;
      rethrow;
    }
  }
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
