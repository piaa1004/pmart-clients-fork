import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';

import 'package:rider_app/features/auth/data/session.dart';
import 'package:rider_app/shared/providers.dart';

/// 껐다 켰을 때 세션: 가입한 라이더는 이어 가고, 지원하기 중(미가입)이면 로그인 화면부터.
void main() {
  Future<MemoryKeyValueStore> saved({required bool newAccount}) async {
    final store = MemoryKeyValueStore();
    final c = ProviderContainer(
      overrides: [
        envProvider.overrideWithValue(PmartEnv.mock),
        secureStoreProvider.overrideWithValue(store),
      ],
    );
    addTearDown(c.dispose);
    await c
        .read(sessionProvider.notifier)
        .loginWithGoogle(newAccount: newAccount);
    await Future<void>.delayed(Duration.zero);
    return store;
  }

  test('가입한 라이더는 다시 켜도 로그인된 채로 이어 간다', () async {
    final store = await saved(newAccount: false);
    final s = await loadSavedSession(store);
    expect(s, isNotNull);
    expect(s!.registered, isTrue);
  });

  test('지원하기 중(미가입)이면 다시 켤 때 세션을 버리고 로그인 화면부터', () async {
    final store = await saved(newAccount: true);
    expect(await loadSavedSession(store), isNull);
    // 지운 뒤에는 다음에도 없다.
    expect(await loadSavedSession(store), isNull);
  });
}
