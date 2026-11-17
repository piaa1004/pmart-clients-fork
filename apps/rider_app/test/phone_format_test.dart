import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rider_app/features/auth/data/signup.dart';
import 'package:rider_app/shared/phone_format.dart';

/// 지원하기 입력 규칙: 휴대폰 번호(하이픈 자동, 11자리까지) · 이름(자음·모음만은 안 됨).
void main() {
  TextEditingValue type(String before, String typed) {
    const f = PhoneNumberFormatter();
    final old = TextEditingValue(
      text: before,
      selection: TextSelection.collapsed(offset: before.length),
    );
    final next = before + typed;
    return f.formatEditUpdate(
      old,
      TextEditingValue(
        text: next,
        selection: TextSelection.collapsed(offset: next.length),
      ),
    );
  }

  String typeAll(String digits) {
    var v = '';
    for (final c in digits.split('')) {
      v = type(v, c).text;
    }
    return v;
  }

  test('치는 대로 하이픈이 붙는다', () {
    expect(typeAll('010'), '010');
    expect(typeAll('0101'), '010-1');
    expect(typeAll('0101234'), '010-1234');
    expect(typeAll('01012345'), '010-1234-5');
    expect(typeAll('01012345678'), '010-1234-5678');
  });

  test('11자리가 차면 더 입력되지 않는다', () {
    expect(type('010-1234-5678', '9').text, '010-1234-5678');
    expect(typeAll('0101234567899'), '010-1234-5678');
  });

  test('붙여 넣은 번호도 정리하고 11자리에서 자른다', () {
    final v = const PhoneNumberFormatter().formatEditUpdate(
      TextEditingValue.empty,
      const TextEditingValue(
        text: '010 1234 5678 99',
        selection: TextSelection.collapsed(offset: 16),
      ),
    );
    expect(v.text, '010-1234-5678');
    expect(v.selection.end, v.text.length);
  });

  test('저장·전송은 숫자만', () {
    expect(phoneDigits('010-1234-5678'), '01012345678');
    expect(formatPhone('0111234567'), '011-123-4567');
  });

  test('이름: 완성된 한글·영문 2글자 이상, 자음·모음만은 안 됨', () {
    expect(nameValid('홍길동'), isTrue);
    expect(nameValid('김 '), isFalse, reason: '1글자');
    expect(nameValid('ㅎㄱㄷ'), isFalse);
    expect(nameValid('홍ㄱ동'), isFalse);
    expect(nameValid('ㅏㅣ'), isFalse);
    expect(nameValid('홍길1'), isFalse);
    expect(nameValid('John Smith'), isTrue);
    expect(hasLooseJamo('홍ㄱ동'), isTrue);
    expect(hasLooseJamo('홍길동'), isFalse);
  });

  test('면허 번호: 00-00-000000-00 하이픈 자동, 12자리까지', () {
    expect(formatLicense('11'), '11');
    expect(formatLicense('112'), '11-2');
    expect(formatLicense('1122333'), '11-22-333');
    expect(formatLicense('112233333344'), '11-22-333333-44');
    expect(formatLicense('11223333334499'), '11-22-333333-44');
    const f = LicenseNumberFormatter();
    final full = f.formatEditUpdate(
      TextEditingValue.empty,
      const TextEditingValue(
        text: '112233333344',
        selection: TextSelection.collapsed(offset: 12),
      ),
    );
    expect(full.text, '11-22-333333-44');
    expect(licensePattern.hasMatch(full.text), isTrue);
    final more = f.formatEditUpdate(
      full,
      const TextEditingValue(
        text: '11-22-333333-449',
        selection: TextSelection.collapsed(offset: 16),
      ),
    );
    expect(more.text, '11-22-333333-44');
  });

  test('지우면 하이픈도 맞춰 줄어든다', () {
    final v = const PhoneNumberFormatter().formatEditUpdate(
      const TextEditingValue(
        text: '010-1234-5',
        selection: TextSelection.collapsed(offset: 10),
      ),
      const TextEditingValue(
        text: '010-1234-',
        selection: TextSelection.collapsed(offset: 9),
      ),
    );
    expect(v.text, '010-1234');
  });
}
