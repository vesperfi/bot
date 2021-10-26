'use strict'
const util = require('util')
const {getLogger} = require('../util/logger')
const {getTxnStatusFromChain} = require('../ethers/eth')
const {update, getAllPendingTransactions} = require('../db/transactionDao')

function syncPendingTransactions() {
  const getAllPendingTransactionsPromise = util.promisify(getAllPendingTransactions)
  return getAllPendingTransactionsPromise().then(function (response) {
    if (response && response.Items && response.Items.length > 0) {
      const pendingTransactionPromises = []
      response.Items.forEach(function (pendingTransaction) {
        const pendingTxn = JSON.parse(JSON.stringify(pendingTransaction))
        const txnStatusPromise = getTxnStatusFromChain(pendingTxn.transactionHash)
        pendingTransactionPromises.push(txnStatusPromise)
      })
      return Promise.all(pendingTransactionPromises).then(function (statuses) {
        const updatePendingTransactionsStatusPromises = []
        response.Items.map(function (txn, index) {
          const pendingTransaction = JSON.parse(JSON.stringify(txn))
          pendingTransaction.txnStatus = statuses[index]
          const updateTransactionPromise = update(pendingTransaction)
          updatePendingTransactionsStatusPromises.push(updateTransactionPromise)
        })

        return Promise.all(updatePendingTransactionsStatusPromises).then(function (updateCount) {
          const logger = getLogger()
          logger.info('Transactions status is synced from chain for %s transactions', updateCount.length)
        })
      })
    }
    return true
  })
}

module.exports = {
  syncPendingTransactions,
}
