import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../../home/presentation/home_screen.dart';
import '../../offers/data/delivery_list_repository.dart';
import '../../offers/domain/offer_list.dart';
import '../../offers/presentation/offer_actions.dart';
import '../../offers/presentation/offer_controllers.dart';
import 'delivery_controller.dart';
import 'delivery_texts.dart';

/// 배달리스트: 진행 중인 배송, (일반 배차모드면) 배차 대기 배송, 신규배차 켜기/끄기.
///
/// 레퍼런스의 예상 소요시간·새 경로 탐색은 계약에 값이 없어 두지 않는다.
class DeliveryListScreen extends ConsumerStatefulWidget {
  const DeliveryListScreen({super.key});

  @override
  ConsumerState<DeliveryListScreen> createState() => _DeliveryListScreenState();
}

class _DeliveryListScreenState extends ConsumerState<DeliveryListScreen> {
  /// 0 = 진행, 1 = 대기. 고르기 전에는 일반 배차모드면 대기부터(사용자 요청 2026-11-17).
  int? _picked;
  int _tab = 0;
  Timer? _poll;

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  /// 대기 목록은 서버 `pollAfterSec` 간격으로 다시 읽는다(대기 탭을 볼 때만).
  void _schedule(WaitingList? list) {
    _poll?.cancel();
    final next = list?.pollAfter;
    if (_tab != 1 || next == null) return;
    _poll = Timer(next, () {
      if (mounted) ref.invalidate(waitingListProvider);
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final loaded = ref.watch(myActiveDeliveriesProvider);
    final ids = watchActiveDeliveryIds(ref);
    final duty = ref.watch(dutyProvider).value;
    final normalMode =
        ref.watch(dispatchModeProvider).value == DispatchMode.normal;
    _tab = _picked ?? (normalMode ? 1 : 0);
    final waiting = normalMode && _tab == 1
        ? ref.watch(waitingListProvider)
        : null;
    if (waiting != null) {
      ref.listen(waitingListProvider, (_, next) => _schedule(next.value));
    }
    return Scaffold(
      backgroundColor: RiderColors.gap,
      appBar: riderDarkBar(
        context,
        title: l10n.deliveryList,
        actions: [
          TextButton(
            key: const ValueKey('history'),
            onPressed: () => context.push('/my/history'),
            child: Text(
              l10n.pastList,
              style: const TextStyle(color: Colors.white, fontSize: 15),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          if (normalMode)
            _Tabs(
              tab: _tab,
              active: ids.length,
              waiting: waiting?.value?.items.length,
              onTab: (i) {
                setState(() => _picked = i);
                if (i == 1) ref.invalidate(waitingListProvider);
              },
            ),
          if (waiting != null)
            Expanded(
              child: _Waiting(
                state: waiting,
                // 수락해도 대기 목록에 머문다 — 이어서 다른 배송을 수락할 수 있게(사용자 요청
                // 2026-11-17). 목록을 다시 읽어 수락한 배송을 빼고, 진행 수(탭)는 늘어난다.
                onAssigned: () => ref.invalidate(waitingListProvider),
              ),
            )
          else ...[
            Container(
              width: double.infinity,
              color: const Color(0xFF6E6E6E),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l10n.listBannerTitle(ids.length),
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    l10n.listBannerBody,
                    style: const TextStyle(color: Colors.white, fontSize: 13),
                  ),
                ],
              ),
            ),
            Expanded(
              // 조회 실패를 "배달 없음"으로 보이지 않는다.
              child: loaded is AsyncError && ids.isEmpty
                  ? Center(
                      key: const ValueKey('list-error'),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(l10n.listLoadFailed),
                          TextButton(
                            onPressed: () =>
                                ref.invalidate(myActiveDeliveriesProvider),
                            child: Text(l10n.retry),
                          ),
                        ],
                      ),
                    )
                  : loaded.isLoading && ids.isEmpty
                  ? const Center(child: CircularProgressIndicator())
                  : ids.isEmpty
                  ? Center(
                      key: const ValueKey('list-empty'),
                      child: Text(
                        l10n.listEmpty,
                        style: const TextStyle(color: RiderColors.sub),
                      ),
                    )
                  : ListView(
                      children: [for (final id in ids) _Stop(deliveryId: id)],
                    ),
            ),
          ],
          Material(
            color: Colors.white,
            child: SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        duty == null || !duty.onDuty
                            ? l10n.offDuty
                            : duty.newDispatchEnabled
                            ? l10n.newDispatchOn
                            : l10n.newDispatchOff,
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          color: (duty?.newDispatchEnabled ?? false)
                              ? RiderColors.primary
                              : RiderColors.sub,
                        ),
                      ),
                    ),
                    Switch(
                      key: const ValueKey('list-new-dispatch'),
                      value: duty?.newDispatchEnabled ?? false,
                      onChanged: duty == null || !duty.onDuty
                          ? null
                          : (v) => changeDuty(
                              context,
                              ref,
                              onDuty: true,
                              newDispatch: v,
                            ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Stop extends ConsumerWidget {
  const _Stop({required this.deliveryId});

  final String deliveryId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final d = ref.watch(deliveryProvider(deliveryId)).value;
    final drop = d != null && !isPickupStage(d.state)
        ? ref.watch(dropInfoProvider(deliveryId)).value
        : null;
    final pickup = d == null || isPickupStage(d.state);
    final color = pickup ? RiderColors.pickup : RiderColors.drop;
    return Container(
      key: ValueKey('delivery-$deliveryId'),
      color: Colors.white,
      margin: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        onTap: () => context.push('/deliveries/$deliveryId'),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              CircleAvatar(
                radius: 17,
                backgroundColor: color,
                child: Text(
                  pickup ? l10n.pinPickup : l10n.pinDrop,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      d == null
                          ? l10n.deliveryNumber(deliveryId)
                          : pickup
                          ? storeText(l10n, d.mfcId)
                          : (drop?.roadAddress ?? l10n.dropInfoUnavailable),
                      style: const TextStyle(
                        fontSize: 19,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 10),
                    if (d != null)
                      Text(
                        executionText(l10n, d.state),
                        style: const TextStyle(
                          fontSize: 15,
                          color: RiderColors.sub,
                        ),
                      ),
                    if (d != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(
                          l10n.packageCount(d.packageIds.length),
                          style: const TextStyle(
                            fontSize: 15,
                            color: RiderColors.sub,
                          ),
                        ),
                      ),
                  ],
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

class _Tabs extends StatelessWidget {
  const _Tabs({
    required this.tab,
    required this.active,
    required this.waiting,
    required this.onTab,
  });

  final int tab;
  final int active;
  final int? waiting;
  final ValueChanged<int> onTab;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    Widget item(int i, String label, int? count) => Expanded(
      child: InkWell(
        key: ValueKey('list-tab-$i'),
        onTap: () => onTab(i),
        child: Container(
          height: 52,
          alignment: Alignment.center,
          color: tab == i ? const Color(0xFF222222) : const Color(0xFF3A3A3A),
          child: Text(
            count == null ? label : '$label $count',
            style: TextStyle(
              color: tab == i ? Colors.white : Colors.white54,
              fontSize: 17,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ),
    );
    return Row(
      children: [
        // 대기가 먼저(왼쪽) — 일반 배차모드에서 라이더가 고를 배송.
        item(1, l10n.tabWaiting, waiting),
        item(0, l10n.tabActive, active),
      ],
    );
  }
}

/// 배차 대기 배송(일반 배차모드). 목록에서 고르는 것 ≠ 확정 — 수락 판정은 서버가 한다.
class _Waiting extends ConsumerStatefulWidget {
  const _Waiting({required this.state, required this.onAssigned});

  final AsyncValue<WaitingList> state;
  final VoidCallback onAssigned;

  @override
  ConsumerState<_Waiting> createState() => _WaitingState();
}

class _WaitingState extends ConsumerState<_Waiting> {
  /// 배송별 수락 키. 판정을 받지 못하면 같은 키로만 다시 보낸다.
  final _keys = <String, IdempotencyKey>{};
  final _busy = <String>{};

  Future<void> _accept(WaitingDelivery w) async {
    final l10n = AppLocalizations.of(context);
    final key = _keys[w.deliveryId] ??= IdempotencyKey.generate();
    setState(() => _busy.add(w.deliveryId));
    final OfferOutcome outcome;
    try {
      outcome = await ref
          .read(deliveryListRepositoryProvider)
          .accept(w.deliveryId, key: key);
    } on PmartFailure {
      if (mounted) {
        setState(() => _busy.remove(w.deliveryId));
        showRiderToast(context, l10n.acceptFailed);
      }
      return;
    }
    if (!mounted) return;
    setState(() => _busy.remove(w.deliveryId));
    if (outcome is! OfferUnknown) _keys.remove(w.deliveryId);
    switch (outcome) {
      case OfferAssigned(:final deliveryId):
        ref
            .read(assignedDeliveriesProvider.notifier)
            .add(deliveryId ?? w.deliveryId);
        ref.invalidate(myActiveDeliveriesProvider);
        showRiderToast(context, l10n.offerAssigned);
        widget.onAssigned();
      case OfferLate(:final reason):
        // 이미 배정·취소한 배송·최대 건수 초과 — 목록을 다시 읽는다.
        showRiderToast(context, lateText(l10n, reason));
      case OfferRejected():
        break;
      case OfferUnknown():
        showRiderToast(context, l10n.offerUnknown);
    }
    ref.invalidate(waitingListProvider);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return switch (widget.state) {
      AsyncData(:final value) when value.items.isEmpty => Center(
        key: const ValueKey('waiting-empty'),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            // 위치가 안 오거나 위치 품질이 나빠도 목록이 빈다(서버가 구분해 주지 않는다).
            l10n.waitingEmpty,
            textAlign: TextAlign.center,
            style: const TextStyle(color: RiderColors.sub, height: 1.5),
          ),
        ),
      ),
      AsyncData(:final value) => ListView(
        children: [
          for (final w in value.items)
            Container(
              key: ValueKey('waiting-${w.deliveryId}'),
              color: Colors.white,
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      if (modeText(l10n, w.mode) case final m?)
                        Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: Text(
                            m,
                            style: const TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w700,
                              color: RiderColors.primary,
                            ),
                          ),
                        ),
                      Expanded(
                        child: Text(
                          w.dropAreaLabel ?? l10n.dropAreaUnknown,
                          style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                      Text(
                        switch (w.estimatedFee) {
                          final int f => formatKrw(f),
                          null => l10n.offerFeeUnknown,
                        },
                        style: const TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    [
                      if (w.mfcId case final m?) storeText(l10n, m),
                      if (w.distanceKm case final d?)
                        l10n.distanceKm(d.toStringAsFixed(1)),
                      if (w.weightG case final g?)
                        l10n.weightKg((g / 1000).toStringAsFixed(1)),
                      if (w.bagCount case final b?) l10n.bagCount(b),
                      if (w.containsAlcohol ?? false) l10n.containsAlcohol,
                    ].join(' · '),
                    style: const TextStyle(
                      fontSize: 14,
                      color: RiderColors.sub,
                    ),
                  ),
                  const SizedBox(height: 10),
                  RiderButton(
                    key: ValueKey('waiting-accept-${w.deliveryId}'),
                    height: 46,
                    label: l10n.accept,
                    onPressed: _busy.contains(w.deliveryId)
                        ? null
                        : () => _accept(w),
                  ),
                ],
              ),
            ),
        ],
      ),
      AsyncError() => Center(
        key: const ValueKey('waiting-error'),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(l10n.waitingLoadFailed),
            TextButton(
              onPressed: () => ref.invalidate(waitingListProvider),
              child: Text(l10n.retry),
            ),
          ],
        ),
      ),
      _ => const Center(child: CircularProgressIndicator()),
    };
  }
}
