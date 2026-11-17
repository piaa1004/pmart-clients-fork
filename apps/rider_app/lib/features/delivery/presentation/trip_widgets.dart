import 'package:flutter/material.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../domain/trip.dart';
import 'delivery_texts.dart';

/// 화면 묶음 제목 + 아이콘.
class TripSection extends StatelessWidget {
  const TripSection({
    super.key,
    required this.icon,
    required this.title,
    required this.children,
  });

  final IconData icon;
  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 1),
          child: Icon(icon, size: 22, color: RiderColors.sub),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(fontSize: 14, color: RiderColors.sub),
              ),
              const SizedBox(height: 6),
              ...children,
            ],
          ),
        ),
      ],
    ),
  );
}

/// 이름 · 값 한 줄.
class TripLine extends StatelessWidget {
  const TripLine(this.label, this.value, {super.key, this.bold = false});

  final String label;
  final String value;
  final bool bold;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 3),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Text(
            label,
            style: TextStyle(
              fontSize: 15,
              color: bold ? RiderColors.ink : RiderColors.sub,
              fontWeight: bold ? FontWeight.w700 : FontWeight.w400,
            ),
          ),
        ),
        const SizedBox(width: 12),
        Text(
          value,
          style: TextStyle(
            fontSize: 15,
            color: RiderColors.ink,
            fontWeight: bold ? FontWeight.w800 : FontWeight.w400,
          ),
        ),
      ],
    ),
  );
}

/// 주문정보: 주문번호 8자리 · 주문장소(픽업지) · 메뉴 품목 · 메뉴금액 · 고객요청사항.
/// [trip] 이 없으면(실서버 — 계약에 아직 없음) 주문 ID 와 포장 수만 보인다.
class OrderInfoSection extends StatelessWidget {
  const OrderInfoSection({
    super.key,
    required this.trip,
    required this.orderId,
    required this.mfcId,
    this.packageCount,
  });

  final TripInfo? trip;
  final String? orderId;
  final String? mfcId;
  final int? packageCount;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final t = trip;
    return TripSection(
      key: const ValueKey('order-info'),
      icon: Icons.receipt_long_outlined,
      title: l10n.orderInfo,
      children: [
        Text(
          l10n.orderNumber,
          style: const TextStyle(fontSize: 13, color: RiderColors.hint),
        ),
        OrderCode(
          key: const ValueKey('order-no'),
          code: t?.orderNo ?? orderId ?? '-',
          size: 26,
        ),
        const SizedBox(height: 10),
        TripLine(
          l10n.orderPlace,
          t == null ? storeText(l10n, mfcId) : l10n.storeLabel(t.store.name),
        ),
        if (packageCount case final n?)
          TripLine(l10n.packagesLabel, l10n.packageCount(n)),
        if (t == null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              l10n.orderDetailPending,
              style: const TextStyle(fontSize: 13, color: RiderColors.hint),
            ),
          )
        else ...[
          const SizedBox(height: 10),
          Text(
            l10n.menuItems,
            style: const TextStyle(fontSize: 13, color: RiderColors.hint),
          ),
          for (final line in t.items)
            TripLine(
              l10n.itemLine(line.name, line.qty),
              formatKrw(line.amount),
            ),
          if (t.menuTotal case final total?) ...[
            const Divider(height: 14),
            TripLine(l10n.menuAmount, formatKrw(total), bold: true),
          ],
          const SizedBox(height: 10),
          Text(
            l10n.customerRequest,
            style: const TextStyle(fontSize: 13, color: RiderColors.hint),
          ),
          Text(
            t.storeRequest ?? l10n.noRequest,
            key: const ValueKey('store-request'),
            style: const TextStyle(fontSize: 15, color: RiderColors.ink),
          ),
        ],
      ],
    );
  }
}

/// 가게·배달 고객요청사항(전달 단계 — 주문정보 아래).
class RequestNotes extends StatelessWidget {
  const RequestNotes({
    super.key,
    required this.storeRequest,
    required this.deliveryRequest,
  });

  final String? storeRequest;
  final String? deliveryRequest;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Container(
      key: const ValueKey('request-notes'),
      width: double.infinity,
      color: RiderColors.notice,
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.checkRequestNote,
            style: const TextStyle(fontSize: 14, color: RiderColors.pickup),
          ),
          const SizedBox(height: 8),
          TripLine(l10n.storeRequestLabel, storeRequest ?? l10n.noRequest),
          TripLine(
            l10n.deliveryRequestLabel,
            deliveryRequest ?? l10n.noRequest,
          ),
        ],
      ),
    );
  }
}

/// 픽업지·전달지 칸(레퍼런스 image 12): 라벨 · 이름 · 주소 · 그 밑에 전화연결 글자 버튼,
/// 오른쪽에 동그란 길안내 버튼. [linkLocked] 면 전화연결을 잠그고 [lockedNote] 를 보인다.
class PlaceSection extends StatelessWidget {
  const PlaceSection({
    super.key,
    required this.label,
    required this.title,
    this.lines = const [],
    this.linkKey,
    this.linkText,
    this.onLink,
    this.linkLocked = false,
    this.lockedNote,
    this.routeKey,
    this.onRoute,
  });

  final String label;
  final String title;

  /// 이름 아래 줄들(첫 줄은 진하게, 나머지는 흐리게).
  final List<String> lines;
  final Key? linkKey;
  final String? linkText;
  final VoidCallback? onLink;
  final bool linkLocked;
  final String? lockedNote;
  final Key? routeKey;
  final VoidCallback? onRoute;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 20, 16, 18),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.only(top: 1),
          child: Icon(Icons.place_outlined, size: 22, color: RiderColors.sub),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: const TextStyle(fontSize: 14, color: RiderColors.sub),
              ),
              const SizedBox(height: 6),
              Text(
                title,
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  color: RiderColors.ink,
                ),
              ),
              for (final (i, line) in lines.indexed)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    line,
                    style: TextStyle(
                      fontSize: i == 0 ? 15 : 13,
                      color: i == 0 ? RiderColors.ink : RiderColors.hint,
                    ),
                  ),
                ),
              if (linkText case final text?) ...[
                const SizedBox(height: 10),
                InkWell(
                  key: linkKey,
                  onTap: linkLocked ? null : onLink,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (linkLocked)
                          const Padding(
                            padding: EdgeInsets.only(right: 4),
                            child: Icon(
                              Icons.lock_outline,
                              size: 16,
                              color: RiderColors.hint,
                            ),
                          ),
                        Text(
                          text,
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                            color: linkLocked
                                ? RiderColors.hint
                                : RiderColors.primary,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                if (linkLocked && lockedNote != null)
                  Text(
                    lockedNote!,
                    key: const ValueKey('customer-phone-locked'),
                    style: const TextStyle(
                      fontSize: 12,
                      color: RiderColors.hint,
                    ),
                  ),
              ],
            ],
          ),
        ),
        if (onRoute != null)
          Padding(
            padding: const EdgeInsets.only(left: 8),
            child: Material(
              shape: const CircleBorder(
                side: BorderSide(color: RiderColors.line),
              ),
              color: Colors.white,
              child: InkWell(
                key: routeKey,
                customBorder: const CircleBorder(),
                onTap: onRoute,
                child: const SizedBox(
                  width: 48,
                  height: 48,
                  child: Icon(
                    Icons.turn_right,
                    color: RiderColors.primary,
                    size: 26,
                  ),
                ),
              ),
            ),
          ),
      ],
    ),
  );
}

/// 예정 시각 한 줄(예: "픽업 예정 14:32 · 약 6분").
/// 레퍼런스 image 14·17: "9분 후 픽업예정" / "전달예정 3분 지남" / "곧 픽업예정".
String relativeDueText(AppLocalizations l10n, String what, DateTime at) {
  final minutes = at.difference(DateTime.now()).inMinutes;
  if (minutes > 0) return l10n.dueIn(minutes, what);
  if (minutes < 0) return l10n.dueLate(-minutes, what);
  return l10n.dueNow(what);
}

String dueText(
  AppLocalizations l10n,
  String Function(String) label,
  DateTime at,
) {
  final minutes = at.difference(DateTime.now()).inMinutes;
  return [
    label(clockText(at)),
    if (minutes > 0) l10n.etaMinutes(minutes),
  ].join(' · ');
}
