import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'package:customer_app/features/profile/data/mock_profile_repository.dart';
import 'package:customer_app/features/profile/data/phone_verification_repository.dart';
import 'package:customer_app/features/profile/domain/phone_verification.dart';
import 'package:customer_app/features/profile/presentation/profile_controller.dart';
import 'package:customer_app/shared/sms_composer.dart';

import 'support/app_harness.dart';

/// 휴대폰 번호 확인(customer 0.9.0 — OCTOMO, 고객이 대표번호로 문자를 보냄).
void main() {
  setUpAll(initPmartFormatting);

  late MockProfileRepository profile;
  late MockPhoneVerificationRepository pv;
  late List<(String, String)> sms;
  setUp(() {
    profile = MockProfileRepository(latency: Duration.zero)..nickname = '김피마';
    pv = MockPhoneVerificationRepository(
      latency: Duration.zero,
      onVerified: () => profile.phoneVerified = true,
    );
    sms = [];
  });

  Finder key(String k) => find.byKey(ValueKey(k));

  /// 남은 시간 표시가 1초마다 다시 그려 pumpAndSettle 이 끝나지 않는다 — 짧게 여러 번.
  Future<void> settle(WidgetTester t) async {
    for (var i = 0; i < 20; i++) {
      await t.pump(const Duration(milliseconds: 50));
    }
  }

  Future<void> openScreen(WidgetTester t) async {
    t.view
      ..physicalSize = const Size(800, 1800)
      ..devicePixelRatio = 1;
    addTearDown(t.view.reset);
    await t.pumpWidget(
      testApp(profile: profile, [
        phoneVerificationRepositoryProvider.overrideWithValue(pv),
        smsComposerProvider.overrideWithValue((to, body) async {
          sms.add((to, body));
          return true;
        }),
      ]),
    );
    await t.pumpAndSettle();
    await t.tap(find.text('마이페이지').last);
    await t.pumpAndSettle();
    await t.tap(key('my-login'));
    await t.pumpAndSettle();
    await t.tap(key('login-kakao'));
    await t.pumpAndSettle();
    await t.tap(key('my-info'));
    await t.pumpAndSettle();
    await t.tap(key('info-phone-verify'));
    await t.pumpAndSettle();
    expect(key('pv-title-input'), findsOneWidget);
  }

  Future<void> leave(WidgetTester t) async {
    // 남은 시간 타이머를 닫는다.
    await t.tap(key('pv-close'));
    await t.pumpAndSettle();
  }

  testWidgets('번호 입력 → 프로필 저장 → 받는 번호·숫자 → 문자 앱 열기 → 보냈어요 → 확인됨', (t) async {
    await openScreen(t);
    await t.enterText(key('pv-phone'), '01012345678');
    await t.pump();
    await t.tap(key('pv-next'));
    await settle(t);

    expect(profile.phone, '01012345678');
    expect(key('pv-title-send'), findsOneWidget);
    expect(t.widget<Text>(key('pv-send-to')).data, '1666-3538');
    final text = t.widget<Text>(key('pv-send-text')).data!;

    await t.tap(key('pv-open-sms'));
    await t.pump();
    expect(sms.single, ('1666-3538', text));

    await t.tap(key('pv-sent'));
    await settle(t);
    expect(key('pv-title-done'), findsOneWidget);
    expect(key('pv-verified'), findsOneWidget);
    expect(pv.confirms, 1);
    await t.tap(key('pv-done'));
    await t.pumpAndSettle();
    // 내 정보: 확인됨이면 "번호 확인" 버튼이 없다.
    expect(key('info-phone-verify'), findsNothing);
    expect(find.text('확인됨'), findsOneWidget);
  });

  testWidgets('아직 문자가 안 왔으면 남은 횟수 안내 — 자동으로 다시 묻지 않는다', (t) async {
    pv.arriveAfter = 2;
    await openScreen(t);
    await t.enterText(key('pv-phone'), '01012345678');
    await t.pump();
    await t.tap(key('pv-next'));
    await settle(t);
    await t.tap(key('pv-sent'));
    await settle(t);
    expect(find.textContaining('아직 문자가 도착하지 않았어요'), findsOneWidget);
    expect(find.textContaining('남은 4번'), findsOneWidget);
    await t.pump(const Duration(seconds: 30));
    expect(pv.confirms, 1, reason: '누를 때만 묻는다(OCTOMO 월 한도)');
    await t.tap(key('pv-sent'));
    await settle(t);
    expect(key('pv-title-done'), findsOneWidget);
    await leave(t);
  });

  testWidgets('010 11자리가 아니면 시작하지 않는다', (t) async {
    await openScreen(t);
    await t.enterText(key('pv-phone'), '01112345678');
    await t.pump();
    await t.tap(key('pv-next'));
    await t.pump();
    expect(find.text('010으로 시작하는 11자리 번호만 확인할 수 있어요'), findsOneWidget);
    expect(pv.starts, 0);
    await leave(t);
  });

  testWidgets('하루 시작 횟수 초과는 안내만', (t) async {
    pv.rejectStart = PhoneVerificationCode.tooManyVerifications;
    await openScreen(t);
    await t.enterText(key('pv-phone'), '01012345678');
    await t.pump();
    await t.tap(key('pv-next'));
    await settle(t);
    expect(find.text('오늘은 번호 확인을 더 할 수 없어요. 내일 다시 해 주세요'), findsOneWidget);
    expect(key('pv-title-input'), findsOneWidget);
    await leave(t);
  });

  testWidgets('확인 서버 장애(503)는 잠시 뒤 다시 — 처음으로 돌리지 않는다', (t) async {
    pv.confirmUnavailableOnce = true;
    await openScreen(t);
    await t.enterText(key('pv-phone'), '01012345678');
    await t.pump();
    await t.tap(key('pv-next'));
    await settle(t);
    await t.tap(key('pv-sent'));
    await settle(t);
    expect(find.text('지금은 확인할 수 없어요. 잠시 뒤 다시 눌러 주세요'), findsOneWidget);
    expect(key('pv-title-send'), findsOneWidget);
    await leave(t);
  });
}
