import java.util.Base64

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// flutter build/run 의 --dart-define(·from-file) 값(Base64 "KEY=VALUE" 를 쉼표로 이은 dart-defines 속성).
val dartDefines: Map<String, String> =
    (project.findProperty("dart-defines") as String?)
        ?.split(",")
        ?.mapNotNull { encoded ->
            runCatching { String(Base64.getDecoder().decode(encoded)) }.getOrNull()
        }
        ?.mapNotNull { pair ->
            val i = pair.indexOf('=')
            if (i > 0) pair.substring(0, i) to pair.substring(i + 1) else null
        }
        ?.toMap()
        ?: emptyMap()

android {
    namespace = "com.pmart.customer_app"
    // flutter_local_notifications 23 이 컴파일 SDK 37 이상을 요구한다(targetSdk·minSdk 는 Flutter 기본 그대로).
    compileSdk = 37
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // flutter_local_notifications 가 요구한다(java.time 등을 낮은 Android 에서도).
        isCoreLibraryDesugaringEnabled = true
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.pmart.customer_app"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        // 소셜 로그인 키는 빌드 때 `--dart-define-from-file=.secrets/customer.env` 로만 들어온다(저장소에 넣지 않음).
        // 카카오: 로그인 뒤 돌아오는 주소 kakao{앱 키}://oauth.
        manifestPlaceholders["kakaoNativeAppKey"] = dartDefines["KAKAO_NATIVE_APP_KEY"] ?: ""
        // 네이버 OIDC(flutter_appauth): 로그인 뒤 돌아오는 주소 com.pmart.customer://oauth/naver 의 scheme.
        // scheme 에 밑줄을 못 써 패키지명과 다르다. 코드의 naverRedirectUrl 과 같아야 한다.
        manifestPlaceholders["appAuthRedirectScheme"] = "com.pmart.customer"
    }

    buildTypes {
        release {
            // TODO: Add your own signing config for the release build.
            // Signing with the debug keys for now, so `flutter run --release` works.
            signingConfig = signingConfigs.getByName("debug")
            // 카카오 지도 SDK 를 R8 축소·난독화에서 뺀다.
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

dependencies {
    // flutter_local_notifications(핵심 라이브러리 desugaring).
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}

// 휴대폰 푸시(FCM). google-services.json 은 git 제외(.gitignore)라 그 파일이 없는 PC 에서도 빌드되게
// 파일이 있을 때만 플러그인을 건다. 없이 빌드한 앱은 Firebase 초기화가 실패하고 푸시 없이 돈다.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}
