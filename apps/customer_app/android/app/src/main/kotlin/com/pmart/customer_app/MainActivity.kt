package com.pmart.customer_app

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

// 네이버 로그인 SDK 가 FragmentActivity 를 요구한다(flutter_naver_login 2.1).
class MainActivity : FlutterFragmentActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // 휴대폰 번호 확인(OCTOMO): 문자 앱을 받는 번호·본문을 채워 연다. 보내기는 고객이 누른다.
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "pmart/sms")
            .setMethodCallHandler { call, result ->
                if (call.method != "compose") {
                    result.notImplemented()
                    return@setMethodCallHandler
                }
                val to = call.argument<String>("to") ?: ""
                val body = call.argument<String>("body") ?: ""
                val intent = Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:$to"))
                    .putExtra("sms_body", body)
                try {
                    startActivity(intent)
                    result.success(true)
                } catch (e: ActivityNotFoundException) {
                    result.success(false)
                }
            }
    }
}
