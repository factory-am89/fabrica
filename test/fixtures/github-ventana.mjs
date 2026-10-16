// A simulated GitHub for the ruleset window: the PRs (armed or not, their `revisor` check), the ruleset of `main`
// and a log of every call. `run(args)` has the shape scripts/lib/ventana.mjs expects (args after `gh`).
// `onCall(call, sim)` lets a test act in the middle (a PR armed by someone else while the window is open).
export const REPO = 'factory-am89/fabrica';

export function makeGithub({ prs = [], enforcement = 'active', onCall = () => {}, failDisarm = [] } = {}) {
  const sim = {
    calls: [],
    enforcement,
    prs: new Map(prs.map((p) => [p.number, { state: 'open', merged: false, armed: false, revisor: null, ...p, sha: `sha${p.number}` }])),
  };
  const ok = (body) => ({ status: 0, stdout: typeof body === 'string' ? body : JSON.stringify(body), stderr: '' });
  const fail = (stderr) => ({ status: 1, stdout: '', stderr });
  sim.run = (args) => {
    const line = args.join(' ');
    sim.calls.push(line);
    onCall(line, sim);
    const base = `api repos/${REPO}/`;
    if (line === `${base}pulls?state=open&per_page=100`) {
      return ok([...sim.prs].filter(([, p]) => p.state === 'open').map(([number, p]) => ({ number, auto_merge: p.armed ? { merge_method: 'squash' } : null })));
    }
    if (line === `${base}rulesets`) return ok([{ id: 1, name: 'main', enforcement: sim.enforcement }]);
    let m = line.startsWith(`${base}pulls/`) ? line.slice(`${base}pulls/`.length).match(/^(\d+)$/) : null;
    if (m) {
      const p = sim.prs.get(Number(m[1]));
      return p ? ok({ state: p.state, merged: p.merged, head: { sha: p.sha } }) : fail('404');
    }
    m = line.match(/\/commits\/sha(\d+)\/check-runs/);
    if (m) {
      const p = sim.prs.get(Number(m[1]));
      return ok({ check_runs: p.revisor ? [{ id: 1, name: 'revisor', conclusion: p.revisor }, { id: 2, name: 'tests', conclusion: 'success' }] : [] });
    }
    m = line.match(/^pr merge (\d+) --repo \S+ (--disable-auto|--auto --squash)$/);
    if (m) {
      const n = Number(m[1]);
      if (m[2] === '--disable-auto' && failDisarm.includes(n)) return fail('cannot disarm');
      sim.prs.get(n).armed = m[2] !== '--disable-auto';
      return ok('');
    }
    return fail(`not simulated: ${line}`);
  };
  sim.armed = () => [...sim.prs].filter(([, p]) => p.armed).map(([n]) => n);
  return sim;
}
