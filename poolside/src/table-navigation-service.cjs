// Runtime bridge between screen inspection and the pure table-navigation state machine.

const navigation = require('./table-navigation-state.cjs');
const { createDryRunTableInput } = require('./table-navigation-input.cjs');

function createTableNavigationService(deps) {
  const {
    sessions,
    getAccount,
    inspector,
    publish,
    log,
    journal = null,
    input = createDryRunTableInput(),
    now = () => Date.now(),
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = timer => clearTimeout(timer)
  } = deps;
  const timers = new Map();

  function remember(id, plan) {
    const latest = plan.history.at(-1);
    if (!journal || !latest) return;
    try {
      journal.append({ accountId: id, targetTable: plan.targetTable, ...latest });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Table-navigation history could not be saved: ${message}`, 'warning');
    }
  }

  function active(id) {
    const account = getAccount(id);
    const group = sessions.get(id);
    if (!group || group.window?.isDestroyed?.()) throw new Error('Open this account window before planning table navigation.');
    return { account, group };
  }

  function decorate(plan) {
    const action = navigation.requiredAction(plan);
    return { ...plan, input: input.perform(action, { targetTable: plan.targetTable }) };
  }

  function clearDeadline(id) {
    const timer = timers.get(id);
    if (timer !== undefined) clearTimer(timer);
    timers.delete(id);
  }

  function arm(id, plan) {
    clearDeadline(id);
    if (!plan.deadlineAt) return;
    const expectedDeadline = plan.deadlineAt;
    const delay = Math.max(0, Date.parse(expectedDeadline) - now());
    timers.set(
      id,
      setTimer(() => {
        timers.delete(id);
        const group = sessions.get(id);
        if (!group || group.tableNavigation?.deadlineAt !== expectedDeadline) return;
        const account = getAccount(id);
        const failed = decorate(navigation.timeout(group.tableNavigation, now()));
        group.tableNavigation = failed;
        remember(id, failed);
        log(`${account.name}: table-navigation dry run failed (${failed.history.at(-1).detail}).`, 'warning');
        publish();
      }, delay)
    );
  }

  function commit(id, account, group, next) {
    const previous = group.tableNavigation;
    const decorated = decorate(next);
    group.tableNavigation = decorated;
    arm(id, decorated);
    remember(id, decorated);
    const latest = decorated.history.at(-1);
    if (!previous || previous.state !== decorated.state || previous.history?.length !== decorated.history.length) {
      log(`${account.name}: table-navigation dry run ${latest.event}: ${latest.detail}`);
    }
    publish();
    return decorated;
  }

  function start(inputValue) {
    const id = inputValue && inputValue.id;
    const targetTable = inputValue && inputValue.targetTable;
    const { account, group } = active(id);
    if (group.tableNavigation && !['complete', 'cancelled', 'failed'].includes(group.tableNavigation.state))
      throw new Error('Cancel the current table-navigation dry run before starting another.');
    return commit(id, account, group, navigation.start(targetTable, { now: now() }));
  }

  async function observe(id) {
    const { account, group } = active(id);
    if (!group.tableNavigation) throw new Error('Start a table-navigation dry run first.');
    const screen = await inspector.inspectGame(id);
    return commit(id, account, group, navigation.observe(group.tableNavigation, screen, now()));
  }

  function advance(id) {
    const { account, group } = active(id);
    if (!group.tableNavigation) throw new Error('Start a table-navigation dry run first.');
    return commit(id, account, group, navigation.advance(group.tableNavigation, now()));
  }

  function cancel(id) {
    const { account, group } = active(id);
    if (!group.tableNavigation) throw new Error('There is no table-navigation dry run to cancel.');
    return commit(id, account, group, navigation.cancel(group.tableNavigation, now()));
  }

  function retry(id) {
    const { account, group } = active(id);
    if (!group.tableNavigation) throw new Error('There is no table-navigation dry run to retry.');
    return commit(id, account, group, navigation.retry(group.tableNavigation, now()));
  }

  function dispose() {
    for (const timer of timers.values()) clearTimer(timer);
    timers.clear();
  }

  return { start, observe, advance, cancel, retry, dispose };
}

module.exports = { createTableNavigationService };
