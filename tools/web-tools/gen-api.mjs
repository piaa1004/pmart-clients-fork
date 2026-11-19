// 계약(../pmart-backend/contracts/openapi) → web/backoffice TS 타입(openapi-typescript).
//
// 실행: npm run gen:api -w web/backoffice  (또는 tools/web-tools 에서 npm run gen:api)
// 결과: web/backoffice/src/api/generated/<service>.ts (.gitignore 대상), contracts.lock 의 "web" 항목.
//       다른 웹 패키지가 쓰는 계약(copies)은 그 패키지의 generated/ 에도 같은 파일을 둔다.
//
// Dart 생성(tools/gen_api.dart)과 같은 규칙으로 /internal, /webhooks, /actuator 경로를 걸러낸다.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const backend = resolve(repo, '../pmart-backend');
const contracts = join(backend, 'contracts/openapi');
const cache = join(here, '.cache/specs');
const out = join(repo, 'web/backoffice/src/api/generated');
/** 다른 웹 패키지가 쓰는 계약만 그 패키지의 generated/ 에 복사한다(@pmart/web-core = 직원 로그인, 인사팀 백오피스 = hr·센터 목록). */
const copies = [
  { label: 'web/core', dir: join(repo, 'web/core/src/generated'), services: ['employee-auth'] },
  { label: 'web/hr-backoffice', dir: join(repo, 'web/hr-backoffice/src/api/generated'), services: ['hr', 'center-master'] },
  {
    label: 'web/mfc-backoffice',
    dir: join(repo, 'web/mfc-backoffice/src/api/generated'),
    // backoffice-bff·case: 우리 센터 배송 현황·배차 실패 사건(2026-11-16, bff 0.3.1·case 0.5.2)
    // approval: 본사 승인 번호 흐름(AP-1 — 422 APPROVAL_REQUIRED 뒤 change-requests·submissions, PC 3 요청 2026-11-17)
    // hr: 직원 본인 조회 `GET /hr/employees/me`(MFC 백오피스 "내 정보" — #149, 2026-11-18)·운영자 이름 `employee-labels`(0.8.0)
    // delivery-execution: 반납 인증번호 `GET /return-handovers?mfcId=`·새로 내기(0.28.0 — PC 3, 2026-11-19)
    // delivery-dispatch: 배차 지연 목록 `GET /dispatch-delays?mfcId=`(0.12.0 — PC 3, 2026-11-19)
    services: ['approval', 'backoffice-bff', 'case', 'center-master', 'delivery-dispatch', 'delivery-execution', 'hr', 'mfc-capacity', 'mfc-fulfillment', 'mfc-inbound', 'mfc-inventory', 'mfc-location', 'mfc-quality'],
  },
];
const excluded = ['/internal', '/webhooks', '/actuator'];

// 백오피스가 직접 부르지 않는 플랫폼 계약.
const skip = new Set(['_common.yaml', 'redocly.yaml', 'api-gateway.yaml']);

/** `paths:` 아래에서 제외 접두어로 시작하는 경로 블록을 지운다(tools/gen_api.dart stripPaths 와 같은 규칙). */
export function stripPaths(yaml, prefixes) {
  const lines = yaml.split(/\r?\n/);
  const kept = [];
  let inPaths = false;
  let skipping = false;
  let sawPaths = false;
  for (const line of lines) {
    if (/^\S/.test(line)) {
      inPaths = line.startsWith('paths:');
      sawPaths ||= inPaths;
      skipping = false;
    } else if (inPaths && /^ {2}[^\s#]/.test(line)) {
      const key = line.trim();
      if (!key.startsWith('/')) throw new Error(`paths 아래에 예상하지 못한 줄: ${line}`);
      skipping = prefixes.some((p) => key.startsWith(p));
    }
    if (!skipping) kept.push(line);
  }
  if (!sawPaths) throw new Error('paths: 가 없다');
  return `${kept.join('\n')}\n`;
}

function git(args) {
  return execFileSync('git', ['-C', backend, ...args], { encoding: 'utf8' }).trim();
}

async function main() {
  if (!existsSync(contracts)) throw new Error(`계약 디렉터리 없음: ${contracts}`);
  const sha = git(['rev-parse', 'HEAD']);
  const dirty = git(['status', '--porcelain', '--', 'contracts']).length > 0;
  if (dirty) console.warn(`경고: 백엔드 contracts/ 에 커밋되지 않은 변경이 있다(${sha}).`);

  mkdirSync(cache, { recursive: true });
  copyFileSync(join(contracts, '_common.yaml'), join(cache, '_common.yaml'));
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const services = readdirSync(contracts)
    .filter((f) => f.endsWith('.yaml') && !skip.has(f))
    .sort();
  for (const file of services) {
    const spec = join(cache, file);
    writeFileSync(spec, stripPaths(readFileSync(join(contracts, file), 'utf8'), excluded));
    const ast = await openapiTS(pathToFileURL(spec), { alphabetize: true });
    const name = file.replace(/-service\.yaml$|\.yaml$/, '');
    writeFileSync(
      join(out, `${name}.ts`),
      `// 생성물. 직접 고치지 않는다(tools/web-tools/gen-api.mjs, pmart-backend ${sha}).\n${astToString(ast)}`,
    );
    console.log(`== ${name}`);
  }

  for (const { label, dir, services: names } of copies) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const name of names) copyFileSync(join(out, `${name}.ts`), join(dir, `${name}.ts`));
    console.log(`${label}: ${names.join(', ')}`);
  }

  const lockPath = join(repo, 'contracts.lock');
  const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : {};
  lock.web = {
    backendCommit: sha,
    backendContractsDirty: dirty,
    generatedAt: new Date().toISOString(),
    generator: 'openapi-typescript 7.13.0 (TS 5.9)',
    services: services.map((f) => f.replace(/\.yaml$/, '')),
  };
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`contracts.lock(web) 갱신: ${sha}`);
}

await main();
