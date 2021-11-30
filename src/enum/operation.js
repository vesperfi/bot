'use strict'
const Operation = {
  REBALANCE: 'rebalance',
  DEPOSIT_ALL: 'depositAll',
  REBALANCE_COLLATERAL: 'rebalanceCollateral',
  RESURFACE: 'resurface',
  SPLIT_REVENUE_ERC20: 'splitRevenueERC20',
  SPLIT_REVENUE_ETH: 'splitRevenueETH',
  UPDATE_ORACLES: 'updateOracles',
  CLAIM_COMP: 'claimComp',
  FEE_TRANSFER: 'feeTransfer',
  ACCRUE_INTEREST: 'accrueInterest',
  LOW_WATER: 'lowWater',
  BUYBACK_UNWRAP: 'unwrapAll',
}

module.exports = {
  Operation,
}
