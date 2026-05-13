/**
 * Tests for src/agents/base.mjs — Agent base class
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Agent, AgentState } from '../src/agents/base.mjs';

function captureStderr(fn) {
  const chunks = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => chunks.push(chunk);
  try {
    fn();
  } finally {
    process.stderr.write = original;
  }
  return chunks.join('');
}

describe('Agent base class', () => {
  describe('constructor', () => {
    it('stores name and config', () => {
      const agent = new Agent('test-agent', { foo: 'bar' });
      assert.equal(agent.name, 'test-agent');
      assert.deepEqual(agent.config, { foo: 'bar' });
    });

    it('defaults config to empty object', () => {
      const agent = new Agent('test-agent');
      assert.deepEqual(agent.config, {});
    });

    it('freezes config to prevent mutation', () => {
      const cfg = { count: 1 };
      const agent = new Agent('test', cfg);
      assert.throws(() => { agent.config.count = 2; });
    });

    it('throws on empty name', () => {
      assert.throws(() => new Agent(''), { message: /non-empty string name/ });
    });

    it('throws on non-string name', () => {
      assert.throws(() => new Agent(123), { message: /non-empty string name/ });
    });

    it('starts in IDLE state', () => {
      const agent = new Agent('test');
      assert.equal(agent.state, AgentState.IDLE);
    });

    it('starts with empty errors', () => {
      const agent = new Agent('test');
      assert.deepEqual(agent.errors, []);
    });
  });

  describe('lifecycle', () => {
    it('initialize → transitions IDLE to RUNNING', async () => {
      const agent = new Agent('lifecycle-test');
      assert.equal(agent.state, AgentState.IDLE);
      await agent.initialize();
      assert.equal(agent.state, AgentState.RUNNING);
    });

    it('run → executes _onRun and returns result', async () => {
      class TestAgent extends Agent {
        async _onRun() {
          return { items: 42 };
        }
      }
      const agent = new TestAgent('run-test');
      await agent.initialize();
      const result = await agent.run();
      assert.deepEqual(result, { items: 42 });
      assert.equal(agent.state, AgentState.IDLE); // back to IDLE after run
    });

    it('run throws if not initialized', async () => {
      const agent = new Agent('no-init');
      await assert.rejects(
        () => agent.run(),
        { message: /not running.*Call initialize/ }
      );
    });

    it('stop → transitions to STOPPED', async () => {
      const agent = new Agent('stop-test');
      await agent.initialize();
      assert.equal(agent.state, AgentState.RUNNING);
      await agent.stop();
      assert.equal(agent.state, AgentState.STOPPED);
    });

    it('stop is no-op if already stopped', async () => {
      const agent = new Agent('double-stop');
      await agent.initialize();
      await agent.stop();
      await agent.stop(); // should not throw
      assert.equal(agent.state, AgentState.STOPPED);
    });

    it('can re-initialize after error', async () => {
      let callCount = 0;
      class FlakeyAgent extends Agent {
        async _onInitialize() {
          callCount++;
          if (callCount === 1) throw new Error('transient failure');
        }
      }
      const agent = new FlakeyAgent('retry');
      await assert.rejects(() => agent.initialize(), { message: 'transient failure' });
      assert.equal(agent.state, AgentState.ERRORED);
      await agent.initialize(); // second attempt succeeds
      assert.equal(agent.state, AgentState.RUNNING);
    });
  });

  describe('error handling', () => {
    it('fail records error and transitions to ERRORED from RUNNING', async () => {
      const agent = new Agent('fail-test');
      await agent.initialize(); // IDLE → RUNNING
      agent.fail(new Error('test error'), 'run');
      assert.equal(agent.state, AgentState.ERRORED);
      assert.equal(agent.errors.length, 1);
      assert.equal(agent.errors[0].message, 'test error');
      assert.equal(agent.errors[0].phase, 'run');
    });

    it('errors array is a frozen copy', () => {
      const agent = new Agent('frozen');
      agent.fail(new Error('err1'));
      assert.throws(() => { agent.errors.push({}); });
    });

    it('_onInitialize error causes ERRORED state', async () => {
      class FailInit extends Agent {
        async _onInitialize() { throw new Error('init fail'); }
      }
      const agent = new FailInit('init-fail');
      await assert.rejects(() => agent.initialize(), { message: 'init fail' });
      assert.equal(agent.state, AgentState.ERRORED);
    });

    it('_onRun error causes ERRORED state', async () => {
      class FailRun extends Agent {
        async _onRun() { throw new Error('run fail'); }
      }
      const agent = new FailRun('run-fail');
      await agent.initialize();
      await assert.rejects(() => agent.run(), { message: 'run fail' });
      assert.equal(agent.state, AgentState.ERRORED);
    });
  });

  describe('state machine validation', () => {
    it('rejects invalid transition: RUNNING → INITIALIZING', async () => {
      const agent = new Agent('invalid');
      await agent.initialize();
      await assert.rejects(() => agent.initialize(), { message: /Invalid state transition/ });
    });

    it('rejects invalid transition: IDLE → RUNNING', async () => {
      const agent = new Agent('invalid2');
      await assert.rejects(() => agent.run(), { message: /not running/ });
    });
  });

  describe('logging', () => {
    it('state transitions are logged', async () => {
      const chunks = [];
      const original = process.stderr.write.bind(process.stderr);
      process.stderr.write = (chunk) => chunks.push(chunk);
      try {
        const agent = new Agent('log-test');
        await agent.initialize();
      } finally {
        process.stderr.write = original;
      }
      const output = chunks.join('');
      const lines = output.split('\n').filter(Boolean).map(JSON.parse);
      const transitions = lines.filter((l) => l.msg === 'agent state transition');
      assert.ok(transitions.length >= 1, 'should log state transitions');
    });

    it('fail logs error details', () => {
      const output = captureStderr(() => {
        const agent = new Agent('log-fail');
        agent.fail(new Error('logged error'));
      });
      const parsed = JSON.parse(output.trim());
      assert.equal(parsed.msg, 'agent error');
      assert.equal(parsed.message, 'logged error');
    });
  });
});
