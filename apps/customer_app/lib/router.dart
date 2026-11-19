import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_ui/pmart_ui.dart';

import 'features/address/presentation/address_screens.dart';
import 'features/address/presentation/postcode_screen.dart' show PostcodeResult;
import 'features/cart/presentation/cart_merge_screen.dart';
import 'features/start/presentation/start_controller.dart';
import 'features/start/presentation/start_screens.dart';
import 'features/auth/domain/auth.dart';
import 'features/auth/presentation/login_screen.dart';
import 'features/cart/presentation/cart_screen.dart';
import 'features/checkout/presentation/delivery_select_screen.dart';
import 'features/checkout/presentation/order_sheet_screen.dart';
import 'features/claims/presentation/claims_screens.dart';
import 'features/catalog/domain/catalog.dart' show ProductTile;
import 'features/catalog/presentation/category_screen.dart';
import 'features/notifications/presentation/notifications_screens.dart';
import 'features/redelivery/presentation/redelivery_screens.dart';
import 'features/payment/presentation/payment_screen.dart';
import 'features/profile/presentation/phone_verification_screen.dart';
import 'features/profile/presentation/my_info_screen.dart';
import 'features/reviews/domain/reviews.dart'
    show ReviewEligibility, ReviewTarget;
import 'features/reviews/presentation/reviews_screens.dart';
import 'features/support/domain/faq.dart';
import 'features/support/presentation/chat_screen.dart';
import 'features/support/presentation/faq_screens.dart';
import 'features/support/presentation/inquiry_screens.dart';
import 'features/orders/presentation/my_screen.dart';
import 'features/profile/presentation/consents_screens.dart';
import 'features/orders/presentation/order_help_screen.dart';
import 'features/orders/presentation/orders_screens.dart';
import 'features/catalog/presentation/home_providers.dart' show SectionRef;
import 'features/catalog/presentation/home_screen.dart';
import 'features/catalog/presentation/section_items_screen.dart';
import 'features/catalog/presentation/product_detail_screen.dart';
import 'features/catalog/presentation/product_list_screen.dart';
import 'features/catalog/presentation/search_screen.dart';
import 'l10n/gen/app_localizations.dart';

final rootNavigatorKey = GlobalKey<NavigatorState>();

/// 라우트. 탭은 각자 내비게이션 스택을 가진다(탭을 오가도 검색어·스크롤이 남는다).
/// 상품 상세는 탭 위로 올린다. 로그인 리다이렉트·딥링크(알림 → 화면)는 로그인 단계에서 붙인다.
final routerProvider = Provider<GoRouter>((ref) {
  // 처음 실행 단계(환영·약관 → 로그인/둘러보기 → 주소)가 바뀌면 redirect 를 다시 본다.
  final startStep = ValueNotifier<StartStep>(ref.read(startStepProvider));
  ref.listen(startStepProvider, (_, s) => startStep.value = s);
  ref.onDispose(startStep.dispose);
  var resolved = false;
  return GoRouter(
    navigatorKey: rootNavigatorKey,
    initialLocation: '/',
    refreshListenable: startStep,
    redirect: (_, state) {
      final step = startStep.value;
      if (step == StartStep.ready) resolved = true;
      return startRedirect(step, state.matchedLocation, resolved: resolved);
    },
    routes: [
      GoRoute(
        parentNavigatorKey: rootNavigatorKey,
        path: StartRoutes.splash,
        builder: (_, _) => const StartSplashScreen(),
        routes: [
          GoRoute(
            parentNavigatorKey: rootNavigatorKey,
            path: 'welcome',
            builder: (_, _) => const WelcomeScreen(),
          ),
          GoRoute(
            parentNavigatorKey: rootNavigatorKey,
            path: 'entry',
            builder: (_, _) => const LoginScreen(entry: true),
          ),
          GoRoute(
            parentNavigatorKey: rootNavigatorKey,
            path: 'address',
            builder: (_, _) => const StartAddressScreen(),
          ),
        ],
      ),
      GoRoute(
        parentNavigatorKey: rootNavigatorKey,
        path: '${StartRoutes.termsPrefix}:type/:version',
        builder: (_, state) => ConsentTermScreen(
          type: state.pathParameters['type']!,
          version: state.pathParameters['version']!,
        ),
      ),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => _TabShell(shell: shell),
        branches: [
          StatefulShellBranch(
            routes: [GoRoute(path: '/', builder: (_, _) => const HomeScreen())],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/categories',
                builder: (_, _) => const CategoryScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(path: '/search', builder: (_, _) => const SearchScreen()),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(path: '/cart', builder: (_, _) => const CartScreen()),
            ],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: '/my', builder: (_, _) => const MyScreen())],
          ),
        ],
      ),
      GoRoute(
        parentNavigatorKey: rootNavigatorKey,
        path: '/checkout/delivery',
        builder: (_, _) => const DeliverySelectScreen(),
      ),
      GoRoute(
        parentNavigatorKey: rootNavigatorKey,
        path: '/checkout',
        builder: (_, _) => const OrderSheetScreen(),
      ),
      GoRoute(
        parentNavigatorKey: rootNavigatorKey,
        path: '/payments/:draftId',
        builder: (_, state) =>
            PaymentScreen(draftId: state.pathParameters['draftId']!),
      ),
      GoRoute(
        parentNavigatorKey: rootNavigatorKey,
        path: '/orders',
        builder: (_, _) => const OrderListScreen(),
        routes: [
          GoRoute(
            parentNavigatorKey: rootNavigatorKey,
            path: ':orderId',
            builder: (_, state) =>
                OrderDetailScreen(orderId: state.pathParameters['orderId']!),
            routes: [
              // 오배송 다시 배송비 결제(ADR-0065, order-orchestration 0.3.0).
              GoRoute(
                parentNavigatorKey: rootNavigatorKey,
                path: 'redelivery-payments/:redeliveryPaymentId',
                builder: (_, state) => RedeliveryPaymentScreen(
                  orderId: state.pathParameters['orderId']!,
                  redeliveryPaymentId:
                      state.pathParameters['redeliveryPaymentId']!,
                ),
              ),
              GoRoute(
                parentNavigatorKey: rootNavigatorKey,
                path: 'cancel',
                builder: (_, state) =>
                    CancelScreen(orderId: state.pathParameters['orderId']!),
              ),
              GoRoute(
                parentNavigatorKey: rootNavigatorKey,
                path: 'reschedule',
                builder: (_, state) =>
                    RescheduleScreen(orderId: state.pathParameters['orderId']!),
              ),
              // 리뷰 요청 알림(REVIEW_REQUESTED) → 그 주문의 리뷰 쓰기(하나면 바로, 여럿이면 고르기).
              GoRoute(
                parentNavigatorKey: rootNavigatorKey,
                path: 'review',
                builder: (_, state) => OrderReviewEntryScreen(
                  orderId: state.pathParameters['orderId']!,
                ),
              ),
              // 주문 문의하기 — "무엇을 도와드릴까요?"(레퍼런스 9-2 3-1): 배송 신고 종류 → 문의 남기기.
              GoRoute(
                parentNavigatorKey: rootNavigatorKey,
                path: 'help',
                builder: (_, state) =>
                    OrderHelpScreen(orderId: state.pathParameters['orderId']!),
              ),
              // 주문 단위 배송 현황 — 배송 ID 를 몰라도 지도부터 뜬다(BR-61).
              GoRoute(
                parentNavigatorKey: rootNavigatorKey,
                path: 'tracking',
                builder: (_, state) => OrderTrackingScreen(
                  orderId: state.pathParameters['orderId']!,
                ),
              ),
            ],
          ),
        ],
      ),
      GoRoute(
        parentNavigatorKey: rootNavigatorKey,
        path: '/deliveries/:deliveryId',
        // orderId 는 주문 상세에서 들어올 때만 붙는다(알림에서 열면 배송 정보만으로 그린다).
        builder: (_, state) => TrackingScreen(
          deliveryId: state.pathParameters['deliveryId']!,
          orderId: state.uri.queryParameters['orderId'],
        ),
      ),
      GoRoute(
        parentNavigatorKey: rootNavigatorKey,
        path: '/claims/:claimId',
        builder: (_, state) =>
            ClaimScreen(claimId: state.pathParameters['claimId']!),
      ),
      GoRoute(
        parentNavigatorKey: rootNavigatorKey,
        path: '/notifications',
        builder: (_, _) => const NotificationCenterScreen(),
        routes: [
          // 'settings' 를 ':notificationId' 보다 먼저 둔다.
          GoRoute(
            parentNavigatorKey: rootNavigatorKey,
            path: 'settings',
            builder: (_, _) => const NotificationSettingsScreen(),
          ),
          GoRoute(
            parentNavigatorKey: rootNavigatorKey,
            path: ':notificationId',
            builder: (_, state) => NotificationDetailScreen(
              notificationId: state.pathParameters['notificationId']!,
            ),
          ),
        ],
      ),
      GoRoute(
        parentNavigatorKey: rootNavigatorKey,
        path: '/login',
        builder: (_, state) => LoginScreen(
          purpose: state.uri.queryParameters['purpose'] == 'checkout'
              ? LoginPurpose.checkout
              : LoginPurpose.general,
        ),
      ),
      // 주문서 로그인 뒤 병합 확인(SCR-CART-MERGE-001). extra = 로그인 전 비회원 cartId.
      GoRoute(
        parentNavigatorKey: rootNavigatorKey,
        path: '/cart/merge',
        builder: (_, state) =>
            CartMergeScreen(guestCartId: state.extra! as String),
      ),
      GoRoute(
        parentNavigatorKey: rootNavigatorKey,
        // 휴대폰 번호 확인(OCTOMO, customer 0.9.0).
        path: '/me/phone-verification',
        builder: (_, _) => const PhoneVerificationScreen(),
      ),
      GoRoute(
        parentNavigatorKey: rootNavigatorKey,
        path: '/me/info',
        builder: (_, state) =>
            MyInfoScreen(signup: state.uri.queryParameters['from'] == 'signup'),
      ),
      // 로그인해 있는 고객의 재동의(CU-1 §3 — 주문 전 확인). 동의하면 true 로 돌아간다.
      GoRoute(
        parentNavigatorKey: rootNavigatorKey,
        path: '/me/consents/reconsent',
        builder: (_, _) => const ReconsentScreen(),
      ),
      GoRoute(
        parentNavigatorKey: rootNavigatorKey,
        path: '/addresses',
        builder: (_, _) => const AddressListScreen(),
        routes: [
          GoRoute(
            parentNavigatorKey: rootNavigatorKey,
            path: 'new',
            // 처음 실행 주소 화면은 고른 검색 결과를 넘긴다.
            builder: (_, state) => AddressFormScreen(
              initial: state.extra is PostcodeResult
                  ? state.extra! as PostcodeResult
                  : null,
            ),
          ),
        ],
      ),
      GoRoute(
        parentNavigatorKey: rootNavigatorKey,
        path: '/products',
        builder: (_, state) => ProductListScreen(
          categoryId: state.uri.queryParameters['categoryId'] ?? '',
          title: state.uri.queryParameters['title'],
        ),
      ),
      // 홈 영역 "전체보기". 영역·홈 구성 버전은 홈에서 넘긴다(없으면 홈으로).
      GoRoute(
        parentNavigatorKey: rootNavigatorKey,
        path: '/sections/:sectionId',
        redirect: (_, state) => state.extra is SectionRef ? null : '/',
        builder: (_, state) =>
            SectionItemsScreen(target: state.extra! as SectionRef),
      ),
      GoRoute(
        parentNavigatorKey: rootNavigatorKey,
        path: '/products/:productId',
        // 카드에서 오면 카드 값(이름·사진·가격)을 넘겨 상세 첫 프레임에 바로 그린다(백엔드 요청 2026-11-19 상세 속도 R1).
        builder: (_, state) => ProductDetailScreen(
          productId: state.pathParameters['productId']!,
          preview: switch (state.extra) {
            final ProductTile t => t,
            _ => null,
          },
        ),
        routes: [
          GoRoute(
            parentNavigatorKey: rootNavigatorKey,
            path: 'reviews',
            builder: (_, state) => ProductReviewsScreen(
              productId: state.pathParameters['productId']!,
            ),
          ),
        ],
      ),
      // 고객센터: 메인 → 문의 남기기·내 문의(case-service inquiries). 문의 남기기는 주문·AI 상담에서 값을 넘겨 받을 수 있다.
      GoRoute(
        parentNavigatorKey: rootNavigatorKey,
        path: '/support',
        builder: (_, _) => const SupportScreen(),
        routes: [
          GoRoute(
            parentNavigatorKey: rootNavigatorKey,
            path: 'chat',
            builder: (_, _) => const ChatScreen(),
          ),
          // 자주 묻는 질문(customer-assistant 0.2.0). 검색어·분류는 쿼리로.
          GoRoute(
            parentNavigatorKey: rootNavigatorKey,
            path: 'faqs',
            builder: (_, state) => FaqListScreen(
              q: state.uri.queryParameters['q'],
              category: state.uri.queryParameters['category'],
            ),
            routes: [
              GoRoute(
                parentNavigatorKey: rootNavigatorKey,
                path: ':faqId',
                builder: (_, state) => FaqDetailScreen(
                  faqId: state.pathParameters['faqId']!,
                  initial: state.extra is Faq ? state.extra! as Faq : null,
                ),
              ),
            ],
          ),
          GoRoute(
            parentNavigatorKey: rootNavigatorKey,
            path: 'inquiries',
            builder: (_, _) => const InquiryListScreen(),
            routes: [
              GoRoute(
                parentNavigatorKey: rootNavigatorKey,
                path: 'new',
                builder: (_, state) => InquiryFormScreen(
                  args: switch (state.extra) {
                    final InquiryFormArgs a => a,
                    _ => InquiryFormArgs(
                      orderId: state.uri.queryParameters['orderId'],
                    ),
                  },
                ),
              ),
              GoRoute(
                parentNavigatorKey: rootNavigatorKey,
                path: ':inquiryId',
                builder: (_, state) => InquiryDetailScreen(
                  inquiryId: state.pathParameters['inquiryId']!,
                ),
              ),
            ],
          ),
        ],
      ),
      // 리뷰 관리(리뷰 쓰기·내가 쓴 리뷰). 작성 화면은 대상(ReviewTarget)을 넘겨 받는다(없으면 리뷰 관리로).
      GoRoute(
        parentNavigatorKey: rootNavigatorKey,
        path: '/reviews',
        builder: (_, _) => const ReviewManageScreen(),
        routes: [
          GoRoute(
            parentNavigatorKey: rootNavigatorKey,
            path: 'write',
            redirect: (_, state) =>
                state.extra is ReviewTarget ? null : '/reviews',
            builder: (_, state) =>
                ReviewWriteScreen(target: state.extra! as ReviewTarget),
          ),
          // 내가 쓴 리뷰 하나(수정·삭제 버튼). 자격(상품명 사본)은 목록에서 넘겨 받는다(없어도 연다).
          GoRoute(
            parentNavigatorKey: rootNavigatorKey,
            path: 'mine/:reviewId',
            builder: (_, state) => MyReviewScreen(
              reviewId: state.pathParameters['reviewId']!,
              eligibility: state.extra is ReviewEligibility
                  ? state.extra! as ReviewEligibility
                  : null,
            ),
            routes: [
              GoRoute(
                parentNavigatorKey: rootNavigatorKey,
                path: 'edit',
                redirect: (_, state) => state.extra is ReviewEditTarget
                    ? null
                    : '/reviews/mine/${state.pathParameters['reviewId']}',
                builder: (_, state) =>
                    ReviewEditScreen(target: state.extra! as ReviewEditTarget),
              ),
            ],
          ),
        ],
      ),
    ],
  );
});

class _TabShell extends StatelessWidget {
  const _TabShell({required this.shell});

  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      body: shell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: shell.currentIndex,
        onDestinationSelected: (i) =>
            shell.goBranch(i, initialLocation: i == shell.currentIndex),
        destinations: [
          NavigationDestination(
            icon: const PmartLineIcon(PmartLineIcons.home),
            label: l10n.navHome,
          ),
          NavigationDestination(
            icon: const PmartLineIcon(PmartLineIcons.grid),
            label: l10n.navCategory,
          ),
          NavigationDestination(
            icon: const PmartLineIcon(PmartLineIcons.search),
            label: l10n.navSearch,
          ),
          NavigationDestination(
            icon: const PmartLineIcon(PmartLineIcons.cart),
            label: l10n.navCart,
          ),
          NavigationDestination(
            icon: const PmartLineIcon(PmartLineIcons.user),
            label: l10n.navMy,
          ),
        ],
      ),
    );
  }
}
