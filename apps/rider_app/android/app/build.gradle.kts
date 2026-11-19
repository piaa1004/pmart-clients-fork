import java.util.Base64

plugins {
    id("com.android.application")
    id("com.google.gms.google-services")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// flutter build/run 의 --dart-define(·from-file) 값(Base64 "KEY=VALUE" 를 쉼표로 이은 dart-defines 속성).
// 키·값 앞뒤 공백은 지운다(.secrets/rider.env 줄 앞 공백). 값은 빌드 로그에 찍지 않는다.
val dartDefines: Map<String, String> =
    (project.findProperty("dart-defines") as String?)
        ?.split(",")
        ?.mapNotNull { encoded ->
            runCatching { String(Base64.getDecoder().decode(encoded)) }.getOrNull()
        }
        ?.mapNotNull { pair ->
            val i = pair.indexOf('=')
            if (i > 0) pair.substring(0, i).trim() to pair.substring(i + 1).trim() else null
        }
        ?.toMap()
        ?: emptyMap()

android {
    namespace = "com.pmart.rider_app"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.pmart.rider_app"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        // 카카오내비 SDK(KNSDK) 가 API 26 이상을 요구한다.
        minSdk = maxOf(flutter.minSdkVersion, 26)
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        // 소셜 로그인 키는 빌드 때 `--dart-define-from-file=.secrets/rider.env` 로만 들어온다(저장소에 넣지 않음). 없으면 빈 값 — 빌드는 된다.
        // 카카오: 로그인 뒤 돌아오는 주소 kakao{네이티브 앱 키}://oauth.
        // 네이버(flutter_appauth): 로그인 뒤 돌아오는 주소 com.pmart.rider://oauth/naver — scheme 에 밑줄 못 씀(패키지명 그대로 안 씀).
        manifestPlaceholders["kakaoNativeAppKey"] = dartDefines["KAKAO_NATIVE_APP_KEY"] ?: ""
        manifestPlaceholders["appAuthRedirectScheme"] = "com.pmart.rider"
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
    // 카카오내비 SDK with UI — 앱 안 음성 길안내(KNNaviView). 사용 권한은 카카오모빌리티 승인 필요.
    implementation("com.kakaomobility.knsdk:knsdk_ui:1.12.8-hotfix05")
    // KNNaviView 가 쓰지만 SDK POM 에 없는 AndroidX(클래스 참조로 확인).
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.constraintlayout:constraintlayout:2.2.1")
    implementation("androidx.recyclerview:recyclerview:1.3.2")
    implementation("androidx.viewpager:viewpager:1.0.0")
    implementation("androidx.databinding:viewbinding:8.7.3")
}
