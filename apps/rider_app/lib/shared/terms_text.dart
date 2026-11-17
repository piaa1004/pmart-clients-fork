import 'package:flutter/material.dart';

import 'rider_style.dart';

/// 약관 문서(마크다운 일부)를 그린다. 새 패키지 없이 약관 문서에 쓰인 형식만:
/// `#`·`##` 제목, `1.` 번호 목록, `-` 글머리(들여쓰기 한 단계), `| 표 |`, `**굵게**`, `> 인용`, `---` 구분선.
/// 맨 앞 `#` 제목은 화면 제목과 겹쳐 그리지 않는다. HTML 주석(`<!-- -->`)은 건너뛴다.
class TermsText extends StatelessWidget {
  const TermsText({super.key, required this.source});

  final String source;

  @override
  Widget build(BuildContext context) {
    final children = <Widget>[];
    final lines = source.split('\n');
    var skippedTitle = false;
    var i = 0;
    while (i < lines.length) {
      final raw = lines[i];
      final line = raw.trimRight();
      final t = line.trimLeft();
      if (t.isEmpty || t.startsWith('<!--')) {
        i++;
        continue;
      }
      if (t.startsWith('# ')) {
        if (skippedTitle) {
          children.add(_heading(t.substring(2), 18));
        }
        skippedTitle = true;
        i++;
        continue;
      }
      if (t.startsWith('## ')) {
        children.add(_heading(t.substring(3), 16));
        i++;
        continue;
      }
      if (t == '---') {
        children.add(const Divider(height: 28));
        i++;
        continue;
      }
      if (t.startsWith('|')) {
        // 표: 연속한 | 줄을 모은다. 두 번째 줄(|---|)은 건너뛴다.
        final rows = <List<String>>[];
        while (i < lines.length && lines[i].trimLeft().startsWith('|')) {
          final cells = lines[i]
              .trim()
              .split('|')
              .map((c) => c.trim())
              .toList();
          if (cells.isNotEmpty) cells.removeAt(0);
          if (cells.isNotEmpty && cells.last.isEmpty) cells.removeLast();
          if (!cells.every((c) => RegExp(r'^:?-+:?$').hasMatch(c))) {
            rows.add(cells);
          }
          i++;
        }
        children.add(_table(rows));
        continue;
      }
      if (t.startsWith('> ') || t == '>') {
        final buf = <String>[];
        while (i < lines.length && (lines[i].trimLeft().startsWith('>'))) {
          final s = lines[i].trimLeft().substring(1).trim();
          if (s.isNotEmpty) buf.add(s);
          i++;
        }
        children.add(
          Container(
            margin: const EdgeInsets.symmetric(vertical: 8),
            padding: const EdgeInsets.all(12),
            color: RiderColors.field,
            child: _rich(buf.join('\n'), size: 13),
          ),
        );
        continue;
      }
      final indent = raw.length - raw.trimLeft().length;
      final bullet = RegExp(r'^- ').hasMatch(t);
      final numbered = RegExp(r'^(\d+)\. ').firstMatch(t);
      if (bullet || numbered != null) {
        final mark = bullet ? '•' : '${numbered!.group(1)}.';
        final text = bullet ? t.substring(2) : t.substring(numbered!.end);
        children.add(
          Padding(
            padding: EdgeInsets.only(left: indent > 0 ? 18 : 0, top: 3),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(width: 22, child: Text(mark, style: _body)),
                Expanded(child: _rich(text)),
              ],
            ),
          ),
        );
        i++;
        continue;
      }
      children.add(
        Padding(padding: const EdgeInsets.only(top: 6), child: _rich(t)),
      );
      i++;
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: children,
    );
  }

  static const _body = TextStyle(
    fontSize: 14,
    height: 1.6,
    color: RiderColors.ink,
  );

  Widget _heading(String text, double size) => Padding(
    padding: const EdgeInsets.only(top: 18, bottom: 4),
    child: Text(
      text,
      style: TextStyle(fontSize: size, fontWeight: FontWeight.w800),
    ),
  );

  /// `**굵게**` 와 `` `코드` `` 표시만 처리한다.
  Widget _rich(String text, {double size = 14}) {
    final spans = <TextSpan>[];
    final re = RegExp(r'\*\*(.+?)\*\*');
    var at = 0;
    for (final m in re.allMatches(text)) {
      if (m.start > at) spans.add(TextSpan(text: text.substring(at, m.start)));
      spans.add(
        TextSpan(
          text: m.group(1),
          style: const TextStyle(fontWeight: FontWeight.w800),
        ),
      );
      at = m.end;
    }
    if (at < text.length) spans.add(TextSpan(text: text.substring(at)));
    return Text.rich(
      TextSpan(
        style: _body.copyWith(fontSize: size),
        children: [
          for (final s in spans)
            TextSpan(text: s.text?.replaceAll('`', ''), style: s.style),
        ],
      ),
    );
  }

  Widget _table(List<List<String>> rows) {
    if (rows.isEmpty) return const SizedBox.shrink();
    final head = rows.first;
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(border: Border.all(color: RiderColors.line)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // 좁은 화면이라 행마다 "머리: 값" 으로 세로로 보인다.
          for (final row in rows.skip(1))
            Container(
              padding: const EdgeInsets.all(10),
              decoration: const BoxDecoration(
                border: Border(bottom: BorderSide(color: RiderColors.line)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (var c = 0; c < row.length; c++)
                    _rich(
                      c < head.length ? '**${head[c]}** ${row[c]}' : row[c],
                      size: 13,
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
