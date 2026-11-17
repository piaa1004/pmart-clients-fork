import 'package:flutter/services.dart';

/// 휴대폰 번호 숫자만(최대 11자리).
String phoneDigits(String text) {
  final digits = text.replaceAll(RegExp(r'[^0-9]'), '');
  return digits.length > 11 ? digits.substring(0, 11) : digits;
}

/// 휴대폰 번호 표시: 010-0000-0000(11자리), 010-000-0000(10자리). 쓰는 중에는 자리에 맞춰 하이픈.
String formatPhone(String text) {
  final d = phoneDigits(text);
  if (d.length <= 3) return d;
  // 10자리(예: 011-123-4567)는 가운데 3자리, 그 밖(입력 중·11자리)은 가운데 4자리.
  final mid = d.length == 10 ? 6 : 7;
  if (d.length <= mid) return '${d.substring(0, 3)}-${d.substring(3)}';
  return '${d.substring(0, 3)}-${d.substring(3, mid)}-${d.substring(mid)}';
}

/// 입력하면서 하이픈을 자동으로 넣고, 숫자 11자리(010-0000-0000)를 넘으면 더 받지 않는다.
/// 서버에는 숫자만 보낸다([phoneDigits]).
class PhoneNumberFormatter extends TextInputFormatter {
  const PhoneNumberFormatter();

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    // 11자리가 찬 뒤 더 치면 그대로 둔다(입력 불가).
    if (phoneDigits(oldValue.text).length == 11 &&
        newValue.text.replaceAll(RegExp(r'[^0-9]'), '').length > 11) {
      return oldValue;
    }
    // 커서 앞 숫자 개수를 유지해 하이픈이 들어가도 커서가 제자리에 있게 한다.
    final cursor = newValue.selection.end.clamp(0, newValue.text.length);
    final digitsBefore = phoneDigits(newValue.text.substring(0, cursor)).length;
    final formatted = formatPhone(newValue.text);
    var offset = 0;
    var seen = 0;
    while (offset < formatted.length && seen < digitsBefore) {
      if (formatted.codeUnitAt(offset) != 0x2D) seen++;
      offset++;
    }
    return TextEditingValue(
      text: formatted,
      selection: TextSelection.collapsed(offset: offset),
    );
  }
}

/// 운전면허 번호 표시: 지역 2 · 연도 2 · 일련 6 · 검증 2 = 00-00-000000-00(12자리).
String formatLicense(String text) {
  var d = text.replaceAll(RegExp(r'[^0-9]'), '');
  if (d.length > 12) d = d.substring(0, 12);
  final parts = <String>[];
  for (final (start, end) in [(0, 2), (2, 4), (4, 10), (10, 12)]) {
    if (d.length <= start) break;
    parts.add(d.substring(start, d.length < end ? d.length : end));
  }
  return parts.join('-');
}

/// 면허 번호를 치면서 하이픈을 자동으로 넣고, 12자리를 넘으면 더 받지 않는다(사용자 요청 2026-11-17 —
/// 형식이 틀려 중복확인이 안 넘어가던 문제).
class LicenseNumberFormatter extends TextInputFormatter {
  const LicenseNumberFormatter();

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    int digits(String s) => s.replaceAll(RegExp(r'[^0-9]'), '').length;
    if (digits(oldValue.text) == 12 && digits(newValue.text) > 12) {
      return oldValue;
    }
    final cursor = newValue.selection.end.clamp(0, newValue.text.length);
    final before = digits(newValue.text.substring(0, cursor));
    final formatted = formatLicense(newValue.text);
    var offset = 0;
    var seen = 0;
    while (offset < formatted.length && seen < before) {
      if (formatted.codeUnitAt(offset) != 0x2D) seen++;
      offset++;
    }
    return TextEditingValue(
      text: formatted,
      selection: TextSelection.collapsed(offset: offset),
    );
  }
}
