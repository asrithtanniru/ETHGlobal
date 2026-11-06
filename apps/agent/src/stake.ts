/** What the vault says about a sender's staking right now. */
export interface StakeView {
  /** stakePlanOf(sender).delay in seconds. Zero means the sender has not agreed to staking. */
  delay: bigint;
  /** stakePlanOf(sender).keep: what must stay in the balance for bills. */
  keep: bigint;
  balance: bigint;
  /** stakeOf(sender).principal. */
  staked: bigint;
  lastActive: bigint;
}

/** Pure policy: stake once the sender has gone quiet, and bring the stake back once they return. */
export function stakeAction(v: StakeView, now: bigint): "stake" | "unstake" | undefined {
  if (v.delay === 0n) return undefined;
  const idle = now >= v.lastActive + v.delay;
  if (idle) return v.balance > v.keep ? "stake" : undefined;
  return v.staked > 0n ? "unstake" : undefined;
}
