// 계약(../pmart-backend/contracts/openapi) → Dart API 클라이언트 생성.
//
// 실행: 저장소 루트에서 `dart tools/gen_api.dart` (pub get 전에도 돌도록 dart:io 만 쓴다)
//   --only=cart,order   일부 서비스만
//   --no-build          build_runner 생략
//
// 결과: packages/pmart_api/gen/<service>/ (서비스마다 패키지 하나, .gitignore 대상)
//       contracts.lock (생성에 쓴 백엔드 커밋)
//
// 외부 클라이언트가 부르지 않는 경로(/internal, /webhooks, /actuator)는 생성 전에 걸러낸다.
import 'dart:convert';
import 'dart:io';

const generatorVersion = '7.26.0';
// Maven Central 의 openapi-generator-cli-7.26.0.jar.sha1
const generatorSha1 = 'b96b148fcf482808037f68fbad99cb4d7e65d40b';

const backendDir = '../pmart-backend';
const contractsDir = '$backendDir/contracts/openapi';
const cacheDir = 'tools/.cache';
const genDir = 'packages/pmart_api/gen';

/// 앱이 쓰는 서비스. 새 서비스가 필요하면 여기에 추가한다(사유는 worklog).
const services = <String, List<String>>{
  'auth-service': ['customer', 'rider', 'mfc'],
  // 직원 로그인(ADR-0056 6단계, 백엔드 handoff 2026-11-13 mfc-app-employee-login)
  'employee-auth-service': ['mfc'],
  'customer-service': ['customer'],
  'cart-service': ['customer'],
  'product-service': ['customer', 'mfc'],
  'product-content-service': ['customer'],
  'pricing-service': ['customer'],
  'search-service': ['customer'],
  'storefront-service': ['customer'],
  'delivery-serviceability-service': ['customer'],
  'delivery-capacity-service': ['customer'],
  'order-service': ['customer'],
  // 오배송 다시 배송비 결제(0.3.0 /redelivery-payments — 고객 경로 3개, /internal 은 빼고 생성). 백엔드 요청 2026-11-16
  'order-orchestration-service': ['customer'],
  'payment-service': ['customer'],
  'claim-service': ['customer'],
  'review-service': ['customer'],
  // 고객센터 문의(case 0.2.0 inquiries)·AI 상담(customer-assistant 0.1.0) — 백엔드 handoff 2026-11-09
  'case-service': ['customer', 'rider'],
  'customer-assistant-service': ['customer'],
  'notification-service': ['customer', 'rider'],
  'delivery-tracking-service': ['customer', 'rider', 'mfc'],
  'delivery-dispatch-service': ['rider'],
  'delivery-execution-service': ['rider'],
  'rider-service': ['rider'],
  // 라이더 Google 로그인·지점 목록(PC 5 rider-app, 2026-11-17 사용자 지시 — PC 1 알림 handoff rider-app/2026-11-17-pc1-gen-rider-auth-center-master.md)
  'rider-auth-service': ['rider'],
  'center-master-service': ['rider'],
  'mfc-fulfillment-service': ['mfc'],
  'mfc-capacity-service': ['mfc'],
  'mfc-inbound-service': ['mfc'],
  'mfc-quality-service': ['mfc'],
  'mfc-inventory-service': ['mfc'],
};

const excludedPathPrefixes = ['/internal', '/webhooks', '/actuator'];

Future<void> main(List<String> args) async {
  final only = args
      .where((a) => a.startsWith('--only='))
      .expand((a) => a.substring('--only='.length).split(','))
      .map((s) => s.endsWith('-service') ? s : '$s-service')
      .toSet();
  final build = !args.contains('--no-build');

  _ensureRoot();
  final sha = _git(['rev-parse', 'HEAD']);
  final dirty = _git(['status', '--porcelain', '--', 'contracts']).isNotEmpty;
  if (dirty) {
    stderr.writeln(
      '경고: 백엔드 contracts/ 에 커밋되지 않은 변경이 있다. 생성 결과가 커밋 $sha 와 다를 수 있다.',
    );
  }

  final jar = await _ensureGenerator();
  final targets = services.keys
      .where((s) => only.isEmpty || only.contains(s))
      .toList();
  if (targets.isEmpty) _fail('대상 서비스가 없다: $only');

  final specsDir = Directory('$cacheDir/specs')..createSync(recursive: true);
  File('$contractsDir/_common.yaml').copySync('${specsDir.path}/_common.yaml');

  for (final service in targets) {
    stdout.writeln('== $service');
    final source = File('$contractsDir/$service.yaml');
    if (!source.existsSync()) _fail('계약 파일 없음: ${source.path}');
    final filtered = stripPaths(
      source.readAsStringSync(),
      excludedPathPrefixes,
    );
    final spec = File('${specsDir.path}/$service.yaml')
      ..writeAsStringSync(filtered);

    final pkgName = packageName(service);
    final out = Directory('$genDir/${shortName(service)}');
    if (out.existsSync()) out.deleteSync(recursive: true);

    _run('java', [
      '-jar',
      jar.path,
      'generate',
      '-g',
      'dart-dio',
      '-i',
      spec.path,
      '-o',
      out.path,
      '--additional-properties=pubName=$pkgName,serializationLibrary=json_serializable,pubDescription=Generated from pmart-backend $service ($sha)',
      '--global-property=apiTests=false,modelTests=false,apiDocs=false,modelDocs=false',
      // format: date(Asia/Seoul 날짜)는 문자열 YYYY-MM-DD 로 둔다. DateTime 으로 두면 본문은
      // 2026-10-24T00:00:00.000, 쿼리는 2026-10-24 00:00:00.000 으로 나가서 계약과 다르다.
      '--type-mappings=date=String',
    ]);
    _patchGeneratedPackage(out, pkgName);
    _fixEnumDefaults(out);
  }

  // contracts.lock 은 Dart("dart")·웹("web", tools/web-tools/gen-api.mjs) 생성이 함께 쓴다.
  final lockFile = File('contracts.lock');
  final lock = lockFile.existsSync()
      ? (jsonDecode(lockFile.readAsStringSync()) as Map<String, dynamic>)
      : <String, dynamic>{};
  lock['dart'] = {
    'backendCommit': sha,
    'backendContractsDirty': dirty,
    'generatedAt': DateTime.now().toUtc().toIso8601String(),
    'generator':
        'openapi-generator-cli $generatorVersion (dart-dio, json_serializable)',
    // --only 로 일부만 다시 만들었으면 나머지는 이전 커밋 기준일 수 있다.
    'regenerated': targets,
    'services': {for (final s in services.keys) s: services[s]},
  };
  lockFile.writeAsStringSync(
    '${const JsonEncoder.withIndent('  ').convert(lock)}\n',
  );
  stdout.writeln('contracts.lock(dart) 갱신: $sha');

  if (!build) return;
  _run(_flutter, ['pub', 'get']);
  for (final service in targets) {
    final dir = '$genDir/${shortName(service)}';
    stdout.writeln('== build_runner $dir');
    _run('dart', [
      'run',
      'build_runner',
      'build',
      '--delete-conflicting-outputs',
    ], cwd: dir);
  }
}

/// `paths:` 아래에서 [prefixes] 로 시작하는 경로 블록을 지운다.
///
/// 계약은 경로를 2칸 들여쓰기(`  /path:`)로 쓴다는 형식에 기댄다. 형식이 다르면 실패시킨다.
String stripPaths(String yaml, List<String> prefixes) {
  final lines = const LineSplitter().convert(yaml);
  final out = <String>[];
  var inPaths = false;
  var skipping = false;
  var sawPathsKey = false;
  for (final line in lines) {
    if (RegExp(r'^\S').hasMatch(line)) {
      inPaths = line.startsWith('paths:');
      sawPathsKey |= inPaths;
      skipping = false;
    } else if (inPaths && RegExp(r'^  [^\s#]').hasMatch(line)) {
      final key = line.trim();
      if (!key.startsWith('/')) _fail('paths 아래에 예상하지 못한 줄: $line');
      skipping = prefixes.any(key.startsWith);
    }
    if (!skipping) out.add(line);
  }
  if (!sawPathsKey) _fail('paths: 가 없다');
  return '${out.join('\n')}\n';
}

String packageName(String service) =>
    'pmart_api_${shortName(service).replaceAll('-', '_')}';

/// `delivery-serviceability-service` → `delivery-serviceability` (끝의 -service 만 뗀다).
String shortName(String service) => service.endsWith('-service')
    ? service.substring(0, service.length - '-service'.length)
    : service;

void _patchGeneratedPackage(Directory out, String pkgName) {
  // 워크스페이스 멤버로 만들고 SDK 를 루트와 맞춘다.
  final pubspec = File('${out.path}/pubspec.yaml');
  final original = pubspec.readAsStringSync();
  final deps = RegExp(
    r'^dependencies:[\s\S]*',
    multiLine: true,
  ).firstMatch(original)?.group(0);
  if (deps == null) _fail('생성된 pubspec 형식이 예상과 다르다: ${pubspec.path}');
  pubspec.writeAsStringSync(
    [
      '# 생성물. 직접 고치지 않는다(tools/gen_api.dart).',
      'name: $pkgName',
      'publish_to: none',
      'version: 0.0.0',
      'resolution: workspace',
      '',
      'environment:',
      '  sdk: ^3.13.4',
      '',
      deps.replaceAll(RegExp(r"^  test: .*\n?", multiLine: true), ''),
    ].join('\n'),
  );
  for (final name in [
    'test',
    'doc',
    '.travis.yml',
    'git_push.sh',
    'README.md',
  ]) {
    final entity = FileSystemEntity.typeSync('${out.path}/$name');
    if (entity == FileSystemEntityType.directory) {
      Directory('${out.path}/$name').deleteSync(recursive: true);
    } else if (entity == FileSystemEntityType.file) {
      File('${out.path}/$name').deleteSync();
    }
  }
  // lint 규칙 없이 컴파일 오류·경고만 본다(생성물 스타일은 고치지 않는다).
  File('${out.path}/analysis_options.yaml')
      .writeAsStringSync('# 생성물: lint 없음\n');
}

/// openapi-generator 7.26.0 dart-dio(json_serializable) 버그 보정:
/// 인라인 enum 필드에 default 가 있으면 `const XEnum._('V')` 와 문자열 defaultValue 를 만들어
/// 컴파일되지 않는다. 같은 값의 enum 상수로 바꾼다.
void _fixEnumDefaults(Directory out) {
  final models = Directory('${out.path}/lib/src/model');
  if (!models.existsSync()) return;
  for (final file in models.listSync().whereType<File>()) {
    if (!file.path.endsWith('.dart')) continue;
    final src = file.readAsStringSync();
    var fixed = src.replaceAllMapped(
      RegExp(r"const (\w+Enum)\._\('(\w+)'\)"),
      (m) => '${m[1]}.${m[2]}',
    );
    fixed = fixed.replaceAllMapped(
      RegExp(
        r"defaultValue: '(\w+)',(\s+name: r'\w+',[^)]*\)\s+final (\w+Enum)\? )",
      ),
      (m) => 'defaultValue: ${m[3]}.${m[1]},${m[2]}',
    );
    if (fixed != src) {
      file.writeAsStringSync(fixed);
      stdout.writeln('  enum default 보정: ${file.uri.pathSegments.last}');
    }
  }
}

Future<File> _ensureGenerator() async {
  final jar = File('$cacheDir/openapi-generator-cli-$generatorVersion.jar');
  if (!jar.existsSync() || _sha1(jar) != generatorSha1) {
    jar.parent.createSync(recursive: true);
    final url =
        'https://repo1.maven.org/maven2/org/openapitools/openapi-generator-cli/$generatorVersion/openapi-generator-cli-$generatorVersion.jar';
    stdout.writeln('생성기 내려받기: $url');
    final client = HttpClient();
    try {
      final response = await (await client.getUrl(Uri.parse(url))).close();
      if (response.statusCode != 200) _fail('내려받기 실패: ${response.statusCode}');
      await response.pipe(jar.openWrite());
    } finally {
      client.close();
    }
    if (_sha1(jar) != generatorSha1) {
      jar.deleteSync();
      _fail('생성기 jar 체크섬이 맞지 않는다');
    }
  }
  return jar;
}

String _sha1(File f) {
  // dart:io 에는 해시가 없어서 OS 도구를 쓴다(Git Bash 의 sha1sum, 없으면 Windows certutil).
  for (final cmd in [
    ['sha1sum', f.path],
    ['certutil', '-hashfile', f.path, 'SHA1'],
  ]) {
    try {
      final p = Process.runSync(cmd.first, cmd.sublist(1));
      if (p.exitCode != 0) continue;
      final m = RegExp(r'\b[0-9a-fA-F]{40}\b').firstMatch(p.stdout as String);
      if (m != null) return m.group(0)!.toLowerCase();
    } on ProcessException {
      continue;
    }
  }
  _fail('SHA-1 도구(sha1sum 또는 certutil)를 찾지 못했다');
}

String get _flutter => Platform.isWindows ? 'flutter.bat' : 'flutter';

void _ensureRoot() {
  if (!File('pubspec.yaml').existsSync() || !Directory('tools').existsSync()) {
    _fail('저장소 루트에서 실행한다: dart tools/gen_api.dart');
  }
  if (!Directory(contractsDir).existsSync()) _fail('계약 디렉터리 없음: $contractsDir');
}

String _git(List<String> args) {
  final r = Process.runSync('git', ['-C', backendDir, ...args]);
  if (r.exitCode != 0) _fail('git ${args.join(' ')} 실패: ${r.stderr}');
  return (r.stdout as String).trim();
}

void _run(String exe, List<String> args, {String? cwd}) {
  final r = Process.runSync(
    exe,
    args,
    workingDirectory: cwd,
    runInShell: Platform.isWindows,
  );
  if (r.exitCode != 0) {
    stderr
      ..writeln(r.stdout)
      ..writeln(r.stderr);
    _fail('$exe ${args.take(3).join(' ')} … 실패(${r.exitCode})');
  }
}

Never _fail(String message) {
  stderr.writeln('gen_api: $message');
  exit(1);
}
