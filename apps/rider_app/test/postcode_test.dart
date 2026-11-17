import 'package:flutter_test/flutter_test.dart';
import 'package:rider_app/features/auth/presentation/postcode_screen.dart';

/// 거주지 주소 검색(다음 우편번호 서비스 `oncomplete` data) 결과 읽기.
/// 실제 도로명·지번 주소만 통과하고, 도로명이 없는 결과는 받지 않는다.
void main() {
  test('도로명을 고르면 도로명으로 보이고 도로명을 보낸다', () {
    final p = pickedFromJson({
      'userSelectedType': 'R',
      'roadAddress': '부산 부산진구 동천로 109',
      'jibunAddress': '부산 부산진구 부전동 112-3',
    })!;
    expect(p.roadAddress, '부산 부산진구 동천로 109');
    expect(p.label, '부산 부산진구 동천로 109');
  });

  test('지번을 고르면 지번으로 보이고 서버에는 그 지번의 도로명을 보낸다', () {
    final p = pickedFromJson({
      'userSelectedType': 'J',
      'roadAddress': '부산 부산진구 동천로 109',
      'jibunAddress': '부산 부산진구 부전동 112-3',
    })!;
    expect(p.label, '부산 부산진구 부전동 112-3');
    expect(p.roadAddress, '부산 부산진구 동천로 109');
  });

  test('도로명 칸이 비면 자동 도로명·자동 지번을 쓴다', () {
    final p = pickedFromJson({
      'userSelectedType': 'J',
      'roadAddress': '',
      'autoRoadAddress': '부산 부산진구 동천로 109',
      'jibunAddress': '  ',
      'autoJibunAddress': '부산 부산진구 부전동 112-3',
    })!;
    expect(p.roadAddress, '부산 부산진구 동천로 109');
    expect(p.label, '부산 부산진구 부전동 112-3');
  });

  test('지번을 골랐는데 지번이 없으면 도로명으로 보인다', () {
    final p = pickedFromJson({
      'userSelectedType': 'J',
      'roadAddress': '부산 부산진구 동천로 109',
    })!;
    expect(p.label, '부산 부산진구 동천로 109');
  });

  test('도로명이 없는 결과(지번만·빈 값·글자 아님)는 받지 않는다', () {
    expect(
      pickedFromJson({
        'userSelectedType': 'J',
        'jibunAddress': '부산 부산진구 부전동 112-3',
      }),
      isNull,
    );
    expect(
      pickedFromJson({'roadAddress': '   ', 'autoRoadAddress': ''}),
      isNull,
    );
    expect(pickedFromJson({'roadAddress': 109}), isNull);
    expect(pickedFromJson(const {}), isNull);
  });

  test('주소 값은 로그용 문자열에 드러나지 않는다', () {
    final p = pickedFromJson({'roadAddress': '부산 부산진구 동천로 109'})!;
    expect(p.toString(), isNot(contains('동천로')));
  });
}
