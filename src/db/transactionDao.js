'use strict'
const {Status} = require('../enum/status')
const {TransactionTable} = require('./schema')
const {getLogger} = require('../util/logger')
const {getNetwork} = require('../ethers/eth')

function save(params) {
  delete params.isBlockingTxn
  return new TransactionTable(params).save().then(function () {
    const logger = getLogger()
    logger.info(
      'Transaction saved, transactionHash: %s, nonce: %s',
      params.transactionHash,
      params.nonce
    )
  })
}

function update(params) {
  delete params.isBlockingTxn
  return new TransactionTable(params).update().then(function () {
    const logger = getLogger()
    logger.info(
      'Transaction status updated, transactionHash: %s, nonce: %s, status: %s',
      params.transactionHash,
      params.nonce,
      params.txnStatus
    )
  })
}

function getTransactions(fromTimestamp, pool, callback) {
  return TransactionTable.query(pool)
    .usingIndex('poolIndex')
    .where('submissionDate')
    .gt(fromTimestamp)
    .ascending()
    .exec(callback)
}

function getPendingTransactions(fromAddress, callback) {
  return TransactionTable.query(fromAddress)
    .filter('txnStatus')
    .eq(Status.PENDING)
    .filter('network')
    .eq(getNetwork())
    .ascending()
    .exec(callback)
}

function getAllPendingTransactions(callback) {
  return TransactionTable.query('pending')
  .usingIndex('statusIndex')
  .filter('network')
  .eq(getNetwork())
  .ascending()
  .exec(callback)
}

module.exports = {
  save,
  update,
  getTransactions,
  getPendingTransactions,
  getAllPendingTransactions,
}
