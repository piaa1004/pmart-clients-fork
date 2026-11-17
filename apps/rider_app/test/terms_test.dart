import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:rider_app/features/auth/data/signup.dart';
import 'package:rider_app/shared/terms_text.dart';

/// 약관 5종 본문(docs/PMart_라이더앱_약관_5종.md → assets/terms) — 동의 항목마다 본문이 있고 그려진다.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const firstLine = {
    'DELIVERY_AGENCY_CONTRACT': '본 계약은 PMart 배송 플랫폼',
    'PRIVACY_COLLECTION': 'PMart는 라이더 회원가입',
    'LOCATION_SERVICE': '본 약관은 PMart가 라이더에게 제공하는',
    'PRIVACY_THIRD_PARTY': 'PMart는 배송 서비스 운영',
    'MARKETING': 'PMart는 라이더에게 이벤트',
  };

  test('동의 항목 5개 모두 본문 파일이 있다', () async {
    expect(SignupOptions.consents.map((c) => c.type), firstLine.keys);
    for (final c in SignupOptions.consents) {
      final text = await rootBundle.loadString('assets/terms/${c.type}.md');
      expect(text, contains(firstLine[c.type]!), reason: c.type);
      expect(text, contains('동의 확인'), reason: c.type);
      // 문서 머리말·구현 체크리스트는 앱 본문에 넣지 않는다.
      expect(text, isNot(contains('앱 구현 시 체크리스트')));
      expect(text, isNot(contains('문서 상태')));
    }
  });

  testWidgets('본문 그리기: 조 제목·번호 목록·표·인용', (t) async {
    final text = await t.runAsync(
      () => rootBundle.loadString('assets/terms/PRIVACY_THIRD_PARTY.md'),
    );
    await t.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(child: TermsText(source: text!)),
        ),
      ),
    );
    // 맨 앞 # 제목은 화면 제목과 겹쳐 그리지 않는다.
    expect(find.textContaining('# 4.'), findsNothing);
    expect(find.text('제1조 (개인정보 제3자 제공)'), findsOneWidget);
    expect(find.textContaining('배송을 주문한 고객', findRichText: true), findsWidgets);
    expect(find.textContaining('중요:', findRichText: true), findsOneWidget);
    expect(find.textContaining('|', findRichText: true), findsNothing);
    expect(find.textContaining('**', findRichText: true), findsNothing);
  });
}
