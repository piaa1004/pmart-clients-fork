import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_api_center_master/pmart_api_center_master.dart' as cm;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/mfc_directory.dart';
import '../../../shared/providers.dart';
import 'signup.dart';

/// 배달 지역(픽업 MFC) 목록. 실서버는 center-master `GET /mfc-pickup-points`(라이더 토큰, 운영 중 MFC 만 —
/// 백엔드 회신 2026-11-16) — 가입 `deliveryAreas[].mfcId` 에 이 centerId 를 쓴다. 목은 앱 지점표(26곳).
abstract interface class PickupPointRepository {
  Future<Map<MfcRegion, List<AreaOption>>> areas();
}

final class MockPickupPointRepository implements PickupPointRepository {
  const MockPickupPointRepository();

  @override
  Future<Map<MfcRegion, List<AreaOption>>> areas() async => SignupOptions.areas;
}

final class ApiPickupPointRepository implements PickupPointRepository {
  ApiPickupPointRepository(Dio dio)
    : _centers = cm.PmartApiCenterMaster(dio: dio).getCentersApi();

  final cm.CentersApi _centers;

  @override
  Future<Map<MfcRegion, List<AreaOption>>> areas() async {
    final res = await pmartGuard(() => _centers.listMfcPickupPoints());
    final items = res.data?.items ?? const <cm.PickupPoint>[];
    return {
      for (final r in MfcRegion.values)
        r: [
          for (final p in items)
            if (regionOfPickupPoint(p.name, p.address) == r)
              AreaOption(region: r, mfcId: p.centerId, name: p.name),
        ]..sort((a, b) => a.name.compareTo(b.name)),
    };
  }
}

/// 서버 지점의 권역: 앱 지점표에 같은 이름이 있으면 그 권역, 아니면 주소 앞부분(시·도)으로.
/// 서버 목록에 권역 칸이 없어 앱이 나눈다(사용자 요청 2026-11-17 — 충청·강원·전라·경상).
MfcRegion regionOfPickupPoint(String name, String? address) {
  for (final b in mfcBranches) {
    if (name.contains(b.name)) return b.region;
  }
  final a = (address ?? '').trim();
  bool starts(List<String> ps) => ps.any(a.startsWith);
  if (starts(['강원'])) return MfcRegion.gangwon;
  if (starts(['대전', '세종', '충남', '충북', '충청', '천안', '청주'])) {
    return MfcRegion.chungcheong;
  }
  if (starts(['광주', '전남', '전북', '전라', '전주', '목포'])) {
    return MfcRegion.jeolla;
  }
  return MfcRegion.gyeongsang;
}

final pickupPointRepositoryProvider = Provider<PickupPointRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => const MockPickupPointRepository(),
    PmartEnv.local => ApiPickupPointRepository(ref.watch(dioProvider)),
  },
);

final areaOptionsProvider =
    FutureProvider.autoDispose<Map<MfcRegion, List<AreaOption>>>(
      (ref) => ref.watch(pickupPointRepositoryProvider).areas(),
    );

/// 서버 지점 이름을 한 번 읽어 [serverStoreNames] 에 채운다(마이페이지·홈의 "PMart ○○지점" 표시).
/// 못 읽으면 조용히 넘어간다 — 화면은 코드를 보인다. 실패를 "지점 없음"으로 바꾸지 않는다.
final storeNamesProvider = FutureProvider<int>((ref) async {
  try {
    final areas = await ref.watch(pickupPointRepositoryProvider).areas();
    for (final list in areas.values) {
      for (final a in list) {
        serverStoreNames[a.mfcId] = a.name;
      }
    }
    return serverStoreNames.length;
  } on PmartFailure {
    return serverStoreNames.length;
  }
});
