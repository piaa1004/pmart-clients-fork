import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_api_rider/pmart_api_rider.dart' as rd;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/providers.dart';

/// 계정 제한(rider-service `AccountRestriction`, RS-1).
enum Restriction {
  normal,

  /// 신규배차 제한 — 진행 중 배송은 끝까지.
  dispatchRestricted,

  /// 일시 중지 — 운행 시작 불가.
  suspended,

  /// 계약 종료.
  terminated;

  bool get restricted => this != normal;

  static Restriction fromWire(String? w) => switch (w) {
    'DISPATCH_RESTRICTED' => dispatchRestricted,
    'SUSPENDED' => suspended,
    'TERMINATED' => terminated,
    _ => normal,
  };
}

/// 내 정보(`GET /riders/me`). 제한 사유는 운영자 기록이라 앱에 보이지 않는다.
@immutable
class RiderProfileView {
  const RiderProfileView({
    required this.riderId,
    this.name,
    this.restriction = Restriction.normal,
    this.restrictedUntil,
  });

  final String riderId;
  final String? name;
  final Restriction restriction;

  /// 제한 기한. null 이면 무기한.
  final DateTime? restrictedUntil;
}

abstract interface class ProfileRepository {
  /// 미가입이면 404 [ProblemFailure].
  Future<RiderProfileView> me();
}

final class ApiProfileRepository implements ProfileRepository {
  ApiProfileRepository(Dio dio) : _me = rd.PmartApiRider(dio: dio).getMeApi();

  final rd.MeApi _me;

  @override
  Future<RiderProfileView> me() async {
    final res = await pmartGuard(() => _me.getMyRider());
    final p =
        res.data ??
        (throw const ContractViolationFailure('RiderProfile 본문 없음'));
    return RiderProfileView(
      riderId:
          p.riderId ?? (throw const ContractViolationFailure('riderId 없음')),
      name: p.name,
      restriction: Restriction.fromWire(p.restriction?.state?.value),
      restrictedUntil: p.restriction?.until,
    );
  }
}

/// 목. [restriction] 을 바꿔 제한·해제를 흉내 낸다.
final class MockProfileRepository implements ProfileRepository {
  MockProfileRepository({this.latency = Duration.zero});

  final Duration latency;
  Restriction restriction = Restriction.normal;
  DateTime? until;

  @override
  Future<RiderProfileView> me() async {
    await Future<void>.delayed(latency);
    return RiderProfileView(
      riderId: 'rider-mock-1',
      name: '홍길동',
      restriction: restriction,
      restrictedUntil: until,
    );
  }
}

final profileRepositoryProvider = Provider<ProfileRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => MockProfileRepository(),
    PmartEnv.local => ApiProfileRepository(ref.watch(dioProvider)),
  },
);

/// 내 정보. 앱 실행·포그라운드 복귀·운행 상태 변경 실패 때 다시 읽는다.
final profileProvider = FutureProvider<RiderProfileView>(
  (ref) => ref.watch(profileRepositoryProvider).me(),
);

/// 인사말: 가입 때 쓴 이름이 있으면 "홍길동 라이더님", 없으면(조회 전·실패) "라이더님".
String riderGreetingText(
  String? name,
  String Function(String) named,
  String plain,
) {
  final n = name?.trim() ?? '';
  return n.isEmpty ? plain : named(n);
}
