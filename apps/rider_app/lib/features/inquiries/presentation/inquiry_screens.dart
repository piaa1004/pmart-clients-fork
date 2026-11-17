import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:pmart_core/pmart_core.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/rider_style.dart';
import '../../../shared/rider_widgets.dart';
import '../../delivery/presentation/delivery_texts.dart' show clockText;
import '../data/inquiries.dart';

String inquiryKindText(AppLocalizations l10n, InquiryKind k) => switch (k) {
  InquiryKind.settlement => l10n.inqSettlement,
  InquiryKind.account => l10n.inqAccount,
  InquiryKind.appError => l10n.inqAppError,
  InquiryKind.other => l10n.inqOther,
};

(String, Color) inquiryStateLook(AppLocalizations l10n, InquiryState s) =>
    switch (s) {
      InquiryState.received => (l10n.inqReceived, RiderColors.pickup),
      InquiryState.answered => (l10n.inqAnswered, RiderColors.primary),
      InquiryState.unknown => (l10n.inqUnknown, RiderColors.sub),
    };

/// 지원센터 문의(배송과 상관없는 것 — 정산·계정·앱 오류·기타). 배송 건은 배송 화면의 도움요청.
class InquiryListScreen extends ConsumerWidget {
  const InquiryListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final list = ref.watch(inquiriesProvider);
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: riderDarkBar(context, title: l10n.menuInquiries),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(inquiriesProvider.future),
        child: ListView(
          key: const ValueKey('inquiry-list'),
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
          children: [
            Text(
              l10n.inqIntro,
              style: const TextStyle(
                fontSize: 14,
                height: 1.5,
                color: RiderColors.sub,
              ),
            ),
            const SizedBox(height: 12),
            RiderButton(
              key: const ValueKey('inquiry-new'),
              icon: Icons.edit_outlined,
              label: l10n.inqNew,
              onPressed: () async {
                await context.push('/my/inquiries/new');
                ref.invalidate(inquiriesProvider);
              },
            ),
            const SizedBox(height: 18),
            switch (list) {
              AsyncData(:final value) when value.isEmpty => Padding(
                padding: const EdgeInsets.symmetric(vertical: 24),
                child: Text(
                  l10n.inqEmpty,
                  key: const ValueKey('inquiry-empty'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: RiderColors.sub),
                ),
              ),
              AsyncData(:final value) => Column(
                children: [for (final i in value) _InquiryRow(inquiry: i)],
              ),
              // 조회 실패를 "문의 없음"으로 보이지 않는다.
              AsyncError() => Row(
                key: const ValueKey('inquiry-error'),
                children: [
                  Expanded(child: Text(l10n.inqLoadFailed)),
                  TextButton(
                    onPressed: () => ref.invalidate(inquiriesProvider),
                    child: Text(l10n.retry),
                  ),
                ],
              ),
              _ => const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: CircularProgressIndicator()),
              ),
            },
          ],
        ),
      ),
    );
  }
}

class _InquiryRow extends StatelessWidget {
  const _InquiryRow({required this.inquiry});

  final RiderInquiry inquiry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final (text, color) = inquiryStateLook(l10n, inquiry.state);
    return InkWell(
      key: ValueKey('inquiry-${inquiry.id}'),
      onTap: () => context.push('/my/inquiries/${inquiry.id}'),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 14),
        decoration: const BoxDecoration(
          border: Border(bottom: BorderSide(color: RiderColors.line)),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${inquiryKindText(l10n, inquiry.kind)} · ${clockText(inquiry.createdAt)}',
                    style: const TextStyle(
                      fontSize: 13,
                      color: RiderColors.sub,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    inquiry.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
            Text(
              text,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: color,
              ),
            ),
            const Icon(Icons.chevron_right, color: RiderColors.sub),
          ],
        ),
      ),
    );
  }
}

/// 새 문의: 유형 · 제목(100자) · 내용(2000자) → 보내기. 같은 내용을 다시 누르면 같은 키(문의가 두 번 생기지 않게).
class InquiryNewScreen extends ConsumerStatefulWidget {
  const InquiryNewScreen({super.key});

  @override
  ConsumerState<InquiryNewScreen> createState() => _InquiryNewScreenState();
}

class _InquiryNewScreenState extends ConsumerState<InquiryNewScreen> {
  final _title = TextEditingController();
  final _body = TextEditingController();
  InquiryKind? _kind;
  bool _sending = false;
  IdempotencyKey? _key;
  String? _keyFor;

  @override
  void dispose() {
    _title.dispose();
    _body.dispose();
    super.dispose();
  }

  bool get _ready =>
      _kind != null &&
      _title.text.trim().isNotEmpty &&
      _body.text.trim().isNotEmpty &&
      !_sending;

  Future<void> _send() async {
    final l10n = AppLocalizations.of(context);
    final kind = _kind!;
    final title = _title.text.trim();
    final body = _body.text.trim();
    final sig = '${kind.name}|$title|$body';
    // 결과를 모르는 같은 내용은 같은 키로 다시 보낸다.
    final key = _keyFor == sig && _key != null
        ? _key!
        : IdempotencyKey.generate();
    _key = key;
    _keyFor = sig;
    setState(() => _sending = true);
    try {
      final created = await ref
          .read(inquiryRepositoryProvider)
          .create(kind, title: title, body: body, key: key);
      if (!mounted) return;
      showRiderToast(context, l10n.inqSent);
      context.pushReplacement('/my/inquiries/${created.id}');
    } on PmartFailure {
      if (!mounted) return;
      setState(() => _sending = false);
      showRiderToast(context, l10n.inqSendFailed);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: riderDarkBar(context, title: l10n.inqNew),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        children: [
          Text(l10n.inqKind, style: _label),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final k in InquiryKind.values)
                ChoiceChip(
                  key: ValueKey('inq-kind-${k.name}'),
                  label: Text(inquiryKindText(l10n, k)),
                  selected: _kind == k,
                  selectedColor: RiderColors.primarySoft,
                  onSelected: (_) => setState(() => _kind = k),
                ),
            ],
          ),
          const SizedBox(height: 18),
          Text(l10n.inqTitle, style: _label),
          const SizedBox(height: 8),
          TextField(
            key: const ValueKey('inq-title'),
            controller: _title,
            maxLength: 100,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(border: OutlineInputBorder()),
          ),
          const SizedBox(height: 8),
          Text(l10n.inqBody, style: _label),
          const SizedBox(height: 8),
          TextField(
            key: const ValueKey('inq-body'),
            controller: _body,
            maxLength: 2000,
            minLines: 5,
            maxLines: 10,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              hintText: l10n.inqBodyHint,
              border: const OutlineInputBorder(),
            ),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: RiderButton(
            key: const ValueKey('inq-send'),
            label: l10n.inqSend,
            onPressed: _ready ? _send : null,
          ),
        ),
      ),
    );
  }
}

const _label = TextStyle(fontSize: 15, fontWeight: FontWeight.w700);

/// 문의 상세: 내가 쓴 글 + 지원센터 답변. 답변 알림(푸시)이 없어 들어올 때·당겨서 새로 읽는다.
class InquiryDetailScreen extends ConsumerStatefulWidget {
  const InquiryDetailScreen({super.key, required this.inquiryId});

  final String inquiryId;

  @override
  ConsumerState<InquiryDetailScreen> createState() =>
      _InquiryDetailScreenState();
}

class _InquiryDetailScreenState extends ConsumerState<InquiryDetailScreen> {
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    // 답변을 기다리는 동안 가끔 다시 읽는다.
    _poll = Timer.periodic(const Duration(seconds: 10), (_) {
      if (mounted) ref.invalidate(inquiryProvider(widget.inquiryId));
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = inquiryProvider(widget.inquiryId);
    final state = ref.watch(p);
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: riderDarkBar(context, title: l10n.menuInquiries),
      body: switch (state) {
        AsyncData(:final value) => RefreshIndicator(
          onRefresh: () => ref.refresh(p.future),
          child: ListView(
            key: const ValueKey('inquiry-detail'),
            padding: const EdgeInsets.all(16),
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      inquiryKindText(l10n, value.kind),
                      style: const TextStyle(color: RiderColors.sub),
                    ),
                  ),
                  Text(
                    inquiryStateLook(l10n, value.state).$1,
                    key: const ValueKey('inquiry-state'),
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                      color: inquiryStateLook(l10n, value.state).$2,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                value.title,
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                value.body,
                style: const TextStyle(fontSize: 15, height: 1.5),
              ),
              const Divider(height: 32),
              Text(l10n.inqReplies, style: _label),
              const SizedBox(height: 8),
              if (value.replies.isEmpty)
                Text(
                  l10n.inqWaiting,
                  key: const ValueKey('inquiry-waiting'),
                  style: const TextStyle(color: RiderColors.sub),
                )
              else
                for (final r in value.replies)
                  Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: RiderColors.field,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          l10n.supportCenter,
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          r.body,
                          key: const ValueKey('inquiry-reply'),
                          style: const TextStyle(fontSize: 15, height: 1.5),
                        ),
                      ],
                    ),
                  ),
            ],
          ),
        ),
        AsyncError() => Center(
          child: TextButton(
            onPressed: () => ref.invalidate(p),
            child: Text(l10n.inqLoadFailed),
          ),
        ),
        _ => const Center(child: CircularProgressIndicator()),
      },
    );
  }
}
