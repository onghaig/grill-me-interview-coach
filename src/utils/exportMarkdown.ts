import { SavedInterview } from './history';
import { QUESTION_TYPE_LABELS } from '../../prompts/interviewer';

/** Longest backtick run in the text plus one, so code containing ``` can't break out of its fence. */
function fence(body: string, lang = ''): string {
  const longest = (body.match(/`+/g) || []).reduce((m, r) => Math.max(m, r.length), 0);
  const ticks = '`'.repeat(Math.max(3, longest + 1));
  return `${ticks}${lang}\n${body.replace(/\n$/, '')}\n${ticks}`;
}

const cell = (s: string) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const bullets = (items: string[] | undefined) =>
  items && items.length ? items.map((i) => `- ${i}`).join('\n') : '_None recorded._';

const LANG_FENCE: Record<string, string> = {
  Python: 'python',
  JavaScript: 'javascript',
  TypeScript: 'typescript',
  Java: 'java',
  'C++': 'cpp',
  Go: 'go',
};

export function interviewToMarkdown(iv: SavedInterview, opts: { embedImage?: boolean } = { embedImage: true }): string {
  const q = iv.question;
  const type = q.type || 'system_design';
  const sc = iv.scorecard;
  const date = new Date(iv.savedAt);
  const minutes = Math.max(1, Math.round(iv.durationSeconds / 60));
  const out: string[] = [];

  out.push('---');
  out.push('record_type: mock_interview');
  out.push('format_version: 1');
  out.push(`question_type: ${type}`);
  out.push(`title: ${JSON.stringify(q.title)}`);
  out.push(`difficulty: ${q.difficulty}`);
  out.push(`date: ${date.toISOString()}`);
  out.push(`duration_minutes: ${minutes}`);
  out.push(`timing: ${iv.timing?.mode === 'practice' ? 'practice' : iv.timing?.mode === 'timed' ? `timed_${iv.timing.minutes}_minutes` : 'timed_30_minutes'}`);
  out.push(`overall_score: ${sc ? sc.totalScore : 'null'}`);
  out.push(`verdict: ${sc ? JSON.stringify(sc.overallVerdict) : 'null'}`);
  out.push(`graded: ${sc ? 'true' : 'false'}`);
  out.push('---', '');

  out.push(`# Interview record: ${q.title}`, '');
  out.push(
    '> How to read this file: it is one complete practice interview. The rubric was written before the interview and the grade was assigned against it afterwards. ' +
      'Category scores are 1-5 (3 meets the bar). The overall score is 0-100, weighted by the rubric weights. ' +
      'The transcript is speech-to-text of a voice call, so expect minor transcription errors.',
    ''
  );

  out.push('## Problem', '');
  out.push(`- Type: ${QUESTION_TYPE_LABELS[type]}`);
  out.push(`- Difficulty: ${q.difficulty}`);
  out.push(`- ${type === 'coding' ? 'Constraints' : type === 'low_level_design' ? 'Scope' : type === 'behavioral' ? 'Format' : 'Scale'}: ${q.scale}`, '');
  out.push(q.description.trim(), '');

  if (q.rubric) {
    out.push('## Grading rubric', '');
    out.push('| Category | Weight | What it assesses |', '| --- | ---: | --- |');
    for (const c of q.rubric.categories) out.push(`| ${cell(c.name)} | ${c.weight}% | ${cell(c.description)} |`);
    out.push('');
    for (const c of q.rubric.categories) {
      out.push(`### ${c.name} (${c.weight}%)`, '');
      out.push('Strong signals:', bullets(c.strongSignals), '');
      out.push('Weak signals:', bullets(c.weakSignals), '');
    }
    out.push('### Must-cover topics', '', bullets(q.rubric.mustCover), '');
    out.push('### Red flags', '', bullets(q.rubric.redFlags), '');
  } else {
    out.push('## Grading rubric', '', '_This was a built-in question graded on the default categories for its type, with no custom rubric._', '');
  }

  if (type === 'behavioral' && q.plannedQuestions?.length) {
    out.push('## Interview plan', '');
    out.push('The questions the interviewer planned. The conversation may have skipped, merged or reordered them.', '');
    q.plannedQuestions.forEach((pq, i) => {
      out.push(`${i + 1}. **${pq.competency}**: ${pq.question}`);
      if (pq.anchor) out.push(`   - Resume anchor: ${pq.anchor}`);
      if (pq.followUps.length) out.push(`   - Follow-ups: ${pq.followUps.join(' / ')}`);
    });
    out.push('');
  }

  out.push('## Result', '');
  if (sc) {
    out.push(`**Score: ${sc.totalScore}/100. Verdict: ${sc.overallVerdict}.**`, '');
    out.push(sc.summary, '');
    out.push('### Category scores', '');
    out.push('| Category | Weight | Score | Feedback |', '| --- | ---: | ---: | --- |');
    for (const c of sc.categoryScores) {
      out.push(`| ${cell(c.name)} | ${c.weight != null ? c.weight + '%' : '-'} | ${c.score}/5 | ${cell(c.feedback)} |`);
    }
    out.push('');
    out.push('### Strengths', '', bullets(sc.strengths), '');
    out.push('### Areas for improvement', '', bullets(sc.areasForImprovement), '');
    out.push('### Key trade-offs', '', bullets(sc.keyArchitecturalTradeoffs), '');
    out.push('### Recommended study topics', '', bullets(sc.recommendedStudyTopics), '');
  } else {
    out.push('_This interview was not graded._', '');
  }

  if (type !== 'behavioral') {
    out.push(`## Final code${iv.code.trim() ? ` (${iv.codeLanguage})` : ''}`, '');
    out.push(iv.code.trim() ? fence(iv.code, LANG_FENCE[iv.codeLanguage] || '') : '_No code was written._', '');

    out.push('## Whiteboard', '');
    if (iv.whiteboardImage) {
      out.push(
        opts.embedImage
          ? `![Whiteboard at the end of the interview](${iv.whiteboardImage})`
          : '_The whiteboard image is left out of the clipboard copy. Use Download .md to include it._',
        ''
      );
    }
    out.push(
      iv.diagramText.trim()
        ? `${iv.whiteboardImage ? 'The same diagram as text' : 'Text serialization of the diagram'}, as the interviewer saw it at the end:\n\n` +
            fence(iv.diagramText, 'text')
        : iv.whiteboardImage
        ? ''
        : '_Nothing was drawn._',
      ''
    );
  }

  out.push('## Transcript', '');
  if (iv.transcript.length === 0) out.push('_No transcript was recorded._', '');
  for (const t of iv.transcript) {
    const who = t.role === 'user' ? 'Candidate' : 'Interviewer';
    out.push(`**${who}** (${t.timestamp}): ${t.text.trim().replace(/\n+/g, ' ')}`, '');
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

export function markdownFilename(iv: SavedInterview): string {
  const slug = iv.question.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return `interview-${slug || 'record'}-${new Date(iv.savedAt).toISOString().slice(0, 10)}.md`;
}

export function downloadMarkdown(iv: SavedInterview): void {
  const blob = new Blob([interviewToMarkdown(iv, { embedImage: true })], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = markdownFilename(iv);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyMarkdown(iv: SavedInterview): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(interviewToMarkdown(iv, { embedImage: false }));
    return true;
  } catch {
    return false;
  }
}

export function downloadWhiteboardImage(iv: SavedInterview): void {
  if (!iv.whiteboardImage) return;
  const a = document.createElement('a');
  a.href = iv.whiteboardImage;
  a.download = markdownFilename(iv).replace(/\.md$/, '-whiteboard.png');
  document.body.appendChild(a);
  a.click();
  a.remove();
}
