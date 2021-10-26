'use strict'
const config = require('config')
const util = require('util')
const {getLogger} = require('../util/logger')
const {getTransactions} = require('../db/transactionDao')
const {getStartBlockNumber} = require('../ethers/eth')
const {getRebalanceTransactions} = require('../controller/transaction')
const {Status} = require('../enum/status')
const {FORK_ETH_URL} = require('../enum/network')
const BLOCK_PER_HOUR = 240
const {Operation} = require('../enum/operation')
const oneHour = 1 * 60 * 60 * 1000

function getBlockCount(embargo) {
  return embargo * BLOCK_PER_HOUR
}

async function isRecentOperationOnChain(data, embargo) {
  // With fork, not able to read events so just return false.
  // This is application only for local testing, In prod, it will read events from chain.
  if (config.eth.url === FORK_ETH_URL) {
    return new Promise(resolve => resolve(false))
  } else if (data.operation !== Operation.REBALANCE && data.operation !== Operation.DEPOSIT_ALL) {
    return new Promise(resolve => resolve(false))
  }
  return getStartBlockNumber(getBlockCount(embargo)).then(function (fromBlock) {
    if (data.strategy) {
      data.toAddress = data.strategy.address
    }
    return getRebalanceTransactions(data, fromBlock).then(function (result) {
      if (result && result.rebalance.length > 0) {
        const logger = getLogger()
        logger.warn(
          'Skipping %s for pool: %s, strategy: %s. Recent txn on chain : %s',
          data.operation,
          data.name,
          data.strategy.address,
          result.rebalance[0]
        )
        return true
      }
      return false
    })
  })
}

function getEmbargo(data) {
  let embargo = config.vesper.embargo
  if (config.vesper[data.operation]) {
    if (config.vesper[data.operation][data.name] && config.vesper[data.operation][data.name].embargo) {
      embargo = config.vesper[data.operation][data.name].embargo
    } else if (config.vesper[data.operation].embargo) {
      embargo = config.vesper[data.operation].embargo
    }
  }
  return embargo
}

async function isRecentTransaction(data) {
  const embargo = getEmbargo(data)
  const fromTimestamp = new Date(Date.now() - embargo * oneHour)
  const getTransactionsPromise = util.promisify(getTransactions)
  if (data.toAddress === undefined && data.strategy) {
    data.toAddress = data.strategy.address
  }
  return getTransactionsPromise(fromTimestamp, data.name).then(function (response) {
    if (response && response.Items && response.Items.length > 0) {
      for (let i = 0; i < response.Items.length; i++) {
        const transaction = response.Items[i].attrs
        if (
          transaction.operation === data.operation &&
          [Status.PENDING, Status.SUCCESS].includes(transaction.txnStatus) &&
          transaction.payeeAddress === data.payeeAddress &&
          transaction.assetAddress === data.assetAddress &&
          transaction.toAddress === data.toAddress
        ) {
          const logger = getLogger()
          logger.warn(
            'Skipping %s for pool: %s, strategy: %s. Recent txn found in database: %s',
            data.operation,
            data.name,
            data.strategy.address,
            transaction.transactionHash
          )
          return true
        }
      }
    }
    return isRecentOperationOnChain(data, embargo)
  })
}

module.exports = {
  isRecentTransaction,
}
