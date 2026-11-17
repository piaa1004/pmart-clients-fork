import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';

import 'package:rider_app/features/auth/data/session.dart';
import 'package:rider_app/features/push/push_messages.dart';
import 'package:rider_app/features/push/push_tokens.dart';
import 'package:rider_app/shared/providers.dart';

final class _FakeSource implements PushTokenSource {
  final refresh = StreamController<String>.broadcast();
  int asked = 0;

  @override
  Future<void> requestPermission() async => asked++;

  @override
  Future<String?> token() async => 'tok-1';

  @override
  Stream<String> get onTokenRefresh => refresh.stream;

  @override
  Stream<PushMessage> get onForeground => const Stream.empty();

  @override
  Stream<PushMessage> get onOpened => const Stream.empty();

  @override
  Future<PushMessage?> initialMessage() async => null;
}

final class _CountingRepo implements PushTokenRepository {
  final registered = <(String, String)>[];
  final unregistered = <String>[];

  @override
  Future<void> register(String deviceId, String token) async =>
      registered.add((deviceId, token));

  @override
  Future<void> unregister(String deviceId) async => unregistered.add(deviceId);
}

/// 로그인(가입한 라이더) → 이 단말 토큰 등록, 토큰 교체 → 다시 등록, 로그아웃 → 해제.
void main() {
  Future<void> flush() => Future<void>.delayed(Duration.zero);

  ProviderContainer make(
    _FakeSource source,
    _CountingRepo repo,
    RiderSession? s,
  ) {
    final c = ProviderContainer(
      overrides: [
        initialSessionProvider.overrideWithValue(s),
        secureStoreProvider.overrideWithValue(MemoryKeyValueStore()),
        pushTokenSourceProvider.overrideWithValue(source),
        pushTokenRepositoryProvider.overrideWithValue(repo),
      ],
    );
    addTearDown(c.dispose);
    c.read(pushRegistrarProvider);
    return c;
  }

  test('가입한 라이더로 로그인하면 등록하고, 토큰이 바뀌면 다시, 로그아웃하면 해제', () async {
    final source = _FakeSource();
    final repo = _CountingRepo();
    final c = make(source, repo, null);
    await flush();
    expect(repo.registered, isEmpty, reason: '로그인 전에는 등록하지 않는다');

    await c.read(sessionProvider.notifier).loginWithGoogle();
    for (var i = 0; i < 5; i++) {
      await flush();
    }
    expect(source.asked, 1);
    expect(repo.registered.single.$2, 'tok-1');
    final deviceId = repo.registered.single.$1;
    expect(deviceId, await c.read(deviceIdProvider).get());

    source.refresh.add('tok-2');
    await flush();
    await flush();
    expect(repo.registered.last, (deviceId, 'tok-2'));

    c.read(sessionProvider.notifier).logout();
    for (var i = 0; i < 5; i++) {
      await flush();
    }
    expect(repo.unregistered, [deviceId]);
    source.refresh.add('tok-3');
    await flush();
    expect(repo.registered, hasLength(2), reason: '로그아웃 뒤 토큰 교체는 등록하지 않는다');
  });

  test('가입 전(지원하기 중)에는 등록하지 않는다', () async {
    final source = _FakeSource();
    final repo = _CountingRepo();
    final c = make(source, repo, null);
    await c.read(sessionProvider.notifier).loginWithGoogle(newAccount: true);
    for (var i = 0; i < 5; i++) {
      await flush();
    }
    expect(repo.registered, isEmpty);
    c.read(sessionProvider.notifier).markRegistered();
    for (var i = 0; i < 5; i++) {
      await flush();
    }
    expect(repo.registered, hasLength(1));
  });
}
