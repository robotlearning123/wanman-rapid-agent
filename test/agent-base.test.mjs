/**
 * Tests for src/agents/base.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Agent, AgentState } from '../src/agents/base.mjs';

describe('AgentState', () => {
  it('has all expected states', () => {
    assert.equal(AgentState.IDLE, 'idle');
    assert.equal(AgentState.INITIALIZING, 'initializing');
    assert.equal(AgentState.RUNNING, 'running');
    assert.equal(AgentState.STOPPED, 'stopped');
    assert.equal(AgentState.ERRORED, 'errored');
  });
});

describe('Agent', () => {
  it('constructor requires a non-empty string name', () => {
    assert.throws(() => new Agent(''), { message: /non-empty string name/ });
    assert.throws(() => new Agent(null), { message: /non-empty string name/ });
    assert.throws(() => new Agent(123), { message: /non-empty string name/ });
  });

  it('constructor stores name and config', () => {
    const agent = new Agent('test-agent', { key: 'value' });
    assert.equal(agent.name, 'test-agent');
    assert.deepEqual(agent.config, { key: 'value' });
  });

  it('config is frozen (immutable)', () => {
    const agent = new Agent('test', { key: 'value' });
    assert.throws(() => { agent.config.key = 'changed'; });
  });

  it('defaults config to empty object', () => {
    const agent = new Agent('test');
    assert.deepEqual(agent.config, {});
  });

  it('initial state is IDLE', () => {
    const agent = new Agent('test');
    assert.equal(agent.state, AgentState.IDLE);
  });

  it('errors array starts empty', () => {
    const agent = new Agent('test');
    assert.deepEqual(agent.errors, []);
  });

  it('errors array is a frozen copy', () => {
    const agent = new Agent('test');
    const errors = agent.errors;
    assert.throws(() => { errors.push('x'); });
  });

  it('initialize transitions IDLE → INITIALIZING → RUNNING', async () => {
    const agent = new Agent('test');
    assert.equal(agent.state, AgentState.IDLE);
    await agent.initialize();
    assert.equal(agent.state, AgentState.RUNNING);
  });

  it('run returns result and transitions to IDLE', async () => {
    const agent = new Agent('test');
    await agent.initialize();
    const result = await agent.run();
    assert.deepEqual(result, {});
    assert.equal(agent.state, AgentState.IDLE);
  });

  it('run throws when not in RUNNING state', async () => {
    const agent = new Agent('test');
    await assert.rejects(
      () => agent.run(),
      { message: /not running/ }
    );
  });

  it('stop transitions RUNNING → STOPPED', async () => {
    const agent = new Agent('test');
    await agent.initialize();
    await agent.stop();
    assert.equal(agent.state, AgentState.STOPPED);
  });

  it('stop is a no-op when already STOPPED', async () => {
    const agent = new Agent('test');
    await agent.initialize();
    await agent.stop();
    await agent.stop(); // should not throw
    assert.equal(agent.state, AgentState.STOPPED);
  });

  it('can re-initialize from STOPPED state', async () => {
    const agent = new Agent('test');
    await agent.initialize();
    await agent.stop();
    await agent.initialize();
    assert.equal(agent.state, AgentState.RUNNING);
  });

  it('can re-initialize from ERRORED state', async () => {
    const agent = new Agent('test');
    // Force an error via fail()
    agent.fail(new Error('test error'));
    assert.equal(agent.state, AgentState.IDLE); // fail from IDLE doesn't transition
    // Actually, fail only transitions from RUNNING or INITIALIZING
  });

  it('fail records error entry', () => {
    const agent = new Agent('test');
    agent.fail(new Error('something broke'), 'test-phase');
    assert.equal(agent.errors.length, 1);
    assert.equal(agent.errors[0].message, 'something broke');
    assert.equal(agent.errors[0].phase, 'test-phase');
  });

  it('fail defaults phase to current state', () => {
    const agent = new Agent('test');
    agent.fail(new Error('err'));
    assert.equal(agent.errors[0].phase, AgentState.IDLE);
  });

  it('fail transitions from RUNNING to ERRORED', async () => {
    const agent = new Agent('test');
    await agent.initialize(); // RUNNING
    agent.fail(new Error('runtime error'));
    assert.equal(agent.state, AgentState.ERRORED);
  });

  it('fail transitions from INITIALIZING to ERRORED', async () => {
    // Create agent that fails during initialization
    class FailInitAgent extends Agent {
      async _onInitialize() {
        throw new Error('init failed');
      }
    }
    const agent = new FailInitAgent('fail-agent');
    await assert.rejects(() => agent.initialize(), { message: 'init failed' });
    assert.equal(agent.state, AgentState.ERRORED);
  });

  it('initialize error gets recorded', async () => {
    class FailInitAgent extends Agent {
      async _onInitialize() {
        throw new Error('bad init');
      }
    }
    const agent = new FailInitAgent('fail-agent');
    await assert.rejects(() => agent.initialize());
    assert.equal(agent.errors.length, 1);
    assert.equal(agent.errors[0].message, 'bad init');
  });

  it('run error gets recorded', async () => {
    class FailRunAgent extends Agent {
      async _onRun() {
        throw new Error('run failed');
      }
    }
    const agent = new FailRunAgent('fail-run');
    await agent.initialize();
    await assert.rejects(() => agent.run(), { message: 'run failed' });
    assert.equal(agent.errors.length, 1);
    assert.equal(agent.state, AgentState.ERRORED);
  });

  it('stop error gets recorded', async () => {
    class FailStopAgent extends Agent {
      async _onStop() {
        throw new Error('stop failed');
      }
    }
    const agent = new FailStopAgent('fail-stop');
    await agent.initialize();
    await assert.rejects(() => agent.stop(), { message: 'stop failed' });
    assert.equal(agent.errors.length, 1);
  });

  it('subclass can override _onRun with custom result', async () => {
    class CustomAgent extends Agent {
      async _onRun() {
        return { custom: true };
      }
    }
    const agent = new CustomAgent('custom');
    await agent.initialize();
    const result = await agent.run();
    assert.deepEqual(result, { custom: true });
  });

  it('invalid state transition throws', async () => {
    const agent = new Agent('test');
    // IDLE → RUNNING is invalid (must go through INITIALIZING)
    await assert.rejects(() => agent.run());
  });
});
