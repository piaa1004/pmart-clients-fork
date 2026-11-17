import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'features/push/push_messages.dart';
import 'features/push/push_tokens.dart';
import 'l10n/gen/app_localizations.dart';
import 'router.dart';
import 'shared/rider_style.dart';

class RiderApp extends ConsumerWidget {
  const RiderApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // 로그인하면 이 단말의 푸시 토큰을 등록한다(세션을 지켜본다).
    ref
      ..watch(pushRegistrarProvider)
      // 받은 푸시: 누르면 그 화면, 앱을 보고 있으면 배너.
      ..watch(pushHandlerProvider);
    return _app(ref);
  }

  Widget _app(WidgetRef ref) => MaterialApp.router(
    onGenerateTitle: (context) => AppLocalizations.of(context).appTitle,
    // 레퍼런스가 밝은 화면 기준이라(일부 화면만 어두운 머리띠) 어두운 테마는 두지 않는다.
    theme: RiderTheme.light(),
    debugShowCheckedModeBanner: false,
    locale: const Locale('ko'),
    supportedLocales: AppLocalizations.supportedLocales,
    localizationsDelegates: const [
      AppLocalizations.delegate,
      PmartUiLocalizations.delegate,
      GlobalMaterialLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate,
    ],
    routerConfig: ref.watch(routerProvider),
    scaffoldMessengerKey: ref.watch(riderMessengerKeyProvider),
  );
}
