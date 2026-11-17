import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'features/auth/data/session.dart';
import 'features/auth/presentation/fee_guide_screen.dart';
import 'features/auth/presentation/login_screen.dart';
import 'features/auth/presentation/signup_screens.dart';
import 'features/delivery/domain/delivery.dart' show FailureReason;
import 'features/delivery/presentation/delivery_list_screen.dart';
import 'features/delivery/presentation/delivery_screen.dart';
import 'features/delivery/presentation/photo_screen.dart';
import 'features/delivery/presentation/failure_screen.dart';
import 'features/delivery/presentation/qr_pickup_screen.dart';
import 'features/delivery/presentation/support_screen.dart';
import 'features/delivery/presentation/support_thread_screen.dart';
import 'features/home/presentation/home_screen.dart';
import 'features/inquiries/presentation/inquiry_screens.dart';
import 'features/inquiries/presentation/live_chat_screen.dart';
import 'features/notifications/presentation/notification_screen.dart';
import 'features/my/presentation/my_screens.dart';
import 'features/my/presentation/record_screens.dart';
import 'features/my/presentation/withdraw_screen.dart';
import 'features/offers/presentation/offer_detail_screen.dart';

/// 라우트. 로그인하지 않았으면 로그인·가입 화면만 열린다. 알림 딥링크는 푸시(BR-09) 결정 뒤 붙인다.
final routerProvider = Provider<GoRouter>((ref) {
  final loggedIn = ref.watch(sessionProvider.select((s) => s != null));
  final registered = ref.watch(
    sessionProvider.select((s) => s?.registered ?? false),
  );
  return GoRouter(
    initialLocation: '/',
    // 로그인(Google) → 가입 여부 확인(`GET /riders/me` 404 = 미가입) → 가입 화면 또는 홈
    // (백엔드 안내 2026-11-13 rider-app-notice-dispatch-apis §1).
    redirect: (_, state) {
      final at = state.matchedLocation;
      final signup = at.startsWith('/signup');
      if (!loggedIn) {
        return at == '/login' || at == '/signup/intro' ? null : '/login';
      }
      if (!registered) {
        return signup && at != '/signup/intro' ? null : '/signup';
      }
      if (at == '/login' || (signup && at != '/signup/done')) return '/';
      return null;
    },
    routes: [
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(
        path: '/signup/intro',
        builder: (_, _) => const SignupIntroScreen(),
      ),
      GoRoute(path: '/signup', builder: (_, _) => const SignupFlowScreen()),
      GoRoute(path: '/signup/fees', builder: (_, _) => const FeeGuideScreen()),
      GoRoute(
        path: '/signup/terms/:type',
        builder: (_, s) => TermsScreen(type: s.pathParameters['type']!),
      ),
      GoRoute(
        path: '/signup/done',
        builder: (_, _) => const SignupDoneScreen(),
      ),
      GoRoute(path: '/', builder: (_, _) => const HomeScreen()),
      GoRoute(
        path: '/offers/:offerId',
        builder: (_, s) =>
            OfferDetailScreen(offerId: s.pathParameters['offerId']!),
      ),
      GoRoute(
        path: '/deliveries',
        builder: (_, _) => const DeliveryListScreen(),
      ),
      GoRoute(
        path: '/deliveries/:deliveryId',
        builder: (_, s) =>
            DeliveryScreen(deliveryId: s.pathParameters['deliveryId']!),
      ),
      GoRoute(
        path: '/deliveries/:deliveryId/qr',
        builder: (_, s) =>
            QrPickupScreen(deliveryId: s.pathParameters['deliveryId']!),
      ),
      GoRoute(
        path: '/deliveries/:deliveryId/photo',
        builder: (_, s) =>
            PhotoScreen(deliveryId: s.pathParameters['deliveryId']!),
      ),
      GoRoute(
        path: '/deliveries/:deliveryId/failure',
        pageBuilder: (_, s) => _overMap(
          s,
          FailureScreen(
            deliveryId: s.pathParameters['deliveryId']!,
            // ?reason=unreachable|addressError — 지원센터 갈림길에서 미리 고른 사유.
            initialReason: FailureReason.values
                .where((r) => r.name == s.uri.queryParameters['reason'])
                .firstOrNull,
          ),
        ),
      ),
      GoRoute(
        path: '/deliveries/:deliveryId/support',
        pageBuilder: (_, s) => _overMap(
          s,
          SupportScreen(deliveryId: s.pathParameters['deliveryId']!),
        ),
      ),
      GoRoute(
        path: '/deliveries/:deliveryId/support/:requestId',
        pageBuilder: (_, s) => _overMap(
          s,
          SupportThreadScreen(
            deliveryId: s.pathParameters['deliveryId']!,
            requestId: s.pathParameters['requestId']!,
          ),
        ),
      ),
      GoRoute(path: '/my', builder: (_, _) => const MyPageScreen()),
      GoRoute(path: '/my/settings', builder: (_, _) => const SettingsScreen()),
      GoRoute(
        path: '/my/dispatch-mode',
        builder: (_, _) => const DispatchModeScreen(),
      ),
      GoRoute(path: '/my/time', builder: (_, _) => const OperatingTimeScreen()),
      GoRoute(
        path: '/my/settlements',
        builder: (_, _) => const SettlementsScreen(),
      ),
      GoRoute(path: '/my/history', builder: (_, _) => const HistoryScreen()),
      // 배송 밖 문의(case-service, 라이더 토큰)·알림함(notification).
      GoRoute(
        path: '/my/inquiries',
        builder: (_, _) => const InquiryListScreen(),
      ),
      GoRoute(
        path: '/my/inquiries/chat',
        builder: (_, _) => const LiveChatScreen(),
      ),
      GoRoute(
        path: '/my/inquiries/new',
        builder: (_, _) => const InquiryNewScreen(),
      ),
      GoRoute(
        path: '/my/inquiries/:inquiryId',
        builder: (_, s) =>
            InquiryDetailScreen(inquiryId: s.pathParameters['inquiryId']!),
      ),
      GoRoute(path: '/my/withdraw', builder: (_, _) => const WithdrawScreen()),
      GoRoute(
        path: '/notifications',
        builder: (_, _) => const NotificationScreen(),
      ),
    ],
  );
});

/// 지도(카카오맵 — 안드로이드가 직접 그리는 화면) 위로 여닫는 화면의 전환. 기본 전환은 아래 화면을
/// 확대·축소해 지도가 함께 다시 그려지면서 끊긴다(사용자 지적 2026-11-17 "버벅거리면서 돌아간다") —
/// 지도를 움직이지 않는 짧은 페이드로 바꾼다.
Page<void> _overMap(GoRouterState s, Widget child) =>
    CustomTransitionPage<void>(
      key: s.pageKey,
      child: child,
      transitionDuration: const Duration(milliseconds: 180),
      reverseTransitionDuration: const Duration(milliseconds: 140),
      transitionsBuilder: (_, animation, _, child) =>
          FadeTransition(opacity: animation, child: child),
    );
