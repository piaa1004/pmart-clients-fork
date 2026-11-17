import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/kakao_navi.dart';
import '../../../shared/location.dart';
import '../../../shared/mfc_directory.dart';
import '../../../shared/rider_map.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../../delivery/data/trip_repository.dart';
import '../../delivery/domain/trip.dart';
import '../../delivery/presentation/delivery_texts.dart';
import '../../delivery/presentation/phone_caller.dart';
import '../../delivery/presentation/trip_widgets.dart';
import '../domain/offer_list.dart';
import 'offer_actions.dart';
import 'offer_controllers.dart';

/// 지도 경로(픽업지 → 전달지 직선)와 핀 위 예정시간. 좌표가 없으면 null.
MapRoute? offerRoute(
  TripInfo? trip,
  String? mfcId, {
  DateTime? pickupAt,
  DateTime? dropAt,
  bool toDrop = false,
}) {
  final pickup = trip?.store.point ?? mfcById(mfcId)?.point;
  if (pickup == null) return null;
  return MapRoute(
    pickup: pickup,
    drop: trip?.drop,
    pickupTime: pickupAt == null ? null : clockText(pickupAt),
    dropTime: dropAt == null ? null : clockText(dropAt),
    // 직선: 내 위치 → 픽업지(픽업 전), 내 위치 → 전달지(픽업 뒤).
    toDrop: toDrop,
  );
}

/// 수락 전 제안의 핀 시간: 픽업 = 지금 + 픽업까지(서버 값), 전달 = 도착 예상.
MapRoute? offerMapRoute(OfferItem offer, TripInfo? trip, String? mfcId) =>
    offerRoute(
      trip,
      offer.mfcId ?? mfcId,
      pickupAt: switch (offer.pickupEtaSeconds) {
        final s? => DateTime.now().add(Duration(seconds: s)),
        null => null,
      },
      dropAt: offerArrival(offer, trip),
    );

/// 배정 뒤 핀 시간: 픽업 전에는 픽업·전달 예정, 픽업 뒤에는 전달 예정만.
MapRoute? deliveryMapRoute(
  TripInfo? trip,
  String? mfcId, {
  required bool pickupStage,
}) => offerRoute(
  trip,
  mfcId,
  pickupAt: pickupStage ? trip?.pickupDueAt : null,
  dropAt: trip?.dropDueAt,
  toDrop: !pickupStage,
);

/// 수락 전 도착 예상: 지금 + 픽업까지 + 전달까지(서버 값이 있을 때만).
DateTime? offerArrival(OfferItem offer, TripInfo? trip) {
  final toPickup = offer.pickupEtaSeconds;
  final toDrop = trip?.dropEtaSeconds;
  if (toPickup == null || toDrop == null) return null;
  return DateTime.now().add(Duration(seconds: toPickup + toDrop));
}

/// 신규배달 상세: 지도(픽업·전달 핀과 직선) · 도착 예상 · 가게/고객 전화 · 주문정보 · 배달정보(맨 아래).
///
/// 주문정보·가게 전화·전달지 좌표는 계약에 아직 없어 목에서만 채운다(백엔드 요청 중). 실서버는
/// 고객 연락처를 픽업 뒤에만 준다(BR-24) — 수락 전 고객전화연결은 안내만 한다.
class OfferDetailScreen extends ConsumerStatefulWidget {
  const OfferDetailScreen({super.key, required this.offerId});

  final String offerId;

  @override
  ConsumerState<OfferDetailScreen> createState() => _OfferDetailScreenState();
}

class _OfferDetailScreenState extends ConsumerState<OfferDetailScreen> {
  String get offerId => widget.offerId;

  @override
  void initState() {
    super.initState();
    // 상세를 열면 서버에 알린다(열람 기록). 실패해도 화면은 그대로 — 판정은 서버가 한다.
    Future.microtask(() async {
      try {
        await ref.read(offerRepositoryProvider).openDetail(offerId);
      } on PmartFailure {
        // 다음 폴링에서 다시 맞춰진다.
      }
    });
  }

  Future<void> _call(String? phone, String unavailable) async {
    if (phone == null) {
      showRiderToast(context, unavailable);
      return;
    }
    await ref.read(phoneCallerProvider)(phone);
  }

  /// 동그란 길안내 버튼: 앱 안 카카오내비, 안 되면 카카오내비 앱.
  Future<void> _navigate(String name, GeoPoint to) async {
    final l10n = AppLocalizations.of(context);
    final out = await ref.read(naviLauncherProvider)(name: name, to: to);
    if (!mounted) return;
    switch (out.result) {
      case NaviResult.inApp:
        break;
      case NaviResult.started:
        if (out.inAppError case final code?) {
          showRiderToast(
            context,
            l10n.naviInAppFallback(naviErrorText(l10n, code)),
          );
        }
      case NaviResult.installPageOpened:
        showRiderToast(context, l10n.naviInstall);
      case NaviResult.unavailable:
        showRiderToast(context, l10n.naviUnavailable);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final offer = ref
        .watch(offerPollerProvider)
        .list
        ?.offers
        .where((o) => o.offerId == offerId)
        .firstOrNull;
    final dutyMfc = ref.watch(dutyProvider).value?.mfcId;
    final trip = switch (offer?.deliveryId) {
      final id? => ref.watch(tripInfoProvider(id)).value,
      null => null,
    };
    return Scaffold(
      appBar: riderDarkBar(context, title: l10n.offerDetailTitle),
      body: offer == null
          ? Center(
              key: const ValueKey('offer-gone'),
              child: Text(l10n.offerGone),
            )
          : Column(
              children: [
                Expanded(
                  child: ListView(
                    padding: EdgeInsets.zero,
                    children: [
                      SizedBox(
                        height: 260,
                        child: RiderMap(
                          key: const ValueKey('offer-map'),
                          route: offerMapRoute(offer, trip, dutyMfc),
                        ),
                      ),
                      if (offer.recovery case final rec?) ...[
                        // 회수 제안: 회수지(대략) → MFC 반납. 주소·연락처는 수락 뒤.
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 14, 16, 4),
                          child: Text(
                            recoveryPurposeText(l10n, rec),
                            key: const ValueKey('offer-detail-recovery'),
                            style: const TextStyle(
                              fontSize: 17,
                              fontWeight: FontWeight.w800,
                              color: RiderColors.danger,
                            ),
                          ),
                        ),
                        PlaceSection(
                          key: const ValueKey('recovery-place'),
                          label: l10n.recoveryPlaceLabel,
                          title: offer.dropAreaLabel ?? l10n.dropAreaUnknown,
                          lines: [l10n.recoveryDetailAfterAccept],
                        ),
                        const Divider(indent: 16, endIndent: 16, height: 1),
                        PlaceSection(
                          key: const ValueKey('return-place'),
                          label: l10n.returnPlaceLabel,
                          title: storeText(l10n, offer.mfcId ?? dutyMfc),
                          lines: [
                            if (offer.distanceKm case final d?)
                              l10n.recoveryDistance(d.toStringAsFixed(1)),
                          ],
                        ),
                      ] else ...[
                        _EtaStrip(offer: offer, trip: trip),
                        const SectionGap(),
                        // 레퍼런스 image 12: 픽업지 주소 밑에 가게전화연결, 전달지 주소 밑에 고객전화연결.
                        PlaceSection(
                          key: const ValueKey('pickup-place'),
                          label: l10n.pickupPlace,
                          title: trip == null
                              ? storeText(l10n, offer.mfcId ?? dutyMfc)
                              : l10n.storeLabel(trip.store.name),
                          lines: [?trip?.store.address],
                          linkKey: const ValueKey('call-store'),
                          // 지점 전화가 없으면 버튼을 숨긴다.
                          linkText: trip?.store.phone == null
                              ? null
                              : l10n.callStore,
                          onLink: () => _call(
                            trip?.store.phone,
                            l10n.storePhoneUnavailable,
                          ),
                          routeKey: const ValueKey('route-pickup'),
                          onRoute: switch (trip?.store) {
                            final s? => () => _navigate(
                              l10n.storeLabel(s.name),
                              s.point,
                            ),
                            null => null,
                          },
                        ),
                        const Divider(indent: 16, endIndent: 16, height: 1),
                        PlaceSection(
                          key: const ValueKey('drop-place'),
                          label: l10n.dropPlace,
                          title: offer.dropAreaLabel ?? l10n.dropAreaUnknown,
                          lines: [l10n.dropDetailAfterAccept],
                          // 고객 연락처는 픽업한 뒤에 연다(사용자 결정 2026-11-16).
                          linkKey: const ValueKey('call-customer-locked'),
                          linkText: l10n.callCustomer,
                          linkLocked: true,
                          lockedNote: l10n.customerPhoneAfterPickup,
                          routeKey: const ValueKey('route-drop'),
                          onRoute: switch (trip?.drop) {
                            final p? => () => _navigate(l10n.naviDropName, p),
                            null => null,
                          },
                        ),
                        const SectionGap(),
                        OrderInfoSection(
                          trip: trip,
                          orderId: null,
                          mfcId: offer.mfcId ?? dutyMfc,
                        ),
                      ],
                      const SectionGap(),
                      _DeliveryInfo(
                        offer: offer,
                        mfcId: offer.mfcId ?? dutyMfc,
                        trip: trip,
                      ),
                    ],
                  ),
                ),
                SafeArea(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                    child: OfferResponseBar(
                      offer: offer,
                      onResponded: (outcome) {
                        if (outcome is! OfferUnknown && context.mounted) {
                          context.pop();
                        }
                      },
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}

/// 픽업까지 · 도착 예상 시각.
class _EtaStrip extends StatelessWidget {
  const _EtaStrip({required this.offer, required this.trip});

  final OfferItem offer;
  final TripInfo? trip;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final arrival = offerArrival(offer, trip);
    final parts = [
      if (offer.pickupEtaSeconds case final s?)
        l10n.pickupIn(l10n.etaMinutes((s / 60).ceil())),
      if (arrival != null) l10n.arriveDue(clockText(arrival)),
    ];
    if (parts.isEmpty) return const SizedBox(height: 8);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Row(
        children: [
          const Icon(Icons.schedule, size: 20, color: RiderColors.primary),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              parts.join(' · '),
              key: const ValueKey('offer-eta'),
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: RiderColors.ink,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 배달정보(맨 아래): 픽업지 · 전달지(동) · 배달료 · 거리·무게·봉투.
class _DeliveryInfo extends StatelessWidget {
  const _DeliveryInfo({
    required this.offer,
    required this.mfcId,
    required this.trip,
  });

  final OfferItem offer;
  final String? mfcId;
  final TripInfo? trip;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    // 픽업지·전달지는 위 칸(PlaceSection)에 있다 — 여기는 배달료·거리·무게·봉투.
    return TripSection(
      key: const ValueKey('delivery-info'),
      icon: Icons.delivery_dining_outlined,
      title: l10n.offerInfo,
      children: [
        TripLine(l10n.deliveryFee, switch (offer.estimatedFee) {
          final int fee => formatKrw(fee),
          null => l10n.offerFeeUnknown,
        }, bold: true),
        if (offer.containsAlcohol ?? false)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(
              children: [
                const Icon(Icons.liquor, color: RiderColors.danger, size: 18),
                const SizedBox(width: 4),
                Text(
                  l10n.alcoholNotice,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: RiderColors.danger,
                  ),
                ),
              ],
            ),
          ),
        if (offer.distanceKm case final d?)
          TripLine(l10n.offerDistance, l10n.distanceKm(d.toStringAsFixed(1))),
        if (offer.pickupDistanceKm case final d?)
          TripLine(
            l10n.pickupDistance,
            [
              l10n.distanceKm(d.toStringAsFixed(1)),
              if (offer.pickupEtaSeconds case final s?)
                l10n.etaMinutes((s / 60).ceil()),
            ].join(' · '),
          ),
        if (offer.bagCount case final b?)
          TripLine(l10n.offerBags, l10n.bagCount(b)),
        if (offer.weightG case final w?)
          TripLine(
            l10n.offerWeight,
            l10n.weightKg((w / 1000).toStringAsFixed(1)),
          ),
      ],
    );
  }
}
