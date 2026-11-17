import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:kakao_map_sdk/kakao_map_sdk.dart';
import 'package:pmart_core/pmart_core.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'app.dart';
import 'features/auth/data/rider_auth.dart' show riderRefresher;
import 'features/auth/data/session.dart';
import 'features/push/push_messages.dart';
import 'features/push/push_tokens.dart';
import 'shared/providers.dart';
import 'shared/kakao_navi.dart';
import 'shared/rider_map.dart' show kakaoNativeAppKey;

/// FCM 등록 토큰(firebase_messaging). 토큰 값은 로그에 남기지 않는다.
///
/// 계약(notification 0.3.0 PushTokenRegistration.token)이 "FCM 등록 토큰"이라 getToken·onTokenRefresh 를 쓴다.
/// firebase_messaging 17 은 이를 deprecated 로 두고 register()/onRegistered(설치 ID, 직접 발송 대상)를 권한다 —
/// 서버 발송 방식이 정해지면 바꾼다(백엔드 발송은 아직 없음).
final class FirebasePushTokenSource implements PushTokenSource {
  FirebasePushTokenSource(this._fcm);

  final FirebaseMessaging _fcm;

  @override
  Future<void> requestPermission() => _fcm.requestPermission();

  @override
  // ignore: deprecated_member_use
  Future<String?> token() => _fcm.getToken();

  @override
  // ignore: deprecated_member_use
  Stream<String> get onTokenRefresh => _fcm.onTokenRefresh;

  static PushMessage _of(RemoteMessage m) => PushMessage.fromData(
    m.data,
    title: m.notification?.title,
    body: m.notification?.body,
  );

  @override
  Stream<PushMessage> get onForeground => FirebaseMessaging.onMessage.map(_of);

  @override
  Stream<PushMessage> get onOpened =>
      FirebaseMessaging.onMessageOpenedApp.map(_of);

  @override
  Future<PushMessage?> initialMessage() async {
    final m = await _fcm.getInitialMessage();
    return m == null ? null : _of(m);
  }
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initPmartFormatting();
  // LAN HTTPS 게이트웨이(사설 CA, ADR-0057)를 믿는다 — 운영(release) 빌드에는 넣지 않는다(T6). 고객앱과 같다.
  if (!kReleaseMode) trustPmartLanRootCa();
  // 카카오 지도·내비는 키가 있을 때만 켠다(빌드 때 --dart-define-from-file=.secrets/rider.env). 키는 로그에 남기지 않는다.
  if (kakaoNativeAppKey.isNotEmpty) {
    await KakaoMapSdk.instance.initialize(kakaoNativeAppKey);
    initKakaoNavi();
  }
  // Firebase 메시징(google-services.json 이 있는 빌드). 못 켜면 푸시 없이 간다(알림함은 따로 있다).
  PushTokenSource push = const NoPushTokenSource();
  try {
    await Firebase.initializeApp();
    push = FirebasePushTokenSource(FirebaseMessaging.instance);
  } on Object catch (e) {
    debugPrint('Firebase 초기화 안 됨: ${e.runtimeType}');
  }
  // 앱이 내려졌다 다시 켜져도(카메라 등) 로그인 상태를 잇는다.
  final saved = await loadSavedSession(FlutterSecureKeyValueStore());
  runApp(
    // Riverpod 3 의 자동 재시도를 끈다. 재시도 규칙은 pmart_core(429·retryable)만 따른다.
    ProviderScope(
      retry: (_, _) => null,
      overrides: [
        initialSessionProvider.overrideWithValue(saved),
        pushTokenSourceProvider.overrideWithValue(push),
        // 실서버: 라이더 토큰 갱신(rider-auth) · 갱신 거절이면 로그인 화면으로.
        tokenRefresherProvider.overrideWith(
          (ref) => riderRefresher(
            baseUrl: riderApiBaseUrl(ref.watch(envProvider)),
            deviceId: ref.watch(deviceIdProvider),
          ),
        ),
        onSessionExpiredProvider.overrideWith(
          (ref) =>
              () => ref.read(sessionProvider.notifier).sessionExpired(),
        ),
      ],
      child: const RiderApp(),
    ),
  );
  // 카카오내비 SDK 사용 권한 확인용 빌드(--dart-define=KNSDK_PROBE=true)에서만: 인증 결과 코드를 로그에 남긴다.
  if (const bool.fromEnvironment('KNSDK_PROBE')) {
    final code = await probeInAppNavi();
    debugPrint('KNSDK probe: ${code ?? 'OK'}');
  }
}
