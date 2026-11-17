package com.pmart.rider_app

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * - `pmart.rider/notifications`: 위치 전송 상시 알림을 보이려면 Android 13+ 에서 알림 권한이 필요하다.
 * - `pmart.rider/knnavi`: 카카오내비 SDK 앱 안 음성 길안내([KnNaviActivity]).
 *   `probe`(appKey) → SDK 인증만 확인, `start`(appKey, goal…, start…) → 길안내 화면.
 *   결과: null = 성공, 문자열 = KNError 코드(예: C103 인증 실패).
 */
class MainActivity : FlutterActivity() {
    private var pending: MethodChannel.Result? = null
    private var pendingNavi: MethodChannel.Result? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        createPushChannels()
    }

    /**
     * 서버 푸시가 쓰는 알림 채널(notification-service `android.notification.channel_id`, 백엔드 회신 2026-11-17).
     * ID 는 서버가 정했다 — 이름·중요도는 앱이 정한다. 배차 제안만 높음(소리·진동·화면 위 표시).
     */
    private fun createPushChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        val channels = listOf(
            NotificationChannel("dispatch_offer", getString(R.string.push_channel_dispatch_offer), NotificationManager.IMPORTANCE_HIGH).apply {
                description = getString(R.string.push_channel_dispatch_offer_desc)
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 400, 200, 400)
            },
            NotificationChannel("support", getString(R.string.push_channel_support), NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = getString(R.string.push_channel_support_desc)
            },
            NotificationChannel("account", getString(R.string.push_channel_account), NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = getString(R.string.push_channel_account_desc)
            },
            NotificationChannel("settlement", getString(R.string.push_channel_settlement), NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = getString(R.string.push_channel_settlement_desc)
            },
        )
        manager.createNotificationChannels(channels)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)
            .setMethodCallHandler { call, result ->
                if (call.method != "request") {
                    result.notImplemented()
                    return@setMethodCallHandler
                }
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                    checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                    PackageManager.PERMISSION_GRANTED
                ) {
                    result.success(true)
                    return@setMethodCallHandler
                }
                pending?.success(false)
                pending = result
                requestPermissions(
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_CODE
                )
            }
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, NAVI_CHANNEL)
            .setMethodCallHandler { call, result ->
                val appKey = call.argument<String>("appKey")
                val intent = Intent(this, KnNaviActivity::class.java)
                    .putExtra(KnNaviActivity.EXTRA_APP_KEY, appKey)
                when (call.method) {
                    "probe" -> intent.putExtra(KnNaviActivity.EXTRA_PROBE, true)
                    "start" -> {
                        intent.putExtra(KnNaviActivity.EXTRA_GOAL_NAME, call.argument<String>("goalName"))
                        for (k in listOf("goalLat", "goalLng", "startLat", "startLng")) {
                            call.argument<Double>(k)?.let { intent.putExtra(k, it) }
                        }
                    }
                    else -> {
                        result.notImplemented()
                        return@setMethodCallHandler
                    }
                }
                // 이전 요청이 남아 있으면 끝난 것으로 본다(두 번 응답하지 않게).
                pendingNavi?.success("SUPERSEDED")
                pendingNavi = result
                startActivityForResult(intent, NAVI_REQUEST_CODE)
            }
    }

    @Deprecated("FlutterActivity 는 Activity Result API 대신 이것을 쓴다")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != NAVI_REQUEST_CODE) return
        val error = data?.getStringExtra(KnNaviActivity.RESULT_ERROR)
        pendingNavi?.success(
            when {
                error != null -> error
                resultCode == Activity.RESULT_OK -> null
                else -> "CANCELLED"
            }
        )
        pendingNavi = null
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQUEST_CODE) return
        pending?.success(
            grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED
        )
        pending = null
    }

    private companion object {
        const val CHANNEL = "pmart.rider/notifications"
        const val NAVI_CHANNEL = "pmart.rider/knnavi"
        const val REQUEST_CODE = 7301
        const val NAVI_REQUEST_CODE = 7302
    }
}
