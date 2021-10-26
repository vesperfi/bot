'use strict'
const util = require('util')
const config = require('config')
const {getPriority} = require('../enum/priority')
const {getPendingTransactions} = require('../db/transactionDao')
const {update} = require('../db/transactionDao')
const {Status} = require('../enum/status')
const fiftyFiveMins = 55 * 60 * 1000

function isBlockingTxn(data, pendingTxn) {
  const priority = config.vesper[data.operation]
    ? getPriority(config.vesper[data.operation].priority)
    : getPriority(config.vesper.priority)

  return (
    pendingTxn &&
    (priority > pendingTxn.priority ||
      Date.now() - new Date(pendingTxn.submissionDate) > config.vesper.pendingTime * fiftyFiveMins)
  )
}

function findBestNonceAndBlockingTxn(wallet, data) {
  const fromAddress = wallet.address
  return wallet.provider.getTransactionCount(fromAddress).then(function (nextNonce) {
    const result = {nextNonce}
    const promise = util.promisify(getPendingTransactions)
    return promise(fromAddress).then(function (response) {
      if (response && response.Items && response.Items.length > 0) {
        const pendingTxnCount = response.Items.length
        const pendingTxn = JSON.parse(JSON.stringify(response.Items[0]))
        if (nextNonce > pendingTxn.nonce) {
          // Case when txn is submitted externally
          pendingTxn.txnStatus = Status.REPLACED
          return update(pendingTxn).then(function () {
            return result
          })
        }
        result.nextNonce = nextNonce + pendingTxnCount
        if (data) {
          result.blockingTxn = isBlockingTxn(data, pendingTxn) ? pendingTxn : undefined
        }
      }
      return result
    })
  })
}

module.exports = {
  findBestNonceAndBlockingTxn,
}
