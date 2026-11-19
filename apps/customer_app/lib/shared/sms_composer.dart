import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// 문자 앱을 받는 번호·본문을 채워 연다(Android `ACTION_SENDTO smsto:`, MainActivity 채널 `pmart/sms`).
/// 새 라이브러리 없이 쓴다. 문자 앱이 없으면 false — 화면이 번호·본문 복사로 안내한다.
typedef SmsComposer = Future<bool> Function(String to, String body);

const _channel = MethodChannel('pmart/sms');

final smsComposerProvider = Provider<SmsComposer>(
  (_) => (to, body) async {
    try {
      return await _channel.invokeMethod<bool>('compose', {
            'to': to.replaceAll(RegExp(r'\D'), ''),
            'body': body,
          }) ??
          false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  },
);
