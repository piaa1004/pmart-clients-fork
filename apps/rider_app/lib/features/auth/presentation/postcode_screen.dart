import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../l10n/gen/app_localizations.dart';

/// 주소 검색에서 고른 실제 주소(도로명 또는 지번). 직접 친 글자는 받지 않는다.
@immutable
class PickedAddress {
  const PickedAddress({required this.roadAddress, required this.label});

  /// 서버에 보낼 도로명주소(지번을 골랐으면 자동 도로명).
  final String roadAddress;

  /// 라이더가 고른 표기(도로명 또는 지번).
  final String label;

  @override
  String toString() => 'PickedAddress(…)';
}

/// 다음(카카오) 우편번호 서비스 결과(JS `oncomplete` data). 도로명이 없으면 null.
PickedAddress? pickedFromJson(Map<String, Object?> data) {
  String? text(String key) => switch (data[key]) {
    final String v when v.trim().isNotEmpty => v.trim(),
    _ => null,
  };
  final road = text('roadAddress') ?? text('autoRoadAddress');
  if (road == null) return null;
  final jibun = text('jibunAddress') ?? text('autoJibunAddress');
  final label = data['userSelectedType'] == 'J' && jibun != null ? jibun : road;
  return PickedAddress(roadAddress: road, label: label);
}

/// 키 없이 쓰는 무료 웹 서비스(고객앱과 같다). 결과는 앱으로만 넘기고 로그에 남기지 않는다.
const _postcodeHtml = '''
<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>html,body,#wrap{margin:0;padding:0;width:100%;height:100%;}</style>
<script src="https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js"></script>
</head><body><div id="wrap"></div>
<script>
  // 2026 도메인·이름 변경: t1.daumcdn.net → t1.kakaocdn.net, daum.Postcode → kakao.Postcode.
  // 옛 주소를 쓰면 검색 창 위에 개발자용 변경 안내가 라이더에게 보인다.
  var Postcode = (window.kakao && kakao.Postcode) || daum.Postcode;
  new Postcode({
    oncomplete: function(data) {
      window.flutter_inappwebview.callHandler('onComplete', JSON.stringify(data));
    },
    // 라이더에게 서비스 공지·배너를 보이지 않는다.
    banner: false,
    width: '100%', height: '100%'
  }).embed(document.getElementById('wrap'));
</script>
</body></html>
''';

/// 주소 검색을 열고 고른 주소를 돌려준다(취소는 null). 시험은 이것을 바꾼다.
final addressSearchProvider =
    Provider<Future<PickedAddress?> Function(BuildContext context)>(
      (_) =>
          (context) => Navigator.of(context).push<PickedAddress>(
            MaterialPageRoute(builder: (_) => const PostcodeScreen()),
          ),
    );

/// 거주지 주소 검색.
class PostcodeScreen extends StatefulWidget {
  const PostcodeScreen({super.key});

  @override
  State<PostcodeScreen> createState() => _PostcodeScreenState();
}

class _PostcodeScreenState extends State<PostcodeScreen> {
  bool _failed = false;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.addressSearchTitle)),
      body: _failed
          ? Center(child: Text(l10n.addressSearchFailed))
          : InAppWebView(
              initialData: InAppWebViewInitialData(
                data: _postcodeHtml,
                baseUrl: WebUri('https://postcode.pmart.local/'),
              ),
              onWebViewCreated: (controller) => controller.addJavaScriptHandler(
                handlerName: 'onComplete',
                callback: (List<dynamic> args) {
                  final raw = args.isEmpty ? null : args.first;
                  if (raw is! String) return;
                  final decoded = jsonDecode(raw);
                  if (decoded is! Map<String, Object?>) return;
                  final result = pickedFromJson(decoded);
                  if (result != null && mounted) {
                    Navigator.of(context).pop(result);
                  }
                },
              ),
              onReceivedError: (_, request, _) {
                // 페이지 자체를 못 불러오면 안내한다(하위 리소스 실패는 무시).
                if ((request.isForMainFrame ?? false) && mounted) {
                  setState(() => _failed = true);
                }
              },
            ),
    );
  }
}
