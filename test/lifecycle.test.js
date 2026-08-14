'use strict';

const assert = require('node:assert/strict');
const { IdleServiceSupervisor, parseDuration, environmentOptions } = require('../server/lifecycle.js');

assert.equal(parseDuration('5m'), 300000);
assert.equal(parseDuration('1.5s'), 1500);
assert.deepEqual(environmentOptions({ KEEP_ALIVE: 'true', IDLE_TIMEOUT: '2m' }), {
  keepAlive: true,
  idleMs: 120000
});

(async () => {
  const calls = [];
  const supervisor = new IdleServiceSupervisor({
    keepAlive: false,
    idleMs: 20,
    maps: ['one', 'two'],
    random: () => 0.75,
    start: async context => { calls.push(['start', context.map]); return { pid: 1 }; },
    stop: async (_handle, reason) => { calls.push(['stop', reason]); }
  });
  const [first, second] = await Promise.all([supervisor.wake(), supervisor.wake()]);
  assert.equal(first.state, 'running');
  assert.equal(second.map, 'two');
  assert.deepEqual(calls, [['start', 'two']], 'simultaneous browser wake calls share one start');
  supervisor.observeHumans(1);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(supervisor.status().state, 'running', 'a connected human cancels idle shutdown');
  supervisor.observeHumans(0);
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(supervisor.status().state, 'sleeping');
  assert.deepEqual(calls[1], ['stop', 'idle']);
  console.log('shared server wake, random-map, population, and idle-shutdown tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
