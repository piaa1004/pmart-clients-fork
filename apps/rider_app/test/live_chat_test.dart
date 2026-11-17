import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pmart_core/pmart_core.dart';

import 'package:rider_app/features/delivery/domain/delivery.dart';
import 'package:rider_app/features/inquiries/data/live_chat.dart';

/// 실시간 채팅 상담(배송 밖): 목은 인사 → 라이더 말 → 답장, 실서버는 아직 경로가 없다(준비 중).
void main() {
  test('목: 열면 인사, 말하면 답장, 같은 키는 한 번만', () async {
    var now = DateTime.utc(2026, 11, 17, 10);
    final repo = MockLiveChatRepository(clock: () => now);
    expect(await repo.messages(), isEmpty, reason: '연결 중');
    now = now.add(MockLiveChatRepository.greetAfter);
    final greeted = await repo.messages();
    expect(greeted.single.sender, SupportSender.agent);

    final key = IdempotencyKey.generate();
    await repo.send('정산이 안 들어왔어요', key: key);
    await repo.send('정산이 안 들어왔어요', key: key);
    expect(
      (await repo.messages()).where((m) => m.sender == SupportSender.rider),
      hasLength(1),
    );
    now = now.add(MockLiveChatRepository.replyAfter);
    final replied = await repo.messages();
    expect(replied.last.sender, SupportSender.agent);
    expect(replied, hasLength(3));
  });

  test('실서버: 첫 말 = 새 문의, 그 뒤 이어 쓰기·after 로 새 말만, 닫히면 다음 말은 새 문의', () async {
    final calls = <String>[];
    var closed = false;
    final dio = Dio(BaseOptions(baseUrl: 'http://fake/api/v1'));
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (o, h) {
          calls.add('${o.method} ${o.uri.path}?${o.uri.query}');
          Response<Object?> ok(int status, Object body) =>
              Response(requestOptions: o, statusCode: status, data: body);
          final p = o.uri.path;
          if (o.method == 'POST' && p.endsWith('/inquiries')) {
            h.resolve(
              ok(201, {
                'inquiryId': 'inq-1',
                'caseId': 'case-1',
                'version': 1,
                'category': 'OTHER',
                'title': '실시간 채팅 상담',
                'body': '정산이 안 들어왔어요',
                'status': 'RECEIVED',
                'createdAt': '2026-11-17T10:00:00Z',
                'replies': <Object>[],
              }),
            );
          } else if (o.method == 'GET' && p.endsWith('/messages')) {
            h.resolve(
              ok(200, {
                'status': closed ? 'CLOSED' : 'ANSWERED',
                'items': o.uri.queryParameters.containsKey('after')
                    ? <Object>[]
                    : [
                        {
                          'messageId': 'm1',
                          'seq': 1,
                          'senderType': 'SUPPORT',
                          'body': '확인해 볼게요',
                          'createdAt': '2026-11-17T10:01:00Z',
                        },
                      ],
              }),
            );
          } else if (o.method == 'POST' && p.endsWith('/messages')) {
            if (closed) {
              h.reject(
                DioException(
                  requestOptions: o,
                  response: Response(
                    requestOptions: o,
                    statusCode: 409,
                    headers: Headers.fromMap({
                      Headers.contentTypeHeader: ['application/problem+json'],
                    }),
                    data: {
                      'type': 'about:blank',
                      'status': 409,
                      'code': 'INQUIRY_CLOSED',
                    },
                  ),
                  type: DioExceptionType.badResponse,
                ),
              );
            } else {
              h.resolve(
                ok(201, {
                  'messageId': 'm2',
                  'seq': 2,
                  'senderType': 'RIDER',
                  'body': '언제 들어오나요?',
                  'createdAt': '2026-11-17T10:02:00Z',
                }),
              );
            }
          }
        },
      ),
    );
    final repo = ApiLiveChatRepository(dio, title: '실시간 채팅 상담');
    expect(await repo.messages(), isEmpty, reason: '보내기 전에는 상담이 없다');
    await repo.send('정산이 안 들어왔어요', key: IdempotencyKey.generate());
    final first = await repo.messages();
    expect(first.map((m) => m.sender), [
      SupportSender.rider,
      SupportSender.agent,
    ]);
    expect(first.first.text, '정산이 안 들어왔어요');
    await repo.messages();
    expect(calls.last, contains('after=1'), reason: '받은 말 다음부터만');
    await repo.send('언제 들어오나요?', key: IdempotencyKey.generate());
    expect(calls.last, startsWith('POST /api/v1/inquiries/inq-1/messages'));

    closed = true;
    await expectLater(
      repo.send('또 물어볼게요', key: IdempotencyKey.generate()),
      throwsA(isA<LiveChatClosed>()),
    );
    // 닫힌 뒤 다음 말은 새 문의다.
    await repo.send('새로 물어볼게요', key: IdempotencyKey.generate());
    expect(calls.last, 'POST /api/v1/inquiries?');
  });
}
