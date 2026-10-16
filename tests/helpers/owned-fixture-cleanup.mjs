/**
 * Restore shared configuration even when owned-data cleanup fails. Accounts
 * remain available for repair until data removal and restoration both succeed.
 * Every attempted stage's original failure is retained in AggregateError.errors.
 */
export async function cleanupOwnedFixture({ data, restore, accounts }) {
  const errors = [];
  const stages = [];
  let dataRemoved = false;
  let restored = false;
  try {
    await data();
    dataRemoved = true;
  } catch (error) {
    errors.push(error);
    stages.push("data");
  } finally {
    try {
      await restore();
      restored = true;
    } catch (error) {
      errors.push(error);
      stages.push("restore");
    }
  }
  if (dataRemoved && restored) {
    try {
      await accounts();
    } catch (error) {
      errors.push(error);
      stages.push("accounts");
    }
  }
  if (errors.length) {
    const failure = new AggregateError(errors, "Owned fixture cleanup failed");
    failure.cleanupStages = stages;
    throw failure;
  }
}
