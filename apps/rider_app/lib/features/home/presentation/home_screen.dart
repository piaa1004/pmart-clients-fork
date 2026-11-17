import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/location.dart';
import '../../../shared/location_reporter.dart';
import '../../../shared/rider_map.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../../auth/data/pickup_points.dart';
import '../../delivery/data/trip_repository.dart';
import '../../delivery/presentation/delivery_controller.dart';
import '../../delivery/presentation/delivery_screen.dart';
import '../../offers/presentation/offer_detail_screen.dart'
    show deliveryMapRoute, offerArrival, offerMapRoute;
import '../../delivery/presentation/delivery_texts.dart';
import '../../my/data/profile.dart';
import '../../notifications/presentation/notification_screen.dart';
import '../../offers/domain/offer_list.dart';
import '../../offers/presentation/offer_actions.dart';
import '../../offers/presentation/offer_controllers.dart';

/// 운행 상태 바꾸기. 실패하면 서버 판정을 그대로 안내한다.
Future<void> changeDuty(
  BuildContext context,
  WidgetRef ref, {
  required bool onDuty,
  required bool newDispatch,
}) async {
  final l10n = AppLocalizations.of(context);
  final messenger = ScaffoldMessenger.of(context);
  final code = await ref
      .read(dutyProvider.notifier)
      .change(onDuty: onDuty, newDispatch: newDispatch);
  if (code == null) return;
  if (code == restrictedCode) ref.invalidate(profileProvider);
  messenger
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text(switch (code) {
          ProblemCode.invalidState => l10n.cannotEndWithActive,
          restrictedCode => l10n.restrictedNoDispatch,
          _ => l10n.dutyChangeFailed,
        }),
      ),
    );
}

/// 진행 중 배송 ID: 서버 목록(재접속 복구)과 이번에 수락한 배송을 합친다.
List<String> watchActiveDeliveryIds(WidgetRef ref) => {
  ...?ref.watch(myActiveDeliveriesProvider).value?.map((d) => d.deliveryId),
  ...ref.watch(assignedDeliveriesProvider),
}.toList();

/// 라이더 홈(지도). 운행 시작 → 신규배차 → 제안 카드 → 진행 중 배송. 화면 상태는 서버 확정 결과로만 바꾼다.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  late final AppLifecycleListener _lifecycle;
  bool _askedBackground = false;

  @override
  void initState() {
    super.initState();
    // 앱 실행·포그라운드 복귀 때는 간격과 상관없이 바로 조회한다(알림 유실 복구).
    Future.microtask(() => ref.read(offerPollerProvider.notifier).refreshNow());
    _lifecycle = AppLifecycleListener(
      onResume: () {
        ref.read(offerPollerProvider.notifier).refreshNow();
        ref
          ..invalidate(profileProvider)
          ..invalidate(myActiveDeliveriesProvider);
      },
    );
  }

  @override
  void dispose() {
    _lifecycle.dispose();
    super.dispose();
  }

  /// 위치가 "항상 허용"이 아니면 이번 실행에 한 번 안내하고, 원하면 권한을 묻는다.
  Future<void> _askBackgroundLocation() async {
    if (_askedBackground) return;
    _askedBackground = true;
    final permission = ref.read(backgroundLocationPermissionProvider);
    if (permission == null) return;
    if (await permission.check() == LocationAccess.always || !mounted) return;
    final l10n = AppLocalizations.of(context);
    final go = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        key: const ValueKey('background-location-ask'),
        title: Text(l10n.backgroundLocationTitle),
        content: Text(l10n.backgroundLocationBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.later),
          ),
          TextButton(
            key: const ValueKey('background-location-allow'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.backgroundLocationAllow),
          ),
        ],
      ),
    );
    if (go == true) await permission.request();
  }

  @override
  Widget build(BuildContext context) {
    // 서버 지점 이름을 한 번 읽는다(카드·시트의 "PMart ○○지점").
    ref.watch(storeNamesProvider);
    final l10n = AppLocalizations.of(context);
    final duty = ref.watch(dutyProvider);
    final st = duty.value;
    final onDuty = st?.onDuty ?? false;
    final poll = ref.watch(offerPollerProvider);
    // 일반 배차모드는 홈에 AI 제안을 띄우지 않는다 — 배달리스트에서 골라 수락(원문 §2.2·2.4).
    final normalMode =
        ref.watch(dispatchModeProvider).value == DispatchMode.normal;
    final group = onDuty && !normalMode
        ? groupOffers(poll.list?.offers ?? const []).firstOrNull
        : null;
    final offer = group?.first;
    final active = watchActiveDeliveryIds(ref);
    final profile = ref.watch(profileProvider).value;

    // 운행 중이거나 배달 중이면 위치를 보낸다(배달 중에는 운행 종료 뒤에도 — 3분 끊기면 위치 끊김 기록).
    // 보내는 동안은 상시 알림을 띄워 앱을 내려도 계속 보낸다.
    final reportLocation = onDuty || active.isNotEmpty;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final wasActive = ref.read(locationReporterProvider);
      ref
          .read(locationReporterProvider.notifier)
          .setActive(
            reportLocation,
            notice: (
              title: l10n.locationNoticeTitle,
              text: l10n.locationNoticeText,
              channel: l10n.locationNoticeChannel,
            ),
          );
      if (reportLocation && !wasActive) unawaited(_askBackgroundLocation());
    });
    // 제한이 풀리면 한 번 알린다(신규배차는 라이더가 다시 켠다).
    ref.listen(profileProvider.select((p) => p.value?.restriction), (
      prev,
      next,
    ) {
      if (prev != null && prev.restricted && next == Restriction.normal) {
        showRiderToast(context, l10n.restrictionLifted);
      }
    });

    final Widget bottom;
    if (st == null) {
      bottom = _Panel(
        child: duty is AsyncError
            ? Row(
                children: [
                  Expanded(child: Text(l10n.dutyLoadFailed)),
                  TextButton(
                    onPressed: () => ref.invalidate(dutyProvider),
                    child: Text(l10n.retry),
                  ),
                ],
              )
            : const LinearProgressIndicator(),
      );
    } else if (!st.onDuty) {
      bottom = _StartPanel(
        onStart: () =>
            changeDuty(context, ref, onDuty: true, newDispatch: true),
      );
    } else if (offer != null) {
      bottom = Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (active.isNotEmpty)
            _ActiveSlim(deliveryId: active.first, count: active.length),
          _OfferCard(group: group!, mfcId: st.mfcId),
        ],
      );
    } else if (active.isNotEmpty) {
      // 진행 중 배송은 아래 시트(배송 화면)를 홈에 바로 띄운다(아래 Stack).
      bottom = const SizedBox.shrink();
    } else if (normalMode && st.newDispatchEnabled) {
      // 일반 배차모드: 배달리스트(대기)로 안내.
      bottom = GestureDetector(
        onTap: () => context.push('/deliveries'),
        child: _DarkNotice(
          key: const ValueKey('normal-mode-notice'),
          text: l10n.normalModeNotice,
        ),
      );
    } else if (!st.newDispatchEnabled || poll.stopped) {
      bottom = _DarkNotice(
        key: const ValueKey('polling-stopped'),
        text: st.newDispatchEnabled
            ? l10n.pollingStopped
            : l10n.newDispatchOffNotice,
      );
    } else if (poll.list != null && !poll.reconnecting) {
      bottom = _DarkNotice(
        key: const ValueKey('offers-empty'),
        text: l10n.offersEmpty,
      );
    } else {
      bottom = const SizedBox.shrink();
    }

    return Scaffold(
      body: Stack(
        children: [
          Positioned.fill(
            // 핀·경로는 제안이 왔거나 진행 중인 배송이 있을 때만(운행 전·제안 없을 때는 지도만).
            child: RiderMap(
              showRoute: offer != null || active.isNotEmpty,
              // 핀 위 예정시간: 제안이면 픽업까지·도착 예상, 진행 중이면 픽업·전달 예정.
              route: switch ((offer, active.firstOrNull)) {
                (final OfferItem o, _) when o.deliveryId != null =>
                  offerMapRoute(
                    o,
                    ref.watch(tripInfoProvider(o.deliveryId!)).value,
                    st?.mfcId,
                  ),
                (null, final String id) => deliveryMapRoute(
                  ref.watch(tripInfoProvider(id)).value,
                  ref.watch(deliveryProvider(id)).value?.mfcId ?? st?.mfcId,
                  pickupStage: switch (ref.watch(deliveryProvider(id)).value) {
                    final d? => isPickupStage(d.state),
                    null => true,
                  },
                ),
                _ => null,
              },
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (onDuty)
                    _NewDispatchPill(
                      enabled: st!.newDispatchEnabled,
                      onTap: () => changeDuty(
                        context,
                        ref,
                        onDuty: true,
                        newDispatch: !st.newDispatchEnabled,
                      ),
                    )
                  else
                    MapPill(
                      key: const ValueKey('my-page'),
                      onTap: () => context.push('/my'),
                      child: _PillLabel(
                        icon: Icons.person_outline,
                        text: l10n.myPage,
                      ),
                    ),
                  const Spacer(),
                  // 알림함(지원센터 답장·문의 답변·계정 제한) — 안 읽은 수 배지.
                  const NotificationBell(),
                  const SizedBox(width: 10),
                  if (onDuty) ...[
                    MapCircleButton(
                      key: const ValueKey('my-page'),
                      icon: Icons.person_outline,
                      onTap: () => context.push('/my'),
                    ),
                    const SizedBox(width: 10),
                    MapCircleButton(
                      key: const ValueKey('delivery-list'),
                      icon: Icons.format_list_bulleted,
                      onTap: () => context.push('/deliveries'),
                    ),
                  ] else
                    MapPill(
                      key: const ValueKey('delivery-list'),
                      onTap: () => context.push('/deliveries'),
                      child: _PillLabel(
                        icon: Icons.format_list_bulleted,
                        text: l10n.deliveryList,
                      ),
                    ),
                ],
              ),
            ),
          ),
          if (profile != null && profile.restriction.restricted)
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 68, 12, 0),
                child: _RestrictionBanner(profile: profile),
              ),
            ),
          if (poll.reconnecting)
            SafeArea(
              child: Align(
                alignment: const Alignment(0, -0.72),
                child: Container(
                  key: const ValueKey('reconnecting'),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 8,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xE6333333),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  // 조회 실패는 "제안 없음"이 아니다.
                  child: Text(
                    l10n.reconnecting,
                    style: const TextStyle(color: Colors.white, fontSize: 13),
                  ),
                ),
              ),
            ),
          Align(alignment: Alignment.bottomCenter, child: bottom),
          // 배차 수락 뒤(제안이 없을 때): 레퍼런스 image 14처럼 홈 지도 위에 배송 시트
          // (예정·장소·도움요청|길찾기, 누르거나 위로 올리면 배달 정보). 따로 "배달 정보 보기"를 누르지 않는다.
          if (offer == null && active.isNotEmpty)
            Positioned.fill(
              child: DeliveryScreen(
                key: ValueKey('delivery-${active.first}'),
                deliveryId: active.first,
                embedded: true,
              ),
            ),
          if (offer == null && active.length > 1)
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.only(top: 68),
                child: Align(
                  alignment: Alignment.topCenter,
                  child: MapPill(
                    key: const ValueKey('active-count'),
                    onTap: () => context.push('/deliveries'),
                    child: _PillLabel(
                      icon: Icons.format_list_bulleted,
                      text: l10n.activeCount(active.length),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _PillLabel extends StatelessWidget {
  const _PillLabel({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Icon(icon, size: 22, color: RiderColors.ink),
      const SizedBox(width: 6),
      Text(
        text,
        style: const TextStyle(
          fontSize: 15,
          fontWeight: FontWeight.w700,
          color: RiderColors.ink,
        ),
      ),
    ],
  );
}

/// 신규배차 켜기/끄기. 끄면 새 제안만 멈추고 진행 중인 배송은 그대로다.
class _NewDispatchPill extends StatelessWidget {
  const _NewDispatchPill({required this.enabled, required this.onTap});

  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return MapPill(
      key: const ValueKey('new-dispatch'),
      onTap: onTap,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            l10n.newDispatch,
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: enabled ? RiderColors.primary : RiderColors.ink,
            ),
          ),
          const SizedBox(width: 8),
          MiniSwitch(on: enabled),
        ],
      ),
    );
  }
}

/// 표시만 하는 작은 토글(누르는 곳은 바깥 알약).
class MiniSwitch extends StatelessWidget {
  const MiniSwitch({super.key, required this.on});

  final bool on;

  @override
  Widget build(BuildContext context) => AnimatedContainer(
    duration: const Duration(milliseconds: 150),
    width: 36,
    height: 20,
    padding: const EdgeInsets.all(2),
    alignment: on ? Alignment.centerRight : Alignment.centerLeft,
    decoration: BoxDecoration(
      color: on ? RiderColors.primary : const Color(0xFF555555),
      borderRadius: BorderRadius.circular(10),
    ),
    child: Container(
      width: 16,
      height: 16,
      decoration: const BoxDecoration(
        color: Colors.white,
        shape: BoxShape.circle,
      ),
    ),
  );
}

class _Panel extends StatelessWidget {
  const _Panel({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => Material(
    color: Colors.white,
    child: SafeArea(
      top: false,
      child: Padding(padding: const EdgeInsets.all(16), child: child),
    ),
  );
}

class _StartPanel extends ConsumerWidget {
  const _StartPanel({required this.onStart});

  final VoidCallback onStart;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    return _Panel(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(height: 8),
          Text(
            riderGreetingText(
              ref.watch(profileProvider).value?.name,
              l10n.riderGreetingNamed,
              l10n.riderGreeting,
            ),
            key: const ValueKey('rider-greeting'),
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 6),
          Text(
            l10n.safetyHelmet,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 15, color: RiderColors.ink),
          ),
          const SizedBox(height: 20),
          RiderButton(
            key: const ValueKey('start-duty'),
            label: l10n.startDuty,
            onPressed: onStart,
          ),
        ],
      ),
    );
  }
}

class _DarkNotice extends StatelessWidget {
  const _DarkNotice({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) => SafeArea(
    top: false,
    child: Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(20, 0, 20, 24),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 22),
      decoration: BoxDecoration(
        color: const Color(0xE6333333),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        text,
        textAlign: TextAlign.center,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 16,
          height: 1.5,
          fontWeight: FontWeight.w600,
        ),
      ),
    ),
  );
}

String? modeText(AppLocalizations l10n, DeliveryMode? m) => switch (m) {
  DeliveryMode.single => l10n.modeSingle,
  DeliveryMode.bundled => l10n.modeBundled,
  DeliveryMode.scheduled => l10n.modeScheduled,
  null => null,
};

/// 배차 제안 카드(지도 아래): 배달료 · 상세 · 픽업/전달 · [거절][배차 수락 | n초 남음].
/// 알뜰배달 묶음은 한 카드에 방문 순서대로 보이고, 하나에 응답하면 묶음 전체에 적용된다.
class _OfferCard extends ConsumerWidget {
  const _OfferCard({required this.group, required this.mfcId});

  final List<OfferItem> group;
  final String? mfcId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final offer = group.first;
    final trip = switch (group.last.deliveryId) {
      final id? => ref.watch(tripInfoProvider(id)).value,
      null => null,
    };
    // 회수 제안: 회수지(대략) → MFC 반납. 도착 예상은 일반 배송 값이라 보이지 않는다.
    final rec = offer.recovery;
    final arrival = rec != null ? null : offerArrival(group.last, trip);
    final bundle = group.length > 1;
    final fees = group.map((o) => o.estimatedFee);
    final fee = fees.contains(null)
        ? null
        : fees.whereType<int>().fold<int>(0, (a, b) => a + b);
    final store = offer.mfcId ?? mfcId;
    final mode = modeText(l10n, offer.mode);
    final pickup = [
      if (offer.pickupDistanceKm case final d?)
        l10n.distanceKm(d.toStringAsFixed(1)),
      if (offer.pickupEtaSeconds case final s?)
        l10n.etaMinutes((s / 60).ceil()),
    ].join(' · ');
    return SafeArea(
      top: false,
      child: Card(
        key: ValueKey('offer-${offer.offerId}'),
        margin: const EdgeInsets.fromLTRB(12, 0, 12, 12),
        color: Colors.white,
        surfaceTintColor: Colors.white,
        elevation: 4,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            InkWell(
              key: ValueKey('offer-detail-${offer.offerId}'),
              onTap: () => context.push('/offers/${offer.offerId}'),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 14, 10, 12),
                child: Row(
                  children: [
                    if (rec != null)
                      Container(
                        margin: const EdgeInsets.only(right: 8),
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 3,
                        ),
                        decoration: BoxDecoration(
                          color: RiderColors.danger.withValues(alpha: 0.10),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          recoveryPurposeText(l10n, rec),
                          key: const ValueKey('offer-recovery'),
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: RiderColors.danger,
                          ),
                        ),
                      )
                    else if (bundle || mode != null)
                      Container(
                        margin: const EdgeInsets.only(right: 8),
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 3,
                        ),
                        decoration: BoxDecoration(
                          color: RiderColors.primarySoft,
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          bundle ? l10n.bundleCount(group.length) : mode!,
                          key: const ValueKey('offer-mode'),
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: RiderColors.primary,
                          ),
                        ),
                      ),
                    Expanded(
                      child: Text(
                        switch (fee) {
                          final int f => l10n.offerFee(formatKrw(f)),
                          null => l10n.offerFeeUnknown,
                        },
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    Text(
                      l10n.detail,
                      style: const TextStyle(
                        fontSize: 15,
                        color: RiderColors.sub,
                      ),
                    ),
                    const Icon(Icons.chevron_right, color: RiderColors.sub),
                  ],
                ),
              ),
            ),
            const Divider(),
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
              child: Column(
                children: [
                  if (rec != null) ...[
                    // 회수: 받는 곳(회수지 대략) → 두는 곳(MFC). 거리 = 회수지 → MFC.
                    _PlaceLine(
                      label: l10n.pinRecovery,
                      value: offer.dropAreaLabel ?? l10n.dropAreaUnknown,
                      trailing: null,
                    ),
                    const SizedBox(height: 4),
                    _PlaceLine(
                      label: l10n.pinReturn,
                      value: storeText(l10n, store),
                      trailing: switch (offer.distanceKm) {
                        final d? => l10n.distanceKm(d.toStringAsFixed(1)),
                        null => null,
                      },
                    ),
                  ] else ...[
                    _PlaceLine(
                      label: l10n.pinPickup,
                      value: storeText(l10n, store),
                      trailing: pickup.isEmpty ? null : pickup,
                    ),
                    for (final o in group) ...[
                      const SizedBox(height: 4),
                      _PlaceLine(
                        label: bundle
                            ? l10n.stopLabel(o.stopSequence ?? 0)
                            : l10n.pinDrop,
                        value: o.dropAreaLabel ?? l10n.dropAreaUnknown,
                        trailing: switch (o.distanceKm) {
                          final d? => l10n.distanceKm(d.toStringAsFixed(1)),
                          null => null,
                        },
                      ),
                    ],
                  ],
                  if (arrival != null) ...[
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        const Icon(
                          Icons.schedule,
                          size: 18,
                          color: RiderColors.primary,
                        ),
                        const SizedBox(width: 4),
                        Text(
                          l10n.arriveDue(clockText(arrival)),
                          key: const ValueKey('offer-arrival'),
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                            color: RiderColors.ink,
                          ),
                        ),
                      ],
                    ),
                  ],
                  const SizedBox(height: 14),
                  OfferResponseBar(offer: offer),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 계정 제한 안내 띠. 사유는 보이지 않는다(운영자 기록).
class _RestrictionBanner extends StatelessWidget {
  const _RestrictionBanner({required this.profile});

  final RiderProfileView profile;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final until = profile.restrictedUntil;
    return Material(
      key: const ValueKey('restriction-banner'),
      color: RiderColors.danger,
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Row(
          children: [
            const Icon(Icons.block, color: Colors.white, size: 20),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                [
                  switch (profile.restriction) {
                    Restriction.dispatchRestricted => l10n.restrictDispatch,
                    Restriction.suspended => l10n.restrictSuspended,
                    Restriction.terminated => l10n.restrictTerminated,
                    Restriction.normal => '',
                  },
                  until == null
                      ? l10n.restrictForever
                      : l10n.restrictUntil(formatSeoulDateTime(until)),
                ].join(' · '),
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PlaceLine extends StatelessWidget {
  const _PlaceLine({required this.label, required this.value, this.trailing});

  final String label;
  final String value;
  final String? trailing;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      SizedBox(
        width: 40,
        child: Text(
          label,
          style: const TextStyle(fontSize: 15, color: RiderColors.hint),
        ),
      ),
      Expanded(
        child: Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 17, color: RiderColors.ink),
        ),
      ),
      if (trailing != null)
        Text(
          trailing!,
          style: const TextStyle(fontSize: 13, color: RiderColors.sub),
        ),
    ],
  );
}

/// 제안 카드 위에 얹는 진행 중 배송 한 줄.
class _ActiveSlim extends StatelessWidget {
  const _ActiveSlim({required this.deliveryId, required this.count});

  final String deliveryId;
  final int count;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Card(
      key: ValueKey('delivery-$deliveryId'),
      margin: const EdgeInsets.fromLTRB(12, 0, 12, 8),
      color: Colors.white,
      surfaceTintColor: Colors.white,
      elevation: 3,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
      child: InkWell(
        onTap: () => context.push('/deliveries/$deliveryId'),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  l10n.activeCount(count),
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const Icon(Icons.chevron_right, color: RiderColors.sub),
            ],
          ),
        ),
      ),
    );
  }
}
