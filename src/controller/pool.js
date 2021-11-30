/* eslint-disable consistent-return */
/* eslint-disable arrow-body-style */
'use strict'
const Secret = require('../util/secret')
const secret = new Secret()
const deposit = require('../service/ops/deposit')
const rebalanceCollateral = require('../service/ops/rebalanceCollateral')
const lowWater = require('../service/ops/lowWater')
const rebalance = require('../service/ops/rebalance')
const resurface = require('../service/ops/resurface')
const splitRevenue = require('../service/ops/splitRevenue')
const buybackUnwrap = require('../service/ops/buybackUnwrap')
const claimComp = require('../service/ops/claimComp')
const feeTransfer = require('../service/ops/feeTransfer')
const accrueInterest = require('../service/ops/accrueInterest')
const {prepareErrorResponse, prepareSuccessMessage} = require('../util/utils')
const {Operation} = require('../enum/operation')
const {executeJobs} = require('../service/runner')
const {Status} = require('../enum/status')
const PROCESSED_MESSAGE = 'operation processed. Check logs for more detail.'
const FAILED_MESSAGE = 'operation failed. Check logs for more detail.'
const FIRST_ATTEMPT_ERROR = 'errors in first attempt, giving another retry'
const {getLogger} = require('../util/logger')

async function execute(input) {
  const opObj = [
    deposit,
    rebalanceCollateral,
    rebalance,
    resurface,
    splitRevenue,
    buybackUnwrap,
    claimComp,
    feeTransfer,
    accrueInterest,
    lowWater,
  ].filter(item => item.operation === input.operation)[0]
  return secret.initSecret().then(function () {
    return opObj
      .prepare(input)
      .then(function (jobs) {
        return executeJobs(jobs)
      })
      .then(function (results) {
        const failedJobs = results.filter(item => item.result === Status.FAILED)
        // Retry again for failed jobs if there are non ignorable errors in first attempt.
        if (failedJobs.length > 0) {
          const logger = getLogger()
          logger.warn(`${input.operation} : %s ${FIRST_ATTEMPT_ERROR}`, failedJobs.length)
          return executeJobs(failedJobs)
        }
      })
      .then(function () {
        prepareSuccessMessage(`${input.operation} for ${input.pools}, ${PROCESSED_MESSAGE}`)
      })
      .catch(function (error) {
        prepareErrorResponse(`Pool: ${input.pools}, ${input.operation} ${FAILED_MESSAGE}`, error)
      })
  })
}

module.exports.deployFund = event => {
  return execute({operation: Operation.DEPOSIT_ALL, pools: event.pools, strategy: event.strategy})
}

module.exports.rebalance = event => {
  return execute({
    operation: Operation.REBALANCE,
    pools: event.pools,
    strategy: event.strategy,
    allocation: event.allocation,
    version: event.version,
    sendViaFlashBots: event.sendViaFlashBots,
  })
}

module.exports.rebalanceCollateral = event => {
  return execute({
    operation: Operation.REBALANCE_COLLATERAL,
    pools: event.pools,
    strategy: event.strategy,
  })
}

module.exports.resurface = () => {
  return execute({operation: Operation.RESURFACE})
}

module.exports.lowWater = () => {
  return execute({operation: Operation.LOW_WATER})
}

module.exports.splitRevenue = () => {
  return execute({operation: Operation.SPLIT_REVENUE_ERC20})
}

module.exports.buybackUnwrap = () => {
  return execute({operation: Operation.BUYBACK_UNWRAP})
}

module.exports.claimComp = () => {
  return execute({operation: Operation.CLAIM_COMP})
}

module.exports.feeTransfer = () => {
  return execute({operation: Operation.FEE_TRANSFER})
}

module.exports.accrueInterest = () => {
  return execute({operation: Operation.ACCRUE_INTEREST})
}
