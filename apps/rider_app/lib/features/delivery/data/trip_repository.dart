import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_api_delivery_dispatch/pmart_api_delivery_dispatch.dart'
    as dp;
import 'package:pmart_api_delivery_execution/pmart_api_delivery_execution.dart'
    as ex;
import 'package:pmart_core/pmart_core.dart';

import '../../../shared/mfc_directory.dart';
import '../../../shared/providers.dart';
import '../domain/delivery.dart';
import '../domain/trip.dart';

/// 배송의 주문·픽업지 요약.
abstract interface class TripRepository {
  Future<TripInfo?> forDelivery(String deliveryId);
}

/// 제안에서 받은 요약(배송 ID 별). 수락 뒤 배송 조회에는 좌표·소요가 없어 제안 때 값을 이어 쓴다.
final _offerTrips = <String, TripInfo>{};

/// 제안 요약(dispatch 0.4.5~ `summary.order`·`dropEtaSeconds`·`pickupPoint`·`dropAreaPoint`) →
/// 화면 요약. 예정 시각은 서버 값이 없어 "지금 + 소요"로 잡는다(백엔드 회신 2026-11-16 §3 — 수락
/// 시각 + pickupEtaSeconds / + dropEtaSeconds). 제안이 보일 때마다 새로 적으므로 수락 직전 값이 남는다.
void rememberOfferTrip(String deliveryId, dp.OfferSummary s, {DateTime? now}) {
  final at = now ?? DateTime.now();
  final order = s.order;
  if ((s.mfcId, order?.mfcName) case (final id?, final name?)) {
    serverStoreNames[id] = name;
  }
  final pickupDue = s.pickupEtaSeconds == null
      ? null
      : at.add(Duration(seconds: s.pickupEtaSeconds!));
  final dropDue = pickupDue == null || s.dropEtaSeconds == null
      ? null
      : pickupDue.add(Duration(seconds: s.dropEtaSeconds!));
  _offerTrips[deliveryId] = TripInfo(
    orderNo: order?.orderNumber ?? order?.orderId ?? '',
    store: _serverStore(
      s.mfcId,
      name: order?.mfcName,
      address: order?.mfcAddress,
      point: s.pickupPoint,
    ),
    items: [
      for (final i in order?.items ?? const <dp.OfferOrderInfoItemsInner>[])
        OrderLine(
          name: [?i.name, ?i.optionLabel].join(' '),
          qty: i.qty ?? 0,
          amount: i.lineAmount ?? 0,
        ),
    ],
    menuTotal: order?.itemAmount,
    deliveryRequest: order?.deliveryNote,
    dropLabel: s.dropAreaLabel,
    drop: switch (s.dropAreaPoint) {
      final p? => (lat: p.lat, lng: p.lng),
      null => null,
    },
    pickupDueAt: pickupDue,
    dropDueAt: dropDue,
    dropEtaSeconds: s.dropEtaSeconds,
  );
}

/// 서버 값으로 만든 픽업지. 가게 전화는 서버에 아직 없다(null). 좌표가 없으면 앱 지점표 좌표.
MfcBranch _serverStore(
  String? mfcId, {
  String? name,
  String? address,
  dp.LatLng? point,
}) {
  final known = mfcById(mfcId);
  return MfcBranch(
    id: mfcId ?? '',
    name: name ?? known?.name ?? '',
    region: known?.region ?? MfcRegion.gyeongsang,
    address: address ?? known?.address ?? '',
    lat: point?.lat ?? known?.lat ?? 0,
    lng: point?.lng ?? known?.lng ?? 0,
  );
}

/// 실서버: 배송 조회의 주문 요약(execution `orderSummary`) + 제안 때 받은 좌표·소요.
/// 배정 전(제안만 있는 배송)은 배송 조회가 안 되므로 제안 요약만 쓴다.
final class ApiTripRepository implements TripRepository {
  ApiTripRepository(Dio dio)
    : _exec = ex.PmartApiDeliveryExecution(dio: dio).getExecutionApi();

  final ex.ExecutionApi _exec;

  @override
  Future<TripInfo?> forDelivery(String deliveryId) async {
    final hint = _offerTrips[deliveryId];
    ex.DeliveryExecution? d;
    try {
      d = (await pmartGuard(
        () => _exec.getDeliveryExecution(deliveryId: deliveryId),
      )).data;
    } on PmartFailure {
      if (hint == null) rethrow;
    }
    final summary = d?.orderSummary;
    if (summary == null) return hint;
    final items = [
      for (final i
          in summary.items ??
              const <ex.DeliveryExecutionOrderSummaryItemsInner>[])
        OrderLine(
          name: [?i.name, ?i.optionLabel].join(' '),
          qty: i.qty ?? 0,
          amount: i.lineAmount ?? 0,
        ),
    ];
    return TripInfo(
      orderNo:
          summary.orderNumber ??
          (hint?.orderNo.isNotEmpty == true ? hint!.orderNo : d?.orderId ?? ''),
      store: hint?.store ?? _serverStore(d?.mfcId),
      items: items.isEmpty ? hint?.items ?? const [] : items,
      menuTotal: summary.itemAmount ?? hint?.menuTotal,
      deliveryRequest: summary.deliveryNote ?? hint?.deliveryRequest,
      dropLabel: hint?.dropLabel,
      drop: hint?.drop,
      pickupDueAt: hint?.pickupDueAt,
      dropDueAt: hint?.dropDueAt,
      dropEtaSeconds: hint?.dropEtaSeconds,
    );
  }
}

/// 목 주문(부산진구지점). 이름·전화·주소는 모두 가짜다.
final class MockTripRepository implements TripRepository {
  MockTripRepository({DateTime? now}) : _now = now ?? DateTime.now();

  final DateTime _now;

  @override
  Future<TripInfo?> forDelivery(String deliveryId) async =>
      mockTrip(deliveryId, now: _now);
}

typedef _Seed = ({
  String orderNo,
  String dropLabel,
  double lat,
  double lng,
  List<OrderLine> items,
  String? storeRequest,
  String deliveryRequest,
  String road,
  String detail,
  int dropEtaMin,
});

const _seeds = <String, _Seed>{
  'dlv-1': (
    orderNo: '48213075',
    dropLabel: '부산진구 전포동',
    lat: 35.1565,
    lng: 129.0665,
    // 고객앱 목의 진행 중 주문과 같은 주문(품목·금액·요청사항) — 두 앱 목 맞추기(사용자 요청 2026-11-16).
    items: [OrderLine(name: '그릭요거트 플레인 400g', qty: 3, amount: 17940)],
    storeRequest: null,
    deliveryRequest: '문 앞에 두고 벨은 누르지 말아 주세요',
    road: '부산 부산진구 전포대로 210',
    detail: '전포 한빛아파트 103동 1203호',
    dropEtaMin: 12,
  ),
  'dlv-b1': (
    orderNo: '33017524',
    dropLabel: '부산진구 부전동',
    lat: 35.1620,
    lng: 129.0585,
    items: [
      OrderLine(name: '삼다수 2L × 6', qty: 1, amount: 6900),
      OrderLine(name: '계란 30구', qty: 1, amount: 8990),
    ],
    storeRequest: null,
    deliveryRequest: '경비실에 맡겨 주세요',
    road: '부산 부산진구 중앙대로 750',
    detail: '부전 서면타워 1205호',
    dropEtaMin: 14,
  ),
  'dlv-b2': (
    orderNo: '33017561',
    dropLabel: '부산진구 범천동',
    lat: 35.1455,
    lng: 129.0615,
    items: [
      OrderLine(name: '두부 300g', qty: 2, amount: 3600),
      OrderLine(name: '양파 1.5kg', qty: 1, amount: 4290),
    ],
    storeRequest: '두부는 유통기한 긴 것으로 부탁드려요',
    deliveryRequest: '도착하면 전화 주세요',
    road: '부산 부산진구 범일로 120',
    detail: '범천 그린아파트 301동 1104호',
    dropEtaMin: 20,
  ),
  'dlv-l1': (
    orderNo: '59102438',
    dropLabel: '부산진구 양정동',
    lat: 35.1705,
    lng: 129.0725,
    items: [OrderLine(name: '컵라면 6입', qty: 1, amount: 5980)],
    storeRequest: null,
    deliveryRequest: '문 앞에 두고 문자 주세요',
    road: '부산 부산진구 중앙대로 900',
    detail: '양정빌 202호',
    dropEtaMin: 9,
  ),
  'dlv-l2': (
    orderNo: '59102466',
    dropLabel: '부산진구 연지동',
    lat: 35.1685,
    lng: 129.0530,
    items: [
      OrderLine(name: '맥주 500ml × 4', qty: 1, amount: 11000),
      OrderLine(name: '감자칩 대용량', qty: 2, amount: 6980),
    ],
    storeRequest: null,
    deliveryRequest: '공동현관 호출 후 올라오세요',
    road: '부산 부산진구 신천대로 50',
    detail: '연지 스카이뷰 1501호',
    dropEtaMin: 11,
  ),
};

/// 목 주문 요약. 표에 없는 배송은 첫 배송 값을 쓴다.
TripInfo mockTrip(String deliveryId, {DateTime? now}) {
  final s = _seeds[deliveryId] ?? _seeds['dlv-1']!;
  final base = now ?? DateTime.now();
  return TripInfo(
    orderNo: s.orderNo,
    store: demoMfc,
    items: s.items,
    menuTotal: s.items.fold<int>(0, (a, l) => a + l.amount),
    storeRequest: s.storeRequest,
    deliveryRequest: s.deliveryRequest,
    dropLabel: s.dropLabel,
    drop: (lat: s.lat, lng: s.lng),
    pickupDueAt: base.add(const Duration(minutes: 6)),
    dropDueAt: base.add(Duration(minutes: 6 + s.dropEtaMin)),
    dropEtaSeconds: s.dropEtaMin * 60,
  );
}

/// 목 전달지(BR-24 모양). 개인정보 흉내 — 가짜 값이다.
DropInfo mockDropInfo(String deliveryId) {
  final s = _seeds[deliveryId] ?? _seeds['dlv-1']!;
  return DropInfo(
    roadAddress: s.road,
    detailAddress: s.detail,
    // 고객앱 목 배송지의 받는 분과 같게.
    receiverName: '김피마',
    receiverPhone: '01000000000',
    entranceMethod: EntranceMethod.password,
    entranceNote: '공동현관 #1234',
    deliveryNote: s.deliveryRequest,
    lat: s.lat,
    lng: s.lng,
  );
}

final tripRepositoryProvider = Provider<TripRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => MockTripRepository(),
    PmartEnv.local => ApiTripRepository(ref.watch(dioProvider)),
  },
);

/// 배송의 주문 요약(서버 값이 없으면 null — 화면은 계약에 있는 값만).
final tripInfoProvider = FutureProvider.autoDispose.family<TripInfo?, String>(
  (ref, id) => ref.watch(tripRepositoryProvider).forDelivery(id),
);
