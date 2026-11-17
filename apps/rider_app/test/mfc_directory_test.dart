import 'package:flutter_test/flutter_test.dart';
import 'package:rider_app/features/auth/data/signup.dart';
import 'package:rider_app/shared/mfc_directory.dart';

/// 배달 지역: 4개 권역(충청·강원·전라·경상, 사용자 요청 2026-11-17) · 26개 지점.
void main() {
  test('권역별 지점', () {
    final areas = SignupOptions.areas;
    List<String> names(MfcRegion r) => [for (final a in areas[r]!) a.name];
    expect(MfcRegion.values, hasLength(4));
    // 이름순 — 같은 도시끼리 모인다.
    expect(names(MfcRegion.chungcheong), [
      '대전서구지점',
      '대전유성지점',
      '대전중구지점',
      '세종지점',
      '천안지점',
      '청주상당지점',
      '청주흥덕지점',
    ]);
    expect(names(MfcRegion.gangwon), ['원주지점', '춘천지점']);
    expect(names(MfcRegion.jeolla), ['광주광산지점', '광주서구지점', '목포지점', '전주지점']);
    expect(names(MfcRegion.gyeongsang).take(5), [
      '경산지점',
      '김해지점',
      '대구달서지점',
      '대구북구지점',
      '대구수성지점',
    ]);
    expect(names(MfcRegion.gyeongsang), hasLength(13));
    expect(names(MfcRegion.gyeongsang), contains('부산진구지점'));
    expect([for (final r in MfcRegion.values) ...names(r)], hasLength(26));
  });
}
