import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/simulation.js';
import { PRESETS, SLOTS, CFM_PER_M3S } from '../src/sim/model.js';

const RHO_CP = 1200;

function run(modes, steps = 600, opts = {}) {
  const sim = new Simulation({ resolution: 'low', modes, ...opts });
  for (let i = 0; i < steps; i++) sim.step();
  return sim;
}

const allModes = (mode) => Object.fromEntries(SLOTS.map((s) => [s.id, mode]));

test('pressure projection leaves a nearly divergence-free field', () => {
  const sim = run(PRESETS.balanced.modes, 200);
  assert.ok(sim.grid.maxDivergence() < 1e-3, `max divergence ${sim.grid.maxDivergence()}`);
});

test('air mass is conserved: what comes in goes out', () => {
  for (const id of ['balanced', 'positive', 'negative', 'stock', 'passive']) {
    const s = run(PRESETS[id].modes, 300).stats();
    const rel = Math.abs(s.totalIn - s.totalOut) / Math.max(s.totalIn, 1e-6);
    assert.ok(rel < 0.02, `${id}: in ${s.totalIn} out ${s.totalOut}`);
  }
});

test('more intake than exhaust gives positive pressure, and vice versa', () => {
  const pos = run(PRESETS.positive.modes, 300).stats();
  const neg = run(PRESETS.negative.modes, 300).stats();
  assert.ok(pos.pressure > 0.5, `positive preset pressure ${pos.pressure}`);
  assert.ok(neg.pressure < -0.5, `negative preset pressure ${neg.pressure}`);
  assert.ok(pos.ventOut > pos.ventIn, 'positive pressure pushes air out through vents');
  assert.ok(neg.ventIn > neg.ventOut, 'negative pressure pulls air in through vents');
});

test('heat leaving with the exhaust air matches the component power', () => {
  const sim = run(PRESETS.balanced.modes, 1400);
  const g = sim.grid;
  const b = sim.boundary;
  let out = 0;
  for (let n = 0; n < b.length; n += 4) {
    const { vel } = g.faceArrays(b[n]);
    const q = vel[b[n + 1]] * b[n + 2] * sim.h * sim.h;
    if (q < 0) out += -q * RHO_CP * (g.T[b[n + 3]] - sim.ambient);
  }
  const power = sim.groups.cpu.power + sim.groups.gpu.power;
  // Panels also leak a little heat, so the exhaust carries slightly less.
  assert.ok(out > power * 0.8 && out < power * 1.05, `exhaust carries ${out.toFixed(0)} W of ${power} W`);
});

test('a restricted case starves its fans (static-pressure curve)', () => {
  const open = run({ ...allModes('open'), rear: 'exhaust' }, 300);
  const shut = run({ ...allModes('blocked'), rear: 'exhaust' }, 300);
  const cfm = (sim) => sim.fans.find((f) => f.id === 'rear').q * CFM_PER_M3S;
  assert.ok(cfm(shut) < cfm(open) * 0.8, `open ${cfm(open).toFixed(1)} vs shut ${cfm(shut).toFixed(1)} CFM`);
});

test('good airflow keeps components cooler than no case fans', () => {
  const good = run(PRESETS.balanced.modes, 1200).summary();
  const bad = run(PRESETS.passive.modes, 1200).summary();
  assert.ok(good.groups.cpu.die < bad.groups.cpu.die, 'CPU');
  assert.ok(good.groups.gpu.die < bad.groups.gpu.die, 'GPU');
  assert.ok(good.airTemp < bad.airTemp, 'case air');
});
