'use strict'

const deposit = require('./deposit')
const rebalanceCollateral = require('./rebalanceCollateral')
const rebalance = require('./rebalance')
const resurface = require('./resurface')
const splitRevenue = require('./splitRevenue')
const lowWater = require('./lowWater')
const updateOracles = require('./updateOracles')
const claimComp = require('../../service/ops/claimComp')
const {getContractMetadata} = require('../../util/contract')
const {executeJob} = require('../runner')
const {ignoreTransactionError} = require('../../util/transactionUtil')
const {update} = require('../../db/transactionDao')
const {Status} = require('../../enum/status')
const {syncPendingTransactions} = require('../sync')
const {getWallet} = require('../../ethers/eth')
const {findBestNonceAndBlockingTxn} = require('../nonce')
const MAKER = 'Maker'

async function before(data) {
  return syncPendingTransactions().then(function () {
    return getWallet(data.sendViaFlashBots).then(function (wallet) {
      return findBestNonceAndBlockingTxn(wallet, data).then(function (result) {
        const {nextNonce, blockingTxn} = result
        data.blockingTxnGasPrice = blockingTxn ? blockingTxn.gasPrice : 0
        data.nonce = blockingTxn ? blockingTxn.nonce : nextNonce
        data.blockingTxn = blockingTxn
        return data
      })
    })
  })
}

function getOperationObject(data) {
  let operationObj = [
    deposit,
    rebalanceCollateral,
    rebalance,
    resurface,
    splitRevenue,
    updateOracles,
    claimComp,
    lowWater,
  ].filter(item => item.operation === data.operation)[0]
  if (data.strategy && data.strategy.makerVaultInfo !== undefined && data.operation === deposit.operation) {
    data.operation = rebalanceCollateral.operation
    operationObj = rebalanceCollateral
  }
  return operationObj
}

function success(data) {
  data.result = Status.SUCCESS
  return data
}

function error(data, _error) {
  data.result = ignoreTransactionError(_error) ? Status.IGNORE : Status.FAILED
  return data
}

async function after(data) {
  if (data.blockingTxn) {
    const blockingTxn = data.blockingTxn
    blockingTxn.txnStatus = Status.REPLACED
    return update(blockingTxn).then(function () {
      blockingTxn.name = blockingTxn.pool
      blockingTxn.operationObj = getOperationObject(blockingTxn)
      return getContractMetadata([{name: blockingTxn.name, operation: blockingTxn.operation}]).then(function (_data) {
        const meta = _data.length > 0 ? _data[0] : []
        meta.strategies.forEach(function (strategy) {
          if (strategy.address === blockingTxn.toAddress) {
            meta.strategy = strategy
          }
        })
        // Submit replaced transaction
        return executeJob({...blockingTxn, ...meta})
      })
    })
  }
  return success(data)
}

async function prepare(input) {
  input.pools = input.pools ? input.pools : ''
  return getContractMetadata(
    input.pools.split(',').map(pool => ({
      name: pool,
      operation: input.operation,
      strategy: input.strategy,
      version: input.version,
    }))
  ).then(function (jobs) {
    jobs.forEach(function (data) {
      data.operationObj = getOperationObject(data)
    })
    return jobs
  })
}

async function prepareMakerStrategies(input, operationObj) {
  input.pools = input.pools ? input.pools : ''
  const jobsWithStrategies = []
  return getContractMetadata(input.pools.split(',').map(pool => ({name: pool, operation: input.operation}))).then(
    function (jobs) {
      jobs.forEach(function (job) {
        job.strategies.forEach(function (strategy) {
          const strategyJob = Object.assign({}, job)
          strategyJob.operationObj = operationObj
          strategyJob.operation = input.operation
          strategyJob.strategy = strategy
          if (strategy.info.split(':')[0].includes(MAKER)) {
            jobsWithStrategies.push(strategyJob)
          }
        })
      })
      return jobsWithStrategies
    }
  )
}

module.exports = {
  before,
  prepare,
  prepareMakerStrategies,
  after,
  error,
}
