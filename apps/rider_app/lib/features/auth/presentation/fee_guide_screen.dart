import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_ui/pmart_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';

/// 배달료 안내(가입 4단계 "배달료 확인하기", 레퍼런스 image 41).
///
/// 표는 업무 원문 `Delivery-business-logic.md` §7.1(수단·거리별 수행료, 부산 내 동일)을 옮긴 안내다.
/// 배달료 기준을 주는 API 가 계약에 없어 앱이 갖고 있다 — 실제 금액은 배차 요청마다 서버가 정한 값이고,
/// 앱은 이 표로 금액을 계산하지 않는다(백엔드 요청 handoff §18). "확인했어요" 를 누르면 true 로 돌아간다.
class FeeGuideScreen extends StatelessWidget {
  const FeeGuideScreen({super.key});

  static const _walk = [
    ('0~675m', 2600),
    ('675~810m', 2700),
    ('810~945m', 2800),
  ];

  static const _others = [
    ('0~675m', 2600),
    ('675m~1.35km', 2900),
    ('1.35~2km', 3200),
    ('2km', 3900),
    ('3km', 4900),
    ('4km', 5900),
  ];

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: riderDarkBar(context, title: l10n.feeGuideTitle),
      body: ListView(
        key: const ValueKey('fee-guide-screen'),
        padding: const EdgeInsets.fromLTRB(16, 20, 16, 24),
        children: [
          Text(
            l10n.feeGuideIntro,
            style: const TextStyle(fontSize: 14, height: 1.6),
          ),
          const SizedBox(height: 20),
          _Table(title: l10n.feeGuideOthers, rows: _others),
          const SizedBox(height: 16),
          _Table(
            title: l10n.feeGuideWalk,
            rows: _walk,
            extra: l10n.feeGuideWalkExtra,
          ),
          const SizedBox(height: 18),
          for (final line in [
            l10n.feeGuideNote1,
            l10n.feeGuideNote2,
            l10n.feeGuideNote3,
          ])
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('•  ', style: TextStyle(color: RiderColors.sub)),
                  Expanded(
                    child: Text(
                      line,
                      style: const TextStyle(
                        fontSize: 13,
                        height: 1.5,
                        color: RiderColors.sub,
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: RiderButton(
            key: const ValueKey('fee-agree'),
            label: l10n.feeGuideAgree,
            onPressed: () => context.pop(true),
          ),
        ),
      ),
    );
  }
}

class _Table extends StatelessWidget {
  const _Table({required this.title, required this.rows, this.extra});

  final String title;
  final List<(String, int)> rows;
  final String? extra;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: RiderColors.line),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            color: RiderColors.field,
            child: Text(
              title,
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
            ),
          ),
          for (final (distance, fee) in rows)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      distance,
                      style: const TextStyle(
                        fontSize: 14,
                        color: RiderColors.sub,
                      ),
                    ),
                  ),
                  Text(
                    formatKrw(fee),
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
          if (extra case final e?)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 14, 10),
              child: Text(
                e,
                style: const TextStyle(fontSize: 13, color: RiderColors.sub),
              ),
            ),
        ],
      ),
    );
  }
}
