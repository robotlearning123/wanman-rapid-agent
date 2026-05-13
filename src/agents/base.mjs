/**
 * Agent — abstract base class for all agents in the orchestration system
 *
 * Provides a common lifecycle (initialize → run → stop), structured logging,
 * error tracking, and state management. Concrete agents override `initialize()`
 * and `run()`; `stop()` is optional.
 */

import { logger } from '../utils/logger.mjs';

/** @enum {string} */
export const AgentState = {
  IDLE: 'idle',
  INITIALIZING: 'initializing',
  RUNNING: 'running',
  STOPPED: 'stopped',
  ERRORED: 'errored',
};

export class Agent {
  /** @type {string} */
  #name;

  /** @type {AgentState} */
  #state = AgentState.IDLE;

  /** @type {object} */
  #config;

  /** @type {object[]} */
  #errors = [];

  /**
   * @param {string} name - human-readable agent identifier
   * @param {object} [config={}] - agent-specific configuration
   */
  constructor(name, config = {}) {
    if (!name || typeof name !== 'string') {
      throw new Error('Agent requires a non-empty string name');
    }
    this.#name = name;
    this.#config = Object.freeze({ ...config });
  }

  /** @returns {string} */
  get name() { return this.#name; }

  /** @returns {AgentState} */
  get state() { return this.#state; }

  /** @returns {object} */
  get config() { return this.#config; }

  /** @returns {readonly object[]} */
  get errors() { return Object.freeze([...this.#errors]); }

  /**
   * Transition to a new state. Logs the transition.
   * Throws if the transition is invalid.
   *
   * @param {AgentState} next
   */
  #transition(next) {
    const valid = {
      [AgentState.IDLE]: [AgentState.INITIALIZING],
      [AgentState.INITIALIZING]: [AgentState.RUNNING, AgentState.ERRORED],
      [AgentState.RUNNING]: [AgentState.STOPPED, AgentState.ERRORED, AgentState.IDLE],
      [AgentState.STOPPED]: [AgentState.INITIALIZING],
      [AgentState.ERRORED]: [AgentState.INITIALIZING],
    };

    const allowed = valid[this.#state] ?? [];
    if (!allowed.includes(next)) {
      throw new Error(`Invalid state transition: ${this.#state} → ${next}`);
    }

    const prev = this.#state;
    this.#state = next;
    logger.info('agent state transition', {
      agent: this.#name,
      from: prev,
      to: next,
    });
  }

  /**
   * Record an error and transition to ERRORED state.
   *
   * @param {Error} err
   * @param {string} [phase]
   */
  fail(err, phase) {
    const entry = {
      message: err.message,
      phase: phase ?? this.#state,
      timestamp: new Date().toISOString(),
    };
    this.#errors.push(entry);

    if (this.#state === AgentState.RUNNING || this.#state === AgentState.INITIALIZING) {
      this.#transition(AgentState.ERRORED);
    }

    logger.error('agent error', { agent: this.#name, ...entry });
  }

  /**
   * Initialize the agent — called once before run().
   * Override in subclasses to set up resources, connections, etc.
   *
   * @returns {Promise<void>}
   */
  async initialize() {
    this.#transition(AgentState.INITIALIZING);
    try {
      await this._onInitialize();
      this.#transition(AgentState.RUNNING);
    } catch (err) {
      this.fail(err, 'initialize');
      throw err;
    }
  }

  /**
   * Execute the agent's main work.
   * Override in subclasses with domain logic.
   *
   * @returns {Promise<object>} result summary
   */
  async run() {
    if (this.#state !== AgentState.RUNNING) {
      throw new Error(`Agent "${this.#name}" is not running (state: ${this.#state}). Call initialize() first.`);
    }
    try {
      const result = await this._onRun();
      this.#transition(AgentState.IDLE);
      return result;
    } catch (err) {
      this.fail(err, 'run');
      throw err;
    }
  }

  /**
   * Stop the agent gracefully. Optional override.
   *
   * @returns {Promise<void>}
   */
  async stop() {
    if (this.#state === AgentState.STOPPED) return;
    try {
      await this._onStop();
      this.#transition(AgentState.STOPPED);
    } catch (err) {
      this.fail(err, 'stop');
      throw err;
    }
  }

  // --- Hooks for subclasses ---

  /** @protected */
  async _onInitialize() {}

  /**
   * @protected
   * @returns {Promise<object>}
   */
  async _onRun() { return {}; }

  /** @protected */
  async _onStop() {}
}
