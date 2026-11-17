import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_core/pmart_core.dart';

/// `X-Source-System` (값 확정은 BR-08).
const sourceSystem = 'rider-app';

final envProvider = Provider<PmartEnv>((_) => PmartEnv.fromDefine());

final secureStoreProvider = Provider<SecureKeyValueStore>(
  (_) => FlutterSecureKeyValueStore(),
);

final tokenStoreProvider = Provider<TokenStore>(
  (ref) => TokenStore(ref.watch(secureStoreProvider)),
);

/// 토큰 갱신(`POST /auth/tokens`)이 `X-Device-Id` 를 요구하므로 모든 앱이 보낸다.
final deviceIdProvider = Provider<DeviceIdProvider>(
  (ref) => DeviceIdProvider(ref.watch(secureStoreProvider)),
);

/// 토큰 갱신(rider-auth `POST /rider-auth/tokens`). 순환 의존을 피하려고 앱이 연결한다
/// (`features/auth/data/rider_auth.dart` riderRefresher). 기본은 갱신 없음(세션 만료).
final tokenRefresherProvider = Provider<TokenRefresher>(
  (_) =>
      (_) async => null,
);

/// 세션 종료(갱신 거절) 때 할 일 — 앱이 세션 컨트롤러를 연결한다.
final onSessionExpiredProvider = Provider<void Function()>((_) => () {});

String riderApiBaseUrl(PmartEnv env) => apiBaseUrl(
  env,
  androidEmulator: const bool.fromEnvironment('PMART_ANDROID_EMULATOR'),
);

/// 실서버(local) 연동용 Dio(라이더 토큰). 목 모드에서는 만들지 않는다.
/// 401 이면 인터셉터가 refresh 를 회전한 뒤 다시 보내고, 갱신이 거절되면 토큰을 지우고 세션을 끝낸다.
final dioProvider = Provider<Dio>((ref) {
  final env = ref.watch(envProvider);
  if (env == PmartEnv.mock) {
    throw StateError('목 모드는 네트워크를 쓰지 않는다. Repository 목 구현을 써야 한다.');
  }
  return createPmartDio(
    baseUrl: riderApiBaseUrl(env),
    sourceSystem: sourceSystem,
    tokens: ref.watch(tokenStoreProvider),
    deviceId: ref.watch(deviceIdProvider),
    refresher: ref.watch(tokenRefresherProvider),
    onSessionExpired: () => ref.read(onSessionExpiredProvider)(),
    log: kDebugMode ? debugPrint : null,
  );
});
