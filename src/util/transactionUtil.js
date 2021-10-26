'use strict'
const {save, update} = require('../db/transactionDao')
const {Status} = require('../enum/status')
const {getLogger} = require('../util/logger')
const {logTransaction} = require('../util/logger')
const MAX_ERROR_LENGTH = 100
const IGNORE_ERROR_MESSAGES = [
  'revert',
  'Can not rebalance',
  'caller-is-not-keeper',
  'Contract has paused',
  'payee-is-not-due-for-tokens',
  'insufficient funds for gas * price + value',
  'fee-collector-not-set',
  'not-allowed-to-sweep-collateral',
  'not-allowed-to-sweep',
  'caller-is-not-authorized'
]

function saveTransaction(txnParams, error) {
  return new Promise(function (resolve, reject) {
    if (error) {
      txnParams.txnStatus = Status.FAILED
      if (error.message) {
        txnParams.error = error.message
      } else {
        const errorLengthForDb = error.length > MAX_ERROR_LENGTH ? MAX_ERROR_LENGTH : error.length
        txnParams.error = error.toString().substring(0, errorLengthForDb)
      }
      logTransaction(txnParams, error)
    } else {
      txnParams.txnStatus = txnParams.txnStatus ? txnParams.txnStatus : Status.PENDING
      logTransaction(txnParams)
    }
    txnParams.submissionDate = new Date().getTime()
    delete txnParams.gas
    delete txnParams.sendViaFlashBots
    // set transaction details in db
    save(txnParams)
      .then(function () {
        error ? reject(txnParams) : resolve(txnParams)
      })
      .catch(function (err) {
        // log error but do not reject here when it failed to save in db.
        // transaction on chain is successfully submitted.
        const logger = getLogger()
        logger.error(
          'Transaction failed to save, operation: %s, pool: %s, transactionHash: %s, ' + 'nonce: %s, error: %s',
          txnParams.operation,
          txnParams.pool,
          txnParams.transactionHash,
          txnParams.nonce,
          err
        )
        error ? reject(txnParams) : resolve(txnParams)
      })
  })
}

function updateTxnStatus(blockingTransaction, status) {
  blockingTransaction.txnStatus = status
  return update(blockingTransaction)
}

function ignoreTransactionError(error) {
  const _error = error.error || error
  return IGNORE_ERROR_MESSAGES.some(errorMessage => _error.toString().includes(errorMessage))
}

module.exports = {
  saveTransaction,
  updateTxnStatus,
  ignoreTransactionError,
}
