import 'package:flutter/material.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/mfc_directory.dart';
import '../../../shared/rider_style.dart';
import '../domain/delivery.dart';

String executionText(AppLocalizations l10n, ExecutionState s) => switch (s) {
  ExecutionState.unassigned => l10n.exUnassigned,
  ExecutionState.failureReported => l10n.exFailureReported,
  ExecutionState.assigned => l10n.exAssigned,
  ExecutionState.arrivedAtStore => l10n.exAtStore,
  ExecutionState.pickedUp => l10n.exPickedUp,
  ExecutionState.arrivedAtCustomer => l10n.exAtCustomer,
  ExecutionState.completed => l10n.exCompleted,
  ExecutionState.failed => l10n.exFailed,
  ExecutionState.cancelled => l10n.exCancelled,
  _ => l10n.exOther,
};

/// 픽업지 이름. 지점 목록(목)에 있으면 한글 지점명, 없으면 센터 코드.
String storeText(AppLocalizations l10n, String? mfcId) => switch (mfcId) {
  null => l10n.storeUnknown,
  // 이름을 모르면(서버 지점 목록을 아직 못 읽음) 코드를 보인다.
  final id => l10n.storeLabel(storeNameOf(id) ?? id),
};

/// 단말 시각 → "HH:mm"(Asia/Seoul 표시).
String clockText(DateTime t) => formatSeoulTime(t);

/// 픽업 단계인지(가게로 가는 중·가게 도착). 그 밖의 진행 단계는 전달 단계다.
bool isPickupStage(ExecutionState s) =>
    s == ExecutionState.assigned || s == ExecutionState.arrivedAtStore;

/// 단계 색: 픽업 주황, 전달 파랑.
Color stageColor(ExecutionState s) => switch (s) {
  ExecutionState.assigned ||
  ExecutionState.arrivedAtStore => RiderColors.pickup,
  ExecutionState.pickedUp ||
  ExecutionState.arrivedAtCustomer ||
  ExecutionState.completed => RiderColors.drop,
  ExecutionState.unassigned ||
  ExecutionState.failureReported => RiderColors.danger,
  _ => RiderColors.sub,
};

String handoverText(AppLocalizations l10n, PackageHandover h) =>
    switch (h.phase) {
      HandoverPhase.waiting => l10n.hoWaiting,
      HandoverPhase.authorizing || HandoverPhase.committing => l10n.hoWorking,
      HandoverPhase.handedOver => l10n.hoDone,
      HandoverPhase.checking => l10n.hoChecking,
      HandoverPhase.rejected => handoverRejectText(l10n, h.rejectCode),
      HandoverPhase.stopped => l10n.hoStopped,
    };

String handoverRejectText(AppLocalizations l10n, String? code) =>
    switch (code) {
      HandoverProblemCode.alreadyHandedOver => l10n.hoAlready,
      HandoverProblemCode.packageInvalidated => l10n.hoInvalidated,
      HandoverProblemCode.deliveryMismatch => l10n.hoMismatch,
      HandoverProblemCode.fenceActive => l10n.hoFenceActive,
      'FORBIDDEN' => l10n.hoForbidden,
      _ => l10n.hoRejected,
    };

/// 앱 안 길안내(카카오내비 SDK)를 못 쓴 이유. 코드는 카카오모빌리티 안내 기준.
String naviErrorText(AppLocalizations l10n, String code) => switch (code) {
  'C101' || 'C103' || 'NO_APP_KEY' => l10n.naviErrAuth(code),
  'NO_LOCATION' => l10n.naviErrLocation,
  _ => l10n.naviErrOther(code),
};

/// 서버가 거절한 수행 명령을 알기 쉬운 말로(코드는 보이지 않는다).
String commandRejectText(AppLocalizations l10n, String? code) => switch (code) {
  HandoverProblemCode.handoverNotConfirmed => l10n.rejHandover,
  HandoverProblemCode.evidenceRequired => l10n.failureNeedsPhoto,
  HandoverProblemCode.contactAttemptsRequired => l10n.rejContacts,
  ProblemCode.invalidState => l10n.rejState,
  _ => l10n.rejOther,
};

String queueText(AppLocalizations l10n, QueueItemState s) => switch (s) {
  QueueItemState.queued => l10n.qQueued,
  QueueItemState.awaitingConfirm => l10n.qAwaiting,
  QueueItemState.applied => l10n.qApplied,
  QueueItemState.rejected => l10n.qRejected,
  QueueItemState.checking => l10n.qChecking,
};

String helpCategoryText(AppLocalizations l10n, HelpCategory c) => switch (c) {
  HelpCategory.customerUnreachable => l10n.hcUnreachable,
  HelpCategory.addressIssue => l10n.hcAddress,
  HelpCategory.goodsIssue => l10n.hcGoods,
  HelpCategory.photoUploadFailed => l10n.hcPhoto,
  HelpCategory.accident => l10n.hcAccident,
  HelpCategory.appError => l10n.hcApp,
  HelpCategory.storeWaiting => l10n.hcStoreWaiting,
  HelpCategory.statusCorrection => l10n.hcStatusCorrection,
  HelpCategory.other => l10n.hcOther,
};

/// 주문번호 표시(레퍼런스: 앞은 흐리게, 끝 4자리는 굵게).
class OrderCode extends StatelessWidget {
  const OrderCode({super.key, required this.code, this.size = 30});

  final String code;
  final double size;

  @override
  Widget build(BuildContext context) {
    final cut = code.length > 4 ? code.length - 4 : 0;
    return Text.rich(
      TextSpan(
        children: [
          TextSpan(
            text: code.substring(0, cut),
            style: const TextStyle(color: RiderColors.hint),
          ),
          TextSpan(
            text: code.substring(cut),
            style: const TextStyle(
              color: RiderColors.ink,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: TextStyle(fontSize: size, height: 1.2),
    );
  }
}
