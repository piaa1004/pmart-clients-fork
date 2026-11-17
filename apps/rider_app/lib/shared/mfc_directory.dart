import 'package:flutter/foundation.dart';

import 'location.dart';

/// PMart 배달 권역(사용자 안내 2026-11-16 — 26개 MFC). 2026-11-17 사용자 요청으로 4개 권역(충청·강원·전라·경상).
enum MfcRegion { chungcheong, gangwon, jeolla, gyeongsang }

/// MFC 지점(픽업지). 목 데이터 — 실제 센터 코드·전화·좌표는 center-master 정본을 받아야 한다
/// (`docs/handoff/rider-app/2026-11-16-backend-trip-info-and-signup.md`).
@immutable
class MfcBranch {
  const MfcBranch({
    required this.id,
    required this.name,
    required this.region,
    required this.address,
    this.phone,
    required this.lat,
    required this.lng,
  });

  /// 목 센터 코드(CenterId 형식을 흉내 냄).
  final String id;
  final String name;
  final MfcRegion region;
  final String address;

  /// 가게 전화. 목 지점은 가짜 번호, 서버 지점은 아직 없다(center-master 에 칸 없음 — null).
  final String? phone;

  /// 주소를 카카오 주소 검색으로 찾은 좌표(2026-11-17). 정본은 center-master.
  final double lat;
  final double lng;

  GeoPoint get point => (lat: lat, lng: lng);
}

MfcBranch _b(
  String id,
  String name,
  MfcRegion region,
  String address,
  int n,
  double lat,
  double lng,
) => MfcBranch(
  id: id,
  name: name,
  region: region,
  address: address,
  phone: '0000000${n.toString().padLeft(3, '0')}',
  lat: lat,
  lng: lng,
);

const _cc = MfcRegion.chungcheong;
const _gw = MfcRegion.gangwon;
const _jl = MfcRegion.jeolla;
const _gs = MfcRegion.gyeongsang;

/// 26개 지점(사용자가 준 이름·주소). 충청 7 · 강원 2 · 전라 4 · 경상 13. 좌표는 카카오 로컬 API 주소 검색 결과(2026-11-17,
/// 천안은 지번 "63-6 외"라 두정동 63-6 단지 정문 좌표).
final List<MfcBranch> mfcBranches = [
  _b(
    'MFC-CCN-01',
    '춘천지점',
    _gw,
    '강원도 춘천시 효자동 750, 지상 4층',
    1,
    37.878299,
    127.740073,
  ),
  _b(
    'MFC-DJY-01',
    '대전유성지점',
    _cc,
    '대전시 유성구 죽동로 297번길 55, 아주존타워 2층',
    2,
    36.369578,
    127.338956,
  ),
  _b(
    'MFC-DJJ-01',
    '대전중구지점',
    _cc,
    '대전시 동구 홍도동 12, 2층',
    3,
    36.347289,
    127.429733,
  ),
  _b(
    'MFC-DJS-01',
    '대전서구지점',
    _cc,
    '대전시 서구 갈마로 251, 2층',
    4,
    36.333761,
    127.381974,
  ),
  _b(
    'MFC-CAN-01',
    '천안지점',
    _cc,
    '천안시 서북구 두정동 63-6 외, 상가 A동 1층 117-1~4호',
    5,
    36.830856,
    127.145475,
  ),
  _b(
    'MFC-CJS-01',
    '청주상당지점',
    _cc,
    '청주시 상당구 북문로3가 15-1, 우민타워 지상 2층',
    6,
    36.644585,
    127.489140,
  ),
  _b(
    'MFC-CJH-01',
    '청주흥덕지점',
    _cc,
    '청주시 흥덕구 가경동 1454-7, 지하 1층',
    7,
    36.626014,
    127.435200,
  ),
  _b(
    'MFC-WJU-01',
    '원주지점',
    _gw,
    '원주시 단구동 1597-1, 지하1층',
    8,
    37.326245,
    127.955848,
  ),
  _b(
    'MFC-SJG-01',
    '세종지점',
    _cc,
    '세종특별자치시 어진동 513, 지상 3층',
    9,
    36.501750,
    127.257352,
  ),
  _b(
    'MFC-JJU-01',
    '전주지점',
    _jl,
    '전북 전주시 덕진구 명륜5길 15-5(덕진동1가 1277-2) 지상 5층',
    10,
    35.843986,
    127.125237,
  ),
  _b(
    'MFC-DGD-01',
    '대구달서지점',
    _gs,
    '대구시 달서구 구마로 184, 2층',
    11,
    35.836847,
    128.547868,
  ),
  _b(
    'MFC-BSJ-01',
    '부산진구지점',
    _gs,
    '부산시 부산진구 동천로 109, 삼한골드게이트 2층',
    12,
    35.158501,
    129.062021,
  ),
  _b(
    'MFC-DGB-01',
    '대구북구지점',
    _gs,
    '대구시 북구 복현동 426-10, 3층',
    13,
    35.895338,
    128.617350,
  ),
  _b(
    'MFC-DGS-01',
    '대구수성지점',
    _gs,
    '대구시 수성구 황금동 846-4, 2층',
    14,
    35.841330,
    128.623625,
  ),
  _b(
    'MFC-DGJ-01',
    '대구중구지점',
    _gs,
    '대구시 중구 북성로1가 6-1, 3층',
    15,
    35.874589,
    128.595259,
  ),
  _b(
    'MFC-USN-01',
    '울산남구지점',
    _gs,
    '울산시 남구 삼산동 1498-4, 팔레뜨상테 2층',
    16,
    35.545924,
    129.324989,
  ),
  _b(
    'MFC-BHU-01',
    '부산해운대지점',
    _gs,
    '부산시 해운대구 좌동순환로 473, 해운대로데오아울렛 2층',
    17,
    35.163627,
    129.169415,
  ),
  _b(
    'MFC-BSH-01',
    '부산사하지점',
    _gs,
    '부산시 사하구 괴정동 995-3, 2층',
    18,
    35.100912,
    128.992481,
  ),
  _b(
    'MFC-BNG-01',
    '부산남구지점',
    _gs,
    '부산시 남구 수영로 305, 스파크타워 지하 1층',
    19,
    35.137339,
    129.099271,
  ),
  _b(
    'MFC-BDR-01',
    '부산동래지점',
    _gs,
    '부산시 동래구 온천동 456-29, 신화타워아파트 1층',
    20,
    35.214011,
    129.079611,
  ),
  _b(
    'MFC-GHE-01',
    '김해지점',
    _gs,
    '김해시 내동 1131-4, 휴앤락몰 3층',
    21,
    35.242166,
    128.868577,
  ),
  _b(
    'MFC-CWN-01',
    '창원지점',
    _gs,
    '창원시 성산구 용호동 73-2, 라이크빌 지하 1층',
    22,
    35.230431,
    128.680922,
  ),
  _b(
    'MFC-GJS-01',
    '광주서구지점',
    _jl,
    '광주시 동구 충장로2가 18 5층',
    23,
    35.147764,
    126.916600,
  ),
  _b(
    'MFC-GJG-01',
    '광주광산지점',
    _jl,
    '광주시 광산구 우산동 1597-1 1층',
    24,
    35.160000,
    126.809640,
  ),
  _b(
    'MFC-MPO-01',
    '목포지점',
    _jl,
    '전라남도 목포시 상동 869 3층',
    25,
    34.805888,
    126.425561,
  ),
  _b(
    'MFC-GSN-01',
    '경산지점',
    _gs,
    '경상북도 경산시 대평동 94-16 1층',
    26,
    35.840150,
    128.731282,
  ),
];

/// 서버 지점 이름(centerId → 이름). 실서버 지점 목록·제안 요약을 받을 때 채운다.
final serverStoreNames = <String, String>{};

/// 지점 이름: 앱 지점표 → 서버에서 받은 이름 순. 모르면 null.
String? storeNameOf(String id) => mfcById(id)?.name ?? serverStoreNames[id];

MfcBranch? mfcById(String? id) =>
    id == null ? null : mfcBranches.where((b) => b.id == id).firstOrNull;

/// 목 시연의 기본 지점.
final MfcBranch demoMfc = mfcById('MFC-BSJ-01')!;
