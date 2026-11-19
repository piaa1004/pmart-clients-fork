import 'package:flutter/material.dart';

import 'rider_style.dart';

/// 화면 아래 큰 버튼(레퍼런스: 폭 가득, 높이 56, 모서리 4).
class RiderButton extends StatelessWidget {
  const RiderButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.height = 56,
    this.color = RiderColors.primary,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final double height;

  /// 바탕색 — 기본은 주 색. 같은 모양의 보조 버튼(예: 배달리스트 "취소")은 회색.
  final Color color;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: double.infinity,
    height: height,
    child: FilledButton(
      onPressed: onPressed,
      style: FilledButton.styleFrom(
        backgroundColor: color,
        disabledBackgroundColor: RiderColors.disabled,
        disabledForegroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          if (icon != null) ...[Icon(icon, size: 24), const SizedBox(width: 8)],
          Flexible(
            child: Text(
              label,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    ),
  );
}

/// 테두리 버튼(도움요청·길찾기, '여기에 두었어요' 알리기).
class RiderOutlineButton extends StatelessWidget {
  const RiderOutlineButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.accent = false,
    this.height = 48,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;

  /// 주 색 테두리·글자(촬영 버튼).
  final bool accent;
  final double height;

  @override
  Widget build(BuildContext context) {
    final color = accent ? RiderColors.primary : RiderColors.ink;
    return SizedBox(
      height: height,
      child: OutlinedButton(
        onPressed: onPressed,
        style: OutlinedButton.styleFrom(
          foregroundColor: color,
          side: BorderSide(
            color: accent ? RiderColors.primary : RiderColors.line,
          ),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
          padding: const EdgeInsets.symmetric(horizontal: 12),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (icon != null) ...[
              Icon(icon, size: 20),
              const SizedBox(width: 6),
            ],
            Flexible(
              child: Text(
                label,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 가입 단계 표시(① ② ③ ④).
class StepDots extends StatelessWidget {
  const StepDots({super.key, required this.current, this.total = 4});

  final int current;
  final int total;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      for (var i = 1; i <= total; i++)
        Container(
          width: 18,
          height: 18,
          margin: const EdgeInsets.only(right: 4),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: i == current ? RiderColors.primary : Colors.white,
            border: Border.all(
              color: i == current ? RiderColors.primary : RiderColors.disabled,
            ),
          ),
          child: Text(
            '$i',
            style: TextStyle(
              fontSize: 11,
              height: 1,
              color: i == current ? Colors.white : RiderColors.hint,
            ),
          ),
        ),
    ],
  );
}

/// 구획 사이 회색 띠.
class SectionGap extends StatelessWidget {
  const SectionGap({super.key});

  @override
  Widget build(BuildContext context) =>
      Container(height: 8, color: RiderColors.gap);
}

/// 머리띠 제목 글자(테마 글꼴을 물려받는다).
TextStyle riderTitleStyle(
  BuildContext context, {
  Color color = RiderColors.ink,
}) =>
    Theme.of(context).textTheme.titleLarge!
        .copyWith(color: color, fontSize: 18, fontWeight: FontWeight.w700);

/// 어두운 머리띠.
PreferredSizeWidget riderDarkBar(
  BuildContext context, {
  required String title,
  List<Widget> actions = const [],
  bool centerTitle = false,
}) => AppBar(
  backgroundColor: RiderColors.header,
  foregroundColor: Colors.white,
  centerTitle: centerTitle,
  title: Text(title),
  titleTextStyle: riderTitleStyle(context, color: Colors.white),
  actions: actions,
);

/// 둥근 선택 버튼(선택되면 주 색 테두리 + 체크). 지역 선택·사유 선택에 쓴다.
class PillOption extends StatelessWidget {
  const PillOption({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
    this.showCheck = false,
    this.height = 44,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;
  final bool showCheck;
  final double height;

  @override
  Widget build(BuildContext context) => Material(
    color: Colors.white,
    shape: StadiumBorder(
      side: BorderSide(
        color: selected ? RiderColors.primary : RiderColors.line,
        width: selected ? 1.5 : 1,
      ),
    ),
    child: InkWell(
      customBorder: const StadiumBorder(),
      onTap: onTap,
      child: SizedBox(
        height: height,
        child: Stack(
          alignment: Alignment.center,
          children: [
            Padding(
              padding: EdgeInsets.symmetric(horizontal: showCheck ? 40 : 12),
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w400,
                  color: selected ? RiderColors.primary : RiderColors.ink,
                ),
              ),
            ),
            if (showCheck && selected)
              const Positioned(
                right: 16,
                child: Icon(Icons.check, color: RiderColors.primary, size: 22),
              ),
          ],
        ),
      ),
    ),
  );
}

/// 지도 위 흰 알약 버튼.
class MapPill extends StatelessWidget {
  const MapPill({super.key, required this.child, this.onTap});

  final Widget child;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: Colors.white,
    elevation: 3,
    shadowColor: Colors.black38,
    shape: const StadiumBorder(),
    child: InkWell(
      customBorder: const StadiumBorder(),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: child,
      ),
    ),
  );
}

/// 지도 위 둥근 버튼.
class MapCircleButton extends StatelessWidget {
  const MapCircleButton({super.key, required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: Colors.white,
    elevation: 3,
    shadowColor: Colors.black38,
    shape: const CircleBorder(),
    child: InkWell(
      customBorder: const CircleBorder(),
      onTap: onTap,
      child: SizedBox(
        width: 44,
        height: 44,
        child: Icon(icon, color: RiderColors.ink, size: 24),
      ),
    ),
  );
}

/// 짧은 알림. [aboveActions] 면 화면 아래 큰 버튼(반납·전달 완료 등)을 가리지 않게 그 위에 띄운다
/// (사용자 2026-11-18 — 틀린 인증번호 알림이 "MFC에 반납했어요" 버튼을 몇 초 가렸다).
void showRiderToast(
  BuildContext context,
  String text, {
  bool aboveActions = false,
}) {
  // 키보드가 떠 있으면 입력칸을 가리지 않게 화면 위쪽에 띄운다(사용자 2026-11-19 "입력창을 가려").
  // 화면(Scaffold) 안 MediaQuery 는 키보드 높이를 지우므로 창(View) 값을 직접 본다.
  final view = View.of(context);
  final dpr = view.devicePixelRatio;
  final keyboardHeight = view.viewInsets.bottom / dpr;
  final keyboard = keyboardHeight > 0;
  // 안내는 키보드 위 영역에 놓이므로, 그 영역 맨 위까지 올린다.
  final topRoom =
      view.physicalSize.height / dpr -
      keyboardHeight -
      view.padding.top / dpr -
      riderToastHeight;
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      keyboard || aboveActions
          ? SnackBar(
              content: Text(text),
              behavior: SnackBarBehavior.floating,
              margin: EdgeInsets.fromLTRB(
                16,
                0,
                16,
                keyboard ? (topRoom > 0 ? topRoom : 0) : 150,
              ),
              duration: riderToastDuration,
            )
          : SnackBar(content: Text(text), duration: riderToastDuration),
    );
}

/// 안내(회색 팝업)가 떠 있는 시간 — 기본 4초는 길어 입력·버튼을 가린다(사용자 2026-11-19 "조금 길어").
const riderToastDuration = Duration(seconds: 2);

/// 키보드가 떠 있을 때 화면 위쪽에 띄우려고 비워 두는 높이(안내 한두 줄).
const riderToastHeight = 80.0;

/// 메뉴 한 줄(마이페이지·환경설정).
class MenuRow extends StatelessWidget {
  const MenuRow({
    super.key,
    required this.label,
    this.icon,
    this.value,
    this.trailing,
    this.onTap,
  });

  final String label;
  final IconData? icon;
  final String? value;
  final Widget? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
      child: Row(
        children: [
          if (icon != null) ...[
            Icon(icon, size: 22, color: RiderColors.ink),
            const SizedBox(width: 10),
          ],
          Expanded(
            child: Text(
              label,
              style: const TextStyle(fontSize: 17, color: RiderColors.ink),
            ),
          ),
          if (value != null)
            Text(
              value!,
              style: const TextStyle(fontSize: 14, color: RiderColors.sub),
            ),
          trailing ??
              (onTap == null
                  ? const SizedBox.shrink()
                  : const Padding(
                      padding: EdgeInsets.only(left: 6),
                      child: Icon(
                        Icons.chevron_right,
                        color: RiderColors.sub,
                        size: 22,
                      ),
                    )),
        ],
      ),
    ),
  );
}
