import 'dart:async';

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
import '../../../shared/ui_state_of.dart';
import '../../offers/presentation/offer_controllers.dart';
import '../data/trip_repository.dart';
import '../domain/delivery.dart';
import 'delivery_controller.dart';
import 'delivery_texts.dart';
import 'phone_caller.dart';
import 'photo_box.dart';
import 'support_screen.dart';
import 'support_thread_screen.dart' show helpStateLook;
import 'trip_widgets.dart';

/// 배송 수행: 가게 도착 → QR 인계 → 픽업 완료 → 전달완료. 화면 상태는 서버 확정으로만 바꾼다.
///
/// 지도(픽업·전달 핀과 직선) 위에 시트를 둔다. 접힌 시트에는 단계·장소·예정 시각과
/// [도움요청][길찾기], 위로 끌어 올리면 픽업지·가게 전화·주문정보(전달 단계는 전달지·요청사항)가 보인다.
class DeliveryScreen extends ConsumerStatefulWidget {
  const DeliveryScreen({
    super.key,
    required this.deliveryId,
    this.embedded = false,
  });

  final String deliveryId;

  /// 홈 지도 위에 시트만 얹는다(레퍼런스 image 14 — 배차 수락 뒤 홈에서 바로 이 시트가 보인다).
  /// 지도·위쪽 버튼은 홈 것을 쓴다.
  final bool embedded;

  @override
  ConsumerState<DeliveryScreen> createState() => _DeliveryScreenState();
}

class _DeliveryScreenState extends ConsumerState<DeliveryScreen> {
  bool _hydrated = false;

  /// 아래 시트(레퍼런스 image 14·15): 기본은 예정·장소·도움요청|길찾기까지(그 높이를 재서 맞춘다),
  /// 회색바·헤더를 누르거나 위로 올리면 배달 정보와 진행 버튼.
  static const _sheetFull = 0.92;
  final _sheet = DraggableScrollableController();
  final _peekKey = GlobalKey();
  double _peekPx = 190;
  double _bodyHeight = 0;

  /// 반 넘게 펼침(안내 문구 "눌러서 지도 보기").
  bool _sheetOpen = false;

  /// 기본 높이보다 올라감(진행 버튼을 띄운다).
  bool _sheetRaised = false;

  double get _peekSize => _bodyHeight <= 0
      ? 0.3
      : (_peekPx / _bodyHeight).clamp(0.05, 0.6).toDouble();

  @override
  void initState() {
    super.initState();
    _sheet.addListener(() {
      final size = _sheet.size;
      final open = size > (_peekSize + _sheetFull) / 2;
      final raised = size > _peekSize + 0.03;
      if ((open != _sheetOpen || raised != _sheetRaised) && mounted) {
        setState(() {
          _sheetOpen = open;
          _sheetRaised = raised;
        });
      }
    });
  }

  /// 기본 화면 내용의 실제 높이를 재서 접힌 높이로 쓴다(전달 단계·글자 크기마다 다르다).
  void _measurePeek() {
    if (!mounted) return;
    final box = _peekKey.currentContext?.findRenderObject() as RenderBox?;
    if (box == null || !box.hasSize) return;
    final h = box.size.height;
    if ((h - _peekPx).abs() < 0.5) return;
    setState(() => _peekPx = h);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && !_sheetRaised && _sheet.isAttached) {
        _sheet.jumpTo(_peekSize);
      }
    });
  }

  /// 전달 불가 대기(FAILURE_REPORTED) 동안 운영자 결정(확정·반려)을 확인한다.
  Timer? _failurePoll;
  static const _failurePollEvery = Duration(seconds: 8);
  bool _resuming = false;

  void _watchFailure(bool waiting) {
    if (waiting && _failurePoll == null) {
      _failurePoll = Timer.periodic(_failurePollEvery, (_) {
        if (mounted) ref.invalidate(deliveryProvider(_id));
      });
    } else if (!waiting && _failurePoll != null) {
      _failurePoll!.cancel();
      _failurePoll = null;
    }
  }

  /// 고객과 다시 연락돼 전달할 수 있다 → 지원센터 대화에 알리고 그 대화로 간다.
  /// 전달 불가는 라이더가 직접 취소할 수 없다 — 운영자가 반려하면 원래 단계로 돌아온다(계약
  /// failure-decisions REJECT). 반려되면 이 화면이 확인해 전달 단계로 바꾼다.
  /// 전달 재개 요청 키(같은 누름의 재시도는 같은 키).
  IdempotencyKey? _resumeKey;

  Future<void> _askResume(DeliveryView d) async {
    final l10n = AppLocalizations.of(context);
    // 서버가 실패 등록과 함께 대화를 열었으면(execution 0.14.0) 재개 요청 API 로 알린다 —
    // 대화에 "[전달 재개 요청]"이 남고 운영자 대기 목록에 뜬다. 되돌리는 것은 지원센터 반려.
    final threadId = d.failureHelpRequestId;
    if (threadId != null) {
      setState(() => _resuming = true);
      var sent = false;
      try {
        await ref
            .read(deliveryRepositoryProvider)
            .requestFailureResume(
              _id,
              note: l10n.failureResumeMessage,
              key: _resumeKey ??= IdempotencyKey.generate(),
            );
        sent = true;
        _resumeKey = null;
      } on ProblemFailure catch (f) {
        // 409 = 이미 전달 불가 상태가 아니다(반려됨 등) — 화면이 상태를 다시 읽는다.
        if (f.problem.status == 409) _resumeKey = null;
      } on PmartFailure {
        // 결과 불명 — 같은 키로 다시 누르면 된다.
      }
      if (!mounted) return;
      setState(() => _resuming = false);
      ref.invalidate(deliveryProvider(_id));
      if (!sent) showRiderToast(context, l10n.failureResumeNotSent);
      unawaited(context.push('/deliveries/$_id/support/$threadId'));
      return;
    }
    final last = ref.read(helpFlowProvider(_id)).last;
    if (last == null) {
      // 대화가 아직 없으면 같은 내용으로 도움요청을 먼저 연다.
      setState(() => _resuming = true);
      await ref
          .read(helpFlowProvider(_id).notifier)
          .send(
            HelpCategory.customerUnreachable,
            detail: l10n.failureResumeMessage,
          );
      if (!mounted) return;
      setState(() => _resuming = false);
      final opened = ref.read(helpFlowProvider(_id)).last;
      if (opened != null &&
          opened.state != null &&
          opened.state != HelpState.unknown) {
        unawaited(context.push('/deliveries/$_id/support/${opened.key.value}'));
      } else {
        showRiderToast(context, l10n.helpUnknown);
      }
      return;
    }
    setState(() => _resuming = true);
    var sent = false;
    try {
      await ref
          .read(supportThreadRepositoryProvider)
          .sendMessage(
            _id,
            last.key.value,
            l10n.failureResumeMessage,
            key: IdempotencyKey.generate(),
          );
      sent = true;
    } on SupportThreadUnavailable {
      // 실서버 대화 준비 전 — 대화 화면이 안내한다.
    } on PmartFailure {
      // 대화 화면에서 다시 보낼 수 있다.
    }
    if (!mounted) return;
    setState(() => _resuming = false);
    if (!sent) showRiderToast(context, l10n.failureResumeNotSent);
    unawaited(context.push('/deliveries/$_id/support/${last.key.value}'));
  }

  @override
  void dispose() {
    _failurePoll?.cancel();
    _sheet.dispose();
    super.dispose();
  }

  /// 회색바·헤더를 누르면 펼치고, 펼친 상태에서 누르면 접는다.
  void _toggleSheet() {
    if (!_sheet.isAttached) return;
    unawaited(
      _sheet.animateTo(
        _sheetRaised ? _peekSize : _sheetFull,
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOut,
      ),
    );
  }

  /// 배차취소 키. 결과를 모르면 같은 키로만 다시 보낸다.
  IdempotencyKey? _cancelKey;
  bool _cancelling = false;

  String get _id => widget.deliveryId;

  /// 도움요청 → 지원센터 화면. 그 화면에서 배차취소(픽업 전)·전달할 수 없어요(전달 단계)를 고르면
  /// 여기서 처리한다.
  Future<void> _openHelp(DeliveryView d) async {
    final action = await context.push<SupportAction>(
      '/deliveries/$_id/support',
    );
    if (!mounted) return;
    switch (action) {
      case SupportAction.cancelAssignment:
        if (!_cancelling) await _cancelAssignment();
      case SupportAction.reportFailure:
        unawaited(context.push('/deliveries/$_id/failure'));
      // 지원센터 갈림길에서 고른 문제에 맞춰 사유를 미리 고른다.
      case SupportAction.reportFailureUnreachable:
        unawaited(context.push('/deliveries/$_id/failure?reason=unreachable'));
      case SupportAction.reportFailureAddress:
        unawaited(context.push('/deliveries/$_id/failure?reason=addressError'));
      case null:
        break;
    }
  }

  /// 배차취소(픽업 전). 접수되면 상품은 점포에 남고 다른 라이더에게 재배차된다.
  Future<void> _cancelAssignment() async {
    final l10n = AppLocalizations.of(context);
    final sure = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.cancelAssignment),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.cancelAssignmentAsk),
            const SizedBox(height: 12),
            // 반복 배차취소 안내(사용자 결정 2026-11-16, 백엔드 안내 2026-11-13 — 제재 없음).
            Text(
              l10n.cancelPenaltyNotice,
              key: const ValueKey('cancel-penalty-notice'),
              style: const TextStyle(color: RiderColors.danger, fontSize: 13),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.keepDelivery),
          ),
          TextButton(
            key: const ValueKey('cancel-assignment-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.cancelAssignment),
          ),
        ],
      ),
    );
    if (sure != true || !mounted) return;
    final key = _cancelKey ??= IdempotencyKey.generate();
    setState(() => _cancelling = true);
    final outcome = await ref
        .read(assignmentCancelRepositoryProvider)
        .cancel(_id, key: key);
    if (!mounted) return;
    setState(() => _cancelling = false);
    if (outcome != CancelOutcome.unknown) _cancelKey = null;
    switch (outcome) {
      case CancelOutcome.accepted:
        showRiderToast(context, l10n.cancelAccepted);
        _finish();
      case CancelOutcome.pickedUpCaseRequired:
        showRiderToast(context, l10n.cancelPickedUp);
      case CancelOutcome.rejected:
        showRiderToast(context, l10n.cancelRejected);
      case CancelOutcome.unknown:
        showRiderToast(context, l10n.cancelUnknown);
    }
  }

  /// 카카오내비 길안내. 픽업 단계는 마트, 전달 단계는 전달지.
  Future<void> _navigate({required String name, required GeoPoint? to}) async {
    final l10n = AppLocalizations.of(context);
    if (to == null) {
      showRiderToast(context, l10n.naviNoDestination);
      return;
    }
    final out = await ref.read(naviLauncherProvider)(name: name, to: to);
    if (!mounted) return;
    switch (out.result) {
      case NaviResult.inApp:
        break;
      case NaviResult.started:
        // 앱 안 길안내를 못 써서 카카오내비 앱으로 넘겼으면 이유를 알린다.
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

  Future<void> _call(String? phone, String unavailable) async {
    if (phone == null) {
      showRiderToast(context, unavailable);
      return;
    }
    await ref.read(phoneCallerProvider)(phone);
  }

  void _finish() {
    ref.read(assignedDeliveriesProvider.notifier).remove(_id);
    ref.invalidate(myActiveDeliveriesProvider);
    context.go('/');
  }

  void _back() => context.canPop() ? context.pop() : context.go('/');

  /// 전달완료: "고객님께 어떻게 전달하셨나요?"(요청하신 곳에 두었어요 / 고객에게 직접 전달) → 다음.
  /// 서버는 고객 도착 뒤에만 완료를 받으므로, 아직 픽업 상태면 고객 도착을 먼저 보낸다.
  Future<void> _complete() async {
    final ctl = ref.read(deliveryFlowProvider(_id).notifier);
    final method = await showDialog<CompletionMethod>(
      context: context,
      builder: (_) => const _CompleteDialog(),
    );
    if (method == null || !mounted) return;
    final d = await ref.read(deliveryProvider(_id).future);
    if (d.state == ExecutionState.pickedUp) await ctl.arriveAtCustomer();
    await ctl.complete(
      method,
      method == CompletionMethod.face
          ? Placement.handedToCustomer
          : Placement.frontDoor,
    );
  }

  /// 회수지 제목: 주소(반품 회수) · 주소 없음(오배송 — 원래 놓은 곳) · 못 읽음 · 읽는 중.
  String _recoveryPlaceTitle(
    AppLocalizations l10n,
    AsyncValue<RecoveryContactView>? a,
  ) => switch (a) {
    AsyncData(:final value) => value.addressLine ?? l10n.recoveryNoAddress,
    AsyncError() => l10n.recoveryContactUnavailable,
    _ => l10n.statLoading,
  };

  /// 회수 배송 펼친 시트: 회수지(받는 곳) · 받을 품목 · 사진(받기 전) · 반납할 곳(MFC).
  List<Widget> _recoveryDetails(
    AppLocalizations l10n,
    DeliveryView d,
    AsyncValue<RecoveryContactView>? contactAsync, {
    required bool collect,
    required String storeName,
    required MfcBranch? store,
    required VoidCallback onRouteRecovery,
  }) {
    final contact = contactAsync?.value;
    final origin = d.recoveryOrigin;
    final calls = ref.watch(deliveryFlowProvider(_id)).contacts.length;
    return [
      PlaceSection(
        key: const ValueKey('recovery-place'),
        label: l10n.recoveryPlaceLabel,
        title: _recoveryPlaceTitle(l10n, contactAsync),
        lines: [
          if (contact?.receiverName case final n?) l10n.recoveryReceiver(n),
          ?contact?.entranceNote,
          if (origin != null)
            l10n.recoveryOrigin(
              [
                placementText(l10n, origin.placement),
                ?origin.detail,
              ].join(' · '),
            ),
          if (calls > 0) l10n.recoveryCalls(calls),
        ],
        // 회수지 전화(고객 또는 받는 분). 걸면 연락 기록이 남는다(받기 전 실패 등록에 쓴다).
        linkKey: const ValueKey('call-recovery'),
        linkText: l10n.recoveryCall,
        onLink: contact == null
            ? null
            : () => callCustomerAndRecord(
                context,
                ref,
                _id,
                contact.receiverPhone,
              ),
        routeKey: const ValueKey('route-recovery'),
        onRoute: collect ? onRouteRecovery : null,
      ),
      const Divider(indent: 16, endIndent: 16, height: 1),
      TripSection(
        icon: Icons.inventory_2_outlined,
        title: l10n.recoveryItems,
        children: [
          if (d.returnLines.isEmpty)
            Text(
              l10n.recoveryItemsUnknown,
              style: const TextStyle(fontSize: 15, color: RiderColors.sub),
            )
          else
            for (final (i, line) in d.returnLines.indexed)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Text(
                  l10n.recoveryItemLine(
                    line.name ?? l10n.recoveryItemUnnamed(i + 1),
                    line.qty,
                  ),
                  key: ValueKey('recovery-item-$i'),
                  style: const TextStyle(fontSize: 15),
                ),
              ),
        ],
      ),
      // 받기 전: 받은 상품 사진을 올려야 "회수했어요"를 누를 수 있다(QR 없음 — 사진이 증빙).
      if (d.state == ExecutionState.assigned)
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                l10n.recoveryPhotoTitle,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              EvidencePhotoBox(deliveryId: _id),
            ],
          ),
        ),
      const SectionGap(),
      PlaceSection(
        key: const ValueKey('return-place'),
        label: l10n.returnPlaceLabel,
        title: storeName,
        lines: [?store?.address],
        linkKey: const ValueKey('call-store'),
        // 지점 전화가 등록 안 됐으면 버튼을 숨긴다(백엔드 회신 2026-11-17).
        linkText: (d.mfcPhone ?? store?.phone) == null ? null : l10n.callStore,
        onLink: () =>
            _call(d.mfcPhone ?? store?.phone, l10n.storePhoneUnavailable),
        routeKey: const ValueKey('route-store'),
        onRoute: store == null
            ? null
            : () => _navigate(name: storeName, to: store.point),
      ),
    ];
  }

  /// MFC 반납: 직원에게 넘겼는지 한 번 더 묻고 보낸다(배송 끝 — 수행료).
  Future<void> _returnToStore() async {
    final l10n = AppLocalizations.of(context);
    final sure = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.returnStoreButton),
        content: Text(l10n.returnStoreAsk),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.wdCancel),
          ),
          TextButton(
            key: const ValueKey('return-store-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.returnStoreConfirm),
          ),
        ],
      ),
    );
    if (sure != true || !mounted) return;
    await ref.read(deliveryFlowProvider(_id).notifier).returnToStore();
  }

  @override
  Widget build(BuildContext context) {
    final provider = deliveryProvider(_id);
    // 전달 불가 대기 중에는 운영자 결정을 확인하고, 반려되면(원래 단계로) 알린다.
    ref.listen(provider.select((a) => a.value?.state), (prev, next) {
      _watchFailure(next == ExecutionState.failureReported);
      if (prev == ExecutionState.failureReported &&
          (next == ExecutionState.pickedUp ||
              next == ExecutionState.arrivedAtCustomer ||
              // 반품 회수는 받기 전으로 돌아간다.
              next == ExecutionState.assigned)) {
        showRiderToast(context, AppLocalizations.of(context).failureRejected);
      }
    });
    _watchFailure(
      ref.read(provider).value?.state == ExecutionState.failureReported,
    );
    // 서버가 거절한 수행 명령은 코드 대신 알기 쉬운 말로 한 번 알리고 목록에서 지운다.
    ref.listen(deliveryQueueProvider(_id), (_, next) {
      final rejected = (next.value ?? const <QueueItem>[]).where(
        (q) => q.state == QueueItemState.rejected,
      );
      if (rejected.isEmpty) return;
      final l10n = AppLocalizations.of(context);
      showRiderToast(
        context,
        commandRejectText(l10n, rejected.last.rejectCode),
      );
      unawaited(
        ref.read(riderQueueProvider).clearSettled().then((_) {
          if (mounted) ref.invalidate(deliveryQueueProvider(_id));
        }),
      );
    });
    if (widget.embedded) {
      // 홈 안: 준비되면 시트, 그 전·실패는 아래 작은 판에(지도를 가리지 않게).
      final state = ref.watch(provider);
      if (state case AsyncData(:final value)) return _ready(context, value);
      final l10n = AppLocalizations.of(context);
      return Align(
        alignment: Alignment.bottomCenter,
        child: Material(
          color: Colors.white,
          elevation: 8,
          child: SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 8, 14),
              // 조회 실패를 빈 화면으로 두지 않는다.
              child: state is AsyncError
                  ? Row(
                      key: const ValueKey('delivery-load-failed'),
                      children: [
                        Expanded(child: Text(l10n.deliveryLoadFailed)),
                        TextButton(
                          onPressed: () => ref.invalidate(provider),
                          child: Text(l10n.retry),
                        ),
                      ],
                    )
                  : const LinearProgressIndicator(),
            ),
          ),
        ),
      );
    }
    return Scaffold(
      backgroundColor: Colors.white,
      body: UiStateView<DeliveryView>(
        state: uiStateOf(ref.watch(provider)),
        onRetry: () => ref.invalidate(provider),
        ready: _ready,
      ),
    );
  }

  Widget _ready(BuildContext context, DeliveryView d) {
    final l10n = AppLocalizations.of(context);
    final flow = ref.watch(deliveryFlowProvider(_id));
    final ctl = ref.read(deliveryFlowProvider(_id).notifier);
    final queue = ref.watch(deliveryQueueProvider(_id)).value ?? const [];
    final help = ref.watch(helpFlowProvider(_id));
    final trip = ref.watch(tripInfoProvider(_id)).value;
    // 회수 배송(반품·오배송 회수 한 벌): 회수지에서 받음(사진) → MFC 반납. 일반 단계는 쓰지 않는다.
    final rec = d.recovery;
    final isRec = rec != null;
    final recCollect =
        isRec &&
        (d.state == ExecutionState.assigned ||
            d.state == ExecutionState.failureReported);
    final recReturning = isRec && d.state == ExecutionState.returnPickedUp;
    final contactAsync = isRec ? ref.watch(recoveryContactProvider(_id)) : null;
    final contact = contactAsync?.value;
    final GeoPoint? recoveryPoint = switch (contact) {
      RecoveryContactView(:final lat?, :final lng?) => (lat: lat, lng: lng),
      _ => null,
    };
    final dropStage =
        !isRec &&
        (d.state == ExecutionState.pickedUp ||
            d.state == ExecutionState.arrivedAtCustomer ||
            d.state == ExecutionState.failureReported);
    // 전달지는 픽업 뒤에만 열린다(그 전에는 부르지 않는다).
    final dropAsync = dropStage ? ref.watch(dropInfoProvider(_id)) : null;
    final drop = dropAsync?.value;
    if (!_hydrated) {
      _hydrated = true;
      Future.microtask(() => ctl.hydrate(d));
    }
    final busy = queue.any((q) => q.isOpen);
    final pickupStage = !isRec && isPickupStage(d.state);
    final store = trip?.store ?? mfcById(d.mfcId);
    final storeName = store == null
        ? storeText(l10n, d.mfcId)
        : l10n.storeLabel(store.name);
    final dropPoint = switch (drop) {
      DropInfo(:final lat?, :final lng?) => (lat: lat, lng: lng),
      _ => trip?.drop,
    };
    // 핀 위 예정시간: 픽업 전에는 픽업·전달 예정, 픽업 뒤에는 전달 예정만(레퍼런스 image 11).
    final route = store == null
        ? null
        : isRec
        // 회수: 회수지(받기 전) → MFC(받은 뒤). 회수지 좌표가 없으면 MFC 만.
        ? (recoveryPoint == null
              ? MapRoute(pickup: store.point)
              : MapRoute(
                  pickup: recoveryPoint,
                  drop: store.point,
                  toDrop: recReturning,
                ))
        : MapRoute(
            pickup: store.point,
            drop: dropPoint,
            pickupTime: switch (trip?.pickupDueAt) {
              final at? when pickupStage => clockText(at),
              _ => null,
            },
            dropTime: switch (trip?.dropDueAt) {
              final at? when pickupStage || dropStage => clockText(at),
              _ => null,
            },
            // 직선: 내 위치 → 픽업지(픽업 전), 내 위치 → 전달지(픽업 뒤).
            toDrop: dropStage,
          );
    final address =
        drop?.roadAddress ??
        switch (dropAsync) {
          AsyncError(:final error)
              when error is DropInfoUnavailableFailure &&
                  error.reason == DropInfoUnavailable.notFound =>
            l10n.dropInfoNotFound,
          AsyncError() => l10n.dropInfoUnavailable,
          _ => l10n.statLoading,
        };
    final gone =
        d.state == ExecutionState.unassigned ||
        d.state == ExecutionState.cancelled;
    // 레퍼런스 image 14·17: "9분 후 픽업예정" / "전달예정 3분 지남".
    final dueAt = pickupStage
        ? trip?.pickupDueAt
        : (dropStage ? trip?.dropDueAt : null);
    final due = dueAt == null
        ? null
        : relativeDueText(
            l10n,
            pickupStage ? l10n.duePickupWord : l10n.dueDropWord,
            dueAt,
          );
    final tint = stageColor(d.state);

    // 기본 화면(접힌 시트, 레퍼런스 image 14): 회색바 · 예정 · 장소 · 도움요청|길찾기.
    final peek = Column(
      key: _peekKey,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // 회색바: 누르면 펼치기/접기, 끌어 올리면 펼치기(끌기는 시트가 받는다).
        GestureDetector(
          key: const ValueKey('sheet-handle'),
          behavior: HitTestBehavior.opaque,
          onTap: _toggleSheet,
          child: Padding(
            padding: const EdgeInsets.only(top: 8, bottom: 2),
            child: Column(
              children: [
                Container(
                  width: 40,
                  height: 5,
                  decoration: BoxDecoration(
                    color: RiderColors.line,
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
                const SizedBox(height: 2),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      _sheetOpen ? l10n.sheetCollapse : l10n.dragForDetail,
                      key: const ValueKey('sheet-hint'),
                      style: const TextStyle(
                        fontSize: 11,
                        color: RiderColors.hint,
                      ),
                    ),
                    Icon(
                      _sheetOpen
                          ? Icons.keyboard_arrow_down
                          : Icons.keyboard_arrow_up,
                      size: 14,
                      color: RiderColors.hint,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
        // 헤더의 빈 곳을 눌러도 펼치기/접기.
        GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: _toggleSheet,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // 예정(주황·파랑) ··· 지금 단계(레퍼런스의 회색 알약 자리).
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        due ??
                            (isRec
                                ? recoveryStageText(l10n, d.state)
                                : executionText(l10n, d.state)),
                        key: ValueKey(
                          due == null ? 'execution-state' : 'due-time',
                        ),
                        style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w800,
                          color: tint,
                        ),
                      ),
                    ),
                    if (rec != null)
                      Container(
                        key: const ValueKey('recovery-purpose'),
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 5,
                        ),
                        decoration: BoxDecoration(
                          color: RiderColors.danger.withValues(alpha: 0.10),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: Text(
                          recoveryPurposeText(l10n, rec),
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: RiderColors.danger,
                          ),
                        ),
                      ),
                    if (due != null)
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 5,
                        ),
                        decoration: BoxDecoration(
                          color: RiderColors.field,
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: Text(
                          executionText(l10n, d.state),
                          key: const ValueKey('execution-state'),
                          style: const TextStyle(
                            fontSize: 12,
                            color: RiderColors.sub,
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  isRec
                      ? (recReturning ||
                                d.state == ExecutionState.returnedToStore
                            ? storeName
                            : _recoveryPlaceTitle(l10n, contactAsync))
                      : pickupStage
                      ? storeName
                      : address,
                  key: const ValueKey('place-title'),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w500,
                    color: RiderColors.ink,
                  ),
                ),
                if (busy)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      queue.any((q) => q.state == QueueItemState.checking)
                          ? l10n.doNotRepeat
                          : l10n.sendingNow,
                      key: const ValueKey('sending'),
                      style: const TextStyle(
                        fontSize: 13,
                        color: RiderColors.sub,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
        _SplitActions(
          onHelp: help.sending || gone ? null : () => _openHelp(d),
          onNavigate: () => isRec
              ? (recReturning
                    ? _navigate(name: storeName, to: store?.point)
                    : _navigate(name: l10n.recoveryNaviName, to: recoveryPoint))
              : pickupStage
              ? _navigate(name: storeName, to: store?.point)
              : _navigate(name: l10n.naviDropName, to: dropPoint),
        ),
      ],
    );

    // 펼친 시트(레퍼런스 image 15·17): 회색 띠 아래 배달 정보.
    final details = <Widget>[
      Container(height: 8, color: RiderColors.field),
      // 보낸 도움요청 진행상황 — 누르면 지원센터(보낸 요청·상담원 대화)로 다시 들어간다.
      if (help.last case final last?)
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: Material(
            color: RiderColors.field,
            borderRadius: BorderRadius.circular(8),
            child: InkWell(
              key: const ValueKey('help-status'),
              borderRadius: BorderRadius.circular(8),
              onTap: () => _openHelp(d),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
                child: Row(
                  children: [
                    const Icon(
                      Icons.support_agent,
                      size: 20,
                      color: RiderColors.sub,
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        [
                          helpCategoryText(l10n, last.category),
                          helpStateLook(l10n, last.state).$1,
                          if (help.sentCount > 1)
                            l10n.supportCount(help.sentCount),
                        ].join(' · '),
                        style: const TextStyle(fontSize: 14),
                      ),
                    ),
                    Text(
                      l10n.supportOpenThread,
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: RiderColors.primary,
                      ),
                    ),
                    const Icon(
                      Icons.chevron_right,
                      size: 18,
                      color: RiderColors.primary,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      // 전달 단계: "'여기에 두었어요' 알리기" → 촬영하기 창 → 올리면 닫힘 → 전달완료(image 17).
      if (d.state == ExecutionState.pickedUp ||
          d.state == ExecutionState.arrivedAtCustomer)
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              RiderOutlineButton(
                key: const ValueKey('photo'),
                accent: true,
                height: 52,
                icon: Icons.photo_camera_outlined,
                label: flow.photoRef == null
                    ? l10n.takePhoto
                    : l10n.photoUploaded,
                onPressed: () => context.push('/deliveries/$_id/photo'),
              ),
              if (flow.uploadFailed)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(
                    l10n.uploadFailed,
                    key: const ValueKey('upload-failed'),
                    style: const TextStyle(
                      fontSize: 13,
                      color: RiderColors.danger,
                    ),
                  ),
                ),
            ],
          ),
        ),
      if (isRec)
        ..._recoveryDetails(
          l10n,
          d,
          contactAsync,
          collect: recCollect,
          storeName: storeName,
          store: store,
          onRouteRecovery: () =>
              _navigate(name: l10n.recoveryNaviName, to: recoveryPoint),
        ),
      if (pickupStage) ...[
        // 레퍼런스 image 12: 픽업지 주소 밑에 가게전화연결, 전달지 주소 밑에 고객전화연결.
        PlaceSection(
          key: const ValueKey('mart-info'),
          label: l10n.martLabel,
          title: storeName,
          lines: [?store?.address],
          linkKey: const ValueKey('call-store'),
          // 지점 전화가 등록 안 됐으면 버튼을 숨긴다(백엔드 회신 2026-11-17).
          linkText: (d.mfcPhone ?? store?.phone) == null
              ? null
              : l10n.callStore,
          onLink: () =>
              _call(d.mfcPhone ?? store?.phone, l10n.storePhoneUnavailable),
          routeKey: const ValueKey('route-pickup'),
          onRoute: store == null
              ? null
              : () => _navigate(name: storeName, to: store.point),
        ),
        const Divider(indent: 16, endIndent: 16, height: 1),
        PlaceSection(
          key: const ValueKey('drop-place'),
          label: l10n.dropPlace,
          title: trip?.dropLabel ?? l10n.dropAreaUnknown,
          lines: [l10n.dropDetailAfterPickup],
          // 고객 연락처는 픽업한 뒤에 연다(사용자 결정 2026-11-16).
          linkKey: const ValueKey('call-customer-locked'),
          linkText: l10n.callCustomer,
          linkLocked: true,
          lockedNote: l10n.customerPhoneAfterPickup,
        ),
      ] else if (dropStage) ...[
        TripSection(
          icon: Icons.place_outlined,
          title: l10n.dropPlace,
          children: [
            if (drop != null)
              _DropCard(
                info: drop,
                contacts: flow.contacts.length,
                onCall: (phone) =>
                    callCustomerAndRecord(context, ref, _id, phone),
              )
            else
              Text(address, style: const TextStyle(fontSize: 16)),
          ],
        ),
      ],
      if (!isRec) ...[
        const SectionGap(),
        OrderInfoSection(
          trip: trip,
          orderId: d.orderId,
          mfcId: d.mfcId,
          packageCount: d.packageIds.length,
        ),
      ],
      if (dropStage)
        RequestNotes(
          storeRequest: trip?.storeRequest,
          deliveryRequest: drop?.deliveryNote ?? trip?.deliveryRequest,
        ),
      if (dropStage)
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
          child: Text(
            l10n.locationShared,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 12, color: RiderColors.hint),
          ),
        ),
    ];

    // 진행 버튼(가게 도착·픽업·전달 완료). 레퍼런스처럼 시트를 펼쳤을 때 아래에 뜬다.
    final Widget? action = switch (d.state) {
      // 회수: 사진을 올린 뒤 "회수했어요" → MFC 에서 "반납했어요".
      ExecutionState.assigned when isRec => RiderButton(
        key: const ValueKey('return-pickup'),
        label: l10n.returnPickupButton,
        onPressed: flow.photoRef != null && !busy ? ctl.returnPickup : null,
      ),
      ExecutionState.returnPickedUp => RiderButton(
        key: const ValueKey('return-store'),
        label: l10n.returnStoreButton,
        onPressed: busy ? null : _returnToStore,
      ),
      ExecutionState.assigned => RiderButton(
        key: const ValueKey('arrive-store'),
        label: l10n.arriveStore,
        onPressed: busy ? null : ctl.arriveAtStore,
      ),
      ExecutionState.arrivedAtStore => RiderButton(
        key: const ValueKey('qr-pickup'),
        icon: Icons.qr_code_scanner,
        label: l10n.qrPickup,
        onPressed: () => context.push('/deliveries/$_id/qr'),
      ),
      // 고객 도착은 따로 누르지 않는다(촬영 창이 대신 보낸다).
      // 사진 올리기에 성공한 뒤에만 전달완료 → "어떻게 전달하셨나요?" 창.
      ExecutionState.pickedUp ||
      ExecutionState.arrivedAtCustomer => RiderButton(
        key: const ValueKey('complete'),
        label: l10n.completeDelivery,
        onPressed: flow.photoRef != null && !busy ? _complete : null,
      ),
      // 전달 불가를 알린 뒤: 운영자 확인 대기 + 지원센터 대화(보낸 요청이 있으면 그 대화로).
      ExecutionState.failureReported => Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // 접수됐다는 것을 분명히(배송이 FAILURE_REPORTED = 서버가 신고를 받았다, 사용자 지적 2026-11-17).
          Row(
            key: const ValueKey('failure-waiting'),
            children: [
              const Icon(
                Icons.check_circle,
                color: RiderColors.danger,
                size: 22,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l10n.failureReceived,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    Text(
                      l10n.failureWaiting,
                      style: const TextStyle(
                        fontSize: 13,
                        color: RiderColors.sub,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          // 이 칸이 아래 도움요청·길찾기 줄을 덮으므로 여기에 같은 길을 둔다.
          Row(
            children: [
              Expanded(
                child: RiderOutlineButton(
                  key: const ValueKey('failure-talk'),
                  height: 48,
                  icon: Icons.support_agent,
                  label: l10n.failureTalk,
                  onPressed: () {
                    final thread =
                        d.failureHelpRequestId ?? help.last?.key.value;
                    if (thread == null) {
                      _openHelp(d);
                    } else {
                      context.push('/deliveries/$_id/support/$thread');
                    }
                  },
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: RiderOutlineButton(
                  key: const ValueKey('failure-help'),
                  height: 48,
                  icon: Icons.notifications_active_outlined,
                  label: l10n.helpRequest,
                  onPressed: () => _openHelp(d),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          // 고객에게 연락이 와서 전달할 수 있게 됐을 때.
          RiderButton(
            key: const ValueKey('failure-resume'),
            icon: Icons.phone_callback_outlined,
            label: l10n.failureResume,
            onPressed: _resuming ? null : () => _askResume(d),
          ),
        ],
      ),
      ExecutionState.completed => null,
      _ when gone => RiderButton(
        key: const ValueKey('gone-ok'),
        label: l10n.ok,
        onPressed: _finish,
      ),
      _ => Text(l10n.contactSupport),
    };
    // 취소·전달 불가처럼 할 일이 정해진 상태는 접혀 있어도 보인다.
    final actionAlways = gone || d.state == ExecutionState.failureReported;
    final showAction = action != null && (_sheetRaised || actionAlways);

    // 접힌 높이는 기본 화면 내용(_peekKey)을 잰 값으로 맞춘다.
    WidgetsBinding.instance.addPostFrameCallback((_) => _measurePeek());

    final stack = Stack(
      fit: StackFit.expand,
      children: [
        if (!widget.embedded) ...[
          Positioned.fill(child: RiderMap(route: route)),
          Positioned(
            top: 0,
            left: 0,
            child: SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: MapCircleButton(
                  key: const ValueKey('back'),
                  icon: Icons.arrow_back,
                  onTap: _back,
                ),
              ),
            ),
          ),
        ],
        Positioned.fill(
          child: LayoutBuilder(
            builder: (context, box) {
              _bodyHeight = box.maxHeight;
              final peekSize = _peekSize;
              return DraggableScrollableSheet(
                key: const ValueKey('delivery-sheet'),
                controller: _sheet,
                initialChildSize: peekSize,
                minChildSize: peekSize,
                maxChildSize: _sheetFull,
                // 끌어 올린 만큼 머문다(되돌아가지 않게 — 사용자 요청 2026-11-17).
                snap: false,
                builder: (context, scroll) => Material(
                  color: Colors.white,
                  elevation: 10,
                  borderRadius: const BorderRadius.vertical(
                    top: Radius.circular(14),
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: SingleChildScrollView(
                    controller: scroll,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        peek,
                        ...details,
                        // 아래에 뜨는 진행 버튼이 마지막 내용을 가리지 않게.
                        const SizedBox(height: 110),
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
        ),
        if (showAction)
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: Material(
              color: Colors.white,
              elevation: 12,
              child: SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                  child: action,
                ),
              ),
            ),
          ),
        if (d.state == ExecutionState.completed ||
            d.state == ExecutionState.returnedToStore)
          Positioned.fill(
            child: _DoneOverlay(
              onClose: _finish,
              label: isRec ? l10n.returnDoneBanner : null,
            ),
          ),
      ],
    );
    if (widget.embedded) return stack;
    return Scaffold(backgroundColor: Colors.white, body: stack);
  }
}

/// 레퍼런스 image 14: 시트 아래 꽉 찬 반반 버튼 — 도움요청 | 길찾기.
class _SplitActions extends StatelessWidget {
  const _SplitActions({required this.onHelp, required this.onNavigate});

  final VoidCallback? onHelp;
  final VoidCallback? onNavigate;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Container(
      height: 58,
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: RiderColors.line)),
      ),
      child: Row(
        children: [
          Expanded(
            child: _FlatAction(
              key: const ValueKey('help'),
              icon: Icons.notifications_active_outlined,
              label: l10n.helpRequest,
              onTap: onHelp,
            ),
          ),
          const VerticalDivider(
            width: 1,
            thickness: 1,
            color: RiderColors.line,
          ),
          Expanded(
            child: _FlatAction(
              key: const ValueKey('navigate'),
              icon: Icons.map_outlined,
              label: l10n.navigate,
              onTap: onNavigate,
            ),
          ),
        ],
      ),
    );
  }
}

class _FlatAction extends StatelessWidget {
  const _FlatAction({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final color = onTap == null ? RiderColors.disabled : RiderColors.ink;
    return InkWell(
      onTap: onTap,
      child: Center(
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 24, color: color),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w700,
                color: color,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 전달지(개인정보). 출입 메모는 공동현관 비밀번호일 수 있어 복사·공유 기능을 두지 않는다.
class _DropCard extends StatelessWidget {
  const _DropCard({
    required this.info,
    required this.contacts,
    required this.onCall,
  });

  final DropInfo info;
  final int contacts;
  final Future<void> Function(String phone) onCall;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final entrance = switch (info.entranceMethod) {
      EntranceMethod.free => l10n.entranceFree,
      EntranceMethod.password => l10n.entrancePassword,
      EntranceMethod.call => l10n.entranceCall,
      EntranceMethod.other => l10n.entranceOther,
      null => null,
    };
    return Column(
      key: const ValueKey('drop-card'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(info.roadAddress, style: const TextStyle(fontSize: 18)),
        if (info.detailAddress.isNotEmpty)
          Text(
            info.detailAddress,
            style: const TextStyle(fontSize: 16, color: RiderColors.sub),
          ),
        if (entrance != null || info.entranceNote != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              [?entrance, ?info.entranceNote].join(' · '),
              style: const TextStyle(fontSize: 14, color: RiderColors.sub),
            ),
          ),
        if (info.receiverPhone case final phone?)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Row(
              children: [
                OutlinedButton.icon(
                  key: const ValueKey('call-customer'),
                  onPressed: () => onCall(phone),
                  icon: const Icon(Icons.call_outlined, size: 20),
                  label: Text(l10n.callCustomer),
                ),
                const SizedBox(width: 8),
                if (contacts > 0)
                  Text(
                    l10n.contactCount(contacts),
                    key: const ValueKey('contact-count'),
                    style: const TextStyle(
                      fontSize: 13,
                      color: RiderColors.sub,
                    ),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

/// 배달완료 알림(서버가 전달 완료를 확정한 뒤). 캐릭터 그림 없이 브랜드 색 판만 쓴다.
class _DoneOverlay extends StatelessWidget {
  const _DoneOverlay({required this.onClose, this.label});

  final VoidCallback onClose;

  /// 회수 배송은 "반납 완료".
  final String? label;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return ColoredBox(
      color: Colors.black54,
      child: Center(
        child: Container(
          key: const ValueKey('delivery-done'),
          margin: const EdgeInsets.symmetric(horizontal: 36),
          color: Colors.white,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: double.infinity,
                height: 170,
                color: RiderColors.primary,
                alignment: Alignment.center,
                child: Text(
                  label ?? l10n.doneBanner,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 52,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(24, 24, 24, 12),
                child: Text(
                  l10n.deliveryDone,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 16, height: 1.5),
                ),
              ),
              TextButton(
                key: const ValueKey('done-close'),
                onPressed: onClose,
                child: Text(
                  l10n.ok,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: RiderColors.ink,
                  ),
                ),
              ),
              const SizedBox(height: 8),
            ],
          ),
        ),
      ),
    );
  }
}

/// 전달 완료 확인 팝업(레퍼런스): 요청하신 곳에 두었어요 / 고객에게 직접 전달 → 다음.
class _CompleteDialog extends StatefulWidget {
  const _CompleteDialog();

  @override
  State<_CompleteDialog> createState() => _CompleteDialogState();
}

class _CompleteDialogState extends State<_CompleteDialog> {
  CompletionMethod _method = CompletionMethod.contactless;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Dialog(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.white,
      insetPadding: const EdgeInsets.symmetric(horizontal: 28),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
      clipBehavior: Clip.antiAlias,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Align(
            alignment: Alignment.centerRight,
            child: IconButton(
              icon: const Icon(Icons.close, color: RiderColors.sub),
              onPressed: () => Navigator.of(context).pop(),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Text(
              l10n.completeAsk,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 19,
                height: 1.4,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          const SizedBox(height: 20),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: Column(
              children: [
                PillOption(
                  key: const ValueKey('method-contactless'),
                  label: l10n.methodContactless,
                  height: 50,
                  showCheck: true,
                  selected: _method == CompletionMethod.contactless,
                  onTap: () =>
                      setState(() => _method = CompletionMethod.contactless),
                ),
                const SizedBox(height: 8),
                PillOption(
                  key: const ValueKey('method-face'),
                  label: l10n.methodFace,
                  height: 50,
                  showCheck: true,
                  selected: _method == CompletionMethod.face,
                  onTap: () => setState(() => _method = CompletionMethod.face),
                ),
              ],
            ),
          ),
          const SizedBox(height: 28),
          SizedBox(
            width: double.infinity,
            height: 60,
            child: FilledButton(
              key: const ValueKey('complete-confirm'),
              style: FilledButton.styleFrom(
                backgroundColor: RiderColors.primary,
                shape: const RoundedRectangleBorder(),
              ),
              onPressed: () => Navigator.of(context).pop(_method),
              child: Text(
                l10n.next,
                style: const TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
