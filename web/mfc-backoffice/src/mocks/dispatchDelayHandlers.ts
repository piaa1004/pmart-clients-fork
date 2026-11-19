// 배차 지연 목(delivery-dispatch 0.12.0 `GET /dispatch-delays?mfcId=` — 그 센터 운영자만, 픽업 전·약속 이른 순)
// + 배송 번호 묶음 조회(delivery-execution 0.31.0 `GET /deliveries?deliveryIds=&mfcId=` — 권한 밖 센터·없는 ID 는 빠짐, 51개 넘으면 400).
import { http, HttpResponse } from 'msw';

import { API_BASE } from '../api/client';
import { operator, problem, unauthorized } from './support';

const minutesFromNow = (min: number) => new Date(Date.now() + min * 60_000).toISOString();

interface MockDelay {
  readonly deliveryId: string;
  readonly orderId: string;
  readonly mfcId: string;
  readonly deliverySeq: number | null;
  readonly state: 'CREATED' | 'DISPATCHING' | 'ASSIGNED';
  readonly riderId: string | null;
  readonly promisedAt: string | null;
  readonly delayAlertedAt: string;
  readonly createdAt: string;
  /** 실행 서비스의 화면 번호(없으면 null) */
  readonly deliveryNumber: string | null;
}

function seedDispatchDelays(): MockDelay[] {
  return [
    { deliveryId: 'DLV-DD-1', orderId: 'ORD-DD-1', mfcId: 'MFC-BSN-01', deliverySeq: 1, state: 'DISPATCHING', riderId: null, promisedAt: minutesFromNow(-74), delayAlertedAt: minutesFromNow(-90), createdAt: minutesFromNow(-124), deliveryNumber: '35726513-1' },
    { deliveryId: 'DLV-DD-2', orderId: 'ORD-DD-2', mfcId: 'MFC-BSN-01', deliverySeq: 1, state: 'ASSIGNED', riderId: 'RD-41', promisedAt: minutesFromNow(8), delayAlertedAt: minutesFromNow(-5), createdAt: minutesFromNow(-42), deliveryNumber: null },
    { deliveryId: 'DLV-DD-S', orderId: 'ORD-DD-S', mfcId: 'MFC-SEL-01', deliverySeq: 1, state: 'CREATED', riderId: null, promisedAt: minutesFromNow(-10), delayAlertedAt: minutesFromNow(-20), createdAt: minutesFromNow(-60), deliveryNumber: '40000001-1' },
  ];
}

// 바꾸는 명령이 없어 시험마다 되돌릴 것이 없다(시각만 불러올 때 기준).
const delays = seedDispatchDelays();

export const dispatchDelayHandlers = [
  http.get(`${API_BASE}/dispatch-delays`, ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    const mfcId = new URL(request.url).searchParams.get('mfcId');
    if (!mfcId || !who.centers.includes(mfcId)) return problem(403, 'FORBIDDEN');
    const items = delays
      .filter((d) => d.mfcId === mfcId)
      .sort((a, b) => (a.promisedAt ?? '').localeCompare(b.promisedAt ?? ''))
      .map(({ deliveryNumber, ...rest }) => {
        void deliveryNumber;
        return rest;
      });
    return HttpResponse.json({ items });
  }),
  http.get(`${API_BASE}/deliveries`, ({ request }) => {
    const who = operator(request);
    if (!who) return unauthorized();
    const q = new URL(request.url).searchParams;
    const mfcId = q.get('mfcId');
    if (!mfcId || !who.centers.includes(mfcId)) return problem(403, 'FORBIDDEN');
    const ids = (q.get('deliveryIds') ?? '').split(',').filter(Boolean);
    if (ids.length > 50) return problem(400, 'VALIDATION_FAILED');
    const items = delays
      .filter((d) => d.mfcId === mfcId && ids.includes(d.deliveryId))
      .map((d) => ({ deliveryId: d.deliveryId, deliveryNumber: d.deliveryNumber, orderId: d.orderId, mfcId: d.mfcId, riderId: d.riderId, type: 'FORWARD', createdAt: d.createdAt }));
    return HttpResponse.json({ items, page: { size: items.length, nextCursor: null } });
  }),
];
