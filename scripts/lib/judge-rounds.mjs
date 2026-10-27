// The indicator `judge-rounds` of `audit --data`: how many times the `revisor` judged each MERGED PR of the downloaded window
// (distribution, mean, share judged once). Pure: it takes what readPulls() and readCheckRuns() return, no network, no clock.
// It counts judgments, not answers to a «no»; what it cannot tell apart is reported beside the figure (pushesAfterYes, sameShaRepeats, ...).

export const LAST_BUCKET = 5; // the distribution ends in «5 or more»
export const NOT_MEASURED = Object.freeze({
  pushWithoutNo: 'a-judgment-after-a-yes-or-on-an-already-judged-sha-answers-no-no',
  noJudgment: 'a-merged-pr-with-no-readable-judgment-is-left-out',
});

const rate = (n, d) => (d === 0 ? null : n / d);
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

// prs: readPulls() result; records: readCheckRuns().records. A record of a PR that is not merged in the window is not counted.
export function judgeRounds(prs, records) {
  const merged = prs.filter((p) => p.merged !== null);
  const byPr = new Map(merged.map((p) => [p.number, { pr: p, records: [] }]));
  let ofOtherPrs = 0;
  for (const r of records) {
    const slot = byPr.get(r.pr);
    if (slot) slot.records.push(r);
    else ofOtherPrs += 1;
  }
  const judged = [...byPr.values()].filter((s) => s.records.length > 0);
  const counts = judged.map((s) => s.records.length);
  const distribution = {};
  for (const n of counts) distribution[Math.min(n, LAST_BUCKET)] = (distribution[Math.min(n, LAST_BUCKET)] ?? 0) + 1;
  let pushesAfterYes = 0;
  let sameShaRepeats = 0;
  let shaOutsideCommits = 0;
  for (const { pr, records: rs } of judged) {
    const order = [...pr.commits];
    const shas = [...new Set(rs.map((r) => r.sha))];
    sameShaRepeats += rs.length - shas.length;
    shaOutsideCommits += shas.filter((s) => !pr.commits.has(s)).length;
    const placed = order.filter((s) => shas.includes(s));
    placed.forEach((sha, i) => {
      if (i > 0 && rs.some((r) => r.sha === placed[i - 1] && r.ok)) pushesAfterYes += 1;
    });
  }
  return {
    mergedPrs: merged.length,
    judgedPrs: judged.length,
    withoutJudgment: merged.length - judged.length,
    from: merged.length === 0 ? null : day(Math.min(...merged.map((p) => p.created))),
    to: merged.length === 0 ? null : day(Math.max(...merged.map((p) => p.merged))),
    judgments: counts.reduce((a, n) => a + n, 0),
    mean: rate(counts.reduce((a, n) => a + n, 0), judged.length),
    firstTime: counts.filter((n) => n === 1).length,
    firstTimeRate: rate(counts.filter((n) => n === 1).length, judged.length),
    distribution,
    lastBucket: LAST_BUCKET,
    pushesAfterYes,
    sameShaRepeats,
    shaOutsideCommits,
    recordsOfOtherPrs: ofOtherPrs,
    judgmentsWithError: judged.reduce((a, s) => a + s.records.filter((r) => r.error !== null).length, 0),
    notMeasured: [NOT_MEASURED.pushWithoutNo, NOT_MEASURED.noJudgment],
  };
}
