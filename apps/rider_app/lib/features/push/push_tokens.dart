import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_api_notification/pmart_api_notification.dart' as nt;
import 'package:pmart_core/pmart_core.dart';

import '../../shared/providers.dart';
import '../auth/data/session.dart';
import 'push_messages.dart';

/// 이 단말의 푸시 토큰(FCM). 화면·시험은 이 인터페이스만 본다 — Firebase 는 main 에서만 연결한다.
abstract interface class PushTokenSource {
  /// 알림 권한을 묻는다(Android 13+). 거절해도 토큰은 등록한다(나중에 설정에서 켤 수 있다).
  Future<void> requestPermission();

  /// 현재 토큰. 못 얻으면 null.
  Future<String?> token();

  /// 토큰이 바뀌면 새 토큰.
  Stream<String> get onTokenRefresh;

  /// 앱을 보고 있을 때 받은 푸시(시스템이 띄우지 않는다).
  Stream<PushMessage> get onForeground;

  /// 알림을 눌러 앱이 앞으로 왔다.
  Stream<PushMessage> get onOpened;

  /// 앱이 꺼져 있을 때 알림을 눌러 켰으면 그 알림.
  Future<PushMessage?> initialMessage();
}

/// Firebase 를 쓰지 않는 실행(시험·Firebase 초기화 실패) — 아무것도 하지 않는다.
final class NoPushTokenSource implements PushTokenSource {
  const NoPushTokenSource();

  @override
  Future<void> requestPermission() async {}

  @override
  Future<String?> token() async => null;

  @override
  Stream<String> get onTokenRefresh => const Stream.empty();

  @override
  Stream<PushMessage> get onForeground => const Stream.empty();

  @override
  Stream<PushMessage> get onOpened => const Stream.empty();

  @override
  Future<PushMessage?> initialMessage() async => null;
}

final pushTokenSourceProvider = Provider<PushTokenSource>(
  (_) => const NoPushTokenSource(),
);

/// 단말 푸시 토큰 등록·해제(notification-service 0.3.0 `PUT/DELETE /me/push-tokens/{deviceId}`).
/// 토큰 값은 로그·화면에 남기지 않는다.
abstract interface class PushTokenRepository {
  Future<void> register(String deviceId, String token);
  Future<void> unregister(String deviceId);
}

/// 목: 서버가 없다 — 보낸 것만 기억한다(시험 확인용, 토큰 값은 남기지 않는다).
final class MockPushTokenRepository implements PushTokenRepository {
  final registered = <String>[];
  final unregistered = <String>[];

  @override
  Future<void> register(String deviceId, String token) async =>
      registered.add(deviceId);

  @override
  Future<void> unregister(String deviceId) async => unregistered.add(deviceId);
}

final class ApiPushTokenRepository implements PushTokenRepository {
  ApiPushTokenRepository(Dio dio)
    : _api = nt.PmartApiNotification(dio: dio).getPushTokensApi();

  final nt.PushTokensApi _api;

  /// 같은 단말로 다시 부르면 토큰을 바꾼다(서버 멱등). 부를 때마다 새 키다.
  @override
  Future<void> register(String deviceId, String token) async {
    final key = IdempotencyKey.generate();
    await pmartGuard(
      () => _api.registerMyPushToken(
        deviceId: deviceId,
        idempotencyKey: key.value,
        xSourceSystem: sourceSystem,
        pushTokenRegistration: nt.PushTokenRegistration(
          token: token,
          platform: nt.PushPlatform.ANDROID,
        ),
        extra: commandOptions(key).extra,
      ),
    );
  }

  @override
  Future<void> unregister(String deviceId) async {
    final key = IdempotencyKey.generate();
    await pmartGuard(
      () => _api.unregisterMyPushToken(
        deviceId: deviceId,
        idempotencyKey: key.value,
        xSourceSystem: sourceSystem,
        extra: commandOptions(key).extra,
      ),
    );
  }
}

final pushTokenRepositoryProvider = Provider<PushTokenRepository>(
  (ref) => switch (ref.watch(envProvider)) {
    PmartEnv.mock => MockPushTokenRepository(),
    PmartEnv.local => ApiPushTokenRepository(ref.watch(dioProvider)),
  },
);

/// 로그인(가입한 라이더)하면 이 단말의 토큰을 등록하고, 토큰이 바뀌면 다시 등록한다.
/// 실패는 화면에 띄우지 않는다 — 다음 로그인·앱 시작·토큰 교체 때 다시 한다(알림함은 따로 있다).
class PushRegistrar {
  PushRegistrar(this._ref);

  final Ref _ref;
  StreamSubscription<String>? _refresh;

  Future<void> onSession(RiderSession? s) async {
    await _refresh?.cancel();
    _refresh = null;
    if (s == null || !s.registered) return;
    final source = _ref.read(pushTokenSourceProvider);
    try {
      await source.requestPermission();
      final token = await source.token();
      if (token != null && token.isNotEmpty) await _register(token);
    } on Object catch (e) {
      // 토큰 값을 남기지 않는다 — 종류만.
      debugPrint('push token register skipped: ${e.runtimeType}');
    }
    _refresh = source.onTokenRefresh.listen((t) {
      if (_ref.read(sessionProvider)?.registered ?? false) {
        unawaited(
          _register(t).catchError(
            (Object e) =>
                debugPrint('push token refresh skipped: ${e.runtimeType}'),
          ),
        );
      }
    });
  }

  Future<void> _register(String token) async {
    final deviceId = await _ref.read(deviceIdProvider).get();
    await _ref.read(pushTokenRepositoryProvider).register(deviceId, token);
  }

  void dispose() => unawaited(_refresh?.cancel());
}

/// 로그아웃 전에(토큰이 있을 때) 이 단말의 등록을 푼다 — 다른 라이더 알림이 이 단말로 오지 않게.
/// 세션에 기대지 않는다(세션 컨트롤러가 부른다). 토큰 교체 구독은 세션이 비면 등록기가 끊는다.
final pushUnregisterProvider = Provider<Future<void> Function()>(
  (ref) => () async {
    try {
      final deviceId = await ref.read(deviceIdProvider).get();
      await ref.read(pushTokenRepositoryProvider).unregister(deviceId);
    } on Object catch (e) {
      debugPrint('push token unregister skipped: ${e.runtimeType}');
    }
  },
);

/// 세션을 지켜보며 등록한다. 앱이 켜질 때 한 번 읽어 둔다(app.dart).
final pushRegistrarProvider = Provider<PushRegistrar>((ref) {
  final r = PushRegistrar(ref);
  ref.onDispose(r.dispose);
  unawaited(r.onSession(ref.read(sessionProvider)));
  ref.listen<RiderSession?>(sessionProvider, (prev, next) {
    final changed =
        prev?.riderId != next?.riderId || prev?.registered != next?.registered;
    if (changed) unawaited(r.onSession(next));
  });
  return r;
});
